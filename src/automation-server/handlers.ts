import { Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as Log from "@oligarchy/log/log";
import * as Api from "@oligarchy/routes/api";
import * as Contract from "@oligarchy/routes/contract";
import * as ApiErrors from "@oligarchy/routes/errors";
import * as Config from "../config.ts";
import * as Automation from "../db/automation.ts";
import * as Servers from "../db/servers.ts";
import * as Tests from "../db/tests.ts";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Errors from "../shared/errors.ts";
import * as AbortWait from "./abort-wait.ts";
import * as AutomationClient from "./client.ts";
import * as Enqueue from "./enqueue.ts";
import * as Ready from "./ready.ts";
import * as Signature from "./signature.ts";
import * as Webhook from "./webhook.ts";
import * as Worker from "./worker.ts";

const ok = Contract.Ok.make({});

export class LinearWebhookSecret extends Context.Service<LinearWebhookSecret>()(
  "@oligarchy/automation-server/LinearWebhookSecret",
  { make: Config.linearWebhookSecret },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

// HMAC is over the raw bytes. After verifying, parse identifier + state and enqueue drive or
// diagnose when the configured team's board moves into Automation Needed or Needs Review. A new
// drive or mint labels its ticket ready.
export const LinearLive = HttpApiBuilder.group(Api.AutomationServerApi, "Linear", (handlers) =>
  handlers.handle("linear", () =>
    Effect.gen(function* () {
      const secret = yield* LinearWebhookSecret;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const log = yield* Log.Log;
      const bytes = new Uint8Array(
        yield* request.arrayBuffer.pipe(
          Effect.mapError((cause) => ApiErrors.Internal.make({ cause })),
        ),
      );
      if (!Signature.matches(Redacted.value(secret), request.headers["linear-signature"], bytes)) {
        return yield* ApiErrors.Unauthorized.make({});
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
      const placed = yield* Enqueue.enqueueTicket(event.ticket, job.value).pipe(
        Effect.mapError((error) =>
          ApiErrors.Internal.make({ cause: error, agentId: event.ticket }),
        ),
      );
      if (placed.result === "missing") {
        yield* log.info(`linear webhook ignored; no result for ${event.state}`, {
          location: Log.Locations.automation,
          agentId: event.ticket,
        });
        return ok;
      }
      if (placed.result === "duplicate") {
        yield* log.info(`linear webhook ignored; ${placed.action} already queued`, {
          location: Log.Locations.automation,
          agentId: event.ticket,
        });
        return ok;
      }
      yield* log.info(`linear webhook queued ${placed.action}; ${event.state}`, {
        location: Log.Locations.automation,
        agentId: event.ticket,
      });
      // Ready is a pending drive or mint; a diagnose is never labeled.
      if (placed.action !== "diagnose") {
        yield* Ready.mark(event.ticket);
      }
      return ok;
    }),
  ),
);

// A disconnect must not leave the client killed and the row still running.
const uninterruptible = { uninterruptible: true } as const;

// The job named by its ticket and action closes whether it waits or runs. A pending job has no
// client to stop, so closing its row is the whole abort; a placement that reserved after this
// wins nothing, because running is written only while the row is still pending, and that
// placement releases the reservation. A running job is stopped at the client that took it,
// then its row is closed. A client that answers 404 holds nothing to stop: that is reported,
// and the row is closed all the same, so every caller reads the same 200. A job that is over,
// or was never queued, is refused, and so is one that finished while its client was asked.
export const AbortLive = HttpApiBuilder.group(Api.AutomationServerApi, "Abort", (handlers) =>
  handlers.handle(
    "abort",
    ({ payload }) =>
      Effect.gen(function* () {
        const tests = yield* Tests.TestStore;
        const automation = yield* Automation.AutomationStore;
        const servers = yield* Servers.ServerStore;
        const log = yield* Log.Log;
        const nothingToAbort = ApiErrors.BadRequest.make({
          message: `ticket "${payload.ticket}" has no ${payload.action} to abort`,
          agentId: payload.ticket,
        });
        const result = yield* tests
          .findResultByLinearId(payload.ticket)
          .pipe(
            Effect.mapError((error) =>
              ApiErrors.Internal.make({ cause: error, agentId: payload.ticket }),
            ),
          );
        if (Option.isNone(result)) {
          return yield* nothingToAbort;
        }
        const closedPending = yield* automation
          .abortPending(result.value.id, payload.action)
          .pipe(
            Effect.mapError((error) =>
              ApiErrors.Internal.make({ cause: error, agentId: payload.ticket }),
            ),
          );
        if (closedPending) {
          yield* log.info(`aborted pending ${payload.action}`, {
            location: Log.Locations.automation,
            agentId: payload.ticket,
          });
          if (payload.action !== "diagnose") {
            yield* Ready.release(payload.ticket);
          }
          return ok;
        }
        const job = yield* automation
          .findRunning(result.value.id)
          .pipe(
            Effect.mapError((error) =>
              ApiErrors.Internal.make({ cause: error, agentId: payload.ticket }),
            ),
          );
        if (Option.isNone(job)) {
          return yield* nothingToAbort;
        }
        // One job of a ticket runs at a time; the one running may not be the one named, when
        // the diagnose named closed since and the drive is still on.
        if (job.value.action !== payload.action) {
          return yield* ApiErrors.BadRequest.make({
            message: `ticket "${payload.ticket}" is running a ${job.value.action}, not a ${payload.action}`,
            agentId: payload.ticket,
          });
        }
        if (job.value.serverId === null) {
          return yield* Effect.die(new Error(`running job ${job.value.id} has no serverId`));
        }
        const server = yield* servers
          .findServer(job.value.serverId)
          .pipe(
            Effect.mapError((error) =>
              ApiErrors.Internal.make({ cause: error, agentId: payload.ticket }),
            ),
          );
        if (Option.isNone(server)) {
          return yield* ApiErrors.RunFailed.make({
            message: `unknown server "${job.value.serverId}"`,
          });
        }
        const url = server.value.url;
        // The handler is uninterruptible, and node:http has no ceiling. The wait prints the
        // seconds left and gives up at ten, as dispatch's own stop does.
        const notFound = yield* AbortWait.within(
          url,
          AutomationClient.abort(url, payload.ticket),
        ).pipe(
          Effect.as(Option.none<Errors.AutomationClientError>()),
          Effect.catchTag("AutomationClientError", (error) =>
            error.status === 404
              ? Effect.succeed(Option.some(error))
              : Effect.fail(
                  ApiErrors.RunFailed.make(
                    Object.assign(
                      { message: error.message },
                      error.cause === undefined ? undefined : { cause: error.cause },
                    ),
                  ),
                ),
          ),
        );
        const closed = yield* automation
          .finish(job.value.id, "aborted", "aborted")
          .pipe(
            Effect.mapError((error) =>
              ApiErrors.Internal.make({ cause: error, agentId: payload.ticket }),
            ),
          );
        // The row closed some other way while its client was asked: the job finished, and a
        // finished job has nothing to abort. Its client's 404 was that ending, not JobNotFound.
        if (!closed) {
          return yield* nothingToAbort;
        }
        if (Option.isSome(notFound)) {
          yield* Worker.reportJobNotFound(job.value.id, url, payload.ticket, notFound.value);
        }
        yield* log.info(`aborted ${job.value.action}; ${url}`, {
          location: Log.Locations.automation,
          agentId: payload.ticket,
        });
        if (job.value.action !== "diagnose") {
          yield* Ready.release(payload.ticket);
        }
        return ok;
      }),
    uninterruptible,
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
