import * as Async from "@oligarchy/async";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as OpenRouter from "../src/main.ts";
import { client, completion, DEFAULT_RETRY_MS, ENDPOINT, NOW, REQUEST, TOKEN } from "./support.ts";

const KEPT = jarl.ok({ content: "kept", toolCalls: [] });

const choice = (fields: Record<string, unknown>) => Fake.json({ choices: [fields] });

describe("complete", () => {
  it("the answer's text and tool calls come back as one turn, from the one request asked (happy)", async () => {
    const calls = [
      { id: "call-1", name: "client", arguments: '{"args":["get-image"]}' },
      { id: "call-2", name: "client", arguments: '{"args":["send-keys","super+l"]}' },
    ];
    const { openRouter, asked, slept } = await client(completion("Locking the screen", calls));

    const turn = await openRouter.complete(REQUEST);

    expect(turn).toEqual(jarl.ok({ content: "Locking the screen", toolCalls: calls }));
    expect(asked).toEqual([
      {
        url: ENDPOINT,
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: {
          model: REQUEST.model,
          messages: REQUEST.messages,
          tools: REQUEST.tools,
          reasoning: { effort: "low" },
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
      const { openRouter, asked, slept } = await client([
        Fake.status(code, body),
        completion("never"),
      ]);

      const turn = await openRouter.complete(REQUEST);

      const refused = Fake.failure(turn, OpenRouter.OpenRouterRefused);
      expect(refused.status).toBe(code);
      expect(refused.message).toBe(`openrouter: ${String(code)}: ${said}`);
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it("no connection is unreachable, and is not sent again (unhappy)", async () => {
    const { openRouter, asked, slept } = await client(["unreachable", completion("never")]);

    const turn = await openRouter.complete(REQUEST);

    const unreachable = Fake.failure(turn, OpenRouter.OpenRouterUnreachable);
    expect(unreachable.message).toBe(`openrouter: POST ${ENDPOINT}: fetch failed`);
    expect(String(unreachable)).not.toContain(TOKEN);
    expect(asked).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it.each([
    {
      name: "a 429 waits its Retry-After in seconds",
      reply: Fake.status(429, "", { "Retry-After": "3" }),
      waited: 3_000,
    },
    {
      name: "a 503 waits an HTTP-date Retry-After, read on the clock",
      reply: Fake.status(503, "busy", { "Retry-After": new Date(NOW + 5_000).toUTCString() }),
      waited: 5_000,
    },
    {
      name: "a Retry-After of zero waits a millisecond",
      reply: Fake.status(429, "", { "Retry-After": "0" }),
      waited: 1,
    },
    {
      name: "an HTTP-date already past waits a millisecond",
      reply: Fake.status(502, "", { "Retry-After": new Date(NOW - 5_000).toUTCString() }),
      waited: 1,
    },
    {
      name: "a 500 with no Retry-After waits the default",
      reply: Fake.status(500),
      waited: DEFAULT_RETRY_MS,
    },
    {
      name: "a malformed Retry-After waits the default",
      reply: Fake.status(429, "", { "Retry-After": "soon" }),
      waited: DEFAULT_RETRY_MS,
    },
    {
      name: "no answer within the timeout waits the default",
      reply: "hang" as const,
      waited: DEFAULT_RETRY_MS,
    },
  ])("$name, then asks again (retry)", async ({ reply, waited }) => {
    const { openRouter, asked, slept } = await client([reply, completion("kept")]);

    const turn = await openRouter.complete(REQUEST);

    expect(turn).toEqual(KEPT);
    expect(slept).toEqual([waited]);
    expect(asked).toHaveLength(2);
  });

  it.each([
    {
      name: "a 502 on the answer",
      reply: Fake.json({ error: { message: "provider down", code: 502 } }),
    },
    {
      name: "a 503 written as digits",
      reply: Fake.json({ error: { message: "provider down", code: "503" } }),
    },
    {
      name: "a 429 on its choice",
      reply: choice({ finish_reason: "error", error: { message: "rate limited", code: 429 } }),
    },
  ])(
    "a provider failure with $name is sent again after the default wait (retry)",
    async ({ reply }) => {
      const { openRouter, asked, slept } = await client([reply, completion("kept")]);

      const turn = await openRouter.complete(REQUEST);

      expect(turn).toEqual(KEPT);
      expect(slept).toEqual([DEFAULT_RETRY_MS]);
      expect(asked).toHaveLength(2);
    },
  );

  it.each([
    {
      name: "a 400",
      reply: Fake.json({ error: { message: "context too long", code: 400 } }),
      said: "context too long",
    },
    {
      name: "a named code",
      reply: Fake.json({ error: { message: "flagged", code: "content_filter" } }),
      said: "flagged",
    },
    { name: "no code", reply: Fake.json({ error: { message: "oops" } }), said: "oops" },
    { name: "a bare string", reply: Fake.json({ error: "bare failure" }), said: "bare failure" },
    {
      name: "a 403 on its choice",
      reply: choice({ error: { message: "denied", code: 403 } }),
      said: "denied",
    },
  ])(
    "a provider failure with $name is unreachable with its message, and is not sent again (unhappy)",
    async ({ reply, said }) => {
      const { openRouter, asked, slept } = await client([reply, completion("never")]);

      const turn = await openRouter.complete(REQUEST);

      expect(Fake.failure(turn, OpenRouter.OpenRouterUnreachable).message).toBe(
        `openrouter: ${said}`,
      );
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    {
      name: "a body that is not JSON",
      reply: Fake.status(200, "<html>"),
      said: "body is not JSON",
    },
    { name: "no choices", reply: Fake.json({ id: "gen-1" }), said: "not a completion" },
    {
      name: "an empty list of choices",
      reply: Fake.json({ choices: [] }),
      said: "not a completion",
    },
    {
      name: "a choice with no message",
      reply: choice({ finish_reason: "stop" }),
      said: "not a completion",
    },
    {
      name: "content that is not text",
      reply: choice({ message: { content: 7 } }),
      said: "not a completion",
    },
    {
      name: "a tool call with no id",
      reply: choice({
        message: { content: null, tool_calls: [{ function: { name: "client", arguments: "{}" } }] },
      }),
      said: "not a completion",
    },
    {
      name: "a tool call with no name",
      reply: choice({
        message: { content: null, tool_calls: [{ id: "call-1", function: { arguments: "{}" } }] },
      }),
      said: "not a completion",
    },
    {
      name: "a tool call whose arguments are not text",
      reply: choice({
        message: {
          content: null,
          tool_calls: [{ id: "call-1", function: { name: "client", arguments: {} } }],
        },
      }),
      said: "not a completion",
    },
  ])(
    "an answer with $name is unreachable, and is not sent again (unhappy)",
    async ({ reply, said }) => {
      const { openRouter, asked, slept } = await client([reply, completion("never")]);

      const turn = await openRouter.complete(REQUEST);

      expect(Fake.failure(turn, OpenRouter.OpenRouterUnreachable).message).toContain(
        `openrouter: POST ${ENDPOINT}: ${said}`,
      );
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    {
      name: "a Retry-After past it",
      reply: Fake.status(429, JSON.stringify({ error: "slow down" }), { "Retry-After": "120" }),
      deadline: NOW + 60_000,
      wait: 120_000,
      why: "slow down",
    },
    {
      name: "the default after a 429",
      reply: Fake.status(429, JSON.stringify({ error: "slow down" })),
      deadline: NOW + 500,
      wait: DEFAULT_RETRY_MS,
      why: "slow down",
    },
    {
      name: "the default landing on it",
      reply: Fake.status(429, JSON.stringify({ error: "slow down" })),
      deadline: NOW + DEFAULT_RETRY_MS,
      wait: DEFAULT_RETRY_MS,
      why: "slow down",
    },
    {
      name: "the default after no answer within the timeout",
      reply: "hang" as const,
      deadline: NOW + 500,
      wait: DEFAULT_RETRY_MS,
      why: `POST ${ENDPOINT}: no answer within 20 ms`,
    },
    {
      name: "the default after a provider failure",
      reply: Fake.json({ error: { message: "provider down", code: 502 } }),
      deadline: NOW + 500,
      wait: DEFAULT_RETRY_MS,
      why: "provider down",
    },
  ])(
    "a wait to ask again that reaches the deadline, $name, is out of time, and is not sent (unhappy)",
    async ({ reply, deadline, wait, why }) => {
      const { openRouter, asked, slept } = await client([reply, completion("never")]);

      const turn = await openRouter.complete({ ...REQUEST, deadline });

      expect(Fake.failure(turn, OpenRouter.OpenRouterOutOfTime).message).toBe(
        `openrouter: a retry in ${String(wait)} ms would reach the deadline: ${why}`,
      );
      expect(asked).toHaveLength(1);
      expect(slept).toEqual([]);
    },
  );

  it.each([
    { name: "waiting for the answer", reply: "hang" as const, when: "later" as const },
    { name: "waiting to ask again", reply: Fake.status(503), when: "on sleep" as const },
  ])(
    "the caller's signal aborting while $name is Aborted, with the signal's reason (unhappy)",
    async ({ reply, when }) => {
      const controller = new AbortController();
      const stop = () => controller.abort(new Async.Aborted("stopping"));
      const { openRouter } = await client(
        [reply, "hang"],
        when === "on sleep" ? { onSleep: stop } : {},
      );
      if (when === "later") {
        setTimeout(stop, 10);
      }

      const turn = await openRouter.complete({ ...REQUEST, signal: controller.signal });

      expect(Fake.failure(turn, Async.Aborted).message).toBe("stopping");
    },
  );
});
