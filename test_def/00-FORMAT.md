# Test definition format and constraints (read this first)

## Rule zero: UI or terminal inside QEMU, nothing else

Every test is driven **purely** through what a user at the keyboard could do on the Omarchy desktop
running inside QEMU: click and type in the graphical UI, or open a terminal (`Super+Enter`) and run
commands there. Every proof is read off a screenshot of that guest (or off `/dev/ttyS0` that a
command inside the guest wrote to). There is no other channel:

- no host-side scripts, no `hyprctl`/`qs`/`systemctl` from outside, no file copied into or out of
  the guest, no inspecting the qcow2, no network service on the host the guest is told to call;
- no "simulate a battery/lid/Wi-Fi from the host" — if the VM lacks the hardware, the test is either
  the *absence* path (what the user sees with no such device) or it is not a test here;
- a test that needs a fresh ISO boot (installer paths) is only runnable when a ticket boots the ISO;
  on the resumed minted disk it is out of scope. Say so with the tag.

If a step cannot be phrased as "click …", "press …", or "in a terminal type … and see …", it does
not belong in an instruction.

Concretely, every step of every test must be expressible as one of the QEMU client verbs, so the
whole test is specifiable as a sequence of `./client` calls:

| step in the instruction                        | `./client` verb it becomes                          |
|------------------------------------------------|-----------------------------------------------------|
| press a hotkey / type text / answer a prompt   | `send-keys --keys "<M-ENTER>"`, `"omarchy-theme-set nord<ENTER>"` |
| click / double-click / right-click a thing     | `mouse click --x --y [--button]`, `mouse double-click` |
| scroll, drag a window, Super+drag              | `mouse scroll`, `mouse drag [--modifier super]`     |
| hover to focus a window before typing          | `mouse move`                                        |
| look at the screen / verify / proof            | `get-image` (screenshot)                            |
| read long text output                          | in the guest: `… \| sudo tee /dev/ttyS0`, then `get-serial` |
| switch to a text console                       | `send-keys --keys "<C-A-F3>"`                       |
| wait for something slow                        | repeated `get-image`, never a long sleep            |

Anything that is not one of those rows (host commands, file transfer, VM reconfiguration, hardware
plug/unplug) is out of scope. The synthesis step rejects instructions that contain such steps.

## The table

Every proposed test must fit the `test_definitions` table in `drizzle/0001_init.sql`:

| column        | meaning                                                                                   |
|---------------|-------------------------------------------------------------------------------------------|
| `name`        | kebab-case slug, unique per test (e.g. `lock-screen`, `theme-switch-menu`)                |
| `description` | one or two sentences: what user-facing behaviour this protects and why it matters         |
| `instruction` | what the driver does, step by step, from the desktop; XML-ish block (template below)      |
| `proof`       | what must be on screen / in the serial log for a pass, and what to capture on a failure   |

A definition is created with `./ctrl test define --name <n> --description <d> --instruction <i> --proof <p>`.
A run creates one Linear ticket per definition; a **driving agent** (an LLM) reads the ticket and drives
the guest with `./client`. The driver never reads code, never has a shell on the host, and only sees
screenshots, so the instruction must be self-contained and describable in terms of what is on screen.

## The existing definitions (match this voice)

```
name: lock-screen
description: The lock screen protects and releases a session: lock from the desktop, unlock with the account password.
instruction:
<Instructions>
From the desktop please do the following:

<ActionList>
* Open up Omarchy Menu with Super+Escape
* Select the Lock Screen option using the mouse.  Do not use keyboard.
* On the lock screen unlock it with a password.
** The password screen, if not interacted with within a few seconds, it will turn black.  You can still type and keys will be inputted into the password text box
* the desktop must return exactly as left.
* any crashes or erroneous behavior must be reported.
* always take a screen shot of every step
</ActionList>

<Hints>
* ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
* double checking your mouse position before clicking can be useful to prevent failure.
</Hints>
</Instructions>
proof:
* on success
** Screendumps of the engaged lock screen and the restored desktop
** The mouse button was used to click the Lock Screen and not the keyboard
* If unsuccessful
** the crash dialog on failure.
```

`mint` (installing from the ISO, saving the disk) is the other existing definition. Do not re-propose it.

### What `lock-screen` teaches — calibrate every test to it

- **One user story per test.** "Lock from the desktop, unlock with the password" — a feature the
  user experiences end to end, not a script flag. Group a command's flags into the story a user
  lives through; split only when the stories differ (e.g. `theme-switch-menu` vs `theme-install-bad-url`).
- **Driven from the UI the user actually uses**, with the input modality pinned when it matters
  ("using the mouse. Do not use keyboard."). That makes the test also a test of the UI surface.
- **Names the quirk the driver will hit** ("the password screen turns black after a few seconds;
  you can still type"). Every test should carry the one or two quirks that would otherwise make a
  correct system look broken.
- **Requires the round trip** ("the desktop must return exactly as left"). Tests end in a known
  state and assert it.
- **Always** the two closing bullets: report crashes/erroneous behaviour; screenshot every step.
- **Hints are for the driver, not the user**: `./client-with-image`, double-check mouse position.
- **Proof is concrete evidence**: which screenshots (engaged lock screen, restored desktop), a
  modality check (mouse, not keyboard), and what to capture on failure (the crash dialog).
- **Description is one sentence** naming the behaviour and its two halves.

Aim for that shape and length. A 40-step instruction is a smell; a 5–9 step story with sub-bullet
caveats is the target.

## The machine the driver gets

- QEMU q35 + KVM, host CPU, **2 vCPU, 4 GB RAM**, 40 GB virtio qcow2 disk, UEFI (OVMF).
- Display: **virtio-vga, no 3D acceleration**, one screen. Pointer is a USB tablet (absolute).
- **No audio device, no battery, no Wi-Fi, no Bluetooth, no webcam, no fingerprint reader, no TPM, no
  second monitor, no backlight, no lid.** Tests of those features can only test the *absence* path
  (widget hidden, graceful message) unless they can be simulated from inside the guest.
- Network: QEMU default user-mode NAT — **outbound TCP/UDP + DNS work** (updates, browsers, git,
  package installs), no inbound, ICMP ping fails. Downloads are slow-ish; large installs may exceed a
  session's ten-minute budget.
- Serial console `/dev/ttyS0` is captured; the driver can read it with `./client get-serial`. Writing to
  it needs root (`sudo tee /dev/ttyS0`).
- The disk is a **minted** Omarchy install (see `mint`): the ISO is `omarchy-4.0.2.iso` today (latest
  release is 4.0.4; the repo HEAD `version` file says `4.0.0.alpha` because HEAD is the dev line).
  User `prime`, password `prime`, LUKS passphrase `prime`. The machine resumes with `--resume`: the
  driver answers the passphrase prompt and the login (SDDM or auto-login, whatever the build does) and
  reaches the desktop. **Every instruction starts "From the desktop".**
- Time budget: a session is expected to finish well inside ten minutes; the driver must not sleep more
  than five seconds between actions and takes a screenshot after every action.
- State is **not** reset between tests on the same minted disk unless the driver ends with `stop`
  (the disk is discarded; only `save` keeps it). So each test runs on a pristine minted disk, but a test
  that reboots, updates, or changes config must expect the *stock* state at start.

## What the driver can do (`./client`)

- `get-image` (PNG screenshot), `get-serial` (text of `/dev/ttyS0`).
- `send-keys --keys "<...>"`: literal text, `<ENTER> <ESC> <TAB> <BS> <DEL> <SPACE> <UP> <DOWN> <LEFT>
  <RIGHT> <HOME> <END> <PGUP> <PGDN> <F1>..<F24>`, modifiers `<C-x> <A-x> <S-x> <M-x>` (M = Super),
  combos `<C-S-c>`, `<C-A-F3>` switches TTY, bare `<META_L>` tap. `<LT>`/`<GT>` for `<`/`>`.
- `mouse move|click|double-click|scroll|drag|hold|release` with fractional `--x --y` (0..1),
  `--button left|middle|right`, `--modifier super|shift|...`.
- Nothing else: no file transfer into the guest, no host-side exec. Anything that needs a command is
  typed into a terminal the driver opens (`Super+Enter`) and read back from the screenshot. Long
  outputs can be redirected to `/dev/ttyS0` with `sudo tee` and read via `get-serial`.

## How to write a good instruction

- Start with `From the desktop please do the following:` and use `<ActionList>` bullets for steps,
  `**` sub-bullets for details/caveats, and a `<Hints>` block for driver tips (where things are on
  screen, timing, that a TUI picker may not filter on typing, etc.).
- Name the exact hotkey (as `Super+Escape`, `Super+Shift+Space`, `Ctrl+Alt+F3`) and exact menu path
  (`Omarchy Menu → Setup → Theme`) or exact command (`omarchy-theme-set tokyo-night`).
- Say what must be visible after each step so the driver can verify it.
- Say how to return the machine to the state expected by later steps when it matters.
- Include the unhappy path where a user can hit one: wrong password, cancelling the picker, a command
  with a bad argument, a missing dependency. Either as a second test (`<name>-rejects-...`) or as
  extra steps in the same test when short. Every feature should have at least one negative path
  somewhere.
- Always include: `* any crashes or erroneous behavior must be reported.` and
  `* always take a screen shot of every step`.

## How to write a good proof

```
* on success
** <exact screenshot content that proves each key step>
** <serial/journal evidence when the screen alone cannot prove it>
* If unsuccessful
** <what to capture: the error dialog, the terminal output, the serial dump>
```

## Feasibility tags

Tag each proposed test with one of:

- `VM-OK` — fully exercisable in the QEMU guest as described above.
- `VM-PARTIAL` — exercisable, but only the software path (e.g. the widget hides because there is no
  battery; the command prints "no device"). Say which part is skipped.
- `VM-NO` — needs hardware the guest lacks or > 10 min; keep it in the notes for the record, do not
  put it in TESTS.md's main list (it goes in a "not runnable here" appendix).
- `NET` — needs outbound network; note approximate download size.
- `SLOW` — likely > 5 minutes.

## Notes file layout each reviewer writes (`test_def/NN-<area>.md`)

1. `## Scope` — exact files/dirs reviewed, line counts, anything skipped and why.
2. `## Inventory` — every user-reachable behaviour found: hotkeys, menu entries, commands + flags,
   panels, widgets, dialogs, services, config files the user is meant to edit, first-run flows.
   One line each with the source file reference. **This is the audit trail; be exhaustive.**
3. `## Observations` — quirks, ordering constraints, states, dependencies, anything a driver must know.
4. `## Proposed tests` — one block per test in the exact form:

```
### <name>   [VM-OK|VM-PARTIAL|VM-NO] [NET] [SLOW]
description: ...
instruction: |
  <Instructions>
  ...
  </Instructions>
proof: |
  * on success
  ** ...
  * If unsuccessful
  ** ...
covers: <source files / manual sections / existing test files this maps to>
```

5. `## Gaps` — behaviours you found that you could not turn into a driver test, and why.
