# CI: boot the ISO to a desktop

You are running this repository's smoke test: take a QEMU guest from cold boot to a signed-in graphical desktop. Everything you need is in this prompt. Do not read this repo's docs or source, do not install anything, and run no commands beyond the ones given here, `sleep`, and viewing the screenshots you take. Run every command from the repository root.

Already in place — touch neither:

- The oligarchy proxy is running on this machine at `127.0.0.1:42069`, the CLI's default. Never start, stop, or restart it; leave `OLIGARCHY_ADDR` unset.
- The guest ISO is on disk at `{{ISO}}`.

## Mission

Boot a session from the ISO and drive the guest through its installer: create the user below, let the install finish, and keep going — through any reboot, disk-encryption passphrase, or login screen — until the installed system shows its graphical desktop. Read the screens and react to them; do not assume a fixed sequence.

## Commands

Boot — prints the session id every other command needs. Do not pass `--disk`; the server creates a fresh disk:

```bash
node --experimental-strip-types src/qemu/cli.ts start --iso {{ISO}}
```

Screenshot:

```bash
node --experimental-strip-types src/qemu/cli.ts get-image <id> -o step-01.png
```

Type:

```bash
node --experimental-strip-types src/qemu/cli.ts send-keys <id> 'text<ENTER>'
```

## Key encoding

- Literal characters are typed as written. `A` already sends shift+a; never add your own shift.
- Special keys go in angle brackets: `<ENTER>`, `<ESC>`, `<TAB>`, `<BS>`, `<DEL>`, `<SPACE>`, `<UP>`, `<DOWN>`, `<LEFT>`, `<RIGHT>`, `<HOME>`, `<END>`, `<PGUP>`, `<PGDN>`, `<F1>`–`<F24>`.
- Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. They combine: `<C-S-c>`.
- Literal `<` and `>` are `<LT>` and `<GT>`.
- Single-quote the key string so the shell keeps `<`, `>`, and spaces.

## Answers for the guest

Use these wherever the guest asks. Anything it asks that is not listed here, answer with the simplest acceptable choice and move on.

- Full name: `CI Oligarch`
- Email: `ci@oligarchy.test`
- Username: `ci`
- Every password — user account, disk encryption, login: `oligarchy-ci`

## The loop

1. Take a screenshot and read it.
2. If the screen wants input, send exactly the keys it calls for, then screenshot again to confirm the effect.
3. If the guest is working — boot text, spinners, progress bars — `sleep 20` and re-screenshot. A full install can run fifteen minutes or more; waiting is normal, and pressing keys at a busy screen is how runs get wrecked.

Number the screenshots in order (`step-01.png`, `step-02.png`, ...) and keep every one; they are the run's audit trail.

If a reboot drops you back at the ISO's boot menu instead of the installed system, pick the menu entry that boots the existing local disk. If the menu has no such entry, that is a FAIL — do not reinstall.

## Verdict

Your reply must end with exactly one of these lines, nothing after it:

- `PASS <session-id>` — a screenshot shows the installed system's desktop. Save that screenshot as `desktop.png` too.
- `FAIL: <one line: the screen you were on and what went wrong>` — the screen has not changed in ten minutes, or the guest shows an error the answers above cannot get past. Keep all screenshots.
