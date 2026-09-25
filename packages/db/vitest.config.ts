import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "db",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
  },
});
