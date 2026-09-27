# Replacing Effect: building blocks left

Effect is in 263 files on master: 129 production files, about 26k lines, and 134 test files, about
64k lines. v2 already has `jarl`, `@oligarchy/env`, `@oligarchy/async` (`repeat`, `tick`, `sleep`)
and `@oligarchy/app`. What follows is each building block still missing, what it must do, and who
needs it. Programs (driver, ctrl, the servers) are built from these and are not listed.

## @oligarchy/app

- [x] `app.signal`, one `AbortSignal` owned by the app, aborted on the first signal and when `main`
      returns (#263). Every operation that can hang takes it per call, `{ signal }`, the way
      `fetch` does, because services are built before the app exists.
- [x] On a signal: abort, wait for `main` to settle, then run the exit handlers newest first (#263).
- [x] `Aborted`, the signal's reason: after a signal, `main` returning or throwing it exits 0 (#263).
      The log and Sentry must not count it as a failure; that is theirs, below.
- [x] `Has<T>` exposes `signal`, so a helper can pass it on (#263).
- [x] A server's `main` waits for exit by waiting on `app.signal`.
- [x] A deadline for each exit handler: they run after the signal aborts, so a handler that sends a
      request wraps it in `timeout` from `@oligarchy/async` with no signal (#264).
- [x] SIGHUP ends the app like SIGINT and SIGTERM, instead of killing it before any handler runs
      (#265).
- [x] Flushing is not the app's: whatever writes (the log, stdout for a piped PNG) registers its
      own `app.onExit` and flushes there.
- [ ] An exported fake `Io` for tests, and stderr through `Io` rather than `console.error`.

## @oligarchy/async

A signal is the one way to stop any of them. Their timers are `setTimeout`, so vitest's fake timers
drive them in a test (`advanceTimersByTimeAsync`); `AbortSignal.timeout` is not used, because fake
timers cannot drive it. There is no mutex: `tick` never runs two calls at once, and anything else
that must not run twice keeps a flag.

- [x] `tick(fn, interval, signal)`: awaits `fn`, spaces calls from the end of the last one, keeps
      going after a throw, and settles once the signal aborts and the call in flight returns (#264).
- [x] `sleep(ms, signal)`: ok after `ms`, `Aborted` as soon as the signal aborts (#264).
- [x] `timeout(fn, { ms, signal })`: `fn`'s signal aborts at the deadline or with the caller's; the
      answer is `fn`'s, or `TimedOut` for an `fn` still running (#264).
- [x] `repeat(fn, count, { errorFilter, delay, signal })`: Linear reads retry once, two seconds
      later, only while `retryable` (#264).
- [x] `Aborted` and `TimedOut` live here; the app's signal carries this `Aborted` (#264).
- [ ] `singleFlight`: callers share one lookup, and a failure is not kept, so the next caller tries
      again (Linear's ready-label id, an ISO download).
- [ ] `channel(capacity)`: an async iterable that drops a subscriber who falls behind (the follow
      stream drops at 64).
- [ ] `deferred()`, since `lib` is ES2023 and has no `Promise.withResolvers`.

## Resources and failures

- [ ] `esnext.disposable` in `lib`, for `AsyncDisposableStack`. Bun 1.4.2 runs it newest first,
      runs every cleanup when one throws, and a second dispose does nothing.
- [ ] A dispose shared by every caller, so a stop, a sweep, a save and a drain racing on one session
      get one teardown.
- [ ] A failure renderer in place of `Cause.pretty`: the headline, then the cause chain.
- [ ] A rule for bugs versus refusals. `Errors.keep` turns any throw into `Unexpected`, so a path
      that logs a failure and goes on would swallow a bug.
- [ ] Every Effect that is retried or re-run becomes a function called each time. A promise runs
      once, and a retry would get the first answer back again. About 13 service members are values
      today (`Linear.teamId`, `Database.ping`, `Host.collect`, `Member.report`, ...).

## @oligarchy/shared

- [ ] Domain schemas, QMP and follow codecs in zod, about 300 lines. `FollowEvent` repeats a
      discriminator, so it is a `z.union`; encoding keeps the key order the tests pin; `z.uuid()`
      is stricter than Effect's check; `is(schema)` stands in for `Schema.is`.
- [ ] Errors with fields through `jarl.error.define`.

## @oligarchy/env

- [ ] `Env.Result` and `Env.Vars`.
- [ ] A variable read only when needed: `ctrl mint` needs `OLIGARCHY_TOKEN` only with
      `--unminted`, viz reads `AUTOMATION_SERVER_URL` only when `a` is pressed.
- [ ] `oligarchy.json` loaded only by a command that asks for it; today a bad file stops ctrl and
      viz, which never read it.
- [ ] `source.values`, the record a test or the dashboard hands in.
- [ ] `colors`, the port of `wantsColor`.
- [ ] `ROOT`, the repo root as the driver's bundle sees it, for `client.md` and `prompts/`.
- [ ] An entry with no `node:*` import, for the dashboard Worker.
- [ ] A runner: help and usage printed once, a failure printed once, the ENOSPC listeners on stdout
      and stderr.
- [ ] A parser over any argv, so the driver checks a model's `client` call against the declarations.
- [ ] A decision on the command line. v2 runs only leaf commands, inherits flags, wants words first,
      and has no short or repeated flags. Today `ctrl test`, `test run` and `session` run and
      route; `session list --session-id` is refused; the prod-run skill runs
      `./ctrl --env-file .prod-env test run testsuite`; `client` takes `-o` and `--modifier` more
      than once. Either the parser grows, or the command lines change with `ctrl.md`, `client.md`,
      the skills and the ticket templates.

## Services

- [ ] `@oligarchy/log`: `info`, `warning`, `error`, `fatal`, `flush`; `location` and `agentId`;
      `skipSentry`; the palette. The row sink is one promise chain, and `flush` is its tail. The
      log registers `flush` with `app.onExit` itself, and waits for stdout to take the last line.
- [ ] `@oligarchy/sentry`: `report(error, { level, tags, extra })` and an ignore mark. The session,
      intent and action spans on `startInactiveSpan`, each a root, and a parent that ends ends its
      open children. `@sentry/effect` goes.
- [ ] `@oligarchy/db`: `create(url)` with `run`, `transaction`, `ping`, `close`. A transaction rolls
      back on a refusal and still returns it. The ten stores, about 120 operations, and `migrate`.
- [ ] `@oligarchy/linear`: `fetch` with a 10 s timeout that aborts the request, `retryable`, the
      one ready-label lookup, and requests sent one after another as today (`jarl.all` would send
      them at once and change the order the tests pin).
- [ ] `@oligarchy/openrouter`: the event stream parsed as it arrives; a headers timeout and a chunk
      timeout, the chunk timer reset by an event, not a byte; `retry-after` only when it fits the
      run ceiling; an abort never reported as unreachable.
- [ ] `@oligarchy/process`: spawn; kill sends SIGTERM, then SIGKILL after a bound, and resolves once
      the child is dead; a stderr tail decoded across chunks; exit with a grace for stderr; detached
      and unref'd; an abort kills.
- [ ] `@oligarchy/http` contract: a zod table of the 26 endpoints (static paths, query or JSON
      body), the 16 errors and their statuses, `{ "error": ... }`, `{ "ok": "true" }`.
- [ ] `@oligarchy/http` server on `node:http`, not `Bun.serve`: its default idle timeout closed a
      12 s request at 10 s, and `/start` takes up to 45 minutes, `/run` has no bound and `/follow`
      never ends. Bearer, one log line per failed request, the 404 catch-all, a raw-body route (the
      Linear webhook), a streamed NDJSON answer, a disconnect policy per route, bind before ready,
      and a stop that waits for the handlers that must finish.
- [ ] `@oligarchy/http` client: `call()` that names a refusal (`status`, `message`) or an
      unreachable server, a typed function per endpoint, `follow()` as a stream, and the proxy's
      pass-through that streams and cancels upstream.
- [ ] `@oligarchy/common`: `load`, `close` (log, then Sentry, then the database), `report`,
      `heartbeat` (at once, then every 30 s, a write in flight finishes before the row goes).

## Tests

- [x] Stepping time: vitest's fake timers with `advanceTimersByTimeAsync`, which also runs what the
      timers wake (#264).
- [ ] `track(promise)`, to ask whether it has settled (in `async/test/support.ts` today, #264);
      `expectErr(result, Error)`; `unexpected(name)`, the member a fake does not expect. Shared once
      a second package needs them.
- [ ] A fake `fetch`: a script, a recorder, an app answering in process, one that never answers.
- [ ] A fake spawner: exit, stdout and stderr scripted, a child that ignores SIGTERM, the kill
      escalation, `unref`, and the next spawn to wait for.
- [ ] Plain fakes of the ten stores, of Linear and of the log.
- [ ] stdout and stderr captured through `Io`.

## Tooling

- [ ] CI runs v2's types and tests. Today only root lint and format see `v2/`, and
      `scripts.unit.test.ts` keeps `v2/` out of `migrations.yml`, so it is a workflow of its own.
- [ ] Lint for `v2/AGENTS.md`: no private members, no classes except `App`.
- [ ] A type-aware check for a dropped Result, in place of `effecttsgo/floating-effect`.
- [ ] Once the last Effect file goes: the sixteen `effecttsgo/*` rules, `effect-tsgo patch`,
      `@effect/tsgo`, the language-service plugin, and the Effect rules in
      `test/repo/architecture.unit.test.ts`. "Timers only at a boundary" becomes "timers only in
      `@oligarchy/async`".
