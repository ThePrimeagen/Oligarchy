import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as QemuServerHandlers from "../qemu-server/handlers.ts";
import * as Middleware from "../qemu-server/middleware.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Router from "./router.ts";

const ok = Contract.Ok.make({});

// As on the qemu server: a client that disconnects mid-start must not tear the forward in half, or the
// routing table never learns of the machine the server booted for it.
const uninterruptible = { uninterruptible: true } as const;

export const SessionsLive = HttpApiBuilder.group(Api.QemuReverseProxyApi, "Sessions", (handlers) =>
  handlers
    .handle(
      "start",
      ({ payload, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.start(request, payload.agent);
        }),
      uninterruptible,
    )
    .handle(
      "image",
      ({ query, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, query.id, query.agent);
        }),
      uninterruptible,
    )
    .handle(
      "serial",
      ({ query, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, query.id, query.agent);
        }),
      uninterruptible,
    )
    .handle("follow", ({ query, request }) =>
      Effect.gen(function* () {
        const router = yield* Router.Router;
        return yield* router.forward(request, query.id);
      }),
    )
    .handle(
      "stop",
      ({ payload, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, payload.id, payload.agent);
        }),
      uninterruptible,
    )
    .handle(
      "sendKeys",
      ({ payload, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, payload.id, payload.agent);
        }),
      uninterruptible,
    )
    .handle(
      "sendMouse",
      ({ payload, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, payload.id, payload.agent);
        }),
      uninterruptible,
    )
    .handle(
      "intentStart",
      ({ payload, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, payload.id, payload.agent);
        }),
      uninterruptible,
    )
    .handle(
      "intentEnd",
      ({ payload, request }) =>
        Effect.gen(function* () {
          const router = yield* Router.Router;
          return yield* router.forward(request, payload.id, payload.agent);
        }),
      uninterruptible,
    ),
);

export const ServersLive = HttpApiBuilder.group(Api.QemuReverseProxyApi, "Servers", (handlers) =>
  handlers
    .handle("register", ({ payload }) =>
      Effect.gen(function* () {
        const router = yield* Router.Router;
        yield* router.register(payload.url);
        return ok;
      }),
    )
    .handle("unregister", ({ payload }) =>
      Effect.gen(function* () {
        const router = yield* Router.Router;
        yield* router.unregister(payload.url);
        return ok;
      }),
    )
    .handle("servers", () =>
      Effect.gen(function* () {
        const router = yield* Router.Router;
        return yield* router.servers;
      }),
    ),
);

export const routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api.QemuReverseProxyApi).pipe(
    Layer.provide(Layer.mergeAll(SessionsLive, ServersLive)),
    Layer.provide(Layer.mergeAll(Middleware.BearerAuthLive, Middleware.RouteBoundaryLive)),
  ),
  QemuServerHandlers.NotFoundRoute,
);
