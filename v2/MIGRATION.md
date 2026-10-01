# Moving to V2

V1 is the repository root (`apps/`, `packages/`, `src/`). V2 is `v2/`. This is every task left
before V2 can replace V1, roughly in the order they unblock each other. Tick a box when its PR
merges.

Every task follows `v2/AGENTS.md`: the failing tests come first, one test for each error a unit can
meet plus one happy path, and every service is faked except the database.

## Decided

- **Jobs live in the `tests` store.** A test run is one definition against one ISO on one server,
  and carries that ISO and server itself. It is filed on its own, to try something out, or in a
  suite: a batch named by its ISO's version that holds any number of test runs of each definition
  and tallies them. A test run holds its jobs: setup, drive and diagnose. A job runs once; trying
  again is a new job.
- **Setup, not mint.** What V1 calls a mint, installing an ISO and saving the disk a resume boots
  from, is a setup in V2, and that disk is its setup disk: the job action, the definition, the
  config keys, the flags and `ctrl setup`. V2 reads its own `v2/oligarchy.json`, since V1 still
  reads `mint` from the root's.
- **A definition says whether it resumes.** A drive of a resuming definition boots its test run's
  ISO from that ISO's setup disk, and one that does not boots fresh. A setup always boots fresh.
- **No Linear.** V2 files no tickets and reads no board. The pending jobs in Postgres are the queue,
  and an agent is known by its job id.
- **HTTP servers are Hono.** Each app's `main` builds its own Hono app; there is no shared API
  package. Calls out go through `@oligarchy/http`.
- **No sessions.** What V1 kept on a session (actions, images, logs, routing, debug logs,
  diagnoses) is keyed by job or by test run.
- **Modern terminals only.** Output is coloured when stdout is a TTY, and the terminal is assumed
  to render 24-bit colour, as Ghostty does. There is no `FORCE_COLOR` and no colour-depth probe;
  V1's `packages/env/src/colors.ts` is not ported.
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
      relinquish, `ctrl setup`'s setup disks and viz's follow.

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
- [x] **Wire Sentry.** `@oligarchy/sentry` hard-codes V1's DSN as `DSN`, and `ENVIRONMENT` is
      `production`, which V1's events all were. The logger, which wants `sentry`, sends each error
      and fatal line as it is logged, as its `cause` or else its text, with its level, its location
      and agent as tags and its text as `extra.log`, unless told `skipSentry`, and a log insert's
      failure too, as V1's `Log` did. The tester's `createServices` builds it over the world's
      `http` and hands it to the logger, and `closeServices` waits for it after the logger's last
      line; each app does the same as it is ported. A test that runs an app as a process points
      `https_proxy` at a port nobody listens on, as V1's did, so the real project hears nothing.
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
      wants, across packages. The logger wants `sentry` and `db`: it stores each line in the logs
      table itself and logs each pool error through `db.onPoolError`, so the database wants
      nothing. env refuses a `DATABASE_URL` that is not a url with `InvalidVariable`, naming the
      variable and never its value. Tests that only read what was logged use
      `@oligarchy/logger/testing`.
- [x] **`tests`: test runs carry their ISO, and suites are batches.** Migration 0009:
      `test_runs` gains `iso` and `server_url`, filled for existing rows from their suites, and
      its `suite_id` may be null. The reads that join a test run to its suite answer `suite:
      null` for one filed on its own. V1's unique index on a run's definitions, carried over as
      `test_runs_suite_definition_idx`, goes, so `Duplicate` goes: a suite can hold a setup run
      per server, or the same test several times. `suiteName` gives the version in the url's file
      name (`https://iso.omarchy.org/omarchy-4.0.4.iso` is `4.0.4`), or the whole url when it
      names none, so a host such as `10.0.0.5` is never a version.
      `test_definitions.resume`, true unless a definition is defined otherwise, is kept with each
      wording. A suite and a single run are written by the next item.
- [x] **`tests`: a suite is written whole.** `createTestSuite({ iso, serverUrl, definitionIds })`
      writes the suite, running, a test run per id (an id named twice is two test runs), and each
      test run's pending job, in one transaction, and hands back the suite's details. The job is
      a setup when that definition is named `setup`, and a drive otherwise; the caller does not
      choose the action. A missing definition is `NotFound`, no ids is `InvalidState`, and a
      failed write is the database's error; each leaves nothing behind.
      `createTestRun({ definitionId, iso, serverUrl })` writes a test run on its own and its
      pending job in one transaction, and hands back both. `startSuite` and
      `createTestRun({ definitionId, suiteId })` go. Runs and jobs are stamped with
      `clock_timestamp()`, so they keep the order they were named in. A setup's lock is the next
      item.
- [x] **Mint is setup.** Migration 0010 renames the `job_action` value `mint` to `setup`, and the
      definition named `mint` to `setup`, rows already written included. The queue hands out
      setups first. The config's `models.setup` and `reasoning.setup` replace `mint`, in V2's own
      `v2/oligarchy.json`; the driver's `--action` is `drive` or `setup`; `ctrl setup`'s
      `--setup-only` replaces `--unminted`; and a minted disk is a setup disk.

## 3. The flow that replaces the Linear board

In V1 the board drove everything: `ctrl` filed tickets, a webhook and a thirty-second board watch
queued jobs from the tickets' columns, and each close moved a ticket on. That logic is in
`packages/jobs` and `apps/automation-server/src/worker.ts`. In V2 the `tests` store is the whole
record, and the automation server acts on it directly.

- [x] **File a setup.** The job follows the definition (section 2), and its lock is taken in
      the same transaction, so the queue never sees a setup job with no server or part of a
      suite. `createTestRun({ definitionId, iso, serverUrl, setupServer })` of the `setup`
      definition writes the run, its setup job, and names that job on the lock the proxy has
      already inserted for `setupServer`; the run's `serverUrl` is the proxy. No server, no lock
      row, or a lock that already has a job writes nothing. A drive that names a `setupServer`
      is `InvalidState`. `createTestSuite({ iso, serverUrl, definitionIds, setupServers })` of
      the `setup` definition, one server per id, writes the suite and claims each server with
      `setupRequests.claim`, which refuses a lock a live setup holds and a lock still waiting on its job;
      one refusal rolls the suite back. A setup and a drive cannot share a suite, a setup suite
      needs one server per run, and a drive suite names no servers. `ctrl test suite` and the
      dashboard pass every definition but `setup`, with no `setupServers`.
- [ ] **Dispatch.** The automation server's loop: `nextPendingJob`, then a reserve on a live
      automation client, round robin (a setup only on the server its setup lock names). Only once
      that client has reserved the job does `runJob` move it to running, naming the client, and
      `/run` send the prompt. A reserve that is refused or fails leaves the job pending, and the
      loop sleeps `automationServer.dispatchInterval` from `v2/oligarchy.json` (30 seconds)
      before it asks again. One reserve is in flight at a time. A drive's
      reserve resumes its test run's ISO when its definition resumes and asks for a fresh boot
      otherwise; a setup's never resumes. A resume that no qemu server holds the setup disk for is
      the proxy's to set up, and the drive stays pending until a reserve lands. A setup that fails
      releases its lock, so the drive's next reserve sets up again; decide when a drive whose ISO
      keeps failing to set up is errored instead. V1: `dispatch` in `worker.ts`.
- [ ] **The mission.** V1's driving and diagnosing prompts name only the agent's Linear ticket; the
      mission was the ticket's body, and V1's driver looks it up with `findResultByLinearId`. In V2
      the agent is its job id: the driver loads its mission with `tests.getJobDetails(jobId)`, and
      `prompts/driving-agent.html` and `prompts/diagnosing-agent.html` take the job id where they
      take `{{LINEAR_TICKET}}`. `prompts/custom-harness-driving-agent.html`, the driver's system
      prompt, lists qemu-http-tools' tools where it pastes in `client.md` and describes its `client`
      tool, and `prompts/driving-agent.html` names them where it names `./client`.
      `prompts/linear-issue.html` and `prompts/mint-issue.html` were ticket bodies and go.
- [ ] **Close a drive or setup.** `completeJob` when the driver ran to its end, then queue a
      diagnose job on the same test run; `errorJob` with the reason when the system failed it.
- [ ] **Diagnose.** The diagnosing agent writes its verdict against the drive's job with
      `ctrl diagnose` (`diagnosis.saveDiagnosis`). Then the drive is `finalizeJob`ed, its run
      `completeRun`s passed or failed, and its suite, when it has one, `completeSuite`s once its
      last run has closed.
- [ ] **Abort.** By job id or by suite id, from `ctrl`, the dashboard and the automation server's
      `/abort`. A pending job is `abortJob`ed; a running one is stopped at its automation client
      first.
- [ ] **Restart and shutdown.** At startup, each job the last automation server left running is
      stopped at its client and errored, except a drive or setup whose driver had already finished,
      which is closed as it would have been. At shutdown, each running job is stopped at its client
      and aborted. V1: `packages/jobs/src/reclaim.ts`, and `stopInherited` and `stopAtShutdown` in
      `worker.ts`.
- [ ] **Try again.** An operator's retry, from `ctrl` or the dashboard, is a new job on the same test
      run.

## 4. Apps

None of V1's apps are ported yet; the automation server has a skeleton. Each becomes a V2 app
under `v2/apps/`: its `main` reads its environment with
`@oligarchy/env`, builds its services with a `createServices` (Sentry among them, handed to its
logger and waited for on exit, as the tester's are), serves Hono behind the `OLIGARCHY_TOKEN`
bearer, and runs under `@oligarchy/app`.

- [ ] **qemu-server** (`apps/qemu-server`). Services: `Qemu` (starts a guest; keys, mouse,
      screendump, powerdown), `Iso` (downloads and caches ISOs in the data dir), `SetupDisks`
      (finds and saves setup disks), `QmpListen` (the QMP socket) and `Sessions` (slots against
      `--max-jobs`, each guest's life, stats). Serves `/reserve`, `/relinquish`, `/start`,
      `/stop`, `/save`, `/image`, `/serial`, `/follow`, `/stats`, `/setup-disks`, `/send-keys`,
      `/mouse/*`, `/intent/start` and `/intent/end`. Announces itself with `fleet.announce`.
      Saves a failed guest's debug log with `debugLogs.saveDebugLog`; V1 has the store but
      nothing calls it.
      Answers as `@oligarchy/qemu-http-tools` reads it: each call names its `job`, not an agent
      and a session; `/image` and `/serial` answer bytes; and a 409 is a guest that is off on
      `/image`, `/send-keys` and `/mouse/*`, an intent already open on `/intent/start` (V1
      answered that one 400) and a guest that did not power off on `/save`. A call naming a job it
      holds no guest for is a 404, job not found: a restarted server holds none, so its lost
      guests' drivers fail, their automation clients answer `/run` with the failure, and the
      automation server errors the jobs. Nothing errors them at startup, as V1's
      `failRoutedSessions` did. At boot it calls `vmStatus.clearPastRunningVms` on its url, and
      kills any QEMU its last process left running, which V1 never did. Starts
      QEMU with a pvpanic device and without `-no-reboot`, since a setup's installer reboots. Writes
      each VM's `vmStatus` as it changes, and reads how one ended from QEMU's `SHUTDOWN` reason
      over QMP, which V1 ignored: `guest-shutdown` is `shutdown`, `host-signal` and
      `host-qmp-quit` are `stopped`, `guest-panic` is `panicked`, and QEMU exiting with no
      `SHUTDOWN` is `crashed`, with its exit code or signal and the end of its stderr. pvpanic
      carries no detail: a panic's trace reaches the serial only once the installed system's
      kernel writes its console to `ttyS0`, which the setup does not set yet.
- [ ] **qemu-reverse-proxy** (`apps/qemu-reverse-proxy`). Services: `Router` (registers and lists
      qemu servers, reserves and starts a job's guest on one, and forwards each later call to it by
      `servers.serverForJob`) and `Setup` (the setup lock watcher on `setup_requests`). Serves
      `/servers`, `/setup-disks` (asking every qemu server) and the qemu-server calls except
      `/stats`. Forgets silent servers with `fleet.forget`, in a loop of its own as the
      automation server does. A resume reserve that no server can
      take, because those with room hold no setup disk for its ISO, takes each such server's setup
      lock with `setupRequests.insert`, files a setup for each (section 3's File), and answers
      setup needed. One setup per ISO and server: a reserve while that setup is in flight files
      none, and one that ended without passing releases the lock (V1: `setup.ts`).
- [ ] **automation-server** (`v2/apps/automation-server`). Section 3's dispatch, close, abort,
      restart and shutdown, and `/abort`. `/linear`, the board watch (`backlog.ts`) and the
      webhook signature (`signature.ts`) go. Done when every task below is ticked, roughly in
      their order.
      - [x] **Skeleton.** `bun run automation-server`. `main` needs `DATABASE_URL`, builds its
            services with Sentry, says it started with its models, runs `restart`, starts the
            dispatch sub-app, and waits for SIGINT or SIGTERM; then it runs `shutdown`, says it
            stopped, and closes its services. The dispatch sub-app's main is a loop that runs
            until the server is killed, waiting `automationServer.dispatchInterval` each pass;
            the kill ends the wait at once. A database that cannot be reached does not stop it.
            `restart`, `shutdown` and the loop's pass do nothing yet.
      - [x] **Forget silent clients.** A sub-app beside dispatch forgets the automation clients
            silent for longer than `automationServer.forgetAfter` (10 minutes), as V1's
            `Sweep.forget` did, so dispatch never reserves on a client that died without deleting
            its row. Its main is a loop that runs until the server is killed: each pass is one
            `fleet.forget` sweep, then a wait of `automationServer.forgetInterval` (30 seconds).
            `fleet.forget` is one sweep and has no loop of its own.
      - [ ] **Calls to an automation client.** `reserve`, `run` and `abort`, the server's own,
            on `@oligarchy/http` with `OLIGARCHY_TOKEN` as the bearer, so the environment needs
            `oligarchyToken` from here on (V1: `client.ts`). Each names its job. A reserve refused
            for capacity (503) or for a setup still needed (409) is not a failure; `run` answers
            once the driver or opencode has ended, and with a 409 when an abort ended it; an
            `abort` of a job the client does not hold is a 404. Its fake produces every one of those, and each of `@oligarchy/http`'s errors.
      - [ ] **Dispatch** (section 3's Dispatch) in the loop's pass. Needs the client calls, and
            the prompt from section 3's The mission.
      - [ ] **Close** (section 3's Close a drive or setup, and Diagnose's finalize) once `/run`
            answers.
      - [ ] **Restart** (section 3's Restart and shutdown, at startup) in `restart`.
      - [ ] **Shutdown** (section 3's Restart and shutdown, at shutdown) in `shutdown`. Today
            it runs as soon as the signal lands, beside a dispatch pass still in flight; decide
            whether it moves to an exit handler of the dispatch sub-app, which runs only once the
            loop has ended and before the services close.
      - [ ] **Serve.** A Hono app behind the `OLIGARCHY_TOKEN` bearer on a required `--port`,
            listening on 127.0.0.1. The started line names the port, and a port that cannot be
            bound is a fatal line and exit 1.
      - [ ] **`/abort`** (section 3's Abort), by job id or by suite id.
- [ ] **automation-client** (`apps/automation-client`). `Sessions` (reserve, run, abort and shutdown
      against `--max-jobs`); spawns `./driver` for a drive or setup and opencode for a diagnose
      (`opencode.ts`); announces itself. Serves `/reserve`, `/run` and `/abort`.
- [ ] **driver and harness** (`src/driver`, `src/harness`). The model loop: history, tools, the
      pointer, intents, and the stop rule (result closed, step limit, model stopped, run ceiling).
      Needs qemu-http-tools. It creates the OpenRouter client with `timeouts.header` from
      `v2/oligarchy.json` as its timeout (`timeouts.chunk` means nothing without a stream, but V1
      still reads it) and a number of attempts, and hands `complete` the run's ceiling as the
      deadline;
      `OpenRouterOutOfTime` is that ceiling reached. Its tests need a fake of the OpenRouter
      client, which `@oligarchy/openrouter` does not have yet.
- [ ] **dashboard** (`apps/dashboard`). Already Hono. Its queries (`query.ts`) move onto the V2
      stores, the pages keyed by ticket (`/tickets/:ticket`) key by job id, and `@oligarchy/linear`
      and `@oligarchy/jobs` go. It runs on Cloudflare Workers with a `pg` client per request, while
      V2's `Db.create` makes a pool, so the database service needs a way to run there. It carries
      `packages/shared/src/steps.ts`, which places intents against a definition's steps.
- [ ] **viz** (`apps/viz`) and the **session REPL** (`src/session`). Terminal views of a running
      guest. viz reads the guest's output through the proxy's `/follow`, which streams in V1, and
      `@oligarchy/http` reads whole bodies: decide whether `follow` needs streaming added to it.

## 5. Cutover

- [ ] **CI for V2.** CI lints and formats `v2/` but never runs its type checks or unit tests, and
      the migration checks guard only `packages/db/drizzle`. Add V2's `check:types`, `test:unit`
      and `db:check`, and the append-only and in-sync checks for `v2/packages/db/drizzle`.
- [ ] **Docs and skills.** The root `AGENTS.md`, `client.md`, `ctrl.md`, `ctrl-linear.md`,
      `ctrl-diagnose.md`, `minted-disks.md`, `SUPER_RUN.md` and the skills in `.cursor/skills`
      describe V1 and its Linear board: a driving agent takes its task from a ticket, and a run is
      watched on the board. Rewrite them for V2 as its apps land; `client.md` and `ctrl-linear.md`
      go.
- [ ] **Retire V1.** Delete `apps/`, `packages/` and `src/`, V1's scripts and workspaces in the
      root `package.json`, V1's root `oligarchy.json`, and `LINEAR_*` from every env file, then
      move `v2/` to the root, V2's `oligarchy.json` and its config path with it.

## 6. ctrl, last

`ctrl` is really the diagnosing agent's tool, so it is dealt with after everything else. It keeps
V1's shape, `ctrl <command> <subcommand>`, with far fewer commands.

- [ ] **ctrl** (`apps/ctrl`), cut down from V1's.
      - `test run --name <definition> --iso <url>`: one test run on its own, with no suite, for
        trying something out; prints its test run and job ids.
      - `test suite --iso <url>`: a suite of every definition but `setup`; prints its id.
      - `setup`: a setup on each server (section 3's File).
      - `diagnose`: the diagnosing agent's verdict against a drive's job (section 3's Diagnose).

      Open: whether the proxy's url is a flag, as V1's `--server-url` was, or read from the
      environment; and which of V1's other commands come over at all (`test define`, `details`,
      `list` and `start`, `test-results`, `session` as a job's view, `error-type` and
      `automation`).
- [ ] **Session flags in env.** `v2/packages/env/src/args.ts` still carries V1's session flags:
      `--session-id` (and `SESSION_ID`), `--search`, `--test-result-id`, and `ctrl session`'s
      `--status`, `--logs`, `--test-def`, `--test-results`, `--test-run`, `--actions`, `--images`,
      `--debug-logs`, `--diagnosis` and `--all`. Rename or drop them as `ctrl` is ported.

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
