# Control

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 15 |
| [Synopsis](#synopsis) | 19 |
| [session](#session) | 30 |
| [error-type list](#error-type-list) | 53 |
| [error-type new](#error-type-new) | 67 |
| [diagnose](#diagnose) | 82 |
| [The loop](#the-loop) | 99 |

## Important

`./ctrl` names the cause of a session that ended any way but `succeeded`. You use these commands: `session` to read the evidence, `error-type list` to see the vocabulary, `error-type new` when no type fits, and `diagnose` to write the cause. Do not look at code. Do not drive the guest. Run the commands.

## Synopsis

```
./ctrl session         --server-url <url> --session-id <id> --logs|--test-def|--test-results|--actions|--debug-logs|--diagnosis|--all|--dump
./ctrl error-type list --server-url <url> [--json]
./ctrl error-type new  --server-url <url> --key <key> --description <text>
./ctrl diagnose        --server-url <url> --session-id <id> --type <key> --summary <text> --model <id>
```

Every value is a flag. `--server-url` is the oligarchy server, a full http or https URL; it falls back to `SERVER_URL` from the environment and has no default. `DATABASE_URL` is already in this process; do not write a `.env`. `session --dump` also reads `OLIGARCHY_TOKEN`, already set — the other `session` selectors never need it. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./ctrl <action> --help` prints that action's flags.

## session

```
./ctrl session --server-url <url> --session-id <id> --logs|--test-def|--test-results|--actions|--debug-logs|--diagnosis|--all|--dump
```

Prints what is stored for one session, as JSON. At least one selector is required; one selector prints that value, several print an object keyed by them. An unknown session is a failure.

- `--session-id <id>` — the session. Your Linear ticket names it.
- `--logs` — its log lines, oldest first. A completed screenshot is `image; <n> bytes in <ms>ms; <url>`.
- `--test-def` — the test definition its result ran, or `null`. The mission: name, description, instruction, proof.
- `--test-results` — the test result attributed to it, or `null`. The driver's verdict and reason.
- `--actions` — its QMP actions, oldest first. Screenshots are not in this list.
- `--debug-logs` — the debug log the proxy saved when the session ended any way but `succeeded` (a `failed` or `aborted` stop, the ten-minute timeout, a proxy shutdown), or `null`. `{ sessionId, sources: { serial, proxy, qemu, actions }, createdAt }`: `serial` is everything the guest wrote to `/dev/ttyS0`, `proxy` the session's log lines as `created_at level text`, `qemu` the last 4 KiB of QEMU's stderr, `actions` the QMP exchanges as `created_at id state request[ response]`. Each is capped at 1 MiB, keeping the end.
- `--diagnosis` — the post-run diagnosis, or `null` when nobody has diagnosed the session. `{ sessionId, errorType, summary, model, createdAt }`. If this is not `null`, you are done.
- `--all` — all six: `{ logs, results, test_definition, actions, debug_log, diagnosis }`.
- `--dump` — the session's serial console, printed raw, not as JSON. Does not combine with the other selectors; redirect stdout to keep it (`> console.txt`).

```bash
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --all
./ctrl session --server-url https://qemu.example.com --session-id 6f1c...e2a9 --dump > console.txt
```

## error-type list

```
./ctrl error-type list --server-url <url> [--json]
```

Prints every error type, ordered by key, one per line: the key, two spaces, the description, keys padded so the descriptions line up. An empty table prints nothing.

- `--json` — print the rows as a JSON array of `{ key, description, createdAt }` instead; an empty table prints `[]`.

```bash
./ctrl error-type list --server-url https://qemu.example.com
```

## error-type new

```
./ctrl error-type new --server-url <url> --key <key> --description <text>
```

Adds one error type to the vocabulary diagnoses are written in. The table starts empty and grows one type per distinct cause, the first time that cause is seen; there is no `other` or `unclassified`. A key that already exists is a failure: `error-type new: <key> already exists`.

- `--key <key>` — the identifier a diagnosis carries: snake_case, `a-z`, `0-9` and `_`, starting with a letter (`guest_boot_hang`). Anything else is refused before the database is touched.
- `--description <text>` — what a failure of this type looks like, so the next reader picks the same key for the same cause.

```bash
./ctrl error-type new --server-url https://qemu.example.com --key guest_boot_hang --description "The guest never reached the login screen; the serial console stops during boot"
```

## diagnose

```
./ctrl diagnose --server-url <url> --session-id <id> --type <key> --summary <text> --model <id>
```

Records the cause of one session that ended any way but `succeeded`: a `failed` or `aborted` stop, or the ten-minute timeout. Read the evidence first, then name the cause with a type from [error-type list](#error-type-list); when no type fits, create one with [error-type new](#error-type-new) and diagnose with it. One diagnosis per session: a second is a failure and the first stands.

- `--session-id <id>` — the session. Unknown, still running or downloading, or `succeeded` is a failure (`diagnose: session <id> succeeded; nothing to diagnose`).
- `--type <key>` — an existing error type key. A key that is not in the table is a failure: `diagnose: no error type <key>; create it with ./ctrl error-type new`.
- `--summary <text>` — what happened, in the reader's words, from the evidence.
- `--model <id>` — the Cursor model id that is writing this diagnosis.

```bash
./ctrl diagnose --server-url https://qemu.example.com --session-id 6f1c...e2a9 --type guest_boot_hang --summary "Serial stops after 'Waiting for root device'; the ISO never mounted" --model <the Cursor model id you are running as>
```

## The loop

Read the evidence, name the cause, write it once. That is the whole method. Never look at code. Never send keys or mouse; the guest is gone.

Start with `--all`. If `diagnosis` is not `null`, stop: the first diagnosis stands. Open every `https://oligarchy.trm.sh/images/<uuid>` URL in the proxy log (`logs`, or `debug_log.sources.proxy`): those are the screenshots, in the order they were taken, and they need no token. Read `debug_log.sources.serial` for the UART; `--dump` is the same console if the debug log is missing. `test_definition` is the mission; `results` is the driver's verdict.

Then `error-type list`. Pick the type that names this cause. When none does, `error-type new` and diagnose with that key. There is no `other` or `unclassified`: a failure you cannot name is not diagnosed yet.

`diagnose` once. You are done when the command prints `diagnosed; <key>; <model>`.
