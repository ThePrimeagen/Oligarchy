import * as Http from "@oligarchy/http";
import * as HttpFake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Linear from "../src/main.ts";
import * as Fake from "./fake.ts";

const TOKEN = "linear-token-s3ntinel";
const API = "https://linear.example/graphql";
const WHERE = `POST ${API}`;
const TICKET = "OLI-42";

const client = (fake: { readonly http: Http.Http }) =>
  Linear.create({
    token: { reveal: () => TOKEN },
    team: "Fixture Team",
    apiUrl: API,
    http: fake.http,
  });

type Outcome = jarl.Result<unknown, Linear.LinearFailure>;

const sends = (fake: { readonly asked: ReadonlyArray<Fake.Asked> }, field: string) =>
  fake.asked.filter((asked) => asked.field === field).length;

const busy = () => HttpFake.status(503, "busy");
const slowDown = () => HttpFake.status(429, "slow down");

// Every function, and the request that does its work: the one a failure is put on.
const actions: ReadonlyArray<
  readonly [string, string, (linear: Linear.Linear) => Promise<Outcome>]
> = [
  [
    "createTicket",
    "issueCreate",
    (l) => l.createTicket({ title: "Omarchy: boot", label: "1.2.3" }),
  ],
  ["setDescription", "issueUpdate", (l) => l.setDescription(TICKET, "the body")],
  ["readyForAutomation", "issueUpdate", (l) => l.readyForAutomation(TICKET)],
  ["startDrive", "issueUpdate", (l) => l.startDrive(TICKET)],
  ["readyForReview", "issueUpdate", (l) => l.readyForReview(TICKET)],
  ["startDiagnosis", "issueUpdate", (l) => l.startDiagnosis(TICKET)],
  ["markSucceeded", "issueUpdate", (l) => l.markSucceeded(TICKET)],
  ["markFailed", "issueUpdate", (l) => l.markFailed(TICKET)],
  ["markErrored", "commentCreate", (l) => l.markErrored(TICKET, "drive errored; why")],
  ["markAborted", "issueUpdate", (l) => l.markAborted(TICKET)],
  ["listBacklog", "issues", (l) => l.listBacklog()],
  ["listAutomationNeeded", "issues", (l) => l.listAutomationNeeded()],
  ["listNeedsReview", "issues", (l) => l.listNeedsReview()],
];

describe.each(actions)("%s", (_, field, call) => {
  it("a retryable failure comes back as it is, from one send (unhappy)", async () => {
    const fake = Fake.failing(field, [busy]);

    const error = HttpFake.failure(await call(client(fake)), Http.HttpServerError);

    expect(error.message).toBe(`${WHERE}: 503: busy`);
    expect(Linear.retryable(error)).toBe(true);
    expect(sends(fake, field)).toBe(1);
  });

  it("a final failure comes back as Linear's refusal, from one send (unhappy)", async () => {
    const fake = Fake.failing(field, [() => Fake.errors("API key has no access")]);

    const error = HttpFake.failure(await call(client(fake)), Linear.LinearError);

    expect(error.message).toBe("linear: API key has no access");
    expect(Linear.retryable(error)).toBe(false);
    expect(sends(fake, field)).toBe(1);
  });
});

describe("a 429", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is sent again five seconds later, not sooner, and the call goes on (unhappy)", async () => {
    const fake = Fake.failing("issueUpdate", [slowDown]);
    const asked = client(fake).readyForReview(TICKET);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(sends(fake, "issueUpdate")).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await asked).toEqual(jarl.ok(undefined));
    expect(sends(fake, "issueUpdate")).toBe(2);
  });

  it("twice is the failure, from two sends (unhappy)", async () => {
    const fake = Fake.failing("issueUpdate", [slowDown, slowDown]);
    const asked = client(fake).readyForReview(TICKET);
    await vi.advanceTimersByTimeAsync(5_000);

    const error = HttpFake.failure(await asked, Http.HttpUnhandled);

    expect(error.message).toBe(`${WHERE}: 429: slow down`);
    expect(Linear.retryable(error)).toBe(true);
    expect(sends(fake, "issueUpdate")).toBe(2);
  });
});

describe("a ticket without the ready label", () => {
  it("has the move off Automation Needed sent again alone (unhappy)", async () => {
    const fake = Fake.failing("issueUpdate", [() => Fake.errors("Label not on issue")]);

    expect(await client(fake).startDrive(TICKET)).toEqual(jarl.ok(undefined));

    const updates = fake.asked.filter((asked) => asked.field === "issueUpdate").map(Fake.input);
    expect(updates).toEqual([
      { stateId: "state-In Progress", removedLabelIds: ["label-ready"] },
      { stateId: "state-In Progress" },
    ]);
  });

  it("beside another refusal is the failure, and nothing is sent again (unhappy)", async () => {
    const fake = Fake.failing("issueUpdate", [
      () => Fake.errors("Label not on issue", "Entity not found: Issue"),
    ]);

    const error = HttpFake.failure(await client(fake).markAborted(TICKET), Linear.LinearError);

    expect(error.message).toBe("linear: Label not on issue; Entity not found: Issue");
    expect(sends(fake, "issueUpdate")).toBe(1);
  });
});

it("a lookup that failed is not kept: the next call asks again (unhappy)", async () => {
  const fake = Fake.failing("teams", [busy]);
  const linear = client(fake);

  HttpFake.failure(await linear.startDrive(TICKET), Http.HttpServerError);

  expect(await linear.startDrive(TICKET)).toEqual(jarl.ok(undefined));
  expect(sends(fake, "teams")).toBe(2);
});
