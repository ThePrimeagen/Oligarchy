# Field guide

The entry point for working on this repo. Start here, then follow the link you need.

- [Philosophy](philosophy.md) — how code is written here: simple, small surface, every real error handled, no unneeded guards.
- [The CLI](cli.md) — what `src/qemu/cli.ts` does and why, command by command.
- [The HTTP API](http-api.md) — the control-plane contract between the CLI and the proxy.
- [The database](database.md) — the PlanetScale Postgres record of every session, and the `src/db/ops.ts` interface to it.
- [Key encoding how-to](how-to.md) — the `oligarchy` key-string encoding used by `send-keys`.
- [Agent rules](../AGENTS.md) — vocabulary and hard TypeScript rules.
