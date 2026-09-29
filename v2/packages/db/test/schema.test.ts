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

const TEST = "insert into test_runs (suite_id, definition_id) values ($1, $2)";

// One test run under a suite of its own, returned with its suite and the status it opens with.
const testRun = async (url: string) => {
  const opened = await suite(url);
  const lockScreen = await definition(url);
  return first(
    await query(
      url,
      "insert into test_runs (suite_id, definition_id) values ($1, $2) returning id, suite_id, status",
      [opened["id"], lockScreen["id"]],
    ),
  );
};

describe("a test suite and its test runs", () => {
  it("a test run is stored under its suite and read back by the suite's id; the suite opens pending (happy)", async () => {
    const url = await started();
    const opened = await suite(url);
    const lockScreen = await definition(url);

    await query(url, TEST, [opened["id"], lockScreen["id"]]);

    expect(opened["status"]).toBe("pending");
    expect(
      await query(url, "select definition_id from test_runs where suite_id = $1", [opened["id"]]),
    ).toEqual([{ definition_id: lockScreen["id"] }]);
  });

  it("a test run naming a suite that does not exist is refused (unhappy)", async () => {
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

  it("a suite closed with a status only a test run has is refused (unhappy)", async () => {
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

describe("a test run, and the jobs and setup lock that name it", () => {
  it("a job and a setup lock name a test run by run_id; the test run opens pending (happy)", async () => {
    const url = await started();
    const run = await testRun(url);

    await query(url, "insert into jobs (run_id, action) values ($1, 'mint')", [run["id"]]);
    await query(
      url,
      "insert into setup_requests (iso, server_url, run_id) values ('omarchy.iso', 'http://s1', $1)",
      [run["id"]],
    );

    expect(run["status"]).toBe("pending");
    expect(await query(url, "select run_id, action from jobs")).toEqual([
      { run_id: run["id"], action: "mint" },
    ]);
    expect(await query(url, "select run_id from setup_requests")).toEqual([{ run_id: run["id"] }]);
  });

  it("a job naming a test run that does not exist is refused (unhappy)", async () => {
    const url = await started();
    const missing = crypto.randomUUID();

    expect(
      await refusal(url, "insert into jobs (run_id, action) values ($1, 'drive')", [missing]),
    ).toMatchObject({
      code: "23503",
      detail: `Key (run_id)=(${missing}) is not present in table "test_runs".`,
    });
  });

  it("two setup locks naming the same test run are refused (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);
    const lock =
      "insert into setup_requests (iso, server_url, run_id) values ('omarchy.iso', $1, $2)";
    await query(url, lock, ["http://s1", run["id"]]);

    expect(await refusal(url, lock, ["http://s2", run["id"]])).toMatchObject({
      code: "23505",
      detail: `Key (run_id)=(${String(run["id"])}) already exists.`,
    });
  });

  it("one Linear ticket on two test runs is refused (unhappy)", async () => {
    const url = await started();
    const opened = await suite(url);
    const ticketed =
      "insert into test_runs (suite_id, definition_id, linear_id) values ($1, $2, 'OLI-1')";
    await query(url, ticketed, [opened["id"], (await definition(url, "lock-screen"))["id"]]);

    expect(
      await refusal(url, ticketed, [opened["id"], (await definition(url, "wifi"))["id"]]),
    ).toMatchObject({
      code: "23505",
      detail: "Key (linear_id)=(OLI-1) already exists.",
    });
  });

  it("a test run whose id is taken is refused, and the refusal names test_runs (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);
    const wifi = await definition(url, "wifi");

    expect(
      await refusal(
        url,
        "insert into test_runs (id, suite_id, definition_id) values ($1, $2, $3)",
        [run["id"], run["suite_id"], wifi["id"]],
      ),
    ).toMatchObject({
      code: "23505",
      message: 'duplicate key value violates unique constraint "test_runs_pkey"',
    });
  });

  it("a test run closed with a status only a job has is refused (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);

    expect(
      await refusal(url, "update test_runs set status = 'succeeded' where id = $1", [run["id"]]),
    ).toMatchObject({
      code: "22P02",
      message: 'invalid input value for enum test_run_status: "succeeded"',
    });
  });
});

const JOB = "insert into jobs (run_id, action) values ($1, $2) returning id, status";

describe("a job, one mint, drive or diagnose for a test run", () => {
  it("a job is queued pending for its test run (happy)", async () => {
    const url = await started();
    const run = await testRun(url);

    expect(await query(url, JOB, [run["id"], "drive"])).toEqual([
      { id: expect.any(String), status: "pending" },
    ]);
  });

  it("a job whose action is not mint, drive or diagnose is refused (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);

    expect(await refusal(url, JOB, [run["id"], "retry"])).toMatchObject({
      code: "22P02",
      message: 'invalid input value for enum job_action: "retry"',
    });
  });

  it("a second drive for one test run is refused (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);
    await query(url, JOB, [run["id"], "drive"]);

    expect(await refusal(url, JOB, [run["id"], "drive"])).toMatchObject({
      code: "23505",
      detail: `Key (run_id, action)=(${String(run["id"])}, drive) already exists.`,
    });
  });

  it("a job closed with a status only a test run has is refused (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);
    const job = first(await query(url, JOB, [run["id"], "drive"]));

    expect(
      await refusal(url, "update jobs set status = 'passed' where id = $1", [job["id"]]),
    ).toMatchObject({
      code: "22P02",
      message: 'invalid input value for enum job_status: "passed"',
    });
  });

  it("a job whose id is taken is refused, and the refusal names jobs (unhappy)", async () => {
    const url = await started();
    const run = await testRun(url);
    const job = first(await query(url, JOB, [run["id"], "drive"]));

    expect(
      await refusal(url, "insert into jobs (id, run_id, action) values ($1, $2, 'mint')", [
        job["id"],
        run["id"],
      ]),
    ).toMatchObject({
      code: "23505",
      message: 'duplicate key value violates unique constraint "jobs_pkey"',
    });
  });
});
