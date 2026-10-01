import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    include: ["test/**/*.test.ts"],
    // Without a cached template, the first fake postgres builds one, and the client is a process.
    testTimeout: 30_000,
  },
});
