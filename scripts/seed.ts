import "dotenv/config";
import { supabaseAdmin } from "../server/supabaseAdmin.ts";

// Seeds one demo org with a tutor, courses, students, sessions, attendance,
// and an invoice — enough to click through every workspace (Today, Students,
// Calendar, Invoices, Courses) without booking everything by hand first.
// Also seeds a demo parent + student account, linked to the first seeded
// student (Aarav Mehta), so the parent/student portals have a real login to
// verify against.
// Idempotent: each account (tutor, parent, student) is created only if its
// email doesn't already exist; existing accounts are reused rather than
// duplicated, so re-running after the tutor already exists still creates
// (and links) any demo parent/student account that's still missing.
//
// Usage: npx tsx scripts/seed.ts
// Requires the same env vars as the server (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

const DEMO_EMAIL = "demo.tutor@classstackr.dev";
const DEMO_PASSWORD = "ClassStackrDemo2026!";
const DEMO_PARENT_EMAIL = "demo.parent@classstackr.dev";
const DEMO_PARENT_PASSWORD = "ClassStackrDemo2026!";
const DEMO_STUDENT_EMAIL = "demo.student@classstackr.dev";
const DEMO_STUDENT_PASSWORD = "ClassStackrDemo2026!";

async function findUserByEmail(email: string) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) throw error;
  return data.users.find((u: { email?: string }) => u.email === email);
}

async function ensureDemoTutorOrg(): Promise<{ orgId: string; tutorUserId: string; studentRecordId: string }> {
  const existing = await findUserByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`Demo tutor already exists (${DEMO_EMAIL}) — reusing.`);
    const tutorUserId = existing.id;

    const { data: member, error: memberErr } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", tutorUserId)
      .eq("role", "owner")
      .single();
    if (memberErr) throw memberErr;
    const orgId = member.organization_id as string;

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", "Aarav Mehta")
      .single();
    if (studentErr) throw studentErr;

    return { orgId, tutorUserId, studentRecordId: student.id as string };
  }

  const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (userErr) throw userErr;
  const tutorUserId = userRes.user.id;
  console.log(`Created demo tutor user ${DEMO_EMAIL} (${tutorUserId})`);

  const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
    id: tutorUserId,
    name: "Demo Tutor",
    email: DEMO_EMAIL,
    role_type: "tutor",
    profile_status: "complete",
    is_active: true,
  });
  if (profileErr) throw profileErr;

  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .insert({ name: "Demo Tuition Center" })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  const orgId = org.id as string;
  console.log(`Created org ${orgId}`);

  const { error: memberErr } = await supabaseAdmin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: tutorUserId, role: "owner" });
  if (memberErr) throw memberErr;

  const { error: tutorProfileErr } = await supabaseAdmin.from("tutor_profiles").insert({
    user_id: tutorUserId,
    organization_id: orgId,
    full_name: "Demo Tutor",
    subjects: ["Math", "Physics"],
  });
  if (tutorProfileErr) throw tutorProfileErr;

  const { data: courses, error: coursesErr } = await supabaseAdmin
    .from("courses")
    .insert([
      { organization_id: orgId, name: "Grade 10 Mathematics" },
      { organization_id: orgId, name: "Grade 9 Science" },
    ])
    .select("id, name");
  if (coursesErr) throw coursesErr;
  console.log(`Created ${courses.length} courses`);

  const { data: students, error: studentsErr } = await supabaseAdmin
    .from("students")
    .insert([
      { organization_id: orgId, tutor_id: tutorUserId, name: "Aarav Mehta", grade: "10th Grade", subject: "Mathematics", parent_name: "Rohan Mehta" },
      { organization_id: orgId, tutor_id: tutorUserId, name: "Diya Patel", grade: "9th Grade", subject: "Science", parent_name: "Kiran Patel" },
      { organization_id: orgId, tutor_id: tutorUserId, name: "Vihaan Rao", grade: "10th Grade", subject: "Mathematics", parent_name: "Anjali Rao" },
    ])
    .select("id, name");
  if (studentsErr) throw studentsErr;
  console.log(`Created ${students.length} students`);

  const { data: template, error: templateErr } = await supabaseAdmin
    .from("class_templates")
    .insert({
      organization_id: orgId,
      course_id: courses[0].id,
      tutor_id: tutorUserId,
      name: courses[0].name,
      type: "ONE_ON_ONE",
      pricing_model: "PER_SESSION",
      fee_amount: 500,
      capacity: 1,
      student_ids: [students[0].id],
    })
    .select("id")
    .single();
  if (templateErr) throw templateErr;

  const now = new Date();
  const upcoming = new Date(now.getTime() + 24 * 3600 * 1000);
  upcoming.setHours(18, 0, 0, 0);
  const past = new Date(now.getTime() - 24 * 3600 * 1000);
  past.setHours(18, 0, 0, 0);
  const pastEnd = new Date(past.getTime() + 60 * 60 * 1000);

  const { data: pastSession, error: pastSessionErr } = await supabaseAdmin
    .from("class_sessions")
    .insert({
      organization_id: orgId,
      tutor_id: tutorUserId,
      template_id: template.id,
      student_ids: [students[0].id],
      student_user_ids: [],
      parent_user_ids: [],
      start_time: past.toISOString(),
      end_time: pastEnd.toISOString(),
      status: "completed",
      attendance_marked_at: past.toISOString(),
      attendance_marked_by: tutorUserId,
    })
    .select("id")
    .single();
  if (pastSessionErr) throw pastSessionErr;

  const { error: upcomingSessionErr } = await supabaseAdmin.from("class_sessions").insert({
    organization_id: orgId,
    tutor_id: tutorUserId,
    template_id: template.id,
    student_ids: [students[0].id],
    student_user_ids: [],
    parent_user_ids: [],
    start_time: upcoming.toISOString(),
    end_time: new Date(upcoming.getTime() + 60 * 60 * 1000).toISOString(),
    status: "scheduled",
  });
  if (upcomingSessionErr) throw upcomingSessionErr;

  const { error: attendanceErr } = await supabaseAdmin.from("attendance_records").insert({
    organization_id: orgId,
    session_id: pastSession.id,
    student_id: students[0].id,
    template_id: template.id,
    tutor_id: tutorUserId,
    status: "present",
    billed: true,
    session_start: past.toISOString(),
    marked_by: tutorUserId,
    marked_at: past.toISOString(),
  });
  if (attendanceErr) throw attendanceErr;

  const { error: invoiceErr } = await supabaseAdmin.from("invoices").insert({
    organization_id: orgId,
    student_id: students[0].id,
    tutor_id: tutorUserId,
    status: "draft",
    subtotal_paise: 50000,
    total_paise: 50000,
    items: [{ description: `ONE_ON_ONE session on ${past.toISOString().slice(0, 10)}`, amountPaise: 50000, quantity: 1 }],
    source: { kind: "attendance", sessionId: pastSession.id },
  });
  if (invoiceErr) throw invoiceErr;

  console.log(`  1 completed + billed session, 1 upcoming session, 3 students, 2 courses.`);

  return { orgId, tutorUserId, studentRecordId: students[0].id as string };
}

// Creates the demo parent + student accounts if they don't already exist,
// links the student account to the existing student record (Aarav Mehta)
// and the parent account to that student via parent_links, then backfills
// student_user_ids/parent_user_ids on any of that student's existing
// class_sessions rows — the same id-space backfill students.ts/parents.ts
// redeem does for a real invite redemption (HANDOFF §5.9: RLS matches those
// auth-uid arrays, not student_ids).
async function ensureDemoParentAndStudent(orgId: string, studentRecordId: string): Promise<void> {
  let parentUserId: string;
  const existingParent = await findUserByEmail(DEMO_PARENT_EMAIL);
  if (existingParent) {
    console.log(`Demo parent already exists (${DEMO_PARENT_EMAIL}) — reusing.`);
    parentUserId = existingParent.id;
  } else {
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: DEMO_PARENT_EMAIL,
      password: DEMO_PARENT_PASSWORD,
      email_confirm: true,
    });
    if (userErr) throw userErr;
    parentUserId = userRes.user.id;
    console.log(`Created demo parent user ${DEMO_PARENT_EMAIL} (${parentUserId})`);

    const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
      id: parentUserId,
      name: "Demo Parent",
      email: DEMO_PARENT_EMAIL,
      role_type: "parent",
      profile_status: "complete",
      is_active: true,
    });
    if (profileErr) throw profileErr;

    const { error: memberErr } = await supabaseAdmin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: parentUserId, role: "parent" });
    if (memberErr) throw memberErr;
  }

  let studentUserId: string;
  const existingStudent = await findUserByEmail(DEMO_STUDENT_EMAIL);
  if (existingStudent) {
    console.log(`Demo student already exists (${DEMO_STUDENT_EMAIL}) — reusing.`);
    studentUserId = existingStudent.id;
  } else {
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: DEMO_STUDENT_EMAIL,
      password: DEMO_STUDENT_PASSWORD,
      email_confirm: true,
    });
    if (userErr) throw userErr;
    studentUserId = userRes.user.id;
    console.log(`Created demo student user ${DEMO_STUDENT_EMAIL} (${studentUserId})`);

    const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
      id: studentUserId,
      name: "Aarav Mehta",
      email: DEMO_STUDENT_EMAIL,
      role_type: "student",
      profile_status: "complete",
      is_active: true,
    });
    if (profileErr) throw profileErr;

    const { error: memberErr } = await supabaseAdmin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: studentUserId, role: "student" });
    if (memberErr) throw memberErr;

    const { error: linkErr } = await supabaseAdmin
      .from("students")
      .update({ student_user_id: studentUserId })
      .eq("id", studentRecordId);
    if (linkErr) throw linkErr;
  }

  const { error: parentLinkErr } = await supabaseAdmin
    .from("parent_links")
    .upsert(
      { parent_user_id: parentUserId, student_id: studentRecordId, organization_id: orgId },
      { onConflict: "parent_user_id,student_id" }
    );
  if (parentLinkErr) throw parentLinkErr;

  const { data: sessions, error: sessionsErr } = await supabaseAdmin
    .from("class_sessions")
    .select("id, student_user_ids, parent_user_ids")
    .eq("organization_id", orgId)
    .contains("student_ids", [studentRecordId]);
  if (sessionsErr) throw sessionsErr;

  for (const session of sessions ?? []) {
    const studentUserIds = Array.from(new Set([...(session.student_user_ids ?? []), studentUserId]));
    const parentUserIds = Array.from(new Set([...(session.parent_user_ids ?? []), parentUserId]));
    const { error: updErr } = await supabaseAdmin
      .from("class_sessions")
      .update({ student_user_ids: studentUserIds, parent_user_ids: parentUserIds })
      .eq("id", session.id);
    if (updErr) throw updErr;
  }

  console.log(`  Demo parent login: ${DEMO_PARENT_EMAIL} / ${DEMO_PARENT_PASSWORD}`);
  console.log(`  Demo student login: ${DEMO_STUDENT_EMAIL} / ${DEMO_STUDENT_PASSWORD}`);
}

async function main() {
  console.log("Seeding demo data...");

  const { orgId, studentRecordId } = await ensureDemoTutorOrg();
  console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Org: Demo Tuition Center (${orgId})`);

  await ensureDemoParentAndStudent(orgId, studentRecordId);

  console.log("\nSeed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
