import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { closeDatabase, connectDatabase } from "./db/ops.ts";
import { testDefinitions } from "./db/schema.ts";

export async function listTestDefinitions(): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const db = connectDatabase();
  try {
    const rows = await db.select({ name: testDefinitions.name }).from(testDefinitions).orderBy(testDefinitions.name);
    for (const row of rows) {
      console.log(row.name);
    }
  } finally {
    await closeDatabase(db);
  }
}
