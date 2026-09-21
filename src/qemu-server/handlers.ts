import { Effect, Layer, Stream } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import type * as Qemu from "../qemu/qemu.ts";
import * as Api from "../shared/api.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Middleware from "./middleware.ts";
import * as Sessions from "./sessions.ts";

const encoder = new TextEncoder();

const ok = Contract.Ok.make({});

// The modifiers key is absent, never undefined, so the gesture carries it only when the wire did.
const click = (
  tag: "click" | "double-click",
  payload: Contract.MouseClickBody,
): Qemu.MouseGesture =>
  Object.assign(
    { _tag: tag, x: payload.x, y: payload.y, button: payload.button },
    payload.modifiers === undefined ? undefined : { modifiers: payload.modifiers },
  );

// The session-driving routes are uninterruptible: a client disconnect interrupts the request's
// fiber, and a state transition torn in half leaves a machine the sessions map never received —
// unreachable and unkillable — or a kill that went unrecorded.
const uninterruptible = { uninterruptible: true } as const;

export const SessionsLive = (display: Domain.QemuDisplay, automation: boolean) =>
  HttpApiBuilder.group(Api.QemuServerApi, "Sessions", (handlers) =>
    handlers
      .handle(
        "reserve",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            if (payload.resume === undefined) {
              yield* sessions.reserve(payload.agent);
            } else {
              yield* sessions.reserve(payload.agent, payload.resume);
            }
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "relinquish",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            yield* sessions.relinquish(payload.agent);
            return ok;
          }),
        uninterruptible,
      )
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
      .handle("minted", ({ query }) =>
        Effect.gen(function* () {
          const sessions = yield* Sessions.Sessions;
          return Contract.Minted.make({
            iso: query.iso,
            minted: yield* sessions.minted(query.iso),
          });
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
        "save",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.save(live);
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
        "mouseMove",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(live, { _tag: "move", x: payload.x, y: payload.y });
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "mouseClick",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(live, click("click", payload));
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "mouseDoubleClick",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(live, click("double-click", payload));
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "mouseScroll",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(live, {
              _tag: "scroll",
              x: payload.x,
              y: payload.y,
              direction: payload.direction,
              ticks: payload.ticks,
            });
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "mouseDrag",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(
              live,
              Object.assign(
                {
                  _tag: "drag" as const,
                  from: payload.from,
                  to: payload.to,
                  button: payload.button,
                },
                payload.modifiers === undefined ? undefined : { modifiers: payload.modifiers },
              ),
            );
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "mouseHold",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(live, {
              _tag: "hold",
              x: payload.x,
              y: payload.y,
              button: payload.button,
            });
            return ok;
          }),
        uninterruptible,
      )
      .handle(
        "mouseRelease",
        ({ payload }) =>
          Effect.gen(function* () {
            const sessions = yield* Sessions.Sessions;
            const live = yield* sessions.lookup(payload.id, payload.agent);
            yield* sessions.mouse(live, {
              _tag: "release",
              x: payload.x,
              y: payload.y,
              button: payload.button,
            });
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
