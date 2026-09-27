import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Db from "../src/main.ts";
import { databaseUrl, poolErrors, UNREACHABLE } from "./support.ts";

const PASSWORD = "pa55w0rd-sentinel";

// The pool connects on its first query, so none of these reaches the network.
const opened = async () => {
  const result = Db.open({
    url: await databaseUrl(`postgres://oligarchy:${PASSWORD}@${UNREACHABLE}/oligarchy`),
    onPoolError: poolErrors().onPoolError,
  });
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
};

describe("open", () => {
  it("refuses a url that cannot be parsed, and the password appears nowhere (unhappy)", async () => {
    const result = Db.open({
      url: await databaseUrl(`not a url ${PASSWORD}`),
      onPoolError: poolErrors().onPoolError,
    });
    if (!jarl.error.is(result, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(result.error.message).toBe("db: database url is not a valid url");
    const renderings = [
      String(result.error),
      JSON.stringify(result.error),
      inspect(result.error),
      result.error.stack ?? "",
    ];
    for (const rendered of renderings) {
      expect(rendered).not.toContain(PASSWORD);
    }
  });
});

describe("close", () => {
  it("ends a pool that never connected (happy)", async () => {
    const db = await opened();
    expect(await db.close()).toEqual(jarl.ok(undefined));
  });

  it("refuses a second close with the driver's reason (unhappy)", async () => {
    const db = await opened();
    await db.close();
    const again = await db.close();
    if (!jarl.error.is(again, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(again.error.message).toBe("Called end on pool more than once");
  });
});

describe("run", () => {
  it("fails once the pool is closed, naming the query and the reason (unhappy)", async () => {
    const db = await opened();
    await db.close();
    const selected = await db.run((drizzle) => drizzle.execute(sql`select 1`));
    if (!jarl.error.is(selected, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(selected.error.message).toBe(
      "Failed query: select 1\nparams: : Cannot use a pool after calling end on the pool",
    );
    expect(selected.error.cause).toBeInstanceOf(Error);
  });

  it("answers what the query returns (happy)", async () => {
    const db = await opened();
    expect(await db.run(async () => 42)).toEqual(jarl.ok(42));
  });

  it("turns a rejected query into a DatabaseError carrying the driver's reason (unhappy)", async () => {
    const db = await opened();
    const reason = new Error(`connect ECONNREFUSED ${UNREACHABLE}`);
    const ran = await db.run(async () => {
      throw new Error("Failed query: select count(*) from test_runs", { cause: reason });
    });
    if (!jarl.error.is(ran, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(ran.error.message).toBe(
      `Failed query: select count(*) from test_runs: connect ECONNREFUSED ${UNREACHABLE}`,
    );
    expect(ran.error.cause).toBe(reason);
  });
});
