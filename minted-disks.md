# Minted disks

A plan, written to be worked on. Check items off as they land. Tests come first in every step;
no code lands until its failing tests describe it (`development.md`, Tests).

## What this is

A test today boots the Omarchy ISO on a blank 40G disk and installs before it can do anything.
This plan mints, once per machine, a disk with Omarchy installed and a known user on it, and lets
every later session boot a throwaway copy of that disk in seconds.

- One qemu server process per session slot, one or more processes per machine, and the machines
  share nothing. A minted disk is therefore a per-machine artifact, and one minting session per
  machine produces it. Two processes on one machine share the same home directory and so the same
  minted disk, as they share the ISO cache today.
- Copies are qcow2 overlays: `qemu-img create -f qcow2 -b <minted> -F qcow2 <session>/disk.qcow2`.
  The minted disk is never written; the overlay lives and dies with the session directory, exactly
  as the blank disk does now. Twenty-eight sessions on one machine are twenty-eight overlays of one
  file.
- The firmware NVRAM travels with the disk. `Qemu.prepare` copies a pristine `OVMF_VARS.4m.fd`
  into every session directory and the installer writes its boot entry into that copy; the minted
  disk keeps that file beside `disk.qcow2` and a resume copies it instead of the pristine one.

## Vocabulary

- `mode`: what a session is. `fresh` boots the ISO on a blank disk (today). `mint` boots the ISO on a
  blank disk and may `save`. `resume` boots the machine's minted disk with no ISO attached.
- minted disk: `~/.oligarchy/disks/<key>/disk.qcow2` and `OVMF_VARS.fd`, `<key>` being
  `Iso.cacheFileName(iso)`. One shared `~/.oligarchy/disks/manifest.json` carries `minting` claims
  and `saved` entries, the ISO cache's pattern one directory over.
- `save`: the call that ends a `mint` session and keeps its disk as the machine's minted disk for
  that ISO.
- pin: `test_runs.pinned_server`, a qemu server url the reserve must land on. Null means unpinned.

## Decisions

- `save` ends the session: QMP `system_powerdown` (skipped when the guest already exited), wait for
  QEMU to exit with a bound of two minutes, `qemu-img convert` into a partial directory beside the
  vars copy, one rename into place, row closed `succeeded` with `saved; disk for <iso>`. A clean
  shutdown makes a clean image; a copy taken from a running guest is only crash-consistent.
- A `save` replaces an existing minted disk on that machine. Redoing a machine is minting it again.
- The reserve carries `mode`, `iso` and an optional `server` pin. The proxy honors a pin exactly and
  never falls back to another server. An unpinned `resume` is placed only on a server whose stats
  show the disk `saved`. `fresh` and `mint` are ranked as today.
- The qemu server refuses a `mint` reserve while a live `minting` claim for that ISO exists on its
  machine, whoever placed it; the claim is written before the reserve answers, so the next probe and
  the sibling process on the same machine both see it.
- One ticket per machine. `./ctrl mint` creates one pinned run, result and Linear ticket per live
  qemu host lacking the disk. Everything downstream is the existing pipeline: the ticket enters
  Automation Needed, the drive is dispatched with the run's mode, ISO and pin, the driver installs
  and saves, moves the ticket to Needs Review, the diagnoser closes it. Each machine's verdict is a
  ticket on the board. `./ctrl mint --verify` does the same with the `mint-verify` definition on the
  hosts that hold the disk.
- Sequencing (mint, then verify, then redo failures) is the operator's or the super-run script's.
  Nothing in the automation server coordinates a campaign.
- The credentials the minted user has (name, password, disk passphrase) are a fixed convention
  written into the `mint` definition's instruction and into every `resume` definition's
  instruction. They are data, stored and versioned with `./ctrl test define`.
- Pins are urls, the `servers` primary key and what the proxy routes with. A url the proxy does not
  know is a 404.

## HTTP answers

| Where | Case | Answer |
|---|---|---|
| qemu server `/reserve` | `mint` or `resume` without `iso` | 400 `mode "<m>" needs an iso` |
| qemu server `/reserve` | `mint`, live claim on this machine | 400 `already minting <iso> on this machine` |
| qemu server `/reserve`, `/start` | `resume`, no minted disk here | 400 `no saved disk for <iso> on this machine` |
| qemu server `/start` | mode or iso differs from the reservation | 400, reservation stands |
| qemu server `/save` | session is not `mint` | 400 `only a mint session can save` |
| qemu server `/save` | guest did not power off, convert failed | 502 `SaveFailed`, row `failed`, debug log, claim released |
| qemu server `/save` | racing the sweep | 404 `UnknownSession` |
| proxy `/reserve` | pinned url not registered | 404 `no server <url>` |
| proxy `/reserve` | pinned server unreachable | 502 `ServerFailed` |
| proxy `/reserve` | pinned server full | 503 passed through; the job defers with its pin |
| proxy `/reserve` | `resume`, no server holds the disk | 503 `NoServer` `no server has a saved disk for <iso>`; the job defers until a save lands |

The automation client keeps its mapping: 503 is `AtCapacity` (deferred), anything else closes the
job with the message.

## Tests first

`test/shared/domain.unit.test.ts`

- [ ] `SessionMode` accepts `fresh|mint|resume`, refuses anything else; `SessionConfig` round-trips
      `mode`; a `save` follow action encodes and decodes.

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

`test/qemu/qemu.unit.test.ts`

- [ ] `prepare` with a `saved` source creates the overlay and copies the saved vars, not the pristine
      ones; a failing `qemu-img` fails `QemuStartError` and the dir finalizer still runs.
- [ ] `start` without a cdrom boots; the handle exposes `varsPath`, `powerdown` (a recorded
      `system_powerdown` exchange) and `exited`.

`test/qemu/disks.unit.test.ts` (new)

- [ ] `list` reports saved dirs and live `minting` claims, ignores `.partial-*` dirs and stale
      claims, warns on an unreadable manifest and still answers.
- [ ] `claim` writes `minting` with agent and heartbeat; a second claim for the same ISO is
      `BadRequest` while live and succeeds once stale.
- [ ] `release` removes only that agent's `minting` entry; `refresh` bumps the heartbeat of the
      given agents' entries only.
- [ ] `save` converts into the partial dir, copies vars, renames into place, replaces an existing
      dir, writes `saved`; a failing convert removes the partial and leaves the claim.
- [ ] two services on one directory see each other's claims and saves.

`test/qemu-server/sessions.unit.test.ts`

- [ ] reserve: `mint` claims and holds mode and ISO on the reservation; `mint` with a live claim is
      `BadRequest` `already minting <iso> on this machine` and the slot is given back; `resume`
      without a saved disk is `BadRequest` `no saved disk for <iso> on this machine`; `mint` or
      `resume` without an ISO is `BadRequest`; `fresh` is unchanged.
- [ ] start: mode or ISO differing from the reservation is `BadRequest` and the reservation stands;
      `resume` never calls `getIso`, prepares from the saved disk, inserts the row `running` with
      `mode` in its config; `mint` inserts `mode: mint`.
- [ ] save: on a `fresh` or `resume` session is `BadRequest`; the happy path records the powerdown
      action, awaits exit, saves, closes the row `succeeded` with `saved; disk for <iso>`, frees the
      slot, tells followers last; a guest already exited is saved without a powerdown exchange; a
      guest that never powers off within the bound is killed, row `failed`, debug log saved, claim
      released, `SaveFailed`; a failing convert ends the row `failed` and releases the claim; racing
      the sweep is `UnknownSession`.
- [ ] claims: the sweep refreshes this process's claims; an expired mint reservation releases its
      claim; a mint session stopped, timed out or drained releases its claim.
- [ ] stats: `disks` lists saved and minting entries; `host` is the host name.

`test/qemu-server/http.unit.test.ts`, `test/qemu-server/heartbeat.unit.test.ts`

- [ ] `POST /save` 200; 400, 404, 502 with `{ error }`; `/stats` carries `host` and `disks`; the
      servers row's stats carry both.

`test/qemu-reverse-proxy/http.unit.test.ts`

- [ ] a pinned reserve goes to that url only, probed first, its 200 and its 503 passed through; an
      unregistered url is 404 `no server <url>`; an unreachable pinned server is `ServerFailed`.
- [ ] an unpinned `resume` lands only on a server whose stats show the ISO `saved`, ranked by qemus
      among those; none is `NoServer` `no server has a saved disk for <iso>`; `fresh` and `mint`
      rank as today.
- [ ] `/save` forwards to the session's server.

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
- [ ] `mint` creates one pinned run, result and ticket per live host lacking the disk, dedupes two
      servers on one host, prints the JSON; every host covered prints `[]`; no live qemu server
      fails `mint: no live qemu server`; no `mint` definition fails naming `test define`; `--iso`
      refuses http; `--server-url` falls back to `SERVER_URL`.
- [ ] `mint --verify` picks holding hosts and uses `mint-verify` with `--mode resume`;
      `mint --server <url>` creates exactly one ticket and refuses a url that is not a live qemu
      server.
- [ ] the mint ticket title names the machine and the ISO; `SERVER_URL` is the proxy.

`test/dashboard/servers.unit.test.ts`

- [ ] the servers page shows host and disks per server.

`test/integration/*`

- [ ] `db`: `test_definitions.mode` defaults `fresh`; `test_runs.pinned_server` defaults null; the
      live-servers-with-stats query returns url, name, stats for live rows only.
- [ ] `qemu-process` (gated on the binary): overlay on a real base plus convert round-trip; overlay on
      a missing base fails.
- [ ] `client`: `./client save --help` exits 0; a missing `--session-id` pins the first stderr line.
- [ ] `ctrl`: `./ctrl mint --help` exits 0; missing `DATABASE_URL` and `LINEAR_API_TOKEN` pin their
      first stderr lines.

Fakes: `test/support/fake-qemu.ts` gains the prepare source, `powerdown`/`exited` hooks and
`varsPath`; `test/support/fake-disks.ts` (new) records calls per method.

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

export class Disk extends Schema.Class<Disk>("@oligarchy/shared/contract/Disk")({
  iso: Schema.String,
  status: Schema.Literals(["minting", "saved"]),
}) {}
// Stats gains: host: Schema.String, disks: Schema.Array(Disk)
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

`src/qemu/qemu.ts`

```ts
export type DiskSource =
  | { readonly _tag: "fresh" }
  | { readonly _tag: "existing"; readonly path: string }
  | { readonly _tag: "saved"; readonly disk: string; readonly vars: string };
// prepare(id, source): fresh creates the blank disk; existing uses the path; saved runs
// createOverlay(dir/disk.qcow2, source.disk) and copies source.vars instead of Args.OVMF_VARS.
// StartInput.iso becomes cdrom: string | undefined.
// QemuHandle gains varsPath, powerdown(record) (QMP system_powerdown) and exited (the process's Deferred).
export const hostName: string = hostname(); // node:os, already this file's exception
```

- [ ] `args.ts`, `process.ts`, `qemu.ts` as above.

## 3. `src/qemu/disks.ts` (new)

The exported surface, as bare declarations:

```ts
export const HEARTBEAT_MS = 10_000;
export const STALE_MS = 30_000;
export const ManifestEntry: Schema.Union<[
  { status: "minting"; agentId: string; heartbeatAt: string },
  { status: "saved"; sessionId: string; savedAt: string },
]>;
export type SavedDisk = { readonly disk: string; readonly vars: string };
export type DisksService = {
  readonly list: Effect.Effect<ReadonlyArray<Contract.Disk>>;
  readonly find: (iso: string) => Effect.Effect<Option.Option<SavedDisk>>;
  readonly claim: (iso: string, agent: string) => Effect.Effect<void, Errors.BadRequest>;
  readonly refresh: (agents: ReadonlySet<string>) => Effect.Effect<void>;
  readonly release: (iso: string, agent: string) => Effect.Effect<void>;
  readonly save: (
    iso: string,
    agent: string,
    from: { readonly disk: string; readonly vars: string; readonly sessionId: string },
  ) => Effect.Effect<void, Errors.SaveFailed>;
};
export class Disks extends Context.Service<Disks>()("@oligarchy/qemu/Disks", { make }) {}
```

Rules:

- Directory `path.join(host.homeDir, ".oligarchy", "disks")`; `Iso.Host` reused for home and pid.
- Manifest writes under one `Semaphore.make(1)`, written to `manifest.json.partial-<pid>` then
  renamed, as `iso.ts` does.
- `find` is "the `<key>` directory exists". `list` is those directories plus `minting` entries
  whose heartbeat is within `STALE_MS`.
- `save` converts into `<key>.partial-<pid>/`, copies the vars beside it, renames any existing
  `<key>` to `<key>.old-<pid>`, renames the partial into place, removes the old directory, then
  writes the `saved` entry. A failed convert removes the partial and leaves the claim.
- Directory-name and key helpers are pure and stay outside Effect.

- [ ] `disks.ts` as above.

## 4. Sessions (`src/qemu-server/sessions.ts`)

```ts
type Reservation = { readonly since: number; readonly mode: Domain.SessionMode; readonly iso?: string };
// slots.reserved: ReadonlyMap<string, Reservation>
// LiveSession gains mode and iso.
readonly reserve: (body: Contract.ReserveAgentBody) => Effect<void, AtCapacity | BadRequest>;
readonly save: (live: LiveSession) => Effect<void, BadRequest | SaveFailed | Internal | UnknownSession>;
```

- [ ] `reserve`: `mint`/`resume` without `iso` is `BadRequest`; take the slot; `mint` then
      `disks.claim(iso, agent)`, a refusal gives the slot back; `resume` then `disks.find(iso)`, none
      is `BadRequest` `no saved disk for <iso> on this machine` and the slot goes back.
- [ ] `start`: peek the reservation; a differing mode, or a differing ISO when the mode is not
      `fresh`, is `BadRequest` with the reservation kept; `resume` re-checks `disks.find`; then
      consume as today. In `launch`, `resume` skips `iso.getIso`, calls
      `qemu.prepare(id, { _tag: "saved", ...found })` and `qemu.start(prepared, { cdrom: undefined, ... })`;
      the row is inserted `running`. The config carries `mode`.
- [ ] `save`: mode not `mint` is `BadRequest` `only a mint session can save`; take ownership from
      the map as `stop` does; if `live.qemu.exited` is not done, `live.qemu.powerdown(recorder(live))`
      under `followed(live, "save", ...)`; `Effect.timeoutOrElse({ duration: "2 minutes", orElse: ... })`
      on `exited` failing `SaveFailed` `guest did not power off within 2 minutes`;
      `disks.save(iso, agent, { disk: live.qemu.diskPath, vars: live.qemu.varsPath, sessionId })`;
      kill; `endSession(id, "succeeded", "saved; disk for <iso>")`; log; `finishLiveSession`. Any
      failure after ownership: capture the debug log, kill, `endSession failed` with the message,
      `finishLiveSession`, fail `SaveFailed`.
- [ ] `finishLiveSession`: for a `mint` session, `disks.release(iso, agent)`, a no-op once `save`
      flipped the entry. `expireReservations`: release expired mint claims. The sweep tick:
      `disks.refresh(agents holding mint reservations or sessions)`.
- [ ] `stats`: build `Contract.Stats` with `host: Qemu.hostName` and `disks: yield* disks.list`.
- [ ] `src/qemu-server/handlers.ts`: a `save` handler (`lookup` then `save`, uninterruptible);
      `reserve` passes the whole payload.
- [ ] `Sessions.layer` requires `Disks.Disks`; `src/qemu-server/main.ts` provides
      `Disks.Disks.layer` beside `Iso.Iso.layer`.

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

- [ ] Unpinned: after probing, when `body.mode === "resume"` keep only servers whose `stats.disks`
      has `{ iso: body.iso, status: "saved" }`; an empty set is `NoServer`
      `no server has a saved disk for <iso>`; then rank and try as today.
- [ ] `/save` joins the `forward` routes.

## 6. Client

- [ ] `src/client/command.ts`: `start` gains
      `mode: Flag.choice("mode", Domain.SessionMode.literals).pipe(Flag.withDefault("fresh"), Flag.withDescription("fresh boots the iso on a blank disk, mint may save it, resume boots the machine's saved disk"))`.
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
// ServerStats gains host: string and disks: ReadonlyArray<{ iso: string; status: "minting" | "saved" }>
```

- [ ] `npm run db:generate` for the one migration. `Domain.SessionMode` is the enum's twin,
      maintained by hand together.
- [ ] `src/db/servers.ts`: `listLiveServerStats(type)` selecting `url`, `name`, `stats` for live
      rows.
- [ ] `src/db/tests.ts`: `createRun` takes `pinnedServer?`; `defineTest` takes `mode`;
      `findPlacement(resultId)` returning `{ mode, iso, pinnedServer }` from result → run and
      definition.
- [ ] `src/qemu-server/heartbeat.ts`: write `host` and `disks` into the row.
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
      Flag.withDescription("Verify the saved disk on every host that holds it instead of minting"),
    ),
    server: Flag.string("server").pipe(
      Flag.withSchema(Domain.ServerUrl),
      Flag.optional,
      Flag.withDescription("This qemu server only"),
    ),
  },
  ({ serverUrl, iso, verify, server }) => Effect.gen(function* () { /* below */ }),
).pipe(Command.withDescription("One pinned mint (or verify) run and ticket per live qemu host"));
```

Body, in order:

1. Load the newest `mint` (or `mint-verify`) definition; none is
   `mint: no definition named <name>; define it with ./ctrl test define --name <name> --mode <mint|resume> ...`.
2. `listLiveServerStats("qemu")`; empty is `mint: no live qemu server`.
3. One server per `stats.host`, first registered wins. Keep hosts lacking the disk (mint) or
   holding it (verify), or exactly `--server`, refusing a url not in the live list.
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
      `./client`, install, `save`; then `start --mode resume` and confirm the guest boots from the
      disk without the ISO.
- [ ] Confirm on the host that the installer's reboot lands on the disk with the ISO still
      attached (OVMF follows its NVRAM entry; `-boot order=d` is a SeaBIOS knob it ignores), and that
      `system_powerdown` shuts the installed system down from where the driver leaves it.
- [ ] GPT-5.6 Sol review with the prompt from `development.md`, then ship.

## Operating recipe, once shipped

1. `./ctrl test define --name mint --mode mint ...` and `./ctrl test define --name mint-verify --mode resume ...` once.
2. `./ctrl mint --server-url <proxy> --iso <url>`: one ticket per machine; move them to Automation
   Needed; wait for Done.
3. `./ctrl mint --verify --server-url <proxy> --iso <url>`: one ticket per machine holding the disk;
   a failed verdict is `./ctrl mint --server <url> ...` for that machine.
4. `GET /servers` on the proxy, or the servers page, shows every machine's `disks`. When every host
   shows the ISO `saved`, queue the `resume` batch; the dispatcher fills the fleet up to the sum of
   `--max-jobs`, and each session boots in seconds.
