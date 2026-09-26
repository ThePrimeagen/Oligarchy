# Ultra loop: ten counted super-runs

Ten lock-screen super-runs on local URLs (`.local-env`: `SERVER_URL=http://127.0.0.1:55555`,
`AUTOMATION_SERVER_URL=http://127.0.0.1:54321`), each on a fresh fleet: the proxy, two QEMU
servers with one data dir and one minted disk each, two automation clients at two jobs each, and
the automation server, on the paid `meta/muse-spark-1.3-contributor` model against
`https://iso.omarchy.org/omarchy-4.0.4.iso`.

Before every attempt the loop cleared local data, resolved every open Sentry issue, canceled
straggler Linear tickets, and aborted straggler jobs, sessions, results and runs. After every
batch it read the process logs and Sentry. A local issue restarted the attempt uncounted; a
Sentry issue was fixed before the next attempt. Every fix was written tests first (seen failing,
happy and unhappy paths), passed `bun run check:fast`, and was reviewed by Sol and Grok until
both had nothing blocking.

## Outcome

12 attempts, 10 counted, 2 restarted for local issues.

| Attempt | Run | Outcome | Lock-screen passes | Mint retries |
|---|---|---|---|---|
| 1 | - | restarted | 10/10 | 1 |
| 2 | 1 | counted | 10/10 | 0 |
| 3 | 2 | counted | 9/10 | 0 |
| 4 | 3 | counted | 10/10 | 0 |
| 5 | - | restarted | 8/10 | 0 |
| 6 | 4 | counted | 10/10 | 0 |
| 7 | 5 | counted | 7/10 | 1 |
| 8 | 6 | counted | 9/10 | 1 |
| 9 | 7 | counted | 9/10 | 0 |
| 10 | 8 | counted | 9/10 | 3 |
| 11 | 9 | counted | 9/10 | 1 |
| 12 | 10 | counted | 10/10 | 1 |

Across the ten counted runs, 92 of 100 lock-screen tickets passed. All 8 failures were the model,
not the harness: it skipped the lock steps and claimed a pass (OLIT-1107, OLIT-1110, OLIT-1119),
or clicked Lock without ever taking a screenshot of the lock screen (OLIT-1061, OLIT-1106,
OLIT-1137, OLIT-1153, OLIT-1161). Each was counted and moved to Needs Review.

The last two attempts, run on every fix below, sent no Sentry events from this host. The
recurring `OLIGARCHY-TEST-2S` events after attempt 10 all came from the Mac-mini fleet that
shares the project.

The ledger is `automation-ultra-logs/runs.tsv`; each attempt's logs, `SCRATCH.md` and `TODOS.md`
are archived under `automation-ultra-logs/attempt-NN/`.

## Fixes

### Before attempt 1

- **Mint setup-lock race** (`packages/db/src/setup-requests.ts`,
  `apps/qemu-reverse-proxy/src/setup.ts`, `packages/jobs/src/open.ts`). `./ctrl mint` found "no
  pinned server", and the proxy's cleanup could delete a lock an operator mint had just claimed.
  `claim` and the proxy's `remove` now share one rule: a lock is held while its result is open
  and its mint job has not ended. `claim` refuses a held lock, `remove` deletes only a
  releasable one, and a refused release keeps the proxy watching the row instead of forgetting
  it ("setup not released; held or already gone").
- **Linear failures classified by status, not message** (`packages/linear/src/errors.ts`,
  `packages/linear/src/client.ts`, `packages/jobs/src/retry.ts`). `LinearError` carries
  `retryable` (a timeout, a connection failure, a 429 or a 5xx). The client never retries; the
  one retry policy is `Retry.linearRead` in `@oligarchy/jobs`, and the three board-column reads
  go through it.
- **OpenRouter mid-stream errors** (`src/harness/openrouter.ts`). A 502 in the middle of a stream,
  including one whose code arrives as the string `"502"`, is retried like a numeric 429 or 5xx; a
  named code such as `"server_error"` stays final. The chunk deadline runs from the last event.
- **Ultra tooling** (`.cursor/skills/oligarchy-super-run/scripts/`). `fleet.sh` (start, stop,
  status; start refuses non-local URLs and busy ports), `clear.sh` (local data, database
  stragglers through psql variables and CTEs, Linear stragglers), `download.sh`, `prep.sh` (the
  whole between-attempt cycle), `ultra-tick.sh` (per-phase report), plus the ledger and archives.

### Attempt 1 (restarted)

- **`ctrl test run` failed on one Linear lookup timeout** (`packages/jobs/src/open.ts`).
  `Open.team` reads the team, assignee and workflow states through `Retry.linearRead`. The label
  lookup is not retried, since it can create a label.
- **Failed jobs were named by a truncated stack tail** (`apps/automation-client/src/child.ts`,
  `apps/automation-client/src/sessions.ts`). A drive or mint that exits nonzero keeps stderr's
  first line (up to 512 characters, cut on a character boundary) as its reason and Sentry title,
  instead of garbled text like `igarchy/driver/main.js…`.

### Attempts 2 to 4

- **`clear.sh` hardening.** It had labeled finished runs as aborted, and those runs were
  restored. The fleet guard now fails closed if `ss` fails, the sessions directory is guarded
  against `/`, `$HOME` and the repo, only UUID-named `/tmp` session directories are removed, and
  results and runs are aborted only through the rows it aborted itself.

### Attempt 5 (restarted)

- **A step limit errored the drive instead of failing the test** (`src/driver/loop.ts`). Two runs
  looped on Click Lock until the 200-step limit. The driver closed the result failed and then
  exited 1, so the automation server overwrote it as errored: no diagnosis, and a Sentry event.
  Now the step limit and the run ceiling are `limit-reached`: the guest stops failed, a mint is
  never saved, the result closes failed with the limit as its reason, and the driver exits 0 so
  the diagnosis judges it. A result that will not close still fails the run.
- **`tick.sh` never flagged errored drives.** A drive or diagnose that ended failed, aborted,
  errored or timed out now prints STUCK and ANALYZE.

### Attempt 7

- **Screenshots of a guest that had powered itself off were 502s in Sentry**
  (`apps/qemu-server/src/sessions.ts`, `packages/http/src/api.ts`; Sentry `OLIGARCHY-TEST-11`).
  A mint's last act is shutting the guest down, and the driver's next screenshot hit a closed
  QMP socket. For a fresh session whose QEMU exited 0, an image, send-keys or mouse exchange is
  now refused as 409 `Conflict("guest is powered off")`, kept out of Sentry. The socket can close
  before the exit is published (that waits for stderr to drain), so a closed socket on a guest
  that still looks up waits up to 2 seconds for the exit. The refusal runs before session
  cleanup, so an exit published during that wait, with a nonzero code or on a resumed guest,
  still ends the session errored and frees its slot.

### Attempt 8

- **A mint whose model never powered the guest off errored and fired three Sentry events**
  (`apps/qemu-server/src/sessions.ts`, `src/driver/loop.ts`, `packages/http/src/api.ts`; Sentry
  `OLIGARCHY-TEST-16`, `OLIGARCHY-TEST-30`). The save waited 2 minutes, failed with a 502, and
  the driver exited 1. Now a guest that stays up is a 409 `Conflict` on save and its session ends
  failed, not errored, so `Close.judge` completes the job. A disk that cannot be kept is still a
  502 and ends errored. The driver treats only the refusal "guest did not power off" as the
  model's failure: the result closes failed and the driver exits 0 printing `not-powered-off`.
  Any other save failure is still the run's. `client.md` and `minted-disks.md` describe both
  outcomes.

### Attempt 10

- **Three bad model replies errored the mint** (`src/driver/loop.ts`; Sentry
  `OLIGARCHY-TEST-16`, `OLIGARCHY-TEST-3A`). The model sent malformed JSON three times in a row,
  and the driver failed the run. Three bad replies are now `limit-reached`, like the step limit:
  the guest stops failed, a mint is never saved, the result closes failed with the quoted
  replies, and the driver exits 0. An OpenRouter failure still exits 1.
- **One Linear timeout in a board watch paged Sentry, and so did the label clear after it**
  (`apps/automation-server/src/backlog.ts`, `packages/linear/src/client.ts`; Sentry
  `OLIGARCHY-TEST-2S`, `OLIGARCHY-TEST-3B`). The Automation Needed watch queued a mint and then
  its ready-label add timed out, failing the watch at ERROR. The label never landed, so clearing
  it when the mint closed got "Label not on issue". Now a per-ticket watch step (label add, move)
  that fails with a retryable Linear error is a warning, since the next poll repeats it; any
  other failure is still an error. Writes are never retried: one that landed but whose answer was
  lost would be resent over newer state. `clearReady` treats "Label not on issue" as already
  clear, and a response that also carries another error still fails.

### Operator slips (no code change)

- In attempt 8 the mint list for `ultra-tick.sh` was written as JSON instead of
  `<ticket> <server> <result>` lines, so a failed mint went unnoticed for about 20 minutes.
  Later attempts write it in the right format.

## Still open

- **The mint model skips the shutdown.** Six mints called Done before powering the guest off
  (OLIT-1030, OLIT-1115, OLIT-1141, OLIT-1142, OLIT-1155, OLIT-1168), five of them in the last
  five attempts. Each now ends as a clean failed verdict and is re-minted, but it costs about 20
  minutes each time. A driver nudge would likely fix it: refuse a mint's first Done while the
  guest still answers screenshots, and repeat the shutdown instruction.
- **Lock-screen proof.** Most remaining lock-screen failures are the model clicking Lock and
  typing the password without a screenshot in between. The instruction or the driver could require
  an image after the Lock click.
- `TODOS.md` items from earlier batches: the heartbeat `removeServer` edge, and "at capacity"
  logged at ERROR on every reserve that finds the server full.
- `.local-env` is untracked and nothing is committed yet.
