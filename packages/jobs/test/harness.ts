import { Effect, Layer, Option, PlatformError } from "effect";
import * as Diagnosis from "@oligarchy/db/diagnosis";
import * as DbSchema from "@oligarchy/db/schema";
import * as Servers from "@oligarchy/db/servers";
import * as Sessions from "@oligarchy/db/sessions";
import * as Log from "@oligarchy/log/log";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as TestingStores from "@oligarchy/testing/stores";

export const TICKET = "OLI-42";
export const RUN = "11111111-1111-4111-8111-111111111111";
export const RESULT = "22222222-2222-4222-8222-222222222222";
export const SESSION = "66666666-6666-4666-8666-666666666666";
export const CLIENT = "77777777-7777-4777-8777-777777777777";
export const CLIENT_URL = "http://127.0.0.1:55333";

export type Line = {
  readonly level: "info" | "warning" | "error" | "fatal";
  readonly text: string;
  readonly location: string | undefined;
  readonly agentId: string | undefined;
  readonly cause: unknown;
};

// A Log that keeps every line instead of writing it.
export const recordingLog = () => {
  const lines: Array<Line> = [];
  const record =
    (level: Line["level"]) =>
    (text: string, report?: Log.Report): Effect.Effect<void> =>
      Effect.sync(() => {
        lines.push({
          level,
          text,
          location: report?.location,
          agentId: report?.agentId,
          cause: report?.cause,
        });
      });
  return {
    lines,
    texts: () => lines.map((line) => line.text),
    layer: Layer.succeed(Log.Log)(
      Log.Log.of({
        info: record("info"),
        warning: record("warning"),
        error: record("error"),
        fatal: record("fatal"),
        flush: Effect.void,
      }),
    ),
  };
};

type ResultRow = TestingStores.FakeTestStore["results"][number];
type ActionRow = TestingStores.FakeAutomationStore["jobs"][number];
type SessionRow = typeof DbSchema.sessions.$inferSelect;

export const seedResult = (
  tests: TestingStores.FakeTestStore,
  patch: Partial<ResultRow> = {},
): ResultRow => {
  const row: ResultRow = {
    id: RESULT,
    runId: RUN,
    definitionId: 1,
    sessionId: null,
    model: null,
    linearId: TICKET,
    status: "pending",
    reason: null,
    createdAt: new Date(),
    finishedAt: null,
    ...patch,
  };
  tests.results.push(row);
  return row;
};

export const seedAction = (
  automation: TestingStores.FakeAutomationStore,
  patch: Partial<ActionRow> = {},
): ActionRow => {
  const row: ActionRow = {
    id: `00000000-0000-4000-8000-${String(automation.jobs.length + 1).padStart(12, "0")}`,
    resultId: RESULT,
    action: "drive",
    status: "pending",
    reason: null,
    serverId: null,
    createdAt: new Date(automation.jobs.length),
    startedAt: null,
    finishedAt: null,
    ...patch,
  };
  automation.jobs.push(row);
  return row;
};

export const definition = (id: number, name: string) => ({
  id,
  name,
  description: `${name} description`,
  instruction: `${name} instruction`,
  proof: `${name} proof`,
  createdAt: new Date(0),
});

const unexpected = (member: string) => Effect.die(`Unexpected ${member}`);

// The verdicts the diagnosing agent wrote, by session.
const diagnosisLayer = (
  verdicts: Map<string, "passed" | "failed">,
  getDiagnosis: (typeof Diagnosis.DiagnosisStore.Service)["getDiagnosis"] | undefined,
) =>
  Layer.succeed(Diagnosis.DiagnosisStore)(
    Diagnosis.DiagnosisStore.of({
      createErrorType: () => unexpected("DiagnosisStore.createErrorType"),
      listErrorTypes: unexpected("DiagnosisStore.listErrorTypes"),
      findErrorType: () => unexpected("DiagnosisStore.findErrorType"),
      saveDiagnosis: () => unexpected("DiagnosisStore.saveDiagnosis"),
      getDiagnosis:
        getDiagnosis ??
        ((sessionId) =>
          Effect.sync(() =>
            Option.map(Option.fromUndefinedOr(verdicts.get(sessionId)), (verdict) => ({
              sessionId,
              verdict,
              errorType: verdict === "failed" ? "guest-crash" : null,
              summary: "the proof",
              model: "a model",
              createdAt: new Date(0),
            })),
          )),
    }),
  );

const sessionLayer = (sessions: Map<string, SessionRow>) =>
  Layer.succeed(Sessions.SessionStore)(
    Sessions.SessionStore.of({
      insertSession: () => unexpected("SessionStore.insertSession"),
      sessionRunning: () => unexpected("SessionStore.sessionRunning"),
      endSession: () => unexpected("SessionStore.endSession"),
      failRoutedSessions: () => unexpected("SessionStore.failRoutedSessions"),
      getSessionStatus: () => unexpected("SessionStore.getSessionStatus"),
      getSession: (id) => Effect.sync(() => Option.fromUndefinedOr(sessions.get(id))),
      sessionExists: () => unexpected("SessionStore.sessionExists"),
      registerAgent: () => unexpected("SessionStore.registerAgent"),
      sessionForAgent: () => unexpected("SessionStore.sessionForAgent"),
      listSessions: () => unexpected("SessionStore.listSessions"),
    }),
  );

// The automation clients by id, as the fleet's rows name them.
const serverLayer = (clients: Map<string, string>) =>
  Layer.succeed(Servers.ServerStore)(
    Servers.ServerStore.of({
      addServer: () => unexpected("ServerStore.addServer"),
      heartbeat: () => unexpected("ServerStore.heartbeat"),
      removeServer: () => unexpected("ServerStore.removeServer"),
      listServers: () => unexpected("ServerStore.listServers"),
      listMachines: () => unexpected("ServerStore.listMachines"),
      listLiveServers: () => unexpected("ServerStore.listLiveServers"),
      removeStaleServers: () => unexpected("ServerStore.removeStaleServers"),
      findServer: (id) =>
        Effect.sync(() =>
          Option.map(Option.fromUndefinedOr(clients.get(id)), (url) => ({ id, url })),
        ),
      routeSession: () => unexpected("ServerStore.routeSession"),
      serverForSession: () => unexpected("ServerStore.serverForSession"),
      routeAgent: () => unexpected("ServerStore.routeAgent"),
      serverForAgent: () => unexpected("ServerStore.serverForAgent"),
      clearAgent: () => unexpected("ServerStore.clearAgent"),
    }),
  );

export const session = (id: string, status: SessionRow["status"], reason: string | null = null) => ({
  id,
  config: { iso: "omarchy.iso" },
  status,
  reason,
  startedAt: new Date(0),
  endedAt: null,
});

// Every service a job's transitions and searches read, over fakes a test can seed and script.
export const harness = (
  options: {
    readonly tests?: TestingStores.FakeTestStore;
    readonly automation?: TestingStores.FakeAutomationStore;
    readonly linear?: TestingLinear.FakeLinear;
    readonly getDiagnosis?: (typeof Diagnosis.DiagnosisStore.Service)["getDiagnosis"];
  } = {},
) => {
  const tests = options.tests ?? TestingStores.fakeTestStore();
  const automation = options.automation ?? TestingStores.fakeAutomationStore();
  const linear = options.linear ?? TestingLinear.fakeLinear();
  const log = recordingLog();
  const verdicts = new Map<string, "passed" | "failed">();
  const sessions = new Map<string, SessionRow>();
  const clients = new Map<string, string>();
  return {
    tests,
    automation,
    linear,
    log,
    verdicts,
    sessions,
    clients,
    layer: Layer.mergeAll(
      tests.layer,
      automation.layer,
      linear.layer,
      log.layer,
      diagnosisLayer(verdicts, options.getDiagnosis),
      sessionLayer(sessions),
      serverLayer(clients),
    ),
  };
};

export type Harness = ReturnType<typeof harness>;

// The failure an unreadable file in the checkout reads as.
export const permissionDenied = (path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "open",
    pathOrDescriptor: path,
    syscall: "open",
    cause: new Error(`EACCES: permission denied, open '${path}'`),
  });

// An effect that counts its runs and fails every one of them.
export const failing = <E>(error: E) => {
  const counter = { attempts: 0 };
  return {
    counter,
    effect: Effect.suspend(() => {
      counter.attempts += 1;
      return Effect.fail(error);
    }),
  };
};
