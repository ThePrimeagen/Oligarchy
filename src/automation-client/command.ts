import { Deferred, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Client from "../db/client.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// One above the automation server's, so both run on one host in development.
const DEFAULT_PORT = 54322;

export type AutomationClient<RServe> = {
  readonly serve: (
    maxJobs: number,
    port: number,
    url: Option.Option<string>,
  ) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

type StartupError = Errors.DatabaseError | HttpServerError.ServeError;

// A ServeError says nothing itself; the bind or accept error it wraps does.
const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export const makeAutomationClientCommand = <RServe>(server: AutomationClient<RServe>) =>
  Command.make(
    "automation-client",
    {
      // No default: how many OpenCode runs a host carries at once is the operator's knowledge of
      // that host, and a guess would under-use a large one or overload a small one.
      maxJobs: Flag.integer("max-jobs").pipe(
        Flag.withSchema(Domain.MaxJobs),
        Flag.withDescription(
          "How many runs this client carries at once; a run past it is refused with 503",
        ),
      ),
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
    ({ maxJobs, port, url }) =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        const database = yield* Client.Database;
        const startup = Effect.gen(function* () {
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
            Layer.launch(server.serve(maxJobs, port, url)),
            Deferred.await(server.serverFailed),
          );
        });
        return yield* startup.pipe(
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
      "The automation client: POST /run launches OpenCode with a prompt and waits until it finishes; POST /abort kills the matching run by ticket",
    ),
  );
