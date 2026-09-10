import { createHmac } from "node:crypto";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation-server/handlers.ts";
import * as Log from "../../src/observability/log.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const WEBHOOK_SECRET = "whsec_test";

const SecretLive = Layer.succeed(Handlers.LinearWebhookSecret)(
  Handlers.LinearWebhookSecret.of(Redacted.make(WEBHOOK_SECRET)),
);

type Fixture = {
  readonly stores: ReturnType<typeof Stores.fakeStores>;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
};

const fixture = (): Fixture => ({
  stores: Stores.fakeStores(),
  log: FakeLog.fakeLog(),
  reporter: Reporter.collect(),
});

const serve = (fixed: Fixture) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(Layer.mergeAll(fixed.stores.layer, fixed.log.layer, SecretLive)),
    Layer.provide(Layer.succeed(Log.ProcessAttribution)(Log.AutomationProcessAttribution)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
  );

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

  it.effect("queues drive when Automation Needed arrives for a known ticket", () =>
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

  it.effect("queues diagnose when Needs Review arrives for a known ticket", () =>
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
