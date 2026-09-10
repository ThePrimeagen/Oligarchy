# Control

Your goal is one post-run diagnosis for the session you were given: a verdict on whether the test's proof landed and, when it did not, the cause — named with an existing error type when one matches, or with a new one you mint, which should be rare. `./ctrl` reads the session back and records that diagnosis; `./session image` shows you its screenshots. Do not look at code. Run the commands.

```
./ctrl session         --session-id <id> --all
./ctrl session         --session-id <id> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis
./session image        --image-id <id> -o <file>
./ctrl error-type list [--json]
./ctrl error-type new  --key <key> --description <text>
./ctrl diagnose        --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
```

Every value is a flag. Everything is read from and written to the database: no proxy, no token, no server url. `DATABASE_URL` is already in this process; do not write a `.env`. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## session

```
./ctrl session --session-id <id> --all
```

Prints everything stored for the session as one JSON object, keyed `session`, `logs`, `results`, `test_definition`, `test_run`, `actions`, `images`, `debug_log`, `diagnosis`. Run it first; every other command follows from what it says. One selector prints that value bare; several print an object keyed by them.

- `--status` — the session row. `status` and `reason` are the driver's verdict: `succeeded`, `failed`, `aborted`, or `timed_out` when nobody stopped it for ten minutes. `config.iso` is what it booted; `startedAt` and `endedAt` when.
- `--test-results` — the test result the driver closed, or `null`: `status` (`passed` or `failed`), `reason`, `model` (the Cursor model that drove it).
- `--test-def` — the mission: `name`, `description`, `instruction`, and `proof`, what had to be on screen for a pass. Judge against the proof.
- `--test-run` — the run the result belongs to, or `null`: `iso`, `serverUrl`, `status`.
- `--logs` — the qemu server's log lines, oldest first: `starting`, `intent start; <message>` before every group of actions, `image; ... ; <url>` for every screenshot, `stopped; <status>; <reason>` at the end.
- `--actions` — every QMP exchange, oldest first: the keys and mouse events sent, and QEMU's reply.
- `--images` — every screenshot, oldest first, as `{ id, actionId, url, createdAt }`. The last one is what the driver saw when it delivered its verdict. Look at it with [session image](#session-image), and at any image around a step you suspect.
- `--debug-logs` — saved when the session ended any way but `succeeded`, else `null`: `sources.serial` is the guest's console, `sources.qemu` QEMU's stderr, `sources.proxy` and `sources.actions` the lines above as text.
- `--diagnosis` — a diagnosis already recorded, or `null`. If it is not `null`, stop: the session has been reviewed.

```bash
./ctrl session --session-id 6f1c...e2a9 --all > session.json
./ctrl session --session-id 6f1c...e2a9 --images
```

## session image

```
./session image --image-id <id> -o <file>
```

Writes one screenshot as a PNG, straight from the database — no proxy, no token, only `DATABASE_URL`. `--image-id` is the `id` from `--images`. Always look at the final image before any verdict: a `passed` verdict means the proof is on it. When a log line, an action, or the serial console makes you suspect a step — a chord that changed nothing, a stall, a screen the driver described wrongly — fetch the images around that step too and look at them; they decide the cause of a `failed` verdict. An id no image has is a failure.

```bash
./session image --image-id 9b2f...2c3d -o last.png
```

## error-type list

```
./ctrl error-type list [--json]
```

Prints every error type, one per line: the key, then what a failure of that type looks like. A `failed` verdict names one of these. Read the whole list before naming a cause and pick the type whose description matches the cause you can point to in the evidence — the same cause must land on the same key every time, whatever the session looked like.

## error-type new

```
./ctrl error-type new --key <key> --description <text>
```

Mints a new error type. This should be rare, and you must be very careful with it: mint only when you have read the whole list and no description matches the cause in your evidence — not because the wording differs, not because the symptom differs in detail, not because you are unsure. A type, once diagnoses carry it, stays; a near-duplicate splits one cause across two keys for every reader after you. `--key` is snake_case (`guest_boot_hang`); `--description` says what a failure of this type looks like, so the next reader picks it for the same cause. A key that already exists is a failure: use it. There is no `other` or `unclassified`: name the cause.

```bash
./ctrl error-type new --key guest_boot_hang --description "The guest never reached the login screen; the serial console stops during boot"
```

## diagnose

```
./ctrl diagnose --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
```

Records the post-run diagnosis: your verdict on the session. Run it once, after reading the evidence and looking at the images. A second diagnosis is a failure and the first stands.

- `--verdict passed` — the proof is on the final image. Takes no `--type`.
- `--verdict failed` — it is not, or the session never got there. `--type` names the cause with an error type key: a matching one from the list, or the one you minted when none matched.
- `--summary <text>` — what happened, in your words, from the evidence: which image, which log line, which serial line. When your verdict disagrees with the driver's, say so and why.
- `--model <id>` — the Cursor model id you are running as.

```bash
./ctrl diagnose --session-id 6f1c...e2a9 --verdict failed --type guest_boot_hang --summary "Serial stops after 'Waiting for root device'; the last image is still the boot menu" --model <the Cursor model id you are running as>
./ctrl diagnose --session-id 6f1c...e2a9 --verdict passed --summary "The last image shows the lock screen with the clock; matches the proof" --model <the Cursor model id you are running as>
```
