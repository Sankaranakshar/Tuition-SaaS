import { test, expect, type Page } from "@playwright/test";
import { admin, createOrgWithOwner, createCourse, createStudent, type TestOrg } from "./support/admin";
import { sessionFor, callApiAsPage, expectAccessible, istDate } from "./support/ui";

// Journeys 2 and 3 (EXECUTION_PLAN.md Step 31), one serial file because 3
// reverses exactly what 2 created.
//
// 2. Book to attendance to invoice: create a recurring class in the Add Class
//    wizard, materialize, mark attendance on Today, confirm the invoice
//    accrues and Money's Outstanding moves.
// 3. Reverse: un-mark that attendance, confirm wallet, invoice and ledger all
//    agree afterwards, and that a second reverse 409s.

test.describe.configure({ mode: "serial" });

const STUDENT = "Rhea Money";
const COURSE = "Grade 10 Mathematics";
const FEE_RUPEES = 500;

let org: TestOrg;
let studentId: string;
let sessionId: string;
let page: Page;

test.beforeAll(async ({ browser }) => {
  org = await createOrgWithOwner("money");
  await createCourse(org.id, COURSE);
  studentId = await createStudent(org.id, org.owner.id, STUDENT);
  ({ page } = await sessionFor(browser, org.owner));
});

test.afterAll(async () => {
  await page?.context().close();
});

/** Money → Outstanding: "All settled", or the student's payer group showing `amount`. */
async function expectOutstanding(student: string, amount: string | null): Promise<void> {
  await page.goto("/app/money");
  if (amount === null) {
    await expect(page.getByText("All settled")).toBeVisible();
    await expect(page.getByText(student, { exact: true })).toHaveCount(0);
    return;
  }
  const header = page.locator("div.bg-\\[var\\(--cs-surface-2\\)\\]").filter({ has: page.getByText(student, { exact: true }) });
  await expect(header).toContainText(amount);
}

test("journey 2: recurring class, attendance, invoice, Outstanding moves", async () => {
  await expectOutstanding(STUDENT, null);
  await expectAccessible(page, "Money (all settled)");

  // --- Create a recurring batch class through the Add Class wizard.
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "Add Class" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByText("Batch / Group").click();
  await wizard.getByRole("button", { name: "Continue" }).click();

  await wizard.getByLabel("Course").selectOption({ label: COURSE });
  await wizard.getByLabel("Max Capacity").fill("5");
  await wizard.getByLabel("Pricing Model").selectOption({ label: "Per Session" });
  await wizard.getByLabel("Fee Amount (₹)").fill(String(FEE_RUPEES));
  // Every day of the week, so there is always a session within the next 24h.
  const days = wizard.getByRole("button", { name: /^[SMTWF]$/ });
  await expect(days).toHaveCount(7);
  for (let i = 0; i < 7; i++) await days.nth(i).click();
  await wizard.getByLabel("Start Date").fill(istDate());
  await wizard.getByLabel("Start Time").fill("20:00");
  await wizard.getByLabel("Duration (mins)").selectOption({ label: "60 mins" });
  await wizard.getByRole("checkbox", { name: STUDENT }).check();
  await expectAccessible(page, "Schedule: Add Class wizard");
  await wizard.getByRole("button", { name: "Create Class" }).click();
  await expect(page.getByText("Class created")).toBeVisible();

  // --- Materialized: future sessions, all carrying the student.
  const { data: template } = await admin()
    .from("class_templates").select("id, pricing_model, fee_amount, days_of_week")
    .eq("organization_id", org.id).single();
  expect(template!.pricing_model).toBe("PER_SESSION");
  expect(Number(template!.fee_amount)).toBe(FEE_RUPEES);
  expect([...template!.days_of_week].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);

  const { data: sessions } = await admin()
    .from("class_sessions").select("id, start_time, end_time, student_ids, status")
    .eq("template_id", template!.id).order("start_time");
  expect(sessions!.length).toBeGreaterThanOrEqual(7);
  for (const s of sessions!) expect(s.student_ids).toEqual([studentId]);
  const soonest = sessions![0];
  expect(new Date(soonest.start_time).getTime() - Date.now()).toBeLessThan(24 * 3600 * 1000);

  // --- Class time arrives. The server (rightly) refuses attendance before a
  // session starts, and materialize never creates past sessions, so the one
  // step a test cannot wait out in real time is simulated: move the soonest
  // session to have started five minutes ago (never before IST midnight, so
  // it stays on today's Today view). Nothing else about it changes.
  const now = Date.now();
  const istMidnight = new Date(`${istDate()}T00:00:00+05:30`).getTime();
  const start = Math.max(now - 5 * 60_000, istMidnight + 1_000);
  sessionId = soonest.id;
  const { error: shiftErr } = await admin()
    .from("class_sessions")
    .update({ start_time: new Date(start).toISOString(), end_time: new Date(start + 60 * 60_000).toISOString() })
    .eq("id", sessionId);
  expect(shiftErr).toBeNull();

  // --- Mark attendance on Today: roster popover, all present, confirm.
  await page.goto("/app");
  await page.getByRole("button", { name: "Mark", exact: true }).click();
  await expect(page.getByText("Mark attendance").first()).toBeVisible();
  await expectAccessible(page, "Today: attendance popover");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Marked · 1/1 present")).toBeVisible();

  // The write is deferred five seconds so Undo can cancel it; wait for it.
  await expect
    .poll(async () => {
      const { data } = await admin().from("attendance_records").select("status, billed").eq("session_id", sessionId);
      return data;
    }, { timeout: 20_000 })
    .toEqual([{ status: "present", billed: true }]);

  // --- The invoice accrued, and Outstanding moved from nothing to the fee.
  const { data: invoices } = await admin()
    .from("invoices").select("id, status, total_paise, paid_paise, source")
    .eq("student_id", studentId);
  expect(invoices).toHaveLength(1);
  expect(invoices![0].total_paise).toBe(FEE_RUPEES * 100);
  expect(invoices![0].paid_paise ?? 0).toBe(0);
  expect((invoices![0].source as any)?.sessionId).toBe(sessionId);
  expect(["draft", "sent", "unpaid"]).toContain(invoices![0].status);

  await expectOutstanding(STUDENT, "₹500");
  await expectAccessible(page, "Money (outstanding)");

  // The student's story shows the class they just attended.
  await page.goto(`/app/students/${studentId}`);
  await expect(page.getByRole("heading", { name: STUDENT })).toBeVisible();
  await expectAccessible(page, "Student Story (staff)");
});

test("journey 3: reverse attendance; wallet, invoice and ledger agree; second reverse 409s", async () => {
  // The app has no reversal UI yet (the route shipped in R1 without one, see
  // HANDOFF.md §9's 2026-08-06 entry), so this calls the real route through
  // the signed-in page's own session, as every earlier live check did.
  const first = await callApiAsPage<{ reversalPath: string }>(page, "/billing/attendance/reverse", {
    sessionId, studentId, reason: "cancellation",
  });
  expect(first.status).toBe(201);
  expect(first.body.reversalPath).toBe("invoice_voided");

  // Invoice voided, attendance flagged reversed.
  const { data: invoice } = await admin().from("invoices").select("id, status").eq("student_id", studentId).single();
  expect(invoice!.status).toBe("void");
  const { data: record } = await admin().from("attendance_records").select("reversed_at").eq("session_id", sessionId).single();
  expect(record!.reversed_at).not.toBeNull();

  // Ledger: one zero-delta reversal row pointing at the voided invoice, and
  // no wallet balance moved, so any wallet still equals its ledger sum (B-03).
  const { data: ledger } = await admin()
    .from("wallet_ledger").select("type, credits, paise, invoice_id, session_id").eq("student_id", studentId);
  expect(ledger).toEqual([{ type: "credit_reversal", credits: 0, paise: 0, invoice_id: invoice!.id, session_id: sessionId }]);
  const { data: wallets } = await admin()
    .from("wallets").select("balance_credits, balance_currency").eq("student_id", studentId);
  for (const w of wallets ?? []) {
    expect(Number(w.balance_credits)).toBe(ledger!.reduce((sum, l) => sum + Number(l.credits), 0));
  }

  // Outstanding is back to nothing in the running app.
  await expectOutstanding(STUDENT, null);

  // The audit log shows the mark and the reversal, in the app.
  await page.goto("/app/audit-log");
  await expect(page.getByText("attendance.reverse").first()).toBeVisible();
  await expect(page.getByText("attendance.mark").first()).toBeVisible();
  await expectAccessible(page, "Audit log");

  // A second reverse is refused.
  const second = await callApiAsPage<{ error: { code: string } }>(page, "/billing/attendance/reverse", {
    sessionId, studentId, reason: "cancellation",
  });
  expect(second.status).toBe(409);
  expect(second.body.error.code).toBe("already_reversed");
});
