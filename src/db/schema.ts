// Drizzle schema for the control-plane database (PlanetScale Postgres).
//
// Five tables: sessions (one row per QEMU boot), agent_runs (which cloud
// agents drove it), actions (every QMP exchange, in order), images (the
// PNG each get-image returned), and logs (lines from db.log at a severity
// level, each pinned to a session and an agent when the writer had them).
//
// Replaying a session is: actions WHERE session_id ORDER BY created_at, id.
// Debugging one is that plus: logs WHERE session_id, same order.

import { bigint, customType, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// drizzle-orm has no built-in bytea column type for postgres.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// downloading = the ISO is being fetched from the internet; the session
// exists but QEMU has not booted yet.
export const sessionStatus = pgEnum("session_status", ["downloading", "running", "succeeded", "failed", "aborted", "timed_out"]);
// Declared in ascending severity: Postgres orders enums by declaration, so
// "WHERE level >= 'error'" reads the scary lines. fatal is the line written
// on the way down — the process exits right after it.
export const logLevel = pgEnum("log_level", ["info", "warning", "error", "fatal"]);
// The only two states an exchange can finish in. An action that is still
// running has no state yet (null, alongside a null finished_at).
export const actionState = pgEnum("action_state", ["completed", "failed"]);

export const sessions = pgTable("sessions", {
  // The uuid minted by the server at /start — not a database default.
  id: uuid("id").primaryKey(),
  // The effective launch config after server defaults were applied, so a
  // replay can boot an identical machine — not just what the client asked for.
  config: jsonb("config").notNull(),
  status: sessionStatus("status").notNull().default("running"),
  // Optional explanation for the verdict, in practice the failure reason.
  reason: text("reason"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
    // The cloud agent's own external id. An agent drives exactly one session,
    // so this is the primary key: registering it twice is a database error.
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
    // Insert order at the single server; the replay tiebreaker for actions
    // whose created_at collide.
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    // Kept nullable for historical rows; the proxy now always writes an
    // agent id (the HTTP layer requires one on every driving request).
    agentId: text("agent_id").references(() => agentRuns.agentId),
    // The exact JSON sent to QEMU over QMP (a QemuCommand); its execute
    // field names the command.
    request: jsonb("request").notNull(),
    // How the exchange ended. completed: response is QEMU's exact reply
    // (the greeting for qmp_capabilities at boot, the {return} reply
    // otherwise; a get-image's PNG lives in images). failed: response is
    // QEMU's {error} reply, or this server's error message when the failure
    // never reached QEMU (a timeout, a dead socket).
    state: actionState("state"),
    response: jsonb("response"),
    // The row is inserted when the command goes out and closed when the
    // exchange ends; state, response, and finished_at land together. A row
    // where they are null is an exchange whose completion was never
    // persisted. Handling time is finished_at - created_at.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("actions_session_id_idx").on(table.sessionId)],
);

export const images = pgTable("images", {
  // 1:1 with its get-image action, so the action id is the primary key.
  actionId: bigint("action_id", { mode: "number" })
    .primaryKey()
    .references(() => actions.id),
  // Blob for now: when images move somewhere smarter, only this table changes.
  data: bytea("data").notNull(),
});

// Debug lines written by log() in src/db/log.ts; every line also goes to
// stderr. session_id and agent_id are attribution, not relations — a log
// must never be refused because the row it names is missing or already
// gone, so neither is a foreign key.
export const logs = pgTable(
  "logs",
  {
    // Assigned in insert order; the tiebreaker for lines whose created_at
    // collide.
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // The QEMU session the line belongs to; null for server-wide work.
    sessionId: uuid("session_id"),
    // The cloud agent the line is attributed to; null when none was involved.
    agentId: text("agent_id"),
    // Severity, defaulting to info: most lines are the normal story, and a
    // writer should not have to say so (see log.ts for what each level means).
    level: logLevel("level").notNull().default("info"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("logs_session_id_idx").on(table.sessionId)],
);
