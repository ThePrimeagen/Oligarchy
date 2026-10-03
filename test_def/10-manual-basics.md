# 10 — Manual basics (chapters 01–14)

Reviewer notes for the end-user manual, chapters 01 through 14, cross-checked against the
bindings, the menu definition, `bin/omarchy-*` and the shell plugins at omarchy HEAD 2026-09-18.

## Scope

Source tree: `/tmp/omarchy-review/omarchy` (read-only).

Manual files read completely, line by line:

| file | lines |
|---|---|
| `manual/01-welcome-to-omarchy.md` | 11 |
| `manual/02-getting-started.md` | 39 |
| `manual/03-coming-from-mac-or-windows.md` | 57 |
| `manual/04-navigation.md` | 73 |
| `manual/05-the-top-bar.md` | 134 |
| `manual/06-themes.md` | 127 |
| `manual/07-hotkeys.md` | 374 |
| `manual/08-unified-clipboard-history.md` | 24 |
| `manual/09-reminders.md` | 5 |
| `manual/10-notices.md` | 23 |
| `manual/11-text-extraction-dictation.md` | 15 |
| `manual/12-screenshots-recording.md` | 78 |
| `manual/13-toggles-idle-screensaver.md` | 101 |
| `manual/14-omarchy-cli.md` | 62 |

Total 1123 manual lines.

Source cross-checked in full: `default/hypr/bindings.lua`, `default/hypr/bindings/{applications,clipboard,media,tiling,utilities,voxtype}.lua`,
`default/hypr/helpers.lua` (the `o.bind`/`o.bind_toggle`/`o.preinstalled_bindings_enabled` helpers),
`default/omarchy/omarchy-menu.jsonc` (380 lines, every entry), `config/omarchy/shell.json` (shipped bar/idle defaults),
`config/foot/foot.ini` (clipboard keys), `default/hypr/apps/system.lua` (floating rules), `default/hypr/input.lua` (compose key),
`docs/menu.md`, `docs/notifications.md`, `shell/plugins/bar/README.md`.

`bin/` scripts read in full: `omarchy` (CLI router), `omarchy-menu`, `omarchy-toggle`, `omarchy-toggle-{idle,nightlight,notification-silencing,bar,screensaver,enabled,crash-capture,suspend,fullscreen-desktop,touchpad,hybrid-gpu}`,
`omarchy-reminder`, `omarchy-notification-{time,battery,weather,send,dismiss}`, `omarchy-weather-{location,status}`, `omarchy-battery-{present,status}`, `omarchy-power-present`,
`omarchy-capture-{screenshot,region,text,qr,webcam-resize,screenrecording}`, `omarchy-transcode`, `omarchy-transcode-ascii` (header),
`omarchy-theme-{set,list,switcher,bg-switcher,bg-set,bg-next,current,bg-current}`, `omarchy-plymouth-switcher`,
`omarchy-bar`, `omarchy-plugin-{list,enable,disable}`, `omarchy-shell-config`, `omarchy-refresh-shell`,
`omarchy-launch-screensaver`, `omarchy-screensaver`, `omarchy-system-lock`, `omarchy-menu-keybindings` (first 100 lines),
`omarchy-hyprland-{window-close-all,workspace-layout-toggle,window-pop,window-gaps-toggle,window-transparency-toggle,window-single-square-aspect-toggle,window-tiled-fullscreen-toggle,window-width,monitor-scaling,toggle,toggle-enabled}`,
`omarchy-menu-share`, `omarchy-menu-emoji`, `omarchy-menu-emoji-insert`, `omarchy-clipboard-paste-text`, `omarchy-launch-{about,tui,terminal,browser,nautilus,nautilus-cwd,editor,floating-terminal-with-presentation}`,
`omarchy-audio-output-volume`, `omarchy-audio-output-sink`, `omarchy-osd`, `omarchy-debug`, `omarchy-shell`, `omarchy-restart-xcompose`, `omarchy-brightness-display` (header), `omarchy-hw-{laptop,webcam}`, `omarchy-version`, `omarchy-default-terminal` (header), `omarchy-voxtype-install`.

Shell plugins inspected for behaviour (not every line): `shell/shell.qml` (`togglePanelAt`, config watching), `shell/plugins/bar/Bar.qml` (`panelWidgetIdAt`, `panelNavigationSlots`),
`shell/plugins/bar/widgets/{Indicators,KeyboardLayout,SystemUpdate}.qml`, `shell/plugins/panels/{power,bluetooth,audio,network,monitor,weather,clock}/*`,
`shell/plugins/clipboard/{Clipboard.qml,capture.sh,manifest.json}`, `shell/plugins/menu/Menu.qml` (key handling, `goBack`, `settleCursor`), `shell/plugins/emojis/Emojis.qml`,
`shell/plugins/image-picker/ImagePicker.qml` (key handling), `shell/plugins/reminders/ReminderFlowModel.js`, `shell/plugins/services/idle/*.qml`, `shell/plugins/lock/LockView.qml` (header comment), `shell/plugins/osd/*`.

Skipped: chapters 15–51 (other reviewers), theme file contents, `install/` beyond a package grep (`mint` covers install), Tmux/Ghostty/Neovim/File-manager hotkey tables inside chapter 07 are inventoried but their tests belong to the terminal/neovim reviewers (15, 16).

## Inventory

Format: `item — behaviour — source`. Manual references are `MNN:line`. Source references are relative to the omarchy tree.

#### Chapter 01 — Welcome

- Preinstalled apps named: Neovim, Chromium, Obsidian, LibreOffice, Kdenlive, OBS Studio, a Winamp-style player (cliamp) — M01:3 — `install/omarchy-base.packages`, `install/omarchy-other.packages`.
- Desktop = Arch + Hyprland + Quickshell shell — M01:3 — `shell/shell.qml`.

#### Chapter 02 — Getting started (install flows; `mint` owns the ISO path)

- Full-disk vs free-space install, encryption default — M02:3 — installer (out of scope, `mint`).
- Secure Boot / TPM must be off — M02:7 — installer.
- `Ctrl+C` on the keyboard-selection screen → "install for another owner" (deferred user setup on first boot) — M02:25 — `bin/omarchy-provision-owner`, `bin/omarchy-provision-first-run`.
- Unattended install from a config drive — M02:29 — `install/provisioning/`.
- `Ctrl+C` on the disk-format confirmation → encryption-less install — M02:35.
- Help: `#omarchy-help` on Discord — M02:39 — `bin/omarchy-launch-discord-community` (Learn → Community).

#### Chapter 03 — Coming from Mac/Windows (translation table)

- `Super+Space` → Omarchy menu — M03:9 — `default/hypr/bindings/utilities.lua:1` (`omarchy-menu toggle`).
- `Super+Alt+Space` → Apps menu — M03:9 — `utilities.lua:2` (`omarchy-menu toggle apps`).
- `Super+Return` terminal, `Super+Shift+Return` browser — M03:13 — `applications.lua:2-3`.
- `Super+K` → all keybindings — M03:13, M03:57 — `utilities.lua:10` (`omarchy-menu-keybindings`).
- Bar widgets react to left/right/middle click — M03:13 — `shell/plugins/bar/README.md` module catalogue.
- `Super+T` toggle floating — M03:19 — `tiling.lua:6`.
- `Super+1..4` jump workspace, `Super+Shift+1..4` move window — M03:21 — `tiling.lua:21-26` (loop 1..10).
- `Super+C/X/V` universal copy/cut/paste incl. terminal — M03:25 — `clipboard.lua:45-47`.
- `Super+Ctrl+V` clipboard history — M03:27 — `clipboard.lua:48` (`omarchy-shell shell toggle omarchy.clipboard`).
- AirDrop → LocalSend via `Super+Ctrl+S` — M03:34 — `utilities.lua:85` (`omarchy-menu toggle share`).
- Screenshot → `Print Screen` — M03:35 — `utilities.lua:38`.
- Notification Center → `Super+Shift+Alt+,` history — M03:36 — `utilities.lua:29`.
- Time Machine → snapshots on update — M03:37 — `bin/omarchy-snapshot` (chapter 47 reviewer).
- App Store → Install menu / `omarchy pkg add` — M03:38 — `omarchy-menu.jsonc` `install.*`, `bin/omarchy-pkg-add`.
- System Settings → Setup menu edits config files — M03:39 — `omarchy-menu.jsonc` `setup.*` (`omarchy-launch-config-editor`).
- Update → Omarchy — M03:45 — `omarchy-menu.jsonc:353` `update.omarchy`.
- `Super+W` / `Super+Q` close window; app really quits — M03:49 — `tiling.lua:1-2`.
- Command key is Super on Mac hardware; no remap — M03:53 — `default/hypr/input.lua`.

#### Chapter 04 — Navigation

- Mouse alone cannot launch anything on first start; `Super+Space` is the entry point — M04:3.
- `Super+Return` then `Super+Shift+Return` → two windows tile side by side (dwindle) — M04:5 — Hyprland dwindle, `default/hypr/looknfeel.lua`.
- `Super+J` toggles split orientation (stack / side-by-side), repeat to revert — M04:9,13 — `tiling.lua:5` (`togglesplit`).
- `Super+Shift+Arrow Right` swaps the two windows — M04:13 — `tiling.lua:42-45`.
- `Super+Ctrl+T` Activity monitor (btop) opens **floating** — M04:15 — `utilities.lua:104` `{ tui = "btop" }` → `omarchy-launch-tui` app-id `org.omarchy.btop` → `default/hypr/apps/system.lua:7-9` tag `floating-window` (float, center, 875×600).
- `Super+T` tiles a floating window / floats a tiled one — M04:15 — `tiling.lua:6`.
- `Super+Shift+F` file manager (Nautilus) — M04:15 — `applications.lua:4` (`omarchy-launch-nautilus`).
- `Super+Arrow` moves focus and warps cursor to the new window centre — M04:19 — `tiling.lua:16-19`.
- `Super+Shift+2` moves focused window to workspace 2 and follows; `Super+Shift+1` back — M04:21 — `tiling.lua:24`.
- `Super+Shift+Alt+2` moves window to workspace 2 **without** following — M04:21 — `tiling.lua:25` (`follow = false`).
- Hold `Super` + left mouse drag → move window; `Super` + right mouse drag → resize — M04:23 — `tiling.lua:73-74` (`mouse:272`, `mouse:273`).
- `Super+W` / `Super+Q` close window — M04:25 — `tiling.lua:1-2`.
- `Ctrl+Alt+Delete` closes all windows and jumps to workspace 1 — M04:25 — `tiling.lua:3` → `bin/omarchy-hyprland-window-close-all`.
- `Super+F` fullscreen; `Super+Alt+F` full width (maximized, keeps bar); `Super+Ctrl+F` fullscreen inside window (client fullscreen state) — M04:27 — `tiling.lua:7,9-10` → `bin/omarchy-hyprland-window-tiled-fullscreen-toggle`.
- Default layout dwindle; keeps all windows visible — M04:31.
- `Super+L` toggles the current workspace to scrolling layout and back; choice is per workspace and persists across restart — M04:35,39 — `tiling.lua:14` → `bin/omarchy-hyprland-workspace-layout-toggle` (writes `~/.local/state/omarchy/workspace-layouts/<ws>.lua`, sends toast "Workspace layout set to <layout>").
- Same toggle under Trigger → Toggle → Workspace Layout — M04:39 — `omarchy-menu.jsonc:97` `trigger.toggle.workspace-layout`.
- Default layout override in `~/.config/hypr/looknfeel.lua` (`general.layout = "scrolling"`) — M04:41-49.
- `Super+G` toggles a group; new windows started while grouped join it — M04:53 — `tiling.lua:76`.
- `Super+Ctrl+Left/Right` move between grouped windows — M04:53 — `tiling.lua:87-88` (`group.prev/next`).
- `Super+Alt+1..4` jump to nth grouped window — M04:53 — `tiling.lua:93-95` (loop 1..5).
- `Super+Alt+G` moves window out of group — M04:55 — `tiling.lua:77`.
- `Super+G` again disassembles the group — M04:55 — `tiling.lua:76` (`group.toggle`).
- `Super+Alt+Arrows` move a window into an adjacent group — M04:55 — `tiling.lua:79-82`.
- `Super+O` pops a window: float, 1300×900, centred, pinned, on top, tagged `pop`; again un-pins and re-tiles — M04:59 — `tiling.lua:11` → `bin/omarchy-hyprland-window-pop`.
- Scratchpad: `Super+Grave` or `Super+S` toggle; `Super+Shift+Grave` or `Super+Alt+S` move window there (without following) — M04:65 — `tiling.lua:28-31` (`special:scratchpad`).
- Leave the scratchpad by sending the window to a normal workspace (`Super+Shift+1`) — M04:67.
- Single window on scratchpad is a centred panel; two windows go full width — M04:69 — `default/hypr/workspace-layouts.lua` / special-workspace rules.

#### Chapter 05 — The top bar

- Bar is part of the single Quickshell `omarchy-shell` process with menu, notifications, OSD, lock — M05:3 — `shell/shell.qml`.
- Default layout: left = menu logo, workspaces; center = indicators, clock, keyboard layout, weather, update badge; right = tray, agents, bluetooth, network, audio, display (monitor), power — M05:9 — `config/omarchy/shell.json`.
- Keyboard layout widget only with >1 layout — M05:11 — `shell/plugins/bar/widgets/KeyboardLayout.qml:231`.
- Update badge only when an update is waiting — M05:11 — `widgets/SystemUpdate.qml:23`.
- Agents icon only after AI coding usage detected — M05:11 — `shell/plugins/agents/Main.qml:11` (`visible: false` by default).
- Menu widget: left = Omarchy menu, right = new terminal — M05:19 — `shell/plugins/menu/BarWidget.qml:20`.
- Workspaces widget: left = focus workspace — M05:20 — `widgets/Workspaces.qml`.
- Clock: left = calendar popup, right = cycle label format (`format` ↔ `formatAlt`), middle = timezone picker — M05:21 — `shell/plugins/panels/clock/BarWidget.qml:159-160` (`omarchy-menu-timezone`).
- Weather: left = forecast popup, right = full weather notification, middle = refresh — M05:22 — `shell/plugins/panels/weather/BarWidget.qml:78-80` (`omarchy-notification-send "$(omarchy-weather-status)"`).
- Audio: left = panel, right = mute, middle = panel, scroll = volume — M05:23 — `shell/plugins/panels/audio/Panel.qml`.
- Microphone (off by default): left = mute mic, middle = audio panel, scroll = input volume — M05:24,34 — `widgets/Microphone.qml`.
- Network: left = panel — M05:25 — `panels/network/Panel.qml`.
- Bluetooth: left = panel, right = toggle radio; hidden with no adapter — M05:26 — `panels/bluetooth/Panel.qml:500` (`visible: adapter !== null`).
- Display: left = panel, scroll = brightness — M05:27 — `panels/monitor/Panel.qml`.
- Power: left = panel, right = toggle battery percentage; hidden without battery — M05:28 — `panels/power/Panel.qml:204` (`visible: batteryPresent`).
- Media (off by default): left = play/pause, right = cover popup, middle = next, scroll = prev/next — M05:29,34 — `shell/plugins/services/media`.
- Agents: left = panel, right = launch agent, middle = next subscription — M05:30 — `shell/plugins/agents/`.
- Tray: hover reveals drawer, right on chevron manages — M05:31 — `widgets/Tray.qml`.
- Omarchy update badge: left = run the update — M05:32 — `widgets/SystemUpdate.qml`.
- Panel hotkeys: `Super+Ctrl+A` audio, `Super+Ctrl+W` network, `Super+Ctrl+B` bluetooth, `Super+Ctrl+D` display, `Super+Ctrl+P` power, `Super+Ctrl+Alt+D` calendar — M05:40-47 — `utilities.lua:98-103` (`omarchy-shell shell toggle omarchy.{audio,bluetooth,monitor,clock,network,power}`).
- `Super+Ctrl+1..9` toggles the nth **visible** panel in the right section, skipping the tray and hidden widgets — M05:48,61 — `utilities.lua:110-116` → `shell/shell.qml:1720` `togglePanelAt` → `Bar.qml:655` `panelWidgetIdAt` / `panelNavigationSlots` (only `item.visible === true`).
- Audio panel: master slider, output picker, per-app mixer — M05:52 — `panels/audio/Panel.qml`.
- Network panel: Wi-Fi scan, signal, connect, DNS provider — M05:53 — `panels/network/Panel.qml`.
- Bluetooth panel: device list, connect/disconnect, battery — M05:54.
- Power panel: battery stats, power profiles (separate AC/battery memory), system info — M05:55 — `panels/power/Panel.qml`, `bin/omarchy-powerprofiles-*`.
- Display panel: brightness slider, text size, scaling presets, per-monitor controls with >1 screen — M05:56 — `panels/monitor/Panel.qml:583,757,795`.
- Clock panel: month grid, ISO week numbers, month stepping — M05:57 — `panels/clock/Panel.qml`.
- Every panel: arrows move, Return activates, Tab steps to neighbouring panel, Escape closes — M05:59 — `Bar.qml:661` `switchPanelFrom`.
- Tailscale widget/panel after Install → Service → Tailscale: connect/disconnect, accounts, exit node, machine browser, `s` send, `c` copy IP, `n` name, `d` DNS name; `omarchy tailscale send <machine> [file...]` — M05:65-67 — `shell/plugins/panels/tailscale/`, `bin/omarchy-tailscale-send`.
- Dropbox widget/panel after Install → Service → Dropbox: login, storage, recent files — M05:69 — `shell/plugins/panels/dropbox/`.
- Removing the service removes the widget — M05:71 — `bin/omarchy-remove-service-{tailscale,dropbox}`.
- Indicators widget: DND, night light, reminder, screen recording, stay awake, dictation; hidden when inactive, hover to reveal, click toggles — M05:75 — `shell/plugins/bar/indicators/{Dnd,NightLight,Reminder,ScreenRecording,StayAwake,Dictation}.qml`, `widgets/Indicators.qml:17-18`.
- `alwaysShow: true` and `items: [...]` on the indicators entry; multiple indicators widgets allowed — M05:77 — `widgets/Indicators.qml:17,45`.
- Drag empty bar space (or click-and-hold) to another edge moves the bar; vertical bars use compact forms — M05:83 — `Bar.qml` drag handling, `bar/README.md` Orientation.
- Double-left-click empty centre space toggles transparency — M05:83 — `Bar.qml`.
- Drag a widget to reorder / move between sections — M05:83 — `Bar.qml`.
- Style → Menu Bar → Position (Top/Bottom/Left/Right) and → Transparency — M05:85 — `omarchy-menu.jsonc:108-118`.
- `omarchy bar position <top|bottom|left|right>` — M05:90 — `bin/omarchy-bar` `cmd_position` (rejects other values).
- `omarchy bar transparent toggle` (`true|false|toggle`) — M05:91 — `bin/omarchy-bar` `cmd_transparent`.
- `omarchy bar move <id> --section <s> --index <n>` — M05:92 — `bin/omarchy-bar` `cmd_move` (via `omarchy-shell shell moveBarWidget`).
- `omarchy bar set <id> <key> <value>` — M05:93 — `bin/omarchy-bar` `cmd_set`.
- `omarchy bar defaults` restores the shipped layout (+ tailscale/dropbox if installed) — M05:94 — `bin/omarchy-bar` `cmd_defaults`.
- Also present but not in manual: `omarchy bar use <id>`, `omarchy bar reset`, `omarchy bar put <id>` — `bin/omarchy-bar` usage.
- `omarchy plugin list` prints id/state/source/kinds/name — M05:97 — `bin/omarchy-plugin-list`.
- `omarchy plugin enable omarchy.media --section center` — M05:100 — `bin/omarchy-plugin-enable` (`unknown` → "plugin '<id>' is not known").
- `omarchy plugin disable omarchy.weather` — M05:101 — `bin/omarchy-plugin-disable`.
- `Super+Shift+Space` toggles bar visibility without killing the shell — M05:106 — `utilities.lua:16` (`o.bind_toggle` → `omarchy-toggle-bar`), flag `~/.local/state/omarchy/toggles/bar-off`.
- Trigger → Toggle → Menu Bar — M05:106 — `omarchy-menu.jsonc:95` `trigger.toggle.top-bar`.
- Config file `~/.config/omarchy/shell.json`, `bar` key: `position`, `transparent`, `centerAnchor`, `layout.{left,center,right}`; widget settings inline (`format`, `formatAlt`, `verticalFormat`) — M05:110-128 — `config/omarchy/shell.json`, `bar/README.md`.
- `centerAnchor` pins one centre widget; empty string centres the group — M05:130.
- Once a user `shell.json` exists it is canonical (no deep merge); `omarchy bar defaults` resets — M05:132 — `bin/omarchy-shell-config` `source_file`, `shell/shell.qml:74`.
- Top-level `idle.screensaver` (150 s) and `idle.lock` (300 s) — M05:134 — `config/omarchy/shell.json:3-6`.

#### Chapter 06 — Themes

- 22 shipped themes — M06:3 — `themes/` (22 dirs: catppuccin, catppuccin-latte, ethereal, everforest, flexoki-light, gruvbox, hackerman, kanagawa, last-horizon, lumon, lupine, matte-black, miasma, nord, osaka-jade, retro-82, ristretto, rose-pine, solitude, tokyo-night, vantablack, white).
- Style → Theme opens the theme switcher and applies the choice — M06:3 — `omarchy-menu.jsonc:104` `style.theme` (`omarchy-theme-switcher` → `omarchy-theme-set`).
- `Super+Ctrl+Shift+Space` theme picker directly — M06:3 — `utilities.lua:18` (`omarchy-menu toggle theme` → alias of `style.theme`).
- Theme styles desktop, terminal, neovim, btop, Chromium, whole shell; Obsidian manual — M06:5 — `bin/omarchy-theme-set` `post_theme_commands`.
- `Super+Ctrl+Space` background picker — M06:7 — `utilities.lua:17` (`omarchy-menu toggle background` → `style.background`: `omarchy-theme-bg-switcher` → `omarchy-theme-bg-set`).
- Extra themes page / make your own — M06:9 — chapter 43 reviewer; `Install → Style → Theme` (`omarchy-theme-install`).
- Style → Unlock picks the Plymouth unlock design per theme (or `default`) — M06:70 — `omarchy-menu.jsonc:106` `style.unlock` (`omarchy-plymouth-switcher` → `omarchy-plymouth-set-by-theme` / `omarchy-plymouth-reset` in a floating terminal, needs sudo).
- Theme picker is filterable (typing filters), arrows/Tab move, Return applies, Escape cancels — `bin/omarchy-theme-switcher` (`--filterable --show-labels --print-name`), `shell/plugins/image-picker/ImagePicker.qml:410-429`.
- Background picker is not filterable; arrows/Tab, Return, Escape — `bin/omarchy-theme-bg-switcher`.
- CLI: `omarchy theme list`, `omarchy theme set <name>` (case/space insensitive, "Theme 'x' does not exist" exit 1), `omarchy theme current`, `omarchy theme bg next`, `omarchy theme bg set <path>` ("File does not exist"), `omarchy theme bg current` — `bin/omarchy-theme-*`.
- Extra backgrounds in `~/.config/omarchy/backgrounds/<theme>` — M07:178 — `bin/omarchy-theme-bg-next`, `omarchy-theme-bg-switcher`.

#### Chapter 07 — Hotkeys (every row)

Navigating:
- `Super+Space` Omarchy menu — `utilities.lua:1`.
- `Super+Alt+Space` Apps menu — `utilities.lua:2`.
- `Super+Escape` System menu — `utilities.lua:8` (`omarchy-menu toggle system`); `XF86PowerOff` same — `utilities.lua:9`.
- `Super+Ctrl+L` lock — `utilities.lua:127` (`omarchy-system-lock`).
- `Super+W` / `Super+Q` close — `tiling.lua:1-2`.
- `Ctrl+Alt+Del` close all — `tiling.lua:3`.
- `Super+T` float toggle — `tiling.lua:6`.
- `Super+J` toggle split — `tiling.lua:5`.
- `Super+O` pop — `tiling.lua:11`.
- `Super+L` dwindle/scrolling — `tiling.lua:14`.
- `Super+P` pseudo window — `tiling.lua:5` (`window.pseudo`).
- `Super+F` / `Super+Alt+F` / `Super+Ctrl+F` fullscreen / full width / fullscreen-in-window — `tiling.lua:7-10`.
- `Super+1..4` workspace (code binds 1..10) — `tiling.lua:21-23`.
- `Super+Tab` next, `Super+Shift+Tab` previous, `Super+Ctrl+Tab` former workspace — `tiling.lua:33-35`.
- `Super+Shift+1..4` move window; `Super+Shift+Alt+1..4` move silently — `tiling.lua:24-25`.
- `Super+S` / `Super+Grave` scratchpad; `Super+Alt+S` / `Super+Shift+Grave` move to scratchpad — `tiling.lua:28-31`.
- `Super+Shift+Alt+Arrows` move workspace to monitor in direction — `tiling.lua:37-40` (VM: one monitor → no-op).
- `Super+Arrow` focus; `Super+Shift+Arrow` swap — `tiling.lua:16-19,42-45`.
- `Super+Minus` expand left (−100 px), `Super+Equal` shrink left, `Super+Shift+Minus` shrink up, `Super+Shift+Equal` expand down — `tiling.lua:55-58` (`code:20`, `code:21`).
- `Super+Alt+Minus/Equal` ±25 px; `Super+Ctrl+Minus/Equal` ±300 px — `tiling.lua:60-68`.
- `Super+Alt+Home` save width; `Super+Home` restore — `tiling.lua:12-13` → `bin/omarchy-hyprland-window-width` (per class+workspace, toasts "Saved width for …" / "No saved width found for …").
- `Super+Left Mouse` drag; `Super+Right Mouse` resize — `tiling.lua:73-74`.
- `Super+Scroll` workspaces — `tiling.lua:70-71`.
- `Super+G`, `Super+Alt+G`, `Super+Alt+Tab`, `Super+Alt+Shift+Tab`, `Super+Alt+1..5`, `Super+Alt+Arrow`, `Super+Ctrl+Left/Right` (groups) — `tiling.lua:76-95`; also `Super+Alt+Scroll` cycles group (not in manual) — `tiling.lua:90-91`.
- `Super+Ctrl+Z` zoom in (+1 factor each press); `Super+Ctrl+Alt+Z` reset — `utilities.lua:118-125` (`cursor.zoom_factor`).
- `Super+/` scaling up, `Super+Alt+/` down through 1, 1.25, 1.6, 2, 3, 4 — `tiling.lua:97-98` → `bin/omarchy-hyprland-monitor-scaling` (persists into `~/.config/hypr/monitors.lua`, logs to `~/.local/state/omarchy/monitor-scaling.log`).
- `Alt+Tab` / `Alt+Shift+Tab` cycle windows (and bring to top) — `tiling.lua:47-50`.
- `Ctrl+Alt+Tab` / `Ctrl+Alt+Shift+Tab` cycle monitors — `tiling.lua:52-53`.

System controls:
- `Super+Ctrl+A/B/W/D/P`, `Super+Ctrl+Alt+D`, `Super+Ctrl+1-9` — `utilities.lua:98-116`.
- `Super+Ctrl+S` Share menu — `utilities.lua:85` → `trigger.share` (Clipboard / File / Folder / Receive) — `omarchy-menu.jsonc:86-89`, `bin/omarchy-menu-share` (LocalSend `--headless send`).
- `Super+Ctrl+T` Activity (btop) — `utilities.lua:104`.
- `Super+Ctrl+C` Capture menu — `utilities.lua:4` (`omarchy-menu toggle capture`).
- `Super+Ctrl+O` Toggle menu — `utilities.lua:5` (`omarchy-menu toggle toggle`).
- `Super+Ctrl+H` Hardware menu — `utilities.lua:6` (`omarchy-menu toggle hardware`).
- `Super+Ctrl+Q` Calculator (omacalc, floating) — `utilities.lua:13`, `default/hypr/apps/system.lua:32`; `XF86Calculator` same.
- `Super+Ctrl+E` Emoji picker — `utilities.lua:3` (`omarchy-shell shell toggle omarchy.emojis`).
- `Super+Ctrl+.` Transcode — `utilities.lua:87` (`omarchy-transcode`).
- `Super+Shift+Ctrl+A` pick an AI agent — `utilities.lua:97` (`omarchy-agent --pick`).

Adjustments (all XF86 keys; not sendable by the driver):
- `Shift+BrightnessUp/Down` max/min; `Alt+BrightnessUp/Down` 1 % — `media.lua:8-9,20-21` (`omarchy-brightness-display`).
- `Alt+VolumeUp/Down` 1 % — `media.lua:18-19` (`omarchy-audio-output-volume +1/-1`).
- Keyboard brightness up/down/cycle — `media.lua:10-12`.
- `Alt+Play` next, `Alt+Shift+Play` previous — `media.lua:25,29`.
- Also: `XF86AudioRaise/Lower/Mute`, `XF86AudioMicMute`, `XF86TouchpadToggle/On/Off`, `XF86Eject` — `media.lua:2-15,30`.

Launching apps (essential, always bound):
- `Super+Return` terminal (`omarchy-launch-terminal`, cwd of active terminal) — `applications.lua:2`.
- `Super+Shift+Return` browser; **`Super+Shift+B` also browser (not in manual)** — `applications.lua:3,6`.
- `Super+Shift+Alt+B` private browser — `applications.lua:7` (`omarchy-launch-browser --private` → `--incognito`).
- `Super+Shift+F` files; `Super+Alt+Shift+F` files in terminal cwd — `applications.lua:4-5`.
- `Super+Shift+N` editor — `applications.lua:8` (`omarchy-launch-editor`, default `nvim` in a TUI window).

Launching apps (preinstalled group; disabled after Remove → Preinstalls via `~/.local/state/omarchy/preinstalls-removed`) — `applications.lua:10-34`, `helpers.lua:84-90`:
- `Super+Alt+Return` Tmux; `Super+Ctrl+Return` Herdr; `Super+Shift+M` Spotify; `Super+Shift+Alt+M` cliamp; `Super+Shift+D` LazyDocker (`omarchy-launch-docker-tui`); `Super+Shift+G` Signal; `Super+Shift+O` Obsidian; `Super+Shift+W` Omawrite; `Super+Shift+/` 1Password.
- Web apps: `Super+Shift+A` ChatGPT, `Super+Shift+Alt+A` Grok, `Super+Shift+C` HEY calendar, `Super+Shift+E` HEY email, `Super+Shift+Alt+E` new HEY email, `Super+Shift+Y` YouTube, `Super+Shift+Alt+G` WhatsApp, `Super+Shift+Ctrl+G` Google Messages, `Super+Shift+P` Google Photos, `Super+Shift+S` Google Maps, `Super+Shift+X` X, `Super+Shift+Alt+X` X compose — `applications.lua:22-33` (`omarchy-launch-webapp`).
- Bindings are changed in `~/.config/hypr/bindings.lua` — M07:127 — Setup → Keybindings (`omarchy-menu.jsonc:127`, only `when` the file exists).

Universal clipboard:
- `Super+C` → `Ctrl+C` (terminal: `Ctrl+Insert`); `Super+V` → `Ctrl+V` (terminal: `Shift+Insert`); `Super+X` → `Ctrl+X` always; `Super+Ctrl+V` history — `clipboard.lua:45-48` (terminal detected by window tag `terminal`, `default/hypr/apps/terminals.lua`); foot maps `Control+Insert` copy / `Shift+Insert` clipboard paste — `config/foot/foot.ini:18-20`.

Capture:
- `Super+Ctrl+C` capture menu — `utilities.lua:4`.
- `Print` screenshot — `utilities.lua:38` (`omarchy-capture-screenshot`).
- `Alt+Print` screenrecord: stops a running recording, else opens Trigger → Capture → Screenrecord — `utilities.lua:39`.
- `Super+Print` colour picker (`pkill hyprpicker || hyprpicker -a`) — `utilities.lua:42`.
- `Super+Ctrl+Print` OCR — `utilities.lua:43` (`omarchy-capture-text`).
- `Super+Alt+[` / `]` webcam overlay smaller/larger — `utilities.lua:40-41` (`code:34/35` → `omarchy-capture-webcam-resize`).
- `Alt+Shift+L` copy current URL (Chromium extension) — `bin/omarchy-chromium-copy-url-host`, `bin/omarchy-install-chromium-copy-url` (chapter 23 reviewer).
- `Alt+Shift+D` download video to `~/Videos` — `bin/omarchy-chromium-ytdlp-host` (chapter 23 reviewer).
- `Super+Ctrl+X` dictation toggle; `F9` push-to-talk (press = start, release = stop) — `voxtype.lua:1-5`, only when `voxtype` is on PATH.
- Screen-recording asks for audio source first, then picker; hit again to stop — M07:156 — `omarchy-menu.jsonc:60-68`.
- All capture options under Trigger → Capture — M07:158 — `omarchy-menu.jsonc:58-68` (Screenshot, Screenrecord{With no audio, With desktop audio, With desktop + microphone audio, With desktop + microphone audio + webcam (when webcam), Stop Screenrecording (when recording)}, Text, QR Code, Color).

Notifications:
- `Super+,` dismiss latest; `Super+Shift+,` dismiss all; `Super+Ctrl+,` toggle silencing (DND); `Super+Alt+,` invoke most recent; `Super+Shift+Alt+,` history — `utilities.lua:25-29` (`omarchy-shell notifications dismissOne/dismissAll/invokeLast/showHistory`, `omarchy-toggle-notification-silencing`).

Style:
- `Super+Ctrl+Shift+Space` theme; `Super+Ctrl+Space` background — `utilities.lua:17-18`.
- `Super+Backspace` toggle window transparency (`opaque` prop toggle on focused window) — `utilities.lua:19` → `bin/omarchy-hyprland-window-transparency-toggle`.
- `Super+Ctrl+Backspace` single-window square aspect (toast "Enable/Disable single-window square aspect ratio") — `utilities.lua:21` → `bin/omarchy-hyprland-window-single-square-aspect-toggle` (`omarchy-hyprland-toggle single-window-aspect-ratio`).
- Extra backgrounds dir; Install → Style → Background — M07:178 — `omarchy-menu.jsonc:202` (`omarchy-theme-bg-install`).

Toggles:
- `Super+Ctrl+I` idle lock (stay awake) — `utilities.lua:31` (`omarchy-toggle-idle`, state file `~/.local/state/omarchy/indicators/stay-awake`).
- `Super+Ctrl+N` nightlight — `utilities.lua:32` (`omarchy-toggle-nightlight`, hyprsunset 4000 K ↔ 6500 K).
- `Super+Ctrl+Delete` laptop display on/off; `Super+Ctrl+Alt+Delete` mirroring — `utilities.lua:33-34` (`omarchy-hyprland-monitor-internal[-mirror] toggle`).
- Lid switch handlers — `utilities.lua:35-36` (`omarchy-system-lid-close`, `omarchy-hyprland-monitor-clamshell`).
- `Super+Shift+Space` bar — `utilities.lua:16`.
- `Shift+Mute` next audio output; `Shift+Play`/`Shift+Pause` next media source — `media.lua:32-34`.
- `Super+Shift+Backspace` window gaps — `utilities.lua:20` → `omarchy-hyprland-toggle window-no-gaps` (copies `default/hypr/toggles/window-no-gaps.lua` into `~/.local/state/omarchy/toggles/hypr/`, `hyprctl reload`).
- `Super+Ctrl+Alt+F` fullscreen desktop = bar off + gaps off together — `utilities.lua:22` → `bin/omarchy-toggle-fullscreen-desktop`.

Reminders: `Super+Ctrl+R` set (`omarchy-menu toggle reminder-set` → `trigger.reminder.set` → `omarchy-reminder -i` → shell `omarchy.reminders` flow), `Super+Ctrl+Alt+R` show (`omarchy-reminder show`), `Super+Ctrl+Shift+R` clear — `utilities.lua:89-91`, `omarchy-menu.jsonc:83-85`.

Notices: `Super+Ctrl+Alt+T` time (`omarchy-notification-time`), `Super+Ctrl+Alt+B` battery (`omarchy-notification-battery`), `Super+Ctrl+Alt+W` weather (`omarchy-notification-weather` → **toggles the `omarchy.weather` panel**, not a toast) — `utilities.lua:93-95`.

Tmux (prefix `Ctrl+Space`/`Ctrl+B`; panes, windows, sessions, copy mode, `tdl`/`tdlm`/`tsl`) — M07:213-279 — `config/tmux/tmux.conf`, `default/bash/functions` (chapter 15 reviewer).
Ghostty (Install → Terminal → Ghostty; splits, tabs, scroll) — M07:281-296 — `config/ghostty/config` (chapter 15 reviewer).
File manager: `Ctrl+L` go to path, `Space` preview, `Backspace` back — M07:298-304 — Nautilus + `org.gnome.NautilusPreviewer` floating rule `apps/system.lua:7`.
Neovim/LazyVim hotkeys — M07:306-334 — chapter 16 reviewer.
Quick emojis `CapsLock M <letter>` (24 sequences) — M07:336-364 — `default/xcompose` (`<Multi_key> <m> <s> : "😄"` …), compose key `compose:caps` in `default/hypr/input.lua:37`, fcitx5 via `omarchy-fcitx5.service`.
Quick completions `CapsLock Space Space` (—), `CapsLock Space N` (name), `CapsLock Space E` (email) — M07:366-372 — `default/xcompose`, `install/user/xcompose.sh`.
`~/.XCompose` + `omarchy-restart-xcompose` — M07:374 — `bin/omarchy-restart-xcompose`; Setup → Config → XCompose does both — `omarchy-menu.jsonc:189`.

#### Chapter 08 — Unified clipboard & history

- `Super+C/X/V` everywhere incl. terminal; `Super+Ctrl+V` history — M08:8-12 — `clipboard.lua`.
- Agent harnesses: `Ctrl+V` for images, `Super+V` for text — M08:14 (note).
- History holds text and images (500 entries, images under `~/.local/state/omarchy/clipboard-images/`) — M08:18 — `shell/plugins/clipboard/Clipboard.qml:40`, `capture.sh`.
- Sensitive copies (`wl-copy --sensitive` / `x-kde-passwordManagerHint`) are not recorded — `capture.sh:15-17`.
- Picker: typing filters; `Return` copies **and pastes** (Shift+Insert) into the focused window; `Shift+Return` copy only; `Alt+Return` open; `Delete` removes entry; `Shift+Delete` clears all (confirm dialog); `Escape` clears filter then closes; Up/Down/PgUp/PgDn/Home/End — `Clipboard.qml:359-397`, `bin/omarchy-clipboard-paste-text`.
- Empty states "Clipboard is empty" / "No matches for “…”" — `Clipboard.qml:600`.

#### Chapter 09 — Reminders

- `Super+Ctrl+R` set (minutes then message flow), `Super+Ctrl+Alt+R` show all, `Super+Ctrl+Shift+R` clear all — M09:3 — `utilities.lua:89-91`.
- Trigger → Reminder → Set one / Show all / Clear all — M09:3 — `omarchy-menu.jsonc:83-85`.
- `omarchy reminder 7 'Tea ready'`; also `-i`, `show [--json]`, `clear`; minutes must be a positive integer (else usage, exit 1); confirmation toast "Reminder set for N minutes" / "<msg> in N minutes" → "You'll be reminded at HH:MM"; fires via `systemd-run --user --on-active`; indicator refresh — `bin/omarchy-reminder`.
- Show: "Upcoming reminders" toast or "No outstanding reminders"; Clear: "All reminders have been cleared" — `bin/omarchy-reminder` `show_reminders`, `clear_reminders`.

#### Chapter 10 — Notices

- `Super+Ctrl+Alt+T` → low-urgency toast "<Weekday> HH:MM · DD Month YYYY · Week NN" — M10:7 — `bin/omarchy-notification-time`.
- `Super+Ctrl+Alt+W` weather — M10:13 — `bin/omarchy-notification-weather` (panel toggle).
- Location from IP; `omarchy weather location --set Malibu [34.0259,-118.7798]`, `omarchy weather location` shows, `--clear` resets; bad coordinates → "Invalid coordinates: … (expected lat,lon)" exit 1 — M10:17 — `bin/omarchy-weather-location` (state `~/.local/state/omarchy/settings/weather.json`, wttr.in).
- `Super+Ctrl+Alt+B` battery toast "Battery N% · … left · …W / …Wh" — M10:21 — `bin/omarchy-notification-battery` → `omarchy-battery-status` (empty output when no battery → toast with empty headline).

#### Chapter 11 — Text extraction & dictation

- `Super+Ctrl+PrtScr` → freeze, slurp region, tesseract OCR (`OMARCHY_OCR_LANGS`, default `eng`), text to clipboard, toast "Copied text from selection to clipboard"; empty selection exits quietly; no text → exit 1 without toast — M11:5 — `bin/omarchy-capture-text`.
- Paste with `Super+V` — M11:5.
- Dictation via Voxtype: Install → AI → Dictation (`omarchy-voxtype-install`, gum confirm "Install Voxtype + AI model (~150MB)…", base English model, systemd unit, toast "Voxtype Dictation Ready") — M11:13 — `omarchy-menu.jsonc:245`, `bin/omarchy-voxtype-install`.
- `voxtype setup model`; `~/.config/voxtype/config.toml` — M11:13 — `default/voxtype/config.toml`.
- Hold `F9` or toggle `Super+Ctrl+X`; text appears in focused input — M11:15 — `voxtype.lua`.
- Remove → AI → Dictation — `omarchy-menu.jsonc:314`.

#### Chapter 12 — Screenshots & recording

- `Print` screenshot; `Alt+Print` record/stop; `Super+Print` colour; `Super+Ctrl+Print` text; `Super+Ctrl+C` capture menu; `Super+Ctrl+.` transcode — M12:5-12 — `utilities.lua:38-43,87`.
- Screen freezes (hyprpicker `-r -z`) during selection; drag = region; single click (<20 px²) snaps to window/monitor rectangle; pressing `Print` again (or the menu entry again) dismisses the picker (`pkill slurp && exit 0`) — M12:16 — `bin/omarchy-capture-screenshot:17`, `bin/omarchy-capture-region` `smart` mode.
- Result: PNG in `~/Pictures` (or `XDG_PICTURES_DIR`, or `OMARCHY_SCREENSHOT_DIR` — created if missing with toast "Created screenshot directory: …") **and** clipboard; toast "Screenshot saved to clipboard and file" / "Edit with Super + Alt + , (or click this)" with thumbnail; click → Tensaku (`OMARCHY_SCREENSHOT_EDITOR`, default `tensaku-edit`) — M12:18-20 — `bin/omarchy-capture-screenshot`.
- File name `screenshot-YYYY-MM-DD_HH-MM-SS.png` — M12:20.
- `omarchy screenshot` (alias) / `omarchy capture screenshot [smart|region|windows|fullscreen] [slurp|copy|save] [--editor=<name>]` — M12:22 — `bin/omarchy-capture-screenshot` header.
- Picker keys while selection is up: `Return` capture highlighted window, `Ctrl+Return` whole screen, `Tab`/`Ctrl+Tab` next/prev window, arrows highlight window in direction (cursor warps) — M12:28-35 — `utilities.lua:50-83` (binds live only while a `selection` layer exists) → `omarchy-capture-region --take-window/--take-fullscreen/--select-window`.
- `Alt+Print` → Trigger → Capture → Screenrecord: no audio / desktop / desktop+mic / +webcam (only with camera) → same picker — M12:39 — `omarchy-menu.jsonc:60-68`, `bin/omarchy-capture-screenrecording`.
- gpu-screen-recorder 60 fps, `-fallback-cpu-encoding yes`; MP4 in `~/Videos` `screenrecording-<ts>.mp4`; `OMARCHY_SCREENRECORD_DIR` must exist (else critical toast "Screen recording directory does not exist: …", exit 1) — M12:41 — `bin/omarchy-capture-screenrecording:24-29`.
- Recording indicator in bar (click stops); stop with `Alt+Print`, or Trigger → Capture → Screenrecord → Stop Screenrecording (only while `gpu-screen-recorder` runs) — M12:43 — `indicators/ScreenRecording.qml`, `omarchy-menu.jsonc:60`.
- Stop: trims first frame, normalises audio to −14 LUFS with 400 ms mute; toast "Screen recording saved" / "Open with Super + Alt + , (or click this)" → mpv; force-kill after 5 s → critical "Screen recording error" — M12:45 — `finalize_recording`, `stop_screenrecording`.
- Webcam overlay bottom-right portrait; `Super+Alt+[`/`]` small/medium/large; `omarchy-capture-webcam-resize small|medium|large|smaller|larger|reset`; anchors to recorded region — M12:49-58 — `bin/omarchy-capture-webcam-resize`.
- Trigger → Capture → QR Code: region → zbarimg QR only → clipboard `--sensitive` (not in history, not printed, not in toast), toast "QR code copied to clipboard"; none found → critical "No QR code found" / "Select a region containing a QR code" — M12:64 — `bin/omarchy-capture-qr`.
- `Super+Print` / Trigger → Capture → Color: hyprpicker eyedropper, colour to clipboard; press again cancels — M12:66 — `utilities.lua:42`, `omarchy-menu.jsonc:64`.
- `Super+Ctrl+.` / Trigger → Transcode: fuzzy file picker over `~/Pictures`+`~/Videos` (`omarchy-menu-file`), format (`jpg|png` / `mp4|gif`), size (`high|medium|low` = 3160/2160/1080 px width cap; `4k|1080p|720p`); output `<stem>-<res>.<fmt>` beside original; `file://` URI on clipboard; toasts "Transcoding video…" / "Transcoded to <res> <fmt>" — M12:70-72 — `bin/omarchy-transcode`.
- `omarchy transcode <file> <fmt> <res>`; `--path`; "File not found: …" exit 1; "Unsupported file type"; `omarchy transcode ascii <img> <out>` — M12:74 — `bin/omarchy-transcode`, `bin/omarchy-transcode-ascii`.
- `Super+Ctrl+S` Share → LocalSend — M12:78 — `bin/omarchy-menu-share` (`clipboard` → temp file; `file`/`folder` → `omarchy-file-select` chooser, chooser failure → critical "Could not share"; `Receive` → `localsend` GUI, floating rule `apps/localsend.lua`).

#### Chapter 13 — Toggles, idle & screensaver

- `Super+Ctrl+O` → Trigger → Toggle — M13:7 — `utilities.lua:5`.
- `omarchy toggle` alone prints the toggle group help — M13:9 — `bin/omarchy` `dispatch_fast_or_help` (`omarchy-toggle` requires args → group help).
- Night light `Super+Ctrl+N` / `omarchy toggle nightlight` (`--status` → JSON `{enabled, temperature}`) — M13:13 — `bin/omarchy-toggle-nightlight`.
- Silence notifications `Super+Ctrl+,` / `omarchy toggle notification silencing` — M13:14 — `bin/omarchy-toggle-notification-silencing` (`omarchy-shell notifications toggleDnd`).
- Stay awake `Super+Ctrl+I` / `omarchy toggle idle` (`toggle|stay-awake|allow-idle|status`; toggle prints `enabled`/`disabled`; `status` prints JSON) — M13:15 — `bin/omarchy-toggle-idle`.
- Crash capture `omarchy toggle crash-capture` (stops/starts `omarchy-crash-watch.service`, toast "Crash capture disabled/enabled") — M13:16 — `bin/omarchy-toggle-crash-capture`.
- Screensaver `omarchy toggle screensaver` (flag `screensaver-off`, toast "Screensaver disabled/enabled") — M13:17 — `bin/omarchy-toggle-screensaver`.
- Menu bar `Super+Shift+Space` / `omarchy toggle bar [toggle|on|off]` — M13:18 — `bin/omarchy-toggle-bar`.
- Touchpad `XF86TouchpadToggle` / `omarchy toggle touchpad`; touchscreen; suspend (`omarchy toggle suspend`, toast "Suspend removed from system menu" / "Suspend now available in system menu", hides `system.suspend`); hybrid GPU (`omarchy toggle hybrid gpu`, sudo, gum confirm, reboots) — M13:19-22 — `bin/omarchy-toggle-{touchpad,touchscreen,suspend,hybrid-gpu}`, `omarchy-menu.jsonc:38`.
- Touchpad/touchscreen/hybrid GPU live under Trigger → Hardware (`Super+Ctrl+H`), only `when` hardware present (`omarchy-hw-touchpad`, `omarchy-hw-touchscreen`, `omarchy-hw-hybrid-gpu`, `omarchy-hw-laptop`) — M13:24 — `omarchy-menu.jsonc:74-82`; disabled device persisted in `default/hypr/disabled-input-device.lua` state.
- Toggle menu extras: Battery Percentage (`when omarchy-hw-laptop`), Workspace Layout, Window Gaps, 1-Window Ratio — M13:26 — `omarchy-menu.jsonc:96-99`.
- Flag files `~/.local/state/omarchy/toggles/<name>` named for the off state (`screensaver-off`, `suspend-off`, `bar-off`, `crash-capture-off`, `notification-silencing`?—no: DND lives in `notifications.json`); `omarchy-toggle-enabled <flag>` exit code — M13:28-34 — `bin/omarchy-toggle`, `bin/omarchy-toggle-enabled`.
- Indicators: dictation, screen recording, reminders, night light, DND, stay awake; hover reveals dimmed inactive ones; click toggles; `alwaysShow` — M13:38-40 — `widgets/Indicators.qml`.
- Night light 4000 K ↔ 6500 K via hyprsunset (started on demand); `~/.config/hypr/hyprsunset.conf` identity profile; time profile example; `o.launch_on_start("hyprsunset")` in `~/.config/hypr/autostart.lua` — M13:44-54 — `bin/omarchy-toggle-nightlight`, `config/hypr/hyprsunset.conf`, Setup → Config → Hyprsunset (`omarchy-menu.jsonc:188`).
- DND: no toasts; crossed-out bell indicator; silenced notifications go to history (`~/.local/state/omarchy/notifications/history/`, newest 10); Omarchy's own `omarchy-action` toasts and `notify-send` criticals still show; ephemeral (`notify-send`/`omarchy-action`/transient) are dropped, not stored — M13:58-63 — `docs/notifications.md` Silencing.
- Idle: `idle.screensaver` 150 s, `idle.lock` 300 s, both counted from idle start; file watched, applied live — M13:67-79 — `shell/plugins/services/idle/*.qml:19-25`, `shell/shell.qml:124,137` (`watchChanges: true`).
- Dismissing the screensaver counts as activity and cancels the pending lock — M13:81 — idle service `cancel` → `omarchy-system-wake`.
- `Super+Ctrl+I` stay awake shows coffee-cup indicator; `omarchy toggle idle status` JSON — M13:83 — `bin/omarchy-toggle-idle`.
- Screensaver: ASCII art via `ttfx` random effects, one per monitor, any key/mouse exits — M13:89 — `bin/omarchy-launch-screensaver`, `bin/omarchy-screensaver`.
- System → Screensaver (`Super+Esc`) forces it even when toggled off (`omarchy-launch-screensaver force`); no default hotkey — M13:91 — `omarchy-menu.jsonc:36`.
- Screensaver needs Alacritty/Foot/Ghostty/Kitty as default terminal, else toast "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" — M13:93 — `bin/omarchy-launch-screensaver:596-601`.
- Style → Screensaver → Edit Text / Set From Image / Restore Default — M13:95 — `omarchy-menu.jsonc:121-123` (`omarchy-branding-screensaver`).
- `Super+Ctrl+L` lock: shell lock (`omarchy-shell lock lock`), display blanks after a few seconds, keyboard layout reset to first, 1Password locked — M13:99 — `bin/omarchy-system-lock`, `shell/plugins/lock/LockView.qml:17`.
- Lock screen accepts password and fingerprint — M13:101 — chapter 37 reviewer.

#### Chapter 14 — Omarchy CLI

- `omarchy` with no args prints "Omarchy command center" help: Usage, Common commands (update, theme list, theme set, font list, screenshot, debug), Groups, Discovery — M14:7-43 — `bin/omarchy` `show_main_help` (group list in code has 67 groups incl. `ascii`, `crash`, `finalize`, `dev`, `disk`, `hook`, `installed`, `openclaw`, `osd`, `snapshot`, `wifi`, `windows` not shown in the manual excerpt).
- `omarchy <group>` prints "<Group> commands — <desc>:" with each command's usage — M14:47-56 — `show_group_help`.
- `omarchy commands [--all] [--json] [--markdown] [--check]` — `show_commands*`.
- `omarchy <group> --help`, `omarchy <group> <cmd> --help` (Usage, summary, Arguments, Examples, Aliases, Binary, Filename route, Related commands) — M14:58 — `show_command_help`.
- Unknown command → "Unknown Omarchy command: omarchy …", optional "Did you mean: …", "Run 'omarchy commands --all' …", exit 127 — `dispatch_or_help`.
- `omarchy menu` (toggle root), `omarchy menu summon style.theme`, `omarchy menu toggle system`, `omarchy menu close`, `refresh`, `ping`; unknown verb → exit 2 — M14:62 — `bin/omarchy-menu`.
- Menu aliases usable as routes: `app(s)`, `settings`, `uninstall`, `restart`/`refresh`, `power-menu`, `emoji(s)`, `reminder`, `remind`/`reminder-set`, `capture`/`screenshot`/`screenrecord…`, `share`, `toggle(s)`, `hardware`/`hw`, `theme(s)`, `background`/`wallpaper`, `unlock`, `network`, `dns`, `wifi-qr`, `default(s)`, `plugin(s)` — `omarchy-menu.jsonc` `aliases`.
- `omarchy version` — `bin/omarchy-version`.
- `omarchy debug [--no-sudo] [--print]` writes `/tmp/omarchy-debug.log`; interactive gum menu offers "Upload log" only if `ping 8.8.8.8` succeeds — `bin/omarchy-debug`.

#### Menu tree (root and the branches these chapters name), `default/omarchy/omarchy-menu.jsonc`

- Root: Apps (provider), Learn, Trigger, Style, Setup, Install, Remove, Update, About (`omarchy-launch-about`), System — lines 24-33.
- System: Screensaver, Lock, Suspend (`when ! suspend-off`), Hibernate (`when omarchy-hibernation-available`), Logout, Reboot, Shutdown — 36-42.
- Learn: Keybindings, Omarchy (manual webapp), Hyprland, Arch, Neovim, Bash, Tmux, Herdr, Community — 45-53.
- Trigger: Emoji, Reminder{Set one, Show all, Clear all}, Capture{…}, Transcode, Share{Clipboard, File, Folder, Receive}, Toggle{Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Battery Percentage†, Workspace Layout, Window Gaps, 1-Window Ratio}, Hardware{Laptop Display†, Mirror Display†, Hybrid GPU†, Touchpad†, Touchpad Haptics{low,mid,high}†, Touchscreen†}, Speed Test{Network Speed Test, Disk Speed Test} — 56-101 († hidden on the VM).
- Style: Theme, Background, Unlock, Font (provider), Menu Bar{Position{Top,Bottom,Left,Right}, Transparency}, Hyprland (looknfeel.lua), Screensaver{Edit Text, Set From Image, Restore Default}, About{Edit Text, Set From Image, Restore Default} — 104-123.
- Setup / Install / Remove / Update trees — 126-379 (other reviewers; listed here only as menu presence: Setup{Monitors, Keybindings, Input, Network{DNS{…}, QR Code}, Defaults{Agent, Browser, Terminal, Editor}, Plugins{…}, Security{…}, Config{Hyprland, Hyprsunset, XCompose}, Direct Boot, Reset Computer}, Update{Omarchy, Channel, Config, Extra Themes, Process{Hyprsunset, Shell}, Hardware{Audio, Wi-Fi, Bluetooth, Trackpad}, Firmware, Password{Drive Encryption, User}, Timezone, Time}).
- Menu keyboard: typing filters (search across labels/ids/descriptions); `Escape` clears filter, else closes; `Backspace`/`Left` with empty filter goes back one level; `Return`/`Right` first "settles" the cursor onto the first row if none is highlighted, then activates; `Delete` on a deletable row asks to confirm; Up/Down/PgUp/PgDn — `shell/plugins/menu/Menu.qml:1129-1163`, `goBack`, `settleCursor`; empty state "Nothing here yet" / "No matches for “…”" — `Menu.qml:1462`.
- Rows with `disabled` conditions stay listed, dimmed with ✓ (Install rows for present packages); `checked` appends ✓ — `omarchy-menu.jsonc` header.

## Observations

Driver constraints and quirks that shape every test below (all tests obey rule zero: keys, mouse and a
guest terminal only; every step maps to `send-keys`, `mouse …`, `get-image` or `get-serial`):

1. **Driver key set.** `send-keys` accepts `<PRINT>`, `<CAPSLOCK>`, `<INSERT>`/`<INS>`, `<MENU>`, `<PAUSE>`, `<NUMLOCK>`, `<SCROLLLOCK>` and any qcode token containing `_` or starting with `f` (`<kp_enter>`, `<F13>`), with modifier combos (`<M-PRINT>`, `<A-PRINT>`, `<M-C-PRINT>`). So every `Print`-based capture binding (`utilities.lua:38-43`) and the CapsLock compose sequences are driven by their real hotkeys. What it **cannot** send are the XF86 media/brightness/power keys (`volumeup`, `audiomute`, `power`, `calculator`, `sleep` fail the filter): volume/brightness OSDs, `Shift+Mute`, `Alt+Play`, `XF86PowerOff`, `XF86Calculator` are reachable only from the CLI or menu.
2. **Key notation.** Super is `<M-…>`: `Super+Space` `<M-SPACE>`, `Super+Escape` `<M-ESC>`, `Super+Ctrl+Shift+Space` `<M-C-S-SPACE>`. Comma hotkeys `<M-,>` `<M-S-,>` `<M-C-,>` `<M-A-,>` `<M-S-A-,>`. Grave is the literal backtick, Period `<M-C-.>`, Minus/Equal/Slash literal. Print family: `<PRINT>` `<A-PRINT>` `<M-PRINT>` `<M-C-PRINT>`. Compose is a *sequence*: tap `<CAPSLOCK>`, then `m`, then `s` as separate keys.
3. **Default terminal at HEAD is foot** (`install/omarchy-base.packages:41`); the 4.0.2 ISO may ship Alacritty. Instructions say "the default terminal" and never assume a window class. Both map `Ctrl+Insert`/`Shift+Insert` for the universal clipboard.
4. **Widgets absent on the VM**: Bluetooth (no adapter), Power (no battery), Agents (no usage), keyboard-layout label (one layout), update badge, Media/Microphone (off by default), Tailscale/Dropbox (not installed). Visible right-section panels are Network, Audio, Display → `Super+Ctrl+1/2/3` map to those; `4..9` do nothing; `Super+Ctrl+B`/`P` target hidden panels (the power panel closes itself when `batteryPresent` is false).
5. **No audio device**: `omarchy audio output volume raise` prints "Could not resolve an audio sink to control." The audio panel opens with an empty output list. Only the "With no audio" recording path is testable.
6. **No GPU**: gpu-screen-recorder runs with `-fallback-cpu-encoding yes`; whether it starts on virtio-vga is what `screenrecord-alt-print-start-stop` finds out. hyprsunset sets a gamma LUT that virtio-vga may not honour, so the night-light tint may not show; the `--status` JSON and the indicator are the proof.
7. **`omarchy-hw-laptop` is false** → Trigger → Toggle lacks Battery Percentage; Trigger → Hardware shows only the empty Touchpad Haptics header; `Super+Ctrl+Delete` targets a `Virtual-1` output — keep it out of tests.
8. **`Super+Ctrl+Alt+B` on the VM** posts a toast with a battery glyph and an empty headline (`omarchy-battery-status` prints nothing, exit 0). Recorded as a defect in `bar-absent-hardware-widgets-and-menus`.
9. **`ping` fails** in user-mode NAT → `omarchy debug` never offers "Upload log".
10. **Idle timers** count guest input only; `get-image` is not input. The idle test shortens `idle.screensaver`/`idle.lock` in `~/.config/omarchy/shell.json` from the guest terminal (the file is watched and applied live) and restores them. `omarchy bar transparent false` materialises the user file without a visible change.
11. **State leaks to undo**: `Super+L` writes a per-workspace layout rule; `Super+/` rewrites `~/.config/hypr/monitors.lua`; `omarchy bar …`/dragging creates a canonical `shell.json`; toggles leave flag files; `Super+Alt+Home` leaves width files; every screenshot adds a PNG to `~/Pictures`. Every test that flips one ends by flipping it back.
12. **Menu semantics**: a freshly opened menu highlights nothing; the first `Return` places the cursor, the second activates. Typing a filter then `Return` activates the first match directly. `Backspace` with an empty filter goes up a level.
13. **Clipboard picker `Return` pastes** into the previously focused window via Shift+Insert (manual says clipboard-only); `Shift+Return` is copy-only. Focus a terminal before `Super+Ctrl+V`.
14. **Emoji picker `Return` inserts** into the focused window and does not leave the emoji on the clipboard (manual 07:338 says it does).
15. **`Super+Ctrl+Alt+W` opens the weather panel**, not a toast; right-click on the widget is the toast. Weather needs wttr.in (NET); the widget hides until a label is fetched.
16. **Third-party-style notifications**: libnotify is not in the base package list, so use `omarchy-notification-send --app-name Chat -u normal "…"`; `--app-name Chat` makes DND silence it and history keep it, whereas the default `omarchy-action` punches through DND and is dropped from history.
17. **Toast lifetimes**: low 5 s, normal 8 s, critical until dismissed (`Super+,`). Click or `Super+Alt+,` promptly.
18. **Unlock (Plymouth) apply** runs with sudo (password `prime`) in a floating presentation terminal and may rebuild the initramfs (a minute); Escape in the picker is the cheap path.
19. **System menu**: never select Suspend (QEMU may not resume); Hibernate is hidden; Reboot/Logout end the session.
20. **Floating by rule**: btop, omacalc, About, presentation terminals (title "Omarchy"), Tensaku, LocalSend, the screensaver. Terminals, browser, Files, editor tile.
21. **Screensaver** exits on any key *or* mouse move (`read -n1` / focus loss); the window class is `org.omarchy.screensaver`; the lock kills it.
22. **Compose** is handled by fcitx5 (`omarchy-fcitx5.service`) with `compose:caps`; sequences work in any text input (terminal, browser field). The first compose after login can take a second while fcitx5 warms up.

## Proposed tests

### omarchy-menu-open-filter-navigate   [VM-OK]
description: The Omarchy menu opens on Super+Space, filters as you type, steps into and out of submenus from the keyboard, and closes with Escape — the entry point every other test relies on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space. A centred menu with the rows Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System must appear.
  * Press Down twice, then Return (twice if the first press only highlights). You must be inside "Trigger": Emoji, Reminder, Capture, Transcode, Share, Toggle, Hardware, Speed Test.
  ** A freshly opened menu has no row highlighted; the first Return places the cursor, the second activates.
  * Press Backspace with nothing typed. The root list must return.
  * Type "toggle". Only rows matching toggle remain (Trigger → Toggle and its children such as Stay Awake, Nightlight, Menu Bar).
  * Press Escape once: the filter clears and the full list returns, menu still open. Press Escape again: the menu closes and the bare desktop is back.
  * Unhappy path: press Super+Space, type "zzqqxx". "No matches for “zzqqxx”" must be shown. Press Escape twice; the desktop must be exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Space is <M-SPACE>; Backspace is <BS>.
  * The header line of the menu names the open submenu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the root menu, the Trigger submenu, the root again after Backspace, the "toggle" filter, the "No matches" state and the bare desktop
  * If unsuccessful
  ** Screenshot of the menu state that was wrong; note whether the bar is still present (a shell crash takes it too)
covers: manual/03:9, manual/04:3, manual/14:62; default/hypr/bindings/utilities.lua:1; shell/plugins/menu/Menu.qml:1129-1163; default/omarchy/omarchy-menu.jsonc root

### apps-menu-launches-app   [VM-OK]
description: Super+Alt+Space opens the apps-only menu; typing filters installed applications and Return launches the match — the Spotlight/Start-menu replacement.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space. A menu titled Apps listing installed applications with icons must open.
  * Type "files". Only Files (Nautilus) rows must remain.
  * Press Return. The menu closes and a Files window opens tiled to the full workspace.
  ** Nautilus can take a few seconds on first launch; keep screenshotting.
  * Press Super+W. Files must close and the desktop is empty again.
  * Unhappy path: press Super+Alt+Space, type "nosuchapp123". "No matches for “nosuchapp123”" must be shown; press Escape twice.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Alt+Space is <M-A-SPACE>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Apps menu, the filtered row, the Files window, the empty desktop and the "No matches" state
  * If unsuccessful
  ** Screenshot of the menu after Return with no window appearing
covers: manual/03:9, manual/07:10; default/hypr/bindings/utilities.lua:2; omarchy-menu.jsonc:24

### terminal-browser-tile-split-swap   [VM-OK]
description: The chapter-04 tour: terminal and browser tile side by side, Super+J restacks them, Super+Shift+Arrow swaps them and Super+Arrow moves focus with the pointer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. A terminal fills the workspace below the bar.
  * Press Super+Shift+Return. Chromium opens and the two windows share the width half and half.
  ** A first-run page or "restore pages" bubble in Chromium is fine.
  * Press Super+J: the windows stack top/bottom. Press Super+J again: side by side again.
  * With the browser focused (click it), press Super+Shift+Right. The browser and terminal must swap sides.
  * Press Super+Left, then Super+Right. The brighter focus border must move to the left window then the right one, and the pointer must jump to the centre of the focused window each time.
  * Press Super+W twice. Both windows close; the desktop is empty.
  * Unhappy path: on the empty desktop press Super+J and Super+Shift+Right. Nothing changes, nothing crashes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The focused window has the brighter border in every theme; compare borders, not titles.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: side by side; stacked; side by side again; swapped; focus on left with the pointer in it; focus on right; empty desktop
  * If unsuccessful
  ** Screenshot of the layout that did not change
covers: manual/04:5-19; default/hypr/bindings/tiling.lua:5,16-19,42-45; applications.lua:2-3

### floating-activity-monitor-and-close   [VM-OK]
description: Super+Ctrl+T opens btop as a floating centred window, Super+T tiles it and floats it again, and Super+Q / Super+W close windows even on an empty desktop without harm.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return for a terminal, then Super+Ctrl+T. A btop window must appear floating and centred over the terminal, not splitting it.
  ** btop needs a second to draw its graphs.
  * Press Super+T. btop snaps into the tiling beside the terminal. Press Super+T again: it floats again.
  * Press Super+Shift+F. Files opens and tiles with the terminal while btop stays floating on top.
  * Click btop and press Super+Q. btop closes.
  * Press Super+W twice. Files and the terminal close; the desktop is empty.
  * Unhappy path: press Super+W and Super+Q on the empty desktop. Nothing happens; the bar remains.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A floating window shows desktop margin around it and does not resize its neighbours.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of btop floating, tiled, floating again, Files tiled underneath, and the empty desktop
  * If unsuccessful
  ** Screenshot of the misplaced window; if btop never opened, the output of `omarchy-launch-tui btop` typed in the terminal
covers: manual/04:15, manual/07:73; default/hypr/bindings/utilities.lua:104; tiling.lua:1-2,6; default/hypr/apps/system.lua:7-9

### workspaces-switch-move-silent   [VM-OK]
description: Workspaces replace Spaces/virtual desktops: Super+N jumps, Super+Shift+N moves a window and follows, Super+Shift+Alt+N moves without following, Super+Tab cycles, and the bar indicators track it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. The bar's left section shows workspace 1 active.
  * Press Super+Shift+2. The terminal moves to workspace 2 and the view follows; the bar shows 2 active.
  * Press Super+1, then Super+2. Workspace 1 is empty, then the terminal is back.
  * Press Super+Shift+Alt+3. The terminal vanishes but the view stays on the (now empty) workspace 2; the bar shows 3 occupied.
  * Press Super+Tab (lands on 3, terminal visible), Super+Shift+Tab (back to 2), Super+Ctrl+Tab (former workspace, 3).
  * Click the workspace "1" indicator in the bar with the mouse; workspace 1 becomes active. Press Super+3 and Super+W to close the terminal; press Super+1.
  * Unhappy path: press Super+Shift+5 with no window focused. Nothing happens, no error.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+3 is <M-S-A-3>. The workspace indicators sit right of the Omarchy logo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar indicators and window presence after each switch, including the silent move (view on 2, indicator 3 occupied) and the mouse-driven switch
  * If unsuccessful
  ** Screenshot of the workspace that did not change plus the bar
covers: manual/03:21, manual/04:21; default/hypr/bindings/tiling.lua:21-35; shell/plugins/bar/widgets/Workspaces.qml

### fullscreen-fullwidth-tiled-fullscreen   [VM-OK]
description: The three fullscreen modes — Super+F (hides the bar), Super+Alt+F (full width, keeps the bar) and Super+Ctrl+F (fullscreen only inside the window) — each engage and release.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice: two terminals side by side under the bar.
  * Press Super+F. The focused terminal covers the whole screen and the bar is gone. Press Super+F again: both terminals and the bar return.
  * Press Super+Alt+F. The focused terminal takes the full area below the bar, hiding the other one, bar still visible. Press Super+Alt+F again to restore.
  * Press Super+Ctrl+F. Both terminals stay visible (only the app is told it is fullscreen). Press Super+Ctrl+F again.
  * Press Super+W twice. Empty desktop.
  * Unhappy path: press Super+F with no window. Nothing changes; the bar remains.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Judge "bar hidden" by the terminal's top edge touching the top of the screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots in each mode and after each release
  * If unsuccessful
  ** Screenshot of the mode that stuck
covers: manual/04:27, manual/07:20-22; default/hypr/bindings/tiling.lua:7-10; bin/omarchy-hyprland-window-tiled-fullscreen-toggle

### workspace-layout-toggle-scrolling   [VM-OK]
description: Super+L switches the current workspace between dwindle and scrolling with a toast, the choice is per workspace, and Trigger → Toggle → Workspace Layout flips it back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+2, then Super+L. A toast "Workspace layout set to scrolling" appears.
  * Press Super+Return three times. The terminals line up as equal columns running past the right edge (the third is partly or fully off screen) instead of shrinking to fit.
  ** Super+Right scrolls the strip to reveal the hidden column.
  * Press Super+1 and Super+Return twice. Workspace 1 is still dwindle: both terminals fully visible. Close them with Super+W twice and press Super+2.
  * Press Super+Space, type "workspace layout", Return (Trigger → Toggle → Workspace Layout). Toast "Workspace layout set to dwindle"; all three terminals now fit on screen.
  * Press Super+W three times, then Super+1. Empty desktop.
  * Unhappy path: press Super+L on the empty workspace 1 and again straight away. Two toasts (scrolling, then dwindle) and the workspace ends dwindle as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts appear top-right for about five seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the scrolling toast, the three-column strip with one column cut off, workspace 1 still dwindle, the dwindle toast with all three terminals fitting, and the two toasts of the unhappy path
  * If unsuccessful
  ** Screenshot of the layout that did not change
covers: manual/04:31-49, manual/07:18; default/hypr/bindings/tiling.lua:14; bin/omarchy-hyprland-workspace-layout-toggle; omarchy-menu.jsonc:97

### window-grouping-cycle-and-leave   [VM-OK]
description: Super+G makes a tabbed group that new windows join; Super+Ctrl+Left/Right and Super+Alt+N move between tabs, Super+Alt+G ejects one, and Super+G dissolves the group.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+G. The terminal gains a tab strip along its top edge.
  * Press Super+Return, then Super+Shift+F. Both join the group: one tile with three tabs.
  * Press Super+Ctrl+Left, then Super+Ctrl+Right. The active tab moves back, then forward.
  * Press Super+Alt+1 (first terminal active), then Super+Alt+3 (Files active).
  * Press Super+Alt+G. Files leaves the group and tiles beside it.
  * Click a group tab and press Super+G. The group dissolves into two plain tiles.
  * Press Super+W three times. Empty desktop.
  * Unhappy path: open one terminal, press Super+Alt+G (not grouped): nothing changes. Close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The tab strip is drawn by Hyprland above the window; each tab shows a window title.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the one-tab group, the three-tab group, the active tab changing, Files ejected, and the dissolved group
  * If unsuccessful
  ** Screenshot where the group did not form or dissolve
covers: manual/04:53-55, manual/07:45-51; default/hypr/bindings/tiling.lua:76-95

### pop-window-pinned-follows-workspaces   [VM-OK]
description: Super+O pops the active window into a pinned floating panel that follows across workspaces; Super+O again puts it back into the tiling.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+O. The terminal becomes a centred floating window.
  * Press Super+2. The floating terminal is still on screen (pinned).
  * Press Super+Return. A new terminal tiles underneath while the popped one stays on top.
  * Press Super+1. The popped terminal follows back to workspace 1.
  * Click the popped terminal and press Super+O. It un-pins and tiles normally.
  * Press Super+W, then Super+2 and Super+W, then Super+1. Empty desktop.
  * Unhappy path: press Super+O on the empty desktop. Nothing happens.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A pinned window is drawn above tiled windows on every workspace.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the popped terminal on workspace 1, above a tiled terminal on 2, back on 1, and tiled after the second Super+O
  * If unsuccessful
  ** Screenshot of the workspace where the popped window is missing
covers: manual/04:59, manual/07:17; default/hypr/bindings/tiling.lua:11; bin/omarchy-hyprland-window-pop

### scratchpad-toggle-single-and-double   [VM-OK]
description: The scratchpad drops down like a Quake console: Super+Alt+S / Super+Shift+Grave send a window there, Super+S / Super+Grave toggle it; one window shows as a centred panel, two go full width.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `echo scratch-one` Return, then press Super+Alt+S. The terminal disappears.
  * Press Super+S. The scratchpad drops down with the terminal as a centred panel, desktop visible around it. Press Super+S: it hides.
  * Press Super+Return, type `echo scratch-two` Return, press Super+Shift+Grave. It vanishes too.
  * Press Super+Grave. Both terminals show side by side spanning the full width.
  * Focus one and press Super+Shift+1. It leaves the scratchpad and tiles on workspace 1.
  * Press Super+W; press Super+S, Super+W, Super+S. Empty desktop, scratchpad empty.
  * Unhappy path: press Super+S with the empty scratchpad, then Super+S again. Nothing stays on screen, no crash.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Grave is the backtick key: send the literal ` with the Super modifier.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the single centred panel, the two-window full-width scratchpad, the terminal back on workspace 1, and the empty desktop
  * If unsuccessful
  ** Screenshot of the scratchpad not dropping down or the window not moving
covers: manual/04:65-69, manual/07:29-30; default/hypr/bindings/tiling.lua:28-31

### close-all-windows-ctrl-alt-del   [VM-OK]
description: Ctrl+Alt+Delete closes every window on every workspace and returns to workspace 1; pressing it on an empty desktop is harmless.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice, Super+2, Super+Shift+F, then Super+Ctrl+T. Windows on two workspaces plus a floating btop.
  * Press Ctrl+Alt+Delete. Every window closes and the view lands on the bare workspace 1; the bar shows no other occupied workspace.
  * Unhappy path: press Ctrl+Alt+Delete again. Nothing happens; the session stays logged in.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+Alt+Delete is <C-A-DEL>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot before (windows on two workspaces) and after (empty workspace 1, bar indicators cleared)
  * If unsuccessful
  ** Screenshot of any window that survived
covers: manual/04:25, manual/07:14; default/hypr/bindings/tiling.lua:3; bin/omarchy-hyprland-window-close-all

### window-resize-keys-and-saved-width   [VM-OK]
description: Super+Minus/Equal resize the focused tile in steps (Alt smaller, Ctrl larger); Super+Alt+Home saves the width and Super+Home restores it, with a toast when nothing is saved.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice so two terminals split the screen.
  * Unhappy path first: press Super+Home. A toast "No saved width found for … on workspace 1" with "Use Super + Alt + Home to save one for this workspace." appears.
  * Press Super+Minus three times, then Super+Equal once. The split boundary moves in visible steps and back one.
  * Press Super+Ctrl+Minus once. A much larger jump than Super+Minus.
  * Press Super+Alt+Home. Toast "Saved width for … on workspace 1".
  * Press Super+Equal several times, then Super+Home. The boundary returns to the saved position.
  * Press Super+W twice; open a terminal, type `rm -f ~/.local/state/omarchy/windows/workspace-1-*.width` Return, close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Minus and Equal are the literal `-` and `=` with Super. Compare the position of the boundary between the two terminals.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "No saved width" toast, the boundary after each resize, the "Saved width" toast, and the restored boundary
  * If unsuccessful
  ** Screenshot of the boundary that did not move or the missing toast
covers: manual/07:34-41; default/hypr/bindings/tiling.lua:12-13,55-68; bin/omarchy-hyprland-window-width

### super-mouse-drag-move-resize   [VM-OK]
description: Holding Super while dragging with the left button moves a window and with the right button resizes it — the only mouse window operations the manual documents.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+T. A floating btop is centred on screen.
  * With Super held, left-drag from the middle of btop to a point a quarter screen up-left. The window moves with the drag.
  * With Super held, right-drag from the middle of btop down-right by a quarter screen. The window grows.
  * Press Super+Return (a terminal tiles behind), then Super-left-drag btop over the terminal and release. It stays floating where dropped.
  * Press Super+W twice. Empty desktop.
  * Unhappy path: Super-left-drag on the empty desktop. Nothing moves, nothing crashes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse drag --modifier super --button left|right`; screenshot after each drag to compare positions.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots before/after the move and before/after the resize
  * If unsuccessful
  ** Screenshot showing the window unchanged after the drag
covers: manual/04:23, manual/07:42-43; default/hypr/bindings/tiling.lua:73-74

### alt-tab-and-zoom   [VM-OK]
description: Alt+Tab / Alt+Shift+Tab cycle windows on the workspace, and Super+Ctrl+Z zooms the whole screen in step by step while Super+Ctrl+Alt+Z resets it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return three times and type `one`, `two`, `three` (Return each) in the three terminals.
  * Press Alt+Tab three times. The bright focus border must visit each terminal.
  * Press Alt+Shift+Tab. Focus moves the other way.
  * Move the mouse to the screen centre and press Super+Ctrl+Z. Everything around the pointer is magnified. Press it again: larger still.
  * Press Super+Ctrl+Alt+Z. Normal scale returns.
  * Press Super+W three times. Empty desktop.
  * Unhappy path: press Super+Ctrl+Alt+Z at normal zoom. Nothing changes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Zoom follows the pointer; keep it over terminal text so the screenshot shows enlarged characters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the focus ring on different terminals, the 2× and 3× zoom, and normal scale
  * If unsuccessful
  ** Screenshot where zoom stuck or focus did not move
covers: manual/07:52-53,56-57; default/hypr/bindings/tiling.lua:47-50; default/hypr/bindings/utilities.lua:118-125

### monitor-scaling-step-and-restore   [VM-OK]
description: Super+/ and Super+Alt+/ step the monitor through the scaling presets, making the whole desktop larger or smaller; the change persists, so it is stepped back, and a bad value is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `omarchy hyprland monitor scaling` Return. Note the value (expected `1`).
  * Press Super+/ . The whole desktop, bar included, renders larger. Run the command again: the next preset (`1.25` or `1.6`).
  * Press Super+Alt+/ . Original size returns; the command prints the original value again.
  * Unhappy path: type `omarchy hyprland monitor scaling 9` Return. The usage line prints and the display does not change.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Slash is the literal `/` with Super. The screenshot stays the same size; the UI inside it grows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots at the original scale, at the larger scale (visibly bigger bar and text), and back; the three printed scale values and the usage error
  * If unsuccessful
  ** Screenshot at the wrong scale
covers: manual/07:54-55; default/hypr/bindings/tiling.lua:97-98; bin/omarchy-hyprland-monitor-scaling

### bar-menu-widget-left-right-click   [VM-OK]
description: The bar's Omarchy logo opens the menu on left click and a terminal on right click, and clicking a workspace indicator focuses that workspace — the mouse side of the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the Omarchy logo at the far left of the bar. The Omarchy menu opens. Press Escape.
  * Right-click the logo. A new terminal opens, tiled.
  * Press Super+Shift+2 (terminal moves to workspace 2, view follows).
  * Left-click the workspace "1" indicator: workspace 1 (empty) becomes active. Left-click "2": the terminal is back.
  * Press Super+W. Empty desktop.
  * Unhappy path: middle-click the logo. Nothing happens; a following left click still opens the menu (Escape).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The logo is roughly the leftmost 3 % of the bar; double-check the pointer position before clicking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the menu opened by mouse, the terminal opened by right-click, and the workspace switching by click
  ** The mouse was used for every click; no hotkey stood in
  * If unsuccessful
  ** Screenshot of the bar with the pointer where the click did nothing
covers: manual/03:13, manual/05:19-20; shell/plugins/menu/BarWidget.qml:20; shell/plugins/bar/widgets/Workspaces.qml

### bar-clock-calendar-format-timezone   [VM-OK]
description: The clock widget: left click opens the month-grid calendar, right click cycles the label format, middle click opens the timezone picker, and Super+Ctrl+Alt+D toggles the calendar from the keyboard.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Note the clock label in the bar centre (weekday and time, e.g. "Friday 13:07").
  * Left-click the clock. A calendar with a month grid, week numbers and month arrows opens. Press Right (next month), Left (back), Escape.
  * Right-click the clock. The label switches to the date form ("18 September W38 2026"). Right-click again: weekday form returns.
  * Middle-click the clock. The menu opens as a timezone chooser (rows like Europe/Copenhagen). Press Escape until closed, choosing nothing.
  * Press Super+Ctrl+Alt+D: the calendar opens. Press it again: it closes.
  * Unhappy path: open the calendar and press Tab. Focus steps to the neighbouring panel (weather, if shown) or stays; no crash. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Alt+D is <M-C-A-d>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the calendar, the advanced month, the alternate clock label, the timezone chooser, and the calendar via hotkey
  * If unsuccessful
  ** Screenshot of the clock area after the click that failed
covers: manual/05:21,46,57,59; shell/plugins/panels/clock/BarWidget.qml:159-160; default/hypr/bindings/utilities.lua:101; bin/omarchy-menu-timezone

### bar-panel-hotkeys-and-numbered-toggle   [VM-PARTIAL]
description: Each bar panel has a letter hotkey and Super+Ctrl+1..9 counts the visible panels in the right section; on this machine Network, Audio and Display are the visible three. Skipped: the Bluetooth and Power panels (no adapter, no battery).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the bar's right end: network, speaker and monitor icons plus a tray; no bluetooth, battery or agents icon.
  * Press Super+Ctrl+W (Network panel opens under its icon), Escape; Super+Ctrl+A (Audio panel, slider present, output list may be empty), Escape; Super+Ctrl+D (Display panel with text-size / scaling controls), Escape.
  * Press Super+Ctrl+1: Network. Escape. Super+Ctrl+2: Audio. Escape. Super+Ctrl+3: Display.
  * With Display open press Tab. The panel switches to its neighbour (Audio). Escape.
  * Unhappy path: press Super+Ctrl+9. No panel opens, nothing crashes.
  * Absence path: press Super+Ctrl+B, then Super+Ctrl+P. Expect no panel; if one appears it must close on Escape. Report what happened.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Panels anchor under their icon; compare the panel's horizontal position with the icon's.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the right section with only network/audio/display icons; each panel by letter and by number; the Tab hop; nothing after Super+Ctrl+9
  * If unsuccessful
  ** Screenshot of a wrong panel for a number or a panel that would not close
covers: manual/05:40-61, manual/07:65-71; default/hypr/bindings/utilities.lua:98-116; shell/shell.qml:1720; shell/plugins/bar/Bar.qml:627-659

### bar-absent-hardware-widgets-and-menus   [VM-PARTIAL]
description: Without battery, bluetooth, lid or touchpad the bar hides those widgets and the menus hide those rows; the battery notice hotkey must degrade gracefully. Only the absence path exists here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the whole bar: no battery, bluetooth or agents icon on the right; no keyboard-layout label or update badge in the centre.
  * Press Super+Ctrl+O (Trigger → Toggle). Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio are listed; "Battery Percentage" is not. Escape.
  * Press Super+Ctrl+H (Trigger → Hardware). Laptop Display, Mirror Display, Hybrid GPU, Touchpad, Touchscreen are absent; at most a "Touchpad Haptics" header remains and opening it shows "Nothing here yet". Escape twice.
  * Press Super+Escape. Screensaver, Lock, Suspend, Logout, Reboot, Shutdown are listed; Hibernate is not. Escape.
  * Press Super+Ctrl+Alt+B. Record exactly what appears: a toast with a battery glyph and no text (current behaviour, report as a defect), a toast saying no battery (correct), or nothing (acceptable).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+O is <M-C-o>, Super+Ctrl+H is <M-C-h>, Super+Ctrl+Alt+B is <M-C-A-b>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar, the Toggle submenu, the Hardware submenu, the System menu, and the result of the battery hotkey
  * If unsuccessful
  ** Screenshot of a hardware row or widget shown without the hardware, or of a crash
covers: manual/05:11,26,28, manual/10:21, manual/13:24-26; omarchy-menu.jsonc:36-42,74-99; shell/plugins/panels/power/Panel.qml:204; shell/plugins/panels/bluetooth/Panel.qml:500; bin/omarchy-hw-laptop; bin/omarchy-notification-battery

### bar-hide-toggle-hotkey-menu-cli   [VM-OK]
description: Super+Shift+Space hides and restores the bar without killing the shell; Trigger → Toggle → Menu Bar and `omarchy toggle bar` are the same switch, and a bad argument is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Space. The bar disappears. Press Super+Space: the menu still opens (shell alive); Escape. Press Super+Shift+Space: the bar is back.
  * Press Super+Space, type "menu bar", pick the Trigger → Toggle row (no submenu arrow), Return. The bar hides. Repeat the path: it returns.
  * Press Super+Return and type `omarchy toggle bar off` Return. The bar hides. Type `omarchy toggle bar on` Return. It returns.
  * Unhappy path: type `omarchy toggle bar sideways` Return. A usage line mentioning `toggle|on|off` prints and the bar stays visible.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Space is <M-S-SPACE>. "menu bar" also matches Style → Menu Bar (a submenu) — pick the Toggle one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar hidden with the menu open, the bar restored, the CLI hide/show, and the usage error with the bar visible
  * If unsuccessful
  ** Screenshot of the bar stuck hidden
covers: manual/05:106, manual/07:191, manual/13:18; default/hypr/bindings/utilities.lua:16; omarchy-menu.jsonc:95; bin/omarchy-toggle-bar

### bar-position-menu-and-cli   [VM-OK]
description: The bar moves to any screen edge from Style → Menu Bar → Position or `omarchy bar position`, widgets adapt to a vertical bar, and an invalid edge is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, type "bottom", Return (Style → Menu Bar → Position → Bottom). The bar moves to the bottom edge.
  * Press Super+Return and type `omarchy bar position left` Return. "Bar position set to left"; the bar stands along the left edge with icon-only widgets and a stacked clock.
  * Type `omarchy bar position top` Return. The bar returns to the top.
  * Unhappy path: type `omarchy bar position middle` Return. `omarchy-bar: position must be top, bottom, left, or right`; the bar stays on top.
  * Type `omarchy bar defaults` Return ("Restored the default Omarchy bar"), then press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Windows re-tile when the bar moves; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the bar at the bottom, at the left (vertical), on top again, and the rejection message
  * If unsuccessful
  ** Screenshot of the bar in the wrong place
covers: manual/05:85-94; omarchy-menu.jsonc:108-118; bin/omarchy-bar cmd_position, cmd_defaults

### bar-transparency-doubleclick-menu-cli   [VM-OK]
description: Double-clicking empty bar space toggles transparency; Style → Menu Bar → Transparency and `omarchy bar transparent` flip the same setting, and a bad value is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so a terminal sits under the bar.
  * Double-left-click an empty patch of the bar about 25 % from the left. The bar background turns transparent (the wallpaper/terminal shows through). Double-click again: opaque.
  ** Keep the double-click quick; a click-and-hold starts a bar drag instead.
  * Press Super+Space, type "transparency", Return. The bar turns transparent.
  * Type `omarchy bar transparent false` Return in the terminal. "Bar transparency set to false"; opaque again.
  * Unhappy path: type `omarchy bar transparent maybe` Return. `omarchy-bar: transparent must be true, false, or toggle`; nothing changes.
  * Type `omarchy bar defaults` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Pick a spot with no widget under it (between the workspace indicators and the clock).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots opaque, transparent after double-click, opaque, transparent via menu, opaque via CLI, and the rejection
  * If unsuccessful
  ** Screenshot of the bar unchanged after the double-click
covers: manual/05:83-91; omarchy-menu.jsonc:110; bin/omarchy-bar cmd_transparent; shell/plugins/bar/Bar.qml

### bar-drag-to-bottom-edge   [VM-OK]
description: Dragging an empty patch of the bar to another screen edge moves it there without any config editing, and dragging a widget reorders it instead of moving the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press the left button on an empty patch of the bar about 25 % from the left and drag to the bottom centre of the screen; release. The bar is now along the bottom edge.
  * Press Super+Return. The terminal tiles from the top down to just above the bar.
  * Drag the bar from an empty patch back to the top edge. It returns and the terminal re-tiles below it.
  * Unhappy path: drag from the clock label toward the right section and release. The clock moves within the bar (reordered) but the bar stays on top.
  * Type `omarchy bar defaults` Return in the terminal (layout restored), press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse drag` from the bar to y≈0.98 for bottom; a mid-drag screenshot shows the preview.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the bar at the bottom above nothing, the terminal above the bottom bar, the bar back on top, the reordered clock, and the restored layout
  * If unsuccessful
  ** Screenshot of the bar unchanged after the drag
covers: manual/05:83; shell/plugins/bar/Bar.qml drag handling; bin/omarchy-bar cmd_defaults

### bar-plugin-enable-disable-and-set   [VM-OK]
description: Widgets are added and removed with `omarchy plugin enable|disable`, moved and configured with `omarchy bar move|set`, listed with `omarchy plugin list`, and an unknown id is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, press Super+F, type `omarchy plugin list` Return. A table with ID, STATE, SOURCE, KINDS, NAME listing omarchy.clock, omarchy.weather, omarchy.media, omarchy.microphone…
  * Type `omarchy plugin enable omarchy.microphone --section right` Return. "Enabled and moved omarchy.microphone"; press Super+F to see the bar: a microphone icon is in the right section.
  * Type `omarchy plugin disable omarchy.microphone` Return. The icon is gone.
  * Type `omarchy bar set omarchy.clock format "HH:mm"` Return. The clock now shows only hours and minutes.
  * Type `omarchy bar move omarchy.clock --section left --index 0` Return. The clock jumps to the far left before the logo.
  * Unhappy path: type `omarchy plugin enable acme.nonexistent` Return → `omarchy-plugin-enable: plugin 'acme.nonexistent' is not known; run: omarchy-shell shell rescanPlugins`.
  * Type `omarchy bar defaults` Return. The clock is back in the centre with the weekday format. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Un-fullscreen the terminal (Super+F) whenever you need to see the bar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the plugin table, the microphone icon present then absent, the HH:mm clock, the clock at the far left, the rejection, and the restored bar
  * If unsuccessful
  ** Screenshot of the failing command's output
covers: manual/05:88-101,132; bin/omarchy-plugin-list; bin/omarchy-plugin-enable; bin/omarchy-plugin-disable; bin/omarchy-bar cmd_set, cmd_move, cmd_defaults

### bar-indicators-hover-and-click   [VM-OK]
description: Inactive indicators hide until you hover the bar centre; clicking a dimmed one turns the mode on and clicking the lit one turns it off, in step with the hotkey (Stay Awake and Do Not Disturb).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar centre: no lit indicator glyphs next to the clock.
  * Move the mouse onto the bar just left of the clock and hold; dimmed glyphs (bell-slash, moon/sun, coffee cup, record dot, …) fade in.
  * Click the coffee cup. It lights and stays visible when the mouse leaves (Stay Awake on).
  * Press Super+Ctrl+I. The coffee cup goes out (hotkey and indicator share state).
  * Hover again and click the crossed-out bell (DND on, lit). Click it again (off).
  * Unhappy path: move the mouse away and screenshot: all indicators hidden, none lit — the bar is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hover for a second before the screenshot; the reveal fades in. Super+Ctrl+I is <M-C-i>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots hidden, revealed on hover, coffee cup lit, off after the hotkey, bell lit, bell off, hidden again
  * If unsuccessful
  ** Screenshot of the bar centre where nothing revealed
covers: manual/05:75-77, manual/13:38-40; shell/plugins/bar/widgets/Indicators.qml; shell/plugins/bar/indicators/{StayAwake,Dnd}.qml; bin/omarchy-toggle-idle

### weather-widget-panel-and-location   [VM-OK] [NET]
description: The weather widget fetches wttr.in: Super+Ctrl+Alt+W opens the forecast panel, right click posts the weather as a notification, and `omarchy weather location` pins or resets the place. Needs outbound HTTPS (a few KB).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Wait up to 30 s for a weather glyph with a temperature to appear right of the clock.
  * Press Super+Ctrl+Alt+W. A multi-day forecast panel opens. Press it again: it closes.
  ** The hotkey opens the panel, not a toast — chapter 10's wording is out of date.
  * Right-click the glyph. A toast "<Place> · Temp … · Wind …" appears.
  * Press Super+Return, type `omarchy weather location --set Malibu 34.0259,-118.7798` Return, then middle-click the glyph (refresh). Right-click again: the toast now names Malibu.
  * Unhappy path: type `omarchy weather location --set Malibu 34.0259` Return → `Invalid coordinates: 34.0259 (expected lat,lon)`.
  * Type `omarchy weather location --clear` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Alt+W is <M-C-A-w>. If the glyph never appears the network is down; report and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the glyph, the panel, the weather toast, the Malibu toast, and the coordinates rejection
  * If unsuccessful
  ** Screenshot of the bar without the glyph
covers: manual/05:22, manual/07:211, manual/10:13-17; bin/omarchy-notification-weather; shell/plugins/panels/weather/BarWidget.qml:78-80; bin/omarchy-weather-location; bin/omarchy-weather-status

### theme-picker-hotkey-apply-and-cancel   [VM-OK]
description: Super+Ctrl+Shift+Space opens the theme picker; typing filters, Return re-themes the shell, terminal and desktop together, Escape leaves everything untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and note the terminal and bar colours.
  * Press Super+Ctrl+Shift+Space. A carousel of theme previews with labels opens, the current theme selected.
  * Unhappy path first: press Right twice, then Escape. The desktop colours are unchanged.
  * Press Super+Ctrl+Shift+Space, type "gruv" (the carousel filters to Gruvbox), Return. Within seconds the bar, terminal, wallpaper and toast turn to Gruvbox's warm palette.
  * Press Super+Ctrl+Shift+Space, type the original theme's name, Return. The original colours return.
  ** If unsure of the original name, type `omarchy theme current` in the terminal before the first switch.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Shift+Space is <M-C-S-SPACE>. Typed letters appear at the bottom of the picker.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the unchanged desktop after Escape, the Gruvbox desktop, and the restored theme
  * If unsuccessful
  ** Screenshot of a half-themed desktop (bar and terminal disagreeing)
covers: manual/06:3-5, manual/07:174; default/hypr/bindings/utilities.lua:18; omarchy-menu.jsonc:104; bin/omarchy-theme-switcher; bin/omarchy-theme-set; shell/plugins/image-picker/ImagePicker.qml

### theme-set-menu-and-cli-rejects-unknown   [VM-OK]
description: Style → Theme and `omarchy theme set` both apply a theme, `omarchy theme list` names all 22, and a bogus theme name is refused with a clear message.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy theme current` Return (note it), then `omarchy theme list` Return. 22 Title Case names print (Catppuccin … White).
  * Type `omarchy theme set "Tokyo Night"` Return. The desktop switches to Tokyo Night's blue palette.
  * Press Super+Space, type "theme", Return (Style → Theme), type "nord", Return. Nord's palette applies.
  * Unhappy path: type `omarchy theme set nope-not-a-theme` Return → `Theme 'nope-not-a-theme' does not exist`; the desktop stays Nord.
  * Type `omarchy theme set "<original>"` Return. Original palette back. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Theme names are case- and space-insensitive on the CLI.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the 22-name list, the Tokyo Night desktop, the Nord desktop, the rejection, and the restored desktop
  * If unsuccessful
  ** Screenshot of the failing command's output
covers: manual/06:3, manual/14:22-23; bin/omarchy-theme-list; bin/omarchy-theme-set; bin/omarchy-theme-current; omarchy-menu.jsonc:104

### background-picker-and-cycle   [VM-OK]
description: Super+Ctrl+Space opens the background picker for the current theme; Return applies, Escape cancels, `omarchy theme bg next` cycles, and a missing file is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the wallpaper. Press Super+Ctrl+Space: thumbnails of the theme's backgrounds open with the current one selected.
  * Unhappy path first: press Right, then Escape. The wallpaper is unchanged.
  * Press Super+Ctrl+Space, Right, Return. The wallpaper changes.
  ** If the theme has a single background nothing can change; report that and continue.
  * Press Super+Return, type `omarchy theme bg next` Return. The wallpaper changes again.
  * Unhappy path: type `omarchy theme bg set /tmp/does-not-exist.png` Return → `File does not exist: /tmp/does-not-exist.png`.
  * Type `omarchy theme bg next` Return until the first wallpaper is back, then press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Space is <M-C-SPACE>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the unchanged wallpaper after Escape, the new wallpaper after Return and after `bg next`, the rejection, and the original wallpaper restored
  * If unsuccessful
  ** Screenshot of the wallpaper that did not change
covers: manual/06:7, manual/07:175-178; default/hypr/bindings/utilities.lua:17; omarchy-menu.jsonc:105; bin/omarchy-theme-bg-switcher; bin/omarchy-theme-bg-set; bin/omarchy-theme-bg-next

### unlock-style-picker-cancel   [VM-OK]
description: Style → Unlock shows each theme's boot-unlock design plus a default; Escape cancels, and choosing one applies it with sudo in a floating presentation terminal and can be reset.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, type "unlock", Return. A picker of unlock-screen previews including "default" opens.
  * Unhappy path: press Escape. The picker closes and no terminal opens.
  * Press Super+Space, type "unlock", Return, type "catppuccin", Return. A floating "Omarchy" terminal opens, asks for the sudo password (type prime, Return), runs, and ends with a Done prompt; press the key it names to close.
  ** This may rebuild the initramfs and take a minute; keep screenshotting.
  * Press Super+Return, type `omarchy plymouth current` Return → `catppuccin`.
  * Type `omarchy plymouth reset` Return (password prime if asked), then `omarchy plymouth current` Return → `default`. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The presentation terminal shows the logo, the output, then "Done" or "Failed"; Failed with red text is a failure — capture it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the desktop after Escape, the presentation terminal at Done, and `omarchy plymouth current` before and after reset
  * If unsuccessful
  ** Screenshot of the Failed terminal and its error text
covers: manual/06:70; omarchy-menu.jsonc:106; bin/omarchy-plymouth-switcher; bin/omarchy-plymouth-set-by-theme; bin/omarchy-plymouth-reset

### keybindings-menu-super-k-variants   [VM-OK]
description: Super+K lists every Hyprland binding in a searchable menu; Super+Alt+K and Super+Ctrl+K do the same for Tmux and Herdr, and Learn → Keybindings is the menu route.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K. A list of key combinations with descriptions opens (e.g. "SUPER + RETURN  Terminal").
  * Type "screenshot". The list filters to the capture bindings (PRINT …). Escape twice.
  * Press Super+Alt+K. A Tmux bindings list opens. Escape until closed.
  * Press Super+Ctrl+K. A Herdr bindings list opens. Escape until closed.
  * Press Super+Space, type "keybindings", Return (Learn → Keybindings). The Hyprland list opens again. Escape.
  * Unhappy path: press Super+K, type "qqqzzz" → "No matches". Escape twice; bare desktop.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+K <M-k>, Super+Alt+K <M-A-k>, Super+Ctrl+K <M-C-k>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Hyprland list, the "screenshot" filter, the Tmux list, the Herdr list, the Learn route, and "No matches"
  * If unsuccessful
  ** Screenshot of an empty list
covers: manual/03:57, manual/07:3; default/hypr/bindings/utilities.lua:10-12; bin/omarchy-menu-keybindings; bin/omarchy-menu-tmux-keybindings; bin/omarchy-menu-herdr-keybindings; omarchy-menu.jsonc:45

### launch-app-hotkeys-core   [VM-OK]
description: The always-bound launchers start their apps: Super+Shift+F Files, Super+Shift+Alt+F Files in the terminal's folder, Super+Shift+N the editor, Super+Ctrl+Q the calculator, Super+Shift+B the browser.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `cd /etc` Return.
  * Press Super+Shift+Alt+F. Files opens showing /etc. Press Super+Shift+F. A second Files window opens at Home.
  * Press Super+Shift+N. Neovim (LazyVim dashboard) opens in a terminal window. Type `:q` Return.
  * Press Super+Ctrl+Q. The omacalc calculator floats; type `2+2` Return and see 4. Press Super+W.
  * Press Super+Shift+B. Chromium opens (an undocumented alias of Super+Shift+Return — report it as present).
  * Press Ctrl+Alt+Delete. Empty desktop.
  * Unhappy path: press Super+Shift+Alt+F with no terminal focused. Files still opens (falls back to Home). Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+F is <M-S-A-f>; Super+Ctrl+Q is <M-C-q>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Files at /etc, Files at Home, Neovim, omacalc showing 4, Chromium, and Files after the fallback
  * If unsuccessful
  ** Screenshot of the missing window
covers: manual/07:99-109; default/hypr/bindings/applications.lua:2-8; default/hypr/bindings/utilities.lua:13; bin/omarchy-launch-nautilus-cwd; bin/omarchy-launch-editor

### webapp-hotkeys-and-private-browser   [VM-OK] [NET]
description: Web-app hotkeys open a site in a dedicated Chromium app window (Super+Shift+Y YouTube, Super+Shift+A ChatGPT) and Super+Shift+Alt+B opens an incognito browser. Pages need the network (a few MB).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Y. A Chromium app window (no tab strip or address bar) loads youtube.com.
  ** Pages can take 10–20 s over the VM's NAT; keep screenshotting.
  * Press Super+Shift+Alt+B. A separate Incognito window ("You've gone Incognito") opens.
  * Press Super+Shift+A. A ChatGPT app window opens (its login page is fine).
  * Press Ctrl+Alt+Delete. Empty desktop.
  * Unhappy path: press Super+Return, type `omarchy-launch-webapp 'not a url'` Return. A Chromium error/search page or a printed error — no crash. Close it and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+B is <M-S-A-b>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the YouTube app window, the Incognito window, the ChatGPT window, and the unhappy result
  * If unsuccessful
  ** Screenshot of the blank/failed window
covers: manual/07:103,113,125; default/hypr/bindings/applications.lua:7,22,27; bin/omarchy-launch-browser; bin/omarchy-launch-webapp

### emoji-picker-inserts-into-terminal   [VM-OK]
description: Super+Ctrl+E opens the emoji picker; typing filters and Return inserts the emoji into the focused app (the manual says "on the clipboard" — record which happens); an empty filter inserts nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo ` (trailing space, no Return).
  * Press Super+Ctrl+E. An emoji grid with a search field opens. Type "smile"; the grid filters to smiling faces.
  * Press Return. The picker closes and a smiling face appears after `echo `. Press Return: it echoes on its own line.
  * Press Super+Ctrl+V and check whether the emoji is in the clipboard history (expected: not listed, it is copied as sensitive). Escape.
  * Unhappy path: press Super+Ctrl+E, type "zzqx" (no matches), Escape twice. Nothing is inserted.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+E is <M-C-e>. A box glyph still counts if the echoed line contains a non-ASCII character.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the filtered grid, the emoji on the command line and echoed, the clipboard history, and the empty-filter picker
  * If unsuccessful
  ** Screenshot of the terminal with nothing inserted
covers: manual/07:77,338; default/hypr/bindings/utilities.lua:3; shell/plugins/emojis/Emojis.qml; bin/omarchy-menu-emoji-insert

### share-menu-localsend-paths   [VM-OK]
description: Super+Ctrl+S opens Trigger → Share (Clipboard, File, Folder, Receive): Receive launches LocalSend floating, File opens a chooser that can be cancelled, Clipboard hands a temp file to LocalSend. No peer exists, so only the UI is checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+S. The Share submenu shows Clipboard, File, Folder, Receive.
  * Type "receive", Return. LocalSend opens as a floating centred window with a device name and Receive tab. Press Super+W.
  * Press Super+Ctrl+S, type "file", Return. A chooser "Share files" opens. Press Escape: nothing else opens, no error toast.
  * Press Super+Ctrl+S, type "clipboard", Return. A LocalSend send window listing one .txt file opens and finds no devices. Press Super+W.
  * Unhappy path: press Super+Ctrl+S, then Escape twice. Nothing launches; bare desktop.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+S is <M-C-s>. LocalSend takes a few seconds the first time.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Share submenu, the LocalSend receive window, the file chooser, and the send window with the temp file
  * If unsuccessful
  ** Screenshot of the missing window or of a "Could not share" toast
covers: manual/03:34, manual/07:72, manual/12:78; default/hypr/bindings/utilities.lua:85; omarchy-menu.jsonc:70,86-89; bin/omarchy-menu-share

### notifications-dismiss-invoke-history   [VM-OK]
description: Super+, dismisses the newest toast, Super+Shift+, dismisses all, Super+Shift+Alt+, opens the history, and Super+Alt+, re-runs the last notification's click action.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `for i in 1 2 3; do omarchy-notification-send --app-name Demo -u normal "Toast $i" "body $i"; done` Return. Three toasts stack top-right.
  * Press Super+, . Only "Toast 3" disappears.
  * Press Super+Shift+, . The rest disappear.
  * Press Super+Shift+Alt+, . A history panel lists Toast 1–3. Escape.
  * Type `omarchy-notification-send "Open a terminal" "click test" --exec xdg-terminal-exec` Return; wait for the toast to expire (~5 s); press Super+Alt+, . A new terminal window opens.
  * Unhappy path: press Super+, with no toast on screen. Nothing happens.
  * Press Super+W twice. Empty desktop.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+, <M-,>; Super+Shift+, <M-S-,>; Super+Alt+, <M-A-,>; Super+Shift+Alt+, <M-S-A-,>. Normal toasts last 8 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of three toasts, two, none, the history with three entries, and the terminal opened by invoke-last
  * If unsuccessful
  ** Screenshot of toasts that did not dismiss
covers: manual/03:36, manual/07:163-168; default/hypr/bindings/utilities.lua:25-29; docs/notifications.md; bin/omarchy-notification-send

### do-not-disturb-silences-and-keeps-history   [VM-OK]
description: Super+Ctrl+, turns on Do Not Disturb: third-party toasts stop but land in history, the bell-slash indicator lights, and Omarchy's own confirmations still show; the second press restores normal toasts.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+, . A crossed-out bell lights next to the clock.
  * Press Super+Return, type `omarchy-notification-send --app-name Chat -u normal "Silenced message" "hidden"` Return. No toast appears.
  ** `--app-name Chat` makes it third-party; without it Omarchy treats it as its own confirmation.
  * Press Super+Ctrl+Alt+T. The Omarchy time toast STILL appears under DND.
  * Press Super+Shift+Alt+, . History lists "Silenced message". Escape.
  * Press Super+Ctrl+, . The bell goes out. Re-run the Chat command: the toast now appears.
  * Unhappy path: type `omarchy toggle notification silencing` Return twice quickly. The indicator ends off, as it started; no crash.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+, is <M-C-,>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the lit bell, no toast after the Chat message, the time toast under DND, the history entry, the bell off, and the Chat toast appearing afterwards
  * If unsuccessful
  ** Screenshot of a toast shown under DND or of a missing history entry
covers: manual/07:166, manual/13:14,58-63; default/hypr/bindings/utilities.lua:27; bin/omarchy-toggle-notification-silencing; docs/notifications.md; shell/plugins/bar/indicators/Dnd.qml

### window-transparency-gaps-square-fullscreen-desktop   [VM-OK]
description: The four style toggles: Super+Backspace window transparency, Super+Shift+Backspace window gaps, Super+Ctrl+Alt+F fullscreen desktop (bar + gaps off together), Super+Ctrl+Backspace single-window square aspect with its toasts.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice: two tiles with gaps between them and the screen edges.
  * Press Super+Backspace. The focused terminal becomes see-through. Press again: opaque.
  * Press Super+Shift+Backspace. Gaps vanish (tiles touch each other and the edges). Press again: gaps return.
  ** Gap toggles reload Hyprland; allow a second.
  * Press Super+Ctrl+Alt+F. Bar hidden and gaps gone at once. Press again: both back.
  * Press Super+W (one tile left). Press Super+Ctrl+Backspace: toast "Enable single-window square aspect ratio" and the lone window shrinks to a centred squarer shape. Press again: "Disable …" toast, window fills the workspace.
  * Press Super+W. Empty desktop.
  * Unhappy path: press Super+Backspace on the empty desktop. Nothing happens.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * <M-BS>, <M-S-BS>, <M-C-A-f>, <M-C-BS>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: transparent vs opaque; gaps off vs on; bar+gaps off vs on; square aspect on with toast and off with toast
  * If unsuccessful
  ** Screenshot of the state that did not change
covers: manual/07:176-177,194-195, manual/13:26; default/hypr/bindings/utilities.lua:19-22; bin/omarchy-hyprland-window-transparency-toggle; bin/omarchy-hyprland-window-gaps-toggle; bin/omarchy-hyprland-window-single-square-aspect-toggle; bin/omarchy-toggle-fullscreen-desktop

### xcompose-quick-emoji-and-completion   [VM-OK]
description: CapsLock is the compose key: CapsLock M S types 😄, CapsLock M H types ❤️, CapsLock Space Space types an em dash and CapsLock Space N your name, while an undefined sequence types nothing special.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo ` (no Return).
  * Tap CapsLock, then m, then s — three separate key presses, not a chord. A 😄 appears after `echo `.
  ** The very first compose after login can take a second while the input method warms up; if nothing appears, wait two seconds and try once more.
  * Tap CapsLock, m, h. ❤️ appears. Press Return: the line echoes both glyphs.
  * Type `echo ` then tap CapsLock, Space, Space. An em dash — appears. Then CapsLock, Space, n: your name as entered at install appears. Press Return.
  * Unhappy path: type `echo ` then tap CapsLock, m, q (undefined). Either nothing or the plain letters appear — no emoji, no crash. Press Return.
  * Type `echo caps-test` Return. It must print in lower case (CapsLock did not toggle capitals).
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<CAPSLOCK>` then `m` then `s` as three send-keys calls (or one with the tokens in order). Letters must be lower case.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of 😄 and ❤️ on the command line and echoed, the em dash and the name echoed, the undefined sequence producing no emoji, and `caps-test` echoed in lower case
  * If unsuccessful
  ** Screenshot of the terminal after the sequence; type `systemctl --user is-active omarchy-fcitx5.service` Return and screenshot the answer
covers: manual/07:336-374; default/xcompose; default/hypr/input.lua:37; bin/omarchy-restart-xcompose

### universal-clipboard-terminal-and-gui   [VM-OK]
description: Super+C / Super+V copy and paste in the terminal (where Ctrl+C would kill the program) and in a GUI field, and Super+X cuts — the unified clipboard promise.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `echo unified-clipboard-42` Return. Double-click the printed word to select it and press Super+C.
  * Type `echo ` then Super+V, Return. `unified-clipboard-42` prints again.
  * Type `sleep 30` Return, then press Super+C. The sleep keeps running (no `^C`, no prompt). Press Ctrl+C: the prompt returns.
  * Press Super+Shift+Return. Click the browser's address bar, type `hello-omarchy`, press Ctrl+A then Super+X. The field empties. Press Super+V: the text is back.
  * Click the terminal, type `echo ` then Super+V, Return. `hello-omarchy` prints.
  * Unhappy path: type `omarchy capture screenshot fullscreen copy` Return (clipboard now holds an image), then `echo ` and Super+V, Return. Nothing meaningful is pasted and nothing crashes.
  * Press Super+W twice.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * <M-c> <M-v> <M-x>. In the terminal these become Ctrl+Insert / Shift+Insert under the hood, so select first, then Super+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the pasted word, the sleep surviving Super+C, the browser field cut then restored, and `hello-omarchy` pasted in the terminal
  * If unsuccessful
  ** Screenshot of the terminal where the paste did not land
covers: manual/03:25, manual/07:130-138, manual/08:8-12; default/hypr/bindings/clipboard.lua; config/foot/foot.ini:18-20

### clipboard-history-picker-paste-copy-delete   [VM-OK]
description: Super+Ctrl+V opens the clipboard history with text and images; typing filters, Return pastes the entry, Shift+Return copies only, Delete removes one, Escape clears the filter then closes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `printf alpha-111 | wl-copy; sleep 1; printf beta-222 | wl-copy; sleep 1; printf gamma-333 | wl-copy` Return, then `omarchy capture screenshot fullscreen copy` Return.
  * Type `echo ` (no Return) and press Super+Ctrl+V. The history lists an image thumbnail, then gamma-333, beta-222, alpha-111.
  * Type "beta", Return. The picker closes and `beta-222` lands after `echo `; press Return.
  ** The manual says Return leaves the entry on the clipboard; the code pastes it too. Record what you saw.
  * Press Super+Ctrl+V, arrow to alpha-111, Shift+Return. Nothing is typed; type `wl-paste` Return → alpha-111.
  * Press Super+Ctrl+V, arrow to gamma-333, Delete. It vanishes. Escape.
  * Unhappy path: press Super+Ctrl+V, type "zzz" → "No matches for “zzz”". Escape (filter clears), Escape (closes).
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+V is <M-C-v>. Filter first, then Return — a bare Return on an unhighlighted list only settles the cursor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the history with image and three texts, the beta filter, beta-222 pasted, `wl-paste` = alpha-111, the list without gamma-333, and "No matches"
  * If unsuccessful
  ** Screenshot of the picker state
covers: manual/03:27, manual/08:18-24; default/hypr/bindings/clipboard.lua:48; shell/plugins/clipboard/Clipboard.qml; bin/omarchy-clipboard-paste-text

### reminder-hotkey-flow-fires-and-clears   [VM-OK]
description: Super+Ctrl+R asks for minutes and a message and confirms with a toast and indicator; Super+Ctrl+Alt+R lists pending reminders; the reminder fires as a toast; Super+Ctrl+Shift+R clears all; a non-number is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+R. A minutes prompt opens; type `1` Return. A message prompt follows; type `Tea ready` Return.
  * Toast "Tea ready in 1 minutes" / "You'll be reminded at HH:MM" appears and a reminder glyph lights next to the clock.
  * Press Super+Ctrl+Alt+R. Toast "Upcoming reminders" listing "Tea ready in …".
  * Screenshot every 5 s for up to 70 s. A toast "Reminder" / "Tea ready" appears and the glyph goes out.
  ** Timers fire on the minute, so up to ~65 s after setting.
  * Press Super+Ctrl+R, `5`, Return, Return (empty message). Toast "Reminder set for 5 minutes". Press Super+Ctrl+Shift+R: toast "All reminders have been cleared", glyph out.
  * Unhappy path: press Super+Ctrl+R, type `abc`, Return. The flow does not proceed; Escape closes it. Super+Ctrl+Alt+R → "No outstanding reminders".
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * <M-C-r>, <M-C-A-r>, <M-C-S-r>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both prompts, the confirmation toast with lit glyph, the upcoming list, the fired toast with the glyph out, the cleared toast, and "No outstanding reminders" after the refused input
  * If unsuccessful
  ** Screenshot at 70 s without the fired toast
covers: manual/07:200-203, manual/09; default/hypr/bindings/utilities.lua:89-91; omarchy-menu.jsonc:83-85; bin/omarchy-reminder; shell/plugins/reminders/; shell/plugins/bar/indicators/Reminder.qml

### reminder-cli-set-show-json-rejects   [VM-OK]
description: `omarchy reminder N 'msg'` sets a reminder from the terminal, `show`/`show --json`/`clear` report and remove it, and zero or non-numeric minutes are refused with usage.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy reminder 7 'Tea ready'` Return. Toast "Tea ready in 7 minutes"; glyph lights.
  * Type `omarchy reminder 3` Return. Toast "Reminder set for 3 minutes".
  * Type `omarchy reminder show` Return. Toast "Upcoming reminders" with two lines.
  * Type `omarchy reminder show --json` Return. JSON with `"count":2` prints.
  * Unhappy path: type `omarchy reminder 0` Return, then `omarchy reminder abc` Return. Each prints the usage lines and no toast.
  * Type `omarchy reminder clear` Return. Toast "All reminders have been cleared"; glyph out. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts last 5 s; screenshot right after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two set toasts, the upcoming toast, the count-2 JSON, the two usage rejections, and the cleared toast with the glyph out
  * If unsuccessful
  ** Screenshot of the terminal output
covers: manual/09:3; bin/omarchy-reminder

### notice-time-hotkey   [VM-OK]
description: Super+Ctrl+Alt+T shows the date and time as a toast matching the bar clock, still shows under Do Not Disturb, and repeated presses do not break the shell.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+T. A toast "<Weekday> HH:MM · DD Month YYYY · Week NN" appears; its time matches the bar clock.
  * Press Super+Ctrl+, (DND on), then Super+Ctrl+Alt+T. The toast still appears. Press Super+Ctrl+, (DND off).
  * Unhappy path: press Super+Ctrl+Alt+T five times quickly. Toasts stack or replace; the shell keeps running. Press Super+Shift+, to clear them.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Alt+T is <M-C-A-t>; the toast lasts 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the time toast beside the bar clock, the toast under DND, and the cleared desktop
  * If unsuccessful
  ** Screenshot without the toast
covers: manual/07:209, manual/10:7; default/hypr/bindings/utilities.lua:93; bin/omarchy-notification-time

### ocr-super-ctrl-print-extracts-text   [VM-OK]
description: Super+Ctrl+Print freezes the screen, a dragged region is OCR'd with tesseract and the text lands on the clipboard with a toast; Escape at the crosshair extracts nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, press Super+F, type `clear; printf '\n\n   HELLO OMARCHY 2026\n\n'` Return. Large clear text near the top.
  * Press Super+Ctrl+Print. The screen freezes and the cursor becomes a crosshair.
  * Drag a rectangle tightly around HELLO OMARCHY 2026 and release. Toast "Copied text from selection to clipboard".
  * Type `echo "` then Super+V then `"` Return. The output contains HELLO OMARCHY 2026 (O/0 variations acceptable; report the exact text).
  * Unhappy path: press Super+Ctrl+Print, then Escape at the crosshair. The freeze ends, no toast; `wl-paste` Return still prints the previous text.
  * Press Super+F, Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Print is <M-C-PRINT>. Use `mouse drag` from above-left to below-right of the text.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the frozen screen with the selection, the toast, the pasted text, and the cancelled attempt with no toast
  * If unsuccessful
  ** Screenshot after the drag with no toast; type `omarchy capture text` Return and screenshot any error
covers: manual/07:148, manual/11:5, manual/12:10,62; default/hypr/bindings/utilities.lua:43; bin/omarchy-capture-text

### dictation-absent-and-install-prompt   [VM-PARTIAL]
description: Without Voxtype the dictation hotkeys are inert and Install → AI → Dictation offers the ~150 MB install behind a confirm that can be declined. Skipped: speech input (no microphone) and the install itself.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `command -v voxtype || echo NO-VOXTYPE` Return → NO-VOXTYPE.
  * Type `echo ` (no Return), press Super+Ctrl+X, then press and release F9. Nothing is typed, no error.
  * Press Super+K, type "dictation" → no rows. Escape twice.
  * Press Super+Space, type "dictation", Return (Install → AI → Dictation). A floating "Omarchy" terminal asks "Install Voxtype + AI model (~150MB) to enable dictation?" with Yes/No.
  * Choose No (arrow to No, Return). The terminal ends without installing; `command -v voxtype` in the terminal is still empty.
  * Unhappy path: Super+Space → Remove → AI: no Dictation row. Escape. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+X is <M-C-x>; F9 is <F9>. gum confirm highlights one button; Return picks it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of NO-VOXTYPE, the untouched command line after the hotkeys, the empty Super+K filter, the install confirm, and the declined result
  * If unsuccessful
  ** Screenshot of anything typed by the hotkeys or an install starting without confirmation
covers: manual/07:153-154, manual/11:13-15; default/hypr/bindings/voxtype.lua; omarchy-menu.jsonc:245,314; bin/omarchy-voxtype-install

### screenshot-print-region-and-dismiss   [VM-OK]
description: Print freezes the screen, a dragged region is saved to ~/Pictures and the clipboard with a thumbnail toast that opens the annotation editor; pressing Print again dismisses the picker without a capture.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `ls ~/Pictures | wc -l` Return (note the count).
  * Press Print. The screen freezes and the cursor becomes a crosshair.
  * Drag a rectangle over the middle third of the screen and release. Toast "Screenshot saved to clipboard and file" / "Edit with Super + Alt + , (or click this)" with a thumbnail.
  * Click the toast. Tensaku opens floating with the captured image. Press Super+W.
  ** The toast lasts 5 s; if it is gone, press Super+Alt+, to invoke it.
  * Type `ls -t ~/Pictures | head -1` Return → `screenshot-YYYY-MM-DD_HH-MM-SS.png`; `wl-paste --list-types` Return includes image/png.
  * Unhappy path: press Print, then Print again at the crosshair. The freeze ends, no toast, `ls ~/Pictures | wc -l` is unchanged since the capture.
  * Type `rm ~/Pictures/screenshot-*.png` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Print is <PRINT>. Escape also dismisses the picker.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the frozen picker with the drag, the toast with thumbnail, Tensaku with the image, the file name and image/png listed, and the unchanged count after the dismissed picker
  * If unsuccessful
  ** Screenshot after the drag with no toast
covers: manual/03:35, manual/07:145, manual/12:16-20; default/hypr/bindings/utilities.lua:38; bin/omarchy-capture-screenshot; bin/omarchy-capture-region

### screenshot-print-keyboard-window-fullscreen   [VM-OK]
description: While the Print selection is up, Tab and the arrows highlight windows, Return captures the highlighted window and Ctrl+Return the whole screen — the keyboard-only picker of chapter 12.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice; type `echo LEFT` Return in the left terminal and `echo RIGHT` Return in the right one.
  * Press Print, then Tab. The highlight and pointer jump to a window; Tab again moves to the other.
  * Press Left or Right toward the other window, then Return. A toast appears; click it: the image shows exactly one terminal (LEFT or RIGHT). Press Super+W to close the viewer.
  * Press Print, then Ctrl+Return at once. Click the toast: the image shows the whole screen with the bar and both terminals. Press Super+W.
  * Unhappy path: press Print, then Return without moving anything. Whatever is under the pointer is captured (window or full monitor); record which; no crash.
  * Type `rm ~/Pictures/screenshot-*.png` Return in a terminal, press Super+W twice.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * These keys only exist while the selection overlay is up. Ctrl+Return is <C-ENTER>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the highlight moving with Tab, the single-window capture in the editor, and the full-screen capture in the editor
  * If unsuccessful
  ** Screenshot showing Tab not moving the highlight
covers: manual/12:26-35; default/hypr/bindings/utilities.lua:50-83; bin/omarchy-capture-region --take-window/--take-fullscreen/--select-window

### capture-menu-without-print-key   [VM-OK]
description: For keyboards without a Print key, Super+Ctrl+C opens the Capture menu with Screenshot, Screenrecord, Text, QR Code and Color; Screenshot from there behaves exactly like Print, and Escape leaves the menu without capturing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+C. The menu opens at Capture with rows Screenshot, Screenrecord, Text, QR Code, Color (no "Stop Screenrecording", nothing is recording).
  * Type "screenshot", Return. The screen freezes with a crosshair, exactly as with Print.
  * Click once inside the bar. The shot snaps to the whole monitor; toast "Screenshot saved to clipboard and file".
  * Press Super+Space → Trigger → Capture (Down to Trigger, Return, then to Capture, Return). The same five rows appear via the long route. Escape.
  * Unhappy path: press Super+Ctrl+C, then Escape. Nothing is captured; bare desktop.
  * Press Super+Return, type `rm ~/Pictures/screenshot-*.png` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+C is <M-C-c>. A single click (no drag) snaps to the window or monitor under the pointer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Capture submenu, the crosshair, the toast, the long-route submenu, and the bare desktop after Escape
  * If unsuccessful
  ** Screenshot of the menu with rows missing
covers: manual/07:144,158, manual/12:3,11; default/hypr/bindings/utilities.lua:4; omarchy-menu.jsonc:58-64

### screenshot-cli-modes-and-custom-dir   [VM-OK]
description: `omarchy screenshot` and `omarchy capture screenshot <mode> <processing>` cover fullscreen/region and copy/save; a custom OMARCHY_SCREENSHOT_DIR is created on demand with a toast; the picker can be cancelled quietly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy capture screenshot fullscreen save` Return. No picker; the saved path prints; no toast.
  * Type `omarchy capture screenshot fullscreen copy` Return. Nothing prints, no new file, `wl-paste --list-types` Return shows image/png.
  * Type `OMARCHY_SCREENSHOT_DIR=/tmp/shots omarchy capture screenshot fullscreen` Return. Toast "Created screenshot directory: /tmp/shots" then the normal saved toast.
  * Type `omarchy screenshot` Return (alias). Crosshair appears; press Ctrl+Return. Toast.
  * Type `omarchy capture screenshot --help` Return. Usage with `[smart|region|windows|fullscreen] [slurp|copy|save] [--editor=<name>]`.
  * Unhappy path: type `omarchy capture screenshot region` Return, then Escape. Quiet exit, no file.
  * Type `rm -rf /tmp/shots ~/Pictures/screenshot-*.png` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `fullscreen` needs no interaction; use it whenever you just need a file.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the printed path, image/png in the types, the "Created screenshot directory" toast, the help text, and the quiet cancel
  * If unsuccessful
  ** Screenshot of the failing command's output
covers: manual/12:20-22, manual/14:24,55; bin/omarchy-capture-screenshot; bin/omarchy (alias routing)

### screenrecord-alt-print-start-stop   [VM-PARTIAL]
description: Alt+Print opens the Screenrecord audio choice, "With no audio" records a picked window with a bar indicator, Alt+Print again stops it and an MP4 with a thumbnail toast lands in ~/Videos. Skipped: audio and webcam variants (no devices); encoding falls back to CPU.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Alt+Print. The Screenrecord submenu shows "With no audio", "With desktop audio", "With desktop + microphone audio" — no webcam row, no "Stop Screenrecording".
  * Type "no audio", Return. The screen freezes; click once inside the terminal (snaps to that window).
  * Within a few seconds a red recording indicator lights next to the clock. Type `echo recording` Return; wait 5 s.
  * Press Super+Ctrl+C → Screenrecord: "Stop Screenrecording" is now the first row. Escape (do not stop here).
  * Press Alt+Print. The indicator goes out; toast "Screen recording saved" / "Open with Super + Alt + , (or click this)" with a thumbnail.
  * Click the toast. mpv plays the clip; press q. Type `ls ~/Videos` Return → `screenrecording-YYYY-MM-DD_HH-MM-SS.mp4`.
  * Unhappy path: press Alt+Print, "no audio", then Escape at the crosshair. No indicator, no toast, no new file.
  * Type `rm ~/Videos/screenrecording-*.mp4` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Alt+Print is <A-PRINT>. If the indicator never lights, type `OMARCHY_SCREENRECORD_DEBUG=true omarchy capture screenrecording --fullscreen` Return, wait 5 s, run it again, then `cat $XDG_RUNTIME_DIR/omarchy-screenrecord.log | sudo tee /dev/ttyS0` Return and read it with get-serial — a CPU-fallback failure on this GPU-less VM is a finding.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Screenrecord submenu without webcam/stop rows, the lit indicator, the submenu with Stop Screenrecording, the saved toast, mpv playing, and the file listed
  * If unsuccessful
  ** The serial dump of the recorder log and any "Screen recording error" toast
covers: manual/07:146,156, manual/12:39-47; default/hypr/bindings/utilities.lua:39; omarchy-menu.jsonc:60-68; bin/omarchy-capture-screenrecording; shell/plugins/bar/indicators/ScreenRecording.qml

### screenrecord-missing-dir-rejects   [VM-OK]
description: The recorder refuses to start when OMARCHY_SCREENRECORD_DIR does not exist (critical toast, no indicator), --stop-recording with nothing running exits quietly, and a bad webcam size is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `OMARCHY_SCREENRECORD_DIR=/tmp/no-such-dir omarchy capture screenrecording --fullscreen; echo rc=$?` Return.
  * A persistent toast "Screen recording directory does not exist: /tmp/no-such-dir" appears, `rc=1` prints, no indicator lights. Press Super+, to dismiss.
  * Type `omarchy capture screenrecording --stop-recording; echo rc=$?` Return → `rc=1`, no toast.
  * Type `omarchy capture screenrecording --webcam-size=huge --fullscreen; echo rc=$?` Return → `Invalid webcam size: huge (expected small, medium, or large)`, `rc=1`.
  * Type `omarchy capture webcam resize gigantic; echo rc=$?` Return → usage, `rc=1`.
  * Type `ls ~/Videos` Return: no recording was written. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Critical toasts stay until dismissed with Super+, .
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the critical toast with rc=1, the quiet rc=1, the webcam-size rejection, the usage rejection, and the empty Videos listing
  * If unsuccessful
  ** Screenshot of an indicator lighting or a file appearing
covers: manual/12:41,58; bin/omarchy-capture-screenrecording:24-29,60-66; bin/omarchy-capture-webcam-resize

### color-picker-super-print   [VM-OK]
description: Super+Print turns the cursor into an eyedropper; a click copies the pixel's hex colour to the clipboard, and pressing Super+Print again while it is active cancels it without changing the clipboard.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `clear; printf '\e[41m%60s\e[0m\n%.0s' ' ' {1..8}` Return. A large red block fills part of the terminal.
  * Press Super+Print. The screen freezes and a magnified picker swatch follows the cursor.
  * Click in the middle of the red block. The picker closes.
  * Type `echo ` then Super+V, Return. A hex colour with high red and low green/blue prints (e.g. `#cd0000`).
  * Unhappy path: press Super+Print (picker active), then Super+Print again. The picker closes; `wl-paste` Return still prints the same colour.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Print is <M-PRINT>. Trigger → Capture → Color is the same command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the red block, the eyedropper overlay, the pasted hex value, and the cancelled picker with the clipboard unchanged
  * If unsuccessful
  ** Screenshot after the click with no colour pasted
covers: manual/07:147, manual/12:9,66; default/hypr/bindings/utilities.lua:42; omarchy-menu.jsonc:64

### qr-code-capture-decode-and-none-found   [VM-OK]
description: Trigger → Capture → QR Code decodes a QR code in the selected region to the clipboard as a sensitive copy (kept out of history) and reports "No QR code found" when the region has none.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, Super+F, type `clear; qrencode -t ANSIUTF8 -m 2 'omarchy-qr-ok'` Return. A block-character QR code appears.
  * Press Super+Ctrl+C, type "qr", Return. Drag a rectangle around the code with margin. Toast "QR code copied to clipboard".
  * Type `echo ` then Super+V, Return → `omarchy-qr-ok`.
  * Press Super+Ctrl+V: `omarchy-qr-ok` is NOT listed (sensitive). Escape.
  * Unhappy path: type `clear` Return, then Super+Ctrl+C → "qr" → drag over the empty terminal. Critical toast "No QR code found" / "Select a region containing a QR code". Press Super+, .
  * Press Super+F, Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Fullscreen makes the blocks large enough to decode.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the QR code, the copied toast, the decoded text echoed, the history without it, and the "No QR code found" toast
  * If unsuccessful
  ** Screenshot after the drag with neither toast
covers: manual/12:64; omarchy-menu.jsonc:63; bin/omarchy-capture-qr; shell/plugins/clipboard/capture.sh:15-17

### transcode-picture-menu-and-cli   [VM-OK]
description: Super+Ctrl+. picks a picture from ~/Pictures, asks format and size, writes a resized copy beside the original and puts its file URI on the clipboard; the CLI form works too and bad inputs are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy capture screenshot fullscreen save` Return (a picture now exists).
  * Press Super+Ctrl+. . A picker "Transcode picture or video" lists the screenshot; Return. Choose jpg, then low (Return each).
  * Toast "Transcoded to low jpg" / "Saved and copied to clipboard."
  * Type `ls ~/Pictures` Return: a `…-low.jpg` sits next to the PNG. Type `echo ` then Super+V, Return → `file:///home/prime/Pictures/…-low.jpg`.
  * Unhappy path: type `omarchy transcode /tmp/missing.png jpg low` Return → `File not found: /tmp/missing.png`. Then press Super+Ctrl+. and Escape at the picker: nothing happens.
  * Type `rm ~/Pictures/screenshot-*` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+. is <M-C-.>. The pickers are menu lists: type to filter, Return to choose.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the file picker, the format and size lists, the toast, the `ls` with the -low.jpg, the pasted file URI, and the rejection
  * If unsuccessful
  ** Screenshot of the failing step
covers: manual/07:79, manual/12:12,70-74; default/hypr/bindings/utilities.lua:87; omarchy-menu.jsonc:69; bin/omarchy-transcode

### toggle-menu-screensaver-crash-capture   [VM-OK]
description: Super+Ctrl+O opens Trigger → Toggle, `omarchy toggle` lists the group, and the Screensaver and Crash Capture switches flip with confirmation toasts from menu or CLI; an unknown flag is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+O. The menu opens directly in Toggle (Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio). Escape.
  * Press Super+Return, type `omarchy toggle` Return. "Toggle commands — Toggle Omarchy features:" lists `omarchy toggle bar`, `… idle`, `… nightlight`, `… screensaver`, `… suspend` …
  * Type `omarchy toggle screensaver` Return → toast "Screensaver disabled". Again → "Screensaver enabled".
  * Press Super+Ctrl+O, type "crash", Return → toast "Crash capture disabled". Repeat → "Crash capture enabled".
  * Unhappy path: type `omarchy-toggle bar-off sideways` Return → usage line; the bar stays visible.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+O is <M-C-o>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Toggle submenu, the group listing, the two screensaver toasts, the two crash-capture toasts, and the usage rejection with the bar visible
  * If unsuccessful
  ** Screenshot of the missing toast or the menu row that did nothing
covers: manual/13:7-17,28-34; default/hypr/bindings/utilities.lua:5; omarchy-menu.jsonc:90-99; bin/omarchy-toggle; bin/omarchy-toggle-screensaver; bin/omarchy-toggle-crash-capture; bin/omarchy

### suspend-toggle-hides-system-menu-row   [VM-OK]
description: `omarchy toggle suspend` removes Suspend from the System menu with a toast and puts it back on the second call — without ever suspending the machine.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape. Suspend is listed between Lock and Logout. Escape.
  * Press Super+Return, type `omarchy toggle suspend` Return → toast "Suspend removed from system menu".
  * Press Super+Escape. Suspend is gone; the other rows remain. Escape.
  * Type `omarchy toggle suspend` Return → toast "Suspend now available in system menu".
  * Press Super+Escape. Suspend is back. Escape — do NOT select it.
  * Unhappy path: type `omarchy-toggle-enabled suspend-off && echo OFF || echo ON` Return → ON (flag cleared, state as at the start). Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Escape is <M-ESC>. Never activate Suspend in this VM.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the System menu with Suspend, the removed toast, the menu without Suspend, the available toast, the menu with Suspend again, and ON
  * If unsuccessful
  ** Screenshot of the menu row that did not change
covers: manual/13:21; omarchy-menu.jsonc:38; bin/omarchy-toggle-suspend; bin/omarchy-toggle-enabled

### nightlight-toggle-hotkey-status   [VM-PARTIAL]
description: Super+Ctrl+N starts hyprsunset and sets 4000 K, again returns to 6500 K, the indicator tracks it and `omarchy toggle nightlight --status` reports JSON. Skipped: the visible tint, which a virtual GPU may not render.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy toggle nightlight --status` Return → `"enabled":false`.
  * Press Super+Ctrl+N. A sun/moon indicator lights next to the clock; the screen may turn orange (record whether it does).
  * Type `omarchy toggle nightlight --status` Return → `"enabled":true,"temperature":4000`.
  * Press Super+Ctrl+N. Indicator off; `--status` → `"enabled":false,"temperature":6500`.
  * Press Super+Space, type "nightlight", Return. Indicator lights. Type `omarchy toggle nightlight` Return: off.
  * Unhappy path: press Super+Ctrl+N twice within a second. The indicator ends off and `--status` agrees; no crash.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+N is <M-C-n>. Compare the terminal's background colour between screenshots to spot the tint.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of status false, the lit indicator (tinted screen if rendered), status true/4000, indicator off with false/6500, and the menu path
  * If unsuccessful
  ** Screenshot of the indicator disagreeing with `--status`
covers: manual/07:187, manual/13:13,44-54; default/hypr/bindings/utilities.lua:32; omarchy-menu.jsonc:94; bin/omarchy-toggle-nightlight; shell/plugins/bar/indicators/NightLight.qml

### stay-awake-toggle-and-status   [VM-OK]
description: Super+Ctrl+I flips Stay Awake with a coffee-cup indicator, `omarchy toggle idle status` reports JSON, the menu row and the explicit stay-awake/allow-idle commands agree, and a bad action is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy toggle idle status` Return → `{"enabled":false,"class":"disabled","tooltip":"Stay Awake"}`.
  * Press Super+Ctrl+I. A coffee cup lights next to the clock; `status` → `"enabled":true` … "Allow Idle Lock & Screensaver".
  * Press Super+Ctrl+I. Cup off; `status` → `"enabled":false`.
  * Type `omarchy toggle idle stay-awake` Return (prints `disabled`, cup on), then `omarchy toggle idle allow-idle` Return (prints `enabled`, cup off).
  * Press Super+Space, type "stay awake", Return (cup on); repeat (cup off).
  * Unhappy path: type `omarchy toggle idle sleepy` Return → `Usage: omarchy-toggle-idle [toggle|stay-awake|allow-idle|status]`; cup stays off. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+I is <M-C-i>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each JSON status with the cup lit or unlit to match, and the usage rejection
  * If unsuccessful
  ** Screenshot of the cup disagreeing with the status
covers: manual/07:186, manual/13:15,83; default/hypr/bindings/utilities.lua:31; omarchy-menu.jsonc:90; bin/omarchy-toggle-idle; shell/plugins/bar/indicators/StayAwake.qml

### idle-screensaver-then-lock-with-short-timers   [VM-OK]
description: After `idle.screensaver` seconds the ASCII screensaver starts, input dismisses it and cancels the pending lock, and after `idle.lock` seconds without input the lock screen engages; Stay Awake suppresses both. Timers are shortened in shell.json from the guest terminal and restored.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy bar transparent false` Return, then `jq '.idle.screensaver=15 | .idle.lock=45' ~/.config/omarchy/shell.json > /tmp/s.json && mv /tmp/s.json ~/.config/omarchy/shell.json && jq .idle ~/.config/omarchy/shell.json` Return → screensaver 15, lock 45.
  ** The first command only materialises the user config file; the shell re-reads the file on save.
  * Send no keys or mouse; screenshot every 5 s. Between 15 and ~25 s a black full-screen window with animated ASCII art appears.
  * Move the mouse slightly. The screensaver exits. Keep idle and screenshotting for 40 s: the lock must NOT appear (the dismissal cancelled it); the screensaver may return around 15 s.
  * Stay idle through the screensaver: about 45 s after the last input the lock screen appears (then blanks after a few seconds).
  * Type prime, Return. The desktop returns with the terminal as left.
  * Unhappy path: press Super+Ctrl+I (Stay Awake) and stay idle 60 s: neither screensaver nor lock. Press Super+Ctrl+I.
  * Type `jq '.idle.screensaver=150 | .idle.lock=300' ~/.config/omarchy/shell.json > /tmp/s.json && mv /tmp/s.json ~/.config/omarchy/shell.json && omarchy bar defaults` Return, press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshots are not input; do not touch keys or mouse during the waits. On the black lock screen typing still reaches the password field.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the 15/45 jq output, the screensaver, the desktop after the mouse move with no lock in 40 s, the lock screen, the unlocked terminal, the empty 60 s under Stay Awake, and the restored 150/300
  * If unsuccessful
  ** Screenshot at the moment the wrong thing happened (lock too early, no screensaver)
covers: manual/05:134, manual/13:67-83,89; config/omarchy/shell.json:3-6; shell/plugins/services/idle/*.qml; bin/omarchy-launch-screensaver; bin/omarchy-system-lock

### screensaver-on-demand-system-menu   [VM-OK]
description: System → Screensaver starts the ASCII screensaver immediately — even when the idle screensaver is toggled off — and any key exits it; a second launch while running is a no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape, type "screensaver", Return. Within ~3 s a black full-screen window with animated ASCII art appears.
  * Wait 5 s and screenshot again: a different frame/effect.
  * Press Space. The screensaver exits; the desktop returns.
  * Press Super+Return, type `omarchy toggle screensaver` Return (toast "Screensaver disabled"). Press Super+Escape → Screensaver: it STILL starts. Press Space.
  * Type `omarchy toggle screensaver` Return (toast "Screensaver enabled").
  * Unhappy path: type `omarchy-launch-screensaver; omarchy-launch-screensaver; echo rc=$?` Return. One screensaver instance appears; press Space; the terminal shows `rc=0`. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Escape is <M-ESC>. A mouse move also exits the screensaver — keep the pointer still while screenshotting it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of two different screensaver frames, the desktop after Space, the screensaver running while toggled off, and rc=0
  * If unsuccessful
  ** Screenshot of any toast (e.g. "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty")
covers: manual/13:89-93; omarchy-menu.jsonc:36; bin/omarchy-launch-screensaver; bin/omarchy-screensaver; bin/omarchy-toggle-screensaver

### lock-hotkey-rejects-wrong-password   [VM-OK]
description: Super+Ctrl+L locks the session from the keyboard; a wrong password is rejected and the right one restores the desktop exactly as left (the existing `lock-screen` test covers the menu-and-mouse route).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `echo before-lock` Return.
  * Press Super+Ctrl+L. The lock screen appears.
  ** After a few seconds it turns black; typing still goes to the password field.
  * Type `wrongpass` Return. The lock stays engaged and signals failure (shake, red hint or cleared field).
  * Type `prime` Return. The desktop returns with the terminal still showing `before-lock`.
  * Unhappy path: press Super+Ctrl+L twice quickly. Exactly one lock screen; unlock with prime.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+L is <M-C-l>. Screenshot immediately after the wrong password, before the screen blanks.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the lock screen, the rejected password, the restored terminal with `before-lock`, and the single lock after the double press
  * If unsuccessful
  ** A desktop that unlocked without the password, or the crash dialog
covers: manual/07:12, manual/13:99-101; default/hypr/bindings/utilities.lua:127; bin/omarchy-system-lock; shell/plugins/lock/

### omarchy-cli-help-groups-check-unknown   [VM-OK]
description: `omarchy` prints its command-centre help, `omarchy <group>` and `--help` work at every level, `omarchy commands --check` validates the registry, and an unknown command is refused with a hint.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, Super+F, type `omarchy` Return. "Omarchy command center", Usage, Common commands (update, theme list, theme set, font list, screenshot, debug), Groups, Discovery.
  * Type `omarchy capture` Return. "Capture commands — Screenshots and screen recording:" with qr, screenrecording, screenshot, text, webcam resize.
  * Type `omarchy capture screenshot --help` Return. Usage, "Take a screenshot", Arguments, Examples, Aliases `omarchy screenshot`, Binary `omarchy-capture-screenshot`.
  * Type `omarchy commands --check` Return → "Command metadata check passed (N commands)".
  * Type `omarchy version` Return → a version string.
  * Unhappy path: type `omarchy frobnicate` Return → `Unknown Omarchy command: omarchy frobnicate` and `Run 'omarchy commands --all' to discover available commands.`
  * Press Super+F, Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If output scrolls off, append ` | sudo tee /dev/ttyS0` (password prime) and read it with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the main help, the capture group, the command help, the check passing, the version, and the unknown-command message
  * If unsuccessful
  ** Serial dump of `omarchy commands --check` (it names the offending binary)
covers: manual/14:7-58; bin/omarchy; bin/omarchy-version

### omarchy-menu-cli-summon-toggle-close   [VM-OK]
description: `omarchy menu` scripts the menu: `summon style.theme` opens the theme picker, `toggle system` opens then closes the System menu, `close` puts it away, aliases work, and an unknown verb is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy menu` Return. The root menu opens. Escape.
  * Type `omarchy menu toggle system` Return: System menu opens. Click the terminal, run it again: it closes.
  * Type `omarchy menu summon trigger.capture` Return: Capture opens. Run it again: stays open. Type `omarchy menu close` Return: closed.
  * Type `omarchy menu summon style.theme` Return: the theme picker opens. Escape.
  * Type `omarchy menu summon power-menu` Return (alias): System menu. Escape.
  * Unhappy path: type `omarchy menu frobnicate` Return → `omarchy-menu: unknown verb 'frobnicate'. Try 'omarchy menu --help'.` Then `omarchy menu summon no.such.route` Return: record what opens (root, an empty submenu, or nothing) — no crash; `omarchy menu close` Return.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu takes focus when it opens; click the terminal before typing the next command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the root menu, System open then closed, Capture via summon, closed via close, the theme picker, the alias, the unknown-verb message, and the no.such.route result
  * If unsuccessful
  ** Screenshot of the terminal output and the bar (present or gone)
covers: manual/14:62; bin/omarchy-menu; omarchy-menu.jsonc aliases; shell/plugins/menu/Menu.qml

### omarchy-debug-print-and-upload-hidden   [VM-OK]
description: `omarchy debug` gathers a support log: `--print --no-sudo` streams it, the interactive form offers View/Save and must not offer Upload while ICMP is blocked, and a bad flag is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, Super+F, type `omarchy debug --print --no-sudo | head -20` Return. `Date:`, `Hostname:`, `Omarchy Package:`, a SYSTEM INFORMATION banner; DMESG says "(skipped - --no-sudo flag used)".
  * Type `omarchy debug --no-sudo` Return. After a few seconds a chooser shows exactly "View log" and "Save in current directory" — no "Upload log".
  * Choose "Save in current directory" (Down, Return). Type `ls omarchy-debug*.log` Return: the file is listed. Type `rm omarchy-debug*.log` Return.
  * Unhappy path: type `omarchy debug --bogus` Return → `Unknown option: --bogus` and `Usage: omarchy-debug [--no-sudo] [--print]`.
  * Press Super+F, Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The chooser is a gum list navigated with arrows and Return.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the header lines, the two-option chooser without Upload, the saved file listed, and the usage rejection
  * If unsuccessful
  ** Screenshot where the command hung or errored
covers: manual/14:25; bin/omarchy-debug

### about-and-learn-menu-entries   [VM-OK] [NET]
description: Omarchy Menu → About opens the fastfetch About window floating, and Learn → Omarchy / Hyprland open documentation web apps (pages need the network).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, type "about", Return. A floating window with the Omarchy ASCII logo and system facts (OS, kernel, uptime, packages, theme). Press q.
  * Press Super+Space, type "learn", Return. Rows Keybindings, Omarchy, Hyprland, Arch, Neovim, Bash, Tmux, Herdr, Community.
  * Type "omarchy", Return. A Chromium app window loads omarchy.org/manual.
  * Press Super+Space → Learn → Hyprland. A second app window loads wiki.hypr.land.
  * Press Ctrl+Alt+Delete. Empty desktop.
  * Unhappy path: open About twice in a row. One window keeps focus or a second opens; no crash. Press q until closed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The About window is sized to its content and centred.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the About window, the Learn submenu, the manual web app, and the Hyprland wiki
  * If unsuccessful
  ** Screenshot of the missing window
covers: omarchy-menu.jsonc:32,45-53; bin/omarchy-launch-about; bin/omarchy-launch-webapp

### setup-and-style-menus-open-config-editor   [VM-OK]
description: Setup → Monitors, Setup → Keybindings, Setup → Config → Hyprland and Style → Hyprland each open the named config file in the editor — settings are plain files, as chapter 03 promises — and quitting without saving leaves the desktop intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, type "monitors", Return. A floating Neovim window opens on `~/.config/hypr/monitors.lua` (path in the status line). Type `:q!` Return.
  * Press Super+Space, type "hyprland", choose the Style row. Neovim on `~/.config/hypr/looknfeel.lua`. `:q!` Return.
  * Press Super+Space → Setup → Config → Hyprland (arrows and Return). Neovim on `~/.config/hypr/hyprland.lua`. `:q!` Return.
  * Press Super+Space → Setup → Keybindings. Neovim on `~/.config/hypr/bindings.lua`.
  * Unhappy path: type `iBROKEN` then Escape, `:q!` Return (discarded). Press Super+Return, type `hyprctl reload; echo rc=$?` Return → rc=0; the desktop is intact. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Neovim's bottom line shows the file path; `:q!` discards changes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each editor window with the correct path visible, and rc=0 after the discarded edit
  * If unsuccessful
  ** Screenshot of the editor on the wrong file or an error toast
covers: manual/03:39-43; omarchy-menu.jsonc:111,126-127,187; bin/omarchy-launch-config-editor; bin/omarchy-launch-editor

### update-process-restart-shell   [VM-OK]
description: Update → Process → Shell restarts the Omarchy shell in place: the bar vanishes and returns, a live toast survives, and the menu and hotkeys work afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `omarchy-notification-send -u critical "Survivor" "still here after restart"` Return. A persistent toast appears.
  * Press Super+Space, type "shell", choose the row under Update → Process (header "Restart"), Return. The bar disappears briefly and returns; the "Survivor" toast is restored.
  ** Do NOT pick Update → Config → Shell ("Reset to default"); it rewrites shell.json.
  * Press Super+Space: the menu opens. Escape. Press Super+, : the toast is dismissed.
  * Unhappy path: type `omarchy restart shell; omarchy restart shell` Return. The bar comes back once; type `pgrep -c quickshell` Return → 1.
  * Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restart takes two or three seconds; screenshot repeatedly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the toast, the bar gone, the bar back with the toast, the menu afterwards, and the process count of 1
  * If unsuccessful
  ** Screenshot of the missing bar after ten seconds
covers: omarchy-menu.jsonc:368; bin/omarchy-restart-shell; docs/notifications.md (persistence); manual/05:3

### system-menu-reboot-and-resume   [VM-OK] [SLOW]
description: System → Reboot restarts the machine cleanly and it comes back through the disk passphrase and login to the same desktop; a wrong passphrase is asked again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `touch ~/before-reboot-marker` Return.
  * Press Super+Escape, type "reboot", Return. The session ends and the machine restarts (firmware/boot screen).
  ** Screenshot every 5 s through the boot; do not pick Suspend or Hibernate.
  * Unhappy path: at the disk-unlock prompt type `wrong` Return. It asks again.
  * Type prime Return; log in as prime / prime if a login screen shows. The desktop with the bar appears.
  * Press Super+Return, type `ls ~/before-reboot-marker && rm ~/before-reboot-marker` Return. The file is listed (clean shutdown preserved it). Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Escape is <M-ESC>. The unlock prompt is themed by the Plymouth design.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the System menu, the unlock prompt, the retry after the wrong passphrase, the desktop back, and the marker file listed
  ** `get-serial` showing the shutdown and the new boot
  * If unsuccessful
  ** The serial log of the failed boot and the last screenshot
covers: omarchy-menu.jsonc:41; bin/omarchy-system-reboot; manual/07:11

## Gaps

Behaviours in chapters 01–14 that could not be turned into a driver test, and why:

1. **XF86 media/brightness/power keys are not sendable** (`volumeup`, `audiomute`, `power`, `calculator`, `sleep` fail the driver's key filter). Untested by hotkey: `Alt+Volume Up/Down`, `Shift/Alt+Brightness Up/Down`, keyboard-backlight keys, `Alt+Play`/`Alt+Shift+Play`, `Shift+Mute`, `Shift+Play`, `XF86PowerOff` (System menu) and `XF86Calculator` (M07:85-93, 192-193). Their commands (`omarchy audio output volume raise`, `omarchy brightness display +5%`, `omarchy osd …`) are typeable in a terminal but on this VM the audio one fails for lack of a sink and the brightness one for lack of a backlight, so only their error paths would be seen; not proposed as tests.
2. **No audio hardware**: audio-panel contents (master slider, output picker, per-app mixer), right-click mute, scroll volume, microphone widget, recording "with desktop audio / microphone" — untestable beyond "the panel opens".
3. **No battery / AC / backlight / lid**: Power panel and power profiles, battery percentage toggle, a real `Super+Ctrl+Alt+B` readout, the Display-panel brightness slider, laptop display / mirror toggles, lid handlers.
4. **No Bluetooth adapter**: Bluetooth panel and radio toggle.
5. **No webcam**: webcam overlay, `Super+Alt+[`/`]`, the "+ webcam" recording row (its absence is checked).
6. **Single monitor**: `Super+Shift+Alt+Arrows`, `Ctrl+Alt+Tab` monitor cycling, per-monitor Display controls.
7. **Tailscale / Dropbox widgets and panels** (M05:63-71) need the service installed and an account.
8. **Agents widget** and `Super+Shift+Ctrl+A` need agent usage / installed agents (chapter 17).
9. **Preinstalled-app hotkeys** for Spotify, Signal, Obsidian, Omawrite, 1Password, LazyDocker, Tmux, Herdr, cliamp (M07:100-124) belong to chapters 15–24 and depend on what the 4.0.2 minted disk ships.
10. **Chromium extension hotkeys** `Alt+Shift+L` / `Alt+Shift+D` (M07:151-152) — chapter 23.
11. **Voxtype dictation** end to end (install ~150 MB + microphone) — only the absence path is covered.
12. **Suspend / Hibernate / Logout** from the System menu: suspend may not resume in QEMU, hibernate is hidden, logout adds little over the reboot test.
13. **Hyprsunset time profile and autostart** (M13:46-54) need two config edits and a wall-clock wait.
14. **Screen-recording post-processing** (first-frame trim, loudness normalisation) is invisible in a screenshot; only the file and its playback are checked.
15. **Install → Style → Background** and extra themes (network downloads) — chapter 43.
16. **Installer flows** of chapter 02 (Ctrl+C for another owner / no encryption, unattended) run only from the ISO; `mint` covers the plain install.
17. **`Super+Ctrl+Delete` / `Super+Ctrl+Alt+Delete`** (laptop display toggles) are bound but act on the VM's only output; deliberately not exercised to avoid blanking the display.

Manual ↔ code disagreements found (each is also a "record what happens" step in a test):

- **Weather hotkey** `Super+Ctrl+Alt+W` is documented as a notification (M07:211, M10:13 with a toast screenshot); the code toggles the weather *panel*. Right-click on the widget is the toast.
- **Clipboard history `Return`** is documented as "placed on the clipboard ready to paste" (M08:18); the code pastes immediately via Shift+Insert. `Shift+Return` (copy only), `Delete`, `Shift+Delete` (clear all) and `Alt+Return` (open) are undocumented.
- **Emoji picker** is documented as putting the emoji "on the clipboard" (M07:338); the code inserts it and deliberately leaves the clipboard as it was.
- **Battery notice without a battery** (`Super+Ctrl+Alt+B`) posts a toast with an empty headline — `omarchy-battery-status` prints nothing and exits 0 and `omarchy-notification-battery` forwards it unconditionally.
- **`Super+Shift+B`** is bound to the browser (applications.lua:6) but missing from the hotkey table.
- **Themes chapter previews 19 of 22 themes**; Last Horizon, Lupine and Solitude are not shown.
- **CLI help excerpt** (M14:27-42) shows a shortened group list; the code has 67 groups. Fine as an excerpt, will drift.
- **Toggle flag files**: M13:28 says "most" toggles are flag files under `toggles/`; Stay Awake lives in `indicators/stay-awake` and DND in `notifications.json`, so `omarchy-toggle-enabled` cannot query either.
- **Default terminal** at HEAD is foot while chapter 13 lists Alacritty first and chapter 07's Ghostty section implies Alacritty; no functional disagreement, but tests must not assume the terminal's window class.

