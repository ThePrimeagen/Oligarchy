import { readFileSync } from "node:fs";
import type * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as Db from "../src/main.ts";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");
const UNREACHABLE = "postgres://postgres@127.0.0.1:1/postgres";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

// The url as env hands it to a program.
const secret = async (url: string) =>
  jarl.unwrap(
    await Env.create(
      Env.cli({ name: "db-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  ).vars.databaseUrl;

const created = async (url: string) => {
  const db = Db.create({}, { url: await secret(url) });
  cleanups.push(() => db.close());
  return db;
};

// A database of the test's own, with one idle connection the pool keeps open.
const connected = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const db = await created(fake.url);
  jarl.unwrap(await db.run((d) => d.execute(sql`select 1`)));
  return { fake, db };
};

const selectOne = (db: Db.Database) =>
  db.run(async (d) => (await d.execute<{ one: number }>(sql`select 1 as one`)).rows);

describe("the database", () => {
  it("is built at once and answers its queries (happy)", async () => {
    const fake = jarl.unwrap(await FakePostgres.start());
    cleanups.push(() => fake.stop());
    const db = Db.create({}, { url: await secret(fake.url) });

    expectTypeOf(db).toEqualTypeOf<App.Made<Db.Database>>();
    expect(db.service).toBe("db");
    expect(jarl.unwrap(await selectOne(db))).toEqual([{ one: 1 }]);
    expect(jarl.is_ok(await db.close())).toBe(true);
  });

  it("is built even when nothing can reach it, and fails at its first query as a DatabaseError (unhappy)", async () => {
    const db = await created(UNREACHABLE);

    const answered = await selectOne(db);

    if (!jarl.error.is(answered, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(answered.error.message).toMatch(/ECONNREFUSED/);
  });
});

describe("the database's pool errors", () => {
  it("every listener hears an idle connection the server drops, in the order they listened (happy)", async () => {
    const { fake, db } = await connected();
    const heard: Array<{ readonly who: string; readonly error: Error }> = [];
    db.onPoolError((error) => heard.push({ who: "first", error }));
    db.onPoolError((error) => heard.push({ who: "second", error }));

    await fake.stop();

    await vi.waitFor(() => {
      expect(heard.map(({ who }) => who)).toEqual(["first", "second"]);
    });
    expect(heard[0]?.error).toBeInstanceOf(Error);
    expect(heard[1]?.error).toBe(heard[0]?.error);
  });

  it("a listener that unsubscribed hears nothing, and unsubscribing twice is harmless (unhappy)", async () => {
    const { fake, db } = await connected();
    const gone: Array<Error> = [];
    const witness: Array<Error> = [];
    const off = db.onPoolError((error) => gone.push(error));
    db.onPoolError((error) => witness.push(error));
    off();
    off();

    await fake.stop();

    await vi.waitFor(() => {
      expect(witness).toHaveLength(1);
    });
    expect(gone).toEqual([]);
  });

  it("with no listener, a dropped connection does not end the process, and the next query is a DatabaseError (unhappy)", async () => {
    const { fake, db: witnessed } = await connected();
    const unheard = await created(fake.url);
    jarl.unwrap(await selectOne(unheard));
    const witness: Array<Error> = [];
    witnessed.onPoolError((error) => witness.push(error));

    await fake.stop();

    await vi.waitFor(() => {
      expect(witness).toHaveLength(1);
    });
    await vi.waitFor(async () => {
      expect(jarl.error.is(await selectOne(unheard), Db.DatabaseError)).toBe(true);
    });
  });
});
