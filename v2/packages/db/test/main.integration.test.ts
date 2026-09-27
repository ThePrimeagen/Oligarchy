import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { Client } from "pg";
import { describe, expect, inject, it, onTestFinished } from "vitest";
import * as Db from "../src/main.ts";
import { databaseUrl, poolErrors, UNREACHABLE } from "./support.ts";

const PASSWORD = "pa55w0rd-sentinel";
const ADMIN = inject("postgresUrl");

// v1's migrations, the ones migrate applies.
const JOURNAL: { entries: ReadonlyArray<unknown> } = JSON.parse(
  readFileSync(
    new URL("../../../../packages/db/drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
);

const rows = async (url: string, text: string): Promise<Array<Record<string, unknown>>> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
};

// Each test works in an empty database of its own, so no test sees another's tables.
const freshDatabase = async (): Promise<{ name: string; url: string }> => {
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  await rows(ADMIN, `create database ${name}`);
  const url = new URL(ADMIN);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
};

const opened = async (url: string, onPoolError = poolErrors().onPoolError) => {
  const result = Db.open({ url: await databaseUrl(url), onPoolError });
  if (!result.ok) {
    throw result.error;
  }
  const db = result.value;
  onTestFinished(async () => {
    await Db.close(db);
  });
  return db;
};

const unreachable = `postgres://oligarchy:${PASSWORD}@${UNREACHABLE}/oligarchy`;

const selectOne = (db: Db.Database) =>
  Db.run(db, "selectOne", async (drizzle) => {
    await drizzle.execute(sql`select 1`);
  });

describe("open", () => {
  it("connects with a url carrying sslrootcert=system, which node-postgres reads as a path (happy)", async () => {
    const { url } = await freshDatabase();
    const db = await opened(`${url}?sslrootcert=system`);
    expect(await selectOne(db)).toEqual(jarl.ok(undefined));
  });

  it("keeps the rest of the url: sslmode=require still asks this server for TLS (unhappy)", async () => {
    const { url } = await freshDatabase();
    const db = await opened(`${url}?sslmode=require&sslrootcert=system`);
    const selected = await selectOne(db);
    if (!jarl.error.is(selected, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(selected.error.message).toContain("The server does not support SSL connections");
  });

  it("keeps an sslrootcert that names a file, and reads that file (unhappy)", async () => {
    const { url } = await freshDatabase();
    const db = await opened(`${url}?sslrootcert=/nonexistent/ca.pem`);
    const selected = await selectOne(db);
    if (!jarl.error.is(selected, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(selected.error.message).toContain(
      "ENOENT: no such file or directory, open '/nonexistent/ca.pem'",
    );
  });
});

describe("migrate", () => {
  it("applies every migration to an empty database, and a second run applies none (happy)", async () => {
    const { url } = await freshDatabase();
    const db = await opened(url);
    const applied = "select count(*)::int as count from drizzle.__drizzle_migrations";

    expect(await Db.migrate(db)).toEqual(jarl.ok(undefined));
    expect(await rows(url, applied)).toEqual([{ count: JOURNAL.entries.length }]);
    expect(await rows(url, "select to_regclass('public.sessions') is not null as made")).toEqual([
      { made: true },
    ]);

    expect(await Db.migrate(db)).toEqual(jarl.ok(undefined));
    expect(await rows(url, applied)).toEqual([{ count: JOURNAL.entries.length }]);
  });

  it("fails on an unreachable database with the driver's reason (unhappy)", async () => {
    const db = await opened(unreachable);
    const migrated = await Db.migrate(db);
    if (!jarl.error.is(migrated, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(migrated.error.message).toMatch(/^migrate: /);
    expect(migrated.error.message).toContain(`ECONNREFUSED ${UNREACHABLE}`);
  });
});

describe("run", () => {
  it("hands the query drizzle over the live database (happy)", async () => {
    const db = await opened((await freshDatabase()).url);
    const ran = await Db.run(db, "answer", async (drizzle) => {
      const result = await drizzle.execute<{ answer: number }>(sql`select 41 + 1 as answer`);
      return result.rows;
    });
    expect(ran).toEqual(jarl.ok([{ answer: 42 }]));
  });

  it("carries the driver's reason for an unreachable database, never the password (unhappy)", async () => {
    const errors = poolErrors();
    const db = await opened(unreachable, errors.onPoolError);
    const selected = await selectOne(db);
    if (!jarl.error.is(selected, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(selected.error.message).toMatch(/^selectOne: /);
    expect(selected.error.message).toContain(`ECONNREFUSED ${UNREACHABLE}`);
    expect(inspect(selected.error)).not.toContain(PASSWORD);
    expect(String(selected.error)).not.toContain(PASSWORD);
    // A refused connect is the query's failure, not an error of the pool.
    expect(errors.seen).toEqual([]);
  });
});

describe("the pool", () => {
  it("reports a connection the server drops, and the next query connects again (unhappy)", async () => {
    const { name, url } = await freshDatabase();
    const errors = poolErrors();
    const db = await opened(url, errors.onPoolError);
    expect(await selectOne(db)).toEqual(jarl.ok(undefined));

    const reported = errors.next();
    await rows(
      ADMIN,
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}'`,
    );
    expect((await reported).message).toMatch(/terminat/);

    expect(await selectOne(db)).toEqual(jarl.ok(undefined));
  });
});
