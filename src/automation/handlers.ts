import { Effect, FileSystem, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Log from "../observability/log.ts";
import * as ProxyHandlers from "../proxy/handlers.ts";
import * as Middleware from "../proxy/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";

const ok = Contract.Ok.make({});

// A request the service accepted is recorded whole or not at all: a client gone mid-request
// must not leave the line written and the log without it.
const uninterruptible = { uninterruptible: true } as const;

// POST /automate, for now: one line per request appended to `record`, naming the ticket and the
// model as they came. Spawning the agent those two describe is the next step and lands here.
export const AutomationsLive = (record: string) =>
  HttpApiBuilder.group(Api.AutomationApi, "Automations", (handlers) =>
    handlers.handle(
      "automate",
      ({ payload }) =>
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
      uninterruptible,
    ),
  );

export const routes = (record: string) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api.AutomationApi).pipe(
      Layer.provide(AutomationsLive(record)),
      Layer.provide(Layer.mergeAll(Middleware.BearerAuthLive, Middleware.ApiBoundaryLive)),
    ),
    ProxyHandlers.NotFoundRoute,
  );
