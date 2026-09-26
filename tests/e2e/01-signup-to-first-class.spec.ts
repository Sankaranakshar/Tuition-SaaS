import { test, expect, type Page } from "@playwright/test";
import { admin, createAuthUser, type TestUser } from "./support/admin";
import { runOrgPrefix } from "./support/env";
import { login, expectAccessible } from "./support/ui";
import { whenAnalyticsMigrated, eventuallyEvents, productEvents } from "./support/analytics";

// Journey 1 (EXECUTION_PLAN.md Step 31): signup to first class. Onboarding's
// three beats (solo-or-centre, first class from the template gallery, first
// students), through to a real org, class template, materialized sessions and
// student, for both the solo and the centre path.
//
// The account is created confirmed via the Admin API (support/admin.ts's
// createAuthUser explains why); from the first login on, it is all UI.

async function walkOnboarding(
  page: Page,
  user: TestUser,
  opts: { centreName?: string; className: string; students: string[] },
): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await expectAccessible(page, "Login (email tab)");
  await login(page, user);
  // A brand-new account has no profile; the app creates an incomplete one and
  // routes to onboarding.
  await page.waitForURL("**/onboarding");
  await expect(page.getByRole("heading", { name: "Let's get your first class booked" })).toBeVisible();
  await expectAccessible(page, "Onboarding beat 1");

  // Beat 1: solo or centre.
  if (opts.centreName) {
    await page.getByRole("button", { name: /A center/ }).click();
    await page.getByPlaceholder("e.g. Bright Minds Tutoring").fill(opts.centreName);
    await page.getByRole("button", { name: "Continue" }).click();
  } else {
    await page.getByRole("button", { name: /Just me/ }).click();
  }

  // Beat 2: first class. Weekday evenings (Mon/Wed/Fri) is the default preset.
  await expect(page.getByRole("heading", { name: "Create your first class" })).toBeVisible();
  await page.getByRole("button", { name: "Weekday evenings (Mon/Wed/Fri)" }).click();
  await page.getByPlaceholder("Class 10 Maths batch").fill(opts.className);
  await page.getByRole("button", { name: "Continue" }).click();

  // Beat 3: first students.
  await expect(page.getByRole("heading", { name: "Add your first students" })).toBeVisible();
  const nameInputs = page.getByPlaceholder("Student name");
  for (const [i, name] of opts.students.entries()) await nameInputs.nth(i).fill(name);
  await page.getByRole("button", { name: "Create my class" }).click();

  await page.waitForURL((url) => url.pathname === "/app");
}

async function expectFirstClassLanded(page: Page, user: TestUser, orgName: string, className: string, students: string[]): Promise<string> {
  // What the database says: one org owned by this user, named as chosen, with
  // the class template, its enrolled students, and future sessions.
  const { data: membership } = await admin()
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user.id)
    .single();
  expect(membership?.role).toBe("owner");
  expect((membership as any)?.organizations?.name).toBe(orgName);
  const orgId = membership!.organization_id as string;

  const { data: templates } = await admin().from("class_templates").select("id, name, type, days_of_week").eq("organization_id", orgId);
  expect(templates).toHaveLength(1);
  expect(templates![0].name).toBe(className);

  const { data: sessions } = await admin()
    .from("class_sessions")
    .select("id, start_time, student_ids, tutor_id, status")
    .eq("organization_id", orgId)
    .eq("template_id", templates![0].id);
  expect(sessions!.length).toBeGreaterThan(0);
  for (const s of sessions!) {
    expect(s.tutor_id).toBe(user.id);
    expect(s.student_ids).toHaveLength(students.length);
    expect(new Date(s.start_time).getTime()).toBeGreaterThan(Date.now() - 60_000);
  }

  // The weekday-evenings preset is Mon/Wed/Fri at 16:00 IST (onboarding's
  // default start time): every session must land on one of those days, at
  // that wall-clock time in the org's zone (Step 25's timezone fix).
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  for (const s of sessions!) {
    const parts = fmt.formatToParts(new Date(s.start_time));
    const part = (t: string) => parts.find((p) => p.type === t)?.value;
    expect(["Mon", "Wed", "Fri"]).toContain(part("weekday"));
    expect(`${part("hour")}:${part("minute")}`).toBe("16:00");
  }

  // What the owner sees: Today renders for an owner, the students are on
  // People, and the class is on next week's Schedule (next week always has
  // all three weekday sessions, whatever day this runs).
  await expect(page.getByRole("main")).toBeVisible();
  await expectAccessible(page, "Today (owner, fresh org)");

  await page.goto("/app/people");
  for (const name of students) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expectAccessible(page, "People");

  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.getByText(className).first()).toBeVisible();
  await expectAccessible(page, "Schedule");
  return orgId;
}

// Step 32 (C-07): the funnel's first beats. Each onboarding beat reported
// itself before the org existed (so no org on those rows), the final submit
// created the org (org.created, attributed to this person) and filled the
// first sessions, and the workspaces just visited count as feature usage.
// No row carries a student's name.
async function expectOnboardingEvents(user: TestUser, orgId: string, mode: "solo" | "center", students: string[]) {
  await whenAnalyticsMigrated("journey 1 product events", async () => {
    const beats = await eventuallyEvents({ actorUserId: user.id, name: "onboarding.beat_viewed" }, 3);
    expect(beats.map((b) => b.properties.beat).sort()).toEqual([1, 2, 3]);
    expect(beats.every((b) => b.organization_id === null)).toBe(true);
    expect(beats.filter((b) => b.properties.beat !== 1).every((b) => b.properties.mode === mode)).toBe(true);

    const created = await productEvents({ organizationId: orgId, name: "org.created" });
    expect(created).toHaveLength(1);
    expect(created[0].actor_user_id).toBe(user.id);

    const materialized = await productEvents({ organizationId: orgId, name: "sessions.materialized" });
    expect(materialized.length).toBeGreaterThanOrEqual(1);
    expect(materialized[0].properties.sessionsCreated as number).toBeGreaterThan(0);

    const features = await eventuallyEvents({ organizationId: orgId, name: "feature.opened" }, 3);
    expect(new Set(features.map((f) => f.properties.feature))).toEqual(new Set(["today", "people", "schedule"]));

    const all = JSON.stringify([...beats, ...(await productEvents({ organizationId: orgId }))]);
    for (const name of students) expect(all).not.toContain(name);
  });
}

test("solo tutor: signup to first class", async ({ page }) => {
  const name = `${runOrgPrefix()}solo`;
  const user = await createAuthUser("solo", name);
  const className = "Class 10 Maths batch (solo)";
  const students = ["Anaya Solo", "Kabir Solo"];

  await walkOnboarding(page, user, { className, students });
  // The solo path names the org after the person (lib/onboarding.ts defaultOrgName).
  const orgId = await expectFirstClassLanded(page, user, `${name}'s Tutoring`, className, students);
  await expectOnboardingEvents(user, orgId, "solo", students);
});

test("centre owner: signup to first class", async ({ page }) => {
  const user = await createAuthUser("centre", "Centre Owner");
  const centreName = `${runOrgPrefix()}Bright Minds`;
  const className = "Class 9 Science batch (centre)";
  const students = ["Ishaan Centre"];

  await walkOnboarding(page, user, { centreName, className, students });
  const orgId = await expectFirstClassLanded(page, user, centreName, className, students);
  await expectOnboardingEvents(user, orgId, "center", students);
});
