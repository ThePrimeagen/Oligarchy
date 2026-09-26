import { Effect, Layer, Option, Redacted, Schema, Stream } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as UrlParams from "effect/unstable/http/UrlParams";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as Api from "./api.ts";
import * as Contract from "./contract.ts";
import * as ApiErrors from "./errors.ts";

// The proxy answered with a refusal: its status and the `error` its body carried.
export class ProxyRefusal extends Schema.TaggedError<ProxyRefusal>(
  "@oligarchy/shared/errors/ProxyRefusal",
)("ProxyRefusal", { status: Schema.Int, message: Schema.String }) {}

// The proxy could not be reached, or answered with something that is not its contract.
export class ProxyUnreachable extends Schema.TaggedError<ProxyUnreachable>(
  "@oligarchy/shared/errors/ProxyUnreachable",
)("ProxyUnreachable", { message: Schema.String, cause: Schema.Defect() }) {}

export type Failure = ProxyRefusal | ProxyUnreachable;

export type ProxyClientService = {
  readonly reserve: (body: Contract.ReserveAgentBody) => Effect.Effect<void, Failure>;
  readonly relinquish: (body: Contract.ReserveAgentBody) => Effect.Effect<void, Failure>;
  readonly start: (body: Contract.StartBody) => Effect.Effect<Contract.StartResponse, Failure>;
  readonly image: (id: string, agent: string) => Effect.Effect<Uint8Array, Failure>;
  readonly serial: (id: string, agent: string) => Effect.Effect<Uint8Array, Failure>;
  readonly sendKeys: (body: Contract.SendKeysBody) => Effect.Effect<void, Failure>;
  readonly mouseMove: (body: Contract.MouseMoveBody) => Effect.Effect<void, Failure>;
  readonly mouseClick: (body: Contract.MouseClickBody) => Effect.Effect<void, Failure>;
  readonly mouseDoubleClick: (body: Contract.MouseClickBody) => Effect.Effect<void, Failure>;
  readonly mouseScroll: (body: Contract.MouseScrollBody) => Effect.Effect<void, Failure>;
  readonly mouseDrag: (body: Contract.MouseDragBody) => Effect.Effect<void, Failure>;
  readonly mouseHold: (body: Contract.MouseButtonBody) => Effect.Effect<void, Failure>;
  readonly mouseRelease: (body: Contract.MouseButtonBody) => Effect.Effect<void, Failure>;
  readonly intentStart: (body: Contract.IntentStartBody) => Effect.Effect<void, Failure>;
  readonly intentEnd: (body: Contract.IntentEndBody) => Effect.Effect<void, Failure>;
  readonly stop: (body: Contract.StopBody) => Effect.Effect<void, Failure>;
  readonly save: (body: Contract.SaveBody) => Effect.Effect<void, Failure>;
  readonly follow: (
    id: string,
  ) => Effect.Effect<Stream.Stream<Uint8Array, ProxyUnreachable>, Failure>;
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

const unreachable = (error: HttpClientError.HttpClientError): ProxyUnreachable =>
  ProxyUnreachable.make({
    message: `${error.reason.request.method} ${requestUrl(error.reason.request)} failed`,
    cause: error.reason.cause ?? error,
  });

const refusal = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, ProxyRefusal> =>
  response.text.pipe(
    // The status alone is the refusal; an unreadable body only loses its text.
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((text) =>
      ProxyRefusal.make({ status: response.status, message: apiError(text) }),
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
  effect: Effect.Effect<
    A,
    ApiErrors.ApiError | HttpClientError.HttpClientError | Schema.SchemaError
  >,
): Effect.Effect<A, Failure> =>
  effect.pipe(
    Effect.catch((error) => {
      if (error._tag === "HttpClientError") {
        return classify(error);
      }
      // A success body the contract cannot decode is not the proxy's answer to the request.
      if (error._tag === "SchemaError") {
        return Effect.fail(ProxyUnreachable.make({ message: label, cause: error }));
      }
      return Effect.fail(
        ProxyRefusal.make({ status: ApiErrors.apiStatus(error), message: error.message }),
      );
    }),
  );

// The bearer the qemu servers share, set once on every request the generated client sends.
const bearerLayer = (token: Redacted.Redacted) =>
  HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, Redacted.value(token))),
  );

// Where the iso is minted, as the reverse proxy answers for the whole fleet: one row per
// registered qemu server. Not a session call, so it lives outside `connect`.
export const minted = Effect.fn("ProxyClient.minted")(function* (
  options: ConnectOptions,
  iso: string,
) {
  // The middleware layer holds no resources: its scope can close as soon as it is built.
  const middleware = yield* Effect.scoped(Layer.build(bearerLayer(options.token)));
  const client = yield* HttpApiClient.make(Api.QemuReverseProxyApi, {
    baseUrl: options.serverUrl,
    transformClient: HttpClient.filterStatusOk,
  }).pipe(Effect.provide(middleware));
  return yield* run(
    `GET ${options.serverUrl}/minted failed`,
    client.Servers.minted({ query: { iso } }),
  );
});

export const connect = Effect.fn("ProxyClient.connect")(function* (options: ConnectOptions) {
  const { serverUrl } = options;
  const token = Redacted.value(options.token);
  const httpClient = yield* HttpClient.HttpClient;
  // The middleware layer holds no resources: its scope can close as soon as it is built.
  const middleware = yield* Effect.scoped(Layer.build(bearerLayer(options.token)));
  // Every non-2xx answer is refused here, before the generated client decodes it: a declared
  // error status with a body that is not `{ "error" }` would otherwise be combined with its
  // schema failure, and hashing that failure walks into node:http's response and throws.
  const client = yield* HttpApiClient.make(Api.QemuServerApi, {
    baseUrl: serverUrl,
    transformClient: HttpClient.filterStatusOk,
  }).pipe(Effect.provide(middleware));
  const label = (method: string, path: string) => `${method} ${serverUrl}${path} failed`;

  const reserve = (body: Contract.ReserveAgentBody) =>
    run(label("POST", "/reserve"), client.Sessions.reserve({ payload: body })).pipe(Effect.asVoid);

  const relinquish = (body: Contract.ReserveAgentBody) =>
    run(label("POST", "/relinquish"), client.Sessions.relinquish({ payload: body })).pipe(
      Effect.asVoid,
    );

  const start = (body: Contract.StartBody) =>
    run(label("POST", "/start"), client.Sessions.start({ payload: body })).pipe(
      Effect.timeoutOrElse({
        duration: START_TIMEOUT,
        orElse: () =>
          ProxyUnreachable.make({
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

  const sendKeys = (body: Contract.SendKeysBody) =>
    run(label("POST", "/send-keys"), client.Sessions.sendKeys({ payload: body })).pipe(
      Effect.asVoid,
    );

  const mouseMove = (body: Contract.MouseMoveBody) =>
    run(label("POST", "/mouse/move"), client.Sessions.mouseMove({ payload: body })).pipe(
      Effect.asVoid,
    );

  const mouseClick = (body: Contract.MouseClickBody) =>
    run(label("POST", "/mouse/click"), client.Sessions.mouseClick({ payload: body })).pipe(
      Effect.asVoid,
    );

  const mouseDoubleClick = (body: Contract.MouseClickBody) =>
    run(
      label("POST", "/mouse/double-click"),
      client.Sessions.mouseDoubleClick({ payload: body }),
    ).pipe(Effect.asVoid);

  const mouseScroll = (body: Contract.MouseScrollBody) =>
    run(label("POST", "/mouse/scroll"), client.Sessions.mouseScroll({ payload: body })).pipe(
      Effect.asVoid,
    );

  const mouseDrag = (body: Contract.MouseDragBody) =>
    run(label("POST", "/mouse/drag"), client.Sessions.mouseDrag({ payload: body })).pipe(
      Effect.asVoid,
    );

  const mouseHold = (body: Contract.MouseButtonBody) =>
    run(label("POST", "/mouse/hold"), client.Sessions.mouseHold({ payload: body })).pipe(
      Effect.asVoid,
    );

  const mouseRelease = (body: Contract.MouseButtonBody) =>
    run(label("POST", "/mouse/release"), client.Sessions.mouseRelease({ payload: body })).pipe(
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

  // A save waits for the guest to power off and the disk to be copied; node:http has no ceiling
  // of its own, and the server bounds the power-off itself.
  const save = (body: Contract.SaveBody) =>
    run(label("POST", "/save"), client.Sessions.save({ payload: body })).pipe(Effect.asVoid);

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
    reserve,
    relinquish,
    start,
    image,
    serial,
    sendKeys,
    mouseMove,
    mouseClick,
    mouseDoubleClick,
    mouseScroll,
    mouseDrag,
    mouseHold,
    mouseRelease,
    intentStart,
    intentEnd,
    stop,
    save,
    follow,
  };
  return service;
});
