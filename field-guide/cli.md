# The CLIs (`src/client/`, `src/ctrl/`, `src/session/`)

Three TypeScript executables share one shape. `./client` (`src/client/index.ts`) drives a guest: it sends HTTP requests to a running proxy (`src/qemu/proxy.ts`) and prints the result. `./ctrl` (`src/ctrl/index.ts`) keeps the record: it writes and reads the database, opens Linear issues, and spawns driving agents. `./session` (`src/session/index.ts`) is the one for a human at a keyboard: a running program that drives one guest interactively by spawning `./client` for each command and showing the display inline (see [The session REPL](#the-session-repl)). None is a library. Each `index.ts` is a `switch` — over the first argument for `client` and `ctrl`, over each typed line for `session` — and each case awaits one `<action>Run(...)` from its own file under `actions/`; there is no barrel file. Every `client` and `ctrl` action parses its arguments on its first line with `effect/unstable/cli` (`Command`, `Flag`), and only then does its work with plain `async`/`await`; `session` parses its one flag the same way and then reads typed lines. Every command-line value is a flag; no executable has a positional argument.

```bash
./client start --agent-id <agent> --server-url <url> [--iso <path>] [--disk <path>]
./client get-image --agent-id <agent> --server-url <url> --session-id <id> [-o file]
./client get-serial --agent-id <agent> --server-url <url> --session-id <id> [-o file]
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys <keys> [--encoding <encoding>]
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button <button>] [--clicks <n>]
./client intent start --agent-id <agent> --server-url <url> --session-id <id> --test-result-id <id> --message <message>
./client intent end --agent-id <agent> --server-url <url> --session-id <id>
./client stop --agent-id <agent> --server-url <url> --session-id <id> [--status <status>] [--reason <text>]
./client follow --agent-id <agent> --server-url <url> --session-id <id>

./ctrl test --list [--details] [--name <definition>] --server-url <url>
./ctrl test new --iso <https-url> --version <version> [--name <definition>] --server-url <url>
./ctrl test list --server-url <url>
./ctrl test run --ticket <linear-ticket> --server-url <url>
./ctrl test start --session-id <id> --test-result-id <result-id> --server-url <url>
./ctrl test-results --agent-id <agent> --id <result-id> --status success|failed [--reason <text>] --server-url <url>
./ctrl session list [--count <n>] --server-url <url>
./ctrl session --session-id <id> --logs|--test-def|--test-results|--actions|--all --server-url <url>

./session [--server-url <url>]
```

The action is always the first argument; flags follow in any order, and Effect accepts both `--flag <value>` and `--flag=<value>`. Every flag is kebab-case. `./client --help` and `./ctrl --help` print the action list; `<action> --help` prints that action's flags, rendered by Effect.

## Parsing: `parseClientArgs` and `parseCtrlArgs`

Each executable has one parser, `src/client/parse-args.ts` and `src/ctrl/parse-args.ts`, and every action calls it first. The parser is generic over the action's flag config: the action declares its flags with `Flag`, derives its arg type from that declaration (`ClientArgs<typeof flags>`, `CtrlArgs<typeof spec>`), and gets back one object holding the parsed flags and the environment together. Under the hood the parser builds a `Command` from the shared flags plus the action's, runs it with `Command.runWith` so Effect does the parsing, help, and error rendering, then reads the environment through Effect's `Config`. `--help` and `--version` render and exit 0 before anything else happens. A parse failure is rendered by Effect (the action's usage plus the error) and exits 1. A `.env` in the working directory fills in missing variables only.

The client's shared surface, added to every action: `--agent-id` (required, non-empty), `--server-url` (a full URL used exactly as given; falls back to `SERVER_URL`, then `http://127.0.0.1:42069`), and `OLIGARCHY_TOKEN` from the environment, sent as `Authorization: Bearer <token>` on every request. A missing token is `OLIGARCHY_TOKEN is not set`.

The ctrl's shared surface: `--server-url` (falls back to `SERVER_URL`; must be http or https; no default, because the URL ends up in Linear tickets and agent prompts where `localhost` is never right) and `DATABASE_URL` from the environment. An action's spec names the further variables it needs — `LINEAR_API_TOKEN` for `test new` and `test list`, `CURSOR_API_TOKEN` for `test run` — and the parser reads them the same way, so a missing one is `LINEAR_API_TOKEN is not set` before any work starts. The parsed `databaseUrl` goes to `connectDatabase(url)`; the parsed token goes to `prompt(apiKey, text)`. Nothing below the parser reads `process.env`.

## Client actions

`src/client/actions/*.ts`, one file per action, each exporting `<action>Run`. HTTP stays in `src/client/http.ts`: `postJSON`, `getBytes`, `postStart`, and the `apiError` that turns a `{"error": ...}` body into the message.

### start

Boots a QEMU session and prints its session id (a UUID). Every other action takes that id.

- `--iso` defaults to `omarchy.iso` in the current directory, a debug convenience; the server has no default of its own and refuses a start that omits `iso`. A path is resolved to absolute and must exist; the CLI fails fast with the real path in the error instead of making the server discover it. An http(s) url is passed through untouched — downloading and caching it is the server's job (see [http-api.md](http-api.md)).
- `--disk` is optional. When given it is resolved to an absolute path. When not given, the `disk` key is omitted from the JSON entirely, not sent as `""`: the proxy creates the default disk only when the key is absent — an empty string would be taken as a real path. `JSON.stringify` dropping `undefined` properties is what makes the omission work.
- Wire call: `POST /start` with `{"iso": "...", "disk"?: "...", "agent": "..."}` → `{"id": "<uuid>"}`. It goes through `node:http` with a 45-minute idle ceiling, because a first-time ISO download can outlast `fetch`'s fixed 300s header timeout.

### get-image

Captures the session's current display as a PNG.

- `--session-id` names the session. `--output` / `-o` is optional.
- With `-o`, the PNG is written to the file (mode 0644); without it, raw PNG bytes go to stdout, so redirect: `... get-image ... --session-id <id> > shot.png`.
- Wire call: `GET /image?id=<id>&agent=<agent>` → `image/png` bytes.

### get-serial

Reads the guest's serial console as text. The guest writes here when something prints to `/dev/ttyS0` — that is how journalctl and crash logs leave a machine whose desktop shell is dead.

- `--session-id` names the session. `--output` / `-o` is optional.
- With `-o`, the bytes are written to the file (mode 0644); without it, they go to stdout.
- Wire call: `GET /serial?id=<id>&agent=<agent>` → `text/plain` bytes.

### send-keys

Types a key string into the session.

- `send-keys --session-id <id> --keys <keys> [--encoding <encoding>]`; `--encoding` defaults to `oligarchy` and is passed through untouched — the server does the parsing. The encoding itself (literal characters, `<ENTER>`, `<C-c>`, ...) is documented in [how-to.md](how-to.md) and implemented server-side in `src/qemu/keys.ts`.
- Wire call: `POST /send-keys` with `{"id", "keys", "encoding", "agent"}` → `{"ok": "true"}`.

### send-mouse

Moves the pointer, and optionally clicks or scrolls, at a point on the screenshot.

- `send-mouse --session-id <id> --x <x> --y <y> [--button <button>] [--clicks <n>]`. `--x` and `--y` are fractions of the screenshot, `0..1` from the top-left; the CLI rejects anything else before calling the server. Omit `--button` to move only. `--button` is `left`, `middle`, `right`, `wheel-up`, or `wheel-down`; `--clicks` defaults to 1 on the server and is a pulse count (a double-click is `--button left --clicks 2`, three wheel ticks is `--button wheel-down --clicks 3`); `--clicks` without `--button` is refused by the CLI, because the server would move and silently drop it.
- Wire call: `POST /send-mouse` with `{"id", "x", "y", "button"?, "clicks"?, "agent"}` → `{"ok": "true"}`.

### intent start / intent end

`intent.ts` exports `intentRun`, a switch over `start` and `end` that calls `intentStartRun` or `intentEndRun`; each has its own flags and parses them first. Records the agent's current intent on the session. One intent is active at a time; it is not stacked. Start before the work that fulfills the intent, then end when that work is done. The verbs `start` and `end` are the only bare words after the action. Quote `--message` so the shell keeps spaces.

- `intent start --session-id <id> --test-result-id <id> --message <message>`. Wire call: `POST /intent/start` with `{"id", "agent", "test_result_id", "message"}` → `{"ok": "true"}`.
- `intent end --session-id <id>`. Ends the session's one active intent. Wire call: `POST /intent/end` with `{"id", "agent"}` → `{"ok": "true"}`.

### stop

Kills the session. Only the agent that started it can stop it; a different `--agent-id` is a 403.

- `stop --session-id <id> [--status <status>] [--reason <text>]`. `--status` is `succeeded`, `failed`, or `aborted`. Omit both to abort: a machine killed with nothing to say for itself. `--reason` is optional text stored on the session row.
- An undefined status or reason is left out of the JSON, so the server applies its own defaults (`aborted`, no reason).
- Wire call: `POST /stop` with `{"id", "agent", "status"?, "reason?"}` → `{"ok": "true"}`.

### follow

Watches a session that is pending or running and prints its events to stdout, one JSON object per line, until the session ends. It is an observer, not a driver: any agent may follow any session, and following is not a command, so it does not reset the session's inactivity window. The events are the `FollowEvent` shape in `src/session.d.ts` — `session` (status), `intent` (`started` with the message, then `completed` or `cancelled`), `action` (`running` with the action's name — `send-keys`, `send-mouse`, `get-image`, `get-serial` — then `completed` or `failed` by id), and `image` (the PNG as base64) — documented under `GET /follow` in [http-api.md](http-api.md).

- `--session-id` names the session. A session that has already ended is a failure that names its status; an unknown id is a failure.
- The stream goes through `node:http`, not `fetch`: a quiet session would otherwise be cut off by undici's five-minute body timeout.
- Wire call: `GET /follow?id=<id>` → `application/x-ndjson` lines until the session ends.

## Ctrl actions

`src/ctrl/actions/*.ts`. `test.ts` exports `testRun`, a switch over `new`, `list`, `run`, and `start`; anything else parses as `test --list`. The Linear API — team and label lookup, issue create and describe, backlog paging, and the two prompt renderers — lives in `src/linear.ts`. The one function that wraps `@cursor/sdk` is `prompt` in `src/cursor-agent/client.ts`.

### test --list

Prints stored test definitions. `--list` is required. Without `--details`, one name per line. `--details` prints every field as JSON (`id`, `name`, `description`, `instruction`, `proof`, `createdAt`). `--name` selects one definition by its unique name; an unknown name is a failure. The command does not write.

### test new

Creates one pending test run (ISO URL and server URL stored on the run) and one pending result for every stored test definition, then opens one Linear issue per definition. `--name` selects one existing definition by its unique name and creates that one result and issue instead. An unknown name is a failure. Each issue is created with its title and labels (`agent test` plus the required `--version` value; missing labels are created on the Linear team), then described in a second call, because the body names the issue's own identifier as the driver's `--agent-id` and Linear assigns that identifier on create. The body is `prompts/linear-issue.html` with its `{{VARIABLES}}` filled: `LINEAR_TICKET`, `RUN_ID`, `RESULT_ID`, `VERSION`, `ISO_URL`, `SERVER_URL`, the definition's `TEST_NAME`, `TEST_DESCRIPTION`, `TEST_INSTRUCTION`, and `TEST_PROOF`, `CLIENT_MD` (the contents of `client.md`), `CTRL_MD` (the contents of `ctrl-linear.md`, the two ctrl commands a driver needs), and `SUB_AGENT`, the reviewer model. A variable in the template with no value is an error. The command uses the first Linear team available to the token, writes the creation line through the database logger, and prints the run and Linear issues as JSON. If any Linear call fails, the run and its results are closed as failed with the API error, naming the issues already created.

The ISO must be an HTTPS URL. The server URL is the shared `--server-url` / `SERVER_URL`, validated before anything is written.

### test list

Prints every Linear issue on the Oligarchy team whose workflow state type is `backlog`. It walks Linear's issue pages until `hasNextPage` is false, then prints a JSON array of `{id, identifier, title, url}`. An empty backlog is `[]`.

### test run

Spawns the Cursor cloud agent that drives one Linear ticket. The command renders `prompts/driving-agent.html` with `LINEAR_TICKET` and `SERVER_URL` and hands the text to `prompt(apiKey, text)`: it creates a cloud agent on this repository, sends the text as the agent's first run, and returns once Cursor has accepted the run. It never waits for the agent. On success it prints `Agent here, go check it out for more information: https://cursor.com/agents/<agent-id>`.

The agent runs Grok 4.6 in fast mode at extra-high effort (`{ id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "true" }] }`, as `Cursor.models.list()` names it); `prompt` takes an optional `{ model }` to choose another. A token Cursor refuses, or a model it does not offer, is a failure. Cloud agents started through the SDK are hidden from the default list at cursor.com/agents; filter by Source > SDK to see them.

### test start

Writes the session onto a pending test result and marks it running. `--test-result-id` is the result UUID printed on the Linear issue. `--session-id` is the session UUID printed by `./client start`. The result already carries its definition id; the command does not take one. An unknown session id, or a result that is missing or not pending, is a failure.

### test-results

Closes one pending test result. `--id` is the result UUID printed on the Linear issue. `--status` is `success` or `failed` (`success` is stored as `passed`). `--reason` is optional text stored on the result row. `--agent-id` is required: the command looks up that agent's session in `agent_runs` and records it on the result. An unknown result id is a failure.

### session list

Prints the most recent sessions for a human, newest first: `SELECT id, status, started_at FROM sessions ORDER BY started_at DESC, id DESC LIMIT <count>`, one line each. The status comes first, padded to a column and colored by ANSI SGR code — green `succeeded`, red `failed`, yellow `running`, gray `downloading`, bright red `aborted`, magenta `timed_out` — then how long ago the session started, then the id in the terminal's default color. The age is a plain calculation, not a package: seconds under a minute (`45s ago`), minutes under an hour (`12m ago`), hours with leftover minutes under a day (`1h30m ago`, `2h ago`), else days with leftover hours (`3d5h ago`). It is clamped at `0s ago`, because the row's clock is the database's and can sit a few seconds ahead of the machine running `ctrl`. `--count` defaults to 10 and must be at least 1. `session.ts` exports `sessionRun`, a switch like `testRun`'s: `list` goes to `sessionListRun`, anything else to `sessionInspectRun` below.

### session

Prints stored logs, the test definition, the test result, and the actions for one session. `--session-id` is the session UUID. At least one selector is required: `--logs`, `--test-def`, `--test-results`, `--actions`, or `--all`.

`--logs` and `--actions` print that table's rows as JSON, oldest first (`created_at`, then `id`). `--test-results` prints the result row attributed to the session, or `null`. `--test-def` prints the definition that result ran, or `null`. `--all` prints `{ logs, results, test_definition, actions }`. Combining selectors prints an object with those keys. An unknown session id is a failure.

## The session REPL

`./session [--server-url <url>]` is the interactive way to drive one guest. `src/session/parse-args.ts` parses that one flag the same way the others do (`SERVER_URL` fallback, then `http://127.0.0.1:42069`; `OLIGARCHY_TOKEN` through `Config`; `--help` and a stray positional behave as everywhere else), then `index.ts` runs a readline REPL with tab completion. Each line is split into a command word and the rest; `dispatch` is a `switch` over the command, and each case is one file under `src/session/actions/` taking the `Session` state and the rest of the line. The state is a plain object from `createSession` in `src/session/client.ts` — `serverUrl`, `agentId`, `sessionId`, `intentOpen`, `startInFlight`, `following` — operated on by standalone functions, per [development.md](../development.md).

Every command runs `./client` as a child process (`runClient`) with `--agent-id` and `--server-url` appended, so the REPL owns no HTTP of its own and the client's flag parsing and error rendering are the single source of truth. The REPL grammar is terse because a person types it; the action files translate it into the client's flags:

| You type | The client runs |
| --- | --- |
| `start [iso] [disk]` | `start [--iso <iso>] [--disk <disk>]` |
| `get-image` | `get-image --session-id <id>`, then renders the PNG inline (kitty or iTerm protocol, else ANSI half-blocks from `src/terminal/image.ts`) |
| `get-serial` | `get-serial --session-id <id>` |
| `send-keys <keys>` | `send-keys --session-id <id> --keys <rest of line>` |
| `send-mouse <x> <y> [button] [clicks]` | `send-mouse --session-id <id> --x <x> --y <y> [--button <b>] [--clicks <n>]` |
| `intent start <message>` | `intent start --session-id <id> --test-result-id manual --message <rest of line>` |
| `intent end` | `intent end --session-id <id>` |
| `stop [status] [reason]` | `stop --session-id <id> [--status <s>] [--reason <rest>]` |
| `follow <session-id>` | `follow --session-id <id>`, streamed; see [Following a session](#following-a-session) |
| `status`, `help`, `exit` / `quit` | nothing; local |

Every `start` mints a fresh agent id (`session-<uuid>`), because the proxy keys one session per agent. A failed command prints the client's stderr — the headline and the stack — and keeps the session; a failed `stop` clears it anyway, since the proxy has already lost it. `exit`, stdin closing, Ctrl-C, SIGTERM, and SIGHUP all run `shutdown`: wait for an in-flight start (the proxy's `/start` is uninterruptible and would otherwise leave an orphan QEMU), stop the session, exit 0. The client child is spawned detached in its own process group for the same reason: a hangup that reaches the foreground group must not kill a start before it hands back its id.

### Following a session

`follow <session-id>` watches another session — typically one an agent is driving — live. It is the one REPL command that takes the whole screen. `src/session/actions/follow.ts` spawns `./client follow --session-id <id>` and reads its stdout line by line; on the first event it switches to the terminal's alternate screen and draws:

- Down the left, forty columns wide: a header (`following <id8> <status>`, the status colored as `ctrl session list` colors it), then one line per intent at the margin and one line per action indented two spaces under the intent it ran in. A running line is gray with a spinning braille glyph (redrawn every 80ms); a completed line is green with `✓`; a failed action or a cancelled intent is red with `✗`. Only the action's name is shown — `send-keys`, `send-mouse`, `get-image`, `get-serial` — nothing about its arguments. Lines that no longer fit scroll off the top for good; the list keeps at most 200 entries.
- On the right, every remaining column: the session's latest image, placed with the kitty graphics protocol (`src/terminal/image.ts`, `placeImage`), scaled to fit the box while keeping its aspect ratio (a terminal cell is taken as twice as tall as it is wide). Each new `get-image` replaces it.
- Bottom-left: `ctrl-c detaches`.

Every line is overwritten at a fixed width with absolute cursor moves and nothing ever writes a newline, so the screen never scrolls and the image stays where it was put. On resize the screen is cleared and redrawn. Ctrl-C while following kills the client child and detaches — the REPL's SIGINT handler checks `session.following` first — and the main screen comes back with `detached from <id>`. When the followed session ends the stream ends, the view leaves the screen, and the REPL prints `session <id> <status>`. A refused follow (a finished or unknown session) never takes the screen; the client's headline is printed at the prompt. The command needs a terminal that speaks the kitty graphics protocol — ghostty or kitty — and refuses otherwise, before calling the proxy. Alacritty has no image protocol at all, so it cannot host the view.

## Errors and exit codes

- `client` and `ctrl` exit `0` on success and `1` on a parse error, an unknown action, or a command failure; `session` exits `1` on a parse error or missing token and `0` when it leaves, reporting each command's outcome inline. Effect renders parse errors (usage plus the error) as they happen; the `catch` in `index.ts` recognizes them with `CliError.isCliError` and only sets the exit code, so nothing is printed twice.
- Every other failure is spelled out in full. First a headline: the error's message with its `cause` message appended when there is one — `fetch failed: connect ECONNREFUSED 127.0.0.1:42069`, because `fetch failed` alone says nothing; for Drizzle, the failed SQL and the Postgres reason. Then the error as Node renders it (`console.error(err)`): its stack, then `[cause]` (or Drizzle's own `cause:` property) with that error's stack, then every property on it — `code: 'ECONNREFUSED'`, `syscall`, `address`, `port`. The frames name the action file and the helper that threw, so a failure can be read back to the line without reproducing it. Failed proxy requests carry the server's `{"error": "..."}` message as the headline; a non-JSON error body is printed raw; an empty one prints `request failed`.

## Reading the files

Start at `src/client/index.ts`, `src/ctrl/index.ts`, or `src/session/index.ts`: the usage text, the switch, the catch (for `session`, the REPL loop and `shutdown`). Each case names the action file to open next. In a `client` or `ctrl` action file, the flag config and the derived `*Args` type sit at the top, and `<action>Run` reads top to bottom: parse, then do the one thing. A `session` action file is shorter still: turn the rest of the line into client flags, run the client, print. `parse-args.ts` is the only place Effect's runtime is invoked. There is no other machinery — see the [philosophy](philosophy.md) for why it should stay that way.
