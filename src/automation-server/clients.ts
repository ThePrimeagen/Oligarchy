import { Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";

export type Failure = Errors.ProxyRefusal | Errors.ProxyUnreachable;

const WireError = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));
const decodeWireError = Schema.decodeUnknownOption(WireError);

const apiError = (text: string): string =>
  Option.match(decodeWireError(text), {
    onNone: () => (text === "" ? "request failed" : text),
    onSome: (body) => body.error,
  });

const requestUrl = (request: HttpClientRequest.HttpClientRequest): string => request.url;

const unreachable = (error: HttpClientError.HttpClientError): Errors.ProxyUnreachable =>
  Errors.ProxyUnreachable.make({
    message: `${error.reason.request.method} ${requestUrl(error.reason.request)} failed`,
    cause: error.reason.cause ?? error,
  });

const refusal = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, Errors.ProxyRefusal> =>
  response.text.pipe(
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((text) =>
      Errors.ProxyRefusal.make({ status: response.status, message: apiError(text) }),
    ),
  );

const classify = (error: HttpClientError.HttpClientError): Effect.Effect<never, Failure> => {
  const response = error.response;
  return response === undefined || (response.status >= 200 && response.status < 300)
    ? Effect.fail(unreachable(error))
    : refusal(response);
};

const runEffect = <A>(
  label: string,
  effect: Effect.Effect<A, Errors.ApiError | HttpClientError.HttpClientError | Schema.SchemaError>,
): Effect.Effect<A, Failure> =>
  effect.pipe(
    Effect.catch((error) => {
      if (error._tag === "HttpClientError") {
        return classify(error);
      }
      if (error._tag === "SchemaError") {
        return Effect.fail(Errors.ProxyUnreachable.make({ message: label, cause: error }));
      }
      return Effect.fail(
        Errors.ProxyRefusal.make({ status: Errors.apiStatus(error), message: error.message }),
      );
    }),
  );

export const run = Effect.fn("Clients.run")(function* (url: string, key: string, prompt: string) {
  const config = yield* Config.AutomationServerConfig;
  const token = Redacted.value(config.token);
  const bearer = HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );
  const middleware = yield* Effect.scoped(Layer.build(bearer));
  const client = yield* HttpApiClient.make(Api.AutomationClientApi, {
    baseUrl: url,
    transformClient: HttpClient.filterStatusOk,
  }).pipe(Effect.provide(middleware));
  return yield* runEffect(
    `POST ${url}/run failed`,
    client.Runs.run({ payload: Contract.RunBody.make({ key, prompt }) }),
  );
});
