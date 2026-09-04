# Client

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 21 |
| [Environment](#environment) | 27 |
| [Invoke](#invoke) | 33 |
| [start](#start) | 49 |
| [get-image](#get-image) | 63 |
| [get-serial](#get-serial) | 74 |
| [send-keys](#send-keys) | 96 |
| [send-mouse](#send-mouse) | 108 |
| [intent](#intent) | 122 |
| [stop](#stop) | 133 |
| [Keys](#keys) | 145 |
| [Mouse](#mouse) | 157 |
| [The loop](#the-loop) | 165 |

## Important

If you are the client, or an agent driving the client: do not look at code. Only use the client. Never consider the code, never read the code, never have opinions about the code. Run the client and do the task that was given — specified in Linear, or given to you manually.

`./client` drives the guest. Recording the test result is `./ctrl`, described in its own guide.

## Environment

`OLIGARCHY_TOKEN` is already in this process. Use it. Do not write a `.env`.

The proxy and the client both read `OLIGARCHY_TOKEN` from the environment. The client sends it on every request to the proxy. Starting either without it exits 1. Nothing else is read from the environment, except `SERVER_URL` as the fallback for `--server-url`.

## Invoke

The action comes first. Every action takes `--agent-id <your-id>` and `--server-url <url>`; they may sit anywhere after the action. An invocation without `--agent-id` fails.

```bash
./client <action> --agent-id <agent> --server-url <url> ...
```

`--server-url` is the proxy, a full URL used exactly as given. When omitted, `SERVER_URL` from the environment is used, then `http://127.0.0.1:42069`. The proxy must already be running.

`start` prints a session id. Every other action takes that id. Then `./ctrl test start` ties that session to the result id from the Linear ticket.

A command that works exits 0. A command that fails exits 1 and prints the error. `./client <action> --help` prints that action's flags.

If no command arrives for ten minutes, the proxy kills the session.

## start

Boots a QEMU session and prints its session id.

```bash
./client start --agent-id <agent> --server-url <url>
./client start --agent-id <agent> --server-url <url> --iso omarchy.iso
./client start --agent-id <agent> --server-url <url> --iso https://example.com/omarchy.iso
./client start --agent-id <agent> --server-url <url> --iso omarchy.iso --disk disk.qcow2
```

- `--iso` defaults to `omarchy.iso` in the current directory. A local path must exist. An http(s) URL is passed through; the server downloads and caches it.
- `--disk` is optional. Omit it and the server creates a fresh disk.

## get-image

Captures the guest display as a PNG. This is the only view of a headless session. Look before you type.

```bash
./client get-image --agent-id <agent> --server-url <url> <id> -o desktop.png
./client get-image --agent-id <agent> --server-url <url> <id> > desktop.png
```

`-o` / `--output` may sit before or after the session id. Without it, PNG bytes go to stdout.

## get-serial

Reads everything the guest has written to `/dev/ttyS0` since boot. Empty until something writes. Use this when the desktop is dead and you need logs.

```bash
./client get-serial --agent-id <agent> --server-url <url> <id> -o journal.txt
./client get-serial --agent-id <agent> --server-url <url> <id>
```

`-o` / `--output` may sit before or after the session id. Without it, bytes go to stdout.

To dump the journal onto serial: switch to a TTY, log in, stop the serial getty, then tee the journal. `/dev/ttyS0` is root:uucp — a user redirect is permission denied.

```bash
./client send-keys --agent-id <agent> --server-url <url> <id> "<C-A-F3>"
./client send-keys --agent-id <agent> --server-url <url> <id> "sudo systemctl stop serial-getty@ttyS0<ENTER>"
./client send-keys --agent-id <agent> --server-url <url> <id> "journalctl -b --no-pager | sudo tee /dev/ttyS0<ENTER>"
./client get-serial --agent-id <agent> --server-url <url> <id> -o journal.txt
```

Image until the login prompt before typing the username and password. If sudo asks, send the user password. User-session failures are `journalctl --user -b --no-pager | sudo tee /dev/ttyS0`.

## send-keys

Types a key string into the session. Quote the string so the shell does not eat `<`, `>`, or spaces.

```bash
./client send-keys --agent-id <agent> --server-url <url> <id> "hello"
./client send-keys --agent-id <agent> --server-url <url> <id> "hello<ENTER>"
./client send-keys --agent-id <agent> --server-url <url> <id> "<C-c>"
```

The encoding is `oligarchy`. You do not need to pass it. See [Keys](#keys).

## send-mouse

Moves the pointer, and optionally clicks or scrolls, at a point on the screenshot.

```bash
./client send-mouse --agent-id <agent> --server-url <url> <id> 0.5 0.5
./client send-mouse --agent-id <agent> --server-url <url> <id> 0.5 0.5 left
./client send-mouse --agent-id <agent> --server-url <url> <id> 0.3 0.2 left 2
./client send-mouse --agent-id <agent> --server-url <url> <id> 0.8 0.1 right
./client send-mouse --agent-id <agent> --server-url <url> <id> 0.5 0.5 wheel-down 3
```

`x` and `y` are fractions of the screenshot, `0..1` from the top-left. Omit `button` to move only. `button` is `left`, `middle`, `right`, `wheel-up`, or `wheel-down`. `clicks` defaults to 1 — a double-click is `left 2`. See [Mouse](#mouse).

## intent

Declares what you are about to do on the session, before you do it. Required around every action: start an intent, run the commands that fulfill it, end it. One intent may cover many commands, sleeps, and images. One intent is active at a time: a second start while one is open fails with `Cannot start one intent when one's already running. Please end your previous intent.`, and so does an end with none open. End the open intent before `stop`.

```bash
./client intent start --agent-id <agent> --server-url <url> --session-id <id> --test-result-id <result> --message "wait for the boot menu"
./client intent end --agent-id <agent> --server-url <url> --session-id <id>
```

Every value is a flag. `--test-result-id` is the result id from your Linear ticket. Quote `--message` so the shell keeps spaces.

## stop

Kills the session. `--agent-id` must be the agent that started it.

```bash
./client stop --agent-id <agent> --server-url <url> <id>
./client stop --agent-id <agent> --server-url <url> <id> succeeded
./client stop --agent-id <agent> --server-url <url> <id> failed "installer hung"
```

A stop with no status is an abort. `status` is `succeeded`, `failed`, or `aborted`. `reason` is optional text and needs a status in front of it.

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
