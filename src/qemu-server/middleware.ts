import { Cause, Effect, Layer, Redacted, Schema, type Types } from "effect";
import { HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// Every qemu server and qemu reverse proxy route carries `Authorization: Bearer <OLIGARCHY_TOKEN>`; the
// compare is exact, as it always was. The token comes in as a value: those servers read it from
// ProxyConfig beside their database url. The automation service does not use this bearer.
export const bearerAuth = (token: Redacted.Redacted): Layer.Layer<Api.BearerAuth> =>
  Layer.succeed(Api.BearerAuth)(
    Api.BearerAuth.of({
      bearer: (httpEffect, { credential }) =>
        Redacted.value(credential) === Redacted.value(token)
          ? httpEffect
          : Effect.fail(Errors.Unauthorized.make({})),
    }),
  );

export const BearerAuthLive: Layer.Layer<Api.BearerAuth, never, Config.ProxyConfig> = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => bearerAuth(config.token)),
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
    Errors.ServerFailed,
    Errors.NoServer,
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

// logs.location is text: an unknown id is attributed only when this server could have minted it
// (a session UUID). Otherwise the process fallback applies (qemu server: "server"; automation: its own).
const attribution = (error: Errors.ApiError, fallback: Log.ProcessAttribution): Log.Attribution => {
  switch (error._tag) {
    case "Unauthorized":
    case "NotFound":
      return fallback;
    case "Forbidden":
      return { location: error.sessionId, agentId: error.agentId };
    case "Conflict":
      return { location: error.sessionId };
    case "UnknownSession":
      return Object.assign(
        { location: Domain.isSessionId(error.id) ? error.id : fallback.location },
        error.agentId === undefined
          ? fallback.agentId === undefined
            ? undefined
            : { agentId: fallback.agentId }
          : { agentId: error.agentId },
      );
    case "NoServer":
      return Object.assign(
        { location: fallback.location },
        error.agentId === undefined
          ? fallback.agentId === undefined
            ? undefined
            : { agentId: fallback.agentId }
          : { agentId: error.agentId },
      );
    case "BadRequest":
    case "StartFailed":
    case "ExchangeFailed":
    case "Internal":
    case "ServerFailed":
      return Object.assign(
        { location: error.sessionId ?? fallback.location },
        error.agentId === undefined
          ? fallback.agentId === undefined
            ? undefined
            : { agentId: fallback.agentId }
          : { agentId: error.agentId },
      );
  }
  return error satisfies never;
};

// An Internal's cause is a wrapper (drizzle's `Failed query: …`, a PlatformError); the reason worth
// a log line is the driver's or Node's, one level down.
const detail = (error: Errors.ApiError): string =>
  error._tag === "Internal"
    ? Render.errorDetail(ExternalFailure.causeOf(error.cause))
    : error.message;

// A refusal (< 500) is the caller's problem and skips Sentry; a failure carries its cause there.
const report = (error: Errors.ApiError, fallback: Log.ProcessAttribution): Log.Report =>
  Errors.apiStatus(error) < 500
    ? { ...attribution(error, fallback), skipSentry: true }
    : {
        ...attribution(error, fallback),
        cause: "cause" in error ? error.cause : undefined,
      };

// The one boundary: schema errors to 400, defects to 500, one log line per failed request. The
// qemu server and the qemu reverse proxy wrap it in their own middleware tags, which differ only in the error
// codecs they declare.
const boundary = Effect.gen(function* () {
  const log = yield* Log.Log;
  const fallback = yield* Log.ProcessAttribution;
  return (httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const failed = (text: string, how: Log.Report) =>
        log.error(`${request.method} ${request.originalUrl} failed: ${text}`, how);
      return yield* httpEffect.pipe(
        Effect.catch(translate),
        Effect.tapError((error) => failed(detail(error), report(error, fallback))),
        Effect.catchDefect((defect) =>
          failed(Cause.pretty(Cause.die(defect)), { ...fallback, cause: defect }).pipe(
            Effect.andThen(
              Effect.fail(Errors.Internal.make({ message: "internal error", cause: defect })),
            ),
          ),
        ),
      );
    });
});

export const ApiBoundaryLive: Layer.Layer<Api.ApiBoundary, never, Log.Log> = Layer.effect(
  Api.ApiBoundary,
)(Effect.map(boundary, (wrap) => Api.ApiBoundary.of(wrap)));

export const RouteBoundaryLive: Layer.Layer<Api.RouteBoundary, never, Log.Log> = Layer.effect(
  Api.RouteBoundary,
)(Effect.map(boundary, (wrap) => Api.RouteBoundary.of(wrap)));
