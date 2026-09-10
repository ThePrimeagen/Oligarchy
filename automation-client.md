# Automation client

Consult this table of contents first. Read only the section you need.

| Section | Line |
|---------|-----:|
| [Synopsis](#synopsis) | 16 |
| [Variables](#variables) | 32 |
| [POST /run](#post-run) | 42 |
| [The fleet row](#the-fleet-row) | 62 |

## Synopsis

```
./automation-client [--port <n>] [--url <url>]
```

One process per host. It listens for `POST /run`, runs one agent prompt to completion per call (`opencode run` on this host), and can announce itself to the fleet as an `automation` server so the dispatch loop in `./automation-server` can place on it.

- `--port <n>` — listen port. Default `42071`. Exact; never probed.
- `--url <url>` — the address the fleet reaches this process at, an `http` or `https` URL. Without it the process announces nothing, stays off the dashboard, and no dispatcher places on it.
- `opencode` must be on `PATH`. Missing is fatal: `automation-client: missing host requirements:` then `opencode not on PATH`.
- The database is pinged before listen. Unreachable is fatal: `automation-client: database unreachable: <reason>`.

`./automation-client --help` prints the flags. SIGINT and SIGTERM interrupt in-flight runs, delete the fleet row when one was announced, and exit 0.

## Variables

Read from the environment, then `.env` in the working directory for any that are unset. An empty value counts as unset. Reported in this order when missing:

- `OLIGARCHY_TOKEN` — bearer on every `/run`. Compared exactly.
- `DATABASE_URL` — the control-plane database: this process's heartbeat row and its log rows. Nothing else.

How `opencode` authenticates to its model provider is the host's; this process neither reads nor forwards a provider credential.

## POST /run

```
POST /run
Authorization: Bearer <OLIGARCHY_TOKEN>
{ "key": "OLI-45", "prompt": "<text>" }
```

`key` is the Linear ticket: attribution only (`location = automation-OLI-45`, `agentId = OLI-45`). The prompt is handed to the agent unread. A 200 is `{ model, session, text, elapsedMs }`. A missing or wrong bearer is 401 `{ "error": "unauthorized" }`. An empty key or prompt is 400. An agent that did not finish is 502 `{ "error": "opencode: …" }`. An agent still going at two hours is 504. `/linear`, `/stats`, `/start` and `GET /run` are 404 `{ "error": "not found" }`.

A caller that drops the connection interrupts the run; the child is killed (SIGTERM, then SIGKILL after five seconds) and the scratch directory is removed.

## The fleet row

With `--url`, a `servers` row is written now and every thirty seconds: `type = 'automation'`, `agents` (how many runs are live), host memory and cpu. Shutdown deletes it. The dashboard's automation half lists these as Clients.
