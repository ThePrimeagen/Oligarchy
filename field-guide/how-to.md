# Oligarchy how-to

The CLI talks to a running proxy (`src/qemu/proxy.ts`). Start the proxy first, then boot a session and drive it by the id `start` prints.

```bash
node --experimental-strip-types src/qemu/proxy.ts omarchy.iso
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> start
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> start --iso omarchy.iso --disk qemu-img.qcow2
```

Both default to `127.0.0.1:42069`. Override with `OLIGARCHY_ADDR`.

Every CLI invocation leads with `--agent-id <agent>`, the calling agent's id — required, see [cli.md](cli.md).

## Get an image

Captures the current guest desktop as a PNG.

```bash
# write to a file
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> get-image <id> -o desktop.png

# write PNG bytes to stdout
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> get-image <id> > desktop.png
```

`-o` can sit before or after the session id.

## Get the serial console

Reads everything the guest has written to `/dev/ttyS0` since boot. That is how logs leave a machine whose graphical shell has crashed — switch to a TTY, dump journalctl onto the serial port, then pull the file. `/dev/ttyS0` is root:uucp, so the write is `sudo tee`; a user `>` gets permission denied. `|` can be typed as itself.

```bash
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> "<C-A-F3>"
# image until the login prompt, then username and password
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> "journalctl -b --no-pager | sudo tee /dev/ttyS0<ENTER>"
# if sudo asks, send the user password
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> get-serial <id> -o journal.txt
```

`-o` can sit before or after the session id. Without it, bytes go to stdout.

## Send keys

```bash
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> "hello"
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> "hello<ENTER>"
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> "<C-c>"
```

The key string uses the `oligarchy` encoding (that name is optional; it is the default):

```bash
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> "Hi<ENTER>" oligarchy
```

### Encoding

- Type letters as written. `A` sends shift+a. You do not add a shift key yourself.
- Wrap special keys in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.
- Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. Combine them: `<C-S-c>`.
- `<` and `>` as characters: `<LT>` and `<GT>`.

Quote the key string so the shell does not eat `<`, `>`, or spaces.

## Send mouse

Coordinates are fractions of the last screenshot: `0` is the top or left edge, `1` is the bottom or right. From a pixel `(px, py)` on a `W×H` image, `x = px / (W - 1)` and `y = py / (H - 1)`.

```bash
# move the pointer (Hyprland focuses the window under it)
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-mouse <id> 0.5 0.5

# left click
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-mouse <id> 0.5 0.5 left

# double-click
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-mouse <id> 0.3 0.2 left 2

# right-click
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-mouse <id> 0.8 0.1 right

# scroll three ticks
node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-mouse <id> 0.5 0.5 wheel-down 3
```

Omit the button to move only. `button` is `left`, `middle`, `right`, `wheel-up`, or `wheel-down`. `clicks` is how many times that button is pulsed.
