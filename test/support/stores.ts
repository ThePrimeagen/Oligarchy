import { Effect, Layer, Option } from "effect";
import * as Actions from "@oligarchy/db/actions";
import * as DebugLogs from "@oligarchy/db/debug-logs";
import * as Diagnosis from "@oligarchy/db/diagnosis";
import * as DbErrors from "@oligarchy/db/errors";
import * as Logs from "@oligarchy/db/logs";
import * as DbSchema from "@oligarchy/db/schema";
import * as Sessions from "@oligarchy/db/sessions";
import * as TestingStores from "@oligarchy/testing/stores";

type SessionRow = typeof DbSchema.sessions.$inferSelect;
type AgentRunRow = typeof DbSchema.agentRuns.$inferSelect;
type ActionRow = typeof DbSchema.actions.$inferSelect;
type ImageRow = { readonly id: string; readonly actionId: number; readonly data: Uint8Array };
type LogRow = Parameters<typeof Logs.LogStore.Service.insertLog>[0];

const sameId = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const conflict = (operation: string, detail: string) =>
  DbErrors.DatabaseError.make({
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
  // session_servers: the url the qemu reverse proxy routed each session to.
  readonly routes: Map<string, string>;
  readonly layer: Layer.Layer<Sessions.SessionStore>;
};

export const fakeSessionStore = (
  overrides: Partial<typeof Sessions.SessionStore.Service> = {},
): FakeSessionStore => {
  const sessions: Array<SessionRow> = [];
  const agentRuns: Array<AgentRunRow> = [];
  const routes = new Map<string, string>();
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
    getSession: (id) => Effect.sync(() => Option.fromUndefinedOr(find(id))),
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
    failRoutedSessions: (serverUrl, reason) =>
      Effect.sync(() => {
        const now = new Date();
        const failed = sessions.filter(
          (row) =>
            (row.status === "downloading" || row.status === "running") &&
            routes.get(row.id) === serverUrl,
        );
        for (const row of failed) {
          row.status = "errored";
          row.reason = reason;
          row.endedAt = now;
          for (const run of agentRuns) {
            if (sameId(run.sessionId, row.id) && run.endedAt === null) {
              run.endedAt = now;
            }
          }
        }
        return failed.map((row) => row.id);
      }),
    ...overrides,
  });
  return { sessions, agentRuns, routes, layer: Layer.succeed(Sessions.SessionStore)(service) };
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
    // The images ⋈ actions join, in action order, as the real store answers it.
    listImages: (sessionId) =>
      Effect.sync(() =>
        images
          .flatMap((image) => {
            const action = actions.find((row) => row.id === image.actionId);
            return action === undefined || !sameId(action.sessionId, sessionId)
              ? []
              : [{ id: image.id, actionId: image.actionId, createdAt: action.createdAt }];
          })
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.actionId - right.actionId,
          ),
      ),
    listRecentActions: (sessionId, limit) =>
      Effect.sync(() =>
        actions
          .filter((row) => sameId(row.sessionId, sessionId))
          .sort((left, right) => left.id - right.id)
          .slice(-limit)
          .map(({ id, request, state, createdAt, finishedAt }) => ({
            id,
            request,
            state,
            createdAt,
            finishedAt,
          })),
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
const recorded = (row: LogRow, id: number) => ({
  id,
  location: row.location,
  agentId: row.agentId,
  level: row.level,
  text: row.text,
  createdAt: new Date(),
});

export const fakeLogStore = (
  options: {
    readonly insertLog?: (row: LogRow) => Effect.Effect<void, DbErrors.DatabaseError>;
    readonly listLogs?: typeof Logs.LogStore.Service.listLogs;
    readonly listRecent?: typeof Logs.LogStore.Service.listRecent;
    readonly listIntents?: typeof Logs.LogStore.Service.listIntents;
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
      ((location) =>
        Effect.sync(() =>
          rows
            .filter((row) => row.location !== null && row.location === location)
            .map((row, index) => recorded(row, index + 1)),
        )),
    listRecent:
      options.listRecent ??
      ((limit) =>
        Effect.sync(() =>
          rows
            .slice(Math.max(0, rows.length - limit))
            .map((row, index) => recorded(row, index + 1)),
        )),
    listIntents:
      options.listIntents ??
      ((sessionId) =>
        Effect.sync(() =>
          rows
            .filter(
              (row) =>
                row.location === sessionId &&
                (row.text.startsWith("intent start; ") || row.text === "intent end"),
            )
            .map((row) => ({ text: row.text, createdAt: new Date() })),
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
// DiagnosisStore
// ---------------------------------------------------------------------------

export type FakeDiagnosisStore = {
  readonly errorTypes: Array<Diagnosis.ErrorTypeRow>;
  readonly diagnoses: Array<Diagnosis.DiagnosisRow>;
  readonly layer: Layer.Layer<Diagnosis.DiagnosisStore>;
};

// Keys are unique and a session is diagnosed once: the second write is a false, as the real
// store's `on conflict do nothing` answers.
export const fakeDiagnosisStore = (
  overrides: Partial<typeof Diagnosis.DiagnosisStore.Service> = {},
): FakeDiagnosisStore => {
  const errorTypes: Array<Diagnosis.ErrorTypeRow> = [];
  const diagnoses: Array<Diagnosis.DiagnosisRow> = [];
  const findType = (key: string) => errorTypes.find((row) => row.key === key);
  const service = Diagnosis.DiagnosisStore.of({
    createErrorType: (key, description) =>
      Effect.sync(() => {
        if (findType(key) !== undefined) {
          return false;
        }
        errorTypes.push({ key, description, createdAt: new Date() });
        return true;
      }),
    listErrorTypes: () =>
      Effect.sync(() => [...errorTypes].sort((left, right) => left.key.localeCompare(right.key))),
    findErrorType: (key) => Effect.sync(() => Option.fromUndefinedOr(findType(key))),
    saveDiagnosis: (input) =>
      Effect.sync(() => {
        if (diagnoses.some((row) => sameId(row.sessionId, input.sessionId))) {
          return false;
        }
        diagnoses.push({ ...input, createdAt: new Date() });
        return true;
      }),
    getDiagnosis: (sessionId) =>
      Effect.sync(() =>
        Option.fromUndefinedOr(diagnoses.find((row) => sameId(row.sessionId, sessionId))),
      ),
    ...overrides,
  });
  return { errorTypes, diagnoses, layer: Layer.succeed(Diagnosis.DiagnosisStore)(service) };
};

// Every store at once, sharing nothing: the common fixture for handler and command tests.
export const fakeStores = () => {
  const sessions = fakeSessionStore();
  const actions = fakeActionStore();
  const logs = fakeLogStore();
  const tests = TestingStores.fakeTestStore();
  const automation = TestingStores.fakeAutomationStore();
  const debugLogs = fakeDebugLogStore();
  const diagnosis = fakeDiagnosisStore();
  const servers = TestingStores.fakeServerStore();
  const process = TestingStores.fakeProcessStatsStore();
  return {
    sessions,
    actions,
    logs,
    tests,
    automation,
    debugLogs,
    diagnosis,
    servers,
    process,
    layer: Layer.mergeAll(
      sessions.layer,
      actions.layer,
      logs.layer,
      tests.layer,
      automation.layer,
      debugLogs.layer,
      diagnosis.layer,
      servers.layer,
      process.layer,
    ),
  };
};
