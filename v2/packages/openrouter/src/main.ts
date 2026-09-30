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

export type OpenRouter = {
  readonly service: "openRouter";
  readonly complete: (request: Request) => Promise<jarl.Result<Completion.Turn, Failure>>;
};

declare module "@oligarchy/app" {
  interface Services {
    openRouter: App.Register<"openRouter", OpenRouter>;
  }
}

type Asked = Http.HttpFailure | Completion.ProviderFailed | Errors.RateLimited;

// How long to wait before asking again, and why asking again was needed.
type Again = { readonly waitMs: number; readonly why: string };

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

// A failure asking again will not mend, as the client names it.
const failure = (error: Asked): Failure => {
  if (jarl.error.is(error, Async.Aborted)) {
    return error;
  }
  if (
    jarl.error.is(error, Http.HttpUnhandled) ||
    jarl.error.is(error, Http.HttpBadRequest) ||
    jarl.error.is(error, Http.HttpNotFound)
  ) {
    return new Errors.OpenRouterRefused(error.status, refusalMessage(error.body));
  }
  if (jarl.error.is(error, Completion.ProviderFailed)) {
    return Errors.unreachable(`openrouter: ${error.message}`);
  }
  return Errors.unreachable(`openrouter: ${error.message}`, error);
};

// One chat completion, asked once and read whole. timeoutMs bounds each ask; attempts is the
// most asks in all, the first included, however long each wait. A wait to ask again that would
// reach the request's deadline is not waited.
export const create = (options: {
  readonly token: Env.Secret;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly defaultRetry: number;
  readonly attempts: number;
  readonly http: Http.Http;
}): OpenRouter => {
  const { token, timeoutMs, defaultRetry, attempts, http } = options;
  const url = chatCompletions(options.baseUrl);

  // Seconds, or an HTTP-date on the clock. Zero, or a date already past, waits a millisecond; a
  // missing or malformed Retry-After waits the default.
  const waitAfter = (retryAfter: string | null): number => {
    const header = retryAfter?.trim();
    if (header === undefined) {
      return defaultRetry;
    }
    if (/^\d+$/.test(header)) {
      return Math.max(Number(header) * 1_000, 1);
    }
    const at = Date.parse(header);
    return Number.isNaN(at) ? defaultRetry : Math.max(at - Date.now(), 1);
  };

  // Asking again is for what could mend: a 429 or 5xx after the Retry-After it names, and no
  // answer in time or a provider failure naming one of those statuses after the default. A
  // completion has no side effect but its cost, so asking again is safe.
  const again = (error: Asked): Again | undefined => {
    if (jarl.error.is(error, Errors.RateLimited)) {
      return { waitMs: waitAfter(error.retryAfter), why: error.message };
    }
    if (jarl.error.is(error, Http.HttpServerError)) {
      return {
        waitMs: waitAfter(error.headers.get("retry-after")),
        why: refusalMessage(error.body),
      };
    }
    if (jarl.error.is(error, Http.HttpTimedOut)) {
      return { waitMs: defaultRetry, why: error.message };
    }
    if (
      jarl.error.is(error, Completion.ProviderFailed) &&
      error.status !== undefined &&
      retryable(error.status)
    ) {
      return { waitMs: defaultRetry, why: error.message };
    }
    return undefined;
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
      {
        decode: Completion.decode,
        status: {
          429: (body, headers) =>
            new Errors.RateLimited(refusalMessage(body), headers.get("retry-after")),
        },
      },
    );

  const fits = (next: Again, deadline: number): boolean => Date.now() + next.waitMs < deadline;

  return {
    service: "openRouter",
    complete: async (request) => {
      const signal = request.signal ?? NEVER;
      const answered = await Async.repeat(() => ask(request, signal), attempts, {
        retry: (error) => {
          const next = again(error);
          return next !== undefined && fits(next, request.deadline)
            ? { retry: true, delay: next.waitMs }
            : { retry: false };
        },
        signal,
      })();
      if (jarl.is_ok(answered)) {
        return answered;
      }
      const { error } = answered;
      const next = again(error);
      if (next === undefined) {
        return jarl.err(failure(error));
      }
      return jarl.err(
        fits(next, request.deadline)
          ? Errors.unreachable(`openrouter: asked ${String(attempts)} times: ${next.why}`)
          : new Errors.OpenRouterOutOfTime(
              `openrouter: a retry in ${String(next.waitMs)} ms would reach the deadline: ${next.why}`,
            ),
      );
    },
  };
};
