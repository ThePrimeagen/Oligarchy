import { Deferred, Effect, Layer, Option } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Client from "../db/client.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Args from "../qemu/args.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

const DEFAULT_PORT = 42069;

// What main.ts hands the command: the host check, the server as a layer for a display, an
// automation flag and a port, and the signal a server error raises after listen.
export type ProxyServer<RHost, RServe> = {
  readonly missingHostRequirements: (
    display: Domain.QemuDisplay,
  ) => Effect.Effect<ReadonlyArray<string>, never, RHost>;
  readonly serve: (
    display: Domain.QemuDisplay,
    automation: boolean,
    port: number,
  ) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

type StartupError =
  | Errors.HostRequirementsMissing
  | Errors.DatabaseError
  | HttpServerError.ServeError;

// A ServeError says nothing itself; the bind or accept error it wraps does.
const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export const makeProxyCommand = <RHost, RServe>(server: ProxyServer<RHost, RServe>) =>
  Command.make(
    "proxy",
    {
      display: Flag.choice("display", Args.QEMU_DISPLAYS).pipe(
        Flag.optional,
        Flag.withDescription(
          "QEMU display backend for every session; none captures without showing a window",
        ),
      ),
      automation: Flag.boolean("automation").pipe(
        Flag.withDefault(false),
        Flag.withDescription("Force the automation QEMU profile for every session"),
      ),
      port: Flag.integer("port").pipe(
        Flag.withDefault(DEFAULT_PORT),
        Flag.withDescription("Listen port"),
      ),
    },
    ({ display, automation, port }) =>
      Effect.gen(function* () {
        if (automation && Option.isSome(display)) {
          return yield* new CliError.UserError({
            cause: new Error("--automation is exclusive"),
            userMessage: "--automation is exclusive",
          });
        }
        const resolved = Option.getOrElse(display, (): Domain.QemuDisplay => "none");
        const log = yield* Log.Log;
        const database = yield* Client.Database;
        const startup = Effect.gen(function* () {
          const missing = yield* server.missingHostRequirements(resolved);
          if (missing.length > 0) {
            return yield* Errors.HostRequirementsMissing.make({ missing });
          }
          // Fail at startup, not on the first request, if the control-plane DB is unreachable.
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
            Layer.launch(server.serve(resolved, automation, port)),
            Deferred.await(server.serverFailed),
          );
        });
        return yield* startup.pipe(
          Effect.tapError((error) => log.fatal(`proxy: ${detail(error)}`, { cause: error })),
        );
      }),
  ).pipe(
    Command.withDescription("The oligarchy proxy: boots QEMU sessions and drives them over QMP"),
  );
