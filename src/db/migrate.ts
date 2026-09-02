import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, connectDatabase } from "./ops.ts";

async function main(): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }
  const db = connectDatabase();
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await closeDatabase(db);
  }
  console.log("database migrations applied");
}

await main();
