import { Deferred, Effect, Layer } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import type * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as Client from "../db/client.ts";
import * as EnvFile from "../env-file.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// The port the operator's tunnel points at; nothing else of ours is near it.
const DEFAULT_PORT = 54321;

// The paid contributor model oligarchy.json names. A server started without --model
// runs that, which is what ./driver sends to OpenRouter.
const DEFAULT_MODEL = "openrouter/meta/muse-spark-1.3-contributor";

// What main.ts hands the command: the listener as a layer for its port, the model every job runs
// as, and the signal a server error raises after listen.
export type AutomationServer<RServe> = {
  readonly serve: (
    port: number,
    model: string,
  ) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
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
      model: Flag.string("model").pipe(
        Flag.withSchema(Domain.ModelId),
        Flag.withDefault(DEFAULT_MODEL),
        Flag.withDescription(
          "The OpenRouter model every drive and diagnose runs as, provider/model; the harness records it on the result",
        ),
      ),
    },
    ({ port, model }) =>
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
          return yield* Effect.raceFirst(
            Layer.launch(server.serve(port, model)),
            Deferred.await(server.serverFailed),
          );
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
