# App interfaces

## Services

A service's type is its interface: a fixed `service` name and every operation. `open` returns the
real one; a test writes its own. Module functions take the service first and call through it.

```ts
// @oligarchy/log
export type Log = {
  readonly service: "log";
  readonly info: (text: string) => void;
  readonly error: (text: string, cause?: unknown) => void;
  readonly flush: () => Promise<void>;
};
export function open(options: { program: string }): Log;
export const info = (log: Log, text: string) => log.info(text);
export const error = (log: Log, text: string, cause?: unknown) => log.error(text, cause);
export const flush = (log: Log) => log.flush();

// @oligarchy/db
export type Database = {
  readonly service: "db";
  readonly heartbeat: (row: { name: string; at: number }) => Promise<jarl.Result<void, DatabaseError>>;
  readonly session: (id: string) => Promise<jarl.Result<Session, DatabaseError>>;
  readonly saveRun: (run: { name: string; iso: string; ticket: string }) => Promise<jarl.Result<string, DatabaseError>>;
  readonly close: () => Promise<void>;
};
export function open(options: { url: Env.Secret; log: Log.Log }): Database;
export const heartbeat = (db: Database, row: { name: string; at: number }) => db.heartbeat(row);
export const session = (db: Database, id: string) => db.session(id);
export const saveRun = (db: Database, run: { name: string; iso: string; ticket: string }) => db.saveRun(run);
export const close = (db: Database) => db.close();

// @oligarchy/sentry
export type Sentry = {
  readonly service: "sentry";
  readonly capture: (error: unknown) => void;
  readonly flush: () => Promise<void>;
};
export function open(options: { program: string }): Sentry;
export const capture = (sentry: Sentry, error: unknown) => sentry.capture(error);
export const flush = (sentry: Sentry) => sentry.flush();

// @oligarchy/openrouter
export type OpenRouter = {
  readonly service: "openRouter";
  readonly complete: (prompt: string) => Promise<jarl.Result<string, OpenRouterError>>;
};
export function open(options: { token: Env.Secret }): OpenRouter;
export const complete = (openRouter: OpenRouter, prompt: string) => openRouter.complete(prompt);

// @oligarchy/linear
export type Linear = {
  readonly service: "linear";
  readonly fileTicket: (title: string) => Promise<jarl.Result<string, LinearError>>;
};
export function open(options: { token: Env.Secret; team: string }): Linear;
export const fileTicket = (linear: Linear, title: string) => linear.fileTicket(title);

// qemu-server/src/sessions.ts: a program's own service
export type Sessions = {
  readonly service: "sessions";
  readonly start: (request: Request) => Promise<Response>;
  readonly live: () => ReadonlyArray<Session>;
};
declare module "@oligarchy/app" {
  interface Services {
    sessions: App.Register<"sessions", Sessions>;
  }
}
export function open(options: { dataDir: string; maxJobs: number }): Sessions;
export const start = (app: App.Has<Sessions | Log.Log>, request: Request) => app.services.sessions.start(request);
export function drain(app: App.Has<Sessions | Db.Database | Log.Log>): Promise<jarl.Result<void, DrainFailed>>;
```

## App

```ts
// @oligarchy/app/src/services.ts: the shared services, one list
export interface Services {
  log: Log.Log;
  db: Db.Database;
  sentry: Sentry.Sentry;
  openRouter: OpenRouter.OpenRouter;
  linear: Linear.Linear;
}

// @oligarchy/app
export type Signal = "SIGINT" | "SIGTERM";
export type ExitReason =
  | { readonly kind: "returned" }
  | { readonly kind: "signal"; readonly signal: Signal };
export type OnExit = (reason: ExitReason) => void | Promise<void>;
export type Io = {
  readonly onSignal: (handler: (signal: Signal) => void) => () => void;
  readonly exit: (code: number) => void;
};
export class MainCalledTwice extends jarl.error.define("MainCalledTwice") {}

// Any app with at least these services.
export interface Has<T extends AnyService> {
  readonly services: Needs<T>; // app.services.db is the Db.Database in the list
  onExit(handler: OnExit): () => void;
}

// What the entry passes: each key a service's name, its value that service. { db: log } and
// { database: db } do not compile, and a fake written inline is checked against its key.
export type Provided = { readonly [K in keyof Services]?: Services[K] };

// App.App<Reads, Log.Log | Db.Database> is an app with those services: what main and helpers ask for.
export class App<const Environment, const S> {
  readonly environment: Environment; // what Env.create returned
  readonly services: S;              // the object passed in: app.services.db, app.services.log

  constructor(environment: Environment, services: S & Provided);

  // Any number of times. Handlers run newest first, each awaited. Returns remove.
  onExit(handler: OnExit): () => void;

  // Once. main's parameter says what it needs, and the app must have it: a service the app lacks
  // fails on this call as { missing: "openRouter" }, a flag as Property 'iso' is missing.
  // 1. listen for SIGINT and SIGTERM   2. await main(app)
  // 3. on the first signal, or when main returns: the exit handlers, newest first
  // 4. after a signal, wait for main to return   5. exit 0 if main was ok and no handler threw, else 1
  // A second signal exits 1 at once. A second call returns MainCalledTwice. io defaults to the process.
  // A main that asks for nothing (Wants defaults to never) runs on any app.
  main<Wants extends AnyService = never>(
    main: (app: App<Environment, Wants>) => Promise<jarl.Result<unknown, unknown>>,
    io?: Io,
  ): Promise<jarl.Result<void, MainCalledTwice>>;
}
```

## Async

```ts
// @oligarchy/async
export function repeat<A extends unknown[], T, E>(
  fn: (...args: A) => Promise<jarl.Result<T, E>>,
  count: number,
  errorFilter?: (error: E) => boolean,
): (...args: A) => Promise<jarl.Result<T, E>>;
export function tick(fn: () => void | Promise<void>, interval: number): () => Promise<void>; // awaits fn; cancel waits for a run in flight
export function sleep(fn: () => void, delay: number): () => void;
```

## Env

```ts
// @oligarchy/env: exists
Env.cli({ name, description }).flags({ ... }).needs("databaseUrl").command(name, description) /* ... */ .done();
Env.create(definition): Promise<jarl.Result<Out, UsageError | HelpRequested | MissingVariable | ...>>;

// to add
Env.Result<typeof definition>   // what Env.create returns for it
Env.Vars<"databaseUrl">         // { databaseUrl: Env.Secret }
```

## Common: shared by all three

```ts
// @oligarchy/common
import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Log from "@oligarchy/log";
import * as Sentry from "@oligarchy/sentry";
import * as jarl from "jarl";

export type Common = Log.Log | Db.Database | Sentry.Sentry;

export const load = async <Out>(definition: Env.Environment<Out>): Promise<Out> => {
  const result = await Env.create(definition);
  if (jarl.error.is(result, Env.HelpRequested)) {
    process.stdout.write(result.error.text);
    process.exit(0);
  }
  if (!result.ok) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  return result.value;
};

export const open = (program: string, databaseUrl: Env.Secret) => {
  const log = Log.open({ program });
  const db = Db.open({ url: databaseUrl, log });
  const sentry = Sentry.open({ program });
  return [log, db, sentry] as const;
};

export const close = async (app: App.Has<Common>) => {
  await Log.flush(app.services.log);
  await Sentry.flush(app.services.sentry);
  await Db.close(app.services.db);
};

export const report = (app: App.Has<Log.Log | Sentry.Sentry>, error: unknown) => {
  Log.error(app.services.log, String(error), error);
  Sentry.capture(app.services.sentry, error);
};

export const heartbeat = (app: App.Has<Db.Database | Log.Log>, name: string) => {
  const stop = Async.tick(async () => {
    const written = await Db.heartbeat(app.services.db, { name, at: Date.now() });
    if (!written.ok) {
      Log.error(app.services.log, "heartbeat failed", written.error);
    }
  }, 30_000);
  app.onExit(stop);
};
```

## Example 1: driver, one command

```ts
// driver/src/main.ts
import * as App from "@oligarchy/app";
import * as Common from "@oligarchy/common";
import * as Env from "@oligarchy/env";
import * as Log from "@oligarchy/log";
import * as OpenRouter from "@oligarchy/openrouter";
import * as jarl from "jarl";

const definition = Env.cli({ name: "driver", description: "Run the harness loop for one prompt" })
  .flags({ action: Env.args.action(), prompt: Env.args.prompt(), agentId: Env.args.agentId() })
  .needs("openRouterToken", "databaseUrl")
  .done();

type Reads = {
  readonly flags: { readonly prompt: string; readonly agentId: string };
};

const main = async (app: App.App<Reads, Common.Common | OpenRouter.OpenRouter>) => {
  const answer = await OpenRouter.complete(app.services.openRouter, app.environment.flags.prompt);
  if (!answer.ok) {
    Common.report(app, answer.error);
    return answer;
  }
  Log.info(app.services.log, `${app.environment.flags.agentId}: ${answer.value}`);
  return jarl.ok(undefined);
};

const environment = await Common.load(definition);
const [log, db, sentry] = Common.open("driver", environment.vars.databaseUrl);
const openRouter = OpenRouter.open({ token: environment.vars.openRouterToken });

const app = new App.App(environment, { log, db, sentry, openRouter });
app.onExit(() => Common.close(app)); // registered first: runs last
await app.main(main);
```

## Example 2: qemu-server, long-running

```ts
// qemu-server/src/main.ts
import * as App from "@oligarchy/app";
import * as Common from "@oligarchy/common";
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as Sessions from "./sessions.ts";

const definition = Env.cli({ name: "qemu-server", description: "Run QEMU sessions" })
  .flags({
    port: Env.args.port(),
    name: Env.args.machineName(),
    maxJobs: Env.args.maxJobs(),
    dataDir: Env.args.dataDir(false),
  })
  .needs("databaseUrl")
  .done();

type Reads = {
  readonly flags: { readonly port: number; readonly name: string };
};

const routes: Http.Routes<App.Has<Sessions.Sessions | Common.Common>> = {
  "POST /sessions": (app, request) => Sessions.start(app, request),
};

const main = async (app: App.App<Reads, Common.Common | Sessions.Sessions>) => {
  const server = await Http.serve(app, { port: app.environment.flags.port, routes });
  if (!server.ok) {
    Common.report(app, server.error);
    return server;
  }
  Common.heartbeat(app, app.environment.flags.name);
  app.onExit(async () => {
    await jarl.unwrap(Sessions.drain(app)); // a session that refuses to stop: exit 1
  });
  app.onExit(() => Http.stop(server.value)); // newest first: stop taking requests first
  await Http.stopped(server.value);
  return jarl.ok(undefined);
};

const environment = await Common.load(definition);
const [log, db, sentry] = Common.open("qemu-server", environment.vars.databaseUrl);
const sessions = Sessions.open({
  dataDir: environment.flags.dataDir,
  maxJobs: environment.flags.maxJobs,
});

const app = new App.App(environment, { log, db, sentry, sessions });
app.onExit(() => Common.close(app));
await app.main(main);
```

## Example 3: ctrl, several commands

```ts
// ctrl/src/main.ts
import * as App from "@oligarchy/app";
import * as Common from "@oligarchy/common";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Linear from "@oligarchy/linear";
import { session } from "./session.ts";

const definition = Env.cli({ name: "ctrl", description: "Record and read test results" })
  .needs("databaseUrl")
  .command("test", "Test definitions and runs")
  .command("run", "File a test run")
  .flags({ name: Env.args.definitionName(), iso: Env.args.iso() })
  .needs("linearApiToken", "linearTeam")
  .done()
  .done()
  .command("session", "Print a session")
  .flags({ sessionId: Env.args.sessionId() })
  .done()
  .done();

type TestRunReads = {
  readonly command: "test run";
  readonly flags: { readonly name: string; readonly iso: string };
};

const testRun = async (app: App.App<TestRunReads, Common.Common | Linear.Linear>) => {
  const { name, iso } = app.environment.flags;
  const ticket = await Linear.fileTicket(app.services.linear, `${name} on ${iso}`);
  if (!ticket.ok) {
    Common.report(app, ticket.error);
    return ticket;
  }
  return Db.saveRun(app.services.db, { name, iso, ticket: ticket.value });
};

const environment = await Common.load(definition);
const [log, db, sentry] = Common.open("ctrl", environment.vars.databaseUrl);

if (environment.command === "test run") {
  const linear = Linear.open({
    token: environment.vars.linearApiToken,
    team: environment.vars.linearTeam,
  });
  const app = new App.App(environment, { log, db, sentry, linear });
  app.onExit(() => Common.close(app));
  await app.main(testRun);
} else {
  const app = new App.App(environment, { log, db, sentry });
  app.onExit(() => Common.close(app));
  await app.main(session);
}
```

```ts
// ctrl/src/session.ts
import type * as App from "@oligarchy/app";
import type * as Common from "@oligarchy/common";
import * as Db from "@oligarchy/db";
import * as Log from "@oligarchy/log";

export type SessionReads = {
  readonly command: "session";
  readonly flags: { readonly sessionId: string };
};

export const session = async (app: App.App<SessionReads, Common.Common>) => {
  const found = await Db.session(app.services.db, app.environment.flags.sessionId);
  if (found.ok) {
    Log.info(app.services.log, JSON.stringify(found.value));
  }
  return found;
};
```

## Test: ctrl's `session` with fakes

```ts
// ctrl/test/session.test.ts
import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import { expect, it } from "vitest";
import { session } from "../src/session.ts";

it("prints the session it found (happy)", async () => {
  const lines: Array<string> = [];
  // Each fake is checked against its key's service; no annotations needed.
  const app = new App.App(
    { command: "session", flags: { sessionId: "s1" } },
    {
      log: {
        service: "log",
        info: (text) => void lines.push(text),
        error: () => undefined,
        flush: async () => undefined,
      },
      db: {
        service: "db",
        heartbeat: async () => jarl.ok(undefined),
        session: async (id) => jarl.ok({ id, status: "ended" }),
        saveRun: async (run) => jarl.ok(run.ticket),
        close: async () => undefined,
      },
      sentry: { service: "sentry", capture: () => undefined, flush: async () => undefined },
    },
  );

  expect(await session(app)).toEqual(jarl.ok({ id: "s1", status: "ended" }));
  expect(lines).toEqual(['{"id":"s1","status":"ended"}']);
});
```

---

# Instructions

For the agent that builds this. Work in `v2/` on a branch off `master`.

## Rules

- No `effect` or `@effect/*` import anywhere in `v2/`. Results are jarl.
- Tests first. Write every test in the list below failing, then the code. Each surface has a happy
  and an unhappy test. Business logic only: no test that fails because of formatting or wording
  that is not a report a caller prints.
- One `jarl` across `v2/`: after `bun install` in `v2/`, every package's `jarl` in `v2/bun.lock`
  is the same commit.
- A new package copies `v2/packages/async`: `exports` `{ ".": "./src/main.ts" }`, scripts
  `check:types` and `test:unit`, `jarl`, `@types/node`, `typescript`, `vitest` from the catalog,
  `tsconfig.json` extending `../../tsconfig.base.json`, vitest `include: ["test/**/*.test.ts"]`
  and `passWithNoTests: false`.
- A service package never imports `@oligarchy/app`. `@oligarchy/app` imports service types only
  (`import type`), for the `Services` list.
- `new App(environment, services)` takes its types from its two arguments, both `const` type
  parameters, so a literal environment in a test keeps `command: "session"`. `services` is an
  object checked against `Provided`: each key a service's name, its value that service. It also
  refuses a bare service in place of the object (`services: S & { readonly service?: never }`).
- `App.App<Reads, Log.Log | Db.Database>`, the form `main` and helpers write, reads the same as an
  app built from `{ log, db }`: the second type argument is either a union of services or the
  object, and `services` is `{ log: Log.Log; db: Db.Database }` both ways.
- `app.main(main)` infers what `main` needs from its parameter. It checks the app has each service
  by key, so a missing one fails on that call as `{ missing: "name" }`, and it checks the
  environment the ordinary way, so a missing flag fails as `Property 'iso' is missing`.
- `@oligarchy/app`'s `src/main.ts` re-exports `Services` with `export *` (or declares it itself).
  Never `export type { Services } from`: an augmentation through that lands on a separate
  declaration, and the list and the augmentation stop seeing each other (checked with 7.0.2).
- A type-check test file (`test/types.test.ts`) uses `expectTypeOf` and a `// @ts-expect-error
  <why>` above each line that must not compile, as jarl's own tests do. vitest runs it, but its
  assertions are compile-time: `check:types` fails when an `expectTypeOf` no longer matches or a
  `@ts-expect-error` line starts compiling. Nothing in it calls `main` at runtime.
- v2's `lib` is ES2023: `Promise.withResolvers` is ES2024. Use a small helper, or raise `lib`
  for every package at once.
- CI installs only the root, so root oxlint type-checks `v2/` without `v2/node_modules`. An
  imported type in a union with `undefined` then fails `no-redundant-type-constituents`: write an
  optional parameter (`x?: X`), not `x: X | undefined`. Reproduce by moving `v2/node_modules` and
  the packages' `node_modules` aside and running `bun run check:lint` at the root.
- Before each push: `bun run --cwd v2 check:types`, `bun run --cwd v2 test:unit`, then at the root
  `bun install --frozen-lockfile`, `bun run check:lint`, `bun run check:format`.

## Tests to write first

`@oligarchy/env`
- [ ] `Env.Result<typeof definition>` is the type `Env.create(definition)` returns ok (happy).
- [ ] `Env.Result` of a two-command definition is a union narrowed by `command` (unhappy: the other command's flags are absent).
- [ ] `Env.Vars<"databaseUrl">` is `{ databaseUrl: Env.Secret }` (happy).
- [ ] `Env.Vars<"nope">` does not compile (unhappy).

`@oligarchy/async` `tick`
- [ ] An async `fn` is awaited: a slow run is not overlapped by the next (happy).
- [ ] A rejection does not escape, and the next run still happens (unhappy).
- [ ] Cancel during a run resolves after that run, and no run follows (unhappy).
- [ ] Cancel called inside `fn`: no run follows (unhappy).
- [ ] The existing `tick` tests still pass with `cancel` returning a promise.

`@oligarchy/app`: `test/app.test.ts` and `test/types.test.ts`, written out below
- [ ] runs main with its environment and services, then exits 0 (happy)
- [ ] exits 1 when main returns an error, after running the handlers (unhappy)
- [ ] runs exit handlers newest first, each awaited, and skips a removed one (happy)
- [ ] still runs every handler when one throws, and exits 1 (unhappy)
- [ ] on a signal runs the handlers, then waits for main to return, then exits 0 (happy)
- [ ] exits 1 at once on a second signal (unhappy)
- [ ] refuses a second main and runs nothing (unhappy)
- [ ] types: files each service under its key, and keeps the environment's literals
- [ ] types: refuses a wrong services object
- [ ] types: checks main against the app
- [ ] types: checks what main and helpers use
- [ ] types: takes exit handlers that take the reason or nothing

Each service (`log`, `sentry`, `db`, `openrouter`, `linear`)
- [ ] `open` returns a service whose operations work against the real dependency, where the v1 package tests it that way (`db`: Postgres, as `packages/integration-testing` does) (happy).
- [ ] Each operation's failure is its jarl error with the fields a caller reads (unhappy).
- [ ] A fake missing an operation does not compile (unhappy).

`@oligarchy/common`
- [ ] `load` returns the environment (happy); help prints and exits 0, a usage error prints and exits 1 (unhappy). `load` takes an io like `Env.create` so the test reads the output and the code.
- [ ] `close` flushes the log, then Sentry, then closes the database (happy); a failing flush still closes the database (unhappy).
- [ ] `report` writes to the log and to Sentry (happy).
- [ ] `heartbeat` writes each interval and stops when the app's exit handlers run (happy); a failed write is logged and the next one still happens (unhappy).

Programs
- [ ] driver `main` with fakes: the answer is logged (happy); an OpenRouter error is reported and returned (unhappy).
- [ ] ctrl `session` and `test run` with fakes, as in the test above (happy and unhappy each).

## `@oligarchy/app` tests

```ts
// @oligarchy/app/test/support.ts: two services that exist only for these tests.
import type * as App from "../src/main.ts";

export type Counter = {
  readonly service: "counter";
  readonly increment: () => void;
  readonly read: () => number;
};
export type Greeter = {
  readonly service: "greeter";
  readonly greet: (name: string) => string;
};

declare module "../src/main.ts" {
  interface Services {
    counter: App.Register<"counter", Counter>;
    greeter: App.Register<"greeter", Greeter>;
  }
}

export const counter = (): Counter => {
  let count = 0;
  return { service: "counter", increment: () => void (count += 1), read: () => count };
};
export const greeter = (): Greeter => ({ service: "greeter", greet: (name) => `hi ${name}` });
```

```ts
// @oligarchy/app/test/app.test.ts
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as App from "../src/main.ts";
import { counter, type Counter } from "./support.ts";

type Reads = { readonly flags: { readonly name: string } };
const environment = { flags: { name: "ada" } };

const fakeIo = () => {
  const codes: Array<number> = [];
  let send: (signal: App.Signal) => void = () => undefined;
  const io: App.Io = {
    onSignal: (handler) => {
      send = handler;
      return () => undefined;
    },
    exit: (code) => void codes.push(code),
  };
  return { io, codes, signal: (signal: App.Signal) => send(signal) };
};

describe("App", () => {
  it("runs main with its environment and services, then exits 0 (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes } = fakeIo();
    await app.main(async (app: App.App<Reads, Counter>) => {
      app.services.counter.increment();
      return jarl.ok(app.environment.flags.name);
    }, io);
    expect(app.services.counter.read()).toBe(1);
    expect(codes).toEqual([0]);
  });

  it("exits 1 when main returns an error, after running the handlers (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const ran: Array<string> = [];
    app.onExit(() => void ran.push("close"));
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.err("boom"), io);
    expect(ran).toEqual(["close"]);
    expect(codes).toEqual([1]);
  });

  it("runs exit handlers newest first, each awaited, and skips a removed one (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    app.onExit(() => void order.push("close services"));
    app.onExit(async () => {
      await Promise.resolve();
      order.push("stop heartbeat");
    });
    const remove = app.onExit(() => void order.push("removed"));
    remove();
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.ok(undefined), io);
    expect(order).toEqual(["stop heartbeat", "close services"]);
    expect(codes).toEqual([0]);
  });

  it("still runs every handler when one throws, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    app.onExit(() => void order.push("close services"));
    app.onExit(() => {
      throw new Error("boom");
    });
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.ok(undefined), io);
    expect(order).toEqual(["close services"]);
    expect(codes).toEqual([1]);
  });

  it("on a signal runs the handlers, then waits for main to return, then exits 0 (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    let closed: () => void = () => undefined;
    const services = new Promise<void>((resolve) => {
      closed = resolve;
    });
    app.onExit((reason) => {
      order.push(`close services on ${reason.kind === "signal" ? reason.signal : reason.kind}`);
      closed();
    });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async () => {
      await services; // main waits on something the exit closes
      order.push("main returned");
      return jarl.ok(undefined);
    }, io);
    signal("SIGTERM");
    await running;
    expect(order).toEqual(["close services on SIGTERM", "main returned"]);
    expect(codes).toEqual([0]);
  });

  it("exits 1 at once on a second signal (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    app.onExit(() => new Promise<void>(() => undefined)); // a handler that never finishes
    const { io, codes, signal } = fakeIo();
    void app.main(() => new Promise<never>(() => undefined), io);
    signal("SIGINT");
    signal("SIGINT");
    expect(codes).toEqual([1]);
  });

  it("refuses a second main and runs nothing (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes } = fakeIo();
    let runs = 0;
    const main = async () => {
      runs += 1;
      return jarl.ok(undefined);
    };
    await app.main(main, io);
    const again = await app.main(main, io);
    expect(jarl.error.is(again, App.MainCalledTwice)).toBe(true);
    expect(runs).toBe(1);
    expect(codes).toEqual([0]);
  });
});
```

```ts
// @oligarchy/app/test/types.test.ts: type checks only. check:types fails when one breaks;
// nothing here calls main.
import * as jarl from "jarl";
import { describe, expectTypeOf, it } from "vitest";
import * as App from "../src/main.ts";
import { counter, greeter, type Counter, type Greeter } from "./support.ts";

type Reads = { readonly flags: { readonly name: string } };
const environment = { command: "", flags: { name: "ada" } } as const;

describe("App types", () => {
  it("files each service under its key, and keeps the environment's literals", () => {
    const app = new App.App(environment, { counter: counter(), greeter: greeter() });
    expectTypeOf(app.services.counter).toEqualTypeOf<Counter>();
    expectTypeOf(app.services.greeter).toEqualTypeOf<Greeter>();
    expectTypeOf(app.environment.command).toEqualTypeOf<"">();
  });

  it("refuses a wrong services object", () => {
    // @ts-expect-error a greeter is not a counter
    void new App.App(environment, { counter: greeter() });
    // @ts-expect-error clock is not a service
    void new App.App(environment, { clock: counter() });
    // @ts-expect-error a service, not an object of services
    void new App.App(environment, counter());
    // @ts-expect-error the fake has no read
    void new App.App(environment, { counter: { service: "counter", increment: () => undefined } });
  });

  it("checks main against the app", () => {
    const app = new App.App(environment, { counter: counter() });
    const counts = async (app: App.App<Reads, Counter>) => jarl.ok(app.services.counter.read());
    const greets = async (app: App.App<Reads, Greeter>) => jarl.ok(app.services.greeter.greet("x"));
    const readsAge = async (app: App.App<{ readonly flags: { readonly age: number } }, Counter>) =>
      jarl.ok(app.environment.flags.age);
    void (() => app.main(counts));
    void (() => app.main(async () => jarl.ok(undefined))); // asks for nothing: runs on any app
    // @ts-expect-error the app has no greeter
    void (() => app.main(greets));
    // @ts-expect-error the environment has no age
    void (() => app.main(readsAge));
  });

  it("checks what main and helpers use", () => {
    const greet = (app: App.Has<Greeter>) => app.services.greeter.greet("x");
    const main = async (app: App.App<Reads, Counter>) => {
      // @ts-expect-error main did not ask for a greeter
      void app.services.greeter;
      // @ts-expect-error greet needs a greeter
      greet(app);
      return jarl.ok(undefined);
    };
    void main;
  });

  it("takes exit handlers that take the reason or nothing", () => {
    const app = new App.App(environment, { counter: counter() });
    app.onExit(() => undefined);
    app.onExit(async (reason) => {
      expectTypeOf(reason).toEqualTypeOf<App.ExitReason>();
    });
    // @ts-expect-error a handler gets the reason, not a number
    app.onExit((count: number) => void count);
  });
});
```

## Build order

1. `@oligarchy/env`: export `Result` and `Vars`.
2. `@oligarchy/async`: `tick` awaits `fn`; `cancel` returns a promise that waits for a run in flight.
3. `@oligarchy/app`: `src/services.ts` (the `Services` interface, empty until the first service lands; `src/main.ts` re-exports it with `export *`), `src/app.ts` (`Needs`, `Has`, `Register`, `Signal`, `ExitReason`, `OnExit`, `Io`, `MainCalledTwice`, `App`), `src/main.ts` exporting them.
4. Services, one package each, added to `Services` as each lands: `log`, `sentry`, `db` (a port of `packages/db`: the pool, `run`, `transaction`, `ping` and the stores as operations; `DatabaseError` keeps `operation` and `cause`), `openrouter`, `linear`.
5. `@oligarchy/common`.
6. driver: replace `v2/packages/driver/src/main.ts`'s print with Example 1.
7. ctrl, one command per module, each its own `main`.
8. qemu-server last. It also needs `@oligarchy/http` (Hono and zod), the sessions service, `AbortSignal` passed through services, `AsyncDisposableStack` (add `esnext.disposable` to `lib`), a mutex with try-lock, and a bounded queue. Plan those separately.
