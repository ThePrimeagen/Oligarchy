# The HTTP API

The control plane spoken between the CLI and a server. Two servers implement it:

- Go: `oligarchy-server` (`cmd/oligarchy-server`, `pkg/oligarchy/server.go`) — the reference.
- TypeScript: the proxy (`src/qemu/proxy.ts`).

Both default to `127.0.0.1:42069`. Bodies are JSON except the PNG. Errors are `4xx`/`5xx` with `{"error": "<message>"}`.

## POST /start

Boots a QEMU session. Returns `{"id": "<uuid>"}`.

The Go server accepts the full launch config; every field is optional and zero values get server-side defaults:

| field | meaning | default |
|---|---|---|
| `iso` | guest ISO path | `omarchy.iso` |
| `disk` | qcow2 path, created if missing | `<session dir>/qemu-img.qcow2` |
| `disk_size` | virtual size when creating the disk | `40G` |
| `code` / `vars` | OVMF firmware paths | `/usr/share/edk2/x64/OVMF_{CODE,VARS}.4m.fd` |
| `memory` | guest memory | `4G` |
| `smp` | vCPU count | `2` |

The TypeScript proxy reads only `iso` and `disk`, and the disk semantics differ: the proxy creates a disk only when the `disk` key is **absent**, and a given disk must already exist (the Go server creates a given path if missing). Clients that want the server-managed disk must therefore omit the key, not send `""`. The CLI does this; keep it that way.

## GET /image?id=<id>

Returns the session's current display as `image/png` bytes (QMP `screendump` under the hood).

## POST /send-keys

Body `{"id", "keys", "encoding"}`. The server parses the key string (encoding `oligarchy`, see [how-to.md](../how-to.md)) and types it into the guest via QMP `send-key`. Returns `{"ok": "true"}`.

## POST /stop — proxy only

Body `{"id"}`; kills the QEMU and removes its session directory. Returns `{"ok": "true"}`. The Go server does not implement this endpoint.
