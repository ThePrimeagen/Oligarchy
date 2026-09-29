import { readFileSync } from "node:fs";
import * as Async from "@oligarchy/async";
import * as Env from "@oligarchy/env";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import * as OpenRouter from "../src/main.ts";

export const TOKEN = "sk-or-s3cret";
export const BASE_URL = "https://openrouter.example/api/v1";
export const ENDPOINT = `${BASE_URL}/chat/completions`;
export const NOW = Date.UTC(2026, 8, 29, 12);
export const TIMEOUT_MS = 20;
export const DEFAULT_RETRY_MS = 1_000;

export const REQUEST: OpenRouter.Request = {
  model: "moonshotai/kimi-k2",
  messages: [
    { role: "system", content: "You drive a guest." },
    {
      role: "user",
      content: [
        { type: "text", text: "Lock the screen." },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "client",
        description: "The guest's controls",
        parameters: { type: "object" },
      },
    },
  ],
  reasoning: "low",
  deadline: NOW + 60_000,
};

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const token = async () =>
  jarl.unwrap(
    await Env.create(
      Env.cli({ name: "openrouter-test", description: "" }).needs("openRouterToken").done(),
      Env.fakeIo({ env: { OPENROUTER_API_KEY: TOKEN }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  ).vars.openRouterToken;

// OpenRouter's answer: the assistant's message, with its tool calls when it made any.
export const completion = (
  content: string | null,
  toolCalls: ReadonlyArray<OpenRouter.ToolCall> = [],
): Response =>
  Fake.json({
    id: "gen-1",
    choices: [
      {
        finish_reason: toolCalls.length === 0 ? "stop" : "tool_calls",
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length === 0
            ? {}
            : {
                tool_calls: toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.arguments },
                })),
              }),
        },
      },
    ],
  });

// The client over a fake transport, on a clock stopped at NOW. A wait to ask again is recorded
// and not slept; onSleep runs as each one starts.
export const client = async (
  replies: Fake.Reply | ReadonlyArray<Fake.Reply>,
  options: { readonly onSleep?: () => void } = {},
) => {
  const fake = Fake.http(replies);
  const slept: Array<number> = [];
  const openRouter = OpenRouter.create({
    token: await token(),
    baseUrl: BASE_URL,
    timeoutMs: TIMEOUT_MS,
    defaultRetry: DEFAULT_RETRY_MS,
    http: fake.http,
    now: () => NOW,
    sleep: (ms, signal) => {
      slept.push(ms);
      options.onSleep?.();
      return Async.sleep(0, signal);
    },
  });
  return { openRouter, asked: fake.asked, slept };
};
