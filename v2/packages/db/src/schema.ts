import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// drizzle-orm has no built-in bytea column type for postgres.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const testSuiteStatus = pgEnum("test_suite_status", [
  "pending",
  "running",
  "passed",
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
  "completed",
  "errored",
]);
// Declared in ascending severity: Postgres orders enums by declaration, so
// "WHERE level >= 'error'" reads the scary lines.
export const logLevel = pgEnum("log_level", ["info", "warning", "error", "fatal"]);
export const actionState = pgEnum("action_state", ["completed", "failed"]);
// The reviewer's own answer to "did the proof land": the test's vocabulary, not the job's.
export const diagnosisVerdict = pgEnum("diagnosis_verdict", ["passed", "failed"]);

// What kind of machine a server boots, and so which reverse proxy fronts it. qemu servers
// boot guests; an automation-client is a host that announces itself the same way.
export const serverType = pgEnum("server_type", ["qemu", "automation-client"]);

export const jobAction = pgEnum("job_action", ["drive", "diagnose", "mint"]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
  "completed",
  "errored",
]);

export const actions = pgTable(
  "actions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    request: jsonb("request").notNull(),
    state: actionState("state"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("actions_job_id_idx").on(table.jobId)],
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

// location is the service that wrote the line (the tester writes "tester"); run_id is the
// test run the line is about, null for a line about none. Both are attribution, not
// relations: a log must never be refused because the row it names is missing or already
// gone, so run_id is not a foreign key.
export const logs = pgTable(
  "logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    location: text("location"),
    runId: uuid("run_id"),
    level: logLevel("level").notNull().default("info"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("logs_location_idx").on(table.location),
    index("logs_run_id_idx").on(table.runId),
  ],
);

// One snapshot per failed job, keyed by origin. journalctl / dmesg / compositor
// crashes are not separate streams: they appear in `serial` only if the guest wrote
// them to the UART. job_id is the key; a second save is a database error by design.
export type DebugLogSources = {
  readonly serial: string;
  readonly proxy: string;
  readonly qemu: string;
  readonly actions: string;
};

export const debugLogs = pgTable("debug_logs", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id),
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

// One diagnosis per ended job, keyed by the job it reviews, a drive or a mint, never the diagnose
// job that wrote it: a row absent is a job nobody has reviewed. verdict is the reviewer's, written after reading the evidence, and may disagree with
// the driver's stop status and the test run's status. error_type names the cause of a failed verdict and is
// null exactly when the verdict is passed: a pass has no cause to name, and the check keeps the two
// columns honest. model wrote it.
export const postRunDiagnosis = pgTable(
  "post_run_diagnosis",
  {
    jobId: uuid("job_id")
      .primaryKey()
      .references(() => jobs.id),
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

// The fleet the reverse proxy places jobs on: one row per server, keyed by the url exactly
// as given, written by an operator (the dashboard, POST /servers) or by the server itself. A
// server announces itself every thirty seconds: the write rewrites stats, stamps heartbeat_at
// and counts generation up, and a shutdown deletes the row. A generation that stops moving is
// a server that stopped without a chance to leave — killed, or cut off from the database; ten
// minutes of that and the process that reads the row's kind deletes it, a row nobody ever
// claimed counting from created_at. stats and heartbeat_at are null together, for a row an
// operator added that no server has claimed. type says what kind of server the row is, so a
// reader lists and sweeps its own kind: the qemu reverse proxy the qemu fleet, the automation
// server the automation-clients. Every writer names it, and the default is what the migration
// filled the rows that predate the column with — qemu servers were the only kind there was.
// automation-client is the other kind: same heartbeat, listed apart from the qemu fleet. id is
// the stable handle a job stores when it is claimed, and what its abort looks the client up by;
// a job still running on a client silent for ten minutes keeps that id and can no longer be
// aborted this way — the client is gone, or as good as. url remains the key a heartbeat upserts
// on. name is what the operator called the machine (--name); null on a row nobody has claimed
// yet.
export const servers = pgTable(
  "servers",
  {
    id: uuid("id").notNull().defaultRandom().unique(),
    url: text("url").primaryKey(),
    name: text("name"),
    type: serverType("type").notNull().default("qemu"),
    stats: jsonb("stats").$type<ServerStats>(),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("servers_name_idx").on(table.name)],
);

// What a qemu server or automation-client said of this process at one heartbeat: current
// jobs, VmRSS of this process and every child that still answers, and the cpu busy over
// the last thirty seconds. One insert per tick, so a later graph can read the series.
// name is the machine (--name), not a relation: the row outlives the servers row, and a
// shutdown or an operator's delete must not erase it.
export type ProcessStats = {
  readonly jobs: number;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
};

export const processStats = pgTable(
  "process_stats",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    type: serverType("type").notNull(),
    jobs: integer("jobs").notNull(),
    memoryBytes: bigint("memory_bytes", { mode: "number" }).notNull(),
    cpuPercent: doublePrecision("cpu_percent").notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("process_stats_name_reported_at_idx").on(table.name, table.reportedAt)],
);

// Which qemu server holds a job's guest: written when the job's slot is reserved, before the
// guest starts, so the start and every later request for the job find the machine. One server
// per job. The row outlives the qemu reverse proxy process, which is why it is a row. server_url
// is attribution, not a relation: forgetting a server must keep the jobs still running on it
// routable.
export const jobServers = pgTable("job_servers", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id),
  serverUrl: text("server_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// What the host can see of a VM. Live: downloading its ISO, then running. Ended, by QEMU's SHUTDOWN
// reason: shutdown (the guest powered itself off), stopped (the host ended it), panicked (the
// guest's pvpanic device fired); crashed, QEMU gone with no SHUTDOWN at all; or server-error, a VM
// the qemu server itself failed, such as one its crashed last process left running. A shutdown
// says the guest asked to power off, never whether its run went well. Named apart from the
// vm_status table, since a table's row type takes the table's name.
export const vmState = pgEnum("vm_state", [
  "downloading",
  "running",
  "shutdown",
  "stopped",
  "panicked",
  "crashed",
  "server-error",
]);

// Each change in a job's VM is a row of its own, never updated: its status is its newest row, and
// when it started or ended is when that row was written. id orders the changes, which can share a
// timestamp. reason is set exactly on a crash or a server error, and says what went wrong.
export const vmStatus = pgTable(
  "vm_status",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    status: vmState("status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("vm_status_job_id_id_idx").on(table.jobId, table.id),
    check(
      "vm_status_reason_check",
      sql`(${table.status} IN ('crashed', 'server-error')) = (${table.reason} IS NOT NULL)`,
    ),
  ],
);

// One setup in flight, or finished and left in place, per iso and server. The primary key is
// the lock: a second insert fails, so one mint per pair. job_id is the one mint job holding
// the lock, null until that job exists. A job that ends without success releases the lock and
// a new mint job takes it; a job that succeeded keeps it. Not a foreign key, and server_url is
// not one either: forgetting a server does not cascade the row away, and a success stays when
// retention sweeps the job. A server deletes its own rows once, when it comes online, so a
// restarted host cannot keep a stale lock. Many null job ids are allowed; one mint job holds
// one lock at most. server_url is indexed
// on its own — the primary key leads with iso — for that delete. Not unique: one server, many isos.
export const setupRequests = pgTable(
  "setup_requests",
  {
    iso: text("iso").notNull(),
    serverUrl: text("server_url").notNull(),
    jobId: uuid("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.iso, table.serverUrl] }),
    index("setup_requests_server_url_idx").on(table.serverUrl),
    uniqueIndex("setup_requests_job_id_idx").on(table.jobId),
  ],
);

// A definition is the stored mission an agent is handed — what it is about, what to
// do, and the proof that closes it. A row is never updated: an edit is a new row with
// the same name and a higher id, so a test run's definition_id names the exact wording
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
// server. The orchestrator owns the row: it opens the suite and declares the
// verdict once the test runs are in — or timed_out when reports stop coming.
// Counts are not stored — planned and reported are both readable off the
// test_runs rows. The Cursor model lives on each test run: one suite can mix
// models.
export const testSuites = pgTable("test_suites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  iso: text("iso").notNull(),
  serverUrl: text("server_url").notNull(),
  status: testSuiteStatus("status").notNull().default("pending"),
  reason: text("reason"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// One row per definition in the suite, inserted pending: capacity decides when it
// runs, and the orchestrator marks it running when it spawns the driver. The agent's
// report closes it passed or failed; the orchestrator closes the rest when it closes
// the suite — timed_out when the report never came, aborted when the suite was stopped
// on purpose. model is the Cursor model id that test run's agent used.
export const testRuns = pgTable(
  "test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => testSuites.id),
    definitionId: bigint("definition_id", { mode: "number" })
      .notNull()
      .references(() => testDefinitions.id),
    // Null until test start writes the Cursor model id that is running this test run.
    model: text("model"),
    status: testRunStatus("status").notNull().default("pending"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  // One test run per definition per suite: a second write is a database error by design.
  (table) => [uniqueIndex("test_runs_suite_definition_idx").on(table.suiteId, table.definitionId)],
);

// One automation step for a test run: drive the guest, or diagnose after. Inserted
// pending; a worker claims the oldest pending row, runs it, and closes with a terminal
// status. A job runs once and is never run again: a failed job stays failed, and trying
// again is a new job, so a test run holds every mint, drive and diagnose it took. Queue order is created_at among pending rows; capacity limits stay out of this table.
// server_id is the servers.id that claimed the job, so /abort can find that client after
// a restart; null while the row is pending. Attribution, not a relation: forgetting a
// server must keep the job row.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => testRuns.id),
    action: jobAction("action").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    reason: text("reason"),
    serverId: uuid("server_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("jobs_run_action_idx").on(table.runId, table.action),
    index("jobs_status_created_at_idx").on(table.status, table.createdAt),
  ],
);
