import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, PlatformError, Queue, type Terminal } from "effect";
import { TestClock } from "effect/testing";
import type * as Automation from "../../src/db/automation.ts";
import type * as ProcessStats from "../../src/db/process-stats.ts";
import type * as Servers from "../../src/db/servers.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as View from "../../src/viz/view.ts";
import { byCommand, type FakeSpawner, fakeSpawner } from "../support/fake-spawner.ts";
import { fakeTerminal, type FakeTerminal } from "../support/fake-terminal.ts";
import { stripAnsi } from "../support/fake-tty.ts";
import * as Stores from "../support/stores.ts";

const QUERIED_AT = new Date("2026-09-09T16:00:00Z");
// The local clock at the read; the TestClock starts at 0, so the runner tests read at 0.
const READ_AT = 1_000_000;
const COLUMNS = 135;
const ROWS = 37;
// What a box row holds between its border and padding, and each of the three graphs' width.
const USABLE = COLUMNS - 4;
const GRAPH = Math.floor((USABLE - 31) / 3);
// A job row's columns: the marker, six columns and their gaps; the rest of the row is blank.
const JOB_WIDTH = 82;

const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

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

const attic: Servers.Machine = {
  url: "https://qemu-b.example.com",
  name: "attic",
  type: "qemu",
  stats: {
    qemus: 3,
    memory: { totalBytes: 16_000_000_000, usedBytes: 4_000_000_000 },
    cpu: { mean1m: 50, mean2m: 40, mean3m: 30 },
  },
  generation: 7,
  heartbeatAt: ago(5 * 60 + 12),
  queriedAt: QUERIED_AT,
};

const neverHeardFrom: Servers.Machine = {
  url: "https://qemu-c.example.com",
  name: null,
  type: "qemu",
  stats: null,
  generation: 0,
  heartbeatAt: null,
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

// Six readings: two rows of braille hold four levels each, so 0, 25, 50, 75 and 100 land on
// known dots, and the newest is the value the card shows.
const garageSeries: ProcessStats.Series = {
  name: "garage",
  type: "qemu",
  samples: [
    { jobs: 0, memoryBytes: 100_000_000, cpuPercent: 0 },
    { jobs: 1, memoryBytes: 300_000_000, cpuPercent: 25 },
    { jobs: 2, memoryBytes: 512_000_000, cpuPercent: 50 },
    { jobs: 2, memoryBytes: 512_000_000, cpuPercent: 75 },
    { jobs: 2, memoryBytes: 512_000_000, cpuPercent: 100 },
    { jobs: 2, memoryBytes: 512_000_000, cpuPercent: 37.5 },
  ],
};

const runnerSeries: ProcessStats.Series = {
  name: "runner",
  type: "automation-client",
  samples: [{ jobs: 1, memoryBytes: 256_000_000, cpuPercent: 8 }],
};

const atticSeries: ProcessStats.Series = {
  name: "attic",
  type: "qemu",
  samples: [{ jobs: 3, memoryBytes: 1_000_000_000, cpuPercent: 50 }],
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

// Over, and so never drawn: the store lists none when asked for zero, and one it did list would
// not be shown either.
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

const SNAPSHOT: View.Snapshot = {
  machines: [garage, neverHeardFrom, runner],
  series: [garageSeries, runnerSeries],
  queue: QUEUE,
  readAt: READ_AT,
};

const shown = (snapshot: View.Snapshot, view: Partial<View.View> = {}): View.View => ({
  ...View.initialView,
  snapshot: Option.some(snapshot),
  ...view,
});

// The Rosé Pine colours the screen is painted in, as 24-bit foreground sequences.
const fg = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${String((n >> 16) & 255)};${String((n >> 8) & 255)};${String(n & 255)}m`;
};
const TEXT = fg("#e0def4");
const SUBTLE = fg("#908caa");
const MUTED = fg("#6e6a86");
const LOVE = fg("#eb6f92");
const GOLD = fg("#f6c177");
const PINE = fg("#31748f");
const IRIS = fg("#c4a7e7");
const FG_RESET = "\x1b[39m";
const BOLD = "\x1b[1m";
const UNBOLD = "\x1b[22m";

const pad = (text: string, width: number): string => text.padEnd(width);
const num = (text: string, width: number): string => text.padStart(width);
const cells = (...parts: ReadonlyArray<string>): string => parts.join("  ");
const space = (count: number): string => " ".repeat(count);

// The plain rows of the screen: a box row, a divider, the bottoms and the two tops.
const box = (content: string): string => `│ ${content} │`;
const blankBox = box(space(USABLE));
const divider = `├${"─".repeat(COLUMNS - 2)}┤`;
const bottom = (note?: string): string =>
  note === undefined
    ? `╰${"─".repeat(COLUMNS - 2)}╯`
    : `╰${"─".repeat(COLUMNS - 7 - note.length)}┤ ${note} ├─╯`;
const machinesTop = (tabs: string, status: string): string =>
  `╭─┤ ${tabs} ├${"─".repeat(COLUMNS - 12 - tabs.length - status.length)}┤ ${status} ├─╮`;
const queueTop = (title: string): string =>
  `╭─┤ ${title} ├${"─".repeat(COLUMNS - 7 - title.length)}╮`;
const TABS = "qemu servers · 2 ├─┤ automation clients · 1";

// A card: the header's flexible left part against its fixed right part, then the two graph
// rows, labels above and values below, each graph GRAPH columns wide.
const header = (left: string, right: string): string =>
  `${pad(left, USABLE - right.length - 2)}  ${right}`;
const GRAPH_PAD = space(USABLE - 31 - 3 * GRAPH);
const labels = (cpu: string, mem: string, jobs: string): string =>
  `${pad("cpu", 8)} ${cpu}  ${pad("mem", 8)} ${mem}  ${pad("jobs", 8)} ${jobs}${GRAPH_PAD}`;
const values = (
  cpu: string,
  cpuGraph: string,
  mem: string,
  memGraph: string,
  jobs: string,
  jobsGraph: string,
): string =>
  `${num(cpu, 8)} ${cpuGraph}  ${num(mem, 8)} ${memGraph}  ${num(jobs, 8)} ${jobsGraph}${GRAPH_PAD}`;
const BLANK_GRAPH = space(GRAPH);
const METER = "■".repeat(16);

const GARAGE_RIGHT = `qemus 2  host cpu 12.3%  host mem ${METER} 31.5 / 66.9 GB  seen 12 s ago`;
const RUNNER_RIGHT = `host cpu 3.2%  host mem ${METER} 4.0 / 16.0 GB  seen 4 s ago`;

// garage's series as braille, the newest reading in the right half of the last column: cpu
// (0, 25) (50, 75) (100, 37.5); memory against its 512 MB peak; jobs against their peak of 2.
const CPU_TOP = `${space(GRAPH - 2)}⢠⡇`;
const CPU_BOTTOM = `${space(GRAPH - 3)}⢠⣿⣷`;
const MEM_TOP = `${space(GRAPH - 3)}⢀⣿⣿`;
const MEM_BOTTOM = `${space(GRAPH - 3)}⣼⣿⣿`;
const JOBS_TOP = `${space(GRAPH - 2)}⣿⣿`;
const JOBS_BOTTOM = `${space(GRAPH - 3)}⢸⣿⣿`;

// A job row: the marker column, then the columns, then blank to the row's width.
const jobCells = (
  ticket: string,
  test: string,
  action: string,
  status: string,
  queued: string,
  started: string,
): string =>
  cells(
    pad(ticket, 9),
    pad(test, 18),
    pad(action, 9),
    pad(status, 12),
    pad(queued, 11),
    pad(started, 11),
  );
const jobHeader = (usable = USABLE): string =>
  `  ${jobCells("ticket", "test", "action", "status", "queued", "started")}${space(usable - JOB_WIDTH)}`;
const JOB_HEADER = jobHeader();
const job = (
  marker: "▸" | " ",
  columns: Readonly<Parameters<typeof jobCells>>,
  usable = USABLE,
): string => `${marker} ${jobCells(...columns)}${space(usable - JOB_WIDTH)}`;
const RUNNING = [
  "OLI-61",
  "lock-screen",
  "diagnose",
  "● running",
  "3 min ago",
  "45 s ago",
] as const;
const RUNNING_ROW = job("▸", RUNNING);
const PENDING_ROW = job(" ", ["OLI-62", "install", "drive", "◌ pending", "7 s ago", "—"]);
// The ticket of a job row: the nine columns after the border, its padding and the marker column.
const ticketOf = (row: string): string => row.slice(4, 13).trimEnd();
const HINTS =
  "j/k select   tab machines/queue   h/l servers/clients   g/G first/last   L open ticket   q quit";
const FOOTER = ` ${HINTS}${space(COLUMNS - HINTS.length - 11)}oligarchy `;
const OPENED = pad(" opened https://linear.app/issue/OLI-61", COLUMNS);

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
const lastRows = (tty: FakeTerminal): ReadonlyArray<string> => plainRows(tty.frames.at(-1) ?? "");

const key = (name: string, shift = false): Terminal.UserInput => ({
  input: Option.some(name),
  key: { name, ctrl: false, meta: false, shift },
});

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
    "boxes the qemu servers as cards with their graphs, then the live queue, and ends with the key hints",
    () =>
      Effect.sync(() => {
        const rows = plainRows(View.draw(shown(SNAPSHOT), READ_AT, COLUMNS, ROWS));
        expect(rows[0]).toBe(machinesTop(TABS, "read 0 s ago"));
        expect(rows[1]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(rows[2]).toBe(box(labels(CPU_TOP, MEM_TOP, JOBS_TOP)));
        expect(rows[3]).toBe(
          box(values("37.5%", CPU_BOTTOM, "512 MB", MEM_BOTTOM, "2", JOBS_BOTTOM)),
        );
        expect(rows[4]).toBe(divider);
        expect(rows[5]).toBe(box(header("  — · https://qemu-c.example.com", "never heard from")));
        expect(rows[6]).toBe(box(labels(BLANK_GRAPH, BLANK_GRAPH, BLANK_GRAPH)));
        expect(rows[7]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
        expect(rows[8]).toBe(bottom());
        expect(rows[9]).toBe(queueTop("automation · running 1 · pending 1"));
        expect(rows[10]).toBe(box(JOB_HEADER));
        expect(rows[11]).toBe(box(RUNNING_ROW));
        expect(rows[12]).toBe(box(PENDING_ROW));
        for (const row of rows.slice(13, ROWS - 2)) {
          expect(row).toBe(blankBox);
        }
        expect(rows[ROWS - 2]).toBe(bottom());
        expect(rows[ROWS - 1]).toBe(FOOTER);
      }),
  );

  it.effect("shows the automation clients on the other tab, with the same card", () =>
    Effect.sync(() => {
      const rows = plainRows(
        View.draw(shown(SNAPSHOT, { tab: "clients" }), READ_AT, COLUMNS, ROWS),
      );
      expect(rows[0]).toBe(machinesTop(TABS, "read 0 s ago"));
      expect(rows[1]).toBe(box(header("▸ runner · http://10.0.0.9:7000", RUNNER_RIGHT)));
      // One reading: the left half of the one column is empty; 8% is one dot of the bottom row.
      expect(rows[2]).toBe(
        box(labels(BLANK_GRAPH, `${space(GRAPH - 1)}⢸`, `${space(GRAPH - 1)}⢸`)),
      );
      expect(rows[3]).toBe(
        box(
          values(
            "8.0%",
            `${space(GRAPH - 1)}⢀`,
            "256 MB",
            `${space(GRAPH - 1)}⢸`,
            "1",
            `${space(GRAPH - 1)}⢸`,
          ),
        ),
      );
      expect(rows[4]).toBe(bottom());
      expect(rows[5]).toBe(queueTop("automation · running 1 · pending 1"));
      expect(rows[7]).toBe(box(RUNNING_ROW));
      expect(rows[ROWS - 1]).toBe(FOOTER);
    }),
  );

  it.effect(
    "paints the borders muted, the active tab bold, the focused list's marker gold and the other's muted, the cpu graph by heat, memory pine, jobs iris, and each job by its status",
    () =>
      Effect.sync(() => {
        const frame = View.draw(shown(SNAPSHOT), READ_AT, COLUMNS, ROWS);
        const rows = rowsOf(frame);
        expect(rows[0]?.startsWith(`${MUTED}╭─┤ `)).toBe(true);
        expect(rows[0]).toContain(`${BOLD}${TEXT}qemu servers · 2${FG_RESET}${UNBOLD}`);
        expect(rows[0]).toContain(`${MUTED}automation clients · 1`);
        expect(rows[0]).toContain(`${MUTED}read 0 s ago`);
        expect(rows[1]).toContain(`${GOLD}▸${FG_RESET}`);
        expect(rows[1]).toContain(`${BOLD}${TEXT}garage${FG_RESET}${UNBOLD}`);
        expect(rows[1]).toContain(`${SUBTLE}qemus${FG_RESET} ${TEXT}2${FG_RESET}`);
        expect(rows[1]).toContain(`${SUBTLE}seen${FG_RESET} ${TEXT}12 s ago${FG_RESET}`);
        // Eight of sixteen blocks lit for 31.5 of 66.9 GB, each its own shade, the rest muted.
        expect(rows[1]).toContain(`■${FG_RESET}${MUTED}${"■".repeat(8)}${FG_RESET}`);
        expect(rows[1]).toContain(`${fg("#f6c177")}■${FG_RESET}${MUTED}`);
        expect(rows[2]).toContain(`${SUBTLE}cpu     ${FG_RESET}`);
        expect(rows[2]).toContain(`${LOVE}⡇${FG_RESET}`);
        expect(rows[2]).toContain(`${PINE}⢀⣿⣿${FG_RESET}`);
        expect(rows[2]).toContain(`${IRIS}⣿⣿${FG_RESET}`);
        expect(rows[3]).toContain(`${BOLD}${TEXT}   37.5%${FG_RESET}${UNBOLD}`);
        expect(rows[4]).toBe(`${MUTED}${divider}${FG_RESET}`);
        expect(rows[5]).not.toContain(`${GOLD}▸`);
        expect(rows[5]).toContain(`${MUTED}never heard from${FG_RESET}`);
        expect(rows[10]).toContain(`${SUBTLE}${JOB_HEADER}${FG_RESET}`);
        // The machines have the focus: the queue's marker is muted, its ticket text.
        expect(
          rows[11]?.startsWith(`${MUTED}│${FG_RESET} ${MUTED}▸${FG_RESET} ${TEXT}OLI-61`),
        ).toBe(true);
        expect(rows[11]).toContain(`${GOLD}${pad("● running", 12)}${FG_RESET}`);
        expect(rows[12]).toContain(`${MUTED}${pad("◌ pending", 12)}${FG_RESET}`);
        expect(rows[ROWS - 1]).toContain(`${TEXT}j/k${FG_RESET}${MUTED} select`);
        expect(rows[ROWS - 1]).toContain(`${TEXT}L${FG_RESET}${MUTED} open ticket`);
        expect(rows[ROWS - 1]).toContain(`${TEXT}q${FG_RESET}${MUTED} quit`);
        const queue = rowsOf(
          View.draw(shown(SNAPSHOT, { focus: "queue" }), READ_AT, COLUMNS, ROWS),
        );
        expect(queue[1]).toContain(`${MUTED}▸${FG_RESET}`);
        expect(queue[1]).not.toContain(`${GOLD}▸`);
        expect(queue[11]).toContain(`${GOLD}▸${FG_RESET}`);
        const clients = rowsOf(
          View.draw(shown(SNAPSHOT, { tab: "clients" }), READ_AT, COLUMNS, ROWS),
        );
        expect(clients[0]).toContain(`${MUTED}qemu servers · 2`);
        expect(clients[0]).toContain(`${BOLD}${TEXT}automation clients · 1${FG_RESET}${UNBOLD}`);
      }),
  );

  it.effect(
    "colours the cpu graph from foam through gold to love as the reading climbs, one colour per column",
    () =>
      Effect.sync(() => {
        const at = (readings: ReadonlyArray<number>): string =>
          rowsOf(
            View.draw(
              shown({
                ...SNAPSHOT,
                machines: [garage],
                series: [
                  {
                    ...garageSeries,
                    samples: readings.map((cpuPercent) => ({
                      jobs: 0,
                      memoryBytes: 1,
                      cpuPercent,
                    })),
                  },
                ],
              }),
              READ_AT,
              COLUMNS,
              ROWS,
            ),
          )[3] ?? "";
        // One percent is one dot, a shade off foam; fifty is gold itself; a hundred is love.
        expect(at([0, 1])).toContain(`${fg("#9ecfd6")}⢀${FG_RESET}`);
        expect(at([50, 50])).toContain(`${GOLD}⣿${FG_RESET}`);
        expect(at([100, 100])).toContain(`${LOVE}⣿${FG_RESET}`);
        // The first column at 25 sits between foam and gold; the second between gold and love.
        expect(at([25, 25, 75, 75])).toContain(`${fg("#c9c8a8")}⣤${fg("#f19885")}⣿${FG_RESET}`);
      }),
  );

  it.effect(
    "shows the newest readings that fit, and gives a wider terminal wider graphs and job rows as wide",
    () =>
      Effect.sync(() => {
        const wide = 160;
        const usable = wide - 4;
        const graph = Math.floor((usable - 31) / 3);
        const rows = plainRows(View.draw(shown(SNAPSHOT), READ_AT, wide, ROWS));
        for (const row of rows) {
          expect(row).toHaveLength(wide);
        }
        expect(rows[2]).toBe(
          box(
            `${pad("cpu", 8)} ${space(graph - 2)}⢠⡇  ${pad("mem", 8)} ${space(graph - 3)}⢀⣿⣿  ${pad("jobs", 8)} ${space(graph - 2)}⣿⣿${space(usable - 31 - 3 * graph)}`,
          ),
        );
        expect(rows[10]).toBe(`│ ${jobHeader(usable)} │`);
        expect(rows[11]).toBe(`│ ${job("▸", RUNNING, usable)} │`);
        // Ninety readings in a graph of thirty-three columns: the oldest twenty-four fall off.
        const long = Array.from({ length: 90 }, (_, index) => ({
          jobs: 0,
          memoryBytes: 1,
          cpuPercent: index < 24 ? 100 : 0,
        }));
        const cut = plainRows(
          View.draw(
            shown({
              ...SNAPSHOT,
              machines: [garage],
              series: [{ ...garageSeries, samples: long }],
            }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        const full = "⣿".repeat(GRAPH);
        expect(cut[2]).toBe(box(labels(BLANK_GRAPH, full, BLANK_GRAPH)));
        expect(cut[3]).toBe(box(values("0.0%", BLANK_GRAPH, "0 MB", full, "0", BLANK_GRAPH)));
        // Memory and jobs scale to the highest reading in view, not to one that fell off.
        const spiked = [
          { jobs: 8, memoryBytes: 1, cpuPercent: 0 },
          ...Array.from({ length: 2 * GRAPH - 1 }, () => ({
            jobs: 0,
            memoryBytes: 1,
            cpuPercent: 0,
          })),
          { jobs: 1, memoryBytes: 1, cpuPercent: 0 },
        ];
        const scaled = plainRows(
          View.draw(
            shown({
              ...SNAPSHOT,
              machines: [garage],
              series: [{ ...garageSeries, samples: spiked }],
            }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(scaled[2]).toBe(box(labels(BLANK_GRAPH, full, `${space(GRAPH - 1)}⢸`)));
        expect(scaled[3]).toBe(
          box(values("0.0%", BLANK_GRAPH, "0 MB", full, "1", `${space(GRAPH - 1)}⢸`)),
        );
      }),
  );

  it.effect("lists the jobs in the order given, running then pending, and nothing completed", () =>
    Effect.sync(() => {
      const other = { ...pending, ticket: "OLI-70" };
      const frame = View.draw(
        shown({
          ...SNAPSHOT,
          queue: {
            running: [running],
            pending: [other, pending],
            completed: [failed, { ...failed, ticket: "OLI-59", status: "succeeded" }],
          },
        }),
        READ_AT,
        COLUMNS,
        ROWS,
      );
      const rows = plainRows(frame);
      expect(rows.slice(11, 14).map(ticketOf)).toEqual(["OLI-61", "OLI-70", "OLI-62"]);
      expect(rows[14]).toBe(blankBox);
      expect(rows[9]).toBe(queueTop("automation · running 1 · pending 2"));
      expect(frame).not.toContain("OLI-60");
      expect(frame).not.toContain("OLI-59");
      expect(frame).not.toContain("failed");
      expect(frame).not.toContain("session timed out");
    }),
  );
});

describe("draw selection", () => {
  const fleet = Array.from({ length: 6 }, (_, index) => ({
    ...garage,
    url: `http://10.0.0.${String(index)}`,
    name: `s${String(index)}`,
  }));
  const many: View.Snapshot = { ...SNAPSHOT, machines: [...fleet, runner], series: [] };
  const names = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
    rows.filter((row) => /^│ [▸ ] s\d/.test(row)).map((row) => row.slice(2, 6));
  const at = (cursor: Partial<View.View["cursor"]>): View.View =>
    shown(many, { cursor: { ...View.initialView.cursor, ...cursor } });

  it.effect(
    "shows four cards at most, the selected one marked, and scrolls the window to keep it in view",
    () =>
      Effect.sync(() => {
        const top = plainRows(View.draw(shown(many), READ_AT, COLUMNS, ROWS));
        expect(names(top)).toEqual(["▸ s0", "  s1", "  s2", "  s3"]);
        expect(top[16]).toBe(bottom("1-4 of 6"));
        expect(top[17]).toBe(queueTop("automation · running 1 · pending 1"));
        const third = plainRows(View.draw(at({ servers: 3 }), READ_AT, COLUMNS, ROWS));
        expect(names(third)).toEqual(["  s0", "  s1", "  s2", "▸ s3"]);
        const fifth = plainRows(View.draw(at({ servers: 4 }), READ_AT, COLUMNS, ROWS));
        expect(names(fifth)).toEqual(["  s1", "  s2", "  s3", "▸ s4"]);
        expect(fifth[16]).toBe(bottom("2-5 of 6"));
        const last = plainRows(View.draw(at({ servers: 5 }), READ_AT, COLUMNS, ROWS));
        expect(names(last)).toEqual(["  s2", "  s3", "  s4", "▸ s5"]);
        expect(last[16]).toBe(bottom("3-6 of 6"));
        // Four or fewer: no window to speak of.
        const few = plainRows(View.draw(shown(SNAPSHOT), READ_AT, COLUMNS, ROWS));
        expect(few[8]).toBe(bottom());
      }),
  );

  it.effect("clamps a cursor past the end to the last card, and one below zero to the first", () =>
    Effect.sync(() => {
      const past = plainRows(View.draw(at({ servers: 40 }), READ_AT, COLUMNS, ROWS));
      expect(names(past)).toEqual(["  s2", "  s3", "  s4", "▸ s5"]);
      const below = plainRows(View.draw(at({ servers: -3 }), READ_AT, COLUMNS, ROWS));
      expect(names(below)).toEqual(["▸ s0", "  s1", "  s2", "  s3"]);
      // A fleet that shrank under the cursor: the first k moves off the last card, not to it.
      const shrunk = at({ servers: 40 });
      expect(View.press(shrunk, key("k")).cursor.servers).toBe(4);
      expect(View.press(shrunk, key("j")).cursor.servers).toBe(5);
    }),
  );

  it.effect(
    "marks the selected job, scrolls the job window to keep it in view, and counts the window on the border",
    () =>
      Effect.sync(() => {
        const jobs = Array.from({ length: 40 }, (_, index) => ({
          ...pending,
          ticket: `OLI-${String(100 + index)}`,
        }));
        const snapshot = { ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: jobs } };
        const marked = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
          rows.filter((row) => row.startsWith("│ ▸ OLI-")).map(ticketOf);
        const listed = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
          rows.filter((row) => /^│ [▸ ] OLI-/.test(row)).map(ticketOf);
        // 37 rows: nine are the cards' box, three the queue's frame, one the footer.
        const first = plainRows(View.draw(shown(snapshot), READ_AT, COLUMNS, ROWS));
        expect(listed(first)).toHaveLength(24);
        expect(listed(first)[0]).toBe("OLI-100");
        expect(marked(first)).toEqual(["OLI-100"]);
        expect(first[35]).toBe(bottom("1-24 of 40"));
        const within = plainRows(
          View.draw(
            shown(snapshot, { cursor: { ...View.initialView.cursor, queue: 10 } }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(listed(within)[0]).toBe("OLI-100");
        expect(marked(within)).toEqual(["OLI-110"]);
        const scrolled = plainRows(
          View.draw(
            shown(snapshot, { cursor: { ...View.initialView.cursor, queue: 30 } }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(listed(scrolled)[0]).toBe("OLI-107");
        expect(listed(scrolled).at(-1)).toBe("OLI-130");
        expect(marked(scrolled)).toEqual(["OLI-130"]);
        expect(scrolled[35]).toBe(bottom("8-31 of 40"));
        const end = plainRows(
          View.draw(
            shown(snapshot, { cursor: { ...View.initialView.cursor, queue: 39 } }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(listed(end)).toHaveLength(24);
        expect(marked(end)).toEqual(["OLI-139"]);
        expect(end[35]).toBe(bottom("17-40 of 40"));
        // A cursor past the end marks the last job; a taller terminal lists more.
        const past = plainRows(
          View.draw(
            shown(snapshot, { cursor: { ...View.initialView.cursor, queue: 90 } }),
            READ_AT,
            COLUMNS,
            50,
          ),
        );
        expect(past).toHaveLength(50);
        expect(listed(past)).toHaveLength(37);
        expect(marked(past)).toEqual(["OLI-139"]);
        expect(past[48]).toBe(bottom("4-40 of 40"));
        expect(past[49]).toBe(FOOTER);
        const exact = plainRows(
          View.draw(
            shown({ ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: jobs.slice(0, 24) } }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(exact[35]).toBe(bottom());
      }),
  );

  it.effect("j, k, down, up, g and G move the selection within the tab's machines", () =>
    Effect.sync(() => {
      const start = shown(many);
      const one = View.press(start, key("j"));
      expect(one.cursor).toEqual({ servers: 1, clients: 0, queue: 0 });
      const two = View.press(one, key("down"));
      expect(two.cursor.servers).toBe(2);
      expect(View.press(two, key("k")).cursor.servers).toBe(1);
      expect(View.press(two, key("up")).cursor.servers).toBe(1);
      const end = View.press(start, key("g", true));
      expect(end.cursor.servers).toBe(5);
      expect(View.press(end, key("j")).cursor.servers).toBe(5);
      expect(View.press(end, key("g")).cursor.servers).toBe(0);
      expect(View.press(start, key("k")).cursor.servers).toBe(0);
      expect(View.press(start, key("x"))).toEqual(start);
      expect(View.press(start, key("j")).tab).toBe("servers");
      expect(View.press(start, key("j")).focus).toBe("machines");
    }),
  );

  it.effect(
    "tab moves the focus between the machines and the queue; j, k, g and G then move the job selection, clamped to the jobs listed",
    () =>
      Effect.sync(() => {
        const three = {
          ...SNAPSHOT,
          queue: { ...QUEUE, pending: [{ ...pending, ticket: "OLI-70" }, pending] },
        };
        const start = View.press(shown(three), key("j"));
        const queue = View.press(start, key("tab"));
        expect(queue.focus).toBe("queue");
        expect(queue.tab).toBe("servers");
        expect(queue.cursor).toEqual({ servers: 1, clients: 0, queue: 0 });
        const one = View.press(queue, key("j"));
        expect(one.cursor).toEqual({ servers: 1, clients: 0, queue: 1 });
        expect(View.press(one, key("down")).cursor.queue).toBe(2);
        expect(View.press(View.press(one, key("j")), key("j")).cursor.queue).toBe(2);
        expect(View.press(one, key("k")).cursor.queue).toBe(0);
        expect(View.press(one, key("up")).cursor.queue).toBe(0);
        expect(View.press(queue, key("k")).cursor.queue).toBe(0);
        expect(View.press(queue, key("g", true)).cursor.queue).toBe(2);
        expect(View.press(one, key("g")).cursor.queue).toBe(0);
        // Back to the machines, each list keeping its place; shift-tab goes the same way.
        const back = View.press(one, key("tab"));
        expect(back.focus).toBe("machines");
        expect(back.cursor).toEqual({ servers: 1, clients: 0, queue: 1 });
        expect(View.press(back, key("j")).cursor).toEqual({ servers: 1, clients: 0, queue: 1 });
        expect(View.press(one, key("tab", true)).focus).toBe("machines");
        // A queue that shrank under the cursor: the first k moves off the last job, not to it.
        const shrunk = shown(three, {
          focus: "queue",
          cursor: { servers: 0, clients: 0, queue: 40 },
        });
        expect(View.press(shrunk, key("k")).cursor.queue).toBe(1);
        expect(View.press(shrunk, key("j")).cursor.queue).toBe(2);
        const rows = plainRows(View.draw(one, READ_AT, COLUMNS, ROWS));
        expect(rows[1]?.startsWith("│   garage")).toBe(true);
        expect(rows[5]?.startsWith("│ ▸ — ·")).toBe(true);
        expect(rows.slice(11, 14).map((row) => row.slice(2, 3))).toEqual([" ", "▸", " "]);
      }),
  );

  it.effect(
    "h, l, left and right switch between servers and clients whichever list has the focus, each keeping its own cursor",
    () =>
      Effect.sync(() => {
        const start = View.press(shown(many), key("j"));
        const clients = View.press(start, key("l"));
        expect(clients.tab).toBe("clients");
        expect(clients.focus).toBe("machines");
        expect(clients.cursor).toEqual({ servers: 1, clients: 0, queue: 0 });
        // One client: j has nowhere to go.
        expect(View.press(clients, key("j")).cursor).toEqual({ servers: 1, clients: 0, queue: 0 });
        expect(View.press(clients, key("h")).tab).toBe("servers");
        expect(View.press(clients, key("left")).tab).toBe("servers");
        expect(View.press(start, key("right")).tab).toBe("clients");
        expect(View.press(View.press(clients, key("l")), key("l")).tab).toBe("clients");
        const queue = View.press(start, key("tab"));
        expect(View.press(queue, key("l")).tab).toBe("clients");
        expect(View.press(queue, key("l")).focus).toBe("queue");
        const rows = plainRows(View.draw(clients, READ_AT, COLUMNS, ROWS));
        expect(rows[1]?.startsWith("│ ▸ runner")).toBe(true);
      }),
  );

  it.effect(
    "L moves nothing: opening the ticket is the runner's, and any key retires the last notice",
    () =>
      Effect.sync(() => {
        const start = shown(many);
        const noticed = { ...start, notice: Option.some("opened https://linear.app/issue/OLI-61") };
        expect(View.press(noticed, key("l", true))).toEqual(start);
        expect(View.press(noticed, key("j"))).toEqual(View.press(start, key("j")));
        expect(View.press(noticed, key("j")).notice).toEqual(Option.none());
        expect(View.press(noticed, key("x"))).toEqual(start);
        expect(View.press(noticed, key("tab")).notice).toEqual(Option.none());
      }),
  );

  it.effect(
    "a key before the first read changes the tab or the focus and leaves the cursors at the first",
    () =>
      Effect.sync(() => {
        expect(View.press(View.initialView, key("j")).cursor).toEqual({
          servers: 0,
          clients: 0,
          queue: 0,
        });
        expect(View.press(View.initialView, key("g", true)).cursor).toEqual({
          servers: 0,
          clients: 0,
          queue: 0,
        });
        expect(View.press(View.initialView, key("l")).tab).toBe("clients");
        expect(View.press(View.initialView, key("tab")).focus).toBe("queue");
        expect(View.press(View.press(View.initialView, key("tab")), key("j")).cursor.queue).toBe(0);
      }),
  );
});

describe("draw ages", () => {
  it.effect(
    "reads a stamp's age in the unit an operator would: seconds, minutes, hours, days",
    () =>
      Effect.sync(() => {
        const at = (secondsAgo: number): Servers.Machine => ({
          ...garage,
          url: `http://s${String(secondsAgo)}`,
          heartbeatAt: ago(secondsAgo),
        });
        const seen = (frame: string): ReadonlyArray<string> =>
          plainRows(frame)
            .filter((row) => row.includes("seen "))
            .map((row) => row.slice(row.indexOf("seen ") + 5, -2).trimEnd());
        expect(
          seen(
            View.draw(
              shown({ ...SNAPSHOT, machines: [at(0), at(59), at(60), at(3_599)] }),
              READ_AT,
              COLUMNS,
              ROWS,
            ),
          ),
        ).toEqual(["0 s ago", "59 s ago", "1 min ago", "59 min ago"]);
        // An hour and a day are silent, so the age follows the word.
        const old = plainRows(
          View.draw(
            shown({ ...SNAPSHOT, machines: [at(3_600), at(90_000)] }),
            READ_AT,
            COLUMNS,
            ROWS,
          ),
        );
        expect(old[1]).toContain("silent · seen 1 h ago");
        expect(old[5]).toContain("silent · seen 1 d ago");
      }),
  );

  it.effect("adds the time since the read to every age, and says how old the read itself is", () =>
    Effect.sync(() => {
      const rows = plainRows(View.draw(shown(SNAPSHOT), READ_AT + 3_000, COLUMNS, ROWS));
      expect(rows[0]).toBe(machinesTop(TABS, "read 3 s ago"));
      expect(rows[1]).toContain("seen 15 s ago");
      expect(rows[11]).toContain(`${pad("3 min ago", 11)}  ${pad("48 s ago", 11)}`);
      const later = plainRows(View.draw(shown(SNAPSHOT), READ_AT + 125_000, COLUMNS, ROWS));
      expect(later[0]).toBe(machinesTop(TABS, "read 2 min ago"));
    }),
  );

  it.effect("never reads a stamp the database wrote just ahead of its clock as negative", () =>
    Effect.sync(() => {
      const ahead: Servers.Machine = { ...garage, heartbeatAt: ago(-2) };
      const rows = plainRows(
        View.draw(shown({ ...SNAPSHOT, machines: [ahead] }), READ_AT, COLUMNS, ROWS),
      );
      expect(rows[1]).toContain("seen 0 s ago");
    }),
  );
});

describe("draw unhappy path", () => {
  it.effect(
    "marks a machine silent once three heartbeats are overdue, its host numbers withheld and its graphs muted",
    () =>
      Effect.sync(() => {
        const frame = View.draw(
          shown({ ...SNAPSHOT, machines: [attic], series: [atticSeries] }),
          READ_AT,
          COLUMNS,
          ROWS,
        );
        const rows = plainRows(frame);
        expect(rows[1]).toBe(
          box(header("▸ attic · https://qemu-b.example.com", "silent · seen 5 min ago")),
        );
        expect(rows[2]).toBe(
          box(labels(BLANK_GRAPH, `${space(GRAPH - 1)}⢸`, `${space(GRAPH - 1)}⢸`)),
        );
        expect(rows[3]).toBe(
          box(
            values(
              "50.0%",
              `${space(GRAPH - 1)}⢸`,
              "1.0 GB",
              `${space(GRAPH - 1)}⢸`,
              "3",
              `${space(GRAPH - 1)}⢸`,
            ),
          ),
        );
        expect(frame).not.toContain("50.0%  host");
        expect(frame).not.toContain("4.0 / 16.0 GB");
        const styled = rowsOf(frame);
        expect(styled[1]).toContain(`${LOVE}silent · seen 5 min ago${FG_RESET}`);
        expect(styled[2]).toContain(`${MUTED}⢸${FG_RESET}`);
        expect(styled[2]).not.toContain(PINE);
        expect(styled[3]).not.toContain(IRIS);
        expect(styled[3]).toContain(`${MUTED}   50.0%${FG_RESET}`);
      }),
  );

  it.effect(
    "is not silent at ninety seconds and is at ninety-one, the read's own age included",
    () =>
      Effect.sync(() => {
        const at = (secondsAgo: number) => ({
          ...SNAPSHOT,
          machines: [{ ...garage, heartbeatAt: ago(secondsAgo) }],
        });
        expect(plainRows(View.draw(shown(at(90)), READ_AT, COLUMNS, ROWS))[1]).toContain(
          "31.5 / 66.9 GB",
        );
        expect(plainRows(View.draw(shown(at(91)), READ_AT, COLUMNS, ROWS))[1]).toContain(
          "silent · seen 1 min ago",
        );
        expect(plainRows(View.draw(shown(at(88)), READ_AT + 3_000, COLUMNS, ROWS))[1]).toContain(
          "silent · seen 1 min ago",
        );
      }),
  );

  it.effect("draws a live machine without readings with dashes and empty graphs", () =>
    Effect.sync(() => {
      const rows = plainRows(
        View.draw(shown({ ...SNAPSHOT, machines: [garage], series: [] }), READ_AT, COLUMNS, ROWS),
      );
      expect(rows[1]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
      expect(rows[2]).toBe(box(labels(BLANK_GRAPH, BLANK_GRAPH, BLANK_GRAPH)));
      expect(rows[3]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
      // A client's readings never dress a server of the same name.
      const crossed = plainRows(
        View.draw(
          shown({
            ...SNAPSHOT,
            machines: [garage],
            series: [{ ...garageSeries, type: "automation-client" }],
          }),
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      expect(crossed[3]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
    }),
  );

  it.effect("says so in a tab with no machines, and gives the queue the rows", () =>
    Effect.sync(() => {
      const servers = plainRows(
        View.draw(shown({ ...SNAPSHOT, machines: [runner] }), READ_AT, COLUMNS, ROWS),
      );
      expect(servers[0]).toBe(
        machinesTop("qemu servers · 0 ├─┤ automation clients · 1", "read 0 s ago"),
      );
      expect(servers[1]).toBe(box(pad("no qemu servers registered", USABLE)));
      expect(servers[2]).toBe(bottom());
      expect(servers[3]).toBe(queueTop("automation · running 1 · pending 1"));
      expect(servers[5]).toBe(box(RUNNING_ROW));
      const clients = plainRows(
        View.draw(
          shown({ ...SNAPSHOT, machines: [garage] }, { tab: "clients" }),
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      expect(clients[1]).toBe(box(pad("no automation clients registered", USABLE)));
      const styled = rowsOf(
        View.draw(shown({ ...SNAPSHOT, machines: [] }), READ_AT, COLUMNS, ROWS),
      );
      expect(styled[1]).toContain(
        `${MUTED}${pad("no qemu servers registered", USABLE)}${FG_RESET}`,
      );
    }),
  );

  it.effect(
    "says so under the queue's header with nothing to list, marks nothing, and counts zero",
    () =>
      Effect.sync(() => {
        const frame = View.draw(
          shown({ ...SNAPSHOT, queue: EMPTY_QUEUE }, { focus: "queue" }),
          READ_AT,
          COLUMNS,
          ROWS,
        );
        const rows = plainRows(frame);
        expect(rows[9]).toBe(queueTop("automation · running 0 · pending 0"));
        expect(rows[10]).toBe(box(JOB_HEADER));
        expect(rows[11]).toBe(box(pad("no jobs", USABLE)));
        expect(rows[12]).toBe(blankBox);
        expect(frame).not.toContain(`${GOLD}▸`);
        expect(rowsOf(frame)[11]).toContain(`${MUTED}${pad("no jobs", USABLE)}${FG_RESET}`);
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
      expect(rows[11]?.startsWith(`│ ▸ ${cells(pad("—", 9), pad("install", 18))}`)).toBe(true);
    }),
  );

  it.effect("truncates a name, a url and a test to their columns with an ellipsis", () =>
    Effect.sync(() => {
      const long = "a".repeat(80);
      const rows = plainRows(
        View.draw(
          shown({
            ...SNAPSHOT,
            machines: [{ ...garage, name: long, url: `http://${long}.example.com` }],
            series: [],
            queue: { ...EMPTY_QUEUE, running: [{ ...running, test: long }] },
          }),
          READ_AT,
          COLUMNS,
          ROWS,
        ),
      );
      const left = USABLE - GARAGE_RIGHT.length - 2;
      expect(rows[1]).toBe(box(header(`▸ ${long.slice(0, left - 3)}…`, GARAGE_RIGHT)));
      expect(rows[7]).toBe(
        box(
          job("▸", [
            "OLI-61",
            `${"a".repeat(17)}…`,
            "diagnose",
            "● running",
            "3 min ago",
            "45 s ago",
          ]),
        ),
      );
      for (const row of rows) {
        expect(row).toHaveLength(COLUMNS);
      }
    }),
  );

  it.effect(
    "draws a test name that spans lines or carries an escape, and a failure that does, as one row each",
    () =>
      Effect.sync(() => {
        const frame = View.draw(
          {
            ...shown({
              ...SNAPSHOT,
              queue: {
                ...EMPTY_QUEUE,
                running: [{ ...running, test: "one\ntwo\x1b[31m\tt\u007f\u009bc" }],
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
        expect(frame).not.toContain("\x1b[31m\tt");
        // The 8-bit CSI a UTF-8 terminal would obey as one, drawn as a space like the 7-bit one.
        expect(frame).not.toContain("\u009b");
        const rows = plainRows(frame);
        for (const row of rows) {
          expect(row).toHaveLength(COLUMNS);
        }
        expect(rows[11]).toBe(
          box(
            job("▸", [
              "OLI-61",
              "one two [31m t  c",
              "diagnose",
              "● running",
              "3 min ago",
              "45 s ago",
            ]),
          ),
        );
        expect(rows[ROWS - 1]).toBe(pad(" error: Failed query: select 1 params: []", COLUMNS));
      }),
  );

  it.effect("draws the empty frame and the tabs before the first read has landed", () =>
    Effect.sync(() => {
      const frame = View.draw(View.initialView, READ_AT, COLUMNS, ROWS);
      const rows = plainRows(frame);
      expect(rows[0]).toBe(machinesTop("qemu servers ├─┤ automation clients", "reading…"));
      expect(rows[1]).toBe(blankBox);
      expect(rows[2]).toBe(bottom());
      expect(rows[3]).toBe(queueTop("automation"));
      expect(rows[4]).toBe(box(JOB_HEADER));
      for (const row of rows.slice(5, ROWS - 2)) {
        expect(row).toBe(blankBox);
      }
      expect(rows[ROWS - 2]).toBe(bottom());
      expect(rows[ROWS - 1]).toBe(FOOTER);
      expect(rowsOf(frame)[0]).toContain(`${BOLD}${TEXT}qemu servers${FG_RESET}${UNBOLD}`);
    }),
  );

  it.effect("puts a failed read's reason on the footer and keeps the last snapshot on screen", () =>
    Effect.sync(() => {
      const reason = "Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432";
      const frame = View.draw(
        { ...shown(SNAPSHOT), failure: Option.some(reason) },
        READ_AT + 7_000,
        COLUMNS,
        ROWS,
      );
      const rows = plainRows(frame);
      expect(rows[0]).toBe(machinesTop(TABS, "read 7 s ago"));
      expect(rows[1]).toContain("http://127.0.0.1:55332");
      expect(rows[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
      expect(rowsOf(frame)[ROWS - 1]).toBe(
        `${LOVE}${pad(` error: ${reason}`, COLUMNS)}${FG_RESET}`,
      );
      expect(frame).not.toContain("q quit");
      const bare = plainRows(
        View.draw({ ...View.initialView, failure: Option.some(reason) }, READ_AT, COLUMNS, ROWS),
      );
      expect(bare[0]).toBe(machinesTop("qemu servers ├─┤ automation clients", "reading…"));
      expect(bare[1]).toBe(blankBox);
      expect(bare[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
    }),
  );

  it.effect("puts the last key's notice on the footer in gold, under a read's failure", () =>
    Effect.sync(() => {
      const notice = "opened https://linear.app/issue/OLI-61";
      const frame = View.draw(
        { ...shown(SNAPSHOT), notice: Option.some(notice) },
        READ_AT,
        COLUMNS,
        ROWS,
      );
      expect(plainRows(frame)[ROWS - 1]).toBe(OPENED);
      expect(rowsOf(frame)[ROWS - 1]).toBe(`${GOLD}${OPENED}${FG_RESET}`);
      expect(frame).not.toContain("q quit");
      const reason = "Failed query: select 1";
      const both = View.draw(
        { ...shown(SNAPSHOT), notice: Option.some(notice), failure: Option.some(reason) },
        READ_AT,
        COLUMNS,
        ROWS,
      );
      expect(plainRows(both)[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
      const cut = View.draw(
        { ...shown(SNAPSHOT), notice: Option.some(`xdg-open: ${"x".repeat(200)}`) },
        READ_AT,
        COLUMNS,
        ROWS,
      );
      expect(plainRows(cut)[ROWS - 1]).toBe(` xdg-open: ${"x".repeat(COLUMNS - 12)}…`);
    }),
  );

  it.effect("clears the screen and names the size it needs when the terminal is too small", () =>
    Effect.sync(() => {
      expect(View.tooSmall(100, 24)).toBe(
        "viz needs a terminal of at least 135×37 (columns×rows); this one is 100×24",
      );
      const narrow = View.draw(shown(SNAPSHOT), READ_AT, 134, 37);
      expect(narrow).toBe(`\x1b[2J\x1b[1;1H${LOVE}${View.tooSmall(134, 37)}${FG_RESET}`);
      const short = View.draw(shown(SNAPSHOT), READ_AT, 135, 36);
      expect(short).toBe(`\x1b[2J\x1b[1;1H${LOVE}${View.tooSmall(135, 36)}${FG_RESET}`);
      expect(View.draw(shown(SNAPSHOT), READ_AT, 135, 37)).not.toContain("viz needs");
    }),
  );
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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

// The view over the scripted stores, the terminal, and a spawner that opens nothing unless told.
const live = (
  tty: FakeTerminal,
  scripted: Scripted = {},
  spawner: FakeSpawner = fakeSpawner(),
): Effect.Effect<void, PlatformError.PlatformError> =>
  View.run.pipe(Effect.provide(Layer.mergeAll(storesLayer(scripted), tty.layer, spawner.layer)));

const refused = Errors.DatabaseError.make({
  operation: "listMachines",
  message: "Failed query: select 1",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

describe("run happy path", () => {
  it.effect(
    "takes the alternate screen, reads and paints at once asking for no completed jobs, repaints every second, re-reads every five, and q gives the screen back",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal({ columns: 135, rows: 37 });
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
        const fiber = yield* Effect.forkChild(live(tty, { machines, jobs }), {
          startImmediately: true,
        });
        yield* settle;
        expect(tty.frames[0]).toBe(View.ENTER_SCREEN);
        expect(tty.frames).toHaveLength(2);
        expect(reads.count).toBe(1);
        expect(asked).toEqual([0]);
        const first = plainRows(tty.frames[1] ?? "");
        expect(first[0]).toBe(
          machinesTop("qemu servers · 1 ├─┤ automation clients · 1", "read 0 s ago"),
        );
        expect(first[1]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(first[2]).toBe(box(labels(CPU_TOP, MEM_TOP, JOBS_TOP)));
        // One server in this fleet, so the queue sits right under its card.
        expect(first[4]).toBe(bottom());
        expect(first[7]).toBe(box(RUNNING_ROW));

        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(tty.frames).toHaveLength(3);
        expect(reads.count).toBe(1);
        const second = plainRows(tty.frames[2] ?? "");
        expect(second[0]).toBe(
          machinesTop("qemu servers · 1 ├─┤ automation clients · 1", "read 1 s ago"),
        );
        expect(second[1]).toContain("seen 13 s ago");

        yield* TestClock.adjust("4 seconds");
        yield* settle;
        expect(reads.count).toBe(2);
        expect(asked).toEqual([0, 0]);
        expect(lastRows(tty)[0]).toBe(
          machinesTop("qemu servers · 1 ├─┤ automation clients · 1", "read 0 s ago"),
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

  it.effect("a key repaints at once: l shows the clients, j and k move the selection", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
      const fiber = yield* Effect.forkChild(live(tty), { startImmediately: true });
      yield* settle;
      expect(tty.frames).toHaveLength(2);
      yield* tty.press("l");
      yield* settle;
      expect(tty.frames).toHaveLength(3);
      const clients = plainRows(tty.frames[2] ?? "");
      expect(clients[1]).toBe(box(header("▸ runner · http://10.0.0.9:7000", RUNNER_RIGHT)));
      yield* tty.press("h");
      yield* tty.press("j");
      yield* settle;
      expect(tty.frames).toHaveLength(5);
      // One server: j paints the same picture again.
      expect(plainRows(tty.frames[4] ?? "")[1]).toBe(
        box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)),
      );
      yield* tty.press("k");
      yield* settle;
      expect(tty.frames).toHaveLength(6);
      yield* tty.press("q");
      yield* Fiber.join(fiber);
      expect(tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
    }),
  );

  it.effect(
    "L opens the selected job's ticket with xdg-open, detached and left to itself, and the footer says so until the next key",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal();
        const spawner = fakeSpawner(byCommand({ "xdg-open": { exitCode: 0 } }));
        const fiber = yield* Effect.forkChild(live(tty, {}, spawner), { startImmediately: true });
        yield* settle;
        yield* tty.press("L");
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
        expect(lastRows(tty)[36]).toBe(OPENED);
        expect(rowsOf(tty.frames.at(-1) ?? "")[36]).toBe(`${GOLD}${OPENED}${FG_RESET}`);
        // The notice outlives the age ticks and the reads, and goes with the next key.
        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(lastRows(tty)[36]).toBe(OPENED);
        yield* tty.press("j");
        yield* settle;
        expect(lastRows(tty)[36]).toBe(FOOTER);
        // The queue's selection is what L opens, whichever list has the focus.
        yield* tty.key("tab");
        yield* tty.press("j");
        yield* tty.key("tab");
        yield* tty.press("L");
        yield* settle;
        expect(spawner.spawned).toHaveLength(2);
        expect(spawner.spawned[1]?.args).toEqual(["https://linear.app/issue/OLI-62"]);
        expect(lastRows(tty)[36]).toBe(pad(" opened https://linear.app/issue/OLI-62", COLUMNS));
        yield* tty.press("q");
        yield* Fiber.join(fiber);
        expect(tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
      }),
  );

  it.effect(
    "an xdg-open still running two seconds on has handed the url to a browser in its foreground: opened, and left running",
    () =>
      Effect.gen(function* () {
        const tty = yield* fakeTerminal();
        const spawner = fakeSpawner(byCommand({ "xdg-open": {} }));
        const fiber = yield* Effect.forkChild(live(tty, {}, spawner), { startImmediately: true });
        yield* settle;
        yield* tty.press("L");
        yield* settle;
        expect(spawner.spawned).toHaveLength(1);
        expect(lastRows(tty)[36]).toBe(FOOTER);
        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(lastRows(tty)[36]).toBe(FOOTER);
        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(lastRows(tty)[36]).toBe(OPENED);
        const [opened] = spawner.spawned;
        expect(yield* opened.isRunning).toBe(true);
        expect(opened.isReferenced()).toBe(false);
        expect(opened.isReleased()).toBe(true);
        expect(opened.kills).toEqual([]);
        yield* tty.press("q");
        yield* Fiber.join(fiber);
        expect(opened.kills).toEqual([]);
      }),
  );

  it.effect("Q quits too, and so does the input ending, as ctrl-c ends it", () =>
    Effect.gen(function* () {
      const upper = yield* fakeTerminal();
      const byUpper = yield* Effect.forkChild(live(upper), { startImmediately: true });
      yield* settle;
      yield* upper.press("x");
      yield* settle;
      expect(upper.frames.at(-1)).not.toBe(View.LEAVE_SCREEN);
      yield* upper.press("Q");
      yield* Fiber.join(byUpper);
      expect(upper.frames.at(-1)).toBe(View.LEAVE_SCREEN);

      const ended = yield* fakeTerminal();
      const byEnd = yield* Effect.forkChild(live(ended), { startImmediately: true });
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
        const machines = () =>
          Effect.suspend(() => {
            calls.count += 1;
            return calls.count === 2 ? Effect.fail(refused) : Effect.succeed([garage, runner]);
          });
        const fiber = yield* Effect.forkChild(live(tty, { machines }), { startImmediately: true });
        yield* settle;
        expect(plainRows(tty.frames[1] ?? "")[36]).toBe(FOOTER);

        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(calls.count).toBe(2);
        const failedFrame = lastRows(tty);
        expect(failedFrame[0]).toBe(
          machinesTop("qemu servers · 1 ├─┤ automation clients · 1", "read 5 s ago"),
        );
        expect(failedFrame[1]).toContain("http://127.0.0.1:55332");
        expect(failedFrame[36]).toBe(
          pad(" error: Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432", COLUMNS),
        );

        yield* TestClock.adjust("5 seconds");
        yield* settle;
        expect(calls.count).toBe(3);
        const recovered = lastRows(tty);
        expect(recovered[0]).toBe(
          machinesTop("qemu servers · 1 ├─┤ automation clients · 1", "read 0 s ago"),
        );
        expect(recovered[36]).toBe(FOOTER);

        yield* tty.press("q");
        yield* Fiber.join(fiber);
      }),
  );

  it.effect("a first read that fails shows the reason under an empty frame and keeps trying", () =>
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
      const fiber = yield* Effect.forkChild(live(tty, { jobs }), { startImmediately: true });
      yield* settle;
      const bare = plainRows(tty.frames[1] ?? "");
      expect(bare[0]).toBe(machinesTop("qemu servers ├─┤ automation clients", "reading…"));
      expect(bare[1]).toBe(blankBox);
      expect(bare[36]).toBe(pad(" error: timeout", COLUMNS));

      yield* TestClock.adjust("5 seconds");
      yield* settle;
      expect(calls.count).toBe(2);
      const shownNow = lastRows(tty);
      expect(shownNow[7]).toBe(box(RUNNING_ROW));
      expect(shownNow[36]).toBe(FOOTER);

      yield* tty.press("q");
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("L with no job selected, or a job without a ticket, says so and opens nothing", () =>
    Effect.gen(function* () {
      const empty = yield* fakeTerminal();
      const emptySpawner = fakeSpawner();
      const byEmpty = yield* Effect.forkChild(
        live(empty, { jobs: () => Effect.succeed(EMPTY_QUEUE) }, emptySpawner),
        { startImmediately: true },
      );
      yield* settle;
      yield* empty.press("L");
      yield* settle;
      expect(emptySpawner.spawned).toEqual([]);
      expect(lastRows(empty)[36]).toBe(pad(" no job selected", COLUMNS));
      yield* empty.press("q");
      yield* Fiber.join(byEmpty);

      const unticketed = yield* fakeTerminal();
      const unticketedSpawner = fakeSpawner();
      const byUnticketed = yield* Effect.forkChild(
        live(
          unticketed,
          {
            jobs: () => Effect.succeed({ ...EMPTY_QUEUE, running: [{ ...running, ticket: null }] }),
          },
          unticketedSpawner,
        ),
        { startImmediately: true },
      );
      yield* settle;
      yield* unticketed.press("L");
      yield* settle;
      expect(unticketedSpawner.spawned).toEqual([]);
      expect(lastRows(unticketed)[36]).toBe(pad(" the selected job has no ticket", COLUMNS));
      yield* unticketed.press("q");
      yield* Fiber.join(byUnticketed);

      // Before the first read there is nothing to open either.
      const unread = yield* fakeTerminal();
      const unreadSpawner = fakeSpawner();
      const byUnread = yield* Effect.forkChild(
        live(unread, { jobs: () => Effect.never }, unreadSpawner),
        { startImmediately: true },
      );
      yield* settle;
      yield* unread.press("L");
      yield* settle;
      expect(unreadSpawner.spawned).toEqual([]);
      expect(lastRows(unread)[36]).toBe(pad(" no job selected", COLUMNS));
      yield* unread.press("q");
      yield* Fiber.join(byUnread);
    }),
  );

  it.effect(
    "L puts xdg-open's refusal on the footer: the binary missing, or an exit that says nothing handles the url",
    () =>
      Effect.gen(function* () {
        const missing = yield* fakeTerminal();
        const missingSpawner = fakeSpawner(
          byCommand({ "xdg-open": { spawnError: "spawn xdg-open ENOENT" } }),
        );
        const byMissing = yield* Effect.forkChild(live(missing, {}, missingSpawner), {
          startImmediately: true,
        });
        yield* settle;
        yield* missing.press("L");
        yield* settle;
        expect(missingSpawner.spawned).toEqual([]);
        expect(lastRows(missing)[36]).toBe(pad(" xdg-open: spawn xdg-open ENOENT", COLUMNS));
        expect(rowsOf(missing.frames.at(-1) ?? "")[36]).toBe(
          `${GOLD}${pad(" xdg-open: spawn xdg-open ENOENT", COLUMNS)}${FG_RESET}`,
        );
        // The view goes on: the next key retires the notice and the screen still works.
        yield* missing.press("j");
        yield* settle;
        expect(lastRows(missing)[36]).toBe(FOOTER);
        yield* missing.press("q");
        yield* Fiber.join(byMissing);
        expect(missing.frames.at(-1)).toBe(View.LEAVE_SCREEN);

        const refusing = yield* fakeTerminal();
        const refusingSpawner = fakeSpawner(byCommand({ "xdg-open": { exitCode: 3 } }));
        const byRefusing = yield* Effect.forkChild(live(refusing, {}, refusingSpawner), {
          startImmediately: true,
        });
        yield* settle;
        yield* refusing.press("L");
        yield* settle;
        expect(refusingSpawner.spawned).toHaveLength(1);
        expect(lastRows(refusing)[36]).toBe(pad(" xdg-open exited 3", COLUMNS));
        yield* refusing.press("q");
        yield* Fiber.join(byRefusing);
      }),
  );

  it.effect("a terminal shrunk below the minimum shows the size it needs until it grows back", () =>
    Effect.gen(function* () {
      const tty = yield* fakeTerminal();
      const fiber = yield* Effect.forkChild(live(tty), { startImmediately: true });
      yield* settle;
      tty.resize(100, 24);
      yield* TestClock.adjust("1 second");
      yield* settle;
      expect(tty.frames.at(-1)).toBe(`\x1b[2J\x1b[1;1H${LOVE}${View.tooSmall(100, 24)}${FG_RESET}`);
      tty.resize(140, 40);
      yield* TestClock.adjust("1 second");
      yield* settle;
      const regrown = lastRows(tty);
      expect(regrown).toHaveLength(40);
      expect(regrown[1]).toContain("http://127.0.0.1:55332");
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
        const error = yield* Effect.flip(live(tty));
        expect(error._tag).toBe("PlatformError");
        expect(tty.frames[0]).toBe(View.ENTER_SCREEN);
        expect(tty.frames.at(-1)).toBe(View.LEAVE_SCREEN);
      }),
  );
});
