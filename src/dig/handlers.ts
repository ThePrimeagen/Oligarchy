import { Effect, Encoding, Layer, Result } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Game from "./game.ts";
import * as Page from "./page.ts";
import * as Sprites from "./sprites.ts";

const png = (b64: string) =>
  HttpServerResponse.uint8Array(Result.getOrThrow(Encoding.decodeBase64(b64)), {
    contentType: "image/png",
  });

const grassPng = png(Sprites.grass);
const dirtPng = png(Sprites.dirt);
const crackedPng = png(Sprites.cracked);
const minerPng = png(Sprites.miner);
const minerSwingPng = png(Sprites.minerSwing);

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
  HttpRouter.add("GET", "/sprite/grass.png", grassPng),
  HttpRouter.add("GET", "/sprite/dirt.png", dirtPng),
  HttpRouter.add("GET", "/sprite/cracked.png", crackedPng),
  HttpRouter.add("GET", "/sprite/miner.png", minerPng),
  HttpRouter.add("GET", "/sprite/miner-swing.png", minerSwingPng),
  HttpRouter.add("GET", "/ws", ws),
).pipe(HttpRouter.provideRequest(Game.Game.layer));
