import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

// Lints the files with only the one oligarchy rule on: oxlint's exit status, and each
// diagnostic's message, sorted. A plugin that fails to load exits 1 with no diagnostics.
const lint = (
  rule: string,
  files: Readonly<Record<string, string>>,
): { readonly status: number | null; readonly messages: Array<string> } => {
  const dir = mkdtempSync(join(tmpdir(), `${rule}-`));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const config = join(dir, "oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [join(root, "v2/lint/plugin.js")],
      rules: { [`oligarchy/${rule}`]: "error" },
    }),
  );
  const run = spawnSync(
    join(root, "node_modules/.bin/oxlint"),
    ["-c", config, "--format", "unix", dir],
    { encoding: "utf8" },
  );
  const messages = run.stdout
    .split("\n")
    .map((line) => /^.+?:\d+:\d+: (.*)$/.exec(line)?.[1])
    .filter((message): message is string => message?.includes(`oligarchy(${rule})`) === true)
    .sort();
  return { status: run.status, messages };
};

const augment = (specifier: string) =>
  `declare module "${specifier}" {\n  interface Services {\n    sessions: { readonly service: "sessions" };\n  }\n}\nexport {};\n`;

const refused = (specifier: string) =>
  `augment ${specifier} through its package's entry: the package name, or src/main.ts inside the package [Error/oligarchy(augment-through-entry)]`;

// CI lints v2 without installing it, so a type from a v2 dependency is any. The fixture is that:
// two errors from a module that is not there, and a union of them.
const UNRESOLVED_UNION = `import * as missing from "missing-module";

export const One = missing.define("One");
export type One = InstanceType<typeof One>;
export const Two = missing.define("Two");
export type Two = InstanceType<typeof Two>;

export const pick = (flip: boolean): One | Two => (flip ? new One() : new Two());
`;

// Lints the fixture with the repo's own config from a directory made under `parent`, then removes
// it: oxlint's exit status, how many files it linted, and how many no-redundant-type-constituents
// diagnostics it gave. The file count keeps a run that linted nothing from passing as clean.
const redundantUnions = (
  parent: string,
): { readonly status: number | null; readonly files: number; readonly redundant: number } => {
  const dir = mkdtempSync(join(root, parent, ".lint-"));
  try {
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, module: "preserve", moduleResolution: "bundler" },
        include: ["*.ts"],
      }),
    );
    writeFileSync(join(dir, "union.ts"), UNRESOLVED_UNION);
    const run = spawnSync(
      join(root, "node_modules/.bin/oxlint"),
      ["-c", join(root, ".oxlintrc.json"), "--format", "json", dir],
      { encoding: "utf8" },
    );
    return {
      status: run.status,
      files: Number(/"number_of_files": (\d+)/.exec(run.stdout)?.[1] ?? 0),
      redundant:
        run.stdout.split('"code": "typescript(no-redundant-type-constituents)"').length - 1,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("no-redundant-type-constituents", () => {
  it("is off under v2, where a union of types CI cannot resolve is not a mistake (happy)", () => {
    expect(redundantUnions("v2")).toEqual({ status: 0, files: 1, redundant: 0 });
  });

  it("still refuses the same union everywhere else (unhappy)", () => {
    expect(redundantUnions(".")).toEqual({ status: 1, files: 1, redundant: 2 });
  });
});

describe("oligarchy/augment-through-entry", () => {
  it("accepts a package name, the package's own src/main.ts from any depth, and declare global (happy)", () => {
    expect(
      lint("augment-through-entry", {
        "app/package.json": "{}",
        "app/test/name.ts": augment("@oligarchy/app"),
        "app/test/entry.ts": augment("../src/main.ts"),
        "app/test/nested/deep.ts": augment("../../src/main.ts"),
        "app/test/global.ts":
          "declare global {\n  interface Window {\n    x: number;\n  }\n}\nexport {};\n",
      }),
    ).toEqual({ status: 0, messages: [] });
  });

  it("refuses a package's other files, a path that misses its entry, and another package's entry (unhappy)", () => {
    const result = lint("augment-through-entry", {
      "app/package.json": "{}",
      "other/package.json": "{}",
      "app/test/relative.ts": augment("../src/services.ts"),
      "app/test/deep-import.ts": augment("@oligarchy/app/src/services.ts"),
      "app/test/nested/missed.ts": augment("../src/main.ts"),
      "app/test/other.ts": augment("../../other/src/main.ts"),
    });
    expect(result.status).toBe(1);
    expect(result.messages).toEqual([
      refused("../../other/src/main.ts"),
      refused("../src/main.ts"),
      refused("../src/services.ts"),
      refused("@oligarchy/app/src/services.ts"),
    ]);
  });
});

const RESULTS = `import * as jarl from "jarl";

class Boom extends jarl.error.define("Boom") {}
declare const make: () => jarl.Result<number, Boom>;
`;

const valueRefused = (name: string) =>
  `read ${name}.value with jarl.value(${name}) once every error is handled, or jarl.unwrap(${name}) to throw the rest [Error/oligarchy(result-through-jarl)]`;

const errorRefused = (name: string) =>
  `name ${name}'s error with jarl.error.is(${name}, ...) or jarl.is_err(${name}) before reading ${name}.error [Error/oligarchy(result-through-jarl)]`;

describe("oligarchy/result-through-jarl", () => {
  it("accepts jarl reading a result, .error once jarl has named it, and .value/.error on what is not a result (happy)", () => {
    expect(
      lint("result-through-jarl", {
        "handled.ts": `${RESULTS}
export const handled = () => {
  const a = make();
  if (jarl.error.is(a, Boom)) {
    return a.error.message;
  }
  return jarl.value(a);
};

export const earlyExit = () => {
  const b = make();
  if (!jarl.error.is(b, Boom)) {
    return jarl.unwrap(b);
  }
  return b.error.message;
};

export const either = () => {
  const c = make();
  if (jarl.is_ok(c)) {
    return jarl.value(c);
  } else {
    return c.error.message;
  }
};

export const inline = (d: jarl.Result<number, Boom>) => jarl.is_err(d) && d.error.message;

export const ternary = (e: jarl.Result<number, Boom>) =>
  jarl.is_ok(e) ? jarl.value(e) : e.error.message;

export const loop = (f: jarl.Result<number, Boom>) => {
  while (jarl.is_err(f)) {
    console.log(f.error.message);
    f = make();
  }
  return jarl.value(f);
};

export const passed = () => {
  const g = make();
  if (!g.ok) {
    return g;
  }
  return jarl.ok(jarl.value(g) + 1);
};

export const exits = () => {
  const h = make();
  if (!jarl.is_err(h)) {
    process.exit(0);
  }
  const { error } = h;
  return error.message;
};
`,
        "not-results.ts": `import * as jarl from "jarl";
import * as z from "zod";

export const zod = (text: string) => {
  const parsed = z.string().safeParse(text);
  return parsed.success ? parsed.data : parsed.error.message;
};

export const fallback = (v: { readonly fallback: { readonly value: number } }) => v.fallback.value;

export const box = (promise: Promise<unknown>) => {
  const state = { settled: false, value: undefined as unknown };
  void promise.then((value) => {
    state.value = value;
  });
  return jarl.error.is(state.value, Error);
};
`,
      }),
    ).toEqual({ status: 0, messages: [] });
  });

  it("refuses .value on a result anywhere, and .error before jarl has named it (unhappy)", () => {
    const result = lint("result-through-jarl", {
      "refused.ts": `${RESULTS}
export const afterOk = () => {
  const a = make();
  if (!a.ok) {
    return 0;
  }
  return a.value;
};

export const afterIsOk = () => {
  const b = make();
  if (jarl.is_ok(b)) {
    return b.value;
  }
  return 0;
};

export const ternary = () => {
  const c = make();
  return c.ok ? c.value : c.error.message;
};

export const notOk = () => {
  const d = make();
  if (!d.ok) {
    return d.error.message;
  }
  return 0;
};

export const named = () => {
  const e = make();
  return jarl.error.is(e.error, Boom);
};

export const param = (f: jarl.Result<number, Boom>) => String(f.error);

export const destructured = () => {
  const g: jarl.Result<number, Boom> = make();
  const { value, error } = g;
  return [value, error];
};

export const another = () => {
  const h = make();
  const i: jarl.Result<number, Boom> = make();
  if (jarl.is_err(h)) {
    return i.error;
  }
  return 0;
};

export const wrongWay = () => {
  const j = make();
  if (jarl.is_err(j)) {
    return 0;
  }
  return j.error;
};
`,
    });
    expect(result.status).toBe(1);
    expect(result.messages).toEqual(
      [
        valueRefused("a"),
        valueRefused("b"),
        valueRefused("c"),
        errorRefused("c"),
        errorRefused("d"),
        errorRefused("e"),
        errorRefused("f"),
        valueRefused("g"),
        errorRefused("g"),
        errorRefused("i"),
        errorRefused("j"),
      ].sort(),
    );
  });
});
