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
- pin: the qemu server url a mint ticket names. The proxy's `/reserve` takes it as `server` and
  sends that reserve there and nowhere else; the mint driver is the one who sends it. Nothing in
  the database knows about pins.

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
- The reserve pin (#145): `ReserveAgentBody.server`, the proxy's alone. A pinned reserve is
  probed and sent to that url only; its 200 routes the agent, its 503 passes through; an
  unregistered url is 404 `no server <url>` (`NotFound` carries a message now); an unreachable
  one is `ServerFailed`. A qemu server ignores the field.
- `./ctrl mint` and `./client reserve` (#146, in review): `mint --server-url <proxy> --iso <url>`
  creates, for every live qemu server, one run and one result under the `mint` definition and one
  Linear issue `Omarchy mint: <server url>` labelled `agent test` + `mint`, from its own template
  `prompts/mint-issue.html`, whose values include `PINNED_SERVER`; a failure part-way fails the run
  being created, names every ticket Linear did create, and leaves earlier servers' runs standing.
  `./client reserve --agent-id … [--server <url>]` is the driver's own reservation, pinned when
  `--server` is given. ctrl's database layer provides `ServerStore`. opencode's ceiling is 45
  minutes. `client.md` has `reserve`, `ctrl.md` has `mint`.

## What's left

In the order to do it. Each item's tests are listed under its section below.

1. **Merge #146**, then define the operator data once (not code):
   `./ctrl test define --name mint --description … --instruction "<user name, password and disk
   passphrase; defaults elsewhere>" --proof "<the desktop, after the reboot>"`. The ticket's
   procedure (relinquish, pinned reserve, fresh start, install, a second look, save, verdict) is the
   template's; the definition holds only the install's wording.
2. **First real mint, by hand** (Verify below): on the QEMU host through the proxy, one `fresh`
   session installed and saved, the two files beside the ISO, then a `start --resume` that boots
   from the disk without the ISO. Two facts to confirm there that the template can only hedge on:
   whether the installer's reboot lands on the disk with the ISO still attached (OVMF follows its
   NVRAM entry; `-boot order=d` is a SeaBIOS knob it ignores), and whether `system_powerdown` shuts
   the installed system down from where the driver leaves it. Tighten the template's reboot step
   to what is seen. Also whether 45 minutes of opencode ceiling fits an install; the plan said 60.
3. ~~`resume` definitions~~ Done more simply: every test ticket's start line carries `--resume`
   (`prompts/linear-issue.html`), the mint ticket is the only fresh start, and the ticket states the
   minted account (`prime`). No `mode` column, no flag, no placeholder.
4. **`mint --server <url>`** (section 6): redo one server whose mint failed, without ticketing the
   fleet. Small: narrow the live list to that url, refuse one not in it.
5. **Loose ends**: re-run the `db`, `qemu-server` and `qemu-reverse-proxy` integration suites where
   Docker exists (the cloud agent could not).

Dropped: `mint --verify`, a second ticket per server that would resume the disk and confirm the
desktop. The mint ticket confirms the desktop before it saves and records its verdict from what
`save` answered, the diagnoser closes it, and every test resumes — so the first test on a bad disk
says the same thing, with a session to look at. The redo for a failed mint is item 4.

Not planned, on purpose: a `minted` list in `/stats`, a resume filter in the proxy, a pin in the
database, a verify pass, retries or Sentry reports for a failed mint. A failed mint is a failed ticket on the
board, and the redo is item 4.

## Decisions still to build against

- A resume is placed like any session. Every server is minted by procedure, so there is nothing to
  place around; a server that lacks the disk answers the start with 400 and the driver gives the
  reservation back with `relinquish`. No `minted` list in `/stats`, no resume filter in the proxy.
- The pin lives in the ticket, not the database. The dispatcher reserves for a mint ticket as for
  any other, by rank; the mint driver gives that reservation back and reserves pinned to the server
  its ticket names, then starts fresh. The automation server, the automation client and the
  database do not know what a mint is. (Considered and set aside: `test_runs.pinned_server` read
  by the dispatcher into its reserve. Cleaner placement, three more components in the know.)
- One ticket per server. `./ctrl mint` reads the live qemu servers from the `servers` table and
  creates, for each, one run, one result on the `mint` definition, one Linear ticket naming that
  server. Everything downstream is the existing pipeline: Automation Needed, a drive dispatched,
  the driver installs and saves, Needs Review, the diagnoser closes it. Each server's mint is a
  ticket on the board.
- The mint ticket is its own template, `prompts/mint-issue.html`, not the test ticket with the
  words changed: the pinned machine, fresh only, the ISO attached through the reboot, a subagent's
  second look before the disk is kept, `save` instead of `stop`, and the verdict recorded from what
  `save` answered so a failed save can never sit under a success. Every way out closes the result.
  The `mint` definition holds only the install's wording (credentials, proof).
- Every test resumes. The test ticket's start line carries `--resume` for every definition, and the
  ticket states the account the mint created (user, password and disk passphrase `prime`); the mint
  ticket is the only fresh start. There is no per-definition mode: a test that needs a blank machine
  is not a thing this fleet runs.
- Sequencing (mint, then redo a failed server with `./ctrl mint --server <url>`) is the operator's
  or the super-run script's. Nothing coordinates a campaign.

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
| proxy `/reserve` | pinned server full | 503 passed through |
| proxy `/reserve` | agent already holds one | 400 `already reserved`; `relinquish` first |

The mint driver sees these through `./client reserve`; the ticket tells it what each one means.

## 5. Resume definitions

Superseded: every test ticket starts `--resume` (see What's left, 3). Nothing to build.

## 6. ctrl: one server

Tests first:

- [ ] `test/ctrl/command.unit.test.ts`: `mint --server <url>` creates exactly one ticket, for that
      server; a url that is not a live qemu server is refused before anything is created.

Code:

- [ ] `--server` (optional, `Domain.ServerUrl`) narrows the live list.
- [ ] `ctrl.md`: the flag in the `mint` section.

## Verify

- [x] `npm run check:fast`; `npm run test:integration` for `client` and `ctrl` (#146).
- [ ] `npm run test:integration` for `qemu-process`, `db`, `qemu-server`, `qemu-reverse-proxy`
      where Docker exists.
- [ ] On the QEMU host, by hand through the proxy: reserve and start one `fresh` session with
      `./client`, install, `save`; confirm `<iso>.qcow2` and `<iso>.OVMF_VARS.fd` beside the cached
      ISO; then `start --resume` and confirm the guest boots from the disk without the ISO.
- [ ] Confirm on the host that the installer's reboot lands on the disk with the ISO still
      attached (OVMF follows its NVRAM entry; `-boot order=d` is a SeaBIOS knob it ignores), and that
      `system_powerdown` shuts the installed system down from where the driver leaves it. Then
      tighten the template's reboot step.
- [ ] One real `./ctrl mint` against the fleet; read the tickets and the saved disks.
- [x] GPT-5.6 Sol review with the prompt from `development.md` (#146).

## Operating recipe, once shipped

1. `./ctrl test define --name mint …` (the install's wording; done, v1).
2. `./ctrl mint --server-url <proxy> --iso <url>`: one ticket per server; move them to Automation
   Needed; wait for Done. A failed one is `./ctrl mint --server <url> --server-url <proxy> --iso <url>`
   for that server, whose save overwrites the disk.
3. Queue the batch; every ticket resumes, the dispatcher fills the fleet up to the sum of
   `--max-jobs`, and each session boots in seconds.
