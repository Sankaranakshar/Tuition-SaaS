import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, OTHER_ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let bodyStudentId: string;

const PDF_BYTES = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46]), Buffer.from("-1.4 fake pdf content for magic-byte sniffing")]);

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function insertDocument(overrides: Partial<{ orgId: string; storagePath: string; uploadedBy: string }> = {}) {
  const id = crypto.randomUUID();
  // storage_path is NOT NULL in the schema — the route's "legacy_document"
  // branch (`if (!doc.storage_path)`) is a defensive `!x` check that also
  // catches an empty string, which is what this test uses to reach it.
  await db.query(
    `insert into documents (id, organization_id, student_id, file_name, storage_path, content_type, category, uploaded_by_user_id)
     values ($1, $2, $3, 'existing.pdf', $4, 'application/pdf', 'report', $5)`,
    [id, overrides.orgId ?? ORG, bodyStudentId, overrides.storagePath === undefined ? `orgs/${ORG}/documents/seed/${id}.pdf` : overrides.storagePath, overrides.uploadedBy ?? uids.tutor]
  );
  return id;
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  bodyStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Docs Student')`, [bodyStudentId, ORG]);
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/documents", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/documents").field("studentId", bodyStudentId).field("category", "report");
    expectStatus(res, 401);
  });

  it("403s for a role outside CAN_UPLOAD (parent)", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set(...authHeader(uids.parent))
      .field("studentId", bodyStudentId)
      .field("category", "report")
      .attach("file", PDF_BYTES, "report.pdf");
    expectStatus(res, 403);
  });

  it("400s with no file attached", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set(...authHeader(uids.owner))
      .field("studentId", bodyStudentId)
      .field("category", "report");
    expectStatus(res, 400);
    expect(res.body.error.code).toBe("no_file");
  });

  it("422s a file whose content doesn't match any supported magic bytes", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set(...authHeader(uids.owner))
      .field("studentId", bodyStudentId)
      .field("category", "report")
      .attach("file", Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xff]), "weird.bin");
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("unsupported_type");
  });

  it("200s uploading a real PDF and creates a real document row", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set(...authHeader(uids.tutor))
      .field("studentId", bodyStudentId)
      .field("category", "report")
      .attach("file", PDF_BYTES, "My Report (final).pdf");
    expectStatus(res, 200);
    expect(res.body.documentId).toBeTruthy();

    const row = await db.query<any>(`select organization_id, content_type, file_name from documents where id = $1`, [res.body.documentId]);
    expect(row.rows[0].organization_id).toBe(ORG);
    expect(row.rows[0].content_type).toBe("application/pdf");
    expect(row.rows[0].file_name).toBe("My_Report__final_.pdf"); // sanitized
  });
});

describe("GET /api/v1/documents/:documentId/url", () => {
  it("401s with no token", async () => {
    const docId = await insertDocument();
    const res = await request(app).get(`/api/v1/documents/${docId}/url`);
    expectStatus(res, 401);
  });

  it("404s for a document that doesn't exist", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${crypto.randomUUID()}/url`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 404);
  });

  it("403s a document belonging to another organization", async () => {
    const docId = await insertDocument({ orgId: OTHER_ORG });
    const res = await request(app)
      .get(`/api/v1/documents/${docId}/url`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 403);
  });

  it("422s a legacy document with no storage path", async () => {
    const docId = await insertDocument({ storagePath: "" });
    const res = await request(app)
      .get(`/api/v1/documents/${docId}/url`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("legacy_document");
  });

  it("403s a non-uploader student (not staff, didn't upload it)", async () => {
    const docId = await insertDocument({ uploadedBy: uids.tutor });
    const res = await request(app)
      .get(`/api/v1/documents/${docId}/url`)
      .set(...authHeader(uids.student));
    expectStatus(res, 403);
  });

  it("200s for staff and returns a real signed URL for an uploaded file", async () => {
    const upload = await request(app)
      .post("/api/v1/documents")
      .set(...authHeader(uids.owner))
      .field("studentId", bodyStudentId)
      .field("category", "report")
      .attach("file", PDF_BYTES, "signable.pdf");
    expectStatus(upload, 200);

    const res = await request(app)
      .get(`/api/v1/documents/${upload.body.documentId}/url`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.url).toMatch(/^https:\/\/storage\.test\//);
  });
});

describe("DELETE /api/v1/documents/:documentId", () => {
  it("403s for a role below owner/admin (tutor)", async () => {
    const docId = await insertDocument();
    const res = await request(app)
      .delete(`/api/v1/documents/${docId}`)
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("404s a document that doesn't exist", async () => {
    const res = await request(app)
      .delete(`/api/v1/documents/${crypto.randomUUID()}`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 404);
  });

  it("200s and actually removes the row", async () => {
    const docId = await insertDocument();
    const res = await request(app)
      .delete(`/api/v1/documents/${docId}`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);

    const row = await db.query<any>(`select 1 from documents where id = $1`, [docId]);
    expect(row.rows.length).toBe(0);
  });
});
