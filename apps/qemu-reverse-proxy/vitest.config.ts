import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "qemu-reverse-proxy",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
    testTimeout: 10_000,
  },
});
