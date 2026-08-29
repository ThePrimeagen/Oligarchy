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

The proxy also accepts an http(s) url as `iso` (the Go server does not). A url iso is downloaded into `~/.oligarchy/isos` on first use — verified against the publisher's `<url>.sha256` sidecar when one is published — and served from that cache on every later start. The cache file is the url with `:`, `/`, and every other character a file name cannot hold replaced by `_`. A `manifest.json` beside the isos records each entry's status: while a download runs, a claim whose heartbeat advances as bytes flow; once cached, when it was cached and last used, so the cache can be pruned by size later. A start that finds a live claim — another proxy mid-download — waits and rechecks every ten seconds instead of downloading the same iso twice; a claim gone three beats stale is a dead downloader, and the start takes the download over.

## GET /image?id=<id>

Returns the session's current display as `image/png` bytes (QMP `screendump` under the hood).

## GET /stats — proxy only

Stats for the machine the proxy runs on, plus how many sessions it is running:

```json
{
  "qemus": 0,
  "memory": { "totalBytes": 16791945216, "usedBytes": 966746112, "freeBytes": 15825199104 },
  "cpu": { "cores": 4, "mean": 20.5, "p10": 19.8, "p25": 20.1, "p75": 20.9, "p90": 21.1 }
}
```

- `qemus` is the size of the proxy's own session map — the proxy is the source of truth for what it booted (see the [philosophy](philosophy.md)).
- `cpu` values are utilization percents over a rolling five-minute window, sampled every five seconds by a timer that lives with the server. Every field is a plain number; before the first sample lands they report 0.
- `memory` is host totals from the OS: `usedBytes = totalBytes - freeBytes`.

The Go server does not implement this endpoint.

## POST /send-keys

Body `{"id", "keys", "encoding"}`. The server parses the key string (encoding `oligarchy`, see [how-to.md](how-to.md)) and types it into the guest via QMP `send-key`. Returns `{"ok": "true"}`.

## POST /stop — proxy only

Body `{"id"}`; kills the QEMU and removes its session directory. Returns `{"ok": "true"}`. The Go server does not implement this endpoint.
