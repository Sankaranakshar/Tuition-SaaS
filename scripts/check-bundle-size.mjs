import { readFileSync, existsSync } from "node:fs";
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

const distDir = path.join(process.cwd(), "dist");
const distAssets = path.join(distDir, "assets");

// The entry chunk must be identified from index.html's own <script> tag, not
// by pattern-matching "index-*.js" in the assets directory: a dynamically
// imported module with no explicit chunk name (e.g. the lazy-loaded
// @sentry/react import added for docs/OPTIMIZATION_AUDIT.md finding H5) can
// ALSO get an "index-<hash>.js" name from Rollup, and readdirSync's listing
// order is not guaranteed — this script previously picked whichever
// "index-*.js" file the filesystem returned first, which silently measured
// the wrong chunk once a second one existed. index.html always points at
// the real entry, regardless of how many other chunks share the prefix.
const indexHtmlPath = path.join(distDir, "index.html");
if (!existsSync(indexHtmlPath)) {
  console.error(`Could not find ${indexHtmlPath}. Did the build run?`);
  process.exit(1);
}
const indexHtml = readFileSync(indexHtmlPath, "utf8");
const scriptMatch = indexHtml.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/);
if (!scriptMatch) {
  console.error(`Could not find a module <script src="/assets/..."> tag in ${indexHtmlPath}.`);
  process.exit(1);
}
const entryFile = scriptMatch[1];

const filePath = path.join(distAssets, entryFile);
if (!existsSync(filePath)) {
  console.error(`index.html references ${entryFile}, but it does not exist in ${distAssets}.`);
  process.exit(1);
}
const gzipSize = gzipSync(readFileSync(filePath)).length;
const gzipKB = (gzipSize / 1024).toFixed(1);
const budgetKB = (BUDGET_BYTES / 1024).toFixed(0);

console.log(`Main entry chunk: ${entryFile} — ${gzipKB} KB gzip (budget: ${budgetKB} KB)`);

if (gzipSize > BUDGET_BYTES) {
  console.error(`\nBundle size regression: ${gzipKB} KB exceeds the ${budgetKB} KB budget.`);
  console.error("If this growth is intentional, raise BUDGET_BYTES in scripts/check-bundle-size.mjs with a note why.");
  process.exit(1);
}
