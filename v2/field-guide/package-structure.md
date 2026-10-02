# Package structure

| Word | Is | Lives in |
| --- | --- | --- |
| app | a process you start. It has a `start` script. | `apps/<name>` |
| package | a library apps import. It never starts itself. | `packages/<name>` |
| main | production wiring: real services, real process. No logic. | `src/main.ts` |
| application | the app's own `main`, run on whatever services it is handed | `src/application.ts` |
| world | everything outside the process a service reaches, except the database | `World` in `src/services.ts` |
| fake | a stand-in a package ships for other packages' tests | `src/testing.ts`, exported as `./testing` |

## Every workspace

| File | Holds |
| --- | --- |
| `package.json` | `"name": "@oligarchy/<dir>"`, `"private": true`, `"type": "module"`, `exports`, scripts `check:types` and `test:unit` |
| `tsconfig.json` | `"extends": "../../tsconfig.base.json"`, includes `src/**/*.ts`, `test/**/*.ts`, `vitest.config.ts` |
| `vitest.config.ts` | `include: ["test/**/*.test.ts"]`, `passWithNoTests: false` |
| `src/` | the code. Imports name the file: `./jobs.ts`, never `./jobs`. |
| `test/` | `*.test.ts`, plus helpers only this package's tests use (`support.ts`, `dispatching.ts`) |

- A sibling is `"workspace:*"`. A third-party dependency is `"catalog:"`, pinned once in `v2/package.json`.
- Something only tests use is a `devDependency`: `@oligarchy/fake-postgres`, `vitest`, `pg`.
- A new workspace is picked up by `apps/*` / `packages/*` in `v2/package.json`. Add its `start` alias there if it runs.

## Package

| Problem | Fact |
| --- | --- |
| entry | `exports: { ".": "./src/main.ts" }`. Everything public goes through `main.ts`. |
| a second face | its own subpath: `@oligarchy/http/serve`, `@oligarchy/http/client`, `@oligarchy/db/schema` |
| fakes | `./testing` → `src/testing.ts` (`http`, `logger`, `sentry`, `drive-harness`) |
| many services in one package | `main.ts` re-exports namespaces: `export * as Servers from "./servers.ts"` (`stores`, `fleet`) |
| importing | as a namespace: `import * as Logger from "@oligarchy/logger"`, `import type * as Db from "@oligarchy/db"` |
| a service | a type with `readonly service: "<name>"`, registered with `declare module "@oligarchy/app"`, built by `App.createService` |
| a test-only helper | `test/support.ts`. Shared with other packages, it moves to `src/testing.ts`. |

```ts
// packages/logger/src/main.ts
export type Logger = { readonly service: "logger"; readonly info: Write; /* ... */ };

declare module "@oligarchy/app" {
  interface Services {
    logger: App.Register<"logger", Logger>;
  }
}

export const create = App.createService<Sentry.Sentry | Db.Database, Options, Logger>(
  ({ sentry, db }, options) => { /* ... */ },
);
```

```ts
// packages/logger/src/testing.ts: a fake is still built by createService, so it is a Made
const create = App.createService<never, App.NoOptions, Logger.Logger>(() => ({
  service: "logger",
  info: emit("info"),
  // ...
}));
```

## App

| File | Holds | Tests import it |
| --- | --- | --- |
| `src/main.ts` | production only: env, live services, the real `listen` / `spawn` / `process.env`, `onExit(closeServices)`, `app.run` | never. Importing it starts the process. |
| `src/application.ts` | `export const main = (options) => async (app) => { ... }`: the lifecycle and every sub-app | yes, with fake services, options and `Io` |
| `src/environment.ts` | `Env.cli({...}).flags({...}).needs(...).done()` and `export type Run` | yes, through `Env.fakeIo` |
| `src/services.ts` | `Services`, `World`, `live()`, `createServices(env, world = live())`, `closeServices` | when the wiring itself is the unit (tester) |
| `src/routes.ts` | Hono routes over a `Sessions` object handed in. `export type Routes`. No logic. | yes, over `testing.ts`'s fake sessions |
| `src/testing.ts` | fakes of this app for other apps' tests | from other workspaces |
| business logic | plain modules: `create(services, options)` returning the functions (`jobs.ts`, `reserve.ts`, `run.ts`, `dispatch.ts`) | yes |

- `main.ts` only chooses. It reads nothing but env, decides nothing, and holds no function a test needs.
- `application.ts` never builds a service and never touches `process`. Anything that reaches the process is an option of `main`: `listen`, `spawn`, `env`.
- Services reach `application.ts` through `app.services`. Its type names only what it uses: `App.App<Run, Http.Http | Logger.Logger>`.
- A test makes its own app around the same `main`. That is the whole point of the split.
- One app reading another's API: export `./routes` and import its `Routes` type (`@oligarchy/automation-server` → `@oligarchy/automation-client/routes`). Never import another app's `main.ts` or `application.ts`.

```ts
// apps/automation-client/src/main.ts: production
const env = jarl.value(created);
const services = createServices(env);
const app = new App.App(env).main(Application.main({ listen, spawn, env: process.env }));
app.onExit(() => closeServices(services));
await app.run(services, (errors) => { /* stderr */ });
```

```ts
// apps/automation-client/src/application.ts: runs on what it is handed
export const main =
  (options: {
    readonly listen: typeof Serve.listen;
    readonly spawn: Child.Spawn;
    readonly env: Run.Options["env"];
  }) =>
  async (app: App.App<Environment.Run, Announcing | Http.Http>) => {
    const { logger, http } = app.services;
    // ...
  };
```

```ts
// apps/automation-server/test/automation-server.test.ts: the same main, our own services
const env = jarl.unwrap(
  await Env.create(environment, Env.fakeIo({ argv: ["--port", String(PORT)], env: { /* ... */ }, files })),
);
const services = { http: http.http, logger: log.logger, servers, tests, setupRequests, diagnosis };
const app = new App.App(env).main(Application.main({ listen }));
const running = app.run(services, (failed) => errors.push(...failed), io);
```

## Services and the world

| Problem | Fact |
| --- | --- |
| the services type | `App.Needs<Http.Http \| Logger.Logger \| ...>`. Never a hand-written object type (AGENTS.md rule 16). `automation-server` and `tester` still hand-write theirs. |
| building them | `createServices(env, world = live())`. `env` is narrowed to the fields it reads. |
| what `World` holds | terminal, `http`, host source, usage: everything outside the process but the database |
| the database | named by env (`DATABASE_URL`). A test points it at `@oligarchy/fake-postgres`. |
| closing | `closeServices`: flush the logger, close the db, flush again, wait on Sentry. Run from `app.onExit`. |
| a service built before the app that must stop with it | own controller, forwarded from `app.signal` (driver; see [Aborts](./abort.md)) |
| a plain module or a service | AGENTS.md rule 11. Business logic is a plain module with no `services.ts` entry. |

```ts
// apps/automation-client/src/services.ts
export type World = App.Needs<App.Made<Http.Http> | App.Made<Fleet.Usage.Usage>> & {
  readonly terminal: Terminal;
  readonly host: Fleet.Host.Source;
};

export const createServices = (
  env: { readonly vars: { readonly databaseUrl: Env.Secret } },
  world: World = live(),
) => { /* ... */ return { http, sentry, db, logger, host, usage, servers, processStats } satisfies Services; };
```

## Where each app stands

| Workspace | `main` in | Split |
| --- | --- | --- |
| `apps/automation-client` | `src/application.ts` | yes |
| `apps/automation-server` | `src/application.ts` | yes |
| `apps/driver` | `src/main.ts`. Its logic is `Drive.drive(services, ...)` in `src/drive.ts`, tested directly. | no |
| `apps/ctrl` | not an `App`: a one-shot CLI. `Commands.run(services, env, out)` in `src/commands.ts`. | yes: `main.ts` hands it real `stdout` / `stderr` / `writeFile` |
| `apps/qemu-server` | none yet. `src/routes.ts` only, no `test/` or `vitest.config.ts`. | no |
| `packages/tester` | `src/main.ts`. A runnable under `packages/`, from before `apps/`. | no |

- A new long-running app is split from its first commit: `main.ts`, `application.ts`, `environment.ts`, `services.ts`.
- Splitting one that is not: move `main` to `application.ts`, make what it takes from the process an option, and leave `main.ts` choosing the real ones.
