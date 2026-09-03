import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  createExperiment,
  createLinearTicket,
  linearTicketDescription,
  type Experiment,
} from "./experiment.ts";
import type { Db } from "./db/ops.ts";
import { logs, testDefinitions, testResults, testRuns } from "./db/schema.ts";

afterEach(() => mock.restoreAll());

const experiment = {
  id: "11111111-1111-4111-8111-111111111111",
  iso: "https://example.com/omarchy.iso",
  serverUrl: "https://qemu.example.com",
  version: "1.2.3",
  tests: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      definitionId: 1,
      name: "Install Omarchy",
      description: "Install the operating system",
      instruction: "Complete the installer",
      proof: "The desktop is visible",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      definitionId: 2,
      name: "Open a terminal",
      description: "Verify the terminal starts",
      instruction: "Launch the terminal",
      proof: "A terminal window is visible",
    },
  ],
} satisfies Experiment;

type TestDefinition = typeof testDefinitions.$inferSelect;

function testDatabase(definitions: TestDefinition[], named: TestDefinition[] = definitions) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; values: unknown }[] = [];
  const insert = (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      return {
        returning: async () => {
          if (table === testRuns) {
            return [{ id: "11111111-1111-4111-8111-111111111111" }];
          }
          const ids = [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
          ];
          return (values as { definitionId: number }[]).map((value, index) => ({
            id: ids[index],
            definitionId: value.definitionId,
          }));
        },
      };
    },
  });
  const update = (table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        updates.push({ table, values });
      },
    }),
  });
  const tx = { insert, update };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        assert.equal(table, testDefinitions);
        return {
          orderBy: async () => definitions,
          where: async () => named,
        };
      },
    }),
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    insert,
    update,
    $client: {
      end: async () => undefined,
    },
  } as unknown as Db;
  return { db, inserts, updates };
}

function labelId(name: string): string {
  return `label-${name}`;
}

async function parseLinearRequest(init: Parameters<typeof fetch>[1]) {
  const body = init?.body;
  if (typeof body !== "string") {
    assert.fail("expected a JSON request body");
  }
  return JSON.parse(body) as { query: string; variables?: Record<string, unknown> };
}

function issueResponse(identifier: string) {
  return Response.json({
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

function describeResponse() {
  return Response.json({ data: { issueUpdate: { success: true } } });
}

describe("linearTicketDescription", () => {
  it("renders the template with the ticket, run, result, ISO, server, client guide, and this definition only", () => {
    const test = experiment.tests[0];
    const description = linearTicketDescription(experiment, test, "OLI-42");

    assert.equal(description.includes("{{"), false);
    assert.ok(description.includes("<agent_id>OLI-42</agent_id>"));
    assert.ok(description.includes(`--agent-id OLI-42 --server-url ${experiment.serverUrl} start --iso ${experiment.iso}`));
    assert.ok(description.includes(`<run_id>${experiment.id}</run_id>`));
    assert.ok(description.includes(`<result_id>${test.id}</result_id>`));
    assert.ok(description.includes(`<version>${experiment.version}</version>`));
    assert.ok(description.includes(`<name>${test.name}</name>`));
    assert.ok(description.includes(`<description>${test.description}</description>`));
    assert.ok(description.includes(`<instruction>${test.instruction}</instruction>`));
    assert.ok(description.includes(`<proof>${test.proof}</proof>`));
    assert.ok(description.includes("# Client\n"));
    assert.ok(description.includes("## The loop"));
    assert.equal(description.includes(experiment.tests[1].name), false);
    assert.equal(description.includes(experiment.tests[1].id), false);
  });
});

describe("createLinearTicket happy path", () => {
  it("resolves the first team, existing labels, and creates an issue for one definition", async () => {
    const test = experiment.tests[0];
    const requests: { headers: Headers; body: { query: string; variables?: Record<string, unknown> } }[] = [];
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const body = await parseLinearRequest(init);
      requests.push({
        headers: new Headers(init?.headers),
        body,
      });
      if (body.query.includes("teams(first: 1)")) {
        return Response.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });
      }
      if (body.query.includes("issueLabels")) {
        return Response.json({
          data: { issueLabels: { nodes: [{ id: labelId(String(body.variables?.name)) }] } },
        });
      }
      if (body.query.includes("issueUpdate")) {
        return describeResponse();
      }
      return issueResponse("OLI-42");
    });

    const ticket = await createLinearTicket("linear-token", experiment, test);

    assert.deepEqual(ticket, {
      id: "issue-OLI-42",
      identifier: "OLI-42",
      url: "https://linear.app/issue/OLI-42",
    });
    assert.equal(requests.length, 5);
    assert.equal(requests[0].headers.get("Authorization"), "linear-token");
    assert.match(requests[0].body.query, /teams\(first: 1\)/);
    assert.match(requests[1].body.query, /\$teamId: ID!/);
    assert.deepEqual(requests[1].body.variables, { name: "agent test", teamId: "team-id" });
    assert.deepEqual(requests[2].body.variables, { name: experiment.version, teamId: "team-id" });
    assert.deepEqual(requests[3].body.variables, {
      input: {
        teamId: "team-id",
        title: `Omarchy: ${test.name}`,
        labelIds: [labelId("agent test"), labelId(experiment.version)],
      },
    });
    assert.match(requests[4].body.query, /issueUpdate\(id: \$id/);
    assert.deepEqual(requests[4].body.variables, {
      id: "issue-OLI-42",
      input: { description: linearTicketDescription(experiment, test, "OLI-42") },
    });
  });

  it("creates missing labels before creating the issue", async () => {
    const test = experiment.tests[0];
    const created: string[] = [];
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const body = await parseLinearRequest(init);
      if (body.query.includes("teams(first: 1)")) {
        return Response.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });
      }
      if (body.query.includes("issueLabels")) {
        return Response.json({ data: { issueLabels: { nodes: [] } } });
      }
      if (body.query.includes("issueLabelCreate")) {
        const input = body.variables?.input as { name: string } | undefined;
        assert.ok(input !== undefined);
        const name = input.name;
        created.push(name);
        return Response.json({
          data: {
            issueLabelCreate: {
              success: true,
              issueLabel: { id: labelId(name) },
            },
          },
        });
      }
      if (body.query.includes("issueUpdate")) {
        return describeResponse();
      }
      return issueResponse("OLI-42");
    });

    const ticket = await createLinearTicket("linear-token", experiment, test);

    assert.deepEqual(created, ["agent test", experiment.version]);
    assert.equal(ticket.identifier, "OLI-42");
  });
});

describe("createLinearTicket unhappy path", () => {
  it("reports an HTTP failure", async () => {
    mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));

    await assert.rejects(() => createLinearTicket("bad-token", experiment, experiment.tests[0]), {
      message: "linear: request failed (401): unauthorized",
    });
  });

  it("reports a GraphQL failure", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ errors: [{ message: "API key has no access" }] }),
    );

    await assert.rejects(() => createLinearTicket("bad-token", experiment, experiment.tests[0]), {
      message: "linear: API key has no access",
    });
  });

  it("rejects an account without an accessible team", async () => {
    mock.method(globalThis, "fetch", async () => Response.json({ data: { teams: { nodes: [] } } }));

    await assert.rejects(() => createLinearTicket("linear-token", experiment, experiment.tests[0]), {
      message: "linear: no accessible teams",
    });
  });

  it("reports a label creation failure", async () => {
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const body = await parseLinearRequest(init);
      if (body.query.includes("teams(first: 1)")) {
        return Response.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });
      }
      if (body.query.includes("issueLabels")) {
        return Response.json({ data: { issueLabels: { nodes: [] } } });
      }
      return Response.json({
        data: {
          issueLabelCreate: {
            success: false,
            issueLabel: null,
          },
        },
      });
    });

    await assert.rejects(() => createLinearTicket("linear-token", experiment, experiment.tests[0]), {
      message: "linear: label creation failed",
    });
  });
});

describe("createExperiment happy path", () => {
  it("creates the run, pending results, and one Linear ticket per definition", async () => {
    const definitions = [
      {
        id: 1,
        name: "Install Omarchy",
        description: "Install the operating system",
        instruction: "Complete the installer",
        proof: "The desktop is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
      {
        id: 2,
        name: "Open a terminal",
        description: "Verify the terminal starts",
        instruction: "Launch the terminal",
        proof: "A terminal window is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] satisfies TestDefinition[];
    const { db, inserts } = testDatabase(definitions);
    const issueBodies: { query: string; variables?: Record<string, unknown> }[] = [];
    const descriptions: { query: string; variables?: Record<string, unknown> }[] = [];
    mock.method(console, "error", () => undefined);
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const parsed = await parseLinearRequest(init);
      if (parsed.query.includes("teams(first: 1)")) {
        return Response.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });
      }
      if (parsed.query.includes("issueLabels")) {
        return Response.json({
          data: { issueLabels: { nodes: [{ id: labelId(String(parsed.variables?.name)) }] } },
        });
      }
      if (parsed.query.includes("issueUpdate")) {
        descriptions.push(parsed);
        return describeResponse();
      }
      issueBodies.push(parsed);
      return issueResponse(`OLI-${41 + issueBodies.length}`);
    });

    const result = await createExperiment(db, "linear-token", {
      iso: "https://example.com/omarchy.iso",
      serverUrl: "https://qemu.example.com",
      version: "1.2.3",
    });

    assert.equal(result.experiment.id, "11111111-1111-4111-8111-111111111111");
    assert.equal(result.experiment.version, "1.2.3");
    assert.equal(result.experiment.tests.length, definitions.length);
    assert.deepEqual(result.experiment.tests.map((test) => test.id), [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);
    for (const test of result.experiment.tests) {
      assert.match(test.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    assert.deepEqual(result.tickets, [
      {
        id: "issue-OLI-42",
        identifier: "OLI-42",
        url: "https://linear.app/issue/OLI-42",
      },
      {
        id: "issue-OLI-43",
        identifier: "OLI-43",
        url: "https://linear.app/issue/OLI-43",
      },
    ]);
    assert.equal(issueBodies.length, definitions.length);
    assert.equal(descriptions.length, definitions.length);
    for (const [index, test] of result.experiment.tests.entries()) {
      assert.deepEqual(issueBodies[index].variables, {
        input: {
          teamId: "team-id",
          title: `Omarchy: ${test.name}`,
          labelIds: [labelId("agent test"), labelId("1.2.3")],
        },
      });
      assert.deepEqual(descriptions[index].variables, {
        id: result.tickets[index].id,
        input: { description: linearTicketDescription(result.experiment, test, result.tickets[index].identifier) },
      });
    }
    assert.equal(inserts[0].table, testRuns);
    assert.deepEqual(inserts[0].values, {
      name: "Omarchy experiment",
      iso: "https://example.com/omarchy.iso",
      serverUrl: "https://qemu.example.com",
      status: "pending",
    });
    assert.equal(inserts[1].table, testResults);
    assert.deepEqual(
      inserts[1].values,
      result.experiment.tests.map((test) => ({
        runId: result.experiment.id,
        definitionId: test.definitionId,
        status: "pending",
      })),
    );
    assert.equal(inserts[2].table, logs);
    assert.deepEqual(inserts[2].values, {
      text: `experiment ${result.experiment.id} created; 2 tests; OLI-42, OLI-43`,
    });
  });

  it("creates the run, one pending result, and one Linear ticket for a named definition", async () => {
    const definitions = [
      {
        id: 1,
        name: "Install Omarchy",
        description: "Install the operating system",
        instruction: "Complete the installer",
        proof: "The desktop is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
      {
        id: 2,
        name: "Open a terminal",
        description: "Verify the terminal starts",
        instruction: "Launch the terminal",
        proof: "A terminal window is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] satisfies TestDefinition[];
    const { db, inserts } = testDatabase(definitions, [definitions[0]]);
    mock.method(console, "error", () => undefined);
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const parsed = await parseLinearRequest(init);
      if (parsed.query.includes("teams(first: 1)")) {
        return Response.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });
      }
      if (parsed.query.includes("issueLabels")) {
        return Response.json({
          data: { issueLabels: { nodes: [{ id: labelId(String(parsed.variables?.name)) }] } },
        });
      }
      if (parsed.query.includes("issueUpdate")) {
        return describeResponse();
      }
      return issueResponse("OLI-42");
    });

    const result = await createExperiment(db, "linear-token", {
      iso: "https://example.com/omarchy.iso",
      serverUrl: "https://qemu.example.com",
      version: "1.2.3",
      name: "Install Omarchy",
    });

    assert.equal(result.experiment.tests.length, 1);
    assert.equal(result.experiment.tests[0].name, "Install Omarchy");
    assert.equal(result.experiment.tests[0].definitionId, 1);
    assert.deepEqual(result.tickets, [
      {
        id: "issue-OLI-42",
        identifier: "OLI-42",
        url: "https://linear.app/issue/OLI-42",
      },
    ]);
    assert.deepEqual(inserts[1].values, [
      {
        runId: result.experiment.id,
        definitionId: 1,
        status: "pending",
      },
    ]);
    assert.deepEqual(inserts[2].values, {
      text: `experiment ${result.experiment.id} created; 1 tests; OLI-42`,
    });
  });
});

describe("createExperiment unhappy path", () => {
  it("rejects an experiment with no test definitions", async () => {
    const { db, inserts, updates } = testDatabase([]);
    mock.method(globalThis, "fetch", async () => assert.fail("Linear should not be called"));

    await assert.rejects(
      () =>
        createExperiment(db, "linear-token", {
          iso: "https://example.com/omarchy.iso",
          serverUrl: "https://qemu.example.com",
          version: "1.2.3",
        }),
      { message: "experiment: no test definitions found" },
    );
    assert.deepEqual(inserts, []);
    assert.deepEqual(updates, []);
  });

  it("rejects a name that matches no test definition", async () => {
    const definitions = [
      {
        id: 1,
        name: "Install Omarchy",
        description: "Install the operating system",
        instruction: "Complete the installer",
        proof: "The desktop is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] satisfies TestDefinition[];
    const { db, inserts, updates } = testDatabase(definitions, []);
    mock.method(globalThis, "fetch", async () => assert.fail("Linear should not be called"));

    await assert.rejects(
      () =>
        createExperiment(db, "linear-token", {
          iso: "https://example.com/omarchy.iso",
          serverUrl: "https://qemu.example.com",
          version: "1.2.3",
          name: "Change lighting",
        }),
      { message: "experiment: no test definition named Change lighting" },
    );
    assert.deepEqual(inserts, []);
    assert.deepEqual(updates, []);
  });

  it("marks the run and results failed when Linear creation fails", async () => {
    const definitions = [
      {
        id: 1,
        name: "Install Omarchy",
        description: "Install the operating system",
        instruction: "Complete the installer",
        proof: "The desktop is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] satisfies TestDefinition[];
    const { db, inserts, updates } = testDatabase(definitions);
    mock.method(globalThis, "fetch", async () => new Response("unauthorized", { status: 401 }));

    await assert.rejects(
      () =>
        createExperiment(db, "bad-token", {
          iso: "https://example.com/omarchy.iso",
          serverUrl: "https://qemu.example.com",
          version: "1.2.3",
        }),
      { message: "linear: request failed (401): unauthorized" },
    );
    assert.equal(inserts[0].table, testRuns);
    assert.equal(inserts[1].table, testResults);
    assert.equal(updates[0].table, testRuns);
    const runFailure = updates[0].values as { status: string; reason: string; endedAt: unknown };
    assert.deepEqual(runFailure, {
      status: "failed",
      reason: "linear: request failed (401): unauthorized",
      endedAt: runFailure.endedAt,
    });
    assert.equal(updates[1].table, testResults);
    const resultFailure = updates[1].values as { status: string; reason: string; finishedAt: unknown };
    assert.deepEqual(resultFailure, {
      status: "failed",
      reason: "linear: request failed (401): unauthorized",
      finishedAt: resultFailure.finishedAt,
    });
  });

  it("names every ticket created, including one whose description failed", async () => {
    const definitions = [
      {
        id: 1,
        name: "Install Omarchy",
        description: "Install the operating system",
        instruction: "Complete the installer",
        proof: "The desktop is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
      {
        id: 2,
        name: "Open a terminal",
        description: "Verify the terminal starts",
        instruction: "Launch the terminal",
        proof: "A terminal window is visible",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] satisfies TestDefinition[];
    const { db, updates } = testDatabase(definitions);
    let created = 0;
    mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const body = await parseLinearRequest(init);
      if (body.query.includes("teams(first: 1)")) {
        return Response.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });
      }
      if (body.query.includes("issueLabels")) {
        return Response.json({
          data: { issueLabels: { nodes: [{ id: labelId(String(body.variables?.name)) }] } },
        });
      }
      if (body.query.includes("issueUpdate")) {
        if ((body.variables?.id as string) === "issue-OLI-43") {
          return new Response("unauthorized", { status: 401 });
        }
        return describeResponse();
      }
      created++;
      return issueResponse(`OLI-${41 + created}`);
    });

    await assert.rejects(
      () =>
        createExperiment(db, "linear-token", {
          iso: "https://example.com/omarchy.iso",
          serverUrl: "https://qemu.example.com",
          version: "1.2.3",
        }),
      { message: "linear: request failed (401): unauthorized; created OLI-42, OLI-43" },
    );
    const runFailure = updates[0].values as { reason: string };
    assert.equal(runFailure.reason, "linear: request failed (401): unauthorized; created OLI-42, OLI-43");
  });
});
