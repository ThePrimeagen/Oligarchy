# 25 — bin: Hyprland helpers, toggles, restarts, shell/bar/OSD, notifications, capture, clipboard, brightness, audio, network/DNS, Bluetooth, weather, hw-detection, plugins, monitor/display

Reviewer notes for the desktop-plumbing half of `bin/`. Source: `/tmp/omarchy-review/omarchy` (omarchy @ HEAD 2026-09-18, dev line `4.0.0.alpha`; the minted disk runs the 4.0.2 ISO, so a few commands below may be missing or older there — every instruction says what to report when a command is "not found").

## Scope

Read completely (line counts from `wc -l`):

- `bin/omarchy-hyprland-*` (24): `focus-app` 31, `monitor-clamshell` 252, `monitor-external-active` 6, `monitor-focused` 5, `monitor-focused-apple` 12, `monitor-internal` 78, `monitor-internal-mirror` 73, `monitor-laptop` 5, `monitor-modeless` 21, `monitor-scaling` 203, `monitor-watch` 114, `reload-guard` 115, `session-locked` 29, `toggle` 54, `toggle-disabled` 6, `toggle-enabled` 6, `window-close-all` 12, `window-gaps-toggle` 5, `window-pop` 40, `window-single-square-aspect-toggle` 8, `window-tiled-fullscreen-toggle` 16, `window-transparency-toggle` 7, `window-width` 168, `workspace-layout-toggle` 21. (There is no `omarchy-hyprland-keyboard-layout` or `omarchy-hyprland-qconsole` binary: keyboard layout is `default/hypr/input.lua` + the `omarchy.keyboard-layout` bar widget; the Quake console is `default/hypr/qconsole.lua` on the scratchpad. Both are covered below via their config/widget.)
- `bin/omarchy-toggle` 42 and `bin/omarchy-toggle-*` (13): `bar` 13, `crash-capture` 18, `enabled` 6, `fullscreen-desktop` 27, `hybrid-gpu` 119, `idle` 67, `input-device` 76, `nightlight` 59, `notification-silencing` 6, `screensaver` 11, `suspend` 11, `touchpad` 6, `touchscreen` 6.
- `bin/omarchy-restart-*` (16): `app` 7, `audio` 225, `bluetooth` 7, `btop` 5, `gum` 18, `helix` 7, `herdr` 13, `hyprctl` 5, `hyprsunset` 5, `opencode` 7, `shell` 93, `terminal` 15, `tmux` 7, `trackpad` 20, `wifi` 11, `xcompose` 10.
- `bin/omarchy-shell` 82, `bin/omarchy-shell-config` (sourced helper, read for `omarchy-bar`), `bin/omarchy-bar` 403, `bin/omarchy-osd` 40.
- `bin/omarchy-notification-*` (6): `battery` 5, `dismiss` 11, `send` 211, `time` 5, `wait` 30, `weather` 5.
- `bin/omarchy-capture-*` (8): `qr` 36, `region` 370, `screenrecording` 303, `screenrecording-with-webcam` 21, `screenshot` 82, `text` 26, `webcam-list` 33, `webcam-resize` 152.
- `bin/omarchy-clipboard-*` (3): `open` 70, `paste-file` 33, `paste-text` 63.
- `bin/omarchy-brightness-*` (5): `display` 122, `display-apple` 107, `display-ddc` 168, `keyboard` 58, `keyboard-mute` 14.
- `bin/omarchy-audio-*` (9): `input-mute` 13, `input-set-default` 20, `output-set-default` 31, `output-sink` 55, `output-switch` 59, `output-volume` 86, `sink-availability` 54, `source-switch` 20, `tuning` 357.
- `bin/omarchy-network-*` (5): `band` 192, `password` 34, `qr` 95, `speedtest` 130, `status` 137; `bin/omarchy-dns` 319.
- `bin/omarchy-bluetooth-*` (2): `device` 52, `power` 89.
- `bin/omarchy-weather-*` (3): `icon` 45, `location` 46, `status` 24.
- `bin/omarchy-hw-*` (28): `asus-expertbook-b9406` 5, `asus-rog` 6, `asus-zenbook-ux5406aa` 5, `clamshell` 7, `dell-xps13-sidecar-amps` 8, `dell-xps-haptic-touchpad` 5, `dell-xps-oled` 7, `display` 25, `elgato-camlink-4k` 5, `external-monitors` 12, `fingerprint` 56, `framework16` 6, `hybrid-gpu` 24, `intel` 5, `intel-ptl` 5, `intel-sof` 5, `laptop` 17, `laptop-closed` 11, `match` 7, `nvidia` 16, `nvidia-gsp` 20, `nvidia-without-gsp` 23, `recover-internal-monitor` 9, `surface` 6, `touchpad` 6, `touchscreen` 6, `vulkan` 6, `webcam` 5.
- `bin/omarchy-plugin-*` (9): `add` 175, `catalog` 62, `clone` 168, `disable` 26, `enable` 100, `list` 46, `remove` 123, `update` 133, `validate` 118.
- `bin/omarchy-monitor-state` 23, `bin/omarchy-display-text-size` 236.
- `docs/audio-tuning.md` 158, `docs/notifications.md` 199.
- `default/hypr/toggles.lua` 23, `default/hypr/toggles/{flags,single-window-aspect-ratio,window-no-gaps}.lua` 2/6/12, `default/hypr/workspace-layouts.lua` 8, `default/hypr/disabled-input-device.lua` 21, `default/hypr/input.lua` 81, `default/hypr/qconsole.lua` 196, `default/hypr/autostart.lua` 14.
- `default/omarchy/omarchy-menu.jsonc` 380 (Trigger/Toggle/Capture/Hardware/Setup→Network/Plugins/Security, System, Update→Process/Hardware entries), `default/hypr/bindings/{utilities,media,clipboard,tiling,applications,voxtype}.lua`, `default/hypr/helpers.lua` (`o.bind_toggle` → `omarchy-toggle-<name>`).
- Read for visible-proof details only: `config/omarchy/shell.json` (default bar layout, `idle.screensaver=150`, `idle.lock=300`), `shell/plugins/bar/indicators/{StayAwake,NightLight,Dnd,ScreenRecording}.qml`, `shell/plugins/bar/widgets/KeyboardLayout.qml` (+manifest), `shell/plugins/clipboard/{Clipboard.qml,capture.sh}`, `shell/plugins/osd/OsdModel.js`, `shell/plugins/services/{idle,nightlight}/Service.qml`, `default/systemd/user/omarchy-crash-watch.service`, `default/hypr/windows.lua` (default opacity `0.985 0.96`), `manual/12-screenshots-recording.md`, `manual/13-toggles-idle-screensaver.md`, `manual/08-unified-clipboard-history.md`, `manual/35-networking.md`.
- Read because the task named the toggle although they are outside the `bin/` globs: `bin/omarchy-sudo-docker` 44, `bin/omarchy-setup-security-sudoless-docker` 49, `bin/omarchy-remove-security-sudoless-docker` 33, `bin/omarchy-launch-screensaver` 73, `bin/omarchy-screensaver` 47, `bin/omarchy-git-url-check` 50, `bin/omarchy-launch-floating-terminal-with-presentation` 14, `bin/omarchy-menu` 60, `bin/omarchy-menu-plugin` 60, `bin/omarchy-menu-clipboard` 6.
- Skimmed for maintainer invariants: `test/shell.d/` `toggle-test.sh`, `toggle-input-device-test.sh`, `sudoless-docker-toggle-test.sh`, `hyprland-{binding-conflicts,default-config,focus-app,keyboard-layout,paths,qconsole,reload-guard,session-locked,window-close-all,window,workspace-layout}-test.sh`, `restart-shell-test.sh`, `screenshot-sanity-test.sh`, `screenrecording-test.sh`, `clipboard-test.sh`, `nightlight-test.sh`, `idle-test.sh`, `audio-test.sh`, `brightness-display{,-apple-cache}-test.sh`, `network{,-captive-portal,-manager-transition,-password,-qr}-test.sh`, `wifiqr-test.sh`, `dns-sudoers-test.sh`, `bluetooth-test.sh`, `weather-test.sh`, `hw-{display,external-monitors,fingerprint,hybrid-gpu,nvidia}-test.sh`, `plugin-{add,auth-boundary,clone,enable,registry-contract,validate}-test.sh`, `plugins-test.sh`, `menu-plugin-test.sh`, `notification-send-test.sh`, `notifications-test.sh`, `osd-test.sh`, `keyboard-layout-test.sh`, `monitor-{clamshell-scale,modeless,output-name,recovery,scaling,state}-test.sh`, `monitor-test.sh`, `sleep-monitor-test.sh`.

Skipped: the QML bodies of panels (audio, network, bluetooth, monitor, power, weather, speedtest, wifiqr) beyond what the bar indicators and hotkeys expose — they belong to the shell reviewer; `omarchy-system-*`, `omarchy-menu-*` other than the three above; `omarchy-crash-watch` internals; the audio tuning graphs under `default/audio/tunings/` (no laptop matches in QEMU).

## Inventory

Format: `script` — args/flags — sudo? — how a user reaches it (menu path / hotkey / CLI only) — **QEMU**: OK / PARTIAL (what) / NO (why). "CLI" means the `omarchy <group> <verb>` router or the `omarchy-…` binary from a terminal. Hidden = `# omarchy:hidden=true`, not listed by `omarchy --help`.

### Hyprland helpers (`bin/omarchy-hyprland-*`)

- `omarchy-hyprland-focus-app <app-name>` — case-insensitive regex on window class, falls back to `initialTitle` of `org.omarchy.agent` windows; exit 1 when nothing matches — no sudo — CLI; used by notification click fallback — **QEMU OK**.
- `omarchy-hyprland-monitor-clamshell` (hidden) — no args; runs `monitor-internal recover`, `monitor-internal-mirror recover`, then disables the laptop panel when `omarchy-hw-clamshell && monitor-external-active` — no sudo — bound to `switch:off:Lid Switch` and by `monitor-watch` — **QEMU PARTIAL**: no `eDP-*` output, so `INTERNAL` is empty and every branch is a no-op.
- `omarchy-hyprland-monitor-external-active` (hidden) — true when an enabled monitor is not `eDP|LVDS|DSI` — **QEMU OK but TRUE**: `Virtual-1` counts as external.
- `omarchy-hyprland-monitor-focused` — prints focused monitor name — **QEMU OK** (`Virtual-1`).
- `omarchy-hyprland-monitor-focused-apple [monitor]` — true for Apple Studio/XDR — **QEMU OK, always false**.
- `omarchy-hyprland-monitor-internal <on|off|toggle|recover>` — flag `toggles/hypr/internal-monitor-disable.lua`; notifications "Laptop display disabled/enabled", "No laptop display found", "Can't disable the only active display" — menu Trigger→Hardware→Laptop Display (`when omarchy-hw-laptop`, hidden in QEMU); hotkey `Super+Ctrl+Delete` — **QEMU PARTIAL**: `off`/`toggle` → "No laptop display found" (exit 1); `on`/`recover` no-op.
- `omarchy-hyprland-monitor-internal-mirror <on|off|toggle|recover>` — flag `internal-monitor-mirror.lua`; "No external monitors found for mirror" / "No laptop monitor found to mirror" / "Mirroring enabled (X)" / "Extended mode restored" — Trigger→Hardware→Mirror Display (hidden in QEMU); `Super+Ctrl+Alt+Delete` — **QEMU PARTIAL**: `on` → "No laptop monitor found to mirror".
- `omarchy-hyprland-monitor-laptop` — prints first `eDP|LVDS|DSI` output — **QEMU OK, prints nothing**.
- `omarchy-hyprland-monitor-modeless` (hidden) — exit 0 when an enabled monitor is 0x0, 1 otherwise, 2 if hyprctl fails — **QEMU OK, exit 1**.
- `omarchy-hyprland-monitor-scaling [up|down|SCALE]` — presets 1 1.25 1.6 2 3 4, any 1–4 accepted, rounded to a "clean" scale; persists into `~/.config/hypr/monitors.lua` (`omarchy_monitor_scale`/`omarchy_gdk_scale`); audit log `~/.local/state/omarchy/monitor-scaling.log`; no-arg prints scale — hotkeys `Super+/` (up), `Super+Alt+/` (down); Display panel `Super+Ctrl+D` — **QEMU OK** (on 1280x800, 3 rounds to 3.2).
- `omarchy-hyprland-monitor-watch` — event loop on Hyprland socket2; runs clamshell sync + modeless recovery — autostarted (`default/hypr/autostart.lua`) — **QEMU OK (idle)**.
- `omarchy-hyprland-reload-guard pause|resume|paused` (hidden) — sets `misc.disable_autoreload`/`debug.suppress_errors` on every live instance; state in `/run/omarchy/hyprland-reload-guard/` (root) — used by pacman hooks — **QEMU OK with sudo**.
- `omarchy-hyprland-session-locked` (hidden) — exit 0 locked / 1 unlocked / 2 undetermined, from `solitaryBlockedBy` containing `LOCK` — used by `omarchy-restart-shell` — **QEMU OK**.
- `omarchy-hyprland-toggle <flag> [on|off|toggle]` — copies `default/hypr/toggles/<flag>.lua` to `~/.local/state/omarchy/toggles/hypr/`, prints on/off, `hyprctl reload`; "Flag not found: X" exit 1 — CLI — **QEMU OK**. Flags shipped: `window-no-gaps`, `single-window-aspect-ratio` (`internal-monitor-*` are generated, not shipped).
- `omarchy-hyprland-toggle-enabled <flag>` — exit 0 when `~/.local/state/omarchy/toggles/hypr/<flag>.lua` exists — used by `toggle-fullscreen-desktop`, `monitor-internal*` — **QEMU OK**.
- `omarchy-hyprland-toggle-disabled <flag>` — the inverse (exit 0 when the flag file is missing) — used by `monitor-internal*` — **QEMU OK**.
- `omarchy-hyprland-window-close-all` — closes every client, focuses workspace 1 — `Ctrl+Alt+Delete` — **QEMU OK**.
- `omarchy-hyprland-window-gaps-toggle` — wraps `hyprland-toggle window-no-gaps` (gaps 0, border 0, rounding 0) — `Super+Shift+Backspace`; Trigger→Toggle→Window Gaps — **QEMU OK**.
- `omarchy-hyprland-window-pop [w h x y]` — float+resize (default 1300x900)+center+pin+tag `pop`; again unpins/retiles — `Super+O` — **QEMU OK** (1300x900 overflows a 1280x800 screen; pass a size).
- `omarchy-hyprland-window-single-square-aspect-toggle` — flag `single-window-aspect-ratio` (1:1); notification "Enable/Disable single-window square aspect ratio" — `Super+Ctrl+Backspace`; Trigger→Toggle→1-Window Ratio — **QEMU OK**.
- `omarchy-hyprland-window-tiled-fullscreen-toggle` — `fullscreenstate 0 2` ↔ `0 0` (client thinks fullscreen, stays tiled) — `Super+Ctrl+F` — **QEMU OK**.
- `omarchy-hyprland-window-transparency-toggle` — toggles `opaque` prop on the active window — `Super+Backspace` — **QEMU OK** (subtle: default opacity is 0.985/0.96).
- `omarchy-hyprland-window-width save|restore` — width per class+workspace under `~/.local/state/omarchy/windows/`; notifications "Saved width for … / Restore using Super + Home" and "No saved width found …" (exit 1) — `Super+Alt+Home` / `Super+Home` — **QEMU OK**.
- `omarchy-hyprland-workspace-layout-toggle` — dwindle↔scrolling for the active workspace, persisted to `~/.local/state/omarchy/workspace-layouts/<id>.lua`, notification "Workspace layout set to X" — `Super+L`; Trigger→Toggle→Workspace Layout — **QEMU OK**.
- Config: `default/hypr/toggles.lua` sources every `~/.local/state/omarchy/toggles/hypr/*.lua` on reload (excluding legacy `touchpad-disabled`/`touchscreen-disabled`), then `disabled-input-device.lua` re-applies `touchpad-disabled-name`/`touchscreen-disabled-name` as data, then `workspace-layouts.lua`. `default/hypr/input.lua`: `kb_layout` from `/etc/vconsole.conf` (default `us`), `compose:caps,shift:both_capslock_cancel`; non-Latin layouts get `us,` prepended + `grp:alts_toggle`. `default/hypr/qconsole.lua`: `Super+S`/`Super+grave` scratchpad as a half-height, 2:1 centred Quake console seeded with `omarchy-agent` (empty terminal-less console until an agent is chosen).

### Toggles (`bin/omarchy-toggle*`)

- `omarchy-toggle <flag> [toggle|on|off]` — flag file `~/.local/state/omarchy/toggles/<flag>`; bad action → usage exit 1 — CLI — **QEMU OK**.
- `omarchy-toggle-enabled <flag>` — exit 0 when flag file exists — **QEMU OK**.
- `omarchy-toggle-bar [toggle|on|off]` — flag `bar-off` + `omarchy-shell -q omarchy.bar syncHidden` — `Super+Shift+Space`; Trigger→Toggle→Menu Bar — **QEMU OK**.
- `omarchy-toggle-crash-capture` — flag `crash-capture-off`; stops/starts `omarchy-crash-watch.service`; notification "Crash capture disabled/enabled" — Trigger→Toggle→Crash Capture — **QEMU OK**.
- `omarchy-toggle-fullscreen-desktop [toggle|on|off]` — `toggle-bar` + `hyprland-toggle window-no-gaps` together; toggle only leaves fullscreen when both are on — `Super+Ctrl+Alt+F` — **QEMU OK**.
- `omarchy-toggle-hybrid-gpu` — requires sudo; installs `supergfxctl` if missing (package install), writes `/etc/supergfxd.conf`, `gum confirm`, reboots — Trigger→Hardware→Hybrid GPU (`when omarchy-hw-hybrid-gpu`, hidden in QEMU) — **QEMU NO**: would install a package and enable supergfxd on a single-GPU VM; only the "entry hidden" negative is runnable.
- `omarchy-toggle-idle [toggle|stay-awake|allow-idle|status]` — flag `~/.local/state/omarchy/indicators/stay-awake`; prints `enabled|disabled`; `status` prints JSON `{"enabled":…,"class":…,"tooltip":…}` — `Super+Ctrl+I`; Trigger→Toggle→Stay Awake; bar indicator 󰅶 — **QEMU OK**.
- `omarchy-toggle-input-device <touchpad|touchscreen> [on|off|toggle]` (hidden) — device from `omarchy-hw-touchpad|touchscreen`; "No touchpad device found" exit 1; persists name to `toggles/hypr/<kind>-disabled-name`; OSD "Touchpad disabled/enabled" — via `omarchy-toggle-touchpad|touchscreen` — **QEMU PARTIAL**: no device → error path only.
- `omarchy-toggle-touchpad [on|off|toggle]` — `XF86TouchpadToggle/On/Off`; Trigger→Hardware→Touchpad (`when omarchy-hw-touchpad`) — **QEMU PARTIAL** (error path).
- `omarchy-toggle-touchscreen [on|off|toggle]` — Trigger→Hardware→Touchscreen (`when omarchy-hw-touchscreen`) — **QEMU PARTIAL** (error path).
- `omarchy-toggle-nightlight [--status]` — starts `hyprsunset` if needed, `hyprctl hyprsunset temperature 4000|6500`, then `omarchy-shell -q nightlight refresh`; `--status` prints `{"enabled":bool,"temperature":N}` — `Super+Ctrl+N`; Trigger→Toggle→Nightlight; bar indicator 󰔎 — **QEMU OK** (CTM is applied in Hyprland's renderer, so the tint shows in screendumps).
- `omarchy-toggle-notification-silencing` — `omarchy-shell notifications toggleDnd` + indicators refresh — `Super+Ctrl+,`; Trigger→Toggle→Notifications; bar indicator 󰂛 — **QEMU OK**.
- `omarchy-toggle-screensaver` — flag `screensaver-off`; notification "Screensaver disabled/enabled"; `omarchy-launch-screensaver` (idle path) exits 1 while set, System→Screensaver uses `force` and still runs — Trigger→Toggle→Screensaver — **QEMU OK**.
- `omarchy-toggle-suspend` — flag `suspend-off`; notification "Suspend removed from system menu" / "Suspend now available in system menu"; System menu row `system.suspend` has `when ! omarchy-toggle-enabled suspend-off` — CLI only (no menu row, no hotkey) — **QEMU OK**.
- Outside the glob but a toggle in the task list: **Sudoless Docker** — Setup→Security→Sudoless Docker (`when omarchy-sudo-docker --configured`) runs `omarchy-setup-security-sudoless-docker` in a floating terminal: warning, `gum confirm`, `sudo usermod -aG docker`, `omarchy-state set reboot-required`, optional reboot; Remove→Security→Sudoless Docker (`when ! omarchy-sudo-docker --configured`) runs `omarchy-remove-security-sudoless-docker` (`sudo gpasswd -d`) — **QEMU OK** (decline the reboot).

### Restarts (`bin/omarchy-restart-*`)

- `omarchy-restart-app <name> [args]` — `pkill -x`, relaunch via `uwsm-app` — CLI — **QEMU OK**.
- `omarchy-restart-audio` — restarts wireplumber/pipewire/pipewire-pulse (25 s timeout), force-kills on failure, USB reset path (`sudo usbreset`) only when stuck, prints `wpctl status` — Update→Hardware→Audio (floating terminal) — **QEMU OK** (no USB path exercised).
- `omarchy-restart-bluetooth` — `rfkill unblock bluetooth; rfkill list bluetooth` — Update→Hardware→Bluetooth — **QEMU PARTIAL**: empty list.
- `omarchy-restart-btop` — `pkill -SIGUSR2 btop` — used by theme set — **QEMU OK**.
- `omarchy-restart-gum` (hidden) — meant to be sourced; exports `hl.env` values from the theme's `gum_env.lua` — **QEMU OK** (no visible effect).
- `omarchy-restart-helix` — `pkill -USR1 helix` if running — **QEMU OK (no-op)**.
- `omarchy-restart-herdr` — `herdr server reload-config` if running, exit 1 on failed status — **QEMU OK (no-op)**.
- `omarchy-restart-hyprctl` — `hyprctl reload` — **QEMU OK**.
- `omarchy-restart-hyprsunset` — `omarchy-restart-app hyprsunset` (resets temperature to the config profile, i.e. nightlight turns off) — Update→Process→Hyprsunset; Setup→Config→Hyprsunset after editing — **QEMU OK**.
- `omarchy-restart-opencode` — `killall -SIGUSR2 opencode` if running — **QEMU OK (no-op)**.
- `omarchy-restart-shell` — refuses while the session is locked and the locker is alive ("Refusing to restart Omarchy shell while the session is locked."); kills every quickshell instance for `$OMARCHY_PATH/shell`, relaunches via `hyprctl dispatch exec omarchy-launch-shell`, waits for `shell ping` (2 s), re-locks a dead-lock session, restarts `omarchy-*-invitation.service`; "Omarchy shell did not become ready after restart." exit 1 — Update→Process→Shell — **QEMU OK**.
- `omarchy-restart-terminal` — `touch` alacritty config, `SIGUSR1` kitty, `SIGUSR2` ghostty — **QEMU OK**.
- `omarchy-restart-tmux` — `tmux source-file` if a session exists — **QEMU OK (no-op)**.
- `omarchy-restart-trackpad` — sudo; unbind/rebind `i2c_hid_acpi` devices, reload `intel_quicki2c` — Update→Hardware→Trackpad — **QEMU PARTIAL**: no i2c devices → prints nothing, exits 0.
- `omarchy-restart-wifi` — `rfkill unblock wifi; nmcli networking on; nmcli radio wifi on; rescan; rfkill list wifi` — Update→Hardware→Wi-Fi — **QEMU PARTIAL**: rescan errors are swallowed, list empty.
- `omarchy-restart-xcompose` — stop `omarchy-fcitx5.service`, `pkill fcitx5`, start unit — Setup→Config→XCompose after editing — **QEMU OK** (unit must exist on the minted disk; report if `Unit not found`).

### Shell IPC, bar, OSD

- `omarchy-shell [-q] <target> <method> [args]` — `qs ipc` call with 2 s timeout; errors "omarchy-shell is not running / not responding / not ready", "Target not found.", "Function not found."; `-q` swallows everything; no-arg prints usage — CLI (used everywhere) — **QEMU OK**.
- `omarchy-bar use <id>|reset|defaults|position <top|bottom|left|right>|transparent <true|false|toggle>|put <id> [placement]|move <id> [placement]|set <id> <key> <value> [--json] [placement]` — edits `~/.config/omarchy/shell.json` via `omarchy-shell-config` and asks the shell to reload; validation errors like "position must be top, bottom, left, or right", "X is not a known bar option; run 'omarchy plugin list'", "section must be left, center, or right" — Style→Menu Bar→Position/Transparency — **QEMU OK**.
- `omarchy-osd [-i icon] [-m text] [-p 0-100] [-d ms]` — icons: `volume-{muted,low,medium,high}`, `microphone{,-muted}`, `brightness|display`, `keyboard`, `touchpad`, `touch`, `media*`; "Unknown OSD option: X" exit 1 — CLI; used by volume/brightness/input toggles — **QEMU OK**.

### Notifications (`bin/omarchy-notification-*`, `docs/notifications.md`)

- `omarchy-notification-send [--app-name N] [-g glyph] [-u low|normal|critical] [-i icon] [-t ms] [-r id] [-p] [--image path] <headline> [description] [--exec prog args…]` — direct `busctl … Notify`, never `notify-send`; default urgency low, app `omarchy-action` (punches through DND); `-p` prints the id; `--exec` must be separate words ("--exec takes the command as separate words, not one quoted string."); unknown option/urgency → exit 1 — CLI; used by everything — **QEMU OK**.
- `omarchy-notification-dismiss <summary-substring>` — `omarchy-shell -q notifications dismiss` — **QEMU OK**.
- `omarchy-notification-time` — low toast with date/time/week — `Super+Ctrl+Alt+T` — **QEMU OK**.
- `omarchy-notification-battery` — toast with `omarchy-battery-status` — `Super+Ctrl+Alt+B` — **QEMU PARTIAL**: no battery; shows whatever `omarchy-battery-status` prints for none.
- `omarchy-notification-weather` — toggles the `omarchy.weather` panel (not a sender) — `Super+Ctrl+Alt+W` — **QEMU OK (NET for data)**.
- `omarchy-notification-wait [seconds]` (hidden) — polls shell ping + `GetServerInformation` — **QEMU OK**.
- Shell IPC bound to hotkeys: `Super+,` dismissOne, `Super+Shift+,` dismissAll, `Super+Alt+,` invokeLast, `Super+Shift+Alt+,` showHistory; history dir `~/.local/state/omarchy/notifications/history/` (newest ten), DND flag `dnd` in `~/.local/state/omarchy/notifications.json`.

### Capture (`bin/omarchy-capture-*`)

- `omarchy-capture-screenshot [smart|region|windows|fullscreen] [slurp|copy|save] [--editor=X]` — `~/Pictures/screenshot-YYYY-MM-DD_HH-MM-SS.png` (dir created + toast if missing), clipboard `image/png`, toast "Screenshot saved to clipboard and file" with thumbnail and click→`tensaku-edit`; `copy` = clipboard only, `save` = file only; a running slurp is killed instead (second `Print` cancels) — `Print`; Trigger→Capture→Screenshot; `Super+Ctrl+C` capture menu — **QEMU OK**.
- `omarchy-capture-region [region|windows|smart|fullscreen] [--keep-freeze] [--match-monitor] | --take-fullscreen | --take-window | --select-window <next|prev|left|right|up|down>` (hidden) — shared picker over a `hyprpicker -r -z` freeze; smart mode snaps a bare click (<20 px²) to the window/monitor rect; keyboard while slurp is up (binds in `utilities.lua`): `Return` window under cursor, `Ctrl+Return` whole screen, `Tab`/`Ctrl+Tab`/arrows move the cursor between windows — **QEMU OK**.
- `omarchy-capture-screenrecording [--fullscreen] [--with-desktop-audio] [--with-microphone-audio] [--with-webcam] [--webcam-device=D] [--webcam-size=small|medium|large] [--resolution=WxH] [--stop-recording]` — `gpu-screen-recorder -k auto -f 60 -fm cfr -fallback-cpu-encoding yes` to `~/Videos/screenrecording-….mp4` (dir must exist: critical toast otherwise); second call stops (SIGINT, 5 s grace, then kill -9 + "Screen recording error"); `finalize_recording` trims 0.1 s/normalises; toast "Screen recording saved" with thumbnail, click→mpv; bar indicator 󰻂; `OMARCHY_SCREENRECORD_DEBUG=true` logs to `$XDG_RUNTIME_DIR/omarchy-screenrecord.log`; `OMARCHY_SCREENRECORD_USE_PORTAL=true` alt path; `--stop-recording` with nothing running exits 1 — `Alt+Print` (stop or open Trigger→Capture→Screenrecord submenu: no audio / desktop audio / desktop+mic / +webcam (`when omarchy-hw-webcam`) / Stop Screenrecording (`when pgrep gpu-screen-recorder`)) — **QEMU PARTIAL**: no GPU encoder → CPU x264 fallback; kms capture on virtio-gpu may fail — see test.
- `omarchy-capture-screenrecording-with-webcam` — picks `/dev/video*` via `omarchy-capture-webcam-list`, "No webcam devices found" critical toast exit 1 — **QEMU PARTIAL** (negative only).
- `omarchy-capture-webcam-list` (hidden) — v4l2 capture-capable devices — **QEMU OK, empty**.
- `omarchy-capture-webcam-resize <smaller|larger|reset|small|medium|large>` — moves the `WebcamOverlay` mpv window; exits 0 silently without one; bad arg → usage exit 1 — `Super+Alt+[` / `Super+Alt+]` — **QEMU PARTIAL** (usage + silent no-op only).
- `omarchy-capture-text` — region → `tesseract` (`OMARCHY_OCR_LANGS`, default eng) → clipboard; toast "Copied text from selection to clipboard" — `Super+Ctrl+Print`; Trigger→Capture→Text — **QEMU OK**.
- `omarchy-capture-qr` — region → `zbarimg` QR only → `wl-copy --sensitive`; toast "QR code copied to clipboard" or critical "No QR code found" — Trigger→Capture→QR Code — **QEMU OK**.
- Menu-only capture: Trigger→Capture→Color = `pkill hyprpicker || hyprpicker -a` (`Super+Print`) — **QEMU OK**.

### Clipboard (`bin/omarchy-clipboard-*`, `shell/plugins/clipboard`)

- `omarchy-clipboard-open --history-index N` (hidden) — image → `tensaku-edit`; URL-ish text → browser; other text → temp file in `~/.local/state/omarchy/clipboard-open/` opened in `$EDITOR` — panel `Alt+Return` — **QEMU OK**.
- `omarchy-clipboard-paste-file [--copy-only] <mime> <path>` (hidden) — `wl-copy --type`, then `wtype Shift+Insert` — panel Return on an image row — **QEMU OK**.
- `omarchy-clipboard-paste-text [--shift-insert] [--copy-only] [--history-index N | <text>]` (hidden) — `wl-copy` then `wtype` the text or Shift+Insert — panel Return / `Shift+Return` (copy only) — **QEMU OK**.
- Panel `omarchy.clipboard` — `Super+Ctrl+V` (`omarchy-menu-clipboard`); history `~/.local/state/omarchy/clipboard-history.json` (limit 500, shows 50), images in `clipboard-images/`; keys: type to filter, `Up/Down/PgUp/PgDn/Home/End`, `Return` paste, `Shift+Return` copy only, `Alt+Return` open, `Delete` remove row, `Shift+Delete` clear (confirm dialog "Delete entire clipboard history?"), `Esc` clear filter/close; watcher `wl-paste --watch capture.sh`, skips `x-kde-passwordManagerHint`/sensitive copies — **QEMU OK**.

### Brightness (`bin/omarchy-brightness-*`)

- `omarchy-brightness-display [--no-osd] [--monitor N] [+N%|N%-|N%|off|on]` — Apple (`asdcontrol`, sudo) → DDC (`ddcutil`) for non-`eDP` monitors → `brightnessctl` on `omarchy-hw-display`; `off`/`on` = DPMS; OSD `brightness` — `XF86MonBrightnessUp/Down` (+5%/5%-), `Shift+` (100%/1%), `Alt+` (±1%) — **QEMU PARTIAL**: `Virtual-1` is treated as external → DDC → no bus → exit 1 silently; only `off`/`on` act.
- `omarchy-brightness-display-apple [--no-osd] [step]` — sudo `asdcontrol` — **QEMU NO** ("No Apple Display HID device found" exit 1 is the only path).
- `omarchy-brightness-display-ddc <monitor> [step]` — `ddcutil` with bus cache `$XDG_RUNTIME_DIR/omarchy-brightness-display-ddc/` — **QEMU PARTIAL**: exit 1, caches "unavailable" 60 s.
- `omarchy-brightness-keyboard [--no-osd] <up|down|cycle|off|restore>` — `/sys/class/leds/*kbd_backlight*`; "No keyboard backlight device found" exit 1 — `XF86KbdBrightnessUp/Down`, `XF86KbdLightOnOff` — **QEMU PARTIAL** (error only).
- `omarchy-brightness-keyboard-mute <on|off>` — `platform::micmute` LED; silent no-op without it — called by `audio-input-mute` — **QEMU PARTIAL** (silent).

### Audio (`bin/omarchy-audio-*`, `docs/audio-tuning.md`)

- `omarchy-audio-input-mute` — `wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle`, OSD "Microphone muted/on", drives micmute LED — `XF86AudioMicMute` — **QEMU PARTIAL**: no source → wpctl fails → always OSD "Microphone on".
- `omarchy-audio-input-set-default <node-id> <source>` / `omarchy-audio-output-set-default <node-id> <sink>` — `wpctl set-default` + `pactl` + move streams (skips EasyEffects); usage exit 1 without both args — used by panels/switcher — **QEMU OK** (usage path; `auto_null` for output).
- `omarchy-audio-output-sink [sink]` — resolves a DSP/tuning sink to the physical one; falls back to the sink itself — **QEMU OK** (prints `auto_null`).
- `omarchy-audio-output-switch` — rotates sinks with an available port, skipping the tuning-fronted one; OSD `volume-*` + description; "No audio devices found" exit 1 when none — `Shift+XF86AudioMute` — **QEMU PARTIAL**: one Dummy Output → OSD "Dummy Output" (or "No audio devices found" if `module-always-sink` is absent).
- `omarchy-audio-output-volume <raise|lower|mute-toggle|+N|-N>` — `pactl` on the resolved sink, 250 ms mute debounce, OSD `volume-high|volume-muted` + percent; "Could not resolve an audio sink to control." exit 1 — `XF86AudioRaise/LowerVolume` (±5), `Alt+` (±1), `XF86AudioMute` — **QEMU PARTIAL**: acts on `auto_null` (Dummy Output).
- `omarchy-audio-sink-availability` — `name\t0|1` lines for the shell — **QEMU OK** (`auto_null\t1`).
- `omarchy-audio-source-switch [next|previous]` — `omarchy-shell media sourceSwitch[Previous]`; usage exit 1 — `Shift+XF86AudioPause/Play` — **QEMU PARTIAL** (no players).
- `omarchy-audio-tuning <on|off|status|match|fronted-sink> [--force]` — data-driven laptop speaker tunings under `default/audio/tunings/`; `status` prints Installed/Host service/Tuning sink/Default sink/Matches; `on` → "No speaker tuning matches this laptop." (exit 0) when nothing matches; `off` → "No speaker tuning installed."; bad verb → usage exit 2 — CLI — **QEMU PARTIAL** (all no-match paths).
- Panels: Audio `Super+Ctrl+A` (`omarchy.audio`).

### Network and DNS (`bin/omarchy-network-*`, `bin/omarchy-dns`)

- `omarchy-network-status [--verbose]` — `ethernet\t<dev>\t\t` / `wifi\t<ssid>\t<signal>\t<freq>` / `disconnected`; `--verbose` prints `iface ip prefix gateway rx_bytes tx_bytes type speed duplex router_ping_ms internet_ping_ms`; bad arg → usage exit 2 — Network panel `Super+Ctrl+W`; gates Setup→Network→QR Code (`when wifi*`) — **QEMU OK** (ethernet on the NAT NIC, 10.0.2.15/24 via 10.0.2.2; `internet_ping_ms` empty since ICMP is blocked).
- `omarchy-network-band [auto|2.4|5|6]` — shows/pins Wi-Fi band; "Error: no connected Wi-Fi device." exit 1; bad arg → usage — CLI — **QEMU PARTIAL** (no Wi-Fi).
- `omarchy-network-password <interface>` — prints PSK/WEP; "No active Wi-Fi connection", "This network has no password", "Enterprise Wi-Fi has no shareable password" (all exit 1) — Wi-Fi share card — **QEMU PARTIAL** (negatives).
- `omarchy-network-qr [--meta] [interface]` — `WIFI:` QR matrix as 0/1 rows; "No active Wi-Fi connection" exit 1 — `omarchy.wifiqr` panel via Setup→Network→QR Code (hidden on wired) — **QEMU PARTIAL** (negative).
- `omarchy-network-speedtest <down|up>` — fast.com endpoints, 8 parallel curl, prints Mbit/s once a second; "No active network interface", "Failed to fetch speed test endpoints" (exit 1); usage exit 2 — Trigger→Speed Test→Network Speed Test (`omarchy.speedtest` panel with dials) — **QEMU OK + NET** (tens of MB).
- `omarchy-dns [Cloudflare|Google|DHCP|Custom]` — no arg prints provider (from `/etc/NetworkManager/conf.d/20-omarchy-dns.conf` then `/etc/systemd/resolved.conf`); setting re-execs via `sudo /usr/bin/omarchy-dns` (passwordless when `etc/sudoers.d/omarchy-dns` is installed and a terminal exists) or `pkexec` (polkit dialog) otherwise; writes NM global-dns + per-connection DNS + `resolved.conf`, reloads both; `Custom` prompts on stdin; bad provider → usage exit 1 — Setup→Network→DNS→{DHCP,Cloudflare,Google,Custom} (✓ on the current one; Custom opens a floating terminal) — **QEMU OK** (NET to prove resolution still works).

### Bluetooth (`bin/omarchy-bluetooth-*`)

- `omarchy-bluetooth-power <on|off|toggle|is-on>` — rfkill soft block is the persisted state; `on` = unblock, wait 2 s (`OMARCHY_BLUETOOTH_POWER_WAIT_SECONDS`), then `bluetoothctl power on`, "adapter did not come up" exit 1 — Bluetooth panel `Super+Ctrl+B` — **QEMU PARTIAL**: no adapter → `on` fails, `off` succeeds, `is-on` exit 1.
- `omarchy-bluetooth-device <pair|connect|disconnect|forget> <MAC>` — bluetoothctl with timeouts, powers on first; bad verb/MAC → usage exit 1 — panel — **QEMU PARTIAL** (usage + "No default controller" paths).

### Weather (`bin/omarchy-weather-*`)

- `omarchy-weather-location [--set <name> [lat,lon] | --clear]` — `~/.local/state/omarchy/settings/weather.json`; no arg prints stored name or IP-detected city (wttr.in); "Invalid coordinates: X (expected lat,lon)" exit 1; bad flag → usage exit 1 — CLI; weather bar widget/panel `Super+Ctrl+Alt+W` — **QEMU OK (NET for detection)**.
- `omarchy-weather-status` — `"<Place>  ·  Temp X  ·  Wind Y"` or "Weather unavailable" exit 1 — **QEMU OK + NET**.
- `omarchy-weather-icon` — condition glyph day/night from wttr.in j1 — **QEMU OK + NET**.

### Hardware detection (`bin/omarchy-hw-*`) — what each answers inside this QEMU guest

All are exit-code predicates unless noted; they gate `when:` rows in the menu. Expected in the q35/virtio-vga guest (DMI vendor `QEMU`, product `Standard PC (Q35 + ICH9, 2009)`, chassis type 1, no lid, no backlight, no USB devices except the QEMU tablet/keyboard, one virtio VGA, no NVIDIA, no audio PCI function, one DRM connector `Virtual-1`):

- `omarchy-hw-asus-expertbook-b9406` — `hw-match B9406 && hw-intel-ptl` — **false**.
- `omarchy-hw-asus-rog` — `sys_vendor == "ASUSTeK COMPUTER INC."` and `ROG` in `product_family` — **false**.
- `omarchy-hw-asus-zenbook-ux5406aa` — `hw-match ux5406aa && hw-intel-ptl` — **false**.
- `omarchy-hw-clamshell` (hidden) — `hw-laptop-closed && hw-external-monitors` — **false**.
- `omarchy-hw-dell-xps13-sidecar-amps` — `hw-match DX13260` + SKU `0E53` (`OMARCHY_DMI_PRODUCT_SKU`) — **false**.
- `omarchy-hw-dell-xps-haptic-touchpad` — `hw-match XPS` + `/sys/bus/i2c/devices/i2c-VEN_06CB:00` — **false**.
- `omarchy-hw-dell-xps-oled` — `hw-match XPS && hw-intel-ptl` + eDP EDID vendor `30e4` — **false**.
- `omarchy-hw-display` — first `/sys/class/backlight` device with a preference order (`OMARCHY_BACKLIGHT_PATH`), prints the name — **exit 1, prints nothing**.
- `omarchy-hw-elgato-camlink-4k` — USB product string "Cam Link 4K" — **false**.
- `omarchy-hw-external-monitors` — any connected non-`eDP|LVDS|DSI` DRM connector (`OMARCHY_DRM_PATH`) — **TRUE** (`card0-Virtual-1` is "connected"). Quirk: the VM's only screen reads as "external".
- `omarchy-hw-fingerprint` (hidden) — USB product string (`fingerprint|biometric|elan:arm-m4|fpc `) or vendor-id list without a kernel driver (`OMARCHY_USB_DEVICES_PATH`) — **false** → Setup→Security→Fingerprint hidden.
- `omarchy-hw-framework16` — `sys_vendor == Framework` + `hw-match "Laptop 16"` — **false**.
- `omarchy-hw-hybrid-gpu` — `supergfxctl -s` (1 s timeout) or lspci `VGA|3D|Display` count ≥ 2 — **false** (one virtio VGA, no supergfxctl).
- `omarchy-hw-intel` — `/proc/cpuinfo vendor_id == GenuineIntel` — **host-dependent** (`-cpu host`): true on an Intel host, false on AMD.
- `omarchy-hw-intel-ptl` — lspci display device contains "panther lake" — **false**.
- `omarchy-hw-intel-sof` — lspci Intel audio controller — **false** (no audio PCI function).
- `omarchy-hw-laptop` — ACPI lid or DMI chassis 8/9/10/14/30/31/32 — **false** (chassis 1) → hides Laptop Display, Mirror Display, Battery Percentage rows.
- `omarchy-hw-laptop-closed` (hidden) — lid state "closed" — **false**.
- `omarchy-hw-match <pattern>` — case-insensitive grep on `product_name`/`product_family` — `match "Standard PC"` **true**, `match XPS` **false**.
- `omarchy-hw-nvidia` — PCI vendor 0x10de class 0x03* (`OMARCHY_PCI_DEVICES_PATH`) — **false**.
- `omarchy-hw-nvidia-gsp` — NVIDIA device id ≥ 0x1e00 — **false**.
- `omarchy-hw-nvidia-without-gsp` — NVIDIA device id in [0x1340, 0x1e00) — **false**.
- `omarchy-hw-recover-internal-monitor` — removes `internal-monitor-disable.lua` when no external monitor — **no-op, exit 0**.
- `omarchy-hw-surface` — `sys_vendor == "Microsoft Corporation"` + `hw-match Surface` — **false**.
- `omarchy-hw-touchpad` — `hyprctl devices` mice named `touchpad|trackpad`, prints the name — **empty, exit 1** (the QEMU USB Tablet enumerates as a mouse) → Trigger→Hardware→Touchpad hidden.
- `omarchy-hw-touchscreen` — `hyprctl devices` `.touch[]`/`.tablets[]`, prints the name — **empty, exit 1** (udev classes the absolute-axis USB tablet with buttons as a mouse, so `.tablets` is empty; verify with `hyprctl devices -j | jq '.tablets,.touch'`) → Touchscreen row hidden.
- `omarchy-hw-vulkan` — any `/usr/share/vulkan/icd.d/*.json` — **likely true** (mesa ICDs are installed); report the actual answer.
- `omarchy-hw-webcam` — non-empty `omarchy-capture-webcam-list` — **false** → the webcam screenrecord row is hidden.

### Plugins (`bin/omarchy-plugin-*`)

- `omarchy-plugin-list [--json]` — table `ID STATE SOURCE KINDS NAME` from `omarchy-shell shell listPlugins`; bad option exit 1 — CLI — **QEMU OK**.
- `omarchy-plugin-catalog` (hidden) — JSON of every first-party and `~/.config/omarchy/plugins/*/manifest.json` — **QEMU OK**.
- `omarchy-plugin-enable <id> [section] [--section S] [--index N] [--before ID|--after ID]` — `enablePlugin` IPC; "plugin 'X' is not known; run: omarchy-shell shell rescanPlugins"; "'X' is a bar; it replaces the bar in use rather than taking a place in one" when placement is given for a `bar` kind; prints "Enabled X" / "Enabled and moved X" / "Now using X as the bar" — Setup→Plugins→Enable Plugin (picker) — **QEMU OK**.
- `omarchy-plugin-disable <id>` — `setPluginEnabled false`; not-known error — Setup→Plugins→Disable Plugin — **QEMU OK**.
- `omarchy-plugin-add [git-url] [--enable] [--yes]` — `omarchy-git-url-check` first (refuses `-…`, `helper::…`, non-allowlisted schemes; allows ssh/git/http/https/ftp/ftps/file), warning + `gum confirm` (or `--yes`), `git clone` to `.add.tmp.$$`, `omarchy-plugin-validate`, duplicate-id check ("plugin id 'X' is already used by …"), move to `~/.config/omarchy/plugins/<id>`, `rescanPlugins`, optional enable with bar-section `gum choose` — Setup→Plugins→Add Plugin (floating terminal, prompts for the URL) — **QEMU OK with `file://` (no NET); NET for https**.
- `omarchy-plugin-clone <omarchy.id> [--edit]` — copies a built-in into `~/.config/omarchy/plugins/<user>.<name>` with id `<user>.<name>`, name "My <Name>", `omarchy.clonedFrom`; enables it; toast "Editing Cloned Plugin"; "unknown built-in plugin: X"; "… already exists" — Setup→Plugins→Clone Plugin — **QEMU OK**.
- `omarchy-plugin-remove [id] [--yes]` — picker when no id; confirm text differs for symlink / git checkout ("Delete 'X'? Its git repo remains upstream.") / plain dir ("… The folder will be backed up." → `.X.bak.<ts>`); disables first; "Restored <clonedFrom>." — Setup→Plugins→Remove Plugin (`when` any user manifest exists) — **QEMU OK**.
- `omarchy-plugin-update [id] [--yes]` — fetch, diff, ff-merge, validate, roll back; "plugin 'X' is not a git checkout, so there is nothing to pull from"; "No git-managed plugins installed." — CLI — **QEMU OK (NET for a remote)**.
- `omarchy-plugin-validate <folder>` — manifest schema: `schemaVersion == 1` (number), `id name version kinds entryPoints`, id regex and not `omarchy.*`, non-empty kinds, relative existing entry points, kind→entryPoint table (`bar:bar`, `bar-widget:barWidget`, `menu:menu`, `overlay:overlay`, `panel:panel`, `service:service`), `barWidget.defaultSection` ∈ left/center/right, no symlinks — CLI — **QEMU OK**.

### Monitor / display

- `omarchy-monitor-state` — 8 lines for the Display panel: brightness (empty here), internal name, external name (`Virtual-1`), enabled internal, mirror, focused, scale, JSON of monitors — **QEMU OK**.
- `omarchy-display-text-size [9..20|reset]` — one knob: `[font] base-size` in `~/.config/omarchy/shell.toml` (shell text reflows live), GTK `text-scaling-factor`, terminal font pt (alacritty/kitty/ghostty/foot, live-reload signals); no arg prints all three; out-of-range → "Size must be an integer between 9 and 20 (px)." exit 1 — CLI — **QEMU OK**.
- Display panel `Super+Ctrl+D` (`omarchy.monitor`) — brightness slider hidden/`n/a`, scale stepper.

## Observations

1. **Every toggle is a flag file.** Feature toggles live in `~/.local/state/omarchy/toggles/<name>` (named for the *off* state: `bar-off`, `screensaver-off`, `suspend-off`, `crash-capture-off`), Hyprland config toggles in `~/.local/state/omarchy/toggles/hypr/<flag>.lua` (a copy of `default/hypr/toggles/<flag>.lua`, re-sourced on every `hyprctl reload`), stay-awake in `~/.local/state/omarchy/indicators/stay-awake`, workspace layouts in `~/.local/state/omarchy/workspace-layouts/<id>.lua`. `omarchy-toggle-enabled <flag>` / `omarchy-hyprland-toggle-enabled <flag>` give the exit code; `ls` of those dirs is the universal textual proof. All survive reboot; a test that leaves one set must undo it.
2. **Bar indicators are the visible proof for nightlight, stay-awake, DND, screen recording, reminders, dictation.** They sit in the centre section immediately left of the clock; inactive ones are hidden and only fade in on hover. So "toggle X and the 󰔎/󰅶/󰂛/󰻂 glyph appears next to the clock" is the pass criterion, and "hover the area left of the clock" is how a driver clicks one off.
3. **QEMU's single screen reads as an *external* monitor.** `Virtual-1` is not `eDP|LVDS|DSI`, so `omarchy-hw-external-monitors` and `omarchy-hyprland-monitor-external-active` are true, `omarchy-hyprland-monitor-laptop` is empty, and `omarchy-brightness-display` goes down the DDC path (fails silently, exit 1, no OSD). `omarchy-hw-laptop` is false (chassis 1, no lid), so Laptop Display / Mirror Display / Battery Percentage rows and the clamshell poll never appear. The touchpad/touchscreen rows are hidden because the QEMU USB Tablet enumerates as a plain mouse.
4. **Default resolution is 1280x800** (virtio-vga default `xres/yres`) unless the harness sets otherwise. Clean scales at that mode: 1, 1.25, 1.6, 2, 3→3.2, 4; `omarchy-hyprland-window-pop`'s default 1300x900 floating size overflows it (pass `800 500`). At scale 2 the logical desktop is 640x400 — usable but cramped; always step back down.
5. **Audio exists as a Dummy Output.** pipewire-pulse's `module-always-sink` creates `auto_null` ("Dummy Output") when no ALSA sink exists, so volume keys/OSD and the audio panel work against it; `omarchy-audio-output-switch` shows "Dummy Output" (not "No audio devices found") unless that module is absent; there is no source, so `omarchy-audio-input-mute` always reports "Microphone on". `omarchy-audio-tuning` never matches (DMI is QEMU) — all its output is the graceful "nothing ships for this laptop" set.
6. **Nightlight is visible in screendumps.** Hyprland applies hyprsunset's CTM in its own render pass, so a QEMU screendump after `Super+Ctrl+N` is visibly orange. hyprsunset is *not* running on a stock desktop; the toggle starts it (`setsid uwsm-app -- hyprsunset`) and re-sends the temperature up to 10×. `omarchy-restart-hyprsunset` kills and relaunches it, which drops the temperature back to the identity profile — i.e. restarting hyprsunset silently turns nightlight off (expected, and a good proof of the restart).
7. **Idle timings are live-reloaded** from `~/.config/omarchy/shell.json` (`idle.screensaver` 150 s, `idle.lock` 300 s default). The stock disk has no user `shell.json`, and the file is **replace-not-merge** (01-FACTS [32]): a minimal `{"version":1,"idle":…}` swaps the bar to the builtin minimal layout. To shorten idle, first `cp $OMARCHY_PATH/config/omarchy/shell.json ~/.config/omarchy/shell.json`, then edit `.idle.screensaver` in place with `jq`; `rm` the file afterwards to return to defaults. QEMU `get-image` is not guest input and does not reset idle; mouse moves and keys do. The default terminal on the disk is **foot**, which the screensaver supports (toast "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" otherwise); any key exits it.
8. **Screenshot picker is keyboard-drivable**: with slurp up, `Return` captures the window under the cursor, `Ctrl+Return` the whole screen, `Tab`/arrows move the cursor to the next window, `Esc`/`Print` cancels (no file). A bare click snaps to the rectangle under it. The screen is frozen by `hyprpicker -r -z` during the pick, so a screenshot *of the picker* looks like the desktop plus a dimmed selection overlay.
9. **Screen recording in the VM is the software path.** `gpu-screen-recorder -k auto … -fallback-cpu-encoding yes` has no VAAPI/NVENC → CPU x264; its default kms capture backend needs DRM DMA-BUF export from virtio-gpu and may fail to start (the script then never writes `RECORDING_FILE` and no indicator appears). Always run with `OMARCHY_SCREENRECORD_DEBUG=true` so `$XDG_RUNTIME_DIR/omarchy-screenrecord.log` explains a failure; `OMARCHY_SCREENRECORD_USE_PORTAL=true` is the alternative backend. `~/Videos` must already exist (xdg-user-dirs creates it on a stock install; otherwise a critical toast "Screen recording directory does not exist").
10. **Notifications**: the shell is the daemon (no dunst/mako). Toasts stack top-right; low 5 s, normal 8 s, critical until dismissed. `omarchy-notification-send` defaults to app `omarchy-action` + low, which **punches through DND**; to prove DND you need a third-party sender (`notify-send -a demo …`, normal urgency) which is silenced into history, while `notify-send -u critical …` (app `notify-send`) still shows. History (`Super+Shift+Alt+,`) replays the newest ten. Screenshot/recording toasts carry an `--exec` click command (tensaku / mpv); `Super+Alt+,` invokes the last one.
11. **Clipboard history** captures via `wl-paste --watch` (text and image/png); `wl-copy` from a terminal is captured too, so "copy two things" is `printf first | wl-copy; printf second | wl-copy`. The panel lists newest first; `Return` pastes with a synthetic `Shift+Insert` into the window that regains focus (terminals paste on Shift+Insert), `Shift+Return` only copies. Sensitive copies (`wl-copy --sensitive`, e.g. the QR decoder) are deliberately not recorded.
12. **DNS switching is root work without a visible prompt** when `etc/sudoers.d/omarchy-dns` is installed (`sudo -n -l -l /usr/bin/omarchy-dns <Provider>` shows `!authenticate`); a minted 4.0.2 disk may predate that file, in which case the menu action runs through `pkexec` and the shell's polkit dialog asks for `prime`. Either is a pass as long as `omarchy-dns` then reports the new provider. `Custom` always opens a floating terminal (stdin prompt). Changing DNS on the NAT does not break resolution (slirp forwards UDP/TCP 53 to any server).
13. **Plugins never need network**: `omarchy-plugin-add file:///path/to/repo --yes` is a full add (the `file` transport is allowlisted), `omarchy-plugin-clone omarchy.clock` creates a real third-party plugin with a visible bar effect ("My Clock" replaces the clock), and `omarchy-plugin-validate` works on any folder. `omarchy-plugin-add` and `-remove` refuse to proceed without a TTY unless `--yes` (the menu launches them in a floating terminal with `gum confirm`). The URL guard rejects `ext::…`, `-…`, and unknown schemes *before* cloning with a distinct message each.
14. **`omarchy-shell` semantics**: IPC failures print "omarchy-shell is not running" (qs exit ≠ 0), "… not responding" (2 s timeout), "Target not found." / "Function not found." (shell replied) — all exit 1; `-q` turns every failure into a silent exit 0 (used by the toggles so they work without a shell). `omarchy-restart-shell` refuses while locked with a live locker, and takes a few seconds (kill loop + relaunch + ping polling); the bar disappears and returns.
15. **What the driver can and cannot press** (01-FACTS): `<PRINT>`, `<A-PRINT>`, `<M-C-PRINT>`, `<INSERT>`, `<CAPSLOCK>`, `<alt_r>` and punctuation chords `<M-,>` `<M-/>` `<M-->` `<M-=>` `<M-`>` all work, so Print-based capture and the comma/slash/minus binds are drivable. XF86 media/brightness keys are **not** sendable; the in-guest workaround is `wtype -k XF86AudioRaiseVolume` typed in a terminal, and the bound script (`omarchy-audio-output-volume raise`, `omarchy-brightness-display +5%`) is the fallback. Nerd-Font glyphs cannot be typed: use ASCII headlines and `-i` icons. Exit codes are invisible on a screenshot: every negative step ends `; echo "exit=$?"`. Default terminal is **foot** (kitty/alacritty/ghostty are not installed), so terminal-config helpers have nothing to reload.
16. **Two menu entry points** for toggles: `Super+Ctrl+O` opens Trigger→Toggle directly; `Super+Ctrl+H` Trigger→Hardware; `Super+Ctrl+C` Trigger→Capture; `Super+Escape` System. Rows gated by `when:` are simply absent (not greyed): Laptop Display, Mirror Display, Hybrid GPU, Touchpad(+Haptics), Touchscreen, Battery Percentage, webcam screenrecord, Wi-Fi QR Code, Fingerprint, Remove Plugin (until a user plugin exists), Stop Screenrecording (until recording). Rows with `checked:` show a ✓ (DNS provider).
17. **`Ctrl+Alt+Delete` is bound to close-all** (`tiling.lua`), not to reboot; it also jumps to workspace 1. QEMU passes the chord to the guest.
17a. **Menu guards paint from the previous evaluation** (01-FACTS [22]): after a toggle that adds/removes a row or moves a ✓ (suspend, DNS provider, Stop Screenrecording, Remove Plugin), reopen the menu twice before asserting. **DND has no toast**, only the indicator. `Super+Ctrl+Alt+B` sends a toast with an empty headline on a battery-less machine (known defect, 01-FACTS [10]).
18. **Window-width save/restore** keys windows by class+workspace; restore on a workspace with no saved width is the negative path with its own toast, and restore only resizes tiled windows (a lone tiled window cannot change width — use two).
19. **`omarchy-toggle-hybrid-gpu` must not be run in the VM**: with `supergfxctl` missing it runs `omarchy-pkg-add supergfxctl` and enables `supergfxd`. Only the hidden-menu-row negative is safe.
20. **Sudoless Docker** sets `reboot-required` state and offers a reboot; declining leaves the group change pending — fine on a discarded disk, but `omarchy-sudo-docker --configured` flips immediately, so Setup→Security shows the row and Remove→Security shows it after enabling.
21. **Brightness/DPMS**: `omarchy-brightness-display off` blanks the VM screen (DPMS) and `on` restores it; Hyprland also wakes on any key (`key_press_enables_dpms`). The screendump while off may be black or stale — report what it is.
22. Version skew: `omarchy-hyprland-reload-guard`, `omarchy-monitor-state`, `omarchy-display-text-size`, `omarchy-bar put`, `omarchy-network-band/speedtest`, `omarchy-audio-tuning`, `omarchy-capture-webcam-resize` are HEAD features and may be absent on the 4.0.2 disk (`command not found`). Report the absence and skip; do not fail the whole test on it.

## Proposed tests

Conventions used in every block (01-FACTS): the terminal is `Super+Enter` (foot); the bar is at the top, the indicators sit just left of the clock and are hidden until active; toasts stack top-right; the OSD is a small pill overlay; every negative command ends `; echo "exit=$?"` because exit codes are invisible otherwise; long output goes `… 2>&1 | sudo tee /dev/ttyS0` and is read with `get-serial` (sudo password `prime`); menus repaint their guards from the previous evaluation, so reopen a menu twice before asserting a row moved; flags under `~/.local/state/omarchy/` persist, so every test undoes what it set. `Super` is `<M-…>`; `<PRINT>`, `<M-,>`, `<M-/>`, `<M-->` are sendable; XF86 keys are typed in-guest as `wtype -k XF86AudioRaiseVolume`.

### toggle-nightlight-on-off   [VM-OK]
description: Night light warms the screen and lights the bar indicator from the hotkey, and the indicator click turns it back off. Protects the hyprsunset start-on-demand path and the shell's indicator refresh.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot of the plain desktop as the colour reference; note there is no glyph left of the clock.
  * Press Super+Ctrl+N.
  ** Within ~3 s the whole screen takes on a warm orange tint and a small glyph lights up just left of the clock (the night-light indicator).
  * Open a terminal with Super+Enter and run `omarchy-toggle-nightlight --status` → `{"enabled":true,"temperature":4000}`.
  * Move the mouse over the lit indicator and click it with the left button.
  ** The tint goes away and the glyph fades out; `omarchy-toggle-nightlight --status` now says `"enabled":false` with temperature 6500.
  * Press Super+Ctrl+N twice more (on, then off) and confirm the screen ends untinted, exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare screenshots side by side: white terminal text and the wallpaper are unmistakably orange when night light is on.
  * The indicator only appears while active; when off, hovering that spot fades it in dimmed — click there anyway if you need the mouse path.
  * hyprsunset is not running on a fresh desktop; the first toggle starts it, so allow up to 3 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: neutral desktop → orange-tinted desktop with the indicator lit → neutral again with no indicator, plus the two `--status` lines (enabled true/4000, enabled false/6500)
  ** The indicator was switched off with a mouse click, not the hotkey
  * If unsuccessful
  ** Screenshot of an untinted screen after the toggle together with `--status` and `pgrep -x hyprsunset` output
covers: bin/omarchy-toggle-nightlight, shell/plugins/bar/indicators/NightLight.qml, shell/plugins/services/nightlight/Service.qml, default/hypr/bindings/utilities.lua (SUPER+CTRL+N), test/shell.d/nightlight-test.sh, manual/13-toggles-idle-screensaver.md

### toggle-stay-awake-indicator   [VM-OK]
description: Stay Awake can be switched on by hotkey and off from the Toggle menu, showing the coffee-cup indicator while on and reporting its state on the CLI. Protects the idle-inhibit toggle a user flips before a talk.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `omarchy-toggle-idle status` → `{"enabled":false,…"tooltip":"Stay Awake"}`.
  * Press Super+Ctrl+I.
  ** A coffee-cup glyph appears left of the clock; `omarchy-toggle-idle status` → `"enabled":true` … `"Allow Idle Lock & Screensaver"`; `ls ~/.local/state/omarchy/indicators/` → `stay-awake`.
  * Press Super+Ctrl+O (Trigger → Toggle) and click the "Stay Awake" row with the mouse.
  ** The glyph disappears, `status` is back to `"enabled":false`, the `stay-awake` file is gone.
  * Negative: `omarchy-toggle-idle frob; echo "exit=$?"` → a Usage line and `exit=1`.
  * Confirm the bar shows no indicator, as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Toggle submenu row reads "Stay Awake" with a coffee-cup icon; clicking a row closes the menu.
  * If the indicator does not appear, hover left of the clock: inactive indicators are hidden and fade in dimmed on hover — a dimmed one means the toggle did not take.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the bar with and without the coffee-cup glyph, the two status JSON lines, the `ls` output, and the usage error with `exit=1`
  ** The off step was done with the mouse on the menu row
  * If unsuccessful
  ** The status JSON that disagrees with the bar, or the crash dialog
covers: bin/omarchy-toggle-idle, shell/plugins/bar/indicators/StayAwake.qml, shell/plugins/services/idle/Service.qml, default/omarchy/omarchy-menu.jsonc (trigger.toggle.idle-lock), test/shell.d/idle-test.sh

### idle-screensaver-and-stay-awake   [VM-OK]
description: With a short idle timeout the screensaver appears after inactivity and any key dismisses it, and Stay Awake prevents it. Protects the idle service end to end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and run `mkdir -p ~/.config/omarchy && cp $OMARCHY_PATH/config/omarchy/shell.json ~/.config/omarchy/shell.json && jq '.idle.screensaver=20 | .idle.lock=600' ~/.config/omarchy/shell.json > /tmp/s.json && mv /tmp/s.json ~/.config/omarchy/shell.json`.
  ** The bar must look exactly as before (the file is a full copy, not a fragment).
  * Do not touch mouse or keyboard for 30 s; take a screenshot every 5 s.
  ** By ~25 s a full-screen black window with animated text (the Omarchy screensaver) covers the screen.
  * Press Space once. The screensaver closes and the desktop with your terminal is back.
  * Press Super+Ctrl+I (Stay Awake on; coffee-cup indicator lit), then wait 35 s hands-off with screenshots every 5 s: the screensaver must NOT appear.
  * Press Super+Ctrl+I again (indicator off), then run `rm ~/.config/omarchy/shell.json` to restore the 150 s default.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `get-image` is not guest input and does not reset the idle timer; a mouse move or key does — do not move the pointer while waiting.
  * The screensaver is a foot terminal running ttfx; on 2 vCPU the animation may stutter, that is fine.
  * A toast "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" means the default terminal is not one of those — report it as a defect on a stock disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendump of the screensaver covering the screen, the restored desktop after Space, and the 35 s series with the coffee-cup indicator lit and no screensaver
  ** The bar unchanged after writing shell.json
  * If unsuccessful
  ** The last screenshots of the idle wait, any toast, and `journalctl --user -b | tail -40 | sudo tee /dev/ttyS0` read with get-serial
covers: shell/plugins/services/idle/Service.qml, bin/omarchy-launch-screensaver, bin/omarchy-screensaver, bin/omarchy-toggle-idle, config/omarchy/shell.json (idle block), manual/13-toggles-idle-screensaver.md

### toggle-screensaver-off-vs-force   [VM-OK]
description: The screensaver toggle disables the idle screensaver while the System menu entry still force-launches it, and toggling back re-enables both. Protects the `screensaver-off` flag and its `force` bypass.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+O (Trigger → Toggle) and click "Screensaver".
  ** Toast "Screensaver disabled".
  * Open a terminal: `omarchy-launch-screensaver; echo "exit=$?"` → nothing opens, `exit=1`.
  * Press Super+Escape (System menu) and click "Screensaver".
  ** The screensaver still opens (force path). Press Space to leave it.
  * Trigger → Toggle → "Screensaver" again → toast "Screensaver enabled".
  * `omarchy-launch-screensaver` → the screensaver opens; press Space to leave it. The desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Screensaver" is the first row of the System menu.
  * The screensaver appears within ~2 s; a black screen with moving text is it. Any key exits.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of both toasts, the terminal with `exit=1` and nothing opened, the forced screensaver, and the screensaver after re-enabling
  * If unsuccessful
  ** The toast text and exit code that disagree, or the "only runs in …" toast
covers: bin/omarchy-toggle-screensaver, bin/omarchy-toggle, bin/omarchy-toggle-enabled, bin/omarchy-launch-screensaver, default/omarchy/omarchy-menu.jsonc (system.screensaver, trigger.toggle.screensaver)

### toggle-bar-hide-show   [VM-OK]
description: The bar can be hidden and restored without restarting the shell, from the hotkey, the Toggle menu and the CLI. Protects the `bar-off` flag and the shell's `syncHidden` nudge.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Space. The top bar vanishes and windows reclaim the space.
  * Press Super+Shift+Space again. The bar returns.
  * Open a terminal: `omarchy-toggle-bar off` → the bar hides (the flag is named for the off state); `omarchy-toggle-bar on` → shown; `omarchy-toggle-bar on; omarchy-toggle-bar on` → still shown (idempotent).
  * Press Super+Space, click Trigger → Toggle → "Menu Bar" with the mouse → hidden; repeat → shown.
  * Confirm the bar is visible at the end and `ls ~/.local/state/omarchy/toggles/` shows no `bar-off`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * With the bar hidden the Omarchy Menu still opens on Super+Space.
  * Wait up to 5 s for the bar to reappear; a bar that stays hidden while `bar-off` is absent is the "stranded off screen" defect the script guards against.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps without and with the bar after each method, and the final `ls` without `bar-off`
  * If unsuccessful
  ** A screenshot where the flag and the bar disagree, plus `omarchy-shell omarchy.bar syncHidden` output
covers: bin/omarchy-toggle-bar, bin/omarchy-toggle, bin/omarchy-toggle-enabled, default/hypr/bindings/utilities.lua (bind_toggle bar), test/shell.d/toggle-test.sh

### toggle-fullscreen-desktop   [VM-OK]
description: Full-screen desktop hides the bar and removes gaps and borders in one step, pulls a half-applied state into line, and restores everything on the way back. Protects the combined toggle.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals (Super+Enter twice) so the gaps and borders between them are visible.
  * Press Super+Ctrl+Alt+F → bar gone, no gaps, no borders, no rounded corners.
  * Press Super+Ctrl+Alt+F → bar and gaps back.
  * Half state: press Super+Shift+Backspace (gaps off only, bar still visible), then Super+Ctrl+Alt+F.
  ** Because only one half was on, the desktop goes fully full-screen (the bar hides too) rather than back.
  * In a terminal: `omarchy-toggle-fullscreen-desktop off` → bar and gaps restored; `omarchy-toggle-fullscreen-desktop sideways; echo "exit=$?"` → Usage, `exit=1`.
  * Close the terminals; the desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Super+Ctrl+Alt+F does nothing, check the Super+K keybindings list for "Toggle full screen desktop" — the bind is HEAD-only and may be absent on the 4.0.2 disk; then use `omarchy-toggle-fullscreen-desktop` and report "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: gapped desktop → bar-less gapless → restored → gapless-with-bar → bar-less gapless → restored; the usage error with `exit=1`
  * If unsuccessful
  ** The screenshot where bar and gaps disagree, plus `ls ~/.local/state/omarchy/toggles/ ~/.local/state/omarchy/toggles/hypr/`
covers: bin/omarchy-toggle-fullscreen-desktop, bin/omarchy-hyprland-toggle, default/hypr/toggles/window-no-gaps.lua, test/shell.d/toggle-test.sh

### window-gaps-toggle   [VM-OK]
description: Window gaps and borders can be removed and restored globally, the setting survives a Hyprland reload, and an unknown flag is refused. Protects the Hyprland flag-file toggle mechanism.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals side by side.
  * Press Super+Shift+Backspace → gaps, borders and rounding disappear.
  * In a terminal: `ls ~/.local/state/omarchy/toggles/hypr/` → `window-no-gaps.lua`; then `hyprctl reload` → the gaps stay off (the flag is re-sourced).
  * Press Super+Space, click Trigger → Toggle → "Window Gaps" → gaps return; the file is gone.
  * Negative: `omarchy-hyprland-toggle nosuchflag on; echo "exit=$?"` → "Flag not found: nosuchflag", `exit=1`.
  * Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Gapless means the two terminals touch each other and the screen edges with no coloured border.
  * The menu row is "Window Gaps" in Trigger → Toggle.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps gapless and gapped, the `ls` showing the flag file present then absent, gaps still off after reload, the error with `exit=1`
  * If unsuccessful
  ** Screenshot after `hyprctl reload` if gaps came back while the flag file existed
covers: bin/omarchy-hyprland-window-gaps-toggle, bin/omarchy-hyprland-toggle, bin/omarchy-hyprland-toggle-enabled, default/hypr/toggles.lua, default/hypr/toggles/window-no-gaps.lua

### window-single-square-aspect-toggle   [VM-OK]
description: A lone tiled window is boxed to a square when the toggle is on, with a confirming toast, and widens again when it is off. Protects the `single-window-aspect-ratio` flag.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open one terminal; it fills the screen width.
  * Press Super+Ctrl+Backspace.
  ** Toast "Enable single-window square aspect ratio"; the terminal shrinks to a roughly square, centred tile.
  * Open a second terminal (Super+Enter): with two windows both tile normally. Close it with Super+W; the remaining one is square again.
  * Press Super+Space, click Trigger → Toggle → "1-Window Ratio" → toast "Disable single-window square aspect ratio"; the terminal is wide again.
  * Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On 1280x800 the square tile is about 740 px wide with wallpaper on both sides.
  * If the hotkey does nothing, check Super+K for "Toggle single-window square aspect" (HEAD-only) and use the menu row instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: wide terminal → square terminal with the enable toast → two tiled → wide again with the disable toast
  * If unsuccessful
  ** Screenshot showing no size change after the toast
covers: bin/omarchy-hyprland-window-single-square-aspect-toggle, default/hypr/toggles/single-window-aspect-ratio.lua, default/omarchy/omarchy-menu.jsonc (trigger.toggle.one-window-ratio)

### window-transparency-toggle   [VM-PARTIAL]
description: Super+Backspace toggles the focused window between the themed slight transparency and fully opaque. Only the visual delta is checked; it is subtle (default opacity 0.985/0.96), so the proof is a before/after over a bright wallpaper.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and press Super+T so it floats; drag it (Super+left-drag) over the brightest part of the wallpaper.
  * Screenshot: a hint of wallpaper shows through the terminal background.
  * Press Super+Backspace → screenshot: the terminal background is fully solid.
  * Press Super+Backspace again → the faint transparency returns.
  * Press Super+T to re-tile and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Zoom into the same region of both screenshots; the difference is a few percent of brightness.
  * Floating and dragging: `mouse drag --modifier super` from the window's centre.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two screendumps of the same window region, translucent then opaque, then translucent again
  * If unsuccessful
  ** Identical before/after screenshots
covers: bin/omarchy-hyprland-window-transparency-toggle, default/hypr/windows.lua (default-opacity), default/hypr/bindings/utilities.lua (SUPER+BACKSPACE)

### toggle-notification-silencing-dnd   [VM-OK]
description: Do-not-disturb silences third-party notifications into history while Omarchy's own action toasts and critical CLI alerts still show, with the bell indicator lit until it is switched off. Protects the DND rules.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `notify-send -a demo "Before DND" "visible"` → a toast top-right; let it expire (~8 s).
  * Press Super+Ctrl+, (comma).
  ** No toast (by design); a crossed-bell glyph lights up left of the clock.
  * `notify-send -a demo "Silenced one" "must not pop"` → NO toast appears.
  * `omarchy-notification-send "Action toast" "punches through"` → this toast appears; then `notify-send -u critical "Critical CLI" "punches through too"` → appears and stays; dismiss it with Super+, (comma).
  * Press Super+Shift+Alt+, → the history overlay lists "Silenced one"; press Escape.
  * Press Super+Ctrl+, → the bell glyph goes off; `notify-send -a demo "After DND"` pops again. The bar is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chords: `<M-C-,>` toggles DND, `<M-,>` dismisses the newest toast, `<M-S-A-,>` opens history.
  * Wait 2 s after each `notify-send` before the screenshot; a silenced one never appears, not even briefly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: first toast; lit bell; no toast after the silenced send; the action and critical toasts under DND; history listing "Silenced one"; final toast after DND off
  * If unsuccessful
  ** The screenshot where a silenced toast appeared or a punch-through one did not, plus `cat ~/.local/state/omarchy/notifications.json`
covers: bin/omarchy-toggle-notification-silencing, bin/omarchy-notification-send, shell/plugins/bar/indicators/Dnd.qml, docs/notifications.md (Silencing), default/hypr/bindings/utilities.lua (comma binds), test/shell.d/notifications-test.sh

### toggle-crash-capture   [VM-OK]
description: Crash capture can be switched off from the Toggle menu and back on from the CLI, stopping and starting the watcher service with a toast each way. Protects the flag/service coupling.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `systemctl --user is-active omarchy-crash-watch.service` → `active`.
  * Press Super+Ctrl+O and click "Crash Capture".
  ** Toast "Crash capture disabled"; `systemctl --user is-active omarchy-crash-watch.service` → `inactive`; `ls ~/.local/state/omarchy/toggles/` shows `crash-capture-off`.
  * `omarchy-toggle-crash-capture` → toast "Crash capture enabled"; the service is `active` again and the flag is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The toast glyph is a robot; the text is what matters.
  * `Unit omarchy-crash-watch.service could not be found` means the unit is missing on this disk — report that, not a toggle failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both toasts, `is-active` active → inactive → active, the flag file appearing and disappearing
  * If unsuccessful
  ** `systemctl --user status omarchy-crash-watch.service` output
covers: bin/omarchy-toggle-crash-capture, default/systemd/user/omarchy-crash-watch.service, default/omarchy/omarchy-menu.jsonc (trigger.toggle.crash-capture)

### toggle-suspend-hides-system-menu-entry   [VM-OK]
description: The suspend toggle removes and restores the Suspend row of the System menu with a confirming toast. Protects the `suspend-off` flag and the menu gate.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape: the System menu lists Screensaver, Lock, Suspend, Logout, Reboot, Shutdown. Screenshot, Escape.
  * Open a terminal: `omarchy-toggle-suspend` → toast "Suspend removed from system menu".
  * Press Super+Escape, Escape, Super+Escape again: "Suspend" is gone. Escape.
  * `omarchy-toggle-suspend` → toast "Suspend now available in system menu"; open the System menu twice more: Suspend is back. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Menu guards repaint from the previous evaluation, hence opening the menu twice before asserting.
  * Never click Suspend — the VM cannot be woken by the driver.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three System-menu screendumps: with Suspend, without, with again; both toasts
  * If unsuccessful
  ** The menu screenshot that still shows Suspend on the second reopen
covers: bin/omarchy-toggle-suspend, default/omarchy/omarchy-menu.jsonc (system.suspend when)
dedupe-with: test_def/12-manual-config.md (toggle-suspend-hides-system-menu-entry)

### toggle-generic-flag-and-bad-action   [VM-OK]
description: The generic toggle creates and removes a flag file, is idempotent, refuses an unknown action, and `omarchy-toggle-enabled` answers by exit code. Protects the primitive every named toggle builds on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and run `omarchy-toggle demo-flag on; omarchy-toggle-enabled demo-flag; echo "exit=$?"` → `exit=0`.
  * `omarchy-toggle demo-flag on; ls ~/.local/state/omarchy/toggles/` → still exactly one `demo-flag` entry.
  * `omarchy-toggle demo-flag; omarchy-toggle-enabled demo-flag; echo "exit=$?"` → `exit=1` (toggled off).
  * `omarchy-toggle demo-flag sideways; echo "exit=$?"` → Usage, `exit=1`; `omarchy-toggle; echo "exit=$?"` → Usage, `exit=1`.
  * `ls ~/.local/state/omarchy/toggles/` → no `demo-flag`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The toggles directory may otherwise be empty or missing on a stock disk; `ls` printing nothing is fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with `exit=0`, the single-entry `ls`, `exit=1`, both usage errors, and the final empty listing
  * If unsuccessful
  ** The line whose exit code differs
covers: bin/omarchy-toggle, bin/omarchy-toggle-enabled, test/shell.d/toggle-test.sh

### sudoless-docker-enable-and-disable   [VM-OK]
description: Sudoless Docker is enabled from Setup → Security with a warning, confirmation and sudo, then disabled from Remove → Security, both declining the reboot. Protects the docker-group toggle and its menu gating.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `getent group docker` → the line does not contain `prime`.
  * Press Super+Space, click Setup → Security → "Sudoless Docker".
  ** A floating "Omarchy" terminal prints the root-equivalence warning and asks "Enable sudoless Docker? …" — pick Yes; sudo asks for a password: type `prime`; then "Sudoless Docker ENABLED…" and "Reboot now to apply?" — pick No; press Enter at the Done prompt.
  * `getent group docker` → now contains `prime`.
  * Super+Space twice: Setup → Security no longer lists "Sudoless Docker"; Remove → Security now does — click it.
  ** "Removing prime from the docker group…", "Sudoless Docker DISABLED…", "Reboot now to apply?" → No; Done.
  * `getent group docker` → no `prime`; Setup → Security shows the row again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right or Tab moves the highlight, Enter picks; the highlighted button is the selection.
  * Never answer Yes to the reboot. Menus repaint one step late: reopen twice before asserting a row moved.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the warning, the ENABLED and DISABLED messages, the declined reboot prompts, `getent group docker` with and without prime, and both menu states
  * If unsuccessful
  ** The floating terminal's error text and `id -nG`
covers: bin/omarchy-setup-security-sudoless-docker, bin/omarchy-remove-security-sudoless-docker, bin/omarchy-sudo-docker, default/omarchy/omarchy-menu.jsonc (setup.security.sudoless-docker, remove.security.sudoless-docker), test/shell.d/sudoless-docker-toggle-test.sh

### screenshot-print-click-window   [VM-OK]
description: Print freezes the screen, a single click snaps the shot to the window under the cursor, and the PNG lands in ~/Pictures, on the clipboard and in a clickable thumbnail toast. Protects the default screenshot path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and run `ls ~/Pictures` (may be empty or missing).
  * Press Print.
  ** The screen freezes and dims with a selection overlay; the cursor is a crosshair.
  * Click once (no drag) in the middle of the terminal window.
  ** Toast "Screenshot saved to clipboard and file" with a thumbnail and the hint "Edit with Super + Alt + , (or click this)".
  * In the terminal: `ls ~/Pictures` → one `screenshot-YYYY-MM-DD_HH-MM-SS.png`; `wl-paste --list-types` → includes `image/png`; `file ~/Pictures/screenshot-*` → PNG with dimensions close to the terminal window, not 1280 x 800.
  * Click the toast with the mouse → the Tensaku annotation editor opens with the shot. Close it with Super+W.
  * Press Super+Shift+F (file manager), open Pictures and see the thumbnail; close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If ~/Pictures did not exist you first get a toast "Created screenshot directory".
  * Nautilus renders oversized on this 1x display (GDK_SCALE=2 by design) — not a defect.
  * A second Print while the picker is up cancels it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: the frozen picker, the thumbnail toast, `ls ~/Pictures` with the new file, the `file` line with window-sized dimensions, Tensaku showing the shot, Nautilus showing the thumbnail
  * If unsuccessful
  ** Terminal errors from grim/slurp and `pgrep -a hyprpicker slurp`
covers: bin/omarchy-capture-screenshot, bin/omarchy-capture-region (smart, bare-click snap), bin/omarchy-notification-send (--image, --exec), default/hypr/bindings/utilities.lua (PRINT), test/shell.d/screenshot-sanity-test.sh, manual/12-screenshots-recording.md

### screenshot-region-drag-and-cancel   [VM-OK]
description: Dragging selects a free-form region, Escape cancels without writing a file, and pressing Print again dismisses a running picker. Protects the region and cancel paths.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and note `ls ~/Pictures | wc -l`.
  * Run `omarchy-capture-screenshot region` and drag with the mouse from about (0.2, 0.2) to (0.6, 0.6) of the screen.
  ** Toast "Screenshot saved to clipboard and file"; the count is +1; `file` on the newest PNG shows roughly 512 x 320.
  * Press Print, then Escape → no toast; the count is unchanged.
  * Press Print, then Print again → the picker closes; nothing saved.
  * Confirm the desktop is unfrozen and `pgrep -a hyprpicker slurp` prints nothing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `file ~/Pictures/$(ls -t ~/Pictures | head -1)` prints the newest file's dimensions.
  * Use `mouse drag` for the selection; the overlay draws the rectangle while dragging.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the drag rectangle, the toast, the `file` dimensions, and the unchanged counts after Escape and after the second Print
  * If unsuccessful
  ** A file written after a cancel, or a stuck frozen screen with `pgrep -a hyprpicker`
covers: bin/omarchy-capture-screenshot (region, pkill slurp), bin/omarchy-capture-region (region mode)

### screenshot-keyboard-picker   [VM-OK]
description: With the picker up, Return captures the highlighted window, Tab moves the highlight to the next window and Ctrl+Return grabs the whole screen — no mouse needed. Protects the slurp-layer keybinds.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals side by side; move the mouse over the LEFT one.
  * Press Print, then Return → toast; in the right terminal `file ~/Pictures/$(ls -t ~/Pictures | head -1)` shows the left window's size (about half the screen width).
  * Press Print, then Tab (the cursor jumps to the other window and the highlight follows), then Return → the newest PNG has the right window's size.
  * Press Print, then Ctrl+Return → the newest PNG is 1280 x 800.
  * Press Print, then Escape → nothing saved; close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The selection binds exist only while the picker is on screen; if Return does nothing, check the Super+K list for "Capture highlighted window" — the binds are HEAD-only and may be absent on 4.0.2 (report "absent on this build").
  * Screenshot right after Tab to catch the highlight moving.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three `file` outputs with left-window, right-window and full-screen dimensions, and a screendump of the highlight on the other window after Tab
  * If unsuccessful
  ** The dimensions that came out wrong
covers: bin/omarchy-capture-region (--take-window, --take-fullscreen, --select-window), default/hypr/bindings/utilities.lua (selection layer binds), manual/12-screenshots-recording.md (Driving the picker)

### screenshot-cli-modes   [VM-OK]
description: From the CLI, `fullscreen` needs no picker, `copy` leaves only a clipboard image and `save` only a file, and `windows` snaps to a monitor when the bar is clicked. Protects the argument matrix.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `wl-copy "plain text"; ls ~/Pictures | wc -l`.
  * `omarchy-capture-screenshot fullscreen` → the new path is printed immediately (no picker), a toast, count +1, `wl-paste --list-types` shows image/png.
  * `wl-copy "plain text"; omarchy-capture-screenshot fullscreen copy` → no path, no toast, count unchanged, but `wl-paste --list-types` shows image/png.
  * `wl-copy "plain text"; omarchy-capture-screenshot fullscreen save` → path printed, count +1, no toast, `wl-paste` still prints `plain text`.
  * `omarchy-capture-screenshot windows`, then click on the bar → the shot is 1280 x 800 (the monitor rectangle).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Take the screenshot within 5 s of each command to catch (or prove the absence of) the toast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps proving count and clipboard type after each mode as listed, and the `file` line for the windows-mode shot
  * If unsuccessful
  ** The mode whose side effect leaked (a toast in copy mode, an image in save mode)
covers: bin/omarchy-capture-screenshot (fullscreen|windows, slurp|copy|save), bin/omarchy-capture-region (windows, fullscreen)

### screenrecording-start-stop   [VM-PARTIAL]
description: Alt+Print starts a recording of a window (bar indicator lit), the second Alt+Print stops it and the MP4 lands in ~/Videos with a thumbnail toast. The VM has no GPU encoder so gpu-screen-recorder falls back to CPU x264; its kms capture may not start on virtio-gpu, and the debug log decides whether that is a defect or a VM limit.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `ls -d ~/Videos` (must exist; if not, report it and `mkdir ~/Videos`).
  * Press Alt+Print → the Screenrecord submenu opens (this is the user path; screenshot it, then Escape). Start from the terminal instead so the debug log is written: `OMARCHY_SCREENRECORD_DEBUG=true omarchy-capture-screenrecording` and click once on the terminal in the picker.
  ** Within ~5 s a recording glyph lights up left of the clock and `ls ~/Videos` shows a growing `screenrecording-….mp4`.
  * Type a few lines in the terminal for ~10 s.
  * Press Alt+Print (stops the running recording).
  ** The glyph goes off; a toast "Screen recording saved" with a thumbnail appears; `ls -l ~/Videos` shows the MP4 (size > 0) and no `-preview.png`/`-processed.mp4` leftovers.
  * Click the toast → mpv plays the clip; close it with Super+W.
  * Negative: `omarchy-capture-screenrecording --stop-recording; echo "exit=$?"` with nothing running → `exit=1`, no toast.
  * If the glyph never appeared: `cat $XDG_RUNTIME_DIR/omarchy-screenrecord.log | sudo tee /dev/ttyS0`, read it with get-serial, then try once with `OMARCHY_SCREENRECORD_USE_PORTAL=true omarchy-capture-screenrecording` from the terminal and stop with Alt+Print.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu row "With no audio" runs the same command without the debug variable; Alt+Print stops a recording whichever way it was started.
  * Encoding on 2 vCPU is slow; keep it to one window and 10–15 s. The toast can take ~10 s after stopping.
  * "Stop Screenrecording" also appears under Trigger → Capture → Screenrecord only while recording.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the lit recording glyph, the saved toast with thumbnail, `ls -l ~/Videos`, mpv playing, and `exit=1` for the stop-with-nothing-running case
  * If unsuccessful
  ** The serial dump of omarchy-screenrecord.log (gsr's stderr) and whether the portal variant behaved differently
covers: bin/omarchy-capture-screenrecording, bin/omarchy-capture-region (--match-monitor), shell/plugins/bar/indicators/ScreenRecording.qml, default/hypr/bindings/utilities.lua (ALT+PRINT), default/omarchy/omarchy-menu.jsonc (trigger.capture.screenrecord.*), test/shell.d/screenrecording-test.sh, manual/12-screenshots-recording.md

### screenrecording-webcam-absent   [VM-PARTIAL]
description: Without a webcam the "+ webcam" recording row is hidden, the webcam picker refuses with a critical toast, and the overlay resize is a silent no-op. Only the absence path is exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Alt+Print: the submenu lists "With no audio", "With desktop audio", "With desktop + microphone audio" and NO "…+ webcam" row. Escape.
  * Open a terminal: `omarchy-capture-webcam-list | wc -l` → 0.
  * `omarchy-capture-screenrecording-with-webcam; echo "exit=$?"` → critical toast "No webcam devices found", `exit=1`.
  * `omarchy-capture-webcam-resize smaller; echo "exit=$?"` → silent, `exit=0`; `omarchy-capture-webcam-resize huge; echo "exit=$?"` → Usage, `exit=1`.
  * Dismiss the critical toast with Super+, (comma).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The critical toast stays until dismissed; it is the expected result, not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Submenu screendump without the webcam row; the critical toast; the exit codes 1, 0, 1
  * If unsuccessful
  ** Any webcam row or device listed on the VM
covers: bin/omarchy-capture-screenrecording-with-webcam, bin/omarchy-capture-webcam-list, bin/omarchy-capture-webcam-resize, bin/omarchy-hw-webcam, default/omarchy/omarchy-menu.jsonc (trigger.capture.screenrecord.webcam when)

### capture-text-ocr   [VM-OK]
description: Super+Ctrl+Print selects a region of on-screen text and OCRs it to the clipboard with a confirming toast; cancelling leaves the clipboard alone. Protects the tesseract path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal, press Super+F (fullscreen) and run `omarchy-display-text-size 18; clear; printf '\n\n   OMARCHY OCR TEST 12345\n\n'` (foot shows a "Restart Foot" toast — open a NEW terminal with Super+Enter so the text is large, and print the line there).
  * Press Super+Ctrl+Print and drag a tight rectangle around the printed line.
  ** Toast "Copied text from selection to clipboard".
  * Run `wl-paste` → contains `OMARCHY OCR TEST 12345` (the digits must be right; minor spacing noise is fine).
  * `wl-copy marker`; press Super+Ctrl+Print then Escape → no toast; `wl-paste` → `marker`.
  * `omarchy-display-text-size reset`; press Super+F to leave fullscreen and close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Bigger text OCRs better; 18 px is enough at 1280x800.
  * `tesseract: command not found` is a missing package — report it as a defect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the selection, the toast, `wl-paste` echoing the text, and `marker` after the cancelled pick
  * If unsuccessful
  ** The tesseract error or garbled output with the region screenshot
covers: bin/omarchy-capture-text, bin/omarchy-capture-region, default/hypr/bindings/utilities.lua (SUPER+CTRL+PRINT), default/omarchy/omarchy-menu.jsonc (trigger.capture.text), manual/11-text-extraction-dictation.md

### capture-qr-decode-and-no-qr   [VM-OK]
description: Selecting an on-screen QR code copies its decoded value to the clipboard without recording it in history, and selecting a region with no code raises a critical toast. Protects both branches of the QR capture.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal, press Super+F and run `clear; qrencode -t ANSIUTF8 -m 2 "hello-omarchy-qr"`.
  * Press Super+Space, click Trigger → Capture → "QR Code"; drag a rectangle around the whole QR block with a margin.
  ** Toast "QR code copied to clipboard".
  * `wl-paste` → `hello-omarchy-qr`. Press Super+Ctrl+V: the clipboard history must NOT list it (sensitive copies are skipped); Escape.
  * Trigger → Capture → QR Code again; select an area of plain prompt text.
  ** Critical toast "No QR code found — Select a region containing a QR code"; dismiss it with Super+, (comma).
  * Press Super+F to un-fullscreen and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the QR renders with stretched blocks use `qrencode -t UTF8`; zbar decodes either.
  * The history panel may show earlier entries; the check is only that `hello-omarchy-qr` is absent.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the QR on screen, the success toast, `wl-paste`, the history panel without the value, and the critical "No QR code found" toast
  * If unsuccessful
  ** The failing selection screenshot and `zbarimg --version`
covers: bin/omarchy-capture-qr, bin/omarchy-capture-region, shell/plugins/clipboard/capture.sh (sensitive skip), default/omarchy/omarchy-menu.jsonc (trigger.capture.qr)

### capture-color-picker   [VM-OK]
description: Super+Print turns the cursor into an eyedropper that puts the clicked colour on the clipboard, and pressing it again backs out. Protects the Color capture entry.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and press Super+Print.
  ** The screen freezes; moving the mouse shows a magnified colour preview at the cursor.
  * Click on the terminal's dark background.
  * Run `wl-paste` → a hex colour like `#1a1b26`.
  * Press Super+Print, then Super+Print again → the picker closes; `wl-paste` is unchanged.
  * Press Super+Space, click Trigger → Capture → "Color" and click a bright spot of the wallpaper → `wl-paste` shows a different hex value.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `mouse move` first and screenshot to see the preview before clicking.
  * The colour is only on the clipboard; there is no toast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendump with the picker preview, `wl-paste` showing hex colours (dark then bright), and the picker gone after the second Super+Print
  * If unsuccessful
  ** `pgrep -a hyprpicker` and the clipboard contents
covers: default/omarchy/omarchy-menu.jsonc (trigger.capture.color), default/hypr/bindings/utilities.lua (SUPER+PRINT), manual/12-screenshots-recording.md

### clipboard-history-pick-older-entry   [VM-OK]
description: Two copies appear newest-first in the clipboard history, and picking the older one pastes it into the terminal and makes it the current clipboard. Protects the capture watcher and the paste helpers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `printf first-entry | wl-copy; sleep 1; printf second-entry | wl-copy`.
  * Type `echo ` (trailing space, no Enter) and press Super+Ctrl+V.
  ** The clipboard panel opens listing `second-entry` above `first-entry`.
  * Press Return once (activates the row cursor), Down to `first-entry`, Return.
  ** The panel closes and `first-entry` is typed onto the command line; press Enter → the terminal prints `first-entry`.
  * `wl-paste` → `first-entry`.
  * Press Super+Ctrl+V, type `sec` → the list filters to `second-entry`; Escape clears the filter, Escape closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Return pastes immediately via Shift+Insert into the window that regains focus (the manual says clipboard-only; pasting is the actual behaviour).
  * Escape is two-stage: first clears the filter, then closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the panel with both rows, the highlighted older row, the terminal showing `echo first-entry` and its output, `wl-paste` = first-entry, the filtered list
  * If unsuccessful
  ** `pgrep -af 'wl-paste.*--watch'` (the watcher must be running) and `head -c 300 ~/.local/state/omarchy/clipboard-history.json`
covers: shell/plugins/clipboard/Clipboard.qml, shell/plugins/clipboard/capture.sh, bin/omarchy-clipboard-paste-text, bin/omarchy-menu-clipboard, default/hypr/bindings/clipboard.lua (SUPER+CTRL+V), test/shell.d/clipboard-test.sh, manual/08-unified-clipboard-history.md

### clipboard-history-secondary-actions   [VM-OK]
description: Shift+Return copies without pasting, Alt+Return opens a text entry in the editor, Delete removes a row and Shift+Delete clears the history behind a confirmation. Protects the panel's secondary actions.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `printf alpha | wl-copy; sleep 1; printf beta | wl-copy; sleep 1; printf gamma | wl-copy`.
  * Press Super+Ctrl+V, Return, Down twice to `alpha`, Shift+Return → the panel closes, nothing is typed, but `wl-paste` → `alpha`.
  * Super+Ctrl+V, select `beta`, Alt+Return → the editor opens a temp file containing `beta`; close it (`:q` in nvim, or Super+W).
  * Super+Ctrl+V, select `beta`, press Delete → the row disappears; Escape.
  * Super+Ctrl+V, Shift+Delete → dialog "Delete entire clipboard history?"; confirm Delete → the list is empty; Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first Return only activates the row cursor; watch the highlight before pressing Down.
  * The default editor is nvim in a terminal window.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of each panel action, `wl-paste` = alpha with nothing typed, the editor with `beta`, the list without `beta`, the confirm dialog and the empty panel
  * If unsuccessful
  ** The panel state after the failing action
covers: shell/plugins/clipboard/Clipboard.qml (Shift/Alt+Return, Delete, Shift+Delete), bin/omarchy-clipboard-open, bin/omarchy-clipboard-paste-text, bin/omarchy-clipboard-paste-file

### notification-send-dismiss-and-replace   [VM-OK]
description: A user-sent notification shows as a toast, critical ones persist, `-r` updates a toast in place, and the dismiss hotkeys and helper remove them; the time hotkey sends its notice. Protects the sender contract and dismissal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-notification-send "Hello driver" "first body"` → a toast top-right that disappears by itself within ~6 s.
  * `id=$(omarchy-notification-send -p -u critical "Sticky" "critical stays"); echo $id` → a number; the toast stays.
  * `omarchy-notification-send -r $id -u critical "Sticky (updated)" "same toast, new text"` → the toast text changes in place; no second toast.
  * `omarchy-notification-dismiss Sticky` → the toast is gone.
  * `omarchy-notification-send "One"; omarchy-notification-send "Two"; omarchy-notification-send "Three"` → three toasts; press Super+, → the newest goes; Super+Shift+, → all gone.
  * Press Super+Ctrl+Alt+T → a toast with weekday, time, date and week number.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot within 3 s of each send; low-urgency toasts last ~5 s.
  * `<M-,>` and `<M-S-,>` are the dismiss chords.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the first toast, the critical toast before and after the in-place update, the stack of three then two then none, and the time notice
  * If unsuccessful
  ** The busctl error printed by the send and `busctl --user list | grep -i notif`
covers: bin/omarchy-notification-send, bin/omarchy-notification-dismiss, bin/omarchy-notification-time, docs/notifications.md (toast lifecycle), default/hypr/bindings/utilities.lua (comma binds, SUPER+CTRL+ALT+T), test/shell.d/notification-send-test.sh

### notification-send-rejects-bad-options   [VM-OK]
description: The sender refuses a forged hint in option position, a bad urgency, a non-numeric id and a quoted whole `--exec` command, while dash-leading text stays text and a real `--exec` click runs. Protects the injection guards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and run, each followed by `; echo "exit=$?"`:
    `omarchy-notification-send "x" "y" --hint=foo` → "Unknown option: --hint=foo" + Usage, `exit=1`, no toast.
    `omarchy-notification-send -u loud "x"` → "Unknown urgency: loud (use low, normal, or critical)", `exit=1`.
    `omarchy-notification-send -r abc "x"` → "Invalid -r value (numeric id expected): abc", `exit=1`.
    `omarchy-notification-send "Click me" --exec "mpv file.mp4"` → "--exec takes the command as separate words, not one quoted string.", `exit=1`.
  * `omarchy-notification-send "Sale" "-50% off today"` → `exit=0` and a toast whose body reads `-50% off today`; `omarchy-notification-send --hint=foo "x"` → a toast headlined literally `--hint=foo` (an unrecognised first word is the headline, never an option).
  * `omarchy-notification-send "Open a terminal" "click me" --exec omarchy-launch-terminal`, then click the toast → a new terminal opens.
  * Close the extra terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On the 4.0.2 disk the argv `--exec` guard may predate this build: if the quoted command is accepted, record `omarchy-version` and report version skew, not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with every error text and `exit=1`, the two toasts with dash-leading text, and the terminal opened by the click
  * If unsuccessful
  ** The case that was accepted or rejected wrongly, with `omarchy-version`
covers: bin/omarchy-notification-send (option parsing, --exec guards), docs/notifications.md (Click commands are argv), test/shell.d/notification-send-test.sh

### notification-history-and-invoke-last   [VM-OK]
description: Expired toasts land in history (newest ten), the history hotkey replays them, and invoke-last runs the last toast's click command after it has gone. Protects the persistence contract.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `for i in 1 2 3; do omarchy-notification-send -u normal "History $i" "body $i" -t 1500; done` and wait until the toasts are gone.
  * Press Super+Shift+Alt+, → an overlay lists History 3, 2, 1 newest first. Escape.
  * `omarchy-notification-send "Invoke me" "opens a terminal" --exec omarchy-launch-terminal`; wait ~6 s for it to expire; press Super+Alt+, → a terminal opens although the toast is gone. Close it.
  * `for i in $(seq 1 12); do omarchy-notification-send "Trim $i" -t 500; sleep 0.7; done`, wait 3 s, then `ls ~/.local/state/omarchy/notifications/history/ | wc -l` → 10.
  * Press Super+Shift+Alt+, → the overlay shows ten Trim entries; Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toast lifetimes have a 5 s floor (`-t` never shortens), so wait ~6 s before asserting expiry.
  * `<M-S-A-,>` opens history, `<M-A-,>` invokes the last one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** History overlay screendumps (3 entries, then 10 Trim entries), the `wc -l` = 10, and the terminal opened by invoke-last
  * If unsuccessful
  ** `ls -la ~/.local/state/omarchy/notifications/history/` and the overlay contents
covers: docs/notifications.md (persistence and history), default/hypr/bindings/utilities.lua (SUPER+ALT+comma, SUPER+SHIFT+ALT+comma), bin/omarchy-notification-send (--exec)

### osd-direct-render   [VM-OK]
description: The OSD pill renders icon, message and progress from `omarchy-osd` and rejects unknown options. Protects the shell OSD regardless of hardware.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-osd -i volume-high -p 70` → a pill with a speaker glyph, a bar at 70 % and "70%".
  * `omarchy-osd -i brightness -p 30 -d 3000` → monitor glyph, 30 %, visible ~3 s.
  * `omarchy-osd -i microphone-muted -m "Microphone muted"` → muted-mic glyph with text, no bar.
  * `omarchy-osd -m "Hello OSD"` → text only.
  * `omarchy-osd --nope; echo "exit=$?"` → "Unknown OSD option: --nope", `exit=1`, no pill.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The default OSD lasts ~1.2 s: run the command and screenshot immediately (./client-with-image).
  * `omarchy-osd` is HEAD-only; `command not found` on the 4.0.2 disk means "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of each pill variant and the terminal with the rejected option
  * If unsuccessful
  ** `omarchy-shell osd show '{"icon":"volume-high","value":"50","progressText":"50%","max":"100"}'` output
covers: bin/omarchy-osd, shell/plugins/osd/OsdModel.js, test/shell.d/osd-test.sh

### volume-keys-on-dummy-output   [VM-PARTIAL]
description: With no sound card PipeWire exposes a Dummy Output; the volume keys (injected in-guest) move its level with an OSD, mute toggles, and the switcher and audio panel describe it. Real speakers are not exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `pactl list sinks short` → one `auto_null` line (Dummy Output). If empty, note it and expect the "Could not resolve…"/"No audio devices found" messages below instead.
  * `wtype -k XF86AudioRaiseVolume` → an OSD pill with a speaker glyph and a percentage 5 higher than before; `pactl get-sink-volume auto_null` agrees.
  * `wtype -k XF86AudioMute` → OSD with the muted glyph; again → unmuted. `wtype -k XF86AudioLowerVolume` → −5 %.
  * `omarchy-audio-output-volume sideways; echo "exit=$?"` → "Unknown volume action: sideways", `exit=1`.
  * `omarchy-audio-output-switch` → OSD naming "Dummy Output" (one sink rotates onto itself).
  * `omarchy-audio-input-mute` → OSD "Microphone on" (no source exists, so mute cannot stick — note it).
  * Press Super+Ctrl+A → the Audio panel lists Dummy Output; Escape. Restore the volume to where it started with the raise/lower keys.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * XF86 keys cannot be sent by the driver; `wtype -k` typed in the guest terminal stands in for the physical key and exercises the real Hyprland binding. `omarchy-audio-output-volume raise` is the fallback if wtype refuses.
  * Screenshot right after each command; the OSD is short-lived.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** OSD screendumps for raise, mute, unmute, lower and the switcher; pactl values agreeing; `exit=1`; the Audio panel
  * If unsuccessful
  ** `pactl info; wpctl status | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-audio-output-volume, bin/omarchy-audio-output-sink, bin/omarchy-audio-output-switch, bin/omarchy-audio-input-mute, bin/omarchy-osd, default/hypr/bindings/media.lua, test/shell.d/audio-test.sh

### brightness-no-backlight-and-dpms   [VM-PARTIAL]
description: With no backlight or DDC monitor the brightness keys do nothing visible and the CLI fails quietly, the keyboard-backlight helper says so, and `off`/`on` still blank and restore the screen via DPMS. Protects the graceful no-hardware paths.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `ls /sys/class/backlight/` → empty; `omarchy-hw-display; echo "exit=$?"` → empty, `exit=1`.
  * `wtype -k XF86MonBrightnessUp` → NO OSD appears; `omarchy-brightness-display +5%; echo "exit=$?"` → `exit=1`, nothing printed.
  * `omarchy-brightness-keyboard up; echo "exit=$?"` → "No keyboard backlight device found", `exit=1`.
  * `omarchy-brightness-display off; sleep 4; omarchy-brightness-display on` as ONE line → the screen goes dark (screendump black or frozen) and returns within ~5 s.
  * Press Super+Ctrl+D → the Display panel shows Virtual-1 with no brightness slider; Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The virtual output is treated as external (DDC path): the silent exit 1 is the expected absence behaviour.
  * If the screen stays dark after `on`, press any key (Hyprland wakes DPMS on key press) and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the exit codes and messages; no OSD after the brightness key; a dark screendump during DPMS off and the desktop back; the Display panel
  * If unsuccessful
  ** Any OSD that appeared for a failed brightness call, or the screen not returning
covers: bin/omarchy-brightness-display, bin/omarchy-brightness-display-ddc, bin/omarchy-brightness-keyboard, bin/omarchy-hw-display, default/hypr/bindings/media.lua, test/shell.d/brightness-display-test.sh, test/shell.d/hw-display-test.sh

### keyboard-layout-switch-bar-indicator   [VM-OK]
description: With two layouts configured the keyboard-layout widget appears in the bar, clicking it cycles the layout and typing proves the switch; with one layout it stays hidden. Protects input.lua and the KeyboardLayout widget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar: with the stock single `us` layout there is no two-letter layout label near the clock.
  * Open a terminal: `hyprctl keyword input:kb_layout us,de` (transient until reload).
  ** Within a second a small `en` label appears in the bar's centre section.
  * Type `yz` in the terminal → `yz`.
  * Click the `en` label → it reads `de`; type `yz` → `zy` (German swaps Y and Z). Press Backspace twice.
  * Click the label again → `en`; then `hyprctl reload` → back to the stock single layout and the label disappears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The label sits right of the clock; if a click opens the calendar you hit the clock — Escape and aim slightly further right.
  * If `hyprctl keyword` is refused on this Hyprland, use `hyprctl eval 'hl.config({ input = { kb_layout = "us,de" } })'`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screendumps: no label → `en` → `de` → `en` → none; the terminal showing `yz` then `zy`
  * If unsuccessful
  ** The bar screenshot after the keyword and the terminal output
covers: default/hypr/input.lua, shell/plugins/bar/widgets/KeyboardLayout.qml, shell/plugins/bar/widgets/KeyboardLayout.manifest.json, config/omarchy/shell.json (omarchy.keyboard-layout), test/shell.d/hyprland-keyboard-layout-test.sh, test/shell.d/keyboard-layout-test.sh

### workspace-layout-toggle   [VM-OK]
description: Super+L flips the active workspace between dwindle and scrolling with a toast, the choice sticks to that workspace across a reload, and toggling back restores the tree. Protects the layout toggle and its Lua restore.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open three terminals on workspace 1: dwindle splits them into a tree (one tall, two stacked). Screenshot.
  * Press Super+L.
  ** Toast "Workspace layout set to scrolling"; the windows rearrange into side-by-side columns.
  * In a terminal: `hyprctl reload` → still columns (the rule is re-sourced); `cat ~/.local/state/omarchy/workspace-layouts/1.lua` → `… workspace = "1", layout = "scrolling" …`.
  * Press Super+2 and open two terminals: workspace 2 still tiles as a tree. Press Super+1.
  * Press Super+L → toast "…set to dwindle"; the tree returns. `rm ~/.local/state/omarchy/workspace-layouts/1.lua`; close all terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+L is layout, not lock (lock is Super+Ctrl+L).
  * Trigger → Toggle → "Workspace Layout" is the menu equivalent.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the tree, the columns with the toast, columns after reload, workspace 2 as a tree, and the return to dwindle; the state file contents
  * If unsuccessful
  ** The layout screenshot that did not change after the toast
covers: bin/omarchy-hyprland-workspace-layout-toggle, default/hypr/workspace-layouts.lua, default/hypr/bindings/tiling.lua (SUPER+L), test/shell.d/hyprland-workspace-layout-test.sh

### window-close-all   [VM-OK]
description: Ctrl+Alt+Delete closes every window on every workspace and returns to workspace 1. Protects the close-all dispatcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals on workspace 1; press Super+3 and open a browser (Super+Shift+Enter) and a terminal there.
  * Screenshot workspace 3 (browser + terminal; the bar's workspace pills show 1 and 3 populated).
  * Press Ctrl+Alt+Delete.
  ** All windows close, including the browser, and the view jumps to workspace 1 (bar pill 1 active, empty desktop).
  * Press Super+3 → empty as well; Super+1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The chord is `<C-A-DEL>`; QEMU passes it to the guest.
  * If Chromium raises Hyprland's "not responding" dialog while starting, click Wait, not report a hang.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps before (four windows across two workspaces) and after (empty workspace 1, empty workspace 3)
  * If unsuccessful
  ** The screenshot of surviving windows and `hyprctl clients -j | jq -r '.[].class'`
covers: bin/omarchy-hyprland-window-close-all, default/hypr/bindings/tiling.lua (CTRL+ALT+DELETE), test/shell.d/hyprland-window-close-all-test.sh

### focus-app-by-class   [VM-OK]
description: `omarchy-hyprland-focus-app` brings a window to focus by class across workspaces and fails with exit 1 when nothing matches. Protects the notification click-to-focus fallback.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a browser (Super+Shift+Enter) on workspace 1; press Super+2 and open a terminal.
  * In the terminal: `omarchy-hyprland-focus-app chromium`.
  ** The view switches to workspace 1 with the browser focused.
  * Press Super+2 and run `omarchy-hyprland-focus-app nosuchapp; echo "exit=$?"` → `exit=1`, focus unchanged; `omarchy-hyprland-focus-app; echo "exit=$?"` → Usage, `exit=1`.
  * Close the browser and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Matching is case-insensitive on the window class; the default browser class matches `chromium`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendump of the browser focused on workspace 1 right after the command from workspace 2; the two `exit=1` lines
  * If unsuccessful
  ** `hyprctl clients -j | jq '.[] | {class,workspace}'`
covers: bin/omarchy-hyprland-focus-app, docs/notifications.md (click fallback), test/shell.d/hyprland-focus-app-test.sh

### window-pop-and-unpop   [VM-OK]
description: Super+O pops the focused tile into a centred, pinned floating window that follows across workspaces, and pops it back into the tiling. Protects the pop dispatcher chain.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals; focus the right one and press Super+O.
  ** It becomes a centred floating window on top (the default 1300x900 is clamped to this 1280x800 screen); the left terminal expands behind it.
  * Press Super+2 → the popped window is still visible on the empty workspace 2 (pinned). Press Super+1.
  * Press Super+O → it is unpinned and re-tiled beside the other terminal.
  * In a terminal: `omarchy-hyprland-window-pop 800 500` → a centred 800x500 float; Super+O to retile. Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A pinned window shows on every workspace; that is the proof of the pin.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the popped window, the same window on workspace 2, the retiled pair, and the 800x500 float
  * If unsuccessful
  ** `hyprctl activewindow -j | jq '{floating,pinned,size}'` after the failing step
covers: bin/omarchy-hyprland-window-pop, default/hypr/bindings/tiling.lua (SUPER+O)

### window-width-save-restore   [VM-OK]
description: A window's width can be saved per app and workspace and restored later, with a toast on save and a "nothing saved" toast when there is none. Protects the width state files.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals on workspace 1 and focus the left one.
  * Press Super+Home → toast "No saved width found for foot on workspace 1 — Use Super + Alt + Home to save one for this workspace."
  * Press Super+- (minus) three times: the left terminal shrinks by 300 px. Screenshot.
  * Press Super+Alt+Home → toast "Saved width for foot on workspace 1 — Restore using Super + Home on this workspace."
  * Press Super+= three times (widen), then Super+Home → the window snaps back to the saved narrow width (compare with the earlier screenshot).
  * `rm -r ~/.local/state/omarchy/windows`; close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `<M-->` and `<M-=>` are the resize chords; if they are absent on this build, `hyprctl dispatch resizeactive -100 0` from the other terminal is equivalent.
  * These binds are HEAD-only: check Super+K for "Save window width" and report "absent on this build" if missing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the "No saved width" toast, the narrowed window, the saved toast, the widened window, and the restored width matching the narrowed screenshot
  * If unsuccessful
  ** `ls ~/.local/state/omarchy/windows/` and the widths before/after
covers: bin/omarchy-hyprland-window-width, default/hypr/bindings/tiling.lua (SUPER+HOME, SUPER+ALT+HOME)

### tiled-fullscreen-toggle   [VM-OK]
description: Super+Ctrl+F tells the focused browser it is fullscreen while it stays in its tile (toolbar hidden, window unchanged) and toggles back. Protects the fullscreenstate dispatcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and a browser side by side; click into the browser.
  * Press Super+Ctrl+F.
  ** The browser's tab strip and address bar disappear but it still occupies only its tile next to the terminal.
  * Press Super+Ctrl+F again → the toolbar is back.
  * For contrast press Super+F (real fullscreen covers the whole screen) and Super+F again.
  * Close both windows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * HEAD-only bind: if nothing happens, check Super+K for "Tiled full screen" and report "absent on this build".
  * Chromium may show a "not responding" dialog on first start; click Wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: browser with toolbar → toolbar hidden but still tiled → toolbar back → true fullscreen → tiled again
  * If unsuccessful
  ** `hyprctl activewindow -j | jq '{fullscreen,fullscreenClient}'`
covers: bin/omarchy-hyprland-window-tiled-fullscreen-toggle, default/hypr/bindings/tiling.lua (SUPER+CTRL+F), test/shell.d/hyprland-window-test.sh
dedupe-with: test_def/51-existing-shell-tests-a-l.md (tiled-fullscreen-toggle)

### monitor-scaling-up-down   [VM-OK]
description: Super+/ and Super+Alt+/ step the display scale through clean presets with everything visibly resizing, the value persists to monitors.lua, and bad input is refused. Protects the scaling helper on the single 1280x800 output.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-hyprland-monitor-scaling` → `1`.
  * Press Super+/ → everything on screen grows; the command now prints `1.25`. Press Super+/ again → `1.6`.
  * `omarchy-hyprland-monitor-scaling 3` then no-arg → `3.2` (3 is not clean at 1280x800 and rounds up). Screenshot the huge desktop.
  * Press Super+Alt+/ → `2`; `omarchy-hyprland-monitor-scaling 1` → `1`; the desktop is back to normal.
  * `grep omarchy_monitor_scale ~/.config/hypr/monitors.lua` → `= 1`; `omarchy-hyprland-monitor-scaling 7; echo "exit=$?"` → Usage, `exit=1`.
  * Press Super+Ctrl+D → the Display panel shows Virtual-1 with the scale control; Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * At 3.2 the logical screen is 400x250: type blind and step down immediately.
  * `<M-/>` and `<M-A-/>` are the chords. If monitors.lua uses the older `scale = "auto"` catch-all form the persist line differs — report what the file shows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps at 1, 1.25, 3.2 and back at 1; the printed scale sequence; the monitors.lua line; the usage error with `exit=1`
  * If unsuccessful
  ** `hyprctl monitors -j` and the monitors.lua contents
covers: bin/omarchy-hyprland-monitor-scaling, default/hypr/bindings/tiling.lua (SUPER+SLASH), test/shell.d/monitor-scaling-test.sh, test/shell.d/monitor-test.sh (clean VM scale)

### display-text-size   [VM-OK]
description: One command scales shell, GTK and terminal text together, reports the three values, and rejects out-of-range sizes; reset returns everything to default. Protects `omarchy-display-text-size`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-display-text-size` → `text size: 12 (default) px`, `gtk text-scaling-factor: 1.0`, `terminal font: 9 pt`.
  * `omarchy-display-text-size 18` → the bar text and clock enlarge within a second; foot shows a toast "Restart Foot to apply the new terminal font size".
  * Press Super+Enter: the new terminal has visibly larger text. `omarchy-display-text-size` → `18 px`, `1.5455`, `14 pt`.
  * `omarchy-display-text-size 25; echo "exit=$?"` → "Size must be an integer between 9 and 20 (px).", `exit=1`.
  * `omarchy-display-text-size reset` → the bar shrinks back; a fresh terminal (Super+Enter) is at the default size; the report shows 12 (default) / 1.0 / 9 pt. Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Foot has no live reload; only new terminal windows show the new size — that is by design.
  * HEAD-only command: `command not found` on 4.0.2 means "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps at default and at 18 px (bar and new terminal larger, the Restart Foot toast), the three-line reports, the rejection with `exit=1`, and the reset state
  * If unsuccessful
  ** `cat ~/.config/omarchy/shell.toml` and `gsettings get org.gnome.desktop.interface text-scaling-factor`
covers: bin/omarchy-display-text-size

### session-locked-probe-via-serial   [VM-OK]
description: `omarchy-hyprland-session-locked` reports unlocked on the desktop and locked while the lock screen is up, proven through the serial console. Protects the lock detection `omarchy-restart-shell` relies on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-hyprland-session-locked; echo "exit=$?"` → `exit=1` (unlocked).
  * `sudo -v` (type `prime`) so sudo is cached, then as one line: `(sleep 10; omarchy-hyprland-session-locked; echo "locked-probe=$?" | sudo -n tee /dev/ttyS0) &`.
  * Immediately press Super+Ctrl+L to lock. Wait 12 s taking screenshots (the lock screen blanks after 5 s — a black screenshot is normal).
  * Read the serial console → `locked-probe=0`.
  * Move the mouse once (wakes the screen), type `prime` and Enter → the desktop returns with the terminal; `omarchy-hyprland-session-locked; echo "exit=$?"` → `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen has no clock, only the password field; the first character typed while black both wakes and enters the field.
  * `get-serial` returns the whole console; look for the `locked-probe=` line near the end.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with `exit=1`, the lock screen screendump, serial output `locked-probe=0`, and the final `exit=1` after unlocking
  * If unsuccessful
  ** The serial dump and the lock screen screenshot
covers: bin/omarchy-hyprland-session-locked, bin/omarchy-restart-shell (lock guard), test/shell.d/hyprland-session-locked-test.sh

### reload-guard-pause-resume   [VM-OK]
description: The reload guard pauses Hyprland's config auto-reload for the live session and restores it on resume, reporting its state in between. Protects the pacman-hook helper.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-hyprland-reload-guard paused; echo "exit=$?"` → `exit=1` (not paused); `hyprctl getoption misc:disable_autoreload` → `int: 0`.
  * `sudo omarchy-hyprland-reload-guard pause` (password prime) → silent; `omarchy-hyprland-reload-guard paused; echo "exit=$?"` → `exit=0`; `hyprctl getoption misc:disable_autoreload` → `int: 1`.
  * `sudo omarchy-hyprland-reload-guard resume` → `paused` → `exit=1` again and `disable_autoreload` back to `int: 0`.
  * `omarchy-hyprland-reload-guard; echo "exit=$?"` → Usage, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The state dir is root-owned under /run/omarchy; `pause`/`resume` need sudo, `paused` does not.
  * HEAD-only helper: `command not found` on 4.0.2 means "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with the exit codes 1 → 0 → 1 and getoption 0 → 1 → 0
  * If unsuccessful
  ** `sudo ls -la /run/omarchy/hyprland-reload-guard/` and the getoption value
covers: bin/omarchy-hyprland-reload-guard, test/shell.d/hyprland-reload-guard-test.sh
dedupe-with: test_def/51-existing-shell-tests-a-l.md (reload-guard-pause-resume)

### monitor-helpers-without-laptop-panel   [VM-PARTIAL]
description: On a machine with no internal panel the laptop-display and mirror toggles refuse with clear toasts, the Hardware menu hides their rows, and the monitor queries answer for the single virtual output. Only the no-hardware branches are exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Delete → toast "No laptop display found".
  * Press Super+Ctrl+Alt+Delete → toast "No laptop monitor found to mirror".
  * Press Super+Ctrl+H: the Hardware submenu shows no Laptop Display or Mirror Display rows (it may read "Nothing here yet"). Escape.
  * Open a terminal: `omarchy-hyprland-monitor-focused` → `Virtual-1`; `omarchy-hyprland-monitor-laptop; echo "[exit=$?]"` → empty line, `[exit=0]`; `omarchy-hyprland-monitor-internal sideways; echo "exit=$?"` → Usage, `exit=1`.
  * `omarchy-monitor-state` → 8 lines: empty, empty, `Virtual-1`, empty, empty, `Virtual-1`, `1`, a one-element JSON array naming Virtual-1.
  * `ls ~/.local/state/omarchy/toggles/hypr/` → no `internal-monitor-*` files were created.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The single virtual output counts as "external" by connector name; that is why the toggles find no laptop panel.
  * `omarchy-monitor-state` is HEAD-only; `command not found` means "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both toasts, the Hardware submenu without the rows, the terminal values, and the toggles listing without internal-monitor files
  * If unsuccessful
  ** Any `internal-monitor-*.lua` created, or a toggle that changed the only display
covers: bin/omarchy-hyprland-monitor-{focused,laptop,external-active,internal,internal-mirror,clamshell}, bin/omarchy-monitor-state, default/omarchy/omarchy-menu.jsonc (trigger.hardware.laptop-display, mirror-display), default/hypr/bindings/utilities.lua (SUPER+CTRL+DELETE), test/shell.d/monitor-state-test.sh

### quake-console-scratchpad   [VM-OK]
description: Super+S drops a centred half-height console over the dimmed workspace and hides it again; a second window on it widens to full width. Protects the Quake-console scratchpad rules.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal. Press Super+S.
  ** The desktop dims and the special workspace slides down. With no default agent it is empty: press Super+Enter to open a terminal INTO it. It is a centred box about 770x385, flush with the top edge, without an active border.
  * Press Super+S → it slides back up; the original terminal is visible undimmed. Super+S → back.
  * With the console open press Super+Enter again → two terminals tile inside it and the box widens to the full screen width.
  * Close one with Super+W → the centred box returns. Close the other; Super+S to hide the console.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+grave (`<M-`>`) is the same toggle.
  * The dimming behind the console is the visual cue that you are on the special workspace.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the dimmed desktop with the centred console, the hidden state, and the full-width two-window console then the box again
  * If unsuccessful
  ** Screenshot of the console at the wrong size and `hyprctl workspacerules`
covers: default/hypr/qconsole.lua, default/hypr/bindings/tiling.lua (SUPER+S, SUPER+grave, SUPER+ALT+S), test/shell.d/hyprland-qconsole-test.sh

### restart-shell-from-menu   [VM-OK]
description: Update → Process → Shell restarts the Omarchy shell — the bar disappears and comes back working — and the restart is refused while the session is locked. Protects the most-used recovery command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-shell shell ping` → a reply.
  * Press Super+Space, click Update → Process → "Shell".
  ** Within 1–3 s the bar vanishes and reappears (screenshot every second for 5 s); `omarchy-shell shell ping` answers again and Super+Space opens the menu.
  * `omarchy-restart-shell; echo "exit=$?"` → the same blink, `exit=0`.
  * `sudo -v` (prime), then `(sleep 8; omarchy-restart-shell 2>&1 | sudo -n tee /dev/ttyS0) &`; press Super+Ctrl+L; wait 10 s (black lock screen is normal); move the mouse, type `prime`, Enter.
  * Read the serial console → "Refusing to restart Omarchy shell while the session is locked."; the lock screen stayed intact and the bar is present after unlocking.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Live toasts survive the restart; a bar missing for more than ~10 s is the failure "Omarchy shell did not become ready after restart."
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the bar gone and back (twice), the menu opening afterwards, `exit=0`, the serial refusal line, the lock screen undisturbed and the desktop after unlock
  * If unsuccessful
  ** `journalctl --user -b | tail -50 | sudo tee /dev/ttyS0` and the missing-bar screenshot
covers: bin/omarchy-restart-shell, bin/omarchy-shell, bin/omarchy-hyprland-session-locked, default/omarchy/omarchy-menu.jsonc (update.process.shell), test/shell.d/restart-shell-test.sh

### restart-hyprsunset-and-audio-from-update-menu   [VM-OK]
description: The Update menu's Hyprsunset and Audio restarts relaunch their services and leave them working: hyprsunset comes back on its identity profile (night light off), PipeWire comes back with the Dummy Output. Protects `omarchy-restart-app`, `omarchy-restart-hyprsunset` and `omarchy-restart-audio`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+N → orange tint and the night-light indicator. Open a terminal: `pgrep -x hyprsunset` → a PID.
  * Press Super+Space, click Update → Process → "Hyprsunset".
  ** The tint disappears within ~2 s; `pgrep -x hyprsunset` → a different PID; `omarchy-toggle-nightlight --status` → `"enabled":false`. Press Super+Ctrl+N then Super+Ctrl+N once more to confirm night light still works, ending off.
  * `systemctl --user show -p MainPID --value pipewire.service` → note the PID.
  * Super+Space, click Update → Hardware → "Audio".
  ** A floating "Omarchy" terminal prints "Restarting audio services...", then "Audio status:" with a `wpctl status` tree containing Dummy Output, then a Done prompt; press Enter.
  * `systemctl --user show -p MainPID --value pipewire.service` → a new PID; `pactl list sinks short` → `auto_null` still present; `wtype -k XF86AudioRaiseVolume` → the volume OSD still works (then lower it back).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The audio restart takes up to ~10 s on 2 vCPU; wait for the wpctl tree before pressing Enter.
  * Night light turning off after the hyprsunset restart is expected (fresh hyprsunset applies its config profile).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: tinted → neutral after the menu action with the PID change; the floating terminal with "Restarting audio services..." and the wpctl tree; the new pipewire PID; the volume OSD afterwards
  * If unsuccessful
  ** A still-tinted screenshot with the new PID, or the floating terminal's "did not restart cleanly" / "still not responding" text
covers: bin/omarchy-restart-hyprsunset, bin/omarchy-restart-app, bin/omarchy-restart-audio, bin/omarchy-launch-floating-terminal-with-presentation, default/omarchy/omarchy-menu.jsonc (update.process.hyprsunset, update.hardware.audio)

### restart-hardware-and-quiet-helpers   [VM-PARTIAL]
description: The Wi-Fi, Bluetooth and Trackpad restarts run to a Done prompt on a machine without that hardware, and the config-reload helpers (terminal, tmux, xcompose, hyprctl, btop/helix/opencode/herdr) are safe no-ops or clean restarts. Only the no-hardware paths are exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, click Update → Hardware → "Wi-Fi" → floating terminal: "Unblocking wifi..." then an empty `rfkill` list, Done; press Enter. Repeat for "Bluetooth" ("Unblocking bluetooth...", empty list, Done).
  * Update → Hardware → "Trackpad" → sudo asks for the password (prime); no "Resetting …" line appears (no I²C devices); Done.
  * Open a terminal: `omarchy-restart-terminal; omarchy-restart-tmux; omarchy-restart-hyprctl; echo "exit=$?"` → nothing printed, `exit=0`, your terminal still works.
  * `omarchy-restart-xcompose; echo "exit=$?"` → `exit=0`; `systemctl --user is-active omarchy-fcitx5.service` → `active` and `pgrep -x fcitx5` → one PID. Type `<CAPSLOCK>` then `o` then `e` → `œ` (compose still works).
  * `omarchy-restart-btop; omarchy-restart-helix; omarchy-restart-opencode; omarchy-restart-herdr; echo "exit=$?"` → nothing printed (none running), exit 0 or 1 from pkill — report which.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Caps Lock is the compose key on Omarchy (no Caps Lock OSD exists); the `œ` proves fcitx5/XCompose came back.
  * `Unit omarchy-fcitx5.service could not be found` is a build difference to report, not a restart failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three floating-terminal screendumps ending in Done, the terminal with `exit=0` lines, `active` + one fcitx5 PID, and the `œ` typed after the restart
  * If unsuccessful
  ** The floating terminal's Failed prompt text or `systemctl --user status omarchy-fcitx5.service`
covers: bin/omarchy-restart-wifi, bin/omarchy-restart-bluetooth, bin/omarchy-restart-trackpad, bin/omarchy-restart-terminal, bin/omarchy-restart-tmux, bin/omarchy-restart-hyprctl, bin/omarchy-restart-xcompose, bin/omarchy-restart-btop, bin/omarchy-restart-helix, bin/omarchy-restart-opencode, bin/omarchy-restart-herdr, bin/omarchy-restart-gum, default/omarchy/omarchy-menu.jsonc (update.hardware.*)

### bar-position-transparency-reset   [VM-OK]
description: The bar moves to any edge and toggles transparency from Style → Menu Bar and the CLI, rejects bad values, and `reset` returns to the built-in bar. Protects `omarchy-bar`'s config edits and live reload.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, click Style → Menu Bar → Position → "Bottom" → the bar jumps to the bottom edge within ~5 s.
  * Open a terminal: `omarchy-bar position left` → a vertical bar on the left; `omarchy-bar position top` → back on top.
  * `omarchy-bar position middle; echo "exit=$?"` → "position must be top, bottom, left, or right", `exit=1`.
  * Style → Menu Bar → "Transparency" → the bar background becomes see-through over the wallpaper; `omarchy-bar transparent false` → solid again.
  * `omarchy-bar use nosuch.bar; echo "exit=$?"` → "nosuch.bar is not a known bar option; run 'omarchy plugin list'", `exit=1`; `omarchy-bar reset` → "Using omarchy.bar as the active bar".
  * Confirm the bar is top, solid and complete, as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Allow up to 20 s for a position change to settle (acceptance-suite timeout).
  * The first `omarchy-bar` command creates `~/.config/omarchy/shell.json` from the defaults; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the bar at bottom, left, top, transparent and solid; both rejection messages with `exit=1`; the reset message
  * If unsuccessful
  ** `cat ~/.config/omarchy/shell.json` and the bar screenshot that disagrees
covers: bin/omarchy-bar (position, transparent, use, reset), bin/omarchy-shell-config, default/omarchy/omarchy-menu.jsonc (style.bar.*)

### bar-customize-widgets-and-defaults   [VM-OK]
description: Per-widget settings and widget placement are editable from the CLI with immediate visible effect, and `defaults` restores the shipped layout. Protects `omarchy-bar set/move/put/defaults`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Note the clock text in the bar centre (weekday and HH:mm).
  * Open a terminal: `omarchy-bar set omarchy.clock format "HH:mm:ss"` → "Set format on omarchy.clock"; the clock shows ticking seconds.
  * `omarchy-bar move omarchy.clock left` → "Moved omarchy.clock"; the clock sits in the left section after the workspaces.
  * `omarchy-bar put omarchy.keyboard-layout --section right --index 0` → "omarchy.keyboard-layout is on the bar" (it stays hidden with one layout); `omarchy-bar move omarchy.clock nowhere; echo "exit=$?"` → "section must be left, center, or right", `exit=1`.
  * `omarchy-bar defaults` → "Restored the default Omarchy bar": the clock is back in the centre with weekday + HH:mm.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-bar put` is HEAD-only; "unknown command: put" on 4.0.2 means "absent on this build" — continue with the rest.
  * Screenshot twice a few seconds apart to prove the seconds tick.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the seconds clock, the clock in the left section, the rejection with `exit=1`, and the restored default bar
  * If unsuccessful
  ** `jq .bar.layout ~/.config/omarchy/shell.json` and the bar screenshot that disagrees
covers: bin/omarchy-bar (set, move, put, defaults), config/omarchy/shell.json, bin/omarchy-plugin-catalog

### shell-ipc-ping-and-errors   [VM-OK]
description: `omarchy-shell` reaches the running shell, reports unknown targets and methods with exit 1, toggles a panel by IPC, and `-q` makes every failure a silent success. Protects the IPC wrapper every toggle depends on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-shell shell ping; echo "exit=$?"` → a reply and `exit=0`.
  * `omarchy-shell nosuch ping; echo "exit=$?"` → "Target not found.", `exit=1`; `omarchy-shell shell nosuchmethod; echo "exit=$?"` → "Function not found.", `exit=1`.
  * `omarchy-shell -q nosuch ping; echo "exit=$?"` → nothing, `exit=0`.
  * `omarchy-shell shell toggle omarchy.clock` → the calendar panel opens; run it again → it closes.
  * `OMARCHY_PATH=/nonexistent omarchy-shell shell ping; echo "exit=$?"` → "omarchy-shell config not found: /nonexistent/shell/shell.qml", `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-shell` with no arguments prints usage and exits 0 — not an error.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with every message and exit code; the calendar panel open then closed
  * If unsuccessful
  ** `qs list` output and `echo $OMARCHY_PATH $WAYLAND_DISPLAY`
covers: bin/omarchy-shell, test/shell.d/restart-shell-test.sh (IPC cases)

### plugin-enable-disable-first-party-widget   [VM-OK]
description: A first-party bar widget can be disabled and re-enabled from the CLI and the Setup → Plugins pickers with the bar updating live, and unknown ids or misplaced bars are refused. Protects the enable/disable IPC and the pickers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-plugin-list` → a table with ID/STATE/SOURCE/KINDS/NAME including `omarchy.weather enabled first-party bar-widget`.
  * `omarchy-plugin-disable omarchy.weather` → "Disabled omarchy.weather"; the weather pill leaves the bar centre.
  * `omarchy-plugin-enable omarchy.weather` → "Enabled omarchy.weather"; it returns (after its fetch, up to 30 s).
  * Press Super+Space, click Setup → Plugins → "Disable Plugin", choose "Weather" in the picker → gone again; Setup → Plugins → "Enable Plugin" → "Weather" → back.
  * `omarchy-plugin-enable nosuch.plugin; echo "exit=$?"` → "plugin 'nosuch.plugin' is not known…", `exit=1`; `omarchy-plugin-enable omarchy.bar --section left; echo "exit=$?"` → "'omarchy.bar' is a bar; it replaces the bar in use…", `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker shows the plugin name with its id as subtext; type to filter may not work — use Down/Enter or the mouse.
  * The weather pill only renders after a network fetch; its absence right after enable is not a failure until 30 s have passed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The list table; bar screendumps with and without the weather pill (twice); the picker; both rejections with `exit=1`
  * If unsuccessful
  ** `omarchy-plugin-list | grep weather` after the failing step
covers: bin/omarchy-plugin-list, bin/omarchy-plugin-enable, bin/omarchy-plugin-disable, bin/omarchy-menu-plugin, default/omarchy/omarchy-menu.jsonc (setup.plugin.*), test/shell.d/plugin-enable-test.sh, test/shell.d/menu-plugin-test.sh

### plugin-clone-and-remove-restores-builtin   [VM-OK]
description: Cloning a built-in widget creates an editable copy under the user's id and swaps it in with a toast; removing the clone from the menu backs it up and restores the built-in. Protects clone and remove and their pickers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-plugin-clone omarchy.clock` → "Cloned omarchy.clock to /home/prime/.config/omarchy/plugins/prime.clock and switched to prime.clock"; toast "Editing Cloned Plugin".
  * `omarchy-plugin-list | grep clock` → `omarchy.clock disabled …` and `prime.clock enabled third-party bar-widget My Clock`; the bar clock keeps ticking.
  * `omarchy-plugin-clone omarchy.clock; echo "exit=$?"` → "… already exists", `exit=1`.
  * Press Super+Space, click Setup → Plugins → "Remove Plugin", choose "My Clock" → a floating terminal asks "Remove 'prime.clock'? The folder will be backed up." → Yes.
  ** "Removed prime.clock. Backup at: …/.prime.clock.bak.…" and "Restored omarchy.clock."; Done → Enter.
  * `omarchy-plugin-list | grep clock` → only `omarchy.clock enabled`; the bar clock still works.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Setup → Plugins → Clone Plugin opens `$EDITOR` afterwards (`--edit`); the CLI form used here does not.
  * The Remove Plugin row only exists while a user plugin is installed; reopen the menu twice if it is missing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps: clone output and toast, the list with prime.clock enabled, the `exit=1`, the remove confirmation and its output, the final list with only omarchy.clock and a working bar clock
  * If unsuccessful
  ** `ls -a ~/.config/omarchy/plugins/` and the list output after the failing step
covers: bin/omarchy-plugin-clone, bin/omarchy-plugin-remove, bin/omarchy-menu-plugin (remove), default/omarchy/omarchy-menu.jsonc (setup.plugin.clone/remove when), test/shell.d/plugin-clone-test.sh, test/shell.d/menu-plugin-test.sh

### plugin-add-local-repo-and-remove   [VM-OK]
description: A plugin is added from a git URL (a local `file://` repo — no network), listed, enabled, disabled and removed, both from the CLI and through Setup → Plugins → Add Plugin's warning and prompts. Protects the add pipeline end to end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type these lines:
    `mkdir -p /tmp/hello && cd /tmp/hello`
    `printf '%s\n' '{"schemaVersion":1,"id":"test.hello","name":"Hello Plugin","version":"1.0.0","author":"t","description":"demo","kinds":["service"],"entryPoints":{"service":"Service.qml"}}' > manifest.json`
    `printf 'import QtQuick\nItem { property var shell: null }\n' > Service.qml`
    `git init -q && git add . && git -c user.name=t -c user.email=t@t commit -qm init && cd ~`
  * `omarchy-plugin-add file:///tmp/hello --yes` → clone output, "Added test.hello into /home/prime/.config/omarchy/plugins/test.hello", "Enable it later with: omarchy plugin enable test.hello".
  * `omarchy-plugin-list | grep hello` → `test.hello disabled third-party service Hello Plugin`; `omarchy-plugin-enable test.hello` → "Enabled test.hello"; `omarchy-plugin-disable test.hello` → "Disabled test.hello".
  * `omarchy-plugin-add file:///tmp/hello --yes; echo "exit=$?"` → "plugin id 'test.hello' is already used by …", `exit=1`.
  * `omarchy-plugin-remove test.hello --yes` → "Removed test.hello." (a git checkout is deleted, no backup).
  * Press Super+Space, click Setup → Plugins → "Add Plugin" → floating terminal "Git URL of the plugin repo:" → type `file:///tmp/hello`, Enter → the ⚠️ warning and "Clone and add this plugin?" → Yes → "Added…" → "Enable 'test.hello' now?" → No → Done, Enter.
  * `omarchy-plugin-remove test.hello --yes` → "Removed test.hello."; `ls ~/.config/omarchy/plugins/` shows nothing of it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The trivial service has nothing visible; the proof is the messages and the list state. A QML warning in the shell log is acceptable; a shell crash is not.
  * gum confirm: Left/Right to move, Enter to pick.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps of "Added…", the list line, Enabled/Disabled, the duplicate refusal with `exit=1`, "Removed", the floating-terminal flow with the warning and both prompts, and the empty plugins listing
  * If unsuccessful
  ** The failing step's stderr and `ls -la ~/.config/omarchy/plugins/`
covers: bin/omarchy-plugin-add, bin/omarchy-plugin-validate, bin/omarchy-plugin-enable, bin/omarchy-plugin-disable, bin/omarchy-plugin-remove, bin/omarchy-git-url-check, default/omarchy/omarchy-menu.jsonc (setup.plugin.add), test/shell.d/plugin-add-test.sh

### plugin-update-fast-forward-and-rollback   [VM-OK]
description: `omarchy plugin update` reports an up-to-date plugin, fast-forwards a new upstream commit, and rolls back an update whose manifest fails validation. Protects the update path offline via a local repo.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and create the repo as in `plugin-add-local-repo-and-remove` (manifest + Service.qml + `git init`/commit under /tmp/hello), then `omarchy-plugin-add file:///tmp/hello --yes`.
  * `omarchy-plugin-update test.hello --yes` → "test.hello is up to date."
  * `cd /tmp/hello && sed -i 's/1.0.0/1.0.1/' manifest.json && git commit -qam bump && cd ~ && omarchy-plugin-update test.hello --yes` → "Updated test.hello."; `grep version ~/.config/omarchy/plugins/test.hello/manifest.json` → `1.0.1`.
  * `cd /tmp/hello && sed -i 's/"schemaVersion":1/"schemaVersion":"1"/' manifest.json && git commit -qam break && cd ~ && omarchy-plugin-update test.hello --yes; echo "exit=$?"` → "unsupported or missing schemaVersion", "update of 'test.hello' failed validation; rolled back", `exit=1`; the installed manifest still says `1.0.1`.
  * `omarchy-plugin-update nosuch; echo "exit=$?"` → "plugin 'nosuch' is not installed", `exit=1`.
  * `omarchy-plugin-remove test.hello --yes` → "Removed test.hello."
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Without `--yes` the update shows a diff and asks; `--yes` keeps it non-interactive.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps of "up to date", "Updated" with version 1.0.1, the validation failure + "rolled back" with `exit=1` and the manifest still at 1.0.1, the not-installed error, and "Removed"
  * If unsuccessful
  ** `git -C ~/.config/omarchy/plugins/test.hello log --oneline` and the manifest contents
covers: bin/omarchy-plugin-update, bin/omarchy-plugin-validate, bin/omarchy-plugin-add, bin/omarchy-plugin-remove

### plugin-add-from-public-git-url   [VM-OK] [NET]
description: Adding a plugin from a real HTTPS git URL clones over the NAT and installs (or is refused by validation with a reason), and a non-existent repository fails cleanly with no leftovers. Protects the network path of `omarchy plugin add`. (Small clone, well under 1 MB.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a browser (Super+Shift+Enter) and go to `https://omarchyplugins.com/`. If it lists a plugin, open it and note its repository URL (ending `.git`); if it lists none, search GitHub for `omarchy plugin manifest.json schemaVersion` and pick a public repo whose root `manifest.json` has an id not starting with `omarchy.`. Record the URL in your report.
  * Open a terminal: `omarchy-plugin-add <that-url> --yes` → clone progress then "Added <id> into …" — or "refusing to add: validation failed" preceded by the exact validate error (a pass for the guard; report URL and error).
  * If added: `omarchy-plugin-list | grep <id>` → third-party disabled; `omarchy-plugin-remove <id> --yes` → "Removed <id>."
  * `omarchy-plugin-add https://github.com/omacom-io/this-repo-does-not-exist-404.git --yes; echo "exit=$?"` → git's not-found error, "omarchy-plugin-add: failed to clone …", `exit=1`; `ls -a ~/.config/omarchy/plugins/` shows no `.add.tmp.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Cloning over the NAT can take up to a minute; `GIT_TERMINAL_PROMPT=0` is set by the script so a missing repo fails instead of prompting.
  * Chromium may raise Hyprland's "not responding" dialog while starting — click Wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the browser page with the URL, the clone + "Added" (or the validate refusal with reason), the list line and "Removed", the 404 failure with `exit=1` and a clean plugins listing
  * If unsuccessful
  ** The full stderr of the add and `ls -la ~/.config/omarchy/plugins/`
covers: bin/omarchy-plugin-add (https path), bin/omarchy-plugin-remove, manual/32-shell-plugins.md

### plugin-add-rejects-unsafe-urls   [VM-OK]
description: The URL guard refuses option-shaped URLs, transport helpers and unknown schemes before any clone, each with its own message, and add refuses to proceed non-interactively without `--yes`. Protects the pre-clone security check.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and run, each followed by `; echo "exit=$?"`:
    `omarchy-plugin-add 'ext::sh -c id' --yes` → "…names a git option or transport helper, not a repository.", `exit=1`.
    `omarchy-plugin-add --upload-pack=id --yes` → "unknown add option: --upload-pack=id", `exit=1`.
    `omarchy-plugin-add 'gopher://example.org/repo' --yes` → "…names the 'gopher' transport, which Omarchy does not clone from.", `exit=1`.
  * `omarchy-plugin-add file:///tmp/nonexistent --yes; echo "exit=$?"` → git error then "failed to clone", `exit=1`.
  * `omarchy-plugin-add file:///tmp/nonexistent < /dev/null; echo "exit=$?"` → "refusing to continue without confirmation; pass --yes", `exit=1`.
  * `ls -a ~/.config/omarchy/plugins/ 2>/dev/null` → no `.add.tmp.*` directories.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On the 4.0.2 disk the transport-helper guard may predate the build: if `ext::` reaches `git clone`, record `omarchy-version` and report version skew.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with each message and `exit=1`, and the clean plugins listing
  * If unsuccessful
  ** The URL that reached `git clone` (visible as git output) or left a temp dir, with `omarchy-version`
covers: bin/omarchy-plugin-add, bin/omarchy-git-url-check, test/shell.d/plugin-add-test.sh

### plugin-validate-rejects-bad-manifests   [VM-OK]
description: `omarchy plugin validate` refuses the manifest shapes the shell would reject — string schemaVersion, missing field, reserved id, missing entry point, kind without entry point, symlink — and accepts a correct one. Protects the CLI/shell contract.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `mkdir -p /tmp/bad && cd /tmp/bad && printf 'import QtQuick\nItem {}\n' > W.qml`.
  * Write the good manifest and check it: `printf '%s' '{"schemaVersion":1,"id":"a.b","name":"n","version":"1","kinds":["service"],"entryPoints":{"service":"W.qml"}}' > manifest.json; omarchy-plugin-validate /tmp/bad; echo "exit=$?"` → silent, `exit=0`.
  * Now break it one way at a time with `sed -i` and re-run validate after each, expecting `exit=1` and the message:
    `sed -i 's/"schemaVersion":1/"schemaVersion":"1"/' manifest.json` → "unsupported or missing schemaVersion (expected 1)"; `sed -i 's/"schemaVersion":"1"/"schemaVersion":1/' manifest.json` to restore.
    `sed -i 's/"id":"a.b"/"id":"omarchy.fake"/' manifest.json` → "uses the reserved omarchy.* namespace"; restore with the reverse sed.
    `sed -i 's/W.qml/Missing.qml/' manifest.json` → "entry point file not found: 'Missing.qml'"; restore.
    `sed -i 's/"service"\]/"bar-widget"]/' manifest.json` → "kind 'bar-widget' requires an 'entryPoints.barWidget' to load"; restore.
  * `ln -s /etc/passwd /tmp/bad/link; omarchy-plugin-validate /tmp/bad; echo "exit=$?"` → "symlinks are not allowed inside a plugin folder: /tmp/bad/link", `exit=1`; `rm /tmp/bad/link`.
  * `omarchy-plugin-validate /tmp/nowhere; echo "exit=$?"` → "plugin folder not found", `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the terminal fullscreen (Super+F) so all messages stay on screen; otherwise pipe the whole sequence through `sudo tee /dev/ttyS0` and read it with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with the silent `exit=0` and each refusal message with `exit=1`
  * If unsuccessful
  ** The manifest that was accepted or refused wrongly
covers: bin/omarchy-plugin-validate, test/shell.d/plugin-validate-test.sh, test/shell.d/plugins-test.sh

### network-status-wired-nat-and-panel   [VM-OK]
description: On the VM's wired NAT the Network panel shows the wired connection with the expected timeout readings, the status helper reports ethernet with address and gateway, and the Wi-Fi QR row is hidden. Protects the shell's network data source.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W → the Network panel opens: a wired/ethernet entry, no Wi-Fi list or radio switch; Ping "Timeout" and Packet Loss "100%" in red are the expected NAT reading. Screenshot; Escape.
  * Open a terminal: `omarchy-network-status` → `ethernet` followed by the interface name (e.g. `enp0s3`).
  * `omarchy-network-status --verbose` → `ip 10.0.2.15`, `prefix 24`, `gateway 10.0.2.2`, `type ethernet`, `router_ping_ms <n>` and `internet_ping_ms` with an EMPTY value (ICMP to the internet is blocked).
  * `omarchy-network-status --frob; echo "exit=$?"` → Usage, `exit=2`.
  * Press Super+Space, click Setup → Network: only "DNS" is listed — no "QR Code" row on a wired connection. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The red Timeout/100% in the panel is not a failure; user-mode NAT drops ICMP.
  * `Super+Ctrl+1` also opens the Network panel (first right-section panel on the VM).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Network panel screendump, the status line, the verbose block with the empty internet ping, the usage error with `exit=2`, the Setup → Network menu without QR Code
  * If unsuccessful
  ** `ip -j route get 1.1.1.1` and `nmcli device status`
covers: bin/omarchy-network-status, default/omarchy/omarchy-menu.jsonc (setup.network.qr when), default/hypr/bindings/utilities.lua (SUPER+CTRL+W), test/shell.d/network-test.sh

### network-wifi-helpers-absent   [VM-PARTIAL]
description: Without a Wi-Fi radio the band, password and QR helpers fail with their specific messages and never crash. Only the negative paths are runnable.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and run, each followed by `; echo "exit=$?"`:
    `omarchy-network-band` → nothing, `exit=0`; `omarchy-network-band 5` → "Error: no connected Wi-Fi device.", `exit=1`; `omarchy-network-band 7` → Usage, `exit=1`.
  * `omarchy-network-password wlan9; echo "exit=$?"` → "No active Wi-Fi connection", `exit=1`.
  * `omarchy-network-qr; echo "exit=$?"` → "No active Wi-Fi connection", `exit=1`.
  * `nmcli device status` → no wifi rows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-network-band` and `omarchy-network-qr --meta` are HEAD-only; `command not found` means "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with each message and exit code
  * If unsuccessful
  ** Any helper that printed a QR matrix or a password on a wired-only VM
covers: bin/omarchy-network-band, bin/omarchy-network-password, bin/omarchy-network-qr, test/shell.d/network-password-test.sh, test/shell.d/network-qr-test.sh, test/shell.d/wifiqr-test.sh

### dns-switch-providers-from-menu   [VM-OK] [NET]
description: The DNS provider switches between DHCP, Cloudflare and Google from Setup → Network → DNS with the ✓ following, names keep resolving after each switch, and it returns to DHCP. Protects `omarchy-dns` and its passwordless privilege path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-dns` → `DHCP`; `getent hosts omarchy.org` → an address.
  * Press Super+Space, click Setup → Network → DNS: "DHCP" carries a ✓. Click "Cloudflare".
  ** It applies silently (sudoers rule); if a polkit dialog appears instead, type `prime` and note it.
  * `omarchy-dns` → `Cloudflare`; `grep ^DNS /etc/systemd/resolved.conf` → `1.1.1.1#cloudflare-dns.com …`; `getent hosts omarchy.org` still resolves; the browser (Super+Shift+Enter) loads https://omarchy.org.
  * Reopen Setup → Network → DNS twice: ✓ is on Cloudflare. Click "Google" → `omarchy-dns` → `Google`, resolved.conf shows `8.8.8.8#dns.google`.
  * Setup → Network → DNS → "DHCP" → `omarchy-dns` → `DHCP`; `grep ^DNS /etc/systemd/resolved.conf` → nothing; names still resolve.
  * `omarchy-dns Quad9; echo "exit=$?"` → Usage, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Menu ✓ marks repaint one evaluation late: reopen the submenu twice before asserting.
  * Chromium may show a "not responding" dialog on start; click Wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Menu screendumps with the ✓ on DHCP → Cloudflare → Google → DHCP; `omarchy-dns` outputs; the resolved.conf lines; a successful `getent`; the browser page; the usage error with `exit=1`
  * If unsuccessful
  ** `journalctl -b -u NetworkManager -u systemd-resolved | tail -30 | sudo tee /dev/ttyS0` and the failing dialog/terminal
covers: bin/omarchy-dns, default/omarchy/omarchy-menu.jsonc (setup.network.dns.*), test/shell.d/dns-sudoers-test.sh, test/shell.d/network-manager-transition-test.sh, manual/35-networking.md

### dns-custom-servers-and-empty-input   [VM-OK]
description: The Custom DNS entry opens a terminal, accepts a space-separated server list and reports Custom; an empty answer is rejected without changing anything, and DHCP restores the default. Protects the interactive branch of `omarchy-dns`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, click Setup → Network → DNS → "Custom".
  ** A floating "Omarchy" terminal asks "Enter your DNS servers (space-separated, e.g. '192.168.1.1 1.1.1.1'):" (a polkit dialog may ask for `prime` first). Type `9.9.9.9 149.112.112.112`, Enter; Done → Enter.
  * Open a terminal: `omarchy-dns` → `Custom`; `grep ^DNS /etc/systemd/resolved.conf` → `DNS=9.9.9.9 149.112.112.112`; `getent hosts archlinux.org` resolves.
  * Reopen Setup → Network → DNS twice: ✓ on Custom. Click "Custom" again and press Enter on the empty line → "Error: No DNS servers provided." and a Failed prompt; Enter.
  * `omarchy-dns` → still `Custom` with the same servers.
  * `omarchy-dns DHCP` → `omarchy-dns` → `DHCP`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Custom has no passwordless sudoers rule, so a polkit password dialog is expected on this path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the prompt, resolved.conf with the two servers, ✓ on Custom, the empty-input error, and the return to DHCP
  * If unsuccessful
  ** The floating terminal's text and `cat /etc/systemd/resolved.conf`
covers: bin/omarchy-dns (Custom, normalize_servers, split_dns_servers), default/omarchy/omarchy-menu.jsonc (setup.network.dns.custom), bin/omarchy-launch-floating-terminal-with-presentation

### network-speedtest-panel-and-cli   [VM-OK] [NET]
description: The speed test panel measures download and upload over the NAT with dials, and the CLI prints one Mbit/s sample per second. Protects the fast.com based tester. (Transfers tens of MB.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, click Trigger → Speed Test → "Network Speed Test".
  ** A panel with dials opens; the download dial fills with a non-zero Mbit/s value, then the upload one. Wait until both settle (≤ 60 s); Escape.
  * Open a terminal: `timeout 8 omarchy-network-speedtest down` → several non-zero numbers; `timeout 8 omarchy-network-speedtest up` → likewise.
  * `omarchy-network-speedtest; echo "exit=$?"` → Usage, `exit=2`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Failed to fetch speed test endpoints" means api.fast.com was unreachable — retry once, then report a network condition.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Panel screendump with values on both dials; terminal samples; the usage error with `exit=2`
  * If unsuccessful
  ** The CLI error line and `curl -sI https://api.fast.com | head -1`
covers: bin/omarchy-network-speedtest, default/omarchy/omarchy-menu.jsonc (trigger.tests.network-speedtest), manual/35-networking.md
dedupe-with: test_def/12-manual-config.md (network-speedtest-panel-and-cli)

### bluetooth-absent-graceful   [VM-PARTIAL]
description: Without an adapter the Bluetooth helpers fail fast with clear messages, `off` still succeeds, and the panel opens in its empty state. Only the no-adapter paths are runnable.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+B → the Bluetooth panel opens in an empty / no-adapter state. Screenshot; Escape.
  * Open a terminal: `omarchy-bluetooth-power is-on; echo "exit=$?"` → `exit=1`.
  * `omarchy-bluetooth-power on; echo "exit=$?"` → "omarchy-bluetooth-power: adapter did not come up", `exit=1`, within ~10 s.
  * `omarchy-bluetooth-power off; echo "exit=$?"` → silent, `exit=0`.
  * `omarchy-bluetooth-device connect nope; echo "exit=$?"` → Usage, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bluetooth bar icon hides itself on the VM; the panel still opens by hotkey (behaviour to report either way).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The panel screendump and the terminal with each message and exit code
  * If unsuccessful
  ** A hang beyond 30 s (`pgrep -a bluetoothctl`) or a crash
covers: bin/omarchy-bluetooth-power, bin/omarchy-bluetooth-device, default/hypr/bindings/utilities.lua (SUPER+CTRL+B), test/shell.d/bluetooth-test.sh

### weather-location-set-status-clear   [VM-OK] [NET]
description: The weather location can be set with coordinates, drives the status line, the bar pill and the panel, rejects bad coordinates, and returns to IP auto-detection when cleared. Protects the weather helpers. (Tiny wttr.in requests.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-weather-location` → a city name (IP-detected; retry once if empty).
  * `omarchy-weather-location --set "San Francisco" "37.7749,-122.4194"; omarchy-weather-location` → `San Francisco`; `omarchy-weather-status` → `San Francisco  ·  Temp …  ·  Wind …`.
  * Press Super+Ctrl+Alt+W → the weather panel shows SAN FRANCISCO with a WIND reading; Escape. The bar's weather pill shows a temperature (within 30 s).
  * `omarchy-weather-location --set Nowhere 12,abc; echo "exit=$?"` → "Invalid coordinates: 12,abc (expected lat,lon)", `exit=1`.
  * `omarchy-weather-location --clear; omarchy-weather-location` → the IP city again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Alt+W opens the panel (the manual says notification); right-click on the weather pill is the toast path.
  * "Weather unavailable" means wttr.in did not answer within 4 s — retry once before reporting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps of the location names and status line, the panel with SAN FRANCISCO / WIND, the bar pill, the rejection with `exit=1`, and the cleared state
  * If unsuccessful
  ** `curl -sS --max-time 4 'https://wttr.in/?format=%l'` output to separate an outage from a defect
covers: bin/omarchy-weather-location, bin/omarchy-weather-status, bin/omarchy-weather-icon, bin/omarchy-notification-weather, default/hypr/bindings/utilities.lua (SUPER+CTRL+ALT+W), test/shell.d/weather-test.sh

### hw-detection-absence-in-qemu   [VM-PARTIAL]
description: In the QEMU guest every hardware detector answers "not this hardware" (except the virtual output, host CPU and mesa ICDs), so the Hardware, Toggle and Security menus hide their gated rows and the touchpad/touchscreen/hybrid-GPU toggles refuse cleanly. Only the absence path exists here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+H (Trigger → Hardware): no Laptop Display, Mirror Display, Hybrid GPU, Touchpad, Touchpad Haptics or Touchscreen rows (it may read "Nothing here yet"). Escape. Press Super+Ctrl+O: no "Battery Percentage" row. Escape.
  * Press Super+Space, click Setup → Security: Fido2, SSHD, Passwordless Sudo, Sudoless Docker — no Fingerprint. Escape.
  * Open a terminal and run `for h in asus-rog clamshell dell-xps-oled external-monitors fingerprint framework16 hybrid-gpu intel intel-ptl intel-sof laptop laptop-closed nvidia surface vulkan webcam; do timeout 5 omarchy-hw-$h >/dev/null 2>&1; echo "$h=$?"; done | sudo tee /dev/ttyS0` (password prime) and read it with get-serial.
  ** Every line `=1` except `external-monitors=0` (the virtual output counts as external), `intel=0` on an Intel host, and `vulkan=0` if mesa ICDs are installed; no `=124`.
  * `omarchy-hw-touchpad; echo "exit=$?"` → empty, `exit=1`; `omarchy-toggle-touchpad; echo "exit=$?"` → "No touchpad device found", `exit=1`; `omarchy-hw-touchscreen; echo "exit=$?"` → empty, `exit=1` (if it prints a device name, do NOT run the touchscreen toggle — it would disable the pointer — report the name instead).
  * `omarchy-hw-match "Standard PC"; echo "exit=$?"` → `exit=0`; `omarchy-hw-match XPS; echo "exit=$?"` → `exit=1`; `omarchy-hw-display; echo "exit=$?"` → empty, `exit=1`.
  * `ls ~/.local/state/omarchy/toggles/hypr/` → no `*-disabled-name` file was created. Do NOT run `omarchy-toggle-hybrid-gpu` (it installs supergfxctl).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A fully guarded submenu vanishes from its parent; opening its route shows "Nothing here yet" — that is the pass.
  * Report `grep -m1 vendor_id /proc/cpuinfo` and `ls /usr/share/vulkan/icd.d` alongside the intel/vulkan answers.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the three menus without the gated rows, the serial dump with the `name=code` list, the touchpad/touchscreen/match/display lines, and the toggles listing
  * If unsuccessful
  ** Any detector returning 0 unexpectedly (or 124), a gated row that is present, or a state file created
covers: bin/omarchy-hw-* (all 28), bin/omarchy-toggle-input-device, bin/omarchy-toggle-touchpad, bin/omarchy-toggle-touchscreen, bin/omarchy-toggle-hybrid-gpu (gating only), default/omarchy/omarchy-menu.jsonc (when gates), test/shell.d/hw-{display,external-monitors,fingerprint,hybrid-gpu,nvidia}-test.sh, test/shell.d/toggle-input-device-test.sh

### audio-tuning-no-match-paths   [VM-PARTIAL]
description: The speaker-tuning manager reports that nothing ships for this machine and leaves audio untouched on every verb, refusing bad verbs. Only the no-match branches are runnable in the VM.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal: `omarchy-audio-tuning status` → `Installed:    no`, `Host service: inactive (disabled)`, `Tuning sink:  absent`, `Default sink: auto_null`, `Matches:      nothing ships for this laptop`.
  * `omarchy-audio-tuning on; echo "exit=$?"` → "No speaker tuning matches this laptop.", `exit=0`; `ls ~/.config/pipewire/ 2>/dev/null` → no `omarchy-speaker-tuning*`.
  * `omarchy-audio-tuning off; echo "exit=$?"` → "No speaker tuning installed.", `exit=0`.
  * `omarchy-audio-tuning dance; echo "exit=$?"` → Usage, `exit=2`.
  * `wtype -k XF86AudioRaiseVolume` → the volume OSD still works (audio untouched); lower it back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * HEAD-only command; `command not found` on 4.0.2 means "absent on this build".
  * `Host service: not-found` instead of `inactive` is acceptable — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendump with the status block, each message and exit code, and the OSD afterwards
  * If unsuccessful
  ** Any file created under ~/.config/pipewire or ~/.config/systemd/user
covers: bin/omarchy-audio-tuning, docs/audio-tuning.md, bin/omarchy-audio-output-sink, bin/omarchy-audio-sink-availability

### Not runnable here (VM-NO appendix — recorded for a hardware bench, keep out of TESTS.md's main list)

### clamshell-lid-close-disables-laptop-panel   [VM-NO]
description: Closing the lid of a docked laptop disables the internal panel (remembering its scale) and opening it re-enables it at the same scale; the watcher reconciles drift. Needs a lid switch and a second output.
instruction: |
  <Instructions>
  From the desktop please do the following (laptop with an external monitor attached):

  <ActionList>
  * Open a terminal: `omarchy-hyprland-monitor-laptop` → eDP-1.
  * Close the lid; within 3 s the external carries everything; `ls ~/.local/state/omarchy/toggles/hypr/` shows `internal-monitor-clamshell.lua` and `internal-monitor-scale`.
  * Open the lid → the panel returns at its previous scale and the clamshell file is gone.
  * Press Super+Ctrl+Delete → toast "Laptop display disabled"; again → "Laptop display enabled".
  * Unplug the external while the panel is disabled → it re-enables within a few seconds.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in QEMU: no lid, no second output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Photos/screendumps of the external-only state, the state files, and the panel restored at the same scale
  * If unsuccessful
  ** `hyprctl monitors all -j` and the toggles/hypr listing
covers: bin/omarchy-hyprland-monitor-clamshell, bin/omarchy-hyprland-monitor-watch, bin/omarchy-hyprland-monitor-internal, bin/omarchy-hw-clamshell, bin/omarchy-hw-laptop-closed, test/shell.d/monitor-clamshell-scale-test.sh, test/shell.d/monitor-recovery-test.sh

### touchpad-toggle-persists-across-reload   [VM-NO]
description: Disabling the touchpad stores the device name as data, the OSD confirms, the pointer stops moving, and a Hyprland reload keeps it disabled; enabling clears the file. Needs a real touchpad.
instruction: |
  <Instructions>
  From the desktop please do the following (laptop):

  <ActionList>
  * Press Super+Ctrl+H, click "Touchpad" → OSD "Touchpad disabled"; the touchpad no longer moves the pointer.
  * Open a terminal (external mouse): `cat ~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name` → the device name.
  * `hyprctl reload` → still disabled (a finger on the pad does nothing).
  * `omarchy-toggle-touchpad on` → OSD "Touchpad enabled", the pointer moves, the file is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in QEMU: the USB tablet is a mouse.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** OSD screendumps, the name file appearing and disappearing, and the pointer behaviour before/after reload
  * If unsuccessful
  ** The device name and `hyprctl devices -j`
covers: bin/omarchy-toggle-input-device, bin/omarchy-toggle-touchpad, default/hypr/disabled-input-device.lua, default/hypr/toggles.lua, test/shell.d/toggle-input-device-test.sh

### speaker-tuning-on-matching-laptop   [VM-NO]
description: On a laptop with a shipped tuning, `omarchy audio tuning on` installs the filter-chain host, the tuning sink becomes the default, the physical sink is hidden from the output list, volume keys move the physical sink, and `off` restores raw speakers. Needs matching DMI hardware.
instruction: |
  <Instructions>
  From the desktop please do the following (e.g. Dell XPS 14 with a shipped tuning):

  <ActionList>
  * Open a terminal: `omarchy-audio-tuning status` → Matches names the tuning; `omarchy-audio-tuning on` → "Installed speaker tuning: …" then "Speakers now play through the tuning."
  * Press Super+Ctrl+A → one speaker entry (the physical sink is hidden).
  * Volume keys → the OSD moves and the physical sink's volume follows.
  * `omarchy-audio-tuning on` → "Speaker tuning already current"; `omarchy-audio-tuning off` → "Speaker tuning removed."; the audio panel shows the raw speakers again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in QEMU: DMI is QEMU and there is no physical sink.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps of each message, the audio panel with one speaker entry, the OSD and the physical sink volume agreeing
  * If unsuccessful
  ** `systemctl --user status omarchy-speaker-tuning.service` and `pactl list sinks short`
covers: bin/omarchy-audio-tuning, bin/omarchy-audio-output-sink, bin/omarchy-audio-sink-availability, bin/omarchy-audio-output-switch, bin/omarchy-audio-output-volume, docs/audio-tuning.md

## Gaps

Behaviours found in scope that cannot be turned into a driver test on this guest, or only partially:

- **Laptop-only monitor plumbing** — `omarchy-hyprland-monitor-clamshell` (scale remembering, DPMS, `internal-monitor-clamshell.lua`), `monitor-internal off/on` with a real external, `monitor-internal-mirror on`, `monitor-watch`'s docked poll, the lid `switch:*` binds, `monitor-modeless` returning 0 for a powered-off monitor. QEMU exposes one always-connected `Virtual-1`. (Headless coverage: `monitor-clamshell-scale-test.sh`, `monitor-recovery-test.sh`, `monitor-modeless-test.sh`.)
- **Brightness on real backlights / DDC / Apple displays** — every step path, the 1 % low-range stepping, the DDC bus cache refresh, `asdcontrol`. No backlight, no I²C monitor, no hiddev.
- **Keyboard backlight and mic-mute LED** — no `/sys/class/leds/*kbd_backlight*` or `platform::micmute`.
- **Touchpad/touchscreen disable and the reload restore** — the QEMU tablet is a mouse; hand-editing the state file would not prove the toggle.
- **Real audio** — sinks with ports, output rotation across several sinks, mic mute actually muting, media source switching with players, every positive branch of `omarchy-audio-tuning`, the USB-reset branch of `omarchy-restart-audio`.
- **Wi-Fi** — band pinning, PSK/WEP printing, the Wi-Fi QR share card, `omarchy-restart-wifi` rescanning, the Network panel's scan/connect flow.
- **Bluetooth** — pair/connect/forget, the persisted rfkill state across reboot, `bt-agent`.
- **Hybrid GPU toggle** — installs `supergfxctl` and reboots; unsafe on one virtio GPU.
- **Webcam overlay** — `--with-webcam`, live `omarchy-capture-webcam-resize`, `Super+Alt+[`/`]`. No V4L2 device.
- **Screen recording with audio** — `--with-desktop-audio`/`--with-microphone-audio` would record the Dummy Output/no source; the loudnorm finalisation cannot be heard. The no-audio path itself may be blocked by the kms backend on virtio-gpu (flagged in the test).
- **Media keys as physical keys** — XF86 qcodes are not sendable; `wtype -k` from a guest terminal exercises the bindings but not the driver-level keypress.
- **Third-party bar widget rendering** — a hand-typed `BarWidget` QML through the driver is error-prone; the local-plugin tests use a trivial `service`, and the visible widget path is covered via `omarchy-plugin-clone omarchy.clock`. The interactive bar-section chooser of `omarchy-plugin-add` needs a bar-widget plugin and is skipped for the same reason.
- **`omarchy-notification-battery`** — no battery; the toast has an empty headline on the VM (01-FACTS [10]), which belongs to the battery reviewer.
- **`omarchy-notification-wait`** timeout branch — needs the shell down, which `omarchy-restart-shell` closes within seconds.
- **Idle *lock* after `idle.lock` seconds** and `omarchy-system-sleep-lock` — the idle test only shortens the screensaver; the lock path belongs to the lock-screen reviewer.
- **Reload guard during a real pacman transaction** — only the manual pause/resume is proposed.
- **`omarchy-hyprland-monitor-scaling` persistence into a user-customised `monitors.lua`** (the non-catch-all branch).
- **Multi-monitor `omarchy-capture-region`** (negative coordinates, `--match-monitor` with several outputs).
- **Non-Latin keyboard layouts** (`us,` prepending, `grp:alts_toggle` via `<A-alt_r>`) — needs `/etc/vconsole.conf` with e.g. `XKBLAYOUT=ru` and a re-login; the layout test uses a transient `hyprctl keyword` instead. Editing vconsole.conf and re-logging is drivable but exceeds the per-test budget with the LUKS/login round trip.
