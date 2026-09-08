# Control

`./ctrl` records the outcome of the test you are driving. You use exactly two of its commands: `test start` right after `./client start`, and `test-results` right before `./client stop`. Do not look at code. Run the commands.

```
./ctrl test start   --session-id <id> --test-result-id <id> --model <id>
./ctrl test-results --agent-id <agent> --id <id> --status success|failed [--reason <text>]
```

Every value is a flag. `./ctrl` writes to the database, not to the proxy: it takes no `--server-url`; that flag is `./client`'s. `DATABASE_URL` is already in this process; do not write a `.env`. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## test start

```
./ctrl test start --session-id <id> --test-result-id <id> --model <id>
```

Ties your pending test result to the session you just booted and records the Cursor model that is running it. Run it once, before your first intent. An unknown session, or a result that is missing or not pending, is a failure.

- `--session-id <id>` — the id printed by `./client start`.
- `--test-result-id <id>` — the result UUID from your Linear ticket.
- `--model <id>` — the Cursor model id that is running this result.

```bash
./ctrl test start --session-id 6f1c...e2a9 --test-result-id 2222...2222 --model <the Cursor model id you are running as>
```

## test-results

```
./ctrl test-results --agent-id <agent> --id <id> --status success|failed [--reason <text>]
```

Closes your test result with the verdict. Run it once, after the proof is on screen and before `./client stop`.

- `--agent-id <agent>` — your agent id, the same one you pass to `./client`.
- `--id <id>` — the result UUID from your Linear ticket.
- `--status <status>` — `success` or `failed`.
- `--reason <text>` — optional text stored on the result.

```bash
./ctrl test-results --agent-id OLI-42 --id 2222...2222 --status failed --reason "installer hung"
```
