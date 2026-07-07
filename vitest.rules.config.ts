import { defineConfig } from "vitest/config";

// Firestore security-rules suite. Requires the emulator:
//   npm run test:rules   (wraps `firebase emulators:exec`)
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
