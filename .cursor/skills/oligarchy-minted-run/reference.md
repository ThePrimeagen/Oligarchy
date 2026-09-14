# Minted-run reference

Read from SKILL.md only when you need IDs, incidents, or queries. Linear state IDs, the ledger,
the recorded run file, token usage, and the incident list are the super-run's:
`.cursor/skills/oligarchy-super-run/reference.md`. Everything there holds here; the helper scripts
are the same files, installed under `/tmp/mintedrun` with this fleet's ports in `SUPER_RUN_PORTS`.

## This fleet

| Process | Port | Flags | Data |
|---|---|---|---|
| qemu-reverse-proxy | 55555 | | |
| qemu-a | 55341 | `--max-jobs 1` | `$OLIGARCHY_DATA_ROOT/qemu-a` |
| qemu-b | 55342 | `--max-jobs 1` | `$OLIGARCHY_DATA_ROOT/qemu-b` |
| qemu-c | 55343 | `--max-jobs 1` | `$OLIGARCHY_DATA_ROOT/qemu-c` |
| qemu-d | 55344 | `--max-jobs 1` | `$OLIGARCHY_DATA_ROOT/qemu-d` |
| automation-client-4 | 52224 | `--max-jobs 4` | |
| automation-server | 54321 | `--model openrouter/meta/muse-spark-1.3-contributor` | |

`OLIGARCHY_DATA_ROOT` defaults to `$HOME/personal/oligarchy-data` (`install.sh` creates the four
dirs and seeds each `isos/` with the ISO and its `manifest.json` entry from `SUPER_RUN_ISO_CACHE`,
default `~/.oligarchy/isos`, when that cache has it — a reflink on btrfs, a copy elsewhere; a dir
that has the ISO is left alone). Sessions still live under `OLIGARCHY_SESSIONS_DIR` (`TMPDIR` on
each qemu server); a data dir holds only `isos/` — the ISO and, once minted, `<iso>.qcow2` and
`<iso>.OVMF_VARS.fd` beside it. Present means minted. Neither `install.sh` nor `reset.sh` touches
a minted disk.

## Mint phase queries

Mint tickets are not in the ledger. By ticket:

```bash
psql "$DBURL" -X -c "select r.linear_id, r.status, r.reason, j.action, j.status as job
  from test_results r left join automation_jobs j on j.result_id = r.result_id
  where r.linear_id in ('OLI-…','OLI-…','OLI-…','OLI-…') order by r.linear_id, j.action;"
```

The saved session's row ends `succeeded` with reason `saved; minted <iso>`; a save that failed ends
`failed` with the reason and a debug log, and nothing was kept.

## Mint-specific incidents to watch for

- A ticket created with no drive job: the webhook can beat `setLinearId`. Move the ticket to In
  Progress and back to Automation Needed; a state change queues the drive.
- `no minted disk for <iso> on this machine` on a batch start: that server was not minted (or its
  data dir was wiped). INFRA; mint it before refilling.
- Two servers sharing a data dir: two mints overwrite one disk. Check the four `data` values in the
  `listening on` lines before minting.
- A mint result passed but no `.qcow2` beside the ISO, or the reverse: harness defect, analyze
  before anything else.
