# The CLI (`src/qemu/cli.ts`)

The TypeScript client for the oligarchy control plane. It sends HTTP requests to a running proxy (`src/qemu/proxy.ts`) and prints the result. It is a main file, not a library: running it executes the Effect command tree, and it exports nothing. Every invocation is parsed by `effect/unstable/cli` (`Command`, `Flag`, `Argument`).

```bash
./client test --list [--details] [--name <definition>]
./client test new --iso <https-url> --server_url=<http-or-https-url> --version <version> [--name <definition>]
./client test list
./client test run --ticket <linear-ticket> --server_url=<http-or-https-url>
./client --agent-id <agent> test-results --id <result-id> --status success|failed [--reason <text>]
./client session --session-id <id> --logs|--test-def|--test-results|--actions|--all
./client --agent-id <agent> start [--iso <path>] [--disk <path>]
./client --agent-id <agent> get-image <id> [-o file]
./client --agent-id <agent> get-serial <id> [-o file]
./client --agent-id <agent> send-keys <id> <keys> [encoding]
./client --agent-id <agent> send-mouse <id> <x> <y> [button [clicks]]
./client --agent-id <agent> intent start --session_id <id> --test_result_id <id> --message <message>
./client --agent-id <agent> intent end --session_id <id>
./client --agent-id <agent> stop <id> [status [reason]]
```

The server comes from `--server-url`, a full URL used exactly as given (no scheme is ever added), default `http://127.0.0.1:42069`. It is a shared flag on the root command and may sit before or after the subcommand name. The CLI reads `OLIGARCHY_TOKEN` from the environment (a `.env` fills in missing variables only) and sends it as `Authorization: Bearer <token>` on every proxy request. A missing token is a startup failure.

`--agent-id <agent>` is a shared flag on the root command, required for every QEMU command, for `test-results`, and for `intent`, unused by `test` and `session`. It may sit before or after the subcommand name. This client is used by agents, not humans — the inconvenience of typing it is deliberate. An invocation without it is a missing-option error.

## test

Prints stored test definitions. `--list` is required; invoking `test` without it or a subcommand is a failure. Without `--details`, one name per line. `--details` prints every field as JSON (`id`, `name`, `description`, `instruction`, `proof`, `createdAt`). `--name` selects one definition by its unique name; an unknown name is a failure. The command reads `DATABASE_URL` from the environment (a `.env` fills in missing variables only) and does not call the proxy. Missing `DATABASE_URL` is a failure.

```bash
./client test --list
./client test --list --details
./client test --list --name lock-screen
./client test --list --details --name lock-screen
```

## test new

Creates one pending test run (ISO URL and server URL stored on the run) and one pending result for every stored test definition, then opens one Linear issue per definition. `--name` selects one existing definition by its unique name and creates that one result and issue instead. An unknown name is a failure. Each issue is created with its title and labels (`agent test` plus the required `--version` value; missing labels are created on the Linear team), then described in a second call, because the body names the issue's own identifier as the driver's `--agent-id` and Linear assigns that identifier on create. The body is `prompts/linear-issue.html` with its `{{VARIABLES}}` filled: `LINEAR_TICKET`, `RUN_ID`, `RESULT_ID`, `VERSION`, `ISO_URL`, `SERVER_URL`, the definition's `TEST_NAME`, `TEST_DESCRIPTION`, `TEST_INSTRUCTION`, and `TEST_PROOF`, `CLIENT_MD`, the contents of `client.md`, and `SUB_AGENT`, the reviewer model. A variable in the template with no value is an error. The command reads `DATABASE_URL` and `LINEAR_API_TOKEN` from the environment (a `.env` fills in missing variables only), uses the first Linear team available to that API token, writes the creation line through the database logger, and prints the run and Linear issues as JSON.

The ISO must be an HTTPS URL. The server may be an HTTP or HTTPS URL. `--version` is required and must be non-empty. `--name` is optional. Effect accepts both `--flag=<value>` and `--flag <value>`.

Run the root wrapper directly:

```bash
./client test new --iso https://example.com/omarchy.iso --server_url=https://qemu.example.com --version 1.2.3
./client test new --iso https://example.com/omarchy.iso --server_url=https://qemu.example.com --version 1.2.3 --name "Install Omarchy"
```

## test list

Prints every Linear issue on the Oligarchy team whose workflow state type is `backlog`. The command reads `LINEAR_API_TOKEN` from the environment (a `.env` fills in missing variables only). It does not use the database. It walks Linear's issue pages until `hasNextPage` is false, then prints a JSON array of `{id, identifier, title, url}`. An empty backlog is `[]`. A missing token or a Linear failure is a command failure.

```bash
./client test list
```

## test run

Spawns the Cursor cloud agent that drives one Linear ticket. The command renders `prompts/driving-agent.html` with `LINEAR_TICKET` and `SERVER_URL` and hands the text to `prompt` in `src/cursor-agent/client.ts`, the one function that wraps `@cursor/sdk`: it creates a cloud agent on this repository, sends the text as the agent's first run, and returns once Cursor has accepted the run. It never waits for the agent. On success it prints `Agent here, go check it out for more information: https://cursor.com/agents/<agent-id>`.

The agent runs Grok 4.6 in fast mode at extra-high effort (`{ id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "true" }] }`, as `Cursor.models.list()` names it); `prompt` takes an optional `{ model }` to choose another. The API key is `CURSOR_API_TOKEN`, read from the environment (a `.env` fills in missing variables only); a missing one is a failure, and so is a token Cursor refuses or a model it does not offer. Cloud agents started through the SDK are hidden from the default list at cursor.com/agents; filter by Source > SDK to see them.

`--ticket` must be non-empty. `--server_url` may be HTTP or HTTPS; the prompt tells the driver to pass it as `--server-url` on every `./client` command.

```bash
./client test run --ticket OLI-42 --server_url https://qemu.example.com
```

## test-results

Closes one pending test result. The command writes the database itself — it does not call the proxy. `--id` is the result UUID printed on the Linear issue. `--status` is `success` or `failed` (`success` is stored as `passed`). `--reason` is optional text stored on the result row. `--agent-id` is required: the command looks up that agent's session in `agent_runs` and records it on the result.

Missing `DATABASE_URL` is a failure. An unknown result id is a failure.

```bash
./client --agent-id <agent> test-results --id 22222222-2222-4222-8222-222222222222 --status success
./client --agent-id <agent> test-results --id 22222222-2222-4222-8222-222222222222 --status failed --reason "installer hung"
```

## session

Prints stored logs, the test definition, the test result, and the actions for one session. The command reads the database itself — it does not call the proxy. `--session-id` is the session UUID. At least one selector is required: `--logs`, `--test-def`, `--test-results`, `--actions`, or `--all`.

`--logs` and `--actions` print that table's rows as JSON, oldest first (`created_at`, then `id`). `--test-results` prints the result row attributed to the session, or `null`. `--test-def` prints the definition that result ran, or `null`. `--all` prints `{ logs, results, test_definition, actions }`. Combining selectors prints an object with those keys.

Missing `DATABASE_URL` is a failure. An unknown session id is a failure.

```bash
./client session --session-id 11111111-1111-4111-8111-111111111111 --logs
./client session --session-id 11111111-1111-4111-8111-111111111111 --test-def
./client session --session-id 11111111-1111-4111-8111-111111111111 --test-results
./client session --session-id 11111111-1111-4111-8111-111111111111 --actions
./client session --session-id 11111111-1111-4111-8111-111111111111 --all
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

## intent start / intent end

Records the agent's current intent on the session. One intent is active at a time; it is not stacked. Start before the work that fulfills the intent, then end when that work is done. Every value is a flag; the only positionals are the verbs. Quote `--message` so the shell keeps spaces.

- `intent start --session_id <id> --test_result_id <id> --message <message>`. Wire call: `POST /intent/start` with `{"id", "agent", "test_result_id", "message"}` → `{"ok": "true"}`.
- `intent end --session_id <id>`. Ends the session's one active intent. Wire call: `POST /intent/end` with `{"id", "agent"}` → `{"ok": "true"}`.

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

The file reads `OLIGARCHY_TOKEN` at startup and fails if it is missing. The root `client` command shares `--agent-id` and `--server-url` with its subcommands. QEMU handlers, `test-results`, and `intent` yield the parent command and fail if `--agent-id` is missing. `test` is a sibling subcommand: `--list` / `--details` / `--name` print stored definitions through `src/test-def.ts`; `new`, `list`, and `run` live as its subcommands. `test-results` is a sibling that writes the result row through `src/test-results.ts`. `session` is a sibling that reads logs, the test definition, the result, and actions through `src/session-info.ts`. HTTP helpers stay local to the file: `postJSON`, `readAPIError`, and `errorMessage`. There is no other machinery — see the [philosophy](philosophy.md) for why it should stay that way.
