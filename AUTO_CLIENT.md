# The automation client and the dispatch loop

A plan, not code. Two halves:

- **The dispatch loop**, in the existing `./automation-server`: every ten seconds it looks at the
  `automation_jobs` queue, claims one job that is ready, composes its prompt, and runs it on an
  automation client through `POST /run`; when the call comes back it closes the job.
- **The automation client**, a new process `./automation-client`: one per host, it runs one agent
  prompt to completion per `POST /run` and announces itself to the fleet the way a qemu server
  does — a `servers` row rewritten every thirty seconds with host memory, host cpu over the last
  minutes and how many agents it is running — under `type = 'automation'` instead of `'qemu'`.

```
Linear ──webhook──► ./automation-server ──POST /linear──► automation_jobs (pending)
                          │  the loop: every ten seconds, claim one ready job, compose its prompt,
                          │  pick the automation client with the fewest runs, and
                          ▼
                    POST /run   Authorization: Bearer <OLIGARCHY_TOKEN>
                                { "key": "OLI-45", "prompt": "<text>" }
                          │
                    ./automation-client   looks OLI-45 up, runs `opencode run` with the prompt
                          │               (the agent drives ./client and ./ctrl), waits
                          ▼
                    200 { model, session, text, elapsedMs }   → the job is closed succeeded
                    4xx / 5xx { "error": "<reason>" }          → the job is closed failed / timed_out
```

The agent is an `opencode run` child with `muse-spark-1.3-contributor` selected, fed the prompt on
stdin, in a scratch directory of its own. What launches the agent sits behind one seam,
`AgentRunner`, so the OpenCode runner can be swapped for a Cursor SDK / cloud agent runner without
touching the server, the bookkeeping, the heartbeat or the dispatcher.

Everything below follows `development.md`; where the two disagree, that one wins. Sections:
[0 What changed](#0-what-changed-since-the-first-draft) · [1 Tests](#1-tests-first) ·
[2 What exists](#2-what-this-builds-on) · [3 The dispatch loop](#3-the-dispatch-loop) ·
[4 The automation client](#4-the-automation-client) · [5 Wire](#5-the-wire) ·
[6 Runner](#6-the-runner-seam-and-the-opencode-runner) · [7 Runs](#7-the-runs-service) ·
[8 Stats and heartbeat](#8-stats-and-heartbeat) · [9 Schema](#9-schema-and-migrations) ·
[10 Dashboard](#10-dashboard) · [11 Config, CLI, entries](#11-config-cli-and-the-entries) ·
[12 Log](#12-log-lines) · [13 Long connections](#13-long-connections-what-bounds-them-and-what-does-not) ·
[14 DTS](#14-dts-of-the-new-modules) · [15 Delivery](#15-delivery-order) · [16 Spikes](#16-spikes) ·
[17 Decisions](#17-decisions-and-alternatives) · [18 Later](#18-out-of-scope).

## 0. What changed since the first draft

- `key` is the Linear ticket, `OLI-45`. The automation client uses it for one thing: attribution.
  Its lines land under `location = "automation-OLI-45"` with the ticket as `agentId`, the same id
  the driver uses as `./client --agent-id`. There is no `agent` field, and the client looks nothing
  up: the automation server already found the ticket when it composed the job.
- The automation client is a dumb client. It runs `opencode` and answers; its only database use is
  its own heartbeat row and its log rows. It reads no test, result or job row and knows there is a
  queue only in the sense that someone keeps calling it.
- The automation server owns the job's lifecycle: `pending → running` when it claims the row,
  `running → succeeded | failed | timed_out | aborted` from what the call answered (§3.6). It also
  closes a failed drive's still-open `test_results` row `aborted`. The client owns the run, its log
  lines and the Sentry report that carries the cause. Retrying is a new job row, which the unique
  index is relaxed to allow.
- Log locations: the automation server's lines carry `location = "automation-server"` (today's
  `"automation"` bucket, renamed); the automation client's run lines carry `"automation-<key>"`.
- How opencode authenticates to its model provider is not part of this plan. The automation client
  neither reads nor forwards a provider credential; that is solved separately, later.
- The dispatch loop is in the plan, in `./automation-server`: claim, compose, place, run, close.
- `prompts/driving-agent.html` and `prompts/diagnosing-agent.html`, deleted by #102, are restored on
  this branch as they were (§3.4).
- The processes were renamed on master: `qemu-server`, `qemu-reverse-proxy`, `automation-server`.
  Every path below uses those names. The dashboard's servers page is now two halves, the
  automation queue and the qemu fleet (#109); the automation clients get a table in the automation
  half.

## 1. Tests first

No code lands until the tests below exist and fail. Every surface has a happy and an unhappy path.
Fakes sit at the layer seam (`AgentRunner`, `Stats`, the stores, `Linear`, `Log`, `HttpClient`,
`ChildProcessSpawner`, `FileSystem`), never at a module import. Each item is one test file, or one
named case inside one, and is its own todo.

### 1.1 Tests to alter

- [x] `test/repo/architecture.unit.test.ts` — `BOUNDARY_FILES` names `src/host/stats.ts` instead of
      `src/qemu/stats.ts`. Nothing new joins the list: the runner spawns through
      `ChildProcessSpawner` and writes through `FileSystem`.
- [x] `test/qemu/stats.unit.test.ts` → `test/host/stats.unit.test.ts` — `collect` takes no count and
      answers `{ memory, cpu }`; the sampler cases move as they are.
- [x] `test/qemu-server/heartbeat.unit.test.ts` → `test/host/heartbeat.unit.test.ts` — `announce(url,
      type, stats)`; every existing case passes `"qemu"` and a `{ qemus, … }` row. New happy case: an
      `"automation"` announce writes `{ agents, memory, cpu }` under `type: "automation"`. New
      unhappy case: the stats effect failing is one `heartbeat failed:` line and the next tick
      writes.
- [x] `test/qemu-server/sessions.unit.test.ts` — `sessions.stats` composes `qemus` from the map with
      the host sampler's answer: 0 before a start, 1 after, 0 after stop.
- [x] `test/qemu-server/http.unit.test.ts` — `GET /stats` still answers `{ qemus, memory, cpu }`
      exactly as today; the wire the reverse proxy probes is pinned.
- [x] `test/dashboard/servers.unit.test.ts` — the fleet lists qemu rows only; a new `Clients` table
      in the automation half renders an automation client's `agents`, memory, cpu means, generation
      and heartbeat age, `silent` after ninety seconds, and no delete form; the queue tables are as
      they are.
- [x] `test/shared/errors.unit.test.ts` — `RunFailed` decodes from `{ error }` with 502 and
      `RunTimedOut` with 504; `apiStatus` answers both; a decoded `RunFailed` carries no cause and an
      empty `agentId`, as `StartFailed` does.
- [x] `test/shared/api.unit.test.ts` — `AutomationClientApi` has one group, `Runs`, with `POST /run`
      behind `BearerAuth` then `ApiBoundary`; `run` declares `RunBody`, `RunResponse` and exactly the
      two error codecs; `QemuServerApi`, `QemuReverseProxyApi` and `AutomationServerApi` are
      unchanged.
- [x] `test/automation-server/http.unit.test.ts`, `test/integration/automation-server.integration.
      test.ts`, `test/integration/db.integration.test.ts` — every pin of the automation server's log
      bucket moves from `"automation"` to `"automation-server"`: the `location` and `agentId` of its
      lines, and the stdout prefix `[automation-server] automation-server: …`.
- [x] `test/observability/log.unit.test.ts` — `Locations.automationRun("OLI-45")` is
      `"automation-OLI-45"`; a line attributed to it renders with that prefix and lands in a row with
      that `location`.
- [ ] `test/config/config.unit.test.ts` — `AutomationServerConfig` reports `LINEAR_WEBHOOK_SECRET`,
      `OLIGARCHY_TOKEN`, `LINEAR_API_TOKEN`, `DATABASE_URL` in that order, the first missing one
      alone. The automation client reuses `ProxyConfig`, whose test exists.
- [ ] `test/automation-server/command.unit.test.ts` — the command still defaults to 54321 and pings;
      new: the dispatch loop's startup sweep is called once before listen (through the fake store);
      `--help` lists `--port` alone.
- [x] `test/automation-server/http.unit.test.ts` — `POST /linear` is unchanged; `POST /run` here is
      404 (the automation server does not serve runs).
- [ ] `test/ctrl/linear.unit.test.ts` — `issueDescription("OLI-45")` sends one GraphQL query with the
      identifier and decodes the description (happy); a `null` issue is `LinearError` `linear: no
      issue OLI-45`; a null description is `LinearError` `linear: OLI-45 has no description`; a non-2xx
      and a GraphQL `errors` envelope are `LinearError`s with the status and the message (unhappy).
- [ ] `test/ctrl/prompts.unit.test.ts` — `renderDiagnosingAgent({ LINEAR_TICKET, RESULT_ID })` fills the
      restored `prompts/diagnosing-agent.html`, embedding `ctrl-diagnose.md` trimmed (happy); a
      template naming a placeholder with no value fails `PromptError` naming it (unhappy);
      `renderLinearIssue` unchanged.
- [ ] `test/integration/automation-server.integration.test.ts` — the environment sets
      `OLIGARCHY_TOKEN` and `LINEAR_API_TOKEN` (today it deletes the former); new refusals: an empty
      `OLIGARCHY_TOKEN` exits 1 with `OLIGARCHY_TOKEN is not set`, an empty `LINEAR_API_TOKEN` likewise,
      each before listening; with a database, a stale `running` job is `aborted; automation-server
      restarted` after startup, and the process still queues from `/linear` and exits 0 on signals.
- [x] `test/integration/db.integration.test.ts` — against the migrated container: a heartbeat with
      `type = 'automation'` round-trips and `listServers("qemu")` does not list it;
      `listAutomationClients` answers fresh rows with their `agents` and leaves out a row whose
      heartbeat is older than ninety seconds and a row with no stats; `claimNext` claims the oldest
      ready pending job, diagnoses before drives, skips a diagnose whose session has not ended, and two
      concurrent claims never get the same row; `closeJob` closes a running job and answers false
      for one already closed; `abortRunning` closes every running job with the reason and answers the
      count; a second `drive` for a result is refused while one is open and accepted once the first
      is `failed`.
- [x] `test/integration/dashboard.integration.test.ts` — the automation half renders a client row
      beside the queue; the fleet renders qemu rows only.

### 1.2 Tests to add

- [ ] `test/automation-server/dispatcher.unit.test.ts` (fake stores, fake Linear, `FakeHttp.
      recordRequests`, fake Log, `TestClock`) — happy: a pending drive and one fresh client: the first
      tick claims the job (`running`, `startedAt`), fetches the ticket's description from Linear,
      sends `POST /run` to the client's url with the bearer and `{ key: "OLI-45", prompt:
      <description> }`, and when the fake answers 200 closes the job `succeeded`; lines are `job
      started; drive; http://client` and `job succeeded; drive in Tms`, with `location:
      "automation-server"` and the ticket as `agentId`;
      a second job goes to the client with fewer runs in flight as this dispatcher counts them, ties
      to registration order; a diagnose job whose session is open is not claimed and is claimed
      once the session ends, its prompt the rendered diagnosing template with the ticket and result
      id; a diagnose is claimed before an older drive; a tick with no fresh client claims nothing
      and writes `no automation client available; N jobs waiting` once, not every tick, and again
      only after a client came and went; nothing is written while the queue is empty. Unhappy: a
      502 `{ error }` closes the job `failed` with that reason and writes `job failed; drive;
      <reason>` with `skipSentry` (the client reported the cause); a 504 closes it `timed_out`; a 400
      or 401 closes it `failed` with the body's message; an unreachable client closes it `failed; automation client
      http://client unreachable: <reason>` and reports (the client could not); a failed drive whose
      result is still `pending` or `running` also closes the result `aborted` with `automation:
      <reason>`, a diagnose failure touches no result; a Linear failure while composing closes the
      job `failed; linear: <reason>`; a `closeJob` that fails is one error line and the loop goes on;
      a tick that dies is one error line and the next tick runs; a tick in flight is not overlapped;
      interrupting the loop closes every in-flight job `aborted; automation-server shutdown` after
      its request fiber is interrupted; the startup sweep closes stale `running` rows `aborted;
      automation-server restarted` and logs `N jobs aborted; automation-server restarted` (nothing
      when there are none).
- [x] `test/automation-client/events.unit.test.ts` (pure) — happy: a captured `text` line yields the
      session id and its text; a captured `error` line yields `error.data.message`, or `error.name`
      when there is no data; `step_start` resets the text so the final answer is the last step's
      (S2 may revise what "final answer" means; the test follows the captured lines). Unhappy: a
      non-JSON line and a JSON line with an unknown `type` are ignored and counted; a line without
      `sessionID` is ignored. Fixtures are captured lines (S2); a synthetic one is labelled
      synthetic.
- [x] `test/automation-client/opencode.unit.test.ts` (FakeSpawner, fake FileSystem, `Path.layer`, fake
      Log, `ProxyConfig`) — happy: the argv is exactly `run --model <MODEL> --format json`; the
      child's cwd is a fresh directory holding executable `client`, `client-with-image`, `ctrl` and
      `session` shims that `exec` this repo's wrappers, and an `opencode.json`; the env carries
      `OLIGARCHY_TOKEN`, `DATABASE_URL` and `OLIGARCHY_MODEL` and the argv carries none of them; the
      prompt arrives on stdin byte for byte; exit 0 after captured events answers `{ session, text
      }`; the directory is gone once the scope closes. Unhappy: exit 1 with an `error` event is `RunFailed` `opencode: exited 1:
      <message>`; exit 1 without one carries the stderr tail; exit 0 without a session is `RunFailed`
      `opencode: exited 0 without a session`; a spawn `ENOENT` is `RunFailed` `opencode: spawn opencode
      ENOENT` and the rendered error contains no key; a signal death nobody asked for is `RunFailed`
      with the platform's sentence; closing the scope mid-run records `SIGTERM` on the child and
      removes the directory; a stdout line that is not JSON is ignored.
- [x] `test/automation-client/runs.unit.test.ts` (fake runner, fake stats, fake log, `TestClock`) —
      happy: `stats.agents` is 0, 1 while a run is held open, 0 after; two runs held open count 2;
      the runner receives the key and the prompt as sent; the response is `{ model, session, text,
      elapsedMs }` with `elapsedMs` from the clock; the lines are `run started; opencode; N chars`
      then `run finished; M chars in Tms`, with `location: "automation-OLI-45"` and `agentId:
      "OLI-45"`; the ticket's colour is acquired then released; no store is touched (none is
      provided). Unhappy: a `RunFailed` from the runner propagates unchanged, the count is back
      to 0, and `Runs` writes no error line (the boundary's is the one); the clock past `RUN_TIMEOUT`
      is `RunTimedOut` `opencode: no result within 2 hours` and the runner's scope was closed;
      interrupting the run fiber closes the scope and logs `run aborted; client disconnected after
      Tms` when the cause carries `ClientAbort`, `run aborted; interrupted after Tms` otherwise; a
      runner defect propagates as a defect, the count is 0 and the scope closed.
- [x] `test/automation-client/http.unit.test.ts` (in-process `HttpRouter.serve` over fakes,
      `HttpApiClient.make(AutomationClientApi)` and a raw `HttpClient` for refusals) — happy: 200
      with `{ model, session, text, elapsedMs }`. Unhappy: a missing or wrong bearer is 401 `{
      "error": "unauthorized" }`, one error line attributed `automation-client`, `skipSentry`; an
      empty `prompt` or an empty `key` is 400 `{ error }`; a `RunFailed` is 502 `{ error }` and one
      line under `location: "automation-OLI-45"`, `agentId: "OLI-45"`, with the cause reported; a
      `RunTimedOut` is 504, attributed the same way; `/linear`, `/stats`, `/start`, `/servers` and
      `GET /run` are 404 `{ "error": "not found" }` and never logged; a runner defect is 500 `{
      "error": "internal error" }` logged with its cause.
- [x] `test/automation-client/command.unit.test.ts` (mirrors `test/automation-server/command.unit.
      test.ts`) — `--help` lists `--port` and `--url` and touches nothing; `--port forty` is `ShowHelp`;
      `--url not-a-url` is refused by the flag with `url must be an http or https url`; the default is
      port 42071 and `Option.none()` for the url; `--url http://127.0.0.1:1` reaches `serve` as given;
      startup order is host check, ping, listen. Unhappy: `opencode` off the PATH is fatal
      `automation-client: missing host requirements:\nopencode not on PATH`, no ping, no listen; an
      unreachable database is fatal `automation-client: database unreachable: <reason>`; a server
      error after listen and a bind failure are fatal with the error's own message.
- [x] `test/integration/automation-client.integration.test.ts` (black-box: the wrapper spawned, a fake
      `opencode` shell script first on `PATH`, stdout and stderr captured) — refusals: `--help` exits
      0; `--port forty` exits 1; an empty `OLIGARCHY_TOKEN` exits 1 with `OLIGARCHY_TOKEN is not set`;
      an empty `DATABASE_URL` likewise; no `opencode` on `PATH` exits 1 with the fatal line; an
      unreachable database exits 1 and never listens. With a database: an occupied port is
      `EADDRINUSE`; it listens and logs the listening line; `POST /run` without a bearer is 401; with
      the bearer, `key: "OLI-45"` and a fake `opencode` that reads its stdin, sleeps three seconds,
      prints captured JSONL and exits 0, the call returns 200 after the sleep with the body, its
      lines land in `logs` under `location = 'automation-OLI-45'` and print as `[automation-OLI-45]
      OLI-45: run started; …`, and in the meantime the `servers` row has `type = 'automation'` and
      `agents = 1`, then `agents = 0` and a higher generation; the process wrote no other table; a
      fake that exits 1 is 502; `SIGTERM` mid-run leaves no child (the pid is
      gone), exits 0 and deletes the row; `SIGINT` idle exits 0 and the port refuses afterwards;
      stdout and stderr opened on `/dev/full` do not take the process down.
- [x] `test/support/fake-runner.ts` — an `AgentRunner` whose outcomes are scripted per call, with a
      `Deferred` gate to hold a run open, recording every input and whether its scope's finalizer
      ran.
- [x] `test/support/fake-stats.ts` — a `Stats` answering fixed host stats (today's `fakeStats` in
      `fake-qemu.ts`, moved and freed of the count).
- [x] `test/support/stores.ts` — `fakeAutomationStore` gains `claimNext` (readiness and order as the
      real query), `closeJob`, `abortRunning`; `fakeServerStore` gains `listAutomationClients`.
- [ ] `test/support/fake-linear.ts` — gains a scripted `issueDescription`.

## 2. What this builds on

Nothing here is new in kind; each piece has a precedent to copy from.

| This plan | Precedent | Where |
|---|---|---|
| A process with one listener, host check, ping, then listen | the qemu server's command and main | `src/qemu-server/command.ts`, `src/qemu-server/main.ts` |
| A smaller process graph with no QEMU | the automation server | `src/automation-server/main.ts`, `src/automation-server/command.ts` |
| Bearer check and the boundary that logs one line per failed request | `bearerAuth`, `ApiBoundaryLive` | `src/qemu-server/middleware.ts` |
| A row rewritten every thirty seconds, deleted on shutdown | `Heartbeat.announce` | `src/qemu-server/heartbeat.ts` |
| Host memory and a five-minute cpu window | `Stats` | `src/qemu/stats.ts` |
| A long-lived child with a stderr tail, killed by scope close | `Process.spawn` | `src/qemu/process.ts` |
| Owning what is running as a map, the count as its size | `Sessions` | `src/qemu-server/sessions.ts` |
| A guarded periodic sweep that never overlaps itself | the session timeout sweep | `src/qemu-server/sessions.ts` |
| Placing on the server with the fewest of something, ties to registration order | `Router.place` | `src/qemu-reverse-proxy/router.ts` |
| Calling another oligarchy server and turning its answers into refusal / unreachable | `ProxyClient` | `src/client/proxy-client.ts` |
| One GraphQL operation against Linear, two-phase decode | `Linear` | `src/ctrl/linear.ts` |
| A prompt template with `{{NAME}}` placeholders and embedded guides | `Prompts.renderLinearIssue` | `src/ctrl/prompts.ts`, `prompts/linear-issue.html` |
| A pure module that decodes a vendor's line-oriented output | `Qmp.framing`, `Domain.FollowEvent` | `src/qmp/framing.ts`, `src/shared/domain.ts` |
| The queue as three tables, the fleet as one | the servers page | `src/dashboard/servers.tsx`, `src/dashboard/query.ts` |
| A `server_type` value and a row shape per kind | `servers.type` | `src/db/schema.ts`, `drizzle/0008_server_type.sql` |

## 3. The dispatch loop

Lives in `./automation-server`, beside the webhook that fills the queue. `src/automation-server/
dispatcher.ts` exports `loop`, forked in the listener's scope after listen, the way the qemu server
forks its heartbeat; `src/automation-server/clients.ts` is how the dispatcher reaches an automation
client; `src/automation-server/prompts.ts` composes a job's prompt.

### 3.1 The tick

```ts
// Ten seconds: a job waits at most that long past its readiness, and a tick that finds nothing
// costs one indexed query.
const DISPATCH_INTERVAL = "10 seconds";
// The dashboard's rule, applied to placement: three heartbeats overdue is a client that stopped.
const FRESH_WITHIN_MS = 90_000;
```

Every tick, under `Effect.uninterruptible` and `guard.withPermitsIfAvailable(1)` on a
`Semaphore.make(1)` (a stuck tick is skipped by the next, never overlapped; shutdown waits for one
in flight), ending in `Effect.catchCause` to one `dispatch failed: <detail>` error line:

1. **Who can run something.** `servers.listAutomationClients` → the automation rows whose
   `heartbeat_at` is within `FRESH_WITHIN_MS`, in registration order. None → if the queue has a
   ready job, one `no automation client available; N jobs waiting` warning, written once per outage
   (a `Ref<boolean>` cleared when a client is seen again), and the tick ends. The job stays pending;
   nothing is claimed that cannot be placed.
2. **Claim one ready job.** `automation.claimNext` (§3.2) → `Option<AutomationJobRow>`, now
   `running` with `started_at`. None → the tick ends silently.
3. **What the job is about.** `tests.findResult(job.resultId)` → the result row, whose `linearId`
   is the ticket (the `key`). It is non-null for a claimed job by construction — a job is enqueued
   by ticket — so a null is `Effect.die`, not a branch. The diagnosing prompt needs only the ticket
   and the result id; the reviewer finds the session itself (§3.4).
4. **Compose the prompt** (§3.4). A failure here closes the job `failed; <reason>` (§3.6).
5. **Place it.** The fresh client with the fewest runs *this dispatcher* has in flight, ties to
   registration order. Owned state is the truth: the dispatcher is the only thing that starts
   runs, so its own `Ref<ReadonlyMap<url, number>>` is exact, where the row's `agents` is up to
   thirty seconds stale. (`agents` in the row is for the dashboard and for a second dispatcher one
   day.)
6. **Run it**, in a fiber of its own (`Effect.forkIn(run, scope)`), recorded in
   `inFlight: Ref<ReadonlyMap<jobId, { fiber, url, ticket }>>` so shutdown can find it. The tick
   does not wait for it: the call lasts twenty minutes or more, and the next tick is ten seconds
   away. Log `job started; <action>; <url>` attributed to the ticket.
7. The fiber `POST /run`s (§3.5), then **closes the job** (§3.6) in `Effect.onExit`, so a fiber
   interrupted by shutdown still closes its row.

One job per tick, so placement adjusts one run at a time and a burst of webhooks drains at six
starts a minute — fast enough for a queue that is fed by humans moving tickets.

### 3.2 `AutomationStore` grows the queue's other half

```ts
// The oldest ready pending job, claimed in the same statement that finds it: two dispatchers
// (or one racing itself) never run the same job. Ready is pending, and for a diagnose, a result
// whose session has ended: there is nothing to review before that. Diagnoses go first, as the
// dashboard orders them — a review is short and closes a ticket.
readonly claimNext: Effect.Effect<Option.Option<AutomationJobRow>, Errors.DatabaseError>;
// false when the job was not running: already closed, or never claimed.
readonly closeJob: (id: string, status: TerminalStatus, reason: string | null) => Effect.Effect<boolean, Errors.DatabaseError>;
// Every running job to aborted with the reason; the count. Startup's sweep for the rows a dead
// dispatcher left behind.
readonly abortRunning: (reason: string) => Effect.Effect<number, Errors.DatabaseError>;
```

`claimNext` is one `UPDATE … SET status = 'running', started_at = now() WHERE id = (SELECT j.id FROM
automation_jobs j JOIN test_results r ON r.result_id = j.result_id LEFT JOIN sessions s ON s.id =
r.session_id WHERE j.status = 'pending' AND (j.action = 'drive' OR s.ended_at IS NOT NULL) ORDER BY
(j.action = 'diagnose') DESC, j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED) RETURNING *`, in
Drizzle (`.for("update", { of: automationJobs, skipLocked: true })` on the subquery). `closeJob` is
`UPDATE … SET status, reason, finished_at = now() WHERE id = ? AND status = 'running' RETURNING id`.
`TerminalStatus` is the `automation_job_status` values minus `pending` and `running`.

`ServerStore` grows `listAutomationClients: Effect<ReadonlyArray<{ url: string; agents: number }>>`
— automation rows with stats and a heartbeat within ninety seconds, in registration order. Every
one of these methods is the automation server's; the automation client reads none of these tables
(§4).

### 3.3 Startup and shutdown

- **Startup**, after the ping and before listen: `abortRunning("automation-server restarted")`. A
  row left `running` belongs to a dispatcher that died mid-call; nobody else will close it. The
  automation client that was running it has already killed the agent: the connection died with
  the dispatcher, and a disconnect aborts a run (§4.4). One line, `N jobs aborted;
  automation-server restarted`, only when N > 0. A database failure here is fatal, as the ping's
  is: a startup requirement fails at startup. (One dispatcher; a second would need a claim owner
  column before it could share a queue. Not now.)
- **Shutdown**: the loop's fiber is interrupted (`Fiber.interrupt` waits for a tick in flight,
  the tick being uninterruptible), then every fiber in `inFlight` is interrupted, in the loop's
  finalizer. Each interrupted request closes its connection, which makes the automation client
  abort the agent; each fiber's `onExit` closes its job `aborted; automation-server shutdown`. Both
  finalizers are registered before the loop is forked, so they run after it is interrupted.

### 3.4 The prompt

`prompt` is a string the automation client never reads; what it says is the dispatcher's business.

- **`drive`**: the Linear issue's description, fetched by identifier — the ticket is the prompt.
  `ctrl test new` rendered it from `prompts/linear-issue.html` with the mission, the guides, the
  server url and the ISO, and the ticket is where a human tunes it. `Linear` in `src/ctrl/linear.ts`
  gains `issueDescription(identifier)`: one query, `issue(id: $id) { description }` (Linear's
  `issue` is expected to accept the identifier in place of the UUID — S7 confirms it), decoded in
  two phases like the rest; a null issue or a null description is a `LinearError` naming the
  ticket. The automation server therefore reads `LINEAR_API_TOKEN` (§11).
- **`diagnose`**: `prompts/diagnosing-agent.html`. It and `driving-agent.html` were deleted by
  [#102](https://github.com/ThePrimeagen/Oligarchy/pull/102) (`e885aae`, 2026-09-09) together with
  `src/ctrl/cursor.ts` and `ctrl test run` / `ctrl diagnose run`, when the Cursor cloud-agent
  kickoff left `ctrl`; both are restored on this branch exactly as they were the commit before
  (`e885aae^`, the last of that day's hand edits). The dispatcher renders it with
  `Prompts.renderDiagnosingAgent({ LINEAR_TICKET, RESULT_ID })` in `src/ctrl/prompts.ts` (a second
  render function beside `renderLinearIssue`, sharing `read`, `fill` and `GUIDES`, with
  `CTRL_DIAGNOSE_MD: ctrl-diagnose.md` added to `GUIDES`). As restored, the template also names
  `{{TEST_RESULT_ID}}` and `{{MODEL}}`; the dispatcher slice settles those two — `TEST_RESULT_ID`
  and `RESULT_ID` are one value spelled twice, and the model is the runner's, not the dispatcher's
  (next bullet). The reviewer finds the session with `./ctrl session --search`, as the template
  already tells it to.
- Neither template names the model. The automation client puts the runner's model in the child's
  environment as `OLIGARCHY_MODEL` (§6.2), and a later edit of either template can tell the agent
  to pass `--model "$OLIGARCHY_MODEL"` where today's says "the model you are running as".

Alternatives in D13.

### 3.5 `src/automation-server/clients.ts` — reaching an automation client

`run(url, key, prompt)`: `HttpApiClient.make(Api.AutomationClientApi, { baseUrl: url, transformClient:
HttpClient.filterStatusOk })` with the bearer injected once through
`HttpApiMiddleware.layerClient(Api.BearerAuth, …)`, the payload `Contract.RunBody.make({ key, prompt
})`, wrapped in the `run(label, effect)` shape `src/client/proxy-client.ts` uses: a non-2xx is
`ProxyRefusal { status, message }` with the message read from the `{ error }` body, no response is
`ProxyUnreachable { message, cause }`, a schema failure on a 200 the same. No timeout of its own:
the deadline is the client's `RUN_TIMEOUT`, so both ends agree on who gives up (§13). The transport
is `NodeHttpClient.layerNodeHttp`, provided at the automation server's root (new there), for the
reason `development.md` gives: no undici header or body timeout.

### 3.6 Closing the job: who writes what on failure

The **automation server** owns the `automation_jobs` row. It moved it `pending → running`; the
same process moves it to its terminal status, from what the call answered:

| The call | `closeJob` | `reason` | Log line | Sentry |
|---|---|---|---|---|
| 200 | `succeeded` | `null` | `job succeeded; <action> in Tms` | — |
| 502 `RunFailed`, 400, 401, 500 | `failed` | the `{ error }` message | `job failed; <action>; <reason>` | `skipSentry`: the client reported it with the cause |
| 504 `RunTimedOut` | `timed_out` | the message | `job timed out; <action>` | `skipSentry`, same |
| unreachable, or a 200 that is not a `RunResponse` | `failed` | `automation client <url> unreachable: <reason>` | `job failed; <action>; <reason>` | reported with the cause: only the server saw it |
| prompt composition failed | `failed` | `linear: <reason>` / `prompt: <reason>` | `job failed; …` | reported |
| shutdown | `aborted` | `automation-server shutdown` | `job aborted; <action>; automation-server shutdown` | — |

A `closeJob` that fails is one `db: closing job <id> failed: <detail>` error line with the cause;
the row is what the dashboard's queue shows, so the failure to write it is worth the line.

A failed **drive** leaves a `test_results` row that the agent was going to close with `./ctrl
test-results` and now never will. If it is still `pending` or `running`, the dispatcher closes it
`aborted` with `automation: <reason>` (`tests.closeResult`), so no result waits forever for a
verdict that is not coming; a result the agent did close before failing is left as the agent left
it. A failed diagnose touches no result: the verdict simply was not written, and the session's
evidence is intact for the next reviewer.

The **automation client** owns the run: its log lines (under `automation-<key>`) and the one
Sentry report the boundary makes for a 5xx, with the cause — the stderr tail, the error event.
It is a dumb client: it runs `opencode` and answers. Its database use is its heartbeat row and its
log rows, nothing else; it reads no `test_results`, no `test_runs`, no `automation_jobs`, and does
not know there is a queue. Everything the run needs to know is in the prompt the dispatcher
composed.

**A new entry?** Yes, when someone asks for one: retrying is a new job row, not a reopened one, so
the failed row stays as the history the dashboard's `completed` table shows. Today the unique
index `(result_id, action)` refuses a second row; §9 relaxes it to open jobs only, so moving the
ticket back to "Automation Needed" enqueues a fresh drive after a failed one. The dispatcher never
retries on its own: a failed agent run is a human's call, and the failure may be the ticket's.
Alternatives in D12.

## 4. The automation client

### 4.1 Files

```
automation-client                       #!/bin/sh wrapper, --import src/observability/instrument.ts
src/automation-client/main.ts           the graph, createServer, teardown (boundary file by rule)
src/automation-client/command.ts        Command "automation-client" { --port, --url }; startup order
src/automation-client/handlers.ts       HttpApiBuilder.group(AutomationClientApi, "Runs") + routes
src/automation-client/runs.ts           Runs: the map of live runs, the count, the timeout, stats
src/automation-client/runner.ts         AgentRunner: the seam (a plain-value Context.Service)
src/automation-client/opencode.ts       the OpenCode implementation of AgentRunner
src/automation-client/events.ts         pure: `opencode run --format json` line probes and the fold
src/automation-server/dispatcher.ts     the loop of §3
src/automation-server/clients.ts        POST /run on an automation client (§3.5)
src/automation-server/prompts.ts        a job's prompt: the ticket's description, or the diagnosing template
src/host/stats.ts                       moved from src/qemu/stats.ts; collect answers host stats
src/host/heartbeat.ts                   moved from src/qemu-server/heartbeat.ts; announce(url, type, stats)
src/ctrl/linear.ts                      + issueDescription
src/ctrl/prompts.ts                     + renderDiagnosingAgent
prompts/diagnosing-agent.html           restored on this branch (§3.4); its placeholders settled in slice 6
prompts/driving-agent.html              restored on this branch; the kickoff alternative of D13
src/shared/api.ts                       + run, Runs group, AutomationClientApi
src/shared/contract.ts                  + RunBody, RunResponse
src/shared/errors.ts                    + RunFailed (502), RunTimedOut (504), their Wire codecs
src/qemu-server/middleware.ts           + the two tags in isApiError and attribution; comment fix
src/db/schema.ts                        server_type + 'automation'; ServerStats a union; the jobs index relaxed
src/db/automation.ts                    + claimNext, closeJob, abortRunning
src/db/servers.ts                       + listAutomationClients
src/dashboard/query.ts, servers.tsx     the fleet is qemu rows; the automation half gains the clients table
src/config.ts                           AutomationConfig → AutomationServerConfig (the client reuses ProxyConfig)
src/observability/log.ts                Locations.automation → automationServer; + automationClient, automationRun(key)
drizzle/0010_<name>.sql                 generated: the enum value and the index change, together
package.json                            "automation-client" script
automation-client.md                    operator document: flags, variables, the wire, the row
```

`src/host/` is new: what a server measures and says about the machine it runs on, shared by the
qemu server and the automation client. It is a library directory like `src/qemu/` and `src/qmp/`,
not a process. `stats.ts` is the one `node:os` boundary file today and stays the one after the
move, under its new path.

### 4.2 The layer graph

```ts
// src/automation-client/main.ts
const ServerLive = (port: number, url: Option.Option<string>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.acquireColor(Log.AutomationClientAgentId);
      yield* log.info(
        `oligarchy automation client listening on ${HOST}:${String(port)}; model ${OpenCode.MODEL}${announcing(url)}`,
        automationClientAttr,
      );
      const runs = yield* Runs.Runs;
      const row = Effect.map(runs.stats, (stats) => ({
        agents: stats.agents,
        ...Heartbeat.hostRow(stats),
      }));
      yield* Option.match(url, {
        onNone: () => Effect.void,
        onSome: (announced) => Heartbeat.announce(announced, "automation", row),
      });
    }),
  ).pipe(
    Layer.provide(HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true })),
    Layer.provide(Runs.Runs.layer),
    Layer.provide(Layer.mergeAll(OpenCode.layer, Stats.Stats.layer)),
    // A run cannot finish inside a grace window, so the twenty-second preemptive wait buys
    // nothing: on shutdown the in-flight requests are interrupted at once (§4.4).
    Layer.provide(
      NodeHttpServer.layer(() => server, { host: HOST, port, disablePreemptiveShutdown: true }),
    ),
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry beneath Log so the rows flush before Sentry does and Log captures the reporter; the
// process attribution is this process's own bucket.
// Two stores and no more: the servers row it announces itself in, and the logs rows Log writes.
const MainLive = Layer.mergeAll(Servers.ServerStore.layer, Log.Log.layer).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(
    Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution),
  ),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeServices.layer),
);
```

One reference per service. `Runs` depends on `AgentRunner`, `Stats` and `Log`;
`OpenCode.layer` on `ChildProcessSpawner`, `FileSystem`, `Path` (from `NodeServices`),
`ProxyConfig` and `Log`; the handlers on `Runs`, `BearerAuthLive` (`ProxyConfig`, unchanged) and
`ApiBoundaryLive` (`Log`, `ProcessAttribution`). The
heartbeat starts after the listener is up, in the listener's scope, as on the qemu server: a port
refusal announces nothing, and the row is deleted when the listener goes.

`program` and `teardown` are the automation server's verbatim: the graph is built with
`Layer.build` before the command runs so a missing variable prints `<NAME> is not set` through
`Render.reportFailure`; SIGINT and SIGTERM interrupt and exit 0; any other failure exits 1.

### 4.3 The life of `POST /run`

1. `BearerAuth` compares the bearer with `OLIGARCHY_TOKEN`; a miss is 401, logged once by the
   boundary, `skipSentry`.
2. HttpApi decodes `RunBody`: `key` and `prompt` non-empty. A refusal is the boundary's 400.
3. The handler yields `Runs` and calls `runs.run(payload)`. The handler is interruptible (D5).
4. `Runs.run` mints a run id, acquires the key's colour, logs `run started; opencode; N chars` under
   `{ location: Locations.automationRun(key), agentId: key }`, makes a `Scope`, puts `{ id, key,
   startedAt, scope }` in the map, and calls `runner.run({ key, prompt })` under
   `Scope.provide(scope)` inside `Effect.timeoutOrElse({ duration: RUN_TIMEOUT, orElse: RunTimedOut
   })`. Nothing is looked up: the key is attribution, and the prompt is everything the agent needs.
5. `OpenCode.run` (§6): makes the scratch directory in that scope, writes the shims and
   `opencode.json`, spawns `opencode run --model <MODEL> --format json` with the prompt on stdin
   and the variables in its environment, drains stdout into the fold and stderr into a tail,
   awaits the exit, and answers `{ session, text }` or `RunFailed`.
6. `Runs.run`'s `onExit` (uninterruptible bookkeeping, whichever way it ended): removes the run from
   the map, closes the scope — which kills a child still alive (SIGTERM, SIGKILL after five
   seconds, the directory removed last) — releases the colour, and logs the verdict: `run finished;
   M chars in Tms`, or `run aborted; …` on an interrupt. A failure writes no line of its own here:
   the boundary writes `POST /run failed: <message>` once, under the same location.
7. The handler answers `RunResponse` (200), or the boundary answers 502 / 504 / 500 with
   `{ error }`.

### 4.4 Disconnects and shutdown

The platform interrupts a request's fiber when the client closes the response early
(`NodeHttpServer.makeHandler`, annotated `ClientAbort`), and interrupts every request fiber when
the listener's scope closes on shutdown. The handler for `run` is interruptible, so both reach
step 6 as an interrupt: the child is killed, the directory removed, the count decremented, and one
line written — `run aborted; client disconnected after Tms` when the interrupt carries the
`ClientAbort` annotation (`reason.annotations.has(HttpServerError.ClientAbort.key)`, as
`HttpServerError` itself reads it), `run aborted; interrupted after Tms` otherwise (shutdown). The
caller of an aborted run sees its connection close; it has nothing else to see. This is also what
makes the dispatcher's restart sweep (§3.3) safe: the runs of a dead dispatcher are already dead.

Why interruptible, unlike the qemu server's driving routes (D5): a run's only deliverable is its
response, so a caller that is gone has nothing to deliver to, and an uninterruptible twenty-minute
handler would hold shutdown for twenty minutes (`server.close` waits for in-flight requests, and
the fork scope's interrupt waits for the uninterruptible region). With `disablePreemptiveShutdown`
the listener does not wait its twenty seconds either: shutdown is stop accepting, interrupt the
runs, kill the children, flush the log, flush Sentry, close the pool — a handful of seconds.

## 5. The wire

### 5.1 `src/shared/api.ts`

```ts
// The automation client: one route, behind the same bearer and boundary as the qemu server's.
export const run = HttpApiEndpoint.post("run", "/run", {
  payload: Contract.RunBody,
  success: Contract.RunResponse,
  error: [Errors.RunFailedWire, Errors.RunTimedOutWire],
});

export class Runs extends HttpApiGroup.make("Runs")
  .add(run)
  .middleware(BearerAuth)
  .middleware(ApiBoundary) {}

export class AutomationClientApi extends HttpApi.make("OligarchyAutomationClient").add(Runs) {}
```

The catch-all `NotFoundRoute` from `src/qemu-server/handlers.ts` is merged beside it, as the
automation server does, so `/linear`, `/stats` and `/start` are 404 here and never logged.

### 5.2 `src/shared/contract.ts`

```ts
// POST /run: the ticket the run is for — the key every row about it carries and the agent id
// the driver uses — and the prompt, a string the client hands to the agent unread.
export class RunBody extends Schema.Class<RunBody>("@oligarchy/shared/contract/RunBody")({
  key: Schema.NonEmptyString,
  prompt: Schema.NonEmptyString,
}) {}

// What a finished run says: the model it ran as, the runner's own id for the conversation (an
// opencode `ses_…`; a Cursor agent id later), the agent's final text (empty when it wrote none,
// never null), and how long it took.
export class RunResponse extends Schema.Class<RunResponse>(
  "@oligarchy/shared/contract/RunResponse",
)({
  model: Schema.String,
  session: Schema.String,
  text: Schema.String,
  elapsedMs: Schema.Int,
}) {}
```

### 5.3 `src/shared/errors.ts`

```ts
// The agent did not finish: opencode could not be spawned, exited non-zero, exited without a
// session, or died from a signal nobody here sent. The message is `opencode: <what>`.
export class RunFailed extends Schema.TaggedError<RunFailed>("@oligarchy/shared/errors/RunFailed")(
  "RunFailed",
  { message: Schema.String, agentId: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
  { httpApiStatus: 502 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

// The agent was still going at RUN_TIMEOUT; it was killed.
export class RunTimedOut extends Schema.TaggedError<RunTimedOut>(
  "@oligarchy/shared/errors/RunTimedOut",
)("RunTimedOut", { message: Schema.String, agentId: Schema.String }, { httpApiStatus: 504 }) {
  override readonly [ErrorReporter.ignore] = true;
}
```

Wire codecs as the others: `RunFailedWire` and `RunTimedOutWire` decode to `{ _tag, message,
agentId: "" }`. Both join `ApiError` and `apiErrorClasses` (the `satisfies Record<ApiError["_tag"],
…>` refuses a missing arm), the `isApiError` union in `src/qemu-server/middleware.ts`, and its
`attribution` switch: each carries `agentId` (the key), and its bucket is the run's, so the arm is
`{ location: Log.Locations.automationRun(error.agentId), agentId: error.agentId }` — the boundary's
`POST /run failed: …` line lands beside the run's own lines. `report` already sends a 5xx's cause to
Sentry. The comment in `middleware.ts` saying "The automation server does not use this bearer"
gains "; the automation client does".

### 5.4 The statuses, read from the dispatcher's side

| Status | Means | The job becomes |
|---|---|---|
| 200 | the agent finished; `{ model, session, text, elapsedMs }` | `succeeded` |
| 400 | the body was refused (an empty key or prompt); `{ error }` | `failed` |
| 401 | the bearer is wrong; `{ "error": "unauthorized" }` | `failed` |
| 502 | the agent failed; `{ "error": "opencode: exited 1: …" }` | `failed` |
| 504 | the agent ran past two hours and was killed; `{ error }` | `timed_out` |
| 500 | the automation client itself failed (a database error, a defect); `{ "error": "internal error" }`, the cause in Sentry | `failed` |

A failed run is 502, not 500, for one reason that matters to the dispatcher: a 500's wire body is
the fixed `internal error` everywhere in this system, its detail going to Sentry alone, and the
job row needs the run's reason on the wire — `opencode: exited 1: <the stderr tail>` is what the
dashboard's `reason` column shows. 500 stays what it means everywhere else: this process broke,
not the agent. To the dispatcher every status but 200 and 504 is `failed` with the body's message,
so the split costs the caller nothing.

## 6. The runner seam and the OpenCode runner

### 6.1 `src/automation-client/runner.ts` — the seam

The one interface bought before its second implementation, because the request asks for it:
what launches an agent and waits for it must be swappable (OpenCode today; the Cursor SDK and cloud
agents next) without the server, the bookkeeping, the heartbeat or the dispatcher noticing.

```ts
// The key is for attribution — the run's directory name and its log bucket; the prompt is
// everything the agent is told. The runner reads nothing else from anywhere.
export type RunInput = {
  readonly key: string;
  readonly prompt: string;
};

export type RunOutcome = {
  readonly session: string;
  readonly text: string;
};

// A plain-value service: `name` is the word the log lines and the error messages use for this
// runner ("opencode"), `model` is what every run of it records; `run` resolves when the agent is
// done and fails RunFailed when it is not going to be. Whatever the runner starts lives in the
// caller's Scope, so closing it (a timeout, an interrupt) ends the agent; the runner itself has no
// timeout.
export type Shape = {
  readonly name: string;
  readonly model: string;
  /** @effect-expect-leaking Scope */
  readonly run: (input: RunInput) => Effect.Effect<RunOutcome, Errors.RunFailed, Scope.Scope>;
};

export class AgentRunner extends Context.Service<AgentRunner, Shape>()(
  "@oligarchy/automation-client/AgentRunner",
) {}
```

A runner is built with `Layer.succeed(AgentRunner)(AgentRunner.of({ name, model, run }))` or, when
it captures services, `Layer.effect(AgentRunner)(Effect.gen(...))`. Only `Runs` yields it. A test
substitutes `test/support/fake-runner.ts`.

### 6.2 `src/automation-client/opencode.ts` — the OpenCode runner

Facts about `opencode run`, from its source (`packages/opencode/src/cli/cmd/run.ts`) and docs, each
to be re-checked on the host in S1–S3:

- `opencode run [message..] --model provider/model --format json` is the non-interactive mode. With
  stdin not a TTY it reads all of stdin and appends it to the positional message, so the prompt goes
  on stdin alone and the argv carries no prompt.
- `--format json` writes one JSON object per line to stdout, each with `type`, `timestamp`,
  `sessionID`, and per type `part` (`text`, `step_start`, `step_finish`, `tool_use`) or `error`.
- It exits when the session goes idle: exit code 0, or 1 when a `session.error` event was seen or
  the prompt was refused. Permission requests are auto-rejected unless `--auto`; `question`,
  `plan_enter` and `plan_exit` are denied outright.
- The OpenCode Zen provider is `opencode`. How the host's opencode is authenticated to it is not
  this plan's; the runner passes nothing for it and the child inherits whatever the host has.

```ts
export const BIN = "opencode";
// Pinned by S1 against `opencode models` on the host: the contributor tier of Muse Spark 1.3.
export const MODEL = "opencode/muse-spark-1.3-contributor-free";
// The wrappers a prompt may run — the driver's client and ctrl, the reviewer's ctrl and session
// image; the shims exec this repo's copies by absolute path.
const SHIMS = ["client", "client-with-image", "ctrl", "session"] as const;
const STDERR_TAIL_BYTES = 4096;
// Releasing the scope waits for the exit; an opencode that ignores SIGTERM must not wedge a
// timeout or a shutdown behind it.
const FORCE_KILL_AFTER = "5 seconds";
```

`run(input)`, top to bottom:

1. `dir = yield* fs.makeTempDirectoryScoped({ prefix: "oligarchy-run-" })` — registered first, so the
   directory goes last, after the child is dead. Each run works in a directory of its own: two
   agents writing `screen.png` in one directory would overwrite each other, and the prompt forbids
   reading this repository, which an empty cwd enforces rather than asks.
2. For each of `SHIMS`, `fs.writeFileString(path.join(dir, name), `#!/bin/sh\nexec "${REPO}/${name}"
   "$@"\n`, { mode: 0o700 })` where `REPO = path.resolve(import.meta.dirname, "../..")` (as
   `src/session/children.ts` resolves the entries). A symlink would not do: the wrappers use
   `$(dirname "$0")`, which for a symlink is the link's directory.
3. `fs.writeFileString(path.join(dir, "opencode.json"), OPENCODE_JSON, { mode: 0o600 })` — the
   per-run config: the `permission` block that allows `bash` for `./client*`, `./client-with-image*`,
   `./ctrl*`, `./session*` and `sleep*` and denies every other bash pattern, denies `edit`, `write`
   and `webfetch`, allows `read` (the screenshots and serial dumps the client writes). S3 settles
   the exact keys; the intent is that a denied action is a rejected permission the model sees and
   moves past, never a hung prompt, and that `--auto` is never passed.
4. Spawn:

   ```ts
   ChildProcess.make(BIN, ["run", "--model", MODEL, "--format", "json"], {
     cwd: dir,
     // What ./client and ./ctrl read inside the agent, unwrapped here and nowhere else. Nothing
     // secret is on argv; the prompt is on stdin. opencode's own provider auth is the host's,
     // inherited through extendEnv, and none of this plan's.
     env: {
       OLIGARCHY_TOKEN: Redacted.value(config.token),
       DATABASE_URL: Redacted.value(config.databaseUrl),
       OLIGARCHY_MODEL: MODEL,
     },
     extendEnv: true,
     stdin: Stream.make(encoder.encode(input.prompt)),
     stdout: "pipe",
     stderr: "pipe",
     detached: false,
     killSignal: "SIGTERM",
     forceKillAfter: FORCE_KILL_AFTER,
   })
   ```

   `CommandInput` accepts a `Stream<Uint8Array>` (verified in
   `node_modules/effect/src/unstable/process/ChildProcess.ts`); the stream ending closes the pipe,
   which is what makes opencode's stdin read return. A spawn failure (`ENOENT`) is
   `RunFailed { message: "opencode: spawn opencode ENOENT" }` with the platform error as cause; the
   message comes through `ExternalFailure.describeThrowable(ExternalFailure.causeOf(error),
   Render.errorDetail(error))`, as `Process.detail` builds it.
5. Two `forkScoped` drains: stdout through `Stream.decodeText()` and `Stream.splitLines` into a
   `Ref<Events.State>` by `Events.fold`; stderr into a `Ref<string>` kept to its last
   `STDERR_TAIL_BYTES`, as `Process.spawn` keeps QEMU's. Exit is `handle.exitCode`, its
   `PlatformError` (a signal death) mapped to `null`; both drains are joined before the tail or the
   fold is read, so the failure carries everything the child wrote.
6. The verdict:
   - exit 0 and a session seen → `{ session, text }` (`text` may be `""`);
   - exit 0 and no session → `RunFailed("opencode: exited 0 without a session")`;
   - exit `n ≠ 0` → `RunFailed(`opencode: exited ${n}: ${error event message | stderr tail |
     "no output"}`)`;
   - signal death → `RunFailed("opencode: <the platform's sentence>")`. When the death is ours
     (timeout, interrupt) the caller is already past caring; this arm is for the OOM killer.

   Every `RunFailed` carries `agentId: input.ticket`.

`OpenCode.layer: Layer.Layer<AgentRunner, never, ChildProcessSpawner | FileSystem | Path |
Config.ProxyConfig | Log.Log>` captures its dependencies once in the layer effect. No
Sentry span in this cut (§18).

### 6.3 `src/automation-client/events.ts` — the fold

Pure, no Effect: probes for the lines that matter and a fold over them. Unknown `type`s and
non-JSON lines are ignored and counted.

```ts
const Line = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    sessionID: Schema.String,
    part: Schema.Struct({ text: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal("step_start"), sessionID: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("error"),
    sessionID: Schema.String,
    error: Schema.Struct({
      name: Schema.String,
      data: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
    }),
  }),
  // Anything else on the stream: only its session id is kept.
  Schema.Struct({ type: Schema.String, sessionID: Schema.String }),
]).annotate({ identifier: "@oligarchy/automation-client/events/Line" });

export type State = {
  readonly session: Option.Option<string>;
  readonly text: string;            // the text parts since the last step_start, joined
  readonly error: Option.Option<string>;
  readonly ignored: number;
};

export const empty: State;
export const fold: (state: State, line: string) => State;   // Schema.decodeUnknownOption(fromJsonString(Line))
```

Whether a `text` event is a completed part or a delta, and whether the final answer is the last
part or the last step's parts joined, is what S2 captures; the fold is written to the captured
lines, and the test fixtures are those lines.

### 6.4 A Cursor runner, sketched

`src/automation-client/cursor.ts` would implement the same `Shape` over `@cursor/sdk` (the package
`ctrl` dropped in #102): `Agent.launch` with the prompt and a `ModelSelection`, then poll the agent
until it is finished, then read its last message as `text`; `session` is the agent id; `model` is
the selection's label as `modelLabel` spelled it. How it authenticates is, like opencode's, a
question for later. Nothing outside `cursor.ts` and `main.ts` (which picks the layer) changes. Not
in this plan.

## 7. The Runs service

`src/automation-client/runs.ts` owns what is running. The count is the size of the map, never a scan
of the system.

```ts
// Two hours: far above any run still doing work (a driven session times out after ten idle
// minutes on the qemu server; a run is one session plus its review) and well short of forever,
// which is what a wedged agent otherwise costs the slot it holds.
const RUN_TIMEOUT = "2 hours";

type LiveRun = {
  readonly id: string;
  readonly key: string;
  readonly startedAt: number;
  readonly scope: Scope.Closeable;
};

export type AutomationStats = {
  readonly agents: number;
  readonly memory: Contract.Memory;
  readonly cpu: Contract.Cpu;
};

export type RunsService = {
  readonly run: (
    body: Contract.RunBody,
  ) => Effect.Effect<Contract.RunResponse, Errors.RunFailed | Errors.RunTimedOut>;
  readonly stats: Effect.Effect<AutomationStats>;
};
```

`run` is `Effect.fn("Runs.run")`, in the order of §4.3 steps 4 to 6. Points worth stating:

- `Runs` yields no store. The key is not checked against anything: the dispatcher composed the job
  from a row it had already found, and a stray caller with a made-up key gets an agent run and a
  log bucket named after its typo, which is the caller's problem and nobody else's.
- Every line of a run is written under `{ location: Locations.automationRun(key), agentId: key }`
  — `automation-OLI-45` — so `./ctrl` or the dashboard can read one ticket's run back as a bucket.
- The bookkeeping in `onExit` is uninterruptible by nature of `Effect.onExit`; it never fails: a
  `Scope.close` that fails is one `run cleanup failed: <detail>` error line with the cause.
- The timeout is `RunTimedOut.make({ message: `${runner.name}: no result within ${RUN_TIMEOUT}`,
  agentId: key })` — `opencode: no result within 2 hours`. The runner's `name`, not its model, is
  the word in that message and in the `run started; opencode; …` line: the model is what the caller
  records, the runner is what an operator reading the log is looking at.
- `stats` is `Effect.flatMap(Ref.get(runs), (map) => Effect.map(stats.collect, (host) => ({ agents:
  map.size, ...host })))`.
- No capacity refusal (D4). No per-key uniqueness check either: two runs for one ticket are the
  dispatcher's decision, and the queue's index already makes it one open job per result and
  action.

## 8. Stats and heartbeat

### 8.1 `src/host/stats.ts`

`src/qemu/stats.ts` moves here unchanged but for its answer: `collect` takes no count and returns
`HostStats = { memory: Contract.Memory; cpu: Contract.Cpu }`. The qemu server composes
`Contract.Stats.make({ qemus: map.size, ...host })` in `Sessions.stats`; the automation client
composes `{ agents: map.size, ...host }`. `Stats.make(source)` stays the seam a unit test drives
with a scripted `Source`; `Stats.layer` reads `osSource`. `SAMPLE_INTERVAL_MS`, `MAX_SAMPLES`, the
means and percentiles are as they are: "cpu over time" is the five-minute window's mean and
percentiles and its newest one, two and three minutes, which the row keeps as `mean1m`, `mean2m`,
`mean3m`.

### 8.2 `src/host/heartbeat.ts`

`src/qemu-server/heartbeat.ts` moves here and takes what it used to fetch:

```ts
export const announce = (
  url: string,
  type: Servers.ServerType,
  stats: Effect.Effect<DbSchema.ServerStats>,
): Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log>;

// The row's half of the host stats: what the fleet page shows.
export const hostRow = (host: Stats.HostStats): DbSchema.HostRowStats;
```

The tick, the thirty seconds, the `heartbeat failed:` and `unannounce failed:` lines, the
uninterruptible write and the delete-on-close are unchanged. The qemu server calls
`Heartbeat.announce(url, "qemu", Effect.map(sessions.stats, (s) => ({ qemus: s.qemus,
...Heartbeat.hostRow(s) })))`; the automation client calls it with `"automation"` and
`Effect.map(runs.stats, (s) => ({ agents: s.agents, ...Heartbeat.hostRow(s) }))`. Two callers is
what earns the generalisation (D7).

## 9. Schema and migrations

```ts
// What kind of machine a server boots, and so which reverse proxy fronts it or which dispatcher
// places on it. qemu servers boot machines; automation servers run agents.
export const serverType = pgEnum("server_type", ["qemu", "automation"]);

export type HostRowStats = {
  readonly memory: { readonly totalBytes: number; readonly usedBytes: number };
  readonly cpu: { readonly mean1m: number; readonly mean2m: number; readonly mean3m: number };
};
// The count a server's kind reports: machines running, or agents running. The key is the kind's
// word, so a row reads as its server would say it.
export type QemuServerStats = HostRowStats & { readonly qemus: number };
export type AutomationServerStats = HostRowStats & { readonly agents: number };
export type ServerStats = QemuServerStats | AutomationServerStats;
```

`automation_jobs`: the unique index `automation_jobs_result_action_idx` on `(result_id, action)`
becomes a partial unique index over open jobs — `.where(sql`${table.status} in ('pending',
'running')`)` — so one drive and one diagnose can be *open* per result while a failed one stays as
history and a new one can be enqueued after it. The table comment changes with it: "one open drive
and one open diagnose per result". The webhook's duplicate handling (`isDuplicateJob`) keeps
working: a second enqueue while one is open is still the index's `DatabaseError`.

`npm run db:generate` writes one `drizzle/0010_<name>.sql` carrying `ALTER TYPE
"public"."server_type" ADD VALUE 'automation';`, the drop of the old index and the create of the
partial one, and appends to `_journal.json`; nothing under `drizzle/` is edited by hand.
`listServers("qemu")` in the reverse proxy is unaffected: automation rows are another type.

## 10. Dashboard

The servers page is already two halves (#109). Changes, all in `src/dashboard/`:

- `query.ts`: `listServers` takes the type and the fleet reads `"qemu"`; a new
  `listAutomationClients` reads the `automation` rows with the same columns; both keep the
  `CURRENT_TIMESTAMP` the heartbeat's age is read against.
- `servers.tsx`: the automation half gains `<h3>clients</h3>` under the queue's three tables, a
  `Clients` table with `url`, `agents`, `memory`, `cpu 1m / 2m / 3m`, `generation`, `heartbeat` —
  the fleet's row with `agents` for `qemus` and no delete form, since a client announces itself and
  leaves by itself; `silent` and `never heard from` as the fleet says them. The `Fleet` is unchanged
  and lists qemu rows only. The queue's tables need nothing: the dispatcher's `reason` texts land
  in the column they already have.
- `dashboard.tsx`: `/servers` and `/servers/queue` read the clients too; `Halves` gains `clients`.

## 11. Config, CLI and the entries

### 11.1 The automation client

- Variables, in this order: `OLIGARCHY_TOKEN`, `DATABASE_URL` — exactly `Config.ProxyConfig`, which
  the qemu reverse proxy already reuses; the automation client reuses it too (D8). Nothing for
  opencode's own provider: that is not this plan's.
- Wrapper: `./automation-client`, `#!/bin/sh exec node --experimental-strip-types --import
  "$(dirname "$0")/src/observability/instrument.ts" "$(dirname "$0")/src/automation-client/main.ts"
  "$@"`. Script: `"automation-client": "node --experimental-strip-types --import
  ./src/observability/instrument.ts src/automation-client/main.ts"`.
- Command `automation-client`:
  - `--port <n>` — `Flag.integer`, default `42071` (42069 qemu server, 42070 qemu reverse proxy,
    54321 automation server; exact, never probed).
  - `--url <url>` — `Flag.string` with `Flag.withSchema(Domain.ServerUrl)`, optional, the qemu
    server's wording: the address the fleet reaches this process at, which it cannot see itself;
    without it the process announces nothing, a development instance stays off the dashboard, and
    no dispatcher places on it.
  - Handler order: `missingHostRequirements` — `opencode` on the PATH through
    `Process.commandExists`, refusing `HostRequirementsMissing { missing: ["opencode not on PATH"] }`
    — then `database.ping` (`database unreachable: <reason>`), then `Effect.raceFirst(Layer.launch(
    serve(port, url)), Deferred.await(serverFailed))`. Every failure is one `fatal` line
    `automation-client: <detail>` and exit 1 after the flush.
  - Description: "The oligarchy automation client: POST /run drives one agent prompt to completion
    on this host and announces itself to the fleet as an automation server".
- `main.ts` creates the server as `createServer({ keepAlive: true, keepAliveInitialDelay: 30_000
  })` (S5): TCP keepalive on accepted sockets, so a dispatcher idle for twenty minutes behind a NAT
  or a tunnel that forgets the connection is found out by the probes rather than by the final
  write. The `error` listener completes `serverFailed` once, as on the other servers; stdout and
  stderr get their no-op `error` listeners.

### 11.2 The automation server

- Variables, in this order: `LINEAR_WEBHOOK_SECRET`, `OLIGARCHY_TOKEN`, `LINEAR_API_TOKEN`,
  `DATABASE_URL` — the unused `Config.AutomationConfig` becomes `AutomationServerConfig {
  linearWebhookSecret, token, linearApiToken, databaseUrl }`, and `main.ts` and the handlers'
  `LinearWebhookSecret` read from it. The bearer goes on every `/run`; the Linear token fetches
  the drive prompts.
- The graph gains `Automation.AutomationStore` (already there), `Servers.ServerStore`,
  `Linear.Linear.layer(token)` and `NodeHttpClient.layerNodeHttp`; `ServerLive` forks
  `Dispatcher.loop` after the listening line, the way the qemu server forks its heartbeat.
- The command's startup order becomes ping, sweep (`abortRunning`), listen. `--port` alone.

## 12. Log lines

`logs.location` is a text bucket; these are the buckets after this change:

| Bucket | Whose lines | `agentId` |
|---|---|---|
| `automation-server` | every line of `./automation-server`: the webhook's, the dispatcher's, its fatal lines | the ticket for a line about one job or webhook; `automation-server` otherwise |
| `automation-<key>` (`automation-OLI-45`) | every line of `./automation-client` about one run: `run started`, the verdict, the boundary's `POST /run failed` | the key |
| `automation-client` | the client's process-wide lines: listening, heartbeat failures, fatal | `automation-client` |

`automation-server` is today's `automation` bucket renamed: `Locations.automation` becomes
`Locations.automationServer = "automation-server"` and `AutomationAgentId` and
`AutomationProcessAttribution` follow it; every pin in the automation server's tests, the
`development.md` Log paragraph and the `logs.location` comments in `schema.ts`, `logs.ts` and
`log.ts` move with it. The generated `0010` migration may carry one `UPDATE "logs" SET "location" =
'automation-server' WHERE "location" = 'automation'`, as `0009` carried its `CASE`, so the old rows
join the new bucket rather than keep a name nothing writes any more. New in `log.ts`:
`Locations.automationClient`, `Locations.automationRun = (key) => `automation-${key}``,
`AutomationClientAgentId`, `AutomationClientProcessAttribution`. A run's bucket is named after the
ticket so one ticket's automation-client lines read back as one bucket, the way one session's do.

| Process | Level | Line | When |
|---|---|---|---|
| server | info | `N jobs aborted; automation-server restarted` | startup, when N > 0 |
| server | warning | `no automation client available; N jobs waiting` | once per outage |
| server | info | `job started; drive; http://client:42071` | a job is placed |
| server | info | `job succeeded; drive in 734211ms` | 200 |
| server | error | `job failed; drive; opencode: exited 1: <tail>` | a refusal (`skipSentry`) |
| server | error | `job failed; drive; automation client http://… unreachable: <reason>` | reported |
| server | error | `job timed out; drive` | 504 (`skipSentry`) |
| server | info | `job aborted; drive; automation-server shutdown` | shutdown |
| server | error | `db: closing job <id> failed: <detail>` / `dispatch failed: <detail>` | the row or the tick failed |
| client | info | `oligarchy automation client listening on 127.0.0.1:42071; model opencode/…[; announcing <url>]` | after listen |
| client | info | `run started; opencode; 12345 chars` | a run begins |
| client | info | `run finished; 812 chars in 734211ms` | exit 0 |
| client | info | `run aborted; client disconnected after 120034ms` | the dispatcher went away |
| client | info | `run aborted; interrupted after 120034ms` | shutdown |
| client | error | `run cleanup failed: <detail>` | `Scope.close` failed (cause reported) |
| client | error | `POST /run failed: opencode: exited 1: <reason>` | the boundary, 502 (cause reported) |
| client | error | `POST /run failed: opencode: no result within 2 hours` | the boundary, 504 |
| client | error | `POST /run failed: unauthorized` | the boundary, 401, `skipSentry` |
| client | error | `heartbeat failed: <reason>` / `unannounce failed: <reason>` | as on the qemu server |
| client | fatal | `automation-client: missing host requirements:\nopencode not on PATH` | startup |
| client | fatal | `automation-client: database unreachable: <reason>` | startup |
| client | fatal | `automation-client: listen EADDRINUSE: …` / `automation-client: <accept error>` | listen / after |

On stdout the prefix is `[<location>] <agentId>:`, so a run's lines read `[automation-OLI-45] OLI-45:
run started; …` and the dispatcher's `[automation-server] OLI-45: job started; …`; the client's
stdout carries the key's colour between `run started` and the verdict. One failure,
one Sentry event: the client reports a 5xx with its cause through the boundary; the dispatcher's
line for a refusal it received is `skipSentry`, and it reports only what the client could not —
an unreachable client, a prompt it could not compose, a row it could not write.

## 13. Long connections: what bounds them and what does not

A `POST /run` is one request whose response comes twenty minutes or more later. Each hop must be
accounted for; this is what bounds a response and what does not.

- Node's `http.Server`: `requestTimeout` (300 s) and `headersTimeout` (60 s) bound receiving the
  request, which is over in milliseconds; `server.timeout` is 0. Nothing in the server cuts a
  twenty-minute response. `keepAliveTimeout` (5 s) is between requests on an idle socket, not during
  one.
- Effect's `NodeHttpServer`: no request deadline; the handler runs until it answers or is
  interrupted (§4.4).
- The dispatcher: `NodeHttpClient.layerNodeHttp`, the transport every process here provides at its
  root, has no undici header or body timeout — the reason `development.md` already gives for
  choosing it. `clients.run` carries no `Effect.timeoutOrElse` of its own: the deadline is the
  client's `RUN_TIMEOUT`, so both ends agree on who gives up.
- The path between: a plain socket, an SSH forward or a WireGuard peer carry a two-hour response. A
  Cloudflare-proxied hostname does not (a 100-second origin response limit, 524), and that is how
  the qemu servers are reached today ("a tunnel's local port"). An automation client's `--url` must
  be an address the dispatcher reaches without that limit. If the path cannot be chosen, the
  alternative is a streamed response (D6).
- TCP keepalive (§11.1) keeps middleboxes from forgetting an idle connection and detects a dead
  peer in minutes rather than at the final write — on both sides, since a dead dispatcher is how a
  run learns to stop.

The integration test proves the shape with a three-second fake, and documents the boundaries
above rather than waiting five minutes for them; a soak against the 300-second mark can be run by
hand with the fake's sleep raised.

## 14. DTS of the new modules

Bare declarations, no imports; a type from a dependency is opaque and says what it is.

```ts
// src/automation-client/runner.ts
type Scope = unknown;           // effect Scope.Scope
type Effect<A, E, R> = unknown; // effect Effect.Effect
type RunFailed = unknown;       // Errors.RunFailed

export type RunInput = { readonly key: string; readonly prompt: string };
export type RunOutcome = { readonly session: string; readonly text: string };
export type Shape = {
  readonly name: string;
  readonly model: string;
  readonly run: (input: RunInput) => Effect<RunOutcome, RunFailed, Scope>;
};
export declare class AgentRunner /* Context.Service<AgentRunner, Shape> */ {}

// src/automation-client/opencode.ts
export declare const BIN: "opencode";
export declare const MODEL: string;
export declare const layer: unknown; // Layer<AgentRunner, never, ChildProcessSpawner | FileSystem | Path | ProxyConfig | Log>

// src/automation-client/events.ts
type Option<A> = unknown;       // effect Option.Option
export type State = {
  readonly session: Option<string>;
  readonly text: string;
  readonly error: Option<string>;
  readonly ignored: number;
};
export declare const empty: State;
export declare const fold: (state: State, line: string) => State;

// src/automation-client/runs.ts
type RunBody = unknown;         // Contract.RunBody
type RunResponse = unknown;     // Contract.RunResponse
type Memory = unknown;          // Contract.Memory
type Cpu = unknown;             // Contract.Cpu
type RunTimedOut = unknown;     // Errors.RunTimedOut
export type AutomationStats = { readonly agents: number; readonly memory: Memory; readonly cpu: Cpu };
export type RunsService = {
  readonly run: (body: RunBody) => Effect<RunResponse, RunFailed | RunTimedOut, never>;
  readonly stats: Effect<AutomationStats, never, never>;
};
export declare class Runs /* Context.Service<Runs>()("@oligarchy/automation-client/Runs", { make }) */ {
  static readonly layer: unknown; // Layer<Runs, never, AgentRunner | Stats | Log>
}

// src/observability/log.ts (additions and the rename)
export declare const Locations: {
  readonly automationServer: "automation-server"; // was `automation`
  readonly automationClient: "automation-client";
  readonly automationRun: (key: string) => string; // `automation-${key}`
  readonly server: "server";
};

// src/automation-client/command.ts
type Layer<A, E, R> = unknown;  // effect Layer.Layer
type Deferred<A, E> = unknown;  // effect Deferred.Deferred
type ServeError = unknown;      // HttpServerError.ServeError
type Command = unknown;         // effect/unstable/cli Command
export type AutomationClientServer<RHost, RServe> = {
  readonly missingHostRequirements: Effect<ReadonlyArray<string>, never, RHost>;
  readonly serve: (port: number, url: Option<string>) => Layer<never, ServeError, RServe>;
  readonly serverFailed: Deferred<never, ServeError>;
};
export declare const makeAutomationClientCommand: <RHost, RServe>(
  server: AutomationClientServer<RHost, RServe>,
) => Command;

// src/automation-server/dispatcher.ts
type DatabaseError = unknown;   // Errors.DatabaseError
export declare const DISPATCH_INTERVAL: "10 seconds";
export declare const FRESH_WITHIN_MS: 90_000;
// Forked in the listener's scope; interrupting it closes every job it has in flight.
export declare const loop: Effect<void, never, Scope /* | AutomationStore | TestStore | ServerStore | Linear | Log | HttpClient | AutomationServerConfig */>;
// Startup: every running job to aborted; the count. A failure is the command's fatal line.
export declare const sweep: (reason: string) => Effect<number, DatabaseError, unknown /* AutomationStore | Log */>;

// src/automation-server/clients.ts
type ProxyRefusal = unknown;    // Errors.ProxyRefusal { status, message }
type ProxyUnreachable = unknown; // Errors.ProxyUnreachable { message, cause }
export declare const run: (
  url: string,
  key: string,
  prompt: string,
) => Effect<RunResponse, ProxyRefusal | ProxyUnreachable, unknown /* HttpClient | AutomationServerConfig */>;

// src/automation-server/prompts.ts
type AutomationJobRow = unknown; // DbSchema.automationJobs.$inferSelect
type LinearError = unknown;      // Errors.LinearError
type PromptError = unknown;      // Errors.PromptError
export declare const compose: (
  job: AutomationJobRow,
  ticket: string,
  resultId: string,
) => Effect<string, LinearError | PromptError, unknown /* Linear | FileSystem */>;

// src/db/automation.ts (additions)
export type TerminalStatus = "succeeded" | "failed" | "aborted" | "timed_out";
export declare const claimNext: Effect<Option<AutomationJobRow>, DatabaseError, never>;
export declare const closeJob: (id: string, status: TerminalStatus, reason: string | null) => Effect<boolean, DatabaseError, never>;
export declare const abortRunning: (reason: string) => Effect<number, DatabaseError, never>;

// src/db/servers.ts (addition)
export declare const listAutomationClients: Effect<ReadonlyArray<{ readonly url: string; readonly agents: number }>, DatabaseError, never>;

// src/host/stats.ts
export declare const SAMPLE_INTERVAL_MS: 5000;
export declare const MAX_SAMPLES: 60;
export type CpuTimes = { readonly cores: number; readonly idleMs: number; readonly totalMs: number };
export type HostMemory = { readonly totalBytes: number; readonly freeBytes: number };
export type Source = {
  readonly cpuTimes: () => CpuTimes;
  readonly cores: () => number;
  readonly memory: () => HostMemory;
};
export declare const osSource: Source;
export type HostStats = { readonly memory: Memory; readonly cpu: Cpu };
export type StatsService = { readonly collect: Effect<HostStats, never, never> };
export declare class Stats /* Context.Service<Stats>()("@oligarchy/host/Stats", { make }) */ {
  static readonly layer: unknown; // Layer<Stats, never, Log>
}

// src/host/heartbeat.ts
type ServerType = "qemu" | "automation";
type ServerStats = unknown;     // DbSchema.ServerStats
type HostRowStats = unknown;    // DbSchema.HostRowStats
export declare const announce: (
  url: string,
  type: ServerType,
  stats: Effect<ServerStats, never, never>,
) => Effect<void, never, Scope /* | ServerStore | Log */>;
export declare const hostRow: (host: HostStats) => HostRowStats;
```

Identifiers: `@oligarchy/automation-client/AgentRunner`, `@oligarchy/automation-client/Runs`,
`@oligarchy/automation-client/events/Line`, `@oligarchy/host/Stats`,
`@oligarchy/config/AutomationServerConfig`,
`@oligarchy/shared/contract/RunBody`, `@oligarchy/shared/contract/RunResponse`,
`@oligarchy/shared/errors/RunFailed`, `@oligarchy/shared/errors/RunTimedOut`.

## 15. Delivery order

Each slice is a pull request: its tests first and failing, then the code, then `npm run check:fast`
and the integration lane it touches, then the Sol review of `development.md` §Review. A slice never
breaks the qemu server or the reverse proxy.

1. **`src/host/`** — move `stats.ts` and `heartbeat.ts`, generalise `collect` and `announce`, adapt
   `Sessions.stats` and `src/qemu-server/main.ts`, move the tests and `fakeStats`, update
   `BOUNDARY_FILES`. Lane: `qemu-server.integration.test.ts`.
2. **Schema, stores and dashboard** — `server_type` gains `automation`, `ServerStats` becomes the
   union, the jobs index is relaxed, one generated migration; `claimNext`, `closeJob`,
   `abortRunning`, `listAutomationClients` and their fakes; the fleet filter and the
   clients table. Lanes: `db.integration.test.ts`, `dashboard.integration.test.ts`. CI's
   `schema-in-sync` job confirms the migration matches.
3. **The wire and the log buckets** — `RunBody`, `RunResponse`, `RunFailed`, `RunTimedOut`, their
   codecs, `run`, `Runs`, `AutomationClientApi`; the middleware's two new arms; the `automation` →
   `automation-server` rename with `automationClient` and `automationRun`, and every pin of the old
   name. Unit lane, plus `automation-server.integration.test.ts` for the renamed stdout prefix.
4. **The runner** — `events.ts`, `runner.ts`, `opencode.ts`, `fake-runner.ts`; the captured fixtures
   from S2 checked in as test constants. Unit lane only; S1–S3 done before this slice starts.
5. **The automation client** — `runs.ts`, `handlers.ts`, `command.ts`, `main.ts`, the wrapper and
   script, the log locations; `automation-client.md`; the
   `development.md` Layout and Log paragraphs name the new process. Lane:
   `automation-client.integration.test.ts`.
6. **The dispatch loop** — `Linear.issueDescription`, `Prompts.renderDiagnosingAgent` over the
   restored template (its `TEST_RESULT_ID` / `MODEL` placeholders settled), `AutomationServerConfig`, `clients.ts`, `prompts.ts`, `dispatcher.ts`, the
   startup sweep, the automation server's graph. Lane: `automation-server.integration.test.ts`
   (with a stub automation client answering `/run`, as `stub-proxy.ts` stubs a qemu server).

## 16. Spikes

Facts to establish before slice 4 (S1–S3, S5, S6) and slice 6 (S7); each is a short session at a
shell, its findings written into the constants and fixtures, not into this document.

- S1 — `opencode --version`; `opencode models | grep -i muse` → pin `MODEL`. With the host's opencode
  set up as it is today, `echo "say ok" | opencode run --model <MODEL> --format json` answers from a
  scratch directory. How that setup is provisioned is not this plan's.
- S2 — Capture full stdout of a real run (a `text`, a `step_start`, a `step_finish`, a `tool_use`)
  and of a failing one (a bad key → an `error` line and exit 1). Confirm `text` is a completed part
  and how the final answer is spelled across steps. These lines are the fixtures.
- S3 — Permissions: with no `--auto`, which tools does `opencode run` permit by default, and does a
  denied `bash` call surface to the model as a rejection or hang? Write the per-run `opencode.json`
  `permission` block that allows exactly `./client*`, `./client-with-image*`, `./ctrl*`,
  `./session*`, `sleep*` and `read`, and prove a `curl` and an `edit` are refused. Confirm `read`
  on a PNG works for the model.
- S4 — The Postgres the container and production run: `ALTER TYPE … ADD VALUE` and the index swap
  under drizzle's migrator transaction apply (PG 12+ allows the enum change inside a transaction;
  the value is usable after commit, which is before any heartbeat).
- S5 — Node 26: `http.createServer({ keepAlive: true, keepAliveInitialDelay: 30_000 })` is accepted;
  `NodeHttpServer.layer(…, { disablePreemptiveShutdown: true })` reaches `make` (it does in rc.112's
  source: `layerServer(evaluate, options)`); a `curl` killed mid-run interrupts the handler and the
  child dies within `FORCE_KILL_AFTER`.
- S6 — Two `opencode run`s at once under one `HOME` share the data directory without contention.
- S7 — Linear: does `query { issue(id: "OLI-45") { id identifier description } }` with the team's
  token answer by identifier, and does a made-up identifier answer `null` rather than a GraphQL
  error? If the identifier is not accepted as `id`, the query becomes `issues(filter: { team: {
  key: { eq: "OLI" } }, number: { eq: 45 } })`. The captured answers are the fixtures for
  `test/ctrl/linear.unit.test.ts`.

## 17. Decisions and alternatives

- D1 — **The client is a separate process; the loop lives in the automation server.** The webhook
  receiver and the dispatcher share a queue, a database and a host; they are one process. The run
  host is many machines with `opencode` on the PATH, a bearer and a fleet row each; it is another
  process. Folding `/run` into the automation server would put a bearer on a service that
  deliberately has none for `/linear` and a fleet row on a process there is one of.
- D2 — **`key` is the ticket, and the client does nothing with it but attribute.** It is what every
  row about the work carries (`test_results.linear_id`), what the driver uses as `--agent-id`, and
  what the webhook that queued the job was keyed by. The dispatcher found the row before it composed
  the job; the client names its run's log bucket after the key and looks nothing up. Alternative,
  dropped: the client checking the key against `test_results` and answering 404 — a lookup with no
  consumer but the refusal, a store the client has no other use for, and a typo the dispatcher
  cannot make.
- D3 — **`RUN_TIMEOUT = "2 hours"`**, with the reason in its comment. Alternative: no ceiling; a
  wedged agent then holds its slot and its `agents` count forever, and its job stays `running`.
- D4 — **No capacity cap on the client.** The dispatcher places on the client with the fewest runs in
  flight and starts at most one run per tick; the client refuses nothing on count. Alternative: a
  `MAX_AGENTS` constant and a 503 `Busy`; deferred until a flood is a real event, and then it is one
  constant, one error class and one test.
- D5 — **A disconnect aborts the run** (interruptible handler). Alternative: `uninterruptible`, as
  the qemu server's driving routes are, so a dropped connection lets the agent finish its ticket
  work. Rejected because the response is the run's only deliverable, because it makes shutdown wait
  for the longest run (§4.4), and because it is what lets a restarted dispatcher sweep `running`
  rows knowing their agents are dead (§3.3).
- D6 — **One JSON answer at the end**, as asked. Alternative: `HttpApiSchema.StreamUint8Array` of
  NDJSON, echoing the runner's events with a final verdict line, which survives a 100-second
  intermediary and lets a caller watch. Held in reserve for when the path cannot be chosen (§13).
- D7 — **Generalise `stats` and `heartbeat` into `src/host/`** rather than copy them into the new
  process. Two callers is the point at which the abstraction is paid for; the copy would be forty
  lines that drift.
- D8 — **The automation client reuses `ProxyConfig`; the automation server gets its own class.** The
  client reads exactly the reverse proxy's two variables in the same order, so a second class would
  be the same two lines under another name. The server reads four, in an order its tests pin, so
  `AutomationServerConfig` is its own.
- D9 — **No model credential in this plan.** The automation client neither reads nor forwards one
  and the wire carries none; opencode authenticates however the host has it set up. Solved
  separately, later.
- D10 — **A scratch directory with shims per run**, not the repository root. Concurrent agents would
  otherwise share `screen.png`, and the prompt's "do not read this repository" would be a request
  instead of a fact. The shims are two lines each because the wrappers resolve `$(dirname "$0")`.
- D11 — **`agents` and `qemus` as separate row keys**, not one `running` key. A row reads as its
  server would say it, and existing rows and tests keep their `qemus`.
- D12 — **The dispatcher owns the job's lifecycle; the client is dumb; a retry is a new row; the
  dispatcher never retries.** The process that moved a row to `running` is the one that moves it
  out: the client does not know the row exists, a client that dies cannot close it, and only the
  dispatcher sees an unreachable client. The client's whole job is to run `opencode` and answer;
  its database use is its heartbeat and its log rows. A failed row is history, so the retry is a
  fresh row, which the relaxed index allows and the webhook enqueues when a human moves the ticket
  again. Alternatives: the client closes the row (it would need the job id on the wire and a store
  it has no other use for); one row with an `attempts` column (loses the history the completed
  table shows); automatic retries with backoff (a bad ticket would burn runs until someone
  noticed).
- D13 — **The drive prompt is the Linear issue's description; the diagnose prompt is a template.**
  The issue is where the mission was rendered and where a human edits it; re-rendering it from the
  rows cannot reproduce it (the version is not stored), and storing the rendered text on the result
  is a schema change for a copy. Alternatives: a short kickoff prompt naming the ticket, as
  `driving-agent.html` (restored on this branch) does — "review Linear ticket OLI-45, use Linear MCP"
  — which makes Linear MCP inside the agent a hard requirement for the run to do anything (today
  it is only what the ticket's status moves need, §18); or the rendered text stored at `test new`.
  If the kickoff prompt is preferred, `driving-agent.html` is rendered by a
  `Prompts.renderDrivingAgent({ LINEAR_TICKET })` beside the other two and no Linear call is made.
- D14 — **A failed drive closes a still-open result `aborted`.** A result nobody will ever close is
  worse than one closed without a verdict; a result the agent did close is left alone; a diagnose
  failure touches nothing. Alternative: leave it to a human, who would find it `running` a week
  later.
- D15 — **One log bucket per process, and one per run.** `automation-server` for the automation
  server (renamed from `automation`, so the bucket says which process wrote it now that there are
  two automation processes), `automation-<key>` for a run on the automation client, `automation-
  client` for the client's process-wide lines. A run's bucket carries the ticket so one ticket's
  lines read back as one bucket, as one session's do by its UUID. Alternative: one `automation-
  client` bucket with the ticket only in `agentId`; readable, but a bucket is what `./ctrl session
  --logs` and the dashboard fetch by.

## 18. Out of scope

- **Linear inside the agent.** The ticket prompt asks the agent to move the ticket through Linear
  MCP; the per-run `opencode.json` is where an `mcp` block with `LINEAR_API_TOKEN` goes. Until
  then the moves do not happen and the run's other work does.
- **A Linear comment on failure**, from the dispatcher, with the job's reason.
- **A second dispatcher.** `claimNext` already will not double-claim; the startup sweep would need a
  claim owner column first.
- **A Cursor runner** (§6.4).
- **A Sentry root span per run** (`automation.run`, named by the ticket, ended with the exit), as
  the qemu server's `qemu.session`.
- **A streamed `/run`** (D6).
- **Tokens and cost** from `step_finish` in the `run finished` line, once S2 shows them.
