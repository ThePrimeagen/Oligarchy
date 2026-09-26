import { Effect } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import type * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as Client from "@oligarchy/db/client";
import * as DbErrors from "@oligarchy/db/errors";
import * as EnvFile from "@oligarchy/env/env-file";
import * as Oligarchy from "@oligarchy/env/oligarchy";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as SharedErrors from "@oligarchy/shared/errors";

// The port the operator's tunnel points at; nothing else of ours is near it.
const DEFAULT_PORT = 54321;

// What main.ts hands the command: the server for its port and the models oligarchy.json names,
// serving until it is stopped or fails.
export type AutomationServer<RServe> = {
  readonly serve: (
    port: number,
    models: Oligarchy.AppConfig["models"],
  ) => Effect.Effect<never, HttpServerError.ServeError, RServe>;
};

type StartupError = DbErrors.DatabaseError | SharedErrors.CommandError | HttpServerError.ServeError;

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
          // The file is the model. A missing one fails here, before the database and before listen.
          const config = yield* Oligarchy.load;
          // Queue rows live in Postgres: fail at startup, not on the first webhook.
          yield* database.ping.pipe(
            Effect.mapError((error) =>
              DbErrors.DatabaseError.make({
                operation: "ping",
                message: `database unreachable: ${Render.errorDetail(ExternalFailure.causeOf(error))}`,
                cause: error,
              }),
            ),
          );
          return yield* server.serve(port, config.models);
        });
        return yield* startup.pipe(
          Effect.tapError((error) =>
            log.fatal(`automation server: ${detail(error)}`, {
              location: Log.Locations.automation,
              agentId: Log.AutomationAgentId,
              cause: error,
            }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The automation server: POST /linear verifies a signed Linear webhook and enqueues drive or diagnose jobs, labeling a newly queued drive or mint ready, then dispatches them to live automation clients; every thirty seconds the check kicks off one new job per live automation client and never more, moving a ticket unchanged for ninety seconds from Backlog to Automation Needed, queuing it, and labeling it ready while that job is pending, or else queuing one unchanged ticket in Automation Needed unless a pending job for that action is already waiting, in which case the ticket is labeled ready and later polls leave it out until that drive or mint finishes, or queuing one in Needs Review the way that webhook would have queued it; dispatch launches jobs one reservation at a time, round robin onto a client whose reserve succeeds, and does not start the next job until that response is back; POST /abort closes a pending job or stops a running one",
    ),
    EnvFile.withEnvFile,
  );
