import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "routes",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
  },
});
