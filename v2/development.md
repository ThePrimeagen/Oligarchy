# Development

The one developer document for `v2/`, the Effect rewrite of oligarchy. It owns repository
decisions: how services, errors, schemas, processes, the database and the tests are written here,
and every string the proxy, the CLIs and the database promise to their callers. It does not
document the Effect API; API truth is `node_modules/effect/src`, `node_modules/effect/AGENTS.md`,
`node_modules/effect/ai-docs/src`, `node_modules/@effect/platform-node/src` and
`node_modules/@effect/vitest/README.md`, all `4.0.0-rc.112`, and a name that is not there does not
exist. Operator and agent documents are `client.md`, `ctrl.md`, `ctrl-linear.md` and `prompts/`;
they moved unchanged and this document does not repeat them.

## Host

- The proxy needs `qemu-system-x86_64`, `qemu-img`, and OVMF at
  `/usr/share/edk2/x64/OVMF_CODE.4m.fd` and `OVMF_VARS.4m.fd`. `--display gtk` also needs `DISPLAY`
  and a QEMU build that lists gtk; `egl-headless` needs a DRM render node under `/dev/dri`. The
  proxy checks what it is about to use at startup and exits 1 with the missing list. There is no
  setup script.
- The missing list is `missing host requirements:` followed by one line per item, texts verbatim
  and in check order: `<bin> not on PATH`, `OVMF code not found: <path>`,
  `OVMF vars not found: <path>`, `/dev/kvm is not readable and writable (needed for accel=kvm)`,
  `DISPLAY is not set (needed for --display gtk)` (read through the `ConfigProvider`, so an empty
  value is unset), `/dev/dri not found (needed for --display egl-headless)`,
  `no DRM render node in /dev/dri (needed for --display egl-headless)`,
  `qemu-system-x86_64 was built without display backend <display>` (probed only when the binary
  was found and the display is not `none`).
- Run on Node 26 with npm. Every executable is a `#!/bin/sh` wrapper running
  `node --experimental-strip-types` (`./server` adds `--import ./src/observability/instrument.ts`);
  types are stripped, not transformed, so `erasableSyntaxOnly` stays on. The four root wrappers
  (`./client`, `./ctrl`, `./server`, `./session`) exec their `v2/` twins and forward `"$@"`;
  `.cursor/environment.json` runs `./server --port 42069 --automation` unchanged.
- A `.env` in the working directory fills missing variables only; an already-set variable always
  wins, and an empty value counts as unset (`SERVER_URL=""` falls back to the default).
- Session directories live under `os.tmpdir()`, so `TMPDIR` decides where a machine's disk goes.
  Each Omarchy install writes 6 to 7 GB into its `disk.qcow2`; a tmpfs `/tmp` fills after a few
  concurrent sessions. Point `TMPDIR` at disk-backed storage for the proxy.
- The proxy's stdout is the convenience copy of the log; the `logs` rows and Sentry are the record.
  A write refused by a full filesystem is dropped, never fatal: redirect stdout to a filesystem that
  can fill only if losing those lines is acceptable.
- Install with `npm ci` inside `v2/`; `prepare` runs `effect-tsgo patch --oxlint` so the
  `effecttsgo/*` rules are active for lint. The commands, all from `v2/`: `npm run check:lint`,
  `npm run check:format`, `npm run check:types`, `npm run test:unit`, `npm run test:integration`,
  `npm run check:fast` (lint, format, types, unit in that order), `npm run db:generate`,
  `npm run db:migrate`, `npm run format`, `npm run dev` (the dashboard under wrangler). There is no
  bare `check`, `test` or `lint` script; `test/repo/scripts.unit.test.ts` keeps it that way. Local
  runs use a local Postgres migrated with `npm run db:migrate`, never the production `DATABASE_URL`.

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
- Support only what is used. `/start` exposes `iso` and `disk` and nothing else the launcher could
  take; `/stats` answers "how many qemus, how much memory, what is the cpu doing" and nothing else.
- Trust the contracts of our own components: validate only at real boundaries, decode there exactly
  once, and write no code for a failure the contract rules out. A guard that stays names the real
  event it answers (the cpu sampler skips a delta when the core count changed: cpu hotplug).
- Handle every real error, and a failure never takes down more than the operation it belongs to.
  The HTTP boundary answers every failure; every forked loop's tick is guarded. Startup
  requirements fail at startup: the proxy checks the host and pings the database before it listens.
- Owned state is the source of truth: "how many qemus are running" is the size of the `Sessions`
  map, not a `/proc` scan. The database row is the truth for state that outlives the process.
- Nulls are a tax on every consumer. The cpu window reports 0 before its first sample, not
  `number | null`; reserve `null` for an absence a consumer must distinguish and act on.
- Background work lives and dies with the server: a loop is `Effect.forkScoped` in the server
  scope, its tick is guarded, and its state is bounded (the one exception, the log row queue, is
  unbounded by policy; see Log stream).
- Keep what earns its place: paths sent to the server are absolutised because the server runs
  elsewhere; the CLI stats the ISO first so the error names the real path; `start` omits the
  `disk` key instead of sending `""` because the proxy creates the default disk only when the key
  is absent; `MAX_SAMPLES = 60` carries "60 samples of 5 s is a five-minute window".
- Porting: the reference implementation is the spec; `v1/` is the reference and wire behaviour
  never diverges beyond the list below. Exact ports: never probe or fall back to a neighbouring
  port.

## Changes from v1

Every deliberate behaviour change against `v1/`, so a transcript comparison does not read them as
bugs; anything not listed here is a regression.

- A CLI failure is rendered as the headline (`message[: cause message]`) then `Cause.pretty`; v1
  printed the headline then `console.error(error)`.
- A transport failure's headline is `<METHOD> <url> failed: <cause>` (example under HttpApi client).
- Bare `./client`, `./client intent` and `./ctrl` print help and exit 0 (v1: usage, exit 1); an
  unknown action (`./client bogus`) is an Effect CLI usage error, exit 1, not `client: unknown
  action: bogus`.
- A malformed JSON body is 400 `Expected a valid JSON body`; v1 relayed `JSON.parse`'s message.
- A defect's boundary log detail is `Cause.pretty` of the die, not `stack ?? message`.
- The catch-all 404 `{"error":"not found"}` answers before the bearer check, so an unauthenticated
  request to an unrouted path is 404 where v1 answered 401.
- A `/stop` that loses the race with the sweep is 404 `unknown session "<id>"`; v1 settled twice.

## Layout

- `v1/` is the previous implementation, byte-for-byte and runnable from inside `v1/`; never change
  it. `v2/` is the rewrite. The root holds `AGENTS.md`, the wrappers, `.gitignore` and `.cursor/`.
- `v2/` holds `package.json`, `package-lock.json`, `tsconfig.json`, `.oxlintrc.json`,
  `.oxfmtrc.json`, `.editorconfig`, `vitest.config.ts`, `vitest.global-setup.ts` (Testcontainers
  Postgres, migrations, seed), `vitest.d.ts`, `drizzle.config.ts`, `wrangler.jsonc`, `drizzle/`
  (generated migrations; 0000–0011 match `v1/`, 0012 adds `debug_logs`, 0013 replaces its text
  columns with a `sources` jsonb map), `public/` and `prompts/`
  (moved as-is), the
  operator documents, this document, the four `v2/` wrappers, `src/` and `test/`.

`v2/src/`: one directory per process plus the shared kernel; `main.ts` files are the entries.

```text
src/
├── shared/      domain.ts  errors.ts  contract.ts  api.ts
├── config.ts    external-failure.ts
├── observability/  dsn.ts  instrument.ts  sentry.ts  log.ts  render.ts
├── db/          schema.ts  client.ts  sessions.ts  actions.ts  logs.ts  debug-logs.ts  tests.ts  migrate.ts
├── qmp/         framing.ts  socket.ts  client.ts
├── qemu/        keys.ts  args.ts  host.ts  process.ts  qemu.ts  iso.ts  stats.ts
├── proxy/       sessions.ts  middleware.ts  handlers.ts  command.ts  main.ts
├── client/      flags.ts  proxy-client.ts  command.ts  main.ts
├── ctrl/        linear.ts  cursor.ts  render.ts  command.ts  main.ts
├── session/     readline.ts  children.ts  state.ts  grammar.ts  image.ts  picker.ts
│                follow-view.ts  repl.ts  command.ts  main.ts
└── dashboard/   dashboard.tsx  clicker.ts  query.ts   (Hono Worker, not Effect)
```

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
  `setInterval`, `new Promise` or `async`: `qmp/socket.ts`, `proxy/main.ts` (so
  `server.on("error")` and the stdout `error` listeners can be attached), `session/readline.ts`,
  `qemu/stats.ts`, `qemu/qemu.ts`, `observability/instrument.ts`, `observability/render.ts`,
  `db/client.ts` and every `src/**/main.ts`; `src/dashboard/**` and `test/**` are not scanned.
  Two files get exactly one `node:*` import: `src/qemu/iso.ts` imports `node:crypto` to hash a
  multi-gigabyte ISO with the streaming `createHash` (Effect's `Crypto.digest` is one-shot), and
  `src/session/image.ts` imports `node:zlib` for `inflateSync` (Effect has no inflate).
  `ctrl/cursor.ts` needs no exemption: the SDK is wrapped in `Effect.tryPromise`.
- `test/repo/architecture.unit.test.ts` enforces the lists and checks that every listed file
  exists. To add a boundary file or a `node:*` exception, add it to `BOUNDARY_FILES` (or
  `NODE_IMPORT_EXCEPTIONS`) there and to the bullet above in one change; nothing else grants it.

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
- Keep pure mapping, formatting, and object construction outside Effect (`ctrl/render.ts`,
  `qemu/keys.ts`, `qemu/args.ts`, `qmp/framing.ts`, `session/grammar.ts`, `session/image.ts`, the
  view halves of `session/picker.ts` and `session/follow-view.ts`); a failure there is a `Result`
  (`image.ts` wraps `inflateSync` in a `try`: `bad png data: <zlib reason>`).
- Reach services with `yield*` inside the Effect that needs them, never as function parameters; a
  plain factory taking values is allowed only where a unit test constructs the seam directly
  (`Database.make(url)`, `Stats.make(source)`, `makeProxyCommand(server)`, `makeCtrlCommand(deps)`).
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
  When `make` takes a value (`Database`, `Linear`, `CursorAgents`) the layer is the matching
  function, `(url) => Layer.effect(this)(this.make(url))`.
- When a service is a plain value, declare `class X extends Context.Service<X, Shape>()(id) {}`
  with `type Shape` and build it with `Layer.succeed(X)(X.of({...}))` (`QmpListen`, the session's
  `Host`). Curried forms only.
- Acquire every long-lived resource with `Effect.acquireRelease` inside the layer effect; the
  release never fails (`Effect.catch` to a log line). `Effect.orDie` only where failure is
  impossible by construction; `Effect.die` only for invariants that cannot hold.
- Capture dependencies once in the layer effect and re-provide them per method with
  `Effect.provideService(Tag, value)` (`qemu.ts` does this for `ChildProcessSpawner` and `Log`);
  never `Effect.provide(Layer.succeed(...))` at a call site.
- Compose the graph once, in `main.ts`, as `FooLive` constants reusing one layer reference per
  shared service. Why: layer memoisation is by identity, so two references mean two pools.
- `Layer.provide` for private dependencies, `Layer.provideMerge` when the dependency must stay
  visible, `Layer.mergeAll` for siblings, `Layer.unwrap` when a layer depends on a value,
  `Layer.effectDiscard` for background loops and fail-fast preconditions.
- Background fibers belong to the layer scope: `Effect.forkScoped`, never `Effect.runFork`. Do not
  use `Layer.fresh` in production, `ManagedRuntime`, or `Layer.catch` (not exported).
- `Effect.log*` is called only in `src/db/client.ts`: the pool's `error` listener and its release
  sit below `Log`, which does not exist yet when the pool is built.

The `Database` service in `src/db/client.ts` is the model: `makeDatabase(url)` normalises the URL,
acquires the pool without connecting under `Effect.acquireRelease`, re-enters Effect from
`pool.on("error")` with `Effect.runForkWith(context)`, and its release logs instead of failing.

The proxy's graph in `src/proxy/main.ts`: one reference per service; `SentryLive` sits beneath
`Log` so the log rows flush before Sentry does and `Log` captures the reporters. `Sessions`,
`Qemu`, `Iso` and `Stats` live in `ServerLive` (Runtime entry), built per display and port.

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
  `DatabaseError`, `LinearError`, `MissingVariable`). Never name a class `Error`.
- Construct with `.make`; raise with `return yield* X.make({...})` (instances are yieldable).
- Every error has an operator-facing `message` field or getter and structured fields
  (`operation`, `sessionId`, `agentId`, `command`); when wrapping a thrown value, carry
  `cause: Schema.optionalKey(Schema.Defect())`, or `cause: Schema.Defect()` when there always is
  one (`Internal`, `ProxyUnreachable`, `CursorAgentFailed`). The boundary renders
  `message[: cause message]`.
- Put the HTTP status on the class once, as `{ httpApiStatus: N }`; the wire codec derives it
  (`wireError(schema, fromMessage)` ends in `HttpApiSchema.status(httpStatus(schema))`), so the
  two cannot disagree. Handlers never build error responses. `Errors.httpStatus(schema)` reads the
  annotation (500 when absent); `Errors.apiStatus(error)` looks the class up in a table that
  `satisfies Record<ApiError["_tag"], Schema.Top>`, so a tag without an arm does not compile.
- Mark every API error class, 4xx and 5xx alike, with `override readonly [ErrorReporter.ignore] =
  true` and nothing else: no `[ErrorReporter.attributes]` getter (the reporter never reads one on
  an ignored error). Why: the `ApiBoundary` middleware logs each failed request once, attributing
  `sessionId`/`agentId` itself from the error's fields (`attribution` in `middleware.ts`), and that
  line is the single Sentry report (with the cause from 500 up); HttpApiBuilder's own is silenced.
- Fixed-message errors take a constructor default: `Unauthorized.make({})`, `NotFound.make({})`
  and `Contract.Ok.make({})` are valid, and `Internal.make({ cause })` fills `"internal error"`.
- The wire body of every API error is `{ "error": "<message>" }`. The class is what handlers raise;
  its `*Wire` codec (`Schema.decodeTo` + `HttpApiSchema.status`) is what `api.ts` declares. Why: the
  session REPL, the tests and the operator docs all parse `{ error }`. A decoded `InternalWire` is
  an `Internal` whose `cause` is `null`: the wire only says "internal error".
- Translate infrastructure failures once, at the module boundary, with one helper per module
  (`Database.run`/`Client.attempt`, `ProxyClient`'s `run(label, effect)`, `Process.detail`);
  classify an `HttpClientError` by its `response` status and `error.reason`, never by message;
  convert `unknown` thrown values with the probes in `src/external-failure.ts` (`messageOf`,
  `describeThrowable`, `causeOf`; there is no `ExternalFailure` class), `causeOf` unwrapping a
  wrapper where the line should name the driver's or Node's message; wrap Promise SDKs with
  `Effect.tryPromise({ try, catch })` and a typed `catch`.

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

- The API errors: 400 `BadRequest { message, sessionId?, agentId? }`; 401 `Unauthorized`
  (`unauthorized`); 403 `Forbidden { message, sessionId, agentId }`; 404
  `UnknownSession { id, message, agentId? }` (built by `unknownSession(id, agentId?)`, attributed
  to the id only when it is a uuid); 404 `NotFound` (`not found`; declared on `GET /images/:id` in
  `api.ts`, though the handler answers that 404 raw and never raises it); 409
  `Conflict { message, sessionId }`; 502 `StartFailed` and
  `ExchangeFailed { message, cause?, sessionId, agentId }`; 500 `Internal { message: "internal
  error", cause, sessionId?, agentId? }`. `ApiError` is their union.
- The domain errors, same file: `MissingVariable { name }` (`<name> is not set`),
  `CommandError { message }`, `DatabaseError { operation, message, cause? }`,
  `QmpError { command, class, desc, raw }` (`<class>: <desc>`), `QmpTimeout { command }`
  (`qemu: <command> timed out`), `QmpClosed`, `QmpProtocolError`, `QemuStartError` and `IsoError`
  (all `{ message, cause? }`), `HostRequirementsMissing { missing }`, `KeysError { message }`,
  `ProxyRefusal { status, message }`, `ProxyUnreachable { message, cause }`, `LinearError {
  operation, message, status?, cause? }`, `CursorAgentFailed { message, retryable, cause }`,
  `ChildExit { command, code, stderr }` (its message is the stderr), `PngDecodeError { message }`,
  and `LogLine { text, level, cause? }` (identifier `@oligarchy/observability/log/LogLine`): an
  `error` or `fatal` log line as the reporter receives it, `message` the text and
  `[ErrorReporter.severity]` from `level`.

## Schema

- Use `Schema.Class<X>("@oligarchy/<dir>/<file>/X")({...})` for exported records that cross a
  boundary (`contract.ts`); `Schema.Struct` for local, wire-probe, or row shapes;
  `Schema.TaggedUnion` for closed sum types keyed on `_tag`, built with `.cases.Tag.make` and
  eliminated with `.match`; `Schema.Literals([...])` for closed vocabularies, whose `.literals`
  feed `Flag.choice` (`Domain.MouseButton`, `Domain.StopStatus`, `Args.QEMU_DISPLAYS`) so the
  vocabulary and the flag cannot drift.
- When the wire discriminates on a field other than `_tag` (QMP's `execute`, `return`, `error`,
  `event`; the follow line's `type`), use `Schema.Union` of `Schema.Struct`s with a
  `Schema.Literal` discriminant and dispatch with a `switch` ending in `satisfies never`, or with
  `"QMP" in message` when only one key differs. Never rename wire fields.
- Give every exported schema a namespaced identifier (the first argument of `Schema.Class` and
  `Schema.TaggedError`, `.annotate({ identifier })` on a union or literal set); match by `_tag`,
  never by identifier; export the domain name (`FollowEvent`, not `FollowEventSchema`).
- Brand ids with `Schema.String.check(Schema.isUUID()).pipe(Schema.brand("SessionId"))`; bound
  scalars with `Schema.Number.check(Schema.isBetween({ minimum, maximum }, { message }))`; brands
  live in `src/shared/domain.ts`, `Schema.is(Brand)` is the guard (`Domain.isSessionId`).
- Decode `unknown` exactly once at the boundary and choose the runner by failure semantics:
  `Schema.decodeUnknownEffect` when failure belongs in the error channel,
  `Schema.decodeUnknownOption` for probes and "absence is the contract",
  `Schema.decodeUnknownSync` for trusted module-load data and tests, `Schema.decodeUnknownExit`
  when the decoder must stay a pure function (`Domain.decodeQmpInbound`, a `Result` in
  `qmp/framing.ts`). Hoist decoders to module constants. Never inspect `unknown` with `typeof`,
  property fishing, or assertions.
- JSON that crosses a wire or lands on disk goes through
  `Schema.fromJsonString(Schema.toCodecJson(S))`, bound once beside the schema. Why: a later `Date`,
  `Option` or class field cannot silently invalidate the boundary.
- `Schema.optionalKey` means the key may be absent (the type excludes `undefined`); `Schema.NullOr`
  means the wire carries `null`; never conflate them. Build optional keys without a conditional
  spread: call `.make` twice or use `Object.assign(base, cond ? { key } : undefined)`.
- Use `Schema.decodeTo(Target, SchemaTransformation.transform({ decode, encode }))` when the wire
  shape differs from the owned shape. Never `Schema.Record(Schema.String, Schema.Unknown)`; use
  `Schema.Json` (QMP argument bags are `Schema.Record(Schema.String, Schema.Json)`); a probe that
  must accept anything under one key uses `Schema.Unknown` for that key alone (`Envelope.data`).
- `Schema.Class` encoders require class instances, so encode values produced by `.make` or
  decoding; every `HttpApiClient` payload is built with the contract class's `.make`. Never add
  Zod.

`FollowEvent` in `src/shared/domain.ts`: a `type`-keyed union in today's key order, its JSON codec
bound beside it.

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
  `Config.string("KEY")` or reads `process.env` (the `DISPLAY` probe in `qemu/host.ts` is a host
  check). Consumers import it as `Config`; the module imports Effect's as
  `import { Config as EffectConfig } from "effect"`.
- Read with `Config.nonEmptyString`, `Config.redacted`, `Config.string`; secrets are `Redacted`
  from parse to use and unwrapped with `Redacted.value` exactly once at the SDK or header boundary.
- Install the provider once at the entry with `Config.providerLayer`
  (`Layer<never, never, FileSystem>`): `ConfigProvider.fromEnv()` first,
  `ConfigProvider.fromDotEnv({ path: ".env" })` filling missing keys only when `.env` exists,
  joined with `ConfigProvider.orElse`; an unreadable `.env` is a defect. Why: a cloud agent's
  injected `DATABASE_URL` is never replaced by a file. `fromEnv` treats an empty value as absent
  (`OLIGARCHY_TOKEN=""` is `OLIGARCHY_TOKEN is not set`; `SERVER_URL=""` falls back to
  `http://127.0.0.1:42069`).
- Report a missing or invalid variable as `MissingVariable { name }`, rendered exactly
  `<NAME> is not set`; never a stack trace, never the value. The accessors are `Config.required`
  and `Config.requiredRedacted` (Effects failing `MissingVariable`), the named `oligarchyToken`,
  `databaseUrl`, `linearApiToken`, `cursorApiToken`, `serverUrl` (a `Config.Config<string>` for
  `Flag.withFallbackConfig`), `DEFAULT_SERVER_URL` and the `ProxyConfig` service
  `{ token, databaseUrl }`.
- The variables: `OLIGARCHY_TOKEN` (proxy, client, session, `ctrl session --dump`),
  `DATABASE_URL` (proxy, ctrl, `db:migrate`), `LINEAR_API_TOKEN` (`ctrl test new`,
  `ctrl test list`), `CURSOR_API_TOKEN` (`ctrl test run`), `SERVER_URL` (fallback for
  `--server-url`). Each renders `<NAME> is not set`.
- Report order is fixed: the proxy reports `OLIGARCHY_TOKEN` before `DATABASE_URL`; ctrl reports
  `DATABASE_URL` first, then `LINEAR_API_TOKEN` or `CURSOR_API_TOKEN` after parsing but before any
  work; `OLIGARCHY_TOKEN` only for `--dump`, after the selector validation.
- Configuration is either a hardcoded constant (`SENTRY_DSN`, `DEFAULT_SERVER_URL`) or a required
  value, never a silent optional; CLI knobs (`isTTY`, `FORCE_COLOR`, `TERM`, `execPath`) are read
  in `main.ts` and `render.ts` only.

`src/config.ts` (an excerpt): the provider chain, one accessor family and the proxy's pair.

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
  Command.withSubcommands([...]))`. A group may carry its own flags and handler for the bare form
  (`ctrl test --list`); a handler-less root fails with `ShowHelp({ errors: [] })` and exits 0.
- Declare flags with `Flag.string/boolean/integer/float/choice/choiceWithValue(name).pipe(
  Flag.withSchema, Flag.withDefault, Flag.withAlias, Flag.optional,
  Flag.withFallbackConfig(Config.x), Flag.withDescription)`; every `Flag.boolean` carries
  `Flag.withDefault(...)` (`test/repo/architecture.unit.test.ts` checks it); ctrl's `test --list`
  is required through that same call,
  `Flag.withDefault(Effect.fail(new CliError.MissingOption({ option: "list" })))`, so `ctrl test`
  alone is a usage error. Reuse the client's flag factories in `src/client/flags.ts` by spreading
  `Flags.shared` (`agentId`, `serverUrl`) into each command's flag config and adding
  `Flags.sessionId`, `Flags.output(what)`, `Flags.iso` and the rest by name.
- Handlers are `Effect.fn("client.<action>")` / `Effect.fn("ctrl.<action>")` bodies that `yield*`
  services, print with `Console.log` (stdout) and `Console.error` (stderr), and end with a domain
  result. Why: `TestConsole` captures `Console`, not `process.stdout`. Raw bytes go through
  `Stream.run(Stream.make(bytes), stdio.stdout())` with `stdio = yield* Stdio.Stdio`; `-o` writes
  with `fs.writeFile(path, bytes, { mode: 0o644 })`.
- A client handler reads `Config.oligarchyToken` and connects before any local check, so
  `OLIGARCHY_TOKEN is not set` precedes every request; local refusals (`send-mouse: --clicks needs
  --button`; a missing local ISO is Node's own `iso: ENOENT: no such file or directory, stat
  '<absolute path>'` from the `PlatformError`'s cause, never `NotFound: FileSystem.stat …`) come
  before the request; the request comes last.
- `--help` is side-effect free: no network, no database, no spawn. No business logic in the CLI.
- Run with `Command.run(cmd, { version: Api.VERSION })` (argv from `Stdio`, provided by
  `NodeServices.layer`). It renders help, usage errors and `UserError`s itself before re-failing;
  `--help` on a command with a handler succeeds, a bare group fails `ShowHelp` with no errors, and
  `Runtime.errorExitCode` gives both exit 0. At the boundary a `CliError` therefore needs no
  rendering; any other failure gets `renderFailure` on stderr and exits 1. `Render.reportFailure`
  is that one print for all three CLIs, applied outside `Effect.provide(MainLive)` so a layer
  failure (an unreadable `.env`) prints its cause too. Never mutate `process.exitCode`.
- Every CLI's `MainLive` provides `CliOutput.layer` and `CliConfig.layer` without the wizard
  builtin (below); the `--log-level` builtin stays and is a no-op for `Log` lines.
- Exit codes: `client` and `ctrl` 0 on success and 1 on any failure; `--help` 0; bare `./client`,
  `./client intent` and `./ctrl` print help and exit 0; `./client bogus` exits 1; `session` exits 1
  on a parse error or a missing token and 0 when it leaves; the proxy exits 1 on a startup failure
  or a server error after listen, 0 on SIGINT/SIGTERM unless a session failed to drain.
- The action is the first argument; flags follow in any order as `--flag value` or `--flag=value`,
  kebab-case only (`client.md` and `ctrl.md` list them). Client defaults: `--server-url` falls back
  to `SERVER_URL` then `http://127.0.0.1:42069` and is used as given; `--iso` defaults to
  `omarchy.iso`; `--encoding` defaults to `oligarchy` and is always sent; `start` prints only the
  id; `iso` and `disk` are absolutised; `disk`, `status` and `reason` are omitted from the body
  when absent; `--x`/`--y` (`send-mouse: --x and --y must be in 0..1`) and `--clicks` (`1..100`)
  are refused by their flag schemas.
- Ctrl: `--server-url` is required (no default, `server-url must be a valid http or https url`) on
  every action but `test run`, where it is an unrecognised flag; `iso must be a valid https url`;
  `count must be at least 1`; `--status` is `Flag.choiceWithValue` mapping `success` to `passed`;
  refusals are `CommandError`s. `makeCtrlCommand(deps)` takes the layer factories (`database(url)`,
  `linear(token)`, `cursor(apiKey)`, `proxy(options)`), `live` by default, so a test substitutes
  fakes. The proxy's `makeProxyCommand({ missingHostRequirements, serve, serverFailed })` takes the
  host check, the server as `serve(display, automation, port)` and the `Deferred` a server error
  completes; `--automation` with `--display` is a `CliError.UserError` (`--automation is
  exclusive`) that the CLI renders, never a fatal log line.

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

## HTTP contract

The proxy binds `127.0.0.1:<port>` (default 42069, `--port`). `--display` is one of `none`
(default), `gtk`, `sdl`, `egl-headless`, `spice-app`, `dbus`; `--automation` forces `-display none`
and `-vga none -device virtio-vga` and is exclusive with `--display` (`--automation is exclusive`).
The listen line is `oligarchy proxy listening on 127.0.0.1:<port>; display <d>[; automation]`.

| Route | Input | Success | Refusals |
| --- | --- | --- | --- |
| `POST /start` | `iso, disk?, agent` | `{"id":"<uuid>"}` | 502 |
| `GET /image` | `?id=&agent=` | `image/png`, `x-image-url: <stored url>` | 403 404 502 |
| `GET /serial` | `?id=&agent=` | `text/plain` | 403 404 |
| `GET /dump` | `?id=` | `text/plain` | 404 409 |
| `GET /follow` | `?id=` | `application/x-ndjson` | 404 409 |
| `GET /stats` | none | `{qemus, memory, cpu}` | none |
| `POST /stop` | `id, agent, status?, reason?` | `{"ok":"true"}` | 403 404 |
| `POST /send-keys` | `id, keys, encoding?, agent` | `{"ok":"true"}` | 403 404 502 |
| `POST /send-mouse` | `id, x, y, button?, clicks?, agent` | `{"ok":"true"}` | 403 404 502 |
| `POST /intent/start` | `id, agent, test_result_id, message` | `{"ok":"true"}` | 403 404 |
| `POST /intent/end` | `id, agent` | `{"ok":"true"}` | 403 404 |
| `GET /images/:id` | path `id` | `image/png` | 404, no auth |

- Every route but `GET /images/:id` requires `Authorization: Bearer <OLIGARCHY_TOKEN>`; a missing
  or wrong token is 401 `{"error":"unauthorized"}`. The compare is exact string equality on the
  `Redacted` values.
- Every `Sessions` route may also answer 400 (a bad body or query, message from the schema; a
  malformed JSON body is `Expected a valid JSON body`), 401 and 500 (`{"error":"internal error"}`,
  a defect) through the group middleware, so they are not listed per row. Every 4xx and 5xx body is
  `{"error":"<message>"}`; `{"ok":"true"}` carries the string `"true"`; anything unrouted is 404
  `{"error":"not found"}` and is not logged, and neither is `GET /images/<not a uuid or unknown>`:
  the handler answers that 404 raw, so no error line or row is written (v1 parity); a database
  failure on that route is still a logged 500.
- Session lookup on every driving route: `session id is required` (400), `unknown session "<id>"`
  (404), `agent "<agent>" does not own session "<id>"` (403). The lookup resets the inactivity
  window even when the work that follows fails; `/follow` and `/dump` never reset it.
- `POST /start`: `iso` is a path or an http(s) URL (`Domain.isIsoUrl`, the one prefix test the
  client, `Iso.getIso` and `Sessions.start` share). A URL is cached under `~/.oligarchy/isos` with
  `manifest.json`, `.partial-<pid>` downloads, an optional `<url>.sha256` sidecar, a 10 s heartbeat
  and poll, 30 s stale; the downloader follows up to 20 redirects (`HttpClient.followRedirects(20)`,
  ISO and sidecar alike), a 21st failing `iso: download failed: <url>: HTTP 302`. The order is
  fixed: stat the caller's `disk` (`qemu: disk not found: <path>`), fetch the ISO, `Qemu.prepare`
  (dir, default 40G qcow2, OVMF vars), `registerAgent`, `Qemu.start`; a wrong disk costs no
  download, and a failed download or `qemu-img` never burns the agent's one registration. A boot
  failure is 502.
- `GET /follow`: 404 `unknown session "<id>"`; 409 `session "<id>" is not running on this proxy`
  for a row this proxy does not hold, `session "<id>" has already completed (<status>)` for a
  finished one.
- `GET /dump`: a non-UUID id is 404 `unknown session "<id>"` before disk is touched; a running
  session answers from memory, a lost one from `<tmpdir>/oligarchy-<id>/serial.log`; no file is 409
  `session "<id>" has no console on this proxy`.
- `GET /stats`: `{"qemus", "memory": {totalBytes, usedBytes, freeBytes}, "cpu": {cores, mean, p10,
  p25, p75, p90}}`; `qemus` is the size of the sessions map; cpu is a 5 s sampler over 60 samples
  reporting 0 before the first; `usedBytes = totalBytes - freeBytes`.
- `POST /stop`: default status `aborted`, no reason; `timed_out` is proxy-owned and not accepted.
  `stop` claims the id with `Ref.modify` on the sessions map; when the sweep removed it first the
  request is 404 `unknown session "<id>"`, so a session gets one verdict and one final follow line.
- `POST /send-keys`: 400 with the `parseKeys` message or `send-keys: at most 1000 keys per
  request`; 60 ms between chords.
- `POST /send-mouse`: `x`/`y` in `0..1` (`mouse: x and y must be in 0..1`), `round(v * 0x7fff)`
  absolute; `clicks` an integer in `1..100` (`mouse: clicks must be an integer in 1..100`); press
  and release are separate `input-send-event`s, 50 ms between clicks, and the release goes out even
  after a failed press (`Effect.exit` around the press, the release, then the press's exit).
- `POST /intent/start`: a second open intent is 400
  `Cannot start one intent when one's already running. Please end your previous intent.`;
  `POST /intent/end` without one is 400 `no active intent`.
- Ten minutes without a driving request closes the session as `timed_out` with reason
  `no command received for 10 minutes` and the log line
  `timed out; no command received for 10 minutes`; the sweep runs every 10 s and is authoritative.
- The session dir is `<tmpdir>/oligarchy-<uuid>` (0o700) with `disk.qcow2`, `qmp.sock`,
  `serial.log`, `OVMF_VARS.fd` and transient `image-<hrtime>.png`; it survives a crash for `/dump`.
  The socket path is 60-odd characters against a 108 limit; do not move it deeper. QEMU runs with
  `-machine q35,accel=kvm -cpu host -m 4G -smp 2`, OVMF pflash, `-display <d>`, `qemu-xhci` and
  `usb-tablet`, the QMP and serial chardevs, `-cdrom <iso> -boot order=d`, the virtio qcow2 drive.

## Follow events

`GET /follow` streams these six lines, one JSON object per line, in the `FollowEvent` shape.

```json
{"type": "session", "status": "<status>"}
{"type": "intent", "state": "started", "message": "<message>"}
{"type": "intent", "state": "completed" | "cancelled"}
{"type": "action", "id": 7, "name": "<name>", "state": "running"}
{"type": "action", "id": 7, "state": "completed" | "failed"}
{"type": "image", "id": "<uuid>", "png": "<base64>"}
```

- `<status>` is `pending`, `running`, `succeeded`, `failed`, `aborted` or `timed_out`; `<name>` is
  `send-keys`, `send-mouse`, `get-image` or `get-serial`.
- The first line is always the session's status: `pending` while its `/start` has not returned,
  else `running`. If an intent is open its `started` line comes next; if the session has taken an
  image the latest one follows. The last line is the session's end status, then the stream closes;
  a stop, a timeout, a failed start and proxy shutdown all end it this way.
- An `action` is one request (`/send-keys`, `/send-mouse`, `/image`, `/serial`), not one QMP
  exchange; `id` is a per-session counter, only the name is carried, and a request refused before
  any work never appears. `image` lands before that action's `completed` line and carries the same
  uuid as `GET /images/:id`. `intent` `cancelled` is a session that ended with its intent open.
  The follow view decodes `png` with `Result.getOrThrow`: bad base64 from our own proxy is a defect.
- Each follower is a `Queue.dropping(64)`; when `Queue.offerUnsafe` returns `false` the follower is
  ended with `Queue.endUnsafe`, logged `follower dropped; 64 events behind` at warning, and removed:
  the only way a stream ends without a final `session` line. Attaching logs `follower attached`, a
  consumer that leaves logs `follower detached` (a session that ends does not), both at info. The
  queue is registered synchronously after the lookup, so a session that ends before the body
  streams still ends this queue; one registered while the session is finishing is ended at once.

## HttpApi server

- The contract lives in three files: `src/shared/api.ts` (middleware tags, `HttpApiEndpoint`s,
  the `Sessions` and `Images` groups, `ProxyApi`, `VERSION`), `contract.ts` (`Schema.Class` DTOs
  and the `SessionQuery`/`IdQuery` field objects), `errors.ts` (errors and wire codecs). No handler
  code lives there; `HttpApiEndpoint`, `HttpApiGroup.make`, `HttpApi.make` appear only in `api.ts`.
- Declare endpoints as `HttpApiEndpoint.get/post(name, path, { params, query, payload, success,
  error })`; binary via `Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType }))`,
  headers via `HttpApiSchema.WithHeaders`, byte streams via `HttpApiSchema.StreamUint8Array`.
- Group with `HttpApiGroup.make("Sessions").add(...).middleware(BearerAuth)
  .middleware(ApiBoundary)`; middleware `error` schemas merge into every endpoint of the group, so
  400/401/500 are not listed per endpoint. `Images` carries only `ApiBoundary`. Middlewares wrap
  in insertion order, so `ApiBoundary` is outermost and logs an `Unauthorized`. A missing bearer
  header arrives as `Redacted.make("")`.
- Implement groups in `src/proxy/handlers.ts` as `SessionsLive(display, automation)` and
  `ImagesLive`: `HttpApiBuilder.group(ProxyApi, "Sessions", (handlers) => handlers.handle(name,
  ({ payload, query, params }) => Effect.gen(...), { uninterruptible: true }))`, each handler
  `yield*`ing `Sessions` and consuming the decoded contract (`image` returns
  `HttpApiSchema.withHeaders({ body: png, headers: { "x-image-url": url } })`); every
  session-driving handler is uninterruptible (a client that disconnects mid-`/start` must not leave
  an orphan QEMU); `follow`, `dump` and `stats` are interruptible; `handleRaw` when the handler
  owns the `HttpServerResponse`: `follow` (the NDJSON stream) and `storedImage`, whose two 404s
  return the catch-all's `notFound` response rather than raising, so the boundary writes no error
  line for an unknown image. `Handlers.routes(display, automation)` merges
  `HttpApiBuilder.layer(ProxyApi)` over the groups and middlewares with the catch-all
  `HttpRouter.add("*", "*", notFound)`, the only route outside the api.
- `ApiBoundary` turns `HttpApiError.HttpApiSchemaError` into `BadRequest` (400), re-fails a
  declared `ApiError`, sends anything else down the defect path, turns a defect into `Internal`
  (500), and logs every failed request as one error line `<METHOD> <url> failed: <detail>`
  attributed as far as the handler knew, with `skipSentry` below 500 and the cause from 500 up.
  `detail` is the error's `message`, except for `Internal`, whose cause is a wrapper (drizzle's
  `Failed query: …`, a `PlatformError`): the line carries `causeOf(error.cause)`, the driver's or
  Node's message one level down (`POST /stop failed: connect ECONNREFUSED 127.0.0.1:5432`, `…
  failed: ENOENT: no such file or directory, open '…/serial.log'`), as v1 logged it. A defect's
  detail is `Cause.pretty` of the die.
- Serve with `HttpRouter.serve(Handlers.routes(display, automation), { disableLogger: true,
  disableListenLog: true })` (never Effect's built-in request logger) over
  `NodeHttpServer.layer(() => server, { host, port })`.
- Provide `Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)` so no `http.server` span
  reaches Sentry and the session span stays a root. Fail before listening when the host check or
  the database ping fails; never fall back to another port.

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

- Derive the client from the same `HttpApi`: `HttpApiClient.make(Api.ProxyApi, { baseUrl,
  transformClient: HttpClient.filterStatusOk })`, bearer injected once through
  `HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
  next(HttpClientRequest.bearerToken(request, token)))`. Build every payload with the contract's
  `.make`. Why `filterStatusOk`: every non-2xx answer is refused before the generated client
  decodes it, so a declared error status with a body that is not `{ "error" }` cannot be combined
  with its schema failure.
- Provide the transport once at the root with `NodeHttpClient.layerNodeHttp`. Why: it has no
  undici header or body timeout, so a `/start` that waits 45 minutes for a first-time ISO download
  and an unbounded `/follow` both survive. `/start` carries `Effect.timeoutOrElse({ duration:
  START_TIMEOUT, orElse })` (`"45 minutes"`) failing `ProxyUnreachable` `start: no response within
  timeout`; `/follow` goes through the raw `HttpClient` with `bearerToken`, has no timeout, and
  hands back `response.stream` unbuffered.
- Wrap every call in one `run(label, effect)` (`label` is `<METHOD> <serverUrl><path> failed`)
  that maps an `HttpClientError` with a non-2xx response to `ProxyRefusal { status, message }`,
  the message read from the raw body (`apiError(text)`: the `error` string of a `{ "error" }`
  body, any other body raw, an empty body `request failed`); one without a response to
  `ProxyUnreachable { message: "<METHOD> <url> failed", cause }` (the headline appends the cause:
  `POST http://127.0.0.1:42069/send-keys failed: connect ECONNREFUSED 127.0.0.1:42069`); a
  `SchemaError` on a success body to `ProxyUnreachable { message: label, cause }`; a decoded
  `ApiError` to `ProxyRefusal { status: apiStatus(error), message }`, never on its `_tag`.
- Fake HTTP in tests with `HttpClient.make((request, url) => Effect.succeed(response))` provided as
  `Layer.succeed(HttpClient.HttpClient)(fake)` (`test/support/fake-http.ts`: `respondWith`,
  `recordRequests`, `json`, `never`, `die`); never stub `globalThis.fetch`.

`ProxyClient.connect({ serverUrl, token })` in `src/client/proxy-client.ts` builds the bearer
`layerClient` with `Effect.scoped(Layer.build(bearer))` (the layer holds no resources), makes the
`HttpApiClient` behind `filterStatusOk`, and returns `{ start, image, serial, dump, sendKeys,
sendMouse, intentStart, intentEnd, stop, follow }`, each call wrapped in `run`.

## Linear and Cursor

- Describe Linear's GraphQL API in `src/ctrl/linear.ts` as one `HttpClientRequest.post` per
  operation with `HttpClientRequest.setHeader("Authorization", Redacted.value(token))` (the raw
  token, no `Bearer`), a `Content-Type: application/json` header,
  `HttpClientRequest.bodyJsonUnsafe({ query, variables })`, and the body decoded in two phases:
  the envelope with `HttpClientResponse.schemaBodyJson(Envelope)` (`data` as `Schema.Unknown`,
  `errors` as `{ message }[]`), then `Schema.decodeUnknownEffect(data)(envelope.data)` once
  `errors` is empty and `data` present. Why: GraphQL sends both together, and the operation's shape
  must not swallow the failure text. `labelId`, `labelIds`, `createIssue` and `describeIssue` are
  `Effect.fn("Linear.<op>")`; `teamId`, `assigneeId` and `listBacklog` are plain Effects.
- One error class per client: `LinearError { operation, message, status?, cause? }`. A transport
  failure is `linear: request failed` with the cause; a non-2xx status is
  `linear: request failed (<status>)[: <text>]`; an undecodable body, a missing `data` or a further
  page without a cursor is `linear: invalid response`; GraphQL `errors` are `linear: <messages
  joined by "; ">`; the rest: `linear: no team named Oligarchy`, `linear: label creation failed`,
  `linear: no user prime@terminal.shop`, `linear: issue creation failed`, `linear: describing
  <identifier> failed`, `linear: prompts/<file> uses {{NAME}}, which has no value`, and
  `linear: <platform message>` when a template cannot be read.
- The team is `Oligarchy`; labels are `agent test` and the run's version, created when missing;
  the assignee is `prime@terminal.shop`; titles are `Omarchy: <name>`; an issue is created then
  described in a second call because the body names its own identifier; the backlog pages with
  `first: 100` until `hasNextPage` is false. GraphQL query texts are copied from `v1/src/linear.ts`.
- Each command reads only the templates it renders, once, by path relative to the module:
  `Linear.loadIssuePrompts` (an Effect over `FileSystem`) reads `prompts/linear-issue.html`,
  `client.md` and `ctrl-linear.md` into an `IssuePrompts` record for `test new`;
  `Linear.loadDrivingPrompt` reads `prompts/driving-agent.html` alone for `test run`, so an
  unreadable guide cannot stop a run. The pure renderers `linearTicketDescription(experiment,
  test, ticket, prompts)` and `drivingAgentPrompt(ticket, template)` fill `{{NAME}}` from
  `LINEAR_TICKET, RUN_ID, RESULT_ID, VERSION, ISO_URL, SERVER_URL, TEST_NAME, TEST_DESCRIPTION,
  TEST_INSTRUCTION, TEST_PROOF, CLIENT_MD, CTRL_MD, SUB_AGENT` (`Grok 4.6 high fast
  (cursor-grok-4.6-high-fast)`) into a `Result`.
- `ctrl test-results` calls `log.acquireColor(agentId)` before its `test result <id>: <status>[;
  <reason>]` line (the agent has no live session on that process); a verdict without `--reason`
  leaves the stored reason in place (`TestStore.closeResult` omits the key, as for `session_id`).
- Wrap `@cursor/sdk` in `src/ctrl/cursor.ts` as `CursorAgents`, the one file that imports it:
  `Effect.acquireUseRelease` around `Agent.create({ apiKey, model, cloud: { repos: [{ url }] } })`,
  `agent.send(text)`, and a release of `Effect.sync(() => agent.close())`; `create` and `send`
  are `Effect.tryPromise({ try, catch: cursorAgentFailed })` classifying into
  `CursorAgentFailed { message, retryable, cause }` (the SDK's own `isRetryable` when it has one).
  The default model is `GROK_4_6_FAST_XHIGH`, `{ id: "grok-4.6", params: [{ id: "effort", value:
  "xhigh" }, { id: "fast", value: "true" }] }`, on `https://github.com/ThePrimeagen/Oligarchy`;
  `test run` prints `Agent here, go check it out for more information:
  https://cursor.com/agents/<id>` and never waits for the agent.

`request` in `src/ctrl/linear.ts` (an excerpt; the POST and the status branch are elided): the
envelope first, the operation's `data` second.

```ts
const Envelope = Schema.Struct({
  data: Schema.optionalKey(Schema.Unknown),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
const decodeEnvelope = HttpClientResponse.schemaBodyJson(Envelope);

const request = <S extends Schema.Top>(
  operation: string,
  query: string,
  variables: Readonly<Record<string, unknown>>,
  data: S,
): Effect.Effect<S["Type"], Errors.LinearError, S["DecodingServices"]> =>
  Effect.gen(function* () {
    // ... the POST, then a non-2xx status fails `linear: request failed (<status>)[: <text>]`
    const envelope = yield* decodeEnvelope(response).pipe(
      Effect.mapError((cause) => invalidResponse(operation, cause)),
    );
    if (envelope.errors !== undefined && envelope.errors.length > 0) {
      return yield* Errors.LinearError.make({
        operation,
        message: `linear: ${envelope.errors.map((error) => error.message).join("; ")}`,
      });
    }
    if (envelope.data === undefined) {
      return yield* invalidResponse(operation);
    }
    return yield* Schema.decodeUnknownEffect(data)(envelope.data).pipe(
      Effect.mapError((cause) => invalidResponse(operation, cause)),
    );
  });
```

## QMP socket

- The proxy listens on `<dir>/qmp.sock` before spawning QEMU; QEMU connects. `src/qmp/socket.ts`
  is the one file that imports `node:net`: `listen(path)` wraps `net.createServer` in
  `Effect.callback` + `Effect.acquireRelease` and returns a `QmpListener` whose `accept` takes
  exactly one connection (a second is destroyed), closes the listener, and yields
  `QmpSocket { lines, write, close }`. `QmpListen` is the `Context.Service<QmpListen,
  QmpListenService>` seam around it; `Qemu.layer` provides `QmpListen.layer` privately and a test
  provides `fakeListen`. Why: the interface is the test seam; a fake `QmpSocket` drives
  `src/qmp/client.ts` without a socket.
- `lines` carries raw utf8 chunks; framing is the client's. `src/qmp/framing.ts` is pure:
  `split(buffer)` is the brace-depth JSON splitter (string-aware, so a brace quoted in an error's
  `desc` cannot mis-frame), `decodeFrame(frame)` runs `Domain.decodeQmpInbound`
  (`Schema.decodeUnknownExit` over `Schema.fromJsonString(Schema.toCodecJson(QmpInbound))`) into a
  `Result`, and `feed(rest, chunk)` does both. The client's reader fiber feeds every chunk; an
  unparsable frame fails every pending request with a `QmpClosed` carrying the `QmpProtocolError`
  and closes the socket.
- Correlate request and response with a `Map<id, { command, deferred }>` in the handshake closure:
  register before writing, `Deferred.await` under `Effect.timeoutOrElse` (`COMMAND_TIMEOUT_MS`,
  30 s, `QmpTimeout` `qemu: <name> timed out`), `Effect.ensuring` the delete, and reject every
  pending `Deferred` when the socket closes (`QmpClosed`: `qemu: socket closed` from the peer,
  `qemu: closed` when we close it). A late reply is ignored; ids are a per-client counter.
- `QmpClient.execute(request: { execute, arguments }, record?)` numbers the request itself
  (`QmpRequest` is a `QmpCommand` without `id`), runs the exchange under `Effect.result` and
  answers the `return` value. The recorder hook opens the action row before the write and the
  `open` flag is re-checked after it (`qemu: closed`); an `{error}` reply is `QmpError { command,
  class, desc, raw }`. A failing recorder close after a failed exchange only logs
  `db: recording a failed exchange failed too: <message>`; after a completed exchange it surfaces.
  The client is `{ execute, closed }`, `closed` resolving with the reason once the socket is gone.
- The handshake is the readiness probe: `Effect.timeoutOrElse` at `HANDSHAKE_MS` (10 s) around
  the greeting and again in `Qemu.start` around accept and handshake
  (`qemu: handshake timeout[: <stderr>]`); the greeting is recorded as the reply to
  `qmp_capabilities`. There is no restart policy.

The seam in `src/qmp/socket.ts` (an excerpt; `listen` is the `node:net` implementation): the
socket, the listener and the service `Qemu` asks for it.

```ts
export type QmpSocket = {
  // Raw utf8 chunks as they arrive; framing is the caller's.
  readonly lines: Stream.Stream<string, Errors.QmpClosed>;
  readonly write: (text: string) => Effect.Effect<void, Errors.QmpClosed>;
  readonly close: Effect.Effect<void>;
};

export type QmpListener = {
  // The first connection; the listener stops accepting once it has arrived.
  readonly accept: Effect.Effect<QmpSocket, Errors.QmpClosed, Scope.Scope>;
};

export type QmpListenService = {
  readonly listen: (path: string) => Effect.Effect<QmpListener, Errors.QmpClosed, Scope.Scope>;
};

// The test seam: Qemu asks this service for its listener instead of node:net directly.
export class QmpListen extends Context.Service<QmpListen, QmpListenService>()(
  "@oligarchy/qmp/QmpListen",
) {
  static readonly layer: Layer.Layer<QmpListen> = Layer.succeed(this)(this.of({ listen }));
}
```

## Child processes

- Spawn through `effect/unstable/process`: `ChildProcess.make(executable, args, { cwd, env,
  extendEnv, stdin, stdout, stderr, detached, killSignal, forceKillAfter })` handed to
  `spawner.spawn` from `ChildProcessSpawner` (a scoped handle: `pid`, `exitCode`, `isRunning`,
  `kill`, `stdout`, `stderr`), the one-shot `spawner.exitCode` for `qemu-img` and `command -v`, or
  `spawner.string(command, { includeStderr: true })` for `-display help`.
- Leaving the scope stops the child: the spawner's own release sends `killSignal`, escalates to
  `SIGKILL` after `forceKillAfter`, and awaits the exit. Add a finalizer only to record an expected
  exit. QEMU runs with `stdin: "ignore", stdout: "ignore", stderr: "pipe", extendEnv: true,
  detached: false, killSignal: "SIGTERM", forceKillAfter: FORCE_KILL_AFTER` (`"5 seconds"`),
  inheriting the proxy's environment and nothing more: a stop, the sweep or shutdown sends QEMU
  `SIGTERM`, waits at most five seconds, then `SIGKILL`, so a wedged machine cannot hold `/stop`,
  the sweep tick or the drain (the release awaits the exit, unlike v1's `proc.kill()`).
- `env` replaces the inherited environment unless `extendEnv: true`; the session REPL's `./client`
  and `./ctrl` children use `extendEnv: true` (how they read `OLIGARCHY_TOKEN`; nothing secret is
  on argv), and `./client` is `detached: true` so a hangup that reaches the foreground group cannot
  kill a start before it hands back its id; `./ctrl` stays attached so interrupting the picker
  kills it.
- Keep the last 4096 bytes of stderr in a `Ref` drained by a `forkScoped` fiber; publish exit
  through a `Deferred<number | null>` (`null` for a signal death); join the drain fiber before
  reading the tail after exit, so `qemu: exited <code> before QMP connect[: <stderr>]` carries the
  whole tail. `Process.spawn(executable, args)` returns `QemuProcess { exited, exitedBeforeConnect,
  withStderr, stderrTail }`; `stderrTail` is the raw drained bytes (last 4096). `spawnQemu(args)`
  is `spawn(Args.QEMU_BIN, args)`. Readiness is a bounded wait (`Effect.timeoutOrElse`); secrets
  go to children on stdin as a `Stream`, never argv. The session's `spawnFollow` exit carries
  `{ code, killed, stderr }` so the REPL can tell a detach from a refusal.
- `Qemu` boots in two steps under the session's scope: `Qemu.prepare(id, disk)` (below) returns
  `Prepared { id, dir, diskPath }`, `diskPath` the caller's disk or the fresh qcow2; `Qemu.start(
  prepared, { iso, display, automation, record })` listens on `<dir>/qmp.sock`, spawns QEMU
  (`-display` is `display` as given; the command already resolved `--automation` to `none`), races
  `accept` against the process exiting, and returns `QemuHandle { id, dir, serialPath, sendKeys,
  sendMouse, screendump, stderrTail }`; a dead QEMU is noticed by the next command failing, not by
  a watcher.
- File I/O goes through `FileSystem.FileSystem` and `Path.Path` from `NodeServices.layer`; write
  private files atomically (`writeFile(tmp, bytes, { mode: 0o600 })` then `rename`), create
  private directories with `makeDirectory(dir, { recursive: true, mode: 0o700 })`, recover
  `PlatformError` by `error.reason._tag === "NotFound"` and map every other platform failure at the
  module boundary. The ISO cache's `manifest.json` and its download are written as
  `<path>.partial-<pid>` then renamed. URLs are WHATWG `URL`/`URL.canParse`; Effect's `Url` module
  is unused.

`Qemu.prepare` in `src/qemu/qemu.ts`: the session dir with its removal registered first, the
default disk through `qemu-img` (`Process.createDisk`), the firmware copy; `start` spawns QEMU
into the same scope afterwards, so the dir outlives the machine.

```ts
const prepare = Effect.fn("Qemu.prepare")(function* (id: string, disk: string | undefined) {
  const dir = sessionDir(id);
  yield* fs
    .makeDirectory(dir, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError(startError));
  // Registered before anything `start` registers, so it runs last: QEMU is dead and the socket
  // closed before the dir goes.
  yield* Effect.addFinalizer(() =>
    fs.remove(dir, { recursive: true, force: true }).pipe(
      Effect.catch((error) =>
        log.error(`qemu: removing ${dir} failed: ${Process.detail(error)}`, {
          sessionId: id,
          cause: error,
        }),
      ),
    ),
  );
  const diskPath = path.join(dir, "disk.qcow2");
  if (disk === undefined) {
    yield* withSpawner(Process.createDisk(diskPath, Args.DEFAULT_DISK_SIZE));
  }
  yield* fs
    .copyFile(Args.OVMF_VARS, path.join(dir, "OVMF_VARS.fd"))
    .pipe(Effect.mapError(startError));
  return { id, dir, diskPath: disk ?? diskPath } satisfies Prepared;
});
```

## Database

- One `Database` service in `src/db/client.ts` owns one scoped `pg.Pool`: `Effect.acquireRelease`,
  `pool.on("error")` re-entering Effect with `Effect.runForkWith(context)`, released with
  `pool.end()` whose failure is logged (`db: pool close failed: <detail>`), never raised. The pool
  does not connect at acquire; the proxy's `ping` (`select 1`) is the startup check
  (`database unreachable: <detail>`).
- Drizzle 0.45 (`drizzle-orm/node-postgres`) with drizzle-kit 0.31 and `pg`, behind the service.
  Why not drizzle 1.0: its kit rewrites `drizzle/`, and migrations are append-only. Why not
  `@effect/sql-pg`: `schema.ts` and `drizzle/**` move as they are and the service is the Effect
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
- Multi-step writes run in one transaction: `endSession` stamps the session and its open
  `agent_runs` with one `now()`; `finishAction` with an image writes `actions` and `images`
  together; `createRun` inserts the run and its results together; `failRun` closes both.
- `normalizeDatabaseUrl` guards with `URL.canParse` (`db: DATABASE_URL is not a valid url`, and the
  password never lands in a message), drops `sslrootcert=system` (node-postgres reads it as a file
  path) and keeps `sslmode=verify-full`.
- Repositories are `Context.Service`s (`SessionStore`, `ActionStore`, `LogStore`, `DebugLogStore`, `TestStore`)
  whose methods are `Effect.fn("db.<name>")` functions that `yield* Database` once in `make`.
  Drizzle-typed columns are trusted; the `jsonb` columns (`sessions.config`, `actions.request`,
  `actions.response`) are written from schema-typed values and read back as Drizzle types them.
- `src/db/schema.ts` is v1's schema formatted by oxfmt, plus `debug_logs` (v2-only). The v1
  tables stay semantically identical (`drizzle-kit check` and the `schema-in-sync` job pass
  against the moved migrations), not byte-identical. Its `pgEnum` lists and the `Schema.Literals`
  in `domain.ts` are maintained by hand together. Row
  stamps come from Postgres `now()` in the statement; Effect-side time from
  `Clock.currentTimeMillis`. `registerAgent`'s primary key makes one session per agent; a second
  registration is a `DatabaseError` by design. `TestStore.closeResult(resultId, status, reason,
  sessionId)` omits a `null` `reason` or `sessionId` from the update (drizzle writes `null` but
  skips an absent key), so an earlier command's values stay.

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

## Action record

- An action is one QMP exchange, opened then closed, its id relating the two. `startAction` inserts
  the row the moment the command goes out with the exact command JSON (`execute` names the command;
  there is no kind column) and returns the identity id.
- `finishAction` closes it in one of two states: `completed` with QEMU's exact reply (the greeting
  for the boot handshake, the `{return}` otherwise) or `failed` with the error (QEMU's `{error}`
  reply, or this server's message when the failure never reached QEMU). There is no error column.
- A completed `get-image` passes `{ id, data }` and the update plus the `images` insert land in one
  transaction; images are 1:1 with their action and addressed by a uuid, served at
  `GET /images/<uuid>` here and at `https://oligarchy.trm.sh/images/<uuid>`
  (`Contract.StoredImageUrl(id)`). A screendump whose image write failed leaves the action row
  open; only a failed exchange is closed without an image.
- `finished_at - created_at` is per-exchange handling time on one clock. Request-level wall time is
  the log line's (`running; started in <ms>ms`, `image; <n> bytes in <ms>ms; <url>`,
  `serial; <n> bytes in <ms>ms`, `dump; <n> bytes from disk|the running machine in <ms>ms`,
  `sent <n> chords in <ms>ms`, `mouse <x> <y>[ <button>[ ×<clicks>]] in <ms>ms`), because a request
  spans many exchanges or work that is no exchange at all.
- Anything that exchanges nothing over QMP (a stop, a verdict, `/serial`, `/dump`, an intent) is
  not an action; the session row is its record. The session row lands before any boot work
  (`downloading` for a URL iso, else `running`; logged `starting; iso <iso>[, disk <disk>]`),
  `sessionRunning` flips it once QEMU is up, `endSession` closes it with the verdict and reason
  (logged `stopped; <status>[; <reason>]`); intents log `intent start; <message>` and
  `intent end`.
- Replay is `actions WHERE session_id ORDER BY created_at, id`; the identity id breaks timestamp
  ties. `sessions.config` holds the effective launch config so a replay boots an identical machine.
- The tables: `sessions`, `agent_runs`, `actions`, `images`, `logs`, `debug_logs`,
  `test_definitions`, `test_base_prompts`, `test_runs`, `test_results`, declared in
  `src/db/schema.ts`. v1 declared every table except `debug_logs`.

## Log stream

- Application code logs through the `Log` service (`src/observability/log.ts`): `info`, `warning`,
  `error`, `fatal`, `acquireColor`, `releaseColor`, `flush`. Messages are fixed sentences; every
  variable is in the attribution (`sessionId`, `agentId`) or in the text after the `;`, as in
  `log.info(\`running; started in ${String(ms)}ms\`, { sessionId, agentId })`.
- Each line is written twice: to stdout through `Console.log` when the method runs, and as a
  `logs` row `Queue.offerUnsafe`d to a `Queue.unbounded` drained by one `forkScoped` fiber that
  inserts in call order. The queue is unbounded by policy, as v1's promise chain was: a log call
  never blocks or drops a row because the database is slow; a long outage costs memory, accepted.
  A failed insert writes `db: log insert failed: <cause message>` to stdout, reports it to Sentry
  as a defect, and never fails the caller. `id`, not `created_at`, orders rows.
- stdout is the convenience copy; the rows and Sentry are the record. The proxy's `main.ts`
  attaches a no-op `error` listener to `process.stdout` and `process.stderr`, so a write refused by
  a full filesystem (`ENOSPC`) drops that line instead of raising an uncaught exception per line,
  which took a proxy down under six installs filling a tmpfs.
- The stdout line is `[<agent>] text` with the agent in a Rose Pine colour taken round-robin by
  `acquireColor` (`Sessions.start` before the row is inserted; `ctrl test-results` before its
  line) and released by `releaseColor` when the session ends; `emit` only looks the colour up, so
  any other agent id stays gray and failed requests cannot grow the palette. `[global] text` is
  gray with no agent, `[agent] gray(sessionId): text` with a session, and non-info lines carry a
  `<level>: ` prefix. Colour is the `Log.Colors` `Context.Reference`, defaulting to
  `Render.stdoutColors` (a TTY or `FORCE_COLOR`, and `hasColors(16)`); tests override it. The row
  is the original text, level and attribution; prefix and colour are stdout only.
- Levels are the `log_level` enum in ascending severity and mean severity of the operation, not of
  the state recorded: `info` is the normal story (listening, starting, running, image, serial,
  chords, mouse, intent, stopped, iso cache traffic); `warning` is degraded but went on (a heartbeat
  that failed to write, an iso with no sha256, a follower dropped); `error` is an operation that
  failed (one line per failed request from the HTTP boundary, an action close that could not be
  recorded, a session that would not stop at shutdown, a defect with its stack); `fatal` is the
  proxy going down, written right before the exit. A `/stop` carrying a `failed` verdict logs at
  info: the stop worked.
- `error` and `fatal` report to the `ErrorReporter`s captured when the layer was built, unless
  `skipSentry` is set: always as `Cause.fail(Errors.LogLine.make({ text, level, cause? }))`, so the
  line's own `[ErrorReporter.severity]` carries the level. The reporter hands Sentry the `cause`
  when the line has one (what Sentry groups on, as v1) and the `LogLine` itself otherwise, at the
  line's level either way: `log.fatal("proxy: …", { cause })` arrives as `fatal`, never `error`.
  4xx request refusals set `skipSentry`: they are the client's mistake.
- `flush` resolves when every offered row has been inserted or its failure reported; the layer
  finalizer runs `flush` before the drain fiber is interrupted, and `Log.layer` (over `LogStore`)
  sits above `Database` so the flush completes before the pool closes. `Log.layer` reads
  `ErrorReporter.CurrentErrorReporters` once at build, so `SentryLive` is provided beneath it,
  never only to callers. `Log.layerStdout` persists nothing and is for tests; ctrl carries the
  full `Log.layer` over its stores. A fatal path flushes the log, then Sentry, then exits.
- `Log` installs no Effect `Logger`; `emit` formats, writes and offers synchronously. `console.*`
  appears only in `src/dashboard/**` and `vitest.global-setup.ts`. Test log output through the
  fake `Log` layer (`test/support/log.ts`) or `Log.layerStdout` with `TestConsole.logLines`.

## Failed-session debug log

A `/stop` with status `failed` writes one `debug_logs` row keyed by `session_id` after the
stopped line and before the session scope is closed. The row is the crash artifact: everything
that would otherwise vanish with the machine, plus the control-plane lines already offered for
that session, including `stopped; failed`. `sources` is a jsonb map so each chunk is labeled by
origin. There is no `journalctl` key — that stream is not separately available.

- `serial` is the guest UART (`/dev/ttyS0` → `<session-dir>/serial.log`; see Operating loop).
  The guest journal, dmesg, user-session journal, coredumps and compositor crash folders live
  inside the guest. A live ISO keeps them in RAM (`-boot order=d` boots the CD, the qcow2 is
  empty until an install writes it), so mounting the disk after QEMU dies yields nothing.
  `journalctl`, `dmesg`, Hyprland and Quickshell text appear here only if something wrote them
  to the UART. `qemu-guest-agent` / `guest-exec` is not on the Omarchy desktop ISO, and a
  virtio-serial channel nobody speaks is unused hardware.
- `proxy` is the control-plane `logs` rows for the session, formatted `created_at level text`.
- `qemu` is the QEMU process stderr tail (last 4096 bytes): KVM, device and host boot failures.
  It is read from `QemuHandle.stderrTail` before `kill` (the tail already holds what QEMU wrote
  while the guest was failing). Closing the scope interrupts the drain fiber, so a post-kill
  read can miss bytes written on SIGTERM.
- `actions` is the QMP flight recorder for the session, formatted
  `created_at id state request[ response]`. Screenshots stay on `images`; they already outlive
  the process and are binary.
- `kill` closes the session scope: QEMU dies and the prepare finalizer removes the directory.
  The serial file has to be read first. A missing file is an empty serial (nothing wrote); any
  other read failure is `debug log: serial read failed: <detail>` at error and the serial is
  stored empty. Every `sources` key is always present; an origin that produced nothing is `""`.
- `Log.flush` runs before the insert so `listLogs` sees every offered row, the stopped line
  included. Each source is capped at 1 MiB independently; a longer value keeps the tail (the
  crash and the verdict) and starts `[truncated]\n`.
- The insert is best-effort: `debug log save failed: <detail>` at error and the stop still
  closes the session. A second save for the same session is a `DatabaseError` by design; stop
  writes at most once. Succeeded, aborted and timed-out stops do not write a row — those
  verdicts are not a failed test session.
- The columns: `session_id` (primary key, references `sessions.id`), `sources`, `created_at`.

## Sentry

- Initialise the SDK before any Effect code in `src/observability/instrument.ts`, loaded by the
  `server` wrapper's `--import`: `Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 1,
  traceLifecycle: "stream", integrations: [Sentry.httpIntegration({ spans: false }),
  Sentry.nativeNodeFetchIntegration({ spans: false })] })`. `SENTRY_DSN` in `dsn.ts` is the one
  hard-coded constant (public by design) and is shared with the dashboard.
- `@sentry/node` and `@sentry/effect` are imported only in `src/observability/`;
  `@sentry/cloudflare` only in `src/dashboard/`. All three are pinned to one version so
  `@sentry/core` is not duplicated (`SentryEffectTracer` relies on one `getActiveSpan()`).
- Route exceptions through one `ErrorReporter.make` installed with `ErrorReporter.layer([reporter])`
  (below); never call `captureException` elsewhere. Tags are `session_id`/`agent_id` read from
  `fiber.getRef(References.CurrentLogAnnotations)` (the `Log` methods annotate them, with the text
  as `log`) merged with the reporter's `attributes`, which no error of ours sets; Effect's `Warn`
  maps to `warning`, `Fatal` to `fatal`, every other severity to `error`.
- Install the tracer with `Layer.succeed(Tracer.Tracer)(tracer)`, where `tracer` is a
  `Tracer.make` wrapping `SentryEffectTracer`: a span whose annotations carry the private
  `Exported` reference goes to `SentryEffectTracer.span`, every other span is a
  `Tracer.NativeSpan` no-op. Only `Sentry.sessionSpan`, `Sentry.intentSpan` and
  `Sentry.actionSpan` set it, so `Effect.fn("Service.method")` spans never reach Sentry.
- All three exported spans are held by hand with `Effect.makeSpan(name, { root?, parent?,
  annotations, attributes })`, `span.attribute(k, v)` and `span.end(nanos, exit)`, because each
  opens and ends in different Effects: `QEMU session` (op `qemu.session`, attributes `session_id`,
  `agent_id`, ending with `session_status`) from `sessionSpan(sessionId, agentId)` /
  `endSessionSpan(span, status)`; the intent span named by its message (op `agent.intent`,
  attributes `session_id`, `agent_id`, `test_result_id`, `intent`, ending with `intent_state`)
  from `intentSpan(parent, ...)` / `endIntentSpan(span, state)`; and `QMP <cmd>` (op
  `qemu.action`, `session_id`, `agent_id`, `qemu.command`, ending with `action_state` and
  `image_url` on a completed screendump) from `actionSpan(parent, command, sessionId, agentId)` in
  the recorder's open and `endActionSpan(span, state, imageUrl?)` in its close, under the open
  intent or the session; a session ending fails its open action spans. No per-action fiber.
- The Sentry op is the `"sentry.op"` attribute. Status comes from the `Exit` (`statusExit`):
  success is `ok`; `Exit.fail("deadline_exceeded")` for `timed_out`, `Exit.fail("aborted")` for
  `aborted` and for a cancelled intent (Sentry maps `cancelled` to ok, hence `aborted`),
  `Exit.fail("internal_error")` for `failed` and for a failed action. `SentryEffectTracer` turns
  `String(error)` into the status message.
- No `http.server` or fetch spans: `HttpMiddleware.TracerDisabledWhen` is set and the integrations
  disable spans. Why: the session span must be a Sentry root.
- End every long-lived loop's tick in `Effect.catchCause((cause) => log.error(text, { cause }))`
  (the sweep) or `Effect.catchDefect` to the same (the cpu sampler); `log.error` is what reports.
  Flush in a root scope finalizer, `Effect.addFinalizer(() => Effect.asVoid(Effect.promise(() =>
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

The session span is `Effect.makeSpan("QEMU session", { root: true, annotations: exported,
attributes })` and ends with `span.attribute("session_status", status)` then
`span.end(yield* Clock.currentTimeNanos, statusExit(status))`.

## Concurrency and streams

- Every long-lived thing lives in a `Scope`: `Effect.acquireRelease` in layers,
  `Effect.addFinalizer` in scoped effects, `Effect.acquireUseRelease` for a local use,
  `Effect.forkScoped` for loops. A live session owns a `Scope.make()` closed with
  `Scope.close(scope, Exit.void)` by `stop`, the sweep or the drain; `Qemu.prepare` and
  `Qemu.start` run under `Scope.provide(live.scope)`, so closing it kills QEMU, closes the socket
  and removes the dir in that order. `Effect.forkIn(effect, scope)` ties a fiber to a named scope
  (the REPL's boot fiber, the follow view's spinner); `Sessions` forks nothing per action.
- Timeouts are always `Effect.timeoutOrElse({ duration, orElse })`; races are `Effect.raceFirst`.
- Bridge callback APIs with `Effect.callback((resume) => { ...; return Effect.sync(cleanup) })`
  (resume at most once, return the cleanup) and event sources with `Stream.callback((queue) => ...)`
  pushing with `Queue.offerUnsafe`, `Queue.endUnsafe` and `Queue.failCauseUnsafe`.
- Fan out with one `Queue` per subscriber when the slow-consumer policy is per subscriber. The
  three sanctioned policies are back-pressure (bounded), coalesce (`Queue.sliding(1)`) and
  drop-the-subscriber (`Queue.dropping(n)` and `Queue.endUnsafe` when `Queue.offerUnsafe` returns
  `false`). Followers use the third with `n = 64`.
- Retry only with `Schedule` (`Effect.retry({ schedule, while, times })`, `Schedule.exponential`
  capped with `Schedule.modifyDelay`, jittered, bounded with `Schedule.recurs`); never a `for` or
  `while` loop around `Effect.sleep`. Nothing retries today. Periodic work is `Effect.repeat` with
  `Schedule.spaced` forked into the owning scope (the sweep every `"10 seconds"`, the ISO claim
  wait every `POLL_MS` with `until`), `Effect.schedule(tick, Schedule.spaced("80 millis"))` for
  the follow view's spinner, or `Effect.forever(Effect.sleep(...).pipe(Effect.andThen(tick)))` for
  the cpu sampler; a tick never fails the loop (`catchCause`/`catchDefect` to `log.error`).
- The 10 s sweep is authoritative; wake-ups are only hints. Its tick is `Effect.uninterruptible`
  under `guard.withPermitsIfAvailable(1)` on a `Semaphore.make(1)`, so a stuck sweep is skipped by
  the next tick rather than overlapped, and the drain's `Fiber.interrupt(sweeper)` waits for a
  tick in flight.
- Interrupt-aware recovery: `Cause.hasInterruptsOnly(cause) ? Effect.interrupt : ...`; commits
  that must not be torn are `Effect.uninterruptible`. Errors are stream elements when a consumer
  loop must not die (the picker's `Event`).

The follower fan-out in `src/proxy/sessions.ts`: `follow` registers a
`Queue.dropping<Domain.FollowEvent, Cause.Done>(FOLLOW_BACKLOG)` in `live.followers` before
offering the first `session` line and returns `Stream.fromQueue(queue).pipe(Stream.ensuring(
detach(live, queue)))`; `emit(live, event)` offers to every queue with `Queue.offerUnsafe`, and a
`false` return removes that queue, ends it with `Queue.endUnsafe` and logs the drop.

## Runtime entry

- One runner call per process, in its entry: `NodeRuntime.runMain(program, {
  disableErrorReporting: true, teardown? })` in `client`, `ctrl`, `proxy` and `db/migrate.ts` (under
  `import.meta.main`), `Runtime.makeRunMain(...)` in `session/main.ts`, over `program.pipe(
  Effect.provide(MainLive), Effect.scoped, Effect.tapCause(Render.reportFailure))`. Every other
  module returns an Effect; the only other sanctioned runners are `Effect.runForkWith(context)` and
  `Effect.runPromiseExitWith(context)` re-entering Effect from a non-Effect callback after
  `const context = yield* Effect.context<R>()`; `test/repo/architecture.unit.test.ts` allows them
  in `src/db/client.ts` alone (`pool.on("error")`, drizzle's `transaction`), nowhere else.
- The CLIs run `Command.run(cmd, { version })` directly under `runMain`; only the proxy
  `Layer.launch`es, and its stop condition is `Effect.raceFirst(Layer.launch(serve(display,
  automation, port)), Deferred.await(serverFailed))` inside the command handler.
- `runMain` owns SIGINT and SIGTERM: the first signal interrupts the root fiber and scopes close in
  reverse order (sessions drained and closed `aborted` with `proxy shutdown`, the log flushed,
  Sentry flushed, the pool closed). Component layers never install signal handlers. The session
  REPL is the exception: `Runtime.makeRunMain` installs none, and the REPL answers `SIGINT`
  (readline), `SIGTERM` and `SIGHUP` (`Readline.signals`, the `Host.termination` Effect) itself.
  Its shutdown order is fixed: interrupt the completions fiber first (an open follow picker clears
  the lines under the prompt as it leaves, wiping anything printed before), close readline, kill
  the follow child and await its close, await a boot in flight, then print `stopping session <id>`
  and stop the session.
- Exit codes come from `Runtime.defaultTeardown` (`Runtime.errorExitCode` or 1 on failure) for the
  CLIs; the proxy passes a custom `teardown` mapping interruption to 0 unless the drain failed, and
  any other failure to 1. Never mutate `process.exitCode`; the session's runner owns `process.exit`.
- Startup order in the proxy handler: parse flags (`--automation` with `--display` is a
  `CliError.UserError` `--automation is exclusive`), `missingHostRequirements(display)`,
  `database.ping`, then listen. A startup failure is logged `fatal` as `proxy: <detail>` and exits
  1 after the flush; a server `error` after listen completes `serverFailed` with a
  `HttpServerError.ServeError`, sets the drain reason to `proxy error: <msg>`, and exits 1; a
  second error is ignored. Shutdown logs `proxy: shutting down; stopping N sessions`, then
  `stopped; aborted; proxy shutdown` per session.
- `Sessions.Shutdown` is a `Context.Reference` `{ reason: MutableRef<string>; failed:
  MutableRef<boolean> }` (`MutableRef`, because both ends sit outside Effect): `main.ts` holds
  `Sessions.Shutdown.defaultValue()`, provides it to the `Sessions` layer, sets `reason` from the
  Node `error` listener and reads `failed` in the teardown; the drain reads `reason` and sets
  `failed` when a settlement rejected. `MainLive` is built with `Layer.build` before the command
  runs, so a missing variable or a bad `DATABASE_URL`, the one failure no `Log` exists to record,
  prints `<NAME> is not set` and `Cause.pretty` on stderr through `Render.reportFailure`.

`src/proxy/main.ts` (an excerpt): the server is created here so its `error` event can end the
race; `ServerLive(display, automation, port)` is `Layer.effectDiscard(listenLine)` over
`HttpRouter.serve(Handlers.routes(display, automation), ...)`, `Sessions.layer`, `Shutdown`,
`Qemu`/`Iso`/`Stats`, `NodeHttpServer.layer(() => server, { host, port })` and `TracerDisabledWhen`.

```ts
const shutdown = Sessions.Shutdown.defaultValue();
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  if (Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })))) {
    MutableRef.set(shutdown.reason, `proxy error: ${cause.message}`);
  }
});
// ... ServerLive(display, automation, port), MainLive, proxyCommand

const program = Effect.gen(function* () {
  const services = yield* Layer.build(MainLive).pipe(Effect.tapCause(Render.reportFailure));
  yield* Command.run(proxyCommand, { version: Api.VERSION }).pipe(
    Effect.provide(services),
    Effect.tapDefect((defect) => Render.reportFailure(Cause.die(defect))),
  );
}).pipe(Effect.scoped);

const teardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    onExit(1);
    return;
  }
  onExit(MutableRef.get(shutdown.failed) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
```

## Key encoding

- The `oligarchy` encoding (`--encoding` default, parsed server-side in `src/qemu/keys.ts` by
  `parseKeys(keys, encoding = "oligarchy")`, returning a `Result` of chords): type letters as
  written, `A` sends shift+a; wrap special keys in angle brackets (`<ENTER>`, `<ESC>`, `<TAB>`,
  `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`,
  `<PGDN>`, `<F1>` to `<F24>`, any lowercase qcode token with an underscore); modifiers `<C-x>`
  control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta, combined as `<C-S-c>`; `<` and `>` as
  characters are `<LT>` and `<GT>`; a trailing `-` (`<->`, `<C-->`) is the minus key.
- The refusals, exact texts pinned by `test/qemu/keys.unit.test.ts` and returned as 400 by
  `/send-keys`: `qemu: unknown key encoding "<e>"`, `qemu: unterminated key sequence`,
  `qemu: empty key sequence`, `qemu: unknown modifier "<m>"`, `qemu: unknown key "<k>"`,
  `qemu: unsupported character "<c>"`.
- At most 1000 keys per request (`send-keys: at most 1000 keys per request`); chords are paced 60 ms
  apart so QEMU's keyboard queue does not overflow. Mouse coordinates are fractions of the last
  screenshot from the top-left: from a pixel `(px, py)` on a `W×H` image, `x = px / (W - 1)`.
- The tables and messages port `v1/src/qemu/keys.ts`; `client.md` "Encoding" must agree.

## Operating loop

Developers need the same model of a drive as the agents `prompts/linear-issue.html` briefs.

- Send keys or mouse, wait about three seconds, take an image, read it, decide. Never sleep more
  than ten seconds between actions; when something slow is running, keep taking images instead of
  trusting a long wait. Never type into a screen you have not seen: when the state is uncertain,
  the first action is an image, never a key.
- Rendering lags the keys: an empty prompt does not mean the keys were lost. Wait out a launch
  (image until the prompt exists), then type; if typed text has not appeared, image again before
  re-sending.
- Focus is mouse-shaped: move the pointer onto the window you mean to type into, then send keys.
  Window-manager chords land regardless of focus; plain text lands where the pointer says. A
  greeter or installer button is a left click at that point.
- A TTY (`<C-A-F3>`) is focus-proof and is how logs leave a crashed desktop: stop
  `serial-getty@ttyS0`, `journalctl -b --no-pager | sudo tee /dev/ttyS0`, then `get-serial`.
- Menus want arrows: batch `<Down>` in one `send-keys`, image to verify, then `<Enter>`.
- Every chord, mouse and image is an action row; the drive leaves a complete flight recorder. By
  hand, `./session [--server-url <url>]` keeps the ids and renders `get-image` inline.

## Tests

- Tests are written first. No code lands until a set of failing unit tests describes it, and every
  surface has both a happy and an unhappy test. Plan for failures and how they are handled.
- Vitest only, two lanes: `test/**/*.unit.test.ts` (no I/O beyond local fakes;
  `npm run test:unit`, part of `check:fast`) and `test/integration/*.integration.test.ts` (spawned
  executables, sockets, containers, processes; `npm run test:integration`). `passWithNoTests` is
  false. Anything that needs `qemu-system-x86_64` is integration and gated on the binary.
- Two `it`s: a pure test (`test/repo/*`, `qemu/keys`, `qmp/framing`, `session/grammar`, `shared/*`,
  the black-box CLI process tests) imports `describe`, `expect` and `it` from `vitest`; an Effect
  test imports `it` from `@effect/vitest` (`describe` and `expect` still from `vitest`) and uses
  `it.effect` or `it.live`, and `layer(L, { timeout })((it) => ...)` only for the migrated
  container. `expect` everywhere; `assert` only where `expect` cannot narrow.
- `it.effect` gives every body its own `Scope`, `TestClock` and `TestConsole`; drive timers with
  `TestClock.adjust`; assert output with `TestConsole.logLines`; `it.live` only for real clocks,
  sockets, processes (the integration lane) and the Sentry SDK (`observability/sentry`). Never a
  real `Effect.sleep` to let an interrupt land; `Fiber.await` the interrupted fiber or a `Deferred`.
  A fresh fake layer per `it.effect`, `NodeHttpServer.layerTest` included; the shared `layer(...)`
  only for the container.
- Fakes are `Layer.succeed(Tag)(Tag.of({...}))` factories that record their calls
  (`fakeLog().lines`, `fakeQemu().calls`, `fakeSessionStore().sessions`) with every unused member
  `Effect.die("Unexpected <Service>.<method>")`, kept under `test/support/`: `config.ts`
  (`withEnv`), `stores.ts`, `log.ts`, `reporter.ts`, `tracer.ts`, `stdio.ts`, the `fake-*.ts`
  files (`fake-qemu.ts` holds `fakeQemu`, `fakeIso` and `fakeStats`), the loopback `stub-proxy.ts`
  and `stub-cursor.ts` for the process tests, and `postgres.ts`. Never `vi.mock`, `vi.spyOn`, or
  a `fetch` stub.
- Assert failures with `Effect.flip` and `expect(error).toMatchObject({ _tag, message })`;
  `Effect.exit` only when a defect or interruption is under test (`Cause.hasDies`). A failure test
  whose input carries a secret (a token, a `DATABASE_URL` password: `config`, `db/client`, the proxy
  and dashboard process tests) also asserts that sentinel is absent from the rendered error.
- Test an `HttpApi` in-process with `HttpRouter.serve(Handlers.routes("none", false), {
  disableLogger: true, disableListenLog: true }).pipe(Layer.provide(fakes),
  Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(bearer(TOKEN)))` and
  `HttpApiClient.make(Api.ProxyApi)`, or a raw `HttpClient.HttpClient` for a refusal; assert
  `_tag`, `message` and the `{ "error": ... }` body.
- Test every command in-process with `Command.runWith(cmd, { version })(args)` under fake layers
  and `TestConsole`; assert `ShowHelp` with `errors.length === 0` for help and that no service was
  touched. Add a black-box process test per CLI that pins exit codes and the first stderr line;
  for the proxy: readiness through the client, SIGINT and SIGTERM, SIGKILL escalation, the pid gone
  and the port refusing, and serving on (refusals, `/stats`, exit 0 on SIGTERM) with stdout and
  stderr opened on `/dev/full`. Spawn helpers may be plain functions inside the test file.
- Postgres tests run against Testcontainers with the real migrations and the seed in
  `vitest.global-setup.ts` and read `inject("dbUrl")` (`Postgres.describeWithDatabase` skips when
  it is empty); they skip locally without Docker and fail in CI (`CI` or
  `OLIGARCHY_REQUIRE_DATABASE=1`). Unit tests never touch a database. No test connects to the
  production database, calls Linear or Cursor, boots QEMU, or migrates a remote database.
- Encode repository invariants oxlint cannot express as source-scanning tests in `test/repo/`: the
  boundary-file allow-list, the `node:*` exceptions and `Effect.run*` placement (each list checked
  to name files that exist), every `Flag.boolean` defaulted, HttpApi ownership, namespace imports
  with `.ts`, deep-path Effect imports, no `as` but `as const`, `@oligarchy/` identifiers, no
  `Data.TaggedError`, `class Error` or re-export, the script names (no `drizzle-kit push`), no
  `"warn"`, `erasableSyntaxOnly` and the language-service plugin.
- Tests are behaviour across a boundary; do not test static constants (`QEMU_BIN`, the OVMF paths),
  literal order, a table entry by entry, or config objects (the exact `check:fast` string). Delete
  obsolete tests with their feature, and never export a member for a test to read: assert the
  behaviour (`execute` after close fails `qemu: closed`; `sessions.stats` reports `qemus`). Test
  vendor behaviour (QMP frames, Linear responses, Cursor errors) with exact captured fixtures;
  label a synthetic fixture synthetic.

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

- The database schema lives in `v2/src/db/schema.ts`. Migrations under `v2/drizzle/` are generated
  from it with `npm run db:generate`, never written or edited by hand, and never applied with
  `drizzle-kit push`.
- Migrations are append-only. Never edit, delete, or rename anything under `v2/drizzle/`, not the
  `.sql` files, not the `meta/` snapshots. To change the schema, edit `v2/src/db/schema.ts` and
  generate a new migration. The one exception is `v2/drizzle/meta/_journal.json`, which the
  generator itself appends to.
- CI enforces both rules: an edited migration fails the build, and so does a schema that does not
  match the committed migrations (`.github/workflows/migrations.yml`, `append-only` and
  `schema-in-sync`, working directory `v2`, Node 26). A third job, `checks`, runs
  `npm run check:fast`.
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
5. HttpApi handlers consume decoded contracts, clients are generated from `ProxyApi` behind
   `filterStatusOk`, payloads are built with `.make`, and the wire body of every error is
   `{ "error": ... }`.
6. Every printed string, status code, log line, span name and exit code named in the contract
   sections of this document is unchanged.
7. Tests were written first, both paths are covered, fakes sit at the layer seam, and no test
   touches Linear, Cursor, QEMU or a remote database.
8. `npm run check:fast` and the affected integration tests are green.
