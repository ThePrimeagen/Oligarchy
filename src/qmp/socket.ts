import * as Net from "node:net";
import { Cause, Context, Deferred, Effect, Exit, Layer, Queue, Scope, Stream } from "effect";
import * as Errors from "../shared/errors.ts";

export type QmpSocket = {
  // Raw utf8 chunks as they arrive; framing is the caller's.
  readonly lines: Stream.Stream<string, Errors.QmpClosed>;
  readonly write: (text: string) => Effect.Effect<void, Errors.QmpClosed>;
  readonly close: Effect.Effect<void>;
};

export type QmpListener = {
  // The first connection; the listener stops accepting once it has arrived.
  readonly accept: Effect.Effect<QmpSocket, Errors.QmpClosed, Scope.Scope>;
};

const closedByUs = (): Errors.QmpClosed => Errors.QmpClosed.make({ message: "qemu: closed" });

const closedByPeer = (): Errors.QmpClosed =>
  Errors.QmpClosed.make({ message: "qemu: socket closed" });

const socketError = (error: Error): Errors.QmpClosed =>
  Errors.QmpClosed.make({ message: error.message, cause: error });

// The accepted net.Socket behind the QmpSocket interface; leaving the scope destroys it.
const wrap = (socket: Net.Socket): Effect.Effect<QmpSocket, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<string, Errors.QmpClosed | Cause.Done>();
    let closed: Errors.QmpClosed | undefined;
    const fail = (failure: Errors.QmpClosed) => {
      closed ??= failure;
      Queue.failCauseUnsafe(queue, Cause.fail(closed));
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      Queue.offerUnsafe(queue, chunk);
    });
    socket.on("error", (error) => {
      fail(socketError(error));
    });
    // QEMU's exit closes this socket: the stream fails so the client rejects every pending command
    // instead of writing into a dead socket, where Node drops the bytes silently.
    socket.on("close", () => {
      fail(closedByPeer());
    });
    const close = Effect.sync(() => {
      closed ??= closedByUs();
      Queue.endUnsafe(queue);
      socket.destroy();
    });
    yield* Effect.addFinalizer(() => close);
    const write = (text: string): Effect.Effect<void, Errors.QmpClosed> =>
      Effect.suspend(() =>
        closed === undefined
          ? Effect.callback<void, Errors.QmpClosed>((resume) => {
              socket.write(text, (error) => {
                resume(
                  error === undefined || error === null
                    ? Effect.void
                    : Effect.fail(closed ?? socketError(error)),
                );
              });
            })
          : Effect.fail(closed),
      );
    return { lines: Stream.fromQueue(queue), write, close };
  });

export const listen = (path: string): Effect.Effect<QmpListener, Errors.QmpClosed, Scope.Scope> =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<Net.Socket, Errors.QmpClosed>();
    // Arrived but not yet handed to `accept`; the release destroys it.
    let waiting: Net.Socket | undefined;
    yield* Effect.acquireRelease(
      Effect.callback<Net.Server, Errors.QmpClosed>((resume) => {
        const created = Net.createServer((socket) => {
          // Exactly one QEMU connects: the first is kept and the listener closes so that
          // nothing else can reach this session's monitor.
          if (Deferred.doneUnsafe(first, Exit.succeed(socket))) {
            waiting = socket;
            created.close();
          } else {
            socket.destroy();
          }
        });
        const onListenError = (error: Error) => {
          resume(Effect.fail(socketError(error)));
        };
        created.once("error", onListenError);
        created.listen(path, () => {
          created.off("error", onListenError);
          created.on("error", (error) => {
            Deferred.doneUnsafe(first, Exit.fail(socketError(error)));
          });
          resume(Effect.succeed(created));
        });
        return Effect.sync(() => {
          created.close();
        });
      }),
      (created) =>
        Effect.callback<void>((resume) => {
          waiting?.destroy();
          Deferred.doneUnsafe(first, Exit.fail(closedByUs()));
          if (!created.listening) {
            resume(Effect.void);
            return;
          }
          created.close(() => resume(Effect.void));
        }),
    );
    const accept: Effect.Effect<QmpSocket, Errors.QmpClosed, Scope.Scope> = Effect.gen(
      function* () {
        const socket = yield* Deferred.await(first);
        waiting = undefined;
        return yield* wrap(socket);
      },
    );
    return { accept };
  });

export type QmpListenService = {
  readonly listen: (path: string) => Effect.Effect<QmpListener, Errors.QmpClosed, Scope.Scope>;
};

// The test seam: Qemu asks this service for its listener instead of node:net directly.
export class QmpListen extends Context.Service<QmpListen, QmpListenService>()(
  "@oligarchy/qmp/QmpListen",
) {
  static readonly layer: Layer.Layer<QmpListen> = Layer.succeed(this)(this.of({ listen }));
}
