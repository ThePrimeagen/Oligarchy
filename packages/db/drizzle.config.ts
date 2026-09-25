import { defineConfig } from "drizzle-kit";

// Run from this package (`bun run --cwd packages/db db:generate`): drizzle-kit resolves these
// from the working directory.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
