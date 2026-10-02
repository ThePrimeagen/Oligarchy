import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import { prepare } from "./request.ts";
import { decode } from "./response.ts";
import type { DecisionApi, Failure, Options, Questions, Request, Response } from "./types.ts";

export type {
  Answer,
  ChoiceAnswer,
  Content,
  DecisionApi,
  Failure,
  Image,
  ImageType,
  Json,
  Level,
  Model,
  NoulAnswer,
  Options,
  Question,
  Questions,
  Request,
  Response,
  ScoreAnswer,
} from "./types.ts";
export {
  InvalidRequest,
  InvalidResponse,
  RateLimited,
  Refused,
  TimedOut,
  Unavailable,
} from "./errors.ts";

declare module "@oligarchy/app" {
  interface Services {
    "decision-api": App.Register<"decision-api", DecisionApi>;
  }
}

const failure = (error: Http.HttpFailure | Failure): Failure => {
  if (jarl.error.is(error, Http.HttpTimedOut)) return new Errors.TimedOut(error.message);
  if (jarl.error.is(error, Http.HttpUnreachable)) return new Errors.Unavailable(error.message);
  if (jarl.error.is(error, Http.HttpInvalid)) return new Errors.InvalidResponse(error.reason);
  if (
    jarl.error.is(error, Http.HttpBadRequest) ||
    jarl.error.is(error, Http.HttpNotFound) ||
    jarl.error.is(error, Http.HttpServerError) ||
    jarl.error.is(error, Http.HttpUnhandled)
  ) {
    return Errors.providerFailure(
      Errors.parseBody(error.body),
      error.status,
      error.headers.get("retry-after") ?? undefined,
    );
  }
  return error;
};

export const create = App.createService<Http.Http, Options, DecisionApi>(({ http }, options) => {
  function decide<const Q extends Questions>(
    request: Request<Q>,
  ): Promise<jarl.Result<Response<Q>, Failure>>;
  async function decide(request: Request): Promise<jarl.Result<Response, Failure>> {
    if (request.signal?.aborted) {
      const reason: unknown = request.signal.reason;
      return jarl.err(jarl.error.is(reason, Async.Aborted) ? reason : new Async.Aborted("aborted"));
    }
    const prepared = prepare(request, options);
    if (jarl.is_err(prepared)) return prepared;
    const input = jarl.value(prepared);
    const result = await http.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/ai/run/@cf/cloudflare/${input.model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token.reveal()}`,
          "Content-Type": "application/json",
        },
        body: input.body,
        timeoutMs: input.timeoutMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
      { decode: (body) => decode(body, input.questions, input.model) },
    );
    if (jarl.is_err(result)) return jarl.err(failure(result.error));
    return result;
  }
  return { service: "decision-api", decide };
});
