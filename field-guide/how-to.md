# Oligarchy how-to

The CLI talks to a running proxy (`src/qemu/proxy.ts`). Start the proxy first, then boot a session and drive it by the id `start` prints.

```bash
./server --port 42069
./server --port 42069 --display gtk
./server --port 42069 --automation
./client start --agent-id <agent> --server-url <url>
./client start --agent-id <agent> --server-url <url> --iso omarchy.iso --disk qemu-img.qcow2
```

`./server --port <port>` binds `127.0.0.1` on that port; omit `--port` to keep 42069. `--port` can sit with `--automation` or `--display`. It reads `DATABASE_URL` and `OLIGARCHY_TOKEN` from the environment. A `.env` in the current directory fills in missing variables only; already-set values win. Missing `DATABASE_URL` or `OLIGARCHY_TOKEN` is a startup failure. Every request to the proxy except `GET /images/:id` carries `Authorization: Bearer <OLIGARCHY_TOKEN>`. Every start request must include an ISO; the server has none of its own. The client defaults `--iso` to `omarchy.iso` and `--server-url` to `SERVER_URL`, then `http://127.0.0.1:42069`; the URL is used as given. Running the client without `OLIGARCHY_TOKEN` is a failure.

Sessions boot headless: QEMU runs with `-display none`, so nothing appears on the host while a guest starts or runs, and `get-image` is the only view of it. To watch a session, start the proxy with `--display gtk` (or `sdl`) and every session it boots opens a window instead. `egl-headless`, `spice-app`, and `dbus` are accepted too and handed straight to QEMU; they show nothing on their own. `--automation` is the one flag for agent setup: it forces `-display none` and `-vga none -device virtio-vga` (not virtio-vga-gl) for every session. It cannot be combined with `--display` or leftover `--vga`. The proxy refuses to boot if qemu, qemu-img, OVMF, or the selected display backend is missing on the host. See [http-api.md](http-api.md) for what the flags do and do not change.

The action is the first argument and every value after it is a flag. Every invocation carries `--agent-id <agent>`, the calling agent's id — required, anywhere after the action — and `--server-url <url>`, see [cli.md](cli.md). Recording the result is `./ctrl`, see [ctrl.md](../ctrl.md).

To drive a guest by hand, run `./session [--server-url <url>]` instead: it keeps the session id and agent id for you, shows `get-image` inline, and stops the session when you leave. Type `help` at its prompt; see [cli.md](cli.md#the-session-repl).

## Get an image

Captures the current guest desktop as a PNG.

```bash
# write to a file
./client get-image --agent-id <agent> --server-url <url> --session-id <id> -o desktop.png

# write PNG bytes to stdout
./client get-image --agent-id <agent> --server-url <url> --session-id <id> > desktop.png
```

`-o` is optional; without it, PNG bytes go to stdout.

## Get the serial console

Reads everything the guest has written to `/dev/ttyS0` since boot. That is how logs leave a machine whose graphical shell has crashed — switch to a TTY, stop the serial getty systemd starts on the UART, dump journalctl onto the serial port, then pull the file. `/dev/ttyS0` is root:uucp, so the write is `sudo tee`; a user `>` gets permission denied. `|` can be typed as itself.

```bash
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "<C-A-F3>"
# image until the login prompt, then username and password
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "sudo systemctl stop serial-getty@ttyS0<ENTER>"
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "journalctl -b --no-pager | sudo tee /dev/ttyS0<ENTER>"
# if sudo asks, send the user password
./client get-serial --agent-id <agent> --server-url <url> --session-id <id> -o journal.txt
```

`-o` is optional. Without it, bytes go to stdout.

## Send keys

```bash
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "hello"
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "hello<ENTER>"
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "<C-c>"
```

The key string uses the `oligarchy` encoding (`--encoding` is optional; it is the default):

```bash
./client send-keys --agent-id <agent> --server-url <url> --session-id <id> --keys "Hi<ENTER>" --encoding oligarchy
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
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x 0.5 --y 0.5

# left click
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x 0.5 --y 0.5 --button left

# double-click
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x 0.3 --y 0.2 --button left --clicks 2

# right-click
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x 0.8 --y 0.1 --button right

# scroll three ticks
./client send-mouse --agent-id <agent> --server-url <url> --session-id <id> --x 0.5 --y 0.5 --button wheel-down --clicks 3
```

Omit `--button` to move only. `--button` is `left`, `middle`, `right`, `wheel-up`, or `wheel-down`. `--clicks` is how many times that button is pulsed and needs `--button`.

## Stop

Kills the session. `--agent-id` must be the agent that started it.

```bash
./client stop --agent-id <agent> --server-url <url> --session-id <id>
./client stop --agent-id <agent> --server-url <url> --session-id <id> --status succeeded
./client stop --agent-id <agent> --server-url <url> --session-id <id> --status failed --reason "installer hung"
```

A stop with no `--status` is an abort. `--status` is `succeeded`, `failed`, or `aborted`; `--reason` is optional text.
