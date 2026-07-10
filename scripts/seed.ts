import "dotenv/config";
import { supabaseAdmin } from "../server/supabaseAdmin.ts";

// Seeds one demo org with a tutor, courses, students, sessions, attendance,
// and an invoice — enough to click through every workspace (Today, Students,
// Calendar, Invoices, Courses) without booking everything by hand first.
// Idempotent: re-running skips creation if the demo tutor account already
// exists, rather than creating duplicate orgs each time.
//
// Usage: npx tsx scripts/seed.ts
// Requires the same env vars as the server (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

const DEMO_EMAIL = "demo.tutor@classstackr.dev";
const DEMO_PASSWORD = "ClassStackrDemo2026!";

async function main() {
  console.log("Seeding demo data...");

  const { data: existingUsers, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = existingUsers.users.find((u: { email?: string }) => u.email === DEMO_EMAIL);
  if (existing) {
    console.log(`Demo tutor already exists (${DEMO_EMAIL}) — skipping. Delete the user in Supabase Auth to reseed.`);
    return;
  }

  const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (userErr) throw userErr;
  const userId = userRes.user.id;
  console.log(`Created demo tutor user ${DEMO_EMAIL} (${userId})`);

  const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
    id: userId,
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
    .insert({ organization_id: orgId, user_id: userId, role: "owner" });
  if (memberErr) throw memberErr;

  const { error: tutorProfileErr } = await supabaseAdmin.from("tutor_profiles").insert({
    user_id: userId,
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
      { organization_id: orgId, tutor_id: userId, name: "Aarav Mehta", grade: "10th Grade", subject: "Mathematics", parent_name: "Rohan Mehta" },
      { organization_id: orgId, tutor_id: userId, name: "Diya Patel", grade: "9th Grade", subject: "Science", parent_name: "Kiran Patel" },
      { organization_id: orgId, tutor_id: userId, name: "Vihaan Rao", grade: "10th Grade", subject: "Mathematics", parent_name: "Anjali Rao" },
    ])
    .select("id, name");
  if (studentsErr) throw studentsErr;
  console.log(`Created ${students.length} students`);

  const { data: template, error: templateErr } = await supabaseAdmin
    .from("class_templates")
    .insert({
      organization_id: orgId,
      course_id: courses[0].id,
      tutor_id: userId,
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
      tutor_id: userId,
      template_id: template.id,
      student_ids: [students[0].id],
      student_user_ids: [],
      parent_user_ids: [],
      start_time: past.toISOString(),
      end_time: pastEnd.toISOString(),
      status: "completed",
      attendance_marked_at: past.toISOString(),
      attendance_marked_by: userId,
    })
    .select("id")
    .single();
  if (pastSessionErr) throw pastSessionErr;

  const { error: upcomingSessionErr } = await supabaseAdmin.from("class_sessions").insert({
    organization_id: orgId,
    tutor_id: userId,
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
    tutor_id: userId,
    status: "present",
    billed: true,
    session_start: past.toISOString(),
    marked_by: userId,
    marked_at: past.toISOString(),
  });
  if (attendanceErr) throw attendanceErr;

  const { error: invoiceErr } = await supabaseAdmin.from("invoices").insert({
    organization_id: orgId,
    student_id: students[0].id,
    tutor_id: userId,
    status: "draft",
    subtotal_paise: 50000,
    total_paise: 50000,
    items: [{ description: `ONE_ON_ONE session on ${past.toISOString().slice(0, 10)}`, amountPaise: 50000, quantity: 1 }],
    source: { kind: "attendance", sessionId: pastSession.id },
  });
  if (invoiceErr) throw invoiceErr;

  console.log("\nSeed complete.");
  console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Org: Demo Tuition Center (${orgId})`);
  console.log(`  1 completed + billed session, 1 upcoming session, 3 students, 2 courses.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
