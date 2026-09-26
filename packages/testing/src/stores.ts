import { Effect, Layer, Option } from "effect";
import * as Automation from "@oligarchy/db/automation";
import * as DbErrors from "@oligarchy/db/errors";
import * as ProcessStats from "@oligarchy/db/process-stats";
import type * as DbSchema from "@oligarchy/db/schema";
import * as Servers from "@oligarchy/db/servers";
import * as Tests from "@oligarchy/db/tests";

type TestDefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;
type TestBasePromptRow = typeof DbSchema.testBasePrompts.$inferSelect;
type TestRunRow = typeof DbSchema.testRuns.$inferSelect;
type TestResultRow = typeof DbSchema.testResults.$inferSelect;
type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
type FakeAutomationJob = AutomationJobRow & {
  readonly ticket?: string | null;
  readonly test?: string;
  readonly clientUrl?: string | null;
  readonly serverUrl?: string | null;
  readonly sessionId?: string | null;
  readonly instruction?: string;
  readonly intent?: string | null;
};

const sameId = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const conflict = (operation: string, detail: string) =>
  DbErrors.DatabaseError.make({
    operation,
    message: `Failed query: ${detail}`,
    cause: new Error("duplicate key value violates unique constraint"),
  });

// ---------------------------------------------------------------------------
// TestStore
// ---------------------------------------------------------------------------

export type FakeTestStore = {
  readonly definitions: Array<TestDefinitionRow>;
  readonly basePrompts: Array<TestBasePromptRow>;
  readonly runs: Array<TestRunRow>;
  readonly results: Array<TestResultRow>;
  readonly layer: Layer.Layer<Tests.TestStore>;
};

export const fakeTestStore = (
  seed: {
    readonly definitions?: ReadonlyArray<TestDefinitionRow>;
    readonly basePrompts?: ReadonlyArray<TestBasePromptRow>;
    readonly runs?: ReadonlyArray<TestRunRow>;
    readonly results?: ReadonlyArray<TestResultRow>;
  } = {},
  overrides: Partial<typeof Tests.TestStore.Service> = {},
): FakeTestStore => {
  const definitions: Array<TestDefinitionRow> = [...(seed.definitions ?? [])];
  const basePrompts: Array<TestBasePromptRow> = [...(seed.basePrompts ?? [])];
  const runs: Array<TestRunRow> = [...(seed.runs ?? [])];
  const results: Array<TestResultRow> = [...(seed.results ?? [])];
  const byName = <Row extends { readonly name: string }>(rows: ReadonlyArray<Row>) =>
    [...rows].sort((left, right) => left.name.localeCompare(right.name));
  // A definition's rows by name then id, as the real order by: a name's newest wording is its
  // highest id.
  const history = (name: Option.Option<string>) =>
    definitions
      .filter((row) => Option.match(name, { onNone: () => true, onSome: (n) => row.name === n }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  const latest = (name: string) => history(Option.some(name)).at(-1);
  const service = Tests.TestStore.of({
    listTestDefinitions: Effect.sync(() =>
      history(Option.none()).filter((row) => row === latest(row.name)),
    ),
    findTestDefinition: (name) => Effect.sync(() => Option.fromUndefinedOr(latest(name))),
    listTestDefinitionHistory: (name) => Effect.sync(() => history(name)),
    defineTestDefinition: (input) =>
      Effect.sync(() => {
        const row: TestDefinitionRow = {
          id: Math.max(0, ...definitions.map((definition) => definition.id)) + 1,
          name: input.name,
          description: input.description,
          instruction: input.instruction,
          proof: input.proof,
          createdAt: new Date(),
        };
        definitions.push(row);
        return { id: row.id, version: history(Option.some(input.name)).length };
      }),
    listTestBasePrompts: Effect.sync(() => byName(basePrompts)),
    createRun: (input) =>
      Effect.sync(() => {
        const runId = crypto.randomUUID();
        runs.push({
          id: runId,
          name: "Omarchy experiment",
          iso: input.iso,
          serverUrl: input.serverUrl,
          status: "pending",
          reason: null,
          startedAt: new Date(),
          endedAt: null,
        });
        const created = input.definitions.map((definition) => {
          const row: TestResultRow = {
            id: crypto.randomUUID(),
            runId,
            definitionId: definition.id,
            sessionId: null,
            model: null,
            linearId: null,
            status: "pending",
            reason: null,
            createdAt: new Date(),
            finishedAt: null,
          };
          results.push(row);
          return { id: row.id, definitionId: row.definitionId };
        });
        return { runId, results: created };
      }),
    failRun: (runId, reason) =>
      Effect.sync(() => {
        const now = new Date();
        for (const run of runs) {
          if (sameId(run.id, runId)) {
            run.status = "failed";
            run.reason = reason;
            run.endedAt = now;
          }
        }
        for (const result of results) {
          if (sameId(result.runId, runId)) {
            result.status = "failed";
            result.reason = reason;
            result.finishedAt = now;
          }
        }
      }),
    startResult: (resultId, sessionId, model) =>
      Effect.sync(() => {
        const row = results.find(
          (result) => sameId(result.id, resultId) && result.status === "pending",
        );
        if (row === undefined) {
          return false;
        }
        row.sessionId = sessionId;
        row.status = "running";
        row.model = model;
        return true;
      }),
    closeResult: (resultId, status, reason, sessionId) =>
      Effect.sync(() => {
        const row = results.find((result) => sameId(result.id, resultId));
        // Same predicate as TestStore.closeResult: an abort or an error is final.
        if (row === undefined || row.status === "aborted" || row.status === "errored") {
          return false;
        }
        row.status = status;
        if (reason !== null) {
          row.reason = reason;
        }
        if (sessionId !== null) {
          row.sessionId = sessionId;
        }
        row.finishedAt = new Date();
        return true;
      }),
    errorResult: (resultId, reason) =>
      Effect.sync(() => {
        const row = results.find((result) => sameId(result.id, resultId));
        // Same predicate as TestStore.errorResult: an abort is the operator's close.
        if (row === undefined || row.status === "aborted") {
          return false;
        }
        row.status = "errored";
        row.reason = reason;
        row.finishedAt = new Date();
        return true;
      }),
    setLinearId: (resultId, linearId) =>
      Effect.gen(function* () {
        const row = results.find((result) => sameId(result.id, resultId));
        if (row === undefined) {
          return yield* Effect.die(new Error(`setLinearId: no result ${resultId}`));
        }
        if (
          results.some(
            (other) =>
              other.linearId !== null && other.linearId === linearId && !sameId(other.id, resultId),
          )
        ) {
          return yield* Effect.fail(
            conflict("setLinearId", 'update "test_results" set "linear_id"'),
          );
        }
        row.linearId = linearId;
        return yield* Effect.void;
      }),
    findResultByLinearId: (linearId) =>
      Effect.sync(() =>
        Option.fromUndefinedOr(
          results.find((row) => row.linearId !== null && row.linearId === linearId),
        ),
      ),
    findResult: (resultId) =>
      Effect.sync(() => Option.fromUndefinedOr(results.find((row) => sameId(row.id, resultId)))),
    // Inner joins, as the real query: a result whose definition or run is missing is no row.
    definitionName: (id) =>
      Effect.sync(() => Option.fromUndefinedOr(definitions.find((row) => row.id === id)?.name)),
    driveFacts: (resultId) =>
      Effect.sync(() => {
        const result = results.find((row) => sameId(row.id, resultId));
        if (result === undefined) {
          return Option.none();
        }
        const definition = definitions.find((row) => row.id === result.definitionId);
        const run = runs.find((row) => sameId(row.id, result.runId));
        if (definition === undefined || run === undefined) {
          return Option.none();
        }
        return Option.some({
          name: definition.name,
          description: definition.description,
          instruction: definition.instruction,
          proof: definition.proof,
          iso: run.iso,
          serverUrl: run.serverUrl,
        });
      }),
    resumeIso: (resultId) =>
      Effect.sync(() => {
        const result = results.find((row) => sameId(row.id, resultId));
        if (result === undefined) {
          return Option.none<string>();
        }
        const definition = definitions.find((row) => row.id === result.definitionId);
        const run = runs.find((row) => sameId(row.id, result.runId));
        if (definition === undefined || run === undefined || definition.name === "mint") {
          return Option.none<string>();
        }
        return Option.some(run.iso);
      }),
    resultForSession: (sessionId) =>
      Effect.sync(() =>
        results.flatMap((result) => {
          if (result.sessionId === null || !sameId(result.sessionId, sessionId)) {
            return [];
          }
          const definition = definitions.find((row) => row.id === result.definitionId);
          const run = runs.find((row) => sameId(row.id, result.runId));
          return definition === undefined || run === undefined ? [] : [{ result, definition, run }];
        }),
      ),
    ...overrides,
  });
  return {
    definitions,
    basePrompts,
    runs,
    results,
    layer: Layer.succeed(Tests.TestStore)(service),
  };
};

// ---------------------------------------------------------------------------
// AutomationStore
// ---------------------------------------------------------------------------

export type FakeAutomationStore = {
  readonly jobs: Array<FakeAutomationJob>;
  readonly layer: Layer.Layer<Automation.AutomationStore>;
};

// One pending job per (result, action), as the unique index: a second insert is DatabaseError.
export const fakeAutomationStore = (
  overrides: Partial<typeof Automation.AutomationStore.Service> = {},
): FakeAutomationStore => {
  const jobs: Array<FakeAutomationJob> = [];
  let nextId = 1;
  const service = Automation.AutomationStore.of({
    enqueue: (input) =>
      Effect.gen(function* () {
        if (
          jobs.some((job) => sameId(job.resultId, input.resultId) && job.action === input.action)
        ) {
          return yield* Effect.fail(
            conflict("enqueueAutomationJob", 'insert into "automation_jobs"'),
          );
        }
        const row: FakeAutomationJob = {
          id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          resultId: input.resultId,
          action: input.action,
          status: "pending",
          reason: null,
          serverId: null,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
        };
        jobs.push(row);
        return row;
      }),
    nextPending: (except = []) =>
      Effect.sync(() => {
        const busy = new Set(
          jobs.filter((job) => job.status === "running").map((job) => job.resultId),
        );
        // Queue order as the real store selects: mint, then diagnose, then drive; then created_at, id.
        const rank = (job: FakeAutomationJob): number => {
          if (job.action === "mint") {
            return 0;
          }
          if (job.action === "diagnose") {
            return 1;
          }
          return 2;
        };
        const pending = jobs
          .filter(
            (job) =>
              job.status === "pending" &&
              !busy.has(job.resultId) &&
              !except.some((id) => sameId(id, job.id)),
          )
          .sort(
            (left, right) =>
              rank(left) - rank(right) ||
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          );
        const job = pending[0];
        return job === undefined ? Option.none() : Option.some(job);
      }),
    markRunning: (id, serverId) =>
      Effect.sync(() => {
        const job = jobs.find((row) => sameId(row.id, id));
        if (job === undefined) {
          return false;
        }
        if (job.status === "pending") {
          job.status = "running";
          job.startedAt = new Date();
          job.serverId = serverId;
          return true;
        }
        return job.status === "running" && job.serverId === serverId;
      }),
    listRunning: () =>
      Effect.sync(() =>
        jobs
          .filter((job) => job.status === "running")
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          ),
      ),
    hasPending: (resultId, action) =>
      Effect.sync(() =>
        jobs.some(
          (job) =>
            sameId(job.resultId, resultId) && job.action === action && job.status === "pending",
        ),
      ),
    jobStatus: (resultId, action) =>
      Effect.sync(() => {
        const job = jobs.find((row) => sameId(row.resultId, resultId) && row.action === action);
        return job === undefined ? Option.none() : Option.some(job.status);
      }),
    findRunning: (resultId) =>
      Effect.sync(() =>
        Option.fromUndefinedOr(
          jobs.find((job) => sameId(job.resultId, resultId) && job.status === "running"),
        ),
      ),
    abortPending: (resultId, action) =>
      Effect.sync(() => {
        const job = jobs.find(
          (row) =>
            sameId(row.resultId, resultId) && row.action === action && row.status === "pending",
        );
        if (job === undefined) {
          return false;
        }
        job.status = "aborted";
        job.reason = "aborted";
        job.finishedAt = new Date();
        return true;
      }),
    finish: (id, status, reason) =>
      Effect.sync(() => {
        const job = jobs.find(
          (row) => sameId(row.id, id) && (row.status === "running" || row.status === "pending"),
        );
        if (job === undefined) {
          const closed = jobs.find((row) => sameId(row.id, id));
          return (
            closed !== undefined &&
            closed.status === status &&
            (reason === null || closed.reason === reason)
          );
        }
        job.status = status;
        job.finishedAt = new Date();
        if (reason !== null) {
          job.reason = reason;
        }
        return true;
      }),
    listJobs: (count) =>
      Effect.sync(() => {
        const queriedAt = new Date();
        const listed = (job: FakeAutomationJob): Automation.AutomationJobListRow => ({
          ticket: job.ticket ?? null,
          test: job.test ?? "",
          action: job.action,
          status: job.status,
          reason: job.reason,
          clientUrl: job.clientUrl ?? null,
          serverUrl: job.serverUrl ?? null,
          sessionId: job.sessionId ?? null,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          queriedAt,
          instruction: job.instruction ?? "",
          intent: job.intent ?? null,
        });
        const diagnoseFirst = (left: FakeAutomationJob, right: FakeAutomationJob) => {
          if (left.action !== right.action) {
            return left.action === "diagnose" ? -1 : 1;
          }
          const byTime = left.createdAt.getTime() - right.createdAt.getTime();
          return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
        };
        const running = jobs
          .filter((job) => job.status === "running")
          .sort(diagnoseFirst)
          .map(listed);
        const pending = jobs
          .filter((job) => job.status === "pending")
          .sort(diagnoseFirst)
          .map(listed);
        const completed = jobs
          .filter(
            (job) =>
              // The same terminal set AutomationStore.listJobs keeps.
              job.status === "succeeded" ||
              job.status === "failed" ||
              job.status === "aborted" ||
              job.status === "timed_out" ||
              job.status === "completed" ||
              job.status === "errored",
          )
          .sort((left, right) => {
            const byTime = (right.finishedAt?.getTime() ?? 0) - (left.finishedAt?.getTime() ?? 0);
            return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
          })
          .slice(0, count)
          .map(listed);
        return { running, pending, completed };
      }),
    ...overrides,
  });
  return { jobs, layer: Layer.succeed(Automation.AutomationStore)(service) };
};

// ---------------------------------------------------------------------------
// ServerStore
// ---------------------------------------------------------------------------

// qemu before automation-client, as the enum declares them and the real order by reads them.
const KIND_ORDER: Readonly<Record<Servers.ServerType, number>> = {
  qemu: 0,
  "automation-client": 1,
};

type RegisteredServer = {
  readonly id: string;
  readonly url: string;
  readonly name: string | null;
  readonly type: Servers.ServerType;
};
type Heartbeat = {
  readonly url: string;
  readonly type: Servers.ServerType;
  readonly name: string;
  readonly stats: DbSchema.ServerStats;
};

export type FakeServerStore = {
  // Registered servers, in registration order.
  readonly servers: Array<RegisteredServer>;
  // Session id to the url of the server that started it.
  readonly routes: Map<string, string>;
  // Agent id to the url that reserved a slot for it.
  readonly agents: Map<string, string>;
  // Every heartbeat written, in order.
  readonly heartbeats: Array<Heartbeat>;
  readonly layer: Layer.Layer<Servers.ServerStore>;
};

// A url registers once and a session is routed once, as the real keys promise: a second
// registration is a no-op and a second route is the primary key's DatabaseError. A heartbeat
// registers the url too, as the real upsert does, and its type is the server's word.
export const fakeServerStore = (
  overrides: Partial<typeof Servers.ServerStore.Service> = {},
): FakeServerStore => {
  const servers: Array<RegisteredServer> = [];
  const routes = new Map<string, string>();
  const agents = new Map<string, string>();
  const heartbeats: Array<Heartbeat> = [];
  const indexOf = (url: string) => servers.findIndex((server) => server.url === url);
  const service = Servers.ServerStore.of({
    addServer: (url, type) =>
      Effect.sync(() => {
        if (indexOf(url) === -1) {
          servers.push({ id: crypto.randomUUID(), url, name: null, type });
        }
      }),
    heartbeat: (url, type, name, stats) =>
      Effect.sync(() => {
        const index = indexOf(url);
        if (index === -1) {
          servers.push({ id: crypto.randomUUID(), url, name, type });
        } else {
          const existing = servers[index];
          if (existing !== undefined) {
            servers[index] = { id: existing.id, url, name, type };
          }
        }
        heartbeats.push({ url, type, name, stats });
      }),
    removeServer: (url) =>
      Effect.sync(() => {
        const index = indexOf(url);
        if (index === -1) {
          return false;
        }
        servers.splice(index, 1);
        return true;
      }),
    listServers: (type) =>
      Effect.sync(() =>
        servers.filter((server) => server.type === type).map((server) => server.url),
      ),
    // What the real rows would hold after the heartbeats written here, qemu servers before
    // automation clients: the generation counts a url's heartbeats, the stats are the last
    // one's, and a url nobody announced has neither.
    listMachines: () =>
      Effect.sync(() => {
        const queriedAt = new Date();
        return [...servers]
          .sort((left, right) => KIND_ORDER[left.type] - KIND_ORDER[right.type])
          .map((server) => {
            const beats = heartbeats.filter((beat) => beat.url === server.url);
            const last = beats.at(-1);
            return {
              url: server.url,
              name: server.name,
              type: server.type,
              stats: last === undefined ? null : last.stats,
              generation: beats.length,
              heartbeatAt: last === undefined ? null : queriedAt,
              queriedAt,
            };
          });
      }),
    // Any heartbeat marks the url live: the 45s window is a real-database concern.
    listLiveServers: (type) =>
      Effect.sync(() =>
        servers
          .filter(
            (server) => server.type === type && heartbeats.some((beat) => beat.url === server.url),
          )
          .map((server) => ({ id: server.id, url: server.url })),
      ),
    // Nothing is ever stale here, for the same reason: a test that wants a server forgotten
    // says which through an override.
    removeStaleServers: () => Effect.succeed([]),
    findServer: (id) =>
      Effect.sync(() =>
        Option.map(
          Option.fromUndefinedOr(servers.find((server) => server.id === id)),
          (server) => ({ id: server.id, url: server.url }),
        ),
      ),
    routeSession: (sessionId, url) =>
      routes.has(sessionId)
        ? Effect.fail(conflict("routeSession", "insert into session_servers"))
        : Effect.sync(() => {
            routes.set(sessionId, url);
          }),
    serverForSession: (sessionId) =>
      Effect.sync(() => Option.fromUndefinedOr(routes.get(sessionId))),
    routeAgent: (agentId, url) =>
      Effect.sync(() => {
        if (!agents.has(agentId)) {
          agents.set(agentId, url);
        }
      }),
    serverForAgent: (agentId) => Effect.sync(() => Option.fromUndefinedOr(agents.get(agentId))),
    clearAgent: (agentId) =>
      Effect.sync(() => {
        agents.delete(agentId);
      }),
    ...overrides,
  });
  return {
    servers,
    routes,
    agents,
    heartbeats,
    layer: Layer.succeed(Servers.ServerStore)(service),
  };
};

// ---------------------------------------------------------------------------
// ProcessStatsStore
// ---------------------------------------------------------------------------

type ProcessReport = {
  readonly name: string;
  readonly type: Servers.ServerType;
  readonly stats: ProcessStats.ProcessStats;
};

export type FakeProcessStatsStore = {
  readonly reports: Array<ProcessReport>;
  readonly layer: Layer.Layer<ProcessStats.ProcessStatsStore>;
};

export const fakeProcessStatsStore = (
  overrides: Partial<typeof ProcessStats.ProcessStatsStore.Service> = {},
): FakeProcessStatsStore => {
  const reports: Array<ProcessReport> = [];
  const service = ProcessStats.ProcessStatsStore.of({
    report: (name, type, stats) =>
      Effect.sync(() => {
        reports.push({ name, type, stats });
      }),
    // The newest `count` reports per name and kind in the order written, by kind then name: the
    // fake keeps no clock, so every report is within the window.
    listSeries: (count) =>
      Effect.sync(() => {
        const byName = new Map<string, Array<ProcessReport>>();
        for (const report of reports) {
          const key = `${report.type} ${report.name}`;
          byName.set(key, [...(byName.get(key) ?? []), report]);
        }
        return [...byName.values()]
          .sort(
            (left, right) =>
              KIND_ORDER[left[0]?.type ?? "qemu"] - KIND_ORDER[right[0]?.type ?? "qemu"] ||
              (left[0]?.name ?? "").localeCompare(right[0]?.name ?? ""),
          )
          .flatMap((series) => {
            const first = series[0];
            return first === undefined
              ? []
              : [
                  {
                    name: first.name,
                    type: first.type,
                    samples: series.slice(-count).map((report) => ({
                      jobs: report.stats.jobs,
                      memoryBytes: report.stats.memoryBytes,
                      cpuPercent: report.stats.cpuPercent,
                    })),
                  },
                ];
          });
      }),
    ...overrides,
  });
  return {
    reports,
    layer: Layer.succeed(ProcessStats.ProcessStatsStore)(service),
  };
};
