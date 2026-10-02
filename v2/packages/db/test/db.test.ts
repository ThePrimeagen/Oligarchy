import { readFileSync } from "node:fs";
import * as net from "node:net";
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

// A database the test's own relay stands in front of. Once cut is named, the first connection to
// send a query carrying that text is dropped before the query reaches the server, as a server
// that drops the connection at that query would.
const relayed = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const target = new URL(fake.url);
  let cut: string | undefined;
  const relay = net.createServer((client) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    client.on("data", (chunk) => {
      if (cut !== undefined && chunk.toString("latin1").includes(cut)) {
        cut = undefined;
        client.destroy();
        upstream.destroy();
        return;
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => client.write(chunk));
    client.on("error", () => undefined);
    upstream.on("error", () => undefined);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  await new Promise<void>((listening) => relay.listen(0, "127.0.0.1", listening));
  cleanups.push(() => new Promise((closed) => relay.close(closed)));
  const address = relay.address();
  if (address === null || typeof address === "string") {
    throw new Error("the relay has no port");
  }
  const db = await created(`postgres://postgres@127.0.0.1:${String(address.port)}/postgres`);
  jarl.unwrap(await selectOne(db));
  return {
    db,
    cutAt: (text: string) => {
      cut = text;
    },
  };
};

const transact = (db: Db.Database) =>
  db.run((d) => d.transaction(async (tx) => (await tx.execute(sql`select 42 as answer`)).rows));

// A close that never settles is the leak: a connection the pool handed out and never got back.
const closedWithin = (db: Db.Database, ms: number) =>
  Promise.race([
    db.close().then(() => "closed"),
    new Promise((hung) => setTimeout(() => hung("still open"), ms)),
  ]);

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

  it("a query that throws is a DatabaseError carrying what it threw (unhappy)", async () => {
    const db = await created(UNREACHABLE);
    const thrown = new Error("not a row");

    const answered = await db.run(() => Promise.reject(thrown));

    if (!jarl.error.is(answered, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(answered.error.message).toBe("not a row");
    expect(answered.error.cause).toBe(thrown);
  });

  it("once closed, a query and a second close are each a DatabaseError (unhappy)", async () => {
    const { db } = await connected();
    jarl.unwrap(await db.close());

    expect(jarl.error.is(await selectOne(db), Db.DatabaseError)).toBe(true);
    expect(jarl.error.is(await db.close(), Db.DatabaseError)).toBe(true);
  });
});

describe("a transaction whose connection the server drops", () => {
  it("at its begin is a DatabaseError naming the drop, gives its connection back, and the pool goes on and closes (unhappy)", async () => {
    const { db, cutAt } = await relayed();
    cutAt("begin");

    const answered = await transact(db);

    if (!jarl.error.is(answered, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(answered.error.message).toMatch(/begin.*Connection terminated unexpectedly/s);
    expect(jarl.unwrap(await selectOne(db))).toEqual([{ one: 1 }]);
    expect(await closedWithin(db, 2_000)).toBe("closed");
  });

  it("inside its work is a DatabaseError naming the query that failed, not its rollback, and the pool goes on and closes (unhappy)", async () => {
    const { db, cutAt } = await relayed();
    cutAt("select 42");

    const answered = await transact(db);

    if (!jarl.error.is(answered, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(answered.error.message).toMatch(/select 42.*Connection terminated unexpectedly/s);
    expect(jarl.unwrap(await selectOne(db))).toEqual([{ one: 1 }]);
    expect(await closedWithin(db, 2_000)).toBe("closed");
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
