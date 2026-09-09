# Server vs. reverse proxy

Two processes now share the wire contract a client speaks. This document says which one is
responsible for what, walks a request through both, and records what changed to add the second
one and why each decision went the way it did. `development.md` holds the conventions every
process follows and names the reverse proxy only where it taught one; what the reverse proxy
promises — its routes, texts, statuses and log lines — is pinned by its code and tests and
written out for operators here. A third party is named where it matters: the dashboard Worker
(`src/dashboard/`, Cloudflare, Hyperdrive), which is where stored screenshots are served from.

| | The server (`./server`, `src/proxy/`) | The reverse proxy (`./reverse-proxy`, `src/reverse-proxy/`) |
| --- | --- | --- |
| One sentence | Boots and drives QEMU machines on one host | Sends each session's requests to the host that booted it, and spawns the agents that drive and review them through the program its config names |
| Owns | The machines, the sessions map, the QMP sockets, the session directories | The fleet (`servers`), the routing table (`session_servers`), and the local agent runs when the program is opencode |
| Needs on its host | `qemu-system-x86_64`, `qemu-img`, OVMF, `/dev/kvm`, a display backend | Node and a route to the database and the servers; a route to Cursor's API, or `opencode` on PATH, as the config says |
| Reads | `OLIGARCHY_TOKEN`, `DATABASE_URL` | The same two, through the same `ProxyConfig`; `.reverse-proxy.oligarchy.json` (or `--config`); `CURSOR_API_TOKEN` when the config says cursor |
| Default ports | `42069` | `42070` for the API, `55445` for the diagnostics page |
| Speaks to clients | `ProxyApi`: the 11 `Sessions` routes, `/stats` among them | The same `Sessions` routes minus `/stats`, plus `POST/DELETE/GET /servers` and `POST /agent` |
| Speaks to operators | Nothing beyond the API | The diagnostics page: the fleet, an add box, a delete button each |
| Speaks to | QEMU over QMP, the database | The servers over HTTP (their own `ProxyApi`), the database, and Cursor's API through `@cursor/sdk` or a local `opencode run` per agent |
| Writes | `sessions`, `agent_runs`, `actions`, `images`, `debug_logs`, `logs` | `servers`, `session_servers`, `logs` |
| Serves images | No: `GET /images/:id` is the catch-all's 404 | No: the same 404 |
| Background work | The 10 s timeout sweep, the cpu sampler, the log drain | The log drain; under opencode, a watcher per agent run |
| At shutdown | Drains every session (`aborted`, `proxy shutdown`) | Kills its opencode runs (they are its own children); the sessions are the servers' and the routes are rows |
| Sentry spans | `QEMU session`, the intent, `QMP <cmd>` | None; only error lines report |

## Responsibilities

### The server keeps everything it had, minus one route

The server is unchanged in behaviour and on the wire but for one route: `GET /images/:id` is no
longer a proxy route. It is still the only process that knows a QEMU exists: it checks the host at
startup, prepares a session directory, listens on the QMP socket, spawns QEMU, records every
exchange as an `actions` row, stores screenshots in the `images` table, fans out the follow
stream, times sessions out after ten minutes, writes the debug log on every end but a succeeded
stop, and drains its machines when it is signalled. Its `Sessions` map is the truth for "what is
running here". A client may still talk to a server directly; nothing in this change requires the
reverse proxy.

### The dashboard serves the images

A stored screenshot has one address, `https://oligarchy.trm.sh/images/<uuid>`
(`Contract.StoredImageUrl(id)`, the `x-image-url` header on `GET /image`, the `url` in
`ctrl session --images`). The Cloudflare Worker in `src/dashboard/` serves it over Hyperdrive
from the `images` table: a non-uuid or an unknown id is its 404, a query failure its 500. The
proxy used to serve the same bytes at its own `/images/:id` as v1 had; that copy is gone, so
neither the server nor the reverse proxy has an image route, and the path is the catch-all's 404
on both. One HTTP address; the only other reader of the bytes is `./session image`, straight
from the database.

### The reverse proxy knows where sessions live, and who to start on them

The reverse proxy holds no session state. It knows three things, all of them rows (a fourth, how
to start an agent, is the section after this one):

- Which servers exist, because an operator registered them (`POST /servers { url }`), and the
  reverse proxy checked each one answered `GET /stats` before remembering it. Registering the same
  url twice is two probes and one row; `DELETE /servers` forgets a server without touching the
  sessions still running on it; `GET /servers` probes every server at once and reports each one's
  stats, or `null` for one that did not answer.
- Where to put a new session: `POST /start` probes every registered server at once, skips the ones
  that fail (a `server skipped; …` warning each), and places the start on the one with the fewest
  `qemus`, ties to the earliest registered. With no server registered the answer is 503
  `no server registered`; with every probe failing it is 503 `no server available`.
- Which server started each session: the server's 200 to `/start` carries the id it minted, and the
  reverse proxy writes `session_servers (session_id, server_url)` before answering the client. Every
  later request that names that id is forwarded to that server.

Its routes, all behind `Authorization: Bearer <OLIGARCHY_TOKEN>` on `127.0.0.1:42070`:

| Route | Input | Success | Refusals of its own |
| --- | --- | --- | --- |
| `POST /servers` | `{ "url" }` | `{"ok":"true"}` | 400 502 |
| `DELETE /servers` | `{ "url" }` | `{"ok":"true"}` | 404 |
| `GET /servers` | none | `{"servers":[{"url","stats"}]}` | none |
| `POST /start` | as the proxy | the server's answer | 503, else the server's |
| `GET /image`, `GET /serial`, `GET /follow`, `POST /stop`, `POST /send-keys`, `POST /send-mouse`, `POST /intent/start`, `POST /intent/end` | as the proxy | the server's answer | 404, else the server's |
| `POST /agent` | `{ "task", "type", "model"?, "reasoning"?, "fast"? }` | `{"id","url","model"}` | 400 502 |

Every route may also answer 400 (a body or query the contract refuses), 401, 500 and 502 through
the `RouteBoundary` middleware (`/agent` sits behind the proxy's `ApiBoundary`, which declares 400
and 500; its 400 and 502 are its own); `GET /stats`, `GET /images/:id` and anything else unrouted
is the catch-all's 404 `{"error":"not found"}`, unlogged. The proxy's `/dump` was retired on
master and is not routed here either: an ended session's console is read from the database by
`ctrl`.

### The reverse proxy spawns the agents

`POST /agent` is the one route where the reverse proxy does more than route: it starts the agent
that will drive or review a session, through the program the reverse proxy was started with (the
section after this one). The body names the work and the worker:

- `task` — what the agent works on: the Linear ticket identifier for a `driving-agent`
  (`OLI-42`, which is also the agent id its session will carry), the session id for a
  `diagnosing-agent`. A diagnosing task that is not a uuid is 400
  `task must be a session id for a diagnosing-agent` before any template is read: a ticket there
  would cost an agent run to find out.
- `type` — `driving-agent` or `diagnosing-agent`: which prompt the agent is handed
  (`prompts/driving-agent.html` with the ticket, `prompts/diagnosing-agent.html` with the session
  and the reviewer's guide), the same texts `ctrl test run` and `ctrl diagnose run` send.
- `model`, `reasoning`, `fast` — the model choice, in one vocabulary for every vendor: the model
  as the program names it (Cursor's catalog id such as `grok-4.6`; `provider/model` such as
  `anthropic/claude-opus-4` for opencode), `reasoning` one of `none`, `low`, `medium`, `high`,
  `xhigh`, `max`, and `fast` a boolean. No `model` means the program's own default — `grok-4.6`
  at `high` running `fast` for Cursor, `opencode/grok-code` for opencode — with `reasoning` and
  `fast` in the body still honoured (`{ "fast": false }` is `grok-4.6-high` under Cursor). A
  `model` given alone is asked for alone: the vendor's own defaults decide how hard it thinks and
  whether it runs fast.

Under Cursor the choice is mapped onto its catalog (`Cursor.models.list()`) at spawn time, so what
the vendor cannot do is refused here, with what the model does take, instead of by Cursor once the
agent exists: 400 `unknown model "<id>"`, `model "<id>" has no reasoning level` (a model without
the knob), `model "<id>" has no reasoning level "<level>"; it has low, medium, high, xhigh`, or
`model "<id>" has no fast mode`. Each vendor spells the knob its own way — `effort`, `reasoning`,
`reasoning_effort`, and `extra-high` where we say `xhigh` — and the mapping speaks the vendor's
spelling. Under opencode the choice becomes `opencode run --model <provider/model>` with the
reasoning level as `--variant <level>`; a model without a provider is 400
`model "<id>" must be provider/model`, and `fast` is 400 `model "<id>" has no fast mode`, opencode
having none. A failure of the program itself (a bad Cursor key, a rate limit, an opencode run that
exits or errors before it has a session) is 502 with the program's message.

The agent is told its model as one label, `<model>-<reasoning>-fast` with each part present only
when asked for (`grok-4.6-high-fast`, `composer-2.5`, `claude-opus-5-max`,
`anthropic/claude-opus-4-high`), because that label is what a driver records with
`ctrl test start --model` and a reviewer with `ctrl diagnose --model`; the answer carries the same
label so the caller knows what was written. The reverse proxy logs
`agent spawned; <type>; <task>; <model>; <where>`, attributed to the ticket as agent id for a
driver and to the session for a reviewer, and answers as soon as the agent exists; it never waits
for it. `<where>` and the answer are the program's: a Cursor agent has a page,
`{ "id": "bc-…", "url": "https://cursor.com/agents/bc-…", "model": "grok-4.6-high-fast" }`; an
opencode run has only its session, `{ "id": "ses_…", "model": "opencode/grok-code" }` with no
`url`, and the line names the session.

### The agent program, and the config that names it

Which program spawns the agents is decided when the reverse proxy starts, not per request: the
config file `.reverse-proxy.oligarchy.json` in the working directory, or the one `--config <path>`
names, says `{ "agent-executable": "cursor" }` or `{ "agent-executable": "opencode" }`. The file
committed at the package root says `opencode`. It is read right after the flags, before the
database is pinged; a missing file is fatal, `reverse proxy: config <path> not found`, and a file
that says anything else is fatal with the schema's word
(`config <path>: Expected "cursor" | "opencode"`). The listen line ends with which one was chosen:
`…; agents by opencode`.

Both programs implement one interface, the `Agents` service (`src/shared/agents.ts`):
`prompt(text, choice)` answers `{ agentId, url? }` once the agent exists, and `defaultModel` is the
program's own default, which `/agent` labels the prompt with when no model is asked for. `/agent`
knows nothing of what is behind it.

- **cursor** (`src/ctrl/cursor.ts`, the layer `ctrl test run` and `ctrl diagnose run` use too):
  one cloud agent per prompt through `@cursor/sdk`, on the repository, watched on cursor.com.
  Needs `CURSOR_API_TOKEN`, read once the config has said cursor and reported as
  `reverse proxy: CURSOR_API_TOKEN is not set` when absent.
- **opencode** (`src/reverse-proxy/opencode.ts`): one local process per prompt,
  `opencode run --format json --model <provider/model> [--variant <level>]`, run from the package
  root (where `./client` and `./ctrl` are, as a cloud agent has them in its checkout) with the
  reverse proxy's environment and the prompt on stdin (opencode reads it whole when stdin is not a
  terminal; argv has a size limit and shows in `ps`). Needs `opencode` on PATH, checked when the
  layer is built: `reverse proxy: missing host requirements:` / `opencode not on PATH` otherwise.
  The run says its session in its first JSON event, and that event is the answer: a run that
  exits first is 502 `opencode: exited <code> before its first event[: <stderr tail>]`, one whose
  first event is an error is 502 `opencode: <opencode's message>` and is killed, and one that has
  said nothing within 60 seconds is killed and 502 `opencode: no event within 60 seconds`. A line
  on stdout that is not an event (a share link, a warning) is read past. Every run lives in the
  reverse proxy's own scope, not the request's: it works on after `/agent` was answered, is
  watched out — `agent finished; <session>` at exit 0, an error line
  `agent failed; <session>; exited <code>[: <stderr tail>]` otherwise — and is killed (SIGTERM,
  then SIGKILL after 5 seconds) when the reverse proxy stops. What the agent says is opencode's
  record, in its session (`opencode --session <id>`, `opencode export <id>`), not the reverse
  proxy's log.

The same fleet is on the diagnostics page, `http://127.0.0.1:55445/` by default: an unstyled text
page listing every registered server with its `qemus`, memory and cpu, or `did not answer`, a
`delete` button on each row, and an add box. It has no token — a browser has no bearer to send —
so it is a separate loopback port, `--diagnostics-port`, never the API's; put nothing in front of
it. Its two forms do what `POST /servers` and `DELETE /servers` do, through the same `Router`, and
send the browser back to the page; a refusal (a url the rule rejects, a server that fails its
probe, a url that was never registered) renders the page again with `error: <reason>` on top.
Because a page on another origin could make that same browser post here — and a registration
hands the probed url the shared bearer — a browser's `Origin` must be the page's own or the POST
is refused with 403, and a `Host` that is not a loopback name (a DNS-rebound one) gets no page at
all; the page is also sent `no-store` and may not be framed.

Forwarding is deliberately dumb. The request goes upstream with the same method, the same path and
query, the body text exactly as the client sent it, and the shared bearer; the answer comes back
with its status, its `content-type` and `x-image-url` headers, and its body streamed without being
read. The reverse proxy never decodes a server's refusal and never rebuilds the body it decoded
(the client's text goes up as text): a server's 403, 404, 409 and 502 and its `/follow` stream
reach the client as the server wrote them, and the reverse proxy logs nothing for them, because
the server already did.

### What the reverse proxy refuses on its own

The reverse proxy answers a request itself only when it cannot or should not forward it:

| Answer | When | Logged as |
| --- | --- | --- |
| 401 `unauthorized` | Bearer missing or wrong | `<METHOD> <url> failed: unauthorized`, no Sentry |
| 400 `<schema message>` | Body or query fails the contract (same schemas as the server) | same shape, no Sentry |
| 400 `url must be an http or https url` | `POST/DELETE /servers` with a url that is not http(s) with a host | same shape, no Sentry |
| 400 `task must be a session id for a diagnosing-agent` | `POST /agent` for a reviewer of something that is not a session | same shape, no Sentry |
| 400 `unknown model "<id>"` / `model "<id>" has no reasoning level[ "<level>"; it has …]` / `model "<id>" has no fast mode` / `model "<id>" must be provider/model` | `POST /agent` with a choice the agent program cannot honour (Cursor's catalog, or opencode's `provider/model` and no fast mode) | same shape, no Sentry, no agent started |
| 502 `<the program's message>` | `POST /agent` when the Cursor SDK refuses or fails to start the agent, or an opencode run exits, errors or says nothing before it has a session | the SDK's error or the platform failure as the cause when there is one, reported |
| 404 `unknown session "<id>"` | The id is not a uuid or has no `session_servers` row | attributed to the id (when a uuid) and the agent |
| 404 `not found` | `DELETE /servers` for a url never registered; any unrouted path (`/stats`, `/images/:id`, `/nope`) | the DELETE is logged; the catch-all is not |
| 502 `server <url> unreachable: <cause>` | The server refused the connection, reset it, or did not answer a probe within 10 s | attributed, cause to Sentry |
| 502 `server <url> answered <status>: <message>` | A probe was refused (401 from a token mismatch, 404 from a wrong path) | cause-less, still reported |
| 502 `server <url> answered 200 without stats` / `… without an id` | A 200 whose body is not a proxy's | the decode failure is the cause |
| 503 `no server registered` / `no server available` | `/start` with nowhere to go | attributed to the agent, reported |
| 500 `internal error` | A database failure or a defect | the driver's reason on the line, cause to Sentry |

A server that dies while its answer is streaming (a `/follow`, a long `/image`) cannot be turned
into a 502: the status is already on the wire. The client's response ends short and the reverse
proxy writes one line, `forward cut short; server <url> unreachable: <cause>`, attributed to the
session and the agent.

## A request through both

`./client start --server-url http://reverse:42070 --agent-id OLI-7 --iso …`

1. The reverse proxy checks the bearer and decodes `StartBody` (it needs `agent` for its log
   lines). It reads `servers`, probes each `GET /stats`, picks the fewest `qemus`, and POSTs the
   client's body text to that server's `/start`.
2. The server does everything it always did: inserts the `sessions` row, fetches the ISO,
   prepares the directory, registers the agent, boots QEMU, and answers `{"id":"<uuid>"}`.
3. The reverse proxy decodes the id, inserts `session_servers (id, url)`, logs
   `routed; <url>` attributed to the session and the agent, and returns the server's body and
   status to the client. Had the server answered anything but 200, that answer would have gone
   back untouched with no route written.

`./client send-keys --session-id <uuid> --keys …`

1. The reverse proxy checks the bearer, decodes `SendKeysBody`, reads `session_servers` for the
   id (404 if absent), and POSTs the body text to the recorded server's `/send-keys`.
2. The server looks the session up (its own 403/404), resets the inactivity window, drives QMP,
   records the action, and answers `{"ok":"true"}` or its refusal.
3. The reverse proxy streams that answer back. Nothing is logged on the reverse proxy for a
   server's refusal; the server's `logs` row is the record.

`GET /follow?id=<uuid>` is the same with a stream: the server's NDJSON lines pass through as
they are written, and a client that disconnects releases the upstream stream because `follow` is
interruptible on both sides.

`./client stop …` passes through like `send-keys`. The route row stays: it is history (where the
session ran), and a later request for the ended session gets the server's own 404.

## What changed and why

### A second process, not a change to the server

The request was a reverse proxy that "sits in front of the server", so the server's startup, its
sessions and their tests are untouched, and its wire behaviour changed in one place only: the
removal of `GET /images/:id` (below). Everything new lives in `src/reverse-proxy/` plus the shared
pieces below. `./client` needed no change because the reverse proxy implements the very endpoint
declarations the client is generated from.

### `src/shared/api.ts`: the reverse proxy's contract is declared beside the proxy's

- `RoutedSessions` is a second `HttpApiGroup` named `Sessions` built from the same
  `HttpApiEndpoint` values as the proxy's group, minus `stats`. Reusing the values, rather than
  redeclaring paths and payloads, is what guarantees the client that speaks to a server speaks to
  the reverse proxy: the paths, methods, queries and bodies cannot drift.
- Why no `/stats`: it answers "how many qemus, how much memory, what is the cpu doing" for one
  host; a fleet has no one cpu, and inventing an aggregate would be inventing semantics. The
  per-server numbers are `GET /servers`.
- Why no `/images/:id` anywhere: the stored image's address is the dashboard's
  (`Contract.StoredImageUrl`), the Worker already served it over Hyperdrive, and nothing in the
  repository called the proxy's copy. The proxy's `Images` group, its `storedImage` endpoint and
  `ImagesLive` were removed rather than mirrored on the reverse proxy; `ProxyApi` is the one
  `Sessions` group and every proxy route now requires the bearer. `NotFound` stays: the reverse
  proxy's `DELETE /servers` raises it.
- `Servers` is the new group: `POST /servers` and `DELETE /servers` take `Contract.ServerBody`
  (`{ url }`), `GET /servers` answers `Contract.Servers`. `DELETE` carries a JSON body because a
  url in a path segment would need encoding and `HttpApiEndpoint.delete` supports payloads.
- `RouteBoundary` is a second boundary middleware whose declared errors are the proxy's
  (`BadRequestWire`, `InternalWire`) plus `ServerFailedWire` and `NoServerWire`. It exists because
  HttpApi encodes an error only when its codec is declared on the endpoint or a middleware, and
  rc.112 has no way to add an error to an existing endpoint value. Declaring the two new codecs
  on the proxy's `ApiBoundary` instead would have made every server endpoint advertise 502 and
  503 answers the server never gives.
- `ReverseProxyApi = HttpApi.make("OligarchyReverseProxy").add(RoutedSessions).add(Servers)`.

### `src/proxy/middleware.ts`: one boundary, two tags

`ApiBoundaryLive` and the new `RouteBoundaryLive` wrap one `boundary` effect (schema errors to
400, defects to 500, one log line per failed request), so the two middlewares differ only in the
codecs they declare. The `isApiError` union and the `attribution` switch gained the two new
errors; the switch ends in `satisfies never`, so a tag without an arm does not compile.

### `src/shared/errors.ts`, `domain.ts`, `contract.ts`

- `ServerFailed { message, url, cause?, sessionId?, agentId? }`, status 502, one class for every
  way a server can fail the reverse proxy — unreachable, a refused probe, a 200 that is not a
  proxy's. One class because no consumer distinguishes them: the operator reads the message, the
  client sees a 502. The message always names the url and the reason.
- `NoServer { message, agentId? }`, status 503, for a start with nowhere to go. 503 because the
  service, not the request, is what is missing.
- Both are `Schema.TaggedError`s carrying `[ErrorReporter.ignore]`, as every API error does, so
  the boundary's line is the one Sentry report; both have `wireError` codecs (`{ "error" }` on
  the wire) and are in `ApiError` and the `apiErrorClasses` table.
- `Domain.ServerUrl` is a checked string (`URL.canParse`, http or https, a hostname) with the
  message `url must be an http or https url`. It is the same predicate ctrl's `--server-url` flag
  uses; ctrl was left alone rather than refactored.
- `Contract.ServerBody { url }`, `Contract.Server { url, stats: Stats | null }`,
  `Contract.Servers { servers }`. `null` for a failed probe follows the document's rule for
  nulls: it is the one absence an operator must act on.

### `src/db/schema.ts`, `drizzle/0004_reverse_proxy.sql`, `src/db/servers.ts`

- `servers (url text primary key, created_at)`: the fleet. The primary key makes registration
  idempotent (`insert … on conflict do nothing`).
- `session_servers (session_id uuid primary key references sessions.id, server_url text not
  null, created_at)`: which server started a session. The primary key gives a session one route;
  the foreign key guarantees a route names a real session (the server has inserted the row by
  the time it answers `/start`). `server_url` is deliberately not a foreign key to `servers`:
  forgetting a server must keep the sessions still running on it routable, exactly as `logs`
  keeps `session_id` as attribution rather than a relation.
- Why rows and not a map: the document's own rule is "owned state is the source of truth" for
  what dies with the process (the `Sessions` map) and "the database row is the truth for state
  that outlives the process". A route outlives the reverse proxy — the session keeps running on
  its server through a deploy — so an in-memory table would strand every live session on a
  restart. With rows, a restart forgets nothing, and there is no cache to keep coherent: each
  routed request costs one `session_servers` read.
- Why routes are never deleted: a row for an ended session is history (where it ran), a request
  for it is the server's own 404 passed through, and `sessions.status` already says whether it
  ended. Deleting on `/stop` or on a 404 would add rules to reason about for no reader.
- The migration was generated by `drizzle-kit generate --name reverse_proxy`; existing
  migrations are untouched and `drizzle-kit check` is clean.
- `ServerStore` follows the repository pattern: a `Context.Service` whose methods are
  `Effect.fn("db.<name>")` over `Database.run` — `addServer`, `removeServer` (answers whether a
  row went, which `DELETE /servers` turns into its 404), `listServers` (registration order),
  `routeSession`, `serverForSession` (an `Option`).

### `src/reverse-proxy/router.ts`: the one service

`Router` is a `Context.Service` over `ServerStore`, `Log`, `HttpClient` and `ProxyConfig`, with
`register`, `unregister`, `servers`, `start` and `forward`. Decisions inside it:

- Urls are stored exactly as given, like `--server-url`, and joined to paths with
  `HttpClientRequest.prependUrl`, which inserts or trims one slash, as the generated client's
  `baseUrl` does. `https://host/` and `https://host` both reach `/stats`; they are two rows if
  both are registered.
- The probe is `GET /stats` under `Effect.timeoutOrElse` at `PROBE_TIMEOUT` (`"10 seconds"`).
  The body is read before it is decoded, so a connection that resets mid-body is `unreachable`
  and only a body that is not `Contract.Stats` is `answered 200 without stats`. A non-200's text
  is read best-effort: the status is the refusal, the text only names it (`apiError` from the
  client module extracts the `error` of a `{ "error" }` body).
- Placement probes all servers with unbounded concurrency (a fleet is a handful of hosts) and
  picks the minimum `qemus` in registration order, so ties are deterministic.
- `send` forwards the request's own `url` (path and query as they arrived), the cached body text
  under `application/json` for methods that carry one, and the bearer. `Effect.orDie` on reading
  the body is justified: HttpApi decoded it before the handler ran and the Node platform caches
  the text, so it cannot fail a second time.
- `passthrough` copies exactly two headers. `content-type` and `x-image-url` are the two the
  contract names; `date`, `connection`, `content-length` and `transfer-encoding` belong to the
  responding server, and forwarding them would conflict with how Node writes a streamed body.
  The body stream is tapped for its failure so a server dying mid-stream leaves the
  `forward cut short` line.
- `start` reads the server's answer as text (it must, to learn the id), decodes `{ id }` as a
  `Domain.SessionId` because that is what the `uuid` column stores, writes the route, logs
  `routed; <url>`, and returns the text under the server's status and headers. A route that
  cannot be written is a 500; the machine then times out on its server after ten minutes.
  Stopping it from the reverse proxy was considered and left out: the consequence is bounded and
  self-healing, and the extra path would need its own error handling and tests before any
  operator has seen the failure.
- `forward` never reads the store for a non-uuid id: the column is `uuid` and servers mint
  nothing else, so the answer is 404 without a query. This is the one behavioural divergence
  from talking to a server directly: an empty id on an agent route is 404 `unknown session ""`
  here where the server says 400 `session id is required`. Both are refusals.

### `handlers.ts`, `command.ts`, `main.ts`, `./reverse-proxy`, `package.json`

- `diagnostics.ts` is the page: a `handler` served router-less with `HttpServer.serve` on its
  own `NodeHttpServer`, because `HttpRouter.serve` memoises one `HttpRouter` per layer graph and
  a second router would have served the API's routes on the diagnostics port too (and the doc
  forbids `Layer.fresh` in production). Three routes on a `switch` over method and path: `GET /`
  renders; `POST /servers` and `POST /servers/delete` decode the form field `url` with
  `Domain.ServerUrl`, call `Router.register` or `Router.unregister`, and answer 303 to `/`. A
  refusal renders the whole page with the reason on top under the refusal's status (400 for the
  url rule, 502 for a failed probe, 404 for a url never registered) and writes the same
  `<METHOD> <path> failed: <reason>` line the API boundary writes; a database failure or a defect
  is a 500 page whose fleet section is omitted rather than shown empty. Every url on the page is
  HTML-escaped; the page carries no style and no script. The review found the one thing a
  tokenless mutating page must still refuse: a cross-site form post from the operator's own
  browser, which would have made the reverse proxy probe an attacker's url with the shared bearer.
  Both POSTs therefore check the browser's `Origin` against the `Host` it connected to (a client
  sending no `Origin` is not a browser and already has the machine); because a rebound DNS name
  would make the two agree, a `Host` that is not `127.0.0.1`, `localhost` or `[::1]` is refused on
  every route before anything is read; and every answer carries `cache-control: no-store` and
  `x-frame-options: DENY` so a framed copy cannot be click-jacked.
- `handlers.ts` binds both groups. The session-driving routes are `uninterruptible`, for the
  proxy's own reason: a client that disconnects mid-`/start` must not tear the forward in half,
  or the routing table never learns of the machine the server booted. `follow` stays
  interruptible so an abandoned follower releases its upstream stream. The catch-all 404 is the
  proxy's `NotFoundRoute`, reused.
- `command.ts` is `makeReverseProxyCommand({ serve, serverFailed })` with three flags, `--port`
  (default 42070, one above the proxy so both run on a development host), `--diagnostics-port`
  (default 55445) and `--config` (default `.reverse-proxy.oligarchy.json`);
  `serve(port, diagnosticsPort, config)` is one layer holding both listeners and the agent
  program the config names. Its startup is the proxy's with the config file for the host check:
  parse, read the config (`config <path> not found`, or the schema's word), `database.ping`
  (`database unreachable: <detail>`), then the program's own requirement inside the layer
  (`CURSOR_API_TOKEN is not set`, or `missing host requirements:` / `opencode not on PATH`),
  listen; a failure is the fatal line `reverse proxy: <detail>` and exit 1. About ten lines are
  duplicated from the proxy's command rather than shared; a helper for two callers was judged
  premature by the document's philosophy and by review.
- `main.ts` composes the graph as the proxy's does — `ServerStore` and `Log` over `LogStore`,
  `Database`, `ProxyConfig`, `SentryLive`, the config provider, the Node HTTP client and
  services — without `Qemu`, `Iso`, `Stats`, `Sessions` or a `Shutdown` reference, with the same
  `TracerDisabledWhen` so no `http.server` span reaches Sentry. The `Agents` layer is not in that
  graph: it depends on the config file, known only once the flags are parsed, so `serve` builds it
  (`AgentsLive(config)`: `Cursor.layer` over `CURSOR_API_TOKEN`, or `OpenCode.layer`) beneath the
  routes. It creates two `node:http` servers, each with its own `NodeHttpServer` layer provided
  privately to its consumer (the API router, the diagnostics handler); an `error` on either
  completes the same `serverFailed`. The listen line names both and the program:
  `oligarchy reverse proxy listening on 127.0.0.1:<port>; diagnostics on
  127.0.0.1:<diagnostics port>; agents by <cursor|opencode>`. Its teardown exits 1 on any
  failure but an interrupt and 0 otherwise; it logs nothing of its own at shutdown, though an
  opencode run killed on the way down leaves its `agent failed; …; exited on a signal` line.
- `./reverse-proxy` is the fifth root wrapper, with the same `--import` of
  `src/observability/instrument.ts` as `./server`; `npm run reverse-proxy` is the script.

### Tests, written before the code

Every surface has a happy and an unhappy test:

- `test/reverse-proxy/http.unit.test.ts` (41 cases) runs the real `Router` and real handlers on
  a loopback server, with the upstream servers scripted through `FakeHttp.recordRequests` and
  given to `Router.layer` alone, so the `HttpClient` in the test's scope still points at the
  server under test. The client side uses `HttpApiClient.make(Api.ProxyApi)` — the proxy's
  contract — to prove the client reaches the reverse proxy unchanged, and `ReverseProxyApi` for
  the operator routes. It covers registration and its refusals (bad url, unreachable, 401, a 404
  with a raw body, a 200 that is not stats, a body that cannot be read, a probe that hangs past
  10 s under the `TestClock`), placement (fewest qemus, ties, skipped servers, 503s, a refused
  start passing through, a 200 without an id, a route that cannot be written, a server dying
  mid-start, the route surviving a client disconnect), forwarding (headers and bytes, a gated
  `/follow` stream that a buffering proxy would hang on, a body forwarded with its spacing and
  key order, a route outliving its server's removal, a server's 403 passing through unlogged),
  and refusals (unrouted uuid, non-uuid without a store read, unreachable server, database
  failure, 401 on all thirteen routes, 404 for `/stats` and `/images/:id`, malformed bodies).
- `test/reverse-proxy/diagnostics.unit.test.ts` (11 cases) serves the page on a loopback server
  with the same fakes: the empty page and its add form; a fleet with one answering and one dead
  server, the delete forms, and a url with `"` and `<` escaped; the three-route 404; adding a
  server (303, the probe, the row, the log line), a url the rule refuses (400, unprobed), a body
  that is not a form (400), a server that does not answer (502, unstored, logged with the
  cause); deleting (303 and the line; 404 for a url never registered); a database failure and a
  defect as 500 pages with the boundary's log line. The test client is `fetch`, so the two
  redirect cases ask for `redirect: "manual"` to see the 303 itself.
- `test/reverse-proxy/command.unit.test.ts`: flags (both ports, their defaults and integer
  checks), `--help`, the ping failure, a server error after listen, a listen failure.
- `test/proxy/http.unit.test.ts` lost its `Images` describe and pins `GET /images/<uuid>` as the
  catch-all's unlogged 404; `test/shared/api.unit.test.ts` pins `ProxyApi` as the one `Sessions`
  group with the bearer on every endpoint.
- `test/shared/{errors,api,domain}.unit.test.ts`: the two codecs, the reflected api (paths,
  middleware order, per-endpoint statuses, `ProxyApi` without the reverse proxy's routes or
  boundary), `ServerUrl`.
- `test/integration/db.integration.test.ts`: `ServerStore` against the migrated database,
  including the primary key and foreign key refusals.
- `test/integration/reverse-proxy.integration.test.ts`: the black-box process — `--help`, a
  bad `--port`, a missing token, an unreachable database (this one needs neither QEMU nor Docker,
  so it always runs), an occupied port, and serving (`GET /servers` empty, 401, 404 for `/stats`
  and `/images/:id`, 503 for a start with no server, the diagnostics page on its own port with a
  dead server refused on it and the API's paths 404 there, exit 0 on SIGINT and SIGTERM). It
  empties the fleet table through the `Database` service before it starts, because the
  integration files share one database.
- `test/support/stores.ts` gained `fakeServerStore`; `test/support/postgres.ts` provides
  `ServerStore` in the migrated layer.

### `development.md`

That document owns conventions, not contracts, so the reverse proxy appears there only where it
taught one: a second `HttpApi` is built from the first's endpoint values; an error only the second
raises gets its codec on a second boundary tag over one implementation; a pass-through handler
decodes nothing of the upstream answer; a second listener in one process is `HttpServer.serve`
over a plain handler because `HttpRouter.serve` memoises one router per graph; an operator's
tokenless page checks `Origin` and `Host`; the Toolchain, Layout, Core rules, Sentry, Runtime
entry and Tests sections name the reverse proxy in their inventories. Everything the reverse proxy
promises is in this document and pinned by its tests.

### Changes from review

The change was reviewed by a Sol subagent in two passes against the document's review prompt.
Fixed from it: url joining (string concatenation sent a registered `http://host/` to `//stats`),
the probe reading its body before decoding it, the `forward cut short` line, `TracerDisabledWhen`
on the reverse proxy's server layer, the document's over-claim that forwarded bytes are identical
(the text is forwarded; the decoded object is never rebuilt), a route-survival test that compared
two different url strings, raw `pg` SQL in a test (now the `Database` service), and a `TestClock`
watchdog that could never fire. Declined with the reviewer's agreement: dropping the exported
`RouterService` type (the `SessionsService` and `LogService` convention) and sharing the ten
duplicated startup lines.

## The agent route, and why it is here

The request was a way to spawn the agents that work the tickets without a keyboard at `ctrl`:
"spawn off agent to do work" as one message to the reverse proxy, with room for other ways of
spawning later, Cursor cloud agents first. The reverse proxy is the process every client already
reaches with the shared bearer, and the only one that is always up, so it is where the message
goes. It stays a relay for everything else.

### `src/shared/domain.ts`, `contract.ts`, `errors.ts`, `api.ts`

- `Domain.Reasoning` (`none`, `low`, `medium`, `high`, `xhigh`, `max`) and `Domain.AgentType`
  (`driving-agent`, `diagnosing-agent`) are the two closed vocabularies; `Domain.ModelChoice`
  `{ model, reasoning?, fast? }` is how a model is asked for everywhere, and `Domain.modelLabel`
  builds the one string an agent records. They live in `domain.ts` because `ctrl` and the
  reverse proxy both spawn. The default is each program's own (`Cursor.DEFAULT_MODEL`,
  `OpenCode.DEFAULT_MODEL`), carried on the `Agents` service as `defaultModel`.
- `Contract.AgentBody` and `Contract.AgentStarted` are the request and the answer;
  `Api.Agents` is a third group with the one endpoint, behind `BearerAuth` and the proxy's
  `ApiBoundary`. Why not `RouteBoundary`: it declares 502 `ServerFailed` and 503 `NoServer`,
  answers this route never gives, and the doc's rule is that an api must not advertise a status
  it never answers. The route's own refusals are declared on the endpoint, which a new endpoint
  can do.
- `ModelUnavailable { message, model }`, status 400, is the program's refusal of a choice;
  `AgentFailed { message, retryable, cause? }` (once `CursorAgentFailed`), status 502, is the
  program failing to start the agent, with the `[ErrorReporter.ignore]` every API error carries,
  so the boundary's line is the one report. Both have `{ "error" }` codecs and arms in
  `apiErrorClasses` and the middleware's `attribution` (unattributed: the task is in the line).
  `AgentStarted.url` is an optional key: absent for a program without a page.
- `InvalidConfig { path, message, cause? }` is the config file's refusal, a startup failure only.

### `src/ctrl/cursor.ts`: one interface, the catalog as the judge

`prompt(text, choice)` on the `Agents` service replaced `prompt(text, ModelSelection?)`: the
second argument is ours, not the SDK's. `select(choice, catalog)` is the pure mapping, a
`Result`: find the model by id or alias, put the reasoning level on whichever of `effort`,
`reasoning`, `reasoning_effort` the model has (taking `extra-high` for `xhigh` where that is the
spelling), put `fast` on the `fast` switch, and refuse anything the model does not list. The
catalog is asked on every prompt (`Cursor.models.list()`, one GET the SDK also makes for its own
pre-flight) rather than hard-coded: the vendor's list is the truth and changes without us. What
is not asked for is not sent, so the vendor's default variant stands for it.

### `src/reverse-proxy/agent.ts`, `handlers.ts`, `main.ts`

- `Agent.spawn(body)` is a plain `Effect.fn`, not a service: it reaches `Agents`, `Log` and the
  `FileSystem` (the templates) with `yield*`, and the handler calls it. It refuses a diagnosing
  task that is not a uuid, builds the choice from the body over the program's default, renders
  the type's template with the label, prompts, logs and answers. A template that cannot be read
  is an `Internal` (500), as a database failure is on the routing side.
- The handler is uninterruptible, as the driving routes are: a client gone mid-create must not
  leave an agent created and never prompted, or prompted and answered to nobody.
- `main.ts` builds the `Agents` layer from the config inside `serve`, so the program's own
  requirement (`CURSOR_API_TOKEN`, or `opencode` on PATH) is reported after `OLIGARCHY_TOKEN`,
  `DATABASE_URL`, the config file and the ping, and the process refuses to start without it: the
  route would only fail later otherwise.

### `ctrl`, the prompts, the default

- `prompts/diagnosing-agent.html` gained `{{MODEL}}` and tells the reviewer to pass it to
  `ctrl diagnose --model`, as the driving prompt already did for `test start`; who diagnosed is
  recorded on the diagnosis row today, and now as the label rather than whatever the agent
  believed it was. `ctrl diagnose run` takes `--model` like `test run`; both send `{ model }`
  alone for a given id, and the default otherwise.
- The default moved from `grok-4.6` xhigh fast to `grok-4.6` high fast, as asked.

### Tests

- `test/reverse-proxy/http.unit.test.ts` runs ten `/agent` cases over the real handler and
  templates with a fake `Agents` (`test/support/fake-agents.ts`): the default and its label, a
  named model, `fast: false` and `reasoning` on the default, a program's own default and a start
  without a page (no `url`, the session in the line), a reviewer attributed to its session, a
  non-uuid reviewer task, bodies the contract refuses, the program's 400, its 502, and an
  unreadable template's 500. `/agent` joined the 401 sweep.
- `test/reverse-proxy/opencode.unit.test.ts` runs the opencode layer over a scripted spawner:
  the PATH check, the argv for a choice and its refusals, the prompt on stdin from the package
  root, the first event as the answer (a non-event line read past, an event in pieces), an exit
  before it, an error event, the 60 s timeout, the finish and failure lines, and the kill when
  the layer's scope closes. `test/config/config.unit.test.ts` reads the config file: the default
  path, another path, a file not there, unreadable, not JSON, not an object, without the key,
  naming another program. `test/reverse-proxy/command.unit.test.ts` pins `--config`, the config
  read before the ping, and the program's requirement as a fatal line.
- `test/ctrl/cursor.unit.test.ts` tests `select` against `test/support/cursor-catalog.ts`, six
  entries captured from `Cursor.models.list()` on 2026-09-09; `test/support/stub-cursor.ts` lists
  the same `grok-4.6` so the integration lanes see a catalog with knobs.
- `test/integration/reverse-proxy.integration.test.ts` writes a config into each process's
  working directory (cursor, unless the test says), pins the missing and the refused file, and,
  when the database is there: a cursor config wanting `CURSOR_API_TOKEN`, an opencode config on a
  PATH without opencode, `/agent` against the stub Cursor API through the real SDK (the default
  model's params, the prompt, the label, the log line, a level the stub's `grok-4.6` refuses),
  and `/agent` with the committed config and a stand-in `opencode` on PATH (a shell script that
  records its pid, argv and stdin and says one event): the argv, the prompt on stdin, the session
  as the answer with no `url`, `--variant`, the two 400s, and every run dead once the reverse
  proxy exited on SIGINT.

## Deliberately not done

Each of these was considered and left for a need to show itself, per "support only what is
used":

- Checking a diagnosing task's session before spawning (ended, not yet diagnosed), as
  `ctrl diagnose run` does. It would bring `SessionStore` and `DiagnosisStore` into the reverse
  proxy for one route; the reviewer's `ctrl diagnose` refuses the same things, at the cost of the
  run. `ctrl diagnose run` keeps its checks.
- `--reasoning` and `--fast` on `ctrl test run` and `ctrl diagnose run`. `--model` takes the id
  alone there, as before; the full choice is the route's.
- A model or knobs for opencode in the config file. The program is the config's; the model is
  the request's, and the built-in default (`opencode/grok-code`) is a constant as Cursor's is.
- Reading opencode's output into the log. Its session is its record; the reverse proxy keeps the
  start, the finish and a failure's stderr tail.
- Leaving opencode runs alive past the reverse proxy. They are its children and die with it, as
  the proxy's machines do; a cloud agent needs nothing here to go on.
- A `key` field in the `/agent` body. The key the caller must provide is the bearer every route
  of this process already requires; a second way to present it would be a second thing to check.
- A shape for a driving task. A Linear identifier's form is Linear's (`OLI-42` today, another
  team's key tomorrow), and `ctrl test run --ticket` accepts any non-empty string; the session id
  of a reviewer is ours (a uuid column) and is checked.
- An idempotency key on the Cursor create. Nothing retries; a caller that repeats a `/agent` POST
  gets a second agent, and the only key that could dedupe it would be the caller's.

- A health loop. A dead server costs one 10 s probe per start and per `GET /servers` until
  `DELETE /servers` forgets it; a loop that dropped servers on its own would turn a flapping host
  into lost placements.
- A capacity limit or a reservation. Two starts probing at once see the same `qemus` and may pick
  the same server; a booting machine is not counted until it is up.
- Retries anywhere. Nothing in the repository retries today.
- Stopping the machine whose route could not be written. Bounded by the server's ten-minute
  timeout.
- `/stats` on the reverse proxy.
- Servers registering themselves. Today a server is added by an operator, over the API or on the
  diagnostics page, and that is a known wart: a host that boots should be able to announce
  itself. It stays manual until the shape of that announcement (who tells whom, and what a
  server knows about its own public url) is decided; the page makes the manual step a visible
  one-click one meanwhile.
- `ctrl` and dashboard awareness of servers and routes. `ctrl session --logs` already shows the
  `routed; <url>` line for a session because the reverse proxy writes to `logs`.
- An in-memory route cache in front of the rows.
- Any token, style or script on the diagnostics page. It is loopback-only text for the operator
  at the keyboard, defended against the one cross-site trick a browser allows by the `Origin`
  check; a login would need a second secret and a browser flow, neither asked for.

## Running it

```sh
# on each host that boots machines
OLIGARCHY_TOKEN=… DATABASE_URL=… ./server --port 42069 --automation

# in front of them, on any host that reaches them and the database. The agent program is the
# config file's word: .reverse-proxy.oligarchy.json in the working directory (the committed one
# says opencode, which must be on PATH), or another file named with --config; cursor wants
# CURSOR_API_TOKEN and a route to Cursor's API instead.
OLIGARCHY_TOKEN=… DATABASE_URL=… ./reverse-proxy --port 42070 --diagnostics-port 55445
OLIGARCHY_TOKEN=… DATABASE_URL=… CURSOR_API_TOKEN=… ./reverse-proxy --config cursor.json

# register the hosts: on the page at http://127.0.0.1:55445/ (add box, delete buttons), or over
# the API; either way the reverse proxy probes each one's /stats first
curl -H "authorization: Bearer $OLIGARCHY_TOKEN" -H 'content-type: application/json' \
  -d '{"url":"https://qemu-a.example.com"}' http://127.0.0.1:42070/servers
curl -H "authorization: Bearer $OLIGARCHY_TOKEN" http://127.0.0.1:42070/servers

# clients point at the reverse proxy and change nothing else
./client start --server-url http://127.0.0.1:42070 --agent-id OLI-42 --iso https://…/omarchy.iso

# spawn the agent that drives a ticket, on the program's default model or one named as the
# program names it; the answer is the agent's link (cursor) or its session (opencode)
curl -H "authorization: Bearer $OLIGARCHY_TOKEN" -H 'content-type: application/json' \
  -d '{"task":"OLI-42","type":"driving-agent"}' http://127.0.0.1:42070/agent
curl -H "authorization: Bearer $OLIGARCHY_TOKEN" -H 'content-type: application/json' \
  -d '{"task":"<session uuid>","type":"diagnosing-agent","model":"anthropic/claude-opus-4","reasoning":"high"}' \
  http://127.0.0.1:42070/agent
```

The reverse proxy's stdout, like the server's, is the convenience copy; its rows in `logs` and its
Sentry reports are the record. The lines to know: `server registered; <url>`,
`server removed; <url>`, `server skipped; <reason>` (a warning during placement),
`routed; <url>` (attributed to the new session and its agent), `forward cut short; <reason>`,
`agent spawned; <type>; <task>; <model>; <where>` (attributed to the ticket as agent, or to the
session; `<where>` the agent's page or its session), under opencode `agent finished; <session>`
and `agent failed; <session>; exited <code>[: <stderr tail>]`, and `<METHOD> <url> failed:
<reason>` for every request it refused itself.
