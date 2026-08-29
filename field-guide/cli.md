# The CLI (`src/qemu/cli.ts`)

The TypeScript client for the oligarchy control plane. It sends HTTP requests to a running proxy (`src/qemu/proxy.ts`) and prints the result. It is a main file, not a library: running it executes `main`, and it exports nothing.

```bash
node --experimental-strip-types src/qemu/cli.ts start [--iso <path>] [--disk <path>]
node --experimental-strip-types src/qemu/cli.ts get-image <id> [-o file]
node --experimental-strip-types src/qemu/cli.ts send-keys <id> <keys> [encoding]
```

The server address comes from `OLIGARCHY_ADDR`, default `127.0.0.1:42069`.

## start

Boots a QEMU session and prints its session id (a UUID). Every other command takes that id.

- Arguments are strict `--flag value` pairs: `--iso <path>` and `--disk <path>`, either order, both optional. Anything else — positionals, unknown flags, a flag without a value — is a usage error. These are intentionally the only two options: the qemu client underneath supports more (memory, SMP, firmware paths), neither the proxy nor the CLI exposes them.
- The ISO defaults to `omarchy.iso` in the current directory, mostly a debug convenience. A path is resolved to absolute and must exist; the CLI fails fast with the real path in the error instead of making the server discover it. An http(s) url is passed through untouched — downloading and caching it is the server's job (see [http-api.md](http-api.md)).
- The disk is resolved to an absolute path when given. When not given, the `disk` key is omitted from the JSON entirely, not sent as `""`: the proxy creates the default disk only when the key is absent — an empty string would be taken as a real path. `JSON.stringify` dropping `undefined` properties is what makes the omission work.
- Wire call: `POST /start` with `{"iso": "...", "disk"?: "..."}` → `{"id": "<uuid>"}`.

## get-image

Captures the session's current display as a PNG.

- Exactly three accepted argument forms: `<id>`, `<id> -o <file>`, and `-o <file> <id>`.
- With `-o`, the PNG is written to the file (mode 0644); without it, raw PNG bytes go to stdout, so redirect: `... get-image <id> > shot.png`.
- Wire call: `GET /image?id=<id>` → `image/png` bytes.

## send-keys

Types a key string into the session.

- `send-keys <id> <keys> [encoding]`; the encoding defaults to `oligarchy` and is passed through untouched — the server does the parsing. The encoding itself (literal characters, `<ENTER>`, `<C-c>`, ...) is documented in [how-to.md](how-to.md) and implemented server-side in `src/qemu/keys.ts`.
- Wire call: `POST /send-keys` with `{"id", "keys", "encoding"}` → `{"ok": "true"}`.

## Errors and exit codes

- `0` success; `1` any command failure, including a command's own usage errors; `2` no command or an unknown command. The codes come from the retired Go client — see [porting](philosophy.md#porting-the-reference-implementation-is-the-spec).
- Failed requests print the server's `{"error": "..."}` message. A non-JSON error body is printed raw; an empty one prints `request failed`.
- Network failures print `fetch failed: <cause>` — the cause (e.g. `connect ECONNREFUSED ...`) is unwrapped on purpose, because `fetch failed` alone says nothing.

## Reading the file

`main` dispatches to one `cmd*` function per command. Each command parses its own arguments inline and throws usage errors, which `main` prints to stderr. Three shared helpers: `postJSON` (POST, status check, body text), `readAPIError` (error body to message), and `errorMessage` (thrown error to printable string, unwrapping `cause`). There is no other machinery — see the [philosophy](philosophy.md) for why it should stay that way.
