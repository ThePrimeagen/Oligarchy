import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["../../vitest.setup.ts"],
    passWithNoTests: false,
    include: ["test/**/*.test.ts"],
    // Without a cached template, the first fake postgres builds one, and the tester is a process.
    testTimeout: 30_000,
  },
});
