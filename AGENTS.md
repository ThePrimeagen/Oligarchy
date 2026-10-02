Two kinds of agent work here.

- A developing agent changes the code. Read [development.md](development.md). A UI test asserts
  business logic only. Never add a presentational test: one that fails because a font, a size, a
  color, spacing, CSS, an icon, or the visual order of page chrome changed. Those test nothing
  real. What a page shows, what a search finds, and what a control does are the logic. Finding,
  including a fuzzy search, gets a couple of unit tests, not a markup snapshot.
- A driving agent uses `./client` to drive a guest and `./ctrl` to record the result for a task given
  in Linear. It never reads or changes code. Read [client.md](client.md) and
  [ctrl.md](ctrl.md); their first lines are a table of contents, consult that first.

## Cursor Cloud specific instructions

`.cursor/install.sh` installs Bun 1.4.2 onto `/usr/local/bin`, plus QEMU, OVMF, and PostgreSQL, then runs `bun install --frozen-lockfile`. `.cursor/start.sh` starts PostgreSQL, applies `bun run db:migrate` to the local database, and runs `./qemu-server` on `127.0.0.1:42069` in the tmux session `qemu-server` (`--automation --max-jobs 2 --name qemu-dev`). That process is pinned to the local database (`postgres://ubuntu@localhost/oligarchy` over the Unix socket, peer auth) even when `DATABASE_URL` is already set. When `OLIGARCHY_TOKEN` is unset, start writes `OLIGARCHY_TOKEN=local-dev` into `.env`. `GET /stats` with the effective bearer is the server's health check. `bun run check:fast` is the lint, format, type, and unit-test gate and does not need the database. `/dev/kvm` is made writable when it exists; without it the qemu server does not start.
