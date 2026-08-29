# Oligarchy how-to

`oligarchy` talks to a running `oligarchy-server`. Start the daemon first, then attach a named session to a QMP socket.

```bash
./oligarchy-server
./oligarchy start
./oligarchy start omarchy.iso
./oligarchy start omarchy.iso qemu-img.qcow2
```

The client defaults to `127.0.0.1:42069`. Override with `OLIGARCHY_ADDR`.

## Get an image

Captures the current guest desktop as a PNG.

```bash
# write to a file
./oligarchy get-image omarchy -o desktop.png

# write PNG bytes to stdout
./oligarchy get-image omarchy > desktop.png
```

`-o` can sit before or after the session name.

## Send keys

```bash
./oligarchy send-keys omarchy "hello"
./oligarchy send-keys omarchy "hello<ENTER>"
./oligarchy send-keys omarchy "<C-c>"
```

The key string uses the `oligarchy` encoding (that name is optional; it is the default):

```bash
./oligarchy send-keys omarchy "Hi<ENTER>" oligarchy
```

### Encoding

- Type letters as written. `A` sends shift+a. You do not add a shift key yourself.
- Wrap special keys in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.
- Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. Combine them: `<C-S-c>`.
- `<` and `>` as characters: `<LT>` and `<GT>`.

Quote the key string so the shell does not eat `<`, `>`, or spaces.
