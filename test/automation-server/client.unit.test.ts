import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import * as AutomationClient from "../../src/automation-server/client.ts";
import * as FakeHttp from "../support/fake-http.ts";

const URL = "http://127.0.0.1:55333";
const TOKEN = "test-token";
const PROMPT = "drive OLI-42";
const TICKET = "OLI-42";
const MODEL = "opencode/muse-spark-1.3-contributor-free";

const token = Layer.succeed(AutomationClient.OligarchyToken)(
  AutomationClient.OligarchyToken.of(Redacted.make(TOKEN)),
);

const reserve = (http: Layer.Layer<HttpClient.HttpClient>) =>
  AutomationClient.reserve(URL, TICKET).pipe(Effect.provide(Layer.mergeAll(token, http)));

const run = (http: Layer.Layer<HttpClient.HttpClient>) =>
  AutomationClient.run(URL, PROMPT, TICKET, MODEL).pipe(
    Effect.provide(Layer.mergeAll(token, http)),
  );

const abort = (http: Layer.Layer<HttpClient.HttpClient>) =>
  AutomationClient.abort(URL, TICKET).pipe(Effect.provide(Layer.mergeAll(token, http)));

describe("automation client POST /reserve happy path", () => {
  it.effect("posts the ticket with the bearer token and succeeds on 200", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* reserve(recorder.layer);
      expect(recorder.requests).toHaveLength(1);
      expect(recorder.requests[0]?.method).toBe("POST");
      expect(recorder.requests[0]?.url).toBe(`${URL}/reserve`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({ ticket: TICKET });
    }),
  );
});

describe("automation client POST /reserve unhappy path", () => {
  it.effect("a 503 is AutomationClientError with the body's error and status 503", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "at capacity: max-jobs is 1" }, 503),
      );
      const error = yield* Effect.flip(reserve(recorder.layer));
      expect(error).toMatchObject({
        _tag: "AutomationClientError",
        status: 503,
        message: `automation client: POST ${URL}/reserve failed: at capacity: max-jobs is 1`,
      });
    }),
  );
});

describe("automation client POST /run happy path", () => {
  it.effect(
    "posts the prompt, the ticket and the model with the bearer token and succeeds on 200",
    () =>
      Effect.gen(function* () {
        const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* run(recorder.layer);
        expect(recorder.requests).toHaveLength(1);
        expect(recorder.requests[0]?.method).toBe("POST");
        expect(recorder.requests[0]?.url).toBe(`${URL}/run`);
        expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({
          prompt: PROMPT,
          ticket: TICKET,
          model: MODEL,
        });
      }),
  );
});

describe("automation client POST /run unhappy path", () => {
  it.effect("a 500 is AutomationClientError with the body's error and status 500", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "opencode exited 1" }, 500),
      );
      const error = yield* Effect.flip(run(recorder.layer));
      expect(error).toMatchObject({
        _tag: "AutomationClientError",
        status: 500,
        message: `automation client: POST ${URL}/run failed: opencode exited 1`,
      });
      expect(error.cause).toBeDefined();
    }),
  );

  it.effect("an unreachable client has no status and carries the cause", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:55333"),
            }),
          }),
        ),
      );
      const error = yield* Effect.flip(run(layer));
      expect(error._tag).toBe("AutomationClientError");
      expect(error.status).toBeUndefined();
      expect(error.message).toBe(`automation client: POST ${URL}/run failed`);
      expect(error.cause).toBeDefined();
    }),
  );
});

describe("automation client POST /run has no timeout", () => {
  it.effect("is still waiting after two hours", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(run(FakeHttp.never));
      yield* TestClock.adjust("2 hours");
      expect(fiber.pollUnsafe()).toBeUndefined();
    }),
  );
});

describe("automation client POST /abort happy path", () => {
  it.effect("posts the ticket with the bearer token and succeeds on 200", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* abort(recorder.layer);
      expect(recorder.requests).toHaveLength(1);
      expect(recorder.requests[0]?.method).toBe("POST");
      expect(recorder.requests[0]?.url).toBe(`${URL}/abort`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({ ticket: TICKET });
    }),
  );
});

describe("automation client POST /abort unhappy path", () => {
  it.effect("a 404 is AutomationClientError with the body's error and status 404", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: `unknown session "${TICKET}"` }, 404),
      );
      const error = yield* Effect.flip(abort(recorder.layer));
      expect(error).toMatchObject({
        _tag: "AutomationClientError",
        status: 404,
        message: `automation client: POST ${URL}/abort failed: unknown session "${TICKET}"`,
      });
    }),
  );

  it.effect("an unreachable client has no status and carries the cause", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:55333"),
            }),
          }),
        ),
      );
      const error = yield* Effect.flip(abort(layer));
      expect(error._tag).toBe("AutomationClientError");
      expect(error.status).toBeUndefined();
      expect(error.message).toBe(`automation client: POST ${URL}/abort failed`);
    }),
  );
});
