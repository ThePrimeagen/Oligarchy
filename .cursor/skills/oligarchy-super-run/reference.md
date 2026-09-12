# Super-run reference

Read from SKILL.md only when you need IDs, incidents, or queries.

## Linear state IDs (terminaldotshop)

Used by `linear-state.sh`. Re-check if the workspace workflow changes.

| State | UUID |
|-------|------|
| Needs Review | `cdf3eb61-bc4b-4b61-8e47-cc2c145a6b6a` |
| Canceled | `4e654471-6d94-4ef7-aea6-586fe11c19a1` |
| In Progress | `2a566723-82d0-40ef-ac2a-55b1811da198` |
| Done | `c763405d-1724-401d-b6ab-9fa352172819` |

## Ledger

`/tmp/superrun/next` — next N to assign. Monotonic. Never reuse.

`/tmp/superrun/active` — one line: `N|DIR|RID|TICKET|CREATED`

`automation-super-run-logs/index.tsv` — one row per retire. Column 2 is
`COUNTED` or `INFRA`. Target is 100 COUNTED. INFRA is recorded and
replaced. `tick.sh` prints `LEDGER counted=… remaining=… refill=…`.

`retire.sh <n> COUNTED|INFRA [note]` records then deletes that N from
`active`. Look N up from `active` by ticket; never guess.

## Recorded run file

`automation-super-run-logs/<dir>/<NNN>-<TICKET>.md` produced by `record.sh`.
Fields: kind, model, created, result id, Linear URL, session, drive job,
result, diagnose job, diagnosis + summary, pipeline `complete`|`incomplete`,
optional operator note, webhook log.

## Token usage

Oligarchy does not store tokens. OpenCode does, locally:

`~/.local/share/opencode/opencode.db` table `session`
(`tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `cost`).

```bash
sqlite3 ~/.local/share/opencode/opencode.db \
  "select model, count(*), printf('%.2f', sum(cost)),
          sum(tokens_input), sum(tokens_output), sum(tokens_cache_read)
   from session
   where directory like '%/oligarchy%'
   group by model;"
```

A finished DeepSeek drive was ~$0.03 (cache-read dominates). OpenRouter's
usage page is billed truth.

## Incidents (do not repeat)

- **Cleanup wipe (OLI-1217–1221):** per-dir `psql` failed (`unknown` /
  no route); script `rm -rf`'d live guest disks. QEMU kept unlinked inodes;
  QMP was gone. Cleanup must **one-query** running session ids and **keep
  all dirs on query failure**. Those five were INFRA / Canceled / not counted.
- **Dispatch `read ETIMEDOUT`:** after long idle, restart automation-server.
- **PlanetScale slot exhaustion:** never open one `psql` per ticket/dir.
  Batch. `board.sh` / `tick.sh` are one query for the active set.
- **OLI-1187 idle hang:** last action then ~90 m; qemu gone; opencode alive;
  30 m ceiling did not fire. Abort INFRA. Want an idle/action watchdog.
- **OLI-1197 / 1224 / 1226 `driver_loop_ceiling`:** lock (or failed unlock)
  then TTY / `send-keys` storm. `doom_loop` does not fire (keys change).
  Counted. Close result failed, abort session, Needs Review.
- **OLI-1224:** locked, typed `test1234` (wrong password), never restored.
- **OLI-1226:** locked, then TTY/`journalctl` loop; desktop never restored.
- **Free Muse:** rate limit at 4-wide; daily IP quota; image-upload 400
  after many screenshots. Paid Muse only: `openrouter/meta/muse-spark-1.3-contributor`.
- **Tmpfs QEMU abort:** screendump write error → libpng `abort()`. Sessions
  must live on disk (`TMPDIR` on qemu-server).
- **Retire by N, not by guessing:** 049 was OLI-1224, not OLI-1229. Always
  `awk` the ticket out of `active`.
- **localhost vs 127.0.0.1:** servers bind `127.0.0.1`. Announce
  `http://127.0.0.1:<port>`. `localhost` can resolve to `::1`.

## Env the six processes need

From `.env` in the repo root (already-set vars win):

- All: whatever the wrappers already read (`OLIGARCHY_TOKEN`, `DATABASE_URL`, …)
- `ctrl test new`: `LINEAR_API_TOKEN`, `DATABASE_URL`
- qemu-server: `TMPDIR` **in the process environment**, expanded path
- automation-client: `SERVER_URL=http://127.0.0.1:55555` so `/reserve` hits the
  proxy (which places onto a live qemu). Default is `:42069`. Not in `.env`.
- OpenCode: operator's OpenRouter / provider credentials on the machine

Cloudflare tunnel in front of `:55555` is not started by this skill.

## `--name`, `--max-jobs`, no `--jobs`

`./qemu-server` and `./automation-client` require `--name` and `--max-jobs`.
`--name` is unique on `servers`. `--url` is the upsert key and how they
announce. Proxy and `./automation-server` have neither flag.

`./automation-server --help` has `--port` and `--model` only. Dispatch
claims every pending job a live client will reserve. `--max-jobs` on
qemu/client is the reserve cap. Default `--model` is the free Muse; this
skill passes paid `openrouter/meta/muse-spark-1.3-contributor`.
