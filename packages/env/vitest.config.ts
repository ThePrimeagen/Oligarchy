import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "env",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
  },
});
