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
        },
      },
      {
        extends: true,
        test: {
          // The real OS (a child process, /proc, ps), no container: the lane runs on any host.
          name: "integration",
          environment: "node",
          include: ["test/**/*.integration.test.ts"],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
