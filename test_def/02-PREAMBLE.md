# TESTS.md preamble (draft; folded into TESTS.md at synthesis)

## What this list is

Every test below is a row for `test_definitions` (`name`, `description`, `instruction`, `proof`),
created with `./ctrl test define`, ticketed with `./ctrl test new`, and driven by an LLM against the
QEMU guest through `./client` only: `send-keys`, `mouse …`, `get-image`, `get-serial`. Each is one
user story, in the voice of the existing `lock-screen` definition, with the happy path and at least
one unhappy path, the driver-facing quirk named, and the machine left as found (or `stop` stated).

Source reviewed: `omacom/omarchy` @ `d174d4a` (2026-09-18; 1,845 files, 421,965 lines) and
`omacom/omarchy-iso` @ `7cfb711`, plus the 60 other omacom repos classified for what ships.
Twenty-two reviewers each read their slice line by line and wrote `test_def/NN-*.md`; those files
hold the full inventories (every hotkey, menu row, command, widget, migration, maintainer assertion)
and are the audit trail. `test_def/90-coverage-matrix.md` maps every proposed block to its final test.

## The guest (what every instruction assumes)

QEMU q35/KVM, 2 vCPU, 4 GB, virtio-vga at **1280×800 scale 1**, USB tablet, user-mode NAT (outbound
TCP/UDP + DNS work; **ICMP fails**, so Ping "Timeout" in the network panel is expected), no audio
device, battery, Wi-Fi, Bluetooth, webcam, fingerprint, lid or second monitor. Minted disk from
`omarchy-4.0.2.iso` (latest release 4.0.4; HEAD is ahead): user `prime`, password `prime`, LUKS
passphrase `prime`. Boot on `--resume`: OVMF → Limine → UKI → Plymouth LUKS prompt (**typed blind,
3 tries only**) → SDDM autologin → desktop. The greeter is only reachable via `Super+Escape → Logout`.

## Driver conventions (put in every ticket's hints where relevant)

- Menus: `Super+Space` root, `Super+Escape` System, `Super+Alt+Space` Apps. Escape is two-stage
  (clear filter, then close); Backspace on an empty filter goes back a level. Guards paint from the
  previous open — reopen twice before asserting a ✓ moved. First `Return` in a fresh menu only
  settles the cursor. Pickers may not filter on typing: navigate with arrows.
- Lock screen: blanks 5 s after the last input (DPMS); a mouse move is the harmless wake; the first
  character typed while black both wakes and enters the field. **No clock or user name** — only the
  password field. faillock `deny=10 unlock_time=120`, shared with SDDM and `sudo`.
- Idle: screensaver 150 s, lock 300 s. Any key dismisses the screensaver. Screenshots are not activity.
- Terminal: `Super+Enter` opens **foot**; `Super+W` closes. `fastfetch` is not printed on open.
  Exit codes are invisible: append `; echo "exit=$?"`. Long output: `… | sudo tee /dev/ttyS0`, then
  `get-serial`. The serial console gets nothing at boot on its own.
- Keys the driver can send: letters, digits, punctuation (`<M-,>`, `<M-`>`, `<M-/>`, `<M-->`),
  `<PRINT>`, `<CAPSLOCK>`, `<INSERT>`, `<MENU>`, `<PAUSE>`, `<F1>..<F24>`, right-hand modifiers
  (`<alt_r>`, `<A-alt_r>`), `<C-A-F3>`. Cannot send XF86 media/brightness/power keys — type
  `wtype -k XF86AudioRaiseVolume` in the guest terminal instead; no held-key verb (push-to-talk
  untestable; use the toggle).
- Version skew: HEAD chords/rows may be absent on 4.0.2 (`omarchy up`, tiled fullscreen, bar panel
  numbers, zoom, `bar put`, `osd`, channels, Reset Computer). Check `omarchy version` / the `Super+K`
  row first and report "absent on this build", not "broken".
- Heavy apps (Chromium, Obsidian) on 2 vCPU may raise Hyprland's "not responding" dialog: click
  **Wait**. GTK apps render oversized at 1× (`GDK_SCALE=2` fixed): expected.
- Re-applying the current theme advances the wallpaper. `shell.json` is replace-not-merge (copy the
  stock file before editing). `omarchy-toggle-bar on` hides the bar.
- Safety: every LUKS passphrase change ends back at `prime`; never three wrong LUKS tries; answer
  **No** to `omarchy-upgrade-to-quattro`; `dev link` only a scratch dir and `dev unlink --no-reboot`;
  never `save` after a factory reset; suspend is one-way (last action of its session).

## Operator notes

- Run `update-menu-omarchy` once on a fresh mint and `save` that disk: it pulls a month of Arch
  packages + the `linux-omarchy` kernel (> 5 min) and runs exactly 11 migrations (Kitty config box,
  kernel reboot prompt visible). Every `post-update-*` and most `NET`/`SLOW` tests assume that disk.
- Installs that fit a session (NET): fonts, vim, helix, kitty/alacritty/ghostty, sublime, tailscale,
  firefox (~75 MB), php, mise node/bun/deno/python/zig, redis image, ollama; medium: 1Password,
  Claude Desktop, VSCode, Signal, Voxtype (~170 MB), Go, Rust. Not in budget: Steam, RetroArch,
  Lutris, Heroic, Battle.net, LM Studio, Hermes Desktop, Java/.NET/Scala, Elixir/OCaml, Windows VM.
- Tests tagged `VM-NO` `[VM-OK-from-ISO]` become runnable if a ticket boots the ISO instead of
  resuming (12 installer stories).

## Harness improvement candidates (found while writing tests)

1. Whitelist QEMU qcodes `volumeup volumedown audiomute audioplay audionext audioprev power sleep
   calculator` in `src/qemu/keys.ts` so XF86 bindings can be driven by key.
2. A held-key verb (`send-keys --hold/--release`) for push-to-talk and hold-to-act bindings.
3. Optional cidata / second-disk attach on `start` for unattended-install and dual-boot tests.
4. Re-version `lock-screen` (stored v7 → would land as v8): it calls `Super+Escape` "Omarchy Menu" when
   it opens the System submenu, names the row "Lock Screen" (it is `Lock`), and its hint says
   `./client-image` (the wrapper is `./client-with-image`). The clock mention lives only in `ctrl.md`'s
   example (`ctrl.md:89-90`), not in the stored definition — no 4.x build ever had a lock-screen clock
   (removed 2025-06-09), so fix that example too. Proposed wording is in TESTS.md under `lock-screen`.

## Defects and doc/code disagreements found by reading (each has a pinning test)

Every item below was settled against git history in `test_def/03-INTENDED-BEHAVIOUR.md` (commit shas,
dates, open issues/PRs). Tests assert the **intended** side: for DEFECT / MANUAL-INTENDED items the
proof describes the intended behaviour and the test is expected to fail at HEAD until fixed; for
CODE-INTENDED items the proof asserts the code and the manual is the thing to update. Verdicts in
brackets.

- [DEFECT] `omarchy-install-gaming-gpu-lib32` exits 1 with no Intel/AMD/NVIDIA GPU → Steam/Heroic/
  Lutris/Battle.net end `Failed (exit code 1)` on virtio-vga. Author's summary says "no-op otherwise".
- [DEFECT] `omarchy-setup-security-sshd --key=<bad>` enables sshd and opens port 22 before validating
  the key (password auth left on); the project's own `--gh-keys` fix states "reject before anything is
  installed or opened". [CODE-INTENDED] Unattended `authorized_keys` uses `ufw allow` (manual 51 says so).
- [DEFECT] `omarchy-snapshot <unknown>` exits 0 silently. [DEFECT] `omarchy-install-dev-env <unknown>`
  succeeds silently (its remover rejects unknown names).
- [DEFECT] `omarchy-install-docker-dbs` on Escape calls undefined `main_menu`.
- [DEFECT] `Super+Ctrl+Alt+B` (battery notice) sends an empty-headline toast on battery-less machines.
- [DEFECT, regression] `omarchy theme remove` deletes the *active* user theme with no guard — a guard
  existed from 2025-08-05 and was dropped as collateral in #4053 (2026-01-03).
- [UNCLEAR] `omarchy-upgrade-to-quattro` has no "already on 4.x" guard (re-run is a designed recovery
  path; drivers answer No). [MANUAL-INTENDED] `omarchy update -y` still asks `Reboot?` — docs say `-y`
  never asks (issue #8986, PR #8992 open).
- [DEFECT] Phantom `finalize` group in `omarchy --help` (exit 127): `omarchy-finalize-user` became
  `omarchy-provision-user` in #6621 and four docs/tables were not updated (issue #7113, also `branch
  config wifi`). [CODE-INTENDED] `omarchy help` is not a command and never was.
- [CODE-INTENDED] Tailscale install waits at the `login.tailscale.com` URL by design; minor defect:
  after an abort the Install row is dim (cannot re-run from the menu).
- [CODE-INTENDED, manual stale] `Super+Ctrl+Alt+W` opens a panel (says notification); clipboard `Return` pastes (says
  clipboard-only); emoji picker inserts (says copies); `Super+Shift+B` undocumented; 19 of 22 themes
  previewed; monitor scale is `"auto"` not 2; `Update → Config` restores groups with `.bak.<epoch>`;
  faillock and LUKS try limits unstated; "processes restart after editing" is true in effect (Hyprland
  autoreloads); `Setup → Defaults → Browser` lists uninstalled browsers; Signal/1Password/Spotify
  chords install immediately rather than "offer". All: test asserts the code, manual needs the update.
- [CODE-INTENDED, documented limitation] Menu extension JSONC: one inline `//` silently drops every user
  entry. [DEFECT, documented-known] `omarchy refresh config ../…` path escape still live.
  (Clone opening `$EDITOR` is fine: `$EDITOR` is `omarchy-launch-editor --inline` on Omarchy.)
- [UNCLEAR; 1Password sub-item DEFECT] Many Install rows have no Remove counterpart. [CODE-INTENDED]
  the Apps-menu Delete key leaves `~/.config` behind.
- [DEFECT, docs in other repos] hype/owe READMEs give install commands that cannot work. [UNCLEAR, PR
  #12051] elsewhen's package path is not scanned by the plugin catalog. [DEFECT] `agent` group
  description reads "AI coding agent usage data".
