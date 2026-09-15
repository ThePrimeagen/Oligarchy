import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Contract from "../../src/dig/contract.ts";
import * as Domain from "../../src/dig/domain.ts";
import * as Handlers from "../../src/dig/handlers.ts";

const decodeServer = Schema.decodeUnknownSync(Contract.ServerMessage);

const serve = HttpRouter.serve(Handlers.routes, {
  disableLogger: true,
  disableListenLog: true,
}).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const wsUrl = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer;
  const address = server.address;
  if (address._tag === "UnixAddress") {
    return yield* Effect.die("dig http tests need a TCP server");
  }
  const host = address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname;
  return `ws://${host}:${String(address.port)}/ws`;
});

type Conn = {
  readonly socket: WebSocket;
  readonly next: Effect.Effect<Contract.ServerMessage>;
};

const connect = (url: string): Effect.Effect<Conn> =>
  Effect.promise(
    () =>
      new Promise<Conn>((resolve, reject) => {
        const ws = new WebSocket(url);
        const buffered: Array<string> = [];
        const waiters: Array<(data: string) => void> = [];
        let opened = false;
        const fail = (cause: Error) => {
          if (!opened) {
            reject(cause);
          }
        };
        ws.addEventListener("message", (event) => {
          const data = String(event.data);
          if (!opened) {
            opened = true;
            buffered.push(data);
            resolve({
              socket: ws,
              next: Effect.promise(
                () =>
                  new Promise<Contract.ServerMessage>((resolveMsg, rejectMsg) => {
                    const item = buffered.shift();
                    if (item !== undefined) {
                      resolveMsg(decodeServer(JSON.parse(item)));
                      return;
                    }
                    const messageTimer = setTimeout(
                      () => rejectMsg(new Error("websocket message timeout")),
                      5_000,
                    );
                    waiters.push((raw) => {
                      clearTimeout(messageTimer);
                      resolveMsg(decodeServer(JSON.parse(raw)));
                    });
                  }),
              ),
            });
            return;
          }
          const waiter = waiters.shift();
          if (waiter !== undefined) {
            waiter(data);
          } else {
            buffered.push(data);
          }
        });
        ws.addEventListener("error", () => fail(new Error(`websocket error ${url}`)));
      }),
  );

describe("dig page happy path", () => {
  it.effect("serves the cartoon lobby page and the game script", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const page = yield* http.get("/");
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toContain("text/html");
      const html = yield* page.text;
      expect(html).toContain("players ready");
      expect(html).toContain("Ready");
      expect(html).toContain("Start Game");
      expect(html).toContain("game.js");
      const script = yield* http.get("/game.js");
      expect(script.status).toBe(200);
      const js = yield* script.text;
      expect(js).toContain("WASD");
      expect(js).toContain("perfect");
      expect(js).toContain("okay");
    }).pipe(Effect.provide(serve)),
  );

  it.live("seats a joining socket as the captain at 0 / 1 players ready", () =>
    Effect.gen(function* () {
      const url = yield* wsUrl;
      const conn = yield* connect(url);
      const message = yield* conn.next;
      expect(message._tag).toBe("Snapshot");
      if (message._tag !== "Snapshot") {
        return;
      }
      expect(message.readyLabel).toBe("0 / 1 players ready");
      expect(message.youAreCaptain).toBe(true);
      expect(message.phase).toBe("lobby");
      expect(message.players).toHaveLength(1);
      expect(message.players[0]?.ghost).toBe(false);
      expect(message.players[0]?.slot).toBe(0);
      conn.socket.close();
    }).pipe(Effect.provide(serve)),
  );
});

describe("dig sockets unhappy path", () => {
  it.live("kicks a fifth player and leaves the four seats filled", () =>
    Effect.gen(function* () {
      const url = yield* wsUrl;
      const seated: Array<Conn> = [];
      for (let i = 0; i < Domain.SLOT_COUNT; i++) {
        const conn = yield* connect(url);
        seated.push(conn);
        const message = yield* conn.next;
        expect(message._tag).toBe("Snapshot");
      }
      const extra = yield* connect(url);
      const kicked = yield* extra.next;
      expect(kicked._tag).toBe("Kicked");
      if (kicked._tag !== "Kicked") {
        return;
      }
      expect(kicked.message).toBe("the room is full");
      expect(seated).toHaveLength(Domain.SLOT_COUNT);
      extra.socket.close();
      for (const conn of seated) {
        conn.socket.close();
      }
    }).pipe(Effect.provide(serve)),
  );
});
