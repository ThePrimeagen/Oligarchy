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
  `external-failure.ts`, and `steps.ts`.
- **`linear` moves up** a layer and takes `openRun`, the workflow that turns test definitions into
  a run and its tickets. `ctrl` and the dashboard call the same function.
- **The dashboard is the fifth app.** It stops importing `ctrl` and `viz`.
- **`integration-testing` holds system tests only** (the Postgres container, spawned processes)
  and is created last. A test that needs only the real OS lives in its owner's own lane.
- **A cycle watch** lists every pair of packages that could plausibly cycle and the rule that
  prevents each, so the architecture test has something to check against.

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
5       http            contract, API errors, middleware, serve, clients
5       fleet           host and process stats, member announce loop, stale-server sweep
4       observability   Sentry, instrument, dsn, the row-writing Log layer
4       linear          Linear API client, ticket templates, openRun
3       db              Postgres client, stores, schema, migrations
2       env             variables, env files, oligarchy.json, flags, entry runner, colour detection
1       log             the Log service and stdout layer, failure text, log-line text, palette
0       shared          domain ids, vocabularies, domain errors, steps
```

A package depends only on packages in a lower layer. Two packages on the same layer never depend
on each other. Nothing depends on an app, with one dev-only exception (open decision 9). The
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
| `fleet` | `effect`, `db`, `log`, `shared` (dev: `@effect/platform-node` for its integration test) |
| `http` | `effect`, `@effect/platform-node`, `env`, `log`, `shared` |
| an app | any package; never another app, never the root's `src/` |
| `integration-testing` | any package; the dashboard's Worker entry (open decision 9); dev only |

## Principles

- **One-way dependencies, never two-way.** A lint rule catches file cycles and a repo test
  catches package cycles and layer violations (see "Enforcing one-way dependencies"). The pairs
  most likely to cycle are listed in "Cycle watch" with the rule that keeps each one-way.
- **Coarse packages by category, named for what they do.** A package is named for the
  processing it does (`db`, `http`, `fleet`, `log`), never for where the dependency arrows happen
  to allow the code to sit. When a module's only reason to be in a package is "it may depend on
  that from here", the package is wrong.
- **Every package has an admission rule** (in its design below): what it takes, and what it
  refuses even when the dependency graph would allow it. `shared` has the strictest one, because
  a package called "shared" is the one that becomes "everything goes here".
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
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: the workspace package graph has no
      cycle. Happy: the real graph. Unhappy: a made-up graph `a -> b -> a` is named with its
      loop.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: every package depends only on packages
      in a lower layer of the declared layer list. Happy: the real graph. Unhappy: a made-up
      upward edge, a same-layer edge and a package missing from the list are each named.
- [ ] TEST (alter) `test/dig/lobby.unit.test.ts` and `test/dig/room.unit.test.ts`: take the
      `Room` type from `dig/domain.ts` wherever they name it.

**Phase 2: `@oligarchy/shared`**

- [ ] TEST (move) `test/shared/domain.unit.test.ts` and `test/shared/errors.unit.test.ts` to
      `packages/shared/test/`.
- [ ] TEST (move) `test/external-failure.unit.test.ts` to `packages/shared/test/`.
- [ ] TEST (move) `test/viz/steps.unit.test.ts` to `packages/shared/test/steps.unit.test.ts`,
      keeping its cases. Happy: the steps of an instruction and the place of the last matched
      message. Unhappy: an instruction with no steps, and a message matching none, if either case
      is missing.
- [ ] TEST (move) the vocabulary cases that move down (at least `SessionMode` and `ServerUrl`)
      from `packages/routes/test/contract.unit.test.ts` to `packages/shared/test/`. The
      contract test keeps one case per moved vocabulary proving a body with a bad value is still
      refused with the same message.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: shared imports only `effect` and its own
      files. Unhappy: a Node, platform or `@oligarchy/*` import inside shared is named.
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
- [ ] TEST (new) `packages/log/test/log.unit.test.ts`: `Log.make(sink)` hands every line to the
      sink in call order and `flush` waits for the sink's flush. Unhappy: the stdout layer offers
      to no sink and its `flush` is immediate.
- [ ] TEST (move) `test/observability/render.unit.test.ts` to
      `packages/log/test/render.unit.test.ts`, all but the `wantsColor` describe (phase 4).
- [ ] TEST (move) `test/observability/palette.unit.test.ts` to `packages/log/test/`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: log imports only `effect`,
      `@oligarchy/shared` and its own files. Unhappy: `node:tty`, a `process.*` read, a platform,
      `db` or `observability` import inside log is named.
- [ ] TEST (alter) `test/support/log.ts` and every test that fakes `Log`: import from
      `@oligarchy/log`. A test that only needs a logger and asserts no lines provides
      `Log.layerStdout` instead of a fake.

**Phase 4: `@oligarchy/env`**

- [ ] TEST (move) `test/config/config.unit.test.ts` to `packages/env/test/config.unit.test.ts`,
      with the same assertions: the provider order, `--env-file` last one wins, `--` stops the
      scan, `<NAME> is not set`, and `ProxyConfig`.
- [ ] TEST (new) `packages/env/test/run.unit.test.ts`: a successful command exits 0 and runs its
      teardown. A failing command prints one headline and the cause, with no stack, and exits
      nonzero. A `CliError` prints nothing more. `--version` prints the version passed in. The
      Wizard is not offered. The runner provides `Log.Colors` from stdout: on for a TTY with 16
      colours, off for a pipe.
- [ ] TEST (move) the `wantsColor` describe from the render test to
      `packages/env/test/colors.unit.test.ts`.
- [ ] TEST (move) the `--port`, `--name`, `--url` and `--max-jobs` cases from
      `test/qemu-server/command.unit.test.ts` and `test/automation-client/command.unit.test.ts`
      to `packages/env/test/flags.unit.test.ts`. Happy: an omitted `--port` is the default.
      Unhappy: a non-integer port, a bad name, a non-URL url and `--max-jobs 0` are refused.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: env imports only `effect`,
      `@effect/platform-node`, `@oligarchy/log`, `@oligarchy/shared` and its own files.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the driver wrapper defines `import.meta.url`
      as the `oligarchy.json` loader's new path.
- [ ] TEST (move) `test/cli.unit.test.ts` to `test/automation-client/child.unit.test.ts`,
      following `src/cli.ts` to `src/automation-client/child.ts`.

No test covers the `oligarchy.json` loader or the file's contents (standing decision).

**Phase 5: `@oligarchy/db`**

- [ ] TEST (move) `test/db/client.unit.test.ts` and `test/db/migrate.unit.test.ts` to
      `packages/db/test/`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: db imports only `effect`, `drizzle-orm`,
      `pg`, `@oligarchy/env`, `@oligarchy/log`, `@oligarchy/shared` and its own files. Unhappy:
      an `observability` or `linear` import inside db is named.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: `db:migrate`, `prod:db:migrate` and
      `test:db:migrate` run the package's migrate program, each still from its own env file.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the migrations workflow scans the
      migrations where they live, if `drizzle/` moves (open decision 4).
- [ ] TEST (alter) `test/support/stores.ts` and every test importing a store type: import from
      `@oligarchy/db`.

`test/integration/db.integration.test.ts` and `test-database.integration.test.ts` need the
container and stay in the root's integration project until phase 11.

**Phase 6: `@oligarchy/observability`**

- [ ] TEST (move) the `Log rows` describe of `test/observability/log.unit.test.ts` to
      `packages/observability/test/log.unit.test.ts`, on `LogLive` with an inline `LogStore`
      fake. Happy: rows land in call order and `flush` waits for every insert. Unhappy: a failed
      insert writes `db: log insert failed: <detail>` and reports it, and the rows behind it still
      land; an interrupt mid-drain is not reported.
- [ ] TEST (move) `test/observability/sentry.unit.test.ts` to `packages/observability/test/`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: observability imports only `effect`,
      Sentry, `@oligarchy/db`, `@oligarchy/log`, `@oligarchy/shared` and its own files.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the instrumented processes preload the
      package's `instrument.ts`, in the package scripts and the wrappers.

**Phase 7: `@oligarchy/linear`**

- [ ] TEST (move) `test/ctrl/linear.unit.test.ts` and `test/ctrl/prompts.unit.test.ts` to
      `packages/linear/test/`.
- [ ] TEST (move) the `test run` and `testsuite` cases of `test/ctrl/command.unit.test.ts` that
      exercise `openRun` to `packages/linear/test/run.unit.test.ts`. Happy: `testsuite` opens one
      run per definition but mint, each in its newest wording, with one ticket each; `--name`
      opens one. Unhappy: a ticket that fails rolls the run back and fails; an unknown name is
      refused. The ctrl command test keeps one case per command proving it calls `openRun` with
      its flags.
- [ ] TEST (move) the abort cases of `test/dashboard/dashboard.unit.test.ts` that exercise the
      dashboard's own Linear client to `packages/linear/test/client.unit.test.ts` as `abort`.
      Happy: the ticket moves to Aborted. Unhappy: an unknown ticket and an API refusal are each
      a `LinearError`. The dashboard test keeps one case proving `POST /abort` calls it.
- [ ] TEST (alter) `test/dashboard/suite.unit.test.ts`: `createTestSuiteRun` calls `openRun`
      with the bundled templates as its file system, and no longer runs `ctrl`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: linear imports only `effect`,
      `@oligarchy/db`, `@oligarchy/env`, `@oligarchy/log`, `@oligarchy/shared` and its own
      files.

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
      lane.
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
      count). Its `onJoin` removes this url's setup requests: happy, the rows go and
      `setup cleared; <url>; <n>` is logged; unhappy, a failing removal is retried next tick. A
      failing process read is `PsFailed`, not `CliFailed`.
- [ ] TEST (alter) `test/automation-client/heartbeat.unit.test.ts`: one case that
      automation-client announces its own `Member` (type `automation-client`, its attribution,
      `qemus: 0`) and has no `onJoin`. A failing process read is `PsFailed`.
- [ ] TEST (alter) `test/qemu-server/sessions.unit.test.ts`: `sessions.stats` is the machine
      count plus the sampler's values (`test/support/fake-qemu.ts` fake stats return plain
      values).
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: fleet imports only `effect`,
      `@oligarchy/db`, `@oligarchy/log`, `@oligarchy/shared` and its own files, and its tests
      import nothing outside the package. Unhappy: an `http` or app import inside fleet is named.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: a package may add a `test:integration` lane
      on Bun, and the root `test:integration` runs the root's lane, then every package's.
      Unhappy: a package integration lane off Bun is named.

**Phase 9: `@oligarchy/http`**

- [ ] TEST (alter) every test importing `@oligarchy/routes/*` imports `@oligarchy/http/*`,
      keeping the `Api`, `Contract` and `ApiErrors` aliases.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: `api`, `contract` and `errors` import
      only `effect` and `@oligarchy/shared`. Unhappy: a Node, platform or `log` import there is
      named.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: the rest of http imports only `effect`,
      `@effect/platform-node`, `@oligarchy/env`, `@oligarchy/log`, `@oligarchy/shared` and its
      own files. Unhappy: a `db`, `observability` or `fleet` import inside http is named.
- [ ] TEST (move) the bearer-auth and boundary middleware cases, which live in the apps' HTTP
      tests today (`test/qemu-server/http.unit.test.ts` and the others), to
      `packages/http/test/middleware.unit.test.ts`. Each app keeps one case proving the
      middleware is wired in.
- [ ] TEST (move) `test/client/proxy-client.unit.test.ts` to `packages/http/test/`.
- [ ] TEST (move) `test/automation-server/client.unit.test.ts` to `packages/http/test/`.
- [ ] TEST (new) `packages/http/test/serve.unit.test.ts`: a server listens and serves its
      routes. A port already in use fails with `ServeError`. A later server error ends the
      program once, with one fatal line.
- [ ] TEST (alter) `test/integration/client.integration.test.ts`: the bundle rebuilds when an
      http-package source is newer.

**Phase 10: the five apps**

- [ ] TEST (move) qemu-server's unit tests (`test/qemu-server/`, `test/qemu/`, `test/qmp/`) to
      `apps/qemu-server/test/`.
- [ ] TEST (move) automation-client's unit tests to `apps/automation-client/test/`.
- [ ] TEST (move) automation-server's unit tests to `apps/automation-server/test/`.
- [ ] TEST (move) qemu-reverse-proxy's unit tests to `apps/qemu-reverse-proxy/test/`.
- [ ] TEST (move) `test/dashboard/*.unit.test.ts` to `apps/dashboard/test/`.
- [ ] TEST (alter) `apps/dashboard/test/follow.unit.test.ts`: takes `stepsOf` and `placeOf` from
      `@oligarchy/shared/steps`.
- [ ] TEST (move) `test/integration/qemu-process.integration.test.ts` and
      `qmp-socket.integration.test.ts` to `apps/qemu-server/test/`, under the app's own
      `test:integration` lane (they need the qemu binary and a socket, not a container).
- [ ] TEST (alter) each moved test file: shared fakes become inline fakes of the methods it uses,
      or a helper in its own app's `test/` folder (open decision 5).
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
      `scheduled`) from `@oligarchy/dashboard` (open decision 9).
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
- [ ] Add the layer list to `test/repo/architecture.unit.test.ts`, starting with `routes`.
- [ ] `development.md`: document the no-cycle rule and the layer list.

**Phase 2: `@oligarchy/shared`**

- [ ] Create `packages/shared` with `domain.ts`, `errors.ts` (domain errors only),
      `external-failure.ts` and `steps.ts` (from `src/viz/steps.ts`).
- [ ] Move the vocabularies domain code also uses from the routes contract into shared. The
      contract imports them. Schema identifiers stay unchanged.
- [ ] Re-point every import of `src/shared/*`, `src/external-failure.ts` and `src/viz/steps.ts`
      (`viz/view.ts`, `viz/follow.ts`, `driver/loop.ts`, `dashboard/follow.tsx`).

**Phase 3: `@oligarchy/log`**

- [ ] Create `packages/log` with `log.ts` (the `Log` service, `LogService`, `Attribution`,
      `Report`, `Locations`, `ProcessAttribution`, `Colors`, the `Sink` type, `Log.make(sink)`,
      `Log.layerStdout`), `render.ts` (failure text and log-line text; `wantsColor` and the
      stdout probe go to env) and `palette.ts`. `LogLine` (the Sentry wrapper) moves here from
      `shared/errors.ts`, identifier unchanged.
- [ ] `Colors` defaults to off. The stdout probe that set it moves to env's runner (phase 4); in
      between, the ten `main.ts` files provide it.
- [ ] Re-point every import of `observability/log.ts`, `render.ts` and `palette.ts` that is not
      the row-writing layer.

**Phase 4: `@oligarchy/env`**

- [ ] Create `packages/env` with `config.ts`, `env-file.ts`, `oligarchy.ts` (from
      `src/harness/config.ts`), `run.ts`, `flags.ts` and `colors.ts` (`wantsColor` and the
      stdout probe).
- [ ] Switch all ten `main.ts` files to the runner, and the four servers to the shared flags.
- [ ] Update the driver wrapper's `--define` for the loader's new path.
- [ ] Move `src/cli.ts` to `src/automation-client/child.ts`.
- [ ] `development.md`: the Config section's paths and the runner.

**Phase 5: `@oligarchy/db`**

- [ ] Create `packages/db` from `src/db/*`, with `DatabaseError`.
- [ ] Move `drizzle/` and `drizzle.config.ts`, and update the CI workflow paths in the same
      change (if open decision 4 is accepted).
- [ ] Update the migrate scripts and the dashboard's schema import.

**Phase 6: `@oligarchy/observability`**

- [ ] Create `packages/observability` with `sentry.ts`, `instrument.ts`, `dsn.ts` and `log.ts`
      holding `LogLive`: the queued row sink (`makeSink`) over `LogStore.insertLog`, given to
      `Log.make`.
- [ ] The five `main.ts` files that build the row-writing log use `Observability.LogLive` where
      they used `Log.Log.layer`.
- [ ] Update every `--preload` path and the dashboard's `dsn` import.

**Phase 7: `@oligarchy/linear`**

- [ ] Create `packages/linear` from `src/ctrl/linear.ts` and `src/ctrl/prompts.ts`, with
      `LinearError` and `PromptError`, plus `run.ts` holding `openRun` lifted out of
      `src/ctrl/command.ts`, and `abort` folded into the client from `src/dashboard/linear.ts`.
- [ ] `ctrl` calls `Linear.openRun`; the dashboard's `suite.ts` calls it with its bundled
      templates as the file system and drops the in-process `ctrl` run; `POST /abort` calls the
      client. Delete `src/dashboard/linear.ts`.

**Phase 8: `@oligarchy/fleet`**

- [ ] Create `packages/fleet` with `host.ts` (from `src/qemu/stats.ts`), `process.ts` (from
      `src/shared/process-usage.ts`), `member.ts` (the template, from the two `heartbeat.ts`)
      and `sweep.ts` (from `src/shared/stale-servers.ts`). The `detail` helper that unwraps a
      `DatabaseError`'s cause, copied in all three source files today, is written once.
- [ ] Host: drop `qemus`, return `{ memory, cpu }`, keep today's log line for a skipped reading.
- [ ] Give the process reader `PsFailed` and the listing seam.
- [ ] qemu-server and automation-client each define their `Member` and call `Fleet.announce`;
      the proxy and automation-server call `Fleet.forget`. Delete both `heartbeat.ts` files and
      `stale-servers.ts`. The apps build `Contract.Stats` from the values plus the machine count.
- [ ] Add fleet's `test:integration` lane and the `--workspaces` fan-out for it.
- [ ] Add `@effect/vitest` to the catalog.
- [ ] Update the architecture boundary-file list for the new paths.
- [ ] `development.md`: the unit-test rule, per-package integration lanes and the fleet template.

**Phase 9: `@oligarchy/http`**

- [ ] Rename `packages/routes` to `packages/http` (`@oligarchy/http`).
- [ ] Move in the middleware, `NotFoundRoute`, the proxy client and the automation-server
      client. Add `serve`.
- [ ] Remove the hand-rolled listen code from the four servers.
- [ ] Run `wrangler deploy --dry-run` as a build check (not a test).

**Phase 10: the five apps**

- [ ] Add `apps/*` to the root workspaces.
- [ ] Move each server into `apps/<name>/`: qemu-server takes `src/qemu/` and `src/qmp/`, and
      automation-client takes `child.ts`.
- [ ] Move the dashboard into `apps/dashboard/` with `wrangler.jsonc`, the `dev` script, the text
      module rules (paths to `client.md`, `ctrl-linear.md` and `prompts/*.html` become
      `../../../`), its own tsconfig with `jsxImportSource: hono/jsx`, and `query.ts` as its read
      model. Drop `jsxImportSource` from the root tsconfig.
- [ ] Give the dashboard an `exports` entry for its Worker entry, if open decision 9 is accepted.
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

### Package cycles and layer order: a repo test

The lint rule is not enough on its own:

- A package cycle need not contain a file loop. If `a/one.ts` imports `b/one.ts` and `b/two.ts`
  imports `a/two.ts`, the packages depend on each other and oxlint passes. Verified in a scratch
  workspace.
- Bun installs two workspace packages that depend on each other without complaint, with the
  isolated linker too. Verified.
- A lint rule sees one file at a time. The package graph lives in the `package.json` files.

So `test/repo/architecture.unit.test.ts`, where the repo already enforces its architecture, gains:

- **A declared layer list.** Every package must appear in it.
- **An edge check.** A package's `dependencies` may name only packages in a lower layer.
- **A cycle check,** which names the loop, so the message is clear even before the layer list is
  consulted.

Already enforced, with nothing to add:

- **The isolated linker.** An import of a package that is not declared fails to resolve, in `tsc`
  and at runtime.
- **The existing workspace-import test.** Code reaches a package only through its `exports`,
  never by a relative path into `packages/`.

### Cycle watch

The pairs that would cycle if a module landed in the wrong place, and the rule that keeps each
one-way. The edge check catches a slip; this table says where the slip would come from.

| Pair | Direction | What would close the loop | Rule |
|---|---|---|---|
| `shared` ↔ `http` | contract imports shared | `domain.ts` importing `Contract.SessionMode` (it does today) | every vocabulary domain code uses lives in shared; the contract imports it |
| `log` ↔ `db` | db imports log (failure text) | the row-writing layer in log | the row sink lives in `observability`; log knows a `Sink`, never a store |
| `log` ↔ `env` | env imports log (`reportFailure`, `Colors`) | the stdout colour probe in log | `wantsColor` and `process.stdout` live in env; `Colors` defaults to off |
| `log` ↔ `observability` | observability imports log | Sentry reporting inside log | log reports through Effect's `ErrorReporter.CurrentErrorReporters`; Sentry installs a reporter, log never names Sentry |
| `db` ↔ `observability` | observability imports db (rows) | `db/client.ts` importing `Render` from observability (it does today) | failure text is in log; `db/client.ts` keeps `Effect.logError`, because a pool error routed through the row-writing log would try to insert through the failing pool |
| `db` ↔ `linear` | linear imports db (`openRun` reads `TestStore`) | a store that files a ticket | db stores never call out; a workflow that spans both lives in linear |
| `fleet` ↔ `http` | none | the wire `Stats` schema in fleet, or the announce loop in http | fleet returns values; the apps build `Contract.Stats`; http has no clock and no store |
| `env` ↔ `http` | http imports env (`ProxyConfig`) | `Api.VERSION` in the runner | the version is passed to `Env.run` |
| `env` ↔ `shared` | env imports shared | a flag schema in shared | flags live in env; shared holds the vocabulary a flag decodes to |
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

The vocabulary every process speaks. About 700 lines.

- **Holds** `domain.ts` (ids, `LogLevel`, session and server vocabularies), `errors.ts` (the
  domain errors used everywhere, `CommandError` for one), `external-failure.ts`, and `steps.ts`
  (the steps of a test instruction and where a message sits in them; used by `viz`, `driver` and
  the dashboard).
- **Takes back** from the routes contract the vocabularies domain code also uses: at least
  `SessionMode`, which `domain.ts` imports from routes today (an upward edge), and `ServerUrl`,
  which env needs. Vocabularies only the wire uses stay in the contract. Schema identifiers are
  unchanged.
- **Depends on** `effect` only.
- **Admission rule.** A module enters shared only if it imports nothing but `effect` and shared,
  and it is a *value*: a schema, an id, an error class, a pure function over those. Refused: a
  service with a clock or a loop, anything that reads the OS or `process.*`, anything that names
  a store, and anything with a single consumer. If it fails the rule, it belongs in the package
  that does the processing. `process-usage.ts` and `stale-servers.ts` fail it (fleet); the `Log`
  service fails it (log).

Each other error moves with the package that raises it:

| Error | Home |
|---|---|
| `MissingVariable` | env |
| `LogLine` (identifier `@oligarchy/observability/log/LogLine`, unchanged) | log |
| `DatabaseError` | db |
| `LinearError`, `PromptError` | linear |
| `PsFailed` (new) | fleet |
| `ProxyRefusal`, `ProxyUnreachable` | http |
| `QmpError`, `QmpTimeout`, `QmpClosed`, `QmpProtocolError`, `QemuStartError`, `HostRequirementsMissing`, `IsoError`, `KeysError` | qemu-server |
| `AutomationClientError`, `JobNotFound` | automation-server |
| `CliFailed` | automation-client (its child runner) |
| `SuiteRequestError` | dashboard |
| `HistoryError`, `ToolError`, `OpenRouterRefusal`, `OpenRouterUnreachable` | driver (root) |
| `PngDecodeError` | session (root) |

No code raises `ChildExit`; only its own test names it, so it is a candidate for deletion.

### `@oligarchy/log` (layer 1, phase 3)

How a line and a failure read as text, and the service they are written through. About 430
lines. Every package above it may take `Log`; none has to.

- **Holds** `log.ts`: the `Log` tag and `LogService`, `Attribution`, `Report`, `Locations`,
  `ProcessAttribution`, `Colors`, the `Sink` type (`offer(row)`, `flush`), `Log.make(sink)` and
  `Log.layerStdout`. Reporting to Sentry already goes through Effect's
  `ErrorReporter.CurrentErrorReporters`, so the service names no Sentry module. `render.ts`:
  `errorDetail`, `headline`, `renderFailure`, `reportFailure`, the `LogLine` text type,
  `logPieces`, `renderLogLine`, `paint`, `foreground` and the Rose Pine constants. `palette.ts`:
  the agent colour palette.
- **Does not hold** the row sink (observability), or `wantsColor` and the `process.stdout` probe
  (env). `Colors` defaults to off; the runner provides it. So log has no boundary file.
- **Depends on** `shared` (`LogLevel`, `ExternalFailure`).
- **Why failure text is here and not in shared.** `errorDetail`, `headline` and `renderFailure`
  are used by 39 files in every layer, and not only for log lines: `harness/config.ts` builds a
  `CommandError` message from `headline`, `db/migrate.ts` prints `renderFailure`, every `main.ts`
  prints `reportFailure` before a `Log` exists. They are "how a failure reads", which is this
  package's subject. Shared's admission rule refuses them as text formatting rather than
  vocabulary, and putting them in shared was the first step toward shared becoming everything.
- **Admission rule.** Text of a line or a failure, and the service that writes a line. Refused:
  any destination (a store, a file, Sentry), any reading of the terminal or the environment.

### `@oligarchy/env` (layer 2, phase 4)

**Why "env".** "cli" would be wrong for two reasons. Each app's commands stay in the app. And
`src/cli.ts` is not CLI handling at all: it is automation-client's child-process runner. Config
and CLI also cannot be split without a two-way edge, because flags fall back to config values,
and the config reader must find `--env-file` in the raw arguments before the CLI parses them.
The category is process startup: what a process reads, parses and installs before its command
runs.

**Holds:**

- **Environment variables:** the lookup order (process environment, then the `--env-file` file,
  then `.env`), `required`, `requiredRedacted`, `MissingVariable`, the named accessors,
  `ProxyConfig`, `DEFAULT_SERVER_URL` and `DEFAULT_LINEAR_API_URL`.
- **The `--env-file` global flag** and `withEnvFile`.
- **`oligarchy.json`:** the schema and the loader. The file stays at the repo root, so the
  loader's path becomes `../../../oligarchy.json`, and the driver wrapper's `--define` for
  `import.meta.url` must point at the new file.
- **The entry runner, `Env.run(command, { version, teardown })`.** It replaces what all ten
  `main.ts` files repeat:
  - install the config lookup;
  - set up CLI output and CLI config without the Wizard;
  - provide `Log.Colors` from `wantsColor(process.stdout, process.env)`;
  - `Command.run` with the version;
  - `reportFailure`;
  - `NodeRuntime.runMain` with error reporting off;
  - in the servers, the stdout/stderr error listeners and a teardown.

  The version is passed in, so env never reaches up to http's `Api.VERSION`.
- **Shared flags:** `port(defaultPort)` for all four servers, and `--name`, `--url` and
  `--max-jobs`, which qemu-server and automation-client define identically except for one word of
  help text.
- **Colour detection:** `wantsColor` and the stdout probe, the two lines of `render.ts` that read
  Node. `colors.ts` is a boundary file.

**Does not hold:**

- Failure text (log).
- The HTTP listen code, which becomes http's `serve`.
- `src/cli.ts`, which moves into automation-client as `child.ts`.
- qemu-server's own flags (`--display`, `--data-dir`, `--automation`).

**Depends on** `log` (`reportFailure`, `Colors`), `shared` (`ModelId`, `ServerName`, `MaxJobs`,
`ServerUrl`) and `@effect/platform-node` (`NodeRuntime`).

**Admission rule.** Something every process does before its command runs. Refused: anything a
command does while running.

### `@oligarchy/db` (layer 3, phase 5)

- **Holds** `src/db/*`: the client, migrate, every store and the schema, plus `DatabaseError`.
- **Depends on** env, log, shared, `drizzle-orm` and `pg`.
- **The old loop breaks here.** `db/client.ts` and `db/migrate.ts` used only the failure text from
  `observability/render.ts`, which is in log now. So db no longer imports observability, while
  observability's row-writing log still writes through db.
- **It takes no `Log`.** `db/client.ts` keeps `Effect.logError` for pool errors, on purpose: a
  pool failure routed through the row-writing `Log` would try to insert a row through the
  failing pool. `db/client.ts` stays a boundary file, and the one place `Effect.log*`,
  `runForkWith` and `runPromiseExitWith` are allowed.
- **The dashboard** imports `@oligarchy/db/schema`.
- **Admission rule.** A store reads and writes rows and returns them. Refused: a loop, a clock, a
  call to another system, a log line.

### `@oligarchy/linear` (layer 4, phase 7)

Everything whose output is a Linear ticket.

- **Holds** `client.ts` (`src/ctrl/linear.ts`, the API client, plus `abort` folded in from the
  dashboard's hand-rolled `src/dashboard/linear.ts`), `prompts.ts` (the ticket templates, read
  from `prompts/*.html`), and `run.ts`: `openRun`, lifted from `src/ctrl/command.ts`. `openRun`
  reads the definitions from `TestStore`, creates the run and its experiment tests, files one
  ticket each from the templates, and rolls back on a ticket failure.
- **Used by** automation-server, qemu-reverse-proxy, ctrl and the dashboard. `ctrl test run`
  and `POST /create-test-suite-run` call the same `openRun`; the dashboard stops embedding a CLI
  run with a recording console.
- **Depends on** db (`TestStore`), env (`DEFAULT_LINEAR_API_URL`, `linearAccess`), log and
  shared. It is on layer 4 because of `openRun`; the client alone would sit on layer 3.
- **Admission rule.** The client, the templates, and a workflow whose result is a ticket.
  Refused: a workflow whose result is a row or a session; those belong to the app that owns them.

### `@oligarchy/observability` (layer 4, phase 6)

Where lines and failures go once written.

- **Holds** `sentry.ts`, `instrument.ts`, `dsn.ts`, and `log.ts` holding `LogLive`: the queued
  row sink (`makeSink` over `LogStore.insertLog`, one drain fiber, in-order inserts, a flush
  marker, `db: log insert failed` on a refused row) given to `Log.make`.
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
  from fleet's values plus their machine count.
- **The sampler keeps its own clock.** It samples every five seconds into a 60-sample window. The
  one, two and three minute means count samples, so the clock has to stay inside the package.
- **`collect` returns `{ memory, cpu }`.** The `qemus` argument goes. qemu-server adds its
  machine count; automation-client stops passing `0`.
- **A skipped reading is one line.** A reading that throws is skipped, the next good reading is
  compared with the last good one, and the sampler logs today's exact line,
  `failed to sample cpu usage: <detail>`, with the thrown value as the cause. The first version of
  this plan published a `failures` stream for the apps to log instead; it existed only because
  the sampler was not allowed a `Log`. It is not needed.
- **The process reader already returns values.** Its error becomes fleet's own `PsFailed`,
  instead of the shared `CliFailed`. The `ps` seam narrows: the reader takes "list the
  processes" as a value, so its unit tests pass a string. The real listing keeps the ten-second
  timeout and the SIGTERM, then SIGKILL a second later.
- **Service keys follow the package:** `@oligarchy/fleet/Host`, `@oligarchy/fleet/ProcessUsage`.
  Service keys are not schema identifiers, so renaming them changes no message.
- **`host.ts` and `process.ts` stay boundary files.** They read `node:os` and `process.*`, so the
  architecture test's boundary list follows their new paths.
- **Admission rule.** Measuring this host or process, and the fleet's membership rows. Refused:
  HTTP, sessions, jobs, anything about what a member *does*.

#### The member template

Read from the four `main.ts` files. Three lifecycles stack:

- **Process** (all ten entries): stdout/stderr error listeners, build the graph and print a
  failure before a `Log` exists, `Command.run`, defects to `reportFailure`, `runMain` with a
  teardown. This is `Env.run`.
- **Server** (the four servers): `createServer`, the first-error `Deferred`, listen with the
  logger and listen log off, `TracerDisabledWhen`, then in the same scope log "listening" and
  start background work. This is http's `serve`.
- **Fleet:** qemu-server and automation-client are *members*; the proxy and automation-server
  are *readers*.

| | qemu-server | automation-client | qemu-reverse-proxy | automation-server |
|---|---|---|---|---|
| role | member | member | reader | reader |
| joins as | `qemu` if `--url` | `automation-client` if `--url` | — | — |
| each tick (30 s) | servers row, process_stats row | servers row, process_stats row | — | — |
| once on join | remove this url's stale setup requests, retried each tick until it lands | — | — | — |
| on leave | delete the servers row | delete the servers row | — | — |
| sweeps | — | — | `forget("qemu")` | `forget("automation-client")` |

Everything in the member column that is not named in a cell is identical in both files today:
30-second `Schedule.spaced`, `forkScoped` with `startImmediately`, every write uninterruptible,
every failure one `log.error("<what> failed: <detail>")` and the next tick runs, the finalizer
registered before the fork. The reader column has no hooks; `forget(type)` already is the
template.

```ts
// @oligarchy/fleet/member
export type Member<R> = {
  readonly type: Servers.ServerType;        // "qemu" | "automation-client"
  readonly url: string;
  readonly name: string;
  readonly attribution: Log.Attribution;    // where this member's lines land

  // Each tick: what only this member knows. The template adds host memory and cpu from
  // the sampler and this process's RSS and cpu from the reader, and writes both rows.
  readonly report: Effect.Effect<{ readonly qemus: number; readonly jobs: number }, unknown, R>;

  // Once on joining, retried each tick until it succeeds: reclaim what a previous
  // incarnation under this url left behind. qemu-server removes its stale setup requests.
  readonly onJoin?: Effect.Effect<void, unknown, R>;

  // Before the servers row is deleted on shutdown. No member needs it today.
  readonly onLeave?: Effect.Effect<void, unknown, R>;
};

export const announce: <R>(member: Member<R>) =>
  Effect.Effect<void, never, R | Scope.Scope | Host | ProcessUsage | ServerStore | ProcessStatsStore | Log>;

// @oligarchy/fleet/sweep
export const forget: (type: Servers.ServerType) =>
  Effect.Effect<void, never, Scope.Scope | ServerStore | Log>;
```

Deliberately not hooks: a per-tick "extra work" hook (nothing needs one; qemu-server's setup
clear is once-until-success, which is `onJoin`), the interval (the dashboard's "silent after
three misses" and the sweep's ten minutes both derive from the 30 seconds, one constant in
fleet), and the failure policy (one line, keep going, which is the template's point). Session
drain and exit codes are process lifecycle and stay in each app's `main.ts`.

### `@oligarchy/http` (layer 5, phase 9)

One solid HTTP package that makes the right thing easy: one way to serve, one way to call another
server, one set of API errors.

- **`@oligarchy/routes` becomes `@oligarchy/http`.** `api`, `contract` and `errors` keep their
  shape and their consumer aliases (`Api`, `Contract`, `ApiErrors`).
- **It takes in what the apps share today:**
  - the middleware in `qemu-server/middleware.ts` (`BearerAuthLive`, `bearerAuth`,
    `ApiBoundaryLive`, `RouteBoundaryLive`, `layerClient`), used by automation-client,
    automation-server and the proxy;
  - `NotFoundRoute` from `qemu-server/handlers.ts`, used by the same three;
  - the proxy client from `client/proxy-client.ts` (with `ProxyRefusal` and `ProxyUnreachable`),
    used by automation-client, the proxy and the client script;
  - the automation-server client from `automation-server/client.ts`;
  - `serve`, the listen code every server writes by hand today (`createServer`, the first-error
    `Deferred`, `HttpRouter.serve` with the logger and listen log off, `NodeHttpServer.layer`,
    `TracerDisabledWhen`, and racing the launch against the server failing).
- **It does not take** the announce loop or the stale-server sweep. Neither imports any HTTP;
  both are stores, stats and the log, and are in fleet. The first version of this plan had them
  here because http was the one layer-4 package allowed to see db and stats, which is the
  dependency-driven placement the principles refuse.
- **The pure contract.** `api`, `contract` and `errors` import only `effect` and
  `@oligarchy/shared`. The reason is not the dashboard Worker, which already bundles Node code
  under `nodejs_compat`. It is that the contract is what every client bundles (`./client`'s
  bundle, the dashboard, `shared` before phase 2) and what keeps `shared` and the contract from
  cycling. A per-file rule in the architecture test keeps it pure inside an otherwise Node
  package.
- **Depends on** env (`ProxyConfig`), log (the boundaries' `Log`, failure text), shared and
  `@effect/platform-node`. Not on db, observability or fleet.
- **Admission rule.** How we speak HTTP: the contract, serving it, calling it, guarding it.
  Refused: anything with a store or a clock.

### The five apps (layer 6, phase 10)

Each app moves to `apps/<name>/`, with its own `package.json`, `src/`, `test/` and
`vitest.config.ts`. The root workspaces gain `apps/*`.

- **qemu-server** also takes `src/qemu/` and `src/qmp/`. Once the sampler moves, nothing else
  uses them. Its integration tests for the qemu binary and the QMP socket live in its own
  `test:integration` lane.
- **automation-client** also takes `child.ts` (was `src/cli.ts`).
- **automation-server** and **qemu-reverse-proxy** take their own directories. Their imports of
  other apps (`ctrl/linear.ts`, `qemu-server/middleware.ts`, `qemu-server/handlers.ts`,
  `client/proxy-client.ts`, `shared/stale-servers.ts`) are gone by then, into linear, http and
  fleet.
- **dashboard** is the Cloudflare Worker: `dashboard.tsx`, the pages, `query.ts` (its read model
  over the schema on a Hyperdrive client per request; dashboard-specific processing, so it stays
  in the app), `clicker.ts`, `htmx.ts`, `suite.ts` (now a thin call to `Linear.openRun` with the
  bundled templates as its file system), `ticket.ts`, `wrangler.jsonc`, the text-module rules and
  the `dev` script. It imports db (`schema`), observability (`dsn`), http (`api`, `contract`,
  `errors`), linear (the client, `openRun`) and shared (`steps`). What it imported from the root
  today is gone: `ctrl/command.ts` (was run in-process as a CLI) into linear's `openRun`,
  `viz/steps.ts` into shared, and its hand-rolled Linear client into linear. Its `.tsx` files
  use `hono/jsx` under the app's own tsconfig, so the root tsconfig drops `jsxImportSource` and
  the "every `.tsx` outside the dashboard carries the `@opentui/solid` pragma" rule loses its
  exception.

The wrappers (`./qemu-server` and the others), the package scripts and the fleet starters point
at `apps/<name>/src/main.ts`.

### What stays in the root package

- **The scripts:** `client` (to be removed), `ctrl`, `dig`, `driver` (with `src/harness/`, except
  the config that moves to env), `session` and `viz`.
- **`test/repo/`,** the repo-wide checks, which read files and import no packages.

The scripts use packages the way the apps do. The root keeps its own tangle (`driver` imports
`client` and `viz`, `viz` imports `session`, `ctrl` imports `client`), which is out of scope
here: this plan is the fleet's libraries and apps. The scripts are a second plan.

## Testing

### Where tests live

- **Unit tests** sit in `packages/<name>/test/` and `apps/<name>/test/` and import their own
  sources relatively. The root `test/` keeps `test/repo/` and the scripts' tests.
- **A package's or app's own integration tests**, which need the real OS but no container and no
  spawned process (fleet's `ps` and `/proc` reader, qemu-server's qemu binary and QMP socket),
  sit in that package's `test/` under its own `test:integration` lane.
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
  spawn (open decision 9).

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
| `stores.ts` (1,055 lines) | every database store | 16 | Recording fakes go inline. Fakes that imitate store behaviour are decided one at a time (open decision 5). |
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

Each has a recommendation. None blocks phases 1 to 3.

1. **Where variables are declared.** Recommended: one list in env, so every variable and secret
   the fleet reads stays in one file, as `development.md` requires today. It costs no
   dependencies, since accessors are only names and strings. The alternative is each package
   declaring its own (db declares `DATABASE_URL`, linear declares `LINEAR_*`). That is more
   self-contained, but it loses the single list and makes "report the first missing variable, in
   a fixed order" harder.
2. **Resolved: how the sampler hands out a failed reading.** It logs the line itself. The
   `failures` stream of the first version is gone with the constraint that required it.
3. **Resolved: where fleet membership lives.** In `fleet`, as one `Member` template plus
   `forget`. Not in http (it imports no HTTP) and not duplicated in the two apps.
4. **Migrations location.** Recommended: `drizzle/` and `drizzle.config.ts` move into
   `packages/db`, with the CI workflow paths in the same change. Alternative: they stay at the
   root.
5. **Fakes that imitate behaviour.** For example, the automation store fake in `stores.ts` and the
   process spawner for QEMU and opencode. Decided per package when it moves: inline, or a helper
   in that package's own `test/`.
6. **Writing the standing test decisions into `development.md`.** "Never test wrangler" and
   "never test `oligarchy.json`" live only in this file and PR #232 today.
7. **Error homes.** Recommended: each error moves with the package that raises it (the table in
   the shared design).
8. **`prompts.ts`.** Recommended: it goes with linear; it fills the ticket templates.
9. **The dashboard's Worker entry as integration-testing's one app import.**
   `dashboard.integration.test.ts` runs the Hono app in-process (`app`, `scheduled`) against the
   container and a stub proxy. Recommended: the dashboard app declares an `exports` entry for its
   Worker entry, and the architecture test names it as the one app import integration-testing may
   make. A Worker's entry is its interface, the way a server's is its port. Alternatives: spawn
   `wrangler dev` (refused: never test wrangler), or keep the test in the app with its own
   container (duplicates the container machinery for one file).
10. **`linear` on layer 4 for `openRun`.** Recommended: yes; the alternative is a `runs` package
    of one function, which is the too-small pattern. If linear grows a second workflow that reads
    the database, revisit whether "everything whose output is a ticket" is still true.

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
