import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { app } from "../../src/dashboard/dashboard.tsx";
import { renderSuiteTicket } from "../../src/dashboard/suite.ts";
import { testDefinitions, testResults, testRuns } from "../../src/db/schema.ts";
import * as StubProxy from "../support/stub-proxy.ts";

const dbUrl = inject("dbUrl");

const ISO = "https://example.com/omarchy.iso";
const VERSION = "1.2.3";
const SERVER = "http://qemu.example:42069";
const TOKEN = "lin_api_test";

type Mode = "ok" | "team-401" | "describe-second-401";

type SuiteAnswer = {
  readonly id: string;
  readonly tests: ReadonlyArray<{
    readonly id: string;
    readonly linear: { readonly id: string; readonly identifier: string; readonly url: string };
  }>;
};

const operationOf = (query: string): string => /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";

const objectFields = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textField = (box: { readonly [key: string]: unknown }, key: string): string => {
  const value = box[key];
  if (typeof value !== "string") {
    throw new Error(`response missing ${key}`);
  }
  return value;
};

const gql = (
  received: StubProxy.Received,
): { readonly operation: string; readonly variables: { readonly [key: string]: unknown } } => {
  if (!objectFields(received.body)) {
    return { operation: "", variables: {} };
  }
  const query = typeof received.body.query === "string" ? received.body.query : "";
  return {
    operation: operationOf(query),
    variables: objectFields(received.body.variables) ? received.body.variables : {},
  };
};

const answerOf = (body: unknown): SuiteAnswer => {
  if (!objectFields(body) || !Array.isArray(body.tests)) {
    throw new Error("suite response was not a run");
  }
  return {
    id: textField(body, "id"),
    tests: body.tests.map((test) => {
      if (!objectFields(test) || !objectFields(test.linear)) {
        throw new Error("suite response test was not a ticket");
      }
      return {
        id: textField(test, "id"),
        linear: {
          id: textField(test.linear, "id"),
          identifier: textField(test.linear, "identifier"),
          url: textField(test.linear, "url"),
        },
      };
    }),
  };
};

const errorOf = (body: unknown): string => {
  if (!objectFields(body)) {
    throw new Error("suite response was not an error");
  }
  return textField(body, "error");
};

// Linear as the suite route calls it: the agent-test label already exists, the version
// label is created, tickets arrive OLI-42, OLI-43, ... A mode refuses the team lookup, or
// the second describe, with the same 401 body the unit fakes use.
const linearScript = (mode: Mode): StubProxy.Script => {
  let issues = 0;
  let describes = 0;
  return (received) => {
    const { operation, variables } = gql(received);
    if (mode === "team-401" && operation === "ExperimentTeam") {
      return { status: 401, headers: { "Content-Type": "text/plain" }, body: "unauthorized" };
    }
    if (operation === "ExperimentTeam") {
      return StubProxy.json(200, { data: { teams: { nodes: [{ id: "team-id" }] } } });
    }
    if (operation === "ExperimentLabel") {
      const nodes = variables?.name === "agent test" ? [{ id: "label-agent test" }] : [];
      return StubProxy.json(200, { data: { issueLabels: { nodes } } });
    }
    if (operation === "ExperimentLabelCreate") {
      const input = variables?.input;
      const name =
        typeof input === "object" && input !== null && "name" in input ? String(input.name) : "";
      return StubProxy.json(200, {
        data: { issueLabelCreate: { success: true, issueLabel: { id: `label-${name}` } } },
      });
    }
    if (operation === "ExperimentAssignee") {
      return StubProxy.json(200, { data: { users: { nodes: [{ id: "user-id" }] } } });
    }
    if (operation === "ExperimentState") {
      return StubProxy.json(200, {
        data: { workflowStates: { nodes: [{ id: `state-${String(variables?.name)}` }] } },
      });
    }
    if (operation === "ExperimentIssueCreate") {
      issues += 1;
      const identifier = `OLI-${String(41 + issues)}`;
      return StubProxy.json(200, {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: `issue-${identifier}`,
              identifier,
              url: `https://linear.app/issue/${identifier}`,
            },
          },
        },
      });
    }
    if (operation === "ExperimentIssueDescribe") {
      describes += 1;
      if (mode === "describe-second-401" && describes === 2) {
        return { status: 401, headers: { "Content-Type": "text/plain" }, body: "unauthorized" };
      }
      return StubProxy.json(200, { data: { issueUpdate: { success: true } } });
    }
    return StubProxy.json(500, { error: `unexpected ${operation}` });
  };
};

let suiteUrl = "";

const databaseName = (url: string, name: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};

const withClient = async <T>(url: string, run: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

const reset = async (): Promise<void> => {
  await withClient(suiteUrl, async (client) => {
    await client.query("delete from test_results");
    await client.query("delete from test_runs");
    await client.query("delete from test_definitions");
  });
};

const insertDefinitions = async (
  rows: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly instruction: string;
    readonly proof: string;
  }>,
): Promise<void> => {
  await withClient(suiteUrl, async (client) => {
    const db = drizzle(client);
    for (const row of rows) {
      await db.insert(testDefinitions).values(row);
    }
  });
};

type Stored = {
  readonly run: typeof testRuns.$inferSelect;
  readonly results: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly instruction: string;
    readonly status: string;
    readonly linearId: string | null;
    readonly reason: string | null;
  }>;
};

const stored = async (): Promise<Stored> =>
  withClient(suiteUrl, async (client) => {
    const db = drizzle(client);
    const runs = await db.select().from(testRuns);
    const [run] = runs;
    if (run === undefined || runs.length !== 1) {
      throw new Error(`expected one run, found ${String(runs.length)}`);
    }
    const rows = await db
      .select({
        id: testResults.id,
        name: testDefinitions.name,
        instruction: testDefinitions.instruction,
        status: testResults.status,
        linearId: testResults.linearId,
        reason: testResults.reason,
      })
      .from(testResults)
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .orderBy(testDefinitions.name);
    return { run, results: rows };
  });

const postSuite = async (stub: StubProxy.StubProxy, body: unknown) => {
  const response = await app.request(
    "/run-test-suite",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    {
      HYPERDRIVE: { connectionString: suiteUrl },
      OLIGARCHY_TOKEN: "t",
      AUTOMATION_SERVER_URL: "http://127.0.0.1:1",
      LINEAR_API_URL: `${stub.url}/graphql`,
      LINEAR_API_TOKEN: TOKEN,
    },
  );
  return { status: response.status, body: await response.json() };
};

const ALPHA_OLD = {
  name: "suite-alpha",
  description: "alpha",
  instruction: "old-alpha",
  proof: "the old proof",
};
const ALPHA_NEW = {
  name: "suite-alpha",
  description: "alpha revised",
  instruction: "new-alpha",
  proof: "the new proof",
};
const BETA = {
  name: "suite-beta",
  description: "beta",
  instruction: "do beta",
  proof: "beta shows",
};
const WORDINGS = [ALPHA_OLD, ALPHA_NEW, BETA];

describe.skipIf(dbUrl === "")("POST /run-test-suite", () => {
  beforeAll(async () => {
    await withClient(databaseName(dbUrl, "postgres"), async (client) => {
      await client.query("drop database if exists suite_lane with (force)");
      await client.query("create database suite_lane");
    });
    suiteUrl = databaseName(dbUrl, "suite_lane");
    await withClient(suiteUrl, async (client) => {
      await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    });
  });

  beforeEach(reset);

  let stub: StubProxy.StubProxy | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  const listen = async (mode: Mode): Promise<StubProxy.StubProxy> => {
    const opened = await StubProxy.startStubProxy(linearScript(mode));
    stub = opened;
    return opened;
  };

  it("opens one run of the latest wording of every definition and one ticket each (happy)", async () => {
    const opened = await listen("ok");
    await insertDefinitions(WORDINGS);
    const { status, body } = await postSuite(opened, {
      iso: ISO,
      version: VERSION,
      serverUrl: SERVER,
    });
    expect(status).toBe(200);
    const answer = answerOf(body);
    const row = await stored();
    expect(row.run).toMatchObject({
      id: answer.id,
      name: "Omarchy experiment",
      iso: ISO,
      serverUrl: SERVER,
      status: "pending",
      reason: null,
    });
    expect(
      row.results.map((result) => [
        result.name,
        result.instruction,
        result.status,
        result.linearId,
      ]),
    ).toEqual([
      ["suite-alpha", "new-alpha", "pending", "OLI-42"],
      ["suite-beta", "do beta", "pending", "OLI-43"],
    ]);
    expect(answer.tests).toEqual([
      {
        id: row.results[0]?.id,
        linear: {
          id: "issue-OLI-42",
          identifier: "OLI-42",
          url: "https://linear.app/issue/OLI-42",
        },
      },
      {
        id: row.results[1]?.id,
        linear: {
          id: "issue-OLI-43",
          identifier: "OLI-43",
          url: "https://linear.app/issue/OLI-43",
        },
      },
    ]);
    expect(opened.requests.map((received) => received.authorization)).toEqual(
      opened.requests.map(() => TOKEN),
    );
    expect(opened.requests.every((received) => received.url === "/graphql")).toBe(true);
    expect(opened.requests.map((received) => gql(received).operation)).toEqual([
      "ExperimentTeam",
      "ExperimentLabel",
      "ExperimentLabel",
      "ExperimentLabelCreate",
      "ExperimentAssignee",
      "ExperimentState",
      "ExperimentState",
      "ExperimentIssueCreate",
      "ExperimentIssueDescribe",
      "ExperimentIssueCreate",
      "ExperimentIssueDescribe",
    ]);
    const describes = opened.requests.filter(
      (received) => gql(received).operation === "ExperimentIssueDescribe",
    );
    expect(describes.map((received) => inputOf(received).description)).toEqual(
      row.results.map((result, index) =>
        renderSuiteTicket({
          LINEAR_TICKET: `OLI-${String(42 + index)}`,
          RUN_ID: answer.id,
          RESULT_ID: result.id,
          VERSION,
          ISO_URL: ISO,
          SERVER_URL: SERVER,
          TEST_NAME: result.name,
          TEST_DESCRIPTION: index === 0 ? "alpha revised" : "beta",
          TEST_INSTRUCTION: result.instruction,
          TEST_PROOF: index === 0 ? "the new proof" : "beta shows",
        }),
      ),
    );
    const created = opened.requests.filter(
      (received) => gql(received).operation === "ExperimentIssueCreate",
    );
    expect(created.map((received) => inputOf(received).title)).toEqual([
      "Omarchy: suite-alpha",
      "Omarchy: suite-beta",
    ]);
  });

  it("refuses an empty table before calling Linear (unhappy)", async () => {
    const opened = await listen("ok");
    const { status, body } = await postSuite(opened, {
      iso: ISO,
      version: VERSION,
      serverUrl: SERVER,
    });
    expect(status).toBe(400);
    expect(body).toEqual({ error: "test: no test definitions found" });
    expect(opened.requests).toEqual([]);
    await expect(stored()).rejects.toThrow(/expected one run, found 0/);
  });

  it("fails the run when Linear refuses the team, naming no ticket (unhappy)", async () => {
    const opened = await listen("team-401");
    await insertDefinitions([BETA]);
    const { status, body } = await postSuite(opened, {
      iso: ISO,
      version: VERSION,
      serverUrl: SERVER,
    });
    expect(status).toBe(500);
    expect(body).toEqual({ error: "linear: request failed (401): unauthorized" });
    const row = await stored();
    expect(row.run).toMatchObject({
      status: "failed",
      reason: "linear: request failed (401): unauthorized",
    });
    expect(row.results).toEqual([
      expect.objectContaining({
        name: "suite-beta",
        status: "failed",
        linearId: null,
        reason: "linear: request failed (401): unauthorized",
      }),
    ]);
  });

  it("fails the run after a describe refusal and names both tickets already created (unhappy)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const opened = await listen("describe-second-401");
      await insertDefinitions(WORDINGS);
      const { status, body } = await postSuite(opened, {
        iso: ISO,
        version: VERSION,
        serverUrl: SERVER,
      });
      expect(status).toBe(500);
      const message = errorOf(body);
      expect(message).toBe("linear: request failed (401): unauthorized; created OLI-42, OLI-43");
      const row = await stored();
      expect(row.run.reason).toBe(message);
      expect(row.results.map((result) => [result.name, result.status, result.linearId])).toEqual([
        ["suite-alpha", "failed", "OLI-42"],
        ["suite-beta", "failed", "OLI-43"],
      ]);
      const trapped = error.mock.calls.filter((call) =>
        String(call[0]).includes("ticket trapped in Backlog"),
      );
      expect(trapped).toEqual([
        [
          "dashboard: ticket trapped in Backlog; linear: request failed (401): unauthorized",
          "OLI-43",
        ],
      ]);
    } finally {
      error.mockRestore();
    }
  });
});

const inputOf = (received: StubProxy.Received): { readonly [key: string]: unknown } => {
  const input = gql(received).variables.input;
  if (!objectFields(input)) {
    throw new Error("linear call had no input");
  }
  return input;
};
