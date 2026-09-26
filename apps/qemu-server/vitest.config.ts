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
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          // The qemu binary and a QMP socket, no container: the lane runs on any host with QEMU.
          name: "integration",
          environment: "node",
          include: ["test/**/*.integration.test.ts"],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
