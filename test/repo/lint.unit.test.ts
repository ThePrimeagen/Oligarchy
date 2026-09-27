import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

// Lints the files with only oligarchy/augment-through-entry on: oxlint's exit status, and each
// diagnostic's message, sorted. A plugin that fails to load exits 1 with no diagnostics.
const lint = (
  files: Readonly<Record<string, string>>,
): { readonly status: number | null; readonly messages: Array<string> } => {
  const dir = mkdtempSync(join(tmpdir(), "augment-through-entry-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  const config = join(dir, "oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [join(root, "v2/lint/plugin.js")],
      rules: { "oligarchy/augment-through-entry": "error" },
    }),
  );
  const run = spawnSync(
    join(root, "node_modules/.bin/oxlint"),
    ["-c", config, "--format", "unix", dir],
    { encoding: "utf8" },
  );
  const messages = run.stdout
    .split("\n")
    .map((line) => /^.+?:\d+:\d+: (.*augment-through-entry.*)$/.exec(line)?.[1])
    .filter((message) => message !== undefined)
    .sort();
  return { status: run.status, messages };
};

const augment = (specifier: string) =>
  `declare module "${specifier}" {\n  interface Services {\n    sessions: { readonly service: "sessions" };\n  }\n}\nexport {};\n`;

describe("oligarchy/augment-through-entry", () => {
  it("accepts a package name, a package's src/main.ts, and declare global (happy)", () => {
    expect(
      lint({
        "name.ts": augment("@oligarchy/app"),
        "entry.ts": augment("../src/main.ts"),
        "global.ts": "declare global {\n  interface Window {\n    x: number;\n  }\n}\nexport {};\n",
      }),
    ).toEqual({ status: 0, messages: [] });
  });

  it("refuses a package's other files, by path or by deep import (unhappy)", () => {
    const result = lint({
      "relative.ts": augment("../src/services.ts"),
      "deep.ts": augment("@oligarchy/app/src/services.ts"),
    });
    expect(result.status).toBe(1);
    expect(result.messages).toEqual([
      "augment ../src/services.ts through its package's entry: the package name, or src/main.ts inside the package [Error/oligarchy(augment-through-entry)]",
      "augment @oligarchy/app/src/services.ts through its package's entry: the package name, or src/main.ts inside the package [Error/oligarchy(augment-through-entry)]",
    ]);
  });
});
