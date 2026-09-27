import { inspect } from "node:util";
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
    expect(await Db.close(db)).toEqual(jarl.ok(undefined));
  });

  it("refuses a second close with the driver's reason (unhappy)", async () => {
    const db = await opened();
    await Db.close(db);
    const again = await Db.close(db);
    if (!jarl.error.is(again, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(again.error.message).toBe("close: Called end on pool more than once");
  });
});

describe("ping", () => {
  it("fails once the pool is closed, naming the query and the reason (unhappy)", async () => {
    const db = await opened();
    await Db.close(db);
    const pinged = await Db.ping(db);
    if (!jarl.error.is(pinged, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(pinged.error.message).toBe(
      "ping: Failed query: select 1\nparams: : Cannot use a pool after calling end on the pool",
    );
    expect(pinged.error.cause).toBeInstanceOf(Error);
  });
});

describe("run", () => {
  it("answers what the query returns (happy)", async () => {
    const db = await opened();
    expect(await Db.run(db, "answer", async () => 42)).toEqual(jarl.ok(42));
  });

  it("turns a rejected query into a DatabaseError naming the operation and the reason (unhappy)", async () => {
    const db = await opened();
    const reason = new Error(`connect ECONNREFUSED ${UNREACHABLE}`);
    const ran = await Db.run(db, "countTests", async () => {
      throw new Error("Failed query: select count(*) from test_runs", { cause: reason });
    });
    if (!jarl.error.is(ran, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(ran.error.message).toBe(
      `countTests: Failed query: select count(*) from test_runs: connect ECONNREFUSED ${UNREACHABLE}`,
    );
    expect(ran.error.cause).toBe(reason);
  });
});
