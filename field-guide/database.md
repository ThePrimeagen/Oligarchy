# The control-plane database

One PlanetScale Postgres database holds the record of everything the proxy does. `src/db/schema.ts` defines the five tables (sessions, agent_runs, actions, images, logs); `src/db/ops.ts` is the only code that touches them, except logs, which belongs to `log()` in `src/db/log.ts` — a debug line to stderr and the same line as a row, attributed to a session and an agent when the caller has them, taking the same client. The proxy records through this interface as it runs: the session row lands before any boot work (`downloading` for a url iso), every QMP exchange opens and closes an action row via the recorder hook threaded into the qemu client, a get-image's PNG rides the closing transaction, iso cache traffic goes through `log()`, and `/stop` closes the session with its verdict.

## The state that threads through

`connectDatabase()` builds one drizzle client from `DATABASE_URL` (the password rides inside the url). That client is the server state: every operation below is a standalone function taking it as its first argument, so no other code carries connection details around. A missing `DATABASE_URL` throws — a control plane that cannot record its sessions is not allowed to limp into requests (see the [philosophy](philosophy.md): startup requirements fail at startup).

## The operations

| Function | Arguments | What it writes |
| --- | --- | --- |
| `connectDatabase` | — | nothing; builds the `Db` client from `DATABASE_URL`, throws when unset |
| `insertSession` | `db, id, config, status` | the session row, before any boot work; status `downloading` for a url iso, else `running` |
| `sessionRunning` | `db, id` | status → `running` once the QEMU is up, whatever status the session entered in |
| `endSession` | `db, id, status, reason` | verdict (`succeeded`/`failed`/`aborted`), reason, `ended_at` — on the session and its open agent runs, in one transaction stamped by one `now()` |
| `registerAgent` | `db, agentId, sessionId` | the agent_runs row tying a cloud agent to the session it drives; a second registration is a database error by design |
| `startAction` | `db, {sessionId, agentId, request: QemuCommand}` | opens the action row the moment the command goes out; returns its auto-incrementing id |
| `finishAction` | `db, id, {state, response}, image?` | closes it: `completed` with QEMU's reply or `failed` with the error, plus `finished_at`. A completed get-image passes its PNG and the update + image insert land in one transaction — images are 1:1 with their action |

## The shape of an action

An action is one QMP exchange, opened then closed, its id relating the two. `startAction` inserts the row with the exact command JSON sent to QEMU (`QemuCommand` — `qmp_capabilities`, `send-key`, `screendump`; the `execute` field names the command, so there is no separate kind column). `finishAction` closes it by id in one of the only two states an exchange can finish in:

- **`completed`** — the response is QEMU's exact reply: the greeting for the boot handshake, the `{return}` reply otherwise. A get-image's PNG is what QEMU wrote into the session dir and the server read back; the raw bytes ride the closing update into `images`, 1:1 by action id.
- **`failed`** — the response is the error: QEMU's `{error}` reply when it answered, or this server's error message when the failure never reached QEMU (a timeout, a dead socket). There is no separate error column.

A still-running exchange has no state yet: `state`, `response`, and `finished_at` land together at the close, so a row where they are null is a command whose completion was never persisted — the server died running it, or the closing write failed. `finished_at` comes from the database clock, so handling time is `finished_at - created_at` with no cross-clock arithmetic. Anything that exchanges nothing over QMP (a stop, a verdict) is not an action; the session's status and reason are its record.

## Replaying a session

`actions WHERE session_id ORDER BY created_at, id` — the identity id is the tiebreaker when timestamps collide, and `created_at` is when the command went out because the row is inserted at start. `sessions.config` holds the effective launch config (defaults applied), so a replay can boot an identical machine.
