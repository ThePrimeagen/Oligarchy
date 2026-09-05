import { Effect, Layer, Option } from "effect";
import * as Actions from "../../src/db/actions.ts";
import * as DebugLogs from "../../src/db/debug-logs.ts";
import * as Logs from "../../src/db/logs.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Sessions from "../../src/db/sessions.ts";
import * as Tests from "../../src/db/tests.ts";
import * as Errors from "../../src/shared/errors.ts";

type SessionRow = typeof DbSchema.sessions.$inferSelect;
type AgentRunRow = typeof DbSchema.agentRuns.$inferSelect;
type ActionRow = typeof DbSchema.actions.$inferSelect;
type ImageRow = { readonly id: string; readonly actionId: number; readonly data: Uint8Array };
type LogRow = Parameters<typeof Logs.LogStore.Service.insertLog>[0];
type TestDefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;
type TestBasePromptRow = typeof DbSchema.testBasePrompts.$inferSelect;
type TestRunRow = typeof DbSchema.testRuns.$inferSelect;
type TestResultRow = typeof DbSchema.testResults.$inferSelect;

const sameId = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const conflict = (operation: string, detail: string) =>
  Errors.DatabaseError.make({
    operation,
    message: `Failed query: ${detail}`,
    cause: new Error("duplicate key value violates unique constraint"),
  });

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export type FakeSessionStore = {
  readonly sessions: Array<SessionRow>;
  readonly agentRuns: Array<AgentRunRow>;
  readonly layer: Layer.Layer<Sessions.SessionStore>;
};

export const fakeSessionStore = (
  overrides: Partial<typeof Sessions.SessionStore.Service> = {},
): FakeSessionStore => {
  const sessions: Array<SessionRow> = [];
  const agentRuns: Array<AgentRunRow> = [];
  const find = (id: string) => sessions.find((row) => sameId(row.id, id));
  const service = Sessions.SessionStore.of({
    insertSession: (id, config, status) =>
      Effect.sync(() => {
        sessions.push({
          id,
          config: { ...config },
          status,
          reason: null,
          startedAt: new Date(),
          endedAt: null,
        });
      }),
    sessionRunning: (id) =>
      Effect.sync(() => {
        const row = find(id);
        if (row !== undefined) {
          row.status = "running";
        }
      }),
    endSession: (id, status, reason) =>
      Effect.sync(() => {
        const now = new Date();
        const row = find(id);
        if (row !== undefined) {
          row.status = status;
          row.reason = reason;
          row.endedAt = now;
        }
        for (const run of agentRuns) {
          if (sameId(run.sessionId, id) && run.endedAt === null) {
            run.endedAt = now;
          }
        }
      }),
    getSessionStatus: (id) =>
      Effect.sync(() => Option.map(Option.fromUndefinedOr(find(id)), (row) => row.status)),
    sessionExists: (id) =>
      Effect.sync(() => Option.map(Option.fromUndefinedOr(find(id)), (row) => row.id)),
    registerAgent: (agentId, sessionId) =>
      Effect.suspend(() => {
        if (agentRuns.some((run) => run.agentId === agentId)) {
          return Effect.fail(conflict("registerAgent", `insert into "agent_runs" ("agent_id")`));
        }
        agentRuns.push({ agentId, sessionId, startedAt: new Date(), endedAt: null });
        return Effect.void;
      }),
    sessionForAgent: (agentId) =>
      Effect.sync(() =>
        Option.map(
          Option.fromUndefinedOr(agentRuns.find((run) => run.agentId === agentId)),
          (run) => run.sessionId,
        ),
      ),
    listSessions: (count, active) =>
      Effect.sync(() => {
        const rows = active
          ? sessions.filter((row) => row.status === "running" || row.status === "downloading")
          : [...sessions];
        rows.sort((left, right) => {
          if (active && left.status !== right.status) {
            return left.status === "running" ? -1 : 1;
          }
          const byTime = right.startedAt.getTime() - left.startedAt.getTime();
          return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
        });
        return rows.slice(0, count).map(({ id, status, startedAt }) => ({ id, status, startedAt }));
      }),
    ...overrides,
  });
  return { sessions, agentRuns, layer: Layer.succeed(Sessions.SessionStore)(service) };
};

// ---------------------------------------------------------------------------
// ActionStore
// ---------------------------------------------------------------------------

export type FakeActionStore = {
  readonly actions: Array<ActionRow>;
  readonly images: Array<ImageRow>;
  readonly layer: Layer.Layer<Actions.ActionStore>;
};

export const fakeActionStore = (
  overrides: Partial<typeof Actions.ActionStore.Service> = {},
): FakeActionStore => {
  const actions: Array<ActionRow> = [];
  const images: Array<ImageRow> = [];
  const service = Actions.ActionStore.of({
    startAction: (input) =>
      Effect.sync(() => {
        const id = actions.length + 1;
        actions.push({
          id,
          sessionId: input.sessionId,
          agentId: input.agentId,
          request: input.request,
          state: null,
          response: null,
          createdAt: new Date(),
          finishedAt: null,
        });
        return id;
      }),
    finishAction: (id, outcome, image) =>
      Effect.sync(() => {
        const row = actions.find((candidate) => candidate.id === id);
        if (row !== undefined) {
          row.state = outcome.state;
          row.response = outcome.response;
          row.finishedAt = new Date();
        }
        if (image !== undefined) {
          images.push({ id: image.id, actionId: id, data: image.data });
        }
      }),
    getImage: (id) =>
      Effect.sync(() =>
        Option.map(
          Option.fromUndefinedOr(images.find((image) => sameId(image.id, id))),
          (image) => image.data,
        ),
      ),
    listActions: (sessionId) =>
      Effect.sync(() =>
        actions
          .filter((row) => sameId(row.sessionId, sessionId))
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id,
          ),
      ),
    ...overrides,
  });
  return { actions, images, layer: Layer.succeed(Actions.ActionStore)(service) };
};

// ---------------------------------------------------------------------------
// LogStore
// ---------------------------------------------------------------------------

export type FakeLogStore = {
  readonly rows: Array<LogRow>;
  readonly layer: Layer.Layer<Logs.LogStore>;
};

// `insertLog` scripts the outcome of an insert; a row is recorded once it succeeds.
export const fakeLogStore = (
  options: {
    readonly insertLog?: (row: LogRow) => Effect.Effect<void, Errors.DatabaseError>;
    readonly listLogs?: typeof Logs.LogStore.Service.listLogs;
  } = {},
): FakeLogStore => {
  const rows: Array<LogRow> = [];
  const insert = options.insertLog ?? (() => Effect.void);
  const service = Logs.LogStore.of({
    insertLog: (row) =>
      insert(row).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            rows.push(row);
          }),
        ),
      ),
    listLogs:
      options.listLogs ??
      ((sessionId) =>
        Effect.sync(() =>
          rows
            .filter((row) => row.sessionId !== null && sameId(row.sessionId, sessionId))
            .map((row, index) => ({
              id: index + 1,
              sessionId: row.sessionId,
              agentId: row.agentId,
              level: row.level,
              text: row.text,
              createdAt: new Date(),
            })),
        )),
  });
  return { rows, layer: Layer.succeed(Logs.LogStore)(service) };
};

// ---------------------------------------------------------------------------
// DebugLogStore
// ---------------------------------------------------------------------------

export type FakeDebugLogStore = {
  readonly saves: Array<{
    readonly sessionId: string;
    readonly serial: string;
    readonly qemu: string;
  }>;
  // Rows `getDebugLog` answers with, keyed by session id; seeded by ctrl tests.
  readonly rows: Map<string, DebugLogs.DebugLogRow>;
  readonly layer: Layer.Layer<DebugLogs.DebugLogStore>;
};

export const fakeDebugLogStore = (
  overrides: Partial<typeof DebugLogs.DebugLogStore.Service> = {},
): FakeDebugLogStore => {
  const saves: Array<{
    readonly sessionId: string;
    readonly serial: string;
    readonly qemu: string;
  }> = [];
  const rows = new Map<string, DebugLogs.DebugLogRow>();
  const service = DebugLogs.DebugLogStore.of({
    saveDebugLog: (sessionId, captured) =>
      Effect.sync(() => {
        saves.push({ sessionId, serial: captured.serial, qemu: captured.qemu });
      }),
    getDebugLog: (sessionId) => Effect.sync(() => Option.fromUndefinedOr(rows.get(sessionId))),
    ...overrides,
  });
  return { saves, rows, layer: Layer.succeed(DebugLogs.DebugLogStore)(service) };
};

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
  const service = Tests.TestStore.of({
    listTestDefinitions: Effect.sync(() => byName(definitions)),
    findTestDefinition: (name) =>
      Effect.sync(() => Option.fromUndefinedOr(definitions.find((row) => row.name === name))),
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
    startResult: (resultId, sessionId) =>
      Effect.sync(() => {
        const row = results.find(
          (result) => sameId(result.id, resultId) && result.status === "pending",
        );
        if (row === undefined) {
          return false;
        }
        row.sessionId = sessionId;
        row.status = "running";
        return true;
      }),
    closeResult: (resultId, status, reason, sessionId) =>
      Effect.sync(() => {
        const row = results.find((result) => sameId(result.id, resultId));
        if (row === undefined) {
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
    resultForSession: (sessionId) =>
      Effect.sync(() =>
        results.flatMap((result) => {
          if (result.sessionId === null || !sameId(result.sessionId, sessionId)) {
            return [];
          }
          const definition = definitions.find((row) => row.id === result.definitionId);
          return definition === undefined ? [] : [{ result, definition }];
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

// Every store at once, sharing nothing: the common fixture for handler and command tests.
export const fakeStores = () => {
  const sessions = fakeSessionStore();
  const actions = fakeActionStore();
  const logs = fakeLogStore();
  const tests = fakeTestStore();
  const debugLogs = fakeDebugLogStore();
  return {
    sessions,
    actions,
    logs,
    tests,
    debugLogs,
    layer: Layer.mergeAll(sessions.layer, actions.layer, logs.layer, tests.layer, debugLogs.layer),
  };
};
