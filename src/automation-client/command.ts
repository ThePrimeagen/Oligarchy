import { Deferred, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Client from "../db/client.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

const DEFAULT_PORT = 42071;

export type AutomationClientServer<RHost, RServe> = {
  readonly missingHostRequirements: Effect.Effect<ReadonlyArray<string>, never, RHost>;
  readonly serve: (
    port: number,
    url: Option.Option<string>,
  ) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

type StartupError =
  | Errors.HostRequirementsMissing
  | Errors.DatabaseError
  | HttpServerError.ServeError;

const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export const makeAutomationClientCommand = <RHost, RServe>(
  server: AutomationClientServer<RHost, RServe>,
) =>
  Command.make(
    "automation-client",
    {
      port: Flag.integer("port").pipe(
        Flag.withDefault(DEFAULT_PORT),
        Flag.withDescription("Listen port"),
      ),
      url: Flag.string("url").pipe(
        Flag.withSchema(Domain.ServerUrl),
        Flag.optional,
        Flag.withDescription(
          "Announce this client to the fleet under this url, every 30 seconds, and delete the row on shutdown",
        ),
      ),
    },
    ({ port, url }) =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        const database = yield* Client.Database;
        const startup = Effect.gen(function* () {
          const missing = yield* server.missingHostRequirements;
          if (missing.length > 0) {
            return yield* Errors.HostRequirementsMissing.make({ missing });
          }
          yield* database.ping.pipe(
            Effect.mapError((error) =>
              Errors.DatabaseError.make({
                operation: "ping",
                message: `database unreachable: ${Render.errorDetail(ExternalFailure.causeOf(error))}`,
                cause: error,
              }),
            ),
          );
          return yield* Effect.raceFirst(
            Layer.launch(server.serve(port, url)),
            Deferred.await(server.serverFailed),
          );
        });
        return yield* startup.pipe(
          Effect.tapError((error) =>
            log.fatal(`automation-client: ${detail(error)}`, {
              ...Log.AutomationClientProcessAttribution,
              cause: error,
            }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The oligarchy automation client: POST /run drives one agent prompt to completion on this host and announces itself to the fleet as an automation server",
    ),
  );
