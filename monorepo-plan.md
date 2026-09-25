# Monorepo plan

Status: phase 0 is done ([PR #232](https://github.com/ThePrimeagen/Oligarchy/pull/232): the Bun
workspace and `@oligarchy/routes`). Nothing else in this file is implemented yet. It is the plan
for the rest of the split and the reasoning behind each choice.

Revised 2026-09-25 after review. What changed from the first version, and why:

- **`stats` is gone; `fleet` replaces it.** The announce loop and the stale-server sweep were
  headed into `http`, where they import no HTTP at all (both heartbeats and `stale-servers.ts` are
  stores, stats and the log). They sit with the host and process stats they feed, as one package:
  how a server measures itself, announces itself, and how the fleet forgets a dead member.
- **The two heartbeats become one template**, `Member`, with the hooks the code actually needs.
- **`Log` moves down** to a level-1 package, `log`, with the stdout layer, failure text, log-line
  text and the palette. The row-writing layer stays in `observability`. Nothing below
  `observability` is forbidden from logging any more; "return values, log where the decision is
  made" is the default style, not a graph constraint. The stats `failures` stream goes.
- **`shared` stays small** and takes only what is domain vocabulary: ids, vocabularies, errors,
  and `steps.ts`.
- **`linear` moves up** a layer and takes `openRun`, the workflow that turns test definitions into
  a run and its tickets. `ctrl` and the dashboard call the same function.
- **The dashboard is the fifth app.** It stops importing `ctrl` and `viz`.
- **`integration-testing` holds system tests only** (the Postgres container, spawned processes)
  and is created last. A test that needs only the real OS lives in its owner's own lane.
- **A cycle watch** lists every pair of packages that could plausibly cycle and the rule that
  prevents each, so the architecture test has something to check against.

Then two independent reviews of that revision (2026-09-25), which changed:

- **`env` lost the shared flags.** Only `--name` and `port(default)` were actually identical;
  `--url` and `--max-jobs` differ in help text, `--port` in default. Flags are command
  definitions and stay in the apps. `env`'s rule is rewritten to be true of what it holds.
- **`external-failure.ts` goes to `log`, not `shared`.** `causeOf` is failure mechanics, not
  vocabulary.
- **`automation-server/client.ts` stays in its app.** It has one consumer, declares
  `OligarchyToken` under an app service key and raises `AutomationClientError`, which the error
  table homes in the app. Moving the client to `http` would have made `http` import an app.
- **The `log`/`observability` seam is specified**, not asserted: `log` declares `LogRow`; the sink
  is a factory that receives `write` and `report` (today's `makeLog` shape), because a prebuilt
  sink cannot report its own failures through the `Log` being constructed; the `Row` alias derived
  from `LogStore.insertLog` stays with `makeSink` in observability.
- **`Member` gets one requirement type per hook.** A single `R` does not infer across `report`
  and `onJoin` when they need different services.
- **`serve` keeps qemu-server's first-error hook** (`shutdown.reason`).
- **`Env.run` covers nine entries, not ten.** `session` deliberately does not use
  `NodeRuntime.runMain`; its REPL answers SIGTERM and SIGHUP itself.
- **`db/migrate.ts` runs through `Env.run`**, so `db` declares no platform dependency.
- **`--workspaces` fan-out uses `--if-present`** and the root lane runs separately; Bun errors on
  a workspace without the script and skips the root.
- **False claims fixed**: file counts, "identical" heartbeats, where the ten-minute threshold
  lives, what the ten `main.ts` files repeat.
- **Ceremony removed**: the separate package-cycle test (the layer edge check already names any
  cycle), per-package import allow-lists that duplicate the isolated linker and the edge check,
  resolved and restated open decisions.
- **`openRun` is specified**: lifted out of `makeCtrlCommand`'s closure with its helpers, returns
  the value instead of printing, and the dashboard still builds its own runtime around it.
- **`@oligarchy/routes` has a slot** in the layer list between phase 2 and its phase 9 rename.
- **The row, then the line.** Today `emit` writes stdout first and queues the row after. The
  sink now owns both destinations in order: insert the row, then write the line. A refused row
  still writes the line, then `db: log insert failed: <detail>`, then reports the failure to
  Sentry. So the sink is offered the line with its row, and the stdout layer's sink writes at
  once.

How to work a phase:

1. Re-check every test the phase touches and decide which change, which move and which are new.
2. Write the tests first. Each test is its own todo, with a happy and an unhappy path.
3. Run them and confirm they fail.
4. Only then change code.
5. Finish with `bun run check:fast` green, the integration lane run, and `development.md` updated
   for whatever the phase moved.

## Target in one picture

```
top     integration-testing (system tests, dev only)   scripts: ctrl, dig, driver, session, viz, client (root package)
6       automation-server  automation-client  qemu-reverse-proxy  qemu-server  dashboard
5       http            contract, API errors, middleware, serve, proxy client
5       fleet           host and process stats, member announce loop, stale-server sweep
4       observability   Sentry, instrument, dsn, the row-writing Log layer
4       linear          Linear API client, ticket templates, openRun
3       db              Postgres client, stores, schema, migrations
2       env             variables, env files, the settings file, --env-file, entry runner, colour detection
1       log             the Log service and stdout layer, failure mechanics and text, log-line text, palette
0       shared          domain ids, vocabularies, domain errors, steps
```

A package depends only on packages in a lower layer. Two packages on the same layer never depend
on each other. Nothing depends on an app, with one dev-only exception (open decision 4). The
scripts (`client`, `ctrl`, `dig`, `driver`, `session`, `viz`) stay in the root package as one-off
consumers on top. `client` will be removed later, outside this plan.

Declared dependencies, which is what the architecture test reads:

| Package | `dependencies` |
|---|---|
| `shared` | `effect` |
| `log` | `effect`, `shared` |
| `env` | `effect`, `@effect/platform-node`, `log`, `shared` |
| `db` | `effect`, `drizzle-orm`, `pg`, `env`, `log`, `shared` |
| `linear` | `effect`, `db`, `env`, `log`, `shared` |
| `observability` | `effect`, `@sentry/bun`, `@sentry/effect`, `db`, `log`, `shared` |
| `fleet` | `effect`, `db`, `log`, `shared` (dev: `@effect/platform-node` for its integration lane) |
| `http` | `effect`, `@effect/platform-node`, `env`, `log`, `shared` |
| `routes` (phases 2 to 8, then renamed to `http`) | `effect`, `shared`; it sits in `http`'s slot of the layer list |
| an app | any package; never another app, never the root's `src/` |
| `integration-testing` | any package; the dashboard's Worker entry (open decision 4); dev only |

## Principles

- **One-way dependencies, never two-way.** A lint rule catches file cycles and a repo test
  catches layer violations (see "Enforcing one-way dependencies"). A package cycle is an upward or
  same-layer edge, so the layer check is the cycle check. The pairs most likely to slip are listed
  in "Cycle watch" with the rule that keeps each one-way.
- **Coarse packages by category, named for what they do.** A package is named for the
  processing it does (`db`, `http`, `fleet`, `log`), never for where the dependency arrows happen
  to allow the code to sit. When a module's only reason to be in a package is "it may depend on
  that from here", the package is wrong.
- **Every package has an admission rule** (in its design below): what it takes, and what it
  refuses even when the dependency graph would allow it. Each rule was checked against the
  package's own holds list; a rule that a listed module fails is a wrong rule or a wrong list.
  `shared` has the strictest one, because a package called "shared" is the one that becomes
  "everything goes here".
- **Five apps.** `automation-server`, `automation-client`, `qemu-reverse-proxy`, `qemu-server`
  and `dashboard`. Everything else is a script.
- **Prefer returning values; log where the decision is made.** The `Log` service is available
  from layer 1, so any package may take it. The default is still to return a typed error and let
  the caller decide. A module logs itself when the line is the decision, as the host sampler does
  (a skipped reading is not the caller's business, but it is worth a line).
- **The right technology and nothing extra.** Phase 0 chose Bun workspaces, a catalog, the
  isolated linker and source-first packages. The list, and what was deliberately left out, is in
  "Phase 0 (done)".
- **Tests live with the code they test.** Unit tests sit in their package and need nothing
  outside their own file and package. A test that needs the real OS but no container or process
  sits in its owner's own integration lane. System tests, with all their machinery, live in one
  package.
- **Tests first, every time.** Each test has a happy and an unhappy path. No presentational
  tests (AGENTS.md).

## Plan

### Test checklist

Write each phase's tests before any of that phase's code, and see them fail.

**Phase 1: cycle checks**

- [ ] TEST (new) `test/repo/scripts.unit.test.ts`: `.oxlintrc.json` turns `import/no-cycle` on
      as an error. Happy: the checked-in config. Unhappy: a config without the rule, or with it
      off, is named.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: every workspace package appears in the
      declared layer list and depends only on packages in a strictly lower layer. Happy: the real
      graph (`routes` in `http`'s slot above `shared`). Unhappy: a made-up upward edge, a
      same-layer edge, a two-package loop and a package missing from the list are each named,
      the loop with both edges.
- [ ] TEST (alter) `test/dig/lobby.unit.test.ts` and `test/dig/room.unit.test.ts`: take the
      `Room` type from `dig/domain.ts` wherever they name it.

**Phase 2: `@oligarchy/shared`**

- [ ] TEST (move) `test/shared/domain.unit.test.ts` and `test/shared/errors.unit.test.ts` to
      `packages/shared/test/`. The errors test keeps only the domain errors' cases; each other
      error's cases move with its error in the phase its package appears.
- [ ] TEST (move) `test/viz/steps.unit.test.ts` to `packages/shared/test/steps.unit.test.ts`,
      keeping its cases. Happy: the steps of an instruction and the place of the last matched
      message. Unhappy: an instruction with no steps, and a message matching none, if either case
      is missing.
- [ ] TEST (move) the vocabulary cases that move down (at least `SessionMode` and `ServerUrl`)
      from `packages/routes/test/contract.unit.test.ts` to `packages/shared/test/`. The
      contract test keeps one case per moved vocabulary proving a body with a bad value is still
      refused with the same message.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: no file in shared imports a Node module,
      a platform, `process.*` or `@oligarchy/*`. Unhappy: each is named.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: the routes package may import `effect`
      and `@oligarchy/shared`. Its unhappy case still names the main package, a platform, Node
      and a driver.

**Phase 3: `@oligarchy/log`**

- [ ] TEST (move) the `Log Sentry policy` and `Log colours` describes of
      `test/observability/log.unit.test.ts` to `packages/log/test/log.unit.test.ts`, on
      `Log.layerStdout` and an inline recording sink. Happy: `info` and `warning` write one line
      with level, location and ticket colour; `error` and `fatal` also report a `LogLine` with the
      cause to the current reporters. Unhappy: an unattributed line stays readable without a
      colour; `skipSentry` reports nothing.
- [ ] TEST (new) `packages/log/test/log.unit.test.ts`: `Log.layer(sink)` builds the sink once
      with `write` and `report`, hands every line with its `LogRow` to it in call order, writes
      nothing itself, and `flush` waits for the sink's flush. Unhappy: the stdout layer's sink
      writes each line at once, inserts nothing, and its `flush` is immediate.
- [ ] TEST (move) `test/observability/render.unit.test.ts` to
      `packages/log/test/render.unit.test.ts`, all but the `wantsColor` describe (phase 4).
- [ ] TEST (move) `test/observability/palette.unit.test.ts` to `packages/log/test/`.
- [ ] TEST (move) `test/external-failure.unit.test.ts` to `packages/log/test/`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: no file in log imports `node:tty`, reads
      `process.*`, or imports a platform, `db`, `observability` or a Sentry module. Unhappy: each
      is named.
- [ ] TEST (alter) `test/support/log.ts` and every test that fakes `Log`: import from
      `@oligarchy/log`. A test that only needs a logger and asserts no lines provides
      `Log.layerStdout` instead of a fake.
- [ ] TEST (alter) `test/observability/sentry.unit.test.ts`: `LogLine` comes from
      `@oligarchy/log` (`sentry.ts` compares `LogLine.identifier`; it stays in `src/` until
      phase 6).

**Phase 4: `@oligarchy/env`**

- [ ] TEST (move) `test/config/config.unit.test.ts` to `packages/env/test/config.unit.test.ts`,
      with the same assertions: the provider order, `--env-file` last one wins, `--` stops the
      scan, `<NAME> is not set`, and `ProxyConfig`.
- [ ] TEST (new) `packages/env/test/run.unit.test.ts`: `Env.program(command, { version })`
      returns the effect the entry runs: a successful command's exit is 0; a failing command's
      exit prints one headline and the cause, with no stack; a `CliError` prints nothing more;
      `--version` prints the version passed in; the Wizard is not offered; `Log.Colors` is
      provided from stdout, on for a TTY with 16 colours and off for a pipe. `Env.run` is the one
      `NodeRuntime.runMain` call and is not unit tested.
- [ ] TEST (move) the `wantsColor` describe from the render test to
      `packages/env/test/colors.unit.test.ts`.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the driver wrapper defines `import.meta.url`
      as the `oligarchy.json` loader's new path.
- [ ] TEST (move) `test/cli.unit.test.ts` to `test/automation-client/child.unit.test.ts`,
      following `src/cli.ts` to `src/automation-client/child.ts`.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: the `Effect.run` placement rule allows
      `Env.run` in env and the nine `main.ts` files that call it; `src/session/main.ts` keeps its
      own named exemption.

No test covers the `oligarchy.json` loader or the file's contents (standing decision).

**Phase 5: `@oligarchy/db`**

- [ ] TEST (move) `test/db/client.unit.test.ts` and `test/db/migrate.unit.test.ts` to
      `packages/db/test/`. The migrate test asserts the program, not the entry: `Env.run` is
      the entry.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: `db:migrate`, `prod:db:migrate` and
      `test:db:migrate` run the package's migrate entry, each still from its own env file.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the migrations workflow scans the
      migrations where they live, if `drizzle/` moves (open decision 2).
- [ ] TEST (alter) `test/support/stores.ts` and every test importing a store type: import from
      `@oligarchy/db`.

`test/integration/db.integration.test.ts` and `test-database.integration.test.ts` need the
container and stay in the root's integration project until phase 11.

**Phase 6: `@oligarchy/observability`**

- [ ] TEST (move) the `Log rows` describe of `test/observability/log.unit.test.ts` to
      `packages/observability/test/log.unit.test.ts`, on `LogLive` with an inline `LogStore`
      fake. Happy: each row is inserted, then its line is written to stdout, in call order, and
      no line appears before its row has landed; `flush` waits for the last line. Unhappy: a
      refused row still writes its line, then `db: log insert failed: <detail>`, then reports the
      failure to the reporters, in that order, and the rows behind it still land; an interrupt
      mid-drain writes nothing more and is not reported.
- [ ] TEST (move) `test/observability/sentry.unit.test.ts` to `packages/observability/test/`.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the instrumented processes preload the
      package's `instrument.ts`, in the package scripts and the wrappers.

**Phase 7: `@oligarchy/linear`**

- [ ] TEST (move) `test/ctrl/linear.unit.test.ts` and `test/ctrl/prompts.unit.test.ts` to
      `packages/linear/test/`.
- [ ] TEST (move) the `test run` and `testsuite` cases of `test/ctrl/command.unit.test.ts` that
      exercise `openRun` to `packages/linear/test/run.unit.test.ts`. Happy: `testsuite` opens one
      run per definition but mint, each in its newest wording, with one ticket each, and returns
      the run and its tickets; `--name` opens one; nothing is printed. Unhappy: a ticket that
      fails rolls the run back and fails with the cause; an unknown name is refused. The ctrl
      command test keeps one case per command proving it calls `openRun` with its flags and
      prints what came back as JSON.
- [ ] TEST (move) the abort cases of `test/dashboard/dashboard.unit.test.ts` that exercise the
      dashboard's own Linear client to `packages/linear/test/client.unit.test.ts` as `abort`.
      Happy: the ticket moves to Aborted. Unhappy: an unknown ticket and an API refusal are each
      a `LinearError`. The dashboard test keeps one case proving `POST /abort` calls it.
- [ ] TEST (alter) `test/dashboard/suite.unit.test.ts`: `createTestSuiteRun` builds its runtime
      (database and `TestStore`, `Linear`, `Log.layerStdout`, the bundled templates as the file
      system, `FetchHttpClient`), calls `openRun`, and answers with what it returned. It no longer
      runs `ctrl` or scrapes a console.

**Phase 8: `@oligarchy/fleet`**

- [ ] TEST (move) `test/qemu/stats.unit.test.ts` to `packages/fleet/test/host.unit.test.ts`,
      scripting its readings in the file, with `Log.layerStdout` or an inline recording `Log`.
- [ ] TEST (alter) host sampler: a reading that throws logs
      `failed to sample cpu usage: <detail>` with the thrown value as the cause, and the next
      tick still samples against the last good reading. A clean tick logs nothing. `collect`
      returns `{ memory, cpu }` and takes no `qemus`.
- [ ] TEST (move) `test/shared/process-usage.unit.test.ts` to
      `packages/fleet/test/process.unit.test.ts`, with the `/proc` cases on an inline
      `FileSystem.layerNoop`.
- [ ] TEST (alter) process reader on macOS: the `ps` cases feed a listing string. A listing that
      never answers fails after ten seconds. The SIGTERM, then SIGKILL a second later, settings
      are checked on the command value. Failures assert `PsFailed`.
- [ ] TEST (move) `test/integration/process-usage.integration.test.ts` to
      `packages/fleet/test/process.integration.test.ts`, under fleet's own `test:integration`
      lane, on the platform's child-process layer.
- [ ] TEST (new) `packages/fleet/test/member.unit.test.ts`, on `TestClock` with inline store
      fakes. Happy: the first tick writes the servers row with the member's type, name and
      `qemus`, and the sampler's memory and cpu, then the process row with `jobs` and the
      reader's sample; a tick repeats every thirty seconds; closing the scope deletes the row;
      `onJoin` runs before the first heartbeat and, once it succeeds, never again. Unhappy: a
      failing servers write logs `heartbeat failed: <detail>` and the process row still lands; a
      failing process write logs `process stats failed`; a failing `report` is one line and the
      tick moves on; a failing `onJoin` is one line and runs again next tick; a failing delete
      logs `unannounce failed` and the scope still closes; a failing `onLeave` is one line and
      the row is still deleted.
- [ ] TEST (move) `test/shared/stale-servers.unit.test.ts` to
      `packages/fleet/test/sweep.unit.test.ts`.
- [ ] TEST (alter) `test/qemu-server/heartbeat.unit.test.ts`: one case that qemu-server
      announces its own `Member` (type `qemu`, the server location, `qemus` from its machine
      count, `jobs` from its slots). Its `onJoin` removes this url's setup requests and logs
      `setup cleared; <url>; <n>` when any went: happy, the rows go; unhappy, a failing removal
      is retried next tick. A failing process read is `PsFailed`, not `CliFailed`.
- [ ] TEST (alter) `test/automation-client/heartbeat.unit.test.ts`: one case that
      automation-client announces its own `Member` (type `automation-client`, its attribution,
      `qemus: 0`, `jobs` from its sessions) and has no `onJoin`. A failing process read is
      `PsFailed`.
- [ ] TEST (alter) `test/qemu-server/sessions.unit.test.ts`: `sessions.stats` is the machine
      count plus the sampler's values (`test/support/fake-qemu.ts` fake stats return plain
      values).
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: the boundary-file list names
      `packages/fleet/src/host.ts` and `process.ts` (they read `node:os` and `process.*`).
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: a package may add a `test:integration` lane
      on Bun; the root `test:integration` runs the root's lane, then
      `bun run --workspaces --if-present test:integration`. Unhappy: a package integration lane
      off Bun, and a fan-out without `--if-present`, are each named.

**Phase 9: `@oligarchy/http`**

- [ ] TEST (alter) every test importing `@oligarchy/routes/*` imports `@oligarchy/http/*`,
      keeping the `Api`, `Contract` and `ApiErrors` aliases.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: `api`, `contract` and `errors` import
      only `effect` and `@oligarchy/shared`. Unhappy: a Node, platform or `log` import there is
      named.
- [ ] TEST (move) the bearer-auth and boundary middleware cases, which live in the apps' HTTP
      tests today (`test/qemu-server/http.unit.test.ts` and the others), to
      `packages/http/test/middleware.unit.test.ts`. Each app keeps one case proving the
      middleware is wired in.
- [ ] TEST (move) `test/client/proxy-client.unit.test.ts` to `packages/http/test/`.
- [ ] TEST (new) `packages/http/test/serve.unit.test.ts`: a server listens and serves its
      routes. A port already in use fails with `HttpServerError.ServeError`. A later server error
      runs the caller's `onError` once, then ends the program once with one fatal line; a second
      error runs nothing.
- [ ] TEST (alter) `test/integration/client.integration.test.ts`: the bundle rebuilds when an
      http-package source is newer.

**Phase 10: the five apps**

- [ ] TEST (move) qemu-server's unit tests (`test/qemu-server/`, `test/qemu/`, `test/qmp/`) to
      `apps/qemu-server/test/`.
- [ ] TEST (move) automation-client's unit tests to `apps/automation-client/test/`.
- [ ] TEST (move) automation-server's unit tests, `test/automation-server/client.unit.test.ts`
      included, to `apps/automation-server/test/`.
- [ ] TEST (move) qemu-reverse-proxy's unit tests to `apps/qemu-reverse-proxy/test/`.
- [ ] TEST (move) `test/dashboard/*.unit.test.ts` to `apps/dashboard/test/`.
- [ ] TEST (alter) `apps/dashboard/test/follow.unit.test.ts`: takes `stepsOf` and `placeOf` from
      `@oligarchy/shared/steps`.
- [ ] TEST (alter) `apps/dashboard/test/suite.unit.test.ts`: `SuiteRequestError` is a
      `Schema.TaggedError` with an `@oligarchy/dashboard/...` identifier; a bad body fails with
      it, and the response text is unchanged.
- [ ] TEST (move) `test/integration/qemu-process.integration.test.ts` and
      `qmp-socket.integration.test.ts` to `apps/qemu-server/test/`, under the app's own
      `test:integration` lane (they need the qemu binary and a socket, not a container).
- [ ] TEST (alter) each moved test file: shared fakes become inline fakes of the methods it uses,
      or a helper in its own app's `test/` folder (open decision 3).
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: each server's package script and wrapper run
      `apps/<name>/src/main.ts` with exactly its preloads; `dev` runs wrangler from
      `apps/dashboard`; `check:types` reaches every app's tsconfig.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: an app imports packages only, never
      another app and never the root's `src/`. Unhappy: an app-to-app import is named.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: the boundary-file list, the `main.ts`
      pattern and the `Effect.run` rules cover `apps/*/src/main.ts` and the dashboard's entry.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: every `.tsx` in the root package opens
      with the `@opentui/solid` pragma; the dashboard's `.tsx` files are the app's, under its own
      tsconfig. Unhappy: a root `.tsx` without the pragma is named.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the fleet starters start the apps from
      their new entries, and a second signal still kills both children.

**Phase 11: finish integration testing**

- [ ] TEST (move) the remaining integration tests (every one that copies the Postgres template or
      spawns a built process) into `packages/integration-testing/test/`.
- [ ] TEST (alter) `automation-client.integration.test.ts`: spells the driver's arguments it
      starts the child with, instead of importing `Driver.args` from the app.
- [ ] TEST (alter) `dashboard.integration.test.ts`: imports the Worker entry (`app`,
      `scheduled`) from `@oligarchy/dashboard` (open decision 4).
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the integration package's lane runs one
      worker with the global setup, and the root `test:integration` reaches it.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: no package or app depends on
      `@oligarchy/integration-testing`; integration-testing's only app import is the dashboard's
      entry. Unhappy: a second app import, or any dependency on integration-testing, is named.

### Implementation checklist

**Phase 1: cycle checks**

- [ ] Add the `import` plugin and `"import/no-cycle": "error"` to `.oxlintrc.json`.
- [ ] Break the one cycle it finds: move the `Room` type into `src/dig/domain.ts` and have
      `lobby.ts` use `Domain.SLOT_COUNT`, so `lobby.ts` stops importing `room.ts`.
- [ ] Add the layer list to `test/repo/architecture.unit.test.ts`, with `routes` in `http`'s
      slot. The list is the one in "Target in one picture"; a package is added to it in the phase
      that creates it.
- [ ] `development.md`: document the no-cycle rule and the layer list, and write in the standing
      test decisions ("never test wrangler", "never test `oligarchy.json`").

**Phase 2: `@oligarchy/shared`**

- [ ] Create `packages/shared` with `domain.ts`, `errors.ts` (the domain errors only:
      `CommandError` and the others every layer raises) and `steps.ts` (from `src/viz/steps.ts`).
- [ ] Move the vocabularies domain code also uses from the routes contract into shared. The
      contract imports them. Schema identifiers stay unchanged.
- [ ] **Staged errors.** `src/shared/errors.ts` stays in the root, re-exporting nothing, holding
      only the errors whose package does not exist yet (`MissingVariable`, `DatabaseError`,
      `LogLine`, the app errors). Each phase moves its errors out; the file is deleted in phase
      10 when the last app takes its own. Every import of a moved error is re-pointed in the
      phase that moves it.
- [ ] Re-point every import of `src/shared/domain.ts` and `src/viz/steps.ts` (`viz/view.ts`,
      `viz/follow.ts`, `driver/loop.ts`, `dashboard/follow.tsx`).

**Phase 3: `@oligarchy/log`**

- [ ] Create `packages/log` with:
  - `log.ts`: the `Log` service, `Attribution`, `Report`, `Locations`, `ProcessAttribution`,
    `Colors` (default off), `LogRow` (`text`, `level`, `location`, `agentId`; the shape `offer`
    builds today), the `Sink` type (`offer(line, row)`, `flush`), `static layer(sink)` where
    `sink` is `(write, report) => Effect<Sink, never, Scope>` (today's `makeLog` argument), and
    `static layerStdout`, whose sink writes each line at once. `emit` renders the line, builds
    the row and offers both; it no longer writes stdout itself. The shape of the service is
    derived from `make`; the `LogService` alias goes, as `development.md` requires.
  - `render.ts`: `errorDetail`, `headline`, `renderFailure`, `reportFailure`, the rendered-line
    type as `Line` (renamed from the text `LogLine`, so the error class keeps the name),
    `logPieces`, `renderLogLine`, `paint`, `foreground` and the Rose Pine constants.
  - `palette.ts`.
  - `external-failure.ts` (from `src/external-failure.ts`).
  - `LogLine`, the Sentry wrapper, from `src/shared/errors.ts`, identifier unchanged.
- [ ] `wantsColor` and the stdout probe move to `src/observability/colors.ts` for this phase
      (env does not exist yet); the nine entries and `src/session/main.ts` provide
      `Layer.succeed(Log.Colors)(Colors.stdoutColors)`. Phase 4 moves that file into env.
- [ ] Re-point every import of `observability/log.ts`, `render.ts`, `palette.ts` and
      `external-failure.ts` that is not the row-writing layer; `src/observability/sentry.ts`
      takes `LogLine` from `@oligarchy/log`.

**Phase 4: `@oligarchy/env`**

- [ ] Create `packages/env` with `config.ts`, `env-file.ts`, `oligarchy.ts` (from
      `src/harness/config.ts`), `colors.ts` (from `src/observability/colors.ts`) and `run.ts`:
      `Env.program(command, { version })`, the effect, and `Env.run(program, { teardown })`, the
      one `NodeRuntime.runMain` call.
- [ ] Switch nine entries to `Env.run` (`ctrl`, `dig`, `driver`, `client`, `viz` and the four
      servers). `src/session/main.ts` uses `Env.program` and keeps its own runtime and signal
      handling.
- [ ] Update the driver wrapper's `--define` for the loader's new path.
- [ ] Move `src/cli.ts` to `src/automation-client/child.ts`.
- [ ] `development.md`: the Config section's paths and the runner.

**Phase 5: `@oligarchy/db`**

- [ ] Create `packages/db` from `src/db/*`, with `DatabaseError`. `migrate.ts` is an `Env.run`
      entry, so db imports no platform module.
- [ ] Move `drizzle/` and `drizzle.config.ts`, and update the CI workflow paths in the same
      change (if open decision 2 is accepted).
- [ ] Update the migrate scripts and the dashboard's schema import.

**Phase 6: `@oligarchy/observability`**

- [ ] Create `packages/observability` with `sentry.ts`, `instrument.ts`, `dsn.ts` and `log.ts`
      holding `LogLive`: `Log.layer((write, report) => makeSink(store.insertLog, write, report))`
      over `LogStore`. `makeSink`, its queue, and the `Row` alias derived from
      `LogStore.insertLog` stay here; `LogRow` is the type `offer` accepts.
- [ ] The five `main.ts` files that build the row-writing log use `Observability.LogLive` where
      they used `Log.Log.layer`.
- [ ] Update every `--preload` path and the dashboard's `dsn` import.

**Phase 7: `@oligarchy/linear`**

- [ ] Create `packages/linear` from `src/ctrl/linear.ts` (with `abort` folded in from
      `src/dashboard/linear.ts`) and `src/ctrl/prompts.ts`, with `LinearError` and `PromptError`,
      plus `run.ts` holding `openRun` lifted out of `makeCtrlCommand`'s closure together with
      `selectDefinitions`, `noDefinitions`, `withReason`, `trapped` and `MINT_DEFINITION`. It
      requires `TestStore`, `Linear`, `Log` and `FileSystem`, returns the run and its tickets,
      and prints nothing; `ctrl` prints the JSON.
- [ ] `ctrl test run` and `testsuite` call `Linear.openRun`. The dashboard's `suite.ts` builds its
      `ManagedRuntime` (database and `TestStore`, `Linear`, `Log.layerStdout`, the bundled
      templates as the file system, `FetchHttpClient`) and calls it, dropping the in-process
      `ctrl` run and the recording console. `POST /abort` calls the client. Delete
      `src/dashboard/linear.ts`.

**Phase 8: `@oligarchy/fleet`**

- [ ] Create `packages/fleet` with `host.ts` (from `src/qemu/stats.ts`), `process.ts` (from
      `src/shared/process-usage.ts`), `member.ts` (the template, from the two `heartbeat.ts`)
      and `sweep.ts` (from `src/shared/stale-servers.ts`). The `detail` helper that unwraps a
      `DatabaseError`'s cause, copied in all three source files today, is written once.
- [ ] Host: drop `qemus`, return `{ memory, cpu }`, drop the `@oligarchy/routes/contract` import
      in the same change (it is the one edge that would put fleet and http on the same layer with
      an edge), keep today's log line for a skipped reading.
- [ ] Give the process reader `PsFailed` (a `Schema.TaggedError`, identifier
      `@oligarchy/fleet/process/PsFailed`) and the listing seam.
- [ ] qemu-server and automation-client each define their `Member` and call `Fleet.announce`;
      the proxy and automation-server call `Fleet.forget`. Delete both `heartbeat.ts` files and
      `stale-servers.ts`. The apps build `Contract.Stats` from the values plus the machine count.
- [ ] Add fleet's `test:integration` lane and the `--workspaces --if-present` fan-out.
- [ ] Add `@effect/vitest` to the catalog.
- [ ] Update the architecture boundary-file list for the new paths.
- [ ] `development.md`: the unit-test rule, per-package integration lanes and the fleet template.

**Phase 9: `@oligarchy/http`**

- [ ] Rename `packages/routes` to `packages/http` (`@oligarchy/http`).
- [ ] Move in the middleware, `NotFoundRoute` and the proxy client. Add `serve` with its
      `onError` hook.
- [ ] Remove the hand-rolled listen code from the four servers; qemu-server passes
      `onError: (cause) => MutableRef.set(shutdown.reason, ...)`.
- [ ] Run `wrangler deploy --dry-run` as a build check (not a test).

**Phase 10: the five apps**

- [ ] Add `apps/*` to the root workspaces.
- [ ] Move each server into `apps/<name>/`: qemu-server takes `src/qemu/` and `src/qmp/`,
      automation-client takes `child.ts`, automation-server keeps `client.ts`.
- [ ] Move the dashboard into `apps/dashboard/` with `wrangler.jsonc`, the `dev` script, the text
      module rules (paths to `client.md`, `ctrl-linear.md` and `prompts/*.html` become
      `../../../`), its own tsconfig with `jsxImportSource: hono/jsx`, and `query.ts` as its read
      model. Drop `jsxImportSource` from the root tsconfig. `SuiteRequestError` becomes a
      `Schema.TaggedError`.
- [ ] Give the dashboard an `exports` entry for its Worker entry, if open decision 4 is accepted.
- [ ] Delete the root `src/shared/errors.ts` once the last app error has moved.
- [ ] Update the wrappers, package scripts and fleet starters.

**Phase 11: finish integration testing**

- [ ] Create `packages/integration-testing` with the container global setup, the template copy
      (`postgres.ts`), the loopback stubs (`stub-proxy.ts`) and the one-worker lane.
- [ ] Move the remaining integration tests. Delete `test/integration/` and the root's integration
      project.
- [ ] Add `@effect/platform-node` to the catalog if a second package needs it by then.

### Verification (every phase)

- `bun run check:fast` exits 0 locally and in CI.
- The integration lane with Docker up: `OLIGARCHY_REQUIRE_DATABASE=1 bun run test:integration`.
- `bun install --frozen-lockfile`.
- When a phase touches something the scripts bundle: `./client --help` and `./driver --help`.
- When a phase touches something the dashboard bundles (shared, log, db, observability, linear,
  http): `wrangler deploy --dry-run` as a build check, from `apps/dashboard` once phase 10 lands.

## Enforcing one-way dependencies

### File cycles: oxlint `import/no-cycle`

oxlint already runs over the whole tree, and its `import` plugin has `import/no-cycle`. Turning it
on means adding `"import"` to `plugins` and the rule to `rules` in `.oxlintrc.json`.

Checked on 2026-09-25 with oxlint 1.81.0:

- Two files importing each other in a scratch directory: both reported.
- The same loop across two workspace packages, through their `exports`: both reported. The rule
  follows package imports.
- The whole repo with only this rule on: 0.24 seconds, and exactly one cycle,
  `src/dig/lobby.ts` and `src/dig/room.ts`. `lobby.ts` only needs the `Room` type and
  `SLOT_COUNT`, which is `Domain.SLOT_COUNT`, so moving the type into `dig/domain.ts` breaks it.

### Package layers: a repo test

The lint rule is not enough on its own:

- A package cycle need not contain a file loop. If `a/one.ts` imports `b/one.ts` and `b/two.ts`
  imports `a/two.ts`, the packages depend on each other and oxlint passes. Verified in a scratch
  workspace.
- Bun installs two workspace packages that depend on each other without complaint, with the
  isolated linker too. Verified.
- A lint rule sees one file at a time. The package graph lives in the `package.json` files.

So `test/repo/architecture.unit.test.ts`, where the repo already enforces its architecture, gains
one check:

- **A declared layer list, and an edge check.** Every package must appear in the list, and a
  package's `dependencies` may name only packages in a strictly lower layer. A cycle among listed
  packages is necessarily an upward or same-layer edge, so this check names any cycle too; a
  separate cycle test would restate it.

Already enforced, with nothing to add:

- **The isolated linker.** An import of a package that is not declared fails to resolve, in `tsc`
  and at runtime. So a per-package "imports only these packages" test would restate the
  `dependencies` field plus the edge check; the plan has none. What it does have are per-file
  category checks where the category is the point: shared and log import no Node and no
  `process.*`, the three contract files import only `effect` and shared, and the boundary-file
  list.
- **The existing workspace-import test.** Code reaches a package only through its `exports`,
  never by a relative path into `packages/`.

### Cycle watch

The pairs that would cycle if a module landed in the wrong place, and the rule that keeps each
one-way. The edge check catches a slip; this table says where the slip would come from. Every row
was checked against the modules' imports as they are today.

| Pair | Direction | What would close the loop | Rule |
|---|---|---|---|
| `shared` ↔ `http` | contract imports shared | `domain.ts` importing `Contract.SessionMode` (it does today) | every vocabulary domain code uses lives in shared; the contract imports it |
| `log` ↔ `db` | db imports log (failure text) | `type Row = Parameters<typeof Logs.LogStore.Service.insertLog>[0]` in `log.ts` today | log declares `LogRow`; that alias and `makeSink` stay in observability; log never names a store |
| `log` ↔ `log` (construction) | — | a prebuilt sink that needs the `Log` it is being built into, to write the line after its row and to report its own insert failures | the sink is a factory receiving `write` and `report`, today's `makeLog` shape, and is offered the line with the row |
| `log` ↔ `env` | env imports log (`reportFailure`, `Colors`) | `WriteStream.prototype.getColorDepth` and `process.stdout` in `render.ts` | `wantsColor` and the probe live in env; `Colors` defaults to off |
| `log` ↔ `observability` | observability imports log | Sentry reporting inside log | log reports through Effect's `ErrorReporter.CurrentErrorReporters`; Sentry installs a reporter, log never names Sentry |
| `db` ↔ `observability` | observability imports db (rows) | `db/client.ts` importing `Render` from observability (it does today) | failure text is in log; `db/client.ts` keeps `Effect.logError`, because a pool error routed through the row-writing log would try to insert through the failing pool |
| `db` ↔ platform | — | `migrate.ts` importing `NodeRuntime` and `NodeServices` (it does today) | `migrate.ts` is an `Env.run` entry; db declares no platform module |
| `db` ↔ `linear` | linear imports db (`openRun` reads `TestStore`) | a store that files a ticket | db stores never call out; a workflow that spans both lives in linear |
| `fleet` ↔ `http` | none | `stats.ts` importing `@oligarchy/routes/contract` (it does today) | fleet returns `{ memory, cpu }`; the apps build `Contract.Stats`; the import goes in the same change as the move |
| `http` ↔ automation-server | none | moving `automation-server/client.ts` to http while `AutomationClientError` and `OligarchyToken` stay in the app | the client stays in the app; it has one consumer |
| `env` ↔ `http` | http imports env (`ProxyConfig`) | `Api.VERSION` in the runner | the version is passed to `Env.program` |
| `env` ↔ `shared` | env imports shared | a flag schema in shared | flags live in the apps; shared holds the vocabulary a flag decodes to |
| app ↔ app | none | `ctrl/linear.ts`, `qemu-server/middleware.ts`, `client/proxy-client.ts`, `ctrl/command.ts` (all imported across apps today) | each is in linear, http or linear (`openRun`) before phase 10 |
| `dashboard` ↔ root | none | the dashboard importing `ctrl` or `viz` (it does today) | `steps` is in shared, `openRun` in linear; the dashboard imports packages only |

### Considered and not chosen

- **dependency-cruiser.** It can check both cycles and layers, but it is another tool with its
  own config language, restating what `package.json` already declares.
- **madge.** Cycles only, no layers, and another dependency.
- **Nx `enforce-module-boundaries`.** It needs Nx, which phase 0 ruled out.
- **A custom oxlint JS plugin for layers.** Possible, but the package graph is not a property of
  any one file. A repo test reads the whole graph at once and is how this repo already checks
  architecture.

## Package designs

### `@oligarchy/shared` (layer 0, phase 2)

The vocabulary every process speaks. About 650 lines.

- **Holds** `domain.ts` (ids, `LogLevel`, session and server vocabularies, the QMP schemas that
  `db/actions.ts` and `qmp/client.ts` both speak), `errors.ts` (the domain errors used
  everywhere, `CommandError` for one), and `steps.ts` (how a test instruction reads as steps and
  where a message sits in them; used by `viz`, `driver` and the dashboard).
- **Takes back** from the routes contract the vocabularies domain code also uses: at least
  `SessionMode`, which `domain.ts` imports from routes today (an upward edge), and `ServerUrl`,
  which env needs. Vocabularies only the wire uses stay in the contract. Schema identifiers are
  unchanged.
- **Depends on** `effect` only.
- **Admission rule.** A module enters shared only if it imports nothing but `effect` and shared,
  has consumers in at least two packages or apps, and is one of: a schema, an id, an error class,
  or a pure function that reads a domain value (`steps.ts`, which reads an instruction, is the
  one such function today; a second one must be named here). Refused: a service with a clock or a
  loop, anything that reads the OS or `process.*`, anything that names a store, anything that
  turns a failure into text, and anything with a single consumer. `process-usage.ts` and
  `stale-servers.ts` fail it (fleet); the `Log` service and `external-failure.ts` fail it (log).
  The rule is the black-hole guard: a helper that is merely pure and popular does not pass.

Each other error moves with the package that raises it:

| Error | Home |
|---|---|
| `LogLine` (identifier `@oligarchy/observability/log/LogLine`, unchanged) | log |
| `MissingVariable` | env |
| `DatabaseError` | db |
| `LinearError`, `PromptError` | linear |
| `PsFailed` (new) | fleet |
| `ProxyRefusal`, `ProxyUnreachable` | http |
| `QmpError`, `QmpTimeout`, `QmpClosed`, `QmpProtocolError`, `QemuStartError`, `HostRequirementsMissing`, `IsoError`, `KeysError` | qemu-server |
| `AutomationClientError`, `JobNotFound` | automation-server (with `client.ts`) |
| `CliFailed` | automation-client (its child runner) |
| `SuiteRequestError` (becomes a `Schema.TaggedError`) | dashboard |
| `HistoryError`, `ToolError`, `OpenRouterRefusal`, `OpenRouterUnreachable` | driver (root) |
| `PngDecodeError` | session (root) |

Until its package exists, an error stays in the root's `src/shared/errors.ts`, which shrinks each
phase and is deleted in phase 10. No code raises `ChildExit`; only its own test names it, so it is
a candidate for deletion.

### `@oligarchy/log` (layer 1, phase 3)

How a failure is read and how a line and a failure read as text, and the service a line is written
through. About 450 lines. Every package above it may take `Log`; none has to.

- **Holds** `log.ts`: the `Log` service (`Context.Service`, shape derived from `make`, no parallel
  `LogService` type), `Attribution`, `Report`, `Locations`, `ProcessAttribution`, `Colors`,
  `LogRow`, the `Sink` type, `Log.layer(sink)` and `Log.layerStdout`. Reporting to Sentry already
  goes through Effect's `ErrorReporter.CurrentErrorReporters`, so the service names no Sentry
  module. `render.ts`: `errorDetail`, `headline`, `renderFailure`, `reportFailure`, the rendered
  `Line` type, `logPieces`, `renderLogLine`, `paint`, `foreground` and the Rose Pine constants.
  `palette.ts`: the agent colour palette. `external-failure.ts`: `causeOf`. `LogLine`: the
  Sentry wrapper error.
- **The sink is a factory and owns the destinations.**
  `Log.layer((write, report) => Effect<Sink, never, Scope>)`, with
  `Sink = { offer(line, row), flush }`. The service renders the `Line` (level, text,
  attribution, palette colour) and builds the `LogRow`, then offers both; it writes nothing
  itself. The sink gets the `write` that puts a line on stdout and the `report` that reaches
  the reporters, so it can say `db: log insert failed` without depending on the `Log` it is part
  of. `write` and `report` are exactly `makeLog`'s arguments today; what changes is that `emit`
  stops calling `write` before `offer`.
- **The row, then the line.** The row is the record and stdout is its convenience copy, so the
  copy follows the record. The row-writing sink inserts, then writes the line. A refused row
  still writes the line, then one more, `db: log insert failed: <detail>`, then reports the
  failure to Sentry; the rows behind it still land. The stdout sink has no row and writes at
  once. A consequence worth stating: with rows on, a stdout line trails its insert by the
  insert's latency and appears in insert order, which is call order, because one fiber drains
  the queue.
- **`LogRow`** is `text`, `level`, `location`, `agentId`: what `offer` builds today. The
  `Parameters<typeof LogStore.insertLog>[0]` alias that ties the row to the store stays with
  `makeSink` in observability.
- **Two `LogLine`s** live here today under one name: the error class and the rendered-line type.
  The class keeps the name (its identifier is in every Sentry group); the type becomes `Line`.
  They are in different modules and imported as namespaces, so nothing else changes.
- **Does not hold** the row sink (observability), or `wantsColor` and the `process.stdout` probe
  (env). `Colors` defaults to off; the runner provides it. So log has no boundary file.
- **Depends on** `shared` (`LogLevel`).
- **Why failure text is here and not in shared.** `errorDetail`, `headline` and `renderFailure`
  are called from about thirty files in every layer (forty import the module), and not only for
  log lines: `harness/config.ts` builds a `CommandError` message from `headline`, `db/migrate.ts`
  prints `renderFailure`, every entry prints `reportFailure` before a `Log` exists. They are "how
  a failure reads", which is this package's subject. Shared's admission rule refuses them.
- **Admission rule.** Reading a failure, the text of a line or a failure, and the service that
  writes a line to the console. Refused: any destination but the console (a store, a file,
  Sentry), and any reading of the terminal or the environment.

### `@oligarchy/env` (layer 2, phase 4)

What a process is given from outside, and the runner that installs it before the command runs.

**Why "env" and not "cli".** Each app's commands and flags stay in the app. `src/cli.ts` is not
CLI handling at all: it is automation-client's child-process runner. The one flag here is
`--env-file`, because the config reader must find it in the raw arguments before the CLI parses
them.

**Holds:**

- **Environment variables:** the lookup order (process environment, then the `--env-file` file,
  then `.env`), `required`, `requiredRedacted`, `MissingVariable`, the named accessors,
  `ProxyConfig`, `DEFAULT_SERVER_URL` and `DEFAULT_LINEAR_API_URL`.
- **The `--env-file` global flag** and `withEnvFile`.
- **The settings file, `oligarchy.json`:** the schema (models, reasoning effort, timeouts, step
  limit, run ceiling) and the loader. It is configuration the process is given, read by
  `automation-client/sessions.ts`, `automation-server/command.ts` and the driver, three consumers
  in three places. The file stays at the repo root, so the loader's path becomes
  `../../../oligarchy.json`, and the driver wrapper's `--define` for `import.meta.url` must point
  at the new file. It is read during a job as well as at startup; that is the app's business, not
  the loader's. The alternative home, a `harness` package, is the scripts plan's call (open
  decision 6).
- **The entry runner.** `Env.program(command, { version })` is the effect: install the config
  lookup, set up CLI output and CLI config without the Wizard, provide `Log.Colors` from
  `wantsColor(process.stdout, process.env)`, `Command.run` with the version, `reportFailure` on
  the way out. `Env.run(program, { teardown })` is the one `NodeRuntime.runMain` call, with
  error reporting off and the stdout/stderr error listeners. Nine entries use both; `session`
  uses `Env.program` and keeps its own runtime, because its REPL answers SIGTERM and SIGHUP
  itself. The version is passed in, so env never reaches up to http's `Api.VERSION`. CLI help
  colour stays the CLI's own `isTTY` probe; `wantsColor` (which honours `FORCE_COLOR`) sets
  `Log.Colors` only.
- **Colour detection:** `wantsColor` and the stdout probe, the two lines of `render.ts` that read
  Node. `colors.ts` is a boundary file.

**Does not hold:**

- Failure text (log).
- The servers' flags. `--name` and `port(default)` are the only two the four servers define
  identically; `--url` and `--max-jobs` differ in help text and `--port` in default. Flags are
  command definitions and stay in the apps; a five-line `port` helper is not a package's job.
- The HTTP listen code, which becomes http's `serve`.
- `src/cli.ts`, which moves into automation-client as `child.ts`.

**Depends on** `log` (`reportFailure`, `Colors`, `headline` for the loader's message), `shared`
(`ModelId`, `ServerUrl`) and `@effect/platform-node` (`NodeRuntime`).

**Admission rule.** A value a process is given from outside (a variable, an env file, the
settings file), and installing those before the command runs. Refused: a command's flags,
anything a command does while running, anything that writes.

### `@oligarchy/db` (layer 3, phase 5)

- **Holds** `src/db/*`: the client, migrate, every store and the schema, plus `DatabaseError`.
- **Depends on** env, log, shared, `drizzle-orm` and `pg`. `migrate.ts` is an `Env.run` entry,
  so the package imports no platform module.
- **The old loop breaks here.** `db/client.ts` and `db/migrate.ts` used only the failure text from
  `observability/render.ts`, which is in log now. So db no longer imports observability, while
  observability's row-writing log still writes through db.
- **It takes no `Log`.** `db/client.ts` keeps `Effect.logError` for pool errors, on purpose: a
  pool failure routed through the row-writing `Log` would try to insert a row through the
  failing pool. `db/client.ts` stays a boundary file, and the one place `Effect.log*`,
  `runForkWith` and `runPromiseExitWith` are allowed.
- **The staleness thresholds live here**, as SQL in `servers.ts` (`interval '10 minutes'` for
  stale, `45 seconds` for live). Fleet owns the tick interval, not the thresholds.
- **The dashboard** imports `@oligarchy/db/schema`.
- **Admission rule.** A store reads and writes rows and returns them. Refused: a loop, a clock, a
  call to another system, a log line.

### `@oligarchy/linear` (layer 4, phase 7)

The Linear API client, the ticket templates, and filing a run's tickets.

- **Holds** `client.ts` (`src/ctrl/linear.ts`, plus `abort` folded in from the dashboard's
  hand-rolled `src/dashboard/linear.ts`), `prompts.ts` (the ticket templates for test and mint
  tickets, read from `prompts/*.html`; the proxy's setup renders the mint one), and `run.ts`:
  `openRun`, lifted from `src/ctrl/command.ts` together with `selectDefinitions`,
  `noDefinitions`, `withReason`, `trapped` and `MINT_DEFINITION`. `openRun` reads the definitions
  from `TestStore`, creates the run and its experiment tests, files one ticket each from the
  templates, sets the run's Linear id, and fails the run on a ticket failure. It requires
  `TestStore`, `Linear`, `Log` and `FileSystem`, returns the run and its tickets, and prints
  nothing.
- **Used by** automation-server, qemu-reverse-proxy, ctrl and the dashboard. `ctrl test run`
  prints what `openRun` returns as JSON; `POST /create-test-suite-run` answers with it. The
  dashboard still builds its own `ManagedRuntime` (database and `TestStore`, `Linear`,
  `Log.layerStdout`, the bundled templates as its file system, `FetchHttpClient`); what changes is
  that it calls a function instead of a CLI with a scraped console.
- **Depends on** db (`TestStore`), env (`DEFAULT_LINEAR_API_URL`, `linearAccess`), log and
  shared. It is on layer 4 because of `openRun`; the client alone would sit on layer 3.
- **Admission rule.** The client, the templates, and `openRun`. A workflow enters only when
  filing a ticket is its purpose and the rows it writes are the run that ticket is about. Refused:
  a workflow whose purpose is a row or a session that happens to mention a ticket; those belong
  to the app that owns them (`automation-server/prompts.ts`, the drive and diagnose prompt
  filler, is such a case and stays in its app). Open decision 5 says when to revisit.

### `@oligarchy/observability` (layer 4, phase 6)

Where lines and failures go once written.

- **Holds** `sentry.ts`, `instrument.ts`, `dsn.ts`, and `log.ts` holding `LogLive`:
  `Log.layer((write, report) => makeSink(store.insertLog, write, report))` over `LogStore`.
  `makeSink` stays here: one drain fiber takes `{ line, row }` in call order, inserts the row,
  then writes the line; on a refused row it writes the line, then
  `db: log insert failed: <detail>`, then reports the failure; a flush marker resolves when the
  last line is out. The `Row` alias derived from `insertLog` stays with it.
- **Depends on** db (the rows), log (the service), shared and Sentry.
- **Paths follow it.** Every `--preload` of `instrument.ts` and the dashboard's `dsn` import.
  The five `main.ts` files that build the row-writing log use `Observability.LogLive`.
- **Admission rule.** A destination for lines, failures and spans. Refused: text formatting
  (log), and anything a package would need in order to log.

### `@oligarchy/fleet` (layer 5, phase 8)

How a server measures itself, announces itself, and how the fleet forgets a dead member. About
600 lines, four app consumers.

- **Holds** `host.ts` (from `src/qemu/stats.ts`: the host CPU and memory sampler), `process.ts`
  (from `src/shared/process-usage.ts`: this process's RSS and CPU, `/proc` or `ps`), `member.ts`
  (the announce loop, from the two `heartbeat.ts` files) and `sweep.ts` (from
  `src/shared/stale-servers.ts`).
- **Depends on** db (`ServerStore`, `ProcessStatsStore`), log and shared. Not on http: the wire
  `Memory`, `Cpu` and `Stats` schemas stay in the contract, and the apps build `Contract.Stats`
  from fleet's values plus their machine count. `stats.ts` imports the contract today; that
  import goes in the same change as the move, or fleet and http share a layer with an edge.
- **The sampler keeps its own clock.** It samples every five seconds into a 60-sample window. The
  one, two and three minute means count samples, so the clock has to stay inside the package.
- **`collect` returns `{ memory, cpu }`.** The `qemus` argument goes. qemu-server adds its
  machine count; automation-client stops passing `0`.
- **A skipped reading is one line.** A reading that throws is skipped, the next good reading is
  compared with the last good one, and the sampler logs today's exact line,
  `failed to sample cpu usage: <detail>`, with the thrown value as the cause. The first version of
  this plan published a `failures` stream for the apps to log instead; it existed only because
  the sampler was not allowed a `Log`. It is not needed.
- **The process reader already returns values.** Its error becomes fleet's own `PsFailed`, a
  `Schema.TaggedError`, instead of the shared `CliFailed`. The `ps` seam narrows: the reader takes
  "list the processes" as a value, so its unit tests pass a string. The real listing keeps the
  ten-second timeout and the SIGTERM, then SIGKILL a second later.
- **One tick interval, in fleet.** Both heartbeats and the sweep are separate `"30 seconds"`
  strings today. The staleness thresholds the sweep applies are SQL in `db/servers.ts` and stay
  there.
- **Service keys follow the package:** `@oligarchy/fleet/Host`, `@oligarchy/fleet/ProcessUsage`.
  Service keys are not schema identifiers, so renaming them changes no message.
- **`host.ts` and `process.ts` stay boundary files.** They read `node:os` and `process.*`, so the
  architecture test's boundary list follows their new paths.
- **Admission rule.** Measuring this host or process, and the fleet's membership rows. A member
  reports its counts (`qemus`, `jobs`); fleet never starts, stops or reads a session or a job.
  Refused: HTTP, anything about what a member *does*.

#### The member template

Read from the four `main.ts` files. Three lifecycles stack:

- **Process** (nine entries; `session` keeps its own runtime): stdout/stderr error listeners,
  build the graph and print a failure before a `Log` exists, `Command.run`, defects to
  `reportFailure`, `runMain` with a teardown. This is `Env.run`. Only the six scripts install CLI
  config without the Wizard today; the runner does it for all nine.
- **Server** (the four servers, and `dig` as a root script): `createServer`, the first-error
  `Deferred`, listen with the logger and listen log off, `TracerDisabledWhen`, then in the same
  scope log "listening" and start background work. This is http's `serve`. qemu-server also
  writes the first error into `shutdown.reason`; `serve` takes that as `onError`.
- **Fleet:** qemu-server and automation-client are *members*; the proxy and automation-server
  are *readers*.

| | qemu-server | automation-client | qemu-reverse-proxy | automation-server |
|---|---|---|---|---|
| role | member | member | reader | reader |
| joins as | `qemu` if `--url` | `automation-client` if `--url` | — | — |
| each tick (30 s) | servers row, process_stats row | servers row, process_stats row | — | — |
| host values from | `sessions.stats`, which calls `collect(map.size)` | `collect(0)` | — | — |
| `jobs` from | its slot count | `sessions.jobs` | — | — |
| once on join | remove this url's stale setup requests, retried each tick until it lands | — | — | — |
| on leave | delete the servers row | delete the servers row | — | — |
| sweeps | — | — | `forget("qemu")` | `forget("automation-client")` |

The loop shape is the same in both files: 30-second `Schedule.spaced`, `forkScoped` with
`startImmediately`, every write uninterruptible, every failure one
`log.error("<what> failed: <detail>")` and the next tick runs, the finalizer registered before
the fork. Where the values come from differs, which is what `report` hides. The reader column has
no hooks; `forget(type)` already is the template.

```ts
// @oligarchy/fleet/member
export type Member<RReport, EReport, RJoin, EJoin, RLeave, ELeave> = {
  readonly type: Servers.ServerType;        // "qemu" | "automation-client"
  readonly url: string;
  readonly name: string;
  readonly attribution: Log.Attribution;    // where this member's lines land

  // Each tick: what only this member knows. The template adds host memory and cpu from
  // the sampler and this process's RSS and cpu from the reader, and writes both rows.
  readonly report: Effect.Effect<{ readonly qemus: number; readonly jobs: number }, EReport, RReport>;

  // Once on joining, retried each tick until it succeeds: reclaim what a previous
  // incarnation under this url left behind. qemu-server removes its stale setup requests
  // and logs `setup cleared`; `Log.info` cannot fail, so "succeeds" is the removal landing.
  readonly onJoin?: Effect.Effect<void, EJoin, RJoin>;

  // Before the servers row is deleted on shutdown. No member needs it today.
  readonly onLeave?: Effect.Effect<void, ELeave, RLeave>;
};

export const announce: <RReport, EReport, RJoin, EJoin, RLeave, ELeave>(
  member: Member<RReport, EReport, RJoin, EJoin, RLeave, ELeave>,
) => Effect.Effect<
  void,
  never,
  | RReport | RJoin | RLeave
  | Scope.Scope | Host.Host | ProcessUsage.ProcessUsage
  | Servers.ServerStore | ProcessStats.ProcessStatsStore | Log.Log
>;

// @oligarchy/fleet/sweep
export const forget: (type: Servers.ServerType) =>
  Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log>;
```

One requirement type per hook, because a single `R` does not infer when `report` needs
`Sessions` and `onJoin` needs `SetupRequestStore` (`makeQemuServerCommand = <RHost, RServe>` is
the same shape in this repo). The hooks' error types are generic rather than `unknown`: the
template catches every failure and logs it, so what the hook fails with is the hook's business.
The loop is wrapped in `Layer.effectDiscard` by the app, as both heartbeats are today.

Deliberately not hooks: a per-tick "extra work" hook (nothing needs one; qemu-server's setup
clear is once-until-success, which is `onJoin`), the tick interval (one constant in fleet), and
the failure policy (one line, keep going, which is the template's point). Session drain and exit
codes are process lifecycle and stay in each app's `main.ts`.

### `@oligarchy/http` (layer 5, phase 9)

How we speak HTTP: one way to serve, one way to call the proxy, one set of API errors.

- **`@oligarchy/routes` becomes `@oligarchy/http`.** `api`, `contract` and `errors` keep their
  shape and their consumer aliases (`Api`, `Contract`, `ApiErrors`).
- **It takes in what the apps share today:**
  - the middleware in `qemu-server/middleware.ts` (`BearerAuthLive`, `bearerAuth`,
    `ApiBoundaryLive`, `RouteBoundaryLive`, `layerClient`), used by automation-client,
    automation-server and the proxy;
  - `NotFoundRoute` from `qemu-server/handlers.ts`, used by the same three;
  - the proxy client from `client/proxy-client.ts` (with `ProxyRefusal` and `ProxyUnreachable`),
    used by automation-client, the proxy and the client script;
  - `serve(routes, { port, onError? })`, the listen code every server writes by hand today
    (`createServer`, the first-error `Deferred`, `HttpRouter.serve` with the logger and listen
    log off, `NodeHttpServer.layer`, `TracerDisabledWhen`, and racing the launch against the
    server failing). It returns a `Layer`, built with `Layer.effectDiscard` and
    `Layer.provide(NodeHttpServer.layer(...))` the way the four mains do, and runs `onError` once
    on the first server error before the fatal line, which is how qemu-server sets
    `shutdown.reason`. `dig` has the same loop and may adopt `serve` later; it is a root script.
- **It does not take** the announce loop or the stale-server sweep (fleet), or
  `automation-server/client.ts`. That client has one consumer, declares `OligarchyToken` under
  an automation-server service key and raises `AutomationClientError`, an app error. It stays in
  its app.
- **The pure contract.** `api`, `contract` and `errors` import only `effect` and
  `@oligarchy/shared`. The reason is not the dashboard Worker, which already bundles Node code
  under `nodejs_compat`. It is that the contract is what every client bundles (`./client`'s
  bundle, the dashboard, `shared` before phase 2) and what keeps `shared` and the contract from
  cycling. A per-file rule in the architecture test keeps it pure inside an otherwise Node
  package.
- **Depends on** env (`ProxyConfig`), log (the boundaries' `Log`, failure text), shared and
  `@effect/platform-node`. Not on db, observability or fleet.
- **Admission rule.** The contract, serving it, calling the proxy, guarding a route. Refused: a
  store, a loop, a client with one consumer. A request timeout is HTTP and is not a "clock".

### The five apps (layer 6, phase 10)

Each app moves to `apps/<name>/`, with its own `package.json`, `src/`, `test/` and
`vitest.config.ts`. The root workspaces gain `apps/*`.

- **qemu-server** also takes `src/qemu/` and `src/qmp/`. Once the sampler moves, nothing else
  uses them. Its integration tests for the qemu binary and the QMP socket live in its own
  `test:integration` lane.
- **automation-client** also takes `child.ts` (was `src/cli.ts`).
- **automation-server** keeps `client.ts`, `OligarchyToken`, `AutomationClientError` and
  `JobNotFound`.
- **automation-server** and **qemu-reverse-proxy** take their own directories. Their imports of
  other apps (`ctrl/linear.ts`, `qemu-server/middleware.ts`, `qemu-server/handlers.ts`,
  `client/proxy-client.ts`, `shared/stale-servers.ts`) are gone by then, into linear, http and
  fleet.
- **dashboard** is the Cloudflare Worker: `dashboard.tsx`, the pages, `query.ts` (its read model
  over the schema on a Hyperdrive client per request; dashboard-specific processing, so it stays
  in the app), `clicker.ts`, `htmx.ts`, `suite.ts` (builds its runtime and calls
  `Linear.openRun`), `ticket.ts`, `wrangler.jsonc`, the text-module rules and the `dev` script.
  It imports db (`schema`), observability (`dsn`), http (`api`, `contract`, `errors`), linear
  (the client, `openRun`) and shared (`steps`). What it imported from the root today is gone:
  `ctrl/command.ts` (was run in-process as a CLI) into linear's `openRun`, `viz/steps.ts` into
  shared, and its hand-rolled Linear client into linear. `SuiteRequestError` becomes a
  `Schema.TaggedError`. Its `.tsx` files use `hono/jsx` under the app's own tsconfig, so the root
  tsconfig drops `jsxImportSource` and the "every `.tsx` outside the dashboard carries the
  `@opentui/solid` pragma" rule loses its exception.

The wrappers (`./qemu-server` and the others), the package scripts and the fleet starters point
at `apps/<name>/src/main.ts`.

### What stays in the root package

- **The scripts:** `client` (to be removed), `ctrl`, `dig`, `driver` (with `src/harness/`, except
  the settings loader that moves to env), `session` and `viz`.
- **`test/repo/`,** the repo-wide checks, which read files and import no packages.

The scripts use packages the way the apps do. The root keeps its own tangle (`driver` imports
`client` and `viz`, `viz` imports `session`, `ctrl` imports `client`), which is out of scope
here: this plan is the fleet's libraries and apps. The scripts are a second plan; the harness's
home (open decision 6) is decided there.

## Testing

### Where tests live

- **Unit tests** sit in `packages/<name>/test/` and `apps/<name>/test/` and import their own
  sources relatively. The root `test/` keeps `test/repo/` and the scripts' tests.
- **A package's or app's own integration tests**, which need the real OS but no container and no
  spawned process (fleet's `ps` and `/proc` reader, qemu-server's qemu binary and QMP socket),
  sit in that package's `test/` under its own `test:integration` lane. Such a test may import the
  platform (`@effect/platform-node`) as a dev dependency; the unit-test rule below is about unit
  tests.
- **System tests** live in `@oligarchy/integration-testing` (`packages/integration-testing`),
  with everything that makes them complicated: the Postgres container and its migrated template,
  the per-file template copy (`postgres.ts`), the loopback stubs, testcontainers, the one-worker
  lane. Every test that copies the template or spawns a built process is a system test. It sits
  above everything it tests, is dev only, and nothing depends on it. It is created in phase 11,
  when the first such test can move; the first version of this plan created it in phase 2 to hold
  one `ps` test that belongs in fleet.
- **A system test drives a built process; it does not import the app's source.**
  `automation-client.integration.test.ts` imports `Driver.args` today to spell the child's
  arguments; it spells them itself. The one exception is the dashboard, which has no process to
  spawn (open decision 4).
- **Fan-out.** The root `test:integration` runs the root's lane, then
  `bun run --workspaces --if-present test:integration`: `--workspaces` skips the root package and
  errors on a workspace without the script, so both halves are needed. `test:unit` and
  `check:types` already give every package the script and need no `--if-present`.

### The unit-test rule

- A unit test file imports its own package, Effect (including `TestClock` and `TestConsole`) and
  vitest. Never another package's tests, and never a shared unit-testing package.
- If several test files in one package need the same helper, a helper file in that package's own
  `test/` folder is allowed.
- When a test needs a big fake, first ask whether the code should take a value instead of a
  service. Fleet's readings and its `ps` listing are the model.
- A test that needs a `Log` and asserts no lines provides `Log.layerStdout`. A test that asserts
  lines provides an inline `Layer.succeed(Log.Log)(...)` recording them.
- A fake of one of our services is `Layer.succeed(Tag)(Tag.of({ ... }))` inline, with only the
  methods the test uses, and every unused member `Effect.die("Unexpected <Service>.<method>")`.
- `development.md` currently says fakes live under `test/support/`, one file per seam. That rule
  is rewritten in phase 8, when the first package's tests with fakes move.

### The shared helpers today, and where each goes

Counted on 2026-09-25 (unit test files using each):

| Helper | Fakes | Users | Where it goes |
|---|---|---|---|
| `log.ts` | Log | 22 | `Log.layerStdout` from `@oligarchy/log` where a test asserts no lines; an inline recording `Log` where it asserts lines. |
| `stores.ts` (1,055 lines) | every database store | 16 | Recording fakes go inline. Fakes that imitate store behaviour are decided one at a time (open decision 3). |
| `fake-http.ts` | the HTTP client | 16 | Decided in phase 9: inline `Layer.succeed(HttpClient.HttpClient)` where short. |
| `fake-spawner.ts` (235 lines) | child processes | 12 | Fleet narrows its seam. qemu-server and automation-client keep an app-local helper for process choreography. |
| `config.ts` (5 lines) | configuration | 12 | Inline. |
| `fake-fs.ts` | the file system | 10 | Effect's `FileSystem.layerNoop`, inline. |
| `reporter.ts` | Sentry's error reporter | 6 | Log's and observability's tests and the four servers' HTTP tests: inline, or an app-local helper. |
| `tracer.ts` | a recording tracer | 1 | qemu-server's own `test/` (its sessions test). |
| `stdio.ts` | process arguments | 5 | Stays with the scripts' command tests in the root. |
| `fake-qemu.ts`, `fake-minted.ts`, `fake-qmp-socket.ts`, `fake-sessions.ts` | QEMU pieces | 2–4 each | qemu-server's own `test/`. |
| `fake-linear.ts` | Linear | 5 | automation-server, the proxy's setup, ctrl and the dashboard: inline, or an app-local helper. |
| `viz.ts`, `fake-renderer.ts`, `fake-terminal.ts`, `fake-tty.ts` | the viz terminal | 1–5 each | Stay with the viz script in the root. |
| `fake-children.ts` | session children | 2 | Stays with the session script in the root. |
| `postgres.ts`, `stub-proxy.ts` | integration only | 10, 3 | `@oligarchy/integration-testing`. |

### Standing decisions

- **Never test wrangler** (decided in PR #232).
- **Never test the contents of `oligarchy.json`, or its loader** (decided in PR #232).
- **No presentational tests** (AGENTS.md).
- **Tests first.** Each test is its own todo, with a happy and an unhappy path, and must fail
  before the code changes.

## Open decisions

Each has a recommendation. None blocks phases 1 to 3. Decisions already taken in a design above
are not repeated here.

1. **Where variables are declared.** Recommended: one list in env, so every variable and secret
   the fleet reads stays in one file, as `development.md` requires today. It costs no
   dependencies, since accessors are only names and strings. The alternative is each package
   declaring its own (db declares `DATABASE_URL`, linear declares `LINEAR_*`). That is more
   self-contained, but it loses the single list and makes "report the first missing variable, in
   a fixed order" harder. Either way, one-command values (`dataDir`, `sessionId`,
   `linearWebhookSecret`) sit beside the shared ones.
2. **Migrations location.** Recommended: `drizzle/` and `drizzle.config.ts` move into
   `packages/db`, with the CI workflow paths in the same change. Alternative: they stay at the
   root.
3. **Fakes that imitate behaviour.** For example, the automation store fake in `stores.ts` and the
   process spawner for QEMU and opencode. Decided per package when it moves: inline, or a helper
   in that package's own `test/`.
4. **The dashboard's Worker entry as integration-testing's one app import.**
   `dashboard.integration.test.ts` runs the Hono app in-process (`app`, `scheduled`) against the
   container and a stub proxy. Recommended: the dashboard app declares an `exports` entry for its
   Worker entry, and the architecture test names it as the one app import integration-testing may
   make. A Worker's entry is its interface, the way a server's is its port. Alternatives: spawn
   `wrangler dev` (refused: never test wrangler), or keep the test in the app with its own
   container (duplicates the container machinery for one file). Decide before phase 10 creates
   the app's `package.json`.
5. **`linear` on layer 4 for `openRun`.** Recommended: yes; the alternative is a `runs` package
   of one function, which is the too-small pattern. If a second workflow that writes rows asks to
   enter linear, that is the signal to make the `runs` package instead.
6. **The settings loader's home.** Recommended for this plan: env, as configuration with three
   consumers in three places. If the scripts plan makes `src/harness/` a package, the loader goes
   with it and env keeps only the variables the harness reads.

## Phase 0 (done)

[PR #232](https://github.com/ThePrimeagen/Oligarchy/pull/232) made the repo a Bun workspace and
moved the HTTP contract into `@oligarchy/routes` (`api.ts`, `contract.ts`, `errors.ts`, importing
only `effect`).

### Technology chosen

- **Bun workspaces**, the object form of `workspaces` in the root `package.json`.
- **A Bun catalog** (`workspaces.catalog` and `"catalog:"`) for shared versions. One `effect`
  means one set of Schema types.
- **`workspace:*`** for internal dependencies.
- **Bun's isolated linker.** A package resolves only what its own `package.json` declares.
- **Source-first packages.** `exports` map each subpath straight to a `.ts` file, with no build
  step and no `dist`. Bun, `tsc` (`nodenext`), vitest and wrangler read the TypeScript as written.
- **Subpath exports and no barrel.**
- **A shared `tsconfig.base.json`** with TS 7 (tsgo, patched by effect-tsgo) and the existing
  strictness.
- **`bun run --workspaces <script>`** for fan-out. `check:types` and `test:unit` run the root's
  lane, then every package's.
- **Per-package Vitest 4 config**, run on Bun.
- **oxlint and oxfmt** once at the root over the whole tree.

### Technology deliberately not used

- **Turborepo or Nx.** No build step means nothing to cache or order.
- **pnpm, npm or Yarn workspaces.** Bun is already the runtime and package manager.
- **TypeScript project references, `tsc -b`, `composite`.** They pay off only with emitted
  `.d.ts` files.
- **A package build step** (tsup, tsdown, `bun build`, `dist/`).
- **Changesets or publishing.** Every package is `private`.
- **The hoisted linker.** It lets a package silently borrow the root's dependencies.
- **tsconfig `paths` aliases.** Resolution goes through real package `exports`, so every tool
  agrees.
- **An index or barrel per package.**
- **Vitest `projects` spanning packages from the root.** Each package owns its lane.
- **Lerna and Rush.**

### Other phase 0 decisions

- **Schema identifiers never change when a schema moves.** Decode messages and error names carry
  them, and Sentry groups on the name.
- **`@oligarchy/routes/errors` is imported as `ApiErrors`,** so it never shadows the domain
  `Errors`.
- **`./client` and `./driver` scan `packages/` too** when deciding to rebuild their bundle.
- **CI fix.** `src/viz/screen.tsx` uses the named `View.ScreenImage` type, fixing three `TS2339`
  errors that were already failing on `master`.
- **Tests removed on request:** `test/repo/wrangler.unit.test.ts`, the scripts case that pinned
  `bun run dev` to wrangler, and `test/harness/config.unit.test.ts` (`oligarchy.json`).
