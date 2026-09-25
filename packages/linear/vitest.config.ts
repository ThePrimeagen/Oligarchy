import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "linear",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
  },
});
