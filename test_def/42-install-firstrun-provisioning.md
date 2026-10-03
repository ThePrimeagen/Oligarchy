# 42 — Install, first-run, provisioning (omarchy `install/**`, `bin/omarchy-provision-*`, `bin/omarchy-setup-*`, factory reset; omarchy-iso)

## Scope

Read completely (omarchy @ HEAD 2026-09-18, `/tmp/omarchy-review/omarchy`):

- `install/**` — 85 files / 1,871 lines: `config/*.sh` (12), `hardware/**` (37), `helpers/*.sh` (3),
  `login/*.sh` (2), `post-install/*.sh` (4), `provisioning/*` (3: `setup-form.sh` 183 l,
  `omarchy-provision-owner.service`, `omarchy-system-factory-reset-finish.service`), `user/**` (22 incl.
  `first-run/*` 10 and `hardware/**` 5), `omarchy-base.packages` (153 l / 149 pkgs),
  `omarchy-other.packages` (75 l / 66 pkgs).
- `agents/skills/install-scripts.md` (20), `docs/file-layout.md` (369).
- `bin/omarchy-provision-owner` (1139), `bin/omarchy-provision-user` (131), `bin/omarchy-provision-first-run` (99).
- `bin/omarchy-setup-direct-boot` (61), `bin/omarchy-setup-security-fido2` (148),
  `bin/omarchy-setup-security-fingerprint` (111), `bin/omarchy-setup-security-sshd` (212),
  `bin/omarchy-setup-security-sudoless-docker` (49).
- `bin/omarchy-system-factory-reset` (452), `bin/omarchy-done` (40).
- `manual/02-getting-started.md` (39), `manual/50-dual-boot-install.md` (44), `manual/51-unattended-installs.md` (61),
  `manual/49-omarchy-on.md` (29).
- Read for context because the in-scope scripts depend on them (not inventoried as their own area):
  `bin/omarchy-apply-system` (102), `bin/omarchy-apply-hardware` (76), `bin/omarchy-system-factory-reset-finish` (169),
  `bin/omarchy-drive-password` (32), `bin/omarchy-remove-security-sshd`, `bin/omarchy-remove-security-sudoless-docker`,
  `bin/omarchy-hook`, `bin/omarchy-hook-install`, `bin/omarchy-sudo-docker`, `bin/omarchy-hw-*` (detection helpers),
  `default/limine/{default,limine}.conf`, `etc/limine-entry-tool.d/*.conf`, `etc/mkinitcpio.conf.d/omarchy_hooks.conf`,
  `etc/plymouth/plymouthd.conf`, `etc/sddm.conf.d/*`, `etc/sudoers.d/*`, `default/hypr/autostart.lua`,
  `default/omarchy/omarchy-menu.jsonc` (Setup/Update entries only).
- Skimmed `test/shell.d/`: `first-run-test.sh`, `provision-user-test.sh`, `provisioning-groups-test.sh`,
  `setup-form-test.sh`, `setup-security-sshd-test.sh`, `factory-reset-accounts-test.sh`, `installed-service-test.sh`,
  `retired-installer-artifacts-migration-test.sh` (first 120 l), `preinstalls-test.sh`, `manifest-entrypoints-test.sh`,
  `git-url-check-test.sh`, `drive-password-test.sh`.

Read completely (omarchy-iso @ HEAD, `/tmp/omarchy-review/omarchy-iso`, 81 files / 26,115 lines):

- `README.md` (145); `bin/*` (11: `omarchy-iso-boot`, `omarchy-iso-configurator`, `omarchy-iso-installer`,
  `omarchy-iso-make`, `omarchy-iso-rclone-config`, `omarchy-iso-release`, `omarchy-iso-sign`, `omarchy-iso-test` 1136,
  `omarchy-iso-test-stop`, `omarchy-iso-test-windows-disk`, `omarchy-iso-upload`, `omarchy-vm`);
  `builder/*` (5); `configs/**` (all: `airootfs/root/configurator` 1254, `.automated_script.sh` 131,
  `usr/local/bin/*` 5, `usr/share/omarchy-iso/disk-partitioning.sh` 131, `orchestrator/*.py` 8 files 2,827 l,
  grub/syslinux/efiboot configs, `pacman-*.conf`, `profiledef.sh`, mkinitcpio/modprobe/plymouth drop-ins,
  `omarchy-root-shell.hook`); `plans/*` (2, skimmed headers); `test/all`, `test/integration`,
  `test/integration.d/*` (2, in full), `test/unit/*` (11, test names only); `.github/workflows/nightly-build.yml`.
- `manifests/fresh-4.json` / `fresh-4-semantic.json` (13,127 l of acceptance-manifest JSON) — skimmed the first
  50 lines only; they are the acceptance suite's expected-state dump, not behaviour.
- `bin/omarchy-iso-installer` (142) is a stale name in the listing; the live entry is `configs/airootfs/usr/local/bin/omarchy-iso-install`.

Not reviewed: anything the desktop does after login that is another reviewer's (menu, bar, lock, update,
migrations). `omarchy-sudo-passwordless` (menu Setup → Security → Passwordless Sudo) is not one of the five
`omarchy-setup-*` and is left to reviewer 24.

## Inventory

#### ISO boot menu and live environment (omarchy-iso `configs/`)

- UEFI GRUB menu (`configs/grub/grub.cfg`, `loopback.cfg`): `timeout=0`, `timeout_style=hidden` — no menu is shown
  by default. Entries: `Omarchy (x86_64, x64 UEFI)` (default, id `archlinux`), `Omarchy with speakup screen reader`
  (hotkey `s`, `accessibility=on`), `Run Memtest86+ (RAM test)`, `UEFI Shell`, `UEFI Firmware Settings` (`fwsetup`),
  `System shutdown`, `System restart`. Kernel: `vmlinuz-linux-t2`, cmdline `quiet splash xe.enable_panel_replay=0 initramfs_async=0`.
- systemd-boot fallback entry `configs/efiboot/loader/entries/01-archiso-x86_64-linux.conf`, same kernel/options.
- BIOS syslinux menu (`configs/syslinux/*.cfg`): `MENU TITLE Omarchy`, `TIMEOUT 150` (15 s, menu visible):
  `Omarchy install medium (x86_64, BIOS)`, `… with ^speech`, `Boot existing OS` (chain hd0 0), `Run Memtest86+`,
  `Hardware Information (HDT)`, `Reboot`, `Power Off`. Serial console on `SERIAL 0 115200`.
- Live ISO boots `linux-t2` for every machine (`builder/build-iso.sh`, `configs/airootfs/etc/mkinitcpio.d/linux-t2.preset`);
  stock `linux` and `broadcom-wl` are stripped from the live root.
- Live plymouth: `configs/airootfs/etc/plymouth/plymouthd.conf` `Theme=omarchy`, `ShowDelay=0`; mkinitcpio hooks include
  `plymouth` (`archiso.conf`).
- Live modprobe blacklists: `applesmc` (pre-T2 Macs oops), Panther Lake SOF audio modules (`blacklist-panther-lake-audio.conf`).
- Live root shell mirrors `/etc/skel` bashrc/starship into `/root` (`omarchy-root-shell.hook`, build-time only).
- Live pacman: `pacman-offline.conf` — `[offline] SigLevel = Never`, `Server = file:///var/cache/omarchy/mirror/offline/`;
  the whole install is offline; no network is needed for any phase.
- `/root/.automated_script.sh` (tty1 only): exports `OMARCHY_MIRROR` (`/root/omarchy_mirror`), `OMARCHY_ISO_REF`,
  package targets (`/usr/share/omarchy-iso/package-targets`), `OMARCHY_PATH=/usr/share/omarchy`,
  `OMARCHY_INSTALL_LOG_FILE=/var/log/omarchy-install.log`, `OMARCHY_INSTALL_DEBUG=1` when
  `/usr/share/omarchy-iso/install-debug` exists (debug builds print `=== Omarchy ISO debug build ===` + build-info first).
- `.automated_script.sh`: sets the Tokyo Night VT palette, tees stdout (CSI-stripped) into the install log, warms the
  offline mirror into page cache in the background (`OMARCHY_NO_PREFETCH=1` disables), then runs
  `omarchy-cidata-load` → on success skips the wizard (`OMARCHY_UI_INTERACTIVE=no`), else runs `./configurator`.
- `.automated_script.sh`: `OMARCHY_UI_DEFER_PROVISIONING=yes` when `/root/defer-provisioning` exists or
  `.omarchy_install.defer_provisioning == true` in `user_configuration.json`.
- `.automated_script.sh`: hands the install to `omarchy-install-dashboard <log> /run/omarchy-install/state.json -- omarchy-iso-install --config … --creds … --full-name-file … --email-file … --encrypt-file … --authorized-keys-file /root/authorized_keys --tailscale-authkey-file /root/tailscale_authkey --defer-provisioning-file /root/defer-provisioning`.
- Abort path of the wizard prints `Aborted installation` + `You can retry later by running: ./.automated_script.sh` and
  exits 1 to the live root shell on tty1 (`configurator` `abort()`).

#### Configurator wizard — every screen and its validation (`configs/airootfs/root/configurator` + `install/provisioning/setup-form.sh`)

- `wait_for_stable_terminal`: first draw is held up to 5 s until the VT is ≥ 81 columns (logo width) so the logo is not
  smushed on the transient 80-col console.
- Greeter: logo (ttfx `colorshift` animation, indexed colours), tagline `Beautiful, Fun & Agentic Linux by DHH`, hint
  `Press Return to Start Install`. Return starts; anything else typed is swallowed.
- Step 1 keyboard: header `Let's setup your machine...`, grey hint `Press Ctrl+C to prepare this machine for another owner.`,
  `gum choose --height 10 --selected "English (US)" --header "Select keyboard layout"` over 49 layouts (English (US),
  English (UK), Dvorak, Colemak lead; then alphabetical Azerbaijani … Ukrainian; `OMARCHY_KEYBOARD_LAYOUTS`).
  Esc re-asks (nothing precedes it). `loadkeys <keymap>` applied live on a VT so the password is typed under the chosen layout.
- Step 1 Ctrl+C → `Prepare this machine for another owner?` (`This prepares the machine for another owner.` /
  `The system installs now, but setup is delayed until first boot.`), buttons `Yes, prepare for another owner` /
  `No, keep setting up`. Yes arms `defer_provisioning`; No returns to the keyboard picker.
- Step 2 user (`user_form`), header `Let's setup your user account...`:
  - `Username>` placeholder `Alphanumeric without spaces (like dhh)`; pattern `^[a-z_][a-z0-9_-]*[$]?$`; reserved names
    `root bin daemon mail ftp http nobody dbus systemd-* tss uuidd alpm git avahi cups cups-browsed lp _talkd polkitd rtkit qemu brltty gluster rpc libvirt-qemu pcscd nvidia-persistenced sddm`.
    Notices (1 s spinner): `Username must be alphanumeric with no spaces`, `Username is reserved for system`;
    first boot only: `That username already exists on this machine` (installer targets are empty so that check is a no-op there).
  - `Password>` (masked) placeholder `Used for user + root, and disk encryption when enabled`; `Confirm>` placeholder
    `Must match the password you just typed`. Notices: `Passwords didn't match!`, `Your password can't be blank!`.
    **No length or strength rule** — a single character is accepted. Hash: `openssl passwd -6`.
  - `Full name>` / `Email address>` placeholder `Used for git authentication (hit return to skip)`; empty is an answer.
  - `Hostname>` placeholder `Letters, digits, and dashes (or return for 'omarchy')`; pattern
    `^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`; notice `Hostname must be 1-63 letters, digits, or dashes, and cannot start or end with a dash`; empty → `omarchy`.
  - Timezone: `tzupdate -p` geo-guess (network) → `gum choose --height 10 --selected <guess> --header Timezone`; no guess →
    `gum filter --height 10 --header Timezone` (type to filter); empty selection → `UTC`.
  - Review table `Field,Value` (Username, Password as `*`, Full name/Email or `[Skipped]`, Hostname, Timezone, Keyboard) then
    `Does this look right?` `Yes` / `No, change it`. `No` → back to Step 1 keyboard and the whole form is re-entered blank.
  - Esc on any user prompt → status 1 → unwinds to the keyboard step. Ctrl+C in the user step → `abort` (install ends).
- Step 3 disk (`disk_form`) header `Let's select where to install Omarchy...`; `gum choose --header "Select install disk"`
  over `/dev/(sd|hd|vd|nvme|mmcblk|xv)*` disks minus the boot medium's parent disk; each line
  `/dev/vda (40G) - <vendor model> [fstype(mount), …]`. Esc → abort.
- Step 4 install mode (`install_mode_form`) header `Let's select how to install Omarchy...`,
  `Select installation mode on /dev/vda`: `Full disk install`, `Free space install (alongside existing data)`
  (only when UEFI **and** the disk has a partition table with unallocated space), `Choose a different disk`.
  A blank/unpartitioned disk skips this picker entirely.
- Overwrite confirm (`confirm_disk_overwrite`): `Everything will be overwritten. There is no recovery possible.`, grey hint
  `Press Ctrl+C for unencrypted install.`, buttons `Yes, install` / `No, change it`, prompt `Confirm overwriting /dev/vda`.
  Ctrl+C toggles the affirmative to `Yes, install without encryption` (and back). `No` → back to the mode picker, or to
  the disk picker when the picker was skipped.
- Free-space path (`run_partition_decide`): `Checking for BitLocker on <disk>` → `BitLocker signature detected on <part>.`
  + `Turn BitLocker off in Windows …` + abort `Aborted: BitLocker is enabled on this disk.`;
  `Checking existing EFI partitions on <disk>` → `Found a Windows ESP at <part> — leaving it untouched.` /
  `A new EFI partition will be created in free space.`; `Analyzing free space on <disk>`; largest free region;
  needs ≥ 32 GiB (`not_enough_space`: `Not enough free space on <disk>`, `<disk> has X.XGB of usable free space; Omarchy needs at least 32GB.`,
  buttons `Back` / `Open partition tool` → `open_partition_tool` → `Open cfdisk` / `Back` → `cfdisk <disk>`).
  Confirm `Install Omarchy in the X.XGB of free space.` with the same Ctrl+C encryption toggle; `No, change it` → mode picker.
- Free-space execute (`run_partition_execute`): GPT `mklabel` when unlabeled; `create_partition` reads back the number parted
  assigned (never predicted; `disk-partitioning.sh`); 2 GiB `OMARCHY_EFI` fat32 + rest `OMARCHY_ROOT` btrfs; `wipefs -af`;
  LUKS2 `luksFormat --batch-mode` + `cryptsetup open … omarchy_root`; `mkfs.btrfs -L OMARCHY`; subvolumes `@ @home @log @pkg`;
  mounted at `/mnt` with `noatime,compress=zstd`; ESP mounted at **`/boot` when encrypted, `/efi` when unencrypted**;
  `disk_abort_hook` rolls back only the partitions this run created. Writes a `pre_mounted_config` JSON with
  `omarchy_install.mode: protected`, `storage.{esp_device,root_device,root_mapper,luks_uuid,kernel}`, `enable_fallback: false`.
- Full-disk path: 1 MiB gap, 2 GiB ESP at `/boot` (`boot`,`esp` flags), rest btrfs (`@ / , @home /home, @log /var/log, @pkg /var/cache/pacman/pkg`,
  `compress=zstd`), `wipe: true`; `disk_encryption {luks, iter_time 2000, encryption_password}` when encrypted;
  `omarchy_install.mode: full_disk`, `defer_provisioning: <bool>`, `enable_fallback: true`.
- Kernel choice (`detect_kernel`): `linux-t2` when PCI `106b:1801/1802` (T2 Mac) else `linux-omarchy`.
- Common JSON: `hostname`, `timezone`, `locale_config.kb_layout`, `sys_lang en_US.UTF-8`, `ntp: true`, `swap: true` (zram),
  `bootloader Limine`, mirrors `mirror.omarchy.org` + rackspace + geo.mirror.pkgbuild.com (for the installed system),
  `packages: base-devel git omarchy-keyring omarchy-settings omarchy`, `audio pipewire`, `version 3.0.9`.
- Deferred provisioning (Ctrl+C on keyboard): `keyboard=us`, no user/password, `hostname=omarchy`, `timezone=UTC`,
  `user_credentials.json {"users": []}`, `disk_form` + `confirm_disk_overwrite` loop; always full-disk; encrypted by
  default with a generated throwaway passphrase (`secrets.token_urlsafe(24)` in `context.py`); no celebration screen; auto reboot.
- Output files (also the unattended-config format): `user_configuration.json`, `user_credentials.json`
  (`root_enc_password`, `users[{enc_password, groups: [], sudo: true, username}]`, `encryption_password` when encrypted),
  `user_full_name.txt`, `user_email_address.txt`, `user_encrypt_installation.txt` (`true`/`false`).
- Dry run: `bin/omarchy-iso-configurator` runs `configurator dry` against a local checkout and prints the files.

#### Install dashboard (`configs/airootfs/usr/local/bin/omarchy-install-dashboard`)

- Progress screen: centred logo, `Installing Omarchy`, 34-cell `█░` bar (per-mille, monotonic, package-count driven
  during `Installing Arch + Omarchy` using `/usr/share/omarchy-iso/expected-packages`), rotating `Tip:` every 8 s (18 tips).
- Phases and bar bands: Starting installation, Preparing live environment, Preparing install target,
  Installing Arch + Omarchy (65–70 %), Configuring hibernation, Configuring system, Staging provisioning,
  Finalizing Limine boot, Finalizing user, Configuring login, Configuring SSH access, Configuring Tailscale,
  Configuring DNS resolver, Validating boot setup, Creating factory snapshot.
- Finish screen: logo + `Installed Omarchy in Xm Ys` (from `state.json` started/finished) + ttfx `laseretch` (≤ 8 s) +
  `gum confirm` with a single `Reboot Now` button (default). Non-interactive (cidata) → reboots without asking;
  `OMARCHY_UI_AUTO_REBOOT=no` stops on the finish screen. Deferred-provisioning installs clear the screen and reboot silently.
- Failure screen: `Omarchy installation stopped`, `Installer exited with status N`, optional media diagnosis
  (`The install medium is damaged` / `… was misread` / `… damaged or misread` + package name + remedy, from
  `omarchy-install-diagnose-media`), `last installer phase: …`, `failed phase: <name>: <error>`, `Last log lines:` /
  `Last target log lines:` tail, `Get help at https://omarchy.org/discord`, menu `What would you like to do?`:
  `Upload log for support` (when `omarchy-upload-log` exists), `View full log` (`less`), `Drop to shell`, `Reboot`, `Power off`.
  Esc/cancel → `Drop to shell`. Non-interactive → exits with the installer's status. `OMARCHY_UI_FAILURE_ACTION=exit` skips the menu.
- Child output is CSI-stripped and archinstall's own banner lines are filtered out of the support log.

#### Orchestrator phases (`orchestrator/main.py`, `phases.py`, `phases_impl.py`, `context.py`, `keyboard.py`, `archinstall_adapter.py`, `command.py`)

- `InstallContext.from_env`: requires `OMARCHY_INSTALL_CONFIG` + `OMARCHY_INSTALL_CREDS`; defaults `kernels` from PCI
  (T2 → `linux-t2`); deferred provisioning from `omarchy_install.defer_provisioning` or the `defer-provisioning` marker;
  a missing credentials file is fatal unless deferred; deferred strips every account field (`users`, `root_enc_password`,
  `!users`, `!root-password`) and keeps only `encryption_password`; injects a throwaway LUKS passphrase into
  `disk_encryption` and writes `/run/omarchy-install/provisioning-user_credentials.json` (0600).
- `mode` = `omarchy_install.mode` or `protected` when `disk_config.config_type == pre_mounted_config`.
- `prepare_live`: `omarchy-iso-cleanup-disk <disk>` (umount/swapoff/vgchange/cryptsetup close on the target) unless protected;
  loads archinstall config; offline mirror handler. Does **not** wait for `pacman-init` keyring.
- `prepare_install_target`: protected mode verifies `esp_device`/`root_device` exist, `/mnt` is a mountpoint, remounts ESP if needed.
- `arch_install_system`: `perform_filesystem_operations` (3 retries on the parted/udev "unable to inform the kernel" race,
  countdown suppressed) → `Installer` context → `sanity_check(offline, skip_ntp, skip_wkd)` → `generate_key_files` (encrypted) →
  mirrors → bind-mount offline mirror onto `<target>/var/cache/pacman/pkg` → mask live boot hooks
  (`60-mkinitcpio-remove`, `60-limine-mkinitcpio-remove-pre`, `80-limine-efi-deploy`, `90-limine-mkinitcpio-remove-post`,
  `90-mkinitcpio-install`) → `minimal_installation(mkinitcpio=False, kb_layout="")` → `<kernel>-headers` →
  `configure_keyboard` (`systemd-firstboot --root --keymap`, preserves `FONT=`; unknown keymap → warning, default kept) →
  zram swap (`setup_swap`, then removes archinstall's `/etc/systemd/zram-generator.conf` so omarchy-settings' drop-in wins) →
  early packages (`base-devel git limine efibootmgr omarchy-keyring omarchy-settings`, then `lua51 luarocks`, then `omarchy-nvim`) →
  Limine install (EFI: copy `BOOTX64.EFI` → `/boot/EFI/limine/limine_x64.efi`, pacman hook `99-omarchy-limine.hook`,
  `efibootmgr --create --label Limine`, stale `Limine` entries deleted, new entry first in BootOrder; BIOS: `limine bios-install`) →
  `/etc/default/limine` (`ESP_PATH`, `KERNEL_CMDLINE[default]+=<cmdline>`), `/etc/kernel/cmdline`, `/boot/limine.conf` from
  template → `create_users` (with `/etc/skel` populated) → archinstall applications (pipewire) → Omarchy runtime +
  `omarchy-base.packages` (minus early ones) → `tailscale` when an auth key is staged → unmask/unmount → timezone,
  `activate_time_synchronization`, root password, `genfstab` (or hand-written fstab + `crypttab.initramfs` for protected).
- Protected cmdline: `cryptdevice=UUID=<luks>:omarchy_root root=/dev/mapper/omarchy_root zswap.enabled=0 rootflags=subvol=@ rw rootfstype=btrfs`
  (unencrypted: `root=UUID=<btrfs> …`). Full-disk cmdline comes from archinstall's `_get_kernel_params` (`cryptdevice=PARTUUID=…`).
- `configure_hibernation`: `arch-chroot … omarchy-hibernation-setup --force --no-rebuild` (swapfile in `/swap`, resume drop-ins).
- `run_system_finalizer`: `arch-chroot … omarchy-apply-system --install-user <user> --first-install`
  (or `--defer-provisioning --first-install`), with `90-mkinitcpio-install.hook` masked inside the target; env
  `OMARCHY_USER_NAME/EMAIL`, `OMARCHY_MIRROR`, `OMARCHY_LOG_TO_STDOUT=1`; log bind-mounted to `/mnt/var/log/omarchy-install.log`.
- `stage_provisioning_state`: every install copies `/opt/packages/node-v*-linux-x64.tar.gz` → `/var/lib/omarchy/provisioning/packages/`
  (fatal if the ISO has none); deferred additionally `touch pending`, installs + enables `omarchy-provision-owner.service`
  into `/etc/systemd/system` (`multi-user.target.wants`), and on encrypted targets writes `luks-key` (0600),
  `/etc/omarchy/provisioning.key`, `/etc/limine-entry-tool.d/99-omarchy-provisioning-unlock.conf`
  (`cryptkey=rootfs:/etc/omarchy/provisioning.key`), `/etc/mkinitcpio.conf.d/99-omarchy-provisioning-key.conf` (`FILES+=`).
  Pre-encrypted protected target + deferred without `encryption_password` → fatal.
- `finalize_limine_boot`: asserts `/etc/default/limine` has no `@@CMDLINE@@`, cmdline has `root=`, `ESP_PATH` dir exists,
  `/etc/snapper/configs/root` exists, `limine.conf` exists → `arch-chroot limine-update` → `btrfs quota disable /` →
  asserts `Omarchy` entry and `cryptdevice=` (encrypted) in `limine.conf`.
- `run_chroot_finalizer`: `arch-chroot -u <user> … omarchy-provision-user --force --first-install` (skipped when deferred).
- `configure_dns_resolver`: `/etc/resolv.conf → ../run/systemd/resolve/stub-resolv.conf`.
- `configure_login`: `/etc/sddm.conf.d/99-omarchy-login.conf` (`[Theme] Current=omarchy`, `[Users] RememberLastUser/Session=true`);
  `/etc/sddm.conf.d/autologin.conf` (`[Autologin] User=<user> Session=omarchy.desktop`) **only when encrypted and not deferred**;
  `/var/lib/sddm/state.conf` `[Last] Session=omarchy.desktop User=<user>` (chown sddm); removes any `getty@tty1` autologin;
  `systemctl enable sddm`.
- `configure_ssh_access` (only with `authorized_keys`): keys → `/home/<user>/.ssh/authorized_keys` (0600, chown) or, deferred,
  staged at `/var/lib/omarchy/provisioning/authorized_keys`; `systemctl enable sshd`; `ufw allow ssh` (must land in
  `/etc/ufw/user.rules` as `--dport 22 -j ACCEPT` or the phase fails); empty/comment-only file → phase fails.
- `configure_tailscale` (only with `tailscale_authkey`): exactly one key → `/etc/tailscale/authkey` (0600, dir 0700);
  `omarchy-tailscale-join.service` (Type=simple retry loop `tailscale up --auth-key file:…`, deletes key + disables itself on success);
  `tailscaled` + join enabled; `ufw allow in on tailscale0`; fails when tailscale is not on the target or >1 key.
- `validate_boot`: target hook masks removed and `90-mkinitcpio-install.hook` is a real file; every installed kernel has
  matching headers; `limine.conf` has `Omarchy` (+`cryptdevice=` if encrypted); `/etc/kernel/cmdline` exists;
  `limine_x64.efi` non-empty; a UKI `/boot/EFI/Linux/omarchy_<kernel>.efi` non-empty; `efibootmgr` has a `Limine` entry;
  protected: fstab has both UUIDs, `crypttab.initramfs` has the LUKS UUID; deferred: `pending`, enabled unit, Node tarball,
  `luks-key` + keyfile + `cryptkey=rootfs:` in `limine.conf` when encrypted.
- `create_factory_snapshot`: top-level mount `subvolid=5` → `btrfs subvolume snapshot @ @factory` → scrub
  (`provisioning/authorized_keys`, `provisioning/luks-key`, `etc/omarchy/provisioning.key`, the two provisioning drop-ins,
  `etc/tailscale/authkey`, the tailscale join unit + wants link) → `ro true`. Skipped when root is not btrfs `@`.
- `state.json` → `/var/log/omarchy-install-timing.json` on the target (phases, elapsed, `installed_packages`, `expected_packages`).
- CPU governor forced to `performance` for the install (no-op in VMs), restored on failure.
- Failure of any phase → `Phase '<name>' failed after Ns: <exc>` in the log, exit 1; Ctrl+C → 130; config error → 2;
  protected-mode cleanup (`umount -R /mnt`, `cryptsetup close omarchy_root`) on failure.

#### Unattended install (`omarchy-cidata-load`, `manual/51-unattended-installs.md`, README)

- Drive label `cidata` or `CIDATA` (any filesystem), found via `/dev/disk/by-label` after `udevadm settle`; mounted ro at `/run/cidata`.
- Required: `user_configuration.json` **and** (`user_credentials.json` **or** empty `defer-provisioning`). Anything less →
  wizard (stale inputs in `/root` are cleared first either way).
- Optional: `user_full_name.txt`, `user_email_address.txt`, `user_encrypt_installation.txt` (`true` iff a `disk_encryption`
  block exists — drives autologin + boot validation, not the encryption itself), `authorized_keys` (one key/line, `#` comments),
  `tailscale_authkey` (exactly one), `defer-provisioning` (marker; may sit beside a credentials file carrying only `encryption_password`).
- Behaviour: `Autoinstall configuration found on cidata drive; skipping the configurator.`; every prompt suppressed;
  auto reboot at the end; failure screen shown then exit (no menu). Password hash via `openssl passwd -6`.
- Caveats (manual): an encrypted unattended install still stops at the LUKS prompt on first boot; `disk_encryption` carries the
  passphrase in plaintext. Boot order disk-first so the empty disk falls through to the ISO once.
- Tooling: `genisoimage -volid cidata`, Proxmox `qm create` example; the integration harness builds a 4 MiB FAT `CIDATA` USB image.

#### Target-side system setup (`bin/omarchy-apply-system` → `install/config/all.sh`, `hardware/all.sh`, `login/all.sh`, `post-install/all.sh`)

- `helpers/logging.sh`: `start_install_log` (`=== Omarchy Setup Started: …`), `run_logged <leaf>` (`Starting:`/`Completed:`/
  `Failed: <script> (exit code: N)` lines, `bash -eE -c 'source "$1"'`, `OMARCHY_INSTALL_DEBUG=1` → `bash -x`),
  `stop_install_log` (`=== Omarchy Setup Completed`, `Omarchy setup: Xm Ys`). Log `/var/log/omarchy-install.log`.
- `helpers/as-root.sh`: `as_root` (sudo unless EUID 0). `helpers/browser-policy.sh`: root-owned 0755 policy dirs for
  chromium/chrome/edge/brave (`/etc/chromium/policies/managed` …), purge of non-root entries, `color.json`
  (`BrowserThemeColor`, `BrowserColorScheme: device`), Firefox `distribution/policies.json`.
- `config/theme-system.sh`: Yaru `go-previous/next-symbolic.svg` links, `gtk-update-icon-cache`,
  `/usr/lib/chromium/initial_preferences` (`require_eula: false`, follow system colour scheme).
- `config/browser-policy.sh`: sets up `/etc/chromium/policies/managed`.
- `config/increase-lockout-limit.sh`: `pam_faillock` `deny=10 unlock_time=120` in `/etc/pam.d/system-auth`; `authsucc` line in
  `/etc/pam.d/sddm-autologin`.
- `config/lockscreen-pam.sh`: `omarchy-apply-lock` → `/etc/pam.d/omarchy-lock-password` (+ `omarchy-lock-fingerprint` when enrolled).
- `config/fix-powerprofilesctl-shebang.sh`: `/usr/bin/powerprofilesctl` shebang → `#!/bin/python3`.
- `config/ssh-command-path.sh`: `PATH DEFAULT=…mise/shims:…/.local/bin` appended to `/etc/security/pam_env.conf`.
- `config/ssh-keepalive.sh`: `/etc/ssh/ssh_config.d/20-omarchy-keepalive.conf` (`ServerAliveInterval 15`, `ServerAliveCountMax 3`, `ConnectTimeout 10`).
- `config/docker.sh`: deliberately a no-op — the user is **not** added to `docker` (sudoless Docker is opt-in).
- `config/snapper.sh`: `snapper -c root create-config /` if missing, template `default/snapper/root` installed over
  `/etc/snapper/configs/root`, `/etc/conf.d/snapper` `SNAPPER_CONFIGS="root"`, `snapper-timeline.timer` disabled,
  `snapper-cleanup.timer` + `limine-snapper-sync.service` enabled.
- `config/enable-services.sh`: enables `cups avahi-daemon linux-modules-cleanup docker.socket systemd-resolved NetworkManager power-profiles-daemon sddm systemd-oomd`;
  masks `NetworkManager-wait-online`.
- `config/firewall.sh`: `ufw default deny incoming / allow outgoing`; allow `53317/udp,tcp` (LocalSend); Docker DNS allow rules
  (`172.16.0.0/12`, `192.168.0.0/16` → `172.17.0.1:53`); `ufw-docker install` via a `ufw status` shim; `ENABLED=yes` in
  `/etc/ufw/ufw.conf`; `systemctl enable ufw`. **Port 22 is not opened.**
- `login/sddm.sh`: strips `pam_gnome_keyring.so` auth/password lines from `/etc/pam.d/sddm`.
- `post-install/pacman.sh`: restores `/etc/pacman.conf` + mirrorlist for `OMARCHY_MIRROR` (stable/rc/edge), CUPS
  `cups-files.conf` override, sources `hardware/pacman.sh` (T2 `[arch-mact2]` repo).
- `post-install/udev.sh`: `udevadm control --reload` + power_supply trigger. `post-install/localdb.sh`: `updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots`.

#### Hardware quirk scripts (`install/hardware/**`, run by `omarchy-apply-hardware`) — does each fire in the QEMU guest?

Guest: q35, `-cpu host`, virtio-vga (PCI `1af4`), virtio-net, virtio-blk, no audio/battery/USB peripherals, DMI vendor "QEMU".

- `asus-rog.sh` (`omarchy-hw-asus-rog` → `asusctl`) — **no**.
- `framework16.sh` (`qmk-hid`), `framework/qmk-hid.sh` (udev rule) — **no**.
- `dell-xps-touchpad-haptics.sh`, `dell-xps13-sidecar-amps.sh` (DMI `DX13260` + SKU `0E53`) — **no**.
- `surface.sh` (`linux-firmware-marvell`), `fix-surface-keyboard.sh` (mkinitcpio `surface_device_modules.conf`) — **no**.
- `network.sh` — **yes, unconditional**: disables `iwd`, `systemd-networkd*`, masks `systemd-networkd-wait-online`, retires
  archinstall's stock `20-{ethernet,wlan,wwan}.network` into `/etc/systemd/network/omarchy-networkd-retired-<ts>/`.
- `set-wireless-regdom.sh` — **yes if** `/etc/conf.d/wireless-regdom` exists (wireless-regdb) and the timezone maps to a
  country via `zone.tab` (UTC → nothing written; e.g. `America/Denver` → `WIRELESS_REGDOM="US"`).
- `fix-fkeys.sh` — **yes, unconditional**: `/etc/modprobe.d/hid_apple.conf` `options hid_apple fnmode=2`.
- `fix-synaptic-touchpad.sh` (`/proc/bus/input/devices` synaptics) — **no**.
- `bluetooth.sh` — **yes, unconditional**: `systemctl enable bluetooth.service` (inert without an adapter).
- `nvidia.sh` (`lspci` nvidia → `nvidia-open-dkms`/`nvidia-580xx-dkms`, `/etc/modprobe.d/nvidia.conf`, `/etc/mkinitcpio.conf.d/nvidia.conf`) — **no**.
- `vulkan.sh` (Intel/AMD/Apple VGA → `vulkan-intel/radeon/asahi`) — **no** (virtio GPU is Red Hat).
- `intel/video-acceleration.sh` (Intel VGA → `intel-media-driver libvpl vpl-gpu-rt` or `libva-intel-driver`) — **no**.
- `intel/lpmd.sh` (GenuineIntel + battery + hybrid model) — **no** (no battery; `omarchy-hw-intel` may be true via `-cpu host`).
- `intel/thermald.sh` (GenuineIntel model ≥ 42 + battery) — **no** (no battery).
- `intel/ipu7-camera.sh` (ACPI `OVTI08F4`) — **no**. `intel/fred.sh` (Panther Lake GPU → `fred=on` drop-in) — **no**.
- `intel/fix-wifi7-eht.sh` (PCI `8086:e440/272b` → `iwlwifi disable_11be`) — **no**. `intel/sof-firmware.sh` (Intel audio → `sof-firmware`) — **no**.
- `fix-elgato-camlink-4k.sh` (USB `Cam Link 4K` → v4l2loopback, udev, relayd service) — **no**.
- `asus/fix-asus-ptl-display-backlight.sh`, `asus/fix-asus-ptl-b9406-display.sh`, `asus/fix-asus-ptl-b9406-touchpad.sh`, `asus/fix-z13-touchpad.sh` — **no**.
- `apple/fix-spi-keyboard.sh`, `apple/fix-suspend-nvme.sh` (`omarchy-nvme-suspend-fix.service`), `apple/fix-t2.sh`
  (`linux-t2`, `t2fanrd`, `/etc/t2fand.conf`, `t2-mac.conf` cmdline), `apple/fix-brcmfmac-supplicant.sh` (`brcmfmac.conf`) — **no**.
- `lenovo/fix-yoga-pro7-bass-speakers.sh` (`lenovo-yoga-pro7-bass.conf`) — **no**.
- `fix-bcm43xx.sh` (`14e4:43a0/4331` → `broadcom-wl-dkms`) — **no**. `fix-yt6801-ethernet-adapter.sh` — **no**.
- `fix-tuxedo-backlight.sh` (DMI TUXEDO/Slimbook) — **no**. `speaker-tuning.sh` (`omarchy-audio-tuning match` → `lsp-plugins-lv2`) — **no**.
- `pacman.sh` (T2 → `[arch-mact2]` repo) — **no**.
- Per-user hardware leaves (`install/user/hardware/**`, run by `omarchy-provision-user`): `fix-nouveau-cursor.sh`
  (`no_hardware_cursors` appended to `~/.config/hypr/looknfeel.lua` when nouveau drives the GPU) — **no**;
  `asus/fix-audio-mixer.sh`, `asus/fix-mic.sh` — **no**; `framework/fix-f13-amd-audio-input.sh` (`pactl` AMD card) — **no**;
  `dell/xps13-text-scaling.sh` (`omarchy-display-text-size 11`) — **no**.

#### Per-user finalization (`bin/omarchy-provision-user` → `install/user/all.sh`)

- `omarchy-provision-user [--force] [--first-install] [-h]`; refuses root (`Error: run omarchy-provision-user as the user being configured, not as root.`);
  idempotent on `~/.local/state/omarchy/done/finalize-user` (`User finalization already complete (rerun with --force to refresh).`);
  unknown option → usage, exit 1. `--first-install` implies `--force` and marks every `migrations/*.sh` done for the new user.
- `OMARCHY_SETUP_CONTEXT`: `iso-chroot` (ISO), `provision-owner` (first boot), `runtime` (default).
- Skill symlinks: `~/.agents/skills/<name>`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.pi/agent/skills/`, `~/.gemini/config/skills/`,
  `~/.hermes/skills/` (+ existing `~/.hermes/profiles/*/skills/`) → `$OMARCHY_PATH/default/agents/skills/<name>` (`omarchy`, `diagnose-crash`).
- `xdg-user-dirs-update`: TEMPLATES/PUBLICSHARE/DESKTOP folded into `$HOME`, `~/Templates ~/Public ~/Desktop` removed;
  `~/Downloads ~/Pictures ~/Videos` created; `~/.config/gtk-3.0/bookmarks` gets `Downloads Projects Pictures Videos`.
- `user/theme.sh`: `~/.config/omarchy/themes/`, `omarchy-theme-set "Tokyo Night"` only when `~/.local/state/omarchy/current/theme.name`
  is empty (headless in non-runtime contexts, removes Chromium `SingletonLock`), `omarchy-theme-set-pi --activate`,
  `~/.config/btop/themes/current.theme` link.
- `user/chromium.sh`: `omarchy-install-chromium-copy-url`, `omarchy-install-chromium-ytdlp` (native messaging hosts).
- `user/git.sh`: `git config --global user.name/email` from `OMARCHY_USER_NAME/EMAIL` when non-blank.
- `user/xcompose.sh`: `~/.XCompose` including `/usr/share/omarchy/default/xcompose`, `<Multi_key> <space> <n>` / `<e>` → name/email.
- `user/mise-work.sh`: `~/Work`, `~/Work/tries`; Node from the bundled tarball (`/opt/packages` in chroot,
  `/var/lib/omarchy/provisioning/packages` at first boot) → `~/.local/share/mise/installs/node/<ver>`, `mise use -g node@<ver>`
  then `tools.node = "latest"`; runtime context → `mise use -g node@latest` (network); missing tarball is fatal in chroot,
  a warning at first boot.
- `user/default-keyring.sh`: `~/.local/share/keyrings/Default_keyring.keyring` (unlocked default keyring) + `default`.
- `user/mise.sh`: `mise settings set upgrade.auto_prune false`; stubs via `omarchy-mise-install` for
  `codex claude crush antigravity-cli(agy) gh copilot opencode npm:playwright pi oh-my-pi(omp) grok cursor-agent ghui hunk hey basecamp cf ori`;
  `omarchy-install-hermes-cli || true`; `muse` via `http:` backend.
- Then `omarchy-refresh-applications`, `xdg-settings set default-web-browser chromium.desktop`,
  `xdg-mime default HEY.desktop x-scheme-handler/mailto`, marker `finalize-user`, prints `User finalization complete.`

#### First login (`bin/omarchy-provision-first-run`, `default/hypr/autostart.lua`, `install/user/first-run/*`)

- Started by Hyprland `hyprland.start` (`hl.exec_cmd("omarchy-provision-first-run")`) on **every** session start; exits
  `First-run already complete (rerun with --force to refresh).` once `~/.local/state/omarchy/done/first-run-user` exists.
- `--force` reruns everything (and `omarchy-provision-user --force || true`); `-h/--help` usage; unknown option → exit 1.
- Steps logged to `~/.local/state/omarchy/first-run.log` (`Starting:`/`Completed:`/`Failed: <name> (exit code: N)`):
  install `post-update` hooks `install-voxtype.hook`, `setup-fingerprint.hook`, `setup-agent.hook` into
  `~/.config/omarchy/hooks/post-update.d/`; `enable-user-units.sh` (`systemctl --user enable --now bt-agent omarchy-recover-internal-monitor omarchy-sleep-lock omarchy-migrate-notify omarchy-fcitx5 omarchy-crash-watch`);
  `gnome-theme.sh` (`gtk-theme Adwaita-dark`, `color-scheme prefer-dark`, `icon-theme Yaru-blue`); `gtk-primary-paste.sh`
  (`gtk-enable-primary-paste true`); `audio-tuning.sh` (`omarchy-audio-tuning on`, no-op without a matching laptop);
  `omarchy-notification-wait` (10 s for the shell's notification server); `welcome.sh` toast **Learn Keybindings**
  (`Super + K for cheatsheet. / Super + Space for Omarchy Menu.`, click → `omarchy-menu-keybindings`);
  `wifi.sh` detached: `nm-online -s`, then either toast **Setup Wi-Fi** (`Click to configure the wireless network.` →
  `omarchy-shell shell toggle omarchy.network`) when offline and, once online (≤ 1 h), **Update System**
  (`Click to update the system.` → `omarchy-update` in a floating terminal).
- Marker written only when every step succeeded; otherwise `One or more first-run steps failed; first-run will retry next login`.
- The three hooks run at `omarchy-hook post-update` time (after `omarchy update`), each once via `omarchy-done ensure`:
  **Install Dictation with Voxtype** (`voxtype-install-invitation`), **Set your default agent** (`agent-setup-invitation`, only when
  `omarchy-default-agent` is empty; click → `omarchy menu summon setup.default.agent`), **Setup Fingerprint Reader**
  (`fingerprint-setup-invitation`, only when `omarchy-hw-fingerprint` and `/etc/pam.d/omarchy-lock-fingerprint` is absent).
- `bin/omarchy-done <check|mark|ensure> <name>`: markers in `~/.local/state/omarchy/done/`; `ensure` is once-only
  (`noclobber`); names with `/`, `.`, `..` refused (`Invalid done marker name`); wrong arity/action → usage, exit 1.

#### Deferred first-boot provisioning (`bin/omarchy-provision-owner`, `install/provisioning/omarchy-provision-owner.service`)

- Unit: `ConditionPathExists=/var/lib/omarchy/provisioning/pending`, `!…/wipe-pending`; `After=systemd-user-sessions omarchy-system-factory-reset-finish`,
  `Before=display-manager.service getty@tty1.service`, `Conflicts=getty@tty1.service`; oneshot on `/dev/tty1`,
  `ExecStartPre=-/usr/bin/plymouth quit`. Not shipped enabled; installed to `/etc/systemd/system` by the ISO (deferred) or the factory reset.
- Script: root only (`Error: omarchy-provision-owner must run as root`); exits 0 silently without `pending`; refuses while
  `wipe-pending` exists (`factory wipe still pending; not running user setup`, exit 1). Sources `setup-form.sh`; overrides
  `omarchy_username_taken` with `getent passwd`.
- Console cosmetics: Tokyo Night palette, `scale_console_font` (picks `default8x16`/`sun12x22`/`latarcyrheb-sun32` for ≈48 rows
  and ≥ 82 cols), waits for the console geometry to settle (virtio-gpu KMS handoff), redraws on resize.
- Greeter: centred logo (ttfx colorshift), `Beautiful, Fun & Agentic Linux by DHH`, `Press Return to Start Setup`.
- Keyboard form `Let's setup your keyboard...` (same picker); Esc re-asks; Ctrl+C → `Setup starts again after the reboot.` /
  `Reboot this machine?` `Yes, reboot` / `No, keep setting up`. Applies `loadkeys` + `systemd-firstboot --keymap` (or `localectl set-keymap`).
- User form `Let's setup your user account...`: username (pinned to `setup-user` on a retry: `Continuing setup for user: <name>`),
  password + confirm, full name, email, hostname, then `Let's set your timezone...` timezone. Esc → back to keyboard;
  Ctrl+C → reboot confirm.
- Review table (Keyboard, Username, Password `*`, Full name, Email, Hostname, Timezone) → `Does this look right?` / `No, change it`.
- Progress screen `Setting up your machine` with the 34-cell bar and tips; phases `account → finalize → rekey → boot → done`
  (`/run/omarchy-provision-owner.state`); log `/var/log/omarchy-provision-owner.log` (0600).
- Work: `useradd -m -G wheel[,recorded groups] -s /bin/bash [-c name]` (or `usermod` on retry); `chpasswd` for user **and root**;
  `/etc/sudoers.d/00-omarchy-wheel` (`%wheel ALL=(ALL:ALL) ALL`, 0440); browser policy dirs; staged `authorized_keys` → `~/.ssh`;
  `/var/lib/sddm/state.conf`; `/etc/sddm.conf.d/autologin.conf` (permanent on encrypted; on unencrypted a self-deleting
  `omarchy-provision-autologin-once.service` removes it before the **next** boot's SDDM); `hostnamectl set-hostname`;
  `timedatectl set-timezone`; `omarchy-provision-user --force --first-install` as the user with `OMARCHY_SETUP_CONTEXT=provision-owner`
  (Node from the staged tarball); LUKS re-key (`luksAddKey` user password, remove keyfile + drop-ins, `reset_limine_config`,
  `limine-update`, kill every other slot, `shred luks-key`; any failure restores auto-unlock and retries);
  `limine_entries_stale` → rebuild after a factory reset; cleanup removes `pending`, `authorized_keys`, `setup-user` and the wants link
  (keeps `groups` and `packages/`).
- Group policy (`user_groups`): `wheel` always; `docker` never replayed; `input` only if `xpadneo-dkms` or `ydotool` is installed.
- Failure UX: `Setup hit an error (details in /var/log/omarchy-provision-owner.log).` → `Retry first-boot setup?`
  `Try again` / `Drop to console` (→ root bash on tty1: `Run 'omarchy-provision-owner' to retry setup.`);
  `User finalization reported errors (see …)` / `Run 'omarchy-provision-user --force' after login to retry.` when finalize failed
  but setup continued. Hands off to SDDM immediately after the full bar (no celebration screen).

#### Factory reset (`bin/omarchy-system-factory-reset`, `bin/omarchy-system-factory-reset-finish`, `install/provisioning/omarchy-system-factory-reset-finish.service`)

- Menu: `Omarchy Menu → Setup → Reset Computer` (shown only when `/` is btrfs) → floating terminal with presentation
  (`Done! Press any key to close...` / `Failed (exit code N)! Press any key to close...`).
- Self-elevates via `sudo` (forwarding `GUM_*`); requires `btrfs-progs`, root on btrfs `subvol=/@`
  (`Error: reset requires the standard Omarchy Btrfs layout (subvol=@)`), top-level mounted at `/run/omarchy-system-factory-reset/top`.
- No `@factory` → `This machine has no factory snapshot to reset to.` + explanation + `Reinstall from the Omarchy ISO to make this machine resettable.`, exit 1.
- Confirm: `Reset this computer to factory state?`, bullet list (accounts + /home, packages + system changes, machine identity),
  `The next boot asks for a new user, exactly like a fresh install.`, grey note about non-secure erasure; `Type 'reset' to continue`
  (`> ` prompt); anything else → `Error: Reset not confirmed.` exit 1; Esc → exit 1.
- Masks `limine-snapper-sync.{service,path}` at runtime; `stage_full_reset`: `Cloning the factory snapshot` (`@omarchy-reset-next`),
  refuses a factory snapshot predating provisioning support; `Scrubbing machine identity from the factory system`
  (new machine-id, ssh host keys, NM connections, tailscale/iwd state, sddm state/autologin); `Removing account credentials from the factory system`
  (userdel uid 1000–59999, `/home/<user>`, root hash `!`, shadow backups) on both the clone and `@factory` (made rw then ro);
  copies the Node tarball; `pending` + `wipe-pending`; installs both provisioning units.
- Encrypted: `Confirm your disk encryption passphrase to authorize the re-key.` `Passphrase>` (loops on
  `That passphrase does not unlock <dev>. Try again.`); adds a 48-char throwaway key, stages `luks-key`, `/etc/omarchy/provisioning.key`,
  the `cryptkey=rootfs:` drop-in and `FILES+=` drop-in in the clone.
- `rebuild_next_boot`: mounts the ESP from the clone's fstab, rbinds proc/sys/dev/run, recreates the hibernation swapfile
  (`Recreating the hibernation swapfile in the factory system`), `reset_limine_config` (template + drop old machine-id dirs),
  `Rebuilding boot files from the factory system (this can take a minute)` (`chroot limine-update`), `verify_limine_hashes` (b2sum).
- `Activating the factory system`: `@` → `@omarchy-old-<epoch>`, clone → `@`; `Reset staged. The wipe finishes on the next boot.`;
  `Reboot to complete the reset?` `Reboot now` / `Reboot later` (→ `Do not keep using this machine — changes made now will be lost.`).
- Next boot: `omarchy-system-factory-reset-finish.service` (sysinit, before `home.mount var-log.mount`) deletes `@omarchy-old-*`,
  recreates `@home @log`, repairs `/.snapshots`, `fstrim -a`, removes `wipe-pending` and itself; abort keeps `wipe-pending`
  so it retries and provisioning stays blocked. Then `omarchy-provision-owner` runs as above.
- Log `/var/log/omarchy-system-factory-reset.log` (0600).

#### Security/boot setup wizards (`bin/omarchy-setup-*`)

- `omarchy-setup-security-sshd [--key=<pubkey>] [--gh-keys <user>] [-h]` (menu `Setup → Security → SSHD`):
  `Setting up SSH server access with key-based authentication.` → `Installing and starting the OpenSSH server...`
  (`omarchy-pkg-add openssh`, `systemctl enable --now sshd`) → `Opening the SSH port in the firewall (rate limited against brute force)...`
  (`ufw limit 22/tcp comment omarchy-sshd`) → picker `How would you like to add your SSH key?` `Grab key from GitHub` /
  `Paste key manually` → `GitHub username>` (placeholder `dhh`, `https://github.com/<user>.keys`, `Could not fetch any SSH keys for GitHub user`) /
  `Public key>` (`Not a valid SSH public key: …`, `Key already authorized:` / `Authorized key: <fingerprint>`) →
  `Disabling SSH password authentication, now that a key is authorized...` → `/etc/ssh/sshd_config.d/10-omarchy-hardening.conf`
  validated with `sshd -t` and `sshd -T` (removed if ineffective) → `systemctl reload sshd` →
  `Perfect! The SSH server is running and your key is authorized.` / `Password logins are off; …` / `You can now connect with: ssh <user>@<host>`.
  Errors: `--gh-keys` without a name → exit 2 `needs a GitHub username`; both flags → exit 2; unknown option → exit 2;
  empty picker input → exit 1; picker cancelled → exit 1 (sshd already enabled + port opened by then).
  Reverse: `omarchy-remove-security-sshd` (disable sshd, delete the ufw rule, optional `Also remove all authorized SSH keys`).
- `omarchy-setup-security-sudoless-docker` (menu entry only while **not** configured): warning text (`docker run -v /:/host alpine`),
  `Enable sudoless Docker? This gives anything running as you passwordless root.` → No: `Aborted. No changes made. Docker access still goes through a prompt.`;
  Yes: `usermod -aG docker`, `omarchy-state set reboot-required`, `Sudoless Docker ENABLED. It takes effect after a reboot.`,
  `Reboot now to apply?`. Already enabled → `Sudoless Docker is already enabled: <user> is in the docker group.` exit 0.
  Reverse: `omarchy-remove-security-sudoless-docker` (`gpasswd -d`, `Sudoless Docker DISABLED …`, reboot prompt).
- `omarchy-setup-security-fingerprint` (menu entry only when `omarchy-hw-fingerprint`): `No fingerprint sensor detected.` exit 1
  before any install; otherwise `libfprint-git fprintd usbutils` (`--ask 4`), `fprintd-enroll`, `fprintd-verify`, then PAM
  (`pam_fprintd.so` + clamshell gate `omarchy-hw-laptop-closed` in `sudo`, `polkit-1`; `/etc/pam.d/omarchy-lock-fingerprint`).
- `omarchy-setup-security-fido2`: `Installing required packages...` (`libfido2 pam-u2f`) → `fido2-token -L` empty →
  `No FIDO2 device detected. Please plug it in (you may need to unlock it as well).` exit 1; otherwise `pamu2fcfg` →
  `/etc/fido2/fido2` (refuses symlinked dir/file), `pam_u2f.so` in `sudo` + `polkit-1`, `sudo echo` test.
- `omarchy-setup-direct-boot` (menu `Setup → Direct Boot`): needs `/sys/firmware/efi` + working `efibootmgr`; refuses
  `American Megatrends` and `Apple` firmware; existing `Omarchy` entry → `Disable direct boot (remove Omarchy EFI entry)?`
  (deletes bootnum); none → finds `/boot/EFI/Linux/omarchy*.efi` (`Error: No Omarchy UKI found`) →
  `Setup direct boot (so snapshot booting must be done via bios)?` → `efibootmgr --create --disk /dev/vda --part 1 --label Omarchy --loader \EFI\Linux\omarchy_linux-omarchy.efi`.
  BootOrder is **not** changed.
- Related: `omarchy-drive-password` (menu `Update → Password → Drive Encryption`): single LUKS device auto-selected
  (`omarchy-drive-select` for several), `New encryption password` / `Confirm new encryption password` (masked headers),
  `Password cannot be empty.` / `Passwords do not match.` exit 1, `Changing full-disk encryption password for <dev>`,
  `cryptsetup luksChangeKey --pbkdf argon2id --iter-time 2000` asking the **current** passphrase on the tty;
  `No encrypted drives available.` exit 1.

#### Package sets (`install/omarchy-base.packages` 149, `install/omarchy-other.packages` 66)

- Base — compositor/session: `hyprland hyprland-guiutils hyprland-preview-share-picker hyprpicker hyprsunset quickshell uwsm sddm plymouth xdg-desktop-portal-gtk xdg-desktop-portal-hyprland xdg-terminal-exec power-profiles-daemon brightnessctl ddcutil asdcontrol aether`.
- Base — Wayland tools/capture: `wl-clipboard wtype grim slurp gpu-screen-recorder imagemagick libvips ffmpegthumbnailer qrencode zbar tesseract tesseract-data-eng`.
- Base — terminal/shell/CLI: `foot bash-completion starship tmux zoxide fzf fd ripgrep eza bat dua-cli btop fastfetch jq less man-db tldr unzip whois inetutils inotify-tools inxi plocate expac pacman-contrib yay socat gum ttfx tzupdate usage vi nvim omarchy-nvim lazygit lazydocker git fakeroot tobi-try herdr tensaku cliamp`.
- Base — dev toolchains: `clang llvm lua51 luarocks libyaml ruby mise-bin tree-sitter-cli dotnet-runtime python-gobject python-poetry-core postgresql-libs mariadb-libs docker docker-buildx docker-compose qemu-user-static-binfmt kernel-modules-hook`.
- Base — apps: `chromium nautilus nautilus-python sushi gnome-disk-utility gvfs-mtp gvfs-nfs gvfs-smb udiskie evince xournalpp pinta obsidian libreoffice-fresh localsend kdenlive obs-studio moonlight-qt mpv mpv-mpris imv yt-dlp omacalc omacut omawrite`.
- Base — audio/Qt: `alsa-utils pamixer wireplumber qt6-imageformats qt6-multimedia qt6-multimedia-ffmpeg`.
- Base — network/security/printing: `networkmanager avahi nss-mdns ufw ufw-docker bluez bluez-tools bluez-utils bolt gnome-keyring libsecret wireless-regdb cups cups-filters cups-pk-helper system-config-printer`.
- Base — fonts/themes/input/filesystems: `noto-fonts noto-fonts-cjk noto-fonts-emoji ttf-ia-writer ttf-jetbrains-mono-nerd-basic woff2-font-awesome fontconfig yaru-icon-theme gnome-themes-extra fcitx5 fcitx5-gtk fcitx5-qt dosfstools exfatprogs`.
- Other (offline mirror only; installed conditionally) — boot/base: `base base-devel autoconf-archive dkms btrfs-progs limine limine-mkinitcpio-hook limine-snapper-sync linux-firmware linux-omarchy linux-omarchy-headers snapper zram-generator yay-debug`;
  audio: `pipewire pipewire-alsa pipewire-jack pipewire-pulse gst-plugin-pipewire libpulse sof-firmware lsp-plugins-lv2`;
  graphics: `egl-wayland gtk4-layer-shell qt6-wayland webp-pixbuf-loader vulkan-intel vulkan-radeon vulkan-asahi intel-media-driver libva-intel-driver libva-nvidia-driver libvpl vpl-gpu-rt nvidia-dkms nvidia-open-dkms nvidia-580xx-dkms nvidia-utils nvidia-580xx-utils lib32-nvidia-utils lib32-nvidia-580xx-utils`;
  hardware: `asusctl broadcom-wl-dkms intel-ipu7-camera intel-lpmd thermald macbook12-spi-driver-dkms tuxedo-drivers-nocompatcheck-dkms yt6801-dkms linux-firmware-marvell dell-xps-touchpad-haptics dell-xps13-sidecar-amps apple-bcm-firmware apple-t2-audio-config linux-t2 linux-t2-headers t2fanrd qmk-hid`.
- `builder/archinstall.packages` (also in the mirror): `alsa-firmware amd-ucode base base-devel efibootmgr intel-ucode linux-firmware linux limine omarchy-keyring openssh pipewire snapper sof-firmware tailscale`.

#### ISO build/test tooling (omarchy-iso `bin/*`, `builder/*`, `test/*`) — operator-only, not driver-reachable

- `omarchy-iso-make [--no-cache] [--keep-pkg-cache] [--no-boot-offer] [--debug] [--edge] [--dev|--rc] [--local-source <omarchy> <pkgs>]`
  → docker `archlinux:latest` runs `builder/build-iso.sh` → `release/*-<ref>.iso`; offers to boot.
- `build-iso.sh`: package targets per ref (`omarchy`/`omarchy-dev`), Node tarball download + sha256, offline mirror
  (`pacman -Syw`, retry once, `prune-offline-mirror.sh`, `repo-add offline.db`), vendors `setup-form.sh` and the two package
  lists into `/usr/share/omarchy-iso/`, `expected-packages` count (600–2000 sanity), `mkarchiso`.
- `omarchy-iso-boot [--reuse] [--ssh-port] [--no-network] [--disk] [--ovmf-vars] iso [-- qemu args]` (SDL, virtio-vga-gl),
  `omarchy-vm save|boot|list` (snapshot the boot disk), `omarchy-iso-test` (OCR-driven acceptance: `--encrypt`, `--provision`,
  `--reuse-base`, `--install-only`, `--sync-omarchy`, `--sync-all`, `--keep-running`), `omarchy-iso-test-stop [--kill]`,
  `omarchy-iso-test-windows-disk [--recreate] [--gap]` (synthetic 96 GiB disk: 512 MiB `WINDOWS_ESP` with `EFI/Microsoft`,
  ext4 `WINDOWS_DATA` with `OMARCHY-MUST-NOT-TOUCH.txt`, ≥ 64 GiB free; `--gap` leaves partition slot 3 free),
  `omarchy-iso-sign` (1Password GPG key), `omarchy-iso-upload` (rclone R2 + `.sig` + `.sha256`), `omarchy-iso-release [--rc] VERSION`,
  `omarchy-iso-rclone-config`.
- `test/all` (unit: cidata load, media diagnosis, checksum sidecar, partition numbering, python phases), `test/integration`
  (cidata-installed base image + scenarios; `factory-reset-test.sh` proves a shared ESP with Windows + foreign Linux entries survives
  reset and first boot), `.github/workflows/nightly-build.yml`.

#### Manual pages

- `manual/02-getting-started.md`: full-disk vs free-space, Secure Boot/TPM must be off, wired/2.4 GHz keyboard for LUKS,
  `Ctrl + C` on the keyboard screen = prepare for another owner, `Ctrl + C` on the disk confirm = no encryption, unattended pointer.
- `manual/50-dual-boot-install.md`: shrink in Windows Disk Management, `Free space install`, `limine-scan` to add Windows to Limine,
  BitLocker must be off (not suspended).
- `manual/51-unattended-installs.md`: the cidata table above, `defer-provisioning`, SSH/Tailscale behaviour, `genisoimage`, Proxmox, two caveats.
- `manual/49-omarchy-on.md`: Asahi, Parallels, VirtualBox, VMware, Steam Deck, NixOS pointers — nothing QEMU-specific.

## Observations

Boot and login on the minted disk (what the driver sees on `--resume`):

- The `mint` install is a **full-disk encrypted** install (passphrase `prime`) with defaults: keyboard English (US), hostname
  `omarchy`, full name/email skipped, timezone = whatever `tzupdate -p` guessed on the fleet host (probably a real zone, not UTC —
  report it). Layout: `/dev/vda1` 2 GiB FAT ESP mounted at `/boot` (`umask=0077`, root-only), `/dev/vda2` LUKS2 → btrfs
  `@ @home @log @pkg` + read-only `@factory`, zram swap, `/swap/swapfile` for hibernation.
- Boot chain: OVMF → `Limine` EFI entry (first in BootOrder) → `/boot/limine.conf` (`interface_branding: Omarchy Bootloader`,
  Tokyo Night colours, `default_entry: 2`, no explicit timeout; in practice the installed system boots without the menu being
  seen — the integration harness still handles a "parked at the Limine menu" case) → UKI `/boot/EFI/Linux/omarchy_linux-omarchy.efi`
  → Plymouth theme `omarchy` (cmdline `quiet splash loglevel=0 systemd.show_status=false rd.udev.log_level=0 vt.global_cursor_default=0 initramfs_async=0`)
  → the **Plymouth LUKS passphrase prompt** (mkinitcpio `encrypt` hook; not reliably OCR-able — type `prime` + Enter blind;
  keystrokes before the prompt are discarded; a wrong passphrase re-prompts but only three tries are allowed per round — do not burn them) → **SDDM autologin** straight into
  `omarchy.desktop` (uwsm/Hyprland). The driver never sees an SDDM password field on a resumed boot; the SDDM greeter
  (theme `omarchy`, Hyprland-based, user `prime` remembered, password-only) appears only after **Logout**, on an unencrypted
  install, or the boot after a deferred-provisioning first boot on an unencrypted machine.
- Because of `loglevel=0`/`quiet` and no `console=ttyS0`, the serial capture is essentially empty during boot; serial evidence
  has to be produced explicitly (`sudo tee /dev/ttyS0`).
- `HandlePowerKey=ignore` (`etc/systemd/logind.conf.d`): QEMU's power button does nothing; shutdown/reboot must come from inside
  (`Omarchy Menu → System → …` or `systemctl reboot`/`poweroff` in a terminal). The greeter/first-boot forms are on tty1; the
  desktop is on the VT SDDM picked (Ctrl+Alt+F1 returns to it, Ctrl+Alt+F3 is a free getty).
- `pam_faillock` is `deny=10 unlock_time=120`, `passwd_tries=10` for sudo: up to nine wrong passwords are harmless; a tenth
  locks the account for two minutes (also affects the lock screen and SDDM).

State the minted disk carries from install and first-run:

- First-run already completed during the mint: `~/.local/state/omarchy/done/{finalize-user,first-run-user}` exist, so the
  welcome/update toasts do **not** reappear on a resumed boot (`omarchy-provision-first-run` runs at every Hyprland start and exits
  early). The three post-update hooks are installed under `~/.config/omarchy/hooks/post-update.d/` but have **never run** (no
  `omarchy update` yet): `voxtype-install-invitation` and `agent-setup-invitation` markers are absent; running
  `omarchy-hook post-update` (or `omarchy update`) shows those two toasts once. `fingerprint-setup-invitation` never appears (no reader).
- Every install (not only deferred ones) leaves `/var/lib/omarchy/provisioning/packages/node-v*-linux-x64.tar.gz` and a read-only
  `@factory` snapshot, so `omarchy-system-factory-reset` **is** runnable in the guest. There is no `pending`, no `luks-key`,
  no `omarchy-provision-owner.service` in `/etc/systemd/system` on a normal install; `sudo omarchy-provision-owner` exits 0 silently.
- Node was unpacked from the bundled tarball (`~/.local/share/mise/installs/node/<ver>`, `~/.config/mise/config.toml` `node = "latest"`);
  agent CLIs are mise stubs (`~/.local/share/mise/shims`) that install on first use (network). `omarchy-provision-user --force`
  and `omarchy-provision-first-run --force` hit the network (`mise use -g node@latest`, `omarchy-install-hermes-cli`, `muse`).
- Git identity is unset (skipped at mint); `~/.XCompose` carries empty `<n>`/`<e>` bindings.
- `/etc/sddm.conf.d/autologin.conf` + `99-omarchy-login.conf` + `/var/lib/sddm/state.conf` exist; `/etc/pam.d/sddm` has no
  gnome-keyring lines; default keyring is the unlocked `Default_keyring`.
- Firewall: `ufw` active, default deny incoming, only LocalSend 53317 and Docker-DNS rules; `sshd` installed but disabled and
  port 22 closed (the `omarchy-iso-test` harness opens it by hand, the cidata path opens it during install).
- Hardware quirks that fired in QEMU: `hid_apple.conf` (`fnmode=2`), `bluetooth.service` enabled (inert), `NetworkManager-wait-online`
  and `systemd-networkd-wait-online` masked, `iwd`/`systemd-networkd` disabled, `WIRELESS_REGDOM` set iff the timezone maps to a
  country. Nothing NVIDIA/Vulkan/Intel-media/thermald/lpmd/SOF is present; `~/.config/hypr/looknfeel.lua` has no `no_hardware_cursors`.
- `omarchy-hw-intel` may return true under `-cpu host` on an Intel fleet host, but every Intel leaf also needs a battery or a
  specific GPU/PCI id, so none applies. `omarchy-hw-laptop` false (DMI chassis type 1, no lid).

Installer behaviour a driver must know (fresh-ISO variants):

- The ISO's GRUB menu is hidden with `timeout=0`; the speakup/memtest/UEFI-shell entries are effectively unreachable by keystroke
  timing from the driver. BIOS boot is impossible on the OVMF guest.
- Esc means "back to the keyboard step" everywhere in the form; Ctrl+C has three meanings: keyboard screen → prepare for another
  owner; overwrite/free-space confirm → toggle encryption; **user step → abort to a root shell** (`./.automated_script.sh` restarts).
  gum only exits on Esc/Ctrl+C; Tab/arrows move between buttons; Return confirms the highlighted button (the affirmative is default).
- The password is checked only for blank and mismatch. No length/complexity rule: `a` is accepted and becomes the user, root **and**
  LUKS password. Worth a test that documents this.
- Timezone screen shape depends on network: with a geo guess it is a `gum choose` list preselected on the guess (Return accepts);
  without it is a `gum filter` where the driver types to narrow (e.g. `Berlin`) and presses Return. Timeouts in the harness are
  180 s for `tzupdate`.
- `gum choose` pickers paginate at height 10 and do not filter on typing; the layout list needs arrow keys (English (UK) is one Down).
- A non-US keyboard chosen at Step 1 is applied live (`loadkeys`) — the password typed afterwards is under that layout; German swaps
  `y/z` and moves symbols. Use letter/digit-only passwords without `y`/`z` for that test.
- The unencrypted free-space install mounts the ESP at `/efi` (encrypted at `/boot`); protected mode never enables the Limine
  fallback entry and registers an EFI entry while asserting any Windows entry survives.
- Deferred-provisioning installs auto-unlock the disk from an embedded keyfile until the first-boot re-key; `validate_boot` insists
  on `cryptkey=rootfs:` being in `limine.conf`. After the re-key exactly one LUKS keyslot remains and `/proc/cmdline` has no `cryptkey=`.
  `omarchy-provision-owner` also sets the **root** password to the user's password and writes `/etc/sudoers.d/00-omarchy-wheel`
  (a normal install relies on archinstall's `%wheel` uncomment instead).
- The deferred first boot has **no** LUKS prompt and no SDDM prompt: greeter → form → progress bar → desktop.
- The `omarchy-setup-security-sshd` wizard enables `sshd` and opens `22/tcp` (rate limited) **before** asking for a key; cancelling
  at the picker leaves a password-authenticating sshd reachable. Hardening (`PasswordAuthentication no`) only lands after a key.
- `omarchy-setup-direct-boot` works in OVMF (vendor `EDK II`, `efivarfs` writable) and creates an `Omarchy` entry but does not
  reorder boot; the machine keeps booting via Limine.
- `omarchy-drive-password` prompts for the *current* passphrase via `cryptsetup` on the tty after the sudo prompt — three password
  prompts in a row (sudo, new, confirm, then current); order on screen: new → confirm → sudo → current.
- Factory reset in the guest: staging does a full `limine-update` UKI rebuild in a chroot (minutes on 2 vCPU), the reboot does
  the wipe, first boot does finalize (offline Node) + a second UKI rebuild for the re-key. The integration harness budgets 900 s
  for staging and 900 s for first boot; on this guest expect 6–12 minutes end to end — at the edge of the session budget.
- The driver cannot attach a second drive (cidata) or a pre-partitioned fixture disk; `./client start` only takes `--iso`/`--disk`.
  Unattended, dual-boot, too-small-disk and BitLocker tests need harness support (a `--disk <fixture>` or an extra `-drive`).
- Every install log line is CSI-stripped into `/var/log/omarchy-install.log` on the target, and
  `/var/log/omarchy-install-timing.json` records all 14 phases with `status` — the cheapest possible "the installer did everything"
  audit from inside a resumed disk.

## Proposed tests

Every step below is a keystroke, a mouse action, a screenshot, or a command typed into a terminal opened inside the
guest; long output is read with `… | sudo tee /dev/ttyS0` then `get-serial`. Installer stories need a fresh ISO boot and
sit at the end as `[VM-NO] [VM-OK-from-ISO]` for a future ISO ticket.

### firstrun-artefacts-present   [VM-OK]
description: First login must leave its footprint on the machine: the done markers, the Tokyo Night theme state, the home layout and the shipped skills — a missing artefact means first-run failed silently.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `ls ~/.local/state/omarchy/done/` and press Enter → the list contains `finalize-user` and `first-run-user`.
  ** Type `omarchy-done check first-run-user; echo $?` → `0`; `omarchy-done check no-such-marker; echo $?` → `1`.
  * Type `grep -c Completed: ~/.local/state/omarchy/first-run.log; grep -c Failed: ~/.local/state/omarchy/first-run.log` → a count of at least 8, then `0`.
  * Type `cat ~/.local/state/omarchy/current/theme.name` → `Tokyo Night`.
  * Type `ls -d ~/.config/omarchy/themes ~/.XCompose ~/Work/tries ~/.local/share/keyrings/Default_keyring.keyring ~/.config/omarchy/hooks/post-update.d` → all five paths print, no error.
  * Type `readlink ~/.claude/skills/omarchy` → `/usr/share/omarchy/default/agents/skills/omarchy`.
  * Unhappy path: type `git config --global user.name; echo "rc=$?"` → nothing printed and `rc=1` (identity was skipped at install and must not have been invented).
  * Close the terminal with Super+W; the desktop is exactly as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal font is small; keep one command per screenshot and read the result right after Enter.
  * ./client-with-image returns the screenshot with the keystroke and saves a round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the done directory listing with `finalize-user` and `first-run-user`, and the `0`/`1` from omarchy-done
  ** Screenshot of `Tokyo Night`, the five existing paths, the skill symlink target, and `rc=1` for git
  * If unsuccessful
  ** Screenshot of the missing path or the `Failed:` count above zero, plus `cat ~/.local/state/omarchy/first-run.log`
covers: bin/omarchy-provision-first-run, bin/omarchy-provision-user, bin/omarchy-done, install/user/{theme,xcompose,git,default-keyring,mise-work}.sh, docs/file-layout.md (First-run, Runtime finalization), test/shell.d/first-run-test.sh, provision-user-test.sh

### firstrun-force-rerun-toasts   [VM-OK] [NET]
description: Re-running first login with `--force` must replay the welcome and update toasts and refresh the user setup without disturbing the session; without the flag it must be a no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-provision-first-run; echo "rc=$?"` → `First-run already complete (rerun with --force to refresh).` and `rc=0`.
  * Unhappy path: type `omarchy-provision-first-run --bogus; echo "rc=$?"` → `Unknown option: --bogus`, the usage text, `rc=1`.
  * Type `omarchy-provision-first-run --force` and let it run (up to 3 minutes; it refreshes mise tools over the network).
  ** A notification **Learn Keybindings** (`Super + K for cheatsheet.` / `Super + Space for Omarchy Menu.`) appears top-right, followed within about 30 s by **Update System**.
  ** Toasts fade after a while — screenshot as soon as each one shows.
  * Click the **Learn Keybindings** toast with the mouse while it is visible → the keybindings viewer opens; press Escape to close it.
  * When the command returns, type `tail -n 6 ~/.local/state/omarchy/first-run.log` → fresh `Completed:` lines and no `Failed:`.
  * Close the terminal with Super+W; the desktop is as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the **Update System** toast lags, keep screenshotting every 5 s for up to a minute; a slow network delays it, it does not skip it.
  * Toasts stack newest on top; the update toast lands above the welcome one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `already complete` line and `rc=0`, and of the `Unknown option` refusal with `rc=1`
  ** Screenshot of the **Learn Keybindings** toast, of the **Update System** toast, and of the keybindings viewer after the click
  ** Screenshot of the log tail with `Completed:` lines only
  * If unsuccessful
  ** Screenshot of the terminal where the command stopped and the log tail containing `Failed:`
covers: bin/omarchy-provision-first-run, install/user/first-run/{welcome,wifi}.sh, bin/omarchy-notification-wait, test/shell.d/first-run-test.sh

### firstrun-offline-shows-wifi-toast   [VM-OK]
description: With no network at first login the user must be invited to set up Wi-Fi rather than to update, and the update invitation must follow once a connection lands.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `nmcli networking off` → the bar's network indicator changes to disconnected.
  * Type `bash /usr/share/omarchy/install/user/first-run/wifi.sh` (it returns at once; the check runs in the background).
  * Within about 40 s a notification **Setup Wi-Fi** (`Click to configure the wireless network.`) appears; no **Update System** toast yet.
  ** `nm-online` waits up to 30 s before calling the machine offline — screenshot every 5 s.
  * Click the **Setup Wi-Fi** toast with the mouse → the network panel opens (it lists no Wi-Fi adapter on this machine; that is the expected absence). Press Escape to close it.
  * Type `nmcli networking on` → within about 30 s the **Update System** toast (`Click to update the system.`) appears.
  * Unhappy path: type `bash /usr/share/omarchy/install/user/first-run/wifi.sh` again while online → only **Update System** shows, no Wi-Fi toast.
  * Close the terminal with Super+W; the network indicator is back to connected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The network panel is a Quickshell layer at the top of the screen; Escape closes it.
  * Do not click **Update System** — that starts a system update.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the disconnected indicator, of the **Setup Wi-Fi** toast, of the network panel after the click, and of **Update System** after reconnecting
  * If unsuccessful
  ** Screenshots at 5 s intervals for a minute showing no toast, plus `nmcli general status` output
covers: install/user/first-run/wifi.sh, bin/omarchy-provision-first-run, test/shell.d/first-run-test.sh

### firstrun-post-update-invitations-once   [VM-OK]
description: The invitations first-run schedules for after the first update (Voxtype dictation, default agent) must appear exactly once, and the fingerprint invitation must never appear on a machine without a reader.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/done/ | grep -c invitation` → `0`.
  * Type `omarchy-hook post-update` → two toasts appear: **Install Dictation with Voxtype** and **Set your default agent**; no **Setup Fingerprint Reader**.
  ** Screenshot right after Enter; the toasts fade.
  * Click **Set your default agent** with the mouse → the Omarchy Menu opens on the default-agent submenu. Press Escape.
  * Type `ls ~/.local/state/omarchy/done/ | grep invitation` → `agent-setup-invitation` and `voxtype-install-invitation` only.
  * Unhappy path (once-only): type `omarchy-hook post-update` again and watch for 10 s → no new toast.
  * Type `omarchy-hw-fingerprint; echo $?` → `1`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not click **Install Dictation with Voxtype** — it starts a large network install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `0`, of the two toasts, of the menu after the click, of the two markers, and of no toast after the second run
  * If unsuccessful
  ** Screenshot of a `Hook failed:` line or of a third toast, and the done directory listing
covers: install/user/first-run/{install-voxtype,setup-agent,setup-fingerprint}.hook, bin/omarchy-hook, bin/omarchy-hook-install, bin/omarchy-done (ensure), bin/omarchy-hw-fingerprint

### firstrun-user-units-enabled   [VM-PARTIAL]
description: First login must enable and start the shipped user services (sleep lock, crash watch, migration notify, fcitx5) so they protect the very first session; the Bluetooth agent stays enabled but inert without an adapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `systemctl --user is-enabled bt-agent omarchy-recover-internal-monitor omarchy-sleep-lock omarchy-migrate-notify omarchy-fcitx5 omarchy-crash-watch` → six lines of `enabled`.
  * Type `systemctl --user is-active omarchy-sleep-lock omarchy-crash-watch omarchy-fcitx5` → three `active`.
  * Type `systemctl --user status bt-agent --no-pager | head -4` → loaded but inactive (no Bluetooth adapter) — the skipped hardware half.
  * Unhappy path: type `systemctl --user is-enabled omarchy-no-such-unit; echo $?` → `No such file or directory` and a non-zero code.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--no-pager` keeps everything on screen; if a pager opens anyway, press `q`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of six `enabled`, three `active`, the inactive bt-agent status, and the not-found error
  * If unsuccessful
  ** Screenshot of `systemctl --user status <unit> --no-pager` for the unit that is disabled or failed
covers: install/user/first-run/enable-user-units.sh, bin/omarchy-provision-first-run, docs/file-layout.md (First-run)

### provisioning-finished-commands-are-noops   [VM-OK]
description: On a finished install the provisioning tools must be safe: finalization reports itself done and refuses root, first-boot setup exits silently with no pending state, and only the offline Node bundle for a future reset is left behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-provision-user; echo "rc=$?"` → `User finalization already complete (rerun with --force to refresh).` and `rc=0`.
  * Unhappy path: type `sudo omarchy-provision-user; echo "rc=$?"` (password `prime`) → `Error: run omarchy-provision-user as the user being configured, not as root.` and `rc=1`.
  * Type `sudo ls /var/lib/omarchy/provisioning/ /var/lib/omarchy/provisioning/packages/` → `packages` (and possibly `groups`) with one `node-v*-linux-x64.tar.gz`; no `pending`, `wipe-pending`, `luks-key` or `setup-user`.
  * Type `sudo omarchy-provision-owner; echo "rc=$?"` → prints nothing, `rc=0` (nothing pending).
  * Unhappy path: type `omarchy-provision-owner; echo "rc=$?"` (no sudo) → `Error: omarchy-provision-owner must run as root`, `rc=1`.
  * Type `systemctl status omarchy-provision-owner.service --no-pager 2>&1 | head -2; grep -c cryptkey /proc/cmdline` → the unit `could not be found`, then `0`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first sudo asks for `prime`; it is cached for the following commands.
  * Do not pass `--force` to omarchy-provision-user here; that path downloads tools.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `already complete`/`rc=0`, the root refusal/`rc=1`, the provisioning listing with only the Node tarball, the silent `rc=0`, the non-root refusal, and the not-found unit with `0`
  * If unsuccessful
  ** Screenshot of a `pending` or `luks-key` present, or of omarchy-provision-owner printing a form
covers: bin/omarchy-provision-user, bin/omarchy-provision-owner, install/provisioning/omarchy-provision-owner.service, omarchy-iso stage_provisioning_state/_stage_node_tarball, test/shell.d/provision-user-test.sh, test_provisioning_state.py

### installed-service-checks-absent   [VM-OK]
description: On a stock machine the Install → Service menu must offer Tailscale and Dropbox as installable and the service probes behind it must report them absent.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Install**, then **Service**, with the mouse.
  * **Tailscale** and **Dropbox** are listed as installable (not marked already installed). Press Escape to close the menu.
  * Open a terminal with Super+Enter and type `omarchy-installed-service-tailscale; echo $?; omarchy-installed-service-dropbox; echo $?` → `1` and `1`.
  * Type `systemctl is-enabled tailscaled 2>&1; ls /etc/tailscale 2>&1` → not found / `No such file or directory` (no unattended tailnet key was staged).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not click an Install entry — just screenshot the submenu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Install → Service with Tailscale and Dropbox offered, and of the two `1` exit codes with no tailscale unit or key
  * If unsuccessful
  ** Screenshot of an entry marked installed on a stock disk or a probe returning `0`
covers: bin/omarchy-installed-service-{tailscale,dropbox}, test/shell.d/installed-service-test.sh, omarchy-iso configure_tailscale (absence path), default/omarchy/omarchy-menu.jsonc install.service.*

### resume-boot-luks-then-autologin   [VM-OK]
description: A reboot of the encrypted install goes Plymouth → LUKS passphrase → straight to the desktop by SDDM autologin, and a wrong passphrase re-asks instead of failing the boot.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cat /etc/sddm.conf.d/autologin.conf; loginctl show-session $XDG_SESSION_ID -p Service` → `User=prime`, `Session=omarchy.desktop`, `Service=sddm-autologin`.
  * Type `systemctl reboot` and screenshot every 5 s: the Omarchy Plymouth splash, then the passphrase prompt.
  ** The prompt may render as a dark screen with a small box and OCR may not read it; keystrokes typed before it appears are discarded.
  * Unhappy path: type `wrong` and press Enter once → the prompt comes back (the boot neither continues nor fails).
  ** Only three tries are allowed per prompt round — use one wrong try only.
  * Type `prime` and press Enter → the desktop appears with **no** SDDM password screen in between.
  * Open a terminal and type `journalctl -b -u sddm --no-pager | grep -i autologin | head -2; uptime -s` → an autologin line for `prime` and a boot time from just now.
  * Close the terminal with Super+W; the desktop is the stock one after a fresh boot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reboot takes 60–90 s; if unsure whether the prompt is up, wait 5 s and type `prime` + Enter again rather than guessing early.
  * If a text menu titled `Omarchy Bootloader` appears and stays, screenshot it (a defect) and press Enter on the highlighted entry.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Service=sddm-autologin`, of the passphrase prompt after the wrong try, of the desktop with no greeter, and of the sddm autologin journal line with the new boot time
  * If unsuccessful
  ** Screenshot of where the boot stopped (bootloader menu, Plymouth, emergency shell, SDDM password field) and `./client get-serial`
covers: omarchy-iso configure_login, etc/limine-entry-tool.d/omarchy-defaults.conf, etc/mkinitcpio.conf.d/omarchy_hooks.conf, install/config/increase-lockout-limit.sh (sddm-autologin), manual/02 (encryption)

### sddm-greeter-after-logout   [VM-OK]
description: Logging out of the autologin session lands on the Omarchy-themed SDDM greeter with the user remembered, which rejects a wrong password and accepts the right one — the only way to reach the greeter on an encrypted install.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Escape and click **Logout** with the mouse.
  * The SDDM greeter appears within 10–20 s: Omarchy theme, user `prime` preselected, password field focused.
  ** The greeter runs its own compositor; screenshot every 5 s until it is up.
  * Unhappy path: type `wrongpass` and press Enter → you stay on the greeter (field cleared or an error shown).
  ** Never more than nine wrong attempts: the tenth locks the account for two minutes.
  * Type `prime` and press Enter → the desktop returns.
  * Open a terminal with Super+Enter and type `loginctl list-sessions --no-pager` → one graphical session for `prime`; close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Escape opens the System submenu directly; Logout is in it.
  * ./client-with-image after each keystroke on the greeter shows whether the field took the text.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the SDDM greeter with the Omarchy theme and `prime` remembered, of the greeter still up after the wrong password, and of the restored desktop
  * If unsuccessful
  ** Screenshot of a black screen or text console instead of the greeter and `./client get-serial`
covers: install/login/sddm.sh, omarchy-iso configure_login (99-omarchy-login.conf), etc/sddm.conf.d/*, install/config/increase-lockout-limit.sh

### console-tty-login-and-back   [VM-OK]
description: A spare virtual console offers a getty login under the installed hostname, rejects a wrong password, accepts the account password, and the desktop survives the switch — the recovery path when the GUI is stuck.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Ctrl+Alt+F3 → a text console with `omarchy login:` (the default hostname is `omarchy`).
  * Unhappy path: type `prime`, Enter, then `wrong`, Enter → `Login incorrect` and a new `login:` prompt.
  * Log in with `prime` / `prime` → a shell prompt. Type `hostname; tty` → `omarchy` and `/dev/tty3`.
  * Type `echo tty3-login-ok | sudo tee /dev/ttyS0` (password `prime`) so the serial log carries the marker.
  * Type `exit`, Enter, then press Ctrl+Alt+F1 → the desktop is back exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Ctrl+Alt+F1 shows a text screen, the session is on the next VT — try Ctrl+Alt+F2.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `omarchy login:`, of `Login incorrect`, of `omarchy` / `/dev/tty3`, and of the restored desktop
  ** `./client get-serial` contains `tty3-login-ok`
  * If unsuccessful
  ** Screenshot of the console state and the serial dump
covers: install/provisioning/omarchy-provision-owner.service (getty conflict absent on a normal install), omarchy-iso configure_login (getty autologin removed), setup-form hostname default

### boot-config-limine-uki-present   [VM-OK]
description: The installed machine must keep a coherent Limine + UKI boot setup — config with this machine's id, the UKI on the ESP, Limine first in the firmware boot order, and the kernel-update hooks unmasked — so the next kernel update still boots.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `sudo ls -la /boot/EFI/Linux/ /boot/EFI/limine/` (password `prime`) → `omarchy_linux-omarchy.efi` (tens of MB) and `limine_x64.efi`.
  * Type `sudo grep -E 'machine-id|interface_branding|default_entry' /boot/limine.conf; cat /etc/machine-id` → the entry's `machine-id=` equals `/etc/machine-id`, `interface_branding: Omarchy Bootloader`, `default_entry: 2`.
  * Type `grep -oE '(root|cryptdevice)=[^ ]+' /etc/kernel/cmdline; grep ESP_PATH /etc/default/limine` → a `cryptdevice=` and a `root=`, and `ESP_PATH="/boot"`.
  * Type `sudo efibootmgr | head -4` → `BootOrder:` begins with the `Limine` entry's number.
  * Type `ls -la /etc/pacman.d/hooks/` → `99-omarchy-limine.hook` present, `90-mkinitcpio-install.hook` a regular file, no `*.omarchy-backup`, no symlink to `/dev/null`.
  * Unhappy path: type `sudo grep -c '@@CMDLINE@@' /etc/default/limine` → `0`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `/boot` is root-only (umask 0077); every read there needs sudo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the UKI and limine binaries, the matching machine-id lines, the cmdline values, `BootOrder` starting with Limine, and the clean hooks directory
  * If unsuccessful
  ** Screenshot of the missing file, the mismatched machine-id, or a `/dev/null` hook symlink
covers: omarchy-iso orchestrator _configure_limine_boot, _write_limine_defaults, finalize_limine_boot, validate_boot, _assert_boot_hooks_restored; default/limine/{default,limine}.conf; etc/limine-entry-tool.d/omarchy-uki.conf

### factory-snapshot-present-and-scrubbed   [VM-OK]
description: Every ISO install leaves a read-only `@factory` snapshot free of install-time secrets — the baseline Reset Computer restores — and a missing or writable one silently breaks the hand-over story.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo btrfs subvolume list / | grep -oE 'path @[a-z]*'` (password `prime`) → `@`, `@home`, `@log`, `@pkg`, `@factory`.
  * Type `DEV=$(findmnt -no SOURCE / | sed 's/\[.*//'); sudo mkdir -p /mnt/top; sudo mount -o subvolid=5 $DEV /mnt/top; ls /mnt/top` → `@ @factory @home @log @pkg` and nothing named `@omarchy-*`.
  * Type `sudo btrfs property get -ts /mnt/top/@factory ro` → `ro=true`.
  * Type `sudo ls /mnt/top/@factory/var/lib/omarchy/provisioning/ /mnt/top/@factory/etc/omarchy/ 2>&1` → `packages` (maybe `groups`); no `luks-key`, no `provisioning.key`, no `authorized_keys`.
  * Unhappy path: type `sudo touch /mnt/top/@factory/x; echo $?` → `Read-only file system`, `1`.
  * Type `sudo umount /mnt/top` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `findmnt -no SOURCE /` prints `/dev/mapper/<name>[/@]`; the sed strips the `[/@]` suffix.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the subvolume names including `@factory`, `ro=true`, the scrubbed provisioning directory, and the read-only touch failure
  * If unsuccessful
  ** Screenshot of the list without `@factory`, `ro=false`, or a secret inside the snapshot
covers: omarchy-iso orchestrator create_factory_snapshot, FACTORY_SCRUB_PATHS, test_provisioning_state.py CreateFactorySnapshotTest, bin/omarchy-system-factory-reset (require_factory_snapshot)

### factory-reset-confirm-cancel   [VM-OK]
description: Reset Computer must spell out what it erases and refuse to stage anything unless the user types exactly `reset`; a wrong word or Escape must leave the machine untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Setup**, then **Reset Computer**, with the mouse.
  * A floating terminal asks for the sudo password; type `prime`, Enter.
  * The screen shows `Reset this computer to factory state?`, three bullets (accounts and /home, packages and system changes, machine identity), `The next boot asks for a new user, exactly like a fresh install.` and a `Type 'reset' to continue` input.
  * Unhappy path 1: type `RESET`, Enter → `Error: Reset not confirmed.` then `Failed (exit code 1)! Press any key to close...`; press a key.
  * Unhappy path 2: reopen **Setup → Reset Computer**, enter `prime`, and press Escape at the input → `Failed (exit code 1)!`; press a key.
  ** Only a wrong word or Escape at this prompt is a safe cancel: once `reset` is typed the reset is staged and `@factory` is scrubbed even if you later choose "Reboot later".
  * Open a terminal with Super+Enter and type `sudo ls /var/lib/omarchy/provisioning/; systemctl is-enabled limine-snapper-sync.service` → no `pending`/`wipe-pending`, and `enabled` (the runtime mask is only applied after confirmation).
  * Close the terminal with Super+W; the desktop is as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The presentation wrapper holds the floating terminal open until a key is pressed.
  * ./client-with-image after typing into the confirm shows whether the input took the text.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the confirmation text, of `Error: Reset not confirmed.`, of the Escape exit, and of the provisioning directory without `pending`
  * If unsuccessful
  ** Screenshot of `Reset staged.` after a wrong word, or the terminal showing staging lines
covers: bin/omarchy-system-factory-reset (confirm_reset, self-elevation), default/omarchy/omarchy-menu.jsonc setup.reset, bin/omarchy-show-done

### factory-reset-refuses-without-factory-snapshot   [VM-OK]
description: On a machine whose `@factory` baseline is gone, Reset Computer must explain there is nothing to reset to and point at a reinstall instead of wiping anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and delete the baseline on this throwaway disk: type `DEV=$(findmnt -no SOURCE / | sed 's/\[.*//'); sudo mkdir -p /mnt/top; sudo mount -o subvolid=5 $DEV /mnt/top; sudo btrfs subvolume delete /mnt/top/@factory; ls /mnt/top; sudo umount /mnt/top` (password `prime`) → the listing has no `@factory`.
  * Type `omarchy-system-factory-reset; echo "rc=$?"` → `This machine has no factory snapshot to reset to.`, the explanation, `Reinstall from the Omarchy ISO to make this machine resettable.`, `rc=1`, and **no** `Type 'reset'` prompt.
  * Open the Omarchy Menu with Super+Space → **Setup** → **Reset Computer** is still listed (gated on btrfs, not on the snapshot); click it → the same refusal ending `Failed (exit code 1)!`; press a key.
  * Type `sudo ls /var/lib/omarchy/provisioning/` in the terminal → still no `pending`.
  * End the session with `stop`: the baseline was deleted on purpose and this disk must not be kept.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The delete is instant; if `btrfs subvolume delete` complains the snapshot is busy, nothing has it mounted — retry once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the top level without `@factory`, of the refusal text with `rc=1`, and of the same refusal from the menu entry
  * If unsuccessful
  ** Screenshot of a confirmation prompt appearing despite the missing snapshot
covers: bin/omarchy-system-factory-reset (require_factory_snapshot), manual/02 (resetting pointer)

### factory-reset-full-cycle   [VM-OK] [SLOW]
description: Reset Computer hands an encrypted, in-use machine to a new owner: staging re-keys the disk and rebuilds boot, the reboot wipes the old root, and the first-boot form creates a new user who lands on the desktop with a fresh machine identity.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, type `cat /etc/machine-id` and note it, then type `omarchy-system-factory-reset` (sudo password `prime`).
  * Type `reset`, Enter. At `Passphrase>` try the unhappy path first: `nope`, Enter → `That passphrase does not unlock … Try again.`; then `prime`, Enter.
  ** Staging takes 2–5 minutes: `Cloning the factory snapshot`, `Scrubbing machine identity…`, `Removing account credentials…`, `Rebuilding boot files … (this can take a minute)`, `Activating the factory system`. Screenshot every 5 s.
  ** From here the disk is committed: `@factory` is scrubbed and the old root renamed — this session must end with `stop`.
  * At `Reboot to complete the reset?` choose **Reboot later** → `Do not keep using this machine — changes made now will be lost.`; then type `systemctl reboot`.
  * The reboot must show **no** LUKS prompt; after the wipe the greeter appears: `Beautiful, Fun & Agentic Linux by DHH`, `Press Return to Start Setup`. Press Enter.
  * Walk the form: keyboard → Enter (English (US)); `Username>` `owner`; `Password>` `owner`, `Confirm>` `other` → `Passwords didn't match!`, then `owner`/`owner`; `Full name>` `Second Owner`; `Email address>` Enter; `Hostname>` `reset-box`; timezone → Enter on the preselected zone (or type `UTC`, Enter, if it is a filter).
  ** The notices last one second — screenshot right after Enter.
  * Review table → `Does this look right?` **Yes** → `Setting up your machine` with the progress bar and tips (2–5 minutes) → the desktop appears with no login prompt.
  * Open a terminal and type `hostname; cat /etc/machine-id; ls /var/lib/omarchy/provisioning/; grep -c cryptkey /proc/cmdline; sudo cryptsetup luksDump /dev/vda2 | grep -cE '^\s+[0-9]+: luks2'` (password `owner`) → `reset-box`, a different machine-id, no `pending`/`wipe-pending`/`luks-key`, `0`, `1` (a single keyslot).
  * End the session with `stop` — the disk is a different machine now and must not be saved.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The whole story runs 8–12 minutes on this guest; never pause more than 5 s and keep screenshotting.
  * `Setup hit an error` offers `Try again` / `Drop to console`: screenshot it, choose the console, `cat /var/log/omarchy-provision-owner.log | sudo tee /dev/ttyS0`, and report.
  * A machine parked at the `Omarchy Bootloader` menu is a defect: screenshot, then select the Omarchy entry with the arrows and Enter to continue.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the passphrase rejection, the staging lines, `Reset staged.` with the Reboot-later warning, the first-boot greeter with no LUKS prompt, the `Passwords didn't match!` notice, the review table, the progress bar, and the new desktop
  ** Screenshot of `reset-box`, the changed machine-id, the empty provisioning state, `0` cryptkey and `1` keyslot
  * If unsuccessful
  ** Screenshot of where it stopped (an `Error:` from the reset, a LUKS prompt that should not exist, the retry screen, the bootloader menu) plus `./client get-serial`
covers: bin/omarchy-system-factory-reset, bin/omarchy-system-factory-reset-finish, install/provisioning/*.service, bin/omarchy-provision-owner (greeter, forms, rekey_luks, configure_login, limine_entries_stale), install/provisioning/setup-form.sh, omarchy-iso test/integration.d/factory-reset-test.sh, test/shell.d/factory-reset-accounts-test.sh
dedupe-with: factory-reset-hands-machine-to-new-owner

### sshd-setup-key-then-remove   [VM-OK]
description: Setting up SSH with a public key must start the server, open a rate-limited port 22, authorize the key and turn password logins off — a key login then works, a password login is refused, and Remove SSHD undoes it all.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ssh-keygen -t ed25519 -N '' -q -f ~/.ssh/tkey; systemctl is-enabled sshd` → `disabled`.
  * Type `omarchy-setup-security-sshd --key="$(cat ~/.ssh/tkey.pub)"` (sudo password `prime`) → `Installing and starting the OpenSSH server...`, `Opening the SSH port in the firewall (rate limited against brute force)...`, `Authorized key: 256 SHA256:…`, `Disabling SSH password authentication, now that a key is authorized...`, `Perfect! The SSH server is running and your key is authorized.`, `You can now connect with: ssh prime@omarchy`.
  ** The same story from the menu (**Setup → Security → SSHD → Paste key manually**) needs the ~80-character key typed into a gum field; the `--key=` flag is the reliable way to drive it.
  * Type `ssh -o StrictHostKeyChecking=no -i ~/.ssh/tkey prime@localhost 'echo key-login-ok'` → `key-login-ok`.
  * Unhappy path: type `ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no prime@localhost true` → `Permission denied (publickey).` with no password prompt.
  * Type `sudo ufw status | grep 22` → `22/tcp LIMIT Anywhere # omarchy-sshd`.
  * Type `omarchy-remove-security-sshd`; at `Also remove all authorized SSH keys…?` choose **Yes** → `The SSH server has been disabled and its firewall port closed.`
  * Type `systemctl is-enabled sshd; sudo ufw status | grep -c 22` → `disabled` and `0`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * openssh is already installed, so nothing downloads; the first sudo asks for `prime`.
  * gum confirm: arrows or Tab move between buttons, Enter picks the highlighted one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the wizard output ending `Password logins are off`, of `key-login-ok`, of `Permission denied (publickey).`, of the LIMIT rule, and of `disabled`/`0` after removal
  * If unsuccessful
  ** Screenshot of the wizard's failing line and of `sudo sshd -T | grep -i passwordauthentication`
covers: bin/omarchy-setup-security-sshd (--key, authorize_key, disable_password_auth), bin/omarchy-remove-security-sshd, install/config/firewall.sh (22 closed by default), test/shell.d/setup-security-sshd-test.sh, manual/51 (SSH access)
dedupe-with: sshd-setup-paste-key-then-remove

### sshd-setup-cancel-leaves-port-open   [VM-OK]
description: The SSHD wizard starts sshd and opens port 22 before it asks for a key, so cancelling at the key picker leaves a password-authenticating server reachable; the wizard must also refuse bad flags and an invalid pasted key.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Setup → Security → SSHD** with the mouse; type `prime` for sudo.
  * After `Installing and starting the OpenSSH server...` and `Opening the SSH port in the firewall…` the picker `How would you like to add your SSH key?` appears; press Escape → `Failed (exit code 1)! Press any key to close...`; press a key.
  ** This is the quirk under test: the server and the firewall rule are already in place when the picker shows.
  * Open a terminal with Super+Enter and type `systemctl is-active sshd; sudo ufw status | grep 22; sudo sshd -T | grep -i ^passwordauthentication` → `active`, `22/tcp LIMIT …`, `passwordauthentication yes` — record this state verbatim.
  * Unhappy path (bad input): reopen **Setup → Security → SSHD**, choose **Paste key manually**, type `not-a-key`, Enter → `Not a valid SSH public key: not-a-key`, `Failed (exit code 1)!`; press a key. `ls ~/.ssh/authorized_keys 2>&1` → still absent.
  * Unhappy path (bad flags): type `omarchy-setup-security-sshd --gh-keys; echo "rc=$?"` → `--gh-keys needs a GitHub username.` `rc=2`; `omarchy-setup-security-sshd --key=x --gh-keys dhh; echo "rc=$?"` → `pass either --key or --gh-keys, not both.` `rc=2` — neither prints `Installing and starting`.
  * Restore the stock state: type `omarchy-remove-security-sshd` (no keys to remove) → sshd disabled and the port closed; `systemctl is-enabled sshd` → `disabled`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is a gum choose: arrows move, Enter selects, Escape cancels.
  * Screenshot the picker before pressing Escape — it proves the install/firewall lines already ran.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker with the two earlier lines above it, of the Escape exit, and of `active` / LIMIT rule / `passwordauthentication yes` afterwards
  ** Screenshot of the invalid-key refusal with no authorized_keys, the two `rc=2` refusals, and `disabled` after the remove
  * If unsuccessful
  ** Screenshot of a bad key landing in authorized_keys, or of a flag refusal that still installed
covers: bin/omarchy-setup-security-sshd (setup_sshd/open_firewall ordering, arg parsing, authorize_pasted_key), bin/omarchy-remove-security-sshd, default/omarchy/omarchy-menu.jsonc setup.security.sshd, test/shell.d/setup-security-sshd-test.sh
dedupe-with: sshd-setup-paste-key-then-remove

### sshd-setup-github-keys   [VM-OK] [NET]
description: The GitHub path of the SSHD wizard fetches `https://github.com/<user>.keys`, authorizes every key it finds, and fails clearly for a user without keys or without network.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Setup → Security → SSHD**; type `prime` for sudo; choose **Grab key from GitHub**; at `GitHub username>` type `dhh`, Enter.
  * The terminal shows `Fetching keys from https://github.com/dhh.keys...`, one or more `Authorized key: …` lines, the hardening lines and `Perfect! …`, then `Done! Press any key to close...`; press a key.
  * Open a terminal with Super+Enter and type `wc -l ~/.ssh/authorized_keys` → the number of keys reported.
  * Unhappy path: type `omarchy-setup-security-sshd --gh-keys this-user-does-not-exist-9f8e7d; echo "rc=$?"` → `Could not fetch any SSH keys for GitHub user '…'.` and `rc=1`.
  * Unhappy path (offline): type `nmcli networking off; omarchy-setup-security-sshd --gh-keys dhh; echo "rc=$?"; nmcli networking on` → the same `Could not fetch` error, `rc=1`.
  * Restore: type `omarchy-remove-security-sshd`, answer **Yes** to removing keys → sshd disabled, port closed. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The fetch is a few KB; if it hangs past 30 s the guest network is down — report that, not the wizard.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the fetch and `Authorized key:` lines, the matching `wc -l`, and both `Could not fetch` failures with `rc=1`
  * If unsuccessful
  ** Screenshot of the wizard output and of `curl -fsSL https://github.com/dhh.keys | head -1` to separate network from wizard failures
covers: bin/omarchy-setup-security-sshd (authorize_keys_from_github, prompt_for_github_user), manual/51 (SSH access)

### setup-sudoless-docker-toggle   [VM-OK]
description: Sudoless Docker is off by default and behind a root-equivalence warning: declining changes nothing, accepting adds the user to `docker` and hides the menu entry until it is removed again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `id -nG prime | tr ' ' '\n' | grep -c '^docker$'` → `0`.
  * Open the Omarchy Menu with Super+Space and click **Setup → Security → Sudoless Docker** with the mouse → a floating terminal with the `⚠️  WARNING` text (`docker run -v /:/host alpine`) and `Enable sudoless Docker? …`.
  * Unhappy path: choose **No** → `Aborted. No changes made. Docker access still goes through a prompt.`; press a key.
  * Reopen the entry, choose **Yes**, type `prime` for sudo → `Sudoless Docker ENABLED. It takes effect after a reboot.`; at `Reboot now to apply?` choose **No**; press a key.
  * In the terminal type `id -nG prime | tr ' ' '\n' | grep -c '^docker$'` → `1`. Open the Omarchy Menu → **Setup → Security** → the **Sudoless Docker** entry is gone; press Escape.
  * Type `omarchy-setup-security-sudoless-docker` → `Sudoless Docker is already enabled: prime is in the docker group.`
  * Restore: type `omarchy-remove-security-sudoless-docker` → `Sudoless Docker DISABLED…`, answer **No** to the reboot; `id -nG prime | grep -c docker` → `0`, and the menu entry is back. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `id -nG prime` shows the configured groups; the running session does not gain `docker` until a reboot, by design.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the warning and `Aborted. No changes made.`, of `Sudoless Docker ENABLED`, of `1` from `id -nG prime`, of Setup → Security without the entry, of the already-enabled message, and of the restored `0` with the entry back
  * If unsuccessful
  ** Screenshot of the floating terminal output and of `id -nG prime`
covers: bin/omarchy-setup-security-sudoless-docker, bin/omarchy-remove-security-sudoless-docker, bin/omarchy-sudo-docker, install/config/docker.sh, default/omarchy/omarchy-menu.jsonc setup.security.sudoless-docker, test/shell.d/provisioning-groups-test.sh

### setup-fingerprint-absent-in-vm   [VM-PARTIAL]
description: Without a fingerprint reader the Fingerprint entry is hidden from Setup → Security and the wizard bails before installing anything; enrolment itself cannot run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Setup → Security** → the list shows **Fido2**, **SSHD**, **Passwordless Sudo**, **Sudoless Docker** and **no Fingerprint** entry; press Escape.
  * Open a terminal with Super+Enter and type `omarchy-hw-fingerprint; echo $?` → `1`.
  * Type `omarchy-setup-security-fingerprint; echo "rc=$?"` → `Setting up fingerprint scanner for authentication.`, `No fingerprint sensor detected.`, `rc=1` — no `Installing required packages` line and no sudo prompt.
  * Type `grep -c fprintd /etc/pam.d/sudo; ls /etc/pam.d/omarchy-lock-fingerprint 2>&1` → `0` and `No such file or directory`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: enrolment, verification and the PAM edits — they need a USB reader.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Setup → Security without Fingerprint, of `No fingerprint sensor detected.` with `rc=1`, and of the untouched PAM state
  * If unsuccessful
  ** Screenshot of an install attempt or a PAM change without hardware
covers: bin/omarchy-setup-security-fingerprint, bin/omarchy-hw-fingerprint, install/user/first-run/setup-fingerprint.hook, default/omarchy/omarchy-menu.jsonc setup.security.fingerprint

### setup-fido2-no-token   [VM-PARTIAL] [NET]
description: The FIDO2 wizard installs its PAM module packages and then stops with a plug-it-in message when no token is present, leaving sudo and polkit PAM untouched; registration cannot run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Setup → Security → Fido2** with the mouse.
  * The floating terminal prints `Setting up FIDO2 device for authentication.` and `Installing required packages...`; type `prime` for sudo (`pam-u2f`, about 1 MB, may download).
  * It ends with `No FIDO2 device detected. Please plug it in (you may need to unlock it as well).` and `Failed (exit code 1)! Press any key to close...`; press a key.
  * Open a terminal with Super+Enter and type `grep -c pam_u2f /etc/pam.d/sudo; ls /etc/fido2 2>&1; pacman -Q pam-u2f` → `0`, `No such file or directory`, and the package version.
  * Unhappy path: type `omarchy-setup-security-fido2; echo "rc=$?"` again → the same `No FIDO2 device detected.` and `rc=1` with no second download.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: `pamu2fcfg` registration, `/etc/fido2/fido2` and the sudo touch test — no token in the VM.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `No FIDO2 device detected` with the failed close prompt, of `0` pam_u2f lines and no /etc/fido2, and of the second run's `rc=1`
  * If unsuccessful
  ** Screenshot of the floating terminal output and of `cat /etc/pam.d/sudo`
covers: bin/omarchy-setup-security-fido2, default/omarchy/omarchy-menu.jsonc setup.security.fido2

### setup-direct-boot-efi-entry   [VM-OK]
description: Direct Boot adds an `Omarchy` firmware entry pointing at the UKI, offers to remove it when it exists, and changes nothing when declined — without disturbing the Limine boot the machine relies on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo efibootmgr` (password `prime`) → a `Limine` entry, none labelled `Omarchy`; note `BootOrder`.
  * Open the Omarchy Menu with Super+Space and click **Setup → Direct Boot**. Unhappy path: at `Setup direct boot (so snapshot booting must be done via bios)?` choose **No** → `Done!`; `sudo efibootmgr` still shows no `Omarchy`.
  * Reopen **Setup → Direct Boot**, choose **Yes** → `Creating EFI boot entry for omarchy_linux-omarchy.efi`; press a key.
  * Type `sudo efibootmgr -v | grep Omarchy` → `Boot000X* Omarchy … \EFI\Linux\omarchy_linux-omarchy.efi`; `BootOrder` is unchanged (Limine still first).
  * Reopen **Setup → Direct Boot** → it now asks `Disable direct boot (remove Omarchy EFI entry)?`; choose **Yes** → `Removing EFI boot entry 000X`; `sudo efibootmgr | grep -c Omarchy` → `0`.
  * Close the terminal with Super+W; the firmware entries are as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * OVMF reports its vendor as `EDK II`, so the wizard's AMI/Apple refusal does not trigger here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of efibootmgr before (no Omarchy), after **No**, after **Yes** (entry with the UKI path and unchanged BootOrder), and after removal
  * If unsuccessful
  ** Screenshot of the floating terminal error (`No Omarchy UKI found`, efibootmgr failure) and of `sudo efibootmgr -v`
covers: bin/omarchy-setup-direct-boot, default/omarchy/omarchy-menu.jsonc setup.direct-boot, omarchy-iso _register_limine_efi_entry

### drive-password-change-and-revert   [VM-OK]
description: Update → Password → Drive Encryption refuses blank and mismatched passphrases, then changes the LUKS passphrase after verifying the current one — the new passphrase unlocks the disk, the old one no longer does.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space and click **Update → Password → Drive Encryption** with the mouse.
  * Unhappy path 1: at `New encryption password` press Enter → `Password cannot be empty.`, `Failed (exit code 1)!`; press a key.
  * Unhappy path 2: reopen; type `prime2`, Enter, then `prime3`, Enter → `Passwords do not match.`, `Failed (exit code 1)!`; press a key.
  * Reopen; type `prime2`, Enter, `prime2`, Enter → `Changing full-disk encryption password for /dev/vda2`; type `prime` for sudo; at `Enter passphrase to be changed:` type `prime`, Enter → `Done!`; press a key.
  ** Four masked prompts in a row: new, confirm, sudo, then cryptsetup's current passphrase — read each header before typing.
  * Open a terminal with Super+Enter and type `printf prime2 | sudo cryptsetup open --test-passphrase --key-file - /dev/vda2; echo "new=$?"; printf prime | sudo cryptsetup open --test-passphrase --key-file - /dev/vda2; echo "old=$?"` → `new=0`, `old=2`.
  * Revert: reopen **Update → Password → Drive Encryption**, enter `prime` / `prime`, sudo `prime`, and `prime2` at `Enter passphrase to be changed:`; rerun the two test commands → `prime` is `0` again and `prime2` is `2`.
  * Close the terminal with Super+W; the disk unlocks with `prime` as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * argon2id with a 2 s iteration time makes each change take a few seconds — wait for `Done!`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `Password cannot be empty.`, `Passwords do not match.`, the change completing, `new=0`/`old=2`, and the revert with `prime` accepted again
  * If unsuccessful
  ** Screenshot of the floating terminal output and of `sudo cryptsetup luksDump /dev/vda2 | grep -A3 Keyslots`
covers: bin/omarchy-drive-password, test/shell.d/drive-password-test.sh, default/omarchy/omarchy-menu.jsonc update.password.drive

### hardware-quirks-inert-on-virtio   [VM-OK]
description: On a virtio VM none of the vendor or GPU quirk scripts may leave configuration behind (no NVIDIA early KMS, no Vulkan/Intel media packages, no laptop drop-ins) while the unconditional ones (hid_apple fnmode, bluetooth enabled, wait-online masked) must have applied.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `lspci | grep -iE 'vga|3d|display'` → a `Red Hat, Inc. Virtio 1.0 GPU` line only.
  * Type `cat /etc/modprobe.d/hid_apple.conf; ls /etc/modprobe.d/` → `options hid_apple fnmode=2`, and no `nvidia.conf`, `brcmfmac.conf`, `iwlwifi-disable-eht.conf`, `lenovo-yoga-pro7-bass.conf`, `blacklist-clevo-xsm-wmi.conf`.
  * Type `ls /etc/mkinitcpio.conf.d/ /etc/limine-entry-tool.d/ /etc/udev/rules.d/ 2>&1 | sudo tee /dev/ttyS0` (password `prime`) and read it with get-serial → none of `nvidia.conf`, `apple-t2.conf`, `surface_device_modules.conf`, `macbook_spi_modules.conf`, `t2-mac.conf`, `intel-panther-lake-fred.conf`, `asus-*.conf`, `71-elgato-camlink-4k.rules`, `99-omarchy-asus-z13-touchpad.rules`, `50-framework16-qmk-hid.rules`.
  * Type `pacman -Q nvidia-open-dkms nvidia-utils vulkan-intel vulkan-radeon intel-media-driver thermald intel-lpmd asusctl broadcom-wl-dkms 2>&1 | grep -c 'was not found'` → `9`.
  * Type `systemctl is-enabled bluetooth NetworkManager-wait-online systemd-networkd-wait-online 2>&1` → `enabled`, `masked`, `masked`.
  * Type `grep -c no_hardware_cursors ~/.config/hypr/looknfeel.lua; grep -v '^#' /etc/conf.d/wireless-regdom | grep . ; timedatectl show -p Timezone --value` → `0`, then report whether `WIRELESS_REGDOM` is set (expected only when the timezone maps to a country).
  * Unhappy path: type `omarchy-hw-nvidia; echo $?; omarchy-hw-asus-rog; echo $?; omarchy-hw-laptop; echo $?` → `1 1 1`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The three-directory listing is long; the serial read is the reliable way to check every name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the virtio GPU line, the hid_apple content and clean modprobe.d, `9` not-found packages, the three service states, `0` for software cursors, and `1 1 1`
  ** `./client get-serial` with the mkinitcpio/limine/udev listings free of vendor files
  * If unsuccessful
  ** Screenshot or serial showing an unexpected vendor drop-in or package
covers: install/hardware/** (every leaf), bin/omarchy-apply-hardware, install/user/hardware/**, bin/omarchy-hw-*, agents/skills/install-scripts.md

### install-log-and-timing-clean   [VM-OK]
description: The installer's unified log and phase timing left on the target show every setup leaf completed and every phase `ok` — the quickest proof that the install ran to plan.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `sudo grep -c 'Completed:' /var/log/omarchy-install.log; sudo grep -c 'Failed:' /var/log/omarchy-install.log` (password `prime`) → a count in the dozens, then `0`.
  * Type `sudo grep -E '^=== Omarchy|^Omarchy setup:' /var/log/omarchy-install.log` → `Target Setup Started`, `Setup Started`, `Setup Completed`, `Omarchy setup: Xm Ys`.
  * Type `sudo jq -r '.phases[] | "\(.status) \(.name)"' /var/log/omarchy-install-timing.json` → 14 lines all starting `ok`, from `Preparing live environment` to `Creating factory snapshot`.
  * Type `sudo jq '{installed_packages, expected_packages}' /var/log/omarchy-install-timing.json` → installed within a few of expected.
  * Unhappy path: type `sudo grep -iE 'error|failed' /var/log/omarchy-install.log | head -5` → report anything found (expected: only harmless chroot lines such as ufw not running).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The log is long; the grep/jq summaries keep each answer on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the counts (`0` failed), the header/footer lines, the 14 `ok` phases and the package counts
  * If unsuccessful
  ** Screenshot of the `Failed:` lines or of the phase with `status: failed`
covers: install/helpers/logging.sh, bin/omarchy-apply-system, omarchy-iso orchestrator phases.py (state/timing), _run_target_setup_command, install/{config,hardware,login,post-install}/all.sh

### base-packages-installed   [VM-OK]
description: Every package in the shipped base list plus the boot essentials must be installed and the hardware-only packages must not be — the base set is what every other test assumes exists.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `grep -vE '^\s*(#|$)' /usr/share/omarchy/install/omarchy-base.packages | while read -r p; do pacman -Qq "$p" >/dev/null 2>&1 || echo "MISSING $p"; done; echo done` → only `done`, no `MISSING` lines (about 10 s).
  * Type `pacman -Qq omarchy omarchy-settings omarchy-nvim omarchy-keyring linux-omarchy linux-omarchy-headers limine limine-mkinitcpio-hook limine-snapper-sync snapper zram-generator openssh` → all names echoed, no error.
  * Type `cat /usr/share/omarchy/version; pacman -Q omarchy` → the version pair (report it; this disk is from the 4.0.2 ISO).
  * Unhappy path: type `pacman -Qq nvidia-utils linux-t2 2>&1` → two `error: package '…' was not found`.
  * Type `grep -E '^\[' /etc/pacman.conf` → `[options]`, `[omarchy]`, `[core]`, `[extra]` … and no `[offline]` (the live mirror was not left behind).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the loop only when `done` has printed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `done` with no `MISSING`, the essentials echoed, the version, the two not-found errors, and pacman.conf sections without `[offline]`
  * If unsuccessful
  ** Screenshot of the `MISSING <pkg>` lines or a leftover `[offline]` repo
covers: install/omarchy-base.packages, install/omarchy-other.packages, omarchy-iso _runtime_package_list/_early_packages, install/post-install/pacman.sh, test/shell.d/preinstalls-test.sh

### services-enabled-and-firewall-defaults   [VM-OK]
description: The install enables exactly the shipped system services and leaves ufw active with deny-incoming and only the LocalSend and Docker-DNS rules — an open port or a disabled daemon here is a regression.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `systemctl is-enabled cups avahi-daemon docker.socket systemd-resolved NetworkManager power-profiles-daemon sddm systemd-oomd ufw snapper-cleanup.timer limine-snapper-sync 2>&1` → `enabled` on every line.
  * Type `systemctl is-enabled sshd snapper-timeline.timer NetworkManager-wait-online 2>&1` → `disabled`, `disabled`, `masked`.
  * Type `readlink /etc/resolv.conf; systemctl is-active ufw docker.socket` → `../run/systemd/resolve/stub-resolv.conf`, `active`, `active`.
  * Type `sudo ufw status verbose` (password `prime`) → `Status: active`, `Default: deny (incoming), allow (outgoing)`, `53317/udp` and `53317/tcp` `ALLOW IN`, two `172.17.0.1 53/udp` rules, nothing for 22.
  * Unhappy path: type `curl -m 3 telnet://localhost:22; echo "rc=$?"` → connection refused, `rc=7`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `systemctl is-enabled` prints one state per line in argument order — count the lines against the names.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the enabled/disabled/masked lines, the resolv.conf link and active states, the ufw table with the default policy and four rules, and the refused connection to 22
  * If unsuccessful
  ** Screenshot of the service that is not enabled or a ufw rule that should not exist
covers: install/config/enable-services.sh, install/config/firewall.sh, install/config/snapper.sh (timers), install/hardware/network.sh, omarchy-iso configure_dns_resolver

### snapper-retention-config   [VM-OK]
description: Snapper is configured from Omarchy's template with the timeline off and cleanup on, and `/.snapshots` is a real subvolume — what the Limine snapshot menu and update rollbacks rely on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `sudo diff /usr/share/omarchy/default/snapper/root /etc/snapper/configs/root && echo same` (password `prime`) → `same`.
  * Type `cat /etc/conf.d/snapper; grep -E 'NUMBER_LIMIT|TIMELINE_CREATE' /etc/snapper/configs/root` → `SNAPPER_CONFIGS="root"`, `TIMELINE_CREATE="no"` and the shipped `NUMBER_LIMIT`.
  * Type `sudo btrfs subvolume show /.snapshots | head -1; sudo snapper list | head -3` → `.snapshots` is a subvolume and snapper answers with its table header.
  * Unhappy path: type `sudo snapper -c nosuch list 2>&1 | head -1` → an error that config `nosuch` does not exist.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `snapper list` may take a second on first use while its D-Bus service starts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `same`, the two config lines, the `.snapshots` subvolume line with the snapper header, and the `nosuch` error
  * If unsuccessful
  ** Screenshot of the diff output or the `btrfs subvolume show` error
covers: install/config/snapper.sh, default/snapper/root, omarchy-iso finalize_limine_boot (snapper asserted), bin/omarchy-system-factory-reset-finish (repair_snapshots_dir)

### pam-lockout-limit-ten-tries   [VM-OK]
description: Omarchy raises the login lockout to ten attempts with a two-minute unlock so a few typos never lock a user out; nine wrong passwords must still allow the tenth correct one, and a real lockout must release after two minutes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `grep faillock /etc/pam.d/system-auth; grep passwd_tries /etc/sudoers.d/omarchy-passwd-tries` → `deny=10 unlock_time=120` on both faillock lines and `Defaults passwd_tries=10`.
  * Type `sudo -k; sudo true` and answer the first four `[sudo] password for prime:` prompts with `nope`, the fifth with `prime` → the command succeeds.
  * Type `faillock --user prime` → an empty table (the success reset the four failures).
  * Unhappy path: type `sudo -k; su prime -c true` and answer `nope`; repeat until the tenth failure prints the account-locked message (`The account is locked due to 10 failed logins`).
  ** Do not lock the screen while locked out: the lock screen and SDDM share this counter.
  * Type `su prime -c true` with `prime` right away → still refused. Wait 120 s (screenshot every 5 s), retry with `prime` → succeeds.
  * Type `faillock --user prime --reset` and close the terminal with Super+W; the account is clean.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each `su` attempt is one failure; count them on screen so the tenth is the one that locks.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the config lines, of sudo succeeding after four wrong tries with an empty faillock table, of the account-locked message, of the refusal inside the window, and of success after 120 s
  * If unsuccessful
  ** Screenshot of sudo giving up before ten tries or of the account still locked after two minutes
covers: install/config/increase-lockout-limit.sh, etc/sudoers.d/omarchy-passwd-tries, etc/security/faillock.conf (override), install/login/sddm.sh

### system-config-dropins-present   [VM-OK]
description: The install-time system tweaks a user relies on without knowing it — SSH keepalives, Chromium's EULA-free first run, the Yaru icon links, the PAM tool path, root-owned browser policy — must be in place with the right ownership.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `ssh -G localhost | grep -iE 'serveralive|connecttimeout'` → `serveraliveinterval 15`, `serveralivecountmax 3`, `connecttimeout 10`. Unhappy/override path: `ssh -o ServerAliveInterval=5 -G localhost | grep -i serveraliveinterval` → `5`.
  * Type `cat /usr/lib/chromium/initial_preferences` → JSON containing `"require_eula":false`.
  * Type `readlink /usr/share/icons/Yaru/scalable/actions/go-previous-symbolic.svg; head -1 /usr/bin/powerprofilesctl` → the Adwaita symbolic path and `#!/bin/python3`.
  * Type `grep '^PATH' /etc/security/pam_env.conf` → the line ending in `@{HOME}/.local/share/mise/shims:@{HOME}/.local/bin`.
  * Type `stat -c '%U %a %n' /etc/chromium/policies/managed; ls /etc/chromium/policies/managed; ls /etc/pam.d/omarchy-lock-password; grep -c gnome_keyring /etc/pam.d/sddm` → `root 755`, `color.json`, the lock PAM file, `0`.
  * Type `sudo grep -E '^%wheel' /etc/sudoers; ls /etc/sudoers.d/` (password `prime`) → `%wheel ALL=(ALL:ALL) ALL` and the four shipped drop-ins with no `00-omarchy-wheel` (that one only comes from first-boot provisioning).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each command's output fits one screen; screenshot after each Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the keepalive values and the `5` override, the Chromium JSON, the icon link and shebang, the PAM PATH line, the root-owned policy dir with color.json, and the sudoers lines
  * If unsuccessful
  ** Screenshot of the missing file, wrong owner/mode, or wrong shebang
covers: install/config/{theme-system,browser-policy,fix-powerprofilesctl-shebang,ssh-command-path,ssh-keepalive,lockscreen-pam}.sh, install/helpers/browser-policy.sh, install/login/sddm.sh, etc/sudoers.d/*, bin/omarchy-provision-owner (00-omarchy-wheel absent on a normal install)

### xdg-defaults-and-home-layout   [VM-OK]
description: User finalization makes Chromium the default browser and HEY the mailto handler, folds Desktop/Templates/Public into the home, and seeds the standard folders and file-manager bookmarks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `xdg-settings get default-web-browser; xdg-mime query default x-scheme-handler/mailto` → `chromium.desktop`, `HEY.desktop`.
  * Type `xdg-user-dir DESKTOP; xdg-user-dir TEMPLATES; xdg-user-dir DOWNLOAD` → `/home/prime`, `/home/prime`, `/home/prime/Downloads`.
  * Type `ls -d ~/Downloads ~/Pictures ~/Videos ~/Work; ls -d ~/Desktop ~/Templates ~/Public 2>&1` → four folders, then three `No such file or directory`.
  * Type `cat ~/.config/gtk-3.0/bookmarks` → four `file:///home/prime/…` lines for Downloads, Projects, Pictures, Videos.
  * Unhappy path: type `xdg-mime query default x-scheme-handler/nonsense; echo "rc=$?"` → an empty line and `rc=0`.
  * Press Super+Shift+F → Nautilus opens with Downloads/Projects/Pictures/Videos in the sidebar; close it with Super+W, then close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Super+Shift+F does not open Nautilus on this build, open it from Omarchy Menu → Apps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the xdg values, the folded user dirs, the folder listing, the bookmarks file, and Nautilus' sidebar
  * If unsuccessful
  ** Screenshot of a wrong default or a leftover ~/Desktop
covers: bin/omarchy-provision-user (xdg-user-dirs, bookmarks, default browser/mailto), docs/file-layout.md (Runtime finalization)

### mise-node-offline-bundle   [VM-OK]
description: The install unpacks the ISO's bundled Node.js into mise without network, pins `node = "latest"` afterwards, disables auto-prune and lays down the agent CLI stubs — `node` works offline from the first boot.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `nmcli networking off; mise ls node; node --version; nmcli networking on` → one installed node version and the matching `v…` — while offline.
  * Type `grep -A1 '\[tools\]' ~/.config/mise/config.toml; mise settings get upgrade.auto_prune` → `node = "latest"`, `false`.
  * Type `ls ~/.local/share/mise/installs/node/; ls /var/lib/omarchy/provisioning/packages/` → the same version as the staged `node-v<ver>-linux-x64.tar.gz`.
  * Type `ls ~/.local/share/mise/shims | tr '\n' ' '` → includes `claude codex gh opencode pi grok hey basecamp playwright` (report the full list).
  * Unhappy path: type `mise ls python; echo "rc=$?"` → nothing installed for python (only node came from the bundle).
  * Close the terminal with Super+W; the network indicator is connected again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `claude`, `codex` or the other stubs — they trigger network installs.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `mise ls node` and `node --version` while offline, the `latest` pin and `false`, the matching versions, and the shim list
  * If unsuccessful
  ** Screenshot of `mise doctor | head -20` and `cat ~/.config/mise/config.toml`
covers: install/user/mise-work.sh, install/user/mise.sh, omarchy-iso _stage_node_tarball, builder/build-iso.sh (Node download), bin/omarchy-provision-user

### install-form-rejects-bad-answers   [VM-NO] [VM-OK-from-ISO]
description: The installer's account form refuses malformed and reserved usernames, blank and mismatched passwords and malformed hostnames with the documented notices, defaults an empty hostname to `omarchy`, and (a finding to record) accepts a one-character password; no install is performed.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; "the desktop" is the ISO's tty1.)

  <ActionList>
  * At the greeter (`Beautiful, Fun & Agentic Linux by DHH`, `Press Return to Start Install`) press Enter; at `Select keyboard layout` press Enter (English (US)).
  * `Username>`: type `Not A Name`, Enter → `Username must be alphanumeric with no spaces`; type `root`, Enter → `Username is reserved for system`; type `tester`, Enter → accepted.
  ** Notices show for one second with a spinner — screenshot right after Enter.
  * `Password>` Enter, `Confirm>` Enter → `Your password can't be blank!`; `prime` / `primx` → `Passwords didn't match!`; then `a` / `a` → accepted with **no** notice (record this: no strength rule).
  * `Full name>` Enter, `Email address>` Enter; `Hostname>` type `-bad-`, Enter → `Hostname must be 1-63 letters, digits, or dashes, and cannot start or end with a dash`; press Enter on the empty field → accepted.
  * `Timezone`: press Enter on the preselected zone (or type `UTC`, Enter, if it is a filter) → the review table shows `Username tester`, `Password *`, `Full name [Skipped]`, `Hostname omarchy`.
  * Choose `No, change it` → back to `Let's setup your machine...` with the layout picker, and the form re-asks from an empty `Username>`.
  * Press Enter on the layout, then Ctrl+C at `Username>` → `Aborted installation` / `You can retry later by running: ./.automated_script.sh` and a root prompt. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right or Tab moves between `Yes` and `No, change it`; Enter picks the highlighted one.
  * Nothing touches the disk in this story; the abort is the intended end.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each notice (alphanumeric, reserved, blank, mismatch, hostname), of the form advancing after `a`/`a`, of the review table with `Password *` and `Hostname omarchy`, of the empty re-ask, and of the abort text
  * If unsuccessful
  ** Screenshot of a rejected value being accepted, a notice with different wording, or the wizard leaving to a shell without the abort text
covers: install/provisioning/setup-form.sh (username/password/identity/hostname/timezone prompts, reserved list), configurator user_form/user_step/abort, test/shell.d/setup-form-test.sh, manual/02 (password is user + root + LUKS)

### install-wizard-back-and-abort   [VM-NO] [VM-OK-from-ISO]
description: Escape steps back to the keyboard screen from anywhere in the form, the disk picker lists only the target disk and Escape there aborts cleanly, and the documented retry command restarts the wizard — all before anything is written to disk.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`.)

  <ActionList>
  * Greeter → Enter; at `Select keyboard layout` press Down once (English (UK)), Enter; `Username>` type `loop`, then press Escape → the keyboard step (`Let's setup your machine...`) returns.
  * Enter (US this time); fill the form: `loop`, `prime`/`prime`, Enter, Enter, `Hostname>` `loopbox`, timezone Enter; review → `Yes`.
  * `Select install disk` lists exactly one line `/dev/vda (40G) - …` and nothing for the install medium.
  * Press Escape → `Aborted installation` / `You can retry later by running: ./.automated_script.sh`, root prompt.
  * Type `lsblk -f /dev/vda; ls /root/user_configuration.json 2>&1` → no partitions and the configuration file is absent (nothing was written).
  * Type `./.automated_script.sh`, Enter → the greeter appears again; press Enter and confirm the keyboard step shows, then Ctrl+C at `Username>` to abort. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The blank disk skips the mode picker; the overwrite confirm would be the next screen — never press Enter on it in this story.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the keyboard step after Escape, the single-disk picker, the abort text, the untouched `lsblk` and missing config, and the greeter after the retry command
  * If unsuccessful
  ** Screenshot of `/dev/sr0` or the ISO listed, of partitions on the disk, or of the retry command failing
covers: configurator keyboard_form/user_step (OMARCHY_FORM_BACK), disk_form/get_root_disk/get_disk_info/abort, .automated_script.sh (retry entry point)

### install-encryption-toggle-and-back   [VM-NO] [VM-OK-from-ISO]
description: On the overwrite confirm Ctrl+C toggles between `Yes, install` (encrypted) and `Yes, install without encryption` and back, and `No, change it` returns to the disk picker without touching the disk.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`.)

  <ActionList>
  * Greeter → Enter; keyboard → Enter; form `tog`, `prime`/`prime`, Enter, Enter, Enter, Enter; review `Yes`; disk `/dev/vda` Enter.
  * The confirm shows `Everything will be overwritten. There is no recovery possible.`, the grey `Press Ctrl+C for unencrypted install.`, buttons `Yes, install` / `No, change it`, prompt `Confirm overwriting /dev/vda`.
  * Press Ctrl+C → the button reads `Yes, install without encryption` and the grey hint disappears.
  * Press Ctrl+C again → `Yes, install` and the hint are back.
  ** The highlighted button may be unreadable to OCR; the presence or absence of the grey hint is the reliable tell.
  * Move to `No, change it` with Tab, Enter → `Select install disk` again (the mode picker is skipped on a blank disk).
  * Press Escape → abort; type `lsblk -f /dev/vda` → still empty. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never press Enter on either affirmative button — that starts the install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the encrypted confirm, the unencrypted toggle, the toggle back, the return to the disk picker, and the untouched disk
  * If unsuccessful
  ** Screenshot of Ctrl+C aborting the wizard instead of toggling, or of the disk being partitioned
covers: configurator confirm_disk_overwrite/select_installation/requires_full_disk_install, manual/02 (No-encryption installations)

### install-declines-encryption-sddm-login   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: An unencrypted full-disk install boots with no LUKS prompt to the SDDM greeter instead of autologin, rejects a wrong password and logs the user in, leaving no encryption artefacts — the throw-away install the manual offers.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; budget about 15 minutes.)

  <ActionList>
  * Greeter → Enter; keyboard → Enter; form: `plain`, `prime`/`prime`, `Plain User`, `plain@example.org`, `Hostname>` `plainbox`, timezone Enter; review `Yes`; disk `/dev/vda` Enter.
  * At the confirm press Ctrl+C (grey hint disappears → `Yes, install without encryption`), then Enter.
  * The dashboard shows `Installing Omarchy`, the bar and rotating tips for 5–10 minutes; then `Installed Omarchy in Xm Ys` with a `Reboot Now` button — press Enter.
  ** Screenshot every 5 s throughout; the bar is the only liveness signal.
  * Boot: Plymouth splash, **no** passphrase prompt, then the SDDM greeter (Omarchy theme, user `plain`, password field).
  * Unhappy path: type `wrong`, Enter → still on the greeter. Type `prime`, Enter → the desktop, with the **Learn Keybindings** and **Update System** toasts of a first login.
  * Open a terminal with Super+Enter and type `ls /etc/sddm.conf.d/; lsblk -f /dev/vda; grep -c cryptdevice /proc/cmdline; hostname; git config --global user.name` → only `99-omarchy-login.conf`, `vda1 vfat` + `vda2 btrfs` with no `crypto_LUKS`, `0`, `plainbox`, `Plain User`.
  * End the session with `stop` (a fresh install is never saved by a test).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the greeter has not appeared 3 minutes after the reboot, press Ctrl+Alt+F3, log in as `plain`/`prime` and type `journalctl -b -u sddm --no-pager | tail | sudo tee /dev/ttyS0`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unencrypted confirm, the dashboard, the finish screen, the SDDM greeter after boot, the rejected password, the desktop with first-run toasts, and the terminal checks
  * If unsuccessful
  ** Screenshot of a LUKS prompt (toggle failed), an autologin without a greeter, or the failure screen with `failed phase:`; `./client get-serial`
covers: configurator confirm_disk_overwrite (Ctrl+C), omarchy-iso configure_login (no autologin when unencrypted), omarchy-install-dashboard finish/reboot prompt, install/user/{git,first-run}.sh, manual/02 (No-encryption installations)

### install-custom-keyboard-hostname-timezone-identity   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: Non-default answers — a German keyboard, a custom hostname, a chosen timezone, full name and email — all land on the installed system as console keymap and XKB layout, hostname, timezone, git identity and XCompose bindings.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; budget about 15 minutes.)

  <ActionList>
  * Greeter → Enter. At `Select keyboard layout` press Down until `German` is highlighted (the list paginates; German is about 22 rows down), Enter.
  ** The console switches to German immediately: type only letters and digits without `y`/`z` from here; `@` is AltGr+Q and may not type — skip the email with Enter if so.
  * `Username>` `dieter`; `Password>` `prime`, `Confirm>` `prime`; `Full name>` `Dieter Test`; `Email address>` `dieter@example.org` (or Enter); `Hostname>` `debox01`.
  * `Timezone`: arrow to `Europe/Berlin` if a list is preselected, or type `Berlin` if it is a filter, then Enter → review table shows `Keyboard de`, `Hostname debox01`, `Timezone Europe/Berlin`; choose `Yes`.
  * Disk `/dev/vda` Enter; `Yes, install` Enter; wait for `Reboot Now` (5–10 minutes, screenshot every 5 s), Enter.
  * At the LUKS prompt type `prime`, Enter (letters are identical on de) → the desktop by autologin.
  * Open a terminal with Super+Enter and type `localectl status | head -3; hostnamectl hostname; timedatectl show -p Timezone --value; git config --global user.name; grep -E '<n>|<e>' ~/.XCompose` → `VC Keymap: de`, `X11 Layout: de`, `debox01`, `Europe/Berlin`, `Dieter Test`, filled XCompose bindings.
  * End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum choose does not filter on typing; use the arrows and screenshot to confirm the highlight before Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the review table with `de`/`debox01`/`Europe/Berlin` and of the terminal output after boot showing keymap, hostname, timezone, git identity and XCompose lines
  * If unsuccessful
  ** Screenshot of the value that did not land and `sudo grep -iE 'keymap|timezone' /var/log/omarchy-install.log | sudo tee /dev/ttyS0`
covers: configurator keyboard_form (loadkeys), omarchy-iso keyboard.py configure_keyboard, arch_install_system (hostname/timezone), install/user/{git,xcompose}.sh, install/hardware/set-wireless-regdom.sh, setup-form OMARCHY_KEYBOARD_LAYOUTS, test_keyboard.py

### install-deferred-provisioning-firstboot   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: "Prepare for another owner" installs with no user, reboots on its own without a LUKS prompt, and on first boot walks the owner through keyboard, account, hostname and timezone, then re-keys the disk to the owner's password and logs them in — the hand-over flow end to end.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; budget about 20 minutes.)

  <ActionList>
  * Greeter → Enter. At `Select keyboard layout` press Ctrl+C → `Prepare this machine for another owner?`; unhappy path: choose `No, keep setting up` → the picker returns; press Ctrl+C again and choose `Yes, prepare for another owner`.
  * The wizard jumps to `Select install disk` with no user form; Enter on `/dev/vda`; at `Everything will be overwritten…` choose `Yes, install` (encrypted).
  * The dashboard runs and, with **no** `Installed Omarchy in …` screen, the machine reboots by itself.
  ** Screenshot every 5 s; the install takes 5–10 minutes.
  * First boot: **no** LUKS prompt; the greeter `Press Return to Start Setup` appears → Enter; `Let's setup your keyboard...` → Down once (English (UK)), Enter.
  * Form: `Username>` `owner`; `Password>` `prime`, `Confirm>` `prime`; `Full name>` `New Owner`; `Email address>` type `owner`, then Shift+' (the UK `@`), then `example.org`, Enter; `Hostname>` `handed-over`; timezone → Enter on the guess (or `UTC`, Enter).
  * Review table (Keyboard `English (UK)`, Hostname `handed-over`, …) → `Yes` → `Setting up your machine` with bar and tips for 2–5 minutes → the desktop with no login prompt.
  * Open a terminal with Super+Enter and type `hostname; localectl status | head -2; ls /var/lib/omarchy/provisioning/; grep -c cryptkey /proc/cmdline; sudo cryptsetup luksDump /dev/vda2 | grep -cE '^\s+[0-9]+: luks2'; ls /etc/omarchy/provisioning.key /etc/sudoers.d/00-omarchy-wheel 2>&1` (password `prime`) → `handed-over`, keymap `uk`, only `packages` (and `groups`), `0`, `1`, the key absent and the wheel drop-in present.
  * Type `systemctl reboot`; this time the LUKS prompt **does** appear and `prime` unlocks it → autologin desktop. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Under English (UK) letters and digits match US; only `@`, `"` and `#` move.
  * `Setup hit an error` offers `Try again` / `Drop to console`: choose the console, `cat /var/log/omarchy-provision-owner.log | sudo tee /dev/ttyS0`, report, then `omarchy-provision-owner` to retry.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prepare confirm (both answers), the disk-first flow, the silent auto-reboot, the first-boot greeter with no LUKS prompt, the form, the progress bar, and the desktop
  ** Screenshot of the terminal checks (hostname, keymap uk, one keyslot, no cryptkey, no provisioning.key, wheel drop-in) and of the LUKS prompt on the second reboot
  * If unsuccessful
  ** Screenshot of a `Reboot Now` prompt (deferral not armed), a LUKS prompt on the first boot (auto-unlock missing), `Setup hit an error`, or a user-less SDDM greeter; `./client get-serial`
covers: configurator keyboard_form Ctrl+C/confirm_prepare_for_another_owner/deferred path, omarchy-iso context.py deferred handling, stage_provisioning_state/_stage_provisioning_luks_unlock, _validate_provisioning_state, configure_login (deferred), omarchy-install-dashboard OMARCHY_UI_DEFER_PROVISIONING, bin/omarchy-provision-owner, install/provisioning/*, manual/02 (Installing for another owner), omarchy-iso-test --provision, test_provisioning_state.py

### install-deferred-provisioning-form-errors   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: The first-boot owner form handles every escape hatch — Escape unwinds to the keyboard step, Ctrl+C offers a confirmed reboot and declining continues, bad answers are refused, and a reboot mid-setup simply restarts setup with the disk still auto-unlocking.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; budget about 20 minutes. Do the deferred install exactly as in install-deferred-provisioning-firstboot up to the first-boot greeter.)

  <ActionList>
  * Greeter → Enter. At `Let's setup your keyboard...` press Ctrl+C → `Setup starts again after the reboot.` / `Reboot this machine?`; choose `No, keep setting up` → the layout picker returns.
  * Enter (US). `Username>` `root`, Enter → `Username is reserved for system`; `owner`, Enter. `Password>` `prime`, `Confirm>` `wrong` → `Passwords didn't match!`; then `prime`/`prime`.
  ** Notices last one second — screenshot right after Enter.
  * `Full name>` press Escape → back to `Let's setup your keyboard...`; Enter, then redo `owner`, `prime`/`prime`, Enter, Enter; `Hostname>` `bad host`, Enter → the hostname notice; `owner-box`, Enter; timezone Enter.
  * At the review choose `No, change it` → the keyboard step again. Now press Ctrl+C and choose `Yes, reboot` → the machine reboots with no LUKS prompt and the greeter returns (setup is neither lost nor bypassed).
  * Complete the form once more (`owner`, `prime`/`prime`, defaults, `owner-box`) and `Yes` → `Setting up your machine` → the desktop.
  * Open a terminal with Super+Enter and type `hostname; ls /var/lib/omarchy/provisioning/` → `owner-box` and no `pending`. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A reboot before the review is safe by design: the setup service re-arms until `pending` is cleared.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the reboot confirm and its decline, the username/password/hostname notices, the Escape unwind, the `No, change it` loop, the mid-setup reboot returning to the greeter, and the finished desktop with `owner-box`
  * If unsuccessful
  ** Screenshot of Ctrl+C dropping to a shell, SDDM appearing without a user, or a notice with different wording; `cat /var/log/omarchy-provision-owner.log | sudo tee /dev/ttyS0`
covers: bin/omarchy-provision-owner (keyboard_form/confirm_reboot/user_form/run_setup), install/provisioning/setup-form.sh (OMARCHY_FORM_BACK/SIGNAL), install/provisioning/omarchy-provision-owner.service (re-arms while pending), test/shell.d/setup-form-test.sh

### install-failure-screen-and-retry   [VM-NO] [VM-OK-from-ISO]
description: When an install phase fails the dashboard shows the failure screen with the phase and error, offers View full log / Drop to shell / Reboot / Power off, and lets the operator repair and rerun from the shell — provoked by removing a helper from the live ISO's writable root.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; about 5 minutes, no install completes.)

  <ActionList>
  * At the greeter press Ctrl+Alt+F2, log in as `root` (no password), type `mv /usr/local/bin/omarchy-iso-cleanup-disk /root/`, Enter, then press Ctrl+Alt+F1.
  * Enter; keyboard Enter; form `fail`, `prime`/`prime`, Enter, Enter, Enter, Enter; review `Yes`; disk Enter; `Yes, install` Enter.
  * Within about 30 s the failure screen appears: `Omarchy installation stopped`, `Installer exited with status 1`, `last installer phase: Preparing live environment`, `failed phase: Preparing live environment: … No such file or directory: 'omarchy-iso-cleanup-disk'`, the log tail, `Get help at https://omarchy.org/discord`, and the menu `What would you like to do?` with `Upload log for support`, `View full log`, `Drop to shell`, `Reboot`, `Power off`.
  * Choose `View full log` → `less` shows `Phase 'Preparing live environment' failed`; press `q` → the failure screen is redrawn.
  * Choose `Drop to shell` → root prompt; type `mv /root/omarchy-iso-cleanup-disk /usr/local/bin/; lsblk -f /dev/vda` → the disk is still blank (the failure came before any write).
  * Type `./.automated_script.sh` → the greeter returns; walk the wizard to `Yes, install` again and watch the dashboard advance past the first phase for 60 s (bar moving, tips rotating). End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never choose `Upload log for support` (posts the log to a public paste), `Reboot` or `Power off` — they end the story early.
  * The failure text is centred and truncated to the logo width; the `failed phase:` line may end in `…`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the failure screen with the phase name and the five-item menu, of `less` with the phase error, of the redraw after `q`, of the untouched disk, and of the second run's dashboard advancing
  * If unsuccessful
  ** Screenshot of the dashboard hanging or exiting without the failure screen; `tail -30 /var/log/omarchy-install.log | tee /dev/ttyS0`
covers: omarchy-install-dashboard (render_failure, failure_menu, view_failure_log), orchestrator phases.py (PhaseError, failed phase in state.json), prepare_live, .automated_script.sh retry, omarchy-install-diagnose-media (no verdict for a non-media failure)

### install-offline-timezone-fallback   [VM-NO] [VM-OK-from-ISO]
description: Without network the installer still works fully offline: the timezone step falls back to a type-to-filter list instead of a geo-guess and an empty choice defaults to UTC.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (Fresh-ISO variant: `./client start` without `--resume`; about 5 minutes, no install completes.)

  <ActionList>
  * At the greeter press Ctrl+Alt+F2, log in as `root`, type `ip -br link` to find the NIC name, then `ip link set <nic> down; ip -br addr` → no IPv4 address; press Ctrl+Alt+F1.
  * Enter; keyboard Enter; form `offl`, `prime`/`prime`, Enter, Enter, Enter.
  * `Timezone` renders as a **filter** (a text field with `>` above the list) instead of a preselected list; type `Copenh` → the list narrows to `Europe/Copenhagen`; Enter → the review shows `Timezone Europe/Copenhagen`.
  * Choose `No, change it`, redo the form, and at `Timezone` press Enter on the empty filter → the review shows `Timezone UTC`.
  * Ctrl+C at `Username>` to abort; on tty2 type `ip link set <nic> up`. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `tzupdate` fails fast without a route; if the picker still comes preselected, the NIC was not down — check `ip -br addr` again.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the filter-style timezone picker, the narrowed `Europe/Copenhagen`, and the review table with `UTC` after an empty selection
  * If unsuccessful
  ** Screenshot of the wizard hanging at the timezone step, and the tty2 `ip -br addr` output
covers: install/provisioning/setup-form.sh (omarchy_prompt_timezone guess/filter/UTC), configurator (fully offline install), test/shell.d/setup-form-test.sh (timezone cases)

## Gaps

- **Unattended (cidata) installs** — `user_configuration.json` + `user_credentials.json` (or the `defer-provisioning` marker),
  `authorized_keys` → sshd enabled + `ufw allow ssh`, `tailscale_authkey` → first-boot tailnet join, the empty-keys failure
  (`contains no SSH keys`), the wizard fallback when a required file is missing, and the deferred-marker variant that installs
  the staged key for the owner. All need a second labelled drive attached to the VM — outside rule zero; only absence paths are covered.
- **Free-space / dual-boot installs** (mode picker `Free space install`, `Found a Windows ESP … leaving it untouched`, partitions
  created in freed slots, ESP at `/efi` when unencrypted, Windows entry survival), **the too-small-free-space screen with the
  cfdisk offer**, **BitLocker detection** and **a too-small full disk failing in the package phase** — all need a pre-partitioned
  or undersized fixture disk; the driver cannot supply one. The reference fixture is `bin/omarchy-iso-test-windows-disk`.
- **ISO boot menu entries** (speakup screen reader, Memtest86+, UEFI Shell, UEFI Firmware Settings) — GRUB `timeout=0` hidden;
  the driver cannot time a keypress into GRUB. BIOS/syslinux menu — the guest is UEFI only.
- **Media diagnosis** (`omarchy-install-diagnose-media`: damaged/misread/deleted package verdicts) — the live overlay is writable so
  a byte flip on a package under `/var/cache/omarchy/mirror/offline/` from tty2 is possible, but the failure lands minutes into
  pacstrap and the checksum-mismatch variant needs a remastered ISO. A candidate fresh-ISO story for later.
- **T2 Mac kernel selection** and every vendor quirk (ASUS, Apple, Dell, Framework, Lenovo, Surface, Tuxedo, NVIDIA, Intel
  iGPU/audio/Wi-Fi 7, Elgato) — only the absence path is testable here.
- **Fingerprint enrolment, FIDO2 registration** — USB hardware.
- **Deferred-provisioning autologin-once on an unencrypted machine** (`omarchy-provision-autologin-once.service`) — a deferred
  *unencrypted* install plus two reboots; a future variant of `install-deferred-provisioning-firstboot` with the Ctrl+C toggle.
- **Provisioning retry semantics** (`setup-user` pin, `Continuing setup for user`, `Retry first-boot setup?`, `Drop to console`,
  `User finalization reported errors`) — need an injected failure inside first-boot setup; inducible from the factory-reset cycle
  by emptying `/var/lib/omarchy/provisioning/packages` before the reboot, but that cycle is already at the session budget.
- **`omarchy-system-factory-reset-finish` abort/retry** (`wipe-pending` kept, provisioning refuses to run) — needs a failing btrfs
  operation at boot.
- **Hibernation swapfile recreation during reset** — visible as a log line only; resume-from-hibernation cannot run in the guest.
- **`omarchy-provision-user --force` full refresh** — network-heavy (mise stubs, hermes, muse); only partly covered by
  `firstrun-force-rerun-toasts`.
- **Install dashboard progress accuracy** — only observable as the bar's smoothness during a fresh install; the numbers are checked
  in `install-log-and-timing-clean`.
- **ISO build/sign/upload/release tooling** and the **`omarchy-iso-test`/`test/integration` harnesses** — host-side, need docker,
  1Password, R2 credentials; not guest behaviour.
