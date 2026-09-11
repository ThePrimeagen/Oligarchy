import { Deferred, Effect, Layer, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Client from "../db/client.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// The port the operator's tunnel points at; nothing else of ours is near it.
const DEFAULT_PORT = 54321;

// The free contributor model: a server started without --model costs nothing to run.
const DEFAULT_MODEL = "opencode/muse-spark-1.3-contributor-free";

// One drive or diagnose at a time unless told otherwise.
const DEFAULT_JOBS = 1;
const Jobs = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(1, { message: "jobs must be at least 1" }),
);

// What main.ts hands the command: the listener as a layer for its port, the model every job runs
// as and how many run at once, and the signal a server error raises after listen.
export type AutomationServer<RServe> = {
  readonly serve: (
    port: number,
    model: string,
    jobs: number,
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
          "The OpenCode model every drive and diagnose runs as, provider/model; the agent records it on its result",
        ),
      ),
      jobs: Flag.integer("jobs").pipe(
        Flag.withSchema(Jobs),
        Flag.withDefault(DEFAULT_JOBS),
        Flag.withDescription("How many drives and diagnoses run at once"),
      ),
    },
    ({ port, model, jobs }) =>
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
            Layer.launch(server.serve(port, model, jobs)),
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
      "The automation server: POST /linear verifies a signed Linear webhook and enqueues drive or diagnose jobs, then dispatches them to live automation clients",
    ),
  );
