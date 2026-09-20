import { and, desc, eq, getTableColumns, inArray, like, lt, or, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  actions,
  agentRuns,
  agentServers,
  automationJobs,
  debugLogs,
  images,
  logs,
  postRunDiagnosis,
  processStats,
  servers,
  sessionServers,
  sessions,
  testBasePrompts,
  testDefinitions,
  testResults,
  testRuns,
} from "../db/schema.ts";

export type Session = typeof sessions.$inferSelect & {
  imageId: string | null;
  queriedAt: Date;
  // The definition the session's result ran, and which wording of it: null together when the
  // session has no result.
  definitionName: string | null;
  definitionVersion: number | null;
  model: string | null;
};

export type TestDefinition = typeof testDefinitions.$inferSelect;
export type TestBasePrompt = typeof testBasePrompts.$inferSelect;

// One server of the fleet with what it last said of itself, and the database's clock at the
// read, so the page measures a heartbeat's age against the clock that stamped it.
export type Server = Pick<
  typeof servers.$inferSelect,
  "url" | "name" | "stats" | "generation" | "heartbeatAt"
> & {
  readonly queriedAt: Date;
};

// One automation job with the ticket and test it is for, its three stamps, and the database's
// clock at the read, so the page measures their ages against the clock that wrote them. ticket
// is null for a result nobody has ticketed; started_at and finished_at are null until the job
// reaches that point.
export type AutomationJob = {
  readonly ticket: string | null;
  readonly test: string;
  readonly action: (typeof automationJobs.$inferSelect)["action"];
  readonly status: (typeof automationJobs.$inferSelect)["status"];
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly queriedAt: Date;
};

// The queue as the page shows it: what runs, what waits, what finished, each list cut at fifty.
export type AutomationQueue = {
  readonly running: ReadonlyArray<AutomationJob>;
  readonly pending: ReadonlyArray<AutomationJob>;
  readonly completed: ReadonlyArray<AutomationJob>;
};

// One process's word on itself: current jobs, VmRSS of this process and every child that
// still answers, cpu over the last thirty seconds, and the database's clock at the read so
// the page measures the report's age against the clock that stamped it.
export type ProcessStat = {
  readonly name: string;
  readonly type: (typeof processStats.$inferSelect)["type"];
  readonly jobs: number;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
  readonly reportedAt: Date;
  readonly queriedAt: Date;
};

// One heartbeat in a name's series. The page draws one sample on the combined graph, oldest on the left.
export type ProcessSample = {
  readonly jobs: number;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
  readonly reportedAt: Date;
};

// The newest reading plus the window the graphs use. samples is oldest first and always has
// the newest as its last element, the same values as the current fields.
export type ProcessSeries = ProcessStat & {
  readonly samples: ReadonlyArray<ProcessSample>;
};

// 60 samples of 30 s is a thirty-minute window.
const PROCESS_SERIES_LIMIT = 60;

// One name's wordings, oldest first: versions[i] is version i + 1, and the last is the newest.
export type DefinitionVersions = {
  readonly name: string;
  readonly versions: ReadonlyArray<TestDefinition>;
};

export type DefinitionStat = {
  readonly name: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly other: number;
  readonly models: ReadonlyArray<string>;
};

// One result with the wording it pinned and the run it belongs to. createdAt and finishedAt
// are the result's own stamps; the session stamps are null until a session ran it.
export type TestResultOutcome = {
  readonly definitionId: number;
  readonly model: string | null;
  readonly status: (typeof testResults.$inferSelect)["status"];
  readonly runId: string;
  readonly iso: string;
  readonly startedAt: Date;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly sessionStartedAt: Date | null;
  readonly sessionEndedAt: Date | null;
};

export type ModelStat = {
  readonly model: string;
  readonly succeeded: number;
  readonly failed: number;
};

export type VersionStat = {
  readonly version: number;
  readonly succeeded: number;
  readonly failed: number;
};

export type DurationBar = {
  readonly ms: number;
  readonly succeeded: boolean;
};

export type DurationPercentiles = {
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p99: number;
};

export type DurationChart = {
  readonly bars: ReadonlyArray<DurationBar>;
  readonly percentiles: DurationPercentiles | undefined;
};

// 50 samples is what the sessions page already shows.
const DURATION_RUNS = 50;

// One connection per call, ended whether the query returned, threw, or never connected;
// a client left open holds a Hyperdrive connection for the rest of the request.
async function withDatabase<T>(
  connectionString: string,
  run: (db: NodePgDatabase) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
}

export function definitionStats(rows: ReadonlyArray<Session>): DefinitionStat[] {
  const byName = new Map<
    string,
    { succeeded: number; failed: number; other: number; models: Set<string> }
  >();
  for (const session of rows) {
    if (session.definitionName === null) {
      continue;
    }
    const current = byName.get(session.definitionName) ?? {
      succeeded: 0,
      failed: 0,
      other: 0,
      models: new Set<string>(),
    };
    if (session.status === "succeeded") {
      current.succeeded += 1;
    } else if (session.status === "failed") {
      current.failed += 1;
    } else {
      current.other += 1;
    }
    if (session.model !== null) {
      current.models.add(session.model);
    }
    byName.set(session.definitionName, current);
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, current]) => ({
      name,
      succeeded: current.succeeded,
      failed: current.failed,
      other: current.other,
      models: [...current.models].sort(),
    }));
}

// The rows by name, names ordered, each name's wordings oldest first by id.
export function groupDefinitions(rows: ReadonlyArray<TestDefinition>): DefinitionVersions[] {
  const byName = new Map<string, TestDefinition[]>();
  for (const row of rows) {
    byName.set(row.name, [...(byName.get(row.name) ?? []), row]);
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, versions]) => ({
      name,
      versions: versions.sort((left, right) => left.id - right.id),
    }));
}

// The definition a name's page opens, every wording of it. A name nobody carries selects nothing,
// so the route can answer 404 rather than show another definition under a URL that names this one.
export function selectDefinition(
  groups: ReadonlyArray<DefinitionVersions>,
  name: string,
): DefinitionVersions | undefined {
  return groups.find((group) => group.name === name);
}

// Passed and failed per wording of one name, oldest first; a wording with neither is left out.
export function versionStats(
  versions: ReadonlyArray<TestDefinition>,
  rows: ReadonlyArray<TestResultOutcome>,
): VersionStat[] {
  return versions.flatMap((definition, index) => {
    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.definitionId !== definition.id) {
        continue;
      }
      if (row.status === "passed") {
        succeeded += 1;
      } else if (row.status === "failed") {
        failed += 1;
      }
    }
    return succeeded + failed === 0 ? [] : [{ version: index + 1, succeeded, failed }];
  });
}

export function modelStats(rows: ReadonlyArray<TestResultOutcome>): ModelStat[] {
  const byModel = new Map<string, { succeeded: number; failed: number }>();
  for (const row of rows) {
    if (row.model === null || (row.status !== "passed" && row.status !== "failed")) {
      continue;
    }
    const current = byModel.get(row.model) ?? { succeeded: 0, failed: 0 };
    if (row.status === "passed") {
      current.succeeded += 1;
    } else {
      current.failed += 1;
    }
    byModel.set(row.model, current);
  }
  return [...byModel.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, current]) => ({
      model,
      succeeded: current.succeeded,
      failed: current.failed,
    }));
}

const durationOf = (row: TestResultOutcome): number | undefined => {
  if (row.sessionStartedAt !== null && row.sessionEndedAt !== null) {
    const ms = row.sessionEndedAt.getTime() - row.sessionStartedAt.getTime();
    return ms < 0 ? undefined : ms;
  }
  if (row.finishedAt === null) {
    return undefined;
  }
  const ms = row.finishedAt.getTime() - row.createdAt.getTime();
  return ms < 0 ? undefined : ms;
};

const finishedAt = (row: TestResultOutcome): number =>
  (row.finishedAt ?? row.sessionEndedAt ?? row.startedAt).getTime();

// Nearest rank: the value at ceil(p/100 * n), 1-indexed, for a non-empty sorted list.
const percentileAt = (sorted: ReadonlyArray<number>, p: number): number =>
  sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? 0;

// Passed and failed runs that have a duration, the newest 50, then shortest first. A wording
// with neither is an empty chart.
export function durationChart(rows: ReadonlyArray<TestResultOutcome>): DurationChart {
  const timed = rows.flatMap((row) => {
    if (row.status !== "passed" && row.status !== "failed") {
      return [];
    }
    const ms = durationOf(row);
    return ms === undefined ? [] : [{ row, ms }];
  });
  timed.sort((left, right) => finishedAt(right.row) - finishedAt(left.row));
  const newest = timed.slice(0, DURATION_RUNS);
  newest.sort((left, right) => left.ms - right.ms);
  const bars = newest.map((item) => ({
    ms: item.ms,
    succeeded: item.row.status === "passed",
  }));
  if (bars.length === 0) {
    return { bars, percentiles: undefined };
  }
  const sorted = bars.map((bar) => bar.ms);
  return {
    bars,
    percentiles: {
      p10: percentileAt(sorted, 10),
      p25: percentileAt(sorted, 25),
      p50: percentileAt(sorted, 50),
      p75: percentileAt(sorted, 75),
      p90: percentileAt(sorted, 90),
      p99: percentileAt(sorted, 99),
    },
  };
}

export function listSessions(connectionString: string): Promise<Session[]> {
  return withDatabase(connectionString, (db) => {
    const recentSessions = db
      .select({
        id: sessions.id,
        config: sessions.config,
        status: sessions.status,
        reason: sessions.reason,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(50)
      .as("recent_sessions");
    const latestImage = db
      .select({ id: images.id })
      .from(images)
      .innerJoin(actions, eq(actions.id, images.actionId))
      .where(eq(actions.sessionId, recentSessions.id))
      .orderBy(desc(actions.id))
      .limit(1)
      .as("latest_image");

    // A wording's version is its place among its name's rows by id.
    const wordings = db
      .select({
        id: testDefinitions.id,
        name: testDefinitions.name,
        version:
          sql<number>`row_number() over (partition by ${testDefinitions.name} order by ${testDefinitions.id})`
            .mapWith(Number)
            .as("version"),
      })
      .from(testDefinitions)
      .as("wordings");

    // The database timestamp shown by the UI also keeps status reads out of Hyperdrive's query cache.
    return db
      .select({
        id: recentSessions.id,
        config: recentSessions.config,
        status: recentSessions.status,
        reason: recentSessions.reason,
        startedAt: recentSessions.startedAt,
        endedAt: recentSessions.endedAt,
        imageId: latestImage.id,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(recentSessions.startedAt),
        definitionName: wordings.name,
        definitionVersion: wordings.version,
        model: testResults.model,
      })
      .from(recentSessions)
      .leftJoin(testResults, eq(testResults.sessionId, recentSessions.id))
      .leftJoin(wordings, eq(wordings.id, testResults.definitionId))
      .leftJoinLateral(latestImage, sql`true`)
      .orderBy(desc(recentSessions.startedAt));
  });
}

export function getImage(connectionString: string, id: string): Promise<Buffer | undefined> {
  return withDatabase(connectionString, async (db) => {
    const [row] = await db
      .select({
        data: images.data,
        queriedAt: sql`CURRENT_TIMESTAMP`,
      })
      .from(images)
      .where(eq(images.id, id));
    return row?.data;
  });
}

// Every wording of every definition, by name then oldest first. The clock in the select keeps the
// list out of Hyperdrive's query cache: the page after a save must show the wording just written.
export function listTestDefinitions(connectionString: string): Promise<TestDefinition[]> {
  return withDatabase(connectionString, (db) =>
    db
      .select({ ...getTableColumns(testDefinitions), queriedAt: sql`CURRENT_TIMESTAMP` })
      .from(testDefinitions)
      .orderBy(testDefinitions.name, testDefinitions.id),
  );
}

export type Wording = {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
};

// A new wording of a known name: a row is never updated, so the edit is an insert, and the newest
// wording read again is not a new one. A name nobody carries is a new test, which is ctrl's. The
// newest wording is read past Hyperdrive's cache, the same way, so a save compares with what is.
export function reviseTestDefinition(
  connectionString: string,
  wording: Wording,
): Promise<"unknown" | "unchanged" | "revised"> {
  return withDatabase(connectionString, async (db) => {
    const [newest] = await db
      .select({ ...getTableColumns(testDefinitions), queriedAt: sql`CURRENT_TIMESTAMP` })
      .from(testDefinitions)
      .where(eq(testDefinitions.name, wording.name))
      .orderBy(desc(testDefinitions.id))
      .limit(1);
    if (newest === undefined) {
      return "unknown";
    }
    if (
      newest.description === wording.description &&
      newest.instruction === wording.instruction &&
      newest.proof === wording.proof
    ) {
      return "unchanged";
    }
    await db.insert(testDefinitions).values(wording);
    return "revised";
  });
}

export function listTestResultOutcomes(connectionString: string): Promise<TestResultOutcome[]> {
  return withDatabase(connectionString, (db) =>
    db
      .select({
        definitionId: testResults.definitionId,
        model: testResults.model,
        status: testResults.status,
        runId: testResults.runId,
        iso: testRuns.iso,
        startedAt: testRuns.startedAt,
        createdAt: testResults.createdAt,
        finishedAt: testResults.finishedAt,
        sessionStartedAt: sessions.startedAt,
        sessionEndedAt: sessions.endedAt,
      })
      .from(testResults)
      .innerJoin(testRuns, eq(testRuns.id, testResults.runId))
      .leftJoin(sessions, eq(sessions.id, testResults.sessionId)),
  );
}

export function listTestBasePrompts(connectionString: string): Promise<TestBasePrompt[]> {
  return withDatabase(connectionString, (db) =>
    db.select().from(testBasePrompts).orderBy(testBasePrompts.name),
  );
}

// The qemu fleet in registration order. automation-client rows share the table and are listed
// apart. The clock in the select is the one a heartbeat's age is read against, and it keeps a
// poll out of Hyperdrive's query cache: every poll sees the newest write.
export function listServers(connectionString: string): Promise<Server[]> {
  return withDatabase(connectionString, (db) =>
    db
      .select({
        url: servers.url,
        name: servers.name,
        stats: servers.stats,
        generation: servers.generation,
        heartbeatAt: servers.heartbeatAt,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(servers.createdAt),
      })
      .from(servers)
      .where(eq(servers.type, "qemu"))
      .orderBy(servers.createdAt, servers.url),
  );
}

// Fifty of each list: an operator reads the front of the queue and what finished last.
const QUEUE_LIMIT = 50;

// The queue in three lists, each ordered and cut by the database. Running and pending put the
// diagnoses ahead of the drives and then follow queue order, created_at (a boolean sorts false
// before true, so descending puts the diagnoses first). Completed is every terminal status,
// newest finished first: finished_at is the stamp the close writes, the row's last change. The
// clock in each select is the one the stamps' ages are read against, and it keeps a poll out of
// Hyperdrive's query cache.
export function listAutomationQueue(connectionString: string): Promise<AutomationQueue> {
  return withDatabase(connectionString, async (db) => {
    const jobs = () =>
      db
        .select({
          ticket: testResults.linearId,
          test: testDefinitions.name,
          action: automationJobs.action,
          status: automationJobs.status,
          reason: automationJobs.reason,
          createdAt: automationJobs.createdAt,
          startedAt: automationJobs.startedAt,
          finishedAt: automationJobs.finishedAt,
          queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(automationJobs.createdAt),
        })
        .from(automationJobs)
        .innerJoin(testResults, eq(testResults.id, automationJobs.resultId))
        .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId));
    const diagnosesFirst = desc(sql`${automationJobs.action} = 'diagnose'`);
    const running = await jobs()
      .where(eq(automationJobs.status, "running"))
      .orderBy(diagnosesFirst, automationJobs.createdAt)
      .limit(QUEUE_LIMIT);
    const pending = await jobs()
      .where(eq(automationJobs.status, "pending"))
      .orderBy(diagnosesFirst, automationJobs.createdAt)
      .limit(QUEUE_LIMIT);
    const completed = await jobs()
      .where(inArray(automationJobs.status, ["succeeded", "failed", "aborted", "timed_out"]))
      .orderBy(desc(automationJobs.finishedAt))
      .limit(QUEUE_LIMIT);
    return { running, pending, completed };
  });
}

// Every job that is running, in the queue's running order: diagnoses ahead of drives, then
// created_at. The definitions page lists what is in flight so an operator can stop it; the
// queue's fifty would hide one.
export function listRunningAutomationJobs(connectionString: string): Promise<AutomationJob[]> {
  return withDatabase(connectionString, (db) =>
    db
      .select({
        ticket: testResults.linearId,
        test: testDefinitions.name,
        action: automationJobs.action,
        status: automationJobs.status,
        reason: automationJobs.reason,
        createdAt: automationJobs.createdAt,
        startedAt: automationJobs.startedAt,
        finishedAt: automationJobs.finishedAt,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(automationJobs.createdAt),
      })
      .from(automationJobs)
      .innerJoin(testResults, eq(testResults.id, automationJobs.resultId))
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .where(eq(automationJobs.status, "running"))
      .orderBy(desc(sql`${automationJobs.action} = 'diagnose'`), automationJobs.createdAt),
  );
}

// The newest two hundred lines the follow shows. An older intent still indents the actions that
// stay in the window, so the cut happens after that indent is known.
export const FOLLOW_LIMIT = 200;

export type FollowLog = {
  readonly text: string;
  readonly at: Date;
};

export type FollowAction = {
  readonly name: string;
  readonly state: "running" | "completed" | "failed";
  readonly at: Date;
};

// An intent the agent announced, or a QMP command sent while one was open (`under`).
export type FollowEvent =
  | {
      readonly kind: "intent";
      readonly text: string;
      readonly state: "running" | "completed";
      readonly at: Date;
    }
  | {
      readonly kind: "action";
      readonly name: string;
      readonly state: "running" | "completed" | "failed";
      readonly under: boolean;
      readonly at: Date;
    };

// What the ticket page shows, read from Postgres. The dashboard never calls the qemu server:
// intents, QMP commands and the newest screenshot are the operator-visible part of a terminal
// follow. waiting is a ticket whose session has not started and whose job is still in flight.
export type SessionFollow = {
  readonly ticket: string;
  readonly sessionId: string | null;
  readonly status:
    | "downloading"
    | "running"
    | "succeeded"
    | "failed"
    | "aborted"
    | "timed_out"
    | null;
  readonly imageId: string | null;
  readonly instruction: string;
  readonly events: ReadonlyArray<FollowEvent>;
  readonly waiting: boolean;
  readonly queriedAt: Date;
};

// A stored action is the QMP request; `execute` is the command name the follow prints. Anything
// else is not a command.
export const actionName = (request: unknown): string => {
  if (typeof request !== "object" || request === null) {
    return "?";
  }
  const execute = (request as { readonly execute?: unknown }).execute;
  return typeof execute === "string" && execute.length > 0 ? execute : "?";
};

const INTENT_START = "intent start; ";

// Logs and commands into one time order. Same-millisecond ties keep input order, and the logs
// are handed in before the commands, so a log written with a command precedes it. Indent is
// decided before the window is cut, so an action stays under an intent the window no longer shows.
export function followEvents(
  lines: ReadonlyArray<FollowLog>,
  commands: ReadonlyArray<FollowAction>,
): FollowEvent[] {
  const stamped = [
    ...lines.map((line, index) => ({
      kind: "log" as const,
      text: line.text,
      at: line.at,
      index,
    })),
    ...commands.map((command, index) => ({
      kind: "action" as const,
      name: command.name,
      state: command.state,
      at: command.at,
      index: lines.length + index,
    })),
  ].sort((left, right) => left.at.getTime() - right.at.getTime() || left.index - right.index);

  const events: FollowEvent[] = [];
  let open: number | undefined;
  for (const item of stamped) {
    if (item.kind === "log") {
      if (item.text.startsWith(INTENT_START)) {
        const text = item.text.slice(INTENT_START.length);
        if (text.length === 0) {
          continue;
        }
        if (open !== undefined) {
          const previous = events[open];
          if (previous !== undefined && previous.kind === "intent") {
            events[open] = { ...previous, state: "completed" };
          }
        }
        open = events.length;
        events.push({ kind: "intent", text, state: "running", at: item.at });
      } else if (item.text === "intent end" && open !== undefined) {
        const previous = events[open];
        if (previous !== undefined && previous.kind === "intent") {
          events[open] = { ...previous, state: "completed" };
        }
        open = undefined;
      }
      continue;
    }
    events.push({
      kind: "action",
      name: item.name,
      state: item.state,
      under: open !== undefined,
      at: item.at,
    });
  }
  return events.length > FOLLOW_LIMIT ? events.slice(events.length - FOLLOW_LIMIT) : events;
}

// One ticket's follow, or undefined when no result carries that Linear id. Intent logs and
// actions are the newest FOLLOW_LIMIT, reversed to chronological; the clock in every select is
// the one ages are read against, and it keeps a poll out of Hyperdrive's query cache.
export function readSessionFollow(
  connectionString: string,
  ticket: string,
): Promise<SessionFollow | undefined> {
  return withDatabase(connectionString, async (db) => {
    const clock = sql<Date>`CURRENT_TIMESTAMP`.mapWith(testResults.createdAt);
    const [result] = await db
      .select({
        sessionId: testResults.sessionId,
        instruction: testDefinitions.instruction,
        status: sessions.status,
        queriedAt: clock,
      })
      .from(testResults)
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .leftJoin(sessions, eq(sessions.id, testResults.sessionId))
      .where(eq(testResults.linearId, ticket))
      .limit(1);
    if (result === undefined) {
      return undefined;
    }

    let waiting = false;
    if (result.sessionId === null) {
      const [job] = await db
        .select({
          id: automationJobs.id,
          queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(automationJobs.createdAt),
        })
        .from(automationJobs)
        .innerJoin(testResults, eq(testResults.id, automationJobs.resultId))
        .where(
          and(
            eq(testResults.linearId, ticket),
            inArray(automationJobs.status, ["pending", "running"]),
          ),
        )
        .limit(1);
      waiting = job !== undefined;
      return {
        ticket,
        sessionId: null,
        status: null,
        imageId: null,
        instruction: result.instruction,
        events: [],
        waiting,
        queriedAt: result.queriedAt,
      };
    }

    const logRows = await db
      .select({
        text: logs.text,
        at: logs.createdAt,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(logs.createdAt),
      })
      .from(logs)
      .where(
        and(
          eq(logs.location, result.sessionId),
          or(like(logs.text, "intent start; %"), eq(logs.text, "intent end")),
        ),
      )
      .orderBy(desc(logs.id))
      .limit(FOLLOW_LIMIT);
    const actionRows = await db
      .select({
        request: actions.request,
        state: actions.state,
        at: actions.createdAt,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(actions.createdAt),
      })
      .from(actions)
      .where(eq(actions.sessionId, result.sessionId))
      .orderBy(desc(actions.id))
      .limit(FOLLOW_LIMIT);
    const [image] = await db
      .select({
        id: images.id,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(actions.createdAt),
      })
      .from(images)
      .innerJoin(actions, eq(actions.id, images.actionId))
      .where(eq(actions.sessionId, result.sessionId))
      .orderBy(desc(actions.id))
      .limit(1);

    return {
      ticket,
      sessionId: result.sessionId,
      status: result.status,
      imageId: image?.id ?? null,
      instruction: result.instruction,
      events: followEvents(
        logRows.toReversed().map((row) => ({ text: row.text, at: row.at })),
        actionRows.toReversed().map((row) => ({
          name: actionName(row.request),
          state: row.state ?? "running",
          at: row.at,
        })),
      ),
      waiting,
      queriedAt: result.queriedAt,
    };
  });
}

// Closes the one job a ticket has for the action ((result_id, action) is unique), and only from
// the status named, so the two closes stay apart: a pending row has no client to stop and this
// write is its whole abort; a running row is the automation server's to stop and this write is
// the fallback when it could not. A finished job is left as it is. The status condition is what
// keeps a claim in flight honest: the dispatcher locks the pending row it takes, so this update
// waits and then finds it running, or lands first and the claim never sees it. reason and
// finished_at are written with the status so the queue shows the close.
export function abortAutomationJob(
  connectionString: string,
  ticket: string,
  action: (typeof automationJobs.$inferSelect)["action"],
  from: "pending" | "running",
): Promise<boolean> {
  return withDatabase(connectionString, async (db) => {
    const rows = await db
      .update(automationJobs)
      .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
      .where(
        and(
          eq(automationJobs.action, action),
          eq(automationJobs.status, from),
          inArray(
            automationJobs.resultId,
            db
              .select({ id: testResults.id })
              .from(testResults)
              .where(eq(testResults.linearId, ticket)),
          ),
        ),
      )
      .returning({ id: automationJobs.id });
    return rows.length > 0;
  });
}

// Readings already ordered by type, name, then reported_at: consecutive rows of the same
// name and kind become one series, the last row the current reading.
export function groupProcessSeries(rows: ReadonlyArray<ProcessStat>): ProcessSeries[] {
  const series: ProcessSeries[] = [];
  for (const row of rows) {
    const sample = {
      jobs: row.jobs,
      memoryBytes: row.memoryBytes,
      cpuPercent: row.cpuPercent,
      reportedAt: row.reportedAt,
    };
    const last = series.at(-1);
    if (last !== undefined && last.name === row.name && last.type === row.type) {
      series[series.length - 1] = {
        ...row,
        samples: [...last.samples, sample],
      };
    } else {
      series.push({ ...row, samples: [sample] });
    }
  }
  return series;
}

// The newest reading per name, qemu and automation-client together, by kind then name. The
// clock in the select is the one a report's age is read against, and it keeps a poll out of
// Hyperdrive's query cache. Older rows stay in the table for the series the graphs read.
export function listProcessStats(connectionString: string): Promise<ProcessStat[]> {
  return withDatabase(connectionString, (db) =>
    db
      .selectDistinctOn([processStats.type, processStats.name], {
        name: processStats.name,
        type: processStats.type,
        jobs: processStats.jobs,
        memoryBytes: processStats.memoryBytes,
        cpuPercent: processStats.cpuPercent,
        reportedAt: processStats.reportedAt,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(processStats.reportedAt),
      })
      .from(processStats)
      .orderBy(processStats.type, processStats.name, desc(processStats.reportedAt)),
  );
}

// The last thirty minutes per name, oldest first inside each series, names in the same
// order as listProcessStats. The time filter keeps the rank off the whole table; the
// rank then caps a chatty host at sixty samples. The clock in the select keeps a poll
// out of Hyperdrive's query cache.
export function listProcessSeries(connectionString: string): Promise<ProcessSeries[]> {
  return withDatabase(connectionString, async (db) => {
    const ranked = db
      .select({
        name: processStats.name,
        type: processStats.type,
        jobs: processStats.jobs,
        memoryBytes: processStats.memoryBytes,
        cpuPercent: processStats.cpuPercent,
        reportedAt: processStats.reportedAt,
        rank: sql<number>`row_number() over (partition by ${processStats.type}, ${processStats.name} order by ${processStats.reportedAt} desc)`
          .mapWith(Number)
          .as("rn"),
      })
      .from(processStats)
      .where(sql`${processStats.reportedAt} > now() - interval '30 minutes'`)
      .as("process_series");
    const rows = await db
      .select({
        name: ranked.name,
        type: ranked.type,
        jobs: ranked.jobs,
        memoryBytes: ranked.memoryBytes,
        cpuPercent: ranked.cpuPercent,
        reportedAt: ranked.reportedAt,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(processStats.reportedAt),
      })
      .from(ranked)
      .where(sql`${ranked.rank} <= ${PROCESS_SERIES_LIMIT}`)
      .orderBy(ranked.type, ranked.name, ranked.reportedAt);
    return groupProcessSeries(rows);
  });
}

// Registering a url twice is one row; the server fills the rest in when it announces itself. The
// add box names a qemu server, the one kind an operator can add; the server's heartbeat is the
// word on what it is.
export function addServer(connectionString: string, url: string): Promise<void> {
  return withDatabase(connectionString, async (db) => {
    await db.insert(servers).values({ url, type: "qemu" }).onConflictDoNothing();
  });
}

// false when nothing was registered under the url: the route turns that into its 404.
export function removeServer(connectionString: string, url: string): Promise<boolean> {
  return withDatabase(connectionString, async (db) => {
    const rows = await db
      .delete(servers)
      .where(eq(servers.url, url))
      .returning({ url: servers.url });
    return rows.length > 0;
  });
}

// Thirty days: the pages read the last fifty of anything and the last thirty minutes of process
// stats, so a month back is history nobody opens, and the images are the bytes that grow.
export const RETENTION_DAYS = 30;

// How many rows each table lost, in the order they were deleted.
export type DeletedRows = {
  readonly automationJobs: number;
  readonly testResults: number;
  readonly testRuns: number;
  readonly images: number;
  readonly actions: number;
  readonly agentRuns: number;
  readonly debugLogs: number;
  readonly postRunDiagnosis: number;
  readonly sessionServers: number;
  readonly sessions: number;
  readonly logs: number;
  readonly processStats: number;
  readonly agentServers: number;
};

// pg counts a DELETE's rows; the null in its type is for statements that have none.
const rowCount = (result: { readonly rowCount: number | null }): number => result.rowCount ?? 0;

// The retention sweep the cron runs: every row older than RETENTION_DAYS, in one transaction, so
// one now() is the cutoff and a refused delete leaves everything in place. A session and a run
// are old by their start and take what hangs off them whatever its own stamp; nothing cascades,
// so a row goes before the row it references — the literal below runs top to bottom. A result's
// session starts after the result, so an old session's result belongs to an older run and is gone
// before the session. Definitions, base prompts, error types and the fleet are configuration and
// stay.
export function deleteOldRows(connectionString: string): Promise<DeletedRows> {
  return withDatabase(connectionString, (db) =>
    db.transaction(async (tx) => {
      const cutoff = sql`now() - make_interval(days => ${RETENTION_DAYS})`;
      const oldRuns = tx
        .select({ id: testRuns.id })
        .from(testRuns)
        .where(lt(testRuns.startedAt, cutoff));
      const oldResults = tx
        .select({ id: testResults.id })
        .from(testResults)
        .where(inArray(testResults.runId, oldRuns));
      const oldSessions = tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(lt(sessions.startedAt, cutoff));
      const oldActions = tx
        .select({ id: actions.id })
        .from(actions)
        .where(inArray(actions.sessionId, oldSessions));
      return {
        automationJobs: rowCount(
          await tx.delete(automationJobs).where(inArray(automationJobs.resultId, oldResults)),
        ),
        testResults: rowCount(
          await tx.delete(testResults).where(inArray(testResults.runId, oldRuns)),
        ),
        testRuns: rowCount(await tx.delete(testRuns).where(lt(testRuns.startedAt, cutoff))),
        images: rowCount(await tx.delete(images).where(inArray(images.actionId, oldActions))),
        actions: rowCount(await tx.delete(actions).where(inArray(actions.sessionId, oldSessions))),
        agentRuns: rowCount(
          await tx.delete(agentRuns).where(inArray(agentRuns.sessionId, oldSessions)),
        ),
        debugLogs: rowCount(
          await tx.delete(debugLogs).where(inArray(debugLogs.sessionId, oldSessions)),
        ),
        postRunDiagnosis: rowCount(
          await tx.delete(postRunDiagnosis).where(inArray(postRunDiagnosis.sessionId, oldSessions)),
        ),
        sessionServers: rowCount(
          await tx.delete(sessionServers).where(inArray(sessionServers.sessionId, oldSessions)),
        ),
        sessions: rowCount(await tx.delete(sessions).where(lt(sessions.startedAt, cutoff))),
        logs: rowCount(await tx.delete(logs).where(lt(logs.createdAt, cutoff))),
        processStats: rowCount(
          await tx.delete(processStats).where(lt(processStats.reportedAt, cutoff)),
        ),
        agentServers: rowCount(
          await tx.delete(agentServers).where(lt(agentServers.createdAt, cutoff)),
        ),
      };
    }),
  );
}
