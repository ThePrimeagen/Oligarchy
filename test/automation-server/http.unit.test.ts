import { createHmac } from "node:crypto";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Redacted, Stdio } from "effect";
import { TestClock } from "effect/testing";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Log from "@oligarchy/log/log";
import * as AutomationClient from "../../src/automation-server/client.ts";
import * as Handlers from "../../src/automation-server/handlers.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const WEBHOOK_SECRET = "whsec_test";
const TOKEN = "test-token";
const CLIENT_URL = "http://127.0.0.1:55333";
const OTHER_URL = "http://127.0.0.1:55334";
const TICKET = "OLI-42";
const OTHER_TICKET = "OLI-99";
const RESULT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_RESULT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const SecretLive = Layer.succeed(Handlers.LinearWebhookSecret)(
  Handlers.LinearWebhookSecret.of(Redacted.make(WEBHOOK_SECRET)),
);

type Fixture = {
  readonly stores: ReturnType<typeof Stores.fakeStores>;
  readonly log: FakeLog.FakeLog;
  readonly linear: FakeLinear.FakeLinear;
  readonly reporter: Reporter.Collector;
};

const fixture = (): Fixture => ({
  stores: Stores.fakeStores(),
  log: FakeLog.fakeLog(),
  linear: FakeLinear.fakeLinear(),
  reporter: Reporter.collect(),
});

const TokenLive = Layer.succeed(AutomationClient.OligarchyToken)(
  AutomationClient.OligarchyToken.of(Redacted.make(TOKEN)),
);

const serve = (fixed: Fixture, outbound: Layer.Layer<HttpClient.HttpClient> = FakeHttp.die) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(
      Layer.mergeAll(
        fixed.stores.layer,
        fixed.log.layer,
        fixed.linear.layer,
        SecretLive,
        TokenLive,
        outbound,
        Stdio.layerTest({}),
      ),
    ),
    Layer.provide(Layer.succeed(Log.ProcessAttribution)(Log.AutomationProcessAttribution)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
  );

const abortHeaders = {
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};

// The job named as the dashboard names it: the ticket and the action, a ticket having one of each.
const abort = (
  http: HttpClient.HttpClient,
  ticket = TICKET,
  headers: Record<string, string> = abortHeaders,
  action: "drive" | "diagnose" = "drive",
) =>
  http.post("/abort", {
    headers,
    body: HttpBody.text(JSON.stringify({ ticket, action }), "application/json"),
  });

const sign = (payload: string | Uint8Array): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

const webhook = (http: HttpClient.HttpClient, payload: string | Uint8Array, signature?: string) =>
  http.post("/linear", {
    headers:
      signature === undefined
        ? { "content-type": "application/json" }
        : { "content-type": "application/json", "linear-signature": signature },
    body:
      typeof payload === "string"
        ? HttpBody.text(payload, "application/json")
        : HttpBody.uint8Array(payload, "application/json"),
  });

const seedResult = (
  fixed: Fixture,
  linearId: string,
  resultId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
) => {
  fixed.stores.tests.results.push({
    id: resultId,
    runId: "11111111-1111-4111-8111-111111111111",
    definitionId: 1,
    sessionId: null,
    model: null,
    linearId,
    status: "pending",
    reason: null,
    createdAt: new Date(),
    finishedAt: null,
  });
  return resultId;
};

const seedServer = (fixed: Fixture, url: string) => {
  const id = crypto.randomUUID();
  fixed.stores.servers.servers.push({ id, url, name: null, type: "automation-client" });
  return id;
};

const seedJob = (
  fixed: Fixture,
  resultId: string,
  status: "pending" | "running" | "succeeded" | "failed" | "aborted" = "pending",
  serverId: string | null = null,
) => {
  fixed.stores.automation.jobs.push({
    id: `00000000-0000-4000-8000-${String(fixed.stores.automation.jobs.length + 1).padStart(12, "0")}`,
    resultId,
    action: "drive",
    status,
    reason: null,
    serverId,
    createdAt: new Date(),
    startedAt: status === "pending" ? null : new Date(),
    finishedAt: status === "pending" || status === "running" ? null : new Date(),
  });
};

const labeled = (fixed: Fixture) =>
  fixed.linear.calls.filter((call) => call.method === "markReady");

const issueBody = (state: string, extras: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: "update",
    type: "Issue",
    data: {
      identifier: "OLI-1063",
      state: {
        id: "a9fe2d89-3cb3-47dd-8645-5d224f997134",
        name: state,
        type: state === "Needs Review" ? "started" : "unstarted",
      },
    },
    updatedFrom: { stateId: "a4134e28-ad3b-4e3f-b7d2-4fb9132b95e0" },
    ...extras,
  });

describe("POST /linear", () => {
  const payload = '{"action":"update","type":"Issue","data":{"identifier":"OLI-1"}}';

  it.effect("answers ok and logs a signed body that is not a queueable Issue state", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* webhook(http, payload, sign(payload));
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: "linear webhook recorded",
          location: "automation",
          agentId: "automation",
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect(
    "queues drive when Automation Needed arrives for a known ticket, and labels it ready",
    () =>
      Effect.gen(function* () {
        const body = issueBody("Automation Needed");
        const fixed = fixture();
        const resultId = seedResult(fixed, "OLI-1063");
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          expect((yield* webhook(http, body, sign(body))).status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId, action: "drive", status: "pending" }),
        ]);
        expect(labeled(fixed)).toEqual([{ method: "markReady", identifier: "OLI-1063" }]);
        expect(fixed.log.lines).toEqual([
          {
            level: "info",
            text: "linear webhook queued drive; Automation Needed",
            location: "automation",
            agentId: "OLI-1063",
            skipSentry: false,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect(
    "a ready label that fails is one error line, and the queued drive still answers 200",
    () =>
      Effect.gen(function* () {
        const body = issueBody("Automation Needed");
        const refused = Errors.LinearError.make({
          operation: "markReady",
          message: "linear: labeling OLI-1063 ready failed",
        });
        let attempts = 0;
        const fixed = {
          ...fixture(),
          linear: FakeLinear.fakeLinear({
            overrides: {
              markReady: () =>
                Effect.suspend(() => {
                  attempts += 1;
                  return Effect.fail(refused);
                }),
            },
          }),
        };
        const resultId = seedResult(fixed, "OLI-1063");
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* webhook(http, body, sign(body));
          expect(response.status).toBe(200);
          expect(yield* response.json).toEqual({ ok: "true" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId, action: "drive", status: "pending" }),
        ]);
        // Linear is waiting on this answer, and the board watch labels a pending job it finds
        // unlabeled, so there is no second attempt.
        expect(attempts).toBe(1);
        expect(fixed.log.lines).toEqual([
          {
            level: "info",
            text: "linear webhook queued drive; Automation Needed",
            location: "automation",
            agentId: "OLI-1063",
            skipSentry: false,
            cause: undefined,
          },
          {
            level: "error",
            text: "ready label add failed: linear: labeling OLI-1063 ready failed",
            location: "automation",
            agentId: "OLI-1063",
            skipSentry: false,
            cause: refused,
          },
        ]);
      }),
  );

  it.effect(
    "a ready label Linear never answers gives up at three seconds, inside the five Linear waits",
    () =>
      Effect.gen(function* () {
        const body = issueBody("Automation Needed");
        const asked = yield* Deferred.make<void>();
        const fixed = {
          ...fixture(),
          linear: FakeLinear.fakeLinear({
            overrides: {
              markReady: () =>
                Deferred.succeed(asked, undefined).pipe(Effect.andThen(Effect.never)),
            },
          }),
        };
        const resultId = seedResult(fixed, "OLI-1063");
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const answered = yield* webhook(http, body, sign(body)).pipe(Effect.forkChild);
          yield* Deferred.await(asked);
          yield* TestClock.adjust("3 seconds");
          const response = yield* Fiber.join(answered);
          expect(response.status).toBe(200);
          expect(yield* response.json).toEqual({ ok: "true" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId, action: "drive", status: "pending" }),
        ]);
        expect(fixed.log.lines).toEqual([
          expect.objectContaining({
            level: "info",
            text: "linear webhook queued drive; Automation Needed",
          }),
          {
            level: "error",
            text: "ready label add failed: linear: labeling OLI-1063 ready failed: no answer within 3 seconds",
            location: "automation",
            agentId: "OLI-1063",
            skipSentry: false,
            cause: expect.objectContaining({ _tag: "LinearError", operation: "markReady" }),
          },
        ]);
      }),
  );

  it.effect("queues mint, not drive, when Automation Needed is for the mint definition", () =>
    Effect.gen(function* () {
      const body = issueBody("Automation Needed");
      const fixed = fixture();
      fixed.stores.tests.definitions.push({
        id: 1,
        name: "mint",
        description: "install",
        instruction: "boot",
        proof: "desktop",
        createdAt: new Date(0),
      });
      const resultId = seedResult(fixed, "OLI-1063");
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* webhook(http, body, sign(body))).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId, action: "mint", status: "pending" }),
      ]);
      expect(FakeLog.texts(fixed.log)).toEqual(["linear webhook queued mint; Automation Needed"]);
      expect(labeled(fixed)).toEqual([{ method: "markReady", identifier: "OLI-1063" }]);
    }),
  );

  it.effect(
    "queues diagnose when Needs Review arrives for a known ticket, and labels nothing",
    () =>
      Effect.gen(function* () {
        const body = issueBody("Needs Review");
        const fixed = fixture();
        const resultId = seedResult(fixed, "OLI-1063");
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          expect((yield* webhook(http, body, sign(body))).status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId, action: "diagnose", status: "pending" }),
        ]);
        expect(FakeLog.texts(fixed.log)).toEqual(["linear webhook queued diagnose; Needs Review"]);
        expect(labeled(fixed)).toEqual([]);
      }),
  );

  it.effect("ignores a queueable state when no result has that Linear id (unhappy)", () =>
    Effect.gen(function* () {
      const body = issueBody("Automation Needed");
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* webhook(http, body, sign(body))).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toEqual([]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        "linear webhook ignored; no result for Automation Needed",
      ]);
      expect(fixed.log.lines[0]?.agentId).toBe("OLI-1063");
      expect(labeled(fixed)).toEqual([]);
    }),
  );

  it.effect("ignores a second drive for the same result (unhappy duplicate)", () =>
    Effect.gen(function* () {
      const body = issueBody("Automation Needed");
      const fixed = fixture();
      seedResult(fixed, "OLI-1063");
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* webhook(http, body, sign(body))).status).toBe(200);
        expect((yield* webhook(http, body, sign(body))).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toHaveLength(1);
      expect(FakeLog.texts(fixed.log)).toEqual([
        "linear webhook queued drive; Automation Needed",
        "linear webhook ignored; drive already queued",
      ]);
      expect(labeled(fixed)).toEqual([{ method: "markReady", identifier: "OLI-1063" }]);
    }),
  );

  it.effect("records In Progress without enqueueing", () =>
    Effect.gen(function* () {
      const body = issueBody("In Progress");
      const fixed = fixture();
      seedResult(fixed, "OLI-1063");
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* webhook(http, body, sign(body))).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toEqual([]);
      expect(FakeLog.texts(fixed.log)).toEqual(["linear webhook recorded; In Progress"]);
      expect(labeled(fixed)).toEqual([]);
    }),
  );
});

describe("POST /linear refusals", () => {
  const payload = '{"action":"update"}';

  it.effect(
    "a missing or wrong signature is 401 unauthorized, queues nothing and logs one line each",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const missing = yield* webhook(http, payload);
          expect(missing.status).toBe(401);
          expect(yield* missing.json).toEqual({ error: "unauthorized" });
          const wrong = yield* webhook(http, payload, "00".repeat(32));
          expect(wrong.status).toBe(401);
          expect(yield* wrong.json).toEqual({ error: "unauthorized" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs).toEqual([]);
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /linear failed: unauthorized",
            location: "automation",
            agentId: "automation",
            skipSentry: true,
            cause: undefined,
          },
          {
            level: "error",
            text: "POST /linear failed: unauthorized",
            location: "automation",
            agentId: "automation",
            skipSentry: true,
            cause: undefined,
          },
        ]);
        expect(fixed.reporter.reported).toEqual([]);
        expect(fixed.linear.calls).toEqual([]);
      }),
  );

  it.effect("a valid signature of a different body is 401 and queues nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* webhook(http, payload, sign('{"action":"create"}'));
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toEqual([]);
    }),
  );

  it.effect(
    "POST /automate, GET /linear and anything unrouted are 404 not found and never logged",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const automate = yield* http.post("/automate", {
            body: HttpBody.jsonUnsafe({ ticket: "OLI-61", model: "grok-4.6" }),
          });
          expect(automate.status).toBe(404);
          expect(yield* automate.json).toEqual({ error: "not found" });
          for (const path of ["/automate", "/linear", "/start", "/servers", "/nope"]) {
            const response = yield* http.get(path);
            expect(response.status, path).toBe(404);
            expect(yield* response.json).toEqual({ error: "not found" });
          }
          const start = yield* http.post("/start", {
            body: HttpBody.jsonUnsafe({ iso: "omarchy.iso", agent: "OLI-61" }),
          });
          expect(start.status).toBe(404);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs).toEqual([]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );
});

describe("POST /abort", () => {
  it.effect("aborts a running job at the client that claimed it", () =>
    Effect.gen(function* () {
      const outbound = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      const fixed = fixture();
      seedResult(fixed, TICKET, RESULT);
      seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed, outbound.layer)));
      expect(outbound.requests).toEqual([
        expect.objectContaining({
          method: "POST",
          url: `${CLIENT_URL}/abort`,
        }),
      ]);
      expect(JSON.parse(outbound.requests[0]?.body ?? "")).toEqual({ ticket: TICKET });
      expect(fixed.stores.automation.jobs[0]).toMatchObject({
        status: "aborted",
        reason: "aborted",
        finishedAt: expect.any(Date),
      });
      expect(FakeLog.texts(fixed.log)).toEqual([`aborted drive; ${CLIENT_URL}`]);
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
        { method: "clearReady", identifier: TICKET },
      ]);
      expect(fixed.log.lines[0]?.agentId).toBe(TICKET);
    }),
  );

  it.effect("routes abort to the client that claimed that ticket", () =>
    Effect.gen(function* () {
      const outbound = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      const fixed = fixture();
      seedResult(fixed, TICKET, RESULT);
      seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
      seedResult(fixed, OTHER_TICKET, OTHER_RESULT);
      seedJob(fixed, OTHER_RESULT, "running", seedServer(fixed, OTHER_URL));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http, TICKET);
        expect(response.status).toBe(200);
      }).pipe(Effect.provide(serve(fixed, outbound.layer)));
      expect(outbound.requests.map((request) => request.url)).toEqual([`${CLIENT_URL}/abort`]);
      expect(fixed.stores.automation.jobs[0]?.status).toBe("aborted");
      expect(fixed.stores.automation.jobs[1]?.status).toBe("running");
    }),
  );

  it.effect(
    "a running job its client holds nothing for is reported JobNotFound, closed aborted, and answered 200",
    () =>
      Effect.gen(function* () {
        const outbound = FakeHttp.recordRequests(() =>
          FakeHttp.json({ error: `unknown session "${TICKET}"` }, 404),
        );
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        const id = fixed.stores.automation.jobs[0]?.id;
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* abort(http);
          expect(response.status).toBe(200);
          expect(yield* response.json).toEqual({ ok: "true" });
        }).pipe(Effect.provide(serve(fixed, outbound.layer)));
        expect(outbound.requests.map((request) => request.url)).toEqual([`${CLIENT_URL}/abort`]);
        expect(fixed.stores.automation.jobs[0]).toMatchObject({
          status: "aborted",
          reason: "aborted",
          finishedAt: expect.any(Date),
        });
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: `JobNotFound: Job had "running" status but 404'd.`,
            location: "automation",
            agentId: TICKET,
            skipSentry: false,
            cause: expect.objectContaining({
              _tag: "JobNotFound",
              message: `Job had "running" status but 404'd.`,
              jobId: id,
              url: CLIENT_URL,
            }),
          },
          expect.objectContaining({ level: "info", text: `aborted drive; ${CLIENT_URL}` }),
        ]);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
          { method: "clearReady", identifier: TICKET },
        ]);
      }),
  );

  it.effect("closes a pending job as aborted; no client has it, so none is called", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      seedResult(fixed, TICKET, RESULT);
      seedJob(fixed, RESULT, "pending", null);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs[0]).toMatchObject({
        status: "aborted",
        reason: "aborted",
        finishedAt: expect.any(Date),
      });
      expect(FakeLog.texts(fixed.log)).toEqual(["aborted pending drive"]);
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
        { method: "clearReady", identifier: TICKET },
      ]);
      expect(fixed.log.lines[0]?.agentId).toBe(TICKET);
    }),
  );

  it.effect(
    "closes the pending diagnose named while the ticket's drive runs on, and calls no client",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        fixed.stores.automation.jobs.push({
          ...fixed.stores.automation.jobs[0],
          id: "00000000-0000-4000-8000-000000000002",
          action: "diagnose",
          status: "pending",
          serverId: null,
          startedAt: null,
        });
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* abort(http, TICKET, abortHeaders, "diagnose");
          expect(response.status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs[0]?.status).toBe("running");
        expect(fixed.stores.automation.jobs[1]).toMatchObject({
          action: "diagnose",
          status: "aborted",
          reason: "aborted",
        });
        expect(FakeLog.texts(fixed.log)).toEqual(["aborted pending diagnose"]);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
      }),
  );
});

// An automation client whose answer to /abort comes after the drive finished on its own: the
// worker closed the row succeeded while the stop was in flight.
const finishedDuringAbort = (fixed: Fixture, answer: () => Response) =>
  FakeHttp.recordRequests(() =>
    Effect.sync(() => {
      const job = fixed.stores.automation.jobs[0];
      if (job !== undefined) {
        job.status = "succeeded";
        job.finishedAt = new Date();
      }
      return answer();
    }),
  );

describe("POST /abort refusals", () => {
  it.effect(
    "400 when the drive finished on its own while its client was stopping it, and the row stays succeeded",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        const outbound = finishedDuringAbort(fixed, () => FakeHttp.json({ ok: "true" }));
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* abort(http);
          expect(response.status).toBe(400);
          expect(yield* response.json).toEqual({
            error: `ticket "${TICKET}" has no drive to abort`,
          });
        }).pipe(Effect.provide(serve(fixed, outbound.layer)));
        expect(outbound.requests.map((request) => request.url)).toEqual([`${CLIENT_URL}/abort`]);
        expect(fixed.stores.automation.jobs[0]).toMatchObject({
          status: "succeeded",
          reason: null,
        });
        expect(FakeLog.texts(fixed.log)).toEqual([
          `POST /abort failed: ticket "${TICKET}" has no drive to abort`,
        ]);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
      }),
  );

  it.effect(
    "400 and no JobNotFound when the client 404s because the drive finished on its own",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        const outbound = finishedDuringAbort(fixed, () =>
          FakeHttp.json({ error: `unknown session "${TICKET}"` }, 404),
        );
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* abort(http);
          expect(response.status).toBe(400);
          expect(yield* response.json).toEqual({
            error: `ticket "${TICKET}" has no drive to abort`,
          });
        }).pipe(Effect.provide(serve(fixed, outbound.layer)));
        expect(fixed.stores.automation.jobs[0]).toMatchObject({
          status: "succeeded",
          reason: null,
        });
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: `POST /abort failed: ticket "${TICKET}" has no drive to abort`,
            location: "automation",
            agentId: TICKET,
            skipSentry: true,
            cause: undefined,
          },
        ]);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
      }),
  );

  it.effect("400 when the ticket already finished, and the client is not called", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      seedResult(fixed, TICKET, RESULT);
      seedJob(fixed, RESULT, "succeeded", seedServer(fixed, CLIENT_URL));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(400);
        expect(yield* response.json).toEqual({
          error: `ticket "${TICKET}" has no drive to abort`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs[0]?.status).toBe("succeeded");
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `POST /abort failed: ticket "${TICKET}" has no drive to abort`,
          location: "automation",
          agentId: TICKET,
          skipSentry: true,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect(
    "400 when the ticket's running job is the other action, and the client is not called",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* abort(http, TICKET, abortHeaders, "diagnose");
          expect(response.status).toBe(400);
          expect(yield* response.json).toEqual({
            error: `ticket "${TICKET}" is running a drive, not a diagnose`,
          });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs[0]?.status).toBe("running");
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: `POST /abort failed: ticket "${TICKET}" is running a drive, not a diagnose`,
            location: "automation",
            agentId: TICKET,
            skipSentry: true,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect("400 when the ticket is unknown, and the client is not called", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(400);
        expect(yield* response.json).toEqual({
          error: `ticket "${TICKET}" has no drive to abort`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs).toEqual([]);
    }),
  );

  it.effect("refuses a missing bearer with 401 and one error line", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http, TICKET, { "content-type": "application/json" });
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /abort failed: unauthorized",
          location: "automation",
          agentId: "automation",
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a wrong bearer is 401 too", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http, TICKET, {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        });
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a body without ticket is 400", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/abort", {
          headers: abortHeaders,
          body: HttpBody.text(JSON.stringify({ action: "drive" }), "application/json"),
        });
        expect(response.status).toBe(400);
        const body = yield* response.json;
        expect(body).toEqual(expect.objectContaining({ error: expect.stringContaining("ticket") }));
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect(
    "a body without an action, or with one no job has, is 400 and the client is not called",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          for (const body of [{ ticket: TICKET }, { ticket: TICKET, action: "reboot" }]) {
            const response = yield* http.post("/abort", {
              headers: abortHeaders,
              body: HttpBody.text(JSON.stringify(body), "application/json"),
            });
            expect(response.status).toBe(400);
            expect(yield* response.json).toEqual(
              expect.objectContaining({ error: expect.stringContaining("action") }),
            );
          }
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.stores.automation.jobs[0]?.status).toBe("running");
      }),
  );

  it.effect("500 when the server that claimed the job is gone", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      seedResult(fixed, TICKET, RESULT);
      seedJob(fixed, RESULT, "running", crypto.randomUUID());
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(500);
        const body = yield* response.json;
        expect(body).toEqual(
          expect.objectContaining({ error: expect.stringContaining("unknown server") }),
        );
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.stores.automation.jobs[0]?.status).toBe("running");
    }),
  );

  it.effect(
    "a client that never answers /abort is given up after ten seconds, and the job stays running",
    () =>
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>();
        const outbound = FakeHttp.recordRequests(() =>
          Deferred.succeed(asked, undefined).pipe(Effect.andThen(Effect.never)),
        );
        const fixed = fixture();
        seedResult(fixed, TICKET, RESULT);
        seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const pending = yield* abort(http).pipe(Effect.forkChild);
          yield* Deferred.await(asked);
          yield* TestClock.adjust("9 seconds");
          expect(pending.pollUnsafe()).toBeUndefined();
          yield* TestClock.adjust("1 second");
          const response = yield* Fiber.join(pending);
          expect(response.status).toBe(500);
          expect(yield* response.json).toEqual({
            error: `automation client: POST ${CLIENT_URL}/abort failed: no answer within 10 seconds`,
          });
        }).pipe(Effect.provide(serve(fixed, outbound.layer)));
        expect(fixed.stores.automation.jobs[0]).toMatchObject({
          status: "running",
          finishedAt: null,
        });
      }),
  );

  it.effect("500 when the client fails, and the job stays running", () =>
    Effect.gen(function* () {
      const outbound = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "opencode exited 1" }, 500),
      );
      const fixed = fixture();
      seedResult(fixed, TICKET, RESULT);
      seedJob(fixed, RESULT, "running", seedServer(fixed, CLIENT_URL));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(500);
        expect(yield* response.json).toEqual({
          error: `automation client: POST ${CLIENT_URL}/abort failed: opencode exited 1`,
        });
      }).pipe(Effect.provide(serve(fixed, outbound.layer)));
      expect(fixed.stores.automation.jobs[0]).toMatchObject({
        status: "running",
        finishedAt: null,
      });
      // A client that failed the stop still holds the job; that is no JobNotFound.
      expect(FakeLog.texts(fixed.log).filter((text) => text.startsWith("JobNotFound"))).toEqual([]);
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
    }),
  );
});
