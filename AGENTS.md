# Agent rules

Check the field guide: [field-guide/index.md](field-guide/index.md).

## Vocabulary

- When the user says "Kemu" (a speech-to-text rendering), they always mean QEMU. Read any such spelling as QEMU.

## TypeScript

- We do not use classes. Never write a class. Use a functional style instead: plain state objects created by factory functions, operated on by standalone functions that take the state object as their first argument.
- Use the TypeScript `private` modifier for private class members and methods. Never use JavaScript private identifiers (`#name`). TypeScript `private` works good enough.

## Review

Before a change ships, spawn a GPT-5.6 Sol subagent (`gpt-5.6-sol-high`) to review it. Give it the repo path, where to find the diff, a summary of the request being made, and this prompt verbatim:

> Thoroughly review the change being proposed and understand the request being made. All changes must strive for simplicity and correctness. All errors must be handled, but we do not want unneeded abstractions or excessive code. No normalization functions. Instead, it should just be straightforward, good programming: simple checks, guard statements where they're needed, asserts for conditions that shall not exist in our application.

Findings that add guards or ceremony get declined with the reason stated, per the [philosophy](field-guide/philosophy.md).

## Migrations

- The database schema lives in `src/db/schema.ts`. Migrations under `drizzle/` are generated from it with `npm run db:generate` — never written or edited by hand.
- Migrations are append-only. Never edit, delete, or rename anything under `drizzle/` — not the `.sql` files, not the `meta/` snapshots. To change the schema, edit `src/db/schema.ts` and generate a new migration. The one exception is `drizzle/meta/_journal.json`, which the generator itself appends to.
- CI enforces both rules: an edited migration fails the build, and so does a schema that does not match the committed migrations.
