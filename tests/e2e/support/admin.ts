import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireStagingEnv, runEmailPrefix, runOrgPrefix, EMAIL_PREFIX, ORG_PREFIX } from "./env";

// Service-role access to classstackr-staging for the Playwright suite: fixture
// setup (the parts of a journey that are not the thing under test) and
// cleanup. Everything the suite creates is named inside this run's namespace
// (runEmailPrefix / runOrgPrefix), which is what makes cleanup safe on a
// staging database shared by concurrent PR runs and by humans: it only ever
// deletes rows it can prove belong to a suite run.

let client: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!client) {
    const env = requireStagingEnv();
    client = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

function must<R extends { data: unknown; error: unknown }>(res: R, what: string): NonNullable<R["data"]> {
  if (res.error) throw new Error(`E2E fixture: ${what} failed: ${JSON.stringify(res.error)}`);
  return res.data as NonNullable<R["data"]>;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

/**
 * A confirmed auth user with no profile row, exactly what a fresh signup looks
 * like once the confirmation link is clicked: the app itself creates the
 * `profiles` row on first login (AuthContext.loadUser) and onboarding fills it.
 * Staging has email confirmation on and no mail provider, so the signup form's
 * own `supabase.auth.signUp` call cannot complete a login in CI; everything
 * after it is driven through the UI.
 */
export async function createAuthUser(label: string, name: string): Promise<TestUser> {
  // The random tail keeps a retried test (CI retries once) from colliding
  // with the account its first attempt created.
  const email = `${runEmailPrefix()}${label}-${randomBytes(2).toString("hex")}@classstackr.dev`.toLowerCase();
  const password = `E2e-${randomBytes(9).toString("base64url")}!`;
  const res = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  const user = must(res, `createUser ${email}`).user;
  return { id: user!.id, email, password, name };
}

/** An auth user plus a completed profile, the shape scripts/seed.ts gives its demo accounts. */
export async function createPersonWithProfile(
  label: string,
  name: string,
  roleType: "tutor" | "parent" | "student",
): Promise<TestUser> {
  const user = await createAuthUser(label, name);
  must(
    await admin().from("profiles").insert({
      id: user.id,
      name,
      email: user.email,
      role_type: roleType,
      profile_status: "complete",
      is_active: true,
    }),
    `insert profile ${user.email}`,
  );
  return user;
}

export interface TestOrg {
  id: string;
  name: string;
  owner: TestUser;
}

/** An organization owned by a new tutor-type account, as bootstrap would leave it. */
export async function createOrgWithOwner(label: string): Promise<TestOrg> {
  const owner = await createPersonWithProfile(`${label}-owner`, `Owner ${label}`, "tutor");
  const name = `${runOrgPrefix()}${label}`;
  const org = must(
    await admin().from("organizations").insert({ name }).select("id").single(),
    `insert org ${name}`,
  ) as { id: string };
  await addMember(org.id, owner.id, "owner");
  must(
    await admin().from("profiles").update({ organization_id: org.id }).eq("id", owner.id),
    "set owner active org",
  );
  must(
    await admin().from("tutor_profiles").insert({ user_id: owner.id, organization_id: org.id, full_name: owner.name }),
    "insert owner tutor profile",
  );
  return { id: org.id, name, owner };
}

export async function addMember(orgId: string, userId: string, role: string): Promise<void> {
  must(
    await admin().from("organization_members").insert({ organization_id: orgId, user_id: userId, role }),
    `add ${role} member`,
  );
}

export async function createCourse(orgId: string, name: string): Promise<string> {
  const row = must(
    await admin().from("courses").insert({ organization_id: orgId, name }).select("id").single(),
    `insert course ${name}`,
  ) as { id: string };
  return row.id;
}

export async function createStudent(
  orgId: string,
  tutorId: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const row = must(
    await admin()
      .from("students")
      .insert({ organization_id: orgId, tutor_id: tutorId, name, status: "active", ...extra })
      .select("id")
      .single(),
    `insert student ${name}`,
  ) as { id: string };
  return row.id;
}

/** Links a student account to its student record, as a student-invite redeem does. */
export async function linkStudentAccount(orgId: string, studentId: string, user: TestUser): Promise<void> {
  await addMember(orgId, user.id, "student");
  must(await admin().from("students").update({ student_user_id: user.id }).eq("id", studentId), "link student account");
}

/** Links a parent account to a student, as a parent-invite redeem does. */
export async function linkParent(orgId: string, studentId: string, parent: TestUser): Promise<void> {
  await addMember(orgId, parent.id, "parent");
  must(
    await admin().from("parent_links").insert({ parent_user_id: parent.id, student_id: studentId, organization_id: orgId }),
    "insert parent link",
  );
}

// ---------------------------------------------------------------- cleanup

async function listSuiteUsers(): Promise<{ id: string; email: string; createdAt: string }[]> {
  const out: { id: string; email: string; createdAt: string }[] = [];
  for (let page = 1; page < 50; page++) {
    const res = await admin().auth.admin.listUsers({ page, perPage: 1000 });
    const users = must(res, "listUsers").users;
    for (const u of users) {
      if (u.email?.startsWith(EMAIL_PREFIX)) out.push({ id: u.id, email: u.email, createdAt: u.created_at });
    }
    if (users.length < 1000) break;
  }
  return out;
}

async function deleteOrgsAndUsers(orgIds: string[], userIds: string[]): Promise<{ orgs: number; users: number }> {
  const uniqueOrgs = [...new Set(orgIds)];
  // Every org-scoped table cascades from organizations, so one delete per org
  // removes its members, students, classes, sessions, invoices, ledgers,
  // conversations and messages with it.
  for (const id of uniqueOrgs) {
    must(await admin().from("organizations").delete().eq("id", id), `delete org ${id}`);
  }
  // profiles cascades from auth.users.
  for (const id of new Set(userIds)) {
    const { error } = await admin().auth.admin.deleteUser(id);
    if (error && !/not.?found/i.test(error.message)) throw new Error(`E2E cleanup: deleteUser ${id}: ${error.message}`);
  }
  return { orgs: uniqueOrgs.length, users: new Set(userIds).size };
}

/** Orgs a set of suite users own, which catches orgs the app named itself (onboarding's solo path). */
async function orgsOwnedBy(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = must(
    await admin().from("organization_members").select("organization_id").eq("role", "owner").in("user_id", userIds),
    "select owned orgs",
  ) as { organization_id: string }[];
  return rows.map((r) => r.organization_id);
}

/** Deletes everything one run created. Safe to call more than once. */
export async function cleanupRun(id: string): Promise<{ orgs: number; users: number }> {
  const prefix = runEmailPrefix(id);
  const users = (await listSuiteUsers()).filter((u) => u.email.startsWith(prefix));
  const named = must(
    await admin().from("organizations").select("id").like("name", `${runOrgPrefix(id)}%`),
    "select run orgs",
  ) as { id: string }[];
  const userIds = users.map((u) => u.id);
  return deleteOrgsAndUsers([...named.map((o) => o.id), ...(await orgsOwnedBy(userIds))], userIds);
}

/**
 * Deletes suite data older than `maxAgeMs` from any run, so a run that crashed
 * or was cancelled before its teardown cannot leave state behind for long.
 * The age floor is what keeps this from touching a concurrent run that is
 * still in progress.
 */
export async function sweepStale(maxAgeMs: number): Promise<{ orgs: number; users: number }> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const users = (await listSuiteUsers()).filter((u) => u.createdAt < cutoff);
  const named = must(
    await admin().from("organizations").select("id").like("name", `${ORG_PREFIX}%`).lt("created_at", cutoff),
    "select stale orgs",
  ) as { id: string }[];
  const userIds = users.map((u) => u.id);
  return deleteOrgsAndUsers([...named.map((o) => o.id), ...(await orgsOwnedBy(userIds))], userIds);
}
