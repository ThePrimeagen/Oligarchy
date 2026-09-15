import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as Game from "./game.ts";
import * as Page from "./page.ts";

const ws = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const socket = yield* Effect.orDie(request.upgrade);
  const game = yield* Game.Game;
  yield* game.attach(socket);
  return HttpServerResponse.empty();
});

export const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.html(Page.html)),
  HttpRouter.add(
    "GET",
    "/game.js",
    HttpServerResponse.text(Page.script, { contentType: "text/javascript; charset=utf-8" }),
  ),
  HttpRouter.add("GET", "/ws", ws),
).pipe(HttpRouter.provideRequest(Game.Game.layer));
