import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
// What a printed error names. The query and fragment are dropped, as either can carry a secret.
export type Asked = { readonly method: string; readonly url: string };

// The most of a reply's body an error keeps, so one line can still be logged and reported.
const BODY_LIMIT = 1024;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const where = (asked: Asked): string => `${asked.method} ${asked.url}`;

export class HttpUnreachable extends jarl.error.define("HttpUnreachable") {
  readonly asked: Asked;
  override readonly cause: unknown;
  constructor(asked: Asked, cause: unknown) {
    super(`${where(asked)}: ${messageOf(cause)}`);
    this.asked = asked;
    this.cause = cause;
  }
}

export class HttpTimedOut extends jarl.error.define("HttpTimedOut") {
  readonly asked: Asked;
  constructor(asked: Asked, ms: number) {
    super(`${where(asked)}: no answer within ${String(ms)} ms`);
    this.asked = asked;
  }
}

const statusError = <const Name extends string>(name: Name) =>
  class extends jarl.error.define(name) {
    readonly asked: Asked;
    readonly status: number;
    readonly body: string;
    readonly headers: Headers;
    constructor(asked: Asked, status: number, body: string, headers: Headers) {
      const kept = body.slice(0, BODY_LIMIT);
      super(`${where(asked)}: ${String(status)}${kept === "" ? "" : `: ${kept}`}`);
      this.asked = asked;
      this.status = status;
      this.body = kept;
      this.headers = headers;
    }
  };

export const HttpBadRequest = statusError("HttpBadRequest");
export type HttpBadRequest = InstanceType<typeof HttpBadRequest>;
export const HttpNotFound = statusError("HttpNotFound");
export type HttpNotFound = InstanceType<typeof HttpNotFound>;
// Any 5xx.
export const HttpServerError = statusError("HttpServerError");
export type HttpServerError = InstanceType<typeof HttpServerError>;
// A status the call did not name and no default covers.
export const HttpUnhandled = statusError("HttpUnhandled");
export type HttpUnhandled = InstanceType<typeof HttpUnhandled>;

// A 2xx body that is not JSON, or that decode refused. A decode builds one with its reason
// alone; fetch hands it back naming what was asked.
export class HttpInvalid extends jarl.error.define("HttpInvalid") {
  readonly reason: string;
  readonly asked: Asked | undefined;
  override readonly cause: unknown;
  constructor(reason: string, options: { readonly asked?: Asked; readonly cause?: unknown } = {}) {
    super(options.asked === undefined ? reason : `${where(options.asked)}: ${reason}`);
    this.reason = reason;
    this.asked = options.asked;
    this.cause = options.cause;
  }
}

export type HttpFailure =
  | HttpUnreachable
  | HttpTimedOut
  | HttpBadRequest
  | HttpNotFound
  | HttpServerError
  | HttpUnhandled
  | HttpInvalid
  | Async.Aborted;

// Asking again could answer.
export const retryable = (error: HttpFailure): boolean =>
  jarl.error.is(error, HttpUnreachable) ||
  jarl.error.is(error, HttpTimedOut) ||
  jarl.error.is(error, HttpServerError) ||
  (jarl.error.is(error, HttpUnhandled) && error.status === 429);
