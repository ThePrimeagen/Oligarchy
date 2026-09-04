# Philosophy

Durable preferences for how code is written in this repo. They come from the maintainer; when they conflict with generic best practice, they win.

## Simple, straightforward code

Optimize for the person reading the file top to bottom. A function should be inspectable in one pass: read it, know what it does. This is explicitly not "Clean Code" — no Uncle Bob. No tiny single-use helpers, no layers, no interfaces with one implementation, no abstraction bought before it is needed. A little repetition is fine when it keeps each site readable on its own.

`src/client/` is the reference example: `index.ts` is a `switch` over the action name, each action is one file under `actions/` that declares its flags, derives its arg type from them, calls `parseClientArgs` on its first line, and then does its one thing with plain `async`/`await`; the HTTP helpers (`postJSON`, `getBytes`, `postStart`) sit in `http.ts`; nothing else. `src/ctrl/` has the identical shape. Argument parsing is Effect's CLI (`Command`, `Flag`, `Argument`) inside `parse-args.ts` — not a hand-rolled flag package — and that file is the only place Effect's runtime is invoked.

## Support only what is used

Expose the smallest surface that does the job, even when the layer below supports more. The qemu client (`src/qemu/client.ts`) supports memory, SMP, disk size, and firmware paths; the proxy's `/start` and the CLI expose only `iso` and `disk`, because those are the only two anyone needs — and the ISO mostly for debugging. Fewer options is a feature. Do not add a flag because the field exists.

The same rule applies to output. When asked for a number, return the number — not everything the system could tell you. `/stats` answers "how many qemus, how much memory, what is the cpu doing" and nothing else; its first draft inventoried the distro, probed for KVM, parsed `/proc/meminfo`, and scanned the process table, and every one of those was deleted.

## No unneeded guard clauses

Trust the contracts of our own components. If a failure cannot happen given the contract, do not write code for it; if bad input already fails naturally with a clear error, let it. Validate only at real boundaries.

Guards this repo deliberately does not have:

- `start` trusts that a 200 from `/start` carries `{"id": ...}`; it does not re-validate our own server's response shape.
- `apiError` parses `{"error": ...}` in one try/catch. A malformed error body from our own servers is not a case worth code.
- The `catch` in each `index.ts` casts to `Error` because everything thrown below it is one. There is no branch for non-`Error` throws.
- The cpu sampler's baseline is not nullable. It is established at construction; there is no universe where the sampler exists without it, and the type says so. Do not soften a construction-time requirement into a `| null` union to survive a failure that cannot happen.
- Utilization has no 0–100 clamp: monotonic counters over an identical core set cannot leave that range. A clamp that cannot fire is noise.

A guard that stays must name the real event it answers. The sampler skips a delta when the core count changed between snapshots because cpu hotplug genuinely happens on VMs — and the comment says exactly that.

## Handle every real error

The other half of the guards rule: anything that can actually fail at runtime is handled deliberately, and a failure never takes down more than the operation it belongs to.

- Guard the boundaries that keep the process alive, even against errors you cannot name today. The HTTP handler has a catch-all; so does every timer callback, because an uncaught throw inside `setInterval` kills the whole server. Catch, log to stderr, let the next tick recover.
- Sequence output so the error path stays usable. The proxy serializes a response before writing the status line: a throw after headers are sent can no longer become a clean error reply.
- Startup requirements fail at startup. If the process cannot do its job, dying loudly at boot beats limping into requests.

## Owned state is the source of truth

Never rediscover from the environment what the program already knows by reference. The proxy booted every session it manages, so "how many qemus are running" is the size of its own sessions map — not the `/proc` scan that was written first and deleted. Discovery is worse on every axis: it adds failure modes, it counts things that are not yours, and it drifts from what the code actually controls.

## Nulls are a tax on every consumer

A nullable field forces a branch on everyone, forever. Do not spend that to represent a state that barely exists: the cpu window is empty only for the first seconds of uptime, so its fields are plain numbers that report 0, not `number | null`. Reserve null for an absence a consumer genuinely must distinguish and act on — never as a way to dodge choosing the natural default.

## Background work lives and dies with the server

A loop or timer that runs for the life of the process owes three guarantees: it never keeps the process alive (`unref` it), it never brings the process down (its tick is guarded), and its state is bounded (a rolling window, never an array that only grows). The cpu sampler in `src/qemu/stats.ts` is the shape to copy.

## No normalization functions

No generic parsing or normalizing machinery where direct expressions do the job. CLI args go through Effect's `Command` / `Flag` / `Argument` at the process boundary; do not re-implement a flag package beside it.

## Keep what earns its place

Simplicity is not deleting necessary behavior. Things that stay, and why:

- Paths sent to the server are absolutized: the server runs in a different working directory.
- The CLI stats the ISO before calling the server: the client-side error is immediate and names the real path.
- The `catch` in `index.ts` unwraps `fetch`'s `cause`: without it, a refused connection prints only "fetch failed".
- Comments exist only where the intent is invisible in the code — e.g. why `start` omits the `disk` key from its JSON instead of sending an empty string.
- A constant carries its meaning when its name and value cannot: `MAX_SAMPLES = 60` says "60 samples × 5s ticks = a 5 minute window", because "five minutes" appears nowhere else in the code.

## Porting: the reference implementation is the spec

When a component mirrors another, the reference's observable behavior beats general convention. The client was ported from a since-deleted Go client, and later split into one file per action. Parse and command failures exit 1. The user-facing interface may deliberately diverge — the Go client took positionals, this client takes `--iso`/`--disk` and puts the action first — but wire behavior must match the server exactly.

## Tests

We do not do test-first. Tests are not the default deliverable of a change, they are never written ahead of the implementation, and production code is never reshaped to make testing easier — no exported factories, no injected dependencies, no main-file surgery whose only customer is a test. If code would have to change shape before it can be tested, skip the test, not the shape.

The default verification is running the real thing: boot the server, hit the endpoint, read the output. Disposable harnesses beat committed scaffolding — the CLI was verified against a throwaway stub server, the stats endpoint by curling a live proxy while a core was pinned. Committed test files exist only where the maintainer asked for them (`src/qemu/keys.test.ts`, `src/qmp/json-stream.test.ts`); when tests are requested, they cover both the happy and the unhappy path.

## Style

- No classes, ever. Factory functions returning plain state objects, operated on by standalone functions. See [development.md](../development.md).
- Executables are main files, not libraries: they run top level and export nothing (`src/client/index.ts`, `src/ctrl/index.ts`, `src/qemu/proxy.ts`). The action files they dispatch to export their `<action>Run` and nothing they do not need to.
- Changes get a review pass against this document's bar. Review suggestions that add guards or ceremony get declined, with the reason stated. Machine reviews are held to the same bar as the code they review: a reviewer that introduces nullable state for impossible failures, or strips the comments that carry design intent, gets that half of its diff reverted.
