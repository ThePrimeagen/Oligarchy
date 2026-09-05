import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["**/*.js", "**/*.mjs", "**/*.cjs"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    "id-denylist": ["error", "isRecord"],
  },
  overrides: [
    {
      files: ["**/*.test.ts"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
  ],
});
