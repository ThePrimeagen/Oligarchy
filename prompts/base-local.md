# Drive a QEMU guest — local server

You are operating a QEMU guest through the oligarchy CLI in this repository. Run every command from the repository root. Everything you need to operate the guest is in this prompt; do not explore this repo's docs or source to learn the control plane.

## The server

The oligarchy proxy is already running on this machine at `127.0.0.1:42069`, the CLI's default address. Do not start, stop, or restart it, and leave `OLIGARCHY_ADDR` unset.

## The commands

The CLI is the only way you touch the guest. Do not call the HTTP API directly, and do not run `qemu-*` commands yourself.

Boot a session — prints the session id every other command needs:

```bash
node --experimental-strip-types src/qemu/cli.ts start --iso '{{ISO}}'
```

Leave `--disk` out and the server creates a fresh 40G disk for the session. Pass `--disk <path>` only when the task below hands you an existing qcow2.

Capture the guest display as a PNG:

```bash
node --experimental-strip-types src/qemu/cli.ts get-image <id> -o step-01.png
```

Type into the guest:

```bash
node --experimental-strip-types src/qemu/cli.ts send-keys <id> 'hello<ENTER>'
```

## Key encoding

- Literal characters are typed as written. `A` already sends shift+a; never add your own shift.
- Special keys go in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.
- Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. They combine: `<C-S-c>`.
- Literal `<` and `>` are `<LT>` and `<GT>`.
- Single-quote the key string so the shell keeps `<`, `>`, and spaces.

## How to work

Look, act, look again:

1. Take a screenshot and read it.
2. Send the keys that screen calls for.
3. Take another screenshot to confirm the effect before deciding the next step.

Never type blind. When the guest is busy — boot messages, spinners, progress bars — `sleep 20` and re-screenshot instead of pressing keys. Number the screenshots (`step-01.png`, `step-02.png`, ...) so the run leaves a trail.

## Your task

{{TASK}}
