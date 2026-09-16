import { Cause, Deferred, Effect, Exit, Layer, Option, Ref } from "effect";
import type { PlatformError } from "effect";
import * as Iso from "../../src/qemu/iso.ts";
import * as Qemu from "../../src/qemu/qemu.ts";
import * as Stats from "../../src/qemu/stats.ts";
import type * as Qmp from "../../src/qmp/client.ts";
import * as Contract from "../../src/shared/contract.ts";
import type * as Domain from "../../src/shared/domain.ts";
import type * as Errors from "../../src/shared/errors.ts";

export type StartInput = Parameters<Qemu.QemuService["start"]>[1];
export type MouseGesture = Parameters<Qemu.QemuHandle["mouse"]>[0];
export type ExchangeError =
  | Errors.QmpError
  | Errors.QmpTimeout
  | Errors.QmpClosed
  | Errors.DatabaseError;

export type Call =
  | { readonly _tag: "prepare"; readonly id: string; readonly source: Qemu.DiskSource }
  | {
      readonly _tag: "start";
      readonly id: string;
      readonly cdrom: string | undefined;
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
  | { readonly _tag: "mouse"; readonly id: string; readonly gesture: MouseGesture }
  | { readonly _tag: "screendump"; readonly id: string }
  | { readonly _tag: "powerdown"; readonly id: string }
  | { readonly _tag: "stderrTail"; readonly id: string };

// Every hook defaults to success; a hook that fails scripts that step's failure.
export type Script = {
  // The system_powerdown exchange; the guest then exits 0 unless `powersOff` is false.
  readonly powerdown?: (id: string) => Effect.Effect<void, ExchangeError>;
  readonly powersOff?: boolean;
  // The session dir, disk and firmware: a failing qemu-img create fails here.
  readonly prepare?: (
    id: string,
    source: Qemu.DiskSource,
  ) => Effect.Effect<void, Errors.QemuStartError>;
  // Runs once the handle's release is registered and before the handshake is recorded.
  readonly boot?: (
    input: StartInput,
  ) => Effect.Effect<void, Errors.QemuStartError | Errors.DatabaseError>;
  // The handle's release: leaving the session scope. `Effect.die` scripts a failing stop.
  readonly stop?: (id: string) => Effect.Effect<void>;
  // One send-key exchange per chord; the first failure stops the run.
  readonly sendKey?: (chord: ReadonlyArray<string>) => Effect.Effect<void, ExchangeError>;
  // Applied to the first input-send-event exchange of a mouse gesture.
  readonly mouse?: (gesture: MouseGesture) => Effect.Effect<void, ExchangeError>;
  // The bytes a screendump yields. A Qmp* or DatabaseError failure is a failed exchange; a
  // PlatformError is a completed exchange whose file could not be read.
  readonly screendump?: () => Effect.Effect<
    Uint8Array,
    ExchangeError | PlatformError.PlatformError
  >;
  // Where session directories live; `sessionDir(id)` is `${tmp}/oligarchy-${id}`.
  readonly tmp?: string;
  // The QEMU process stderr tail a failed stop snapshots. `stderrTail` wins when both are set.
  readonly stderr?: string;
  readonly stderrTail?: () => Effect.Effect<string>;
};

export type FakeQemu = {
  readonly calls: Array<Call>;
  readonly sessionDir: (id: string) => string;
  // The guest of this session leaves on its own: QEMU exits with the code.
  readonly exit: (id: string, code: number | null) => Effect.Effect<void>;
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
  // One exit per booted session, completed by a powerdown the guest honours or by `exit`.
  const exits = new Map<string, Deferred.Deferred<number | null>>();

  const makeHandle = (
    prepared: Qemu.Prepared,
    seq: Ref.Ref<number>,
    exit: Deferred.Deferred<number | null>,
  ): Qemu.QemuHandle => {
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
      diskPath: prepared.diskPath,
      varsPath: `${dir}/OVMF_VARS.fd`,
      powerdown: (record) =>
        Effect.gen(function* () {
          calls.push({ _tag: "powerdown", id });
          const commandId = yield* next;
          yield* exchange(
            record,
            { execute: "system_powerdown", arguments: {}, id: commandId },
            script.powerdown?.(id) ?? Effect.void,
          );
          if (script.powersOff !== false) {
            yield* Deferred.succeed(exit, 0);
          }
        }),
      running: Effect.map(Deferred.isDone(exit), (done) => !done),
      exited: Deferred.await(exit),
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
      // The real handle's shapes without their pacing, interpolation or cleanup: a move is one
      // exchange, a click two, a double-click four, a tick two, a drag a press, a move and a
      // release, a hold or a release one, and held modifiers a key down and a key up exchange
      // around the gesture. `first` scripts the first exchange.
      mouse: (gesture, record) =>
        Effect.gen(function* () {
          calls.push({ _tag: "mouse", id, gesture });
          const first = script.mouse?.(gesture) ?? Effect.void;
          const at = (point: Domain.ScreenPoint): ReadonlyArray<Domain.QmpInputEvent> => [
            { type: "abs", data: { axis: "x", value: Math.round(point.x * TABLET_AXIS_MAX) } },
            { type: "abs", data: { axis: "y", value: Math.round(point.y * TABLET_AXIS_MAX) } },
          ];
          const btn = (button: Domain.InputButton, down: boolean): Domain.QmpInputEvent => ({
            type: "btn",
            data: { button, down },
          });
          const modifiers =
            gesture._tag === "click" || gesture._tag === "double-click" || gesture._tag === "drag"
              ? gesture.modifiers
              : undefined;
          const held = (pressed: boolean): ReadonlyArray<Domain.QmpInputEvent> =>
            (modifiers ?? []).map((modifier) => ({
              type: "key",
              data: { down: pressed, key: { type: "qcode", data: modifier } },
            }));
          if (modifiers !== undefined) {
            yield* inputEvents(held(true), record, first);
          }
          const opening = modifiers === undefined ? first : Effect.void;
          const pulses = (point: Domain.ScreenPoint, button: Domain.InputButton, count: number) =>
            Effect.gen(function* () {
              for (let pulse = 0; pulse < count; pulse++) {
                yield* inputEvents(
                  [...at(point), btn(button, true)],
                  record,
                  pulse === 0 ? opening : Effect.void,
                );
                yield* inputEvents([btn(button, false)], record, Effect.void);
              }
            });
          switch (gesture._tag) {
            case "move":
              yield* inputEvents(at(gesture), record, opening);
              break;
            case "click":
              yield* pulses(gesture, gesture.button, 1);
              break;
            case "double-click":
              yield* pulses(gesture, gesture.button, 2);
              break;
            case "scroll":
              yield* pulses(gesture, `wheel-${gesture.direction}`, gesture.ticks);
              break;
            case "drag":
              yield* inputEvents([...at(gesture.from), btn(gesture.button, true)], record, opening);
              yield* inputEvents(at(gesture.to), record, Effect.void);
              yield* inputEvents(
                [...at(gesture.to), btn(gesture.button, false)],
                record,
                Effect.void,
              );
              break;
            case "hold":
              yield* inputEvents([...at(gesture), btn(gesture.button, true)], record, opening);
              break;
            case "release":
              yield* inputEvents([...at(gesture), btn(gesture.button, false)], record, opening);
              break;
          }
          if (modifiers !== undefined) {
            yield* inputEvents(held(false), record, Effect.void);
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
      stderrTail: Effect.suspend(() => {
        calls.push({ _tag: "stderrTail", id });
        return script.stderrTail?.() ?? Effect.succeed(script.stderr ?? "");
      }),
    };
  };

  const service = Qemu.Qemu.of({
    prepare: (id, source) =>
      Effect.gen(function* () {
        calls.push({ _tag: "prepare", id, source });
        yield* script.prepare?.(id, source) ?? Effect.void;
        const dir = sessionDir(id);
        return {
          id,
          dir,
          diskPath: source._tag === "existing" ? source.path : `${dir}/disk.qcow2`,
        };
      }),
    start: (prepared, input) =>
      Effect.gen(function* () {
        calls.push({
          _tag: "start",
          id: prepared.id,
          cdrom: input.cdrom,
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
        const exit = yield* Deferred.make<number | null>();
        exits.set(prepared.id, exit);
        return makeHandle(prepared, yield* Ref.make(1), exit);
      }),
  });

  const exit = (id: string, code: number | null): Effect.Effect<void> =>
    Effect.suspend(() => {
      const pending = exits.get(id);
      return pending === undefined
        ? Effect.die(`fake qemu: no machine ${id} to exit`)
        : Effect.asVoid(Deferred.succeed(pending, code));
    });

  // `sessionDir` is the harness's: where a test finds the files the fake writes for a session.
  return { calls, sessionDir, exit, layer: Layer.succeed(Qemu.Qemu)(service) };
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

// An Iso that answers with the name it was given, or whatever `resolve` scripts; `pathOf` answers
// the name too unless scripted, as a local iso path is its own boot path.
export const fakeIso = (
  resolve: Resolve = (call) => Effect.succeed(call.name),
  pathOf: (name: string) => string = (name) => name,
): FakeIso => {
  const calls: Array<IsoCall> = [];
  const service = Iso.Iso.of({
    getIso: (name, who) =>
      Effect.suspend(() => {
        const call = { name, sessionId: who.sessionId, agentId: who.agentId };
        calls.push(call);
        return resolve(call);
      }),
    pathOf: (name) => Effect.sync(() => pathOf(name)),
  });
  return { calls, layer: Layer.succeed(Iso.Iso)(service) };
};

export const ZERO_STATS = {
  memory: Contract.Memory.make({ totalBytes: 0, usedBytes: 0, freeBytes: 0 }),
  cpu: Contract.Cpu.make({
    cores: 0,
    mean: 0,
    mean1m: 0,
    mean2m: 0,
    mean3m: 0,
    p10: 0,
    p25: 0,
    p75: 0,
    p90: 0,
  }),
};

// Stats that report zeros and echo the qemu count they are given.
export const fakeStats: Layer.Layer<Stats.Stats> = Layer.succeed(Stats.Stats)(
  Stats.Stats.of({
    collect: (qemus) => Effect.succeed(Contract.Stats.make({ qemus, ...ZERO_STATS })),
  }),
);
