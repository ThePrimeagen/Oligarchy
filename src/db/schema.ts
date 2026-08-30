import { bigint, customType, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// drizzle-orm has no built-in bytea column type for postgres.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const sessionStatus = pgEnum("session_status", ["downloading", "running", "succeeded", "failed", "aborted", "timed_out"]);
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

export const images = pgTable("images", {
  actionId: bigint("action_id", { mode: "number" })
    .primaryKey()
    .references(() => actions.id),
  data: bytea("data").notNull(),
});

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
