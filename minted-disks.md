# Minted disks

A plan, written to be worked on. Check items off as they land. Tests come first in every step;
no code lands until its failing tests describe it (`development.md`, Tests).

## What this is

A test today boots the Omarchy ISO on a blank 40G disk and installs before it can do anything.
This plan mints, once per machine, a disk with Omarchy installed and a known user on it, and lets
every later session boot a throwaway copy of that disk in seconds.

- The minted disk is two files beside the ISO, in the place the ISO cache already keeps it:
  `<iso>.qcow2` and `<iso>.OVMF_VARS.fd`, where `<iso>` is the path QEMU boots the ISO from
  (`~/.oligarchy/isos/<name>` for a url, the resolved path for a local file). Whether an ISO is
  minted on a machine is whether those two files exist. No folder, no metadata, nothing to go
  stale.
- Copies are qcow2 overlays: `qemu-img create -f qcow2 -b <iso>.qcow2 -F qcow2 <session>/disk.qcow2`.
  The minted disk is never written; the overlay lives and dies with the session directory, exactly
  as the blank disk does now. Twenty-eight sessions on one machine are twenty-eight overlays of one
  file.
- The firmware NVRAM travels with the disk. `Qemu.prepare` copies a pristine `OVMF_VARS.4m.fd`
  into every session directory and the installer writes its boot entry into that copy; `save` keeps
  that file as `<iso>.OVMF_VARS.fd` and a resume copies it instead of the pristine one.
- One minted disk per ISO per machine. A save overwrites what was there. Two qemu servers on one
  machine share the same home directory and so the same minted disk, as they share the ISO cache.

## Vocabulary

- `mode`: what a session is. `fresh` boots the ISO on a blank disk (today). `mint` boots the ISO on a
  blank disk and may `save`. `resume` boots the machine's minted disk with no ISO attached.
- minted disk: `<iso>.qcow2` and `<iso>.OVMF_VARS.fd` beside the ISO's path. Present means minted.
- `save`: the call that ends a `mint` session and writes its disk and firmware file into place.
- pin: `test_runs.pinned_server`, a qemu server url the reserve must land on. Null means unpinned.

## Decisions

- `save` ends the session: QMP `system_powerdown` (skipped when the guest already exited), wait for
  QEMU to exit with a bound of two minutes, then copy the firmware file and `qemu-img convert` the
  disk, each written as `<target>.partial-<pid>` and renamed over whatever is there, firmware first
  and disk last so the disk's presence means both are in place. Row closed `succeeded` with
  `saved; minted <iso>`. A clean shutdown makes a clean image; a copy taken from a running guest is
  only crash-consistent.
- Overwrite, never refuse. A guest still running on the old disk holds the old file open and keeps
  it until it exits; the rename does not touch it. Redoing a machine is minting it again.
- `mode` rides on the reserve and the start. The reserve carries `mode`, `iso` and an optional
  `server` pin; the start repeats `mode` and must match the reservation. The proxy honors a pin
  exactly and never falls back to another server. An unpinned `resume` is placed only on a server
  whose stats list the ISO as minted. `fresh` and `mint` are ranked as today.
- `/stats` lists what is minted as ISO cache names (`Domain.isoCacheName(iso)`), read from the cache
  directory: every `<name>.qcow2` with its `<name>.OVMF_VARS.fd` beside it. The proxy and `ctrl`
  compare `isoCacheName(iso)` against that list; no url is stored anywhere. The heartbeat writes the
  list into `servers.stats` so the dashboard and `ctrl mint` read it from the row.
- One ticket per machine. `./ctrl mint` creates one pinned run, result and Linear ticket per live
  qemu host not yet minted for the ISO. Everything downstream is the existing pipeline: the ticket
  enters Automation Needed, the drive is dispatched with the run's mode, ISO and pin, the driver
  installs and saves, moves the ticket to Needs Review, the diagnoser closes it. Each machine's
  verdict is a ticket on the board. `./ctrl mint --verify` does the same with the `mint-verify`
  definition on the hosts that are minted; `./ctrl mint --server <url>` mints one machine again.
- Sequencing (mint, then verify, then redo failures) is the operator's or the super-run script's.
  Nothing in the automation server coordinates a campaign, and nothing guards against two mints of
  one ISO on one machine beyond `ctrl mint` creating one ticket per host: the second would simply
  overwrite the first.
- The credentials the minted user has (name, password, disk passphrase) are a fixed convention
  written into the `mint` definition's instruction and into every `resume` definition's
  instruction. They are data, stored and versioned with `./ctrl test define`.
- Pins are urls, the `servers` primary key and what the proxy routes with. A url the proxy does not
  know is a 404.
- A local-path ISO is minted beside the operator's file, since that is where QEMU boots it from;
  it is a development case and does not appear in `/stats`, which reads the cache directory only.

## HTTP answers

| Where | Case | Answer |
|---|---|---|
| qemu server `/reserve` | `mint` or `resume` without `iso` | 400 `mode "<m>" needs an iso` |
| qemu server `/reserve`, `/start` | `resume`, not minted here | 400 `no minted disk for <iso> on this machine` |
| qemu server `/start` | mode or iso differs from the reservation | 400, reservation stands |
| qemu server `/save` | session is not `mint` | 400 `only a mint session can save` |
| qemu server `/save` | guest did not power off, copy or convert failed | 502 `SaveFailed`, row `failed`, debug log |
| qemu server `/save` | racing the sweep | 404 `UnknownSession` |
| proxy `/reserve` | pinned url not registered | 404 `no server <url>` |
| proxy `/reserve` | pinned server unreachable | 502 `ServerFailed` |
| proxy `/reserve` | pinned server full | 503 passed through; the job defers with its pin |
| proxy `/reserve` | `resume`, no server minted | 503 `NoServer` `no server has minted <iso>`; the job defers until a save lands |

The automation client keeps its mapping: 503 is `AtCapacity` (deferred), anything else closes the
job with the message.

## Tests first

`test/shared/domain.unit.test.ts`

- [ ] `SessionMode` accepts `fresh|mint|resume`, refuses anything else; `SessionConfig` round-trips
      `mode`; a `save` follow action and a `system_powerdown` QMP command encode and decode.
- [ ] `isoCacheName` maps a url and a path as the ISO cache names its files (moved from `iso.ts`,
      test moves with it).

`test/shared/errors.unit.test.ts`, `test/shared/api.unit.test.ts`

- [ ] `SaveFailed` is 502 on the wire, body `{ error }`, arm in `apiStatus`; `NotFoundWire` and
      `NoServerWire` are declared on the proxy's reserve path.

`test/qemu/args.unit.test.ts`

- [ ] with a cdrom the args carry `-cdrom <iso> -boot order=d` as today; without one neither flag
      appears and the rest is identical.

`test/qemu/process.unit.test.ts`

- [ ] `createOverlay` spawns `qemu-img create -f qcow2 -b <backing> -F qcow2 <path>`; a non-zero
      exit is `QemuStartError` naming the code.
- [ ] `convert` spawns `qemu-img convert -O qcow2 <from> <to>`; a non-zero exit fails with the code.

`test/qemu/iso.unit.test.ts`

- [ ] `pathOf` answers the cache path for a url and the resolved path for a file without touching
      the network or the disk; `getIso` boots from exactly that path.

`test/qemu/qemu.unit.test.ts`

- [ ] `prepare` with a `minted` source creates the overlay and copies the minted firmware file, not
      the pristine one; a failing `qemu-img` fails `QemuStartError` and the dir finalizer still runs.
- [ ] `start` without a cdrom boots; the handle exposes `diskPath`, `varsPath`, `powerdown` (a
      recorded `system_powerdown` exchange) and `exited`.

`test/qemu/minted.unit.test.ts` (new)

- [ ] `find` answers the two paths when both files exist beside the ISO's path; none when either is
      missing.
- [ ] `list` names every `<name>.qcow2` in the cache directory with its firmware file beside it,
      ignores `.partial-*` files and a `.qcow2` without its firmware file, and answers `[]` for a
      missing directory.
- [ ] `save` writes the firmware file then the disk, each through `.partial-<pid>` and a rename,
      overwriting existing files; a failing convert removes its partial and leaves the previous
      disk in place; a failing firmware copy stops before the convert.
- [ ] two services on one cache directory see the same minted files.

`test/qemu-server/sessions.unit.test.ts`

- [ ] reserve: `mint` and `resume` hold mode and ISO on the reservation; `resume` when not minted
      here is `BadRequest` `no minted disk for <iso> on this machine` and the slot is given back;
      `mint` or `resume` without an ISO is `BadRequest`; `fresh` is unchanged.
- [ ] start: mode or ISO differing from the reservation is `BadRequest` and the reservation stands;
      `resume` never calls `getIso`, prepares from the minted files, inserts the row `running` with
      `mode` in its config; `mint` inserts `mode: mint`.
- [ ] save: on a `fresh` or `resume` session is `BadRequest`; the happy path records the powerdown
      action, awaits exit, saves, closes the row `succeeded` with `saved; minted <iso>`, frees the
      slot, tells followers last; a guest already exited is saved without a powerdown exchange; a
      guest that never powers off within the bound is killed, row `failed`, debug log saved,
      `SaveFailed`; a failing convert ends the row `failed`; racing the sweep is `UnknownSession`.
- [ ] stats: `minted` lists the cache names; `host` is the host name.

`test/qemu-server/http.unit.test.ts`, `test/qemu-server/heartbeat.unit.test.ts`

- [ ] `POST /save` 200; 400, 403, 404, 502 with `{ error }`; `/stats` carries `host` and `minted`;
      the servers row's stats carry both.

`test/qemu-reverse-proxy/http.unit.test.ts`

- [ ] a pinned reserve goes to that url only, probed first, its 200 and its 503 passed through; an
      unregistered url is 404 `no server <url>`; an unreachable pinned server is `ServerFailed`.
- [ ] an unpinned `resume` lands only on a server whose stats list `isoCacheName(iso)` as minted,
      ranked by qemus among those; none is `NoServer` `no server has minted <iso>`; `fresh` and
      `mint` rank as today.
- [ ] `/save` forwards to the session's server; an unknown id is 404.

`test/client/command.unit.test.ts`, `test/client/proxy-client.unit.test.ts`

- [ ] `start --mode resume` sends `mode: "resume"`; omitted sends `fresh`; an unknown mode is
      refused at the flag.
- [ ] `save` sends `{ id, agent }`, prints `saved`; without `--session-id` it is refused before any
      request; `--help` touches nothing.
- [ ] `ProxyClient.save` maps a refusal and an unreachable server like the other calls.

`test/automation-server/worker.unit.test.ts`, `test/automation-server/client.unit.test.ts`

- [ ] a drive reserves with the definition's mode, the run's ISO and its pin; a `fresh` unpinned
      drive sends mode `fresh` and no ISO or server; a diagnose sends none; a deferred job is re-sent
      with the same mode, ISO and pin next tick.

`test/automation-client/http.unit.test.ts`, `test/automation-client/qemu.unit.test.ts`

- [ ] `mode`, `iso`, `server` reach the proxy's reserve; a 503 is `AtCapacity`; 400 and 404 are
      `Internal` carrying the message.

`test/ctrl/command.unit.test.ts`, `test/ctrl/prompts.unit.test.ts`, `test/ctrl/linear.unit.test.ts`

- [ ] `test define --mode mint` is stored and listed; omitted on a new name is `fresh`; on a known
      name it is carried forward; a bad mode is refused.
- [ ] `test new` writes `--mode <m>` from the definition into every ticket's start line.
- [ ] `mint` creates one pinned run, result and ticket per live host whose stats do not list the
      ISO as minted, dedupes two servers on one host, prints the JSON; every host minted prints
      `[]`; no live qemu server fails `mint: no live qemu server`; no `mint` definition fails naming
      `test define`; `--iso` refuses http; `--server-url` falls back to `SERVER_URL`.
- [ ] `mint --verify` picks minted hosts and uses `mint-verify` with `--mode resume`;
      `mint --server <url>` creates exactly one ticket whether or not that host is minted, and
      refuses a url that is not a live qemu server.
- [ ] the mint ticket title names the machine and the ISO; `SERVER_URL` is the proxy.

`test/dashboard/servers.unit.test.ts`

- [ ] the servers page shows host and the minted names per server.

`test/integration/*`

- [ ] `db`: `test_definitions.mode` defaults `fresh`; `test_runs.pinned_server` defaults null; the
      live-servers-with-stats query returns url, name, stats for live rows only.
- [ ] `qemu-process` (gated on the binary): overlay on a real base plus convert round-trip; overlay on
      a missing base fails.
- [ ] `client`: `./client save --help` exits 0; a missing `--session-id` pins the first stderr line.
- [ ] `ctrl`: `./ctrl mint --help` exits 0; missing `DATABASE_URL` and `LINEAR_API_TOKEN` pin their
      first stderr lines.

Fakes: `test/support/fake-qemu.ts` gains the prepare source, `powerdown`/`exited` hooks and
`varsPath`; `fakeIso` gains `pathOf`; `test/support/fake-minted.ts` (new) records calls per method.

## 1. Domain, contract, errors, api

`src/shared/domain.ts`

```ts
export const SessionMode = Schema.Literals(["fresh", "mint", "resume"]).annotate({
  identifier: "@oligarchy/shared/domain/SessionMode",
});
export type SessionMode = typeof SessionMode.Type;

export const SessionConfig = Schema.Struct({
  iso: Schema.String,
  disk: Schema.optionalKey(Schema.String),
  mode: SessionMode,
});

// The ISO cache's file name for an iso, moved here from qemu/iso.ts: the proxy and ctrl compare
// it against a server's minted list, so all three must agree on it.
export const isoCacheName = (iso: string): string => ...; // the body of Iso.cacheFileName
```

- [ ] `ActionName` gains `"save"`.
- [ ] `QmpCommand` gains
      `{ execute: Literal("system_powerdown"), arguments: Struct({}), id: Int }`.
- [ ] `src/db/schema.ts` `SessionConfig` type gains `mode`.

`src/shared/contract.ts`

```ts
export class StartBody extends Schema.Class<StartBody>("@oligarchy/shared/contract/StartBody")({
  iso: Schema.NonEmptyString,
  disk: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
  mode: Domain.SessionMode.pipe(Schema.withConstructorDefault(Effect.succeed("fresh" as const))),
}) {}

export class ReserveAgentBody extends Schema.Class<ReserveAgentBody>(
  "@oligarchy/shared/contract/ReserveAgentBody",
)({
  agent: Schema.NonEmptyString,
  mode: Domain.SessionMode.pipe(Schema.withConstructorDefault(Effect.succeed("fresh" as const))),
  iso: Schema.optionalKey(Schema.NonEmptyString),
  server: Schema.optionalKey(Domain.ServerUrl),
}) {}

export class SaveBody extends Schema.Class<SaveBody>("@oligarchy/shared/contract/SaveBody")({
  id: Schema.String,
  agent: Schema.NonEmptyString,
}) {}
// Stats gains: host: Schema.String, minted: Schema.Array(Schema.String)
```

- [ ] `ReserveBody` (automation) gains the same `mode`, `iso?`, `server?`.
- [ ] `src/shared/errors.ts`: `SaveFailed` (`{ message, cause?, sessionId, agentId }`,
      `httpApiStatus: 502`, `[ErrorReporter.ignore]`), `SaveFailedWire`, an arm in the `apiStatus`
      table. `NotFound` gains a `message` field defaulting to `not found`, so `unregister` is
      unchanged.
- [ ] `src/shared/api.ts`: `save = HttpApiEndpoint.post("save", "/save", { payload: SaveBody,
      success: Ok, error: [ForbiddenWire, UnknownSessionWire, SaveFailedWire] })`, added to `Sessions`
      and `RoutedSessions`; `RouteBoundary` errors gain `NotFoundWire`.

## 2. QEMU pieces

- [ ] `src/qemu/args.ts`: `ArgsInput.iso` becomes `cdrom: string | undefined`; emit
      `["-cdrom", cdrom, "-boot", "order=d"]` only when defined.

`src/qemu/process.ts`

```ts
export const createOverlay = Effect.fn("Process.createOverlay")(function* (
  path: string,
  backing: string,
) {
  // qemu-img create -f qcow2 -b <backing> -F qcow2 <path>; a non-zero exit fails as createDisk does
});

export const convert = Effect.fn("Process.convert")(function* (from: string, to: string) {
  // qemu-img convert -O qcow2 <from> <to>
});
```

`src/qemu/iso.ts`

```ts
// The path QEMU boots this iso from, downloaded or not: the cache file for a url, the resolved
// path for a file. getIso resolves through it; the minted disk sits beside it.
readonly pathOf: (name: string) => Effect.Effect<string>;
```

`src/qemu/qemu.ts`

```ts
export type DiskSource =
  | { readonly _tag: "fresh" }
  | { readonly _tag: "existing"; readonly path: string }
  | { readonly _tag: "minted"; readonly disk: string; readonly vars: string };
// prepare(id, source): fresh creates the blank disk; existing uses the path; minted runs
// createOverlay(dir/disk.qcow2, source.disk) and copies source.vars instead of Args.OVMF_VARS.
// StartInput.iso becomes cdrom: string | undefined.
// QemuHandle gains diskPath, varsPath, powerdown(record) (QMP system_powerdown) and exited.
export const hostName: string = hostname(); // node:os, already this file's exception
```

- [ ] `args.ts`, `process.ts`, `iso.ts`, `qemu.ts` as above; `cacheFileName` becomes an import of
      `Domain.isoCacheName`.

## 3. `src/qemu/minted.ts` (new)

The exported surface, as bare declarations:

```ts
export type MintedDisk = { readonly disk: string; readonly vars: string };
// Pure: the two file names beside an iso path.
export const filesFor: (isoPath: string) => MintedDisk; // `${isoPath}.qcow2`, `${isoPath}.OVMF_VARS.fd`
export type MintedService = {
  // Both files present beside iso.pathOf(name), or none.
  readonly find: (iso: string) => Effect.Effect<Option.Option<MintedDisk>>;
  // Cache names minted on this machine: every <name>.qcow2 in the cache directory with its
  // <name>.OVMF_VARS.fd beside it.
  readonly list: Effect.Effect<ReadonlyArray<string>>;
  // Firmware file then disk, each <target>.partial-<pid> then rename, over whatever is there.
  readonly save: (
    iso: string,
    from: { readonly disk: string; readonly vars: string },
  ) => Effect.Effect<void, Errors.SaveFailed>;
};
export class Minted extends Context.Service<Minted>()("@oligarchy/qemu/Minted", { make }) {}
```

Rules:

- Depends on `Iso.Iso` (for `pathOf`), `Iso.Host` (pid, home), `FileSystem`, `Path`,
  `ChildProcessSpawner`, `Log`. `iso.ts` is otherwise untouched: it addresses the ISO file and its
  partials by exact name and keys its manifest by file name, so the two new siblings are invisible
  to it.
- `save` copies the firmware file first and converts the disk last, so a `.qcow2` in place always
  has its firmware beside it. A failure at either step removes that step's partial and leaves what
  was there before.
- No file is ever read for content. Presence is the whole record.

- [ ] `minted.ts` as above.

## 4. Sessions (`src/qemu-server/sessions.ts`)

```ts
type Reservation = { readonly since: number; readonly mode: Domain.SessionMode; readonly iso?: string };
// slots.reserved: ReadonlyMap<string, Reservation>
// LiveSession gains mode and iso.
readonly reserve: (body: Contract.ReserveAgentBody) => Effect<void, AtCapacity | BadRequest>;
readonly save: (live: LiveSession) => Effect<void, BadRequest | SaveFailed | Internal | UnknownSession>;
```

- [ ] `reserve`: `mint`/`resume` without `iso` is `BadRequest`; take the slot; `resume` then
      `minted.find(iso)`, none is `BadRequest` `no minted disk for <iso> on this machine` and the
      slot goes back.
- [ ] `start`: peek the reservation; a differing mode, or a differing ISO when the mode is not
      `fresh`, is `BadRequest` with the reservation kept; `resume` re-checks `minted.find`; then
      consume as today. In `launch`, `resume` skips `iso.getIso`, calls
      `qemu.prepare(id, { _tag: "minted", ...found })` and `qemu.start(prepared, { cdrom: undefined, ... })`;
      the row is inserted `running`. The config carries `mode`.
- [ ] `save`: mode not `mint` is `BadRequest` `only a mint session can save`; take ownership from
      the map as `stop` does; if `live.qemu.exited` is not done, `live.qemu.powerdown(recorder(live))`
      under `followed(live, "save", ...)`; `Effect.timeoutOrElse({ duration: "2 minutes", orElse: ... })`
      on `exited` failing `SaveFailed` `guest did not power off within 2 minutes`;
      `minted.save(iso, { disk: live.qemu.diskPath, vars: live.qemu.varsPath })`; kill;
      `endSession(id, "succeeded", "saved; minted <iso>")`; log; `finishLiveSession`. Any failure
      after ownership: capture the debug log, kill, `endSession failed` with the message,
      `finishLiveSession`, fail `SaveFailed`.
- [ ] `stats`: build `Contract.Stats` with `host: Qemu.hostName` and `minted: yield* minted.list`.
- [ ] `src/qemu-server/handlers.ts`: a `save` handler (`lookup` then `save`, uninterruptible);
      `reserve` passes the whole payload.
- [ ] `Sessions.layer` requires `Minted.Minted`; `src/qemu-server/main.ts` provides
      `Minted.Minted.layer` beside `Iso.Iso.layer`.

## 5. Proxy (`src/qemu-reverse-proxy/router.ts`)

`reserve(request, body)`, the pinned path:

```ts
if (body.server !== undefined) {
  const url = body.server;
  const known = (yield* store.listServers(SERVER_TYPE)).includes(url);
  if (!known) {
    return yield* Errors.NotFound.make({ message: `no server ${url}` });
  }
  yield* probe(url, who); // ServerFailed when down
  const response = yield* send(url, request).pipe(Effect.mapError((e) => unreachable(url, e, who)));
  const text = yield* response.text.pipe(Effect.mapError((e) => unreachable(url, e, who)));
  if (response.status === 200) {
    yield* store.routeAgent(agent, url);
  }
  return HttpServerResponse.text(text, {
    status: response.status,
    headers: forwardedHeaders(response.headers),
  });
}
```

- [ ] Unpinned: after probing, when `body.mode === "resume"` keep only servers whose
      `stats.minted` includes `Domain.isoCacheName(body.iso)`; an empty set is `NoServer`
      `no server has minted <iso>`; then rank and try as today.
- [ ] `/save` joins the `forward` routes.

## 6. Client

- [ ] `src/client/command.ts`: `start` gains
      `mode: Flag.choice("mode", Domain.SessionMode.literals).pipe(Flag.withDefault("fresh"), Flag.withDescription("fresh boots the iso on a blank disk, mint may save it, resume boots the machine's minted disk"))`.
- [ ] a `save` command with the shared agent, server and session flags, printing `saved` on
      success.
- [ ] `src/client/proxy-client.ts`: `save(body: SaveBody)`.
- [ ] `client-with-image`: no screenshot after `save`, as after `stop`.

## 7. Database and automation

`src/db/schema.ts`

```ts
export const sessionMode = pgEnum("session_mode", ["fresh", "mint", "resume"]);
// test_definitions: mode: sessionMode("mode").notNull().default("fresh"),
// test_runs: pinnedServer: text("pinned_server"),
// ServerStats gains host: string and minted: ReadonlyArray<string>
```

- [ ] `npm run db:generate` for the one migration. `Domain.SessionMode` is the enum's twin,
      maintained by hand together.
- [ ] `src/db/servers.ts`: `listLiveServerStats(type)` selecting `url`, `name`, `stats` for live
      rows.
- [ ] `src/db/tests.ts`: `createRun` takes `pinnedServer?`; `defineTest` takes `mode`;
      `findPlacement(resultId)` returning `{ mode, iso, pinnedServer }` from result → run and
      definition.
- [ ] `src/qemu-server/heartbeat.ts`: write `host` and `minted` into the row.
      `src/dashboard/servers.tsx`: show them.
- [ ] `src/automation-server/worker.ts` `place`:
      `const placement = yield* tests.findPlacement(job.resultId)`;
      `AutomationClient.reserve(client.url, ticket, job.action, placement)`, where a drive sends
      `mode`, `iso` (when not `fresh`) and `server` (when pinned), and a diagnose sends the ticket and
      action only.
- [ ] `src/automation-client/handlers.ts` and `qemu.ts`: pass `mode`, `iso`, `server` into
      `ReserveAgentBody.make`.
- [ ] `src/automation-client/opencode.ts`: raise `CEILING` to `"60 minutes"`; an install-to-desktop
      drive does not fit thirty.

## 8. ctrl

- [ ] `test define --mode` (`Flag.choice(Domain.SessionMode.literals)`, optional; a new name defaults
      `fresh`, a known name carries the previous mode forward).
- [ ] `test new` renders `--mode {{MODE}}` in the ticket's start line from the definition;
      `prompts/linear-issue.html` gains `{{MODE}}` there.

New command:

```ts
const mintCommand = Command.make(
  "mint",
  {
    serverUrl: serverUrlFlag,
    iso: isoFlag, // https only, as test new
    verify: Flag.boolean("verify").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Verify the minted disk on every host that has it instead of minting"),
    ),
    server: Flag.string("server").pipe(
      Flag.withSchema(Domain.ServerUrl),
      Flag.optional,
      Flag.withDescription("This qemu server only, minted or not"),
    ),
  },
  ({ serverUrl, iso, verify, server }) => Effect.gen(function* () { /* below */ }),
).pipe(Command.withDescription("One pinned mint (or verify) run and ticket per live qemu host"));
```

Body, in order:

1. Load the newest `mint` (or `mint-verify`) definition; none is
   `mint: no definition named <name>; define it with ./ctrl test define --name <name> --mode <mint|resume> ...`.
2. `listLiveServerStats("qemu")`; empty is `mint: no live qemu server`.
3. One server per `stats.host`, first registered wins. Keep hosts whose `stats.minted` lacks
   `isoCacheName(iso)` (mint) or has it (verify), or exactly `--server`, refusing a url not in the
   live list.
4. Per host: the run with `pinnedServer`, the result, the Linear issue titled
   `mint <name>: <iso>` (or `verify <name>: <iso>`) with `SERVER_URL` = `--server-url`.
5. Print the JSON array of `{ runId, resultId, linearId, server, host }`; `[]` when nothing to do.

- [ ] `mint` as above.

## 9. Docs and data

- [ ] `client.md`: `--mode` on `start`, a `save` section, table of contents lines.
- [ ] `ctrl.md`: `--mode` on `test define`, a `mint` section, synopsis and table of contents.
- [ ] Operator data, not code:
      `./ctrl test define --name mint --mode mint --description ... --instruction "<install with the fixed user, password and passphrase, reboot, confirm the desktop, ./ctrl test-results success, ./client save>" --proof ...`
      and `./ctrl test define --name mint-verify --mode resume ...`; `--mode resume` on every
      definition that assumes an installed system.

## 10. Verify

- [ ] `npm run check:fast`; `npm run test:integration` for `qemu-process`, `client`, `ctrl`, `db`,
      `qemu-server`, `qemu-reverse-proxy`.
- [ ] On the QEMU host, by hand through the proxy: reserve and start one `mint` session with
      `./client`, install, `save`; confirm `<iso>.qcow2` and `<iso>.OVMF_VARS.fd` beside the cached
      ISO; then `start --mode resume` and confirm the guest boots from the disk without the ISO.
- [ ] Confirm on the host that the installer's reboot lands on the disk with the ISO still
      attached (OVMF follows its NVRAM entry; `-boot order=d` is a SeaBIOS knob it ignores), and that
      `system_powerdown` shuts the installed system down from where the driver leaves it.
- [ ] GPT-5.6 Sol review with the prompt from `development.md`, then ship.

## Operating recipe, once shipped

1. `./ctrl test define --name mint --mode mint ...` and `./ctrl test define --name mint-verify --mode resume ...` once.
2. `./ctrl mint --server-url <proxy> --iso <url>`: one ticket per machine; move them to Automation
   Needed; wait for Done.
3. `./ctrl mint --verify --server-url <proxy> --iso <url>`: one ticket per minted machine; a failed
   verdict is `./ctrl mint --server <url> --server-url <proxy> --iso <url>` for that machine, whose
   save overwrites the disk.
4. `GET /servers` on the proxy, or the servers page, shows every machine's `minted` names. When
   every host lists the ISO, queue the `resume` batch; the dispatcher fills the fleet up to the sum
   of `--max-jobs`, and each session boots in seconds.
