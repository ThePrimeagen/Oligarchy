import {
  Cause,
  Clock,
  Duration,
  Effect,
  Fiber,
  Option,
  type PlatformError,
  Ref,
  Schedule,
  Stream,
  Terminal,
} from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Config from "../config.ts";
import * as Actions from "../db/actions.ts";
import * as Automation from "../db/automation.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Image from "../session/image.ts";
import * as Follow from "./follow.ts";

// The terminal this view is laid out for: a card's header fits its host numbers beside a name
// and a url across 135 columns, with 33 columns left to each of its three graphs, and 37 rows
// hold four cards and sixteen queued jobs. Anything smaller is refused; anything wider goes to
// the graphs, anything taller to the job list.
export const MIN_COLUMNS = 135;
export const MIN_ROWS = 37;

// A card grows a row per job running on it and takes those rows from the queue, which keeps at
// least this many: what runs is on the cards, so the queue mostly shows what waits.
const QUEUE_MIN_ROWS = 4;

// A server writes its row every thirty seconds and a job changes on its own clock; five seconds
// keeps the queue fresh at a handful of small queries a minute.
const REFRESH_SECONDS = 5;
export const REFRESH = Duration.seconds(REFRESH_SECONDS);
// The ages tick between reads; a resize is drawn on the next tick.
export const AGE_TICK = Duration.seconds(1);

// A server writes its row every thirty seconds. One heartbeat may be in flight and one lost to a
// slow database; three overdue is a server that stopped.
export const SILENT_AFTER_MS = 90_000;

// 240 readings of thirty seconds is two hours. A graph holds two readings a column, so a
// terminal would have to be 400 columns wide before its graphs ran out of history.
export const SERIES_SAMPLES = 240;

// Four cards fill the box, fewer when their jobs take the room; j and k bring the rest into
// view one at a time.
export const MAX_CARDS = 4;

// Linear resolves a ticket by its identifier alone and redirects into the workspace.
const LINEAR_ISSUES = "https://linear.app/issue/";

// The desktop's opener, on the Linux boxes viz is watched from. It hands the url to the browser
// and exits 0 at once, exits non-zero when nothing handles it, or, in a bare session, runs the
// browser in its foreground and exits with it: two seconds without an exit is the browser up.
const OPENER = "xdg-open";
const OPEN_WAIT = Duration.seconds(2);

export const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l\x1b[2J";
export const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";

// ---------------------------------------------------------------------------
// Theme: Rosé Pine, as the log's agent colours
// ---------------------------------------------------------------------------

const PALETTE = Render.ROSE_PINE_MAIN;
const BOLD = "\x1b[1m";
const UNBOLD = "\x1b[22m";
const FG_RESET = "\x1b[39m";

const paint = (hex: string, text: string): string => `${Render.foreground(hex)}${text}${FG_RESET}`;
const bold = (text: string): string => `${BOLD}${text}${UNBOLD}`;
const muted = (text: string): string => paint(PALETTE.muted, text);

const channel = (hex: string, shift: number): number =>
  (Number.parseInt(hex.slice(1), 16) >> shift) & 255;

// The colour `t` of the way from one to the other, per channel.
const blend = (from: string, to: string, t: number): string =>
  `#${[16, 8, 0]
    .map((shift) =>
      Math.round(channel(from, shift) + (channel(to, shift) - channel(from, shift)) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

// How hot a percentage is: foam at rest, gold halfway, love flat out. What btop does with its
// cpu gradient, in our palette.
const heat = (percent: number): string => {
  const value = Math.min(100, Math.max(0, percent));
  return value < 50
    ? blend(PALETTE.foam, PALETTE.gold, value / 50)
    : blend(PALETTE.gold, PALETTE.love, (value - 50) / 50);
};

// The queue lists what runs and what waits, so a job's status is one or the other.
const RUNNING = { glyph: "●", color: PALETTE.gold };
const PENDING = { glyph: "◌", color: PALETTE.muted };

// ---------------------------------------------------------------------------
// View: pure
// ---------------------------------------------------------------------------

// One read of the three tables and the local clock when it landed: an age on screen is the
// database's own difference at the read plus the time since.
export type Snapshot = {
  readonly machines: ReadonlyArray<Servers.Machine>;
  readonly series: ReadonlyArray<ProcessStats.Series>;
  readonly queue: Automation.AutomationQueue;
  readonly readAt: number;
};

export type Tab = "servers" | "clients";
type Focus = "machines" | "queue";
type List = Tab | "queue";

// snapshot is absent until the first read lands; failure is the last read's reason, cleared by
// the next good read, so a database outage leaves the last picture up with the reason under it.
// notice is what the last key had to say (the ticket L opened, or why it could not), retired by
// the next key. tab is the kind of machine the cards show; focus is the box j and k move in;
// cursor is each list's selected row (a tab's cards and the jobs on them as one list, the
// queue's jobs as another), kept when the tab or the focus changes and clamped to what the
// newest read lists.
export type View = {
  readonly snapshot: Option.Option<Snapshot>;
  readonly failure: Option.Option<string>;
  readonly notice: Option.Option<string>;
  readonly follow: Option.Option<Follow.Follow>;
  readonly tab: Tab;
  readonly focus: Focus;
  readonly cursor: Readonly<Record<List, number>>;
};

export const initialView: View = {
  snapshot: Option.none(),
  failure: Option.none(),
  notice: Option.none(),
  follow: Option.none(),
  tab: "servers",
  focus: "machines",
  cursor: { servers: 0, clients: 0, queue: 0 },
};

const KIND: Readonly<Record<Tab, Servers.ServerType>> = {
  servers: "qemu",
  clients: "automation-client",
};

const ofTab = (snapshot: Snapshot, tab: Tab): ReadonlyArray<Servers.Machine> =>
  snapshot.machines.filter((machine) => machine.type === KIND[tab]);

type Job = Automation.AutomationJobListRow;

// What runs, then what waits; nothing that is over.
const jobsOf = (snapshot: Snapshot): ReadonlyArray<Job> => [
  ...snapshot.queue.running,
  ...snapshot.queue.pending,
];

// The running jobs a machine is part of: a qemu server hosts a drive's guest, an automation
// client runs the driver of a drive or a diagnose. Placement is by url, the servers table's key.
const jobsOn = (snapshot: Snapshot, machine: Servers.Machine): ReadonlyArray<Job> =>
  snapshot.queue.running.filter(
    (job) => (machine.type === "qemu" ? job.serverUrl : job.clientUrl) === machine.url,
  );

// A row of the machines box the cursor rests on: a card, or the nth job on it.
type Entry = { readonly machine: Servers.Machine; readonly job: Option.Option<number> };

const entriesOf = (snapshot: Snapshot, tab: Tab): ReadonlyArray<Entry> =>
  ofTab(snapshot, tab).flatMap((machine) => [
    { machine, job: Option.none() },
    ...jobsOn(snapshot, machine).map((_, index) => ({ machine, job: Option.some(index) })),
  ]);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const focused = (view: View): List => (view.focus === "machines" ? view.tab : "queue");

// The gold marker's job: a job on a card, or the queue's; none on a card's header.
const selectedJob = (view: View): Option.Option<Job> =>
  Option.flatMap(view.snapshot, (snapshot) => {
    if (view.focus === "queue") {
      const jobs = jobsOf(snapshot);
      return jobs.length === 0
        ? Option.none()
        : Option.some(jobs[clamp(view.cursor.queue, 0, jobs.length - 1)]);
    }
    const entries = entriesOf(snapshot, view.tab);
    if (entries.length === 0) {
      return Option.none();
    }
    const entry = entries[clamp(view.cursor[view.tab], 0, entries.length - 1)];
    return Option.map(entry.job, (index) => jobsOn(snapshot, entry.machine)[index]);
  });

export const tooSmall = (columns: number, rows: number): string =>
  `viz needs a terminal of at least ${String(MIN_COLUMNS)}×${String(MIN_ROWS)} (columns×rows); this one is ${String(columns)}×${String(rows)}`;

const gigabytes = (bytes: number): string => (bytes / 1_000_000_000).toFixed(1);
const percent = (value: number): string => `${value.toFixed(1)}%`;
// Whole megabytes under a gigabyte, tenths of a gigabyte from there.
const size = (bytes: number): string =>
  bytes >= 1_000_000_000 ? `${gigabytes(bytes)} GB` : `${String(Math.round(bytes / 1_000_000))} MB`;

// The unit an operator reads at a glance: seconds under a minute, then whole minutes, hours,
// days. A stamp the database wrote just ahead of the read is 0, never negative.
const age = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${String(seconds)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} h`;
  }
  return `${String(Math.floor(hours / 24))} d`;
};

// A stamp's age against the clock that stamped it plus the time since the read, or a dash for a
// stamp not written yet.
const ago = (stamp: Date | null, queriedAt: Date, drift: number): string =>
  stamp === null ? "—" : `${age(queriedAt.getTime() - stamp.getTime() + drift)} ago`;

// Text from the database (a test's name, a failure's message) can span lines: a control
// character, C1 included (a UTF-8 terminal obeys U+009B as it does ESC [), would break the row
// or steer the terminal, so each is drawn as a space.
const clean = (text: string): string =>
  Array.from(text, (character) =>
    character < " " || (character >= "\u007f" && character <= "\u009f") ? " " : character,
  ).join("");

// Exactly `width` columns: cut with an ellipsis or padded, so a row is as wide as its cells.
const fit = (text: string, width: number): string => {
  const plain = clean(text);
  return plain.length > width ? `${plain.slice(0, width - 1)}…` : plain.padEnd(width);
};

// Text with its colour, so a line of several colours can still be measured and cut.
type Piece = {
  readonly text: string;
  readonly color?: string;
  readonly bold?: true;
};

const render = (pieces: ReadonlyArray<Piece>): string =>
  pieces
    .map((piece) => {
      const painted = piece.color === undefined ? piece.text : paint(piece.color, piece.text);
      return piece.bold === true ? bold(painted) : painted;
    })
    .join("");

// Exactly `width` columns of pieces: the piece that crosses the edge is cut with an ellipsis and
// the rest dropped, or spaces fill what is left.
const clip = (pieces: ReadonlyArray<Piece>, width: number): ReadonlyArray<Piece> => {
  const kept: Array<Piece> = [];
  let used = 0;
  for (const piece of pieces) {
    const text = clean(piece.text);
    if (used + text.length > width) {
      kept.push({ ...piece, text: `${text.slice(0, width - used - 1)}…` });
      used = width;
      break;
    }
    kept.push({ ...piece, text });
    used += text.length;
  }
  if (used < width) {
    kept.push({ text: " ".repeat(width - used) });
  }
  return kept;
};

const label = (text: string): Piece => ({ text, color: PALETTE.subtle });
const value = (text: string): Piece => ({ text, color: PALETTE.text });
const SPACE: Piece = { text: " " };
const GAP: Piece = { text: "  " };

// A run of glyphs, each with its colour, written with a colour change only where the colour
// changes: a graph of a hundred columns is a handful of sequences, not a hundred.
type Cell = { readonly glyph: string; readonly color: string };

const stroke = (cells: ReadonlyArray<Cell>): string => {
  let out = "";
  let current = "";
  for (const cell of cells) {
    if (cell.glyph !== " " && cell.color !== current) {
      out += Render.foreground(cell.color);
      current = cell.color;
    }
    out += cell.glyph;
  }
  return current === "" ? out : `${out}${FG_RESET}`;
};

// btop's braille, five glyphs a row: a column holds two readings side by side, each lit from
// the bottom with up to four dots, and the glyph for a (left, right) pair sits at left * 5 + right.
const BRAILLE = " ⢀⢠⢰⢸⡀⣀⣠⣰⣸⡄⣄⣤⣴⣼⡆⣆⣦⣶⣾⡇⣇⣧⣷⣿";

// Dots lit in one row's band for a reading on the 0–100 scale: none at or below the band, all
// four at or above it, and at least one inside it, so a whisper of load still shows.
const dots = (reading: number, low: number, high: number): number => {
  if (reading >= high) {
    return 4;
  }
  if (reading <= low) {
    return 0;
  }
  return Math.max(1, Math.round(((reading - low) * 4) / (high - low)));
};

// Two rows of braille, `width` columns wide, of at most `2 * width` readings on a 0–100 scale,
// the newest in the right half of the last column and the history running left; the upper row
// is the half above fifty. Each column takes the colour of its higher reading.
const graph = (
  readings: ReadonlyArray<number>,
  width: number,
  color: (reading: number) => string,
): { readonly upper: string; readonly lower: string } => {
  const padded = [...Array.from({ length: 2 * width - readings.length }, () => 0), ...readings];
  const row = (low: number, high: number): string =>
    stroke(
      Array.from({ length: width }, (_, column) => {
        const left = padded[2 * column];
        const right = padded[2 * column + 1];
        return {
          glyph: BRAILLE[dots(left, low, high) * 5 + dots(right, low, high)],
          color: color(Math.max(left, right)),
        };
      }),
    );
  return { upper: row(50, 100), lower: row(0, 50) };
};

// btop's meter: sixteen blocks, the lit ones warming from left to right, the rest muted.
const METER_WIDTH = 16;

const meter = (fraction: number): ReadonlyArray<Piece> => {
  const lit = Math.round(clamp(fraction, 0, 1) * METER_WIDTH);
  const blocks = Array.from({ length: lit }, (_, index): Piece => ({
    text: "■",
    color: heat(((index + 1) * 100) / METER_WIDTH),
  }));
  return lit === METER_WIDTH
    ? blocks
    : [...blocks, { text: "■".repeat(METER_WIDTH - lit), color: PALETTE.muted }];
};

// The three graphs of a card: cpu on its own scale and by heat, memory and jobs against the
// highest reading in view, as btop scales its network graph; memory is mostly a flat block, so
// it takes the calm colour and jobs the accent.
type Metric = {
  readonly label: string;
  readonly current: (sample: ProcessStats.Sample) => string;
  readonly scaled: (samples: ReadonlyArray<ProcessStats.Sample>) => ReadonlyArray<number>;
  readonly color: (reading: number) => string;
};

const relative =
  (pick: (sample: ProcessStats.Sample) => number) =>
  (samples: ReadonlyArray<ProcessStats.Sample>): ReadonlyArray<number> => {
    const peak = Math.max(1, ...samples.map(pick));
    return samples.map((sample) => (pick(sample) * 100) / peak);
  };

const METRICS: ReadonlyArray<Metric> = [
  {
    label: "cpu",
    current: (sample) => percent(sample.cpuPercent),
    scaled: (samples) => samples.map((sample) => sample.cpuPercent),
    color: heat,
  },
  {
    label: "mem",
    current: (sample) => size(sample.memoryBytes),
    scaled: relative((sample) => sample.memoryBytes),
    color: () => PALETTE.pine,
  },
  {
    label: "jobs",
    current: (sample) => String(sample.jobs),
    scaled: relative((sample) => sample.jobs),
    color: () => PALETTE.iris,
  },
];

// A label or a value column, then a space, then a graph: three of those and two gaps between.
const LABEL_WIDTH = 8;
const GRAPHS_FIXED = 3 * (LABEL_WIDTH + 1) + 2 * GAP.text.length;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// Every row is a box row: a muted border, a space, `columns - 4` of content, a space, a border.
const boxed = (content: string): string => `${muted("│")} ${content} ${muted("│")}`;
const divider = (columns: number): string => muted(`├${"─".repeat(columns - 2)}┤`);
const bottom = (columns: number, note: Option.Option<string>): string =>
  Option.match(note, {
    onNone: () => muted(`╰${"─".repeat(columns - 2)}╯`),
    onSome: (text) => muted(`╰${"─".repeat(columns - 7 - text.length)}┤ ${text} ├─╯`),
  });

// The machines box's top border carries the two tabs, the active one lit, and how old the read is.
const tabsRow = (view: View, now: number, columns: number): string => {
  const count = (tab: Tab): string =>
    Option.match(view.snapshot, {
      onNone: () => "",
      onSome: (snapshot) => ` · ${String(ofTab(snapshot, tab).length)}`,
    });
  const tab = (name: Tab, text: string): string =>
    view.tab === name ? bold(paint(PALETTE.text, text)) : muted(text);
  const servers = `qemu servers${count("servers")}`;
  const clients = `automation clients${count("clients")}`;
  const status = Option.match(view.snapshot, {
    onNone: () => "reading…",
    onSome: (snapshot) => `read ${age(now - snapshot.readAt)} ago`,
  });
  const fill = "─".repeat(columns - 17 - servers.length - clients.length - status.length);
  return `${muted("╭─┤ ")}${tab("servers", servers)}${muted(" ├─┤ ")}${tab("clients", clients)}${muted(` ├${fill}┤ `)}${muted(status)}${muted(" ├─╮")}`;
};

// The selected row's marker: gold in the box that has the focus, muted in the other, so both
// selections stay in view and the one j and k move is told apart. A space where nothing is
// selected keeps the columns.
const marker = (selected: boolean, hasFocus: boolean): Piece =>
  selected ? { text: "▸", color: hasFocus ? PALETTE.gold : PALETTE.muted } : SPACE;

// ---------------------------------------------------------------------------
// Job list: the one way a job is drawn, on a card and in the queue
// ---------------------------------------------------------------------------

// A job row: the marker column and a space, six columns with a gap between each, and the rest
// of the row blank. A live job has no finish and no reason yet, so neither has a column.
const MARKER_WIDTH = 2;
const JOB_WIDTHS = { ticket: 9, test: 18, action: 9, status: 12, queued: 11, started: 11 };
const JOB_WIDTH =
  MARKER_WIDTH +
  Object.values(JOB_WIDTHS).reduce((total, width) => total + width, 0) +
  (Object.keys(JOB_WIDTHS).length - 1) * GAP.text.length;

const jobHeader = (usable: number): string =>
  paint(
    PALETTE.subtle,
    `${" ".repeat(MARKER_WIDTH)}${[
      fit("ticket", JOB_WIDTHS.ticket),
      fit("test", JOB_WIDTHS.test),
      fit("action", JOB_WIDTHS.action),
      fit("status", JOB_WIDTHS.status),
      fit("queued", JOB_WIDTHS.queued),
      fit("started", JOB_WIDTHS.started),
    ].join(GAP.text)}${" ".repeat(usable - JOB_WIDTH)}`,
  );

// The columns are the same for every job, so a pending one shows a dash where its start will
// go; the status carries its glyph and colour.
const jobRow = (job: Job, selected: Piece, drift: number, usable: number): string => {
  const status = job.status === "running" ? RUNNING : PENDING;
  const columns = [
    paint(PALETTE.text, fit(job.ticket ?? "—", JOB_WIDTHS.ticket)),
    paint(PALETTE.text, fit(job.test, JOB_WIDTHS.test)),
    paint(PALETTE.subtle, fit(job.action, JOB_WIDTHS.action)),
    paint(status.color, fit(`${status.glyph} ${job.status}`, JOB_WIDTHS.status)),
    paint(PALETTE.subtle, fit(ago(job.createdAt, job.queriedAt, drift), JOB_WIDTHS.queued)),
    paint(PALETTE.subtle, fit(ago(job.startedAt, job.queriedAt, drift), JOB_WIDTHS.started)),
  ];
  return `${render([selected, SPACE])}${columns.join(GAP.text)}${" ".repeat(usable - JOB_WIDTH)}`;
};

const jobList = (
  jobs: ReadonlyArray<Job>,
  selected: Option.Option<number>,
  hasFocus: boolean,
  drift: number,
  usable: number,
): ReadonlyArray<string> =>
  jobs.map((job, index) =>
    boxed(jobRow(job, marker(Option.contains(selected, index), hasFocus), drift, usable)),
  );

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

// A card's first row: the marker and the machine's name and url on the left, cut to what the
// right leaves; on the right what its heartbeat says, or the one phrase that says it stopped.
// stats and heartbeat_at are written together, so either being null is a row no server claimed.
const cardHeader = (
  machine: Servers.Machine,
  selected: Piece,
  silent: boolean,
  drift: number,
  usable: number,
): string => {
  const left: ReadonlyArray<Piece> = [
    selected,
    SPACE,
    { text: machine.name ?? "—", color: PALETTE.text, bold: true },
    { text: " · ", color: PALETTE.muted },
    { text: machine.url, color: PALETTE.subtle },
  ];
  const right = (): ReadonlyArray<Piece> => {
    if (machine.stats === null || machine.heartbeatAt === null) {
      return [{ text: "never heard from", color: PALETTE.muted }];
    }
    const seen = `${age(machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift)} ago`;
    if (silent) {
      return [{ text: `silent · seen ${seen}`, color: PALETTE.love }];
    }
    const { qemus, cpu, memory } = machine.stats;
    const qemusPieces: ReadonlyArray<Piece> =
      machine.type === "qemu" ? [label("qemus"), SPACE, value(String(qemus)), GAP] : [];
    return [
      ...qemusPieces,
      label("host cpu"),
      SPACE,
      value(percent(cpu.mean1m)),
      GAP,
      label("host mem"),
      SPACE,
      ...meter(memory.usedBytes / memory.totalBytes),
      SPACE,
      value(`${gigabytes(memory.usedBytes)} / ${gigabytes(memory.totalBytes)} GB`),
      GAP,
      label("seen"),
      SPACE,
      value(seen),
    ];
  };
  const said = right();
  const saidWidth = said.reduce((total, piece) => total + piece.text.length, 0);
  return `${render(clip(left, usable - saidWidth - GAP.text.length))}${GAP.text}${render(said)}`;
};

// A card's two graph rows: labels above, the newest readings below, a graph beside each of the
// readings that fit, scaled among themselves. A silent machine's history is drawn in muted, its
// numbers too.
const cardGraphs = (
  series: Option.Option<ProcessStats.Series>,
  silent: boolean,
  usable: number,
): { readonly upper: string; readonly lower: string } => {
  const width = Math.floor((usable - GRAPHS_FIXED) / 3);
  const rest = " ".repeat(usable - GRAPHS_FIXED - 3 * width);
  const samples = Option.match(series, {
    onNone: (): ReadonlyArray<ProcessStats.Sample> => [],
    onSome: (found) => found.samples.slice(-2 * width),
  });
  const newest = samples.at(-1);
  const sections = METRICS.map((metric) => {
    const drawn = graph(metric.scaled(samples), width, silent ? () => PALETTE.muted : metric.color);
    const current = (newest === undefined ? "—" : metric.current(newest)).padStart(LABEL_WIDTH);
    return {
      upper: `${paint(PALETTE.subtle, metric.label.padEnd(LABEL_WIDTH))} ${drawn.upper}`,
      lower: `${silent ? muted(current) : bold(paint(PALETTE.text, current))} ${drawn.lower}`,
    };
  });
  return {
    upper: `${sections.map((section) => section.upper).join(GAP.text)}${rest}`,
    lower: `${sections.map((section) => section.lower).join(GAP.text)}${rest}`,
  };
};

const card = (
  machine: Servers.Machine,
  series: Option.Option<ProcessStats.Series>,
  jobs: ReadonlyArray<Job>,
  header: Piece,
  job: Option.Option<number>,
  hasFocus: boolean,
  drift: number,
  usable: number,
): ReadonlyArray<string> => {
  const silent =
    machine.heartbeatAt !== null &&
    machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift > SILENT_AFTER_MS;
  const graphs = cardGraphs(series, silent, usable);
  return [
    boxed(cardHeader(machine, header, silent, drift, usable)),
    boxed(graphs.upper),
    boxed(graphs.lower),
    ...jobList(jobs, job, hasFocus, drift, usable),
  ];
};

// The machines box: the tabs, then the cards of the active tab around the selected one, at most
// MAX_CARDS and as many as fit with the queue keeping its rows, dividers between them, and the
// window's place in the list on the bottom border when there is more than fits. The window
// grows upward from the selected card first, so a step down scrolls one card, and downward with
// what room is left. A tab with nothing says so in one row.
const machinesBox = (
  view: View,
  now: number,
  columns: number,
  rows: number,
): ReadonlyArray<string> => {
  const usable = columns - 4;
  const lines: Array<string> = [tabsRow(view, now, columns)];
  if (Option.isNone(view.snapshot)) {
    return [...lines, boxed(" ".repeat(usable)), bottom(columns, Option.none())];
  }
  const snapshot = view.snapshot.value;
  const listed = ofTab(snapshot, view.tab);
  if (listed.length === 0) {
    const kind = view.tab === "servers" ? "qemu servers" : "automation clients";
    return [
      ...lines,
      boxed(muted(fit(`no ${kind} registered`, usable))),
      bottom(columns, Option.none()),
    ];
  }
  const drift = now - snapshot.readAt;
  const entries = entriesOf(snapshot, view.tab);
  const selected = entries[clamp(view.cursor[view.tab], 0, entries.length - 1)];
  const chosen = listed.indexOf(selected.machine);
  // The rows the cards and their dividers may take: the footer, the queue's frame with its
  // minimum of rows, and this box's own borders come off the terminal's height.
  const available = rows - 1 - (QUEUE_MIN_ROWS + 3) - 2;
  // A machine running more jobs than the box has rows shows the ones that fit; on the selected
  // card the window ends at the selected job, so what L opens is on screen.
  const room = available - 3;
  const windowOf = (
    index: number,
  ): { readonly jobs: ReadonlyArray<Job>; readonly from: number } => {
    const from =
      index === chosen ? Math.max(0, Option.getOrElse(selected.job, () => 0) - (room - 1)) : 0;
    return { jobs: jobsOn(snapshot, listed[index]).slice(from, from + room), from };
  };
  const height = (index: number): number => 3 + windowOf(index).jobs.length;
  let first = chosen;
  let last = chosen;
  let used = height(chosen);
  while (first > 0 && last - first + 1 < MAX_CARDS && used + 1 + height(first - 1) <= available) {
    first -= 1;
    used += 1 + height(first);
  }
  while (
    last + 1 < listed.length &&
    last - first + 1 < MAX_CARDS &&
    used + 1 + height(last + 1) <= available
  ) {
    last += 1;
    used += 1 + height(last);
  }
  const hasFocus = view.focus === "machines";
  for (let index = first; index <= last; index += 1) {
    if (index > first) {
      lines.push(divider(columns));
    }
    const machine = listed[index];
    const series = Option.fromUndefinedOr(
      snapshot.series.find((found) => found.type === machine.type && found.name === machine.name),
    );
    const { jobs, from } = windowOf(index);
    const own = index === chosen;
    const header = marker(own && Option.isNone(selected.job), hasFocus);
    const job = own ? Option.map(selected.job, (at) => at - from) : Option.none<number>();
    lines.push(...card(machine, series, jobs, header, job, hasFocus, drift, usable));
  }
  const place =
    last - first + 1 < listed.length
      ? Option.some(`${String(first + 1)}-${String(last + 1)} of ${String(listed.length)}`)
      : Option.none();
  return [...lines, bottom(columns, place)];
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

// The queue box fills every row the cards leave above the footer: its title counts what runs and
// waits, the jobs come running then pending with the selected one in view, and the bottom border
// says where the window sits in the list when they do not all fit.
const queueBox = (
  view: View,
  now: number,
  columns: number,
  height: number,
): ReadonlyArray<string> => {
  const usable = columns - 4;
  const blank = boxed(" ".repeat(usable));
  const title = bold(paint(PALETTE.text, "automation"));
  const top = (detail: string): string =>
    `${muted("╭─┤ ")}${title}${paint(PALETTE.subtle, detail)}${muted(` ├${"─".repeat(columns - 17 - detail.length)}╮`)}`;
  const room = height - 3;
  if (Option.isNone(view.snapshot)) {
    return [
      top(""),
      boxed(jobHeader(usable)),
      ...Array.from({ length: room }, () => blank),
      bottom(columns, Option.none()),
    ];
  }
  const snapshot = view.snapshot.value;
  const { queue } = snapshot;
  const drift = now - snapshot.readAt;
  const jobs = jobsOf(snapshot);
  const cursor = clamp(view.cursor.queue, 0, Math.max(0, jobs.length - 1));
  // The selection is never below the window: the window starts room - 1 above it at most.
  const first = Math.max(0, cursor - (room - 1));
  const shown = jobs.slice(first, first + room);
  const listed =
    jobs.length === 0
      ? [boxed(muted(fit("no jobs", usable)))]
      : jobList(shown, Option.some(cursor - first), view.focus === "queue", drift, usable);
  const place =
    jobs.length > room
      ? Option.some(
          `${String(first + 1)}-${String(first + shown.length)} of ${String(jobs.length)}`,
        )
      : Option.none<string>();
  return [
    top(` · running ${String(queue.running.length)} · pending ${String(queue.pending.length)}`),
    boxed(jobHeader(usable)),
    ...listed,
    ...Array.from({ length: room - listed.length }, () => blank),
    bottom(columns, place),
  ];
};

const HINTS: ReadonlyArray<readonly [key: string, does: string]> = [
  ["j/k", "select"],
  ["tab", "machines/queue"],
  ["h/l", "servers/clients"],
  ["g/G", "first/last"],
  ["L", "open ticket"],
  ["F", "follow"],
  ["q", "quit"],
];

// The last row: the reason the last read failed, else what the last key had to say, else the
// keys.
const footer = (view: View, columns: number): string => {
  if (Option.isSome(view.failure)) {
    return paint(PALETTE.love, fit(` error: ${view.failure.value}`, columns));
  }
  if (Option.isSome(view.notice)) {
    return paint(PALETTE.gold, fit(` ${view.notice.value}`, columns));
  }
  const plain = HINTS.map(([key, does]) => `${key} ${does}`).join("   ");
  const keys = HINTS.map(([key, does]) => `${paint(PALETTE.text, key)}${muted(` ${does}`)}`).join(
    muted("   "),
  );
  const name = "oligarchy";
  return ` ${keys}${" ".repeat(columns - plain.length - name.length - 2)}${muted(name)} `;
};

// Every row is written over in full at the terminal's width with an absolute move and never a
// newline, so the screen never scrolls and a frame needs no clear. The cards' box is as tall as
// its cards and the queue's box takes every other row above the footer, so the queue grows with
// the terminal. A terminal that shrank below the minimum gets the one sentence saying so until
// it grows back.
export const draw = (view: View, now: number, columns: number, rows: number): string => {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return `\x1b[2J\x1b[1;1H${paint(PALETTE.love, tooSmall(columns, rows))}`;
  }
  if (Option.isSome(view.follow) && view.follow.value._tag === "full") {
    return Follow.drawFull(view.follow.value, columns, rows);
  }
  const machines = machinesBox(view, now, columns, rows);
  const lines = [
    ...machines,
    ...queueBox(view, now, columns, rows - 1 - machines.length),
    footer(view, columns),
  ];
  if (Option.isSome(view.follow) && view.follow.value._tag === "peek") {
    const peek = Follow.drawPeek(view.follow.value, now, columns);
    const start = lines.length - 1 - peek.lines.length;
    peek.lines.forEach((line, index) => {
      lines[start + index] = line;
    });
  }
  return lines.map((line, index) => `\x1b[${String(index + 1)};1H${line}`).join("");
};

export const drawFollowImage = (view: View, columns: number, rows: number): string =>
  Option.match(view.follow, {
    onNone: () => "",
    onSome: (follow) =>
      follow._tag === "full"
        ? Follow.drawFullImage(follow, columns, rows)
        : Follow.drawPeekImage(follow, columns, rows - 4),
  });

// A running job with a session can be followed; anything else is a sentence for the footer.
export const followError = (job: Option.Option<Job>): Option.Option<string> =>
  Option.match(job, {
    onNone: () => Option.some("no job selected"),
    onSome: (found) => {
      if (found.status !== "running") {
        return Option.some("follow needs a running job");
      }
      if (found.sessionId === null) {
        return Option.some("the selected job has no session");
      }
      return Option.none();
    },
  });

// readline reports a capital L as l with shift.
const isOpen = (input: Terminal.UserInput): boolean => input.key.shift && input.key.name === "l";

const isFollow = (input: Terminal.UserInput): boolean => input.key.name === "f";

// Every key retires the last notice. L and F move nothing here: opening the ticket or follow
// is the runner's. A peek closes on any other key so the board stays walkable.
export const press = (view: View, input: Terminal.UserInput): View => {
  const retired: View = { ...view, notice: Option.none() };
  if (isOpen(input) || isFollow(input)) {
    return retired;
  }
  if (input.key.name === "escape") {
    return { ...retired, follow: Option.none() };
  }
  const closed: View =
    Option.isSome(view.follow) && view.follow.value._tag === "peek"
      ? { ...retired, follow: Option.none() }
      : retired;
  const list = focused(view);
  const count = Option.match(view.snapshot, {
    onNone: () => 0,
    onSome: (snapshot) =>
      list === "queue" ? jobsOf(snapshot).length : entriesOf(snapshot, list).length,
  });
  const last = Math.max(0, count - 1);
  // The row on screen, not the number stored: a list that shrank since leaves the number past
  // the end, and a step must start from what is selected.
  const current = clamp(view.cursor[list], 0, last);
  const select = (cursor: number): View => ({
    ...closed,
    cursor: { ...view.cursor, [list]: clamp(cursor, 0, last) },
  });
  switch (input.key.name) {
    case "j":
    case "down":
      return select(current + 1);
    case "k":
    case "up":
      return select(current - 1);
    case "g":
      return select(input.key.shift ? last : 0);
    case "tab":
      return { ...closed, focus: view.focus === "machines" ? "queue" : "machines" };
    case "h":
    case "l":
    case "left":
    case "right":
      return { ...closed, tab: view.tab === "servers" ? "clients" : "servers" };
    default:
      return closed;
  }
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const isQuit = (input: Terminal.UserInput): boolean =>
  input.key.name === "q" && !input.key.ctrl && !input.key.meta;

// Hands the ticket's url to the opener and says what came of it. The browser is the desktop's:
// it gets the desktop's environment, none of this screen's stdio, its own process group, and
// the handle is unreferenced, so neither the bound nor q closing the scope kills it.
const openTicket = (
  ticket: string,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const url = `${LINEAR_ISSUES}${ticket}`;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(OPENER, [url], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        extendEnv: true,
        detached: true,
      }),
    );
    // The re-ref it hands back is never wanted: the browser is not ours to wait for.
    yield* Effect.asVoid(handle.unref);
    const code = yield* handle.exitCode.pipe(
      Effect.timeoutOrElse({ duration: OPEN_WAIT, orElse: () => Effect.succeed(0) }),
    );
    return code === 0 ? `opened ${url}` : `${OPENER} exited ${String(code)}`;
  }).pipe(
    Effect.scoped,
    // Node's own message (`spawn xdg-open ENOENT`) behind the platform wrapper, else the wrapper's.
    Effect.catchTag("PlatformError", (error) =>
      Effect.succeed(
        `${OPENER}: ${ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error))}`,
      ),
    ),
  );

// Owns the alternate screen while it runs: the tables are read at once and every REFRESH, the
// ages repainted every AGE_TICK at whatever size the terminal has by then, every other key
// repainted as it lands, L opening the selected job's ticket first, and q or the input ending
// (ctrl-c, in raw mode) hands the screen back. A read that fails leaves the last picture up with
// its reason on the footer; a frame stdout refuses ends the run with that failure.
export const run: Effect.Effect<
  void,
  PlatformError.PlatformError,
  | Terminal.Terminal
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Automation.AutomationStore
  | Actions.ActionStore
> = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal;
  const servers = yield* Servers.ServerStore;
  const processStats = yield* ProcessStats.ProcessStatsStore;
  const automation = yield* Automation.AutomationStore;
  const view = yield* Ref.make(initialView);
  const followFiber = yield* Ref.make(Option.none<Fiber.Fiber<unknown, unknown>>());
  const paintScreen = Effect.gen(function* () {
    const current = yield* Ref.get(view);
    const now = yield* Clock.currentTimeMillis;
    const columns = yield* terminal.columns;
    const rows = yield* terminal.rows;
    yield* terminal.display(
      draw(current, now, columns, rows) + drawFollowImage(current, columns, rows),
    );
  });
  const setNotice = (text: string) =>
    Ref.update(view, (current) => ({ ...current, notice: Option.some(text) }));
  const stopFollow = Effect.gen(function* () {
    const running = yield* Ref.getAndSet(followFiber, Option.none());
    if (Option.isSome(running)) {
      yield* Fiber.interrupt(running.value);
    }
    yield* terminal.display(Image.clearImages);
  });
  const expandFollow = (peek: Follow.Peek) =>
    Effect.gen(function* () {
      const serverUrl = Option.getOrNull(peek.serverUrl);
      if (serverUrl === null) {
        yield* setNotice("follow needs a qemu server");
        return;
      }
      const token = yield* Config.oligarchyToken.pipe(
        Effect.catchTag("MissingVariable", (error) =>
          setNotice(error.message).pipe(Effect.as(null)),
        ),
      );
      if (token === null) {
        return;
      }
      const proxy = yield* ProxyClient.connect({ serverUrl, token });
      const bytes = yield* proxy.follow(peek.sessionId);
      const opened = Follow.expand(peek, serverUrl);
      yield* Ref.update(view, (current) => ({
        ...current,
        follow: Option.some(opened),
        notice: Option.none(),
      }));
      const fiber = yield* Effect.forkScoped(
        Stream.splitLines(Stream.decodeText(bytes)).pipe(
          Stream.runForEach((line) =>
            Effect.gen(function* () {
              const event = yield* Domain.decodeFollowLine(line).pipe(Effect.orDie);
              yield* Ref.update(view, (current) => ({
                ...current,
                follow: Option.map(current.follow, (follow) =>
                  follow._tag === "full" ? Follow.apply(follow, event) : follow,
                ),
              }));
              yield* paintScreen;
            }),
          ),
        ),
      );
      yield* Ref.set(followFiber, Option.some(fiber));
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : setNotice(Render.headline(Cause.squash(cause))),
      ),
    );
  const openFollow = Effect.gen(function* () {
    const current = yield* Ref.get(view);
    if (Option.isSome(current.follow) && current.follow.value._tag === "full") {
      return;
    }
    if (Option.isSome(current.follow) && current.follow.value._tag === "peek") {
      yield* expandFollow(current.follow.value);
      return;
    }
    const job = selectedJob(current);
    const refused = followError(job);
    if (Option.isSome(refused)) {
      yield* setNotice(refused.value);
      return;
    }
    const found = Option.getOrThrow(job);
    const sessionId = found.sessionId;
    if (sessionId === null) {
      yield* setNotice("the selected job has no session");
      return;
    }
    const peek = yield* Follow.loadPeek(found.ticket ?? "—", sessionId, found.serverUrl);
    yield* Ref.update(view, (latest) => ({
      ...latest,
      follow: Option.some(peek),
      notice: Option.none(),
    }));
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : setNotice(Render.headline(Cause.squash(cause))),
    ),
  );
  const read = Effect.gen(function* () {
    // Taken before the queries, so an age counts from before its row was read, never after: a
    // slow read leans towards silent, not live.
    const readAt = yield* Clock.currentTimeMillis;
    const machines = yield* servers.listMachines();
    const series = yield* processStats.listSeries(SERIES_SAMPLES);
    // No completed jobs: the screen shows what runs and what waits.
    const queue = yield* automation.listJobs(0);
    yield* Ref.update(view, (current) => ({
      ...current,
      snapshot: Option.some({ machines, series, queue, readAt }),
      failure: Option.none(),
    }));
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Ref.update(view, (current) => ({
            ...current,
            failure: Option.some(Render.headline(Cause.squash(cause))),
          })),
    ),
  );
  // L's notice lands after press retired the last one, so it is what the frame shows.
  const open = Effect.gen(function* () {
    const current = yield* Ref.get(view);
    const notice = yield* Option.match(selectedJob(current), {
      onNone: () => Effect.succeed("no job selected"),
      onSome: (job) =>
        job.ticket === null
          ? Effect.succeed("the selected job has no ticket")
          : openTicket(job.ticket),
    });
    yield* Ref.update(view, (latest) => ({ ...latest, notice: Option.some(notice) }));
  });
  const keys = Effect.gen(function* () {
    const input = yield* terminal.readInput;
    yield* Stream.fromQueue(input).pipe(
      Stream.takeWhile((key) => !isQuit(key)),
      Stream.runForEach((key) =>
        Effect.gen(function* () {
          const before = yield* Ref.get(view);
          yield* Ref.update(view, (current) => press(current, key));
          const after = yield* Ref.get(view);
          if (Option.isSome(before.follow) && Option.isNone(after.follow)) {
            yield* stopFollow;
          }
          if (isOpen(key)) {
            yield* open;
          }
          if (isFollow(key)) {
            yield* openFollow;
          }
          yield* paintScreen;
        }),
      ),
    );
  });
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(terminal.display(ENTER_SCREEN), () =>
        // A stdout that refused a frame refuses the restore too; there is nowhere left to say so.
        Effect.ignore(terminal.display(LEAVE_SCREEN)),
      );
      yield* Effect.raceFirst(
        keys,
        Effect.raceFirst(
          Effect.repeat(Effect.andThen(read, paintScreen), Schedule.spaced(REFRESH)),
          Effect.raceFirst(
            Effect.schedule(paintScreen, Schedule.spaced(AGE_TICK)),
            Effect.schedule(
              Ref.update(view, (current) => ({
                ...current,
                follow: Option.map(current.follow, (follow) =>
                  follow._tag === "full" ? Follow.tick(follow) : follow,
                ),
              })).pipe(
                Effect.andThen(
                  Effect.flatMap(Ref.get(view), (current) =>
                    Option.isSome(current.follow) && current.follow.value._tag === "full"
                      ? paintScreen
                      : Effect.void,
                  ),
                ),
              ),
              Schedule.spaced("80 millis"),
            ),
          ),
        ),
      );
    }),
  );
});
