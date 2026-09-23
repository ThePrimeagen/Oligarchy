# Client

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Important](#important) | 31 |
| [Synopsis](#synopsis) | 37 |
| [client-with-image](#client-with-image) | 69 |
| [start](#start) | 86 |
| [reserve](#reserve) | 108 |
| [relinquish](#relinquish) | 121 |
| [get-image](#get-image) | 133 |
| [get-serial](#get-serial) | 148 |
| [send-keys](#send-keys) | 163 |
| [mouse move](#mouse-move) | 179 |
| [mouse click](#mouse-click) | 194 |
| [mouse double-click](#mouse-double-click) | 213 |
| [mouse scroll](#mouse-scroll) | 225 |
| [mouse drag](#mouse-drag) | 242 |
| [mouse hold](#mouse-hold) | 260 |
| [mouse release](#mouse-release) | 276 |
| [intent start](#intent-start) | 292 |
| [intent end](#intent-end) | 308 |
| [stop](#stop) | 322 |
| [save](#save) | 338 |
| [Keys](#keys) | 354 |
| [Mouse](#mouse) | 366 |
| [The loop](#the-loop) | 376 |

## Important

If you are the client, or an agent driving the client: do not look at code. Only use the client. Never consider the code, never read the code, never have opinions about the code. Run the client and do the task that was given — specified in Linear, or given to you manually.

`./client` drives the guest. `./client-with-image` is the same action plus a screenshot to `CLIENT_IMAGE`. Recording the test result is `./ctrl`, described in its own guide.

## Synopsis

```
./client <action> --agent-id <agent> [--server-url <url>] ...

./client start      [--iso <path|url>] [--disk <path>] [--resume]
./client reserve    [--server <url>]
./client relinquish
./client get-image  --session-id <id> [-o <file>]
./client get-serial --session-id <id> [-o <file>]
./client send-keys  --session-id <id> --keys <keys> [--encoding <encoding>]
./client mouse move         --session-id <id> --x <0..1> --y <0..1>
./client mouse click        --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right] [--modifier <key>]...
./client mouse double-click --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right] [--modifier <key>]...
./client mouse scroll       --session-id <id> --x <0..1> --y <0..1> --direction up|down|left|right [--ticks <n>]
./client mouse drag         --session-id <id> --from-x <0..1> --from-y <0..1> --to-x <0..1> --to-y <0..1> [--button left|middle|right] [--modifier <key>]...
./client mouse hold         --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right]
./client mouse release      --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right]
./client intent start --session-id <id> --test-result-id <id> --message <text>
./client intent end   --session-id <id>
./client stop       --session-id <id> [--status succeeded|failed|aborted|completed] [--reason <text>]
./client save       --session-id <id>
```

The action comes first. Every value is a flag; there are no positional arguments. Flags may sit in any order after the action.

- `--agent-id <agent>` — your id, from the Linear ticket. Required on every action.
- `--server-url <url>` — the qemu server, a full URL used exactly as given. Falls back to `SERVER_URL` from the environment, then `http://127.0.0.1:42069`.
- `OLIGARCHY_TOKEN` — read from the environment and sent on every request. It is already set; do not write a `.env`. Missing means exit 1.
- `--env-file <path>` — optional, on every action. Also read this file. A variable already in the environment wins; this file fills what is still unset; `.env` fills what both lack. A driving agent does not pass it.

`start` prints a session id; every action on the machine takes it as `--session-id`, and `reserve` and `relinquish`, which are about the agent and not a machine, take none. A command that works exits 0. A command that fails exits 1 and prints the error: one headline, then the stack trace and the cause behind it. Read the headline first. `./client <action> --help` prints that action's flags. If no command arrives for ten minutes, the qemu server kills the session.

## client-with-image

```
./client-with-image <action> --agent-id <agent> [--server-url <url>] ...
```

The same arguments as `./client`, then a screenshot. Prefer this over calling `./client` and `./client get-image` as two steps.

- `CLIENT_IMAGE` — the PNG path. Required. Missing means exit 1, `CLIENT_IMAGE is not set`.
- After the action succeeds, waits 100 ms, then writes the guest display to `CLIENT_IMAGE`.
- The action's stdout is unchanged (`start` still prints the session id). `--session-id` comes from the flags, or from that printed id.
- A failed action does not take a screenshot. `stop` and `save` do not either: the session is already gone. Nor does `relinquish`: whatever it held is gone.

```bash
CLIENT_IMAGE=screen.png ./client-with-image send-keys --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --keys "hello<ENTER>"
```

## start

```
./client start --agent-id <agent> --server-url <url> [--iso <path|url>] [--disk <path>] [--resume]
```

Boots a QEMU session and prints its session id. Consumes a reservation already held
for `--agent-id`. Without one the host answers 400 `no reservation` and the command
fails. `./client start` does not reserve. A start that fails keeps the reservation, so
the same command can be retried without reserving again; after three failures give it
back with [relinquish](#relinquish). A reservation nobody starts within ten minutes is
given back, and a start after that is refused the same way.

- `--iso <path|url>` — the ISO. A local path must exist unless `--resume` is given; an http(s) URL is downloaded and cached by the server. Default `omarchy.iso` in the current directory.
- `--disk <path>` — an existing qcow2 disk. Omit it and the server creates a fresh one.
- `--resume` — boot the machine's minted disk of this ISO, the one a `save` kept, instead of the ISO: the installed system comes up in seconds and you log in. Nothing is downloaded and no ISO is attached, so a local `--iso` need not exist. Without a minted disk on that machine the host answers 500 `internal error`. Sentry is told `no minted disk for <iso> on this machine`. Your reservation stands: `start` again without `--resume`, or give it back with [relinquish](#relinquish). Cannot be combined with `--disk`.

```bash
./client start --agent-id OLI-42 --server-url https://qemu.example.com --iso https://example.com/omarchy.iso
./client start --agent-id OLI-42 --server-url https://qemu.example.com --iso https://example.com/omarchy.iso --resume
```

## reserve

```
./client reserve --agent-id <agent> --server-url <url> [--server <url>]
```

Holds a slot for `--agent-id` that its next `start` consumes. Normally the dispatcher reserves for you before it hands you the ticket and you never run this. Run it when a ticket says to: a mint ticket names the one qemu server its install must land on, and `--server <url>` pins the reservation to that server, its registered url used exactly as given, instead of the best-ranked one. Prints nothing. Holding one already, the host answers 400 `already reserved`: `relinquish` first, then reserve again. A url the host does not know is 404 `no server <url>`; a server with no room is 503.

```bash
./client relinquish --agent-id OLI-42 --server-url https://qemu.example.com
./client reserve --agent-id OLI-42 --server-url https://qemu.example.com --server http://127.0.0.1:55331
```

## relinquish

```
./client relinquish --agent-id <agent> --server-url <url>
```

Gives back everything `--agent-id` holds: an unused reservation, and a running session, which is stopped as `aborted` with the reason `relinquished` (machine killed, record closed, debug log saved), so the slot goes to the next agent now, never with a guest still on it. Run it when three `start`s have failed to return a session id, then close your result as failed with `./ctrl test-results` and finish. Holding nothing, the host answers 400 `no reservation`. When the test is over, end the session with `stop` and its verdict instead.

```bash
./client relinquish --agent-id OLI-42 --server-url https://qemu.example.com
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

## mouse move

```
./client mouse move --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1>
```

Moves the pointer to a point on the screenshot and does nothing else. Hyprland focuses the window under the pointer, so this is how you choose where typed text lands.

- `--session-id <id>` — the session.
- `--x <0..1>`, `--y <0..1>` — fractions of the screenshot from the top-left. See [Mouse](#mouse).

```bash
./client mouse move --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2
```

## mouse click

```
./client mouse click --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right] [--modifier <key>]...
```

Moves the pointer to the point, presses `--button` and releases it: one click.

- `--session-id <id>` — the session.
- `--x <0..1>`, `--y <0..1>` — where to click. See [Mouse](#mouse).
- `--button <button>` — `left`, `middle`, or `right`. `left` when omitted.
- `--modifier <key>` — hold `shift`, `ctrl`, `alt`, or `super` around the click; repeat the flag to hold several. Let go when the command ends.

```bash
./client mouse click --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2
./client mouse click --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2 --button right
./client mouse click --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2 --modifier shift
```

## mouse double-click

```
./client mouse double-click --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right] [--modifier <key>]...
```

Two clicks at the point, close enough together to be a double-click. The same flags as [mouse click](#mouse-click).

```bash
./client mouse double-click --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2
```

## mouse scroll

```
./client mouse scroll --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> --direction up|down|left|right [--ticks <n>]
```

Moves the pointer to the point and turns the wheel there, so the window under it scrolls.

- `--session-id <id>` — the session.
- `--x <0..1>`, `--y <0..1>` — where to scroll. See [Mouse](#mouse).
- `--direction <direction>` — `up`, `down`, `left`, or `right`.
- `--ticks <n>` — how many wheel clicks, 1..100. `1` when omitted; a notch of a real wheel is about three.

```bash
./client mouse scroll --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.5 --y 0.5 --direction down --ticks 3
```

## mouse drag

```
./client mouse drag --agent-id <agent> --server-url <url> --session-id <id> --from-x <0..1> --from-y <0..1> --to-x <0..1> --to-y <0..1> [--button left|middle|right] [--modifier <key>]...
```

Presses `--button` at the first point, moves the pointer to the second in steps the way a hand does, and releases it there. Windows follow it, text selects under it, sliders slide. The release is sent even when a step fails, so the guest is never left mid-drag.

- `--session-id <id>` — the session.
- `--from-x <0..1>`, `--from-y <0..1>` — where the button goes down.
- `--to-x <0..1>`, `--to-y <0..1>` — where it comes up.
- `--button <button>` — `left`, `middle`, or `right`. `left` when omitted.
- `--modifier <key>` — as for [mouse click](#mouse-click). On Omarchy, `super` with a left drag moves a window and with a right drag resizes one.

```bash
./client mouse drag --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --from-x 0.3 --from-y 0.2 --to-x 0.7 --to-y 0.6 --modifier super
```

## mouse hold

```
./client mouse hold --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right]
```

Moves the pointer to the point, presses `--button` and leaves it held for the commands that follow: keys you type, `mouse move`s you make. A held button stays down until [mouse release](#mouse-release) or the end of the session. See [Mouse](#mouse) for when to reach for it.

- `--session-id <id>` — the session.
- `--x <0..1>`, `--y <0..1>` — where the button goes down.
- `--button <button>` — `left`, `middle`, or `right`. `left` when omitted.

```bash
./client mouse hold --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.3 --y 0.2
```

## mouse release

```
./client mouse release --agent-id <agent> --server-url <url> --session-id <id> --x <0..1> --y <0..1> [--button left|middle|right]
```

Moves the pointer to the point and lets a held `--button` go. The other half of [mouse hold](#mouse-hold).

- `--session-id <id>` — the session.
- `--x <0..1>`, `--y <0..1>` — where the button comes up.
- `--button <button>` — the button [mouse hold](#mouse-hold) pressed. `left` when omitted.

```bash
./client mouse release --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --x 0.7 --y 0.6
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
./client stop --agent-id <agent> --server-url <url> --session-id <id> [--status succeeded|failed|aborted|completed] [--reason <text>]
```

Kills the session. `--agent-id` must be the agent that started it.

- `--session-id <id>` — the session.
- `--status <status>` — the verdict: `succeeded`, `failed`, `aborted`, or `completed` (the drive ran to its end and a diagnosis will judge it). Omit it and the stop is an abort. `errored` is not a verdict a driver gives: the qemu server writes it when the system failed the session (a start or a save that failed, or QEMU gone when an exchange fails), and the next request for that session is `unknown session`.
- `--reason <text>` — optional text stored with the verdict.

```bash
./client stop --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9 --status failed --reason "installer hung"
```

## save

```
./client save --agent-id <agent> --server-url <url> --session-id <id>
```

Ends the session keeping its disk: the machine's power button is pressed and, once it is off, its disk and firmware are kept as the minted disk of the ISO it booted, and the session closes `succeeded`. A desktop that ignores the power button — Omarchy does — must be shut down from inside first (a terminal and `systemctl poweroff`), as the mint ticket's instruction says; a machine already off needs no button, and an image of it fails, which is how you know it is off. Only call it when the install is complete and the desktop has been seen; the disk is kept exactly as it is. Prints `saved` and exits 0. `--agent-id` must be the agent that started the session. Close your result with `./ctrl test-results` after it answers: `saved` is a success; a failure's headline is the reason, and there is no session left to stop.

- `--session-id <id>` — the session.

A guest that does not power off within two minutes (`guest did not power off within 2 minutes`: the desktop ignored the button and was not shut down from inside), or a disk that cannot be kept, fails with the reason as the headline and exits 1; the session is then over, ended `failed`, and nothing was kept. A session started with `--resume` cannot save (400 `a resumed session cannot save; its disk is a view of the minted one`); it keeps running, and `stop` ends it as usual.

```bash
./client save --agent-id OLI-42 --server-url https://qemu.example.com --session-id 6f1c...e2a9
```

## Keys

Type letters as written. `A` sends shift+a. You do not add a shift key yourself.

Wrap special keys in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.

Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. Combine them: `<C-S-c>`. `<C-A-F3>` switches TTY.

`<` and `>` as characters: `<LT>` and `<GT>`.

The keys you will actually use: literal text, `<ENTER>`, `<ESC>`, `<TAB>`, `<DOWN>`, `<M-...>` for Super chords, `<C-A-F3>` for a TTY, and a bare `<META_L>` tap.

## Mouse

Coordinates are fractions of the last screenshot: `0` is the top or left edge, `1` is the bottom or right. From a pixel `(px, py)` on a `W×H` image, `x = px / (W - 1)` and `y = py / (H - 1)`.

Hyprland as Omarchy ships it focuses the window under the pointer. `mouse move` onto the window you mean to type into, then send keys. Window-manager chords (`<M-Enter>`, `<M-2>`, `<M-w>`) land no matter what has focus; plain text lands wherever the pointer says.

The verbs, in the order to reach for them: `mouse click` (a greeter or installer button), `mouse double-click` (launch), `mouse click --button right` (a menu), `mouse scroll`, `mouse drag`, and a `--modifier` on a click or a drag (`shift` extends a selection; on Omarchy, `super` with a left drag moves a window and with a right drag resizes one). Each of those presses and releases within one command.

`mouse hold` and `mouse release` are the halves those verbs are made of. Use them only when none of the verbs can do the job: a button that must stay held while you type, or a path one drag cannot describe. A held button stays down until you release it or the session ends, so send the release.

## The loop

Every guest action — keys, mouse, images — runs inside an intent: start one that says what you are about to do, do the work, end it. Only `start`, `relinquish`, `./ctrl`, `stop`, and `save` sit outside one.

Send keys or mouse, wait about three seconds, take an image, read it, decide. That is the whole method. `./client-with-image` is the action plus the image, with 100 ms in between; set `CLIENT_IMAGE` to the PNG path you will open. Never sleep more than ten seconds between actions. When something genuinely slow is running, keep taking images instead of trusting a long sleep.

Never type into a screen you have not seen. When the state is uncertain, the first action is always an image, never a key.

The guest can accept keys seconds before it draws them. If typed text has not appeared, take another image before re-sending: double-typed input is worse than late input.

TUI pickers may not filter when you type — letters can reset the selection. Navigate with batched arrows (`<Down>` repeated in one send-keys), then an image before `<Enter>`.

A text console is focus-proof. `<C-A-F3>` is the cleanest login and the way logs leave a crashed desktop.
