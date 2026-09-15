import {
  Cause,
  Clock,
  Duration,
  Effect,
  Option,
  type PlatformError,
  Ref,
  Schedule,
  Stream,
  Terminal,
} from "effect";
import * as Automation from "../db/automation.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as Render from "../observability/render.ts";

// The terminal this view is laid out for: a card's header fits its host numbers beside a name
// and a url across 135 columns, with 33 columns left to each of its three graphs, and 37 rows
// hold four cards and sixteen jobs. Anything smaller is refused; anything wider goes to the
// graphs and the reason column, anything taller to the job list.
export const MIN_COLUMNS = 135;
export const MIN_ROWS = 37;

// A server writes its row every thirty seconds and a job changes on its own clock; five seconds
// keeps the queue fresh at a handful of small queries a minute.
const REFRESH_SECONDS = 5;
export const REFRESH = Duration.seconds(REFRESH_SECONDS);
// The ages tick between reads; a resize is drawn on the next tick.
export const AGE_TICK = Duration.seconds(1);

// A server writes its row every thirty seconds. One heartbeat may be in flight and one lost to a
// slow database; three overdue is a server that stopped.
export const SILENT_AFTER_MS = 90_000;

// More completed jobs than any terminal shows below the cards.
export const COMPLETED_LIMIT = 100;

// 240 readings of thirty seconds is two hours. A graph holds two readings a column, so a
// terminal would have to be 400 columns wide before its graphs ran out of history.
export const SERIES_SAMPLES = 240;

// Four cards fill the box; j and k bring the rest into view one at a time.
export const MAX_CARDS = 4;

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

// How hot a percentage is: pine at rest, gold halfway, love flat out. What btop does with its
// cpu gradient, in our palette.
const heat = (percent: number): string => {
  const value = Math.min(100, Math.max(0, percent));
  return value < 50
    ? blend(PALETTE.pine, PALETTE.gold, value / 50)
    : blend(PALETTE.gold, PALETTE.love, (value - 50) / 50);
};

const STATUS: Readonly<
  Record<
    Automation.AutomationJobListRow["status"],
    { readonly glyph: string; readonly color: string }
  >
> = {
  pending: { glyph: "◌", color: PALETTE.muted },
  running: { glyph: "●", color: PALETTE.gold },
  succeeded: { glyph: "✓", color: PALETTE.foam },
  failed: { glyph: "✗", color: PALETTE.love },
  aborted: { glyph: "⊘", color: PALETTE.rose },
  timed_out: { glyph: "◔", color: PALETTE.iris },
};

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

// snapshot is absent until the first read lands; failure is the last read's reason, cleared by
// the next good read, so a database outage leaves the last picture up with the reason under it.
// tab is the kind of machine the cards show; cursor is each tab's selected card, kept when the
// tab changes and clamped to what the newest read lists.
export type View = {
  readonly snapshot: Option.Option<Snapshot>;
  readonly failure: Option.Option<string>;
  readonly tab: Tab;
  readonly cursor: Readonly<Record<Tab, number>>;
};

export const initialView: View = {
  snapshot: Option.none(),
  failure: Option.none(),
  tab: "servers",
  cursor: { servers: 0, clients: 0 },
};

const KIND: Readonly<Record<Tab, Servers.ServerType>> = {
  servers: "qemu",
  clients: "automation-client",
};

const ofTab = (snapshot: Snapshot, tab: Tab): ReadonlyArray<Servers.Machine> =>
  snapshot.machines.filter((machine) => machine.type === KIND[tab]);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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

// A job's reason is a stderr tail and a driver's message can span lines: a control character
// would break the row or steer the terminal, so each is drawn as a space.
const clean = (text: string): string =>
  Array.from(text, (character) =>
    character < " " || character === "\u007f" ? " " : character,
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

// Two rows of braille, `width` columns wide, of readings on a 0–100 scale, the newest in the
// right half of the last column and the history running left; the upper row is the half above
// fifty. Each column takes the colour of its higher reading.
const graph = (
  readings: ReadonlyArray<number>,
  width: number,
  color: (reading: number) => string,
): { readonly upper: string; readonly lower: string } => {
  const shown = readings.slice(-2 * width);
  const padded = [...Array.from({ length: 2 * width - shown.length }, () => 0), ...shown];
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

// The three graphs of a card: cpu on its own scale, memory and jobs against the highest reading
// in view, as btop scales its network graph.
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
    color: () => PALETTE.iris,
  },
  {
    label: "jobs",
    current: (sample) => String(sample.jobs),
    scaled: relative((sample) => sample.jobs),
    color: () => PALETTE.foam,
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

// A card's first row: the marker and the machine's name and url on the left, cut to what the
// right leaves; on the right what its heartbeat says, or the one phrase that says it stopped.
// stats and heartbeat_at are written together, so either being null is a row no server claimed.
const cardHeader = (
  machine: Servers.Machine,
  selected: boolean,
  silent: boolean,
  drift: number,
  usable: number,
): string => {
  const left: ReadonlyArray<Piece> = [
    selected ? { text: "▸", color: PALETTE.gold } : SPACE,
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

// A card's two graph rows: labels above, the newest readings below, a graph beside each. A
// silent machine's history is drawn in muted, its numbers too.
const cardGraphs = (
  series: Option.Option<ProcessStats.Series>,
  silent: boolean,
  usable: number,
): { readonly upper: string; readonly lower: string } => {
  const width = Math.floor((usable - GRAPHS_FIXED) / 3);
  const rest = " ".repeat(usable - GRAPHS_FIXED - 3 * width);
  const samples = Option.match(series, {
    onNone: (): ReadonlyArray<ProcessStats.Sample> => [],
    onSome: (found) => found.samples,
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
  selected: boolean,
  drift: number,
  usable: number,
): ReadonlyArray<string> => {
  const silent =
    machine.heartbeatAt !== null &&
    machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift > SILENT_AFTER_MS;
  const graphs = cardGraphs(series, silent, usable);
  return [
    boxed(cardHeader(machine, selected, silent, drift, usable)),
    boxed(graphs.upper),
    boxed(graphs.lower),
  ];
};

// The machines box: the tabs, then at most MAX_CARDS cards of the active tab with the selected
// one in view, dividers between them, and the window's place in the list on the bottom border
// when there is more than fits. A tab with nothing says so in one row.
const machinesBox = (view: View, now: number, columns: number): ReadonlyArray<string> => {
  const usable = columns - 4;
  const rows: Array<string> = [tabsRow(view, now, columns)];
  if (Option.isNone(view.snapshot)) {
    return [...rows, boxed(" ".repeat(usable)), bottom(columns, Option.none())];
  }
  const snapshot = view.snapshot.value;
  const listed = ofTab(snapshot, view.tab);
  if (listed.length === 0) {
    const kind = view.tab === "servers" ? "qemu servers" : "automation clients";
    return [
      ...rows,
      boxed(muted(fit(`no ${kind} registered`, usable))),
      bottom(columns, Option.none()),
    ];
  }
  const drift = now - snapshot.readAt;
  const cursor = clamp(view.cursor[view.tab], 0, listed.length - 1);
  // The selection is never below the window: the window starts MAX_CARDS - 1 above it at most.
  const first = Math.max(0, cursor - (MAX_CARDS - 1));
  const shown = listed.slice(first, first + MAX_CARDS);
  shown.forEach((machine, index) => {
    if (index > 0) {
      rows.push(divider(columns));
    }
    const series = Option.fromUndefinedOr(
      snapshot.series.find((found) => found.type === machine.type && found.name === machine.name),
    );
    rows.push(...card(machine, series, first + index === cursor, drift, usable));
  });
  const place =
    listed.length > MAX_CARDS
      ? Option.some(
          `${String(first + 1)}-${String(first + shown.length)} of ${String(listed.length)}`,
        )
      : Option.none();
  return [...rows, bottom(columns, place)];
};

const jobWidths = (usable: number) => ({
  ticket: 9,
  test: 18,
  action: 9,
  status: 12,
  queued: 11,
  started: 11,
  finished: 11,
  reason: usable - 9 - 18 - 9 - 12 - 11 - 11 - 11 - 7 * 2,
});

const jobHeader = (usable: number): string => {
  const w = jobWidths(usable);
  return paint(
    PALETTE.subtle,
    [
      fit("ticket", w.ticket),
      fit("test", w.test),
      fit("action", w.action),
      fit("status", w.status),
      fit("queued", w.queued),
      fit("started", w.started),
      fit("finished", w.finished),
      fit("reason", w.reason),
    ].join(GAP.text),
  );
};

// The columns are the same for every job, so a pending one shows dashes where its start and
// finish will go; the status carries its glyph and colour.
const jobRow = (job: Automation.AutomationJobListRow, drift: number, usable: number): string => {
  const w = jobWidths(usable);
  const status = STATUS[job.status];
  return [
    paint(PALETTE.text, fit(job.ticket ?? "—", w.ticket)),
    paint(PALETTE.text, fit(job.test, w.test)),
    paint(PALETTE.subtle, fit(job.action, w.action)),
    paint(status.color, fit(`${status.glyph} ${job.status}`, w.status)),
    paint(PALETTE.subtle, fit(ago(job.createdAt, job.queriedAt, drift), w.queued)),
    paint(PALETTE.subtle, fit(ago(job.startedAt, job.queriedAt, drift), w.started)),
    paint(PALETTE.subtle, fit(ago(job.finishedAt, job.queriedAt, drift), w.finished)),
    paint(PALETTE.text, fit(job.reason ?? "", w.reason)),
  ].join(GAP.text);
};

// The queue box fills every row the cards leave above the footer: its title counts what runs and
// waits, the jobs come running, pending, then completed, and the bottom border counts what was
// cut when they do not all fit.
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
  const { queue, readAt } = view.snapshot.value;
  const drift = now - readAt;
  const jobs = [...queue.running, ...queue.pending, ...queue.completed];
  const listed =
    jobs.length === 0
      ? [boxed(muted(fit("no jobs", usable)))]
      : jobs.slice(0, room).map((job) => boxed(jobRow(job, drift, usable)));
  const cut =
    jobs.length > room
      ? Option.some(`${String(room)} of ${String(jobs.length)}`)
      : Option.none<string>();
  return [
    top(` · running ${String(queue.running.length)} · pending ${String(queue.pending.length)}`),
    boxed(jobHeader(usable)),
    ...listed,
    ...Array.from({ length: room - listed.length }, () => blank),
    bottom(columns, cut),
  ];
};

const HINTS: ReadonlyArray<readonly [key: string, does: string]> = [
  ["j/k", "select"],
  ["tab", "servers/clients"],
  ["g/G", "first/last"],
  ["q", "quit"],
];

// The last row: the keys, or the reason the last read failed.
const footer = (view: View, columns: number): string =>
  Option.match(view.failure, {
    onNone: () => {
      const plain = HINTS.map(([key, does]) => `${key} ${does}`).join("   ");
      const keys = HINTS.map(
        ([key, does]) => `${paint(PALETTE.text, key)}${muted(` ${does}`)}`,
      ).join(muted("   "));
      const name = "oligarchy";
      return ` ${keys}${" ".repeat(columns - plain.length - name.length - 2)}${muted(name)} `;
    },
    onSome: (reason) => paint(PALETTE.love, fit(` error: ${reason}`, columns)),
  });

// Every row is written over in full at the terminal's width with an absolute move and never a
// newline, so the screen never scrolls and a frame needs no clear. The cards' box is as tall as
// its cards and the queue's box takes every other row above the footer, so the queue grows with
// the terminal. A terminal that shrank below the minimum gets the one sentence saying so until
// it grows back.
export const draw = (view: View, now: number, columns: number, rows: number): string => {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return `\x1b[2J\x1b[1;1H${paint(PALETTE.love, tooSmall(columns, rows))}`;
  }
  const machines = machinesBox(view, now, columns);
  const lines = [
    ...machines,
    ...queueBox(view, now, columns, rows - 1 - machines.length),
    footer(view, columns),
  ];
  return lines.map((line, index) => `\x1b[${String(index + 1)};1H${line}`).join("");
};

// What a key does to the view: j, k, g and G and the arrows move the selection within the tab's
// machines; tab, h, l and the arrows sideways switch tabs. Anything else is nothing.
export const press = (view: View, input: Terminal.UserInput): View => {
  const count = Option.match(view.snapshot, {
    onNone: () => 0,
    onSome: (snapshot) => ofTab(snapshot, view.tab).length,
  });
  const last = Math.max(0, count - 1);
  const select = (cursor: number): View => ({
    ...view,
    cursor: { ...view.cursor, [view.tab]: clamp(cursor, 0, last) },
  });
  switch (input.key.name) {
    case "j":
    case "down":
      return select(view.cursor[view.tab] + 1);
    case "k":
    case "up":
      return select(view.cursor[view.tab] - 1);
    case "g":
      return select(input.key.shift ? last : 0);
    case "tab":
    case "h":
    case "l":
    case "left":
    case "right":
      return { ...view, tab: view.tab === "servers" ? "clients" : "servers" };
    default:
      return view;
  }
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const isQuit = (input: Terminal.UserInput): boolean =>
  input.key.name === "q" && !input.key.ctrl && !input.key.meta;

// Owns the alternate screen while it runs: the tables are read at once and every REFRESH, the
// ages repainted every AGE_TICK at whatever size the terminal has by then, every other key
// repainted as it lands, and q or the input ending (ctrl-c, in raw mode) hands the screen back.
// A read that fails leaves the last picture up with its reason on the footer; a frame stdout
// refuses ends the run with that failure.
export const run: Effect.Effect<
  void,
  PlatformError.PlatformError,
  | Terminal.Terminal
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Automation.AutomationStore
> = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal;
  const servers = yield* Servers.ServerStore;
  const processStats = yield* ProcessStats.ProcessStatsStore;
  const automation = yield* Automation.AutomationStore;
  const view = yield* Ref.make(initialView);
  const paintScreen = Effect.gen(function* () {
    const current = yield* Ref.get(view);
    const now = yield* Clock.currentTimeMillis;
    const columns = yield* terminal.columns;
    const rows = yield* terminal.rows;
    yield* terminal.display(draw(current, now, columns, rows));
  });
  const read = Effect.gen(function* () {
    // Taken before the queries, so an age counts from before its row was read, never after: a
    // slow read leans towards silent, not live.
    const readAt = yield* Clock.currentTimeMillis;
    const machines = yield* servers.listMachines();
    const series = yield* processStats.listSeries(SERIES_SAMPLES);
    const queue = yield* automation.listJobs(COMPLETED_LIMIT);
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
  const keys = Effect.gen(function* () {
    const input = yield* terminal.readInput;
    yield* Stream.fromQueue(input).pipe(
      Stream.takeWhile((key) => !isQuit(key)),
      Stream.runForEach((key) =>
        Ref.update(view, (current) => press(current, key)).pipe(Effect.andThen(paintScreen)),
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
          Effect.schedule(paintScreen, Schedule.spaced(AGE_TICK)),
        ),
      );
    }),
  );
});
