import { defineConfig } from "drizzle-kit";

// `drizzle-kit migrate` applies v1's migrations: they are generated from packages/db/src/schema.ts
// and append-only, so v1 and v2 keep one journal. drizzle-kit resolves `out` from the working
// directory, which `bun run db:migrate` sets to this package. DATABASE_MIGRATION_URL, never
// DATABASE_URL: the programs may go through a pooler, and a migration needs a direct connection.
export default defineConfig({
  dialect: "postgresql",
  out: "../../../packages/db/drizzle",
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
});
