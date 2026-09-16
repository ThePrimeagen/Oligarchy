import {
  Cause,
  Clock,
  Context,
  Effect,
  Layer,
  Queue,
  Ref,
  Result,
  Semaphore,
  Stream,
} from "effect";
import { Socket } from "effect/unstable/socket";
import * as Combat from "./combat.ts";
import * as Contract from "./contract.ts";
import type * as Domain from "./domain.ts";
import * as Lobby from "./lobby.ts";
import * as Room from "./room.ts";

const mapWith = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map([...map, [key, value]]);

const mapWithout = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

const toWire = (snap: Room.Snapshot): Contract.Snapshot =>
  Contract.Snapshot.make({
    you: snap.you,
    youAreCaptain: snap.youAreCaptain,
    captainId: snap.captainId,
    phase: snap.phase,
    startedAtMs: snap.startedAtMs,
    serverNowMs: snap.serverNowMs,
    readyLabel: snap.readyLabel,
    ghostOpacity: snap.ghostOpacity,
    notes: snap.notes,
    players: snap.players,
  });

const make = Effect.gen(function* () {
  const room = yield* Ref.make(Room.empty());
  const connections = yield* Ref.make<
    ReadonlyMap<string, Queue.Queue<Contract.ServerMessage, Cause.Done>>
  >(new Map());
  const seq = yield* Ref.make(0);
  const gate = yield* Semaphore.make(1);

  const broadcast = Effect.fn("Game.broadcast")(function* () {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* Ref.get(room);
    const conns = yield* Ref.get(connections);
    for (const [id, queue] of conns) {
      yield* Queue.offer(queue, toWire(Room.snapshot(current, id, now)));
    }
  });

  const mutate = <A, E>(body: (current: Room.Room) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        return yield* body(yield* Ref.get(room));
      }),
    );

  const fx = (
    playerId: string,
    noteId: number,
    judgment: Domain.Judgment,
    damage: number,
    depth: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const queue = (yield* Ref.get(connections)).get(playerId);
      if (queue === undefined) {
        return;
      }
      yield* Queue.offer(
        queue,
        Contract.JudgmentFx.make({ playerId, noteId, judgment, damage, depth }),
      );
    });

  const leave = (id: string): Effect.Effect<void> =>
    mutate((current) =>
      Effect.gen(function* () {
        const vacated = Lobby.leave(current, id);
        yield* Ref.set(room, vacated.players.length === 0 ? Room.empty() : vacated);
        yield* Ref.update(connections, (map) => mapWithout(map, id));
        yield* broadcast();
      }),
    );

  const ready = (id: string): Effect.Effect<void> =>
    mutate((current) =>
      Effect.gen(function* () {
        const result = Lobby.ready(current, id);
        if (Result.isFailure(result)) {
          return;
        }
        yield* Ref.set(room, result.success);
        yield* broadcast();
      }),
    );

  const start = (id: string): Effect.Effect<void> =>
    mutate((current) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const result = Lobby.start(current, id, now, now);
        if (Result.isFailure(result)) {
          return;
        }
        yield* Ref.set(room, result.success);
        yield* broadcast();
      }),
    );

  const hit = (
    id: string,
    noteId: number,
    direction: Domain.Direction,
    songTimeMs: number,
  ): Effect.Effect<void> =>
    mutate((current) =>
      Effect.gen(function* () {
        const result = Room.hit(current, id, noteId, direction, songTimeMs);
        if (Result.isFailure(result)) {
          return;
        }
        yield* Ref.set(room, result.success.room);
        yield* fx(id, noteId, result.success.judgment, result.success.damage, result.success.depth);
        yield* broadcast();
      }),
    );

  const tick = (id: string, songTimeMs: number): Effect.Effect<void> =>
    mutate((current) =>
      Effect.gen(function* () {
        const player = current.players.find((seat) => seat.id === id);
        if (player === undefined) {
          return;
        }
        const result = Room.tick(current, id, songTimeMs);
        if (Result.isFailure(result)) {
          return;
        }
        const next = result.success.players.find((seat) => seat.id === id);
        if (next === undefined) {
          return;
        }
        const known = new Set(player.judged.map((item) => item.noteId));
        const fresh = next.judged.filter((item) => !known.has(item.noteId));
        if (fresh.length === 0) {
          return;
        }
        yield* Ref.set(room, result.success);
        for (const item of fresh) {
          yield* fx(
            id,
            item.noteId,
            item.judgment,
            Combat.damageFor(item.judgment),
            Combat.depth(next.totalDamage),
          );
        }
        yield* broadcast();
      }),
    );

  const handle = (id: string, message: Contract.ClientMessage): Effect.Effect<void> =>
    Contract.ClientMessage.match(message, {
      Ready: () => ready(id),
      Start: () => start(id),
      Hit: (body) => hit(id, body.noteId, body.direction, body.songTimeMs),
      Tick: (body) => tick(id, body.songTimeMs),
    });

  const attach = Effect.fn("Game.attach")(function* (socket: Socket.Socket) {
    const write = yield* socket.writer;
    const outgoing = yield* Queue.unbounded<Contract.ServerMessage, Cause.Done>();
    const id = String(yield* Ref.updateAndGet(seq, (n) => n + 1));
    const send = (message: Contract.ServerMessage): Effect.Effect<void> =>
      // A closed socket cannot be written; leave is the finalizer.
      write(Contract.encodeServerLine(message)).pipe(Effect.catch(() => Effect.void));

    yield* Effect.forkChild(Stream.fromQueue(outgoing).pipe(Stream.runForEach(send)));

    const joined = yield* mutate((current) =>
      Effect.gen(function* () {
        const result = Lobby.join(current, id);
        if (Result.isFailure(result)) {
          return result;
        }
        yield* Ref.set(room, result.success);
        yield* Ref.update(connections, (map) => mapWith(map, id, outgoing));
        return result;
      }),
    );

    if (Result.isSuccess(joined)) {
      yield* Effect.addFinalizer(() =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            Queue.endUnsafe(outgoing);
            yield* leave(id);
          }),
        ),
      );
    }

    const onOpen = Result.isFailure(joined)
      ? send(Contract.Kicked.make({})).pipe(
          Effect.andThen(
            write(new Socket.CloseEvent(1000, joined.failure.message)).pipe(
              Effect.catch(() => Effect.void),
            ),
          ),
        )
      : broadcast();

    // A closed or malformed socket ends the request; leave is the finalizer.
    yield* socket
      .runString(
        (line) =>
          Contract.decodeClientLine(line).pipe(Effect.flatMap((message) => handle(id, message))),
        { onOpen },
      )
      .pipe(
        Effect.catchTags({
          SocketError: () => Effect.void,
          SchemaError: () => Effect.void,
        }),
      );

    if (Result.isFailure(joined)) {
      Queue.endUnsafe(outgoing);
    }
  });

  return { attach };
});

export class Game extends Context.Service<Game>()("@oligarchy/dig/Game", { make }) {
  static readonly layer: Layer.Layer<Game> = Layer.effect(this)(this.make);
}
