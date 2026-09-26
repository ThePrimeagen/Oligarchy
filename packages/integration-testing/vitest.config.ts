import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

// dashboard.integration.test.ts imports the dashboard's Worker entry, which imports the ticket
// template and its guides as strings, the way wrangler's Text rule loads them in the worker.
const textModules = (): Plugin => ({
  name: "oligarchy-text-modules",
  enforce: "pre",
  load(id) {
    const path = id.split("?")[0] ?? "";
    if (path.includes("node_modules") || (!path.endsWith(".md") && !path.endsWith(".html"))) {
      return null;
    }
    return `export default ${JSON.stringify(readFileSync(path, "utf8"))}`;
  },
});

export default defineConfig({
  plugins: [textModules()],
  test: {
    name: "integration-testing",
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    passWithNoTests: false,
    globalSetup: ["./vitest.global-setup.ts"],
    // A fresh worker per file is what gives each file its own database copy
    // (test/support/postgres.ts).
    isolate: true,
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
