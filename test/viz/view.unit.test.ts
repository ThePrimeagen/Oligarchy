import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, PlatformError, Queue } from "effect";
import { TestClock } from "effect/testing";
import type * as Automation from "../../src/db/automation.ts";
import type * as ProcessStats from "../../src/db/process-stats.ts";
import type * as Servers from "../../src/db/servers.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as View from "../../src/viz/view.ts";
import { fakeTerminal } from "../support/fake-terminal.ts";
import { stripAnsi } from "../support/fake-tty.ts";
import * as Stores from "../support/stores.ts";

const QUERIED_AT = new Date("2026-09-09T16:00:00Z");
// The local clock at the read; the TestClock starts at 0, so the runner tests read at 0.
const READ_AT = 1_000_000;
const COLUMNS = 135;
const ROWS = 37;

const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

const alive: Servers.FleetServer = {
  url: "http://127.0.0.1:55332",
  name: "garage",
  stats: {
    qemus: 2,
    memory: { totalBytes: 66_900_000_000, usedBytes: 31_500_000_000 },
    cpu: { mean1m: 12.3, mean2m: 11, mean3m: 9.8 },
  },
  generation: 42,
  heartbeatAt: ago(12),
  queriedAt: QUERIED_AT,
};

const silent: Servers.FleetServer = {
  url: "https://qemu-b.example.com",
  name: "attic",
  stats: {
    qemus: 3,
    memory: { totalBytes: 16_000_000_000, usedBytes: 4_000_000_000 },
    cpu: { mean1m: 50, mean2m: 40, mean3m: 30 },
  },
  generation: 7,
  heartbeatAt: ago(5 * 60 + 12),
  queriedAt: QUERIED_AT,
};

const neverHeardFrom: Servers.FleetServer = {
  url: "https://qemu-c.example.com",
  name: null,
  stats: null,
  generation: 0,
  heartbeatAt: null,
  queriedAt: QUERIED_AT,
};

const running: Automation.AutomationJobListRow = {
  ticket: "OLI-61",
  test: "lock-screen",
  action: "diagnose",
  status: "running",
  reason: null,
  createdAt: ago(180),
  startedAt: ago(45),
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

const pending: Automation.AutomationJobListRow = {
  ticket: "OLI-62",
  test: "install",
  action: "drive",
  status: "pending",
  reason: null,
  createdAt: ago(7),
  startedAt: null,
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

const failed: Automation.AutomationJobListRow = {
  ticket: "OLI-60",
  test: "wifi",
  action: "drive",
  status: "failed",
  reason: "session timed out",
  createdAt: ago(3_900),
  startedAt: ago(3_800),
  finishedAt: ago(600),
  queriedAt: QUERIED_AT,
};

const QUEUE: Automation.AutomationQueue = {
  running: [running],
  pending: [pending],
  completed: [failed],
};
const EMPTY_QUEUE: Automation.AutomationQueue = { running: [], pending: [], completed: [] };

const processAlive: ProcessStats.ProcessReading = {
  name: "garage",
  type: "qemu",
  jobs: 2,
  memoryBytes: 512_000_000,
  cpuPercent: 37.5,
  reportedAt: ago(12),
  queriedAt: QUERIED_AT,
};

const processSilent: ProcessStats.ProcessReading = {
  name: "attic",
  type: "automation-client",
  jobs: 1,
  memoryBytes: 256_000_000,
  cpuPercent: 8,
  reportedAt: ago(5 * 60 + 12),
  queriedAt: QUERIED_AT,
};

const SNAPSHOT: View.Snapshot = {
  readings: [processAlive],
  fleet: [alive, neverHeardFrom],
  queue: QUEUE,
  readAt: READ_AT,
};

const shown = (snapshot: View.Snapshot): View.View => ({
  snapshot: Option.some(snapshot),
  failure: Option.none(),
});

const GRAY = "\x1b[90m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const pad = (text: string, width: number): string => text.padEnd(width);
const num = (text: string, width: number): string => text.padStart(width);
const cells = (...parts: ReadonlyArray<string>): string => parts.join("  ");
const blank = " ".repeat(COLUMNS);

const PROCESS_HEADER = cells(
  pad("name", 14),
  pad("type", 17),
  num("jobs", 4),
  pad("cpu", 7),
  pad("memory", 11),
  pad("reported", 72),
);
const FLEET_HEADER = cells(
  pad("name", 14),
  pad("url", 46),
  num("qemus", 5),
  pad("memory", 17),
  pad("cpu 1m / 2m / 3m", 24),
  num("gen", 6),
  pad("heartbeat", 11),
);
const JOB_HEADER = cells(
  pad("ticket", 9),
  pad("test", 18),
  pad("action", 9),
  pad("status", 10),
  pad("queued", 11),
  pad("started", 11),
  pad("finished", 11),
  pad("reason", 42),
);
const FOOTER = pad("q quits · refreshes every 5 s", COLUMNS);

// The frame as rows: the text after each absolute move, in row order.
const MOVE = new RegExp(`${String.fromCharCode(27)}\\[(\\d+);1H`, "g");
const rowsOf = (frame: string): ReadonlyArray<string> =>
  frame
    .split(MOVE)
    .filter((_, index) => index % 2 === 0)
    .slice(1);
const plainRows = (frame: string): ReadonlyArray<string> => rowsOf(frame).map(stripAnsi);
const moves = (frame: string): ReadonlyArray<number> =>
  [...frame.matchAll(MOVE)].map((match) => Number(match[1]));

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

describe("draw happy path", () => {
  it.effect(
    "writes every row of the screen in full at the terminal's width with absolute moves and never a newline",
    () =>
      Effect.sync(() => {
        const frame = View.draw(shown(SNAPSHOT), READ_AT, COLUMNS, ROWS);
        expect(frame).not.toMatch(/\n/);
        expect(frame.startsWith("\x1b[1;1H")).toBe(true);
        expect(moves(frame)).toEqual(Array.from({ length: ROWS }, (_, index) => index + 1));
        const rows = plainRows(frame);
        expect(rows).toHaveLength(ROWS);
        for (const row of rows) {
          expect(row).toHaveLength(COLUMNS);
        }
      }),
  );

  it.effect(
    "stacks the title, the process table, the qemu fleet and the automation queue, and ends with the key hint",
    () =>
      Effect.sync(() => {
        const frame = View.draw(shown(SNAPSHOT), READ_AT, COLUMNS, ROWS);
        const rows = plainRows(frame);
        expect(rows[0]).toBe(`oligarchy servers${" ".repeat(106)}read 0 s ago`);
        expect(rows[1]).toBe(pad("process · 1", COLUMNS));
        expect(rows[2]).toBe(PROCESS_HEADER);
        expect(rows[3]).toBe(
          cells(
            pad("garage", 14),
            pad("qemu", 17),
            num("2", 4),
            pad("37.5%", 7),
            pad("512.0 MB", 11),
            pad("12 s ago", 72),
          ),
        );
        expect(rows[4]).toBe(blank);
        expect(rows[5]).toBe(pad("qemu servers · 2", COLUMNS));
        expect(rows[6]).toBe(FLEET_HEADER);
        expect(rows[7]).toBe(
          cells(
            pad("garage", 14),
            pad("http://127.0.0.1:55332", 46),
            num("2", 5),
            pad("31.5 / 66.9 GB", 17),
            pad("12.3% / 11.0% / 9.8%", 24),
            num("42", 6),
            pad("12 s ago", 11),
          ),
        );
        expect(rows[8]).toBe(
          cells(
            pad("—", 14),
            pad("https://qemu-c.example.com", 46),
            pad("never heard from", 50),
            num("0", 6),
            pad("never", 11),
          ),
        );
        expect(rows[9]).toBe(blank);
        expect(rows[10]).toBe(pad("automation · running 1 · pending 1", COLUMNS));
        expect(rows[11]).toBe(JOB_HEADER);
        expect(rows[12]).toBe(
          cells(
            pad("OLI-61", 9),
            pad("lock-screen", 18),
            pad("diagnose", 9),
            pad("running", 10),
            pad("3 min ago", 11),
            pad("45 s ago", 11),
            pad("—", 11),
            pad("", 42),
          ),
        );
        expect(rows[13]).toBe(
          cells(
            pad("OLI-62", 9),
            pad("install", 18),
            pad("drive", 9),
            pad("pending", 10),
            pad("7 s ago", 11),
            pad("—", 11),
            pad("—", 11),
            pad("", 42),
          ),
        );
        expect(rows[14]).toBe(
          cells(
            pad("OLI-60", 9),
            pad("wifi", 18),
            pad("drive", 9),
            pad("failed", 10),
            pad("1 h ago", 11),
            pad("1 h ago", 11),
            pad("10 min ago", 11),
            pad("session timed out", 42),
          ),
        );
        for (const row of rows.slice(15, ROWS - 1)) {
          expect(row).toBe(blank);
        }
        expect(rows[ROWS - 1]).toBe(FOOTER);
      }),
  );

  it.effect("colours the title bold, the headers and hints gray, and each job by its status", () =>
    Effect.sync(() => {
      const frame = View.draw(shown(SNAPSHOT), READ_AT, COLUMNS, ROWS);
      const rows = rowsOf(frame);
      expect(rows[0]?.startsWith(`${BOLD}oligarchy servers${RESET}`)).toBe(true);
      expect(rows[0]?.endsWith(`${GRAY}read 0 s ago${RESET}`)).toBe(true);
      expect(rows[1]?.startsWith(`${BOLD}process${RESET}${GRAY} · 1`)).toBe(true);
      expect(rows[2]).toBe(`${GRAY}${PROCESS_HEADER}${RESET}`);
      expect(rows[6]).toBe(`${GRAY}${FLEET_HEADER}${RESET}`);
      expect(rows[8]).toContain(`${GRAY}${pad("never heard from", 50)}${RESET}`);
      expect(rows[11]).toBe(`${GRAY}${JOB_HEADER}${RESET}`);
      expect(rows[12]).toContain(`\x1b[33m${pad("running", 10)}${RESET}`);
      expect(rows[13]).toContain(`${GRAY}${pad("pending", 10)}${RESET}`);
      expect(rows[14]).toContain(`${RED}${pad("failed", 10)}${RESET}`);
      expect(rows[ROWS - 1]).toBe(`${GRAY}${FOOTER}${RESET}`);
      const statuses = View.draw(
        shown({
          ...SNAPSHOT,
          queue: {
            ...EMPTY_QUEUE,
            completed: [
              { ...failed, status: "succeeded" },
              { ...failed, status: "aborted" },
              { ...failed, status: "timed_out" },
            ],
          },
        }),
        READ_AT,
        COLUMNS,
        ROWS,
      );
      expect(statuses).toContain(`\x1b[32m${pad("succeeded", 10)}${RESET}`);
      expect(statuses).toContain(`\x1b[91m${pad("aborted", 10)}${RESET}`);
      expect(statuses).toContain(`\x1b[35m${pad("timed_out", 10)}${RESET}`);
    }),
  );

  it.effect(
    "gives every row past the tables to the job list, and the url column the extra width",
    () =>
      Effect.sync(() => {
        const jobs = Array.from({ length: 40 }, (_, index) => ({
          ...pending,
          ticket: `OLI-${String(100 + index)}`,
        }));
        const snapshot = { ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: jobs } };
        // 37 rows: 12 are the title, two tables, their gaps and the queue's head; one is the footer.
        const short = plainRows(View.draw(shown(snapshot), READ_AT, COLUMNS, ROWS));
        expect(short.filter((row) => row.startsWith("OLI-"))).toHaveLength(23);
        expect(short[35]).toBe(pad("… 17 more", COLUMNS));
        expect(short[36]).toBe(FOOTER);
        const tall = plainRows(View.draw(shown(snapshot), READ_AT, COLUMNS, 50));
        expect(tall).toHaveLength(50);
        expect(tall.filter((row) => row.startsWith("OLI-"))).toHaveLength(36);
        expect(tall[48]).toBe(pad("… 4 more", COLUMNS));
        expect(tall[49]).toBe(FOOTER);
        const wide = plainRows(View.draw(shown(SNAPSHOT), READ_AT, 160, ROWS));
        for (const row of wide) {
          expect(row).toHaveLength(160);
        }
        expect(wide[7]).toContain(`${pad("http://127.0.0.1:55332", 71)}  ${num("2", 5)}`);
      }),
  );

  it.effect("lists the jobs in the order given, running then pending then completed", () =>
    Effect.sync(() => {
      const other = { ...pending, ticket: "OLI-70" };
      const rows = plainRows(
        View.draw(
          shown({
            ...SNAPSHOT,
            queue: { running: [running], pending: [other, pending], completed: [failed] },
          }),
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      expect(rows.slice(12, 16).map((row) => row.slice(0, 6))).toEqual([
        "OLI-61",
        "OLI-70",
        "OLI-62",
        "OLI-60",
      ]);
    }),
  );
});

describe("draw ages", () => {
  it.effect(
    "reads a stamp's age in the unit an operator would: seconds, minutes, hours, days",
    () =>
      Effect.sync(() => {
        const at = (secondsAgo: number): Servers.FleetServer => ({
          ...alive,
          url: `http://s${String(secondsAgo)}`,
          heartbeatAt: ago(secondsAgo),
        });
        const rows = plainRows(
          View.draw(
            shown({
              ...SNAPSHOT,
              fleet: [at(0), at(59), at(60), at(3_599), at(3_600), at(90_000)],
            }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(rows.slice(7, 13).map((row) => row.slice(-11).trimEnd())).toEqual([
          "0 s ago",
          "59 s ago",
          "1 min ago",
          "59 min ago",
          "1 h ago",
          "1 d ago",
        ]);
      }),
  );

  it.effect("adds the time since the read to every age, and says how old the read itself is", () =>
    Effect.sync(() => {
      const rows = plainRows(View.draw(shown(SNAPSHOT), READ_AT + 3_000, COLUMNS, ROWS));
      expect(rows[0]).toBe(`oligarchy servers${" ".repeat(106)}read 3 s ago`);
      expect(rows[3]).toContain(pad("15 s ago", 72));
      expect(rows[7]).toContain(`${num("42", 6)}  ${pad("15 s ago", 11)}`);
      expect(rows[12]).toContain(`${pad("3 min ago", 11)}  ${pad("48 s ago", 11)}`);
      const later = plainRows(View.draw(shown(SNAPSHOT), READ_AT + 125_000, COLUMNS, ROWS));
      expect(later[0]).toBe(`oligarchy servers${" ".repeat(104)}read 2 min ago`);
    }),
  );

  it.effect("never reads a stamp the database wrote just ahead of its clock as negative", () =>
    Effect.sync(() => {
      const ahead: Servers.FleetServer = { ...alive, heartbeatAt: ago(-2) };
      const rows = plainRows(
        View.draw(shown({ ...SNAPSHOT, fleet: [ahead] }), READ_AT, COLUMNS, ROWS),
      );
      expect(rows[7]).toContain(pad("0 s ago", 11));
    }),
  );
});

describe("draw unhappy path", () => {
  it.effect("marks a server silent, its stats withheld, once three heartbeats are overdue", () =>
    Effect.sync(() => {
      const frame = View.draw(shown({ ...SNAPSHOT, fleet: [silent] }), READ_AT, COLUMNS, ROWS);
      expect(plainRows(frame)[7]).toBe(
        cells(
          pad("attic", 14),
          pad("https://qemu-b.example.com", 46),
          pad("silent", 50),
          num("7", 6),
          pad("5 min ago", 11),
        ),
      );
      expect(rowsOf(frame)[7]).toContain(`${RED}${pad("silent", 50)}${RESET}`);
      expect(frame).not.toContain("50.0%");
    }),
  );

  it.effect(
    "is not silent at ninety seconds and is at ninety-one, the read's own age included",
    () =>
      Effect.sync(() => {
        const at = (secondsAgo: number) => ({
          ...SNAPSHOT,
          fleet: [{ ...alive, heartbeatAt: ago(secondsAgo) }],
        });
        expect(plainRows(View.draw(shown(at(90)), READ_AT, COLUMNS, ROWS))[7]).toContain(
          "31.5 / 66.9 GB",
        );
        expect(plainRows(View.draw(shown(at(91)), READ_AT, COLUMNS, ROWS))[7]).toContain(
          pad("silent", 50),
        );
        expect(plainRows(View.draw(shown(at(88)), READ_AT + 3_000, COLUMNS, ROWS))[7]).toContain(
          pad("silent", 50),
        );
      }),
  );

  it.effect("collapses a silent process's numbers into one word", () =>
    Effect.sync(() => {
      const frame = View.draw(
        shown({ ...SNAPSHOT, readings: [processSilent] }),
        READ_AT,
        COLUMNS,
        ROWS,
      );
      expect(plainRows(frame)[3]).toBe(
        cells(
          pad("attic", 14),
          pad("automation-client", 17),
          pad("silent", 26),
          pad("5 min ago", 72),
        ),
      );
      expect(rowsOf(frame)[3]).toContain(`${RED}${pad("silent", 26)}${RESET}`);
      expect(frame).not.toContain("8.0%");
      expect(frame).not.toContain("256.0 MB");
    }),
  );

  it.effect("shows a dash for a job whose result has no ticket yet", () =>
    Effect.sync(() => {
      const rows = plainRows(
        View.draw(
          shown({
            ...SNAPSHOT,
            queue: { ...EMPTY_QUEUE, pending: [{ ...pending, ticket: null }] },
          }),
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      expect(rows[12]?.startsWith(cells(pad("—", 9), pad("install", 18)))).toBe(true);
    }),
  );

  it.effect("truncates a name, a url and a reason to their columns with an ellipsis", () =>
    Effect.sync(() => {
      const long = "a".repeat(80);
      const rows = plainRows(
        View.draw(
          shown({
            ...SNAPSHOT,
            readings: [{ ...processAlive, name: long }],
            fleet: [{ ...alive, name: long, url: `http://${long}.example.com` }],
            queue: { ...EMPTY_QUEUE, completed: [{ ...failed, reason: long }] },
          }),
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      expect(rows[3]?.startsWith(`${"a".repeat(13)}…  qemu`)).toBe(true);
      expect(rows[7]?.startsWith(`${"a".repeat(13)}…  http://${"a".repeat(38)}…  `)).toBe(true);
      expect(rows[11]?.endsWith(`${"a".repeat(41)}…`)).toBe(true);
      for (const row of rows) {
        expect(row).toHaveLength(COLUMNS);
      }
    }),
  );

  it.effect(
    "draws a reason that spans lines or carries an escape, and a failure that does, as one row each",
    () =>
      Effect.sync(() => {
        const frame = View.draw(
          {
            snapshot: Option.some({
              ...SNAPSHOT,
              queue: {
                ...EMPTY_QUEUE,
                completed: [{ ...failed, reason: "line one\nline two\x1b[31m\ttabbed\u007f" }],
              },
            }),
            failure: Option.some("Failed query: select 1\nparams: []"),
          },
          READ_AT,
          COLUMNS,
          ROWS,
        );
        expect(frame).not.toMatch(/\n/);
        expect(frame).not.toContain("\t");
        expect(frame).not.toContain("\x1b[31m\ttabbed");
        const rows = plainRows(frame);
        for (const row of rows) {
          expect(row).toHaveLength(COLUMNS);
        }
        expect(rows[12]).toContain("line one line two [31m tabbed ");
        expect(rows[ROWS - 1]).toBe(pad("error: Failed query: select 1 params: []", COLUMNS));
      }),
  );

  it.effect("caps the process and fleet tables and counts what it left out", () =>
    Effect.sync(() => {
      const fleet = Array.from({ length: 8 }, (_, index) => ({
        ...alive,
        url: `http://10.0.0.${String(index)}`,
        name: `s${String(index)}`,
      }));
      const readings = Array.from({ length: 7 }, (_, index) => ({
        ...processAlive,
        name: `p${String(index)}`,
      }));
      const rows = plainRows(
        View.draw(shown({ ...SNAPSHOT, fleet, readings }), READ_AT, COLUMNS, ROWS),
      );
      expect(rows[1]).toBe(pad("process · 7", COLUMNS));
      expect(rows.slice(3, 8).map((row) => row.slice(0, 2))).toEqual([
        "p0",
        "p1",
        "p2",
        "p3",
        "p4",
      ]);
      expect(rows[8]).toBe(pad("… 2 more", COLUMNS));
      expect(rows[10]).toBe(pad("qemu servers · 8", COLUMNS));
      expect(rows.slice(12, 17).map((row) => row.slice(0, 2))).toEqual([
        "s0",
        "s1",
        "s2",
        "s3",
        "s4",
      ]);
      expect(rows[17]).toBe(pad("… 3 more", COLUMNS));
      expect(rows[19]).toBe(pad("automation · running 1 · pending 1", COLUMNS));
      const exact = plainRows(
        View.draw(shown({ ...SNAPSHOT, fleet: fleet.slice(0, 6) }), READ_AT, COLUMNS, ROWS),
      );
      expect(exact.slice(7, 13).map((row) => row.slice(0, 2))).toEqual([
        "s0",
        "s1",
        "s2",
        "s3",
        "s4",
        "s5",
      ]);
      expect(exact[13]).toBe(blank);
    }),
  );

  it.effect("says so under a heading with nothing to list, and counts zero", () =>
    Effect.sync(() => {
      const frame = View.draw(
        shown({ ...SNAPSHOT, readings: [], fleet: [], queue: EMPTY_QUEUE }),
        READ_AT,
        COLUMNS,
        ROWS,
      );
      const rows = plainRows(frame);
      expect(rows[1]).toBe(pad("process · 0", COLUMNS));
      expect(rows[3]).toBe(pad("no process stats", COLUMNS));
      expect(rows[5]).toBe(pad("qemu servers · 0", COLUMNS));
      expect(rows[7]).toBe(pad("no servers registered", COLUMNS));
      expect(rows[9]).toBe(pad("automation · running 0 · pending 0", COLUMNS));
      expect(rows[11]).toBe(pad("none", COLUMNS));
      expect(rowsOf(frame)[3]).toBe(`${GRAY}${pad("no process stats", COLUMNS)}${RESET}`);
    }),
  );

  it.effect("draws only the title and the hint before the first read has landed", () =>
    Effect.sync(() => {
      const frame = View.draw(View.initialView, READ_AT, COLUMNS, ROWS);
      const rows = plainRows(frame);
      expect(rows[0]).toBe(`oligarchy servers${" ".repeat(110)}reading…`);
      for (const row of rows.slice(1, ROWS - 1)) {
        expect(row).toBe(blank);
      }
      expect(rows[ROWS - 1]).toBe(FOOTER);
    }),
  );

  it.effect("puts a failed read's reason on the footer and keeps the last snapshot on screen", () =>
    Effect.sync(() => {
      const reason = "Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432";
      const frame = View.draw(
        { snapshot: Option.some(SNAPSHOT), failure: Option.some(reason) },
        READ_AT + 7_000,
        COLUMNS,
        ROWS,
      );
      const rows = plainRows(frame);
      expect(rows[0]).toBe(`oligarchy servers${" ".repeat(106)}read 7 s ago`);
      expect(rows[7]).toContain("http://127.0.0.1:55332");
      expect(rows[ROWS - 1]).toBe(pad(`error: ${reason}`, COLUMNS));
      expect(rowsOf(frame)[ROWS - 1]).toBe(`${RED}${pad(`error: ${reason}`, COLUMNS)}${RESET}`);
      expect(frame).not.toContain("q quits");
      const bare = plainRows(
        View.draw(
          { snapshot: Option.none(), failure: Option.some(reason) },
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      expect(bare[0]).toBe(`oligarchy servers${" ".repeat(110)}reading…`);
      expect(bare[1]).toBe(blank);
      expect(bare[ROWS - 1]).toBe(pad(`error: ${reason}`, COLUMNS));
    }),
  );

  it.effect("clears the screen and names the size it needs when the terminal is too small", () =>
    Effect.sync(() => {
      expect(View.tooSmall(100, 24)).toBe(
        "viz needs a terminal of at least 135×37 (columns×rows); this one is 100×24",
      );
      const narrow = View.draw(shown(SNAPSHOT), READ_AT, 134, 37);
      expect(narrow).toBe(`\x1b[2J\x1b[1;1H${RED}${View.tooSmall(134, 37)}${RESET}`);
      const short = View.draw(shown(SNAPSHOT), READ_AT, 135, 36);
      expect(short).toBe(`\x1b[2J\x1b[1;1H${RED}${View.tooSmall(135, 36)}${RESET}`);
      expect(View.draw(shown(SNAPSHOT), READ_AT, 135, 37)).not.toContain("viz needs");
    }),
  );
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Scripted = {
  readonly fleet?: () => Effect.Effect<ReadonlyArray<Servers.FleetServer>, Errors.DatabaseError>;
  readonly readings?: () => Effect.Effect<
    ReadonlyArray<ProcessStats.ProcessReading>,
    Errors.DatabaseError
  >;
  readonly jobs?: () => Effect.Effect<Automation.AutomationQueue, Errors.DatabaseError>;
};

const storesLayer = (scripted: Scripted = {}) =>
  Layer.mergeAll(
    Stores.fakeServerStore({ listFleet: scripted.fleet ?? (() => Effect.succeed([alive])) }).layer,
    Stores.fakeProcessStatsStore({
      listNewest: scripted.readings ?? (() => Effect.succeed([processAlive])),
    }).layer,
    Stores.fakeAutomationStore({ listJobs: scripted.jobs ?? (() => Effect.succeed(QUEUE)) }).layer,
  );

const refused = Errors.DatabaseError.make({
  operation: "listFleet",
  message: "Failed query: select 1",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

describe("run happy path", () => {
  it.effect(
    "takes the alternate screen, reads and paints at once, repaints every second, re-reads every five, and q gives the screen back",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal({ columns: 135, rows: 37 });
        const reads = { count: 0 };
        const fleet = () =>
          Effect.sync(() => {
            reads.count += 1;
            return [alive];
          });
        const fiber = yield* Effect.forkChild(
          View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer({ fleet }), tty.layer))),
          { startImmediately: true },
        );
        yield* settle;
        expect(tty.frames[0]).toBe(View.ENTER_SCREEN);
        expect(tty.frames).toHaveLength(2);
        expect(reads.count).toBe(1);
        const first = plainRows(tty.frames[1] ?? "");
        expect(first[0]).toBe(`oligarchy servers${" ".repeat(106)}read 0 s ago`);
        expect(first[7]).toContain(pad("http://127.0.0.1:55332", 46));
        // One server in this fleet, so the queue sits one row higher than under SNAPSHOT.
        expect(first[11]?.startsWith("OLI-61")).toBe(true);

        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(tty.frames).toHaveLength(3);
        expect(reads.count).toBe(1);
        const second = plainRows(tty.frames[2] ?? "");
        expect(second[0]).toBe(`oligarchy servers${" ".repeat(106)}read 1 s ago`);
        expect(second[7]).toContain(pad("13 s ago", 11));

        yield* TestClock.adjust("4 seconds");
        yield* settle;
        expect(reads.count).toBe(2);
        expect(plainRows(tty.frames.at(-1) ?? "")[0]).toBe(
          `oligarchy servers${" ".repeat(106)}read 0 s ago`,
        );

        yield* tty.press("q");
        yield* Fiber.join(fiber);
        expect(tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
        expect(tty.written().slice(View.ENTER_SCREEN.length)).not.toMatch(/\n/);
        // Nothing runs once the screen is back.
        const settled = tty.frames.length;
        yield* TestClock.adjust("10 seconds");
        yield* settle;
        expect(tty.frames).toHaveLength(settled);
      }),
  );

  it.effect("Q quits too, and so does the input ending, as ctrl-c ends it", () =>
    Effect.gen(function* () {
      const upper = yield* fakeTerminal();
      const byUpper = yield* Effect.forkChild(
        View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer(), upper.layer))),
        { startImmediately: true },
      );
      yield* settle;
      yield* upper.press("x");
      yield* settle;
      expect(upper.frames.at(-1)).not.toBe(View.LEAVE_SCREEN);
      yield* upper.press("Q");
      yield* Fiber.join(byUpper);
      expect(upper.frames.at(-1)).toBe(View.LEAVE_SCREEN);

      const ended = yield* fakeTerminal();
      const byEnd = yield* Effect.forkChild(
        View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer(), ended.layer))),
        { startImmediately: true },
      );
      yield* settle;
      yield* Queue.end(ended.keys);
      yield* Fiber.join(byEnd);
      expect(ended.frames.at(-1)).toBe(View.LEAVE_SCREEN);
    }),
  );
});

describe("run unhappy path", () => {
  it.effect(
    "a failed read keeps the last snapshot and puts the reason on the footer; the next good read clears it",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal();
        const calls = { count: 0 };
        const fleet = () =>
          Effect.suspend(() => {
            calls.count += 1;
            return calls.count === 2 ? Effect.fail(refused) : Effect.succeed([alive]);
          });
        const fiber = yield* Effect.forkChild(
          View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer({ fleet }), tty.layer))),
          { startImmediately: true },
        );
        yield* settle;
        expect(plainRows(tty.frames[1] ?? "")[36]).toBe(FOOTER);

        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(calls.count).toBe(2);
        const failedFrame = plainRows(tty.frames.at(-1) ?? "");
        expect(failedFrame[0]).toBe(`oligarchy servers${" ".repeat(106)}read 5 s ago`);
        expect(failedFrame[7]).toContain("http://127.0.0.1:55332");
        expect(failedFrame[36]).toBe(
          pad("error: Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432", COLUMNS),
        );

        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(calls.count).toBe(3);
        const recovered = plainRows(tty.frames.at(-1) ?? "");
        expect(recovered[0]).toBe(`oligarchy servers${" ".repeat(106)}read 0 s ago`);
        expect(recovered[36]).toBe(FOOTER);

        yield* tty.press("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect("a first read that fails shows the reason under an empty screen and keeps trying", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
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
      const fiber = yield* Effect.forkChild(
        View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer({ jobs }), tty.layer))),
        { startImmediately: true },
      );
      yield* settle;
      const bare = plainRows(tty.frames[1] ?? "");
      expect(bare[0]).toBe(`oligarchy servers${" ".repeat(110)}reading…`);
      expect(bare[7]).toBe(blank);
      expect(bare[36]).toBe(pad("error: timeout", COLUMNS));

      yield* TestClock.adjust("5 seconds");
      yield* settle;
      expect(calls.count).toBe(2);
      const shownNow = plainRows(tty.frames.at(-1) ?? "");
      expect(shownNow[11]?.startsWith("OLI-61")).toBe(true);
      expect(shownNow[36]).toBe(FOOTER);

      yield* tty.press("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("a terminal shrunk below the minimum shows the size it needs until it grows back", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
      const fiber = yield* Effect.forkChild(
        View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer(), tty.layer))),
        { startImmediately: true },
      );
      yield* settle;
      tty.resize(100, 24);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(tty.frames.at(-1)).toBe(`\x1b[2J\x1b[1;1H${RED}${View.tooSmall(100, 24)}${RESET}`);
      tty.resize(140, 40);
      yield* TestClock.adjust("1 second");
      yield* settle;
      const regrown = plainRows(tty.frames.at(-1) ?? "");
      expect(regrown).toHaveLength(40);
      expect(regrown[7]).toContain("http://127.0.0.1:55332");
      yield* tty.press("q");
      yield* Fiber.join(fiber);
      expect(tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
    }),
  );

  it.effect(
    "a stdout that refuses a frame ends the run with that failure, the screen handed back",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal({
          display: (text) =>
            text === View.ENTER_SCREEN
              ? Effect.void
              : Effect.fail(
                  PlatformError.badArgument({
                    module: "Terminal",
                    method: "display",
                    description: "Failed to write prompt to stdout",
                  }),
                ),
        });
        const error = yield* Effect.flip(
          View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer(), tty.layer))),
        );
        expect(error._tag).toBe("PlatformError");
        expect(tty.frames[0]).toBe(View.ENTER_SCREEN);
        expect(tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
      }),
  );
});
