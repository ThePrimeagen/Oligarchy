# Moving to V2

V1 is the repository root (`apps/`, `packages/`, `src/`). V2 is `v2/`. This is every task left
before V2 can replace V1, roughly in the order they unblock each other. Tick a box when its PR
merges.

Every task follows `v2/AGENTS.md`: the failing tests come first, one test for each error a unit can
meet plus one happy path, and every service is faked except a database the test starts and stops.
The test isolation work below records the completed changes and the cases left unchanged.

## Decided

- **Jobs live in the `tests` store.** A test run is one definition against one ISO on one server,
  and carries that ISO and server itself. It is filed on its own, to try something out, or in a
  suite: a batch named by its ISO's version that holds any number of test runs of each definition
  and tallies them. A test run holds its jobs: setup, drive and diagnose. A job runs once; trying
  again is a new job.
- **Setup, not mint.** What V1 calls a mint, installing an ISO and saving the disk a resume boots
  from, is a setup in V2, and that disk is its setup disk: the job action, the definition, the
  config keys and the flags. V2 reads its own `v2/oligarchy.json`, since V1 still
  reads `mint` from the root's.
- **A definition says whether it resumes.** A drive of a resuming definition boots its test run's
  ISO from that ISO's setup disk, and one that does not boots fresh. A setup always boots fresh.
- **No Linear.** V2 files no tickets and reads no board. The pending jobs in Postgres are the queue,
  and an agent is known by its job id.
- **HTTP servers are Hono.** Each app's `main` builds its own Hono app; there is no shared API
  package. An app's routes are one chained Hono app, each body checked by a zod schema through
  `@hono/zod-validator`, and its type is exported as `Routes`, so a caller's `hc<Routes>` and a
  test's `testClient` are typed by the routes themselves. Calls out go through `@oligarchy/http`.
  A caller reaches another app through `@oligarchy/http/client`, typed by that app's `Routes`
  (a type import, through `hono/types`' `ExtractSchema`, with no runtime code):
  `create<Routes>()({ http, url, token, signal? }, specs)` is made once from the url its row
  names, and `post(path, body)` takes only the routes' paths and each route's body, joins the
  path to the url and carries the token as the bearer. `specs` holds one entry per route: its
  `ok` word for a 2xx, a word for each other status it answers that is no failure, and any
  `timeoutMs`; every status left out stays `@oligarchy/http`'s error. A route left out, a route
  the app lacks, a status the route never answers and a route with no POST do not compile, so
  a route that changes stops its callers compiling. An app exports its routes, and a fake of
  what they are handed as `./testing`, for its callers and their tests; there is still no
  shared API package.
- **No sessions.** What V1 kept on a session (actions, images, logs, routing, debug logs,
  diagnoses) is keyed by job or by test run.
- **Modern terminals only.** Output is coloured when stdout is a TTY, and the terminal is assumed
  to render 24-bit colour, as Ghostty does. There is no `FORCE_COLOR` and no colour-depth probe;
  V1's `packages/env/src/colors.ts` is not ported.
- **No `./client`.** `src/client`, its `./client` wrapper and `client.md` are not ported, and
  nothing in V2 runs them. Everything else must still work as it does in V1: the driver drives a
  guest through `@oligarchy/qemu-http-tools`, not through `./client`'s words.
- **ctrl is a service, not a program.** `@oligarchy/ctrl` is the diagnosing agent's tools, and
  apps use it. There is no `./ctrl` and no `apps/ctrl` in V2 (section 6).

## Test isolation work

Completed in the timing and isolation pass:

- **Timing.** The automation server's `/run` client test holds the response and advances fake
  time beyond the HTTP default before releasing it. The dispatcher abort test waits until the
  fake reserve is entered before aborting. The fleet member test holds a write and advances fake
  time to prove shutdown waits for it. HTTP client timeout tests use fake time, and cancellation
  waits for the fake request to start. Sentry tests use held responses and fake time; their
  real-time `within` helper is gone. Tick and OpenRouter tests already used fake timers.
- **Automation app lifecycle.** Both apps export `application.ts`'s `main({ listen })` so tests
  can run them with fake listeners, services, process IO and clocks. Their lifecycle tests cover
  startup, listener failure and shutdown ordering; the server exercises dispatch and cleanup,
  and the client exercises announcing and releasing reservations. They no longer launch child
  processes, bind sockets or poll for readiness.
- **App signals.** `packages/app/test/app.test.ts` uses fake IO for SIGINT, SIGTERM and SIGHUP,
  including a second signal while an exit handler is held. The process test and its executable
  fixture are gone.
- **Env IO.** `Io.node` accepts an injected source for arguments, environment and file reads.
  Its IO tests supply content and filesystem errors directly.
- **Fleet process listing.** `listProcesses` accepts an injected `spawn`. Its tests control
  stdout, startup failure and process exit, with fake time for the timeout and SIGTERM/SIGKILL
  grace period.
- **HTTP serving.** `listen` accepts an injected `createServer`. Its tests control readiness,
  bind errors and closure, checking that shutdown closes connections and waits for completion.
- **Logger refusal.** `packages/logger/test/refusal.test.ts` supplies a database service whose
  `run` always returns a known `DatabaseError`. It checks printed messages, continued processing
  and the errors sent to fake Sentry. The logger tests no longer use an assumed unavailable port.

These fake lifecycle and listener tests check application behavior; they do not prove OS signal
delivery, executable startup or port release. Production entrypoints still use real IO.

Two proposed changes were dropped from this pass, leaving these tests unchanged:

- `packages/tester/test/tester.test.ts` still launches the tester executable and captures its
  output. It points its HTTP proxies at `127.0.0.1:1` to attempt to block Sentry requests.
- `packages/db/test/db.test.ts` still uses `127.0.0.1:1` for its connection-refusal test, assuming
  nothing is listening there.

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
      relinquish, viz's follow, and `/setup-disks` for whatever files setups (section 6's Not in
      ctrl).

## 2. Finish the services V2 has

- [x] **`tests`: write the model at start.** `startRun(runId, model)` writes the model id to
      `test_runs.model` beside the running status, as V1's `startResult` did. A refused or missing
      start writes neither.
- [x] **`tests`: the live queue for viz and the dashboard.** `listJobs(limit = 25)` returns the
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
      line; each app does the same as it is ported. The automation apps' lifecycle tests use fake
      services. The tester's retained process tests use the proxy workaround recorded above.
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
      The automation client's `Services`, the services in its `World`, and `closeServices` now
      use `App.Needs` rather than manually listing service fields. `createServices` checks its
      result with `satisfies Services`, preserving the inferred `App.Made` types for callers.
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
      `v2/oligarchy.json`; the driver's `--action` is `drive` or `setup`; and a minted disk is a
      setup disk.

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
      needs one server per run, and a drive suite names no servers. The dashboard passes every
      definition but `setup`, with no `setupServers`.
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
- [ ] **The drive harness.** V1's driving prompt names only the agent's Linear ticket; the task
      was the ticket's body, and V1's driver looks it up with `findResultByLinearId`. In V2 the
      agent is its job id, and the driving prompt takes the job id where V1 takes
      `{{LINEAR_TICKET}}`. V2 has one driving prompt, the driver's system prompt, embedded in
      `@oligarchy/drive-harness`; it replaces both V1's `prompts/driving-agent.html` and
      `prompts/custom-harness-driving-agent.html`, and lists the model's tools where V1 pastes in
      `client.md` and describes its `client` tool.
      V1's `prompts/linear-issue.html` and `prompts/mint-issue.html` were ticket bodies and go at cutover.
      `@oligarchy/drive-harness` exports `class DriveHarness`, made with
      `new DriveHarness(services, { recentActions })` over `tests`, `moves`, the job's
      `qemuHttpTools` and `openRouter`, with `harness.recentActions` from `v2/oligarchy.json` (10). It holds one
      drive or setup's state: the loaded job, every step opened with all its actions, the
      model's last response, the previous move and the screen. Its methods are the points the
      driver's loop calls:
      - `loadJobHarnessData(jobId)` reads `tests.getJobDetails`: the job and run IDs, action,
        pinned definition, ISO, proxy URL and boot mode. Only a resuming drive resumes; a setup
        always boots fresh. It keeps them as `data`, splits the ActionList into its step lines
        (without the trailing crash and screenshot lines), and answers `true`; the driver loads
        the job before it calls anything else, and nothing in the harness checks that it did.
      - `start()` boots that ISO.
      - `getImage()` takes the guest's screen for the next ask.
      - `ask({ model, reasoning, deadline, signal? })` renders the driving prompt and answers
        the model's turn. The prompt shows the open step's intent and its newest actions,
        newest first, `recentActions` lines in all; earlier steps stay in the harness. The
        model gets the guest's tools, each taking `step` and `reason` beside its own arguments,
        and `Done`; the prompt lists the same tools. All replacements happen once, so a
        definition or model reply containing `{{MODEL}}` stays literal text.
      - `act(turn)` reads the turn as one move, a guest call or done; any other turn is
        `ReplyInvalid`, kept under the open step. A guest call for a step that is not open goes
        through `nextStep` first and runs nothing if it cannot open; then it runs with only its
        own arguments, and its outcome, or the guest's refusal, is kept under its step. Each
        move and refused reply is also recorded whole through `moves.recordMove` (the `moves`
        table: job, step, tool, reason, arguments and outcome; a refused reply has its outcome
        and the step open then, or none). Actions are the QMP exchanges; a move is the tool call
        that made them. A record that fails is returned as the `DatabaseError`, after the move
        ran.
      - `nextStep(step)` ends the open intent and starts the step's, named after its ActionList
        line (`step N` past the list). An end that fails leaves the step open; a start that
        fails opens nothing, and the next `nextStep` starts it again.
      - `finish(end)` saves a setup that succeeded and stops the guest otherwise.
      The loop and its limits are the driver's (section 4). V1's root templates and ticket
      bodies remain until V1 is retired.
- [ ] **Close a drive or setup.** `completeJob` when the driver ran to its end, then queue a
      diagnose job on the same test run; `errorJob` with the reason when the system failed it.
- [ ] **Diagnose.** The diagnosing agent writes its verdict against the drive's job through
      ctrl's verdict tool (`diagnosis.saveDiagnosis`; section 6). Then the drive is
      `finalizeJob`ed, its run `completeRun`s passed or failed, and its suite, when it has one,
      `completeSuite`s once its last run has closed.
- [ ] **Abort.** By job id or by suite id, from the dashboard and the automation server's
      `/abort`. A pending job is `abortJob`ed; a running one is stopped at its automation client
      first.
- [ ] **Restart and shutdown.** At startup, each job the last automation server left running is
      stopped at its client and errored, except a drive or setup whose driver had already finished,
      which is closed as it would have been. At shutdown, each running job is stopped at its client
      and aborted. V1: `packages/jobs/src/reclaim.ts`, and `stopInherited` and `stopAtShutdown` in
      `worker.ts`.
- [ ] **Try again.** An operator's retry, from the dashboard, is a new job on the same test run.

## 4. Apps

The automation server and client have partial implementations; their remaining work is listed
below. Each becomes a V2 app under `v2/apps/`: its entrypoint reads its environment with
`@oligarchy/env`, builds its services with a `createServices` (Sentry among them, handed to its
logger and waited for on exit, as the tester's are), serves Hono behind the `OLIGARCHY_TOKEN`
bearer, and runs under `@oligarchy/app`. Both automation apps keep their lifecycle in
`src/application.ts`; `src/main.ts` supplies the real listener and closes services on exit.

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
      automation server does. Its `/reserve` and `/relinquish` answer as the automation
      client's `src/proxy.ts` reads them: `/reserve` takes `{ job, resume? }` for a drive or
      `{ job, setupServer }` for a setup, and answers 200 reserved, 503 at capacity, 409 setup
      needed, and a 4xx only when it reserved nothing; `/relinquish` takes `{ job }`, and 404 is
      a job it holds no guest for. Once it serves `Routes`, the client's calls move onto
      `@oligarchy/http/client`. A resume reserve that no server can
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
            until the server is killed, waiting `automationServer.dispatchInterval` when no job
            starts; the kill ends the wait at once. A database that cannot be reached does not
            stop it. The loop reserves jobs as described below; `restart` and `shutdown` still
            do nothing.
      - [x] **Forget silent clients.** A sub-app beside dispatch forgets the automation clients
            silent for longer than `automationServer.forgetAfter` (10 minutes), as V1's
            `Sweep.forget` did, so dispatch never reserves on a client that died without deleting
            its row. Its main is a loop that runs until the server is killed: each pass is one
            `fleet.forget` sweep, then a wait of `automationServer.forgetInterval` (30 seconds).
            `fleet.forget` is one sweep and has no loop of its own.
      - [x] **Calls to an automation client.** `AutomationClient.create({ http, url, token,
            signal? })` (`src/automation-client.ts`, V1: `client.ts`) is an
            `@oligarchy/http/client` over the automation client's `Routes`
            (`@oligarchy/automation-client/routes`), made once from the url its row names, with
            `OLIGARCHY_TOKEN` as the token; each call names its `jobId`, and nothing is asked
            again. It sends through `@oligarchy/http` rather than through `hc`, whose `fetch`
            option would lose `@oligarchy/http`'s timeouts and errors; only the routes' types are
            read. Its specs: `/reserve` answers `reserved`, or `at-capacity` (503) or
            `setup-needed` (409), neither a failure; `/run` answers `ended` once the driver or
            opencode has ended, or `aborted` (409) when an abort ended it, and waits as long as a
            timer can (2³¹−1 ms), so only the client or the signal ends it; `/abort` answers
            `stopped`, or `not-held` (404) for a job the client does not hold. Every other answer,
            a route's 501 included, is `@oligarchy/http`'s error. The tests send through
            `@oligarchy/http/testing` to the automation client's own routes, over its fake
            sessions. Open for Restart: a client whose host vanished mid-run leaves its `/run`
            waiting until the signal.
      - [x] **Dispatch: reserve** (section 3's Dispatch, up to the running write;
            `src/dispatch.ts`). The loop calls `startNextJob` again at once after it started a
            job, and waits `dispatchInterval` when it could not. `startNextJob` takes
            `nextPendingJob`, builds its `/reserve` body, and offers it to the live automation
            clients in turn, starting after the one that took the last job. A drive's body names
            its test run's ISO as `resume` only when its definition resumes; a setup's names the
            qemu server whose setup lock it holds; a diagnose's names neither. Each client counts
            its own jobs against its `--max-jobs`: the automation server never sees that number,
            and a full client answers at-capacity. At capacity or setup needed is no error line,
            and the next client is asked; any other failure is an error line naming the client,
            and the next client is asked. The first client to answer reserved has the job moved
            to running with `runJob`, naming that client. A `runJob` the job refuses, usually an
            abort that landed during the reserve, gives the reservation back with the client's
            `/abort`. A database error is one error line. A setup whose lock is gone, because its
            qemu server restarted and cleared its locks (V1: `heartbeat.ts`'s `onJoin`), can
            never be reserved, so it is `abortJob`ed saying so, as V1 errored it. Open: setups
            head the queue, so a setup no client can take holds back every drive behind it until
            it is placed.
      - [ ] **Dispatch: run.** Once the job is running, `/run` sends the prompt, without holding
            the next pass. A drive or setup's driver renders its own prompt (section 3's The
            drive harness).
      - [ ] **Close** (section 3's Close a drive or setup, and Diagnose's finalize) once `/run`
            answers.
      - [ ] **Restart** (section 3's Restart and shutdown, at startup) in `restart`.
      - [ ] **Shutdown** (section 3's Restart and shutdown, at shutdown) in `shutdown`. Today
            it runs as soon as the signal lands, beside a dispatch pass still in flight; decide
            whether it moves to an exit handler of the dispatch sub-app, which runs only once the
            loop has ended and before the services close.
      - [x] **Serve.** `routes.ts` is one chained Hono app behind the `OLIGARCHY_TOKEN` bearer,
            exported as `Routes`; `@oligarchy/http/serve`'s `listen` serves it on 127.0.0.1 at a
            required `--port` through `@hono/node-server`. `main` listens before anything else starts: the started line names
            the address, and a port that cannot be bound is a fatal line and exit 1. On a signal
            the listener closes before `shutdown`.
      - [ ] **`/abort`** (section 3's Abort), by job id or by suite id. The route and its contract
            are in: a body of `{ jobId }` or `{ suiteId }`, each a uuid, never both, since a job
            filed on its own has no suite; anything else is 400 `name a jobId or a suiteId`, and
            the typed client refuses it too. Until this task it answers 501 `abort is not written
            yet`.
- [ ] **automation-client** (`v2/apps/automation-client`). `Sessions` (reserve, run, abort and
      shutdown against `--max-jobs`); spawns `./driver` for a drive or setup and opencode for a
      diagnose (`opencode.ts`), until section 6's diagnosing loop replaces it; announces itself. Serves `/reserve`, `/run` and `/abort`. Done
      when every task below is ticked, roughly in their order.
      - [x] **Skeleton and routes.** `bun run automation-client`. `main` needs `DATABASE_URL`,
            `OLIGARCHY_TOKEN` and a required `--port`, builds its services with Sentry, listens
            on 127.0.0.1 through `@oligarchy/http/serve` (a port that cannot be bound is a fatal
            line and exit 1), says it started, and on SIGINT or SIGTERM closes the listener, says
            it stopped, and closes its services. `routes.ts` is one chained Hono app behind the
            bearer, exported as `Routes` (`@oligarchy/automation-client/routes`) for the
            automation server's client. Each route's body is checked, and `/reserve` and `/run`
            answer 501 until each task hands `routes({ token, sessions })` its `Sessions` function:
            - `/reserve`: `{ jobId, action }`, where a drive may name `resume` (the ISO's url), a
              setup names `setupServer` (the qemu server its setup lock names), and a diagnose
              names neither.
            - `/run`: `{ jobId, prompt }`.
            - `/abort`: `{ jobId }`.

            Handed its function, a route answers what it says: a reserve `reserved` is 200,
            `at-capacity` 503 and `setup-needed` 409; a run `ended` is 200, `aborted` 409 and a
            `RunFailed` 500 naming why; an abort `stopped` is 200 and `not-held` 404. `./testing`
            fakes `Sessions`. The tasks below write the functions.
      - [x] **Announce.** A required `--name` and a required `--url`: a client the automation
            server cannot reach is no client, so one with no `--url` refuses to start (V1's was
            optional, though every script passed it). Once the port is bound, an announce sub-app
            runs `fleet.announce` as `automation-client` under `--url`, with the host's cpu
            sampled between heartbeats, so the automation server's `listLiveServers` finds it;
            its row goes on shutdown, before the services close. The started line names both. A
            port it cannot bind announces nothing. It reports no guests, and no jobs until Reserve
            counts them.
      - [x] **Reserve** (`src/reserve.ts`) against a required `--max-jobs`: a slot for the job,
            and for a drive or setup a guest reserved first at the qemu reverse proxy at a
            required `--server-url` (or `SERVER_URL`), which has no default; a diagnose asks the
            proxy for nothing. At `--max-jobs`, or while another reserve is still asking the
            proxy, it is `AtCapacity` (503) and the proxy is not asked. The reservation is
            `jobs.hold(jobId)`: a second hold of the job is `AlreadyHeld` (400), and one once
            shutdown has begun is `ShuttingDown` (503). The proxy's own refusals are
            `AtCapacity` (503) and `SetupNeeded` (409), errors naming what it said, each letting
            the job go; any other is a
            `ReserveFailed` (500) naming why, and lets the job go too. One that may have landed
            first, anything but a 4xx (an abort or a timeout among them), gives its guest back
            before that. When the held signal aborts before a run takes the job, the reservation
            gives its guest back at the proxy and then calls `release`; a relinquish that fails
            is an error line under the job, and the job is let go all the same. `take(jobId)`
            hands the reservation, its action and its hold to the run, and from then on nothing
            is given back for it. The announce's report counts the jobs held. Calls to the proxy
            are `src/proxy.ts` over `@oligarchy/http`, not `@oligarchy/http/client`, until the
            proxy has `Routes` of its own (see qemu-reverse-proxy).
            Open: a reservation no run takes, because the automation server died between its
            reserve and its run, is held until it is aborted or the client restarts. V1 gave one
            back after ten minutes unused; decide whether Restart aborts it at the client, or the
            client expires it.
      - [ ] **Run.** Takes the job's reservation with `take` and spawns `./driver` for a drive or
            setup or opencode for a diagnose, and answers once it has ended: 200 when it ran to its end,
            409 when an abort ended it, 500 when it failed. It spawns on the held signal: when it
            aborts the child is sent SIGTERM, and SIGKILL after a grace (V1's was 5 seconds).
            Only a child that kill reached answers 409; one that had already exited answers as it
            ended. The run calls `release` once the child is reaped.
      - [x] **Abort.** `src/jobs.ts`, a plain module of the client's own and not a service, holds
            each job it has reserved or is running, in memory only, by an `AbortController`;
            `main` creates it and hands `jobs.abort` to the routes as their `Sessions` abort.
            `jobs.abort({ jobId })` aborts that job's signal with `Aborted` and answers `stopped`
            (200) once the job's holder has called `release`: its run is killed, or its guest
            given back. A job it does not hold is `not-held` (404). Neither abort nor shutdown
            writes a job's status; the client has no `tests` store, and setting a status is left
            to the automation server (section 3's Abort, and Restart and shutdown).
      - [x] **Shutdown.** On SIGINT or SIGTERM `main` closes the listener, which ends the
            connections but not a `/run` still under way, then `jobs.shutdown()` aborts every
            held job and waits until each is let go, before it says it stopped and the services
            close. From the moment shutdown begins, every hold is refused.
- [ ] **driver and harness** (`src/driver`, `src/harness`). The model loop and its stop rule
      (result closed, step limit, model stopped, run ceiling, bad replies in a row), over a
      `DriveHarness` (section 3's The drive harness), which holds the tools, the pointer and
      what the model has been shown, and each step's intent. It creates the OpenRouter client
      with `timeouts.header` from
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
      watched on the board. Rewrite them for V2 as its apps land. `client.md`, `ctrl.md` and
      `ctrl-linear.md` go, since V2 has no `./client` or `./ctrl` to run; `ctrl-diagnose.md` is
      the start of the diagnosing prompt (section 6).
- [ ] **Retire V1.** Delete `apps/`, `packages/` and `src/`, V1's scripts and workspaces in the
      root `package.json`, V1's root `oligarchy.json`, and `LINEAR_*` from every env file, then
      move `v2/` to the root, V2's `oligarchy.json` and its config path with it.

## 6. ctrl, last

`ctrl` is the diagnosing agent's tools and nothing else: a service apps use
(`v2/packages/ctrl`), not a program. V2 has no `ctrl` command line and no `apps/ctrl`, and
`@oligarchy/env` declares none of V1's ctrl or session flags. It goes in steps, one at a time:
the reading tools first, which are done, then the verdict tool, then the diagnosing loop that
hands them to the agent. Nothing past the step under way is written.

- [x] **Step one: the diagnosing agent's evidence** (`v2/packages/ctrl`). V1: `ctrl session --all` and
      `./session image`. The diagnosing agent walks a drive or setup back one screenshot at a
      time. The `logs` store reads it by offset:
      - `logs.getFrame(jobId, frame)` answers frame `frame` of `frames`. Frame 0 is the newest
        screenshot (its PNG, action id and when it was asked for) and runs to the end of the
        job's turn. Each frame after is one screenshot further back, holding everything from it
        until the next. The last frame, `frames - 1`, is everything before the first screenshot
        and has no screenshot. Each frame holds, oldest first, the moves the model made, the QMP
        actions they became, the turn's log lines and the VM's changes, plus the intent open
        when its screenshot was taken. A job's turn runs from when it was queued until its run's
        next job was queued. One repeatable-read snapshot answers the whole frame. A job that
        does not exist is `NotFound`. A frame it does not have is `NoFrame`, naming how many it
        has.
      - `logs.getDebugLog(jobId)` answers what the qemu server saved: serial console, journal,
        proxy and the rest. A job with none saved is `NotFound`.
      The `ctrl` service is the per-job state over them, made with `create({ logs }, { jobId })`.
      `moreData()` answers the next frame back, starting at 0. It advances only when the store
      answered, so a failed read is asked again; past the oldest frame it stays at `NoFrame`.
      `debugLogs()` answers the job's debug log. These replace the first cut's `getEvidence`,
      `getImage`, `logs.listJobLogs` and `debugLogs.getDebugLog`.
- [x] **No ctrl or session flags in env.** `v2/packages/env/src/args.ts` drops every flag only
      a ctrl or session command line took: V1's `--agent-id`, `--session-id` (and `SESSION_ID`)
      and `--test-result-id`; `./session image`'s `--output` and `--image-id`; and ctrl's
      `--list`, `--details`, `--history`, `--name` (a definition's), `--description`,
      `--instruction`, `--proof`, `--iso`, `--setup-only`, `--model`, `--id`, `--status`,
      `--reason`, `--count`, `--active`, `--json`, `--search`, `--logs`, `--test-def`,
      `--test-results`, `--test-run`, `--actions`, `--images`, `--debug-logs`, `--diagnosis`,
      `--all`, `--key`, `--verdict`, `--type` and `--summary`. env's tests read a program of the
      flags that remain.
- [ ] **Step two: the verdict tool.** ctrl's tool beside `moreData` and `debugLogs` that ends a
      diagnosis: the job's verdict, passed or failed, and for a failure its error type and what
      happened, written with `diagnosis.saveDiagnosis` (section 3's Diagnose). V1:
      `ctrl diagnose`, with `error-type list` and `error-type new` for the types. Open: how the
      agent reads and adds error types, which in V1 were their own commands.
- [ ] **Step three: the diagnosing loop.** Not started until step two is in. What runs a
      diagnose job: the model loop that hands the agent ctrl's tools as native tool calls, as the
      driver hands the model the harness's, and the diagnosing prompt, from V1's
      `ctrl-diagnose.md`. It replaces V1's opencode running `./ctrl` and `./session image`, so the
      automation client's diagnose runs it rather than opencode.
- [ ] **Not in ctrl.** V1's other ctrl commands are not ctrl's in V2, and none is a command
      line: `test run` (a test run on its own), `test suite` (a suite of every definition but
      `setup`), `setup` (a setup on each server, section 3's File), `test define`, `details`,
      `list`, `start`, `test-results`, `session`, `error-type` and `automation`. Open: what files
      a lone test run, a suite or a setup for an operator, now that the dashboard is the only
      caller named; and whether anything still needs a shell to do it.

## Not coming over

- Linear: the service, the board and its columns, the `ready` label, the webhook, the ticket
  templates and `LINEAR_*`.
- Sessions: `SessionStore`, `agent_runs`, and routing by session or agent, which `routeJob` and
  `serverForJob` replace.
- `./client`: `src/client`, its wrapper, `client.md`, and the driver's one `client` tool.
  qemu-http-tools replaces them.
- `./ctrl` as a program: V1's `apps/ctrl`, its `./ctrl` wrapper, `ctrl.md`, `ctrl-linear.md`
  and `./session image`. ctrl is a service (section 6).
- `Database.ping`.
- The shared HTTP API package: V1's contract, middleware, `serve` and wire errors. Each app's Hono
  routes are its contract.
- V1's shared fakes in `packages/testing`: each V2 package ships its own.
- V1's schemas in `packages/shared/src/domain.ts`: the enums in V2's schema are the types.
