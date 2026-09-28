import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    include: ["test/**/*.test.ts"],
    // Without a cached template, the first start builds and migrates one: a second or two.
    testTimeout: 30_000,
  },
});
