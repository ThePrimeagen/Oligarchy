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
| `startAction` | `db, {sessionId, agentId, kind, request: QemuCommand}` | opens the action row the moment the command goes out; returns its auto-incrementing id |
| `finishAction` | `db, id, {response: QemuResponse \| null, error}, image?` | closes it: QEMU's reply or the error, plus `finished_at`. A successful get-image passes its PNG and the update + image insert land in one transaction — images are 1:1 with their action |

## The shape of an action

An action is one QMP exchange, opened then closed, its id relating the two. `startAction` inserts the row with the exact command JSON sent to QEMU — `QemuCommand`: `qmp_capabilities` for a start's handshake, `send-key`, `screendump`. `finishAction` closes it by id with the exact JSON QEMU sent back — `QemuResponse`: the greeting for a start, the `{return}` reply otherwise — or the error message when it failed. A get-image's PNG is what QEMU wrote into the session dir and the server read back: the raw bytes ride the closing update into `images`, 1:1 by action id. A stop or finish exchanges nothing with QEMU, so it gets no action; the session's status and reason are its record.

`finished_at` stamps the close, from the database clock, so handling time is `finished_at - created_at` with no cross-clock arithmetic. A row that never finished is a truthful record of a command whose completion was never persisted — the server died running it, or the closing write failed.

## Replaying a session

`actions WHERE session_id ORDER BY created_at, id` — the identity id is the tiebreaker when timestamps collide, and `created_at` is when the command went out because the row is inserted at start. `sessions.config` holds the effective launch config (defaults applied), so a replay can boot an identical machine.
