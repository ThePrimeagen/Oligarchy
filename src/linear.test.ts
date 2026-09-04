import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createLinearTicket, drivingAgentPrompt, linearTicketDescription, type Experiment } from "./linear.ts";

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

describe("linearTicketDescription happy path", () => {
  it("renders the ticket, run, result, ISO, server, both guides, and this definition only", () => {
    const test = experiment.tests[0];
    const description = linearTicketDescription(experiment, test, "OLI-42");

    assert.equal(description.includes("{{"), false);
    assert.ok(description.includes("<agent_id>OLI-42</agent_id>"));
    assert.ok(description.includes(`start --agent-id OLI-42 --server-url ${experiment.serverUrl} --iso ${experiment.iso}`));
    assert.ok(description.includes(`./ctrl test start --server-url ${experiment.serverUrl} --session-id`));
    assert.ok(description.includes(`./ctrl test-results --agent-id OLI-42 --server-url ${experiment.serverUrl} --id ${test.id}`));
    assert.ok(description.includes(`./client get-image --agent-id OLI-42 --server-url ${experiment.serverUrl} --session-id`));
    assert.ok(description.includes(`./client stop --agent-id OLI-42 --server-url ${experiment.serverUrl} --session-id`));
    assert.equal(description.includes("<id>"), false);
    assert.ok(description.includes(`<run_id>${experiment.id}</run_id>`));
    assert.ok(description.includes(`<result_id>${test.id}</result_id>`));
    assert.ok(description.includes(`<version>${experiment.version}</version>`));
    assert.ok(description.includes(`<name>${test.name}</name>`));
    assert.ok(description.includes(`<description>${test.description}</description>`));
    assert.ok(description.includes(`<instruction>${test.instruction}</instruction>`));
    assert.ok(description.includes(`<proof>${test.proof}</proof>`));
    assert.ok(description.includes("# Client\n"));
    assert.ok(description.includes("## The loop"));
    assert.ok(description.includes("# Control\n"));
    assert.ok(description.includes("## test start"));
    assert.ok(description.includes("## test-results"));
    assert.equal(description.includes("--session_id"), false);
    assert.equal(description.includes("--server_url"), false);
    assert.equal(description.includes(experiment.tests[1].name), false);
    assert.equal(description.includes(experiment.tests[1].id), false);
  });
});

describe("drivingAgentPrompt happy path", () => {
  it("renders the kickoff prompt with the ticket, the server URL, and both binaries", () => {
    const text = drivingAgentPrompt("OLI-42", "https://qemu.example.com");

    assert.equal(text.includes("{{"), false);
    assert.ok(text.includes("Review Linear ticket OLI-42"));
    assert.ok(text.includes("https://qemu.example.com"));
    assert.ok(text.includes("--server-url"));
    assert.ok(text.includes("./client"));
    assert.ok(text.includes("./ctrl"));
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
    mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "API key has no access" }] }));

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

  it("reports a description failure by ticket", async () => {
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
        return Response.json({ data: { issueUpdate: { success: false } } });
      }
      return issueResponse("OLI-42");
    });

    await assert.rejects(() => createLinearTicket("linear-token", experiment, experiment.tests[0]), {
      message: "linear: describing OLI-42 failed",
    });
  });
});
