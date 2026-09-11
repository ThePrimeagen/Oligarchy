import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  actions,
  automationJobs,
  images,
  servers,
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
  "url" | "stats" | "generation" | "heartbeatAt"
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

// The definition the wide layout opens on, every wording of it: the name ?name asks for, or the
// first listed when the page is opened bare. A name nobody carries selects nothing, so the route
// can answer 404 rather than quietly show another definition under a URL that names this one.
export function selectDefinition(
  groups: ReadonlyArray<DefinitionVersions>,
  name: string | undefined,
): DefinitionVersions | undefined {
  return name === undefined ? groups[0] : groups.find((group) => group.name === name);
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

// Only a running row closes, the same rule as the automation server's finish: a pending or
// finished ticket is left as it is. reason and finished_at are written with the status so the
// queue shows the close.
export function abortAutomationJob(connectionString: string, ticket: string): Promise<boolean> {
  return withDatabase(connectionString, async (db) => {
    const rows = await db
      .update(automationJobs)
      .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
      .where(
        and(
          eq(automationJobs.status, "running"),
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
