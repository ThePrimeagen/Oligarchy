import {
  bigint,
  customType,
  index,
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

// session_id and agent_id are attribution, not relations: a log must never be refused
// because the row it names is missing or already gone, so neither is a foreign key.
export const logs = pgTable(
  "logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id"),
    agentId: text("agent_id"),
    level: logLevel("level").notNull().default("info"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("logs_session_id_idx").on(table.sessionId)],
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

// The vocabulary a diagnosis is written in. It is data, not an enum, so a new kind of
// failure is an insert the moment it is first seen, never a migration; it starts empty and
// grows one row per distinct cause. key is the value a diagnosis carries, so a diagnosis
// reads without a join; a rename cascades into the diagnoses that carry it, and a type in
// use cannot be deleted.
export const postRunErrorTypes = pgTable("post_run_error_types", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One diagnosis per session that ended any way but succeeded, written after the run by
// whoever read the evidence (debug_logs, actions, images). session_id is the key: a second
// diagnosis is refused, and a session without a row is one nobody has diagnosed yet — there
// is no placeholder type and no nullable column. model is the Cursor model id that wrote
// the diagnosis, as test_results.model is the one that drove the session.
export const postRunDiagnosis = pgTable(
  "post_run_diagnosis",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => sessions.id),
    errorType: text("error_type")
      .notNull()
      .references(() => postRunErrorTypes.key, { onUpdate: "cascade" }),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("post_run_diagnosis_error_type_idx").on(table.errorType)],
);

// A definition is the stored mission an agent is handed — what it is about, what to
// do, and the proof that closes it. Rows are edited in place; name is the lookup key.
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
  (table) => [uniqueIndex("test_definitions_name_idx").on(table.name)],
);

// A base prompt is the shared preamble composed into an agent's prompt ahead of a
// definition's instruction — the driving discipline every mission repeats. Edited
// in place like definitions; name is the lookup key.
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
  ],
);
