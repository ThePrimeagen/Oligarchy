# Development

How code is written here: the Effect conventions every process follows, the tooling, the tests
and the review. It owns the abstract decisions and nothing else. What any one process promises its
callers — routes, flags, log lines, wire shapes, refusal texts — lives in its code and the tests
that pin it, and for operators in `client.md`, `ctrl.md`, `ctrl-linear.md`, `ctrl-diagnose.md`,
`SERVER_VS_REVERSE_PROXY.md` (the server and the reverse proxy side by side, and the reasons behind
the reverse proxy's design) and `prompts/`; this document does not repeat them. It does not
document the Effect API either; API truth is `node_modules/effect/src`,
`node_modules/effect/AGENTS.md`, `node_modules/effect/ai-docs/src`,
`node_modules/@effect/platform-node/src` and `node_modules/@effect/vitest/README.md`, all
`4.0.0-rc.112`, and a name that is not there does not
exist.

## Toolchain

- Run on Node 26 with npm. Every executable is a `#!/bin/sh` wrapper running
  `node --experimental-strip-types` (`./server`, `./reverse-proxy` and `./automation` add
  `--import ./src/observability/instrument.ts`); types are stripped, not transformed, so
  `erasableSyntaxOnly` stays on.
- Install with `npm ci`; `prepare` runs `effect-tsgo patch --oxlint` so the `effecttsgo/*` rules
  are active for lint. The commands: `npm run check:lint`, `npm run check:format`,
  `npm run check:types`, `npm run test:unit`, `npm run test:integration`, `npm run check:fast`
  (lint, format, types, unit in that order), `npm run db:generate`, `npm run db:migrate`,
  `npm run format`, `npm run dev` (the dashboard under wrangler). There is no bare `check`, `test`
  or `lint` script; `test/repo/scripts.unit.test.ts` keeps it that way. Local runs use a local
  Postgres migrated with `npm run db:migrate`, never the production `DATABASE_URL`.
- A `.env` in the working directory fills missing variables only; an already-set variable always
  wins, and an empty value counts as unset.

## Vocabulary

- When the user says "Kemu" (a speech-to-text rendering), they always mean QEMU. Read any such
  spelling as QEMU.
- When the user asks for a "DTS" (a `.d.ts`), they are asking for the module's exported interface:
  every type and function the module creates and exports, written as bare declarations, so the
  program can be understood from that surface alone. Never include imports in a DTS, not for any
  reason. A type that comes from a dependency stays opaque, with a comment naming what it is
  underneath.

## Philosophy

Durable preferences from the maintainer; when they conflict with generic best practice, they win.

- Optimize for the person reading the file top to bottom. No tiny single-use helpers, no layers,
  no interfaces with one implementation, no abstraction bought before it is needed.
- Support only what is used. An endpoint takes what its callers send and nothing else the
  implementation could accept; a status route answers the questions asked of it and nothing else.
- Trust the contracts of our own components: validate only at real boundaries, decode there exactly
  once, and write no code for a failure the contract rules out. A guard that stays names the real
  event it answers.
- Handle every real error, and a failure never takes down more than the operation it belongs to.
  The HTTP boundary answers every failure; every forked loop's tick is guarded. Startup
  requirements fail at startup: a process checks its host and pings its database before it listens.
- Owned state is the source of truth: how many of a thing are running is the size of the map that
  owns them, not a scan of the system. The database row is the truth for state that outlives the
  process.
- Nulls are a tax on every consumer. A window reports 0 before its first sample, not
  `number | null`; reserve `null` for an absence a consumer must distinguish and act on.
- Background work lives and dies with the server: a loop is `Effect.forkScoped` in the server
  scope, its tick is guarded, and its state is bounded; an unbounded exception is a policy with a
  comment naming why (see Log).
- Keep what earns its place, and let a name carry its reason: a path is absolutised because the
  server runs elsewhere; a key is omitted rather than sent empty because the server creates the
  default only when the key is absent; `MAX_SAMPLES = 60` carries "60 samples of 5 s is a
  five-minute window".
- Exact ports: never probe or fall back to a neighbouring port.

## Layout

- The root holds `AGENTS.md`, the executable wrappers (`./client`, `./client-with-image`,
  `./ctrl`, `./server`, `./reverse-proxy`, `./automation`, `./session`), the tooling files,
  `drizzle/` (migrations), `public/` and `prompts/`, the operator documents, this document, `src/`
  and `test/`.
- `src/` is one directory per process plus the shared kernel (`src/shared/`, `src/config.ts`,
  `src/external-failure.ts`, `src/observability/`, `src/db/`); `main.ts` files are the entries.
- `src/dashboard/` is a Hono Worker, not Effect: it has no Effect runtime, reaches Postgres
  through Hyperdrive and drizzle with one `pg.Client` per request ended in `finally` (a client
  left open holds a Hyperdrive connection past the response), never calls the proxy's API, and
  reports route failures with `@sentry/cloudflare` — the one `captureException` outside
  `observability/`, and with the test setup the one place `console.*` is allowed. Nothing below
  that says Effect applies to it.
- Files are kebab-case, one concept per file: `api.ts`, `contract.ts`, `errors.ts`, `config.ts`,
  `main.ts`, `<domain>.ts`. Tests mirror source names under `test/<dir>/<file>.unit.test.ts`;
  anything that spawns a process, opens a socket or needs Docker or QEMU lives under
  `test/integration/*.integration.test.ts`; fakes under `test/support/`.
- Import relative modules as namespaces with the `.ts` extension
  (`import * as Sessions from "./sessions.ts"`, `import type * as Domain from "./domain.ts"`);
  side-effect and asset imports are exempt. No barrels, no re-exports, no `export ... from`.
- Import Effect core from the barrel (`import { Effect, Layer, Schema } from "effect"`) and the
  rest by deep path: `effect/unstable/cli`, `effect/unstable/http`, `effect/unstable/httpapi`,
  `effect/unstable/process`, `effect/testing`, `@effect/platform-node`, `@effect/vitest`.
- Identifiers are `@oligarchy/<dir>/<file>/<Name>` for schemas, errors and `Context.Reference`s
  (`@oligarchy/shared/errors/BadRequest`, `@oligarchy/proxy/sessions/Shutdown`) and
  `@oligarchy/<dir>/<Service>` for services (`@oligarchy/db/Database`, `@oligarchy/proxy/Sessions`).
- Only the boundary files may import `node:*`, read `process.*`, or use `setTimeout`,
  `setInterval`, `new Promise` or `async`: every `src/**/main.ts` and the files named in
  `BOUNDARY_FILES` in `test/repo/architecture.unit.test.ts`, each the one place a Node API (a
  socket, a stream, a pool's error event, the tty, a timer) is wrapped into Effect. A non-boundary
  file that needs exactly one `node:*` module for something Effect lacks (a streaming hash, an
  inflate) is listed in `NODE_IMPORT_EXCEPTIONS` there with that module. A Promise SDK needs no
  exemption: it is wrapped in `Effect.tryPromise`. `src/dashboard/**` and `test/**` are not
  scanned. To add a boundary file or an exception, add it to the list with a comment naming why,
  in one change; nothing else grants it.

## Core rules

- Model domain values, API contracts, persisted data, and expected failures with Effect Schema.
- Never force a type with `as`, `as any`, or `as unknown as`. Decode unknown input, narrow it, use
  constructors, annotate it, or use `satisfies`. Literal `as const` is the only assertion.
- Expected failures are tagged schema errors; never expose a bare `Error` as a domain contract.
- Recover by tag with `Effect.catchTag`, `Effect.catchTags`, or `Match`; never by `instanceof`.
  Broad recovery belongs only at a runtime boundary that must produce a final response.
- Do not silence failures with `Effect.void`, `Effect.ignore`, or an unexplained default; the one
  exception is best-effort cleanup with a one-line comment naming why the failure is dropped.
- Never disable Schema checks. A failing constructor means the data or schema is wrong.
- Keep pure mapping, formatting, and object construction outside Effect (rendering, key encoding,
  argument building, wire framing, a grammar, an image decoder, the view half of an interactive
  view); a failure there is a `Result`, a thrown value from a library wrapped in one `try`.
- Reach services with `yield*` inside the Effect that needs them, never as function parameters; a
  plain factory taking values is allowed only where a unit test constructs the seam directly
  (`Database.make(url)`, `Stats.make(source)`, `makeProxyCommand(server)`,
  `makeReverseProxyCommand(server)`, `makeCtrlCommand(deps)`).
- Effect-native end-to-end: `Scope`, `Schedule`, `Clock`, `FileSystem`/`Path`,
  `ChildProcessSpawner`, `HttpClient`. Raw callback and Promise APIs, `async`/`await` included,
  appear only in the boundary files and `vitest.global-setup.ts`.
- Time comes from `Clock.currentTimeMillis` and `Clock.currentTimeNanos`, never `Date.now()` or
  `setTimeout`, so `TestClock.adjust` drives every timer in a test.
- No classes except the Effect declaration forms: `Schema.Class`, `Schema.TaggedError`,
  `Context.Service`, `HttpApiMiddleware.Service`, `HttpApiGroup`, `HttpApi`. Everything else is a
  `const` arrow function and a `type` alias.
- Comments say why, at decision sites only (a swallowed failure, an ordering, an upstream bug, a
  magic number), in one or two lines; never narration, doc comments or file headers.

## Services and layers

- Declare a service as `class X extends Context.Service<X>()("@oligarchy/<dir>/X", { make })` and
  give it `static readonly layer = Layer.effect(this)(this.make)`; derive the shape from `make` and
  never maintain a parallel interface. Why: one declaration is the type, the key and the layer.
  When `make` takes a value (a database url, a token) the layer is the matching function,
  `(url) => Layer.effect(this)(this.make(url))`.
- When a service is a plain value, declare `class X extends Context.Service<X, Shape>()(id) {}`
  with `type Shape` and build it with `Layer.succeed(X)(X.of({...}))`. Curried forms only.
- Acquire every long-lived resource with `Effect.acquireRelease` inside the layer effect; the
  release never fails (`Effect.catch` to a log line). `Effect.orDie` only where failure is
  impossible by construction; `Effect.die` only for invariants that cannot hold.
- Capture dependencies once in the layer effect and re-provide them per method with
  `Effect.provideService(Tag, value)`; never `Effect.provide(Layer.succeed(...))` at a call site.
- Compose the graph once, in `main.ts`, as `FooLive` constants reusing one layer reference per
  shared service. Why: layer memoisation is by identity, so two references mean two pools.
- `Layer.provide` for private dependencies, `Layer.provideMerge` when the dependency must stay
  visible, `Layer.mergeAll` for siblings, `Layer.unwrap` when a layer depends on a value,
  `Layer.effectDiscard` for background loops and fail-fast preconditions.
- Background fibers belong to the layer scope: `Effect.forkScoped`, never `Effect.runFork`. Do not
  use `Layer.fresh` in production, `ManagedRuntime`, or `Layer.catch` (not exported).
- `HttpRouter.serve` provides the module-level `HttpRouter.layer`, so two `HttpRouter.serve`s in
  one graph share one router and both listeners serve both route sets. A process has one
  listener; a page for an operator is the dashboard's, not a second port (below).
- `Effect.log*` is called only in `src/db/client.ts`: the pool's `error` listener and its release
  sit below `Log`, which does not exist yet when the pool is built.

The `Database` service in `src/db/client.ts` is the model: `makeDatabase(url)` normalises the URL,
acquires the pool without connecting under `Effect.acquireRelease`, re-enters Effect from
`pool.on("error")` with `Effect.runForkWith(context)`, and its release logs instead of failing.

A graph, from `src/proxy/main.ts`: one reference per service, a layer that depends on a value
unwrapped, and the reporter beneath the log so the log rows flush before the reporter does.

```ts
const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(
  SessionStore.SessionStore.layer,
  Actions.ActionStore.layer,
  Log.Log.layer,
).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
  Layer.provideMerge(NodeServices.layer),
);
```

## Errors

- Model every expected failure as
  `class X extends Schema.TaggedError<X>("@oligarchy/shared/errors/X")("X", fields, annotations?)`
  in `src/shared/errors.ts`; never `Data.TaggedError`, never a bare `Error` in an error channel.
- The class name equals the `_tag`; no `Error` suffix unless the concept is the error (`QmpError`,
  `DatabaseError`, `MissingVariable`). Never name a class `Error`.
- Construct with `.make`; raise with `return yield* X.make({...})` (instances are yieldable).
- Every error has an operator-facing `message` field or getter and structured fields
  (`operation`, `sessionId`, `agentId`, `command`); when wrapping a thrown value, carry
  `cause: Schema.optionalKey(Schema.Defect())`, or `cause: Schema.Defect()` when there always is
  one. The boundary renders `message[: cause message]`.
- Put the HTTP status on the class once, as `{ httpApiStatus: N }`; the wire codec derives it
  (`wireError(schema, fromMessage)` ends in `HttpApiSchema.status(httpStatus(schema))`), so the
  two cannot disagree. Handlers never build error responses. `Errors.httpStatus(schema)` reads the
  annotation (500 when absent); `Errors.apiStatus(error)` looks the class up in a table that
  `satisfies Record<ApiError["_tag"], Schema.Top>`, so a tag without an arm does not compile.
- Mark every API error class, 4xx and 5xx alike, with `override readonly [ErrorReporter.ignore] =
  true` and nothing else: no `[ErrorReporter.attributes]` getter (the reporter never reads one on
  an ignored error). Why: the boundary middleware logs each failed request once, attributing
  `sessionId`/`agentId` itself from the error's fields, and that line is the single Sentry report
  (with the cause from 500 up); HttpApiBuilder's own is silenced.
- Fixed-message errors take a constructor default, so `Unauthorized.make({})` is valid and
  `Internal.make({ cause })` fills its message.
- The wire body of every API error is `{ "error": "<message>" }`. The class is what handlers raise;
  its `*Wire` codec (`Schema.decodeTo` + `HttpApiSchema.status`) is what `api.ts` declares. Why:
  the REPL, the tests and the operator docs all parse `{ error }`. A decoded 500 is an `Internal`
  whose `cause` is `null`: the wire only says "internal error".
- Translate infrastructure failures once, at the module boundary, with one helper per module
  (`Database.run`/`Client.attempt`, the HTTP client's `run(label, effect)`, `Process.detail`);
  classify an `HttpClientError` by its `response` status and `error.reason`, never by message;
  convert `unknown` thrown values with the probes in `src/external-failure.ts` (`messageOf`,
  `describeThrowable`, `causeOf`; there is no `ExternalFailure` class), `causeOf` unwrapping a
  wrapper where the line should name the driver's or Node's message; wrap Promise SDKs with
  `Effect.tryPromise({ try, catch })` and a typed `catch`.
- One error class per external client, its `message` a fixed `<client>: <what>` sentence, a
  non-2xx status carried as a field, the thrown value as `cause`, and a `retryable` flag when the
  SDK can say so.

`BadRequest` in `src/shared/errors.ts`: status on the class, opted out of Sentry, nothing else.

```ts
export class BadRequest extends Schema.TaggedError<BadRequest>(
  "@oligarchy/shared/errors/BadRequest",
)(
  "BadRequest",
  {
    message: Schema.String,
    sessionId: Schema.optionalKey(Schema.String),
    agentId: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 400 },
) {
  override readonly [ErrorReporter.ignore] = true;
}
```

Its wire codec, same file: `{ error }` on the wire, the class on the type side, the class's own
status on the codec.

```ts
const WireBody = Schema.Struct({ error: Schema.String });

// { error: string } on the wire, the class on the type side, the class's own status on the codec.
const wireError = <S extends Schema.Codec<unknown, { readonly message: string }>>(
  schema: S,
  fromMessage: (message: string) => S["Encoded"],
): Schema.Codec<S["Type"], { readonly error: string }> =>
  WireBody.pipe(
    Schema.decodeTo(
      schema,
      SchemaTransformation.transform<S["Encoded"], { readonly error: string }>({
        decode: ({ error }) => fromMessage(error),
        encode: (encoded) => ({ error: encoded.message }),
      }),
    ),
    HttpApiSchema.status(httpStatus(schema)),
  );

export const BadRequestWire = wireError(
  BadRequest,
  (message) => ({ _tag: "BadRequest", message }) as const,
);
```

The boundary renderer in `src/observability/render.ts`, `renderFailure(cause)`, is `""` for an
interrupt-only cause, otherwise `headline(Cause.squash(cause))` (the message, then `: <cause
message>` when the error carries one) and `Cause.pretty(cause)`, printed once at the process
boundary.

## Schema

- Use `Schema.Class<X>("@oligarchy/<dir>/<file>/X")({...})` for exported records that cross a
  boundary (`contract.ts`); `Schema.Struct` for local, wire-probe, or row shapes;
  `Schema.TaggedUnion` for closed sum types keyed on `_tag`, built with `.cases.Tag.make` and
  eliminated with `.match`; `Schema.Literals([...])` for closed vocabularies, whose `.literals`
  feed `Flag.choice` so the vocabulary and the flag cannot drift.
- When the wire discriminates on a field other than `_tag`, use `Schema.Union` of
  `Schema.Struct`s with a `Schema.Literal` discriminant and dispatch with a `switch` ending in
  `satisfies never`, or with `"key" in message` when only one key differs. Never rename wire
  fields.
- Give every exported schema a namespaced identifier (the first argument of `Schema.Class` and
  `Schema.TaggedError`, `.annotate({ identifier })` on a union or literal set); match by `_tag`,
  never by identifier; export the domain name (`FollowEvent`, not `FollowEventSchema`).
- Brand ids with `Schema.String.check(Schema.isUUID()).pipe(Schema.brand("SessionId"))`; bound
  scalars with `Schema.Number.check(Schema.isBetween({ minimum, maximum }, { message }))`; brands
  live in `src/shared/domain.ts`, `Schema.is(Brand)` is the guard.
- Decode `unknown` exactly once at the boundary and choose the runner by failure semantics:
  `Schema.decodeUnknownEffect` when failure belongs in the error channel,
  `Schema.decodeUnknownOption` for probes and "absence is the contract",
  `Schema.decodeUnknownSync` for trusted module-load data and tests, `Schema.decodeUnknownExit`
  when the decoder must stay a pure function (a `Result` in a framing module). Hoist decoders to
  module constants. Never inspect `unknown` with `typeof`, property fishing, or assertions.
- JSON that crosses a wire or lands on disk goes through
  `Schema.fromJsonString(Schema.toCodecJson(S))`, bound once beside the schema. Why: a later `Date`,
  `Option` or class field cannot silently invalidate the boundary.
- `Schema.optionalKey` means the key may be absent (the type excludes `undefined`); `Schema.NullOr`
  means the wire carries `null`; never conflate them. Build optional keys without a conditional
  spread: call `.make` twice or use `Object.assign(base, cond ? { key } : undefined)`.
- Use `Schema.decodeTo(Target, SchemaTransformation.transform({ decode, encode }))` when the wire
  shape differs from the owned shape. Never `Schema.Record(Schema.String, Schema.Unknown)`; use
  `Schema.Json` (an argument bag is `Schema.Record(Schema.String, Schema.Json)`); a probe that
  must accept anything under one key uses `Schema.Unknown` for that key alone.
- Decode an external API's response in two phases when the wire carries errors beside data (a
  GraphQL envelope): the envelope with `HttpClientResponse.schemaBodyJson` (`data` as
  `Schema.Unknown`, `errors` as `{ message }[]`), then `Schema.decodeUnknownEffect(data)` once
  `errors` is empty and `data` present. Why: both arrive together, and the operation's shape must
  not swallow the failure text.
- `Schema.Class` encoders require class instances, so encode values produced by `.make` or
  decoding; every `HttpApiClient` payload is built with the contract class's `.make`. Never add
  Zod.

`FollowEvent` in `src/shared/domain.ts`: a `type`-keyed union in the wire's key order, its JSON
codec bound beside it.

```ts
export const FollowEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session"), status: FollowStatus }),
  Schema.Struct({
    type: Schema.Literal("intent"),
    state: Schema.Literal("started"),
    message: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("intent"),
    state: Schema.Literals(["completed", "cancelled"]),
  }),
  Schema.Struct({
    type: Schema.Literal("action"),
    id: Schema.Int,
    name: ActionName,
    state: Schema.Literal("running"),
  }),
  Schema.Struct({ type: Schema.Literal("action"), id: Schema.Int, state: ActionState }),
  Schema.Struct({ type: Schema.Literal("image"), id: Schema.String, png: Schema.String }),
]).annotate({ identifier: "@oligarchy/shared/domain/FollowEvent" });
export type FollowEvent = typeof FollowEvent.Type;
export const FollowEventLine = Schema.fromJsonString(Schema.toCodecJson(FollowEvent));
const encodeFollowEvent = Schema.encodeSync(FollowEventLine);
const decodeFollowEvent = Schema.decodeUnknownEffect(FollowEventLine);
export const encodeFollowLine = (event: FollowEvent): string => `${encodeFollowEvent(event)}\n`;
export const decodeFollowLine = (line: string): Effect.Effect<FollowEvent, Schema.SchemaError> =>
  decodeFollowEvent(line);
```

## Config

- Declare every variable a process reads in `src/config.ts`; domain code never calls
  `Config.string("KEY")` or reads `process.env` (a host probe of the environment is a host check,
  not configuration). Consumers import it as `Config`; the module imports Effect's as
  `import { Config as EffectConfig } from "effect"`.
- Read with `Config.nonEmptyString`, `Config.redacted`, `Config.string`; secrets are `Redacted`
  from parse to use and unwrapped with `Redacted.value` exactly once at the SDK or header boundary.
- Install the provider once at the entry with `Config.providerLayer`
  (`Layer<never, never, FileSystem>`): `ConfigProvider.fromEnv()` first,
  `ConfigProvider.fromDotEnv({ path: ".env" })` filling missing keys only when `.env` exists,
  joined with `ConfigProvider.orElse`; an unreadable `.env` is a defect. Why: an already-set
  injected variable is never replaced by a file. `fromEnv` treats an empty value as absent.
- Report a missing or invalid variable as `MissingVariable { name }`, rendered exactly
  `<NAME> is not set`; never a stack trace, never the value. The accessors are `Config.required`
  and `Config.requiredRedacted` (Effects failing `MissingVariable`), one named accessor per
  variable, a `Config.Config<string>` where a flag falls back to it
  (`Flag.withFallbackConfig`), and a `Context.Service` where a process reads a fixed set.
- Report order is fixed: a process reads its variables sequentially (`Effect.all` on an object,
  with a comment saying so), after parsing but before any work, so the first name reported is
  always the same one.
- Configuration is either a hardcoded constant or a required value, never a silent optional; CLI
  knobs (`isTTY`, `FORCE_COLOR`, `TERM`, `execPath`) are read in `main.ts` and `render.ts` only.

`src/config.ts` (an excerpt): the provider chain, one accessor family and a process's pair.

```ts
export const providerLayer: Layer.Layer<never, never, FileSystem.FileSystem> = ConfigProvider.layer(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const env = ConfigProvider.fromEnv();
    const hasDotEnv = yield* fs.exists(".env").pipe(Effect.orElseSucceed(() => false));
    if (!hasDotEnv) {
      return env;
    }
    const dotEnv = yield* ConfigProvider.fromDotEnv({ path: ".env" }).pipe(Effect.orDie);
    return ConfigProvider.orElse(env, dotEnv);
  }),
);

const missing = (name: string) => () => Errors.MissingVariable.make({ name });

export const requiredRedacted = (
  name: string,
): Effect.Effect<Redacted.Redacted, Errors.MissingVariable> =>
  EffectConfig.redacted(name).pipe(Effect.mapError(missing(name)));

export const oligarchyToken = requiredRedacted("OLIGARCHY_TOKEN");
export const databaseUrl = requiredRedacted("DATABASE_URL");

export class ProxyConfig extends Context.Service<ProxyConfig>()("@oligarchy/config/ProxyConfig", {
  // Sequential on purpose: OLIGARCHY_TOKEN is reported before DATABASE_URL.
  make: Effect.all({ token: oligarchyToken, databaseUrl }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
```

## CLI

- Build the tree with `Command.make(name, { flags }, handler).pipe(Command.withDescription(...))`;
  groups are `Command.make("group").pipe(Command.withDescription(...),
  Command.withSubcommands([...]))`. A group may carry its own flags and handler for the bare form;
  a handler-less root fails with `ShowHelp({ errors: [] })` and exits 0.
- Declare flags with `Flag.string/boolean/integer/float/choice/choiceWithValue(name).pipe(
  Flag.withSchema, Flag.withDefault, Flag.withAlias, Flag.optional,
  Flag.withFallbackConfig(Config.x), Flag.withDescription)`; every `Flag.boolean` carries
  `Flag.withDefault(...)` (`test/repo/architecture.unit.test.ts` checks it). A flag that is
  required only in a group's bare form is required through that same call,
  `Flag.withDefault(Effect.fail(new CliError.MissingOption({ option })))`. Shared flags are
  factories in one `flags.ts` per CLI, spread into each command's flag config. A value the schema
  can refuse (a uuid, a range, a vocabulary) is refused at the flag, with the flag's own message.
- Handlers are `Effect.fn("<cli>.<action>")` bodies that `yield*` services, print with
  `Console.log` (stdout) and `Console.error` (stderr), and end with a domain result. Why:
  `TestConsole` captures `Console`, not `process.stdout`. Raw bytes go through
  `Stream.run(Stream.make(bytes), stdio.stdout())` with `stdio = yield* Stdio.Stdio`; a file is
  written with `fs.writeFile(path, bytes, { mode: 0o644 })`.
- A handler's refusals come in a fixed order: configuration first, local checks second, the
  request last, so the first line a caller sees is always the same one for the same mistake. A
  local refusal is a `CommandError` with a sentence that names the flags; a platform failure keeps
  Node's own message one level down, never the `PlatformError` wrapper.
- `--help` is side-effect free: no network, no database, no spawn. No business logic in the CLI.
- Run with `Command.run(cmd, { version: Api.VERSION })` (argv from `Stdio`, provided by
  `NodeServices.layer`). It renders help, usage errors and `UserError`s itself before re-failing;
  `--help` on a command with a handler succeeds, a bare group fails `ShowHelp` with no errors, and
  `Runtime.errorExitCode` gives both exit 0. At the boundary a `CliError` therefore needs no
  rendering; any other failure gets `renderFailure` on stderr and exits 1. `Render.reportFailure`
  is that one print for every CLI, applied outside `Effect.provide(MainLive)` so a layer failure
  (an unreadable `.env`) prints its cause too. Never mutate `process.exitCode`.
- Every CLI's `MainLive` provides `CliOutput.layer` and `CliConfig.layer` without the wizard
  builtin (below); the `--log-level` builtin stays and is a no-op for `Log` lines.
- Exit codes: 0 on success and 1 on any failure; `--help` and a bare group 0; an unknown action is
  an Effect CLI usage error, exit 1.
- The action is the first argument; flags follow in any order as `--flag value` or `--flag=value`,
  kebab-case only. A command takes its dependencies as layer factories (`makeXCommand(deps)`,
  `live` by default) so a test substitutes fakes; a flag pair that cannot combine is a
  `CliError.UserError` the CLI renders, never a fatal log line.

`src/client/main.ts`: the whole entry.

```ts
const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  NodeHttpClient.layerNodeHttp,
  Config.providerLayer,
).pipe(Layer.provideMerge(NodeServices.layer));

const main = Command.run(ClientCommand.makeClientCommand(), { version: Api.VERSION }).pipe(
  Effect.provide(MainLive),
  Effect.scoped,
  Effect.tapCause(Render.reportFailure),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
```

## HttpApi server

- The contract lives in three files: `src/shared/api.ts` (middleware tags, `HttpApiEndpoint`s,
  the groups, the `HttpApi`s, `VERSION`), `contract.ts` (`Schema.Class` DTOs and shared query field
  objects), `errors.ts` (errors and wire codecs). No handler code lives there; `HttpApiEndpoint`,
  `HttpApiGroup.make`, `HttpApi.make` appear only in `api.ts` (the architecture test checks it).
- A second `HttpApi` that must be reachable by the client generated from the first (the reverse
  proxy in front of the proxy) is built from the first's `HttpApiEndpoint` values, never from
  redeclared paths, so methods, paths, queries and bodies cannot drift. An error the second api
  raises and the first never does gets its codec on a second boundary middleware tag (rc.112 has
  no way to add an error to an endpoint value, and the first api must not advertise a status it
  never answers); the two tags wrap one boundary implementation.
- A pass-through handler decodes nothing of the upstream answer: it forwards the request's own
  `url`, the cached body text (HttpApi already decoded it, so `request.text` cannot fail a second
  time) and the bearer, and returns `HttpServerResponse.stream(response.stream, { status, headers
  })` with only the headers the contract names, so the upstream's refusal reaches the client as
  written and is not logged twice. The status is on the wire before the body can fail, so the
  stream is tapped for the one error line a mid-stream death leaves.
- A page for an operator's browser has no bearer to send, so no Effect process serves one: the
  page is the dashboard's (`src/dashboard/`), behind its access control, and reads rows. What it
  shows of a process is what that process wrote on a schedule (the server's `servers` row every
  thirty seconds, its `generation` counting the writes, so a number that stops moving is a process
  that stopped), never a call into the process from the Worker. The page is text: a table, a
  form, and htmx polling one fragment at the interval the rows are written at; a value from a
  row goes into it through JSX, never a string template.
- Declare endpoints as `HttpApiEndpoint.get/post(name, path, { params, query, payload, success,
  error })`; binary via `Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType }))`,
  headers via `HttpApiSchema.WithHeaders`, byte streams via `HttpApiSchema.StreamUint8Array`.
- Group with `HttpApiGroup.make(name).add(...).middleware(Auth).middleware(Boundary)`; middleware
  `error` schemas merge into every endpoint of the group, so 400/401/500 are not listed per
  endpoint. Middlewares wrap in insertion order, so the boundary is outermost and logs a refused
  bearer. A missing bearer header arrives as `Redacted.make("")`.
- Implement groups with `HttpApiBuilder.group(Api, name, (handlers) => handlers.handle(endpoint,
  ({ payload, query, params }) => Effect.gen(...), { uninterruptible: true }))`, each handler
  `yield*`ing its service and consuming the decoded contract. Handlers that drive a resource are
  uninterruptible (a client that disconnects mid-start must not leave an orphan process); reads
  and streams are interruptible. `handleRaw` when the handler owns the `HttpServerResponse` (a
  stream, a raw 404 that must not be logged). Merge `HttpApiBuilder.layer(Api)` over the groups and middlewares with the catch-all
  `HttpRouter.add("*", "*", notFound)`, the only route outside the api.
- The boundary middleware turns `HttpApiError.HttpApiSchemaError` into `BadRequest` (400),
  re-fails a declared `ApiError`, sends anything else down the defect path, turns a defect into
  `Internal` (500), and logs every failed request as one error line `<METHOD> <url> failed:
  <detail>` attributed as far as the handler knew, with `skipSentry` below 500 and the cause from
  500 up. `detail` is the error's `message`, except for `Internal`, whose cause is a wrapper (a
  driver's `Failed query: …`, a `PlatformError`): the line carries `causeOf(error.cause)`, the
  driver's or Node's message one level down. A defect's detail is `Cause.pretty` of the die.
- Serve with `HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true })` (never
  Effect's built-in request logger) over `NodeHttpServer.layer(() => server, { host, port })`.
- Provide `Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)` so no `http.server` span
  reaches Sentry and a domain span stays a root. Fail before listening when the host check or the
  database ping fails; never fall back to another port.

`BearerAuth`, declared in `api.ts` as `HttpApiMiddleware.Service<BearerAuth>()(id, { error:
Errors.UnauthorizedWire, security: { bearer: HttpApiSecurity.bearer }, requiredForClient: true })`
and implemented as `BearerAuthLive` in `src/proxy/middleware.ts`: compare, then run the request.

```ts
export const BearerAuthLive: Layer.Layer<Api.BearerAuth, never, Config.ProxyConfig> = Layer.effect(
  Api.BearerAuth,
)(
  Effect.gen(function* () {
    const config = yield* Config.ProxyConfig;
    return Api.BearerAuth.of({
      bearer: (httpEffect, { credential }) =>
        Redacted.value(credential) === Redacted.value(config.token)
          ? httpEffect
          : Effect.fail(Errors.Unauthorized.make({})),
    });
  }),
);
```

`ApiBoundaryLive`, same file (an excerpt; `translate`, `detail` and `report` are its private
helpers): schema errors to 400, defects to 500, one log line per failed request.

```ts
export const ApiBoundaryLive: Layer.Layer<Api.ApiBoundary, never, Log.Log> = Layer.effect(
  Api.ApiBoundary,
)(
  Effect.gen(function* () {
    const log = yield* Log.Log;
    return Api.ApiBoundary.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const failed = (text: string, how: Log.Report) =>
          log.error(`${request.method} ${request.originalUrl} failed: ${text}`, how);
        return yield* httpEffect.pipe(
          Effect.catch(translate),
          Effect.tapError((error) => failed(detail(error), report(error))),
          Effect.catchDefect((defect) =>
            failed(Cause.pretty(Cause.die(defect)), { cause: defect }).pipe(
              Effect.andThen(
                Effect.fail(Errors.Internal.make({ message: "internal error", cause: defect })),
              ),
            ),
          ),
        );
      }),
    );
  }),
);
```

## HttpApi client

- Derive the client from the same `HttpApi`: `HttpApiClient.make(Api, { baseUrl,
  transformClient: HttpClient.filterStatusOk })`, bearer injected once through
  `HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
  next(HttpClientRequest.bearerToken(request, token)))`. Build every payload with the contract's
  `.make`. Why `filterStatusOk`: every non-2xx answer is refused before the generated client
  decodes it, so a declared error status with a body that is not `{ "error" }` cannot be combined
  with its schema failure.
- Provide the transport once at the root with `NodeHttpClient.layerNodeHttp`. Why: it has no
  undici header or body timeout, so a call that legitimately waits a long time and an unbounded
  stream both survive. A call that must not wait forever carries its own
  `Effect.timeoutOrElse({ duration, orElse })`; a stream goes through the raw `HttpClient` with
  `bearerToken`, has no timeout, and hands back `response.stream` unbuffered.
- Wrap every call in one `run(label, effect)` (`label` is `<METHOD> <url> failed`) that maps an
  `HttpClientError` with a non-2xx response to a refusal error `{ status, message }`, the message
  read from the raw body (the `error` string of a `{ "error" }` body, any other body raw, an
  empty body a fixed sentence); one without a response to an unreachable error `{ message: label,
  cause }` (the headline appends the cause); a `SchemaError` on a success body to the same; a
  decoded `ApiError` to a refusal with `apiStatus(error)`, never on its `_tag`.
- Fake HTTP in tests with `HttpClient.make((request, url) => Effect.succeed(response))` provided as
  `Layer.succeed(HttpClient.HttpClient)(fake)` (`test/support/fake-http.ts`: `respondWith`,
  `recordRequests`, `json`, `never`, `die`); never stub `globalThis.fetch`.
- Describe a third party's HTTP API as one `HttpClientRequest` per operation, the token set once
  on the request from its `Redacted`, the response decoded as Schema says (two phases for an
  envelope). Wrap a Promise SDK in one file, in `Effect.acquireUseRelease` around its client's
  create, use and close, each call `Effect.tryPromise({ try, catch })` with a typed `catch`. A
  command that starts remote work prints where to watch it and never waits for it.

## Child processes

- Spawn through `effect/unstable/process`: `ChildProcess.make(executable, args, { cwd, env,
  extendEnv, stdin, stdout, stderr, detached, killSignal, forceKillAfter })` handed to
  `spawner.spawn` from `ChildProcessSpawner` (a scoped handle: `pid`, `exitCode`, `isRunning`,
  `kill`, `stdout`, `stderr`), the one-shot `spawner.exitCode` when the exit code is the answer,
  or `spawner.string(command, { includeStderr: true })` when the output is.
- Leaving the scope stops the child: the spawner's own release sends `killSignal`, escalates to
  `SIGKILL` after `forceKillAfter`, and awaits the exit. Add a finalizer only to record an expected
  exit. A child the process manages for its lifetime is spawned with `stdin: "ignore"`,
  `stdout: "ignore"`, `stderr: "pipe"` (the tail is the diagnostic), `killSignal: "SIGTERM"` and a
  bounded `forceKillAfter`, so a wedged child cannot hold the operation that stops it.
- `env` replaces the inherited environment unless `extendEnv: true`; a child that needs the
  parent's variables uses `extendEnv: true`, and nothing secret is on argv: secrets go to children
  on stdin as a `Stream`. A child that must survive a hangup reaching the foreground group is
  `detached: true`; one that should die with the foreground stays attached.
- Keep the last 4096 bytes of stderr in a `Ref` drained by a `forkScoped` fiber; publish exit
  through a `Deferred<number | null>` (`null` for a signal death); join the drain fiber before
  reading the tail after exit, so the failure carries the whole tail. Readiness is a bounded wait
  (`Effect.timeoutOrElse`); a dead child is noticed by the next command failing, not by a watcher.
- Register the finalizer that must run last first: a directory's removal is added before anything
  created inside it, so the child is dead and its socket closed before the directory goes.
- File I/O goes through `FileSystem.FileSystem` and `Path.Path` from `NodeServices.layer`; write
  private files atomically (`writeFile(tmp, bytes, { mode: 0o600 })` then `rename`), create
  private directories with `makeDirectory(dir, { recursive: true, mode: 0o700 })`, recover
  `PlatformError` by `error.reason._tag === "NotFound"` and map every other platform failure at the
  module boundary. A download is written as `<path>.partial-<pid>` then renamed. URLs are WHATWG
  `URL`/`URL.canParse`; Effect's `Url` module is unused.

## Database

- One `Database` service in `src/db/client.ts` owns one scoped `pg.Pool`: `Effect.acquireRelease`,
  `pool.on("error")` re-entering Effect with `Effect.runForkWith(context)`, released with
  `pool.end()` whose failure is logged (`db: pool close failed: <detail>`), never raised. The pool
  does not connect at acquire; a process that needs the database pings it (`select 1`) at startup
  (`database unreachable: <detail>`).
- Drizzle 0.45 (`drizzle-orm/node-postgres`) with drizzle-kit 0.31 and `pg`, behind the service.
  Why not drizzle 1.0: its kit rewrites `drizzle/`, and migrations are append-only. Why not
  `@effect/sql-pg`: the schema and the migrations stay as they are and the service is the Effect
  boundary. Every query uses Drizzle; never the driver's query API, another ORM, or ad-hoc SQL.
- The service exposes `run`, `transaction` and `ping`, not the raw drizzle instance.
  `run(operation, (db) => promise)` is `Client.attempt(operation, thunk)` over the instance:
  `Effect.tryPromise` into one `DatabaseError { operation, message, cause }` whose `message` is
  the driver's and `cause` the driver error's own `cause` (`causeOf`), so the headline reads
  `Failed query: ...: connect ECONNREFUSED ...`.
- `transaction(operation, (tx) => Effect)` is `Client.runInTransaction(operation, (fn) =>
  db.transaction(fn), body)`: the body runs inside drizzle's promise `transaction` with
  `Effect.runPromiseExitWith(context)`; a failing body throws its `Exit` so drizzle rolls back, and
  the body's own `Cause` is re-raised with `Effect.failCause`; a driver rejection outside the body
  is a `DatabaseError`. Inside a body every drizzle call is wrapped in `Client.attempt`; bodies
  only run queries and never acquire a scope.
- Multi-step writes run in one transaction: a state change and the rows that record it land
  together, stamped with one `now()`.
- The URL is checked with `URL.canParse`, never by letting `new URL` throw: that `TypeError`
  carries the password into the logs. A driver-specific rewrite of the URL lives in the client
  with a comment naming the driver behaviour it works around.
- Repositories are `Context.Service`s whose methods are `Effect.fn("db.<name>")` functions that
  `yield* Database` once in `make`. Drizzle-typed columns are trusted; `jsonb` columns are written
  from schema-typed values and read back as Drizzle types them. Row stamps come from Postgres
  `now()` in the statement; Effect-side time from `Clock.currentTimeMillis`. A "create once" is a
  primary key or a unique index, so a second write is a `DatabaseError` by design, never a
  pre-check. An update omits an absent key rather than writing `null` (drizzle writes `null` but
  skips an absent key), so an earlier command's value stays. A `pgEnum` and its `Schema.Literals`
  twin in `domain.ts` are maintained by hand together; a vocabulary that grows at runtime is a
  lookup table, not an enum (an enum value is a code change and a migration and can never be
  removed; a row is an insert). A lookup that may find nothing answers an `Option`.

`Client.runInTransaction` in `src/db/client.ts`: one re-entry, the body's cause re-raised as
itself.

```ts
export const runInTransaction = <TX, A, E, R>(
  operation: string,
  begin: (body: (tx: TX) => Promise<A>) => Promise<A>,
  body: (tx: TX) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Errors.DatabaseError, R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const rolledBack: { cause: Cause.Cause<E> | undefined } = { cause: undefined };
    const attempted: Effect.Effect<A, Cause.Cause<E> | Errors.DatabaseError> = Effect.tryPromise({
      try: () =>
        begin(async (tx) => {
          const exit = await Effect.runPromiseExitWith(context)(body(tx));
          if (Exit.isSuccess(exit)) {
            return exit.value;
          }
          rolledBack.cause = exit.cause;
          throw exit;
        }),
      catch: (thrown) => rolledBack.cause ?? databaseError(operation, thrown),
    });
    return yield* Effect.catch(
      attempted,
      (failure): Effect.Effect<never, E | Errors.DatabaseError> =>
        Cause.isCause(failure) ? Effect.failCause(failure) : Effect.fail(failure),
    );
  });
```

Repositories call `database.transaction("endSession", (tx) => Effect.gen(...))` and wrap each
statement inside with `Client.attempt("endSession", () => tx.update(...))`.

## Log

- Application code logs through the `Log` service (`src/observability/log.ts`): `info`, `warning`,
  `error`, `fatal`, `acquireColor`, `releaseColor`, `flush`. Messages are fixed sentences; every
  variable is in the attribution (`sessionId`, `agentId`) or in the text after the `;`, as in
  `log.info(\`running; started in ${String(ms)}ms\`, { sessionId, agentId })`.
- Each line is written twice: to stdout through `Console.log` when the method runs, and as a
  `logs` row `Queue.offerUnsafe`d to a `Queue.unbounded` drained by one `forkScoped` fiber that
  inserts in call order. The queue is unbounded by policy: a log call never blocks or drops a row
  because the database is slow; a long outage costs memory, accepted. A failed insert writes
  `db: log insert failed: <cause message>` to stdout, reports it to Sentry as a defect, and never
  fails the caller. `id`, not `created_at`, orders rows.
- stdout is the convenience copy; the rows and Sentry are the record. A process's `main.ts`
  attaches a no-op `error` listener to `process.stdout` and `process.stderr`, so a write refused by
  a full filesystem (`ENOSPC`) drops that line instead of raising an uncaught exception per line.
- The stdout line carries the attribution as a coloured prefix and non-info lines a `<level>: `
  prefix; a colour is taken by `acquireColor` when an agent's work starts and released by
  `releaseColor` when it ends, and `emit` only looks it up, so an unknown agent stays gray and a
  failed request cannot grow the palette. Colour is the `Log.Colors` `Context.Reference`,
  defaulting to `Render.stdoutColors` (a TTY or `FORCE_COLOR`, and `hasColors(16)`); tests
  override it. The row is the original text, level and attribution; prefix and colour are stdout
  only.
- Levels are the `log_level` enum in ascending severity and mean severity of the operation, not of
  the state recorded: `info` is the normal story, a verdict included; `warning` is degraded but
  went on; `error` is an operation that failed (one line per failed request from the HTTP
  boundary, a defect with its stack); `fatal` is the process going down, written right before the
  exit.
- `error` and `fatal` report to the `ErrorReporter`s captured when the layer was built, unless
  `skipSentry` is set: always as `Cause.fail(Errors.LogLine.make({ text, level, cause? }))`, so the
  line's own `[ErrorReporter.severity]` carries the level. The reporter hands Sentry the `cause`
  when the line has one (what Sentry groups on) and the `LogLine` itself otherwise, at the line's
  level either way: `log.fatal("…", { cause })` arrives as `fatal`, never `error`. 4xx request
  refusals set `skipSentry`: they are the client's mistake.
- `flush` resolves when every offered row has been inserted or its failure reported; the layer
  finalizer runs `flush` before the drain fiber is interrupted, and `Log.layer` (over `LogStore`)
  sits above `Database` so the flush completes before the pool closes. `Log.layer` reads
  `ErrorReporter.CurrentErrorReporters` once at build, so `SentryLive` is provided beneath it,
  never only to callers. `Log.layerStdout` persists nothing: it is for tests and for a process
  that keeps no rows (the automation service), whose record is stdout and Sentry. A fatal path
  flushes the log, then Sentry, then exits.
- `Log` installs no Effect `Logger`; `emit` formats, writes and offers synchronously. `console.*`
  appears only in `src/dashboard/**` and `vitest.global-setup.ts`. Test log output through the
  fake `Log` layer (`test/support/log.ts`) or `Log.layerStdout` with `TestConsole.logLines`.

## Sentry

- Initialise the SDK before any Effect code in `src/observability/instrument.ts`, loaded by the
  `server`, `reverse-proxy` and `automation` wrappers' `--import`: `Sentry.init({ dsn: SENTRY_DSN,
  tracesSampleRate: 1,
  traceLifecycle: "stream", integrations: [Sentry.httpIntegration({ spans: false }),
  Sentry.nativeNodeFetchIntegration({ spans: false })] })`. `SENTRY_DSN` in `dsn.ts` is the one
  hard-coded constant (public by design) and is shared with the dashboard.
- `@sentry/node` and `@sentry/effect` are imported only in `src/observability/`;
  `@sentry/cloudflare` only in `src/dashboard/`. All three are pinned to one version so
  `@sentry/core` is not duplicated (`SentryEffectTracer` relies on one `getActiveSpan()`).
- Route exceptions through one `ErrorReporter.make` installed with `ErrorReporter.layer([reporter])`
  (below); never call `captureException` elsewhere in Effect code. Tags are `session_id`/`agent_id`
  read from `fiber.getRef(References.CurrentLogAnnotations)` (the `Log` methods annotate them,
  with the text as `log`) merged with the reporter's `attributes`, which no error of ours sets;
  Effect's `Warn` maps to `warning`, `Fatal` to `fatal`, every other severity to `error`.
- Install the tracer with `Layer.succeed(Tracer.Tracer)(tracer)`, where `tracer` is a
  `Tracer.make` wrapping `SentryEffectTracer`: a span whose annotations carry the private
  `Exported` reference goes to `SentryEffectTracer.span`, every other span is a
  `Tracer.NativeSpan` no-op. Only the domain spans set it, so `Effect.fn("Service.method")` spans
  never reach Sentry.
- The QEMU session root span is named with the supplied agent id; its `sentry.op` remains
  `qemu.session`, and `session_id` and `agent_id` remain attributes.
- A span whose open and end sit in different Effects is held by hand with `Effect.makeSpan(name,
  { root?, parent?, annotations, attributes })`, `span.attribute(k, v)` and `span.end(nanos,
  exit)`; a parent ending fails its open children. No per-operation fiber. The Sentry op is the
  `"sentry.op"` attribute; status comes from the `Exit`, a domain status mapped by one function
  (`statusExit`): success is `ok`, everything else an `Exit.fail("<sentry status>")` whose
  `String(error)` becomes the status message.
- No `http.server` or fetch spans: `HttpMiddleware.TracerDisabledWhen` is set and the integrations
  disable spans. Why: the domain span must be a Sentry root.
- End every long-lived loop's tick in `Effect.catchCause((cause) => log.error(text, { cause }))`
  or `Effect.catchDefect` to the same; `log.error` is what reports. Flush in a root scope
  finalizer, `Effect.addFinalizer(() => Effect.asVoid(Effect.promise(() =>
  Sentry.flush(2_000))))`, registered by `SentryLive` and ordered after the `Log` flush.
- Test the policy with `ErrorReporter.make` collecting errors (`test/support/reporter.ts`), a
  recording `Tracer` (`test/support/tracer.ts`) and an in-memory Sentry transport; never mock it.

The reporter in `src/observability/sentry.ts` (`tag`/`toSentryLevel` are its helpers): one
`captureException` per reported cause, a `LogLine` unwrapped to the cause it carries.

```ts
export const reporter: ErrorReporter.ErrorReporter = ErrorReporter.make(
  ({ error, severity, attributes, fiber }) => {
    const annotations = fiber.getRef(References.CurrentLogAnnotations);
    const context = { ...annotations, ...attributes };
    // A log line brings the level and the text (`extra.log`); the exception Sentry groups on is
    // the cause it carries, as it always was. A line without a cause is the exception itself.
    const exception =
      error.name === Errors.LogLine.identifier && error.cause !== undefined ? error.cause : error;
    Sentry.captureException(exception, {
      level: toSentryLevel(severity),
      tags: Object.assign({}, tag(context, "session_id"), tag(context, "agent_id")),
      extra: context,
    });
  },
);
```

`SentryLive`, same file (`Exported` is the private annotation reference): tracer and flush.

```ts
const tracer = Tracer.make({
  span(options) {
    return Context.getOrElse(options.annotations, Exported, () => false)
      ? SentryEffectTracer.span(options)
      : new Tracer.NativeSpan(options);
  },
  context: SentryEffectTracer.context,
});

export const SentryLive: Layer.Layer<never> = Layer.mergeAll(
  Layer.succeed(Tracer.Tracer)(tracer),
  ErrorReporter.layer([reporter]),
  // Two seconds: a stalled ingest must not hold the exit.
  Layer.effectDiscard(
    Effect.addFinalizer(() => Effect.asVoid(Effect.promise(() => Sentry.flush(2_000)))),
  ),
);
```

## Concurrency and streams

- Every long-lived thing lives in a `Scope`: `Effect.acquireRelease` in layers,
  `Effect.addFinalizer` in scoped effects, `Effect.acquireUseRelease` for a local use,
  `Effect.forkScoped` for loops. A live resource owns a `Scope.make()` closed with
  `Scope.close(scope, Exit.void)` by whoever ends it; work that belongs to it runs under
  `Scope.provide(scope)`, so closing the scope releases everything in reverse order.
  `Effect.forkIn(effect, scope)` ties a fiber to a named scope; a request handler forks nothing
  per action.
- Timeouts are always `Effect.timeoutOrElse({ duration, orElse })`; races are `Effect.raceFirst`.
- Bridge callback APIs with `Effect.callback((resume) => { ...; return Effect.sync(cleanup) })`
  (resume at most once, return the cleanup) and event sources with `Stream.callback((queue) => ...)`
  pushing with `Queue.offerUnsafe`, `Queue.endUnsafe` and `Queue.failCauseUnsafe`.
- Fan out with one `Queue` per subscriber when the slow-consumer policy is per subscriber. The
  three sanctioned policies are back-pressure (bounded), coalesce (`Queue.sliding(1)`) and
  drop-the-subscriber (`Queue.dropping(n)` and `Queue.endUnsafe` when `Queue.offerUnsafe` returns
  `false`, logged at warning).
- Retry only with `Schedule` (`Effect.retry({ schedule, while, times })`, `Schedule.exponential`
  capped with `Schedule.modifyDelay`, jittered, bounded with `Schedule.recurs`); never a `for` or
  `while` loop around `Effect.sleep`. Periodic work is `Effect.repeat` with `Schedule.spaced`
  forked into the owning scope, `Effect.schedule(tick, Schedule.spaced(...))` for a ticker, or
  `Effect.forever(Effect.sleep(...).pipe(Effect.andThen(tick)))` for a sampler; a tick never
  fails the loop (`catchCause`/`catchDefect` to `log.error`).
- A periodic sweep is authoritative; wake-ups are only hints. A tick that must not overlap itself
  is `Effect.uninterruptible` under `guard.withPermitsIfAvailable(1)` on a `Semaphore.make(1)`, so
  a stuck tick is skipped by the next rather than overlapped, and a `Fiber.interrupt` of the loop
  waits for a tick in flight.
- Interrupt-aware recovery: `Cause.hasInterruptsOnly(cause) ? Effect.interrupt : ...`; commits
  that must not be torn are `Effect.uninterruptible`. Errors are stream elements when a consumer
  loop must not die.

## Runtime entry

- One runner call per process, in its entry: `NodeRuntime.runMain(program, {
  disableErrorReporting: true, teardown? })` (`db/migrate.ts` guards its call with
  `import.meta.main`), or `Runtime.makeRunMain(...)` for a process that answers its own signals, over
  `program.pipe(Effect.provide(MainLive), Effect.scoped, Effect.tapCause(Render.reportFailure))`.
  Every other module returns an Effect; the only other sanctioned runners are
  `Effect.runForkWith(context)` and `Effect.runPromiseExitWith(context)` re-entering Effect from a
  non-Effect callback after `const context = yield* Effect.context<R>()`;
  `test/repo/architecture.unit.test.ts` allows them in `src/db/client.ts` alone, nowhere else.
- A CLI runs `Command.run(cmd, { version })` directly under `runMain`; a server `Layer.launch`es
  inside its command handler, its stop condition `Effect.raceFirst(Layer.launch(serve),
  Deferred.await(serverFailed))`, the `Deferred` completed by the Node server's `error` listener
  in `main.ts`, where the server is created so that listener can be attached; only the first
  error counts.
- `runMain` owns SIGINT and SIGTERM: the first signal interrupts the root fiber and scopes close in
  reverse order (work drained, the log flushed, Sentry flushed, the pool closed). Component layers
  never install signal handlers. A process that must answer signals itself uses
  `Runtime.makeRunMain`, which installs none, and its shutdown order is written out in one place.
- Exit codes come from `Runtime.defaultTeardown` (`Runtime.errorExitCode` or 1 on failure) for the
  CLIs; a process with its own policy passes a custom `teardown` mapping interruption to 0 unless
  its drain failed, and any other failure to 1. Never mutate `process.exitCode`.
- Startup order is parse flags, check the host, ping the database, then listen. A startup failure
  is logged `fatal` and exits 1 after the flush; a server `error` after listen completes the
  `Deferred`, names the reason, and exits 1; a second error is ignored.
- State both ends of a process must share outside Effect (a shutdown reason set by a Node listener
  and read in the teardown) is a `Context.Reference` over `MutableRef`s. `MainLive` is built with
  `Layer.build` before the command runs, so a missing variable or a bad `DATABASE_URL`, the one
  failure no `Log` exists to record, prints `<NAME> is not set` and `Cause.pretty` on stderr
  through `Render.reportFailure`.

## Tests

- Tests are written first. No code lands until a set of failing unit tests describes it, and every
  surface has both a happy and an unhappy test. Plan for failures and how they are handled.
- Vitest only, two lanes: `test/**/*.unit.test.ts` (no I/O beyond local fakes;
  `npm run test:unit`, part of `check:fast`) and `test/integration/*.integration.test.ts` (spawned
  executables, sockets, containers, processes; `npm run test:integration`). `passWithNoTests` is
  false. Anything that needs `qemu-system-x86_64` is integration and gated on the binary.
- Two `it`s: a pure test (`test/repo/*`, pure modules, the black-box CLI process tests) imports
  `describe`, `expect` and `it` from `vitest`; an Effect test imports `it` from `@effect/vitest`
  (`describe` and `expect` still from `vitest`) and uses `it.effect` or `it.live`, and
  `layer(L, { timeout })((it) => ...)` only for the migrated container. `expect` everywhere;
  `assert` only where `expect` cannot narrow.
- `it.effect` gives every body its own `Scope`, `TestClock` and `TestConsole`; drive timers with
  `TestClock.adjust`; assert output with `TestConsole.logLines`; `it.live` only for real clocks,
  sockets, processes (the integration lane) and the Sentry SDK. Never a real `Effect.sleep` to let
  an interrupt land; `Fiber.await` the interrupted fiber or a `Deferred`. A fresh fake layer per
  `it.effect`, `NodeHttpServer.layerTest` included; the shared `layer(...)` only for the container.
- Fakes are `Layer.succeed(Tag)(Tag.of({...}))` factories that record their calls
  (`fakeLog().lines`, `fakeQemu().calls`, `fakeSessionStore().sessions`,
  `fakeServerStore().routes`) with every unused member `Effect.die("Unexpected
  <Service>.<method>")`, kept under `test/support/`, one file per seam, plus loopback stubs for
  the process tests and `postgres.ts`. Never `vi.mock`, `vi.spyOn`, or a `fetch` stub. A service
  that calls other HTTP servers gets `FakeHttp.recordRequests(respond)` provided to its layer
  alone, so the `HttpClient` in the test's scope still points at the server under test.
- Assert failures with `Effect.flip` and `expect(error).toMatchObject({ _tag, message })`;
  `Effect.exit` only when a defect or interruption is under test (`Cause.hasDies`). A failure test
  whose input carries a secret (a token, a `DATABASE_URL` password) also asserts that sentinel is
  absent from the rendered error.
- Test an `HttpApi` in-process with `HttpRouter.serve(routes, { disableLogger: true,
  disableListenLog: true }).pipe(Layer.provide(fakes), Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(bearer(TOKEN)))` and `HttpApiClient.make(Api)`, or a raw
  `HttpClient.HttpClient` for a refusal; assert `_tag`, `message` and the `{ "error": ... }` body.
  A Worker is tested in-process through its app's `request`.
- Test every command in-process with `Command.runWith(cmd, { version })(args)` under fake layers
  and `TestConsole`; assert `ShowHelp` with `errors.length === 0` for help and that no service was
  touched. Add a black-box process test per CLI that pins exit codes and the first stderr line,
  and for a server its readiness, its signals, the pid gone and the port refusing, with stdout and
  stderr opened on `/dev/full`. Spawn helpers may be plain functions inside the test file.
- Postgres tests run against Testcontainers with the real migrations and the seed in
  `vitest.global-setup.ts` and read `inject("dbUrl")` (`Postgres.describeWithDatabase` skips when
  it is empty); they skip locally without Docker and fail in CI (`CI` or
  `OLIGARCHY_REQUIRE_DATABASE=1`). Unit tests never touch a database. No test connects to the
  production database, calls a third party, boots QEMU, or migrates a remote database.
- Encode repository invariants oxlint cannot express as source-scanning tests in `test/repo/`: the
  boundary-file allow-list, the `node:*` exceptions and `Effect.run*` placement (each list checked
  to name files that exist), every `Flag.boolean` defaulted, HttpApi ownership, namespace imports
  with `.ts`, deep-path Effect imports, no `as` but `as const`, `@oligarchy/` identifiers, no
  `Data.TaggedError`, `class Error` or re-export, the script names (no `drizzle-kit push`), no
  `"warn"`, `erasableSyntaxOnly` and the language-service plugin.
- Tests are behaviour across a boundary; do not test static constants, literal order, a table
  entry by entry, or config objects (the exact `check:fast` string). Delete obsolete tests with
  their feature, and never export a member for a test to read: assert the behaviour. Test vendor
  behaviour with exact captured fixtures; label a synthetic fixture synthetic.

One `it.effect` over the real fakes with `Effect.flip`.

```ts
const Fakes = Layer.mergeAll(
  FakeQemu.fakeQemu().layer,
  FakeQemu.fakeIso().layer,
  FakeQemu.fakeStats,
  Stores.fakeSessionStore().layer,
  Stores.fakeActionStore().layer,
  FakeLog.fakeLog().layer,
  FileSystem.layerNoop({}),
  Path.layer,
);
const SessionsLive = Sessions.Sessions.layer.pipe(Layer.provide(Fakes));

it.effect("refuses a foreign agent", () =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    const body = Contract.StartBody.make({ iso: "/isos/omarchy.iso", agent: "OLI-61" });
    const id = yield* sessions.start(body, "none", false);
    const error = yield* Effect.flip(sessions.lookup(id, "OLI-62"));
    expect(error).toMatchObject({
      _tag: "Forbidden",
      message: `agent "OLI-62" does not own session "${id}"`,
    });
  }).pipe(Effect.provide(SessionsLive)),
);
```

## Lint and format

Every enabled diagnostic is an error. Fix findings at their source; do not downgrade rules, add
disable comments, or create broad file exclusions. Exceptions are narrow, centralised as root
overrides in `.oxlintrc.json`, and covered by a focused test each. `npm run check:fast` runs lint,
format, types and unit tests in that order; run it plus the affected integration tests before a
change ships.

- oxlint with `typeAware: true`, plugins `effecttsgo` and `typescript`; categories `correctness`,
  `suspicious`, `perf` as `error`, `nursery`, `pedantic`, `restriction`, `style` off;
  `typescript/no-unnecessary-type-parameters: error`; `id-denylist: isRecord`;
  `no-underscore-dangle` allowing only `_tag`, `__dirname`, `__filename`; `no-await-in-loop` off;
  the sixteen `effecttsgo/*` rules as `error` (`floating-effect`, `floating-effect-in-vitest`,
  `missing-effect-context`, `missing-effect-error`, `missing-layer-context`,
  `missing-star-in-yield-effect-gen`, `missing-return-yield-star`, `effect-fn-implicit-any`,
  `class-self-mismatch`, `non-object-effect-service-type`, `schema-opaque-instance-member`,
  `overridden-schema-constructor`, `schema-literal-non-finite`, `outdated-api`,
  `promise-in-effect-success`, `strict-effect-provide`, the last off only for `src/**/main.ts`,
  `src/observability/instrument.ts`, `test/**` and `vitest.global-setup.ts`);
  `typescript/no-floating-promises` off for `test/**` and the global setup. No `warn` tier.
- oxfmt: `printWidth` 100, `tabWidth` 2, spaces, semicolons, double quotes, `trailingComma: "all"`,
  final newline; `drizzle/**`, `public/**`, `prompts/**`, `**/*.md`, `package-lock.json` and
  `wrangler.jsonc` ignored. `.editorconfig` matches.
- tsconfig: `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noFallthroughCasesInSwitch`,
  `verbatimModuleSyntax`, `isolatedModules`, `allowImportingTsExtensions`, `erasableSyntaxOnly`,
  `nodenext` modules, `noEmit`, the `@effect/language-service` plugin with `diagnostics: false`.

The rules media enforces with its own lint plugin are prose here; the boundary list, `Effect.run*`
placement, `Flag.boolean` defaults and HttpApi ownership are source-scanning tests. The Effect,
Schema and module rules above already cover most of them; the rest:

- No type assertions but `as const`; never `x as unknown as T`; never widen a known value to
  `unknown` and assert it back. `unknown` appears only as a parameter named `cause`, a type-guard
  input, or a `decode*` input, never as a return type or alias. No `Record<string, unknown>`.
- Keep literal inference and check with `satisfies`; annotate only with a named owner type. No
  `object` parameters; no `typeof` narrowing of `unknown`; no `{ ...(cond ? { x } : {}) }`; no
  module mocking; no `Reflect.apply`/`Reflect.get`; no identifier containing `shape`; a `Pick` with
  more than five keys wants a real type; no parameter typed `typeof Union.cases.Tag.Type`.
- `String(n)` inside template literals; `readonly` on every field; `ReadonlyArray<T>`; numeric
  separators. Exhaustive matching is `Union.match`, `Match.value(x).pipe(Match.tagsExhaustive(...))`
  or a `switch` ending in `satisfies never`; no `default` where TypeScript narrows.
- `.make` for every Schema class, case and error; `new` only for `CliError.UserError`,
  `HttpClientError.*`, `pg.Pool`, `pg.Client`.
- Preferred fixes preserve evidence: replace an assertion with a decode, a widened type with the
  owner type, a swallowed failure with a typed one; never delete the check that found the problem.
  A service shape that intentionally exposes a requirement carries
  `/** @effect-expect-leaking X */`. Idempotency keys on every side-effecting SDK call and a unique
  index behind every "create once".

## Migrations

- The database schema lives in `src/db/schema.ts`. Migrations under `drizzle/` are generated from
  it with `npm run db:generate`, never written or edited by hand, and never applied with
  `drizzle-kit push`.
- Migrations are append-only. Never edit, delete, or rename anything under `drizzle/`, not the
  `.sql` files, not the `meta/` snapshots. To change the schema, edit `src/db/schema.ts` and
  generate a new migration. The one exception is `drizzle/meta/_journal.json`, which the
  generator itself appends to.
- CI enforces both rules: an edited migration fails the build, and so does a schema that does not
  match the committed migrations (`.github/workflows/migrations.yml`, `append-only` and
  `schema-in-sync`). A third job, `checks`, runs `npm run check:fast`.
- Applying migrations is deployment-owned: `npm run db:migrate` runs `src/db/migrate.ts`, whose
  `program` reads `Config.databaseUrl`, builds `Database.make(url)` in a scope, and runs
  `migrateDatabase` (`database.run("migrate", (db) => migrate(db, { migrationsFolder: "drizzle"
  }))`); it prints `database migrations applied` and fails with `DATABASE_URL is not set` (a `.env`
  fills missing variables only). Tests only ever migrate an ephemeral container.

## Review

Before a change ships, spawn a GPT-5.6 Sol subagent (`gpt-5.6-sol-high`) to review it. Give it the
repo path, where to find the diff, a summary of the request being made, and this prompt verbatim:

> Thoroughly review the change being proposed and understand the request being made. All changes
> must strive for simplicity and correctness. All errors must be handled, but we do not want
> unneeded abstractions or excessive code. No normalization functions. Instead, it should just be
> straightforward, good programming: simple checks, guard statements where they're needed, asserts
> for conditions that shall not exist in our application.

Findings that add guards or ceremony get declined with the reason stated, per the Philosophy
section. Machine reviews are held to the same bar: a reviewer that introduces nullable state for
impossible failures, or strips the comments that carry design intent, gets that half reverted.

## Review checklist

1. Every API name and signature was verified in `node_modules/effect/src` or
   `node_modules/@effect/platform-node/src`; a local document is never evidence that an API exists.
2. Unknown data is decoded exactly once at its boundary, with the runner chosen by failure
   semantics, and never re-decoded after HttpApi.
3. Errors are `Schema.TaggedError`s with a `message`, recovery is by tag and narrow, every API
   error carries `[ErrorReporter.ignore]` so the boundary log line is the one report, and the
   boundary prints the failure once.
4. Service, layer and scope ownership is explicit: `make` plus `static readonly layer`, resources
   under `Effect.acquireRelease`, loops under `Effect.forkScoped`, one graph in `main.ts`.
5. HttpApi handlers consume decoded contracts, clients are generated from the same `HttpApi` behind
   `filterStatusOk`, payloads are built with `.make`, and the wire body of every error is
   `{ "error": ... }`.
6. Every printed string, status code, log line, span name and exit code a test or an operator
   document pins is unchanged, or the test and the document changed with it.
7. Tests were written first, both paths are covered, fakes sit at the layer seam, and no test
   touches a third party, QEMU or a remote database.
8. `npm run check:fast` and the affected integration tests are green.
