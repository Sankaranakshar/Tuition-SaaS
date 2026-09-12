import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids, ids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;

// fixtures.ts's uids.*/ids.* are hand-picked "10000000-...-0003" style
// strings — valid Postgres uuids but not valid RFC 4122 v1-8 uuids (version
// nibble is '0'), so shared/schemas/leave.ts's z.string().uuid() body
// validation correctly rejects them (same note as scheduling.test.ts/
// payouts.test.ts). tutorId/substituteTutorId only ever appear in a JSON
// body here, so those need real v4 ids; leaveId is a path param the route
// reads unvalidated by zod (and is a real gen_random_uuid() from the DB
// anyway), so fixture-style ids are never an issue there.
let bodyTutorId: string; // real tutor, used as the leave-requester in body-tutorId tests
let bodySubstituteId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function createLeave(actorId: string, tutorId: string | undefined, startDate: string, endDate: string) {
  return request(app).post("/api/v1/leave").set(...authHeader(actorId)).send({ tutorId, startDate, endDate, reason: "Family event" });
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());

  bodyTutorId = crypto.randomUUID();
  bodySubstituteId = crypto.randomUUID();
  for (const tid of [bodyTutorId, bodySubstituteId]) {
    await db.query(`insert into auth.users (id) values ($1)`, [tid]);
    await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor')`, [ORG, tid]);
  }
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/leave", () => {
  it("401s with no token", async () => {
    expectStatus(await request(app).post("/api/v1/leave").send({ startDate: "2026-09-15", endDate: "2026-09-16" }), 401);
  });

  it("403s for a role outside CAN_SCHEDULE (parent)", async () => {
    expectStatus(await createLeave(uids.parent, undefined, "2026-09-15", "2026-09-16"), 403);
  });

  it("a tutor can request their own leave, defaulting tutorId to themselves", async () => {
    const res = await createLeave(uids.tutor, undefined, "2026-09-15", "2026-09-16");
    expectStatus(res, 200);
    const row = (await db.query<any>(`select tutor_id, status, requested_by from tutor_leave_requests where id = $1`, [res.body.id])).rows[0];
    expect(row.tutor_id).toBe(uids.tutor);
    expect(row.status).toBe("pending");
    expect(row.requested_by).toBe(uids.tutor);
  });

  it("422s when endDate is before startDate", async () => {
    expectStatus(await createLeave(uids.tutor, undefined, "2026-09-20", "2026-09-15"), 422);
  });

  it("403s a tutor trying to log leave on another tutor's behalf", async () => {
    expectStatus(await createLeave(uids.tutor, bodyTutorId, "2026-09-15", "2026-09-16"), 403);
  });

  it("lets owner/admin log leave on a real tutor's behalf", async () => {
    const res = await createLeave(uids.owner, bodyTutorId, "2026-09-15", "2026-09-16");
    expectStatus(res, 200);
    expect((await db.query<any>(`select tutor_id from tutor_leave_requests where id = $1`, [res.body.id])).rows[0].tutor_id).toBe(bodyTutorId);
  });

  it("404s when tutorId is not a member of the caller's organization", async () => {
    const stranger = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [stranger]);
    expectStatus(await createLeave(uids.owner, stranger, "2026-09-15", "2026-09-16"), 404);
  });
});

describe("GET /api/v1/leave", () => {
  it("a tutor sees only their own leave requests, not another tutor's", async () => {
    await createLeave(uids.tutor2, undefined, "2026-10-01", "2026-10-02");
    const res = await request(app).get("/api/v1/leave").set(...authHeader(uids.tutor2));
    expectStatus(res, 200);
    expect(res.body.requests.length).toBeGreaterThan(0);
    expect(res.body.requests.every((r: any) => r.tutorId === uids.tutor2)).toBe(true);
  });

  it("owner sees every tutor's leave requests in the org", async () => {
    const res = await request(app).get("/api/v1/leave").set(...authHeader(uids.owner));
    expectStatus(res, 200);
    const tutorIds = new Set(res.body.requests.map((r: any) => r.tutorId));
    expect(tutorIds.has(uids.tutor)).toBe(true);
    expect(tutorIds.has(uids.tutor2)).toBe(true);
  });

  it("filters by status", async () => {
    const res = await request(app).get("/api/v1/leave?status=pending").set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.requests.every((r: any) => r.status === "pending")).toBe(true);
  });
});

describe("PATCH /api/v1/leave/:id (approve/reject/cancel)", () => {
  it("403s a tutor trying to approve their own leave", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-11-01", "2026-11-02");
    const res = await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.tutor)).send({ action: "approve" });
    expectStatus(res, 403);
  });

  it("owner can approve a pending request; decided_by/decided_at are stamped", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-11-03", "2026-11-04");
    const res = await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.owner)).send({ action: "approve" });
    expectStatus(res, 200);
    expect(res.body.status).toBe("approved");
    const row = (await db.query<any>(`select status, decided_by, decided_at from tutor_leave_requests where id = $1`, [created.body.id])).rows[0];
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(uids.owner);
    expect(row.decided_at).not.toBeNull();
  });

  it("409s approving an already-decided request", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-11-05", "2026-11-06");
    await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.owner)).send({ action: "approve" });
    const res = await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.owner)).send({ action: "reject" });
    expectStatus(res, 409);
  });

  it("the requesting tutor can cancel their own pending request", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-11-07", "2026-11-08");
    const res = await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.tutor)).send({ action: "cancel" });
    expectStatus(res, 200);
    expect(res.body.status).toBe("cancelled");
  });

  it("403s a different tutor cancelling someone else's pending request", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-11-09", "2026-11-10");
    const res = await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.tutor2)).send({ action: "cancel" });
    expectStatus(res, 403);
  });

  it("404s across organizations", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-11-11", "2026-11-12");
    const res = await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.outsider)).send({ action: "approve" });
    expectStatus(res, 404);
  });
});

describe("GET /api/v1/leave/:id/affected-sessions", () => {
  it("returns the fixture session for a leave range that covers it", async () => {
    // ids.sess1 is tutor_id=uids.tutor, 2026-07-01 10:00-11:00, status scheduled.
    const created = await createLeave(uids.tutor, undefined, "2026-07-01", "2026-07-01");
    const res = await request(app).get(`/api/v1/leave/${created.body.id}/affected-sessions`).set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.sessions.map((s: any) => s.id)).toContain(ids.sess1);
  });

  it("returns no sessions for a range with nothing scheduled", async () => {
    const created = await createLeave(uids.tutor, undefined, "2030-01-01", "2030-01-02");
    const res = await request(app).get(`/api/v1/leave/${created.body.id}/affected-sessions`).set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.sessions).toEqual([]);
  });
});

describe("POST /api/v1/leave/:id/reassign", () => {
  it("409s reassigning before the leave is approved", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-07-01", "2026-07-01");
    const res = await request(app).post(`/api/v1/leave/${created.body.id}/reassign`).set(...authHeader(uids.owner)).send({ substituteTutorId: bodySubstituteId });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("not_approved");
  });

  it("422s when the substitute is the tutor who is on leave", async () => {
    const created = await createLeave(bodyTutorId, undefined, "2026-07-01", "2026-07-01");
    await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.owner)).send({ action: "approve" });
    const res = await request(app).post(`/api/v1/leave/${created.body.id}/reassign`).set(...authHeader(uids.owner)).send({ substituteTutorId: bodyTutorId });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("same_tutor");
  });

  it("reassigns the fixture session's tutor_id to the substitute and writes an audit row", async () => {
    const created = await createLeave(uids.tutor, undefined, "2026-07-01", "2026-07-01");
    await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.owner)).send({ action: "approve" });

    const res = await request(app).post(`/api/v1/leave/${created.body.id}/reassign`).set(...authHeader(uids.owner)).send({ substituteTutorId: bodySubstituteId });
    expectStatus(res, 200);
    expect(res.body.results).toEqual([{ sessionId: ids.sess1, ok: true }]);

    const session = (await db.query<any>(`select tutor_id from class_sessions where id = $1`, [ids.sess1])).rows[0];
    expect(session.tutor_id).toBe(bodySubstituteId);

    const audit = (await db.query<any>(
      `select payload from audit_events where organization_id = $1 and action = 'session.reassign_tutor' order by created_at desc limit 1`,
      [ORG]
    )).rows[0];
    expect(audit.payload.fromTutorId).toBe(uids.tutor);
    expect(audit.payload.toTutorId).toBe(bodySubstituteId);

    // Restore the fixture session's tutor for any later test file relying on
    // the original seed shape (each contract test file boots its own PGlite
    // instance, but keep this local file's own later assertions honest).
    await db.query(`update class_sessions set tutor_id = $1 where id = $2`, [uids.tutor, ids.sess1]);
  });

  it("reports a per-session conflict without failing sessions that succeed", async () => {
    // A second session for uids.tutor, same day, that the substitute is
    // already busy for -- proves one conflicting session doesn't roll back
    // the rest of the batch.
    const freeSlotSession = crypto.randomUUID();
    const busySlotSession = crypto.randomUUID();
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2026-07-02T09:00:00Z', '2026-07-02T10:00:00Z', 'scheduled')`,
      [freeSlotSession, ORG, uids.tutor]
    );
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2026-07-02T11:00:00Z', '2026-07-02T12:00:00Z', 'scheduled')`,
      [busySlotSession, ORG, uids.tutor]
    );
    // The substitute already has a session overlapping busySlotSession's time.
    const substituteBusySession = crypto.randomUUID();
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2026-07-02T11:30:00Z', '2026-07-02T12:30:00Z', 'scheduled')`,
      [substituteBusySession, ORG, bodySubstituteId]
    );

    const created = await createLeave(uids.tutor, undefined, "2026-07-02", "2026-07-02");
    await request(app).patch(`/api/v1/leave/${created.body.id}`).set(...authHeader(uids.owner)).send({ action: "approve" });

    const res = await request(app).post(`/api/v1/leave/${created.body.id}/reassign`).set(...authHeader(uids.owner)).send({ substituteTutorId: bodySubstituteId });
    expectStatus(res, 200);
    const bySession = Object.fromEntries(res.body.results.map((r: any) => [r.sessionId, r]));
    expect(bySession[freeSlotSession].ok).toBe(true);
    expect(bySession[busySlotSession].ok).toBe(false);
    expect(bySession[busySlotSession].error).toBe("conflict");

    expect((await db.query<any>(`select tutor_id from class_sessions where id = $1`, [freeSlotSession])).rows[0].tutor_id).toBe(bodySubstituteId);
    expect((await db.query<any>(`select tutor_id from class_sessions where id = $1`, [busySlotSession])).rows[0].tutor_id).toBe(uids.tutor);
  });
});
