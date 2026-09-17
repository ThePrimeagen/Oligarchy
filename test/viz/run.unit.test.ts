import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import type { TestRendererSetup } from "@opentui/core/testing";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import type * as Automation from "../../src/db/automation.ts";
import type * as ProcessStats from "../../src/db/process-stats.ts";
import type * as Servers from "../../src/db/servers.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Run from "../../src/viz/run.ts";
import * as View from "../../src/viz/view.ts";
import { type FakeRenderer, fakeRenderer, rows, spans } from "../support/fake-renderer.ts";
import { byCommand, type FakeSpawner, fakeSpawner } from "../support/fake-spawner.ts";
import * as Stores from "../support/stores.ts";
import {
  bottom,
  box,
  COLUMNS,
  CPU_TOP,
  EMPTY_QUEUE,
  FOOTER,
  garage,
  GARAGE_RIGHT,
  garageSeries,
  GOLD,
  header,
  job,
  JOBS_TOP,
  labels,
  LOVE,
  machinesTop,
  MEM_TOP,
  OPENED,
  pad,
  PLAIN,
  QUEUE,
  running,
  runner,
  RUNNER_RIGHT,
  RUNNING,
  runnerSeries,
} from "../support/viz.ts";

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

type Scripted = {
  readonly machines?: () => Effect.Effect<ReadonlyArray<Servers.Machine>, Errors.DatabaseError>;
  readonly series?: () => Effect.Effect<ReadonlyArray<ProcessStats.Series>, Errors.DatabaseError>;
  readonly jobs?: (
    count: number,
  ) => Effect.Effect<Automation.AutomationQueue, Errors.DatabaseError>;
};

const storesLayer = (scripted: Scripted = {}) =>
  Layer.mergeAll(
    Stores.fakeServerStore({
      listMachines: scripted.machines ?? (() => Effect.succeed([garage, runner])),
    }).layer,
    Stores.fakeProcessStatsStore({
      listSeries: scripted.series ?? (() => Effect.succeed([garageSeries, runnerSeries])),
    }).layer,
    Stores.fakeAutomationStore({ listJobs: scripted.jobs ?? (() => Effect.succeed(QUEUE)) }).layer,
  );

// The view over the scripted stores, the screen, and a spawner that opens nothing unless told.
const live = (
  screen: FakeRenderer,
  scripted: Scripted = {},
  spawner: FakeSpawner = fakeSpawner(),
): Effect.Effect<void, Errors.CommandError> =>
  Run.run.pipe(Effect.provide(Layer.mergeAll(storesLayer(scripted), screen.layer, spawner.layer)));

// The view forked and its screen once opened and painted.
const started = (
  screen: FakeRenderer,
  scripted: Scripted = {},
  spawner: FakeSpawner = fakeSpawner(),
) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(live(screen, scripted, spawner), {
      startImmediately: true,
    });
    const setup = yield* screen.opened;
    yield* settle;
    return { fiber, setup };
  });

const footer = (setup: TestRendererSetup): Effect.Effect<string> =>
  Effect.map(rows(setup), (drawn) => drawn[36] ?? "");

const refused = Errors.DatabaseError.make({
  operation: "listMachines",
  message: "Failed query: select 1",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

describe("run happy path", () => {
  it.effect(
    "opens the screen, reads and draws at once asking for no completed jobs, ages every second, re-reads every five, and q hands the screen back",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer({ columns: 135, rows: 37 });
        const reads = { count: 0 };
        const machines = () =>
          Effect.sync(() => {
            reads.count += 1;
            return [garage, runner];
          });
        const asked: Array<number> = [];
        const jobs = (count: number) =>
          Effect.sync(() => {
            asked.push(count);
            return QUEUE;
          });
        const { fiber, setup } = yield* started(screen, { machines, jobs });
        expect(reads.count).toBe(1);
        expect(asked).toEqual([0]);
        const first = yield* rows(setup);
        expect(first).toHaveLength(37);
        expect(first[0]).toBe(machinesTop("read 0 s ago"));
        expect(first[1]).toBe(box("qemu servers · 1 │ automation clients · 1"));
        expect(first[2]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(first[3]).toBe(box(labels(CPU_TOP, MEM_TOP, JOBS_TOP)));
        expect(first[5]).toBe(box(job(" ", RUNNING)));
        // One server in this fleet, so the queue sits right under its card.
        expect(first[6]).toBe(bottom());
        expect(first[9]).toBe(box(job("▸", RUNNING)));
        expect(first[36]).toBe(FOOTER);

        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(reads.count).toBe(1);
        const second = yield* rows(setup);
        expect(second[0]).toBe(machinesTop("read 1 s ago"));
        expect(second[2]).toContain("seen 13 s ago");

        yield* TestClock.adjust("4 seconds");
        yield* settle;
        expect(reads.count).toBe(2);
        expect(asked).toEqual([0, 0]);
        expect((yield* rows(setup))[0]).toBe(machinesTop("read 0 s ago"));

        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
        // Nothing runs once the screen is back.
        yield* TestClock.adjust("10 seconds");
        yield* settle;
        expect(reads.count).toBe(2);
        expect(screen.setups).toHaveLength(1);
      }),
  );

  it.effect("a key redraws at once: l shows the clients, j and k move the selection", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const { fiber, setup } = yield* started(screen);
      setup.mockInput.pressKey("l");
      yield* settle;
      const clients = yield* rows(setup);
      expect(clients[2]).toBe(box(header("▸ runner · http://10.0.0.9:7000", RUNNER_RIGHT)));
      setup.mockInput.pressKey("h");
      setup.mockInput.pressKey("j");
      yield* settle;
      // One server with one job: j selects the job.
      const onJob = yield* rows(setup);
      expect(onJob[2]).toBe(box(header("  garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
      expect(onJob[5]).toBe(box(job("▸", RUNNING)));
      setup.mockInput.pressKey("k");
      yield* settle;
      expect((yield* rows(setup))[2]).toBe(
        box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)),
      );
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
      expect(setup.renderer.isDestroyed).toBe(true);
    }),
  );

  it.effect(
    "L opens the focused list's selected job with xdg-open, detached and left to itself, and the footer says so until the next key",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const spawner = fakeSpawner(byCommand({ "xdg-open": { exitCode: 0 } }));
        const { fiber, setup } = yield* started(screen, {}, spawner);
        // The card is selected, not a job on it.
        setup.mockInput.pressKey("L");
        yield* settle;
        expect(spawner.spawned).toEqual([]);
        expect(yield* footer(setup)).toBe(pad(" no job selected", COLUMNS));
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("L");
        yield* settle;
        expect(spawner.spawned).toHaveLength(1);
        const [opened] = spawner.spawned;
        expect(opened).toMatchObject({
          command: "xdg-open",
          args: ["https://linear.app/issue/OLI-61"],
        });
        // The browser is the desktop's, so it gets the desktop's environment, none of our stdio,
        // and its own process group, and the scope closing does not kill it.
        expect(opened.options).toMatchObject({
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          extendEnv: true,
          detached: true,
        });
        expect(opened.isReferenced()).toBe(false);
        expect(opened.isReleased()).toBe(true);
        expect(opened.kills).toEqual([]);
        expect(yield* footer(setup)).toBe(OPENED);
        const styled = yield* spans(setup);
        expect(styled[36]?.find((span) => span[0].startsWith("opened https"))?.slice(1)).toEqual([
          GOLD,
          PLAIN,
        ]);
        // The notice outlives the age ticks and the reads, and goes with the next key.
        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(yield* footer(setup)).toBe(OPENED);
        setup.mockInput.pressKey("k");
        yield* settle;
        expect(yield* footer(setup)).toBe(FOOTER);
        // The queue focused: its selection is what L opens.
        setup.mockInput.pressTab();
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("L");
        yield* settle;
        expect(spawner.spawned).toHaveLength(2);
        expect(spawner.spawned[1]?.args).toEqual(["https://linear.app/issue/OLI-62"]);
        expect(yield* footer(setup)).toBe(pad(" opened https://linear.app/issue/OLI-62", COLUMNS));
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "an xdg-open still running two seconds on has handed the url to a browser in its foreground: opened, and left running",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const spawner = fakeSpawner(byCommand({ "xdg-open": {} }));
        const { fiber, setup } = yield* started(screen, {}, spawner);
        setup.mockInput.pressTab();
        setup.mockInput.pressKey("L");
        yield* settle;
        expect(spawner.spawned).toHaveLength(1);
        expect(yield* footer(setup)).toBe(FOOTER);
        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(yield* footer(setup)).toBe(FOOTER);
        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(yield* footer(setup)).toBe(OPENED);
        const [opened] = spawner.spawned;
        expect(yield* opened.isRunning).toBe(true);
        expect(opened.isReferenced()).toBe(false);
        expect(opened.isReleased()).toBe(true);
        expect(opened.kills).toEqual([]);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(opened.kills).toEqual([]);
      }),
  );

  it.effect("Q quits too, and so does ctrl-c, which raw mode delivers as a key", () =>
    Effect.gen(function* () {
      const upper = fakeRenderer();
      const byUpper = yield* started(upper);
      byUpper.setup.mockInput.pressKey("x");
      yield* settle;
      expect(byUpper.setup.renderer.isDestroyed).toBe(false);
      byUpper.setup.mockInput.pressKey("Q");
      yield* Fiber.join(byUpper.fiber);
      expect(byUpper.setup.renderer.isDestroyed).toBe(true);

      const interrupted = fakeRenderer();
      const byCtrlC = yield* started(interrupted);
      byCtrlC.setup.mockInput.pressCtrlC();
      yield* Fiber.join(byCtrlC.fiber);
      expect(byCtrlC.setup.renderer.isDestroyed).toBe(true);
    }),
  );

  it.effect("an interrupt (SIGTERM) hands the screen back too", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const { fiber, setup } = yield* started(screen);
      expect(setup.renderer.isDestroyed).toBe(false);
      yield* Fiber.interrupt(fiber);
      expect(setup.renderer.isDestroyed).toBe(true);
    }),
  );
});

describe("run unhappy path", () => {
  it.effect(
    "a failed read keeps the last snapshot and puts the reason on the footer; the next good read clears it",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const calls = { count: 0 };
        const machines = () =>
          Effect.suspend(() => {
            calls.count += 1;
            return calls.count === 2 ? Effect.fail(refused) : Effect.succeed([garage, runner]);
          });
        const { fiber, setup } = yield* started(screen, { machines });
        expect(yield* footer(setup)).toBe(FOOTER);

        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(calls.count).toBe(2);
        const failedFrame = yield* rows(setup);
        expect(failedFrame[0]).toBe(machinesTop("read 5 s ago"));
        expect(failedFrame[2]).toContain("http://127.0.0.1:55332");
        expect(failedFrame[36]).toBe(
          pad(" error: Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432", COLUMNS),
        );
        const styled = yield* spans(setup);
        expect(styled[36]?.find((span) => span[0].startsWith("error: "))?.slice(1)).toEqual([
          LOVE,
          PLAIN,
        ]);

        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(calls.count).toBe(3);
        const recovered = yield* rows(setup);
        expect(recovered[0]).toBe(machinesTop("read 0 s ago"));
        expect(recovered[36]).toBe(FOOTER);

        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect("a first read that fails shows the reason under the empty boxes and keeps trying", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const calls = { count: 0 };
      const jobs = () =>
        Effect.suspend(() => {
          calls.count += 1;
          return calls.count === 1
            ? Effect.fail(
                Errors.DatabaseError.make({ operation: "listAutomationJobs", message: "timeout" }),
              )
            : Effect.succeed(QUEUE);
        });
      const { fiber, setup } = yield* started(screen, { jobs });
      const bare = yield* rows(setup);
      expect(bare[0]).toBe(machinesTop("reading…"));
      expect(bare[1]).toBe(box("qemu servers │ automation clients"));
      expect(bare[2]).toBe(bottom());
      expect(bare[36]).toBe(pad(" error: timeout", COLUMNS));

      yield* TestClock.adjust("5 seconds");
      yield* settle;
      expect(calls.count).toBe(2);
      const shownNow = yield* rows(setup);
      expect(shownNow[9]).toBe(box(job("▸", RUNNING)));
      expect(shownNow[36]).toBe(FOOTER);

      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("L with no job selected, or a job without a ticket, says so and opens nothing", () =>
    Effect.gen(function* () {
      const empty = fakeRenderer();
      const emptySpawner = fakeSpawner();
      const byEmpty = yield* started(
        empty,
        { jobs: () => Effect.succeed(EMPTY_QUEUE) },
        emptySpawner,
      );
      byEmpty.setup.mockInput.pressTab();
      byEmpty.setup.mockInput.pressKey("L");
      yield* settle;
      expect(emptySpawner.spawned).toEqual([]);
      expect(yield* footer(byEmpty.setup)).toBe(pad(" no job selected", COLUMNS));
      byEmpty.setup.mockInput.pressKey("q");
      yield* Fiber.join(byEmpty.fiber);

      const unticketed = fakeRenderer();
      const unticketedSpawner = fakeSpawner();
      const byUnticketed = yield* started(
        unticketed,
        {
          jobs: () => Effect.succeed({ ...EMPTY_QUEUE, running: [{ ...running, ticket: null }] }),
        },
        unticketedSpawner,
      );
      // The unticketed job on garage's card, then the same job in the queue.
      byUnticketed.setup.mockInput.pressKey("j");
      byUnticketed.setup.mockInput.pressKey("L");
      yield* settle;
      expect(unticketedSpawner.spawned).toEqual([]);
      expect(yield* footer(byUnticketed.setup)).toBe(
        pad(" the selected job has no ticket", COLUMNS),
      );
      byUnticketed.setup.mockInput.pressTab();
      byUnticketed.setup.mockInput.pressKey("L");
      yield* settle;
      expect(unticketedSpawner.spawned).toEqual([]);
      expect(yield* footer(byUnticketed.setup)).toBe(
        pad(" the selected job has no ticket", COLUMNS),
      );
      byUnticketed.setup.mockInput.pressKey("q");
      yield* Fiber.join(byUnticketed.fiber);

      // Before the first read there is nothing to open either.
      const unread = fakeRenderer();
      const unreadSpawner = fakeSpawner();
      const byUnread = yield* started(unread, { jobs: () => Effect.never }, unreadSpawner);
      byUnread.setup.mockInput.pressKey("L");
      yield* settle;
      expect(unreadSpawner.spawned).toEqual([]);
      expect(yield* footer(byUnread.setup)).toBe(pad(" no job selected", COLUMNS));
      byUnread.setup.mockInput.pressKey("q");
      yield* Fiber.join(byUnread.fiber);
    }),
  );

  it.effect(
    "L puts xdg-open's refusal on the footer: the binary missing, or an exit that says nothing handles the url",
    () =>
      Effect.gen(function* () {
        const missing = fakeRenderer();
        const missingSpawner = fakeSpawner(
          byCommand({ "xdg-open": { spawnError: "spawn xdg-open ENOENT" } }),
        );
        const byMissing = yield* started(missing, {}, missingSpawner);
        byMissing.setup.mockInput.pressTab();
        byMissing.setup.mockInput.pressKey("L");
        yield* settle;
        expect(missingSpawner.spawned).toEqual([]);
        expect(yield* footer(byMissing.setup)).toBe(
          pad(" xdg-open: spawn xdg-open ENOENT", COLUMNS),
        );
        const styled = yield* spans(byMissing.setup);
        expect(styled[36]?.find((span) => span[0].startsWith("xdg-open: "))?.slice(1)).toEqual([
          GOLD,
          PLAIN,
        ]);
        // The view goes on: the next key retires the notice and the screen still works.
        byMissing.setup.mockInput.pressKey("j");
        yield* settle;
        expect(yield* footer(byMissing.setup)).toBe(FOOTER);
        byMissing.setup.mockInput.pressKey("q");
        yield* Fiber.join(byMissing.fiber);
        expect(byMissing.setup.renderer.isDestroyed).toBe(true);

        const refusing = fakeRenderer();
        const refusingSpawner = fakeSpawner(byCommand({ "xdg-open": { exitCode: 3 } }));
        const byRefusing = yield* started(refusing, {}, refusingSpawner);
        byRefusing.setup.mockInput.pressTab();
        byRefusing.setup.mockInput.pressKey("L");
        yield* settle;
        expect(refusingSpawner.spawned).toHaveLength(1);
        expect(yield* footer(byRefusing.setup)).toBe(pad(" xdg-open exited 3", COLUMNS));
        byRefusing.setup.mockInput.pressKey("q");
        yield* Fiber.join(byRefusing.fiber);
      }),
  );

  it.effect("a terminal shrunk below the minimum shows the size it needs until it grows back", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const { fiber, setup } = yield* started(screen);
      setup.resize(100, 24);
      yield* settle;
      const small = yield* rows(setup);
      expect(small).toHaveLength(24);
      expect(small[0]).toBe(pad(View.tooSmall(100, 24), 100));
      expect(small.slice(1).every((row) => row.trim() === "")).toBe(true);
      // The ages still tick underneath, so the frame is current when the terminal grows back.
      yield* TestClock.adjust("1 second");
      yield* settle;
      setup.resize(140, 40);
      yield* settle;
      const regrown = yield* rows(setup);
      expect(regrown).toHaveLength(40);
      expect(regrown[0]).toBe(machinesTop("read 1 s ago", 140));
      expect(regrown[2]).toContain("http://127.0.0.1:55332");
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
      expect(setup.renderer.isDestroyed).toBe(true);
    }),
  );

  it.effect("a screen that cannot be opened ends the run with the reason, before any read", () =>
    Effect.gen(function* () {
      const reads = { count: 0 };
      const machines = () =>
        Effect.sync(() => {
          reads.count += 1;
          return [garage, runner];
        });
      const failing = Layer.succeed(Run.Renderer)(
        Run.Renderer.of({
          open: Effect.fail(
            Errors.CommandError.make({ message: "viz could not open the screen: no tty" }),
          ),
        }),
      );
      const error = yield* Effect.flip(
        Run.run.pipe(
          Effect.provide(Layer.mergeAll(storesLayer({ machines }), failing, fakeSpawner().layer)),
        ),
      );
      expect(error).toMatchObject({
        _tag: "CommandError",
        message: "viz could not open the screen: no tty",
      });
      expect(reads.count).toBe(0);
    }),
  );
});
