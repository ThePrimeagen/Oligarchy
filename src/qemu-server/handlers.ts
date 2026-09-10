import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Middleware from "./middleware.ts";
import * as Sessions from "./sessions.ts";

const encoder = new TextEncoder();

const ok = Contract.Ok.make({});

// The session-driving routes are uninterruptible: a client disconnect interrupts the request's
// fiber, and a state transition torn in half leaves a machine the sessions map never received —
// unreachable and unkillable — or a kill that went unrecorded.
const uninterruptible = { uninterruptible: true } as const;

export const SessionsLive = (display: Domain.QemuDisplay, automation: boolean) =>
  HttpApiBuilder.group(Api.QemuServerApi, "Sessions", (handlers) =>
    handlers
      .handle(
        "start",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const id = yield* sessions.start(payload, display, automation);
            return Contract.StartResponse.make({ id });
          }),
        uninterruptible,
      )
      .handle(
        "image",
        ({ query }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(query.id, query.agent);
            const { png, imageId } = yield* sessions.image(live);
            return HttpApiSchema.withHeaders({
              body: png,
              headers: { "x-image-url": Contract.StoredImageUrl(imageId) },
            });
          }),
        uninterruptible,
      )
      .handle(
        "serial",
        ({ query }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(query.id, query.agent);
            return yield* sessions.serial(live);
          }),
        uninterruptible,
      )
      .handleRaw("follow", ({ query }) =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          const events = yield* sessions.follow(query.id);
          return HttpServerResponse.stream(
            Stream.map(events, (event) => encoder.encode(Domain.encodeFollowLine(event))),
            { contentType: "application/x-ndjson" },
          );
        }),
      )
      .handle("stats", () =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          return yield* sessions.stats;
        }),
      )
      .handle(
        "stop",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.stop(live, payload.status, payload.reason);
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "sendKeys",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.sendKeys(live, payload.keys, payload.encoding);
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "sendMouse",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.sendMouse(live, payload);
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "intentStart",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.intentStart(live, payload.test_result_id, payload.message);
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "intentEnd",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.intentEnd(live);
            return ok;
          }),
        uninterruptible,
      ),
  );

const notFound = HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 });

export const NotFoundRoute = HttpRouter.add("*", "*", notFound);

export const routes = (display: Domain.QemuDisplay, automation: boolean) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(Api.QemuServerApi).pipe(
      Layer.provide(SessionsLive(display, automation)),
      Layer.provide(Layer.mergeAll(Middleware.BearerAuthLive, Middleware.ApiBoundaryLive)),
    ),
    NotFoundRoute,
  );
