import { Deferred, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";

// One above the automation server's, so both run on one host in development.
const DEFAULT_PORT = 54322;

export type AutomationClient<RServe> = {
  readonly serve: (port: number) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

export const makeAutomationClientCommand = <RServe>(server: AutomationClient<RServe>) =>
  Command.make(
    "automation-client",
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
          Effect.tapError((error) =>
            log.fatal(`automation client: ${Render.errorDetail(error.cause)}`, {
              location: Log.Locations.automationClient,
              agentId: Log.AutomationClientAgentId,
              cause: error,
            }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The automation client: POST /run launches OpenCode with a prompt and waits until it finishes",
    ),
  );
