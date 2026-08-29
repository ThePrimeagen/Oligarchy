# The control-plane database

One PlanetScale Postgres database holds the record of everything the proxy does. `src/db/schema.ts` defines the four tables (sessions, agent_runs, actions, images); `src/db/ops.ts` is the only code that touches them. Nothing calls the interface yet — wiring it into the proxy is its own change.

## The state that threads through

`connectDatabase()` builds one drizzle client from `DATABASE_URL` (the password rides inside the url). That client is the server state: every operation below is a standalone function taking it as its first argument, so no other code carries connection details around. A missing `DATABASE_URL` throws — a control plane that cannot record its sessions is not allowed to limp into requests (see the [philosophy](philosophy.md): startup requirements fail at startup).

## The operations

| Function | Arguments | What it writes |
| --- | --- | --- |
| `connectDatabase` | — | nothing; builds the `Db` client from `DATABASE_URL`, throws when unset |
| `insertSession` | `db, id, config, status` | the session row, before any boot work; status `downloading` for a url iso, else `running` |
| `sessionRunning` | `db, id` | status → `running` once the QEMU is up after a download |
| `endSession` | `db, id, status, reason` | verdict (`succeeded`/`failed`/`aborted`), reason, `ended_at` — on the session and its open agent runs, in one transaction stamped by one `now()` |
| `registerAgent` | `db, agentId, sessionId` | the agent_runs row tying a cloud agent to the session it drives; a second registration is a database error by design |
| `startAction` | `db, {sessionId, agentId, kind, request}` | opens the action row the moment the request starts; returns its auto-incrementing id |
| `finishAction` | `db, id, {response, error}, image?` | closes it: the response or the error, plus `finished_at`. A successful get-image passes its PNG and the update + image insert land in one transaction — images are 1:1 with their action |

## The shape of an action

An action is opened, then closed, and its id is what relates the two. `startAction` inserts the row with the request payload the moment work starts; `finishAction` closes it by id with what came back — the response on success (the QMP greeting for a start; `{}` where the operation has nothing to say), the error message on failure. `finished_at` stamps the close, from the database clock, so handling time is `finished_at - created_at` with no cross-clock arithmetic. A row that never finished is a truthful record of a request whose completion was never persisted — the server died running it, or the closing write failed.

## Replaying a session

`actions WHERE session_id ORDER BY created_at, id` — the identity id is the tiebreaker when timestamps collide, and `created_at` is arrival time because the row is inserted at start. `sessions.config` holds the effective launch config (defaults applied), so a replay can boot an identical machine.
