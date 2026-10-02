import { readFileSync } from "node:fs";
import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as FakeHttp from "@oligarchy/http/testing";
import * as Application from "../src/application.ts";
import { environment } from "../src/environment.ts";
import { createServices, closeServices } from "../src/services.ts";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const running: Array<FakePostgres.FakePostgres> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((fake) => fake.stop()));
});

const started = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  running.push(fake);
  return fake;
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

// Run the same application lifecycle with fake HTTP and process IO.
const tester = async (url: string) => {
  const env = jarl.unwrap(
    await Env.create(
      environment,
      Env.fakeIo({
        env: { DATABASE_URL: url },
        files: { [Env.CONFIG_PATH]: CONFIG },
      }),
    ),
  );
  const lines: string[] = [];
  const services = createServices(env, {
    http: FakeHttp.http({ replies: FakeHttp.status(200) }).http,
    terminal: { write: (line) => lines.push(line), colors: false },
  });
  const app = new App.App(env).main(Application.main);
  app.onExit(() => closeServices(services));
  let code: number | undefined;
  await app.run(services, () => undefined, {
    onSignal: () => () => undefined,
    stderr: () => undefined,
    exit: (value) => {
      code = value;
    },
  });
  return { code, lines };
};

describe("the tester against a fake postgres", () => {
  it("prints its counts and stores each line in the logs table, failing tests as a warning (happy)", async () => {
    const fake = await started();
    const [suite] = await query(
      fake.url,
      "insert into test_suites (name, iso, server_url, status) values ('nightly', 'omarchy.iso', 'http://s1', 'running') returning id",
    );
    for (const status of ["passed", "failed"]) {
      const [definition] = await query(
        fake.url,
        "insert into test_definitions (name, description, instruction, proof) values ($1, '', '', '') returning id",
        [status],
      );
      await query(
        fake.url,
        "insert into test_runs (suite_id, definition_id, iso, server_url, status) values ($1, $2, 'omarchy.iso', 'http://s1', $3)",
        [suite?.["id"], definition?.["id"], status],
      );
    }

    const ran = await tester(fake.url);

    expect(ran.code).toBe(0);
    expect(ran.lines).toEqual([
      "[INFO] [global] tester: running test suites: 1",
      "[INFO] [global] tester: passing tests: 1",
      "[WARN] [global] tester: failing tests: 1",
    ]);
    expect(
      await query(fake.url, "select level, location, run_id, text from logs order by id"),
    ).toEqual([
      { level: "info", location: "tester", run_id: null, text: "running test suites: 1" },
      { level: "info", location: "tester", run_id: null, text: "passing tests: 1" },
      { level: "warning", location: "tester", run_id: null, text: "failing tests: 1" },
    ]);
  });

  it("with the database gone, says it could not count, that the line was not stored, and exits 1 (unhappy)", async () => {
    const fake = jarl.unwrap(await FakePostgres.start());
    await fake.stop();

    const ran = await tester(fake.url);

    expect(ran.code).toBe(1);
    // drizzle's message spans lines: the query, then its params, then the driver's reason.
    const said = ran.lines.join("\n");
    expect(said).toMatch(
      /^\[ERROR\] \[global\] tester: could not count tests: [\s\S]*ECONNREFUSED/,
    );
    expect(said).toMatch(/\n\[ERROR\] \[global\] db: log insert failed: [\s\S]*ECONNREFUSED/);
  });
});
