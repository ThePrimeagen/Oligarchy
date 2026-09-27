import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    include: ["test/**/*.integration.test.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
