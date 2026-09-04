# Client

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 28 |
| [Environment](#environment) | 32 |
| [Invoke](#invoke) | 40 |
| [start](#start) | 56 |
| [get-image](#get-image) | 70 |
| [get-serial](#get-serial) | 81 |
| [send-keys](#send-keys) | 103 |
| [send-mouse](#send-mouse) | 115 |
| [intent](#intent) | 129 |
| [stop](#stop) | 140 |
| [test](#test) | 152 |
| [test new](#test-new) | 165 |
| [test list](#test-list) | 177 |
| [test run](#test-run) | 187 |
| [test start](#test-start) | 197 |
| [test-results](#test-results) | 207 |
| [session](#session) | 218 |
| [Keys](#keys) | 232 |
| [Mouse](#mouse) | 244 |
| [The loop](#the-loop) | 252 |

## Important

If you are the client, or an agent driving the client: do not look at code. Only use the client. Never consider the code, never read the code, never have opinions about the code. Run the client and do the task that was given — specified in Linear, or given to you manually.

## Environment

`DATABASE_URL`, `LINEAR_API_TOKEN`, `OLIGARCHY_TOKEN`, and the Cloudflare credentials are already in this process. Use them. Do not start a local database. Do not write a `.env`.

If `DATABASE_URL` or `OLIGARCHY_TOKEN` is missing, that is a failure. Stop.

The proxy and the client both read `OLIGARCHY_TOKEN` from the environment. The client sends it on every request to the proxy. Starting either without it exits 1. The proxy, `test --list`, `test new`, `test start`, `test-results`, and `session` also read `DATABASE_URL` from the environment. A missing `DATABASE_URL` or `LINEAR_API_TOKEN` exits 1. `test new` also reads `SERVER_URL`; if it is set, that URL is stored on the run and written into every Linear issue. If it is unset, `--server_url` is used, then `http://127.0.0.1:42069`. `test list` needs `LINEAR_API_TOKEN` only. `test run` reads `CURSOR_API_TOKEN`; a missing one exits 1.

## Invoke

Every QEMU command requires `--agent-id <your-id>`. The flag may sit before or after the subcommand. An invocation without it fails.

The proxy is `--server-url`, a full URL used exactly as given, default `http://127.0.0.1:42069`. The flag may sit before or after the subcommand. The proxy must already be running.

```bash
./client --agent-id <agent> [--server-url <url>] <command> ...
```

`start` prints a session id. Every other QEMU command takes that id. Then `test start` ties that session to the result id from the Linear ticket.

A command that works exits 0. A command that fails exits 1 and prints the error.

If no command arrives for ten minutes, the proxy kills the session.

## start

Boots a QEMU session and prints its session id.

```bash
./client --agent-id <agent> start
./client --agent-id <agent> start --iso omarchy.iso
./client --agent-id <agent> start --iso https://example.com/omarchy.iso
./client --agent-id <agent> start --iso omarchy.iso --disk disk.qcow2
```

- `--iso` defaults to `omarchy.iso` in the current directory. A local path must exist. An http(s) URL is passed through; the server downloads and caches it.
- `--disk` is optional. Omit it and the server creates a fresh disk.

## get-image

Captures the guest display as a PNG. This is the only view of a headless session. Look before you type.

```bash
./client --agent-id <agent> get-image <id> -o desktop.png
./client --agent-id <agent> get-image <id> > desktop.png
```

`-o` / `--output` may sit before or after the session id. Without it, PNG bytes go to stdout.

## get-serial

Reads everything the guest has written to `/dev/ttyS0` since boot. Empty until something writes. Use this when the desktop is dead and you need logs.

```bash
./client --agent-id <agent> get-serial <id> -o journal.txt
./client --agent-id <agent> get-serial <id>
```

`-o` / `--output` may sit before or after the session id. Without it, bytes go to stdout.

To dump the journal onto serial: switch to a TTY, log in, stop the serial getty, then tee the journal. `/dev/ttyS0` is root:uucp — a user redirect is permission denied.

```bash
./client --agent-id <agent> send-keys <id> "<C-A-F3>"
./client --agent-id <agent> send-keys <id> "sudo systemctl stop serial-getty@ttyS0<ENTER>"
./client --agent-id <agent> send-keys <id> "journalctl -b --no-pager | sudo tee /dev/ttyS0<ENTER>"
./client --agent-id <agent> get-serial <id> -o journal.txt
```

Image until the login prompt before typing the username and password. If sudo asks, send the user password. User-session failures are `journalctl --user -b --no-pager | sudo tee /dev/ttyS0`.

## send-keys

Types a key string into the session. Quote the string so the shell does not eat `<`, `>`, or spaces.

```bash
./client --agent-id <agent> send-keys <id> "hello"
./client --agent-id <agent> send-keys <id> "hello<ENTER>"
./client --agent-id <agent> send-keys <id> "<C-c>"
```

The encoding is `oligarchy`. You do not need to pass it. See [Keys](#keys).

## send-mouse

Moves the pointer, and optionally clicks or scrolls, at a point on the screenshot.

```bash
./client --agent-id <agent> send-mouse <id> 0.5 0.5
./client --agent-id <agent> send-mouse <id> 0.5 0.5 left
./client --agent-id <agent> send-mouse <id> 0.3 0.2 left 2
./client --agent-id <agent> send-mouse <id> 0.8 0.1 right
./client --agent-id <agent> send-mouse <id> 0.5 0.5 wheel-down 3
```

`x` and `y` are fractions of the screenshot, `0..1` from the top-left. Omit `button` to move only. `button` is `left`, `middle`, `right`, `wheel-up`, or `wheel-down`. `clicks` defaults to 1 — a double-click is `left 2`. See [Mouse](#mouse).

## intent

Declares what you are about to do on the session, before you do it. Required around every action: start an intent, run the commands that fulfill it, end it. One intent may cover many commands, sleeps, and images. One intent is active at a time: a second start while one is open fails with `Cannot start one intent when one's already running. Please end your previous intent.`, and so does an end with none open. End the open intent before `stop`.

```bash
./client --agent-id <agent> intent start --session_id <id> --test_result_id <result> --message "wait for the boot menu"
./client --agent-id <agent> intent end --session_id <id>
```

Every value is a flag. `--test_result_id` is the result id from your Linear ticket. Quote `--message` so the shell keeps spaces.

## stop

Kills the session. `--agent-id` must be the agent that started it.

```bash
./client --agent-id <agent> stop <id>
./client --agent-id <agent> stop <id> succeeded
./client --agent-id <agent> stop <id> failed "installer hung"
```

A stop with no status is an abort. `status` is `succeeded`, `failed`, or `aborted`. `reason` is optional text and needs a status in front of it.

## test

Lists stored test definitions. `--list` is required. Not used while driving a guest. Reads `DATABASE_URL` from the environment.

```bash
./client test --list
./client test --list --details
./client test --list --name lock-screen
./client test --list --details --name lock-screen
```

`--list` prints one name per line. `--details` prints every field as JSON. `--name` limits the listing to one definition. A missing `--list` is a failure. A name that matches no definition is a failure.

## test new

Creates one pending test run and one Linear issue per stored test definition. Pass `--name` to create a run for one existing definition instead of every definition. Not used while driving a guest. Reads `DATABASE_URL`, `LINEAR_API_TOKEN`, and `SERVER_URL` from the environment.

```bash
./client test new --iso https://example.com/omarchy.iso --version 1.2.3
./client test new --iso https://example.com/omarchy.iso --server_url=https://qemu.example.com --version 1.2.3
./client test new --iso https://example.com/omarchy.iso --server_url=https://qemu.example.com --version 1.2.3 --name "Install Omarchy"
```

`--iso` must be an HTTPS URL. `--server_url` may be HTTP or HTTPS and is optional. `SERVER_URL` is used first, then `--server_url`, then `http://127.0.0.1:42069`. `--version` is required. `--name` is the stored definition's name. A name that matches no definition is a failure.

## test list

Prints every Linear issue on the Oligarchy team whose status type is backlog. Not used while driving a guest. Reads `LINEAR_API_TOKEN` from the environment. A missing token exits 1.

```bash
./client test list
```

Each issue is printed as JSON: `id`, `identifier`, `title`, and `url`. An empty backlog prints `[]`.

## test run

Spawns a Cursor cloud agent that drives one Linear ticket. Not used while driving a guest. Reads `CURSOR_API_TOKEN` from the environment.

```bash
./client test run --ticket OLI-42 --server_url https://qemu.example.com
```

`--ticket` is the Linear issue identifier created by `test new`. `--server_url` may be HTTP or HTTPS; the agent is told to pass it as `--server-url` on every client command. The command prints a link to the agent as soon as it is started and does not wait for it to finish.

## test start

Ties a pending test result to the session that is running it. Reads `DATABASE_URL` from the environment. The result already names its definition; pass the result id and the session id only.

```bash
./client test start --session_id <id> --test_result_id <result-id>
```

`--session_id` is the id printed by `start`. `--test_result_id` is the result UUID from the Linear issue. An unknown session, or a result that is missing or not pending, is a failure.

## test-results

Closes one pending test result. Reads `DATABASE_URL` from the environment. `--agent-id` is required.

```bash
./client --agent-id <agent> test-results --id <result-id> --status success
./client --agent-id <agent> test-results --id <result-id> --status failed --reason "installer hung"
```

`--id` is the result UUID from the Linear issue. `--status` is `success` or `failed`. `--reason` is optional text stored on the result row.

## session

Prints stored logs, the test definition, the test result, and actions for a session. Not used while driving a guest. Reads `DATABASE_URL` from the environment.

```bash
./client session --session-id <id> --logs
./client session --session-id <id> --test-def
./client session --session-id <id> --test-results
./client session --session-id <id> --actions
./client session --session-id <id> --all
```

`--session-id` is required. At least one of `--logs`, `--test-def`, `--test-results`, `--actions`, or `--all` is required. A single selector prints that value as JSON. `--all` prints `{ logs, results, test_definition, actions }`. An unknown session is a failure.

## Keys

Type letters as written. `A` sends shift+a. You do not add a shift key yourself.

Wrap special keys in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.

Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. Combine them: `<C-S-c>`. `<C-A-F3>` switches TTY.

`<` and `>` as characters: `<LT>` and `<GT>`.

The keys you will actually use: literal text, `<ENTER>`, `<ESC>`, `<TAB>`, `<DOWN>`, `<M-...>` for Super chords, `<C-A-F3>` for a TTY, and a bare `<META_L>` tap.

## Mouse

Coordinates are fractions of the last screenshot: `0` is the top or left edge, `1` is the bottom or right. From a pixel `(px, py)` on a `W×H` image, `x = px / (W - 1)` and `y = py / (H - 1)`.

Hyprland as Omarchy ships it focuses the window under the pointer. Move onto the window you mean to type into, then send keys. Window-manager chords (`<M-Enter>`, `<M-2>`, `<M-w>`) land no matter what has focus; plain text lands wherever the pointer says.

A greeter or installer button is a left click at that point. A double-click launches. A right-click opens a menu. `wheel-down` scrolls.

## The loop

Every action runs inside an [intent](#intent): start one that says what you are about to do, do the work, end it.

Send keys or mouse, wait about three seconds, take an image, read it, decide. That is the whole method. Never sleep more than ten seconds between actions. When something genuinely slow is running, keep taking images instead of trusting a long sleep.

Never type into a screen you have not seen. When the state is uncertain, the first action is always an image, never a key.

The guest can accept keys seconds before it draws them. If typed text has not appeared, take another image before re-sending: double-typed input is worse than late input.

TUI pickers may not filter when you type — letters can reset the selection. Navigate with batched arrows (`<Down>` repeated in one send-keys), then an image before `<Enter>`.

A text console is focus-proof. `<C-A-F3>` is the cleanest login and the way logs leave a crashed desktop.
