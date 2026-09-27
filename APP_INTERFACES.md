# App interfaces

## Services

A service is a data object with a fixed `service` name. Its functions take it first.

```ts
// @oligarchy/log
export type Log = { readonly service: "log"; readonly program: string };
export function open(options: { program: string }): Log;
export function info(log: Log, text: string): void;
export function error(log: Log, text: string, cause?: unknown): void;
export function flush(log: Log): Promise<void>;

// @oligarchy/db
export type Database = { readonly service: "db"; readonly url: Env.Secret; readonly log: Log.Log };
export function open(options: { url: Env.Secret; log: Log.Log }): Database;
export function close(db: Database): Promise<void>;
export function heartbeat(db: Database, row: { name: string; at: number }): Promise<jarl.Result<void, DatabaseError>>;
export function session(db: Database, id: string): Promise<jarl.Result<Session, DatabaseError>>;
export function saveRun(db: Database, run: { name: string; iso: string; ticket: string }): Promise<jarl.Result<string, DatabaseError>>;

// @oligarchy/sentry
export type Sentry = { readonly service: "sentry"; readonly program: string };
export function open(options: { program: string }): Sentry;
export function capture(sentry: Sentry, error: unknown): void;
export function flush(sentry: Sentry): Promise<void>;

// @oligarchy/openrouter
export type OpenRouter = { readonly service: "openRouter"; readonly token: Env.Secret };
export function open(options: { token: Env.Secret }): OpenRouter;
export function complete(openRouter: OpenRouter, prompt: string): Promise<jarl.Result<string, OpenRouterError>>;

// @oligarchy/linear
export type Linear = { readonly service: "linear"; readonly token: Env.Secret; readonly team: string };
export function open(options: { token: Env.Secret; team: string }): Linear;
export function fileTicket(linear: Linear, title: string): Promise<jarl.Result<string, LinearError>>;

// qemu-server/src/sessions.ts
export type Sessions = {
  readonly service: "sessions";
  readonly dataDir: string;
  readonly maxJobs: number;
  readonly live: Map<string, Session>;
};
export function open(options: { dataDir: string; maxJobs: number }): Sessions;
export function start(app: App.Has<Sessions | Log.Log>, request: Request): Promise<Response>;
export function drain(app: App.Has<Sessions | Db.Database | Log.Log>): Promise<jarl.Result<void, DrainFailed>>;
```

## App

```ts
// @oligarchy/app/src/services.ts: every service, one list
export type Services =
  | Log.Log
  | Db.Database
  | Sentry.Sentry
  | OpenRouter.OpenRouter
  | Linear.Linear
  | Sessions.Sessions;

// @oligarchy/app
App.App<Reads, Log.Log | Db.Database>  // app.environment: Reads; app.services.log, app.services.db
App.Has<Log.Log | Sentry.Sentry>       // any app with at least these services

export type ExitReason =
  | { readonly kind: "returned" }
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" };

export function create(options: {
  environment: Out;                     // what Env.create returned
  services: [log, db /* , ... */];      // each files itself under its `service` name
  main: (app: App.App<Reads, S>) => Promise<jarl.Result<unknown, unknown>>;
  onExit: (app: App.App<Reads, S>, reason: ExitReason) => Promise<jarl.Result<void, unknown>>;
}): App.App<Out, S>;
export function run(app: App.App<Out, S>): Promise<never>;
export function killable(app: App.Has<never>, kill: () => void | Promise<void>): () => void;
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

## Env (exists)

```ts
Env.cli({ name, description }).flags({ ... }).needs("databaseUrl").command(name, description) /* ... */ .done();
Env.create(definition): Promise<jarl.Result<Out, UsageError | HelpRequested | MissingVariable | ...>>;
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
  return jarl.ok(undefined);
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
  App.killable(app, stop);
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

await App.run(
  App.create({
    environment,
    services: [log, db, sentry, openRouter],
    main,
    onExit: Common.close,
  }),
);
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
  App.killable(app, async () => {
    await jarl.unwrap(Sessions.drain(app)); // a session that refuses to stop: exit 1
  });
  App.killable(app, () => Http.stop(server.value)); // newest first: stop taking requests first
  await Http.stopped(server.value);
  return jarl.ok(undefined);
};

const environment = await Common.load(definition);
const [log, db, sentry] = Common.open("qemu-server", environment.vars.databaseUrl);
const sessions = Sessions.open({
  dataDir: environment.flags.dataDir,
  maxJobs: environment.flags.maxJobs,
});

await App.run(
  App.create({
    environment,
    services: [log, db, sentry, sessions],
    main,
    onExit: Common.close,
  }),
);
```

## Example 3: ctrl, several commands

```ts
// ctrl/src/main.ts
import * as App from "@oligarchy/app";
import * as Common from "@oligarchy/common";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Linear from "@oligarchy/linear";
import * as Log from "@oligarchy/log";

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

type SessionReads = {
  readonly command: "session";
  readonly flags: { readonly sessionId: string };
};

const session = async (app: App.App<SessionReads, Common.Common>) => {
  const found = await Db.session(app.services.db, app.environment.flags.sessionId);
  if (found.ok) {
    Log.info(app.services.log, JSON.stringify(found.value));
  }
  return found;
};

const environment = await Common.load(definition);
const [log, db, sentry] = Common.open("ctrl", environment.vars.databaseUrl);

if (environment.command === "test run") {
  const linear = Linear.open({
    token: environment.vars.linearApiToken,
    team: environment.vars.linearTeam,
  });
  await App.run(
    App.create({
      environment,
      services: [log, db, sentry, linear],
      main: testRun,
      onExit: Common.close,
    }),
  );
} else {
  await App.run(
    App.create({ environment, services: [log, db, sentry], main: session, onExit: Common.close }),
  );
}
```
