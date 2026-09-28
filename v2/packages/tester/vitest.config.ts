import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    include: ["test/**/*.test.ts"],
    // Each fake postgres boots PGlite and migrates it, and the tester is a process of its own.
    testTimeout: 30_000,
  },
});
