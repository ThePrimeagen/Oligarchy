# The CLI (`src/qemu/cli.ts`)

The TypeScript client for the oligarchy control plane. It sends HTTP requests to a running proxy (`src/qemu/proxy.ts`) and prints the result. It is a main file, not a library: running it executes the Effect command tree, and it exports nothing. Every invocation is parsed by `effect/unstable/cli` (`Command`, `Flag`, `Argument`).

```bash
./client experiment new --iso <https-url> --server_url=<http-or-https-url> --version <version>
./client --agent-id <agent> start [--iso <path>] [--disk <path>]
./client --agent-id <agent> get-image <id> [-o file]
./client --agent-id <agent> get-serial <id> [-o file]
./client --agent-id <agent> send-keys <id> <keys> [encoding]
./client --agent-id <agent> send-mouse <id> <x> <y> [button [clicks]]
./client --agent-id <agent> stop <id> [status [reason]]
```

The server address comes from `OLIGARCHY_ADDR`, default `127.0.0.1:42069`.

`--agent-id <agent>` is a shared flag on the root command, required for every QEMU command and unused by `experiment`. It may sit before or after the subcommand name. This client is used by agents, not humans — the inconvenience of typing it is deliberate. An invocation without it is a missing-option error.

## experiment new

Creates one pending test run (ISO URL and server URL stored on the run) and one pending result for every stored test definition, then opens one Linear issue per definition. Each issue carries that definition's details plus the result UUID, the run UUID, the ISO URL, and the server URL, and is labeled `agent test` plus the required `--version` value. Missing labels are created on the Linear team. The command reads `DATABASE_URL` and `LINEAR_API_TOKEN` from the environment (a `.env` fills in missing variables only), uses the first Linear team available to that API token, writes the creation line through the database logger, and prints the run and Linear issues as JSON.

The ISO must be an HTTPS URL. The server may be an HTTP or HTTPS URL. `--version` is required and must be non-empty. Effect accepts both `--flag=<value>` and `--flag <value>`.

Run the root wrapper directly:

```bash
./client experiment new --iso https://example.com/omarchy.iso --server_url=https://qemu.example.com --version 1.2.3
```

## start

Boots a QEMU session and prints its session id (a UUID). Every other command takes that id.

- Flags are `--iso <path>` and `--disk <path>`, either order. `--iso` defaults to `omarchy.iso` in the current directory, a debug convenience; the server has no default of its own and refuses a start that omits `iso`. A path is resolved to absolute and must exist; the CLI fails fast with the real path in the error instead of making the server discover it. An http(s) url is passed through untouched — downloading and caching it is the server's job (see [http-api.md](http-api.md)).
- `--disk` is optional. When given it is resolved to an absolute path. When not given, the `disk` key is omitted from the JSON entirely, not sent as `""`: the proxy creates the default disk only when the key is absent — an empty string would be taken as a real path. `JSON.stringify` dropping `undefined` properties is what makes the omission work.
- Wire call: `POST /start` with `{"iso": "...", "disk"?: "...", "agent": "..."}` → `{"id": "<uuid>"}`.

## get-image

Captures the session's current display as a PNG.

- `--output` / `-o` is optional and may sit before or after the session id.
- With `-o`, the PNG is written to the file (mode 0644); without it, raw PNG bytes go to stdout, so redirect: `... get-image <id> > shot.png`.
- Wire call: `GET /image?id=<id>&agent=<agent>` → `image/png` bytes.

## get-serial

Reads the guest's serial console as text. The guest writes here when something prints to `/dev/ttyS0` — that is how journalctl and crash logs leave a machine whose desktop shell is dead.

- `--output` / `-o` is optional and may sit before or after the session id.
- With `-o`, the bytes are written to the file (mode 0644); without it, they go to stdout.
- Wire call: `GET /serial?id=<id>&agent=<agent>` → `text/plain` bytes.

## send-keys

Types a key string into the session.

- `send-keys <id> <keys> [encoding]`; the encoding defaults to `oligarchy` and is passed through untouched — the server does the parsing. The encoding itself (literal characters, `<ENTER>`, `<C-c>`, ...) is documented in [how-to.md](how-to.md) and implemented server-side in `src/qemu/keys.ts`.
- Wire call: `POST /send-keys` with `{"id", "keys", "encoding", "agent"}` → `{"ok": "true"}`.

## send-mouse

Moves the pointer, and optionally clicks or scrolls, at a point on the screenshot.

- `send-mouse <id> <x> <y> [button [clicks]]`. `x` and `y` are fractions of the screenshot, `0..1` from the top-left; the CLI rejects anything else before calling the server. Omit `button` to move only. `button` is `left`, `middle`, `right`, `wheel-up`, or `wheel-down`; `clicks` defaults to 1 on the server and is a pulse count (a double-click is `left 2`, three wheel ticks is `wheel-down 3`).
- Wire call: `POST /send-mouse` with `{"id", "x", "y", "button"?, "clicks"?, "agent"}` → `{"ok": "true"}`.

## stop

Kills the session. Only the agent that started it can stop it; a different `--agent-id` is a 403.

- `stop <id> [status [reason]]`. `status` is `succeeded`, `failed`, or `aborted`. Omit both to abort: a machine killed with nothing to say for itself. `reason` is optional text stored on the session row.
- An undefined status or reason is left out of the JSON, so the server applies its own defaults (`aborted`, no reason).
- Wire call: `POST /stop` with `{"id", "agent", "status"?, "reason?"}` → `{"ok": "true"}`.

## Errors and exit codes

- Effect's runner exits `0` on success and `1` on a parse error or command failure. Failed requests print the server's `{"error": "..."}` message. A non-JSON error body is printed raw; an empty one prints `request failed`.
- Network failures print `fetch failed: <cause>` — the cause (e.g. `connect ECONNREFUSED ...`) is unwrapped on purpose, because `fetch failed` alone says nothing.
- Database failures do the same unwrap: Drizzle's message is the failed SQL, and the Postgres reason lives on `cause`. Command failures print that combined message and the stack.

## Reading the file

The root `client` command shares `--agent-id` with its subcommands. QEMU handlers yield the parent command and fail if the flag is missing. `experiment` is a sibling subcommand with its own `new` command. HTTP helpers stay local to the file: `postJSON`, `readAPIError`, and `errorMessage`. There is no other machinery — see the [philosophy](philosophy.md) for why it should stay that way.
