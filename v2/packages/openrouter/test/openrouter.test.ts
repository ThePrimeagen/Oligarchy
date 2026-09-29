import * as Async from "@oligarchy/async";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as OpenRouter from "../src/main.ts";
import {
  answer,
  BASE_URL,
  client,
  DEFAULT_RETRY_MS,
  DONE,
  event,
  finish,
  KEEP_ALIVE,
  NOW,
  type Piece,
  REQUEST,
  status,
  stream,
  text,
  TOKEN,
} from "./support.ts";

const KEPT = jarl.ok({ content: "kept", toolCalls: [] });

const call = (index: number, part: Record<string, unknown>) =>
  event({ choices: [{ delta: { tool_calls: [{ index, ...part }] } }] });

// Ninety milliseconds of keep-alive comments and never an event, then the stream closes: only a
// chunk timeout the comments do not restart ends it first.
const comments: ReadonlyArray<Piece> = [
  KEEP_ALIVE,
  15,
  KEEP_ALIVE,
  15,
  KEEP_ALIVE,
  15,
  KEEP_ALIVE,
  15,
  KEEP_ALIVE,
  15,
  KEEP_ALIVE,
  15,
  KEEP_ALIVE,
];

describe("complete", () => {
  it("streams the model's text and tool calls into one turn, from the one request asked (happy)", async () => {
    const { openRouter, asked, slept } = await client(
      stream([
        KEEP_ALIVE,
        text("Opening "),
        20,
        'data: {"choices":[{"delta":{"content":"the lock',
        ' screen"}}]}\n\n',
        20,
        KEEP_ALIVE,
        call(1, { id: "call-2", function: { name: "client", arguments: '{"args":' } }),
        call(0, {
          id: "call-1",
          function: { name: "client", arguments: '{"args":["get-image"]}' },
        }),
        20,
        call(1, { function: { arguments: '["send-keys","super+l"]}' } }),
        event({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
        DONE,
      ]),
    );

    const turn = await openRouter.complete(REQUEST);

    expect(turn).toEqual(
      jarl.ok({
        content: "Opening the lock screen",
        toolCalls: [
          { id: "call-1", name: "client", arguments: '{"args":["get-image"]}' },
          { id: "call-2", name: "client", arguments: '{"args":["send-keys","super+l"]}' },
        ],
      }),
    );
    expect(asked).toEqual([
      {
        url: `${BASE_URL}/chat/completions`,
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: {
          model: REQUEST.model,
          messages: REQUEST.messages,
          tools: REQUEST.tools,
          reasoning: { effort: "low" },
          stream: true,
        },
      },
    ]);
    expect(slept).toEqual([]);
  });

  it.each([
    {
      code: 404,
      body: JSON.stringify({ error: { message: "no such model", code: 404 } }),
      said: "no such model",
    },
    { code: 401, body: JSON.stringify({ error: "bad key" }), said: "bad key" },
    { code: 403, body: "<html>forbidden</html>", said: "<html>forbidden</html>" },
    { code: 400, body: "", said: "request failed" },
  ])(
    "a $code is refused with its status and its body's message, and is not sent again (unhappy)",
    async ({ code, body, said }) => {
      const { openRouter, asked, slept } = await client([status(code, body), answer("never")]);

      const turn = await openRouter.complete(REQUEST);

      const refused = Fake.failure(turn, OpenRouter.OpenRouterRefused);
      expect(refused.status).toBe(code);
      expect(refused.message).toBe(`openrouter: ${String(code)}: ${said}`);
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it("no connection is unreachable, and is not sent again (unhappy)", async () => {
    const { openRouter, asked, slept } = await client(["unreachable", answer("never")]);

    const turn = await openRouter.complete(REQUEST);

    const unreachable = Fake.failure(turn, OpenRouter.OpenRouterUnreachable);
    expect(unreachable.message).toBe(`openrouter: POST ${BASE_URL}/chat/completions: fetch failed`);
    expect(String(unreachable)).not.toContain(TOKEN);
    expect(asked).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it.each([
    { name: "a 429 waits its Retry-After in seconds", code: 429, after: "3", waited: 3_000 },
    {
      name: "a 503 waits an HTTP-date Retry-After, read on the clock",
      code: 503,
      after: new Date(NOW + 5_000).toUTCString(),
      waited: 5_000,
    },
    { name: "a Retry-After of zero waits a millisecond", code: 429, after: "0", waited: 1 },
    {
      name: "an HTTP-date already past waits a millisecond",
      code: 502,
      after: new Date(NOW - 5_000).toUTCString(),
      waited: 1,
    },
    { name: "a 500 with no Retry-After waits the default", code: 500, waited: DEFAULT_RETRY_MS },
    {
      name: "a malformed Retry-After waits the default",
      code: 429,
      after: "soon",
      waited: DEFAULT_RETRY_MS,
    },
  ])("$name, then sends again (retry)", async ({ code, after, waited }) => {
    const headers: Record<string, string> = after === undefined ? {} : { "Retry-After": after };
    const { openRouter, asked, slept } = await client([
      status(code, JSON.stringify({ error: { message: "slow down" } }), headers),
      answer("kept"),
    ]);

    const turn = await openRouter.complete(REQUEST);

    expect(turn).toEqual(KEPT);
    expect(slept).toEqual([waited]);
    expect(asked).toHaveLength(2);
  });

  it("no headers within the header timeout is sent again after the default (retry)", async () => {
    const { openRouter, asked, slept } = await client(["hang", answer("kept")]);

    const turn = await openRouter.complete(REQUEST);

    expect(turn).toEqual(KEPT);
    expect(slept).toEqual([DEFAULT_RETRY_MS]);
    expect(asked).toHaveLength(2);
  });

  it.each([
    { name: "a stall after some text", pieces: [text("dropped "), "stall"] },
    { name: "keep-alive comments alone", pieces: comments },
    { name: "keep-alive comments after some text", pieces: [text("dropped "), ...comments] },
  ])(
    "no event within the chunk timeout, $name, is sent again after the default, and what streamed is dropped (retry)",
    async ({ pieces }) => {
      const { openRouter, asked, slept } = await client([stream(pieces), answer("kept")]);

      const turn = await openRouter.complete(REQUEST);

      expect(turn).toEqual(KEPT);
      expect(slept).toEqual([DEFAULT_RETRY_MS]);
      expect(asked).toHaveLength(2);
    },
  );

  it.each([
    { code: 429, then: answer("kept"), expected: KEPT },
    { code: 503, then: answer("kept"), expected: KEPT },
    { code: 401, then: status(401, JSON.stringify({ error: "bad key" })), expected: undefined },
  ])(
    "a $code whose body never arrives is sent again after the default, not its Retry-After (retry)",
    async ({ code, then, expected }) => {
      const { openRouter, asked, slept } = await client([
        stream(["stall"], { status: code, headers: { "Retry-After": "3" } }),
        then,
      ]);

      const turn = await openRouter.complete(REQUEST);

      if (expected === undefined) {
        expect(Fake.failure(turn, OpenRouter.OpenRouterRefused).message).toBe(
          "openrouter: 401: bad key",
        );
      } else {
        expect(turn).toEqual(expected);
      }
      expect(slept).toEqual([DEFAULT_RETRY_MS]);
      expect(asked).toHaveLength(2);
    },
  );

  it.each([
    {
      name: "a 502 on the stream",
      failure: event({ error: { message: "provider down", code: 502 } }),
    },
    {
      name: "a 503 written as digits",
      failure: event({ error: { message: "provider down", code: "503" } }),
    },
    {
      name: "a 429 on the choice",
      failure: event({
        choices: [{ delta: {}, error: { message: "rate limited", code: 429 } }],
      }),
    },
    {
      name: "a 503 after half a tool call",
      failure: `${call(0, { id: "call-1", function: { name: "client", arguments: '{"ar' } })}${event({ error: { message: "provider down", code: 503 } })}`,
    },
  ])(
    "$name is sent again after the default, and what streamed is dropped (retry)",
    async ({ failure }) => {
      const { openRouter, asked, slept } = await client([
        stream([text("dropped "), failure]),
        answer("kept"),
      ]);

      const turn = await openRouter.complete(REQUEST);

      expect(turn).toEqual(KEPT);
      expect(slept).toEqual([DEFAULT_RETRY_MS]);
      expect(asked).toHaveLength(2);
    },
  );

  it.each([
    {
      name: "a 400",
      failure: event({ error: { message: "context too long", code: 400 } }),
      said: "context too long",
    },
    {
      name: "a named code",
      failure: event({ error: { message: "flagged", code: "content_filter" } }),
      said: "flagged",
    },
    { name: "no code", failure: event({ error: { message: "oops" } }), said: "oops" },
    { name: "a bare string", failure: event({ error: "bare failure" }), said: "bare failure" },
    {
      name: "a 403 on the choice",
      failure: event({ choices: [{ delta: {}, error: { message: "denied", code: 403 } }] }),
      said: "denied",
    },
  ])(
    "an error on the stream with $name is unreachable with its message, and is not sent again (unhappy)",
    async ({ failure, said }) => {
      const { openRouter, asked, slept } = await client([
        stream([text("dropped "), failure]),
        answer("never"),
      ]);

      const turn = await openRouter.complete(REQUEST);

      expect(Fake.failure(turn, OpenRouter.OpenRouterUnreachable).message).toBe(
        `openrouter: ${said}`,
      );
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    { name: "midway", pieces: [text("Opening ")] },
    { name: "with only the done marker", pieces: [DONE] },
    { name: "with nothing", pieces: [] },
  ])(
    "a stream that closes before the completion, $name, is unreachable, and is not sent again (unhappy)",
    async ({ pieces }) => {
      const { openRouter, asked, slept } = await client([stream(pieces), answer("never")]);

      const turn = await openRouter.complete(REQUEST);

      expect(Fake.failure(turn, OpenRouter.OpenRouterUnreachable).message).toBe(
        "openrouter: stream ended before the completion",
      );
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    { name: "not JSON", pieces: ["data: {not json\n\n"], said: "openrouter: invalid response" },
    {
      name: "choices that are not a list",
      pieces: [event({ choices: "nope" })],
      said: "openrouter: invalid response",
    },
    {
      name: "a tool call at a negative index",
      pieces: [call(-1, { id: "call-1", function: { name: "client" } }), finish],
      said: "openrouter: invalid response",
    },
    {
      name: "a retry directive",
      pieces: ["retry: 1000\n\n", finish],
      said: "openrouter: invalid response",
    },
    {
      name: "a tool call with no id",
      pieces: [call(0, { function: { name: "client", arguments: "{}" } }), finish],
      said: "openrouter: a tool call has no id",
    },
    {
      name: "a tool call with no name",
      pieces: [call(0, { id: "call-1", function: { arguments: "{}" } }), finish],
      said: "openrouter: a tool call has no name",
    },
  ])(
    "a stream with $name is unreachable, and is not sent again (unhappy)",
    async ({ pieces, said }) => {
      const { openRouter, asked, slept } = await client([stream(pieces), answer("never")]);

      const turn = await openRouter.complete(REQUEST);

      expect(Fake.failure(turn, OpenRouter.OpenRouterUnreachable).message).toBe(said);
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    {
      name: "a Retry-After past it",
      reply: status(429, JSON.stringify({ error: "slow down" }), { "Retry-After": "120" }),
      deadline: NOW + 60_000,
      said: "openrouter: a retry in 120000 ms would reach the deadline: slow down",
    },
    {
      name: "a Retry-After that lands on it",
      reply: status(429, JSON.stringify({ error: "slow down" }), { "Retry-After": "60" }),
      deadline: NOW + 60_000,
      said: "openrouter: a retry in 60000 ms would reach the deadline: slow down",
    },
    {
      name: "the default after the header timeout",
      reply: "hang" as const,
      deadline: NOW + 500,
      said: "openrouter: a retry in 1000 ms would reach the deadline: no response within the header timeout",
    },
    {
      name: "the default after the chunk timeout",
      reply: stream([text("dropped "), "stall"]),
      deadline: NOW + 500,
      said: "openrouter: a retry in 1000 ms would reach the deadline: no event within the chunk timeout",
    },
    {
      name: "the default after a 502 on the stream",
      reply: stream([event({ error: { message: "provider down", code: 502 } })]),
      deadline: NOW + 500,
      said: "openrouter: a retry in 1000 ms would reach the deadline: provider down",
    },
  ])(
    "a retry whose wait reaches the deadline, $name, is out of time and is not sent (unhappy)",
    async ({ reply, deadline, said }) => {
      const { openRouter, asked, slept } = await client([reply, answer("never")]);

      const turn = await openRouter.complete({ ...REQUEST, deadline });

      expect(Fake.failure(turn, OpenRouter.OpenRouterOutOfTime).message).toBe(said);
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    { name: "waiting for headers", reply: "hang" as const, when: "later" as const },
    { name: "streaming", reply: stream([text("Opening "), "stall"]), when: "later" as const },
    { name: "waiting to send again", reply: status(503), when: "on sleep" as const },
  ])(
    "the caller's signal aborting while $name is Aborted, with the signal's reason (unhappy)",
    async ({ reply, when }) => {
      const controller = new AbortController();
      const stop = () => controller.abort(new Async.Aborted("stopping"));
      const { openRouter, asked } = await client(
        [reply, answer("never")],
        when === "on sleep" ? { onSleep: stop } : {},
      );
      if (when === "later") {
        setTimeout(stop, 10);
      }

      const turn = await openRouter.complete({ ...REQUEST, signal: controller.signal });

      expect(Fake.failure(turn, Async.Aborted).message).toBe("stopping");
      expect(asked).toHaveLength(1);
    },
  );
});
