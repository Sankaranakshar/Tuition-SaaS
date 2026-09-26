import { test, expect } from "@playwright/test";
import { admin, createOrgWithOwner } from "./support/admin";
import { sessionFor, expectAccessible } from "./support/ui";
import { whenAnalyticsMigrated } from "./support/analytics";

// Step 32 (C-07): the platform admin console's new Analytics tab, where
// rupees collected per org per month is visible without a manual query.
// A run-scoped owner is made a platform admin for the length of the run (the
// platform_admins row cascades away with the user at teardown). The
// Organizations tab needs nothing new and is audited on every run; the
// Analytics tab reads Step 32's tables, so it is audited once staging has
// them (see support/analytics.ts).

test("platform admin: Organizations and Analytics tabs render and pass axe", async ({ browser }) => {
  const org = await createOrgWithOwner("analytics");
  const { error } = await admin().from("platform_admins").insert({ user_id: org.owner.id, note: "e2e run, removed at teardown" });
  expect(error).toBeNull();
  const { page } = await sessionFor(browser, org.owner);

  await page.goto("/app/platform-admin");
  await expect(page.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Organizations" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("cell", { name: org.name, exact: true })).toBeVisible();
  await expectAccessible(page, "Platform admin: Organizations");

  await whenAnalyticsMigrated("Platform admin Analytics tab", async () => {
    await page.getByRole("tab", { name: "Analytics" }).click();
    await expect(page.getByRole("heading", { name: "Rupees collected per org per month" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Signup to activation funnel" })).toBeVisible();
    // This run's org is listed with its (empty) money row and its activation window.
    const monthly = page.getByRole("table", { name: "Rupees collected per organization per month" });
    await expect(monthly.getByRole("cell", { name: org.name, exact: true })).toBeVisible();
    await expectAccessible(page, "Platform admin: Analytics");
  });

  await page.context().close();
});
