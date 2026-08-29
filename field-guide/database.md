# The control-plane database

One PlanetScale Postgres database records everything the proxy does. `src/db/schema.ts` defines the four tables (sessions, agent_runs, actions, images); `src/db/ops.ts` is the only code that touches them.

## The state that threads through

`connectDatabase()` builds one drizzle client from `DATABASE_URL` (the password rides inside the url) at proxy boot. That client is the server state: every operation below is a standalone function taking it as its first argument, so no other code carries connection details around. The proxy will not boot without `DATABASE_URL` — a control plane that cannot record its sessions is not allowed to limp into requests (see the [philosophy](philosophy.md): startup requirements fail at startup).

Recording a success is part of the operation: if the row cannot be written, the request fails, so a 200 always means the database saw it. Recording a *failure* is best-effort — the real error is the one worth returning, so a failed write on that path only logs to stderr.

## The operations

| Function | Arguments | What it writes |
| --- | --- | --- |
| `connectDatabase` | — | nothing; builds the `Db` client from `DATABASE_URL`, throws when unset |
| `insertSession` | `db, id, config, status` | the session row, before any boot work; status `downloading` for a url iso, else `running` |
| `sessionRunning` | `db, id` | status → `running` once the QEMU is up after a download |
| `endSession` | `db, id, status, reason` | verdict (`succeeded`/`failed`/`aborted`), reason, `ended_at` — and closes the session's open agent runs, in one transaction |
| `registerAgent` | `db, agentId, sessionId` | the agent_runs row tying a cloud agent to the session it drives; a second registration is a database error by design |
| `recordAction` | `db, {sessionId, agentId, kind, request, error, durationMs}, image?` | one replay-log row per control-plane request; returns the action id. A successful get-image passes its PNG and the pair lands in one transaction — images are 1:1 with their action |

## When rows are written

- **`/start`** inserts the session row first — so the download phase and every failure land on a real row — and registers the agent from the `x-oligarchy-agent` header when one is sent. A url iso starts as `downloading` and flips to `running` once QEMU is up. A failed start is torn down, marked `failed` with the error as the reason, and still gets its action row.
- **`/send-keys`**, **`/image`**, **`/stop`**, **`/finish`** each append one action row with the request payload as received, the error message when they fail, and the server-side handling time. `/image` also stores the PNG. `/stats` is host telemetry, not a session action, and is not recorded.
- **`/stop`** ends the session as `aborted` (an end without a verdict); **`/finish`** ends it as `succeeded` or `failed` with the caller's reason. Both stamp `ended_at` on the session and its agent runs.
- **Shutdown** (SIGINT/SIGTERM) stops every live session and ends it as `aborted` with reason `proxy shutdown`, so a restart never leaves rows claiming to run.

Requests for a session id the proxy does not know fail before recording: there is no session row for them to reference.

## Replaying a session

`actions WHERE session_id ORDER BY created_at, id` — the identity id is the tiebreaker when timestamps collide. `sessions.config` holds the effective launch config (defaults applied), so a replay can boot an identical machine.
