# 43 — Migrations, `omarchy-update`, channels, versions, Quattro upgrader

Source: `/tmp/omarchy-review/omarchy` @ `d174d4a` (2026-09-18, HEAD of master). Release tags fetched for
comparison: `v4.0.2` (`346e69e`, 2026-08-30 — what the minted disk runs) and `v4.0.4` (`c668141`,
2026-09-14 — the current stable release).

## Scope

Read completely:

| area | files | lines |
|---|---|---|
| `migrations/*.sh` | 121 files | 4286 |
| `agents/skills/migrations.md` | 1 | 172 |
| `docs/update-process.md` | 1 | 336 |
| `bin/omarchy-migrate`, `bin/omarchy-migrate-notify` | 2 | 162 |
| `bin/omarchy-update` + `bin/omarchy-update-*` | 22 | 858 |
| `bin/omarchy-channel-current`, `bin/omarchy-channel-set` | 2 | 133 |
| `bin/omarchy-version`, `-branch`, `-channel`, `-pkgs` | 4 | 80 |
| `bin/omarchy-upgrade-to-quattro` | 1 | 2410 (read: arg parsing, refusals, banner/confirm, `cleanup_on_exit`, the top-level step list at the bottom, every `fail`/`warn`/`log`/`gum confirm` line; skimmed the per-file transition helpers in the middle) |
| `default/libalpm/hooks/*.hook` | 3 | 35 |
| `default/pacman/*` | 6 | 105 |
| `manual/30-updates.md`, `manual/45-troubleshooting.md` | 2 | 86 |

Skimmed for maintainer invariants (only their `pass "..."` assertions and set-up): `test/shell.d/migrate-notify-test.sh`,
`migrate-scope-test.sh`, `migrate-wrapper-test.sh`, the 13 `update-*-test.sh`, `upgrade-to-quattro-test.sh`,
`channel-test.sh`, `version-test.sh`, `hook-state-name-guard-test.sh`, and the ~20 `*-migration-test.sh`.

Also consulted to pin down what the driver will see: `default/omarchy/omarchy-menu.jsonc` (Update submenu),
`shell/plugins/bar/widgets/SystemUpdate.qml`, `config/omarchy/shell.json` (bar layout), `bin/omarchy-mise-install`,
`bin/omarchy-refresh-config`, `bin/omarchy-refresh-pacman`, `bin/omarchy-dev-link` (usage), `bin/omarchy-provision-user`
(how the ISO seeds migration markers), `bin/omarchy-launch-floating-terminal-with-presentation`, `bin/omarchy-show-done`,
`bin/omarchy-snapshot`, `bin/omarchy-state`, `bin/omarchy-system-reboot`, `bin/omarchy-hook`, `install/omarchy-base.packages`
and `install/omarchy-other.packages` at both tags, `install/user/mise.sh` and `install/user/mise-work.sh` at `v4.0.2`.

Skipped: `bin/omarchy-update-stay-awake` internals beyond what `omarchy-update` calls (`start`/`stop`), the QML of the
notification service, the body of the Quattro user-transition helpers (lines ~1491–2258: hash tables of legacy config
files) — none of it is reachable on a 4.x disk without confirming the one-way upgrade.

## Inventory

#### Migration runner and notifier

- `omarchy-migrate` (`bin/omarchy-migrate`): runs every `/usr/share/omarchy/migrations/*.sh` without a marker in
  `~/.local/state/omarchy/migrations/<file>`; prints green `Running migration (<timestamp>)` then the migration's own first
  `echo`; runs each with `bash -euo pipefail`; a non-zero migration aborts the runner (set -e) and is **not** marked, so the
  queue stops there and later migrations stay pending. Waits up to 900 s while `/var/lib/pacman/db.lck` exists, printing
  `Waiting for pacman transaction to finish before running Omarchy migrations...`; after 900 s prints `Pacman transaction is
  still running; Omarchy migrations will retry on next login.` and exits 0. Ends by dismissing any `Omarchy Migrations`
  toast. Prints nothing when nothing is pending.
- `omarchy-migrate --pending` (alias `--check`): prints one pending filename per line, exit 0; nothing + exit 1 when none.
  `--help` prints `Usage: omarchy-migrate [--pending]`; any other flag → `Unknown option: <x>`, exit 1.
- `omarchy-migrate-notify` (`bin/omarchy-migrate-notify`, unit `default/systemd/user/omarchy-migrate-notify.service`,
  `WantedBy=graphical-session.target`, `After=graphical-session.target`): at every graphical login, if the update lock in
  `$XDG_RUNTIME_DIR/omarchy-update.lock` is not held and `omarchy-migrate --pending` lists something, waits for the
  notification server, re-checks the lock, then sends a **critical** toast titled `Pending Omarchy Migrations` with body
  `Click to run 1 pending migration.` / `Click to run N pending migrations.`; clicking runs
  `omarchy-launch-floating-terminal-with-presentation omarchy-migrate`. Never runs migrations itself.
- `omarchy-update-user-notify`: hidden compatibility wrapper that execs `omarchy-migrate-notify`.
- Marker seeding: `omarchy-provision-user --first-install` (ISO chroot) touches a marker for **every** shipped migration, so a
  fresh 4.0.2 install has 96 markers and runs only migrations added after 4.0.2 (`bin/omarchy-provision-user:123-128`).
- Machine-wide markers used by some migrations: `/var/lib/omarchy/migrations/<timestamp>` (root-owned), so a second user
  or a retry does not repeat a privileged repair.
- Manual re-run recipe (`agents/skills/migrations.md`): `rm ~/.local/state/omarchy/migrations/<id>.sh; omarchy-migrate`.

#### Update pipeline (`omarchy update` / `omarchy up` / `omarchy-update [-y]`; menu `Update → Omarchy`; bar update icon)

Order inside `bin/omarchy-update` (lines 10–65):

| step | script | what the user sees / does |
|---|---|---|
| transcript | `omarchy-update` re-execs itself under `script -qefc … /tmp/omarchy-update.log` | nothing visible; full transcript in `/tmp/omarchy-update.log` |
| lock | `omarchy-update-lock run` (flock on `$XDG_RUNTIME_DIR/omarchy-update.lock`) | a second concurrent update prints `An Omarchy update is already running.` exit 1 |
| free space | `omarchy-update-requires-free-space` | `< 10 GiB` avail on `/` → `You need at least 10 GiB free to safely update Omarchy.` (before the confirm box); because it is a plain `set -e` step the red `Something went wrong during the update!` ERR banner follows it, exit 1; `OMARCHY_UPDATE_FORCE=1` bypasses; unreadable `df` → silently skipped |
| confirm | `omarchy-update-confirm` (skipped by `-y`) | gum box `Ready to update?` with bullets `You cannot stop the update once you start!`, `Make sure you're connected to power…`, `What's new: https://github.com/omacom/omarchy/releases/latest` (4.0.2 disk still says `basecamp/omarchy`), then `Continue with update?` Yes/No; No → `Update cancelled` (the helper exits 1, but `omarchy-update` just falls out of its `if` and exits **0**, so a floating terminal ends with `Done!`) |
| prune | `omarchy-update-pkg-prune` → `sudo paccache -rk2` | heading `Prune package cache`; **first sudo prompt** here (`[sudo] password for prime:`) |
| snapshot | `omarchy-snapshot create` | `Create system snapshot`, snapper output, `Snapshots can be selected during boot.`; without snapper exit 127 → silently skipped; snapper unconfigured → yellow `Continuing the update without a snapshot.` |
| stay awake | `omarchy-update-stay-awake start` | `sudo -v` in a tty (pkexec otherwise); systemd-inhibit sleep:idle; sets the Stay Awake indicator if it was off |
| dev | `omarchy-update-dev` | no-op unless `OMARCHY_PATH != /usr/share/omarchy`; then `Update Omarchy dev checkout` + `git pull --ff-only` |
| keyring | `omarchy-update-keyring` | `Update Arch signing keys` … `Keys are correct`; bootstraps the Omarchy key `40DFB630…` if missing (`pacman-key --recv-keys`, `pacman -Sy`) |
| packages | `omarchy-update-system-pkgs` → `omarchy-update-pacman -Syu --noconfirm --overwrite '/usr/share/omarchy/*'` (runs pacman under `sudo env OMARCHY_UPDATE_PACMAN=1 systemd-run --scope`) | `Update system packages`, pacman progress; ALPM hooks `Checking Omarchy update entrypoint...` (passes), `Pausing Hyprland config auto-reload…` / `Reloading Hyprland after Omarchy settings update...`; on failure `exec`s `omarchy-update-system-pkgs-when-conflicted` |
| conflicts | `omarchy-update-system-pkgs-when-conflicted <report>` | unowned `pkg: /path exists in filesystem` from an `omarchy*` package → yellow `Taking over files pacman doesn't own yet:` + `  /path -> /var/lib/omarchy/replaced/path`, one retry; on retry failure `Putting back what the upgrade didn't take:`; `unresolvable package conflicts detected` → `A package conflict stopped this upgrade. Running it again so you can answer:` and an interactive pacman (never under `-y`: `This upgrade needs an answer. Run omarchy update interactively to give it.`); conflicts from non-Omarchy packages are left for a human (exit 1) |
| migrations | `omarchy-migrate` | see above; each pending migration prints `Running migration (<id>)` + its description |
| hooks | `omarchy-hook post-update` | runs `~/.config/omarchy/hooks/post-update` and `post-update.d/*` (`.sample` skipped); `Hook failed: <path>` on error |
| AUR | `omarchy-update-aur-pkgs` | only if `pacman -Qem` lists foreign packages: `Update AUR packages` + `yay -Sua --noconfirm`, or red `AUR is unavailable (so skipping updates)` |
| mise | `omarchy-update-mise` | `Update mise tools` + `MISE_MINIMUM_RELEASE_AGE=0 mise up` |
| orphans | `omarchy-update-orphan-pkgs` | lists orphans, `Remove N orphaned package(s)?` default **No**; non-tty/`-y` → `Re-run omarchy-update-orphan-pkgs in a terminal to review/remove them.` |
| log check | `omarchy-update-analyze-logs` | red `Error: Initramfs generation may have failed. Review logs before restart.` only if the transcript shows `Updating linux initcpios` without `Initcpio image generation successful` |
| status | `omarchy-update-status` | re-runs `omarchy-update-available`; refreshes or clears the bar `omarchy.system-update` widget |
| restart | `omarchy-update-restart` | `Linux kernel has been updated. Reboot?` (running kernel's `/usr/lib/modules/<ver>/vmlinuz` no longer pacman-owned) **or** `Updates require reboot. Ready?` (`~/.local/state/omarchy/reboot-required`) **or** `Hyprland has been updated. Reboot?`; Yes → `omarchy-system-reboot` (OSD `Rebooting`, windows closed, reboot in 2 s); then `Restarting <service>` for each `restart-*-required`, then green `Restarting shell` + `All plugins have been reloaded` |
| error trap | `omarchy-update` ERR trap | red `Something went wrong during the update!` … `get help from the community at https://omarchy.org/discord` |
| wrapper | `omarchy-launch-floating-terminal-with-presentation` (menu / bar icon) | logo first; at the end `● Done! Press any key to close...` or red `● Failed (exit code N)! Press any key to close...` |

Other update-family commands:

- `omarchy-update-available` (bar widget `omarchy.system-update`, runs at shell start and every 6 h; `omarchy-update-status`):
  prints `omarchy 4.0.2-N -> 4.0.4-N` (from `checkupdates`) and/or `omarchy-dev-checkout N new commits on origin/master`, exit 0;
  otherwise `Omarchy is up to date`, exit 1. Widget is a circle-arrows icon (`\uf021`) in the bar **center group, right of the
  clock** (after keyboard-layout and weather, `config/omarchy/shell.json`), visible only when updates exist; click launches
  `omarchy-update` in a floating terminal.
- `omarchy-update-pacman-guard` + `default/libalpm/hooks/00-omarchy-update-guard.hook` (PreTransaction, `Operation=Upgrade`,
  `AbortOnFail`): any pacman parent command with both `-S`/`--sync` and `-u`/`--sysupgrade` and neither
  `OMARCHY_UPDATE_PACMAN=1` nor `OMARCHY_ALLOW_DIRECT_PACMAN=1` prints `Woah partner...` … `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1
  pacman -Syu` and fails the transaction (pacman: `error: failed to commit transaction (failed to run transaction hooks)`).
  Because it is a *pre-transaction* hook it fires after the download and after `Proceed with installation? [Y/n]`.
- `default/libalpm/hooks/10-omarchy-hyprland-reload-pause.hook` / `90-…-resume.hook`: around `omarchy-settings(-dev)`
  install/upgrade, `omarchy-hyprland-reload-guard pause|resume` (resume forces one `hyprctl reload`).
- `omarchy-update-firmware` (menu `Update → Firmware`): `Update Firmware`; installs `fwupd` if missing; copies
  `fwupdx64.efi` to `/boot/EFI/arch/` under UEFI; `fwupdmgr refresh --force`; `sudo fwupdmgr update`. Not in the update pipeline.
- `omarchy-update-time` (menu `Update → Time`): `Updating time...` + `sudo systemctl restart systemd-timesyncd`.
- `omarchy-update-lock held|run`, `omarchy-update-pacman`, `omarchy-update-status`, `omarchy-update-stay-awake`,
  `omarchy-update-system-pkgs-when-conflicted`, `omarchy-update-requires-free-space`, `omarchy-update-pacman-guard`: hidden helpers.
- State files (`docs/update-process.md`): `/tmp/omarchy-update.log`, `$XDG_RUNTIME_DIR/omarchy-update.lock`,
  `~/.local/state/omarchy/migrations/`, `~/.local/state/omarchy/reboot-required`, `~/.local/state/omarchy/restart-*-required`,
  `/var/lib/omarchy/replaced/` (quarantined conflicting files).
- Bypass documented in `manual/30-updates.md`: `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu` skips snapshot and
  migrations; the login notifier then catches the missing markers.
- Rollback (`manual/30-updates.md`, `45-troubleshooting.md`): pick the pre-update snapshot in the Limine boot menu;
  `omarchy reinstall` resets configs (out of scope here).

#### Channel mechanism

- Channels: `stable` (packages `omarchy`+`omarchy-settings` from `https://pkgs.omarchy.org/stable/`, Arch mirror
  `stable-mirror.omarchy.org`, one month behind), `rc` (`omarchy` from `pkgs.omarchy.org/rc/`, `rc-mirror.omarchy.org`),
  `edge` (`omarchy-dev`+`omarchy-settings-dev` from `pkgs.omarchy.org/edge/`, `mirror.omarchy.org`), `dev` (edge packages plus
  `/etc/omarchy.conf` pointing `OMARCHY_PATH` at a git checkout in `~/omarchy`). Files: `default/pacman/pacman-{stable,rc,edge}.conf`
  (`SigLevel = Required DatabaseOptional`, `[omarchy]` Server line), `default/pacman/mirrorlist-{stable,rc,edge}`.
- `omarchy-channel-set <stable|rc|edge|dev>` (menu `Update → Channel → Stable/RC/Edge/Dev`, the active one is checked):
  no arg → `Usage: omarchy-channel-set [stable|rc|edge|dev]` exit 1; unknown → `Unknown channel: x` + usage exit 1; `dev` shows
  a warning paragraph and `Switch to dev channel?` (default No; No → `Cancelled.` exit 0), then clones
  `https://github.com/omacom/omarchy.git` into `~/omarchy` if absent, `omarchy-dev-link ~/omarchy --no-reboot`, sets
  `reboot-required`. All channels: `omarchy-refresh-pacman <chan>` (copies conf+mirrorlist, backs up to `.bak`, prints `Setting
  channel to <chan>`, runs `pacman -Syyuu --noconfirm`), `omarchy-update-pacman -S --needed --noconfirm --ask 4 <pkgs>` (swaps
  `omarchy` ↔ `omarchy-dev`), `omarchy-dev-unlink --no-reboot` for non-dev (reboot-required when leaving dev), then
  `omarchy-update -y`. ERR trap: `The channel switch did not complete. Review the error above, then rerun: omarchy-channel-set <chan>`.
- `omarchy-channel-current`: `dev` if `OMARCHY_PATH != /usr/share/omarchy`; `edge` if `omarchy-dev`+`omarchy-settings-dev`
  installed; else `stable`/`rc` from `omarchy-version-channel`'s first token; else `unknown`.
- `omarchy-version-channel`: sniffs `/etc/pacman.d/mirrorlist` and `/etc/pacman.conf`; prints `stable`|`rc`|`edge`|`unknown`,
  or `<mirror> / <pkgs>` when they disagree.
- Migration `1788112314` repoints an rc machine whose `[omarchy]` still says `edge/` to `rc/`.

#### Version scheme

- No runtime version file. `omarchy-version`: `dev (<short hash>)` when dev-linked; else `pacman -Q omarchy-dev` or `pacman -Q
  omarchy` → `<pkgver>-<pkgrel>` (e.g. `4.0.2-1` on the minted disk, `4.0.4-N` after a stable update); exit 1 with no output if
  neither package is installed. Repo `version` file says `4.0.0.alpha` at all three refs and is not consulted at runtime.
- `omarchy-version-branch` (hidden): current git branch or `detached@<hash>` of the dev checkout; exit 1 when package-backed.
- `omarchy-version-pkgs`: `date` of the last `upgraded` line in `/var/log/pacman.log`, formatted `Friday, September 18 2026 at 13:11`.
  On a disk that has never upgraded a package the grep is empty and `date -d ""` prints today at 00:00.
- Release tags: `v4.0.2` had 96 migrations, `v4.0.4` 106, HEAD 121.

#### Migrations — one line each (id · what it changes · user-visible? · reboot/relogin?)

Legend: **vis** = the user can see the effect on screen or via a command; **no-op here** = predicate false on the QEMU minted
disk (no such hardware/package/file); **R** = sets `reboot-required` or needs relogin; **sudo** = prompts for a password if the
sudo timestamp expired. All 96 in the first block already carry a marker on the 4.0.2 disk and **do not run** on update; they are
listed because `omarchy-migrate` after a marker removal, a second user, or the notifier can still reach them.

**Shipped in 4.0.2 (markers pre-seeded by the ISO; 96 files, `1784809451.sh` was deleted before 4.0.4):**

- `1778623107` install `mpv-mpris` · vis (`pacman -Q mpv-mpris`) · no R
- `1780057136` rewrite Shift+Enter/Alt+Shift+Enter bindings in alacritty/foot/ghostty/kitty configs to CSI-u · vis in config files · no R
- `1780294774` bar clock `formatAlt` leading zero removed in `~/.config/omarchy/shell.json` · vis (clock alt format) · no R
- `1780517689` add yt-dlp extension to `*-flags.conf`, install `yt-dlp`, register native host · vis (browser flags, `pacman -Q yt-dlp`) · browser restart
- `1780739888` `dua-cli` replaces `dust`; re-create `Disk Usage.desktop` TUI · vis (launcher) · no R
- `1781043107` move `~/.config/omarchy/current` → `~/.local/state/omarchy/current`, rewrite paths in terminal/hypr configs, relink btop/helix/vscode theme links · vis (paths) · no R
- `1781063758` `hyprland.lua` loads `default/hypr/bootstrap.lua` · vis in file · Hyprland reload
- `1781158082` relink `~/.config/nvim/lua/plugins/theme.lua` to state dir · vis (nvim theme) · no R
- `1781286586` `tensaku` replaces `satty` · vis (`pacman -Q`) · no R
- `1781485962` replace stock `input.lua`/`bindings.lua` with packaged defaults (sha-gated); marks `preinstalls-removed` for the "plain" bindings variant · vis (bindings) · Hyprland reload
- `1781587663` nvim remote clipboard provider + tmux `*:clipboard` feature · vis in files · no R
- `1781793381` install `udiskie` · vis · no R
- `1781984677` repair snapper config/timers via `install/config/snapper.sh` · not vis · sudo
- `1782002156` retire systemd-networkd, enable NetworkManager (live-upgrade aware) · vis (`systemctl`) · sudo
- `1782049344` hide `limine-snapper-notify.desktop` autostart · vis (no warning toast) · no R
- `1784401744` tmux M-Enter/M-S-Enter binds; install sof-firmware/vulkan-* per lspci (R if any); DX13260 text scale · partly no-op here · R conditional
- `1784476564` drop `/etc/vconsole.conf` from initramfs for non-Latin layouts, rebuild UKI · no-op (us layout) · R
- `1784479832` kitty `listen_on` socket line · vis in file · kitty restart
- `1784508556` `--password-store=gnome-libsecret` in chromium flags · vis in file · browser restart
- `1784510887` Brave Origin beta → stable · no-op here · no R
- `1784521870` reload/enable old notifier units · not vis · no R
- `1784568652` mask `NetworkManager-wait-online.service` · vis (`systemctl is-enabled`) · sudo
- `1784672586` switch to `quickshell-git` (`pacman -S --ask 4`) · vis (`pacman -Q`) · sudo, shell restart
- `1784763917` register Copy URL native host · vis (browser) · no R
- `1784767406` remove voxtype toggle, `hyprctl reload` (skipped under live Quattro upgrade) · not vis · no R
- `1784809452` delete leaked snapper timeline snapshots in batches of 20 · vis (`snapper list`) · sudo
- `1784818437` insert lid-state `pam_exec` gate before `pam_fprintd` in sudo/polkit PAM · no-op here (no fprintd) · sudo
- `1784909971` regenerate mise wrappers in `~/.local/bin` · vis (wrapper text) · no R
- `1784914435` Wi-Fi power save off (`nmcli reload`, `iw set power_save off`) · no-op here (no wlan) · sudo
- `1784917531` `initramfs_async=0` in Limine defaults + `limine-mkinitcpio` · vis (`/etc/limine-entry-tool.d/omarchy-defaults.conf`) · R (implicit)
- `1784960000` XPS 2026 speaker tuning · no-op here · no R
- `1784961000` apply zram sysctl, restart `dev-zram0.swap` or R · not vis · R conditional
- `1784970000` reload logind for `InhibitDelayMaxSec`; R if not effective · not vis · R conditional
- `1784989000` move `omarchy.indicators` left of the clock in `shell.json` · vis (bar) · no R
- `1785002349` repair remaining nvim theme symlink spellings · vis · no R
- `1785013000` remove `/etc/systemd/zram-generator.conf` when stock; else prints `Keeping … it has local edits.` · vis message · sudo
- `1785090473` (modified after 4.0.2) reinstall `libfprint-git` if fprintd lost its library · no-op here · no R
- `1785095882` enable `omarchy-migrate-notify.service`, drop old `.path` watcher enablement · not vis · relogin
- `1785101000` enable `omarchy-tailscale-receive.service` if tailscale present · no-op here · no R
- `1785166747` register both Chromium native hosts · vis (browser) · no R
- `1785167800` enable+start `omarchy-fcitx5.service`, kill stray fcitx5 · vis (compose works) · no R
- `1785189600` strip tmux alert hooks and `TmuxAlert` indicator from `shell.json` · vis (bar/tmux) · no R
- `1785273276` T2 Mac apple-bce → t2bce, `limine-update` · no-op here · R
- `1785344985` add `omarchy.agents` bar widget after tray · vis (bar, hidden until usage) · no R
- `1785351479` remove `kvantum`, `kvantum-qt5` · vis (`pacman -Q`) · sudo
- `1785424256` enable `systemd-oomd.service`, user `daemon-reload` · vis (`systemctl`) · sudo
- `1785511354` install `qrencode` · vis · no R
- `1785543725` add WhatsApp Slim extension to chromium flags · vis (browser) · browser restart
- `1785591762` same for `brave-origin-flags.conf` · no-op here · no R
- `1785608166` drop-in for `omarchy-sleep-lock.service`, restart it; **exits 1 (stays pending)** if the user manager cannot be reached · vis message · no R
- `1785608251` install `ddcutil` · vis · no R
- `1785617047` mise wrapper `omp` (unless `preinstalls-removed`) · vis (`~/.local/bin/omp`) · no R
- `1785633225` foot `[scrollback] multiplier=7.0` · vis in file · foot restart
- `1785637426` `omacalc` replaces `gnome-calculator` · vis (launcher) · no R
- `1785846769` mise wrappers `omp`, `grok`, `crush`; or remove stale `omp` · vis · no R
- `1785944594` T2 Mac suspend/fan/Touch Bar defaults · no-op here · R
- `1786098807` relink agent skill symlinks (`~/.agents/skills/omarchy` etc.) · vis (`ls -l`) · no R
- `1786099804` rename `omarchy.model-usage` → `omarchy.agents` in `shell.json`, prime usage files · vis (bar) · no R
- `1786137597` re-run `1785944594` (pipefail bug) · no-op here · —
- `1786181929` `PATH DEFAULT=…` in `/etc/security/pam_env.conf` · vis (`ssh host cmd` PATH) · sudo, relogin
- `1786183928` `omarchy-refresh-applications` · vis (launcher) · no R
- `1786273938` `herdr` package replaces `omarchy-herdr`/mise herdr; seed `~/.config/herdr/config.toml` · vis · no R
- `1786278735` `/etc/ssh/ssh_config.d/20-omarchy-keepalive.conf` · vis (`cat`) · sudo
- `1786279107` `omarchy-bar put omarchy.keyboard-layout --after omarchy.clock` · vis (bar, hidden with one layout) · no R
- `1786355450` `ttfx` replaces `python-terminaltexteffects` · vis (`pacman -Q`) · no R
- `1786380259` Bluetooth rfkill state, `#AutoEnable=true` in `/etc/bluetooth/main.conf`, machine marker · no BT here but still runs (`omarchy-bluetooth-power` on/off) · sudo
- `1786386460` install `libvips` · vis · no R
- `1786391100` brcmfmac `feature_disable` on Apple Broadcom Wi-Fi · no-op here · R
- `1786447584` install `zbar` · vis · no R
- `1786451567` repair literal-tilde theme symlinks · no-op here · no R
- `1786482992` rebuild boot image if booted cmdline lacks `omarchy-defaults.conf` params; prints `The booted kernel is missing …; rebuilding the boot image` · vis message · R (implicit), sudo
- `1786517850` `rm -rf ~/.cache/omarchy/notification-images` · not vis, harmless, **no sudo** — the safe one to un-mark in tests · no R
- `1786539345` link `diagnose-crash` skill, enable+start `omarchy-crash-watch.service` · vis (`systemctl --user`) · no R
- `1786549201` install `setup-agent.hook` as a post-update hook → agent-pick invitation toast after the update · vis (toast) · no R
- `1786567036` unmask `wpa_supplicant.service`, restart NM if wifi unavailable · no-op here · sudo
- `1786605598` rebuild initramfs when NVIDIA drops the `kms` hook · no-op here · R
- `1786643346` Chromium `Preferences` Copy URL shortcut repair; **prompts** `Close the browser windows to repair the Copy URL shortcut, then continue` (gum confirm) while an affected profile is open; declining → exit 1, stays pending · vis prompt · no R
- `1786782461` delete literal `\n[text-bindings]` line in `foot.ini` · vis in file · foot restart
- `1786952219` `mise-bin` replaces `mise` (`pacman -S --ask=4`) · no-op here (4.0.2 base already has `mise-bin`) · sudo
- `1787133200` install `qt6-imageformats` · vis · no R
- `1787399318` back to packaged `quickshell` from `quickshell-git` · vis (`pacman -Q`) · sudo, shell restart
- `1787481315` `omarchy-theme-refresh` (or `omarchy-theme-set "Tokyo Night"` with message `Theme 'x' no longer exists; applying the default instead`) · vis (theme re-staged) · no R
- `1787494718` chown root:root 644 `/etc/fido2/fido2` by inode replacement; critical toast `FIDO2 authfile needs attention` for symlink/non-file · no-op here · sudo
- `1787515927` harden Chromium/Firefox policy dirs, `omarchy-theme-set-browser` · vis (browser color) · sudo
- `1787580187` remove user from `docker` group via `omarchy-remove-security-sudoless-docker` (`OMARCHY_DEFER_REBOOT=1`), refresh `Docker.desktop` · vis (`id`) · R (group)
- `1787589206` drop `SigLevel = Optional TrustAll` from `[omarchy]`, bootstrapping the keyring first · vis (`/etc/pacman.conf`) · sudo
- `1787618700` touchpad/touchscreen toggle state Lua → name files, `hyprctl reload` · no-op here · no R
- `1787691200` write Chromium `initial_preferences` seed (`require_eula:false`) · vis (no EULA on first Chromium run) · sudo
- `1787815267` cups-browsed account sanity (fails loudly if not a system account), drop `cups-pdf`, add `cups-pk-helper`, restart cups, machine marker · vis (`pacman -Q`) · sudo
- `1787865477` remove user from `input` group unless xpadneo/ydotool; prints `Removed prime from the input group. Log out and back in to apply.` · vis message · R
- `1788009111` remove `cups-browsed` and its implicitclass queues; machine marker · vis (`pacman -Q`) · sudo
- `1788025225` delete retired `first-run`/`tsui` sudoers and home-path plymouth unit; **exits 1 with `Cannot complete the privileged installer-artifact repair…`** if sudo is refused · no-op here · sudo
- `1788102906` repair legacy `~/.XCompose` include; remove/quarantine Omarchy-3 udev power rules; `udevadm control --reload` · no-op here · sudo
- `1788112314` rc-channel `[omarchy]` repo edge→rc; prints `Switched the [omarchy] repository to the rc channel…` · no-op here (stable) · sudo
- `1788124236` sshd hardening: writes `/etc/ssh/sshd_config.d/10-omarchy-hardening.conf` if a usable key exists, else **disables sshd** with a long notice; several `skip` notices · no-op here (sshd not enabled) · sudo

**Added between v4.0.2 and v4.0.4 — these 11 run on the minted disk during a stable update, in this order:**

- `1787215483` `mise settings set upgrade.auto_prune false` · vis (`mise settings get upgrade.auto_prune` → `false`; `~/.config/mise/config.toml`) · no R · **NET no**
- `1787760281` `omarchy-install-hermes-cli` → mise-backed `~/.local/bin/hermes` stub (skips if `preinstalls-removed` or a user-owned `hermes` exists; defers to `hermes-desktop`) · vis (`ls ~/.local/bin`) · no R
- `1787843905` symlink every `default/agents/skills/*` into `~/.hermes/skills/` (+ per-profile) · vis (`ls -l ~/.hermes/skills`) · no R
- `1788577553` mise wrapper `~/.local/bin/cursor-agent` (unless a `cursor-agent` command already exists / preinstalls removed) · vis · no R
- `1788619462` `omarchy-theme-set-hermes --activate` · no-op here (no `hermes-desktop`) · no R
- `1788662350` replace user-owned `/usr/lib/systemd/system-sleep/{keyboard-backlight,force-igpu}` and `supergfxd` drop-in with root-owned copies; quarantine custom content under `/var/lib/omarchy/migrations/1788662350-system-sleep` · no-op here (already root-owned) · sudo only when repairing
- `1788724825` mise wrapper `~/.local/bin/muse` (Meta Muse Code, `http:` backend) · vis · no R
- `1788745941` **Kitty config**: stock 4.0.2 `~/.config/kitty/kitty.conf` (sha `856cd466…` — the 4.0.2 shipped file matches) is replaced by `omarchy-refresh-config kitty/kitty.conf` → red `Replaced /home/prime/.config/kitty/kitty.conf with new Omarchy default. Saved backup as …kitty.conf.bak.<epoch>.` + green `Changes:` + a diff; a customized file with `allow_remote_control yes` gets that line commented (`Unrestricted remote control disabled.`); either way a **gum box `Restart Kitty` / `Close and reopen all Kitty windows to apply this change.`** · vis in the update terminal and on disk · kitty restart
- `1788848726` delete stock `~/.local/share/fonts/omarchy.ttf` (sha-gated, **exit 1 if the packaged font is missing**), `fc-cache -f` · no-op here (fresh 4.x has no legacy font) · no R
- `1789325478` **Omarchy kernel**: on x86_64 non-T2, `omarchy-pkg-add linux-omarchy linux-omarchy-headers` (download), `BOOT_ORDER="linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"` appended to `/etc/default/limine` (previous BOOT_ORDER lines removed), `sudo limine-mkinitcpio linux-omarchy`, verifies `limine-entry-tool --tree` lists `linux-omarchy` (else `The Omarchy kernel has no Limine boot entry; rerun omarchy-migrate…` exit 1), `omarchy-state set reboot-required`, machine marker · vis (`pacman -Q linux-omarchy`, `/etc/default/limine`, reboot prompt, `uname -r` after reboot) · **R**, sudo, NET (kernel ~150–200 MB)
- `1789444024` `omarchy-pkg-add linux-omarchy-headers` / `linux-t2-headers` where the kernel is present · vis (`pacman -Q linux-omarchy-headers`) · no R

**Added between v4.0.4 and HEAD — these 15 additionally run on an edge/dev update (interleaved by timestamp with the 11 above):**

- `1786609204` install `qt6-multimedia qt6-multimedia-ffmpeg` (video wallpapers) · vis (`pacman -Q`) · no R
- `1786719479` Gemini → Antigravity: mise wrapper `~/.local/bin/agy` (4.0.2 disks have preinstalls, so it is created), `~/.config/omarchy/defaults/agent` `gemini`→`agy`, **deletes the 4.0.2-seeded `~/.local/bin/gemini` wrapper**, links skills into `~/.gemini/config/skills/` · vis (`ls ~/.local/bin`) · no R
- `1787215824` mise wrapper `hey` · vis · no R
- `1787342993` mise wrapper `ori` · vis · no R
- `1787573629` regenerate pre-`--quiet` mise wrappers · no-op here (4.0.2 `omarchy-mise-install` already writes `--quiet`) · no R
- `1787666837` Dell XPS 13 sidecar amps · no-op here · R
- `1788595060` register both Chromium native hosts again (Brave Origin) · vis (browser) · no R
- `1788596255` install `vi` · vis (`pacman -Q vi`, `which vi`) · no R
- `1788862626` Elgato Cam Link 4K relay · no-op here · no R
- `1788941927` mise wrapper `basecamp` · vis · no R
- `1789091250` `omarchy-install-ai-t3-code` if `t3code-bin` present · no-op here · no R
- `1789095456` `~/Work/.mise.toml`: 4.0.2's `install/user/mise-work.sh` wrote exactly the stock file (sha `bd04f191…` matches), so it is **deleted** after `mise trust --untrust`; a customized file has only its `_.path = "{{ cwd }}/bin"` line removed with a `.bak.XXXXXX` and messages `Automatic project bin directories were removed from your Mise PATH…`, `Mise trust for this custom config was revoked…` · vis (`ls -a ~/Work`) · no R
- `1789130779` write `~/.config/wireplumber/wireplumber.conf.d/kef-lsx-no-suspend.conf` (not hardware-gated), `try-restart wireplumber` · vis (`ls`) · no R
- `1789294350` `sysctl -p /etc/sysctl.d/99-omarchy-sysctl.conf` → `net.ipv4.tcp_congestion_control=bbr`, `net.core.default_qdisc=fq` (the file is shipped by the `omarchy-settings(-dev)` package, not this repo) · vis (`sysctl`) · R only if sysctl fails, sudo
- `1789310715` mise wrapper `cf` · vis · no R

#### `omarchy-upgrade-to-quattro` (3.x → 4.0 one-shot; shipped in 4.0.2 too)

- Flags: `-y/--yes`, `--reboot`, `--dev`, `--channel stable|rc|edge`, `--user USER`, `-h/--help`.
- Pre-mutation refusals (all `Error: …`, exit 1, nothing changed): `Unknown option: <x>`; `Invalid OMARCHY_UPGRADE_DEV value…`;
  `--dev needs the edge package repo; use --channel rc or --channel edge.` (with `--channel stable`); `Invalid channel 'x'. Use
  stable, rc, or edge.`; `This upgrade is only supported on Arch/Omarchy systems with pacman.`; `sudo is required when not running
  as root.`; `Could not determine the non-root Omarchy user. Re-run with --user USER.`; `User 'x' does not exist.`; `Home directory
  for 'x' was not found.`
- Interactive gate (without `-y`): clears the terminal, prints a QUATTRO ASCII banner, `Upgrading Omarchy to Quattro is a one-way
  street!` / `You cannot downgrade from Quattro.` / `Make sure you have a backup.`, then `gum confirm "Continue with upgrade?"`;
  **No → exit 0 silently**. Then `sudo -v` keepalive.
- **There is no "already on Quattro" guard.** Nothing between the argument parsing and `upgrade_started=1` checks for an
  installed `omarchy` package or `/usr/share/omarchy`; confirming Yes on a 4.x disk runs the full step list
  (snapshot, pacman channel rewrite with `.omarchy-upgrade-to-quattro.<ts>.bak` backups, keyrings, package installs, Limine
  normalisation, system/user transitions, `omarchy-migrate`, update steps, theme refresh) and ends with `Reboot to complete Quattro
  upgrade now?`. The script's own comments call re-running "safe and resumes", but it is a real mutation.
- Mid-run visible lines: green `==> …` per step (`Configuring Omarchy pacman repositories (<chan>)`, `Refreshing package
  databases and keyrings`, `Running Omarchy migrations`, `Checking for remaining system package updates`, …), yellow
  `Warning: …`, and on any failure after mutation started: red `Upgrade incomplete - do NOT reboot.` + explanation. Migrations
  failing → `Omarchy migrations did not complete. Fix the error above and rerun the upgrade before rebooting.`; pending →
  `Omarchy migrations are still pending. Rerun the upgrade before rebooting.` Ends with `WARNING: You must address any errors in
  the above before rebooting.`; `--reboot` reboots; else `Not rebooting. Please reboot manually…` on No.
- Migrations that special-case the live upgrade via `OMARCHY_UPGRADE_TO_QUATTRO_LIVE=1`: `1782002156`, `1784767406`, `1786567036`.

#### Menu entries and hotkeys in scope

- `Super+Space` → Omarchy menu → `Update` (aliases `restart`, `refresh`) → `Omarchy` (runs `omarchy-update` in a floating
  terminal), `Channel` → `Stable 🟢` / `RC 🟡` / `Edge 🟠` / `Dev 🔴` (checked = current), `Firmware`, `Time`, plus out-of-scope
  `Config`, `Extra Themes`, `Process`, `Hardware`, `Password`, `Timezone`.
- Bar: circle-arrows update icon right of the clock (click = update).
- Toast: `Pending Omarchy Migrations` (click = `omarchy-migrate` in a floating terminal).
- CLI: `omarchy update`, `omarchy up` (HEAD only), `omarchy-update [-y]`, `omarchy-migrate [--pending]`, `omarchy-version`,
  `omarchy-version-channel`, `omarchy-version-pkgs`, `omarchy-channel-current`, `omarchy-channel-set <chan>`,
  `omarchy-update-firmware`, `omarchy-update-time`, `omarchy-upgrade-to-quattro`.

## Observations

1. **What actually runs on the minted disk.** The 4.0.2 ISO pre-marks all 96 shipped migrations, so `omarchy update` on the
   stable channel runs exactly the 11 migrations added in 4.0.4 (list above), and an edge/dev update runs 26 (11 + 15). The only
   ones with an on-screen effect in the QEMU guest are: Kitty config replacement (red `Replaced …` + diff + `Restart Kitty` box),
   the Omarchy kernel install (pacman download, `limine-mkinitcpio` output, reboot prompt), mise wrapper creation (silent, files in
   `~/.local/bin`), `auto_prune` setting, and on edge: `vi`/`qt6-multimedia` installs, `gemini`→`agy`, `~/Work/.mise.toml` gone,
   the KEF wireplumber drop-in, BBR sysctl. Everything else is a predicate-false no-op that still prints its two header lines.
2. **Assumption to verify on first run:** the stable package repo (`pkgs.omarchy.org/stable`) serves `omarchy 4.0.4-N` and
   `omarchy-dev` on edge is built from current master. If stable is older, the "11 migrations" list shrinks accordingly; the
   proofs below therefore ask the driver to record the exact `Running migration (…)` lines rather than assert a count.
3. **Time budget.** The stable update downloads roughly one month of Arch updates for a full desktop plus the `linux-omarchy`
   kernel and headers, then `mise up` (node). Expect 400 MB–1.5 GB and well over five minutes on user-mode NAT; the ten-minute
   session budget is at risk. Every test that depends on the updated state repeats the precondition, so a harness that can run
   `update-terminal-run` first and keep the disk for the `post-update-*` tests will save an hour. The channel switches are worse:
   `omarchy-refresh-pacman` runs a full `pacman -Syyuu` **and then** `omarchy-update -y` runs another `-Syu`, and `dev` clones the
   whole repo first.
4. **sudo prompts.** Omarchy does not configure passwordless sudo. The first prompt appears right after `Continue with update?`
   (from `paccache`); the timestamp is refreshed by every later sudo, but a migration that reaches for `sudo` more than five
   minutes after the last one (e.g. the kernel migration after a long `mise up`) can prompt again mid-run. The driver must watch
   for `[sudo] password for prime:` at any point and type `prime`. In the floating terminal launched from the menu, `sudo -v` for
   the sleep inhibitor is what prompts; from a TTY without a terminal it would use `pkexec` (Polkit dialog).
5. **`-y` is not fully unattended.** `omarchy-update -y` skips the confirm and the orphan question, but `omarchy-update-restart`
   still asks `Reboot?`/`Ready?` via `gum confirm` in a terminal (it does not read `OMARCHY_UPDATE_UNATTENDED`). The docs call
   `-y` "a promise not to ask anything". Worth a ticket; the tests below answer the prompt explicitly.
6. **Reboot is expected after the first stable update.** Either the Arch `linux`/`linux-ptl` package is newer than on the ISO
   (`Linux kernel has been updated. Reboot?`) or the kernel migration set `reboot-required` (`Updates require reboot. Ready?`).
   After the reboot Limine boots `linux-omarchy` first (BOOT_ORDER). The driver then re-answers the LUKS passphrase and login.
   `omarchy-system-reboot` closes all windows first and reboots 2 s later, so the update terminal disappears before `Done!`.
7. **No 4.x guard in `omarchy-upgrade-to-quattro`.** The "refusal" a driver can test is only the interactive `Continue with
   upgrade?` → No (silent exit 0) and the argument errors. Answering Yes would start mutating a perfectly good 4.x system.
   The test below makes the driver answer No and verifies nothing changed. This is the most important finding for the tracker.
8. **Migration failures are loud and sticky.** A failing migration is not marked complete, `omarchy-migrate` exits non-zero,
   `omarchy-update` prints `Something went wrong during the update!` and skips hooks/mise/orphans/status/restart (so the shell
   is not restarted and the update icon is not cleared), and the next login toasts `Pending Omarchy Migrations`. Re-running
   `omarchy-migrate` resumes from the failed one. `update-stops-on-failed-migration` below simulates this by making
   `~/.config/mise` unwritable so `1787215483` (`mise settings set`) fails first; if mise happens to tolerate that, the fallback is
   `sudo touch /usr/bin/vi` on an edge update (breaks `1788596255`).
9. **Pacman lock vs update lock.** `update-lock-test.sh` covers the per-user `omarchy-update.lock` (second run → `An Omarchy
   update is already running.`). A `/var/lib/pacman/db.lck` is different: `omarchy-update-keyring`'s `pacman -Sy archlinux-keyring`
   fails with pacman's `unable to lock database` and the ERR trap fires; `omarchy-migrate` alone instead *waits* (up to 15 min)
   printing `Waiting for pacman transaction to finish…`. Both are cheap negatives; the lock file must be removed afterwards
   (`sudo rm /var/lib/pacman/db.lck`).
10. **Low disk space is simulable** with `fallocate` on btrfs (instant): drop free space under 10 GiB and the update refuses
    *before* the confirm box; `OMARCHY_UPDATE_FORCE=1` bypasses. Delete the file afterwards. Because the check is an ordinary
    `set -e` step, the refusal is followed by the generic red `Something went wrong during the update!` banner, which is a
    little alarming for a deliberate refusal (the shell tests only assert the first line). Conversely, **cancelling at the
    confirm box exits 0**: `omarchy-update` falls out of its `if` without an error, so the floating terminal ends with `Done!`.
11. **File conflicts are simulable** because `bin/*` is installed to `/usr/bin` outside the `--overwrite '/usr/share/omarchy/*'`
    glob. Touching `/usr/bin/omarchy-install-hermes-cli` (new in 4.0.4) as root makes pacman report `omarchy:
    /usr/bin/omarchy-install-hermes-cli exists in filesystem`; the handler quarantines it to `/var/lib/omarchy/replaced/usr/bin/…`
    and retries once. A conflict owned by another package or from a non-Omarchy package is deliberately *not* healed — not
    simulable without knowing which non-Omarchy package the mirror will upgrade.
12. **Pacman guard fires late.** `00-omarchy-update-guard.hook` is a PreTransaction hook, so a bare `sudo pacman -Syu` downloads
    every package first and only then aborts. `sudo pacman -Syu --ignore '*' bash` keeps the download to one small package (pacman
    asks `bash is in IgnorePkg/IgnoreGroup. Install anyway?`), still counts as a sysupgrade for the guard and as an `Upgrade`
    operation (reinstall) for the hook trigger.
13. **The login notifier can be triggered without logging out**: `systemctl --user restart omarchy-migrate-notify.service`. It
    stays silent while anything holds the update lock — `omarchy-update-lock run sleep 300 &` simulates an in-flight update.
14. **Safe marker to un-mark**: `1786517850.sh` (`rm -rf ~/.cache/omarchy/notification-images`): no sudo, no network, idempotent.
    Never un-mark `1788124236` (may disable sshd), `1787580187`/`1787865477` (group changes), `1789325478` (kernel).
15. **Second run is quiet, not "up to date".** No script prints the words "up to date" during a no-op update; the visible
    evidence is pacman's ` there is nothing to do`, no `Running migration` lines, no reboot prompt, and `omarchy-update-available`
    → `Omarchy is up to date` (exit 1) afterwards. The keyring step still prints `Update Arch signing keys` / `Keys are correct`
    every time and re-installs `archlinux-keyring`, so the second run still needs network.
16. **Version strings.** `omarchy-version` prints `<pkgver>-<pkgrel>` (`4.0.2-1`-style), never a bare `4.0.2`, and edge prints
    the `omarchy-dev` pkgver which follows its own scheme; dev prints `dev (<hash>)` **only after reboot** (OMARCHY_PATH comes
    from `/etc/omarchy.conf` at login). `omarchy-version-pkgs` on a never-updated disk prints today at 00:00 (empty grep).
17. **Kitty is not installed** on the minted disk but `~/.config/kitty/kitty.conf` is (from `/etc/skel`), so the Kitty migration
    still rewrites it and shows its box. The post-update file starts with `# Remove the include below to disconnect Kitty…` and
    no longer contains `allow_remote_control yes`.
18. **Quattro-live guards** (`OMARCHY_UPGRADE_TO_QUATTRO_LIVE`) and T2/Dell/Elgato/NVIDIA/Bluetooth/Wi-Fi migrations are
    predicate-false in the guest; they can only be shown to print their header and move on.
19. **Menu path spelling**: the manual says `Super + Space`; the existing `lock-screen` definition uses `Super+Escape`, which is
    the *System* submenu. For `Update → Omarchy` use `Super+Space` (root menu), then `Update`, then `Omarchy`. The menu is
    searchable: typing `update` filters.
20. **Snapshot proof**: `sudo snapper list` after an update shows a new `number` snapshot whose description is the pre-update
    `omarchy-version` string (`4.0.2-1`).

21. **Disk reuse for `post-update-*`.** The updated state costs 10+ minutes to reach. Every `post-update-*` test below opens
    with a precondition step: run it on the disk left by `update-menu-omarchy`/`update-terminal-run` (stable) or
    `channel-switch-edge-and-update` (edge); only if `omarchy-version` still shows the stock value does the driver run the
    update itself. A harness that keeps the updated disk between those tickets saves the repeat.

## Proposed tests

All steps are things a user does inside the guest: press a hotkey, click a menu entry, type into a terminal opened with
`Super+Enter`, read the screen. Long terminal output is pushed to the serial log with `… | sudo tee /dev/ttyS0`.
Password for every `[sudo] password for prime:` prompt is `prime`.

### update-menu-omarchy   [VM-OK] [NET] [SLOW]
description: Update → Omarchy from the Omarchy menu runs the whole update on a 4.0.2 install — confirm box, snapshot, packages, the migrations added since 4.0.2, reboot — and comes back on the new release with the Omarchy kernel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, type `omarchy-version` and note the value (expected `4.0.2-…`), then `exit`.
  * Open the Omarchy menu with Super+Space and click `Update`, then `Omarchy`, using the mouse.
  ** A floating terminal titled Omarchy shows the logo, then a boxed `Ready to update?` text ending in `Continue with update?` with Yes/No.
  * Choose Yes. Type `prime` when `[sudo] password for prime:` appears; do so again whenever it reappears later in the run.
  * Watch the run; take a screenshot every few seconds so the scrolling text is captured.
  ** Expected headings in order: `Prune package cache`, `Create system snapshot` (`Snapshots can be selected during boot.`), `Update Arch signing keys` / `Keys are correct`, `Update system packages` with pacman downloading and installing, then green `Running migration (<number>)` lines each followed by a one-line description, then `Update mise tools`.
  ** Expected migration numbers on a stable update: 1787215483, 1787760281, 1787843905, 1788577553, 1788619462, 1788662350, 1788724825, 1788745941, 1788848726, 1789325478, 1789444024. Note any difference.
  ** Under `Running migration (1788745941)` a red `Replaced /home/prime/.config/kitty/kitty.conf with new Omarchy default.` line, a diff, and a rounded box `Restart Kitty` / `Close and reopen all Kitty windows to apply this change.` must appear. Under `(1789325478)` pacman installs `linux-omarchy`.
  ** If `Remove N orphaned package(s)?` appears answer No. No red `Something went wrong during the update!` may appear.
  * At the end the question `Linux kernel has been updated. Reboot?` or `Updates require reboot. Ready?` appears. Screenshot it, then answer Yes.
  ** A `Rebooting` message shows, windows close, the machine reboots. Enter the disk passphrase `prime`; log in as `prime`/`prime` if a login screen appears.
  * Back on the desktop open a terminal and type `omarchy-version; uname -r; pacman -Q linux-omarchy; omarchy-migrate --pending; echo pending=$?`.
  ** The version is newer than at the start (expected `4.0.4-…`), `linux-omarchy` is listed, nothing is pending and `pending=1`. The circle-arrows update icon right of the clock is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The download phase can take many minutes; keep taking screenshots rather than sleeping. After the reboot, `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` is not available (the log lives in /tmp), so the screenshots during the run are the transcript.
  * gum questions accept `y`/`n` as well as Enter on the highlighted button. Enter on `Continue with update?` means Yes.
  * The menu filters as you type, but this test wants the mouse for the two menu clicks.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Ready to update?` box, the sudo prompt, `Update system packages` in progress, the `Running migration` lines (all eleven visible across screenshots), the `Restart Kitty` box, the reboot question, and the post-reboot terminal with the new version, `uname -r`, `linux-omarchy` and `pending=1`.
  ** Post-reboot bar screenshot without the update icon.
  * If unsuccessful
  ** The screenshot with the red `Something went wrong during the update!` banner or `Failed (exit code N)`, and, if the machine does not come back, the Limine menu / emergency shell plus `get-serial`.
covers: bin/omarchy-update, bin/omarchy-update-confirm, bin/omarchy-update-pkg-prune, bin/omarchy-snapshot, bin/omarchy-update-keyring, bin/omarchy-update-system-pkgs, bin/omarchy-migrate, migrations 1787215483…1789444024, bin/omarchy-update-restart, bin/omarchy-system-reboot, default/omarchy/omarchy-menu.jsonc update.omarchy, manual/30-updates.md, test/shell.d/update-sequence-test.sh

### update-terminal-run   [VM-OK] [NET] [SLOW]
description: `omarchy update` typed in a terminal runs the same pipeline as the menu, its transcript in /tmp/omarchy-update.log shows the pacman guard letting the update through and the Hyprland reload hooks pausing and resuming, and a snapper snapshot labelled with the old version exists afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-version; sudo snapper list | tail -2` (password `prime`). Note the version and the last snapshot number.
  * Type `omarchy update`. At the boxed `Ready to update?` question choose Yes; type `prime` at every sudo prompt.
  ** The same headings as the menu path scroll by: `Prune package cache`, `Create system snapshot`, `Update Arch signing keys`, `Update system packages`, `Running migration (…)` lines, `Update mise tools`. Answer No to `Remove N orphaned package(s)?` if asked.
  * When `Linux kernel has been updated. Reboot?` or `Updates require reboot. Ready?` appears, answer **No** for this test.
  ** Green `Restarting shell` / `All plugins have been reloaded` follow; the bar blinks off and on.
  * Type `omarchy-version; sudo snapper list | tail -2`.
  ** The new version (expected `4.0.4-…`) and one new snapshot whose description is the old version string.
  * Type `grep -n 'Woah partner\|Checking Omarchy update entrypoint\|Pausing Hyprland\|Reloading Hyprland\|Running migration' /tmp/omarchy-update.log | sudo tee /dev/ttyS0` and read it with the serial log.
  ** `Checking Omarchy update entrypoint...`, `Pausing Hyprland config auto-reload…` and `Reloading Hyprland after Omarchy settings update...` are present; `Woah partner` is absent; the `Running migration` lines match what you saw.
  * Type `omarchy-hyprland-reload-guard paused; echo paused=$?; hyprctl getoption misc:disable_autoreload | grep int`.
  ** `paused` is non-zero and `int: 0` — the settings upgrade left Hyprland's auto-reload enabled.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Declining the reboot leaves the `reboot-required` marker in place; the next update will ask again. Reboot before running `update-second-run-nothing-to-do` on this disk.
  * The run is long; screenshot repeatedly instead of sleeping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the confirm box, migration lines, the reboot question answered No, `Restarting shell`, the new version with the new snapshot row, and the `paused`/`int: 0` line; serial log containing the grep with the hook lines and no `Woah partner`.
  * If unsuccessful
  ** Screenshot of the failing step; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-update (script transcript), bin/omarchy-snapshot, bin/omarchy-update-restart, bin/omarchy-update-pacman, default/libalpm/hooks/00-omarchy-update-guard.hook, 10-omarchy-hyprland-reload-pause.hook, 90-omarchy-hyprland-reload-resume.hook, docs/update-process.md "State and coordination files" and "Raw pacman guard", test/shell.d/update-sequence-test.sh, update-pacman-guard-test.sh "allows omarchy update pacman call"

### update-second-run-nothing-to-do   [VM-OK] [NET] [SLOW]
description: Running `omarchy update -y` on an already-updated machine is a quiet no-op — no confirm box, no orphan question, pacman says there is nothing to do, no migration runs — and the update checker then reports Omarchy is up to date.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `update-menu-omarchy` (updated and rebooted). If a terminal (Super+Enter) shows `omarchy-version` still at `4.0.2-…`, type `omarchy update -y`, type `prime` at sudo prompts, answer Yes to the reboot question, and come back to the desktop.
  * Open a terminal with Super+Enter and type `omarchy update -y`.
  ** No `Ready to update?` box: the first output is `Prune package cache`, then the sudo prompt (type `prime`).
  ** Then `Create system snapshot`, `Update Arch signing keys` / `Keys are correct`, `Update system packages` followed by pacman's ` there is nothing to do`, **no** `Running migration` line, `Update mise tools`.
  ** If an `Orphan system packages` list appears it ends with `… found. Re-run omarchy-update-orphan-pkgs in a terminal to review/remove them.` and asks nothing.
  * The run ends with `Restarting shell` / `All plugins have been reloaded` and no reboot question (the disk was rebooted). If a `Reboot?` question does appear, answer No and note it: `-y` still asks about reboots.
  * Type `omarchy-update-available; echo exit=$?`.
  ** `Omarchy is up to date` and `exit=1`. The bar shows no update icon right of the clock.
  * Type `omarchy-migrate --pending; echo pending=$?; omarchy-migrate; echo migrate=$?` — nothing listed, `pending=1`, no output from `omarchy-migrate`, `migrate=0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The keyring step still contacts the mirror on every run, so this needs network even though nothing is installed.
  * A reboot question here means the precondition disk was not rebooted; that is not a failure of this test but must be reported.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the run starting without the confirm box, ` there is nothing to do` with no `Running migration` line, the orphan section (if any) without a question, `Omarchy is up to date` / `exit=1`, `pending=1` and the silent `omarchy-migrate`; bar without the update icon.
  * If unsuccessful
  ** Screenshot of a confirm box or orphan question under `-y`, any `Running migration` line, or an error; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-update (-y / OMARCHY_UPDATE_UNATTENDED), bin/omarchy-update-orphan-pkgs, bin/omarchy-update-restart, bin/omarchy-migrate (idempotence), bin/omarchy-update-available, bin/omarchy-update-status, docs/update-process.md "-y exports OMARCHY_UPDATE_UNATTENDED=1", test/shell.d/update-orphan-test.sh, update-status-test.sh, migrate-scope-test.sh "skips completed migrations"

### update-available-indicator   [VM-OK] [NET]
description: On a 4.0.2 install the bar shows the circle-arrows update icon right of the clock and `omarchy-update-available` names the newer package; clicking the icon opens the updater, and backing out at the question changes nothing and closes with Done.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the top bar to the right of the clock and take a screenshot. A circle-arrows icon is expected (allow up to a minute after login for the check).
  * Open a terminal with Super+Enter and type `omarchy-update-available; echo exit=$?`.
  ** Expected: a line like `omarchy 4.0.2-1 -> 4.0.4-1` and `exit=0`.
  * If the icon was not visible yet, type `omarchy-shell -q omarchy.system-update refresh`, wait five seconds and screenshot the bar again: the icon must be there now.
  * Click the update icon with the mouse.
  ** A floating Omarchy terminal opens with the logo and the boxed `Ready to update?` text. No password prompt appears before the question.
  * Choose **No** at `Continue with update?`.
  ** `Update cancelled` then `● Done! Press any key to close...` — a cancel is not an error exit. Press a key; the terminal closes.
  * In your terminal type `omarchy-version` — still `4.0.2-…`; the update icon is still in the bar.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar's centre group is indicators, clock, (hidden keyboard-layout), weather, update icon; the update icon is the small rotating-arrows glyph.
  * `checkupdates` needs the network; give the first command up to 30 seconds.
  * Double-check the mouse position on the small icon before clicking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar with the update icon, the terminal with the `omarchy … -> …` line and `exit=0`, the cancelled updater with `Update cancelled` and `Done!`, and the unchanged `omarchy-version` with the icon still present.
  * If unsuccessful
  ** Screenshot of the bar without the icon and the `omarchy-update-available` output (e.g. `Omarchy is up to date` or an error), or of a sudo prompt / snapshot text before the question.
covers: bin/omarchy-update-available, shell/plugins/bar/widgets/SystemUpdate.qml, bin/omarchy-update-confirm, bin/omarchy-update (cancel exits 0), bin/omarchy-launch-floating-terminal-with-presentation, manual/30-updates.md (update-available icon), test/shell.d/update-available-test.sh

### update-rejects-overlapping-run   [VM-OK]
description: A second `omarchy update` while one is already open (even one still at its question) is refused with `An Omarchy update is already running.`, and the refusal lifts as soon as the first one is cancelled.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy update`. Leave it at `Continue with update?` — do not answer.
  * Open a second terminal with Super+Enter (Hyprland tiles it next to the first).
  * In the second terminal type `omarchy update; echo exit=$?`.
  ** Expected: the single line `An Omarchy update is already running.` and `exit=1`; no box, no sudo prompt.
  * Click into the first terminal and answer **No** → `Update cancelled`.
  * In the second terminal type `omarchy update` again: the `Ready to update?` box appears now (lock released). Answer No.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock is taken before the question, so the first update holds it without any answer.
  * Hover/click a terminal before typing so the keys go to the right window.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing both terminals: one at the confirm box, the other with `An Omarchy update is already running.` / `exit=1`; then the released state with the box appearing in the second terminal.
  * If unsuccessful
  ** Screenshot of the second update reaching its own confirm box or a sudo prompt while the first is open.
covers: bin/omarchy-update-lock, bin/omarchy-update (lock acquisition), test/shell.d/update-lock-test.sh "prevents overlapping top-level updates"

### update-rejects-pacman-lock   [VM-OK] [NET]
description: With a stale pacman database lock in place the update fails loudly at the keyring step with pacman's `unable to lock database` error and the red `Something went wrong during the update!` banner, and works again once the lock file is removed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo touch /var/lib/pacman/db.lck; ls -l /var/lib/pacman/db.lck` (password `prime`).
  * Type `omarchy update`, choose Yes at `Continue with update?`, type `prime` if asked.
  ** `Prune package cache` and `Create system snapshot` run normally.
  ** Under `Update Arch signing keys` pacman prints `error: failed to init transaction (unable to lock database)` / `could not lock database: File exists` and the red multi-line `Something went wrong during the update!` banner follows. No `Update system packages` and no `Running migration` line appear.
  * Type `omarchy-version` — unchanged `4.0.2-…`.
  * Type `sudo rm /var/lib/pacman/db.lck; ls /var/lib/pacman/db.lck` — `No such file or directory`.
  * Type `omarchy update` once more: the `Ready to update?` box appears; answer **No** (`Update cancelled`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The failure comes right after the snapshot, so the whole run is under a minute.
  * If the run instead stops at `Prune package cache`, report it — that step is not expected to need the pacman lock.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the lock file listing, the pacman lock error under `Update Arch signing keys` with the red banner, unchanged `omarchy-version`, the removed lock, and the working confirm box afterwards.
  * If unsuccessful
  ** Screenshot if the update hangs, proceeds past the keyring step, or the lock cannot be removed; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-update (ERR trap), bin/omarchy-update-keyring, bin/omarchy-update-system-pkgs, docs/update-process.md Path 1

### migrate-waits-for-pacman-lock   [VM-OK]
description: `omarchy-migrate` refuses to run migrations while pacman holds its database lock — it prints a waiting line and continues by itself once the lock disappears — so migrations never run against a half-installed package set.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `rm -f ~/.local/state/omarchy/migrations/1786517850.sh; omarchy-migrate --pending` — expect `1786517850.sh` (one harmless migration pending).
  * Type `sudo touch /var/lib/pacman/db.lck` (password `prime`), then `omarchy-migrate`.
  ** `Waiting for pacman transaction to finish before running Omarchy migrations...` is printed and the command keeps waiting: no `Running migration` line, the prompt does not return. Screenshot after ten seconds.
  * Open a second terminal with Super+Enter and type `sudo rm /var/lib/pacman/db.lck`.
  * Click back into the first terminal: within a couple of seconds it prints `Running migration (1786517850)` / `Drop the retired notification image cache` and returns to the prompt.
  * Type `omarchy-migrate --pending; echo pending=$?; ls /var/lib/pacman/db.lck` — nothing listed, `pending=1`, `No such file or directory`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The waiter polls once a second for up to 15 minutes; remove the lock after your screenshot, do not wait it out.
  * Migration 1786517850 only deletes an empty cache directory; it is safe to re-run.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `Waiting for pacman transaction…` line with nothing running while the lock exists, then the screenshot after removal showing `Running migration (1786517850)`, then `pending=1` with the lock gone.
  * If unsuccessful
  ** Screenshot of the migration running while the lock file exists, or of the command not resuming after the lock is removed.
covers: bin/omarchy-migrate wait_for_pacman_transaction, agents/skills/migrations.md "waits for any active pacman transaction", migrations/1786517850.sh

### update-rejects-low-disk-space   [VM-OK]
description: With less than 10 GiB free on `/` the update stops before asking anything with `You need at least 10 GiB free to safely update Omarchy.`, `OMARCHY_UPDATE_FORCE=1` bypasses the check, and deleting the filler restores normal behaviour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `df -h /`; note `Avail` (expected 25–35G).
  * Type `fallocate -l 25G ~/fill.img; df -h /`. `Avail` must now be below 10G; if not, type `fallocate -l 5G ~/fill2.img; df -h /` and check again.
  * Type `omarchy update; echo exit=$?`.
  ** Expected: `You need at least 10 GiB free to safely update Omarchy.` followed by the red `Something went wrong during the update!` banner and `exit=1`. No `Ready to update?` box, no sudo prompt.
  * Type `OMARCHY_UPDATE_FORCE=1 omarchy update`.
  ** The `Ready to update?` box appears despite the low space. Answer **No** → `Update cancelled`.
  * Type `rm -f ~/fill.img ~/fill2.img; df -h /` — the original free space is back.
  * Type `omarchy update` once more: the box appears; answer No.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `fallocate` on btrfs returns instantly; if it says "No space left", use a smaller size and add a second file.
  * The generic red banner after the refusal is expected: the free-space check is an ordinary failing step.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `df -h /` under 10G, the refusal line plus banner with `exit=1`, the forced run showing the confirm box, and the restored free space with the box appearing again.
  * If unsuccessful
  ** Screenshot of the update reaching the confirm box with under 10G free, or of the forced run still refusing, or of the filler file failing to delete.
covers: bin/omarchy-update-requires-free-space, bin/omarchy-update (free-space step before confirm), docs/update-process.md "free-space requirement", test/shell.d/update-disk-space-test.sh

### update-heals-unowned-file-conflict   [VM-OK] [NET] [SLOW]
description: When a file the new `omarchy` package installs already exists unowned on disk, the update does not die on pacman's `exists in filesystem` error — it moves the file to /var/lib/omarchy/replaced, retries once, and completes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo touch /usr/bin/omarchy-install-hermes-cli; pacman -Qo /usr/bin/omarchy-install-hermes-cli` (password `prime`) — expect `error: No package owns /usr/bin/omarchy-install-hermes-cli`.
  * Type `omarchy update`, answer Yes, type `prime` at sudo prompts.
  ** Under `Update system packages` pacman fails with `error: failed to commit transaction (conflicting files)` and `omarchy: /usr/bin/omarchy-install-hermes-cli exists in filesystem`.
  ** Right after, a yellow `Taking over files pacman doesn't own yet:` heading with `  /usr/bin/omarchy-install-hermes-cli -> /var/lib/omarchy/replaced/usr/bin/omarchy-install-hermes-cli`, then a second `Update system packages` heading and a successful pacman run, then the migrations.
  * Answer No to any orphan question and No to the reboot question.
  * Type `ls -l /var/lib/omarchy/replaced/usr/bin/; pacman -Qo /usr/bin/omarchy-install-hermes-cli; omarchy-version`.
  ** The quarantined empty file is listed, the live path is owned by `omarchy`, the version is the new one.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot as soon as the pacman error appears; the yellow handler text follows within seconds.
  * The path must be outside /usr/share/omarchy (that tree is overwritten unconditionally) and new in the target release. If `pacman -Qo` already reports the path as owned, note it and use `/usr/bin/omarchy-update-pacman` (new in HEAD) on an edge disk instead.
  * This leaves the disk updated but not rebooted; end with `stop` or reboot before reusing it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unowned check, the pacman conflict error, the yellow `Taking over files…` block with the `->` line, the second successful `Update system packages`, and the final `ls`/`pacman -Qo`/`omarchy-version` output.
  * If unsuccessful
  ** Screenshot of the update stopping with `Something went wrong` after the conflict, or of `Putting back what the upgrade didn't take:`; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-update-system-pkgs, bin/omarchy-update-system-pkgs-when-conflicted, docs/update-process.md conflict handler, test/shell.d/update-file-conflict-test.sh

### update-stops-on-failed-migration   [VM-OK] [NET] [SLOW]
description: A migration that fails stops the queue, stays pending, and ends `omarchy update` with the red `Something went wrong` banner; after the cause is fixed a plain `omarchy-migrate` resumes from that migration and finishes the rest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `chmod 555 ~/.config/mise; ls -ld ~/.config/mise` — the directory shows `dr-xr-xr-x`.
  * Type `omarchy update`, answer Yes, type `prime` at sudo prompts, and wait through the package upgrade.
  ** The first migration is `Running migration (1787215483)` / `Stop mise upgrades from pruning versions still in use`; `mise settings set` fails with a permission/read-only error; **no** further `Running migration` line; the red `Something went wrong during the update!` banner is printed and the prompt returns. No `Update mise tools`, no reboot question, no `Restarting shell`.
  * Type `omarchy-migrate --pending | sudo tee /dev/ttyS0` — the list starts with `1787215483.sh` and includes the others (`1788745941.sh`, `1789325478.sh`, …).
  * Type `chmod 755 ~/.config/mise; ls -ld ~/.config/mise` — back to `drwxr-xr-x`.
  * Type `omarchy-migrate` (type `prime` at sudo prompts).
  ** `Running migration (1787215483)` runs again, then every remaining migration in order (the `Restart Kitty` box, the kernel install…) with no error.
  * Type `omarchy-migrate --pending; echo pending=$?; omarchy-version` — nothing pending, `pending=1`, the new version.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `mise settings set` unexpectedly succeeds with the read-only directory, report it; the fallback is to break the edge-only `vi` migration on an edge disk with `sudo touch /usr/bin/vi` before the update.
  * The bar is not restarted after a failed update, so the update icon stays until the manual `omarchy-migrate` and a later `omarchy update`.
  * This leaves the disk updated but not rebooted; end with `stop` or reboot before reusing it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the read-only directory, the failing migration output followed directly by the red banner, the serial log listing `1787215483.sh` first, the restored permissions, the manual `omarchy-migrate` running the remaining migrations, and `pending=1` with the new version.
  * If unsuccessful
  ** Screenshot showing a later migration running after the failed one, the failed migration missing from `--pending`, or `Restarting shell` after the failure; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-migrate (set -e, marker only on success), bin/omarchy-update (ERR trap, ordering), agents/skills/migrations.md "strictly ordered and synchronous", migrations/1787215483.sh, test/shell.d/migrate-scope-test.sh "does not mark failed migrations complete", update-sequence-test.sh

### migrate-rerun-is-idempotent   [VM-OK]
description: `omarchy-migrate` is safe to run any number of times — silent when nothing is pending, runs exactly the un-marked migration once, silent again — and rejects an unknown option with a usage error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/migrations | wc -l; omarchy-migrate --pending; echo pending=$?` — expect `96` on a stock 4.0.2 disk, no list, `pending=1`.
  * Type `omarchy-migrate; echo exit=$?` — no output except `exit=0`.
  * Type `rm ~/.local/state/omarchy/migrations/1786517850.sh; omarchy-migrate --pending; echo pending=$?` — `1786517850.sh` and `pending=0`.
  * Type `omarchy-migrate; echo exit=$?` — green `Running migration (1786517850)`, `Drop the retired notification image cache`, `exit=0`.
  * Type `omarchy-migrate; echo exit=$?; ls ~/.local/state/omarchy/migrations/1786517850.sh` — no `Running migration` line, `exit=0`, the marker is back.
  * Type `omarchy-migrate --bogus; echo exit=$?; omarchy-migrate --help` — `Unknown option: --bogus`, `exit=1`, then `Usage: omarchy-migrate [--pending]`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only un-mark 1786517850; other migrations may need sudo or network, or change groups and the kernel.
  * All output fits one terminal screen; one screenshot per command is enough.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing the silent first run, the pending listing, the single `Running migration (1786517850)` run, the silent re-run with the marker restored, and the `Unknown option` / usage lines.
  * If unsuccessful
  ** Screenshot of output or a non-zero exit on the silent runs, the migration running twice, or the marker missing after a successful run.
covers: bin/omarchy-migrate (--pending, run, option parsing), agents/skills/migrations.md "Manually" and "Testing migrations", migrations/1786517850.sh, test/shell.d/migrate-wrapper-test.sh

### migrate-notify-login-toast   [VM-OK]
description: A user with pending migrations gets a critical `Pending Omarchy Migrations` toast at login whose click opens a terminal that runs them, the toast is dismissed once they run, and nothing is shown when nothing is pending.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl --user restart omarchy-migrate-notify.service` (this replays the login check). Wait five seconds and screenshot: **no** toast may appear while nothing is pending.
  * Type `rm ~/.local/state/omarchy/migrations/1786517850.sh; systemctl --user restart omarchy-migrate-notify.service`.
  ** Within a few seconds a notification titled `Pending Omarchy Migrations` with `Click to run 1 pending migration.` appears in the top-right corner.
  * Click the toast with the mouse.
  ** A floating Omarchy terminal shows the logo, `Running migration (1786517850)` / `Drop the retired notification image cache`, then `● Done! Press any key to close...`. Press a key.
  * Type `omarchy-migrate --pending; echo pending=$?` — nothing, `pending=1`.
  * Type `rm ~/.local/state/omarchy/migrations/1786517850.sh ~/.local/state/omarchy/migrations/1785511354.sh; systemctl --user restart omarchy-migrate-notify.service`.
  ** The toast now says `Click to run 2 pending migrations.` Do **not** click it.
  * Type `omarchy-migrate` in your terminal (type `prime` if sudo asks).
  ** Both migrations run (1785511354 only checks that qrencode is installed) and the toast disappears on its own.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The notifier waits for the notification server; allow up to ten seconds for the toast.
  * If no toast appears, `journalctl --user -u omarchy-migrate-notify.service -n 20 | sudo tee /dev/ttyS0` shows the fallback text it printed instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of: no toast with nothing pending; the `1 pending migration` toast; the click-opened terminal running 1786517850 and `Done!`; the `2 pending migrations` toast; the desktop after the manual `omarchy-migrate` with the toast gone.
  * If unsuccessful
  ** Screenshot of a toast with nothing pending, no toast with markers removed, or a click that opens nothing; the journalctl serial dump.
covers: bin/omarchy-migrate-notify, default/systemd/user/omarchy-migrate-notify.service, bin/omarchy-migrate (notification dismiss), docs/update-process.md Path 2, test/shell.d/migrate-notify-test.sh

### migrate-notify-quiet-during-update   [VM-OK]
description: The migration notifier stays silent while an update holds the update lock — that update is about to run the migrations itself — and notifies again once the lock is released.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `rm ~/.local/state/omarchy/migrations/1786517850.sh` (one harmless migration pending).
  * Type `omarchy-update-lock run sleep 300 &` then `ls -l $XDG_RUNTIME_DIR/omarchy-update.lock` — the lock file is listed; the background sleep holds it like a running update would.
  * Type `systemctl --user restart omarchy-migrate-notify.service`, wait ten seconds, screenshot: **no** `Pending Omarchy Migrations` toast.
  * Type `kill %1` (releases the lock), wait two seconds, then `systemctl --user restart omarchy-migrate-notify.service`.
  ** The toast `Pending Omarchy Migrations` / `Click to run 1 pending migration.` appears within a few seconds.
  * Click the toast; the floating terminal runs the migration and shows `Done!`. Press a key.
  * Type `jobs; omarchy-migrate --pending; echo pending=$?` — no background job left, nothing pending, `pending=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-update-lock run <cmd>` holds an exclusive lock while the command runs; killing the sleep drops it. If `kill %1` says no such job, use `pkill -f 'sleep 300'`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the lock held and no toast after the restart, then the toast after the release, then the migration running from the click and `pending=1`.
  * If unsuccessful
  ** Screenshot of a toast while the lock is held, or no toast after release; `journalctl --user -u omarchy-migrate-notify.service -n 20 | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-migrate-notify update_in_progress, bin/omarchy-update-lock, docs/update-process.md "the notifier also refuses to run while omarchy update holds its lock", test/shell.d/migrate-notify-test.sh "stays quiet while omarchy update holds its lock"

### pacman-guard-blocks-direct-sysupgrade   [VM-OK] [NET]
description: A direct `sudo pacman -Syu` is stopped by Omarchy's pre-transaction hook with the `Woah partner...` message pointing at `omarchy update`, and the documented `OMARCHY_ALLOW_DIRECT_PACMAN=1` bypass lets the same transaction through.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo pacman -Syu --ignore '*' bash` (password `prime`).
  ** pacman syncs the databases and asks `bash is in IgnorePkg/IgnoreGroup. Install anyway? [Y/n]` — type `y`; then `Proceed with installation? [Y/n]` — type `Y`.
  ** After a small download: `:: Running pre-transaction hooks...` / `Checking Omarchy update entrypoint...`, then the message starting `Woah partner...` that names `omarchy update` and `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, and pacman ends with `error: failed to commit transaction (failed to run transaction hooks)`.
  * Type `echo exit=$?` — non-zero.
  * Type `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu --ignore '*' bash`, answering `y`/`Y` to the same questions.
  ** `Checking Omarchy update entrypoint...` passes silently, bash is (re)installed, no `Woah partner`.
  * Type `omarchy-version` — unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--ignore '*'` keeps the download to one package; a plain `sudo pacman -Syu` downloads a month of updates before the hook aborts it. If pacman rejects the `*` glob, use the plain form and accept the wait.
  * The guard message is on stderr just before pacman's own error; screenshot as soon as the hooks start.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `Woah partner...` block with the two suggested commands and pacman's `failed to run transaction hooks` error, and of the bypassed run completing without the block.
  * If unsuccessful
  ** Screenshot of the direct sysupgrade installing without the message, or of the bypass still blocked.
covers: default/libalpm/hooks/00-omarchy-update-guard.hook, bin/omarchy-update-pacman-guard, docs/update-process.md Path 2, manual/30-updates.md "Warning about direct pacman/yay updates", test/shell.d/update-pacman-guard-test.sh

### post-update-kernel-omarchy   [VM-OK] [NET] [SLOW]
description: After the stable update the machine runs the `linux-omarchy` kernel: the package and headers are installed, Limine's BOOT_ORDER puts it first, the Limine tree lists it, and `uname -r` no longer shows the ISO kernel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `update-menu-omarchy` (updated and rebooted). If a terminal (Super+Enter) shows `omarchy-version` still at `4.0.2-…`, note `uname -r`, type `omarchy update -y`, type `prime` at sudo prompts, answer Yes to the reboot question (`Linux kernel has been updated. Reboot?` or `Updates require reboot. Ready?`), enter the passphrase `prime` and log in.
  * Open a terminal with Super+Enter and type `uname -r; pacman -Q linux-omarchy linux-omarchy-headers`.
  ** Both packages are listed; `uname -r` is not the ISO kernel string (report the exact value — the Omarchy kernel).
  * Type `grep BOOT_ORDER /etc/default/limine`.
  ** Exactly `BOOT_ORDER="linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`.
  * Type `sudo limine-entry-tool --tree | sudo tee /dev/ttyS0` (password `prime`) and read the serial log: an entry for `linux-omarchy` is present, and the previous kernel is still listed as a fallback choice.
  * Type `ls ~/.local/state/omarchy/reboot-required; omarchy-migrate --pending; echo pending=$?` — `No such file or directory`, nothing pending, `pending=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the Limine boot menu is visible during the precondition reboot, screenshot it: the first entry names linux-omarchy.
  * The old kernel stays installed on purpose so the user can boot it from Limine if the new one fails.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `uname -r` with both packages, the BOOT_ORDER line, the serial dump of the Limine tree with linux-omarchy, and the absent reboot marker with `pending=1`.
  * If unsuccessful
  ** Screenshot of `The Omarchy kernel has no Limine boot entry; rerun omarchy-migrate…`, a missing package, a wrong BOOT_ORDER, or a boot that does not reach the desktop (Limine menu / emergency shell) plus `get-serial`.
covers: migrations/1789325478.sh, migrations/1789444024.sh, bin/omarchy-update-restart, bin/omarchy-state, test/shell.d/omarchy-kernel-migration-test.sh, kernel-headers-migration-test.sh

### post-update-kitty-config-refreshed   [VM-OK] [NET] [SLOW]
description: The Kitty migration replaces the stock 4.0.2 `~/.config/kitty/kitty.conf` with the new default, keeps a timestamped backup and shows a `Restart Kitty` box; re-run on a customised file it only comments out `allow_remote_control yes` and keeps the user's lines.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `update-menu-omarchy`. If a terminal (Super+Enter) shows `omarchy-version` still at `4.0.2-…`, type `omarchy update -y`, type `prime` at sudo prompts, watch for the `Restart Kitty` box under `Running migration (1788745941)`, and answer No to the reboot question.
  * Open a terminal with Super+Enter and type `ls ~/.config/kitty/; head -1 ~/.config/kitty/kitty.conf; grep -c 'allow_remote_control yes' ~/.config/kitty/kitty.conf`.
  ** `kitty.conf` plus one `kitty.conf.bak.<digits>`; first line `# Remove the include below to disconnect Kitty from Omarchy's theming system.`; count `0`.
  * Type `grep -c 'allow_remote_control yes' ~/.config/kitty/kitty.conf.bak.*` — `1` (the backup is the old file).
  * Type `printf '\nallow_remote_control yes\n# my line\n' >> ~/.config/kitty/kitty.conf; rm ~/.local/state/omarchy/migrations/1788745941.sh; omarchy-migrate`.
  ** `Running migration (1788745941)`, `Unrestricted remote control disabled.`, `Your other Kitty settings were preserved.`, `Backup saved to:` with a `.bak.XXXXXX` path, and the rounded `Restart Kitty` / `Close and reopen all Kitty windows to apply this change.` box.
  * Type `grep -n 'allow_remote_control\|my line' ~/.config/kitty/kitty.conf` — `# allow_remote_control yes` (commented) and `# my line` both present.
  * Type `rm ~/.config/kitty/kitty.conf.bak.??????; ls ~/.config/kitty/` — only `kitty.conf` and the original `kitty.conf.bak.<digits>` remain.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Kitty itself is not installed on this disk; only the config file matters.
  * The migration rewrites a file only when its checksum matches the shipped 4.0.2 config or it contains an active `allow_remote_control yes`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the directory listing/head/count after the update, the customised-file re-run with the four message lines and the `Restart Kitty` box, and the grep showing the commented line with the preserved custom line.
  * If unsuccessful
  ** Screenshot of the old file untouched after the update, a missing backup, a lost custom line, or an error under `Update Kitty configuration`.
covers: migrations/1788745941.sh, bin/omarchy-refresh-config, config/kitty/kitty.conf (4.0.2 vs HEAD), bin/omarchy-migrate

### post-update-mise-and-agent-wrappers   [VM-OK] [NET] [SLOW]
description: After the stable update the small user-state migrations have landed: mise no longer auto-prunes, and the `hermes`, `cursor-agent` and `muse` commands plus the Hermes skill links exist in the user's home.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `update-menu-omarchy`. If a terminal (Super+Enter) shows `omarchy-version` still at `4.0.2-…`, type `omarchy update -y`, type `prime` at sudo prompts, and answer No to the reboot question.
  * Open a terminal with Super+Enter and type `mise settings get upgrade.auto_prune` — `false`.
  * Type `ls -l ~/.local/bin/hermes ~/.local/bin/cursor-agent ~/.local/bin/muse` — all three exist and are executable.
  * Type `head -4 ~/.local/bin/muse; head -1 ~/.local/bin/hermes`.
  ** `muse` starts with `#!/bin/bash`, `export MISE_MINIMUM_RELEASE_AGE=0`, `mise use -g --quiet "http:muse[…]"`; `hermes` starts with `# Written by omarchy-install-hermes-cli.`
  * Type `ls -l ~/.hermes/skills/` — symlinks `omarchy -> /usr/share/omarchy/default/agents/skills/omarchy` and `diagnose-crash -> …/diagnose-crash`.
  * Type `omarchy-mise-install 'x/y'; echo exit=$?` — `omarchy-mise-install: 'x/y' is not usable as a command name`, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `muse`, `cursor-agent` or `hermes`: their first run downloads the tool and can take minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `false` from mise, the three wrappers, their first lines, the Hermes skill symlinks, and the rejected wrapper name.
  * If unsuccessful
  ** Screenshot of a missing wrapper, `auto_prune` not `false`, or an error line under one of migrations 1787215483/1787760281/1787843905/1788577553/1788724825 in the update output.
covers: migrations/1787215483.sh, 1787760281.sh, 1787843905.sh, 1788577553.sh, 1788724825.sh, bin/omarchy-mise-install, bin/omarchy-install-hermes-cli, test/shell.d/hermes-cli-migration-test.sh, hermes-skills-migration-test.sh

### channel-switch-edge-and-update   [VM-OK] [NET] [SLOW]
description: Update → Channel → Edge repoints pacman at the edge mirror and repo, swaps `omarchy` for `omarchy-dev`, runs the update with the HEAD-only migrations, and afterwards the channel commands and the menu checkmark say edge.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-channel-current; omarchy-version-channel; omarchy-version` — `stable`, `stable`, `4.0.2-…`.
  * Open the Omarchy menu with Super+Space, click `Update`, then `Channel` — `Stable` is shown checked. Click `Edge`.
  ** A floating terminal runs `omarchy-channel-set edge`: `Setting channel to edge`, a full pacman sync, pacman replacing `omarchy` with `omarchy-dev` and `omarchy-settings` with `omarchy-settings-dev`, then the unattended update (`Prune package cache` … `Running migration (…)` …). Type `prime` at sudo prompts.
  ** Record the `Running migration` lines; besides the 4.0.4 set they must include 1786609204, 1786719479, 1787215824, 1787342993, 1787573629, 1787666837, 1788595060, 1788596255, 1788862626, 1788941927, 1789091250, 1789095456, 1789130779, 1789294350, 1789310715.
  * Answer No to the reboot question; press a key at `Done!`.
  * In your terminal type `omarchy-channel-current; omarchy-version-channel; omarchy-version; pacman -Q omarchy-dev omarchy-settings-dev`.
  ** `edge`, `edge`, an `omarchy-dev` version string, both packages listed.
  * Type `grep -h Server /etc/pacman.d/mirrorlist /etc/pacman.conf` — `https://mirror.omarchy.org/…` and `https://pkgs.omarchy.org/edge/…`.
  * Open the menu again with Super+Space → `Update` → `Channel`: `Edge` is checked now. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Two full package transactions plus a kernel: the longest run in this area. Screenshot the floating terminal repeatedly.
  * On failure the terminal prints `The channel switch did not complete. Review the error above, then rerun: omarchy-channel-set edge`.
  * This leaves the disk on edge, not rebooted; keep it for the `post-update-edge-*` tests or end with `stop`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the before-state, the Channel submenu with Stable checked, `Setting channel to edge`, the package replacement, the migration lines including the HEAD-only ids, the after-state commands and Server lines, and the submenu with Edge checked.
  * If unsuccessful
  ** Screenshot of the error and the `The channel switch did not complete…` line; `omarchy-channel-current` output; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`.
covers: bin/omarchy-channel-set, bin/omarchy-refresh-pacman, bin/omarchy-channel-current, bin/omarchy-version-channel, default/pacman/pacman-edge.conf, default/pacman/mirrorlist-edge, default/omarchy/omarchy-menu.jsonc update.channel.*, manual/30-updates.md "Four channels", test/shell.d/channel-test.sh

### channel-switch-dev-and-update   [VM-OK] [NET] [SLOW]
description: Update → Channel → Dev warns, asks, clones the Omarchy repository into ~/omarchy, links it as the runtime, installs edge packages and updates; after the requested reboot `omarchy-version` reports `dev (<hash>)`, and the next update fast-forwards the checkout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/omarchy; omarchy-channel-current; omarchy-version` — no checkout, `stable`, `4.0.2-…`.
  * Open the Omarchy menu with Super+Space → `Update` → `Channel` → `Dev` (mouse).
  ** A floating terminal prints `The dev channel links Omarchy directly to a checkout of the source in ~/omarchy.` / `It's exclusively intended for developers working on Omarchy itself.` and asks `Switch to dev channel?` with **No** highlighted.
  * Choose Yes.
  ** `git clone https://github.com/omacom/omarchy.git` scrolls, then the dev-link messages, `Setting channel to edge`, the pacman sync, the `omarchy` → `omarchy-dev` replacement, then the unattended update with migrations. Type `prime` at sudo prompts.
  * At the end `Updates require reboot. Ready?` (or the kernel variant) appears. Screenshot, answer Yes, enter the passphrase `prime` and log in.
  * Open a terminal and type `omarchy-version; omarchy-channel-current; omarchy-version-branch; echo $OMARCHY_PATH`.
  ** `dev (<7-char hash>)`, `dev`, `master`, `/home/prime/omarchy`.
  * Type `omarchy update -y` (password `prime`): the first heading after the snapshot is green `Update Omarchy dev checkout` with `Already up to date.` (or a fast-forward), then the rest of the pipeline; answer No to any reboot question.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clone is large; expect minutes before `Setting channel to edge`.
  * Until the reboot, `omarchy-version` still prints the `omarchy-dev` package version — OMARCHY_PATH is only re-read at login.
  * This leaves the disk on dev; end with `stop` unless a later dev test wants it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dev warning with the question, the clone, the channel/package steps, the reboot question, the post-reboot `dev (<hash>)` / `dev` / `master` / OMARCHY_PATH, and the second update's `Update Omarchy dev checkout` heading.
  * If unsuccessful
  ** Screenshot of the failure and the `The channel switch did not complete…` line, or a post-reboot session that lost its bar/desktop; `get-serial`.
covers: bin/omarchy-channel-set (dev), bin/omarchy-dev-link (usage), bin/omarchy-update-dev, bin/omarchy-version, bin/omarchy-version-branch, bin/omarchy-channel-current, docs/update-process.md "Channels and versions", test/shell.d/channel-test.sh, update-dev-test.sh

### channel-set-rejects-bad-input   [VM-OK]
description: `omarchy-channel-set` rejects a missing or unknown channel with its usage line, and declining the dev-channel question — from the terminal or from the menu — prints `Cancelled.` and changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sha256sum /etc/pacman.conf /etc/pacman.d/mirrorlist` and note the two hashes.
  * Type `omarchy-channel-set; echo exit=$?` — `Usage: omarchy-channel-set [stable|rc|edge|dev]`, `exit=1`.
  * Type `omarchy-channel-set nightly; echo exit=$?` — `Unknown channel: nightly`, the usage line, `exit=1`, no sudo prompt.
  * Type `omarchy-channel-set dev`.
  ** The two-line warning about `~/omarchy` and `Switch to dev channel?` with **No** pre-selected. Press Enter (accept No) → `Cancelled.`; `echo $?` → `0`.
  * Open the Omarchy menu with Super+Space → `Update` → `Channel` → `Dev` with the mouse; in the floating terminal answer **No** again.
  ** `Cancelled.` then `● Done! Press any key to close...`. Press a key.
  * Type `ls ~/omarchy; sha256sum /etc/pacman.conf /etc/pacman.d/mirrorlist; omarchy-channel-current` — no checkout, both hashes unchanged, `stable`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: `n` or Enter on the highlighted No both decline.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage refusal, `Unknown channel: nightly`, the dev warning with `Cancelled.` / exit 0, the menu-launched cancel ending in `Done!`, and the unchanged hashes/channel.
  * If unsuccessful
  ** Screenshot of a sudo prompt, clone, or pacman activity after a refusal or cancel, or of a changed hash.
covers: bin/omarchy-channel-set (usage, unknown channel, confirm_dev), default/omarchy/omarchy-menu.jsonc update.channel.dev, test/shell.d/channel-test.sh "dev refuses…"

### version-commands   [VM-OK]
description: The version and channel commands agree with the installed package on a fresh 4.0.2 disk — `omarchy-version` matches `pacman -Q omarchy`, channel commands say stable, `omarchy-version-branch` is silent — and channel detection degrades to `unknown` when the mirrorlist no longer matches a known mirror.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-version; echo exit=$?; pacman -Q omarchy omarchy-settings`.
  ** A single line `4.0.2-<n>` equal to the version part of `pacman -Q omarchy`, `exit=0`.
  * Type `omarchy-version-channel; omarchy-channel-current; omarchy-version-branch; echo branch=$?` — `stable`, `stable`, no output, `branch=1`.
  * Type `omarchy-version-pkgs; omarchy version` — a date such as `Friday, September 18 2026 at 00:00` (today at midnight on a never-updated disk), and the same version as before from the `omarchy` router.
  * Type `grep -h Server /etc/pacman.d/mirrorlist /etc/pacman.conf` — `https://stable-mirror.omarchy.org/$repo/os/$arch` and `https://pkgs.omarchy.org/stable/$arch`.
  * Type `sudo sed -i 's#stable-mirror#other-mirror#' /etc/pacman.d/mirrorlist; omarchy-version-channel; omarchy-channel-current` (password `prime`) — `unknown / stable` and `unknown`.
  * Type `sudo sed -i 's#other-mirror#stable-mirror#' /etc/pacman.d/mirrorlist; omarchy-version-channel; omarchy-channel-current` — `stable`, `stable` again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-version-channel` prints two tokens with a slash only when mirror and package repo disagree.
  * All output fits one screen; screenshot after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the `4.0.2-n` version matching `pacman -Q`, `stable`/`stable`/`branch=1`, the date, the Server lines, the `unknown / stable` + `unknown` pair and the restored `stable`/`stable`.
  * If unsuccessful
  ** Screenshot of a version that does not match pacman, `unknown` on the untouched disk, an error from any command, or the mirrorlist not restored.
covers: bin/omarchy-version, bin/omarchy-version-channel, bin/omarchy-version-branch, bin/omarchy-version-pkgs, bin/omarchy-channel-current, default/pacman/mirrorlist-stable, default/pacman/pacman-stable.conf, docs/update-process.md "Channels and versions", test/shell.d/version-test.sh, channel-test.sh "current channel detects stable"

### upgrade-to-quattro-refuses-on-quattro   [VM-OK]
description: On an already-4.x system the 3→4 upgrader can be backed out of without side effects — bad arguments are refused before anything happens, and the one-way warning's `Continue with upgrade?` answered No exits silently — while the driver must never answer Yes because the script has no "already on Quattro" guard.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-version; sha256sum /etc/pacman.conf; ls /etc/pacman.conf.omarchy-upgrade-to-quattro.*` — note version and hash; the `ls` says No such file.
  * Type each of these and check its `Error:` line and `exit=1`: `omarchy-upgrade-to-quattro --channel nightly; echo exit=$?` → `Invalid channel 'nightly'. Use stable, rc, or edge.`; `omarchy-upgrade-to-quattro --dev --channel stable; echo exit=$?` → `--dev needs the edge package repo; use --channel rc or --channel edge.`; `omarchy-upgrade-to-quattro --user nobody-here; echo exit=$?` → `User 'nobody-here' does not exist.`; `omarchy-upgrade-to-quattro --bogus; echo exit=$?` → `Unknown option: --bogus`.
  ** None of them shows the banner or asks for a password.
  * Type `omarchy-upgrade-to-quattro` with no flags.
  ** The terminal clears and shows a large ASCII-art banner, then `Upgrading Omarchy to Quattro is a one-way street!`, `You cannot downgrade from Quattro.`, `Make sure you have a backup.` and `Continue with upgrade?`. Screenshot it.
  * Answer **No** (press `n`). Never answer Yes: the script would start rewriting pacman configuration on this healthy 4.x system.
  ** The command exits with no further output; `echo $?` → `0`; no sudo prompt appeared.
  * Type `omarchy-version; sha256sum /etc/pacman.conf; ls /etc/pacman.conf.omarchy-upgrade-to-quattro.*; sudo snapper list | tail -1` (password `prime`) — version and hash unchanged, still no backup file, no new snapshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the question does not appear and green `==>` progress lines start, press Ctrl+C immediately and report it: the confirmation gate would be broken. Do not reboot after such a run.
  * `omarchy upgrade to quattro` (the CLI router spelling) reaches the same script.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the four argument refusals with their `Error:` lines and exit 1, the banner with the one-way warning and the question, the silent exit 0 after No, and the unchanged version/hash/backup listing/snapshot tail.
  * If unsuccessful
  ** Screenshot of any `==>` progress line, sudo prompt, new `/etc/pacman.conf.omarchy-upgrade-to-quattro.*.bak`, or changed hash after declining; `Upgrade incomplete - do NOT reboot.` if it ever appears, plus `get-serial`.
covers: bin/omarchy-upgrade-to-quattro (usage, normalize_channel, argument refusals, banner + gum confirm, cleanup_on_exit), agents/skills/migrations.md "Omarchy 4.0 is upgraded through bin/omarchy-upgrade-to-quattro", test/shell.d/upgrade-to-quattro-test.sh "reports an aborted run instead of exiting silently"

### update-firmware-no-devices   [VM-PARTIAL] [NET]
description: Update → Firmware installs fwupd on first use, refreshes LVFS metadata and reports that nothing is updatable on this machine, closing with Done; in QEMU only this "no devices" path exists.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q fwupd` — `was not found` on a fresh disk.
  * Open the Omarchy menu with Super+Space → `Update` → `Firmware` (mouse).
  ** A floating terminal shows the logo, green `Update Firmware`, pacman installing `fwupd` (type `prime` at the sudo prompt), `fwupdmgr refresh --force` downloading metadata (`Successfully downloaded new metadata` or similar), then `sudo fwupdmgr update` reporting no updatable devices (`Devices with no available firmware updates:` / `No updatable devices`).
  ** It ends with `● Done! Press any key to close...` (or `Failed (exit code N)` — report the code; some fwupd versions return 2 for "nothing to do").
  * Press a key to close.
  * In your terminal type `pacman -Q fwupd; ls /boot/EFI/arch/fwupdx64.efi` — installed, and the EFI helper copied (UEFI guest).
  * Run the menu entry a second time: no package install this time, straight to refresh/update, same ending.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * QEMU exposes no updatable firmware; the flow completing gracefully is the point. Skipped: real flashing and the reboot-to-apply path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `Update Firmware`, the fwupd install, the metadata refresh, the no-updatable-devices output, the closing prompt, and `pacman -Q fwupd` with the EFI file.
  * If unsuccessful
  ** Screenshot of a pacman or fwupdmgr error and the `Failed (exit code N)` line.
covers: bin/omarchy-update-firmware, default/omarchy/omarchy-menu.jsonc update.firmware, manual/30-updates.md "Firmware updates"

### update-time-restarts-timesyncd   [VM-OK]
description: Update → Time restarts systemd-timesyncd behind a `Updating time...` message and closes with Done; cancelling at the password prompt leaves the service untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl show -p ActiveEnterTimestamp systemd-timesyncd` and note the timestamp.
  * Open the Omarchy menu with Super+Space → `Update` → `Time` (mouse).
  ** A floating terminal shows the logo, `Updating time...`, a sudo prompt (type `prime`), then `● Done! Press any key to close...`. Press a key.
  * Type `systemctl show -p ActiveEnterTimestamp systemd-timesyncd; systemctl is-active systemd-timesyncd` — a newer timestamp and `active`.
  * Type `omarchy-update-time` and press Ctrl+C at the sudo prompt — the command aborts; repeat the `systemctl show` line: the timestamp is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If timesyncd is not enabled on the image, `is-active` reports `inactive` after the restart; report it as-is.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the first timestamp, the floating terminal with `Updating time...` and `Done!`, the newer timestamp with `active`, and the unchanged timestamp after the Ctrl+C.
  * If unsuccessful
  ** Screenshot of a systemctl error or a `Failed (exit code N)` closing line.
covers: bin/omarchy-update-time, default/omarchy/omarchy-menu.jsonc update.time

### post-update-edge-gemini-replaced-by-agy   [VM-OK] [NET] [SLOW]
description: On the edge channel the Antigravity migration removes the 4.0.2 `gemini` wrapper, creates `agy`, links skills into ~/.gemini, and a user whose default agent was gemini is switched to agy; re-running it is a no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `channel-switch-edge-and-update`. If a terminal (Super+Enter) shows `omarchy-channel-current` as `stable`, first type `mkdir -p ~/.config/omarchy/defaults; echo gemini > ~/.config/omarchy/defaults/agent`, then `omarchy-channel-set edge`, type `prime` at sudo prompts, wait for the switch and update, and answer No to the reboot question.
  ** On an already-edge disk the default-agent line was not seeded before the migration ran; then only the wrapper and skill checks below apply, and the `agent` file check is skipped — say so.
  * Open a terminal with Super+Enter and type `ls -l ~/.local/bin/agy ~/.local/bin/gemini`.
  ** `agy` exists; `gemini` says `No such file or directory`.
  * Type `head -4 ~/.local/bin/agy; cat ~/.config/omarchy/defaults/agent` — the stub contains `mise use -g --quiet "antigravity-cli"`; the agent file (if seeded) says `agy`.
  * Type `ls -l ~/.gemini/config/skills/` — symlinks into `/usr/share/omarchy/default/agents/skills/` (`omarchy`, `diagnose-crash`).
  * Type `rm ~/.local/state/omarchy/migrations/1786719479.sh; omarchy-migrate` — `Running migration (1786719479)` / `Replace the Gemini coding agent with Antigravity` runs with no other output and no error.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `agy`; its first run downloads Antigravity.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `ls -l` with `agy` present and `gemini` gone, the stub head and agent file, the skills symlinks, and the silent re-run.
  * If unsuccessful
  ** Screenshot of `gemini` still present, `agy` missing, the default still `gemini`, or an error under the migration.
covers: migrations/1786719479.sh, bin/omarchy-mise-install, bin/omarchy-channel-set, test/shell.d/mise-wrapper-quiet-migration-test.sh (wrapper format)

### post-update-edge-work-mise-toml-removed   [VM-OK] [NET] [SLOW]
description: On the edge channel the mise-trust migration deletes the stock `~/Work/.mise.toml` that put `{{ cwd }}/bin` on PATH, and on a customised file it removes only that line, keeps a backup and explains that trust was revoked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `channel-switch-edge-and-update`. If a terminal (Super+Enter) shows `omarchy-channel-current` as `stable`, type `omarchy-channel-set edge`, type `prime` at sudo prompts, wait for the switch and update, and answer No to the reboot question.
  * Open a terminal with Super+Enter and type `ls -a ~/Work; ls ~/Work/tries` — no `.mise.toml`; `tries` still present.
  * Type `printf '[env]\n_.path = "{{ cwd }}/bin"\nFOO = "bar"\n' > ~/Work/.mise.toml; mise trust ~/Work/.mise.toml; rm ~/.local/state/omarchy/migrations/1789095456.sh; omarchy-migrate`.
  ** Output: `Running migration (1789095456)`, `Automatic project bin directories were removed from your Mise PATH.`, `Your other Mise settings were preserved.`, `Backup saved to:` with a `~/Work/.mise.toml.bak.XXXXXX` path, and `Mise trust for this custom config was revoked. Review it before trusting it again:` / `mise trust /home/prime/Work/.mise.toml`.
  * Type `cat ~/Work/.mise.toml; ls ~/Work/.mise.toml.bak.*` — only `[env]` and `FOO = "bar"` remain; the backup exists.
  * Type `rm -f ~/Work/.mise.toml ~/Work/.mise.toml.bak.*; ls -a ~/Work` — back to no mise file.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The stock 4.0.2 file matched the migration's known checksum, which is why it was deleted silently during the switch.
  * `cd ~/Work` after the re-run may print a mise "config not trusted" notice for the custom file — that is the revoked trust working.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `ls -a ~/Work` without `.mise.toml`, the custom-file re-run messages, the trimmed file plus backup, and the cleaned directory.
  * If unsuccessful
  ** Screenshot of the stock file surviving, the `_.path` line surviving in the custom file, or a `mise trust --untrust` error aborting the migration.
covers: migrations/1789095456.sh, install/user/mise-work.sh (v4.0.2 stock hash), bin/omarchy-migrate

### post-update-edge-packages-and-sysctl   [VM-PARTIAL] [NET] [SLOW]
description: On the edge channel the remaining HEAD-only migrations leave visible state — `vi` and `qt6-multimedia` installed, the KEF wireplumber drop-in written, TCP congestion control on BBR/fq, and the `hey`/`ori`/`basecamp`/`cf` wrappers present; the hardware-gated ones (Dell, Elgato, T3 Code) only show their header.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: this runs on the disk left by `channel-switch-edge-and-update`. If a terminal (Super+Enter) shows `omarchy-channel-current` as `stable`, type `omarchy-channel-set edge`, type `prime` at sudo prompts, wait for the switch and update, and answer No to the reboot question.
  * Open a terminal with Super+Enter and type `pacman -Q vi qt6-multimedia qt6-multimedia-ffmpeg; which vi` — all three listed, `/usr/bin/vi`.
  * Type `sysctl net.ipv4.tcp_congestion_control net.core.default_qdisc`.
  ** `bbr` and `fq`. If not, type `cat /etc/sysctl.d/99-omarchy-sysctl.conf` and report whether it contains `tcp_congestion_control` (the file comes from the settings package, not the migration).
  * Type `ls ~/.config/wireplumber/wireplumber.conf.d/; systemctl --user is-active wireplumber` — `kef-lsx-no-suspend.conf`, `active`.
  * Type `ls ~/.local/bin/hey ~/.local/bin/ori ~/.local/bin/basecamp ~/.local/bin/cf` — all four exist.
  * Type `grep -A1 'Running migration (178766683\|Running migration (178886262\|Running migration (178909125' /tmp/omarchy-update.log | sudo tee /dev/ttyS0` (password `prime`) and read the serial log: the Dell, Elgato and T3 Code migrations show only their header line.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped in the VM: Dell XPS 13 amplifiers, Elgato Cam Link relay, T3 Code theme — no such hardware or package here.
  * If the disk was rebooted since the switch, /tmp/omarchy-update.log is gone; skip the last step and say so.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the package/which line, the sysctl values, the wireplumber file with `active`, the four wrappers, and the serial dump of the three header-only migrations.
  * If unsuccessful
  ** Screenshot of a missing package/wrapper/file or an error under any of the listed migrations; the sysctl file contents if BBR did not apply.
covers: migrations/1786609204.sh, 1787215824.sh, 1787342993.sh, 1787666837.sh, 1788596255.sh, 1788862626.sh, 1788941927.sh, 1789091250.sh, 1789130779.sh, 1789294350.sh, 1789310715.sh, bin/omarchy-pkg-add, bin/omarchy-refresh-config

## Gaps

- **A real 3.x → 4.0 upgrade** (`omarchy-upgrade-to-quattro` doing work) needs an Omarchy 3.8.x disk; the fleet only has 4.0.2.
  Every mutation step, the `Upgrade incomplete - do NOT reboot.` path, the dm-crypt cmdline repair refusal and the UKI
  verification remain covered only by `test/shell.d/upgrade-to-quattro-test.sh`.
- **Second-user migration behaviour** (per-user markers, machine-wide `/var/lib/omarchy/migrations/*` markers making the
  second run a no-op) needs a second account and a relogin as that user; the driver has no account-creation step in scope.
- **Package-vs-package conflicts** (`unresolvable package conflicts detected` → interactive pacman hand-off, and the `-y`
  refusal `This upgrade needs an answer.`) cannot be provoked without a conflicting package pair on the mirror.
- **A conflict from a non-Omarchy package** (handler must refuse) needs foreknowledge of a file a to-be-upgraded Arch package
  will newly ship.
- **Snapshot rollback** from the Limine menu after a bad update is a boot-menu interaction outside this area (see 47-system-snapshots).
- **Hardware-gated migrations** (T2 Mac, Dell XPS, Elgato, NVIDIA kms, Broadcom Wi-Fi, Bluetooth, fingerprint/FIDO2/sshd
  hardening, cups-browsed, docker/input group removal) are predicate-false on the guest or already marked on a 4.0.2 disk;
  un-marking the security ones is unsafe (sshd disable, group removal, kernel install).
- **The Chromium Copy URL repair prompt** (`1786643346`, gum confirm while a browser is open) is already marked on 4.0.2 and
  needs a Chromium profile with a ghost shortcut registration to reproduce.
- **`omarchy-update-aur-pkgs`** only acts when foreign packages exist; the minted disk has none, and installing one via `yay`
  first is its own NET/SLOW test outside this scope.
- **Sleep/idle inhibition during the update** (`omarchy-update-stay-awake`) is observable only via `systemd-inhibit --list`
  mid-update and the Stay Awake indicator; not asserted above because the guest cannot sleep anyway.
- **The 6-hour bar re-check timer** cannot be waited for; the IPC `refresh` is used instead.
- **Time budget**: the full-update tests are each likely to exceed ten minutes on user-mode NAT; the harness should either
  allow a longer budget for `[SLOW]` tests in this file or run `update-terminal-run` once and keep that disk for the
  `post-update-*` tests.
