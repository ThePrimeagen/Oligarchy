// Drizzle schema for the control-plane database (PlanetScale Postgres).
//
// Four tables: sessions (one row per QEMU boot), agent_runs (which cloud
// agents drove it), actions (every control-plane request, in order), and
// images (the PNG each get-image returned).
//
// Replaying a session is: actions WHERE session_id ORDER BY created_at, id.

import { bigint, customType, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// drizzle-orm has no built-in bytea column type for postgres.
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// downloading = the ISO is being fetched from the internet; the session
// exists but QEMU has not booted yet.
export const sessionStatus = pgEnum("session_status", ["downloading", "running", "succeeded", "failed", "aborted"]);
export const actionKind = pgEnum("action_kind", ["start", "send-keys", "get-image", "stop", "finish"]);

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
    // Null when the request was not attributed to an agent (manual use).
    agentId: text("agent_id").references(() => agentRuns.agentId),
    kind: actionKind("kind").notNull(),
    // The payload as received: {keys, encoding} for send-keys, {iso, disk}
    // for start, {status, reason} for finish, {} otherwise.
    request: jsonb("request").notNull(),
    // What came back on success: the QMP greeting for start, {} where the
    // operation has nothing to say (the get-image PNG lives in images).
    response: jsonb("response"),
    // The error message returned, when the action failed.
    error: text("error"),
    // The row is inserted when the request starts and closed when it ends:
    // a finished action has finished_at plus exactly one of response or
    // error; a row with neither is a request whose completion never made it
    // to the database — the proxy died running it, or the close failed.
    // Handling time is finished_at - created_at.
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
