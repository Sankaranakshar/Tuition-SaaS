import { readFileSync } from "node:fs";
import path from "node:path";

// Guards against the exact regression found in the 2026-07-25 optimization
// audit (docs/OPTIMIZATION_AUDIT.md, finding C1): CI built dist/server.js
// (from server.ts) but production is served by api/index.js (esbuilt from
// server/vercelHandler.ts by vercel.json's buildCommand) — two different
// bundles from two different entry points, and CI never built or checked the
// one that actually ships. The committed api/index.js drifted 15 days behind
// server/app.ts and was silently missing 7 of 14 route groups.
//
// This script is the source-of-truth check: every "/api/v1/..." (and
// "/api/cron") mount path in server/app.ts's app.use(...) calls must appear
// as a string literal inside the built api/index.js. It does not care about
// exact route implementation, only that the route group wasn't dropped by a
// bad build, a partial esbuild failure, or a future refactor of app.ts.

const root = process.cwd();
const appTsPath = path.join(root, "server", "app.ts");
const bundlePath = path.join(root, "api", "index.js");

const appTs = readFileSync(appTsPath, "utf8");
const bundle = readFileSync(bundlePath, "utf8");

const mountRe = /app\.use\(\s*["'](\/api\/[^"']+)["']/g;
const mountPaths = [...appTs.matchAll(mountRe)].map((m) => m[1]);

if (mountPaths.length === 0) {
  console.error(`Found zero "/api/..." mount paths in ${appTsPath} — the regex is probably stale, not the app.`);
  process.exit(1);
}

const missing = mountPaths.filter((p) => !bundle.includes(p));

console.log(`Checked ${mountPaths.length} route mounts from server/app.ts against api/index.js:`);
for (const p of mountPaths) {
  console.log(`  ${missing.includes(p) ? "MISSING" : "present"}  ${p}`);
}

if (missing.length > 0) {
  console.error(
    `\napi/index.js is missing ${missing.length} route mount(s) that server/app.ts declares. ` +
      `This means the deployed Vercel bundle is stale or the esbuild step failed partially. ` +
      `Regenerate it with: npm run build:api`
  );
  process.exit(1);
}
