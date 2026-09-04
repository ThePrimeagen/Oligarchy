# Control

`./ctrl` records the outcome of the test you are driving. You use exactly two of its commands: `test start` right after `./client start`, and `test-results` right before `./client stop`. Do not look at code. Run the commands.

## Environment

`DATABASE_URL` is already in this process. Use it. Do not write a `.env`. A missing `DATABASE_URL` exits 1 — stop.

## Invoke

The action comes first. Every action takes `--server-url <url>`, the same server URL you pass to `./client`; it may sit anywhere after the action. When omitted, `SERVER_URL` from the environment is used. There is no default.

A command that works exits 0. A command that fails exits 1 and prints the error. `./ctrl <action> --help` prints that action's flags.

## test start

Ties your pending test result to the session you just booted. Run it once, before your first intent.

```bash
./ctrl test start --server-url <url> --session-id <id> --test-result-id <result-id>
```

`--session-id` is the id printed by `./client start`. `--test-result-id` is the result UUID from your Linear ticket. An unknown session, or a result that is missing or not pending, is a failure.

## test-results

Closes your test result with the verdict. Run it once, after the proof is on screen and before `./client stop`.

```bash
./ctrl test-results --agent-id <agent> --server-url <url> --id <result-id> --status success
./ctrl test-results --agent-id <agent> --server-url <url> --id <result-id> --status failed --reason "installer hung"
```

`--agent-id` is your agent id, the same one you pass to `./client`. `--id` is the result UUID from your Linear ticket. `--status` is `success` or `failed`. `--reason` is optional text stored on the result.
