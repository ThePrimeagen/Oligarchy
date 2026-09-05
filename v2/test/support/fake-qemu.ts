import { Cause, Effect, Exit, Layer, Option, Ref } from "effect";
import type { PlatformError } from "effect";
import * as Iso from "../../src/qemu/iso.ts";
import * as Qemu from "../../src/qemu/qemu.ts";
import * as Stats from "../../src/qemu/stats.ts";
import type * as Qmp from "../../src/qmp/client.ts";
import * as Contract from "../../src/shared/contract.ts";
import type * as Domain from "../../src/shared/domain.ts";
import type * as Errors from "../../src/shared/errors.ts";

export type StartInput = Parameters<Qemu.QemuService["start"]>[1];
export type MouseInput = Parameters<Qemu.QemuHandle["sendMouse"]>[0];
export type ExchangeError =
  | Errors.QmpError
  | Errors.QmpTimeout
  | Errors.QmpClosed
  | Errors.DatabaseError;

export type Call =
  | { readonly _tag: "prepare"; readonly id: string; readonly disk: string | undefined }
  | {
      readonly _tag: "start";
      readonly id: string;
      readonly iso: string;
      readonly diskPath: string;
      readonly display: Domain.QemuDisplay;
      readonly automation: boolean;
    }
  | { readonly _tag: "stop"; readonly id: string }
  | {
      readonly _tag: "sendKeys";
      readonly id: string;
      readonly chords: ReadonlyArray<ReadonlyArray<string>>;
    }
  | { readonly _tag: "sendMouse"; readonly id: string; readonly input: MouseInput }
  | { readonly _tag: "screendump"; readonly id: string };

// Every hook defaults to success; a hook that fails scripts that step's failure.
export type Script = {
  // The session dir, disk and firmware: a failing qemu-img create fails here.
  readonly prepare?: (
    id: string,
    disk: string | undefined,
  ) => Effect.Effect<void, Errors.QemuStartError>;
  // Runs once the handle's release is registered and before the handshake is recorded.
  readonly boot?: (
    input: StartInput,
  ) => Effect.Effect<void, Errors.QemuStartError | Errors.DatabaseError>;
  // The handle's release: leaving the session scope. `Effect.die` scripts a failing stop.
  readonly stop?: (id: string) => Effect.Effect<void>;
  // One send-key exchange per chord; the first failure stops the run.
  readonly sendKey?: (chord: ReadonlyArray<string>) => Effect.Effect<void, ExchangeError>;
  // Applied to the first input-send-event exchange of a sendMouse.
  readonly sendMouse?: (input: MouseInput) => Effect.Effect<void, ExchangeError>;
  // The bytes a screendump yields. A Qmp* or DatabaseError failure is a failed exchange; a
  // PlatformError is a completed exchange whose file could not be read.
  readonly screendump?: () => Effect.Effect<
    Uint8Array,
    ExchangeError | PlatformError.PlatformError
  >;
  // Where session directories live; `sessionDir(id)` is `${tmp}/oligarchy-${id}`.
  readonly tmp?: string;
};

export type FakeQemu = {
  readonly calls: Array<Call>;
  readonly sessionDir: (id: string) => string;
  readonly layer: Layer.Layer<Qemu.Qemu>;
};

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const GREETING: Domain.QmpGreeting = {
  QMP: { version: { qemu: { major: 9, minor: 2, micro: 0 } }, capabilities: ["oob"] },
};

const COMPLETED: Domain.QmpExchangeOutcome = { state: "completed", response: { return: {} } };

// A PlatformError is the file read after a completed screendump; the exchange itself succeeded.
const outcomeOf = (
  error: ExchangeError | PlatformError.PlatformError,
): Domain.QmpExchangeOutcome => {
  if (error._tag === "PlatformError") {
    return COMPLETED;
  }
  if (error._tag === "QmpError") {
    return { state: "failed", response: error.raw };
  }
  return { state: "failed", response: error.message };
};

// The client's protocol: the recorder opens before the write, its close records the outcome. A
// close that fails after a failed exchange is swallowed, as the real client only logs it.
const exchange = <A, E extends ExchangeError | PlatformError.PlatformError>(
  record: Qmp.Recorder,
  command: Domain.QmpCommand,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E | Errors.DatabaseError> =>
  Effect.gen(function* () {
    const close = yield* record(command);
    const exit = yield* Effect.exit(work);
    if (Exit.isSuccess(exit)) {
      yield* close(COMPLETED);
      return exit.value;
    }
    const error = Cause.findErrorOption(exit.cause);
    if (Option.isSome(error)) {
      const outcome = outcomeOf(error.value);
      yield* outcome.state === "completed" ? close(outcome) : Effect.ignore(close(outcome));
    }
    return yield* Effect.failCause(exit.cause);
  });

const qcodes = (chord: ReadonlyArray<string>): ReadonlyArray<Domain.QmpKey> =>
  chord.map((code) => ({ type: "qcode", data: code }));

const TABLET_AXIS_MAX = 0x7fff;

export const fakeQemu = (script: Script = {}): FakeQemu => {
  const calls: Array<Call> = [];
  const tmp = script.tmp ?? "/tmp";
  const sessionDir = (id: string): string => `${tmp}/oligarchy-${id}`;

  const makeHandle = (prepared: Qemu.Prepared, seq: Ref.Ref<number>): Qemu.QemuHandle => {
    const id = prepared.id;
    const dir = prepared.dir;
    const next = Ref.updateAndGet(seq, (n) => n + 1);
    const inputEvents = (
      events: ReadonlyArray<Domain.QmpInputEvent>,
      record: Qmp.Recorder,
      work: Effect.Effect<void, ExchangeError>,
    ) =>
      Effect.flatMap(next, (commandId) =>
        exchange(
          record,
          { execute: "input-send-event", arguments: { events }, id: commandId },
          work,
        ),
      );
    return {
      id,
      dir,
      serialPath: `${dir}/serial.log`,
      sendKeys: (chords, record) =>
        Effect.gen(function* () {
          calls.push({ _tag: "sendKeys", id, chords });
          yield* Effect.forEach(
            chords,
            (chord) =>
              Effect.flatMap(next, (commandId) =>
                exchange(
                  record,
                  { execute: "send-key", arguments: { keys: qcodes(chord) }, id: commandId },
                  script.sendKey?.(chord) ?? Effect.void,
                ),
              ),
            { discard: true },
          );
        }),
      sendMouse: (input, record) =>
        Effect.gen(function* () {
          calls.push({ _tag: "sendMouse", id, input });
          const first = script.sendMouse?.(input) ?? Effect.void;
          const abs: ReadonlyArray<Domain.QmpInputEvent> = [
            { type: "abs", data: { axis: "x", value: Math.round(input.x * TABLET_AXIS_MAX) } },
            { type: "abs", data: { axis: "y", value: Math.round(input.y * TABLET_AXIS_MAX) } },
          ];
          const button = input.button;
          if (button === undefined) {
            yield* inputEvents(abs, record, first);
            return;
          }
          const clicks = input.clicks ?? 1;
          for (let click = 0; click < clicks; click++) {
            yield* inputEvents(
              [...abs, { type: "btn", data: { button, down: true } }],
              record,
              click === 0 ? first : Effect.void,
            );
            yield* inputEvents(
              [{ type: "btn", data: { button, down: false } }],
              record,
              Effect.void,
            );
          }
        }),
      screendump: (record) =>
        Effect.gen(function* () {
          calls.push({ _tag: "screendump", id });
          const commandId = yield* next;
          return yield* exchange(
            record,
            {
              execute: "screendump",
              arguments: { filename: `${dir}/image-${String(commandId)}.png`, format: "png" },
              id: commandId,
            },
            script.screendump?.() ?? Effect.succeed(PNG),
          );
        }),
    };
  };

  const service = Qemu.Qemu.of({
    prepare: (id, disk) =>
      Effect.gen(function* () {
        calls.push({ _tag: "prepare", id, disk });
        yield* script.prepare?.(id, disk) ?? Effect.void;
        const dir = sessionDir(id);
        return { id, dir, diskPath: disk ?? `${dir}/disk.qcow2` };
      }),
    start: (prepared, input) =>
      Effect.gen(function* () {
        calls.push({
          _tag: "start",
          id: prepared.id,
          iso: input.iso,
          diskPath: prepared.diskPath,
          display: input.display,
          automation: input.automation,
        });
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            calls.push({ _tag: "stop", id: prepared.id });
            return script.stop?.(prepared.id) ?? Effect.void;
          }),
        );
        yield* script.boot?.(input) ?? Effect.void;
        // The greeting is the recorded reply to the boot's qmp_capabilities.
        const close = yield* input.record({ execute: "qmp_capabilities", arguments: {}, id: 1 });
        yield* close({ state: "completed", response: GREETING });
        return makeHandle(prepared, yield* Ref.make(1));
      }),
    sessionDir,
  });

  return { calls, sessionDir, layer: Layer.succeed(Qemu.Qemu)(service) };
};

export type IsoCall = {
  readonly name: string;
  readonly sessionId: string;
  readonly agentId: string;
};

export type Resolve = (call: IsoCall) => Effect.Effect<string, Errors.IsoError>;

export type FakeIso = {
  readonly calls: Array<IsoCall>;
  readonly layer: Layer.Layer<Iso.Iso>;
};

// An Iso that answers with the name it was given, or whatever `resolve` scripts.
export const fakeIso = (resolve: Resolve = (call) => Effect.succeed(call.name)): FakeIso => {
  const calls: Array<IsoCall> = [];
  const service = Iso.Iso.of({
    getIso: (name, who) =>
      Effect.suspend(() => {
        const call = { name, sessionId: who.sessionId, agentId: who.agentId };
        calls.push(call);
        return resolve(call);
      }),
  });
  return { calls, layer: Layer.succeed(Iso.Iso)(service) };
};

export const ZERO_STATS = {
  memory: Contract.Memory.make({ totalBytes: 0, usedBytes: 0, freeBytes: 0 }),
  cpu: Contract.Cpu.make({ cores: 0, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 }),
};

// Stats that report zeros and echo the qemu count they are given.
export const fakeStats: Layer.Layer<Stats.Stats> = Layer.succeed(Stats.Stats)(
  Stats.Stats.of({
    collect: (qemus) => Effect.succeed(Contract.Stats.make({ qemus, ...ZERO_STATS })),
  }),
);
