import { Effect, Layer } from "effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import * as Sessions from "./sessions.ts";

const ok = Contract.Ok.make({});

// A client that disconnects mid-run must not kill the driver: the work is the process, not the
// HTTP conversation that launched it. Abort is the one path that may.
const uninterruptible = { uninterruptible: true } as const;

export const RunsLive = HttpApiBuilder.group(Api.AutomationClientApi, "Runs", (handlers) =>
  handlers
    .handle(
      "reserve",
      ({ payload }) =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          if (payload.action === "mint" && payload.server === undefined) {
            return yield* Errors.BadRequest.make({
              message: "a mint reserves its pinned server",
              agentId: payload.ticket,
            });
          }
          yield* sessions.reserve(payload.ticket, payload.action, payload.resume, payload.server);
          return ok;
        }),
      uninterruptible,
    )
    .handle(
      "run",
      ({ payload }) =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.run(
            payload.ticket,
            payload.prompt,
            payload.testResultId,
            payload.testDefinition,
            payload.testProof,
            payload.serverUrl,
          );
          return ok;
        }),
      uninterruptible,
    )
    .handle(
      "abort",
      ({ payload }) =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          yield* sessions.abort(payload.ticket);
          return ok;
        }),
      uninterruptible,
    ),
);

export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.AutomationClientApi).pipe(
    Layer.provide(RunsLive),
    Layer.provide(Layer.mergeAll(Middleware.BearerAuthLive, Middleware.ApiBoundaryLive)),
  ),
  QemuServerHandlers.NotFoundRoute,
);
