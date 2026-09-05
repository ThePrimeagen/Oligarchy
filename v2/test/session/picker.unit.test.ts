import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Path, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as Picker from "../../src/session/picker.ts";
import * as Readline from "../../src/session/readline.ts";
import * as State from "../../src/session/state.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeChildren from "../support/fake-children.ts";
import { fakeTty, stripAnsi, type FakeTty } from "../support/fake-tty.ts";

const FOLLOWED_ID = "7a2d0000-0000-4000-8000-00000000f011";
const PENDING_ID = "ff88a0b1-0851-47a7-91d3-acbfb20b8673";
const STARTED_AT = "2026-09-04T11:59:55.000Z";
const ESC = String.fromCharCode(27);
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

// The cursor was hidden for the picker and shown again when it left.
const expectCursorRestored = (text: string): void => {
  const hidden = text.indexOf(HIDE_CURSOR);
  expect(hidden).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(SHOW_CURSOR)).toBeGreaterThan(hidden);
};

const running = (id: string): Picker.SessionListItem => ({
  id,
  status: "running",
  startedAt: STARTED_AT,
});
const downloading = (id: string): Picker.SessionListItem => ({
  id,
  status: "downloading",
  startedAt: STARTED_AT,
});

// Lets the forked picker take the input before the test emits keys at it.
const untilWritten = (tty: FakeTty, text: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let i = 0; i < 100 && !tty.written().includes(text); i++) {
      yield* Effect.yieldNow;
    }
  });

// A picker terminal over a fake tty, taking the keys straight from the input.
const pickerTty = (tty: FakeTty): Picker.Tty => ({
  takeKeypresses: Readline.takeKeypresses(tty.input),
  output: tty.output,
});

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

type Rows = Effect.Effect<ReadonlyArray<Picker.SessionListItem>>;

const gate = Effect.gen(function* () {
  const deferred = yield* Deferred.make<ReadonlyArray<Picker.SessionListItem>>();
  const rows: Rows = Deferred.await(deferred);
  return {
    rows,
    provide: (items: ReadonlyArray<Picker.SessionListItem>) => Deferred.succeed(deferred, items),
  };
});

describe("picker view", () => {
  it.effect("maps keys to actions", () =>
    Effect.sync(() => {
      expect(Picker.keyAction({ name: "up" })).toBe("up");
      expect(Picker.keyAction({ name: "tab", shift: true })).toBe("up");
      expect(Picker.keyAction({ name: "down" })).toBe("down");
      expect(Picker.keyAction({ name: "tab", shift: false })).toBe("down");
      expect(Picker.keyAction({ name: "tab" })).toBe("down");
      expect(Picker.keyAction({ name: "return" })).toBe("select");
      expect(Picker.keyAction({ name: "enter" })).toBe("select");
      expect(Picker.keyAction({ name: "escape" })).toBe("cancel");
      expect(Picker.keyAction({ name: "c", ctrl: true })).toBe("cancel");
      expect(Picker.keyAction({ name: "c" })).toBe("ignore");
      expect(Picker.keyAction({ name: "a" })).toBe("ignore");
    }),
  );

  it.effect("bounds visible rows to rows - 3 and wraps the selection", () =>
    Effect.sync(() => {
      const ten = Array.from({ length: 10 }, (_, index) => running(`id-${String(index)}`));
      const loaded = Picker.loaded(Picker.initialView, ten, 6);
      expect(loaded.visibleCount).toBe(3);
      expect(loaded.lineCount).toBe(5);
      expect(Picker.loaded(Picker.initialView, ten, 40).visibleCount).toBe(10);
      expect(Picker.loaded(Picker.initialView, ten, 2).visibleCount).toBe(1);
      expect(Picker.apply(loaded, "up").selected).toBe(9);
      expect(Picker.apply(Picker.apply(loaded, "up"), "down").selected).toBe(0);
      expect(Picker.apply(loaded, "down").selected).toBe(1);
    }),
  );

  it.effect(
    "draws the header, a marker, coloured labels with pending for downloading, and the footer",
    () =>
      Effect.sync(() => {
        const view = Picker.loaded(
          Picker.initialView,
          [running(FOLLOWED_ID), downloading(PENDING_ID)],
          24,
        );
        const first = Picker.draw(view, 100, false);
        expect(first.startsWith("\r\x1b[2K  active sessions\r\n")).toBe(true);
        expect(first).toContain(
          `\x1b[2K\x1b[36m›\x1b[0m \x1b[33mrunning\x1b[0m  ${FOLLOWED_ID}\r\n`,
        );
        expect(first).toContain(`\x1b[2K  \x1b[90mpending\x1b[0m  ${PENDING_ID}\r\n`);
        expect(
          first.endsWith("\x1b[2K  ↑/↓ or tab navigate • enter select • esc/ctrl-c cancel"),
        ).toBe(true);
        expect(first).not.toContain("\n\n");
        const redraw = Picker.draw(Picker.apply(view, "down"), 100, true);
        expect(redraw.startsWith("\x1b[3A\r")).toBe(true);
        expect(redraw).toContain(`\x1b[36m›\x1b[0m \x1b[90mpending`);
      }),
  );

  it.effect("truncates ids to columns - 11 and the text lines to the columns", () =>
    Effect.sync(() => {
      const view = Picker.loaded(Picker.initialView, [running(FOLLOWED_ID)], 24);
      const drawn = Picker.draw(view, 30, false);
      expect(drawn).toContain(FOLLOWED_ID.slice(0, 19));
      expect(drawn).not.toContain(FOLLOWED_ID.slice(0, 20));
      for (const line of stripAnsi(drawn).split("\r\n")) {
        expect(line.replaceAll("\r", "").length).toBeLessThanOrEqual(30);
      }
    }),
  );

  it.effect("scrolls the visible window to keep the selection on screen", () =>
    Effect.sync(() => {
      const ten = Array.from({ length: 10 }, (_, index) => running(`id-${String(index)}`));
      const view = Picker.apply(Picker.loaded(Picker.initialView, ten, 6), "up");
      const drawn = stripAnsi(Picker.draw(view, 100, true));
      expect(drawn).toContain("id-9");
      expect(drawn).toContain("id-7");
      expect(drawn).not.toContain("id-6");
    }),
  );

  it.effect("leaveText clears every line, returns to the prompt column and shows the cursor", () =>
    Effect.sync(() => {
      expect(Picker.leaveText(3, 16)).toBe(
        "\r\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[17G\x1b[?25h",
      );
      expect(Picker.LOADING).toBe("\x1b[?25l\r\n\x1b[2K  loading sessions...");
    }),
  );
});

describe("picker runner", () => {
  it.effect(
    "owns input while the session list is loading so a fast Enter cannot submit follow",
    () =>
      Effect.gen(function* () {
        const tty = fakeTty();
        const { rows, provide } = yield* gate;
        const fiber = yield* Effect.forkChild(Picker.run(rows, pickerTty(tty), 16), {
          startImmediately: true,
        });
        yield* untilWritten(tty, "loading sessions");
        tty.keypress("\r", { name: "return" });
        yield* provide([running(FOLLOWED_ID)]);
        yield* settle;
        expect(fiber.pollUnsafe()).toBeUndefined();
        tty.keypress("\r", { name: "return" });
        expect(yield* Fiber.join(fiber)).toEqual(Option.some(FOLLOWED_ID));
      }),
  );

  it.effect("cancels with Escape or Ctrl-C while the session list is loading", () =>
    Effect.gen(function* () {
      for (const [text, key] of [
        ["\x1b", { name: "escape" }],
        ["\x03", { name: "c", ctrl: true }],
      ] as const) {
        const tty = fakeTty();
        const { rows, provide } = yield* gate;
        const fiber = yield* Effect.forkChild(Picker.run(rows, pickerTty(tty), 16), {
          startImmediately: true,
        });
        yield* untilWritten(tty, "loading sessions");
        tty.keypress(text, key);
        expect(yield* Fiber.join(fiber)).toEqual(Option.none());
        yield* provide([running(FOLLOWED_ID)]);
        yield* settle;
        expect(tty.written().includes(FOLLOWED_ID)).toBe(false);
      }
    }),
  );

  it.effect("restores the terminal when shutdown interrupts a loading picker", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const { rows, provide } = yield* gate;
      const fiber = yield* Effect.forkChild(Picker.run(rows, pickerTty(tty), 16), {
        startImmediately: true,
      });
      yield* untilWritten(tty, "loading sessions");
      yield* Fiber.interrupt(fiber);
      yield* provide([running(FOLLOWED_ID)]);
      yield* settle;
      expectCursorRestored(tty.written());
      expect(tty.written().includes(FOLLOWED_ID)).toBe(false);
      expect(tty.input.listenerCount("keypress")).toBe(0);
    }),
  );

  it.effect("bounds and truncates the picker on a narrow, short terminal", () =>
    Effect.gen(function* () {
      const tty = fakeTty({ columns: 30, rows: 6 });
      const rows = Array.from({ length: 10 }, (_, index) =>
        running(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
      );
      const fiber = yield* Effect.forkChild(Picker.run(Effect.succeed(rows), pickerTty(tty), 16), {
        startImmediately: true,
      });
      yield* untilWritten(tty, "active sessions");
      tty.keypress("", { name: "up" });
      tty.keypress("\r", { name: "return" });
      expect(yield* Fiber.join(fiber)).toEqual(Option.some(rows[9]?.id));
      const output = tty.written();
      const finalDraw = output.slice(output.lastIndexOf("active sessions"));
      const lines = stripAnsi(finalDraw).split("\r\n");
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        expect(line.replaceAll("\r", "").length).toBeLessThanOrEqual(30);
      }
    }),
  );

  it.effect("shows running sessions first, colors statuses, and selects with the keyboard", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const fiber = yield* Effect.forkChild(
        Picker.run(
          Effect.succeed([running(FOLLOWED_ID), downloading(PENDING_ID)]),
          pickerTty(tty),
          16,
        ),
        { startImmediately: true },
      );
      yield* untilWritten(tty, "active sessions");
      tty.keypress("\t", { name: "tab", shift: false });
      tty.keypress("\r", { name: "return" });
      expect(yield* Fiber.join(fiber)).toEqual(Option.some(PENDING_ID));
      const output = tty.written();
      expect(output.indexOf(FOLLOWED_ID)).toBeLessThan(output.indexOf(PENDING_ID));
      expect(output).toMatch(new RegExp(`${ESC}\\[33mrunning\\s*${ESC}\\[0m\\s+${FOLLOWED_ID}`));
      expect(output).toMatch(new RegExp(`${ESC}\\[90mpending\\s*${ESC}\\[0m\\s+${PENDING_ID}`));
    }),
  );

  it.effect("fails when no active sessions exist and prints nothing itself", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const failure = yield* Effect.flip(Picker.run(Effect.succeed([]), pickerTty(tty), 16));
      expect(failure).toMatchObject({
        _tag: "CommandError",
        message: "no running or pending sessions",
      });
      expect(tty.written()).not.toMatch(/no running or pending sessions/);
      expectCursorRestored(tty.written());
    }),
  );

  it.effect("passes a failing session list through after restoring the terminal", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const failure = yield* Effect.flip(
        Picker.run(
          Effect.fail(Errors.CommandError.make({ message: "DATABASE_URL is not set" })),
          pickerTty(tty),
          16,
        ),
      );
      expect(failure.message).toBe("DATABASE_URL is not set");
      expect(tty.written().endsWith(SHOW_CURSOR)).toBe(true);
    }),
  );

  it.effect("cancels without selecting when escape is pressed", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const fiber = yield* Effect.forkChild(
        Picker.run(Effect.succeed([running(FOLLOWED_ID)]), pickerTty(tty), 16),
        { startImmediately: true },
      );
      yield* untilWritten(tty, "active sessions");
      tty.keypress("\x1b", { name: "escape" });
      expect(yield* Fiber.join(fiber)).toEqual(Option.none());
      expectCursorRestored(tty.written());
    }),
  );

  it.effect("swallows the LF that follows the selecting CR before handing input back", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const seen: Array<string | undefined> = [];
      tty.input.on("keypress", (text: string | undefined) => {
        seen.push(text);
      });
      const fiber = yield* Effect.forkChild(
        Picker.run(Effect.succeed([running(FOLLOWED_ID)]), pickerTty(tty), 16),
        { startImmediately: true },
      );
      yield* untilWritten(tty, "active sessions");
      tty.keypress("\r", { name: "return" });
      expect(yield* Fiber.join(fiber)).toEqual(Option.some(FOLLOWED_ID));
      yield* settle;
      // The previous listener is still detached: the LF of the same Enter has not arrived yet.
      expect(seen).toEqual([]);
      tty.keypress("\n", { name: "enter" });
      yield* settle;
      expect(seen).toEqual([]);
      tty.keypress("x", { name: "x" });
      yield* settle;
      expect(seen).toEqual(["x"]);
    }),
  );

  it.effect("hands input back after 100 ms when no LF follows the CR", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const seen: Array<string | undefined> = [];
      tty.input.on("keypress", (text: string | undefined) => {
        seen.push(text);
      });
      const fiber = yield* Effect.forkChild(
        Picker.run(Effect.succeed([running(FOLLOWED_ID)]), pickerTty(tty), 16),
        { startImmediately: true },
      );
      yield* untilWritten(tty, "active sessions");
      tty.keypress("\r", { name: "return" });
      expect(yield* Fiber.join(fiber)).toEqual(Option.some(FOLLOWED_ID));
      yield* TestClock.adjust("99 millis");
      yield* settle;
      tty.keypress("y", { name: "y" });
      yield* settle;
      // Inside the window a non-LF key is passed on to the restored listener.
      expect(seen).toEqual(["y"]);
      const tty2 = fakeTty();
      const seen2: Array<string | undefined> = [];
      tty2.input.on("keypress", (text: string | undefined) => {
        seen2.push(text);
      });
      const fiber2 = yield* Effect.forkChild(
        Picker.run(Effect.succeed([running(FOLLOWED_ID)]), pickerTty(tty2), 16),
        { startImmediately: true },
      );
      yield* untilWritten(tty2, "active sessions");
      tty2.keypress("\r", { name: "return" });
      yield* Fiber.join(fiber2);
      yield* TestClock.adjust("100 millis");
      yield* settle;
      tty2.keypress("\n", { name: "enter" });
      yield* settle;
      // After the window the LF is readline's again.
      expect(seen2).toEqual(["\n"]);
    }),
  );

  it.effect("cancelling restores the previous listeners at once", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const seen: Array<string | undefined> = [];
      tty.input.on("keypress", (text: string | undefined) => {
        seen.push(text);
      });
      const fiber = yield* Effect.forkChild(
        Picker.run(Effect.succeed([running(FOLLOWED_ID)]), pickerTty(tty), 16),
        { startImmediately: true },
      );
      yield* untilWritten(tty, "active sessions");
      tty.keypress("\x1b", { name: "escape" });
      yield* Fiber.join(fiber);
      tty.keypress("\n", { name: "enter" });
      expect(seen).toEqual(["\n"]);
    }),
  );

  it.effect("leaves the selected UUID editable when LF arrives after the selected CR", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const termName = process.env.TERM;
      process.env.TERM = "xterm-256color";
      const terminal = yield* Readline.open(tty.input, tty.output);
      if (termName === undefined) {
        delete process.env.TERM;
      } else {
        process.env.TERM = termName;
      }
      yield* Readline.enableFollowPickerCompletion(terminal.handle);
      const submitted: Array<string> = [];
      terminal.handle.on("line", (line) => {
        submitted.push(line);
      });
      yield* Effect.forkScoped(
        Stream.runForEach(terminal.completions, (request) =>
          Picker.run(
            Effect.succeed([running(FOLLOWED_ID)]),
            { takeKeypresses: terminal.takeKeypresses, output: tty.output },
            16,
          ).pipe(
            Effect.map((selected) => {
              const prefix = /^follow\s+(\S*)$/.exec(request.line)?.[1] ?? "";
              request.complete([Option.isSome(selected) ? [selected.value] : [], prefix]);
            }),
          ),
        ),
      );
      terminal.handle.write("follow ");
      tty.keypress("\t", { name: "tab" });
      yield* untilWritten(tty, "active sessions");
      tty.keypress("\r", { name: "return" });
      yield* settle;
      tty.keypress("\n", { name: "enter" });
      yield* settle;
      expect(submitted).toEqual([]);
      expect(terminal.handle.line).toBe(`follow ${FOLLOWED_ID}`);
    }),
  );
});

describe("listSessions and completeFollow", () => {
  const env = (tty: FakeTty, spawner: FakeChildren.FakeSpawner) =>
    Layer.mergeAll(
      Layer.succeed(State.Host)(
        State.Host.of({
          execPath: "/usr/bin/node",
          imageProtocol: "kitty",
          input: tty.input,
          output: tty.output,
          termination: Effect.never,
        }),
      ),
      spawner.layer,
      Path.layer,
    );

  it.effect("runs ctrl session list with the server url and filters by prefix", () =>
    Effect.gen(function* () {
      const tty = fakeTty();
      const spawner = FakeChildren.fakeSpawner(() => ({
        code: 0,
        stdout: JSON.stringify([running(FOLLOWED_ID), downloading(PENDING_ID)]),
      }));
      const items = yield* Picker.listSessions("http://127.0.0.1:1", "ff").pipe(
        Effect.provide(env(tty, spawner)),
      );
      expect(items).toEqual([downloading(PENDING_ID)]);
      const [ctrl] = spawner.spawned;
      expect(ctrl?.command.command).toBe("/usr/bin/node");
      expect(ctrl?.command.args.slice(0, 2)).toEqual([
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
      ]);
      expect(ctrl?.command.args[2]?.endsWith("/src/ctrl/main.ts")).toBe(true);
      expect(ctrl?.command.args.slice(3)).toEqual([
        "session",
        "list",
        "--count",
        "10",
        "--active",
        "--json",
        "--server-url",
        "http://127.0.0.1:1",
      ]);
      expect(ctrl?.command.options.detached).toBe(false);
    }),
  );

  it.effect(
    "fails with the ctrl's stderr when it exits non-zero, and when nothing matches the prefix",
    () =>
      Effect.gen(function* () {
        const tty = fakeTty();
        const failing = FakeChildren.fakeSpawner(() => ({
          code: 1,
          stderr: "DATABASE_URL is not set\n",
        }));
        const failure = yield* Effect.flip(
          Picker.listSessions("http://127.0.0.1:1", "").pipe(Effect.provide(env(tty, failing))),
        );
        expect(failure._tag).toBe("ChildExit");
        expect(failure.message).toBe("DATABASE_URL is not set");
        const empty = FakeChildren.fakeSpawner(() => ({
          code: 0,
          stdout: JSON.stringify([running(FOLLOWED_ID)]),
        }));
        const noMatch = yield* Effect.flip(
          Picker.listSessions("http://127.0.0.1:1", "zzz").pipe(Effect.provide(env(tty, empty))),
        );
        expect(noMatch).toMatchObject({
          _tag: "CommandError",
          message: "no matching running or pending sessions",
        });
      }),
  );

  it.effect(
    "completeFollow returns the picked id, or prints the failure and repaints the prompt",
    () =>
      Effect.gen(function* () {
        const tty = fakeTty();
        const spawner = FakeChildren.fakeSpawner((_, index) =>
          index === 0
            ? { code: 0, stdout: JSON.stringify([running(FOLLOWED_ID)]) }
            : { code: 1, stderr: "DATABASE_URL is not set" },
        );
        const terminal = yield* Readline.open(tty.input, tty.output);
        const session = yield* State.make("http://127.0.0.1:1");
        const fiber = yield* Effect.forkChild(
          Picker.completeFollow(session, terminal, "").pipe(Effect.provide(env(tty, spawner))),
          { startImmediately: true },
        );
        yield* untilWritten(tty, "active sessions");
        tty.keypress("\r", { name: "return" });
        expect(yield* Fiber.join(fiber)).toEqual([[FOLLOWED_ID], ""]);
        const before = tty.written().length;
        const failed = yield* Picker.completeFollow(session, terminal, "7a").pipe(
          Effect.provide(env(tty, spawner)),
        );
        expect(failed).toEqual([[], "7a"]);
        expect(tty.written().slice(before)).toContain("\r\nDATABASE_URL is not set\r\n");
      }),
  );
});
