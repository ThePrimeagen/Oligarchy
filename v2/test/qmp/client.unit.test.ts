import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Client from "../../src/qmp/client.ts";
import type * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeSocket from "../support/fake-qmp-socket.ts";
import * as FakeLog from "../support/log.ts";

const sendKey: Client.QmpRequest = {
  execute: "send-key",
  arguments: { keys: [{ type: "qcode", data: "a" }] },
};

const screendump: Client.QmpRequest = {
  execute: "screendump",
  arguments: { filename: "/tmp/x.png", format: "png" },
};

const recorder = FakeSocket.recorder;

// Answers qmp_capabilities only; every later command is replied to by the test.
const bootOnly = (command: Domain.QmpCommand): ReadonlyArray<string> =>
  command.execute === "qmp_capabilities" ? [FakeSocket.successLine(command.id)] : [];

// A handshaken client over a fake socket whose greeting has already arrived.
const connect = (options: FakeSocket.Options = { respond: bootOnly }) =>
  Effect.gen(function* () {
    const fake = yield* FakeSocket.fakeQmpSocket(options);
    const log = FakeLog.fakeLog();
    yield* fake.feed(FakeSocket.greetingLine());
    const client = yield* Client.handshake(fake.socket).pipe(Effect.provide(log.layer));
    return { fake, log, client };
  });

const commandsWritten = (fake: FakeSocket.FakeQmpSocket): ReadonlyArray<string> =>
  FakeSocket.writtenCommands(fake).map((command) => command.execute);

describe("handshake", () => {
  it.effect("resolves on the greeting and records it as the reply to qmp_capabilities", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket({ respond: FakeSocket.acceptAll });
      const log = FakeLog.fakeLog();
      const recording = recorder();
      yield* fake.feed(FakeSocket.greetingLine());
      yield* Client.handshake(fake.socket, recording.record).pipe(Effect.provide(log.layer));
      expect(fake.written).toEqual(['{"execute":"qmp_capabilities","arguments":{},"id":1}\n']);
      expect(recording.commands).toEqual([{ execute: "qmp_capabilities", arguments: {}, id: 1 }]);
      expect(recording.outcomes).toEqual([{ state: "completed", response: FakeSocket.GREETING }]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("accepts a greeting that arrives after the handshake started", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket({ respond: FakeSocket.acceptAll });
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(
        Client.handshake(fake.socket).pipe(Effect.provide(log.layer)),
      );
      yield* TestClock.adjust("9 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* fake.feed(FakeSocket.greetingLine());
      const client = yield* Fiber.join(fiber);
      expect(commandsWritten(fake)).toEqual(["qmp_capabilities"]);
      // Handshaken: the next command goes out numbered after the boot's and is answered.
      expect(yield* client.execute(sendKey)).toEqual({});
      expect(FakeSocket.writtenCommands(fake).map((command) => command.id)).toEqual([1, 2]);
    }),
  );

  it.effect("fails QmpTimeout for the greeting after 10 seconds", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(
        Effect.flip(Client.handshake(fake.socket).pipe(Effect.provide(log.layer))),
      );
      yield* TestClock.adjust(Client.HANDSHAKE_MS - 1);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(1);
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpTimeout", command: "greeting" });
      expect(error.message).toBe("qemu: greeting timed out");
    }),
  );

  it.effect("fails QmpProtocolError when the first frame is not QMP", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket();
      const log = FakeLog.fakeLog();
      yield* fake.feed('{"hello":"world"}');
      const error = yield* Effect.flip(
        Client.handshake(fake.socket).pipe(Effect.provide(log.layer)),
      );
      expect(error).toMatchObject({ _tag: "QmpProtocolError" });
      expect(fake.isClosed()).toBe(true);
    }),
  );

  it.effect("fails QmpClosed when the peer goes away before greeting", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket();
      const log = FakeLog.fakeLog();
      const fiber = yield* Effect.forkChild(
        Effect.flip(Client.handshake(fake.socket).pipe(Effect.provide(log.layer))),
      );
      yield* Effect.yieldNow;
      yield* fake.disconnect;
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpClosed", message: "qemu: socket closed" });
    }),
  );

  it.effect("fails when the recorder refuses the boot action, before any write", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket({ respond: FakeSocket.acceptAll });
      const log = FakeLog.fakeLog();
      const refused = Errors.DatabaseError.make({
        operation: "startAction",
        message: "Failed query: insert into actions",
      });
      yield* fake.feed(FakeSocket.greetingLine());
      const error = yield* Effect.flip(
        Client.handshake(fake.socket, () => Effect.fail(refused)).pipe(Effect.provide(log.layer)),
      );
      expect(error).toBe(refused);
      expect(fake.written).toEqual([]);
    }),
  );
});

describe("execute", () => {
  it.effect("correlates replies by id, out of order", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const first = yield* Effect.forkChild(client.execute(sendKey));
      const second = yield* Effect.forkChild(client.execute(screendump));
      yield* Effect.yieldNow;
      expect(FakeSocket.writtenCommands(fake).map((command) => command.id)).toEqual([1, 2, 3]);
      yield* fake.feed(FakeSocket.successLine(3, { second: true }));
      yield* fake.feed(FakeSocket.successLine(2, { first: true }));
      expect(yield* Fiber.join(second)).toEqual({ second: true });
      expect(yield* Fiber.join(first)).toEqual({ first: true });
    }),
  );

  it.effect("ignores events and replies for unknown ids", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const fiber = yield* Effect.forkChild(client.execute(sendKey));
      yield* Effect.yieldNow;
      yield* fake.feed('{"event":"RESUME","timestamp":{"seconds":1,"microseconds":2}}');
      yield* fake.feed(FakeSocket.successLine(99));
      yield* fake.feed(FakeSocket.successLine(2, "ok"));
      expect(yield* Fiber.join(fiber)).toBe("ok");
    }),
  );

  it.effect("fails QmpError with `class: desc` and the raw frame on an {error} reply", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey)));
      yield* Effect.yieldNow;
      yield* fake.feed(FakeSocket.errorLine(2, "GenericError", "Invalid parameter 'x'"));
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({
        _tag: "QmpError",
        command: "send-key",
        class: "GenericError",
        desc: "Invalid parameter 'x'",
        raw: { error: { class: "GenericError", desc: "Invalid parameter 'x'" }, id: 2 },
      });
      expect(error.message).toBe("GenericError: Invalid parameter 'x'");
    }),
  );

  it.effect("fails QmpTimeout after 30 seconds and ignores the late reply", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const recording = recorder();
      const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey, recording.record)));
      yield* TestClock.adjust(Client.COMMAND_TIMEOUT_MS - 1);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(1);
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpTimeout", command: "send-key" });
      expect(error.message).toBe("qemu: send-key timed out");
      expect(recording.outcomes).toEqual([
        { state: "failed", response: "qemu: send-key timed out" },
      ]);
      yield* fake.feed(FakeSocket.successLine(2));
      const next = yield* Effect.forkChild(client.execute(sendKey));
      yield* Effect.yieldNow;
      yield* fake.feed(FakeSocket.successLine(3, "late-safe"));
      expect(yield* Fiber.join(next)).toBe("late-safe");
    }),
  );

  it.effect("opens the recorder before the write and closes it with the reply", () =>
    Effect.gen(function* () {
      const events: Array<string> = [];
      const { client } = yield* connect({
        respond: (command) => {
          events.push(`write ${command.execute}`);
          return [FakeSocket.successLine(command.id, { ok: true })];
        },
      });
      const record: Client.Recorder = (command) =>
        Effect.sync(() => {
          events.push(`record ${command.execute} ${String(command.id)}`);
          return (outcome) =>
            Effect.sync(() => {
              events.push(`close ${outcome.state} ${JSON.stringify(outcome.response)}`);
            });
        });
      expect(yield* client.execute(sendKey, record)).toEqual({ ok: true });
      expect(events).toEqual([
        "write qmp_capabilities",
        "record send-key 2",
        "write send-key",
        'close completed {"return":{"ok":true},"id":2}',
      ]);
    }),
  );

  it.effect(
    "fails the action without writing when the socket closes while the recorder opens",
    () =>
      Effect.gen(function* () {
        const { fake, client } = yield* connect();
        const gate = yield* Deferred.make<void>();
        const outcomes: Array<Domain.QmpExchangeOutcome> = [];
        const record: Client.Recorder = () =>
          Deferred.await(gate).pipe(
            Effect.as((outcome: Domain.QmpExchangeOutcome) =>
              Effect.sync(() => {
                outcomes.push(outcome);
              }),
            ),
          );
        const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey, record)));
        yield* Effect.yieldNow;
        yield* fake.disconnect;
        yield* client.closed;
        yield* Deferred.succeed(gate, undefined);
        const error = yield* Fiber.join(fiber);
        expect(error).toMatchObject({ _tag: "QmpClosed", message: "qemu: closed" });
        expect(commandsWritten(fake)).toEqual(["qmp_capabilities"]);
        expect(outcomes).toEqual([{ state: "failed", response: "qemu: closed" }]);
      }),
  );

  it.effect("refuses to open an action on a closed client", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const recording = recorder();
      yield* fake.disconnect;
      yield* client.closed;
      const error = yield* Effect.flip(client.execute(sendKey, recording.record));
      expect(error).toMatchObject({ _tag: "QmpClosed", message: "qemu: closed" });
      expect(recording.commands).toEqual([]);
    }),
  );

  it.effect("only logs when closing the record of a failed exchange fails too", () =>
    Effect.gen(function* () {
      const { fake, log, client } = yield* connect();
      const recording = recorder(() =>
        Effect.fail(
          Errors.DatabaseError.make({
            operation: "finishAction",
            message: "Failed query: update actions",
          }),
        ),
      );
      const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey, recording.record)));
      yield* Effect.yieldNow;
      yield* fake.feed(FakeSocket.errorLine(2, "GenericError", "nope"));
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpError", class: "GenericError", desc: "nope" });
      expect(recording.outcomes).toEqual([
        { state: "failed", response: { error: { class: "GenericError", desc: "nope" }, id: 2 } },
      ]);
      expect(log.lines).toMatchObject([
        {
          level: "error",
          text: "db: recording a failed exchange failed too: Failed query: update actions",
        },
      ]);
    }),
  );

  it.effect("surfaces a failing close of a completed exchange as itself", () =>
    Effect.gen(function* () {
      const { fake, log, client } = yield* connect();
      const refused = Errors.DatabaseError.make({
        operation: "finishAction",
        message: "Failed query: update actions",
      });
      const recording = recorder(() => Effect.fail(refused));
      const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey, recording.record)));
      yield* Effect.yieldNow;
      yield* fake.feed(FakeSocket.successLine(2));
      const error = yield* Fiber.join(fiber);
      expect(error).toBe(refused);
      expect(recording.outcomes).toEqual([{ state: "completed", response: { return: {}, id: 2 } }]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("fails the exchange and records it when the write is refused", () =>
    Effect.gen(function* () {
      const fake = yield* FakeSocket.fakeQmpSocket({
        writeFails: Errors.QmpClosed.make({ message: "qemu: socket closed" }),
      });
      const log = FakeLog.fakeLog();
      const recording = recorder();
      yield* fake.feed(FakeSocket.greetingLine());
      const error = yield* Effect.flip(
        Client.handshake(fake.socket, recording.record).pipe(Effect.provide(log.layer)),
      );
      expect(error).toMatchObject({ _tag: "QmpClosed", message: "qemu: socket closed" });
      expect(recording.outcomes).toEqual([{ state: "failed", response: "qemu: socket closed" }]);
    }),
  );
});

describe("socket lifecycle", () => {
  it.effect("rejects every pending command with `qemu: socket closed` and resolves `closed`", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const first = yield* Effect.forkChild(Effect.flip(client.execute(sendKey)));
      const second = yield* Effect.forkChild(Effect.flip(client.execute(screendump)));
      yield* Effect.yieldNow;
      yield* fake.disconnect;
      expect(yield* Fiber.join(first)).toMatchObject({
        _tag: "QmpClosed",
        message: "qemu: socket closed",
      });
      expect(yield* Fiber.join(second)).toMatchObject({
        _tag: "QmpClosed",
        message: "qemu: socket closed",
      });
      const closed = yield* client.closed;
      expect(closed.message).toBe("qemu: socket closed");
      expect(fake.isClosed()).toBe(true);
    }),
  );

  it.effect("carries a socket error's message into QmpClosed", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey)));
      yield* Effect.yieldNow;
      const cause = new Error("read ECONNRESET");
      yield* fake.fail(Errors.QmpClosed.make({ message: "read ECONNRESET", cause }));
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpClosed", message: "read ECONNRESET", cause });
    }),
  );

  it.effect("fails every pending command and closes the socket on an unparsable frame", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey)));
      yield* Effect.yieldNow;
      yield* fake.feed("{nope}");
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpClosed" });
      expect(error.cause).toMatchObject({ _tag: "QmpProtocolError" });
      expect(fake.isClosed()).toBe(true);
      const closed = yield* client.closed;
      expect(closed.cause).toMatchObject({ _tag: "QmpProtocolError" });
    }),
  );

  it.effect("an interrupted execute ignores its late reply and the client keeps working", () =>
    Effect.gen(function* () {
      const { fake, client } = yield* connect();
      const fiber = yield* Effect.forkChild(client.execute(sendKey));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      yield* fake.feed(FakeSocket.successLine(2, "too late"));
      const next = yield* Effect.forkChild(client.execute(screendump));
      yield* Effect.yieldNow;
      yield* fake.feed(FakeSocket.successLine(3, "fresh"));
      expect(yield* Fiber.join(next)).toBe("fresh");
    }),
  );

  it.effect(
    "closing the scope rejects pending commands with `qemu: closed` and closes the socket",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeSocket.fakeQmpSocket({ respond: bootOnly });
        const log = FakeLog.fakeLog();
        yield* fake.feed(FakeSocket.greetingLine());
        const scope = yield* Scope.make();
        const client = yield* Client.handshake(fake.socket).pipe(
          Effect.provide(log.layer),
          Scope.provide(scope),
        );
        const fiber = yield* Effect.forkChild(Effect.flip(client.execute(sendKey)));
        yield* Effect.yieldNow;
        yield* Scope.close(scope, Exit.void);
        expect(yield* Fiber.join(fiber)).toMatchObject({
          _tag: "QmpClosed",
          message: "qemu: closed",
        });
        expect(fake.isClosed()).toBe(true);
        const closed = yield* client.closed;
        expect(closed.message).toBe("qemu: closed");
      }),
  );
});
