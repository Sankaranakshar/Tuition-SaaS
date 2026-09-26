import { test, expect } from "@playwright/test";
import { admin, createAuthUser, createOrgWithOwner, createStudent } from "./support/admin";
import { sessionFor, login, expectAccessible, istDate } from "./support/ui";

// Journey 5 (EXECUTION_PLAN.md Step 31): substitute reassignment. Closes Step
// 23's carried gap: "Assign to all" had never been clicked live, because it
// needs a second real tutor in the org, created through the app's own Team
// invite link rather than a backend script. Here the second tutor joins
// exactly that way, the owner takes approved leave, and reassigns their
// session to the new tutor, who then sees it on their own schedule.

const CLASS = "Substitute Physics";

test("substitute reassignment via a tutor who joined through the Team invite link", async ({ browser }) => {
  const org = await createOrgWithOwner("substitute");
  const studentId = await createStudent(org.id, org.owner.id, "Nisha Substitute");
  const sub = await createAuthUser("sub", "Sub Tutor");

  // The owner's session that the leave will cover: a one-on-one three hours out.
  const { data: template } = await admin()
    .from("class_templates")
    .insert({
      organization_id: org.id, tutor_id: org.owner.id, name: CLASS, type: "ONE_ON_ONE",
      pricing_model: "PER_SESSION", fee_amount: 400, capacity: 1, student_ids: [studentId],
    })
    .select("id").single();
  const start = new Date(Date.now() + 3 * 3600_000);
  start.setSeconds(0, 0);
  const { data: session } = await admin()
    .from("class_sessions")
    .insert({
      organization_id: org.id, tutor_id: org.owner.id, template_id: template!.id,
      student_ids: [studentId], student_user_ids: [], parent_user_ids: [],
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 3600_000).toISOString(),
      status: "scheduled",
    })
    .select("id").single();
  const leaveDate = istDate(start);

  // --- Owner: generate a tutor invite link from Settings → Team.
  const owner = await sessionFor(browser, org.owner);
  await owner.page.goto("/app/settings");
  await owner.page.getByRole("tab", { name: "Team" }).click();
  const team = owner.page.getByRole("tabpanel", { name: "Team" });
  await team.getByLabel("Role").selectOption("tutor");
  await owner.page.getByRole("button", { name: "Generate invite link" }).click();
  const link = await team.getByLabel("Invite link", { exact: true }).inputValue();
  expect(link).toMatch(/\/onboarding\?staffInvite=[\w-]+$/);
  await expectAccessible(owner.page, "Settings: Team");

  // --- Second tutor: open the link signed out, sign in, join.
  const subContext = await browser.newContext();
  const subPage = await subContext.newPage();
  const url = new URL(link);
  await subPage.goto(url.pathname + url.search);
  await subPage.waitForURL("**/login");
  await login(subPage, sub);
  await subPage.waitForURL("**/onboarding");
  await expect(subPage.getByText(`This will add you to ${org.name} as`)).toBeVisible();
  await expectAccessible(subPage, "Onboarding: staff invite");
  await subPage.getByRole("button", { name: "Join" }).click();
  await subPage.waitForURL((u) => u.pathname === "/app");

  const { data: membership } = await admin()
    .from("organization_members").select("role").eq("organization_id", org.id).eq("user_id", sub.id).single();
  expect(membership!.role).toBe("tutor");

  // --- Owner: request leave covering the session, approve it, assign the substitute.
  await owner.page.reload();
  await owner.page.getByRole("tab", { name: "Leave" }).click();
  await owner.page.getByLabel("Start date").fill(leaveDate);
  await owner.page.getByLabel("End date").fill(leaveDate);
  await owner.page.getByLabel("Reason (optional)").fill("E2E leave");
  await owner.page.getByRole("button", { name: "Request leave" }).click();
  await expect(owner.page.getByText("Leave requested")).toBeVisible();
  await owner.page.getByRole("button", { name: "Approve" }).click();
  await expect(owner.page.getByText("Leave approved")).toBeVisible();

  await owner.page.getByRole("button", { name: "Find affected sessions" }).click();
  const substitute = owner.page.getByLabel("Substitute");
  await expect(substitute).toBeVisible();
  await substitute.selectOption({ label: "Sub Tutor" });
  await expectAccessible(owner.page, "Settings: Leave, assign substitute");
  await owner.page.getByRole("button", { name: "Assign to all" }).click();
  await expect(owner.page.getByText("Reassigned 1 session(s)")).toBeVisible();

  // --- The session now belongs to the substitute, with an audit trail.
  const { data: after } = await admin().from("class_sessions").select("tutor_id").eq("id", session!.id).single();
  expect(after!.tutor_id).toBe(sub.id);
  const { data: audit } = await admin()
    .from("audit_events").select("action").eq("organization_id", org.id).eq("payload->>entityId", session!.id);
  expect(audit!.map((a) => a.action)).toContain("session.reassign_tutor");

  // --- And the substitute, a tutor-role member, sees it on their own schedule.
  // (Tutor-role views filter to tutor_id = self: the role-vs-organizationRole
  // bug class HANDOFF.md §8 describes would hide it here.)
  // Schedule opens on the current Sunday-to-Saturday week (date-fns
  // startOfWeek); the session is three hours out, so it is either in this
  // week or, late on a Saturday, the next one.
  await subPage.goto("/app/schedule");
  const todayIst = istDate();
  const weekdayIst = new Date(`${todayIst}T12:00:00Z`).getUTCDay();
  const nextWeekStartIst = new Date(Date.parse(`${todayIst}T12:00:00Z`) + (7 - weekdayIst) * 86400_000).toISOString().slice(0, 10);
  if (leaveDate >= nextWeekStartIst) await subPage.getByRole("button", { name: "Next week" }).click();
  await expect(subPage.getByText(CLASS).first()).toBeVisible();
  await expectAccessible(subPage, "Schedule (tutor role)");

  await owner.context.close();
  await subContext.close();
});
