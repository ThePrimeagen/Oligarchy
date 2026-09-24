# Control

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 26 |
| [Synopsis](#synopsis) | 32 |
| [test --list](#test---list) | 63 |
| [test define](#test-define) | 81 |
| [test details](#test-details) | 97 |
| [test run](#test-run) | 111 |
| [test run testsuite](#test-run-testsuite) | 129 |
| [mint](#mint) | 145 |
| [test list](#test-list) | 164 |
| [test start](#test-start) | 176 |
| [test-results](#test-results) | 193 |
| [session list](#session-list) | 211 |
| [session](#session) | 227 |
| [session --search](#session---search) | 254 |
| [error-type new](#error-type-new) | 272 |
| [error-type list](#error-type-list) | 287 |
| [diagnose](#diagnose) | 301 |
| [automation --list](#automation---list) | 320 |

## Important

`./ctrl` is the control plane's record keeper: it creates test runs, opens their Linear tickets, ties a session to its result, closes the result, reads sessions back, and records a verdict on every ended session. Everything it reads and writes is in the database; it never touches a guest — the guest is `./client`'s — and it avoids calling a server for any data that is in the database. Only data that is ephemeral and machine-specific, stored nowhere but in the state of the machine itself, is asked of the reverse proxy: today that is one call, [mint](#mint) `--unminted` asking which servers hold a minted disk.

If you are an agent driving a guest, you need two of these: [test start](#test-start) after `./client start`, and [test-results](#test-results) before `./client stop` — or after `./client save`, on a mint ticket, with what it answered. If you are an agent reviewing a session, you need [session](#session), [error-type list](#error-type-list), [error-type new](#error-type-new) and [diagnose](#diagnose). Do not look at code. Run the commands.

## Synopsis

```
./ctrl <action> ...

./ctrl test --list    [--details] [--name <definition>] [--history]
./ctrl test define    --name <definition> [--description <text>] [--instruction <text>] [--proof <text>]
./ctrl test details   --name <definition>
./ctrl test run       --name <definition> --server-url <url> --iso <https-url> --version <version>
./ctrl test run testsuite --server-url <url> --iso <https-url> --version <version>
./ctrl test list
./ctrl mint           --server-url <url> --iso <https-url> [--unminted]
./ctrl test start     --session-id <id> --test-result-id <id> --model <id>
./ctrl test-results   --agent-id <agent> --id <id> --status success|failed [--reason <text>]
./ctrl session list   [--count <n>] [--active] [--json]
./ctrl session        --session-id <id>|--agent-id <ticket> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all
./ctrl session        --search --test-result-id <id>
./ctrl error-type new  --key <key> --description <text>
./ctrl error-type list [--json]
./ctrl diagnose       --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
./ctrl automation --list [--count <n>]
```

The action comes first. Every value is a flag; there are no positional arguments. Flags may sit in any order after the action.

- `DATABASE_URL` — read from the environment by every action; it is the only variable most of them need. `test run`, `test run testsuite`, `mint` and `test list` also read `LINEAR_API_TOKEN` and `LINEAR_TEAM`, in that order. `LINEAR_TEAM` is the Linear team those tickets are filed on. It is required and has no default, so a local run and production can name different teams. No action reads `OLIGARCHY_TOKEN`. A `.env` in the current directory fills in missing variables only. `--env-file <path>` also reads that file: the process environment wins, then the file, then `.env`. A missing variable means exit 1.
- `--session-id <id>` — taken by `test start`, `session` and `diagnose`. Omitted, it is read from `SESSION_ID` in the environment; the flag wins when both are given, and an empty `SESSION_ID` counts as unset. Set it once — `SESSION_ID=$(./ctrl session --search --test-result-id <id>) && export SESSION_ID`, so a failed search stops there instead of exporting nothing — and every command that follows is about that session. Neither given is a usage error; on `session` without `--search` it is the refusal `session: --session-id, SESSION_ID or --agent-id is required`.
- `--server-url <url>` — taken by `test run`, `test run testsuite` and `mint`: the qemu server the driving agents will talk to, a full http or https URL, stored on the run and written into every ticket. Falls back to `SERVER_URL` from the environment; there is no default. `test start` and `test-results` accept it and ignore it, so a ticket written before it went still runs; every other action refuses it as an unrecognized flag.

A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## test --list

```
./ctrl test --list [--details] [--name <definition>] [--history]
```

Lists stored test definitions, one name per line, each in its newest wording. Not used while driving a guest.

- `--list` — required.
- `--details` — print every field of each definition as JSON instead of the name.
- `--name <definition>` — only this definition. A name that matches none is a failure.
- `--history` — every wording of each definition instead of the newest only, oldest first, one per line as `<name> v<n>`; with `--details`, the rows as JSON, each carrying its `version`. `v1` is the first wording ever stored, `v<n>` the n-th; the `id` is the row a test result pins.

```bash
./ctrl test --list --details --name lock-screen
./ctrl test --list --history --name lock-screen
```

## test define

```
./ctrl test define --name <definition> [--description <text>] [--instruction <text>] [--proof <text>]
```

Stores a test definition, or a new wording of one, and prints it as JSON: `{ id, name, version }`. A wording is never edited in place: every result records the `id` it ran against, so the wording behind a past verdict is always the one the driver was handed. The definitions page shows the newest wording and the one before it as text. Not used while driving a guest.

- `--name <definition>` — the test. A name nobody carries yet needs all three fields and becomes `v1`; a known name gets the next version, and `test run` runs that from then on.
- `--description <text>`, `--instruction <text>`, `--proof <text>` — the wording. On a known name a field left out is carried forward from the newest wording, so one flag changes one field. Nothing changed is a failure: `test define: <name> is unchanged`.

```bash
./ctrl test define --name lock-screen --description "Lock the screen" --instruction "Press Super+L" --proof "The lock screen shows the clock"
./ctrl test define --name lock-screen --proof "The lock screen shows the clock and the user's name"
```

## test details

```
./ctrl test details --name <definition>
```

Prints one definition's newest wording: `<name> v<n>` on the first line, `added <ISO time>` on the second, then a blank line and the `description`, `instruction` and `proof`, each under its own label and separated by blank lines. `v<n>` counts as in `test --list --history`. Not used while driving a guest.

- `--name <definition>` — the test. Required. A name that matches none is a failure: `test: no test definition named <name>`.

```bash
./ctrl test details --name lock-screen
```

## test run

```
./ctrl test run --name <definition> --server-url <url> --iso <https-url> --version <version>
```

Creates one pending test run and one Linear issue for one stored test definition, in its newest wording, and prints them as JSON. `--name` is required; omitting it is a usage error, and the run of every definition is `test run testsuite`. The issue is assigned to `prime@terminal.shop`. `--server-url` is stored on the run and written into the issue as the qemu server the driving agent's `./client` talks to; `./ctrl` itself never calls it. Not used while driving a guest. Reads `LINEAR_API_TOKEN` and `LINEAR_TEAM`.

The issue is created in `Backlog` and moved to `Automation Needed` once its result carries its identifier. One left in `Backlog` by a failure or a Ctrl-C is logged as `ticket trapped in Backlog; <reason>` and reported to Sentry; a failure also fails the run naming the ticket (`…; created OLI-n`).

- `--name <definition>` — the one definition, in its newest wording. A name that matches none is a failure.
- `--iso <https-url>` — the ISO whose minted disk the agents resume; the ticket's start line carries `--resume`. Must be HTTPS.
- `--version <version>` — the version label attached to the issue.

```bash
./ctrl test run --name lock-screen --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --version 1.2.3
```

## test run testsuite

```
./ctrl test run testsuite --server-url <url> --iso <https-url> --version <version>
```

One pending result for every stored test definition, each in its newest wording, and one Linear ticket each, printed as the same JSON. There is no `--name`; one definition is `test run --name`. A definition named `mint` is included when one is stored, and it is ticketed with the test template, not the mint template. Not used while driving a guest. Reads `LINEAR_API_TOKEN` and `LINEAR_TEAM`.

The dashboard answers the same run at `POST /create-test-suite-run` by running `./ctrl test run testsuite`, JSON `{ iso, version, serverUrl }` in and the same JSON out. It is not linked from a page. The button would sit in the definitions heading, beside "Test definitions", not on a selected card: a card button would read as running that one name. It would post those three fields and show the run id and ticket identifiers, and stay disabled when the list is empty.

Tickets are born in `Backlog` and moved to `Automation Needed` as in `test run`. An empty table is refused before Linear: `test: no test definitions found`.

```bash
./ctrl test run testsuite --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --version 1.2.3
```

## mint

```
./ctrl mint --server-url <url> --iso <https-url> [--unminted]
```

Not a test: it gets the ISO installed once on every qemu server, so that server holds the ISO's minted disk and every later test on it can `start --resume` into a finished install instead of installing. For each live qemu server the reverse proxy at `--server-url` knows, it creates one pending run with one result under the definition named `mint`, and one Linear issue pinned to that server: the ticket tells its driver to `relinquish`, `reserve --server <that server>`, `start` fresh, install as the `mint` definition instructs, shut the machine down from inside, end with `./client save` instead of `stop`, and close the result with what `save` answered. The `mint` label sits beside the agent test label on every issue. Prints the runs as JSON, one per server: run id, result id, server url, ticket. Reads `LINEAR_API_TOKEN` and `LINEAR_TEAM`.

- `--iso <https-url>` — the ISO to install. Must be HTTPS. Every server minted from it answers `start --resume` for that url afterwards.
- `--server-url <url>` — the reverse proxy the drivers talk to; the live qemu servers behind it are the ones minted.
- `--unminted` — ticket only the live qemu servers that do not hold this ISO's minted disk: the redo after a mint that failed, or after the operator removed one server's disk. Asks the reverse proxy at `--server-url` once (`GET /minted?iso=`, the one server call `./ctrl` makes; reads `OLIGARCHY_TOKEN`), which asks every server whether the two files are beside its ISO. A minted server is skipped and named in the log line; every live server minted prints `[]` and exits 0. Refused before anything is created when a live server gave the proxy no answer of its own (`<url> did not answer /minted`): fix that server, or mint without the flag. A second mint overwrites, so without the flag every server is minted again.

Refused before anything is created when there is no definition named `mint` — define the install once with `test define --name mint`, its instruction holding the user name, password and disk passphrase and how the desktop is shut down from inside, its proof the desktop after the reboot — or when no qemu server is live. A Linear failure part-way fails the run it was creating and names the tickets that stand; the servers already ticketed keep theirs. Issues move from `Backlog` to `Automation Needed` as in `test run`, and one left behind is reported the same way.

```bash
./ctrl mint --server-url https://qemu.example.com --iso https://example.com/omarchy.iso
./ctrl mint --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --unminted
```

## test list

```
./ctrl test list
```

Prints every Linear issue on the team named by `LINEAR_TEAM` whose status type is backlog, as JSON: `id`, `identifier`, `title`, `url`, `updatedAt`. An empty backlog prints `[]`. Not used while driving a guest. Reads `LINEAR_API_TOKEN` and `LINEAR_TEAM`.

```bash
./ctrl test list
```

## test start

```
./ctrl test start --session-id <id> --test-result-id <id> --model <id>
```

Ties a pending test result to the session that is running it and records the Cursor model that is running it. The result already names its definition. An unknown session, or a result that is missing or not pending, is a failure.

- `--session-id <id>` — the id printed by `./client start`; `SESSION_ID` when omitted.
- `--test-result-id <id>` — the result UUID from the Linear issue.
- `--model <id>` — the Cursor model id that is running this result.
- `--server-url <url>` — accepted and ignored; tickets written before it went still name it.

```bash
./ctrl test start --session-id 6f1c...e2a9 --test-result-id 2222...2222 --model <the Cursor model id you are running as>
```

## test-results

```
./ctrl test-results --agent-id <agent> --id <id> --status success|failed [--reason <text>]
```

Closes one pending test result with the verdict.

- `--agent-id <agent>` — your id; that agent's session is looked up and recorded on the result.
- `--id <id>` — the result UUID from the Linear issue.
- `--status <status>` — `success` or `failed`.
- `--reason <text>` — optional text stored on the result.
- `--server-url <url>` — accepted and ignored; tickets written before it went still name it.

```bash
./ctrl test-results --agent-id OLI-42 --id 2222...2222 --status failed --reason "installer hung"
```

## session list

```
./ctrl session list [--count <n>] [--active] [--json]
```

Prints the most recent sessions, newest first, one per line: the status, colored (green `succeeded`, red `failed`, yellow `running`, gray `downloading`, bright red `aborted`, magenta `timed_out`, cyan `completed`, bold red `errored`); how long ago it started (`45s ago`, `12m ago`, `1h30m ago`, `3d5h ago`); then the session id. Not used while driving a guest.

- `--count <n>` — how many sessions to print, at least 1. Default 10.
- `--active` — print up to the requested count of active sessions, with running sessions before downloads.
- `--json` — print one JSON array of `{ id, status, startedAt }` objects instead of the colored lines.

```bash
./ctrl session list --count 25
```

## session

```
./ctrl session --session-id <id>|--agent-id <ticket> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all
```

Prints what is stored for one session, as JSON. At least one selector is required; one selector prints that value, several print an object keyed by them. An unknown session is a failure. Not used while driving a guest; a reviewing agent starts here, and the session id is all it needs — everything else is reached from it. With only a test result id in hand, [session --search](#session---search) finds the session first.

- `--session-id <id>` — the session; `SESSION_ID` when omitted.
- `--agent-id <ticket>` — the Linear ticket instead: the session its result ran in. It wins over `--session-id` and `SESSION_ID`. A ticket no result carries (`session: no test result for <ticket>`), or one whose result no session has started (`session: <ticket> has no session yet`), is a failure; with `--search` it is refused (`session: --search takes no --agent-id`).
- `--status` — the session row: `{ id, config, status, reason, startedAt, endedAt }`. `status` and `reason` are the driver's verdict as `./client stop` recorded it, or `errored` with what the qemu server saw fail; `config` is what it booted.
- `--logs` — its log lines, oldest first.
- `--test-def` — the test definition its result ran, in the wording it ran (a later `test define` does not change it), or `null`.
- `--test-results` — the test result attributed to it, or `null`.
- `--test-run` — the test run that result belongs to (`iso`, `serverUrl`, `status`), or `null`.
- `--actions` — its QMP actions, oldest first.
- `--images` — its screenshots, oldest first, as `{ id, actionId, url, createdAt }`; `url` serves the PNG without a token, and `./session image --image-id <id> [-o <file>]` prints the same PNG straight from the database. `[]` when none were taken.
- `--debug-logs` — the debug log the qemu server saved when the session ended, however it ended (any `stop`, a `save`, the ten-minute timeout, a qemu server shutdown), or `null` while it runs or when the save failed. `{ sessionId, sources: { serial, proxy, qemu, actions }, createdAt }`: `serial` is everything the guest wrote to `/dev/ttyS0`, `proxy` the session's log lines as `created_at level text`, `qemu` the last 4 KiB of QEMU's stderr, `actions` the QMP exchanges as `created_at id state request[ response]`. Each is capped at 1 MiB, keeping the end. This is where a session's console lives; a running session's console is `./client get-serial`, from its driver.
- `--diagnosis` — the post-run diagnosis written with [diagnose](#diagnose), or `null` when nobody has reviewed the session. `{ sessionId, verdict, errorType, summary, model, createdAt }`; `errorType` is `null` on a `passed` verdict.
- `--all` — all nine: `{ session, logs, results, test_definition, test_run, actions, images, debug_log, diagnosis }`.

```bash
./ctrl session --session-id 6f1c...e2a9 --all
./ctrl session --session-id 6f1c...e2a9 --debug-logs
./ctrl session --agent-id OLI-42 --all
```

## session --search

```
./ctrl session --search --test-result-id <id>
```

The other way round from [session](#session): a test result id in, the id of the session that ran it out, as one bare line and nothing else, so a shell can capture it into `SESSION_ID` and every command after reads it. A result nobody has (`session: no test result <id>`), or one no session has started yet (`session: result <id> has no session yet`), is a failure. Not used while driving a guest.

- `--search` — required; the verb of this form.
- `--test-result-id <id>` — the result UUID from the Linear issue. Without `--search` it is refused (`session: --test-result-id needs --search`); `--search` without it likewise (`session: --search needs --test-result-id`).
- The selectors are refused (`session: --search takes no selector`): inspect through the id printed. `--session-id` and `SESSION_ID` do not affect a search; the result names the session.

```bash
./ctrl session --search --test-result-id 2222...2222
SESSION_ID=$(./ctrl session --search --test-result-id 2222...2222) && export SESSION_ID
./ctrl session --all
```

## error-type new

```
./ctrl error-type new --key <key> --description <text>
```

Adds one error type to the vocabulary diagnoses are written in. The table starts empty and grows one type per distinct cause, the first time that cause is seen; there is no `other` or `unclassified`. Minting is rare and deliberate: a reviewer reads the whole of [error-type list](#error-type-list) first and mints only when no description matches the cause in the evidence — a different wording or symptom of a known cause is not a new type. A key that already exists is a failure: `error-type new: <key> already exists`. Not used while driving a guest.

- `--key <key>` — the identifier a diagnosis carries: snake_case, `a-z`, `0-9` and `_`, starting with a letter (`guest_boot_hang`). Anything else is refused before the database is touched.
- `--description <text>` — what a failure of this type looks like, so the next reader picks the same key for the same cause.

```bash
./ctrl error-type new --key guest_boot_hang --description "The guest never reached the login screen; the serial console stops during boot"
```

## error-type list

```
./ctrl error-type list [--json]
```

Prints every error type, ordered by key, one per line: the key, two spaces, the description, keys padded so the descriptions line up. An empty table prints nothing. Not used while driving a guest.

- `--json` — print the rows as a JSON array of `{ key, description, createdAt }` instead; an empty table prints `[]`.

```bash
./ctrl error-type list
```

## diagnose

```
./ctrl diagnose --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
```

Records the post-run diagnosis: a reviewer's verdict on one session that has ended, whatever the driver said about it: a `succeeded`, `failed`, `aborted` or `completed` stop, or the ten-minute timeout. The automation server queues a review only for a drive or mint job that `completed`, and moves that ticket to Needs Review; one that errored moves its ticket to Errored with the reason instead. When an automation client takes the review, the automation server moves the ticket to In Review before the reviewer starts. A diagnose that succeeded moves the ticket to Succeeded when this verdict is passed and to Failed when it is failed. The reviewer moves nothing on the board. Read the evidence first (`session --all`; the final image through `./session image --image-id <id> -o <file>`, and the images around any step the logs or actions make suspect, against the definition's proof; the debug log), then say whether the proof landed. A `failed` verdict names its cause with the matching type from [error-type list](#error-type-list); only when none matches is one minted with [error-type new](#error-type-new), rarely. One diagnosis per session: a second is a failure and the first stands. Not used while driving a guest.

- `--session-id <id>` — the session; `SESSION_ID` when omitted. Unknown, or still running or downloading, is a failure (`diagnose: session <id> is still running`).
- `--verdict <verdict>` — `passed` when the proof is on screen, `failed` when it is not or the session never got there. The reviewer's own answer; it may contradict the session status and the test result.
- `--type <key>` — the cause of a `failed` verdict, an existing error type key. Required with `failed` (`diagnose: --verdict failed needs --type`), refused with `passed` (`diagnose: --verdict passed takes no --type`). A key that is not in the table is a failure: `diagnose: no error type <key>; create it with ./ctrl error-type new`.
- `--summary <text>` — what happened, in the reviewer's words, from the evidence.
- `--model <id>` — the Cursor model id that is writing this diagnosis.

```bash
./ctrl diagnose --session-id 6f1c...e2a9 --verdict failed --type guest_boot_hang --summary "Serial stops after 'Waiting for root device'; the ISO never mounted" --model <the Cursor model id you are running as>
./ctrl diagnose --session-id 6f1c...e2a9 --verdict passed --summary "The last image shows the lock screen with the clock; matches the proof" --model <the Cursor model id you are running as>
```

## automation --list

```
./ctrl automation --list [--count <n>]
```

Prints the automation queue from the database, never an endpoint: every running job, then every pending job, then the most recently completed jobs. Each job is one line: the status, colored (yellow `running`, gray `pending`, green `succeeded`, red `failed`, bright red `aborted`, magenta `timed_out`, cyan `completed`, bold red `errored`); the action (`drive` or `diagnose`); how long ago (`5s ago`, `12m ago`, `1h30m ago`, `3d5h ago`) — running from when it started, pending from when it was queued, completed from when it finished; the Linear ticket, or `—` when none; then the test name. Empty groups still print their header. Not used while driving a guest.

- `--list` — required.
- `--count <n>` — how many completed jobs to print, at least 1. Default 10. Running and pending are always printed in full.

```bash
./ctrl automation --list
./ctrl automation --list --count 25
```
