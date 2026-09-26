import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

// POST /create-test-suite-run imports the ticket template and its guides as strings, the way
// wrangler's Text rule loads them in the worker.
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
    name: "dashboard",
    environment: "node",
    include: ["test/**/*.unit.test.ts"],
    passWithNoTests: false,
    testTimeout: 10_000,
  },
});
