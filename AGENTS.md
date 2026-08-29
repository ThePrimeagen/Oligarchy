# Agent rules

## Vocabulary

- When the user says "Kemu" (a speech-to-text rendering), they always mean QEMU. Read any such spelling as QEMU.

## TypeScript

- We do not use classes. Never write a class. Use a functional style instead: plain state objects created by factory functions, operated on by standalone functions that take the state object as their first argument.
- Use the TypeScript `private` modifier for private class members and methods. Never use JavaScript private identifiers (`#name`). TypeScript `private` works good enough.
