import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ctrl",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
    testTimeout: 10_000,
  },
});
