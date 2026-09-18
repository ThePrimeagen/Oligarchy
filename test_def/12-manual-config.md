# 12 — Manual: configuration chapters (30–43)

Reviewer notes for the end-user manual chapters on updates, dotfiles, shell plugins, monitors,
input, networking, sleep, hardware auth, fonts, backgrounds, prompt, branding, common tweaks and
theme authoring. Source tree: `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18.

## Scope

Manual files read completely (592 lines total):

| file | lines | | file | lines |
|---|---|---|---|---|
| `manual/30-updates.md` | 37 | | `manual/37-hardware-authentication.md` | 17 |
| `manual/31-dotfiles.md` | 79 | | `manual/38-fonts.md` | 9 |
| `manual/32-shell-plugins.md` | 104 | | `manual/39-backgrounds.md` | 9 |
| `manual/33-monitors.md` | 55 | | `manual/40-prompt.md` | 7 |
| `manual/34-keyboard-mouse-trackpad.md` | 74 | | `manual/41-branding.md` | 55 |
| `manual/35-networking.md` | 45 | | `manual/42-common-tweaks.md` | 37 |
| `manual/36-system-sleep.md` | 19 | | `manual/43-making-your-own-theme.md` | 45 |

Cross-checked source (read in full unless noted):

- `config/hypr/{hyprland,monitors,input,looknfeel,bindings,autostart}.lua` (189 lines) — the user-editable Hyprland config.
- `default/hypr/{bootstrap,omarchy,toggles,envs,helpers(partial),require_all}.lua`, `default/hypr/bindings/{utilities,tiling,media,applications}.lua`, `default/hypr/toggles/{flags,window-no-gaps}.lua`.
- `default/omarchy/omarchy-menu.jsonc` (380 lines) — every menu path quoted below was verified here.
- `config/omarchy/shell.json`, `config/omarchy/hooks/*.d/*.sample`, `config/omarchy/extensions/omarchy-menu.jsonc`, `config/omarchy/themed/alacritty.toml.tpl.sample`, `config/foot/foot.ini`, `config/starship.toml`, `default/xcompose`, `install/user/xcompose.sh`, `install/omarchy-base.packages` (grep only).
- `docs/update-process.md` (336), `docs/theming.md` (391), `docs/cli-router.md` (130), `docs/menu.md` (first 30 lines + grep).
- `bin/`: omarchy (router head), omarchy-update, -update-available, -update-pacman-guard, -update-confirm, -update-restart, -update-firmware, -channel-set, -channel-current, -reinstall, -reinstall-configs, -refresh-config, -refresh-hyprland, -refresh-shell, -refresh-hyprsunset, -refresh-tmux, -refresh-plymouth, -refresh-pacman, -snapshot, -hook, -hook-install, -launch-config-editor, -launch-editor, -default-editor, -restart-xcompose, -hyprland-reload-guard, -launch-floating-terminal-with-presentation, -show-done, -hyprland-monitor-scaling, -display-text-size, -hyprland-monitor-internal, -hyprland-monitor-internal-mirror, -hw-display, -hw-recover-internal-monitor, -hw-laptop, -plugin-{list,enable,disable,add,remove,clone,update,validate}, -menu-plugin, -git-url-check, -dns, -network-{status,password,band,qr,speedtest}, -restart-{wifi,bluetooth,trackpad,audio,shell,hyprsunset}, -toggle, -toggle-enabled, -toggle-suspend, -toggle-bar, -hyprland-toggle, -hyprland-window-gaps-toggle, -hibernation-{setup,available,remove}, -powerprofiles-{list,set}, -setup-security-{fido2(partial),fingerprint}, -remove-security-{fido2,fingerprint}, -hw-fingerprint, -font-{set,list,current}, -install-font, -theme-bg-{install,set,next,switcher,current}, -branding-{screensaver,about}, -ascii, -transcode-ascii (head), -plymouth-{preview,reset,switcher,list,current,set(head),set-by-theme}, -launch-screensaver, -launch-about (head), -theme-{install,set,list,remove,dir,update,extras,switcher(head)}, -theme-set-templates (template loop), -theme-set-gnome, -menu-images (head), -file-select (head), -version, -battery-low (grep).

Driver capability (which keys `send-keys` can emit) was checked against the oligarchy client's `src/qemu/keys.ts`, not the Omarchy tree.

Skipped: the Quickshell QML under `shell/` (plugin runtime, bar, panels — owned by other reviewers; only `shell/plugins/services/battery/Service.qml` was grepped to confirm `omarchy-battery-low`), `migrations/`, `install/` scripts other than the package list and `xcompose.sh`, `test/`. Chapters 05 (top bar) and 06/07 (themes, hotkeys) are referenced where a config chapter points at them but were not re-inventoried.

## Inventory

Format: `behaviour — how to reach it — file(s) it changes — source`. Menu paths are from `default/omarchy/omarchy-menu.jsonc`; "Omarchy Menu" = `Super+Space` (`default/hypr/bindings/utilities.lua:1`), "System menu" = `Super+Escape` (`utilities.lua:8`).

**30 — Updates**
- Run an update — `Omarchy Menu → Update → Omarchy` → floating terminal `omarchy-update` — `omarchy-menu.jsonc:353`, `bin/omarchy-update`.
- Update confirm dialog "Ready to update? … Continue with update?" (gum); No → "Update cancelled", exit 1 → "Failed (exit code 1)! Press any key to close…" — `bin/omarchy-update-confirm`, `bin/omarchy-show-done`.
- Update pipeline order: free-space check (10 GiB on `/`, `OMARCHY_UPDATE_FORCE=1` bypass) → confirm → pkg prune → snapper snapshot (skipped 127 without snapper; unconfigured snapper warns and continues) → stay-awake → dev fast-forward → keyring → system pkgs → `omarchy-migrate` → `omarchy-hook post-update` → AUR → mise → orphans → analyze logs → status → restart — `bin/omarchy-update`, `docs/update-process.md:114-153`.
- Update transcript `/tmp/omarchy-update.log`; lock `$XDG_RUNTIME_DIR/omarchy-update.lock` — `bin/omarchy-update:12-18`, `docs/update-process.md:22-25`.
- `omarchy update -y` unattended (`OMARCHY_UPDATE_UNATTENDED=1`) — `bin/omarchy-update:28-30`.
- Post-update: reboot prompt if kernel/Hyprland replaced or `~/.local/state/omarchy/reboot-required`; restarts `restart-*-required` services; always restarts the shell ("Restarting shell / All plugins have been reloaded") — `bin/omarchy-update-restart`.
- Update-available indicator: circle-arrow icon right of the clock (`omarchy.system-update` widget, center section after `omarchy.clock`) runs `omarchy-update-available` at shell start and every 6 h; click launches update — `config/omarchy/shell.json:33`, `docs/update-process.md:226-249`, `bin/omarchy-update-available` (checkupdates on `omarchy`/`omarchy-dev`; prints "Omarchy is up to date" + exit 1 when none).
- Channels stable/rc/edge/dev — `Update → Channel → {Stable,RC,Edge,Dev}` (✓ on current via `omarchy-channel-current`) → floating terminal `omarchy-channel-set <c>` — `omarchy-menu.jsonc:354,363-366`, `bin/omarchy-channel-set`, `bin/omarchy-channel-current`.
- `omarchy-channel-set`: usage on no arg; "Unknown channel: X" + usage exit 1; dev prints a warning and `gum confirm --default=false "Switch to dev channel?"` → "Cancelled." on No; dev clones `https://github.com/omacom/omarchy.git` into `~/omarchy` and `omarchy-dev-link`; then `omarchy-refresh-pacman <channel>` (full `-Syyuu`), installs `omarchy`/`omarchy-dev` packages, `omarchy-update -y`; sets `reboot-required` when entering/leaving dev — `bin/omarchy-channel-set`.
- `omarchy channel current` prints `stable|rc|edge|dev|unknown` — `bin/omarchy-channel-current`.
- `omarchy version` prints package version or `dev (<hash>)` — `bin/omarchy-version`.
- Firmware — `Update → Firmware` → floating terminal `omarchy-update-firmware`: installs `fwupd` on first use, copies `fwupdx64.efi` to ESP, `fwupdmgr refresh --force`, `sudo fwupdmgr update` — `omarchy-menu.jsonc:359`, `bin/omarchy-update-firmware`.
- Direct `sudo pacman -Syu` / `yay -Syu` guard: ALPM pre-transaction hook prints "Woah partner…" and aborts; bypass `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu` — `bin/omarchy-update-pacman-guard`, `docs/update-process.md:63-104`.
- Rollback: pick pre-update snapshot in the Limine boot menu; `omarchy snapshot create|restore` (`limine-snapper-restore`) — `manual/30:31-35`, `bin/omarchy-snapshot`.
- `omarchy reinstall`: gum confirm "Are you sure you want to reinstall and lose config changes?" → `omarchy-reinstall-pkgs` + `omarchy-reinstall-configs` → "System has been reinstalled. Reboot?" — `bin/omarchy-reinstall`.
- `omarchy reinstall configs`: `cp -af /etc/skel/. ~/`, `omarchy-refresh-limine`, `omarchy-refresh-plymouth`, nvim refresh; refuses to run as root — `bin/omarchy-reinstall-configs`.

**31 — Dotfiles**
- User files: `~/.config/hypr/{hyprland,bindings,monitors,input,looknfeel,autostart}.lua`, `~/.config/omarchy/shell.json`, `~/.config/foot/foot.ini`, `~/.XCompose` — `manual/31:9-19`; shipped copies in `config/hypr/*.lua`, `config/omarchy/shell.json`, `config/foot/foot.ini`, `install/user/xcompose.sh`.
- `hyprland.lua` loads `default/hypr/bootstrap.lua`, `require("default.hypr.omarchy")`, then user `hypr.{monitors,input,bindings,looknfeel,autostart}`, then `default.hypr.toggles`; flags `omarchy_default_bindings = false`, `omarchy_preinstalled_bindings = false` — `config/hypr/hyprland.lua`.
- `Setup → Monitors` → `omarchy-launch-config-editor ~/.config/hypr/monitors.lua`; `Setup → Keybindings` → `bindings.lua` (row only when file exists); `Setup → Input` → `input.lua` (same gate); `Style → Hyprland` → `looknfeel.lua`; `Setup → Config → Hyprland` → `hyprland.lua`; `Setup → Config → Hyprsunset` → `~/.config/hypr/hyprsunset.conf && omarchy-restart-hyprsunset`; `Setup → Config → XCompose` → `~/.XCompose && omarchy-restart-xcompose` — `omarchy-menu.jsonc:111,126-128,187-189`.
- `omarchy-launch-config-editor`: sends low-urgency notification "Editing config file <path>" then `omarchy-launch-editor <path>` (TUI editors open via `omarchy-launch-tui`, GUI editors via `uwsm-app`) — `bin/omarchy-launch-config-editor`, `bin/omarchy-launch-editor`.
- Default editor: `Setup → Defaults → Editor → {Neovim,VSCode,Cursor,Zed,Sublime Text,Helix,Vim,Emacs}`; `omarchy default editor <x>` writes `~/.local/state/omarchy/defaults/editor`, installs the editor if missing (floating terminal), notification "<Name> is now the default editor"; bad arg → usage exit 1 — `omarchy-menu.jsonc:165-173`, `bin/omarchy-default-editor`.
- Autostart: `o.launch_on_start("cmd")` = `hl.on("hyprland.start", …)` running `uwsm-app -- cmd` — `config/hypr/autostart.lua`, `default/hypr/helpers.lua:117-125`.
- Hooks: `~/.config/omarchy/hooks/<event>.d/*` (executables; `.sample` skipped; also a single file `hooks/<event>`); events `post-boot` (`default/hypr/autostart.lua:13`, `sleep 2 && omarchy-hook post-boot`), `post-update` (`bin/omarchy-update`), `pre-refresh-pacman` (`bin/omarchy-refresh-pacman`), `theme-set $name` (`bin/omarchy-theme-set`), `font-set $name` (`bin/omarchy-font-set`), `battery-low $pct` (`bin/omarchy-battery-low` ← `shell/plugins/services/battery/Service.qml:41`) — `bin/omarchy-hook`; invalid names (`/`, `.`, `..`) rejected exit 2.
- Shipped samples: `theme-set.d/show-theme-notification.sample`, `font-set.d/show-font-notification.sample`, `post-boot.d/weather.sample`, `post-update.d/show-update-notification.sample`, `pre-refresh-pacman.d/add-custom-repo.sample`, `battery-low.d/play-warning-sound.sample` — `config/omarchy/hooks/`.
- `omarchy hook install <type> <file>` copies to `hooks/<type>.d/<basename>` and `chmod 755`; "Hook file not found: X" exit 1; bad type exit 2 — `bin/omarchy-hook-install`.
- Menu extensions: `~/.config/omarchy/extensions/omarchy-menu.jsonc`; dotted ids create tree; reusing an id overrides; shell watches file (no restart needed); only whole-line `//` comments allowed — an inline comment breaks the parse and silently drops every user entry — `config/omarchy/extensions/omarchy-menu.jsonc`, `docs/menu.md:1-19`.
- `~/.bashrc` for aliases/functions/exports, not overwritten on update — `manual/31:61`.
- Keybinding overrides: `o.bind(keys, desc, cmd)`, `o.rebind(...)` (= `hl.unbind` + `o.bind`), `hl.unbind(keys)`; `omarchy menu keybindings --print` lists bindings; `Super+K` opens the keybindings menu — `config/hypr/bindings.lua`, `default/hypr/helpers.lua:92-111`, `utilities.lua:10`.
- Reset configs: `Update → Config → {Hyprland,Hyprsunset,Plymouth,Tmux,Shell}` (title "Reset to default") → floating terminal `omarchy-refresh-{hyprland,hyprsunset,plymouth,tmux,shell}` — `omarchy-menu.jsonc:355,369-373`.
- `omarchy-refresh-config <rel>` copies `$OMARCHY_PATH/config/<rel>` over `~/.config/<rel>`, keeps `<file>.bak.<epoch>` when different, prints "Replaced … Saved backup as …" + diff; "Not a shipped user config" for unknown paths — `bin/omarchy-refresh-config`.
- `omarchy-refresh-hyprland` refreshes `.luarc.json, autostart, bindings, input, looknfeel, hyprland, monitors` and resets `~/.local/state/omarchy/toggles/hypr/flags.lua` — `bin/omarchy-refresh-hyprland`.
- `omarchy-refresh-shell` resets `omarchy/shell.json`, `omarchy-bar defaults`, restarts shell — `bin/omarchy-refresh-shell`.
- Dev channel = git checkout in `~/omarchy` — `manual/31:76`, `bin/omarchy-channel-set:37-41`.

**32 — Shell plugins**
- Plugin dirs: first-party `$OMARCHY_PATH/shell/plugins/`, user `~/.config/omarchy/plugins/<id>/` — `manual/32:7`.
- `omarchy plugin list [--json]` → table ID/STATE/SOURCE/KINDS/NAME from `omarchy-shell shell listPlugins`; unknown option exit 1 — `bin/omarchy-plugin-list`.
- `omarchy plugin enable <id> [left|center|right] [--section --index --before --after]`; refuses placement for a `bar` kind ("is a bar; it replaces the bar in use…"); unknown id → "plugin 'X' is not known; run: omarchy-shell shell rescanPlugins"; success "Enabled X" / "Now using X as the bar" / "Enabled and moved X" — `bin/omarchy-plugin-enable`.
- `omarchy plugin disable <id>` → "Disabled X"; unknown → not known — `bin/omarchy-plugin-disable`.
- Enabled state in `~/.config/omarchy/shell.json` (`bar.layout`, `plugins[]`, `bar.id`, `disabledPlugins[]`) — `manual/32:28`, `config/omarchy/shell.json`.
- Menu: `Setup → Plugins → {Enable Plugin, Disable Plugin, Add Plugin, Clone Plugin, Remove Plugin}`; Remove only when a user `plugins/*/manifest.json` exists; pickers filter to plugins that make sense (`omarchy-menu-plugin enable|disable|clone|remove`, "No plugin to <verb>" notification when empty) — `omarchy-menu.jsonc:174-179`, `bin/omarchy-menu-plugin`.
- `omarchy plugin add <git-url> [--enable] [--yes]` (alias `plugin install`): prompts for URL via gum when none; URL screened by `omarchy-git-url-check` (refuses `-…`, `helper::…`, and non-allowlisted schemes; allows ssh git git+ssh ssh+git http https ftp ftps **file**); warning "⚠️ Plugins run as arbitrary, unsandboxed code…" + "Clone and add this plugin?"; clones to `.add.tmp.$$`, validates, refuses duplicate id ("plugin id 'X' is already used by …") or existing dir ("already installed; update it with…"), moves to `plugins/<id>`, "Added X into …", rescans, asks "Enable 'X' now?" unless `--enable`, bar-widget section picker; "failed to clone URL" on clone error — `bin/omarchy-plugin-add`, `bin/omarchy-git-url-check`.
- `omarchy plugin update [id] [--yes]`: fetch, show diff (delta if present), confirm, `--ff-only` ("cannot fast-forward 'X'; you have local changes"), validate + rollback ("failed validation; rolled back"); "X is up to date."; "No git-managed plugins installed." — `bin/omarchy-plugin-update`.
- `omarchy plugin remove [id] [--yes]` (alias `rm`): picker via gum when no id; disables first; symlink → unlink, git checkout → delete, plain dir → `.<id>.bak.<UTC stamp>`; prints "Restored <clonedFrom>." when a clone was enabled — `bin/omarchy-plugin-remove`.
- `omarchy plugin clone <omarchy.id> [--edit]`: copies to `~/.config/omarchy/plugins/$USER.<name>/`, name "My <Name>", `omarchy.clonedFrom` set, enables, notification "Editing Cloned Plugin — Original plugin has been replace by clone." (sic), `--edit` opens `$EDITOR` on the dir; "unknown built-in plugin: X"; refuses if target exists — `bin/omarchy-plugin-clone`. Menu Clone always passes `--edit` in a floating terminal.
- `omarchy plugin validate <dir>`: manifest.json present/valid JSON, `schemaVersion == 1`, fields id name version kinds entryPoints, id regex + not `omarchy.*` ("uses the reserved omarchy.* namespace"), kinds non-empty, entry points relative & existing, kind↔entryPoint table, `barWidget.defaultSection`, no symlinks — `bin/omarchy-plugin-validate`.
- Live reload on save under `~/.config/omarchy/plugins/` — `manual/32:73` (shell-side, not verified in bin).

**33 — Monitors**
- `~/.config/hypr/monitors.lua`: `local omarchy_monitor_scale = "auto"` (default, **not** 2 as the chapter implies), `hl.monitor({ output = "", mode = "preferred", position = "auto", scale = … })`, commented per-monitor and rotation examples, `local omarchy_gdk_scale = 2` → `hl.env("GDK_SCALE", …)` — `config/hypr/monitors.lua`.
- `Super+/` scale up, `Super+Alt+/` scale down through 1 1.25 1.6 2 3 4 (snapped to clean divisors of the mode); applies via `hyprctl eval hl.monitor(...)` to the focused monitor; persists into `monitors.lua` only while the `local omarchy_monitor_scale =` line (or the stock `hl.monitor` line) is present; also writes `omarchy_gdk_scale` to nearest integer; audit log `~/.local/state/omarchy/monitor-scaling.log`; `omarchy hyprland monitor scaling [up|down|SCALE]` prints current with no arg, usage exit 1 on bad arg — `default/hypr/bindings/tiling.lua:97-98`, `bin/omarchy-hyprland-monitor-scaling`.
- `omarchy display text size [9..20|reset]`: writes `[font] base-size` in `~/.config/omarchy/shell.toml`, `gsettings org.gnome.desktop.interface text-scaling-factor`, terminal point size in foot/alacritty/kitty/ghostty configs; notification "Restart Foot to apply the new terminal font size" when foot is running; no arg prints "text size / gtk text-scaling-factor / terminal font"; out-of-range → "Size must be an integer between 9 and 20 (px)." exit 1 — `bin/omarchy-display-text-size`.
- `Ctrl+Alt+Delete` close all windows — `tiling.lua:3`.
- Mirror/extend: `Trigger → Hardware → Mirror Display` / `Super+Ctrl+Alt+Delete` → `omarchy-hyprland-monitor-internal-mirror toggle`; `Trigger → Hardware → Laptop Display` / `Super+Ctrl+Delete` → `omarchy-hyprland-monitor-internal toggle`; both menu rows gated `when: omarchy-hw-laptop` (lid switch or DMI chassis 8/9/10/14/30/31/32); notifications "No laptop display found", "Can't disable the only active display", "No external monitors found for mirror", "No laptop monitor found to mirror", "Laptop display disabled/enabled", "Mirroring enabled (X)", "Extended mode restored"; state flags `~/.local/state/omarchy/toggles/hypr/internal-monitor-{disable,mirror}.lua` — `omarchy-menu.jsonc:74-75`, `utilities.lua:33-34`, `bin/omarchy-hyprland-monitor-internal`, `bin/omarchy-hyprland-monitor-internal-mirror`, `bin/omarchy-hw-laptop`.
- Lid switch bindings `switch:on/off:Lid Switch` → `omarchy-system-lid-close` / `omarchy-hyprland-monitor-clamshell` — `utilities.lua:35-36`.
- `hl.monitor` per-output rules, `disabled = true` for phantom Apple screen — `manual/33:41,53`, `config/hypr/monitors.lua:10-14`.
- Brightness: `XF86MonBrightnessUp/Down` ±5 %, `Shift+` → 100 %/1 %, `Alt+` ±1 % via `omarchy-brightness-display`; Apple displays via `asdcontrol`; `Super+Ctrl+D` opens the `omarchy.monitor` panel — `default/hypr/bindings/media.lua:6-9,20-21`, `utilities.lua:100`, `bin/omarchy-hw-display`.

**34 — Keyboard, mouse, trackpad**
- `~/.config/hypr/input.lua` (all commented): `kb_layout`, `kb_options` (default compose:caps,shift:both_capslock_cancel), `kb_variant`, `repeat_rate`, `repeat_delay`, `numlock_by_default`, `sensitivity`, `accel_profile`, `touchpad.{natural_scroll,clickfinger_behavior,scroll_factor,disable_while_typing,drag_3fg}`, `o.window(class, { scroll_touchpad })`, `hl.gesture({...})` — `config/hypr/input.lua`; `Setup → Input` — `omarchy-menu.jsonc:128`.
- Compose key relocation (`compose:ralt`), ALT-as-SUPER (`altwin:swap_alt_win`) — `manual/34:40-48,64-74`.
- Touchpad haptics `Trigger → Hardware → Touchpad Haptics → low|mid|high` gated on Dell XPS + `dell-xps-touchpad-haptics` — `omarchy-menu.jsonc:78-81`.
- `Trigger → Hardware → Touchpad` (gated `omarchy-hw-touchpad`), `Touchscreen` (gated), `XF86TouchpadToggle/On/Off` — `omarchy-menu.jsonc:77,82`, `media.lua:13-15`.
- fcitx5 runs as `omarchy-fcitx5.service` (user); `omarchy-restart-xcompose` stops unit, `pkill -x fcitx5`, starts unit — `bin/omarchy-restart-xcompose`. Input engines via `omarchy pkg add fcitx5-mozc` etc. — `manual/34:62`.
- `~/.XCompose`: includes `/usr/share/omarchy/default/xcompose` (`<Multi_key> <m> <s>` → 😄, `<space> <space>` → —, …) plus `<Multi_key> <space> <n>` name / `<space> <e>` email — `install/user/xcompose.sh`, `default/xcompose`.

**35 — Networking**
- Network panel: bar icon or `Super+Ctrl+W` → `omarchy-shell shell toggle omarchy.network` — `utilities.lua:102`.
- `omarchy-network-status [--verbose]` prints `disconnected|ethernet <dev>|wifi <ssid> <signal> <freq>` — `bin/omarchy-network-status`.
- `Setup → Network → QR Code` gated `[[ $(omarchy-network-status) == wifi* ]]` → summons `omarchy.wifiqr`; `omarchy-network-qr [--meta] [iface]` → "No active Wi-Fi connection" exit 1 otherwise — `omarchy-menu.jsonc:135`, `bin/omarchy-network-qr`.
- `omarchy network password <iface>` → password or "No active Wi-Fi connection" / "This network has no password" / "Enterprise Wi-Fi has no shareable password" — `bin/omarchy-network-password`.
- DNS: `Setup → Network → DNS → {DHCP,Cloudflare,Google,Custom}` with ✓ from `omarchy-dns`; Custom runs in a floating terminal — `omarchy-menu.jsonc:130-134`.
- `omarchy dns` prints `DHCP|Cloudflare|Google|Custom`; `omarchy dns <Provider>` writes `/etc/NetworkManager/conf.d/20-omarchy-dns.conf`, per-connection `ipv4/ipv6.dns` + `ignore-auto-dns`, `/etc/systemd/resolved.conf` (DNSOverTLS opportunistic for Cloudflare/Google), reloads NM + resolved; root via `sudo` when a TTY or a passwordless sudoers grant exists, else `pkexec` (polkit dialog); Custom prompts "Enter your DNS servers (space-separated…)" and fails "Error: No DNS servers provided." on empty; unknown provider / extra args → usage exit 1 — `bin/omarchy-dns`.
- `omarchy network band [auto|2.4|5|6]` — no arg prints band/available/selected (nothing when no Wi-Fi); set → "Error: no connected Wi-Fi device."; "Error: XGHz is not available on this network."; reverts on failed reconnect; bad value → usage exit 1 — `bin/omarchy-network-band`.
- Speed test: `Trigger → Speed Test → Network Speed Test` → `omarchy.speedtest` panel (dials); `Disk Speed Test` → `omarchy.disk-speedtest`; `omarchy network speedtest down|up` prints Mbps per second using fast.com endpoints; "No active network interface" / "Failed to fetch speed test endpoints" / usage exit 2 — `omarchy-menu.jsonc:100-101`, `bin/omarchy-network-speedtest`.
- Firewall ufw on by default, incoming denied, 53317 (LocalSend) allowed; SSHD via `Setup → Security → SSHD` (`omarchy-setup-security-sshd`), removal `Remove → Security → SSHD` when enabled — `manual/35:31-33`, `install/omarchy-base.packages:133`, `omarchy-menu.jsonc:184,301`.
- Tailscale: `Install → Service → Tailscale` (disabled ✓ when `tailscale` package present) → `omarchy-install-service-tailscale`; `Remove → Service → Tailscale`; bar panel; `omarchy tailscale send <machine> [file…]`, receive → `~/Downloads` — `omarchy-menu.jsonc:227,311`, `manual/35:37-41`, `bin/omarchy-tailscale-send`.
- `Update → Hardware → {Audio, Wi-Fi, Bluetooth, Trackpad}` → floating terminals `omarchy-restart-{audio,wifi,bluetooth,trackpad}`: wifi = `rfkill unblock wifi; nmcli networking on; nmcli radio wifi on; rescan; rfkill list wifi`; bluetooth = `rfkill unblock/list bluetooth`; trackpad = i2c_hid_acpi unbind/rebind (sudo, only when devices exist); audio = restart wireplumber/pipewire, USB reset fallback, `wpctl status` — `omarchy-menu.jsonc:374-377`, `bin/omarchy-restart-*`.

**36 — System sleep**
- `System → Suspend` gated `! omarchy-toggle-enabled suspend-off` → `systemctl suspend`; `System → Hibernate` gated `omarchy-hibernation-available` → `systemctl hibernate` — `omarchy-menu.jsonc:38-39`.
- `omarchy toggle suspend` flips flag `~/.local/state/omarchy/toggles/suspend-off`, notification "Suspend removed from system menu" / "Suspend now available in system menu" — `bin/omarchy-toggle-suspend`, `bin/omarchy-toggle`.
- `omarchy hibernation setup [--force] [--no-rebuild]`: exits 0 "not supported" without `/sys/power/image_size`; "Skipping hibernation setup (requires Limine bootloader)" without `limine-mkinitcpio`; "Hibernation is already set up"; gum "Use <RAM> on boot drive to make hibernation available?"; creates `/swap` subvolume + `/swap/swapfile` (RAM-sized), fstab entry, `/etc/mkinitcpio.conf.d/omarchy_resume.conf`, `/etc/limine-entry-tool.d/resume.conf`, `limine-mkinitcpio`, "Reboot to enable hibernation?" — `bin/omarchy-hibernation-setup`.
- `omarchy hibernation available` exit 0 when swap > image_size and resume conf exists — `bin/omarchy-hibernation-available`.
- `omarchy hibernation remove`: "Hibernation is not set up" or gum "Remove hibernation setup?" → swapoff, rm swapfile/subvolume, fstab, conf, `limine-mkinitcpio`, "Hibernation removed" — `bin/omarchy-hibernation-remove`.
- `omarchy powerprofiles list [--active-state]` (from `powerprofilesctl list`); `omarchy powerprofiles set [autodetect|ac|battery] [power-saver|balanced|performance]` persists to `~/.local/state/omarchy/powerprofiles/{ac,battery}`; "Power profile is not available: X" exit 1; bad action → usage exit 1; defaults performance (AC, if available) / balanced — `bin/omarchy-powerprofiles-list`, `bin/omarchy-powerprofiles-set`; shell reapplies on AC↔battery — `shell/plugins/services/battery/Service.qml:48-51`.

**37 — Hardware authentication**
- `Setup → Security → Fingerprint` gated `omarchy-hw-fingerprint` (USB vendor/product sniff) → floating terminal `omarchy-setup-security-fingerprint`: "No fingerprint sensor detected." exit 1; else installs `libfprint-git fprintd usbutils`, `fprintd-enroll`, `fprintd-verify`, PAM for sudo/polkit/`omarchy-lock-fingerprint` with clamshell gate — `omarchy-menu.jsonc:182`, `bin/omarchy-setup-security-fingerprint`, `bin/omarchy-hw-fingerprint`.
- `Remove → Security → Fingerprint` gated `omarchy-pkg-present fprintd` → removes PAM lines + packages — `omarchy-menu.jsonc:299`, `bin/omarchy-remove-security-fingerprint`.
- `Setup → Security → Fido2` (always shown) → `omarchy-setup-security-fido2`: installs `libfido2 pam-u2f` first, then "No FIDO2 device detected. Please plug it in…" exit 1; else `pamu2fcfg` into `/etc/fido2/fido2`, PAM sudo/polkit — `omarchy-menu.jsonc:183`, `bin/omarchy-setup-security-fido2`.
- `Remove → Security → Fido2` gated `omarchy-pkg-present pam-u2f` → strips PAM, `rm -rf /etc/fido2`, drops packages, "FIDO2 authentication has been completely removed." — `omarchy-menu.jsonc:300`, `bin/omarchy-remove-security-fido2`.
- Other Security rows in the same submenu (out of chapter scope): SSHD, Passwordless Sudo, Sudoless Docker — `omarchy-menu.jsonc:184-186`.
- Lock hotkey `Super+Ctrl+L` — `utilities.lua:127`.

**38 — Fonts**
- Default `JetBrainsMono Nerd Font` (`config/foot/foot.ini:4`).
- `Style → Font` → shell provider `fonts` (list from `omarchy-font-list` = `fc-list :spacing=100`, minus emoji/signwriting/omarchy) — `omarchy-menu.jsonc:107`, `bin/omarchy-font-list`.
- `omarchy font set "<family>"`: "Font 'X' not found." exit 1 unless in `fc-list`; rewrites alacritty/kitty/ghostty/foot font lines, writes `~/.config/fontconfig/fonts.conf` (prepend_first monospace), `omarchy-restart-shell`, notifications "You must restart Ghostty/Foot to see font change", runs `omarchy-hook font-set` — `bin/omarchy-font-set`.
- `omarchy font current` = `fc-match monospace` first family — `bin/omarchy-font-current`.
- `Install → Style → Font → {Cascadia Mono, Meslo LG Mono, Fira Code, Victor Code, Bitstream Vera Mono, Iosevka}` → `omarchy-install-font <name> <pkg> <family>` → floating terminal `omarchy-pkg-add <pkg> && sleep 2 && omarchy-font-set <family>` (families: CaskaydiaMono / MesloLGL / FiraCode / VictorMono / BitstromWera Nerd Font, Iosevka Nerd Font Mono) — `omarchy-menu.jsonc:203-209`, `bin/omarchy-install-font`.

**39 — Backgrounds**
- Extra backgrounds dir `~/.config/omarchy/backgrounds/<theme>/`; `Install → Style → Background` → `omarchy-theme-bg-install` (mkdir + nautilus) — `omarchy-menu.jsonc:202`, `bin/omarchy-theme-bg-install`.
- `Super+Shift+F` file manager — `applications.lua:4`.
- Switcher `Super+Ctrl+Space` / `Style → Background` → `omarchy-menu-images` over theme + user dirs → `omarchy-theme-bg-set <path>` — `utilities.lua:17`, `omarchy-menu.jsonc:105`, `bin/omarchy-theme-bg-switcher`.
- `omarchy theme bg set <path>`: symlink `~/.local/state/omarchy/current/background`, `omarchy-shell -q background set`; "File does not exist: X" exit 1; usage exit 1 — `bin/omarchy-theme-bg-set`.
- `omarchy theme bg next` cycles jpg/jpeg/png/gif/bmp/webp/mp4/m4v/mov/webm/mkv/avi sorted; "No background was found for theme" — `bin/omarchy-theme-bg-next`; `omarchy theme bg current` prints a prettified name — `bin/omarchy-theme-bg-current`.
- Video wallpapers loop; only first monitor plays audio; pause when covered/screensaver/locked — `manual/39:7`.

**40 — Prompt**
- Starship config `~/.config/starship.toml` (shipped `config/starship.toml`: `add_newline = true`, `format = "[$directory$git_branch$git_status]($style)$character"`, `success_symbol = "[❯](bold cyan)"`, `error_symbol = "[✗](bold cyan)"`) — `manual/40`, `config/starship.toml`.

**41 — Branding**
- `omarchy plymouth preview '<bg>' '<text>' <logo.png> <out.png>`: validates `#RRGGBB` ("Invalid background/text color"), "Logo file not found", composites 1920×1080 with `magick`, opens `imv -f` — `bin/omarchy-plymouth-preview`.
- `omarchy plymouth set '<bg>' '<text>' <logo.png>` (sudo, rebuilds plymouth theme + SDDM colours); `omarchy plymouth reset` = refresh plymouth + sddm; `omarchy plymouth current` (`default` or theme name by logo byte-compare); `omarchy plymouth list` (themes with `preview-unlock.png`) — `bin/omarchy-plymouth-{set,reset,current,list}`.
- `Style → Unlock` → `omarchy-plymouth-switcher` (image picker with labels: `default` + every theme with preview-unlock.png) → `omarchy-plymouth-set-by-theme <theme>` (uses theme `background`/`foreground` + `unlock.png`) or `omarchy-plymouth-reset` for `default`, in a floating terminal — `omarchy-menu.jsonc:106`, `bin/omarchy-plymouth-switcher`, `bin/omarchy-plymouth-set-by-theme`.
- `Update → Config → Plymouth` → `omarchy-refresh-plymouth` (= `omarchy-plymouth-set --refresh-default`) — `omarchy-menu.jsonc:371`.
- `Style → Screensaver → {Edit Text, Set From Image, Restore Default}` → `omarchy-branding-screensaver text|image|reset` on `~/.config/omarchy/branding/screensaver.txt` (reset copies `$OMARCHY_PATH/logo.txt`), each followed by `omarchy-launch-screensaver force`; image picker `omarchy-file-select --extensions "png svg"` (xdg portal) → `omarchy-transcode-ascii` — `omarchy-menu.jsonc:121-123`, `bin/omarchy-branding-screensaver`.
- `System → Screensaver` → `omarchy-launch-screensaver force`; screensaver only runs in Alacritty/Foot/Ghostty/Kitty (`org.omarchy.screensaver` window per monitor) — `omarchy-menu.jsonc:36`, `bin/omarchy-launch-screensaver`.
- `Style → About → {Edit Text, Set From Image, Restore Default}` → `omarchy-branding-about` on `~/.config/omarchy/branding/about.txt` (reset copies `icon.txt`; image converted `--width 54 --height 26`), then `omarchy-launch-about`; `Omarchy Menu → About` = `omarchy-launch-about` (fastfetch in `org.omarchy.about` window, green glint animation for single-width art) — `omarchy-menu.jsonc:33,118-120`, `bin/omarchy-branding-about`, `bin/omarchy-launch-about`.
- `omarchy transcode ascii <in.svg|png> <out.txt> [-w N] [-H N] [-m braille|block] [-t pct] [--invert] [--no-trim]`; defaults 80×26 braille 50 %; "Logo file not found", "Invalid mode", usage exit 1 — `bin/omarchy-transcode-ascii`.
- `omarchy ascii [text…]` (Delta Corps Priest 1; stdin when no args); digits/punctuation skipped and named on stderr "Skipped, no glyph in Delta Corps Priest 1: …"; all-unsupported → "…draws letters and spaces only, and that text has neither." exit 1; "Nothing to render" — `bin/omarchy-ascii`.
- Assets for tests: `/usr/share/omarchy/{logo.svg,icon.png,logo.txt,icon.txt}`, `/usr/share/omarchy/default/plymouth/logo.png`, `/usr/share/omarchy/themes/<t>/unlock.png` — repo root, `default/plymouth/`, `themes/*/`.

**42 — Common tweaks**
- Tray manager: right-click the tray expander arrow → pin/hide icons — `manual/42:9` (shell `omarchy.tray`, not inventoried here).
- Rounded corners: `~/.config/hypr/looknfeel.lua` `decoration.rounding = 8` (commented) — `config/hypr/looknfeel.lua:17-26`.
- No gaps: `general.{gaps_in,gaps_out,border_size} = 0` (commented) — `config/hypr/looknfeel.lua:4-14`; other commented knobs `layout = "scrolling"`, `dim_inactive`, `animations.enabled = false`, `single_window_aspect_ratio`, `scrolling.column_width`.
- `Super+Shift+Backspace` / `Trigger → Toggle → Window Gaps` → `omarchy-hyprland-window-gaps-toggle` = `omarchy-hyprland-toggle window-no-gaps` copies `default/hypr/toggles/window-no-gaps.lua` into `~/.local/state/omarchy/toggles/hypr/` and `hyprctl reload` — `utilities.lua:20`, `omarchy-menu.jsonc:98`, `bin/omarchy-hyprland-toggle`.
- `Super+Shift+Space` / `Trigger → Toggle → Menu Bar` → `omarchy-toggle-bar` (flag `bar-off`, `omarchy-shell -q omarchy.bar syncHidden`) — `utilities.lua:16`, `omarchy-menu.jsonc:96`, `bin/omarchy-toggle-bar`.
- `Super+Backspace` transparency, `Super+Ctrl+Backspace` single-window aspect — `utilities.lua:19,21`.
- `.bak` semantics on update-time restores — `manual/42:3`; refresh writes `.bak.<epoch>` — `bin/omarchy-refresh-config`.

**43 — Making your own theme**
- User themes `~/.config/omarchy/themes/<name>/`; system themes `/usr/share/omarchy/themes/` (22 shipped: catppuccin, catppuccin-latte, ethereal, everforest, flexoki-light, gruvbox, hackerman, kanagawa, last-horizon, lumon, lupine, matte-black, miasma, nord, osaka-jade, retro-82, ristretto, rose-pine, solitude, tokyo-night, vantablack, white) — `themes/`.
- Theme contents: `colors.toml` (mode, accent, selection, muted, background…, color aliases), `backgrounds/`, `preview.png`, `preview-unlock.png`, `unlock.png`, `icons.theme`, `keyboard.rgb`, `neovim.lua`, `vscode.json`, `shell.<section>.toml`, `light.mode` legacy — `themes/tokyo-night/`, `docs/theming.md:1-16,69-130`.
- `omarchy theme set <name>` (name lowercased, spaces→hyphens, `<tags>` stripped): "Invalid theme name" for empty/`.`-leading/slash; "Theme 'X' does not exist" exit 1; stages `next-theme`, overlays user theme (filtered when `.git` present: drops `*.lua`, `alacritty.toml foot.ini ghostty.conf kitty.conf vscode.json`, symlinks; prints "Ignored in …: …" and "A theme installed from a git repo cannot supply Lua, a terminal config, or vscode.json."), renders templates, swaps into `~/.local/state/omarchy/current/theme`, writes `theme.name`, applies to shell, picks next background, retints apps in parallel, runs `theme-set` hook — `bin/omarchy-theme-set`, `docs/theming.md:18-66`.
- Theme picker `Super+Shift+Ctrl+Space` / `Style → Theme` → `omarchy-theme-switcher` (preview.png or first background) → `omarchy-theme-set` — `utilities.lua:18`, `omarchy-menu.jsonc:104`.
- `omarchy theme list` (title-cased), `omarchy theme dir <name>`, `omarchy theme extras` (git-cloned user themes; exit 1 when none) — `bin/omarchy-theme-{list,dir,extras}`.
- `Install → Style → Theme` → floating terminal `omarchy-theme-install [url]` (gum input "Git repo URL (https or git@host:org/repo.git)"); URL screened by `omarchy-git-url-check`; name = basename minus `omarchy-`/`-theme`, lowercased, must match `^[a-z0-9_][a-z0-9._+-]*$` else "Error: 'URL' does not give a usable theme name."; existing dir removed; `git clone` ("Error: Failed to clone theme repo."); then `omarchy-theme-set` — `omarchy-menu.jsonc:201`, `bin/omarchy-theme-install`.
- `Remove → Theme` → `omarchy-theme-remove [name]` (picker of user theme dirs; "No extra themes installed." exit 1; "Error: Theme 'X' not found."; notification "Theme removed") — `omarchy-menu.jsonc:291`, `bin/omarchy-theme-remove`.
- `Update → Extra Themes` gated `omarchy-theme-extras` → `omarchy-theme-update` (`git pull` each) — `omarchy-menu.jsonc:356`, `bin/omarchy-theme-update`.
- Light mode: `mode = "light"` in colors.toml (or legacy `light.mode`) → `gsettings color-scheme prefer-light`, gtk-theme Adwaita; icons via `icons.theme` (Yaru variants) — `bin/omarchy-theme-set-gnome`.
- Unlock image: `unlock.png` + `preview-unlock.png` → listed in `Style → Unlock` — `bin/omarchy-plymouth-list`.
- User templates `~/.config/omarchy/themed/<output>.tpl` processed before built-ins, never overwrite a file the theme ships; placeholders `{{ key }}`, `{{ key_strip }}`, `{{ key_rgb }}`, `{{ mix a b pct }}`, gradient helpers; sample `alacritty.toml.tpl.sample` — `bin/omarchy-theme-set-templates:370-401`, `config/omarchy/themed/`, `docs/theming.md:131-177`.
- Aether theme GUI via Apps menu `Super+Alt+Space` — `manual/43:7`, `install/omarchy-base.packages:4`.

## Observations

- **Menu hotkeys.** The manual consistently says the Omarchy menu is `Super+Space`; that is correct (`utilities.lua:1`). `Super+Escape` opens the *System* submenu (Lock/Suspend/Hibernate/Logout/Reboot/Shutdown), which is what the existing `lock-screen` definition uses. Typing in the menu filters rows (aliases are searchable), so drivers can type `dns`, `plugins`, `channel` to jump.
- **"Automatic restart after quitting the editor" is only partly true.** `Setup → Config → Hyprsunset` and `Setup → Config → XCompose` chain an explicit restart. `Setup → Monitors/Keybindings/Input`, `Style → Hyprland` and `Setup → Config → Hyprland` just open the editor and rely on Hyprland's own config file-watching (`misc.disable_autoreload` is left at its default and is paused/resumed by `omarchy-hyprland-reload-guard` around package transactions). Whether Hyprland's watcher covers *required* Lua modules (`~/.config/hypr/monitors.lua` etc.) is not something the tree proves. Every test below that edits a Hyprland file therefore tells the driver to run `hyprctl reload` after saving and to note whether the change had already applied before doing so.
- **Floating "presentation" terminals.** Menu actions wrapped in `omarchy-launch-floating-terminal-with-presentation` show the Omarchy logo, run the command, then print `● Done! Press any key to close...` (green) or `● Failed (exit code N)! Press any key to close...` (red). Ctrl+C (exit 130) closes without the prompt. Drivers must press a key to dismiss; the exit code in the prompt is the assertion.
- **sudo in the VM.** User `prime`/password `prime`. Terminal commands marked `requires-sudo` prompt `[sudo] password for prime:`; three wrong attempts print `sudo: 3 incorrect password attempts`. Menu actions that need root but run without a terminal (`Setup → Network → DNS → Cloudflare`) fall back to `pkexec`, so a polkit dialog (shell `omarchy.polkit` plugin) appears unless `etc/sudoers.d/omarchy-dns` grants the command passwordless.
- **Stock state on the minted disk.** Channel `stable`, ISO 4.0.2 vs latest 4.0.4 → the update indicator should appear once `checkupdates` has run (needs network; runs at shell start). Default theme name should be read from `~/.local/state/omarchy/current/theme.name` rather than assumed. `monitors.lua` ships `scale = "auto"` and `GDK_SCALE=2`: on the virtio display at 1× this makes GTK windows (Nautilus, the portal file chooser, Aether) render oversized — expected, not a bug.
- **Monitor scale snapping.** `omarchy-hyprland-monitor-scaling` rounds to divisors of `gcd(w*120, h*120)`; on non-16:9 virtio modes some presets snap (e.g. 3 → 3.2). Proofs should read the value back with `hyprctl monitors -j | jq '.[0].scale'` instead of asserting the exact preset.
- **Recovering from a broken Hyprland Lua file.** Hyprland keeps the last good config and shows a red error bar; `Update → Config → Hyprland` restores all seven user files (backups as `<file>.bak.<epoch>`). Do not write a rule that disables the only monitor (`disabled = true` on `Virtual-1`) — recovery would need a TTY.
- **Hardware-gated rows are absent in the guest.** `Trigger → Hardware` shows none of Laptop Display / Mirror Display / Touchpad / Touchpad Haptics / Touchscreen / Hybrid GPU (`omarchy-hw-laptop` is false: no lid, DMI chassis type 1). `Setup → Security → Fingerprint` and `Setup → Network → QR Code` are hidden. `Trigger → Toggle → Battery Percentage` is hidden. The hotkeys behind the display toggles still fire and give the "No laptop display found" notifications, which is the testable path.
- **Networking in the guest.** One virtio NIC, NetworkManager connection "Wired connection 1"; `omarchy-network-status` → `ethernet <iface>`. Find the interface with `ip route get 1.1.1.1`. Speedtest works (fast.com over NAT); ICMP ping does not (the panel's ping samples will be empty).
- **`file://` URLs are allowed** by `omarchy-git-url-check`, so theme and plugin *install* paths can be exercised offline against a local bare repo created in the guest. Names come from the repo directory basename, so name the folder `omarchy-<name>-theme`.
- **Screensaver and About** open terminal windows with classes `org.omarchy.screensaver` / `org.omarchy.about`; any key exits the screensaver. Set-from-image uses the xdg-desktop-portal GTK file chooser: `Ctrl+L` lets the driver type an absolute path.
- **What the driver's keyboard can and cannot send.** Besides the documented keys, `send-keys` accepts `<CAPSLOCK>`, `<MENU>`, `<INSERT>`, `<PRINT>`, `<PAUSE>` and any QEMU qcode containing `_` (`<alt_r>`, `<shift_r>`, `<ctrl_r>`, `<meta_r>`, `<kp_enter>`), including in combos (`<A-alt_r>` = Left Alt + Right Alt, `<S-CAPSLOCK>`). So the compose key (CapsLock, `compose:caps`) and `grp:alts_toggle` layout switching are fully drivable. What cannot be sent are the XF86 media/brightness/power keys (`volumeup`, `audiomute`, `brightnessup`, `power`), so brightness/volume/`XF86PowerOff` bindings stay untestable.
- **Compose sequences.** Stock `~/.XCompose` includes `/usr/share/omarchy/default/xcompose`: CapsLock `m` `s` → 😄, CapsLock space space → —. Sequences are read by fcitx5 at start, so a hand edit needs `omarchy-restart-xcompose` (the `Setup → Config → XCompose` entry chains it); a sequence typed before the restart comes out as plain letters — expected, not a bug.
- **Danish layout probe.** With `kb_layout = "us,dk"` the physical `;` `'` `[` keys type `æ` `ø` `å` on the dk layout, so one line of typing proves which layout is active; the bar shows the `omarchy.keyboard-layout` widget only when more than one layout is configured.
- **Fonts.** Only JetBrainsMono Nerd Font is guaranteed; `omarchy font list` shows whatever `fc-list :spacing=100` finds (Noto Sans Mono is likely present via noto-fonts). Foot never reloads fonts/sizes — open a *new* terminal to see font or text-size changes.
- **Long output** should go to serial: `cmd 2>&1 | sudo tee /dev/ttyS0`.
- **Time budget.** Everything tagged SLOW rebuilds an initramfs (`limine-mkinitcpio`, 1–3 min in the guest) or reboots. `omarchy update` on a one-month-behind stable mirror plus a 4.0.2→4.0.4 jump, and `omarchy-channel-set` (full `-Syyuu` plus, for dev, a clone of the omarchy repo), will likely exceed ten minutes on user-mode NAT; they are kept in the main list as NET+SLOW because every step is a terminal/menu action, but a driver should report "incomplete — time" rather than "failed" if the budget runs out mid-download.
- **Limine boot menu.** After `System → Reboot` the firmware screen is followed by the Limine menu (arrow keys, Enter); a "Snapshots" entry generated by `limine-snapper-sync` lists snapper snapshots newest-first. Booting one still asks the LUKS passphrase and logs in normally; the root filesystem is the snapshot's. The only snapper config is `root` (`default/snapper/root`, `SUBVOLUME="/"`, five numbered snapshots kept), so a rollback probe must live under `/` (e.g. `/etc`), not in `$HOME`, to be sure it is covered. `omarchy snapshot create` needs sudo and exits 127 silently when snapper is absent, 1 with "No Snapper configs found" when unconfigured.

## Proposed tests

Conventions used in every block: user `prime`, password `prime`; "terminal" means a foot window opened with `Super+Enter`; "Omarchy Menu" is `Super+Space`; "System menu" is `Super+Escape`; "floating terminal" is the presentation window that ends with `● Done!` / `● Failed (exit code N)!` and closes on any key.

### update-menu-cancel   [VM-OK]
description: Update → Omarchy opens the guarded update flow in a floating terminal and a user who says No leaves the system untouched. Protects the confirm step every update passes through.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, select Update, then Omarchy.
  ** A floating terminal with the Omarchy logo must appear, then a boxed message "Ready to update?" listing "You cannot stop the update once you start!" and a link to the releases page, followed by the prompt "Continue with update?" with Yes/No.
  * Choose No (press the Right arrow to move to No, then Enter, or type n).
  ** The terminal must print "Update cancelled" and then a red "● Failed (exit code 1)! Press any key to close...".
  * Press any key; the window must close and the desktop must be exactly as before.
  * Open a terminal with Super+Enter and run: `omarchy version` — note the version string; then run `ls -la /tmp/omarchy-update.log`.
  ** The log file exists (the transcript starts before the prompt) but no packages were changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm prompts accept y/n keys as well as arrows+Enter.
  * If "Ready to update?" is preceded by a red free-space error instead, report it: the guest has a 40 GB disk and should pass the 10 GiB check.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "Ready to update?" box with the "Continue with update?" prompt
  ** Screenshot of "Update cancelled" followed by the red "Failed (exit code 1)" line
  ** Screenshot of the desktop after closing with the same version printed by `omarchy version`
  * If unsuccessful
  ** the terminal contents at the moment of failure and `./client get-serial`
covers: manual/30-updates.md (Updates intro), bin/omarchy-update, bin/omarchy-update-confirm, bin/omarchy-show-done, omarchy-menu.jsonc update.omarchy

### update-full-run   [VM-OK] [NET] [SLOW]
description: A confirmed Update → Omarchy run completes the whole pipeline (snapshot, packages, migrations, hooks, shell restart) and leaves a working desktop on the newer version. This is the main way a user keeps Omarchy alive; a broken update is the worst-case regression.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy version` and `omarchy channel current`; record both (expect a 4.0.x version and "stable").
  * Open the Omarchy Menu with Super+Space → Update → Omarchy.
  * At "Continue with update?" choose Yes.
  ** Expect, in order: a sudo password prompt (type prime), "Create system snapshot" (or a yellow "Continuing the update without a snapshot" / "No Snapper configs found" warning — record which), pacman downloading and installing packages, "Running migrations" style output from omarchy-migrate, possibly AUR/mise/orphan steps, then "Restarting shell" and "All plugins have been reloaded".
  ** If a reboot prompt appears ("Linux kernel has been updated. Reboot?" / "Updates require reboot. Ready?" / "Hyprland has been updated. Reboot?"), answer Yes, wait for the LUKS passphrase prompt (prime), log in, and return to the desktop.
  * Do not sleep more than five seconds between screenshots while packages download; keep screenshotting the progress.
  * Back on the desktop open a terminal and run `omarchy version`; it must be equal or newer than before. Run `tail -n 20 /tmp/omarchy-update.log | sudo tee /dev/ttyS0` so the tail of the transcript reaches the serial log.
  * Confirm the bar is drawn and the Omarchy Menu opens.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The download may run past the session budget on user-mode NAT. If it does, report the last screenshot as "incomplete — time" rather than as a failure.
  * A red block starting "Something went wrong during the update!" is the failure signature; capture it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the confirm, the package transaction, the "Restarting shell" line, and the restored desktop
  ** `omarchy version` before and after (after ≥ before) and the transcript tail in `./client get-serial`
  * If unsuccessful
  ** the red "Something went wrong during the update!" block, the surrounding transcript, `./client get-serial`
covers: manual/30-updates.md, bin/omarchy-update, bin/omarchy-update-restart, bin/omarchy-snapshot, docs/update-process.md (Path 1)

### update-available-indicator   [VM-OK] [NET]
description: When a newer Omarchy release exists the bar shows the circle-arrow update icon right of the clock, and clicking it launches the update. The indicator is how most users learn an update exists.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the top bar centre: right of the clock there should be a circle-arrow icon (the `omarchy.system-update` widget). If it is missing, open a terminal (Super+Enter) and run `omarchy-update-available; echo exit=$?`.
  ** With the minted 4.0.2 disk and a newer stable release the command prints a line like "omarchy 4.0.2-1 -> 4.0.4-1" and exit=0; if it prints "Omarchy is up to date" and exit=1, the image already matches the mirror — record this and stop (the test is then not applicable).
  * If the command reported an update but the icon is absent, run `omarchy-restart-shell`, wait up to 20 seconds screenshotting, and check again.
  * Hover the icon (a tooltip may name the update) and click it with the mouse.
  ** A floating terminal with "Ready to update?" must open.
  * Choose No; the window prints "Update cancelled" and closes on a key press.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar centre section order is indicators, clock, keyboard-layout (hidden with one layout), weather, system-update; the icon sits at the far right of that cluster.
  * checkupdates needs network; if the guest just booted, allow a couple of screenshots for it to run.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the update icon visible right of the clock, or the terminal showing `omarchy-update-available` output matching the icon state
  ** Screenshot of the "Ready to update?" box after clicking the icon
  * If unsuccessful
  ** the bar screenshot plus `omarchy-update-available; echo exit=$?` output showing the mismatch
covers: manual/30-updates.md (circle arrow icon), bin/omarchy-update-available, config/omarchy/shell.json (omarchy.system-update), docs/update-process.md (Shell update indicator)

### update-pacman-guard-blocks-direct-syu   [VM-OK] [NET]
description: A direct `sudo pacman -Syu` is stopped by the Omarchy guard hook with instructions to use `omarchy update`, and a wrong sudo password is refused first. Protects users from skipping snapshots and migrations.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `sudo pacman -Syu`. At "[sudo] password for prime:" type `wrong` and Enter.
  ** sudo must print "Sorry, try again." and ask again.
  * Type `prime` and Enter.
  ** pacman synchronises the databases (network) and then, before installing anything, prints a block starting "Woah partner..." explaining "This looks like a direct pacman system upgrade" and suggesting `omarchy update` and the bypass `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`. pacman ends with an error such as "error: failed to commit transaction (failed to run transaction hooks)".
  ** If pacman reports "there is nothing to do" before any hook runs, the mirror has no upgrades for this image; record it and instead run `sudo pacman -S --needed omarchy` — the guard only fires on -Syu, so this must succeed silently. Note the two outcomes.
  * Run `omarchy version` to confirm the version did not change.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the terminal scrolls, run `sudo pacman -Syu 2>&1 | sudo tee /dev/ttyS0` and read it back with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "Sorry, try again." after the wrong password
  ** Screenshot (or serial text) of the "Woah partner..." message and the aborted transaction, with `omarchy version` unchanged
  * If unsuccessful
  ** the pacman output showing packages actually being upgraded, and `./client get-serial`
covers: manual/30-updates.md (Warning about direct pacman/yay updates), bin/omarchy-update-pacman-guard, docs/update-process.md (Raw pacman guard)

### update-channel-current-reject-and-dev-declined   [VM-OK]
description: The channel menu marks the active channel, `omarchy-channel-set` refuses an unknown channel, and choosing Dev warns and does nothing when declined. Protects users from accidental channel switches, which are heavy and hard to reverse.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy channel current`.
  ** It must print `stable`.
  * Open the Omarchy Menu with Super+Space → Update → Channel.
  ** Four rows Stable (green dot), RC (yellow), Edge (orange), Dev (red); only Stable carries a ✓. Press Escape.
  * In the terminal run `omarchy-channel-set bogus; echo exit=$?`.
  ** "Unknown channel: bogus", "Usage: omarchy-channel-set [stable|rc|edge|dev]", exit=1 — no sudo prompt, nothing changes. With no argument at all the same usage line and exit=1.
  * Open the Omarchy Menu → Update → Channel → Dev.
  ** A floating terminal prints the warning "The dev channel links Omarchy directly to a checkout of the source in ~/omarchy. It's exclusively intended for developers…" and asks "Switch to dev channel?" with No preselected.
  * Press Enter to accept the default No.
  ** It prints "Cancelled." and then "● Done!" (exit 0). Press a key to close.
  * Run `omarchy channel current` again: still `stable`; `ls ~/omarchy` says "No such file or directory" — the machine is exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do NOT confirm Dev, Edge or RC: those switches run a full mirror resync and exceed the session budget.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Channel submenu with ✓ on Stable only
  ** Screenshot of the "Unknown channel: bogus" usage output with exit=1
  ** Screenshot of the dev warning, "Cancelled." and `omarchy channel current` still printing stable
  * If unsuccessful
  ** any pacman/git activity that started (terminal contents) and `./client get-serial`
covers: manual/30-updates.md (Four channels), manual/31-dotfiles.md (dev channel), bin/omarchy-channel-set, bin/omarchy-channel-current, omarchy-menu.jsonc update.channel.*

### update-channel-switch-dev-and-back   [VM-OK] [NET] [SLOW]
description: Update → Channel → Dev links Omarchy to a source checkout in ~/omarchy on the edge packages and Update → Channel → Stable brings the machine back to the packaged stable release; the channel row, `omarchy version` and the reboot prompt follow along.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy version; omarchy channel current` (a 4.0.x version and `stable`). Keep the terminal open at one side.
  * Open the Omarchy Menu (Super+Space) → Update → Channel → Dev; at "Switch to dev channel?" move to Yes and press Enter; type `prime` at the sudo prompt.
  ** Expect, in order: `git clone https://github.com/omacom/omarchy.git` into ~/omarchy, "Setting channel to edge", a full package resync (`-Syyuu`, long), `omarchy-dev` replacing `omarchy`, then the unattended update and "Restarting shell". A reboot prompt ("Updates require reboot. Ready?") is normal — answer No for now.
  ** Downloads can take many minutes on user-mode NAT; keep screenshotting every few seconds, never sleep long. If the budget runs out here, report "incomplete — time".
  * Press a key on Done, then in the terminal run `omarchy channel current` → `dev`; `omarchy version` → `dev (<short hash>)`; `ls ~/omarchy/bin | head -3` lists omarchy scripts. Omarchy Menu → Update → Channel shows ✓ on Dev.
  * Omarchy Menu → Update → Channel → Stable (sudo prompt: prime).
  ** "Setting channel to stable", another resync that downgrades the too-new packages, `omarchy` replacing `omarchy-dev`, the update run, Done.
  * `omarchy channel current` → `stable`; `omarchy version` → a 4.0.x package version; the Channel submenu shows ✓ on Stable. ~/omarchy may remain on disk (the checkout is unlinked, not deleted) — note it.
  * Reboot via System menu (Super+Escape) → Reboot, enter the LUKS passphrase and log in: the desktop returns with the bar drawn.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Two full mirror resyncs plus a repository clone: this is the slowest test in the set. Report the last screenshot and the exact step if time runs out; do not leave the machine half-switched without saying so.
  * The red "The channel switch did not complete. Review the error above, then rerun: omarchy-channel-set <channel>" block is the failure signature.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dev warning answered Yes, the clone/resync transcript, `omarchy channel current` = dev with `omarchy version` = dev (hash) and ✓ on Dev, then the same three reading stable after switching back, and the desktop after reboot
  * If unsuccessful
  ** the "channel switch did not complete" block or a pacman error, the transcript tail via `tail -n 40 /tmp/omarchy-update.log | sudo tee /dev/ttyS0`, `./client get-serial`
covers: manual/30-updates.md (Four channels), manual/31-dotfiles.md (dev channel), bin/omarchy-channel-set, bin/omarchy-channel-current, bin/omarchy-version, bin/omarchy-refresh-pacman, omarchy-menu.jsonc update.channel.dev/stable

### update-rollback-boot-snapshot   [VM-OK] [SLOW]
description: A snapper snapshot taken before a change appears in the Limine boot menu, and booting it brings back the pre-change root filesystem, as the manual promises for recovering from a bad update; booting the normal entry afterwards returns to the current system.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy snapshot create` (sudo: prime).
  ** Expect the green "Create system snapshot", one snapper line per config, and "Snapshots can be selected during boot." If it prints "No Snapper configs found, so no snapshot was created." the minted disk has snapper unconfigured — record that and stop; the test does not apply.
  * Make a change that lives on the root filesystem: `sudo touch /etc/rollback-probe && ls -l /etc/rollback-probe`.
  * Reboot: System menu (Super+Escape) → Reboot. When the Limine menu appears, use the arrow keys to open the "Snapshots" entry and select the newest snapshot (its description is the `omarchy version` string). Press Enter.
  ** Enter the LUKS passphrase `prime` and log in as usual; the desktop comes up. A notice about running from a snapshot may or may not appear — screenshot either way.
  * Open a terminal: `ls /etc/rollback-probe` → "No such file or directory" (the snapshot predates the probe); `findmnt -no SOURCE / ` shows a `.snapshots/<n>/snapshot` subvolume.
  * Reboot again and this time take the default (first) Limine entry: after login `ls -l /etc/rollback-probe` exists again — the live system was untouched.
  * Restore: `sudo rm /etc/rollback-probe`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Limine menu shows for a few seconds; press Down immediately after the firmware screen to stop the countdown, then navigate.
  * Do not run `omarchy snapshot restore` (limine-snapper-restore): that makes the rollback permanent and is out of scope here.
  * Two reboots with LUKS prompts: budget about four minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the snapshot creation output, the Limine Snapshots submenu with the entry selected, the terminal in the snapshot boot showing the probe absent and the `.snapshots/<n>/snapshot` source, and the probe present again after the normal boot
  * If unsuccessful
  ** the Limine menu without a Snapshots entry, a boot that fails to reach the desktop, or the probe present inside the snapshot; `./client get-serial`
covers: manual/30-updates.md (Rolling back bad updates), bin/omarchy-snapshot, default/snapper/root, docs/update-process.md (snapshot step)

### update-firmware-no-devices   [VM-PARTIAL] [NET]
description: Update → Firmware installs fwupd on first use and runs a firmware refresh; in a VM there is nothing to update and the flow must end cleanly rather than crash. Only the software path is testable here (~5 MB download); real firmware writes are skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Update → Firmware.
  ** A floating terminal prints a green "Update Firmware". If fwupd is not installed it installs it (sudo prompt: prime; pacman output).
  ** Then `fwupdmgr refresh --force` downloads LVFS metadata (network), and `sudo fwupdmgr update` runs. In the guest expect "No updatable devices" / "Devices with no available firmware updates" style output, or a list of virtual devices with nothing to do.
  * Wait for the "● Done!" or "● Failed (exit code N)!" line and record which; press a key to close.
  * Open a terminal and run `fwupdmgr get-devices 2>&1 | head -n 20`; record the output.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fwupdmgr may ask "Do you want to upload report now?" or similar prompts; answer N.
  * A red Failed with exit code 2 from fwupdmgr (nothing to do) is acceptable if the text explains it; a bash error or missing command is not.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "Update Firmware" header, the refresh output, and the final Done/Failed line with its explanation
  ** `fwupdmgr get-devices` output showing the tool is installed and answering
  * If unsuccessful
  ** the terminal showing a script error (command not found, sudo failure) and `./client get-serial`
covers: manual/30-updates.md (Firmware updates), bin/omarchy-update-firmware, omarchy-menu.jsonc update.firmware

### reinstall-declined-and-configs-reset   [VM-OK]
description: `omarchy reinstall` warns and does nothing when declined, and `omarchy reinstall configs` restores every shipped dotfile from /etc/skel over a user edit. Protects the documented "reset everything" escape hatch.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy reinstall`.
  ** It prints "This will reinstall all default Omarchy packages and reset default configs. Warning: user config changes will be overwritten." and asks "Are you sure you want to reinstall and lose config changes?".
  * Answer No (press n).
  ** The command exits with no further output; `omarchy version` unchanged.
  * Make a visible user edit: run `echo '-- REINSTALL-PROBE' >> ~/.config/hypr/looknfeel.lua` and `tail -n 1 ~/.config/hypr/looknfeel.lua` (shows the probe line).
  * Run `omarchy reinstall configs`.
  ** Prints "Resetting Omarchy user configs to shipped defaults..." and then output from the limine/plymouth refresh (a sudo prompt may appear: type prime) and the Neovim refresh. It must not ask for confirmation and must not print "This script should not be run as root".
  * Run `tail -n 1 ~/.config/hypr/looknfeel.lua`.
  ** The probe line is gone; the file ends with the shipped `-- })` block.
  * Run `sudo omarchy reinstall configs; echo exit=$?`.
  ** Must print "Error: This script should not be run as root" and exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The plymouth refresh rebuilds the initramfs and can take a minute or two; keep screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the reinstall warning and the declined prompt
  ** Screenshot of the probe line before and its absence after `omarchy reinstall configs`
  ** Screenshot of the root refusal with exit=1
  * If unsuccessful
  ** the terminal output at the failing step and `./client get-serial`
covers: manual/30-updates.md (Rolling back bad updates), manual/31-dotfiles.md (Resetting any changes), manual/42-common-tweaks.md, bin/omarchy-reinstall, bin/omarchy-reinstall-configs

### setup-monitors-menu-opens-editor   [VM-OK]
description: Setup → Monitors opens ~/.config/hypr/monitors.lua in the default editor (Neovim) with an "Editing config file" toast, and quitting returns to the desktop. This is the entry point for every hand edit the manual describes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Setup → Monitors.
  ** A low-urgency notification "Editing config file" with the path ~/.config/hypr/monitors.lua appears, and a terminal window opens running Neovim on that file. The first line is `-- See https://wiki.hypr.land/Configuring/Basics/Monitors/`; the file contains `local omarchy_monitor_scale = "auto"` and `local omarchy_gdk_scale = 2`.
  * Press Escape, then type `:q` and Enter to quit without saving.
  ** The editor window closes and the desktop is as before.
  * Repeat for Setup → Keybindings (bindings.lua, first line `-- Keep only your personal keybinding overrides here…`) and Setup → Input (input.lua, first line `-- Keep only your personal input overrides here…`), quitting each with `:q`.
  * Also open Style → Hyprland (looknfeel.lua, first line `-- Change the default Omarchy look'n'feel.`) and quit.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Neovim shows a first-run plugin installer, wait for it to finish and take a screenshot before quitting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Neovim showing each of the four files with the expected first line, plus the "Editing config file" notification
  ** Screenshot of the clean desktop after each `:q`
  * If unsuccessful
  ** the notification/terminal state when the editor failed to open, and `./client get-serial`
covers: manual/31-dotfiles.md (key configs from the menu), manual/33, 34, 42, omarchy-menu.jsonc setup.monitors/keybindings/input, style.hyprland, bin/omarchy-launch-config-editor, bin/omarchy-launch-editor

### default-editor-switch-to-vim   [VM-OK] [NET]
description: Setup → Defaults → Editor changes which editor the config menu entries open, installing it if missing, and reports the change with a notification. Users who dislike Neovim depend on this.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Setup → Defaults → Editor.
  ** Rows Neovim (✓), VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs.
  * Select Vim.
  ** If vim is not installed a floating terminal installs it (sudo prompt: prime; small download) and closes on Done. Then a notification "Vim is now the default editor" appears.
  * Open a terminal (Super+Enter) and run `omarchy default editor` — prints `vim`; `cat ~/.local/state/omarchy/defaults/editor` — `vim`.
  * Open the Omarchy Menu → Setup → Monitors.
  ** The editor that opens is Vim (plain vim status line, no LazyVim dashboard). Quit with `:q`.
  * Run `omarchy default editor nope; echo exit=$?`.
  ** Prints "Usage: omarchy-default-editor <code|cursor|zed|sublime_text|helix|vim|emacs|nvim>" and exit=1; `omarchy default editor` still says vim.
  * Restore: Omarchy Menu → Setup → Defaults → Editor → Neovim; notification "Neovim is now the default editor"; `omarchy default editor` prints nvim.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If vim is already present no terminal appears; only the notification.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Editor submenu with ✓ on Neovim, the "Vim is now the default editor" notification, and vim opened by Setup → Monitors
  ** Screenshot of the usage/exit=1 for a bad name and the restored `nvim`
  * If unsuccessful
  ** the install terminal output or the missing notification, and `./client get-serial`
covers: manual/31-dotfiles.md (Setup → Defaults → Editor), bin/omarchy-default-editor, bin/omarchy-launch-editor, omarchy-menu.jsonc setup.default.editor.*

### bindings-lua-add-unbind-rebind   [VM-OK]
description: Edits to ~/.config/hypr/bindings.lua take effect after a reload: o.bind adds a hotkey, hl.unbind removes a default, o.rebind replaces one, and Update → Config → Hyprland puts the defaults back. This is the manual's canonical way to customise keys.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and append three lines with one command:
  ** `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Probe binding", "omarchy-notification-send \"Probe binding works\"")' 'hl.unbind("SUPER + SHIFT + B")' 'o.rebind("SUPER + SHIFT + F", "Rebound file manager", "omarchy-notification-send \"Rebound F works\"")' >> ~/.config/hypr/bindings.lua`
  * Run `hyprctl reload` — editing a Hyprland file does not reload the compositor by itself. No red error bar may appear at the top of the screen.
  * Press Super+Shift+R: a notification "Probe binding works" appears (o.bind added a key).
  * Press Super+Shift+B: nothing happens — no browser window opens within five seconds (hl.unbind removed the default; Super+Shift+Enter still opens the browser, proving the unbind was selective).
  * Press Super+Shift+F: a notification "Rebound F works" appears and Nautilus does NOT open (o.rebind replaced the default).
  ** Press Super+K and type `Probe`: the keybindings list shows "Probe binding" on SUPER + SHIFT + R. Escape.
  * Restore: Omarchy Menu (Super+Space) → Update → Config → Hyprland.
  ** The floating terminal prints "Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default. Saved backup as …bindings.lua.bak.<epoch>" with a diff of your three lines (only bindings.lua is reported; the other six files were untouched). Press a key on Done, then `hyprctl reload`.
  * Press Super+Shift+F: Nautilus opens again (close it with Super+W); Super+Shift+R gives no notification. Remove the backup: `rm ~/.config/hypr/*.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Hyprland auto-reloads on save the notification may work before `hyprctl reload`; note that in the report.
  * Super+Shift+B is the secondary browser binding; Super+Shift+Enter still opens the browser and can confirm the unbind was selective.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two probe notifications and the absence of a browser after Super+Shift+B
  ** Screenshot of Super+K listing "Probe binding"
  ** Screenshot of the Update → Config → Hyprland diff and Nautilus opening again afterwards
  * If unsuccessful
  ** a red Hyprland error bar or missing notification, `tail ~/.config/hypr/bindings.lua`, `./client get-serial`
covers: manual/31-dotfiles.md (Changing internal Omarchy files / o.rebind), config/hypr/bindings.lua, default/hypr/helpers.lua (o.bind/o.rebind), bin/omarchy-refresh-hyprland, bin/omarchy-refresh-config

### autostart-lua-launch-on-start   [VM-OK]
description: A command added with o.launch_on_start in ~/.config/hypr/autostart.lua runs when the session starts. Users rely on this for sync daemons and chat apps.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run:
  ** `echo 'o.launch_on_start("omarchy-notification-send \"Autostart probe ran\"")' >> ~/.config/hypr/autostart.lua`
  ** `tail -n 2 ~/.config/hypr/autostart.lua` to confirm.
  * Log out: System menu (Super+Escape) → Logout. Log back in at the login screen (user prime, password prime) if one appears; if the session auto-logs in just wait for the desktop.
  ** Within a few seconds of the bar appearing a notification "Autostart probe ran" must show.
  * Open a terminal and run `journalctl --user -b --no-pager | grep -i 'autostart probe' | tail -n 3 | sudo tee /dev/ttyS0` (may be empty if notifications are not journaled; the on-screen toast is the primary proof).
  * Restore: run `omarchy-refresh-config hypr/autostart.lua` (prints Replaced… with a backup) then `tail -n 2 ~/.config/hypr/autostart.lua` (only the shipped comment lines).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The notification may appear while the bar is still drawing; screenshot every two seconds after the login screen disappears.
  * Notifications auto-hide; Super+Shift+Alt+comma opens the notification history if you missed it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the notification "Autostart probe ran" after logging back in (or in the notification history)
  ** Screenshot of the restored autostart.lua
  * If unsuccessful
  ** the desktop after login with no notification and the history panel, plus `./client get-serial`
covers: manual/31-dotfiles.md (Starting your own apps with the session), config/hypr/autostart.lua, default/hypr/helpers.lua (o.launch_on_start)

### bashrc-alias-survives-new-terminal   [VM-OK]
description: Aliases and exports added to ~/.bashrc are picked up by every new terminal. Trivial but it is the manual's prescribed place for shell customisation.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `echo "alias probehello='echo hello-from-bashrc'" >> ~/.bashrc` and `echo 'export PROBE_VAR=set-in-bashrc' >> ~/.bashrc`.
  * Close this terminal with Super+W and open a new one with Super+Enter.
  * Run `probehello` — prints hello-from-bashrc. Run `echo $PROBE_VAR` — prints set-in-bashrc.
  * Run `grep -c 'probehello' ~/.bashrc` — prints 1.
  * Restore: `sed -i '/probehello/d; /PROBE_VAR/d' ~/.bashrc` and confirm `grep -c probehello ~/.bashrc` prints 0.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Omarchy .bashrc sources other files; appending at the end is safe.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `probehello` and `echo $PROBE_VAR` output in the new terminal
  * If unsuccessful
  ** the "command not found" output and `tail ~/.bashrc`
covers: manual/31-dotfiles.md (Adding your own shell exports, functions, and aliases)

### hooks-theme-set-sample-and-install   [VM-OK]
description: Activating the shipped theme-set hook sample makes a theme change fire a user script, `omarchy hook install` copies a script into the right directory, and a missing file is refused. Hooks are the manual's extension point for system events.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls ~/.config/omarchy/hooks/` — six directories: battery-low.d font-set.d post-boot.d post-update.d pre-refresh-pacman.d theme-set.d.
  * Activate the sample: `cd ~/.config/omarchy/hooks/theme-set.d && mv show-theme-notification.sample show-theme-notification && sed -i 's/^# omarchy-notification-send/omarchy-notification-send/' show-theme-notification && chmod +x show-theme-notification && cat show-theme-notification`.
  ** The last line is now `omarchy-notification-send -u low "New theme" "Your new theme is $1"`.
  * Note the current theme (`cat ~/.local/state/omarchy/current/theme.name`), then run `omarchy theme set nord`.
  ** The desktop recolours to Nord and a notification "New theme — Your new theme is nord" appears: the hook fired with the theme name in `$1`.
  * Install a second hook the manual's way: `printf '#!/bin/bash\nomarchy-notification-send "post-update hook ran"\n' > ~/my-hook && omarchy hook install post-update ~/my-hook`.
  ** Prints "Installed post-update hook: /home/prime/.config/omarchy/hooks/post-update.d/my-hook"; `ls -l` on that directory shows my-hook as -rwxr-xr-x. Fire it with `omarchy-hook post-update` → notification "post-update hook ran".
  ** Unhappy path: `omarchy hook install post-update ~/does-not-exist; echo exit=$?` → "Hook file not found: /home/prime/does-not-exist", exit=1; `omarchy hook install ../evil ~/my-hook; echo exit=$?` → "Invalid hook name: ../evil", exit=2.
  * Restore: `omarchy theme set <original theme>`; `rm ~/.config/omarchy/hooks/post-update.d/my-hook ~/my-hook`; `mv ~/.config/omarchy/hooks/theme-set.d/show-theme-notification ~/.config/omarchy/hooks/theme-set.d/show-theme-notification.sample` — a further theme change now shows no "New theme" notification.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The theme switch animates for a second; take the screenshot after the bar has recoloured.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "New theme — Your new theme is nord" notification over the Nord desktop
  ** Screenshot of "Installed post-update hook: …" and the "post-update hook ran" notification
  ** Screenshot of both refusals with exit=1 and exit=2
  * If unsuccessful
  ** terminal output at the failing step, `ls -la ~/.config/omarchy/hooks/*/`, `./client get-serial`
covers: manual/31-dotfiles.md (Running scripts on system events), bin/omarchy-hook, bin/omarchy-hook-install, config/omarchy/hooks/theme-set.d/show-theme-notification.sample, bin/omarchy-theme-set (theme-set hook)

### hooks-battery-low-command   [VM-PARTIAL]
description: The battery-low hook runs with the percentage in $1 when the shell reports a low battery. The guest has no battery, so the shell-side trigger is skipped (absence path: no battery widget, no Battery Percentage toggle) and the hook runner is exercised by typing the same command the shell runs, `omarchy-battery-low <pct>`, in a guest terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and create a hook: `printf '#!/bin/bash\nomarchy-notification-send "battery hook got $1"\n' > ~/.config/omarchy/hooks/battery-low.d/probe && chmod +x ~/.config/omarchy/hooks/battery-low.d/probe`.
  * Run `omarchy-battery-low 7`.
  ** The stock low-battery warning notification appears AND a notification "battery hook got 7" appears.
  * Run `omarchy-battery-low; echo exit=$?` → "Usage: omarchy-battery-low <percentage>", non-zero exit.
  * Confirm the bar shows no battery widget and Trigger → Toggle has no "Battery Percentage" row (Omarchy Menu → Trigger → Toggle), then Escape.
  * Restore: `rm ~/.config/omarchy/hooks/battery-low.d/probe`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Two notifications stack; screenshot immediately after the command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing "battery hook got 7" together with the low-battery warning
  ** Screenshot of the Toggle submenu without Battery Percentage (absence path)
  * If unsuccessful
  ** the terminal output and notification history, `./client get-serial`
covers: manual/31-dotfiles.md (battery-low hook), bin/omarchy-battery-low, bin/omarchy-hook, omarchy-menu.jsonc trigger.toggle.battery-percentage (when)

### menu-extension-personal-row-and-broken-jsonc   [VM-OK]
description: Rows added to ~/.config/omarchy/extensions/omarchy-menu.jsonc appear in the Omarchy menu without a restart, and a malformed file silently drops only the user rows while the shipped menu keeps working. Protects the documented menu customisation and its failure mode.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and write the extension (the shipped file is comments only, so overwrite it):
  ** `printf '%s\n' '{' '"personal": {"icon":"","label":"Personal"},' '"personal.notes": {"icon":"󰎞","label":"Notes","action":"omarchy-notification-send \"Notes row clicked\""},' '}' > ~/.config/omarchy/extensions/omarchy-menu.jsonc`
  * Open the Omarchy Menu with Super+Space.
  ** A new root row "Personal" is present (alongside Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System). If it is not there within one reopen, run `omarchy-restart-shell` and note that a restart was needed.
  * Select Personal → Notes.
  ** Notification "Notes row clicked".
  * Break the file with an inline comment (whole-line comments only are supported): `sed -i 's/"label":"Personal"}/"label":"Personal"} \/\/ inline/' ~/.config/omarchy/extensions/omarchy-menu.jsonc` and `cat` it.
  * Open the Omarchy Menu again (restart the shell if the earlier step needed it).
  ** "Personal" is gone; Apps…System still present and Setup → Monitors still works (open and `:q`).
  * Restore: `cp /usr/share/omarchy/config/omarchy/extensions/omarchy-menu.jsonc ~/.config/omarchy/extensions/omarchy-menu.jsonc` and confirm the menu shows no Personal row.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon glyphs are Nerd Font characters; an empty box glyph is fine, the label is what matters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with "Personal" and of the "Notes row clicked" notification
  ** Screenshot of the root menu without "Personal" after the inline comment, with the shipped rows intact
  * If unsuccessful
  ** the menu screenshot, the file contents, whether a shell restart was required, `./client get-serial`
covers: manual/31-dotfiles.md (Adding your own menu entries), config/omarchy/extensions/omarchy-menu.jsonc, docs/menu.md (parsing rules)

### update-config-shell-resets-bar-position   [VM-OK]
description: Update → Config → Shell restores ~/.config/omarchy/shell.json to the shipped default (bar back on top) with a timestamped backup. shell.json is the file the manual names for bar/idle settings, and this is its documented reset.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Style → Menu Bar → Position → Bottom.
  ** The bar moves to the bottom edge.
  * Open a terminal with Super+Enter and run `grep -n '"position"' ~/.config/omarchy/shell.json` → `"position": "bottom"`.
  * Open the Omarchy Menu → Update → Config → Shell.
  ** Floating terminal prints "Replaced /home/prime/.config/omarchy/shell.json with new Omarchy default. Saved backup as …shell.json.bak.<epoch>" and a diff containing the position line; the shell restarts (bar disappears and reappears at the top); "● Done!".
  * Press a key to close. Run `grep -n '"position"' ~/.config/omarchy/shell.json` → `"position": "top"`, and `ls ~/.config/omarchy/shell.json.bak.*` lists one backup.
  * Negative: `omarchy-refresh-config not/a/file; echo exit=$?` → "Not a shipped user config: not/a/file", exit=1.
  * Clean up: `rm ~/.config/omarchy/shell.json.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar takes a second or two to come back after the shell restart.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar at the bottom, the Replaced/diff output, and the bar at the top again
  ** Screenshot of the grep output before/after and the "Not a shipped user config" refusal
  * If unsuccessful
  ** the floating terminal output, the shell.json contents, `./client get-serial`
covers: manual/31-dotfiles.md (shell.json, Resetting any changes), bin/omarchy-refresh-shell, bin/omarchy-refresh-config, omarchy-menu.jsonc update.config.shell, style.bar.position.*

### setup-config-hyprsunset-edit-restarts-service   [VM-OK]
description: Setup → Config → Hyprsunset opens hyprsunset.conf and restarts the hyprsunset service when the editor exits, as the manual promises for menu-driven edits. Checks the one config entry that really does chain a restart.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `systemctl --user show -p ActiveEnterTimestamp omarchy-hyprsunset.service 2>/dev/null || systemctl --user list-units --no-pager | grep -i hyprsunset`; record the timestamp/unit name shown. If no user unit exists, run `pgrep -a hyprsunset` and record the PID.
  * Open the Omarchy Menu with Super+Space → Setup → Config → Hyprsunset.
  ** Notification "Editing config file ~/.config/hypr/hyprsunset.conf"; Neovim opens the file.
  * Add a comment line: press `G`, `o`, type `# probe edit`, Escape, then `:wq` Enter.
  * In the terminal rerun the same status command.
  ** The ActiveEnterTimestamp is later than before (or the PID changed), proving a restart followed the editor.
  * Run `grep -c 'probe edit' ~/.config/hypr/hyprsunset.conf` → 1.
  * Restore: Omarchy Menu → Update → Config → Hyprsunset → floating terminal shows Replaced… diff with the probe line and restarts the service; Done.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * hyprsunset may be run by omarchy-restart-app rather than a unit; the PID comparison is the fallback proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the status/PID before and after showing a restart, and of the edited file
  ** Screenshot of the Update → Config → Hyprsunset diff
  * If unsuccessful
  ** identical timestamps/PIDs after quitting the editor, `./client get-serial`
covers: manual/31-dotfiles.md (any process that needs restarting…), omarchy-menu.jsonc setup.config.hyprsunset, update.config.hyprsunset, bin/omarchy-refresh-hyprsunset, bin/omarchy-restart-hyprsunset

### foot-ini-padding-edit   [VM-OK]
description: ~/.config/foot/foot.ini controls the default terminal; a padding change is visible in the next terminal opened. Named in the dotfiles table as a key user file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; screenshot it (note the ~14 px gap between the window border and the prompt text).
  * Run `sed -i 's/^pad=.*/pad=60x60/' ~/.config/foot/foot.ini && grep -n '^pad=' ~/.config/foot/foot.ini` → `pad=60x60`.
  * Open a second terminal with Super+Enter.
  ** The new window has a visibly larger inner margin (about 60 px) around the text; the first window is unchanged (foot does not reload).
  * Restore: in the new terminal run `sed -i 's/^pad=.*/pad=14x14/' ~/.config/foot/foot.ini`; open a third terminal — margin back to normal. Close all with Ctrl+Alt+Delete.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Tile the two terminals side by side (they tile automatically) so the padding difference is obvious in one screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Side-by-side screenshot of the 14 px and 60 px padded terminals
  ** Screenshot of the third terminal after restore
  * If unsuccessful
  ** foot failing to start (no window) or an error toast, plus `cat ~/.config/foot/foot.ini | sudo tee /dev/ttyS0` and `./client get-serial`
covers: manual/31-dotfiles.md (~/.config/foot/foot.ini), config/foot/foot.ini

### plugin-list-cli   [VM-OK]
description: `omarchy plugin list` prints every discovered shell plugin with id, state, source, kinds and name, and `--json` emits machine-readable output. This is the first command the shell-plugins chapter teaches.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin list | sudo tee /dev/ttyS0` (password prime).
  ** A header row `ID STATE SOURCE KINDS NAME` followed by rows; every id starts with `omarchy.` (e.g. omarchy.clock, omarchy.network, omarchy.notifications, omarchy.bar), STATE is enabled/disabled, SOURCE is first-party, KINDS lists e.g. bar-widget, service, panel.
  * Run `omarchy plugin list --json | jq 'length'` → a number ≥ 20; `omarchy plugin list --json | jq -r '.[] | select(.id=="omarchy.clock") | .enabled'` → true.
  * Negative: `omarchy plugin list --bogus; echo exit=$?` → "omarchy-plugin-list: unknown option: --bogus", exit=1.
  * `omarchy plugin list --help` → "Usage: omarchy plugin list [--json]".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The table is wide; the serial copy is the reliable read.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text of the full table showing only omarchy.* ids marked first-party, with omarchy.clock enabled
  ** Screenshot of the jq count and the unknown-option refusal
  * If unsuccessful
  ** the error printed by `omarchy plugin list` (e.g. IPC timeout to omarchy-shell) and `./client get-serial`
covers: manual/32-shell-plugins.md (Seeing what you have), bin/omarchy-plugin-list

### plugin-disable-enable-weather-and-bad-ids   [VM-OK]
description: Disabling a first-party bar widget removes it from the bar and shell.json records the change; re-enabling restores it; unknown ids and placing a bar as a widget are refused. Protects the on/off switch for every desktop piece.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar; note the weather widget in the centre cluster (right of the clock; it may read "Weather unavailable" without a location — that is fine).
  * Open a terminal with Super+Enter and run `omarchy plugin disable omarchy.weather`.
  ** Prints "Disabled omarchy.weather"; within a few seconds the weather widget disappears from the bar.
  * Run `grep -c 'omarchy.weather' ~/.config/omarchy/shell.json` and `jq '.disabledPlugins // [], .bar.layout.center | map(.id? // .)' ~/.config/omarchy/shell.json | sudo tee /dev/ttyS0`.
  ** shell.json no longer lists omarchy.weather in bar.layout.center, or lists it in disabledPlugins — record which.
  * Open the Omarchy Menu (Super+Space) → Setup → Plugins → Enable Plugin.
  ** A picker listing disabled plugins, including Weather (id shown as subtext). Select Weather.
  ** The widget returns to the bar centre. `omarchy plugin list | grep weather` shows enabled.
  * Negative: `omarchy plugin disable acme.nothing; echo exit=$?` → "omarchy-plugin-disable: plugin 'acme.nothing' is not known; run: omarchy-shell shell rescanPlugins", exit=1.
  * Negative: `omarchy plugin enable omarchy.bar --section right; echo exit=$?` → "…'omarchy.bar' is a bar; it replaces the bar in use rather than taking a place in one", exit=1.
  * Negative: `omarchy plugin enable omarchy.weather nowhere; echo exit=$?` → "section must be left, center, or right", exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is an omarchy-menu-select overlay; arrow keys + Enter select, typing filters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots with and without the weather widget, plus the shell.json excerpt on serial
  ** Screenshot of the Enable Plugin picker listing Weather and the widget restored
  ** Screenshot of the three refusals with exit=1
  * If unsuccessful
  ** the command output, `cat ~/.config/omarchy/shell.json`, `./client get-serial`
covers: manual/32-shell-plugins.md (Turning them on and off), bin/omarchy-plugin-disable, bin/omarchy-plugin-enable, bin/omarchy-menu-plugin, config/omarchy/shell.json, omarchy-menu.jsonc setup.plugin.enable/disable

### plugin-add-rejects-bad-urls   [VM-OK]
description: `omarchy plugin add` refuses URLs that name a git transport helper or option before cloning, warns about unsandboxed code, and reports a clone failure cleanly. Protects the trust boundary the chapter stresses.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `omarchy plugin add 'ext::sh -c id' --yes; echo exit=$?`.
  ** Output: "omarchy-git-url-check: 'ext::sh -c id' names a git option or transport helper, not a repository." exit=1. No directory appears under ~/.config/omarchy/plugins/.
  * Run `omarchy plugin add 'gopher://example.invalid/repo.git' --yes; echo exit=$?`.
  ** "…names the 'gopher' transport, which Omarchy does not clone from." exit=1.
  * Run `omarchy plugin add '--upload-pack=id' --yes; echo exit=$?` → refused the same way (names a git option), exit=1.
  * Run `omarchy plugin add file:///home/prime/no-such-repo.git --yes; echo exit=$?`.
  ** git prints a clone error and the script ends "omarchy-plugin-add: failed to clone file:///home/prime/no-such-repo.git", exit=1. `ls -a ~/.config/omarchy/plugins/` shows no `.add.tmp.*` leftovers.
  * Run `omarchy plugin add https://example.com/x.git` (no --yes) — the warning "⚠️  Plugins run as arbitrary, unsandboxed code inside your long-lived omarchy-shell process…" with "URL: https://example.com/x.git" and "Clone and add this plugin?" appears; answer No → "omarchy-plugin-add: aborted".
  * Menu path: Omarchy Menu (Super+Space) → Setup → Plugins → Add Plugin → floating terminal asks "Git URL of the plugin repo:"; press Escape (or Ctrl+C) → "omarchy-plugin-add: cancelled" and Failed exit 1 (or the window closes on Ctrl+C). Press a key to close.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Quote the odd URLs exactly as shown; the point is that they never reach git.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three URL refusals, the clone failure, and the warning/abort text
  ** `ls -a ~/.config/omarchy/plugins/` with no staging directory
  * If unsuccessful
  ** any sign that git ran a helper (unexpected output such as uid=1000) or a leftover staging directory, `./client get-serial`
covers: manual/32-shell-plugins.md (Adding a plugin from git), bin/omarchy-plugin-add, bin/omarchy-git-url-check, omarchy-menu.jsonc setup.plugin.add

### plugin-add-local-git-repo-lifecycle   [VM-OK]
description: A valid third-party plugin can be added from a git URL (a local file:// repo here), enabled, listed as third-party, updated ("up to date"), and removed, with the duplicate-id and already-installed refusals along the way. Exercises the whole third-party lifecycle without network.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and build a minimal service plugin repo:
  ** `mkdir -p ~/probe-plugin && cd ~/probe-plugin && printf '%s\n' '{"schemaVersion":1,"id":"prime.probe","name":"Probe Service","version":"0.1.0","kinds":["service"],"entryPoints":{"service":"Service.qml"}}' > manifest.json && printf 'import QtQuick\nQtObject {}\n' > Service.qml && git init -q && git add . && git -c user.name=p -c user.email=p@x commit -qm init && cd ~`
  ** `omarchy plugin validate ~/probe-plugin; echo exit=$?` prints nothing and exit=0.
  * Run `omarchy plugin add file:///home/prime/probe-plugin --enable --yes`.
  ** Prints "Added prime.probe into /home/prime/.config/omarchy/plugins/prime.probe" then "Enabled prime.probe". `omarchy plugin list | grep probe` shows `prime.probe enabled third-party service Probe Service`; the bar and Omarchy Menu (Super+Space, Escape) still work.
  ** Unhappy path: run the same add again with `--yes` → "plugin id 'prime.probe' is already used by …" (or "already installed; update it with: omarchy plugin update prime.probe"), exit 1.
  * Run `omarchy plugin update prime.probe` → "prime.probe is up to date."
  ** Then bump the repo and update for real: `cd ~/probe-plugin && sed -i 's/0.1.0/0.2.0/' manifest.json && git commit -qam bump && cd ~ && omarchy plugin update prime.probe --yes` → "Updated prime.probe."; `jq -r .version ~/.config/omarchy/plugins/prime.probe/manifest.json` → 0.2.0.
  * Omarchy Menu (Super+Space) → Setup → Plugins → Remove Plugin (the row only exists now that a third-party plugin is installed) → pick Probe Service.
  ** Floating terminal asks "Delete 'prime.probe'? Its git repo remains upstream." → Yes → "Removed prime.probe." → Done. `omarchy plugin list | grep -c probe` → 0.
  ** Unhappy path: `omarchy plugin update prime.probe; echo exit=$?` → "plugin 'prime.probe' is not installed" (or "no plugins installed"), exit=1.
  * Clean up: `rm -rf ~/probe-plugin`; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A service plugin has no UI; the proof is the list output and the shell staying healthy.
  * If the shell logs a QML load error for the probe it must not crash the bar; report any bar restart.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of validate exit=0, "Added…/Enabled…", the list row marked third-party, the duplicate refusal, "up to date", "Updated" with version 0.2.0, and "Removed"
  ** Screenshot of the bar intact after enable and after remove
  * If unsuccessful
  ** the failing command output, `omarchy plugin list --json | jq '.[] | select(.id=="prime.probe")'`, `./client get-serial`
covers: manual/32-shell-plugins.md (Adding a plugin from git, Updating, Removal), bin/omarchy-plugin-add, bin/omarchy-plugin-update, bin/omarchy-plugin-remove, bin/omarchy-plugin-validate, bin/omarchy-menu-plugin remove, omarchy-menu.jsonc setup.plugin.remove (when)

### plugin-validate-checks   [VM-OK]
description: `omarchy plugin validate` rejects the reserved omarchy.* namespace, a missing manifest, a missing entry point and a symlink inside the folder, and accepts a correct manifest. Authors depend on it matching the shell's own checks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `mkdir -p ~/v && cd ~/v && omarchy plugin validate --help` — the usage paragraph lists the checks.
  * Start from a folder with nothing in it: `mkdir p && omarchy plugin validate p; echo exit=$?` → "missing manifest.json in p", exit=1.
  * Give it a manifest in the reserved namespace: `echo '{"schemaVersion":1,"id":"omarchy.fake","name":"x","version":"1","kinds":["service"],"entryPoints":{"service":"S.qml"}}' > p/manifest.json && touch p/S.qml && omarchy plugin validate p; echo exit=$?` → "plugin id 'omarchy.fake' uses the reserved omarchy.* namespace", exit=1.
  * Fix the id but claim a kind without its entry point: `sed -i 's/omarchy.fake/prime.probe/; s/\["service"\]/["service","panel"]/' p/manifest.json && omarchy plugin validate p; echo exit=$?` → "kind 'panel' requires an 'entryPoints.panel' to load", exit=1.
  ** Then `sed -i 's/,"panel"//; s/"schemaVersion":1/"schemaVersion":"1"/' p/manifest.json` and validate again → "unsupported or missing schemaVersion (expected 1)" — the string "1" is rejected, exit=1.
  * Put the version back and add a symlink: `sed -i 's/"schemaVersion":"1"/"schemaVersion":1/' p/manifest.json && ln -s /etc/hostname p/evil && omarchy plugin validate p; echo exit=$?` → "symlinks are not allowed inside a plugin folder: p/evil", exit=1.
  * Remove the symlink: `rm p/evil && omarchy plugin validate p; echo exit=$?` → no output, exit=0 — the folder is now a valid plugin.
  * Clean up: `cd ~ && rm -rf ~/v`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each failure message is one line on stderr; the exit code is the assertion.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot(s) showing the five distinct refusals with exit=1 and the final exit=0
  * If unsuccessful
  ** the mismatching message or exit code and `./client get-serial`
covers: manual/32-shell-plugins.md (Writing your own — validate), bin/omarchy-plugin-validate

### plugin-clone-clock-and-remove-restores   [VM-OK]
description: Setup → Plugins → Clone Plugin copies a built-in into ~/.config/omarchy/plugins/<user>.<name>, renames it "My <Name>", enables it in place of the original and opens it in the editor; removing the clone restores the built-in. This is the manual's recommended way to modify a built-in widget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar clock.
  * Open the Omarchy Menu (Super+Space) → Setup → Plugins → Clone Plugin.
  ** A picker of first-party plugins not yet cloned; select "Clock" (id omarchy.clock).
  ** A floating terminal runs the clone; a notification "Editing Cloned Plugin — Original plugin has been replace by clone." appears; the terminal prints "Cloned omarchy.clock to /home/prime/.config/omarchy/plugins/prime.clock and switched to prime.clock" and then opens the editor ($EDITOR, normally nvim) on that directory (a file browser/netrw or LazyVim explorer view).
  * Quit the editor (`:q`, or `:qa`), then press a key if the Done prompt shows.
  ** The bar still shows a clock — now rendered by the clone. Open the Omarchy Menu → Setup → Plugins → Clone Plugin again: Clock is no longer offered (already cloned). Escape.
  * Open a terminal with Super+Enter: `omarchy plugin list | grep -i clock` → two rows, `omarchy.clock disabled first-party …` and `prime.clock enabled third-party … My Clock`.
  ** Unhappy path: `omarchy plugin clone omarchy.nothing; echo exit=$?` → "unknown built-in plugin: omarchy.nothing", exit=1; `omarchy plugin clone omarchy.clock; echo exit=$?` → "…/prime.clock already exists", exit=1.
  * Run `omarchy plugin remove prime.clock --yes`.
  ** Prints "Removed prime.clock. Backup at: …/.prime.clock.bak.<stamp>" (a hand-made folder is backed up, not deleted) and "Restored omarchy.clock." The bar clock keeps ticking throughout.
  * `omarchy plugin list | grep -i clock` → only omarchy.clock, enabled; remove the backup with `rm -rf ~/.config/omarchy/plugins/.prime.clock.bak.*` so the plugins folder is empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clone directory has no .git, so removal moves it to a hidden timestamped backup instead of deleting.
  * If $EDITOR opens a GUI editor instead, close it with Super+W.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the "Editing Cloned Plugin" notification, the editor on the clone directory, and the two-row list output with My Clock enabled
  ** Screenshot of "Removed prime.clock." / "Restored omarchy.clock." and the list back to one clock row, bar clock visible throughout
  * If unsuccessful
  ** a bar without a clock, or the terminal error, `ls -la ~/.config/omarchy/plugins/`, `./client get-serial`
covers: manual/32-shell-plugins.md (Cloning a built-in to modify it), bin/omarchy-plugin-clone, bin/omarchy-plugin-remove, bin/omarchy-menu-plugin clone, omarchy-menu.jsonc setup.plugin.clone

### monitor-scaling-hotkeys-cycle-and-persist   [VM-OK]
description: Super+/ and Super+Alt+/ step the focused monitor through the preset scales and persist the choice into monitors.lua so it survives reboots. This is the quick fix the manual offers for wrong DPI.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `hyprctl monitors -j | jq -r '.[0] | "\(.name) \(.width)x\(.height) scale=\(.scale)"'` and `grep -n 'omarchy_monitor_scale\|omarchy_gdk_scale' ~/.config/hypr/monitors.lua`.
  ** Record the monitor name (likely Virtual-1), mode and scale (likely 1) and the two `local … = …` lines (`"auto"` and `2`).
  * Press Super+/ once.
  ** Everything on screen (bar, terminal text) visibly grows — that screenshot is the main proof. Rerun the jq command: scale is the next preset ≥ 1.25 (may be snapped, e.g. 1.25 or 1.6). `grep` again: `local omarchy_monitor_scale = <that value>` and `local omarchy_gdk_scale = <nearest integer>` — the change is persisted for the next boot.
  * Press Super+/ a second time (larger still), then Super+Alt+/ twice.
  ** The screen returns to its starting size and monitors.lua reads `local omarchy_monitor_scale = 1` with `omarchy_gdk_scale = 1`.
  * Run `omarchy hyprland monitor scaling 1.6` — the screen jumps to 1.6× directly; then `omarchy hyprland monitor scaling 1` brings it back and `omarchy hyprland monitor scaling` alone prints `1`.
  ** Unhappy path: `omarchy hyprland monitor scaling 9; echo exit=$?` → the usage line, exit=1, nothing on screen changes.
  * Restore the shipped file: `omarchy-refresh-config hypr/monitors.lua && hyprctl reload` — monitors.lua reads `"auto"` again (which resolves to 1× on this display, so the screen looks as at the start); the backup is `monitors.lua.bak.<epoch>`, remove it with `rm ~/.config/hypr/monitors.lua.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * At higher scales the terminal may need Super+F (fullscreen) to keep the output readable.
  * "auto" in the shipped file resolves to 1 on the virtio display, so the visible size at the end matches the start.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots at scale 1, after one and two Super+/ presses (visibly larger UI), and back at 1, each with the jq scale value and the matching monitors.lua lines
  ** Screenshot of the usage refusal for `9` and of the audit log lines
  * If unsuccessful
  ** the jq output and monitors.lua contents showing the mismatch, `./client get-serial`
covers: manual/33-monitors.md (Super + / … persist past reboot), default/hypr/bindings/tiling.lua:97-98, bin/omarchy-hyprland-monitor-scaling, config/hypr/monitors.lua

### monitors-lua-scale-edit-applies   [VM-OK]
description: Editing the two `local` scale variables in ~/.config/hypr/monitors.lua via Setup → Monitors changes the monitor scale (and GDK_SCALE for new GTK apps) after reload. This is the exact edit the manual prescribes for 4K/1080p displays.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Monitors; Neovim opens monitors.lua.
  * Change `local omarchy_monitor_scale = "auto"` to `local omarchy_monitor_scale = 2` and `local omarchy_gdk_scale = 2` to `local omarchy_gdk_scale = 2` (unchanged). Use `:%s/omarchy_monitor_scale = "auto"/omarchy_monitor_scale = 2/` then `:wq`.
  * Open a terminal with Super+Enter and run `hyprctl reload`, then `hyprctl monitors -j | jq '.[0].scale'`.
  ** Everything is drawn at 2× (bar twice as tall, large text); jq prints 2.
  * Change it again to 1: `sed -i 's/^local omarchy_monitor_scale = .*/local omarchy_monitor_scale = 1/; s/^local omarchy_gdk_scale = .*/local omarchy_gdk_scale = 1/' ~/.config/hypr/monitors.lua && hyprctl reload && hyprctl monitors -j | jq '.[0].scale'` → 1, normal size.
  * Check GDK_SCALE reaches new apps: `hyprctl getoption misc:disable_autoreload >/dev/null; env | grep -c GDK_SCALE` in a NEW terminal (Super+Enter) — note the value; then open Nautilus with Super+Shift+F and screenshot (at GDK_SCALE=1 it is normal size; the earlier default 2 made GTK windows oversized). Close it with Super+W.
  * Restore: `omarchy-refresh-config hypr/monitors.lua && hyprctl reload`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the screen already changed before `hyprctl reload`, Hyprland auto-reloaded on save; note it.
  * hl.env values reach processes started after the reload only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot at 2× with jq printing 2, and at 1× with jq printing 1
  ** Screenshot of Nautilus at normal size under GDK_SCALE=1
  * If unsuccessful
  ** a red Hyprland error bar, unchanged scale after reload, `cat ~/.config/hypr/monitors.lua`, `./client get-serial`
covers: manual/33-monitors.md (fractional scaling / 1x scaling), config/hypr/monitors.lua, omarchy-menu.jsonc setup.monitors

### monitors-lua-syntax-error-recovers   [VM-OK]
description: A broken monitors.lua (Lua syntax error) must not take the desktop down: Hyprland shows a config error and keeps the last good config, and Update → Config → Hyprland restores the file. This is the "I made a mess" recovery path the manual promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and break the file: `echo 'hl.monitor({ output = "", mode = "preferred"' >> ~/.config/hypr/monitors.lua` (unclosed call), then `hyprctl reload`.
  ** A red/orange Hyprland error bar appears at the top of the screen describing a Lua/config error mentioning monitors.lua (text like "error parsing config" or "unexpected symbol"). The bar, terminal and mouse keep working; the display does not go black.
  * Press Super+Enter: a second terminal still opens (bindings from the last good config remain).
  * Open the Omarchy Menu (Super+Space) → Update → Config → Hyprland.
  ** Floating terminal prints "Replaced /home/prime/.config/hypr/monitors.lua with new Omarchy default. Saved backup as …monitors.lua.bak.<epoch>" plus the diff showing your broken line; other files print nothing (unchanged). "● Done!" — press a key.
  * Run `hyprctl reload`.
  ** The error bar disappears.
  * `ls ~/.config/hypr/*.bak.*` lists the monitors backup; remove it: `rm ~/.config/hypr/*.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Hyprland auto-reloads on save the error bar may appear before you run hyprctl reload.
  * Never add a rule that disables Virtual-1; recovery would need a TTY.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Hyprland config error bar with the desktop still usable behind it
  ** Screenshot of the Update → Config → Hyprland diff and of the clean desktop after reload
  * If unsuccessful
  ** a black screen / lost input (report via `./client get-serial` and TTY switch `<C-A-F3>` to check the system is alive), or the error bar persisting after restore
covers: manual/31-dotfiles.md (Resetting any changes), manual/42-common-tweaks.md (restore individual configs), config/hypr/monitors.lua, bin/omarchy-refresh-hyprland, omarchy-menu.jsonc update.config.hyprland

### monitors-lua-invalid-mode-falls-back   [VM-OK]
description: A per-monitor rule asking for a mode the display cannot do must fall back to the preferred mode instead of blanking the screen. Users mistype resolutions; this is the safe-failure path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; get the monitor name: `hyprctl monitors -j | jq -r '.[0].name'` (expect Virtual-1) and current mode `hyprctl monitors -j | jq -r '.[0] | "\(.width)x\(.height)@\(.refreshRate)"'`.
  * Append a bad rule: `echo 'hl.monitor({ output = "Virtual-1", mode = "9999x9999@1", position = "0x0", scale = 1 })' >> ~/.config/hypr/monitors.lua` (substitute the real name) and run `hyprctl reload`.
  ** The screen stays on. Rerun the mode query: the width/height are unchanged (Hyprland fell back to the preferred mode); `journalctl --user -b --no-pager 2>/dev/null | grep -i -m3 'invalid mode\|falling back\|9999' | sudo tee /dev/ttyS0` may show the fallback message (optional).
  * Restore: `omarchy-refresh-config hypr/monitors.lua && hyprctl reload && rm -f ~/.config/hypr/monitors.lua.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the display goes black for more than five seconds, switch to a TTY with Ctrl+Alt+F3, log in as prime, run `mv ~/.config/hypr/monitors.lua ~/broken.lua && cp /usr/share/omarchy/config/hypr/monitors.lua ~/.config/hypr/`, then Ctrl+Alt+F1 (or F2) and report the blackout as a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after reload showing the desktop intact and the jq mode identical to before
  * If unsuccessful
  ** the blackout duration and the TTY recovery steps taken, `./client get-serial`
covers: manual/33-monitors.md (Arranging multiple screens / hl.monitor entries), config/hypr/monitors.lua

### display-text-size-command   [VM-OK]
description: `omarchy display text size N` scales the shell, GTK and terminal text together within 9–20 px, `reset` returns to defaults, and out-of-range values are refused. This is the manual's "make text bigger without rescaling everything" knob.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy display text size`.
  ** Prints three lines: `text size: 12 (default) px` (or 12 px), `gtk text-scaling-factor: 1.0`, `terminal font: 9 pt`.
  * Run `omarchy display text size 18`.
  ** A notification "Restart Foot to apply the new terminal font size" appears (foot is running); the bar text visibly grows within a few seconds. Rerun `omarchy display text size` → `text size: 18 px`, a gtk factor > 1 (e.g. 1.5), `terminal font: 14 pt` (18*9/12 rounded).
  * `grep -A1 '^\[font\]' ~/.config/omarchy/shell.toml` → `base-size = 18`; `grep '^font=' ~/.config/foot/foot.ini` → `font=JetBrainsMono Nerd Font:size=14`; `gsettings get org.gnome.desktop.interface text-scaling-factor` → the same factor.
  * Open a new terminal (Super+Enter): its text is larger than the first one's.
  * Negative: `omarchy display text size 30; echo exit=$?` → "Size must be an integer between 9 and 20 (px)." + usage, exit=1; `omarchy display text size abc; echo exit=$?` → same, exit=1.
  * Run `omarchy display text size reset`; `omarchy display text size` → 12 / 1.0 / 9; bar text back to normal; `grep '^font=' ~/.config/foot/foot.ini` → size=9.
  * Close all terminals with Ctrl+Alt+Delete.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell watches shell.toml, so bar text re-flows live; foot only changes for new windows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three-line status before/after, the enlarged bar text and new terminal, the foot notification, and the refusals with exit=1
  ** Screenshot after reset with 12/1.0/9
  * If unsuccessful
  ** the status output and the relevant config lines, `./client get-serial`
covers: manual/33-monitors.md (Making text bigger or smaller), bin/omarchy-display-text-size

### laptop-display-toggles-absent-in-vm   [VM-PARTIAL]
description: On a machine without a laptop panel the display toggles report "No laptop display found" / "No laptop monitor found to mirror" instead of doing anything, and Trigger → Hardware hides its laptop rows. Only the absence path can run here; the real extend/mirror switch needs two displays.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Delete.
  ** A notification "No laptop display found" appears; the screen stays on.
  * Press Super+Ctrl+Alt+Delete.
  ** A notification "No laptop monitor found to mirror" (or "No external monitors found for mirror") appears; the screen stays on.
  * Open the Omarchy Menu (Super+Space) → Trigger → Hardware.
  ** The submenu has no "Laptop Display", "Mirror Display", "Touchpad", "Touchpad Haptics", "Touchscreen" or "Hybrid GPU" rows (all gated on hardware). It may be empty or show only "Touchpad Haptics" as a bare submenu header — record exactly what is listed.
  * Open a terminal with Super+Enter and run `omarchy-hw-laptop; echo exit=$?` → exit=1; `ls ~/.local/state/omarchy/toggles/hypr/` → only flags.lua (no internal-monitor-*.lua created).
  * Press Super+Ctrl+D: the display panel (brightness) opens or a notice appears; there is no backlight to move. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notifications hide after a few seconds; screenshot immediately after each hotkey.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both notifications and of the Trigger → Hardware submenu without laptop rows
  ** Terminal showing omarchy-hw-laptop exit=1 and the toggles directory containing only flags.lua
  * If unsuccessful
  ** a black screen, a stray toggle file, or a missing notification, `./client get-serial`
covers: manual/33-monitors.md (Extending and mirroring laptop displays), bin/omarchy-hyprland-monitor-internal, bin/omarchy-hyprland-monitor-internal-mirror, bin/omarchy-hw-laptop, omarchy-menu.jsonc trigger.hardware.*, default/hypr/bindings/utilities.lua:33-34

### input-lua-repeat-rate-and-compose-option   [VM-OK]
description: Settings placed in ~/.config/hypr/input.lua replace Omarchy's defaults after a reload: keyboard repeat and the compose-key xkb option are read back from Hyprland. This is the chapter's basic promise ("anything you set there replaces Omarchy's defaults").
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and record defaults: `hyprctl getoption input:repeat_rate | head -1`, `hyprctl getoption input:repeat_delay | head -1`, `hyprctl getoption input:kb_options | head -1` (expect compose:caps,shift:both_capslock_cancel).
  * Open the Omarchy Menu (Super+Space) → Setup → Input; in Neovim go to the end (`G`) and append with `o`:
  ** `hl.config({ input = { repeat_rate = 60, repeat_delay = 200, kb_options = "compose:ralt" } })`
  ** Escape, `:wq`.
  * Run `hyprctl reload`, then the three getoption commands again.
  ** repeat_rate int: 60, repeat_delay int: 200, kb_options str: compose:ralt.
  * Hold a key to see the faster repeat: in the terminal type `cat`, Enter, then use `./client send-keys` to type a long run of `a` — output is not the assertion; getoption is.
  * Press Ctrl+C. Negative: append a bad value `hl.config({ input = { repeat_rate = "fast" } })` via `echo 'hl.config({ input = { repeat_rate = "fast" } })' >> ~/.config/hypr/input.lua && hyprctl reload`.
  ** Hyprland shows a config error bar (type mismatch) or silently ignores the value; getoption repeat_rate must still be a number (60). Record which.
  * Restore: `omarchy-refresh-config hypr/input.lua && hyprctl reload && rm -f ~/.config/hypr/input.lua.bak.*`; getoption shows the defaults again (25/600 and compose:caps,…).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hyprctl getoption` prints "int: N" / "str: value" lines followed by "set: true".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of getoption before (defaults) and after (60/200/compose:ralt)
  ** Screenshot of the bad-value outcome (error bar or ignored) and of the restored defaults
  * If unsuccessful
  ** getoption values unchanged after reload or a persistent error bar, `cat ~/.config/hypr/input.lua`, `./client get-serial`
covers: manual/34-keyboard-mouse-trackpad.md (input.lua example, compose key), config/hypr/input.lua, omarchy-menu.jsonc setup.input

### input-lua-layout-switch-both-alts   [VM-OK]
description: Two keyboard layouts configured in input.lua (with grp:alts_toggle) show the layout indicator in the bar and switch when both Alts are pressed, so Danish letters come out of the same keys; a bogus layout name is refused without breaking typing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and screenshot: the bar centre has no layout indicator with a single layout.
  * Open the Omarchy Menu (Super+Space) → Setup → Input; in Neovim press `G`, `o` and type `hl.config({ input = { kb_layout = "us,dk", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })`, Escape, `:wq`.
  ** Editing a Hyprland file does not reload the compositor by itself: in the terminal run `hyprctl reload`. A small layout indicator ("us"/"EN") appears in the bar centre beside the clock.
  * In the terminal type `;'[` and press Space: the US layout prints `;'[`.
  * Press Left Alt and Right Alt together (one chord).
  ** The indicator changes to "dk"/"DA". Type `;'[` again: the Danish layout prints `æøå`.
  * Press both Alts again: indicator back to "us"; `;'[` prints `;'[` once more.
  * Unhappy path: run `echo 'hl.config({ input = { kb_layout = "xx" } })' >> ~/.config/hypr/input.lua && hyprctl reload`.
  ** Hyprland shows a config error bar mentioning the keymap/xkb (it falls back to US); typing `echo ok` in the terminal still works and prints ok.
  * Restore: `omarchy-refresh-config hypr/input.lua && hyprctl reload && rm -f ~/.config/hypr/input.lua.bak.*` — the error bar and the layout indicator both disappear; `;'[` prints `;'[`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The both-Alts chord is one send-keys token: `<A-alt_r>`. Tap it once per switch.
  * `omarchy-refresh-config` writes the old file to `input.lua.bak.<epoch>`; that is the expected backup name.
  * The indicator widget only exists while more than one layout is configured.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar without and with the layout indicator, the terminal line showing `;'[` under us and `æøå` under dk, and the indicator flipping back
  ** Screenshot of the config error bar for `kb_layout = "xx"` with the terminal still typing, and the clean bar after restore
  * If unsuccessful
  ** the indicator not changing or `;'[` printed under dk, the error bar persisting after restore; `cat ~/.config/hypr/input.lua | sudo tee /dev/ttyS0` and `./client get-serial`
covers: manual/34-keyboard-mouse-trackpad.md (multiple keyboard layouts, grp:alts_toggle), config/hypr/input.lua, omarchy-menu.jsonc setup.input, config/omarchy/shell.json (omarchy.keyboard-layout), bin/omarchy-refresh-config

### xcompose-add-sequence-and-restart   [VM-OK]
description: The CapsLock compose key types the stock quick-emoji sequences, a sequence added to ~/.XCompose only works after omarchy-restart-xcompose (which Setup → Config → XCompose runs for you), and removing it makes the keys plain letters again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Tap CapsLock, then type `ms`.
  ** The stock sequence produces a 😄 at the prompt (CapsLock is the compose key, not caps lock). Press Backspace to clear it.
  * Add a sequence by hand without restarting: run `echo '<Multi_key> <q> <q> : "COMPOSE-PROBE"' >> ~/.XCompose`, then tap CapsLock and type `qq`.
  ** Unhappy path: plain `qq` appears — fcitx5 has not re-read the file. This is the quirk the manual warns about. Press Backspace twice.
  * Run `omarchy-restart-xcompose` (returns quietly, one or two seconds), then tap CapsLock and type `qq`.
  ** `COMPOSE-PROBE` appears at the prompt.
  * Now use the menu path: Omarchy Menu (Super+Space) → Setup → Config → XCompose.
  ** Notification "Editing config file ~/.XCompose"; Neovim shows the file with your line at the end. Delete that line (`G`, `dd`) and `:wq` — the menu entry restarts fcitx5 when the editor closes.
  * Back in the terminal tap CapsLock and type `qq`: plain `qq` again (sequence gone), while CapsLock `ms` still gives 😄.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send CapsLock as a bare `<CAPSLOCK>` tap followed by the letters as literal text; do not hold it.
  * The emoji renders as a colour glyph in foot; a hollow box means the font fell back but the compose still fired.
  * If `ms` prints plain `ms` at the very first step, fcitx5 is not running: `systemctl --user is-active omarchy-fcitx5.service` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of 😄 after CapsLock `ms`, plain `qq` before the restart, `COMPOSE-PROBE` after `omarchy-restart-xcompose`, the editor with the line removed, and plain `qq` with 😄 still working at the end
  * If unsuccessful
  ** the prompt showing plain letters after the restart, or 😄 never appearing; `systemctl --user status omarchy-fcitx5.service | sudo tee /dev/ttyS0` and `./client get-serial`
covers: manual/31-dotfiles.md (~/.XCompose, omarchy-restart-xcompose), manual/34-keyboard-mouse-trackpad.md (CapsLock compose key), omarchy-menu.jsonc setup.config.xcompose, bin/omarchy-restart-xcompose, install/user/xcompose.sh, default/xcompose

### network-panel-ethernet-only   [VM-PARTIAL]
description: The network panel opens from the bar icon and Super+Ctrl+W and shows the wired connection; with no Wi-Fi adapter it must not list networks or crash, and the Wi-Fi-only menu row (QR Code) is hidden. Wi-Fi scanning/connecting itself cannot be tested here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W.
  ** A network panel drops from the bar showing a wired/ethernet connection (the interface name or "Wired connection 1"), no Wi-Fi list, and possibly a DNS section. Screenshot, then press Super+Ctrl+W (or Escape) to close.
  * Click the network icon in the bar's right section with the mouse; the same panel opens. Close it.
  * Open the Omarchy Menu (Super+Space) → Setup → Network.
  ** Only "DNS" is listed; there is no "QR Code" row.
  * Open a terminal with Super+Enter and run `omarchy-network-status` → `ethernet <iface>` (tab separated); `omarchy-network-qr; echo exit=$?` → "No active Wi-Fi connection", exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar right section order is tray, agents, bluetooth, network, audio, monitor, power; bluetooth may be hidden without an adapter, so the network icon is near the left of that cluster.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the network panel showing the wired connection, the Setup → Network submenu with only DNS, and the terminal output
  * If unsuccessful
  ** a panel error, a QR Code row present, or the status command output, `./client get-serial`
covers: manual/35-networking.md (Networking intro, Sharing your Wi-Fi), default/hypr/bindings/utilities.lua:102, bin/omarchy-network-status, bin/omarchy-network-qr, omarchy-menu.jsonc setup.network.qr (when)

### network-wifi-cli-without-wifi   [VM-PARTIAL]
description: The Wi-Fi CLI helpers fail with clear messages when there is no wireless connection: password, band and band pinning. Only the error path is available in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and find the interface: `ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}'` (e.g. enp0s2 or ens3).
  * Run `omarchy network password <iface>; echo exit=$?`.
  ** Prints "This network has no password" or "No active Wi-Fi connection" on stderr and exit=1 — never a password.
  * Run `omarchy network password nosuch0; echo exit=$?` → nmcli error + "No active Wi-Fi connection", exit=1.
  * Run `omarchy network password; echo exit=$?` → the router shows usage/help (required argument) and a non-zero exit.
  * Run `omarchy network band; echo exit=$?` → no output, exit=0 (nothing to report without Wi-Fi).
  * Run `omarchy network band 5; echo exit=$?` → "Error: no connected Wi-Fi device.", exit=1.
  * Run `omarchy network band 7; echo exit=$?` → "Usage: omarchy-network-band [auto|2.4|5|6]", exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All messages are single lines; one screenshot per command is enough.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot(s) of each command with the expected message and exit code
  * If unsuccessful
  ** any command printing a secret, hanging, or exiting 0 where an error was expected; `./client get-serial`
covers: manual/35-networking.md (Sharing your Wi-Fi, Pinning the Wi-Fi band), bin/omarchy-network-password, bin/omarchy-network-band

### dns-cli-cloudflare-and-back   [VM-OK] [NET]
description: `omarchy dns` reports DHCP by default, `omarchy dns Cloudflare` switches the whole machine to Cloudflare (NetworkManager drop-in + resolved) with name resolution still working, `omarchy dns DHCP` reverts, and an unknown provider is refused. DNS override is one of the few system-wide network settings the manual exposes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy dns` → `DHCP`. Run `resolvectl status | grep -m2 'DNS Servers'` and record the current servers (the NAT gateway, e.g. 10.0.2.3).
  * Run `omarchy dns Cloudflare`. At the sudo prompt first type `wrong` Enter ("Sorry, try again."), then `prime`.
  ** No further output; exit 0.
  * Run `omarchy dns` → `Cloudflare`. `cat /etc/NetworkManager/conf.d/20-omarchy-dns.conf` → servers=1.1.1.1,1.0.0.1,2606:4700:4700::1111,2606:4700:4700::1001. `grep ^DNS= /etc/systemd/resolved.conf` → 1.1.1.1#cloudflare-dns.com …. `resolvectl status | grep -m3 'DNS Servers\|Current DNS'` → 1.1.1.1 listed.
  * Run `getent hosts omarchy.org` → an IP address is printed (resolution works through Cloudflare).
  * Run `omarchy dns Google` (sudo) → `omarchy dns` → `Google`; `grep ^DNS= /etc/systemd/resolved.conf` mentions dns.google.
  * Negative: `omarchy dns Quad9; echo exit=$?` → "Usage: omarchy-dns [Cloudflare|Google|DHCP|Custom]", exit=1; `omarchy dns Cloudflare Google; echo exit=$?` → usage, exit=1.
  * Restore: `omarchy dns DHCP` (sudo) → `omarchy dns` → `DHCP`; `ls /etc/NetworkManager/conf.d/20-omarchy-dns.conf` → No such file; `getent hosts omarchy.org` still resolves.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Case-insensitive: `omarchy dns cloudflare` also works.
  * resolvectl output is long; pipe to `| sudo tee /dev/ttyS0` if needed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `omarchy dns` printing DHCP → Cloudflare → Google → DHCP, with the drop-in and resolved.conf contents at each step and `getent hosts omarchy.org` resolving
  ** Screenshot of the wrong-password retry and the two usage refusals
  * If unsuccessful
  ** the failing command output, `resolvectl status | sudo tee /dev/ttyS0`, `./client get-serial`
covers: manual/35-networking.md (DNS), bin/omarchy-dns

### dns-menu-check-mark-and-custom   [VM-OK]
description: Setup → Network → DNS marks the active provider, selecting Cloudflare from the menu escalates via sudo or a polkit prompt and moves the check mark, Custom prompts for servers in a floating terminal and rejects an empty answer. Protects the click path most users will take.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Network → DNS.
  ** Rows DHCP ✓, Cloudflare, Google, Custom.
  * Select Cloudflare.
  ** Either it applies silently (passwordless sudoers grant) or a polkit authentication dialog appears; if so type prime and confirm. Record which.
  * Reopen Omarchy Menu → Setup → Network → DNS: ✓ is now on Cloudflare only.
  * Select Custom.
  ** A floating terminal prints "Enter your DNS servers (space-separated, e.g. '192.168.1.1 1.1.1.1'):" (after a sudo prompt if needed). Press Enter with nothing typed.
  ** "Error: No DNS servers provided." then red "● Failed (exit code 1)!" — press a key.
  * Reopen the DNS submenu: ✓ still on Cloudflare (the failed Custom changed nothing).
  * Select Custom again; type `9.9.9.9 149.112.112.112` Enter → "● Done!". Reopen the submenu: ✓ on Custom. Open a terminal (Super+Enter): `omarchy dns` → Custom; `grep servers= /etc/NetworkManager/conf.d/20-omarchy-dns.conf` → 9.9.9.9,149.112.112.112.
  * Restore: Omarchy Menu → Setup → Network → DNS → DHCP; reopen: ✓ on DHCP; `omarchy dns` → DHCP.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The polkit dialog is a shell overlay; the password field is focused when it appears.
  * The ✓ is computed when the submenu opens, so always reopen it to read the state.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the DNS submenu with ✓ on DHCP, Cloudflare, Custom and back on DHCP
  ** Screenshot of the polkit dialog (if shown), the empty-input error with Failed (exit code 1), and the accepted Custom servers
  * If unsuccessful
  ** the submenu with a wrong ✓, the floating terminal error text, `./client get-serial`
covers: manual/35-networking.md (DNS), omarchy-menu.jsonc setup.network.dns.*, bin/omarchy-dns (Custom, require_root/pkexec)

### network-speedtest-panel-and-cli   [VM-OK] [NET]
description: Trigger → Speed Test → Network Speed Test shows live up/down dials and `omarchy network speedtest down` prints throughput per second. Confirms the fast.com-backed measurement works through NAT and fails cleanly on bad arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Trigger → Speed Test → Network Speed Test.
  ** A panel with two dials (download/upload) appears and the download needle/number starts moving within ~10 seconds; the numbers settle in Mbps. Take at least three screenshots over 15 seconds. Close the panel (Escape or click outside).
  * Also open Trigger → Speed Test → Disk Speed Test, screenshot the disk dials, close it.
  * Open a terminal with Super+Enter and run `timeout 12 omarchy network speedtest down`.
  ** Prints one number per second (e.g. 45, 120, 130.5); stops after 12 s.
  * Run `omarchy network speedtest sideways; echo exit=$?` → "Usage: omarchy-network-speedtest [down|up]", exit=2.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the dials stay at 0 and the CLI prints "Failed to fetch speed test endpoints", fast.com is unreachable; report it as a network failure with `getent hosts api.fast.com` output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the network dials with non-zero values, the disk dials, and the CLI numbers
  ** Screenshot of the usage refusal with exit=2
  * If unsuccessful
  ** the zero dials / error text and `getent hosts api.fast.com`, `./client get-serial`
covers: manual/35-networking.md (How fast is it?), omarchy-menu.jsonc trigger.tests.*, bin/omarchy-network-speedtest

### firewall-default-ufw-status   [VM-OK]
description: The firewall is on out of the box: incoming denied, only LocalSend's 53317 allowed, SSH not open until the user enables it. Verifies the documented default without changing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `sudo ufw status verbose | sudo tee /dev/ttyS0` (password prime).
  ** "Status: active", "Default: deny (incoming), allow (outgoing)…", and rules for 53317 (tcp/udp) ALLOW IN. No rule for 22.
  * Run `systemctl is-enabled sshd; systemctl is-active sshd` → disabled (or not-found) and inactive.
  * Open the Omarchy Menu (Super+Space) → Setup → Security: rows include SSHD (present), Fido2, Passwordless Sudo; Remove → Security must NOT show SSHD (not enabled). Escape.
  * Do not enable SSHD in this test.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ufw's table is wide; the serial copy is the reliable read.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text of `ufw status verbose` showing active/deny incoming/53317 allowed and no port 22
  ** Screenshot of sshd disabled/inactive and the Security submenus
  * If unsuccessful
  ** "Status: inactive", a port 22 rule, or sshd active; `./client get-serial`
covers: manual/35-networking.md (The firewall), install/omarchy-base.packages (ufw), omarchy-menu.jsonc setup.security.sshd, remove.security.sshd (when)

### update-hardware-restart-rows-in-vm   [VM-PARTIAL]
description: Update → Hardware → Audio/Wi-Fi/Bluetooth/Trackpad each run their restart helper in a floating terminal and finish cleanly even when the hardware is absent. The manual points users here before rebooting; a helper that crashes without hardware would be worse than useless.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Hardware → Wi-Fi.
  ** Floating terminal prints "Unblocking wifi..." followed by (empty) rfkill output, then "● Done!". Press a key.
  * Update → Hardware → Bluetooth → "Unblocking bluetooth..." then Done.
  * Update → Hardware → Trackpad → no devices found so it prints nothing (or "Reloading intel_quicki2c" is absent) and ends Done; it must not prompt for sudo when there is no device.
  * Update → Hardware → Audio → "Restarting audio services...", possibly "Audio status:" with `wpctl status` output listing PipeWire with no sinks, then Done (or Failed exit 1 with "Audio services are still not responding" — record which; the guest has no audio device).
  * After the audio restart confirm the bar still draws and Super+Ctrl+A opens the audio panel (may say no devices). Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The audio restart waits up to 25 s twice; keep screenshotting every few seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Four screenshots of the floating terminals ending in Done (or the explained audio Failed), and the bar intact afterwards
  * If unsuccessful
  ** a bash error, an unexpected sudo prompt for Trackpad, or a shell crash; `./client get-serial`
covers: manual/35-networking.md (When it stops working), omarchy-menu.jsonc update.hardware.*, bin/omarchy-restart-wifi, bin/omarchy-restart-bluetooth, bin/omarchy-restart-trackpad, bin/omarchy-restart-audio

### tailscale-install-adds-bar-panel   [VM-PARTIAL] [NET]
description: Install → Service → Tailscale installs the package, marks the menu row as installed, adds the Tailscale panel to the bar and a Remove row; logging into a tailnet needs an account and is skipped. Download ≈ 30 MB.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Service. Screenshot: Tailscale is selectable (not dimmed).
  * Select Tailscale.
  ** Floating terminal: sudo prompt (prime), pacman installs tailscale, service enabled, possibly a web-app entry created; ends "● Done!". Press a key.
  * Open the Omarchy Menu → Install → Service: the Tailscale row is now dimmed with a ✓ (installed). Escape. Omarchy Menu → Remove → Services lists Tailscale. Escape.
  * Look at the bar's right section: a Tailscale icon/panel is present (may indicate "disconnected"/"logged out"). Click it; a panel offers connect/login. Do not log in. Close it.
  * Open a terminal with Super+Enter: `omarchy plugin list | grep -i tailscale` → omarchy.tailscale enabled; `systemctl is-active tailscaled` → active; `tailscale status; echo exit=$?` → "Logged out." (non-zero exit is fine).
  * Restore: Omarchy Menu → Remove → Services → Tailscale → floating terminal removes it → Done. The bar icon disappears and Install → Service shows Tailscale selectable again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the package download exceeds the budget, report the last screenshot as incomplete rather than failed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install terminal ending Done, the dimmed ✓ row, the bar with the Tailscale panel, the plugin list line, and the bar after removal
  * If unsuccessful
  ** the install terminal error, missing bar panel, `./client get-serial`
covers: manual/35-networking.md (Tailscale), omarchy-menu.jsonc install.service.tailscale, remove.service.tailscale, bin/omarchy-install-service-tailscale, bin/omarchy-remove-service-tailscale

### toggle-suspend-hides-system-menu-entry   [VM-OK]
description: `omarchy toggle suspend` hides or reveals the Suspend row in the System menu and confirms with a notification. Users with broken suspend use this to stop accidental sleeps.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape.
  ** The System menu lists Screensaver, Lock, Suspend, Logout, Reboot, Shutdown (Hibernate absent unless set up). Escape.
  * Open a terminal with Super+Enter and run `omarchy toggle suspend`.
  ** Notification "Suspend removed from system menu"; `ls ~/.local/state/omarchy/toggles/` shows `suspend-off`.
  * Press Super+Escape: the Suspend row is gone. Escape.
  * Run `omarchy toggle suspend` again → "Suspend now available in system menu"; the flag file is gone; Super+Escape shows Suspend again. Escape.
  * Negative: `omarchy-toggle; echo exit=$?` → "Usage: omarchy-toggle <flag-name> [toggle|on|off]", exit=1; `omarchy-toggle suspend-off sideways; echo exit=$?` → usage, exit=1.
  * Do not select Suspend.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The System menu is small; take the screenshot as soon as it opens.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the System menu with and without Suspend, the two notifications, and the flag file listing
  ** Screenshot of the two usage refusals
  * If unsuccessful
  ** the menu still showing Suspend while the flag exists (or vice versa), `./client get-serial`
covers: manual/36-system-sleep.md (Toggle suspend), bin/omarchy-toggle-suspend, bin/omarchy-toggle, omarchy-menu.jsonc system.suspend (when)

### powerprofiles-list-set-and-reject   [VM-OK]
description: `omarchy powerprofiles list` shows what the machine offers and `omarchy powerprofiles set` applies and remembers a profile per power state, refusing unknown profiles and states. Works in the guest through power-profiles-daemon's placeholder driver.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy powerprofiles list`.
  ** One profile per line, e.g. power-saver, balanced, performance (the set may be smaller in the guest — record it). `omarchy powerprofiles list --active-state` adds a tab and 1 on the active one.
  * Run `powerprofilesctl get` and record the current profile.
  * Run `omarchy powerprofiles set autodetect power-saver` (use `balanced` if power-saver was not listed).
  ** No output; `powerprofilesctl get` → power-saver; `cat ~/.local/state/omarchy/powerprofiles/ac` → power-saver (the guest has no battery, so autodetect resolves to ac).
  * Run `omarchy powerprofiles set battery performance` → `cat ~/.local/state/omarchy/powerprofiles/battery` → performance, while `powerprofilesctl get` is still power-saver (setting the other state does not switch now).
  * Negative: `omarchy powerprofiles set ac turbo; echo exit=$?` → "Power profile is not available: turbo", exit=1. `omarchy powerprofiles set laptop; echo exit=$?` → "Usage: omarchy-powerprofiles-set [autodetect|ac|battery] [power-saver|balanced|performance]", exit=1. `omarchy powerprofiles list --nope; echo exit=$?` → usage, exit=1.
  * Restore: `omarchy powerprofiles set ac <recorded profile>` and `rm -f ~/.local/state/omarchy/powerprofiles/battery`.
  * Press Super+Ctrl+P: the power panel opens (may show the profile and no battery). Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `omarchy powerprofiles list` prints nothing, power-profiles-daemon is not running: `systemctl is-active power-profiles-daemon` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the list, `powerprofilesctl get` before/after, the two state files, and the three refusals with exit=1
  * If unsuccessful
  ** the daemon status and command output, `./client get-serial`
covers: manual/36-system-sleep.md (Power profiles), bin/omarchy-powerprofiles-list, bin/omarchy-powerprofiles-set

### hibernation-setup-and-remove   [VM-PARTIAL] [SLOW]
description: `omarchy hibernation setup` creates the swap subvolume, resume hooks and rebuilds the initramfs so Hibernate appears in the System menu; `omarchy hibernation remove` undoes it. Actually hibernating is not attempted in the guest; two initramfs rebuilds make this slow.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape: the System menu has no Hibernate row. Escape.
  ** In a terminal (Super+Enter) `omarchy hibernation remove` prints "Hibernation is not set up" — the remove path is safe to run when nothing is configured.
  * Run `omarchy hibernation setup`.
  ** Prompt "Use 3.8Gi on boot drive to make hibernation available?" (RAM size may read 3.8Gi/4.0Gi). Answer Yes.
  ** Output: "Creating Btrfs subvolume", "Creating swapfile in Btrfs subvolume", "Adding swapfile to /etc/fstab", "Enabling swap on /swap/swapfile", "Adding resume hook to /etc/mkinitcpio.conf.d/omarchy_resume.conf", "Adding resume kernel parameters", "Regenerating initramfs..." (sudo prompts: prime; takes 1–3 minutes), then "Reboot to enable hibernation?" — answer No.
  ** If it prints "Hibernation is not supported on your system" or "Skipping hibernation setup (requires Limine bootloader)", record it and stop: the guest kernel/bootloader lacks the prerequisite.
  * Press Super+Escape: a Hibernate row is now present. Do NOT select it. Escape.
  ** `swapon --show` lists /swap/swapfile; running `omarchy hibernation setup` a second time prints "Hibernation is already set up".
  * Run `omarchy hibernation remove` → "Remove hibernation setup?" Yes.
  ** "Disabling swap…", "Removing swapfile", "Removing Btrfs subvolume /swap", "Removing swapfile from /etc/fstab", "Removing resume hook", "Regenerating initramfs..." (1–3 minutes again), "Hibernation removed".
  * `swapon --show` prints nothing and Super+Escape shows no Hibernate row: the machine is back where it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep screenshotting during the initramfs rebuilds; do not assume a hang before five minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the setup transcript, `swapon --show`, `hibernation available` exit=0, the System menu with Hibernate, the removal transcript and the System menu without it
  * If unsuccessful
  ** the step that failed (btrfs, fstab, limine-mkinitcpio) with its output, `./client get-serial`
covers: manual/36-system-sleep.md (Toggle hibernation), bin/omarchy-hibernation-setup, bin/omarchy-hibernation-available, bin/omarchy-hibernation-remove, omarchy-menu.jsonc system.hibernate (when)

### fingerprint-absent-in-vm   [VM-PARTIAL]
description: Without a fingerprint reader the Setup → Security → Fingerprint row is hidden and the setup command refuses before installing anything. Only the absence path is testable; enrolment needs a sensor.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Security.
  ** Rows: Fido2, SSHD, Passwordless Sudo (Sudoless Docker may show); no Fingerprint row. Escape.
  * Open the Omarchy Menu → Remove → Security: no Fingerprint row (fprintd not installed). Escape.
  * Open a terminal with Super+Enter and run `omarchy-hw-fingerprint; echo exit=$?` → exit=1.
  * Run `omarchy setup security fingerprint; echo exit=$?`.
  ** Green "Setting up fingerprint scanner for authentication." then red "No fingerprint sensor detected.", exit=1; no pacman activity; `pacman -Q fprintd 2>&1` → "error: package 'fprintd' was not found".
  * Run `grep -c pam_fprintd /etc/pam.d/sudo` → 0 (PAM untouched).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The command needs no sudo on this path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both Security submenus without Fingerprint, the exit=1 detection, and the "No fingerprint sensor detected." refusal with fprintd absent
  * If unsuccessful
  ** a Fingerprint row present, or the script proceeding to install packages, `./client get-serial`
covers: manual/37-hardware-authentication.md (Fingerprint authentication), bin/omarchy-setup-security-fingerprint, bin/omarchy-hw-fingerprint, omarchy-menu.jsonc setup.security.fingerprint, remove.security.fingerprint (when)

### fido2-setup-without-device-then-remove   [VM-PARTIAL] [NET]
description: Setup → Security → Fido2 installs the FIDO2 packages, then stops with "No FIDO2 device detected" without touching PAM; the Remove row then appears and cleans the packages up. Enrolment needs a key; the software half is covered.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `grep -c pam_u2f /etc/pam.d/sudo` → 0; `pacman -Q pam-u2f 2>&1` → not found.
  * Open the Omarchy Menu (Super+Space) → Remove → Security: no Fido2 row. Escape.
  * Omarchy Menu → Setup → Security → Fido2.
  ** Floating terminal: green "Setting up FIDO2 device for authentication.", "Installing required packages..." (sudo prompt: prime; pacman installs libfido2 and pam-u2f, small download), then red "No FIDO2 device detected. Please plug it in (you may need to unlock it as well)." and "● Failed (exit code 1)!". Press a key.
  * In the terminal: `pacman -Q pam-u2f libfido2` → both listed; `grep -c pam_u2f /etc/pam.d/sudo` → 0 (PAM untouched); `ls /etc/fido2 2>&1` → No such file.
  * Omarchy Menu → Remove → Security: Fido2 row now present. Select it.
  ** Floating terminal: "Removing FIDO2 device from authentication.", "Removing FIDO2 packages..." (sudo), "FIDO2 authentication has been completely removed." Done.
  * `pacman -Q pam-u2f 2>&1` → not found; Omarchy Menu → Remove → Security → no Fido2 row.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * omarchy-pkg-drop may also remove now-unneeded dependencies; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the setup terminal ending in the red no-device message + Failed (exit code 1), pacman showing the packages present, PAM grep 0, the Remove row appearing, and the removal transcript
  * If unsuccessful
  ** PAM modified (grep > 0) without a device, or removal failing, `./client get-serial`
covers: manual/37-hardware-authentication.md (Fido2 authentication), bin/omarchy-setup-security-fido2, bin/omarchy-remove-security-fido2, omarchy-menu.jsonc setup.security.fido2, remove.security.fido2 (when)

### font-cli-current-list-set-reject   [VM-OK]
description: `omarchy font current/list/set` report and switch the system monospace font through fontconfig and the terminal configs, restart the shell, and refuse a font that is not installed. Protects the CLI half of the Fonts chapter without a download.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy font current` → `JetBrainsMono Nerd Font`.
  * Run `omarchy font list | sudo tee /dev/ttyS0` — a sorted list of monospace families; pick one that is NOT JetBrainsMono (e.g. "Noto Sans Mono" if present, otherwise the first other entry) and call it ALT.
  * Negative: `omarchy font set "Nope Mono"; echo exit=$?` → "Font 'Nope Mono' not found.", exit=1; the bar does not restart; `omarchy font current` unchanged. `omarchy font set; echo exit=$?` → usage, exit=1.
  * Run `omarchy font set "ALT"` (with the real name).
  ** The bar disappears and comes back (shell restart) drawn in the new font; a notification "You must restart Foot to see font change" appears (foot is running).
  * `omarchy font current` → ALT; `grep '^font=' ~/.config/foot/foot.ini` → `font=ALT:size=9`; `grep -c ALT ~/.config/fontconfig/fonts.conf` → 1.
  * Open a new terminal (Super+Enter): its glyphs differ from the first terminal's (side by side).
  * Restore: `omarchy font set "JetBrainsMono Nerd Font"`; `omarchy font current` → JetBrainsMono Nerd Font; close all terminals (Ctrl+Alt+Delete).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A Nerd Font ALT keeps bar icons; a plain font (Noto Sans Mono) will show missing-glyph boxes in the bar — that is expected and part of why the manual recommends Nerd Fonts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `font current` before/after, the refusal with exit=1, the foot notification, two terminals in different fonts, and the restored font
  * If unsuccessful
  ** the command output and `cat ~/.config/fontconfig/fonts.conf`, `./client get-serial`
covers: manual/38-fonts.md, bin/omarchy-font-set, bin/omarchy-font-list, bin/omarchy-font-current, config/foot/foot.ini

### font-install-cascadia-from-menu   [VM-OK] [NET]
description: Install → Style → Font → Cascadia Mono downloads the Nerd Font package and switches the whole desktop to it; Style → Font then lists and marks it. This is the click path the Fonts chapter describes (~10 MB download).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Style → Font.
  ** A list of monospace fonts with JetBrainsMono Nerd Font marked current; CaskaydiaMono is absent. Escape.
  * Omarchy Menu → Install → Style → Font → Cascadia Mono.
  ** Floating terminal: "Installing Cascadia Mono...", sudo prompt (prime), pacman installs ttf-cascadia-mono-nerd, then the shell restarts (bar blinks) and a notification "You must restart Foot to see font change" appears; "● Done!". Press a key.
  * Open a terminal with Super+Enter: `omarchy font current` → `CaskaydiaMono Nerd Font`; `grep '^font=' ~/.config/foot/foot.ini` → CaskaydiaMono Nerd Font:size=9. The terminal itself renders in Cascadia (new window).
  * Omarchy Menu → Style → Font: CaskaydiaMono Nerd Font is listed and marked current. Escape.
  * Restore: Omarchy Menu → Style → Font → JetBrainsMono Nerd Font → shell restarts; `omarchy font current` → JetBrainsMono Nerd Font. Optionally `omarchy pkg drop ttf-cascadia-mono-nerd`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Bar glyphs must remain intact after the switch (Nerd Font variant).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Style → Font list before and after (Cascadia present and current), the install terminal ending Done, the notification, `omarchy font current`, and the restored state
  * If unsuccessful
  ** pacman failure text, a bar with broken glyphs, `./client get-serial`
covers: manual/38-fonts.md (Install → Style → Font), omarchy-menu.jsonc install.style.font.cascadia, style.font, bin/omarchy-install-font, bin/omarchy-font-set

### background-add-custom-image   [VM-OK]
description: A file dropped into ~/.config/omarchy/backgrounds/<theme> (the folder Install → Style → Background opens) shows up in the background switcher and can be applied. This is the manual's way to add your own wallpapers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `T=$(cat ~/.local/state/omarchy/current/theme.name); echo $T; ls ~/.config/omarchy/backgrounds/ 2>&1`.
  * Open the Omarchy Menu (Super+Space) → Install → Style → Background.
  ** Nautilus opens (possibly oversized under GDK_SCALE=2) at ~/.config/omarchy/backgrounds/<theme>/, an empty folder. Close it with Super+W.
  * In the terminal: `ls -d ~/.config/omarchy/backgrounds/$T` → the folder now exists. Create an image: `magick -size 1280x800 xc:'#ff0000' ~/.config/omarchy/backgrounds/$T/zz-solid-red.png && ls ~/.config/omarchy/backgrounds/$T`.
  * Press Super+Ctrl+Space.
  ** The background switcher shows the theme's wallpapers plus a solid red thumbnail (last, sorted). Select the red one with arrows/mouse and Enter.
  ** The desktop wallpaper turns solid red.
  * `readlink ~/.local/state/omarchy/current/background` → …/backgrounds/<theme>/zz-solid-red.png; `omarchy theme bg current` → "Zz Solid Red".
  * Restore: press Super+Ctrl+Space and pick the first theme wallpaper; `rm ~/.config/omarchy/backgrounds/$T/zz-solid-red.png`; reopen the switcher: red thumbnail gone. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The switcher may not filter on typing; use arrow keys or click the thumbnail.
  * Nautilus can take a few seconds to appear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Nautilus in the backgrounds folder, the switcher with the red thumbnail, the red desktop, and the readlink output
  * If unsuccessful
  ** the switcher without the new file, or the wallpaper unchanged, `./client get-serial`
covers: manual/39-backgrounds.md, bin/omarchy-theme-bg-install, bin/omarchy-theme-bg-switcher, bin/omarchy-theme-bg-set, bin/omarchy-theme-bg-current, omarchy-menu.jsonc install.style.background, default/hypr/bindings/utilities.lua:17

### background-cli-set-next-reject   [VM-OK]
description: `omarchy theme bg set/next/current` change and report the wallpaper from the terminal, and a missing file is refused. Complements the switcher test with the CLI the chapter's commands map to.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy theme bg current` and `readlink ~/.local/state/omarchy/current/background`; record both.
  * Run `omarchy theme bg next`.
  ** The wallpaper changes to the next file in the theme's backgrounds folder; `omarchy theme bg current` prints a different name.
  * Run `ls ~/.local/state/omarchy/current/theme/backgrounds/ | head -3` and set the first one explicitly: `omarchy theme bg set ~/.local/state/omarchy/current/theme/backgrounds/<first file>` → wallpaper shows it; readlink matches.
  * Negative: `omarchy theme bg set /nonexistent.png; echo exit=$?` → "File does not exist: /nonexistent.png", exit=1, wallpaper unchanged. `omarchy theme bg set; echo exit=$?` → usage/help, non-zero.
  * Cycle back to the original with `omarchy theme bg next` as many times as needed (there are only a handful) until `readlink` matches the recorded value.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Wallpaper changes fade over about a second.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the wallpaper before/after `next` with matching `bg current` names, the explicit `set`, and the refusal with exit=1
  * If unsuccessful
  ** the command output and readlink, `./client get-serial`
covers: manual/39-backgrounds.md, bin/omarchy-theme-bg-set, bin/omarchy-theme-bg-next, bin/omarchy-theme-bg-current

### background-video-loop   [VM-PARTIAL]
description: A video file in the theme's background folder appears in the switcher and plays on a loop as the wallpaper. No audio device and no 3D acceleration in the guest, so only playback of a tiny generated clip is checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `command -v ffmpeg || echo NO-FFMPEG`.
  ** If NO-FFMPEG, record it and stop: the clip cannot be generated in the guest (do not install anything).
  * `T=$(cat ~/.local/state/omarchy/current/theme.name); mkdir -p ~/.config/omarchy/backgrounds/$T && ffmpeg -loglevel error -f lavfi -i testsrc=duration=4:size=640x360:rate=10 -pix_fmt yuv420p ~/.config/omarchy/backgrounds/$T/zz-test.mp4 && ls -la ~/.config/omarchy/backgrounds/$T/`.
  * Press Super+Ctrl+Space: a thumbnail for zz-test.mp4 is present; select it.
  ** The wallpaper shows the moving SMPTE-style test pattern with a running counter. Take three screenshots two seconds apart; the counter digits must differ (it is playing/looping).
  * Press Super+F on the terminal (fullscreen) and wait five seconds; then Super+F again. Playback should have paused while covered (cannot be proven from screenshots; just ensure no crash).
  * Restore: Super+Ctrl+Space → pick a still image; `rm ~/.config/omarchy/backgrounds/$T/zz-test.mp4`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Software decoding of a 640x360 clip is fine on 2 vCPUs; if the shell becomes unresponsive, report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three screenshots of the video wallpaper with different counter values, plus the switcher thumbnail
  * If unsuccessful
  ** a static frame across screenshots, a shell crash, or the file missing from the switcher; `./client get-serial`
covers: manual/39-backgrounds.md (Backgrounds can be videos), bin/omarchy-theme-bg-next (extensions), bin/omarchy-theme-bg-switcher

### starship-prompt-edit-and-invalid   [VM-OK]
description: Editing ~/.config/starship.toml changes the prompt in new terminals, and a syntactically broken file makes Starship warn and fall back instead of breaking the shell. The Prompt chapter is one paragraph but the file is what every terminal user sees first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; screenshot the prompt (a cyan `❯` after the directory, a blank line before it).
  * Run `sed -i 's/^add_newline = true/add_newline = false/; s/success_symbol = .*/success_symbol = "[→](bold green)"/' ~/.config/starship.toml && grep -n 'add_newline\|success_symbol' ~/.config/starship.toml`.
  * Open a new terminal with Super+Enter.
  ** The prompt character is now a green `→` and there is no blank line between commands.
  * Break the file: `echo 'this is not = toml = at all [' >> ~/.config/starship.toml`; open another terminal.
  ** Starship prints a warning such as "[WARN] - (starship::config): Unable to parse the config file" and shows its built-in default prompt (typically `❯` in green/red, directory in bold cyan); the shell itself works (`echo ok`).
  * Restore: `cp /usr/share/omarchy/config/starship.toml ~/.config/starship.toml`; open a new terminal → original cyan `❯` prompt with blank line. Close all with Ctrl+Alt+Delete.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the terminals tiled so the three prompt styles are visible in one screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the default, the modified (green →, no blank line), the warning + fallback, and the restored prompt
  * If unsuccessful
  ** a terminal that fails to open or a shell error, `cat ~/.config/starship.toml | sudo tee /dev/ttyS0`, `./client get-serial`
covers: manual/40-prompt.md, config/starship.toml

### plymouth-preview-render-and-reject   [VM-OK]
description: `omarchy plymouth preview` composes a boot-screen mock-up from colours and a logo and shows it in imv, and rejects malformed colours or a missing logo. Lets users see branding before touching the boot chain.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plymouth preview '#1d2021' '#ebdbb2' /usr/share/omarchy/default/plymouth/logo.png /tmp/preview.png`.
  ** After a second or two imv opens fullscreen showing a dark (#1d2021) 1920×1080 canvas with the Omarchy logo centred, a password entry box beneath it with a lock icon and four bullets, all tinted #ebdbb2.
  * Press `q` to close imv. `ls -la /tmp/preview.png` shows the file; `magick identify /tmp/preview.png` → PNG 1920x1080.
  * Run it again with a theme logo and loud colours: `omarchy plymouth preview '#004400' '#ffff00' /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/preview2.png` → green canvas, yellow entry box. `q`.
  * Negative: `omarchy plymouth preview '#zzz' '#ebdbb2' /usr/share/omarchy/default/plymouth/logo.png /tmp/x.png; echo exit=$?` → "Invalid background color: #zzz (expected #RRGGBB)", exit=1. `omarchy plymouth preview '#000000' '#ffffff' /nope.png /tmp/x.png; echo exit=$?` → "Logo file not found: /nope.png", exit=1. `omarchy plymouth preview a b; echo exit=$?` → usage, exit=1.
  * Clean up: `rm -f /tmp/preview.png /tmp/preview2.png`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * imv is fullscreen (-f); take the screenshot before pressing q.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both imv previews and of `magick identify` reporting 1920x1080
  ** Screenshot of the three refusals with exit=1
  * If unsuccessful
  ** the magick/imv error text, `./client get-serial`
covers: manual/41-branding.md (Boot unlock preview), bin/omarchy-plymouth-preview

### style-unlock-picker-set-reboot-reset   [VM-OK] [SLOW]
description: Style → Unlock lets the user pick a theme's unlock image for the Plymouth boot screen (and SDDM), the change is visible at the next boot's LUKS prompt, and choosing "default" or `omarchy plymouth reset` puts the stock branding back. Two initramfs rebuilds and a reboot make this slow.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plymouth current` → `default`; `omarchy plymouth list | sudo tee /dev/ttyS0` → theme names that have preview-unlock.png (gruvbox, tokyo-night, …).
  * Open the Omarchy Menu (Super+Space) → Style → Unlock.
  ** An image picker with labelled previews: "default" plus one per listed theme, the current one preselected. Select "gruvbox".
  ** A floating terminal runs `omarchy-plymouth-set-by-theme gruvbox`: sudo prompt (prime), plymouth theme rebuilt, initramfs regenerated (1–3 min), SDDM colours updated, "● Done!". Press a key.
  * `omarchy plymouth current` → `gruvbox`; `cmp /usr/share/plymouth/themes/omarchy/logo.png /usr/share/omarchy/themes/gruvbox/unlock.png && echo SAME` → SAME.
  * Reboot: System menu (Super+Escape) → Reboot. Watch the boot: the Plymouth passphrase screen must use the gruvbox background colour and the gruvbox unlock logo (not the stock Omarchy logo). Screenshot it, type the LUKS passphrase `prime`, then (if a login screen appears) note its colours match, log in and reach the desktop.
  * Open a terminal and run `omarchy plymouth reset` (sudo) → refreshes plymouth and sddm (another initramfs rebuild); `omarchy plymouth current` → default.
  * Alternatively verify the menu path: Omarchy Menu → Style → Unlock → "default" runs `omarchy-plymouth-reset` in a floating terminal; it must end Done even when already default.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The boot splash is brief before the passphrase prompt; screenshot every second from the moment the QEMU firmware screen disappears.
  * If the session budget runs out before the reset, report the state so the disk is discarded rather than saved.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Unlock picker, the set terminal ending Done, `omarchy plymouth current` → gruvbox, the gruvbox-branded Plymouth passphrase screen after reboot, and `current` → default after reset
  * If unsuccessful
  ** the stock logo still shown at boot, or the set/reset terminal failing (initramfs error), `./client get-serial`
covers: manual/41-branding.md (Boot unlock), manual/43 (Unlock image), omarchy-menu.jsonc style.unlock, bin/omarchy-plymouth-switcher, bin/omarchy-plymouth-set-by-theme, bin/omarchy-plymouth-set, bin/omarchy-plymouth-reset, bin/omarchy-plymouth-current, bin/omarchy-plymouth-list

### screensaver-edit-text-menu   [VM-OK]
description: Style → Screensaver → Edit Text opens screensaver.txt, and saving launches the screensaver immediately with the new art; Restore Default brings the Omarchy logo back. The simplest branding path in the chapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → System → Screensaver (or Super+Escape → Screensaver).
  ** The screen fills with the animated Omarchy ASCII logo in a terminal window. Press any key to exit.
  * Omarchy Menu → Style → Screensaver → Edit Text.
  ** Neovim opens ~/.config/omarchy/branding/screensaver.txt containing the logo art.
  * Replace the content: `ggdG` then `i`, type `PROBE SCREENSAVER TEXT`, Escape, `:wq`.
  ** The screensaver starts immediately showing the words PROBE SCREENSAVER TEXT (drifting/animated). Screenshot, then press a key to exit.
  * Open a terminal with Super+Enter: `cat ~/.config/omarchy/branding/screensaver.txt` → the one line.
  * Omarchy Menu → Style → Screensaver → Restore Default.
  ** The screensaver starts with the Omarchy logo again. Press a key. `diff -q ~/.config/omarchy/branding/screensaver.txt /usr/share/omarchy/logo.txt` → no output (identical).
  * Negative: `omarchy branding screensaver sideways; echo exit=$?` → "Usage: omarchy-branding-screensaver <image|text|reset>", exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screensaver covers the whole screen; any key exits, mouse movement may not.
  * If a "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" notification appears, the default terminal is something else — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the stock screensaver, the editor, the screensaver showing PROBE SCREENSAVER TEXT, and the stock logo after Restore Default with the diff output empty
  * If unsuccessful
  ** the editor not opening, no screensaver after :wq, or the refusal missing; `./client get-serial`
covers: manual/41-branding.md (Screensaver), omarchy-menu.jsonc style.screensaver.*, system.screensaver, bin/omarchy-branding-screensaver, bin/omarchy-launch-screensaver

### screensaver-ascii-wordmark-and-reject   [VM-OK]
description: `omarchy ascii` renders text in the Omarchy wordmark font for the screensaver file, skips characters the font lacks (naming them on stderr) and refuses text with nothing drawable. Covers the "Words instead of a logo" section.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy ascii Omarchy | head -n 12`.
  ** Large block-character letters spelling OMARCHY across ~9 rows.
  * Run `omarchy ascii "Back in five" > ~/.config/omarchy/branding/screensaver.txt && wc -l ~/.config/omarchy/branding/screensaver.txt` → about 9 lines.
  * Press Super+Escape → Screensaver.
  ** The screensaver shows BACK IN FIVE in the wordmark font. Press a key to exit.
  * Run `omarchy ascii "Hi 5" >/dev/null` → stderr "Skipped, no glyph in Delta Corps Priest 1: 5" and exit 0 (`echo exit=$?`).
  * Run `omarchy ascii "2026!"; echo exit=$?` → "Delta Corps Priest 1 draws letters and spaces only, and that text has neither.", exit=1.
  * Run `omarchy ascii "" ; echo exit=$?` → "Nothing to render", exit=1. `echo piped | omarchy ascii | head -n 3` → art from stdin.
  * Restore: `omarchy branding screensaver reset` (screensaver launches with the logo; press a key) and confirm `diff -q ~/.config/omarchy/branding/screensaver.txt /usr/share/omarchy/logo.txt` prints nothing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The block glyphs need a Nerd/mono font; foot renders them fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the OMARCHY art, the screensaver reading BACK IN FIVE, the skipped-glyph note, and the two refusals with exit=1
  * If unsuccessful
  ** garbled art or a missing message, `./client get-serial`
covers: manual/41-branding.md (Words instead of a logo), bin/omarchy-ascii, bin/omarchy-branding-screensaver reset

### screensaver-set-from-image   [VM-OK]
description: Style → Screensaver → Set From Image opens the desktop file chooser for a PNG/SVG, converts it to ASCII with `omarchy transcode ascii` and shows the result as the screensaver. Exercises the portal chooser and the converter together.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Style → Screensaver → Set From Image.
  ** A GTK file chooser titled "Pick PNG or SVG for screensaver" opens (may be oversized).
  * Press Ctrl+L, type `/usr/share/omarchy/icon.png`, Enter (or click Open).
  ** The chooser closes; after a second the screensaver launches showing a braille-dot rendering of the Omarchy icon. Screenshot; press a key to exit.
  * Open a terminal with Super+Enter: `head -c 300 ~/.config/omarchy/branding/screensaver.txt | od -c | head -3` shows multi-byte (braille) characters; `wc -l` ≤ 26 lines.
  * Negative: Style → Screensaver → Set From Image again, then press Escape / Cancel in the chooser.
  ** Nothing happens: no screensaver launch, and `stat -c %Y ~/.config/omarchy/branding/screensaver.txt` is unchanged from before.
  * Restore: Style → Screensaver → Restore Default; press a key when the logo screensaver appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The chooser filters to png/svg; typing the full path with Ctrl+L avoids navigating.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the chooser, the braille screensaver, and the unchanged mtime after cancelling
  * If unsuccessful
  ** no chooser (portal failure), a "Unable to read logo image" error, `./client get-serial`
covers: manual/41-branding.md (Set From Image), bin/omarchy-branding-screensaver image, bin/omarchy-file-select, bin/omarchy-transcode-ascii

### about-branding-edit-and-reset   [VM-OK]
description: Style → About → Edit Text / Restore Default change the art shown in the About window, which pops up after each change, and single-width art gets the green glint animation. Covers the About half of the branding chapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → About.
  ** A floating window with the Omarchy icon art on the left and fastfetch system info on the right. Take two screenshots about four seconds apart: a green glint should sweep across the art in at least one of them (or the art differs between the two). Press `q`/any key or Super+W to close.
  * Omarchy Menu → Style → About → Edit Text.
  ** Neovim opens ~/.config/omarchy/branding/about.txt.
  * Replace the content with three lines of plain text: `ggdG`, `i`, type `ABOUT`, Enter, `PROBE`, Enter, `ART`, Escape, `:wq`.
  ** The About window pops up immediately with ABOUT/PROBE/ART as the logo, sized to fit. Screenshot twice a few seconds apart (glint applies to single-width text). Close it.
  * Omarchy Menu → Style → About → Restore Default → About window pops up with the icon art. Close. Open a terminal: `diff -q ~/.config/omarchy/branding/about.txt /usr/share/omarchy/icon.txt` → identical.
  * Negative: `omarchy branding about nope; echo exit=$?` → "Usage: omarchy-branding-about <image|text|reset>", exit=1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The About window resizes to its content on first launch; wait a second before screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the stock About (with glint), the About showing ABOUT/PROBE/ART, and the restored About; diff output empty; refusal exit=1
  * If unsuccessful
  ** the About window not appearing after :wq, or the art unchanged, `./client get-serial`
covers: manual/41-branding.md (About screen), omarchy-menu.jsonc style.about.*, about, bin/omarchy-branding-about, bin/omarchy-launch-about

### transcode-ascii-cli-and-reject   [VM-OK]
description: `omarchy transcode ascii` converts an SVG/PNG to braille or block art with width/height/mode/threshold controls and rejects a missing image or bad mode. This is the converter behind both Set From Image entries.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy transcode ascii /usr/share/omarchy/logo.svg /tmp/logo-braille.txt --width 60 && cat /tmp/logo-braille.txt && wc -L /tmp/logo-braille.txt`.
  ** Braille-dot art of the Omarchy wordmark, max line length ≤ 60.
  * Run `omarchy transcode ascii /usr/share/omarchy/icon.png /tmp/icon-block.txt --mode block --width 40 --height 20 && cat /tmp/icon-block.txt`.
  ** Block-character (█ ▀ ▄) art, ≤ 40 columns, ≤ 20 rows.
  * Run `omarchy transcode ascii /usr/share/omarchy/icon.png /tmp/icon-inv.txt --invert --threshold 30 && cat /tmp/icon-inv.txt` → a visibly different (inverted/denser) rendering.
  * Negative: `omarchy transcode ascii /nope.png /tmp/x.txt; echo exit=$?` → "Logo file not found: /nope.png", exit=1. `omarchy transcode ascii /usr/share/omarchy/icon.png /tmp/x.txt --mode ansi; echo exit=$?` → "Invalid mode: ansi (expected braille or block)", exit=1. `omarchy transcode ascii /usr/share/omarchy/icon.png; echo exit=$?` → usage, exit=1. `omarchy transcode ascii --help` → the options list.
  * Clean up: `rm -f /tmp/logo-braille.txt /tmp/icon-block.txt /tmp/icon-inv.txt /tmp/x.txt`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the art looks like a solid blob, note it; the manual says --threshold is the knob, and 30/70 should show a difference.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the braille and block renderings with their sizes, the inverted variant, and the three refusals with exit=1
  * If unsuccessful
  ** a magick error ("Unable to read logo image") or empty output, `./client get-serial`
covers: manual/41-branding.md (Converting images yourself), bin/omarchy-transcode-ascii

### looknfeel-rounding-and-no-gaps   [VM-OK]
description: Uncommenting the rounding and no-gaps blocks in ~/.config/hypr/looknfeel.lua (via Style → Hyprland) changes window corners, gaps and borders after reload, and Update → Config → Hyprland reverts them. These are the two tweaks the Common Tweaks chapter spells out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals (Super+Enter twice) so two tiled windows with square corners, gaps and borders are visible. Screenshot. Run `hyprctl getoption decoration:rounding | head -1` (int: 0) and `hyprctl getoption general:gaps_out | head -1` (non-zero).
  * Open the Omarchy Menu (Super+Space) → Style → Hyprland; Neovim opens looknfeel.lua.
  * Uncomment the rounding block: `:17,26s/^-- //` then `:wq` (lines 17–26 are the `hl.config({ decoration = { rounding = 8, dim_inactive…` block; if the numbers differ, remove the leading `-- ` from that block manually).
  * In a terminal run `hyprctl reload`.
  ** Window corners are visibly rounded; `hyprctl getoption decoration:rounding | head -1` → int: 8; unfocused window is dimmed (dim_inactive is in the same block).
  * Now the gaps block: `sed -i '4,9s/^-- //' ~/.config/hypr/looknfeel.lua` (the `hl.config({ general = { gaps_in = 0, gaps_out = 0, border_size = 0,` lines) — check with `sed -n '1,14p' ~/.config/hypr/looknfeel.lua` that the `layout = "scrolling"` line stayed commented and add the closing `},` / `})` lines are uncommented as needed (`sed -i '12,14s/^-- //'`). Run `hyprctl reload`.
  ** Windows touch each other and the screen edge with no border; `hyprctl getoption general:gaps_out | head -1` → 0.
  * If a red config error bar appears instead, the uncomment was unbalanced: fix with `omarchy-refresh-config hypr/looknfeel.lua` and report the exact lines.
  * Restore: Omarchy Menu → Update → Config → Hyprland → diff shows your changes → Done; `hyprctl reload`; corners square, gaps back; `rm -f ~/.config/hypr/*.bak.*`. Close terminals with Ctrl+Alt+Delete.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shipped file has each option block wrapped in `-- hl.config({ … -- })`; every line of a block must lose exactly the `-- ` prefix.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of square/gapped windows, rounded corners with getoption 8, no-gap windows with gaps_out 0, and the restored look after Update → Config → Hyprland
  * If unsuccessful
  ** a config error bar with the file contents (`cat ~/.config/hypr/looknfeel.lua | sudo tee /dev/ttyS0`), `./client get-serial`
covers: manual/42-common-tweaks.md (Rounded window corners, Remove window gaps), config/hypr/looknfeel.lua, omarchy-menu.jsonc style.hyprland, bin/omarchy-refresh-hyprland

### toggle-hotkeys-gaps-and-bar   [VM-OK]
description: Super+Shift+Backspace toggles all gaps/borders off and on (persisting via a toggle file that survives reloads) and Super+Shift+Space hides/shows the top bar; both are also reachable under Trigger → Toggle. These are the chapter's non-permanent alternatives to editing looknfeel.lua.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals (Super+Enter twice). Screenshot the gaps and borders between them.
  * Press Super+Shift+Backspace.
  ** Gaps and borders disappear (windows edge to edge, no rounding). Run `hyprctl reload` in one terminal: still no gaps — the toggle is a file (`~/.local/state/omarchy/toggles/hypr/window-no-gaps.lua`) and survives reloads.
  * Press Super+Shift+Backspace again: gaps and borders return.
  ** The same toggle is under Omarchy Menu (Super+Space) → Trigger → Toggle → Window Gaps; use it once to turn gaps off and once more to turn them back on, checking the screen each time.
  * Press Super+Shift+Space.
  ** The top bar hides and the windows grow into the space. Press it again: the bar returns. Omarchy Menu → Trigger → Toggle → Menu Bar does the same (use it twice so the bar ends visible).
  ** Unhappy path: in the terminal `omarchy-hyprland-toggle no-such-flag on; echo exit=$?` → "Flag not found: no-such-flag", exit=1, nothing changes on screen.
  * Close both terminals with Ctrl+Alt+Delete; the desktop must look exactly as at the start (gaps, borders, bar).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * With the bar hidden Super+Space still opens the menu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with gaps on/off (including after hyprctl reload) and the toggle directory listing, bar hidden/shown with the flag listing, and the "Flag not found" refusal
  * If unsuccessful
  ** the gaps or bar not changing, a stuck hidden bar, `./client get-serial`
covers: manual/42-common-tweaks.md (Remove window gaps, top bar toggle), default/hypr/bindings/utilities.lua:16,20, bin/omarchy-hyprland-window-gaps-toggle, bin/omarchy-hyprland-toggle, bin/omarchy-toggle-bar, default/hypr/toggles/window-no-gaps.lua, omarchy-menu.jsonc trigger.toggle.window-gaps, trigger.toggle.top-bar

### tray-icon-manager-right-click   [VM-PARTIAL]
description: Right-clicking the tray expander arrow opens the tray icon manager for pinning/hiding icons. The guest has no tray-using apps installed, so only opening the manager (possibly empty) can be checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the bar's right section for the tray expander arrow (leftmost of that cluster). If no arrow is drawn, open a terminal (Super+Enter) and start a tray app if one exists: `command -v localsend && (uwsm-app -- localsend &)`; LocalSend adds a tray icon when running. Wait five seconds.
  * Right-click the expander arrow (or the tray area) with the mouse.
  ** A tray icon manager panel opens listing tray icons with pin/hide controls (or stating there are no icons).
  * If an icon is listed, pin it: it must then stay visible in the bar without hovering. Unpin it.
  * Close the panel (Escape); close LocalSend if started (Super+W on its window or `pkill localsend`).
  * Record whether an expander was drawn at all with zero tray icons.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hovering the arrow reveals hidden icons; right-click opens the manager.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the tray manager panel (empty or listing LocalSend) and, if available, the pinned icon in the bar
  * If unsuccessful
  ** the right-click doing nothing, or a shell error, `./client get-serial`
covers: manual/42-common-tweaks.md (Reveal all tray icons all the time), config/omarchy/shell.json (omarchy.tray)

### custom-theme-from-copy   [VM-OK]
description: Copying a shipped theme into ~/.config/omarchy/themes and editing colors.toml yields a selectable theme that recolours the desktop, appears in the theme picker and in Style → Unlock, and unknown/invalid names are refused by `omarchy theme set`. This is the core of the "Making your own theme" chapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ORIG=$(cat ~/.local/state/omarchy/current/theme.name); echo $ORIG`.
  * `mkdir -p ~/.config/omarchy/themes && cp -r /usr/share/omarchy/themes/tokyo-night ~/.config/omarchy/themes/probe-red && sed -i 's/^accent = .*/accent = "#ff2020"/; s/^background = .*/background = "#2a0000"/; s/^foreground = .*/foreground = "#ffd0d0"/' ~/.config/omarchy/themes/probe-red/colors.toml && head -8 ~/.config/omarchy/themes/probe-red/colors.toml`.
  * Run `omarchy theme set probe-red`.
  ** The bar, menu and terminal recolour to a dark red background with red accents; the wallpaper switches to one of the copied tokyo-night backgrounds. Open the Omarchy Menu (Super+Space) and screenshot the red-accented menu; Escape.
  * Press Super+Shift+Ctrl+Space: the theme picker lists "Probe Red" with a preview and it is the selected one. Escape.
  ** Also Omarchy Menu → Style → Unlock includes a "probe-red" preview (the copy carries preview-unlock.png). Escape. `omarchy theme set "Probe Red"` (title case, space) applies too — names are normalised.
  * Unhappy path: `omarchy theme set nonexistent; echo exit=$?` → "Theme 'nonexistent' does not exist", exit=1, desktop unchanged.
  ** `omarchy theme set '../etc'; echo exit=$?` → "Invalid theme name: ../etc", exit=1.
  * Restore: `omarchy theme set $ORIG` → original colours return; `omarchy theme remove probe-red` → "Removed probe-red" plus a "Theme removed" notification; the theme picker no longer lists Probe Red.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Theme switches animate for about a second; screenshot after the bar settles.
  * Neovim/btop/browser retints run in the background; the bar and menu are the visible proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the red desktop with the red-accented Omarchy menu, theme.name = probe-red, the theme picker and Unlock picker listing Probe Red, the three refusals with exit=1, and the restored original theme
  * If unsuccessful
  ** the theme-set output (stderr), `ls ~/.local/state/omarchy/current/theme/`, `./client get-serial`
covers: manual/43-making-your-own-theme.md (intro, Unlock image), manual/06 (theme picker), bin/omarchy-theme-set, bin/omarchy-theme-list, bin/omarchy-theme-remove, bin/omarchy-plymouth-list, default/hypr/bindings/utilities.lua:18

### custom-light-theme-switches-gtk   [VM-OK]
description: A user theme with `mode = "light"` in colors.toml puts GTK apps into light mode and back; the manual's light-mode paragraph in one check.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ORIG=$(cat ~/.local/state/omarchy/current/theme.name); gsettings get org.gnome.desktop.interface color-scheme` → 'prefer-dark' (stock dark theme).
  * `cp -r /usr/share/omarchy/themes/catppuccin-latte ~/.config/omarchy/themes/probe-light && grep -n '^mode' ~/.config/omarchy/themes/probe-light/colors.toml` → mode = "light".
  * `omarchy theme set probe-light`.
  ** Light desktop; `gsettings get org.gnome.desktop.interface color-scheme` → 'prefer-light'; `gsettings get org.gnome.desktop.interface gtk-theme` → 'Adwaita'. Open Nautilus (Super+Shift+F): light window. Close it (Super+W).
  * Flip the mode in place: `sed -i 's/^mode = "light"/mode = "dark"/' ~/.config/omarchy/themes/probe-light/colors.toml && omarchy theme set probe-light` → color-scheme back to 'prefer-dark' and Nautilus dark (open/close again).
  * Restore: `omarchy theme set $ORIG && omarchy theme remove probe-light`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nautilus may be oversized (GDK_SCALE=2); the light/dark chrome is what matters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of gsettings prefer-light with a light Nautilus, then prefer-dark with a dark Nautilus after editing mode
  * If unsuccessful
  ** gsettings unchanged after the switch, `./client get-serial`
covers: manual/43-making-your-own-theme.md (Light mode), bin/omarchy-theme-set-gnome, themes/catppuccin-latte/colors.toml

### theme-install-local-git-filters-code   [VM-OK]
description: `omarchy theme install <git url>` clones a theme, names it from the repo, applies it, and drops any .lua / terminal config / vscode.json a cloned theme ships (naming them on stderr) while keeping colours; the Extra Themes and Remove → Theme rows appear. Uses a local file:// repo so no network is needed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and build the repo: `ORIG=$(cat ~/.local/state/omarchy/current/theme.name); cp -r /usr/share/omarchy/themes/nord ~/omarchy-probegit-theme && cd ~/omarchy-probegit-theme && echo '-- PROBE-LUA-MARKER' > hyprland.lua && echo '# PROBE-ALACRITTY' > alacritty.toml && echo 'PROBE-KEEP' > icons.theme && git init -q && git add . && git -c user.name=p -c user.email=p@x commit -qm init && cd ~`.
  * Confirm the rows are absent first: Omarchy Menu (Super+Space) → Update: no "Extra Themes" row; Remove → Theme with no extras runs the CLI which prints "No extra themes installed." (run `omarchy theme remove; echo exit=$?` → that text, exit=1). Escape.
  * Run `omarchy theme install file:///home/prime/omarchy-probegit-theme 2>&1 | sudo tee /dev/ttyS0`.
  ** git clone output, then the theme applies (Nord colours) and stderr says "Ignored in /home/prime/.config/omarchy/themes/probegit: alacritty.toml hyprland.lua" and "A theme installed from a git repo cannot supply Lua, a terminal config, or vscode.json." (order may vary).
  * `cat ~/.local/state/omarchy/current/theme.name` → probegit; `ls -d ~/.config/omarchy/themes/probegit/.git` exists; `grep -c PROBE-LUA-MARKER ~/.local/state/omarchy/current/theme/hyprland.lua` → 0 (regenerated from template); `grep -c PROBE-ALACRITTY ~/.local/state/omarchy/current/theme/alacritty.toml` → 0; `cat ~/.local/state/omarchy/current/theme/icons.theme` → PROBE-KEEP (colour-ish files kept).
  * Omarchy Menu → Update: "Extra Themes" row now present; select it → floating terminal "Updating: probegit" + `git pull` output ("Already up to date." — a file:// remote works offline) → Done.
  * Menu install path: Omarchy Menu → Install → Style → Theme → floating terminal shows "See https://omarchy.org/themes/" and a URL input; press Escape (or Ctrl+C) → exits without cloning; press a key if a prompt shows.
  * Restore: `omarchy theme set $ORIG`; Omarchy Menu → Remove → Theme → picker lists probegit → select → notification "Theme removed probegit"; `ls ~/.config/omarchy/themes/` no longer has probegit; Update menu has no Extra Themes row. `rm -rf ~/omarchy-probegit-theme`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The stderr lines scroll quickly; the serial copy is authoritative.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text with the "Ignored in …: alacritty.toml hyprland.lua" message; screenshots of theme.name = probegit, the grep counts 0/0 and PROBE-KEEP, the Extra Themes row and its update terminal, the Remove → Theme picker and removal notification
  * If unsuccessful
  ** the marker found in the staged hyprland.lua (code not filtered), the clone failing, `./client get-serial`
covers: manual/43-making-your-own-theme.md (What an installed theme can contain, Distributing your theme), docs/theming.md (What an installed theme may not ship), bin/omarchy-theme-install, bin/omarchy-theme-set (stage_installed_theme), bin/omarchy-theme-extras, bin/omarchy-theme-update, bin/omarchy-theme-remove, omarchy-menu.jsonc install.style.theme, remove.theme, update.themes

### theme-install-rejects-bad-name-and-url   [VM-OK]
description: `omarchy theme install` refuses URLs that name git helpers/options, repo names that would not make a safe theme directory, and reports clone failures; nothing is written in any of these cases. Guards the trust boundary the chapter documents for shared themes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls ~/.config/omarchy/themes/ 2>/dev/null | wc -l`; record N.
  * Try a URL that names a git helper: `omarchy theme install 'ext::sh -c id'; echo exit=$?`.
  ** "omarchy-git-url-check: 'ext::sh -c id' names a git option or transport helper, not a repository.", exit=1. Likewise `'gopher://x/omarchy-y-theme.git'` → "…names the 'gopher' transport, which Omarchy does not clone from.", exit=1.
  * Try a repo name that cannot become a directory: `omarchy theme install 'file:///home/prime/omarchy-bad name-theme'; echo exit=$?`.
  ** "Error: '…omarchy-bad name-theme' does not give a usable theme name.", exit=1 — refused before any clone. `'https://example.com/omarchy-..-theme.git'` is refused the same way.
  * Try a repo that does not exist: `omarchy theme install file:///home/prime/no-such-theme; echo exit=$?`.
  ** A git clone error, then "Error: Failed to clone theme repo.", exit=1.
  * Try the manual's own example name: `omarchy theme install 'https://example.com/omarchy-c++-theme.git'; echo exit=$?`.
  ** The name `c++` passes the rule (as the manual promises), so it reaches `git clone`, which fails against example.com → "Error: Failed to clone theme repo."
  * `ls ~/.config/omarchy/themes/ 2>/dev/null | wc -l` → still N and the desktop colours are unchanged: none of the attempts wrote anything.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * example.com resolves but serves no git repo; the clone error appears within seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each refusal with exit=1 and the unchanged theme count/name
  * If unsuccessful
  ** a new directory under ~/.config/omarchy/themes/ or a changed theme, `./client get-serial`
covers: manual/43-making-your-own-theme.md (Distributing your theme — naming rules), bin/omarchy-theme-install, bin/omarchy-git-url-check

### themed-user-template-generates-file   [VM-OK]
description: A `.tpl` dropped in ~/.config/omarchy/themed/ is rendered with the theme palette on every theme switch, with `_strip`/`_rgb` modifiers, and a user template overrides the built-in for the same output file. This is how users theme apps Omarchy does not cover.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls ~/.config/omarchy/themed/` → alacritty.toml.tpl.sample.
  * `printf '%s\n' 'bg={{ background }}' 'accent_strip={{ accent_strip }}' 'fg_rgb={{ foreground_rgb }}' 'unknown={{ nope }}' > ~/.config/omarchy/themed/probe.txt.tpl`.
  * `ORIG=$(cat ~/.local/state/omarchy/current/theme.name); omarchy theme set tokyo-night && cat ~/.local/state/omarchy/current/theme/probe.txt`.
  ** Output: `bg=#1a1b26`, `accent_strip=7aa2f7`, `fg_rgb=169,177,214`, and `unknown={{ nope }}` left literally (unknown placeholders are not replaced).
  * `omarchy theme set nord && cat ~/.local/state/omarchy/current/theme/probe.txt` → different hex values (nord palette; bg starts with #2e3440 or similar).
  * Override a built-in: `sed 's/^# HOW TO USE.*//' ~/.config/omarchy/themed/alacritty.toml.tpl.sample > ~/.config/omarchy/themed/alacritty.toml.tpl && echo '# PROBE-USER-TEMPLATE' >> ~/.config/omarchy/themed/alacritty.toml.tpl && omarchy theme set tokyo-night && grep -c PROBE-USER-TEMPLATE ~/.local/state/omarchy/current/theme/alacritty.toml` → 1 (user template won over default/themed/alacritty.toml.tpl).
  * Restore: `rm ~/.config/omarchy/themed/probe.txt.tpl ~/.config/omarchy/themed/alacritty.toml.tpl && omarchy theme set $ORIG && ls ~/.local/state/omarchy/current/theme/probe.txt 2>&1` → No such file.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Templates only render for themes with colors.toml; every shipped theme has one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of probe.txt for tokyo-night (exact values above) and nord, and the grep count 1 for the user alacritty template
  * If unsuccessful
  ** probe.txt missing or placeholders unreplaced, `./client get-serial`
covers: manual/43-making-your-own-theme.md (Theming apps Omarchy doesn't cover), bin/omarchy-theme-set-templates, config/omarchy/themed/alacritty.toml.tpl.sample, docs/theming.md (Template placeholders)

### aether-app-launches   [VM-OK]
description: The Aether theme editor named in the chapter is installed and launches from the Apps menu. Without 3D acceleration it may be slow but must open.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space to open the Apps menu; type `Aether`.
  ** An "Aether" entry is listed. Press Enter.
  ** Within ~15 seconds a GUI window opens with colour controls / a theme editor (may be oversized). Screenshot.
  * Close it with Super+W.
  * Open a terminal with Super+Enter and run `pacman -Q aether` → version line.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the window is black for a while, wait; software rendering is slow. Report a crash dialog if one appears.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Apps menu entry and of the Aether window, plus `pacman -Q aether`
  * If unsuccessful
  ** no entry, a crash, or the window never painting; `./client get-serial`
covers: manual/43-making-your-own-theme.md (Aether), install/omarchy-base.packages:4

## Not runnable here (appendix, VM-NO)

Everything here needs hardware the guest lacks. (Channel switching and snapshot rollback were moved to the main list as NET/SLOW: every step is a menu or terminal action.)

### system-suspend-and-hibernate-actual   [VM-NO]
description: System → Suspend / Hibernate actually sleep and resume the machine. QEMU's S3/S4 support is not guaranteed and a failed resume strands the guest; not attempted.
instruction: |
  <Instructions>
  From the desktop please do the following:
  <ActionList>
  * Super+Escape → Suspend; wake the guest; the desktop returns locked. Same for Hibernate after hibernation-setup.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>
  </Instructions>
proof: |
  * on success
  ** the lock screen on resume
  * If unsuccessful
  ** a guest that never resumes (`./client get-serial`)
covers: manual/36-system-sleep.md, omarchy-menu.jsonc system.suspend/hibernate

### laptop-mirror-and-clamshell-real   [VM-NO]
description: Extend/mirror switching, lid-close disabling the internal panel and brightness keys need a laptop panel, a second output and a backlight. None exist in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:
  <ActionList>
  * With an external display attached: Super+Ctrl+Alt+Delete → "Mirroring enabled (…)"; again → "Extended mode restored"; Super+Ctrl+Delete → "Laptop display disabled"; close/open lid; brightness keys and Shift variants.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>
  </Instructions>
proof: |
  * on success
  ** the notifications named above and `hyprctl monitors` reflecting them
  * If unsuccessful
  ** a black internal panel that does not recover
covers: manual/33-monitors.md (Extending and mirroring, Controlling brightness), bin/omarchy-hyprland-monitor-internal*, bin/omarchy-hyprland-monitor-clamshell, default/hypr/bindings/media.lua

### wifi-qr-band-password-real   [VM-NO]
description: Setup → Network → QR Code, `omarchy network password/band <5>` and the Wi-Fi panel scan/connect need a wireless adapter and an access point.
instruction: |
  <Instructions>
  From the desktop please do the following:
  <ActionList>
  * On Wi-Fi: Setup → Network → QR Code shows a scannable QR; `omarchy network password <wlan>` prints the PSK; `omarchy network band 5` pins and `auto` releases.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>
  </Instructions>
proof: |
  * on success
  ** the QR card, the password line, band status lines
  * If unsuccessful
  ** the error text and `nmcli device status`
covers: manual/35-networking.md (Sharing your Wi-Fi, Pinning the Wi-Fi band), bin/omarchy-network-qr, bin/omarchy-network-password, bin/omarchy-network-band

### fingerprint-and-fido2-enrol-real   [VM-NO]
description: Enrolling a fingerprint or registering a FIDO2 key, then using them for sudo/polkit/lock, needs the physical sensor or key.
instruction: |
  <Instructions>
  From the desktop please do the following:
  <ActionList>
  * Setup → Security → Fingerprint (enrol, verify, unlock with finger); Setup → Security → Fido2 (touch key, `sudo -k; sudo true` prompts for the key, Ctrl+C falls back to password).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>
  </Instructions>
proof: |
  * on success
  ** "Perfect! … authentication is now configured." and a sudo/lock authentication without a password
  * If unsuccessful
  ** "Enrollment failed" / "Verification failed" output
covers: manual/37-hardware-authentication.md, bin/omarchy-setup-security-fingerprint, bin/omarchy-setup-security-fido2

## Gaps

Behaviours in scope that did not become a runnable driver test, and manual/code disagreements worth fixing.

1. **Manual claims automatic restart after editing any menu-opened config; code only does it for Hyprsunset and XCompose.** `manual/31` says "any process that needs restarting after config edits automatically will be after you quit the editor". `Setup → Monitors/Keybindings/Input`, `Style → Hyprland` and `Setup → Config → Hyprland` run `omarchy-launch-config-editor`, which only opens the editor; there is no `hyprctl reload`. It works only if Hyprland's own file watcher covers `require`d Lua modules, which the tree does not establish. Tests above hedge with an explicit `hyprctl reload` and ask the driver to record whether the change had already applied. Either the manual should say "Hyprland reloads on save" (if true) or the menu actions should chain `hyprctl reload`.
2. **Default monitor scale is `"auto"`, not 2.** `manual/33` opens with "Omarchy assumes you're running on a 2x-capable retina-class display by default" and shows `local omarchy_gdk_scale = 2 / local omarchy_monitor_scale = 1.6` as "the recommendation for that combo", implying the stock value is 2. `config/hypr/monitors.lua` ships `omarchy_monitor_scale = "auto"` (Hyprland picks per display) while `omarchy_gdk_scale = 2` is fixed. On a 1× display this leaves GTK/XWayland apps at 2× — visible in the guest as oversized Nautilus/file-chooser windows. The manual should describe `"auto"` and tell 1080p users to also lower `omarchy_gdk_scale`. Not a test, an observation the driver must not misreport as a bug.
3. **`Update → Config` does not offer "individual configs".** `manual/42` says "restore individual configs to their original setup via Update → Config"; the menu offers five groups, and Hyprland restores all seven `~/.config/hypr` files at once (`omarchy-refresh-hyprland`). Per-file restore exists only as the CLI `omarchy-refresh-config hypr/<file>.lua`, which the manual never names. Also `manual/42` says a reset leaves a `.bak` file; the actual suffix is `.bak.<epoch>`.
4. **`omarchy plugin clone --edit` uses `$EDITOR`, not the Omarchy default editor.** `manual/32` says "--edit to open the new directory in your $EDITOR right away" (accurate), but `manual/31` teaches users to change their editor via `Setup → Defaults → Editor`, which writes `~/.local/state/omarchy/defaults/editor` and is what every other config entry honours. A user who set VSCode there still gets `$EDITOR` (nvim) from the plugin menu. Minor inconsistency; the clone test notes which editor opened.
5. **Media, brightness and power keys cannot be sent.** `send-keys` covers CapsLock, Right Alt, Menu and every `_`-named qcode (so compose sequences and `grp:alts_toggle` are fully tested above), but not the XF86 keys (`volumeup`, `audiomute`, `brightnessup`, `power`). The brightness bindings in manual/33 (`XF86MonBrightnessUp/Down`, Shift/Alt variants) and `XF86PowerOff` → System menu therefore have no test; brightness also lacks a backlight in the guest.
6. **Plugin live-reload on save** (`manual/32`: "Saving a file anywhere under ~/.config/omarchy/plugins/ reloads the plugin code automatically") is shell-side QML behaviour; without knowing the Clock plugin's internals a driver cannot make a visible edit and prove it reloaded. Left to the shell/bar reviewer.
7. **Touchpad/gesture settings, haptics, `scroll_touchpad` window rules, `sensitivity`/`accel_profile`** (manual/34) have no observable effect with a USB-tablet pointer and no touchpad; `hyprctl getoption` can read them back but that only proves parsing, which `input-lua-repeat-rate-and-compose-option` already covers.
8. **Video wallpaper audio and pause-when-covered** (manual/39) need an audio device and an observable playback clock; only looping is checked (`background-video-loop`, and only if `ffmpeg` is present to make a clip — not verified to be installed).
9. **`omarchy plymouth set` custom logo/colour on the SDDM login screen** (manual/41 says the same colours reach SDDM) is only observable if the build uses SDDM rather than auto-login; the reboot test asks the driver to note whether a login screen appeared. Also `omarchy plymouth current` identifies the theme by comparing `logo.png`, so a custom `omarchy plymouth set` with the stock logo but new colours still reports `default` — a small reporting inaccuracy worth a note in the manual.
10. **About-screen glint** (manual/41) is timing-based; two screenshots a few seconds apart may miss the sweep. The test treats a visible sweep in either shot as sufficient and does not fail on its absence.
11. **Tailscale Taildrop / exit nodes / account switching** (manual/35) need a tailnet login; only install/remove and the bar panel are covered.
12. **Firmware writes, actual suspend/hibernate, real Wi-Fi, fingerprint/FIDO2 enrolment, laptop mirror/clamshell/brightness** — see the VM-NO appendix. Channel switching (`update-channel-switch-dev-and-back`) and snapshot rollback (`update-rollback-boot-snapshot`) are in the main list as NET/SLOW; both will probably overrun a ten-minute session on user-mode NAT and their instructions tell the driver to report "incomplete — time" rather than a failure. The RC and Edge channels are not exercised separately: they take the same `omarchy-refresh-pacman` path as Dev/Stable minus the checkout.
13. **`omarchy-hook post-boot`** runs from `default/hypr/autostart.lua` two seconds after start; testable only by logging out and in (covered incidentally by `autostart-lua-launch-on-start`, which could also install a post-boot hook — not added to keep that test single-purpose).
14. **`omarchy update` in dev-link mode** (fast-forwarding `~/omarchy`) happens inside `update-channel-switch-dev-and-back` as the unattended `omarchy-update -y` step, but a *pending upstream commit* cannot be arranged from the guest, so the fast-forward itself is only seen as "already up to date".
15. **`omarchy snapshot restore`** (`limine-snapper-restore`) makes a snapshot boot permanent; deliberately left out of `update-rollback-boot-snapshot` because it rewrites the root subvolume and there is no way back inside a session.

