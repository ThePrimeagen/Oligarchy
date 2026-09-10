# TODOs

Things noticed during the super run that need addressing but did not block it.

- `SUB_AGENT` in `src/ctrl/prompts.ts` is `Grok 4.6 high fast (cursor-grok-4.6-high-fast)`, a Cursor
  model name, so every Linear ticket tells the driver to "spawn a Grok 4.6 high fast subagent" to
  verify the proof. An opencode agent cannot; the muse-1.3 driver on OLI-1065 noted it and verified
  the proof itself. Either drop the rule for opencode drivers or name something they can run.
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
