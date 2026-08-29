# Philosophy

Durable preferences for how code is written in this repo. They come from the maintainer; when they conflict with generic best practice, they win.

## Simple, straightforward code

Optimize for the person reading the file top to bottom. A function should be inspectable in one pass: read it, know what it does. This is explicitly not "Clean Code" — no Uncle Bob. No tiny single-use helpers, no layers, no interfaces with one implementation, no abstraction bought before it is needed. A little repetition is fine when it keeps each site readable on its own.

`src/qemu/cli.ts` is the reference example: one main file, one function per command, three small shared helpers (`postJSON`, `readAPIError`, `errorMessage`), nothing else.

## Support only what is used

Expose the smallest surface that does the job, even when the layer below supports more. The server's `/start` accepts memory, SMP, disk size, and firmware paths; the CLI takes only `--iso` and `--disk`, because those are the only two anyone needs — and the ISO mostly for debugging. Fewer options is a feature. Do not add a flag because the field exists.

## No unneeded guard clauses

Trust the contracts of our own components. If a failure cannot happen given the contract, do not write code for it; if bad input already fails naturally with a clear error, let it. Validate only at real boundaries.

Guards this repo deliberately does not have:

- `cmdStart` trusts that a 200 from `/start` carries `{"id": ...}`; it does not re-validate our own server's response shape.
- `readAPIError` parses `{"error": ...}` in one try/catch. A malformed error body from our own servers is not a case worth code.
- `errorMessage` casts to `Error` because everything thrown in the file is one. There is no branch for non-`Error` throws.

## No normalization functions

No generic parsing or normalizing machinery where direct expressions do the job. State the accepted input directly: `cmdGetImage` lists its three valid argument forms as three conditions; `cmdStart` reads its arguments as literal `--flag value` pairs. An earlier version of the CLI re-implemented Go's `flag` package semantics — fifty lines of parser for two flags. It was deleted. Do not bring it back.

## Keep what earns its place

Simplicity is not deleting necessary behavior. Things that stay, and why:

- Paths sent to the server are absolutized: the server runs in a different working directory.
- The CLI stats the ISO before calling the server: the client-side error is immediate and names the real path.
- `errorMessage` unwraps `fetch`'s `cause`: without it, a refused connection prints only "fetch failed".
- Comments exist only where the intent is invisible in the code — e.g. why `start` omits the `disk` key from its JSON instead of sending an empty string.

## Porting: the reference implementation is the spec

When a component mirrors another (the TypeScript CLI fills the Go client's role), the reference's observable behavior beats general convention: the CLI exits 1 on per-command usage errors because the Go client does, even though exit 2 is the more common convention. The user-facing interface may deliberately diverge — the Go client takes positionals, this CLI takes `--iso`/`--disk` — but wire behavior must match the servers exactly.

## Tests

The default discipline: tests are written first, before implementation, and every feature covers both the happy and the unhappy path. Plan the tests before the code. Deviating requires explicit maintainer instruction — the CLI has no test files by request and was verified with a disposable stub-server harness instead.

## Style

- No classes, ever. Factory functions returning plain state objects, operated on by standalone functions. See [AGENTS.md](../AGENTS.md).
- Executables are main files, not libraries: they run top level and export nothing (`src/qemu/cli.ts`, `src/qemu/proxy.ts`).
- Changes get a review pass against this document's bar. Review suggestions that add guards or ceremony get declined, with the reason stated.
