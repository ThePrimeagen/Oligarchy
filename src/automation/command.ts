import { Deferred, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";

// The port the operator's tunnel points at; nothing else of ours is near it.
const DEFAULT_PORT = 54321;

// What main.ts hands the command: the listener as a layer for its port, and the signal a server
// error raises after listen.
export type AutomationServer<RServe> = {
  readonly serve: (port: number) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

// No database to ping and no host to check: the flags parsed, the service listens.
export const makeAutomationCommand = <RServe>(server: AutomationServer<RServe>) =>
  Command.make(
    "automation",
    {
      port: Flag.integer("port").pipe(
        Flag.withDefault(DEFAULT_PORT),
        Flag.withDescription("Listen port"),
      ),
    },
    ({ port }) =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        return yield* Effect.raceFirst(
          Layer.launch(server.serve(port)),
          Deferred.await(server.serverFailed),
        ).pipe(
          // A ServeError says nothing itself; the bind or accept error it wraps does.
          Effect.tapError((error) =>
            log.fatal(`automation: ${Render.errorDetail(error.cause)}`, { cause: error }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The oligarchy automation service: POST /automate names a Linear ticket and a model, and each request is recorded as one line in ~/automation-test",
    ),
  );
