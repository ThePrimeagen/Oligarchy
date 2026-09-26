---
name: oligarchy-super-run
description: >-
  Operate an Oligarchy lock-screen super-run: clear every known temporary
  including ISOs, download the ISO twice into two data dirs, start two QEMU
  servers at width one plus two automation clients at two jobs each (and the
  proxy and automation-server), mint each server once, spawn the lock-screen
  ticket five times, then work through all ten counted Muse Spark 1.3
  contributor lock-screen tickets. Tick the board, analyze failures, and fix
  a confirmed harness defect. Use when the user asks for a super-run, ten
  lock-screen tickets, two qemu servers, or to drain this batch.
---

<OligarchySuperRun>
<Goal>
Three steps. **Clear:** delete every known temporary, including downloaded
ISOs and minted disks. **Mint:** download the ISO twice (one copy in each
data dir) and run two minting sessions, one per qemu server. **Lock-screen:**
spawn the lock-screen ticket five times, then work through all **ten**
lock-screen tickets (drive + diagnose). INFRA attempts are recorded and
replaced; they do not count. Every counted run is a `--resume` boot of a
minted disk. After the batch: report stability, whether the paid model
landed on every result/diagnosis, and whether `--max-jobs` was actually
exercised (qemu 1/1 and client 2/2: two guests at once, one per server;
four client slots).
</Goal>
<Disks>
This is always the super-run. **Clear every known temporary before every
batch**, including the first one on a machine that already has disks or
ISOs. A super-run never boots a disk or an ISO left by an earlier batch.

Wipe all of these, then start:

- Session directories under `OLIGARCHY_SESSIONS_DIR`.
- Both data dirs, `$OLIGARCHY_DATA_ROOT/qemu-1` and `qemu-2`, entirely
  (ISO, `<iso>.qcow2`, `<iso>.OVMF_VARS.fd`, `manifest.json`).
- The previous super-run data dirs `qemu-server-4` and `qemu-server-3`
  (that fleet kept its ISOs; they go too).
- The ISO cache `SUPER_RUN_ISO_CACHE` (default `~/.oligarchy/isos`).

`reset.sh` does not do this. It never touches the database, Linear, session
dirs, or data dirs.

Then **download two copies of the ISO**, one `curl` into each data dir's
`isos/`, under the cache file name (`src/qemu/iso.ts` `cacheFileName`) with
a `manifest.json` entry `{ status: "cached" }`. Two dirs so the two mints
do not overwrite one disk. Each qemu server is width one (`--max-jobs 1`),
so a mint lands on exactly one machine per server and the batch stays at
one guest per server.

**Two minting sessions**, then the lock-screen tests. `./ctrl mint` opens
one ticket per live server (two tickets, two drives). Not in the ledger;
track them in `SCRATCH.md`. Do not spawn a lock-screen ticket until both
results are passed and each data dir holds the ISO, its `.qcow2`, and its
`.OVMF_VARS.fd`.
</Disks>
<WriteableFiles>
| File | What goes here |
|------|----------------|
| `SCRATCH.md` | Live pad, mint phase included. Never paste secrets (`DATABASE_URL`, tokens). |
| `TODOS.md` | Non-blocking findings. |
| `automation-super-run-logs/muse/NNN-OLI-xxxx.md` | One file per retired run (`retire.sh`). |
| `automation-super-run-logs/index.tsv` | One TSV row per retire; column 2 is `COUNTED` or `INFRA`. |
| `automation-super-run-logs/processes/` | Server logs and `pids`. |
| repo source | **Only** for a confirmed blocking harness defect (see YourRole). |

`reset.sh` wipes all of the first five for a fresh batch. Nothing else deletes them.
</WriteableFiles>
<Runs>
<model>meta/muse-spark-1.3-contributor</model>
<count>10 COUNTED lock-screen tickets, after 2 mints. Spawn the lock-screen ticket five times to open, then refill through all ten.</count>
<test>lock-screen (resumed); mint (fresh, once per server)</test>
<fleet>
<qemu-reverse-proxy port="55555"/>
<qemu-1 port="55332" max-jobs="1" data-dir="$OLIGARCHY_DATA_ROOT/qemu-1"/>
<qemu-2 port="55333" max-jobs="1" data-dir="$OLIGARCHY_DATA_ROOT/qemu-2"/>
<automation-client-2a port="52222" max-jobs="2"/>
<automation-client-2b port="52223" max-jobs="2"/>
<automation-server port="54321"/>
</fleet>
</Runs>
<YourRole>
- **Operator:** clear every known temporary including ISOs, download the ISO
  into each data dir, start/restart the six processes (two qemu servers,
  width one, two different data dirs; two clients, two jobs each), run two
  minting sessions, spawn the lock-screen ticket five times (`new.sh`),
  run `/tmp/superrun/tick.sh` every minute, retire, abort INFRA, refill
  until 10 COUNTED, drain, write the pad.
- **Mint phase:** one `./ctrl mint`, two tickets, two drives. Not in the
  ledger; track them in `SCRATCH.md`. Done when both results are passed
  and each data dir holds the ISO, its `.qcow2` and its `.OVMF_VARS.fd`. A
  failed mint is a failed ticket: read its session, fix what is the
  harness's (developing-agent rules), then mint the failed servers again
  with `./ctrl mint --server-url "$SUPER_RUN_SERVER_URL" --iso "$ISO" --unminted`
  (needs `OLIGARCHY_TOKEN` in the environment; `.env` supplies it). It asks
  the proxy which servers still lack the disk and tickets those alone; a
  live server the proxy cannot reach refuses the whole command — fix the
  fleet first. A server whose disk is present but bad: remove its
  `<iso>.qcow2` and `<iso>.OVMF_VARS.fd`, then the same command. Without
  the flag every server is minted again (every save overwrites).
  Do not spawn a lock-screen ticket with an unminted server: every start
  there is refused with `internal error`.
- **Analyze every `ANALYZE` line from `tick.sh`**, plus any stalled run.
  Spawn a `Task` `generalPurpose` subagent. Hand it ticket, result id,
  session id, `/tmp/superrun/status.sh "$RID"`,
  `SESSION_ID="$SID" ./ctrl session --all`, both client logs and the
  qemu/proxy/server logs around the timestamps, and
  `/tmp/oligarchy-driver-<result id>.jsonl` for a drive, and
  `~/.local/share/opencode/{opencode.db,log/opencode.log}` for a diagnose. Tell it to
  read `DATABASE_URL` from repo `.env` — do not paste secrets. Ask:
  cause, harness-or-model, exact fix if harness.
- **COUNTED:** model passed/failed, `driver_loop_ceiling`, agent quit
  early. Linear → Needs Review (or Done if the diagnosis is a clean pass
  you accept).
- **INFRA:** no qemu, webhook never made a drive job, cleanup/disk, proxy
  down, dispatch `ETIMEDOUT`, a start refused for a missing minted disk,
  operator/harness fault. Linear → Canceled.
  Record with `retire.sh N INFRA`, then replace (another `new.sh`).
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
sh .cursor/skills/oligarchy-super-run/scripts/install.sh   # writes SUPER_RUN_COUNT=10
. /tmp/superrun/env
```

**Find the latest Omarchy ISO once per batch.** There is no default. Both
downloads, `./ctrl mint`, and every `new.sh` use it, and the version is
read from the filename. Use the `https://iso.omarchy.org/omarchy-*.iso`
URL in the latest release body, or else build it from `tag_name` with the
leading `v` removed. Stop if it is not published.

```bash
ISO=$(curl -fsS https://api.github.com/repos/omacom/omarchy/releases/latest \
  | jq -r '(.body | [scan("https://iso\\.omarchy\\.org/omarchy-[^ )\"]*\\.iso")][0]) // "https://iso.omarchy.org/omarchy-\(.tag_name | ltrimstr("v")).iso"')
curl -fsI "$ISO" >/dev/null && echo "$ISO"   # non-200 → stop
```

**Fresh batch:** a previous super-run leaves `index.tsv`, per-run files,
process logs, `SCRATCH.md`, `TODOS.md`, and the `/tmp/superrun` ledger
behind. Stop any old fleet (the six ports must be free), then:

```bash
/tmp/superrun/reset.sh          # refuses if active is non-empty or a fleet port is bound
# /tmp/superrun/reset.sh --force  # skip both guards (you have confirmed nothing is in flight)
```

It never touches the database, Linear, session dirs, or data dirs. Do not
append a new batch onto an old `index.tsv`; `tick.sh` counts `COUNTED` rows in it
against `SUPER_RUN_COUNT` (10).

**Clear every known temporary, including ISOs.** This is every super-run,
not a one-time reset. `reset.sh` does not do it.

```bash
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
SESS="${OLIGARCHY_SESSIONS_DIR:-$HOME/personal/oligarchy-tmp}"
CACHE="${SUPER_RUN_ISO_CACHE:-$HOME/.oligarchy/isos}"
mkdir -p "$SESS"
find "$SESS" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
rm -rf "$DATA/qemu-1" "$DATA/qemu-2" \
       "$DATA/qemu-server-4" "$DATA/qemu-server-3" \
       "$CACHE"
mkdir -p "$DATA/qemu-1/isos" "$DATA/qemu-2/isos"
```

**Download two copies of the ISO**, one into each data dir. The file name
is the url with every character a file system could object to replaced by
`_` (`cacheFileName`). A partial name is renamed only after `curl` exits 0,
and `manifest.json` marks it cached so the server does not download a third
copy on first start.

```bash
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
FILE=$(printf '%s' "$ISO" | tr '<>:"/\\|?*' '_________')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for s in 1 2; do
  isos="$DATA/qemu-$s/isos"
  curl -fL --retry 3 -o "$isos/$FILE.partial-seed" "$ISO"
  mv "$isos/$FILE.partial-seed" "$isos/$FILE"
  jq -n --arg f "$FILE" --arg now "$NOW" \
    '{ ($f): { status: "cached", cachedAt: $now, lastUsedAt: $now } }' \
    > "$isos/manifest.json"
  echo "qemu-$s: downloaded $ISO ($(wc -c < "$isos/$FILE") bytes)"
done
```

Start **six** processes, each in its own session (`setsid`) so they outlive the operator shell. `./qemu-server` and `./automation-client` require `--name` and `--max-jobs`. Two qemu servers, each width one (`--max-jobs 1`), two different data dirs. Two clients, each `--max-jobs 2`. Announce with `--url` on `http://127.0.0.1:…` (these binaries bind `127.0.0.1`; `localhost` can be `::1`). `--name` is unique on `servers`. Clients reserve guests through the proxy: `SERVER_URL=http://127.0.0.1:55555`. Omit it and they call `:42069`. `./automation-server` has no `--jobs` (it fills from client reserve) and defaults to **free** Muse — always pass the paid model.

```bash
P=automation-super-run-logs/processes
SESS=/home/theprimeagen/personal/oligarchy-tmp
DATA="${OLIGARCHY_DATA_ROOT:-$HOME/personal/oligarchy-data}"
export OLIGARCHY_SESSIONS_DIR="$SESS"

start_fleet() {
  if ss -ltn | grep -qE ':55332|:55333|:55555|:52222|:52223|:54321'; then
    echo "a listed port is already bound; stop that process first"
    return 1
  fi
  psql "$DBURL" -X -c "select name, type, url, heartbeat_at from servers where name in ('qemu-1','qemu-2','automation-client-2a','automation-client-2b','qemu-server-4','qemu-server-3','automation-client-5','automation-client-3');"
  # live row, different url: stop that process. stale row: delete only that name's dead row.
  # the last four names are the previous fleet; delete those dead rows too.
  : > "$P/pids"

  setsid ./qemu-reverse-proxy --port 55555 \
    >"$P/qemu-reverse-proxy.log" 2>&1 & echo "qemu-reverse-proxy $!" | tee -a "$P/pids"

  setsid env TMPDIR="$SESS" ./qemu-server \
    --name qemu-1 --max-jobs 1 --port 55332 --url http://127.0.0.1:55332 \
    --data-dir "$DATA/qemu-1" \
    >"$P/qemu-1.log" 2>&1 & echo "qemu-1 $!" | tee -a "$P/pids"

  setsid env TMPDIR="$SESS" ./qemu-server \
    --name qemu-2 --max-jobs 1 --port 55333 --url http://127.0.0.1:55333 \
    --data-dir "$DATA/qemu-2" \
    >"$P/qemu-2.log" 2>&1 & echo "qemu-2 $!" | tee -a "$P/pids"

  setsid env SERVER_URL=http://127.0.0.1:55555 ./automation-client \
    --name automation-client-2a --max-jobs 2 --port 52222 --url http://127.0.0.1:52222 \
    >"$P/automation-client-2a.log" 2>&1 & echo "automation-client-2a $!" | tee -a "$P/pids"

  setsid env SERVER_URL=http://127.0.0.1:55555 ./automation-client \
    --name automation-client-2b --max-jobs 2 --port 52223 --url http://127.0.0.1:52223 \
    >"$P/automation-client-2b.log" 2>&1 & echo "automation-client-2b $!" | tee -a "$P/pids"

  setsid ./automation-server --port 54321 \
    >"$P/automation-server.log" 2>&1 & echo "automation-server $!" | tee -a "$P/pids"
}
start_fleet
```

Confirm six pids, six ports, listen lines, no `heartbeat failed`, four live fleet rows. `./ctrl automation --list` is the job queue, not the fleet.

```bash
sleep 2
cat "$P/pids"
ss -ltnp | grep -E '55332|55333|55555|52222|52223|54321'
grep -E 'listening on|heartbeat failed' "$P"/qemu-*.log "$P"/automation-client-*.log "$P"/automation-server.log
psql "$DBURL" -X -c "select name, type, url, heartbeat_at from servers where heartbeat_at > now() - interval '45 seconds' order by type, name;"
```

Expect `qemu-1` / `qemu-2` (`qemu`, each `max jobs 1`, two different `data` dirs) and `automation-client-2a` / `automation-client-2b` (`automation-client`, each max-jobs 2). Each dir has the ISO and no `.qcow2` yet.

**Two minting sessions.** `./ctrl mint` creates one Linear ticket per live qemu server. Installs take up to 45 minutes; both run at once.

```bash
./ctrl mint --server-url "$SUPER_RUN_SERVER_URL" --iso "$ISO"
# → JSON: [{ id, result, server, linear }, …] × 2. Note ticket ↔ server in SCRATCH.md.
sleep 20
psql "$DBURL" -X -c "select r.linear_id, j.action, j.status from test_results r join automation_jobs j on j.result_id = r.result_id where r.linear_id in ('OLI-…','OLI-…');"
# every ticket must show a drive job. One without: stop, diagnose (automation-server log), fix,
# cancel that ticket, then ./ctrl mint … --unminted
```

Watch each mint like a lock-screen run (`./ctrl session --search --test-result-id "$RID"`, then
`SESSION_ID=… ./ctrl session --all`; the qemu log for that server). A mint is done when its result
is passed **and** the files exist:

```bash
for s in 1 2; do echo "== qemu-$s"; ls -la "$DATA/qemu-$s/isos/"; done
# expect, in every dir: the ISO, <iso>.qcow2, <iso>.OVMF_VARS.fd
curl -sS -H "Authorization: Bearer $(grep '^OLIGARCHY_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'")" \
  "http://127.0.0.1:55555/minted?iso=$ISO" | jq .
# expect both servers "minted"; "unminted" is a server to mint again, "unreachable" one to fix
```

A result passed with no files, or files with a failed result, is a harness defect: stop and analyze.
Do not spawn a lock-screen ticket until both dirs hold the disk.

**Lock-screen.** `N` is monotonic (`/tmp/superrun/next`). Never take N from `active`. Target: `counted + active == 10` after replacing every INFRA. Two qemu servers at width one, so two guests at once; two clients at two jobs each, so four client slots. Keep enough pending drives that both servers stay busy.

Spawn the lock-screen ticket five times. Five tickets, before the first tick. The fifth sits ahead of the four client slots so a slot does not wait on `new.sh`. Do not spawn these five again later; the remaining tickets come from refill until all ten are counted.

```bash
i=0
while [ "$i" -lt 5 ]; do
  /tmp/superrun/new.sh muse "$ISO" || exit $?
  i=$((i + 1))
done
# exit 2 = no drive job: stop, diagnose (automation-server log), fix, retire.sh N INFRA
```

Each `AGENT_LOOP_TICK_superrun` you **do this work** (the sleep loop does not):

```bash
/tmp/superrun/tick.sh
# RETIRE n|…  → if ANALYZE is also printed, wait for the subagent, then:
/tmp/superrun/retire.sh "$N" COUNTED   # or INFRA
# STUCK no-drive-job → stop refill; diagnose (automation-server log); fix; retire.sh N INFRA
# STUCK diagnose=* no-diagnosis-row → ./ctrl diagnose … --model meta/muse-spark-1.3-contributor
#        or retire INFRA. cannot re-enqueue diagnose
# LEDGER refill=yes → /tmp/superrun/new.sh muse "$ISO"   # until all ten are opened
# LEDGER remaining=0 → no new.sh; drain until active is empty
```

Drive died, result still open:

```bash
SID=$(./ctrl session --search --test-result-id "$RID")
./ctrl test-results --agent-id "$TICKET" --id "$RID" --status failed --reason "operator: …"
./client stop --agent-id "$TICKET" --server-url http://127.0.0.1:55555 --session-id "$SID" --status aborted --reason "operator: …"
/tmp/superrun/linear-state.sh "$TICKET" "Needs Review"   # model: COUNTED
# /tmp/superrun/linear-state.sh "$TICKET" Canceled       # INFRA
```

Arm the wake-up only after the five lock-screen tickets exist:

```bash
while true; do sleep 60; echo AGENT_LOOP_TICK_superrun; done
```

Drain: `tick.sh` + retire + cleanup, no `new.sh`, until `active` is empty.

**Done when** both data dirs hold the minted disk, `index.tsv` has exactly 10 `COUNTED` rows (all ten lock-screen tickets), `active` is empty, no running sessions/jobs, session dirs gone, every COUNTED result+diagnosis model is the paid Muse, every COUNTED session's config says `mode: resume`, and `SCRATCH.md` names the mint outcomes, the failures, and whether the harness needed a fix.

One run’s DB dump: `/tmp/superrun/status.sh "$RID"`
</HowToRun>
</OligarchySuperRun>
