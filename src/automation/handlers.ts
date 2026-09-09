import { Context, Effect, FileSystem, Layer, Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Log from "../observability/log.ts";
import * as ProxyHandlers from "../proxy/handlers.ts";
import * as Middleware from "../proxy/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import * as Signature from "./signature.ts";

const ok = Contract.Ok.make({});

export class LinearWebhookSecret extends Context.Service<LinearWebhookSecret, Redacted.Redacted>()(
  "@oligarchy/automation/LinearWebhookSecret",
) {}

// POST /automate, for now: one line per request appended to `record`, naming the ticket and the
// model as they came. Spawning the agent those two describe is the next step and lands here.
export const AutomationsLive = (record: string) =>
  HttpApiBuilder.group(Api.AutomationApi, "Automations", (handlers) =>
    handlers.handle("automate", ({ payload }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const log = yield* Log.Log;
        yield* fs
          .writeFileString(record, `linear ticket ${payload.ticket}; model ${payload.model}\n`, {
            flag: "a",
          })
          .pipe(
            Effect.mapError((cause) => Errors.Internal.make({ cause, agentId: payload.ticket })),
          );
        yield* log.info(`automation recorded; ${payload.model}`, { agentId: payload.ticket });
        return ok;
      }),
    ),
  );

// No payload schema: Linear's HMAC is over the raw bytes, and the record is those same bytes
// plus a trailing newline. A JSON payload would parse and lose the exact body. The request is
// the HttpServerRequest service: handleRaw's request widens the requirements channel to unknown.
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
        yield* log.info("linear webhook recorded");
        return ok;
      }),
    ),
  );

// The bearer is left off: Linear signs /linear, and /automate is loopback-only.
export const routes = (record: string) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api.AutomationApi).pipe(
      Layer.provide(AutomationsLive(record)),
      Layer.provide(LinearLive(record)),
      Layer.provide(Middleware.ApiBoundaryLive),
    ),
    ProxyHandlers.NotFoundRoute,
  );
