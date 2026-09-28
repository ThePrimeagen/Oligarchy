import * as Http from "@oligarchy/http";
import * as HttpFake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Linear from "../src/main.ts";
import * as Fake from "./fake.ts";

// Linear's contract at its error boundary. Every function of the interface is asked for the
// requests it sends; each request is then failed every way Http and Linear can fail it, and the
// function must come back with that failure, having sent the request once (twice after a 429)
// and nothing after it.

const TOKEN = "linear-token-s3ntinel";
const TEAM = "Fixture Team";
const API = "https://linear.example/graphql";
const WHERE = `POST ${API}`;
const TICKET = "OLI-42";

const client = (http: Http.Http) =>
  Linear.create({ token: { reveal: () => TOKEN }, team: TEAM, apiUrl: API, http });

type Outcome = jarl.Result<unknown, Linear.LinearFailure>;

type Action = {
  readonly name: string;
  readonly board: Fake.Answer;
  readonly call: (linear: Linear.Linear) => Promise<Outcome>;
  // What the function says when Linear answers its update with success false.
  readonly notUpdated?: string;
};

const moving = (column: string) => `linear: moving ${TICKET} to ${column} failed`;

const actions: ReadonlyArray<Action> = [
  {
    name: "createTicket",
    board: Fake.happy,
    call: (linear) => linear.createTicket({ title: "Omarchy: boot", label: "1.2.3" }),
  },
  {
    name: "createTicket with a label the board lacks",
    board: Fake.board(["1.2.4"]),
    call: (linear) => linear.createTicket({ title: "Omarchy: boot", label: "1.2.4" }),
  },
  {
    name: "setDescription",
    board: Fake.happy,
    call: (linear) => linear.setDescription(TICKET, "the body"),
    notUpdated: `linear: describing ${TICKET} failed`,
  },
  {
    name: "readyForAutomation",
    board: Fake.happy,
    call: (linear) => linear.readyForAutomation(TICKET),
    notUpdated: moving("Automation Needed"),
  },
  {
    name: "startDrive",
    board: Fake.happy,
    call: (linear) => linear.startDrive(TICKET),
    notUpdated: moving("In Progress"),
  },
  {
    name: "readyForReview",
    board: Fake.happy,
    call: (linear) => linear.readyForReview(TICKET),
    notUpdated: moving("Needs Review"),
  },
  {
    name: "startDiagnosis",
    board: Fake.happy,
    call: (linear) => linear.startDiagnosis(TICKET),
    notUpdated: moving("In Review"),
  },
  {
    name: "markSucceeded",
    board: Fake.happy,
    call: (linear) => linear.markSucceeded(TICKET),
    notUpdated: moving("Succeeded"),
  },
  {
    name: "markFailed",
    board: Fake.happy,
    call: (linear) => linear.markFailed(TICKET),
    notUpdated: moving("Failed"),
  },
  {
    name: "markErrored",
    board: Fake.happy,
    call: (linear) => linear.markErrored(TICKET, "drive errored; why"),
    notUpdated: moving("Errored"),
  },
  {
    name: "markAborted",
    board: Fake.happy,
    call: (linear) => linear.markAborted(TICKET),
    notUpdated: moving("Aborted"),
  },
  { name: "listBacklog", board: Fake.happy, call: (linear) => linear.listBacklog() },
  {
    name: "listAutomationNeeded",
    board: Fake.happy,
    call: (linear) => linear.listAutomationNeeded(),
  },
  { name: "listNeedsReview", board: Fake.happy, call: (linear) => linear.listNeedsReview() },
];

type Sent = { readonly field: string; readonly variables: Readonly<Record<string, unknown>> };

const sent = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }): ReadonlyArray<Sent> =>
  fake.asked.map((asked) => ({ field: asked.field, variables: asked.variables }));

// The requests each function sends on a board that answers them all: where a fault can land.
const probed = await Promise.all(
  actions.map(async (action) => {
    const fake = Fake.linear(action.board);
    const answered = await action.call(client(fake.http));
    if (!answered.ok) {
      throw new Error(`${action.name} failed on a whole board: ${answered.error.message}`);
    }
    return { action, requests: sent(fake) };
  }),
);

type Request = {
  readonly action: Action;
  readonly requests: ReadonlyArray<Sent>;
  readonly step: number;
  readonly request: Sent;
};

const everyRequest: ReadonlyArray<readonly [string, Request]> = probed.flatMap(
  ({ action, requests }) =>
    requests.map(
      (request, step) =>
        [
          `${action.name}, request ${String(step + 1)} of ${String(requests.length)} (${request.field})`,
          { action, requests, step, request },
        ] as const,
    ),
);

type Ctor<C> = abstract new (...args: never[]) => C;

type Expected = {
  readonly error: Ctor<Linear.LinearFailure>;
  readonly message: string | RegExp;
  readonly retryable: boolean;
};

// The result failed with `expected`, saying its message, and without the token anywhere in it.
const failed = (result: Outcome, expected: Expected) => {
  const found = HttpFake.failure(result, expected.error);
  if (typeof expected.message === "string") {
    expect(found.message).toBe(expected.message);
  } else {
    expect(found.message).toMatch(expected.message);
  }
  expect(Linear.retryable(found)).toBe(expected.retryable);
  const rendered = `${found.message}\n${String(found.stack)}\n${String(found.cause)}\n${JSON.stringify(found)}`;
  expect(rendered).not.toContain(TOKEN);
  return found;
};

type Fault = Expected & { readonly replies: ReadonlyArray<() => HttpFake.Reply> };

const status = (code: number, body: string) => () => HttpFake.status(code, body);
const slowDown = status(429, "slow down");

// Every way a request can fail, as the replies it gets each time it is sent. Only a 429 is sent
// again, once; whatever answers that second send is the call's answer.
const faults: ReadonlyArray<readonly [string, Fault]> = [
  [
    "a 500",
    {
      replies: [status(500, "boom")],
      error: Http.HttpServerError,
      message: `${WHERE}: 500: boom`,
      retryable: true,
    },
  ],
  [
    "a 503",
    {
      replies: [status(503, "busy")],
      error: Http.HttpServerError,
      message: `${WHERE}: 503: busy`,
      retryable: true,
    },
  ],
  [
    "a 400",
    {
      replies: [status(400, "bad query")],
      error: Http.HttpBadRequest,
      message: `${WHERE}: 400: bad query`,
      retryable: false,
    },
  ],
  [
    "a 404",
    {
      replies: [status(404, "not here")],
      error: Http.HttpNotFound,
      message: `${WHERE}: 404: not here`,
      retryable: false,
    },
  ],
  [
    "a 401",
    {
      replies: [status(401, "unauthorized")],
      error: Http.HttpUnhandled,
      message: `${WHERE}: 401: unauthorized`,
      retryable: false,
    },
  ],
  [
    "a 403",
    {
      replies: [status(403, "forbidden")],
      error: Http.HttpUnhandled,
      message: `${WHERE}: 403: forbidden`,
      retryable: false,
    },
  ],
  [
    "no connection",
    {
      replies: [() => "unreachable"],
      error: Http.HttpUnreachable,
      message: `${WHERE}: fetch failed`,
      retryable: true,
    },
  ],
  [
    "no answer",
    {
      replies: [() => "hang"],
      error: Http.HttpTimedOut,
      message: `${WHERE}: no answer within 10000 ms`,
      retryable: true,
    },
  ],
  [
    "a body that is not JSON",
    {
      replies: [status(200, "<html>")],
      error: Http.HttpInvalid,
      message: /^POST https:\/\/linear\.example\/graphql: body is not JSON: /,
      retryable: false,
    },
  ],
  [
    "JSON without data",
    {
      replies: [() => HttpFake.json({})],
      error: Http.HttpInvalid,
      message: `${WHERE}: linear: invalid response`,
      retryable: false,
    },
  ],
  [
    "an envelope that is not GraphQL's",
    {
      replies: [() => HttpFake.json([])],
      error: Http.HttpInvalid,
      message: `${WHERE}: linear: invalid response`,
      retryable: false,
    },
  ],
  [
    "data of the wrong shape",
    {
      replies: [() => Fake.data({ nope: 1 })],
      error: Http.HttpInvalid,
      message: `${WHERE}: linear: invalid response`,
      retryable: false,
    },
  ],
  [
    "GraphQL errors",
    {
      replies: [() => Fake.errors("API key has no access", "and more")],
      error: Linear.LinearError,
      message: "linear: API key has no access; and more",
      retryable: false,
    },
  ],
  [
    "a 429 twice",
    {
      replies: [slowDown, slowDown],
      error: Http.HttpUnhandled,
      message: `${WHERE}: 429: slow down`,
      retryable: true,
    },
  ],
  [
    "a 429, then a 503",
    {
      replies: [slowDown, status(503, "busy")],
      error: Http.HttpServerError,
      message: `${WHERE}: 503: busy`,
      retryable: true,
    },
  ],
  [
    "a 429, then no connection",
    {
      replies: [slowDown, () => "unreachable"],
      error: Http.HttpUnreachable,
      message: `${WHERE}: fetch failed`,
      retryable: true,
    },
  ],
  [
    "a 429, then no answer",
    {
      replies: [slowDown, () => "hang"],
      error: Http.HttpTimedOut,
      message: `${WHERE}: no answer within 10000 ms`,
      retryable: true,
    },
  ],
  [
    "a 429, then GraphQL errors",
    {
      replies: [slowDown, () => Fake.errors("API key has no access")],
      error: Linear.LinearError,
      message: "linear: API key has no access",
      retryable: false,
    },
  ],
];

// What Linear answers in its data when the board will not do what `request` asks, and what the
// function then says. A label the board lacks is not one: it is created.
const refusalsOf = (action: Action, request: Sent): ReadonlyArray<readonly [string, Fault]> => {
  const refusal = (name: string, reply: () => HttpFake.Reply, message: string) =>
    [name, { replies: [reply], error: Linear.LinearError, message, retryable: false }] as const;
  switch (request.field) {
    case "teams":
      return [
        refusal("no such team", () => Fake.noNodes("teams"), `linear: no team named ${TEAM}`),
      ];
    case "users":
      return [
        refusal("no such user", () => Fake.noNodes("users"), "linear: no user prime@terminal.shop"),
      ];
    case "workflowStates":
      return [
        refusal(
          "no such state",
          () => Fake.noNodes("workflowStates"),
          `linear: no state named ${String(request.variables["name"])}`,
        ),
      ];
    case "issueLabelCreate":
      return [
        refusal(
          "a label not created",
          () => Fake.data({ issueLabelCreate: { success: false, issueLabel: null } }),
          "linear: label creation failed",
        ),
        refusal(
          "a label created without one",
          () => Fake.data({ issueLabelCreate: { success: true, issueLabel: null } }),
          "linear: label creation failed",
        ),
      ];
    case "issueCreate":
      return [
        refusal(
          "an issue not created",
          () => Fake.data({ issueCreate: { success: false, issue: null } }),
          "linear: issue creation failed",
        ),
        refusal(
          "an issue created without one",
          () => Fake.data({ issueCreate: { success: true, issue: null } }),
          "linear: issue creation failed",
        ),
      ];
    case "issueUpdate":
      return action.notUpdated === undefined
        ? []
        : [refusal("an update not taken", () => Fake.updated(false), action.notUpdated)];
    case "commentCreate":
      return [
        refusal(
          "a comment not taken",
          () => Fake.commented(false),
          `linear: commenting on ${TICKET} failed`,
        ),
      ];
    case "issues":
      return [
        [
          "a further page with no cursor",
          {
            replies: [() => Fake.page([], null)],
            error: Http.HttpInvalid,
            message: "linear: invalid response",
            retryable: false,
          },
        ],
      ];
    default:
      return [];
  }
};

const track = <T>(promise: Promise<T>) => {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
};

// The clock runs a second at a time until the call answers, so a wait or a timeout inside it
// passes; a call still waiting after a minute never will.
const settled = async <T>(promise: Promise<T>): Promise<T> => {
  const state = track(promise);
  for (let waited = 0; !state.settled && waited < 60_000; waited += 1_000) {
    await vi.advanceTimersByTimeAsync(1_000);
  }
  if (!state.settled) {
    throw new Error("the call never answered");
  }
  return promise;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(everyRequest)("%s", (_, { action, requests, step, request }) => {
  const before = requests.slice(0, step);

  it.each([...faults, ...refusalsOf(action, request)])(
    "%s is the answer, sent once or, after a 429, twice, and nothing after it (unhappy)",
    async (__, fault) => {
      const fake = Fake.faulted(action.board, step, fault.replies);

      failed(await settled(action.call(client(fake.http))), fault);
      expect(sent(fake)).toEqual([...before, ...fault.replies.map(() => request)]);
    },
  );

  it("a 429 once is waited out, the same request sent again, and the call goes on (unhappy)", async () => {
    const fake = Fake.faulted(action.board, step, [slowDown]);

    const answered = await settled(action.call(client(fake.http)));

    expect(answered.ok).toBe(true);
    expect(sent(fake)).toEqual([...before, request, request, ...requests.slice(step + 1)]);
  });

  it("a request that failed is kept by nothing: the next call sends it again (unhappy)", async () => {
    const fake = Fake.faulted(action.board, step, [status(503, "busy")]);
    const linear = client(fake.http);
    await settled(action.call(linear));
    const first = fake.asked.length;

    await settled(action.call(linear));

    expect(sent(fake).slice(first)).toContainEqual(request);
  });
});

describe("rate limits and timeouts, by the clock", () => {
  it("a 429 is sent again five seconds later, not sooner (unhappy)", async () => {
    const fake = Fake.faulted(Fake.happy, 0, [slowDown]);
    const answered = track(client(fake.http).readyForReview(TICKET));

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fake.asked).toHaveLength(1);
    expect(answered.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const [limited, again] = sent(fake);
    expect(again).toEqual(limited);
  });

  it("no answer is the failure at ten seconds, not sooner (unhappy)", async () => {
    const fake = Fake.faulted(Fake.happy, 0, [() => "hang"]);
    const asked = client(fake.http).listNeedsReview();
    const answered = track(asked);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(answered.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    failed(await asked, {
      error: Http.HttpTimedOut,
      message: `${WHERE}: no answer within 10000 ms`,
      retryable: true,
    });
    expect(fake.asked).toHaveLength(1);
  });
});

describe("a lookup that fails", () => {
  it("fails every caller waiting on it, from one request (unhappy)", async () => {
    const fake = Fake.faulted(Fake.happy, 0, [status(503, "busy")]);
    const linear = client(fake.http);

    const both = await settled(
      Promise.all([linear.startDrive("OLI-45"), linear.markFailed("OLI-46")]),
    );

    for (const answered of both) {
      failed(answered, {
        error: Http.HttpServerError,
        message: `${WHERE}: 503: busy`,
        retryable: true,
      });
    }
    expect(sent(fake)).toEqual([{ field: "teams", variables: { name: TEAM } }]);
  });
});

describe("a ticket without the ready label", () => {
  const NOT_LABELED = () => Fake.errors("Label not on issue");

  // The moves that take ready off, the update that does, and the move sent alone in its place.
  const dropping = probed.flatMap(({ action, requests }) => {
    const step = requests.findIndex(
      (request) => request.field === "issueUpdate" && "removedLabelIds" in Fake.input(request),
    );
    const update = requests[step];
    if (update === undefined) {
      return [];
    }
    const { removedLabelIds: _, ...moved } = Fake.input(update);
    const alone: Sent = { ...update, variables: { ...update.variables, input: moved } };
    return [[action.name, { action, requests, step, update, alone }] as const];
  });

  it("is ready removed by exactly startDrive, markErrored and markAborted", () => {
    expect(dropping.map(([name]) => name)).toEqual(["startDrive", "markErrored", "markAborted"]);
  });

  describe.each(dropping)("%s", (_, { action, requests, step, update, alone }) => {
    const before = requests.slice(0, step);

    it("sends the move alone, once, and goes on (unhappy)", async () => {
      const fake = Fake.faulted(action.board, step, [NOT_LABELED]);

      const answered = await settled(action.call(client(fake.http)));

      expect(answered.ok).toBe(true);
      expect(sent(fake)).toEqual([...before, update, alone, ...requests.slice(step + 1)]);
    });

    it.each([...faults, ...refusalsOf(action, update)])(
      "the move sent alone failing with %s is the answer, and nothing after it (unhappy)",
      async (__, fault) => {
        const fake = Fake.faulted(action.board, step, [NOT_LABELED, ...fault.replies]);

        failed(await settled(action.call(client(fake.http))), fault);
        expect(sent(fake)).toEqual([...before, update, ...fault.replies.map(() => alone)]);
      },
    );

    it("a missing label beside another refusal is the answer, and nothing is sent again (unhappy)", async () => {
      const fake = Fake.faulted(action.board, step, [
        () => Fake.errors("Label not on issue", "Entity not found: Issue"),
      ]);

      failed(await settled(action.call(client(fake.http))), {
        error: Linear.LinearError,
        message: "linear: Label not on issue; Entity not found: Issue",
        retryable: false,
      });
      expect(sent(fake)).toEqual([...before, update]);
    });
  });

  // Every other update: nothing of ready is removed, so the refusal is Linear's answer.
  const keeping = everyRequest.filter(
    ([, { request }]) =>
      request.field === "issueUpdate" && !("removedLabelIds" in Fake.input(request)),
  );

  it.each(keeping)(
    "%s: Label not on issue is the answer, and nothing is sent again (unhappy)",
    async (_, { action, requests, step, request }) => {
      const fake = Fake.faulted(action.board, step, [NOT_LABELED]);

      failed(await settled(action.call(client(fake.http))), {
        error: Linear.LinearError,
        message: "linear: Label not on issue",
        retryable: false,
      });
      expect(sent(fake)).toEqual([...requests.slice(0, step), request]);
    },
  );
});

describe("the token", () => {
  it("a 401 answers a key sent bare, with no Bearer (unhappy)", async () => {
    const fake = Fake.faulted(Fake.happy, 0, [status(401, "unauthorized")]);

    failed(await settled(client(fake.http).listBacklog()), {
      error: Http.HttpUnhandled,
      message: `${WHERE}: 401: unauthorized`,
      retryable: false,
    });
    expect(fake.asked.map((asked) => asked.headers["authorization"])).toEqual([TOKEN]);
  });
});
