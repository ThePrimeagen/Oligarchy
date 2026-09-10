# Server vs. reverse proxy

Two processes now share the wire contract a client speaks. This document says which one is
responsible for what, walks a request through both, and records what changed to add the second
one and why each decision went the way it did. `development.md` holds the conventions every
process follows and names the reverse proxy only where it taught one; what the reverse proxy
promises — its routes, texts, statuses and log lines — is pinned by its code and tests and
written out for operators here. A third party is named where it matters: the dashboard Worker
(`src/dashboard/`, Cloudflare, Hyperdrive), which is where stored screenshots and the fleet page
are served from.

| | The server (`./server`, `src/proxy/`) | The reverse proxy (`./reverse-proxy`, `src/reverse-proxy/`) |
| --- | --- | --- |
| One sentence | Boots and drives QEMU machines on one host | Sends each session's requests to the host that booted it |
| Owns | The machines, the sessions map, the QMP sockets, the session directories, its own `servers` row | The fleet (`servers`) and the routing table (`session_servers`) |
| Needs on its host | `qemu-system-x86_64`, `qemu-img`, OVMF, `/dev/kvm`, a display backend | Nothing but Node and a route to the database and the servers |
| Reads | `OLIGARCHY_TOKEN`, `DATABASE_URL` | The same two, through the same `ProxyConfig` |
| Default ports | `42069` | `42070` |
| Speaks to clients | `ProxyApi`: the 11 `Sessions` routes, `/stats` among them | The same `Sessions` routes minus `/stats`, plus `POST/DELETE/GET /servers` |
| Speaks to operators | Its `servers` row, rewritten every 30 s when started with `--url`; the dashboard shows it | Nothing beyond the API; the fleet page is the dashboard's |
| Speaks to | QEMU over QMP, the database | The servers over HTTP (their own `ProxyApi`), the database |
| Writes | `sessions`, `agent_runs`, `actions`, `images`, `debug_logs`, `logs`, its `servers` row | `servers`, `session_servers`, `logs` |
| Serves images | No: `GET /images/:id` is the catch-all's 404 | No: the same 404 |
| Background work | The 10 s timeout sweep, the cpu sampler, the 30 s heartbeat, the log drain | The log drain only |
| At shutdown | Drains every session (`aborted`, `proxy shutdown`); deletes its `servers` row | Nothing: the sessions are the servers' and the routes are rows |
| Sentry spans | `QEMU session`, the intent, `QMP <cmd>` | None; only error lines report |

## Responsibilities

### The server keeps everything it had, minus one route, plus its heartbeat

The server is unchanged in behaviour and on the wire but for one route: `GET /images/:id` is no
longer a proxy route. It is still the only process that knows a QEMU exists: it checks the host at
startup, prepares a session directory, listens on the QMP socket, spawns QEMU, records every
exchange as an `actions` row, stores screenshots in the `images` table, fans out the follow
stream, times sessions out after ten minutes, writes the debug log on every end but a succeeded
stop, and drains its machines when it is signalled. Its `Sessions` map is the truth for "what is
running here". A client may still talk to a server directly; nothing in this change requires the
reverse proxy.

Started with `--url <url>`, the server also announces itself: once its listener is up and every
thirty seconds after, it rewrites its own row in `servers` (keyed by that url) as a `qemu` server
with what `/stats` would answer, cut to what the fleet page shows — its qemu count, memory in use
and the cpu's one, two and three minute means — stamps `heartbeat_at` with the database's clock
and counts `generation` up by one. A shutdown deletes that row, so a process that left is gone from the
fleet and from placement. Every write is a ping: a generation that stops moving is a server that
stopped without deleting — killed, or it cannot reach the database (its own log then has the
`heartbeat failed` lines, and a delete that fails is `unannounce failed: <reason>`) — and the
dashboard says so either way. The url is the address the reverse proxy reaches the server at (a
tunnel's local port, say), which the server cannot see for itself, hence a flag and no default;
without it the server announces nothing and is not on the page, which is what a development
server wants. A heartbeat that fails is one `heartbeat failed: <reason>` error line, and the next
one runs. `/stats` carries the three means too (`cpu.mean1m`,
`mean2m`, `mean3m`, the newest 12, 24 and 36 of the sampler's 5 s samples beside `mean` over all
60); they are required fields of `Contract.Stats`, so a reverse proxy of this version treats an
older server's `/stats` as `answered 200 without stats` and skips it — deploy the servers before
the reverse proxy, after `npm run db:migrate`.

### The dashboard serves the images

A stored screenshot has one address, `https://oligarchy.trm.sh/images/<uuid>`
(`Contract.StoredImageUrl(id)`, the `x-image-url` header on `GET /image`, the `url` in
`ctrl session --images`). The Cloudflare Worker in `src/dashboard/` serves it over Hyperdrive
from the `images` table: a non-uuid or an unknown id is its 404, a query failure its 500. The
proxy used to serve the same bytes at its own `/images/:id` as v1 had; that copy is gone, so
neither the server nor the reverse proxy has an image route, and the path is the catch-all's 404
on both. One HTTP address; the only other reader of the bytes is `./session image`, straight
from the database.

### The dashboard serves the fleet page

`https://oligarchy.trm.sh/servers` is the fleet: the `servers` rows read over Hyperdrive, one
line per server with its url, `qemus`, memory as `used / total GB`, the cpu's `1m / 2m / 3m`
means, its `generation` and how long ago its heartbeat was, and a `delete` button; an add box
below. The table is swapped in fresh every thirty seconds (htmx, `GET /servers/fleet`), the
interval the servers write at, so a row is never more than one poll behind. A server whose
heartbeat is more than ninety seconds old — three missed — shows `silent` in place of its stats;
one an operator added that no server has claimed shows `never heard from`. Nothing on the page
probes a server: what it shows is what the servers said, and the reverse proxy is not involved.

`POST /servers` (form field `url`) adds a row under the same rule as the API (`url must be an http
or https url`, 400 otherwise, the reason on top of the page); `POST /servers/delete` removes one
(404 `<url> is not registered` when there is none). A server still running announces itself back
within thirty seconds of being deleted: the row is the server's word, the button is for the ones
that stopped without deleting. A database failure is a 500 page with `error: internal error` and no fleet
section, so it never claims an empty fleet. The page is unstyled text outside the dashboard's
shell and is served whole; access control is the dashboard's, not the page's.

### The reverse proxy knows where sessions live and nothing else

The reverse proxy holds no session state. It knows three things, all of them rows:

- Which servers exist, because a server announced itself (`./server --url`) or an operator
  registered it — on the dashboard, or over `POST /servers { url }`, where the reverse proxy
  checks the server answers `GET /stats` before remembering it as a `qemu` server. Every row has
  a `type`, and this reverse proxy fronts the `qemu` ones: it registers a server as one, and
  lists and places on those alone. Registering the same url twice is two probes and one row;
  `DELETE /servers` forgets a server without touching the sessions still running on it;
  `GET /servers` probes every `qemu` server at once and reports each one's stats, or `null` for
  one that did not answer.
- Where to put a new session: `POST /start` probes every registered `qemu` server at once, skips
  the ones that fail (a `server skipped; …` warning each), and places the start on the one with
  the fewest `qemus`, ties to the earliest registered. With no server registered the answer is 503
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

Every route may also answer 400 (a body or query the contract refuses), 401, 500 and 502 through
the `RouteBoundary` middleware; `GET /stats`, `GET /images/:id` and anything else unrouted is the
catch-all's 404 `{"error":"not found"}`, unlogged. The proxy's `/dump` was retired on master and
is not routed here either: an ended session's console is read from the database by `ctrl`.

The same fleet is on the dashboard's page (above); the reverse proxy serves no page of its own.

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
   lines). It reads the `qemu` rows of `servers`, probes each `GET /stats`, picks the fewest
   `qemus`, and POSTs the client's body text to that server's `/start`.
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

- `servers (url text primary key, type server_type not null default 'qemu', stats jsonb,
  generation bigint not null default 0, heartbeat_at timestamptz, created_at)`: the fleet. The
  primary key makes registration idempotent (`insert … on conflict do nothing`) and gives the
  heartbeat its upsert. `type` (`drizzle/0008_server_type.sql`) says what kind of server the row
  is, an enum with one value so far, `qemu`, so a reverse proxy can list its own kind and leave
  the rest; every writer names it — the reverse proxy's `POST /servers`, the dashboard's add box
  and the server's heartbeat all say `qemu` — and the default is what the migration filled the
  rows that predate the column with. The three columns after it came with the heartbeat
  (`drizzle/0006_server_heartbeat.sql`): `stats` is what the server last said of itself
  (`ServerStats` in `schema.ts`: qemus, memory total and used, the cpu's three means),
  `generation` counts its heartbeats, `heartbeat_at` is the database's clock at the last one.
  `stats` and `heartbeat_at` are null together, for a row an operator added that no server has
  claimed — the one absence the page must show as such.
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
  `Effect.fn("db.<name>")` over `Database.run` — `addServer` (a url and its type), `heartbeat`
  (a url, its type and its stats in one upsert: the row comes into being at generation 1 or is
  rewritten at `generation + 1`, its type the server's word, `heartbeat_at = now()` either way),
  `removeServer` (answers whether a row went, which `DELETE /servers` turns into its 404),
  `listServers` (the servers of one type, registration order), `routeSession`,
  `serverForSession` (an `Option`). The server's `main.ts` provides the store to its graph for
  the heartbeat alone.

### `src/reverse-proxy/router.ts`: the one service

`Router` is a `Context.Service` over `ServerStore`, `Log`, `HttpClient` and `ProxyConfig`, with
`register`, `unregister`, `servers`, `start` and `forward`. Decisions inside it:

- It fronts one kind of server, `qemu`: the probe is that server's `/stats` and the placement
  its `qemus`. `register` stores a url as a `qemu` server, and `servers` and `start` read the
  `qemu` rows alone, so a row of another kind is neither reported nor placed on. The kind is one
  constant in `router.ts`, so a second reverse proxy for a second kind is that constant and its
  own probe.
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

- The reverse proxy used to serve the fleet page itself, on a second loopback listener
  (`diagnostics.ts`, `--diagnostics-port`, default 55445), tokenless and defended against
  cross-site posts and DNS rebinding because its add box made the reverse proxy probe a url with
  the shared bearer. That page had to be reached through the reverse proxy's host, and what it
  showed was a probe made as it loaded. It is gone: the page is the dashboard's, read from the
  rows the servers write, and the reverse proxy has one listener again. What follows describes
  what is left.
- `handlers.ts` binds both groups. The session-driving routes are `uninterruptible`, for the
  proxy's own reason: a client that disconnects mid-`/start` must not tear the forward in half,
  or the routing table never learns of the machine the server booted. `follow` stays
  interruptible so an abandoned follower releases its upstream stream. The catch-all 404 is the
  proxy's `NotFoundRoute`, reused.
- `command.ts` is `makeReverseProxyCommand({ serve, serverFailed })` with one flag, `--port`
  (default 42070, one above the proxy so both run on a development host); `serve(port)` is the
  listener as a layer. Its startup is the proxy's minus the host check: parse, `database.ping`
  (`database unreachable: <detail>`), listen; a failure is the fatal line `reverse proxy:
  <detail>` and exit 1. About ten lines are duplicated from the proxy's command rather than
  shared; a helper for two callers was judged premature by the document's philosophy and by
  review.
- `main.ts` composes the graph as the proxy's does — `ServerStore` and `Log` over `LogStore`,
  `Database`, `ProxyConfig`, `SentryLive`, the config provider, the Node HTTP client and
  services — without `Qemu`, `Iso`, `Stats`, `Sessions` or a `Shutdown` reference, with the same
  `TracerDisabledWhen` so no `http.server` span reaches Sentry. It creates the `node:http` server
  so its `error` listener can complete `serverFailed`. The listen line is `oligarchy reverse proxy
  listening on 127.0.0.1:<port>`. Its teardown exits 1 on any failure but an interrupt and 0
  otherwise; it logs nothing at shutdown because nothing of its own is stopping.
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
- `test/dashboard/servers.unit.test.ts` renders the page's components from fixed rows, no
  database: a server heard from just now with every column, the empty fleet, the heartbeat's age
  in seconds, minutes, hours and days, a server silent at ninety-one seconds and not at ninety, a
  row never heard from, a url with `"` and `<` escaped in the cell and the delete form, the
  reason on top of a refused page, the fleet omitted on a 500 page, the reason escaped.
  `test/integration/dashboard.integration.test.ts` runs the routes against the container: the
  page and the fragment from seeded rows (alive, silent, never heard from), adding once however
  often posted, deleting, a url the rule refuses (400, nothing stored), a form without a url, a
  url never registered (404), and an unreachable database (500 on every route, the fleet section
  gone, never the password).
- `test/proxy/heartbeat.unit.test.ts` runs the loop under the `TestClock` over the fake
  `Sessions` and `ServerStore`: a write at once and every thirty seconds with the stats cut to
  the row's shape, the loop ending with its scope, the row deleted on that close (other servers
  left), a write in flight finishing before the delete, a refused write as one `heartbeat
  failed: <driver's reason>` line with the next tick still writing, a defect logged the same way,
  a refused delete as one `unannounce failed: <driver's reason>` line that still lets the scope
  close, a missing row not an error.
  `test/proxy/command.unit.test.ts` pins `--url` reaching the server, its absence as none, a url
  the rule refuses as a usage error touching nothing, and `--help` listing it.
  `test/qemu/stats.unit.test.ts` pins the three means over the newest 12, 24 and 36 samples.
- `test/reverse-proxy/command.unit.test.ts`: `--port` (its default and integer check),
  `--diagnostics-port` as the usage error it now is, `--help`, the ping failure, a server error
  after listen, a listen failure.
- `test/proxy/http.unit.test.ts` lost its `Images` describe and pins `GET /images/<uuid>` as the
  catch-all's unlogged 404; `test/shared/api.unit.test.ts` pins `ProxyApi` as the one `Sessions`
  group with the bearer on every endpoint.
- `test/shared/{errors,api,domain}.unit.test.ts`: the two codecs, the reflected api (paths,
  middleware order, per-endpoint statuses, `ProxyApi` without the reverse proxy's routes or
  boundary), `ServerUrl`.
- `test/integration/db.integration.test.ts`: `ServerStore` against the migrated database,
  including the primary key and foreign key refusals, and the heartbeat: a first write at
  generation 1 with its stats and stamp, a second counting up and rewriting, and one filling the
  row an operator added, still one row. The `type` column: every write lands as `qemu` and is
  listed as such, a row written without a type is a `qemu` server (the migration's default), and
  a value outside the enum is the database's refusal.
- `test/integration/reverse-proxy.integration.test.ts`: the black-box process — `--help`, a
  bad `--port`, a missing token, an unreachable database (this one needs neither QEMU nor Docker,
  so it always runs), an occupied port, and serving (`GET /servers` empty, a dead server refused
  with 502 over the API, 401, 404 for `/stats` and `/images/:id`, 503 for a start with no server,
  exit 0 on SIGINT and SIGTERM). It empties the fleet table through the `Database` service before
  it starts, because the integration files share one database.
- `test/support/stores.ts` gained `fakeServerStore`, which records heartbeats too;
  `test/support/postgres.ts` provides `ServerStore` in the migrated layer.

### `development.md`

That document owns conventions, not contracts, so the reverse proxy appears there only where it
taught one: a second `HttpApi` is built from the first's endpoint values; an error only the second
raises gets its codec on a second boundary tag over one implementation; a pass-through handler
decodes nothing of the upstream answer; an operator's page belongs to the dashboard, read from
rows a process writes on a schedule; the Toolchain, Layout, Core rules, Sentry, Runtime entry and
Tests sections name the reverse proxy in their inventories. Everything the reverse proxy promises
is in this document and pinned by its tests.

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

## Deliberately not done

Each of these was considered and left for a need to show itself, per "support only what is
used":

- A health loop. A dead server costs one 10 s probe per start and per `GET /servers` until
  `DELETE /servers` forgets it; a loop that dropped servers on its own would turn a flapping host
  into lost placements.
- A capacity limit or a reservation. Two starts probing at once see the same `qemus` and may pick
  the same server; a booting machine is not counted until it is up.
- Retries anywhere. Nothing in the repository retries today.
- Stopping the machine whose route could not be written. Bounded by the server's ten-minute
  timeout.
- `/stats` on the reverse proxy.
- Placement from the heartbeat rows instead of a live probe. The rows are at most thirty seconds
  old and would spare `/start` its probes, but a probe answers "is it there now", which is the
  question a placement asks; the rows answer the operator's "what has it been doing".
- Dropping a silent server from placement on its own. The page shows it; deleting it is the
  operator's call, for the reason the health loop above is not done.
- `ctrl` awareness of servers and routes. `ctrl session --logs` already shows the
  `routed; <url>` line for a session because the reverse proxy writes to `logs`.
- An in-memory route cache in front of the rows.
- Any style or script on the fleet page beyond the poll, or a check of its own on who posts to
  it: access is the dashboard's to control, and a forged add or delete is a row the next
  heartbeat corrects.

## Running it

```sh
# on each host that boots machines; --url is the address the reverse proxy reaches it at, and
# the server announces itself under it every 30 s (leave it off and the server stays out of the fleet)
OLIGARCHY_TOKEN=… DATABASE_URL=… ./server --port 42069 --automation --url https://qemu-a.example.com

# in front of them, on any host that reaches them and the database
OLIGARCHY_TOKEN=… DATABASE_URL=… ./reverse-proxy --port 42070

# the fleet: https://oligarchy.trm.sh/servers, polled every 30 s, with an add box and a delete
# button each. A server may also be registered over the API, which probes its /stats first
curl -H "authorization: Bearer $OLIGARCHY_TOKEN" -H 'content-type: application/json' \
  -d '{"url":"https://qemu-a.example.com"}' http://127.0.0.1:42070/servers
curl -H "authorization: Bearer $OLIGARCHY_TOKEN" http://127.0.0.1:42070/servers

# clients point at the reverse proxy and change nothing else
./client start --server-url http://127.0.0.1:42070 --agent-id OLI-42 --iso https://…/omarchy.iso
```

The reverse proxy's stdout, like the server's, is the convenience copy; its rows in `logs` and its
Sentry reports are the record. The lines to know: `server registered; <url>`,
`server removed; <url>`, `server skipped; <reason>` (a warning during placement),
`routed; <url>` (attributed to the new session and its agent), `forward cut short; <reason>`, and
`<METHOD> <url> failed: <reason>` for every request it refused itself. On a server started with
`--url`, the listen line ends `; announcing <url>` and a heartbeat that could not be written is
`heartbeat failed: <reason>`. A shutdown deletes the row; a delete that could not be written is
`unannounce failed: <reason>`.
