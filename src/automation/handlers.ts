import { Context, Effect, FileSystem, Layer, Option, Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as Log from "../observability/log.ts";
import * as ProxyHandlers from "../proxy/handlers.ts";
import * as Middleware from "../proxy/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import * as Signature from "./signature.ts";
import * as Webhook from "./webhook.ts";

const ok = Contract.Ok.make({});

export class LinearWebhookSecret extends Context.Service<LinearWebhookSecret>()(
  "@oligarchy/automation/LinearWebhookSecret",
  { make: Config.linearWebhookSecret },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

// No payload schema: Linear's HMAC is over the raw bytes, and the record is those same bytes
// plus a trailing newline. A JSON payload would parse and lose the exact body.
export const LinearLive = (record: string) =>
  HttpApiBuilder.group(Api.AutomationApi, "Linear", (handlers) =>
    handlers.handle("linear", () =>
      Effect.gen(function* () {
        const secret = yield* LinearWebhookSecret;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const fs = yield* FileSystem.FileSystem;
        const log = yield* Log.Log;
        const bytes = new Uint8Array(
          yield* request.arrayBuffer.pipe(
            Effect.mapError((cause) => Errors.Internal.make({ cause })),
          ),
        );
        if (
          !Signature.matches(Redacted.value(secret), request.headers["linear-signature"], bytes)
        ) {
          return yield* Errors.Unauthorized.make({});
        }
        const recorded = new Uint8Array(bytes.length + 1);
        recorded.set(bytes);
        recorded[bytes.length] = 0x0a;
        yield* fs
          .writeFile(record, recorded, { flag: "a" })
          .pipe(Effect.mapError((cause) => Errors.Internal.make({ cause })));
        const parsed = Option.map(Webhook.issue(bytes), Webhook.work);
        if (Option.isSome(parsed)) {
          yield* log.info(`linear webhook recorded; ${parsed.value.state}`, {
            agentId: parsed.value.ticket,
          });
        } else {
          yield* log.info("linear webhook recorded");
        }
        return ok;
      }),
    ),
  );

// The bearer is left off: Linear signs /linear.
export const routes = (record: string) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api.AutomationApi).pipe(
      Layer.provide(LinearLive(record)),
      Layer.provide(Middleware.ApiBoundaryLive),
    ),
    ProxyHandlers.NotFoundRoute,
  );
