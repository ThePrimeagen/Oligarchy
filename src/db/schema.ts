import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// drizzle-orm has no built-in bytea column type for postgres.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const sessionStatus = pgEnum("session_status", [
  "downloading",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
]);
export const testRunStatus = pgEnum("test_run_status", [
  "pending",
  "running",
  "passed",
  "failed",
  "aborted",
  "timed_out",
]);
export const testResultStatus = pgEnum("test_result_status", [
  "pending",
  "running",
  "passed",
  "failed",
  "aborted",
  "timed_out",
]);
// Declared in ascending severity: Postgres orders enums by declaration, so
// "WHERE level >= 'error'" reads the scary lines.
export const logLevel = pgEnum("log_level", ["info", "warning", "error", "fatal"]);
export const actionState = pgEnum("action_state", ["completed", "failed"]);
// The reviewer's own answer to "did the proof land": the test's vocabulary, not the session's.
export const diagnosisVerdict = pgEnum("diagnosis_verdict", ["passed", "failed"]);

// What kind of machine a server boots, and so which reverse proxy fronts it. qemu servers
// boot guests; an automation-client is a host that announces itself the same way.
export const serverType = pgEnum("server_type", ["qemu", "automation-client"]);

export const automationAction = pgEnum("automation_action", ["drive", "diagnose"]);
export const automationJobStatus = pgEnum("automation_job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
]);

export type SessionConfig = {
  iso: string;
  disk?: string;
};

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  config: jsonb("config").$type<SessionConfig>().notNull(),
  status: sessionStatus("status").notNull().default("running"),
  reason: text("reason"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
    // An agent drives exactly one session, so its id is the primary key:
    // registering a second session is a database error by design.
    agentId: text("agent_id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("agent_runs_session_id_idx").on(table.sessionId)],
);

export const actions = pgTable(
  "actions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    // Nullable for historical rows only; the proxy now always writes an agent id.
    agentId: text("agent_id").references(() => agentRuns.agentId),
    request: jsonb("request").notNull(),
    state: actionState("state"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("actions_session_id_idx").on(table.sessionId)],
);

export const images = pgTable(
  "images",
  {
    id: uuid("id").notNull().defaultRandom(),
    actionId: bigint("action_id", { mode: "number" })
      .primaryKey()
      .references(() => actions.id),
    data: bytea("data").notNull(),
  },
  (table) => [uniqueIndex("images_id_idx").on(table.id)],
);

// location and agent_id are attribution, not relations: a log must never be refused
// because the row it names is missing or already gone, so neither is a foreign key.
// location is a text bucket: a session UUID, "server" (qemu-server-wide), or "automation".
export const logs = pgTable(
  "logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    location: text("location"),
    agentId: text("agent_id"),
    level: logLevel("level").notNull().default("info"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("logs_location_idx").on(table.location)],
);

// One snapshot per failed session, keyed by origin. journalctl / dmesg / compositor
// crashes are not separate streams: they appear in `serial` only if the guest wrote
// them to the UART. session_id is the key; a second save is a database error by design.
export type DebugLogSources = {
  readonly serial: string;
  readonly proxy: string;
  readonly qemu: string;
  readonly actions: string;
};

export const debugLogs = pgTable("debug_logs", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id),
  sources: jsonb("sources").$type<DebugLogSources>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The diagnosis vocabulary as data, not an enum: a new kind of failure is an insert the
// moment it is first seen, never a migration. Starts empty; a rename cascades.
export const postRunErrorTypes = pgTable("post_run_error_types", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One diagnosis per ended session, keyed by the session: a row absent is a session nobody has
// reviewed. verdict is the reviewer's, written after reading the evidence, and may disagree with
// the driver's stop status and test result. error_type names the cause of a failed verdict and is
// null exactly when the verdict is passed: a pass has no cause to name, and the check keeps the two
// columns honest. model wrote it.
export const postRunDiagnosis = pgTable(
  "post_run_diagnosis",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => sessions.id),
    verdict: diagnosisVerdict("verdict").notNull(),
    errorType: text("error_type").references(() => postRunErrorTypes.key, { onUpdate: "cascade" }),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("post_run_diagnosis_error_type_idx").on(table.errorType),
    check(
      "post_run_diagnosis_verdict_error_type_check",
      sql`(${table.verdict} = 'passed') = (${table.errorType} IS NULL)`,
    ),
  ],
);

// What a server last said of itself, as the fleet page shows it: machines running, memory in
// use, and the cpu busy over its newest one, two and three minutes, in percent.
export type ServerStats = {
  readonly qemus: number;
  readonly memory: { readonly totalBytes: number; readonly usedBytes: number };
  readonly cpu: { readonly mean1m: number; readonly mean2m: number; readonly mean3m: number };
};

// The fleet the reverse proxy places sessions on: one row per server, keyed by the url exactly
// as given, written by an operator (the dashboard, POST /servers) or by the server itself. A
// server announces itself every thirty seconds: the write rewrites stats, stamps heartbeat_at
// and counts generation up, and a shutdown deletes the row. A generation that stops moving is
// a server that stopped without a chance to leave — killed, or cut off from the database.
// stats and heartbeat_at are null together, for a row an operator added that no server has
// claimed. type says what kind of server the row is, so a reverse proxy lists its own kind;
// every writer names it, and the default is what the migration filled the rows that predate
// the column with — qemu servers were the only kind there was. automation-client is the
// other kind: same heartbeat, listed apart from the qemu fleet. id is the stable handle a
// job stores when it is claimed; url remains the key a heartbeat upserts on. jobs and
// max_jobs stay at their defaults (0 and 1); a heartbeat does not write them.
export const servers = pgTable("servers", {
  id: uuid("id").notNull().defaultRandom().unique(),
  url: text("url").primaryKey(),
  type: serverType("type").notNull().default("qemu"),
  stats: jsonb("stats").$type<ServerStats>(),
  jobs: integer("jobs").notNull().default(0),
  maxJobs: integer("max_jobs").notNull().default(1),
  generation: bigint("generation", { mode: "number" }).notNull().default(0),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Which server started a session, so every later request for it finds the machine. The row
// outlives the qemu reverse proxy process, which is why it is a row. server_url is attribution, not a
// relation: forgetting a server must keep the sessions still running on it routable.
export const sessionServers = pgTable("session_servers", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id),
  serverUrl: text("server_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A definition is the stored mission an agent is handed — what it is about, what to
// do, and the proof that closes it. A row is never updated: an edit is a new row with
// the same name and a higher id, so a result's definition_id names the exact wording
// it ran against. A name's newest wording is its highest id, and its version is the
// row's place among the name's rows by id; name is indexed for those lookups, not
// unique.
export const testDefinitions = pgTable(
  "test_definitions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    instruction: text("instruction").notNull(),
    proof: text("proof").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("test_definitions_name_idx").on(table.name)],
);

// A base prompt is the shared preamble composed into an agent's prompt ahead of a
// definition's instruction — the driving discipline every mission repeats. Edited
// in place, name the lookup key: nothing pins one yet, so nothing needs its history.
export const testBasePrompts = pgTable(
  "test_base_prompts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("test_base_prompts_name_idx").on(table.name)],
);

// One execution of a set of definitions against one ISO and one control-plane
// server. The orchestrator owns the row: it opens the run and declares the
// verdict once the results are in — or timed_out when reports stop coming.
// Counts are not stored — planned and reported are both readable off the
// test_results rows. The Cursor model lives on each result: one run can mix
// models.
export const testRuns = pgTable("test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  iso: text("iso").notNull(),
  serverUrl: text("server_url").notNull(),
  status: testRunStatus("status").notNull().default("pending"),
  reason: text("reason"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// One row per definition in the run, inserted pending: capacity decides when it
// runs, and the orchestrator marks it running when it spawns the driver. The agent's
// report closes it passed or failed; the orchestrator closes the rest when it closes
// the run — timed_out when the report never came, aborted when the run was stopped
// on purpose. model is the Cursor model id that result's agent used.
export const testResults = pgTable(
  "test_results",
  {
    id: uuid("result_id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => testRuns.id),
    definitionId: bigint("definition_id", { mode: "number" })
      .notNull()
      .references(() => testDefinitions.id),
    // Null until test start writes the session, or until the close if start
    // was never called. Attribution is recorded fact, not an upfront guess.
    sessionId: uuid("session_id").references(() => sessions.id),
    // Null until test start writes the Cursor model id that is running this result.
    model: text("model"),
    // Null until ctrl writes the Linear issue identifier (OLI-n) created for this result.
    // The human-readable id is what webhooks carry; it is the reverse lookup key.
    linearId: text("linear_id"),
    status: testResultStatus("status").notNull().default("pending"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  // One result per definition per run, and one result per session once attributed:
  // a second write of either is a database error by design. Postgres unique
  // indexes still allow many NULL session_ids (pending results).
  (table) => [
    uniqueIndex("test_results_run_definition_idx").on(table.runId, table.definitionId),
    uniqueIndex("test_results_session_id_idx").on(table.sessionId),
    // One result per Linear ticket once assigned; many NULL linear_ids remain allowed.
    uniqueIndex("test_results_linear_id_idx").on(table.linearId),
  ],
);

// One automation step for a test result: drive the guest, or diagnose after. Inserted
// pending; a worker claims the oldest pending row, runs it, and closes with a terminal
// status. (result_id, action) is unique — one drive and one diagnose per result for now.
// Queue order is created_at among pending rows; capacity limits stay out of this table.
// server_id is the servers.id that claimed the job, so /abort can find that client after
// a restart; null while the row is pending. Attribution, not a relation: forgetting a
// server must keep the job row.
export const automationJobs = pgTable(
  "automation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => testResults.id),
    action: automationAction("action").notNull(),
    status: automationJobStatus("status").notNull().default("pending"),
    reason: text("reason"),
    serverId: uuid("server_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("automation_jobs_result_action_idx").on(table.resultId, table.action),
    index("automation_jobs_status_created_at_idx").on(table.status, table.createdAt),
  ],
);
