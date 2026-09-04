# Control

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 18 |
| [Synopsis](#synopsis) | 24 |
| [test --list](#test---list) | 46 |
| [test new](#test-new) | 62 |
| [test list](#test-list) | 78 |
| [test run](#test-run) | 90 |
| [test start](#test-start) | 104 |
| [test-results](#test-results) | 119 |
| [session list](#session-list) | 136 |
| [session](#session) | 150 |

## Important

`./ctrl` is the control plane's record keeper: it creates test runs, opens their Linear tickets, spawns driving agents, ties a session to its result, closes the result, and reads sessions back. It never touches a guest — that is `./client`.

If you are an agent driving a guest, you need two of these: [test start](#test-start) after `./client start`, and [test-results](#test-results) before `./client stop`. Do not look at code. Run the commands.

## Synopsis

```
./ctrl <action> --server-url <url> ...

./ctrl test --list    [--details] [--name <definition>]
./ctrl test new       --iso <https-url> --version <version> [--name <definition>]
./ctrl test list
./ctrl test run       --ticket <linear-ticket>
./ctrl test start     --session-id <id> --test-result-id <id>
./ctrl test-results   --agent-id <agent> --id <id> --status success|failed [--reason <text>]
./ctrl session list   [--count <n>]
./ctrl session        --session-id <id> --logs|--test-def|--test-results|--actions|--all
```

The action comes first. Every value is a flag; there are no positional arguments. Flags may sit in any order after the action.

- `--server-url <url>` — the oligarchy server, a full http or https URL. Required on every action; falls back to `SERVER_URL` from the environment. There is no default.
- `DATABASE_URL` — read from the environment by every action. `test new` and `test list` also read `LINEAR_API_TOKEN`; `test run` also reads `CURSOR_API_TOKEN`. A `.env` in the current directory fills in missing variables only. A missing variable means exit 1.

A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## test --list

```
./ctrl test --list --server-url <url> [--details] [--name <definition>]
```

Lists stored test definitions, one name per line. Not used while driving a guest.

- `--list` — required.
- `--details` — print every field of each definition as JSON instead of the name.
- `--name <definition>` — only this definition. A name that matches none is a failure.

```bash
./ctrl test --list --server-url https://qemu.example.com --details --name lock-screen
```

## test new

```
./ctrl test new --server-url <url> --iso <https-url> --version <version> [--name <definition>]
```

Creates one pending test run and one Linear issue per stored test definition, and prints them as JSON. `--server-url` is stored on the run and written into every issue as the proxy the driving agent talks to. Not used while driving a guest. Reads `LINEAR_API_TOKEN`.

- `--iso <https-url>` — the ISO the agents boot. Must be HTTPS.
- `--version <version>` — the version label attached to every issue.
- `--name <definition>` — create a run for this one definition instead of every definition. A name that matches none is a failure.

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
./ctrl test run --server-url <url> --ticket <linear-ticket>
```

Spawns a Cursor cloud agent that drives one Linear ticket, told to pass `--server-url` on every `./client` and `./ctrl` command. Prints a link to the agent as soon as it starts; does not wait for it. Not used while driving a guest. Reads `CURSOR_API_TOKEN`.

- `--ticket <linear-ticket>` — the issue identifier created by `test new`.

```bash
./ctrl test run --server-url https://qemu.example.com --ticket OLI-42
```

## test start

```
./ctrl test start --server-url <url> --session-id <id> --test-result-id <id>
```

Ties a pending test result to the session that is running it. The result already names its definition. An unknown session, or a result that is missing or not pending, is a failure.

- `--session-id <id>` — the id printed by `./client start`.
- `--test-result-id <id>` — the result UUID from the Linear issue.

```bash
./ctrl test start --server-url https://qemu.example.com --session-id 6f1c...e2a9 --test-result-id 2222...2222
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
./ctrl session list --server-url <url> [--count <n>]
```

Prints the most recent sessions, newest first, one per line: the status, colored (green `succeeded`, red `failed`, yellow `running`, gray `downloading`, bright red `aborted`, magenta `timed_out`); how long ago it started (`45s ago`, `12m ago`, `1h30m ago`, `3d5h ago`); then the session id. Not used while driving a guest.

- `--count <n>` — how many sessions to print, at least 1. Default 10.

```bash
./ctrl session list --server-url https://qemu.example.com --count 25
```

## session

```
./ctrl session --server-url <url> --session-id <id> --logs|--test-def|--test-results|--actions|--all
```

Prints what is stored for one session, as JSON. At least one selector is required; one selector prints that value, several print an object keyed by them. An unknown session is a failure. Not used while driving a guest.

- `--session-id <id>` — the session.
- `--logs` — its log lines, oldest first.
- `--test-def` — the test definition its result ran, or `null`.
- `--test-results` — the test result attributed to it, or `null`.
- `--actions` — its QMP actions, oldest first.
- `--all` — all four: `{ logs, results, test_definition, actions }`.

```bash
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --all
```
