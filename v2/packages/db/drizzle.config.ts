import { defineConfig } from "drizzle-kit";

// v2's migrations are generated from src/schema.ts and append-only; 0001_init is the whole schema
// v1's migrations had built. v1 keeps its own journal in the same database, so v2's is a table of
// its own: one history never decides which of the other's migrations look applied.
// DATABASE_MIGRATION_URL, never DATABASE_URL: the programs may go through a pooler, and a
// migration needs a direct connection.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_v2" },
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
});
