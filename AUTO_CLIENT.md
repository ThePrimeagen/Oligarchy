# The automation client

A plan, not code. The automation client is a server that runs one agent prompt to completion per
request and announces itself to the fleet the way a qemu server does: a `servers` row rewritten
every thirty seconds with what it knows of itself — host memory, host cpu over the last minutes,
and how many agents it is running — under `type = 'automation'` instead of `'qemu'`.

```
POST /run   Authorization: Bearer <OLIGARCHY_TOKEN>
            { "agent": "OLI-42", "key": "<model provider key>", "prompt": "<text>" }
            ... the call stays open for as long as the agent works: twenty minutes, an hour ...
200         { "model": "opencode/muse-spark-1.3-contributor-free", "session": "ses_…",
              "text": "<the agent's final answer>", "elapsedMs": 1234567 }
```

The agent is an `opencode run` child process with `muse-spark-1.3-contributor` selected, fed the
prompt on stdin, in a scratch directory of its own. What launches the agent sits behind one seam,
`AgentRunner`, so the OpenCode runner can be swapped for a Cursor SDK / cloud agent runner without
touching the server, the bookkeeping or the heartbeat.

Everything below follows `development.md`; where this document and that one disagree, that one
wins. Sections: [1 Tests](#1-tests-first) · [2 Assumptions](#2-assumptions-to-confirm) ·
[3 What exists](#3-what-this-builds-on) · [4 Architecture](#4-architecture) · [5 Wire](#5-the-wire) ·
[6 Runner](#6-the-runner-seam-and-the-opencode-runner) · [7 Runs](#7-the-runs-service) ·
[8 Stats and heartbeat](#8-stats-and-heartbeat) · [9 Dashboard](#9-dashboard) ·
[10 Config, CLI, entry](#10-config-cli-and-the-entry) · [11 Log](#11-log-lines) ·
[12 Long connections](#12-long-connections-what-bounds-them-and-what-does-not) ·
[13 DTS](#13-dts-of-the-new-modules) · [14 Delivery](#14-delivery-order) · [15 Spikes](#15-spikes) ·
[16 Decisions](#16-decisions-and-alternatives) · [17 Later](#17-out-of-scope-what-this-enables).

## 1. Tests first

No code lands until the tests below exist and fail. Every surface has a happy and an unhappy path.
Fakes sit at the layer seam (`AgentRunner`, `Stats`, `ServerStore`, `Log`, `ChildProcessSpawner`,
`FileSystem`), never at a module import. Each item is one test file, or one named case inside one,
and is its own todo.

### 1.1 Tests to alter

- [ ] `test/repo/architecture.unit.test.ts` — `BOUNDARY_FILES` names `src/host/stats.ts` instead of
      `src/qemu/stats.ts` (the sampler moves; it is the only `node:os` user). Nothing new is added to
      the list: the runner spawns through `ChildProcessSpawner` and writes through `FileSystem`.
- [ ] `test/qemu/stats.unit.test.ts` → `test/host/stats.unit.test.ts` — `collect` takes no count and
      answers `{ memory, cpu }`; the sampler cases (window, means, percentiles, a throwing reading
      logged and the loop going on, cpu hotplug ignored) move as they are.
- [ ] `test/proxy/heartbeat.unit.test.ts` → `test/host/heartbeat.unit.test.ts` — `announce(url, type,
      stats)`; every existing case passes `"qemu"` and a `{ qemus, … }` row. New happy case: an
      `"automation"` announce writes `{ agents, memory, cpu }` with `type: "automation"`. New unhappy
      case: the stats effect failing on the automation side is one `heartbeat failed:` line and the
      next tick writes.
- [ ] `test/proxy/sessions.unit.test.ts` — `sessions.stats` composes `qemus` from the map with the
      host sampler's answer: 0 before a start, 1 after, 0 after stop (the fake stats no longer
      takes the count).
- [ ] `test/proxy/http.unit.test.ts` — `GET /stats` still answers `{ qemus, memory, cpu }` exactly as
      today (the wire the reverse proxy probes is pinned; assert it did not move).
- [ ] `test/dashboard/servers.unit.test.ts` — the header reads `running`; a qemu row renders `2
      qemus`; a new automation row renders `1 agents`; silent, never-heard-from and escaping cases
      unchanged.
- [ ] `test/shared/errors.unit.test.ts` — `RunFailed` decodes from `{ error }` with status 502 and
      `RunTimedOut` with 504; `apiStatus` answers both; a decoded `RunFailed` carries no cause and an
      empty `agentId`, as `StartFailed` does.
- [ ] `test/shared/api.unit.test.ts` — `AutomationClientApi` has one group, `Runs`, with `POST /run`
      behind `BearerAuth` then `ApiBoundary`; `run` declares `RunBody`, `RunResponse` and exactly the
      two error codecs; `ProxyApi`, `ReverseProxyApi` and `AutomationApi` are unchanged (no `/run`).
- [ ] `test/integration/db.integration.test.ts` — against the migrated container: a heartbeat with
      `type = 'automation'` and `{ agents }` stats round-trips; `listServers("qemu")` does not list
      it; `removeServer` deletes it; the migration applies under the migrator (see S4).
- [ ] `test/integration/dashboard.integration.test.ts` — the fleet page renders an automation row
      beside a qemu row.

### 1.2 Tests to add

- [ ] `test/automation-client/events.unit.test.ts` (pure) — happy: a captured `text` line yields the
      session id and its text; a captured `error` line yields `error.data.message`, or `error.name`
      when there is no data; `step_start` resets the text so the final answer is the last step's
      (S2 may revise what "final answer" means; the test follows the captured lines). Unhappy: a
      non-JSON line and a JSON line with an unknown `type` are ignored and counted; a line without
      `sessionID` is ignored. Fixtures are captured lines (S2); a synthetic one is labelled
      synthetic.
- [ ] `test/automation-client/opencode.unit.test.ts` (FakeSpawner, fake FileSystem, `Path.layer`, fake
      Log, `ProxyConfig`) — happy: the argv is exactly `run --model <MODEL> --format json`; the
      child's cwd is a fresh directory holding executable `client`, `client-with-image` and `ctrl`
      shims that `exec` this repo's wrappers, and an `opencode.json`; the env carries
      `OPENCODE_API_KEY`, `OLIGARCHY_TOKEN` and `DATABASE_URL` and the argv carries none of them; the
      prompt arrives on stdin, byte for byte; exit 0 after captured events answers `{ session, text
      }`; the directory is gone once the scope closes. Unhappy: exit 1 with an `error` event is
      `RunFailed` `opencode: exited 1: <message>`; exit 1 without one carries the stderr tail; exit 0
      without a session is `RunFailed` `opencode: exited 0 without a session`; a spawn `ENOENT` is
      `RunFailed` `opencode: spawn opencode ENOENT` and the rendered error does not contain the key;
      a signal death nobody asked for is `RunFailed` with the platform's sentence; closing the scope
      mid-run records `SIGTERM` on the child and removes the directory; a stdout line that is not
      JSON is ignored.
- [ ] `test/automation-client/runs.unit.test.ts` (fake runner, fake stats, fake log, `TestClock`) —
      happy: `stats.agents` is 0, 1 while a run is held open, 0 after; two runs held open count 2;
      the response is `{ model, session, text, elapsedMs }` with `elapsedMs` from the clock; the
      lines are `run started; opencode; N chars` then `run finished; M chars in Tms`; the agent's
      colour is acquired then released. Unhappy: a `RunFailed` from the runner propagates
      unchanged, the count is back to 0, and `Runs` writes no error line (the boundary's is the
      one); the clock past
      `RUN_TIMEOUT` is `RunTimedOut` `opencode: no result within 2 hours` and the runner's scope was
      closed; interrupting the run fiber closes the scope and logs `run aborted; client disconnected
      after Tms` when the cause carries `ClientAbort`, `run aborted; interrupted after Tms`
      otherwise; a defect in the runner propagates as a defect, the count is 0 and the scope closed.
- [ ] `test/automation-client/http.unit.test.ts` (in-process `HttpRouter.serve` over fakes,
      `HttpApiClient.make(AutomationClientApi)` and a raw `HttpClient` for refusals) — happy: 200
      with `{ model, session, text, elapsedMs }`. Unhappy: a missing or wrong bearer is 401 `{
      "error": "unauthorized" }`, one error line attributed `automation-client`, `skipSentry`; an
      empty `prompt`, an empty `key` or a missing `agent` is 400 `{ error }`; a `RunFailed` is 502 `{
      error }` and one line attributed to the agent with the cause reported; a `RunTimedOut` is 504;
      `/linear`, `/stats`, `/start`, `/servers` and `GET /run` are 404 `{ "error": "not found" }` and
      never logged; a runner defect is 500 `{ "error": "internal error" }` logged with its cause.
- [ ] `test/automation-client/command.unit.test.ts` (mirrors `test/automation/command.unit.test.ts`) —
      `--help` lists `--port` and `--url` and touches nothing; `--port forty` is `ShowHelp`; `--url
      not-a-url` is refused by the flag with `url must be an http or https url`; the default is port
      42071 and `Option.none()` for the url; `--url http://127.0.0.1:1` reaches `serve` as given;
      startup order is host check, ping, listen. Unhappy: `opencode` off the PATH is fatal
      `automation-client: missing host requirements:\nopencode not on PATH`, no ping, no listen; an
      unreachable database is fatal `automation-client: database unreachable: <reason>`; a server
      error after listen and a bind failure are fatal with the error's own message.
- [ ] `test/integration/automation-client.integration.test.ts` (black-box: the wrapper spawned, a fake
      `opencode` shell script first on `PATH`, stdout and stderr captured) — refusals: `--help` exits
      0; `--port forty` exits 1; an empty `OLIGARCHY_TOKEN` exits 1 with `OLIGARCHY_TOKEN is not set`;
      an empty `DATABASE_URL` likewise; no `opencode` on `PATH` exits 1 with the fatal line; an
      unreachable database exits 1 and never listens. With a database: an occupied port is
      `EADDRINUSE`; it listens and logs the listening line; `POST /run` without a bearer is 401; with
      the bearer and a fake `opencode` that reads its stdin, sleeps three seconds, prints captured
      JSONL and exits 0, the call returns 200 after the sleep with the body, and in the meantime the
      `servers` row has `type = 'automation'` and `agents = 1`, then `agents = 0` and a higher
      generation; a fake that exits 1 is 502; `SIGTERM` mid-run leaves no child (the pid is gone),
      exits 0 and deletes the row; `SIGINT` idle exits 0 and the port refuses afterwards; stdout and
      stderr opened on `/dev/full` do not take the process down.
- [ ] `test/support/fake-runner.ts` — an `AgentRunner` whose outcomes are scripted per call, with a
      `Deferred` gate to hold a run open, recording every input (`agent`, `prompt`, the key's value)
      and whether its scope's finalizer ran.
- [ ] `test/support/fake-stats.ts` — a `Stats` answering fixed host stats (today's `fakeStats` in
      `fake-qemu.ts`, moved and freed of the count).

## 2. Assumptions to confirm

- A1 — `key` is the model provider key: the OpenCode Zen API key the child reads from
  `OPENCODE_API_KEY`. The alternative reading is that `key` is the Linear ticket (`OLI-42`). Under
  that reading, drop the `key` field, make `agent` the ticket, and have the process read
  `OPENCODE_API_KEY` from its own environment as one more required variable (reported after
  `DATABASE_URL`). Everything else in this plan stands. The body carries `agent` either way, because
  every line this system logs is attributed to an agent id.
- A2 — "oligarchy key" is `OLIGARCHY_TOKEN`, sent as `Authorization: Bearer` like every other route in
  this system, checked by the same `BearerAuth` middleware, and handed to the child as
  `OLIGARCHY_TOKEN` so `./client` works from inside the agent. It is not a body field: the generated
  client injects it once, the boundary logs a refused bearer, and it never appears in a body log.
- A3 — the "automation client" is a new process, `./automation-client`, not a route added to the
  existing `./automation` webhook service. Reasons in D1.
- A4 — the model id, as opencode spells it, is `opencode/muse-spark-1.3-contributor-free` (OpenCode
  Zen's contributor tier of Muse Spark 1.3; the paid tier is `opencode/muse-spark-1.3`). The exact
  string is pinned by S1 on the host before the constant lands.

## 3. What this builds on

Nothing here is new in kind; each piece has a precedent to copy from.

| This plan | Precedent | Where |
|---|---|---|
| A process with one listener, host check, ping, then listen | the proxy's command and main | `src/proxy/command.ts`, `src/proxy/main.ts` |
| A smaller process graph with no QEMU | the automation service | `src/automation/main.ts`, `src/automation/command.ts` |
| Bearer check and the boundary that logs one line per failed request | `bearerAuth`, `ApiBoundaryLive` | `src/proxy/middleware.ts` |
| A row rewritten every thirty seconds, deleted on shutdown | `Heartbeat.announce` | `src/proxy/heartbeat.ts` |
| Host memory and a five-minute cpu window | `Stats` | `src/qemu/stats.ts` |
| A long-lived child with a stderr tail, killed by scope close | `Process.spawn` | `src/qemu/process.ts` |
| Owning what is running as a map, the count as its size | `Sessions` | `src/proxy/sessions.ts` |
| A pure module that decodes a vendor's line-oriented output | `Qmp.framing`, `Domain.FollowEvent` | `src/qmp/framing.ts`, `src/shared/domain.ts` |
| A fleet page reading rows, never calling the process | the servers page | `src/dashboard/servers.tsx`, `src/dashboard/query.ts` |
| A `server_type` value and a row shape per kind | `servers.type` | `src/db/schema.ts`, `drizzle/0008_server_type.sql` |

The `automation_jobs` queue (`src/db/automation.ts`) is the eventual caller: a dispatcher claims a
job, renders the ticket's prompt (`Prompts.renderLinearIssue`), and `POST /run`s it here. The
dispatcher is not in this plan (§17); the heartbeat's `agents` count is what it will place on.

## 4. Architecture

### 4.1 Files

```
automation-client                       #!/bin/sh wrapper, --import src/observability/instrument.ts
src/automation-client/main.ts           the graph, createServer, teardown (boundary file by rule)
src/automation-client/command.ts        Command "automation-client" { --port, --url }; startup order
src/automation-client/handlers.ts       HttpApiBuilder.group(AutomationClientApi, "Runs") + routes
src/automation-client/runs.ts           Runs: the map of live runs, the count, the timeout, stats
src/automation-client/runner.ts         AgentRunner: the seam (a plain-value Context.Service)
src/automation-client/opencode.ts       the OpenCode implementation of AgentRunner
src/automation-client/events.ts         pure: `opencode run --format json` line probes and the fold
src/host/stats.ts                       moved from src/qemu/stats.ts; collect answers host stats
src/host/heartbeat.ts                   moved from src/proxy/heartbeat.ts; announce(url, type, stats)
src/shared/api.ts                       + run, Runs group, AutomationClientApi
src/shared/contract.ts                  + RunBody, RunResponse
src/shared/errors.ts                    + RunFailed (502), RunTimedOut (504), their Wire codecs
src/proxy/middleware.ts                 + the two tags in isApiError and attribution; comment fix
src/db/schema.ts                        server_type + 'automation'; ServerStats becomes a union
src/dashboard/servers.tsx               the running column renders qemus or agents
src/observability/log.ts                Locations.automationClient and its ProcessAttribution
drizzle/0010_<name>.sql                 generated: ALTER TYPE server_type ADD VALUE 'automation'
package.json                            "automation-client" script
automation-client.md                    operator document: flags, variables, the wire, the row
```

`src/host/` is new: what a server measures and says about the machine it runs on, shared by the
proxy and the automation client. It is a library directory like `src/qemu/` and `src/qmp/`, not a
process. `stats.ts` is the one `node:os` boundary file today and stays the one after the move,
under its new path.

### 4.2 The layer graph

```ts
// src/automation-client/main.ts
const ServerLive = (port: number, url: Option.Option<string>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.acquireColor(Log.AutomationClientAgentId);
      yield* log.info(
        `oligarchy automation client listening on ${HOST}:${String(port)}; model ${OpenCode.MODEL}${announcing(url)}`,
        automationClientAttr,
      );
      const runs = yield* Runs.Runs;
      const row = Effect.map(runs.stats, (stats) => ({
        agents: stats.agents,
        ...Heartbeat.hostRow(stats),
      }));
      yield* Option.match(url, {
        onNone: () => Effect.void,
        onSome: (announced) => Heartbeat.announce(announced, "automation", row),
      });
    }),
  ).pipe(
    Layer.provide(HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true })),
    Layer.provide(Runs.Runs.layer),
    Layer.provide(Layer.mergeAll(OpenCode.layer, Stats.Stats.layer)),
    // A run cannot finish inside a grace window, so the twenty-second preemptive wait buys
    // nothing: on shutdown the in-flight requests are interrupted at once (§4.4).
    Layer.provide(
      NodeHttpServer.layer(() => server, { host: HOST, port, disablePreemptiveShutdown: true }),
    ),
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry beneath Log so the rows flush before Sentry does and Log captures the reporter; the
// process attribution is this process's own bucket.
const MainLive = Layer.mergeAll(Servers.ServerStore.layer, Log.Log.layer).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(
    Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution),
  ),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeServices.layer),
);
```

One reference per service. `Runs` depends on `AgentRunner`, `Stats` and `Log`; `OpenCode.layer`
depends on `ChildProcessSpawner`, `FileSystem`, `Path` (all from `NodeServices`), `ProxyConfig` and
`Log`; the handlers depend on `Runs`, `BearerAuthLive` (`ProxyConfig`) and `ApiBoundaryLive` (`Log`,
`ProcessAttribution`). The heartbeat starts after the listener is up, in the listener's scope, as on
the proxy: a port refusal announces nothing, and the row is deleted when the listener goes.

`program` and `teardown` are the automation service's verbatim: the graph is built with
`Layer.build` before the command runs so a missing variable prints `<NAME> is not set` through
`Render.reportFailure`; SIGINT and SIGTERM interrupt and exit 0; any other failure exits 1.

### 4.3 The life of `POST /run`

1. `BearerAuth` compares the bearer with `OLIGARCHY_TOKEN`; a miss is 401, logged once by the
   boundary, `skipSentry`.
2. HttpApi decodes `RunBody`: `agent` non-empty, `key` non-empty (a `Redacted` from here on),
   `prompt` non-empty. A refusal is the boundary's 400.
3. The handler yields `Runs` and calls `runs.run(payload)`. The handler is interruptible (D5).
4. `Runs.run`: mints a run id, acquires the agent's colour, logs `run started; opencode; N chars`,
   makes a `Scope`, puts `{ id, agent, startedAt, scope }` in the map, and calls
   `runner.run({ agent, key, prompt })` under `Scope.provide(scope)` inside
   `Effect.timeoutOrElse({ duration: RUN_TIMEOUT, orElse: RunTimedOut })`.
5. `OpenCode.run` (§6): makes the scratch directory in that scope, writes the shims and
   `opencode.json`, spawns `opencode run --model <MODEL> --format json` with the prompt on stdin
   and the three variables in its environment, drains stdout into the fold and stderr into a tail,
   awaits the exit, and answers `{ session, text }` or `RunFailed`.
6. `Runs.run`'s `onExit` (uninterruptible bookkeeping, whichever way it ended): removes the run from
   the map, closes the scope — which kills a child still alive (SIGTERM, SIGKILL after five
   seconds, the directory removed last) — releases the colour, and logs the verdict: `run finished;
   M chars in Tms`, or `run aborted; …` on an interrupt. A failure writes no line of its own here:
   the boundary writes `POST /run failed: <message>` once.
7. The handler answers `RunResponse` (200), or the boundary answers 502 / 504 / 500 with `{ error }`.

### 4.4 Disconnects and shutdown

The platform interrupts a request's fiber when the client closes the response early
(`NodeHttpServer.makeHandler`, annotated `ClientAbort`), and interrupts every request fiber when
the listener's scope closes on shutdown. The handler for `run` is interruptible, so both reach
step 6 as an interrupt: the child is killed, the directory removed, the count decremented, and one
line written — `run aborted; client disconnected after Tms` when the cause's interrupt carries the
`ClientAbort` annotation (`reason.annotations.has(HttpServerError.ClientAbort.key)`), `run
aborted; interrupted after Tms` otherwise (shutdown). The caller of an aborted run sees its
connection close; it has nothing else to see.

Why interruptible, unlike the proxy's driving routes (D5): a run's only deliverable is its
response, so a caller that is gone has nothing to deliver to, and an uninterruptible twenty-minute
handler would hold shutdown for twenty minutes (`server.close` waits for in-flight requests, and
the fork scope's interrupt waits for the uninterruptible region). With `disablePreemptiveShutdown`
the listener does not wait its twenty seconds either: shutdown is stop accepting, interrupt the
runs, kill the children, flush the log, flush Sentry, close the pool — a handful of seconds.

## 5. The wire

### 5.1 `src/shared/api.ts`

```ts
// The automation client: one route, behind the same bearer and boundary as the proxy's.
export const run = HttpApiEndpoint.post("run", "/run", {
  payload: Contract.RunBody,
  success: Contract.RunResponse,
  error: [Errors.RunFailedWire, Errors.RunTimedOutWire],
});

export class Runs extends HttpApiGroup.make("Runs")
  .add(run)
  .middleware(BearerAuth)
  .middleware(ApiBoundary) {}

export class AutomationClientApi extends HttpApi.make("OligarchyAutomationClient").add(Runs) {}
```

The catch-all `NotFoundRoute` from `src/proxy/handlers.ts` is merged beside it, as the automation
service does, so `/linear`, `/stats` and `/start` are 404 here and never logged.

### 5.2 `src/shared/contract.ts`

```ts
// POST /run: who the agent is (the ticket, for attribution), the model provider key the child
// runs with, and the prompt. The key is Redacted from the decode on, so no log line or error
// message can carry it; the generated client encodes it back to the string the wire needs.
export class RunBody extends Schema.Class<RunBody>("@oligarchy/shared/contract/RunBody")({
  agent: Schema.NonEmptyString,
  key: Schema.RedactedFromValue(Schema.NonEmptyString),
  prompt: Schema.NonEmptyString,
}) {}

// What a finished run says: the model it ran as (the caller records it, as `ctrl test start
// --model` does), the runner's own id for the conversation (an opencode `ses_…`; a Cursor agent id
// later), the agent's final text (empty when it wrote none, never null), and how long it took.
export class RunResponse extends Schema.Class<RunResponse>(
  "@oligarchy/shared/contract/RunResponse",
)({
  model: Schema.String,
  session: Schema.String,
  text: Schema.String,
  elapsedMs: Schema.Int,
}) {}
```

`RedactedFromValue` is verified in `node_modules/effect/src/Schema.ts` (wire: the raw string;
type: `Redacted<string>`). `Schema.Redacted` is not it: that one expects a `Redacted` on both sides.

### 5.3 `src/shared/errors.ts`

```ts
// The agent did not finish: opencode could not be spawned, exited non-zero, exited without a
// session, or died from a signal nobody here sent. The message is `opencode: <what>`.
export class RunFailed extends Schema.TaggedError<RunFailed>("@oligarchy/shared/errors/RunFailed")(
  "RunFailed",
  { message: Schema.String, agentId: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
  { httpApiStatus: 502 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

// The agent was still going at RUN_TIMEOUT; it was killed.
export class RunTimedOut extends Schema.TaggedError<RunTimedOut>(
  "@oligarchy/shared/errors/RunTimedOut",
)("RunTimedOut", { message: Schema.String, agentId: Schema.String }, { httpApiStatus: 504 }) {
  override readonly [ErrorReporter.ignore] = true;
}

export const RunFailedWire = wireError(
  RunFailed,
  (message) => ({ _tag: "RunFailed", message, agentId: "" }) as const,
);
export const RunTimedOutWire = wireError(
  RunTimedOut,
  (message) => ({ _tag: "RunTimedOut", message, agentId: "" }) as const,
);
```

Both join `ApiError` and `apiErrorClasses` (the `satisfies Record<ApiError["_tag"], …>` refuses a
missing arm), the `isApiError` union in `src/proxy/middleware.ts`, and its `attribution` switch:
both carry `agentId`, neither a session, so `{ location: fallback.location, agentId }`. `report`
already sends a 5xx's cause to Sentry. The comment in `middleware.ts` saying "The automation
service does not use this bearer" gains "; the automation client does".

## 6. The runner seam and the OpenCode runner

### 6.1 `src/automation-client/runner.ts` — the seam

The one interface bought before its second implementation, because the request asks for it:
what launches an agent and waits for it must be swappable (OpenCode today; the Cursor SDK and cloud
agents next) without the server, the bookkeeping or the heartbeat noticing.

```ts
export type RunInput = {
  readonly agent: string;
  readonly key: Redacted.Redacted;
  readonly prompt: string;
};

export type RunOutcome = {
  readonly session: string;
  readonly text: string;
};

// A plain-value service: `name` is the word the log lines and the error messages use for this
// runner ("opencode"), `model` is what every run of it records; `run` resolves when the agent is
// done and fails RunFailed when it is not going to be. Whatever the runner starts lives in the
// caller's Scope, so closing it (a timeout, an interrupt) ends the agent; the runner itself has no
// timeout.
export type Shape = {
  readonly name: string;
  readonly model: string;
  /** @effect-expect-leaking Scope */
  readonly run: (input: RunInput) => Effect.Effect<RunOutcome, Errors.RunFailed, Scope.Scope>;
};

export class AgentRunner extends Context.Service<AgentRunner, Shape>()(
  "@oligarchy/automation-client/AgentRunner",
) {}
```

A runner is built with `Layer.succeed(AgentRunner)(AgentRunner.of({ name, model, run }))` or, when
it captures services, `Layer.effect(AgentRunner)(Effect.gen(...))`. Only `Runs` yields it. A test
substitutes `test/support/fake-runner.ts`.

### 6.2 `src/automation-client/opencode.ts` — the OpenCode runner

Facts about `opencode run`, from its source (`packages/opencode/src/cli/cmd/run.ts`) and docs, each
to be re-checked on the host in S1–S3:

- `opencode run [message..] --model provider/model --format json` is the non-interactive mode. With
  stdin not a TTY it reads all of stdin and appends it to the positional message, so the prompt goes
  on stdin alone and the argv carries no prompt.
- `--format json` writes one JSON object per line to stdout, each with `type`, `timestamp`,
  `sessionID`, and per type `part` (`text`, `step_start`, `step_finish`, `tool_use`) or `error`.
- It exits when the session goes idle: exit code 0, or 1 when a `session.error` event was seen or
  the prompt was refused. Permission requests are auto-rejected unless `--auto`; `question`,
  `plan_enter` and `plan_exit` are denied outright.
- The OpenCode Zen provider is `opencode`; its key is read from `OPENCODE_API_KEY`.

```ts
export const BIN = "opencode";
// Pinned by S1 against `opencode models` on the host: the contributor tier of Muse Spark 1.3.
export const MODEL = "opencode/muse-spark-1.3-contributor-free";
// The wrappers the prompt is allowed to run; the shims exec this repo's copies by absolute path.
const SHIMS = ["client", "client-with-image", "ctrl"] as const;
const STDERR_TAIL_BYTES = 4096;
// Releasing the scope waits for the exit; an opencode that ignores SIGTERM must not wedge a
// timeout or a shutdown behind it.
const FORCE_KILL_AFTER = "5 seconds";
```

`run(input)`, top to bottom:

1. `dir = yield* fs.makeTempDirectoryScoped({ prefix: "oligarchy-run-" })` — registered first, so the
   directory goes last, after the child is dead. Each run works in a directory of its own: two
   agents writing `screen.png` in one directory would overwrite each other, and the prompt forbids
   reading this repository, which an empty cwd enforces rather than asks.
2. For each of `SHIMS`, `fs.writeFileString(path.join(dir, name), `#!/bin/sh\nexec "${REPO}/${name}"
   "$@"\n`, { mode: 0o700 })` where `REPO = path.resolve(import.meta.dirname, "../..")` (as
   `src/session/children.ts` resolves the entries). A symlink would not do: the wrappers use
   `$(dirname "$0")`, which for a symlink is the link's directory.
3. `fs.writeFileString(path.join(dir, "opencode.json"), OPENCODE_JSON, { mode: 0o600 })` — the
   per-run config: the `permission` block that allows `bash` for `./client*`, `./client-with-image*`,
   `./ctrl*` and `sleep*` and denies every other bash pattern, denies `edit`, `write` and `webfetch`,
   allows `read` (the screenshots and serial dumps the client writes). S3 settles the exact keys; the
   intent is that a denied action is a rejected permission the model sees and moves past, never a
   hung prompt, and that `--auto` is never passed.
4. Spawn:

   ```ts
   ChildProcess.make(BIN, ["run", "--model", MODEL, "--format", "json"], {
     cwd: dir,
     // The three variables the agent's tools need, unwrapped here and nowhere else. Nothing
     // secret is on argv; the prompt is on stdin.
     env: {
       OPENCODE_API_KEY: Redacted.value(input.key),
       OLIGARCHY_TOKEN: Redacted.value(config.token),
       DATABASE_URL: Redacted.value(config.databaseUrl),
     },
     extendEnv: true,
     stdin: Stream.make(encoder.encode(input.prompt)),
     stdout: "pipe",
     stderr: "pipe",
     detached: false,
     killSignal: "SIGTERM",
     forceKillAfter: FORCE_KILL_AFTER,
   })
   ```

   `CommandInput` accepts a `Stream<Uint8Array>` (verified in
   `node_modules/effect/src/unstable/process/ChildProcess.ts`); the stream ending closes the pipe,
   which is what makes opencode's stdin read return. A spawn failure (`ENOENT`) is
   `RunFailed { message: "opencode: spawn opencode ENOENT" }` with the platform error as cause; the
   message comes through `ExternalFailure.describeThrowable(ExternalFailure.causeOf(error),
   Render.errorDetail(error))`, as `Process.detail` builds it.
5. Two `forkScoped` drains: stdout through `Stream.decodeText()` and `Stream.splitLines` into a
   `Ref<Events.State>` by `Events.fold`; stderr into a `Ref<string>` kept to its last
   `STDERR_TAIL_BYTES`, as `Process.spawn` keeps QEMU's. Exit is `handle.exitCode`, its
   `PlatformError` (a signal death) mapped to `null`; both drains are joined before the tail or the
   fold is read, so the failure carries everything the child wrote.
6. The verdict:
   - exit 0 and a session seen → `{ session, text }` (`text` may be `""`);
   - exit 0 and no session → `RunFailed("opencode: exited 0 without a session")`;
   - exit `n ≠ 0` → `RunFailed(`opencode: exited ${n}: ${error event message | stderr tail |
     "no output"}`)`;
   - signal death → `RunFailed("opencode: <the platform's sentence>")`. When the death is ours
     (timeout, interrupt) the caller is already past caring; this arm is for the OOM killer.

   Every `RunFailed` carries `agentId: input.agent`.

`OpenCode.layer: Layer.Layer<AgentRunner, never, ChildProcessSpawner | FileSystem | Path |
Config.ProxyConfig | Log.Log>` captures its dependencies once in the layer effect. No Sentry span
in this cut (§17).

### 6.3 `src/automation-client/events.ts` — the fold

Pure, no Effect: probes for the lines that matter and a fold over them. Unknown `type`s and
non-JSON lines are ignored and counted (the count lands in the `run finished` line only if S2 shows
it is worth having; otherwise it is dropped).

```ts
const Line = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    sessionID: Schema.String,
    part: Schema.Struct({ text: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal("step_start"), sessionID: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("error"),
    sessionID: Schema.String,
    error: Schema.Struct({
      name: Schema.String,
      data: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
    }),
  }),
  // Anything else on the stream: only its session id is kept.
  Schema.Struct({ type: Schema.String, sessionID: Schema.String }),
]).annotate({ identifier: "@oligarchy/automation-client/events/Line" });

export type State = {
  readonly session: Option.Option<string>;
  readonly text: string;            // the text parts since the last step_start, joined
  readonly error: Option.Option<string>;
  readonly ignored: number;
};

export const empty: State;
export const fold: (state: State, line: string) => State;   // Schema.decodeUnknownOption(fromJsonString(Line))
```

Whether a `text` event is a completed part or a delta, and whether the final answer is the last
part or the last step's parts joined, is what S2 captures; the fold is written to the captured
lines, and the test fixtures are those lines.

### 6.4 A Cursor runner, sketched

`src/automation-client/cursor.ts` would implement the same `Shape` over `@cursor/sdk` (the package
`ctrl` dropped in #102): `Agent.launch` with the prompt and a `ModelSelection`, then poll the agent
until it is finished, then read its last message as `text`; `session` is the agent id; `model` is
the selection's label as `modelLabel` spelled it. `key` becomes the Cursor API key. Nothing outside
`cursor.ts` and `main.ts` (which picks the layer) changes. Not in this plan.

## 7. The Runs service

`src/automation-client/runs.ts` owns what is running. The count is the size of the map, never a scan
of the system.

```ts
// Two hours: far above any run still doing work (a driven session times out after ten idle
// minutes on the proxy; a run is one session plus its review) and well short of forever, which is
// what a wedged agent otherwise costs the slot it holds.
const RUN_TIMEOUT = "2 hours";

type LiveRun = {
  readonly id: string;
  readonly agent: string;
  readonly startedAt: number;
  readonly scope: Scope.Closeable;
};

export type AutomationStats = {
  readonly agents: number;
  readonly memory: Contract.Memory;
  readonly cpu: Contract.Cpu;
};

export type RunsService = {
  readonly run: (
    body: Contract.RunBody,
  ) => Effect.Effect<Contract.RunResponse, Errors.RunFailed | Errors.RunTimedOut>;
  readonly stats: Effect.Effect<AutomationStats>;
};
```

`run` is `Effect.fn("Runs.run")`, in the order of §4.3 step 4 and 6. Points worth stating:

- The bookkeeping in `onExit` is uninterruptible by nature of `Effect.onExit`; it never fails: a
  `Scope.close` that fails is one `run cleanup failed: <detail>` error line with the cause.
- The timeout is `RunTimedOut.make({ message: `${runner.name}: no result within ${RUN_TIMEOUT}`,
  agentId })` — `opencode: no result within 2 hours`. The runner's `name`, not its model, is the
  word in that message and in the `run started; opencode; …` line: the model is what the caller
  records, the runner is what an operator reading the log is looking at.
- The aborted line's reason reads the interrupt's annotations for `ClientAbort.key`, as
  `HttpServerError` itself does when it chooses a client-abort response over a server-abort one.
- `stats` is `Effect.flatMap(Ref.get(runs), (map) => Effect.map(stats.collect, (host) => ({ agents:
  map.size, ...host })))`.
- No capacity refusal (D4). No per-agent uniqueness check either: two runs for one ticket are the
  caller's decision, not this process's.

## 8. Stats and heartbeat

### 8.1 `src/host/stats.ts`

`src/qemu/stats.ts` moves here unchanged but for its answer: `collect` takes no count and returns
`HostStats = { memory: Contract.Memory; cpu: Contract.Cpu }`. The proxy composes
`Contract.Stats.make({ qemus: map.size, ...host })` in `Sessions.stats`; the automation client
composes `{ agents: map.size, ...host }`. `Stats.make(source)` stays the seam a unit test drives
with a scripted `Source`; `Stats.layer` reads `osSource`. `SAMPLE_INTERVAL_MS`, `MAX_SAMPLES`, the
means and percentiles are as they are: "cpu over time" is the five-minute window's mean and
percentiles and its newest one, two and three minutes, which the row keeps as `mean1m`, `mean2m`,
`mean3m`.

### 8.2 `src/host/heartbeat.ts`

`src/proxy/heartbeat.ts` moves here and takes what it used to fetch:

```ts
export const announce = (
  url: string,
  type: Servers.ServerType,
  stats: Effect.Effect<DbSchema.ServerStats>,
): Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log>;

// The row's half of the host stats: what the fleet page shows.
export const hostRow = (host: Stats.HostStats): DbSchema.HostRowStats;
```

The tick, the thirty seconds, the `heartbeat failed:` and `unannounce failed:` lines, the
uninterruptible write and the delete-on-close are unchanged. The proxy calls
`Heartbeat.announce(url, "qemu", Effect.map(sessions.stats, (s) => ({ qemus: s.qemus,
...Heartbeat.hostRow(s) })))`; the automation client calls it with `"automation"` and
`Effect.map(runs.stats, (s) => ({ agents: s.agents, ...Heartbeat.hostRow(s) }))`. Two callers is
what earns the generalisation (D7).

### 8.3 `src/db/schema.ts` and the migration

```ts
// What kind of machine a server boots, and so which reverse proxy fronts it or which dispatcher
// places on it. qemu servers boot machines; automation servers run agents.
export const serverType = pgEnum("server_type", ["qemu", "automation"]);

export type HostRowStats = {
  readonly memory: { readonly totalBytes: number; readonly usedBytes: number };
  readonly cpu: { readonly mean1m: number; readonly mean2m: number; readonly mean3m: number };
};
// The count a server's kind reports: machines running, or agents running. The key is the kind's
// word, so a row reads as its server would say it.
export type QemuServerStats = HostRowStats & { readonly qemus: number };
export type AutomationServerStats = HostRowStats & { readonly agents: number };
export type ServerStats = QemuServerStats | AutomationServerStats;
```

`npm run db:generate` writes `drizzle/0010_<name>.sql` with `ALTER TYPE "public"."server_type" ADD
VALUE 'automation';` and appends to `_journal.json`; nothing under `drizzle/` is edited by hand. The
`ServerStore` signature `heartbeat(url, type, stats: ServerStats)` is unchanged in shape; the
caller's word on the pairing is trusted. `listServers("qemu")` in the reverse proxy is unaffected:
automation rows are another type.

## 9. Dashboard

`src/dashboard/servers.tsx`: the `qemus` header becomes `running`, and the cell reads
`{n} qemus` or `{n} agents`, discriminated on the stats key (`"qemus" in server.stats`), which is
the row's own word. Nothing else on the page changes: silent, never heard from, generation, age,
delete. The add box still adds a qemu server; an automation server announces itself. `query.ts`
needs no change: `Server["stats"]` widens with the schema type.

## 10. Config, CLI and the entry

- Variables: `OLIGARCHY_TOKEN` and `DATABASE_URL`, in that order — exactly `ProxyConfig`, which the
  reverse proxy already reuses; the automation client reuses it too (D8). No `LINEAR_*` variable.
  Under A1's alternative reading, `OPENCODE_API_KEY` is a third required variable.
- Wrapper: `./automation-client`, `#!/bin/sh exec node --experimental-strip-types --import
  "$(dirname "$0")/src/observability/instrument.ts" "$(dirname "$0")/src/automation-client/main.ts"
  "$@"`. Script: `"automation-client": "node --experimental-strip-types --import
  ./src/observability/instrument.ts src/automation-client/main.ts"`.
- Command `automation-client`:
  - `--port <n>` — `Flag.integer`, default `42071` (42069 proxy, 42070 reverse proxy, 54321
    automation; exact, never probed).
  - `--url <url>` — `Flag.string` with `Flag.withSchema(Domain.ServerUrl)`, optional, the proxy's
    wording: the address the fleet reaches this process at, which it cannot see itself; without it
    the process announces nothing and a development instance stays off the dashboard.
  - Handler order: `missingHostRequirements` — `opencode` on the PATH through
    `Process.commandExists`, refusing `HostRequirementsMissing { missing: ["opencode not on PATH"] }`
    — then `database.ping` (`database unreachable: <reason>`), then `Effect.raceFirst(Layer.launch(
    serve(port, url)), Deferred.await(serverFailed))`. Every failure is one `fatal` line
    `automation-client: <detail>` and exit 1 after the flush.
  - Description: "The oligarchy automation client: POST /run drives one agent prompt to completion
    on this host and announces itself to the fleet as an automation server".
- `main.ts` creates the server as `createServer({ keepAlive: true, keepAliveInitialDelay: 30_000
  })` (S5): TCP keepalive on accepted sockets, so a caller idle for twenty minutes behind a NAT or a
  tunnel that forgets the connection is found out by the probes rather than by the final write. The
  `error` listener completes `serverFailed` once, as on the other two servers; stdout and stderr get
  their no-op `error` listeners.

## 11. Log lines

Attribution: `location = "automation-client"` for every line of this process; `agentId` is the
body's `agent` for lines about a run and `"automation-client"` for process-wide lines. New in
`src/observability/log.ts`: `Locations.automationClient`, `AutomationClientAgentId`,
`AutomationClientProcessAttribution`; the `logs.location` comment names the new bucket.

| Level | Line | When |
|---|---|---|
| info | `oligarchy automation client listening on 127.0.0.1:42071; model opencode/…[; announcing <url>]` | after listen |
| info | `run started; opencode; 12345 chars` | a run begins |
| info | `run finished; 812 chars in 734211ms` | exit 0 |
| info | `run aborted; client disconnected after 120034ms` | the caller went away |
| info | `run aborted; interrupted after 120034ms` | shutdown |
| error | `run cleanup failed: <detail>` | `Scope.close` failed (cause reported) |
| error | `POST /run failed: opencode: exited 1: <reason>` | the boundary, 502 (cause reported) |
| error | `POST /run failed: opencode: no result within 2 hours` | the boundary, 504 |
| error | `POST /run failed: unauthorized` | the boundary, 401, `skipSentry` |
| error | `heartbeat failed: <reason>` / `unannounce failed: <reason>` | as on the proxy |
| fatal | `automation-client: missing host requirements:\nopencode not on PATH` | startup |
| fatal | `automation-client: database unreachable: <reason>` | startup |
| fatal | `automation-client: listen EADDRINUSE: …` / `automation-client: <accept error>` | listen / after |

The stdout copy carries the agent's colour between `run started` and the verdict. Sentry receives
what `log.error` and `log.fatal` report; no span in this cut.

## 12. Long connections: what bounds them and what does not

A `POST /run` is one request whose response comes twenty minutes or more later. Each hop must be
accounted for; this is what bounds a response and what does not.

- Node's `http.Server`: `requestTimeout` (300 s) and `headersTimeout` (60 s) bound receiving the
  request, which is over in milliseconds; `server.timeout` is 0. Nothing in the server cuts a
  twenty-minute response. `keepAliveTimeout` (5 s) is between requests on an idle socket, not during
  one.
- Effect's `NodeHttpServer`: no request deadline; the handler runs until it answers or is
  interrupted (§4.4).
- The caller: `NodeHttpClient.layerNodeHttp`, the transport every process here provides at its root,
  has no undici header or body timeout — the reason `development.md` already gives for choosing it.
  A dispatcher derived with `HttpApiClient.make(AutomationClientApi)` over it waits as long as it
  takes. It carries no `Effect.timeoutOrElse` of its own on `run`: the deadline is the server's
  `RUN_TIMEOUT`, so both ends agree on who gives up.
- The path between: a plain socket, an SSH forward or a WireGuard peer carry a two-hour response. A
  Cloudflare-proxied hostname does not (a 100-second origin response limit, 524), and that is how
  the proxies are reached today ("a tunnel's local port"). The dispatcher must reach an automation
  client over a path without that limit, and `--url` is that address. If the path cannot be chosen,
  the alternative is a streamed response (D6).
- TCP keepalive (§10) keeps middleboxes from forgetting an idle connection and detects a dead peer
  in minutes rather than at the final write.

The integration test proves the shape with a three-second fake, and documents the boundaries
above rather than waiting five minutes for them; a soak against the 300-second mark can be run by
hand with the fake's sleep raised.

## 13. DTS of the new modules

Bare declarations, no imports; a type from a dependency is opaque and says what it is.

```ts
// src/automation-client/runner.ts
type Redacted = unknown;       // effect Redacted.Redacted<string>
type Scope = unknown;          // effect Scope.Scope
type Effect<A, E, R> = unknown; // effect Effect.Effect
type RunFailed = unknown;      // Errors.RunFailed

export type RunInput = { readonly agent: string; readonly key: Redacted; readonly prompt: string };
export type RunOutcome = { readonly session: string; readonly text: string };
export type Shape = {
  readonly name: string;
  readonly model: string;
  readonly run: (input: RunInput) => Effect<RunOutcome, RunFailed, Scope>;
};
export declare class AgentRunner /* Context.Service<AgentRunner, Shape> */ {}

// src/automation-client/opencode.ts
export declare const BIN: "opencode";
export declare const MODEL: string;
export declare const layer: unknown; // Layer<AgentRunner, never, ChildProcessSpawner | FileSystem | Path | ProxyConfig | Log>

// src/automation-client/events.ts
type Option<A> = unknown;      // effect Option.Option
export type State = {
  readonly session: Option<string>;
  readonly text: string;
  readonly error: Option<string>;
  readonly ignored: number;
};
export declare const empty: State;
export declare const fold: (state: State, line: string) => State;

// src/automation-client/runs.ts
type RunBody = unknown;        // Contract.RunBody
type RunResponse = unknown;    // Contract.RunResponse
type Memory = unknown;         // Contract.Memory
type Cpu = unknown;            // Contract.Cpu
type RunTimedOut = unknown;    // Errors.RunTimedOut
export type AutomationStats = { readonly agents: number; readonly memory: Memory; readonly cpu: Cpu };
export type RunsService = {
  readonly run: (body: RunBody) => Effect<RunResponse, RunFailed | RunTimedOut, never>;
  readonly stats: Effect<AutomationStats, never, never>;
};
export declare class Runs /* Context.Service<Runs>()("@oligarchy/automation-client/Runs", { make }) */ {
  static readonly layer: unknown; // Layer<Runs, never, AgentRunner | Stats | Log>
}

// src/automation-client/command.ts
type Layer<A, E, R> = unknown; // effect Layer.Layer
type Deferred<A, E> = unknown; // effect Deferred.Deferred
type ServeError = unknown;     // HttpServerError.ServeError
type Command = unknown;        // effect/unstable/cli Command
export type AutomationClientServer<RHost, RServe> = {
  readonly missingHostRequirements: Effect<ReadonlyArray<string>, never, RHost>;
  readonly serve: (port: number, url: Option<string>) => Layer<never, ServeError, RServe>;
  readonly serverFailed: Deferred<never, ServeError>;
};
export declare const makeAutomationClientCommand: <RHost, RServe>(
  server: AutomationClientServer<RHost, RServe>,
) => Command;

// src/host/stats.ts
export declare const SAMPLE_INTERVAL_MS: 5000;
export declare const MAX_SAMPLES: 60;
export type CpuTimes = { readonly cores: number; readonly idleMs: number; readonly totalMs: number };
export type Memory = { readonly totalBytes: number; readonly freeBytes: number };
export type Source = {
  readonly cpuTimes: () => CpuTimes;
  readonly cores: () => number;
  readonly memory: () => Memory;
};
export declare const osSource: Source;
export type HostStats = { readonly memory: Memory /* Contract.Memory */; readonly cpu: Cpu /* Contract.Cpu */ };
export type StatsService = { readonly collect: Effect<HostStats, never, never> };
export declare class Stats /* Context.Service<Stats>()("@oligarchy/host/Stats", { make }) */ {
  static readonly layer: unknown; // Layer<Stats, never, Log>
}

// src/host/heartbeat.ts
type ServerType = "qemu" | "automation";
type ServerStats = unknown;    // DbSchema.ServerStats
type HostRowStats = unknown;   // DbSchema.HostRowStats
export declare const announce: (
  url: string,
  type: ServerType,
  stats: Effect<ServerStats, never, never>,
) => Effect<void, never, Scope /* | ServerStore | Log */>;
export declare const hostRow: (host: HostStats) => HostRowStats;
```

Identifiers: `@oligarchy/automation-client/AgentRunner`, `@oligarchy/automation-client/Runs`,
`@oligarchy/automation-client/events/Line`, `@oligarchy/host/Stats`,
`@oligarchy/shared/contract/RunBody`, `@oligarchy/shared/contract/RunResponse`,
`@oligarchy/shared/errors/RunFailed`, `@oligarchy/shared/errors/RunTimedOut`.

## 14. Delivery order

Each slice is a pull request: its tests first and failing, then the code, then `npm run check:fast`
and the integration lane it touches, then the Sol review of `development.md` §Review. A slice never
breaks the proxy or the reverse proxy.

1. **`src/host/`** — move `stats.ts` and `heartbeat.ts`, generalise `collect` and `announce`, adapt
   `Sessions.stats` and `src/proxy/main.ts`, move the tests and `fakeStats`, update
   `BOUNDARY_FILES`. Lane: `proxy.integration.test.ts`.
2. **Schema and dashboard** — `server_type` gains `automation`, `ServerStats` becomes the union, the
   generated `0010` migration, the `running` column. Lanes: `db.integration.test.ts`,
   `dashboard.integration.test.ts`. CI's `schema-in-sync` job confirms the migration matches.
3. **The wire** — `RunBody`, `RunResponse`, `RunFailed`, `RunTimedOut`, their codecs, `run`, `Runs`,
   `AutomationClientApi`; the middleware's two new arms. Unit lane only.
4. **The runner** — `events.ts`, `runner.ts`, `opencode.ts`, `fake-runner.ts`; the captured fixtures
   from S2 checked in as test constants. Unit lane only; S1–S3 done before this slice starts.
5. **The process** — `runs.ts`, `handlers.ts`, `command.ts`, `main.ts`, the wrapper and script, the
   log locations; `automation-client.md`; the `development.md` Layout and Log paragraphs name the
   new process. Lane: `automation-client.integration.test.ts`.

## 15. Spikes

Facts to establish on the target host before slice 4; each is a short session at a shell, its
findings written into the constants and fixtures, not into this document.

- S1 — `opencode --version`; `opencode models | grep -i muse` → pin `MODEL`. With `HOME` set to an
  empty directory (no `auth.json`), `echo "say ok" | OPENCODE_API_KEY=… opencode run --model <MODEL>
  --format json` answers: the key is honoured from the environment and nothing else is needed.
- S2 — Capture full stdout of a real run (a `text`, a `step_start`, a `step_finish`, a `tool_use`)
  and of a failing one (a bad key → an `error` line and exit 1). Confirm `text` is a completed part
  and how the final answer is spelled across steps. These lines are the fixtures.
- S3 — Permissions: with no `--auto`, which tools does `opencode run` permit by default, and does a
  denied `bash` call surface to the model as a rejection or hang? Write the per-run `opencode.json`
  `permission` block that allows exactly `./client*`, `./client-with-image*`, `./ctrl*`, `sleep*`
  and `read`, and prove a `curl` and an `edit` are refused. Confirm `read` on a PNG works for the
  model.
- S4 — The Postgres the container and production run: `ALTER TYPE … ADD VALUE` under drizzle's
  migrator transaction applies (PG 12+ allows it inside a transaction; the value is usable after
  commit, which is before any heartbeat).
- S5 — Node 26: `http.createServer({ keepAlive: true, keepAliveInitialDelay: 30_000 })` is accepted;
  `NodeHttpServer.layer(…, { disablePreemptiveShutdown: true })` reaches `make` (it does in rc.112's
  source: `layerServer(evaluate, options)`); a `curl` killed mid-run interrupts the handler and the
  child dies within `FORCE_KILL_AFTER`.
- S6 — Two `opencode run`s at once under one `HOME` share the data directory without contention.

## 16. Decisions and alternatives

- D1 — **A separate process.** The webhook receiver (`./automation`, 127.0.0.1:54321, Linear's
  signature, one instance) and the run host (many machines, the oligarchy bearer, `opencode` on the
  PATH, a fleet row each) differ in cardinality, authentication and host requirements. Folding
  `/run` into `./automation` would put a bearer on a service that deliberately has none and a fleet
  row on a process there is one of. Alternative: one process, `/linear` unauthenticated and `/run`
  behind the bearer; rejected for the reasons above.
- D2 — **`key` is the provider key** (A1). Alternative and its consequences in A1.
- D3 — **`RUN_TIMEOUT = "2 hours"`**, with the reason in its comment. Alternative: no ceiling; a
  wedged agent then holds its slot and its `agents` count forever, which the dispatcher would read
  as capacity in use.
- D4 — **No capacity cap.** The dispatcher places on the automation client with the fewest `agents`
  in its row, as the reverse proxy places on the fewest `qemus`; the process refuses nothing on
  count. Alternative: a `MAX_AGENTS` constant and a 503 `Busy`; deferred until a flood is a real
  event, and then it is one constant, one error class and one test.
- D5 — **A disconnect aborts the run** (interruptible handler). Alternative: `uninterruptible`, as
  the proxy's driving routes are, so a dropped connection lets the agent finish its ticket work.
  Rejected because the response is the run's only deliverable and because it makes shutdown wait
  for the longest run (§4.4). If the dispatcher's retries turn out to double-run tickets, the fix is
  in the dispatcher's job row, not here.
- D6 — **One JSON answer at the end**, as asked. Alternative: `HttpApiSchema.StreamUint8Array` of
  NDJSON, echoing the runner's events with a final verdict line, which survives a 100-second
  intermediary and lets a caller watch. Held in reserve for when the path cannot be chosen (§12).
- D7 — **Generalise `stats` and `heartbeat` into `src/host/`** rather than copy them into the new
  process. Two callers is the point at which the abstraction is paid for; the copy would be forty
  lines that drift.
- D8 — **Reuse `ProxyConfig`** (`OLIGARCHY_TOKEN`, `DATABASE_URL`) as the reverse proxy does, so
  `BearerAuthLive` works unchanged. A rename to `ServerConfig` is a cleanup for another change.
- D9 — **`key` is `Schema.RedactedFromValue`** in the contract, so the decoded body cannot leak it
  into a log or an error message; `Redacted.value` is called once, at the spawn.
- D10 — **A scratch directory with shims per run**, not the repository root. Concurrent agents would
  otherwise share `screen.png`, and the prompt's "do not read this repository" would be a request
  instead of a fact. The shims are two lines each because the wrappers resolve `$(dirname "$0")`.
- D11 — **`agents` and `qemus` as separate row keys**, not one `running` key. A row reads as its
  server would say it, and existing rows and tests keep their `qemus`.

## 17. Out of scope; what this enables

- **The dispatcher.** A loop in `./automation` that claims the oldest pending `automation_jobs` row,
  renders its prompt from the result's ticket (`Prompts.renderLinearIssue` has every field), picks
  the automation client with the freshest heartbeat and fewest `agents` among `servers` rows of
  type `automation`, `POST /run`s it through `HttpApiClient.make(AutomationClientApi)` over
  `NodeHttpClient.layerNodeHttp` with the bearer injected once, and closes the job `succeeded`,
  `failed` (502) or `timed_out` (504) from the answer. That is why the row carries `agents`.
- **Linear inside the agent.** The ticket prompt asks the agent to move the ticket through Linear
  MCP; the per-run `opencode.json` is where an `mcp` block with `LINEAR_API_TOKEN` goes.
- **A Cursor runner** (§6.4).
- **A Sentry root span per run** (`automation.run`, named by the agent id, ended with the exit), as
  the proxy's `qemu.session`.
- **A streamed `/run`** (D6).
- **Tokens and cost** from `step_finish` in the `run finished` line, once S2 shows them.
