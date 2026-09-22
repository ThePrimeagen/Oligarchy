import { Duration, Option } from "effect";
import type * as Automation from "../db/automation.ts";
import type * as ProcessStats from "../db/process-stats.ts";
import type * as Servers from "../db/servers.ts";
import * as Follow from "./follow.ts";
import * as Steps from "./steps.ts";
import * as Text from "./text.ts";

// The terminal this view is laid out for: a card's header fits its host numbers beside a name
// and a url across 135 columns, with 33 columns left to each of its three graphs, and 37 rows
// hold the tabs, four cards and fifteen queued jobs. Anything smaller is refused; anything wider
// goes to the graphs, anything taller to the job list.
export const MIN_COLUMNS = 135;
export const MIN_ROWS = 37;

// A card grows a row per job running on it and takes those rows from the queue, which keeps at
// least this many: what runs is on the cards, so the queue mostly shows what waits.
const QUEUE_MIN_ROWS = 4;

// A server writes its row every thirty seconds. The screen's cycle is ten: status and
// the latest tickets, not a query on every frame.
export const REFRESH = Duration.seconds(10);
// The ages tick between reads.
export const AGE_TICK = Duration.seconds(1);
// A pop-up stays this long, whatever keys are pressed under it.
export const POPUP_FOR = Duration.seconds(3);

// The pop-up A raises on a job that was over before the abort reached the automation server.
export const CANNOT_ABORT = "you cannot abort completed jobs";

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
// Theme
// ---------------------------------------------------------------------------

const PALETTE = Text.PALETTE;

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

// What waits is a hollow mark. What runs is a spinner, coloured below by the action.
const PENDING = { glyph: "◌", color: PALETTE.muted };

// Rosé Pine has no unambiguous green or blue: pine is teal and leaf is sage, and they sit next
// to each other. A running drive and a running diagnose take colours the rest of the board does
// not use.
export const DRIVE_COLOR = "#4ade80";
export const DIAGNOSE_COLOR = "#60a5fa";
export const MINT_COLOR = "#fbbf24";
export const ACTION_COLOR: Readonly<Record<Automation.AutomationAction, string>> = {
  drive: DRIVE_COLOR,
  diagnose: DIAGNOSE_COLOR,
  mint: MINT_COLOR,
};

// The braille spinner on a running row turns with the follow's spinner. A frame short of this
// still shows the previous glyph.
export const SPIN_MS = 80;

export const spinnerAt = (now: number): string =>
  Follow.SPINNER[Math.floor(now / SPIN_MS) % Follow.SPINNER.length];

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

export type Tab = "automation" | "servers" | "tickets";
type Focus = "machines" | "queue";
type List = "servers" | "clients" | "queue";

// A sentence in a box in the middle of the screen, and the clock when it went up: the runner
// takes it down POPUP_FOR later, unless another has taken its place by then.
export type Popup = { readonly text: string; readonly shownAt: number };

// The question a asks before a job is aborted: which job, and the answer the marker is on. It
// starts on no, so enter alone aborts nothing.
export type Confirm = {
  readonly ticket: string;
  readonly action: Automation.AutomationAction;
  readonly choice: "yes" | "no";
};

// d's definition or enter's ticket information, and how far j and k have scrolled it.
export type Sheet = {
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
  readonly offset: number;
};

// snapshot is absent until the first read lands; failure is the last read's reason, cleared by
// the next good read, so a database outage leaves the last picture up with the reason under it.
// notice is what the last key had to say (the ticket L opened, or why it could not), retired by
// the next key. follow is the job F is looking at: a peek over the board, or the whole screen.
// session is that job's calls, intents and image, drawn in the main area whether or not F is
// up; sessionNote is why that pane is empty. confirm is a's question while it is up; popup is
// what a had to say about a job that could not be aborted, up until its time is over. sheet is
// d's definition or enter's ticket information. tab is the kind of machine the cards show;
// focus is the box j and k move in; cursor is each list's selected row (a tab's cards and the
// jobs on them as one list, the queue's jobs as another), kept when the tab or the focus
// changes and clamped to what the newest read lists.
export type View = {
  readonly snapshot: Option.Option<Snapshot>;
  readonly failure: Option.Option<string>;
  readonly notice: Option.Option<string>;
  readonly follow: Option.Option<Follow.Follow>;
  readonly session: Option.Option<Follow.Follow>;
  readonly sessionNote: Option.Option<string>;
  readonly confirm: Option.Option<Confirm>;
  readonly popup: Option.Option<Popup>;
  readonly sheet: Option.Option<Sheet>;
  readonly tab: Tab;
  readonly focus: Focus;
  readonly cursor: Readonly<Record<List, number>>;
};

export const initialView: View = {
  snapshot: Option.none(),
  failure: Option.none(),
  notice: Option.none(),
  follow: Option.none(),
  session: Option.none(),
  sessionNote: Option.none(),
  confirm: Option.none(),
  popup: Option.none(),
  sheet: Option.none(),
  tab: "automation",
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

const KIND = {
  servers: "qemu",
  clients: "automation-client",
} as const;

const ofTab = (snapshot: Snapshot, tab: keyof typeof KIND): ReadonlyArray<Servers.Machine> =>
  snapshot.machines.filter((machine) => machine.type === KIND[tab]);

type Job = Automation.AutomationJobListRow;

// What runs, then what waits; nothing that is over.
const jobsOf = (snapshot: Snapshot): ReadonlyArray<Job> => [
  ...snapshot.queue.running,
  ...snapshot.queue.pending,
];

// Running, then waiting, then the newest finished: the tickets tab, cut where the cycle cut them.
const ticketsOf = (snapshot: Snapshot): ReadonlyArray<Job> => [
  ...jobsOf(snapshot),
  ...snapshot.queue.completed,
];

// The running jobs a machine is part of: a qemu server hosts a drive's guest, an automation
// client runs the driver of a drive or a diagnose. Placement is by url, the servers table's key.
const jobsOn = (snapshot: Snapshot, machine: Servers.Machine): ReadonlyArray<Job> =>
  snapshot.queue.running.filter(
    (job) => (machine.type === "qemu" ? job.serverUrl : job.clientUrl) === machine.url,
  );

// A row of the machines box the cursor rests on: a card, or the nth job on it.
type Entry = { readonly machine: Servers.Machine; readonly job: Option.Option<number> };

const entriesOf = (snapshot: Snapshot, tab: keyof typeof KIND): ReadonlyArray<Entry> =>
  ofTab(snapshot, tab).flatMap((machine) => [
    { machine, job: Option.none() },
    ...jobsOn(snapshot, machine).map((_, index) => ({ machine, job: Option.some(index) })),
  ]);

// The sidebar lists a client and then its jobs. j and k rest only on a job, so a header is
// never where the marker stops.
const clientStops = (snapshot: Snapshot): ReadonlyArray<number> =>
  entriesOf(snapshot, "clients").flatMap((entry, index) =>
    Option.isSome(entry.job) ? [index] : [],
  );

// A cursor left on a client header, or past the list, moves onto a ticket. No ticket to land
// on leaves it where it is.
export const land = (view: View): View => {
  if (Option.isNone(view.snapshot)) {
    return view;
  }
  const stops = clientStops(view.snapshot.value);
  if (stops.length === 0 || stops.includes(view.cursor.clients)) {
    return view;
  }
  const next = stops.find((stop) => stop >= view.cursor.clients) ?? stops[stops.length - 1];
  return { ...view, cursor: { ...view.cursor, clients: next } };
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// Automation walks its clients, tickets walk the tickets, and the qemu tab keeps the
// machines/queue split.
const focused = (view: View): List => {
  if (view.tab === "automation") {
    return "clients";
  }
  if (view.tab === "tickets" || view.focus === "queue") {
    return "queue";
  }
  return "servers";
};

// The gold marker's job: a job on a card or under a client, or the queue's; none on a header.
export const selectedJob = (view: View): Option.Option<Job> =>
  Option.flatMap(view.snapshot, (snapshot) => {
    // Automation and tickets have one list; the machines/queue split is the qemu tab's.
    if (view.tab === "tickets" || (view.tab === "servers" && view.focus === "queue")) {
      const jobs = view.tab === "tickets" ? ticketsOf(snapshot) : jobsOf(snapshot);
      return jobs.length === 0
        ? Option.none()
        : Option.some(jobs[clamp(view.cursor.queue, 0, jobs.length - 1)]);
    }
    const list = view.tab === "automation" ? "clients" : "servers";
    const entries = entriesOf(snapshot, list);
    if (entries.length === 0) {
      return Option.none();
    }
    const entry = entries[clamp(view.cursor[list], 0, entries.length - 1)];
    return Option.map(entry.job, (index) => jobsOn(snapshot, entry.machine)[index]);
  });

export const tooSmall = (columns: number, rows: number): string =>
  `viz needs a terminal of at least ${String(MIN_COLUMNS)}×${String(MIN_ROWS)} (columns×rows); this one is ${String(columns)}×${String(rows)}`;

// A capital L: the parser reports it as l with shift.
export const isOpen = (key: Key): boolean => key.shift && key.name === "l";

// f or F: a follow needs no shift, and a shifted one is not another key.
export const isFollow = (key: Key): boolean => key.name === "f";

// d, not D: the selected ticket's test definition.
export const isDefinition = (key: Key): boolean =>
  key.name === "d" && !key.shift && !key.ctrl && !key.meta;

// a, not A: the abort question. A shifted a is not another command.
export const isAbort = (key: Key): boolean =>
  key.name === "a" && !key.shift && !key.ctrl && !key.meta;

// Enter, as the parser names it: the answer to a's question, or the ticket's details.
export const isSelect = (key: Key): boolean => key.name === "return";

// q, or ctrl-c, which raw mode delivers as a key rather than a signal.
export const isQuit = (key: Key): boolean =>
  (key.name === "q" && !key.ctrl && !key.meta) || (key.name === "c" && key.ctrl);

// A running job can be followed. One whose guest has not started is still followed: the runner
// waits for the session that start writes. A running job with neither a session nor a ticket
// cannot be found again once the read moves on, so that one is a sentence for the footer. So is
// a job that is not running, and no job at all.
export const followError = (job: Option.Option<Job>): Option.Option<string> =>
  Option.match(job, {
    onNone: () => Option.some("no job selected"),
    onSome: (found) => {
      if (found.status !== "running") {
        return Option.some("follow needs a running job");
      }
      if (found.sessionId === null && found.ticket === null) {
        return Option.some("the selected job has no session");
      }
      return Option.none();
    },
  });

// The definition and the ticket information share one box. The window is what j and k scroll.
export const SHEET_WIDTH = 76;
export const SHEET_ROWS = 16;
const SHEET_INNER = SHEET_WIDTH - 4;

const scroll = (sheet: Sheet, step: number): Sheet => ({
  ...sheet,
  offset: clamp(sheet.offset + step, 0, Math.max(0, sheet.lines.length - SHEET_ROWS)),
});

// Every key retires the last notice. While a's question is up it has the keys: h, l and the
// arrows move between yes on the left and no on the right, escape and enter close it (what
// enter on yes does is the runner's), and nothing else moves. A sheet has j and k and escape;
// everything else waits. Otherwise L, F, d, enter and a move nothing here: opening the ticket,
// the follow, the definition, the information or the question is the runner's, and so is the
// pop-up, which no key takes down. escape closes whatever is followed; a peek closes on any
// other key too, so the board stays walkable, while a full follow stays up until escape.
export const press = (view: View, key: Key): View => {
  const retired: View = { ...view, notice: Option.none() };
  if (Option.isSome(view.confirm)) {
    const asked = view.confirm.value;
    if (key.name === "h" || key.name === "left") {
      return { ...retired, confirm: Option.some({ ...asked, choice: "yes" }) };
    }
    if (key.name === "l" || key.name === "right") {
      return { ...retired, confirm: Option.some({ ...asked, choice: "no" }) };
    }
    if (key.name === "escape" || isSelect(key)) {
      return { ...retired, confirm: Option.none() };
    }
    return retired;
  }
  if (Option.isSome(view.sheet)) {
    const shown = view.sheet.value;
    if (key.name === "j" || key.name === "down") {
      return { ...retired, sheet: Option.some(scroll(shown, 1)) };
    }
    if (key.name === "k" || key.name === "up") {
      return { ...retired, sheet: Option.some(scroll(shown, -1)) };
    }
    if (key.name === "escape") {
      return { ...retired, sheet: Option.none() };
    }
    return retired;
  }
  if (isOpen(key) || isFollow(key) || isAbort(key) || isDefinition(key) || isSelect(key)) {
    return retired;
  }
  if (key.name === "escape") {
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
      list === "queue"
        ? (view.tab === "tickets" ? ticketsOf(snapshot) : jobsOf(snapshot)).length
        : entriesOf(snapshot, list).length,
  });
  const last = Math.max(0, count - 1);
  // The row on screen, not the number stored: a list that shrank since leaves the number past
  // the end, and a step must start from what is selected.
  const current = clamp(view.cursor[list], 0, last);
  const select = (cursor: number): View => ({
    ...closed,
    cursor: { ...view.cursor, [list]: clamp(cursor, 0, last) },
  });
  // The sidebar's rows that are not tickets are visible and not selectable.
  if (list === "clients") {
    const stops = Option.match(view.snapshot, {
      onNone: (): ReadonlyArray<number> => [],
      onSome: clientStops,
    });
    const at = stops.indexOf(current);
    const pick = (index: number): View =>
      stops.length === 0 ? closed : select(stops[clamp(index, 0, stops.length - 1)]);
    switch (key.name) {
      case "j":
      case "down":
        return pick(at === -1 ? 0 : at + 1);
      case "k":
      case "up":
        return pick(at === -1 ? 0 : at - 1);
      case "g":
        return pick(key.shift ? stops.length - 1 : 0);
      default:
        break;
    }
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
      return { ...closed, focus: view.focus === "machines" ? "queue" : "machines" };
    case "s":
      return key.shift ? closed : { ...closed, tab: "automation" };
    case "t":
      return key.shift ? closed : { ...closed, tab: "tickets" };
    case "h":
    case "l":
    case "left":
    case "right": {
      const order: ReadonlyArray<Tab> = ["automation", "servers", "tickets"];
      const step = key.name === "h" || key.name === "left" ? -1 : 1;
      const index = order.indexOf(view.tab);
      return { ...closed, tab: order[(index + step + order.length) % order.length] };
    }
    default:
      return closed;
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

// A stamp's age against the clock that stamped it plus the time since the read, or a dash for a
// stamp not written yet.
const ago = (stamp: Date | null, queriedAt: Date, drift: number): string =>
  stamp === null ? "—" : `${Text.age(queriedAt.getTime() - stamp.getTime() + drift)} ago`;

// Exactly `width` columns of pieces: the piece that crosses the edge is cut with an ellipsis and
// the rest dropped, or spaces fill what is left.
const clip = (pieces: Text.Row, width: number): Text.Row => {
  const kept: Array<Text.Piece> = [];
  let used = 0;
  for (const piece of pieces) {
    const text = Text.clean(piece.text);
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

// A run of glyphs, each with its colour, as pieces that change only where the colour changes: a
// graph of a hundred columns is a handful of pieces, not a hundred. Blanks carry no colour.
type Cell = { readonly glyph: string; readonly color: string };

const stroke = (cells: ReadonlyArray<Cell>): Text.Row => {
  const pieces: Array<Text.Piece> = [];
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
): { readonly upper: Text.Row; readonly lower: Text.Row } => {
  const padded = [...Array.from({ length: 2 * width - readings.length }, () => 0), ...readings];
  const row = (low: number, high: number): Text.Row =>
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

const meter = (fraction: number): Text.Row => {
  const lit = Math.round(clamp(fraction, 0, 1) * METER_WIDTH);
  const blocks = Array.from({ length: lit }, (_, index): Text.Piece => ({
    text: "■",
    color: heat(((index + 1) * 100) / METER_WIDTH),
  }));
  return lit === METER_WIDTH ? blocks : [...blocks, Text.muted("■".repeat(METER_WIDTH - lit))];
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
const GRAPHS_FIXED = 3 * (LABEL_WIDTH + 1) + 2 * Text.GAP.text.length;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// The selected row's marker: gold in the box that has the focus, muted in the other, so both
// selections stay in view and the one j and k move is told apart. A space where nothing is
// selected keeps the columns.
const marker = (selected: boolean, hasFocus: boolean): Text.Piece =>
  selected ? { text: "▸", color: hasFocus ? PALETTE.gold : PALETTE.muted } : Text.SPACE;

const ratio = (used: number, total: number): string => `${String(used)}/${String(total)}`;

// Clients registered that currently hold a running job of this kind. One client counts once
// even when it runs several, and a job whose client is not in the list counts for neither.
const clientsDoing = (
  snapshot: Snapshot,
  urls: ReadonlySet<string>,
  action: Job["action"],
): number => {
  const seen = new Set<string>();
  for (const job of snapshot.queue.running) {
    if (job.action === action && job.clientUrl !== null && urls.has(job.clientUrl)) {
      seen.add(job.clientUrl);
    }
  }
  return seen.size;
};

// The first row of the machines box. Servers holding a guest over the servers registered,
// and the clients that are driving or diagnosing over the clients registered. The side h
// and l are on is the bold one. Before the first read there is nothing to count.
const tabsRow = (view: View): Text.Row => {
  const snapshot = Option.getOrNull(view.snapshot);
  if (snapshot === null) {
    return view.tab === "servers"
      ? [Text.strong("servers"), Text.muted(" │ driving diagnosing")]
      : [
          Text.muted("servers │ "),
          view.tab === "automation"
            ? Text.strong("driving diagnosing")
            : Text.muted("driving diagnosing"),
        ];
  }
  const servers = `servers ${ratio(
    ofTab(snapshot, "servers").filter((machine) => (machine.stats?.qemus ?? 0) > 0).length,
    ofTab(snapshot, "servers").length,
  )}`;
  const urls = new Set(ofTab(snapshot, "clients").map((machine) => machine.url));
  const clients = `driving ${ratio(clientsDoing(snapshot, urls, "drive"), urls.size)} diagnosing ${ratio(clientsDoing(snapshot, urls, "diagnose"), urls.size)}`;
  if (view.tab === "servers") {
    return [Text.strong(servers), Text.muted(` │ ${clients}`)];
  }
  if (view.tab === "automation") {
    return [Text.muted(`${servers} │ `), Text.strong(clients)];
  }
  return [Text.muted(`${servers} │ ${clients}`)];
};

// A job row: the marker column and a space, then six columns with a gap between each. A live
// job has no finish and no reason yet, so neither has a column. The action column is ten: that
// holds "59 min ago", the longest minute reading, which is what a running row shows there. The
// header stays "action" because a waiting row still names drive or diagnose in that cell.
const JOB_WIDTHS = { ticket: 9, test: 18, action: 10, status: 12, queued: 11, started: 11 };

const jobHeader: Text.Row = [
  Text.label(
    `  ${[
      Text.fit("ticket", JOB_WIDTHS.ticket),
      Text.fit("test", JOB_WIDTHS.test),
      Text.fit("action", JOB_WIDTHS.action),
      Text.fit("status", JOB_WIDTHS.status),
      Text.fit("queued", JOB_WIDTHS.queued),
      Text.fit("started", JOB_WIDTHS.started),
    ].join(Text.GAP.text)}`,
  ),
];

// 1-based place in the ActionList when the message is one of its steps, otherwise nothing:
// the row keeps the elapsed time. A paraphrase, a closed intent, or a ticket with no steps
// does not get a place.
const stepPlace = (job: Job, messages: ReadonlyArray<string>): string | null => {
  if (job.ticket === null || messages.length === 0) {
    return null;
  }
  const steps = Steps.stepsOf(job.instruction);
  const at = Steps.placeOf(steps, messages);
  if (at === 0) {
    return null;
  }
  return `${String(at)}/${String(steps.length)}`;
};

// The columns are the same for every job, so a pending one shows a dash where its start will
// go. A running one drops the action word. A ticket whose open intent is a step shows n/total
// in that cell; every other running row shows how long it has run. The started column keeps
// the elapsed time either way.
const jobRow = (job: Job, selected: Text.Piece, drift: number, now: number): Text.Row => {
  const running = job.status === "running";
  const color = ACTION_COLOR[job.action];
  const started = ago(job.startedAt, job.queriedAt, drift);
  const place = running ? stepPlace(job, job.intent === null ? [] : [job.intent]) : null;
  return [
    selected,
    Text.SPACE,
    Text.value(Text.fit(job.ticket ?? "—", JOB_WIDTHS.ticket)),
    Text.GAP,
    Text.value(Text.fit(job.test, JOB_WIDTHS.test)),
    Text.GAP,
    running
      ? Text.paint(color, Text.fit(place ?? started, JOB_WIDTHS.action))
      : Text.label(Text.fit(job.action, JOB_WIDTHS.action)),
    Text.GAP,
    Text.paint(
      running ? color : PENDING.color,
      Text.fit(`${running ? spinnerAt(now) : PENDING.glyph} ${job.status}`, JOB_WIDTHS.status),
    ),
    Text.GAP,
    Text.label(Text.fit(ago(job.createdAt, job.queriedAt, drift), JOB_WIDTHS.queued)),
    Text.GAP,
    Text.label(Text.fit(started, JOB_WIDTHS.started)),
  ];
};

const jobList = (
  jobs: ReadonlyArray<Job>,
  selected: Option.Option<number>,
  hasFocus: boolean,
  drift: number,
  now: number,
): ReadonlyArray<Text.Row> =>
  jobs.map((job, index) =>
    jobRow(job, marker(Option.contains(selected, index), hasFocus), drift, now),
  );

// A card's first row: the marker and the machine's name and url on the left, cut to what the
// right leaves; on the right what its heartbeat says, or the one phrase that says it stopped.
// stats and heartbeat_at are written together, so either being null is a row no server claimed.
const cardHeader = (
  machine: Servers.Machine,
  selected: Text.Piece,
  silent: boolean,
  drift: number,
  usable: number,
): Text.Row => {
  const left: Text.Row = [
    selected,
    Text.SPACE,
    Text.strong(machine.name ?? "—"),
    Text.muted(" · "),
    Text.label(machine.url),
  ];
  const right = (): Text.Row => {
    if (machine.stats === null || machine.heartbeatAt === null) {
      return [Text.muted("never heard from")];
    }
    const seen = `${Text.age(machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift)} ago`;
    if (silent) {
      return [Text.paint(PALETTE.love, `silent · seen ${seen}`)];
    }
    const { qemus, cpu, memory } = machine.stats;
    const qemusPieces: Text.Row =
      machine.type === "qemu"
        ? [Text.label("qemus"), Text.SPACE, Text.value(String(qemus)), Text.GAP]
        : [];
    return [
      ...qemusPieces,
      Text.label("host cpu"),
      Text.SPACE,
      Text.value(percent(cpu.mean1m)),
      Text.GAP,
      Text.label("host mem"),
      Text.SPACE,
      ...meter(memory.usedBytes / memory.totalBytes),
      Text.SPACE,
      Text.value(`${gigabytes(memory.usedBytes)} / ${gigabytes(memory.totalBytes)} GB`),
      Text.GAP,
      Text.label("seen"),
      Text.SPACE,
      Text.value(seen),
    ];
  };
  const said = right();
  const saidWidth = said.reduce((total, piece) => total + piece.text.length, 0);
  return [...clip(left, usable - saidWidth - Text.GAP.text.length), Text.GAP, ...said];
};

// A card's two graph rows: labels above, the newest readings below, a graph beside each of the
// readings that fit, scaled among themselves. A silent machine's history is drawn in muted, its
// numbers too.
const cardGraphs = (
  series: Option.Option<ProcessStats.Series>,
  silent: boolean,
  usable: number,
): { readonly upper: Text.Row; readonly lower: Text.Row } => {
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
      upper: [Text.label(metric.label.padEnd(LABEL_WIDTH)), Text.SPACE, ...drawn.upper],
      lower: [silent ? Text.muted(current) : Text.strong(current), Text.SPACE, ...drawn.lower],
    };
  });
  return {
    upper: sections.flatMap((section, index) =>
      index === 0 ? section.upper : [Text.GAP, ...section.upper],
    ),
    lower: sections.flatMap((section, index) =>
      index === 0 ? section.lower : [Text.GAP, ...section.lower],
    ),
  };
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

// One machine's card: its header, its two graph rows and the jobs running on it that fit.
export type Card = {
  readonly header: Text.Row;
  readonly upper: Text.Row;
  readonly lower: Text.Row;
  readonly jobs: ReadonlyArray<Text.Row>;
};

// Everything on the screen for one view at one size, in the order it is drawn: the machines
// box (its top border says how old the read is, its bottom where the window sits when more
// cards than fit), the queue box (its title counts what runs and waits, its bottom the window's
// place) and the footer.
export type Screen = {
  readonly status: string;
  readonly tab: Tab;
  readonly tabs: Text.Row;
  readonly pages: ReadonlyArray<Text.Row>;
  readonly body: ReadonlyArray<Text.Row>;
  readonly machines: {
    readonly cards: ReadonlyArray<Card>;
    readonly empty: Option.Option<string>;
    readonly place: Option.Option<string>;
  };
  readonly queue: {
    readonly title: string;
    readonly header: Text.Row;
    readonly jobs: ReadonlyArray<Text.Row>;
    readonly empty: Option.Option<string>;
    readonly place: Option.Option<string>;
  };
  readonly footer: { readonly left: Text.Row; readonly right: string };
  // The selected ticket's last image, over the session pane. Absent when there is none.
  readonly image: Option.Option<{
    readonly png: Uint8Array;
    readonly top: number;
    readonly height: number;
  }>;
};

// Where the session image sits: past the border, the sidebar and the calls column.
export const SESSION_IMAGE_LEFT = 2 + 26 + 3 + Follow.LEFT_COLS;

const card = (
  machine: Servers.Machine,
  series: Option.Option<ProcessStats.Series>,
  jobs: ReadonlyArray<Job>,
  header: Text.Piece,
  job: Option.Option<number>,
  hasFocus: boolean,
  drift: number,
  usable: number,
  now: number,
): Card => {
  const silent =
    machine.heartbeatAt !== null &&
    machine.queriedAt.getTime() - machine.heartbeatAt.getTime() + drift > SILENT_AFTER_MS;
  const graphs = cardGraphs(series, silent, usable);
  return {
    header: cardHeader(machine, header, silent, drift, usable),
    upper: graphs.upper,
    lower: graphs.lower,
    jobs: jobList(jobs, job, hasFocus, drift, now),
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
  const listed = ofTab(snapshot, "servers");
  if (listed.length === 0) {
    const kind = "qemu servers";
    return { cards: [], empty: Option.some(`no ${kind} registered`), place: Option.none() };
  }
  const drift = now - snapshot.readAt;
  const entries = entriesOf(snapshot, "servers");
  const selected = entries[clamp(view.cursor.servers, 0, entries.length - 1)];
  const chosen = listed.indexOf(selected.machine);
  // The three tab rows sit under the counts, so the cards have that much less room.
  const available = rows - 1 - (QUEUE_MIN_ROWS + 3) - 3 - PAGES.length;
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
    return card(machine, series, jobs, header, job, hasFocus, drift, usable, now);
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
    jobs: jobList(shown, Option.some(cursor - first), view.focus === "queue", drift, now),
    empty: Option.none(),
    place,
  };
};

const HINTS: ReadonlyArray<readonly [key: string, does: string]> = [
  ["j/k", "select"],
  ["s", "automation"],
  ["h/l", "tabs"],
  ["t", "tickets"],
  ["d", "definition"],
  ["enter", "info"],
  ["L", "linear"],
  ["a", "abort"],
  ["F", "follow"],
  ["q", "quit"],
];

// A's question: a box this wide in the middle of the screen, the job on its top border, the
// keys on its bottom one, and between them the question and the two answers, the marker on the
// one the keys are on. The width holds the longest job name and the keys on the borders.
export const CONFIRM_WIDTH = 44;
export const CONFIRM_HINT = "h/l choose   enter select   esc close";

export const confirmTitle = (asked: Confirm): string => `abort ${asked.action} ${asked.ticket}`;

const wrap = (text: string, width: number): ReadonlyArray<string> => {
  const plain = Text.clean(text).trim();
  if (plain.length === 0) {
    return ["—"];
  }
  const lines: Array<string> = [];
  let rest = plain;
  while (rest.length > width) {
    const at = rest.lastIndexOf(" ", width);
    const cut = at > 0 ? at : width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(at > 0 ? at + 1 : cut);
  }
  lines.push(rest);
  return lines;
};

const headed = (heading: string, text: string): ReadonlyArray<string> => [
  heading,
  ...wrap(text, SHEET_INNER),
  "",
];

// d's box: the name, then the three parts of the stored wording.
export const definitionSheet = (definition: {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
}): Sheet => ({
  title: definition.name,
  offset: 0,
  lines: [
    ...headed("description", definition.description),
    ...headed("instruction", definition.instruction),
    ...headed("proof", definition.proof),
  ],
});

const field = (name: string, value: string): string => `${name.padEnd(10)}${value}`;

// enter's box: what the row cannot hold. Ages are the same reading the columns use.
export const infoSheet = (job: Job, drift: number): Sheet => ({
  title: `ticket ${job.ticket ?? "—"}`,
  offset: 0,
  lines: [
    field("ticket", job.ticket ?? "—"),
    field("test", job.test),
    field("action", job.action),
    field("status", job.status),
    field("reason", job.reason ?? "—"),
    field("session", job.sessionId ?? "—"),
    field("client", job.clientUrl ?? "—"),
    field("server", job.serverUrl ?? "—"),
    field("queued", ago(job.createdAt, job.queriedAt, drift)),
    field("started", ago(job.startedAt, job.queriedAt, drift)),
    field("finished", ago(job.finishedAt, job.queriedAt, drift)),
  ],
});

export const sheetRows = (sheet: Sheet): ReadonlyArray<Text.Row> =>
  Array.from({ length: SHEET_ROWS }, (_, index) => {
    const line = sheet.lines[sheet.offset + index];
    return line === undefined ? [Text.SPACE] : [Text.value(Text.cut(line, SHEET_INNER))];
  });

export const SHEET_HINT = "j/k scroll   esc close";

export const confirmRows = (asked: Confirm): ReadonlyArray<Text.Row> => {
  const answer = (choice: Confirm["choice"]): Text.Piece =>
    asked.choice === choice
      ? { text: `▸ ${choice}`, color: PALETTE.gold, bold: true }
      : Text.muted(`  ${choice}`);
  return [
    [Text.value("are you sure?")],
    [Text.SPACE],
    [answer("yes"), { text: "    " }, answer("no")],
  ];
};

// The last row: the reason the last read failed, else what the last key had to say, else the
// keys with the name on the right. A reason is cut to the row less its padding.
const footer = (view: View, columns: number): Screen["footer"] => {
  if (Option.isSome(view.failure)) {
    return {
      left: [Text.paint(PALETTE.love, Text.cut(`error: ${view.failure.value}`, columns - 2))],
      right: "",
    };
  }
  if (Option.isSome(view.notice)) {
    return {
      left: [Text.paint(PALETTE.gold, Text.cut(view.notice.value, columns - 2))],
      right: "",
    };
  }
  return {
    left: HINTS.flatMap(([key, does], index) => [
      ...(index === 0 ? [] : [Text.muted("   ")]),
      Text.value(key),
      Text.muted(` ${does}`),
    ]),
    right: "oligarchy",
  };
};

// Thirty-second heartbeats: ten of them are the last five minutes the graph scales over.
const FIVE_MIN = 10;
const MEM = PALETTE.foam;
const CPU = PALETTE.gold;
// Braille dots, top to bottom, left half then right half.
const DOT_LEFT = [0x01, 0x02, 0x04, 0x40];
const DOT_RIGHT = [0x08, 0x10, 0x20, 0x80];

const PAGES: ReadonlyArray<readonly [Tab, string]> = [
  ["automation", "s  automation"],
  ["servers", "qemu servers"],
  ["tickets", "t  tickets"],
];

const pageRows = (view: View): ReadonlyArray<Text.Row> =>
  PAGES.map(([tab, label]) => {
    const on = view.tab === tab;
    const text = `${on ? "▸" : " "} ${label}`;
    return [on ? { text, color: PALETTE.gold, bold: true } : Text.muted(text)];
  });

// One column of the overlay: memory fills from the bottom in foam, the cpu line sits on top
// in gold. A cell that the line crosses is gold, so the line reads over the bars.
const columnGlyph = (
  row: number,
  totalDots: number,
  memoryDots: number,
  cpuDot: number,
): Text.Piece => {
  let bits = 0;
  let line = false;
  let bar = false;
  for (let dot = 0; dot < 4; dot++) {
    const fromBottom = totalDots - 1 - (row * 4 + dot);
    if (fromBottom === cpuDot) {
      bits |= DOT_LEFT[dot] | DOT_RIGHT[dot];
      line = true;
    } else if (fromBottom < memoryDots) {
      bits |= DOT_LEFT[dot] | DOT_RIGHT[dot];
      bar = true;
    }
  }
  if (!bar && !line) {
    return { text: " " };
  }
  return { text: String.fromCharCode(0x2800 + bits), color: line ? CPU : MEM };
};

const side = (text: string, width: number, color: string): Text.Piece =>
  Text.paint(color, Text.fit(text, width));

// Memory scaled from its low to its high over the last five minutes, cpu on 0–100, the
// current numbers in their colours at the edges.
const usage = (
  samples: ReadonlyArray<ProcessStats.Sample>,
  width: number,
  height: number,
): ReadonlyArray<Text.Row> => {
  const recent = samples.slice(-FIVE_MIN);
  const memory = recent.map((sample) => sample.memoryBytes);
  const low = memory.length === 0 ? 0 : Math.min(...memory);
  const high = memory.length === 0 ? 0 : Math.max(...memory);
  const span = Math.max(1, high - low);
  const totalDots = Math.max(1, height * 4);
  const graphWidth = Math.max(1, width - 18);
  const newest = recent.at(-1);
  return Array.from({ length: height }, (_, row) => {
    const cells = Array.from({ length: graphWidth }, (__, column) => {
      const index =
        recent.length === 0
          ? -1
          : Math.min(recent.length - 1, Math.floor((column * recent.length) / graphWidth));
      const sample = index < 0 ? undefined : recent[index];
      // A flat trace is both the low and the high, so it fills rather than disappearing.
      let memoryDots = 0;
      if (sample !== undefined) {
        memoryDots =
          high === low ? totalDots : Math.round(((sample.memoryBytes - low) / span) * totalDots);
      }
      const cpuDot =
        sample === undefined
          ? -1
          : Math.round((Math.min(100, Math.max(0, sample.cpuPercent)) / 100) * (totalDots - 1));
      return columnGlyph(row, totalDots, memoryDots, cpuDot);
    });
    const memoryNow = row === 0 && newest !== undefined ? size(newest.memoryBytes) : "";
    let memoryBound = "";
    if (row === 1) {
      memoryBound = size(high);
    } else if (row === height - 1) {
      memoryBound = size(low);
    }
    const cpuNow = row === 0 && newest !== undefined ? percent(newest.cpuPercent) : "";
    let cpuBound = "";
    if (row === 1) {
      cpuBound = "100%";
    } else if (row === height - 1) {
      cpuBound = "0%";
    }
    return [
      side(memoryNow || memoryBound, 8, memoryNow === "" ? PALETTE.muted : MEM),
      Text.SPACE,
      ...stroke(cells.map((cell) => ({ glyph: cell.text, color: cell.color ?? MEM }))),
      Text.SPACE,
      side(cpuNow || cpuBound, 7, cpuNow === "" ? PALETTE.muted : CPU),
    ];
  });
};

const automationRows = (
  view: View,
  snapshot: Snapshot,
  columns: number,
  height: number,
  now: number,
): ReadonlyArray<Text.Row> => {
  const inner = columns - 4;
  const entries = entriesOf(snapshot, "clients");
  if (entries.length === 0) {
    return Array.from({ length: height }, (_, row) =>
      row === 0 ? [Text.muted("no automation clients")] : [Text.SPACE],
    );
  }
  const cursor = clamp(view.cursor.clients, 0, entries.length - 1);
  const drift = now - snapshot.readAt;
  const left = entries.map((entry, index): Text.Row => {
    const on = index === cursor;
    if (Option.isNone(entry.job)) {
      return [marker(on, true), Text.SPACE, Text.strong(Text.fit(entry.machine.name ?? "—", 16))];
    }
    const job = jobsOn(snapshot, entry.machine)[entry.job.value];
    // Twenty-six columns: the indent, the marker, the ticket, then the spinner and either the
    // step (n/total) or how long it has run. "59 min ago" is ten and fills what is left; clip
    // bounds the line. The selected client's open follow wins over the polled intent, and a
    // follow with nothing still open shows the elapsed time rather than a stale poll.
    const color = ACTION_COLOR[job.action];
    const follow = Option.getOrNull(view.session);
    // The open follow has every intent still on screen, so a repeated line is the copy
    // those intents have reached. A follow with nothing still open keeps the elapsed time.
    let messages: ReadonlyArray<string> = job.intent === null ? [] : [job.intent];
    if (
      on &&
      job.ticket !== null &&
      follow !== null &&
      follow._tag === "full" &&
      follow.ticket === job.ticket
    ) {
      const said: Array<string> = [];
      let lastRunning = -1;
      for (const found of follow.entries) {
        if (found.id !== "intent") {
          continue;
        }
        if (found.state === "running") {
          lastRunning = said.length;
        }
        said.push(found.name);
      }
      messages = lastRunning === -1 ? [] : said.slice(0, lastRunning + 1);
    }
    const place = stepPlace(job, messages);
    return [
      Text.muted("  "),
      marker(on, true),
      Text.SPACE,
      Text.value(Text.fit(job.ticket ?? "—", 9)),
      Text.SPACE,
      Text.paint(color, spinnerAt(now)),
      Text.SPACE,
      Text.paint(color, place ?? ago(job.startedAt, job.queriedAt, drift)),
    ];
  });
  // Keep the marked row on screen, the window growing down from it.
  const from = Math.min(cursor, Math.max(0, left.length - height));
  const series = snapshot.series.find(
    (found) => found.type === "automation-client" && found.name === entries[cursor]?.machine.name,
  );
  // The graphs keep the top third. The rest is the selected ticket's session.
  const graphHeight = Math.max(1, Math.floor(height / 3));
  const plotted = usage(series?.samples ?? [], inner - 28, graphHeight);
  const session = sessionPane(view, height - graphHeight, now);
  return Array.from({ length: height }, (_, row) => {
    const line = left[from + row] ?? [Text.SPACE];
    const right = row < graphHeight ? plotted[row] : session[row - graphHeight];
    return [...clip(line, 26), Text.muted(" │ "), ...(right ?? [])];
  });
};

const sessionPane = (view: View, height: number, now: number): ReadonlyArray<Text.Row> => {
  const follow = Option.getOrNull(view.session);
  const lines = (): ReadonlyArray<Text.Row> => {
    if (follow === null) {
      return [[Text.muted(Option.getOrElse(view.sessionNote, () => "no session"))]];
    }
    if (follow._tag === "peek") {
      return [[Text.value(Follow.title(follow))], ...Follow.peekRows(follow, now)];
    }
    const job = Option.getOrNull(selectedJob(view));
    if (job !== null && job.ticket === follow.ticket) {
      const steps = Steps.stepsOf(job.instruction);
      if (steps.length > 0) {
        return Follow.ticketRows(follow, steps, height);
      }
    }
    return [Follow.fullHeader(follow), ...Follow.fullEntries(follow, Math.max(0, height - 1))];
  };
  const drawn = lines();
  return Array.from({ length: height }, (_, row) => drawn[row] ?? [Text.SPACE]);
};

const ticketRows = (
  view: View,
  snapshot: Snapshot,
  now: number,
  height: number,
): ReadonlyArray<Text.Row> => {
  const jobs = ticketsOf(snapshot);
  const drift = now - snapshot.readAt;
  const room = Math.max(1, height - 1);
  const cursor = jobs.length === 0 ? 0 : clamp(view.cursor.queue, 0, jobs.length - 1);
  const first = Math.max(0, Math.min(cursor, jobs.length - room));
  const listed =
    jobs.length === 0
      ? [jobHeader, [Text.muted("no tickets")]]
      : [
          jobHeader,
          ...jobList(
            jobs.slice(first, first + room),
            Option.some(cursor - first),
            true,
            drift,
            now,
          ),
        ];
  return Array.from({ length: height }, (_, row) => listed[row] ?? [Text.SPACE]);
};

// The machines box is as tall as its tabs and cards and the queue's box takes every other row
// above the footer, so the queue grows with the terminal.
export const screen = (view: View, now: number, columns: number, rows: number): Screen => {
  const tabs = tabsRow(view);
  const status = Option.match(view.snapshot, {
    onNone: () => "reading…",
    onSome: (snapshot) => `read ${Text.age(now - snapshot.readAt)} ago`,
  });
  const pages = pageRows(view);
  const blank = {
    status,
    tab: view.tab,
    tabs,
    pages,
    body: [],
    machines: { cards: [], empty: Option.none(), place: Option.none() },
    queue: {
      title: "automation",
      header: jobHeader,
      jobs: [],
      empty: Option.none(),
      place: Option.none(),
    },
    footer: footer(view, columns),
    image: Option.none(),
  };
  return Option.match(view.snapshot, {
    onNone: () => blank,
    onSome: (snapshot) => {
      if (view.tab !== "servers") {
        // Top and bottom borders, the counts, the tabs, and the footer, off the height.
        const height = Math.max(1, rows - 4 - PAGES.length);
        const graphHeight = Math.max(1, Math.floor(height / 3));
        const png =
          view.tab === "automation"
            ? Option.flatMap(view.session, (follow) => follow.png)
            : Option.none<Uint8Array>();
        return {
          ...blank,
          body:
            view.tab === "automation"
              ? automationRows(view, snapshot, columns, height, now)
              : ticketRows(view, snapshot, now, height),
          image: Option.map(png, (bytes) => ({
            png: bytes,
            top: 2 + PAGES.length + graphHeight,
            height: height - graphHeight,
          })),
        };
      }
      const shown = machines(view, snapshot, now, columns, rows);
      // Top border, the counts, the tab rows, bottom border, then each card and its divider.
      const height =
        3 +
        PAGES.length +
        (Option.isSome(shown.empty) ? 1 : 0) +
        shown.cards.reduce((total, drawn) => total + 3 + drawn.jobs.length, 0) +
        Math.max(0, shown.cards.length - 1);
      return {
        ...blank,
        machines: shown,
        queue: queue(view, snapshot, now, rows - 1 - height - 3),
      };
    },
  });
};
