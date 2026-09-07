import { Cause, Effect, Layer, Queue, Schema, Scope, Stream } from "effect";
import type * as Client from "../../src/qmp/client.ts";
import * as Socket from "../../src/qmp/socket.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";

export type Options = {
  // Replies to enqueue for each command written; the greeting is fed by the test.
  readonly respond?: (command: Domain.QmpCommand) => ReadonlyArray<string>;
  // When set, every write fails with this error instead of being recorded.
  readonly writeFails?: Errors.QmpClosed;
};

export type FakeQmpSocket = {
  readonly socket: Socket.QmpSocket;
  readonly written: Array<string>;
  // Offers a raw chunk to `lines`, as QEMU's bytes would arrive.
  readonly feed: (text: string) => Effect.Effect<void>;
  // The peer went away: `lines` fails as the real socket's close event would.
  readonly disconnect: Effect.Effect<void>;
  readonly fail: (error: Errors.QmpClosed) => Effect.Effect<void>;
  // Whether `close` has been called on the socket.
  readonly isClosed: () => boolean;
};

export const GREETING = {
  QMP: {
    version: { qemu: { major: 10, micro: 0, minor: 0 }, package: "v10.0.0" },
    capabilities: [],
  },
};

export const greetingLine = (): string => JSON.stringify(GREETING);

export const successLine = (id: number, value: unknown = {}): string =>
  JSON.stringify({ return: value, id });

export const errorLine = (id: number, klass: string, desc: string): string =>
  JSON.stringify({ error: { class: klass, desc }, id });

// Replies `{ return: {} }` to every command: a QEMU that accepts everything.
export const acceptAll = (command: Domain.QmpCommand): ReadonlyArray<string> => [
  successLine(command.id),
];

const decodeCommand = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.toCodecJson(Domain.QmpCommand)),
);

export const writtenCommands = (fake: FakeQmpSocket): ReadonlyArray<Domain.QmpCommand> =>
  fake.written.map((text) => decodeCommand(text));

export const fakeQmpSocket = (options: Options = {}): Effect.Effect<FakeQmpSocket> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<string, Errors.QmpClosed | Cause.Done>();
    const written: Array<string> = [];
    let closed = false;
    const socket: Socket.QmpSocket = {
      lines: Stream.fromQueue(queue),
      write: (text) =>
        Effect.suspend(() => {
          if (options.writeFails !== undefined) {
            return Effect.fail(options.writeFails);
          }
          written.push(text);
          for (const reply of options.respond?.(decodeCommand(text)) ?? []) {
            Queue.offerUnsafe(queue, reply);
          }
          return Effect.void;
        }),
      close: Effect.sync(() => {
        closed = true;
        Queue.endUnsafe(queue);
      }),
    };
    return {
      socket,
      written,
      feed: (text) =>
        Effect.sync(() => {
          Queue.offerUnsafe(queue, text);
        }),
      disconnect: Effect.sync(() => {
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(Errors.QmpClosed.make({ message: "qemu: socket closed" })),
        );
      }),
      fail: (error) =>
        Effect.sync(() => {
          Queue.failCauseUnsafe(queue, Cause.fail(error));
        }),
      isClosed: () => closed,
    };
  });

export type FakeListen = {
  readonly listened: Array<string>;
  readonly layer: Layer.Layer<Socket.QmpListen>;
};

// A listener whose `accept` yields the given socket; without one, `accept` never resolves.
export const fakeListen = (
  accepted?: FakeQmpSocket,
  onListen: (path: string) => void = () => undefined,
): FakeListen => {
  const listened: Array<string> = [];
  const accept: Effect.Effect<Socket.QmpSocket, Errors.QmpClosed, Scope.Scope> =
    accepted === undefined
      ? Effect.never
      : Effect.acquireRelease(Effect.succeed(accepted.socket), (socket) => socket.close);
  const listen: Socket.QmpListenService["listen"] = (path) =>
    Effect.sync(() => {
      listened.push(path);
      onListen(path);
      return { accept };
    });
  return { listened, layer: Layer.succeed(Socket.QmpListen)(Socket.QmpListen.of({ listen })) };
};

export type Recording = {
  readonly commands: Array<Domain.QmpCommand>;
  readonly outcomes: Array<Domain.QmpExchangeOutcome>;
  readonly record: Client.Recorder;
};

// A Recorder that keeps every command opened and every outcome closed; `onClose` scripts the
// close's own result (a refused finishAction, say).
export const recorder = (
  onClose: (outcome: Domain.QmpExchangeOutcome) => Effect.Effect<void, Errors.DatabaseError> = () =>
    Effect.void,
): Recording => {
  const commands: Array<Domain.QmpCommand> = [];
  const outcomes: Array<Domain.QmpExchangeOutcome> = [];
  return {
    commands,
    outcomes,
    record: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return (outcome) =>
          Effect.suspend(() => {
            outcomes.push(outcome);
            return onClose(outcome);
          });
      }),
  };
};
