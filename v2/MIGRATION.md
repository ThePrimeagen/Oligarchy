# Moving to V2

V1 is the repository root (`apps/`, `packages/`, `src/`). V2 is `v2/`. This is every task left
before V2 can replace V1, roughly in the order they unblock each other. Tick a box when its PR
merges.

Every task follows `v2/AGENTS.md`: the failing tests come first, one test for each error a unit can
meet plus one happy path, and every service is faked except the database.

## Decided

- **Jobs live in the `tests` store.** A test suite holds test runs, one per definition, and a test
  run holds its jobs: mint, drive and diagnose. A job runs once; trying again is a new job.
- **No Linear.** V2 files no tickets and reads no board. The pending jobs in Postgres are the queue,
  and an agent is known by its job id.
- **HTTP servers are Hono.** Each app's `main` builds its own Hono app; there is no shared API
  package. Calls out go through `@oligarchy/http`.
- **No sessions.** What V1 kept on a session (actions, images, logs, routing, debug logs,
  diagnoses) is keyed by job or by test run.

## 1. Services to write

- [x] **Debug logs store** (`v2/packages/stores/src/debug-logs.ts`). V1:
      `packages/db/src/debug-logs.ts`. `saveDebugLog(jobId, { serial, qemu })` gathers the job's
      actions and log lines, keeps the last megabyte of each source, and writes one `debug_logs`
      row; `getDebugLog(jobId)` reads it. Logs are keyed by test run, so a job takes its run's
      lines from when it was queued until the run's next job was queued, or until now for the
      newest.
- [x] **OpenRouter client** (`v2/packages/openrouter`). V1: `src/harness/openrouter.ts`. The
      driver's model call: `complete(request)` asks once through `Http.fetch` and reads the whole
      answer, with no stream. Through `Async.repeat`, it asks again after a 429 or 5xx, waiting the
      Retry-After it names or else the default, and after no answer within its timeout or a
      provider failure naming one of those statuses, waiting the default; never more than its
      attempts in all. It fails with `OpenRouterRefused`, `OpenRouterUnreachable` (which also
      names attempts run out), `OpenRouterOutOfTime` (a wait to ask again that would reach the
      request's deadline) or `Aborted`.
- [ ] **Proxy client.** V1: `packages/http/src/proxy-client.ts`. The calls the driver, `./client`
      and the automation client make to the qemu reverse proxy: reserve, relinquish, start, image,
      serial, send-keys, the mouse calls, intent start and end, stop, save and follow. On
      `@oligarchy/http`. `start` needs a long timeout of its own (45 minutes in V1) because a first
      ISO download blocks it. `follow` streams the guest's output in V1, and `@oligarchy/http`
      reads whole bodies: decide whether `follow` needs streaming added to it.
- [ ] **Automation client client.** V1: `apps/automation-server/src/client.ts`. The automation
      server's reserve, run and abort calls to an automation client, with `OLIGARCHY_TOKEN` as the
      bearer.

## 2. Finish the services V2 has

- [ ] **`tests`: write the model at start.** `test_runs.model` exists, but `startRun` writes only
      the status. V1's `startResult` wrote the Cursor model id.
- [ ] **`tests`: a claim or close retried after a lost reply.** V1's `markRunning` counted the same
      server already running the job as success, and its `finish` counted a row already closed the
      same way as success. V2's `runJob` and close transitions refuse both with `InvalidState`.
      Decide which retries count as success, and test each.
- [ ] **`tests`: the dashboard's queue.** V1's `listJobs` returned the running, pending and newest
      completed jobs, each with its automation client url, qemu server url, instruction, open
      intent and the database's clock. V2's `listJobs` returns the job and its test's name.
- [ ] **Error the jobs a restarted qemu server left.** V1's `SessionStore.failRoutedSessions`
      errored every session still downloading or running on a qemu server that came back. V2 needs
      the same over jobs, found through `job_servers`.
- [ ] **Where a job's guest state lives.** V1's sessions said whether a guest was downloading its
      ISO or running, and when it started and ended; the dashboard and `ctrl` show it. V2 dropped
      sessions without a replacement. Decide where it goes, then add it to the schema and the
      `tests` store. [#298](https://github.com/ThePrimeagen/Oligarchy/pull/298) proposed a
      `vm_status` on each job.
- [ ] **Wire Sentry.** `@oligarchy/sentry` exists, but no app creates it and env declares no DSN
      (V1 hard-codes one in `packages/observability/src/dsn.ts`). Each app's `createServices`
      builds it and `wait`s for it on exit, and the logger sends error and fatal lines to it, as
      V1's `Log` did unless told `skipSentry`.
- [ ] **Colour on stdout.** V1's `packages/env/src/colors.ts` honours `FORCE_COLOR` and asks the
      stream for its colour depth; V2's tester reads `isTTY` alone. Move V1's rule into
      `@oligarchy/env`.
- [ ] **Session flags in env.** `v2/packages/env/src/args.ts` still carries V1's session flags:
      `--session-id` (and `SESSION_ID`), `--search`, `--test-result-id`, and `ctrl session`'s
      `--status`, `--logs`, `--test-def`, `--test-results`, `--test-run`, `--actions`, `--images`,
      `--debug-logs`, `--diagnosis` and `--all`. Rename or drop them as `ctrl` is ported.

## 3. The flow that replaces the Linear board

In V1 the board drove everything: `ctrl` filed tickets, a webhook and a thirty-second board watch
queued jobs from the tickets' columns, and each close moved a ticket on. That logic is in
`packages/jobs` and `apps/automation-server/src/worker.ts`. In V2 the `tests` store is the whole
record, and the automation server acts on it directly.

- [ ] **File.** `ctrl test run`, `ctrl test run testsuite` and the dashboard's create-suite:
      `createTestSuite`, then one `createTestRun` per definition (a suite leaves out `mint`) with a
      drive job each, then `startSuite`. `ctrl mint`, and the proxy's first reserve of an ISO on a
      qemu server: a mint test run and job for each server, holding that server's setup lock with
      `setupRequests.claim`.
- [ ] **Dispatch.** The automation server's loop: `nextPendingJob`, a reserve on a live automation
      client, round robin (a mint only on the server its setup lock names), `runJob` naming that
      client, then `/run` with the prompt. One reserve is in flight at a time, and a full client
      passes the job to the next. V1: `dispatch` in `worker.ts`.
- [ ] **The mission.** V1's driving and diagnosing prompts name only the agent's Linear ticket; the
      mission was the ticket's body, and V1's driver looks it up with `findResultByLinearId`. In V2
      the agent is its job id: the driver loads its mission with `tests.getJobDetails(jobId)`, and
      `prompts/driving-agent.html` and `prompts/diagnosing-agent.html` take the job id where they
      take `{{LINEAR_TICKET}}`. `prompts/linear-issue.html` and `prompts/mint-issue.html` were
      ticket bodies and go.
- [ ] **Close a drive or mint.** `completeJob` when the driver ran to its end, then queue a diagnose
      job on the same test run; `errorJob` with the reason when the system failed it.
- [ ] **Diagnose.** The diagnosing agent writes its verdict against the drive's job with
      `ctrl diagnose` (`diagnosis.saveDiagnosis`). Then the drive is `finalizeJob`ed, its run
      `completeRun`s passed or failed, and the suite `completeSuite`s once its last run has closed.
- [ ] **Abort.** By job id or by suite id, from `ctrl`, the dashboard and the automation server's
      `/abort`. A pending job is `abortJob`ed; a running one is stopped at its automation client
      first.
- [ ] **Restart and shutdown.** At startup, each job the last automation server left running is
      stopped at its client and errored, except a drive or mint whose driver had already finished,
      which is closed as it would have been. At shutdown, each running job is stopped at its client
      and aborted. V1: `packages/jobs/src/reclaim.ts`, and `stopInherited` and `stopAtShutdown` in
      `worker.ts`.
- [ ] **Try again.** An operator's retry, from `ctrl` or the dashboard, is a new job on the same test
      run.

## 4. Apps

None of V1's apps are ported. Each becomes a V2 app: its `main` reads its environment with
`@oligarchy/env`, builds its services with a `createServices`, serves Hono behind the
`OLIGARCHY_TOKEN` bearer, and runs under `@oligarchy/app`.

- [ ] **qemu-server** (`apps/qemu-server`). Services: `Qemu` (starts a guest; keys, mouse,
      screendump, powerdown), `Iso` (downloads and caches ISOs in the data dir), `Minted` (finds and
      saves minted disks), `QmpListen` (the QMP socket) and `Sessions` (slots against `--max-jobs`,
      each guest's life, stats). Serves `/reserve`, `/relinquish`, `/start`, `/stop`, `/save`,
      `/image`, `/serial`, `/follow`, `/stats`, `/minted`, `/send-keys`, `/mouse/*`,
      `/intent/start` and `/intent/end`. Announces itself with `fleet.announce`. Saves a failed
      guest's debug log with `debugLogs.saveDebugLog`; V1 has the store but nothing calls it.
- [ ] **qemu-reverse-proxy** (`apps/qemu-reverse-proxy`). Services: `Router` (registers and lists
      qemu servers, reserves and starts a job's guest on one, and forwards each later call to it by
      `servers.serverForJob`) and `Setup` (the mint lock watcher on `setup_requests`). Serves
      `/servers`, `/minted` (asking every qemu server) and the qemu-server calls except `/stats`.
      Forgets silent servers with `fleet.forget`.
- [ ] **automation-server** (`apps/automation-server`). Section 3's dispatch, close, abort, restart
      and shutdown, and `/abort`. `/linear`, the board watch (`backlog.ts`) and the webhook
      signature (`signature.ts`) go.
- [ ] **automation-client** (`apps/automation-client`). `Sessions` (reserve, run, abort and shutdown
      against `--max-jobs`); spawns `./driver` for a drive or mint and opencode for a diagnose
      (`opencode.ts`); announces itself. Serves `/reserve`, `/run` and `/abort`.
- [ ] **driver and harness** (`src/driver`, `src/harness`). The model loop: history, tools, the
      pointer, intents, and the stop rule (result closed, step limit, model stopped, run ceiling).
      Needs the proxy client. It creates the OpenRouter client with `timeouts.header` from
      `oligarchy.json` as its timeout (`timeouts.chunk` means nothing without a stream, but V1
      still reads it) and a number of attempts, and hands `complete` the run's ceiling as the
      deadline;
      `OpenRouterOutOfTime` is that ceiling reached. Its tests need a fake of the OpenRouter
      client, which `@oligarchy/openrouter` does not have yet.
- [ ] **client** (`src/client`). `./client`, the agent's commands against the proxy. Needs the proxy
      client.
- [ ] **ctrl** (`apps/ctrl`). `test` (define, details, list, run, testsuite, start),
      `test-results`, `mint`, `session` (becomes a job's view: status, logs, definition, run,
      actions, images, debug log, diagnosis), `error-type` (new, list), `diagnose` and
      `automation`.
- [ ] **dashboard** (`apps/dashboard`). Already Hono. Its queries (`query.ts`) move onto the V2
      stores, the pages keyed by ticket (`/tickets/:ticket`) key by job id, and `@oligarchy/linear`
      and `@oligarchy/jobs` go. It runs on Cloudflare Workers with a `pg` client per request, while
      V2's `db.open` makes a pool, so the database service needs a way to run there. It carries
      `packages/shared/src/steps.ts`, which places intents against a definition's steps.
- [ ] **viz** (`apps/viz`) and the **session REPL** (`src/session`). Terminal views of a running
      guest.

## 5. Cutover

- [ ] **The production database.** V2's migrations rename V1's tables in place (`test_runs` to
      `test_suites`, `test_results` to `test_runs`, `automation_jobs` to `jobs`) and drop sessions
      and Linear ids, so V1 stops working the moment V2's `prod:db:migrate` runs. The cutover is:
      stop V1, migrate, start V2, with no way back but a restore.
      [#298](https://github.com/ThePrimeagen/Oligarchy/pull/298) proposed V2 tables in a Postgres
      schema of their own instead; decide before cutover.
- [ ] **CI for V2.** CI lints and formats `v2/` but never runs its type checks or unit tests, and
      the migration checks guard only `packages/db/drizzle`. Add V2's `check:types`, `test:unit`
      and `db:check`, and the append-only and in-sync checks for `v2/packages/db/drizzle`.
- [ ] **Docs and skills.** The root `AGENTS.md`, `client.md`, `ctrl.md`, `ctrl-linear.md`,
      `ctrl-diagnose.md`, `minted-disks.md`, `SUPER_RUN.md` and the skills in `.cursor/skills`
      describe V1 and its Linear board: a driving agent takes its task from a ticket, and a run is
      watched on the board. Rewrite them for V2 as its apps land; `ctrl-linear.md` goes.
- [ ] **Retire V1.** Delete `apps/`, `packages/` and `src/`, V1's scripts and workspaces in the
      root `package.json`, and `LINEAR_*` from every env file, then move `v2/` to the root.

## Not coming over

- Linear: the service, the board and its columns, the `ready` label, the webhook, the ticket
  templates and `LINEAR_*`.
- Sessions: `SessionStore`, `agent_runs`, and routing by session or agent, which `routeJob` and
  `serverForJob` replace.
- `Database.ping`.
- The shared HTTP API package: V1's contract, middleware, `serve` and wire errors. Each app's Hono
  routes are its contract.
- V1's shared fakes in `packages/testing`: each V2 package ships its own.
- V1's schemas in `packages/shared/src/domain.ts`: the enums in V2's schema are the types.
