import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    include: ["test/**/*.test.ts"],
    // Each start boots PGlite and migrates it, which takes a second or two.
    testTimeout: 30_000,
  },
});
