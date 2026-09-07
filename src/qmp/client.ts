import { Deferred, Effect, Result, Stream } from "effect";
import type { Schema } from "effect";
import * as Log from "../observability/log.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Framing from "./framing.ts";
import type * as Socket from "./socket.ts";

export const HANDSHAKE_MS = 10_000;
// A QMP reply is near-instant; anything this long means QEMU is wedged with its socket still
// open (so the close teardown never fires). Fail the command instead.
export const COMMAND_TIMEOUT_MS = 30_000;

// Awaited with the exact command before it goes out (a refused insert fails the exchange up
// front); the returned close records the outcome when the reply lands.
export type Close = (
  outcome: Domain.QmpExchangeOutcome,
) => Effect.Effect<void, Errors.DatabaseError>;
export type Recorder = (command: Domain.QmpCommand) => Effect.Effect<Close, Errors.DatabaseError>;

type WithoutId<Command> = Command extends { readonly id: number } ? Omit<Command, "id"> : never;
// A command before the client numbers it.
export type QmpRequest = WithoutId<Domain.QmpCommand>;

export type ExecuteError =
  | Errors.QmpError
  | Errors.QmpTimeout
  | Errors.QmpClosed
  | Errors.DatabaseError;

export type QmpClient = {
  readonly execute: (
    request: QmpRequest,
    record?: Recorder,
  ) => Effect.Effect<Schema.Json, ExecuteError>;
  // Resolves once the socket is gone, with the reason.
  readonly closed: Effect.Effect<Errors.QmpClosed>;
};

type Pending = {
  readonly command: string;
  readonly deferred: Deferred.Deferred<Domain.QmpSuccess, Errors.QmpError | Errors.QmpClosed>;
};

const closedByUs = (): Errors.QmpClosed => Errors.QmpClosed.make({ message: "qemu: closed" });

const failureOf = (error: ExecuteError): Domain.QmpFailure | string =>
  error._tag === "QmpError" ? error.raw : error.message;

export const handshake = Effect.fn("Qmp.handshake")(function* (
  socket: Socket.QmpSocket,
  record?: Recorder,
) {
  const log = yield* Log.Log;
  const pending = new Map<number, Pending>();
  const greeting = yield* Deferred.make<
    Domain.QmpGreeting,
    Errors.QmpClosed | Errors.QmpProtocolError
  >();
  const closed = yield* Deferred.make<Errors.QmpClosed>();
  let open = true;
  let nextId = 0;
  let buffer = "";

  const rejectPending = (error: Errors.QmpClosed) =>
    Effect.gen(function* () {
      const entries = [...pending.values()];
      pending.clear();
      yield* Effect.forEach(entries, (entry) => Deferred.fail(entry.deferred, error), {
        discard: true,
      });
    });

  // Idempotent: the first reason wins, later ones find nothing left to fail.
  const teardown = (
    error: Errors.QmpClosed,
    greetingError: Errors.QmpClosed | Errors.QmpProtocolError = error,
  ) =>
    Effect.gen(function* () {
      if (!open) {
        return;
      }
      open = false;
      yield* socket.close;
      yield* rejectPending(error);
      yield* Deferred.fail(greeting, greetingError);
      yield* Deferred.succeed(closed, error);
    });

  const dispatch = (message: Domain.QmpInbound): Effect.Effect<void> => {
    if ("QMP" in message) {
      return Effect.asVoid(Deferred.succeed(greeting, message));
    }
    if ("event" in message) {
      return Effect.void;
    }
    const id = message.id;
    if (typeof id !== "number") {
      return Effect.void;
    }
    const entry = pending.get(id);
    if (entry === undefined) {
      return Effect.void;
    }
    pending.delete(id);
    if ("error" in message) {
      // The raw {error} reply rides the failure so a recorder can store the exact JSON.
      return Effect.asVoid(
        Deferred.fail(
          entry.deferred,
          Errors.QmpError.make({
            command: entry.command,
            class: message.error.class,
            desc: message.error.desc,
            raw: message,
          }),
        ),
      );
    }
    return Effect.asVoid(Deferred.succeed(entry.deferred, message));
  };

  const consume = (chunk: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fed = Framing.feed(buffer, chunk);
      buffer = fed.rest;
      for (const frame of fed.frames) {
        if (Result.isFailure(frame)) {
          const error = frame.failure;
          yield* teardown(Errors.QmpClosed.make({ message: error.message, cause: error }), error);
          return;
        }
        yield* dispatch(frame.success);
      }
    });

  const reader = socket.lines.pipe(
    Stream.runForEach(consume),
    Effect.matchEffect({
      onFailure: (error) => teardown(error),
      onSuccess: () => teardown(closedByUs()),
    }),
  );
  yield* Effect.forkScoped(reader, { startImmediately: true });
  // Registered after the fork so it runs before the reader is interrupted: in-flight commands
  // learn `qemu: closed` instead of hanging.
  yield* Effect.addFinalizer(() => teardown(closedByUs()));

  const exchange = (command: Domain.QmpCommand) =>
    Effect.gen(function* () {
      // stop() can close the socket while the recorder is opening the action.
      if (!open) {
        return yield* closedByUs();
      }
      const deferred = yield* Deferred.make<
        Domain.QmpSuccess,
        Errors.QmpError | Errors.QmpClosed
      >();
      pending.set(command.id, { command: command.execute, deferred });
      yield* socket.write(Domain.encodeQmpCommand(command));
      return yield* Deferred.await(deferred).pipe(
        Effect.timeoutOrElse({
          duration: COMMAND_TIMEOUT_MS,
          orElse: () => Effect.fail(Errors.QmpTimeout.make({ command: command.execute })),
        }),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          pending.delete(command.id);
        }),
      ),
    );

  const execute = (
    request: QmpRequest,
    recorder?: Recorder,
  ): Effect.Effect<Schema.Json, ExecuteError> =>
    Effect.gen(function* () {
      if (!open) {
        return yield* closedByUs();
      }
      const id = ++nextId;
      const command: Domain.QmpCommand = { ...request, id };
      const close = recorder === undefined ? undefined : yield* recorder(command);
      const exchanged = yield* Effect.result(exchange(command));
      if (Result.isFailure(exchanged)) {
        const error = exchanged.failure;
        if (close !== undefined) {
          yield* close({ state: "failed", response: failureOf(error) }).pipe(
            Effect.catch((closeError) =>
              log.error(`db: recording a failed exchange failed too: ${closeError.message}`, {
                cause: closeError,
              }),
            ),
          );
        }
        return yield* Effect.fail(error);
      }
      // Outside the failure branch: a failing close surfaces as itself, not as a failed exchange.
      if (close !== undefined) {
        yield* close({ state: "completed", response: exchanged.success });
      }
      return exchanged.success.return;
    });

  const greetingMessage = yield* Deferred.await(greeting).pipe(
    Effect.timeoutOrElse({
      duration: HANDSHAKE_MS,
      orElse: () => Effect.fail(Errors.QmpTimeout.make({ command: "greeting" })),
    }),
  );
  // The greeting is the recorded reply for the boot's qmp_capabilities: its own {return} is empty.
  const bootRecord: Recorder | undefined =
    record === undefined
      ? undefined
      : (command) =>
          Effect.map(
            record(command),
            (close): Close =>
              (outcome) =>
                close(
                  outcome.state === "completed"
                    ? { state: "completed", response: greetingMessage }
                    : outcome,
                ),
          );
  yield* execute({ execute: "qmp_capabilities", arguments: {} }, bootRecord);

  return { execute, closed: Deferred.await(closed) } satisfies QmpClient;
});
