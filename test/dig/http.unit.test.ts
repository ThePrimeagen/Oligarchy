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
      expect(html).toContain('id="ready" type="button" disabled');
      expect(html).toContain('id="start" type="button" disabled');
      const script = yield* http.get("/game.js");
      expect(script.status).toBe(200);
      const js = yield* script.text;
      expect(js).toContain("WASD");
      expect(js).toContain("perfect");
      expect(js).toContain("okay");
      expect(js).toContain("startedAtMs");
      expect(js).toContain("serverNowMs");
      expect(js).toContain("resume");
      expect(js).toContain(String(Domain.MUSIC_LEAD_MS));
      expect(js).toContain("isoCube");
      expect(js).toContain("drawImage");
      expect(js).toContain("drawSprite");
      expect(js).toContain("/sprite/grass.png");
      expect(js).toContain("/sprite/dirt.png");
      expect(js).toContain("/sprite/cracked.png");
      expect(js).toContain("/sprite/miner.png");
      expect(js).toContain("/sprite/miner-swing.png");
      expect(js).toContain("shatter");
      expect(js).toContain("faceCube");
      expect(js).toContain("visibleDrop");
      expect(js).toContain(String(Domain.DIRT_HP));
    }).pipe(Effect.provide(serve)),
  );

  it.effect("serves the grass, dirt, cracked, and miner cube sprites as png", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const names = ["grass", "dirt", "cracked", "miner", "miner-swing"];
      for (const name of names) {
        const res = yield* http.get(`/sprite/${name}.png`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("image/png");
        const bytes = new Uint8Array(yield* res.arrayBuffer);
        expect(bytes[0]).toBe(0x89);
        expect(bytes[1]).toBe(0x50);
        expect(bytes[2]).toBe(0x4e);
        expect(bytes[3]).toBe(0x47);
        expect(bytes.length).toBeGreaterThan(800);
      }
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
      expect(message.players[0]?.judged).toEqual([]);
      conn.socket.close();
    }).pipe(Effect.provide(serve)),
  );

  it.live("ready, start, and a perfect hit dig and report the judgment", () =>
    Effect.gen(function* () {
      const url = yield* wsUrl;
      const conn = yield* connect(url);
      expect((yield* conn.next)._tag).toBe("Snapshot");
      conn.socket.send(JSON.stringify({ _tag: "Ready" }));
      const readied = yield* conn.next;
      expect(readied._tag).toBe("Snapshot");
      if (readied._tag !== "Snapshot") {
        return;
      }
      expect(readied.readyLabel).toBe("1 / 1 players ready");
      expect(readied.youAreCaptain).toBe(true);
      conn.socket.send(JSON.stringify({ _tag: "Start" }));
      const started = yield* conn.next;
      expect(started._tag).toBe("Snapshot");
      if (started._tag !== "Snapshot") {
        return;
      }
      expect(started.phase).toBe("playing");
      expect(started.startedAtMs).toBeGreaterThan(0);
      expect(started.serverNowMs).toBeGreaterThanOrEqual(started.startedAtMs);
      const note = started.notes[0];
      expect(note?.hitMs).toBe(Domain.MUSIC_LEAD_MS);
      expect(note).toBeDefined();
      if (note === undefined) {
        return;
      }
      conn.socket.send(
        JSON.stringify({
          _tag: "Hit",
          noteId: note.id,
          direction: note.direction,
          songTimeMs: note.hitMs,
        }),
      );
      let fx: Contract.ServerMessage | undefined;
      let snap: Contract.Snapshot | undefined;
      while (fx === undefined || snap === undefined) {
        const message = yield* conn.next;
        if (message._tag === "JudgmentFx") {
          fx = message;
        }
        if (message._tag === "Snapshot") {
          snap = message;
        }
      }
      expect(fx._tag).toBe("JudgmentFx");
      if (fx._tag !== "JudgmentFx") {
        return;
      }
      expect(fx.judgment).toBe("perfect");
      expect(fx.damage).toBe(1.25);
      expect(fx.depth).toBe(1.25 / Domain.DIRT_HP);
      expect(snap.players[0]?.depth).toBe(1.25 / Domain.DIRT_HP);
      expect(snap.players[0]?.judged).toEqual([{ noteId: note.id, judgment: "perfect" }]);
      conn.socket.close();
    }).pipe(Effect.provide(serve)),
  );
});

describe("dig page unhappy path", () => {
  it.effect("does not serve a sprite that is not a cube or miner", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const res = yield* http.get("/sprite/nope.png");
      expect(res.status).toBe(404);
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

  it.live("drops a malformed socket and keeps the seated player", () =>
    Effect.gen(function* () {
      const url = yield* wsUrl;
      const captain = yield* connect(url);
      expect((yield* captain.next)._tag).toBe("Snapshot");
      const extra = yield* connect(url);
      expect((yield* extra.next)._tag).toBe("Snapshot");
      expect((yield* captain.next)._tag).toBe("Snapshot");
      extra.socket.send("not-json");
      const after = yield* captain.next;
      expect(after._tag).toBe("Snapshot");
      if (after._tag !== "Snapshot") {
        return;
      }
      expect(after.players).toHaveLength(1);
      expect(after.youAreCaptain).toBe(true);
      extra.socket.close();
      captain.socket.close();
    }).pipe(Effect.provide(serve)),
  );
});
