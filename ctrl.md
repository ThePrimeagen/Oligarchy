# Control

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 23 |
| [Synopsis](#synopsis) | 29 |
| [test --list](#test---list) | 56 |
| [test define](#test-define) | 74 |
| [test new](#test-new) | 90 |
| [test list](#test-list) | 106 |
| [test run](#test-run) | 118 |
| [test start](#test-start) | 134 |
| [test-results](#test-results) | 150 |
| [session list](#session-list) | 167 |
| [session](#session) | 183 |
| [error-type new](#error-type-new) | 209 |
| [error-type list](#error-type-list) | 224 |
| [diagnose](#diagnose) | 238 |
| [diagnose run](#diagnose-run) | 257 |

## Important

`./ctrl` is the control plane's record keeper: it creates test runs, opens their Linear tickets, spawns driving agents, ties a session to its result, closes the result, reads sessions back, spawns reviewing agents, and records their verdict on every ended session. It never touches a guest — that is `./client`.

If you are an agent driving a guest, you need two of these: [test start](#test-start) after `./client start`, and [test-results](#test-results) before `./client stop`. If you are an agent reviewing a session, you need [session](#session), [error-type list](#error-type-list), [error-type new](#error-type-new) and [diagnose](#diagnose). Do not look at code. Run the commands.

## Synopsis

```
./ctrl <action> --server-url <url> ...

./ctrl test --list    [--details] [--name <definition>] [--history]
./ctrl test define    --name <definition> [--description <text>] [--instruction <text>] [--proof <text>]
./ctrl test new       --iso <https-url> --version <version> [--name <definition>]
./ctrl test list
./ctrl test run       --ticket <linear-ticket> [--model <id>]
./ctrl test start     --session-id <id> --test-result-id <id> --model <id>
./ctrl test-results   --agent-id <agent> --id <id> --status success|failed [--reason <text>]
./ctrl session list   [--count <n>] [--active] [--json]
./ctrl session        --session-id <id> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all|--dump
./ctrl error-type new  --key <key> --description <text>
./ctrl error-type list [--json]
./ctrl diagnose       --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
./ctrl diagnose run   --session-id <id>
```

The action comes first. Every value is a flag; there are no positional arguments. Flags may sit in any order after the action.

- `--server-url <url>` — the oligarchy server, a full http or https URL. Required on every action but `test run`; falls back to `SERVER_URL` from the environment. There is no default.
- `DATABASE_URL` — read from the environment by every action. `test new` and `test list` also read `LINEAR_API_TOKEN`; `test run` and `diagnose run` also read `CURSOR_API_TOKEN`; `session --dump` also reads `OLIGARCHY_TOKEN`, the proxy's bearer token — the other `session` selectors never need it. A `.env` in the current directory fills in missing variables only. A missing variable means exit 1.

A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## test --list

```
./ctrl test --list --server-url <url> [--details] [--name <definition>] [--history]
```

Lists stored test definitions, one name per line, each in its newest wording. Not used while driving a guest.

- `--list` — required.
- `--details` — print every field of each definition as JSON instead of the name.
- `--name <definition>` — only this definition. A name that matches none is a failure.
- `--history` — every wording of each definition instead of the newest only, oldest first, one per line as `<name> v<n>`; with `--details`, the rows as JSON, each carrying its `version`. `v1` is the first wording ever stored, `v<n>` the n-th; the `id` is the row a test result pins.

```bash
./ctrl test --list --server-url https://qemu.example.com --details --name lock-screen
./ctrl test --list --server-url https://qemu.example.com --history --name lock-screen
```

## test define

```
./ctrl test define --server-url <url> --name <definition> [--description <text>] [--instruction <text>] [--proof <text>]
```

Stores a test definition, or a new wording of one, and prints it as JSON: `{ id, name, version }`. A wording is never edited in place: every result records the `id` it ran against, so the wording behind a past verdict is always the one the driver was handed, and the dashboard charts each version on its own. Not used while driving a guest.

- `--name <definition>` — the test. A name nobody carries yet needs all three fields and becomes `v1`; a known name gets the next version, and `test new` runs that from then on.
- `--description <text>`, `--instruction <text>`, `--proof <text>` — the wording. On a known name a field left out is carried forward from the newest wording, so one flag changes one field. Nothing changed is a failure: `test define: <name> is unchanged`.

```bash
./ctrl test define --server-url https://qemu.example.com --name lock-screen --description "Lock the screen" --instruction "Press Super+L" --proof "The lock screen shows the clock"
./ctrl test define --server-url https://qemu.example.com --name lock-screen --proof "The lock screen shows the clock and the user's name"
```

## test new

```
./ctrl test new --server-url <url> --iso <https-url> --version <version> [--name <definition>]
```

Creates one pending test run and one Linear issue per stored test definition, each in its newest wording, and prints them as JSON. Each issue is assigned to `prime@terminal.shop`. `--server-url` is stored on the run and written into every issue as the proxy the driving agent talks to. Not used while driving a guest. Reads `LINEAR_API_TOKEN`.

- `--iso <https-url>` — the ISO the agents boot. Must be HTTPS.
- `--version <version>` — the version label attached to every issue.
- `--name <definition>` — create a run for this one definition instead of every definition, in its newest wording like the rest. A name that matches none is a failure.

```bash
./ctrl test new --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --version 1.2.3
```

## test list

```
./ctrl test list --server-url <url>
```

Prints every Linear issue on the Oligarchy team whose status type is backlog, as JSON: `id`, `identifier`, `title`, `url`. An empty backlog prints `[]`. Not used while driving a guest. Reads `LINEAR_API_TOKEN`.

```bash
./ctrl test list --server-url https://qemu.example.com
```

## test run

```
./ctrl test run --ticket <linear-ticket> [--model <id>]
```

Spawns a Cursor cloud agent that drives one Linear ticket. The ticket carries the proxy URL, so this is the one action that takes no `--server-url`. The kickoff prompt names the model the agent runs as, which the driver records with `test start --model`. Prints a link to the agent as soon as it starts; does not wait for it. Not used while driving a guest. Reads `CURSOR_API_TOKEN`.

- `--ticket <linear-ticket>` — the issue identifier created by `test new`.
- `--model <id>` — the Cursor model id to run the agent on. Omitted, the agent runs on the default (`grok-4.6`, effort xhigh, fast), named in the prompt as `grok-4.6-xhigh-fast`.

```bash
./ctrl test run --ticket OLI-42
./ctrl test run --ticket OLI-42 --model composer-2.5
```

## test start

```
./ctrl test start --server-url <url> --session-id <id> --test-result-id <id> --model <id>
```

Ties a pending test result to the session that is running it and records the Cursor model that is running it. The result already names its definition. An unknown session, or a result that is missing or not pending, is a failure.

- `--session-id <id>` — the id printed by `./client start`.
- `--test-result-id <id>` — the result UUID from the Linear issue.
- `--model <id>` — the Cursor model id that is running this result.

```bash
./ctrl test start --server-url https://qemu.example.com --session-id 6f1c...e2a9 --test-result-id 2222...2222 --model <the Cursor model id you are running as>
```

## test-results

```
./ctrl test-results --agent-id <agent> --server-url <url> --id <id> --status success|failed [--reason <text>]
```

Closes one pending test result with the verdict.

- `--agent-id <agent>` — your id; that agent's session is looked up and recorded on the result.
- `--id <id>` — the result UUID from the Linear issue.
- `--status <status>` — `success` or `failed`.
- `--reason <text>` — optional text stored on the result.

```bash
./ctrl test-results --agent-id OLI-42 --server-url https://qemu.example.com --id 2222...2222 --status failed --reason "installer hung"
```

## session list

```
./ctrl session list --server-url <url> [--count <n>] [--active] [--json]
```

Prints the most recent sessions, newest first, one per line: the status, colored (green `succeeded`, red `failed`, yellow `running`, gray `downloading`, bright red `aborted`, magenta `timed_out`); how long ago it started (`45s ago`, `12m ago`, `1h30m ago`, `3d5h ago`); then the session id. Not used while driving a guest.

- `--count <n>` — how many sessions to print, at least 1. Default 10.
- `--active` — print up to the requested count of active sessions, with running sessions before downloads.
- `--json` — print one JSON array of `{ id, status, startedAt }` objects instead of the colored lines.

```bash
./ctrl session list --server-url https://qemu.example.com --count 25
```

## session

```
./ctrl session --server-url <url> --session-id <id> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all|--dump
```

Prints what is stored for one session, as JSON. At least one selector is required; one selector prints that value, several print an object keyed by them. An unknown session is a failure. Not used while driving a guest; a reviewing agent starts here, and the session id is all it needs — everything else is reached from it.

- `--session-id <id>` — the session.
- `--status` — the session row: `{ id, config, status, reason, startedAt, endedAt }`. `status` and `reason` are the driver's verdict as `./client stop` recorded it; `config` is what it booted.
- `--logs` — its log lines, oldest first.
- `--test-def` — the test definition its result ran, in the wording it ran (a later `test define` does not change it), or `null`.
- `--test-results` — the test result attributed to it, or `null`.
- `--test-run` — the test run that result belongs to (`iso`, `serverUrl`, `status`), or `null`.
- `--actions` — its QMP actions, oldest first.
- `--images` — its screenshots, oldest first, as `{ id, actionId, url, createdAt }`; `url` serves the PNG without a token, and `./session image --image-id <id> [-o <file>]` prints the same PNG straight from the database. `[]` when none were taken.
- `--debug-logs` — the debug log the proxy saved when the session ended any way but `succeeded` (a `failed` or `aborted` stop, the ten-minute timeout, a proxy shutdown), or `null`. `{ sessionId, sources: { serial, proxy, qemu, actions }, createdAt }`: `serial` is everything the guest wrote to `/dev/ttyS0`, `proxy` the session's log lines as `created_at level text`, `qemu` the last 4 KiB of QEMU's stderr, `actions` the QMP exchanges as `created_at id state request[ response]`. Each is capped at 1 MiB, keeping the end.
- `--diagnosis` — the post-run diagnosis written with [diagnose](#diagnose), or `null` when nobody has reviewed the session. `{ sessionId, verdict, errorType, summary, model, createdAt }`; `errorType` is `null` on a `passed` verdict.
- `--all` — all nine: `{ session, logs, results, test_definition, test_run, actions, images, debug_log, diagnosis }`.
- `--dump` — the session's serial console, printed raw, not as JSON. Asks the proxy at `--server-url`: a session running there answers with the console as it stands; a session it no longer holds still answers when its directory survived on the proxy host — a proxy that died mid-session never removed it — with everything the guest wrote to `/dev/ttyS0` up to the end. A session that is neither is a failure: `session "<id>" has no console on this proxy`. Does not combine with the other selectors; redirect stdout to keep it (`> console.txt`). Reads `OLIGARCHY_TOKEN`.

```bash
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --all
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --dump > console.txt
```

## error-type new

```
./ctrl error-type new --server-url <url> --key <key> --description <text>
```

Adds one error type to the vocabulary diagnoses are written in. The table starts empty and grows one type per distinct cause, the first time that cause is seen; there is no `other` or `unclassified`. Minting is rare and deliberate: a reviewer reads the whole of [error-type list](#error-type-list) first and mints only when no description matches the cause in the evidence — a different wording or symptom of a known cause is not a new type. A key that already exists is a failure: `error-type new: <key> already exists`. Not used while driving a guest.

- `--key <key>` — the identifier a diagnosis carries: snake_case, `a-z`, `0-9` and `_`, starting with a letter (`guest_boot_hang`). Anything else is refused before the database is touched.
- `--description <text>` — what a failure of this type looks like, so the next reader picks the same key for the same cause.

```bash
./ctrl error-type new --server-url https://qemu.example.com --key guest_boot_hang --description "The guest never reached the login screen; the serial console stops during boot"
```

## error-type list

```
./ctrl error-type list --server-url <url> [--json]
```

Prints every error type, ordered by key, one per line: the key, two spaces, the description, keys padded so the descriptions line up. An empty table prints nothing. Not used while driving a guest.

- `--json` — print the rows as a JSON array of `{ key, description, createdAt }` instead; an empty table prints `[]`.

```bash
./ctrl error-type list --server-url https://qemu.example.com
```

## diagnose

```
./ctrl diagnose --server-url <url> --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
```

Records the post-run diagnosis: a reviewer's verdict on one session that has ended, whatever the driver said about it: a `succeeded`, `failed` or `aborted` stop, or the ten-minute timeout. Read the evidence first (`session --all`; the final image through `./session image --image-id <id> -o <file>`, and the images around any step the logs or actions make suspect, against the definition's proof; the debug log), then say whether the proof landed. A `failed` verdict names its cause with the matching type from [error-type list](#error-type-list); only when none matches is one minted with [error-type new](#error-type-new), rarely. One diagnosis per session: a second is a failure and the first stands. Not used while driving a guest.

- `--session-id <id>` — the session. Unknown, or still running or downloading, is a failure (`diagnose: session <id> is still running`).
- `--verdict <verdict>` — `passed` when the proof is on screen, `failed` when it is not or the session never got there. The reviewer's own answer; it may contradict the session status and the test result.
- `--type <key>` — the cause of a `failed` verdict, an existing error type key. Required with `failed` (`diagnose: --verdict failed needs --type`), refused with `passed` (`diagnose: --verdict passed takes no --type`). A key that is not in the table is a failure: `diagnose: no error type <key>; create it with ./ctrl error-type new`.
- `--summary <text>` — what happened, in the reviewer's words, from the evidence.
- `--model <id>` — the Cursor model id that is writing this diagnosis.

```bash
./ctrl diagnose --server-url https://qemu.example.com --session-id 6f1c...e2a9 --verdict failed --type guest_boot_hang --summary "Serial stops after 'Waiting for root device'; the ISO never mounted" --model <the Cursor model id you are running as>
./ctrl diagnose --server-url https://qemu.example.com --session-id 6f1c...e2a9 --verdict passed --summary "The last image shows the lock screen with the clock; matches the proof" --model <the Cursor model id you are running as>
```

## diagnose run

```
./ctrl diagnose run --server-url <url> --session-id <id>
```

Spawns a Cursor cloud agent that reviews one ended session and records its verdict with [diagnose](#diagnose). The agent is handed the session id, `--server-url`, and the reviewer's guide (`ctrl-diagnose.md`), nothing else: it reads the rest back with [session](#session). Prints a link to the agent as soon as it starts; does not wait for it. Not used while driving a guest. Reads `CURSOR_API_TOKEN`.

- `--session-id <id>` — the session. Unknown, still running or downloading, or already diagnosed is a failure (`diagnose run: session <id> already has a diagnosis`), before any agent is spawned.

```bash
./ctrl diagnose run --server-url https://qemu.example.com --session-id 6f1c...e2a9
```
