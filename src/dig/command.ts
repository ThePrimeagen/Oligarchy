import { Deferred, Effect, Layer } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import type * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as EnvFile from "../env-file.ts";

const DEFAULT_PORT = 8080;

export type DigServer<RServe> = {
  readonly serve: (port: number) => Layer.Layer<never, HttpServerError.ServeError, RServe>;
  readonly serverFailed: Deferred.Deferred<never, HttpServerError.ServeError>;
};

export const makeDigCommand = <RServe>(server: DigServer<RServe>) =>
  Command.make(
    "dig",
    {
      port: Flag.integer("port").pipe(
        Flag.withDefault(DEFAULT_PORT),
        Flag.withDescription("Listen port"),
      ),
    },
    ({ port }) =>
      Effect.raceFirst(Layer.launch(server.serve(port)), Deferred.await(server.serverFailed)),
  ).pipe(
    Command.withDescription(
      "The four-spot rhythm digging game: sit in a lobby, ready up, and dig dirt to WASD",
    ),
    EnvFile.withEnvFile,
  );
