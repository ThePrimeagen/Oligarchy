import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestConsole } from "effect/testing";
import { CliError, Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Api from "../../src/shared/api.ts";
import * as VizCommand from "../../src/viz/command.ts";
import * as View from "../../src/viz/view.ts";
import * as Config from "../support/config.ts";
import { fakeTerminal } from "../support/fake-terminal.ts";
import { stripAnsi } from "../support/fake-tty.ts";
import * as StdioSupport from "../support/stdio.ts";
import * as Stores from "../support/stores.ts";

const WITH_DB = { DATABASE_URL: "postgres://user:pw@127.0.0.1:5432/oligarchy" };

const SpawnerStub = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
  ChildProcessSpawner.make(() => Effect.die("unexpected ChildProcessSpawner.spawn")),
);

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

// The stores count their reads, so a refusal can be shown to have read nothing.
const harness = (size: { readonly columns: number; readonly rows: number }) =>
  Effect.gen(function* () {
    const tty = yield* fakeTerminal(size);
    const reads = { count: 0 };
    const counted = <A>(rows: A) =>
      Effect.sync(() => {
        reads.count += 1;
        return rows;
      });
    const servers = Stores.fakeServerStore({ listMachines: () => counted([]) });
    const process = Stores.fakeProcessStatsStore({ listSeries: () => counted([]) });
    const automation = Stores.fakeAutomationStore({
      listJobs: () => counted({ running: [], pending: [], completed: [] }),
    });
    const touched: Array<string> = [];
    const stdio = StdioSupport.capture();
    const command = VizCommand.makeVizCommand({
      database: () => {
        touched.push("database");
        return Layer.mergeAll(servers.layer, process.layer, automation.layer);
      },
    });
    const run = (args: ReadonlyArray<string>, env: Record<string, string> = WITH_DB) =>
      Effect.exit(
        Command.runWith(command, { version: Api.VERSION })(args).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeFileSystem.layer,
              NodePath.layer,
              SpawnerStub,
              tty.layer,
              stdio.layer,
              Config.withEnv(env),
            ),
          ),
        ),
      );
    return { tty, reads, touched, stdio, run };
  });

const failure = (exit: Exit.Exit<void, unknown>): unknown => {
  if (Exit.isSuccess(exit)) {
    throw new Error("expected the command to fail");
  }
  return Cause.squash(exit.cause);
};

describe("viz happy path", () => {
  it.effect("--help exits 0 without touching the database or the screen", () =>
    Effect.gen(function* () {
      const h = yield* harness({ columns: 135, rows: 37 });
      expect(Exit.isSuccess(yield* h.run(["--help"], {}))).toBe(true);
      expect(h.touched).toEqual([]);
      expect(h.reads.count).toBe(0);
      expect(h.tty.frames).toEqual([]);
      const printed = (yield* TestConsole.logLines).join("\n");
      expect(printed).toMatch(/automation queue/);
      expect(printed).toMatch(/running and pending/);
      expect(printed).toMatch(/jobs running on it/);
      expect(printed).toMatch(/j\/k/);
      expect(printed).toMatch(/tab moves between the machines and the queue/);
      expect(printed).toMatch(/h\/l switch servers and clients/);
      expect(printed).toMatch(/L opens the selected job's Linear ticket/);
      expect(printed).toMatch(/q quits/);
    }),
  );

  it.effect(
    "on a 135×37 terminal takes the screen, reads and draws, and q ends it with success",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({ columns: 135, rows: 37 });
        const fiber = yield* Effect.forkChild(h.run([]), { startImmediately: true });
        yield* settle;
        expect(h.touched).toEqual(["database"]);
        expect(h.reads.count).toBe(3);
        expect(h.tty.frames[0]).toBe(View.ENTER_SCREEN);
        const drawn = stripAnsi(h.tty.frames[1] ?? "");
        expect(drawn).toContain("qemu servers · 0");
        expect(drawn).toContain("no qemu servers registered");
        expect(drawn).toContain("automation · running 0 · pending 0");
        yield* h.tty.press("q");
        const exit = yield* Fiber.join(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(h.tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
        expect(yield* TestConsole.logLines).toEqual([]);
        expect(h.stdio.stdout).toEqual([]);
        expect(h.stdio.stderr).toEqual([]);
      }),
  );
});

describe("viz unhappy path", () => {
  it.effect("wants DATABASE_URL before it looks at the terminal", () =>
    Effect.gen(function* () {
      const h = yield* harness({ columns: 0, rows: 0 });
      const exit = yield* h.run([], {});
      expect(failure(exit)).toMatchObject({
        _tag: "MissingVariable",
        message: "DATABASE_URL is not set",
      });
      expect(h.touched).toEqual([]);
      expect(h.tty.frames).toEqual([]);
    }),
  );

  it.effect("refuses a stdout that is not a terminal without reading anything", () =>
    Effect.gen(function* () {
      const h = yield* harness({ columns: 0, rows: 0 });
      const exit = yield* h.run([]);
      expect(failure(exit)).toMatchObject({
        _tag: "CommandError",
        message: "viz needs a terminal",
      });
      expect(h.reads.count).toBe(0);
      expect(h.tty.frames).toEqual([]);
    }),
  );

  it.effect(
    "refuses a terminal narrower than 135 columns or shorter than 37 rows, naming both sizes",
    () =>
      Effect.gen(function* () {
        const narrow = yield* harness({ columns: 134, rows: 37 });
        expect(failure(yield* narrow.run([]))).toMatchObject({
          _tag: "CommandError",
          message: "viz needs a terminal of at least 135×37 (columns×rows); this one is 134×37",
        });
        expect(narrow.reads.count).toBe(0);
        expect(narrow.tty.frames).toEqual([]);

        const short = yield* harness({ columns: 135, rows: 36 });
        expect(failure(yield* short.run([]))).toMatchObject({
          _tag: "CommandError",
          message: "viz needs a terminal of at least 135×37 (columns×rows); this one is 135×36",
        });
        expect(short.reads.count).toBe(0);
        expect(short.tty.frames).toEqual([]);
      }),
  );

  it.effect("rejects a positional argument and an unknown flag", () =>
    Effect.gen(function* () {
      const h = yield* harness({ columns: 135, rows: 37 });
      const positional = failure(yield* h.run(["servers"]));
      expect(CliError.isCliError(positional)).toBe(true);
      const unknown = failure(yield* h.run(["--refresh", "1"]));
      expect(CliError.isCliError(unknown)).toBe(true);
      expect(h.reads.count).toBe(0);
      expect(h.tty.frames).toEqual([]);
    }),
  );
});
