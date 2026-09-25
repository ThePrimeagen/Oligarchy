import { execFileSync } from "node:child_process";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";
import * as DbSchema from "@oligarchy/db/schema";
import * as Postgres from "../support/postgres.ts";

// Whatever DATABASE_URL the machine carries, a test and every process it spawns see the test
// database instead: this file's copy in the container, or a local port nothing listens on when
// Docker is absent.
const inherited = (): string =>
  execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.DATABASE_URL ?? '')"], {
    env: process.env,
    encoding: "utf8",
  });

const withDb = async <A>(url: string, use: (db: NodePgDatabase) => Promise<A>): Promise<A> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await use(drizzle({ client }));
  } finally {
    await client.end();
  }
};

describe("the database the tests see", () => {
  it.skipIf(Postgres.getDbUrl() === "")(
    "is this file's own copy of the container's database, in the test process and in a spawned one",
    () => {
      const own = new URL(Postgres.getDbUrl());
      const template = new URL(inject("databaseTemplateUrl"));
      expect(own.host).toBe(template.host);
      expect(own.pathname).not.toBe(template.pathname);
      expect(process.env.DATABASE_URL).toBe(Postgres.getDbUrl());
      expect(inherited()).toBe(Postgres.getDbUrl());
      expect(["localhost", "127.0.0.1"]).toContain(own.hostname);
    },
  );

  // Every table a test counts across: rows another file left in any of them once decided a
  // result by which file vitest happened to run first.
  it.skipIf(Postgres.getDbUrl() === "")(
    "starts with the migrations and the seed and nothing else, whatever file ran before it",
    async () => {
      const found = await withDb(Postgres.getDbUrl(), async (db) => ({
        sessions: (
          await db
            .select({ id: DbSchema.sessions.id })
            .from(DbSchema.sessions)
            .orderBy(DbSchema.sessions.id)
        ).map((row) => row.id),
        definitions: (
          await db.select({ name: DbSchema.testDefinitions.name }).from(DbSchema.testDefinitions)
        ).map((row) => row.name),
        servers: await db.$count(DbSchema.servers),
        processStats: await db.$count(DbSchema.processStats),
        setupRequests: await db.$count(DbSchema.setupRequests),
        testRuns: await db.$count(DbSchema.testRuns),
        automationJobs: await db.$count(DbSchema.automationJobs),
      }));
      expect(found).toEqual({
        sessions: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
        definitions: ["lock-screen"],
        servers: 0,
        processStats: 0,
        setupRequests: 0,
        testRuns: 0,
        automationJobs: 0,
      });
    },
  );

  it.skipIf(Postgres.getDbUrl() === "")(
    "refuses a connection to the template, so no test can write into what the next file copies (unhappy)",
    async () => {
      const client = new Client({ connectionString: inject("databaseTemplateUrl") });
      await expect(client.connect()).rejects.toThrow(
        'database "oligarchy_template" is not currently accepting connections',
      );
    },
  );

  it.skipIf(Postgres.getDbUrl() !== "")(
    "is a local port nothing listens on when Docker is absent, never the ambient url",
    () => {
      const url = process.env.DATABASE_URL ?? "";
      expect(new URL(url).host).toBe("127.0.0.1:1");
      expect(inherited()).toBe(url);
    },
  );
});
