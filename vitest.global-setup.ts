import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

let container: StartedPostgreSqlContainer | undefined;

// Tests never see production data: DATABASE_URL is replaced before any test runs, and the test
// workers and everything they spawn inherit it. It names a port nothing listens on until a file
// takes its own copy of the database (test/support/postgres.ts).
const NO_DATABASE = "postgres://test:test@127.0.0.1:1/oligarchy";

// Not the container's own database: the container's health check connects to that one every
// 250 ms, and Postgres refuses to copy a database while anyone is connected to it.
const TEMPLATE = "oligarchy_template";

const withClient = async <A>(url: string, use: (client: Client) => Promise<A>): Promise<A> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

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
    project.provide("databaseTemplateUrl", "");
    return;
  }
  const admin = container.getConnectionUri();
  const template = new URL(admin);
  template.pathname = `/${TEMPLATE}`;
  await withClient(admin, (client) => client.query(`create database ${TEMPLATE}`));
  await withClient(template.toString(), async (client) => {
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    await client.query(
      `insert into test_definitions (name, description, instruction, proof) values ('lock-screen', 'd', 'i', 'p')`,
    );
    await client.query(`insert into test_base_prompts (name, prompt) values ('base', 'p')`);
    await client.query(
      `insert into sessions (id, config, status) values ('11111111-1111-4111-8111-111111111111', '{"iso":"x"}', 'succeeded'), ('22222222-2222-4222-8222-222222222222', '{"iso":"y"}', 'running')`,
    );
  });
  // From here on it is only copied: with connections refused, no test can write into it or hold
  // it open while the next file copies it.
  await withClient(admin, (client) =>
    client.query(`alter database ${TEMPLATE} with is_template true allow_connections false`),
  );
  project.provide("databaseTemplateUrl", template.toString());
};

export const teardown = async () => {
  await container?.stop();
};
