import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";

const root = join(import.meta.dirname, "../..");

const read = (file: string): string => readFileSync(join(root, file), "utf8");

const PackageJson = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

const TsConfig = Schema.Struct({
  extends: Schema.optionalKey(Schema.String),
  compilerOptions: Schema.optionalKey(
    Schema.Struct({ erasableSyntaxOnly: Schema.optionalKey(Schema.Boolean) }),
  ),
});
type TsConfig = typeof TsConfig.Type;

// A rule is its level, or its level followed by its options.
const OxlintConfig = Schema.Struct({
  plugins: Schema.Array(Schema.String),
  rules: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.String,
      Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Json]),
    ]),
  ),
});
type OxlintConfig = typeof OxlintConfig.Type;

const decodePackageJson = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));
const decodeTsConfig = Schema.decodeUnknownSync(Schema.fromJsonString(TsConfig));
const decodeOxlintConfig = Schema.decodeUnknownSync(Schema.fromJsonString(OxlintConfig));

// Two files importing each other is the one dependency loop a linter can see file by file; the
// package graph is a repo test (architecture.unit.test.ts). On as an error, so the loop fails
// check:lint even when --deny-warnings is forgotten.
const cycleRuleProblems = (config: OxlintConfig): ReadonlyArray<string> => {
  const rule = config.rules["import/no-cycle"];
  const level = typeof rule === "string" ? rule : rule?.[0];
  return [
    ...(config.plugins.includes("import") ? [] : ['plugins lacks "import"']),
    ...(level === undefined ? ["import/no-cycle is not set"] : []),
    ...(level !== undefined && level !== "error" ? [`import/no-cycle is ${level}`] : []),
  ];
};

const WORKSPACES = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`);

// Every process and what its wrapper and script preload before the entry loads: Sentry on the
// instrumented ones, and on viz the Solid JSX transform its OpenTUI components are written for.
const INSTRUMENT = "src/observability/instrument.ts";
const SOLID_JSX = "src/viz/preload.ts";
const PROCESSES: Readonly<Record<string, ReadonlyArray<string>>> = {
  client: [],
  driver: [],
  session: [],
  viz: [SOLID_JSX],
  ctrl: [INSTRUMENT],
  "qemu-server": [INSTRUMENT],
  "qemu-reverse-proxy": [INSTRUMENT],
  "automation-server": [INSTRUMENT],
  "automation-client": [INSTRUMENT],
};
const count = (text: string, needle: string): number => text.split(needle).length - 1;
// Bun runs the sources as they are: no Node, no npm, none of Node's loader flags.
const NOT_BUN = /\bnode\b|\bnpm\b|\bnpx\b|--experimental-strip-types|--import\b/;

describe("package.json scripts", () => {
  const { scripts } = decodePackageJson(read("package.json"));

  it("exposes the check and test scripts by their full names", () => {
    for (const name of [
      "check:lint",
      "check:format",
      "check:types",
      "test:unit",
      "test:integration",
      "check:fast",
    ]) {
      expect(scripts[name], name).toBeDefined();
    }
  });

  it("has no bare check, test or lint script", () => {
    expect(scripts.check).toBeUndefined();
    expect(scripts.test).toBeUndefined();
    expect(scripts.lint).toBeUndefined();
  });

  // --no-env-file on every process: Bun's own loader would read `.env.local` as well and expand
  // `$` inside values, where the config provider reads `.env` alone, as written, for what the
  // environment lacks, plus `--env-file` when one was passed.
  it("runs every process on bun from its entry with exactly the preloads it needs", () => {
    for (const [name, preloads] of Object.entries(PROCESSES)) {
      const script = scripts[name] ?? "";
      expect(script.startsWith("bun --no-env-file "), name).toBe(true);
      expect(script.endsWith(` src/${name}/main.ts`), name).toBe(true);
      for (const preload of preloads) {
        expect(script, name).toContain(`--preload ./${preload}`);
      }
      expect(count(script, "--preload"), name).toBe(preloads.length);
    }
    expect(scripts["db:migrate"]).toBe("bun --no-env-file src/db/migrate.ts");
  });

  // `bun run` hands a node-shebang bin to Node when one is installed; vitest and its forked
  // workers must run on the runtime the wrappers run.
  it("forces vitest onto bun in both lanes", () => {
    expect(scripts["test:unit"]).toMatch(/^bun --bun vitest run /);
    expect(scripts["test:integration"]).toMatch(/^bun --bun vitest run /);
  });

  // check:fast is what CI runs: a package whose types and tests it never ran would go stale.
  it("check:types and test:unit run the root's own lane, then every workspace package's", () => {
    expect(scripts["check:types"]).toMatch(/ && bun run --workspaces check:types$/);
    expect(scripts["test:unit"]).toMatch(/ && bun run --workspaces test:unit$/);
  });

  it("names no other runtime, package manager or Node flag anywhere", () => {
    for (const [name, script] of Object.entries(scripts)) {
      expect(script, name).not.toMatch(NOT_BUN);
    }
  });

  it("db:migrate runs the migration program and never a drizzle push", () => {
    expect(scripts["db:migrate"]).toContain(" src/db/migrate.ts");
    expect(Object.values(scripts).some((script) => script.includes("drizzle-kit push"))).toBe(
      false,
    );
  });

  // The named file is the one that migrates: an already-exported DATABASE_MIGRATION_URL is
  // dropped, or a shell that sourced the other file would win and migrate the wrong database.
  it("prod:db:migrate and test:db:migrate each migrate from their own env file (happy)", () => {
    expect(scripts["prod:db:migrate"]).toBe(
      "env -u DATABASE_MIGRATION_URL bun --no-env-file src/db/migrate.ts --env-file .prod-env",
    );
    expect(scripts["test:db:migrate"]).toBe(
      "env -u DATABASE_MIGRATION_URL bun --no-env-file src/db/migrate.ts --env-file .env",
    );
  });

  it("neither migrate script points at the other environment (unhappy)", () => {
    expect(scripts["prod:db:migrate"] ?? "").not.toMatch(/--env-file \.env$/);
    expect(scripts["test:db:migrate"] ?? "").not.toContain(".prod-env");
    expect(scripts["prod:db:migrate"] ?? "").not.toContain("drizzle-kit");
    expect(scripts["test:db:migrate"] ?? "").not.toContain("drizzle-kit");
  });
});

// The root executables are the operators' entry points: each is a sh wrapper handing its
// arguments to bun on the process's entry, the instrumented ones loading Sentry first.
describe("root executables", () => {
  // The preload is named from the wrapper's own directory: an operator runs ./viz from anywhere.
  it("each execs bun on its entry with exactly the preloads it needs, never node", () => {
    for (const [name, preloads] of Object.entries(PROCESSES)) {
      if (name === "client" || name === "driver") {
        continue;
      }
      const wrapper = read(name);
      expect(wrapper.startsWith("#!/bin/sh\n"), name).toBe(true);
      expect(wrapper, name).toContain("exec bun --no-env-file ");
      expect(wrapper, name).toContain(`"$(dirname "$0")/src/${name}/main.ts" "$@"`);
      for (const preload of preloads) {
        expect(wrapper, name).toContain(`--preload "$(dirname "$0")/${preload}"`);
      }
      expect(count(wrapper, "--preload"), name).toBe(preloads.length);
      expect(wrapper, name).not.toMatch(NOT_BUN);
    }
  });

  // ./client is called many times per task, and ./driver is the harness entry: each runs one
  // bundle with a bytecode cache. The bundle is rebuilt when a source is newer, and the sources
  // run as they are when the build fails.
  it("client and driver run a bytecode bundle built under node_modules/.cache, the entry when the build fails", () => {
    for (const name of ["client", "driver"]) {
      const wrapper = read(name);
      expect(wrapper.startsWith("#!/bin/sh\n"), name).toBe(true);
      expect(wrapper, name).toContain("bun build --target=bun --bytecode ");
      // The bundle holds the workspace packages the entry imports, so their sources count too.
      expect(wrapper, name).toContain(`find "$root/src" "$root/packages" `);
      expect(wrapper, name).toContain(`"$root/src/${name}/main.ts"`);
      expect(wrapper, name).toContain(`node_modules/.cache/oligarchy/${name}`);
      expect(wrapper, name).toContain('exec bun --no-env-file "$cache/main.js" "$@"');
      expect(wrapper, name).toContain(`exec bun --no-env-file "$root/src/${name}/main.ts" "$@"`);
      expect(wrapper, name).toContain(`${name}: bundle build failed; running the sources`);
      expect(wrapper, name).not.toContain("--preload");
      expect(wrapper, name).not.toMatch(NOT_BUN);
    }
    const driver = read("driver");
    expect(driver).toContain("/src/harness/config.ts");
    expect(driver).toContain("--define");
  });
});

const Journal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ idx: Schema.Number, tag: Schema.String })),
});
const decodeJournal = Schema.decodeUnknownSync(Schema.fromJsonString(Journal));

describe("drizzle migrations", () => {
  it("journal tags match the sql files one-to-one, and idx matches the tag prefix", () => {
    const journal = decodeJournal(read("drizzle/meta/_journal.json"));
    const sqls = readdirSync(join(root, "drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(sqls).toEqual(journal.entries.map((entry) => `${entry.tag}.sql`));
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((entry) => Number(entry.tag.slice(0, 4))),
    );
  });
});

describe(".oxlintrc.json", () => {
  it("never downgrades a rule to warn", () => {
    expect(readFileSync(join(root, ".oxlintrc.json"), "utf8")).not.toContain('"warn"');
  });

  it("turns import/no-cycle on as an error (happy)", () => {
    expect(cycleRuleProblems(decodeOxlintConfig(read(".oxlintrc.json")))).toEqual([]);
  });

  it("names a config without the plugin, without the rule, or with it off (unhappy)", () => {
    expect(cycleRuleProblems({ plugins: ["typescript"], rules: {} })).toEqual([
      'plugins lacks "import"',
      "import/no-cycle is not set",
    ]);
    expect(cycleRuleProblems({ plugins: ["import"], rules: { "import/no-cycle": "off" } })).toEqual(
      ["import/no-cycle is off"],
    );
    expect(
      cycleRuleProblems({
        plugins: ["import"],
        rules: { "import/no-cycle": ["warn", { ignoreTypes: true }] },
      }),
    ).toEqual(["import/no-cycle is warn"]);
  });
});

describe(".github/workflows/migrations.yml", () => {
  const workflow = read(".github/workflows/migrations.yml");

  // The code lives at the root; a job that runs or scans a directory that is not there fails
  // every pull request before its first step.
  it("runs every job where the code lives and scans the migrations that exist", () => {
    const scanned = [
      ...workflow.matchAll(/working-directory:\s*(\S+)/g),
      ...workflow.matchAll(/find (\S+)/g),
      ...workflow.matchAll(/'(?::\(exclude\))?([^']*drizzle\/[^']*)'/g),
    ].map(([, path]) => path);
    expect(scanned.length).toBeGreaterThan(0);
    for (const path of scanned) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
    expect(workflow.includes("v2/")).toBe(false);
  });

  // A job that installs with anything but bun from the committed lockfile runs a different
  // dependency tree from the one the wrappers run.
  it("installs with bun from the committed lockfile and runs nothing through node or npm", () => {
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).not.toMatch(NOT_BUN);
    expect(existsSync(join(root, "bun.lock"))).toBe(true);
    expect(existsSync(join(root, "package-lock.json"))).toBe(false);
  });
});

describe("fleet starters", () => {
  // The first signal asks. A child waiting on a response must not make the second do nothing.
  it("a second signal kills both children", () => {
    for (const name of ["start-automation-server-client", "start-server-proxy-client"]) {
      const script = read(name);
      expect(script, name).toContain("kill -TERM");
      expect(script, name).toContain("kill -KILL");
      expect(script, name).not.toContain("trap '' INT TERM");
    }
  });
});

// A workspace package owns its lanes, and check:fast reaches them through `bun run --workspaces`,
// so each names both, and runs vitest on bun as the root does.
const laneProblems = (scripts: Readonly<Record<string, string>>): ReadonlyArray<string> => [
  ...["check:types", "test:unit"].filter((name) => scripts[name] === undefined),
  ...(scripts["test:unit"] === undefined || /^bun --bun vitest run\b/.test(scripts["test:unit"])
    ? []
    : ["test:unit does not run vitest on bun"]),
  ...Object.entries(scripts)
    .filter(([, script]) => NOT_BUN.test(script))
    .map(([name]) => `${name} names another runtime`),
];

describe("workspace packages", () => {
  it("each has its own check:types and test:unit lanes on bun (happy)", () => {
    expect(WORKSPACES.length).toBeGreaterThan(0);
    for (const dir of WORKSPACES) {
      expect(laneProblems(decodePackageJson(read(`${dir}/package.json`)).scripts), dir).toEqual([]);
    }
  });

  it("names a missing lane, vitest off bun and a script on node (unhappy)", () => {
    expect(laneProblems({})).toEqual(["check:types", "test:unit"]);
    expect(laneProblems({ "check:types": "npx tsc --noEmit", "test:unit": "vitest run" })).toEqual([
      "test:unit does not run vitest on bun",
      "check:types names another runtime",
    ]);
  });
});

// Every package compiles under the one base, so none can write syntax Bun's stripper cannot erase.
const baseProblems = (file: string, config: TsConfig): ReadonlyArray<string> => [
  ...(config.extends !== undefined && join(dirname(file), config.extends) === "tsconfig.base.json"
    ? []
    : [`${file} does not extend tsconfig.base.json`]),
  ...(config.compilerOptions?.erasableSyntaxOnly === false
    ? [`${file} turns off erasableSyntaxOnly`]
    : []),
];

describe("tsconfig", () => {
  it("keeps the sources to syntax a type stripper can erase", () => {
    expect(decodeTsConfig(read("tsconfig.base.json")).compilerOptions?.erasableSyntaxOnly).toBe(
      true,
    );
  });

  it("the root and every workspace package extend the base (happy)", () => {
    for (const file of ["tsconfig.json", ...WORKSPACES.map((dir) => `${dir}/tsconfig.json`)]) {
      expect(baseProblems(file, decodeTsConfig(read(file)))).toEqual([]);
    }
  });

  it("names a tsconfig that extends nothing or turns erasable syntax off (unhappy)", () => {
    expect(baseProblems("packages/x/tsconfig.json", {})).toEqual([
      "packages/x/tsconfig.json does not extend tsconfig.base.json",
    ]);
    expect(
      baseProblems("packages/x/tsconfig.json", {
        extends: "../../tsconfig.base.json",
        compilerOptions: { erasableSyntaxOnly: false },
      }),
    ).toEqual(["packages/x/tsconfig.json turns off erasableSyntaxOnly"]);
  });
});
