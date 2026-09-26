import { createServer, type Server } from "node:http";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Serve from "../src/serve.ts";

const ping = HttpRouter.add("GET", "/ping", HttpServerResponse.text("pong"));

// A port nothing listens on: bound by the OS, then let go.
const freePort = Effect.callback<number>((resume) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    probe.close(() => resume(Effect.succeed(port)));
  });
});

// A server already holding `port`, closed with the test's scope.
const occupy = (port: number) =>
  Effect.acquireRelease(
    Effect.callback<Server>((resume) => {
      const holder = createServer();
      holder.listen(port, "127.0.0.1", () => resume(Effect.succeed(holder)));
    }),
    (holder) => Effect.callback<void>((resume) => void holder.close(() => resume(Effect.void))),
  );

const get = (port: number, path: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.get(`http://127.0.0.1:${String(port)}${path}`);
    return { status: response.status, text: yield* response.text };
  }).pipe(Effect.provide(FetchHttpClient.layer));

describe("serve happy path", () => {
  it.live(
    "binds the port, builds the services, serves the routes and runs `listening` in that scope",
    () =>
      Effect.gen(function* () {
        const port = yield* freePort;
        const order: Array<string> = [];
        const listening = yield* Deferred.make<void>();
        const services = Layer.effectDiscard(
          // The port is bound before a service exists.
          Effect.flatMap(get(port, "/ping").pipe(Effect.exit), (answered) =>
            Effect.sync(() => void order.push(Exit.isSuccess(answered) ? "services" : "unbound")),
          ),
        );
        const serving = yield* Effect.forkChild(
          Serve.serve({
            port,
            routes: ping,
            services,
            listening: Effect.gen(function* () {
              order.push("listening");
              yield* Effect.addFinalizer(() => Effect.sync(() => void order.push("closed")));
              yield* Deferred.succeed(listening, undefined);
            }),
          }),
        );
        yield* Deferred.await(listening);
        expect(yield* get(port, "/ping")).toEqual({ status: 200, text: "pong" });
        yield* Fiber.interrupt(serving);
        expect(order).toEqual(["services", "listening", "closed"]);
        expect(Exit.isFailure(yield* Effect.exit(get(port, "/ping")))).toBe(true);
      }),
  );
});

describe("serve unhappy path", () => {
  it.live("a port already in use fails with ServeError before any service or listening", () =>
    Effect.gen(function* () {
      const port = yield* freePort;
      yield* occupy(port);
      const built: Array<string> = [];
      const errors: Array<Error> = [];
      const error = yield* Effect.flip(
        Serve.serve({
          port,
          routes: ping,
          services: Layer.effectDiscard(Effect.sync(() => void built.push("services"))),
          listening: Effect.sync(() => void built.push("listening")),
          onError: (cause) => void errors.push(cause),
        }),
      );
      expect(error._tag).toBe("ServeError");
      expect(String(error.cause)).toContain("EADDRINUSE");
      expect(built).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live(
    "a server error after listen runs onError once and ends the serve with it; a second error runs nothing",
    () =>
      Effect.gen(function* () {
        const port = yield* freePort;
        const server = createServer();
        const listening = yield* Deferred.make<void>();
        const seen: Array<Error> = [];
        const serving = yield* Effect.forkChild(
          Serve.serveOn(server)({
            port,
            routes: ping,
            listening: Deferred.succeed(listening, undefined),
            onError: (cause) => void seen.push(cause),
          }),
        );
        yield* Deferred.await(listening);
        const first = new Error("accept EMFILE: too many open files");
        server.emit("error", first);
        const exit = yield* Fiber.await(serving);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({
          _tag: "ServeError",
          cause: first,
        });
        server.emit("error", new Error("accept EMFILE again"));
        expect(seen).toEqual([first]);
      }),
  );
});
