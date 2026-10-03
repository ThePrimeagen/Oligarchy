# Cross-cutting facts for the driver (accumulated from reviewers)

Things every instruction/hint in TESTS.md should assume. Source reviewer in brackets.

## What `./client send-keys` can and cannot send (verified in `src/qemu/keys.ts`)

- Accepted beyond the documented list: `<PRINT>`, `<CAPSLOCK>`, `<INSERT>`/`<INS>`, `<MENU>`,
  `<PAUSE>`, `<NUMLOCK>`, `<SCROLLLOCK>`, `<SYSREQ>`, and any qcode token that contains `_` or starts
  with `f` (`<kp_enter>`, `<ac_home>`, `<F13>`). Modifier combos work: `<M-PRINT>`, `<A-PRINT>`,
  `<M-C-PRINT>`. So every `Print`-based capture binding **is** testable, and CapsLock compose
  sequences are too. [orchestrator; corrects 10]
- Right-hand modifiers are underscore qcodes and therefore accepted: `<alt_r>`, `<shift_r>`,
  `<ctrl_r>`, `<meta_r>`; a both-alts chord is `<A-alt_r>`. So `grp:alts_toggle` layout switching and
  a Right-Alt/CapsLock compose key are drivable. [orchestrator; corrects 12]
- Punctuation chords parse: `<M-,>` (comma), `<M-`>` (grave), `<M-/>` (slash), `<M-->` (minus,
  handled explicitly), `<M-=>` (equal), `<M-.>` (dot), `<M-;>` — single characters go through the
  UNSHIFTED table. [orchestrator; answers 40]
- **No key hold**: `send-keys` presses and releases each chord; there is no held-key verb (mouse has
  `hold`/`release`, keys do not). Push-to-talk (`F9` held) and any hold-to-act binding are not
  drivable; use the toggle variant (`Super+Ctrl+X`). Harness improvement candidate. [23]
- **Not sendable**: XF86 media/brightness/power keys — qcodes `volumeup`, `volumedown`, `audiomute`,
  `audioplay`, `power`, `calculator`, `sleep` fail the filter (no `_`, not `f…`). Volume/brightness
  OSD hotkeys and `XF86PowerOff → power menu` are therefore reachable only via their CLI
  (`omarchy-audio-output-volume raise`, `omarchy-brightness-display +5%`) or the menu. Harness
  improvement candidate: whitelist those qcodes. [orchestrator]

## Boot and login on `--resume`

- Encrypted installs keep SDDM autologin **permanently on** (`bin/omarchy-provision-owner:776-782`):
  after the LUKS passphrase `prime` the machine lands on the desktop with no SDDM password step. [50]
- Idle defaults from `config/omarchy/shell.json`: `idle.screensaver = 150s`, `idle.lock = 300s`. A
  driver that stalls > 150 s gets the screensaver, > 300 s the lock screen. Any key dismisses the
  screensaver. [50]

## Docs/plans/skills and maintainer-test contracts [61, 51]

- **Phantom `finalize` group**: advertised in `omarchy --help` (`GROUP_DESCRIPTIONS`), but no binary
  belongs to it; `omarchy finalize` / `omarchy finalize user` exit 127. Three docs disagree with the
  router; `omarchy commands --check` does not catch it. [61]
- **No CI** in the repo (`.github/` has only SECURITY.md and issue templates); `omarchy commands
  --check` is the one lint reachable from the guest. [61]
- Menu extension JSONC: one inline `//` comment silently drops **every** user entry while the shipped
  menu keeps working; hot-reload makes this a cheap deterministic negative test. [61]
- `omarchy refresh config ../default/bashrc` copies to `~/default/bashrc` — documented-but-unfixed
  path escape (AGENTS.md records it). [61]
- Plans: backup, dots, server — nothing shipped. remote — only `omarchy install/remove service
  sunshine`, still carrying the plan's listed defects (autostart double-start, `--ignore-certificate-
  errors` webapp, no menu rows). [61]
- `agent` group description reads "AI coding agent usage data" while `omarchy agent` launches an agent. [61]
- **Direct `pacman -Syu` guard**: alpm hook `00-omarchy-update-guard` aborts with "Woah partner…"
  unless `OMARCHY_ALLOW_DIRECT_PACMAN=1`; only `omarchy update` is sanctioned. [51]
- `omarchy-hyprland-reload-guard pause/resume` wraps every settings transaction: restores prior
  `disable_autoreload`/`suppress_errors`, forces exactly one reload. [51]
- `omarchy-git-url-check` refuses `ext::`, unknown `scheme://` and option-shaped URLs for theme/plugin
  installs (would make `git clone` execute a program). [51]
- Migration `1788102906.sh` quarantines legacy Omarchy-3 udev rules to `.omarchy-disabled` and
  repoints stale `~/.XCompose` includes. [51]
- `omarchy update` refuses below **10 GiB free** before confirming or snapshotting, and refuses to
  overlap another running update via a runtime-dir lock. [52]
- Themes installed from git **lose every code-bearing file** (`hyprland.lua`, terminal configs,
  `vscode.json`) and keep only colour; a user's own theme is untouched; hostile URLs/names refused
  before `git` runs. [52]
- Notification click commands are a literal argv vector; bodies/titles can never render `<img>` or
  trigger a fetch. [52]
- Build drift: guards that may be missing on the 4.0.2 guest — argv `--exec`, plugin/theme
  transport-helper checks, webapp scheme checks, sudo-expiry fail-closed. Every failure proof
  captures `omarchy-version` so drift is separable from regression. [52]
- `omarchy crash mute <program>` exists (only "crash capture" is documented). Browser policy dir is
  root-owned with a six-hex-digit-only sudo grant. Hook/state/done names have traversal guards. [51]

## Installer, boot chain, first run [42]

- Boot chain: OVMF → Limine (`Omarchy Bootloader`, `default_entry: 2`, menu normally not shown) →
  UKI `/boot/EFI/Linux/omarchy_linux-omarchy.efi` → Plymouth (`quiet splash loglevel=0 …`). The
  **LUKS prompt is not reliably OCR-able**: type blind, early keys are discarded, a wrong passphrase
  re-prompts (Plymouth) — but see 41: three wrong tries drop to an emergency shell. The serial console
  gets essentially nothing at boot; serial evidence must be written with `sudo tee /dev/ttyS0`.
- First-run already ran during the mint (`done/{finalize-user,first-run-user}` exist; no welcome
  toasts on resume). The three post-update hooks have **never fired**: `omarchy-hook post-update`
  shows the Voxtype/agent invitations exactly once.
- Every install stages the Node tarball and a read-only `@factory` snapshot, so factory reset is
  testable in the guest — two UKI rebuilds plus a reboot, **~8–12 min on 2 vCPU**, at the budget edge.
- Hardware leaves that fire in QEMU: only the unconditional ones (`hid_apple fnmode=2`,
  `bluetooth.service` enabled, networkd/wait-online masked, `WIRELESS_REGDOM` iff the timezone maps to
  a country). No NVIDIA/Vulkan/Intel/thermald/lpmd artefacts. `omarchy-hw-intel` can be true under
  `-cpu host`, but every Intel leaf also needs a battery or a specific PCI id.
- Installer (ISO only): passwords checked only for blank/mismatch (a one-character password is
  accepted for user+root+LUKS). Ctrl+C means "prepare for another owner" on the keyboard screen,
  "toggle encryption" on the disk confirm, **abort to a root shell** in the user step.
- The driver cannot attach a cidata or fixture disk: unattended/dual-boot/too-small-disk tests stay
  VM-NO without a harness change (12 installer tests are runnable from a fresh-ISO ticket).

## Login, boot chain, system defaults [41]

- **Autologin hides the greeter**: boot goes LUKS → desktop. SDDM tests start with `Super+Escape →
  Logout`; autologin does not re-fire, so the greeter then appears.
- The SDDM theme has **no username field, session chooser or power buttons** — logo, lock glyph and a
  dotted entry. Wrong password = red lock/entry, cleared by the next keystroke. Stay under ~5 wrong
  tries per test (faillock deny=10 shared with the lock screen and sudo).
- **LUKS prompt allows only 3 tries** before dropping to an emergency shell: the Plymouth test does
  exactly one wrong passphrase then the right one. Never three wrong.
- `fastfetch` is **not** printed on terminal open (`.bashrc` never calls it); it is reached via
  `Omarchy Menu → About`.
- Not installed by default: kitty/alacritty/ghostty, `hunk`, `opencode`, `claude`, `codex` — so
  `tds` and the `c`/`cx`/`cy` aliases hit "command not found"/downloads and `a` reports no default agent.
- The desktop user is deliberately unprivileged: not in `docker` (CLI → permission denied;
  `Super+Shift+D` → polkit dialog), not a CUPS admin (`localhost:631` Administration → Forbidden),
  sudo needs a password except four exact-argument NOPASSWD rules (DNS presets, `timedatectl
  set-timezone <Zone>`, browser theme colour) plus `passwd_tries=10`. Firewall deny-in with only
  LocalSend/Docker-DNS holes; no SSH rule until SSHD setup.

## CLI router [20]

- `omarchy help` is an **unknown command** (exit 127); only `--help`/`-h` work. Groups `show` and
  `upgrade` route and appear in `omarchy commands` but have no `GROUP_DESCRIPTIONS` entry, so never
  appear in bare `omarchy`. Root binaries swallow typos (`omarchy version bogus` prints the version);
  leftovers bypass the required-args guard (`omarchy state set` reaches the script's usage, exit 1).
- `omarchy up` alias, `commands --markdown`, `--help --json` are HEAD-only (d174d4a) — may be absent
  on 4.0.2; record `omarchy version` first, treat "Unknown Omarchy command" as version skew.
- Exit codes are invisible on a screenshot: every negative step appends `; echo "exit=$?"`.
- `omarchy version pkgs` prints today 00:00 when `pacman.log` has no `upgraded` line;
  `omarchy-sudo-keepalive` kills its own loop when executed directly; `omarchy screensaver` typed in a
  terminal exits in ~1 s and leaves the terminal background black (OSC 11 never reset); `omarchy
  debug`'s "Upload log" is gated on `ping 8.8.8.8` (ICMP blocked) although HTTPS works.
- **Safety**: `omarchy dev link` writes `/etc/sudoers.d/omarchy-dev-path` and `/etc/omarchy.conf` —
  link a scratch dir, answer **No** to every reboot prompt, end with `dev unlink --no-reboot`.
  `channel set`, `reinstall`, `upgrade to quattro` end in full updates/reinstalls: only their
  validation/decline paths fit ten minutes.

## Migrations and update [43]

- The ISO pre-marks all shipped migrations. A **4.0.2 disk on a stable update to 4.0.4 runs exactly
  11 migrations**: mise `auto_prune=false`, Hermes CLI stub, Hermes skill links, cursor-agent stub,
  Hermes skin (no-op), system-sleep ownership (no-op), muse stub, **Kitty config replaced + "Restart
  Kitty" box**, legacy icon font (no-op), **linux-omarchy kernel + Limine BOOT_ORDER → reboot
  required**, kernel headers. Edge/dev to HEAD adds 15 more (qt6-multimedia, gemini→agy, hey, ori,
  Chromium hosts, vi, basecamp, `~/Work/.mise.toml` deleted, KEF wireplumber, BBR sysctl, cf, …).
  Only Kitty, the kernel reboot prompt and mise wrapper files are visible in the guest.
- **`omarchy-upgrade-to-quattro` has no "already on 4.x" guard**: only the `Continue with upgrade?`
  gum prompt stands before a full pacman/Limine/config rewrite. The driver must answer **No**; a
  Yes must never be given.
- `omarchy update -y` is not fully unattended: `omarchy-update-restart` still asks `Reboot?` (docs say
  `-y` never asks). Cancelling at the confirm box exits 0 (`Done!`). Low-disk refusal is followed by
  the generic red `Something went wrong` banner.
- Every SLOW update test will likely exceed 10 minutes on the 4.0.2 disk (a month of Arch packages +
  kernel + `mise up`). **Run `update-terminal-run` once and keep that disk for the `post-update-*` tests.**
- Cheap in-guest negatives: `sudo touch /var/lib/pacman/db.lck` (keyring step fails with pacman's lock
  error; `omarchy-migrate` alone waits); `fallocate` a file to push free space under 10 GiB;
  `sudo touch /usr/bin/omarchy-install-hermes-cli` for the unowned-file conflict healer;
  `chmod 555 ~/.config/mise` makes the first 4.0.4 migration fail (queue stops, resumes next run);
  `sudo pacman -Syu --ignore '*' bash` trips the "Woah partner" guard with one small download;
  `systemctl --user restart omarchy-migrate-notify.service` fires the login toast without relogin.

## Verdicts (03-INTENDED-BEHAVIOUR.md) — what proofs assert

- **Assert intended, flag observed (DEFECT / MANUAL-INTENDED)**: gpu-lib32 no-op exit 0 (#1); sshd
  `--key=<bad>` leaves sshd disabled and 22 closed (#2); `snapshot <unknown>` non-zero + usage (#4);
  `install-dev-env <unknown>` → `Unknown environment` exit 1 (#5); docker-dbs Escape quiet (#6);
  battery notice: no toast or `No battery` (#7); `theme remove` of the active theme refuses/switches
  (#8, regression since 2026-01-03); `update -y` never prompts Reboot (#10, issue #8986); `finalize`
  phantom group (#11, issue #7113); `agent` group description (#25); `refresh config ../` rejected (#27);
  1Password has no Remove row (#29 sub-item).
- **Assert code (CODE-INTENDED)**: `ufw allow` for unattended keys (#3); `omarchy help` unknown (#12);
  Tailscale waits at login URL (#13); `Super+Ctrl+Alt+W` panel (#14); clipboard Return pastes (#15);
  emoji inserts (#16); `Super+Shift+B` browser (#17); 22 themes (#18); autoreload on save (#19);
  `"auto"` scale (#20); group restore `.bak.<epoch>` (#21); faillock/LUKS limits (#22); inline `//`
  drops user rows (#26); Clone opens default editor (#28); Delete leaves `~/.config` (#30);
  `Super+Escape` = System (a); no lock-screen clock, never existed in 4.x (b); Defaults list
  uninstalled browsers (A1); Signal chord installs immediately (A2).
- **Record observed (UNCLEAR)**: quattro re-run guard (#9, answer No); elsewhen package path (#24,
  PR #12051); missing Remove rows generally (#29).

## Bar, OSD, notifications [30]

- XF86 keys the driver cannot send can be injected **inside the guest**: `wtype -k
  XF86AudioRaiseVolume` from a terminal (allowed: it is a guest command). With no sound card,
  pipewire-pulse's `auto_null` sink likely still gives a working volume OSD; `omarchy-brightness-display`
  exits 1 silently; `omarchy-audio-input-mute` says "Microphone on" with no mic.
- **There is no Caps Lock OSD** — Caps Lock is the Compose key (`compose:caps`; both Shifts toggle caps).
- `Bar.findPanelWidget` ignores visibility: `Super+Ctrl+P` / `Super+Ctrl+B` still call `open()` on the
  hidden power/bluetooth widgets — behaviour unverified; the driver reports what happens.
- The first `omarchy bar …` command creates `~/.config/omarchy/shell.json`, which is then canonical
  with no deep-merge; a `version`-less or corrupt file falls back to defaults, a minimal valid file
  yields an **empty bar**.
- DND toggling gives no toast (only the concealed-until-hover indicator). Toast lifetimes have floors
  (low 5 s; `-t` never shortens). Nerd-Font glyphs cannot be typed by the driver: use `-i`/`--image`
  or ASCII; `<`/`>` as `<LT>`/`<GT>`.
- HEAD-only on the bar side, possibly absent on the 4.0.2 mint: `omarchy bar put`, `togglePanelAt`,
  `omarchy osd`, tray submenu drill-down, the reminders overlay.

## Org apps shipped in Omarchy [60]

- Ship by default: omacalc (`Super+Ctrl+Q`), omawrite (`Super+Shift+W`), omacut, aether, aether.nvim,
  lumon.nvim, herdr (`Super+Ctrl+Enter`), ttfx. Installable: omasnap, omareel (OPR packages),
  monologue (edge channel only, needs webcam), owe (AUR only), elsewhen / notification-center /
  port-forward (git `omarchy plugin add`), omarchy-zsh, omarchy-fish, omarchy-audio-tuner, omarchy-theme-sync.
- **omasnap/omareel are not the shipped capture path**: `Print` → grim/slurp + Tensaku, `Alt+Print` →
  gpu-screen-recorder. Their tests start with an install.
- Doc defects: hype's README `sudo pacman -S hype` installs an unrelated AUR Twitch app; owe's
  `omarchy pkg add owe` cannot work (AUR-only). elsewhen's recipe has a placeholder checksum and
  installs to a path HEAD's plugin catalog never scans — only `omarchy plugin add <git url>` works.
- The theme "marketplace" is a URL paste (`Install → Style → Theme` is a `gum input`);
  `themes.omarchy.org` / `plugins.omarchy.org` did not resolve at review time. Registry-listed repos
  for tests: `bjarneo/omarchy-ash-theme` (colours only), `OldJobobo/omarchy-aonagi-theme` (ships
  extra config files `omarchy-theme-set` must drop and report).
- Herdr in Omarchy: prefix `Ctrl+Space`, detach `prefix+d`, `prefix+q` = reload config. `Ctrl+Space`
  is also the stock fcitx5 trigger — use an `Alt+Enter` fallback to tell a swallowed prefix from a
  broken herdr.

## Desktop utilities and hardware answers in QEMU [25]

- QEMU's single `Virtual-1` output is **not** `eDP/LVDS/DSI`: `omarchy-hw-external-monitors` and
  `monitor-external-active` return true, `monitor-laptop` is empty, `omarchy-brightness-display`
  silently takes the DDC path (exit 1, no OSD). `omarchy-hw-laptop` false (chassis 1, no lid); the
  USB tablet enumerates as a mouse → Laptop Display / Mirror / Touchpad / Touchscreen / Battery
  Percentage rows hidden; only negative paths exist.
- **Audio is testable**: pipewire-pulse `module-always-sink` gives an `auto_null` "Dummy Output", so
  volume keys (via `wtype -k`), OSD, mute and the output switcher work; no source → mic-mute always
  says "Microphone on"; `omarchy-audio-tuning` reports "nothing ships for this laptop".
- Nightlight tint is **visible in screendumps** (Hyprland applies the CTM in its renderer); hyprsunset
  is started on demand; `omarchy-restart-hyprsunset` silently turns nightlight off.
- Idle timings live-reload from `~/.config/omarchy/shell.json`: a 20 s screensaver timeout makes the
  idle/stay-awake path runnable in-session; `get-image` does not reset idle.
- Screenshot picker is keyboard-drivable: `Return` window, `Ctrl+Return` screen, `Tab`/arrows, `Esc`.
  Screen recording is the CPU x264 fallback; kms capture may not start on virtio-gpu — use
  `OMARCHY_SCREENRECORD_DEBUG=true` and the portal-backend retry to separate VM limit from defect.
- `omarchy-plugin-add file:///tmp/repo --yes` exercises the full add/validate/enable/update/remove
  pipeline offline; `omarchy-plugin-clone omarchy.clock` gives a visible third-party widget.
- `omarchy-notification-send` rejects a forged hint only in option position (a leading `--hint=…`
  becomes the headline by design). `Ctrl+Alt+Delete` is bound to close-all-windows, not reboot.

## Manual applications [11]

- `Setup → Defaults → Browser` / `→ Terminal` list **every** option, installed or not (no `when`);
  picking an uninstalled one launches its installer. Manual says installed-only.
- `Super+Shift+G` / `Super+Shift+/` / `Super+Shift+M` (Signal/1Password/Spotify) **install immediately**;
  the sudo prompt is the only chance to back out (manual says "offers to install").
- ChatGPT and Grok are hotkey-only web apps: no `.desktop`, so absent from the launcher and from
  `Remove → Web App`.
- `tdl` ends with `tmux select-pane -t "$opencode_pane"` (undefined; only `tds` sets it) → may print
  `can't find pane`. `tds` hard-codes `nvim .` instead of `$EDITOR`.
- Node.js is provisioned at install (`install/user/mise-work.sh`): `Install → Development → JavaScript
  → Node.js` is dim on a fresh disk.
- `omarchy webapp remove <unknown>` notifies success; `omarchy share <bogus-mode>` opens the file
  picker instead of rejecting.

## Guest geometry and Hyprland behaviour [40]

- Output is `Virtual-1` at **1280×800**, scale `"auto"` → 1. Scaling ladder (`Super+/`):
  1 → 1.25 → 1.6 → 2 → 3.2 → 4 (4 leaves a 320×200 desktop; step once and back).
- `Super+O` pop default 1300×900 exceeds the screen and is clamped; scratchpad is a 770×385 centred box.
- **`anr_missed_pings = 3`**: Chromium/Obsidian startup on 2 vCPU can raise Hyprland's "not
  responding" dialog — the driver must click **Wait**, not report a hang.
- Load order in `hyprland.lua`: monitors → input → bindings → looknfeel → autostart → toggles/
  workspace-layouts. A syntax error in `bindings.lua` leaves defaults working but **skips looknfeel,
  autostart and persisted toggles** on that reload (no-gaps / scrolling layout silently revert).
  Hyprland shows a red banner; the package reload guard suppresses it and pauses autoreload.
- Version skew: HEAD chords that may be absent on the 4.0.2 mint — tiled fullscreen,
  fullscreen-desktop, square-aspect, bar-panel numbers, zoom, herdr, scratchpad grave aliases, slurp
  selection binds, width save/restore. **Check the `Super+K` row first; report "absent on this build",
  not "broken".**
- Spotify/Signal/1Password chords open the floating installer terminal (Ctrl+C aborts cleanly);
  `Super+Ctrl+Delete` says "No laptop display found"; `Super+Shift+D` (Docker TUI) always prompts a
  polkit password (user deliberately not in the docker group); `Super+Ctrl+1-9` beyond the bar's
  panel count silently no-ops.
- Not drivable: Copilot key `code:201`, lid switch, webcam overlay chords.

## Lock screen, idle, plugins [32]

- The lock screen **blanks 5 s after the last input** (`hyprctl dispatch dpms off`) and re-arms on
  every wake. Any pause > 5 s yields a black screenshot. A mouse move is the harmless wake; the first
  character typed while black both wakes and enters the field. Take a second screenshot ~1 s after
  waking (virtio modeset).
- **No clock or user name on the lock screen** — only the field with `Enter Password` / `Checking…` /
  `Authentication failed (N)`. (The clock appears only in `ctrl.md`'s example definition, not in the stored `lock-screen` v7.)
- Idle: 150 s screensaver / 300 s lock. To test the chain, shorten `idle.screensaver`/`idle.lock` in
  `~/.config/omarchy/shell.json` (watched live). **`shell.json` is replace-not-merge**: a user file
  with only `version` + `idle` silently swaps the bar to the builtin minimal layout — copy
  `$OMARCHY_PATH/config/omarchy/shell.json` first, then edit in place with `jq`. Screenshots do not
  count as activity; any key/mouse cancels the cycle.
- faillock: `deny=10 unlock_time=120`, per user — the 11th attempt fails even with the right
  password, and `sudo` is blocked for the same 120 s; a successful unlock resets. Wrong-password
  tests on the same disk within 15 min accumulate.
- `omarchy-restart-shell` **refuses while locked** (schedule via `sleep N; omarchy-restart-shell &`
  before locking to test). `pkill -9 quickshell` while locked exercises stranded-lock recovery
  (`allow_session_lock_restore = true`; the box returns within ~10 s).
- Plugin lifecycle (add/enable/disable/remove/update/rollback/validate) is fully testable **offline**
  with a local `git init` repo as origin (the URL guard accepts bare paths). plugins.omarchy.org
  currently lists zero plugins; a NET add test must have the driver verify a URL first.

## Menu and hotkeys (HEAD)

- `Super+Space` = Omarchy menu root; `Super+Escape` = the **System** submenu (what the existing
  `lock-screen` definition calls "Omarchy Menu"); `Super+Alt+Space` = Apps. [orchestrator, 50]
- `Super+L` = workspace layout toggle (not lock). Lock = `Super+Ctrl+L`. [orchestrator]
- `omarchy-toggle-bar on` **hides** the bar ("hidden on"); `off` reveals it. `Super+Shift+Space`
  toggles. Hidden bar is still mapped, parked off screen. [50]
- Menu keyboard walk used by the acceptance suite: `Super+Space → Down×3 (Style) → Down×4 (Menu
  Bar) → Enter (Position) → Down×2 (Left)`. TUI/menu pickers may not filter on typing. [50]

- **Menu guards paint from the previous evaluation**: after any state change (default set, web app
  installed/removed), reopen the menu **twice** before asserting a ✓ moved or a row appeared. [22]
- Menu keys: Escape is two-stage (first clears the filter, then closes); Backspace on an empty
  filter goes **back a level**, not close. Right-click on the bar's Omarchy logo opens a **terminal**,
  not the menu. [22]
- `Update → Timezone` from the menu **works passwordless**: `etc/sudoers.d/omarchy-tzupdate` grants
  NOPASSWD for `timedatectl set-timezone <Zone>` (present since 4.0.2). [41; corrects 22]
- **No default agent ships**: all 14 `Setup → Defaults → Agent` rows unchecked; `Super+Shift+Ctrl+A`
  opens that submenu; `omarchy agent` exits 1 with a hint; picking an agent starts a mise install
  (NET, minutes). The first-run "Set your default agent" notification may already be consumed on the
  minted disk. [22]
- Hidden on the stock VM by guards: Laptop Display, Mirror Display, Hybrid GPU, Touchpad, Battery
  Percentage, Fingerprint, Wi-Fi QR, webcam recording, Extra Themes, all `Remove →` AI/Services/
  Development/Gaming/Browser/Security submenus. `Trigger → Hardware → Touchscreen` uncertain (QEMU USB
  tablet may register as a tablet). `Update → Hardware → Audio/Wi-Fi/Bluetooth/Trackpad` have no
  guards and stay visible. [22]
- Web app install: same name silently overwrites (no duplicate check); bad input refused with exact
  messages before any icon fetch. [22]

## Update, power, system [24]

- **HEAD vs the 4.0.2 disk**: the minted disk runs 4.0.2 scripts until `omarchy update` swaps the
  package mid-run. Menu rows/commands added since 4.0.2 (channels, crash mute, Reset Computer) may be
  missing on a pristine disk. Recommendation: run the update once and `save` that disk as the new mint.
- The "already up to date" second run must happen **after the reboot**: the kernel check in
  `omarchy-update-restart` re-prompts "Linux kernel has been updated. Reboot?" on an un-rebooted disk.
  First update on a months-old 4.0.2 disk is hundreds of MB to > 1 GB (SLOW, likely > 5 min).
- No-network cannot be produced by the driver; the only user-reachable simulation is a bogus
  `/etc/pacman.d/mirrorlist`. In that state `omarchy-update-available` prints "Omarchy is up to
  date" (exit 1) — offline is indistinguishable from current; the bar icon just does not show.
- **Crash capture is silent on a stock disk** until a default agent is set: write `claude` into
  `~/.config/omarchy/defaults/agent`, then `sleep 300 & kill -SEGV $!` reliably triggers the toast.
- `omarchy-snapshot <typo>` exits 0 silently (candidate defect).
- **Suspend in QEMU is one-way for the driver** (wake needs the QEMU monitor): make suspend the last
  action of its session, expect `stop`. Pre-suspend lock path proven via `omarchy-system-sleep-lock`.
- No battery/AC/lid/power button; `omarchy-debug` never offers "Upload log" (ICMP blocked).
- **Every LUKS passphrase change must end back at `prime`** or the fleet cannot `--resume` the disk.

## Snapshots, security, factory reset [13]

- `omarchy-snapshot <anything-else>` has no default `case` branch: prints nothing, exits 0 (defect;
  also seen by 24).
- `omarchy-setup-security-sshd --key=<bad>` enables sshd and opens port 22 **before** validating the
  key, exiting 1 with password auth still on (conflicts with "ssh is off until you turn it on").
- Unattended `authorized_keys` opens 22 with `ufw allow` (not the rate-limited `ufw limit` the
  security chapter describes) and does not disable password auth. (ISO repo; only testable from ISO.)
- Direct Boot persistence depends on OVMF NVRAM being writable — it is: the harness gives each machine
  its own `OVMF_VARS` copy (`src/qemu/args.ts`).
- Factory reset sanitises `@factory` **before** asking for the LUKS passphrase: even a cancelled run
  mutates the baseline — fine on a discarded disk, never `save` afterwards.
- Provisioning code is VM-aware: waits for the virtio-gpu console resize before drawing the
  first-boot form. `manual/51`'s recommended VM is q35 + OVMF + virtio-vga — exactly this harness.
- faillock deny=10 / auto-unlock 120 s is unstated in the manual (45:39): lockout tests must act fast.

## Manual configuration [12]

- "Any process that needs restarting will be restarted after you quit the editor": explicit restarts
  exist only for Hyprsunset/XCompose, but Hyprland **autoreloads** its config on save, so a change in
  `Setup → Monitors` applies without `hyprctl reload` — the manual is true in effect
  (03-INTENDED-BEHAVIOUR #19, corrects 12).
- Shipped monitor scale is `omarchy_monitor_scale = "auto"` with fixed `omarchy_gdk_scale = 2`: on
  the 1× virtio display GTK/XWayland apps (Nautilus, file chooser) render **oversized** — expected,
  not a bug to report.
- `Update → Config` restores **groups** (Hyprland restores all seven `~/.config/hypr` files);
  backups are `.bak.<epoch>`. Per-file restore is the CLI `omarchy-refresh-config hypr/<file>.lua`.
- `omarchy plugin clone --edit` opens `$EDITOR`, which on Omarchy is `omarchy-launch-editor --inline`
  → the default editor after all; no inconsistency (03-INTENDED-BEHAVIOUR #28, corrects 12).
- `omarchy plymouth current` identifies the theme by logo byte-compare: a custom set with the stock
  logo reports `default`.

## Manual basics [10]

- `Super+Ctrl+Alt+W` opens the weather **panel**, not a notification (manual says notification); the
  toast path is right-click on the weather widget.
- Clipboard history `Return` **pastes immediately** (Shift+Insert), manual says clipboard-only.
  `Shift+Return` copy-only, `Delete`, `Shift+Delete` clear all, `Alt+Return` open — undocumented.
  Emoji picker **inserts** into the focused window and deliberately leaves nothing on the clipboard.
- `Super+Ctrl+Alt+B` on a battery-less machine sends a toast with an **empty headline** (defect the VM
  reproduces every run).
- `Super+Shift+B` is bound to the browser but absent from the hotkey table; themes chapter previews
  19 of 22 themes; Stay Awake lives in `indicators/stay-awake` and DND in `notifications.json`, so
  `omarchy-toggle-enabled` cannot query either.
- Visible right-section panels on the VM: Network / Audio / Display → `Super+Ctrl+1/2/3`; 4–9 no-ops.
- The first `Return` in a freshly opened menu only settles the cursor.

## Panels and pickers [31]

- Self-hiding bar widgets on the VM: bluetooth, power and agents icons absent by design; the weather
  pill appears only after a network fetch. So `Super+Ctrl+1..9` panel counting may shift — count the
  icons on the screenshot first.
- Network panel on wired QEMU: no Wi-Fi switch/QR/band/list; **Ping "Timeout" / Packet Loss "100%" in
  red is the expected reading** (user-mode NAT drops ICMP), not a failure.
- Polkit: DNS pills run `omarchy-dns` as root silently (`etc/sudoers.d/omarchy-dns`, present since
  4.0.2 — no polkit dialog). Deterministic trigger from a terminal: `pkexec true`
  (Escape → exit 126; wrong password → red "Wrong" + shake, retry allowed).
- Escape is two-stage in menu, clipboard, emoji and filterable image picker (clear filter, then
  close); Backspace/Left on an empty filter go back a submenu.
- UI actions that persist to disk (theme/background pick, scale pill, text-size notch, clock format
  cycle, week-start toggle, DNS provider): restore the original or end with `stop`.
- Disabled Install rows are dimmed 40 %, skipped by cursor/click and omitted from search; a fully
  guarded submenu (Trigger → Hardware on the VM) vanishes from its parent and its route opens
  "Nothing here yet".

## Themes and styling [21]

- **22 stock themes** (not 24). Light/dark is `mode = …` in `colors.toml`; 5 light: catppuccin-latte,
  flexoki-light, lupine, rose-pine, white. No theme ships a `light.mode` file.
- **No `theme-next` script and no hotkey for `omarchy-theme-bg-next` at HEAD.** `Super+Shift+Ctrl+Space`
  opens the theme *picker*, `Super+Ctrl+Space` the background *picker*. Cycling all themes is a CLI loop.
- **Re-applying the current theme advances the wallpaper** (picks the entry after the current
  symlink); only `omarchy-theme-refresh` keeps it. Tests that re-set a theme must expect the
  background to move.
- `omarchy theme remove` deletes the active *user* theme without a guard; stock themes can never be
  removed (looks only in `~/.config/omarchy/themes`). After removing the active one,
  `theme-refresh`/`theme-set <same>` fail with "does not exist".
- Plymouth: sudo password inside the floating terminal, ImageMagick recolour, `limine-mkinitcpio`
  (1–4 min on 2 vCPU), reboot to prove. `plymouth current` is a byte-compare (cannot tell `white`
  from `vantablack`). `set-by-theme <unknown>` → "Invalid background color: (expected #RRGGBB)".
- Default terminal on the disk is **foot**: theme retint is OSC-only; font changes need a new window.
- `file://` is an allowed git transport for `omarchy-theme-install`: the install path can be tested
  offline with a local repo made inside the guest.

## Timeouts the acceptance suite uses (reuse in hints)

- 15 s for any overlay/layer to open or close; 20 s bar position change; 30 s bar/background on
  screen, pipewire, weather text, image selectors (thumbnails); 45 s app launch; 60 s
  `omarchy-shell shell ping` after boot and apps-menu Omawrite launch; 30 s window close. [50]

## Exact expected strings (copy into proofs)

- Window classes: `^foot$`, `(?i)chromium`, `org.omarchy.nvim`, `(?i)omawrite`. [50]
- `omarchy-default-browser` → `chromium`; `omarchy-default-terminal` → `foot`;
  `omarchy-default-editor` → `nvim`; `xdg-mime query default x-scheme-handler/http` →
  `chromium.desktop`; `inode/directory` → `org.gnome.Nautilus.desktop`. [50]
- Kernel: `pkgbase` → `linux-omarchy`. [50]
- CUPS: `stat /etc/cups/cups-files.conf` → `root:cups 640`; `lpinfo -v` as user → `Forbidden`. [50]
- sshd after hardening: `sshd -T` → `passwordauthentication no`, `kbdinteractiveauthentication no`;
  `ufw status` → `22/tcp LIMIT`. [50]
- OCR-able texts: `Apps`, `Theme`, `Shutdown`, `SAN FRANCISCO`, `WIND`, `Bluetooth`,
  `Reminder message`, `Acceptance notification`. [50]
- Notification send: `omarchy-notification-send "Acceptance notification" "Shell notification rendering" --expire-time=15000`. [50]
- Weather: `omarchy-weather-location --set "San Francisco" "37.7749,-122.4194"`. [50]

## Installs that fit the VM budget (NET; sizes approximate) [23]

- Small (< 1 min): Nerd fonts except Iosevka (2–10 MB), `vim`, `helix`, `kitty`/`alacritty`/`ghostty`,
  `sublime-text-4`, `tailscale`, `xpadneo-dkms`, Xbox Cloud web app (icon only), `php`+composer,
  mise `node`/`bun`/`deno`/`python`/`zig` (30–60 MB), `redis:7` image, `ollama`, `firefox` (~75 MB).
- Medium (1–3 min): 1Password, Claude Desktop, T3 Code, Signal, VSCode (~100–120 MB), Voxtype +
  model (~170 MB), Go, Rust.
- Too big for a session: Steam, RetroArch, Lutris, Heroic, Battle.net, GeForce NOW, LM Studio,
  Hermes Desktop, OpenClaw onboarding, Elixir/OCaml (source builds), Java/.NET/Scala, Windows VM,
  `omarchy-install-preinstalls` (~700 MB), `omarchy-reinstall-pkgs`.

## Likely defects surfaced by reading (each deserves a pinning test)

- `omarchy-install-gaming-gpu-lib32` exits 1 when no Intel/AMD/NVIDIA GPU is detected; Steam,
  Heroic, Lutris, Battle.net call it under `set -e` → they end `Failed (exit code 1)` on virtio-vga. [23]
- Tailscale install blocks at `sudo tailscale up` waiting for a browser login; Ctrl+C from the menu's
  floating terminal kills everything (exit 130), so the follow-up setup never runs. From a plain
  terminal, abort then `tailscale status` → `Logged out.`. [23]
- `omarchy-install-docker-dbs` on Escape calls undefined `main_menu` → `main_menu: command not found`. [23]
- `omarchy-install-dev-env <unknown>` succeeds silently; its remover rejects unknown names. [23]
- `omarchy-remove-security-fido2` on stock likely fails: removing libfido2 breaks openssh dependency. [23]
- Windows VM in the guest: `Insufficient disk space! Required: 74GB` (40 GB disk) or the KVM check,
  exiting after creating `~/.windows` and `~/Windows`; `status`/`launch`/`stop` exit 1 cleanly. [23]
- Many Install rows have no Remove counterpart (1Password, Signal, Spotify, NordVPN, ONCE, Bitwarden,
  all terminals, Helix/VSCode/Zed/Emacs/Cursor/Sublime; Sunshine has no menu row); the only uninstall
  path is the Apps menu `Delete` key, which leaves `~/.config` state behind. [23]

## Hardware-less paths in QEMU

- Power panel hidden without battery; bluetooth/network/audio panels open in empty states. [50]
- Unobservable by screenshot: "layer mapped but off screen", the `omarchy-keyboard-panel-dismiss`
  layer that must not exist on single monitors, runtime-smoke IPC/plugin-fixture contracts. [50]
