# TODOs

Things noticed during the super run that need addressing but did not block it.

- `SUB_AGENT` in `src/ctrl/prompts.ts` is `Grok 4.6 high fast (cursor-grok-4.6-high-fast)`, a Cursor
  model name, so every Linear ticket tells the driver to "spawn a Grok 4.6 high fast subagent" to
  verify the proof. Most opencode drivers note it and verify the proof themselves (OLI-1065); one
  (OLI-1094) obeyed with opencode's `task` tool, and its child session's permission asks were never
  answered by `opencode run --auto` (anomalyco/opencode#36868) — a deadlock until the 30-minute
  ceiling. The client now allows the ask-class permissions for every session, which removes the
  deadlock; the rule itself is still a Cursor leftover. Drop it or name something they can run.
- An idle watchdog in the automation client (no opencode log line, stdout or guest action for N
  minutes) would reclaim a wedged slot in ~5 minutes instead of the 30-minute ceiling.
- `test/integration/automation-client.integration.test.ts` "answers 401 without the bearer and
  persists the error in logs" fails when run in the full suite and passes alone: the test reads
  the `logs` table before the client's drain fiber has inserted the row. Wait for the row.
- Session disks (`/tmp/oligarchy-<session>/disk.qcow2`, up to 40G, ~6G after an Omarchy install)
  land on `/tmp`, a 32G tmpfs on this machine. The `.env` has `TMPDIR=~/personal/oligarchy-tmp`
  but `.env` only feeds the Effect config provider, never `os.tmpdir()`, and `~` would not expand
  anyway. Decide where session dirs belong and make the qemu server take it as a flag.
- OLI-1064 (result `ae26db3c…`, the manual pipeline test from 2026-09-10 13:51Z) is left `running`
  in `test_results` with its ticket in `In Progress`; the session was aborted by a qemu server
  shutdown. Close or delete it.
- `./client get-image` (and `./client-with-image get-image`) without `-o` prints the PNG to stdout.
  A driving agent that does this puts raw PNG bytes into its own context; the next request is then
  refused by the opencode provider (`400 invalid_request_error: Invalid upload request`) and the run
  dies (OLI-1067). Consider refusing `get-image` without `-o` when stdout is not a tty, or having
  `client-with-image` always pass `-o "$CLIENT_IMAGE"` for its wrapped action too.
- A `finishAutomationJob` that fails (the database away) leaves the job `running` for good: nothing
  re-finishes it and `claim` only takes `pending`. A sweep for `running` jobs whose client is gone
  is still missing.

## Done during the super run

Genuine harness bugs found by the runs and fixed on branch `automation-model-flag`.

- `98e175e` The automation server takes `--model`; the client runs `opencode run --model <model>`.
  Before, opencode ran its default model (the last manual run used `openrouter/meta/muse-spark-1.3-contributor`
  while the prompt told the agent to record a non-existent `opencode/muse-spark-1-3-contributor-free`).
- `98e175e` A drive whose result is still `pending`/`running` when opencode exits is a failed job
  (`driver exited; result <id> is running`), not a success (OLI-1064).
- `98e175e` opencode's stdout passes through to the automation client's stdout, so an agent that
  quits early leaves a transcript to read.
- `61ee355` Linear sends `updatedFrom.stateId`, never a nested `updatedFrom.state`: a Needs Review
  move had never queued a diagnose from a real webhook. Fixtures corrected; the "serving"
  integration tests now assert against the ticket they seeded instead of a hardcoded `OLI-1063`.
- `bb77520` `opencode run --auto`: a headless run has nobody to answer a permission prompt, so
  opencode rejected the call (`external_directory` for a screenshot in `/tmp`) and exited 0 having
  said nothing (OLI-1064, OLI-1066; upstream anomalyco/opencode#44267).
- `a66b27f` `Cli.run` keeps the last 4 KiB of stderr with NUL bytes stripped: opencode's stderr
  carried 0x00, Postgres `text` refused it, and the job's finish and the client's log row both
  failed, orphaning the job as `running` (OLI-1067).
- The free Muse route (`opencode/muse-spark-1.3-contributor-free`, provider "Console") answers
  `400 invalid_request_error: Invalid upload request` once a drive has read many screenshots into
  its context (OLI-1067 after a binary tool output; OLI-1069 after 16 clean `read`s of 1280x800
  PNGs). The request is not retryable and `opencode run` exits, so the driver dies mid-install.
  Looks like a payload ceiling on the provider; 001 and 004 survived with fewer/smaller images.
  Model/provider behaviour, recorded as failed attempts; a mitigation would be opencode
  compaction or smaller screenshots, not ours to decide here.
- `opencode run` writes its formatted transcript to stderr as well, so a failed run's
  `automation_jobs.reason` (and the `POST /run failed` log row) is the last 4 KiB of transcript
  ending in the error line. Readable, but noisy; `--format json` or a stderr filter would tidy it.
- The free Muse route rate-limits (`Error: Rate limit exceeded. Please try again later.`) when four
  agents run at once (two fresh drives plus two diagnosers, OLI-1080/OLI-1081 at 01:05Z). Both
  drivers died at 5 actions. External quota, not ours; the operator now staggers drive starts by
  ~90 s. If it recurs, run diagnoses one at a time (`--jobs 3`) or space them.
- The OpenCode Zen free tier caps requests per IP per day; the cap answered our ~17th run with
  `Rate limit exceeded` and a `retry-after` of the seconds to UTC midnight (~22.9 h). opencode
  1.18.19 honours that in silence and `opencode run` exits only on idle (anomalyco/opencode#40747,
  #39790; PRs #47641, #42340 open), so three runs slept holding their dispatch slots (OLI-1078's
  diagnoser after writing its verdict, OLI-1082/OLI-1083 before their first call). The client now
  kills a run at 30 minutes; the dispatcher still knows nothing of quotas: a quota-aware pause or
  a model fallback would stop a whole day of runs from timing out one by one.
- (done) The automation client kills an `opencode run` at 30 minutes (`OpenCode.CEILING`) and fails
  the job `opencode run exceeded 30 minutes`; before, a run sleeping out a provider retry-after held
  its slot for as long as the provider said (OLI-1078, OLI-1082, OLI-1083).
- (done) The automation client hands opencode `OPENCODE_CONFIG_CONTENT` allowing
  `external_directory` and `doom_loop` for every session: `--auto` answers only the root session's
  asks, so a driver's `task` subagent reading `/tmp/*.png` deadlocked the run (OLI-1094,
  anomalyco/opencode#36868).
- (done) The run config also sets `provider.openrouter.options.headerTimeout`/`chunkTimeout` to three
  minutes: opencode's OpenRouter path has no stream timeout of its own (anomalyco/opencode#37580),
  and OLI-1106's diagnoser sat on a first request that never answered until the 30-minute ceiling.
- A failed job cannot be retried through the pipeline: `automation_jobs` is unique on
  (result, action), so a second Needs Review move is "already queued" and ignored. Requeueing
  OLI-1106's diagnose (stalled stream, ceiling) meant setting the row back to `pending` by hand.
  A `./ctrl job requeue --id <job>` (or letting a terminal row be replaced) would make that an
  operator command instead of SQL.
