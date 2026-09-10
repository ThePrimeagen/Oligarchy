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

  it("db:migrate runs the migration program and never a drizzle push", () => {
    expect(scripts["db:migrate"]).toBe("node --experimental-strip-types src/db/migrate.ts");
    expect(Object.values(scripts).some((script) => script.includes("drizzle-kit push"))).toBe(
      false,
    );
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
  });
});

describe("tsconfig.json", () => {
  const { compilerOptions } = decodeTsConfig(read("tsconfig.json"));

  it("forbids syntax Node cannot strip", () => {
    expect(compilerOptions.erasableSyntaxOnly).toBe(true);
  });
});
