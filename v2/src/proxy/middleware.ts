import { Cause, Effect, Layer, Redacted, Schema, type Types } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// Every route but GET /images/* carries `Authorization: Bearer <OLIGARCHY_TOKEN>`; the compare is
// exact, as it always was.
export const BearerAuthLive: Layer.Layer<Api.BearerAuth, never, Config.ProxyConfig> = Layer.effect(
  Api.BearerAuth,
)(
  Effect.gen(function* () {
    const config = yield* Config.ProxyConfig;
    return Api.BearerAuth.of({
      bearer: (httpEffect, { credential }) =>
        Redacted.value(credential) === Redacted.value(config.token)
          ? httpEffect
          : Effect.fail(Errors.Unauthorized.make({})),
    });
  }),
);

const isApiError: (value: unknown) => value is Errors.ApiError = Schema.is(
  Schema.Union([
    Errors.BadRequest,
    Errors.Unauthorized,
    Errors.Forbidden,
    Errors.UnknownSession,
    Errors.NotFound,
    Errors.Conflict,
    Errors.StartFailed,
    Errors.ExchangeFailed,
    Errors.Internal,
  ]),
);

// A request the schemas refused is the caller's 400; an undeclared error is as unexpected as a
// thrown one and takes the defect path.
const translate = (
  error: Types.unhandled,
): Effect.Effect<never, Errors.BadRequest | (Types.unhandled & Errors.ApiError)> =>
  HttpApiError.HttpApiSchemaError.is(error)
    ? Effect.fail(Errors.BadRequest.make({ message: error.cause.message }))
    : isApiError(error)
      ? Effect.fail(error)
      : Effect.die(error);

// logs.session_id is a uuid column: an unknown id is attributed only when this server could have
// minted it.
const attribution = (error: Errors.ApiError): Log.Attribution => {
  switch (error._tag) {
    case "Unauthorized":
    case "NotFound":
      return {};
    case "Forbidden":
      return { sessionId: error.sessionId, agentId: error.agentId };
    case "Conflict":
      return { sessionId: error.sessionId };
    case "UnknownSession":
      return Object.assign(
        {},
        Domain.isSessionId(error.id) ? { sessionId: error.id } : undefined,
        error.agentId === undefined ? undefined : { agentId: error.agentId },
      );
    case "BadRequest":
    case "StartFailed":
    case "ExchangeFailed":
    case "Internal":
      return Object.assign(
        {},
        error.sessionId === undefined ? undefined : { sessionId: error.sessionId },
        error.agentId === undefined ? undefined : { agentId: error.agentId },
      );
  }
  return error satisfies never;
};

const detail = (error: Errors.ApiError): string =>
  error._tag === "Internal" ? Render.errorDetail(error.cause) : error.message;

// A refusal (< 500) is the caller's problem and skips Sentry; a failure carries its cause there.
const report = (error: Errors.ApiError): Log.Report =>
  Errors.apiStatus(error) < 500
    ? { ...attribution(error), skipSentry: true }
    : { ...attribution(error), cause: "cause" in error ? error.cause : undefined };

export const ApiBoundaryLive: Layer.Layer<Api.ApiBoundary, never, Log.Log> = Layer.effect(
  Api.ApiBoundary,
)(
  Effect.gen(function* () {
    const log = yield* Log.Log;
    return Api.ApiBoundary.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const failed = (text: string, how: Log.Report) =>
          log.error(`${request.method} ${request.originalUrl} failed: ${text}`, how);
        return yield* httpEffect.pipe(
          Effect.catch(translate),
          Effect.tapError((error) => failed(detail(error), report(error))),
          Effect.catchDefect((defect) =>
            failed(Cause.pretty(Cause.die(defect)), { cause: defect }).pipe(
              Effect.andThen(
                Effect.fail(Errors.Internal.make({ message: "internal error", cause: defect })),
              ),
            ),
          ),
        );
      }),
    );
  }),
);
