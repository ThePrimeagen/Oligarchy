# Control

`./ctrl` reads a finished session back and records what you found. You use four of its commands: `session` to read the evidence, `error-type list` and `error-type new` to name a cause, and `diagnose` to record your verdict. Do not look at code. Run the commands.

```
./ctrl session         --server-url <url> --session-id <id> --all
./ctrl session         --server-url <url> --session-id <id> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis
./ctrl error-type list --server-url <url> [--json]
./ctrl error-type new  --server-url <url> --key <key> --description <text>
./ctrl diagnose        --server-url <url> --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
```

Every value is a flag. `--server-url` is the proxy the session ran on; it falls back to `SERVER_URL` from the environment and has no default. `DATABASE_URL` is already in this process; do not write a `.env`. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## session

```
./ctrl session --server-url <url> --session-id <id> --all
```

Prints everything stored for the session as one JSON object, keyed `session`, `logs`, `results`, `test_definition`, `test_run`, `actions`, `images`, `debug_log`, `diagnosis`. Run it first; every other command follows from what it says. One selector prints that value bare; several print an object keyed by them.

- `--status` — the session row. `status` and `reason` are the driver's verdict: `succeeded`, `failed`, `aborted`, or `timed_out` when nobody stopped it for ten minutes. `config.iso` is what it booted; `startedAt` and `endedAt` when.
- `--test-results` — the test result the driver closed, or `null`: `status` (`passed` or `failed`), `reason`, `model` (the Cursor model that drove it).
- `--test-def` — the mission: `name`, `description`, `instruction`, and `proof`, what had to be on screen for a pass. Judge against the proof.
- `--test-run` — the run the result belongs to, or `null`: `iso`, `serverUrl`, `status`.
- `--logs` — the proxy's log lines, oldest first: `starting`, `intent start; <message>` before every group of actions, `image; ... ; <url>` for every screenshot, `stopped; <status>; <reason>` at the end.
- `--actions` — every QMP exchange, oldest first: the keys and mouse events sent, and QEMU's reply.
- `--images` — every screenshot, oldest first, as `{ id, actionId, url, createdAt }`. The last one is what the driver saw when it delivered its verdict. Fetch one with `./session image --image-id <id> -o <file>` — straight from the database, no proxy or token involved — and look at it.
- `--debug-logs` — saved when the session ended any way but `succeeded`, else `null`: `sources.serial` is the guest's console, `sources.qemu` QEMU's stderr, `sources.proxy` and `sources.actions` the lines above as text.
- `--diagnosis` — a diagnosis already recorded, or `null`. If it is not `null`, stop: the session has been reviewed.

```bash
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --all > session.json
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --images
./session image --image-id 9b2f...2c3d -o last.png
```

## error-type list

```
./ctrl error-type list --server-url <url> [--json]
```

Prints every error type, one per line: the key, then what a failure of that type looks like. A `failed` verdict names one of these. Read the list before naming a cause and pick the type whose description fits, so the next reader picks the same key for the same cause.

## error-type new

```
./ctrl error-type new --server-url <url> --key <key> --description <text>
```

Adds a type when none fits. `--key` is snake_case (`guest_boot_hang`); `--description` says what a failure of this type looks like. A key that already exists is a failure: use it. There is no `other` or `unclassified`: name the cause.

```bash
./ctrl error-type new --server-url https://qemu.example.com --key guest_boot_hang --description "The guest never reached the login screen; the serial console stops during boot"
```

## diagnose

```
./ctrl diagnose --server-url <url> --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
```

Records your verdict on the session. Run it once, after reading the evidence. A second diagnosis is a failure and the first stands.

- `--verdict passed` — the proof is on screen in the images. Takes no `--type`.
- `--verdict failed` — it is not, or the session never got there. `--type` names the cause with an error type key.
- `--summary <text>` — what happened, in your words, from the evidence: which image, which log line, which serial line. When your verdict disagrees with the driver's, say so and why.
- `--model <id>` — the Cursor model id you are running as.

```bash
./ctrl diagnose --server-url https://qemu.example.com --session-id 6f1c...e2a9 --verdict failed --type guest_boot_hang --summary "Serial stops after 'Waiting for root device'; the last image is still the boot menu" --model <the Cursor model id you are running as>
./ctrl diagnose --server-url https://qemu.example.com --session-id 6f1c...e2a9 --verdict passed --summary "The last image shows the lock screen with the clock; matches the proof" --model <the Cursor model id you are running as>
```
