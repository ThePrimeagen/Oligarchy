import { transformAsync } from "@babel/core";
import { defineConfig, type Plugin } from "vitest/config";

// The Solid components for OpenTUI: Bun compiles them through `@opentui/solid/preload`, vite
// through esbuild, which knows no Solid, so every .tsx here is compiled with the same babel
// presets the preload uses.
const opentuiSolid = (): Plugin => ({
  name: "opentui-solid-jsx",
  enforce: "pre",
  async transform(code, id) {
    if (!id.endsWith(".tsx")) {
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

export default defineConfig({
  plugins: [opentuiSolid()],
  resolve: {
    // Under the `node` condition solid-js resolves to its server build, whose signals never
    // update; the tests run the client build the OpenTUI reconciler itself imports.
    alias: [{ find: /^solid-js$/, replacement: "solid-js/dist/solid.js" }],
  },
  test: {
    name: "viz",
    environment: "node",
    include: ["test/**/*.unit.test.{ts,tsx}"],
    passWithNoTests: false,
    testTimeout: 10_000,
    // Compiled by vite rather than loaded by Bun, so its @opentui/core is the one the tests
    // import: `render` tells a renderer from a config by `instanceof CliRenderer`.
    server: { deps: { inline: ["@opentui/solid"] } },
  },
});
