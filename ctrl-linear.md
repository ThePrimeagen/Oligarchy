# Control

`./ctrl` records the outcome of the test you are driving. You use exactly two of its commands: `test start` right after `./client start`, and `test-results` right before `./client stop`. Do not look at code. Run the commands.

```
./ctrl test start   --server-url <url> --session-id <id> --test-result-id <id>
./ctrl test-results --agent-id <agent> --server-url <url> --id <id> --status success|failed [--reason <text>]
```

Every value is a flag. `--server-url` is the same URL you pass to `./client`; it falls back to `SERVER_URL` from the environment and has no default. `DATABASE_URL` is already in this process; do not write a `.env`. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## test start

```
./ctrl test start --server-url <url> --session-id <id> --test-result-id <id>
```

Ties your pending test result to the session you just booted. Run it once, before your first intent. An unknown session, or a result that is missing or not pending, is a failure.

- `--session-id <id>` — the id printed by `./client start`.
- `--test-result-id <id>` — the result UUID from your Linear ticket.

```bash
./ctrl test start --server-url https://qemu.example.com --session-id 6f1c...e2a9 --test-result-id 2222...2222
```

## test-results

```
./ctrl test-results --agent-id <agent> --server-url <url> --id <id> --status success|failed [--reason <text>]
```

Closes your test result with the verdict. Run it once, after the proof is on screen and before `./client stop`.

- `--agent-id <agent>` — your agent id, the same one you pass to `./client`.
- `--id <id>` — the result UUID from your Linear ticket.
- `--status <status>` — `success` or `failed`.
- `--reason <text>` — optional text stored on the result.

```bash
./ctrl test-results --agent-id OLI-42 --server-url https://qemu.example.com --id 2222...2222 --status failed --reason "installer hung"
```
