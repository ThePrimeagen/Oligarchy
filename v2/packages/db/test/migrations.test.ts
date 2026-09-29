import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

// 0001_init is the schema v1's migrations had built. v1 still runs on the same database, so
// everything after it stays inside the v2 schema: it alters no v1 table and leans on none.
const AFTER_INIT = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name !== "0001_init.sql")
  .sort();

const inV2 = (statement: string): boolean => {
  if (statement === 'CREATE SCHEMA "v2";') {
    return true;
  }
  const schemas = [...statement.matchAll(/"(\w+)"\."\w+"/g)].map((match) => match[1]);
  return schemas.length > 0 && schemas.every((schema) => schema === "v2");
};

// The statements of a migration that reach outside the v2 schema.
const outside = (text: string): ReadonlyArray<string> =>
  text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "" && !inV2(statement));

describe("migrations", () => {
  it("keeps every migration after 0001_init inside the v2 schema (happy)", () => {
    expect(AFTER_INIT.length).toBeGreaterThan(0);
    for (const name of AFTER_INIT) {
      expect([name, outside(readFileSync(join(MIGRATIONS, name), "utf8"))]).toEqual([name, []]);
    }
  });

  it("names a statement that alters a v1 table or leans on one (sad)", () => {
    const migration = [
      'CREATE TABLE "v2"."jobs" ("id" uuid PRIMARY KEY);',
      'ALTER TABLE "logs" ADD COLUMN "job_id" uuid;',
      'ALTER TABLE "v2"."jobs" ADD CONSTRAINT "fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id");',
      'DROP TABLE "public"."sessions";',
    ].join("--> statement-breakpoint\n");

    expect(outside(migration)).toEqual([
      'ALTER TABLE "logs" ADD COLUMN "job_id" uuid;',
      'ALTER TABLE "v2"."jobs" ADD CONSTRAINT "fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id");',
      'DROP TABLE "public"."sessions";',
    ]);
  });
});
