import { spawnSync } from "node:child_process";

// C-01 (EXECUTION_PLAN.md Step 25) requires the unit suite to pass
// identically under any process timezone. Step 25 only ever proved that for
// tests/unit/timezone.test.ts; the Money workspace's revenueTrend() read the
// ambient zone and failed under America/New_York for two months unnoticed.
// This runs the whole unit suite once per zone below so the next ambient-TZ
// read fails CI instead. Extra arguments are forwarded to `vitest run`.
//   UTC               what Vercel's functions run in
//   Asia/Kolkata      what the pilot orgs and most dev machines run in (+05:30)
//   America/New_York  a DST zone, west of UTC (catches the other side of midnight)
const ZONES = ["UTC", "Asia/Kolkata", "America/New_York"];

const failed = [];
for (const zone of ZONES) {
  console.log(`\n=== vitest run under TZ=${zone} ===`);
  const result = spawnSync("npx", ["vitest", "run", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, TZ: zone },
  });
  if (result.status !== 0) failed.push(zone);
}

if (failed.length > 0) {
  console.error(`\nUnit suite failed under TZ=${failed.join(", TZ=")}.`);
  process.exit(1);
}
console.log(`\nUnit suite passed under all ${ZONES.length} zones: ${ZONES.join(", ")}.`);
