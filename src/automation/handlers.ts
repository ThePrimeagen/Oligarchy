import { Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Config from "../config.ts";
import * as Automation from "../db/automation.ts";
import * as Tests from "../db/tests.ts";
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

const isDuplicateJob = (error: Errors.DatabaseError): boolean =>
  String(error.cause).includes("duplicate key");

// HMAC is over the raw bytes. After verifying, parse identifier + state and enqueue drive or
// diagnose when the Oligarchy board moves into Automation Needed or Needs Review.
export const LinearLive = HttpApiBuilder.group(Api.AutomationApi, "Linear", (handlers) =>
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
        yield* log.info("linear webhook recorded");
        return ok;
      }
      const event = parsed.value;
      const job = Webhook.queuedAction(event);
      if (Option.isNone(job)) {
        yield* log.info(`linear webhook recorded; ${event.state}`, { agentId: event.ticket });
        return ok;
      }
      const result = yield* tests
        .findResultByLinearId(event.ticket)
        .pipe(
          Effect.mapError((error) => Errors.Internal.make({ cause: error, agentId: event.ticket })),
        );
      if (Option.isNone(result)) {
        yield* log.info(`linear webhook ignored; no result for ${event.state}`, {
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
          agentId: event.ticket,
        });
        return ok;
      }
      yield* log.info(`linear webhook queued ${job.value}; ${event.state}`, {
        agentId: event.ticket,
      });
      return ok;
    }),
  ),
);

// The bearer is left off: Linear signs /linear.
export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.AutomationApi).pipe(
    Layer.provide(LinearLive),
    Layer.provide(Middleware.ApiBoundaryLive),
  ),
  ProxyHandlers.NotFoundRoute,
);
