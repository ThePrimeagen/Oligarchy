import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// v2's tables. v1 runs on this same database with its tables in public (v1.ts), so v2 keeps to
// a schema of its own: it adds beside v1 and never alters or leans on a v1 table. Everything a
// job leaves behind is keyed by the job's id; a job is one run of one definition.
export const v2 = pgSchema("v2");

// drizzle-orm has no built-in bytea column type for postgres.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const jobStatus = v2.enum("job_status", [
  "pending",
  "running",
  "needs_review",
  "reviewing",
  "succeeded",
  "failed",
  "errored",
  "aborted",
]);
// Declared mint first: the queue orders by kind, and a mint goes ahead of every test.
export const jobKind = v2.enum("job_kind", ["mint", "test"]);
// Where the job's VM is: a slot reserved on a qemu server, the iso downloading, booted, or gone.
export const vmStatus = v2.enum("vm_status", ["reserved", "downloading", "running", "stopped"]);
// What the driving agent reported and what the reviewer found: the test's vocabulary.
export const verdict = v2.enum("verdict", ["passed", "failed"]);
// Declared in ascending severity: Postgres orders enums by declaration, so
// "WHERE level >= 'error'" reads the scary lines.
export const logLevel = v2.enum("log_level", ["info", "warning", "error", "fatal"]);
export const actionState = v2.enum("action_state", ["completed", "failed"]);
// qemu servers boot VMs; an automation-client is a host that announces itself the same way.
export const serverType = v2.enum("server_type", ["qemu", "automation-client"]);

// The stored mission an agent is handed: what it is about, what to do, and the proof that
// closes it. A row is never updated: an edit is a new row with the same name and a higher id, so
// a job's definition_id names the exact wording it ran against. A name's newest wording is its
// highest id, and its version is the row's place among the name's rows by id.
export const definitions = v2.table(
  "definitions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    instruction: text("instruction").notNull(),
    proof: text("proof").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("definitions_name_idx").on(table.name)],
);

// The shared preamble composed into an agent's prompt ahead of a definition's instruction.
// Edited in place, name the lookup key: nothing pins one, so nothing needs its history.
export const basePrompts = v2.table(
  "base_prompts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("base_prompts_name_idx").on(table.name)],
);

// Definitions run against one ISO and one control-plane server. A run has no status of its own:
// its jobs say where it stands.
export const runs = v2.table("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  iso: text("iso").notNull(),
  serverUrl: text("server_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One definition run once. A rerun is a new job naming the one it reruns in previous_id, which
// is unique: a job is rerun at most once. report is what the driving agent claimed; status is
// what the reviewer judged. queued_at orders the queue and moves to the back when a job is
// queued again; seq breaks the tie between jobs one transaction queued.
// client is the automation client that last took the job. server_url is the qemu server its VM
// is on, written when the slot is reserved: every later request for the VM goes there. Both are
// attribution, not relations: forgetting a machine keeps the job and keeps its VM routable.
// A mint boots the iso fresh and a test resumes from the mint's disk, so the kind says which.
export const jobs = v2.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    definitionId: bigint("definition_id", { mode: "number" })
      .notNull()
      .references(() => definitions.id),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    client: text("client"),
    reportStatus: verdict("report_status"),
    reportReason: text("report_reason"),
    previousId: uuid("previous_id").references((): AnyPgColumn => jobs.id),
    reason: text("reason"),
    serverUrl: text("server_url"),
    vmStatus: vmStatus("vm_status"),
    vmStartedAt: timestamp("vm_started_at", { withTimezone: true }),
    vmStoppedAt: timestamp("vm_stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("jobs_previous_id_idx").on(table.previousId),
    index("jobs_status_queued_at_idx").on(table.status, table.queuedAt),
    index("jobs_run_id_idx").on(table.runId),
    check(
      "jobs_report_check",
      sql`${table.reportStatus} IS NOT NULL OR ${table.reportReason} IS NULL`,
    ),
    // A VM is on a server from its reservation on: one without the other is a lost VM.
    check("jobs_vm_check", sql`(${table.serverUrl} IS NULL) = (${table.vmStatus} IS NULL)`),
  ],
);

// Every status a job has had, in order: from is null for the row its create wrote.
export const jobEvents = v2.table(
  "job_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    from: jobStatus("from_status"),
    to: jobStatus("to_status").notNull(),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("job_events_job_id_idx").on(table.jobId)],
);

// The mint lock: one mint per iso and qemu server, in flight or done and left in place, because
// every test on that server resumes from the disk it builds. The primary key is the lock, so a
// second mint for the pair is refused. A server deletes its own rows when it comes online, so a
// restarted host keeps no stale lock; server_url is indexed on its own for that delete.
export const mints = v2.table(
  "mints",
  {
    iso: text("iso").notNull(),
    serverUrl: text("server_url").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.iso, table.serverUrl] }),
    index("mints_server_url_idx").on(table.serverUrl),
    uniqueIndex("mints_job_id_idx").on(table.jobId),
  ],
);

// One request the agent sent the job's VM, and what came back.
export const actions = v2.table(
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

// The screenshot an action took.
export const images = v2.table(
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

// job_id is attribution, not a relation: a log must never be refused because the job it names
// is missing or already gone. It is null for a line about the process rather than one job.
// location is the process that wrote the line: "server" (a qemu server) or "automation".
export const logs = v2.table(
  "logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id"),
    location: text("location").notNull(),
    level: logLevel("level").notNull().default("info"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("logs_job_id_idx").on(table.jobId),
    index("logs_location_idx").on(table.location),
  ],
);

// What the VM and its machine said, saved once when a job fails. journalctl, dmesg and compositor
// crashes are not separate streams: they appear in serial only if the VM wrote them to the UART.
export type DebugLogSources = {
  readonly serial: string;
  readonly proxy: string;
  readonly qemu: string;
  readonly actions: string;
};

export const debugLogs = v2.table("debug_logs", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id),
  sources: jsonb("sources").$type<DebugLogSources>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The diagnosis vocabulary as data, not an enum: a new kind of failure is an insert the moment it
// is first seen, never a migration. Starts empty; a rename cascades.
export const errorTypes = v2.table("error_types", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The reviewer's diagnosis of a job, one per job: a job without one is a job nobody has
// reviewed. error_type names the cause of a failed verdict and is null exactly when the verdict
// is passed, and the check keeps the two honest. model wrote it.
export const diagnoses = v2.table(
  "diagnoses",
  {
    jobId: uuid("job_id")
      .primaryKey()
      .references(() => jobs.id),
    verdict: verdict("verdict").notNull(),
    errorType: text("error_type").references(() => errorTypes.key, { onUpdate: "cascade" }),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("diagnoses_error_type_idx").on(table.errorType),
    check(
      "diagnoses_verdict_error_type_check",
      sql`(${table.verdict} = 'passed') = (${table.errorType} IS NULL)`,
    ),
  ],
);

// What a server last said of itself: machines running, memory in use, and the cpu busy over its
// newest one, two and three minutes, in percent.
export type ServerStats = {
  readonly qemus: number;
  readonly memory: { readonly totalBytes: number; readonly usedBytes: number };
  readonly cpu: { readonly mean1m: number; readonly mean2m: number; readonly mean3m: number };
};

// The fleet: one row per server, keyed by the url exactly as given, written by an operator or by
// the server itself. A server announces itself every thirty seconds: the write rewrites stats,
// stamps heartbeat_at and counts generation up, and a shutdown deletes the row. A generation that
// stops moving is a server that stopped without a chance to leave; ten minutes of that and the
// process that reads the row's kind deletes it, a row nobody ever claimed counting from
// created_at. stats and heartbeat_at are null together, for a row an operator added that no
// server has claimed. id is the stable handle; name is what the operator called the machine.
export const servers = v2.table(
  "servers",
  {
    id: uuid("id").notNull().defaultRandom().unique(),
    url: text("url").primaryKey(),
    name: text("name"),
    type: serverType("type").notNull(),
    stats: jsonb("stats").$type<ServerStats>(),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("servers_name_idx").on(table.name)],
);

// What a server said of its own process at one heartbeat: current jobs, VmRSS of the process and
// every child that still answers, and the cpu busy over the last thirty seconds. One insert per
// tick. name is the machine, not a relation: the row outlives the servers row.
export type ProcessStats = {
  readonly jobs: number;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
};

export const processStats = v2.table(
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
