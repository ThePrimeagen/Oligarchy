# 13 — Manual "The Rest": Mac support, Troubleshooting, FAQ, Snapshots, Security, Omarchy on…, Dual boot, Unattended installs

Reviewer notes for `manual/44` … `manual/51`, plus the install/first-boot part of `manual/02` and `README.md`,
cross-checked against the scripts and config the chapters name. Format per `test_def/00-FORMAT.md`.

## Scope

Source: `/tmp/omarchy-review/omarchy` @ `d174d4a` (2026-09-18, `version` = `4.0.0.alpha`). Read in full:

| file | lines | notes |
|---|---|---|
| `manual/44-mac-support.md` | 71 | all hardware-only; VM can only test the absence path |
| `manual/45-troubleshooting.md` | 49 | |
| `manual/46-faq.md` | 85 | |
| `manual/47-system-snapshots.md` | 25 | |
| `manual/48-security.md` | 31 | |
| `manual/49-omarchy-on.md` | 29 | links only (Asahi, Parallels, VirtualBox, VMware, Steam Deck, NixOS); nothing about QEMU/KVM, virtio, resolution or clipboard |
| `manual/50-dual-boot-install.md` | 44 | install-time only |
| `manual/51-unattended-installs.md` | 61 | install-time only |
| `manual/02-getting-started.md` | 39 | install + first-boot sections |
| `README.md` | 79 | index of the manual; no behaviour |
| `bin/omarchy-snapshot` | 49 | |
| `bin/omarchy-system-factory-reset` | 452 | |
| `bin/omarchy-system-factory-reset-finish` | 167 | |
| `bin/omarchy-provision-owner` | 1139 | first-boot form after a reset / deferred install |
| `install/provisioning/setup-form.sh` | 183 | shared form validation rules |
| `install/provisioning/*.service` | 2 units | |
| `bin/omarchy-sudo-passwordless` | 71 | |
| `bin/omarchy-sudo-keepalive` | 9 | |
| `bin/omarchy-setup-direct-boot` | 61 | |
| `bin/omarchy-drive-password`, `-drive-select`, `-drive-info` | 32 / 19 / 50 | |
| `bin/omarchy-setup-security-sshd`, `-remove-security-sshd` | 213 / 33 | |
| `bin/omarchy-debug` | 96 | |
| `bin/omarchy-reinstall`, `-reinstall-pkgs`, `-reinstall-configs` | 16 / 17 / 40 (head) | |
| `bin/omarchy-dns` | 320 | |
| `bin/omarchy-crash-watch`, `-crash-mute`, `-agent-crash`, `-toggle-crash-capture` | 110 / 75 / 52 / 19 | |
| `bin/omarchy-hibernation-available`, `-setup`, `-remove` | 20 / 166 / 55 | |
| `bin/omarchy-install-service-tailscale` | 22 | |
| `bin/omarchy-update` (snapshot step), `-update-restart`, `-update-confirm`, `-update-time`, `-menu-timezone` | | |
| `bin/omarchy-restart-wifi`, `-bluetooth`, `-audio`, `-trackpad` | | Update > Hardware entries |
| `bin/omarchy-audio-tuning` (status/off paths), `-disk-speedtest`, `-remove-preinstalls`, `-pkg-remove`, `-install-chromium-google-account`, `-version`, `-refresh-limine`, `-launch-floating-terminal-with-presentation`, `-show-done`, `-system-reboot/-shutdown/-logout/-lock`, `-default-agent`, `-apply-lock`, `-apply-system`, `-hw-laptop`, `-provision-first-run` (head) | | |
| `default/snapper/root`, `default/limine/limine.conf`, `default/limine/default.conf`, `etc/limine-entry-tool.d/omarchy-defaults.conf`, `etc/mkinitcpio.conf.d/omarchy_hooks.conf` | | |
| `etc/security/faillock.conf`, `etc/sudoers.d/{omarchy-dns,omarchy-passwd-tries,omarchy-theme-browser,omarchy-tzupdate}` | | |
| `install/config/*.sh` (all 12), `install/login/sddm.sh`, `install/post-install/localdb.sh` | | |
| `default/omarchy/omarchy-menu.jsonc` (Setup / Update / Remove / Install / System / Trigger sections), `docs/menu.md`, `docs/update-process.md` (snapshot step), `docs/file-layout.md` (provisioning), `migrations/1782049344.sh`, `config/autostart/limine-snapper-notify.desktop`, `config/hypr/monitors.lua`, `default/hypr/autostart.lua`, `default/xcompose` (head), `default/pacman/*` | | |

Also consulted (outside the tree, to pin behaviour the manual asserts but this repo does not implement):
`/tmp/omarchy-review/omarchy-iso` @ `7cfb711` — `configs/airootfs/usr/local/bin/omarchy-cidata-load`,
`orchestrator/phases_impl.py` (configure_ssh_access, configure_tailscale, configure_login, create_factory_snapshot),
`configs/airootfs/root/configurator` (Ctrl+C flows); and the upstream `limine-snapper-sync` sources
(`limine-snapper-restore`, `limine-snapper-notify`, autostart `.desktop` files) since `omarchy-snapshot restore`
and the "you are in a snapshot" notification are entirely that package.

Skipped: `manual/49` external guides (not Omarchy code); the Mac hardware scripts' internals
(`install/hardware/apple/*.sh`, read for the inventory only — no Mac in the VM); the `omarchy-audio-tuning`
matching internals beyond `status`/`off`; the body of `omarchy-restart-audio`'s USB-reset logic (no USB audio in the VM).

## Inventory

**manual/44 — Mac support**
- 44:3 Intel Macs supported; 44:5 M-series not supported (points to Discord / `manual/49` Asahi guide). Hardware-only.
- 44:13 Omarchy must be the only OS on a Mac (drive wiped, macOS unbootable; Internet Recovery to restore).
- 44:19-29 Disable Apple Secure Boot: Cmd-R recovery → Utilities > Startup Security Utility → "No Security" + "Allow booting from external media". Firmware-only.
- 44:31-36 Boot the USB: hold Option → pick orange "EFI Boot" → normal install (`manual/02`).
- 44:37 Installer auto-detects Mac hardware: Broadcom Wi-Fi driver/firmware → `install/hardware/apple/fix-brcmfmac-supplicant.sh`, `install/hardware/fix-bcm43xx.sh`; SPI keyboard → `install/hardware/apple/fix-spi-keyboard.sh`; NVMe suspend fix → `install/hardware/apple/fix-suspend-nvme.sh`.
- 44:44-54 T1 models (A1706/A1708/A1707): Touch Bar non-functional, sound not functioning. Documented limitation.
- 44:56-71 T2 models list; installer sets up `linux-t2` kernel, T2 audio, Broadcom Wi-Fi/BT firmware, `t2fanrd` → `install/hardware/apple/fix-t2.sh`; Limine boot order prefers `linux-t2` → `etc/limine-entry-tool.d/omarchy-defaults.conf:20` `BOOT_ORDER="linux-t2, linux-omarchy, …"`.

**manual/45 — Troubleshooting**
- 45:5 "I broke my system with an update" → rollback via snapshots (`manual/47`); `omarchy-debug` to share logs; `omarchy-reinstall` to reinstall packages + default configs (`bin/omarchy-reinstall` → `gum confirm` → `omarchy-reinstall-pkgs` (stable mirrors, `pacman -Suu`, base packages) → `omarchy-reinstall-configs` (`cp -af /etc/skel/. ~/`, `omarchy-refresh-limine`, `omarchy-refresh-plymouth`, nvim refresh) → "System has been reinstalled. Reboot?").
- 45:9 Oversized apps: `GDK_SCALE=2` assumed; edit `local omarchy_gdk_scale = 2` → `1` in `~/.config/hypr/monitors.lua` (`config/hypr/monitors.lua:21-22`, `hl.env("GDK_SCALE", …)`), restart the app. Manual says "restart any app"; monitors.lua comment says the same.
- 45:11 Spotify: `Ctrl + Minus` / `Ctrl + Plus` to resize UI (third-party app; NET install).
- 45:15-23 Caps Lock is the XCompose key (`default/xcompose`: `<Multi_key> <m> <s>` → 😄 etc.); remap by `kb_options = "compose:ralt"` in `~/.config/hypr/input.lua`.
- 45:27 Subsystem restarts: Omarchy menu _Update > Hardware_ → Wi-Fi / Bluetooth / Audio / Trackpad (`omarchy-menu.jsonc:358,374-377` → `omarchy-restart-wifi` (rfkill unblock, nmcli radio on, rescan, `rfkill list wifi`), `omarchy-restart-bluetooth` (rfkill unblock/list), `omarchy-restart-audio` (restart wireplumber/pipewire/pipewire-pulse, USB reset fallback, prints `wpctl status`, exit 1 if wpctl still hangs), `omarchy-restart-trackpad` (i2c_hid_acpi unbind/rebind, intel_quicki2c reload; requires sudo)). All run in the floating presentation terminal ending in "Done! Press any key to close…" (`omarchy-launch-floating-terminal-with-presentation`, `omarchy-show-done`).
- 45:31 External speakers: click speaker icon in bar → volume popup → pick output device / per-app mix (shell audio panel; hardware absent in VM).
- 45:35 Laptop speaker tuning: `omarchy audio tuning status` (prints `Installed: yes/no`, `Host service: …`, `Tuning sink: …`), `omarchy audio tuning off` (`bin/omarchy-audio-tuning`).
- 45:39 Login/sudo lockout: `Ctrl + Alt + F2` → login as root → `faillock --reset --user <user>`. Code: `etc/security/faillock.conf` `deny = 10`; `install/config/increase-lockout-limit.sh` writes `deny=10 unlock_time=120` into `/etc/pam.d/system-auth` and `sddm-autologin`; `bin/omarchy-apply-lock` writes `/etc/pam.d/omarchy-lock-password` with the same `deny=10 unlock_time=120` for the shell lock screen. So lockout = 10 failures, auto-unlock after 120 s (manual does not state either number). Root password = user password on ISO installs (`setup-form.sh:127` placeholder "Used for user + root"; `omarchy-provision-owner:741` `chpasswd root`).
- 45:43-49 1Password approval prompts need Settings > Advanced > Use Hardware Acceleration (reboot) and 1Password launched once. Third-party; NET.

**manual/46 — FAQ**
- 46:5-17 Multiple keyboard layouts: `kb_layout = "us,fr"`, `kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle"` in `~/.config/hypr/input.lua`; bar shows current layout once >1 configured; click the indicator to switch.
- 46:21-27 Clock format: right-click the bar clock cycles common formats (incl. 12-hour); `omarchy bar set omarchy.clock format "dddd h:mm AP"` → "Sunday 10:55 AM" (`bin/omarchy-bar`).
- 46:31 Timezone: _Update > Timezone_ (`omarchy-menu.jsonc:361` → `bin/omarchy-menu-timezone`: picker via `omarchy-menu-select`, `sudo timedatectl set-timezone` — passwordless through `etc/sudoers.d/omarchy-tzupdate`, then `omarchy-shell omarchy.clock refresh` and notification "Timezone is now set to <tz>"). _Update > Time_ (`:362` → `omarchy-update-time`: `sudo systemctl restart systemd-timesyncd`, needs password).
- 46:35 DNS / Wi-Fi share / speed → `manual/35`; the DNS half is `bin/omarchy-dns` (`[Cloudflare|Google|DHCP|Custom]`, no arg prints current provider; `etc/sudoers.d/omarchy-dns` grants NOPASSWD for Cloudflare/Google/DHCP only; Custom runs in a terminal and asks for servers, "Error: No DNS servers provided." on empty; `Setup > Network > DNS > …` entries `omarchy-menu.jsonc:130-134` with `checked` state).
- 46:39 Disk speed: _Trigger > Speed Test > Disk Speed Test_ (`:101` → shell panel `omarchy.disk-speedtest`) or `omarchy disk speedtest` (`bin/omarchy-disk-speedtest`: 4 workers × 256 MB NOCOW files, needs ≥2048 MB free, prints `disk <model>`, `read N`, `write N`; `[target-dir]` must exist else usage exit 2; "Direct disk I/O is not available" exit 1).
- 46:43 Chromium Google sign-in: _Install > Service > Chromium Account_ (`:231`, `when` `~/.config/chromium-flags.conf` exists, `disabled` once `oauth2-client-id` present → `bin/omarchy-install-chromium-google-account` appends two `--oauth2-*` flags, prints "Now you can login to your Google Account in Chromium.").
- 46:47-53 Printing: CUPS enabled (`install/config/enable-services.sh` `cups.service`, `avahi-daemon.service`); _Print Settings_ from launcher (`Super + Space`); Add → USB/network discovery; IPP manual entry; IPP Everywhere driver; right-click Set as Default / Properties; auto-discovery temporarily off; print-to-PDF works with no printer.
- 46:57-65 Screenshot/recording dir: `~/.config/uwsm/env.d/<file>` with `export OMARCHY_SCREENSHOT_DIR=…` / `OMARCHY_SCREENRECORD_DIR`; directory must exist; restart Omarchy (re-login).
- 46:69-71 Apple Studio Display speakers/webcam need a specific cable; brightness keys work for Apple displays. Hardware-only.
- 46:75-81 Remove software: _Remove > Package_ (`:287` → `omarchy-pkg-remove`: `yay -Qqe | fzf --multi`, Tab selects, Enter → `sudo pacman -Rns --noconfirm`, `omarchy-show-done`); _Remove > Web App_ (`:294`, `when` any webapp .desktop exists → `omarchy-webapp-remove`); _Remove > Preinstalls_ (`:297`, hidden once `~/.local/state/omarchy/preinstalls-removed` exists → `omarchy-remove-preinstalls`: confirm, `omarchy-webapp-remove-all`, `omarchy-tui-remove-all`, marker, `hyprctl reload`, drop mise stubs, `omarchy-pkg-drop aether cliamp libreoffice-fresh xournalpp pinta obsidian obs-studio kdenlive moonlight-qt lazydocker omacut omacalc omawrite`); _Install > Preinstalls_ (`:216`) becomes enabled after that; bindings for removed apps go away.

**manual/47 — System snapshots**
- 47:3 Snapshot on every update: `bin/omarchy-update:37` `omarchy-snapshot create || (($? == 127)) || echo "Continuing the update without a snapshot."` (127 = snapper absent; unconfigured snapper → loud failure, update continues). Manual create: `omarchy-snapshot create` (`bin/omarchy-snapshot`: needs `snapper`; lists configs via `snapper --csvout list-configs`; no configs → yellow "No Snapper configs found, so no snapshot was created." exit 1 with hint to run `install/config/snapper.sh`; else "Create system snapshot", `snapper -c root create -c number -d "$(omarchy-version)"`, `snapper -c root cleanup number`, "Snapshots can be selected during boot."). No argument → "Usage: omarchy-snapshot <create|restore>" exit 1. **Unknown argument (e.g. `omarchy-snapshot foo`) matches no `case` branch and exits 0 silently** — no usage, no error.
- 47:5 Boot a snapshot from the Limine menu; with Direct Boot on, pick Limine from the firmware boot menu first. Limine config: `default/limine/limine.conf` (`#timeout: 3` commented → Limine default 5 s, `default_entry: 2`, branding "Omarchy Bootloader", Tokyo Night palette, `hash_mismatch_panic: no`); `etc/limine-entry-tool.d/omarchy-defaults.conf` (`BOOT_ORDER="linux-t2, linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`, `MAX_SNAPSHOT_ENTRIES=6`, `SNAPSHOT_FORMAT_CHOICE=5`, `ENABLE_LIMINE_FALLBACK=yes`, `FIND_BOOTLOADERS=yes`, `CUSTOM_UKI_NAME="omarchy"`, cmdline `quiet splash … initramfs_async=0`).
- 47:7 Snapshot entries show date + version (description = `omarchy-version` output, e.g. `4.0.2`); "version at bottom left" is the entry description rendered by Limine.
- 47:11 On arriving inside a snapshot a notification offers restoration; click → restore. Implemented by upstream `limine-snapper-sync`: XDG autostart `limine-restore-notify.desktop` → `limine-snapper-restore --notify` → `notify-send` "Restore this snapshot now!" / "You are currently using this snapshot. Please restore it before rebooting to the normal system." with actions `default` + `openRestore=Restore now`; the Omarchy shell invokes the `default` action on click (`shell/plugins/notifications/Service.qml:360-397`) → opens a terminal (foot/kitty/alacritty/ghostty…) running `pkexec limine-snapper-sync --restore --no-mutex`. Omarchy hides only the *warning* notifier `limine-snapper-notify.desktop` (`config/autostart/limine-snapper-notify.desktop` `Hidden=true`, `migrations/1782049344.sh`), not the restore one. Alternative: `omarchy-snapshot restore` → `sudo limine-snapper-restore` → as root runs `limine-snapper-sync --restore --no-mutex` directly (interactive snapshot picker; outside a snapshot it still offers the list).
- 47:15 Restores root only, not `/home`; 47:17 `~/.config` kept as-is (btrfs layout `@`, `@home`, `@log`, `.snapshots` — `omarchy-system-factory-reset-finish` recreates `@home`/`@log`; snapshots boot read-only with `btrfs-overlayfs` writable layer: `etc/mkinitcpio.conf.d/omarchy_hooks.conf:1`).
- 47:19 Limine-only feature (not GRUB/systemd-boot). Snapper retention: `default/snapper/root` `NUMBER_LIMIT=5`, `NUMBER_MIN_AGE=0`, `TIMELINE_CREATE=no`; `install/config/snapper.sh` enables `snapper-cleanup.timer` + `limine-snapper-sync.service`, disables `snapper-timeline.timer`. `/.snapshots` pruned from plocate (`install/post-install/localdb.sh`).
- 47:23-25 Direct Boot: _Setup > Direct Boot_ (`omarchy-menu.jsonc:190` → `omarchy-setup-direct-boot`): requires UEFI (`/sys/firmware/efi`) and working `efibootmgr`; refuses on "American Megatrends" and "Apple" `bios_vendor`; if an EFI entry labelled `Omarchy` exists → `gum confirm "Disable direct boot (remove Omarchy EFI entry)?"` → `efibootmgr --delete-bootnum`; else finds `/boot/EFI/Linux/omarchy*.efi`, `gum confirm "Setup direct boot (so snapshot booting must be done via bios)?"` → `efibootmgr --create --label Omarchy --loader \EFI\Linux\<uki>`. Errors: "System is not booted in UEFI mode", "efibootmgr is not available", "No Omarchy UKI found in /boot/EFI/Linux/". Toggle semantics (run again to remove) match the manual.

**manual/48 — Security**
- 48:5 (1) FDE mandatory (LUKS); ISO default encrypted, Ctrl+C on disk confirmation for unencrypted (`manual/02:35`; iso `configurator:614-617`).
- 48:6 (2) Firewall default deny incoming / allow outgoing; 53317 udp+tcp open for LocalSend; docker DNS allow rules; ufw-docker after.rules; `ENABLED=yes`, `ufw.service` enabled (`install/config/firewall.sh`). SSH off until _Setup > Security > SSHD_ (`omarchy-menu.jsonc:184` → `omarchy-setup-security-sshd`: `omarchy-pkg-add openssh`, `systemctl enable --now sshd`, `ufw limit 22/tcp comment omarchy-sshd`, key from GitHub (`gum input` username → `https://github.com/<u>.keys`) or pasted (`gum input`), or flags `--key=<pub>` / `--gh-keys <user>` (non-interactive; `--gh-keys` with empty/option-shaped user → exit 2 before anything changes; both flags → exit 2; unknown option → exit 2; `-h`), validates with `ssh-keygen -lf`, appends to `~/.ssh/authorized_keys` (dedup "Key already authorized"), then writes `/etc/ssh/sshd_config.d/10-omarchy-hardening.conf` (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`) only after a key is authorized, validates with `sshd -t`/`sshd -T`, `systemctl reload sshd`, prints "Password logins are off; this machine now accepts authorized keys only." and `ssh <user>@<host>`). Remove: _Remove > Security > SSHD_ (`:301`, `when systemctl is-enabled sshd` → `omarchy-remove-security-sshd`: disable sshd, `ufw --force delete limit 22/tcp`, optional `gum confirm` to delete `authorized_keys`; openssh package stays). Docker: user not in `docker` group by default (`install/config/docker.sh`), opt-in `omarchy-setup-security-sudoless-docker` (_Setup > Security > Sudoless Docker_, `:186`).
- 48:7 (3) Rolling Arch; `omarchy-update` (alias `omarchy up`, `bin/omarchy-update:4`).
- 48:8 (4) Repos: only core/extra/multilib + `[omarchy]` (`default/pacman/pacman-*.conf`, mirrors `mirror.omarchy.org` / `rc-mirror` / `stable-mirror`, `SigLevel = Required DatabaseOptional`); AUR only for optional installs.
- 48:9 (5) Cloudflare-fronted infra. Not testable beyond reachability.
- 48:13 Two passwords: drive (LUKS) and user/sudo. _Update > Password > Drive Encryption_ (`:378` → `omarchy-drive-password`: `blkid -t TYPE=crypto_LUKS`; one drive → direct, several → `omarchy-drive-select` (`gum choose` of `omarchy-drive-info` lines); `gum input --password` "New encryption password" (empty → "Password cannot be empty." exit 1), "Confirm new encryption password" (mismatch → "Passwords do not match." exit 1); `cryptsetup luksChangeKey --pbkdf argon2id --iter-time 2000` prompting for the *current* passphrase on the tty; no LUKS → "No encrypted drives available." exit 1). _Update > Password > User_ (`:379` → `passwd` in floating terminal).
- 48:17-19 Passing on a machine: _Setup > Reset Computer_ (`:191`, `when` root is btrfs → `omarchy-system-factory-reset`, self-elevates via sudo): requires `btrfs`, `subvol=/@` layout, `@factory` snapshot (else "This machine has no factory snapshot to reset to." exit 1); confirmation screen lists what is erased; `gum input` "Type 'reset' to continue" (anything else → "Error: Reset not confirmed."); masks `limine-snapper-sync` for the session; clones `@factory` → `@omarchy-reset-next`, new machine-id, scrubs ssh host keys / NM connections / tailscale / iwd / sddm state / autologin, deletes uid≥1000 users from the clone **and from `@factory` itself (idempotent, baseline sanitised in place even if you cancel later)**, stages `pending` + `wipe-pending`, installs `omarchy-provision-owner.service` + `omarchy-system-factory-reset-finish.service`; on LUKS asks "Confirm your disk encryption passphrase to authorize the re-key." (wrong → "That passphrase does not unlock <dev>. Try again."; Esc → exit 1, clone deleted by trap), adds a random 48-char throwaway key + `cryptkey=rootfs:/etc/omarchy/provisioning.key` auto-unlock for the provisioning window; recreates hibernation swapfile if configured; resets `/boot/limine.conf` from template, `limine-update` in chroot ("Rebuilding boot files … this can take a minute"), verifies blake2b hashes; swaps `@` ↔ clone; "Reset staged. The wipe finishes on the next boot." → `gum confirm` "Reboot now"/"Reboot later" ("Do not keep using this machine"). Log `/var/log/omarchy-system-factory-reset.log`. Next boot: `-finish` deletes `@omarchy-old-*`, recreates `@home`/`@log`, repairs `/.snapshots`, `fstrim -a`, removes markers; then `omarchy-provision-owner` on tty1 (Conflicts getty@tty1, Before display-manager): greeter (logo ColorShift, "Beautiful, Fun & Agentic Linux by DHH", "Press Return to Start Setup"), keyboard picker (`gum choose --height 10`, English (US) first), username (`^[a-z_][a-z0-9_-]*[$]?$`, reserved list → "Username is reserved for system", taken → "That username already exists on this machine", else "Username must be alphanumeric with no spaces"), password + confirm ("Your password can't be blank!", "Passwords didn't match!"), full name / email (Return skips), hostname (default `omarchy`; pattern → "Hostname must be 1-63 letters, digits, or dashes…"), timezone (`tzupdate -p` guess → `gum choose`, else `gum filter`), confirmation table "Does this look right?" (No → redo), Esc = back to keyboard step, Ctrl+C → "Reboot this machine?"; progress screen "Setting up your machine" with 34-cell bar and rotating tips; creates user (wheel + recorded groups, never docker), `chpasswd` user **and root**, `/etc/sudoers.d/00-omarchy-wheel`, installs staged `authorized_keys`, SDDM autologin (permanent on encrypted, one-boot on unencrypted), hostname, timezone, `omarchy-provision-user --force --first-install`, LUKS re-key to the new password (adds slot, rebuilds UKI without keyfile, kills every other slot, shreds key; failures keep auto-unlock and offer retry), refresh limine entries, cleanup; failure → "Setup hit an error" → "Try again"/"Drop to console" (root shell on tty1). Unencrypted reset = deletion not erasure (48:19, script header).
- 48:23-25 Passwordless sudo: _Setup > Security > Passwordless Sudo_ (`:185` → `omarchy-sudo-passwordless [MINUTES]`, default 15): non-numeric → "Usage: omarchy-sudo-passwordless [MINUTES]" exit 1; stale file without timer (after reboot) is removed; if rule active and a number given → re-arm timer ("Passwordless sudo timer updated…"); if active and no arg → remove rule, stop timer ("Passwordless sudo has been DISABLED…"); else prints WARNING block, `gum confirm "Enable passwordless sudo for N minutes? This is a significant security risk!"` → writes `/etc/sudoers.d/99-omarchy-nopasswd-<user>` (`<user> ALL=(ALL) NOPASSWD: ALL`, 0440), `systemd-run --on-active=Nm --unit omarchy-nopasswd-expire-<user> rm -f <file>` ("Passwordless sudo has been ENABLED…", "A restart removes the passwordless sudo rule as well."); decline → "Aborted. No changes made."; timer failure → revoke immediately. Manual text matches.
- 48:29-31 Signing key `40DFB630FF42BCFFB047046CF0134EE680CAC571` in `omarchy-keyring`; ISO signature at `<iso-url>.sig`.
- Related sudo defaults: `etc/sudoers.d/omarchy-passwd-tries` `Defaults passwd_tries=10`; narrow NOPASSWD grants for `omarchy-dns {Cloudflare,Google,DHCP}`, `omarchy-theme-set-browser-policy <hex>`, `timedatectl set-timezone <zone>`.

**manual/49 — Omarchy on…**
- 49:3 Apple M1/M2 via Asahi Alarm + community guide; 49:7 Parallels VM guide; 49:11 VirtualBox ("performance probably won't be great"); 49:15 VMware Workstation on Windows 11; 49:19 Steam Deck script; 49:23 NixOS port; 49:27 Discord `#omarchy-on-other`. **No QEMU/KVM, virtio, resolution, clipboard or "what works in a VM" statements anywhere in the manual.** Code that is VM-aware: `omarchy-provision-owner:211-244,434-568` (waits for virtio-gpu KMS resize of the VT before drawing the first-boot form; comments mention virgl and the SDL window), `omarchy-hw-laptop` (lid/DMI chassis → false in QEMU, hides laptop-only menu entries), `omarchy-debug:69` (`ping 8.8.8.8` gate → Upload option hidden where ICMP is blocked, as in QEMU user-mode NAT), `omarchy-disk-speedtest` (falls back to the kernel device name when the virtio disk reports no model).

**manual/50 — Dual boot install**
- 50:3-5 Free-space install alongside Windows, LUKS still on by default (iso `configurator:518-617`: "Free space install", own ESP created in free space, ≥32 GB required, BitLocker check "Suspending BitLocker is not enough").
- 50:9-23 Windows Disk Management shrink instructions (Windows-side).
- 50:27-31 Installer offers **Free space install** after picking the disk; Ctrl+C on the disk confirmation for unencrypted.
- 50:35-37 `limine-scan` adds other OS entries (upstream limine-entry-tool; `FIND_BOOTLOADERS=yes` already in `omarchy-defaults.conf`).
- 50:41-43 BitLocker incompatible; turn off in Windows Settings.

**manual/51 — Unattended installs**
- 51:3 Drive labelled `cidata` (or `CIDATA`) → installer copies files to `/root`, skips wizard, reboots (iso `omarchy-cidata-load`: waits `udevadm settle`, requires `user_configuration.json` + (`user_credentials.json` or `defer-provisioning`), copies optional `user_full_name.txt`, `user_email_address.txt`, `user_encrypt_installation.txt`, `authorized_keys`, `tailscale_authkey`; exit 1 → wizard).
- 51:11-19 File table (matches the loader's list exactly). 51:21 `openssl passwd -6`. 51:23 `defer-provisioning` marker = prepare-for-another-owner install (`omarchy-apply-system --defer-provisioning --first-install`, `docs/file-layout.md:50`; leaves `/var/lib/omarchy/provisioning/pending`, first boot runs `omarchy-provision-owner`).
- 51:27 `authorized_keys` → user's `~/.ssh/authorized_keys`, `sshd` enabled, firewall opened (iso `configure_ssh_access`: `ufw allow ssh` — **plain allow, not the rate-limited `ufw limit` the interactive setup uses**; keys staged in `/var/lib/omarchy/provisioning/authorized_keys` for deferred installs, consumed by `omarchy-provision-owner:757-766`); "doesn't loosen other sshd settings" (and does not disable password auth either).
- 51:29 `tailscale_authkey` → tailscale from bundled packages, `ufw allow in on tailscale0`, `omarchy-tailscale-join.service` retries `tailscale up --auth-key file:/etc/tailscale/authkey` every 15 s then deletes the key (iso `phases_impl.py:1546-1617`).
- 51:33-56 `genisoimage -volid cidata -joliet -rock`; Proxmox `qm create` example (q35, OVMF, virtio-scsi, `--vga virtio`, `--serial0 socket`, boot order disk first so the empty disk falls through to the ISO).
- 51:59-61 Caveats: encrypted unattended installs still need the passphrase typed at first boot; `disk_encryption` block carries the passphrase in plaintext.

**manual/02 — Getting started (install / first boot)**
- 02:3 Full-disk vs free-space install; encryption default; full-disk wipes the drive. 02:5 ISO to USB (balenaEtcher / caligula). 02:7 Secure Boot and/or TPM must be off. 02:9-13 wizard questions, confirm screen, pick drive, "under 5 minutes". 
- 02:21 Bluetooth keyboards cannot type the LUKS passphrase; use wired/2.4 GHz.
- 02:25 Installing for another owner: `Ctrl + C` on the first (keyboard) screen → "Prepare this machine for another owner?" confirm (iso `configurator:207-252`); personal setup deferred to first boot; the password picked then becomes the encryption password too (`omarchy-provision-owner:rekey_luks`).
- 02:29 Unattended installs pointer. 02:35 `Ctrl + C` on the disk-formatting confirmation → unencrypted install. 02:39 Discord help.
- Login model after install (iso `configure_login`): encrypted installs autologin (LUKS prompt is the auth boundary); unencrypted installs show the SDDM password greeter. Consequence for the driver: _Logout_ lands on SDDM and needs `prime`; a reboot only needs the LUKS passphrase.

**README.md**
- Manual index only; license MIT. No behaviour.

**Menu/CLI plumbing touched by these chapters**
- `omarchy-launch-floating-terminal-with-presentation <cmd>`: logo, command, then `omarchy-show-done` → "● Done! Press any key to close..." or "● Failed (exit code N)! Press any key to close..." (Ctrl+C exit 130 closes silently).
- CLI router `omarchy <group> <cmd>`: `omarchy snapshot create`, `omarchy debug --print --no-sudo`, `omarchy dns Cloudflare`, `omarchy audio tuning status`, `omarchy disk speedtest`, `omarchy crash mute …`, `omarchy up`; unknown → "Unknown Omarchy command: omarchy …" (+ "Did you mean").
- `omarchy-debug [--no-sudo] [--print]`: writes `/tmp/omarchy-debug.log` (date, hostname, package, `inxi -Farz`, dmesg (or "(skipped - --no-sudo flag used)"), journal warnings, packages); `gum choose` "Upload log" (only if `ping -c 1 8.8.8.8` works) / "View log" (`less`) / "Save in current directory" (`./omarchy-debug.log`); unknown option → "Unknown option: …" + usage exit 1.
- `omarchy-drive-info <drive>` → `/dev/vda (40G) - <model> [vfat(/boot), crypto_LUKS]`; no arg → usage exit 1. `omarchy-drive-select [drives…]` → `gum choose --header "Select drive"`, Esc → exit 1.
- Crash capture (troubleshooting-adjacent): `omarchy-crash-watch.service` (user) follows coredump journal entries, announces "Process crashed: <name>" / "Click to diagnose with AI" **only when `omarchy-default-agent` prints something** and the crash is the user's own; dedupe 60 s; per-program mute flags `~/.local/state/omarchy/toggles/crash-ignore/<name>`; `omarchy crash mute [--] [<program>] [on|off|toggle]` (no args lists → "No programs muted. Crashes all notify."; bad action → "Not an action: …" + usage exit 1); _Trigger > Toggle > Crash Capture_ (`:92` → `omarchy-toggle-crash-capture`: flag `crash-capture-off`, notification "Crash capture disabled/enabled"). Click → `omarchy-agent-crash <pid> …` → `omarchy-agent --prompt`.
- Hibernation: _System > Hibernate_ shown only when `omarchy-hibernation-available` (swap > `/sys/power/image_size` and `/etc/mkinitcpio.conf.d/omarchy_resume.conf`). `omarchy-hibernation-setup [--force] [--no-rebuild]`: "Hibernation is not supported on your system" if no `/sys/power/image_size`; "Skipping hibernation setup (requires Limine bootloader)" without `limine-mkinitcpio`; "Hibernation is already set up"; `gum confirm "Use <RAM> on boot drive to make hibernation available?"`; creates `/swap` subvolume (NOCOW), swapfile = RAM size, fstab entry, `swapon`, keyboard-backlight sleep hook, `HOOKS+=(resume)`, `resume=`/`resume_offset=` cmdline drop-in, `limine-mkinitcpio`, `gum confirm "Reboot to enable hibernation?"`. `omarchy-hibernation-remove`: "Hibernation is not set up" if absent; `gum confirm "Remove hibernation setup?"`; swapoff, rm swapfile/subvolume/fstab entry/hook, `limine-mkinitcpio`, "Hibernation removed".
- Tailscale: _Install > Service > Tailscale_ (`:227` → `omarchy-install-service-tailscale`: pkg, `tailscaled`, `sudo tailscale up --accept-routes` (needs browser auth), operator, Taildrop receive unit, bar plugin, web app). _Remove > Service > Tailscale_ (`:311`).
- Power: `omarchy-system-reboot/-shutdown` (systemd-run timer 2 s, OSD "Rebooting"/"Shutting down", close all windows), `omarchy-system-logout` (`uwsm stop`), `omarchy-system-lock` (`omarchy-shell lock lock`, resets layout, locks 1Password, kills screensaver). System submenu `Super+Escape`.

## Observations

1. **Menu navigation.** `Super+Space` opens the root Omarchy Menu; `Super+Escape` opens the System submenu directly. Typing filters (labels, last id segment, descriptions are searchable — `docs/menu.md`). Paths in this file are written `Omarchy Menu → Setup → Security → SSHD`. Entries guarded by `when` are simply absent (not greyed); `disabled` entries render with a ✓ and do nothing.
2. **Presentation terminal.** Every menu action that runs a script opens a floating terminal titled "Omarchy" showing the logo, then the output, then "● Done! Press any key to close..." (green) or "● Failed (exit code N)! Press any key to close..." (red). The driver must press a key to close it. `sudo` prompts appear inside this terminal as `[sudo] password for prime:`.
3. **The VM is an encrypted install → SDDM autologin.** A reboot needs only the LUKS passphrase `prime` at the Plymouth prompt; the desktop appears without a login. `System → Logout` returns to the SDDM greeter, which needs `prime`. The lock screen (`Super+Ctrl+L` or `Super+Escape → Lock`) uses PAM service `omarchy-lock-password` with faillock deny=10 / unlock_time=120 s.
4. **Limine menu timing.** `default/limine/limine.conf` has `timeout` commented out, so Limine uses its default (5 s) before booting `default_entry: 2`. The driver must press a key (any arrow) inside that window to stop the countdown. `Snapshots` is the last top-level entry (`BOOT_ORDER … Snapshots`); Limine navigation: arrows, Enter to open/boot, Esc to go up. Screenshots of the boot menu come from `get-image` like any other frame.
5. **Snapshot entry sync is asynchronous.** `limine-snapper-sync.service` watches `/.snapshots` and rewrites `/boot/limine.conf` a few seconds after `snapper create`. Check `sudo grep -c '/.snapshots/' /boot/limine.conf` before rebooting. A pristine minted disk most likely has **zero** snapper snapshots (they are created by `omarchy-update`, not by the ISO); `@factory` is a plain btrfs snapshot, not a snapper one, and never appears in the Limine menu.
6. **Booting a snapshot** gives a read-only root with an overlayfs writable layer (`btrfs-overlayfs` hook), `/proc/cmdline` contains `subvol=/@/.snapshots/<N>/snapshot` (or `.snapshots/<N>/snapshot`), and any file created there evaporates on reboot. The LUKS prompt still appears. The restore notification comes from `limine-snapper-restore --notify` (XDG autostart `limine-restore-notify.desktop`, run by uwsm's xdg-autostart target); clicking uses the `default` libnotify action → a terminal opens running `pkexec limine-snapper-sync --restore --no-mutex` → polkit password dialog for `prime`.
7. **`omarchy-snapshot` accepts anything.** `omarchy-snapshot bogus` prints nothing and exits 0. Worth a dedicated negative test; manual and `--help` both imply `<create|restore>` only.
8. **Factory reset side effects even when cancelled.** `stage_full_reset` sanitises `@factory` (removes uid≥1000 accounts from the baseline) *before* asking for the LUKS passphrase. Cancelling at the passphrase prompt deletes the staged clone but leaves the baseline scrubbed and `limine-snapper-sync` runtime-masked until reboot. Harmless for a disposable VM disk; note it in proofs.
9. **Factory reset in the VM.** OVMF reports `bios_vendor` "EDK II", root is btrfs `@`, `@factory` is taken by the 4.0.x ISO at end of install (iso `create_factory_snapshot`), so the whole cycle is runnable. Budget: staging ≈ 1–2 min (chroot `limine-update`), reboot + wipe ≈ 1 min, first-boot form ≈ 1 min of typing, finalize + LUKS re-key + UKI rebuild ≈ 2–4 min. Expect 6–9 min total: tag SLOW. The first-boot form renders on tty1 with the Tokyo Night palette and an animated logo; the code explicitly waits for the virtio-gpu VT resize before drawing.
10. **Direct Boot in the VM.** `efibootmgr` works with OVMF; the entry only survives a reboot if the harness gives the guest a writable `OVMF_VARS` copy. If the entry vanishes after reboot that is a harness caveat, not an Omarchy failure — the proof asks for `efibootmgr` output before and after the reboot to tell them apart. `efibootmgr --create` puts the new entry first in `BootOrder`, so the next boot skips Limine and goes straight to the LUKS prompt.
11. **Passwordless grants the driver will notice.** `Setup → Network → DNS → Cloudflare/Google/DHCP`, `Update → Timezone`, and theme browser-policy writes run with no password prompt (`etc/sudoers.d/*`). `Update → Time`, `Setup → Network → DNS → Custom`, snapshots, direct boot, hibernation, reset, sshd, passwordless-sudo all prompt for `prime` in the terminal (unless passwordless sudo is on).
12. **Sudo without a terminal.** `sudo` reads the password from `/dev/tty`; a `omarchy-*` command that `requires-sudo` launched without a controlling terminal fails with `sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper`. `omarchy-dns` is the one script that anticipates this (`require_root`: tty → sudo, grant → sudo -n, else `pkexec`).
13. **Networking in QEMU user-mode NAT.** ICMP fails → `omarchy-debug` hides "Upload log". DNS changes to 1.1.1.1/8.8.8.8 work (UDP 53 is forwarded). `ssh prime@localhost` works for the SSHD test. GitHub key fetch works (HTTPS).
14. **Hardware restarts are no-ops here** (no Wi-Fi/BT/trackpad/audio device) but every one of them must still finish with "Done!"; `omarchy-restart-audio` prints `wpctl status` with empty Audio sections and exits 0 as long as `wpctl` answers.
15. **Hibernation setup is feasible but the actual hibernate/resume is not** (powering off the guest ends the session). `/sys/power/image_size` exists on the stock kernel; setup writes a 4 GB swapfile and rebuilds the UKI (~1–2 min).
16. **faillock and root.** Root password equals the user password (`prime`) on ISO installs, so the manual's `Ctrl+Alt+F2 → root → faillock --reset` recovery is runnable. `even_deny_root` is not set, so root itself never locks. After a factory reset root's hash is `!` (locked) until first-boot setup re-sets it to the new owner's password.
17. **`omarchy-setup-security-sshd --key=<bad>`** enables `sshd` and opens port 22 *before* validating the key, then exits 1 with password auth still enabled. The manual says "Even ssh is off until you turn it on"; a failed run leaves it on. Documented as a negative test with the expected (current) behaviour so a change is visible.
18. **Unattended installs and dual boot need the ISO** and a second drive/ISO image — nothing on a resumed minted disk can exercise them. They are listed below as `VM-NO` for the record, with the exact files and prompts from the ISO repo so a future ISO-based runner can pick them up.
19. **Manual/code disagreements found**: (a) lockout threshold and 2-minute auto-unlock unstated in 45:39; (b) unattended `authorized_keys` opens 22 with `ufw allow`, not the rate-limited `limit` the security chapter describes for SSHD; (c) `omarchy-snapshot <unknown>` silently succeeds; (d) `manual/49` contains no VM guidance at all although the ISO's own recommended VM example (`manual/51`) is q35/OVMF/virtio — exactly our harness; (e) 45:9 says GDK_SCALE is set "in `~/.config/hypr/monitors.lua`" and to "restart any app" — `hl.env` is applied at Hyprland config load, so a bare app restart may not pick up the new value without a config reload/re-login (test captures which).

## Proposed tests

### snapshot-create-cli   [VM-OK]
description: A user takes a manual system snapshot from a terminal and sees it labelled with the Omarchy version — the rollback point the manual tells them to make before risky changes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo snapper list`, password `prime`. Note the numbered rows (a fresh disk usually has only the `0 | single | current` row).
  * Type `omarchy-snapshot` with no argument. The terminal must show `Usage: omarchy-snapshot <create|restore>` and nothing else.
  * Type `omarchy-snapshot create`. The terminal must show `Create system snapshot`, a snapper line with the new snapshot number, and `Snapshots can be selected during boot.`
  ** A yellow "No Snapper configs found, so no snapshot was created." means the disk is misconfigured — report it.
  * Type `omarchy-version`, then `sudo snapper list` again: a new numbered row of type `single`, cleanup `number`, whose description equals the version just printed.
  * Wait a few seconds (screenshot, do not sleep long) and type `sudo grep -c snapshot /boot/limine.conf`: a number greater than 0 shows the boot menu picked it up.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo snapper list` is wide; maximise the terminal or append `| sudo tee /dev/ttyS0` and read it with `./client get-serial`.
  * The description is a version like `4.0.2`, or `dev (<hash>)` on a dev checkout.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bare `omarchy-snapshot` usage line
  ** Screenshot of "Create system snapshot" … "Snapshots can be selected during boot."
  ** Screenshot of `snapper list` with the new row whose description matches `omarchy-version`, and the non-zero grep count
  * If unsuccessful
  ** The failing command's output (yellow "No Snapper configs found" or a snapper error) and a screenshot of `systemctl status limine-snapper-sync.service`
covers: manual/47:3; bin/omarchy-snapshot; default/snapper/root; install/config/snapper.sh

### snapshot-unknown-action-silent-exit   [VM-OK]
description: `omarchy-snapshot` documents only `create` and `restore`; a typo must be rejected loudly, yet today an unknown action prints nothing and exits 0 — this test records that behaviour so a fix or regression shows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo snapper list`, password `prime`. Note the row count.
  * Type `omarchy-snapshot bogus; echo "exit=$?"`.
  ** The manual and the usage text imply an error and a non-zero exit. Current behaviour: no output and `exit=0`. Capture exactly what appears.
  * Type `omarchy snapshot bogus; echo "exit=$?"` (through the router) and capture that too.
  * Type `sudo snapper list` again: the row count must be unchanged — nothing was created or deleted.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This is a negative-path test; the artefact is whether any error text is printed at all.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the exact output (or blank line) and `exit=` value for both invocations
  ** Screenshot of identical `snapper list` row counts before and after
  * If unsuccessful
  ** A snapshot created or deleted by the bogus call, or a crash from the router
covers: bin/omarchy-snapshot (case with no default); bin/omarchy router; manual/47:3

### snapshot-retention-keeps-five   [VM-OK]
description: Snapshots are capped at five so pre-update rollback points cannot fill the disk; creating a sixth must prune the oldest immediately.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo grep -E 'NUMBER_LIMIT|TIMELINE_CREATE' /etc/snapper/configs/root`, password `prime`. Expect `NUMBER_LIMIT="5"`, `NUMBER_LIMIT_IMPORTANT="5"`, `TIMELINE_CREATE="no"`.
  * Type `for i in 1 2 3 4 5 6; do omarchy-snapshot create; done` and wait until six "Create system snapshot" blocks have printed.
  ** Each create takes a few seconds; screenshot while it runs, do not interrupt.
  * Type `sudo snapper list | sudo tee /dev/ttyS0` and read it with `./client get-serial`: at most 5 numbered rows besides `0 | current`, and the lowest number created in this run is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The loop is one line; type it exactly, including the semicolons.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the snapper config lines
  ** Screenshot of six "Create system snapshot" outputs
  ** Serial capture of `snapper list` with ≤5 numbered rows and a gap where the oldest was pruned
  * If unsuccessful
  ** `snapper list` with 6+ rows or a cleanup error; screenshot of `systemctl status snapper-cleanup.timer`
covers: default/snapper/root; bin/omarchy-snapshot (cleanup number); etc/limine-entry-tool.d/omarchy-defaults.conf (MAX_SNAPSHOT_ENTRIES=6); manual/47

### snapshot-boot-into-snapshot-shows-restore-notification   [VM-OK] [SLOW]
description: A user reboots, picks a snapshot from the Limine "Snapshots" menu, and lands on a read-only snapshot desktop that offers to restore itself — the recovery entry point for a broken update.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Type `sudo touch /etc/before-snapshot` (password `prime`), then `omarchy-snapshot create`, then `sudo rm /etc/before-snapshot`, then `omarchy-version` (note the version).
  * Reboot: press Super+Escape and click Reboot with the mouse. Screenshot every 2–3 seconds.
  * When the "Omarchy Bootloader" menu appears, press Down within 5 seconds to stop the countdown. Move to the last entry `Snapshots`, press Enter, and screenshot the list: the new entry must show a date and the version you noted.
  ** If the countdown expired and the passphrase prompt shows, type `prime`, reach the desktop, and reboot again.
  * Highlight that snapshot, press Enter, and type `prime` at the passphrase prompt.
  * On the desktop, within ~30 seconds, a critical notification `Restore this snapshot now!` (app "Snapshot detected!") must appear. Do not click it.
  ** If it does not appear, open a terminal and type `limine-snapper-restore --notify`; note whether it prints "You are not in a snapshot." and report.
  * Open a terminal and type `ls /etc/before-snapshot; sudo btrfs property get / ro; grep -o 'snapshots/[0-9]*/snapshot' /proc/cmdline`: the file exists, `ro=true`, and the cmdline names the snapshot.
  * Reboot again (Super+Escape → Reboot), let Limine auto-boot without touching keys, type `prime`. On the desktop type `ls /etc/before-snapshot`: it must be missing — the normal root is back, exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Limine keys: Up/Down move, Enter opens `Snapshots` or boots, Esc goes back. The menu is visible only ~5 s unless a key is pressed.
  * `./client-with-image` helps catch the notification early; critical toasts persist until dismissed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the expanded Snapshots list with date and version
  ** Screenshot of the "Restore this snapshot now!" notification on the desktop
  ** Screenshot of `ls` showing the file, `ro=true`, and the `.snapshots/N/snapshot` cmdline; then the file missing after the normal boot
  * If unsuccessful
  ** No `Snapshots` entry or no notification (plus the by-hand `--notify` output), a boot failure screen, or the file present after the normal boot
covers: manual/47:5-17; default/limine/limine.conf; etc/limine-entry-tool.d/omarchy-defaults.conf; etc/mkinitcpio.conf.d/omarchy_hooks.conf (btrfs-overlayfs); limine-snapper-restore --notify

### snapshot-restore-from-booted-snapshot   [VM-OK] [SLOW]
description: Clicking the snapshot notification restores the root filesystem and leaves /home alone, so a broken update is rolled back without losing personal files.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Type `omarchy-snapshot create` (password `prime`), then `sudo touch /etc/broken-after-snapshot`, then `touch ~/keep-me`.
  * Reboot (Super+Escape → Reboot), press Down at the Limine menu, open `Snapshots`, boot the snapshot you just made, type `prime`.
  * When `Restore this snapshot now!` appears, click it with the mouse. A terminal must open running the restore; enter `prime` in the polkit password dialog if one appears.
  ** If nothing opens within 10 s, open a terminal, type `omarchy-snapshot restore` (password `prime`) and report that the click path failed.
  * Answer the restore tool's prompts (confirm the currently booted snapshot). Screenshot every prompt. It must end with a success message.
  * Reboot as the tool suggests (or Super+Escape → Reboot), let Limine auto-boot, type `prime`.
  * Open a terminal and type `ls /etc/broken-after-snapshot ~/keep-me; grep -o 'subvol=/@[^ ]*' /proc/cmdline`: the /etc file is MISSING, `~/keep-me` is PRESENT, and the root is `subvol=/@`.
  * Reboot once more, press Down at Limine and screenshot the menu: a backup/previous-state entry added by the restore is expected. Boot normally with `prime`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restore tool is `limine-snapper-sync --restore` (method `replace`); its prompts are plain text — read before answering.
  * Three reboots: keep screenshots flowing, never sleep more than 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the clicked notification, the restore terminal (and polkit dialog), and its finish message
  ** Screenshot after reboot: /etc file gone, home file kept, `subvol=/@`
  ** Screenshot of the Limine menu with the backup entry
  * If unsuccessful
  ** The restore tool's error text (hash mismatch, ESP space, "restore blocked"), a Limine warning screen, or a root still on a `.snapshots` path
covers: manual/47:11-17; bin/omarchy-snapshot restore; limine-snapper-restore; btrfs @home layout

### snapshot-restore-outside-snapshot-lists-or-refuses   [VM-OK]
description: Running `omarchy-snapshot restore` from a normal boot, or naming a snapshot that does not exist, must never rewrite the root: it offers a picker or says there is nothing to restore, and cancelling changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo snapper list` (password `prime`). Note whether any numbered snapshots exist (none on a fresh disk is the "nothing to restore" case).
  * Type `omarchy-snapshot restore`. Screenshot what it prints: either a not-in-a-snapshot / nothing-available message or an interactive picker.
  * If a picker appears, cancel it (Esc or Ctrl+C or its quit option). Do NOT confirm a restore.
  ** If the picker takes a number, also type an invalid one such as `9999` first and capture the message.
  * Type `sudo limine-snapper-sync --restore-kernels 9999; echo "exit=$?"`: an error and a non-zero exit for the nonexistent ID.
  * Type `grep -o 'subvol=/@[^ ]*' /proc/cmdline; hostname`: still `subvol=/@`, the system unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restore tool is upstream `limine-snapper-sync`; wording varies by version — capture it verbatim.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the message or picker from `omarchy-snapshot restore` and of the cancel
  ** Screenshot of the error + non-zero exit for ID 9999 and of `subvol=/@` afterwards
  * If unsuccessful
  ** A restore proceeding without confirmation, a traceback, or a changed root/boot entry
covers: bin/omarchy-snapshot restore; limine-snapper-restore (is_snapshot); manual/47:11

### direct-boot-toggle-skips-limine   [VM-OK] [SLOW]
description: "Setup → Direct Boot" makes the firmware boot Omarchy without stopping at Limine, running it again puts Limine back, and declining the prompt changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `efibootmgr` — no line ending in ` Omarchy` must exist.
  * Open the Omarchy Menu with Super+Space and click Setup → Direct Boot. At `Setup direct boot (so snapshot booting must be done via bios)?` choose **No**. The terminal ends with "Done!" and `efibootmgr` (type it again) is unchanged.
  * Repeat Setup → Direct Boot, choose **Yes**, password `prime`. Expect `Creating EFI boot entry for omarchy_linux.efi` then "Done!". Type `efibootmgr`: a `Boot000X* Omarchy` entry exists and its number is first in `BootOrder`.
  * Reboot (Super+Escape → Reboot) screenshotting every 2–3 s: the "Omarchy Bootloader" menu must NOT appear — the passphrase prompt comes straight after the firmware. Type `prime`.
  ** If Limine does appear, the firmware did not keep the variable (harness NVRAM caveat) — record it and continue.
  * Type `efibootmgr` and note whether the Omarchy entry survived. Open Setup → Direct Boot again: it must ask `Disable direct boot (remove Omarchy EFI entry)?` — choose Yes → `Removing EFI boot entry 000X`, "Done!".
  ** If it offers to set up instead (entry lost), choose No and report the caveat.
  * Type `efibootmgr`: the Omarchy entry is gone. Reboot once more; the Limine menu must show again (press Down to hold it, screenshot), then boot normally and type `prime`. The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right or Tab picks Yes/No, Enter confirms.
  * OVMF reports `EDK II`, so the AMI/Apple refusal does not trigger here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `efibootmgr` before (no Omarchy), after No (unchanged), after Yes (Omarchy first), after disable (gone)
  ** Boot screenshots: no Limine menu after enable; Limine menu back after disable
  * If unsuccessful
  ** Script errors ("not booted in UEFI mode", "efibootmgr is not available", "No Omarchy UKI found"), or the entry surviving/vanishing contrary to the step
covers: manual/47:23-25; bin/omarchy-setup-direct-boot; omarchy-menu.jsonc setup.direct-boot

### firewall-defaults-deny-incoming-localsend-open   [VM-OK]
description: Out of the box the firewall blocks all incoming traffic except LocalSend, SSH is off, and the user is not in the docker group — the stock security posture the manual promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo ufw status verbose | sudo tee /dev/ttyS0`, password `prime`; read it with `./client get-serial`.
  ** Expect `Status: active`, `Default: deny (incoming), allow (outgoing)`, `53317/udp` and `53317/tcp ALLOW IN`, two `allow-docker-dns` rules, and NO `22/tcp` rule.
  * Type `systemctl is-enabled sshd; systemctl is-active sshd`: `disabled` and `inactive`.
  * Type `id`: the groups list must not contain `docker`. Type `docker ps`: a permission-denied error, not a container list.
  * Type `sudo grep -c DOCKER-USER /etc/ufw/after.rules`: a number greater than 0 (ufw-docker installed).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * These facts are not visible in any UI; the terminal is the only surface, so keep it maximised for readable screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial capture of `ufw status verbose` with deny incoming, 53317 rules, docker-dns rules, no 22/tcp
  ** Screenshot of sshd disabled/inactive, `id` without docker, `docker ps` denied, DOCKER-USER count
  * If unsuccessful
  ** `Status: inactive`, a 22/tcp rule on a stock disk, or docker in the user's groups
covers: manual/48:6; install/config/firewall.sh; install/config/docker.sh; install/config/enable-services.sh

### sshd-setup-paste-key-then-remove   [VM-OK]
description: A user turns SSH on from "Setup → Security → SSHD" by pasting a public key, can log in with that key only, and turns it off again from "Remove → Security → SSHD".
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Type `ssh-keygen -t ed25519 -N "" -f ~/.ssh/testkey` (Enter through any prompt), then `wl-copy < ~/.ssh/testkey.pub` to put the public key on the clipboard.
  * Open the Omarchy Menu with Super+Space, click Setup → Security → SSHD. Enter `prime` at the sudo prompt. After `Opening the SSH port in the firewall (rate limited against brute force)...` a chooser `How would you like to add your SSH key?` appears: pick `Paste key manually`.
  * At `Public key>` paste with Ctrl+Shift+V and press Enter. Expect `Authorized key: 256 SHA256:…`, `Disabling SSH password authentication, now that a key is authorized...`, `Perfect! The SSH server is running and your key is authorized.`, `Password logins are off…`, then "Done!". Press a key.
  ** If the paste lands nothing, type `cat ~/.ssh/testkey.pub` in your terminal and copy the text by selecting it and using Super+C, then retry.
  * In your terminal type `ssh -i ~/.ssh/testkey -o StrictHostKeyChecking=no prime@localhost hostname`: the hostname prints with no password prompt.
  * Type `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password -o StrictHostKeyChecking=no prime@localhost true`: `Permission denied (publickey)` with NO password prompt.
  * Open Super+Space → Remove → Security → SSHD (visible only while sshd is enabled). Password `prime`. At `Also remove all authorized SSH keys…?` choose Yes → `Authorized keys removed.`, `The SSH server has been disabled and its firewall port closed.`, "Done!".
  * Type `systemctl is-enabled sshd; sudo ufw status | grep -c 22; ls ~/.ssh/authorized_keys`: `disabled`, `0`, No such file. Open Remove → Security again: SSHD is no longer listed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating "Omarchy" terminal is where the chooser and `Public key>` prompt live; hover it (mouse move) before pasting so keys go there.
  * `./client-with-image` after each Enter speeds up reading the long output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the chooser, the pasted key accepted, and the "Perfect!" / "Password logins are off" lines
  ** Screenshot of key-based ssh printing the hostname and the password-only attempt denied without a prompt
  ** Screenshot of the removal output and the post-removal checks; Remove → Security without SSHD
  * If unsuccessful
  ** "Not a valid SSH public key", "sshd rejected the hardening config", an `ssh` password prompt, or a 22 rule surviving removal
covers: manual/48:6; bin/omarchy-setup-security-sshd; bin/omarchy-remove-security-sshd; omarchy-menu.jsonc setup.security.sshd / remove.security.sshd

### sshd-setup-github-keys   [VM-OK] [NET]
description: The "Grab key from GitHub" path fetches a user's public keys and authorizes them idempotently; an unknown GitHub user is refused. A few KB of download.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Setup → Security → SSHD, password `prime`. At the chooser pick `Grab key from GitHub`. At `GitHub username>` type `this-user-does-not-exist-omarchy-9f3k` and Enter: expect the red `Could not fetch any SSH keys for GitHub user '…'.` and "Failed (exit code 1)!". Press a key.
  * Repeat Setup → Security → SSHD → `Grab key from GitHub`, type `dhh`, Enter: `Fetching keys from https://github.com/dhh.keys...`, one or more `Authorized key: …` lines, the password-auth disable step and `Perfect!`. Press a key.
  * Open a terminal with Super+Enter and type `wc -l ~/.ssh/authorized_keys`: a count ≥ 1.
  * Type `omarchy-setup-security-sshd --gh-keys dhh` (password `prime`): every key now prints `Key already authorized: …` and `wc -l ~/.ssh/authorized_keys` is unchanged.
  * Clean up: type `omarchy-remove-security-sshd`, password `prime`, answer Yes to removing keys. `systemctl is-enabled sshd` → `disabled`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the fetch hangs more than 30 s the guest network is down — report that rather than the test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the unknown-user refusal with Failed (exit code 1)
  ** Screenshot of the fetch and Authorized key lines; the rerun showing "Key already authorized" with the same line count
  ** Screenshot of sshd disabled after cleanup
  * If unsuccessful
  ** curl/network errors, duplicated key lines, or the bogus user accepted
covers: bin/omarchy-setup-security-sshd (authorize_keys_from_github, prompt_for_github_user); manual/48:6

### sshd-setup-rejects-bad-arguments   [VM-OK]
description: Scripted SSHD setup must fail fast on malformed flags before touching the machine, and reject a bad key; it also records that a bad key currently leaves sshd running.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl is-enabled sshd`: `disabled`.
  * Type `omarchy-setup-security-sshd --gh-keys; echo "exit=$?"`: `--gh-keys needs a GitHub username.` and `exit=2`, with no sudo prompt.
  * Type `omarchy-setup-security-sshd --key=x --gh-keys dhh; echo "exit=$?"`: `pass either --key or --gh-keys, not both.`, `exit=2`. Type `omarchy-setup-security-sshd --bogus; echo "exit=$?"`: `unknown option '--bogus'. Try --help.`, `exit=2`. Type `systemctl is-enabled sshd`: still `disabled`.
  * Type `omarchy-setup-security-sshd --key="not-a-key"; echo "exit=$?"`, password `prime`: the red `Not a valid SSH public key: not-a-key` and `exit=1`.
  ** Record the state it leaves: `systemctl is-active sshd; sudo ufw status | grep 22; ls /etc/ssh/sshd_config.d/`. Current code starts sshd and opens the port before validating the key, so sshd is active with password auth still on — capture it precisely.
  * Clean up: type `omarchy-remove-security-sshd` (No to removing keys). `systemctl is-enabled sshd` → `disabled`, back as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A sudo prompt during the first three flag errors is itself a failure — they must exit before touching sudo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each error line with its `exit=` and sshd still disabled after the flag errors
  ** Screenshot of "Not a valid SSH public key" and the recorded post-state (sshd active or not, 22 rule or not)
  ** Screenshot of sshd disabled after cleanup
  * If unsuccessful
  ** A flag error that still started sshd, a sudo prompt during parsing, or a crash
covers: bin/omarchy-setup-security-sshd (require_github_user, option parsing, authorize_key); Observations #17

### passwordless-sudo-enable-expire-and-disable   [VM-OK]
description: "Setup → Security → Passwordless Sudo" lets sudo stop asking for a bounded time, reverts by itself when the timer fires, and reverts early when run again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo -n true; echo "exit=$?"`: `exit=1` (sudo needs a password).
  * Open the Omarchy Menu with Super+Space, click Setup → Security → Passwordless Sudo. The `⚠️ WARNING` block appears and asks `Enable passwordless sudo for 15 minutes? …`. Choose Yes, password `prime`. Expect `Passwordless sudo has been ENABLED. It will automatically disable in 15 minutes.` then "Done!". Press a key.
  * In your terminal type `sudo -k; sudo -n true; echo "exit=$?"`: `exit=0`. Type `systemctl list-timers | grep omarchy-nopasswd`: a timer about 15 min out.
  * Type `omarchy-sudo-passwordless 1`: `Passwordless sudo timer updated. It will now automatically disable in 1 minutes.`
  * Every 5 seconds type `sudo -n true; echo "exit=$?"` and screenshot until it flips to `exit=1` (about 60–70 s). Type `ls /etc/sudoers.d/`: no `99-omarchy-nopasswd-prime` file.
  * Type `omarchy-sudo-passwordless`, Yes, `prime` (enabled again), confirm `sudo -n true` succeeds, then type `omarchy-sudo-passwordless` once more: `Passwordless sudo has been DISABLED. Sudo will require a password again.` Type `sudo -k; sudo -n true; echo "exit=$?"`: `exit=1` — back where it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo -n` never prompts, so it is a clean probe; `sudo -k` first drops the cached credential.
  * Enabling always costs one password: the script uses sudo to write the rule.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the WARNING and ENABLED message; `exit=0` probe and the timer line
  ** Screenshot of the 1-minute update and the later `exit=1` with the rule file gone
  ** Screenshot of the DISABLED message and the final `exit=1`
  * If unsuccessful
  ** "Failed to schedule passwordless sudo expiry" / "CRITICAL: Could not remove …", the rule surviving past the timer, or `sudo -n` still succeeding after DISABLED
covers: manual/48:23-25; bin/omarchy-sudo-passwordless; omarchy-menu.jsonc setup.security.passwordless-sudo

### passwordless-sudo-rejects-bad-minutes-and-cancel   [VM-OK]
description: Non-numeric minutes are rejected with usage and declining the warning leaves sudo untouched — the guard rails around a dangerous toggle.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-sudo-passwordless abc; echo "exit=$?"`: `Usage: omarchy-sudo-passwordless [MINUTES]` and `exit=1`, no sudo prompt.
  * Type `omarchy-sudo-passwordless 5x; echo "exit=$?"`: same usage, `exit=1`.
  * Type `omarchy-sudo-passwordless`, password `prime`. At `Enable passwordless sudo for 15 minutes? …` choose **No**: `Aborted. No changes made.`
  * Type `sudo -k; sudo -n true; echo "exit=$?"; ls /etc/sudoers.d/`: `exit=1` and no `nopasswd` file.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: "No" is the right-hand option; Tab or Right then Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both usage errors with exit=1
  ** Screenshot of "Aborted. No changes made." and the probe showing exit=1 with no rule file
  * If unsuccessful
  ** A rule file after No, a usage error that prompted for sudo, or a crash
covers: bin/omarchy-sudo-passwordless (argument validation, gum confirm decline)

### drive-encryption-password-change-and-back   [VM-OK] [SLOW]
description: "Update → Password → Drive Encryption" changes the disk passphrase after confirming the current one; the next boot takes the new one and refuses the old, and the user can change it back to `prime`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Update → Password → Drive Encryption. At `New encryption password` type `omarchy-new-1` Enter; at `Confirm new encryption password` type `omarchy-new-1` Enter.
  * At cryptsetup's `Enter passphrase to be changed:` type `prime` Enter (type `prime` for a `[sudo] password` prompt too if it comes first). The terminal ends with "Done!" and no error. Press a key.
  * Reboot (Super+Escape → Reboot). At the passphrase prompt type `prime` Enter: it must be refused (prompt returns). Type `omarchy-new-1` Enter: the desktop appears.
  * Lock with Super+Ctrl+L and unlock with `prime`: the *user* password is unaffected.
  * Change back: Update → Password → Drive Encryption, new `prime`, confirm `prime`, current `omarchy-new-1`, "Done!".
  * Reboot once more and unlock with `prime`: the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Password fields echo nothing; screenshot after every Enter to catch the refusal.
  * The disk MUST end with passphrase `prime` — do not skip the change-back step.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the change flow ending in Done
  ** Boot screenshots: `prime` refused, `omarchy-new-1` accepted, desktop; lock screen unlocked with `prime`
  ** Screenshot of the change-back and the final boot unlocking with `prime`
  * If unsuccessful
  ** cryptsetup error text ("No key available with this passphrase", "No encrypted drives available."), the old passphrase still unlocking, or the final boot refusing `prime`
covers: manual/48:13; bin/omarchy-drive-password; omarchy-menu.jsonc update.password.drive

### drive-encryption-password-rejects-bad-input   [VM-OK]
description: The drive password tool refuses an empty or mismatched new passphrase and a wrong current passphrase, leaving the existing key untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-drive-password`. At `New encryption password` press Enter with nothing typed: `Password cannot be empty.`
  * Type `omarchy-drive-password` again: `abc` Enter, then `xyz` Enter at Confirm: `Passwords do not match.`
  * Type `omarchy-drive-password` again: `abc`, `abc`, then at `Enter passphrase to be changed:` type `wrongpass` Enter (password `prime` for sudo if asked first): cryptsetup reports `No key available with this passphrase.` Press Ctrl+C if it offers a retry.
  * Type `omarchy-drive-password` once more and press Esc at the first prompt: it exits quietly.
  * Reboot (Super+Escape → Reboot) and unlock with `prime`: the desktop returns — the key was never changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum password fields show nothing while typing; that is normal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of "Password cannot be empty.", "Passwords do not match.", and "No key available with this passphrase."
  ** Boot screenshot: `prime` still unlocks
  * If unsuccessful
  ** `prime` refused at boot, the tool proceeding past empty/mismatched input, or a traceback
covers: bin/omarchy-drive-password (validation and cryptsetup failure path); manual/48:13

### user-password-change-keeps-disk-password   [VM-OK] [SLOW]
description: "Update → Password → User" changes only the login/sudo password: the lock screen and sudo take the new one while the disk still unlocks with `prime`; the user then changes it back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Update → Password → User. At `Current password:` type `prime`; at `New password:` and `Retype new password:` type `newuserpw1`. Expect `passwd: password updated successfully` and "Done!". Press a key.
  * Lock with Super+Ctrl+L. Type `prime` Enter: stays locked. Type `newuserpw1` Enter: desktop returns.
  * Reboot (Super+Escape → Reboot). At the disk prompt type `prime`: it must unlock; the desktop appears (autologin).
  * Open Update → Password → User again and type `wrong` at `Current password:`: `passwd: Authentication token manipulation error` (or "Authentication failure") and "Failed (exit code 1)!". Press a key.
  * Change back: Update → Password → User, current `newuserpw1`, new `prime` twice, "Done!". Lock with Super+Ctrl+L and unlock with `prime` — exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `passwd` echoes nothing; screenshot after each Enter.
  * The lock screen dims to black when idle; keystrokes still reach the password box.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "password updated successfully"; lock screen refusing `prime` and accepting `newuserpw1`
  ** Boot screenshot showing `prime` still unlocking the disk
  ** Screenshot of the wrong-current-password failure and the final unlock with `prime`
  * If unsuccessful
  ** The disk prompt refusing `prime` after the change (coupled passwords), or passwd errors on valid input
covers: manual/48:13; omarchy-menu.jsonc update.password.user (passwd); PAM system-auth

### luks-wrong-passphrase-reprompts-at-boot   [VM-OK]
description: A wrong disk passphrase at boot is refused and asked again — never a shell, never a boot — and the right one then boots normally.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Reboot: press Super+Escape and click Reboot with the mouse. Let Limine auto-boot (touch no keys).
  * At the Plymouth passphrase prompt type `wrong-passphrase` Enter. The prompt must come back (possibly with an error text); no emergency shell, no boot.
  * Type `still-wrong` Enter: same.
  * Type `prime` Enter: the boot continues to the desktop, exactly as before the reboot.
  * Run `./client get-serial` and note any lines from the encrypt/plymouth hook about the failed attempts.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot after every Enter; the refusal may be a brief message or just a cleared field.
  * A `[rootfs ]#` or "emergency shell" prompt is a failure — capture it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompt after each wrong attempt (still a passphrase prompt) and the desktop after `prime`
  * If unsuccessful
  ** An emergency shell, a boot on a wrong passphrase, or a hang with no prompt; the serial log
covers: manual/02:3, manual/48:5; etc/mkinitcpio.conf.d/omarchy_hooks.conf (plymouth, encrypt)

### login-lockout-after-ten-failures-and-faillock-reset   [VM-OK]
description: Ten wrong passwords lock the account for two minutes; the manual's recovery — a root login on a text console and `faillock --reset` — unlocks it immediately.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Lock the screen with Super+Ctrl+L. Type `wrong` Enter ten times in quick succession, screenshotting each attempt.
  * Immediately type the correct password `prime` Enter: it must be REFUSED — the desktop must not return.
  ** Quirk: faillock auto-unlocks after 120 s. If more than ~90 s passed since the tenth failure, redo the ten failures before testing `prime`.
  * Press Ctrl+Alt+F2. At the text `login:` type `root` Enter, then `prime` Enter (root shares the user's password on ISO installs).
  * Type `faillock --user prime`: a table of ~10 failures. Type `faillock --reset --user prime`, then `faillock --user prime` again: empty.
  * Type `exit` and press Ctrl+Alt+F1 to return to the graphical session (the lock screen).
  ** If F1 shows a text console instead, try Ctrl+Alt+F3 through F7 until the lock screen is visible.
  * Type `prime` Enter: the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen dims to black when idle; keys still go to the password box.
  * Work fast between the tenth failure and the `prime` attempt — that window is the whole test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `prime` refused right after ten failures
  ** Screenshot of the console with `faillock --user prime` listing failures, then empty after `--reset`
  ** Screenshot of the desktop restored
  * If unsuccessful
  ** `prime` accepted immediately after ten failures, root login refused on the console, or no way back to the graphical VT (list the VT keys tried)
covers: manual/45:39; etc/security/faillock.conf; install/config/increase-lockout-limit.sh; bin/omarchy-apply-lock

### sudo-rejects-wrong-password-then-accepts   [VM-OK]
description: sudo refuses a wrong password with "Sorry, try again." and keeps asking for up to ten tries (not stock three), so a typo does not cost the user their admin session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo true`.
  * At `[sudo] password for prime:` type `wrong1` Enter → `Sorry, try again.`; `wrong2` → same; `wrong3` → same; a fourth prompt must still appear (stock sudo gives up after 3).
  * Type `prime` Enter: the command succeeds silently. Type `echo $?`: `0`.
  * Type `sudo -k; sudo true` and press Ctrl+C at the prompt: sudo exits without running.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Stop at three wrong attempts: faillock counts sudo failures too and locks the account at ten.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of three "Sorry, try again." lines followed by a fourth prompt and success with `prime`
  * If unsuccessful
  ** sudo giving up after 3 ("3 incorrect password attempts") or accepting a wrong password
covers: etc/sudoers.d/omarchy-passwd-tries; manual/45:39; manual/48:13

### privileged-command-without-terminal-fails-cleanly   [VM-OK]
description: A sudo-requiring Omarchy command launched with no terminal fails with sudo's clear message and does nothing, while the one command built for that case (`omarchy-dns`) still works via its passwordless grant.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo snapper list` (password `prime`); note the row count; type `sudo -k`.
  * Type `setsid -f bash -c 'omarchy-snapshot create >/tmp/no-tty.log 2>&1'`, wait 5 s, then `cat /tmp/no-tty.log`: it must contain `sudo: a terminal is required to read the password…` and must NOT contain "Create system snapshot".
  * Type `sudo snapper list` (password `prime`): row count unchanged.
  * Type `sudo -k; setsid -f bash -c 'omarchy-dns Google >/tmp/dns.log 2>&1'`, wait 5 s, `cat /tmp/dns.log; omarchy dns`: no sudo error and `Google`.
  * Type `omarchy dns DHCP` then `omarchy dns`: `DHCP` — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `setsid -f` detaches the command from the terminal so sudo has no tty — that is the point of the test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `/tmp/no-tty.log` with "a terminal is required" and unchanged snapper rows
  ** Screenshot of `omarchy dns` showing Google after the tty-less run, then DHCP
  * If unsuccessful
  ** A snapshot created without a password, a hung `sudo` (`pgrep -a sudo`), or an empty log after 15 s
covers: bin/omarchy-snapshot (requires-sudo); bin/omarchy-dns require_root; etc/sudoers.d/omarchy-dns; Observations #12

### dns-switch-from-menu-without-password   [VM-OK] [NET]
description: The DNS entries under Setup → Network → DNS switch provider with one click and no password, show which one is current, and keep names resolving; a bogus provider on the command line is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; omarchy dns`: `DHCP` on a stock disk.
  * Open the Omarchy Menu with Super+Space, click Setup → Network → DNS. DHCP carries the check mark. Click Cloudflare — no password prompt may appear.
  * In the terminal type `omarchy dns; resolvectl status | grep -A3 '^Global'`: `Cloudflare` and `1.1.1.1`. Type `resolvectl query omarchy.org`: an address is returned.
  * Reopen Setup → Network → DNS: Cloudflare is checked. Click Google; `omarchy dns` → `Google`.
  * Click DHCP; `omarchy dns` → `DHCP`; `resolvectl query omarchy.org` still resolves — back to stock.
  * Type `omarchy dns Bogus; echo "exit=$?"`: `Usage: omarchy-dns [Cloudflare|Google|DHCP|Custom]`, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the submenu each time to capture the check glyph moving.
  * A password or polkit dialog on Cloudflare/Google/DHCP is a failure of the sudoers grant — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the DNS submenu with the check moving DHCP → Cloudflare → Google → DHCP and no password dialog
  ** Screenshot of `omarchy dns` / `resolvectl` per provider and a successful query
  ** Screenshot of the usage error with exit=1
  * If unsuccessful
  ** A password prompt, `omarchy dns` not changing, or `resolvectl query` failing after the switch
covers: manual/46:35 (via manual/35); bin/omarchy-dns; etc/sudoers.d/omarchy-dns; omarchy-menu.jsonc setup.network.dns.*

### dns-custom-requires-terminal-and-rejects-empty   [VM-OK]
description: The Custom DNS entry deliberately asks for the sudo password in a terminal and refuses an empty server list; a real list applies and DHCP restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k`.
  * Open the Omarchy Menu with Super+Space, click Setup → Network → DNS → Custom. The floating terminal must prompt `[sudo] password for prime:` (unlike the other three). Type `prime`.
  * At `Enter your DNS servers (space-separated, …):` press Enter with nothing typed: `Error: No DNS servers provided.` and "Failed (exit code 1)!". Press a key.
  * In your terminal type `omarchy dns`: still `DHCP`.
  * Type `omarchy dns Custom` (password `prime`), enter `9.9.9.9 149.112.112.112`. Type `omarchy dns; resolvectl status | grep -A3 '^Global'`: `Custom` and `9.9.9.9`.
  * Type `omarchy dns DHCP; omarchy dns`: `DHCP` — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If passwordless sudo was left on by an earlier test the prompt will be missing; it must be off.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the password prompt inside the Custom terminal and the "No DNS servers provided" failure
  ** Screenshot of `Custom` with 9.9.9.9, then `DHCP`
  * If unsuccessful
  ** Custom applying with no servers, no password prompt, or stale servers after DHCP
covers: bin/omarchy-dns (Custom branch, require_root); etc/sudoers.d/omarchy-dns; omarchy-menu.jsonc setup.network.dns.custom

### factory-reset-rejects-wrong-confirmation-and-passphrase   [VM-OK]
description: "Setup → Reset Computer" refuses to stage a wipe unless the user types `reset` and proves the disk passphrase, and a cancelled attempt leaves the system booting as before.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Setup → Reset Computer. Password `prime`. The red `Reset this computer to factory state?` screen lists what is erased and asks `Type 'reset' to continue`.
  * Type `nope` Enter: `Error: Reset not confirmed.` and "Failed (exit code 1)!". Press a key.
  * Repeat Setup → Reset Computer, `prime`, type `reset` Enter. After `Cloning the factory snapshot` … `Removing account credentials…` it asks `Confirm your disk encryption passphrase to authorize the re-key.`
  * Type `wrong` Enter: `That passphrase does not unlock /dev/… Try again.` Press Esc: the script exits ("Failed (exit code 1)!"). Press a key.
  ** Quirk: by this point the script has already scrubbed the `@factory` baseline in place and runtime-masked `limine-snapper-sync` until reboot. Harmless on this disposable disk, but note it.
  * Open a terminal with Super+Enter and type `ls /var/lib/omarchy/provisioning/`: no `pending` or `wipe-pending`.
  * Reboot (Super+Escape → Reboot), type `prime`: the same desktop and user return — no first-boot wizard.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum input: Esc cancels. The Reset entry only appears because root is btrfs.
  * "This machine has no factory snapshot to reset to." on the minted disk is a mint/ISO gap — report it as such.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "Error: Reset not confirmed."
  ** Screenshot of "That passphrase does not unlock … Try again." and the cancelled run
  ** Screenshot of the empty provisioning dir and the normal desktop after reboot
  * If unsuccessful
  ** A reset staged after a wrong confirmation/passphrase, or the first-boot wizard appearing after reboot
covers: manual/48:17-19; bin/omarchy-system-factory-reset (confirm_reset, stage_luks_rekey, cleanup trap); omarchy-menu.jsonc setup.reset

### factory-reset-hands-machine-to-new-owner   [VM-OK] [SLOW]
description: Handing on a machine: reset from the menu, reboot, the wipe runs, the first-boot wizard creates a new owner, and the disk now unlocks only with the new owner's password.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `hostname; touch ~/seller-file` (note the hostname). Open the Omarchy Menu with Super+Space, click Setup → Reset Computer: `prime`, type `reset` Enter, `Passphrase>` `prime` Enter.
  * Wait through `Rebuilding boot files … (this can take a minute)` until `Reset staged. The wipe finishes on the next boot.`; choose `Reboot now`.
  * Let Limine auto-boot. No passphrase prompt is expected on this boot (throwaway auto-unlock key) — record whether one appears. `./client get-serial` should show `factory-wipe: … factory wipe complete`.
  * At the console greeter (`Press Return to Start Setup`) press Enter. Keyboard: Enter for English (US). `Username>` `newowner`; `Password>`/`Confirm>` `owner-pass-1`; Full name `New Owner`; Email: Enter; `Hostname>` `resetbox`; timezone: pick any entry, Enter. At `Does this look right?` choose Yes.
  ** The first-boot form runs on tty1 with a dark palette; if it looks garbled, wait 2–3 s — it redraws after the virtio-gpu console resize.
  * `Setting up your machine` with a progress bar and rotating tips runs several minutes (finalize, then the LUKS re-key). Screenshot every 5 s until the desktop appears (autologin).
  * Open a terminal and type `whoami; hostname; ls /home; id prime; ls ~/seller-file`: `newowner`, `resetbox`, only `newowner`, "no such user", "No such file".
  * Reboot (Super+Escape → Reboot). A passphrase prompt MUST appear: type `prime` → refused; type `owner-pass-1` → the desktop returns. The machine now belongs to the new owner; end the session with `stop` (it cannot return to `prime`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Budget 6–9 minutes; never sleep more than 5 s.
  * If `Setup hit an error` appears, screenshot it, choose `Try again` once; if it fails again choose `Drop to console`, type `cat /var/log/omarchy-provision-owner.log | tee /dev/ttyS0` and report via `./client get-serial`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "Reset staged" and the Reboot now confirm; serial excerpt with "factory wipe complete"
  ** Screenshots of the greeter, filled form, confirmation table, progress screen
  ** Screenshot of the desktop as `newowner` with hostname `resetbox`, no `prime`, seller file gone
  ** Boot screenshots: passphrase prompt present, `prime` refused, `owner-pass-1` accepted
  * If unsuccessful
  ** "This machine has no factory snapshot to reset to.", a limine-update/hash-mismatch message, `Setup hit an error` with the log, `prime` still existing, or no passphrase prompt on the final boot (disk still auto-unlocking)
covers: manual/48:17-19; manual/02:25 (first-boot half); bin/omarchy-system-factory-reset; bin/omarchy-system-factory-reset-finish; bin/omarchy-provision-owner (incl. rekey_luks); install/provisioning/*.service

### factory-reset-first-boot-form-validation   [VM-OK] [SLOW]
description: The first-boot owner form after a reset rejects reserved or malformed usernames, blank or mismatched passwords and bad hostnames with clear notices, and Esc, Ctrl+C and "No, change it" behave as escape hatches rather than traps.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Stage a reset as in `factory-reset-hands-machine-to-new-owner` (Setup → Reset Computer, `prime`, `reset`, passphrase `prime`, `Reboot now`) and press Enter at the console greeter.
  * Keyboard step: press Esc — nothing precedes it, so the picker simply reappears. Press Enter for English (US).
  * `Username>`: `root` → `Username is reserved for system`; `Bad Name` → `Username must be alphanumeric with no spaces`; then `newowner` accepted.
  * `Password>`: Enter twice → `Your password can't be blank!`; `abc` / `xyz` → `Passwords didn't match!`; then `owner-pass-1` twice.
  * Full name: press Ctrl+C once → `Reboot this machine?` with `Yes, reboot` / `No, keep setting up`; choose `No, keep setting up`, then Enter twice to skip name and email.
  * `Hostname>`: `-bad-` → `Hostname must be 1-63 letters, digits, or dashes…`; Enter on empty → default `omarchy`. Timezone: press Esc — the form unwinds to the keyboard step; go through it again quickly (Enter, `newowner`, password twice, Enter ×2, Enter, pick a timezone).
  * At `Does this look right?` choose `No, change it` once (form restarts), run through again and choose Yes. Let setup finish; on the desktop type `whoami; hostname`: `newowner`, `omarchy`. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Validation notices flash for about a second — screenshot immediately after Enter.
  * Budget 8–10 minutes; be brisk in the repeated form passes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each rejection notice (reserved, alphanumeric, blank, mismatch, hostname)
  ** Screenshot of the Ctrl+C reboot confirm declined, Esc unwinding to the keyboard step, and "No, change it" restarting
  ** Desktop as `newowner` with hostname `omarchy`
  * If unsuccessful
  ** An invalid value accepted, Ctrl+C rebooting without asking, `Setup hit an error`, or a skipped step
covers: install/provisioning/setup-form.sh; bin/omarchy-provision-owner (keyboard_form, user_form, confirm_form, confirm_reboot); manual/02:25; manual/48:17

### signing-key-and-repo-sources   [VM-OK] [NET]
description: Packages come only from Arch core/extra/multilib plus the Omarchy repo and mirror, signed by the published key, and the ISO signature is one `.sig` away — the supply-chain claims of the security chapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q omarchy-keyring; pacman-key --list-keys 40DFB630FF42BCFFB047046CF0134EE680CAC571`: a version line and a `pub` block with `pkgs@omarchy.org`.
  * Type `grep -E '^\[' /etc/pacman.conf`: exactly `[options] [core] [extra] [multilib] [omarchy]`.
  * Type `grep -E '^Server' /etc/pacman.conf /etc/pacman.d/mirrorlist; grep '^SigLevel' /etc/pacman.conf`: an `*.omarchy.org` mirror, `pkgs.omarchy.org` for `[omarchy]`, `Required DatabaseOptional`.
  * Type `curl -sIL https://iso.omarchy.org/omarchy-4.0.4.iso.sig | grep -m1 HTTP`: a `200`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only the `.sig` HEAD request needs network (a few hundred bytes).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the key block with the fingerprint and `pkgs@omarchy.org`
  ** Screenshot of the repo list, mirror servers, SigLevel, and the 200 for the `.sig`
  * If unsuccessful
  ** Key missing, extra repositories, a non-omarchy mirror, or a 404
covers: manual/48:8, 48:29-31; default/pacman/*; omarchy-keyring

### hardware-restart-entries-run-without-devices   [VM-PARTIAL]
description: The "Update → Hardware" reloads for Wi-Fi, Bluetooth, Audio and Trackpad each run to "Done!" even with no such device present — the software path of the troubleshooting advice (device recovery itself skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Update → Hardware: Audio, Wi-Fi, Bluetooth, Trackpad are listed.
  * Click Wi-Fi: `Unblocking wifi...`, an empty `rfkill list wifi`, "Done! Press any key to close...". Press a key.
  * Update → Hardware → Bluetooth: `Unblocking bluetooth...`, empty list, Done. Press a key.
  * Update → Hardware → Audio: `Restarting audio services...`, then `Audio status:` with a `wpctl status` tree whose Sinks/Sources are empty, Done. It must not say `Audio services are still not responding`. Press a key.
  * Update → Hardware → Trackpad: password `prime`; no devices, Done. Press a key.
  * Open a terminal with Super+Enter and type `systemctl --user is-active pipewire wireplumber pipewire-pulse`: three `active` — the audio stack came back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Failed (exit code N)!" on any entry is the finding — capture exit code and output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the submenu and of each terminal ending in Done (Audio showing the wpctl tree)
  ** Screenshot of the three `active` user services
  * If unsuccessful
  ** A Failed line, "Audio services are still not responding", or a missing entry
covers: manual/45:27; bin/omarchy-restart-wifi, -bluetooth, -audio, -trackpad; omarchy-menu.jsonc update.hardware.*

### omarchy-debug-collects-log-hides-upload-offline   [VM-PARTIAL]
description: `omarchy-debug` builds a support log with the documented sections and offers View/Save; Upload is hidden where ping fails (as in this VM), `--no-sudo` skips dmesg, and unknown flags are rejected. (Skipped: the upload itself.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cd /tmp; omarchy-debug --bogus; echo "exit=$?"`: `Unknown option: --bogus`, the usage line, `exit=1`.
  * Type `omarchy debug --print --no-sudo | grep -E '^(Date|Hostname|SYSTEM INFORMATION|DMESG|JOURNALCTL|INSTALLED PACKAGES|\(skipped)'`: the section headers and `(skipped - --no-sudo flag used)`, no sudo prompt.
  * Type `omarchy-debug`, password `prime`. After inxi finishes (10–20 s) a chooser appears; record its options — expect only `View log` and `Save in current directory` (no `Upload log`, because ICMP fails here).
  * Choose `Save in current directory`: `✓ Log saved to /tmp/omarchy-debug.log`. Type `grep -E '^(SYSTEM INFORMATION|DMESG|JOURNALCTL|INSTALLED PACKAGES)' /tmp/omarchy-debug.log; grep -c virtio /tmp/omarchy-debug.log`: four headers and a non-zero count (dmesg captured this time).
  * Type `omarchy-debug` again, choose `View log`: `less` opens; press `q`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `Upload log` IS offered, ICMP works in this harness — note it and do not upload.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the unknown-option error and the `--print --no-sudo` headers with the skipped-dmesg note
  ** Screenshot of the chooser options, the "Log saved" line and the section-header grep
  * If unsuccessful
  ** A crash from inxi/journalctl, a missing section, or the chooser not appearing
covers: manual/45:5; bin/omarchy-debug; Observations #13

### omarchy-reinstall-cancel-leaves-system-untouched   [VM-OK]
description: `omarchy-reinstall` warns that user config will be overwritten and, when declined, changes nothing — the last-resort repair must be safe to back out of.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo "# marker" >> ~/.bashrc; tail -1 ~/.bashrc; pacman -Q | wc -l`. Note the marker and count.
  * Type `omarchy-reinstall`: `This will reinstall all default Omarchy packages and reset default configs.` / `Warning: user config changes will be overwritten.` then `Are you sure you want to reinstall and lose config changes?` — choose **No**.
  * Type `tail -1 ~/.bashrc; pacman -Q | wc -l`: marker still there, count unchanged, and no sudo prompt was shown.
  * Type `omarchy reinstall` and press Ctrl+C at the prompt: same checks.
  * Type `sed -i '$ d' ~/.bashrc` to remove the marker — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do NOT choose Yes: the real reinstall downloads packages and exceeds the session budget.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the warning text, the No answer, and the intact marker/count
  * If unsuccessful
  ** Any package or config change after No, or a sudo prompt before confirmation
covers: manual/45:5; bin/omarchy-reinstall

### gdk-scale-setting-shrinks-oversized-apps   [VM-OK]
description: The troubleshooting fix for huge apps — set `omarchy_gdk_scale` from 2 to 1 in `~/.config/hypr/monitors.lua` and restart the app — visibly shrinks a GTK/Electron app on this 1× display; the test records which reload step was needed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `grep omarchy_gdk_scale ~/.config/hypr/monitors.lua; echo $GDK_SCALE`: `local omarchy_gdk_scale = 2` and `2`.
  * Open Obsidian from the launcher (Super+Space, type `Obsidian`, Enter). Screenshot its window; note the size of its text and buttons against the bar. Close it with Super+W.
  * Type `sed -i 's/omarchy_gdk_scale = 2/omarchy_gdk_scale = 1/' ~/.config/hypr/monitors.lua; hyprctl reload`. Open a NEW terminal (Super+Enter) and type `echo $GDK_SCALE`; record `1` or `2`.
  * Open Obsidian again and screenshot: its UI should be about half the size.
  ** If unchanged, log out (Super+Escape → Logout), log in at SDDM with `prime`, open Obsidian and screenshot; record that a re-login was required (the manual says only "restart the app").
  * Type `sed -i 's/omarchy_gdk_scale = 1/omarchy_gdk_scale = 2/' ~/.config/hypr/monitors.lua; hyprctl reload` — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Obsidian is preinstalled (Electron); `Print Settings` (GTK3) is a fallback if it is missing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots of the same app window at visibly different UI sizes
  ** Screenshot of `echo $GDK_SCALE` after the reload with a note on which step (reload / app restart / re-login) was needed
  * If unsuccessful
  ** No size change even after re-login, or the app failing to start after the edit
covers: manual/45:9; config/hypr/monitors.lua; manual/33 (overlap)

### capslock-is-compose-key   [VM-OK]
description: Caps Lock acts as the compose key — `Caps Lock, m, s` types 😄 — and no longer shifts letters, which is the troubleshooting answer to "Caps Lock isn't working".
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `head -4 ~/.XCompose`: `include "%L"` and `<Multi_key> <m> <s> : "😄"`.
  * Type `echo ` then press Caps Lock, then `m`, then `s`, then Enter: the terminal prints `😄`.
  * Type `abc` and Enter: the echoed command text is lowercase `abc` (Caps Lock did not toggle capitals).
  * Press Caps Lock, `m`, `h`, Enter: `❤️` appears in the error line.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send Caps Lock as `<CAPSLOCK>`; the sequence is three separate key presses, not a chord.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `😄` printed and lowercase `abc`
  * If unsuccessful
  ** Uppercase `ABC` (Caps Lock still toggles) or no emoji produced
covers: manual/45:15-23; default/xcompose; manual/07 quick emojis (overlap)

### faq-keyboard-layout-switching-indicator   [VM-OK]
description: Adding a second layout in `~/.config/hypr/input.lua` shows a layout indicator in the bar and lets the user switch with Left Alt + Right Alt or a click, as the FAQ describes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar: no keyboard-layout indicator on a single-layout system.
  * Open a terminal with Super+Enter and type `echo 'hl.config({ input = { kb_layout = "us,fr", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })' >> ~/.config/hypr/input.lua; hyprctl reload`.
  * Screenshot the bar: a layout indicator (`us`/`EN`) is now visible.
  * In the terminal type `q` — you see `q`. Press Left Alt and Right Alt together, then type `q`: with French AZERTY active it produces `a`. Screenshot the indicator showing `fr`/`FR`.
  * Click the indicator in the bar with the mouse: it switches back; type `q` → `q`.
  * Type `sed -i '/kb_layout = "us,fr"/d' ~/.config/hypr/input.lua; hyprctl reload`: the indicator disappears — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Alt chord is `send-keys --keys "<A-alt_r>"` (Left Alt held while tapping Right Alt). If it does not switch, use the bar click and note it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots without, with, and again without the indicator
  ** Screenshot of `q` producing `a` under French and the indicator changing; back to `q` after clicking
  * If unsuccessful
  ** No indicator after two layouts, switching not working, or Hyprland failing to reload
covers: manual/46:5-17; manual/34 (overlap); ~/.config/hypr/input.lua

### faq-clock-format-cycle-and-set   [VM-OK]
description: Right-clicking the bar clock cycles through formats including 12-hour, and `omarchy bar set omarchy.clock format …` sets one explicitly — the FAQ's clock answer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar clock (stock 24-hour).
  * Right-click the clock: the format changes. Right-click a few more times, screenshotting each: a 12-hour `AM`/`PM` format appears and the cycle returns to the original.
  * Open a terminal with Super+Enter and type `omarchy bar set omarchy.clock format "dddd h:mm AP"`: the clock reads like `Friday 1:07 PM`.
  * Type `omarchy bar set omarchy.clock format ""; echo "exit=$?"` and record the behaviour (error or unchanged clock).
  * Right-click the clock until the original stock format shows again — back as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clock is on the right of the bar; `mouse move` there first and check the position before the right-click.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the clock through the cycle including a 12-hour format and after the `omarchy bar set` command
  * If unsuccessful
  ** Right-click doing nothing, the command erroring, or the clock not updating
covers: manual/46:21-27; bin/omarchy-bar; manual/05 (overlap)

### faq-timezone-picker-and-time-resync   [VM-OK]
description: "Update → Timezone" changes the zone with no password and a notification, cancelling the picker changes nothing, and "Update → Time" restarts time sync with the password.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Update → Timezone. A `Set timezone` picker opens. Press Esc: it closes and the bar clock is unchanged.
  * Update → Timezone again; type `Auckland`, select `Pacific/Auckland`, Enter. No password prompt. A notification `Timezone is now set to Pacific/Auckland` appears and the clock jumps by the offset.
  * Update → Time: the floating terminal prints `Updating time...`, asks `[sudo] password for prime:` → `prime`, then "Done!". Press a key.
  * Update → Timezone, type `UTC` (or your original zone), Enter: notification and clock back — as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker filters as you type. A password prompt on the timezone change is a failure (sudoers grant).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker, the Esc cancel with the unchanged clock
  ** Screenshot of the notification and shifted clock; the Update → Time terminal with password prompt and Done; the restored clock
  * If unsuccessful
  ** A sudo prompt on the timezone change, no notification, or the clock not moving
covers: manual/46:31; bin/omarchy-menu-timezone; bin/omarchy-update-time; etc/sudoers.d/omarchy-tzupdate; omarchy-menu.jsonc update.timezone / update.time

### faq-disk-speed-test   [VM-OK]
description: "Trigger → Speed Test → Disk Speed Test" shows live read/write throughput, the CLI prints the same figures, and a nonexistent target directory is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Trigger → Speed Test → Disk Speed Test. A panel runs a read phase then a write phase (~8 s each) with MB/s figures and settles on final numbers. Screenshot during and after; press Esc to close.
  * Open a terminal with Super+Enter and type `omarchy disk speedtest`: a `disk <model or vda>` line, `read N` lines, then `write N` lines.
  * Type `omarchy-disk-speedtest /does/not/exist; echo "exit=$?"`: `Usage: omarchy-disk-speedtest [target-dir]`, `exit=2`.
  * Type `ls ~/.cache/omarchy/ | grep -c disk-speedtest`: `0` — scratch files cleaned up.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The virtio disk may report no model, so the first line can read `disk vda`. Any positive figure passes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the panel mid-test and finished; the CLI output; the usage error with exit=2; no leftover files
  * If unsuccessful
  ** "Need at least 2048MB free", "Direct disk I/O is not available", a failed phase, or leftover `disk-speedtest-*.dat`
covers: manual/46:39; bin/omarchy-disk-speedtest; omarchy-menu.jsonc trigger.tests.disk-speedtest

### faq-chromium-account-credentials   [VM-OK]
description: "Install → Service → Chromium Account" adds the OAuth flags Chromium needs for Google sign-in and then marks itself installed; rerunning does not duplicate them. (Signing in itself needs a Google account and is not tested.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Install → Service: `Chromium Account` is listed and not marked installed.
  * Click it: `Installing Chromium Google account support...`, `Now you can login to your Google Account in Chromium.`, "Done!". Press a key.
  * Reopen Install → Service: `Chromium Account` now shows as installed (check glyph); clicking it does nothing.
  * Open a terminal with Super+Enter and type `grep -c oauth2 ~/.config/chromium-flags.conf; omarchy-install-chromium-google-account; grep -c oauth2 ~/.config/chromium-flags.conf`: `2`, the message again, still `2`.
  * Open Chromium with Super+Shift+Enter, click the profile avatar (top right): a Sign in / Turn on sync option is present. Close Chromium with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the entry is hidden, `~/.config/chromium-flags.conf` is missing — report that.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the entry before/after, the terminal message, the count staying at 2, and Chromium's sign-in option
  * If unsuccessful
  ** Entry missing, flags duplicated, or Chromium failing to start
covers: manual/46:43; bin/omarchy-install-chromium-google-account; omarchy-menu.jsonc install.service.chromium-account

### faq-print-settings-and-pdf-printing   [VM-PARTIAL]
description: Printing is ready out of the box — CUPS runs, "Print Settings" opens and can add a printer, and print-to-PDF works with none attached; discovery finds nothing in this VM (adding a real printer skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl is-active cups avahi-daemon`: `active` twice.
  * Open the launcher with Super+Space, type `Print Settings`, Enter: the printers window opens with an empty list.
  * Click `Add` (password `prime` if a polkit dialog appears). After the scan, only generic entries remain; expand `Network Printer` and confirm `Internet Printing Protocol (ipp)` is offered. Cancel and close the window.
  * Open Chromium with Super+Shift+Enter, press Ctrl+P: Destination is `Save as PDF`. Click Save, accept the default name in `~/Downloads`.
  * In the terminal type `ls -la ~/Downloads/*.pdf`: the new PDF with non-zero size. Type `rm ~/Downloads/*.pdf` and close Chromium — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Add dialog scans for ~10 s; screenshot when the spinner stops.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of CUPS active, the Print Settings window, the Add dialog with the IPP option, the Save-as-PDF dialog and the resulting file
  * If unsuccessful
  ** CUPS inactive, Print Settings missing, the Add dialog erroring, or no PDF written
covers: manual/46:47-53; install/config/enable-services.sh (cups, avahi)

### faq-screenshot-dir-override   [VM-OK] [SLOW]
description: An `OMARCHY_SCREENSHOT_DIR` export in `~/.config/uwsm/env.d/` redirects screenshots after a re-login, and the FAQ's caveat that the directory must exist first is checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Print and capture a region by dragging with the mouse. Open a terminal with Super+Enter and type `ls -t ~/Pictures | head -1`: the fresh screenshot in `~/Pictures`.
  * Type `mkdir -p ~/.config/uwsm/env.d; echo 'export OMARCHY_SCREENSHOT_DIR="$HOME/Pictures/Screenshots"' > ~/.config/uwsm/env.d/capture`. Do NOT create the directory yet.
  * Log out: Super+Escape → Logout. At SDDM type `prime` and log in.
  * Open a terminal and type `echo $OMARCHY_SCREENSHOT_DIR`: `/home/prime/Pictures/Screenshots`. Press Print, capture a region, and record what happens with the directory missing: `ls -t ~/Pictures | head -1; ls ~/Pictures/Screenshots`.
  * Type `mkdir -p ~/Pictures/Screenshots`, press Print, capture again: `ls -t ~/Pictures/Screenshots | head -1` shows the new file.
  * Type `rm ~/.config/uwsm/env.d/capture` — stock again after the next login.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the Print key as `<PRINT>`; if a region selector appears, `mouse drag` a small rectangle.
  * Logout closes all windows; finish typing before pressing Logout.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the stock file in ~/Pictures, the env.d file, the SDDM login
  ** Screenshot of the variable after re-login and the behaviour with the directory missing
  ** Screenshot of the new file inside ~/Pictures/Screenshots
  * If unsuccessful
  ** The variable unset after re-login, screenshots still in ~/Pictures once the directory exists, or a capture-tool crash
covers: manual/46:57-65; manual/12 (overlap); uwsm env.d

### faq-remove-preinstalls-and-install-back-entry   [VM-OK] [SLOW]
description: "Remove → Preinstalls" sweeps out web apps, TUIs and optional applications in one go, then hides itself while "Install → Preinstalls" lights up; declining does nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q obsidian libreoffice-fresh omacalc | wc -l`: `3`.
  * Open the Omarchy Menu with Super+Space: Install → `Preinstalls` is present but disabled; Remove shows `Preinstalls`, `Web App`, `TUI`.
  * Click Remove → Preinstalls; at `Are you sure you want to remove all preinstalled web apps, TUI wrappers, and desktop applications?` choose **No**. Type `pacman -Q obsidian`: still installed.
  * Click Remove → Preinstalls again, **Yes**, password `prime` if asked: `Removing preinstalled Omarchy applications...`, pacman removals (1–2 min), "Done!". Press a key.
  * Type `pacman -Q obsidian libreoffice-fresh omacalc pinta`: all `was not found`. Open Super+Space → Apps: no `Basecamp`/`HEY`/`WhatsApp` web apps.
  * Open Remove: `Preinstalls` is gone; open Install: `Preinstalls` is enabled. Press Super+K: the Obsidian binding (Super+O) is no longer listed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run Install → Preinstalls afterwards (hundreds of MB); the disk is discarded anyway.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the No path leaving packages; the removal output and Done; packages `was not found`
  ** Screenshots of the Remove menu without Preinstalls, Install with it enabled, the launcher without web apps, keybindings without Obsidian
  * If unsuccessful
  ** pacman errors, packages surviving, or menu entries not toggling
covers: manual/46:75-81; bin/omarchy-remove-preinstalls; omarchy-menu.jsonc remove.preinstalls / install.preinstalls

### faq-remove-package-picker   [VM-OK]
description: "Remove → Package" opens a fuzzy picker where Tab multi-selects and Enter removes; Esc removes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q omacalc omawrite | wc -l`: `2`.
  * Open the Omarchy Menu with Super+Space, click Remove → Package: an fzf list of installed packages with a preview pane. Press Esc. Type `pacman -Q omacalc`: still installed.
  * Remove → Package again: type `omacalc`, Tab (red marker), Ctrl+U, type `omawrite`, Tab, Enter. Password `prime`. pacman removes both, "Done!". Press a key.
  * Type `pacman -Q omacalc omawrite`: both `was not found`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The preview label says `tab: multi-select`; Alt+P toggles the preview if it hides the list.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker, Esc leaving packages installed, two marked rows, the removal, and `was not found` for both
  * If unsuccessful
  ** Esc removing something, a dependency error, or the picker not opening
covers: manual/46:77; bin/omarchy-pkg-remove; omarchy-menu.jsonc remove.package

### volume-popup-without-audio-device   [VM-PARTIAL]
description: With no audio device the bar's volume popup and `omarchy audio tuning` degrade gracefully — no devices listed, no crash — which is all of the troubleshooting speaker advice this VM can show.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right side of the bar and note whether a speaker icon is present.
  * If present, click it: a popup opens with an empty or dummy output list. Press Esc. If absent, record the absence.
  * Open a terminal with Super+Enter and type `wpctl status | sed -n '/Audio/,/Video/p'`: empty `Sinks:` and `Sources:`.
  * Type `omarchy audio tuning status; omarchy audio tuning off; echo "exit=$?"`: `Installed: no` (or a no-tuning line) and a harmless message, no traceback.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: choosing a real output and per-app mixing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar (icon present/absent), the empty popup if it opens, empty wpctl sections, tuning output
  * If unsuccessful
  ** A shell crash on click, phantom devices, or a traceback from `omarchy audio tuning`
covers: manual/45:31, 45:35; bin/omarchy-audio-tuning (status/off); shell audio panel (overlap with 31)

### hibernation-setup-adds-menu-entry-and-remove   [VM-PARTIAL] [SLOW]
description: Hibernate is absent from the System menu until `omarchy-hibernation-setup` creates the swapfile and resume hooks, and `omarchy-hibernation-remove` takes it away again; the actual suspend-to-disk is skipped in the VM.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape: the System menu shows Screensaver, Lock, Suspend, Logout, Reboot, Shutdown and NO Hibernate. Press Esc.
  * Open a terminal with Super+Enter and type `omarchy-hibernation-remove`: `Hibernation is not set up`.
  * Type `omarchy-hibernation-setup`, password `prime`. At `Use 3.8Gi on boot drive to make hibernation available?` choose Yes. Expect `Creating Btrfs subvolume`, `Creating swapfile…`, `Adding swapfile to /etc/fstab`, `Adding resume hook…`, `Adding resume kernel parameters`, `Regenerating initramfs...` (1–2 min). At `Reboot to enable hibernation?` choose **No**.
  * Type `swapon --show; cat /etc/limine-entry-tool.d/resume.conf`: `/swap/swapfile` listed and `resume_offset=<number>` (not empty).
  * Press Super+Escape: `Hibernate` is now listed. Do NOT click it. Press Esc.
  * Type `omarchy-hibernation-setup`: `Hibernation is already set up`. Type `omarchy-hibernation-remove`, Yes: `Disabling swap…` … `Regenerating initramfs...`, `Hibernation removed`.
  * Press Super+Escape: no Hibernate — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Two UKI rebuilds ≈ 2–4 minutes; keep screenshots going.
  * Skipped: `systemctl hibernate` itself (it powers the guest off).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the System menu without, with, and again without Hibernate
  ** Screenshot of the setup output, swapon and a numeric resume_offset; "already set up"; the removal output
  * If unsuccessful
  ** "Hibernation is not supported on your system", "requires Limine bootloader", an empty `resume_offset=`, a mkinitcpio/limine error, or Hibernate not toggling
covers: bin/omarchy-hibernation-setup, -remove, -available; omarchy-menu.jsonc system.hibernate; manual/36 (overlap)

### crash-capture-notification-and-toggle   [VM-OK]
description: When a default agent is chosen, a crashing program raises a "Process crashed" toast offering an AI diagnosis; "Trigger → Toggle → Crash Capture" switches the watcher off and on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-default-agent; echo "[$?]"`: prints nothing on a stock disk. Type `sleep 300 & sleep 1; kill -SEGV $!` and wait 5 s: NO notification appears (no agent chosen). Type `coredumpctl list | tail -1`: a `sleep` SIGSEGV row.
  * Type `mkdir -p ~/.config/omarchy/defaults; echo claude > ~/.config/omarchy/defaults/agent` (choose an agent without installing one).
  * Type `sleep 300 & sleep 1; kill -SEGV $!`: within ~5 s a critical toast `Process crashed: sleep` / `Click to diagnose with AI` appears. Crash again immediately: no second toast (60 s dedupe).
  * Open the Omarchy Menu with Super+Space, click Trigger → Toggle → Crash Capture: toast `Crash capture disabled`. Wait 60 s (screenshotting), crash again: no toast.
  * Trigger → Toggle → Crash Capture again: `Crash capture enabled`. Crash again: the toast is back. Click it: a terminal/agent launch or an error about the missing agent — record it; a shell crash is a failure.
  * Type `rm ~/.config/omarchy/defaults/agent` — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Time the dedupe with `date +%s`; the window is 60 s per program name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of no toast without an agent, then `Process crashed: sleep` with the agent set
  ** Screenshots of `Crash capture disabled` / `enabled` toasts and the toast absent/present accordingly
  * If unsuccessful
  ** A toast without an agent, none with one (screenshot `journalctl --user -u omarchy-crash-watch | tail`), or the shell crashing on click
covers: bin/omarchy-crash-watch, -toggle-crash-capture, -agent-crash; omarchy-menu.jsonc trigger.toggle.crash-capture

### crash-mute-per-program   [VM-OK]
description: `omarchy crash mute` lists, silences and un-silences crash toasts for one program, and rejects a bad action or program name.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/defaults; echo claude > ~/.config/omarchy/defaults/agent; omarchy crash mute`: `No programs muted. Crashes all notify.`
  * Type `omarchy crash mute sleep`: `Muted crash notifications for sleep.` Type `omarchy crash mute`: lists `sleep`.
  * Type `sleep 300 & sleep 1; kill -SEGV $!` and wait 10 s: NO toast.
  * Type `omarchy crash mute sleep off`: `Crash notifications for sleep are back on.` Crash again: the `Process crashed: sleep` toast appears.
  * Type `omarchy crash mute sleep bogus; echo "exit=$?"`: `Not an action: bogus`, usage, `exit=1`. Type `omarchy crash mute /; echo "exit=$?"`: `Not a program name: /`, `exit=1`.
  * Type `rm ~/.config/omarchy/defaults/agent` — back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a toast for `sleep` fired in the last 60 s (dedupe), wait it out before the "back on" crash.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the list/mute/unmute messages, no toast while muted, the toast after unmuting, and both errors with exit=1
  * If unsuccessful
  ** A toast while muted, no toast after unmuting, or the bad action accepted
covers: bin/omarchy-crash-mute; bin/omarchy-crash-watch (crash-ignore flags)

### mac-hardware-fixes-absent-on-non-mac   [VM-OK]
description: The Mac chapter's automatic T2/Broadcom/SPI fixes apply only to Apple hardware; on this QEMU guest none of them may be present — the only Mac path the VM can check.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name`: `QEMU` / `Standard PC (Q35 …)`.
  * Type `pacman -Q linux-t2 t2fanrd apple-bcm-firmware; pacman -Q linux-omarchy`: the first three `was not found`, the last installed.
  * Type `lsmod | grep -cE 'applespi|apple_bce|brcmfmac'; uname -r`: `0` and a non-`t2` kernel.
  * Type `sudo grep -cE 'linux-t2' /boot/limine.conf` (password `prime`): `0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Observational; the interesting failure is a Mac-only package or module leaking into every install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the DMI vendor, not-found packages, `0` modules, kernel name, `0` t2 entries
  * If unsuccessful
  ** Any T2/Apple package, module or boot entry on the QEMU guest
covers: manual/44:37, 44:71; install/hardware/apple/*.sh; etc/limine-entry-tool.d/omarchy-defaults.conf BOOT_ORDER

### vm-guest-virtio-display-and-resolution-change   [VM-OK]
description: The manual says nothing about QEMU; this records what a virtio-vga guest gets — the display detected by Hyprland at auto scale and a live resolution change that applies and reverts cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `lspci -k | grep -A2 -i 'vga\|display'; hyprctl monitors | grep -E 'Monitor|scale'`: a Virtio GPU on `virtio-pci`, one monitor `Virtual-1`, `scale: 1.00`.
  * Type `hyprctl keyword monitor Virtual-1,1600x900@60,0x0,1`: the desktop re-lays out and the bar spans the new width. Screenshot. `hyprctl monitors | grep '@'` shows `1600x900`.
  * Type `hyprctl keyword monitor Virtual-1,12345x6789@60,0x0,1`: Hyprland refuses or falls back; the screen stays usable — record the message.
  * Type `hyprctl reload`: the preferred mode from monitors.lua returns; the desktop looks as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a mode change blanks the screen for more than 5 s, keep screenshotting and type `hyprctl reload<ENTER>` blind.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of lspci/hyprctl, the desktop at 1600x900, the refused bogus mode, and the restored desktop
  * If unsuccessful
  ** Hyprland crashing on a mode change, an unrecovered black screen, or no `Virtual-1`
covers: manual/49 (gap: no QEMU guidance); config/hypr/monitors.lua; manual/33 (overlap)

### vm-guest-laptop-only-entries-hidden   [VM-OK]
description: Laptop- and hardware-gated controls (lid, battery, touchpad, fingerprint, webcam, hibernate) are absent in this QEMU guest, and the detection helpers say why — the absence path for every hardware feature the VM lacks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar: no battery widget.
  * Open the Omarchy Menu with Super+Space, click Trigger → Hardware: no `Laptop Display`, `Mirror Display`, `Touchpad`, `Touchscreen`, `Hybrid GPU` (the submenu may be nearly empty).
  * Trigger → Toggle: no `Battery Percentage`. Trigger → Capture → Screen Record: no webcam variant. Setup → Security: no `Fingerprint`, but `Fido2`, `SSHD`, `Passwordless Sudo` present.
  * Press Super+Escape: no `Hibernate`. Press Esc.
  * Open a terminal with Super+Enter and type `for c in laptop fingerprint webcam touchpad touchscreen; do omarchy-hw-$c; echo "$c=$?"; done; ls /sys/class/power_supply/`: every `=1` and an empty power_supply listing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Guarded entries are removed, not greyed; compare against the menu's full list if unsure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each submenu with the gated entries absent and of the helper exit codes
  * If unsuccessful
  ** A laptop-only entry shown, a battery widget, or a helper returning 0
covers: manual/49 (VM expectations gap); bin/omarchy-hw-laptop and hw-*; omarchy-menu.jsonc `when` guards; manual/44 (absence path)

### limine-scan-on-single-os-finds-nothing   [VM-PARTIAL]
description: `limine-scan` (the dual-boot chapter's way to add Windows) runs harmlessly on a single-OS machine: it finds no foreign bootloader and leaves the boot menu as it was. Only that half is checkable here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo cp /boot/limine.conf /tmp/limine.before` (password `prime`).
  * Type `sudo limine-scan`. Read each prompt; it reports the EFI entries found (only Omarchy/Limine here) and either offers nothing or asks to add — answer No/quit to any add. Screenshot the output.
  * Type `sudo diff /tmp/limine.before /boot/limine.conf && echo UNCHANGED`: `UNCHANGED` (record any diff).
  * Reboot (Super+Escape → Reboot), press Down at Limine and screenshot: only the Omarchy entry (and Snapshots). Boot with `prime`; the desktop returns.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `limine-scan` is upstream limine-entry-tool; `FIND_BOOTLOADERS=yes` already adds foreign loaders on `limine-update`, so it may report entries as already present.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of limine-scan's output, `UNCHANGED`, and the Limine menu after reboot
  * If unsuccessful
  ** limine-scan erroring, altering limine.conf on No, or a broken boot menu
covers: manual/50:35-37; etc/limine-entry-tool.d/omarchy-defaults.conf FIND_BOOTLOADERS

### unattended-install-cidata-full   [VM-NO]
description: An ISO boot with a second drive labelled `cidata` carrying the wizard's files installs with nobody at the keyboard and reboots into the configured system; without the drive the normal wizard appears. Needs a ticket that boots the ISO with such a drive attached.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Only on a ticket that boots the ISO with a `cidata` drive holding `user_configuration.json` + `user_credentials.json`.) Watch the boot: the keyboard/user wizard must NOT appear; the install dashboard runs and the machine reboots by itself.
  * At the passphrase prompt type the `disk_encryption` password; the desktop appears autologged-in as the configured user.
  * Open a terminal with Super+Enter and type `whoami; hostname; timedatectl | grep 'Time zone'`: they match the JSON.
  * (Negative, separate ISO boot without the drive.) The `Select keyboard layout` wizard appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `./client get-serial` on the ISO boot shows whether `omarchy-cidata-load` found the drive.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the wizard-less install, the finished desktop, and the matching user/hostname/timezone; the wizard when the drive is absent
  * If unsuccessful
  ** The wizard despite a valid drive, dashboard errors, or wrong user/hostname
covers: manual/51:3-21, 51:33-56; manual/02:29; omarchy-iso omarchy-cidata-load, orchestrator phases

### unattended-install-defer-provisioning-marker   [VM-NO]
description: An empty `defer-provisioning` file instead of credentials yields a prepare-for-another-owner install whose first boot asks for keyboard and user; a drive with neither file falls back to the wizard. Needs the ISO.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (ISO ticket with `user_configuration.json` + empty `defer-provisioning`.) No wizard during install; the machine reboots.
  * First boot: no passphrase prompt (throwaway key), the console greeter `Press Return to Start Setup`, keyboard picker, username/password/hostname/timezone form, progress screen, then the desktop as the new user.
  * Reboot: the passphrase prompt now takes the password chosen in the form.
  * (Negative ISO ticket: `user_configuration.json` alone.) The normal wizard appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first-boot form is the same `omarchy-provision-owner` exercised by the factory-reset tests, which are runnable on the minted disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the wizard-less install, the first-boot greeter/form, the desktop, and the passphrase prompt accepting the new password
  * If unsuccessful
  ** A wizard during install, no first-boot form, or the install passphrase still unlocking
covers: manual/51:23; manual/02:25; bin/omarchy-apply-system --defer-provisioning; bin/omarchy-provision-owner; omarchy-iso omarchy-cidata-load

### unattended-install-authorized-keys-enables-sshd   [VM-NO]
description: With `authorized_keys` on the cidata drive the installed machine has the keys in place, sshd enabled and port 22 open (plain allow, not rate-limited). Needs the ISO.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (ISO ticket with `authorized_keys` on the cidata drive.) After the unattended install and passphrase, open a terminal with Super+Enter.
  * Type `cat ~/.ssh/authorized_keys; ls -l ~/.ssh/authorized_keys`: the keys, mode 600, owned by the user.
  * Type `systemctl is-enabled sshd; sudo ufw status | grep 22`: `enabled` and `22/tcp ALLOW IN` (note: `ALLOW`, not `LIMIT` as the interactive setup writes).
  * Type `sudo sshd -T | grep -i passwordauthentication`: `yes` — the unattended path does not disable password logins.
  * Type `ssh -o StrictHostKeyChecking=no <user>@localhost true` with the matching private key present, if one was included: succeeds.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On a stock (non-cidata) install sshd is `disabled`; that half is covered by `firewall-defaults-deny-incoming-localsend-open`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of authorized_keys with permissions, sshd enabled, the ufw 22 rule, and the sshd -T line
  * If unsuccessful
  ** sshd disabled, port closed, or keys missing/root-owned
covers: manual/51:27; omarchy-iso configure_ssh_access; bin/omarchy-provision-owner install_authorized_keys; Observations #19b

### unattended-install-tailscale-authkey-joins   [VM-NO] [NET]
description: With `tailscale_authkey` on the cidata drive the machine joins the tailnet on first boot, retrying until it has network, then deletes the key. Needs the ISO and a real auth key.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (ISO ticket with a reusable pre-authorized key in `tailscale_authkey`.) After first boot open a terminal with Super+Enter.
  * Type `systemctl status omarchy-tailscale-join.service; tailscale status`: the join succeeded and the machine is listed.
  * Type `sudo ufw status | grep tailscale0; ls /etc/tailscale/authkey`: `Anywhere on tailscale0 ALLOW IN` and the key file gone.
  * (Negative ticket with an invalid key.) `journalctl -u omarchy-tailscale-join.service | tail`: repeated retries every 15 s and the key file still present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The interactive `Install → Service → Tailscale` needs a browser login and is separately not runnable here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the join unit, `tailscale status`, the ufw rule, and the missing key file
  * If unsuccessful
  ** Join never succeeding with a valid key, key left behind, or the ufw rule missing
covers: manual/51:29; omarchy-iso configure_tailscale; bin/omarchy-install-service-tailscale (interactive counterpart)

### unattended-install-encrypted-needs-passphrase-at-first-boot   [VM-NO]
description: The manual's caveat: an encrypted unattended install still stops at the passphrase prompt on first boot, while an unencrypted one boots to the SDDM greeter without autologin. Needs the ISO.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (ISO ticket, `user_configuration.json` with a `disk_encryption` block and `user_encrypt_installation.txt` = `true`.) First boot stops at the Plymouth passphrase prompt; typing the JSON's password continues to an autologged-in desktop.
  * (ISO ticket, `user_encrypt_installation.txt` = `false`, no `disk_encryption`.) No passphrase prompt; the SDDM password greeter appears instead of autologin; the user password logs in.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The minted disk is encrypted, so it autologins after the passphrase — the same rule.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the passphrase prompt (encrypted) and the SDDM greeter (unencrypted)
  * If unsuccessful
  ** An encrypted install booting without a prompt, or an unencrypted one autologging in
covers: manual/51:59-61; manual/02:31-35; omarchy-iso configure_login

### install-free-space-dual-boot   [VM-NO]
description: The installer offers "Free space install" on a disk with unallocated space, keeps encryption by default, refuses BitLocker or too little space, and `limine-scan` adds the other OS afterwards. Needs the ISO and a pre-partitioned disk.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (ISO ticket, disk with an existing OS partition and ≥32 GB unallocated.) Complete the wizard; at disk selection the `Free space install` option is offered; select it; the confirmation says a new EFI partition is created in free space. Press Ctrl+C there once to see the unencrypted switch, then confirm encrypted.
  * After install and reboot, Limine is the bootloader; open a terminal with Super+Enter and type `sudo limine-scan`, follow the prompts to add the other loader; reboot and see both entries.
  * (Negative tickets.) <32 GB free → `Not enough free space on <disk>`; a BitLocker-protected partition → `Suspending BitLocker is not enough — the drive stays encrypted.`
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On the resumed single-OS VM only `limine-scan-on-single-os-finds-nothing` is runnable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Free space option, the confirmation, Limine with both entries after limine-scan, and both refusal messages
  * If unsuccessful
  ** A full-disk wipe when free-space was chosen, missing option, or BitLocker not detected
covers: manual/50; manual/02:3, 02:35; omarchy-iso configurator (free space, BitLocker, encryption Ctrl+C)

### install-prepare-for-another-owner-ctrl-c   [VM-NO]
description: Ctrl+C on the installer's keyboard screen offers "Prepare this machine for another owner?", skips the personal questions, and defers them to first boot. Needs the ISO (the first-boot half is covered by the factory-reset tests).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (ISO ticket.) On `Select keyboard layout` press Ctrl+C: `Prepare this machine for another owner?` with `Yes, prepare for another owner` / `No, keep setting up`. Choose No once — the picker returns. Ctrl+C again, choose Yes.
  * The user step is skipped; disk selection and install proceed; the machine reboots to the console greeter and first-boot form.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dimmed line `Press Ctrl+C to prepare this machine for another owner.` sits under the picker.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Ctrl+C confirm, No returning to the picker, the skipped user step, and the first-boot form
  * If unsuccessful
  ** Ctrl+C aborting the installer, the user step still asked, or first boot landing on SDDM with no user
covers: manual/02:25; omarchy-iso configurator:207-252; bin/omarchy-provision-owner

### update-creates-snapshot-before-packages   [VM-NO] [NET] [SLOW]
description: "Update → Omarchy" takes a Snapper snapshot before touching packages so a bad update can be rolled back from Limine. The download for a 4.0.2 disk is likely to exceed the ten-minute budget, so this is recorded rather than run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo snapper list` (password `prime`); note the rows.
  * Open the Omarchy Menu with Super+Space, click Update → Omarchy. At `Ready to update?` ("You cannot stop the update once you start!") choose Yes.
  * The first lines after confirmation are the cache prune, then `Create system snapshot` and `Snapshots can be selected during boot.` — before any pacman download output.
  * Let the update finish (10–30 min); accept the reboot prompt; after reboot type `sudo snapper list; omarchy-version`: the pre-update snapshot carries the *old* version as description.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never Ctrl+C once started. If the session budget ends mid-update, the disk is discarded anyway.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "Create system snapshot" before package downloads; the post-reboot snapper list with the old version
  * If unsuccessful
  ** "No Snapper configs found" / "Continuing the update without a snapshot." or package output preceding the snapshot step
covers: manual/47:3; bin/omarchy-update:30-38; docs/update-process.md

### tailscale-install-service-interactive   [VM-NO] [NET]
description: "Install → Service → Tailscale" installs the mesh VPN, logs in through the browser, and adds a bar widget and web app; removal reverses it. Needs a Tailscale account.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Account required.) Open the Omarchy Menu with Super+Space, click Install → Service → Tailscale, password `prime`. The terminal prints `Installing Tailscale...`, `Starting Tailscale...` and a login URL; open it in Chromium and authenticate.
  * Back in the terminal: `Allowing prime to manage Tailscale...`, `Receiving Taildrop files…`, `Adding Tailscale to the bar...`, the web app install, "Done!".
  * Type `tailscale status` in a terminal: the node is listed; the bar shows a Tailscale widget; the launcher has a `Tailscale` web app.
  * Remove → Service → Tailscale reverses it; the widget and web app disappear.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Without an account `tailscale up` blocks on the URL; press Ctrl+C there and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each install line, `tailscale status`, the bar widget, the web app, and the clean removal
  * If unsuccessful
  ** `tailscale up` failing, no bar widget, or removal leaving the service enabled
covers: bin/omarchy-install-service-tailscale; bin/omarchy-remove-service-tailscale; manual/51:29 (interactive counterpart)

### omarchy-reinstall-full   [VM-NO] [NET] [SLOW]
description: The troubleshooting last resort — `omarchy-reinstall` reinstalls every base package from the stable mirrors and resets user configs, then reboots. Downloads are large and unbounded; recorded, not run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '# my tweak' >> ~/.config/hypr/bindings.lua` so the reset is visible.
  * Type `omarchy-reinstall`, choose Yes, password `prime`. Watch the stable-mirror refresh, `pacman -Suu`, the base-package install, `Resetting Omarchy user configs to shipped defaults...`, then `System has been reinstalled. Reboot?` → Yes.
  * After reboot (passphrase `prime`) type `grep -c 'my tweak' ~/.config/hypr/bindings.lua`: `0`. The Limine menu is intact.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Expect 10+ minutes of downloads; the cancel path is `omarchy-reinstall-cancel-leaves-system-untouched`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the phases, the reboot prompt, and the tweak gone after reboot
  * If unsuccessful
  ** pacman conflicts, `omarchy-refresh-limine` errors, or the tweak surviving
covers: manual/45:5; bin/omarchy-reinstall, -reinstall-pkgs, -reinstall-configs

### mac-install-and-known-limitations   [VM-NO]
description: The Intel Mac install path (Secure Boot off, Option-boot, automatic Broadcom/SPI/NVMe/T2 fixes) and the documented T1/T2 limitations. Requires Apple hardware.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Intel Mac only.) Follow manual/44: disable Secure Boot in recovery, Option-boot the USB, install.
  * After first boot open a terminal with Super+Enter. T2 models: `pacman -Q linux-t2 t2fanrd; uname -r` show the T2 kernel, and Wi-Fi, Bluetooth, audio and Touch Bar work. T1 models: Touch Bar and sound absent (documented). All: keyboard works (SPI) and suspend/resume works (NVMe fix).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-hw-match` predicates in `install/hardware/apple/*.sh` decide which fixes apply.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Photos/screenshots of the recovery settings, the EFI Boot pick, and the post-install package/kernel checks
  * If unsuccessful
  ** Missing Wi-Fi/keyboard, wrong kernel on T2, or Limine not preferring linux-t2
covers: manual/44; install/hardware/apple/*.sh; etc/limine-entry-tool.d/omarchy-defaults.conf BOOT_ORDER

### onepassword-prompts-need-hardware-acceleration   [VM-NO] [NET]
description: 1Password's SSH-agent/CLI approval prompts require "Use Hardware Acceleration" (plus a reboot) and 1Password launched once. Needs the AUR install, an account, and GPU acceleration the VM lacks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Account and hardware required.) Install via Super+Space → Install → Service → 1Password; sign in; enable the SSH agent.
  * With hardware acceleration off, open a terminal and type `ssh-add -L`: no approval prompt. Turn the setting on, reboot, launch 1Password once, repeat: the approval prompt appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * virtio-vga without virgl has no GPU acceleration, so the "on" state cannot be reached here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the setting, the reboot, and the prompt appearing
  * If unsuccessful
  ** No prompt with the setting on after a reboot and 1Password running
covers: manual/45:43-49; bin/omarchy-install-service-1password

### apple-studio-display-peripherals   [VM-NO]
description: Apple Studio/XDR display speakers and webcam need the recommended DP+USB-A→USB-C cable, and brightness keys drive the display. Requires the display.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Hardware only.) Connect the display with the recommended cable; open a terminal and type `wpctl status; v4l2-ctl --list-devices`: the display's speakers and webcam are listed.
  * Press the keyboard brightness keys: the display brightness OSD appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nothing here is runnable in the VM (no audio, webcam or backlight devices, and the driver cannot send brightness keys).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the devices listed and the brightness OSD
  * If unsuccessful
  ** Devices missing with the recommended cable
covers: manual/46:69-71

## Gaps

- **Mac support (manual/44) is untestable here** beyond the absence path (`mac-hardware-fixes-absent-on-non-mac`); every positive claim (Secure Boot steps, T2 kernel, Touch Bar, Broadcom Wi-Fi) needs Apple hardware.
- **Unattended installs and dual boot (manual/50, 51, 02 install sections) need the ISO** and extra drives; the loader and orchestrator live in the `omarchy-iso` repo, not in this tree (`install/**` here only carries the target-side `--defer-provisioning` flag and the provisioning units). Seven `VM-NO` definitions above document the exact prompts/files for an ISO-capable runner. The first-boot half (`omarchy-provision-owner`) *is* covered via the factory-reset tests.
- **Full `omarchy-update` and `omarchy-reinstall`** are network-bound and likely exceed the session budget on a 4.0.2 disk; only their cancel paths and the snapshot-first ordering are proposed as runnable. If the harness ever allows a 30-minute session, `update-creates-snapshot-before-packages` becomes `VM-OK`.
- **Actual hibernate/resume** cannot be exercised (powers the guest off; the harness resumes from a disk image, not from the S4 image). Setup/remove and the menu gating are covered.
- **Snapshot "backup" entry after a restore** — the restore tool (upstream) adds a backup boot entry; its wording is not in this repo, so the proof only asks the driver to capture it rather than assert exact text.
- **`limine-snapper-restore --notify` autostart under uwsm** — relies on uwsm honouring XDG autostart (`limine-restore-notify.desktop`). The repo neither ships nor hides this file; if the notification never appears the test distinguishes autostart failure from not-in-snapshot, but a fix would live outside this repo.
- **Upload path of `omarchy-debug`** is gated on `ping 8.8.8.8`, which fails under QEMU user-mode NAT even though HTTPS works — so the manual's "use omarchy-debug to share" cannot be completed in the VM (a curl-based reachability check would make it work; noted as a possible code improvement).
- **Manual/49 "Omarchy on…"** has no assertions about VMs at all (nothing on virtio, resolution, clipboard, 3D). The two `vm-guest-*` tests record the actual QEMU behaviour so a future chapter can be checked against them; clipboard *sharing with the host* is absent by design (no spice-vdagent/qemu-guest-agent in the package list) and is not an Omarchy claim.
- **1Password, Spotify (Ctrl+Minus), Apple Studio Display, Tailscale interactive** need accounts/hardware/browser auth — recorded as `VM-NO`.
- **`omarchy-drive-info` / `omarchy-drive-select`** are internal plumbing (the picker is only reached with two or more LUKS drives; the VM has one) — no user story here, left to reviewer 24.
- **Volume popup output selection** (manual/45:31) has no device to select; only the empty state is testable.
- **Print discovery** (USB/network printers) has nothing to discover in the VM; only CUPS running, the Add dialog, IPP option and print-to-PDF are covered.
- **`omarchy-snapshot create` on a system without snapper configs** ("No Snapper configs found…") cannot be provoked without deleting `/etc/snapper/configs/root` and `/etc/conf.d/snapper`; deliberately not proposed because it breaks `limine-snapper-sync` for the rest of the session — could be a follow-up destructive test on its own disk.
- **Root login after a factory reset** — `-finish` and `provision-owner` leave root locked (`!`) until setup completes; the "drop to console" branch is only reachable by making setup fail, which no proposed test does.
- **Code-vs-manual disagreements to hand to the docs owners** (also in Observations #19): lockout numbers unstated (45:39); unattended SSH opens 22 with `allow` not `limit` (51:27 vs 48:6); `omarchy-snapshot <unknown>` exits 0 silently; GDK_SCALE "restart the app" may need a config reload/re-login (45:9); `sshd` is started and the port opened before a `--key` is validated (48:6 "ssh is off until you turn it on" — a failed run leaves it on).
