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
- **No `./client`.** `src/client`, its `./client` wrapper and `client.md` are not ported, and
  nothing in V2 runs them. Everything else must still work as it does in V1: the driver drives a
  guest through `@oligarchy/qemu-http-tools`, not through `./client`'s words.

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
- [x] **qemu-http-tools** (`v2/packages/qemu-http-tools`). V1: `src/harness/tools.ts`,
      `src/harness/intent.ts`, `src/harness/pointer.ts` and `src/driver/client.ts`, over
      `packages/http/src/proxy-client.ts`. Controlling one job's qemu guest over HTTP for the AI's
      tools. `create({ http }, { job, baseUrl, token, signal })` names the job once; every call
      carries it, and `OLIGARCHY_TOKEN` as the bearer, on `@oligarchy/http` to the qemu reverse
      proxy. The harness's calls are `start`, `intentStart`, `intentEnd`, `stop` and `save`. The
      guest's are `image` (the PNG's bytes, through `@oligarchy/http`'s `read: "bytes"`),
      `serial`, `sendKeys` and `mouse`, which keeps the pointer as V1's harness did: a move,
      scroll, hold or release leaves it at its point, a click and a double-click press there, a
      drag starts there and leaves it at its end, a nudge moves it 0.02, and a call that failed
      leaves it where it was. `tools` and `run(name, args)` are the model's native tool calls
      over the guest's calls, one per action, each checked by its zod schema before anything is
      sent. The driver owns steps, reasons and Done, and takes its own fields out of a call's
      arguments before `run`. Nothing is asked again: every error comes back in the result,
      `@oligarchy/http`'s own and `GuestOff` (a 409 from the screen, keys or mouse), `IntentOpen`
      (from intent start), `NotPoweredOff` (from save), `NoPointer` and `ToolInvalid`. `start`
      waits 45 minutes and `save` 5; the run's signal aborts every call but `stop`. The proxy's
      other calls go with the apps that make them: the automation client's reserve and
      relinquish, `ctrl mint`'s minted and viz's follow.

## 2. Finish the services V2 has

- [x] **`tests`: write the model at start.** `startRun(runId, model)` writes the model id to
      `test_runs.model` beside the running status, as V1's `startResult` did. A refused or missing
      start writes neither.
- [x] **`tests`: the live queue for viz and `ctrl automation`.** `listJobs(limit = 25)` returns the
      running and the pending jobs, each list in queue order and cut at `limit`, read on one
      snapshot. Each job carries its test's name, the url of the automation client that claimed it
      and that of the qemu server holding its guest. V1's also listed the newest finished jobs, which
      viz's tickets tab and `ctrl automation --list` showed, and each job's instruction, open intent
      and the database's clock. V2 lists only the live queue; the instruction is
      `tests.getJobDetails`, intents are `logs.listIntents` (keyed by test run, so a job keeps only
      the lines since it was queued) and actions are `actions.listActions`.
- [x] **Where a job's guest state lives.** In `vm_status`, one row per change to a job's VM, never
      updated: its status is its newest row, and when it started or ended is when that row was
      written. `downloading` and `running` are live; `shutdown` (the guest powered itself off),
      `stopped` (the host ended it), `panicked` (its pvpanic device fired), `crashed` (QEMU gone
      with no `SHUTDOWN`) and `server-error` (a VM the qemu server itself failed) are how it ended,
      and only `crashed` and `server-error` have a reason. The `vmStatus` store records a live
      status, `stop`s with an end one, reads the `current` and the `history`, and
      `clearPastRunningVms` marks as a `server-error` every VM a qemu server's crashed last process
      left downloading or running, saying so.
- [x] **Services take their services first.** A file that registers a service exports
      `create = App.createService<Wants, Options, Service>((services, options) => service)`:
      `Wants` is the union of the services it uses, and `make` sees only those. `Options` is
      always one object of named fields, `App.NoOptions` for a service told nothing, and never a
      bare value, a list or a function. Creation is synchronous and cannot fail; a service that
      reaches something connects on first use.
      What `createService` builds is `App.Made<Service>`, the only thing `app.run` and another
      create's services accept, so a fake goes through `createService` too.
      `oligarchy/service-create` lints that every registering file exports that `create` for its
      own service, and `oligarchy/service-cycle` that no service wants itself through the ones it
      wants, across packages. The logger wants `db`: it stores each line in the logs table itself
      and logs each pool error through `db.onPoolError`, so the database wants nothing. env
      refuses a `DATABASE_URL` that is not a url with `InvalidVariable`, naming the variable and
      never its value. Tests that only read what was logged use `@oligarchy/logger/testing`.
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
- [ ] **Dispatch.** The automation server's loop: `nextPendingJob`, then a reserve on a live
      automation client, round robin (a mint only on the server its setup lock names). Only once
      that client has reserved the job does `runJob` move it to running, naming the client, and
      `/run` send the prompt. A reserve that is refused or fails leaves the job pending, and the
      loop sleeps 30 seconds before it asks again. One reserve is in flight at a time. V1:
      `dispatch` in `worker.ts`.
- [ ] **The mission.** V1's driving and diagnosing prompts name only the agent's Linear ticket; the
      mission was the ticket's body, and V1's driver looks it up with `findResultByLinearId`. In V2
      the agent is its job id: the driver loads its mission with `tests.getJobDetails(jobId)`, and
      `prompts/driving-agent.html` and `prompts/diagnosing-agent.html` take the job id where they
      take `{{LINEAR_TICKET}}`. `prompts/custom-harness-driving-agent.html`, the driver's system
      prompt, lists qemu-http-tools' tools where it pastes in `client.md` and describes its `client`
      tool, and `prompts/driving-agent.html` names them where it names `./client`.
      `prompts/linear-issue.html` and `prompts/mint-issue.html` were ticket bodies and go.
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
      Answers as `@oligarchy/qemu-http-tools` reads it: each call names its `job`, not an agent
      and a session; `/image` and `/serial` answer bytes; and a 409 is a guest that is off on
      `/image`, `/send-keys` and `/mouse/*`, an intent already open on `/intent/start` (V1
      answered that one 400) and a guest that did not power off on `/save`. A call naming a job it
      holds no guest for is a 404, job not found: a restarted server holds none, so its lost
      guests' drivers fail, their automation clients answer `/run` with the failure, and the
      automation server errors the jobs. Nothing errors them at startup, as V1's
      `failRoutedSessions` did. At boot it calls `vmStatus.clearPastRunningVms` on its url, and
      kills any QEMU its last process left running, which V1 never did. Starts
      QEMU with a pvpanic device and without `-no-reboot`, since a mint's installer reboots. Writes
      each VM's `vmStatus` as it changes, and reads how one ended from QEMU's `SHUTDOWN` reason
      over QMP, which V1 ignored: `guest-shutdown` is `shutdown`, `host-signal` and
      `host-qmp-quit` are `stopped`, `guest-panic` is `panicked`, and QEMU exiting with no
      `SHUTDOWN` is `crashed`, with its exit code or signal and the end of its stderr. pvpanic
      carries no detail: a panic's trace reaches the serial only once the installed system's
      kernel writes its console to `ttyS0`, which the mint does not set yet.
- [ ] **qemu-reverse-proxy** (`apps/qemu-reverse-proxy`). Services: `Router` (registers and lists
      qemu servers, reserves and starts a job's guest on one, and forwards each later call to it by
      `servers.serverForJob`) and `Setup` (the mint lock watcher on `setup_requests`). Serves
      `/servers`, `/minted` (asking every qemu server) and the qemu-server calls except `/stats`.
      Forgets silent servers with `fleet.forget`.
- [ ] **automation-server** (`apps/automation-server`). Section 3's dispatch, close, abort, restart
      and shutdown, and `/abort`. Its reserve, run and abort calls to an automation client are its
      own, on `@oligarchy/http` with `OLIGARCHY_TOKEN` as the bearer (V1: `client.ts`). `/linear`,
      the board watch (`backlog.ts`) and the webhook signature (`signature.ts`) go.
- [ ] **automation-client** (`apps/automation-client`). `Sessions` (reserve, run, abort and shutdown
      against `--max-jobs`); spawns `./driver` for a drive or mint and opencode for a diagnose
      (`opencode.ts`); announces itself. Serves `/reserve`, `/run` and `/abort`.
- [ ] **driver and harness** (`src/driver`, `src/harness`). The model loop: history, tools, the
      pointer, intents, and the stop rule (result closed, step limit, model stopped, run ceiling).
      Needs qemu-http-tools. It creates the OpenRouter client with `timeouts.header` from
      `oligarchy.json` as its timeout (`timeouts.chunk` means nothing without a stream, but V1
      still reads it) and a number of attempts, and hands `complete` the run's ceiling as the
      deadline;
      `OpenRouterOutOfTime` is that ceiling reached. Its tests need a fake of the OpenRouter
      client, which `@oligarchy/openrouter` does not have yet.
- [ ] **ctrl** (`apps/ctrl`). `test` (define, details, list, run, testsuite, start),
      `test-results`, `mint`, `session` (becomes a job's view: status, logs, definition, run,
      actions, images, debug log, diagnosis), `error-type` (new, list), `diagnose` and
      `automation`.
- [ ] **dashboard** (`apps/dashboard`). Already Hono. Its queries (`query.ts`) move onto the V2
      stores, the pages keyed by ticket (`/tickets/:ticket`) key by job id, and `@oligarchy/linear`
      and `@oligarchy/jobs` go. It runs on Cloudflare Workers with a `pg` client per request, while
      V2's `Db.create` makes a pool, so the database service needs a way to run there. It carries
      `packages/shared/src/steps.ts`, which places intents against a definition's steps.
- [ ] **viz** (`apps/viz`) and the **session REPL** (`src/session`). Terminal views of a running
      guest. viz reads the guest's output through the proxy's `/follow`, which streams in V1, and
      `@oligarchy/http` reads whole bodies: decide whether `follow` needs streaming added to it.

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
      watched on the board. Rewrite them for V2 as its apps land; `client.md` and `ctrl-linear.md`
      go.
- [ ] **Retire V1.** Delete `apps/`, `packages/` and `src/`, V1's scripts and workspaces in the
      root `package.json`, and `LINEAR_*` from every env file, then move `v2/` to the root.

## Not coming over

- Linear: the service, the board and its columns, the `ready` label, the webhook, the ticket
  templates and `LINEAR_*`.
- Sessions: `SessionStore`, `agent_runs`, and routing by session or agent, which `routeJob` and
  `serverForJob` replace.
- `./client`: `src/client`, its wrapper, `client.md`, and the driver's one `client` tool.
  qemu-http-tools replaces them.
- `Database.ping`.
- The shared HTTP API package: V1's contract, middleware, `serve` and wire errors. Each app's Hono
  routes are its contract.
- V1's shared fakes in `packages/testing`: each V2 package ships its own.
- V1's schemas in `packages/shared/src/domain.ts`: the enums in V2's schema are the types.
