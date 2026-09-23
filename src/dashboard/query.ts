import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  like,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
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

// A suite is one test run, judged from its results. The run row's own status is not
// that: it is opened pending, and a row that still says running can already be finished.
// Running wins over pending, and either wins over a close, so a suite with one result
// still open stays open. A closed suite is completed once every result has run, passed or
// failed; one with a result aborted or timed out is aborted: that test never reached a verdict.
export type SuiteStatus = "pending" | "running" | "completed" | "aborted";

// One run's result tallies. stopped is results aborted or timed out.
export type SuiteTally = {
  readonly pending: number;
  readonly running: number;
  readonly passed: number;
  readonly failed: number;
  readonly stopped: number;
};

// One of the latest runs, classified. queriedAt is the clock its age is read against.
export type Suite = {
  readonly id: string;
  readonly name: string;
  readonly status: SuiteStatus;
  readonly startedAt: Date;
  readonly passed: number;
  readonly failed: number;
  readonly queriedAt: Date;
};

// The queue as the page shows it. running and pending are the fifty an operator
// reads; the counts beside those headings are the whole lists. suites is the three runs
// started last, newest first. Completed is the fifty that finished last, and has no
// count: that total only grows.
export type AutomationQueue = {
  readonly running: ReadonlyArray<AutomationJob>;
  readonly pending: ReadonlyArray<AutomationJob>;
  readonly completed: ReadonlyArray<AutomationJob>;
  readonly runningCount: number;
  readonly pendingCount: number;
  readonly suites: ReadonlyArray<Suite>;
};

const countOf = (
  rows: ReadonlyArray<{ readonly status: string; readonly total: number }>,
  status: string,
): number => rows.find((row) => row.status === status)?.total ?? 0;

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

// Twenty-five is the strip beside a name. The counts are every pass and fail of that name, not
// just the pills: 15 out of 17 is fifteen passes and two fails. A running result is a pill and
// not a verdict, so it is on the strip and out of that number.
const DEFINITION_RECENT = 25;

export type DefinitionPill = {
  readonly id: string;
  readonly status: "passed" | "failed" | "running";
  readonly at: number;
  readonly reason: string | null;
  readonly model: string | null;
};

export type DefinitionHistory = {
  readonly name: string;
  readonly passed: number;
  readonly total: number;
  readonly recent: ReadonlyArray<DefinitionPill>;
};

// Passes out of passes and fails, one row per name. Pending, aborted and timed out are not drawn.
// recent is the newest twenty-five of the pills, oldest first, so the rightmost pill is the latest.
// `at` is when the result finished, or when it was created if it is still running.
export function definitionHistories(
  rows: ReadonlyArray<{
    readonly name: string;
    readonly id: string;
    readonly status: (typeof testResults.$inferSelect)["status"];
    readonly at: number;
    readonly reason: string | null;
    readonly model: string | null;
  }>,
): DefinitionHistory[] {
  const byName = new Map<string, DefinitionPill[]>();
  for (const row of rows) {
    if (row.status !== "passed" && row.status !== "failed" && row.status !== "running") {
      continue;
    }
    const current = byName.get(row.name) ?? [];
    current.push({
      id: row.id,
      status: row.status,
      at: row.at,
      reason: row.reason,
      model: row.model,
    });
    byName.set(row.name, current);
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, group]) => {
      group.sort((left, right) => left.at - right.at);
      let passed = 0;
      let total = 0;
      for (const row of group) {
        if (row.status === "passed") {
          passed += 1;
          total += 1;
        } else if (row.status === "failed") {
          total += 1;
        }
      }
      return {
        name,
        passed,
        total,
        recent: group.slice(-DEFINITION_RECENT),
      };
    });
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

// Session time when the run opened one, otherwise the result's own span. A negative span is
// not a duration an operator can read, and neither is a result that has not finished.
export const resultDurationMs = (
  createdAt: Date,
  finishedAt: Date | null,
  sessionStartedAt: Date | null,
  sessionEndedAt: Date | null,
): number | null => {
  if (sessionStartedAt !== null && sessionEndedAt !== null) {
    const ms = sessionEndedAt.getTime() - sessionStartedAt.getTime();
    return ms < 0 ? null : ms;
  }
  if (finishedAt === null) {
    return null;
  }
  const ms = finishedAt.getTime() - createdAt.getTime();
  return ms < 0 ? null : ms;
};

const durationOf = (row: TestResultOutcome): number | undefined => {
  const ms = resultDurationMs(
    row.createdAt,
    row.finishedAt,
    row.sessionStartedAt,
    row.sessionEndedAt,
  );
  return ms === null ? undefined : ms;
};

// The diagnosis the reviewer wrote, or the result's own reason when nobody diagnosed it.
// An error type names the cause; the summary is what they said. A blank is not a diagnosis.
export const failureDiagnosis = (
  errorType: string | null,
  summary: string | null,
  reason: string | null,
): string | null => {
  if (summary !== null && summary !== "") {
    return errorType === null || errorType === "" ? summary : `${errorType}: ${summary}`;
  }
  if (reason === null || reason === "") {
    return null;
  }
  return reason;
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

// Every pass, fail and running result still inside retention, grouped by the definition's name so
// an older wording counts toward the same line. Ordered by when the result finished, or by when it
// was created if it has not finished, so a tie stays in creation order. `names` limits the read to
// the rows on screen. The clock keeps a minute's refresh out of Hyperdrive's query cache.
export function listDefinitionHistories(
  connectionString: string,
  names?: ReadonlyArray<string>,
): Promise<DefinitionHistory[]> {
  if (names !== undefined && names.length === 0) {
    return Promise.resolve([]);
  }
  return withDatabase(connectionString, async (db) => {
    const rows = await db
      .select({
        name: testDefinitions.name,
        id: testResults.id,
        status: testResults.status,
        reason: testResults.reason,
        model: testResults.model,
        at: sql<Date>`coalesce(${testResults.finishedAt}, ${testResults.createdAt})`.mapWith(
          testResults.createdAt,
        ),
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(testResults.createdAt),
      })
      .from(testResults)
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .where(
        names === undefined
          ? inArray(testResults.status, ["passed", "failed", "running"])
          : and(
              inArray(testResults.status, ["passed", "failed", "running"]),
              inArray(testDefinitions.name, [...names]),
            ),
      )
      .orderBy(
        testDefinitions.name,
        sql`coalesce(${testResults.finishedAt}, ${testResults.createdAt})`,
        testResults.createdAt,
      );
    return definitionHistories(
      rows.map((row) => ({
        name: row.name,
        id: row.id,
        status: row.status,
        at: row.at.getTime(),
        reason: row.reason,
        model: row.model,
      })),
    );
  });
}

// One result as the diagnostic page dumps it. version is that wording's place among the name's
// rows by id, the same order the definitions page numbers. Screenshots and logs are empty together
// when the result never opened a session. The clock keeps the page out of Hyperdrive's cache.
export type TestLogLine = {
  readonly level: (typeof logs.$inferSelect)["level"];
  readonly text: string;
  readonly at: Date;
};

export type TestDump = {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
  readonly status: (typeof testResults.$inferSelect)["status"];
  readonly reason: string | null;
  readonly model: string | null;
  readonly ticket: string | null;
  readonly sessionId: string | null;
  readonly at: Date;
  readonly screenshots: ReadonlyArray<string>;
  readonly logs: ReadonlyArray<TestLogLine>;
};

export function readTestDump(connectionString: string, id: string): Promise<TestDump | undefined> {
  return withDatabase(connectionString, async (db) => {
    const [row] = await db
      .select({
        id: testResults.id,
        definitionId: testDefinitions.id,
        name: testDefinitions.name,
        description: testDefinitions.description,
        instruction: testDefinitions.instruction,
        proof: testDefinitions.proof,
        status: testResults.status,
        reason: testResults.reason,
        model: testResults.model,
        ticket: testResults.linearId,
        sessionId: testResults.sessionId,
        at: sql<Date>`coalesce(${testResults.finishedAt}, ${testResults.createdAt})`.mapWith(
          testResults.createdAt,
        ),
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(testResults.createdAt),
      })
      .from(testResults)
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .where(eq(testResults.id, id));
    if (row === undefined) {
      return undefined;
    }
    const [versionRow] = await db
      .select({ version: count().mapWith(Number) })
      .from(testDefinitions)
      .where(and(eq(testDefinitions.name, row.name), lte(testDefinitions.id, row.definitionId)));
    const version = versionRow?.version ?? 1;
    if (row.sessionId === null) {
      return {
        id: row.id,
        name: row.name,
        version,
        description: row.description,
        instruction: row.instruction,
        proof: row.proof,
        status: row.status,
        reason: row.reason,
        model: row.model,
        ticket: row.ticket,
        sessionId: null,
        at: row.at,
        screenshots: [],
        logs: [],
      };
    }
    const sessionId = row.sessionId;
    const shots = await db
      .select({ id: images.id })
      .from(images)
      .innerJoin(actions, eq(actions.id, images.actionId))
      .where(eq(actions.sessionId, sessionId))
      .orderBy(actions.id);
    const logRows = await db
      .select({
        level: logs.level,
        text: logs.text,
        at: logs.createdAt,
      })
      .from(logs)
      .where(eq(logs.location, sessionId))
      .orderBy(logs.id);
    return {
      id: row.id,
      name: row.name,
      version,
      description: row.description,
      instruction: row.instruction,
      proof: row.proof,
      status: row.status,
      reason: row.reason,
      model: row.model,
      ticket: row.ticket,
      sessionId,
      at: row.at,
      screenshots: shots.map((shot) => shot.id),
      logs: logRows,
    };
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

// The last three runs are what an operator watches: the one going now and the two before it.
const SUITE_LIMIT = 3;

export const suiteStatusOf = (tally: SuiteTally): SuiteStatus => {
  if (tally.running > 0) {
    return "running";
  }
  if (tally.pending > 0) {
    return "pending";
  }
  if (tally.stopped > 0) {
    return "aborted";
  }
  return "completed";
};

// The queue in three lists, each ordered and cut by the database, plus the totals the headings
// show and the latest suites. Running and pending follow claim order: mint, then diagnose, then
// drive, each oldest first. Completed is every terminal status, newest finished first: finished_at is
// the stamp the close writes, the row's last change. The clock in each select is the one the
// stamps' ages are read against, and it keeps a poll out of Hyperdrive's query cache. The
// counts are not the lists: a list stops at fifty.
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
    const queueRank = sql`case ${automationJobs.action} when 'mint' then 0 when 'diagnose' then 1 else 2 end`;
    // One client, one query at a time: pg warns, and soon refuses, a second query
    // started while the first is still running.
    const running = await jobs()
      .where(eq(automationJobs.status, "running"))
      .orderBy(queueRank, automationJobs.createdAt)
      .limit(QUEUE_LIMIT);
    const pending = await jobs()
      .where(eq(automationJobs.status, "pending"))
      .orderBy(queueRank, automationJobs.createdAt)
      .limit(QUEUE_LIMIT);
    const completed = await jobs()
      .where(
        inArray(automationJobs.status, [
          "succeeded",
          "failed",
          "aborted",
          "timed_out",
          "completed",
          "errored",
        ]),
      )
      .orderBy(desc(automationJobs.finishedAt))
      .limit(QUEUE_LIMIT);
    const jobCounts = await db
      .select({
        status: automationJobs.status,
        total: count().mapWith(Number),
      })
      .from(automationJobs)
      .where(inArray(automationJobs.status, ["running", "pending"]))
      .groupBy(automationJobs.status);
    // The runs started last, one row each, newest first. A result still pending or running
    // keeps the suite open even when every job for it has already stopped.
    const suiteRows = await db
      .select({
        id: testRuns.id,
        name: testRuns.name,
        startedAt: testRuns.startedAt,
        pending: sql<number>`count(*) filter (where ${testResults.status} = 'pending')`.mapWith(
          Number,
        ),
        running: sql<number>`count(*) filter (where ${testResults.status} = 'running')`.mapWith(
          Number,
        ),
        passed: sql<number>`count(*) filter (where ${testResults.status} = 'passed')`.mapWith(
          Number,
        ),
        failed: sql<number>`count(*) filter (where ${testResults.status} = 'failed')`.mapWith(
          Number,
        ),
        stopped:
          sql<number>`count(*) filter (where ${testResults.status} in ('aborted', 'timed_out'))`.mapWith(
            Number,
          ),
        queriedAt: sql<Date>`(select CURRENT_TIMESTAMP)`.mapWith(testRuns.startedAt),
      })
      .from(testRuns)
      .innerJoin(testResults, eq(testResults.runId, testRuns.id))
      .groupBy(testRuns.id, testRuns.name, testRuns.startedAt)
      .orderBy(desc(testRuns.startedAt), desc(testRuns.id))
      .limit(SUITE_LIMIT);
    return {
      running,
      pending,
      completed,
      runningCount: countOf(jobCounts, "running"),
      pendingCount: countOf(jobCounts, "pending"),
      suites: suiteRows.map((row) => ({
        id: row.id,
        name: row.name,
        status: suiteStatusOf(row),
        startedAt: row.startedAt,
        passed: row.passed,
        failed: row.failed,
        queriedAt: row.queriedAt,
      })),
    };
  });
}

// The index lists every job in flight. A definition's page, and the poll and abort that
// rewrite its list, keep only that name's.
export const runningForDefinition = (
  jobs: ReadonlyArray<AutomationJob>,
  name: string,
): AutomationJob[] => jobs.filter((job) => job.test === name);

// Ten is what a definition's own page shows. The index strip is the last twenty-five.
const DEFINITION_PAGE_RUNS = 10;

// One verdict on a definition's page. durationMs is a pass's length; a fail has none, it
// has the diagnosis instead. Newest first.
export type DefinitionRun = {
  readonly id: string;
  readonly status: "passed" | "failed";
  readonly durationMs: number | null;
  readonly diagnosis: string | null;
};

export type DefinitionRunSource = {
  readonly id: string;
  readonly status: (typeof testResults.$inferSelect)["status"];
  readonly at: number;
  readonly durationMs: number | null;
  readonly errorType: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
};

export function recentDefinitionRuns(rows: ReadonlyArray<DefinitionRunSource>): DefinitionRun[] {
  return rows
    .flatMap((row) =>
      row.status === "passed" || row.status === "failed" ? [{ ...row, status: row.status }] : [],
    )
    .sort((left, right) => right.at - left.at || left.id.localeCompare(right.id))
    .slice(0, DEFINITION_PAGE_RUNS)
    .map((row) => ({
      id: row.id,
      status: row.status,
      durationMs: row.status === "passed" ? row.durationMs : null,
      diagnosis:
        row.status === "failed" ? failureDiagnosis(row.errorType, row.summary, row.reason) : null,
    }));
}

// Passed and failed results of one definition, newest ten after recentDefinitionRuns. Older
// wordings of the name count: a result hangs off the wording it ran. The clock keeps the
// page out of Hyperdrive's cache.
export function listDefinitionRuns(
  connectionString: string,
  name: string,
): Promise<DefinitionRun[]> {
  return withDatabase(connectionString, async (db) => {
    const rows = await db
      .select({
        id: testResults.id,
        status: testResults.status,
        reason: testResults.reason,
        createdAt: testResults.createdAt,
        finishedAt: testResults.finishedAt,
        sessionStartedAt: sessions.startedAt,
        sessionEndedAt: sessions.endedAt,
        errorType: postRunDiagnosis.errorType,
        summary: postRunDiagnosis.summary,
        at: sql<Date>`coalesce(${testResults.finishedAt}, ${testResults.createdAt})`.mapWith(
          testResults.createdAt,
        ),
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(testResults.createdAt),
      })
      .from(testResults)
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .leftJoin(sessions, eq(sessions.id, testResults.sessionId))
      .leftJoin(postRunDiagnosis, eq(postRunDiagnosis.sessionId, testResults.sessionId))
      .where(
        and(eq(testDefinitions.name, name), inArray(testResults.status, ["passed", "failed"])),
      );
    return recentDefinitionRuns(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        at: row.at.getTime(),
        durationMs: resultDurationMs(
          row.createdAt,
          row.finishedAt,
          row.sessionStartedAt,
          row.sessionEndedAt,
        ),
        errorType: row.errorType,
        summary: row.summary,
        reason: row.reason,
      })),
    );
  });
}

// Every job that is running, in the queue's running order: mint, then diagnose, then drive,
// then created_at. The definitions page lists what is in flight so an operator can stop it; the
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
      .orderBy(
        sql`case ${automationJobs.action} when 'mint' then 0 when 'diagnose' then 1 else 2 end`,
        automationJobs.createdAt,
      ),
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
    | "completed"
    | "errored"
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

export type OpenSuiteJob = {
  readonly ticket: string | null;
  readonly action: (typeof automationJobs.$inferSelect)["action"];
};

// Pending jobs of results this suite has not aborted. Aborting them before the
// automation-server round trip is what keeps a claim from starting a guest during
// that wait. A job whose result already passed or failed stays: its diagnose is
// still the review.
export function abortPendingSuiteJobs(connectionString: string, runId: string): Promise<void> {
  return withDatabase(connectionString, async (db) => {
    await db
      .update(automationJobs)
      .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
      .where(
        and(
          eq(automationJobs.status, "pending"),
          inArray(
            automationJobs.resultId,
            db
              .select({ id: testResults.id })
              .from(testResults)
              .where(
                and(
                  eq(testResults.runId, runId),
                  inArray(testResults.status, ["pending", "running"]),
                ),
              ),
          ),
        ),
      );
  });
}

// Running jobs of results this suite has not aborted. A pending job has no client,
// so it is aborted before this read. The clock keeps the read out of Hyperdrive's
// cache, so a job claimed since the last poll is still here to abort.
export function listOpenSuiteJobs(
  connectionString: string,
  runId: string,
): Promise<OpenSuiteJob[]> {
  return withDatabase(connectionString, (db) =>
    db
      .select({
        ticket: testResults.linearId,
        action: automationJobs.action,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(automationJobs.createdAt),
      })
      .from(automationJobs)
      .innerJoin(testResults, eq(testResults.id, automationJobs.resultId))
      .where(
        and(
          eq(testResults.runId, runId),
          inArray(testResults.status, ["pending", "running"]),
          eq(automationJobs.status, "running"),
        ),
      ),
  );
}

export type AbortedSuite = {
  readonly aborted: boolean;
  readonly tickets: ReadonlyArray<string>;
};

// Aborts a suite that still has a result open. Those results, and the jobs still waiting
// or running for them, become aborted, and the run row ends with them. A suite that has
// already finished is left alone, so a second abort does not rewrite a pass. The tickets
// are the ones the board should move; a result with none has nothing to move.
export function abortTestSuite(connectionString: string, runId: string): Promise<AbortedSuite> {
  return withDatabase(connectionString, (db) =>
    db.transaction(async (tx) => {
      const results = await tx
        .update(testResults)
        .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
        .where(
          and(eq(testResults.runId, runId), inArray(testResults.status, ["pending", "running"])),
        )
        .returning({ id: testResults.id, ticket: testResults.linearId });
      if (results.length === 0) {
        return { aborted: false, tickets: [] };
      }
      await tx
        .update(automationJobs)
        .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
        .where(
          and(
            inArray(
              automationJobs.resultId,
              results.map((result) => result.id),
            ),
            inArray(automationJobs.status, ["pending", "running"]),
          ),
        );
      await tx
        .update(testRuns)
        .set({ status: "aborted", reason: "aborted", endedAt: sql`now()` })
        .where(eq(testRuns.id, runId));
      return {
        aborted: true,
        tickets: results.flatMap((result) => (result.ticket === null ? [] : [result.ticket])),
      };
    }),
  );
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

// Seven days: the pages read the last fifty of anything and the last thirty minutes of process
// stats, so a week back is history nobody opens, and the images are the bytes that grow.
export const RETENTION_DAYS = 7;

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
