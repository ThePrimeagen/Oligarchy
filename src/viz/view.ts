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

// The terminal this view is laid out for: the fleet table's seven columns and the queue's eight
// fit across 135 columns, and 37 rows hold both tables and a dozen jobs. Anything smaller is
// refused; anything larger goes to the job list and to the url and reason columns.
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

// More completed jobs than any terminal shows below the two tables.
export const COMPLETED_LIMIT = 100;

// The two tables are capped so the queue, the part that grows, keeps its rows.
export const PROCESS_ROWS = 6;
export const FLEET_ROWS = 6;

export const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l\x1b[2J";
export const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GRAY = "\x1b[90m";
const RED = "\x1b[31m";

const STATUS_COLOR: Readonly<Record<Automation.AutomationJobListRow["status"], string>> = {
  pending: GRAY,
  running: "\x1b[33m",
  succeeded: "\x1b[32m",
  failed: RED,
  aborted: "\x1b[91m",
  timed_out: "\x1b[35m",
};

// ---------------------------------------------------------------------------
// View: pure
// ---------------------------------------------------------------------------

// One read of the three tables and the local clock when it landed: an age on screen is the
// database's own difference at the read plus the time since.
export type Snapshot = {
  readonly readings: ReadonlyArray<ProcessStats.ProcessReading>;
  readonly fleet: ReadonlyArray<Servers.FleetServer>;
  readonly queue: Automation.AutomationQueue;
  readonly readAt: number;
};

// snapshot is absent until the first read lands; failure is the last read's reason, cleared by
// the next good read, so a database outage leaves the last picture up with the reason under it.
export type View = {
  readonly snapshot: Option.Option<Snapshot>;
  readonly failure: Option.Option<string>;
};

export const initialView: View = { snapshot: Option.none(), failure: Option.none() };

export const tooSmall = (columns: number, rows: number): string =>
  `viz needs a terminal of at least ${String(MIN_COLUMNS)}×${String(MIN_ROWS)} (columns×rows); this one is ${String(columns)}×${String(rows)}`;

const gigabytes = (bytes: number): string => (bytes / 1_000_000_000).toFixed(1);
const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1);
const percent = (value: number): string => `${value.toFixed(1)}%`;

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

// Exactly `width` columns: cut with an ellipsis or padded, so a row is as wide as its cells. A
// job's reason is a stderr tail and a driver's message can span lines: a control character
// would break the row or steer the terminal, so each is drawn as a space.
const fit = (text: string, width: number): string => {
  const plain = Array.from(text, (character) =>
    character < " " || character === "\u007f" ? " " : character,
  ).join("");
  return plain.length > width ? `${plain.slice(0, width - 1)}…` : plain.padEnd(width);
};

type Cell = {
  readonly text: string;
  readonly width: number;
  readonly color?: string;
  readonly right?: true;
};

const cell = (part: Cell): string => {
  const fitted = fit(part.right === true ? part.text.padStart(part.width) : part.text, part.width);
  return part.color === undefined ? fitted : `${part.color}${fitted}${RESET}`;
};

const row = (cells: ReadonlyArray<Cell>): string => cells.map(cell).join("  ");

const note = (color: string, text: string, columns: number): string =>
  `${color}${fit(text, columns)}${RESET}`;

const head = (title: string, detail: string, columns: number): string =>
  `${BOLD}${title}${RESET}${GRAY}${fit(` · ${detail}`, columns - title.length)}${RESET}`;

// Fixed widths fit each column's widest value; the one flexible column takes the rest, so the
// cells and the two spaces between them come to exactly `columns`.
const processWidths = (columns: number) => ({
  name: 14,
  type: 17,
  jobs: 4,
  cpu: 7,
  memory: 11,
  reported: columns - 14 - 17 - 4 - 7 - 11 - 5 * 2,
});

const fleetWidths = (columns: number) => ({
  name: 14,
  url: columns - 14 - 5 - 17 - 24 - 6 - 11 - 6 * 2,
  qemus: 5,
  memory: 17,
  cpu: 24,
  gen: 6,
  heartbeat: 11,
});

const jobWidths = (columns: number) => ({
  ticket: 9,
  test: 18,
  action: 9,
  status: 10,
  queued: 11,
  started: 11,
  finished: 11,
  reason: columns - 9 - 18 - 9 - 10 - 11 - 11 - 11 - 7 * 2,
});

const processHeader = (columns: number): string => {
  const w = processWidths(columns);
  return note(
    GRAY,
    row([
      { text: "name", width: w.name },
      { text: "type", width: w.type },
      { text: "jobs", width: w.jobs, right: true },
      { text: "cpu", width: w.cpu },
      { text: "memory", width: w.memory },
      { text: "reported", width: w.reported },
    ]),
    columns,
  );
};

// One process's newest word on itself, or the one word that says it stopped talking.
const processRow = (reading: ProcessStats.ProcessReading, drift: number, columns: number) => {
  const w = processWidths(columns);
  const sinceReport = reading.queriedAt.getTime() - reading.reportedAt.getTime() + drift;
  const numbers: ReadonlyArray<Cell> =
    sinceReport > SILENT_AFTER_MS
      ? [{ text: "silent", width: w.jobs + w.cpu + w.memory + 2 * 2, color: RED }]
      : [
          { text: String(reading.jobs), width: w.jobs, right: true },
          { text: percent(reading.cpuPercent), width: w.cpu },
          { text: `${megabytes(reading.memoryBytes)} MB`, width: w.memory },
        ];
  return row([
    { text: reading.name, width: w.name },
    { text: reading.type, width: w.type },
    ...numbers,
    { text: `${age(sinceReport)} ago`, width: w.reported },
  ]);
};

const fleetHeader = (columns: number): string => {
  const w = fleetWidths(columns);
  return note(
    GRAY,
    row([
      { text: "name", width: w.name },
      { text: "url", width: w.url },
      { text: "qemus", width: w.qemus, right: true },
      { text: "memory", width: w.memory },
      { text: "cpu 1m / 2m / 3m", width: w.cpu },
      { text: "gen", width: w.gen, right: true },
      { text: "heartbeat", width: w.heartbeat },
    ]),
    columns,
  );
};

// One server: what it said of itself, or the words that say it stopped saying it. stats and
// heartbeat_at are written together, so either being null is a row no server has claimed.
const fleetRow = (server: Servers.FleetServer, drift: number, columns: number): string => {
  const w = fleetWidths(columns);
  const span = w.qemus + w.memory + w.cpu + 2 * 2;
  const name: Cell = { text: server.name ?? "—", width: w.name };
  const url: Cell = { text: server.url, width: w.url };
  const generation: Cell = { text: String(server.generation), width: w.gen, right: true };
  if (server.stats === null || server.heartbeatAt === null) {
    return row([
      name,
      url,
      { text: "never heard from", width: span, color: GRAY },
      generation,
      { text: "never", width: w.heartbeat },
    ]);
  }
  const sinceHeartbeat = server.queriedAt.getTime() - server.heartbeatAt.getTime() + drift;
  const said: ReadonlyArray<Cell> =
    sinceHeartbeat > SILENT_AFTER_MS
      ? [{ text: "silent", width: span, color: RED }]
      : [
          { text: String(server.stats.qemus), width: w.qemus, right: true },
          {
            text: `${gigabytes(server.stats.memory.usedBytes)} / ${gigabytes(server.stats.memory.totalBytes)} GB`,
            width: w.memory,
          },
          {
            text: `${percent(server.stats.cpu.mean1m)} / ${percent(server.stats.cpu.mean2m)} / ${percent(server.stats.cpu.mean3m)}`,
            width: w.cpu,
          },
        ];
  return row([
    name,
    url,
    ...said,
    generation,
    { text: `${age(sinceHeartbeat)} ago`, width: w.heartbeat },
  ]);
};

const jobHeader = (columns: number): string => {
  const w = jobWidths(columns);
  return note(
    GRAY,
    row([
      { text: "ticket", width: w.ticket },
      { text: "test", width: w.test },
      { text: "action", width: w.action },
      { text: "status", width: w.status },
      { text: "queued", width: w.queued },
      { text: "started", width: w.started },
      { text: "finished", width: w.finished },
      { text: "reason", width: w.reason },
    ]),
    columns,
  );
};

// The columns are the same for every job, so a pending one shows dashes where its start and
// finish will go.
const jobRow = (job: Automation.AutomationJobListRow, drift: number, columns: number): string => {
  const w = jobWidths(columns);
  return row([
    { text: job.ticket ?? "—", width: w.ticket },
    { text: job.test, width: w.test },
    { text: job.action, width: w.action },
    { text: job.status, width: w.status, color: STATUS_COLOR[job.status] },
    { text: ago(job.createdAt, job.queriedAt, drift), width: w.queued },
    { text: ago(job.startedAt, job.queriedAt, drift), width: w.started },
    { text: ago(job.finishedAt, job.queriedAt, drift), width: w.finished },
    { text: job.reason ?? "", width: w.reason },
  ]);
};

// A table's rows within its cap, or the one line that says it is empty; past the cap the last
// row counts what was left out.
const body = (
  lines: ReadonlyArray<string>,
  cap: number,
  empty: string,
  columns: number,
): ReadonlyArray<string> => {
  if (lines.length === 0) {
    return [note(GRAY, empty, columns)];
  }
  if (lines.length <= cap) {
    return lines;
  }
  return [
    ...lines.slice(0, cap - 1),
    note(GRAY, `… ${String(lines.length - cap + 1)} more`, columns),
  ];
};

const title = (view: View, now: number, columns: number): string => {
  const name = "oligarchy servers";
  const status = Option.match(view.snapshot, {
    onNone: () => "reading…",
    onSome: (snapshot) => `read ${age(now - snapshot.readAt)} ago`,
  });
  return `${BOLD}${name}${RESET}${" ".repeat(columns - name.length - status.length)}${GRAY}${status}${RESET}`;
};

const footer = (view: View, columns: number): string =>
  Option.match(view.failure, {
    onNone: () => note(GRAY, `q quits · refreshes every ${String(REFRESH_SECONDS)} s`, columns),
    onSome: (reason) => note(RED, `error: ${reason}`, columns),
  });

// Every row is written over in full at the terminal's width with an absolute move and never a
// newline, so the screen never scrolls and a frame needs no clear. The title and the hint are
// always there; the tables only once a read has landed, so an unreadable database is never shown
// as an empty fleet. A terminal that shrank below the minimum gets the one sentence saying so
// until it grows back.
export const draw = (view: View, now: number, columns: number, rows: number): string => {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return `\x1b[2J\x1b[1;1H${RED}${tooSmall(columns, rows)}${RESET}`;
  }
  const blank = " ".repeat(columns);
  const lines: Array<string> = [title(view, now, columns)];
  if (Option.isSome(view.snapshot)) {
    const { readings, fleet, queue, readAt } = view.snapshot.value;
    const drift = now - readAt;
    lines.push(
      head("process", String(readings.length), columns),
      processHeader(columns),
      ...body(
        readings.map((reading) => processRow(reading, drift, columns)),
        PROCESS_ROWS,
        "no process stats",
        columns,
      ),
      blank,
      head("qemu servers", String(fleet.length), columns),
      fleetHeader(columns),
      ...body(
        fleet.map((server) => fleetRow(server, drift, columns)),
        FLEET_ROWS,
        "no servers registered",
        columns,
      ),
      blank,
      head(
        "automation",
        `running ${String(queue.running.length)} · pending ${String(queue.pending.length)}`,
        columns,
      ),
      jobHeader(columns),
    );
    const jobs = [...queue.running, ...queue.pending, ...queue.completed].map((job) =>
      jobRow(job, drift, columns),
    );
    // Whatever is left above the footer.
    lines.push(...body(jobs, rows - lines.length - 1, "none", columns));
  }
  const filler = Array.from({ length: rows - 1 - lines.length }, () => blank);
  lines.push(...filler, footer(view, columns));
  return lines.map((line, index) => `\x1b[${String(index + 1)};1H${line}`).join("");
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const isQuit = (input: Terminal.UserInput): boolean =>
  input.key.name === "q" && !input.key.ctrl && !input.key.meta;

// Owns the alternate screen while it runs: the tables are read at once and every REFRESH, the
// ages repainted every AGE_TICK at whatever size the terminal has by then, and q or the input
// ending (ctrl-c, in raw mode) hands the screen back. A read that fails leaves the last picture
// up with its reason on the footer; a frame stdout refuses ends the run with that failure.
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
  const paint = Effect.gen(function* () {
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
    const readings = yield* processStats.listNewest();
    const fleet = yield* servers.listFleet();
    const queue = yield* automation.listJobs(COMPLETED_LIMIT);
    yield* Ref.set(view, {
      snapshot: Option.some({ readings, fleet, queue, readAt }),
      failure: Option.none(),
    });
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
  const quit = Effect.gen(function* () {
    const keys = yield* terminal.readInput;
    yield* Stream.runHead(Stream.filter(Stream.fromQueue(keys), isQuit));
  });
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(terminal.display(ENTER_SCREEN), () =>
        // A stdout that refused a frame refuses the restore too; there is nowhere left to say so.
        Effect.ignore(terminal.display(LEAVE_SCREEN)),
      );
      yield* Effect.raceFirst(
        quit,
        Effect.raceFirst(
          Effect.repeat(Effect.andThen(read, paint), Schedule.spaced(REFRESH)),
          Effect.schedule(paint, Schedule.spaced(AGE_TICK)),
        ),
      );
    }),
  );
});
