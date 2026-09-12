---
name: oligarchy-super-run
description: >-
  Operate an Oligarchy lock-screen super-run: start two QEMU servers and two
  automation clients plus proxy and automation-server, set
  model/jobs/ISO/TMPDIR, create Linear tickets, tick the board, retire
  diagnoses, and write findings to SCRATCH.md and TODOS.md. Use when the user
  asks to run 100 Muse Spark (or DeepSeek) jobs, start qemu/automation
  servers, drain a batch, or operate the automation pipeline without changing
  code.
---

<OligarchySuperRun>
<Goal>
Run the entire automation pipeline locally and verify that everything works.
1. that max-jobs is respected
2. that we are driving and diagnosing agent runs.
3. that the pipeline is stable and there are no regressions.
</Goal>
<WriteableFiles>
| File | What goes here |
|------|----------------|
| `SCRATCH.md` | Live pad for taking notes and preparing analysis.
| `TODOS.md` | Findings that are not blocking the ability to run that should be fixed.
| `automation-super-run-logs/<model>/NNN-OLI-xxxx.md` | One file per run, written by `retire.sh` / `record.sh`. |
| `automation-super-run-logs/index.tsv` | One TSV row per retired run. |
| `automation-super-run-logs/processes/` | Server logs and `pids`. |
</WriteableFiles>
<Runs>
<model>
muse-spark runs, 1.3, contributor. should be
</model>
<count>
100
</count>
<max-jobs>
<qemu-server-a>4</qemu-server-a>
<qemu-server-b>3</qemu-server-b>
<automation-client-a>5</automation-client-a>
<automation-client-b>3</automation-client-b>
</max-jobs>
</Runs>
<YourRole>
- **Operator (you):** start/restart servers, create tickets (`new.sh` /
  `./ctrl test new`), retire completed diagnoses, abort INFRA, keep the pad
  honest, spawn a 1-minute tick loop.
- **Analysis:** any "why did this die / does the verdict hold" question is a
  `Task` `generalPurpose` subagent. Hand it ticket, result id, session id,
  `DATABASE_URL`, `~/.local/share/opencode/opencode.db`,
  `~/.local/share/opencode/log/opencode.log`,
  `automation-super-run-logs/processes/automation-client.log`, and
  `./ctrl session --all`. Ask for: cause, harness-or-model, exact fix if
  harness. You act on the report.
</YourRole>
<HowToRun>
From the repo root. Cloudflare tunnel to `:55555` must already be up (`https://oligarchy-server.trm.sh`).

```bash
export OLIGARCHY_ROOT="$PWD"
export DBURL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
mkdir -p automation-super-run-logs/{muse,processes} /home/theprimeagen/personal/oligarchy-tmp
: > automation-super-run-logs/processes/pids
sh .cursor/skills/oligarchy-super-run/scripts/install.sh
. /tmp/superrun/env
```

Start **six** processes. One proxy, one automation-server, **two** QEMU servers, **two** automation clients. Do not skip one. Each QEMU/client pair has its own port, `--url`, log, and `--max-jobs`.

| process | port | `--url` | `--max-jobs` | log |
|---------|------|---------|--------------|-----|
| qemu-reverse-proxy | 55555 | — | — | `qemu-reverse-proxy.log` |
| qemu-server-a | 55332 | `http://localhost:55332` | **4** | `qemu-server-a.log` |
| qemu-server-b | 55333 | `http://localhost:55333` | **3** | `qemu-server-b.log` |
| automation-client-a | 52222 | `http://localhost:52222` | **5** | `automation-client-a.log` |
| automation-client-b | 52223 | `http://localhost:52223` | **3** | `automation-client-b.log` |
| automation-server | 54321 | — | — | `automation-server.log` |

Guest cap is 4+3=**7**. Client cap is 5+3=8. Do not keep more than 7 drive jobs in `running`+`pending`.

```bash
P=automation-super-run-logs/processes
SESS=/home/theprimeagen/personal/oligarchy-tmp

./qemu-reverse-proxy --port 55555 \
  >"$P/qemu-reverse-proxy.log" 2>&1 & echo "qemu-reverse-proxy $!" | tee -a "$P/pids"

TMPDIR="$SESS" ./qemu-server --port 55332 --url http://localhost:55332 --max-jobs 4 \
  >"$P/qemu-server-a.log" 2>&1 & echo "qemu-server-a $!" | tee -a "$P/pids"

TMPDIR="$SESS" ./qemu-server --port 55333 --url http://localhost:55333 --max-jobs 3 \
  >"$P/qemu-server-b.log" 2>&1 & echo "qemu-server-b $!" | tee -a "$P/pids"

./automation-client --port 52222 --url http://localhost:52222 --max-jobs 5 \
  >"$P/automation-client-a.log" 2>&1 & echo "automation-client-a $!" | tee -a "$P/pids"

./automation-client --port 52223 --url http://localhost:52223 --max-jobs 3 \
  >"$P/automation-client-b.log" 2>&1 & echo "automation-client-b $!" | tee -a "$P/pids"

./automation-server --port 54321 \
  --model openrouter/meta/muse-spark-1.3-contributor \
  >"$P/automation-server.log" 2>&1 & echo "automation-server $!" | tee -a "$P/pids"
```

Confirm six pids and both QEMU + both clients are listening:

```bash
cat "$P/pids"
ss -ltnp | grep -E '55332|55333|55555|52222|52223|54321'
./ctrl automation --list
```

Create a ticket (ISO/url are already in `/tmp/superrun/env`):

```bash
/tmp/superrun/new.sh 1 muse
```

Keep at most 7 drive jobs (`running`+`pending`) — that is the QEMU cap (4+3). Sleep 15s between `new.sh` when starting several. Hold new starts if `MemAvailable` is under 4G.

Each minute, **erase finished guest disks**. A done session is ~6G under `$SESS` (`oligarchy-<session-id>`). Leaving them fills the disk and the next wave of guests will OOM or fail screendumps. `/tmp/superrun/cleanup.sh` deletes every session dir whose row is not `running`/`downloading`. If that query fails, it must keep every dir (do not `rm` on "unknown").

```bash
/tmp/superrun/board.sh
/tmp/superrun/cleanup.sh   # required every tick; not optional

# retire only when post_run_diagnosis exists; N comes from active, not the ticket number
IN=$(awk -F'|' '{printf "%s'\''%s'\''", sep, $4; sep=","}' /tmp/superrun/active)
psql "$DBURL" -X -A -t -c "select r.linear_id from test_results r join post_run_diagnosis d on d.session_id=r.session_id where r.linear_id in ($IN);"
# for each ticket printed:
N=$(awk -F'|' -v t="$TICKET" '$4==t{print $1}' /tmp/superrun/active)
/tmp/superrun/retire.sh "$N"

N_DRIVE=$(psql "$DBURL" -X -A -t -c "select count(*) from automation_jobs where action='drive' and status in ('running','pending')")
if [ "$N_DRIVE" -lt 7 ]; then
  LAST=$(awk -F'|' 'NF{n=$1} END{print n+0}' /tmp/superrun/active)
  /tmp/superrun/new.sh $((LAST+1)) muse
fi
```

Arm the tick:

```bash
while true; do sleep 60; echo AGENT_LOOP_TICK_superrun; done
```

Drive died with the result still open (30m ceiling or opencode exit):

```bash
SID=$(./ctrl session --search --test-result-id "$RID")
./ctrl test-results --agent-id "$TICKET" --id "$RID" --status failed --reason "operator: …"
./client stop --agent-id "$TICKET" --server-url http://127.0.0.1:55555 --session-id "$SID" --status aborted --reason "operator: …"
/tmp/superrun/linear-state.sh "$TICKET" "Needs Review"   # model: counted
# /tmp/superrun/linear-state.sh "$TICKET" Canceled       # INFRA: not counted, extra new.sh later
```

Drain (no more tickets): skip `new.sh`. Still board, retire, and **cleanup disks** every minute until `/tmp/superrun/active` is empty, then kill the loop.

One run’s DB dump: `/tmp/superrun/status.sh "$RID"`
</HowToRun>
</OligarchySuperRun>
