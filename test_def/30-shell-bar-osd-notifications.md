# 30 — Omarchy Shell: bar, OSD, notifications, reminders

Reviewed against `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18. Format per `00-FORMAT.md`.

## Scope

Read in full (line counts from `wc -l`):

| File | Lines | Notes |
|---|---|---|
| `shell/README.md` | 302 | plugin manifest, IPC contract, shell.json shape |
| `docs/omarchy-shell.md` | 395 | IPC table, shell.json rules, theme tokens, custom bar modules |
| `docs/notifications.md` | 199 | toast lifecycle, DND rules, sender contract, reminders |
| `shell/shell.qml` | 1733 | ShellRoot: config load, plugin/service loaders, `shell` IPC |
| `shell/plugins/bar/Bar.qml` | 2076 | bar engine: per-monitor PanelWindow, sections, drag/move, tooltips, popout coordinator, `omarchy.bar` IPC |
| `shell/plugins/bar/BarModel.js` | 231 | layout normalisation, tray pinning, panel-slot picking, drop targets |
| `shell/plugins/bar/README.md`, `manifest.json` | 180, 14 | module catalogue, gestures |
| `shell/plugins/bar/widgets/*.qml` + `*.manifest.json` | Workspaces 72, ActiveWindow 64, Indicators 471, KeyboardLayout 245 (+Model 125), Microphone 54, Spacer 13, SystemUpdate 65, Tray 850 (+TrayModel 48) | every widget, every click/scroll |
| `shell/plugins/bar/indicators/*.qml` | Dnd 22, Reminder 59, NightLight 20, StayAwake 20, ScreenRecording 43, Dictation 38 | |
| `shell/plugins/osd/Osd.qml`, `OsdModel.js`, `manifest.json` | 206, 62, 14 | |
| `shell/plugins/notifications/Service.qml`, `NotificationLogic.js`, `components/NotificationCard.qml`, `manifest.json` | 1063, 479, 228, 15 | |
| `shell/plugins/reminders/ReminderFlow.qml`, `ReminderFlowModel.js`, `manifest.json` | 173, 21, 15 | |
| `shell/services/BarWidgetRegistry.qml`, `PluginBarWidgetRegistryApi.qml` | 49, 24 | |
| `shell/Ui/BarWidget.qml`, `BarIndicator.qml`, `BarIconButton.qml`, `PopupCard.qml`, `PanelToolTip.qml`, `WidgetButton.qml`, `PanelKeyCatcher.qml` | 45, 51, 63, 176, 49, 119, 85 | `WidgetButton`/`PanelKeyCatcher` read because every bar click and every panel key goes through them |
| `shell/Ui/KeyboardPanel.qml` | first 140 of 418 | focus/mask contract only |
| `shell/plugins/panels/clock/BarWidget.qml`, `Model.js`, `manifest.json` | 184, 308, 20 | clock is the center anchor; Panel.qml (calendar) skimmed for interactions only |
| `shell/plugins/panels/weather/BarWidget.qml`, `manifest.json` | 83, 20 | Panel.qml skimmed for `label`/`refresh` only |
| `shell/plugins/menu/BarWidget.qml` | 24 | |
| `bin/omarchy-bar` | 403 | |
| `bin/omarchy-osd` | 40 | |
| `bin/omarchy-notification-send`, `-dismiss`, `-wait`, `-time`, `-battery`, `-weather` | 211, 11, 30, 5, 5, 5 | |
| `bin/omarchy-reminder` | 201 | |
| `bin/omarchy-weather-status`, `-icon`, `-location` | 24, 45, 46 | |
| `bin/omarchy-update-available` | 44 | |
| `config/omarchy/shell.json` | 67 | the default bar layout (the user-config knob) |
| `config/hypr/input.lua` | user keyboard-layout override sample |
| `default/hypr/bindings/utilities.lua`, `media.lua`, `tiling.lua`, `applications.lua`, `default/hypr/input.lua`, `default/hypr/helpers.lua` (`bind_toggle`) | hotkeys that reach the bar/OSD/notifications |
| `default/omarchy/omarchy-menu.jsonc` | reminder / toggle menu entries only |
| `bin/omarchy-shell`, `omarchy-toggle`, `omarchy-toggle-bar`, `omarchy-toggle-notification-silencing`, `omarchy-toggle-nightlight`, `omarchy-toggle-idle`, `omarchy-audio-output-volume`, `omarchy-audio-output-sink`, `omarchy-audio-input-mute`, `omarchy-brightness-display`, `omarchy-hw-display`, `omarchy-battery-status` | cross-checked for what the VM path does |

Skimmed for maintainer invariants: `test/shell.d/bar-test.sh` (487), `bar-icon-geometry-test.sh`, `bar-text-color-test.sh`, `bar-widget-contract-test.sh`, `clock-test.sh`, `tray-test.sh`, `tray-menu-test.sh`, `osd-test.sh`, `notification-send-test.sh`, `notifications-test.sh` (726), `reminders-test.sh`, `battery-status-test.sh`, `update-available-test.sh`, `weather-test.sh`, `indicator-contract-test.sh`, `qml-text-format-test.sh`. Also `shell/services/PluginRegistry.qml` `setEnabled` (lines 470-520) for the widget/bar on-off semantics.

Skipped: the interiors of `panels/audio|bluetooth|network|power|monitor|tailscale|dropbox/Panel.qml` and `agents/` (another reviewer's area) except for their root `visible:` binding and bar-icon click handlers, which decide what the VM bar shows. Skipped `shell/services/PluginRegistry.qml` (plugin install is another area).

## Inventory

**Shell host (`shell/shell.qml`)**
- Loads `config/omarchy/shell.json` defaults, then `~/.config/omarchy/shell.json` verbatim if it parses and has `version: 1`; **no deep-merge**, invalid/missing-version user file → defaults with a console warning (`shell.qml:73-89`).
- Both files are `FileView` watched — editing `~/.config/omarchy/shell.json` applies live (`shell.qml:121-143`).
- `shell` IPC target (`shell.qml:1574-1732`): `ping`, `applyTheme`, `rescanPlugins`, `reloadConfig`, `toggleBarTransparency`, `setPluginEnabled`, `enablePlugin`, `putBarWidget`, `moveBarWidget`, `setBarWidget`, `listPlugins`, `listShellConfig`, `debugBarGeometry`, `summon`, `hide`, `toggle`, `togglePanelAt <section> <index>`, `call`.
- Bar-widget panels (audio, network, monitor, clock, weather, power, bluetooth, agents) are summoned through the live bar (`isBarWidgetPanelPlugin`, `shell.qml:1127-1162`), not the panel loader. `summon` on a disabled plugin returns false with a warning.
- `omarchy-shell [-q] <target> <method> [args]` wraps `qs ipc`; `-q` swallows every failure; two-second timeout (`bin/omarchy-shell`).

**Bar engine (`shell/plugins/bar/Bar.qml`)**
- One `PanelWindow` per screen, layer `Top`, namespace `omarchy-bar`, 26 px horizontal / 28 px vertical (`Style.bar.size*`) (`Bar.qml:1234-1269`).
- Position `top|bottom|left|right` from `bar.position`; invalid → `top` (`BarModel.normalizePosition`).
- Hidden bar = flag file `~/.local/state/omarchy/toggles/bar-off`; bar parks one bar-size off screen and drops its exclusion zone rather than unmapping (`Bar.qml:1165-1194, 1242-1255`). IPC `omarchy.bar syncHidden` re-probes the flag. Hotkey **Super+Shift+Space** (`utilities.lua:16`, `omarchy-toggle-bar`). Menu: Toggle → Menu Bar.
- Transparency: `bar.transparent`; **double-left-click on empty center-section bar space** toggles (`CenterGestureArea.onDoubleClicked`, `Bar.qml:1707`); text colour re-sampled from wallpaper via `omarchy-bar-text-color` (`Bar.qml:1060-1101`). CLI `omarchy bar transparent true|false|toggle`; IPC `shell toggleBarTransparency`.
- Move bar to another edge: **press-and-hold (200 ms) or drag ≥4 px on empty center-section space**, an edge slab previews the candidate edge, release writes `bar.position` (`Bar.qml:1637-1717`, `nearestScreenEdge`).
- Reorder widgets: **left-drag any widget** ≥4 px; ghost image follows pointer; accent drop marker at nearest insertion edge; release writes layout (`ModuleSlot.modulePointer`, `Bar.qml:1902-1994`; `dropBarModule`).
- Tooltips: shared `PopupWindow` bubble, 400 ms delay, follows bar side (`Bar.qml:1286-1348`); every `WidgetButton` shows `tooltipText` on hover (`Ui/WidgetButton.qml:102`).
- Popout coordinator: one popup at a time (`requestPopout`/`releasePopout`); accent "open panel" underline dot under the widget whose panel is open (`openPanelIndicator`, `Bar.qml:1874-1900`).
- Center section: `centerAnchor` (default `omarchy.clock`) pinned to exact center, others flank it (`Bar.qml:1534-1635`). Hovering the center section reveals the inactive indicators (`setCenterSectionHovered`, held until pointer leaves the bar, 120 ms collapse timer).
- Tray is always pinned to the inner edge of its section regardless of configured order (`pinTrayToInner`).
- Panel hotkeys by position: `togglePanelAt right N` counts only visible widgets that have a panel, 1-based (`panelWidgetIdAt`, `Bar.qml:655-659`); bound to **Super+Ctrl+1..9** (`utilities.lua:107-113`). Tab / Shift+Tab inside an open panel walks to the neighbouring panel in the same section (`switchPanelFrom`, `PanelKeyCatcher.tabRequested`).
- Custom modules in `bar.layout.<section>`: `{ "id": "x", "type": "command", "exec": ..., "interval": 5, "tooltip": ..., "onClick"|"onRightClick"|"onMiddleClick": ... }` (plain text or Waybar JSON `{text,tooltip,class}`, `class: "active"` colours it), and `{ "id": "x", "type": "qml" }` → `~/.config/omarchy/bar/modules/x.qml` (`CustomCommandModule`, `Bar.qml:2014-2075`; `customModulePath`).
- `omarchy bar` CLI (`bin/omarchy-bar`): `use <id>`, `reset`, `defaults`, `position <edge>`, `transparent <true|false|toggle>`, `put <id> [section] [--section --index --before --after]`, `move <id> [...]`, `set <id> <key> <value> [--json]`. Validation errors: "position must be top, bottom, left, or right", "section must be left, center, or right", "index must be a non-negative integer", "use only one of --before or --after", "unknown command". `put`/`move`/`set` go over IPC and surface the shell's reply (`unknown` → "is not a known widget").
- `shell.json` knobs (`config/omarchy/shell.json`): `bar.position`, `bar.transparent`, `bar.centerAnchor`, `bar.layout.{left,center,right}[]` entries with inline settings; `idle.screensaver`/`idle.lock`; `plugins[]`; `disabledPlugins[]`.

**Default bar layout on the VM (`config/omarchy/shell.json`)**
| Section | Widget | Visible in QEMU guest? | Why |
|---|---|---|---|
| left | `omarchy.menu` | yes | always |
| left | `omarchy.workspaces` | yes | always (1–5 plus any occupied ≤10) |
| center | `omarchy.indicators` | only on hover / when an indicator is active | inactive indicators concealed (`BarIndicator.concealed`) |
| center | `omarchy.clock` (anchor) | yes | `"dddd HH:mm"` → e.g. `Friday 13:09` |
| center | `omarchy.keyboard-layout` | **no** | single `kb_layout` → `multipleLayouts` false (`KeyboardLayout.qml:231`) |
| center | `omarchy.weather` | yes after network fetch | `visible: label !== ""` needs wttr.in |
| center | `omarchy.system-update` | yes when `omarchy-update-available` exits 0 | minted 4.0.2 vs released 4.0.4 → likely visible after `checkupdates` (network) |
| right | `omarchy.tray` | **no** until an SNI app runs | `visible: pinned or drawer items` |
| right | `omarchy.agents` | **no** | `visible: providers.length > 0` (no agent CLIs installed) |
| right | `omarchy.bluetooth` | **no** | `visible: adapter !== null` |
| right | `omarchy.network` | yes, ethernet glyph `󰈀` | virtio-net is wired (`Model.connectionIcon`) |
| right | `omarchy.audio` | uncertain | icon `""` (hidden) when `Pipewire.defaultAudioSink` is null; pipewire-pulse's `auto_null` may register as a sink → speaker glyph |
| right | `omarchy.monitor` | yes `󰍹` | always; brightness section hidden (`brightnessAvailable` false) |
| right | `omarchy.power` | **no** | `visible: batteryPresent` |

Not in the default layout but available: `omarchy.active-window` (defaultSection left), `omarchy.microphone`, `omarchy.spacer` (allowMultiple, `size`), `omarchy.media`, `omarchy.tailscale`, `omarchy.dropbox`.

**Widget interactions**
- **Menu** (`menu/BarWidget.qml`): left → `omarchy-shell shell toggle omarchy.menu '{"menu":"root"}'`; right → `xdg-terminal-exec`.
- **Workspaces** (`widgets/Workspaces.qml`): buttons 1–5 always, plus occupied ids ≤10 ("0" label for 10); focused shows glyph `\uDB85\uDCFB`; unoccupied+unfocused at 0.5 opacity; left click → `hyprctl dispatch hl.dsp.focus({workspace=N})`.
- **Active window** (`widgets/ActiveWindow.qml`): elided title ≤ `maxWidth` (280); hidden when no title or vertical bar; left → activate; middle/right → close toplevel; tooltip = full title.
- **Clock** (`panels/clock/BarWidget.qml`): left → calendar panel toggle; right → cycle format ring (`Model.CLOCK_FORMATS`: `dddd HH:mm` → `dddd h:mm AP` → `dddd HH:mm:ss` → … → `yyyy-MM-dd HH:mm`) and persist `format` inline; middle → `omarchy-menu-timezone`; tooltip "Right-click to toggle format"; settings `format`, `formatAlt`, `verticalFormat`, `verticalFormatAlt`, `weekStartDay`, `birthYear`, `lifeExpectancy`; IPC `omarchy.clock refresh|cycleFormat|toggleWeekStart|open|close|toggle`; hotkey **Super+Ctrl+Alt+D**. Calendar panel: 6×7 grid, ISO week column, today highlighted, `‹`/`›` month step, hero click → today, weekday-header hover shows week-start toggle, year-progress bar, optional memento-mori life bar, Escape closes.
- **Indicators** (`widgets/Indicators.qml`, order `Dictation, ScreenRecording, Reminder, NightLight, Dnd, StayAwake`): active ones sit next to the clock at full opacity; inactive ones appear at 0.45 opacity while the center section or the widget is hovered; settings `items[]`, `alwaysShow`; IPC `omarchy.indicators refresh`.
  - `Dnd`: bell-slash glyph; click toggles `omarchy.notifications.doNotDisturb`; tooltip "Silence Notifications" / "Allow Notifications".
  - `Reminder`: glyph `󰢌`; polls `omarchy-reminder show --json`; active when count>0; tooltip "Set Reminder" / "1 reminder" / "N reminders"; click → `omarchy-reminder show` when active, else `omarchy-reminder -i`.
  - `NightLight`: `󰔎`; bound to `omarchy.nightlight` service; click toggles hyprsunset; tooltip "Night Light" / "Day Light".
  - `StayAwake`: `󰅶`; bound to `omarchy.idle` service `stayAwake`; tooltip "Stay Awake" / "Allow Idle Lock & Screensaver".
  - `ScreenRecording`: `󰻂`; active when `pgrep -f ^gpu-screen-recorder`; click → stop or open capture menu.
  - `Dictation`: reads `omarchy-voxtype-status`; inactive mic glyph `󰍬`; click → `omarchy-voxtype-config`.
- **Keyboard layout** (`widgets/KeyboardLayout.qml`): 2–3 letter brief (`EN`, `DE`); tooltip = full xkb description; click → `hyprctl switchxkblayout <every keyboard sharing the list> <next index>`; refreshes on `activelayout` / `configreloaded` events; hidden unless `kb_layout` has a comma.
- **Microphone** (`widgets/Microphone.qml`): hidden without a source; left → mute toggle; middle → audio panel; scroll → source volume ±5 %.
- **System update** (`widgets/SystemUpdate.qml`): `\uf021` refresh glyph, tooltip "Pending Omarchy Updates"; visible when `omarchy-update-available` exits 0 (checked on start and every 6 h); click → `omarchy-launch-floating-terminal-with-presentation omarchy-update`; IPC `omarchy.system-update refresh|clear`.
- **Tray** (`widgets/Tray.qml`): chevron `\uf053` + hover-revealed drawer (600 ms slide); pinned items always visible; left click → `activate()` (or menu if `onlyMenu`); middle → `secondaryActivate()`; right → in-shell menu popup with submenu drill-down (`‹ title` back row) and check marks; wheel → `scroll()`; **right-click the chevron** → "Tray icons" manage popup with Pin/Unpin and Hide/Show per item, "No tray items reporting." when empty; settings `pinned[]`, `hidden[]` persisted inline; LocalSend (always) and Dropbox (when `omarchy.dropbox` widget is on the bar) are suppressed (`TrayModel.ownedByOmarchy`). `Status.Passive` items hidden.
- **Weather** (`panels/weather/BarWidget.qml`): condition glyph; left → forecast panel; right → `omarchy-notification-send "$(omarchy-weather-status)"`; middle → refresh; hotkey **Super+Ctrl+Alt+W** (`omarchy-notification-weather` toggles the panel); location via `omarchy-weather-location [--set <name> [lat,lon] | --clear]` in `~/.local/state/omarchy/settings/weather.json`.
- **Network / Audio / Monitor / Power / Bluetooth / Agents** (bar-icon level only): left → panel; audio right → mute all, scroll → volume; power right → toggle percentage; bluetooth right → toggle radio; agents right → launch agent, middle → next subscription. Hotkeys **Super+Ctrl+W / A / D / P / B**, **Super+Shift+Ctrl+A**.
- **Spacer**: blank `size` px (default 12), hidden at 0.

**OSD (`shell/plugins/osd/Osd.qml`, `bin/omarchy-osd`)**
- Panel plugin, `keepLoaded`, layer `Overlay`, namespace `omarchy-osd`, **empty input mask (click-through), no keyboard focus**; card centred horizontally, 67 px above the bottom edge.
- IPC `osd show <json>` / `close` / `state` (`open|closed`) / `ping`. CLI `omarchy-osd [-i icon] [-m text] [-p 0-100] [-d ms]` (also `omarchy osd …`); unknown flag → "Unknown OSD option: X", exit 1.
- Progress form when `-p` given and no `-m`: glyph + 142 px bar + right-aligned `NN%`; message form otherwise: glyph + text (elided at 190 px, 325 px for media). Duration default 1200 ms, `-d 0` = stay until `close`.
- Icon names (`OsdModel.iconFor`): `volume-muted|muted|mute`, `volume-low|medium|high|volume`, `microphone[-muted|-off]|mic`, `keyboard`, `brightness|display`, `touchpad`, `touch|touchscreen`, `reboot|restart`, `shutdown|power|poweroff`, `logout|sign-out|leave`, `media|player[-source|-play|-pause|-next|-previous]`; any other non-empty name is rendered literally; empty name picks a volume glyph by percent.
- Triggers (`media.lua`, bin/): `XF86AudioRaiseVolume/LowerVolume` → `omarchy-audio-output-volume raise|lower` (±5, `ALT+` ±1); `XF86AudioMute` → `mute-toggle` (250 ms debounce); `XF86AudioMicMute` → `omarchy-audio-input-mute` ("Microphone muted"/"Microphone on"); `XF86MonBrightnessUp/Down` → `omarchy-brightness-display ±5%` (`SHIFT+` 100 %/1 %, `ALT+` ±1 %); `XF86KbdBrightness*`; `XF86TouchpadToggle`; `omarchy-audio-output-switch`; `omarchy-system-{logout,reboot,shutdown}`; `omarchy-capture-screenrecording`; `omarchy-toggle-input-device`.
- **There is no Caps Lock OSD.** Caps Lock is the Compose key (`compose:caps`) and both Shifts together toggles caps (`shift:both_capslock_cancel`) (`default/hypr/input.lua:37`).

**Notifications (`shell/plugins/notifications/*`, `bin/omarchy-notification-*`)**
- The shell **is** the daemon (`NotificationServer` on `org.freedesktop.Notifications`); toasts stack top-right, one `PanelWindow` per screen, layer `Overlay`, click-through except the toast column (`Service.qml:952-1060`). Placement: below the bar when the bar is on top (`barSize + gapsOut`), otherwise `gapsOut` from the top edge; hugs the right edge unless the bar is on the right (`NotificationLogic.popupPlacement`).
- Lifetimes: low 5 s, normal 8 s, critical forever; `expire_timeout` stretches up to 30 s but never below the floor; hover pauses; a `replaces_id` content update restarts the countdown (`Service.qml:98-119, 1013-1039`).
- Card (`NotificationCard.qml`, 380 px): 40 px icon slot (image hint → app icon → glyph), summary bold "Liberation Sans" ≤2 lines, body StyledText ≤3 lines with `<img>` stripped and Chromium URL prefix removed; hover reveals `✕` top-right; **left click = default action, right click / ✕ = dismiss**; critical → urgent-coloured border accent, low → dim.
- Click resolution (`invokePopupDefault`): `omarchy-exec-argv` hint → `Util.execArgv` detached; else libnotify action `default` if sender alive; else `omarchy-hyprland-focus-app <app>`; then dismiss.
- Persistence: `~/.local/state/omarchy/notifications/<ts>-<id>.json` per live toast (restored with a fresh lifetime after `omarchy-restart-shell`; expired ones archived), `notifications/history/` newest 10, `notifications/images/` copies, `~/.local/state/omarchy/notifications.json` `{version:3, dnd}`.
- IPC target `notifications`: `dndState`, `toggleDnd`, `setDnd <true|1|on|yes|…>`, `isDnd`, `showHistory` ("No recent notifications" placeholder toast when empty; clears live toasts and replays them plus history newest-first), `clear` (forget history, toasts stay), `dismissAll`, `dismissOne` (`none` when empty), `invokeLast`, `dismiss <summary-substring>`, `ping`.
- Hotkeys (`utilities.lua:24-28`): **Super+comma** dismissOne, **Super+Shift+comma** dismissAll, **Super+Ctrl+comma** toggle silencing (`omarchy-toggle-notification-silencing`, no toast, only the Dnd indicator changes), **Super+Alt+comma** invokeLast, **Super+Shift+Alt+comma** showHistory. **Super+Ctrl+Alt+T** time toast, **Super+Ctrl+Alt+B** battery toast, **Super+Ctrl+Alt+W** weather panel.
- DND rules: hidden unless `app_name == omarchy-action` (default of `omarchy-notification-send`) or (`urgency == critical` and `app_name == notify-send`). Silenced non-ephemeral ones (any app name other than `notify-send`/`omarchy-action`, no `transient` hint) go straight to history; ephemeral ones are dropped.
- `omarchy-notification-send [--app-name] [-g glyph] [-u low|normal|critical] [-i icon] [-t ms] [-r id] [-p] [--image path] <headline> [description] [--exec prog args…]`: defaults low urgency, app `omarchy-action`; unknown flag → "Unknown option: X" + usage, exit 1; `-u bogus` → "Unknown urgency"; `-t abc` → "Invalid -t value"; `--exec` with a single quoted spaced string → "--exec takes the command as separate words, not one quoted string."; `--exec` with nothing → "--exec needs a command"; `-p` prints the id, `-r` replaces in place. Never uses `notify-send`.
- Helpers: `omarchy-notification-dismiss <summary>`, `omarchy-notification-wait [s]`, `omarchy-notification-time` (`date` string with week number), `omarchy-notification-battery` (`omarchy-battery-status` — **empty string on a machine without a battery**), `omarchy-notification-weather` (panel toggle, not a toast).

**Reminders (`shell/plugins/reminders/*`, `bin/omarchy-reminder`)**
- `omarchy-reminder -i` / **Super+Ctrl+R** (`omarchy-menu toggle reminder-set` → alias of `trigger.reminder.set` → runs `omarchy-reminder -i`) → overlay `omarchy.reminders` (menu colours, exclusive keyboard focus, scrim): step 1 "Remind in minutes...", step 2 "Reminder message...". Enter submits; Escape clears text then dismisses; click on the scrim dismisses; empty minutes + Enter dismisses; invalid minutes (non-integer, 0, negative, fractional) → toast "Invalid reminder / Enter the number of minutes" and the overlay stays (`ReminderFlow.qml:65-93`, `ReminderFlowModel.validMinutes`).
- `omarchy-reminder <minutes> [message]` → transient `systemd-run --user --on-active=<m>m --unit omarchy-reminder-<m>m-<epoch>`; message file in `$XDG_RUNTIME_DIR/omarchy-reminders/`; confirmation toast "Reminder set for N minutes" / "You'll be reminded at HH:MM" (or "<message> in N minutes"); on fire: toast "Reminder" / message (default "Your N minutes are up") and indicator refresh. Bad/zero/missing minutes → usage, exit 1.
- `omarchy-reminder show` / **Super+Ctrl+Alt+R** → toast "Upcoming reminders" listing "<label> in Xm Ys (HH:MM)" or "No outstanding reminders". `show --json` feeds the bar indicator. `show <anything else>` → usage, exit 1.
- `omarchy-reminder clear` / **Super+Shift+Ctrl+R** → stops timers, toast "All reminders have been cleared".
- Menu path: Omarchy Menu → Trigger → Reminder → Set one / Show all / Clear all (`omarchy-menu.jsonc:57,83-85`).

**Ui primitives**
- `Ui/WidgetButton.qml`: every bar button; `pressed(button)` for left/middle/right; `wheelMoved`; hover tooltip via `bar.showTooltip`; pointing-hand cursor when pressable.
- `Ui/BarIconButton.qml`: icon-slot variant with optical centring; `OMARCHY_DEBUG_BAR_ICONS=1` draws debug boxes.
- `Ui/BarIndicator.qml`: active/inactive text+tooltip pairs, concealed unless active or revealed.
- `Ui/PopupCard.qml`: xdg-popup anchored to a bar item, `HyprlandFocusGrab` closes on outside click, 140 ms fade; used by tray menu/manage popups.
- `Ui/PanelToolTip.qml`: 400 ms delay in-panel tooltips (e.g. "Forget network").
- `Ui/PanelKeyCatcher.qml`: inside every keyboard panel — Escape closes, Tab/Shift+Tab switch panel, j/k/h/l or arrows move, Enter/Space activate, x deletes.

## Observations

1. **Hardware-less widgets hide themselves rather than showing an empty state.** On the guest the right section collapses to network (ethernet), possibly audio, and monitor; bluetooth, power, agents, tray and keyboard-layout are absent. Because `togglePanelAt right N` counts only visible panels, **Super+Ctrl+1 = network, 2 = audio (if visible), 3 = monitor** on the VM, not the layout indices. This is the quirk every panel-hotkey test must name.
2. **Hotkeys for hidden widgets still resolve.** `Bar.findPanelWidget` does not check visibility, so Super+Ctrl+P (power) and Super+Ctrl+B (bluetooth) call `open()` on a zero-size hidden widget. What appears (a panel anchored to nothing, or nothing at all) is unverified; the driver must report it either way.
3. **Keys the driver can and cannot send.** `send-keys` covers `<PRINT>`, `<CAPSLOCK>`, `<INSERT>`, `<MENU>`, `<PAUSE>`, any qcode with an underscore (`<alt_r>`, `<kp_enter>`) and modifier combos (`<A-PRINT>`, `<M-PRINT>`). What it cannot send are the **XF86 media/brightness/power keysyms**. The way to exercise those bindings is to type `wtype -k XF86AudioRaiseVolume` (etc.) in a terminal inside the guest — wtype ships in the base package set and the compositor sees the key exactly as the Hyprland binding expects. Running the bound script directly (`omarchy-audio-output-volume raise`) is the fallback when wtype is unavailable.
4. **No audio device ≠ no OSD.** `omarchy-audio-output-volume` resolves `pactl get-default-sink`; pipewire-pulse normally provides the dummy `auto_null` sink, so the volume key likely still shows a working OSD bar moving the dummy volume. If no sink resolves, the script prints "Could not resolve an audio sink to control." and shows nothing. `omarchy-brightness-display` exits 1 silently when `/sys/class/backlight` is empty: no OSD, no message. `omarchy-audio-input-mute` shows **"Microphone on"** even with no microphone (the `grep MUTED` fails, so the "on" branch runs).
5. **No Caps Lock OSD exists**; Caps Lock is the Compose key (`compose:caps`) and both Shifts together toggle caps (`shift:both_capslock_cancel`). Since `<CAPSLOCK>` is sendable, the negative is testable: pressing it shows no OSD and the next two keys compose (`'` then `e` gives `é`).
6. **`omarchy-notification-battery` on a battery-less machine sends an empty headline** (`omarchy-battery-status` exits 0 with no output), so Super+Ctrl+Alt+B produces a compact toast containing only the battery glyph. Arguably a bug worth reporting.
7. **DND toggle gives no toast**; the only feedback is the Dnd indicator, which is concealed unless active or the center section is hovered. After Super+Ctrl+comma the bell-slash appears solid next to the clock (on) and disappears (off).
8. **Toast lifetimes have floors.** `omarchy-notification-send` defaults to *low* (5 s), `notify-send` to normal (8 s); `-t` only stretches (to 30 s), never shortens. Screenshot cadence (≤5 s apart) catches a low toast once; use `-u critical` whenever the driver must interact with a toast.
9. **Nerd-Font glyphs cannot be typed by the driver**; use `-g` with an ASCII character, `-i <themed-icon>` (yaru theme, e.g. `dialog-information`), or `--image "$OMARCHY_PATH/applications/icons/Docker.png"`.
10. **`<`/`>` must be sent as `<LT>`/`<GT>`**, which matters for shell redirections and the body-markup test.
11. **The first `omarchy bar …` command creates `~/.config/omarchy/shell.json`**, canonical from then on with no deep-merge; a corrupt or `version`-less file makes the shell fall back to the shipped defaults; a minimal valid file with no `layout` gives an empty bar. `rm ~/.config/omarchy/shell.json` returns to the shipped defaults instantly (file watch) — every bar-changing test ends with it so the disk is left as found.
12. **Default clock shows no date** (`dddd HH:mm`, e.g. `Friday 13:09`); the first right-click switches to `dddd h:mm AP`. Cycling writes to shell.json, so it survives restarts.
13. **The update indicator depends on network and on the minted disk being behind.** With 4.0.2 minted and 4.0.4 released, `checkupdates` should report `omarchy` within seconds of shell start. Clicking starts `omarchy-update` in a floating terminal, which first asks for confirmation; the driver must decline (or Super+W the window) to stay inside the time budget.
14. **Tray candidates on a stock disk:** `obs-studio` is installed and shows an SNI icon with a menu (runs on llvmpipe, slow to start; first launch shows the auto-configuration wizard). `localsend` is installed but deliberately hidden from the tray. `udiskie` runs with `--no-tray`.
15. **Keyboard-layout widget can be made visible from the guest**: append `hl.config({ input = { kb_layout = "us,de", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })` to `~/.config/hypr/input.lua` and run `hyprctl reload` in the guest terminal. Remove the line and reload to restore.
16. **Nightlight on virtio-vga**: hyprsunset applies a shader; without 3D acceleration the tint may not render or hyprsunset may fail. The indicator state is the proof, the screen tint a bonus.
17. **Reminders state is systemd**; the bar indicator and the `Upcoming reminders` toast are the user-visible truth. `systemctl --user list-timers 'omarchy-reminder-*'` typed in the guest terminal is only needed when the screen and the toast disagree. Timers survive a shell restart but not a reboot.
18. **HEAD vs 4.0.2**: `omarchy bar put`, `togglePanelAt`/Super+Ctrl+1..9, `omarchy osd`, `notifications dismiss <summary>`, tray in-shell submenus and the reminders `-i` overlay are HEAD features; on the 4.0.2 disk "command not found" / "Function not found." must be reported as a version gap, not a UI failure.
19. **`omarchy-notification-send` is the only sanctioned sender**, but `notify-send` (libnotify, pulled in by gnome-disk-utility) is present and is the right tool for third-party behaviours: the DND bypass rule, the libnotify `default` action, and non-ephemeral history entries via `-a <AppName>`.
20. **Everything below is UI or guest-terminal only.** No step needs a host command; long outputs are not needed — every proof is a screenshot, with a guest-terminal command kept only where the screen cannot show the fact (why an indicator is absent, which sink exists).
21. **Maintainer invariants** (from `test/shell.d`): tray suppresses LocalSend always and Dropbox only when `omarchy.dropbox` is on the bar; OSD `iconFor('', 0)` is the muted glyph; reminders reject `0`, `-5`, `1.5`, `soon`; critical toasts never expire on restore; `parseExecArgv` rejects non-array/empty/leading-dash; `omarchy-notification-send` must never call `notify-send`; a forged `--hint=` headline is inert text; clock week start toggles Monday↔Sunday and exotic starts land on Monday; every `Text` with a non-literal binding sets `textFormat`.

## Proposed tests

### bar-default-widgets-on-vm   [VM-PARTIAL]
description: The top bar renders the shipped layout, hides every widget whose hardware is absent instead of showing broken icons, and reveals its indicators and tooltips on hover.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop and look at the bar along the top edge.
  * Confirm the LEFT section shows the Omarchy logo glyph, then workspace numbers 1 2 3 4 5 (the focused one a filled marker, the others dimmed).
  * Confirm the CENTER shows the clock as weekday plus 24-hour time, e.g. `Friday 13:09`, with no date.
  ** A refresh-arrows glyph (pending update) and a weather glyph may appear right of the clock within ~30 s; note which are present.
  * Confirm the RIGHT section shows a wired-network plug glyph and a monitor glyph; note whether a speaker glyph sits between them.
  ** There must be NO battery, bluetooth, `EN` keyboard-layout, tray chevron or agent glyph: this machine has none of that hardware, so hiding is the expected behaviour.
  * Hover the clock for one second: a bubble reads `Right-click to toggle format`. Move the mouse to the desktop: the bubble disappears.
  * Hover the empty bar space just left of the clock for two seconds: a row of six dimmed glyphs (microphone, camera, bell, sun, bell-slash, coffee cup) appears left of the clock; move the mouse onto the desktop and it collapses.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar is 26 px tall (y≈0.01); the clock sits at x≈0.5; ./client-with-image helps aim the hover.
  * A glyph rendered as a box, question mark or pink square is the failure; a widget missing for absent hardware is a pass.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar with menu glyph, 1–5, clock `<Weekday> HH:MM`, ethernet glyph, monitor glyph, and no battery/bluetooth/EN/tray/agent glyph
  ** Screenshot of the clock tooltip, and one with the six dimmed indicators revealed
  ** A note whether the speaker, weather and update glyphs were present
  * If unsuccessful
  ** Screenshot of the broken or unexpectedly present widget, and `./client get-serial`
covers: config/omarchy/shell.json, Bar.qml (tooltipWindow, setCenterSectionHovered), widgets/Indicators.qml, panels/*/Panel.qml root `visible:` bindings, widgets/KeyboardLayout.qml multipleLayouts

### bar-toggle-hide-and-show   [VM-OK]
description: Super+Shift+Space (and Omarchy Menu → Toggle → Menu Bar) hides the bar without killing the shell and brings it back, with windows reclaiming the space.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; its top edge sits just below the bar.
  * Press Super+Shift+Space: the bar is gone and the terminal reaches the very top of the screen.
  ** The hidden bar is parked just off the top edge; a one-pixel sliver may remain.
  * Press Super+Shift+Space again: the bar is back and the terminal has shrunk below it.
  * Press Super+Space, type `Menu Bar`, press Enter: the bar hides again from the menu.
  * Repeat the menu step: the bar returns.
  * Close the terminal with Super+W; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `Menu Bar` does not match in the menu search, navigate Toggle → Menu Bar with the arrow keys.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: bar visible with the terminal below it; bar hidden with the terminal at the top edge; bar back; the same pair via the menu
  * If unsuccessful
  ** Screenshot of the stuck state and `./client get-serial`
covers: Bar.qml barHidden/barHiddenProbe/omarchy.bar syncHidden, bin/omarchy-toggle-bar, utilities.lua Super+Shift+Space, omarchy-menu.jsonc trigger.toggle.top-bar

### bar-position-cli-and-rejects-invalid   [VM-OK]
description: `omarchy bar position` moves the bar to any screen edge live, refuses a bad edge with a clear message, and the bar returns to its shipped place when the user file is removed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy bar position bottom`: it prints `Bar position set to bottom` and the bar is now along the bottom edge, the terminal re-tiled to the top.
  ** This first command creates `~/.config/omarchy/shell.json`, which is canonical from now on.
  * Run `omarchy bar position left`: the bar is a narrow vertical strip on the left with the clock stacked `HH` `—` `mm` and the workspaces at the top.
  * Run `omarchy bar position sideways`: the command fails with `position must be top, bottom, left, or right` and the bar has not moved.
  * Run `omarchy bar position top`: the bar is back on top.
  * Run `rm ~/.config/omarchy/shell.json`: the bar is unchanged (shipped defaults are top) and the disk is as found.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The tiled terminal moves each time the bar moves; that is expected.
  * On the 4.0.2 disk `omarchy bar` may be missing; report `command not found` as a version gap.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar at bottom, at left (vertical clock), back on top; the terminal line `position must be top, bottom, left, or right`
  * If unsuccessful
  ** Screenshot of the bar in the wrong place with the terminal output; `./client get-serial`
covers: bin/omarchy-bar cmd_position, Bar.qml applyBarConfig/normalizePosition/verticalBar, panels/clock/BarWidget.qml verticalFormat

### bar-transparency-double-click   [VM-OK]
description: Double-clicking empty bar space in the center section makes the bar transparent with readable text, and the CLI toggle turns it solid again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar: a solid background strip.
  * Double-click the left mouse button on empty bar space at x≈0.25, y≈0.01, clear of any widget.
  ** Within two seconds the bar background turns transparent (wallpaper visible behind the widgets) while the text stays readable.
  * Open a terminal with Super+Enter and run `omarchy bar transparent toggle`: prints `Bar transparency toggled`; the bar is solid again.
  * Run `omarchy bar transparent maybe`: prints `transparent must be true, false, or toggle`.
  * Run `rm ~/.config/omarchy/shell.json` and close the terminal with Super+W; the bar is solid and as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `./client mouse double-click`; the space between the workspaces and the clock is safe bar background.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot pair: solid bar, then transparent bar with wallpaper visible behind the clock; the terminal rejection line
  * If unsuccessful
  ** Screenshot after the double-click showing no change
covers: Bar.qml CenterGestureArea.onDoubleClicked, toggleTransparency, refreshTransparentForeground, bin/omarchy-bar cmd_transparent, test/shell.d/bar-text-color-test.sh

### bar-drag-moves-to-screen-edge   [VM-OK]
description: Holding empty center bar space and dragging toward another edge previews the target edge and relocates the bar on release; the same gesture brings it back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Move the mouse to empty bar space at x≈0.25, y≈0.01 and press and hold the left button for one second.
  ** The cursor becomes a closed hand and a translucent slab outlines the current (top) edge.
  * Still holding, drag to x≈0.5, y≈0.95: the slab now outlines the BOTTOM edge.
  * Release: the bar is along the bottom edge.
  * From the bottom bar (y≈0.99) hold, drag up to y≈0.05 and release: the bar is back on top.
  * Open a terminal, run `rm ~/.config/omarchy/shell.json`, close it with Super+W; the bar is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `./client mouse hold`, then `mouse drag`, then `mouse release`; the move starts after 200 ms or 4 px, so keep the press on bar background.
  * Releasing on the same edge changes nothing; retry with a larger drag.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the bottom-edge slab preview while dragging; the bar on the bottom edge; the bar back on top
  * If unsuccessful
  ** Screenshot of a stuck preview slab or unmoved bar
covers: Bar.qml CenterGestureArea, beginBarMove/updateBarMove/finishBarMove, BarMoveGhostPanel, nearestScreenEdge, test/shell.d/bar-test.sh

### bar-widget-drag-reorder   [VM-OK]
description: Dragging a widget along the bar shows a ghost and an accent drop marker, the new order persists, and `omarchy bar defaults` restores the shipped layout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right section and note the order: ethernet glyph, (speaker), monitor glyph.
  * Hold the left button on the monitor glyph (x≈0.985, y≈0.01), drag left past the ethernet glyph to x≈0.93 and screenshot while holding: a faded copy of the icon follows the pointer and a thin accent-coloured vertical marker shows the landing spot.
  * Release: the monitor glyph is now LEFT of the ethernet glyph.
  * Press Super+Enter, then Super+W to open and close a terminal: the new order is still there (it was persisted).
  * Open a terminal and run `omarchy bar defaults`: prints `Restored the default Omarchy bar` and the original order is back.
  * Run `rm ~/.config/omarchy/shell.json`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A press that moves less than 4 px is a click and opens the monitor panel; press Escape and retry with a longer drag.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot mid-drag with ghost and accent marker; screenshot with the swapped order; screenshot after `omarchy bar defaults` with the original order
  * If unsuccessful
  ** Screenshot of a misplaced or duplicated widget
covers: Bar.qml ModuleSlot.modulePointer, captureBarDragGhost, DragGhostPanel, moduleDropAtScene, dropBarModuleAtTarget; bin/omarchy-bar cmd_defaults; BarModel.nearestDropTarget

### bar-add-and-remove-widgets   [VM-OK]
description: A user adds an optional widget with `omarchy bar put`, uses it, removes it with `omarchy plugin disable`, and an unknown widget id is refused; disabling and re-enabling a shipped widget takes it off and back onto the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy bar put omarchy.active-window`: prints `omarchy.active-window is on the bar` and the terminal's window title appears in the LEFT section after the workspace numbers.
  ** The title is elided at 280 px; a long prompt title ending in `…` is expected.
  * Run `omarchy bar put omarchy.no-such-widget`: fails with a message containing `is not a known widget`.
  * Open a second terminal with Super+Enter: the bar title changes to the new window; hover the title for a second: a tooltip shows the full title.
  * Middle-click the title in the bar: the focused terminal closes.
  * Run `omarchy plugin disable omarchy.active-window`: the title widget disappears from the bar.
  * Run `omarchy plugin disable omarchy.workspaces`: the numbers 1–5 vanish from the left section; run `omarchy plugin enable omarchy.workspaces`: they return (note in which section they landed).
  * Run `rm ~/.config/omarchy/shell.json`: the shipped bar is back; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On the 4.0.2 disk `omarchy bar put` / `omarchy plugin` may be absent; report `command not found` as a version gap.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the window title in the left section and its tooltip; the `is not a known widget` line; screenshot with one terminal closed after the middle-click; screenshots with the widget gone, the workspaces gone and back, and the shipped bar restored
  * If unsuccessful
  ** Terminal output of the failing command and a screenshot of the bar
covers: bin/omarchy-bar cmd_put, shell.qml putBarWidget/setPluginEnabled/listPlugins, widgets/ActiveWindow.qml, ActiveWindow.manifest.json defaultSection, bin/omarchy-plugin-enable/-disable, PluginRegistry.setEnabled

### bar-panels-keyboard-open-switch-close   [VM-PARTIAL]
description: Panels open from the bar by numbered hotkey and by name, Tab walks between neighbouring panels, Escape closes, and clicking another icon swaps panels instead of stacking them; only the three panels this machine shows can be counted.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right section and count the icons (ethernet, maybe speaker, monitor).
  ** Hidden hardware widgets are not counted, so on this machine Super+Ctrl+1 is network, 2 is audio if a speaker glyph exists (otherwise monitor), 3 is monitor (otherwise nothing).
  * Press Super+Ctrl+1: the network panel opens under the ethernet glyph with an accent underline dot under that glyph. Press Escape: it closes.
  * Press Super+Ctrl+2, screenshot, Escape; press Super+Ctrl+3, screenshot, Escape; press Super+Ctrl+9: nothing opens.
  * Press Super+Ctrl+W: the network panel opens. Press Tab: it closes and the next panel in the section opens under its own glyph, the dot moving with it. Press Shift+Tab: back to network. Press Escape.
  * Click the monitor glyph, then click the ethernet glyph without closing first: only the network panel is open (the monitor panel was replaced, not stacked). Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The digit combos are `<M-C-1>` etc.; Tab is `<TAB>`, Shift+Tab `<S-TAB>`.
  * A panel is open when a card hangs under the bar and a small accent dot underlines the owning icon.
  * On the 4.0.2 disk the numbered hotkeys may do nothing; report as a version gap and continue with the named hotkey.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the panel opened by 1, 2 and 3 with the accent dot under the matching icon; nothing after 9; the panel and dot moving with Tab and returning with Shift+Tab; none after Escape; the click-swap with a single panel
  * If unsuccessful
  ** Screenshot of a panel under the wrong icon, two panels open, or a panel ignoring Escape; `./client get-serial`
covers: shell.qml togglePanelAt, Bar.qml panelWidgetIdAt/panelNavigationSlots/switchPanelFrom/requestPopout, BarModel.pickPanelSlot, Ui/PanelKeyCatcher.qml, utilities.lua Super+Ctrl+1..9 / Super+Ctrl+W

### bar-custom-command-module   [VM-OK]
description: A user-declared command module in shell.json runs its script on an interval, shows the output in the bar with a tooltip, and runs its click command; removing the file removes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy bar position top` (this creates the user shell.json without changing anything visible).
  * Type and run: `jq '.bar.layout.right += [{"id":"hello","type":"command","exec":"echo HELLO-VM","interval":5,"tooltip":"Custom module","onClick":"xdg-terminal-exec"}]' ~/.config/omarchy/shell.json > /tmp/s.json && mv /tmp/s.json ~/.config/omarchy/shell.json`
  ** Send `>` as `<GT>`; the file is watched, so no reload is needed.
  * Within three seconds the text `HELLO-VM` appears at the right end of the bar.
  * Hover it for a second: tooltip `Custom module`.
  * Left-click it: a new terminal opens. Close that terminal with Super+W.
  * Run `rm ~/.config/omarchy/shell.json`: `HELLO-VM` is gone and the bar is as found. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use ./client-with-image after typing the jq line to check it before pressing Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `HELLO-VM` in the bar; its tooltip; the terminal opened by the click; the bar restored
  * If unsuccessful
  ** Screenshot of the bar with no module and the terminal output of the jq command
covers: Bar.qml CustomCommandModule (exec/interval/tooltip/onClick), BarModel.customModuleType, docs/omarchy-shell.md "Custom bar modules", bar/README.md

### bar-invalid-shell-json-falls-back-to-defaults   [VM-OK]
description: A corrupt or version-less user shell.json must not take the bar down: the shell falls back to the shipped defaults, honours a minimal valid file verbatim, and recovers when the file is removed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy bar position bottom`: the bar is at the bottom.
  * Run `echo 'not json at all' > ~/.config/omarchy/shell.json` (send `>` as `<GT>`): within three seconds the bar is back on TOP with the shipped layout, fully drawn.
  * Run `echo '{"bar":{"position":"bottom"}}' > ~/.config/omarchy/shell.json`: the bar stays on top (a file without `version: 1` is ignored).
  * Run `echo '{"version":1,"bar":{"position":"bottom"}}' > ~/.config/omarchy/shell.json`: the bar moves to the bottom as an EMPTY strip.
  ** A minimal valid file is honoured verbatim; with no `layout` there are no widgets. There is no deep-merge with the defaults.
  * Run `rm ~/.config/omarchy/shell.json`: the shipped bar is back on top. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal stays open through every step; the bar moving re-tiles it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: bottom bar; top shipped bar after garbage; still top after the version-less file; empty bottom strip after the minimal file; shipped bar after removal
  * If unsuccessful
  ** Screenshot with no bar at all and `./client get-serial`
covers: shell.qml applyShellConfig/loadDefaults, userConfigFile FileView watch, Bar.qml fallbackBarConfig/normalizeLayout, shell/README.md Storage rules

### workspaces-indicator-follows-super-number   [VM-OK]
description: The workspace widget mirrors Hyprland: the focused workspace gets the filled marker, occupied ones are bright, empty ones dim, extra workspaces appear when used, and clicking a number switches to it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the workspace numbers: `1` is the filled marker, 2–5 are dim digits.
  * Press Super+2: the marker is in slot 2, `1` is a dim digit.
  * Press Super+Enter to open a terminal here, then press Super+1: slot 1 is marked and `2` is a BRIGHT digit (occupied) while 3–5 stay dim.
  * Left-click the `3` digit in the bar: slot 3 is marked and the desktop is empty.
  * Press Super+7: a seventh slot appears and is marked; there is no `6`.
  * Press Super+2, close the terminal with Super+W, press Super+1: back to 1–5 with 1 marked and the rest dim, as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The digits start near x≈0.03 and are about 20 px apart; Super+digit is `<M-2>` etc.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the marker in slots 1, 2, 1 (bright 2), 3 and 7; the final screenshot with 1–5 only
  * If unsuccessful
  ** Screenshot where the marked slot disagrees with the workspace on screen
covers: widgets/Workspaces.qml (workspaceIds, focused glyph, occupied opacity, focusWorkspace), tiling.lua Super+1..10

### menu-widget-left-and-right-click   [VM-OK]
description: The Omarchy logo in the bar opens the menu on left click and a terminal on right click, and keeps working after either.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the Omarchy glyph at the far left of the bar (x≈0.012, y≈0.01): the Omarchy menu opens.
  * Press Escape: the menu closes.
  * Right-click the same glyph: a terminal window opens.
  * Close the terminal with Super+W.
  * Left-click the glyph again and press Escape: the menu still opens and closes; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The glyph is the first item on the bar; the cursor becomes a pointing hand over it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the menu after the left click; the terminal after the right click; the menu again at the end
  * If unsuccessful
  ** Screenshot after a click that did nothing
covers: shell/plugins/menu/BarWidget.qml

### clock-calendar-popup   [VM-OK]
description: Left-clicking the clock (or Super+Ctrl+Alt+D) opens a calendar with a month grid, ISO week numbers and today highlighted; arrows step months, the heading returns to today, the weekday header toggles the week start and remembers it, and Escape closes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the clock text in the center of the bar: a card opens below it with the month name and year, a 7-column grid of day numbers, a narrow week-number column, weekday initials as a header (normally starting `M`), and today highlighted; an accent dot underlines the clock.
  * Click the `›` arrow near the month name: next month, today no longer highlighted. Click `‹` twice: last month.
  * Click the month/year heading: back to the current month with today highlighted.
  * Hover the weekday header row for a second, then click the week-start control that appears: the header now starts with `S` and the columns shift by one day.
  * Press Escape (card and dot gone), then press Super+Ctrl+Alt+D: the calendar opens again and still starts on Sunday.
  * Toggle the week start back to Monday the same way, press Escape.
  * Open a terminal, run `rm ~/.config/omarchy/shell.json`, close it with Super+W; the disk is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The grid is always six rows, so the card height never changes between months.
  * If the hover control is hard to hit, `omarchy-shell omarchy.clock toggleWeekStart` in a terminal does the same.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: calendar with today highlighted and week numbers; next month; previous month; back to today; header starting `S`; reopened via hotkey still `S`; header back to `M`
  * If unsuccessful
  ** Screenshot of the missing or wrong grid, with `date` typed in a terminal for comparison
covers: panels/clock/BarWidget.qml (togglePanel, IPC toggle), panels/clock/Panel.qml (moveMonth, goToToday, toggleWeekStart), panels/clock/Model.js (monthGrid, isoWeek, toggledWeekStart), utilities.lua Super+Ctrl+Alt+D, test/shell.d/clock-test.sh

### clock-label-format-and-timezone-clicks   [VM-OK]
description: Right-clicking the clock walks a fixed ring of label formats and remembers the choice, `omarchy bar set` changes the format live and refuses an unknown widget, and middle-click opens the timezone picker that cancels cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the clock: `<Weekday> HH:MM`.
  * Right-click the clock: `<Weekday> h:MM AM|PM`. Right-click again: `<Weekday> HH:MM:SS` with seconds ticking (two screenshots three seconds apart). Right-click twice more: `<Weekday> h:MM:SS AM|PM`, then `HH:MM`.
  ** The choice is written to shell.json, so it survives a shell restart.
  * Open a terminal with Super+Enter and run `omarchy bar set omarchy.clock format "yyyy-MM-dd HH:mm"`: prints `Set format on omarchy.clock` and the clock shows the ISO date and time within two seconds.
  * Run `omarchy bar set omarchy.nope format "HH:mm"`: the command fails and the clock is unchanged.
  * Middle-click the clock: a timezone picker (list of zones such as `Europe/…`) opens. Press Escape: it closes and the clock time did not change zone.
  * Run `rm ~/.config/omarchy/shell.json`: the clock returns to `<Weekday> HH:MM`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `./client mouse click --button right|middle` on the clock text at x≈0.5, y≈0.01.
  * Do not select a zone in the picker; if it is a terminal list, Escape or Ctrl+C cancels.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the five successive right-click formats (two with different seconds); the ISO format after `bar set`; the failure line for `omarchy.nope`; the timezone picker open and the unchanged clock after cancel; the clock back to `<Weekday> HH:MM`
  * If unsuccessful
  ** Screenshot of a label that did not change with the terminal output
covers: panels/clock/BarWidget.qml cycleFormat/onPressed, panels/clock/Model.js CLOCK_FORMATS/nextClockFormat/clockNeedsSeconds, bin/omarchy-bar cmd_set, shell.qml setBarWidget/updateEntryInline, BarModel.inlineSettingsDelta, bin/omarchy-menu-timezone

### indicators-reveal-and-toggle   [VM-PARTIAL]
description: The manual-state indicators appear dimmed on hover in a fixed order with their tooltips, and clicking stay-awake or night-light activates it next to the clock while the matching hotkey turns it off; the night-light tint itself may not render without GPU acceleration.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Hover the empty bar space just left of the clock (x≈0.42, y≈0.01) for two seconds: six dimmed glyphs appear in this order — microphone (dictation), camera (screen recording), bell (reminder), sun (night light), bell-slash (do not disturb), coffee cup (stay awake).
  * Hover each for a second: tooltips `Dictate`, `Screen Recording`, `Set Reminder`, `Night Light`, `Silence Notifications`, `Stay Awake`.
  * Click the coffee cup: it is drawn solid immediately left of the clock and stays when the mouse leaves the bar; its tooltip is now `Allow Idle Lock & Screensaver`.
  * Press Super+Ctrl+I: the solid cup dims and hides once the mouse is off the bar.
  * Click the sun: it becomes solid next to the clock; the screen may look warmer.
  ** On this VM hyprsunset may fail to tint; the solid indicator is the proof.
  * Press Super+Ctrl+N: the sun goes away.
  * Move the mouse to the desktop: no indicator remains; the bar is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Active indicators sit closest to the clock at full opacity; inactive ones show at 45 % only while hovered.
  * The dictation glyph may be absent if the voxtype status tool is not installed; report which glyphs appeared.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the dimmed row and each tooltip; the solid cup and its tooltip; the cup gone after Super+Ctrl+I; the solid sun; the sun gone after Super+Ctrl+N; the clean bar
  * If unsuccessful
  ** Screenshot of an indicator that disagrees with the action taken; `./client get-serial`
covers: widgets/Indicators.qml (revealInactiveIndicators, defaultIndicatorEntries), Ui/BarIndicator.qml, indicators/StayAwake.qml, indicators/NightLight.qml, bin/omarchy-toggle-idle, bin/omarchy-toggle-nightlight, utilities.lua Super+Ctrl+I / Super+Ctrl+N, test/shell.d/indicator-contract-test.sh

### keyboard-layout-widget-two-layouts   [VM-OK]
description: The keyboard-layout widget stays off the bar with a single layout and appears as a two-letter code once a second layout is configured; clicking it cycles the layout and the typed letters change; reverting hides it again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the center of the bar: no two-letter code such as `EN` near the clock.
  * Open a terminal with Super+Enter and run: `printf '\nhl.config({ input = { kb_layout = "us,de", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })\n' >> ~/.config/hypr/input.lua`
  ** Send `>>` as `<GT><GT>`.
  * Run `hyprctl reload`: within two seconds `EN` appears right of the clock; hover it: tooltip `English (US)`.
  * Left-click `EN`: it becomes `DE` with tooltip `German`. In the terminal type `zy`: the letters come out as `yz`.
  * Click `DE` to return to `EN`.
  * Run `sed -i '/kb_layout = "us,de"/d' ~/.config/hypr/input.lua` then `hyprctl reload`: the code disappears from the bar; the config is as found.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type the printf line in one go and check it with ./client-with-image before Enter.
  * The widget refreshes on Hyprland's config-reloaded event; allow a second.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot without the code; with `EN` and its tooltip; with `DE`; the terminal showing `yz`; the bar without the code after reverting
  * If unsuccessful
  ** Screenshot after `hyprctl reload` and the terminal output of `hyprctl -j devices | jq -c '.keyboards[] | {name, layout, active_keymap}'`
covers: widgets/KeyboardLayout.qml (multipleLayouts, cycleLayout, refresh), KeyboardLayoutModel.js shortLabel, config/hypr/input.lua, default/hypr/input.lua

### right-section-panels-without-hardware   [VM-PARTIAL]
description: On a machine with wired network only, no sound card, no backlight, no battery and no bluetooth, the network and display panels open and show the wired/scale-only state, the audio widget either hides or binds to a dummy sink, and the power/bluetooth hotkeys do nothing harmful.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the ethernet plug glyph in the right section: a panel opens with an `Ethernet` header, an interface name (`enp0s…`), an IP in `10.0.2.x`, and a DNS provider section; there is no Wi-Fi list or Wi-Fi toggle. Press Escape.
  ** ICMP is blocked in this VM, so a ping readout may show as unavailable.
  * Left-click the monitor glyph: a panel with a scale row (`1x 1.25x 1.6x 2x …`) and a text-size control, and NO brightness slider. Press Escape without clicking a preset.
  * Press Super+Ctrl+A: if a speaker glyph exists the audio panel opens under it (screenshot, then scroll down once over the glyph to lower the volume and right-click it to mute/unmute); if there is no speaker glyph, nothing opens. Press Escape.
  * Press Super+Ctrl+P, screenshot; press Super+Ctrl+B, screenshot: the power and bluetooth widgets are hidden here, so expected is nothing — describe precisely anything that does appear. Press Escape twice.
  * Open a terminal with Super+Enter, run `pactl list sinks short` and read the result (expected `auto_null` or nothing); close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A panel that opens for Super+Ctrl+P or B anchored to nothing is worth a careful screenshot; it is a known unverified corner.
  * Do not change the display scale; it re-lays out the whole desktop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Ethernet panel; the display panel without a brightness slider; the audio outcome (panel or nothing) with a sentence naming it; the screen after Super+Ctrl+P and after Super+Ctrl+B; the pactl line
  * If unsuccessful
  ** Screenshot of a Wi-Fi glyph, a brightness slider, a broken icon or a stray panel; `./client get-serial`
covers: panels/network/Panel.qml (ethernet kind, canToggleWifi), panels/network/Model.js connectionIcon, panels/monitor/Panel.qml brightnessAvailable, panels/audio/Panel.qml outputIcon/onWheelMoved/toggleAllMuted, panels/power/Panel.qml visible:batteryPresent, panels/bluetooth/Panel.qml visible:adapter, Bar.qml findPanelWidget, utilities.lua Super+Ctrl+W/D/A/P/B

### system-update-indicator   [VM-OK] [NET]
description: When a newer Omarchy package exists the bar shows the pending-update glyph with a tooltip, and clicking it opens the updater in a floating terminal that the user can decline; on an up-to-date disk the glyph is correctly absent. Needs network for the package-database check (a few hundred KB).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * About 20 seconds after reaching the desktop screenshot the center of the bar: a refresh-arrows glyph should sit right of the clock (this disk is 4.0.2 and a newer release exists).
  * Hover it for a second: tooltip `Pending Omarchy Updates`.
  * Left-click the glyph: a floating terminal opens running the updater and asks for confirmation.
  * Decline (press `n` then Enter, or Escape); if the window remains, close it with Super+W: the floating terminal is gone and the glyph is still there.
  ** Never confirm the update; it exceeds the session budget.
  * If the glyph never appeared: open a terminal with Super+Enter, run `omarchy-update-available`, read whether it prints `Omarchy is up to date` (the absence is then correct) or an `omarchy …` line (the glyph should have shown), and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The check runs at shell start and needs the network to be up; screenshot again after a few seconds if the glyph is late.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the glyph and its tooltip; the updater's confirmation prompt in a floating terminal; the desktop after declining with the glyph still present — or, for the absence path, the `Omarchy is up to date` line
  * If unsuccessful
  ** Terminal output of `omarchy-update-available` alongside a screenshot of the bar without the glyph
covers: widgets/SystemUpdate.qml (updateProc, runUpdate, tooltip), bin/omarchy-update-available, bin/omarchy-update (confirmation), test/shell.d/update-available-test.sh

### tray-icon-menu-and-manage   [VM-OK] [SLOW]
description: A running application with a status-notifier icon appears in the tray drawer where left click activates it and right click opens its menu, the chevron's manage popup can pin and hide it, quitting the app removes it, and LocalSend is deliberately never shown.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right section: no chevron `‹` glyph before the ethernet glyph.
  * Press Super+Space, type `OBS Studio`, Enter; screenshot every five seconds until OBS appears (slow without a GPU); click `Cancel` on the auto-configuration wizard if it shows.
  * Screenshot the bar: a chevron now starts the right section. Hover it for a second: a drawer slides open leftward revealing the OBS icon.
  * Right-click the OBS icon: a menu card with entries such as `Show`/`Hide`, `Start Recording`, `Exit`. Press Escape. Left-click the icon: the OBS window hides (or shows).
  * Hover the chevron, then right-click the chevron itself: a `Tray icons` popup lists OBS with `Pin` and `Hide` buttons and the text `Pinned icons stay visible. Hidden icons never show.`
  * Click `Pin`: the OBS icon is visible right of the chevron without hovering. Click `Unpin`, then `Hide`: the icon leaves the drawer. Click `Show`, then press Escape.
  * Right-click the OBS icon and choose `Exit` (confirm if asked): the chevron disappears from the bar.
  * Press Super+Space, type `LocalSend`, Enter; wait for its window: the bar still shows NO chevron (LocalSend is hidden on purpose). Close it with Super+W.
  * Open a terminal, run `rm ~/.config/omarchy/shell.json` (pin/hide state was written there), close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The drawer animation takes 0.6 s; screenshot after hovering for a second. Use ./client-with-image to aim at the 12 px icon.
  * If OBS refuses to start on this VM, report that and run the same steps with `qbittorrent` after `sudo pacman -S --noconfirm qbittorrent` (~20 MB, network).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: chevron appears; drawer open with the OBS icon; the right-click menu; the manage popup; the pinned icon visible without hover; the hidden state; the chevron gone after Exit; LocalSend running with no chevron
  * If unsuccessful
  ** Screenshot with OBS running but no chevron, or with a LocalSend icon in the drawer
covers: widgets/Tray.qml (drawer HoverHandler, TrayItem clicks, openTrayMenu, managePopup, togglePin/toggleHide), TrayModel.js ownedByOmarchy, Ui/PopupCard.qml, test/shell.d/tray-test.sh, tray-menu-test.sh

### weather-widget-panel-and-status-toast   [VM-OK] [NET]
description: The weather widget appears once the forecast service answers, its panel shows the forecast, right-click sends a status toast, and a location can be set and cleared from the CLI. Needs outbound HTTPS (a few KB).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Within 30 seconds of reaching the desktop screenshot the center of the bar: a weather glyph (sun/cloud/rain) sits right of the clock.
  * Left-click it: a panel with a location name, current temperature and a multi-day forecast row. Press Escape.
  * Press Super+Ctrl+Alt+W: the panel opens again; press it again: closed.
  * Right-click the weather glyph: within three seconds a toast top-right reads `<Place>  ·  Temp …  ·  Wind …`.
  * Open a terminal with Super+Enter and run `omarchy-weather-location --set Malibu 34.02577,-118.7804`, then middle-click the glyph (refresh) and left-click it: the panel names Malibu. Press Escape.
  * Run `omarchy-weather-location --set Nowhere 1,2,3`: prints `Invalid coordinates: 1,2,3 (expected lat,lon)`.
  * Run `omarchy-weather-location --clear`, middle-click the glyph; close the terminal with Super+W: the location is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the glyph never appears, run `omarchy-weather-status` in a terminal; `Weather unavailable` means the service is unreachable — report it as a network limitation.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the weather glyph; the panel; the status toast; the panel naming Malibu; the invalid-coordinates line
  * If unsuccessful
  ** Terminal output of `omarchy-weather-status` and a screenshot of the bar
covers: panels/weather/BarWidget.qml (togglePanel, right-click toast, middle refresh), bin/omarchy-weather-status, bin/omarchy-weather-location, bin/omarchy-notification-weather, utilities.lua Super+Ctrl+Alt+W, test/shell.d/weather-test.sh

### osd-shows-hides-and-is-click-through   [VM-OK]
description: The on-screen display renders a progress card and a message card at the bottom centre, hides after its duration, never blocks clicks to the window beneath it, and its command refuses an unknown flag.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter (it tiles to fill the screen).
  * Run `omarchy-osd -i volume-high -p 40 -d 6000`: within two seconds a rounded card near the bottom centre shows a speaker glyph, a bar filled 40 % in the accent colour, and `40%`. Wait seven seconds: the card is gone.
  * Run `omarchy-osd -i volume-muted -p 0 -d 6000`: a muted-speaker glyph with an empty bar and `0%`.
  * Run `omarchy-osd -m "Click through me" -d 15000`: a text-only card over the lower part of the terminal.
  * Left-click exactly on that card (x≈0.5, y≈0.93), then type `echo clicked` and Enter: the terminal prints `clicked` and the card is still visible (the click passed through and did not dismiss it).
  * Run `omarchy-osd --bogus 1`: prints `Unknown OSD option: --bogus`, no card.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The card sits 67 px above the bottom edge and never takes focus, so the terminal keeps focus throughout.
  * `omarchy osd` is the same command on newer builds; if `omarchy-osd` is missing on 4.0.2 report the version gap.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the 40 % card, the empty screen after expiry, the muted 0 % card, the message card with `clicked` printed beneath it while still visible; the terminal rejection line
  * If unsuccessful
  ** Screenshot with no card, or with the card dismissed by the click
covers: bin/omarchy-osd, shell/plugins/osd/Osd.qml (show/hideTimer, mask: Region {}, keyboardFocus None), OsdModel.js iconFor/stateForShow, test/shell.d/osd-test.sh

### osd-media-keys-without-hardware   [VM-PARTIAL]
description: On a machine with no sound card, backlight or microphone, the bound media keys must either drive the OSD through PipeWire's dummy sink or fail quietly, never show a broken card or error dialog; and Caps Lock shows no OSD because it is the Compose key. Only the absence paths run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `wtype -k XF86AudioRaiseVolume`: within two seconds EITHER a volume OSD card with a percentage appears bottom-centre, OR nothing appears. Record which.
  ** The key is injected inside the guest because the driver cannot send XF86 keysyms; `omarchy-audio-output-volume raise` is the fallback if wtype is missing, and prints `Could not resolve an audio sink to control.` when there is no sink at all.
  * If a card appeared: run `wtype -k XF86AudioLowerVolume` (percentage drops by 5) and `wtype -k XF86AudioMute` twice (muted glyph, then unmuted).
  * Run `wtype -k XF86MonBrightnessUp`: wait two seconds; NO card and no error text (there is no backlight).
  * Run `wtype -k XF86AudioMicMute`: a card reading `Microphone on` or `Microphone muted` appears; record the text.
  ** Reporting a state with no microphone present is the current behaviour; note it, do not fail on it.
  * Press Caps Lock (`<CAPSLOCK>`), wait two seconds: no card. Then type `'e`: the terminal shows `é` (Caps Lock is Compose).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal must have focus when wtype runs; it does right after Super+Enter.
  * Both outcomes of the volume key are passes for this machine; a card with a box glyph, a hung script or a card that never hides is the failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after the volume key (card or nothing) with a sentence naming the outcome; lower/mute screenshots if applicable; no card after the brightness key; the microphone card text; no card after Caps Lock and `é` in the terminal
  * If unsuccessful
  ** Screenshot of an error dialog, broken glyph or stuck card; `./client get-serial`
covers: media.lua XF86Audio*/XF86MonBrightness* bindings, bin/omarchy-audio-output-volume, bin/omarchy-audio-output-sink, bin/omarchy-brightness-display, bin/omarchy-hw-display, bin/omarchy-audio-input-mute, default/hypr/input.lua compose:caps, OsdModel.js

### notification-toast-lifetimes   [VM-OK]
description: A toast appears top-right under the bar and lives five seconds at low urgency, eight at normal, longer when the sender asks, forever when critical, and pauses while hovered; right-click dismisses.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send "Hello VM" "This is the body"`: within two seconds a card in the top-right corner just below the bar shows bold `Hello VM` and a lighter body. Wait six seconds: gone.
  ** `omarchy-notification-send` defaults to low urgency (5 s); screenshot within five seconds of sending.
  * Run `omarchy-notification-send -u critical "Critical stays"` then `omarchy-notification-send -u normal "Normal eight seconds"`: two stacked cards, the newest on top, the critical one with a differently coloured border accent.
  * Screenshot every five seconds for 35 seconds: `Normal eight seconds` is gone by the second screenshot; `Critical stays` is present in all of them.
  * Run `omarchy-notification-send -u normal -t 15000 "Fifteen seconds"`: present at ~5 and ~12 s, gone by ~20 s (the sender stretched the life beyond 8 s).
  * Run `omarchy-notification-send -u normal "Hover me"` and immediately move the mouse onto that card, screenshotting every four seconds for sixteen: it stays and a `✕` shows in its corner. Move the mouse away: gone within ten seconds.
  * Right-click `Critical stays`: dismissed. Close the terminal with Super+W; no cards remain.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts sit at roughly x 0.75–0.99, y 0.03–0.1; keep the mouse off them except in the hover step.
  * Use `./client mouse move` for the hover, not click.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Hello VM` under the bar and one with it gone; the stacked pair with the critical accent; the series with the normal card gone and the critical one lasting 35 s; the 15 s card present at ~12 s; the hovered card with `✕`; the clean screen after dismissal
  * If unsuccessful
  ** Screenshot of a critical card that vanished, a normal card outliving 30 s, or no card at all; `./client get-serial`
covers: bin/omarchy-notification-send defaults, notifications/Service.qml durationFor/requestedDuration/cardSlot ticking, NotificationLogic.popupPlacement, NotificationCard.qml accentColor/close button

### notification-send-rejects-bad-arguments   [VM-OK]
description: The notification sender refuses missing or unknown arguments, bad urgency, bad timeout and a quoted click command with clear messages and no toast, while dash-leading text is still accepted as content.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send`: a `Usage:` line, no toast.
  * Run `omarchy-notification-send "Hi" --nope`: `Unknown option: --nope` plus usage, no toast.
  * Run `omarchy-notification-send -u bogus "Hi"`: `Unknown urgency: bogus (use low, normal, or critical)`.
  * Run `omarchy-notification-send -t abc "Hi"`: `Invalid -t value (milliseconds expected): abc`.
  * Run `omarchy-notification-send "Bad exec" --exec "xdg-terminal-exec -e btop"`: `--exec takes the command as separate words, not one quoted string.`, no toast.
  * Run `omarchy-notification-send "-50% off" "-1 is a body too"`: a toast whose title is literally `-50% off` appears (dash-leading text is content).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Wait two seconds after each rejected command and confirm no toast appeared before the next.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots showing each rejection message with no toast on screen; the `-50% off` toast
  * If unsuccessful
  ** A toast appearing after a rejected command, or a missing message
covers: bin/omarchy-notification-send argument parsing, test/shell.d/notification-send-test.sh

### notification-icon-image-and-glyph   [VM-OK]
description: The toast icon slot shows an image hint, falls back to a themed app icon and then to a glyph, and a missing themed icon collapses the slot instead of showing a broken placeholder.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical --image "$OMARCHY_PATH/applications/icons/Docker.png" "With image" "Docker logo on the left"`: the card shows the whale image in a ~40 px slot left of the text.
  ** If that file is missing on this disk use `~/.local/state/omarchy/current/background` (the wallpaper).
  * Run `omarchy-notification-send -u critical -i dialog-information "Themed icon" "From the icon theme"`: an information icon in the slot.
  * Run `omarchy-notification-send -u critical -g "K" "Glyph fallback" "Letter K as glyph"`: a large `K` in the slot.
  * Run `omarchy-notification-send -u critical -g "K" "Compact glyph"`: a single-line card with a small `K` right before the title.
  * Run `omarchy-notification-send -u critical -i no-such-icon-name-xyz "Missing icon" "Slot must collapse"`: text only, no pink or broken square, no empty gap.
  * Press Super+Shift+comma: all cards gone. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Critical urgency keeps the cards up for screenshots; Nerd-Font glyphs cannot be typed, so an ASCII letter stands in for `-g`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the five cards: image, themed icon, large glyph, compact glyph, collapsed slot; the clean screen after dismiss-all
  * If unsuccessful
  ** Screenshot of a broken-image placeholder or a card without its image
covers: NotificationCard.qml (smallIconSource, iconSource, compactGlyph, slot visibility), NotificationLogic.shouldRenderCompactGlyph/glyphFromHints, bin/omarchy-notification-send -g/-i/--image

### notification-click-acts   [VM-OK]
description: Clicking a toast runs its click command (an Omarchy `--exec` argv, or a third-party libnotify default action) and dismisses it, Super+Alt+comma does the same for the newest toast, and a toast without any action simply closes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical "Open a terminal" "Click me" --exec xdg-terminal-exec`.
  * Left-click the card body (not the corner): within three seconds a second terminal opens and the card is gone. Close the new terminal with Super+W.
  * Run the same command again, then press Super+Alt+comma: a terminal opens and the card is gone. Close that terminal with Super+W.
  * Run `notify-send -w -A default=Open -u critical "Third party" "Click prints default"` (it blocks); left-click the card: the terminal prints `default`, the prompt returns, the card is gone.
  * Run `omarchy-notification-send -u critical "No action" "Just closes"`; left-click it: the card is dismissed and nothing else opens.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The invoke hotkey is `<M-A-,>`.
  * If `notify-send` lacks `-A`, note its version and skip that step; it is a tooling gap.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the card; the new terminal with the card gone (click and hotkey); the terminal showing `default` after the third-party click; the no-action card dismissed with nothing opened
  * If unsuccessful
  ** Screenshot of a card surviving the click or of no terminal appearing; `./client get-serial`
covers: Service.qml invokePopupDefault/focusApp, NotificationLogic.parseExecArgv, bin/omarchy-notification-send --exec, IPC invokeLast, utilities.lua Super+Alt+comma, NotificationServer actionsSupported

### notification-dismiss-mouse-and-hotkeys   [VM-OK]
description: Toasts are dismissed by right-click, by the hover-revealed close button (which never fires the click command), by Super+comma for the newest, and by Super+Shift+comma for all.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `for i in 1 2 3; do omarchy-notification-send -u critical "Toast $i"; done`: three cards, `Toast 3` on top.
  * Right-click `Toast 3`: it is gone, two remain.
  * Press Super+comma: `Toast 2` is gone, `Toast 1` remains.
  * Run `omarchy-notification-send -u critical "Close button" "Hover then hit the x" --exec xdg-terminal-exec` and move the mouse onto it: a `✕` appears in the card's top-right corner. Left-click exactly on the `✕`: the card is gone AND no terminal opened.
  * Press Super+Shift+comma: `Toast 1` is gone; no cards remain.
  * Press Super+comma with nothing on screen: nothing changes, no error dialog. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The comma combos are `<M-,>` and `<M-S-,>`; the `✕` is an 18 px target 3 px inside the corner — use ./client-with-image to aim.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: three cards; two after the right-click; one after Super+comma; the revealed `✕`; the card gone with no new terminal; none after Super+Shift+comma; the unchanged desktop after the empty dismiss
  * If unsuccessful
  ** Screenshot of the wrong card removed, or a terminal opened by the `✕` click
covers: NotificationCard.qml RightButton/closeRequested and close-button stacking, Service.qml dismissPopup, IPC dismissOne/dismissAll, utilities.lua Super+comma bindings

### notification-history-replay-and-clear   [VM-OK]
description: Super+Shift+Alt+comma replays the recent notifications as toasts newest-first, a placeholder toast explains an empty history, and `notifications clear` forgets it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell notifications clear`, then press Super+Shift+Alt+comma: a single toast `No recent notifications` with a bell glyph.
  * Wait six seconds, then run `for i in 1 2 3; do omarchy-notification-send "History $i"; done` and wait seven seconds until no card is on screen.
  * Press Super+Shift+Alt+comma: within three seconds three cards are back, `History 3` on top and `History 1` at the bottom.
  ** Replayed toasts get a fresh standard lifetime (5 s here), so screenshot right after the hotkey.
  * Wait for them to expire, run `omarchy-shell notifications clear`, press Super+Shift+Alt+comma: `No recent notifications` again.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkey is `<M-S-A-,>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the placeholder toast; the three replayed toasts in newest-first order; the placeholder again after clearing
  * If unsuccessful
  ** Screenshot after the hotkey with nothing replayed; `./client get-serial`
covers: Service.qml showRecentHistory/replayHistory/clearHistory/archivePopupFileFor, NotificationLogic.historyRows, utilities.lua Super+Shift+Alt+comma, IPC clear

### notification-do-not-disturb   [VM-OK]
description: Turning do-not-disturb on from the bar indicator hides ordinary notifications and records them, still lets Omarchy action toasts and critical bare-CLI alerts through but not a branded app's critical alert, and the hotkey turns it off so the hidden ones appear in history.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell notifications clear`.
  * Hover left of the clock to reveal the indicators and left-click the bell-slash glyph: it is drawn solid next to the clock and stays when the mouse leaves; its tooltip reads `Allow Notifications`.
  ** DND gives no toast of its own; the solid indicator is the only feedback.
  * Run `notify-send -a Demo "Hidden normal"`: wait three seconds, NO toast.
  * Run `omarchy-notification-send "Omarchy action shows"` then `notify-send -u critical "Critical notify-send shows"`: both toasts appear.
  * Run `notify-send -a Discord -u critical "Branded critical hidden"`: wait three seconds, NO new toast.
  * Press Super+Ctrl+comma: the solid bell-slash disappears. Run `notify-send -a Demo "Now visible"`: the toast appears.
  * Right-click the remaining critical toast, wait for the rest to expire, then press Super+Shift+Alt+comma: the replay includes `Hidden normal` and `Branded critical hidden` (silenced but recorded) alongside the ones that were shown.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The DND hotkey is `<M-C-,>`; `notify-send -a Demo` makes the sender non-ephemeral so the silenced toast is recorded (a bare `notify-send "x"` while silenced is dropped).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the solid DND indicator with its tooltip; no toast after the Demo send; the two bypassing toasts; no toast after the Discord send; the indicator gone and `Now visible` shown; the replay listing the silenced entries
  * If unsuccessful
  ** Screenshot of a toast that should have been hidden (or hidden that should have shown) with the indicator state visible
covers: indicators/Dnd.qml, Service.qml setDoNotDisturb/handleNotification/writeSilenced, NotificationLogic.shouldBypassDnd/isEphemeralApp, bin/omarchy-toggle-notification-silencing, utilities.lua Super+Ctrl+comma, docs/notifications.md Silencing

### notification-replace-updates-card-in-place   [VM-OK]
description: A sender that reuses a notification id updates the existing card's text in place instead of stacking a second card, and a non-numeric id is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `id=$(omarchy-notification-send -p -u critical "Step 1 of 3" "Working"); echo "id=$id"`: a number is printed and one card reads `Step 1 of 3`.
  * Run `omarchy-notification-send -r "$id" -u critical "Step 2 of 3" "Still working"`: still exactly one card, now `Step 2 of 3` / `Still working`.
  * Run `omarchy-notification-send -r "$id" -u critical "Step 3 of 3" "Done"`: one card, `Step 3 of 3` / `Done`.
  * Run `omarchy-notification-send -r abc "Bad id"`: `Invalid -r value (numeric id expected): abc`, no new card.
  * Right-click the card to dismiss it; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Count the cards in each screenshot; two stacked cards is the failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the single card at each of the three steps; the terminal rejection line; the clean screen
  * If unsuccessful
  ** Screenshot showing stacked cards
covers: Service.qml watchForUpdates/refreshPopup/removePopupsByOriginalId, NotificationLogic.replacementSnapshot/popupRowChanged, bin/omarchy-notification-send -p/-r

### notification-survives-shell-restart   [VM-OK]
description: A critical toast comes back on screen after the shell restarts (as `omarchy-update` does), still clickable, while a toast that had already expired is not brought back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical "Survive restart" "I should come back" --exec xdg-terminal-exec`: card present.
  * Run `omarchy-restart-shell` and screenshot every three seconds: the bar disappears and returns within ~15 s; once it is back, the `Survive restart` card is on screen again.
  * Left-click the restored card: a new terminal opens (the click command was restored too) and the card is gone. Close the new terminal with Super+W.
  * Run `omarchy-notification-send "Expires before restart"`, wait six seconds so it expires, then run `omarchy-restart-shell`: after the bar returns there is NO `Expires before restart` card.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar vanishing for a few seconds is the restart; the terminal window stays. Restored toasts start with a full lifetime; critical ones have none.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot before the restart; with the bar gone; with the bar back and the restored card; the terminal opened by the restored click; the screen after the second restart without the expired card
  * If unsuccessful
  ** Screenshot after the restart without the card; `./client get-serial`
covers: Service.qml persistPopupFile/restorePopups, NotificationLogic.persistablePopup/popupExpired, bin/omarchy-restart-shell, notifications-test.sh restore assertions

### notification-position-follows-bar-edge   [VM-OK]
description: Toasts sit below a top bar, hug the top edge when the bar is at the bottom, and move inward when the bar is on the right, so they never overlap the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical "Bar on top"`: the card's top edge sits a bar-height plus a gap below the screen top, at the right edge.
  * Run `omarchy bar position bottom`, then `omarchy-notification-send -u critical "Bar on bottom"`: the new card stack starts just a small gap below the very top edge.
  * Run `omarchy bar position right`, then `omarchy-notification-send -u critical "Bar on right"`: the cards sit LEFT of the vertical bar, not under it.
  * Run `omarchy bar position top`, press Super+Shift+comma, run `rm ~/.config/omarchy/shell.json`: bar on top, no cards, as found.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare the top card's vertical position between the first two screenshots; it is about 26 px higher with the bar at the bottom.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three screenshots with the toast stack placed relative to each bar edge as described; the final clean screenshot
  * If unsuccessful
  ** Screenshot of a card overlapping the bar
covers: Service.qml barPosition/barClearance, NotificationLogic.popupPlacement, bin/omarchy-bar cmd_position

### notification-time-and-battery-hotkeys   [VM-PARTIAL]
description: Super+Ctrl+Alt+T shows the time notice; Super+Ctrl+Alt+B on a machine without a battery currently produces a glyph-only toast, which this test records so the edge case is known.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+T: within two seconds a compact toast top-right shows a clock glyph and text like `Friday 13:09  ·  18 September 2026  ·  Week 38`. Wait six seconds: it expires.
  * Press Super+Ctrl+Alt+B: within two seconds record exactly what appears — expected here is a very small toast with only a battery glyph and no text (or nothing).
  ** There is no battery, so the status text is empty; describe it precisely so it can be filed, do not fail on it.
  * Open a terminal with Super+Enter, run `omarchy-battery-status`: it prints nothing. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkeys are `<M-C-A-t>` and `<M-C-A-b>`; both toasts are low urgency, screenshot promptly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the time toast with date and week number; screenshot (or note) of what the battery hotkey produced; the empty terminal output
  * If unsuccessful
  ** Screenshot of an error dialog or of no time toast; `./client get-serial`
covers: bin/omarchy-notification-time, bin/omarchy-notification-battery, bin/omarchy-battery-status, utilities.lua Super+Ctrl+Alt+T/B, NotificationCard.qml compactGlyph

### notification-body-markup-sanitized   [VM-OK]
description: The toast body honours simple markup like bold but strips image tags so nothing remote is fetched or shown broken, while the summary is always plain text.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type: `notify-send -a Demo -u critical "Markup" "<b>bold</b> then <img src=\"http://example.invalid/x.png\"> after"` then Enter.
  ** Send `<` as `<LT>` and `>` as `<GT>`; check the line with ./client-with-image before Enter.
  * The card body reads `bold then  after` with `bold` in bold weight; no broken-image placeholder and no literal `<img` text.
  * Run `notify-send -a Demo -u critical "Plain summary <b>not bold</b>"`: the TITLE shows the literal `<b>` tags (summaries are plain text).
  * Press Super+Shift+comma; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The angle-bracket escapes are the only tricky part; a mistyped command shows as a shell error, not a toast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the body with bold text and no image artefact; screenshot of the literal tags in the summary
  * If unsuccessful
  ** Screenshot of a pink or broken image square, or of rendered markup in the summary
covers: NotificationLogic.stripImageTags/styledBody/sanitizeBody, NotificationCard.qml textFormat (PlainText summary, StyledText body), test/shell.d/qml-text-format-test.sh

### reminder-set-and-fires   [VM-OK]
description: Super+Ctrl+R opens the two-step reminder prompt; a one-minute reminder confirms with a toast, lights the bar's bell indicator, fires a `Reminder` toast a minute later, and the indicator clears.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+R: a dimmed screen with a centred card reading `Remind in minutes...`.
  * Type `1` and press Enter: the card reads `Reminder message...`.
  * Type `Tea is ready` and press Enter: the overlay closes and a toast `Tea is ready in 1 minutes` / `You'll be reminded at HH:MM` appears; a solid bell glyph now sits left of the clock.
  * Hover the bell for a second: tooltip `1 reminder`.
  * Screenshot every five seconds: within about 70 seconds a toast `Reminder` / `Tea is ready` appears with a bell glyph.
  ** It is a low-urgency toast (5 s), so the five-second cadence is required to catch it.
  * Screenshot the bar: the solid bell glyph is gone; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The overlay takes keyboard focus by itself; just type.
  * If the toast never fires, `systemctl --user list-timers 'omarchy-reminder-*'` in a terminal shows whether the timer exists.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: minutes prompt; message prompt; confirmation toast with the solid bell; tooltip `1 reminder`; the `Reminder` / `Tea is ready` toast; the bar with the bell cleared
  * If unsuccessful
  ** Screenshot of the bar and the terminal output of the timer listing
covers: ReminderFlow.qml, ReminderFlowModel.js, bin/omarchy-reminder (set, confirmation, fire payload), indicators/Reminder.qml, utilities.lua Super+Ctrl+R, omarchy-menu.jsonc trigger.reminder.set

### reminder-overlay-rejects-bad-input   [VM-OK]
description: The reminder prompt refuses non-numeric or zero minutes with a toast and stays open, clears typed text on Escape, and closes on a second Escape, an empty submit or a click outside, creating nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+R, type `abc`, press Enter: a toast `Invalid reminder` / `Enter the number of minutes` appears and the overlay is still open showing `abc`.
  * Press Escape once: the text clears to `Remind in minutes...`, overlay still open.
  * Type `0`, press Enter: the `Invalid reminder` toast again; overlay still open.
  * Press Escape twice: the overlay is gone.
  * Press Super+Ctrl+R, press Enter with nothing typed: the overlay closes with no toast.
  * Press Super+Ctrl+R, then left-click the dimmed area far from the card (x≈0.1, y≈0.9): the overlay closes.
  * Hover left of the clock: the bell indicator is still dimmed (no reminder was created); the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The invalid toast is low urgency (5 s); screenshot right after Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Invalid reminder` toast with the overlay open (twice); the cleared prompt; the closed overlay after Escape, empty Enter and outside click; the dimmed bell
  * If unsuccessful
  ** Screenshot of a solid bell (a reminder was created from bad input) or an overlay that will not close
covers: ReminderFlow.qml submit/dismiss/Keys.onPressed/scrim MouseArea, ReminderFlowModel.validMinutes, test/shell.d/reminders-test.sh

### reminder-show-clear-and-indicator   [VM-OK]
description: Reminders set from the CLI light the bell indicator and are listed by Super+Ctrl+Alt+R, by clicking the indicator and from the Omarchy menu; Super+Shift+Ctrl+R clears them with a confirmation, and the idle indicator click opens the set prompt.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-reminder 30 "Check the oven"`: toast `Check the oven in 30 minutes` / `You'll be reminded at HH:MM`; the bell is solid next to the clock.
  * Run `omarchy-reminder 45`: toast `Reminder set for 45 minutes`; hover the bell: tooltip `2 reminders`.
  * Press Super+Ctrl+Alt+R: toast `Upcoming reminders` listing `Check the oven in 29m …s (HH:MM)` and `45-min reminder in 44m …s (HH:MM)`.
  * Left-click the solid bell: the same `Upcoming reminders` toast.
  * Press Super+Space, type `Reminder`, Enter: a submenu `Set one` / `Show all` / `Clear all`; choose `Show all` with the arrows and Enter: the listing toast again.
  * Press Super+Shift+Ctrl+R: toast `All reminders have been cleared`; the bell is gone.
  * Press Super+Ctrl+Alt+R: toast `Upcoming reminders` / `No outstanding reminders`.
  * Hover left of the clock and click the dimmed bell: the `Remind in minutes...` prompt opens; press Escape. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hotkeys: `<M-C-A-r>` show, `<M-S-C-r>` clear; the listing toasts are low urgency, screenshot promptly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: both confirmation toasts; tooltip `2 reminders`; the two-line listing (hotkey, click and menu); the cleared toast with the bell gone; `No outstanding reminders`; the prompt opened from the idle bell
  * If unsuccessful
  ** Screenshot of a listing that disagrees with the reminders set, or a bell that stays solid after clear
covers: bin/omarchy-reminder (set, show, clear), indicators/Reminder.qml onPressed/openReminderFlow, utilities.lua Super+Ctrl+Alt+R / Super+Shift+Ctrl+R, omarchy-menu.jsonc trigger.reminder.*

### reminder-cli-rejects-bad-arguments   [VM-OK]
description: `omarchy-reminder` prints usage and exits 1 for missing, non-numeric, zero or negative minutes and for an unknown `show` argument, creating no timer and no toast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-reminder; echo exit=$?`: `Usage:` lines and `exit=1`.
  * Run `omarchy-reminder abc; echo exit=$?`, `omarchy-reminder 0 "Nothing"; echo exit=$?` and `omarchy-reminder -5; echo exit=$?`: usage and `exit=1` each time, no toast.
  * Run `omarchy-reminder show extra; echo exit=$?`: usage, `exit=1`.
  * Hover left of the clock: the bell indicator is dimmed (nothing was created).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Wait two seconds after each command and confirm no toast appeared before the next.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots showing usage and `exit=1` for each command with no toast on screen; the dimmed bell
  * If unsuccessful
  ** A confirmation toast or a solid bell after a rejected command
covers: bin/omarchy-reminder usage/validation

## Gaps

- **Battery, Bluetooth, Wi-Fi, backlight, microphone, second monitor** paths of the power, bluetooth, network (Wi-Fi scan/connect/QR/band), monitor (brightness slider, mirroring, laptop-display toggle) and microphone widgets cannot be exercised; only their absence paths are covered above.
- **Caps Lock OSD** does not exist in Omarchy (Caps Lock is Compose); the negative — no card, compose works — is covered in `osd-media-keys-without-hardware`.
- **Physical media keys**: the driver has no XF86 keysyms, so the bindings are exercised by `wtype -k …` typed inside the guest; the electrical key path itself is not tested.
- **Tray items on a stock disk** depend on OBS starting under llvmpipe; the fallback needs a package download.
- **Update indicator** depends on the minted disk being behind the released package and on network; the actual update is far outside the time budget. The IPC `omarchy.system-update clear|refresh` methods are not exercised (no user-facing surface).
- **Weather** depends on wttr.in / open-meteo being reachable and responsive.
- **Nightlight tint** cannot be verified visually without GPU acceleration; only the indicator path is covered.
- **Screen-recording indicator** active state needs a working `gpu-screen-recorder`; only the inactive glyph and tooltip are covered. **Dictation** active states need voxtype and a microphone. **Agents widget** needs an installed agent CLI.
- **Multi-monitor behaviours** (per-monitor bar instances, focused-monitor panel routing) need a second output.
- Dropped in the revision for length, still untested: `omarchy.indicators` `alwaysShow`/`items` settings; `type: qml` custom modules; `centerAnchor: ""` group centring; `omarchy.spacer`; `omarchy.media` (mpv + mpv-mpris could drive it); `omarchy bar move` with `--before/--after`; `omarchy bar use <third-party bar>` (needs a plugin repo); clock `birthYear`/`lifeExpectancy` life bar; clock vertical-bar format ring.
- **Notification image persistence** (`notifications/images/` copies, orphan sweep) and **history trimming to ten** are only indirectly covered; sending twelve notifications and replaying would show ten.
- **`omarchy-notification-dismiss <summary>`** and **`omarchy-notification-wait`** are not exercised directly (the former is `notifications dismiss`; the latter matters only at session start).
- **Toast placement with the bar hidden** (`barHidden` → clearance 0) not covered.
- **Timezone picker selection** (`omarchy-menu-timezone`) is another reviewer's area; only cancel is covered.
