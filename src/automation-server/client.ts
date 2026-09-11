import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";

export class OligarchyToken extends Context.Service<OligarchyToken>()(
  "@oligarchy/automation-server/OligarchyToken",
  { make: Config.oligarchyToken },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

const WireError = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));
const decodeWireError = Schema.decodeUnknownOption(WireError);

const bodyDetail = (text: string): string | undefined =>
  Option.match(decodeWireError(text), {
    onNone: () => (text === "" ? undefined : text),
    onSome: (body) => body.error,
  });

const failed = (
  url: string,
  path: "/run" | "/abort",
  status: number | undefined,
  text: string,
  cause: unknown,
): Errors.AutomationClientError => {
  const detail = bodyDetail(text);
  return Errors.AutomationClientError.make(
    Object.assign(
      {
        message:
          detail === undefined
            ? `automation client: POST ${url}${path} failed`
            : `automation client: POST ${url}${path} failed: ${detail}`,
        cause,
      },
      status === undefined ? undefined : { status },
    ),
  );
};

const makeClient = Effect.fn("makeClient")(function* (url: string) {
  const token = Redacted.value(yield* OligarchyToken);
  const bearer = HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );
  const middleware = yield* Effect.scoped(Layer.build(bearer));
  return yield* HttpApiClient.make(Api.AutomationClientApi, {
    baseUrl: url,
    transformClient: HttpClient.filterStatusOk,
  }).pipe(Effect.provide(middleware));
});

// POST /run and wait for the client to finish. node:http has no ceiling of its own; a drive or
// diagnose runs until the client answers, or until this fiber is interrupted.
export const run = Effect.fn("run")(function* (url: string, prompt: string, ticket: string) {
  const client = yield* makeClient(url);
  return yield* client.Runs.run({ payload: Contract.RunBody.make({ prompt, ticket }) }).pipe(
    Effect.catch((error) => {
      if (error._tag === "HttpClientError") {
        const response = error.response;
        if (response === undefined) {
          return Effect.fail(failed(url, "/run", undefined, "", error));
        }
        return response.text.pipe(
          Effect.orElseSucceed(() => ""),
          Effect.flatMap((text) => Effect.fail(failed(url, "/run", response.status, text, error))),
        );
      }
      return Effect.fail(failed(url, "/run", undefined, "", error));
    }),
    Effect.asVoid,
  );
});

export const abort = Effect.fn("abort")(function* (url: string, ticket: string) {
  const client = yield* makeClient(url);
  return yield* client.Runs.abort({ payload: Contract.AbortBody.make({ ticket }) }).pipe(
    Effect.catch((error) => {
      if (error._tag === "HttpClientError") {
        const response = error.response;
        if (response === undefined) {
          return Effect.fail(failed(url, "/abort", undefined, "", error));
        }
        return response.text.pipe(
          Effect.orElseSucceed(() => ""),
          Effect.flatMap((text) =>
            Effect.fail(failed(url, "/abort", response.status, text, error)),
          ),
        );
      }
      return Effect.fail(failed(url, "/abort", undefined, "", error));
    }),
    Effect.asVoid,
  );
});
