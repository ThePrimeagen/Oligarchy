import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import type { TestRendererSetup } from "@opentui/core/testing";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as Automation from "../../src/db/automation.ts";
import type * as ProcessStats from "../../src/db/process-stats.ts";
import type * as Servers from "../../src/db/servers.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Run from "../../src/viz/run.ts";
import * as View from "../../src/viz/view.ts";
import * as Config from "../support/config.ts";
import * as FakeHttp from "../support/fake-http.ts";
import { type FakeRenderer, fakeRenderer, rows, spans } from "../support/fake-renderer.ts";
import { byCommand, type FakeSpawner, fakeSpawner } from "../support/fake-spawner.ts";
import * as Stores from "../support/stores.ts";
import {
  ABORT_ENV,
  AUTOMATION_SERVER_URL,
  BLOCKS,
  bottom,
  box,
  COLUMNS,
  EMPTY_QUEUE,
  failed,
  FOOTER,
  garage,
  GARAGE_RIGHT,
  garageSeries,
  GOLD,
  header,
  job,
  LOVE,
  machinesTop,
  OPENED,
  pad,
  PLAIN,
  QUEUE,
  running,
  runner,
  RUNNING,
  runnerSeries,
  seedActions,
  SESSION_ID,
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

const storesLayer = (scripted: Scripted = {}, actions = Stores.fakeActionStore()) =>
  Layer.mergeAll(
    Stores.fakeServerStore({
      listMachines: scripted.machines ?? (() => Effect.succeed([garage, runner])),
    }).layer,
    Stores.fakeProcessStatsStore({
      listSeries: scripted.series ?? (() => Effect.succeed([garageSeries, runnerSeries])),
    }).layer,
    Stores.fakeAutomationStore({ listJobs: scripted.jobs ?? (() => Effect.succeed(QUEUE)) }).layer,
    actions.layer,
  );

// What a run may be given beyond the stores: a spawner that opens nothing unless told, servers
// that refuse every request unless told, and the token a follow or an abort sends them with
// the automation server's url.
type Extra = {
  readonly spawner?: FakeSpawner;
  readonly actions?: Stores.FakeActionStore;
  readonly http?: Layer.Layer<HttpClient.HttpClient>;
  readonly env?: Record<string, string>;
};

const live = (
  screen: FakeRenderer,
  scripted: Scripted = {},
  extra: Extra = {},
): Effect.Effect<void, Errors.CommandError> =>
  Run.run.pipe(
    Effect.provide(
      Layer.mergeAll(
        storesLayer(scripted, extra.actions ?? Stores.fakeActionStore()),
        screen.layer,
        (extra.spawner ?? fakeSpawner()).layer,
        extra.http ?? FakeHttp.respondWith(() => new Response(null, { status: 404 })),
        Config.withEnv(extra.env ?? ABORT_ENV),
      ),
    ),
  );

// The view forked and its screen once opened and painted.
const started = (screen: FakeRenderer, scripted: Scripted = {}, extra: Extra = {}) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(live(screen, scripted, extra), {
      startImmediately: true,
    });
    const setup = yield* screen.opened;
    yield* settle;
    return { fiber, setup };
  });

// The screen once `wanted` holds of its rows, giving the fibers behind a stream their turns.
const until = (
  setup: TestRendererSetup,
  wanted: (drawn: ReadonlyArray<string>) => boolean,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    let drawn: ReadonlyArray<string> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      yield* settle;
      drawn = yield* rows(setup);
      if (wanted(drawn)) {
        return drawn;
      }
    }
    return drawn;
  });

// A qemu server whose /follow answers with these events and then ends; anything else is refused.
const following = (events: ReadonlyArray<Domain.FollowEvent>): Layer.Layer<HttpClient.HttpClient> =>
  FakeHttp.respondWith((_request, url) =>
    url.pathname === "/follow"
      ? new Response(events.map(Domain.encodeFollowLine).join(""), { status: 200 })
      : new Response(null, { status: 404 }),
  );

const footer = (setup: TestRendererSetup): Effect.Effect<string> =>
  Effect.map(rows(setup), (drawn) => drawn[36] ?? "");

const refused = Errors.DatabaseError.make({
  operation: "listMachines",
  message: "Failed query: select 1",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

describe("run happy path", () => {
  it.effect(
    "opens the screen, reads and draws at once asking for the default finished tickets, ages every second, re-reads every ten, and q hands the screen back",
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
        expect(asked).toEqual([25]);
        const first = yield* rows(setup);
        expect(first).toHaveLength(37);
        expect(first[0]).toBe(machinesTop("read 0 s ago"));
        expect(first[1]).toBe(box("servers 1/1 │ driving 1/1 diagnosing 0/1"));
        expect(first[2]).toBe(box("▸ s  automation"));
        expect(first[5]).toContain("▸ runner");
        expect(first[5]).toContain("256 MB");
        expect(first[5]).toContain("8.0%");
        expect(first[6]).toContain("OLI-61");
        expect(first[35]).toBe(bottom());
        expect(first[36]).toBe(FOOTER);

        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(reads.count).toBe(1);
        const second = yield* rows(setup);
        expect(second[0]).toBe(machinesTop("read 1 s ago"));
        expect(second[6]).toContain("OLI-61");

        yield* TestClock.adjust("9 seconds");
        yield* settle;
        expect(reads.count).toBe(2);
        expect(asked).toEqual([25, 25]);
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

  it.effect(
    "a running job's spinner turns every 80 milliseconds while the read's age stays put",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(screen);
        const left = (row: string | undefined): string => (row ?? "").slice(2, 28);
        const first = yield* rows(setup);
        expect(left(first[6])).toContain(View.spinnerAt(0));
        expect(left(first[6])).toContain("45 s ago");
        expect(left(first[6])).not.toContain("drive");
        expect(first[0]).toBe(machinesTop("read 0 s ago"));
        yield* TestClock.adjust("80 millis");
        yield* settle;
        const next = yield* rows(setup);
        expect(left(next[6])).toContain(View.spinnerAt(View.SPIN_MS));
        expect(left(next[6])).not.toContain(View.spinnerAt(0));
        expect(left(next[6])).toContain("45 s ago");
        expect(next[0]).toBe(machinesTop("read 0 s ago"));
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect(
    "a key redraws at once: it opens on automation, l shows the qemu servers, j and k move the selection",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(screen);
        const opened = yield* rows(setup);
        expect(opened[5]).toContain("▸ runner");
        setup.mockInput.pressKey("l");
        yield* settle;
        const servers = yield* rows(setup);
        expect(servers[5]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        setup.mockInput.pressKey("j");
        yield* settle;
        // One server with one job: j selects the job.
        const onJob = yield* rows(setup);
        expect(onJob[5]).toBe(box(header("  garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(onJob[8]).toBe(box(job("▸", RUNNING)));
        setup.mockInput.pressKey("k");
        yield* settle;
        expect((yield* rows(setup))[5]).toBe(
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
        const { fiber, setup } = yield* started(screen, {}, { spawner });
        // The card is selected, not a job on it.
        setup.mockInput.pressKey("l", { shift: true });
        yield* settle;
        expect(spawner.spawned).toEqual([]);
        expect(yield* footer(setup)).toBe(pad(" no job selected", COLUMNS));
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("l", { shift: true });
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
        yield* TestClock.adjust("10 seconds");
        yield* settle;
        expect(yield* footer(setup)).toBe(OPENED);
        setup.mockInput.pressKey("k");
        yield* settle;
        expect(yield* footer(setup)).toBe(FOOTER);
        // The qemu tab's queue: its selection is what L opens.
        setup.mockInput.pressKey("l");
        setup.mockInput.pressTab();
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("l", { shift: true });
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
        const { fiber, setup } = yield* started(screen, {}, { spawner });
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("l", { shift: true });
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
      byUpper.setup.mockInput.pressKey("q", { shift: true });
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

  it.effect(
    "the ages count from the clock at the first frame, not from before a slow screen opened",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        // A screen three seconds in the opening, as a slow terminal setup would be.
        const slow = Layer.succeed(Run.Renderer)(
          Run.Renderer.of({
            open: Effect.andThen(Effect.sleep("3 seconds"), screen.open),
            imageProtocol: Effect.succeed("auto"),
          }),
        );
        const fiber = yield* Effect.forkChild(
          Run.run.pipe(
            Effect.provide(
              Layer.mergeAll(
                storesLayer(),
                slow,
                fakeSpawner().layer,
                FakeHttp.respondWith(() => new Response(null, { status: 404 })),
              ),
            ),
          ),
          { startImmediately: true },
        );
        yield* TestClock.adjust("3 seconds");
        const setup = yield* screen.opened;
        yield* settle;
        const first = yield* rows(setup);
        expect(first[0]).toBe(machinesTop("read 0 s ago"));
        expect(first.join("\n")).toContain("OLI-61");
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
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

        yield* TestClock.adjust("10 seconds");
        yield* settle;
        expect(calls.count).toBe(2);
        const failedFrame = yield* rows(setup);
        expect(failedFrame[0]).toBe(machinesTop("read 10 s ago"));
        expect(failedFrame.join("\n")).toContain("runner");
        expect(failedFrame[36]).toBe(
          pad(" error: Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432", COLUMNS),
        );
        const styled = yield* spans(setup);
        expect(styled[36]?.find((span) => span[0].startsWith("error: "))?.slice(1)).toEqual([
          LOVE,
          PLAIN,
        ]);

        yield* TestClock.adjust("10 seconds");
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
      expect(bare[1]).toBe(box("servers │ driving diagnosing"));
      expect(bare[2]).toBe(box("▸ s  automation"));
      expect(bare[35]).toBe(bottom());
      expect(bare[36]).toBe(pad(" error: timeout", COLUMNS));

      yield* TestClock.adjust("10 seconds");
      yield* settle;
      expect(calls.count).toBe(2);
      const shownNow = yield* rows(setup);
      expect(shownNow.join("\n")).toContain("OLI-61");
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
        { spawner: emptySpawner },
      );
      byEmpty.setup.mockInput.pressTab();
      byEmpty.setup.mockInput.pressKey("l", { shift: true });
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
        { spawner: unticketedSpawner },
      );
      // The unticketed job on garage's card, then the same job in the queue.
      byUnticketed.setup.mockInput.pressKey("j");
      byUnticketed.setup.mockInput.pressKey("l", { shift: true });
      yield* settle;
      expect(unticketedSpawner.spawned).toEqual([]);
      expect(yield* footer(byUnticketed.setup)).toBe(
        pad(" the selected job has no ticket", COLUMNS),
      );
      byUnticketed.setup.mockInput.pressTab();
      byUnticketed.setup.mockInput.pressKey("l", { shift: true });
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
      const byUnread = yield* started(
        unread,
        { jobs: () => Effect.never },
        { spawner: unreadSpawner },
      );
      byUnread.setup.mockInput.pressKey("l", { shift: true });
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
        const byMissing = yield* started(missing, {}, { spawner: missingSpawner });
        byMissing.setup.mockInput.pressKey("j");
        byMissing.setup.mockInput.pressKey("l", { shift: true });
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
        const byRefusing = yield* started(refusing, {}, { spawner: refusingSpawner });
        byRefusing.setup.mockInput.pressKey("j");
        byRefusing.setup.mockInput.pressKey("l", { shift: true });
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
      expect(regrown.join("\n")).toContain("runner");
      expect(regrown.join("\n")).toContain("OLI-61");
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
      expect(setup.renderer.isDestroyed).toBe(true);
    }),
  );

  it.effect(
    "a screen that fails to draw ends the run with the reason, the screen handed back",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(screen);
        // What OpenTUI raises when a render pass throws; synthetic, emitted on the renderer itself.
        setup.renderer.emit("render:error", { error: new Error("boom"), renderable: undefined });
        const error = yield* Effect.flip(Fiber.join(fiber));
        expect(error).toMatchObject({
          _tag: "CommandError",
          message: "viz could not draw the screen: boom",
        });
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
          imageProtocol: Effect.succeed("auto"),
          open: Effect.fail(
            Errors.CommandError.make({ message: "viz could not open the screen: no tty" }),
          ),
        }),
      );
      const error = yield* Effect.flip(
        Run.run.pipe(
          Effect.provide(
            Layer.mergeAll(
              storesLayer({ machines }),
              failing,
              fakeSpawner().layer,
              FakeHttp.respondWith(() => new Response(null, { status: 404 })),
            ),
          ),
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

// ---------------------------------------------------------------------------
// Follow: F peeks at a running job, F again follows it live
// ---------------------------------------------------------------------------

const PEEK_TITLE = "follow OLI-61 · 7a2d0000";
const seeded = (): Stores.FakeActionStore => {
  const actions = Stores.fakeActionStore();
  seedActions(actions);
  return actions;
};
const shows = (text: string) => (drawn: ReadonlyArray<string>) =>
  drawn.some((row) => row.includes(text));

describe("run follow happy path", () => {
  it.effect(
    "F on a running job on a card, or in the queue, opens a peek of its last three commands, their ages and its last image; escape closes it",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(screen, {}, { actions: seeded() });
        // The card header is selected; F needs a job.
        setup.mockInput.pressKey("f");
        yield* settle;
        expect(yield* footer(setup)).toBe(pad(" no job selected", COLUMNS));
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        const onCard = yield* until(setup, shows(PEEK_TITLE));
        expect(onCard.some((row) => row.includes("send-key"))).toBe(true);
        expect(onCard.some((row) => row.includes("input-send-event"))).toBe(true);
        expect(onCard.some((row) => row.includes("screendump"))).toBe(true);
        expect(onCard.some((row) => row.includes(" ago"))).toBe(true);
        expect(onCard.some((row) => row.includes("F full screen   esc close"))).toBe(true);
        expect(onCard.some((row) => BLOCKS.test(row))).toBe(true);
        // The footer still says the keys: F took the notice with it.
        expect(onCard[36]).toBe(FOOTER);
        setup.mockInput.pressEscape();
        yield* settle;
        const closed = yield* rows(setup);
        expect(closed.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        expect(closed.some((row) => BLOCKS.test(row))).toBe(false);
        // The qemu tab's queue opens the same peek.
        setup.mockInput.pressKey("l");
        setup.mockInput.pressTab();
        setup.mockInput.pressKey("f");
        const fromQueue = yield* until(setup, shows(PEEK_TITLE));
        expect(fromQueue.some((row) => row.includes(PEEK_TITLE))).toBe(true);
        // A move closes it and moves.
        setup.mockInput.pressKey("j");
        yield* settle;
        const moved = yield* rows(setup);
        expect(moved.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        expect(moved[13]?.startsWith("│ ▸ OLI-62")).toBe(true);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "F again on a peek opens a full-screen follow fed by the qemu server's stream, and escape brings the board back",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const http = following([
          { type: "session", status: "running" },
          { type: "action", id: 9, name: "mouse-click", state: "running" },
        ]);
        const { fiber, setup } = yield* started(screen, {}, { actions: seeded(), http });
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        yield* until(setup, shows(PEEK_TITLE));
        setup.mockInput.pressKey("f");
        const full = yield* until(setup, shows("mouse-click"));
        expect(full[0]).toBe(pad(" following OLI-61 · 7a2d0000 running", COLUMNS));
        expect(full[1]?.startsWith(" ✓ send-key")).toBe(true);
        expect(full[4]?.includes(" mouse-click")).toBe(true);
        expect(full.some((row) => BLOCKS.test(row))).toBe(true);
        expect(full.join("\n")).not.toContain("qemu servers");
        // The spinner turns every 80 milliseconds while the follow is up.
        const before = full[4]?.slice(1, 2);
        yield* TestClock.adjust("80 millis");
        yield* settle;
        const after = (yield* rows(setup))[4]?.slice(1, 2);
        expect(after).not.toBe(before);
        setup.mockInput.pressEscape();
        yield* settle;
        const back = yield* rows(setup);
        expect(back.join("\n")).not.toContain("following OLI-61");
        expect(back.join("\n")).toContain("runner");
        expect(back.some((row) => BLOCKS.test(row))).toBe(false);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect(
    "F on a running job whose session has not started waits, then opens the peek when it does",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const ready = { value: false };
        const jobs = () =>
          Effect.sync(() => ({
            running: [{ ...running, sessionId: ready.value ? SESSION_ID : null }],
            pending: [],
            completed: [],
          }));
        const { fiber, setup } = yield* started(screen, { jobs }, { actions: seeded() });
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        const waiting = yield* until(setup, shows("waiting for OLI-61's session"));
        expect(waiting[36]).toBe(pad(" waiting for OLI-61's session", COLUMNS));
        expect(waiting.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        // The board re-reads at ten seconds; the wait looks at that snapshot a second later.
        ready.value = true;
        yield* TestClock.adjust("11 seconds");
        const opened = yield* until(setup, shows(PEEK_TITLE));
        expect(opened.some((row) => row.includes(PEEK_TITLE))).toBe(true);
        expect(opened.some((row) => row.includes("send-key"))).toBe(true);
        expect(opened[36]).toBe(FOOTER);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
      }),
  );
});

describe("run follow unhappy path", () => {
  it.effect("F on a pending job, or with only completed jobs, says so and opens nothing", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const { fiber, setup } = yield* started(screen);
      setup.mockInput.pressKey("l");
      setup.mockInput.pressTab();
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      yield* settle;
      const drawn = yield* rows(setup);
      expect(drawn[36]).toBe(pad(" follow needs a running job", COLUMNS));
      expect(drawn.some((row) => row.includes("follow OLI-62"))).toBe(false);
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);

      const done = fakeRenderer();
      const byDone = yield* started(done, {
        jobs: () => Effect.succeed({ running: [], pending: [], completed: [failed] }),
      });
      byDone.setup.mockInput.pressKey("l");
      byDone.setup.mockInput.pressTab();
      byDone.setup.mockInput.pressKey("f");
      yield* settle;
      // Completed jobs are not listed; there is nothing to follow.
      expect(yield* footer(byDone.setup)).toBe(pad(" no job selected", COLUMNS));
      byDone.setup.mockInput.pressKey("q");
      yield* Fiber.join(byDone.fiber);
    }),
  );

  it.effect("F on a running job with no ticket and no session says so and opens nothing", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const { fiber, setup } = yield* started(screen, {
        jobs: () =>
          Effect.succeed({
            running: [{ ...running, sessionId: null, ticket: null }],
            pending: [],
            completed: [],
          }),
      });
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      yield* settle;
      expect(yield* footer(setup)).toBe(pad(" the selected job has no session", COLUMNS));
      expect((yield* rows(setup)).some((row) => row.includes("follow"))).toBe(false);
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("F that is still waiting opens nothing once the job is no longer running", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const alive = { value: true };
      const jobs = () =>
        Effect.sync(() =>
          alive.value
            ? {
                running: [{ ...running, sessionId: null }],
                pending: [],
                completed: [],
              }
            : EMPTY_QUEUE,
        );
      const { fiber, setup } = yield* started(screen, { jobs });
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      const waiting = yield* until(setup, shows("waiting for OLI-61's session"));
      expect(waiting[36]).toBe(pad(" waiting for OLI-61's session", COLUMNS));
      alive.value = false;
      yield* TestClock.adjust("11 seconds");
      const ended = yield* until(setup, shows("OLI-61 ended before a session"));
      expect(ended[36]).toBe(pad(" OLI-61 ended before a session", COLUMNS));
      expect(ended.some((row) => row.includes(PEEK_TITLE))).toBe(false);
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("moving off a job while F waits does not open its peek when the session starts", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const ready = { value: false };
      const jobs = () =>
        Effect.sync(() => ({
          running: [{ ...running, sessionId: ready.value ? SESSION_ID : null }],
          pending: [],
          completed: [],
        }));
      const { fiber, setup } = yield* started(screen, { jobs }, { actions: seeded() });
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      const waiting = yield* until(setup, shows("waiting for OLI-61's session"));
      expect(waiting[36]).toBe(pad(" waiting for OLI-61's session", COLUMNS));
      setup.mockInput.pressKey("k");
      yield* settle;
      ready.value = true;
      yield* TestClock.adjust("11 seconds");
      yield* settle;
      const moved = yield* rows(setup);
      expect(moved.some((row) => row.includes(PEEK_TITLE))).toBe(false);
      expect(moved[36]).toBe(FOOTER);
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("the second F without a qemu server, or without a token, says why", () =>
    Effect.gen(function* () {
      const noServer = fakeRenderer();
      const byNoServer = yield* started(
        noServer,
        {
          jobs: () =>
            Effect.succeed({
              running: [{ ...running, serverUrl: null }],
              pending: [],
              completed: [],
            }),
        },
        { actions: seeded() },
      );
      byNoServer.setup.mockInput.pressKey("j");
      byNoServer.setup.mockInput.pressKey("f");
      yield* until(byNoServer.setup, shows(PEEK_TITLE));
      byNoServer.setup.mockInput.pressKey("f");
      yield* settle;
      const serverless = yield* rows(byNoServer.setup);
      expect(serverless.some((row) => row.includes(PEEK_TITLE))).toBe(true);
      expect(serverless[36]).toBe(pad(" follow needs a qemu server", COLUMNS));
      byNoServer.setup.mockInput.pressKey("q");
      yield* Fiber.join(byNoServer.fiber);

      const noToken = fakeRenderer();
      const byNoToken = yield* started(noToken, {}, { actions: seeded(), env: {} });
      byNoToken.setup.mockInput.pressKey("j");
      byNoToken.setup.mockInput.pressKey("f");
      yield* until(byNoToken.setup, shows(PEEK_TITLE));
      byNoToken.setup.mockInput.pressKey("f");
      yield* settle;
      const unset = yield* rows(byNoToken.setup);
      expect(unset.some((row) => row.includes(PEEK_TITLE))).toBe(true);
      expect(unset[36]).toBe(pad(" OLIGARCHY_TOKEN is not set", COLUMNS));
      byNoToken.setup.mockInput.pressKey("q");
      yield* Fiber.join(byNoToken.fiber);
    }),
  );

  it.effect("a follow stream that ends while the session is still running was dropped", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const http = following([{ type: "session", status: "running" }]);
      const { fiber, setup } = yield* started(screen, {}, { actions: seeded(), http });
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      yield* until(setup, shows(PEEK_TITLE));
      setup.mockInput.pressKey("f");
      const dropped = yield* until(setup, shows("fell behind"));
      expect(dropped[0]).toBe(pad(" following OLI-61 · 7a2d0000 running", COLUMNS));
      expect(dropped[36]).toBe(
        pad(` dropped from ${SESSION_ID}: this follower fell behind`, COLUMNS),
      );
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("a follow stream that ends with the session over says nothing more", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const http = following([
        { type: "session", status: "running" },
        { type: "session", status: "succeeded" },
      ]);
      const { fiber, setup } = yield* started(screen, {}, { actions: seeded(), http });
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      yield* until(setup, shows(PEEK_TITLE));
      setup.mockInput.pressKey("f");
      const over = yield* until(setup, shows("succeeded"));
      expect(over[0]).toBe(pad(" following OLI-61 · 7a2d0000 succeeded", COLUMNS));
      expect(over[36]).toBe(pad(" esc closes", COLUMNS));
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect(
    "a qemu server that never answers blocks nothing: escape drops the connecting follow, F peeks again, and q quits",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(
          screen,
          {},
          {
            actions: seeded(),
            http: FakeHttp.never,
          },
        );
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        yield* until(setup, shows(PEEK_TITLE));
        setup.mockInput.pressKey("f");
        yield* settle;
        // Still the peek: the connect is in flight, and the keys are not behind it.
        const waiting = yield* rows(setup);
        expect(waiting.some((row) => row.includes(PEEK_TITLE))).toBe(true);
        expect(waiting[36]).toBe(FOOTER);
        setup.mockInput.pressEscape();
        yield* settle;
        const dropped = yield* rows(setup);
        expect(dropped.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        expect(dropped[36]).toBe(FOOTER);
        // A new peek opens, and a second connect can start after the first was dropped.
        setup.mockInput.pressKey("f");
        yield* until(setup, shows(PEEK_TITLE));
        setup.mockInput.pressKey("f");
        yield* settle;
        expect((yield* rows(setup)).some((row) => row.includes(PEEK_TITLE))).toBe(true);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "a database that never answers the peek holds no key: the board still moves, and q quits",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const stalled = Stores.fakeActionStore({ listActions: () => Effect.never });
        const { fiber, setup } = yield* started(screen, {}, { actions: stalled });
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        yield* settle;
        const waiting = yield* rows(setup);
        expect(waiting.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        expect(waiting[36]).toBe(FOOTER);
        setup.mockInput.pressKey("k");
        yield* settle;
        expect((yield* rows(setup))[5]).toContain("▸ runner");
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "a peek whose reads land after the selection moved on is dropped, and one whose reads land in time is shown",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const answered = { count: 0 };
        const slow = Stores.fakeActionStore({
          listActions: () =>
            Effect.as(Deferred.await(gate), []).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  answered.count += 1;
                }),
              ),
            ),
        });
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(screen, {}, { actions: slow });
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        yield* settle;
        // The selection moves on before the database answers: that peek is nobody's now.
        setup.mockInput.pressKey("k");
        yield* settle;
        yield* Deferred.succeed(gate, undefined);
        yield* settle;
        const moved = yield* rows(setup);
        expect(moved.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        expect(answered.count).toBe(0);
        // Asked again with the database answering at once, the peek shows.
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("f");
        const shownNow = yield* until(setup, shows(PEEK_TITLE));
        expect(shownNow.some((row) => row.includes("no commands yet"))).toBe(true);
        expect(answered.count).toBe(1);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect("a refused follow stream leaves the peek up and puts the reason on the footer", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const http = FakeHttp.respondWith(
        () =>
          new Response(JSON.stringify({ error: 'session "x" has already completed (succeeded)' }), {
            status: 409,
          }),
      );
      const { fiber, setup } = yield* started(screen, {}, { actions: seeded(), http });
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("f");
      yield* until(setup, shows(PEEK_TITLE));
      setup.mockInput.pressKey("f");
      const turnedAway = yield* until(setup, shows("already completed"));
      expect(turnedAway.some((row) => row.includes(PEEK_TITLE))).toBe(true);
      expect(turnedAway[36]).toContain('session "x" has already completed (succeeded)');
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );
});

// ---------------------------------------------------------------------------
// Abort: A hands the selected job to the automation server
// ---------------------------------------------------------------------------

const POPUP = `│  ${View.CANNOT_ABORT}  │`;

// An automation server whose /abort answers as scripted, every request recorded; anything else
// is refused.
const aborting = (respond: () => Response): FakeHttp.Recorder =>
  FakeHttp.recordRequests((_request, url) =>
    url.pathname === "/abort" ? respond() : new Response(null, { status: 404 }),
  );

const OVER = () => FakeHttp.json({ error: 'ticket "OLI-61" has no drive to abort' }, 400);

// A asks first: the question, yes, enter.
const confirmAbort = (setup: TestRendererSetup): void => {
  setup.mockInput.pressKey("a", { shift: true });
  setup.mockInput.pressKey("h");
  setup.mockInput.pressEnter();
};

const QUESTION = "are you sure?";

describe("run abort happy path", () => {
  it.effect(
    "A asks first: the question names the job with the marker on no, enter there closes it and sends nothing, h, l and the arrows move the marker, and enter on yes sends the abort",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const server = aborting(() => FakeHttp.json({ ok: "true" }));
        const { fiber, setup } = yield* started(screen, {}, { http: server.layer });
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("a", { shift: true });
        const asked = yield* until(setup, shows(QUESTION));
        expect(asked.some((row) => row.includes("─ abort drive OLI-61 ─"))).toBe(true);
        expect(asked.some((row) => row.includes("  yes    ▸ no"))).toBe(true);
        expect(asked.some((row) => row.includes(View.CONFIRM_HINT))).toBe(true);
        expect(asked[36]).toBe(FOOTER);
        setup.mockInput.pressEnter();
        yield* settle;
        expect((yield* rows(setup)).some((row) => row.includes(QUESTION))).toBe(false);
        expect(server.requests).toEqual([]);
        // Asked again: the arrows and h and l move between the answers.
        setup.mockInput.pressKey("a", { shift: true });
        setup.mockInput.pressKey("h");
        yield* until(setup, shows("▸ yes      no"));
        setup.mockInput.pressKey("l");
        yield* until(setup, shows("  yes    ▸ no"));
        setup.mockInput.pressArrow("left");
        yield* until(setup, shows("▸ yes      no"));
        setup.mockInput.pressArrow("right");
        yield* until(setup, shows("  yes    ▸ no"));
        setup.mockInput.pressKey("h");
        setup.mockInput.pressEnter();
        const closed = yield* until(setup, shows("aborted drive OLI-61"));
        expect(closed.some((row) => row.includes(QUESTION))).toBe(false);
        expect(server.requests).toHaveLength(1);
        expect(JSON.parse(server.requests[0]?.body ?? "")).toEqual({
          ticket: "OLI-61",
          action: "drive",
        });
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "A asks the automation server to abort the selected job on a card, or in the queue, with the token, re-reads the board at once and says so on the footer until the next key",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const board = { queue: QUEUE };
        const jobs = () => Effect.sync(() => board.queue);
        // The server closes the job named: the next read no longer lists it.
        const server: FakeHttp.Recorder = aborting(() => {
          const named: { ticket: string } = JSON.parse(server.requests.at(-1)?.body ?? "{}");
          board.queue = {
            ...board.queue,
            running: board.queue.running.filter((row) => row.ticket !== named.ticket),
            pending: board.queue.pending.filter((row) => row.ticket !== named.ticket),
          };
          return FakeHttp.json({ ok: "true" });
        });
        const { fiber, setup } = yield* started(screen, { jobs }, { http: server.layer });
        setup.mockInput.pressKey("j");
        confirmAbort(setup);
        const closed = yield* until(setup, shows("aborted drive OLI-61"));
        expect(server.requests).toEqual([
          expect.objectContaining({
            method: "POST",
            url: `${AUTOMATION_SERVER_URL}/abort`,
            headers: expect.objectContaining({ authorization: "Bearer test-token" }),
          }),
        ]);
        expect(JSON.parse(server.requests[0]?.body ?? "")).toEqual({
          ticket: "OLI-61",
          action: "drive",
        });
        expect(closed[36]).toBe(pad(" aborted drive OLI-61", COLUMNS));
        // Re-read at once: the job is off the card and out of the queue.
        expect(closed.slice(0, 36).some((row) => row.includes("OLI-61"))).toBe(false);
        expect(closed.join("\n")).toContain("runner");
        const styled = yield* spans(setup);
        expect(styled[36]?.find((span) => span[0].startsWith("aborted "))?.slice(1)).toEqual([
          GOLD,
          PLAIN,
        ]);
        // The qemu tab's queue, its first job now the pending one, goes the same way.
        setup.mockInput.pressKey("l");
        setup.mockInput.pressTab();
        confirmAbort(setup);
        const queued = yield* until(setup, shows("aborted drive OLI-62"));
        expect(server.requests).toHaveLength(2);
        expect(JSON.parse(server.requests[1]?.body ?? "")).toEqual({
          ticket: "OLI-62",
          action: "drive",
        });
        expect(queued[36]).toBe(pad(" aborted drive OLI-62", COLUMNS));
        expect(queued.some((row) => row.includes("no jobs"))).toBe(true);
        setup.mockInput.pressKey("k");
        yield* settle;
        expect(yield* footer(setup)).toBe(FOOTER);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "a job the server says is over pops up that completed jobs cannot be aborted, for three seconds, over a board that still moves; another A starts the three seconds again",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const server = aborting(OVER);
        const { fiber, setup } = yield* started(screen, {}, { http: server.layer });
        setup.mockInput.pressKey("j");
        confirmAbort(setup);
        const popped = yield* until(setup, shows(POPUP));
        expect(server.requests).toHaveLength(1);
        // In the middle of the screen, the footer's keys still under it.
        expect(popped[18]?.includes(POPUP)).toBe(true);
        expect(popped[36]).toBe(FOOTER);
        // A key moves the board and leaves the pop-up.
        setup.mockInput.pressKey("k");
        yield* settle;
        const moved = yield* rows(setup);
        expect(moved[5]).toContain("▸ runner");
        expect(moved.some((row) => row.includes(POPUP))).toBe(true);
        yield* TestClock.adjust("2 seconds");
        yield* settle;
        expect((yield* rows(setup)).some((row) => row.includes(POPUP))).toBe(true);
        // A second abort two seconds in: the pop-up outlives the first one's three seconds.
        setup.mockInput.pressKey("j");
        confirmAbort(setup);
        yield* until(setup, (drawn) => shows(POPUP)(drawn) && server.requests.length === 2);
        expect(server.requests).toHaveLength(2);
        yield* TestClock.adjust("1 second");
        yield* settle;
        expect((yield* rows(setup)).some((row) => row.includes(POPUP))).toBe(true);
        yield* TestClock.adjust("2 seconds");
        yield* settle;
        const gone = yield* rows(setup);
        expect(gone.some((row) => row.includes(POPUP))).toBe(false);
        expect(gone[36]).toBe(FOOTER);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );
});

describe("run abort unhappy path", () => {
  it.effect(
    "while the question is up the board's keys move nothing, L opens nothing, F follows nothing, escape closes it, and q quits with it up; nothing is sent",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const server = aborting(() => FakeHttp.json({ ok: "true" }));
        const spawner = fakeSpawner(byCommand({ "xdg-open": { exitCode: 0 } }));
        const { fiber, setup } = yield* started(
          screen,
          {},
          { http: server.layer, spawner, actions: seeded() },
        );
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("a", { shift: true });
        yield* until(setup, shows(QUESTION));
        setup.mockInput.pressKey("k");
        setup.mockInput.pressTab();
        setup.mockInput.pressKey("l", { shift: true });
        setup.mockInput.pressKey("f");
        yield* settle;
        const held = yield* rows(setup);
        expect(held.some((row) => row.includes(QUESTION))).toBe(true);
        expect(held.join("\n")).toContain("OLI-61");
        expect(held.some((row) => row.includes(PEEK_TITLE))).toBe(false);
        expect(spawner.spawned).toEqual([]);
        expect(held[36]).toBe(FOOTER);
        setup.mockInput.pressEscape();
        yield* settle;
        const closed = yield* rows(setup);
        expect(closed.some((row) => row.includes(QUESTION))).toBe(false);
        expect(closed.join("\n")).toContain("OLI-61");
        // The keys are the board's again.
        setup.mockInput.pressKey("k");
        yield* settle;
        expect((yield* rows(setup))[5]).toContain("▸ runner");
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("a", { shift: true });
        yield* until(setup, shows(QUESTION));
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
        expect(server.requests).toEqual([]);
      }),
  );

  it.effect("A with no job selected, or a job without a ticket, says so and asks nothing", () =>
    Effect.gen(function* () {
      const server = aborting(() => FakeHttp.json({ ok: "true" }));
      const onHeader = fakeRenderer();
      const byHeader = yield* started(onHeader, {}, { http: server.layer });
      byHeader.setup.mockInput.pressKey("a", { shift: true });
      yield* settle;
      const drawn = yield* rows(byHeader.setup);
      expect(drawn[36]).toBe(pad(" no job selected", COLUMNS));
      expect(drawn.some((row) => row.includes(QUESTION))).toBe(false);
      byHeader.setup.mockInput.pressKey("q");
      yield* Fiber.join(byHeader.fiber);

      const unticketed = fakeRenderer();
      const byUnticketed = yield* started(
        unticketed,
        {
          jobs: () => Effect.succeed({ ...EMPTY_QUEUE, running: [{ ...running, ticket: null }] }),
        },
        { http: server.layer },
      );
      byUnticketed.setup.mockInput.pressKey("j");
      byUnticketed.setup.mockInput.pressKey("a", { shift: true });
      yield* settle;
      const unticketedFrame = yield* rows(byUnticketed.setup);
      expect(unticketedFrame[36]).toBe(pad(" the selected job has no ticket", COLUMNS));
      expect(unticketedFrame.some((row) => row.includes(QUESTION))).toBe(false);
      byUnticketed.setup.mockInput.pressKey("q");
      yield* Fiber.join(byUnticketed.fiber);
      expect(server.requests).toEqual([]);
    }),
  );

  it.effect(
    "A without AUTOMATION_SERVER_URL, or without OLIGARCHY_TOKEN, says which is not set and asks nothing",
    () =>
      Effect.gen(function* () {
        const server = aborting(() => FakeHttp.json({ ok: "true" }));
        const noUrl = fakeRenderer();
        const byNoUrl = yield* started(
          noUrl,
          {},
          { http: server.layer, env: { OLIGARCHY_TOKEN: "test-token" } },
        );
        byNoUrl.setup.mockInput.pressKey("j");
        confirmAbort(byNoUrl.setup);
        yield* until(byNoUrl.setup, shows("is not set"));
        expect(yield* footer(byNoUrl.setup)).toBe(
          pad(" AUTOMATION_SERVER_URL is not set", COLUMNS),
        );
        byNoUrl.setup.mockInput.pressKey("q");
        yield* Fiber.join(byNoUrl.fiber);

        const noToken = fakeRenderer();
        const byNoToken = yield* started(
          noToken,
          {},
          { http: server.layer, env: { AUTOMATION_SERVER_URL } },
        );
        byNoToken.setup.mockInput.pressKey("j");
        confirmAbort(byNoToken.setup);
        yield* until(byNoToken.setup, shows("is not set"));
        expect(yield* footer(byNoToken.setup)).toBe(pad(" OLIGARCHY_TOKEN is not set", COLUMNS));
        byNoToken.setup.mockInput.pressKey("q");
        yield* Fiber.join(byNoToken.fiber);
        expect(server.requests).toEqual([]);
      }),
  );

  it.effect("the automation server's refusal lands on the footer in its words", () =>
    Effect.gen(function* () {
      const unauthorized = fakeRenderer();
      const byUnauthorized = yield* started(
        unauthorized,
        {},
        { http: aborting(() => FakeHttp.json({ error: "unauthorized" }, 401)).layer },
      );
      byUnauthorized.setup.mockInput.pressKey("j");
      confirmAbort(byUnauthorized.setup);
      const refusedFrame = yield* until(byUnauthorized.setup, shows("unauthorized"));
      expect(refusedFrame[36]).toBe(pad(" unauthorized", COLUMNS));
      expect(refusedFrame.some((row) => row.includes(POPUP))).toBe(false);
      // The board is not re-read for a refusal: the job is still listed.
      expect(refusedFrame.join("\n")).toContain("OLI-61");
      byUnauthorized.setup.mockInput.pressKey("q");
      yield* Fiber.join(byUnauthorized.fiber);

      const failing = fakeRenderer();
      const detail = `automation client: POST ${runner.url}/abort failed: opencode exited 1`;
      const byFailing = yield* started(
        failing,
        {},
        { http: aborting(() => FakeHttp.json({ error: detail }, 500)).layer },
      );
      byFailing.setup.mockInput.pressKey("j");
      confirmAbort(byFailing.setup);
      const failedFrame = yield* until(byFailing.setup, shows("opencode exited 1"));
      expect(failedFrame[36]).toBe(pad(` ${detail}`, COLUMNS));
      byFailing.setup.mockInput.pressKey("q");
      yield* Fiber.join(byFailing.fiber);
    }),
  );

  it.effect("an automation server that cannot be reached says so on the footer", () =>
    Effect.gen(function* () {
      const screen = fakeRenderer();
      const http = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:4242"),
            }),
          }),
        ),
      );
      const { fiber, setup } = yield* started(screen, {}, { http });
      setup.mockInput.pressKey("j");
      confirmAbort(setup);
      const unreachable = yield* until(setup, shows("ECONNREFUSED"));
      expect(unreachable[36]).toBe(
        pad(
          ` POST ${AUTOMATION_SERVER_URL}/abort failed: connect ECONNREFUSED 127.0.0.1:4242`,
          COLUMNS,
        ),
      );
      setup.mockInput.pressKey("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect(
    "an automation server that never answers holds no key: the board still moves, and q quits",
    () =>
      Effect.gen(function* () {
        const screen = fakeRenderer();
        const { fiber, setup } = yield* started(screen, {}, { http: FakeHttp.never });
        setup.mockInput.pressKey("l");
        setup.mockInput.pressTab();
        setup.mockInput.pressKey("j");
        confirmAbort(setup);
        yield* settle;
        expect(yield* footer(setup)).toBe(FOOTER);
        setup.mockInput.pressKey("k");
        yield* settle;
        const moved = yield* rows(setup);
        expect(moved[12]?.startsWith("│ ▸ OLI-61")).toBe(true);
        expect(moved[13]?.startsWith("│   OLI-62")).toBe(true);
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );

  it.effect(
    "one abort is in flight at a time: a second A says which, asks nothing, and the A after the answer goes through",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const screen = fakeRenderer();
        const board = { queue: QUEUE };
        const jobs = () => Effect.sync(() => board.queue);
        const server = FakeHttp.recordRequests((_request, url) =>
          url.pathname === "/abort"
            ? Effect.as(Deferred.await(gate), FakeHttp.json({ ok: "true" }))
            : new Response(null, { status: 404 }),
        );
        const { fiber, setup } = yield* started(screen, { jobs }, { http: server.layer });
        setup.mockInput.pressKey("l");
        setup.mockInput.pressTab();
        confirmAbort(setup);
        yield* settle;
        expect(server.requests).toHaveLength(1);
        expect(yield* footer(setup)).toBe(FOOTER);
        // Another A, on the next job, while the server has not answered the first: no question.
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("a", { shift: true });
        yield* settle;
        expect(server.requests).toHaveLength(1);
        const waiting = yield* rows(setup);
        expect(waiting[36]).toBe(pad(" still aborting drive OLI-61", COLUMNS));
        expect(waiting.some((row) => row.includes(QUESTION))).toBe(false);
        // The answer lands: the board is read again and the footer says so.
        board.queue = { ...QUEUE, running: [] };
        yield* Deferred.succeed(gate, undefined);
        const closed = yield* until(setup, shows("aborted drive OLI-61"));
        expect(closed[36]).toBe(pad(" aborted drive OLI-61", COLUMNS));
        expect(closed.slice(0, 36).some((row) => row.includes("OLI-61"))).toBe(false);
        // With nothing in flight, the next A is sent: the one job left is selected.
        confirmAbort(setup);
        yield* until(setup, shows("aborted drive OLI-62"));
        expect(server.requests).toHaveLength(2);
        expect(JSON.parse(server.requests[1]?.body ?? "")).toEqual({
          ticket: "OLI-62",
          action: "drive",
        });
        setup.mockInput.pressKey("q");
        yield* Fiber.join(fiber);
        expect(setup.renderer.isDestroyed).toBe(true);
      }),
  );
});
