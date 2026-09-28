import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import * as Linear from "../src/main.ts";
import * as Fake from "./fake.ts";

const TOKEN = "linear-token-s3ntinel";
const TEAM = "Fixture Team";
const API = "https://linear.example/graphql";

const client = (fake: { readonly fetch: Linear.Fetch }, team = TEAM) =>
  Linear.create({ token: { reveal: () => TOKEN }, team, apiUrl: API, fetch: fake.fetch });

const sent = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }) =>
  fake.asked.map((asked) => ({ field: asked.field, variables: asked.variables }));

type Failed = Linear.LinearError | Linear.LinearUnavailable;

const failure = <T>(result: jarl.Result<T, Failed>): Failed => {
  if (result.ok) {
    throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
};

const refused = <T>(result: jarl.Result<T, Failed>, message: string) => {
  const error = failure(result);
  expect(jarl.error.is(error, Linear.LinearError)).toBe(true);
  expect(error.message).toBe(message);
};

const unavailable = <T>(result: jarl.Result<T, Failed>, message: string) => {
  const error = failure(result);
  expect(jarl.error.is(error, Linear.LinearUnavailable)).toBe(true);
  expect(error.message).toBe(message);
};

// Answers the requests for `field` with `answer`, and every other request as a full board does.
const except =
  (field: string, answer: (asked: Fake.Asked) => Response | Promise<Response>) =>
  (asked: Fake.Asked, signal: AbortSignal) =>
    asked.field === field ? answer(asked) : Fake.happy(asked, signal);

const track = <T>(promise: Promise<T>) => {
  const state: { settled: boolean; value: T | undefined } = { settled: false, value: undefined };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
};

describe("creating a ticket", () => {
  it("creates it in Backlog, then moves it to Automation Needed with its body in one update (happy)", async () => {
    const fake = Fake.linear(Fake.happy);
    const linear = client(fake);

    const team = jarl.unwrap(await linear.teamId());
    const labelIds = jarl.unwrap(await linear.labelIds(team, "1.2.3"));
    const assigneeId = jarl.unwrap(await linear.assigneeId());
    const states = jarl.unwrap(await linear.stateIds(team));
    const ticket = jarl.unwrap(
      await linear.createIssue({
        teamId: team,
        title: "Omarchy: boot",
        labelIds,
        assigneeId,
        stateId: states.backlog,
      }),
    );
    jarl.unwrap(await linear.describeIssue(ticket, "the body", states.automationNeeded));

    expect(ticket).toEqual(Fake.TICKET);
    for (const asked of fake.asked) {
      expect(asked.url).toBe(API);
      expect(asked.method).toBe("POST");
      // Linear personal API keys take no `Bearer`.
      expect(asked.headers.get("authorization")).toBe(TOKEN);
      expect(asked.headers.get("content-type")).toBe("application/json");
    }
    expect(sent(fake)).toEqual([
      { field: "teams", variables: { name: TEAM } },
      { field: "issueLabels", variables: { name: "agent test", teamId: "team-id" } },
      { field: "issueLabels", variables: { name: "1.2.3", teamId: "team-id" } },
      { field: "users", variables: { email: "prime@terminal.shop" } },
      { field: "workflowStates", variables: { name: "Backlog", teamId: "team-id" } },
      { field: "workflowStates", variables: { name: "Automation Needed", teamId: "team-id" } },
      {
        field: "issueCreate",
        variables: {
          input: {
            teamId: "team-id",
            title: "Omarchy: boot",
            labelIds: [Fake.labelId("agent test"), Fake.labelId("1.2.3")],
            assigneeId: "user-id",
            stateId: Fake.stateId("Backlog"),
          },
        },
      },
      {
        field: "issueUpdate",
        variables: {
          id: Fake.TICKET.id,
          input: { description: "the body", stateId: Fake.stateId("Automation Needed") },
        },
      },
    ]);
  });

  it("creates a label the team does not have yet (happy)", async () => {
    const fake = Fake.linear((asked, signal) => {
      if (asked.field === "issueLabels") {
        return Fake.noNodes("issueLabels");
      }
      if (asked.field === "issueLabelCreate") {
        const { name } = z.object({ name: z.string() }).parse(asked.variables["input"]);
        return Fake.data({
          issueLabelCreate: { success: true, issueLabel: { id: Fake.labelId(name) } },
        });
      }
      return Fake.happy(asked, signal);
    });

    const labelIds = await client(fake).labelIds("team-id", "1.2.3");

    expect(labelIds).toEqual(jarl.ok([Fake.labelId("agent test"), Fake.labelId("1.2.3")]));
    const created = fake.asked
      .filter((asked) => asked.field === "issueLabelCreate")
      .map((asked) => asked.variables["input"]);
    expect(created).toHaveLength(2);
    expect(created).toEqual(
      expect.arrayContaining([
        { name: "agent test", teamId: "team-id" },
        { name: "1.2.3", teamId: "team-id" },
      ]),
    );
  });

  it("refuses a label Linear did not create (unhappy)", async () => {
    const fake = Fake.linear((asked, signal) => {
      if (asked.field === "issueLabels") {
        return Fake.noNodes("issueLabels");
      }
      if (asked.field === "issueLabelCreate") {
        return Fake.data({ issueLabelCreate: { success: false, issueLabel: null } });
      }
      return Fake.happy(asked, signal);
    });

    refused(await client(fake).labelIds("team-id", "1.2.3"), "linear: label creation failed");
  });

  it("names a team the token cannot see, in one request (unhappy)", async () => {
    const fake = Fake.linear(except("teams", () => Fake.noNodes("teams")));

    refused(await client(fake, "Other Board").teamId(), "linear: no team named Other Board");
    expect(fake.asked).toHaveLength(1);
  });

  it("names an assignee who is not a workspace user (unhappy)", async () => {
    const fake = Fake.linear(except("users", () => Fake.noNodes("users")));

    refused(await client(fake).assigneeId(), "linear: no user prime@terminal.shop");
  });

  it("names a board state the team lacks (unhappy)", async () => {
    const fake = Fake.linear(
      except("workflowStates", (asked) =>
        asked.variables["name"] === "Automation Needed"
          ? Fake.noNodes("workflowStates")
          : Fake.happy(asked, new AbortController().signal),
      ),
    );

    refused(await client(fake).stateIds("team-id"), "linear: no state named Automation Needed");
  });

  it("refuses an issue Linear did not create (unhappy)", async () => {
    const fake = Fake.linear(
      except("issueCreate", () => Fake.data({ issueCreate: { success: false, issue: null } })),
    );
    const input = { teamId: "t", title: "x", labelIds: [], assigneeId: "u", stateId: "s" };

    refused(await client(fake).createIssue(input), "linear: issue creation failed");
  });

  it("names the ticket whose description did not land (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

    refused(
      await client(fake).describeIssue(Fake.TICKET, "the body", "state"),
      "linear: describing OLI-42 failed",
    );
  });

  it("moveIssue sends the state and no description, which would wipe the body (happy)", async () => {
    const fake = Fake.linear(Fake.happy);

    expect(await client(fake).moveIssue(Fake.TICKET, "state-x")).toEqual(jarl.ok(undefined));
    expect(sent(fake)).toEqual([
      { field: "issueUpdate", variables: { id: Fake.TICKET.id, input: { stateId: "state-x" } } },
    ]);
  });

  it("moveIssue names the ticket that did not move (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

    refused(await client(fake).moveIssue(Fake.TICKET, "state-x"), "linear: moving OLI-42 failed");
  });
});

describe("what a failed request says", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([503, 429])("a %i is worth asking again, and is sent once (unhappy)", async (status) => {
    const fake = Fake.linear(() => new Response("busy", { status }));

    unavailable(await client(fake).teamId(), `linear: request failed (${String(status)}): busy`);
    expect(fake.asked).toHaveLength(1);
  });

  it("a refusal is not worth asking again and carries the status and body (unhappy)", async () => {
    const fake = Fake.linear(() => new Response("unauthorized", { status: 401 }));

    refused(await client(fake).teamId(), "linear: request failed (401): unauthorized");
  });

  it("a failure with no body has no trailing colon (unhappy)", async () => {
    refused(
      await client(Fake.linear(() => new Response(null, { status: 404 }))).teamId(),
      "linear: request failed (404)",
    );
    unavailable(
      await client(Fake.linear(() => new Response(null, { status: 500 }))).teamId(),
      "linear: request failed (500)",
    );
  });

  it("GraphQL errors are joined and are not worth asking again (unhappy)", async () => {
    const fake = Fake.linear(() => Fake.errors("API key has no access", "and more"));

    refused(await client(fake).teamId(), "linear: API key has no access; and more");
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["JSON without data", () => Fake.json({})],
    ["data of the wrong shape", () => Fake.data({ teams: "nope" })],
  ])("%s is an invalid response (unhappy)", async (_, answer) => {
    refused(await client(Fake.linear(answer)).teamId(), "linear: invalid response");
  });

  it("a request that never reaches Linear is worth asking again and keeps why (unhappy)", async () => {
    const why = new TypeError("connect ECONNREFUSED 127.0.0.1:1");
    const fake = Fake.linear(() => {
      throw why;
    });

    const result = await client(fake).teamId();

    unavailable(result, "linear: request failed");
    expect(failure(result).cause).toBe(why);
  });

  it("an answer that takes nine seconds is kept (happy)", async () => {
    vi.useFakeTimers();
    const fake = Fake.linear(
      () => new Promise((resolve) => setTimeout(() => resolve(Fake.team()), 9_000)),
    );

    const result = track(client(fake).teamId());
    await vi.advanceTimersByTimeAsync(9_000);

    expect(result.value).toEqual(jarl.ok("team-id"));
  });

  it("no answer within ten seconds is worth asking again, and the request is dropped (unhappy)", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const fake = Fake.linear((_, signal) => {
      seen = signal;
      return Fake.hang(signal);
    });

    const asked = client(fake).teamId();
    const result = track(asked);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    unavailable(await asked, "linear: request failed: no answer within 10 seconds");
    expect(seen?.aborted).toBe(true);
  });

  it("the token appears in no error (unhappy)", async () => {
    const answers: ReadonlyArray<() => Response> = [
      () => new Response(`bad key ${"*".repeat(4)}`, { status: 401 }),
      () => Fake.errors("Authentication required"),
      () => new Response("<html>"),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const answer of answers) {
      const error = failure(await client(Fake.linear(answer)).teamId());
      const rendered = `${error.message}\n${String(error.stack)}\n${String(error.cause)}\n${JSON.stringify(error)}`;
      expect(rendered).not.toContain(TOKEN);
    }
  });
});

const moves = [
  ["moveToInProgress", "In Progress"],
  ["moveToInReview", "In Review"],
  ["moveToNeedsReview", "Needs Review"],
  ["moveToFailed", "Failed"],
  ["moveToSucceeded", "Succeeded"],
] as const;

describe("moving a ticket by identifier", () => {
  it.each(moves)(
    "%s finds the team's %s state by name and moves the ticket (happy)",
    async (move, state) => {
      const fake = Fake.linear(Fake.happy);

      expect(await client(fake)[move]("OLI-45")).toEqual(jarl.ok(undefined));
      expect(sent(fake)).toEqual([
        { field: "teams", variables: { name: TEAM } },
        { field: "workflowStates", variables: { name: state, teamId: "team-id" } },
        {
          field: "issueUpdate",
          variables: { id: "OLI-45", input: { stateId: Fake.stateId(state) } },
        },
      ]);
    },
  );

  const everyMove = [
    ...moves.map(
      ([move, state]) => [move, state, (linear: Linear.Linear) => linear[move]("OLI-45")] as const,
    ),
    [
      "moveToErrored",
      "Errored",
      (linear: Linear.Linear) => linear.moveToErrored("OLI-45", "why"),
    ] as const,
  ];

  it.each(everyMove)(
    "%s refuses a board without %s before any update (unhappy)",
    async (_, state, move) => {
      const fake = Fake.linear(except("workflowStates", () => Fake.noNodes("workflowStates")));

      refused(await move(client(fake)), `linear: no state named ${state}`);
      expect(fake.asked.map((asked) => asked.field)).toEqual(["teams", "workflowStates"]);
    },
  );

  it.each(everyMove)(
    "%s names the ticket that did not move to %s (unhappy)",
    async (_, state, move) => {
      const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

      refused(await move(client(fake)), `linear: moving OLI-45 to ${state} failed`);
    },
  );

  it("moveToErrored moves the ticket, then comments why (happy)", async () => {
    const fake = Fake.linear(Fake.happy);

    expect(await client(fake).moveToErrored("OLI-45", "drive errored")).toEqual(jarl.ok(undefined));
    expect(sent(fake)).toEqual([
      { field: "teams", variables: { name: TEAM } },
      { field: "workflowStates", variables: { name: "Errored", teamId: "team-id" } },
      {
        field: "issueUpdate",
        variables: { id: "OLI-45", input: { stateId: Fake.stateId("Errored") } },
      },
      {
        field: "commentCreate",
        variables: { input: { issueId: "OLI-45", body: "drive errored" } },
      },
    ]);
  });

  it("moveToErrored names the ticket whose comment did not land (unhappy)", async () => {
    const fake = Fake.linear(except("commentCreate", () => Fake.commented(false)));

    refused(
      await client(fake).moveToErrored("OLI-45", "why"),
      "linear: commenting on OLI-45 failed",
    );
  });

  it("moveToAborted finds Aborted on the ticket's own team, with no team lookup (happy)", async () => {
    const fake = Fake.linear(Fake.happy);

    expect(await client(fake).moveToAborted("OLI-45")).toEqual(jarl.ok(undefined));
    expect(sent(fake)).toEqual([
      { field: "issue", variables: { ticket: "OLI-45", state: "Aborted" } },
      {
        field: "issueUpdate",
        variables: { id: "OLI-45", input: { stateId: Fake.stateId("Aborted") } },
      },
    ]);
  });

  it("moveToAborted stops at the first request for a ticket Linear does not know (unhappy)", async () => {
    const fake = Fake.linear(() => Fake.errors("Entity not found: Issue"));

    refused(await client(fake).moveToAborted("OLI-404"), "linear: Entity not found: Issue");
    expect(fake.asked).toHaveLength(1);
  });

  it("moveToAborted refuses a team without Aborted before any update (unhappy)", async () => {
    const fake = Fake.linear(
      except("issue", () => Fake.data({ issue: { team: { states: { nodes: [] } } } })),
    );

    refused(await client(fake).moveToAborted("OLI-45"), "linear: no state named Aborted");
    expect(fake.asked).toHaveLength(1);
  });

  it("issueStateId reads the column the ticket sits in now (happy)", async () => {
    const fake = Fake.linear(Fake.happy);

    expect(await client(fake).issueStateId(Fake.TICKET)).toEqual(jarl.ok(Fake.stateId("Now")));
    expect(sent(fake)).toEqual([{ field: "issue", variables: { id: Fake.TICKET.id } }]);
  });

  it("issueStateId reports a ticket Linear will not answer for (unhappy)", async () => {
    const fake = Fake.linear(() => Fake.errors("Entity not found: Issue"));

    refused(await client(fake).issueStateId(Fake.TICKET), "linear: Entity not found: Issue");
  });
});

describe("the ready label", () => {
  it("two markReady at once look the label up once, and clearReady reuses it (happy)", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = Fake.linear(async (asked, signal) => {
      if (asked.field === "teams") {
        await held;
      }
      return Fake.happy(asked, signal);
    });
    const linear = client(fake);

    const both = Promise.all([linear.markReady("OLI-45"), linear.markReady("OLI-46")]);
    await vi.waitFor(() => expect(fake.asked).toHaveLength(1));
    release();
    expect(await both).toEqual([jarl.ok(undefined), jarl.ok(undefined)]);
    expect(await linear.clearReady("OLI-45")).toEqual(jarl.ok(undefined));

    const ready = Fake.labelId("ready");
    expect(sent(fake)).toEqual([
      { field: "teams", variables: { name: TEAM } },
      { field: "issueLabels", variables: { name: "ready", teamId: "team-id" } },
      { field: "issueUpdate", variables: { id: "OLI-45", input: { addedLabelIds: [ready] } } },
      { field: "issueUpdate", variables: { id: "OLI-46", input: { addedLabelIds: [ready] } } },
      { field: "issueUpdate", variables: { id: "OLI-45", input: { removedLabelIds: [ready] } } },
    ]);
  });

  it("a lookup that failed is not kept: the next ticket looks again (unhappy)", async () => {
    let teams = 0;
    const fake = Fake.linear(
      except("teams", () => {
        teams += 1;
        return teams === 1 ? new Response("busy", { status: 503 }) : Fake.team();
      }),
    );
    const linear = client(fake);

    unavailable(await linear.markReady("OLI-45"), "linear: request failed (503): busy");
    expect(await linear.markReady("OLI-46")).toEqual(jarl.ok(undefined));
    expect(teams).toBe(2);
  });

  it("clearReady on a ticket that does not carry the label is done (happy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.errors("Label not on issue")));

    expect(await client(fake).clearReady("OLI-45")).toEqual(jarl.ok(undefined));
  });

  it("clearReady fails on any other refusal (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.errors("Entity not found: Issue")));

    refused(await client(fake).clearReady("OLI-45"), "linear: Entity not found: Issue");
  });

  it("markReady and clearReady name the ticket whose label update did not succeed (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));
    const linear = client(fake);

    refused(await linear.markReady("OLI-45"), "linear: labeling OLI-45 ready failed");
    refused(await linear.clearReady("OLI-45"), "linear: clearing OLI-45 ready failed");
  });
});

describe("listing tickets", () => {
  const ticket = (n: number) => ({
    id: `issue-${String(n)}`,
    identifier: `OLI-${String(n)}`,
    title: `ticket ${String(n)}`,
    url: `https://linear.app/OLI-${String(n)}`,
    updatedAt: "2026-09-27T00:00:00.000Z",
  });

  it("listBacklog asks 100 at a time and follows the cursor to the last page (happy)", async () => {
    const fake = Fake.linear(
      except("issues", (asked) =>
        asked.variables["after"] === undefined
          ? Fake.page([ticket(1), ticket(2)], "cursor-1")
          : Fake.page([ticket(3)], undefined),
      ),
    );

    expect(await client(fake).listBacklog()).toEqual(jarl.ok([ticket(1), ticket(2), ticket(3)]));
    const filter = { team: { name: { eq: TEAM } }, state: { type: { eq: "backlog" } } };
    expect(sent(fake)).toEqual([
      { field: "teams", variables: { name: TEAM } },
      { field: "issues", variables: { filter } },
      { field: "issues", variables: { filter, after: "cursor-1" } },
    ]);
    expect(fake.asked[1]?.query).toContain("first: 100");
  });

  it("a further page without a cursor is an invalid response (unhappy)", async () => {
    const fake = Fake.linear(except("issues", () => Fake.page([], null)));

    refused(await client(fake).listBacklog(), "linear: invalid response");
    expect(fake.asked).toHaveLength(2);
  });

  it("refuses a team Linear does not have before listing anything (unhappy)", async () => {
    const fake = Fake.linear(except("teams", () => Fake.noNodes("teams")));

    refused(
      await client(fake, "Other Board").listNeedsReview(),
      "linear: no team named Other Board",
    );
    expect(fake.asked).toHaveLength(1);
  });

  it("listAutomationNeeded leaves out the tickets already labelled ready (happy)", async () => {
    const fake = Fake.linear(except("issues", () => Fake.page([ticket(1)], undefined)));

    expect(await client(fake).listAutomationNeeded()).toEqual(jarl.ok([ticket(1)]));
    expect(fake.asked[1]?.variables).toEqual({
      filter: {
        team: { name: { eq: TEAM } },
        state: { name: { eq: "Automation Needed" } },
        labels: { or: [{ null: true }, { every: { name: { neq: "ready" } } }] },
      },
    });
  });

  it("listNeedsReview asks for the Needs Review state by name (happy)", async () => {
    const fake = Fake.linear(except("issues", () => Fake.page([], undefined)));

    expect(await client(fake).listNeedsReview()).toEqual(jarl.ok([]));
    expect(fake.asked[1]?.variables).toEqual({
      filter: { team: { name: { eq: TEAM } }, state: { name: { eq: "Needs Review" } } },
    });
  });
});
