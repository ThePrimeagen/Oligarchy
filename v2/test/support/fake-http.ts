import { Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

export type Recorded = {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type Respond = (
  request: HttpClientRequest.HttpClientRequest,
  url: URL,
) => Response | Effect.Effect<Response, HttpClientError.HttpClientError>;

const decoder = new TextDecoder();

const bodyText = (request: HttpClientRequest.HttpClientRequest): string => {
  const body = request.body;
  if (body._tag === "Uint8Array") {
    return decoder.decode(body.body);
  }
  if (body._tag === "Raw" && typeof body.body === "string") {
    return body.body;
  }
  return "";
};

const toLayer = (
  handler: (
    request: HttpClientRequest.HttpClientRequest,
    url: URL,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(HttpClient.HttpClient)(HttpClient.make(handler));

const answer = (respond: Respond) => (request: HttpClientRequest.HttpClientRequest, url: URL) => {
  const response = respond(request, url);
  return Effect.isEffect(response)
    ? Effect.map(response, (web) => HttpClientResponse.fromWeb(request, web))
    : Effect.succeed(HttpClientResponse.fromWeb(request, response));
};

// An HttpClient answered by a scripted function; the response is a web `Response`.
export const respondWith = (respond: Respond): Layer.Layer<HttpClient.HttpClient> =>
  toLayer(answer(respond));

export type Recorder = {
  readonly requests: Array<Recorded>;
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
};

// Records `{ method, url, headers, body }` of every request before answering it.
export const recordRequests = (
  respond: Respond = () => new Response(null, { status: 200 }),
): Recorder => {
  const requests: Array<Recorded> = [];
  const reply = answer(respond);
  return {
    requests,
    layer: toLayer((request, url) =>
      Effect.suspend(() => {
        requests.push({
          method: request.method,
          url: url.toString(),
          headers: { ...request.headers },
          body: bodyText(request),
        });
        return reply(request, url);
      }),
    ),
  };
};

// A client whose requests never complete, for timeout tests driven by the TestClock.
export const never: Layer.Layer<HttpClient.HttpClient> = toLayer(() => Effect.never);

// A client that must not be called: any request is a defect naming the url.
export const die: Layer.Layer<HttpClient.HttpClient> = toLayer((request, url) =>
  Effect.die(`unexpected ${request.method} ${url.toString()}`),
);

// A JSON response with the given status, matching the proxy's `{ "error": message }` bodies.
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
