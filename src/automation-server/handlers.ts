import { Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as Automation from "../db/automation.ts";
import * as Tests from "../db/tests.ts";
import * as Log from "../observability/log.ts";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import * as AutomationClient from "./client.ts";
import * as Signature from "./signature.ts";
import * as Webhook from "./webhook.ts";

const ok = Contract.Ok.make({});

export class LinearWebhookSecret extends Context.Service<LinearWebhookSecret>()(
  "@oligarchy/automation-server/LinearWebhookSecret",
  { make: Config.linearWebhookSecret },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

const isDuplicateJob = (error: Errors.DatabaseError): boolean =>
  String(error.cause).includes("duplicate key");

// HMAC is over the raw bytes. After verifying, parse identifier + state and enqueue drive or
// diagnose when the Oligarchy board moves into Automation Needed or Needs Review.
export const LinearLive = HttpApiBuilder.group(Api.AutomationServerApi, "Linear", (handlers) =>
  handlers.handle("linear", () =>
    Effect.gen(function* () {
      const secret = yield* LinearWebhookSecret;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const log = yield* Log.Log;
      const tests = yield* Tests.TestStore;
      const automation = yield* Automation.AutomationStore;
      const bytes = new Uint8Array(
        yield* request.arrayBuffer.pipe(
          Effect.mapError((cause) => Errors.Internal.make({ cause })),
        ),
      );
      if (!Signature.matches(Redacted.value(secret), request.headers["linear-signature"], bytes)) {
        return yield* Errors.Unauthorized.make({});
      }
      const parsed = Option.map(Webhook.issue(bytes), Webhook.work);
      if (Option.isNone(parsed)) {
        yield* log.info("linear webhook recorded", {
          location: Log.Locations.automation,
          agentId: Log.AutomationAgentId,
        });
        return ok;
      }
      const event = parsed.value;
      const job = Webhook.queuedAction(event);
      if (Option.isNone(job)) {
        yield* log.info(`linear webhook recorded; ${event.state}`, {
          location: Log.Locations.automation,
          agentId: event.ticket,
        });
        return ok;
      }
      const result = yield* tests
        .findResultByLinearId(event.ticket)
        .pipe(
          Effect.mapError((error) => Errors.Internal.make({ cause: error, agentId: event.ticket })),
        );
      if (Option.isNone(result)) {
        yield* log.info(`linear webhook ignored; no result for ${event.state}`, {
          location: Log.Locations.automation,
          agentId: event.ticket,
        });
        return ok;
      }
      const outcome = yield* automation
        .enqueue({ resultId: result.value.id, action: job.value })
        .pipe(
          Effect.as("queued" as const),
          Effect.catchTag("DatabaseError", (error) =>
            isDuplicateJob(error)
              ? Effect.succeed("duplicate" as const)
              : Effect.fail(Errors.Internal.make({ cause: error, agentId: event.ticket })),
          ),
        );
      if (outcome === "duplicate") {
        yield* log.info(`linear webhook ignored; ${job.value} already queued`, {
          location: Log.Locations.automation,
          agentId: event.ticket,
        });
        return ok;
      }
      yield* log.info(`linear webhook queued ${job.value}; ${event.state}`, {
        location: Log.Locations.automation,
        agentId: event.ticket,
      });
      return ok;
    }),
  ),
);

export const AbortLive = HttpApiBuilder.group(Api.AutomationServerApi, "Abort", (handlers) =>
  handlers.handle("abort", ({ payload }) =>
    Effect.gen(function* () {
      const tests = yield* Tests.TestStore;
      const automation = yield* Automation.AutomationStore;
      const log = yield* Log.Log;
      const result = yield* tests.findResultByLinearId(payload.ticket).pipe(
        Effect.mapError((error) =>
          Errors.Internal.make({ cause: error, agentId: payload.ticket }),
        ),
      );
      if (Option.isNone(result)) {
        return yield* Errors.BadRequest.make({
          message: `ticket "${payload.ticket}" is not running`,
          agentId: payload.ticket,
        });
      }
      const job = yield* automation.findRunning(result.value.id).pipe(
        Effect.mapError((error) =>
          Errors.Internal.make({ cause: error, agentId: payload.ticket }),
        ),
      );
      if (Option.isNone(job)) {
        return yield* Errors.BadRequest.make({
          message: `ticket "${payload.ticket}" is not running`,
          agentId: payload.ticket,
        });
      }
      const url = job.value.clientUrl;
      if (url === null) {
        return yield* Effect.die(new Error(`running job ${job.value.id} has no clientUrl`));
      }
      yield* AutomationClient.abort(url, payload.ticket).pipe(
        Effect.catchTag("AutomationClientError", (error) =>
          error.status === 404
            ? Effect.fail(Errors.unknownSession(payload.ticket, payload.ticket))
            : Effect.fail(
                Errors.RunFailed.make(
                  Object.assign(
                    { message: error.message },
                    error.cause === undefined ? undefined : { cause: error.cause },
                  ),
                ),
              ),
        ),
      );
      yield* log.info(`aborted ${job.value.action}; ${url}`, {
        location: Log.Locations.automation,
        agentId: payload.ticket,
      });
      yield* automation.finish(job.value.id, "aborted", "aborted").pipe(
        Effect.mapError((error) =>
          Errors.Internal.make({ cause: error, agentId: payload.ticket }),
        ),
      );
      return ok;
    }),
  ),
);

const BearerAuthLive = Layer.unwrap(
  Effect.map(AutomationClient.OligarchyToken, Middleware.bearerAuth),
);

// Linear signs /linear. /abort takes the oligarchy bearer, from the same token POST /run uses.
export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.AutomationServerApi).pipe(
    Layer.provide(LinearLive),
    Layer.provide(AbortLive),
    Layer.provide(Layer.mergeAll(BearerAuthLive, Middleware.ApiBoundaryLive)),
  ),
  QemuServerHandlers.NotFoundRoute,
);
