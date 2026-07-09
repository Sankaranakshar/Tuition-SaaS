import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — server-side Supabase calls will fail.");
}

// Service-role client: bypasses RLS entirely, same trust boundary
// firebase-admin had (server code is trusted, RLS is the client-side gate).
// createClient() throws synchronously on an invalid URL, so fall back to a
// syntactically-valid placeholder when unset rather than crashing at import
// time — matches the old firebaseAdmin.ts posture of failing at first use
// (a real query) instead of failing every module that transitively imports
// this file, including pure-function unit tests that never touch Supabase.
export const supabaseAdmin = createClient(supabaseUrl || "http://localhost:54321", serviceRoleKey || "placeholder", {
  auth: { autoRefreshToken: false, persistSession: false },
});
