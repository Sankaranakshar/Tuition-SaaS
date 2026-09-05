import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join("\n"), "utf-8");
}

async function countStudents(): Promise<number> {
  const res = await db.query<any>(`select count(*)::int as n from students`);
  return res.rows[0].n;
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/students/import/inspect", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/students/import/inspect").attach("file", csv(["Name,Phone", "Riya,111"]), "students.csv");
    expect(res.status).toBe(401);
  });

  it("403s for a role outside CAN_IMPORT (parent)", async () => {
    const res = await request(app)
      .post("/api/v1/students/import/inspect")
      .set(...authHeader(uids.parent))
      .attach("file", csv(["Name,Phone", "Riya,111"]), "students.csv");
    expect(res.status).toBe(403);
  });

  it("400s with no file attached", async () => {
    const res = await request(app).post("/api/v1/students/import/inspect").set(...authHeader(uids.owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("no_file");
  });

  it("returns detected headers, a sample, and a suggested mapping", async () => {
    const res = await request(app)
      .post("/api/v1/students/import/inspect")
      .set(...authHeader(uids.owner))
      .attach("file", csv(["Name,Phone,Parent,Parent Phone", "Aarav Mehta,9876543210,Sunita Mehta,9876500000"]), "students.csv");
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(["Name", "Phone", "Parent", "Parent Phone"]);
    expect(res.body.suggestedMapping).toEqual(["name", "phone", "parentName", "parentPhone"]);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.sampleRows).toEqual([["Aarav Mehta", "9876543210", "Sunita Mehta", "9876500000"]]);
  });
});

describe("POST /api/v1/students/import (dry run)", () => {
  it("never writes to the database, even for a file with only clean rows", async () => {
    const before = await countStudents();
    const res = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "false")
      .attach("file", csv(["Name,Phone", "Dry Run Student,9998887777"]), "students.csv");
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.toCreate).toHaveLength(1);
    expect(await countStudents()).toBe(before);
  });

  it("reports a missing-name row as a per-row error without failing the rest of the file", async () => {
    const res = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "false")
      .attach("file", csv(["Name,Phone", ",1111111111", "Good Row,2222222222"]), "students.csv");
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([{ rowIndex: 2, message: "Missing a name." }]);
    expect(res.body.toCreate).toHaveLength(1);
    expect(res.body.toCreate[0].name).toBe("Good Row");
  });

  it("flags a row whose name+phone match an existing student, and excludes it from toCreate", async () => {
    await db.query(`insert into students (id, organization_id, name, phone) values (gen_random_uuid(), $1, 'Existing Kid', '9123456780')`, [ORG]);
    const res = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "false")
      .attach("file", csv(["Name,Phone", "Existing Kid,9123456780"]), "students.csv");
    expect(res.status).toBe(200);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0].matchedStudentName).toBe("Existing Kid");
    expect(res.body.toCreate).toHaveLength(0);
  });

  it("does not flag two siblings sharing one parent phone as duplicates of each other", async () => {
    const res = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "false")
      .attach("file", csv(["Name,Phone", "Sibling One,9555500000", "Sibling Two,9555500000"]), "students.csv");
    expect(res.status).toBe(200);
    expect(res.body.duplicates).toEqual([]);
    expect(res.body.toCreate).toHaveLength(2);
  });

  it("403s for a role outside CAN_IMPORT (frontdesk is allowed, parent is not)", async () => {
    const res = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.parent))
      .field("mapping", JSON.stringify(["name"]))
      .field("commit", "false")
      .attach("file", csv(["Name", "X"]), "students.csv");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/students/import (commit)", () => {
  it("creates only the clean rows and reports the row-level error for the bad one", async () => {
    const before = await countStudents();
    const res = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "true")
      .attach("file", csv(["Name,Phone", ",1111111111", "Commit Good Row,3333333333"]), "students.csv");
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.createdCount).toBe(1);
    expect(res.body.created[0].name).toBe("Commit Good Row");
    expect(res.body.errors).toEqual([{ rowIndex: 2, message: "Missing a name." }]);
    expect(await countStudents()).toBe(before + 1);

    const row = await db.query<any>(`select organization_id, name, phone, tutor_id from students where id = $1`, [res.body.created[0].studentId]);
    expect(row.rows[0].organization_id).toBe(ORG);
    expect(row.rows[0].phone).toBe("3333333333");
    // Regression: tutor_id must be set to the importing actor regardless of
    // their org role (owner here), matching People.tsx's StudentModal
    // convention. A conditional (role === "tutor") version of this line
    // left owner-run imports invisible in useStudentsList() — caught live
    // in the browser walkthrough, not by any earlier version of this test.
    expect(row.rows[0].tutor_id).toBe(uids.owner);
  });

  it("does not create a flagged duplicate unless resolved as 'import'", async () => {
    await db.query(`insert into students (id, organization_id, name, phone) values (gen_random_uuid(), $1, 'Dup Guard', '9111122223')`, [ORG]);
    const before = await countStudents();

    const skipped = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "true")
      .attach("file", csv(["Name,Phone", "Dup Guard,9111122223"]), "students.csv");
    expect(skipped.status).toBe(200);
    expect(skipped.body.createdCount).toBe(0);
    expect(skipped.body.skippedDuplicates).toHaveLength(1);
    expect(await countStudents()).toBe(before);

    const imported = await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name", "phone"]))
      .field("commit", "true")
      .field("resolutions", JSON.stringify({ "2": "import" }))
      .attach("file", csv(["Name,Phone", "Dup Guard,9111122223"]), "students.csv");
    expect(imported.status).toBe(200);
    expect(imported.body.createdCount).toBe(1);
    expect(await countStudents()).toBe(before + 1);
  });

  it("writes an audit event for the import", async () => {
    await request(app)
      .post("/api/v1/students/import")
      .set(...authHeader(uids.owner))
      .field("mapping", JSON.stringify(["name"]))
      .field("commit", "true")
      .attach("file", csv(["Name", "Audit Check Student"]), "students.csv");
    const audit = await db.query<any>(`select action from audit_events where organization_id = $1 and action = 'students.bulk_import' order by created_at desc limit 1`, [ORG]);
    expect(audit.rows).toHaveLength(1);
  });
});
