# Automation State Must-Fix Checklist

Work top to bottom, one numbered section at a time. Write and observe each failing test before
changing production code. Check an item only after its tests and implementation are committed.

## Current flow and failure points

```mermaid
flowchart TB
  classDef current fill:#fef3c7,stroke:#d97706,color:#451a03
  classDef durable fill:#dbeafe,stroke:#2563eb,color:#172554
  classDef failure fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef terminal fill:#e5e7eb,stroke:#4b5563,color:#111827

  L1["Linear: Backlog or Automation Needed"]:::current
  L2["Signed webhook<br/>or 90-second board-watch fallback"]:::current
  P1["automation_jobs: pending"]:::durable
  C1["Dispatcher transaction claims row"]:::current
  R1["automation_jobs: running<br/>before any process exists"]:::failure
  B1["Build prompt, ISO, and mint placement"]:::current
  A1["Automation client /reserve"]:::current
  Q1["QEMU proxy /reserve<br/>drive and mint only"]:::current
  S1["Client slot and reservation held in memory"]:::current
  O1["Automation client spawns OpenCode"]:::current
  L3["Driver moves Linear to In Progress"]:::current
  Q2["Driver calls client start --resume"]:::current
  S2["QEMU session starts"]:::current
  T1["ctrl test start:<br/>test_results running"]:::durable
  D1["Driver executes intents and guest actions"]:::current
  T2["ctrl test-results:<br/>test result passed or failed"]:::durable
  L4["Driver moves Linear to Needs Review"]:::current
  O2["OpenCode exits and /run returns"]:::current
  J1["automation_jobs: succeeded or failed<br/>ready label cleared"]:::terminal

  L1 --> L2 --> P1 --> C1 --> R1 --> B1 --> A1
  A1 -->|"drive / mint"| Q1 --> S1
  A1 -->|"diagnose"| S1
  S1 --> O1 --> L3 --> Q2 --> S2 --> T1 --> D1 --> T2 --> L4 --> O2 --> J1

  F1["Webhook invalid, missed, or result absent<br/>No row; fallback retries"]:::failure
  F2["Linear label or move fails<br/>Pending row survives; poll retries"]:::failure
  F3["Server dies after claim commit<br/>Running row has no owner forever"]:::failure
  F4["Prompt, result, ISO, or mint pin fails<br/>Job closes failed"]:::failure
  F5["All clients return 503<br/>Unclaim back to pending"]:::failure
  F6["Client unreachable or non-503 refusal<br/>Job fails; other clients not tried"]:::failure
  F7["QEMU full or setup needed<br/>Unclaim back to pending"]:::failure
  F8["QEMU accepts but route write fails<br/>Reservation can leak until expiry"]:::failure
  F9["Reservation expires or client restarts<br/>/run fails; DB was already running"]:::failure
  F10["Automation server dies<br/>OpenCode may live; DB row stays running"]:::failure
  F11["Driver never moves Linear<br/>DB running, Linear still Automation Needed"]:::failure
  F12["QEMU starts but proxy commit fails<br/>Guest may live while driver sees 500"]:::failure
  F13["QEMU dies<br/>Session/job state is not reconciled"]:::failure
  F14["Driver exits with result open<br/>Automation job fails"]:::failure
  F15["Terminal DB write fails<br/>Job remains running without retry"]:::failure
  F16["Linear completion move fails<br/>Job and result close; board stays stale"]:::failure

  L2 -.-> F1
  L2 -.-> F2
  R1 -.-> F3
  B1 -.-> F4
  A1 -.-> F5
  A1 -.-> F6
  Q1 -.-> F7
  Q1 -.-> F8
  S1 -.-> F9
  O1 -.-> F10
  L3 -.-> F11
  Q2 -.-> F12
  S2 -.-> F13
  O2 -.-> F14
  J1 -.-> F15
  L4 -.-> F16
```

## Planned flow: remove red, add green

```mermaid
flowchart TB
  classDef removed fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
  classDef added fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px
  classDef kept fill:#dbeafe,stroke:#2563eb,color:#172554
  classDef decision fill:#f3e8ff,stroke:#9333ea,color:#581c87

  R1["− Claim immediately means running"]:::removed
  R2["− Unexpected reserve failure fails the ticket"]:::removed
  R3["− Driver is responsible for moving Linear to In Progress"]:::removed
  R4["− Server restart trusts old running rows"]:::removed
  R5["− One terminal DB write with no retry"]:::removed

  N1["+ Singleton dispatcher selects one pending job locally;<br/>database remains pending"]:::added
  N2["+ Try every eligible automation client and QEMU server"]:::added
  N3["+ Full or not minted is expected;<br/>try the next server"]:::added
  N4["+ Any other server failure is reported to Sentry;<br/>then try the next server"]:::added
  N5["+ Nobody can reserve: remain pending,<br/>leave Linear unchanged, and wait"]:::added
  N6["+ Client and optional QEMU reservation secured"]:::added
  N7["+ Retry database pending → running three times"]:::added
  N8["+ Automation server moves Linear to In Progress"]:::added
  N9["+ Tell the reserved client to run"]:::added
  N10["+ Startup cancels and fails inherited running work<br/>before normal dispatch starts"]:::added
  N11["+ Terminal writes retry three times;<br/>then Sentry and manual repair"]:::added

  R1 -. "replace" .-> N1
  R2 -. "replace" .-> N2
  R3 -. "replace" .-> N8
  R4 -. "replace" .-> N10
  R5 -. "replace" .-> N11

  P["automation_jobs: pending<br/>Linear: Automation Needed"]:::kept
  MORE{"More eligible servers?"}:::decision
  RUN["automation_jobs: running<br/>Linear: In Progress"]:::kept
  EXEC["OpenCode executes the test"]:::kept
  DONE["Result, Linear, client execution,<br/>and job close consistently"]:::kept
  FAIL["automation_jobs: failed<br/>Linear: Failed"]:::kept
  DBFAIL["+ Database still fails after three attempts:<br/>cancel reservations, report Sentry, fail"]:::added
  LINEARFAIL["+ Linear move fails after retries:<br/>cancel reservations and fail"]:::added
  RUNFAIL["+ Client cannot start execution:<br/>cancel reservations and fail"]:::added

  P --> N1 --> N2
  N2 -->|"reserved"| N6 --> N7
  N2 -->|"full / not minted"| N3 --> MORE
  N2 -->|"unexpected failure"| N4 --> MORE
  MORE -->|"yes"| N2
  MORE -->|"no"| N5 --> P
  N7 -->|"written"| N8
  N7 -->|"three failures"| DBFAIL --> FAIL
  N8 -->|"moved"| N9
  N8 -->|"retry exhausted"| LINEARFAIL --> FAIL
  N9 -->|"started"| RUN --> EXEC --> N11 --> DONE
  N9 -->|"start failed"| RUNFAIL --> FAIL

  START["Automation server startup"]:::decision
  INHERITED["Find every inherited running job"]:::decision
  CANCEL["+ Cancel client reservation/process<br/>and QEMU work"]:::added
  INHERITEDFAIL["+ Database failed and Linear Failed:<br/>automation server restarted"]:::added
  UNREACHABLE["+ If the automation client does not answer,<br/>report Sentry and fail anyway"]:::added
  NORMAL["+ Normal pending dispatch may start"]:::added

  START --> INHERITED
  INHERITED -->|"none"| NORMAL
  INHERITED -->|"cleanup confirmed"| CANCEL --> INHERITEDFAIL --> NORMAL --> P
  INHERITED -->|"cleanup unreachable"| UNREACHABLE --> INHERITEDFAIL
```

## 1. Reconcile orphaned running jobs after process death

- [x] Add an integration test that SIGKILLs `automation-server` with a drive in progress, restarts
      it, and proves the old `automation_jobs` row does not remain `running`.
- [x] Add an integration test for death while `/reserve` is in flight and the database row is
      still `pending`.
- [x] Add an integration test for death after `/reserve` succeeds but before `/run` starts. The
      automation server dies while the automation client reserves, and the automation client
      still grants it, so it holds a reservation while the row is `pending`. The next automation
      server reserves the same ticket there again, which answers ok without asking QEMU, and the
      drive runs. Death after the `running` write is the `/run` waiting case: startup stops it at
      its automation client and fails it.
- [ ] Add an integration test for death after the database becomes `running` but before Linear
      moves to In Progress.
- [ ] Add an integration test for death after Linear moves to In Progress but before `/run`.
- [x] Add an integration test for death while `/run` is waiting on the automation client.
- [x] Add an unhappy-path test that a failed terminal `finish` database write is retried or later
      reconciled.
- [ ] ~~Track every reservation attempt and perform fiber owned by the current singleton
      automation-server in memory.~~ Dropped: user decision. Every running row at startup is the
      dead process's; nothing needs a registry.
- [x] On startup, treat every existing nonterminal row as inherited work and reconcile it against
      the assigned automation client. A pending row needs nothing: dispatch places it as usual.
- [x] Run startup reconciliation before the dispatch loop may select any pending job.
- [x] Do not assume an inherited row is dead: its OpenCode child may still be active on the
      automation client after the previous server connection disappeared.
- [x] Cancel a confirmed reservation or active execution before moving its database row and Linear
      issue to Failed.
- [x] Treat an absent execution as already stopped, ~~and retain an unreachable execution as
      unresolved for retry~~. Changed: user decision. An automation client that does not answer
      is reported to Sentry and the job is failed anyway; nothing retries it.
- [ ] ~~Keep new dispatch gated while inherited work is unresolved so a restart cannot exceed real
      client or QEMU capacity.~~ Dropped: user decision. An unreachable automation client does not
      block dispatch.
- [ ] ~~Periodically reconcile database-running rows that are absent from the current process's
      ownership registry.~~ Dropped: user decision (Sentry, then manual repair).
- [x] Abort client work before closing inherited work when the automation client still owns that
      ticket.
- [x] Treat a client `404` during inherited-work cleanup as confirmation that no process remains,
      then close the job with an explicit owner-lost reason (`automation server restarted`). The
      `404` is reported to Sentry as `JobNotFound` (user decision: a `404` for a running job is
      always reported).
- [x] Never requeue work whose side effects are uncertain; close it terminally unless the durable
      state proves `/run` never started.
- [x] An inherited drive or mint whose result its driver already closed has finished: close it
      `succeeded`, and send nothing to its automation client or Linear. User decision.
- [x] Prove that one automation client configured for six jobs cannot leave more than six
      client-confirmed `running` rows after reconciliation.

## 2. Make graceful shutdown stop the work it claims to abort

- [x] Replace the test that permits OpenCode to outlive a disconnected automation-server with a
      test for the chosen explicit ownership contract. The contract: a dropped `/run` leaves
      OpenCode running, and `POST /abort` is what stops it.
- [x] Add a test that SIGTERM stops each client child before its job becomes `aborted`.
- [x] Add a test that shutdown waits for every terminal database transition.
- [x] Have `automation-server` call the owning client's `/abort` during graceful shutdown. Every
      client with a job running is asked at once.
- [x] Mark the job `aborted` only after the client confirms the child stopped or confirms it no
      longer exists. A `404` is reported to Sentry as `JobNotFound`, then the job is `aborted`.
- [x] Keep shutdown bounded and record a distinct failure when client cleanup cannot be confirmed.
      Ten seconds for every client together. A stop that fails or gets no answer is reported
      `shutdown abort failed; <url>`, and the row stays `running`, so the next startup stops and
      fails it.

## 3. Make automation-client execution observable and restart-safe

- [ ] Add tests for a client restarting on the same URL with reservations and runs active.
- [ ] Add tests for querying a client's reservations and active ticket processes.
- [ ] Publish configured `max-jobs`, current reservations, and active runs through the heartbeat or
      a status endpoint.
- [x] Make reserving the same ticket and action idempotent so a crash after reservation can safely
      retry while the database row is still pending. The same action, iso and pin again answer ok
      and keep the first deadline. Anything else for that ticket is still 400 `already reserved`.
- [ ] Add one idempotent cancellation operation that releases either an unused reservation or an
      active OpenCode process and its QEMU resources.
- [ ] Ensure a restarted client begins with no inherited claims and reports old tickets absent.

## 4. Reconcile QEMU death with durable sessions

- [ ] Add an integration test that SIGKILLs a QEMU server with active sessions and restarts it.
- [ ] Add a test that graceful QEMU shutdown closes every session before releasing its slots.
- [x] Add a test that a QEMU restart does not make old database sessions appear live.
- [x] On startup, close nonterminal sessions already routed to this singleton QEMU server URL with
      an explicit owner-lost reason. They are `failed`, reason `qemu server restarted`, with their
      agent runs ended, before the server takes a request. A cleanup that cannot write fails the
      startup.
- [x] Ensure the affected driver receives a terminal failure instead of waiting indefinitely. A
      follow of the lost session answers that it completed `failed`, and `ctrl` reads it ended.
- [ ] Reconcile the corresponding automation job after the driver exits or its client owner is
      lost.

## 5. Make every terminal job transition durable

- [x] Add a unit test for a transient database failure in `AutomationStore.finish`.
- [x] Add a test for exhaustion of the terminal-write retry policy.
- [x] Retry terminal writes with a bounded backoff while the worker still owns the job locally.
      Three immediate attempts, like the running write. A retry that finds the row already closed
      with the same status and reason counts as success.
- [ ] ~~Leave the job and client execution information available to the reconciliation pass when
      retries are exhausted.~~ Replaced: user decision. A Sentry line names the job and the status
      it should have; the row stays running for an operator to mark.
- [ ] Use `timed_out` or remove it from the automation-job vocabulary; do not retain a terminal
      status that no code can write.

## 6. Unify abort behavior across API, dashboard, and terminal UI

- [ ] Add a dashboard integration test for automation-client `404` during abort.
- [ ] Add tests for abort when the assigned client row is missing, stale, or unreachable.
- [x] Replace tests that intentionally leave a job `running` after a confirmed client `404`.
- [x] Treat `404` as already stopped and close the durable job. The job is `aborted` and the
      answer is 200. The `404` is reported to Sentry as
      `JobNotFound: Job had "running" status but 404'd.` (user decision).
- [ ] On 5xx or unreachable clients, keep retryable ownership information instead of reporting a
      successful abort.
- [ ] Make a successful dashboard response require that the durable row is terminal.
- [ ] Make the dashboard, `viz`, and direct automation-server callers report the same outcome.
      Done for a client `404`: every caller reads 200 and an `aborted` row. Still open for a 5xx,
      where the dashboard's fallback closes the row and `viz` reports a refusal (item above).
- [x] A finished job cannot be aborted, including one that finishes while its client is being
      asked. `/abort` then answers 400 `has no <action> to abort`, as for any finished job, and
      the row keeps its result. A client `404` in that race is the job ending, not `JobNotFound`.
      A run whose OpenCode the abort's kill reached answers `/run` 409 `run aborted`; one that
      had already exited ends as it did. The worker leaves a 409 row to the abort, so it closes
      `aborted`, never `failed` with OpenCode's exit.

## 7. Separate claimed, driver-running, and guest-running states

- [ ] Add rendering tests for each business state without asserting presentation details.
- [ ] Add query tests that classify an unowned inherited row as stale rather than live.
- [x] Keep the durable job `pending` throughout reservation attempts.
- [x] Change the durable job to `running` only after the automation client and required QEMU
      capacity have both been reserved.
- [ ] Show `pending`, `running`, `guest running`, and inherited failure separately.
- [x] Count dashboard `running` only when reservations were confirmed and the database transition
      succeeded.
- [ ] Show queued depth separately from concurrency so `pending 29` is not presented as a
      six-slot violation.

## 8. Make capacity a verifiable fleet invariant

- [ ] Add a test that the sum of live client jobs never exceeds the sum of their configured
      `max-jobs`.
- [ ] Add a test that database-running jobs equal confirmed client reservations plus active
      runs after reconciliation.
- [ ] Persist or publish each client's configured capacity.
- [ ] Add an operator-visible discrepancy when database claims exceed confirmed client work.
- [ ] Decide whether pending queue depth is intentionally unbounded or capped; document and test
      that policy.
- [ ] If only six tickets should leave Backlog at once, admit against available slots rather than
      `live.length` on every board poll.

## 9. Permit an intentional retry after terminal infrastructure failure

- [ ] Add tests for retrying a failed drive while still forbidding two nonterminal jobs for the
      same result and action.
- [ ] Replace the permanent `(result_id, action)` uniqueness rule with one-nonterminal-job
      enforcement, or add an explicit attempt model.
- [ ] Preserve every terminal attempt for history.
- [ ] Make Linear and dashboard messages name the existing attempt's real terminal status.

## 10. Make placement failures recoverable

- [x] Add a worker test that one unreachable automation client does not fail the job while another
      live client can accept it.
- [ ] Add a proxy test for a QEMU server dying between probe and reserve.
- [x] Add a test that every full automation client and QEMU server leaves the job pending.
- [x] Add a test that every not-minted QEMU server leaves the drive pending while setup proceeds.
- [x] Add a test that an unexpected failure from every server reports each failure to Sentry and
      still leaves the job pending.
- [x] Add a test that expected full and not-minted answers do not report to Sentry.
- [x] Try the remaining eligible automation clients after a transient reserve failure.
- [x] Try the remaining eligible QEMU servers after a selected server fails its reserve request.
- [x] Never terminalize a job or move its Linear issue because placement was unavailable.
- [x] Report every reserve failure other than full or not minted to Sentry with the server URL,
      ticket, and original cause.
- [x] After every eligible server has been tried, leave the job pending and wait for the next
      dispatch pass.
- [x] Preserve the original network cause in `automation-client/qemu.ts`.
- [x] On QEMU routing database failure, report to Sentry, relinquish QEMU, and return
      `500 DATABASE FAILURE`.
- [x] When `pending → running` exhausts three database attempts, report to Sentry, release capacity,
      and fail the job with reason `DATABASE FAILURE`.
- [ ] Require the automation client's QEMU proxy URL at startup instead of silently defaulting to
      an unrelated local port.

## 11. Repair existing inconsistent production rows

- [ ] Add a read-only audit that lists every `running` automation job with its result, session,
      assigned client, client generation, started age, and confirmed client process.
- [ ] Define deterministic classifications for active, completed-but-unclosed, never-started, and
      owner-lost rows.
- [ ] Test the repair against fixtures for every classification.
- [ ] Stop confirmed client processes before changing their rows.
- [ ] Close completed-but-unclosed rows from their recorded result.
- [ ] Close owner-lost and uncertain rows with explicit reasons; do not silently call them passed.
- [ ] Run the repair once after startup and periodic reconciliation are deployed.
- [ ] Confirm that durable running counts, client jobs, and QEMU jobs agree afterward.
