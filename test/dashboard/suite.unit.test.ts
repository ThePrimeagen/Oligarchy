import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, FileSystem } from "effect";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";
import {
  bundledPrompts,
  createTestSuiteRun,
  responseJson,
  SuiteRequestError,
} from "../../src/dashboard/suite.ts";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as Prompts from "../../src/ctrl/prompts.ts";
import * as Errors from "../../src/shared/errors.ts";

const SENTINEL_PASSWORD = "sentinel-secret-pw";
const REQUIRED = "iso, version and serverUrl are required";

const env = {
  HYPERDRIVE: {
    connectionString: `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy`,
  },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
  LINEAR_API_URL: "http://127.0.0.1:1/graphql",
  LINEAR_API_TOKEN: "lin_api_x",
  LINEAR_TEAM: "Local Board",
};

const ISO = "https://example.com/omarchy.iso";
const SERVER = "http://qemu.example:42069";

const post = (body: string) =>
  app.request(
    "/create-test-suite-run",
    { method: "POST", headers: { "content-type": "application/json" }, body },
    env,
  );

const ticket = {
  LINEAR_TICKET: "OLI-42",
  RUN_ID: "11111111-1111-4111-8111-111111111111",
  RESULT_ID: "22222222-2222-4222-8222-222222222222",
  VERSION: "1.2.3",
  ISO_URL: ISO,
  SERVER_URL: SERVER,
  TEST_NAME: "suite-alpha",
  TEST_DESCRIPTION: "what the test is",
  TEST_INSTRUCTION: "new-alpha",
  TEST_PROOF: "the screen shows it",
};

const body = { iso: ISO, version: "1.2.3", serverUrl: SERVER };

describe("POST /create-test-suite-run unhappy path", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    error.mockClear();
  });

  afterAll(() => {
    error.mockRestore();
  });

  it("refuses a body that is not JSON, without logging", async () => {
    const response = await post("not-json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: REQUIRED });
    expect(error).not.toHaveBeenCalled();
  });

  it("refuses a body missing a field, an empty version, an http iso and a non-http server", async () => {
    const missing = await post(JSON.stringify({ iso: ISO }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: REQUIRED });

    const emptyVersion = await post(JSON.stringify({ iso: ISO, version: "", serverUrl: SERVER }));
    expect(emptyVersion.status).toBe(400);
    expect(await emptyVersion.json()).toEqual({ error: REQUIRED });

    const httpIso = await post(
      JSON.stringify({
        iso: "http://example.com/omarchy.iso",
        version: "1.2.3",
        serverUrl: SERVER,
      }),
    );
    expect(httpIso.status).toBe(400);
    expect(await httpIso.json()).toEqual({ error: "iso must be a valid https url" });

    const ftp = await post(
      JSON.stringify({ iso: ISO, version: "1.2.3", serverUrl: "ftp://qemu.example" }),
    );
    expect(ftp.status).toBe(400);
    expect(await ftp.json()).toEqual({ error: "serverUrl must be a valid http or https url" });
    expect(error).not.toHaveBeenCalled();
  });
});

describe("POST /create-test-suite-run unhappy path: missing team", () => {
  it("answers LINEAR_TEAM is not set and does not call Linear or the database", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await app.request(
        "/create-test-suite-run",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { ...env, LINEAR_TEAM: "" },
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "LINEAR_TEAM is not set" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
        SENTINEL_PASSWORD,
      );
    } finally {
      fetchSpy.mockRestore();
      error.mockRestore();
    }
  });
});

describe("POST /create-test-suite-run unhappy path: unreachable database", () => {
  it("answers 500 without the database password, and does not call Linear", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post(JSON.stringify(body));
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).toMatch(/ECONNREFUSED|Failed query|database request failed/);
      expect(text).not.toContain(SENTINEL_PASSWORD);
      expect(text).not.toContain("linear:");
      expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
        SENTINEL_PASSWORD,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      error.mockRestore();
    }
  });
});

describe("create test-suite-run runner", () => {
  it("hands the command its arguments and returns what the command returned (happy)", async () => {
    const created = {
      id: "run-id",
      tests: [{ id: "result-id", linear: { identifier: "OLI-42" } }],
    };
    const calls: Array<readonly [string, string, string, ReadonlyArray<string>]> = [];
    const answer = await createTestSuiteRun(
      env,
      env.HYPERDRIVE.connectionString,
      body,
      async (connectionString, token, team, args) => {
        calls.push([connectionString, token, team, args]);
        return created;
      },
    );
    expect(calls).toEqual([
      [
        env.HYPERDRIVE.connectionString,
        env.LINEAR_API_TOKEN,
        env.LINEAR_TEAM,
        ["test", "run", "testsuite", "--iso", ISO, "--version", "1.2.3", "--server-url", SERVER],
      ],
    ]);
    expect(answer).toBe(created);
  });

  it("turns the command's empty-table refusal into the route's 400, and nothing else (unhappy)", async () => {
    const refused = createTestSuiteRun(env, env.HYPERDRIVE.connectionString, body, async () => {
      throw SharedErrors.CommandError.make({ message: "test: no test definitions found" });
    });
    await expect(refused).rejects.toBeInstanceOf(SuiteRequestError);
    await expect(refused).rejects.toThrow("test: no test definitions found");

    const database = createTestSuiteRun(env, env.HYPERDRIVE.connectionString, body, async () => {
      throw Errors.DatabaseError.make({ operation: "query", message: "database request failed" });
    });
    await expect(database).rejects.toBeInstanceOf(Errors.DatabaseError);

    const other = createTestSuiteRun(env, env.HYPERDRIVE.connectionString, body, async () => {
      throw SharedErrors.CommandError.make({ message: "mint: no live qemu server" });
    });
    await expect(other).rejects.toBeInstanceOf(SharedErrors.CommandError);
    await expect(other).rejects.not.toBeInstanceOf(SuiteRequestError);
  });

  it("reads the command's JSON, not a log line printed after it (happy)", () => {
    const created = { id: "run-id", tests: [] };
    expect(
      responseJson([
        "[global] info: test run-id created; 0 tests",
        JSON.stringify(created),
        "[global] error: db: log insert failed: connection terminated",
      ]),
    ).toEqual(created);
  });

  it("refuses output that never printed the JSON (unhappy)", () => {
    expect(() => responseJson(["[global] info: nothing"])).toThrow(
      "test run testsuite printed no JSON",
    );
    expect(() => responseJson(["{not json"])).toThrow("test run testsuite printed no JSON");
  });

  it("does not run the command for a body it refuses (unhappy)", async () => {
    const run = vi.fn(async () => ({ id: "run-id" }));
    await expect(
      createTestSuiteRun(env, env.HYPERDRIVE.connectionString, { iso: ISO }, run),
    ).rejects.toBeInstanceOf(SuiteRequestError);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("bundled prompts", () => {
  it("serves the same ticket text ./ctrl reads from disk (happy)", async () => {
    const fromDisk = await Effect.runPromise(
      Prompts.renderLinearIssue(ticket).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const fromWorker = await Effect.runPromise(
      Prompts.renderLinearIssue(ticket).pipe(Effect.provide(bundledPrompts)),
    );
    expect(fromWorker).toBe(fromDisk);
  });

  it("dies on a prompt path the command does not read (unhappy)", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.readFileString("/prompts/mint-issue.html");
      }).pipe(Effect.provide(bundledPrompts)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
