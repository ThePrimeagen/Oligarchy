import { Cause, Effect, Layer, Redacted, Schema, type Types } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiError from "effect/unstable/httpapi/HttpApiError";
import * as Api from "@oligarchy/routes/api";
import * as ApiErrors from "@oligarchy/routes/errors";
import * as Domain from "@oligarchy/shared/domain";
import * as Config from "../config.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";

// Every qemu server, qemu reverse proxy, automation-client, and automation-server /abort
// route carries `Authorization: Bearer <OLIGARCHY_TOKEN>`; the compare is exact, as it
// always was. The token comes in as a value: qemu servers read it from ProxyConfig; the
// automation server reads it from OligarchyToken. /linear does not use this bearer —
// Linear signs the body.
export const bearerAuth = (token: Redacted.Redacted): Layer.Layer<Api.BearerAuth> =>
  Layer.succeed(Api.BearerAuth)(
    Api.BearerAuth.of({
      bearer: (httpEffect, { credential }) =>
        Redacted.value(credential) === Redacted.value(token)
          ? httpEffect
          : Effect.fail(ApiErrors.Unauthorized.make({})),
    }),
  );

export const BearerAuthLive: Layer.Layer<Api.BearerAuth, never, Config.ProxyConfig> = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => bearerAuth(config.token)),
);

const isApiError: (value: unknown) => value is ApiErrors.ApiError = Schema.is(
  Schema.Union([
    ApiErrors.BadRequest,
    ApiErrors.Unauthorized,
    ApiErrors.Forbidden,
    ApiErrors.UnknownSession,
    ApiErrors.NotFound,
    ApiErrors.Conflict,
    ApiErrors.StartFailed,
    ApiErrors.ExchangeFailed,
    ApiErrors.SaveFailed,
    ApiErrors.Internal,
    ApiErrors.ServerFailed,
    ApiErrors.NoServer,
    ApiErrors.RunFailed,
    ApiErrors.RunAborted,
    ApiErrors.AtCapacity,
    ApiErrors.SetupNeeded,
  ]),
);

// A request the schemas refused is the caller's 400; an undeclared error is as unexpected as a
// thrown one and takes the defect path.
const translate = (
  error: Types.unhandled,
): Effect.Effect<never, ApiErrors.BadRequest | (Types.unhandled & ApiErrors.ApiError)> => {
  if (HttpApiError.HttpApiSchemaError.is(error)) {
    return Effect.fail(ApiErrors.BadRequest.make({ message: error.cause.message }));
  }
  if (isApiError(error)) {
    return Effect.fail(error);
  }
  return Effect.die(error);
};

// The agent the line is filed under: the error's when it names one, else the process's when it
// has one, else none.
const under = (
  location: string,
  agentId: string | undefined,
  fallback: Log.ProcessAttribution,
): Log.Attribution => {
  if (agentId !== undefined) {
    return { location, agentId };
  }
  if (fallback.agentId !== undefined) {
    return { location, agentId: fallback.agentId };
  }
  return { location };
};

// logs.location is text: an unknown id is attributed only when this server could have minted it
// (a session UUID). Otherwise the process fallback applies (qemu server: "server"; automation: its own).
const attribution = (
  error: ApiErrors.ApiError,
  fallback: Log.ProcessAttribution,
): Log.Attribution => {
  switch (error._tag) {
    case "Unauthorized":
    case "RunFailed":
      return fallback;
    case "Forbidden":
      return { location: error.sessionId, agentId: error.agentId };
    case "Conflict":
      return { location: error.sessionId };
    case "UnknownSession":
      return under(
        Domain.isSessionId(error.id) ? error.id : fallback.location,
        error.agentId,
        fallback,
      );
    // Refused before a session existed: the process bucket, under the agent that asked.
    case "NoServer":
    case "AtCapacity":
    case "SetupNeeded":
    case "RunAborted":
    case "NotFound":
      return under(fallback.location, error.agentId, fallback);
    case "BadRequest":
    case "StartFailed":
    case "ExchangeFailed":
    case "SaveFailed":
    case "Internal":
    case "ServerFailed":
      return under(error.sessionId ?? fallback.location, error.agentId, fallback);
  }
  return error satisfies never;
};

// An Internal's cause is a wrapper (drizzle's `Failed query: …`, a PlatformError); the reason worth
// a log line is the driver's or Node's, one level down.
const detail = (error: ApiErrors.ApiError): string =>
  error._tag === "Internal"
    ? Render.errorDetail(ExternalFailure.causeOf(error.cause))
    : error.message;

// A refusal (< 500) is the caller's problem and skips Sentry; a failure carries its cause there.
// A full machine's 503 is an answer, not a failure: the dispatcher places the work elsewhere.
// A second reserve for an id that already holds one is this process breaking its own contract,
// so that 400 is reported.
const report = (error: ApiErrors.ApiError, fallback: Log.ProcessAttribution): Log.Report => {
  const who = attribution(error, fallback);
  if (error._tag === "BadRequest" && error.message === "already reserved") {
    return who;
  }
  return error._tag === "AtCapacity" || ApiErrors.apiStatus(error) < 500
    ? { ...who, skipSentry: true }
    : { ...who, cause: "cause" in error ? error.cause : undefined };
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
              Effect.fail(ApiErrors.Internal.make({ message: "internal error", cause: defect })),
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
