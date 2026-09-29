import type * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as z from "zod";
import * as Completion from "./completion.ts";
import * as Errors from "./errors.ts";
import * as Sse from "./sse.ts";

export { OpenRouterOutOfTime, OpenRouterRefused, OpenRouterUnreachable } from "./errors.ts";
export type { ToolCall, Turn } from "./completion.ts";

export type Part =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

export type WireToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
};

export type Message =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | ReadonlyArray<Part> }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: ReadonlyArray<WireToolCall>;
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export type Tool = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
};

export type Effort = Env.Config["reasoning"]["drive"];

export type Request = {
  readonly model: string;
  readonly messages: ReadonlyArray<Message>;
  readonly tools: ReadonlyArray<Tool>;
  readonly reasoning: Effort;
  // On the client's clock: no retry waits up to it. The run's ceiling.
  readonly deadline: number;
  readonly signal?: AbortSignal;
};

export type Failure =
  | Errors.OpenRouterRefused
  | Errors.OpenRouterUnreachable
  | Errors.OpenRouterOutOfTime
  | Async.Aborted;

export type Sleep = (ms: number, signal: AbortSignal) => Promise<jarl.Result<void, Async.Aborted>>;

export type OpenRouter = {
  readonly service: "openRouter";
  readonly complete: (request: Request) => Promise<jarl.Result<Completion.Turn, Failure>>;
};

declare module "@oligarchy/app" {
  interface Services {
    openRouter: App.Register<"openRouter", OpenRouter>;
  }
}

// A failure asking again could mend, and the wait before asking.
type Again = { readonly again: true; readonly waitMs: number; readonly why: string };

type Attempt = jarl.Result<Completion.Turn, Failure> | Again;

// How a body read ended: its end, the reader stopping it, the wait for progress running out, the
// caller's signal, or the body failing.
type Ended = "end" | "stopped" | "idle" | "aborted" | { readonly broken: unknown };

// The reader's word on each piece of text: carry on, carry on and restart the wait, or stop.
type Heard = "more" | "progress" | "stop";

const NEVER = new AbortController().signal;

const WireError = z.object({
  error: z.union([z.string(), z.object({ message: z.string() })]),
});

const abortedBy = (signal: AbortSignal): Async.Aborted =>
  jarl.error.is(signal.reason, Async.Aborted) ? signal.reason : new Async.Aborted("aborted");

const retryable = (status: number): boolean =>
  status === 429 || (Number.isInteger(status) && status >= 500 && status < 600);

const chatCompletions = (baseUrl: string): string =>
  new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

// The body's `error` when it is OpenRouter's shape, the body as it came otherwise.
const refusalMessage = (text: string): string => {
  if (text === "") {
    return "request failed";
  }
  const parsed = Completion.parseJson(text);
  const wire = WireError.safeParse(jarl.is_ok(parsed) ? jarl.value(parsed) : undefined);
  if (!wire.success) {
    return text;
  }
  const { error } = wire.data;
  return typeof error === "string" ? error : error.message;
};

// Reads text off body until the reader stops or the body ends. A wait for progress longer than ms
// ends it idle; the reader restarts that wait by answering "progress".
const read = async (
  body: ReadableStream<Uint8Array> | null,
  ms: number,
  signal: AbortSignal,
  hear: (text: string) => Heard,
): Promise<Ended> => {
  if (body === null) {
    hear("");
    return "end";
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let ended: "idle" | "aborted" | undefined;
  const end = (why: "idle" | "aborted") => {
    ended ??= why;
    reader.cancel().catch(() => undefined);
  };
  let timer = setTimeout(() => end("idle"), ms);
  const abort = () => end("aborted");
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (caught) {
        return ended ?? { broken: caught };
      }
      if (ended !== undefined) {
        return ended;
      }
      const text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      const heard = hear(text);
      if (heard === "stop") {
        reader.cancel().catch(() => undefined);
        return "stopped";
      }
      if (chunk.done) {
        return "end";
      }
      if (heard === "progress") {
        clearTimeout(timer);
        timer = setTimeout(() => end("idle"), ms);
      }
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
};

// One streaming chat completion. The header timeout is the wait for the status line; the chunk
// timeout is the wait for the next event, or for the next piece of a body that is not a stream.
// OpenRouter holds a stream open with comment lines while the provider has not answered, so a
// comment is no event. A 429 or 5xx is asked again after the Retry-After it names, or the default
// when it names none; either timeout, and a 429 or 5xx reported inside the stream, after the
// default. A completion has no side effect but its cost, so asking again is safe; a stream that
// closes early is not asked again, since a provider cutting every answer short would be paid for
// every time. A wait that would reach the request's deadline is not waited.
export const create = (options: {
  readonly token: Env.Secret;
  readonly baseUrl: string;
  readonly timeouts: { readonly header: number; readonly chunk: number };
  readonly defaultRetry: number;
  readonly http: Http.Http;
  readonly now?: () => number;
  readonly sleep?: Sleep;
}): OpenRouter => {
  const { token, timeouts, defaultRetry, http } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Async.sleep;
  const url = chatCompletions(options.baseUrl);

  const again = (waitMs: number, why: string): Again => ({ again: true, waitMs, why });

  // Seconds, or an HTTP-date on the client's clock. Zero, or a date already past, waits a
  // millisecond; a missing or malformed header waits the default.
  const retryAfter = (header: string | null): number => {
    if (header === null) {
      return defaultRetry;
    }
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) {
      return Math.max(Number(trimmed) * 1_000, 1);
    }
    const at = Date.parse(trimmed);
    return Number.isNaN(at) ? defaultRetry : Math.max(at - now(), 1);
  };

  const readText = async (
    response: Response,
    signal: AbortSignal,
  ): Promise<jarl.Result<string, Failure> | Again> => {
    let text = "";
    const ended = await read(response.body, timeouts.chunk, signal, (piece) => {
      text = `${text}${piece}`;
      return "progress";
    });
    if (ended === "end" || ended === "stopped") {
      return jarl.ok(text);
    }
    if (ended === "idle") {
      return again(defaultRetry, "no body within the chunk timeout");
    }
    if (ended === "aborted") {
      return jarl.err(abortedBy(signal));
    }
    return jarl.err(Errors.unreachable("openrouter: invalid response", ended.broken));
  };

  const judge = (
    step: Completion.Step,
    completion: ReturnType<typeof Completion.fold>,
  ): Attempt => {
    if (step.kind === "failed") {
      return step.status !== undefined && retryable(step.status)
        ? again(defaultRetry, step.message)
        : jarl.err(Errors.unreachable(`openrouter: ${step.message}`));
    }
    if (step.kind === "invalid") {
      return jarl.err(Errors.unreachable("openrouter: invalid response", step.cause));
    }
    return completion.turn();
  };

  const readTurn = async (response: Response, signal: AbortSignal): Promise<Attempt> => {
    const events = Sse.parser();
    const completion = Completion.fold();
    let last: Completion.Step | undefined;
    const ended = await read(response.body, timeouts.chunk, signal, (text) => {
      const heard = events.feed(text);
      for (const event of heard) {
        last =
          event.kind === "retry"
            ? { kind: "invalid", cause: "a retry directive" }
            : completion.apply(event.data);
        if (last.kind !== "more") {
          return "stop";
        }
      }
      return heard.length > 0 ? "progress" : "more";
    });
    if (ended === "stopped" && last !== undefined) {
      return judge(last, completion);
    }
    if (ended === "idle") {
      return again(defaultRetry, "no event within the chunk timeout");
    }
    if (ended === "aborted") {
      return jarl.err(abortedBy(signal));
    }
    if (typeof ended === "object") {
      return jarl.err(Errors.unreachable("openrouter: invalid response", ended.broken));
    }
    return jarl.err(Errors.unreachable("openrouter: stream ended before the completion"));
  };

  const attempt = async (request: Request, signal: AbortSignal): Promise<Attempt> => {
    const opened = await http.open(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.reveal()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        reasoning: { effort: request.reasoning },
        stream: true,
      }),
      timeoutMs: timeouts.header,
      signal,
    });
    if (jarl.is_err(opened)) {
      const { error } = opened;
      if (jarl.error.is(error, Http.HttpTimedOut)) {
        return again(defaultRetry, "no response within the header timeout");
      }
      if (jarl.error.is(error, Http.HttpUnreachable)) {
        return jarl.err(Errors.unreachable(`openrouter: ${error.message}`, error));
      }
      return jarl.err(error);
    }
    const response = jarl.value(opened);
    if (response.status >= 200 && response.status < 300) {
      return readTurn(response, signal);
    }
    const body = await readText(response, signal);
    if ("again" in body || jarl.is_err(body)) {
      return body;
    }
    const message = refusalMessage(jarl.value(body));
    return retryable(response.status)
      ? again(retryAfter(response.headers.get("retry-after")), message)
      : jarl.err(new Errors.OpenRouterRefused(response.status, message));
  };

  return {
    service: "openRouter",
    complete: async (request) => {
      const signal = request.signal ?? NEVER;
      for (;;) {
        const answered = await attempt(request, signal);
        if (!("again" in answered)) {
          return answered;
        }
        if (now() + answered.waitMs >= request.deadline) {
          return jarl.err(
            new Errors.OpenRouterOutOfTime(
              `openrouter: a retry in ${String(answered.waitMs)} ms would reach the deadline: ${answered.why}`,
            ),
          );
        }
        const slept = await sleep(answered.waitMs, signal);
        if (jarl.is_err(slept)) {
          return slept;
        }
      }
    },
  };
};
