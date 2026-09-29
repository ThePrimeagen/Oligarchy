import { readFileSync } from "node:fs";
import * as Async from "@oligarchy/async";
import * as Env from "@oligarchy/env";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import * as OpenRouter from "../src/main.ts";

export const TOKEN = "sk-or-s3cret";
export const BASE_URL = "https://openrouter.example/api/v1";
export const NOW = Date.UTC(2026, 8, 29, 12);
export const HEADER_MS = 20;
export const CHUNK_MS = 50;
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A number waits that many milliseconds before the next piece; "stall" holds the stream open with
// nothing more. Every other piece is sent as a chunk of its own, and the stream closes after the
// last one.
export type Piece = string | number | "stall";

export const stream = (pieces: ReadonlyArray<Piece>, init: ResponseInit = {}): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const piece of pieces) {
        if (piece === "stall") {
          return;
        }
        if (typeof piece === "number") {
          await pause(piece);
        } else {
          controller.enqueue(encoder.encode(piece));
        }
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
};

export const event = (data: unknown): string =>
  `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

export const DONE = "data: [DONE]\n\n";

export const KEEP_ALIVE = ": OPENROUTER PROCESSING\n\n";

export const text = (content: string): string => event({ choices: [{ delta: { content } }] });

export const finish = event({ choices: [{ delta: {}, finish_reason: "stop" }] });

// A whole completion of one line of text.
export const answer = (content: string): Response => stream([text(content), finish, DONE]);

export const status = (code: number, body = "", headers: Record<string, string> = {}) =>
  new Response(body === "" ? null : body, { status: code, headers });

// The client over a fake transport, on a clock stopped at NOW. A retry's wait is recorded and not
// slept; onSleep runs as each one starts.
export const client = async (
  replies: Fake.Reply | ReadonlyArray<Fake.Reply>,
  options: { readonly onSleep?: () => void } = {},
) => {
  const fake = Fake.http(replies);
  const slept: Array<number> = [];
  const openRouter = OpenRouter.create({
    token: await token(),
    baseUrl: BASE_URL,
    timeouts: { header: HEADER_MS, chunk: CHUNK_MS },
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
