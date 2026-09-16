import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";

const root = join(import.meta.dirname, "../..");

const read = (file: string): string => readFileSync(join(root, file), "utf8");

const PackageJson = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

const TsConfig = Schema.Struct({
  compilerOptions: Schema.Struct({ erasableSyntaxOnly: Schema.Boolean }),
});

const decodePackageJson = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));
const decodeTsConfig = Schema.decodeUnknownSync(Schema.fromJsonString(TsConfig));

// Every process, and whether its wrapper and script preload Sentry before any Effect code runs.
const PROCESSES = {
  client: false,
  session: false,
  viz: false,
  ctrl: true,
  "qemu-server": true,
  "qemu-reverse-proxy": true,
  "automation-server": true,
  "automation-client": true,
};
const INSTRUMENT = "src/observability/instrument.ts";
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
  // environment lacks.
  it("runs every process on bun from its entry, Sentry preloaded on the instrumented ones", () => {
    for (const [name, instrumented] of Object.entries(PROCESSES)) {
      const script = scripts[name] ?? "";
      expect(script.startsWith("bun --no-env-file "), name).toBe(true);
      expect(script.endsWith(` src/${name}/main.ts`), name).toBe(true);
      expect(script.includes(`--preload ./${INSTRUMENT}`), name).toBe(instrumented);
    }
    expect(scripts["db:migrate"]).toBe("bun --no-env-file src/db/migrate.ts");
  });

  // `bun run` hands a node-shebang bin to Node when one is installed; vitest and its forked
  // workers must run on the runtime the wrappers run.
  it("forces vitest onto bun in both lanes", () => {
    expect(scripts["test:unit"]).toMatch(/^bun --bun vitest run /);
    expect(scripts["test:integration"]).toMatch(/^bun --bun vitest run /);
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
});

// The root executables are the operators' entry points: each is a sh wrapper handing its
// arguments to bun on the process's entry, the instrumented ones loading Sentry first.
describe("root executables", () => {
  it("each execs bun on its entry, preloading Sentry on the instrumented ones, never node", () => {
    for (const [name, instrumented] of Object.entries(PROCESSES)) {
      if (name === "client") {
        continue;
      }
      const wrapper = read(name);
      expect(wrapper.startsWith("#!/bin/sh\n"), name).toBe(true);
      expect(wrapper, name).toContain("exec bun --no-env-file ");
      expect(wrapper, name).toContain(`"$(dirname "$0")/src/${name}/main.ts" "$@"`);
      expect(wrapper.includes(`--preload "$(dirname "$0")/${INSTRUMENT}"`), name).toBe(
        instrumented,
      );
      expect(wrapper, name).not.toMatch(NOT_BUN);
    }
  });

  // A driving agent calls ./client many times per task, so it runs one bundle with a bytecode
  // cache instead of loading three hundred modules each time; the bundle is rebuilt when a source
  // is newer, and the sources run as they are when the build fails.
  it("client runs a bytecode bundle built under node_modules/.cache, its entry when the build fails", () => {
    const wrapper = read("client");
    expect(wrapper.startsWith("#!/bin/sh\n")).toBe(true);
    expect(wrapper).toContain("bun build --target=bun --bytecode ");
    expect(wrapper).toContain('"$root/src/client/main.ts"');
    expect(wrapper).toContain("node_modules/.cache/oligarchy/client");
    expect(wrapper).toContain('exec bun --no-env-file "$cache/main.js" "$@"');
    expect(wrapper).toContain('exec bun --no-env-file "$root/src/client/main.ts" "$@"');
    expect(wrapper).not.toContain("--preload");
    expect(wrapper).not.toMatch(NOT_BUN);
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

describe("tsconfig.json", () => {
  const { compilerOptions } = decodeTsConfig(read("tsconfig.json"));

  it("keeps the sources to syntax a type stripper can erase", () => {
    expect(compilerOptions.erasableSyntaxOnly).toBe(true);
  });
});
