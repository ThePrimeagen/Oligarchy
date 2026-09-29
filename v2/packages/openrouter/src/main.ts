import type * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as z from "zod";
import * as Completion from "./completion.ts";
import * as Errors from "./errors.ts";

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
  // On the client's clock: no wait to ask again reaches it. The run's ceiling.
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

type Asked = Http.HttpFailure | Completion.ProviderFailed;

const NEVER = new AbortController().signal;

const WireError = z.object({
  error: z.union([z.string(), z.object({ message: z.string() })]),
});

const retryable = (status: number): boolean => status === 429 || (status >= 500 && status < 600);

const chatCompletions = (baseUrl: string): string =>
  new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// The body's `error` when it is OpenRouter's shape, the body as it came otherwise.
const refusalMessage = (body: string): string => {
  if (body === "") {
    return "request failed";
  }
  const wire = WireError.safeParse(parseJson(body));
  if (!wire.success) {
    return body;
  }
  const { error } = wire.data;
  return typeof error === "string" ? error : error.message;
};

// Why to ask again, and for a 429 or 5xx the response's headers, whose Retry-After is the wait.
type Again = { readonly again: string; readonly headers?: Headers };

// Asking again is for what could mend: a 429, a 5xx, no answer in time, or a provider failure
// naming one of those statuses. A completion has no side effect but its cost, so asking again is
// safe; anything else is the failure handed back.
const judge = (error: Asked): Again | Failure => {
  if (jarl.error.is(error, Http.HttpServerError)) {
    return { again: refusalMessage(error.body), headers: error.headers };
  }
  if (jarl.error.is(error, Http.HttpTimedOut)) {
    return { again: error.message };
  }
  if (jarl.error.is(error, Completion.ProviderFailed)) {
    return error.status !== undefined && retryable(error.status)
      ? { again: error.message }
      : Errors.unreachable(`openrouter: ${error.message}`);
  }
  if (jarl.error.is(error, Http.HttpUnhandled) && error.status === 429) {
    return { again: refusalMessage(error.body), headers: error.headers };
  }
  if (
    jarl.error.is(error, Http.HttpUnhandled) ||
    jarl.error.is(error, Http.HttpBadRequest) ||
    jarl.error.is(error, Http.HttpNotFound)
  ) {
    return new Errors.OpenRouterRefused(error.status, refusalMessage(error.body));
  }
  if (jarl.error.is(error, Async.Aborted)) {
    return error;
  }
  return Errors.unreachable(`openrouter: ${error.message}`, error);
};

// One chat completion, asked once and read whole. timeoutMs bounds each ask. A wait to ask again
// is a 429's or 5xx's Retry-After, or else the default; one that would reach the request's
// deadline is not waited.
export const create = (options: {
  readonly token: Env.Secret;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly defaultRetry: number;
  readonly http: Http.Http;
  readonly now?: () => number;
  readonly sleep?: Sleep;
}): OpenRouter => {
  const { token, timeoutMs, defaultRetry, http } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Async.sleep;
  const url = chatCompletions(options.baseUrl);

  // Seconds, or an HTTP-date on the client's clock. Zero, or a date already past, waits a
  // millisecond; a missing or malformed Retry-After waits the default.
  const waitFor = (again: Again): number => {
    const header = again.headers?.get("retry-after")?.trim();
    if (header === undefined) {
      return defaultRetry;
    }
    if (/^\d+$/.test(header)) {
      return Math.max(Number(header) * 1_000, 1);
    }
    const at = Date.parse(header);
    return Number.isNaN(at) ? defaultRetry : Math.max(at - now(), 1);
  };

  const ask = (request: Request, signal: AbortSignal) =>
    http.fetch(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token.reveal()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          tools: request.tools,
          reasoning: { effort: request.reasoning },
        }),
        timeoutMs,
        signal,
      },
      { decode: Completion.decode },
    );

  return {
    service: "openRouter",
    complete: async (request) => {
      const signal = request.signal ?? NEVER;
      for (;;) {
        const answered = await ask(request, signal);
        if (jarl.is_ok(answered)) {
          return answered;
        }
        const judged = judge(answered.error);
        if (!("again" in judged)) {
          return jarl.err(judged);
        }
        const waitMs = waitFor(judged);
        if (now() + waitMs >= request.deadline) {
          return jarl.err(
            new Errors.OpenRouterOutOfTime(
              `openrouter: a retry in ${String(waitMs)} ms would reach the deadline: ${judged.again}`,
            ),
          );
        }
        const slept = await sleep(waitMs, signal);
        if (jarl.is_err(slept)) {
          return slept;
        }
      }
    },
  };
};
