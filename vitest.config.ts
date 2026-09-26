import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.unit.test.ts"],
          exclude: ["**/node_modules/**", "test/integration/**"],
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["test/**/*.integration.test.ts"],
          globalSetup: ["./vitest.global-setup.ts"],
          // A fresh worker per file is what gives each file its own database copy
          // (test/support/postgres.ts).
          isolate: true,
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
