import { mkdtempSync, rmSync, statSync } from "node:fs";
import * as Net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Result, Scope, Stream } from "effect";
import * as Framing from "../../src/qmp/framing.ts";
import * as Socket from "../../src/qmp/socket.ts";
import type * as Domain from "../../src/shared/domain.ts";

let dir = "";
let path = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oligarchy-qmp-"));
  path = join(dir, "qmp.sock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Peer = {
  readonly socket: Net.Socket;
  readonly received: Array<string>;
  readonly closed: Promise<void>;
};

// A node:net client standing in for QEMU.
const connect = (to: string): Effect.Effect<Peer> =>
  Effect.callback<Peer>((resume) => {
    const socket = Net.createConnection(to);
    const received: Array<string> = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      received.push(chunk);
    });
    const closed = new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });
    socket.once("connect", () => resume(Effect.succeed({ socket, received, closed })));
    socket.once("error", (error) => resume(Effect.die(error)));
  });

const connectRefused = (to: string): Effect.Effect<string> =>
  Effect.callback<string>((resume) => {
    const socket = Net.createConnection(to);
    socket.once("connect", () => {
      socket.destroy();
      resume(Effect.succeed("connected"));
    });
    socket.once("error", (error: NodeJS.ErrnoException) =>
      resume(Effect.succeed(error.code ?? "")),
    );
  });

const peerWrite = (peer: Peer, text: string): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    peer.socket.write(text, () => resume(Effect.void));
  });

const frames = (
  lines: Stream.Stream<string, unknown>,
  count: number,
): Effect.Effect<ReadonlyArray<Domain.QmpInbound>> =>
  Effect.gen(function* () {
    const collected: Array<Domain.QmpInbound> = [];
    let rest = "";
    yield* lines.pipe(
      Stream.tap((chunk) =>
        Effect.sync(() => {
          const fed = Framing.feed(rest, chunk);
          rest = fed.rest;
          for (const frame of fed.frames) {
            if (Result.isSuccess(frame)) {
              collected.push(frame.success);
            }
          }
        }),
      ),
      Stream.takeUntil(() => collected.length >= count),
      Stream.runDrain,
      Effect.orDie,
    );
    return collected;
  });

describe("listen and accept", () => {
  it.live("creates the socket file, accepts one connection and then refuses more", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        expect(statSync(path).isSocket()).toBe(true);
        const peer = yield* connect(path);
        const socket = yield* listener.accept;
        expect(socket).toBeDefined();
        // The listener closed after the first connection: nothing else gets in.
        const second = yield* connectRefused(path);
        expect(["ECONNREFUSED", "ENOENT"]).toContain(second);
        peer.socket.destroy();
      }),
    ),
  );

  it.live("accepts a connection that arrived before accept was called", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const peer = yield* connect(path);
        yield* peerWrite(peer, '{"QMP":{"version":{},"capabilities":[]}}\n');
        yield* Effect.sleep("20 millis");
        const socket = yield* listener.accept;
        const inbound = yield* frames(socket.lines, 1);
        expect(inbound).toEqual([{ QMP: { version: {}, capabilities: [] } }]);
        peer.socket.destroy();
      }),
    ),
  );

  it.live("fails accept under a timeout when nobody connects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const outcome = yield* listener.accept.pipe(
          Effect.timeoutOrElse({
            duration: "200 millis",
            orElse: () => Effect.succeed("timed out"),
          }),
        );
        expect(outcome).toBe("timed out");
      }),
    ),
  );

  it.live("fails QmpClosed when the path cannot be listened on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = join(dir, "missing", "qmp.sock");
        const error = yield* Effect.flip(Socket.listen(target));
        expect(error._tag).toBe("QmpClosed");
        // libuv reports a missing parent dir as EACCES on some kernels, ENOENT on others.
        expect(error.message).toMatch(/^listen E[A-Z]+/);
        expect(error.message).toContain(target);
      }),
    ),
  );
});

describe("QmpSocket", () => {
  it.live("delivers chunks split mid-JSON as one line stream that frames correctly", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const peer = yield* connect(path);
        const socket = yield* listener.accept;
        const reading = yield* Effect.forkChild(frames(socket.lines, 2));
        yield* peerWrite(peer, '{"QMP":{"version":{},"capabil');
        yield* Effect.sleep("20 millis");
        yield* peerWrite(peer, 'ities":[]}}\n{"return":{},"id":1}\n');
        expect(yield* Fiber.join(reading)).toEqual([
          { QMP: { version: {}, capabilities: [] } },
          { return: {}, id: 1 },
        ]);
        peer.socket.destroy();
      }),
    ),
  );

  it.live("writes reach the peer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const peer = yield* connect(path);
        const socket = yield* listener.accept;
        yield* socket.write('{"execute":"qmp_capabilities","arguments":{},"id":1}\n');
        yield* Effect.sleep("20 millis");
        expect(peer.received.join("")).toBe(
          '{"execute":"qmp_capabilities","arguments":{},"id":1}\n',
        );
        peer.socket.destroy();
      }),
    ),
  );

  it.live("fails `qemu: socket closed` on the lines and on a write after the peer closed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const peer = yield* connect(path);
        const socket = yield* listener.accept;
        peer.socket.destroy();
        const streamError = yield* Effect.flip(Stream.runDrain(socket.lines));
        expect(streamError).toMatchObject({ _tag: "QmpClosed", message: "qemu: socket closed" });
        const writeError = yield* Effect.flip(socket.write('{"execute":"x"}\n'));
        expect(writeError).toMatchObject({ _tag: "QmpClosed", message: "qemu: socket closed" });
      }),
    ),
  );

  it.live("ends the lines with `qemu: closed` semantics when we close it ourselves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const peer = yield* connect(path);
        const socket = yield* listener.accept;
        const draining = yield* Effect.forkChild(Effect.exit(Stream.runDrain(socket.lines)));
        yield* socket.close;
        expect(Exit.isSuccess(yield* Fiber.join(draining))).toBe(true);
        yield* Effect.promise(() => peer.closed);
        const writeError = yield* Effect.flip(socket.write("x"));
        expect(writeError).toMatchObject({ _tag: "QmpClosed", message: "qemu: closed" });
      }),
    ),
  );

  it.live("closing the scope destroys the accepted socket and stops listening", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const listener = yield* Socket.listen(path).pipe(Scope.provide(scope));
      const peer = yield* connect(path);
      yield* listener.accept.pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);
      yield* Effect.promise(() => peer.closed);
      expect(peer.socket.destroyed).toBe(true);
      const again = yield* connectRefused(path);
      expect(["ECONNREFUSED", "ENOENT"]).toContain(again);
    }),
  );

  it.live("closing the scope before any connection stops listening", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* Socket.listen(path).pipe(Scope.provide(scope));
      expect(statSync(path).isSocket()).toBe(true);
      yield* Scope.close(scope, Exit.void);
      expect(["ECONNREFUSED", "ENOENT"]).toContain(yield* connectRefused(path));
    }),
  );

  it.live("destroys a second connection instead of queueing it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* Socket.listen(path);
        const first = yield* connect(path);
        yield* Effect.sleep("20 millis");
        const second = yield* connectRefused(path);
        expect(["ECONNREFUSED", "ENOENT"]).toContain(second);
        const socket = yield* listener.accept;
        yield* socket.write("ok\n");
        yield* Effect.sleep("20 millis");
        expect(first.received.join("")).toBe("ok\n");
        first.socket.destroy();
      }),
    ),
  );
});
