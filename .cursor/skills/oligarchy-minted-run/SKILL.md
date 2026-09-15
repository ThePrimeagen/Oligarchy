---
name: oligarchy-minted-run
description: >-
  Operate an Oligarchy minted-disk run: start the proxy, four QEMU servers
  with one job and one data dir (one minted disk) each, one automation
  client with four jobs, and the automation-server; mint every server once
  with ./ctrl mint, then run 100 counted Muse Spark 1.3 contributor
  lock-screen jobs on resumed disks, tick the board, analyze failures, and
  fix a confirmed harness defect. Use when the user asks to mint the fleet,
  run tests on minted disks, start four qemu servers, or operate the
  minted-disk pipeline.
---

<OligarchyMintedRun>
<Goal>
Two phases. **Mint:** every qemu server ends up holding the ISO's minted
disk in its own data dir, made by its own mint ticket. **Batch:** process
**100 COUNTED** lock-screen runs through drive + diagnose, every one of them
a `--resume` boot of a minted disk (seconds, no installer). INFRA attempts
are recorded and replaced; they do not count. After the batch: report
stability, whether the paid model landed on every result/diagnosis, whether
every session resumed (no installs), and whether `--max-jobs` was exercised
(four servers × 1 and one client × 4: four sessions at once, one per server).
</Goal>
<WriteableFiles>
| File | What goes here |
|------|----------------|
| `SCRATCH.md` | Live pad, mint phase included. Never paste secrets (`DATABASE_URL`, tokens). |
| `TODOS.md` | Non-blocking findings. |
| `automation-super-run-logs/muse/NNN-OLI-xxxx.md` | One file per retired batch run (`retire.sh`). |
| `automation-super-run-logs/index.tsv` | One TSV row per retire; column 2 is `COUNTED` or `INFRA`. |
| `automation-super-run-logs/processes/` | Server logs and `pids`. |
| repo source | **Only** for a confirmed blocking harness defect (see YourRole). |

Shared with `oligarchy-super-run`: same logs dir and ledger shape, different
ledger dir (`/tmp/mintedrun`). The two fleets never run together (same proxy
port, same tunnel). `reset.sh` wipes the first five for a fresh batch.
</WriteableFiles>
<Runs>
<model>openrouter/meta/muse-spark-1.3-contributor</model>
<count>100 COUNTED, after 4 mints</count>
<test>lock-screen (resumed); mint (fresh, once per server)</test>
<fleet>
<qemu-reverse-proxy port="55555"/>
<qemu-a port="55341" max-jobs="1" data-dir="$OLIGARCHY_DATA_ROOT/qemu-a"/>
<qemu-b port="55342" max-jobs="1" data-dir="$OLIGARCHY_DATA_ROOT/qemu-b"/>
<qemu-c port="55343" max-jobs="1" data-dir="$OLIGARCHY_DATA_ROOT/qemu-c"/>
<qemu-d port="55344" max-jobs="1" data-dir="$OLIGARCHY_DATA_ROOT/qemu-d"/>
<automation-client-4 port="52224" max-jobs="4"/>
<automation-server port="54321"/>
</fleet>
</Runs>
<WhyThisShape>
A minted disk lives beside the ISO in a server's data dir (`<data dir>/isos/<iso>.qcow2` and
`.OVMF_VARS.fd`). Four servers on one machine therefore need four data dirs, or they would share
one cache and one disk and four mints would overwrite each other. `--max-jobs 1` on each makes a
mint land on exactly one machine per server and keeps the batch at one guest per server. The one
client with `--max-jobs 4` fills all four. A mint ticket names its server; its driver gives back
the ranked reservation the dispatcher placed and reserves pinned to that server
(`./client reserve --server`), so each server mints itself. Nothing in the automation server or
the database knows what a mint is.
</WhyThisShape>
<YourRole>
- **Operator:** start/restart the seven processes, mint the fleet, create
  batch tickets (`new.sh`), run `/tmp/mintedrun/tick.sh` every minute,
  retire, abort INFRA, refill until 100 COUNTED, drain, write the pad.
- **Mint phase:** one `./ctrl mint`, four tickets, four drives. Not in the
  ledger; track them in `SCRATCH.md`. Done when all four results are passed
  and each data dir holds the ISO, its `.qcow2` and its `.OVMF_VARS.fd`. A
  failed mint is a failed ticket: read its session, fix what is the
  harness's (developing-agent rules), then mint the failed servers again
  with `./ctrl mint --server-url "$SUPER_RUN_SERVER_URL" --iso "$SUPER_RUN_ISO" --unminted`
  (needs `OLIGARCHY_TOKEN` in the environment; `.env` supplies it). It asks
  the proxy which servers still lack the disk and tickets those alone; a
  live server the proxy cannot reach refuses the whole command — fix the
  fleet first. A server whose disk is present but bad: remove its
  `<iso>.qcow2` and `<iso>.OVMF_VARS.fd`, then the same command. Without
  the flag every server is minted again (every save overwrites).
  Do not start the batch with an unminted server: every batch start there
  is refused with `no minted disk for <iso> on this machine`.
- **Analyze every `ANALYZE` line from `tick.sh`**, plus any stalled run.
  Spawn a `Task` `generalPurpose` subagent. Hand it ticket, result id,
  session id, `/tmp/mintedrun/status.sh "$RID"`,
  `SESSION_ID="$SID" ./ctrl session --all`, the client log and the
  qemu/proxy/server logs around the timestamps, and
  `~/.local/share/opencode/{opencode.db,log/opencode.log}`. Tell it to
  read `DATABASE_URL` from repo `.env` — do not paste secrets. Ask:
  cause, harness-or-model, exact fix if harness.
- **COUNTED:** model passed/failed, `driver_loop_ceiling`, agent quit
  early. Linear → Needs Review (or Done if the diagnosis is a clean pass
  you accept).
- **INFRA:** no qemu, webhook never made a drive job, cleanup/disk, proxy
  down, dispatch `ETIMEDOUT`, a start refused for a missing minted disk,
  operator/harness fault. Linear → Canceled. Record with
  `retire.sh N INFRA`, then replace (another `new.sh`).
- **Confirmed blocking harness defect:** pause refill, mark affected
  attempts INFRA, switch to developing-agent rules (`development.md`):
  failing happy+unhappy tests first, smallest fix, `check:fast`, restart
  the touched processes, resume. Non-blocking → `TODOS.md` only.
- `(result_id, action)` is unique. A failed diagnose job **cannot** be
  re-enqueued. Write the row with `./ctrl diagnose` or retire INFRA.
  Do not leave it on `active` forever.
</YourRole>
<HowToRun>
From the repo root. Cloudflare tunnel to `:55555` must already be up (`https://oligarchy-server.trm.sh`).
The `mint` test definition must exist (`./ctrl test --list --details --name mint`); `./ctrl mint`
refuses without it.

```bash
export OLIGARCHY_ROOT="$PWD"
export DBURL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
mkdir -p automation-super-run-logs/{muse,processes} /home/theprimeagen/personal/oligarchy-tmp
sh .cursor/skills/oligarchy-minted-run/scripts/install.sh   # also creates the four data dirs and seeds the ISO
# into each from ~/.oligarchy/isos (SUPER_RUN_ISO_CACHE) when it is there, so no server downloads
# 6 GB; prints `qemu-x: seeded` / `has the ISO` / `no … in …`. Minted disks are never touched.
. /tmp/mintedrun/env
```

**Fresh batch:** stop any old fleet (the seven ports must be free), then:

```bash
/tmp/mintedrun/reset.sh          # refuses if active is non-empty or a fleet port is bound
# /tmp/mintedrun/reset.sh --force  # skip both guards (you have confirmed nothing is in flight)
```

It never touches the database, Linear, session dirs, or the data dirs: minted disks survive a
reset on purpose. To start from unminted servers, remove `"$OLIGARCHY_DATA_ROOT"/qemu-*/isos/*.qcow2`
and `*.OVMF_VARS.fd` yourself (keep the ISO; it is a download).

Start **seven** processes. `./qemu-server` and `./automation-client` require `--name` and
`--max-jobs`. Each qemu server gets its own `--data-dir`. Announce with `--url` on
`http://127.0.0.1:…` (these binaries bind `127.0.0.1`; `localhost` can be `::1`). `--name` is
unique on `servers`. The client reserves guests through the proxy: `SERVER_URL=http://127.0.0.1:55555`.
`./automation-server` has no `--jobs` and defaults to **free** Muse — always pass the paid model.

```bash
P=automation-super-run-logs/processes
SESS=/home/theprimeagen/personal/oligarchy-tmp
export OLIGARCHY_SESSIONS_DIR="$SESS"

start_fleet() {
  if ss -ltn | grep -qE ':55341|:55342|:55343|:55344|:55555|:52224|:54321'; then
    echo "a listed port is already bound; stop that process first"
    return 1
  fi
  psql "$DBURL" -X -c "select name, type, url, heartbeat_at from servers where name in ('qemu-a','qemu-b','qemu-c','qemu-d','automation-client-4');"
  # live row, different url: stop that process. stale row: delete only that name's dead row, keep these five names.
  : > "$P/pids"

  ./qemu-reverse-proxy --port 55555 \
    >"$P/qemu-reverse-proxy.log" 2>&1 & echo "qemu-reverse-proxy $!" | tee -a "$P/pids"

  for s in a b c d; do
    case $s in a) port=55341 ;; b) port=55342 ;; c) port=55343 ;; d) port=55344 ;; esac
    TMPDIR="$SESS" ./qemu-server \
      --name "qemu-$s" --max-jobs 1 --port "$port" --url "http://127.0.0.1:$port" \
      --data-dir "$OLIGARCHY_DATA_ROOT/qemu-$s" \
      >"$P/qemu-$s.log" 2>&1 & echo "qemu-$s $!" | tee -a "$P/pids"
  done

  SERVER_URL=http://127.0.0.1:55555 ./automation-client \
    --name automation-client-4 --max-jobs 4 --port 52224 --url http://127.0.0.1:52224 \
    >"$P/automation-client-4.log" 2>&1 & echo "automation-client-4 $!" | tee -a "$P/pids"

  ./automation-server --port 54321 \
    --model openrouter/meta/muse-spark-1.3-contributor \
    >"$P/automation-server.log" 2>&1 & echo "automation-server $!" | tee -a "$P/pids"
}
start_fleet
```

Confirm seven pids, seven ports, four `listening on` lines ending in four different `data` dirs, no `heartbeat failed`,
five live fleet rows. `./ctrl automation --list` is the job queue, not the fleet.

```bash
sleep 2
cat "$P/pids"
ss -ltnp | grep -E '55341|55342|55343|55344|55555|52224|54321'
grep -E 'listening on|heartbeat failed' "$P"/qemu-*.log "$P"/automation-client-4.log "$P"/automation-server.log
psql "$DBURL" -X -c "select name, type, url, heartbeat_at from servers where heartbeat_at > now() - interval '45 seconds' order by type, name;"
```

Expect `qemu-a` … `qemu-d` (`qemu`) and `automation-client-4` (`automation-client`).

**Mint the fleet.** Start the mint by creating the Linear tickets, one per live qemu server.
Installs take up to 45 minutes; four run at once.

```bash
./ctrl mint --server-url "$SUPER_RUN_SERVER_URL" --iso "$SUPER_RUN_ISO"
# → JSON: [{ id, result, server, linear }, …] × 4. Note ticket ↔ server in SCRATCH.md.
sleep 20
psql "$DBURL" -X -c "select r.linear_id, j.action, j.status from test_results r join automation_jobs j on j.result_id = r.result_id where r.linear_id in ('OLI-…','OLI-…','OLI-…','OLI-…');"
# every ticket must show a drive job. One without: stop, diagnose (automation-server log), fix,
# cancel that ticket, then ./ctrl mint … --unminted
```

Watch each mint like a batch run (`./ctrl session --search --test-result-id "$RID"`, then
`SESSION_ID=… ./ctrl session --all`; the qemu log for that server). A mint is done when its result
is passed **and** the files exist:

```bash
for s in a b c d; do echo "== qemu-$s"; ls -la "$OLIGARCHY_DATA_ROOT/qemu-$s/isos/"; done
# expect, in every dir: the ISO, <iso>.qcow2, <iso>.OVMF_VARS.fd
# the same question to the fleet, as ./ctrl mint --unminted asks it:
curl -sS -H "Authorization: Bearer $(grep '^OLIGARCHY_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'")" \
  "http://127.0.0.1:55555/minted?iso=$SUPER_RUN_ISO" | jq .
# expect every server "minted"; "unminted" is a server to mint again, "unreachable" one to fix
```

A result passed with no files, or files with a failed result, is a harness defect: stop and analyze.
Do not start the batch until all four dirs hold the disk.

**Batch.** `N` is monotonic (`/tmp/mintedrun/next`). Never take N from `active`. Target:
`counted + active == 100` after replacing every INFRA. Four slots; keep enough pending drives that
all four are busy. Every batch ticket's start line carries `--resume`; a session that installs
instead is a defect in the ticket, not a run.

Start a run by creating its Linear ticket:

```bash
/tmp/mintedrun/new.sh muse
# exit 2 = no drive job: stop refill, diagnose (automation-server log), fix, retire.sh N INFRA
```

Each `AGENT_LOOP_TICK_mintedrun` you **do this work** (the sleep loop does not):

```bash
/tmp/mintedrun/tick.sh
# RETIRE n|…  → if ANALYZE is also printed, wait for the subagent, then:
/tmp/mintedrun/retire.sh "$N" COUNTED   # or INFRA
# STUCK no-drive-job → stop refill; diagnose (automation-server log); fix; retire.sh N INFRA
# STUCK diagnose=* no-diagnosis-row → ./ctrl diagnose … --model openrouter/meta/muse-spark-1.3-contributor
#        or retire INFRA. cannot re-enqueue diagnose
# LEDGER refill=yes → /tmp/mintedrun/new.sh muse
# LEDGER remaining=0 → no new.sh; drain until active is empty
```

Drive died, result still open:

```bash
SID=$(./ctrl session --search --test-result-id "$RID")
./ctrl test-results --agent-id "$TICKET" --id "$RID" --status failed --reason "operator: …"
./client stop --agent-id "$TICKET" --server-url http://127.0.0.1:55555 --session-id "$SID" --status aborted --reason "operator: …"
/tmp/mintedrun/linear-state.sh "$TICKET" "Needs Review"   # model: COUNTED
# /tmp/mintedrun/linear-state.sh "$TICKET" Canceled       # INFRA
```

Arm the wake-up only after the first batch ticket exists:

```bash
while true; do sleep 60; echo AGENT_LOOP_TICK_mintedrun; done
```

Drain: `tick.sh` + retire + cleanup, no `new.sh`, until `active` is empty.

**Done when** all four data dirs hold the minted disk, `index.tsv` has exactly 100 `COUNTED` rows,
`active` is empty, no running sessions/jobs, session dirs gone, every COUNTED result+diagnosis model
is the paid Muse, every COUNTED session's config says `mode: resume`, and `SCRATCH.md` names the
mint outcomes, the failures, and whether the harness needed a fix.

One run’s DB dump: `/tmp/mintedrun/status.sh "$RID"`. Resumed or not, per session:
`psql "$DBURL" -X -c "select id, config->>'mode' as mode, status from sessions order by started_at desc limit 20;"`
</HowToRun>
</OligarchyMintedRun>
