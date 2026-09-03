# The wrapper (`src/qemu/wrapper.ts`)

`./server <port> [flags]` runs the wrapper, not the proxy. The wrapper is a small reverse proxy that owns the public port, spawns the proxy (`src/qemu/proxy.ts`) as a child on a loopback port of its own, and passes every request through. Its job is unattended, zero-downtime rollouts: every 30 minutes it pulls, and when HEAD moved it boots a proxy from the new code, sends new sessions there, and lets the old proxy finish its sessions before stopping it. A running QEMU never dies for a deploy.

## Processes

- The wrapper binds `OLIGARCHY_ADDR` (`./server <port>` sets `127.0.0.1:<port>`; port `0` picks a free one and the `listening on` line names it). Every backend is `node --experimental-strip-types src/qemu/proxy.ts <the wrapper's own flags, verbatim>` with `OLIGARCHY_ADDR=127.0.0.1:<free port>`. The wrapper does not parse `--display` or `--automation`; the proxy does, and if it refuses them the first backend fails and the wrapper exits 1 with the proxy's message — the same boot failure as before for bad flags, a missing `DATABASE_URL`, or a missing qemu.
- Backends inherit the wrapper's stdio, so proxy log lines look exactly as before; the wrapper's own lines start with `wrapper:` and name each backend as `backend 127.0.0.1:<port> (pid <pid>, <commit>)`. Backends are detached into their own process group, so the wrapper is the only thing that signals them: a closing terminal SIGHUPs the wrapper, which forwards a SIGTERM, and the proxies never see the SIGHUP they have no handler for.
- A backend is ready when `GET /stats` on its port answers 200. Sixty seconds without that, or the process exiting first, is a failed start; a candidate that never answered is SIGKILLed.
- The repo is the checkout the wrapper was loaded from. It must be a git checkout with an upstream branch: `git rev-parse HEAD` failing is a startup failure, and a `git pull` failing is an error line on every tick.

## Routing

- `POST /start` goes to the current backend; a 200 records `id → backend`.
- Everything else goes to the backend that owns the session named by body `id` (POST) or query `id` (GET), else to the current backend. The wrapper never answers for a session itself: an unknown id reaches the current proxy, which answers its own `404 unknown session`. A `/stop` that returns 200 forgets the id. An id whose proxy timed it out keeps routing to that proxy and gets the real 404 until the backend exits, which drops every id it owned.
- `GET /stats` is the one thing the wrapper answers itself: it asks every live backend and returns one body with `qemus` summed across all of them, so the count is the host's, draining machines included. One backend going silent for 5 seconds is a 502.
- Nothing to route to — the current backend died and its replacement is not up — is `503 {"error": "no backend is running"}`; sessions on a draining backend keep working through it.
- Bodies are buffered (they are small JSON; 1 MiB is a 413) and forwarded byte for byte; responses stream, except a `/start` answer, which is read whole to learn the id before it is passed on. Hop-by-hop headers are dropped and `host` rewritten. No timeout: `/start` legitimately takes as long as its ISO download and boot. A client that disconnects does not abort the upstream request — the proxy's routes are uninterruptible anyway, and the wrapper still needs the `/start` answer to learn the id.
- A backend that resets the connection is `502 {"error": "backend 127.0.0.1:<port> (pid <pid>, <commit>): <reason>"}`; if the response had already started, the client connection is dropped.

## Rolling

Every 30 minutes, and at once on `SIGUSR2` (`kill -USR2 <wrapper pid>` after pushing; the pid is on the `listening` line):

1. `git pull --ff-only`, with `GIT_TERMINAL_PROMPT=0` so a credential prompt fails instead of hanging, killed after 5 minutes. A failure is an error line and a Sentry event, but the check goes on, so a pull done by hand still rolls.
2. HEAD equal to the current backend's commit is `up to date`. Done.
3. A range that touches `package-lock.json`, `drizzle/`, or `src/qemu/wrapper.ts` is refused: a roll swaps proxy processes and nothing else, and those need `npm ci`, `npm run db:migrate`, or a new wrapper process. The refusal is an error line on every tick until the wrapper is restarted after the install.
4. Otherwise a backend boots at HEAD. Ready, and it becomes current while the old one is `draining`. Not ready, and `roll ... failed` leaves the old backend current; the next tick tries again, so a broken commit is retried every 30 minutes until a fix lands and rolls by itself.

Draining backends are checked every 10 seconds: `qemus` of 0 on their `/stats` and no request in flight through the wrapper means SIGTERM. Both halves matter — a `/start` still booting there has not reached the proxy's session map yet, and a `/stop` leaves that map before it answers. A stopped proxy with no sessions exits 0 in a second or two, logged as `exited 0`. One still running 30 seconds after the SIGTERM (a proxy stuck flushing its last log lines to a database that is not answering) has its process group SIGKILLed instead, at shutdown too.

The refusal in step 3 compares against the commit last deployed, not the backend currently serving, so it holds while the wrapper is recovering from a crash with no current backend.

## Failures

- A current backend exiting on its own is an error line and Sentry event naming the sessions lost. Its process group is SIGKILLed — its QEMUs share the group, and a proxy that died hard never stopped them — requests get 503, and the wrapper runs the update check at once, which boots a backend from HEAD. That immediate restart happens once per commit; a backend that keeps dying waits for the next tick instead of looping.
- A draining backend exiting on its own is the same error line; its ids are dropped.
- `SIGINT`, `SIGTERM`, `SIGHUP`: stop the timers and the listener, SIGTERM every backend (each aborts its sessions with `proxy shutdown`, as before), wait for them, exit 0 — or 1 if a backend exited non-zero or the wrapper is going down on its own fatal (the public port taken, the first backend failing). A second signal SIGKILLs every backend's process group and exits 1.
- The wrapper has no database connection: its lines go to stdout, stderr, and Sentry, not the logs table.

## What the wrapper knows about the proxy

Three facts, all in [http-api.md](http-api.md): `POST /start` answers `{"id"}`; `GET /stats` answers `{"qemus"}` with the proxy's live session count; every session request names its session as body `id` or query `id`. The wrapper itself is never rolled, so changing any of them needs a wrapper restart — which is why `src/qemu/wrapper.ts` is on the refuse list.

## Testing

`src/qemu/wrapper.test.ts` runs the real wrapper from a fixture git repo: a bare origin, a clone the test commits to and pushes from, and a clone the wrapper runs in, where `src/qemu/proxy.ts` is a stub proxy that speaks the three facts above and tags every answer with `x-backend: <version>`. Tests drive it over HTTP and `SIGUSR2` and read its log lines. Nothing in the wrapper exists for the tests; the fixture is the knob.
