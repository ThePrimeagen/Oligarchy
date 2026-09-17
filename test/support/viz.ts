import { Option } from "effect";
import type * as Automation from "../../src/db/automation.ts";
import type * as ProcessStats from "../../src/db/process-stats.ts";
import type * as Servers from "../../src/db/servers.ts";
import * as View from "../../src/viz/view.ts";

export const QUERIED_AT = new Date("2026-09-09T16:00:00Z");
// The local clock at the read; the TestClock starts at 0, so the runner tests read at 0.
export const READ_AT = 1_000_000;

export const ago = (seconds: number): Date => new Date(QUERIED_AT.getTime() - seconds * 1000);

export const garage: Servers.Machine = {
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

export const attic: Servers.Machine = {
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

export const neverHeardFrom: Servers.Machine = {
  url: "https://qemu-c.example.com",
  name: null,
  type: "qemu",
  stats: null,
  generation: 0,
  heartbeatAt: null,
  queriedAt: QUERIED_AT,
};

export const runner: Servers.Machine = {
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
export const garageSeries: ProcessStats.Series = {
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

export const runnerSeries: ProcessStats.Series = {
  name: "runner",
  type: "automation-client",
  samples: [{ jobs: 1, memoryBytes: 256_000_000, cpuPercent: 8 }],
};

export const atticSeries: ProcessStats.Series = {
  name: "attic",
  type: "qemu",
  samples: [{ jobs: 3, memoryBytes: 1_000_000_000, cpuPercent: 50 }],
};

// A drive runner took, its guest on garage: on both cards.
export const running: Automation.AutomationJobListRow = {
  ticket: "OLI-61",
  test: "lock-screen",
  action: "drive",
  status: "running",
  reason: null,
  clientUrl: runner.url,
  serverUrl: garage.url,
  createdAt: ago(180),
  startedAt: ago(45),
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

// A diagnose runner took: no guest, so on runner's card alone.
export const diagnosing: Automation.AutomationJobListRow = {
  ...running,
  ticket: "OLI-65",
  test: "wifi",
  action: "diagnose",
  serverUrl: null,
};

export const pending: Automation.AutomationJobListRow = {
  ticket: "OLI-62",
  test: "install",
  action: "drive",
  status: "pending",
  reason: null,
  clientUrl: null,
  serverUrl: null,
  createdAt: ago(7),
  startedAt: null,
  finishedAt: null,
  queriedAt: QUERIED_AT,
};

// Over, and so never drawn: the store lists none when asked for zero, and one it did list would
// not be shown either.
export const failed: Automation.AutomationJobListRow = {
  ticket: "OLI-60",
  test: "wifi",
  action: "drive",
  status: "failed",
  reason: "session timed out",
  clientUrl: runner.url,
  serverUrl: garage.url,
  createdAt: ago(3_900),
  startedAt: ago(3_800),
  finishedAt: ago(600),
  queriedAt: QUERIED_AT,
};

export const QUEUE: Automation.AutomationQueue = {
  running: [running],
  pending: [pending],
  completed: [failed],
};
export const EMPTY_QUEUE: Automation.AutomationQueue = { running: [], pending: [], completed: [] };

export const SNAPSHOT: View.Snapshot = {
  machines: [garage, neverHeardFrom, runner],
  series: [garageSeries, runnerSeries],
  queue: QUEUE,
  readAt: READ_AT,
};

export const shown = (snapshot: View.Snapshot, view: Partial<View.View> = {}): View.View => ({
  ...View.initialView,
  snapshot: Option.some(snapshot),
  ...view,
});

export const at = (snapshot: View.Snapshot, cursor: Partial<View.View["cursor"]>): View.View =>
  shown(snapshot, { cursor: { ...View.initialView.cursor, ...cursor } });

// A key as OpenTUI reports it: a capital letter is its lowercase name with shift.
export const key = (name: string, shift = false): View.Key => ({
  name,
  shift,
  ctrl: false,
  meta: false,
});

// ---------------------------------------------------------------------------
// The frame's vocabulary at the minimum size: what a row of the screen reads as.
// ---------------------------------------------------------------------------

export const COLUMNS = 135;
export const ROWS = 37;
// What a box row holds between its border and padding, and each of the three graphs' width.
export const USABLE = COLUMNS - 4;
export const GRAPH = Math.floor((USABLE - 31) / 3);

export const pad = (text: string, width: number): string => text.padEnd(width);
export const num = (text: string, width: number): string => text.padStart(width);
export const cells = (...parts: ReadonlyArray<string>): string => parts.join("  ");
export const space = (count: number): string => " ".repeat(count);

// The plain rows of the screen: a box row padded to the box, a divider, the bottoms and the tops.
export const box = (content: string, columns = COLUMNS): string =>
  `│ ${pad(content, columns - 4)} │`;
export const blankBox = box("");
export const divider = `├${"─".repeat(COLUMNS - 2)}┤`;
export const bottom = (note?: string, columns = COLUMNS): string =>
  note === undefined
    ? `╰${"─".repeat(columns - 2)}╯`
    : `╰${"─".repeat(columns - 5 - note.length)} ${note} ─╯`;
export const machinesTop = (status: string, columns = COLUMNS): string =>
  `╭${"─".repeat(columns - 5 - status.length)} ${status} ─╮`;
export const queueTop = (title: string, columns = COLUMNS): string =>
  `╭─ ${title} ${"─".repeat(columns - 5 - title.length)}╮`;

// A card: the header's flexible left part against its fixed right part, then the two graph
// rows, labels above and values below, each graph GRAPH columns wide.
export const header = (left: string, right: string, columns = COLUMNS): string =>
  `${pad(left, columns - 4 - right.length - 2)}  ${right}`;
export const labels = (cpu: string, mem: string, jobs: string): string =>
  `${pad("cpu", 8)} ${cpu}  ${pad("mem", 8)} ${mem}  ${pad("jobs", 8)} ${jobs}`;
export const values = (
  cpu: string,
  cpuGraph: string,
  mem: string,
  memGraph: string,
  jobs: string,
  jobsGraph: string,
): string => `${num(cpu, 8)} ${cpuGraph}  ${num(mem, 8)} ${memGraph}  ${num(jobs, 8)} ${jobsGraph}`;
export const BLANK_GRAPH = space(GRAPH);
export const METER = "■".repeat(16);

export const GARAGE_RIGHT = `qemus 2  host cpu 12.3%  host mem ${METER} 31.5 / 66.9 GB  seen 12 s ago`;
export const RUNNER_RIGHT = `host cpu 3.2%  host mem ${METER} 4.0 / 16.0 GB  seen 4 s ago`;

// garage's series as braille, the newest reading in the right half of the last column: cpu
// (0, 25) (50, 75) (100, 37.5); memory against its 512 MB peak; jobs against their peak of 2.
export const CPU_TOP = `${space(GRAPH - 2)}⢠⡇`;
export const CPU_BOTTOM = `${space(GRAPH - 3)}⢠⣿⣷`;
export const MEM_TOP = `${space(GRAPH - 3)}⢀⣿⣿`;
export const MEM_BOTTOM = `${space(GRAPH - 3)}⣼⣿⣿`;
export const JOBS_TOP = `${space(GRAPH - 2)}⣿⣿`;
export const JOBS_BOTTOM = `${space(GRAPH - 3)}⢸⣿⣿`;

// A job row: the marker column, then six columns with a gap between each.
export const jobCells = (
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
export const JOB_HEADER = `  ${jobCells("ticket", "test", "action", "status", "queued", "started")}`;
export const job = (marker: "▸" | " ", columns: Readonly<Parameters<typeof jobCells>>): string =>
  `${marker} ${jobCells(...columns)}`;
export const RUNNING = [
  "OLI-61",
  "lock-screen",
  "drive",
  "● running",
  "3 min ago",
  "45 s ago",
] as const;
export const DIAGNOSING = [
  "OLI-65",
  "wifi",
  "diagnose",
  "● running",
  "3 min ago",
  "45 s ago",
] as const;
export const PENDING = ["OLI-62", "install", "drive", "◌ pending", "7 s ago", "—"] as const;
// The ticket of a job row: the nine columns after the border, its padding and the marker column.
export const ticketOf = (row: string): string => row.slice(4, 13).trimEnd();
export const HINTS =
  "j/k select   tab machines/queue   h/l servers/clients   g/G first/last   L open ticket   q quit";
export const FOOTER = ` ${HINTS}${space(COLUMNS - HINTS.length - 11)}oligarchy `;
export const OPENED = pad(" opened https://linear.app/issue/OLI-61", COLUMNS);

// The Rosé Pine colours the screen is painted in, and the bold attribute bit of a span.
export const TEXT = "#e0def4";
export const SUBTLE = "#908caa";
export const MUTED = "#6e6a86";
export const LOVE = "#eb6f92";
export const GOLD = "#f6c177";
export const PINE = "#31748f";
export const IRIS = "#c4a7e7";
export const BOLD = 1;
export const PLAIN = 0;
