import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

let container: StartedPostgreSqlContainer | undefined;

// Tests never see production data: DATABASE_URL is replaced before any test runs, and the test
// workers and everything they spawn inherit it. Without Docker it names a port nothing listens on.
const NO_DATABASE = "postgres://test:test@127.0.0.1:1/oligarchy";

export const setup = async (project: TestProject) => {
  process.env.DATABASE_URL = NO_DATABASE;
  try {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
  } catch (failure) {
    if (process.env.CI !== undefined || process.env.OLIGARCHY_REQUIRE_DATABASE === "1") {
      throw failure;
    }
    console.warn(
      "DATABASE CONTAINER SETUP SKIPPED: Docker is not available; database-backed integration tests are skipped.",
    );
    project.provide("dbUrl", "");
    return;
  }
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    await client.query(
      `insert into test_definitions (name, description, instruction, proof) values ('lock-screen', 'd', 'i', 'p')`,
    );
    await client.query(`insert into test_base_prompts (name, prompt) values ('base', 'p')`);
    await client.query(
      `insert into sessions (id, config, status) values ('11111111-1111-4111-8111-111111111111', '{"iso":"x"}', 'succeeded'), ('22222222-2222-4222-8222-222222222222', '{"iso":"y"}', 'running')`,
    );
  } finally {
    await client.end();
  }
  project.provide("dbUrl", url);
};

export const teardown = async () => {
  await container?.stop();
};
