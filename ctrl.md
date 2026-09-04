# Control

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 18 |
| [Environment](#environment) | 24 |
| [Invoke](#invoke) | 28 |
| [test](#test) | 38 |
| [test new](#test-new) | 51 |
| [test list](#test-list) | 62 |
| [test run](#test-run) | 72 |
| [test start](#test-start) | 82 |
| [test-results](#test-results) | 92 |
| [session](#session) | 103 |

## Important

`./ctrl` is the control plane's record keeper: it creates test runs, opens their Linear tickets, spawns driving agents, ties a session to its result, closes the result, and reads a session back. It never touches a guest — that is `./client`.

If you are an agent driving a guest, you need two of these: [test start](#test-start) after `./client start`, and [test-results](#test-results) before `./client stop`. Do not look at code. Run the commands.

## Environment

`DATABASE_URL` is read by every action; a missing one exits 1. `test new` and `test list` also read `LINEAR_API_TOKEN`. `test run` also reads `CURSOR_API_TOKEN`. A `.env` in the current directory fills in missing variables only; already-set values win.

## Invoke

The action comes first. Every action takes `--server-url <url>`, the oligarchy server as a full http or https URL; it may sit anywhere after the action. When omitted, `SERVER_URL` from the environment is used. There is no default: an action with neither fails.

```bash
./ctrl <action> --server-url <url> ...
```

A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## test

Lists stored test definitions. `--list` is required. Not used while driving a guest.

```bash
./ctrl test --list
./ctrl test --list --details
./ctrl test --list --name lock-screen
./ctrl test --list --details --name lock-screen
```

`--list` prints one name per line. `--details` prints every field as JSON. `--name` limits the listing to one definition. A missing `--list` is a failure. A name that matches no definition is a failure.

## test new

Creates one pending test run and one Linear issue per stored test definition. Pass `--name` to create a run for one existing definition instead of every definition. Not used while driving a guest. Reads `LINEAR_API_TOKEN`.

```bash
./ctrl test new --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --version 1.2.3
./ctrl test new --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --version 1.2.3 --name "Install Omarchy"
```

`--iso` must be an HTTPS URL. `--server-url` (or `SERVER_URL`) is stored on the run and written into every Linear issue as the proxy the driving agent talks to. `--version` is required. `--name` is the stored definition's name. A name that matches no definition is a failure. The command prints the run and its Linear issues as JSON.

## test list

Prints every Linear issue on the Oligarchy team whose status type is backlog. Not used while driving a guest. Reads `LINEAR_API_TOKEN`.

```bash
./ctrl test list --server-url https://qemu.example.com
```

Each issue is printed as JSON: `id`, `identifier`, `title`, and `url`. An empty backlog prints `[]`.

## test run

Spawns a Cursor cloud agent that drives one Linear ticket. Not used while driving a guest. Reads `CURSOR_API_TOKEN`.

```bash
./ctrl test run --server-url https://qemu.example.com --ticket OLI-42
```

`--ticket` is the Linear issue identifier created by `test new`. The agent is told to pass `--server-url` on every `./client` and `./ctrl` command. The command prints a link to the agent as soon as it is started and does not wait for it to finish.

## test start

Ties a pending test result to the session that is running it. The result already names its definition; pass the result id and the session id only.

```bash
./ctrl test start --server-url <url> --session-id <id> --test-result-id <result-id>
```

`--session-id` is the id printed by `./client start`. `--test-result-id` is the result UUID from the Linear issue. An unknown session, or a result that is missing or not pending, is a failure.

## test-results

Closes one pending test result. `--agent-id` is required: that agent's session is looked up and recorded on the result.

```bash
./ctrl test-results --agent-id <agent> --server-url <url> --id <result-id> --status success
./ctrl test-results --agent-id <agent> --server-url <url> --id <result-id> --status failed --reason "installer hung"
```

`--id` is the result UUID from the Linear issue. `--status` is `success` or `failed`. `--reason` is optional text stored on the result row.

## session

Prints stored logs, the test definition, the test result, and actions for a session. Not used while driving a guest.

```bash
./ctrl session --server-url <url> --session-id <id> --logs
./ctrl session --server-url <url> --session-id <id> --test-def
./ctrl session --server-url <url> --session-id <id> --test-results
./ctrl session --server-url <url> --session-id <id> --actions
./ctrl session --server-url <url> --session-id <id> --all
```

`--session-id` is required. At least one of `--logs`, `--test-def`, `--test-results`, `--actions`, or `--all` is required. A single selector prints that value as JSON. `--all` prints `{ logs, results, test_definition, actions }`. An unknown session is a failure.
