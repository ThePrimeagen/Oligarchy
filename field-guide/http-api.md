# The HTTP API

The control plane spoken between the CLI and the proxy (`src/qemu/proxy.ts`).

The proxy defaults to `127.0.0.1:42069`. Bodies are JSON except the PNG. Errors are `4xx`/`5xx` with `{"error": "<message>"}`.

`/start` always names the calling agent — `agent` in the POST body. There is no unattributed start: a session is born with both its uuid and that agent. `/image` and `/send-keys` still take `agent` (query param on the GET, body on the POST) so later actions can be attributed; a request without one is unattributed manual use (the schema's null `agent_id`). `/stop` carries none because a stop exchanges nothing over QMP and is not an action — it carries the session's verdict instead; `/stats` has no session at all.

## POST /start

Boots a QEMU session. Returns `{"id": "<uuid>"}`.

The body is JSON. `agent` is required (an empty body is a usage error). `iso` and `disk` are optional:

- `agent` — the calling agent's id. Manual use fakes one. There is no start without it.
- `iso` — guest ISO path or http(s) url. Defaults to the proxy's own default ISO (its argv, or `OLIGARCHY_ISO`).
- `disk` — qcow2 path, which must already exist. When the key is **absent**, the proxy creates a fresh disk (40G virtual) in the session dir.

The session row and the agent_runs row are written together at the start of `/start`, before any boot work. Those writes are not operational errors — if either fails, the start dies. Clients that want the server-managed disk must omit the `disk` key, not send `""`. The CLI does this; keep it that way.

A url iso is downloaded into `~/.oligarchy/isos` on first use — verified against the publisher's `<url>.sha256` sidecar when one is published — and served from that cache on every later start. The cache file is the url with `:`, `/`, and every other character a file name cannot hold replaced by `_`. A `manifest.json` beside the isos records each entry's status: while a download runs, a claim whose heartbeat advances as bytes flow; once cached, when it was cached and last used, so the cache can be pruned by size later. A start that finds a live claim — another proxy mid-download — waits and rechecks every ten seconds instead of downloading the same iso twice; a claim gone three beats stale is a dead downloader, and the start takes the download over.

## GET /image?id=<id>&agent=<agent>

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

Body `{"id", "keys", "encoding", "agent"}`. The server parses the key string (encoding `oligarchy`, see [how-to.md](how-to.md)) and types it into the guest via QMP `send-key`. Returns `{"ok": "true"}`.

## POST /stop

Body `{"id", "status"?, "reason"?}`; kills the QEMU and removes its session directory, then closes the session row with the verdict — `succeeded`, `failed`, or `aborted` — and the optional reason. A stop without a verdict is an abort: a machine killed with nothing to say for itself. Returns `{"ok": "true"}`.
