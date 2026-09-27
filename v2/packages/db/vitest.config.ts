import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/**/*.integration.test.ts"],
          globalSetup: ["./vitest.global-setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
