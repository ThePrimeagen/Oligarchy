# Development

Check the field guide: [field-guide/index.md](field-guide/index.md).

## Host

The proxy needs `qemu-system-x86_64`, `qemu-img`, and OVMF at `/usr/share/edk2/x64/OVMF_CODE.4m.fd` and `OVMF_VARS.4m.fd`. `--display gtk` also needs `DISPLAY` and a QEMU build that lists gtk; `egl-headless` needs a DRM render node under `/dev/dri`. The proxy checks what it is about to use at startup and exits 1 with the missing list. There is no setup script.

`./server` runs the proxy behind the [wrapper](field-guide/wrapper.md), which needs `git` and a checkout whose branch tracks an upstream it can `git pull --ff-only` from without a prompt. A change to `package-lock.json`, `drizzle/`, or `src/qemu/wrapper.ts` is not rolled: run `npm ci` and `npm run db:migrate`, then restart the wrapper.

## Vocabulary

- When the user says "Kemu" (a speech-to-text rendering), they always mean QEMU. Read any such spelling as QEMU.
- When the user asks for a "DTS" (a `.d.ts`), they are asking for the module's exported interface: every type and function the module creates and exports, written as bare declarations, so the program can be understood from that surface alone. Never include imports in a DTS — not for any reason. A type that comes from a dependency stays opaque, with a comment naming what it is underneath.

## TypeScript

- We do not use classes. Never write a class. Use a functional style instead: plain state objects created by factory functions, operated on by standalone functions that take the state object as their first argument.
- Use the TypeScript `private` modifier for private class members and methods. Never use JavaScript private identifiers (`#name`). TypeScript `private` works good enough.

## Database

- Every database query and mutation must use Drizzle. Never call a database driver's query API directly or introduce another ORM or query builder. Database drivers are transports passed to Drizzle, nothing more.

## Comments

- Do not write comments. Code says what it does; a comment restating it is noise. This covers doc comments, file headers, and narration of any kind.
- The one exception is a genuinely tricky edge case whose intent cannot live in the code: an upstream bug worked around, an ordering that correctness depends on, a deliberate race, a magic number's meaning. One or two lines naming the constraint, nothing more.

## Tests

- Do not add tests unless explicitly told to.

## Review

Before a change ships, spawn a GPT-5.6 Sol subagent (`gpt-5.6-sol-high`) to review it. Give it the repo path, where to find the diff, a summary of the request being made, and this prompt verbatim:

> Thoroughly review the change being proposed and understand the request being made. All changes must strive for simplicity and correctness. All errors must be handled, but we do not want unneeded abstractions or excessive code. No normalization functions. Instead, it should just be straightforward, good programming: simple checks, guard statements where they're needed, asserts for conditions that shall not exist in our application.

Findings that add guards or ceremony get declined with the reason stated, per the [philosophy](field-guide/philosophy.md).

## Migrations

- The database schema lives in `src/db/schema.ts`. Migrations under `drizzle/` are generated from it with `npm run db:generate` — never written or edited by hand.
- Migrations are append-only. Never edit, delete, or rename anything under `drizzle/` — not the `.sql` files, not the `meta/` snapshots. To change the schema, edit `src/db/schema.ts` and generate a new migration. The one exception is `drizzle/meta/_journal.json`, which the generator itself appends to.
- CI enforces both rules: an edited migration fails the build, and so does a schema that does not match the committed migrations.
