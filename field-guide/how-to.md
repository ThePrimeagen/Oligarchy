# Oligarchy how-to

The CLI talks to a running proxy (`src/qemu/proxy.ts`). Start the proxy first, then boot a session and drive it by the id `start` prints.

```bash
node --experimental-strip-types src/qemu/proxy.ts omarchy.iso
node --experimental-strip-types src/qemu/cli.ts start
node --experimental-strip-types src/qemu/cli.ts start --iso omarchy.iso --disk qemu-img.qcow2
```

Both default to `127.0.0.1:42069`. Override with `OLIGARCHY_ADDR`.

## Get an image

Captures the current guest desktop as a PNG.

```bash
# write to a file
node --experimental-strip-types src/qemu/cli.ts get-image <id> -o desktop.png

# write PNG bytes to stdout
node --experimental-strip-types src/qemu/cli.ts get-image <id> > desktop.png
```

`-o` can sit before or after the session id.

## Send keys

```bash
node --experimental-strip-types src/qemu/cli.ts send-keys <id> "hello"
node --experimental-strip-types src/qemu/cli.ts send-keys <id> "hello<ENTER>"
node --experimental-strip-types src/qemu/cli.ts send-keys <id> "<C-c>"
```

The key string uses the `oligarchy` encoding (that name is optional; it is the default):

```bash
node --experimental-strip-types src/qemu/cli.ts send-keys <id> "Hi<ENTER>" oligarchy
```

### Encoding

- Type letters as written. `A` sends shift+a. You do not add a shift key yourself.
- Wrap special keys in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.
- Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. Combine them: `<C-S-c>`.
- `<` and `>` as characters: `<LT>` and `<GT>`.

Quote the key string so the shell does not eat `<`, `>`, or spaces.
