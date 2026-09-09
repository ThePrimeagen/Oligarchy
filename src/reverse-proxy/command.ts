import { Deferred, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Client from "../db/client.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";

// One above the proxy's, so both run on one host in development.
const DEFAULT_PORT = 42070;
// The operator's page, on a port of its own: the API port wants a bearer on every request and a
// browser has none to send.
const DEFAULT_DIAGNOSTICS_PORT = 55445;

// What main.ts hands the command: the two listeners as one layer for their ports and the config
// file's word on the agent program, and the signal a server error raises after listen. The layer
// fails before listening when the program's own requirement is missing: Cursor's key, or opencode
// on PATH.
export type ReverseProxyServer<RServe> = {
  readonly serve: (
    port: number,
    diagnosticsPort: number,
    config: Config.ReverseProxyFile,
  ) => Layer.Layer<
    never,
    HttpServerError.ServeError | Errors.MissingVariable | Errors.HostRequirementsMissing,
    RServe
  >;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

type StartupError =
  | Errors.InvalidConfig
  | Errors.DatabaseError
  | Errors.MissingVariable
  | Errors.HostRequirementsMissing
  | HttpServerError.ServeError;

// A ServeError says nothing itself; the bind or accept error it wraps does.
const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export const makeReverseProxyCommand = <RServe>(server: ReverseProxyServer<RServe>) =>
  Command.make(
    "reverse-proxy",
    {
      port: Flag.integer("port").pipe(
        Flag.withDefault(DEFAULT_PORT),
        Flag.withDescription("Listen port"),
      ),
      diagnosticsPort: Flag.integer("diagnostics-port").pipe(
        Flag.withDefault(DEFAULT_DIAGNOSTICS_PORT),
        Flag.withDescription(
          "Port of the diagnostics page: the servers, an add box, a delete button each",
        ),
      ),
      config: Flag.string("config").pipe(
        Flag.withDefault(Config.DEFAULT_REVERSE_PROXY_CONFIG),
        Flag.withDescription(
          `Config file naming the agent program, cursor or opencode; ${Config.DEFAULT_REVERSE_PROXY_CONFIG} in the working directory when omitted`,
        ),
      ),
    },
    ({ port, diagnosticsPort, config: configPath }) =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        const database = yield* Client.Database;
        const startup = Effect.gen(function* () {
          // Configuration first: the file is read before anything is reached for.
          const config = yield* Config.readReverseProxyFile(configPath);
          // The routes are rows: fail at startup, not on the first request, without the database.
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
            Layer.launch(server.serve(port, diagnosticsPort, config)),
            Deferred.await(server.serverFailed),
          );
        });
        return yield* startup.pipe(
          Effect.tapError((error) =>
            log.fatal(`reverse proxy: ${detail(error)}`, { cause: error }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The oligarchy reverse proxy: registers servers, routes each session's requests to the server that started it, and spawns the agents its config names",
    ),
  );
