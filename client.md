# Client

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 21 |
| [Synopsis](#synopsis) | 27 |
| [start](#start) | 50 |
| [get-image](#get-image) | 65 |
| [get-serial](#get-serial) | 80 |
| [send-keys](#send-keys) | 95 |
| [send-mouse](#send-mouse) | 111 |
| [intent start](#intent-start) | 128 |
| [intent end](#intent-end) | 144 |
| [stop](#stop) | 158 |
| [Keys](#keys) | 174 |
| [Mouse](#mouse) | 186 |
| [The loop](#the-loop) | 194 |

## Important

If you are the client, or an agent driving the client: do not look at code. Only use the client. Never consider the code, never read the code, never have opinions about the code. Run the client and do the task that was given — specified in Linear, or given to you manually.

`./client` drives the guest. Recording the test result is `./ctrl`, described in its own guide.

## Synopsis

```
./client <action> --agent-id <agent> [--server-url <url>] ...

./client start      [--iso <path|url>] [--disk <path>]
./client get-image  --session-id <id> [-o <file>]
./client get-serial --session-id <id> [-o <file>]
./client send-keys  --session-id <id> --keys <keys> [--encoding <encoding>]
./client send-mouse --session-id <id> --x <0..1> --y <0..1> [--button <button>] [--clicks <n>]
./client intent start --session-id <id> --test-result-id <id> --message <text>
./client intent end   --session-id <id>
./client stop       --session-id <id> [--status succeeded|failed|aborted] [--reason <text>]
```

The action comes first. Every value is a flag; there are no positional arguments. Flags may sit in any order after the action.

- `--agent-id <agent>` — your id, from the Linear ticket. Required on every action.
- `--server-url <url>` — the proxy, a full URL used exactly as given. Falls back to `SERVER_URL` from the environment, then `http://127.0.0.1:42069`.
- `OLIGARCHY_TOKEN` — read from the environment and sent on every request. It is already set; do not write a `.env`. Missing means exit 1.

`start` prints a session id; every other action takes it as `--session-id`. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./client <action> --help` prints that action's flags. If no command arrives for ten minutes, the proxy kills the session.

## start

```
./client start --agent-id <agent> --server-url <url> [--iso <path|url>] [--disk <path>]
```

Boots a QEMU session and prints its session id.

- `--iso <path|url>` — the ISO. A local path must exist; an http(s) URL is downloaded and cached by the server. Default `omarchy.iso` in the current directory.
- `--disk <path>` — an existing qcow2 disk. Omit it and the server creates a fresh one.

```bash
./client start --agent-id OLI-42 --server-url https://qemu.example.com --iso https://example.com/omarchy.iso
```

## get-image

```
./client get-image --agent-id <agent> --server-url <url> --session-id <id> [-o <file>]
```

Captures the guest display as a PNG. This is the only view of a headless session. Look before you type.

- `--session-id <id>` — the session.
- `-o <file>`, `--output <file>` — write the PNG here. Without it, PNG bytes go to stdout.

```bash
./client get-image --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 -o desktop.png
```

## get-serial

```
./client get-serial --agent-id <agent> --server-url <url> --session-id <id> [-o <file>]
```

Reads everything the guest has written to `/dev/ttyS0` since boot. Empty until something writes. Use it when the desktop is dead and you need logs: switch to a TTY with `<C-A-F3>`, log in, `sudo systemctl stop serial-getty@ttyS0`, then `journalctl -b --no-pager | sudo tee /dev/ttyS0` (`--user` for a user-session failure), then read the serial. `/dev/ttyS0` is root:uucp — a user redirect is permission denied.

- `--session-id <id>` — the session.
- `-o <file>`, `--output <file>` — write the text here. Without it, bytes go to stdout.

```bash
./client get-serial --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 -o journal.txt
```

## send-keys

```
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys <keys> [--encoding <encoding>]
```

Types a key string into the session.

- `--session-id <id>` — the session.
- `--keys <keys>` — the key string, in the `oligarchy` encoding. See [Keys](#keys). Quote it so the shell keeps `<`, `>`, and spaces.
- `--encoding <encoding>` — the key string's encoding. Default `oligarchy`; you do not need to pass it.

```bash
./client send-keys --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --keys "hello<ENTER>"
```

## send-mouse

```
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button <button>] [--clicks <n>]
```

Moves the pointer to a point on the screenshot, and optionally clicks or scrolls there.

- `--session-id <id>` — the session.
- `--x <0..1>`, `--y <0..1>` — fractions of the screenshot from the top-left. See [Mouse](#mouse).
- `--button <button>` — `left`, `middle`, `right`, `wheel-up`, or `wheel-down`. Omit to move only.
- `--clicks <n>` — how many times to pulse `--button`, 1..100. Default 1. Needs `--button`.

```bash
./client send-mouse --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2 --button left --clicks 2
```

## intent start

```
./client intent start --agent-id <agent> --server-url <url> --session-id <id> --test-result-id <id> --message <text>
```

Declares what you are about to do on the session, before you do it. One intent is active at a time: a second start while one is open fails with `Cannot start one intent when one's already running. Please end your previous intent.` One intent may cover many commands, sleeps, and images.

- `--session-id <id>` — the session.
- `--test-result-id <id>` — the result id from your Linear ticket.
- `--message <text>` — what you are about to do. Quote it so the shell keeps spaces.

```bash
./client intent start --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --test-result-id 2222...2222 --message "wait for the boot menu"
```

## intent end

```
./client intent end --agent-id <agent> --server-url <url> --session-id <id>
```

Ends the open intent. Ending with none open fails. End the open intent before `stop`.

- `--session-id <id>` — the session.

```bash
./client intent end --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9
```

## stop

```
./client stop --agent-id <agent> --server-url <url> --session-id <id> [--status succeeded|failed|aborted] [--reason <text>]
```

Kills the session. `--agent-id` must be the agent that started it.

- `--session-id <id>` — the session.
- `--status <status>` — the verdict: `succeeded`, `failed`, or `aborted`. Omit it and the stop is an abort.
- `--reason <text>` — optional text stored with the verdict.

```bash
./client stop --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --status failed --reason "installer hung"
```

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

Every guest action — keys, mouse, images — runs inside an intent: start one that says what you are about to do, do the work, end it. Only `start`, `./ctrl`, and `stop` sit outside one.

Send keys or mouse, wait about three seconds, take an image, read it, decide. That is the whole method. Never sleep more than ten seconds between actions. When something genuinely slow is running, keep taking images instead of trusting a long sleep.

Never type into a screen you have not seen. When the state is uncertain, the first action is always an image, never a key.

The guest can accept keys seconds before it draws them. If typed text has not appeared, take another image before re-sending: double-typed input is worse than late input.

TUI pickers may not filter when you type — letters can reset the selection. Navigate with batched arrows (`<Down>` repeated in one send-keys), then an image before `<Enter>`.

A text console is focus-proof. `<C-A-F3>` is the cleanest login and the way logs leave a crashed desktop.
