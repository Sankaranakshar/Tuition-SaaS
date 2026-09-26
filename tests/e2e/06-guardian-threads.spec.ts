import { test, expect, type Page } from "@playwright/test";
import {
  admin, createOrgWithOwner, createStudent, createPersonWithProfile, linkStudentAccount, linkParent,
} from "./support/admin";
import { sessionFor, expectAccessible } from "./support/ui";

// Journey 6 (EXECUTION_PLAN.md Step 31): Step 30's D-06 guardian-visible
// threads, live since 2026-09-26, asserted as a sixth journey rather than
// folded into journey 4 so a failure names the rule that broke. A tutor DMs a
// student; the student's parent sees the thread with the "Parent view" tag,
// the disclosure banner and a read-only footer (no composer); the parent's New
// Message picker offers their child's tutor and a parent-to-tutor DM sends;
// a parent of a different child in the same org sees none of it.

const CHILD = "Meera Guardian";
const OTHER_CHILD = "Dev Otherchild";
const TUTOR_MESSAGE = "Hello Meera, homework is chapter 4.";
const PARENT_MESSAGE = "Thanks, we will finish chapter 4 tonight.";

async function openInbox(page: Page) {
  await page.goto("/app/inbox");
  await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
}

async function send(page: Page, body: string) {
  await page.getByPlaceholder("Write a message…").fill(body);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(body).last()).toBeVisible();
}

test("guardian-visible threads: parent reads, cannot reply, can message the tutor; unrelated parent sees nothing", async ({ browser }) => {
  const org = await createOrgWithOwner("guardian");
  const childId = await createStudent(org.id, org.owner.id, CHILD);
  const otherChildId = await createStudent(org.id, org.owner.id, OTHER_CHILD);
  const student = await createPersonWithProfile("guardian-student", CHILD, "student");
  await linkStudentAccount(org.id, childId, student);
  const parent = await createPersonWithProfile("guardian-parent", "Meera's Parent", "parent");
  await linkParent(org.id, childId, parent);
  const otherParent = await createPersonWithProfile("guardian-other", "Other Parent", "parent");
  await linkParent(org.id, otherChildId, otherParent);

  // --- Tutor (the org owner, who teaches Meera) starts a DM with the student.
  const tutor = await sessionFor(browser, org.owner);
  await openInbox(tutor.page);
  await tutor.page.getByRole("button", { name: "New message" }).click();
  const picker = tutor.page.getByRole("dialog");
  const studentContact = picker.getByRole("button", { name: new RegExp(CHILD) }).filter({ hasText: "Their parent or guardian can read these messages" });
  await expect(studentContact).toBeVisible();
  await expectAccessible(tutor.page, "Inbox: new message picker (staff)");
  await studentContact.click();
  await expect(tutor.page.getByText(`${CHILD}'s parent or guardian can read every message in this conversation.`)).toBeVisible();
  await send(tutor.page, TUTOR_MESSAGE);
  await expectAccessible(tutor.page, "Inbox: tutor-student thread (staff)");

  // The database anchored the thread to the child (Step 30's trigger).
  const { data: dm } = await admin()
    .from("conversations").select("id, student_id, participant_ids")
    .eq("organization_id", org.id).contains("participant_ids", [org.owner.id, student.id]).single();
  expect(dm!.student_id).toBe(childId);

  // --- Student sees the thread and their own disclosure.
  const studentSession = await sessionFor(browser, student);
  await expect(studentSession.page.getByText(CHILD).first()).toBeVisible();
  await expectAccessible(studentSession.page, "Student dashboard");
  await openInbox(studentSession.page);
  await studentSession.page.getByText(TUTOR_MESSAGE).first().click();
  await expect(studentSession.page.getByText("Your parent or guardian can read every message in this conversation.")).toBeVisible();
  await expectAccessible(studentSession.page, "Inbox: thread (student)");
  await studentSession.context.close();

  // --- Parent: the thread is listed with the "Parent view" tag; opening it
  // shows the explanation and a read-only footer instead of a composer.
  const parentSession = await sessionFor(browser, parent);
  const p = parentSession.page;
  await openInbox(p);
  const row = p.getByRole("button").filter({ hasText: TUTOR_MESSAGE });
  await expect(row.getByText("Parent view")).toBeVisible();
  await row.click();
  await expect(p.getByText(`You can read this conversation because it involves ${CHILD}.`, { exact: false })).toBeVisible();
  await expect(p.getByText("Read only. Parents can see this conversation but can't reply here.")).toBeVisible();
  await expect(p.getByPlaceholder("Write a message…")).toHaveCount(0);
  await expectAccessible(p, "Inbox: guardian view (parent)");

  // --- Parent's picker offers Meera's tutor; a parent-to-tutor DM sends.
  await p.getByRole("button", { name: "New message" }).click();
  const parentPicker = p.getByRole("dialog");
  const tutorContact = parentPicker.getByRole("button", { name: new RegExp(org.owner.name) });
  await expect(tutorContact).toHaveCount(1);
  await expect(tutorContact).toContainText(CHILD);
  await expect(parentPicker.getByText(OTHER_CHILD)).toHaveCount(0);
  await expectAccessible(p, "Inbox: new message picker (parent)");
  await tutorContact.click();
  await expect(p.getByText("Read only.", { exact: false })).toHaveCount(0);
  await send(p, PARENT_MESSAGE);

  const { data: parentDm } = await admin()
    .from("conversations").select("student_id, participant_ids")
    .eq("organization_id", org.id).contains("participant_ids", [parent.id, org.owner.id]).single();
  expect(parentDm!.student_id).toBeNull();
  await parentSession.context.close();

  // --- The parent of a different child sees neither thread, and is offered
  // only their own child's tutor.
  const other = await sessionFor(browser, otherParent);
  await openInbox(other.page);
  await expect(other.page.getByText(TUTOR_MESSAGE)).toHaveCount(0);
  await expect(other.page.getByText(PARENT_MESSAGE)).toHaveCount(0);
  await expect(other.page.getByText("Parent view")).toHaveCount(0);
  await other.page.getByRole("button", { name: "New message" }).click();
  const otherPicker = other.page.getByRole("dialog");
  await expect(otherPicker.getByRole("button", { name: new RegExp(org.owner.name) })).toContainText(OTHER_CHILD);
  await expect(otherPicker.getByText(CHILD)).toHaveCount(0);
  await other.context.close();

  // --- And the tutor receives the parent's message.
  await openInbox(tutor.page);
  await expect(tutor.page.getByText(PARENT_MESSAGE).first()).toBeVisible();
  await tutor.context.close();
});
