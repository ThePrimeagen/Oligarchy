# Monorepo plan

Status: phase 0 is done ([PR #232](https://github.com/ThePrimeagen/Oligarchy/pull/232): the Bun
workspace and `@oligarchy/routes`). Phase 1 is done (the cycle checks; `dig` removed). The rest
of this file is the plan for the remaining phases and the reasoning behind each choice; a phase's
checklist is ticked as it lands.

How to work a phase:

1. Re-check every test the phase touches and decide which change, which move and which are new.
2. Write the tests first. Each test is its own todo, with a happy and an unhappy path.
3. Run them and confirm they fail.
4. Only then change code.
5. Finish with `bun run check:fast` green, the integration lane run, and `development.md` updated
   for whatever the phase moved.

## Target in one picture

```
top     integration-testing (dev only)   scripts + dashboard (root package)
5       automation-server  automation-client  qemu-reverse-proxy  qemu-server
4       http            routes, contract, API errors, middleware, clients, serve, fleet
3       observability   log, Sentry, terminal colours
2       db              Postgres client, stores, schema, migrations
2       linear          Linear API client, prompts
1       env             variables, env files, oligarchy.json, entry runner, shared flags, failure text
0       shared          domain ids, vocabularies, domain errors
0       stats           host CPU/memory sampler, per-process reader
```

A package depends only on packages in a lower layer. Nothing depends on an app. The scripts
(`client`, `ctrl`, `driver`, `session`, `viz`) and the dashboard stay in the root package
as one-off consumers on top. `client` will be removed later, outside this plan. `dig` was removed
in phase 1.

## Principles

- **One-way dependencies, never two-way.** A lint rule catches file cycles and a repo test
  catches package cycles and layer violations (see "Enforcing one-way dependencies").
- **Coarse packages by category.** Database, HTTP, observability, environment and stats are each
  one package. No fine-grained packages.
- **Four apps.** `automation-server`, `automation-client`, `qemu-reverse-proxy` and
  `qemu-server`. Everything else is a script.
- **Low packages compute and return values.** They never log. What happens to a value, a failure
  included, is up to the caller. Stats is the first package built this way.
- **The right technology and nothing extra.** Phase 0 chose Bun workspaces, a catalog, the
  isolated linker and source-first packages. The list, and what was deliberately left out, is in
  "Phase 0 (done)".
- **Tests live with the code they test.** Unit tests sit in their package and need nothing
  outside their own file and package. Integration tests, with all their machinery, live in one
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
- [x] TEST (alter) `test/repo/scripts.unit.test.ts`: `dig` is no longer a process. Its tests
      (`test/dig/`, `test/integration/dig.integration.test.ts`) go with it.

**Phase 2: `@oligarchy/stats`**

- [ ] TEST (move) `test/qemu/stats.unit.test.ts` to `packages/stats/test/host.unit.test.ts`,
      scripting its readings in the file and using no Log fake.
- [ ] TEST (alter) host sampler: a reading that throws shows up on `failures` with what was
      thrown, and the next tick still samples against the last good reading. A clean tick puts
      nothing on `failures`.
- [ ] TEST (alter) host sampler: `collect` returns `{ memory, cpu }` and takes no `qemus`.
- [ ] TEST (move) `test/shared/process-usage.unit.test.ts` to
      `packages/stats/test/process.unit.test.ts`, with the `/proc` cases on an inline
      `FileSystem.layerNoop`.
- [ ] TEST (alter) process reader on macOS: the `ps` cases feed a listing string. A listing that
      never answers fails after ten seconds. The SIGTERM, then SIGKILL a second later, settings
      are checked on the command value. Failures assert `PsFailed`.
- [ ] TEST (move) `test/integration/process-usage.integration.test.ts` to
      `packages/integration-testing/test/process-usage.integration.test.ts`.
- [ ] TEST (new) qemu-server: a sampler failure is logged as
      `failed to sample cpu usage: <detail>` with the thrown value as the cause. A clean tick
      logs nothing.
- [ ] TEST (new) automation-client: the same.
- [ ] TEST (alter) `test/qemu-server/sessions.unit.test.ts`: `sessions.stats` is the machine
      count plus the sampler's values (`test/support/fake-qemu.ts` fake stats return plain
      values).
- [ ] TEST (alter) `test/automation-client/heartbeat.unit.test.ts`: the row carries `qemus: 0`
      and the sampler's values. A failing process read uses `PsFailed`, not `CliFailed`.
- [ ] TEST (alter) `test/qemu-server/heartbeat.unit.test.ts`: a failing process read uses
      `PsFailed`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: stats imports only `effect` and its own
      files, and its tests import nothing outside the package.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: a package may add a `test:integration` lane
      on Bun, and the root `test:integration` runs the root's lane, then every package's.
      Unhappy: a package integration lane off Bun is named.

**Phase 3: `@oligarchy/shared`**

- [ ] TEST (move) `test/shared/domain.unit.test.ts` and `test/shared/errors.unit.test.ts` to
      `packages/shared/test/`.
- [ ] TEST (move) `test/external-failure.unit.test.ts` to `packages/shared/test/`.
- [ ] TEST (move) the vocabulary cases that move down (at least `SessionMode` and `ServerUrl`)
      from `packages/routes/test/contract.unit.test.ts` to `packages/shared/test/`. The
      contract test keeps one case per moved vocabulary proving a body with a bad value is still
      refused with the same message.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: shared imports only `effect` and its own
      files.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: the routes package may import `effect`
      and `@oligarchy/shared`. Its unhappy case still names the main package, a platform, Node
      and a driver.

**Phase 4: `@oligarchy/env`**

- [ ] TEST (move) `test/config/config.unit.test.ts` to `packages/env/test/config.unit.test.ts`,
      with the same assertions: the provider order, `--env-file` last one wins, `--` stops the
      scan, `<NAME> is not set`, and `ProxyConfig`.
- [ ] TEST (new) `packages/env/test/run.unit.test.ts`: a successful command exits 0 and runs its
      teardown. A failing command prints one headline and the cause, with no stack, and exits
      nonzero. A `CliError` prints nothing more. `--version` prints the version passed in. The
      Wizard is not offered.
- [ ] TEST (move) the `--port`, `--name`, `--url` and `--max-jobs` cases from
      `test/qemu-server/command.unit.test.ts` and `test/automation-client/command.unit.test.ts`
      to `packages/env/test/flags.unit.test.ts`. Happy: an omitted `--port` is the default.
      Unhappy: a non-integer port, a bad name, a non-URL url and `--max-jobs 0` are refused.
- [ ] TEST (move) the failure-rendering cases (`errorDetail`, `headline`, `renderFailure`,
      `reportFailure`) from `test/observability/render.unit.test.ts` to
      `packages/env/test/render.unit.test.ts`. The colour cases stay.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: env imports only `effect`,
      `@oligarchy/shared` and its own files.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the driver wrapper defines `import.meta.url`
      as the `oligarchy.json` loader's new path.
- [ ] TEST (move) `test/cli.unit.test.ts` to `test/automation-client/child.unit.test.ts`,
      following `src/cli.ts` to `src/automation-client/child.ts`.

No test covers the `oligarchy.json` loader or the file's contents (standing decision).

**Phase 5: `@oligarchy/db`**

- [ ] TEST (move) `test/db/client.unit.test.ts` and `test/db/migrate.unit.test.ts` to
      `packages/db/test/`.
- [ ] TEST (move) `test/integration/db.integration.test.ts`,
      `test/integration/test-database.integration.test.ts` and `test/support/postgres.ts` to
      `packages/integration-testing/`. The root's remaining database tests import the Postgres
      helper from `@oligarchy/integration-testing`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: db imports only `effect`, `drizzle-orm`,
      `pg`, `@oligarchy/env`, `@oligarchy/shared` and its own files. It never imports
      observability.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: `db:migrate`, `prod:db:migrate` and
      `test:db:migrate` run the package's migrate program, each still from its own env file.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the migrations workflow scans the
      migrations where they live, if `drizzle/` moves (open decision 4).
- [ ] TEST (alter) `test/support/stores.ts` and every test importing a store type: import from
      `@oligarchy/db`.

**Phase 6: `@oligarchy/observability`**

- [ ] TEST (move) `test/observability/log.unit.test.ts`, `sentry.unit.test.ts` and the colour
      half of `render.unit.test.ts` to `packages/observability/test/`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: observability imports only `effect`,
      Sentry, `@oligarchy/db`, `@oligarchy/env`, `@oligarchy/shared` and its own files.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the instrumented processes preload the
      package's `instrument.ts`, in the package scripts and the wrappers.
- [ ] TEST (alter) `test/support/log.ts`: imports `Log` from `@oligarchy/observability`.

**Phase 7: `@oligarchy/http`**

- [ ] TEST (alter) every test importing `@oligarchy/routes/*` imports `@oligarchy/http/*`,
      keeping the `Api`, `Contract` and `ApiErrors` aliases.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: `api`, `contract` and `errors` import
      only `effect` and `@oligarchy/shared`, because the dashboard Worker bundles them. Unhappy:
      a Node or platform import there is named.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: the rest of http imports only `effect`,
      the Node platform, `@oligarchy/observability`, `@oligarchy/db`, `@oligarchy/env`,
      `@oligarchy/stats`, `@oligarchy/shared` and its own files.
- [ ] TEST (move) the bearer-auth and boundary middleware cases, which live in the apps' HTTP
      tests today (`test/qemu-server/http.unit.test.ts` and the others), to
      `packages/http/test/middleware.unit.test.ts`. Each app keeps one case proving the
      middleware is wired in.
- [ ] TEST (move) `test/client/proxy-client.unit.test.ts` to `packages/http/test/`.
- [ ] TEST (move) `test/automation-server/client.unit.test.ts` to `packages/http/test/`.
- [ ] TEST (new) `packages/http/test/serve.unit.test.ts`: a server listens and serves its
      routes. A port already in use fails with `ServeError`. A later server error ends the
      program once, with one fatal line.
- [ ] TEST (move) `test/shared/stale-servers.unit.test.ts` to `packages/http/test/`.
- [ ] TEST (new) `packages/http/test/fleet.unit.test.ts`: one announce loop covering both apps'
      heartbeat cases, if open decision 3 is accepted. Each app keeps one test that it announces
      with its own type and machine count.
- [ ] TEST (alter) `test/integration/client.integration.test.ts`: the bundle rebuilds when an
      http-package source is newer.

**Phase 8: `@oligarchy/linear`**

- [ ] TEST (move) `test/ctrl/linear.unit.test.ts` and `test/ctrl/prompts.unit.test.ts` to
      `packages/linear/test/`.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: linear imports only `effect`,
      `@oligarchy/env`, `@oligarchy/shared` and its own files.

**Phase 9: the four apps**

- [ ] TEST (move) qemu-server's unit tests (`test/qemu-server/`, `test/qemu/`, `test/qmp/`) to
      `apps/qemu-server/test/`.
- [ ] TEST (move) automation-client's unit tests to `apps/automation-client/test/`.
- [ ] TEST (move) automation-server's unit tests to `apps/automation-server/test/`.
- [ ] TEST (move) qemu-reverse-proxy's unit tests to `apps/qemu-reverse-proxy/test/`.
- [ ] TEST (alter) each moved test file: shared fakes become inline fakes of the methods it uses,
      or a helper in its own app's `test/` folder (open decision 5).
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: each app's package script and wrapper run
      `apps/<name>/src/main.ts` with exactly its preloads.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: an app imports packages only, never
      another app and never the root's `src/`. Unhappy: an app-to-app import is named.
- [ ] TEST (alter) `test/repo/architecture.unit.test.ts`: the boundary-file list, the `main.ts`
      pattern and the `Effect.run` rules cover `apps/*/src/main.ts`.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the fleet starters start the apps from
      their new entries, and a second signal still kills both children.

**Phase 10: finish integration testing**

- [ ] TEST (move) the remaining integration tests into `packages/integration-testing/test/`.
- [ ] TEST (alter) `test/repo/scripts.unit.test.ts`: the integration package's lane runs one
      worker with the global setup, and the root `test:integration` reaches it.
- [ ] TEST (new) `test/repo/architecture.unit.test.ts`: no package or app depends on
      `@oligarchy/integration-testing`.

### Implementation checklist

**Phase 1: cycle checks**

- [x] Add the `import` plugin and `"import/no-cycle": "error"` to `.oxlintrc.json`. The plugin
      brings two more rules from the enabled categories: `import/no-named-as-default-member`
      (fixed at the source, `import { Pool } from "pg"`) and `import/no-unassigned-import`,
      turned off because a side-effect import is exactly an unassigned one.
- [x] Break the one cycle it finds. Decided while working the phase: `dig` (the game script)
      is removed entirely, wrapper, sources and tests, rather than refactored.
- [x] Add the layer list to `test/repo/architecture.unit.test.ts`, starting with `routes`.
- [x] `development.md`: document the no-cycle rule and the layer list.

**Phase 2: `@oligarchy/stats`**

- [ ] Create `packages/stats` (`package.json`, `tsconfig.json`, `vitest.config.ts`), with
      `src/host.ts` from `src/qemu/stats.ts` and `src/process.ts` from
      `src/shared/process-usage.ts`.
- [ ] Remove all logging from the sampler, add `failures`, drop `qemus`, return plain values.
- [ ] Give the process reader `PsFailed` and the listing seam.
- [ ] Wire qemu-server and automation-client: subscribe to `failures` and log them, and build
      `Contract.Stats` from the values plus the machine count.
- [ ] Create `packages/integration-testing` with its own lane and the process-usage host test.
- [ ] Add `@effect/vitest` (and `@effect/platform-node` for the integration package) to the
      catalog.
- [ ] Update the architecture boundary-file list for the new paths, and add stats and
      integration-testing to the layer list.
- [ ] `development.md`: the unit-test rule and the integration package.

**Phase 3: `@oligarchy/shared`**

- [ ] Create `packages/shared` with `domain.ts`, `errors.ts` (domain errors only) and
      `external-failure.ts`.
- [ ] Move the vocabularies domain code also uses from the routes contract into shared. The
      contract imports them. Schema identifiers stay unchanged.
- [ ] Re-point every import of `src/shared/*` and `src/external-failure.ts`.

**Phase 4: `@oligarchy/env`**

- [ ] Create `packages/env` with `config.ts`, `env-file.ts`, `oligarchy.ts` (from
      `src/harness/config.ts`), `run.ts`, `flags.ts` and `render.ts` (the failure half).
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

- [ ] Create `packages/observability` with `log.ts`, `sentry.ts`, `instrument.ts`, `dsn.ts` and
      the colour half of `render.ts`, plus `LogLine`.
- [ ] Update every `--preload` path and the dashboard's `dsn` import.

**Phase 7: `@oligarchy/http`**

- [ ] Rename `packages/routes` to `packages/http` (`@oligarchy/http`).
- [ ] Move in the middleware, `NotFoundRoute`, the proxy client, the automation-server client and
      stale-server reaping. Add `serve` and, if accepted, the fleet announce loop.
- [ ] Remove the hand-rolled listen code from the four servers.
- [ ] Run `wrangler deploy --dry-run` as a build check (not a test).

**Phase 8: `@oligarchy/linear`**

- [ ] Create `packages/linear` from `src/ctrl/linear.ts` and `src/ctrl/prompts.ts`, with
      `LinearError` and `PromptError`.

**Phase 9: the four apps**

- [ ] Add `apps/*` to the root workspaces.
- [ ] Move each app into `apps/<name>/`: qemu-server takes `src/qemu/` and `src/qmp/`, and
      automation-client takes `child.ts`.
- [ ] Update the wrappers, package scripts and fleet starters.

**Phase 10: finish integration testing**

- [ ] Move the remaining integration tests, the loopback stubs and the global setup.
- [ ] Delete `test/integration/` and the root's integration project.

### Verification (every phase)

- `bun run check:fast` exits 0 locally and in CI.
- The integration lane with Docker up: `OLIGARCHY_REQUIRE_DATABASE=1 bun run test:integration`.
- `bun install --frozen-lockfile`.
- When a phase touches something the scripts bundle: `./client --help` and `./driver --help`.
- When a phase touches something the dashboard bundles (db, observability, http):
  `wrangler deploy --dry-run` as a build check.

## Enforcing one-way dependencies

### File cycles: oxlint `import/no-cycle`

oxlint already runs over the whole tree, and its `import` plugin has `import/no-cycle`. Turning it
on means adding `"import"` to `plugins` and the rule to `rules` in `.oxlintrc.json`.

Checked on 2026-09-25 with oxlint 1.81.0:

- Two files importing each other in a scratch directory: both reported.
- The same loop across two workspace packages, through their `exports`: both reported. The rule
  follows package imports.
- The whole repo with only this rule on: 0.24 seconds, and exactly one cycle,
  `src/dig/lobby.ts` and `src/dig/room.ts`. Phase 1 removed `dig` altogether.

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

### Considered and not chosen

- **dependency-cruiser.** It can check both cycles and layers, but it is another tool with its
  own config language, restating what `package.json` already declares.
- **madge.** Cycles only, no layers, and another dependency.
- **Nx `enforce-module-boundaries`.** It needs Nx, which phase 0 ruled out.
- **A custom oxlint JS plugin for layers.** Possible, but the package graph is not a property of
  any one file. A repo test reads the whole graph at once and is how this repo already checks
  architecture.

## Package designs

### `@oligarchy/stats` (layer 0, phase 2)

Holds `src/qemu/stats.ts` (the host CPU and memory sampler, as `host.ts`) and
`src/shared/process-usage.ts` (this process's CPU and memory, as `process.ts`). It depends on
`effect` only.

- **It never logs.** It computes and returns values, and the caller decides what to do with
  them.
- **The sampler keeps its own clock.** It samples every five seconds into a 60-sample window. The
  one, two and three minute means count samples, so the clock has to stay inside the package.
- **`collect` returns plain values:** `{ memory, cpu }`. The `qemus` argument goes. qemu-server
  adds its machine count, and automation-client stops passing `0`.
- **Failed readings are values too.** A reading that throws is skipped: the next good reading is
  compared with the last good one, as today. The failure is published on
  `failures: Stream<SampleFailed>`, and if nobody listens it is dropped. A stream rather than a
  field on `collect` because the failure happens between collects, and qemu-server has two
  callers of `collect` (the `/stats` endpoint and the heartbeat), so whichever asked first would
  swallow it.
- **The apps log.** qemu-server and automation-client each listen and write today's exact line,
  `failed to sample cpu usage: <detail>`.
- **Wire schemas stay in the HTTP contract.** `Memory`, `Cpu` and `Stats` are not moved. The apps
  build `Contract.Stats` from the values, so the contract never depends on stats.
- **The process reader already returns values.** It fails with a typed error and never logs. Its
  error becomes stats' own `PsFailed`, instead of the shared `CliFailed`.
- **The `ps` seam narrows.** The reader takes "list the processes" as a value, so its unit tests
  pass a string. The real listing keeps the ten-second timeout and the SIGTERM, then SIGKILL a
  second later. The tests check those settings on the command value, and the timeout with a
  listing that never answers.
- **Service keys follow the package:** `@oligarchy/stats/Host` and
  `@oligarchy/stats/ProcessUsage`. Service keys are not schema identifiers, so renaming them
  changes no message.
- **Both files stay boundary files.** They read `node:os` and `process.*`, so the architecture
  test's boundary list follows their new paths.

### `@oligarchy/shared` (layer 0, phase 3)

- **Holds** `src/shared/domain.ts`, the domain errors that are used everywhere (for example
  `CommandError`) and `src/external-failure.ts`.
- **Takes back** from the routes contract the vocabularies domain code also uses: at least
  `SessionMode`, which `domain.ts` imports from routes today (an upward edge), and `ServerUrl`,
  which env needs. Vocabularies only the wire uses stay in the contract. Schema identifiers are
  unchanged.
- **Does not hold** `process-usage.ts` (it goes to stats) or `stale-servers.ts` (it uses the
  database and the log, and goes to http's fleet module).
- **Depends on** `effect` only.

Each other error moves with the package that raises it:

| Error | Home |
|---|---|
| `MissingVariable` | env |
| `DatabaseError` | db |
| `LogLine` | observability |
| `ProxyRefusal`, `ProxyUnreachable` | http |
| `LinearError`, `PromptError` | linear |
| `QmpError`, `QmpTimeout`, `QmpClosed`, `QmpProtocolError`, `QemuStartError`, `HostRequirementsMissing`, `IsoError`, `KeysError` | qemu-server |
| `AutomationClientError`, `JobNotFound` | automation-server |
| `CliFailed` | automation-client (its child runner) |
| `HistoryError`, `ToolError`, `OpenRouterRefusal`, `OpenRouterUnreachable` | driver (root) |
| `PngDecodeError` | session (root) |

No code raises `ChildExit`; only its own test names it, so it is a candidate for deletion.

### `@oligarchy/env` (layer 1, phase 4)

**Why "env".** "cli" would be wrong for two reasons. Each app's commands stay in the app. And
`src/cli.ts` is not CLI handling at all: it is automation-client's child-process runner. Config
and CLI also cannot be split without a two-way edge, because flags fall back to config values,
and the config reader must find `--env-file` in the raw arguments before the CLI parses them.

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
  - `Command.run` with the version;
  - `reportFailure`;
  - `NodeRuntime.runMain` with error reporting off;
  - in the servers, the stdout/stderr error listeners and a teardown.

  The version is passed in, so env never reaches up to http's `Api.VERSION`.
- **Shared flags:** `port(defaultPort)` for all four servers, and `--name`, `--url` and
  `--max-jobs`, which qemu-server and automation-client define identically except for one word of
  help text.
- **Failure text:** `errorDetail`, `headline`, `renderFailure` and `reportFailure`, taken out of
  `observability/render.ts`. The runner, the `oligarchy.json` loader and the database code need
  them.

**Does not hold:**

- The HTTP listen code, which becomes http's `serve`.
- `src/cli.ts`, which moves into automation-client as `child.ts`.
- qemu-server's own flags (`--display`, `--data-dir`, `--automation`).

**Depends on** `@oligarchy/shared` (`ModelId`, `ServerName`, `MaxJobs`, `ServerUrl`), so shared
comes first.

### `@oligarchy/db` (layer 2, phase 5)

- **Holds** `src/db/*`: the client, migrate, every store and the schema, plus `DatabaseError`.
- **Depends on** env, shared, `drizzle-orm` and `pg`.
- **The old loop breaks here.** `db/client.ts` and `db/migrate.ts` used only the failure text from
  `observability/render.ts`, which moved to env in phase 4. So db no longer imports
  observability, while observability's log still writes rows through db.
- **Its rules follow it.** `db/client.ts` stays a boundary file, and the one place
  `Effect.log*`, `runForkWith` and `runPromiseExitWith` are allowed.
- **The dashboard** imports `@oligarchy/db/schema`.

### `@oligarchy/linear` (layer 2, phase 8)

- **Holds** `src/ctrl/linear.ts`, the Linear API client (659 lines), plus `LinearError`.
  `src/ctrl/prompts.ts` goes with it unless the phase finds a better owner; it is used by the
  proxy's setup and by ctrl.
- **Used by** automation-server, qemu-reverse-proxy and ctrl.
- **Depends on** env and shared.

### `@oligarchy/observability` (layer 3, phase 6)

- **Holds** `log.ts`, `sentry.ts`, `instrument.ts`, `dsn.ts`, the colour and log-line half of
  `render.ts` (the palette, `paint`, `renderLogLine`, `wantsColor`), and `LogLine`.
- **Depends on** db (the log writes rows), env, shared and Sentry.
- **Paths follow it.** Every `--preload` of `instrument.ts` and the dashboard's `dsn` import.

### `@oligarchy/http` (layer 4, phase 7)

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
    `TracerDisabledWhen`, and racing the launch against the server failing);
  - fleet membership, if open decision 3 is accepted: the announce/heartbeat loop that
    qemu-server and automation-client each have in nearly identical form, and stale-server
    reaping (`shared/stale-servers.ts`, used by the proxy and automation-server).
- **The Worker constraint.** `api`, `contract` and `errors` import only `effect` and
  `@oligarchy/shared`, because the dashboard Worker bundles them. The rest may use the Node
  platform.
- **Depends on** observability, db, env, stats (the fleet loop), shared and
  `@effect/platform-node`.

### The four apps (layer 5, phase 9)

Each app moves to `apps/<name>/`, with its own `package.json`, `src/`, `test/` and
`vitest.config.ts`. The root workspaces gain `apps/*`.

- **qemu-server** also takes `src/qemu/` and `src/qmp/`. Once stats moves, nothing else uses
  them.
- **automation-client** also takes `child.ts` (was `src/cli.ts`).
- **automation-server** and **qemu-reverse-proxy** take their own directories. Their imports of
  other apps (`ctrl/linear.ts`, `qemu-server/middleware.ts`, `qemu-server/handlers.ts`,
  `client/proxy-client.ts`) are gone by then, into linear and http.

The wrappers (`./qemu-server` and the others), the package scripts and the fleet starters point
at `apps/<name>/src/main.ts`.

### What stays in the root package

- **The scripts:** `client` (to be removed), `ctrl`, `driver` (with `src/harness/`, except
  the config that moves to env), `session` and `viz`.
- **The dashboard Worker.** It imports `ctrl/command.ts`, so it stays where ctrl is.
- **`test/repo/`,** the repo-wide checks, which read files and import no packages.

The scripts use packages the way the apps do. None of this moves in this plan.

## Testing

### Where tests live

- **Unit tests** sit in `packages/<name>/test/` and `apps/<name>/test/` and import their own
  sources relatively. The root `test/` keeps `test/repo/` and the scripts' tests.
- **Integration tests** live in `@oligarchy/integration-testing` (`packages/integration-testing`),
  with everything that makes them complicated: the Postgres container helper and global setup,
  the loopback stubs, testcontainers, the one-worker lane. It sits above everything it tests, is
  dev only, and nothing depends on it.
- **Integration tests move with their subject.** Most of them import the root's `src/` today, so
  each moves when its subject becomes a package. The stats host test is first (phase 2); the rest
  finish in phase 10.

### The unit-test rule

- A unit test file imports its own package, Effect (including `TestClock` and `TestConsole`) and
  vitest. Never another package's tests, and never a shared unit-testing package.
- If several test files in one package need the same helper, a helper file in that package's own
  `test/` folder is allowed.
- When a test needs a big fake, first ask whether the code should take a value instead of a
  service. Stats' readings and its `ps` listing are the model.
- A fake of one of our services is `Layer.succeed(Tag)(Tag.of({ ... }))` inline, with only the
  methods the test uses, and every unused member `Effect.die("Unexpected <Service>.<method>")`.
- `development.md` currently says fakes live under `test/support/`, one file per seam. That rule
  is rewritten in phase 2, when the first package's tests move.

### The shared helpers today, and where each goes

Counted on 2026-09-25 (unit test files using each):

| Helper | Fakes | Users | Where it goes |
|---|---|---|---|
| `log.ts` | Log | 22 | Gone where code returns values (stats). App tests that assert log lines inline it or keep an app-local helper. |
| `stores.ts` (1,055 lines) | every database store | 16 | Recording fakes go inline. Fakes that imitate store behaviour are decided one at a time (open decision 5). |
| `fake-http.ts` | the HTTP client | 16 | Decided in phase 7: inline `Layer.succeed(HttpClient.HttpClient)` where short. |
| `fake-spawner.ts` (235 lines) | child processes | 12 | Stats narrows its seam. qemu-server and automation-client keep an app-local helper for process choreography. |
| `config.ts` (5 lines) | configuration | 12 | Inline. |
| `fake-fs.ts` | the file system | 10 | Effect's `FileSystem.layerNoop`, inline. |
| `reporter.ts` | Sentry's error reporter | 6 | Observability's log test and the four apps' HTTP tests: inline, or an app-local helper. |
| `tracer.ts` | a recording tracer | 1 | qemu-server's own `test/` (its sessions test). |
| `stdio.ts` | process arguments | 5 | Stays with the scripts' command tests in the root. |
| `fake-qemu.ts`, `fake-minted.ts`, `fake-qmp-socket.ts`, `fake-sessions.ts` | QEMU pieces | 2–4 each | qemu-server's own `test/`. |
| `fake-linear.ts` | Linear | 5 | automation-server, the proxy's setup and ctrl: inline, or an app-local helper. |
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

Each has a recommendation. None blocks phases 1 and 2 except the second, which phase 2 needs.

1. **Where variables are declared.** Recommended: one list in env, so every variable and secret
   the fleet reads stays in one file, as `development.md` requires today. It costs no
   dependencies, since accessors are only names and strings. The alternative is each package
   declaring its own (db declares `DATABASE_URL`, linear declares `LINEAR_*`). That is more
   self-contained, but it loses the single list and makes "report the first missing variable, in
   a fixed order" harder.
2. **How stats hands out failed readings.** Recommended: a `failures` stream (see the stats
   design). Alternatives: a failure count in `collect`'s result (loses the detail), or making the
   caller run the sampling (leaks the five-second clock that the means depend on).
3. **Fleet membership in http.** Recommended: the announce loop and stale-server reaping live in
   http, so the two apps stop carrying near-identical heartbeats. Alternative: each app keeps its
   own.
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
8. **`prompts.ts`.** Recommended: it goes with linear unless phase 8 finds a better owner.

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
