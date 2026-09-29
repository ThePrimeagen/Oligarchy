import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import * as Db from "../src/main.ts";
import * as Schema from "../src/schema.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const open = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "db-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const poolErrors: Array<string> = [];
  const db = jarl.unwrap(
    Db.open({ url: env.vars.databaseUrl, onPoolError: (error) => poolErrors.push(error.message) }),
  );
  cleanups.push(() => db.close());
  return { fake, db, poolErrors };
};

const RUN = { iso: "omarchy-3.1.iso", serverUrl: "http://qemu-1:8080" };

const runs = (db: Db.Database) => db.run((d) => d.$count(Schema.runs));

describe("transaction", () => {
  it("commits what the work wrote and returns what it returned (happy)", async () => {
    const { db } = await open();

    const made = await db.transaction(async (tx) => {
      await tx.insert(Schema.runs).values(RUN);
      await tx.insert(Schema.runs).values(RUN);
      return "two runs";
    });

    expect(made).toEqual(jarl.ok("two runs"));
    expect(await runs(db)).toEqual(jarl.ok(2));
  });

  it("rolls back when the work throws and gives its connection back, every time (sad)", async () => {
    const { db } = await open();

    // One more than the pool holds: a connection kept by a failed transaction would starve it.
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const refused = await db.transaction(async (tx) => {
        await tx.insert(Schema.runs).values(RUN);
        throw new Error("the work gave up");
      });
      expect(jarl.error.is(refused, Db.DatabaseError)).toBe(true);
      expect(refused.ok ? "" : refused.error.message).toBe("the work gave up");
    }

    expect(await runs(db)).toEqual(jarl.ok(0));
  });

  it("returns a DatabaseError when the database goes away and keeps no connection (sad)", async () => {
    const { fake, db } = await open();
    expect(await runs(db)).toEqual(jarl.ok(0));
    await fake.stop();

    const refused = await db.transaction((tx) => tx.$count(Schema.runs));

    expect(jarl.error.is(refused, Db.DatabaseError)).toBe(true);
    // pool.end waits for every connection handed out, so a kept one never lets it finish.
    expect(await db.close()).toEqual(jarl.ok(undefined));
  });
});
