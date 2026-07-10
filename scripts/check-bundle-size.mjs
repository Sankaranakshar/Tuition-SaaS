import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

// Guards the main entry chunk against silent bloat regressions. DEV_PLAN.md
// Tech Debt notes the original 200KB-gzip target was never enforced by CI;
// the current main chunk is already ~221KB gzip (jspdf/exceljs/html2canvas
// are lazy-imported elsewhere and don't count here — see Tech Debt #6).
// Rather than fail CI on a budget the codebase doesn't meet yet, this gate
// enforces "don't make it worse": a generous margin over today's real size,
// so a genuine regression (an accidental eager import of something heavy)
// fails the build instead of silently shipping.
const BUDGET_BYTES = 260 * 1024; // ~260KB gzip

const distAssets = path.join(process.cwd(), "dist", "assets");
const entryFile = readdirSync(distAssets).find((f) => /^index-[^.]+\.js$/.test(f));
if (!entryFile) {
  console.error(`Could not find the main entry chunk (index-*.js) in ${distAssets}. Did the build run?`);
  process.exit(1);
}

const filePath = path.join(distAssets, entryFile);
const gzipSize = gzipSync(readFileSync(filePath)).length;
const gzipKB = (gzipSize / 1024).toFixed(1);
const budgetKB = (BUDGET_BYTES / 1024).toFixed(0);

console.log(`Main entry chunk: ${entryFile} — ${gzipKB} KB gzip (budget: ${budgetKB} KB)`);

if (gzipSize > BUDGET_BYTES) {
  console.error(`\nBundle size regression: ${gzipKB} KB exceeds the ${budgetKB} KB budget.`);
  console.error("If this growth is intentional, raise BUDGET_BYTES in scripts/check-bundle-size.mjs with a note why.");
  process.exit(1);
}
