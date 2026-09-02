# The HTTP API

The control plane spoken between the CLI and the proxy (`src/qemu/proxy.ts`).

The proxy defaults to `127.0.0.1:42069`. `./server <port>` binds that host on the given port and loads `.env`. The server takes no ISO. Bodies are JSON except the PNG. Errors are `4xx`/`5xx` with `{"error": "<message>"}`.

Session-driving requests (`/start`, `/image`, `/send-keys`, `/send-mouse`, `/stop`) carry the calling agent's id — `agent` in the POST body, a query param on the GET — so the server attributes the session's [actions](database.md) to that agent. The agent id is required: this control plane is driven by agents, and a request that names none is refused with a 400. After start, `/image`, `/send-keys`, `/send-mouse`, and `/stop` must name the agent that started the session; any other agent is a 403. A stop still exchanges nothing over QMP and is not an action — it carries the session's verdict. `/stats` has no session at all.

## POST /start

Boots a QEMU session. Returns `{"id": "<uuid>"}`.

The body is JSON with three keys — `iso` and `agent` required, `disk` optional:

- `iso` — guest ISO path or http(s) url. Required.
- `disk` — qcow2 path, which must already exist. When the key is **absent**, the proxy creates a fresh disk (40G virtual) in the session dir.
- `agent` — the calling agent's id, for attribution. Required.

Clients that want the server-managed disk must therefore omit the key, not send `""`. The CLI does this; keep it that way.

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

Body `{"id", "keys", "encoding"?, "agent"}`. The server parses the key string (`encoding` defaults to `oligarchy`, see [how-to.md](how-to.md)) and types it into the guest via QMP `send-key`. Returns `{"ok": "true"}`.

## POST /send-mouse

Body `{"id", "x", "y", "button"?, "clicks"?, "agent"}`. Moves the pointer to `(x, y)` — each a number in `0..1`, the fraction of the screenshot from the top-left — via QMP `input-send-event`. With no `button`, that is the whole command: a move, so Hyprland focus can follow the pointer. With `button` (`left`, `middle`, `right`, `wheel-up`, `wheel-down`), the server then pulses that button `clicks` times (`clicks` defaults to 1). Returns `{"ok": "true"}`.

## POST /stop

Body `{"id", "agent", "status"?, "reason"?}`. `id` and `agent` are required: the pair must be the session this proxy is running and the agent that started it. A missing agent is a 400; an unknown session is a 404; a known session owned by a different agent is a 403. On a match, kills the QEMU and removes its session directory, then closes the session row with the verdict — `succeeded`, `failed`, or `aborted` — and the optional reason. A stop without a verdict is an abort: a machine killed with nothing to say for itself. Returns `{"ok": "true"}`.

Timeouts and proxy shutdown still kill sessions without an agent — those are proxy-owned, not a caller claiming a session.

Once a session is running, each `/image`, `/send-keys`, or `/send-mouse` request for it restarts a ten-minute inactivity window. If no command arrives before that window expires, the proxy removes and kills the session automatically, closes it with status `timed_out` and reason `no command received for 10 minutes`, and writes the same event to the session log. `timed_out` is proxy-owned and is not an accepted `/stop` verdict.
