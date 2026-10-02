# Aborts

| Word | Is | Lives in |
| --- | --- | --- |
| signal abort | an `AbortSignal` stops work in flight | apps, services, HTTP, business logic |
| status abort | a row moves to `aborted` | `tests.abortJob` / `abortRun` / `abortSuite` |
| status abort | qemu `StopStatus` `"aborted"`, Sentry `SpanStatus` `"aborted"` | `qemu-http-tools`, `sentry` |

## Errors

| Error | From | Means |
| --- | --- | --- |
| `Async.Aborted` | `@oligarchy/async` | a signal aborted. The message says why. |
| `Async.TimedOut` | `Async.timeout` | the deadline passed |
| `Http.HttpTimedOut` | `@oligarchy/http` | `TimedOut` on an HTTP call, renamed |

- Abort with a reason: `controller.abort(new Aborted("why"))`. Never a bare `.abort()`.
- A helper hands back `signal.reason` when it is an `Aborted`. Otherwise it hands back `new Aborted("aborted")`.
- An abort comes back as `jarl.err(Aborted)`. Nothing throws.
- Check it with `jarl.error.is(result, Async.Aborted)`. A raw reason works too: `jarl.error.is(signal.reason, Aborted)`.
- Never DOMException `AbortError`. Never `AbortSignal.any` or `AbortSignal.timeout`.
- To join a deadline with a caller's signal, use `Async.timeout(fn, { ms, signal })`. It owns an inner controller and forwards to it.
- Reasons in use: `"SIGINT received"`, `"main returned"`, `"parent stopped"`, `` `job ${jobId} aborted` ``, `"shutting down"`.

## Application

| Problem | Fact |
| --- | --- |
| `app.signal` aborts | on the first SIGINT, SIGTERM or SIGHUP, when its parent stops, or once its main returns |
| main runs until killed | `await App.waitForAbort(app.signal)`. It resolves `void`. |
| ordering on stop | close the listener, then wait out the aborts it took (`aborter.settled()`), then shut down jobs, then log `stopped; ${reason}`, then `return jarl.ok(undefined)` |
| listener `close()` | stops new connections. A handler still running is not stopped, so abort held jobs yourself. |
| a loop | make it a sub-app: `app.sub(new App.App(app.environment).main(loop))` |
| sub-app's signal | `sub.signal`. It aborts with `"parent stopped"` when the parent stops. |
| main returns `Aborted` after a stop | not an error. App drops it. |
| main returns `Aborted` with no stop | an error. The process exits 1. |
| second process signal | `exit(1)` at once. Exit handlers are skipped. |
| main returns or throws | `app.signal` aborts, every sub-app stops, and the process exits 1 if errors were reported |
| `onExit` handler | runs after `app.signal` aborted. Never hand `app.signal` to its calls. Give them their own deadline. |
| work that must stop with the app but is built before it | own controller, forwarded from the app signal (driver) |

```ts
// apps/automation-client/src/application.ts
app.sub(new App.App(app.environment).main(announcing(jobs)));
await App.waitForAbort(app.signal);
await jarl.value(listened).close();
await jobs.shutdown();
logger.info(`stopped; ${reasonOf(app.signal)}`, { location: LOCATION });
return jarl.ok(undefined);
```

```ts
// apps/automation-server/src/application.ts: a loop sub-app
while (!sub.signal.aborted) {
  const started = await dispatcher.startNextJob();
  if (!started) {
    await Async.sleep(dispatchInterval, sub.signal);
  }
}
return jarl.ok(undefined);
```

```ts
// apps/driver/src/main.ts: services built before the app
const guest = new AbortController();
const services = createServices(env, guest.signal);
const app = new App.App(env).main(main);
app.signal.addEventListener("abort", () => guest.abort(app.signal.reason), { once: true });
```

## Service

| Problem | Fact |
| --- | --- |
| signal for one call | optional `signal?: AbortSignal` field on the request: `http.fetch(url, { signal })`, `openRouter.complete({ signal })`, `driveHarness.ask({ signal })` |
| signal for every call | optional `signal?` in the create options: `Qemu.create({ http }, { job, baseUrl, token, signal })`, `HttpClient.create({ http, url, token, signal })` |
| no signal given | use a signal that never aborts: `const NEVER = new AbortController().signal` |
| a long-running helper | signal is a required positional, last before options: `Async.sleep(ms, signal)`, `Async.tick(fn, ms, signal)`, `Fleet.announce(member, needs, signal, options)`, `Fleet.Host.sampling(host, signal)` |
| failure union | put `Async.Aborted` in it (`Http.HttpFailure`, `OpenRouter.Failure`) |
| mapping errors | return `Aborted` unchanged: `if (jarl.error.is(error, Async.Aborted)) return error;` |
| retrying | never retry `Aborted`. `Http.retryable` leaves it out. `Async.repeat` stops once its `signal` aborts. |
| a cleanup call that must still run after the abort | opt it out of the signal: qemu `stop` uses `{ aborts: false }` |
| a tick loop | `Async.tick` settles once the call in flight returns. Clean up after it: `Fleet.announce` deletes its row. |

```ts
// packages/openrouter/src/main.ts
const failure = (error: Asked): Failure => {
  if (jarl.error.is(error, Async.Aborted)) {
    return error;
  }
  // ...
};
```

```ts
// packages/qemu-http-tools/src/main.ts: "signal aborts every call but stop"
const signalled = (aborts: boolean): { readonly signal?: AbortSignal } =>
  aborts && options.signal !== undefined ? { signal: options.signal } : {};
// stop:
posting({ status: end.status }, { aborts: false });
```

## HTTP calls

| Problem | Fact |
| --- | --- |
| every call | has a deadline. Default 10 000 ms. Set `timeoutMs` in the init, or in a client spec. |
| deadline passes | `Http.HttpTimedOut` |
| caller's signal aborts | `Async.Aborted`, with the signal's reason |
| a call only an abort may end | `timeoutMs: 2 ** 31 - 1` (the automation client's `/run`) |
| failure in a loop that may be a shutdown | check `signal.aborted` first and return `Aborted` |
| status a route answers on purpose | name it in the spec so it is a word, not a failure: `"/abort": { ok: "stopped", 404: "not-held" }` |
| how | `@oligarchy/http` runs every fetch through `Async.timeout(exchange, { ms: timeoutMs, signal })` |

```ts
// apps/automation-server/src/dispatch.ts
const reserved = await AutomationClient.create({ http, url: client.url, token, signal }).post(
  "/reserve",
  request,
);
if (jarl.is_err(reserved)) {
  if (signal.aborted) {
    return jarl.err(new Async.Aborted(`reserve on ${client.url} ended: shutting down`));
  }
  // log, next client
}
```

## The `/abort` route

- `/abort` calls a function named `abort`, which performs the abort sequence (AGENTS.md rule 9).
- A stub route answers 501 `abort is not written yet` until its `abort` is handed in.

| App | Body | Answers |
| --- | --- | --- |
| automation-client | `z.strictObject({ jobId: z.uuid() })` | 200 `stopped`, 404 `not-held`, 400 bad body, 501 not written |
| automation-server | `{ jobId }` or `{ suiteId }`, never both | 200 `{}` aborted, 404 unknown, 409 `NothingToAbort` (already ended), 502 `NotStopped` (its client could not stop it), 500 database, 400 `name a jobId or a suiteId` |
| qemu-server | `z.strictObject({ job: z.uuid() })` | 501 not written |

- The route hands off to `Sessions["abort"]` (client) or `Aborter["abort"]` (server). The route holds no logic; it maps each error to its status.
- `abort` answers only once the job's holder has let it go.
- Unknown id is `not-held` (404). It is not an error.
- Signal aborts never write a job's status. The automation server writes status.

```ts
// apps/automation-client/src/routes.ts
.post(
  "/abort",
  zValidator("json", AbortRequest, (result, c) =>
    result.success ? undefined : c.json({ error: "name a jobId" }, 400),
  ),
  async (c) => {
    if (abort === undefined) {
      return c.json({ error: "abort is not written yet" }, 501);
    }
    const stopped = await abort(c.req.valid("json"));
    if (stopped === "not-held") {
      return c.json({ error: "job not found" }, 404);
    }
    return c.json({}, 200);
  },
);
```

## Business logic: one job's abort

- A plain module, not a service: `export const create = ()`, no `createService`, no entry in `services.ts` (`apps/automation-client/src/jobs.ts`).
- `main` creates it and hands `jobs.abort` to the routes.
- One `AbortController` per id, in memory only.

| Problem | Fact |
| --- | --- |
| take a job | `hold(jobId)` gives `{ signal, release }`. A second hold is `AlreadyHeld`. A hold after shutdown starts is `ShuttingDown`. |
| holder | listens on `signal`, cleans up, then calls `release()` |
| abort one | `aborter.abort(new Aborted(`job ${jobId} aborted`))`, then wait for `released`, then answer `"stopped"` |
| abort all (shutdown) | set `shuttingDown`, abort each with `new Aborted("shutting down")`, then `await Promise.all(released)` |
| listen | if `signal.aborted`, run now. Otherwise `addEventListener("abort", fn, { once: true })`. |
| hand the job to a new owner | `removeEventListener("abort", onAbort)` first (`reserve.ts` `take`) |
| a loop | check `signal.aborted` at the top of each turn |
| a step failed | `signal.aborted ? aborted() : error`, because an abort makes calls fail |
| how an aborted run ends | an outcome, not a failure: `jarl.ok({ status: "aborted", reason })` (driver) |

```ts
// apps/automation-client/src/jobs.ts
const stop = (entry: Entry, reason: Aborted): Promise<void> => {
  entry.aborter.abort(reason);
  return entry.released;
};
// ...
abort: async ({ jobId }) => {
  const entry = held.get(jobId);
  if (entry === undefined) {
    return "not-held";
  }
  await stop(entry, new Aborted(`job ${jobId} aborted`));
  return "stopped";
},
shutdown: async () => {
  shuttingDown = true;
  await Promise.all([...held.values()].map((entry) => stop(entry, new Aborted("shutting down"))));
},
```

```ts
// apps/automation-client/src/reserve.ts: listen, or run now if already aborted
held.signal.addEventListener("abort", onAbort, { once: true });
// unless held.signal.aborted, then onAbort() at once
```

```ts
// apps/driver/src/drive.ts
while (true) {
  if (signal.aborted) {
    return aborted(); // jarl.ok({ status: "aborted", reason: reasonOf(signal) })
  }
  const image = await harness.getImage();
  if (jarl.is_err(image)) {
    return signal.aborted ? aborted() : image;
  }
  // ...
}
```

## Business logic: an operator's abort (automation server)

- A plain module: `Abort.create(services, { token, aborting })` (`apps/automation-server/src/abort.ts`). `main` hands `aborter.abort` to the routes.
- Every status it writes says `Abort.REASON`, `"aborted by an operator"`.

| Problem | Fact |
| --- | --- |
| a pending job | `abortJob`. Refused because dispatch ran it meanwhile: read it again and abort it as it is now. |
| a running job | add it to `aborting`, `/abort` it at its client (15 s deadline), `abortJob`, then delete it from `aborting` in `finally` |
| its run answers `aborted` meanwhile | `Close` skips a job in `aborting`. The operator's abort writes it. |
| its run ended meanwhile | `abortJob` is refused. Read the job: `aborted` stands; anything else is `NothingToAbort`, closed as it would have been. |
| client unreachable | `NotStopped`. The job stays running. |
| client forgotten, or answers `not-held` | nothing to stop. Write `aborted`, with a warning under the job. |
| after the job | `abortRun` (refused is fine), then `Close.closeSuite` once none of the suite's runs is open |
| a suite | every open run at once: its open job, then the run. The first failure is the answer and the suite stays open. Otherwise `abortSuite`. |
| on stop | `settled()` resolves once every abort in flight has written |

```ts
// apps/automation-server/src/close.ts
if (aborting.has(job.id)) {
  return jarl.ok(undefined);
}
```

## Child process

| Problem | Fact |
| --- | --- |
| spawning | inject it: `options.spawn ?? spawn`, typed `Spawn` (`packages/fleet/src/usage.ts`) |
| stop a child | `child.kill("SIGTERM")`, then after a grace `child.kill("SIGKILL")` if `exitCode` and `signalCode` are both `null` |
| grace timer | `.unref()` it |
| missing binary | arrives as an `error` event, not a throw |
| settle once | a `settled` flag. The first of deadline, `error` or `close` wins. |
| job run (automation client) | not built. Spec (`MIGRATION.md` Run): spawn on the held signal, SIGTERM on abort, SIGKILL after a grace (V1: 5 s), answer 409 only when the kill reached the child, `release()` once it is reaped |
| tests | fake child, as in `packages/fleet/test/usage.test.ts` |

```ts
// packages/fleet/src/usage.ts
child.kill("SIGTERM");
setTimeout(() => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}, PS_FORCE_KILL_MS).unref();
```

## Status abort (database)

| Call | Moves | Refuses with `InvalidState` when |
| --- | --- | --- |
| `tests.abortJob(jobId, reason)` | a pending or running job to `aborted` | the job is not pending or running |
| `tests.abortRun(runId, reason)` | an open run to `aborted` | the run still has a pending or running job |
| `tests.abortSuite(suiteId, reason)` | an open suite to `aborted` | the suite still has a pending or running run |

- Order is bottom-up: jobs, then runs, then the suite.
- A pending job never ran, so `abortJob` it directly.
- A running job: stop it at its automation client with `/abort` first, then write the status.
- `runJob` refused because an abort landed during the reserve: give the job back at the client with `/abort` (`dispatch.ts` `markRunning`).
- Only the automation server writes status. The automation client has no `tests` store.

## Scope

| Abort | Who | How | Built |
| --- | --- | --- | --- |
| one call | caller | `Async.timeout(fn, { ms, signal })`, or `signal` / `timeoutMs` on the call | yes |
| one job at a client | automation server | `AutomationClient.create(...).post("/abort", { jobId })`, then `jobs.abort` | yes |
| one job, one suite (operator) | an operator; not ctrl. The caller is open. | automation server `/abort` `{ jobId }` or `{ suiteId }` | yes |
| one job at a qemu server | | qemu-server `/abort` `{ job }` | no: 501 |
| every job at a client | the client on stop | `jobs.shutdown()` after closing the listener | yes |
| every running job (server stop) | automation server | `shutdown()`: `/abort` at each client, then `abortJob` | no: no-op |
| one host, server or location | | none exists. Abort each job on it. | no |
| one app and its sub-apps | process signal, or main returning | `app.signal` | yes |
| a driver run | `app.signal`, forwarded to the guest controller | `drive` ends `{ status: "aborted" }`, exit 0 | yes |

## Tests

| Problem | Fact |
| --- | --- |
| time | `vi.useFakeTimers()`. Advance with `await vi.advanceTimersByTimeAsync(ms)`. |
| abort mid-flight | `controller.abort(new Async.Aborted("SIGINT received"))`, then `await vi.advanceTimersByTimeAsync(0)` |
| already aborted | `AbortSignal.abort(new Async.Aborted("stopping"))` |
| HTTP that never answers | `@oligarchy/http/testing` reply `"hang"`. It rejects with the signal's reason when the signal aborts. |
| process signals | the fake `Io` from `packages/app/test/app.test.ts`: `signal("SIGINT")` |
| proof of cleanup | `expect(vi.getTimerCount()).toBe(0)` |
| proof of the reason | `expect(jarl.error.is(held.signal.reason, Aborted)).toBe(true)` |
| abort during a call | wait until the fake is entered, then abort (dispatch test) |
| a stop while a request's write is held | hand the request to the listener's handler, `await vi.advanceTimersByTimeAsync(0)` so it reaches the store, then signal. A fake listener's `close()` does not wait for handlers. |
| answers only after release | prove "not yet" with a flush: `await new Promise((r) => setImmediate(r))`, then check (`settled()` in `jobs.test.ts`) |
| routes | test them over the `sessions()` fake in `src/testing.ts`, not a real `jobs` |
| coverage | one test per abort boundary: a signal already aborted before the call, and one that aborts during it |

```ts
// packages/async/test/timeout.test.ts
const controller = new AbortController();
const result = track(
  timeout((signal) => sleep(60_000, signal), { ms: 1_000, signal: controller.signal }),
);
await vi.advanceTimersByTimeAsync(200);
const reason = new Aborted("SIGINT received");
controller.abort(reason);
await vi.advanceTimersByTimeAsync(0);
expect(result.value).toEqual(jarl.err(reason));
expect(vi.getTimerCount()).toBe(0);
```
