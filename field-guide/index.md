# Field guide

The entry point for working on this repo. Start here, then follow the link you need.

- [Philosophy](philosophy.md) — how code is written here: simple, small surface, no unneeded guards.
- [The CLI](cli.md) — what `src/qemu/cli.ts` does and why, command by command.
- [The HTTP API](http-api.md) — the control-plane contract every client and server here shares.
- [The cloud client](cloud.md) — the three-verb Cursor SDK wrapper: `start`, `prompt`, `stop`. Interface spec; implementation pending.
- [Key encoding how-to](how-to.md) — the `oligarchy` key-string encoding used by `send-keys`.
- [Agent rules](../AGENTS.md) — vocabulary and hard TypeScript rules.
