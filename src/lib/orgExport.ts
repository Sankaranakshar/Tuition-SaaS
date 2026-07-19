// Pure helpers for src/components/OrgExportSettings.tsx (Stage 3 org
// export/offboarding, DEV_PLAN §5, old E16.3). Kept out of the component per
// this codebase's standing rule (pure lib + thin page).

/** Case-sensitive exact match, ignoring leading/trailing whitespace the user
 *  might paste in — the same "type the name to confirm" gate the server
 *  route re-checks authoritatively (client-side is UX only). */
export function canConfirmOffboard(orgName: string, input: string): boolean {
  return input.trim() === orgName.trim() && input.trim().length > 0;
}
