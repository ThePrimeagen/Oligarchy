import { createServer, type Server } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Deferred, Effect, Exit, Layer } from "effect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerError from "effect/unstable/http/HttpServerError";

const HOST = "127.0.0.1";

export type Serving<ER, RR, EL, RL, A, ES, RS> = {
  readonly port: number;
  // The api and the catch-all, as HttpRouter.serve takes them.
  readonly routes: Layer.Layer<never, ER, RR>;
  // What the routes and `listening` share, built once the port is bound: a port refusal is one
  // failure with nothing built to stop.
  readonly services: Layer.Layer<A, ES, RS>;
  // Run once listening, in the server's scope: the listen line and the background work, which a
  // port refusal never starts and a shutdown stops before the server closes.
  readonly listening: Effect.Effect<void, EL, RL>;
  // The first server error, a bind error or a later one, before the serve ends with it; the
  // platform drops its own error listener once the server is up.
  readonly onError?: (cause: Error) => void;
};

// Serves on `server` until the scope ends or the server fails: a bind error or the first later
// server error is the ServeError it fails with, and only the first counts, so later accept errors
// cannot end it twice. Neither Effect's request logger nor its listen line runs, and no
// http.server span reaches Sentry, so a domain span stays a root.
export const serveOn =
  (server: Server) =>
  <ER, RR, EL, RL, A, ES, RS>(serving: Serving<ER, RR, EL, RL, A, ES, RS>) =>
    Effect.suspend(() => {
      const failed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
      // onError before the deferred: completing it wakes the race, and a shutdown that follows
      // reads what onError wrote.
      server.on("error", (cause) => {
        if (Deferred.isDoneUnsafe(failed)) {
          return;
        }
        serving.onError?.(cause);
        Deferred.doneUnsafe(failed, Exit.fail(new HttpServerError.ServeError({ cause })));
      });
      const live = Layer.effectDiscard(serving.listening).pipe(
        Layer.provide(
          HttpRouter.serve(serving.routes, { disableLogger: true, disableListenLog: true }),
        ),
        Layer.provide(serving.services),
        Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port: serving.port })),
        Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
      );
      return Effect.raceFirst(Layer.launch(live), Deferred.await(failed));
    });

// Serves on a fresh node:http server bound to 127.0.0.1:`port`.
export const serve = <ER, RR, EL, RL, A, ES, RS>(serving: Serving<ER, RR, EL, RL, A, ES, RS>) =>
  Effect.suspend(() => serveOn(createServer())(serving));
