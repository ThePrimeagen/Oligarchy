import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { Client, DatabaseError } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const running: Array<FakePostgres.FakePostgres> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((fake) => fake.stop()));
});

const started = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  running.push(fake);
  return fake.url;
};

const query = async (url: string, sql: string, params: ReadonlyArray<unknown> = []) => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, [...params])).rows;
  } finally {
    await client.end();
  }
};

// What the database said when it refused a write: its SQLSTATE, and the line naming the key.
const refusal = async (url: string, sql: string, params: ReadonlyArray<unknown> = []) => {
  try {
    await query(url, sql, params);
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { code: error.code, message: error.message, detail: error.detail };
    }
    throw error;
  }
  throw new Error(`the write was stored: ${sql}`);
};

const first = (rows: ReadonlyArray<Record<string, unknown>>) => {
  const [row] = rows;
  if (row === undefined) {
    throw new Error("the query returned no row");
  }
  return row;
};

const suite = async (url: string) =>
  first(
    await query(
      url,
      "insert into test_suites (name, iso, server_url) values ('nightly', 'omarchy.iso', 'http://s1') returning id, status",
    ),
  );

const definition = async (url: string, name = "lock-screen") =>
  first(
    await query(
      url,
      "insert into test_definitions (name, description, instruction, proof) values ($1, '', '', '') returning id",
      [name],
    ),
  );

const TEST = "insert into test_results (suite_id, definition_id) values ($1, $2)";

describe("a test suite and its tests", () => {
  it("a test is stored under its suite and read back by the suite's id; the suite opens pending (happy)", async () => {
    const url = await started();
    const opened = await suite(url);
    const lockScreen = await definition(url);

    await query(url, TEST, [opened["id"], lockScreen["id"]]);

    expect(opened["status"]).toBe("pending");
    expect(
      await query(url, "select definition_id from test_results where suite_id = $1", [
        opened["id"],
      ]),
    ).toEqual([{ definition_id: lockScreen["id"] }]);
  });

  it("a test naming a suite that does not exist is refused (unhappy)", async () => {
    const url = await started();
    const lockScreen = await definition(url);
    const missing = crypto.randomUUID();

    expect(await refusal(url, TEST, [missing, lockScreen["id"]])).toMatchObject({
      code: "23503",
      detail: `Key (suite_id)=(${missing}) is not present in table "test_suites".`,
    });
  });

  it("the same definition twice in one suite is refused (unhappy)", async () => {
    const url = await started();
    const opened = await suite(url);
    const lockScreen = await definition(url);
    await query(url, TEST, [opened["id"], lockScreen["id"]]);

    expect(await refusal(url, TEST, [opened["id"], lockScreen["id"]])).toMatchObject({
      code: "23505",
      detail: `Key (suite_id, definition_id)=(${String(opened["id"])}, ${String(lockScreen["id"])}) already exists.`,
    });
  });

  it("a suite whose id is taken is refused, and the refusal names test_suites (unhappy)", async () => {
    const url = await started();
    const opened = await suite(url);

    expect(
      await refusal(
        url,
        "insert into test_suites (id, name, iso, server_url) values ($1, 'again', 'omarchy.iso', 'http://s1')",
        [opened["id"]],
      ),
    ).toMatchObject({
      code: "23505",
      message: 'duplicate key value violates unique constraint "test_suites_pkey"',
    });
  });

  it("a suite closed with a status only a test has is refused (unhappy)", async () => {
    const url = await started();
    const opened = await suite(url);

    expect(
      await refusal(url, "update test_suites set status = 'completed' where id = $1", [
        opened["id"],
      ]),
    ).toMatchObject({
      code: "22P02",
      message: 'invalid input value for enum test_suite_status: "completed"',
    });
  });
});
