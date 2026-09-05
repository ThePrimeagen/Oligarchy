import { Effect, Layer, Option, Redacted, Schema, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  UrlParams,
} from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";

export type Failure = Errors.ProxyRefusal | Errors.ProxyUnreachable;

export type ProxyClientService = {
  readonly start: (body: Contract.StartBody) => Effect.Effect<Contract.StartResponse, Failure>;
  readonly image: (id: string, agent: string) => Effect.Effect<Uint8Array, Failure>;
  readonly serial: (id: string, agent: string) => Effect.Effect<Uint8Array, Failure>;
  readonly dump: (id: string) => Effect.Effect<Uint8Array, Failure>;
  readonly sendKeys: (body: Contract.SendKeysBody) => Effect.Effect<void, Failure>;
  readonly sendMouse: (body: Contract.SendMouseBody) => Effect.Effect<void, Failure>;
  readonly intentStart: (body: Contract.IntentStartBody) => Effect.Effect<void, Failure>;
  readonly intentEnd: (body: Contract.IntentEndBody) => Effect.Effect<void, Failure>;
  readonly stop: (body: Contract.StopBody) => Effect.Effect<void, Failure>;
  readonly follow: (
    id: string,
  ) => Effect.Effect<Stream.Stream<Uint8Array, Errors.ProxyUnreachable>, Failure>;
};

export type ConnectOptions = {
  readonly serverUrl: string;
  readonly token: Redacted.Redacted;
};

// /start blocks while the proxy fetches the ISO and boots QEMU; a first-time download can take
// most of an hour. node:http has no ceiling of its own, so this is the only one.
export const START_TIMEOUT = "45 minutes";

const WireError = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));
const decodeWireError = Schema.decodeUnknownOption(WireError);

// The `error` string of a `{ "error": ... }` body; any other body raw; an empty body `request failed`.
export const apiError = (text: string): string =>
  Option.match(decodeWireError(text), {
    onNone: () => (text === "" ? "request failed" : text),
    onSome: (body) => body.error,
  });

const requestUrl = (request: HttpClientRequest.HttpClientRequest): string => {
  const query = UrlParams.toString(request.urlParams);
  return query === "" ? request.url : `${request.url}?${query}`;
};

const unreachable = (error: HttpClientError.HttpClientError): Errors.ProxyUnreachable =>
  Errors.ProxyUnreachable.make({
    message: `${error.reason.request.method} ${requestUrl(error.reason.request)} failed`,
    cause: error.reason.cause ?? error,
  });

const refusal = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, Errors.ProxyRefusal> =>
  response.text.pipe(
    // The status alone is the refusal; an unreadable body only loses its text.
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((text) =>
      Errors.ProxyRefusal.make({ status: response.status, message: apiError(text) }),
    ),
  );

// A response the generated client could not decode is still the proxy's answer when its status
// is not a success; only then does the body's `error` become the headline.
const classify = (error: HttpClientError.HttpClientError): Effect.Effect<never, Failure> => {
  const response = error.response;
  return response === undefined || (response.status >= 200 && response.status < 300)
    ? Effect.fail(unreachable(error))
    : refusal(response);
};

const run = <A>(
  label: string,
  effect: Effect.Effect<A, Errors.ApiError | HttpClientError.HttpClientError | Schema.SchemaError>,
): Effect.Effect<A, Failure> =>
  effect.pipe(
    Effect.catch((error) => {
      if (error._tag === "HttpClientError") {
        return classify(error);
      }
      // A success body the contract cannot decode is not the proxy's answer to the request.
      if (error._tag === "SchemaError") {
        return Effect.fail(Errors.ProxyUnreachable.make({ message: label, cause: error }));
      }
      return Effect.fail(
        Errors.ProxyRefusal.make({ status: Errors.apiStatus(error), message: error.message }),
      );
    }),
  );

export const connect = Effect.fn("ProxyClient.connect")(function* (options: ConnectOptions) {
  const { serverUrl } = options;
  const token = Redacted.value(options.token);
  const httpClient = yield* HttpClient.HttpClient;
  const bearer = HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );
  // The middleware layer holds no resources: its scope can close as soon as it is built.
  const middleware = yield* Effect.scoped(Layer.build(bearer));
  // Every non-2xx answer is refused here, before the generated client decodes it: a declared
  // error status with a body that is not `{ "error" }` would otherwise be combined with its
  // schema failure, and hashing that failure walks into node:http's response and throws.
  const client = yield* HttpApiClient.make(Api.ProxyApi, {
    baseUrl: serverUrl,
    transformClient: HttpClient.filterStatusOk,
  }).pipe(Effect.provide(middleware));
  const label = (method: string, path: string) => `${method} ${serverUrl}${path} failed`;

  const start = (body: Contract.StartBody) =>
    run(label("POST", "/start"), client.Sessions.start({ payload: body })).pipe(
      Effect.timeoutOrElse({
        duration: START_TIMEOUT,
        orElse: () =>
          Errors.ProxyUnreachable.make({
            message: "start: no response within timeout",
            cause: null,
          }),
      }),
    );

  const image = (id: string, agent: string) =>
    run(label("GET", "/image"), client.Sessions.image({ query: { id, agent } })).pipe(
      Effect.map((response) => response.body),
    );

  const serial = (id: string, agent: string) =>
    run(label("GET", "/serial"), client.Sessions.serial({ query: { id, agent } }));

  const dump = (id: string) => run(label("GET", "/dump"), client.Sessions.dump({ query: { id } }));

  const sendKeys = (body: Contract.SendKeysBody) =>
    run(label("POST", "/send-keys"), client.Sessions.sendKeys({ payload: body })).pipe(
      Effect.asVoid,
    );

  const sendMouse = (body: Contract.SendMouseBody) =>
    run(label("POST", "/send-mouse"), client.Sessions.sendMouse({ payload: body })).pipe(
      Effect.asVoid,
    );

  const intentStart = (body: Contract.IntentStartBody) =>
    run(label("POST", "/intent/start"), client.Sessions.intentStart({ payload: body })).pipe(
      Effect.asVoid,
    );

  const intentEnd = (body: Contract.IntentEndBody) =>
    run(label("POST", "/intent/end"), client.Sessions.intentEnd({ payload: body })).pipe(
      Effect.asVoid,
    );

  const stop = (body: Contract.StopBody) =>
    run(label("POST", "/stop"), client.Sessions.stop({ payload: body })).pipe(Effect.asVoid);

  // A follow stays open for as long as the session lives; the raw client hands back the
  // response's byte stream without a ceiling and without buffering.
  const follow = Effect.fn("ProxyClient.follow")(function* (id: string) {
    const request = HttpClientRequest.get(`${serverUrl}/follow`).pipe(
      HttpClientRequest.setUrlParam("id", id),
      HttpClientRequest.bearerToken(token),
    );
    const response = yield* httpClient
      .execute(request)
      .pipe(Effect.mapError((error) => unreachable(error)));
    if (response.status !== 200) {
      return yield* refusal(response);
    }
    return response.stream.pipe(Stream.mapError(unreachable));
  });

  const service: ProxyClientService = {
    start,
    image,
    serial,
    dump,
    sendKeys,
    sendMouse,
    intentStart,
    intentEnd,
    stop,
    follow,
  };
  return service;
});
