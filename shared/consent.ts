// B-11 / EXECUTION_PLAN.md Step 10. The version string stamped onto every
// consent_records row at parent/student invite redeem (server/routes/
// parents.ts, server/routes/students.ts).
//
// Zod-free on purpose (same rule as shared/money.ts / shared/creditExpiry.ts):
// this is imported by both the server routes and the client, and a shared/
// file that pulls in Zod drags Zod into the browser bundle.
//
// IMPORTANT: the actual DPDP parental-consent document this version points at
// has NOT been drafted yet. It is a legal deliverable tracked on the
// go-to-market checklist (MASTER_PLAN.md §8, "Legal"), not engineering work.
// Persisting the record now — with a version that will resolve to a real
// document later — is deliberate: it makes the consent trail auditable from
// day one instead of retrofitting timestamps no one captured. Bump this
// string when the document is published and again on every substantive
// revision; never reuse a version for changed terms.
export const CONSENT_VERSION = "dpdp-2026-09.draft";
