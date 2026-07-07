import { defineConfig } from "vitest/config";

// Default suite: pure unit tests. Rules tests need the Firestore emulator
// and run via `npm run test:rules` (see vitest.rules.config.ts).
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
