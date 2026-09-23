import { readFileSync } from "node:fs";
import { transformAsync } from "@babel/core";
import { defineConfig, type Plugin } from "vitest/config";

// The viz's Solid components for OpenTUI: Bun compiles them through `@opentui/solid/preload`,
// vite through esbuild, which knows no Solid, so the files that name that JSX runtime are
// compiled here with the same babel presets the preload uses. Everything else (the dashboard's
// hono/jsx, the plain .ts) is untouched.
const SOLID_PRAGMA = /^\/\*\*\s*@jsxImportSource\s+@opentui\/solid\s*\*\//;

const opentuiSolid = (): Plugin => ({
  name: "opentui-solid-jsx",
  enforce: "pre",
  async transform(code, id) {
    if (!id.endsWith(".tsx") || !SOLID_PRAGMA.test(code)) {
      return null;
    }
    const result = await transformAsync(code, {
      filename: id,
      configFile: false,
      babelrc: false,
      cwd: import.meta.dirname,
      presets: [
        ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
        ["@babel/preset-typescript"],
      ],
    });
    return result === null || result.code === null || result.code === undefined
      ? null
      : { code: result.code, map: result.map ?? null };
  },
});

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
  plugins: [textModules(), opentuiSolid()],
  resolve: {
    // Under the `node` condition solid-js resolves to its server build, whose signals never
    // update; the tests run the client build the OpenTUI reconciler itself imports.
    alias: [{ find: /^solid-js$/, replacement: "solid-js/dist/solid.js" }],
  },
  test: {
    passWithNoTests: false,
    // Compiled by vite rather than loaded by Bun, so its @opentui/core is the one the tests
    // import: `render` tells a renderer from a config by `instanceof CliRenderer`.
    server: { deps: { inline: ["@opentui/solid"] } },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.unit.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "test/integration/**"],
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["test/**/*.integration.test.ts"],
          globalSetup: ["./vitest.global-setup.ts"],
          // A fresh worker per file is what gives each file its own database copy
          // (test/support/postgres.ts).
          isolate: true,
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
