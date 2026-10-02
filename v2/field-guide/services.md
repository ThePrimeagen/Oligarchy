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

| Problem | Fact |
| --- | --- |
| constructor | `new C(services, options)`, services typed `App.Needs<...>` |
| what it builds | imports and constructs it; never injected: `DriveHarness` builds its `QemuHttpTools` |
| handing on services | pass `this.services` whole: `new QemuHttpTools(this.services, { job, baseUrl, token, signal })` |
| registered | never in `Services`; no `service` field |
| test | fake the service it reaches, `http`; prove `act` and `ask` make their calls through it |

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
