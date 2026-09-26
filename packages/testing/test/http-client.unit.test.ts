import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HttpBody, HttpClient, HttpServerResponse } from "effect/unstable/http";
import * as TestingHttp from "../src/http-client.ts";

describe("TestingHttp happy path", () => {
  it.effect(
    "recordRequests keeps each request's method, url, headers and body, then answers it",
    () =>
      Effect.gen(function* () {
        const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }, 201));
        const response = yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          return yield* http.post("http://127.0.0.1:1/reserve", {
            headers: { authorization: "Bearer token" },
            body: HttpBody.text('{"agent":"OLI-1"}', "application/json"),
          });
        }).pipe(Effect.provide(recorder.layer));
        expect(response.status).toBe(201);
        expect(yield* response.json).toEqual({ ok: "true" });
        expect(recorder.requests).toEqual([
          {
            method: "POST",
            url: "http://127.0.0.1:1/reserve",
            headers: expect.objectContaining({ authorization: "Bearer token" }),
            body: '{"agent":"OLI-1"}',
          },
        ]);
      }),
  );

  it.effect("serving answers a request with the app's own response, no socket", () =>
    Effect.gen(function* () {
      const response = yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        return yield* http.get("http://127.0.0.1:1/stats");
      }).pipe(
        Effect.provide(
          TestingHttp.serving(Effect.succeed(HttpServerResponse.text("up", { status: 202 }))),
        ),
      );
      expect(response.status).toBe(202);
      expect(yield* response.text).toBe("up");
    }),
  );
});

describe("TestingHttp unhappy path", () => {
  it.effect("die is a defect naming the request it was not meant to get", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        return yield* http.get("http://127.0.0.1:1/nope");
      }).pipe(Effect.provide(TestingHttp.die), Effect.exit);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
        "unexpected GET http://127.0.0.1:1/nope",
      );
    }),
  );

  it.effect("never leaves a request unanswered however long the clock runs", () =>
    Effect.gen(function* () {
      const request = yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        return yield* http.get("http://127.0.0.1:1/stats");
      }).pipe(Effect.provide(TestingHttp.never), Effect.forkChild);
      yield* TestClock.adjust("1 hour");
      expect(request.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(request);
    }),
  );
});
