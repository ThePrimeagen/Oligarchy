// A fake transport for tests: Http as create makes it, answering from replies instead of the
// network, and recording each request it was asked.
import * as jarl from "jarl";
import * as Http from "./main.ts";

// "unreachable" throws as fetch does on no connection; "hang" answers only when the request's
// signal aborts, as fetch does, so a timeout or the caller's abort ends it.
export type Reply = Response | "unreachable" | "hang";

export type Asked = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  // The request's body, parsed when it is JSON.
  readonly body: unknown;
};

// One reply for every request, one per request in order, or one made from the request.
type Replies = Reply | ReadonlyArray<Reply> | ((asked: Asked) => Reply | Promise<Reply>);

export const json = (
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

export const status = (
  code: number,
  body = "",
  headers: Readonly<Record<string, string>> = {},
): Response => new Response(body === "" ? null : body, { status: code, headers });

const NEVER = new AbortController().signal;

const hang = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const bodyOf = (body: RequestInit["body"]): unknown => {
  if (typeof body !== "string") {
    return body ?? undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

export const http = (
  replies: Replies,
  options: { readonly timeoutMs?: number } = {},
): { readonly http: Http.Http; readonly asked: ReadonlyArray<Asked> } => {
  const asked: Array<Asked> = [];

  const replyTo = (one: Asked): Reply | Promise<Reply> => {
    if (typeof replies === "string" || replies instanceof Response) {
      return replies;
    }
    if (typeof replies === "function") {
      return replies(one);
    }
    const reply = replies[asked.length - 1];
    if (reply === undefined) {
      throw new Error(`fake http: no reply for request ${String(asked.length)}`);
    }
    return reply;
  };

  const fetch: Http.Fetch = async (url, init) => {
    const one: Asked = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: bodyOf(init.body),
    };
    asked.push(one);
    const reply = await replyTo(one);
    if (reply === "unreachable") {
      throw new TypeError("fetch failed");
    }
    if (reply === "hang") {
      return hang(init.signal ?? NEVER);
    }
    return reply.clone();
  };

  return { http: Http.create({ fetch, ...options }), asked };
};

// The error result failed with, when it is one of error; throws otherwise, saying what came.
export const failure = <C>(
  result: jarl.Result<unknown, unknown>,
  error: abstract new (...args: never[]) => C,
): C => {
  if (jarl.is_err(result) && result.error instanceof error) {
    return result.error;
  }
  const came = jarl.is_ok(result)
    ? `ok ${JSON.stringify(jarl.value(result))}`
    : String(result.error);
  throw new Error(`expected a ${error.name} failure, got ${came}`);
};
