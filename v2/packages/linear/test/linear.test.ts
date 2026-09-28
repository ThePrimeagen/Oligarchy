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
const READY = Fake.labelId("ready");

const client = (fake: { readonly http: Http.Http }, team = TEAM) =>
  Linear.create({ token: { reveal: () => TOKEN }, team, apiUrl: API, http: fake.http });

const sent = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }) =>
  fake.asked.map((asked) => ({ field: asked.field, variables: asked.variables }));

const fields = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }) =>
  fake.asked.map((asked) => asked.field);

// What the ticket was asked to become: every update's input, and every comment's body.
type Write =
  | { readonly update: unknown; readonly input: Readonly<Record<string, unknown>> }
  | { readonly comment: Readonly<Record<string, unknown>> };

const writes = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }): ReadonlyArray<Write> =>
  fake.asked.flatMap((asked): ReadonlyArray<Write> => {
    if (asked.field === "issueUpdate") {
      return [{ update: asked.variables["id"], input: Fake.input(asked) }];
    }
    if (asked.field === "commentCreate") {
      return [{ comment: Fake.input(asked) }];
    }
    return [];
  });

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

// Every move the app makes, the column it lands in, and what it does to the ready label.
const transitions = [
  ["readyForAutomation", "Automation Needed", { addedLabelIds: [READY] }],
  ["startDrive", "In Progress", { removedLabelIds: [READY] }],
  ["readyForReview", "Needs Review", {}],
  ["startDiagnosis", "In Review", {}],
  ["markSucceeded", "Succeeded", {}],
  ["markFailed", "Failed", {}],
  ["markErrored", "Errored", { removedLabelIds: [READY] }],
  ["markAborted", "Aborted", { removedLabelIds: [READY] }],
] as const;

type Transition = (typeof transitions)[number][0];

const move = (linear: Linear.Linear, name: Transition, ticket = "OLI-42") =>
  name === "markErrored" ? linear.markErrored(ticket, "drive errored; why") : linear[name](ticket);

// The moves that leave Automation Needed, and so take the ready label off.
const dropping = [
  ["startDrive", "In Progress"],
  ["markErrored", "Errored"],
  ["markAborted", "Aborted"],
] as const;

describe("a ticket's life", () => {
  it("is filed in Backlog, described, readied, driven, reviewed and judged, each lookup asked once (happy)", async () => {
    const fake = Fake.linear(Fake.happy);
    const linear = client(fake);

    const ticket = jarl.unwrap(
      await linear.createTicket({ title: "Omarchy: boot", label: "1.2.3" }),
    );
    jarl.unwrap(await linear.setDescription(ticket.identifier, "the body"));
    jarl.unwrap(await linear.readyForAutomation(ticket.identifier));
    jarl.unwrap(await linear.startDrive(ticket.identifier));
    jarl.unwrap(await linear.readyForReview(ticket.identifier));
    jarl.unwrap(await linear.startDiagnosis(ticket.identifier));
    jarl.unwrap(await linear.markSucceeded(ticket.identifier));

    expect(ticket).toEqual({ identifier: "OLI-42", url: "https://linear.app/OLI-42" });
    for (const asked of fake.asked) {
      expect(asked.url).toBe(API);
      expect(asked.method).toBe("POST");
      // Linear personal API keys take no `Bearer`.
      expect(asked.headers["authorization"]).toBe(TOKEN);
      expect(asked.headers["content-type"]).toBe("application/json");
    }
    const state = (name: string) => ({
      field: "workflowStates",
      variables: { name, teamId: "team-id" },
    });
    const update = (input: Record<string, unknown>) => ({
      field: "issueUpdate",
      variables: { id: "OLI-42", input },
    });
    expect(sent(fake)).toEqual([
      { field: "teams", variables: { name: TEAM } },
      { field: "issueLabels", variables: { name: "agent test", teamId: "team-id" } },
      { field: "issueLabels", variables: { name: "1.2.3", teamId: "team-id" } },
      { field: "users", variables: { email: "prime@terminal.shop" } },
      state("Backlog"),
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
      update({ description: "the body" }),
      state("Automation Needed"),
      { field: "issueLabels", variables: { name: "ready", teamId: "team-id" } },
      update({ stateId: Fake.stateId("Automation Needed"), addedLabelIds: [READY] }),
      state("In Progress"),
      update({ stateId: Fake.stateId("In Progress"), removedLabelIds: [READY] }),
      state("Needs Review"),
      update({ stateId: Fake.stateId("Needs Review") }),
      state("In Review"),
      update({ stateId: Fake.stateId("In Review") }),
      state("Succeeded"),
      update({ stateId: Fake.stateId("Succeeded") }),
    ]);
  });

  it.each(transitions)(
    "%s moves the ticket to %s in one update, with what it does to ready (happy)",
    async (name, column, label) => {
      const fake = Fake.linear(Fake.happy);

      jarl.unwrap(await move(client(fake), name));

      const moved = { update: "OLI-42", input: { stateId: Fake.stateId(column), ...label } };
      expect(writes(fake)).toEqual(
        name === "markErrored"
          ? [moved, { comment: { issueId: "OLI-42", body: "drive errored; why" } }]
          : [moved],
      );
    },
  );
});

describe("filing a ticket", () => {
  it("refuses a team the token cannot see, in one request, creating nothing (unhappy)", async () => {
    const fake = Fake.linear(except("teams", () => Fake.noNodes("teams")));

    refused(
      await client(fake, "Other Board").createTicket({ title: "t", label: "1.2.3" }),
      "linear: no team named Other Board",
    );
    expect(fake.asked).toHaveLength(1);
  });

  it("refuses an assignee who is not a workspace user, creating nothing (unhappy)", async () => {
    const fake = Fake.linear(except("users", () => Fake.noNodes("users")));

    refused(
      await client(fake).createTicket({ title: "t", label: "1.2.3" }),
      "linear: no user prime@terminal.shop",
    );
    expect(fields(fake)).not.toContain("issueCreate");
  });

  it("refuses a board without Backlog, creating nothing (unhappy)", async () => {
    const fake = Fake.linear(except("workflowStates", () => Fake.noNodes("workflowStates")));

    refused(
      await client(fake).createTicket({ title: "t", label: "1.2.3" }),
      "linear: no state named Backlog",
    );
    expect(fields(fake)).not.toContain("issueCreate");
  });

  it("creates a label the board lacks and files the ticket under it", async () => {
    const fake = Fake.linear((asked) => {
      if (asked.field === "issueLabels" && asked.variables["name"] === "1.2.4") {
        return Fake.noNodes("issueLabels");
      }
      if (asked.field === "issueLabelCreate") {
        return Fake.data({ issueLabelCreate: { success: true, issueLabel: { id: "made" } } });
      }
      return Fake.happy(asked);
    });

    jarl.unwrap(await client(fake).createTicket({ title: "t", label: "1.2.4" }));

    const made = fake.asked.find((asked) => asked.field === "issueLabelCreate");
    expect(made?.variables).toEqual({ input: { name: "1.2.4", teamId: "team-id" } });
    const created = fake.asked.find((asked) => asked.field === "issueCreate");
    expect(created === undefined ? undefined : Fake.input(created)["labelIds"]).toEqual([
      Fake.labelId("agent test"),
      "made",
    ]);
  });

  it("refuses a label Linear did not create, creating no ticket (unhappy)", async () => {
    const fake = Fake.linear((asked) => {
      if (asked.field === "issueLabels") {
        return Fake.noNodes("issueLabels");
      }
      if (asked.field === "issueLabelCreate") {
        return Fake.data({ issueLabelCreate: { success: false, issueLabel: null } });
      }
      return Fake.happy(asked);
    });

    refused(
      await client(fake).createTicket({ title: "t", label: "1.2.3" }),
      "linear: label creation failed",
    );
    expect(fields(fake)).not.toContain("issueCreate");
  });

  it("refuses an issue Linear did not create (unhappy)", async () => {
    const fake = Fake.linear(
      except("issueCreate", () => Fake.data({ issueCreate: { success: false, issue: null } })),
    );

    refused(
      await client(fake).createTicket({ title: "t", label: "1.2.3" }),
      "linear: issue creation failed",
    );
  });

  it("names the ticket whose description did not land (unhappy)", async () => {
    const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

    refused(
      await client(fake).setDescription("OLI-42", "the body"),
      "linear: describing OLI-42 failed",
    );
  });
});

describe("moving a ticket", () => {
  it.each(transitions)(
    "%s refuses a board without %s before any update (unhappy)",
    async (name, column) => {
      const fake = Fake.linear(except("workflowStates", () => Fake.noNodes("workflowStates")));

      refused(await move(client(fake), name), `linear: no state named ${column}`);
      expect(fields(fake)).toEqual(["teams", "workflowStates"]);
    },
  );

  it.each(transitions)(
    "%s names the ticket that did not move to %s (unhappy)",
    async (name, column) => {
      const fake = Fake.linear(except("issueUpdate", () => Fake.updated(false)));

      refused(await move(client(fake), name), `linear: moving OLI-42 to ${column} failed`);
      expect(fields(fake)).not.toContain("commentCreate");
    },
  );

  it("refuses a team the token cannot see before looking for the column (unhappy)", async () => {
    const fake = Fake.linear(except("teams", () => Fake.noNodes("teams")));

    refused(
      await client(fake, "Other Board").startDrive("OLI-42"),
      "linear: no team named Other Board",
    );
    expect(fake.asked).toHaveLength(1);
  });

  // A ticket that does not carry ready: Linear refuses its removal, and answers the move alone
  // with `then`.
  const withoutReady = (then: () => HttpFake.Reply) => (asked: Fake.Asked) => {
    if (asked.field !== "issueUpdate") {
      return Fake.happy(asked);
    }
    return "removedLabelIds" in Fake.input(asked) ? Fake.errors("Label not on issue") : then();
  };

  it.each(dropping)(
    "%s on a ticket without the ready label sends the move to %s alone (unhappy)",
    async (name, column) => {
      const fake = Fake.linear(withoutReady(() => Fake.updated()));

      expect(await move(client(fake), name)).toEqual(jarl.ok(undefined));
      const moved = { update: "OLI-42", input: { stateId: Fake.stateId(column) } };
      expect(writes(fake).filter((write) => "update" in write)).toEqual([
        { update: "OLI-42", input: { stateId: Fake.stateId(column), removedLabelIds: [READY] } },
        moved,
      ]);
    },
  );

  it.each(dropping)(
    "%s fails when the move to %s sent alone is not taken either (unhappy)",
    async (name, column) => {
      const fake = Fake.linear(withoutReady(() => Fake.updated(false)));

      refused(await move(client(fake), name), `linear: moving OLI-42 to ${column} failed`);
    },
  );

  it("a missing label beside another refusal is the failure, and nothing is sent again (unhappy)", async () => {
    const fake = Fake.linear(
      except("issueUpdate", () => Fake.errors("Label not on issue", "Entity not found: Issue")),
    );

    refused(
      await client(fake).markAborted("OLI-42"),
      "linear: Label not on issue; Entity not found: Issue",
    );
    expect(fields(fake).filter((field) => field === "issueUpdate")).toHaveLength(1);
  });

  it("markErrored names the ticket whose comment did not land, after it moved (unhappy)", async () => {
    const fake = Fake.linear(except("commentCreate", () => Fake.commented(false)));

    refused(
      await client(fake).markErrored("OLI-42", "drive errored; why"),
      "linear: commenting on OLI-42 failed",
    );
    expect(fields(fake).slice(-2)).toEqual(["issueUpdate", "commentCreate"]);
  });
});

describe("the board's ids", () => {
  it("a lookup that failed is not kept: the next move looks again (unhappy)", async () => {
    let teams = 0;
    const fake = Fake.linear(
      except("teams", () => {
        teams += 1;
        return teams === 1 ? HttpFake.status(503, "busy") : Fake.team();
      }),
    );
    const linear = client(fake);

    failed(await linear.startDrive("OLI-45"), Http.HttpServerError, `${WHERE}: 503: busy`, true);
    expect(await linear.startDrive("OLI-46")).toEqual(jarl.ok(undefined));
    expect(teams).toBe(2);
  });

  it("moves asked at once share one lookup of each id", async () => {
    const fake = Fake.linear(Fake.happy);
    const linear = client(fake);

    const both = await Promise.all([linear.startDrive("OLI-45"), linear.startDrive("OLI-46")]);

    expect(both).toEqual([jarl.ok(undefined), jarl.ok(undefined)]);
    expect(fields(fake).sort()).toEqual(
      ["teams", "workflowStates", "issueLabels", "issueUpdate", "issueUpdate"].sort(),
    );
  });
});

describe("what a failed request says", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Linear adds nothing to a failure of the request itself, and sends nothing again: it comes
  // back as Http made it, and retryable says whether asking again could answer.
  it.each([
    ["a 5xx", HttpFake.status(503, "busy"), Http.HttpServerError, `${WHERE}: 503: busy`, true],
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

      failed(await client(fake).listNeedsReview(), error, message, retryable);
      expect(fake.asked).toHaveLength(1);
    },
  );

  it("a 429 waits five seconds and is asked once more (unhappy)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fake = Fake.linear((asked) => {
      calls += 1;
      return calls === 1 ? HttpFake.status(429, "slow down") : Fake.happy(asked);
    });
    const asked = client(fake).readyForReview("OLI-42");
    const result = track(asked);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(result.settled).toBe(false);
    expect(fake.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await asked).toEqual(jarl.ok(undefined));
    expect(fields(fake)).toEqual(["teams", "teams", "workflowStates", "issueUpdate"]);
  });

  it("a second 429 is the failure, from two requests (unhappy)", async () => {
    vi.useFakeTimers();
    const fake = Fake.linear(() => HttpFake.status(429, "slow down"));
    const asked = client(fake).readyForReview("OLI-42");

    await vi.advanceTimersByTimeAsync(5_000);

    failed(await asked, Http.HttpUnhandled, `${WHERE}: 429: slow down`, true);
    expect(fake.asked).toHaveLength(2);
  });

  it("GraphQL errors are joined and are not worth asking again (unhappy)", async () => {
    const fake = Fake.linear(() => Fake.errors("API key has no access", "and more"));

    refused(await client(fake).listNeedsReview(), "linear: API key has no access; and more");
  });

  it.each([
    ["a body that is not JSON", () => HttpFake.status(200, "<html>"), "body is not JSON"],
    ["JSON without data", () => HttpFake.json({}), "linear: invalid response"],
    ["an envelope that is not GraphQL's", () => HttpFake.json([]), "linear: invalid response"],
    ["data of the wrong shape", () => Fake.data({ teams: "nope" }), "linear: invalid response"],
  ])("%s is an invalid response (unhappy)", async (_, answer, reason) => {
    const fake = Fake.linear(answer);
    const error = HttpFake.failure(await client(fake).listNeedsReview(), Http.HttpInvalid);
    expect(error.message).toContain(`${WHERE}: ${reason}`);
    expect(Linear.retryable(error)).toBe(false);
    expect(fake.asked).toHaveLength(1);
  });

  it("no answer within ten seconds is the failure, and nothing is sent again (unhappy)", async () => {
    vi.useFakeTimers();
    const fake = Fake.linear(() => "hang");
    const asked = client(fake).listNeedsReview();
    const result = track(asked);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    failed(await asked, Http.HttpTimedOut, `${WHERE}: no answer within 10000 ms`, true);
    expect(fake.asked).toHaveLength(1);
  });

  it("the token appears in no error (unhappy)", async () => {
    const answers: ReadonlyArray<() => HttpFake.Reply> = [
      () => HttpFake.status(401, `bad key ${"*".repeat(4)}`),
      () => Fake.errors("Authentication required"),
      () => HttpFake.status(200, "<html>"),
      () => "unreachable",
    ];
    for (const answer of answers) {
      const result = await client(Fake.linear(answer)).listNeedsReview();
      const error = HttpFake.failure(result, Error);
      const rendered = `${error.message}\n${String(error.stack)}\n${String(error.cause)}\n${JSON.stringify(error)}`;
      expect(rendered).not.toContain(TOKEN);
    }
  });
});

describe("listing the board", () => {
  const ticket = (n: number) => ({
    id: `issue-${String(n)}`,
    identifier: `OLI-${String(n)}`,
    title: `ticket ${String(n)}`,
    url: `https://linear.app/OLI-${String(n)}`,
    updatedAt: "2026-09-27T00:00:00.000Z",
  });

  const listed = (n: number) => ({
    identifier: `OLI-${String(n)}`,
    title: `ticket ${String(n)}`,
    url: `https://linear.app/OLI-${String(n)}`,
    updatedAt: "2026-09-27T00:00:00.000Z",
  });

  const team = { name: { eq: TEAM } };

  it.each([
    ["listBacklog", { team, state: { type: { eq: "backlog" } } }],
    ["listAutomationNeeded", { team, state: { name: { eq: "Automation Needed" } } }],
    ["listNeedsReview", { team, state: { name: { eq: "Needs Review" } } }],
  ] as const)("%s reads every page of its column", async (name, filter) => {
    const fake = Fake.linear(
      except("issues", (asked) =>
        asked.variables["after"] === undefined
          ? Fake.page([ticket(1)], "cursor-1")
          : Fake.page([ticket(2)], undefined),
      ),
    );

    expect(await client(fake)[name]()).toEqual(jarl.ok([listed(1), listed(2)]));
    expect(sent(fake).filter((asked) => asked.field === "issues")).toEqual([
      { field: "issues", variables: { filter } },
      { field: "issues", variables: { filter, after: "cursor-1" } },
    ]);
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
