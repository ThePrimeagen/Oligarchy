# Development

How v2 is written. v2 is the workspace under `v2/`. It does not use Effect. [jarl](https://github.com/ThePrimeagen/jarl) is the result, and `@oligarchy/async` is the lifetime: the clock, the retry, the tick and the close. The root `development.md` is v1 and does not apply here. This file does not restate jarl; the API is `v2/node_modules/jarl/index.ts` at the commit `v2/bun.lock` pins, and a name that is not there does not exist.

v1 stays as it is while a process is moved. A v2 package does not import `effect`, `@effect/*` or a v1 package, and a v1 package does not import v2.

## Toolchain

- Bun 1.4, same as v1, runtime and package manager. v2 is its own workspace: install with `bun install` from `v2/`, lockfile `v2/bun.lock`. `v2/bunfig.toml` sets `linker = "isolated"`, so a package resolves only what its own `package.json` names.
- A version two packages share (`jarl`, `zod`, `typescript`, `vitest`, `@types/node`) is named once in `v2/package.json`'s `workspaces.catalog` and each package says `"catalog:"`. One `jarl` across the workspace: two copies would be two `error.define` bases.
- Packages today: `@oligarchy/env` (what a process is given from outside), `@oligarchy/async` (this document's lifetime), `@oligarchy/driver` (the first app, flags only). A package is source-first: `exports` point at `.ts`, no build step, no `dist`.
- `bun run --cwd v2 check:types` and `bun run --cwd v2 test:unit` run every package's lane. Tests are vitest, `*.test.ts` under the package's `test/`. `passWithNoTests` is false.
- `erasableSyntaxOnly` stays on. Classes are for jarl errors, `Secret`, and a latch. No enums, no namespaces, no parameter properties.
- The root `check:lint` and `check:format` walk the whole tree, v2 included, under the same oxlint and oxfmt rules as v1. The `effecttsgo` rules stay quiet here because nothing imports Effect.

## What jarl keeps

A function that can fail returns `Promise<Result<Value, Error>>`. `fn` wraps a body that throws and maps the throw into the error channel, so a rejection does not escape. `pipe` feeds the last value into the next step and unions every step's error; a failure skips the rest. `error.define` names an error class so it stays in that union even with no fields of its own. `error.is` removes the error you handled. `value` accepts the result only once the error type is `never`. `unwrap` throws what is left. `ok`, `err`, `is_ok`, `is_err`, `or_else` and `parseJSON` are the rest of the small surface.

`all` calls several jarl functions with the same arguments and resolves to one result per function, each still carrying only its own value and its own error. One failure does not stop or change the others. It waits for every function. It is not a race and it does not cancel.

That is the whole of result handling. jarl has no services, no clock, no retry, no scope and no way to say that a wait should end because something shut down.

## What closing Effect removes

These are the operations v1 actually uses, and what happens to each of them. The list is the migration, not a second Effect.

- **Dependency injection.** v1 reaches a service with `yield*` inside an Effect (`Context.Service`, `Layer`, one graph in `main.ts`). v2 has no container and no ambient context. A service is a data object, and every function that is part of it takes that object as its first argument. Dependencies are fields of the object. `requireOpen` is the check that they are still alive. The entry builds the objects in one place and passes them; nothing looks them up.
- **Cleanup.** v1 acquires with `Effect.acquireRelease` and `Effect.addFinalizer`, and `Scope.close` releases in reverse order (the pool in `packages/db/src/client.ts`, the fleet's leave and row delete in `packages/fleet/src/member.ts`, the log flush in `packages/observability/src/log.ts`, Sentry's flush, QMP's teardown). v2 registers `cleanup` on the service. `close` runs children newest-first, then cleanups newest-first.
- **Retries.** v1 uses `Effect.retry(Schedule.recurs(2))`: three tries, then a line (`packages/jobs/src/close.ts`, `packages/jobs/src/ready.ts`, the automation server's worker). v2 `retry` takes `attempts` as that total, and a delay that is a number or a function of how many failures have happened, so a caller can write a backoff without a schedule type.
- **Ticks and timers.** v1 sleeps with `Effect.sleep`, loops with `Effect.repeat(Schedule.spaced(...))` or `Effect.forever(Effect.sleep(...).pipe(Effect.andThen(tick)))`, and reads time from `Clock` so `TestClock` can drive it (fleet heartbeats, the host sampler, session timeouts, the reservation sweep, the dispatch loop). v2 `sleep` and `tick` wait on the service's clock. Tests pass `clock.manual` and `advance`. Production passes nothing and gets `clock.system`, the one `setTimeout` in v2.
- **Timeouts.** v1 uses `Effect.timeoutOrElse`, which interrupts the loser (Linear, the proxy client, QMP, the qemu router, a session command). v2 `timeout` returns whichever finishes first and does not stop the run that lost. A run that must stop has to wait on the service itself, where close becomes `Closed`.
- **One-shot waits.** v1 `Deferred` is the log flush marker, a QMP reply, the listen failure, an in-flight iso download, an abort signal. v2 `latch` is that cell: `succeed` or `fail` once, `wait` until it is set or the service closes.
- **Shutdown.** v1 interrupts the root fiber on SIGINT and SIGTERM; scopes close in reverse; `Cause.hasInterruptsOnly` is how a drain tells an interrupt from a failure; `Effect.uninterruptible` is how a write finishes anyway (`packages/jobs/src/reclaim.ts`, the fleet heartbeat write, the sweep). v2 does not interrupt. See Close, below.

Still absent, on purpose, until a process being moved needs them:

- **Queue.** The log drain is an unbounded queue. QMP lines are an unbounded queue. Session followers drop a slow subscriber. Those three policies (wait, slide, drop) are not built. A tick that publishes can hold an array on its data object until a real consumer needs a queue.
- **Semaphore.** The iso manifest, minted-disk starts and the reservation gate take one permit. The sweep skips a tick that is still running. `tick` does not overlap, because it awaits the run, and it does not skip: a slow run delays the next. Skipping is a semaphore, and it is not here.
- **Stream.** Child stderr, follow events and HTTP bodies are streams. They sit on a queue or on a socket. Neither is this package.
- **Ref.** Mutable state is a field of the data object. There is no `Ref` and no `SynchronizedRef`.
- **A race that cancels.** `jarl.all` keeps every result and waits for all of them. `timeout` keeps the first and leaves the rest running. Nothing stops a function that has already started.

## Services

A service is the data it needs, plus a lifetime. `open` returns one object: the fields you passed, the `name`, `closed`, and `now`.

```ts
type Log = Async.Service & { readonly lines: Array<string> };
type Database = Async.Service & { readonly url: string; readonly log: Log };

const db = Async.open({ name: "database", data: { url, log }, parent: root });

const query = (db: Database, sql: string) =>
  Async.attempt(db, async () => {
    const ready = Async.requireOpen(db, db.log);
    if (!ready.ok) {
      return ready;
    }
    return jarl.ok({ url: db.url, sql });
  });
```

The function's first parameter is that object. There is no second way to reach it.

`attempt` returns `Closed` without calling the body when the service is already closed. A body that has started runs to its own return even if the service closes in the middle. The next `attempt` is `Closed`. That is the whole of "do not interrupt."

`requireOpen(db, db.log)` is the dependency check. It names the first closed one and does not close `db`. The function returns that `Closed`, and the owner of `db` closes `db`. Owning and using are different:

- A child passed `parent` is owned. `close(parent)` closes children newest-first, then the parent's cleanups. Opening under a parent that is already closed returns a service that is born closed, and `cleanup` on it returns `Closed` immediately.
- A dependency stored as a field is used, not owned. Closing the log does not close the database. The database's next call sees `Closed` from the log and closes itself.

`now` reads the clock the service was opened with. A function that needs the time reads `service.now()`. It does not call `Date.now()`.

## Close

Closing a service is the interrupt.

1. The service is marked closed, so a new `attempt`, `sleep`, `retry`, `tick`, `timeout` or `latch` wait fails with `Closed` and the service's name.
2. Anyone already waiting (a sleep, a retry's delay, a tick's gap, a timeout's deadline, a latch's wait) receives that same `Closed`.
3. Children close, newest first. Their waits wake. Their cleanups run.
4. This service's cleanups run, newest first.

A function that is between waits is not cut off. A tick's run is allowed to finish; the loop then returns `Closed`, even if that run failed, and does not schedule another one. A retry that is inside an attempt lets that attempt finish; if the attempt returns a value, that value stands, and the next call is `Closed`. If the attempt returns `Closed`, or close wakes the delay, `retry` returns `Closed` and does not try again. `Closed` is never an error you retry.

`close` itself returns `ok` when every cleanup did, or `CleanupFailed` carrying each cause when one did not. The service is closed either way: a cleanup that fails does not keep it open, and a second `close` returns the same result without running anything again. A cleanup registered after close returns `Closed` and is not stored; the caller still holds the resource and releases it itself.

The process entry treats `Closed` as the signal to shut the rest down:

```ts
const root = Async.open({ name: "process", data: {} });
const looping = Async.tick(member, 30_000, () => heartbeat(member));
const result = await looping;
// Closed means a service underneath ended. Any other error is a real failure.
const cleaned = await Async.close(root);
```

`heartbeat` returns `Closed` when the database or the log has closed. `tick` stops and returns it. The entry closes `root`, which closes the children it owns. That is the cascade: an error that names the service which ended, then an explicit close of the owner. Nothing walks the graph for you except the parent link you set at `open`.

## Errors

Expected failures are classes from `jarl.error.define`, in the module that raises them, with the fields a caller has to read (`service`, `after`, `causes`, `cause`). `Closed`, `CleanupFailed`, `TimedOut`, `Defect` and `AlreadySettled` live in `@oligarchy/async`. Recover with `jarl.error.is`, which removes the handled error from the union. A thrown value inside `attempt`, `retry`, `tick`, `timeout` or a cleanup becomes `Defect` and stays a result; it is not retried and it does not reject the promise. `unwrap` is for the process boundary, after every error the entry knows how to handle has been taken off.

## Clock

`clock.manual(start)` moves only when `advance` is called. Every unit test that waits uses it and a long delay (a minute, not ten milliseconds), so a bug that waits on the real timer fails the test instead of passing slowly. `clock.system` is `Date.now` and `setTimeout`, and those calls live only in `packages/async/src/clock.ts`. A service opened without a clock gets the system clock; tests pass the manual one.

`stop` on a delay drops it. Close uses that so a sleep that already returned `Closed` cannot later succeed when the clock moves.

## Tests

Tests are written first. No code lands until a failing unit test describes it, and every surface has a happy and an unhappy test. The unhappy ones for this package are the closed service, the close that arrives during a wait, the cleanup that throws, the retry that must not continue, and the run that is not cancelled.

A test imports the package from `src/main.ts`. It does not import a private module, and it does not use fake timers: the manual clock is the seam. Assert a failure with `jarl.error.is` and the fields, not the message alone, except where the message is the report a caller prints. `test/boundary.test.ts` reads the v2 sources and fails if a file outside `packages/async/src/clock.ts` calls `setTimeout`, `setInterval`, `Date.now` or `queueMicrotask`, or if any source imports `effect` or `@effect/`.

## Agents

A developing agent in v2 reads this file before writing. It does not follow the Effect rules in the root `development.md`, and it does not add Effect to make a v2 change look like v1.

Adding a service:

1. Write the failing tests, happy and unhappy, including the call made after `close`.
2. `open` the data object. Give it a `name` a `Closed` error can carry. Pass `parent` only for something this service owns. Pass `clock` only in tests.
3. Every exported function takes that object first. Dependencies it uses are fields, checked with `requireOpen` at the start of the body.
4. Waiting goes through `sleep`, `retry`, `tick`, `timeout` or `latch`. A `Closed` result is returned to the caller, not retried and not replaced with a default. The caller closes what it owns.
5. Register `cleanup` for anything `close` must release. The cleanup returns a result; a failure becomes `CleanupFailed` on the way out.
6. Do not import `effect`. Do not call `setTimeout`, `setInterval`, `Date.now` or `queueMicrotask` outside `packages/async/src/clock.ts`. Do not add a queue, a semaphore or a fiber because v1 had one; the list above is the gate.

A driving agent is unchanged. It uses `./client` and `./ctrl` and does not read or change code.
