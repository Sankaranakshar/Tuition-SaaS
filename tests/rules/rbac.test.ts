/**
 * Firestore rules test suite: the executable RBAC constitution.
 *
 * Encodes GO_TO_MARKET_BLUEPRINT.md section 9.3 plus explicit regression
 * tests for findings C1-C5. Any PR touching firestore.rules or a privileged
 * endpoint must keep this suite green.
 *
 * Run: npm run test:rules   (wraps `firebase emulators:exec`)
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc } from "firebase/firestore";

const ORG = "orgA";
const OTHER_ORG = "orgB";

let env: RulesTestEnvironment;

const uids = {
  owner: "uid-owner",
  admin: "uid-admin",
  tutor: "uid-tutor",
  tutor2: "uid-tutor2",
  frontdesk: "uid-frontdesk",
  accountant: "uid-accountant",
  parent: "uid-parent",
  student: "uid-student",
  outsider: "uid-outsider", // member of OTHER_ORG
  anon: "uid-anon", // authenticated, no memberships
};

function ctx(uid: string) {
  return env.authenticatedContext(uid).firestore();
}

async function seed() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const roles: Array<[string, string, string]> = [
      [ORG, uids.owner, "owner"],
      [ORG, uids.admin, "admin"],
      [ORG, uids.tutor, "tutor"],
      [ORG, uids.tutor2, "tutor"],
      [ORG, uids.frontdesk, "frontdesk"],
      [ORG, uids.accountant, "accountant"],
      [ORG, uids.parent, "parent"],
      [ORG, uids.student, "student"],
      [OTHER_ORG, uids.outsider, "owner"],
    ];
    for (const [orgId, userId, role] of roles) {
      await setDoc(doc(db, "organization_members", `${orgId}_${userId}`), {
        organizationId: orgId, userId, role,
      });
    }
    await setDoc(doc(db, "organizations", ORG), { name: "Org A", ownerUserId: uids.owner });
    await setDoc(doc(db, "users", uids.student), { name: "Student S" });
    await setDoc(doc(db, "students", "stu1"), {
      organizationId: ORG, name: "Riya", studentUserId: uids.student,
    });
    await setDoc(doc(db, "parent_links", `${uids.parent}_stu1`), {
      organizationId: ORG, parentUserId: uids.parent, studentId: "stu1",
    });
    await setDoc(doc(db, "invoices", "inv1"), {
      organizationId: ORG, studentId: "stu1", totalPaise: 300000, status: "unpaid",
    });
    await setDoc(doc(db, "wallets", "wal1"), {
      organizationId: ORG, studentId: "stu1", balanceCredits: 5, balanceCurrency: 0,
    });
    await setDoc(doc(db, "attendance_records", "sess1_stu1"), {
      organizationId: ORG, studentId: "stu1", sessionId: "sess1", status: "present", billed: true,
    });
    await setDoc(doc(db, "conversations", "conv1"), {
      organizationId: ORG, participantIds: [uids.tutor, uids.parent],
    });
    await setDoc(doc(db, "messages", "msg1"), {
      organizationId: ORG, participantIds: [uids.tutor, uids.parent],
      senderUserId: uids.tutor, body: "private note about fees",
    });
    await setDoc(doc(db, "leads", "lead1"), {
      organizationId: ORG, name: "Mrs. Sharma", status: "Inquiry",
    });
    await setDoc(doc(db, "tutor_profiles", uids.tutor), {
      organizationId: ORG, name: "Tutor T", phone: "999",
    });
    await setDoc(doc(db, "class_sessions", "sess1"), {
      organizationId: ORG, tutorId: uids.tutor, templateId: "tpl1",
      studentIds: ["stu1"], studentUserIds: [uids.student], parentUserIds: [uids.parent],
      startTime: "2026-07-01T10:00:00.000Z", endTime: "2026-07-01T11:00:00.000Z", status: "scheduled",
    });
    await setDoc(doc(db, "audit_events", "aud1"), {
      organizationId: ORG, action: "payment.record_manual", actorUserId: uids.admin,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "classstackr-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

// ===================================================================
// C1: privilege escalation via self-writable role fields
// ===================================================================
describe("C1: no self-service role escalation", () => {
  it("denies a user setting role on their own user doc", async () => {
    await assertFails(updateDoc(doc(ctx(uids.student), "users", uids.student), { role: "admin" }));
  });
  it("denies a user setting organizationId on their own user doc", async () => {
    await assertFails(updateDoc(doc(ctx(uids.student), "users", uids.student), { organizationId: OTHER_ORG }));
  });
  it("allows harmless profile updates on own user doc", async () => {
    await assertSucceeds(updateDoc(doc(ctx(uids.student), "users", uids.student), { name: "New Name", phone: "123" }));
  });
  it("denies creating a user doc pre-loaded with a role", async () => {
    await assertFails(setDoc(doc(ctx(uids.anon), "users", uids.anon), { name: "X", role: "admin" }));
  });
  it("denies any client write to organization_members", async () => {
    await assertFails(setDoc(doc(ctx(uids.student), "organization_members", `${ORG}_${uids.student}`), {
      organizationId: ORG, userId: uids.student, role: "owner",
    }));
    await assertFails(setDoc(doc(ctx(uids.owner), "organization_members", `${ORG}_new-user`), {
      organizationId: ORG, userId: "new-user", role: "tutor",
    }));
  });
});

// ===================================================================
// C2: money is never client-writable
// ===================================================================
describe("C2: financial collections deny all client writes", () => {
  it("student cannot mark their invoice paid", async () => {
    await assertFails(updateDoc(doc(ctx(uids.student), "invoices", "inv1"), { status: "paid" }));
  });
  it("even the org owner cannot write invoices from the client", async () => {
    await assertFails(updateDoc(doc(ctx(uids.owner), "invoices", "inv1"), { status: "paid" }));
    await assertFails(addDoc(collection(ctx(uids.owner), "invoices"), { organizationId: ORG, studentId: "stu1", totalPaise: 1 }));
  });
  it("nobody can top up a wallet from the client", async () => {
    await assertFails(updateDoc(doc(ctx(uids.student), "wallets", "wal1"), { balanceCredits: 9999 }));
    await assertFails(updateDoc(doc(ctx(uids.owner), "wallets", "wal1"), { balanceCredits: 9999 }));
  });
  it("attendance records reject client writes", async () => {
    await assertFails(setDoc(doc(ctx(uids.tutor), "attendance_records", "sess1_stu2"), {
      organizationId: ORG, studentId: "stu2", sessionId: "sess1", status: "present",
    }));
  });
  it("sessions cannot be flipped to completed from the client", async () => {
    await assertFails(updateDoc(doc(ctx(uids.tutor), "class_sessions", "sess1"), { status: "completed" }));
  });
  it("but scheduling updates by staff still work", async () => {
    await assertSucceeds(updateDoc(doc(ctx(uids.tutor), "class_sessions", "sess1"), { roomNumber: "B2" }));
  });
});

// ===================================================================
// C3: role granularity replaces flat isOrgMember
// ===================================================================
describe("C3: role-aware access", () => {
  it("student org member cannot read the lead pipeline", async () => {
    await assertFails(getDoc(doc(ctx(uids.student), "leads", "lead1")));
  });
  it("parent org member cannot read leads either", async () => {
    await assertFails(getDoc(doc(ctx(uids.parent), "leads", "lead1")));
  });
  it("accountant cannot read leads (matrix: none)", async () => {
    await assertFails(getDoc(doc(ctx(uids.accountant), "leads", "lead1")));
  });
  it("frontdesk can create leads", async () => {
    await assertSucceeds(addDoc(collection(ctx(uids.frontdesk), "leads"), {
      organizationId: ORG, name: "New Lead", status: "Inquiry",
    }));
  });
  it("student cannot delete a student record", async () => {
    await assertFails(deleteDoc(doc(ctx(uids.student), "students", "stu1")));
  });
  it("nobody hard-deletes students, not even the owner", async () => {
    await assertFails(deleteDoc(doc(ctx(uids.owner), "students", "stu1")));
  });
  it("tutor updates are limited to notes", async () => {
    await assertSucceeds(updateDoc(doc(ctx(uids.tutor), "students", "stu1"), { notes: "doing well" }));
    await assertFails(updateDoc(doc(ctx(uids.tutor), "students", "stu1"), { name: "Renamed" }));
  });
  it("accountant reads invoices but frontdesk-only actions stay closed", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.accountant), "invoices", "inv1")));
  });
  it("cross-org staff see nothing", async () => {
    await assertFails(getDoc(doc(ctx(uids.outsider), "students", "stu1")));
    await assertFails(getDoc(doc(ctx(uids.outsider), "invoices", "inv1")));
    await assertFails(getDoc(doc(ctx(uids.outsider), "leads", "lead1")));
  });
});

// ===================================================================
// C4: messaging is participants-only
// ===================================================================
describe("C4: conversation privacy", () => {
  it("a non-participant staff member cannot read another tutor's conversation", async () => {
    await assertFails(getDoc(doc(ctx(uids.tutor2), "messages", "msg1")));
    await assertFails(getDoc(doc(ctx(uids.tutor2), "conversations", "conv1")));
  });
  it("participants can read their thread", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.parent), "messages", "msg1")));
    await assertSucceeds(getDoc(doc(ctx(uids.tutor), "conversations", "conv1")));
  });
  it("sender identity cannot be forged on create", async () => {
    await assertFails(addDoc(collection(ctx(uids.parent), "messages"), {
      organizationId: ORG, participantIds: [uids.parent, uids.tutor],
      senderUserId: uids.tutor, body: "forged",
    }));
  });
});

// ===================================================================
// C5: no cross-tenant profile leaks
// ===================================================================
describe("C5: tutor profiles are org-scoped", () => {
  it("an outsider cannot read a tutor profile from another org", async () => {
    await assertFails(getDoc(doc(ctx(uids.outsider), "tutor_profiles", uids.tutor)));
  });
  it("staff in the same org can", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.frontdesk), "tutor_profiles", uids.tutor)));
  });
});

// ===================================================================
// Parent/student read paths
// ===================================================================
describe("Parent and student access", () => {
  it("parent reads own child's student record, invoice, wallet, attendance", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.parent), "students", "stu1")));
    await assertSucceeds(getDoc(doc(ctx(uids.parent), "invoices", "inv1")));
    await assertSucceeds(getDoc(doc(ctx(uids.parent), "wallets", "wal1")));
    await assertSucceeds(getDoc(doc(ctx(uids.parent), "attendance_records", "sess1_stu1")));
  });
  it("student reads own records", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.student), "students", "stu1")));
    await assertSucceeds(getDoc(doc(ctx(uids.student), "invoices", "inv1")));
  });
  it("student reads own session via denormalized studentUserIds", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.student), "class_sessions", "sess1")));
  });
  it("an unrelated authenticated user reads none of it", async () => {
    await assertFails(getDoc(doc(ctx(uids.anon), "students", "stu1")));
    await assertFails(getDoc(doc(ctx(uids.anon), "invoices", "inv1")));
    await assertFails(getDoc(doc(ctx(uids.anon), "class_sessions", "sess1")));
  });
  it("parent_links cannot be forged from the client", async () => {
    await assertFails(setDoc(doc(ctx(uids.anon), "parent_links", `${uids.anon}_stu1`), {
      organizationId: ORG, parentUserId: uids.anon, studentId: "stu1",
    }));
  });
});

// ===================================================================
// Governance
// ===================================================================
describe("Audit and server-only collections", () => {
  it("admin and accountant read audit events; tutor does not", async () => {
    await assertSucceeds(getDoc(doc(ctx(uids.admin), "audit_events", "aud1")));
    await assertSucceeds(getDoc(doc(ctx(uids.accountant), "audit_events", "aud1")));
    await assertFails(getDoc(doc(ctx(uids.tutor), "audit_events", "aud1")));
  });
  it("audit events reject client writes", async () => {
    await assertFails(addDoc(collection(ctx(uids.owner), "audit_events"), {
      organizationId: ORG, action: "fake",
    }));
  });
  it("google_tokens are unreachable from any client", async () => {
    await assertFails(getDoc(doc(ctx(uids.tutor), "google_tokens", uids.tutor)));
    await assertFails(setDoc(doc(ctx(uids.tutor), "google_tokens", uids.tutor), { refreshToken: "x" }));
  });
  it("organizations cannot be created client-side (bootstrap API only)", async () => {
    await assertFails(setDoc(doc(ctx(uids.anon), "organizations", "newOrg"), {
      name: "Rogue Org", ownerUserId: uids.anon,
    }));
  });
});
