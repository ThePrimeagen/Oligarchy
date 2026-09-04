# The control-plane database

One PlanetScale Postgres database holds the record of everything the proxy does. `src/db/schema.ts` defines the database tables; `src/db/ops.ts` writes the control-plane record, `src/db/log.ts` writes its attributed log lines, and `src/db/query.ts` reads recent sessions, test definitions, and base prompts for the dashboard. Every path uses Drizzle; node-postgres is only the transport. The proxy records through this interface as it runs: the session row lands before any start work (`downloading` for a url iso), every QMP exchange opens and closes an action row via the recorder hook threaded into the qemu client, a get-image's PNG rides the closing transaction, `/stop` closes the session with its verdict, and ten minutes without a command closes it as `timed_out` with the reason. Alongside those rows, every major action narrates itself through `log()` — starting, running, image served, serial served, chords sent, mouse sent, stopped, timed out, shutdown, iso cache traffic — with how long the work took, and every refused or failed request is one error line attributed as far as the handler knew, so the logs alone tell the session's story, refusals included, and the state tables carry the exact records.

`client test --list` reads stored test definitions and prints one name per line. `--details` prints every field as JSON. `--name` selects one definition by the unique `test_definitions_name_idx`. `--list` is required. An unknown name is a failure. The command does not write.

`client test new` reads every test definition and creates a `test_runs` parent (ISO URL and server URL stored on the run) plus one pending `test_results` row per definition. `--name` looks up one definition by the unique `test_definitions_name_idx` and creates that one result instead. An unknown name is a failure before anything is inserted. The database generates the run UUID and each result's UUID primary key. Each definition gets its own Linear issue, labeled `agent test` and the run's version, whose body is `prompts/linear-issue.html` rendered with the issue identifier, the result UUID, the run UUID, the ISO URL, the server URL, the version, the definition, `client.md`, and the reviewer model (see [cli.md](cli.md)). If any Linear call fails, the command closes the run and its results as failed with the API error, naming the issues already created.

`client test-results` is the agent's report. It takes the result UUID, the agent id, `success` or `failed`, and an optional reason, looks up the agent's session in `agent_runs`, and closes that `test_results` row (`passed` or `failed`, reason, session, `finished_at`). The command writes the database itself from `DATABASE_URL`; the proxy is not involved. An unknown result id is a failure.

`client session` reads one session's logs, actions, attributed test result, and that result's definition. `--logs` and `--actions` are `WHERE session_id ORDER BY created_at, id`. `--test-results` and `--test-def` follow `test_results.session_id` onto the definition. `--all` prints all four. An unknown session is a failure. The command does not write.

`npm run db:migrate` reads `DATABASE_URL` from the environment (a `.env` fills in missing variables only), applies the generated migrations in `drizzle/`, and closes the one-shot database pool. Missing `DATABASE_URL` is a failure.

## The state that threads through

The proxy, `db:migrate`, `test --list`, `test new`, `test-results`, and `session` read `DATABASE_URL` from the process environment. If a `.env` is present they load it first (`loadEnvFile()`), but already-set variables win — a cloud agent's injected `DATABASE_URL` is never replaced by a file. There is no local-database fallback: a missing or unparseable `DATABASE_URL` throws. `connectDatabase()` builds one drizzle client from that url (the password rides inside it). That client is the server state: every operation below is a standalone function taking it as its first argument, so no other code carries connection details around. A control plane that cannot record its sessions is not allowed to limp into requests (see the [philosophy](philosophy.md): startup requirements fail at startup). One parameter is rewritten on the way in: PlanetScale urls end in `sslmode=verify-full&sslrootcert=system`, and node-postgres reads `sslrootcert` as a literal file path — a file named `system` does not exist, so the first query would die with ENOENT. Node's default TLS verification already is the system trust store that value asks for, so `connectDatabase()` drops the parameter and passes the rest of the url through, `sslmode=verify-full` included.

## The operations

| Function | Arguments | What it writes |
| --- | --- | --- |
| `connectDatabase` | — | nothing; builds the `Db` client from `DATABASE_URL` (dropping a `sslrootcert=system` parameter), throws when unset or unparseable |
| `insertSession` | `db, id, config, status` | the session row, before any boot work; status `downloading` for a url iso, else `running` |
| `sessionRunning` | `db, id` | status → `running` once the QEMU is up, whatever status the session entered in |
| `endSession` | `db, id, status, reason` | verdict (`succeeded`/`failed`/`aborted`/`timed_out`), reason, `ended_at` — on the session and its open agent runs, in one transaction stamped by one `now()` |
| `registerAgent` | `db, agentId, sessionId` | the agent_runs row tying a cloud agent to the session it drives; a second registration is a database error by design |
| `startAction` | `db, {sessionId, agentId, request: QemuCommand}` | opens the action row the moment the command goes out; returns its auto-incrementing id |
| `finishAction` | `db, id, {state, response}, image?` | closes it: `completed` with QEMU's reply or `failed` with the error, plus `finished_at`. A completed get-image passes `{id, data}` — the uuid and PNG — and the update + image insert land in one transaction — images are 1:1 with their action |
| `getImage` | `db, id` | the stored PNG for that image uuid, or nothing |

## The shape of an action

An action is one QMP exchange, opened then closed, its id relating the two. `startAction` inserts the row with the exact command JSON sent to QEMU (`QemuCommand` — `qmp_capabilities`, `send-key`, `screendump`, `input-send-event`; the `execute` field names the command, so there is no separate kind column). `finishAction` closes it by id in one of the only two states an exchange can finish in:

- **`completed`** — the response is QEMU's exact reply: the greeting for the boot handshake, the `{return}` reply otherwise. A get-image's PNG is what QEMU wrote into the session dir and the server read back; the raw bytes ride the closing update into `images`, 1:1 by action id, addressed by a uuid. That PNG is `GET /images/<uuid>` on the proxy and at `https://oligarchy.trm.sh/images/<uuid>` — no token. A completed screendump writes that URL on its `qemu.action` span.
- **`failed`** — the response is the error: QEMU's `{error}` reply when it answered, or this server's error message when the failure never reached QEMU (a timeout, a dead socket). There is no separate error column.

A still-running exchange has no state yet: `state`, `response`, and `finished_at` land together at the close, so a row where they are null is a command whose completion was never persisted — the server died running it, or the closing write failed. `finished_at` comes from the database clock, so handling time is `finished_at - created_at` with no cross-clock arithmetic. Anything that exchanges nothing over QMP (a stop, a verdict) is not an action; the session's status and reason are its record.

## The log stream

`log()` writes one line twice — to stdout, and as a logs row — in call order behind a chain; a failed insert reports itself to stdout and never fails the caller. The stdout line starts with `[<agent-id>]` in a color derived from that id, or `[global]` in gray when the line has no agent; the color is the same for every line of that agent so interleaved output stays attributable. The logs row is the original text, level, and attribution — the prefix and color are stdout only. The stamp is the database's, taken at the insert: a stalled database lands queued lines late, and id, not `created_at`, is the truth of their order. Every line carries a level, the `log_level` enum, declared in ascending severity so `WHERE level >= 'error'` reads the scary lines:

- **info** — the default, and the normal story: the proxy listening, a session starting / running / stopped, an image served, serial served, chords sent, mouse sent, an intent started or ended, iso cache hits and downloads.
- **warning** — something was off but the operation went on: a download heartbeat that failed to write, an iso with no published sha256 to check against.
- **error** — an operation failed: one line per failed request from the HTTP boundary (a refused request is a failed request, so a bad key string or an unknown session id lands here too, attributed when the id is one this server could have minted), an action close that could not be recorded, a session that would not stop or record at shutdown, and a defect — a bug behind the client's generic 500 — with its stack.
- **fatal** — the proxy is going down, written right before the exit: the listen failing at boot (the port is taken).

Levels are severity of the operation, not of the state it records: a `/stop` carrying a `failed` verdict still logs at info — the stop worked; the verdict lives on the session row. For the same reason a failed `/start` is one error line from the boundary, not two — attributed to the session and agent as far as the handler got before it threw, with the session row's `failed` status and reason as the state record.

Paths that end in `process.exit` — shutdown, a fatal — await `flushLogs()` then `flushSentry()` first, the chain settling, so the last lines (and a log-insert failure discovered while flushing) are not lost with the process. The db's own write failures (a log insert refused, a "recording the failure failed too") report to stdout and to Sentry: a database that is not taking writes cannot hold the line saying so.

`log()` also sends error and fatal lines to Sentry, with the exception when the caller has one. 4xx request refusals stay in the logs table and skip Sentry — they are the client's mistake. The dashboard worker is wrapped with `@sentry/cloudflare`; the proxy reports through `@sentry/node` because it is a Node process (it boots QEMU). Both use the same project DSN.

## Timing

Two clocks, each for what it is good at. Action rows are stamped by the database — `finished_at - created_at` is per-exchange handling time with no cross-clock arithmetic. The proxy's log lines carry request-level wall time measured at the server — `running; started in 45123ms`, `image; 48213 bytes in 87ms`, `sent 6 chords in 412ms`, `mouse 0.5 0.5 left in 12ms` — the numbers the action rows cannot give, because a request spans many exchanges (send-keys, a multi-click send-mouse) or work that is no exchange at all (a download, a disk create, the boot handshake).

## Replaying a session

`actions WHERE session_id ORDER BY created_at, id` — the identity id is the tiebreaker when timestamps collide, and `created_at` is when the command went out because the row is inserted at start. `sessions.config` holds the effective launch config (defaults applied), so a replay can boot an identical machine. Debugging one is the same order over logs: `logs WHERE session_id ORDER BY created_at, id` is the session narrated with levels and durations, and the two interleave on `created_at` into the full timeline.
