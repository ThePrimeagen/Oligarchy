# Minted disks

A plan, written to be worked on. Check items off as they land. Tests come first in every step;
no code lands until its failing tests describe it (`development.md`, Tests).

## What this is

A test today boots the Omarchy ISO on a blank 40G disk and installs before it can do anything.
This plan mints, on every qemu server, a disk with Omarchy installed and a known user on it, and
lets every later session boot a throwaway copy of that disk in seconds.

- The minted disk is two files beside the ISO, in the place the ISO cache already keeps it:
  `<iso>.qcow2` and `<iso>.OVMF_VARS.fd`, where `<iso>` is the path QEMU boots the ISO from
  (`<data dir>/isos/<name>` for a url, the resolved path for a local file). Whether an ISO is
  minted on a machine is whether those two files exist. No folder, no metadata, nothing to go
  stale.
- Copies are qcow2 overlays: `qemu-img create -f qcow2 -b <iso>.qcow2 -F qcow2 <session>/disk.qcow2`.
  The minted disk is never written; the overlay lives and dies with the session directory, exactly
  as the blank disk does now. Twenty-eight sessions on one machine are twenty-eight overlays of one
  file.
- The firmware NVRAM travels with the disk. `Qemu.prepare` copies a pristine `OVMF_VARS.4m.fd`
  into every session directory and the installer writes its boot entry into that copy; `save` keeps
  that file as `<iso>.OVMF_VARS.fd` and a resume copies it instead of the pristine one.
- Every server is minted. `./ctrl mint` creates one ticket per live qemu server, pinned to it; the
  driver on each boots the ISO fresh (the server downloads it if it does not have it), installs to
  the desktop, and saves. Nothing reports what is minted where: a resume is placed like any
  session, and a server that lacks the disk refuses the start loudly. A second mint overwrites.

## Vocabulary

- `mode`: what a session boots. `fresh` boots the ISO on a blank disk (today, and the default).
  `resume` boots the machine's minted disk with no ISO attached, and so needs one to exist. There
  is no third state: any fresh session may `save`; a resumed one cannot (below).
- minted disk: `<iso>.qcow2` and `<iso>.OVMF_VARS.fd` beside the ISO's path. Present means minted.
- `save`: the call that ends a session and writes its disk and firmware file into place as the
  minted disk of the ISO it named.
- pin: `test_runs.pinned_server`, a qemu server url the reserve must land on. Null means unpinned.

## Landed

- `POST /save` on the qemu server (#138): QMP `system_powerdown` unless the guest already exited,
  wait up to two minutes for QEMU to exit, copy the firmware file and `qemu-img convert` the disk,
  both staged as `<target>.partial-<pid>` and only then renamed over whatever is there, firmware
  first and disk last; row `succeeded` with `saved; minted <iso>`. A guest that will not power off
  or a disk that cannot be kept ends the row `failed` with a debug log and answers 502
  `SaveFailed`. One save at a time per process.
- `qemu-server --data-dir` / `OLIGARCHY_DATA_DIR` (#139): where the iso cache and minted disks
  live, `~/.oligarchy` by default, so one machine runs several servers with a cache each.
- The proxy routes `/save` to the session's server (#140); `./client save` (#141).
- `./client start --resume` (#143): `StartBody.mode`, absent for fresh; the qemu server looks the
  minted disk up before consuming the reservation, so 400 `no minted disk for <iso> on this machine`
  leaves the reservation to relinquish or to start fresh with; a resume prepares an overlay of the
  minted disk with its firmware, downloads nothing, attaches no cdrom, records `mode: resume`; a
  resumed session cannot save (400, it runs on), since its overlay names the minted disk by path
  and another save may replace that file under it. `--disk` with `--resume` is refused.
- Lint: `no-nested-ternary` (#143).

## Decisions still to build against

- A resume is placed like any session. Every server is minted by procedure, so there is nothing to
  place around; a server that lacks the disk answers the start with 400 and the driver gives the
  reservation back with `relinquish`. No `minted` list in `/stats`, no resume filter in the proxy.
- The reserve gains one optional field, `server`: a url the proxy sends that reserve to and nowhere
  else. Unknown url is 404 `no server <url>`; unreachable is 502 `ServerFailed`; a 503 passes
  through and the job defers with its pin. Nothing else on the reserve changes.
- One ticket per server. `./ctrl mint` reads the live qemu servers from the `servers` table and
  creates, for each, one run pinned to it, one result on the `mint` definition, one Linear ticket.
  Everything downstream is the existing pipeline: Automation Needed, a drive dispatched with the
  pin, the driver installs and saves, Needs Review, the diagnoser closes it. Each server's mint is
  a ticket on the board.
- The `mint` definition is an ordinary `fresh` definition whose instruction installs with the fixed
  credentials, confirms the desktop, records the result and ends with `./client save`. The
  `mint-verify` definition is a `resume` definition that logs in and confirms the desktop. Every
  test that assumes an installed system is `--mode resume`, and its ticket's start line carries
  `--resume`.
- Sequencing (mint, then verify, then redo a failed server with `./ctrl mint --server <url>`) is the
  operator's or the super-run script's. Nothing coordinates a campaign.

## HTTP answers

| Where | Case | Answer |
|---|---|---|
| qemu server `/start` | `--resume`, not minted here | 400 `no minted disk for <iso> on this machine`, reservation stands |
| qemu server `/start` | `--resume` with `--disk` | 400 `a resume boots the minted disk; --disk cannot be given` |
| qemu server `/save` | session was started with `--resume` | 400 `a resumed session cannot save; its disk is a view of the minted one`, session runs on |
| qemu server `/save` | guest did not power off, copy or convert failed | 502 `SaveFailed`, row `failed`, debug log |
| qemu server `/save` | racing the sweep | 404 `UnknownSession` |
| proxy `/reserve` | pinned url not registered | 404 `no server <url>` |
| proxy `/reserve` | pinned server unreachable | 502 `ServerFailed` |
| proxy `/reserve` | pinned server full | 503 passed through; the job defers with its pin |

The automation client keeps its mapping: 503 is `AtCapacity` (deferred), anything else closes the
job with the message.

## 4. Reserve pin

Tests first:

- [ ] `test/shared/api.unit.test.ts`, `test/shared/errors.unit.test.ts`: `NotFoundWire` declared on
      the proxy's reserve path; `NotFound` carries a message (`not found` by default so `unregister`
      is unchanged).
- [ ] `test/qemu-reverse-proxy/http.unit.test.ts`: a pinned reserve goes to that url only, probed
      first, its 200 routes the agent and its 503 passes through, no other server is asked; an
      unregistered url is 404 `no server <url>`; an unreachable pinned server is `ServerFailed`; an
      unpinned reserve ranks as today; the body reaches the server as it came.
- [ ] `test/qemu-server/http.unit.test.ts`: a reserve carrying `server` is accepted by the qemu
      server and ignored (the field is the proxy's).

Code:

```ts
export class ReserveAgentBody extends Schema.Class<ReserveAgentBody>(
  "@oligarchy/shared/contract/ReserveAgentBody",
)({
  agent: Schema.NonEmptyString,
  // The proxy's: the one server this reserve may land on. A qemu server ignores it.
  server: Schema.optionalKey(Domain.ServerUrl),
}) {}
```

- [ ] `NotFound` gains `message` (default `not found`); `RouteBoundary` errors gain `NotFoundWire`.
- [ ] `Router.reserve`: when `body.server` is set, check it is registered, probe it, send the
      reserve to it, route the agent on 200, pass the answer through as it came.

## 5. Database and automation

Tests first:

- [ ] `test/integration/db.integration.test.ts`: `test_definitions.mode` defaults `fresh` and
      round-trips `resume`; `test_runs.pinned_server` defaults null and round-trips a url; the
      live-qemu-servers query returns url and name for live rows only.
- [ ] `test/automation-server/worker.unit.test.ts`, `client.unit.test.ts`: a drive of a pinned run
      reserves with `server`; an unpinned run sends none; a diagnose sends none; a deferred pinned
      job is re-sent with its pin next tick.
- [ ] `test/automation-client/http.unit.test.ts`, `qemu.unit.test.ts`: `server` reaches the proxy's
      reserve; a 404 from the proxy closes the job with the message, a 503 defers it.
- [ ] `test/ctrl/prompts.unit.test.ts`, `linear.unit.test.ts`: a `resume` definition's ticket has
      `--resume` on its start line, a `fresh` one does not.

Code:

```ts
export const sessionMode = pgEnum("session_mode", ["fresh", "resume"]);
// test_definitions: mode: sessionMode("mode").notNull().default("fresh"),
// test_runs: pinnedServer: text("pinned_server"),
```

- [ ] `npm run db:generate` for the one migration. `Domain.SessionMode` is the enum's twin,
      maintained by hand together.
- [ ] `ReserveBody.server?` (automation). `ServerStore.listLiveServers("qemu")` already answers url
      and id; the mint command needs `name` too.
- [ ] `TestStore`: `createRun` takes `pinnedServer?`; `defineTest` takes `mode`; `findPlacement(resultId)`
      answers `{ mode, pinnedServer }` from result → run and definition.
- [ ] `worker.ts` `place`: reads the placement and puts the pin in the `ReserveBody`; the automation
      client passes it into `ReserveAgentBody.make`.
- [ ] `prompts/linear-issue.html`: the start line ends with `{{RESUME}}`, ` --resume` for a `resume`
      definition and nothing otherwise.
- [ ] `src/automation-client/opencode.ts`: `CEILING` to `"60 minutes"`; an install-to-desktop drive
      does not fit thirty.

## 6. ctrl

Tests first:

- [ ] `test/ctrl/command.unit.test.ts`: `test define --mode resume` is stored and listed; omitted on
      a new name is `fresh`; on a known name it is carried forward; a bad mode is refused.
- [ ] `test/ctrl/command.unit.test.ts`: `mint` creates one pinned run, result and ticket per live
      qemu server, all of them, and prints the JSON; no live qemu server fails
      `mint: no live qemu server`; no `mint` definition fails naming `test define`; `--iso` refuses
      http; `--server-url` falls back to `SERVER_URL`; `--help` touches no service.
- [ ] `test/ctrl/command.unit.test.ts`: `mint --verify` uses `mint-verify`; `mint --server <url>`
      creates exactly one ticket and refuses a url that is not a live qemu server.
- [ ] `test/ctrl/prompts.unit.test.ts`, `linear.unit.test.ts`: the mint ticket names the server and
      the ISO; `SERVER_URL` is the proxy.
- [ ] `test/integration/ctrl.integration.test.ts`: `./ctrl mint --help` exits 0; missing
      `DATABASE_URL` and `LINEAR_API_TOKEN` pin their first stderr lines.

Code:

```ts
const mintCommand = Command.make(
  "mint",
  {
    serverUrl: serverUrlFlag,
    iso: isoFlag, // https only, as test new
    verify: Flag.boolean("verify").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Verify the minted disk on every server instead of minting"),
    ),
    server: Flag.string("server").pipe(
      Flag.withSchema(Domain.ServerUrl),
      Flag.optional,
      Flag.withDescription("This qemu server only"),
    ),
  },
  ({ serverUrl, iso, verify, server }) => Effect.gen(function* () { /* below */ }),
).pipe(Command.withDescription("One pinned mint (or verify) run and ticket per live qemu server"));
```

Body, in order:

1. Load the newest `mint` (or `mint-verify`) definition; none is
   `mint: no definition named <name>; define it with ./ctrl test define --name <name> ...`.
2. The live qemu servers; empty is `mint: no live qemu server`. `--server` narrows to that one,
   refusing a url not in the list.
3. Per server: the run with `pinnedServer`, the result, the Linear issue titled
   `mint <name>: <iso>` (or `verify <name>: <iso>`) with `SERVER_URL` = `--server-url`.
4. Print the JSON array of `{ runId, resultId, linearId, server }`.

- [ ] `test define --mode`; `mint` as above.

## 7. Docs and data

- [ ] `ctrl.md`: `--mode` on `test define`, a `mint` section, synopsis and table of contents.
- [ ] Operator data, not code:
      `./ctrl test define --name mint --description ... --instruction "<install with the fixed user, password and passphrase, reboot, confirm the desktop, ./ctrl test-results success, ./client save>" --proof ...`
      (a `fresh` definition, the default) and `./ctrl test define --name mint-verify --mode resume ...`;
      `--mode resume` on every definition that assumes an installed system.

## Verify

- [ ] `npm run check:fast`; `npm run test:integration` for `qemu-process`, `client`, `ctrl`, `db`,
      `qemu-server`, `qemu-reverse-proxy`.
- [ ] On the QEMU host, by hand through the proxy: reserve and start one `fresh` session with
      `./client`, install, `save`; confirm `<iso>.qcow2` and `<iso>.OVMF_VARS.fd` beside the cached
      ISO; then `start --resume` and confirm the guest boots from the disk without the ISO.
- [ ] Confirm on the host that the installer's reboot lands on the disk with the ISO still
      attached (OVMF follows its NVRAM entry; `-boot order=d` is a SeaBIOS knob it ignores), and that
      `system_powerdown` shuts the installed system down from where the driver leaves it.
- [ ] GPT-5.6 Sol review with the prompt from `development.md`, then ship.

## Operating recipe, once shipped

1. `./ctrl test define --name mint ...` (a `fresh` definition ending in `./client save`) and
   `./ctrl test define --name mint-verify --mode resume ...` once.
2. `./ctrl mint --server-url <proxy> --iso <url>`: one ticket per server; move them to Automation
   Needed; wait for Done.
3. `./ctrl mint --verify --server-url <proxy> --iso <url>`: one ticket per server; a failed verdict
   is `./ctrl mint --server <url> --server-url <proxy> --iso <url>` for that server, whose save
   overwrites the disk.
4. Queue the `resume` batch; the dispatcher fills the fleet up to the sum of `--max-jobs`, and each
   session boots in seconds.
