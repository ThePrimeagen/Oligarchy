import { Duration, Option } from "effect";
import type * as Automation from "../db/automation.ts";
import type * as ProcessStats from "../db/process-stats.ts";
import type * as Servers from "../db/servers.ts";
import * as Render from "../observability/render.ts";

// The terminal this view is laid out for: a card's header fits its host numbers beside a name
// and a url across 135 columns, with 33 columns left to each of its three graphs, and 37 rows
// hold the tabs, four cards and fifteen queued jobs. Anything smaller is refused; anything wider
// goes to the graphs, anything taller to the job list.
export const MIN_COLUMNS = 135;
export const MIN_ROWS = 37;

// A card grows a row per job running on it and takes those rows from the queue, which keeps at
// least this many: what runs is on the cards, so the queue mostly shows what waits.
const QUEUE_MIN_ROWS = 4;

// A server writes its row every thirty seconds and a job changes on its own clock; five seconds
// keeps the queue fresh at a handful of small queries a minute.
export const REFRESH = Duration.seconds(5);
// The ages tick between reads.
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

// ---------------------------------------------------------------------------
// Theme: Rosé Pine, as the log's agent colours
// ---------------------------------------------------------------------------

export const PALETTE = Render.ROSE_PINE_MAIN;

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
// State
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
  readonly tab: Tab;
  readonly focus: Focus;
  readonly cursor: Readonly<Record<List, number>>;
};

export const initialView: View = {
  snapshot: Option.none(),
  failure: Option.none(),
  notice: Option.none(),
  tab: "servers",
  focus: "machines",
  cursor: { servers: 0, clients: 0, queue: 0 },
};

// A key as OpenTUI's parser reports it: a capital letter is its lowercase name with shift.
export type Key = {
  readonly name: string;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
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
export const selectedJob = (view: View): Option.Option<Job> =>
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

// A capital L: the parser reports it as l with shift.
export const isOpen = (key: Key): boolean => key.shift && key.name === "l";

// q, or ctrl-c, which raw mode delivers as a key rather than a signal.
export const isQuit = (key: Key): boolean =>
  (key.name === "q" && !key.ctrl && !key.meta) || (key.name === "c" && key.ctrl);

// Every key retires the last notice. L moves nothing here: opening the ticket is the runner's.
export const press = (view: View, key: Key): View => {
  const retired: View = { ...view, notice: Option.none() };
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
    ...retired,
    cursor: { ...view.cursor, [list]: clamp(cursor, 0, last) },
  });
  if (isOpen(key)) {
    return retired;
  }
  switch (key.name) {
    case "j":
    case "down":
      return select(current + 1);
    case "k":
    case "up":
      return select(current - 1);
    case "g":
      return select(key.shift ? last : 0);
    case "tab":
      return { ...retired, focus: view.focus === "machines" ? "queue" : "machines" };
    case "h":
    case "l":
    case "left":
    case "right":
      return { ...retired, tab: view.tab === "servers" ? "clients" : "servers" };
    default:
      return retired;
  }
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

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

// At most `width` columns, cut with an ellipsis.
const cut = (text: string, width: number): string => {
  const plain = clean(text);
  return plain.length > width ? `${plain.slice(0, width - 1)}…` : plain;
};

// Exactly `width` columns: cut or padded, so a column is as wide as its neighbours.
const fit = (text: string, width: number): string => cut(text, width).padEnd(width);

// Text with its colour, so a line of several colours can still be measured and cut; a piece
// without a colour is blank, drawn in whatever the row inherits.
export type Piece = {
  readonly text: string;
  readonly color?: string;
  readonly bold?: true;
};
export type Row = ReadonlyArray<Piece>;

// Exactly `width` columns of pieces: the piece that crosses the edge is cut with an ellipsis and
// the rest dropped, or spaces fill what is left.
const clip = (pieces: Row, width: number): Row => {
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

const paint = (color: string, text: string): Piece => ({ text, color });
const muted = (text: string): Piece => paint(PALETTE.muted, text);
const label = (text: string): Piece => paint(PALETTE.subtle, text);
const value = (text: string): Piece => paint(PALETTE.text, text);
const strong = (text: string): Piece => ({ text, color: PALETTE.text, bold: true });
const SPACE: Piece = { text: " " };
const GAP: Piece = { text: "  " };

// A run of glyphs, each with its colour, as pieces that change only where the colour changes: a
// graph of a hundred columns is a handful of pieces, not a hundred. Blanks carry no colour.
type Cell = { readonly glyph: string; readonly color: string };

const stroke = (cells: ReadonlyArray<Cell>): Row => {
  const pieces: Array<Piece> = [];
  for (const cell of cells) {
    const color = cell.glyph === " " ? undefined : cell.color;
    const last = pieces.at(-1);
    if (last !== undefined && last.color === color) {
      pieces[pieces.length - 1] = { ...last, text: last.text + cell.glyph };
    } else {
      pieces.push(color === undefined ? { text: cell.glyph } : { text: cell.glyph, color });
    }
  }
  return pieces;
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
): { readonly upper: Row; readonly lower: Row } => {
  const padded = [...Array.from({ length: 2 * width - readings.length }, () => 0), ...readings];
  const row = (low: number, high: number): Row =>
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

const meter = (fraction: number): Row => {
  const lit = Math.round(clamp(fraction, 0, 1) * METER_WIDTH);
  const blocks = Array.from({ length: lit }, (_, index): Piece => ({
    text: "■",
    color: heat(((index + 1) * 100) / METER_WIDTH),
  }));
  return lit === METER_WIDTH ? blocks : [...blocks, muted("■".repeat(METER_WIDTH - lit))];
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

// The selected row's marker: gold in the box that has the focus, muted in the other, so both
// selections stay in view and the one j and k move is told apart. A space where nothing is
// selected keeps the columns.
const marker = (selected: boolean, hasFocus: boolean): Piece =>
  selected ? { text: "▸", color: hasFocus ? PALETTE.gold : PALETTE.muted } : SPACE;

// The first row of the machines box: the two tabs, the active one lit, counted once read.
const tabsRow = (view: View): Row => {
  const count = (tab: Tab): string =>
    Option.match(view.snapshot, {
      onNone: () => "",
      onSome: (snapshot) => ` · ${String(ofTab(snapshot, tab).length)}`,
    });
  const tab = (name: Tab, text: string): Piece => (view.tab === name ? strong(text) : muted(text));
  return [
    tab("servers", `qemu servers${count("servers")}`),
    muted(" │ "),
    tab("clients", `automation clients${count("clients")}`),
  ];
};

// A job row: the marker column and a space, then six columns with a gap between each. A live
// job has no finish and no reason yet, so neither has a column.
const JOB_WIDTHS = { ticket: 9, test: 18, action: 9, status: 12, queued: 11, started: 11 };

const jobHeader: Row = [
  label(
    `  ${[
      fit("ticket", JOB_WIDTHS.ticket),
      fit("test", JOB_WIDTHS.test),
      fit("action", JOB_WIDTHS.action),
      fit("status", JOB_WIDTHS.status),
      fit("queued", JOB_WIDTHS.queued),
      fit("started", JOB_WIDTHS.started),
    ].join(GAP.text)}`,
  ),
];

// The columns are the same for every job, so a pending one shows a dash where its start will
// go; the status carries its glyph and colour.
const jobRow = (job: Job, selected: Piece, drift: number): Row => {
  const status = job.status === "running" ? RUNNING : PENDING;
  return [
    selected,
    SPACE,
    value(fit(job.ticket ?? "—", JOB_WIDTHS.ticket)),
    GAP,
    value(fit(job.test, JOB_WIDTHS.test)),
    GAP,
    label(fit(job.action, JOB_WIDTHS.action)),
    GAP,
    paint(status.color, fit(`${status.glyph} ${job.status}`, JOB_WIDTHS.status)),
    GAP,
    label(fit(ago(job.createdAt, job.queriedAt, drift), JOB_WIDTHS.queued)),
    GAP,
    label(fit(ago(job.startedAt, job.queriedAt, drift), JOB_WIDTHS.started)),
  ];
};

const jobList = (
  jobs: ReadonlyArray<Job>,
  selected: Option.Option<number>,
  hasFocus: boolean,
  drift: number,
): ReadonlyArray<Row> =>
  jobs.map((job, index) => jobRow(job, marker(Option.contains(selected, index), hasFocus), drift));

// A card's first row: the marker and the machine's name and url on the left, cut to what the
// right leaves; on the right what its heartbeat says, or the one phrase that says it stopped.
// stats and heartbeat_at are written together, so either being null is a row no server claimed.
const cardHeader = (
  machine: Servers.Machine,
  selected: Piece,
  silent: boolean,
  drift: number,
  usable: number,
): Row => {
  const left: Row = [
    selected,
    SPACE,
    strong(machine.name ?? "—"),
    muted(" · "),
    label(machine.url),
  ];
  const right = (): Row => {
    if (machine.stats === null || machine.heartbeatAt === null) {
      return [muted("never heard from")];
    }
    const seen = `${age(machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift)} ago`;
    if (silent) {
      return [paint(PALETTE.love, `silent · seen ${seen}`)];
    }
    const { qemus, cpu, memory } = machine.stats;
    const qemusPieces: Row =
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
  return [...clip(left, usable - saidWidth - GAP.text.length), GAP, ...said];
};

// A card's two graph rows: labels above, the newest readings below, a graph beside each of the
// readings that fit, scaled among themselves. A silent machine's history is drawn in muted, its
// numbers too.
const cardGraphs = (
  series: Option.Option<ProcessStats.Series>,
  silent: boolean,
  usable: number,
): { readonly upper: Row; readonly lower: Row } => {
  const width = Math.floor((usable - GRAPHS_FIXED) / 3);
  const samples = Option.match(series, {
    onNone: (): ReadonlyArray<ProcessStats.Sample> => [],
    onSome: (found) => found.samples.slice(-2 * width),
  });
  const newest = samples.at(-1);
  const sections = METRICS.map((metric) => {
    const drawn = graph(metric.scaled(samples), width, silent ? () => PALETTE.muted : metric.color);
    const current = (newest === undefined ? "—" : metric.current(newest)).padStart(LABEL_WIDTH);
    return {
      upper: [label(metric.label.padEnd(LABEL_WIDTH)), SPACE, ...drawn.upper],
      lower: [silent ? muted(current) : strong(current), SPACE, ...drawn.lower],
    };
  });
  return {
    upper: sections.flatMap((section, index) =>
      index === 0 ? section.upper : [GAP, ...section.upper],
    ),
    lower: sections.flatMap((section, index) =>
      index === 0 ? section.lower : [GAP, ...section.lower],
    ),
  };
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

// One machine's card: its header, its two graph rows and the jobs running on it that fit.
export type Card = {
  readonly header: Row;
  readonly upper: Row;
  readonly lower: Row;
  readonly jobs: ReadonlyArray<Row>;
};

// Everything on the screen for one view at one size, in the order it is drawn: the machines
// box (its top border says how old the read is, its bottom where the window sits when more
// cards than fit), the queue box (its title counts what runs and waits, its bottom the window's
// place) and the footer.
export type Screen = {
  readonly status: string;
  readonly tabs: Row;
  readonly machines: {
    readonly cards: ReadonlyArray<Card>;
    readonly empty: Option.Option<string>;
    readonly place: Option.Option<string>;
  };
  readonly queue: {
    readonly title: string;
    readonly header: Row;
    readonly jobs: ReadonlyArray<Row>;
    readonly empty: Option.Option<string>;
    readonly place: Option.Option<string>;
  };
  readonly footer: { readonly left: Row; readonly right: string };
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
): Card => {
  const silent =
    machine.heartbeatAt !== null &&
    machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift > SILENT_AFTER_MS;
  const graphs = cardGraphs(series, silent, usable);
  return {
    header: cardHeader(machine, header, silent, drift, usable),
    upper: graphs.upper,
    lower: graphs.lower,
    jobs: jobList(jobs, job, hasFocus, drift),
  };
};

// The cards of the active tab around the selected one, at most MAX_CARDS and as many as fit
// with the queue keeping its rows, and the window's place in the list when there is more than
// fits. The window grows upward from the selected card first, so a step down scrolls one card,
// and downward with what room is left. The rows the cards and their dividers may take: the
// footer, the queue's frame with its minimum of rows, and this box's own borders and tabs come
// off the terminal's height.
const machines = (
  view: View,
  snapshot: Snapshot,
  now: number,
  columns: number,
  rows: number,
): Screen["machines"] => {
  const usable = columns - 4;
  const listed = ofTab(snapshot, view.tab);
  if (listed.length === 0) {
    const kind = view.tab === "servers" ? "qemu servers" : "automation clients";
    return { cards: [], empty: Option.some(`no ${kind} registered`), place: Option.none() };
  }
  const drift = now - snapshot.readAt;
  const entries = entriesOf(snapshot, view.tab);
  const selected = entries[clamp(view.cursor[view.tab], 0, entries.length - 1)];
  const chosen = listed.indexOf(selected.machine);
  const available = rows - 1 - (QUEUE_MIN_ROWS + 3) - 3;
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
  const cards = Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset;
    const machine = listed[index];
    const series = Option.fromUndefinedOr(
      snapshot.series.find((found) => found.type === machine.type && found.name === machine.name),
    );
    const { jobs, from } = windowOf(index);
    const own = index === chosen;
    const header = marker(own && Option.isNone(selected.job), hasFocus);
    const job = own ? Option.map(selected.job, (at) => at - from) : Option.none<number>();
    return card(machine, series, jobs, header, job, hasFocus, drift, usable);
  });
  const place =
    cards.length < listed.length
      ? Option.some(`${String(first + 1)}-${String(last + 1)} of ${String(listed.length)}`)
      : Option.none<string>();
  return { cards, empty: Option.none(), place };
};

// The queue fills every row the cards leave above the footer: the jobs come running then
// pending with the selected one in view, never below the window, which starts room - 1 above
// it at most; the place says where the window sits in the list when they do not all fit.
const queue = (view: View, snapshot: Snapshot, now: number, room: number): Screen["queue"] => {
  const drift = now - snapshot.readAt;
  const jobs = jobsOf(snapshot);
  const title = `automation · running ${String(snapshot.queue.running.length)} · pending ${String(snapshot.queue.pending.length)}`;
  if (jobs.length === 0) {
    return {
      title,
      header: jobHeader,
      jobs: [],
      empty: Option.some("no jobs"),
      place: Option.none(),
    };
  }
  const cursor = clamp(view.cursor.queue, 0, jobs.length - 1);
  const first = Math.max(0, cursor - (room - 1));
  const shown = jobs.slice(first, first + room);
  const place =
    jobs.length > room
      ? Option.some(
          `${String(first + 1)}-${String(first + shown.length)} of ${String(jobs.length)}`,
        )
      : Option.none<string>();
  return {
    title,
    header: jobHeader,
    jobs: jobList(shown, Option.some(cursor - first), view.focus === "queue", drift),
    empty: Option.none(),
    place,
  };
};

const HINTS: ReadonlyArray<readonly [key: string, does: string]> = [
  ["j/k", "select"],
  ["tab", "machines/queue"],
  ["h/l", "servers/clients"],
  ["g/G", "first/last"],
  ["L", "open ticket"],
  ["q", "quit"],
];

// The last row: the reason the last read failed, else what the last key had to say, else the
// keys with the name on the right. A reason is cut to the row less its padding.
const footer = (view: View, columns: number): Screen["footer"] => {
  if (Option.isSome(view.failure)) {
    return {
      left: [paint(PALETTE.love, cut(`error: ${view.failure.value}`, columns - 2))],
      right: "",
    };
  }
  if (Option.isSome(view.notice)) {
    return { left: [paint(PALETTE.gold, cut(view.notice.value, columns - 2))], right: "" };
  }
  return {
    left: HINTS.flatMap(([key, does], index) => [
      ...(index === 0 ? [] : [muted("   ")]),
      value(key),
      muted(` ${does}`),
    ]),
    right: "oligarchy",
  };
};

// The machines box is as tall as its tabs and cards and the queue's box takes every other row
// above the footer, so the queue grows with the terminal.
export const screen = (view: View, now: number, columns: number, rows: number): Screen => {
  const tabs = tabsRow(view);
  const status = Option.match(view.snapshot, {
    onNone: () => "reading…",
    onSome: (snapshot) => `read ${age(now - snapshot.readAt)} ago`,
  });
  return Option.match(view.snapshot, {
    onNone: () => ({
      status,
      tabs,
      machines: { cards: [], empty: Option.none(), place: Option.none() },
      queue: {
        title: "automation",
        header: jobHeader,
        jobs: [],
        empty: Option.none(),
        place: Option.none(),
      },
      footer: footer(view, columns),
    }),
    onSome: (snapshot) => {
      const shown = machines(view, snapshot, now, columns, rows);
      // Top border, tabs, bottom border, then each card's rows and the dividers between them.
      const height =
        3 +
        (Option.isSome(shown.empty) ? 1 : 0) +
        shown.cards.reduce((total, drawn) => total + 3 + drawn.jobs.length, 0) +
        Math.max(0, shown.cards.length - 1);
      return {
        status,
        tabs,
        machines: shown,
        queue: queue(view, snapshot, now, rows - 1 - height - 3),
        footer: footer(view, columns),
      };
    },
  });
};
