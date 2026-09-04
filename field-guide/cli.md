# The CLIs (`src/client/`, `src/ctrl/`)

Two TypeScript executables share one shape. `./client` (`src/client/index.ts`) drives a guest: it sends HTTP requests to a running proxy (`src/qemu/proxy.ts`) and prints the result. `./ctrl` (`src/ctrl/index.ts`) keeps the record: it writes and reads the database, opens Linear issues, and spawns driving agents. Neither is a library. Each `index.ts` is a `switch` over the first argument; each case awaits one `<action>Run(argv)` from its own file under `actions/`; there is no barrel file. Every action parses its arguments on its first line with `effect/unstable/cli` (`Command`, `Flag`), and only then does its work with plain `async`/`await`. Every value is a flag; neither executable has a positional argument.

```bash
./client start --agent-id <agent> --server-url <url> [--iso <path>] [--disk <path>]
./client get-image --agent-id <agent> --server-url <url> --session-id <id> [-o file]
./client get-serial --agent-id <agent> --server-url <url> --session-id <id> [-o file]
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys <keys> [--encoding <encoding>]
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button <button>] [--clicks <n>]
./client intent start --agent-id <agent> --server-url <url> --session-id <id> --test-result-id <id> --message <message>
./client intent end --agent-id <agent> --server-url <url> --session-id <id>
./client stop --agent-id <agent> --server-url <url> --session-id <id> [--status <status>] [--reason <text>]

./ctrl test --list [--details] [--name <definition>] --server-url <url>
./ctrl test new --iso <https-url> --version <version> [--name <definition>] --server-url <url>
./ctrl test list --server-url <url>
./ctrl test run --ticket <linear-ticket> --server-url <url>
./ctrl test start --session-id <id> --test-result-id <result-id> --server-url <url>
./ctrl test-results --agent-id <agent> --id <result-id> --status success|failed [--reason <text>] --server-url <url>
./ctrl session --session-id <id> --logs|--test-def|--test-results|--actions|--all --server-url <url>
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

### session

Prints stored logs, the test definition, the test result, and the actions for one session. `--session-id` is the session UUID. At least one selector is required: `--logs`, `--test-def`, `--test-results`, `--actions`, or `--all`.

`--logs` and `--actions` print that table's rows as JSON, oldest first (`created_at`, then `id`). `--test-results` prints the result row attributed to the session, or `null`. `--test-def` prints the definition that result ran, or `null`. `--all` prints `{ logs, results, test_definition, actions }`. Combining selectors prints an object with those keys. An unknown session id is a failure.

## Errors and exit codes

- Both `index.ts` files exit `0` on success and `1` on a parse error, an unknown action, or a command failure. Effect renders parse errors (usage plus the error) as they happen; the `catch` in `index.ts` recognizes them with `CliError.isCliError` and only sets the exit code, so nothing is printed twice.
- Every other failure prints one line: the error's message, with its `cause` appended when there is one. Network failures print `fetch failed: <cause>` — the cause (e.g. `connect ECONNREFUSED ...`) is unwrapped on purpose, because `fetch failed` alone says nothing. Database failures do the same unwrap: Drizzle's message is the failed SQL, and the Postgres reason lives on `cause`. Failed proxy requests print the server's `{"error": "..."}` message; a non-JSON error body is printed raw; an empty one prints `request failed`.

## Reading the files

Start at `src/client/index.ts` or `src/ctrl/index.ts`: the usage text, the switch, the catch. Each case names the action file to open next. In an action file, the flag config and the derived `*Args` type sit at the top, and `<action>Run` reads top to bottom: parse, then do the one thing. `parse-args.ts` is the only place Effect's runtime is invoked. There is no other machinery — see the [philosophy](philosophy.md) for why it should stay that way.
