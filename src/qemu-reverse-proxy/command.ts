import { Deferred, Effect, Layer } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import type * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as EnvFile from "@oligarchy/env/env-file";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as Client from "../db/client.ts";
import * as Errors from "../shared/errors.ts";

// One above the qemu server's, so both run on one host in development.
const DEFAULT_PORT = 42070;

// What main.ts hands the command: the listener as a layer for its port, and the signal a server
// error raises after listen.
export type QemuReverseProxyServer<RServe> = {
  readonly serve: (port: number) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

type StartupError = Errors.DatabaseError | HttpServerError.ServeError;

// A ServeError says nothing itself; the bind or accept error it wraps does.
const detail = (error: StartupError): string =>
  error._tag === "ServeError" ? Render.errorDetail(error.cause) : Render.errorDetail(error);

export const makeQemuReverseProxyCommand = <RServe>(server: QemuReverseProxyServer<RServe>) =>
  Command.make(
    "qemu-reverse-proxy",
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
            Layer.launch(server.serve(port)),
            Deferred.await(server.serverFailed),
          );
        });
        return yield* startup.pipe(
          Effect.tapError((error) =>
            log.fatal(`qemu reverse proxy: ${detail(error)}`, {
              location: Log.Locations.server,
              cause: error,
            }),
          ),
        );
      }),
  ).pipe(
    Command.withDescription(
      "The qemu reverse proxy: registers servers and routes each session's requests to the server that started it",
    ),
    EnvFile.withEnvFile,
  );
