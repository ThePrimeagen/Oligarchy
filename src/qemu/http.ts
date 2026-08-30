import { Cause, Effect, ErrorReporter, Schema } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

const OperationError = Schema.Struct({
  error: Schema.String,
}).pipe(HttpApiSchema.status(400));

const StartRequest = Schema.Struct({
  iso: Schema.optionalKey(Schema.String),
  disk: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
});

const IdRequest = Schema.Struct({
  id: Schema.String,
});

const StopRequest = Schema.Struct({
  id: Schema.String,
  status: Schema.optionalKey(
    Schema.Literals(["succeeded", "failed", "aborted"]),
  ),
  reason: Schema.optionalKey(Schema.String),
});

const SendKeysRequest = Schema.Struct({
  id: Schema.String,
  keys: Schema.String,
  encoding: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
});

const OkResponse = Schema.Struct({
  ok: Schema.Literal("true"),
});

const StatsResponse = Schema.Struct({
  qemus: Schema.Int,
  memory: Schema.Struct({
    totalBytes: Schema.Finite,
    usedBytes: Schema.Finite,
    freeBytes: Schema.Finite,
  }),
  cpu: Schema.Struct({
    cores: Schema.Int,
    mean: Schema.Finite,
    p10: Schema.Finite,
    p25: Schema.Finite,
    p75: Schema.Finite,
    p90: Schema.Finite,
  }),
});

const control = HttpApiGroup.make("control").add(
  HttpApiEndpoint.post("start", "/start", {
    payload: [StartRequest, Schema.Undefined],
    success: IdRequest,
    error: OperationError,
  }),
  HttpApiEndpoint.get("image", "/image", {
    query: {
      id: Schema.String,
      agent: Schema.optionalKey(Schema.String),
    },
    success: Schema.Uint8Array.pipe(
      HttpApiSchema.asUint8Array({ contentType: "image/png" }),
    ),
    error: OperationError,
  }),
  HttpApiEndpoint.get("stats", "/stats", {
    success: StatsResponse,
    error: OperationError,
  }),
  HttpApiEndpoint.post("stop", "/stop", {
    payload: StopRequest,
    success: OkResponse,
    error: OperationError,
  }),
  HttpApiEndpoint.post("sendKeys", "/send-keys", {
    payload: SendKeysRequest,
    success: OkResponse,
    error: OperationError,
  }),
);

export const api = HttpApi.make("oligarchy").add(control);

const internalServerErrorResponse = HttpServerResponse.jsonUnsafe(
  { error: "internal server error" },
  { status: 500 },
);

export const errorResponses = HttpRouter.middleware(
  (httpEffect) =>
    Effect.catchCause(httpEffect, (cause) => {
      const failure = Cause.squash(cause);
      if (HttpApiError.HttpApiSchemaError.is(failure)) {
        if (
          failure.kind === "Params" ||
          failure.kind === "Headers" ||
          failure.kind === "Query" ||
          failure.kind === "Payload"
        ) {
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              {
                error: `invalid request ${failure.kind.toLowerCase()}: ${
                  failure.cause.message
                }`,
              },
              { status: 400 },
            ),
          );
        }
        return ErrorReporter.report(cause).pipe(
          Effect.andThen(Effect.succeed(internalServerErrorResponse)),
        );
      }
      if (HttpServerError.isHttpServerError(failure)) {
        if (failure.reason._tag === "RouteNotFound") {
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: "not found" },
              { status: 404 },
            ),
          );
        }
        if (failure.reason._tag === "RequestParseError") {
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: failure.reason.message },
              { status: 400 },
            ),
          );
        }
      }
      return Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : ErrorReporter.report(cause).pipe(
            Effect.andThen(Effect.succeed(internalServerErrorResponse)),
          );
    }),
  { global: true },
);
