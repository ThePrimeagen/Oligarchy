# Services

## When

| Make a service when it | Example |
| --- | --- |
| reads or writes the database | every `@oligarchy/stores` store, over `db` |
| reaches something outside our system: we use it, we do not own it | `db`, `http`, `sentry`, `openRouter`, `usage` (`ps`), `host` (`node:os`) |
| is needed by several apps or services and wants nothing or only services | `db`, `logger`, `sentry`, `host` |
| is the contract line between this app and the system | |

| Not a service | Make it | Example |
| --- | --- | --- |
| a call inside our system | a typed client over the callee's routes: `HttpClient.create<Routes>()` | `automation-server/src/automation-client.ts` |
| state held and changed per call, several per process | a class that imports what it builds | `App`, `DriveHarness`, `QemuHttpTools` |
| one app's in-memory state | `export const create = ()` | `automation-client/src/jobs.ts` |
| one app's logic over services | a plain module | `dispatch.ts`, `reserve.ts` |
| a long-running helper | a function, `signal` before options | `Fleet.announce`, `Fleet.Host.sampling` |

- Inside our system: automation server to automation client, automation client to QemuServer, QemuServer to QemuRunner.
- V2 names: the qemu reverse proxy is QemuServer; the qemu server is QemuRunner.
- A service is where a test decides the outcome: one fake gives the failing case, another the passing one.

For a route that returns bytes, headers, or a stream, use `HttpClient.connect<Routes>()`.
Its `request(method, path, input, init)` checks the method, path, JSON and query against the
callee's routes. It returns an open HTTP response: consume its body or close it. Use
`Http.body(response)` to forward the stream; cancellation closes the upstream response.
The configured timeout covers reading the body, including a stalled stream.
For a decoded response, use the same client's `prepare(method, path, input, init)` and pass
its `[url, init]` tuple to `http.fetch` with the decoder and status handlers. Preparation checks
the request against the callee's routes and adds authentication; callers do not rebuild URLs
or JSON bodies.

## Write

```ts
// packages/stores/src/process-stats.ts
export type ProcessStats = {
  readonly service: "processStats";
  readonly report: (name: string, type: ServerType, stats: DbSchema.ProcessStats) => Answer<void>;
};

declare module "@oligarchy/app" {
  interface Services {
    processStats: App.Register<"processStats", ProcessStats>;
  }
}

export const create = App.createService<Db.Database, App.NoOptions, ProcessStats>(({ db }) => ({
  service: "processStats",
  report: (name, type, stats) => db.run(/* ... */),
}));
```

| Problem | Fact |
| --- | --- |
| name | the `service` field equals its `Services` key |
| one file | registers one service and exports its `create` (`oligarchy/service-create`) |
| `Wants` | the union of services it uses; `never` for none; no cycles (`oligarchy/service-cycle`) |
| `Options` | one object of named fields; `App.NoOptions` for none |
| creation | synchronous, cannot fail; connects on first use |
| `App.Made<S>` | only `createService` makes one; a fake too |
| fake | `@oligarchy/<package>/testing` |

## Class

```ts
// packages/drive-harness/src/main.ts
class DriveHarness {
  constructor(services: App.Needs<Wants>, signal: AbortSignal, options: Types.Options) {
    this.qemuHttpTools = Qemu.create(services, signal, options);
  }
}

export type { DriveHarness };

export const create = (
  services: App.Needs<Wants>,
  signal: AbortSignal,
  options: Types.Options,
): DriveHarness => new DriveHarness(services, signal, options);
```

| Problem | Fact |
| --- | --- |
| export | `create` and the type only; never the class |
| create | `create(services, signal, options)`: services typed `App.Needs<...>`, the signal it reacts to, then options |
| what it builds | imports and creates it; never injected: `DriveHarness` creates its `QemuHttpTools` |
| handing on services | pass the services object whole: `Qemu.create(services, signal, options)` |
| registered | never in `Services`; no `service` field |
| test | fake the service it reaches, `http`; prove `act` and `ask` make their calls through it |

## Database transitions

- When several writes represent one state transition, expose one store operation that commits
  them in one transaction. A completed row must not become visible before the work it queues.
- Throw a domain refusal inside the transaction when it must roll back earlier writes, then
  translate that refusal to a result outside the transaction.
- Lock ancestors before descendants in compound transitions. Lock a shared parent before
  changing its last children, so concurrent completions cannot both leave the parent open.
- Lifecycle cleanup must enumerate every applicable row. A bounded query for a queue display
  is not a complete inventory for shutdown or recovery.

## Wire

```ts
// apps/driver/src/services.ts
export type Services = App.Needs<Http.Http | Sentry.Sentry | Db.Database | Logger.Logger>;

export const createServices = (env: Env) => {
  const http = Http.create({});
  const sentry = Sentry.create({ http }, { dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT });
  const db = Db.create({}, { url: env.vars.databaseUrl });
  const logger = Logger.create({ sentry, db }, { write, colors });
  return { http, sentry, db, logger } satisfies Services;
};

// apps/driver/src/main.ts
app.onExit(() => closeServices(services));
await app.run(services, onClose);
```

## Log attribution

- `jobId` identifies the job in stored logs, terminal output, color grouping, and Sentry reports.
- `runId` identifies its parent test run for stored logs. Supply both when both are known;
  a drive or setup and its diagnosis have separate job IDs within the same run.
- Pass known IDs through helpers. Before a job loads, report its known job ID without
  inventing a run ID or doing a second database lookup just to log an error.
- Process-wide messages may omit both IDs. `location` names the component emitting the line.
- Query evidence for one attempt by `jobId`; query the full run's history by `runId`.
  Do not infer a log's job from its timestamp. Older rows without a job ID remain run-level logs.

## Removing a runner

- Delete a removed runner's routing assignments in the same transaction as its registry row.
  Keep the jobs themselves; pending jobs can then be placed on an available runner.
- Assignment writes must lock and validate the registry row so a reservation finishing late
  cannot recreate a route to a runner that cleanup already removed.
