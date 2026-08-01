// k6 load test — old Epic 17.1 / DEV_PLAN §5/§9's "Monday-6pm attendance
// burst" scenario: the busiest real moment in this app's usage pattern is
// evening class time, when several tutors are marking attendance (which
// also accrues billing — wallet debit or invoice creation, server-authoritative
// transactions with row locks) inside a narrow window while everyone else's
// Today workspace keeps polling/reading. Target from DEV_PLAN: p95 API
// latency < 400ms at ~5x pilot volume. (Today-interactive-<2s-on-Android is
// a client perf metric, not something k6 measures — that's a manual/Lighthouse
// check, not in scope here.)
//
// Run:
//   BASE_URL=http://localhost:3100 k6 run tests/load/attendance-burst.js
//
// Scenarios (pick with SCENARIO=<name>, default "smoke"):
//   smoke             — 2 VUs, 10s, read-only. Safe against any environment,
//                        including a live production database — this is what
//                        CI or a "does the script still work" check should run.
//   read_burst        — ramps to READ_VUS (default 25) for READ_DURATION
//                        (default 2m) against read-only endpoints
//                        (/api/health, GET /api/v1/subscription). Still safe
//                        against production: no writes, bounded duration.
//   attendance_burst  — the real Epic 17.1 scenario: ramps to WRITE_VUS
//                        (default 15) marking real attendance, which creates
//                        real wallet-ledger/invoice rows through the actual
//                        money-transaction path. DO NOT point this at a real
//                        org's production data — it needs a disposable/seeded
//                        test org (see setup() below) whose rows are fine to
//                        throw away, and needs sign-off before running against
//                        any environment that isn't a local/staging DB you
//                        control. Run 2026-08-01 with founder sign-off against
//                        the seeded demo org: p95 79-101ms across three runs,
//                        well under the 400ms target, one real invoice created,
//                        no duplicate under 15 concurrent VUs. See DEV_PLAN §2.1.
//
// Auth: setup() does one real password-grant login (GoTrue's
// /auth/v1/token?grant_type=password) against SUPABASE_URL using
// DEMO_EMAIL/DEMO_PASSWORD (defaults to the seeded demo tutor from
// scripts/seed.ts — scripts/seed.ts's password is a fixture, not a real
// secret, but override via env vars for anything other than that fixture
// account). The resulting access token is reused by every VU — one login,
// not one per VU, so the load test measures the app's API, not GoTrue's.
// Caveat: because every VU shares that one token, the server's per-user rate
// limiter (120 req/min, server/app.ts) caps sustained attendance_burst
// throughput after ~10-15s — this tests one token under concurrent
// connections, not truly independent concurrent tutors. A multi-tutor-
// faithful version would need setup() to log in as several demo accounts.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const SUPABASE_URL = __ENV.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "";
const DEMO_EMAIL = __ENV.DEMO_EMAIL || "demo.tutor@classstackr.dev";
const DEMO_PASSWORD = __ENV.DEMO_PASSWORD || "ClassStackrDemo2026!";
const SCENARIO = __ENV.SCENARIO || "smoke";

const READ_VUS = Number(__ENV.READ_VUS || 25);
const READ_DURATION = __ENV.READ_DURATION || "2m";
const WRITE_VUS = Number(__ENV.WRITE_VUS || 15);
const WRITE_DURATION = __ENV.WRITE_DURATION || "1m";

const attendanceLatency = new Trend("attendance_mark_duration", true);
const todayReadLatency = new Trend("today_read_duration", true);

const SCENARIOS = {
  smoke: {
    executor: "constant-vus",
    vus: 2,
    duration: "10s",
    exec: "readOnly",
  },
  read_burst: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "30s", target: READ_VUS },
      { duration: READ_DURATION, target: READ_VUS },
      { duration: "15s", target: 0 },
    ],
    exec: "readOnly",
  },
  attendance_burst: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "20s", target: WRITE_VUS },
      { duration: WRITE_DURATION, target: WRITE_VUS },
      { duration: "10s", target: 0 },
    ],
    exec: "attendanceBurst",
  },
};

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] },
  thresholds: {
    http_req_duration: ["p(95)<400"], // DEV_PLAN §5's own target
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
      "SUPABASE_URL / SUPABASE_ANON_KEY not set — falling back to unauthenticated requests. " +
        "Endpoints that require a token will correctly 401 rather than reflect real logged-in-user latency."
    );
    return { token: null };
  }
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    { headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY } }
  );
  if (res.status !== 200) {
    throw new Error(`setup() login failed: ${res.status} ${res.body}`);
  }
  return { token: res.json("access_token") };
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

// Read-only: /api/health (always safe) + a cheap authenticated read
// (subscription status — one row, no joins across the busy tables). This is
// the load pattern of "everyone else's Today workspace" during the burst
// window, without ever writing.
export function readOnly(data) {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health 200": (r) => r.status === 200 });

  if (data.token) {
    const res = http.get(`${BASE_URL}/api/v1/subscription`, { headers: authHeaders(data.token) });
    todayReadLatency.add(res.timings.duration);
    check(res, { "subscription 200 or 403": (r) => r.status === 200 || r.status === 403 });
  }
  sleep(1);
}

// The real attendance-burst write path. Requires `data.token` to belong to a
// tutor in a real org with at least one real, currently-scheduled session id
// supplied via SESSION_ID/STUDENT_ID env vars — there is no safe generic
// default here (unlike readOnly, which degrades to 401 gracefully with no
// token). See this file's header: don't point this at production data.
export function attendanceBurst(data) {
  if (!data.token) throw new Error("attendanceBurst needs a real token — set SUPABASE_URL/SUPABASE_ANON_KEY");
  const sessionId = __ENV.SESSION_ID;
  const studentId = __ENV.STUDENT_ID;
  if (!sessionId || !studentId) {
    throw new Error("attendanceBurst needs SESSION_ID and STUDENT_ID env vars pointing at real, disposable test-org rows");
  }
  const res = http.post(
    `${BASE_URL}/api/v1/billing/attendance`,
    JSON.stringify({ sessionId, records: [{ studentId, status: "present" }] }),
    { headers: authHeaders(data.token) }
  );
  attendanceLatency.add(res.timings.duration);
  check(res, { "attendance 200 or 422 (already marked)": (r) => r.status === 200 || r.status === 422 });
  sleep(1);
}
