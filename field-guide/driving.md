# Driving a guest

How to operate a session over the control plane: send keys, look, decide.
Everything here was learned driving a full Omarchy install to the desktop;
each rule is the difference between a three-second step and a lost hour.

## The loop

Send keys, wait about three seconds, take an image, read it, decide. That is
the whole method. Never sleep more than ten seconds between actions — things
happen quickly, and a long blind wait is how a session gets away from you.
When something genuinely slow is running (an installer's progress bar, a
reboot, a first boot), the loop does not change: keep taking images and
reading them instead of trusting a long sleep.

Every send-keys chord and every image is recorded as an action in the
database, so the loop leaves a complete flight recorder behind — replaying
what you did is `actions WHERE session_id ORDER BY created_at, id`.

## Look before you type

Never type into a screen you have not seen. A stray Return at the installer
splash starts a reinstall; a stray letter in a focused dialog clicks a
button. When the state is uncertain, the first action is always an image,
never a key.

## Rendering lags the keys

The guest can accept keys seconds before it draws them — an empty prompt does
not mean the keys were lost, and a freshly launched terminal swallows
whatever arrives before its shell is up. Wait out the launch (image until the
prompt exists), then type. If typed text has not appeared, take another image
before re-sending: double-typed input is worse than late input.

## Focus is mouse-shaped

The control plane has no mouse, and Wayland compositors focus what the
pointer hovers. Window-manager chords (`<M-Enter>`, `<M-2>`, `<M-w>`) land no
matter what has focus; plain text lands wherever the pointer says. When a
desktop plays focus games, switch to a TTY with `<C-A-F3>` — a text console
is focus-proof, and a username/password login there is the cleanest proof of
a working system.

## Menus want arrows

TUI pickers may not filter when you type — letters can reset the selection
instead. Navigate with batched arrows (`<Down>` repeated in one send-keys),
then an image to verify the cursor position before `<Enter>`.

## The keys you will actually use

The full encoding is in [how-to.md](how-to.md). The drive used little beyond:
literal text, `<Enter>`, `<Esc>`, `<Tab>`, `<Down>`, `<M-...>` for Super
chords, `<C-A-F3>` for TTY switching, and a bare `<META_L>` tap.
