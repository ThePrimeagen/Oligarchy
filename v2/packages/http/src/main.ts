import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import { opening } from "./stream.ts";
export { body } from "./stream.ts";
export type { HttpResponse } from "./stream.ts";

// `timeout: false` turns off Bun's own fetch limit, which ends any request unanswered after about
// six minutes whatever its timeoutMs; every deadline here is timeoutMs's.
export type Fetch = (
  url: string,
  init: RequestInit & { readonly timeout?: false },
) => Promise<Response>;

export * from "./failure.ts";
import {
  HttpUnreachable,
  HttpTimedOut,
  HttpBadRequest,
  HttpNotFound,
  HttpServerError,
  HttpUnhandled,
  HttpInvalid,
  type HttpFailure,
  type Asked,
} from "./failure.ts";
const TIMEOUT_MS = 10_000;
const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
// The statuses every call already answers: a 2xx goes to decode, the rest have their own error.
type Reserved = "400" | "404" | `2${Digit}${Digit}` | `5${Digit}${Digit}`;

// How a 2xx body reaches decode: parsed as JSON, or its bytes as they came.
type Read = "json" | "bytes";
type Body<R extends Read> = R extends "bytes" ? Uint8Array : unknown;
type Decode<R extends Read> = (body: Body<R>) => jarl.Result<unknown, unknown>;
// A handler is handed the response's headers beside its body, as the status errors carry them.
type Statuses = { readonly [code: number]: (body: string, headers: Headers) => Error };
type Checked<S> = {
  readonly [K in keyof S]: `${K & (string | number)}` extends Reserved ? never : S[K];
};

type ValueOf<R> = R extends { readonly ok: true; readonly value: infer T } ? T : never;
type ErrorOf<R> = R extends { readonly ok: false; readonly error: infer E } ? E : never;
type Raised<F> = F extends (body: string, headers: Headers) => infer E ? E : never;

export type Init = RequestInit & { readonly timeoutMs?: number };

type Failed<D extends (body: never) => jarl.Result<unknown, unknown>, S extends Statuses> =
  | ErrorOf<ReturnType<D>>
  | Raised<S[keyof S]>
  | HttpFailure;

// The answer is spelled as jarl.Result, not through an alias of this package's own, so a
// generic taking a result (Async.repeat) infers every error of it rather than one. Read as
// bytes, a 2xx body goes to decode as it came, not parsed: an image, a console's output.
export type Http = {
  readonly service: "http";
  readonly open: ReturnType<typeof opening>;
  readonly fetch: <
    D extends Decode<R>,
    S extends Statuses = Record<never, never>,
    R extends Read = "json",
  >(
    url: string,
    init: Init,
    answers: { readonly read?: R; readonly decode: D; readonly status?: Checked<S> },
  ) => Promise<jarl.Result<ValueOf<ReturnType<D>>, Failed<D, S>>>;
};

declare module "@oligarchy/app" {
  interface Services {
    http: App.Register<"http", Http>;
  }
}

const NEVER = new AbortController().signal;
const UTF8 = new TextDecoder();

const abortedBy = (signal: AbortSignal): Async.Aborted =>
  jarl.error.is(signal.reason, Async.Aborted) ? signal.reason : new Async.Aborted("aborted");

const printable = (url: string): string => url.split(/[?#]/, 1)[0] ?? url;

const parsed = (text: string, asked: Asked): jarl.Result<unknown, HttpInvalid> => {
  if (text === "") {
    return jarl.ok(undefined);
  }
  try {
    return jarl.ok(JSON.parse(text));
  } catch (caught) {
    return jarl.err(
      new HttpInvalid(`body is not JSON: ${messageOf(caught)}`, { asked, cause: caught }),
    );
  }
};

export type Options = { readonly fetch?: Fetch; readonly timeoutMs?: number };

export const create = App.createService<never, Options, Http>((_, options) => {
  const send = options.fetch ?? fetch;
  const defaultMs = options.timeoutMs ?? TIMEOUT_MS;

  // The signature Http gives fetch, over a body that sees only unknown values and errors.
  function request<
    D extends Decode<R>,
    S extends Statuses = Record<never, never>,
    R extends Read = "json",
  >(
    url: string,
    init: Init,
    answers: { readonly read?: R; readonly decode: D; readonly status?: Checked<S> },
  ): Promise<jarl.Result<ValueOf<ReturnType<D>>, Failed<D, S>>>;
  async function request(
    url: string,
    init: Init,
    answers:
      | { readonly read?: "json"; readonly decode: Decode<"json">; readonly status?: Statuses }
      | { readonly read: "bytes"; readonly decode: Decode<"bytes">; readonly status?: Statuses },
  ): Promise<jarl.Result<unknown, unknown>> {
    const { timeoutMs = defaultMs, signal, ...rest } = init;
    const outer = signal ?? NEVER;
    const asked: Asked = { method: (rest.method ?? "GET").toUpperCase(), url: printable(url) };

    const exchange = async (
      inner: AbortSignal,
    ): Promise<
      jarl.Result<
        { status: number; bytes: Uint8Array; headers: Headers },
        HttpUnreachable | Async.Aborted
      >
    > =>
      jarl.exec(
        async () => {
          const response = await send(url, { ...rest, timeout: false, signal: inner });
          return {
            status: response.status,
            bytes: new Uint8Array(await response.arrayBuffer()),
            headers: response.headers,
          };
        },
        (caught) => (outer.aborted ? abortedBy(outer) : new HttpUnreachable(asked, caught)),
      );

    const answered = await Async.timeout(exchange, { ms: timeoutMs, signal: outer });
    if (jarl.error.is(answered, Async.TimedOut)) {
      return jarl.err(new HttpTimedOut(asked, timeoutMs));
    }
    if (!answered.ok) {
      return answered;
    }
    const { status, bytes, headers } = jarl.value(answered);

    if (status >= 200 && status < 300) {
      let decoded: jarl.Result<unknown, unknown>;
      if (answers.read === "bytes") {
        decoded = answers.decode(bytes);
      } else {
        const body = parsed(UTF8.decode(bytes), asked);
        if (!body.ok) {
          return body;
        }
        decoded = answers.decode(jarl.value(body));
      }
      if (jarl.error.is(decoded, HttpInvalid)) {
        const { reason, cause } = decoded.error;
        return jarl.err(new HttpInvalid(reason, { asked, cause }));
      }
      return decoded;
    }
    const text = UTF8.decode(bytes);
    if (status === 400) {
      return jarl.err(new HttpBadRequest(asked, status, text, headers));
    }
    if (status === 404) {
      return jarl.err(new HttpNotFound(asked, status, text, headers));
    }
    if (status >= 500 && status < 600) {
      return jarl.err(new HttpServerError(asked, status, text, headers));
    }
    const named = answers.status?.[status];
    return jarl.err(
      named === undefined ? new HttpUnhandled(asked, status, text, headers) : named(text, headers),
    );
  }

  return { service: "http", fetch: request, open: opening(send, defaultMs) };
});
