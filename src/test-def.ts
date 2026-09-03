import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { eq } from "drizzle-orm";
import { closeDatabase, connectDatabase, type Db } from "./db/ops.ts";
import { testDefinitions } from "./db/schema.ts";

export type TestDefinitionRow = typeof testDefinitions.$inferSelect;

export async function selectTestDefinitions(db: Db, name?: string): Promise<TestDefinitionRow[]> {
  const rows =
    name === undefined
      ? await db.select().from(testDefinitions).orderBy(testDefinitions.name)
      : await db.select().from(testDefinitions).where(eq(testDefinitions.name, name));
  if (name !== undefined && rows.length === 0) {
    throw new Error(`test: no test definition named ${name}`);
  }
  return rows;
}

export function printTestDefinitions(rows: TestDefinitionRow[], details: boolean): void {
  if (details) {
    console.log(JSON.stringify(rows));
    return;
  }
  for (const row of rows) {
    console.log(row.name);
  }
}

export async function listTestDefinitions(opts: { details: boolean; name?: string } = { details: false }): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const db = connectDatabase();
  try {
    printTestDefinitions(await selectTestDefinitions(db, opts.name), opts.details);
  } finally {
    await closeDatabase(db);
  }
}
