# Need fixing

Findings from a full read of `src/` (every file), the tooling, the wrappers, CI and the migrations,
against the conventions in `development.md`. Nothing here but item 11, found later with Docker
present, is a test failure: `npm run check:fast` is
green under Node 26.8.2 (lint, format, types, 1334 unit tests), `npm run test:integration` passes
what runs without Docker and QEMU (134 passed, 182 skipped), and `drizzle-kit check` plus a dry
`db:generate` show `packages/db/src/schema.ts` in sync with `packages/db/drizzle/`. Each item names the files, what is
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
- `packages/db/src/schema.ts` `automation_jobs` has `uniqueIndex(result_id, action)`, and
  `packages/jobs/src/board.ts` (`Board.enqueue`) turns the duplicate-key `DatabaseError` into a
  duplicate named by the status of the row the index kept, which
  `src/automation-server/handlers.ts` still logs as `linear webhook ignored; drive already queued`.
  Moving a ticket back into *Automation Needed* after a failed drive therefore logs that line for
  a job that is terminal and never enqueues another. A failed drive cannot be rerun from the
  board. Allow a new row when the existing one is terminal (drop the unique index in favour of
  "one non-terminal job per (result, action)", enforced in `Board.enqueue`).
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

Fixed in the monorepo's phase 5: the workflow diffs `packages/db/drizzle/` without rename
detection and both one-shot skip paths are gone; `test/repo/scripts.unit.test.ts` pins that no
`append-only skipped` path remains.

## 6. `packages/db/src/migrate.ts` prints nothing for a layer failure

Fixed in the monorepo's phase 4: the entry runs through `Env.run`, with `Render.reportFailure`
outside `Layer.build(Config.live)`, so an unreadable `.env` prints its cause and an interrupt
prints nothing.

## 7. Classification by message in `packages/jobs/src/board.ts`

`isDuplicate` (automation-server's `isDuplicateJob` until phase 8) is
`String(error.cause).includes("duplicate key")`. `development.md` asks for structured
classification; pg exposes the unique-violation code as `code === "23505"`, which does not depend
on the driver's wording. Decode it with a `Schema.Struct({ code: Schema.Literal("23505") })` probe
on the cause (the same shape `packages/log/src/external-failure.ts` uses) and update
`packages/testing/src/stores.ts`, whose fake builds the error with the message alone.

## 8. Convention drifts, one line each

- `Record<string, unknown>` (forbidden by `development.md`) in `packages/observability/src/sentry.ts`
  (`tag`) and `packages/linear/src/client.ts` (`variables`).
- `src/shared/process-usage.ts` wraps `collect` in `Effect.withSpan`; every other service method is
  `Effect.fn("Service.method")`.
- `packages/db/src/logs.ts` `listLogs` orders by `created_at, id`; `development.md` says `id`, not
  `created_at`, orders rows.
- `src/qemu-server/handlers.ts` marks `serial` and `image` uninterruptible; `development.md` says
  reads and streams are interruptible and only handlers that drive a resource are not. `serial` is
  a file read.
- `packages/db/src/schema.ts` `SessionConfig` has no `readonly` fields, and the `logs` table comment omits
  the `automation-client` location bucket `packages/log/src/log.ts` added.
- `MAX_CLICKS = 100` in `src/qemu-server/sessions.ts` is repeated as the literal `100` in
  `src/client/flags.ts` (`clicks`), so the flag and the server can drift.
- `packages/routes/src/api.ts` `unregister` declares `Errors.NotFoundWire` on the endpoint while its group's
  `RouteBoundary` already declares it; one of the two is redundant.

## 9. Duplication that will drift

`development.md` resists abstraction bought early, but these are copies of the same non-trivial
logic in files that change independently:

- The `DatabaseError`-unwrapping `detail` helper is copied verbatim in `src/qemu-server/sessions.ts`,
  `src/qemu-server/heartbeat.ts`, `src/automation-client/heartbeat.ts` and `src/shared/stale-servers.ts`
  (automation-server's copy became `packages/jobs/src/errors.ts` `detail` in phase 8, and its
  callers use that); `describeThrowable(causeOf(e), errorDetail(e))` in
  `src/automation-client/child.ts`, `src/qemu/process.ts`, `src/qemu/iso.ts` and `src/viz/run.ts`. Both belong in
  `packages/log/src/external-failure.ts` beside `causeOf`.
- `src/qemu-server/heartbeat.ts` and `src/automation-client/heartbeat.ts` differ only in the
  `type`, the location and how `jobs`/`stats` are read; one `announce` taking those would keep a fix
  in one from missing the other.
- `packages/jobs/src/templates.ts` (`src/ctrl/prompts.ts` until phase 8) and
  `src/automation-server/prompts.ts` repeat `read`, `fill` and `render`.
- `src/automation-server/client.ts` repeats the same twelve-line `HttpClientError` catch in
  `reserve`, `run` and `abort`; one `run(label, effect)` as `src/client/proxy-client.ts` has is
  what `development.md` prescribes for a client.

## 10. Job transitions and searches are spread over four processes, and nothing finds what drifted

A job is a test result and its Linear ticket; they are supposed to move together. Until phase 8
the code that moved them was in four processes, each with its own copy of the rule, and none of
them looked for the cases where the two halves have come apart. Phase 8 made `@oligarchy/jobs`
the one owner of the transitions and searches the automation server, `ctrl` and the proxy use;
this item is what is left outside it, and what that package should grow into.

- **Where the transitions are.** `packages/jobs/src/`: `open.ts` (`open`, `openMint`, `failRun`),
  `close.ts` (`close`, `fail`, `judge`, `moveTicket`, one "three attempts, then a line" policy),
  `ready.ts` (`mark`, `release`), `board.ts` (`actionFor`, `asks`, `enqueue`), `abort.ts` and
  `reclaim.ts`. What is still outside: the dashboard's `POST /suites/abort`
  (`src/dashboard/dashboard.tsx`) aborts a suite's pending rows through `src/dashboard/query.ts`
  and moves each ticket to Aborted with its own `Linear` layer, instead of asking the automation
  server to call `Abort.abort` per job. The dashboard's `POST /abort` only forwards since phase 8.
- **Where the searches are.** `packages/jobs/src/find.ts` (`byTicket`, `ofAction`,
  `nextPending`, `running`, `inherited`, `status`, `hasPending`, `diagnosable`, `isOpen`).
  `src/dashboard/query.ts` keeps its own read model over the same tables, and its suite abort
  decides for itself which rows are still open.
- **What drifts, and nobody looks.** `moveTicket` gives a ticket three attempts and then one log
  line: the row is closed, the ticket stays in the wrong column for good, and no later pass
  notices. A ticket a person drags on the board is invisible to the row until the next webhook
  or poll happens to cover that column. An action row is `running` for a server that died until
  the *next* automation server starts and runs `Reclaim.reclaim`; if none starts, it is running
  forever. A ticket in *Automation Needed* whose action row was aborted stays there. None of these
  is a bug in one file; each is the absence of a search.
- **The fix, in two steps.** The first, the `jobs` package, landed in phase 8, apart from the
  suite abort above. The second, on top of it, is `Jobs.reconcile()`: a search for row-and-ticket
  pairs whose states disagree (a closed row under a working-column ticket, an Errored ticket over
  a pending row, a `running` action for a server no longer in `servers`, a working-column ticket
  with no open action), and one transition per case that settles it the same way `close` and
  `fail` do. The automation server schedules it, the way it schedules the board watch; `ctrl`
  gets a `jobs reconcile --dry-run` that lists what would move. Not for the split itself; it is
  the first thing to build once `jobs` exists, because it is the point of having one place.

## 11. Two integration tests fail with Docker present, on master too

Found running the lane with `OLIGARCHY_REQUIRE_DATABASE=1` during phase 8; both fail the same way
on `master`, so neither is the phase's.

- `test/integration/dashboard.integration.test.ts`, "reads one name's verdicts, durations and
  per-wording tallies": the seed inserts four results for one (run, definition), which the unique
  index `test_results_run_definition_idx` refuses (`23505`), so the child process prints the
  insert failure and the test fails on its empty-stderr assertion. Give each result of the same
  wording its own run.
- `test/integration/automation-client.integration.test.ts`, "SIGTERM stops a running driver and
  the client exits": it sends `POST /run` before it waits for the listen line, so the request can
  reach a closed port, its rejection is swallowed, and the driver never starts ("driver did not
  start" after ten seconds). Send `/run` after `/reserve` answers, as every other `/run` in that
  file does.

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
