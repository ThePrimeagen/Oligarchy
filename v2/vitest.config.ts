import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.unit.test.ts"],
          exclude: ["**/node_modules/**", "test/integration/**"],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["test/**/*.integration.test.ts"],
          globalSetup: ["./vitest.global-setup.ts"],
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
