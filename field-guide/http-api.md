# The HTTP API

The control plane spoken between the CLI and the proxy (`src/qemu/proxy.ts`).

The proxy defaults to `127.0.0.1:42069`. Bodies are JSON except the PNG. Errors are `4xx`/`5xx` with `{"error": "<message>"}`.

Every session-scoped request is recorded in the control-plane database (see [database.md](database.md)). A request carrying an `x-oligarchy-agent` header is attributed to that cloud agent; on `/start` the header also registers the agent as the session's driver — an agent drives exactly one session.

## POST /start

Boots a QEMU session. Returns `{"id": "<uuid>"}`.

The body is JSON with two keys, both optional (an empty body works too):

- `iso` — guest ISO path or http(s) url. Defaults to the proxy's own default ISO (its argv, or `OLIGARCHY_ISO`).
- `disk` — qcow2 path, which must already exist. When the key is **absent**, the proxy creates a fresh disk (40G virtual) in the session dir.

Clients that want the server-managed disk must therefore omit the key, not send `""`. The CLI does this; keep it that way.

A url iso is downloaded into `~/.oligarchy/isos` on first use — verified against the publisher's `<url>.sha256` sidecar when one is published — and served from that cache on every later start. The cache file is the url with `:`, `/`, and every other character a file name cannot hold replaced by `_`. A `manifest.json` beside the isos records each entry's status: while a download runs, a claim whose heartbeat advances as bytes flow; once cached, when it was cached and last used, so the cache can be pruned by size later. A start that finds a live claim — another proxy mid-download — waits and rechecks every ten seconds instead of downloading the same iso twice; a claim gone three beats stale is a dead downloader, and the start takes the download over.

## GET /image?id=<id>

Returns the session's current display as `image/png` bytes (QMP `screendump` under the hood).

## GET /stats

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

## POST /send-keys

Body `{"id", "keys", "encoding"}`. The server parses the key string (encoding `oligarchy`, see [how-to.md](how-to.md)) and types it into the guest via QMP `send-key`. Returns `{"ok": "true"}`.

## POST /stop

Body `{"id"}`; kills the QEMU and removes its session directory. Returns `{"ok": "true"}`. The session is recorded as `aborted`: an end without a verdict.

## POST /finish

Body `{"id", "status", "reason"?}` with `status` either `"succeeded"` or `"failed"` — anything else is a 400. Like `/stop` it kills the QEMU and removes the session directory, but the session keeps the caller's verdict and reason. Returns `{"ok": "true"}`.
