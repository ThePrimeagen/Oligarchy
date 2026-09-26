import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HttpClientError } from "effect/unstable/http";
import * as ProxyClient from "@oligarchy/http/proxy-client";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Render from "@oligarchy/log/render";
import * as TestingHttp from "@oligarchy/testing/http-client";
import * as Qemu from "../../src/automation-client/qemu.ts";

const SERVER = "http://127.0.0.1:55555";
const TOKEN = "test-token";
const AGENT = "OLI-42";

const connect = ProxyClient.connect({ serverUrl: SERVER, token: Redacted.make(TOKEN) });

const unreachable = TestingHttp.respondWith((request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({
        request,
        cause: new Error("connect ECONNREFUSED 127.0.0.1:55555"),
      }),
    }),
  ),
);

describe("Qemu.reserve happy path", () => {
  it.effect("posts the agent to /reserve and succeeds on 200", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* Qemu.reserve(proxy)(AGENT);
      expect(recorder.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `POST ${SERVER}/reserve`,
      ]);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({ agent: AGENT });
    }),
  );

  it.effect("posts the pinned server when the mint names one", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const pin = "http://127.0.0.1:55332";
      yield* Qemu.reserve(proxy)(AGENT, undefined, pin);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({ agent: AGENT, server: pin });
    }),
  );

  it.effect("a resume posts the iso and omits it when the drive is fresh", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const iso = "https://example.com/omarchy.iso";
      yield* Qemu.reserve(proxy)(AGENT, iso);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({ agent: AGENT, resume: iso });
    }),
  );
});

describe("Qemu.reserve unhappy path", () => {
  it.effect("a 503 is AtCapacity with the guest host's own words", () =>
    Effect.gen(function* () {
      const http = TestingHttp.respondWith(() =>
        TestingHttp.json({ error: "at capacity: max-jobs is 4" }, 503),
      );
      const proxy = yield* connect.pipe(Effect.provide(http));
      const error = yield* Effect.flip(Qemu.reserve(proxy)(AGENT));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "at capacity: max-jobs is 4",
        agentId: AGENT,
      });
    }),
  );

  it.effect("a 409 is SetupNeeded and is not reported as an internal failure", () =>
    Effect.gen(function* () {
      const http = TestingHttp.respondWith(() =>
        TestingHttp.json({ error: "setup needed: http://10.0.0.6:42069 max-jobs is 4" }, 409),
      );
      const proxy = yield* connect.pipe(Effect.provide(http));
      const error = yield* Effect.flip(Qemu.reserve(proxy)(AGENT));
      expect(error).toMatchObject({
        _tag: "SetupNeeded",
        message: "setup needed: http://10.0.0.6:42069 max-jobs is 4",
        agentId: AGENT,
      });
    }),
  );

  it.effect("any other refusal is Internal carrying the refusal", () =>
    Effect.gen(function* () {
      const http = TestingHttp.respondWith(() =>
        TestingHttp.json({ error: "already reserved" }, 400),
      );
      const proxy = yield* connect.pipe(Effect.provide(http));
      const error = yield* Effect.flip(Qemu.reserve(proxy)(AGENT));
      expect(error).toMatchObject({ _tag: "Internal", agentId: AGENT });
      expect(Render.headline(error)).toBe("internal error: already reserved");
    }),
  );

  it.effect("an unreachable proxy is Internal naming the request", () =>
    Effect.gen(function* () {
      const proxy = yield* connect.pipe(Effect.provide(unreachable));
      const error = yield* Effect.flip(Qemu.reserve(proxy)(AGENT));
      expect(error).toMatchObject({ _tag: "Internal", agentId: AGENT });
      expect(Render.headline(error)).toBe(`internal error: POST ${SERVER}/reserve failed`);
      expect(Render.errorDetail(ExternalFailure.causeOf(error.cause))).toContain(
        "connect ECONNREFUSED 127.0.0.1:55555",
      );
    }),
  );
});

describe("Qemu.relinquish happy path", () => {
  it.effect("posts the agent to /relinquish and succeeds on 200", () =>
    Effect.gen(function* () {
      const recorder = TestingHttp.recordRequests(() => TestingHttp.json({ ok: "true" }));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* Qemu.relinquish(proxy)(AGENT);
      expect(recorder.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `POST ${SERVER}/relinquish`,
      ]);
      expect(JSON.parse(recorder.requests[0]?.body ?? "")).toEqual({ agent: AGENT });
    }),
  );

  // The guest host let the reservation go on its own (its ten minutes ran out first, or it
  // restarted): there is nothing to give back, which is what relinquish was for.
  it.effect("a 400 no reservation is nothing to give back, and succeeds", () =>
    Effect.gen(function* () {
      const http = TestingHttp.respondWith(() =>
        TestingHttp.json({ error: "no reservation" }, 400),
      );
      const proxy = yield* connect.pipe(Effect.provide(http));
      yield* Qemu.relinquish(proxy)(AGENT);
    }),
  );
});

describe("Qemu.relinquish unhappy path", () => {
  it.effect("a 500 is Internal carrying the refusal", () =>
    Effect.gen(function* () {
      const http = TestingHttp.respondWith(() =>
        TestingHttp.json({ error: "internal error" }, 500),
      );
      const proxy = yield* connect.pipe(Effect.provide(http));
      const error = yield* Effect.flip(Qemu.relinquish(proxy)(AGENT));
      expect(error).toMatchObject({ _tag: "Internal", agentId: AGENT });
      expect(Render.headline(error)).toBe("internal error: internal error");
    }),
  );

  it.effect("an unreachable proxy is Internal naming the request", () =>
    Effect.gen(function* () {
      const proxy = yield* connect.pipe(Effect.provide(unreachable));
      const error = yield* Effect.flip(Qemu.relinquish(proxy)(AGENT));
      expect(error).toMatchObject({ _tag: "Internal", agentId: AGENT });
      expect(Render.headline(error)).toBe(`internal error: POST ${SERVER}/relinquish failed`);
    }),
  );

  // The sweep that gives expired reservations back is one fiber with nobody waiting on it; a
  // proxy that never answers must not hold every later expiry behind this one.
  it.effect("a proxy that never answers is Internal after ten seconds", () =>
    Effect.gen(function* () {
      const proxy = yield* connect.pipe(Effect.provide(TestingHttp.never));
      const pending = yield* Effect.forkChild(Effect.flip(Qemu.relinquish(proxy)(AGENT)));
      yield* Effect.yieldNow;
      expect(pending.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("10 seconds");
      const error = yield* Fiber.join(pending);
      expect(error).toMatchObject({ _tag: "Internal", agentId: AGENT });
      expect(Render.headline(error)).toBe(
        "internal error: relinquish: no answer within 10 seconds",
      );
    }),
  );
});
