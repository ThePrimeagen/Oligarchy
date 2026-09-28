import * as Http from "@oligarchy/http";
import * as HttpFake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Linear from "../src/main.ts";
import * as Fake from "./fake.ts";

const TOKEN = "linear-token-s3ntinel";
const TEAM = "Fixture Team";
const API = "https://linear.example/graphql";
const WHERE = `POST ${API}`;

const client = (fake: { readonly http: Http.Http }, team = TEAM) =>
  Linear.create({ token: { reveal: () => TOKEN }, team, apiUrl: API, http: fake.http });

const sent = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }) =>
  fake.asked.map((asked) => ({ field: asked.field, variables: asked.variables }));

type Ctor<C> = abstract new (...args: never[]) => C;

// The result failed with an error of `error` saying `message`, and asking again is `retryable`.
const failed = (
  result: jarl.Result<unknown, Linear.LinearFailure>,
  error: Ctor<Linear.LinearFailure>,
  message: string,
  retryable: boolean,
) => {
  const found = HttpFake.failure(result, error);
  expect(found.message).toBe(message);
  expect(Linear.retryable(found)).toBe(retryable);
  return found;
};

// Linear's own refusal: final.
const refused = (result: jarl.Result<unknown, Linear.LinearFailure>, message: string) =>
  failed(result, Linear.LinearError, message, false);

// Answers the requests for `field` with `answer`, and every other request as a full board does.
const except =
  (field: string, answer: (asked: Fake.Asked) => HttpFake.Reply | Promise<HttpFake.Reply>) =>
  (asked: Fake.Asked) =>
    asked.field === field ? answer(asked) : Fake.happy(asked);

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
      expect(asked.headers["authorization"]).toBe(TOKEN);
      expect(asked.headers["content-type"]).toBe("application/json");
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

  it("stops at the first label it cannot find, asking nothing more (unhappy)", async () => {
    const fake = Fake.linear(except("issueLabels", () => HttpFake.status(503, "busy")));

    failed(
      await client(fake).labelIds("team-id", "1.2.3"),
      Http.HttpServerError,
      `${WHERE}: 503: busy`,
      true,
    );
    expect(fake.asked).toHaveLength(1);
  });

  it("stops at the first board state it cannot find, asking nothing more (unhappy)", async () => {
    const fake = Fake.linear(except("workflowStates", () => Fake.noNodes("workflowStates")));

    refused(await client(fake).stateIds("team-id"), "linear: no state named Backlog");
    expect(fake.asked).toHaveLength(1);
  });

  it("refuses a label Linear did not create (unhappy)", async () => {
    const fake = Fake.linear((asked) => {
      if (asked.field === "issueLabels") {
        return Fake.noNodes("issueLabels");
      }
      if (asked.field === "issueLabelCreate") {
        return Fake.data({ issueLabelCreate: { success: false, issueLabel: null } });
      }
      return Fake.happy(asked);
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
          : Fake.happy(asked),
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

  it("moveIssue names the ticket that did not move (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

    refused(await client(fake).moveIssue(Fake.TICKET, "state-x"), "linear: moving OLI-42 failed");
  });
});

describe("what a failed request says", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Linear adds nothing to a failure of the request itself: it comes back as Http made it, from
  // one request, and retryable says whether asking again could answer.
  it.each([
    ["a 5xx", HttpFake.status(503, "busy"), Http.HttpServerError, `${WHERE}: 503: busy`, true],
    [
      "a 429",
      HttpFake.status(429, "slow down"),
      Http.HttpUnhandled,
      `${WHERE}: 429: slow down`,
      true,
    ],
    [
      "a 400",
      HttpFake.status(400, "bad query"),
      Http.HttpBadRequest,
      `${WHERE}: 400: bad query`,
      false,
    ],
    [
      "a 401",
      HttpFake.status(401, "unauthorized"),
      Http.HttpUnhandled,
      `${WHERE}: 401: unauthorized`,
      false,
    ],
    ["no connection", "unreachable", Http.HttpUnreachable, `${WHERE}: fetch failed`, true],
  ] as const)(
    "%s comes back as it is, from one request (unhappy)",
    async (_, reply, error, message, retryable) => {
      const fake = Fake.linear(() => reply);

      failed(await client(fake).teamId(), error, message, retryable);
      expect(fake.asked).toHaveLength(1);
    },
  );

  it("GraphQL errors are joined and are not worth asking again (unhappy)", async () => {
    const fake = Fake.linear(() => Fake.errors("API key has no access", "and more"));

    refused(await client(fake).teamId(), "linear: API key has no access; and more");
  });

  it.each([
    ["a body that is not JSON", () => HttpFake.status(200, "<html>"), "body is not JSON"],
    ["JSON without data", () => HttpFake.json({}), "linear: invalid response"],
    ["an envelope that is not GraphQL's", () => HttpFake.json([]), "linear: invalid response"],
    ["data of the wrong shape", () => Fake.data({ teams: "nope" }), "linear: invalid response"],
  ])("%s is an invalid response (unhappy)", async (_, answer, reason) => {
    const error = HttpFake.failure(await client(Fake.linear(answer)).teamId(), Http.HttpInvalid);
    expect(error.message).toContain(`${WHERE}: ${reason}`);
    expect(Linear.retryable(error)).toBe(false);
  });

  it("no answer within ten seconds is worth asking again (unhappy)", async () => {
    vi.useFakeTimers();
    const asked = client(Fake.linear(() => "hang")).teamId();
    const result = track(asked);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    failed(await asked, Http.HttpTimedOut, `${WHERE}: no answer within 10000 ms`, true);
  });

  it("the token appears in no error (unhappy)", async () => {
    const answers: ReadonlyArray<() => HttpFake.Reply> = [
      () => HttpFake.status(401, `bad key ${"*".repeat(4)}`),
      () => Fake.errors("Authentication required"),
      () => HttpFake.status(200, "<html>"),
      () => "unreachable",
    ];
    for (const answer of answers) {
      const result = await client(Fake.linear(answer)).teamId();
      const error = HttpFake.failure(result, Error);
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
    "%s refuses a team the token cannot see before looking for %s (unhappy)",
    async (_, __, move) => {
      const fake = Fake.linear(except("teams", () => Fake.noNodes("teams")));

      refused(await move(client(fake, "Other Board")), "linear: no team named Other Board");
      expect(fake.asked).toHaveLength(1);
    },
  );

  it.each(everyMove)(
    "%s names the ticket that did not move to %s (unhappy)",
    async (_, state, move) => {
      const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

      refused(await move(client(fake)), `linear: moving OLI-45 to ${state} failed`);
    },
  );

  it("moveToErrored names the ticket whose comment did not land (unhappy)", async () => {
    const fake = Fake.linear(except("commentCreate", () => Fake.commented(false)));

    refused(
      await client(fake).moveToErrored("OLI-45", "why"),
      "linear: commenting on OLI-45 failed",
    );
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

  it("moveToAborted names the ticket that did not move to Aborted (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

    refused(await client(fake).moveToAborted("OLI-45"), "linear: moving OLI-45 to Aborted failed");
  });

  it("issueStateId reports a ticket Linear will not answer for (unhappy)", async () => {
    const fake = Fake.linear(() => Fake.errors("Entity not found: Issue"));

    refused(await client(fake).issueStateId(Fake.TICKET), "linear: Entity not found: Issue");
  });
});

describe("the ready label", () => {
  it("a lookup that failed is not kept: the next ticket looks again (unhappy)", async () => {
    let teams = 0;
    const fake = Fake.linear(
      except("teams", () => {
        teams += 1;
        return teams === 1 ? HttpFake.status(503, "busy") : Fake.team();
      }),
    );
    const linear = client(fake);

    failed(await linear.markReady("OLI-45"), Http.HttpServerError, `${WHERE}: 503: busy`, true);
    expect(await linear.markReady("OLI-46")).toEqual(jarl.ok(undefined));
    expect(teams).toBe(2);
  });

  it("clearReady on a ticket that does not carry the label is done: Linear's refusal is not a failure (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.errors("Label not on issue")));

    expect(await client(fake).clearReady("OLI-45")).toEqual(jarl.ok(undefined));
  });

  it("clearReady fails on any other refusal (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.errors("Entity not found: Issue")));

    refused(await client(fake).clearReady("OLI-45"), "linear: Entity not found: Issue");
  });

  it("clearReady fails when the missing label comes with another refusal (unhappy)", async () => {
    const fake = Fake.linear(
      except("issueUpdate", () => Fake.errors("Label not on issue", "Rate limited")),
    );

    refused(await client(fake).clearReady("OLI-45"), "linear: Label not on issue; Rate limited");
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

  it("a further page without a cursor is an invalid response (unhappy)", async () => {
    const fake = Fake.linear(except("issues", () => Fake.page([], null)));

    failed(await client(fake).listBacklog(), Http.HttpInvalid, "linear: invalid response", false);
    expect(fake.asked).toHaveLength(2);
  });

  it("a later page that fails is the listing's error, not the tickets so far (unhappy)", async () => {
    const fake = Fake.linear(
      except("issues", (asked) =>
        asked.variables["after"] === undefined
          ? Fake.page([ticket(1)], "cursor-1")
          : HttpFake.status(503, "busy"),
      ),
    );

    failed(await client(fake).listBacklog(), Http.HttpServerError, `${WHERE}: 503: busy`, true);
    expect(fake.asked).toHaveLength(3);
  });

  it("refuses a team Linear does not have before listing anything (unhappy)", async () => {
    const fake = Fake.linear(except("teams", () => Fake.noNodes("teams")));

    refused(
      await client(fake, "Other Board").listNeedsReview(),
      "linear: no team named Other Board",
    );
    expect(fake.asked).toHaveLength(1);
  });
});
