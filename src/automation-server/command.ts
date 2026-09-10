import { Deferred, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Client from "../db/client.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Dispatcher from "./dispatcher.ts";

// The port the operator's tunnel points at; nothing else of ours is near it.
const DEFAULT_PORT = 54321;

// What main.ts hands the command: the listener as a layer for its port, and the signal a server
// error raises after listen.
export type AutomationServer<RServe> = {
  readonly serve: (port: number) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

type StartupError = Errors.DatabaseError | HttpServerError.ServeError;

// A ServeError says nothing itself; the bind or accept error it wraps does.
const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export const makeAutomationServerCommand = <RServe>(server: AutomationServer<RServe>) =>
  Command.make(
    "automation-server",
    {
      port: Flag.integer("port").pipe(
        Flag.withDefault(DEFAULT_PORT),
        Flag.withDescription("Listen port"),
      ),
    },
    ({ port }) =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        const database = yield* Client.Database;
        const startup = Effect.gen(function* () {
          // Queue rows live in Postgres: fail at startup, not on the first webhook.
          yield* database.ping.pipe(
            Effect.mapError((error) =>
              Errors.DatabaseError.make({
                operation: "ping",
                message: `database unreachable: ${Render.errorDetail(ExternalFailure.causeOf(error))}`,
                cause: error,
              }),
            ),
          );
          yield* Dispatcher.sweep("automation-server restarted");
          return yield* Effect.raceFirst(
            Layer.launch(server.serve(port)),
            Deferred.await(server.serverFailed),
          );
        });
        return yield* startup.pipe(
          Effect.tapError((error) =>
            log.fatal(`automation server: ${detail(error)}`, {
              location: Log.Locations.automationServer,
              agentId: Log.AutomationAgentId,
              cause: error,
            }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The automation server: POST /linear verifies a signed Linear webhook and enqueues drive or diagnose jobs from status changes",
    ),
  );
