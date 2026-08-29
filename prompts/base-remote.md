# Drive a QEMU guest — remote server

You are operating a QEMU guest through the oligarchy CLI in this repository. Run every command from the repository root. Everything you need to operate the guest is in this prompt; do not explore this repo's docs or source to learn the control plane.

## The server

The oligarchy proxy runs on another machine. The CLI reads its address from `OLIGARCHY_ADDR` — host:port, no scheme; the CLI speaks plain HTTP — so export it once before your first command:

```bash
export OLIGARCHY_ADDR={{ADDR}}
```

The server is not yours to manage: if a command fails to connect, report it; do not try to start a proxy anywhere.

## The commands

The CLI is the only way you touch the guest. Do not call the HTTP API directly, and do not run `qemu-*` commands yourself.

Boot a session — prints the session id every other command needs:

```bash
node --experimental-strip-types src/qemu/cli.ts start --iso {{ISO_URL}}
```

The ISO must be an http(s) URL. A file path cannot work here: the CLI would check it on this machine, and the server would try to open it on its own disk. The server downloads the URL into its cache on the first start and reuses it afterwards, so a first boot of a new URL takes as long as the download. Never pass `--disk` — a disk path would also have to exist on the server's machine; leaving it out makes the server create a fresh 40G disk.

Capture the guest display as a PNG — the file is written on your machine, nothing to copy from the server:

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
