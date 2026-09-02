# Driving a guest

How to operate a session over the control plane: send keys, move the mouse,
look, decide. Everything here was learned driving a full Omarchy install to
the desktop.

## The loop

Send keys or mouse, wait about three seconds, take an image, read it, decide.
That is the whole method. Never sleep more than ten seconds between actions —
things happen quickly, and a long blind wait is how a session gets away from
you. When something genuinely slow is running (an installer's progress bar, a
reboot, a first boot), the loop does not change: keep taking images and
reading them instead of trusting a long sleep.

Every send-keys chord, every send-mouse, and every image is recorded as an
action in the database, so the loop leaves a complete flight recorder behind
— replaying what you did is `actions WHERE session_id ORDER BY created_at, id`.

## Look before you type

Never type into a screen you have not seen. A stray Return at the installer
splash starts a reinstall; a stray letter in a focused dialog clicks a
button. When the state is uncertain, the first action is always an image,
never a key.

## Rendering lags the keys

The guest can accept keys seconds before it draws them — an empty prompt does
not mean the keys were lost. Keys sent while a terminal was still launching
never reached its shell. Wait out the launch (image until the prompt exists),
then type. If typed text has not appeared, take another image before
re-sending: double-typed input is worse than late input.

## Focus is mouse-shaped

Hyprland as Omarchy ships it focuses the window under the pointer. Move the
pointer onto the window you mean to type into (`send-mouse <id> x y`), then
send keys. Window-manager chords (`<M-Enter>`, `<M-2>`, `<M-w>`) land no
matter what has focus; plain text lands wherever the pointer says. A greeter
or installer button is a left click at that point (`send-mouse <id> x y left`);
a double-click launches, a right-click opens a menu, `wheel-down` scrolls.
When a desktop still plays focus games, switch to a TTY with `<C-A-F3>` — a
text console is focus-proof, and a username/password login there is the
cleanest proof of a working system. The same TTY is how logs leave a crashed
desktop: Quickshell dying does not take tty3 with it. Attaching a UART starts `serial-getty@ttyS0`, which treats writes as
login input — stop it first (`sudo systemctl stop serial-getty@ttyS0`).
Then dump the journal (`journalctl -b --no-pager | sudo tee /dev/ttyS0`)
and `get-serial`. `/dev/ttyS0` is root:uucp, so the write has to be root
— a user redirect gets permission denied. User-session failures (the
shell, the greeter) are
`journalctl --user -b --no-pager | sudo tee /dev/ttyS0`. Quickshell crash
folders mix text with binary qslog; `coredumpctl` and `journalctl` are the
readable dump. Screenshot the TTY only to confirm the prompt and any sudo
password; the text itself comes out on serial.

## Menus want arrows

TUI pickers may not filter when you type — letters can reset the selection
instead. Navigate with batched arrows (`<Down>` repeated in one send-keys),
then an image to verify the cursor position before `<Enter>`.

## The keys and clicks you will actually use

The full encoding is in [how-to.md](how-to.md). The drive used little beyond:
literal text, `<Enter>`, `<Esc>`, `<Tab>`, `<Down>`, `<M-...>` for Super
chords, `<C-A-F3>` for TTY switching, and a bare `<META_L>` tap. On a
desktop, add `send-mouse` at the button or window you can see: a move to
focus, a left click to sign in, a double-click to launch.
