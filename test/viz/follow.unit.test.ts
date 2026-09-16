import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, type PlatformError, Queue, type Terminal } from "effect";
import { TestClock } from "effect/testing";
import type * as Automation from "../../src/db/automation.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Follow from "../../src/viz/follow.ts";
import * as View from "../../src/viz/view.ts";
import * as Image from "../../src/session/image.ts";
import * as FakeHttp from "../support/fake-http.ts";
import { fakeTerminal, type FakeTerminal } from "../support/fake-terminal.ts";
import { stripAnsi } from "../support/fake-tty.ts";
import * as Config from "../support/config.ts";
import * as Stores from "../support/stores.ts";
import type * as ProcessStats from "../../src/db/process-stats.ts";
import type * as Servers from "../../src/db/servers.ts";
import { type FakeSpawner, fakeSpawner } from "../support/fake-spawner.ts";

const SESSION_ID = "7a2d0000-0000-4000-8000-00000000f011";
const IMAGE_ID = "9c4f0000-0000-4000-8000-00000000b2d3";
const COLUMNS = 135;
const ROWS = 37;
const READ_AT = 1_000_000;
const QUERIED_AT = new Date("2026-09-09T16:00:00Z");
const NOW = QUERIED_AT.getTime();

const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

const sendKey = { execute: "send-key" as const, arguments: { keys: [] }, id: 1 };
const screendump = {
  execute: "screendump" as const,
  arguments: { filename: "x", format: "png" as const },
  id: 2,
};
const mouse = { execute: "input-send-event" as const, arguments: { events: [] }, id: 3 };
const power = { execute: "system_powerdown" as const, arguments: {}, id: 4 };

const garage: Servers.Machine = {
  url: "http://127.0.0.1:55332",
  name: "garage",
  type: "qemu",
  stats: {
    qemus: 2,
    memory: { totalBytes: 66_900_000_000, usedBytes: 31_500_000_000 },
    cpu: { mean1m: 12.3, mean2m: 11, mean3m: 9.8 },
  },
  generation: 42,
  heartbeatAt: ago(12),
  queriedAt: QUERIED_AT,
};

const runner: Servers.Machine = {
  url: "http://10.0.0.9:7000",
  name: "runner",
  type: "automation-client",
  stats: {
    qemus: 0,
    memory: { totalBytes: 16_000_000_000, usedBytes: 4_000_000_000 },
    cpu: { mean1m: 3.2, mean2m: 3, mean3m: 2.9 },
  },
  generation: 9,
  heartbeatAt: ago(4),
  queriedAt: QUERIED_AT,
};

const running: Automation.AutomationJobListRow = {
  ticket: "OLI-61",
  test: "lock-screen",
  action: "drive",
  status: "running",
  reason: null,
  clientUrl: runner.url,
  serverUrl: garage.url,
  sessionId: SESSION_ID,
  createdAt: ago(180),
  startedAt: ago(45),
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

const pending: Automation.AutomationJobListRow = {
  ...running,
  ticket: "OLI-62",
  test: "install",
  status: "pending",
  clientUrl: null,
  serverUrl: null,
  sessionId: null,
  createdAt: ago(7),
  startedAt: null,
};

const completed: Automation.AutomationJobListRow = {
  ...running,
  ticket: "OLI-60",
  status: "failed",
  reason: "session timed out",
  finishedAt: ago(600),
};

const QUEUE: Automation.AutomationQueue = {
  running: [running],
  pending: [pending],
  completed: [completed],
};

const SNAPSHOT: View.Snapshot = {
  machines: [garage, runner],
  series: [],
  queue: QUEUE,
  readAt: READ_AT,
};

const shown = (snapshot: View.Snapshot, view: Partial<View.View> = {}): View.View => ({
  ...View.initialView,
  snapshot: Option.some(snapshot),
  ...view,
});

const key = (name: string, shift = false): Terminal.UserInput => ({
  input: Option.some(name),
  key: { name, ctrl: false, meta: false, shift },
});

const MOVE = new RegExp(`${String.fromCharCode(27)}\\[(\\d+);1H`, "g");
const rowsOf = (frame: string): ReadonlyArray<string> =>
  frame
    .split(MOVE)
    .filter((_, index) => index % 2 === 0)
    .slice(1);
const plainRows = (frame: string): ReadonlyArray<string> => rowsOf(frame).map(stripAnsi);
const lastRows = (tty: FakeTerminal): ReadonlyArray<string> => plainRows(tty.frames.at(-1) ?? "");

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00,
]);

describe("peekFromActions", () => {
  it.effect("keeps the last three commands, oldest first, and names them from the QMP execute", () =>
    Effect.sync(() => {
      const peek = Follow.peekFromActions(
        "OLI-61",
        SESSION_ID,
        garage.url,
        [
          { request: sendKey, createdAt: ago(40) },
          { request: mouse, createdAt: ago(20) },
          { request: screendump, createdAt: ago(8) },
          { request: power, createdAt: ago(2) },
        ],
        Option.none(),
      );
      expect(peek._tag).toBe("peek");
      expect(peek.ticket).toBe("OLI-61");
      expect(peek.sessionId).toBe(SESSION_ID);
      expect(peek.serverUrl).toEqual(Option.some(garage.url));
      expect(peek.commands).toEqual([
        { name: "input-send-event", at: ago(20) },
        { name: "screendump", at: ago(8) },
        { name: "system_powerdown", at: ago(2) },
      ]);
    }),
  );

  it.effect("shows fewer than three when that is all there is, and ? when the request has no execute", () =>
    Effect.sync(() => {
      const peek = Follow.peekFromActions(
        "OLI-61",
        SESSION_ID,
        null,
        [{ request: { nope: true }, createdAt: ago(1) }],
        Option.none(),
      );
      expect(peek.serverUrl).toEqual(Option.none());
      expect(peek.commands).toEqual([{ name: "?", at: ago(1) }]);
    }),
  );
});

describe("drawPeek", () => {
  const peek = Follow.peekFromActions(
    "OLI-61",
    SESSION_ID,
    garage.url,
    [
      { request: sendKey, createdAt: ago(20) },
      { request: mouse, createdAt: ago(8) },
      { request: screendump, createdAt: ago(2) },
    ],
    Option.some(TINY_PNG),
  );

  it.effect("is five rows: a title, three command rows, and the keys, each the terminal's width", () =>
    Effect.sync(() => {
      const { lines } = Follow.drawPeek(peek, NOW, COLUMNS);
      expect(lines).toHaveLength(Follow.PEEK_FRAME_ROWS);
      expect(Follow.PEEK_IMAGE_ROWS).toBe(3);
      const plain = lines.map(stripAnsi);
      for (const row of plain) {
        expect(row).toHaveLength(COLUMNS);
      }
      expect(plain[0]).toContain("follow OLI-61 · 7a2d0000");
      expect(plain[1]).toContain("send-key");
      expect(plain[1]).toContain("20 s ago");
      expect(plain[2]).toContain("input-send-event");
      expect(plain[2]).toContain("8 s ago");
      expect(plain[3]).toContain("screendump");
      expect(plain[3]).toContain("2 s ago");
      expect(plain[4]).toContain("F full screen");
      expect(plain[4]).toContain("esc close");
    }),
  );

  it.effect("says so when there are no commands yet, and still keeps three image rows", () =>
    Effect.sync(() => {
      const empty = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
      const plain = Follow.drawPeek(empty, NOW, COLUMNS).lines.map(stripAnsi);
      expect(plain).toHaveLength(5);
      expect(plain[1]).toContain("no commands yet");
      expect(plain[2]).not.toContain("send-key");
      expect(plain[3]).not.toContain("send-key");
    }),
  );

  it.effect("places the last image in three rows to the right of the commands, or not at all", () =>
    Effect.sync(() => {
      expect(Follow.peekImageBox(COLUMNS, 33)).toEqual(
        Option.some({
          col: Follow.LEFT_COLS + 3,
          row: 33,
          cols: COLUMNS - (Follow.LEFT_COLS + 3),
          rows: 3,
        }),
      );
      expect(Follow.peekImageBox(Follow.LEFT_COLS + 2, 33)).toEqual(Option.none());
      const placed = Follow.drawPeekImage(peek, COLUMNS, 33);
      expect(placed).toBe(
        Image.placeImage(TINY_PNG, {
          col: Follow.LEFT_COLS + 3,
          row: 33,
          cols: COLUMNS - (Follow.LEFT_COLS + 3),
          rows: 3,
        }),
      );
      expect(Follow.drawPeekImage({ ...peek, png: Option.none() }, COLUMNS, 33)).toBe("");
    }),
  );
});

describe("full follow view", () => {
  it.effect("folds live events on top of the peek's last commands", () =>
    Effect.sync(() => {
      const peek = Follow.peekFromActions(
        "OLI-61",
        SESSION_ID,
        garage.url,
        [{ request: sendKey, createdAt: ago(2) }],
        Option.none(),
      );
      const started = Follow.expand(peek, garage.url);
      expect(started.entries).toEqual([
        { id: -1, indent: 0, name: "send-key", state: "completed" },
      ]);
      const view = Follow.apply(
        Follow.apply(started, { type: "session", status: "running" }),
        { type: "action", id: 9, name: "mouse-click", state: "running" },
      );
      expect(view.status).toBe("running");
      expect(view.entries.at(-1)).toEqual({
        id: 9,
        indent: 0,
        name: "mouse-click",
        state: "running",
      });
    }),
  );

  it.effect("writes a full-screen follow with the ticket, and esc closes", () =>
    Effect.sync(() => {
      const peek = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
      const view = Follow.apply(Follow.expand(peek, garage.url), {
        type: "session",
        status: "running",
      });
      const out = Follow.drawFull(view, COLUMNS, ROWS);
      expect(out).not.toMatch(/\n/);
      expect(stripAnsi(out)).toContain("following OLI-61 · 7a2d0000");
      expect(stripAnsi(out)).toContain("running");
      expect(stripAnsi(out)).toContain("esc closes");
    }),
  );
});

describe("followError", () => {
  it.effect("refuses a missing job, a pending job, a completed job, and a running job with no session", () =>
    Effect.sync(() => {
      expect(View.followError(Option.none())).toEqual(Option.some("no job selected"));
      expect(View.followError(Option.some(pending))).toEqual(
        Option.some("follow needs a running job"),
      );
      expect(View.followError(Option.some(completed))).toEqual(
        Option.some("follow needs a running job"),
      );
      expect(View.followError(Option.some({ ...running, sessionId: null }))).toEqual(
        Option.some("the selected job has no session"),
      );
      expect(View.followError(Option.some(running))).toEqual(Option.none());
    }),
  );
});

describe("press follow keys", () => {
  it.effect("F moves nothing: opening follow is the runner's, and escape closes a peek", () =>
    Effect.sync(() => {
      const start = shown(SNAPSHOT);
      const peek = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
      const open = { ...start, follow: Option.some(peek), notice: Option.some("opened") };
      expect(View.press(open, key("f"))).toEqual({ ...start, follow: Option.some(peek) });
      expect(View.press(open, key("f", true))).toEqual({ ...start, follow: Option.some(peek) });
      expect(View.press(open, key("escape")).follow).toEqual(Option.none());
      expect(View.press(open, key("escape")).notice).toEqual(Option.none());
    }),
  );

  it.effect("a navigation key closes the peek and then moves", () =>
    Effect.sync(() => {
      const peek = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
      const open = shown(SNAPSHOT, { follow: Option.some(peek) });
      const moved = View.press(open, key("j"));
      expect(moved.follow).toEqual(Option.none());
      expect(moved.cursor.servers).toBe(1);
    }),
  );
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
      listSeries: scripted.series ?? (() => Effect.succeed([])),
    }).layer,
    Stores.fakeAutomationStore({ listJobs: scripted.jobs ?? (() => Effect.succeed(QUEUE)) }).layer,
    actions.layer,
  );

const live = (
  tty: FakeTerminal,
  scripted: Scripted = {},
  extra: {
    readonly actions?: ReturnType<typeof Stores.fakeActionStore>;
    readonly http?: Layer.Layer<never>;
    readonly env?: Record<string, string>;
    readonly spawner?: FakeSpawner;
  } = {},
): Effect.Effect<void, PlatformError.PlatformError> =>
  View.run.pipe(
    Effect.provide(
      Layer.mergeAll(
        storesLayer(scripted, extra.actions ?? Stores.fakeActionStore()),
        tty.layer,
        (extra.spawner ?? fakeSpawner()).layer,
        extra.http ?? FakeHttp.respondWith(() => new Response(null, { status: 404 })),
        Config.withEnv({
          DATABASE_URL: "postgres://user:pw@127.0.0.1:5432/oligarchy",
          OLIGARCHY_TOKEN: "test-token",
          ...extra.env,
        }),
      ),
    ),
  );

const seedActions = (store: ReturnType<typeof Stores.fakeActionStore>) => {
  store.actions.push(
    {
      id: 1,
      sessionId: SESSION_ID,
      agentId: "OLI-61",
      request: sendKey,
      state: "completed",
      response: {},
      createdAt: ago(20),
      finishedAt: ago(19),
    },
    {
      id: 2,
      sessionId: SESSION_ID,
      agentId: "OLI-61",
      request: mouse,
      state: "completed",
      response: {},
      createdAt: ago(8),
      finishedAt: ago(8),
    },
    {
      id: 3,
      sessionId: SESSION_ID,
      agentId: "OLI-61",
      request: screendump,
      state: "completed",
      response: {},
      createdAt: ago(2),
      finishedAt: ago(2),
    },
  );
  store.images.push({ id: IMAGE_ID, actionId: 3, data: TINY_PNG });
};

describe("run follow happy path", () => {
  it.effect(
    "F on a running job on a card, or in the queue, opens a peek of the last three commands and their ages",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal();
        const actions = Stores.fakeActionStore();
        seedActions(actions);
        const fiber = yield* Effect.forkChild(live(tty, {}, { actions }), {
          startImmediately: true,
        });
        yield* settle;
        // The card header is selected; F needs a job.
        yield* tty.press("f");
        yield* settle;
        expect(lastRows(tty)[ROWS - 1]).toContain("no job selected");
        yield* tty.press("j");
        yield* tty.press("f");
        yield* settle;
        const onCard = lastRows(tty);
        expect(onCard.some((row) => row.includes("follow OLI-61 · 7a2d0000"))).toBe(true);
        expect(onCard.some((row) => row.includes("send-key"))).toBe(true);
        expect(onCard.some((row) => row.includes("input-send-event"))).toBe(true);
        expect(onCard.some((row) => row.includes("screendump"))).toBe(true);
        expect(onCard.some((row) => row.includes("ago"))).toBe(true);
        expect(onCard.some((row) => row.includes("F full screen"))).toBe(true);
        yield* tty.key("escape");
        yield* settle;
        expect(lastRows(tty).some((row) => row.includes("follow OLI-61"))).toBe(false);
        // The queue's running job opens the same peek.
        yield* tty.key("tab");
        yield* tty.press("f");
        yield* settle;
        expect(lastRows(tty).some((row) => row.includes("follow OLI-61 · 7a2d0000"))).toBe(true);
        yield* tty.press("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect("F again on a peek opens a full-screen follow of the qemu server", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
      const actions = Stores.fakeActionStore();
      seedActions(actions);
      const events = [
        Domain.encodeFollowLine({ type: "session", status: "running" }),
        Domain.encodeFollowLine({
          type: "action",
          id: 9,
          name: "mouse-click",
          state: "running",
        }),
      ].join("");
      const http = FakeHttp.respondWith((request, url) => {
        if (url.pathname === "/follow") {
          return new Response(events, { status: 200 });
        }
        return new Response(null, { status: 404 });
      });
      const fiber = yield* Effect.forkChild(live(tty, {}, { actions, http }), {
        startImmediately: true,
      });
      yield* settle;
      yield* tty.press("j");
      yield* tty.press("f");
      yield* settle;
      yield* tty.press("f");
      yield* settle;
      const full = stripAnsi(tty.frames.at(-1) ?? "");
      expect(full).toContain("following OLI-61 · 7a2d0000");
      expect(full).toContain("running");
      expect(full).toContain("mouse-click");
      expect(full).toContain("esc closes");
      yield* tty.key("escape");
      yield* settle;
      const back = lastRows(tty).join("\n");
      expect(back).not.toContain("following OLI-61");
      expect(back).toContain("garage");
      yield* tty.press("q");
      yield* Fiber.join(fiber);
    }),
  );
});

describe("run follow unhappy path", () => {
  it.effect("F on a pending job, or a completed one, errors and opens nothing", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
      const fiber = yield* Effect.forkChild(live(tty), { startImmediately: true });
      yield* settle;
      yield* tty.key("tab");
      yield* tty.press("j");
      yield* tty.press("f");
      yield* settle;
      expect(lastRows(tty)[ROWS - 1]).toContain("follow needs a running job");
      expect(lastRows(tty).some((row) => row.includes("follow OLI-62"))).toBe(false);
      yield* tty.press("q");
      yield* Fiber.join(fiber);

      const done = yield* fakeTerminal();
      const byDone = yield* Effect.forkChild(
        live(done, {
          jobs: () =>
            Effect.succeed({ running: [], pending: [], completed: [completed] }),
        }),
        { startImmediately: true },
      );
      yield* settle;
      yield* done.key("tab");
      yield* done.press("f");
      yield* settle;
      // Completed jobs are not listed; there is nothing to follow.
      expect(lastRows(done)[ROWS - 1]).toContain("no job selected");
      yield* done.press("q");
      yield* Fiber.join(byDone);
    }),
  );

  it.effect("F on a running job without a session, or without a server on the second F, errors", () =>
    Effect.gen(function* () {
      const noSession = yield* fakeTerminal();
      const byNoSession = yield* Effect.forkChild(
        live(noSession, {
          jobs: () =>
            Effect.succeed({
              running: [{ ...running, sessionId: null }],
              pending: [],
              completed: [],
            }),
        }),
        { startImmediately: true },
      );
      yield* settle;
      yield* noSession.press("j");
      yield* noSession.press("f");
      yield* settle;
      expect(lastRows(noSession)[ROWS - 1]).toContain("the selected job has no session");
      yield* noSession.press("q");
      yield* Fiber.join(byNoSession);

      const noServer = yield* fakeTerminal();
      const actions = Stores.fakeActionStore();
      seedActions(actions);
      const byNoServer = yield* Effect.forkChild(
        live(
          noServer,
          {
            jobs: () =>
              Effect.succeed({
                running: [{ ...running, serverUrl: null }],
                pending: [],
                completed: [],
              }),
          },
          { actions },
        ),
        { startImmediately: true },
      );
      yield* settle;
      yield* noServer.key("tab");
      yield* noServer.press("f");
      yield* settle;
      expect(lastRows(noServer).some((row) => row.includes("follow OLI-61"))).toBe(true);
      yield* noServer.press("f");
      yield* settle;
      expect(lastRows(noServer)[ROWS - 1]).toContain("follow needs a qemu server");
      yield* noServer.press("q");
      yield* Fiber.join(byNoServer);
    }),
  );

  it.effect("a refused follow stream leaves the peek and puts the reason on the footer", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
      const actions = Stores.fakeActionStore();
      seedActions(actions);
      const http = FakeHttp.respondWith(
        () => new Response(JSON.stringify({ error: 'session "x" has already completed (succeeded)' }), { status: 409 }),
      );
      const fiber = yield* Effect.forkChild(live(tty, {}, { actions, http }), {
        startImmediately: true,
      });
      yield* settle;
      yield* tty.press("j");
      yield* tty.press("f");
      yield* settle;
      yield* tty.press("f");
      yield* settle;
      const rows = lastRows(tty);
      expect(rows.some((row) => row.includes("follow OLI-61"))).toBe(true);
      expect(rows[ROWS - 1]).toContain("already completed");
      yield* tty.press("q");
      yield* Fiber.join(fiber);
    }),
  );
});
