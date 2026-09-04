# The HTTP API

The control plane spoken between the CLI and the proxy (`src/qemu/proxy.ts`).

The proxy defaults to `127.0.0.1:42069`. `./server --port <port>` binds that host on the given port; omit `--port` to keep 42069. It reads `DATABASE_URL` and `OLIGARCHY_TOKEN` from the environment (a `.env` fills in missing variables only). Missing `DATABASE_URL` or `OLIGARCHY_TOKEN` is a startup failure. Every request except `GET /images/:id` carries `Authorization: Bearer <OLIGARCHY_TOKEN>`; a missing or wrong token is 401 `{"error": "unauthorized"}`. The server takes no ISO. Bodies are JSON except the PNG and the serial log. Errors are `4xx`/`5xx` with `{"error": "<message>"}`.

`./server --display <backend>` picks the QEMU display backend for every session the proxy boots; the value goes straight to QEMU's `-display`. The default is `none`: the guest still gets its VGA card, but no window is opened on the host at boot or while running, and QEMU needs no `DISPLAY` or `WAYLAND_DISPLAY`. `/image` is unaffected — QMP `screendump` asks the VGA device to render its framebuffer on demand and reads the result, so it does not depend on any display backend. Likewise `/send-keys` and `/send-mouse` reach the guest over QMP, not through a window; with `none`, no host window can grab the keyboard or pointer and type into an agent's session by accident. The other accepted values are `gtk`, `sdl`, `egl-headless`, `spice-app`, and `dbus`; anything else is refused at startup. `curses` is not offered because the proxy detaches QEMU's stdio. Do not reach for `-nographic` or `-nodefaults` to go headless: the first redirects serial to stdio, and the second removes the VGA console that `screendump` reads.

`./server --automation` is the one flag that sets everything automation needs. It can sit with `--port`. Every session the proxy boots then uses `-display none` and `-vga none -device virtio-vga` (not `virtio-vga-gl`). Serial UART, usb-tablet, and the rest of the existing qemu args stay. The guest gets a virtio-gpu DRM device instead of QEMU's default std/Bochs card — the card Quickshell cannot open. `/image` still works: QMP `screendump` reads the virtio console. `--automation` is exclusive: `--display` (including `--display none`) and leftover `--vga` are refused at startup. Without `--automation`, the proxy keeps the defaults: `-display none`, QEMU's own std/Bochs VGA, no extra device. `--display gtk` and the other backends still work on that path. The proxy refuses to boot if qemu, qemu-img, OVMF, or the selected display backend is missing on the host.

Session-driving requests (`/start`, `/image`, `/serial`, `/send-keys`, `/send-mouse`, `/intent/start`, `/intent/end`, `/stop`) carry the calling agent's id — `agent` in the POST body, a query param on the GET — so the server attributes the session's [actions](database.md) to that agent. The agent id is required: this control plane is driven by agents, and a request that names none is refused with a 400. After start, `/image`, `/serial`, `/send-keys`, `/send-mouse`, `/intent/start`, `/intent/end`, and `/stop` must name the agent that started the session; any other agent is a 403. A stop still exchanges nothing over QMP and is not an action — it carries the session's verdict. `/stats` has no session at all. `/images/:id` is the stored PNG for a finished get-image; it has no session, no agent, and no token. `/serial` is the same kind of non-exchange: it reads a host file QEMU is writing, so it is not an action. Intent start and end are not QMP exchanges either: they open and close the session's one Sentry intent span. A QMP action that starts while that span is open is recorded as its child. `/follow` watches a session without driving it: it names no agent, needs the token, and does not count as activity for the session's inactivity window.

## POST /start

Boots a QEMU session. Returns `{"id": "<uuid>"}`.

The body is JSON with three keys — `iso` and `agent` required, `disk` optional:

- `iso` — guest ISO path or http(s) url. Required.
- `disk` — qcow2 path, which must already exist. When the key is **absent**, the proxy creates a fresh disk (40G virtual) in the session dir.
- `agent` — the calling agent's id, for attribution. Required.

Clients that want the server-managed disk must therefore omit the key, not send `""`. The CLI does this; keep it that way.

A url iso is downloaded into `~/.oligarchy/isos` on first use — verified against the publisher's `<url>.sha256` sidecar when one is published — and served from that cache on every later start. The cache file is the url with `:`, `/`, and every other character a file name cannot hold replaced by `_`. A `manifest.json` beside the isos records each entry's status: while a download runs, a claim whose heartbeat advances as bytes flow; once cached, when it was cached and last used, so the cache can be pruned by size later. A start that finds a live claim — another proxy mid-download — waits and rechecks every ten seconds instead of downloading the same iso twice; a claim gone three beats stale is a dead downloader, and the start takes the download over.

## GET /image?id=<id>&agent=<agent>

Returns the session's current display as `image/png` bytes (QMP `screendump` under the hood). The stored copy is 1:1 with that action and is addressed by a uuid, not the sequential action id; the response includes `x-image-url: https://oligarchy.trm.sh/images/<uuid>`, the same URL written on the `qemu.action` span, so the PNG can be opened without the token.

## GET /images/:id

Returns a stored PNG by its uuid. No `Authorization` header. Unknown or malformed ids are 404. The dashboard serves the same path at `https://oligarchy.trm.sh/images/:id`.

## GET /follow?id=<id>

Streams one session's life as it happens: `application/x-ndjson`, one JSON object per line, open until the session ends. The session must be pending (booting: its `/start` has not returned) or running on this proxy. A pending session streams `{"type": "session", "status": "pending"}` at once and `running` when the boot completes, so a follower can attach the moment the id is known. A session that has already ended is 409 `session "<id>" has already completed (<status>)`; a row still `downloading` or `running` that this proxy does not hold (another proxy's, or a dead proxy's) is 409 `session "<id>" is not running on this proxy`; an id with no row is 404.

The lines, in the `FollowEvent` shape from `src/session.d.ts`:

```json
{"type": "session", "status": "pending" | "running" | "succeeded" | "failed" | "aborted" | "timed_out"}
{"type": "intent", "state": "started", "message": "<message>"}
{"type": "intent", "state": "completed" | "cancelled"}
{"type": "action", "id": 7, "name": "send-keys" | "send-mouse" | "get-image" | "get-serial", "state": "running"}
{"type": "action", "id": 7, "state": "completed" | "failed"}
{"type": "image", "id": "<uuid>", "png": "<base64>"}
```

- The first line is always the session's status. If an intent is open when the follower attaches, its `started` line comes next, so the follower knows what the actions it is about to see belong to.
- An `action` is one request — `/send-keys`, `/send-mouse`, `/image`, `/serial` — not one QMP exchange; a twenty-chord `send-keys` is one `running` line and one `completed` line, correlated by `id`, a counter per session. Only the name is carried, no arguments. A request refused before any work (a bad key string, a coordinate out of range) never appears.
- `image` carries the PNG a completed `/image` returned, base64-encoded, with the same uuid as `GET /images/:id`. It lands before that action's `completed` line.
- `intent` `cancelled` is a session that ended with its intent still open.
- The last line is the session's end status, and then the stream closes. A stop, a timeout, a failed start, and proxy shutdown all end the stream this way.

Followers are held on the live session in memory; a follower that disconnects is dropped, and every follower is closed when the session ends. Attach and detach are logged at info as `session <id>: follower attached` / `detached`.

## GET /serial?id=<id>&agent=<agent>

Returns the session's serial console as `text/plain` bytes — whatever the guest has written to `/dev/ttyS0` since boot. Empty until something writes. Not a QMP exchange and not an action.

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

Body `{"id", "keys", "encoding"?, "agent"}`. The server parses the key string (`encoding` defaults to `oligarchy`, see [how-to.md](how-to.md)) and types it into the guest via QMP `send-key`, pacing the chords so QEMU's keyboard queue does not overflow and drop keys. At most 1000 keys are accepted per request; more is a 400. Returns `{"ok": "true"}`.

## POST /send-mouse

Body `{"id", "x", "y", "button"?, "clicks"?, "agent"}`. Moves the pointer to `(x, y)` — each a number in `0..1`, the fraction of the screenshot from the top-left — via QMP `input-send-event`. With no `button`, that is the whole command: a move, so Hyprland focus can follow the pointer. With `button` (`left`, `middle`, `right`, `wheel-up`, `wheel-down`), the server then pulses that button `clicks` times (`clicks` defaults to 1, and must be an integer in `1..100`). Returns `{"ok": "true"}`.

## POST /intent/start

Body `{"id", "agent", "test_result_id", "message"}`. Opens the session's one intent span (name is `message`, `op` is `agent.intent`) as a child of the QEMU session span. A second start while one is still open is a 500: `Cannot start one intent when one's already running. Please end your previous intent.` Returns `{"ok": "true"}`.

## POST /intent/end

Body `{"id", "agent"}`. Closes the session's active intent span. End with no active intent is a 400. A session that dies with an intent still open (stop, timeout, shutdown) cancels that span. Returns `{"ok": "true"}`.

## POST /stop

Body `{"id", "agent", "status"?, "reason"?}`. `id` and `agent` are required: the pair must be the session this proxy is running and the agent that started it. A missing agent is a 400; an unknown session is a 404; a known session owned by a different agent is a 403. On a match, kills the QEMU and removes its session directory, then closes the session row with the verdict — `succeeded`, `failed`, or `aborted` — and the optional reason. A stop without a verdict is an abort: a machine killed with nothing to say for itself. Returns `{"ok": "true"}`.

Timeouts and proxy shutdown still kill sessions without an agent — those are proxy-owned, not a caller claiming a session.

Once a session is running, each `/image`, `/serial`, `/send-keys`, `/send-mouse`, `/intent/start`, or `/intent/end` request for it restarts a ten-minute inactivity window. If no command arrives before that window expires, the proxy removes and kills the session automatically, closes it with status `timed_out` and reason `no command received for 10 minutes`, and writes the same event to the session log. `timed_out` is proxy-owned and is not an accepted `/stop` verdict.
