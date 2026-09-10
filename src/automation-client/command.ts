import { Deferred, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// One above the automation server's, so both run on one host in development.
const DEFAULT_PORT = 54322;

type StartupError = Errors.DatabaseError | Errors.MissingVariable | HttpServerError.ServeError;

// A ServeError says nothing itself; the bind or accept error it wraps does.
const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export type AutomationClient<RServe> = {
  readonly serve: (
    port: number,
    url: Option.Option<string>,
  ) => Layer.Layer<never, StartupError, RServe>;
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
      // No default: the fleet knows a client by the address something reaches it at, which is
      // nothing this process can see. Without it the client announces nothing.
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
        return yield* Effect.raceFirst(
          Layer.launch(server.serve(port, url)),
          Deferred.await(server.serverFailed),
        ).pipe(
          Effect.tapError((error) =>
            log.fatal(`automation client: ${detail(error)}`, {
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
