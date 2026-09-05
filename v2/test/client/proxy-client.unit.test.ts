import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Fiber, Redacted, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HttpClientError } from "effect/unstable/http";
import * as ProxyClient from "../../src/client/proxy-client.ts";
import * as Render from "../../src/observability/render.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as FakeHttp from "../support/fake-http.ts";

const SERVER = "http://127.0.0.1:42069";
const TOKEN = "test-token";
const SESSION = "session-1";
const AGENT = "agent-1";

const connect = ProxyClient.connect({ serverUrl: SERVER, token: Redacted.make(TOKEN) });

const ok = () => FakeHttp.json({ ok: "true" });

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const parsed = (body: string): unknown => JSON.parse(body);

const expectJsonPost = (
  recorded: FakeHttp.Recorded | undefined,
  path: string,
  body: Record<string, unknown>,
) => {
  expect(recorded).toBeDefined();
  expect(recorded?.method).toBe("POST");
  expect(recorded?.url).toBe(`${SERVER}${path}`);
  expect(recorded?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  expect(recorded?.headers["content-type"]).toBe("application/json");
  expect(parsed(recorded?.body ?? "")).toEqual(body);
};

describe("ProxyClient requests", () => {
  it.effect("sendKeys posts id, keys, encoding and agent with the bearer token", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* proxy.sendKeys(
        Contract.SendKeysBody.make({
          id: SESSION,
          keys: "hello",
          encoding: "oligarchy",
          agent: AGENT,
        }),
      );
      expectJsonPost(recorder.requests[0], "/send-keys", {
        id: SESSION,
        keys: "hello",
        encoding: "oligarchy",
        agent: AGENT,
      });
      expect(recorder.requests).toHaveLength(1);
    }),
  );

  it.effect("start posts iso and agent and leaves an absent disk out of the body", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ id: "11111111-1111-4111-8111-111111111111" }),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const response = yield* proxy.start(
        Contract.StartBody.make({ iso: "https://example.com/omarchy.iso", agent: AGENT }),
      );
      expect(response.id).toBe("11111111-1111-4111-8111-111111111111");
      expectJsonPost(recorder.requests[0], "/start", {
        iso: "https://example.com/omarchy.iso",
        agent: AGENT,
      });
      expect(recorder.requests[0]?.body).not.toContain("disk");
    }),
  );

  it.effect("start posts the disk when given", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ id: "x" }));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* proxy.start(
        Contract.StartBody.make({ iso: "/iso/omarchy.iso", disk: "/disk/a.qcow2", agent: AGENT }),
      );
      expectJsonPost(recorder.requests[0], "/start", {
        iso: "/iso/omarchy.iso",
        disk: "/disk/a.qcow2",
        agent: AGENT,
      });
    }),
  );

  it.effect("sendMouse posts button and clicks when given and omits them otherwise", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* proxy.sendMouse(
        Contract.SendMouseBody.make({
          id: SESSION,
          x: 0.5,
          y: 0.25,
          button: "left",
          clicks: 2,
          agent: AGENT,
        }),
      );
      yield* proxy.sendMouse(
        Contract.SendMouseBody.make({ id: SESSION, x: 0, y: 1, agent: AGENT }),
      );
      expectJsonPost(recorder.requests[0], "/send-mouse", {
        id: SESSION,
        x: 0.5,
        y: 0.25,
        button: "left",
        clicks: 2,
        agent: AGENT,
      });
      expectJsonPost(recorder.requests[1], "/send-mouse", {
        id: SESSION,
        x: 0,
        y: 1,
        agent: AGENT,
      });
    }),
  );

  it.effect("intentStart and intentEnd post their bodies", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* proxy.intentStart(
        Contract.IntentStartBody.make({
          id: SESSION,
          agent: AGENT,
          test_result_id: "result-1",
          message: "wait for the boot menu",
        }),
      );
      yield* proxy.intentEnd(Contract.IntentEndBody.make({ id: SESSION, agent: AGENT }));
      expectJsonPost(recorder.requests[0], "/intent/start", {
        id: SESSION,
        agent: AGENT,
        test_result_id: "result-1",
        message: "wait for the boot menu",
      });
      expectJsonPost(recorder.requests[1], "/intent/end", { id: SESSION, agent: AGENT });
    }),
  );

  it.effect("stop posts status and reason when given and neither otherwise", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(ok);
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      yield* proxy.stop(
        Contract.StopBody.make({
          id: SESSION,
          agent: AGENT,
          status: "failed",
          reason: "installer hung",
        }),
      );
      yield* proxy.stop(Contract.StopBody.make({ id: SESSION, agent: AGENT }));
      expectJsonPost(recorder.requests[0], "/stop", {
        id: SESSION,
        agent: AGENT,
        status: "failed",
        reason: "installer hung",
      });
      expectJsonPost(recorder.requests[1], "/stop", { id: SESSION, agent: AGENT });
    }),
  );

  it.effect("image gets /image?id&agent url-encoded with the token and returns the bytes", () =>
    Effect.gen(function* () {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response(png, {
            status: 200,
            headers: {
              "content-type": "image/png",
              "x-image-url": "https://oligarchy.trm.sh/images/9c4f0000-0000-4000-8000-00000000b2d3",
            },
          }),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const bytes = yield* proxy.image("a/b", AGENT);
      expect([...bytes]).toEqual([...png]);
      expect(recorder.requests[0]?.method).toBe("GET");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/image?id=a%2Fb&agent=${AGENT}`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(recorder.requests[0]?.body).toBe("");
    }),
  );

  it.effect("serial gets /serial?id&agent and returns the bytes", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response("boot log\n", { status: 200, headers: { "content-type": "text/plain" } }),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const bytes = yield* proxy.serial(SESSION, AGENT);
      expect(decoder.decode(bytes)).toBe("boot log\n");
      expect(recorder.requests[0]?.method).toBe("GET");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/serial?id=${SESSION}&agent=${AGENT}`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }),
  );

  it.effect("dump gets /dump?id without an agent and returns the bytes", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(
        () => new Response("panic\n", { status: 200, headers: { "content-type": "text/plain" } }),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const bytes = yield* proxy.dump(SESSION);
      expect(decoder.decode(bytes)).toBe("panic\n");
      expect(recorder.requests[0]?.method).toBe("GET");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/dump?id=${SESSION}`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }),
  );
});

describe("ProxyClient refusals", () => {
  it.effect("a declared error status decodes the body's error as the message", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: `unknown session "${SESSION}"` }, 404),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const error = yield* Effect.flip(
        proxy.sendKeys(Contract.SendKeysBody.make({ id: SESSION, keys: "x", agent: AGENT })),
      );
      expect(error).toMatchObject({
        _tag: "ProxyRefusal",
        status: 404,
        message: `unknown session "${SESSION}"`,
      });
      expect(Render.headline(error)).toBe(`unknown session "${SESSION}"`);
    }),
  );

  it.effect('an undeclared error status still reads {"error"} from the body', () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => FakeHttp.json({ error: "boom" }, 409));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const error = yield* Effect.flip(
        proxy.sendKeys(Contract.SendKeysBody.make({ id: SESSION, keys: "x", agent: AGENT })),
      );
      expect(error).toMatchObject({ _tag: "ProxyRefusal", status: 409, message: "boom" });
    }),
  );

  it.effect("a non-JSON body is the message raw", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response("Bad Gateway", { status: 500, headers: { "content-type": "text/html" } }),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const error = yield* Effect.flip(proxy.dump(SESSION));
      expect(error).toMatchObject({ _tag: "ProxyRefusal", status: 500, message: "Bad Gateway" });
    }),
  );

  it.effect("an empty body reads `request failed`", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => new Response(null, { status: 500 }));
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const error = yield* Effect.flip(proxy.serial(SESSION, AGENT));
      expect(error).toMatchObject({ _tag: "ProxyRefusal", status: 500, message: "request failed" });
    }),
  );
});

describe("ProxyClient transport", () => {
  it.effect("a refused connection is ProxyUnreachable with `<METHOD> <url> failed: <cause>`", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:42069"),
            }),
          }),
        ),
      );
      const proxy = yield* connect.pipe(Effect.provide(layer));
      const error = yield* Effect.flip(
        proxy.sendKeys(Contract.SendKeysBody.make({ id: SESSION, keys: "x", agent: AGENT })),
      );
      expect(error._tag).toBe("ProxyUnreachable");
      expect(error.message).toBe("POST http://127.0.0.1:42069/send-keys failed");
      expect(Render.headline(error)).toBe(
        "POST http://127.0.0.1:42069/send-keys failed: connect ECONNREFUSED 127.0.0.1:42069",
      );
      expect(Render.renderFailure(Cause.fail(error))).not.toContain("fetch failed");
    }),
  );

  it.effect("a refused GET names the full url with its query", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:42069"),
            }),
          }),
        ),
      );
      const proxy = yield* connect.pipe(Effect.provide(layer));
      const error = yield* Effect.flip(proxy.image(SESSION, AGENT));
      expect(error.message).toBe(
        `GET http://127.0.0.1:42069/image?id=${SESSION}&agent=${AGENT} failed`,
      );
    }),
  );
});

describe("ProxyClient start ceiling", () => {
  it.effect("start is still waiting after 44 minutes and fails at 45", () =>
    Effect.gen(function* () {
      const proxy = yield* connect.pipe(Effect.provide(FakeHttp.never));
      const fiber = yield* Effect.forkScoped(
        proxy.start(Contract.StartBody.make({ iso: "https://example.com/x.iso", agent: AGENT })),
      );
      yield* TestClock.adjust("44 minutes");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 minute");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "ProxyUnreachable",
        message: "start: no response within timeout",
      });
      expect(Render.headline(error)).toBe("start: no response within timeout");
    }),
  );

  it.effect("the other calls have no ceiling of their own at 45 minutes", () =>
    Effect.gen(function* () {
      const proxy = yield* connect.pipe(Effect.provide(FakeHttp.never));
      const fiber = yield* Effect.forkScoped(proxy.serial(SESSION, AGENT));
      yield* TestClock.adjust("46 minutes");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("ProxyClient follow", () => {
  it.effect("yields the raw bytes of each chunk as they arrive", () =>
    Effect.gen(function* () {
      const chunks = [
        '{"type":"session","status":"running"}\n',
        '{"type":"action","id":1,"name":"send-keys","state":"running"}\n',
        '{"type":"session","status":"succeeded"}\n',
      ];
      const recorder = FakeHttp.recordRequests(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "application/x-ndjson" } },
          ),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const stream = yield* proxy.follow(SESSION);
      const received = yield* Stream.runCollect(stream);
      expect(received.map((chunk) => decoder.decode(chunk)).join("")).toBe(chunks.join(""));
      expect(recorder.requests[0]?.method).toBe("GET");
      expect(recorder.requests[0]?.url).toBe(`${SERVER}/follow?id=${SESSION}`);
      expect(recorder.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }),
  );

  it.effect("fails ProxyRefusal on a 409 before yielding any bytes", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: `session "${SESSION}" has already completed (succeeded)` }, 409),
      );
      const proxy = yield* connect.pipe(Effect.provide(recorder.layer));
      const error = yield* Effect.flip(proxy.follow(SESSION));
      expect(error).toMatchObject({
        _tag: "ProxyRefusal",
        status: 409,
        message: `session "${SESSION}" has already completed (succeeded)`,
      });
    }),
  );

  it.effect("a follow whose connection is refused is ProxyUnreachable", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:42069"),
            }),
          }),
        ),
      );
      const proxy = yield* connect.pipe(Effect.provide(layer));
      const error = yield* Effect.flip(proxy.follow(SESSION));
      expect(error).toMatchObject({
        _tag: "ProxyUnreachable",
        message: `GET http://127.0.0.1:42069/follow?id=${SESSION} failed`,
      });
    }),
  );
});
