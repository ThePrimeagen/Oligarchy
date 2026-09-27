import { relative, resolve } from "node:path";
import * as Env from "@oligarchy/env";
import { defineConfig } from "drizzle-kit";

// Written from the repo root, handed over relative to the working directory: drizzle-kit reads a
// snapshot at `./${out}/...`, which an absolute path breaks.
const fromHere = (path: string) => relative(process.cwd(), resolve(Env.ROOT, path));

// v2's migrations are generated from src/schema.ts and append-only; 0001_init is the whole schema
// v1's migrations had built. v1 keeps its own journal in the same database, so v2's is a table of
// its own: one history never decides which of the other's migrations look applied.
// DATABASE_MIGRATION_URL, never DATABASE_URL: the programs may go through a pooler, and a
// migration needs a direct connection.
export default defineConfig({
  dialect: "postgresql",
  schema: fromHere("v2/packages/db/src/schema.ts"),
  out: fromHere("v2/packages/db/drizzle"),
  migrations: { table: "__drizzle_migrations_v2" },
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
});
