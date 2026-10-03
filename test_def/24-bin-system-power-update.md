# 24 — bin: system, power, update, snapshot, provisioning, security setup

Reviewer notes for the update pipeline, the power/system menu, snapshots, hibernation, power
profiles, battery, drive encryption, crash capture, factory reset / provisioning, channels, sudo
toggles and debug output. Source: `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18. Target disk:
minted `omarchy-4.0.2.iso`, user `prime` / `prime`, LUKS `prime`.

## Scope

Read completely (line counts from `wc -l`):

- `bin/omarchy-update*` — 22 scripts, 807 lines: `omarchy-update` (65), `-analyze-logs` (13),
  `-aur-pkgs` (14), `-available` (44), `-confirm` (18), `-dev` (21), `-firmware` (18), `-keyring` (31),
  `-lock` (47), `-mise` (12), `-orphan-pkgs` (29), `-pacman` (25), `-pacman-guard` (64), `-pkg-prune` (13),
  `-requires-free-space` (17), `-restart` (51), `-status` (12), `-stay-awake` (146), `-system-pkgs` (39),
  `-system-pkgs-when-conflicted` (115), `-time` (7), `-user-notify` (6).
- `docs/update-process.md` — 336 lines.
- `bin/omarchy-system-*` — 11 scripts, 967 lines: `factory-reset` (452), `factory-reset-finish` (168),
  `lid-close` (20), `lock` (26), `logout` (13), `reboot` (17), `shutdown` (17), `sleep-lock` (124),
  `sleep-monitor` (61), `stats` (59), `wake` (10).
- `bin/omarchy-power-present` (14); `bin/omarchy-hibernation-{available,remove,setup}` (19/54/166);
  `bin/omarchy-powerprofiles-{init,list,set}` (5/17/63); `bin/omarchy-battery-{low,present,status}`
  (17/12/137); `bin/omarchy-snapshot` (49); `bin/omarchy-drive-{info,password,select}` (50/32/18);
  `bin/omarchy-crash-{mute,watch}` (73/109); `bin/omarchy-provision-{first-run,owner,user}`
  (99/1139/131); `bin/omarchy-setup-{direct-boot,security-fido2,security-fingerprint,security-sshd,security-sudoless-docker}`
  (61/148/111/212/49); `bin/omarchy-sudo-{docker,keepalive,passwordless}` (44/9/71);
  `bin/omarchy-channel-{current,set}` (30/103); `bin/omarchy-migrate` (102), `bin/omarchy-migrate-notify`
  (60); `bin/omarchy-done` (40); `bin/omarchy-debug` (96), `bin/omarchy-debug-idle` (61).
  **67 scripts, ≈5,175 lines.**
- `default/snapper/root` (10); `default/limine/limine.conf` (20), `default/limine/default.conf` (3);
  `default/systemd/**` (23 files: zram, faster-shutdown, user units `omarchy-sleep-lock`,
  `omarchy-migrate-notify`, `omarchy-crash-watch`, `omarchy-recover-internal-monitor`, `app.slice.d/10-oomd.conf`,
  system-sleep hooks `unmount-fuse`, `keyboard-backlight`, `force-igpu`, camlink/supergfxd/plocate drop-ins);
  `default/sddm/omarchy/Main.qml` (117) + `theme.conf`, `metadata.desktop`, `default/sddm/hyprland.lua`;
  `default/plymouth/omarchy.script` (262), `omarchy.plymouth`.
- Supporting reads to describe what the driver sees: `etc/limine-entry-tool.d/omarchy-defaults.conf`,
  `etc/systemd/logind.conf.d/*`, `etc/systemd/oomd.conf.d/*`, `etc/sddm.conf.d/*`, `etc/sudoers.d/*`,
  `install/config/snapper.sh`, `shell/plugins/bar/widgets/SystemUpdate.qml`, `shell/plugins/panels/power/Panel.qml`,
  `bin/omarchy-launch-floating-terminal-with-presentation`, `bin/omarchy-show-done`, `bin/omarchy-state`,
  `bin/omarchy-toggle-idle`, `bin/omarchy-toggle-suspend`, `bin/omarchy-toggle-crash-capture`,
  `bin/omarchy-agent-crash`, `bin/omarchy-default-agent`, `bin/omarchy-version`, `bin/omarchy-version-channel`,
  `bin/omarchy-hw-laptop`, `default/agents/skills/diagnose-crash/SKILL.md` (head).
- Menu: System / Update / Setup.security / Setup.direct-boot / Setup.reset / Trigger.toggle entries in
  `default/omarchy/omarchy-menu.jsonc`; hotkeys in `default/hypr/bindings/utilities.lua`, `media.lua`.
- Skimmed for invariants (comments + assertions): `test/shell.d/update-*-test.sh` (13),
  `system-lock-test.sh`, `system-power-test.sh`, `power-present-test.sh`, `powerprofiles-set-test.sh`,
  `power-test.sh`, `snapshot-create-test.sh`, `snapper-test.sh`, `snapper-timeline-leak-test.sh`,
  `sleep-lock-test.sh`, `sleep-monitor-test.sh`, `lid-close-test.sh`, `drive-password-test.sh`,
  `crash-capture-test.sh`, `factory-reset-accounts-test.sh`, `provision-user-test.sh`, `setup-form-test.sh`,
  `nopasswd-sudo-expiry-test.sh`, `limine-defaults-test.sh`, `channel-test.sh`, `version-test.sh`.

Skipped: PNG assets under `default/sddm`, `default/plymouth` (binary); the `omarchy` CLI router beyond
confirming `omarchy update` / `omarchy crash mute` routes; the Quattro ISO installer (separate repo —
it is what takes the `@factory` snapshot and configures Snapper; whether the 4.0.2 ISO does both is
unverified here); `install/provisioning/setup-form.sh` (owned by the provisioning reviewer).

## Inventory

Format: `command [flags]` — what it does — needs (sudo / terminal / TUI) — reach (menu path, hotkey,
service). Source in parentheses.

**Update pipeline**
- `omarchy-update [-y]` (alias `omarchy up`) — full update: `script` transcript → `/tmp/omarchy-update.log`,
  per-user flock `$XDG_RUNTIME_DIR/omarchy-update.lock`, 10 GiB free check, gum confirm, `paccache -rk2`,
  snapper snapshot, stay-awake, dev checkout ff, keyring, `pacman -Syu --noconfirm --overwrite '/usr/share/omarchy/*'`,
  migrations, `omarchy-hook post-update`, AUR (`yay -Sua`), `mise up`, orphans prompt, log analysis,
  bar-indicator refresh, restart/reboot prompts. sudo + terminal (gum). Menu → Update → Omarchy; bar
  update icon click. (`bin/omarchy-update`)
- `omarchy-update-confirm` — gum box "Ready to update?" + `gum confirm "Continue with update?"`; No → "Update
  cancelled", exit 1. terminal. (`-confirm`)
- `omarchy-update-requires-free-space` — exit 1 + "You need at least 10 GiB free to safely update Omarchy."
  below 10 GiB on `/`; `OMARCHY_UPDATE_FORCE=1` bypasses; unreadable `df` → silently passes. hidden.
- `omarchy-update-lock <held|run cmd…>` — flock wrapper; second runner prints "An Omarchy update is
  already running." exit 1. hidden.
- `omarchy-update-pkg-prune` — green "Prune package cache", `sudo paccache -rk2`; failure only warns. sudo.
- `omarchy-update-stay-awake <start|stop>` — `systemd-inhibit --what=sleep:idle --who=omarchy-update
  --mode=block` (via sudo, `sudo -v` first on a tty; pkexec otherwise) + `omarchy-toggle-idle stay-awake`
  only if the user had idle allowed; `stop` restores only what it changed. hidden, sudo.
- `omarchy-update-dev` — no-op on package installs (`OMARCHY_PATH == /usr/share/omarchy`); dev-link →
  `git pull --ff-only`; error if `OMARCHY_PATH` is not a checkout.
- `omarchy-update-keyring` — recv/lsign Omarchy key if missing, `pacman -Sy --noconfirm archlinux-keyring`
  every run, prints "Update Arch signing keys" then "Keys are correct". sudo. Fails the update on any
  keyring error (`set -euo pipefail`).
- `omarchy-update-system-pkgs` — green "Update system packages"; stderr captured to a temp report; on
  failure execs the conflict handler. sudo.
- `omarchy-update-system-pkgs-when-conflicted <report>` — refuses to run outside the update
  (`OMARCHY_UPDATE_CONFLICT=1`); quarantines unowned `omarchy*: /path exists in filesystem` files under
  `/var/lib/omarchy/replaced` ("Taking over files pacman doesn't own yet:") and retries once, restoring
  what the retry did not claim ("Putting back what the upgrade didn't take:"); package-vs-package
  conflict → interactive pacman re-run ("A package conflict stopped this upgrade. Running it again so you
  can answer:") or, under `-y`/no tty, "This upgrade needs an answer. Run omarchy update interactively to
  give it." exit 1. hidden.
- `omarchy-update-pacman <pacman-args>` — `sudo env OMARCHY_UPDATE_PACMAN=1 systemd-run --scope pacman …`
  (PID 1 scope so a systemd reexec cannot kill the transaction). hidden.
- `omarchy-update-pacman-guard` — ALPM PreTransaction hook body; aborts `-Syu`/`--sync --sysupgrade`
  unless `OMARCHY_UPDATE_PACMAN=1` or `OMARCHY_ALLOW_DIRECT_PACMAN=1`; prints the "Woah partner..." message
  with the bypass command. Reads `/proc/$PPID/cmdline` or `OMARCHY_PACMAN_CMDLINE`. hidden.
- `omarchy-migrate [--pending|--check]` — runs `$OMARCHY_PATH/migrations/*.sh` without a marker in
  `~/.local/state/omarchy/migrations/`; green "Running migration (<name>)"; waits up to 900 s on
  `/var/lib/pacman/db.lck`; `--pending` lists names, exit 0 if any else exit 1 silent; unknown flag →
  "Unknown option: …" exit 1. Dismisses the "Omarchy Migrations" toast when done.
- `omarchy-migrate-notify` (+ `omarchy-update-user-notify` compat wrapper) — login-time oneshot
  `omarchy-migrate-notify.service` (user, after `graphical-session.target`); critical toast "Pending
  Omarchy Migrations" / "Click to run N pending migration(s)." → floating terminal `omarchy-migrate`;
  silent while the update lock is held.
- `omarchy-hook post-update` — user hooks from `~/.config/omarchy/hooks/post-update(.d)`.
- `omarchy-update-aur-pkgs` — only when `pacman -Qem` lists foreign packages: "Update AUR packages" via
  `yay -Sua --noconfirm`, or red "AUR is unavailable (so skipping updates)".
- `omarchy-update-mise` — "Update mise tools", `MISE_MINIMUM_RELEASE_AGE=0 mise up` when mise present.
- `omarchy-update-orphan-pkgs` — lists `pacman -Qtdq`; tty → `gum confirm --default=false "Remove N
  orphaned package(s)?"`; no tty → advisory line. sudo on removal.
- `omarchy-update-analyze-logs` — red "Error: Initramfs generation may have failed. Review logs before
  restart." if the transcript has "Updating linux initcpios" without "Initcpio image generation successful".
- `omarchy-update-status` — `omarchy-shell -q omarchy.system-update refresh|clear` per
  `omarchy-update-available`. hidden.
- `omarchy-update-available` — dev-checkout behind count, then `checkupdates` for `omarchy-dev`/`omarchy`;
  prints update lines exit 0, or "Omarchy is up to date" exit 1. Used by the bar widget
  `omarchy.system-update` (icon `\uf021`, tooltip "Pending Omarchy Updates", checked at shell start and
  every 6 h, click → `omarchy-launch-floating-terminal-with-presentation omarchy-update`). NET.
- `omarchy-update-restart` — reboot prompts (`gum confirm`): "Linux kernel has been updated. Reboot?"
  (running kernel has no owning module dir), "Updates require reboot. Ready?" (`~/.local/state/omarchy/reboot-required`),
  "Hyprland has been updated. Reboot?" (exe deleted); restarts services with `restart-*-required` markers;
  always "Restarting shell" / "All plugins have been reloaded" → `omarchy-restart-shell`.
- `omarchy-update-firmware` — installs fwupd if missing, copies `fwupdx64.efi` to `/boot/EFI/arch/`,
  `fwupdmgr refresh --force`, `sudo fwupdmgr update`. sudo, NET. Menu → Update → Firmware.
- `omarchy-update-time` — "Updating time...", `sudo systemctl restart systemd-timesyncd`. Menu → Update → Time.

**System / power**
- `omarchy-system-lock` — `omarchy-shell lock lock`, resets xkb layout to 0, locks 1Password if running,
  kills `ttfx`/screensaver. Hotkey `Super+Ctrl+L`; Menu → System → Lock (`Super+Escape` opens System
  directly; `XF86PowerOff` too because logind has `HandlePowerKey=ignore`).
- `omarchy-system-logout` (alias `omarchy logout`) — OSD "Logging out" 5 s, closes all windows, `uwsm
  stop` after 2 s → SDDM greeter. Menu → System → Logout.
- `omarchy-system-reboot` / `omarchy-system-shutdown` — `systemd-run --user --on-active=2s systemctl
  reboot|poweroff --no-wall` (exit 1 if scheduling fails, nothing else touched), OSD "Rebooting" /
  "Shutting down", `omarchy-state clear re*-required`, close all windows. Menu → System → Reboot/Shutdown.
  Reboot is also the "Yes" of every update reboot prompt.
- `systemctl suspend` — Menu → System → Suspend, hidden when `omarchy-toggle-enabled suspend-off`
  (`omarchy-toggle-suspend` flips it with toasts "Suspend removed from system menu" / "Suspend now
  available in system menu").
- `systemctl hibernate` — Menu → System → Hibernate, shown only when `omarchy-hibernation-available` passes.
- `omarchy-system-sleep-monitor [--consume|--inhibited]` — `systemd-inhibit --what=sleep --mode=delay
  --who=Omarchy --why="Lock screen before suspend"` around a `dbus-monitor` for `PrepareForSleep true` →
  runs `omarchy-system-sleep-lock`. Runs as user service `omarchy-sleep-lock.service` (Restart=always).
- `omarchy-system-sleep-lock [budget-ms]` — asks the shell to lock and polls `lock status` until
  `.secure` within a budget derived from logind `InhibitDelayMaxUSec` (shipped 15 s → 12 s cap); on
  failure prints "omarchy-system-sleep-lock: suspending without a secure lock (…)" and sends a critical
  toast "Screen did not lock before suspend", exit 1. Runnable by hand.
- `omarchy-system-lid-close` — locks only if `omarchy-hw-laptop-closed && ! omarchy-hw-external-monitors`,
  then `omarchy-hyprland-monitor-clamshell`. Bound to `switch:on:Lid Switch` (locked). No lid in the VM.
- `omarchy-system-wake` — `omarchy-brightness-display on`, keyboard backlight restore, clamshell sync.
- `omarchy-system-stats [--bar-widget]` — `cpu\tNN%`, `memory\tX.XGB / NGB`; `--bar-widget` raw
  counters; other arg → usage exit 1. Feeds the power panel.
- `omarchy-system-factory-reset` — self-elevates with sudo; requires btrfs `subvol=/@` and `@factory`;
  refuses with yellow "This machine has no factory snapshot to reset to." otherwise; red "Reset this
  computer to factory state?" + `gum input` "Type 'reset' to continue" ("Error: Reset not confirmed."
  otherwise); on LUKS asks "Confirm your disk encryption passphrase to authorize the re-key." (loops on
  "That passphrase does not unlock …"); stages clone/scrub/rekey/UKI rebuild with grey log lines; "Reset
  staged. The wipe finishes on the next boot." + `gum confirm` "Reboot now"/"Reboot later". Menu → Setup →
  Reset Computer (only on btrfs). Log `/var/log/omarchy-system-factory-reset.log`.
- `omarchy-system-factory-reset-finish` — root oneshot on next boot (armed by
  `/var/lib/omarchy/provisioning/wipe-pending`): deletes `@omarchy-old-*`, recreates `@home`/`@log`,
  repairs `/.snapshots`, `fstrim`, journal lines `factory-wipe: …`.
- `omarchy-power-present` — exit 0 if a `Mains`/`USB` supply is online. `omarchy-battery-present` — exit
  0 if `BAT*` present. `omarchy-battery-status [--shell]` — upower-derived line "Battery NN% · … · W /
  Wh"; prints nothing exit 0 without a battery; bad flag → usage exit 2. `omarchy-battery-low <pct>` —
  critical toast "Time to recharge!" / "Battery is down to N%" (30 s) + `omarchy-hook battery-low`;
  arg count ≠ 1 → usage exit 1. Hotkey `Super+Ctrl+Alt+B` → `omarchy-notification-battery`.
- `omarchy-powerprofiles-list [--active-state]` — parses `powerprofilesctl list`; bad flag → usage exit 1.
  `omarchy-powerprofiles-set [autodetect|ac|battery] [power-saver|balanced|performance]` — remembers per
  ac/battery in `~/.local/state/omarchy/powerprofiles/`; "Power profile is not available: X" exit 1;
  bad action or >2 args → usage exit 1. `omarchy-powerprofiles-init` — autostart (`autostart.lua`) →
  `set autodetect`. GUI picker: power panel `omarchy.power` (`Super+Ctrl+P`, bar battery icon) — hidden
  without a battery.
- `omarchy-hibernation-available` — exit 0 only when non-zram swap > `/sys/power/image_size` and
  `/etc/mkinitcpio.conf.d/omarchy_resume.conf` exists. `omarchy-hibernation-setup [--force] [--no-rebuild]` —
  `gum confirm "Use <RAM> on boot drive to make hibernation available?"`, btrfs `/swap` subvolume +
  swapfile = RAM, fstab, resume hook, `resume=`/`resume_offset=` drop-in, `limine-mkinitcpio`, "Reboot to
  enable hibernation?"; already set → "Hibernation is already set up". `omarchy-hibernation-remove` —
  "Hibernation is not set up" if absent, else `gum confirm "Remove hibernation setup?"` and undoes all.
  sudo, terminal. No menu entry (CLI only).

**Snapshot / drive**
- `omarchy-snapshot <create|restore>` — create: `snapper -c <cfg> create -c number -d <omarchy-version>`
  + `cleanup number` for every config, "Create system snapshot" … "Snapshots can be selected during
  boot."; no configs → yellow "No Snapper configs found, so no snapshot was created." + configure hint,
  exit 1; snapper missing → exit 127 silently; no arg → usage exit 1; **unknown arg → silent exit 0**.
  restore: `sudo limine-snapper-restore` TUI. sudo. Config `default/snapper/root`: `NUMBER_LIMIT=5`,
  timeline off; `etc/limine-entry-tool.d/omarchy-defaults.conf`: `MAX_SNAPSHOT_ENTRIES=6`, boot order
  ends with `Snapshots`.
- `omarchy-drive-password` — picks the single `crypto_LUKS` device (or `omarchy-drive-select`), gum
  "New encryption password" / "Confirm new encryption password", "Password cannot be empty." /
  "Passwords do not match." exit 1, then `cryptsetup luksChangeKey --pbkdf argon2id --iter-time 2000` which
  asks "Enter passphrase to be changed:" on the tty. sudo. Menu → Update → Password → Drive Encryption.
- `omarchy-drive-info </dev/x>` — "/dev/vda (40G) - <model> [vfat(/boot), crypto_LUKS]"; no arg → usage exit 1.
  `omarchy-drive-select [devs…]` — gum choose "Select drive", prints device; Esc → exit 1.

**Crash capture**
- `omarchy-crash-watch` — user service `omarchy-crash-watch.service` (after graphical-session, disabled by
  `~/.local/state/omarchy/toggles/crash-capture-off`); follows journal `MESSAGE_ID=fc2e22bc…`; only this
  UID, **only when `omarchy-default-agent` prints something**, not muted, 60 s dedupe per name → critical
  toast "Process crashed: <name>" / "Click to diagnose with AI" → `omarchy-agent-crash <pid> <comm> <exe> <sig>`
  → `omarchy-agent --prompt …` pointing at `default/agents/skills/diagnose-crash/SKILL.md`.
- `omarchy-crash-mute [--] [<program>] [on|off|toggle]` (alias `omarchy crash mute`) — list ("No programs
  muted. Crashes all notify."), "Muted crash notifications for X." / "Crash notifications for X are back
  on."; "Not a program name: …" / "Not an action: …" exit 1. Flags `~/.local/state/omarchy/toggles/crash-ignore/<name>`.
- `omarchy-toggle-crash-capture` — Menu → Trigger → Toggle → Crash Capture; toasts "Crash capture
  disabled"/"enabled", stops/starts the service.

**Provisioning / first run**
- `omarchy-provision-owner [--attempt]` — root, tty1 service when `/var/lib/omarchy/provisioning/pending`;
  greeter (animated logo, "Beautiful, Fun & Agentic Linux by DHH", "Press Return to Start Setup"),
  keyboard → username → password → name/email → hostname → timezone → `gum table` confirm "Does this look
  right?", progress "Setting up your machine" with rotating tips, creates user (+wheel, sudoers drop-in),
  SDDM autologin, `omarchy-provision-user --force --first-install`, LUKS re-key to the user password, limine
  rebuild; failure → "Setup hit an error" + "Try again"/"Drop to console". As user: "Error: … must run as
  root" exit 1; no pending → exit 0 silent.
- `omarchy-provision-user [--force] [--first-install]` — per-user finalization (skill symlinks, xdg dirs,
  gtk bookmarks, `install/user/all.sh`, default browser/mailto); marker `done/finalize-user`; already done →
  "User finalization already complete (rerun with --force to refresh)."; as root → error exit 1.
- `omarchy-provision-first-run [--force]` — first-login hooks (post-update hooks, user units incl.
  `omarchy-crash-watch`, gnome theme, welcome + wifi/update toasts); "First-run already complete (rerun
  with --force to refresh)."; unknown flag → usage exit 1. Log `~/.local/state/omarchy/first-run.log`.
- `omarchy-done <check|mark|ensure> <name>` — markers in `~/.local/state/omarchy/done/`; slash/`.`/`..` →
  "Invalid done marker name" exit 1; wrong arity → usage exit 1.

**Setup / security / sudo**
- `omarchy-setup-direct-boot` — UEFI + `efibootmgr` required; refuses AMI/Apple firmware; toggles an EFI
  entry "Omarchy" → `\EFI\Linux\omarchy*.efi` with `gum confirm "Setup direct boot (so snapshot booting must
  be done via bios)?"` / "Disable direct boot (remove Omarchy EFI entry)?". sudo. Menu → Setup → Direct Boot.
- `omarchy-setup-security-fido2` — installs `libfido2 pam-u2f` (NET), "No FIDO2 device detected. Please plug
  it in…" exit 1 without a token. Menu → Setup → Security → Fido2.
- `omarchy-setup-security-fingerprint` — "No fingerprint sensor detected." exit 1. Menu row hidden
  (`when: omarchy-hw-fingerprint`).
- `omarchy-setup-security-sshd [--key=<pub>] [--gh-keys <user>] [-h]` — installs/enables `sshd`, `ufw limit
  22/tcp`, authorizes a key (GitHub or pasted or flag), then writes `/etc/ssh/sshd_config.d/10-omarchy-hardening.conf`
  (password auth off) after `sshd -t`/`sshd -T` validation; "Not a valid SSH public key: …" exit 1; `--gh-keys`
  without name / both flags / unknown option → exit 2 before any change. sudo, NET. Menu → Setup → Security → SSHD.
- `omarchy-setup-security-sudoless-docker` — warning text, `gum confirm "Enable sudoless Docker? …"`,
  `usermod -aG docker`, `omarchy-state set reboot-required`, "Sudoless Docker ENABLED. It takes effect after
  a reboot.", "Reboot now to apply?"; already enabled → "Sudoless Docker is already enabled…". Menu → Setup →
  Security → Sudoless Docker (shown while `omarchy-sudo-docker --configured` succeeds; then moves to Remove →
  Security).
- `omarchy-sudo-docker [--configured]` — exit 0 when Docker needs sudo (socket unwritable / not in group).
- `omarchy-sudo-passwordless [MINUTES]` — writes `/etc/sudoers.d/99-omarchy-nopasswd-<user>` + transient
  timer `omarchy-nopasswd-expire-<user>` (default 15 min); warning + `gum confirm`; "Passwordless sudo has
  been ENABLED…" / "…DISABLED…" / "…timer updated…"; non-numeric arg → usage exit 1; fails closed if the
  timer cannot be armed. Menu → Setup → Security → Passwordless Sudo.
- `omarchy-sudo-keepalive` — `sudo -v` + background refresher (sourced helper, not user-facing).

**Channel / version / debug**
- `omarchy-channel-current` — `dev` (dev-link), `edge` (omarchy-dev installed), `stable`/`rc` (mirror
  sniff via `omarchy-version-channel`), else `unknown`. Menu → Update → Channel shows ✓ on the current one.
- `omarchy-channel-set <stable|rc|edge|dev>` — `omarchy-refresh-pacman <chan>`, guard-approved `pacman -S
  --needed --noconfirm --ask 4 <pkgs>`, dev-unlink/link, `reboot-required` when crossing dev, then
  `omarchy-update -y`; `dev` first prints a warning and `gum confirm --default=false "Switch to dev
  channel?"` ("Cancelled." exit 0), clones `~/omarchy`; no arg → usage exit 1; unknown → "Unknown channel:
  X" + usage exit 1; ERR trap: "The channel switch did not complete… rerun: omarchy-channel-set <chan>".
  sudo, NET. Menu → Update → Channel → Stable/RC/Edge/Dev.
- `omarchy-version` — pacman version of `omarchy-dev`/`omarchy`, or `dev (<hash>)`; exit 1 if neither.
  `omarchy-version-channel` — mirror/pkgs channel words.
- `omarchy-debug [--no-sudo] [--print]` — writes `/tmp/omarchy-debug.log` (inxi, `sudo dmesg`, journal
  warnings, packages); `gum choose` "Upload log" (only if `ping 8.8.8.8` works — **never in this VM**),
  "View log" (less), "Save in current directory"; unknown option → usage exit 1.
- `omarchy-debug-idle [lines]` — sections `== Time ==` … `== Lock detector ==`; non-numeric arg falls back
  to 200 silently.

**Boot chain configs (what the driver sees on a reboot)**
- Limine (`default/limine/limine.conf`): branding "Omarchy Bootloader", Tokyo Night palette,
  `default_entry: 2`, timeout line commented → Limine default 5 s, `hash_mismatch_panic: no`; entries from
  `limine-entry-tool` (`omarchy-defaults.conf`: UKI `omarchy`, `BOOT_ORDER … Snapshots`), snapshot
  submenu from `limine-snapper-sync`.
- Plymouth (`default/plymouth/omarchy.script`): dark `#1a1b26` background, logo, lock + entry with up to 21
  bullets for the LUKS passphrase, progress bar (fake ease to 70 % over 15 s, then real) after unlock; the
  cmdline keeps `initramfs_async=0` so the themed prompt survives.
- SDDM (`default/sddm/omarchy/Main.qml`, `etc/sddm.conf.d/*`): Wayland greeter on Hyprland, logo, lock
  icon and a password-only box for `userModel.lastUser`; Enter logs in, failure swaps to `lock-failed`/
  `entry-failed` art and clears the field.
- systemd: `DefaultTimeoutStopSec=5s` (system + user), `InhibitDelayMaxSec=15`, `HandlePowerKey=ignore`,
  oomd 50 %/20 s with only `app.slice` killable, zram = RAM zstd prio 100, NOFILE limits, sleep hooks.

## Observations

1. **HEAD vs. the 4.0.2 disk.** Every instruction below names HEAD behaviour. The minted disk runs the
   4.0.2 package's scripts until `omarchy update` swaps the package mid-run; from that point every step
   invoked by name (`omarchy-migrate`, `omarchy-update-restart`, …) is the new version. Menu rows or
   commands added after 4.0.2 (e.g. `omarchy-channel-set`, `omarchy-crash-mute`, Reset Computer) may be
   missing on a pristine disk: if a command prints "command not found", run `update-omarchy-end-to-end`
   first (and `save` that disk) or record it as "absent on 4.0.2".
2. **The floating-terminal presentation wrapper** (`omarchy-launch-floating-terminal-with-presentation`)
   is how every menu-launched command appears: Omarchy logo, the command's output, then
   `● Done! Press any key to close...` (green dot) or `● Failed (exit code N)! Press any key to close...`
   (red dot). Ctrl+C (exit 130) closes without the prompt. The exit-code line is the driver's main proof of
   a negative path.
3. **sudo prompts inside the flows.** The first `sudo` in each terminal asks `[sudo] password for prime:`.
   In `omarchy update` that is at "Prune package cache" (`paccache`), then `sudo -v` for the inhibitor. A
   long pacman step can outlive the sudo timestamp, so a *second* password prompt can appear mid-update
   (migrations, orphan removal). Never leave a prompt waiting.
4. **`omarchy update` screen sequence (HEAD):** box "Ready to update?" (bullets: cannot stop / connect
   power; "What's new: https://github.com/omacom/omarchy/releases/latest") → `Continue with update?` →
   "Prune package cache" → "Create system snapshot" … "Snapshots can be selected during boot." → Stay
   Awake indicator turns on in the bar → "Update Arch signing keys" / "Keys are correct" → "Update system
   packages" (pacman progress) → green "Running migration (<id>)" banners → optional "Update AUR packages"
   → "Update mise tools" → optional "Orphan system packages" + `Remove N orphaned package(s)?` (default
   No) → "Restarting shell" / "All plugins have been reloaded" (bar flickers) → Stay Awake indicator off →
   `Linux kernel has been updated. Reboot?` (almost certain on a 4.0.2 disk) → Yes runs
   `omarchy-system-reboot` (OSD "Rebooting"). Red on any error: "Something went wrong during the update!
   … https://omarchy.org/discord".
5. **The second, "already up to date" run** must happen *after* the reboot: the kernel check is dynamic,
   so an un-rebooted disk prompts "Linux kernel has been updated. Reboot?" again. Expected second run:
   snapshot, "Keys are correct", pacman " there is nothing to do", no migration banners, shell restart,
   no reboot prompt, `● Done!`.
6. **Download size / time.** A 4.0.2 disk is months behind Arch: expect several hundred MB to >1 GB and
   well over five minutes. Tag SLOW; the driver should `save` the updated disk so later tests can start
   from it.
7. **Update indicator** appears only when `checkupdates` (pacman-contrib, network) reports a newer
   `omarchy` package. Offline or with a broken mirror `omarchy-update-available` prints "Omarchy is up to
   date" (exit 1) — indistinguishable from actually current. It is refreshed at shell start, every 6 h,
   and by `omarchy-update-status` at the end of an update (icon disappears).
8. **No network cannot be cut by the driver.** The only user-reachable simulation is a bogus
   `/etc/pacman.d/mirrorlist` (typed with sudo). The Omarchy repo lives in `/etc/pacman.conf`, not the
   mirrorlist, so `pkgs.omarchy.org` still syncs; core/extra fail, `pacman -Sy archlinux-keyring` in
   `omarchy-update-keyring` exits non-zero, `set -e` fires the red banner. Restore the backup afterwards.
9. **The pacman guard fires late**: libalpm runs PreTransaction hooks *after* downloading all packages, so
   a real `sudo pacman -Syu` downloads the whole upgrade before "Woah partner...". Test the guard binary
   directly with `OMARCHY_PACMAN_CMDLINE`; keep the real path as a NET/SLOW note. With nothing to
   upgrade pacman prints "there is nothing to do" and hooks never run.
10. **Suspend in QEMU**: `systemctl suspend` enters S3 (screen freezes/blanks) but the guest is woken by
    the QEMU monitor (`system_wakeup`), which the driver does not have. Keyboard/mouse input via the
    harness may or may not wake it. Treat suspend as the *last* action of its session and expect to
    `stop`. Before sleeping, `omarchy-sleep-lock.service` locks the screen (delay inhibitor, ≤12 s budget).
11. **Hibernate** is hidden in the System menu on the stock disk (only zram swap; zram is excluded by
    `omarchy-hibernation-available`). `omarchy-hibernation-setup` works in the VM (btrfs, 40 GB) and
    makes the row appear after `limine-mkinitcpio`; actually hibernating needs a resume through the
    harness and is out of budget.
12. **No battery, no AC device** in QEMU q35: the power panel is invisible (`visible: batteryPresent`) and
    `Super+Ctrl+P` opens nothing; `omarchy-battery-present`/`omarchy-power-present` exit 1;
    `omarchy-battery-status` prints nothing; `omarchy-hw-laptop` is false (no lid, chassis type 1) so
    "Battery Percentage" and laptop rows are hidden. `omarchy-battery-low N` still sends its toast — the
    one battery path that is fully testable.
13. **power-profiles-daemon** in a VM typically offers only `balanced`/`power-saver` (no platform driver),
    or nothing if the daemon is not running. `omarchy-powerprofiles-set` autodetect resolves to `ac`
    (no UPower battery) and falls back to `balanced`; explicit unknown profiles fail deterministically.
14. **Snapper on the minted disk**: the Quattro ISO is expected to run `install/config/snapper.sh`
    (config `root`, `NUMBER_LIMIT=5`, `limine-snapper-sync` enabled). If `omarchy-snapshot create` says
    "No Snapper configs found", the hint it prints (`sudo bash -euo pipefail
    "/usr/share/omarchy/install/config/snapper.sh"`) fixes it in-guest. Snapshot descriptions are
    `omarchy-version` output (e.g. `4.0.2-1`). `omarchy-snapshot <typo>` exits 0 silently — worth reporting.
15. **Limine menu timing**: the template comments out `timeout`, so Limine's 5 s default applies. To
    reach the Snapshots submenu the driver must send `<DOWN>` (or any key) as soon as the OVMF splash
    gives way; a screenshot after each key press. The snapshot boots read-only
    (`findmnt -no OPTIONS /` shows `ro,…subvol=/@/.snapshots/N/snapshot`); SDDM may still autologin.
16. **LUKS passphrase changes break `--resume`** (the harness types `prime`). Every drive-password test
    must end with the passphrase back at `prime` or with `stop`.
17. **Plymouth wrong passphrase** re-prompts (the `encrypt` hook loops on `cryptsetup open`); there is no
    "failed" art in the Plymouth theme, only the cleared bullets. SDDM *does* have failed art
    (`lock-failed.png`, `entry-failed.png`) and clears the field.
18. **SDDM greeter has no username field**; it logs in `userModel.lastUser` (`prime`). After
    `omarchy-system-logout` the greeter always appears (SDDM `Relogin` defaults off) even if boot autologins.
19. **Crash capture is silent until a default agent is chosen** (`omarchy-crash-watch` skips crashes when
    `omarchy-default-agent` prints nothing). Stock disk: no agent → no toast. Choosing one via the menu
    installs it with mise (NET, slow); writing `claude` into `~/.config/omarchy/defaults/agent` is enough
    for the toast. Clicking the toast launches `omarchy-agent`, which needs the agent installed.
20. **Core dumps**: systemd-coredump journals every crash (the watcher keys on the journal entry); run
    `ulimit -c unlimited` first so `coredumpctl info` also has the core. `sleep 300 & kill -SEGV $!` is a
    reliable, harmless crash; the toast names the executable basename (`sleep`). Dedupe is 60 s per name.
21. **Factory reset** on a disk without `@factory` stops at the yellow "no factory snapshot" screen (exit
    1). With `@factory` the negative path (typing anything but `reset`) is safe. The full path destroys the
    disk, re-keys LUKS to a throwaway then to the new owner's password, and ends in the tty1 provisioning
    wizard — > 10 min and incompatible with `--resume` afterwards.
22. **`omarchy-channel-set` always ends in `omarchy-update -y`** — a full unattended update (NET, SLOW) and
    its reboot prompt (gum confirm still asks even under `-y`). Switching back to stable downgrades with a
    pacman "downgrading package" warning. `dev` clones the repo into `~/omarchy` and sets `reboot-required`.
23. **`omarchy-debug` never offers "Upload log" in this VM** because it gates on `ping -c 1 8.8.8.8` and
    ICMP fails under user-mode NAT. Only "View log" / "Save in current directory" appear. `inxi -Farz`
    takes ~10–20 s.
24. **Passwordless sudo**: `omarchy-sudo-passwordless 1` arms a one-minute expiry, so the expiry itself
    is provable inside a session (`sudo -k; sudo -n true` fails again after ~70 s). A reboot also clears
    the grant (tmpfiles rule).
25. **Sudoless docker** needs the `docker` group (Omarchy ships Docker). Enabling moves the menu row from
    Setup → Security to Remove → Security immediately (`--configured` reads groups, not the session).
26. **Direct boot** creates a real OVMF boot entry; leave it in place across a reboot and Limine (and the
    Snapshots menu) is bypassed. Always remove it at the end; OVMF vars may or may not persist anyway.
27. **Free-space guard** is easy to trigger: `fallocate` on btrfs is instant, so a filler file that leaves
    < 10 GiB free makes `omarchy update` stop with the message and the red banner before the confirm box.
28. **Serial**: the kernel cmdline has no `console=ttyS0`, so nothing arrives on `/dev/ttyS0` by itself.
    Proofs that need text use `<cmd> | sudo tee /dev/ttyS0` then `./client get-serial`.
29. **`XF86PowerOff`** (the power button opens the System menu) cannot be sent by the driver's key set —
    gap. `Super+Escape` is the equivalent.
30. **oomd** protects the compositor: only `app.slice` is killable. A runaway allocation in a terminal is
    killed while Hyprland/shell survive. Use incompressible data (`os.urandom`) — zeros compress into zram
    and take forever.

## Proposed tests

### update-omarchy-end-to-end   [VM-OK] [NET] [SLOW]
description: `omarchy update` from the Update menu carries a 4.0.2 install to the current release and, after the reboot it asks for, the desktop comes back on the new version with the update icon gone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Note the update icon (circular arrows) at the right of the bar. Open a terminal with Super+Enter, type `omarchy-version` and read the version (4.0.2-x). Close it.
  * Open the Omarchy Menu with Super+Space, select Update, then Omarchy with the mouse. A floating terminal shows the logo and a bordered box "Ready to update?" ending in "Continue with update?". Press Enter (Yes).
  ** Type `prime` whenever "[sudo] password for prime:" appears; it can appear more than once during a long run.
  * Watch the green banners and screenshot each: "Prune package cache", "Create system snapshot" … "Snapshots can be selected during boot.", "Update Arch signing keys" / "Keys are correct", "Update system packages" with pacman progress, one or more "Running migration (…)", optional "Update mise tools", then "Restarting shell" / "All plugins have been reloaded".
  ** While packages download the Stay Awake indicator is lit in the bar; it must be off again after "Restarting shell".
  ** If "Remove N orphaned package(s)?" appears answer No. Screenshot at least every 30 seconds; never wait more than 5 seconds between screenshots.
  * A prompt "Linux kernel has been updated. Reboot?" (or "Updates require reboot. Ready?") must appear. Screenshot it, then press Enter (Yes).
  * An OSD "Rebooting" shows and the machine reboots. Type `prime` at the Plymouth passphrase box and log in with `prime` if the greeter appears.
  * On the desktop the update icon must be gone from the bar. Open a terminal and type `omarchy-version` — the new version (4.0.4-x) — and `omarchy-update-available` — "Omarchy is up to date".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum prompts default to Yes; Enter accepts, y/n or Left/Right switch.
  * A red "Something went wrong during the update!" block is the failure signal; the window then ends with "● Failed (exit code N)! Press any key to close...".
  * Expect well over five minutes of downloads; consider ending with save so later tests start from an updated disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Ready to update?" box, each green banner, at least one "Running migration (…)", the reboot prompt, the "Rebooting" OSD, the Plymouth prompt, and the desktop with no update icon
  ** Terminal showing 4.0.2-x before and the new version plus "Omarchy is up to date" after
  * If unsuccessful
  ** The red failure block with the 30 lines above it and the "● Failed (exit code N)" line; before rebooting, `tail -n 80 /tmp/omarchy-update.log | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-update, -confirm, -pkg-prune, -keyring, -system-pkgs, -stay-awake, -restart, -status, -available, omarchy-migrate, omarchy-snapshot create, docs/update-process.md, test/shell.d/update-sequence-test.sh, shell/plugins/bar/widgets/SystemUpdate.qml

### update-already-up-to-date-second-run   [VM-OK] [NET] [SLOW]
description: Running `omarchy update` on a system that is already current is short and safe: it still snapshots and checks keys, pacman has nothing to do, no migration runs and no reboot is requested.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this disk finished update-omarchy-end-to-end and was rebooted. Open a terminal (Super+Enter) and type `omarchy-update-available` — it must say "Omarchy is up to date". Close the terminal.
  ** A disk that was updated but not rebooted still shows the kernel reboot prompt; reboot from Super+Escape → Reboot first.
  * Open the Omarchy Menu (Super+Space) → Update → Omarchy with the mouse. Press Enter at "Continue with update?" and type `prime` at the sudo prompt.
  * The banners must read "Prune package cache", "Create system snapshot", "Keys are correct", "Update system packages" followed by " there is nothing to do", then "Restarting shell" / "All plugins have been reloaded".
  ** No "Running migration" banner and no reboot prompt may appear.
  * The window ends with "● Done! Press any key to close...". Press a key; it closes.
  * Open a terminal and type `sudo snapper list | tail -n 3` — the newest row is from this run (today's time, description = the version).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The whole run takes about a minute; the snapshot step is the slowest.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of " there is nothing to do", the shell restart banner, the "● Done!" line and the snapper row
  * If unsuccessful
  ** A migration banner or reboot prompt, or the red failure block with the preceding output
covers: bin/omarchy-update, -restart, -keyring, omarchy-snapshot, default/snapper/root

### update-available-indicator-in-bar   [VM-OK] [NET]
description: When a newer Omarchy is published the bar shows an update icon with a tooltip, and clicking it opens the update terminal, which can be backed out of.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * On a pristine 4.0.2 disk wait up to a minute after login, screenshotting, until a circular-arrows icon appears among the status icons at the right of the bar.
  * Move the mouse over the icon: a tooltip "Pending Omarchy Updates" appears.
  * Click the icon with the left mouse button. A floating terminal opens with the logo and the "Ready to update?" box.
  * At "Continue with update?" press n (No). The terminal prints "Update cancelled" and "● Failed (exit code 1)! Press any key to close...". Press a key.
  * The icon is still in the bar. Open a terminal (Super+Enter) and type `omarchy-update-available` — a line like `omarchy 4.0.2-1 -> 4.0.4-1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon is small; use ./client-with-image after each mouse move to confirm the tooltip and the click target.
  * If no icon appears after a minute, type `checkupdates omarchy` in a terminal and report the output — the check needs the network.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the icon, the tooltip, the "Ready to update?" box after the click, "Update cancelled" with exit code 1, the icon still present and the "->" line
  * If unsuccessful
  ** The bar without the icon plus the `checkupdates omarchy` output
covers: bin/omarchy-update-available, -confirm, shell/plugins/bar/widgets/SystemUpdate.qml, test/shell.d/update-available-test.sh

### update-cancel-and-lock-rejects-second-run   [VM-OK]
description: While one `omarchy update` waits at its confirmation a second one is refused by the update lock, and cancelling the first releases it without having changed anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy update`. The "Ready to update?" box and "Continue with update?" appear; leave it waiting.
  * Press Super+Enter for a second terminal (it tiles beside the first) and type `omarchy update` there. It must print "An Omarchy update is already running." and return to the prompt.
  * Click into the first terminal and press n. It prints "Update cancelled" and returns to the prompt.
  * In the first terminal type `omarchy update` again — the box appears (the lock was released). Press n.
  * Type `sudo snapper list | tail -n 2` (password `prime`) — no snapshot from the last minutes: nothing ran before the confirmation.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use ./client-with-image after clicking a terminal to be sure it has focus before typing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot showing both terminals: the waiting box and "An Omarchy update is already running."; then "Update cancelled", the successful re-run, and the snapper tail
  * If unsuccessful
  ** The second terminal reaching "Ready to update?", or the re-run being refused after the cancel
covers: bin/omarchy-update, -lock, -confirm, test/shell.d/update-lock-test.sh

### update-free-space-guard-stops-early   [VM-OK]
description: With under 10 GiB free the update refuses before asking anything, and `OMARCHY_UPDATE_FORCE=1` lets a user override the guard.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `df -h /`. Read the Avail figure (e.g. 28G).
  * Type `fallocate -l <Avail minus 8>G ~/filler` (for 28G type `fallocate -l 20G ~/filler`), then `df -h /` — Avail is now under 10G.
  * Type `omarchy update`. It must print "You need at least 10 GiB free to safely update Omarchy." and the red "Something went wrong during the update!" block, with no "Ready to update?" box.
  * Type `OMARCHY_UPDATE_FORCE=1 omarchy update` — the "Ready to update?" box appears this time. Press n ("Update cancelled").
  * Type `rm ~/filler` and `df -h /` — Avail is back above 10G.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fallocate on btrfs returns instantly; if it reports no space, use a smaller size.
  * Do not skip the rm step; other tests on this disk need the space.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of df before and after the filler, the free-space message with the red block, the forced run reaching the box, and df after cleanup
  * If unsuccessful
  ** The confirmation box appearing despite low space, or the forced run still refusing
covers: bin/omarchy-update-requires-free-space, bin/omarchy-update, test/shell.d/update-disk-space-test.sh

### update-bogus-mirror-fails-with-banner   [VM-PARTIAL] [NET]
description: When the Arch mirror cannot be reached the update stops at the keyring step with the red failure banner instead of half-applying, and the availability check quietly reads "up to date". Simulated with a bogus mirror because the driver cannot cut the network.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `sudo cp /etc/pacman.d/mirrorlist /etc/pacman.d/mirrorlist.bak` (password `prime`), then `echo 'Server = http://127.0.0.1:1/$repo/os/$arch' | sudo tee /etc/pacman.d/mirrorlist`.
  * Type `omarchy-update-available` — it prints "Omarchy is up to date" even though updates exist; record this as the known offline reading.
  * Type `omarchy update` and press Enter at "Continue with update?". Prune and snapshot run; under "Update Arch signing keys" pacman prints errors like "failed retrieving file 'core.db' from 127.0.0.1" and "failed to synchronize all databases", then the red "Something went wrong during the update!" block.
  ** "Update system packages" must not appear.
  * Type `sudo mv /etc/pacman.d/mirrorlist.bak /etc/pacman.d/mirrorlist`, then `omarchy-update-available` — the pending update line is back (or "up to date" on an already updated disk).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: a real link-down, DNS failure and the bar widget with no route at all cannot be produced from inside the guest.
  * The Omarchy repo is in /etc/pacman.conf and still syncs; the failure comes from core/extra.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the replaced mirrorlist, "Omarchy is up to date", the retrieval errors under the keyring banner, the red block, and the restored check
  * If unsuccessful
  ** The update continuing to "Update system packages", or no red block; `tail -n 60 /tmp/omarchy-update.log | sudo tee /dev/ttyS0` via get-serial
covers: bin/omarchy-update, -keyring, -available, docs/update-process.md, test/shell.d/update-keyring-test.sh

### update-pacman-guard-blocks-direct-syu   [VM-OK]
description: Omarchy's pacman hook turns a direct `pacman -Syu` away with instructions to use `omarchy update`, while plain installs and the explicit bypass are let through.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `cat /usr/share/libalpm/hooks/00-omarchy-update-guard.hook` — it names `omarchy-update-pacman-guard` with AbortOnFail.
  * Type `OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard; echo exit=$?` — the message starting "Woah partner..." that recommends `omarchy update` and shows the bypass `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, then exit=1.
  * Type `OMARCHY_PACMAN_CMDLINE="pacman -S vim" omarchy-update-pacman-guard; echo exit=$?` — silent, exit=0.
  * Type `OMARCHY_ALLOW_DIRECT_PACMAN=1 OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard; echo exit=$?` — silent, exit=0.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The real `sudo pacman -Syu` only reaches the hook after downloading every pending package (NET, SLOW), which is why the guard is invoked directly here. On an already current disk `sudo pacman -Syu` just says "there is nothing to do" — not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the hook file, the "Woah partner..." message with exit=1, and the two silent exit=0 runs
  * If unsuccessful
  ** A missing hook, a silent -Syu, or a blocked bypass
covers: bin/omarchy-update-pacman-guard, bin/omarchy-update-pacman, docs/update-process.md, test/shell.d/update-pacman-guard-test.sh

### update-firmware-in-vm   [VM-PARTIAL] [NET]
description: Update → Firmware runs fwupd end to end; on a machine with nothing to flash it must finish with a plain "no devices" outcome rather than an error stack.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Firmware with the mouse. The floating terminal shows the logo and the green banner "Update Firmware".
  ** If fwupd is missing it is installed first; type `prime` at the sudo prompt.
  * `fwupdmgr refresh --force` downloads LVFS metadata (a few MB) and reports success; then `sudo fwupdmgr update` runs.
  * The outcome must be a plain statement that no devices can be updated ("No updatable devices" or a list of devices with no updates). Record whether the window ends "● Done!" or "● Failed (exit code 2)!" — either is acceptable, a crash or stack trace is not.
  * Press a key; the window closes and the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: no firmware can actually be updated in the guest; only the tool chain and messaging are checked.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the banner, the metadata refresh line, the no-devices outcome and the closing line
  * If unsuccessful
  ** Any error other than the no-devices message (package install failure, refresh network error)
covers: bin/omarchy-update-firmware, default/omarchy/omarchy-menu.jsonc (update.firmware)

### update-time-restarts-timesyncd   [VM-OK]
description: Update → Time restarts time synchronisation after one sudo prompt and reports done, leaving the service active.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `systemctl show systemd-timesyncd -p ActiveEnterTimestamp`; note the time.
  * Open the Omarchy Menu (Super+Space) → Update → Time with the mouse. The floating terminal prints "Updating time..." and asks for the sudo password; type `prime`. It ends "● Done! Press any key to close...". Press a key.
  * In the terminal type the same systemctl line again — the timestamp is newer — and `systemctl is-active systemd-timesyncd` — "active".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "System clock synchronized: yes" in timedatectl can lag a minute and is not required.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the older and newer timestamps, "Updating time..." with the Done line, and "active"
  * If unsuccessful
  ** The Failed line and `systemctl status systemd-timesyncd | sudo tee /dev/ttyS0` via get-serial
covers: bin/omarchy-update-time, default/omarchy/omarchy-menu.jsonc (update.time)

### migrate-notification-runs-pending-migration   [VM-OK]
description: A pending migration is announced by a clickable notification that runs it in a terminal; a current system reports nothing pending, and a bad flag is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-migrate --pending; echo exit=$?` — nothing listed, exit=1 (a fresh install has every shipped migration marked done).
  * Type `omarchy-migrate --bogus` — "Unknown option: --bogus".
  * Make one migration pending: `f=$(ls /usr/share/omarchy/migrations | tail -n 1); rm ~/.local/state/omarchy/migrations/$f; omarchy-migrate --pending` — it prints that filename.
  * Type `omarchy-migrate-notify`. A critical notification "Pending Omarchy Migrations" / "Click to run 1 pending migration." appears at the top right.
  * Click the notification with the mouse. A floating terminal runs the migration showing "Running migration (<name>)" and ends "● Done!" (type `prime` if it asks for sudo). Press a key; the notification is gone.
  * Type `omarchy-migrate --pending; echo exit=$?` — empty again, exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Migrations are idempotent, so re-running the newest one is harmless.
  * If clicking does nothing, type `omarchy-migrate` in the terminal and report the click failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty --pending, the bad-flag message, the pending filename, the notification, the "Running migration" banner with Done, and the final empty --pending
  * If unsuccessful
  ** A migration printing red errors, or no notification (`journalctl --user -u omarchy-migrate-notify -b | tail | sudo tee /dev/ttyS0`)
covers: bin/omarchy-migrate, bin/omarchy-migrate-notify, bin/omarchy-update-user-notify, default/systemd/user/omarchy-migrate-notify.service, docs/update-process.md

### system-menu-power-entries-listed   [VM-OK]
description: Super+Escape opens the System menu listing exactly the power actions this machine supports — no Hibernate without hibernation swap — and Escape closes it without acting.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape. The Omarchy Menu opens directly on System.
  * The rows must be, in order: Screensaver, Lock, Suspend, Logout, Reboot, Shutdown — and no Hibernate.
  * Press Escape. The menu closes and the desktop is unchanged.
  * Press Super+Space and click System with the mouse: the same six rows. Press Escape.
  * Open a terminal (Super+Enter) and type `swapon --show` (only /dev/zram0) and `omarchy-hibernation-remove` — "Hibernation is not set up", no prompt. This explains the missing row.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not type while the menu is open; typing filters the rows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the System submenu with six rows and no Hibernate, the closed menu, the mouse-opened menu, and the swapon/remove output
  * If unsuccessful
  ** A missing or extra row, or remove prompting/erroring
covers: default/omarchy/omarchy-menu.jsonc (system.*), default/hypr/bindings/utilities.lua (SUPER+ESCAPE), bin/omarchy-hibernation-available, bin/omarchy-hibernation-remove

### lock-hotkey-and-wrong-password   [VM-OK]
description: Super+Ctrl+L locks the session from the keyboard; a wrong password is rejected and the right one restores the desktop exactly as left.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `echo LOCK-TEST` so the window has recognisable content.
  * Press Super+Ctrl+L. The lock screen appears.
  ** It turns black after a few seconds; typing still goes into the password box.
  * Type `wrongpass` and Enter. The lock stays engaged and shows the failure (shake/red or cleared field) — screenshot right after Enter.
  * Type `prime` and Enter. The desktop returns with the terminal still showing LOCK-TEST.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On a black lock screen, type one character and screenshot immediately — the box wakes on input.
  * The menu/mouse route is the existing lock-screen test; this one is keyboard only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the engaged lock, the rejected attempt, and the restored terminal with LOCK-TEST
  * If unsuccessful
  ** The wrong password unlocking, the lock never engaging, or a crash dialog
covers: bin/omarchy-system-lock, default/hypr/bindings/utilities.lua (SUPER+CTRL+L), test/shell.d/system-lock-test.sh

### logout-returns-to-sddm-and-relogin   [VM-OK]
description: Logout closes the session and lands on the Omarchy SDDM greeter, which rejects a wrong password with its red art and accepts the right one into a clean desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and a browser (Super+Shift+Enter) so windows exist.
  * Press Super+Escape and click Logout with the mouse. An OSD "Logging out" shows, the windows close, and within a few seconds the login screen appears: dark background, Omarchy logo, lock icon and one password box (no username field).
  * Type `wrongpass` and Enter. The lock and entry art turn red and the field clears — screenshot within two seconds.
  * Type `prime` and Enter. The Omarchy desktop loads with the bar and no leftover windows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The greeter already focuses the password box; do not click first.
  * Bullets in the box are the only typing feedback.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Logging out" OSD, the greeter, the red failed state with the cleared field, and the fresh desktop
  * If unsuccessful
  ** A black screen or TTY instead of the greeter (capture get-serial), the wrong password logging in, or windows surviving the logout
covers: bin/omarchy-system-logout, default/sddm/omarchy/Main.qml, etc/sddm.conf.d/*, default/sddm/hyprland.lua, default/omarchy/omarchy-menu.jsonc (system.logout)

### reboot-full-boot-chain   [VM-OK] [SLOW]
description: Reboot from the System menu walks the whole boot chain — Limine menu, Plymouth passphrase (rejecting a wrong one), login — and comes back to a clean desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `journalctl --list-boots | wc -l`; note the number.
  * Press Super+Escape and click Reboot with the mouse. An OSD "Rebooting" shows, windows close and the screen goes dark.
  * As soon as the firmware splash is gone press Down once per screenshot to stop the countdown. The Limine menu shows "Omarchy Bootloader" on a dark Tokyo Night background with an Omarchy entry and a Snapshots entry. Highlight the first Omarchy entry and press Enter.
  ** Limine waits only about five seconds; if it boots on its own that is acceptable — note it.
  * The Plymouth screen appears: logo, lock icon, entry box. Type `wrongpass` and Enter — the bullets clear and the box waits again. Type `prime` and Enter — a progress bar replaces the box.
  * Log in with `prime` if the greeter appears. On the desktop open a terminal and type `journalctl --list-boots | wc -l` — one higher than before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot continuously from the moment the screen goes dark; the bootloader menu is brief.
  * Plymouth shows only the logo until the first key; the passphrase box is under the logo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Rebooting" OSD, the Limine menu with branding and entries, the Plymouth box after the wrong passphrase, the progress bar, and the desktop with the higher boot count
  * If unsuccessful
  ** No reboot within 30 s, a Limine hash-mismatch warning, an unthemed text passphrase prompt, or a boot that never reaches login (get-serial)
covers: bin/omarchy-system-reboot, default/limine/limine.conf, etc/limine-entry-tool.d/omarchy-defaults.conf, default/plymouth/omarchy.script, default/sddm/*, test/shell.d/system-power-test.sh, limine-defaults-test.sh

### shutdown-powers-off   [VM-OK]
description: Shutdown from the System menu shows its OSD, closes windows and powers the machine off within seconds, ending the session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and a browser (Super+Shift+Enter). In the terminal type `echo SHUTDOWN-TEST-START | sudo tee /dev/ttyS0` (password `prime`).
  * Press Super+Escape and click Shutdown with the mouse. An OSD "Shutting down" shows and the windows close.
  * Screenshot every 3–5 seconds. Within 30 seconds the screen is black or the guest is gone (screenshots stop changing or the client reports no machine).
  * Read get-serial: SHUTDOWN-TEST-START is present (the serial channel worked); note any power-down text if the console shows it.
  * This is the last action; the machine cannot be resumed afterwards.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a desktop is still visible after 30 seconds, type `systemctl list-jobs | sudo tee /dev/ttyS0` in a terminal and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Shutting down" OSD, the closed windows, the black/absent screen within 30 s, and the serial dump containing SHUTDOWN-TEST-START
  * If unsuccessful
  ** A desktop or TTY still visible after 60 s and the list-jobs serial output
covers: bin/omarchy-system-shutdown, default/systemd/faster-shutdown.conf, default/systemd/user@.service.d/faster-shutdown.conf, etc/systemd/system.conf.d/10-faster-shutdown.conf, test/shell.d/system-power-test.sh

### suspend-locks-then-sleeps   [VM-PARTIAL]
description: Suspend from the System menu locks the session first and puts the machine to sleep; because the VM may not wake for the driver, this is the last action of its session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `systemd-inhibit --list | grep -i omarchy` — a line "Lock screen before suspend" with mode delay (the sleep-lock service is running).
  * Type `journalctl -f -o cat -g 'PrepareForSleep|omarchy-system-sleep-lock|PM: suspend' | sudo tee /dev/ttyS0 &` (password `prime`) so sleep messages reach the serial log.
  * Press Super+Escape and click Suspend with the mouse. Within a second the lock screen appears, then the display freezes or blanks. Screenshot every 2 seconds for 10 seconds.
  * Read get-serial: lines about PrepareForSleep and the suspend, and no "suspending without a secure lock".
  * Try to wake: press Space, then move the mouse. If the guest wakes, the lock screen must be showing; unlock with `prime`. If nothing changes in 30 seconds record that as the expected limitation and end the session.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: waking usually needs the host, so the post-wake screen is unproven here. Run nothing else after this test in the same session.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the inhibitor line, the lock screen appearing before the freeze, and the serial dump with the sleep lines and no "suspending without a secure lock"; if woken, the lock screen after wake
  * If unsuccessful
  ** An unlocked desktop at the moment of sleep, "suspending without a secure lock" in serial, or a crash on resume
covers: default/omarchy/omarchy-menu.jsonc (system.suspend), bin/omarchy-system-sleep-monitor, bin/omarchy-system-sleep-lock, default/systemd/user/omarchy-sleep-lock.service, etc/systemd/logind.conf.d/20-inhibit-delay.conf, test/shell.d/sleep-monitor-test.sh

### suspend-toggle-hides-menu-entry   [VM-OK]
description: `omarchy-toggle-suspend` removes the Suspend row from the System menu and puts it back, announcing each change with a notification.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and confirm Suspend is listed. Press Escape.
  * Open a terminal (Super+Enter) and type `omarchy-toggle-suspend`. A notification "Suspend removed from system menu" appears.
  * Press Super+Escape: the Suspend row is gone (Screensaver, Lock, Logout, Reboot, Shutdown remain). Press Escape.
  * Type `omarchy-toggle-suspend` again. Notification "Suspend now available in system menu".
  * Press Super+Escape: Suspend is back. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notifications fade after a few seconds; screenshot right after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the menu with Suspend, the "removed" notification, the menu without Suspend, the "available" notification and the restored menu
  * If unsuccessful
  ** The row not changing or a missing notification
covers: default/omarchy/omarchy-menu.jsonc (system.suspend when-clause), bin/omarchy-toggle-suspend

### sleep-lock-manual-run-and-tiny-budget   [VM-OK]
description: The pre-suspend lock helper can be exercised without sleeping: it locks the session within its budget, and an impossibly small budget yields the "did not lock" warning and notification.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-system-sleep-lock; echo exit=$?`. The lock screen engages at once. Unlock with `prime`; the terminal shows exit=0.
  * Type `omarchy-system-sleep-lock 30; echo exit=$?`. The terminal prints "omarchy-system-sleep-lock: suspending without a secure lock (the shell did not secure the session within 30ms)" and exit=1, and a critical notification "Screen did not lock before suspend" appears.
  ** The lock request may still land a moment later; if the screen locks, unlock with `prime`.
  * Type `omarchy-system-sleep-lock abc; echo exit=$?` — a non-numeric budget falls back to the derived one: the screen locks, exit=0. Unlock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot within a second of each command; the notification fades.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the locked screen and exit=0, the 30 ms warning with exit=1 and its notification, and the fallback run
  * If unsuccessful
  ** exit=1 for the default budget, or no notification for the tiny budget
covers: bin/omarchy-system-sleep-lock, etc/systemd/logind.conf.d/20-inhibit-delay.conf, test/shell.d/sleep-lock-test.sh

### system-stats-output   [VM-OK]
description: `omarchy-system-stats` prints the CPU and memory lines the power panel consumes and reacts to load; a bad flag is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-system-stats`. Two lines: `cpu` with a percentage and `memory` as `X.XGB / 4GB`.
  * Type `omarchy-system-stats --bar-widget`. Three lines: cpu counters, memory percentage, load.
  * Type `yes > /dev/null & sleep 3; omarchy-system-stats; kill %1` — the cpu percentage is clearly higher than at rest.
  * Type `omarchy-system-stats --bogus` — "Usage: omarchy-system-stats [--bar-widget]".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Tabs render as wide gaps in the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two-line output with 4GB total, the three-line output, the raised cpu figure and the usage error
  * If unsuccessful
  ** Missing lines, a wrong total, or awk errors
covers: bin/omarchy-system-stats, shell/plugins/panels/power/Panel.qml

### lid-close-and-wake-noop-on-desktop   [VM-PARTIAL]
description: On a machine without a lid the lid-close handler must not lock the screen and the wake helper must exit quietly; only this no-op path exists here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `ls /proc/acpi/button/lid/; omarchy-hw-laptop; echo laptop=$?` — no lid directory, laptop=1.
  * Type `omarchy-system-lid-close; echo exit=$?`. The screen must not lock; exit=0.
  * Type `omarchy-system-wake; echo exit=$?` — no error text, exit=0.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: a real lid close (lock plus clamshell display handling) and the docked case need a laptop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the detection lines and the still-unlocked desktop with both exit=0
  * If unsuccessful
  ** The lock engaging with no lid, or errors from the brightness/monitor helpers
covers: bin/omarchy-system-lid-close, bin/omarchy-system-wake, default/hypr/bindings/utilities.lua (Lid Switch binds), test/shell.d/lid-close-test.sh

### oomd-kills-runaway-app-not-session   [VM-OK]
description: A program that eats all memory is killed while the compositor, bar and other windows survive, because only user apps are eligible for the OOM killer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `systemctl is-active systemd-oomd` — "active".
  * Press Super+Enter for a second terminal and type `echo SURVIVOR` there.
  * Click the first terminal and type: `python3 -c 'import os; b=[]
  while True: b.append(os.urandom(1<<26))'` followed by Enter.
  ** The newline between the two python lines matters; type it as shown.
  * Screenshot every 5 seconds. The guest may be sluggish for up to two minutes; then the first terminal prints "Killed" (or the prompt returns).
  * The second terminal with SURVIVOR and the bar are still present; click the second terminal and type `echo alive` — it responds.
  * Type `journalctl -b -o cat | grep -iE 'oom|Killed process' | tail -n 5 | sudo tee /dev/ttyS0` (password `prime`) and read get-serial — a kill of python is logged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Random data is used because zeros would compress into zram and never fill memory.
  * If nothing happens after three minutes press Ctrl+C in the first terminal and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the active oomd, the "Killed" terminal, the surviving terminal and bar, and the serial lines naming the killed python
  * If unsuccessful
  ** The desktop flashing/restarting (compositor killed), a lock-up beyond three minutes, or no kill logged
covers: default/systemd/user/app.slice.d/10-oomd.conf, etc/systemd/oomd.conf.d/10-omarchy.conf, default/systemd/zram-generator.conf.d/90-omarchy.conf

### snapshot-create-list-and-retention   [VM-OK]
description: `omarchy-snapshot create` takes a numbered Snapper snapshot labelled with the Omarchy version and retention keeps at most five, so every update has a rollback point.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-snapshot create` (password `prime`). Output: green "Create system snapshot", a snapshot number, "Snapshots can be selected during boot.".
  ** If it says "No Snapper configs found, so no snapshot was created.", type the command it prints (`sudo bash -euo pipefail "/usr/share/omarchy/install/config/snapper.sh"`), rerun, and record that the disk shipped unconfigured.
  * Type `sudo snapper list` — the newest row is type number with the description equal to the version (e.g. 4.0.2-1).
  * Type `for i in 1 2 3 4 5 6; do omarchy-snapshot create >/dev/null; done; sudo snapper list` — never more than five numbered rows remain.
  * Type `omarchy-snapshot` — "Usage: omarchy-snapshot <create|restore>". Type `omarchy-snapshot bogus; echo exit=$?` — prints nothing and exit=0; record this silent acceptance as a finding.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each create takes a second or two; the loop is under a minute.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the create output, the snapper list with the version description, the list after the loop with ≤ 5 numbered rows, and the two negative cases
  * If unsuccessful
  ** The "No Snapper configs found" message persisting after configuration, snapper errors, or more than five numbered rows
covers: bin/omarchy-snapshot, default/snapper/root, install/config/snapper.sh, test/shell.d/snapshot-create-test.sh, snapper-test.sh, version-test.sh

### snapshot-boot-from-limine-menu   [VM-OK] [SLOW]
description: A snapshot taken by `omarchy-snapshot` can be booted read-only from the Limine Snapshots menu, and the next reboot returns to the normal system.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter), type `omarchy-snapshot create` (password `prime`) and note the snapshot number N from `sudo snapper list | tail -n 1`. Wait 10 seconds.
  * Press Super+Escape and click Reboot. When the screen goes dark press Down every second, screenshotting, until the Limine menu ("Omarchy Bootloader") is visible.
  * Highlight "Snapshots" and press Enter. Highlight the entry for snapshot N (named with its number/date/version) and press Enter.
  * Type `prime` at the Plymouth box. Log in with `prime` if the greeter appears.
  ** If the desktop does not load, press Ctrl+Alt+F3 and log in as prime/prime on the text console.
  * Open a terminal and type `findmnt -no OPTIONS /` — it contains `.snapshots/N/snapshot` and `ro`. Type `touch /usr/test` — "Read-only file system".
  * Press Super+Escape → Reboot (or type `systemctl reboot` on the console) and let the default entry boot. After login `findmnt -no OPTIONS /` shows `subvol=/@` again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Limine's countdown is about five seconds; if it boots before the menu is reached, reboot and try again.
  * The Snapshots entries come from limine-snapper-sync and carry the snapper description.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Limine menu, the Snapshots submenu with entry N, findmnt showing `.snapshots/N/snapshot` and `ro`, the read-only touch error, and the final normal-root findmnt
  * If unsuccessful
  ** No Snapshots entry, a Limine hash warning, a hung boot (get-serial), or a writable snapshot boot
covers: bin/omarchy-snapshot, default/limine/limine.conf, etc/limine-entry-tool.d/omarchy-defaults.conf (BOOT_ORDER Snapshots, MAX_SNAPSHOT_ENTRIES), install/config/snapper.sh (limine-snapper-sync)

### snapshot-restore-picker-cancel   [VM-PARTIAL]
description: `omarchy-snapshot restore` opens the restore picker and cancelling it leaves the system untouched; the real restore from a booted snapshot is documented, not run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `findmnt -no OPTIONS /` (contains `subvol=/@`).
  * Type `omarchy-snapshot restore` (password `prime`). A text UI from limine-snapper-restore appears, listing snapshots or explaining that a restore must start from a booted snapshot. Screenshot and describe its options.
  * Cancel with Escape or Ctrl+C (or its Quit option). The prompt returns.
  * Type `findmnt -no OPTIONS /` and `sudo snapper list | tail -n 2` — unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: an actual restore needs a snapshot boot first (see snapshot-boot-from-limine-menu) and a reboot after confirming — too long and destructive for this session.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the cancel, and the unchanged mount options and snapshot list
  * If unsuccessful
  ** The root changed or a snapshot created after a cancel, or a traceback
covers: bin/omarchy-snapshot (restore)

### hibernation-setup-then-remove   [VM-OK] [SLOW]
description: `omarchy-hibernation-setup` creates the swapfile and resume configuration so Hibernate appears in the System menu, and `omarchy-hibernation-remove` undoes it; both rebuild the boot image.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-hibernation-setup` (password `prime`). At "Use 3.8Gi on boot drive to make hibernation available?" (figure = RAM) press Enter (Yes).
  * Lines follow in order: "Creating Btrfs subvolume", "Creating swapfile in Btrfs subvolume", "Adding swapfile to /etc/fstab", "Enabling swap on /swap/swapfile", "Adding resume hook to …omarchy_resume.conf", "Adding resume kernel parameters", "Regenerating initramfs..." (one to three minutes). At "Reboot to enable hibernation?" press n.
  ** Screenshot every 20 seconds during the regeneration.
  * Type `swapon --show` — /swap/swapfile is listed beside zram. Press Super+Escape: a Hibernate row now sits between Suspend and Logout. Press Escape without selecting it.
  * Type `omarchy-hibernation-setup` again — "Hibernation is already set up", no prompt.
  * Type `omarchy-hibernation-remove`; at "Remove hibernation setup?" press Enter. Lines: "Disabling swap on /swap/swapfile", "Removing swapfile", "Removing Btrfs subvolume /swap", "Removing swapfile from /etc/fstab", "Removing resume hook", "Regenerating initramfs...", "Hibernation removed".
  * Type `swapon --show` — zram only. Super+Escape shows no Hibernate row. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not choose Hibernate and do not reboot with hibernation configured unless the disk will be discarded.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the size prompt, the setup lines, swapon with the swapfile, the Hibernate row, "already set up", the removal lines, zram-only swapon and the menu without Hibernate
  * If unsuccessful
  ** Red errors from btrfs/mkinitcpio/limine, no Hibernate row after setup, or swap still active after removal
covers: bin/omarchy-hibernation-setup, bin/omarchy-hibernation-remove, bin/omarchy-hibernation-available, default/omarchy/omarchy-menu.jsonc (system.hibernate), default/systemd/system-sleep/keyboard-backlight

### powerprofiles-set-remember-and-reject   [VM-PARTIAL]
description: A user can pick a power profile from the command line, it is remembered for the AC state and restored on autodetect, and unknown profiles or actions are refused; the graphical picker is unreachable without a battery.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-powerprofiles-list --active-state` — one profile per line (typically power-saver and balanced) with 1 beside the active one.
  ** If the list is empty, type `systemctl is-active power-profiles-daemon` and record the result; the remaining steps then show the "not available" errors instead.
  * Type `omarchy-powerprofiles-set ac power-saver` then `powerprofilesctl get` — power-saver.
  * Type `omarchy-powerprofiles-set ac balanced` then `omarchy-powerprofiles-set` (autodetect, which resolves to ac on a machine without a battery) then `powerprofilesctl get` — balanced, restored from the remembered choice.
  * Type `omarchy-powerprofiles-set ac turbo` — "Power profile is not available: turbo". Type `omarchy-powerprofiles-set turbo` — the Usage line. `powerprofilesctl get` is still balanced.
  * Press Super+Ctrl+P — nothing opens (the power panel with the profile buttons is hidden without a battery).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: the panel's profile buttons and the battery state need real hardware.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the profile list, each set followed by `powerprofilesctl get`, the two rejections with the profile unchanged, and the bar after Super+Ctrl+P
  * If unsuccessful
  ** A set reporting success while get disagrees, a rejection accepted, or a panel opening
covers: bin/omarchy-powerprofiles-list, bin/omarchy-powerprofiles-set, bin/omarchy-powerprofiles-init, shell/plugins/panels/power/Panel.qml, default/hypr/bindings/utilities.lua (SUPER+CTRL+P), test/shell.d/powerprofiles-set-test.sh

### battery-absent-paths   [VM-PARTIAL]
description: On a machine without a battery every battery surface hides or stays quiet: no bar icon or panel, empty status, and the laptop-only menu rows are absent.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the right end of the bar: no battery icon. Press Super+Ctrl+P — nothing opens.
  * Open the menu with Super+Space → Trigger → Toggle with the mouse: no "Battery Percentage" row. Press Escape.
  * Open a terminal (Super+Enter) and type `omarchy-battery-present; echo exit=$?` (1) and `omarchy-power-present; echo exit=$?` (1).
  ** If power-present prints 0, type `grep . /sys/class/power_supply/*/type` and report it.
  * Type `omarchy-battery-status; echo "[exit=$?]"` — an empty line then [exit=0]. Type `omarchy-battery-status --bogus` — "Usage: omarchy-battery-status [--shell]".
  * Press Super+Ctrl+Alt+B — record whether a notification appears and what it contains (expected: none or the bare glyph).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: percentages, charging states and thresholds need a battery.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar without a battery icon after Super+Ctrl+P, the Toggle submenu without Battery Percentage, the exit codes and empty status, the usage error, and the Super+Ctrl+Alt+B result
  * If unsuccessful
  ** A battery icon or panel appearing, status printing garbage, or a crash
covers: bin/omarchy-battery-present, bin/omarchy-battery-status, bin/omarchy-power-present, bin/omarchy-hw-laptop, shell/plugins/panels/power/Panel.qml, default/omarchy/omarchy-menu.jsonc (trigger.toggle.battery-percentage), default/hypr/bindings/utilities.lua (SUPER+CTRL+ALT+B), test/shell.d/power-present-test.sh, power-test.sh

### battery-low-notification-without-battery   [VM-OK]
description: The low-battery warning shows its critical notification and runs the user's battery-low hook when invoked, and refuses a wrong argument count, so the shell's low-battery path is verifiable without hardware.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-battery-low 15`. A critical notification "Time to recharge!" / "Battery is down to 15%" appears at the top right.
  * Type `omarchy-battery-low` — "Usage: omarchy-battery-low <percentage>", no notification.
  * Type `mkdir -p ~/.config/omarchy/hooks && printf '#!/bin/bash\necho "hook got $1" | sudo tee /dev/ttyS0\n' > ~/.config/omarchy/hooks/battery-low && chmod +x ~/.config/omarchy/hooks/battery-low`, then `sudo -v` (password `prime`) and `omarchy-battery-low 9`. A second notification appears; read get-serial: "hook got 9".
  * Type `rm ~/.config/omarchy/hooks/battery-low` to restore the stock state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The notification stays about 30 seconds; the second one stacks on the first.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Time to recharge!" notification, the usage line, and the serial dump containing "hook got 9"
  * If unsuccessful
  ** No notification, a notification on the usage path, or the hook not firing
covers: bin/omarchy-battery-low, bin/omarchy-hook, bin/omarchy-notification-send

### drive-password-change-and-back   [VM-OK] [SLOW]
description: Update → Password → Drive Encryption changes the disk passphrase so the old one no longer unlocks at boot and the new one does; changing it back restores `prime`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Password → Drive Encryption with the mouse. A floating terminal shows a masked input "New encryption password".
  * Type `newpass1` Enter, then `newpass1` Enter at "Confirm new encryption password". It prints "Changing full-disk encryption password for /dev/vdaN", may ask "[sudo] password for prime:" (type `prime`), then cryptsetup asks "Enter passphrase to be changed:" — type `prime` Enter. After about two seconds: "● Done! Press any key to close...". Press a key.
  * Press Super+Escape → Reboot. At the Plymouth box type `prime` Enter — rejected, the box clears. Type `newpass1` Enter — the progress bar appears and the system boots. Log in with `prime` (the user password is unchanged).
  * Open a terminal (Super+Enter) and type `omarchy-drive-password`: new password `prime`, confirm `prime`, passphrase to be changed `newpass1`. Done.
  * Type `sudo cryptsetup open --test-passphrase --verbose $(blkid -t TYPE=crypto_LUKS -o device) <<< prime` — "Command successful": `prime` unlocks again without another reboot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The passphrase must be `prime` again at the end or the disk cannot be resumed; if anything fails midway, repeat the change-back step before stopping.
  * cryptsetup's prompt is plain text at the bottom of the terminal, without gum styling.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two masked inputs, the "Changing full-disk encryption password" line and cryptsetup prompt, Done, Plymouth rejecting `prime` then accepting `newpass1`, the change-back run and "Command successful" for `prime`
  * If unsuccessful
  ** cryptsetup error text, a boot that unlocks with neither passphrase (get-serial), or the final test failing — state which passphrase the disk ended with
covers: bin/omarchy-drive-password, bin/omarchy-drive-select, default/plymouth/omarchy.script, default/omarchy/omarchy-menu.jsonc (update.password.drive), test/shell.d/drive-password-test.sh

### drive-password-rejects-bad-input   [VM-OK]
description: An empty passphrase, a mismatched confirmation and a wrong current passphrase are each refused without touching the disk encryption.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-drive-password`. Press Enter at "New encryption password" with nothing typed — "Password cannot be empty.".
  * Type `omarchy-drive-password`, then `abc123` Enter and `abc124` Enter — "Passwords do not match.".
  * Type `omarchy-drive-password`, then `abc123` Enter, `abc123` Enter; at "Enter passphrase to be changed:" type `wrongpass` Enter (password `prime` if sudo asks first) — cryptsetup prints "No key available with this passphrase.".
  * Type `sudo cryptsetup open --test-passphrase $(blkid -t TYPE=crypto_LUKS -o device) <<< prime && echo PRIME-OK` — PRIME-OK.
  * Type `omarchy-drive-info /dev/vda` — one line like "/dev/vda (40G) - … [vfat(/boot), crypto_LUKS]".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Count the bullets in the masked inputs to be sure the typed text landed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three rejection messages, PRIME-OK, and the drive-info line
  * If unsuccessful
  ** cryptsetup invoked on the empty/mismatch path, or `prime` no longer unlocking
covers: bin/omarchy-drive-password, bin/omarchy-drive-info, bin/omarchy-drive-select, test/shell.d/drive-password-test.sh

### sudo-passwordless-toggle-and-expiry   [VM-OK]
description: Setup → Security → Passwordless Sudo grants a timed no-password rule after a warning; the rule expires on its timer and a second run revokes it early; a bad argument is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `sudo -k; sudo -n true` — "a password is required".
  * Open the Omarchy Menu (Super+Space) → Setup → Security → Passwordless Sudo with the mouse. The floating terminal prints "Toggle passwordless sudo...", asks for the sudo password (`prime`), shows a warning block and "Enable passwordless sudo for 15 minutes? This is a significant security risk!". Press Enter (Yes).
  * It prints "Passwordless sudo has been ENABLED. It will automatically disable in 15 minutes." then "● Done!". Press a key. In the terminal type `sudo -k; sudo -n true && echo NOPASS` — NOPASS with no prompt.
  * Type `omarchy-sudo-passwordless` — "Passwordless sudo has been DISABLED. Sudo will require a password again." Then `sudo -k; sudo -n true` — "a password is required".
  * Type `omarchy-sudo-passwordless 1` and press Enter at the confirm (type `prime` if asked) — enabled for one minute. Screenshot every 5 seconds for about 75 seconds, then `sudo -k; sudo -n true` — "a password is required" again (expired).
  * Type `omarchy-sudo-passwordless abc` — "Usage: omarchy-sudo-passwordless [MINUTES]".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo -k` drops the cached credential so `sudo -n` tests the rule, not the timestamp.
  * Never sleep more than five seconds at a time while waiting for the expiry.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the initial refusal, the warning and confirm, the ENABLED line and NOPASS, the DISABLED line and refusal, the one-minute grant followed by the expired refusal, and the usage line
  * If unsuccessful
  ** sudo still passwordless after the disable or after the minute, or "Failed to schedule passwordless sudo expiry. Revoking access now."
covers: bin/omarchy-sudo-passwordless, default/omarchy/omarchy-menu.jsonc (setup.security.passwordless-sudo), test/shell.d/nopasswd-sudo-expiry-test.sh

### sudoless-docker-enable-and-menu-moves   [VM-OK]
description: Setup → Security → Sudoless Docker warns, adds the user to the docker group only after confirmation and moves its row to the Remove menu; declining changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Security with the mouse: a "Sudoless Docker" row is present. Click it. The floating terminal asks for the sudo password (`prime`), prints the "⚠️ WARNING" block and "Enable sudoless Docker? This gives anything running as you passwordless root.". Press n. Output "Aborted. No changes made. Docker access still goes through a prompt." then Done. Press a key.
  * Repeat the menu path and press Enter (Yes). Output "Sudoless Docker ENABLED. It takes effect after a reboot." then "Reboot now to apply?" — press n. Done.
  * Open Super+Space → Setup → Security: the Sudoless Docker row is gone. Escape. Super+Space → Remove → Security: a Sudoless Docker row is present. Escape.
  * Open a terminal (Super+Enter) and type `id -nG prime` — includes docker. Type `omarchy-setup-security-sudoless-docker` — "Sudoless Docker is already enabled: prime is in the docker group.".
  * Restore: Super+Space → Remove → Security → Sudoless Docker, confirm; then `id -nG prime` no longer includes docker, and type `omarchy-state clear reboot-required`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu re-evaluates its conditional rows each time it opens; re-open it after each change.
  * If usermod reports the docker group does not exist, report it and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the warning with "Aborted", the ENABLED run, the moved rows in both submenus, the group membership and "already enabled" line, and the restored state
  * If unsuccessful
  ** usermod errors, the row not moving, or membership unchanged after Yes
covers: bin/omarchy-setup-security-sudoless-docker, bin/omarchy-sudo-docker, bin/omarchy-state, default/omarchy/omarchy-menu.jsonc (setup.security.sudoless-docker, remove.security.sudoless-docker)

### setup-sshd-key-only-login-localhost   [VM-OK] [NET]
description: The SSHD setup installs and enables the server, authorizes a key and turns password logins off; key login to localhost works, password login is refused, and bad keys or arguments are rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `ssh-keygen -t ed25519 -N '' -q -f ~/testkey`.
  * Type `omarchy-setup-security-sshd --gh-keys` — "--gh-keys needs a GitHub username." with no sudo prompt and nothing installed.
  * Type `omarchy-setup-security-sshd --key="$(cat ~/testkey.pub)"` (password `prime`). Expected lines: "Setting up SSH server access with key-based authentication.", "Installing and starting the OpenSSH server...", "Opening the SSH port in the firewall…" (or "UFW is not installed; skipping firewall rule."), "Authorized key: 256 SHA256:… (ED25519)", "Disabling SSH password authentication, now that a key is authorized...", green "Perfect! The SSH server is running and your key is authorized.", "Password logins are off; this machine now accepts authorized keys only.".
  * Type `ssh -o StrictHostKeyChecking=no -i ~/testkey prime@localhost hostname` — the hostname, no password prompt.
  * Type `ssh -o PubkeyAuthentication=no -o BatchMode=yes prime@localhost true` — "Permission denied (publickey)".
  * Type `omarchy-setup-security-sshd --key=garbage` — after the install lines, "Not a valid SSH public key: garbage".
  * Open Super+Space → Remove → Security: an SSHD row is now listed. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu route (Setup → Security → SSHD) asks "Grab key from GitHub"/"Paste key manually"; the --key form avoids transcribing an 80-character key from a screenshot — say so in the report.
  * The openssh download is small.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the --gh-keys refusal, the setup output through "Perfect!", the key login printing the hostname, the password login refused, the garbage-key rejection, and the Remove → Security → SSHD row
  * If unsuccessful
  ** "sshd rejected the hardening config" / "did not apply the password-authentication restrictions", a key login asking for a password, or password login succeeding
covers: bin/omarchy-setup-security-sshd, default/omarchy/omarchy-menu.jsonc (setup.security.sshd, remove.security.sshd)

### setup-fido2-no-device   [VM-PARTIAL] [NET]
description: Without a FIDO2 token the Fido2 setup installs its packages and stops with a clear message, leaving PAM untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Security → Fido2 with the mouse.
  * The floating terminal prints "Setting up FIDO2 device for authentication.", "Installing required packages..." (password `prime`; libfido2 and pam-u2f, small download), then red "No FIDO2 device detected. Please plug it in (you may need to unlock it as well)." and "● Failed (exit code 1)! Press any key to close...". Press a key.
  * Open a terminal (Super+Enter) and type `grep -c pam_u2f /etc/pam.d/sudo` — 0 — and `ls /etc/fido2` — no such file.
  * Type `sudo -k; sudo true` — the normal password prompt still works (type `prime`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: registration and the sudo test with a token need a real device.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install lines, the red no-device message with exit code 1, the untouched PAM check and the working sudo prompt
  * If unsuccessful
  ** PAM modified, a package install failure, or a crash
covers: bin/omarchy-setup-security-fido2, default/omarchy/omarchy-menu.jsonc (setup.security.fido2)

### setup-fingerprint-hidden-without-reader   [VM-PARTIAL]
description: Without a fingerprint reader the Fingerprint row is hidden from Setup → Security and the setup command refuses before installing or configuring anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Security with the mouse. Rows: Fido2, SSHD, Passwordless Sudo, Sudoless Docker — no Fingerprint. Press Escape.
  * Open a terminal (Super+Enter) and type `omarchy-setup-security-fingerprint; echo exit=$?` — "Setting up fingerprint scanner for authentication." then red "No fingerprint sensor detected.", exit=1, with no sudo prompt and no package install.
  * Type `grep -c pam_fprintd /etc/pam.d/sudo` — 0.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: enrolment, verification and the lock-screen PAM stack need a reader.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Security submenu without Fingerprint, the refusal with exit=1, and the PAM check
  * If unsuccessful
  ** A Fingerprint row shown, a package install attempted, or PAM modified
covers: bin/omarchy-setup-security-fingerprint, default/omarchy/omarchy-menu.jsonc (setup.security.fingerprint)

### setup-direct-boot-toggle   [VM-OK]
description: Setup → Direct Boot adds an EFI entry for the Omarchy boot image after confirmation and a second run removes it; declining leaves the firmware untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `efibootmgr | grep -c Omarchy` — 0.
  * Open the Omarchy Menu (Super+Space) → Setup → Direct Boot with the mouse. The floating terminal asks (password `prime` if needed) "Setup direct boot (so snapshot booting must be done via bios)?". Press n. Done, nothing printed. Press a key. `efibootmgr | grep -c Omarchy` — still 0.
  * Repeat and press Enter (Yes): "Creating EFI boot entry for omarchy….efi" and the efibootmgr listing. Done. `efibootmgr | grep Omarchy` — one `Boot00XX* Omarchy` line.
  * Repeat: the prompt is now "Disable direct boot (remove Omarchy EFI entry)?". Press Enter. "Removing EFI boot entry 00XX". Done. `efibootmgr | grep -c Omarchy` — 0.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Always finish with the entry removed; rebooting with it present bypasses Limine and its Snapshots menu.
  * "American Megatrends firmware may not safely support custom EFI entries" means the guest firmware is not the expected OVMF — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the declined run with 0 entries, the created `Boot00XX* Omarchy` line, the disable prompt and the final 0
  * If unsuccessful
  ** efibootmgr errors, the entry persisting after removal, or "No Omarchy UKI found in /boot/EFI/Linux/"
covers: bin/omarchy-setup-direct-boot, default/omarchy/omarchy-menu.jsonc (setup.direct-boot)

### crash-capture-toast-on-segfault   [VM-OK]
description: When a user program dumps core a critical "Process crashed" notification offers an AI diagnosis; a repeat crash within a minute is not re-announced.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-default-agent`. If it prints nothing, type `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` and record that no agent was set.
  ** The watcher stays silent until an agent is chosen; this is the quirk that makes a stock disk look broken.
  * Type `ulimit -c unlimited; sleep 300 & sleep 1; kill -SEGV $!`. Within a few seconds a critical notification "Process crashed: sleep" / "Click to diagnose with AI" appears.
  * Type `coredumpctl list | tail -n 1` — a row for sleep with SIGSEGV.
  * Type `sleep 300 & sleep 1; kill -SEGV $!` again — no second notification within 60 seconds.
  * Click the notification with the mouse. A terminal opens trying to run the default agent with the crash prompt (an install attempt or error is acceptable since no agent is installed — record it). Close it.
  * If you created the agent file in step 1, type `rm ~/.config/omarchy/defaults/agent`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The crash of `sleep` is the intended trigger, not a bug.
  * Critical notifications stay until dismissed; they sit at the top right.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Process crashed: sleep" notification, the coredumpctl row, the second crash without a new notification, and what the click opened
  * If unsuccessful
  ** No notification after 15 s (`journalctl --user -u omarchy-crash-watch -b | tail | sudo tee /dev/ttyS0`), or a notification for the deduped crash
covers: bin/omarchy-crash-watch, bin/omarchy-agent-crash, default/systemd/user/omarchy-crash-watch.service, default/agents/skills/diagnose-crash/SKILL.md, test/shell.d/crash-capture-test.sh

### crash-mute-silences-and-unmutes   [VM-OK]
description: `omarchy crash mute <program>` silences crash notifications for that program only and `off` restores them; names that are not programs and unknown actions are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition as in crash-capture-toast-on-segfault: `omarchy-default-agent` prints a name (else write `claude` into ~/.config/omarchy/defaults/agent).
  * Open a terminal (Super+Enter) and type `omarchy-crash-mute` — "No programs muted. Crashes all notify." Type `omarchy-crash-mute sleep` — "Muted crash notifications for sleep."; `omarchy-crash-mute` now lists sleep.
  * Type `ulimit -c unlimited; sleep 300 & sleep 1; kill -SEGV $!` and watch 15 seconds — no notification.
  * Type `omarchy-crash-mute /usr/bin/sleep off` — "Crash notifications for sleep are back on." (a path maps to its basename).
  * Wait until 60 seconds have passed since the muted crash (screenshot every 5 seconds), then `sleep 300 & sleep 1; kill -SEGV $!` — "Process crashed: sleep" appears.
  * Type `omarchy-crash-mute sleep sideways` — "Not an action: sideways" and the usage line. Type `omarchy-crash-mute /` — "Not a program name: /".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The 60-second dedupe window is why the wait before the final crash matters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty list, the mute and listing, the silent crash, the unmute, the notification after unmuting, and the two rejections
  * If unsuccessful
  ** A notification while muted, none after unmuting (`journalctl --user -u omarchy-crash-watch -b | tail | sudo tee /dev/ttyS0`), or a rejection accepted
covers: bin/omarchy-crash-mute, bin/omarchy-crash-watch, test/shell.d/crash-capture-test.sh

### crash-capture-toggle-disables-watcher   [VM-OK]
description: Trigger → Toggle → Crash Capture turns crash notifications off (no notification on a crash) and back on, announcing each state.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: `omarchy-default-agent` prints a name (see crash-capture-toast-on-segfault).
  * Open the Omarchy Menu (Super+Space) → Trigger → Toggle → Crash Capture with the mouse. A notification "Crash capture disabled" appears.
  * Open a terminal (Super+Enter) and type `ulimit -c unlimited; sleep 300 & sleep 1; kill -SEGV $!`; watch 15 seconds — no notification.
  * Open Super+Space → Trigger → Toggle → Crash Capture again. Notification "Crash capture enabled".
  * Wait until 60 seconds have passed since the crash, then `sleep 300 & sleep 1; kill -SEGV $!` — "Process crashed: sleep" appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the Toggle row before clicking; it may carry a state mark.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both notifications, the silent crash while disabled, and the notification after re-enabling
  * If unsuccessful
  ** A notification while disabled, or none after enabling (`systemctl --user is-active omarchy-crash-watch.service`)
covers: bin/omarchy-toggle-crash-capture, default/systemd/user/omarchy-crash-watch.service (ConditionPathExists), default/omarchy/omarchy-menu.jsonc (trigger.toggle.crash-capture)

### factory-reset-cancel-at-confirmation   [VM-OK]
description: Setup → Reset Computer explains what will be erased and refuses unless the word `reset` is typed (or reports that this machine has no factory snapshot); nothing changes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Reset Computer with the mouse. The floating terminal asks for the sudo password (`prime`).
  * If a yellow "This machine has no factory snapshot to reset to." appears with "Reinstall from the Omarchy ISO to make this machine resettable." and "● Failed (exit code 1)!", press a key, record this outcome and skip to the last step.
  * Otherwise a bold red "Reset this computer to factory state?" lists what is erased (accounts and /home; packages and system changes; machine identity) and asks "Type 'reset' to continue". Type `nope` Enter. "Error: Reset not confirmed." and "● Failed (exit code 1)!". Press a key.
  * Repeat the menu path and press Escape at the input — the window closes without further output.
  * Open a terminal (Super+Enter) and type `sudo btrfs subvolume list / | grep -c omarchy-reset` — 0.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never type `reset` at that prompt; the full reset is a separate, disk-destroying test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the warning screen (or the no-snapshot screen), "Reset not confirmed." with exit code 1, the Escape exit, and the subvolume check
  * If unsuccessful
  ** Any staging line ("Cloning the factory snapshot" …) after a refusal, or a subvolume named omarchy-reset-next
covers: bin/omarchy-system-factory-reset, default/omarchy/omarchy-menu.jsonc (setup.reset), test/shell.d/factory-reset-accounts-test.sh

### factory-reset-full-cycle   [VM-NO] [SLOW]
description: A full factory reset stages a clone of the factory snapshot, re-keys the disk, wipes the old system on the next boot and lands in the first-boot owner wizard like a fresh install. Destroys the disk and re-keys LUKS; longer than a session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: a factory snapshot exists (`sudo btrfs subvolume list / | grep @factory`). The disk must be discarded at the end; never save it.
  * Open the Omarchy Menu (Super+Space) → Setup → Reset Computer, type `prime` for sudo, type `reset` at the confirmation.
  * At "Confirm your disk encryption passphrase to authorize the re-key." type `wrongpass` first — red "That passphrase does not unlock …. Try again." — then `prime`.
  * Grey log lines: "Cloning the factory snapshot", "Scrubbing machine identity from the factory system", "Removing account credentials from the factory system", "Rebuilding boot files from the factory system (this can take a minute)", "Activating the factory system"; then bold "Reset staged. The wipe finishes on the next boot." and "Reboot to complete the reset?" — choose "Reboot now".
  * The boot asks for no passphrase (throwaway auto-unlock key). tty1 shows the provisioning greeter: animated logo, "Beautiful, Fun & Agentic Linux by DHH", "Press Return to Start Setup". Press Enter.
  * Walk the wizard: keyboard (English US), username `prime`, password `prime` twice, name/email (Enter to skip), hostname, timezone, then the summary table "Does this look right?" — choose "No, change it" once, then Yes.
  * "Setting up your machine" shows a progress bar with rotating tips for several minutes, then SDDM autologins the new prime desktop.
  * Open a terminal: `ls /home` (only prime, empty of old files), `sudo btrfs subvolume list /` (no @omarchy-old-*, @factory retained). Press Super+Escape → Reboot — the Plymouth box now asks for the passphrase `prime` again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Far beyond ten minutes; recorded for the not-runnable appendix.
  * A failed wizard shows "Setup hit an error (details in /var/log/omarchy-provision-owner.log)" with "Try again"/"Drop to console".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of every screen named above, the passphrase-less boot, the wizard steps, the progress bar, the new desktop and the subvolume list without old roots
  * If unsuccessful
  ** A Limine hash-mismatch warning, a boot asking for a passphrase, the wizard error screen, and `journalctl -b | grep factory-wipe | sudo tee /dev/ttyS0`
covers: bin/omarchy-system-factory-reset, bin/omarchy-system-factory-reset-finish, bin/omarchy-provision-owner, bin/omarchy-provision-user, install/config/snapper.sh, default/limine/limine.conf, test/shell.d/factory-reset-accounts-test.sh, setup-form-test.sh, provision-user-test.sh

### channel-menu-current-and-dev-cancel   [VM-OK]
description: Update → Channel marks the active channel and matches what the command line reports; backing out of the Dev warning, or naming an unknown channel, changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Channel with the mouse. Four rows: Stable 🟢, RC 🟡, Edge 🟠, Dev 🔴; only Stable has a ✓. Press Escape.
  * Open a terminal (Super+Enter) and type `omarchy-channel-current; omarchy-version-channel` — both print stable.
  * Type `omarchy-channel-set bogus` — "Unknown channel: bogus" and "Usage: omarchy-channel-set [stable|rc|edge|dev]".
  * Open Super+Space → Update → Channel → Dev with the mouse. The floating terminal shows the warning ("The dev channel links Omarchy directly to a checkout of the source in ~/omarchy…") and "Switch to dev channel?" with No preselected. Press Enter. "Cancelled." then "● Done!". Press a key.
  * Type `ls ~/omarchy` — no such directory — and `omarchy-channel-current` — still stable. Super+Space → Update → Channel still shows ✓ on Stable.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes to the dev prompt: it clones the repository and starts a full update.
  * If `omarchy-channel-current` is "command not found" the disk predates channels; record it and judge by the menu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Channel submenu with ✓ on Stable, the two stable outputs, the bogus rejection, the dev warning with "Cancelled." and Done, and the unchanged checks
  * If unsuccessful
  ** A ✓ on the wrong row, disagreeing outputs, a git clone starting, or a sudo prompt on the cancel path
covers: bin/omarchy-channel-current, bin/omarchy-channel-set, bin/omarchy-version-channel, default/omarchy/omarchy-menu.jsonc (update.channel.*), test/shell.d/channel-test.sh

### channel-switch-rc-and-back   [VM-OK] [NET] [SLOW]
description: Switching to the RC channel repoints the mirrors, installs its packages and runs an unattended update; switching back to Stable restores the original channel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Best run on a disk already updated (the embedded unattended update is then short). Open a terminal (Super+Enter) and type `omarchy-channel-current` — stable.
  * Open the Omarchy Menu (Super+Space) → Update → Channel → RC with the mouse. The floating terminal asks for sudo (`prime`), prints the mirror refresh, a pacman transaction for omarchy and omarchy-settings from the rc repo (or "is up to date -- skipping"), then the update banners through "Restarting shell". Press n at any reboot prompt. Done. Press a key.
  * Type `omarchy-channel-current` — rc. Super+Space → Update → Channel shows ✓ on RC. Escape.
  * Open Super+Space → Update → Channel → Stable. Same flow; pacman may print "warning: downgrading package omarchy". Press n at any reboot prompt. Done.
  * Type `omarchy-channel-current` — stable; the Channel submenu shows ✓ on Stable.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A failure prints "The channel switch did not complete. Review the error above, then rerun: omarchy-channel-set rc" — capture it and rerun as told.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the mirror refresh and pacman lines for each switch, the update banners, `omarchy-channel-current` reading rc then stable, and the ✓ moving in the submenu
  * If unsuccessful
  ** The "did not complete" trailer with the preceding error, a mismatch between the command and the ✓, or the update's red failure block
covers: bin/omarchy-channel-set, bin/omarchy-channel-current, bin/omarchy-update (-y path), bin/omarchy-update-pacman, default/omarchy/omarchy-menu.jsonc (update.channel.stable/rc), test/shell.d/channel-test.sh

### version-shown-in-about-and-cli   [VM-OK]
description: The About screen and `omarchy-version` show the same installed package version, and a dev-linked path reports itself as dev.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → About with the mouse. The about screen shows the Omarchy version (e.g. 4.0.2-1). Screenshot, then close it with Escape.
  * Open a terminal (Super+Enter) and type `omarchy-version` — the same string — and `pacman -Q omarchy` — the same version after the package name.
  * Type `OMARCHY_PATH=/tmp omarchy-version` — "dev" (a linked checkout would add its hash).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * About may take a second to draw its art; wait before screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the About screen and the terminal with the matching version and the "dev" output
  * If unsuccessful
  ** An empty version, or About disagreeing with pacman
covers: bin/omarchy-version, bin/omarchy-version-channel, test/shell.d/version-test.sh

### debug-report-and-menu-without-upload   [VM-OK]
description: `omarchy-debug` gathers a system report and offers to view or save it; on this machine the upload option is correctly absent because ping is blocked; a bad flag is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-debug --bogus` — "Unknown option: --bogus" and "Usage: omarchy-debug [--no-sudo] [--print]".
  * Type `omarchy-debug` and `prime` at the sudo prompt. After 10–20 seconds a chooser appears with exactly "View log" and "Save in current directory" — no "Upload log".
  * Choose "View log": less shows the report with "Date:", "Hostname:", "Omarchy Package: omarchy 4.0…" and "SYSTEM INFORMATION". Press q.
  * Type `omarchy-debug` again and choose "Save in current directory" — "✓ Log saved to /home/prime/omarchy-debug.log". Type `ls -la ~/omarchy-debug.log` — a file of at least 50 KB.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Upload log" is gated on ping to 8.8.8.8, which the guest network blocks; its absence is expected. If it IS offered, report that.
  * inxi is slow; keep screenshotting while it collects.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage error, the two-option chooser, less showing the report header, the saved-file message and its size
  * If unsuccessful
  ** inxi/expac errors in the report, an unexpected chooser option, or the saved file missing
covers: bin/omarchy-debug

### debug-idle-report   [VM-OK]
description: `omarchy debug idle` prints every idle/lock diagnostic section with live values and reflects the Stay Awake toggle.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-debug-idle 50 | sudo tee /dev/ttyS0` (password `prime`). Read get-serial: sections "== Time ==", "== Idle IPC status ==", "== Quickshell instances ==", "== Recent idle logs ==", "== Persisted shell log ==", "== Relevant processes ==", "== Sleep lock service ==" (active (running)), "== Hyprland screensaver clients ==", "== Idle inhibitors ==", "== Screensaver detector ==" (stopped), "== Lock detector ==" with `"secure": false`.
  * Press Super+Ctrl+I (Stay Awake). An indicator appears in the bar. Type `omarchy-debug-idle 20 | grep -A2 'Idle IPC'` — the status now shows idle disabled / stay-awake.
  * Press Super+Ctrl+I again; the indicator is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The serial dump is the readable copy; the terminal scrolls past most of it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with all eleven section headers and the lock detector JSON; screenshots of the stay-awake indicator with the changed idle status and of the restored bar
  * If unsuccessful
  ** Missing sections, the sleep lock service not running, or quickshell/hyprctl errors in the output
covers: bin/omarchy-debug-idle, bin/omarchy-toggle-idle, default/systemd/user/omarchy-sleep-lock.service, default/hypr/bindings/utilities.lua (SUPER+CTRL+I)

### provision-first-run-replay-and-guards   [VM-OK]
description: The first-login setup reports it already ran and replays its steps and welcome notification on --force; the provisioning helpers refuse the wrong caller (root for user finalization, a user for the owner wizard).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-provision-first-run` — "First-run already complete (rerun with --force to refresh).".
  * Type `omarchy-provision-first-run --force`. Within a few seconds a welcome notification appears; the command ends with "User finalization complete.".
  ** A brief theme flicker is normal as settings are re-applied.
  * Type `tail -n 12 ~/.local/state/omarchy/first-run.log` — "Starting:"/"Completed:" pairs for each step and no "Failed:".
  * Type `sudo omarchy-provision-user` (password `prime`) — "Error: run omarchy-provision-user as the user being configured, not as root.".
  * Type `omarchy-provision-owner` — "Error: omarchy-provision-owner must run as root". Type `sudo omarchy-provision-owner; echo exit=$?` — no output, exit=0 (nothing pending; no wizard appears).
  * Type `omarchy-provision-first-run --bogus` — "Unknown option: --bogus" and the usage block.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the owner wizard's logo appears, press Ctrl+C and report it — it must not start on a provisioned system.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the already-complete line, the welcome notification, the log tail with only Completed lines, the two refusals, the silent owner run and the usage error
  * If unsuccessful
  ** Any "Failed:" line (step and exit code), no notification, root finalization proceeding, or the wizard starting
covers: bin/omarchy-provision-first-run, bin/omarchy-provision-user, bin/omarchy-provision-owner, bin/omarchy-done, install/user/first-run/enable-user-units.sh, test/shell.d/provision-user-test.sh

### stay-awake-toggle-and-update-restore   [VM-OK]
description: Super+Ctrl+I toggles Stay Awake in the bar, and the update's own stay-awake helper only turns on what it found off and restores it afterwards, never clearing a user's choice.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+I. A stay-awake indicator appears in the bar.
  * Open a terminal (Super+Enter) and type `omarchy-update-stay-awake start` (password `prime`) then `omarchy-update-stay-awake stop`. The indicator stays ON — the user set it, the update must not clear it.
  * Press Super+Ctrl+I; the indicator disappears.
  * Type `omarchy-update-stay-awake start`: the indicator turns ON and `systemd-inhibit --list | grep omarchy-update` shows "Omarchy update in progress" in block mode.
  * Type `omarchy-update-stay-awake stop`: the indicator turns OFF and the grep shows nothing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The indicator is a small icon near the other status icons; compare bar screenshots before and after each step.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots before/after each step showing the indicator preserved, then turned on and off by the helper, plus the inhibitor line while started and its absence after stop
  * If unsuccessful
  ** The helper clearing a user-set Stay Awake, an inhibitor left after stop (`systemd-inhibit --list | sudo tee /dev/ttyS0`), or no indicator change
covers: bin/omarchy-update-stay-awake, bin/omarchy-toggle-idle, default/hypr/bindings/utilities.lua (SUPER+CTRL+I), test/shell.d/update-lock-test.sh

## Gaps

- **True offline update** — the driver cannot detach the NIC; only the bogus-mirror simulation is
  proposed. DNS failure and the bar widget's behaviour with no route are untested.
- **Real `sudo pacman -Syu` guard trip** — reachable only after downloading the whole pending upgrade
  (libalpm runs PreTransaction hooks post-download); covered by direct invocation of the guard binary.
- **Conflict handler** (`omarchy-update-system-pkgs-when-conflicted`): needs a genuine unowned-file or
  package-vs-package conflict in the repos at test time. Could be staged by creating an unowned file at a
  path the next `omarchy` package installs, but the path set is release-specific; left to maintainer tests
  (`update-file-conflict-test.sh`, `update-package-conflict-test.sh`).
- **Orphan removal prompt**, **AUR update**, **initramfs failure analysis**, **restart-*-required
  markers**, **`omarchy-hook post-update`** — depend on repo state or user hooks; only incidental coverage
  inside the end-to-end run (a post-update hook could be added by the driver with `echo … | sudo tee
  /dev/ttyS0` the way battery-low does; not written up as it duplicates the hook mechanism test).
- **Wake from suspend** — QEMU S3 wake needs the monitor (`system_wakeup`); the harness exposes none.
  The unlocked-after-wake screen and `omarchy-system-wake` on a real display are therefore unproven.
- **Hibernate / resume** — needs a resume through the harness's boot handling and > 10 min including
  setup; setup/remove are covered, the sleep itself is not.
- **Power button (`XF86PowerOff` → System menu)** and **lid switch** — no such input events from the
  driver; `HandlePowerKey=ignore` untestable.
- **Battery percentages, charging states, thresholds, low-battery trigger from the shell, power panel
  GUI (`omarchy.power`) and its profile buttons** — no battery device; only absence paths and the
  helper CLI are covered.
- **`omarchy-powerprofiles-set battery …`** on a real discharging machine and `performance` profile
  availability — VM lacks a platform driver.
- **Fingerprint enrolment, FIDO2 registration** — no devices; refusal paths only.
- **Inbound SSH** — user-mode NAT blocks inbound; key-only auth is proven via localhost.
- **Full factory reset and the tty1 provisioning wizard** — destructive and > 10 min; written as VM-NO.
  The wizard's keyboard/timezone pickers and the "Try again / Drop to console" failure screen are
  untested in isolation (would need `sudo touch /var/lib/omarchy/provisioning/pending` and a reboot,
  which then attempts to create a *second* user on a live system — not safe to script for a driver).
- **Dev channel end to end** (`omarchy-channel-set dev` → clone, dev-link, `omarchy-update-dev`
  fast-forward, `omarchy-dev-checkout` behind count in the bar) — NET-heavy and reboot-required; only
  the cancel path is proposed. `omarchy-update-dev` on a checkout without upstream ("Skip Omarchy dev
  checkout update") likewise untested.
- **Limine snapshot entry limit (`MAX_SNAPSHOT_ENTRIES=6`) and hash-mismatch warning** — needs > 5
  snapshots plus a sync race, or a deliberately corrupted UKI; not user-reachable safely.
- **Plymouth "resume" mode progress bar**, **`unmount-fuse`/`force-igpu`/`keyboard-backlight` sleep hooks**
  — need hibernation/suspend cycles, a FUSE mount and ASUS/NVIDIA hardware.
- **`omarchy-debug` "Upload log"** — gated on ICMP which the NAT blocks; logs.omarchy.org upload unproven.
- **`omarchy-sudo-keepalive`** — sourced helper with no user-facing surface.
- **Migration notifier suppression while an update holds the lock** — timing-dependent (needs a login
  during an update); documented behaviour only.
- **oomd notification** (if the shell shows one) — not in this reviewer's scope; only the kill/survival is
  proposed.
