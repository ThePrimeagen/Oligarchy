import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Redacted, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import * as OpenRouter from "../../src/harness/openrouter.ts";
import type * as History from "../../src/harness/history.ts";
import type * as Tools from "../../src/harness/tools.ts";
import * as Render from "../../src/observability/render.ts";
import * as FakeHttp from "../support/fake-http.ts";

// Synthetic OpenRouter chat-completion frames. The shapes follow the public streaming
// docs; they are not a captured vendor trace.

const TOKEN = "secret-token";
const BASE = "https://openrouter.ai/api/v1";
const URL = `${BASE}/chat/completions`;
const MODEL = "meta/muse-spark-1.3-contributor";

const tool: Tools.ToolDefinition = {
  type: "function",
  function: {
    name: "client",
    description: "Drive the guest.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["args"],
      properties: {
        args: { type: "array", items: { type: "string" }, description: "flags" },
      },
    },
  },
};

const messages: ReadonlyArray<History.WireMessage> = [
  { role: "system", content: "You drive." },
  { role: "user", content: "Lock the screen." },
];

const run = (
  layer: Layer.Layer<HttpClient.HttpClient>,
  overrides?: {
    readonly header?: Duration.Duration;
    readonly chunk?: Duration.Duration;
    readonly ceiling?: Duration.Duration;
    readonly defaultRetry?: Duration.Duration;
    readonly messages?: ReadonlyArray<History.WireMessage>;
  },
) =>
  OpenRouter.complete({
    baseUrl: BASE,
    token: Redacted.make(TOKEN),
    model: MODEL,
    messages: overrides?.messages ?? messages,
    tools: [tool],
    reasoning: "minimal",
    timeouts: {
      header: overrides?.header ?? Duration.minutes(3),
      chunk: overrides?.chunk ?? Duration.minutes(3),
    },
    runCeiling: overrides?.ceiling ?? Duration.hours(1.5),
    defaultRetry: overrides?.defaultRetry ?? Duration.seconds(1),
    startedAtMillis: 0,
  }).pipe(Effect.provide(layer));

const frame = (body: unknown): string => JSON.stringify(body);

const choice = (
  delta: unknown,
  finish: string | null,
): { readonly choices: ReadonlyArray<unknown> } => ({
  choices: [{ delta, finish_reason: finish }],
});

const sse = (
  frames: ReadonlyArray<string>,
  init?: { readonly status?: number; readonly headers?: Record<string, string> },
): Response =>
  new Response(frames.map((line) => `data: ${line}\n\n`).join(""), {
    status: init?.status ?? 200,
    headers: { "content-type": "text/event-stream", ...init?.headers },
  });

const doneTurn = (): Response =>
  sse([
    frame(choice({ role: "assistant", content: "Locked." }, null)),
    frame(choice({}, "stop")),
    frame({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 3 } }),
    "[DONE]",
  ]);

const toolTurn = (): Response => {
  const text = [
    ": OPENROUTER PROCESSING",
    "",
    `data: ${frame(choice({ content: "Looking." }, null))}`,
    "",
    `data: ${frame(
      choice(
        {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "client", arguments: "" },
            },
          ],
        },
        null,
      ),
    )}`,
    "",
    `data: ${frame(
      choice({ tool_calls: [{ index: 0, function: { arguments: '{"args":' } }] }, null),
    )}`,
    "",
    `data: ${frame(
      choice(
        {
          tool_calls: [
            { index: 0, function: { arguments: '["type"]}' } },
            {
              index: 1,
              id: "call-2",
              type: "function",
              function: { name: "client", arguments: '{"args":["key","super"]}' },
            },
          ],
        },
        null,
      ),
    )}`,
    "",
    `data: ${frame(choice({}, "tool_calls"))}`,
    "",
    "data: [DONE]",
    "",
    "",
  ].join("\n");
  const encoder = new TextEncoder();
  const mid = Math.floor(text.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, mid)));
      controller.enqueue(encoder.encode(text.slice(mid)));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const jsonError = (status: number, message: string, retryAfter?: string): Response => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (retryAfter !== undefined) {
    headers["retry-after"] = retryAfter;
  }
  return new Response(JSON.stringify({ error: { message, code: status } }), { status, headers });
};

const rendered = (error: { readonly message: string }): string =>
  Render.renderFailure(Cause.fail(error));

describe("OpenRouter client", () => {
  it.effect("streams a completion into content and tool calls", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => toolTurn());
      const turn = yield* run(recorder.layer);
      expect(turn).toEqual({
        content: "Looking.",
        toolCalls: [
          { id: "call-1", name: "client", arguments: '{"args":["type"]}' },
          { id: "call-2", name: "client", arguments: '{"args":["key","super"]}' },
        ],
      });
      expect(recorder.requests).toHaveLength(1);
      const request = recorder.requests[0];
      expect(request?.method).toBe("POST");
      expect(request?.url).toBe(URL);
      expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(request?.body ?? "")).toEqual({
        model: MODEL,
        messages,
        tools: [tool],
        reasoning: { effort: "minimal" },
        stream: true,
      });
    }),
  );

  it.effect("posts a user message's screenshot as an image part beside its text", () =>
    Effect.gen(function* () {
      const withImage: ReadonlyArray<History.WireMessage> = [
        { role: "system", content: "You drive." },
        {
          role: "user",
          content: [
            { type: "text", text: "Lock the screen." },
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          ],
        },
      ];
      const recorder = FakeHttp.recordRequests(() => doneTurn());
      yield* run(recorder.layer, { messages: withImage });
      expect(JSON.parse(recorder.requests[0]?.body ?? "").messages).toEqual(withImage);
    }),
  );

  it.effect("returns the model's text when it stops calling tools", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => doneTurn());
      const turn = yield* run(recorder.layer);
      expect(turn).toEqual({ content: "Locked.", toolCalls: [] });
    }),
  );

  it.effect("a 4xx is a refused request and is not retried", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => jsonError(400, "Model not found", "30"));
      const error = yield* Effect.flip(run(recorder.layer));
      expect(error).toMatchObject({
        _tag: "OpenRouterRefusal",
        status: 400,
        message: "Model not found",
      });
      expect(recorder.requests).toHaveLength(1);
      expect(rendered(error)).not.toContain(TOKEN);
    }),
  );

  it.effect("an empty refusal body and a raw body still name the refusal", () =>
    Effect.gen(function* () {
      const empty = FakeHttp.recordRequests(() => new Response(null, { status: 401 }));
      const missing = yield* Effect.flip(run(empty.layer));
      expect(missing).toMatchObject({
        _tag: "OpenRouterRefusal",
        status: 401,
        message: "request failed",
      });

      const raw = FakeHttp.recordRequests(() => new Response("bad request", { status: 400 }));
      const text = yield* Effect.flip(run(raw.layer));
      expect(text).toMatchObject({
        _tag: "OpenRouterRefusal",
        status: 400,
        message: "bad request",
      });
      expect(rendered(text)).not.toContain(TOKEN);
    }),
  );

  it.effect("a connection failure is an unreachable service", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:443"),
            }),
          }),
        ),
      );
      const error = yield* Effect.flip(run(layer));
      expect(error._tag).toBe("OpenRouterUnreachable");
      expect(error.message).toBe(`POST ${URL} failed`);
      expect(Render.headline(error)).toBe(`POST ${URL} failed: connect ECONNREFUSED 127.0.0.1:443`);
      expect(rendered(error)).not.toContain(TOKEN);
    }),
  );

  it.effect("the header timeout fails the request before the run ceiling", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(run(FakeHttp.never, { header: Duration.minutes(3) }));
      yield* TestClock.adjust("2 minutes");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 minute");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: no response within header timeout",
      });
    }),
  );

  it.effect("a stall between chunks fails at the chunk timeout", () =>
    Effect.gen(function* () {
      // A web body that never reads again blocks the test clock. The stall is an Effect
      // stream: one chunk, then nothing. The client times out the same way on a live body.
      const bytes = new TextEncoder().encode(
        `data: ${frame(choice({ content: "partial" }, null))}\n\n`,
      );
      const layer = Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) => {
          const response = HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
          );
          Object.defineProperty(response, "stream", {
            configurable: true,
            get: () => Stream.concat(Stream.make(bytes), Stream.never),
          });
          return Effect.succeed(response);
        }),
      );
      const fiber = yield* Effect.forkScoped(
        run(layer, { chunk: Duration.minutes(3), header: Duration.minutes(3) }),
      );
      yield* TestClock.adjust("2 minutes");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 minute");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: no chunk within chunk timeout",
      });
    }),
  );

  it.effect("interrupting a stalled stream stays an interruption", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const layer = Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) => {
          const response = HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
          );
          Object.defineProperty(response, "stream", {
            configurable: true,
            get: () =>
              Stream.fromEffect(
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.andThen(Effect.succeed(new Uint8Array())),
                ),
              ),
          });
          return Effect.succeed(response);
        }),
      );
      const fiber = yield* Effect.forkScoped(run(layer));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(true);
    }),
  );

  it.effect("a defect while reading the stream stays a defect", () =>
    Effect.gen(function* () {
      const layer = Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) => {
          const response = HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
          );
          Object.defineProperty(response, "stream", {
            configurable: true,
            get: () => Stream.die("boom"),
          });
          return Effect.succeed(response);
        }),
      );
      const exit = yield* Effect.exit(run(layer));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );

  it.effect("a stream that closes before the completion is unreachable", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith(() => sse([frame(choice({ content: "partial" }, null))]));
      const error = yield* Effect.flip(run(layer));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: stream ended before the completion",
      });
    }),
  );

  it.effect("a stop with no text is the model ending the turn", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith(() => sse([frame(choice({}, "stop")), "[DONE]"]));
      const turn = yield* run(layer);
      expect(turn).toEqual({ content: null, toolCalls: [] });
    }),
  );

  it.effect("a stream that is only the done marker is not a completion", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith(() => sse(["[DONE]"]));
      const error = yield* Effect.flip(run(layer));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: stream ended before the completion",
      });
    }),
  );

  it.effect("a chunk that is not a completion is unreachable", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith(() => sse(["not-json", "[DONE]"]));
      const error = yield* Effect.flip(run(layer));
      expect(error._tag).toBe("OpenRouterUnreachable");
      expect(error.message).toBe("openrouter: invalid response");
      expect(rendered(error)).not.toContain(TOKEN);
    }),
  );

  it.effect("retries a 429 after retry-after, and a 500 the same way", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => {
        const seen = recorder.requests.length;
        if (seen === 1) {
          return jsonError(429, "slow down", "30");
        }
        if (seen === 2) {
          return jsonError(500, "provider blip", "5");
        }
        return doneTurn();
      });
      const fiber = yield* Effect.forkScoped(run(recorder.layer));
      yield* TestClock.adjust("29 seconds");
      expect(recorder.requests).toHaveLength(1);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      expect(recorder.requests).toHaveLength(2);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("4 seconds");
      expect(recorder.requests).toHaveLength(2);
      yield* TestClock.adjust("1 second");
      const turn = yield* Fiber.join(fiber);
      expect(turn.content).toBe("Locked.");
      expect(recorder.requests).toHaveLength(3);
      expect(recorder.requests[1]?.body).toBe(recorder.requests[0]?.body);
    }),
  );

  it.effect("does not sleep a retry-after that would pass the run ceiling", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => jsonError(429, "slow down", "7200"));
      const error = yield* Effect.flip(run(recorder.layer));
      expect(error._tag).toBe("OpenRouterUnreachable");
      expect(error.message).toBe(
        "openrouter: retry delay of 2h would pass the run ceiling: slow down",
      );
      expect(recorder.requests).toHaveLength(1);
      expect(rendered(error)).not.toContain(TOKEN);
    }),
  );

  it.effect("waits the configured default when a 429 has no retry-after", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => {
        if (recorder.requests.length === 1) {
          return jsonError(503, "unavailable");
        }
        return doneTurn();
      });
      const fiber = yield* Effect.forkScoped(
        run(recorder.layer, { defaultRetry: Duration.seconds(2) }),
      );
      yield* TestClock.adjust("1 second");
      expect(recorder.requests).toHaveLength(1);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      const turn = yield* Fiber.join(fiber);
      expect(turn.content).toBe("Locked.");
      expect(recorder.requests).toHaveLength(2);
    }),
  );

  it.effect("a malformed retry-after waits the configured default", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => {
        if (recorder.requests.length === 1) {
          return jsonError(429, "slow down", "soon");
        }
        return doneTurn();
      });
      const fiber = yield* Effect.forkScoped(
        run(recorder.layer, { defaultRetry: Duration.seconds(2) }),
      );
      yield* TestClock.adjust("1 second");
      expect(recorder.requests).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      const turn = yield* Fiber.join(fiber);
      expect(turn.content).toBe("Locked.");
      expect(recorder.requests).toHaveLength(2);
    }),
  );

  it.effect("does not sleep a configured default that would pass the run ceiling", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => jsonError(503, "unavailable"));
      const error = yield* Effect.flip(run(recorder.layer, { defaultRetry: Duration.hours(2) }));
      expect(error._tag).toBe("OpenRouterUnreachable");
      expect(error.message).toBe(
        "openrouter: retry delay of 2h would pass the run ceiling: unavailable",
      );
      expect(recorder.requests).toHaveLength(1);
    }),
  );

  it.effect("reads an HTTP-date retry-after from the clock", () =>
    Effect.gen(function* () {
      const recorder = FakeHttp.recordRequests(() => {
        if (recorder.requests.length === 1) {
          return jsonError(429, "slow down", "Thu, 01 Jan 1970 00:00:30 GMT");
        }
        return doneTurn();
      });
      const fiber = yield* Effect.forkScoped(run(recorder.layer));
      yield* TestClock.adjust("29 seconds");
      expect(recorder.requests).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      const turn = yield* Fiber.join(fiber);
      expect(turn.toolCalls).toEqual([]);
      expect(recorder.requests).toHaveLength(2);
    }),
  );

  it.effect("a 429 whose body never arrives fails at the chunk timeout", () =>
    Effect.gen(function* () {
      const layer = Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) => {
          const response = HttpClientResponse.fromWeb(
            request,
            new Response(null, { status: 429, headers: { "retry-after": "7200" } }),
          );
          Object.defineProperty(response, "text", {
            configurable: true,
            get: () => Effect.never,
          });
          return Effect.succeed(response);
        }),
      );
      const fiber = yield* Effect.forkScoped(
        run(layer, { chunk: Duration.minutes(3), header: Duration.minutes(3) }),
      );
      yield* TestClock.adjust("2 minutes");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 minute");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: no chunk within chunk timeout",
      });
    }),
  );

  it.effect("a tool call with a negative index is not a completion", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith(() =>
        sse([
          frame(
            choice(
              {
                tool_calls: [
                  { index: -1, id: "call-1", function: { name: "client", arguments: "{}" } },
                ],
              },
              "tool_calls",
            ),
          ),
          "[DONE]",
        ]),
      );
      const error = yield* Effect.flip(run(layer));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: invalid response",
      });
    }),
  );

  it.effect("a provider error inside the stream is unreachable and is not a tool call", () =>
    Effect.gen(function* () {
      const layer = FakeHttp.respondWith(() =>
        sse([frame({ error: { message: "Provider returned error", code: 502 } }), "[DONE]"]),
      );
      const error = yield* Effect.flip(run(layer));
      expect(error).toMatchObject({
        _tag: "OpenRouterUnreachable",
        message: "openrouter: Provider returned error",
      });
    }),
  );
});
