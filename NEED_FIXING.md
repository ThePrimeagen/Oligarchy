# Need fixing

Findings from a full read of `src/` (every file), the tooling, the wrappers, CI and the migrations,
against the conventions in `development.md`. Nothing here is a test failure: `npm run check:fast` is
green under Node 26.8.2 (lint, format, types, 1334 unit tests), `npm run test:integration` passes
what runs without Docker and QEMU (134 passed, 182 skipped), and `drizzle-kit check` plus a dry
`db:generate` show `src/db/schema.ts` in sync with `drizzle/`. Each item names the files, what is
wrong, and the fix; the order is by impact. Every item is a tests-first change, as `development.md`
asks: the failing unit test comes before the code.

## 1. One non-503 reserve failure fails a drive for good, and the board cannot retry it

Three decisions, each defended on its own, together make the queue fragile.

- `src/automation-server/worker.ts`, `place`: iterating the live clients, a `/reserve` answer other
  than 503 does `return yield* Effect.fail(reserved.failure)`, so the job closes `failed` without
  the remaining clients being asked. Pinned by `test/automation-server/worker.unit.test.ts`
  ("an unreachable client marks the job failed"). The reverse proxy's `reserve` skips a server
  whose probe fails and asks the next; the worker should do the same for a client that is
  unreachable or answers 5xx, and close the job `failed` only when every client refused.
- `src/db/schema.ts` `automation_jobs` has `uniqueIndex(result_id, action)`, and
  `src/automation-server/handlers.ts` turns the duplicate-key `DatabaseError` into
  `linear webhook ignored; drive already queued`. Moving a ticket back into *Automation Needed*
  after a failed drive therefore logs "already queued" for a job that is terminal and never
  enqueues another. A failed drive cannot be rerun from the board. Either allow a new row when the
  existing one is terminal (drop the unique index in favour of "one non-terminal job per
  (result, action)", enforced in `enqueue`), or at least make the log line say the job already
  finished and why.
- `src/automation-client/main.ts` reads `SERVER_URL` with
  `EffectConfig.string("SERVER_URL").pipe(Effect.orElseSucceed(() => Config.DEFAULT_SERVER_URL))`.
  A client started without it silently reserves guests at `http://127.0.0.1:42069`; every drive
  `/reserve` becomes `ProxyUnreachable → Internal (500)`, which the worker treats as a hard
  failure, so one misconfigured client burns every drive dispatched to it. This is also the one
  process that reads a variable outside `packages/env/src/config.ts` (`Config.serverUrl` already exists), and
  `development.md` says configuration is never a silent optional. Make it a required
  `--server-url` flag with `Flag.withFallbackConfig(Config.serverUrl)` and no default, reported at
  startup like `--max-jobs` and `--name`.

## 2. Automation server shutdown records `aborted` for jobs the client keeps running

`src/automation-server/worker.ts` on interrupt writes `status: "aborted"`, reason
`automation server shutting down` (pinned by "closing the scope mid-request aborts the job"),
while `src/automation-client/handlers.ts` marks `/run` uninterruptible and its test pins
"a dropped POST /run leaves the driver running until POST /abort stops it". After a server restart
the row says aborted, ./driver keeps driving, the client's `--max-jobs` slot stays held, and the
driver may still close the result. The worker comment "the HTTP wait is restored so SIGTERM
aborts an in-flight job" describes the wait being aborted, not the job. Either POST `/abort` to
the client before closing the row (best effort, one log line when it fails), or record a distinct
reason (`orphaned by shutdown`) so the queue does not claim the run was stopped.

## 3. `src/automation-client/qemu.ts` discards the real cause

`Errors.Internal.make({ cause: new Error(error.message), agentId })` wraps a proper
`ProxyRefusal`/`ProxyUnreachable` in a bare `Error`, dropping its own `cause` (the
`connect ECONNREFUSED …` the boundary's `Internal` log line exists to surface through
`causeOf`). `relinquish`'s timeout does the same. Pass `cause: error`, and for the timeout raise a
typed error with the message. These are two of the ten `new Error(` sites outside the allow-list in
`development.md` (`CliError.UserError`, `HttpClientError.*`, `pg.Pool`, `pg.Client`); the others
are `Effect.die` payloads for invariants and the `cause` of a `CliError.UserError`, which are
defensible but should be decided once and written down.

## 4. Two adjacent gaps in `src/qemu-reverse-proxy/router.ts`

- `reserve`: a server whose probe fails is skipped with a warning, but a server that dies between
  the probe and `askToReserve` fails the whole reserve with 502 instead of the next ranked server
  being asked. Treat a `ServerFailed` from `askToReserve` as a skip too, logged the same way, and
  answer `NoServer` only when none was placed.
- `commitStart`: `clearAgent` failing after `routeSession` succeeded answers 500 although the
  session is running and routed, so the driver never learns its id and the machine runs until the
  ten-minute sweep. The `routeSession` failure is an acknowledged trade-off
  (`test/qemu-reverse-proxy/http.unit.test.ts`, "a route that cannot be recorded is 500"); this
  branch is not, and the route is already the source of truth: log the stale `agent_servers` row
  and return the 200 with the id.

## 5. The CI append-only guard has a live bypass

`.github/workflows/migrations.yml`, job `append-only`: the one-shot for collapsing the chain to a
single `0001_init` (`head_sql -eq 1 && base_sql -gt 1`) is still active although master has been
at that baseline for twelve migrations, so a pull request that deletes `drizzle/` down to one file
passes. The other one-shot names `0012_adorable_deathbird.sql`, `0013_odd_slipstream.sql` and
`0014_flimsy_ironclad.sql`, files that no longer exist, and is dead. Remove both;
`test/repo/scripts.unit.test.ts` can pin that the workflow contains no `append-only skipped` path.

## 6. `src/db/migrate.ts` prints nothing for a layer failure

Every other entry applies `Render.reportFailure` outside `Effect.provide(MainLive)` so a layer
failure (an unreadable `.env`, a defect from `Config.live`) prints its cause. Here
`Layer.build(MainLive)` is unwrapped and `Console.error(Render.renderFailure(cause))` sits inside
the provided program, so `npm run db:migrate` with an unreadable `.env` exits 1 with nothing on
stderr under `disableErrorReporting`. It also prints an empty line on interrupt, where
`Render.reportFailure` prints nothing. Use `Render.reportFailure` around the build as
`src/qemu-server/main.ts` does.

## 7. Classification by message in `src/automation-server/handlers.ts`

`isDuplicateJob` is `String(error.cause).includes("duplicate key")`. `development.md` asks for
structured classification; pg exposes the unique-violation code as `code === "23505"`, which does
not depend on the driver's wording. Decode it with a `Schema.Struct({ code: Schema.Literal("23505") })`
probe on the cause (the same shape `packages/log/src/external-failure.ts` uses) and update
`test/support/stores.ts`, whose fake builds the error with the message alone.

## 8. Convention drifts, one line each

- `Record<string, unknown>` (forbidden by `development.md`) in `src/observability/sentry.ts`
  (`tag`) and `src/ctrl/linear.ts` (`variables`).
- `src/shared/process-usage.ts` wraps `collect` in `Effect.withSpan`; every other service method is
  `Effect.fn("Service.method")`.
- `src/db/logs.ts` `listLogs` orders by `created_at, id`; `development.md` says `id`, not
  `created_at`, orders rows.
- `src/qemu-server/handlers.ts` marks `serial` and `image` uninterruptible; `development.md` says
  reads and streams are interruptible and only handlers that drive a resource are not. `serial` is
  a file read.
- `src/db/schema.ts` `SessionConfig` has no `readonly` fields, and the `logs` table comment omits
  the `automation-client` location bucket `packages/log/src/log.ts` added.
- `MAX_CLICKS = 100` in `src/qemu-server/sessions.ts` is repeated as the literal `100` in
  `src/client/flags.ts` (`clicks`), so the flag and the server can drift.
- `packages/routes/src/api.ts` `unregister` declares `Errors.NotFoundWire` on the endpoint while its group's
  `RouteBoundary` already declares it; one of the two is redundant.

## 9. Duplication that will drift

`development.md` resists abstraction bought early, but these are copies of the same non-trivial
logic in files that change independently:

- The `DatabaseError`-unwrapping `detail` helper is copied verbatim in `src/qemu-server/sessions.ts`,
  `src/qemu-server/heartbeat.ts`, `src/automation-client/heartbeat.ts`, `src/shared/stale-servers.ts`
  and `src/automation-server/worker.ts`; `describeThrowable(causeOf(e), errorDetail(e))` in
  `src/automation-client/child.ts`, `src/qemu/process.ts`, `src/qemu/iso.ts` and `src/viz/run.ts`. Both belong in
  `packages/log/src/external-failure.ts` beside `causeOf`.
- `src/qemu-server/heartbeat.ts` and `src/automation-client/heartbeat.ts` differ only in the
  `type`, the location and how `jobs`/`stats` are read; one `announce` taking those would keep a fix
  in one from missing the other.
- `src/ctrl/prompts.ts` and `src/automation-server/prompts.ts` repeat `read`, `fill` and `render`.
- `src/automation-server/client.ts` repeats the same twelve-line `HttpClientError` catch in
  `reserve`, `run` and `abort`; one `run(label, effect)` as `src/client/proxy-client.ts` has is
  what `development.md` prescribes for a client.

## 10. Job transitions and searches are spread over four processes, and nothing finds what drifted

A job is a test result and its Linear ticket; they are supposed to move together. Today the code
that moves them is in four processes, each with its own copy of the rule, and none of them looks
for the cases where the two halves have come apart. `monorepo-plan.md` makes a `jobs` package the
one owner of every transition and every search (phase 8); this item is what that package should
grow into once it exists, and what it prevents.

- **Where the transitions are today.** Create: `src/ctrl/command.ts` (`openRun`) and
  `src/qemu-reverse-proxy/setup.ts` (the mint ticket). Close, fail, error: `src/automation-server/worker.ts`
  (`closeJob`, `reportErrored`, `reportDiagnosis`, `moveTicket`), each with its own "retry twice,
  then a line" policy. Ready: `src/automation-server/ready.ts`, with a different policy again.
  Which board column means which action: three copies, `src/automation-server/backlog.ts`,
  `enqueue.ts` and `webhook.ts`. Abort: split between the dashboard, which moves the ticket to
  Aborted with its own hand-rolled Linear client (`src/dashboard/linear.ts`), and
  automation-server's `POST /abort`, which closes the row. Two processes, two clients, one job.
- **Where the searches are today.** `worker.ts` (`diagnosable`, `isOpen`, `nextPending` with a
  skip list, `listRunning` at startup), `backlog.ts` (`findResultByLinearId`, `jobStatus`,
  `hasPending`), `handlers.ts` (the abort lookup), `src/dashboard/query.ts` (its own read model
  over the same tables). Each decides for itself what "a job with a pending drive" means.
- **What drifts, and nobody looks.** `moveTicket` gives a ticket three attempts and then one log
  line: the row is closed, the ticket stays in the wrong column for good, and no later pass
  notices. A ticket a person drags on the board is invisible to the row until the next webhook
  or poll happens to cover that column. An action row is `running` for a server that died until
  the *next* automation server starts and runs `closeInherited`; if none starts, it is running
  forever. A ticket in *Automation Needed* whose action row was aborted stays there. None of these
  is a bug in one file; each is the absence of a search.
- **The fix, in two steps.** First, the `jobs` package as planned: `open`, `openMint`, `close`,
  `fail`, `ready`, `release`, `actionFor`, `enqueue`, `abort`, `find` (`byTicket`, `nextPending`,
  `running`, `inherited`, `status`, `hasPending`, `isDiagnosable`) and `reclaim`, with one retry
  policy and one `detail` helper, so every process moves a job the same way and the apps stop
  querying stores for jobs. Second, on top of that, `Jobs.reconcile()`: a search for row-and-ticket
  pairs whose states disagree (a closed row under a working-column ticket, an Errored ticket over
  a pending row, a `running` action for a server no longer in `servers`, a working-column ticket
  with no open action), and one transition per case that settles it the same way `close` and
  `fail` do. The automation server schedules it, the way it schedules the board watch; `ctrl`
  gets a `jobs reconcile --dry-run` that lists what would move. Not for the split itself; it is
  the first thing to build once `jobs` exists, because it is the point of having one place.

## Checked and sound

Recorded so the next reviewer does not redo them.

- `Effect.catchCause` in the heartbeat and sweep ticks: probed against rc.112, an external
  `Fiber.interrupt` does not reach `catchCause` (the interrupted fiber runs finalizers only), so
  no spurious `heartbeat failed` line at shutdown; the `Cause.hasInterruptsOnly` guards are rightly
  reserved for joins of interrupted children.
- `Effect.timeoutOrElse` inside the uninterruptible `save` handler: `raceAllFirst` forks its
  children interruptible whatever the parent, so the two-minute power-off bound fires.
- The Sentry reporter's `error.name === LogErrors.LogLine.identifier`: `Schema.TaggedError` sets
  `name` to the identifier.
- `Command.provide` applied before `Command.withSubcommands` wraps the parent's handler only, so
  `ctrl test run` builds one pool.
- The `Sessions` slot accounting (`reserve`, `failStart`, `finishLiveSession`, `relinquish`, the
  sweep) balances on every path; `finishLiveSession` runs exactly once per admitted session.
- `src/qemu-server/main.ts` binds the port before `Sessions` exists, as its comment says; the
  automation server and client override `ProcessAttribution`; `Log` sits above `Database` in every
  graph so the flush precedes the pool close.
- The dashboard's `deleteOldRows` deletes in an order that respects every foreign key.
