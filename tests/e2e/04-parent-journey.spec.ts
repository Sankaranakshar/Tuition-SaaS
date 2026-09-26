import { test, expect } from "@playwright/test";
import { admin, createAuthUser, createOrgWithOwner, createStudent } from "./support/admin";
import { sessionFor, login, expectAccessible } from "./support/ui";

// Journey 4 (EXECUTION_PLAN.md Step 31): parent journey. Staff raise an
// invoice and generate a parent invite link from People; a brand-new parent
// opens the link signed out, signs in, consents, lands in the portal and sees
// the invoice.

const STUDENT = "Aarav Parentjourney";
const INVOICE_RUPEES = 1200;

test("parent journey: invite redeem, consent, portal, see the invoice", async ({ browser }) => {
  const org = await createOrgWithOwner("parent");
  const studentId = await createStudent(org.id, org.owner.id, STUDENT, { parent_name: "Parent Journey" });
  const parent = await createAuthUser("parent", "Parent Journey");

  // --- Staff: raise an invoice from the student's row, then generate the invite.
  const staff = await sessionFor(browser, org.owner);
  await staff.page.goto("/app/people");
  const row = staff.page.locator("div.flex.items-center.gap-2.pl-3").filter({ hasText: STUDENT });
  await row.getByTitle("Invoice").click();
  const invoiceModal = staff.page.getByRole("dialog");
  await expect(invoiceModal.getByLabel("Student")).toHaveValue(studentId);
  await invoiceModal.getByPlaceholder("Description").fill("September tuition");
  await invoiceModal.getByPlaceholder("₹").fill(String(INVOICE_RUPEES));
  await expectAccessible(staff.page, "Money: new invoice");
  await invoiceModal.getByRole("button", { name: /generate|create|save/i }).last().click();
  await expect(invoiceModal).toBeHidden();

  const { data: invoices } = await admin().from("invoices").select("id, total_paise, status").eq("student_id", studentId);
  expect(invoices).toHaveLength(1);
  expect(invoices![0].total_paise).toBe(INVOICE_RUPEES * 100);

  await staff.page.goto("/app/people");
  await row.getByTitle("Invite").click();
  const inviteModal = staff.page.getByRole("dialog");
  const parentSection = inviteModal.locator("div.rounded-\\[var\\(--cs-radius-container\\)\\]").filter({ hasText: "Parent Portal Access" });
  await parentSection.getByRole("button", { name: "Generate link" }).click();
  const link = await parentSection.getByLabel("Invite link", { exact: true }).inputValue();
  expect(link).toMatch(/\/onboarding\?invite=[\w-]+$/);
  await expectAccessible(staff.page, "People: invite modal");
  await staff.context.close();

  // --- Parent: open the link signed out, sign in, consent, link.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(new URL(link).pathname + new URL(link).search);
  await page.waitForURL("**/login");
  await login(page, parent);
  await page.waitForURL("**/onboarding");
  await expect(page.getByText(`This will link your account to ${STUDENT} at ${org.name}.`)).toBeVisible();
  const linkButton = page.getByRole("button", { name: "Link account" });
  await expect(linkButton).toBeDisabled();
  await expectAccessible(page, "Onboarding: parent invite");
  await page.getByRole("checkbox", { name: /I consent to my child's attendance/ }).check();
  await linkButton.click();
  await page.waitForURL((url) => url.pathname === "/app");

  // --- Portal: the child, the outstanding amount, and the invoice itself.
  await expect(page.getByText(STUDENT).first()).toBeVisible();
  // The Outstanding tile rounds to whole rupees ("₹1,200"); lists show paise.
  await expect(page.getByText(/^₹1,200(\.00)?$/).first()).toBeVisible();
  await expectAccessible(page, "Parent portal: overview");
  await page.getByRole("button", { name: "Invoices" }).click();
  await expect(page.getByText(/₹1,200(\.00)?/).first()).toBeVisible();
  await expect(page.getByText("September tuition").first()).toBeVisible();
  await expectAccessible(page, "Parent portal: invoices");

  // --- What the redeem wrote: a parent membership, the link, and the consent record.
  const { data: member } = await admin()
    .from("organization_members").select("role").eq("organization_id", org.id).eq("user_id", parent.id).single();
  expect(member!.role).toBe("parent");
  const { data: links } = await admin().from("parent_links").select("student_id").eq("parent_user_id", parent.id);
  expect(links).toEqual([{ student_id: studentId }]);
  const { data: consent } = await admin().from("consent_records").select("id").eq("user_id", parent.id);
  expect(consent!.length).toBeGreaterThan(0);

  await context.close();
});
