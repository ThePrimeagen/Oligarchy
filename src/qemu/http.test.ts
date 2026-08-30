import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiTest } from "effect/unstable/httpapi";
import { api } from "./http.ts";

const handlers = HttpApiBuilder.group(api, "control", (handlers) =>
  handlers.handleAll({
    start: () => Effect.succeed({ id: "session-1" }),
    image: () => Effect.succeed(new Uint8Array([1, 2, 3])),
    stats: () =>
      Effect.succeed({
        qemus: 1,
        memory: {
          totalBytes: 100,
          usedBytes: 60,
          freeBytes: 40,
        },
        cpu: {
          cores: 2,
          mean: 25,
          p10: 10,
          p25: 20,
          p75: 30,
          p90: 40,
        },
      }),
    stop: () => Effect.succeed({ ok: "true" }),
    sendKeys: ({ payload }) =>
      payload.id === "missing"
        ? Effect.fail({ error: 'unknown session "missing"' })
        : Effect.succeed({ ok: "true" }),
  }),
);

const testServices = [handlers, NodeHttpServer.layerHttpServices];

describe("Effect HTTP contract happy path", () => {
  it("round trips every JSON endpoint through the generated client", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(api, ["control"]);

        assert.deepEqual(yield* client.control.start({ payload: undefined }), {
          id: "session-1",
        });
        assert.deepEqual(yield* client.control.stats(), {
          qemus: 1,
          memory: {
            totalBytes: 100,
            usedBytes: 60,
            freeBytes: 40,
          },
          cpu: {
            cores: 2,
            mean: 25,
            p10: 10,
            p25: 20,
            p75: 30,
            p90: 40,
          },
        });
        assert.deepEqual(
          yield* client.control.sendKeys({
            payload: {
              id: "session-1",
              keys: "Hi<ENTER>",
              encoding: "oligarchy",
              agent: "agent-1",
            },
          }),
          { ok: "true" },
        );
        assert.deepEqual(
          yield* client.control.stop({
            payload: {
              id: "session-1",
              status: "succeeded",
              reason: "done",
            },
          }),
          { ok: "true" },
        );
      }).pipe(Effect.provide(testServices), Effect.scoped),
    );
  });

  it("returns image bytes with the declared PNG content type", async () => {
    const appLayer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(handlers),
      Layer.provide(NodeHttpServer.layerHttpServices),
    );
    const web = HttpRouter.toWebHandler(Layer.mergeAll(appLayer), {
      disableLogger: true,
    });
    try {
      const response = await web.handler(
        new Request("http://localhost/image?id=session-1&agent=agent-1"),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(
        new Uint8Array(await response.arrayBuffer()),
        new Uint8Array([1, 2, 3]),
      );
    } finally {
      await web.dispose();
    }
  });
});

describe("Effect HTTP contract unhappy path", () => {
  it("round trips declared operational errors through the generated client", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(api, ["control"]);
        const failure = yield* Effect.flip(
          client.control.sendKeys({
            payload: {
              id: "missing",
              keys: "a",
              agent: "agent-1",
            },
          }),
        );
        assert.deepEqual(failure, { error: 'unknown session "missing"' });
      }).pipe(Effect.provide(testServices), Effect.scoped),
    );
  });

  it("rejects a malformed JSON payload before invoking a handler", async () => {
    const appLayer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(handlers),
      Layer.provide(NodeHttpServer.layerHttpServices),
    );
    const web = HttpRouter.toWebHandler(Layer.mergeAll(appLayer), {
      disableLogger: true,
    });
    try {
      const response = await web.handler(
        new Request("http://localhost/send-keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: 1 }),
        }),
      );
      assert.equal(response.status, 400);
    } finally {
      await web.dispose();
    }
  });
});
