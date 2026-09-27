import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { Client } from "pg";
import { describe, expect, inject, it, onTestFinished } from "vitest";
import * as Db from "../src/main.ts";
import { databaseUrl, poolErrors, UNREACHABLE } from "./support.ts";

const PASSWORD = "pa55w0rd-sentinel";
const ADMIN = inject("postgresUrl");

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
    await db.close();
  });
  return db;
};

const unreachable = `postgres://oligarchy:${PASSWORD}@${UNREACHABLE}/oligarchy`;

const selectOne = (db: Db.Database) =>
  db.run(async (drizzle) => {
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

describe("run", () => {
  it("carries the driver's reason for an unreachable database, never the password (unhappy)", async () => {
    const errors = poolErrors();
    const db = await opened(unreachable, errors.onPoolError);
    const selected = await selectOne(db);
    if (!jarl.error.is(selected, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
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
