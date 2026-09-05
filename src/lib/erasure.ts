// Pure helper for the per-student erasure confirm dialog (src/pages/People.tsx),
// B-11 / EXECUTION_PLAN.md Step 10. Kept out of the page per this codebase's
// standing pure-lib + thin-page rule, mirroring src/lib/orgExport.ts.

/** Case-sensitive exact match of the typed student name, trimming whitespace
 *  the user might paste in. The server route re-checks this authoritatively;
 *  the client gate is UX only. */
export function canConfirmErase(studentName: string, input: string): boolean {
  return input.trim().length > 0 && input.trim() === studentName.trim();
}
