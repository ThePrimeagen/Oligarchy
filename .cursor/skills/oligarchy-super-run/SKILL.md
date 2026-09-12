---
name: oligarchy-super-run
description: >-
  Operate an Oligarchy lock-screen super-run: start two QEMU servers and two
  automation clients plus proxy and automation-server, run 100 counted Muse
  Spark 1.3 contributor jobs, tick the board, analyze failures, and fix a
  confirmed harness defect. Use when the user asks to run 100 Muse Spark
  jobs, start qemu/automation servers, drain a batch, or operate the
  automation pipeline.
---

<OligarchySuperRun>
<Goal>
Process **100 COUNTED** lock-screen runs through drive + diagnose. INFRA
attempts are recorded and replaced; they do not count. After the batch:
report stability, whether the paid model landed on every result/diagnosis,
and whether `--max-jobs` was actually exercised (dispatch claims every
pending job a live client will reserve; qemu 4/3 and client 5/3 are the caps).
</Goal>
<WriteableFiles>
| File | What goes here |
|------|----------------|
| `SCRATCH.md` | Live pad. Never paste secrets (`DATABASE_URL`, tokens). |
| `TODOS.md` | Non-blocking findings. |
| `automation-super-run-logs/muse/NNN-OLI-xxxx.md` | One file per retired run (`retire.sh`). |
| `automation-super-run-logs/index.tsv` | One TSV row per retire; column 2 is `COUNTED` or `INFRA`. |
| `automation-super-run-logs/processes/` | Server logs and `pids`. |
| repo source | **Only** for a confirmed blocking harness defect (see YourRole). |

`reset.sh` wipes all of the first five for a fresh batch. Nothing else deletes them.
</WriteableFiles>
<Runs>
<model>openrouter/meta/muse-spark-1.3-contributor</model>
<count>100 COUNTED</count>
<test>lock-screen</test>
<fleet>
<qemu-reverse-proxy port="55555"/>
<qemu-server-4 port="55332" max-jobs="4"/>
<qemu-server-3 port="55333" max-jobs="3"/>
<automation-client-5 port="52222" max-jobs="5"/>
<automation-client-3 port="52223" max-jobs="3"/>
<automation-server port="54321"/>
</fleet>
</Runs>
<YourRole>
- **Operator:** start/restart the six processes, create tickets (`new.sh`),
  run `/tmp/superrun/tick.sh` every minute, retire, abort INFRA, refill
  until 100 COUNTED, drain, write the pad.
- **Analyze every `ANALYZE` line from `tick.sh`**, plus any stalled run.
  Spawn a `Task` `generalPurpose` subagent. Hand it ticket, result id,
  session id, `/tmp/superrun/status.sh "$RID"`,
  `SESSION_ID="$SID" ./ctrl session --all`, both client logs and the
  qemu/proxy/server logs around the timestamps, and
  `~/.local/share/opencode/{opencode.db,log/opencode.log}`. Tell it to
  read `DATABASE_URL` from repo `.env` — do not paste secrets. Ask:
  cause, harness-or-model, exact fix if harness.
- **COUNTED:** model passed/failed, `driver_loop_ceiling`, agent quit
  early. Linear → Needs Review (or Done if the diagnosis is a clean pass
  you accept).
- **INFRA:** no qemu, webhook never made a drive job, cleanup/disk, proxy
  down, dispatch `ETIMEDOUT`, operator/harness fault. Linear → Canceled.
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

```bash
export OLIGARCHY_ROOT="$PWD"
export DBURL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
mkdir -p automation-super-run-logs/{muse,processes} /home/theprimeagen/personal/oligarchy-tmp
sh .cursor/skills/oligarchy-super-run/scripts/install.sh
. /tmp/superrun/env
```

**Fresh batch:** a previous super-run leaves `index.tsv`, per-run files,
process logs, `SCRATCH.md`, `TODOS.md`, and the `/tmp/superrun` ledger
behind. Stop any old fleet (the six ports must be free), then:

```bash
/tmp/superrun/reset.sh          # refuses if active is non-empty or a fleet port is bound
# /tmp/superrun/reset.sh --force  # skip both guards (you have confirmed nothing is in flight)
```

It never touches the database, Linear, or session dirs. Do not append a
new batch onto an old `index.tsv`; `tick.sh` counts `COUNTED` rows in it.

Start **six** processes. `./qemu-server` and `./automation-client` require `--name` and `--max-jobs`. Announce with `--url` on `http://127.0.0.1:…` (these binaries bind `127.0.0.1`; `localhost` can be `::1`). `--name` is unique on `servers`. Clients reserve guests through the proxy: `SERVER_URL=http://127.0.0.1:55555`. Omit it and they call `:42069`. `./automation-server` has no `--jobs` (it fills from client reserve) and defaults to **free** Muse — always pass the paid model.

```bash
P=automation-super-run-logs/processes
SESS=/home/theprimeagen/personal/oligarchy-tmp
export OLIGARCHY_SESSIONS_DIR="$SESS"

start_fleet() {
  if ss -ltn | grep -qE ':55332|:55333|:55555|:52222|:52223|:54321'; then
    echo "a listed port is already bound; stop that process first"
    return 1
  fi
  psql "$DBURL" -X -c "select name, type, url, heartbeat_at from servers where name in ('qemu-server-4','qemu-server-3','automation-client-5','automation-client-3');"
  # live row, different url: stop that process. stale row: delete only that name's dead row, keep these four names.
  : > "$P/pids"

  ./qemu-reverse-proxy --port 55555 \
    >"$P/qemu-reverse-proxy.log" 2>&1 & echo "qemu-reverse-proxy $!" | tee -a "$P/pids"

  TMPDIR="$SESS" ./qemu-server \
    --name qemu-server-4 --max-jobs 4 --port 55332 --url http://127.0.0.1:55332 \
    >"$P/qemu-server-4.log" 2>&1 & echo "qemu-server-4 $!" | tee -a "$P/pids"

  TMPDIR="$SESS" ./qemu-server \
    --name qemu-server-3 --max-jobs 3 --port 55333 --url http://127.0.0.1:55333 \
    >"$P/qemu-server-3.log" 2>&1 & echo "qemu-server-3 $!" | tee -a "$P/pids"

  SERVER_URL=http://127.0.0.1:55555 ./automation-client \
    --name automation-client-5 --max-jobs 5 --port 52222 --url http://127.0.0.1:52222 \
    >"$P/automation-client-5.log" 2>&1 & echo "automation-client-5 $!" | tee -a "$P/pids"

  SERVER_URL=http://127.0.0.1:55555 ./automation-client \
    --name automation-client-3 --max-jobs 3 --port 52223 --url http://127.0.0.1:52223 \
    >"$P/automation-client-3.log" 2>&1 & echo "automation-client-3 $!" | tee -a "$P/pids"

  ./automation-server --port 54321 \
    --model openrouter/meta/muse-spark-1.3-contributor \
    >"$P/automation-server.log" 2>&1 & echo "automation-server $!" | tee -a "$P/pids"
}
start_fleet
```

Confirm six pids, six ports, listen lines, no `heartbeat failed`, four live fleet rows. `./ctrl automation --list` is the job queue, not the fleet.

```bash
sleep 2
cat "$P/pids"
ss -ltnp | grep -E '55332|55333|55555|52222|52223|54321'
grep -E 'listening on|heartbeat failed' "$P"/qemu-server-*.log "$P"/automation-client-*.log "$P"/automation-server.log
psql "$DBURL" -X -c "select name, type, url, heartbeat_at from servers where heartbeat_at > now() - interval '45 seconds' order by type, name;"
```

Expect `qemu-server-4` / `qemu-server-3` (`qemu`) and `automation-client-5` / `automation-client-3` (`automation-client`).

`N` is monotonic (`/tmp/superrun/next`). Never take N from `active`. Target: `counted + active == 100` after replacing every INFRA. Dispatch fills every slot a live client will reserve; keep enough pending drives that `--max-jobs` is exercised. `new.sh` exit 2 = no drive webhook — pause refill.

```bash
/tmp/superrun/new.sh muse
```

Each `AGENT_LOOP_TICK_superrun` you **do this work** (the sleep loop does not):

```bash
/tmp/superrun/tick.sh
# RETIRE n|…  → if ANALYZE is also printed, wait for the subagent, then:
/tmp/superrun/retire.sh "$N" COUNTED   # or INFRA
# STUCK no-drive-job → pause refill; fix webhook / automation-server
# STUCK diagnose=* no-diagnosis-row → ./ctrl diagnose … --model openrouter/meta/muse-spark-1.3-contributor
#        or retire INFRA. cannot re-enqueue diagnose
# LEDGER refill=yes → /tmp/superrun/new.sh muse
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

Arm the wake-up only after the first ticket exists:

```bash
while true; do sleep 60; echo AGENT_LOOP_TICK_superrun; done
```

Drain: `tick.sh` + retire + cleanup, no `new.sh`, until `active` is empty.

**Done when** `index.tsv` has exactly 100 `COUNTED` rows, `active` is empty, no running sessions/jobs, session dirs gone, every COUNTED result+diagnosis model is the paid Muse, and `SCRATCH.md` names failures + whether the harness needed a fix.

One run’s DB dump: `/tmp/superrun/status.sh "$RID"`
</HowToRun>
</OligarchySuperRun>
