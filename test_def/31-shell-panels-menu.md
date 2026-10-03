# 31 — Quickshell desktop: settings panels, Omarchy Menu, pickers, polkit agent

Source: `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18. Format per `00-FORMAT.md`.

## Scope

Read completely (line counts from `wc -l`):

Shared UI kit (`shell/Ui/`):
- `Panel.qml` 59, `PanelController.qml` 16, `PanelKeyCatcher.qml` 85, `PanelHero.qml` 111, `PanelActionButton.qml` 100,
  `PanelSlider.qml` 149, `PanelSectionHeader.qml` 30, `PanelSeparator.qml` 18, `PanelToolTip.qml` 49
- `KeyboardPanel.qml` 418 (the layer-shell popup every bar panel uses), `ConfirmDialog.qml` 133, `Dropdown.qml` 244,
  `SearchableDropdown.qml` 353, `TextField.qml` 57, `Toggle.qml` 117, `ToggleSwitch.qml` 111, `NumberField.qml` 85,
  `MultiSelect.qml` 623, `SpeedTestOverlay.qml` 412

Plugins:
- `shell/plugins/menu/` — `Menu.qml` 1480, `MenuModel.js` 524, `BarWidget.qml` 24, `manifest.json` 23
- `shell/plugins/polkit/` — `PolkitAgent.qml` 392, `PolkitModel.js` 32, `manifest.json` 20
- `shell/plugins/clipboard/` — `Clipboard.qml` 613, `ClipboardHistory.js` 225, `capture.sh` 106, `manifest.json` 15
- `shell/plugins/emojis/` — `Emojis.qml` 345, `EmojiSearch.js` 46, `manifest.json` 15 (`emojis.json` data file skipped)
- `shell/plugins/image-picker/` — `ImagePicker.qml` 582, `ImagePickerModel.js` 97, `list.sh` 114, `manifest.json` 15
- `shell/plugins/agents/` — `Panel.qml` 942, `Main.qml` 748, `Agent.qml` 34, `manifest.json` 40, `README.md` 150 (svg assets skipped)
- `shell/plugins/dev-gallery/` — `GalleryPanel.qml` 1854, `manifest.json` 14
- `shell/plugins/panels/audio/` — `Panel.qml` 1248, `Model.js` 262, `manifest.json` 20
- `shell/plugins/panels/bluetooth/` — `Panel.qml` 1045, `Model.js` 177, `manifest.json` 20
- `shell/plugins/panels/clock/` — `Panel.qml` 762, `BarWidget.qml` 185, `Model.js` 308, `manifest.json` 20
- `shell/plugins/panels/disk-speedtest/` — `Panel.qml` 151, `manifest.json` 14
- `shell/plugins/panels/dropbox/` — `Panel.qml` 547, `Service.qml` 277, `Model.js` 137, `DropboxIcon.qml` 45, `status.py` 128, `manifest.json` 36
- `shell/plugins/panels/monitor/` — `Panel.qml` 929, `Model.js` 124, `manifest.json` 20
- `shell/plugins/panels/network/` — `Panel.qml` 2087, `Model.js` 398, `manifest.json` 20
- `shell/plugins/panels/power/` — `Panel.qml` 536, `Model.js` 104, `manifest.json` 20
- `shell/plugins/panels/speedtest/` — `Panel.qml` 202, `manifest.json` 14
- `shell/plugins/panels/tailscale/` — `Panel.qml` 1273, `Service.qml` 637, `Model.js` 325, `TailscaleIcon.qml` 72, `README.md` 49, `manifest.json` 36
- `shell/plugins/panels/weather/` — `Panel.qml` 881, `BarWidget.qml` 83, `Model.js` 295, `manifest.json` 21
- `shell/plugins/panels/wifiqr/` — `Panel.qml` 369, `Model.js` 37, `manifest.json` 14

Services: `shell/services/AppLibrary.qml` 268, `shell/services/AppSearch.js` 134, `shell/services/hidden-entries.sh` 102.

Cross-checked: `default/omarchy/omarchy-menu.jsonc` 380, `docs/menu.md` 167, `config/omarchy/shell.json` (default bar layout),
`default/hypr/bindings/{utilities,clipboard,applications,media}.lua`, `bin/omarchy-menu`, `omarchy-menu-{clipboard,emoji,emoji-insert,
select,input,images,file,keybindings,timezone,plugin,share}`, `omarchy-clipboard-{open,paste-file,paste-text}`, `omarchy-theme-switcher`,
`omarchy-theme-bg-switcher`, `omarchy-launch-{about,screensaver,floating-terminal-with-presentation,config-editor}`, `omarchy-shell`,
`omarchy-dns`, `omarchy-network-status`, `omarchy-network-band` (head), `omarchy-monitor-state`, `omarchy-brightness-display` (head),
`omarchy-hyprland-monitor-scaling` (head), `omarchy-display-text-size` (head), `omarchy-font-list`, `omarchy-font-set` (head),
`omarchy-powerprofiles-list`, `omarchy-disk-speedtest` (head), `omarchy-network-speedtest` (head), `omarchy-hibernation-available`.

Maintainer tests skimmed for invariants: `test/acceptance.d/panels-test.sh`, `menu-test.sh`; `test/shell.d/agents-panel-test.sh`,
`app-search-test.sh`, `clipboard-test.sh`, `emojis-test.sh`, `image-picker-test.sh`, `polkit-test.sh`, `menu-test.sh`, `menu-guards-test.sh`,
`menu-images-test.sh`, `menu-plugin-test.sh`, `panel-command-path-test.sh`, `network-password-test.sh`, `network-qr-test.sh`,
`network-test.sh`, `bluetooth-test.sh`, `audio-test.sh`, `power-test.sh`, `monitor-test.sh`, `monitor-scaling-test.sh`,
`monitor-state-test.sh`, `setup-form-test.sh`, `pointer-move-gate-test.sh`, `wifiqr-test.sh`, `clock-test.sh`, `weather-test.sh`,
`tailscale-test.sh`, `dropbox-test.sh`, `keybindings-menu-test.sh`.

Skipped: `shell/Ui/Button.qml`, `CursorSurface.qml`, `ButtonGroup.qml`, `BarIconButton.qml`, `PopupCard.qml`, `PointerMoveGate.qml`
(consumed by the files above but outside the assigned list; behaviour inferred from call sites). Other bar widgets (workspaces, tray,
indicators, keyboard-layout, system-update, media, osd, notifications, reminders) belong to other reviewers. `test/shell.d/panels-*`
does not exist at HEAD; the panel acceptance test is `test/acceptance.d/panels-test.sh`.

## Inventory

**Hotkeys and IPC entry points (`default/hypr/bindings/utilities.lua`, `clipboard.lua`)**
- `Super+Space` → `omarchy-menu toggle` (root). `Super+Alt+Space` → route `apps`. `Super+Escape` / `XF86PowerOff` → route `system`.
  `Super+Ctrl+C` → `capture`. `Super+Ctrl+O` → `toggle`. `Super+Ctrl+H` → `hardware`. `Super+Ctrl+S` → `share`. `Super+Ctrl+R` → `reminder-set`
  (alias of `trigger.reminder.set`, an action → runs `omarchy-reminder -i` directly). `Super+Shift+code:201` (Copilot key) → root.
- `Super+Ctrl+Space` → route `background` (= `style.background` action → `omarchy-theme-bg-switcher` → image picker).
  `Super+Shift+Ctrl+Space` → route `theme` (= `style.theme` action → `omarchy-theme-switcher` → filterable image picker with labels).
- `Super+K` → `omarchy-menu-keybindings` (menu in select mode, width 800). `Super+Alt+K` tmux, `Super+Ctrl+K` herdr keybindings.
- `Super+Ctrl+E` → `omarchy-shell shell toggle omarchy.emojis`. `Super+Ctrl+V` → `… toggle omarchy.clipboard`.
- `Super+Ctrl+A` audio, `Super+Ctrl+B` bluetooth, `Super+Ctrl+D` display/monitor, `Super+Ctrl+Alt+D` calendar (clock),
  `Super+Ctrl+W` network, `Super+Ctrl+P` power — all `omarchy-shell shell toggle omarchy.<id>`.
- `Super+Ctrl+1..9` → `omarchy-shell -q shell togglePanelAt right N` (N-th panel-bearing widget in the bar's right section; tray not counted).
- CLI (`bin/omarchy-menu`): `omarchy-menu [toggle|summon|close|refresh|ping] [route]`; unknown verb → exit 2 with message.
- CLI (`bin/omarchy-shell`): `omarchy-shell <target> <method> [args]`; `shell summon|toggle|hide <plugin-id> [json]`;
  per-panel targets `omarchy.network|audio|bluetooth|monitor|power|clock|weather|agents|tailscale|dropbox` with `open|close|show|hide|toggle`
  plus extras: network `toggleNetwork|showQr|speedTest|openCaptivePortal|checkConnectivity`; bluetooth `toggleBluetooth`; monitor `brightness <pct>|state`;
  power `togglePercentage`; clock `refresh|cycleFormat|toggleWeekStart`; weather `edit`; agents `refresh|next`; tailscale `refresh|up|down|toggleTailscale|status`;
  dropbox `refresh|login|status`. Panels `omarchy.speedtest`, `omarchy.disk-speedtest`, `omarchy.wifiqr`, `omarchy.dev-gallery` are `shell summon`-only.

**Default bar layout (`config/omarchy/shell.json`)**
- left: `omarchy.menu`, `omarchy.workspaces`; center: indicators, `omarchy.clock` (format `dddd HH:mm`, alt `d MMMM 'W'ww yyyy`), keyboard-layout,
  `omarchy.weather`, system-update; right: tray, `omarchy.agents`, `omarchy.bluetooth`, `omarchy.network`, `omarchy.audio`, `omarchy.monitor`, `omarchy.power`.
- Self-hiding widgets: bluetooth (`visible: adapter !== null`), power (`visible: batteryPresent`), agents (`visible: providers.length > 0`),
  weather (`visible: label !== ""`, i.e. only after a successful fetch). Tailscale and Dropbox are not in the default layout (enable via Setup → Plugins).

**Shared panel behaviours (`shell/Ui/KeyboardPanel.qml`, `PanelKeyCatcher.qml`, `Panel.qml`)**
- Every bar panel is a full-screen transparent layer (`omarchy-keyboard-panel`) with a card anchored under its bar icon (top bar) or centred on the bar
  (`centerOnBar` — clock, weather). Card fades in/out 140 ms. Outside click anywhere closes; a click on the bar strip is forwarded to the bar icon
  so clicking another icon swaps panels in one click.
- Keys (PanelKeyCatcher): `Esc` close; `Tab`/`Shift+Tab` switch to neighbouring bar panel; `j/k`/`Down/Up` move cursor; `h/l`/`Left/Right`
  horizontal move or value adjust; `Enter`/`Space` activate; `x`/`X` delete (bluetooth forget); single text keys per panel (`r` refresh, `w` Wi-Fi radio,
  `m` mute, `b` bluetooth radio, `t` tailscale, `[ ] { } t w` clock). Cursor is not painted until the first key or mouse hover ("no initial highlight").
- Keyboard focus is primed Exclusive for 75 ms then OnDemand; reopening during the fade re-primes (acceptance test checks Esc still works).
- Panel width `Style.space(380)` (clock 560, weather 480); height fits content, capped to screen (audio/monitor/tailscale/dropbox 560, agents 640).

**Shared controls (`shell/Ui/*`)**
- `PanelSlider`: left-drag/click sets value, wheel steps, right-click emits `rightClicked` (audio uses it to mute); `tickCount` notches (monitor text size).
- `ToggleSwitch`: pill/square follows theme corner radius; `busy` swallows clicks; hover ring. `Toggle`: labelled row + switch; click anywhere on row.
- `Dropdown`: trigger + popup list; `Enter/Space/Down` opens, `j/k`, `Enter` selects, `Esc` closes. `SearchableDropdown`: same with a filter TextField,
  "No matches" empty text, `Down` from search jumps to first result, `Up` from first returns to search. `MultiSelect`: checkbox list, optional refresh
  button for `optionsCommand`, "Loading…" / "Options command timed out" / "Options command exited N" / invalid-JSON error texts, "None selected" trigger.
- `NumberField`: editable SpinBox with label. `TextField`: styled QQC TextField, `password: true` masks with echo mode. `ConfirmDialog`: scrim + card,
  two buttons `[Cancel] [Confirm]`, confirm is destructive-red and pre-selected (`selectedIndex: 1`), `Left/Right/Tab` swaps, `Enter` picks, `Esc` cancels,
  click on scrim cancels.
- `SpeedTestOverlay`: full-screen 78 % black scrim, two 270° dials with tick rings, needle "ignition" sweep on open, digital readout, unit label,
  `Run Again` button (hidden while running), red error text, `Esc`/scrim click close, `Enter` re-runs when idle. Scale latches upward at 92 % of stops.
- These raw controls are user-reachable only through the dev gallery (`omarchy.dev-gallery`) and the bar settings forms (other reviewer).

**Omarchy Menu (`shell/plugins/menu/Menu.qml`, `MenuModel.js`, `default/omarchy/omarchy-menu.jsonc`, `docs/menu.md`)**
- Bar widget: leftmost icon (omarchy glyph); left click toggles root, right click runs `xdg-terminal-exec`. (`BarWidget.qml`)
- Layer `omarchy-menu`, Exclusive keyboard focus, scrim, card 300 px wide (520 for `trigger.capture.screenrecord` and `style.font`; dmenu width from payload),
  centred; first search keystroke / submenu move freezes the card's top edge so it grows downward. Card height ≤ 70 % of screen; longer lists end on a
  clipped "peek" row plus top/bottom scroll scrims.
- Header text: current submenu title (or label) + "…", greyed; replaced by the filter text while typing. Root header is "Go…".
- Root rows (jsonc): Apps (provider `apps`), Learn, Trigger, Style, Setup, Install, Remove, Update, About (action `omarchy-launch-about`), System.
- Keys: printable chars append to filter; `Backspace` edits filter, or goes back when filter empty; `Left` back (when no filter); `Esc` clears filter first,
  then closes; `Up/Down` move (wrap), `PgUp/PgDn` ±6; `Enter`/`Right` activate (menu → drill in, action → run detached and close, app → launch and close);
  `Delete` on an app row opens the uninstall ConfirmDialog ("Do you want to uninstall <App>?" / `[Cancel] [Uninstall]`).
- Mouse: hover moves cursor only after real movement (PointerMoveGate), click activates; disabled rows show arrow cursor and ignore clicks; scrim click closes.
- Search: matches label / last id segment / aliases substring and description whole-words; ranks exact label > app whole-word > prefix > contains > alias > description;
  results split into "current submenu" rows then a divider then drill-down rows; each row shows its parent path as detail; disabled rows are omitted from search;
  empty result → glyph + "No matches for “<q>”"; empty submenu → "Nothing here yet".
- Guards (batched bash): `when` hides; `checked` appends " ✓"; `disabled` dims row to 40 %, appends " ✓", cursor/Enter/click skip it. Submenu with no visible
  children (non-provider) hides itself. Guards evaluate on load and on every open; menu paints last answers immediately.
- Providers: `apps` (native; alphabetical; image icons; keywords searchable; never routable), `fonts` (volatile; `omarchy-font-list`, ✓ on current;
  action `omarchy-font-set`), `power-profiles` (defined but no default jsonc row points at it).
- Routes: id or alias, case-insensitive, `_`→`-`; `go`/`menu`/empty → root; exact id beats alias; unknown string → literal id → falls back to root when absent;
  alias for an action runs it directly; link follows target.
- dmenu modes (`omarchy-menu-select`, `omarchy-menu-input`): `mode: select` shows prompt "…" header and options (`glyph\tlabel\tsubtext` rows; subtext always
  visible; filter matches label+subtext; `Enter` returns `label` or `label\tsubtext`); `mode: input` shows only the header, typed text is the value, `Enter` returns it;
  `Esc`/scrim = cancel → caller exits 1. Consumers: `omarchy-menu-keybindings` (Super+K), `omarchy-menu-timezone`, `omarchy-menu-plugin enable|disable|clone|remove`,
  `omarchy-menu-file`, `omarchy-transcode`, `omarchy-webapp-remove`, `omarchy-tui-remove`, `omarchy-theme-remove`, `omarchy-menu-select`/`-input` from a terminal.
- Live reload: both `default/omarchy/omarchy-menu.jsonc` and `~/.config/omarchy/extensions/omarchy-menu.jsonc` are watched; user entries override per key;
  a file that fails to parse (inline `//` comment, invalid JSON) contributes nothing silently.
- Submenus and rows most relevant on the VM (guards evaluated on a stock VM):
  - System: Screensaver, Lock, Suspend (`when ! omarchy-toggle-enabled suspend-off` → visible), Hibernate (`omarchy-hibernation-available` → hidden, no swap/resume),
    Logout, Reboot, Shutdown.
  - Trigger: Emoji, Reminder (Set one / Show all / Clear all), Capture (Screenshot, Screenrecord{no audio, desktop audio, desktop+mic, +webcam hidden}, Text, QR Code, Color;
    "Stop Screenrecording" hidden unless recording), Transcode, Share (Clipboard, File, Folder, Receive), Toggle (Stay Awake, Notifications, Crash Capture, Screensaver,
    Nightlight, Menu Bar, Battery Percentage hidden on non-laptop, Workspace Layout, Window Gaps, 1-Window Ratio), Hardware (every child `when`-guarded on laptop/
    touchpad/touchscreen/hybrid-gpu/dell → submenu hidden on VM), Speed Test (Network Speed Test → `omarchy.speedtest`, Disk Speed Test → `omarchy.disk-speedtest`).
  - Style: Theme (image picker), Background (image picker), Unlock (plymouth picker), Font (provider), Menu Bar (Position{Top,Bottom,Left,Right}, Transparency),
    Hyprland (editor), Screensaver{Edit Text, Set From Image, Restore Default}, About{same}.
  - Setup: Monitors/Keybindings/Input (config editor), Network → DNS{DHCP,Cloudflare,Google ✓-guarded via `omarchy-dns`; Custom → floating terminal}, QR Code (hidden unless
    `omarchy-network-status` says wifi), Defaults → Agent/Browser/Terminal/Editor (✓ on current), Plugins → Enable/Disable/Add/Clone/Remove (Remove hidden without user plugins),
    Security (Fingerprint hidden, Fido2, SSHD, Passwordless Sudo, Sudoless Docker guarded), Config (Hyprland, Hyprsunset, XCompose), Direct Boot, Reset Computer (btrfs only).
  - Install / Remove: catalog rows, `disabled:` (Install) / `when:` (Remove) on package presence.
  - Update: Omarchy, Channel{Stable ✓, RC, Edge, Dev}, Config (Reset to default), Extra Themes (guarded), Process (Restart Hyprsunset/Shell), Hardware (Restart Audio/Wi-Fi/
    Bluetooth/Trackpad), Firmware, Password (Drive Encryption, User), Timezone (select mode), Time.

**Clipboard picker (`shell/plugins/clipboard/Clipboard.qml`, `ClipboardHistory.js`, `capture.sh`, `bin/omarchy-clipboard-*`)**
- Hotkey `Super+Ctrl+V` (also Trigger… no menu row; `omarchy-menu-clipboard` CLI). Layer `omarchy-clipboard`, card 875×600 max, two columns: list (left) and preview (right).
- History file `~/.local/state/omarchy/clipboard-history.json` (limit 500, dedup by content, newest first); two `wl-paste --watch` watchers (text, image/png) started at shell
  start, restarted after 1 s if they die; a snapshot of the current clipboard is taken at start. Sensitive offers (`x-kde-passwordManagerHint`, `wl-copy --sensitive`) are skipped.
- Row rendering: text → whitespace-collapsed single line; `file://` lists → file name or "N files" (single image path shows thumbnail); image → "Screenshot from <Weekday HH:MM>"
  (png) or "Image from …" with thumbnail. Preview pane shows full text (wrapped) or the image. Display capped at 50 rows and 8 KiB per entry.
- Keys: type to filter (matches text / "image screenshot <mime> <time>"); `Esc` clears filter then closes; `Up/Down`, `PgUp/PgDn` ±6, `Home/End`; `Enter` paste
  (`omarchy-clipboard-paste-text --shift-insert --history-index N` → wl-copy + `wtype Shift+Insert`; images `omarchy-clipboard-paste-file`); `Shift+Enter` copy only;
  `Alt+Enter` open (`omarchy-clipboard-open`: URL → browser, text → editor temp file, image → `tensaku-edit`); `Delete` removes selected entry; `Shift+Delete` →
  ConfirmDialog "Delete entire clipboard history?" `[Cancel] [Delete]`.
- Empty states: "Clipboard is empty" (no history) / "No matches for “<q>”". Header "Search clipboard…". Scrim click closes.

**Emoji picker (`shell/plugins/emojis/Emojis.qml`, `EmojiSearch.js`, `bin/omarchy-menu-emoji-insert`)**
- Hotkey `Super+Ctrl+E`, menu Trigger → Emoji, CLI `omarchy-menu-emoji`. Layer `omarchy-emojis`, card 400×500, grid of 44 px cells, header "Search emojis…".
- Keys: type to filter on keyword text (substring, ≤1000 results); `Left/Right` step, `Up/Down` row, `PgUp/PgDn` page; `Enter` inserts; `Esc` clears filter then closes.
  Mouse hover moves highlight, click inserts. Empty: "No matches for “<q>”".
- Insert = `wl-copy --sensitive --foreground` then `wtype Shift+Insert`, so the emoji is not recorded in clipboard history and is pasted into the previously focused window.

**Image picker (`shell/plugins/image-picker/ImagePicker.qml`, `ImagePickerModel.js`, `list.sh`, `bin/omarchy-menu-images`)**
- Reached via Style → Theme / Background, `Super+Shift+Ctrl+Space`, `Super+Ctrl+Space`, `omarchy-menu-images <dir>`. Layer `omarchy-image-selector`; skewed
  carousel: selected image large (768×475) in the centre, neighbours as 108 px slices, selected has 3 px accent border, others dimmed 42 %.
- Keys: `Left/Right` (`Tab`/`Shift+Tab`) step (wraps); `Enter` apply (writes selection file → caller applies theme/background); `Esc` clears filter, then cancels;
  with `--filterable` (theme switcher) printable keys filter by file name/label and the query shows under the label; `--show-labels` shows "Title Cased Name".
- Mouse: click a slice selects it, click the centred image applies; scrim click cancels. Empty match → label "No matches". Dedup by file name.
- Thumbnails cached under `~/.cache/omarchy/image-selector/`; theme previews come from `themes/<name>/preview.*` or first background.

**Polkit agent (`shell/plugins/polkit/PolkitAgent.qml`, `PolkitModel.js`)**
- Registers as the session agent on `/org/omarchy/PolkitAgent` (logs "omarchy polkit agent registered"). Any `pkexec`/polkit request pops a full-screen scrim
  (layer `omarchy-polkit`, Exclusive) with a centred one-line card: lock glyph, masked password field (placeholder "Enter password"), and above it a pill with the
  message: standard pkexec messages are shortened to "Authorize running '<program>'", others shown verbatim.
- `Enter` submits → "Checking..." while PAM runs; wrong password → field text/lock go red, placeholder reads "Wrong" for 1.2 s, card shakes ±8 px, field cleared and
  refocused; success or cancel → closes after 300 ms. `Esc` cancels the request (pkexec exits 126 "Not authorized"/dismissed). Click on scrim only refocuses (does not cancel).
- Fingerprint mode (square card with fingerprint glyph) only when `pam_fprintd.so` is in `/etc/pam.d/polkit-1` and the lid is open — never on the VM.
- Triggers on the VM: `pkexec <cmd>` from a terminal; `omarchy-dns <Provider>` when the passwordless sudoers rule is absent (network panel DNS pills and Setup → Network → DNS);
  Tailscale "Authorize Tailscale operator" (`pkexec tailscale set --operator`), `omarchy-launch-docker-tui`, `omarchy-update-stay-awake`, browser policy setters.

**Network panel (`shell/plugins/panels/network/Panel.qml`, `Model.js`, `bin/omarchy-network-status`, `omarchy-dns`, `omarchy-network-band`)**
- Bar icon: 󰈀 ethernet / 󰈂 ethernet-restricted / Wi-Fi bars by signal / 󰤮 disconnected; icon turns urgent with tooltip "Sign in to this network" / "Limited internet access".
  Left click toggles panel. Hotkey `Super+Ctrl+W`. IPC `omarchy.network toggleNetwork|showQr|speedTest|…`.
- Hero: icon, title "Ethernet (<speed>)" / SSID / "Disconnected" / "No connection"; meta line rotates phrases every 2.8 s ("WIRING BITS", "HANDLING PACKETS", …) while
  connected, "NOT CONNECTED", "SIGN-IN REQUIRED", "LIMITED INTERNET ACCESS". Hero actions (right): QR button (Wi-Fi only, connected, non-enterprise), speed-test button
  (any iface), Wi-Fi radio ToggleSwitch (only when a Wi-Fi station exists; tooltip "Turn Wi-Fi on/off").
- Captive portal block (only when NM reports Portal): red "Open Captive Portal" button + explanatory text; opens `omarchy-launch-browser http://ping.archlinux.org/nm-check.txt`.
- Details grid (always mounted when an iface exists): Ping, Packet Loss (red when >0), Receiving, Sending (B/s rates from 1.5 s samples), Downloaded, Uploaded, IP Address
  (click copies, tooltip "Copy IP"), Gateway (click copies). Values read "--" until first sample; ping "Timeout" when ICMP fails.
- Wi-Fi band section (Wi-Fi only, >1 band or pinned): header "WI-FI BAND[: 2.4GHZ]", "AUTOMATIC" ToggleSwitch, pills 2.4ghz/5ghz/6ghz (active = live band, bold = pinned).
- DNS section: "DNS PROVIDER" header, four pills DHCP / Cloudflare / Google / Custom; active pill filled from `omarchy-dns`; click runs `omarchy-dns <P>` (root via sudoers or
  pkexec) and closes the panel; Custom opens a floating terminal prompting for servers. Tooltips "Use DNS from DHCP", "Set DNS to Cloudflare", …
- Wi-Fi list (only with a station): "SCANNING WI-FI…" header during scan; KNOWN NETWORKS / OTHER NETWORKS sections; rows: signal icon, SSID ("Hidden" for empty), status
  line (Connected / Connecting… / Disconnecting… / Forgetting… / Wrong password / Passphrase required / Network lost / Connection failed / Timed out …); right edge lock 󰌾 for
  secured or forget 󰅙 (urgent) for known; click connected → disconnect, click secured unknown → inline passphrase field (+ Identity field for enterprise) with ✓ connect
  button (disabled until text), `Esc` cancels prompt; wrong PSK reopens the prompt with "Wrong password"; 30 s action timeout.
- Keys: `j/k` header ⇄ portal ⇄ band ⇄ dns ⇄ wifi; `h/l` within header actions / band pills / DNS pills / row ⇄ forget button; `Enter` activate; `r` refresh; `w` Wi-Fi radio.
- On the VM (`omarchy-network-status`): type ethernet (`enp0s…`), speed from `/sys/class/net/<if>/speed` (often -1 → no "(…)" suffix), IP `10.0.2.15`, gateway `10.0.2.2`,
  ping to 1.1.1.1 fails (ICMP blocked by user-mode NAT) → "Timeout" / "100%" in red.

**Audio panel (`shell/plugins/panels/audio/Panel.qml`, `Model.js`)**
- Bar icon by volume/mute/headphones (empty text when there is no sink); left click toggles, right click mutes/unmutes everything, wheel ±5 % with volume OSD.
  Hotkey `Super+Ctrl+A`.
- Hero: speaker icon (50 % when muted), "Audio", mood label ("SILENCED" 0 %, "WHISPER", "MURMUR", "EASY LISTENING", "STEADY GROOVE", "CRANKED UP", "PARTY MODE",
  "CONCERT HALL" 100 %, "MUTED"); ToggleSwitch on the right = anything audible (tooltip Mute/Unmute), toggles both channels.
- OUTPUT: header + "NN%", slider (disabled without a sink; right-click mutes), one row per available sink (glyph 󰓃/󰋋/󰂯/󰍹, bold = default; click sets default via
  `omarchy-audio-output-set-default`). INPUT (only with a source): slider, live peak meter bar, source rows. SOURCES (only with playback streams): per-app row with mute
  icon, label (MPRIS-matched), NN%, slider to 150 %.
- Keys: `j/k` header → output slider → sinks → input slider → sources → streams; `h/l` ±5 % on the focused slider/stream; `Enter` mute (slider) / set default (row) / mute (stream);
  `m` mute focused. Snapshots refresh 75 ms after PipeWire changes; sink availability polled every 5 s.

**Bluetooth panel (`shell/plugins/panels/bluetooth/Panel.qml`, `Model.js`, `bin/omarchy-bluetooth-power`, `omarchy-bluetooth-device`)**
- Widget hidden when `Bluetooth.defaultAdapter` is null (the VM). Icon 󰂲 off / 󰂯 on / 󰂱 connected; right click toggles radio (rfkill soft block via
  `omarchy-bluetooth-power on|off`). Hotkey `Super+Ctrl+B`; IPC `toggleBluetooth`.
- Hero: "Bluetooth" + "NO ADAPTER" / "TURNED OFF" / rotating phrases ("UNTANGLING WIRES", …); power ToggleSwitch (hidden without adapter).
- Sections CONNECTED (above scroll), PAIRED, AVAILABLE (only while discovering); rows show name, status (battery %, Connecting…, Disconnecting…, Forgetting…), forget button
  on hover/cursor; left click connect/disconnect/pair, right click disconnect or forget; `x` forgets. Empty text: "No Bluetooth adapter" / "Turn Bluetooth on to scan" /
  "Scanning for devices…". Discovery starts while open, stops ≤3 s after close (bounded retries). Pending actions time out after 20 s. Connecting an audio device switches
  the default sink to it (8 × 500 ms retries).

**Display / monitor panel (`shell/plugins/panels/monitor/Panel.qml`, `Model.js`, `bin/omarchy-monitor-state`, `omarchy-hyprland-monitor-scaling`, `omarchy-display-text-size`)**
- Bar icon 󰍹 (󰍺 with >1 screen); wheel adjusts brightness when available. Hotkey `Super+Ctrl+D`. IPC `brightness <pct>`, `state` (JSON).
- Hero "Display" + brightness mood ("NIGHT OWL" … "SUN BLAST") or "FIXED BRIGHTNESS" when no backlight/DDC (the VM: monitor `Virtual-1`).
- BRIGHTNESS (only when available): slider 1–100 with live %, debounced 180 ms, `h/l` ±5.
- TEXT SIZE: header shows "<px>px"; 7-notch slider over stops 9,10,11,12,14,16,20 → `omarchy-display-text-size <px>` (shell base-size in `~/.config/omarchy/shell.toml`
  + GTK text-scaling + terminal pt); the whole shell reflows live; `h/l` steps one notch; hover is suppressed 300 ms during reflow.
- SCALE: pills from presets 1, 1.25, 1.6, 2, 3, 4 filtered to the "clean" scales for the focused mode (labels like "1x", "1.25x"; duplicates collapsed); active pill =
  current scale; click → `omarchy-hyprland-monitor-scaling <s>` (focused monitor); monitor name shown at right only with >1 enabled displays.
- DISPLAYS (only with >1 display): rows "<name> · focused" with ✓ when enabled; click toggles `hyprctl keyword monitor <name>,disable|preferred,auto,auto`; the last enabled
  display cannot be disabled (row dimmed to 45 %).
- Keys: `j/k` brightness → textsize → scale → monitors; `h/l` adjusts brightness / text size / walks scale pills; `Enter` applies scale or toggles display. Polls state every 5 s.

**Power panel (`shell/plugins/panels/power/Panel.qml`, `Model.js`, `bin/omarchy-battery-status`, `omarchy-powerprofiles-list|set`, `omarchy-system-stats`)**
- Widget hidden without a battery (`UPower.displayDevice.isPresent`); opening via IPC/hotkey closes itself immediately. Hotkey `Super+Ctrl+P`. IPC `togglePercentage`.
- With a battery: icon by level/charging, optional "NN% " prefix (right click toggles, persisted as `showPercentage` in shell.json); hero "Battery" + rotating phrases
  ("PUMPING POWER"… charging / "SLURPING POWER"… on battery) or "FULLY CHARGED" / "THRESHOLD"; big percentage; progress bar (pulses while charging); stats (Battery size,
  Charge cycles, Time left / Time to full / Charge limit, Discharging / Charging / Battery state); POWER PROFILE pills (power-saver 󰌪, balanced 󰊚, performance 󰓅; active filled;
  click → `omarchy-powerprofiles-set battery|ac <p>`); `h/l`/`j/k` walk pills, `Enter` applies.

**Clock / calendar panel (`shell/plugins/panels/clock/BarWidget.qml`, `Panel.qml`, `Model.js`)**
- Bar label from `format` (`dddd HH:mm` default; `ww` = ISO week); left click opens calendar; right click cycles formats through a fixed ring
  (`dddd HH:mm`, `dddd h:mm AP`, `dddd HH:mm:ss`, `dddd h:mm:ss AP`, `HH:mm`, `h:mm AP`, `ddd d MMM HH:mm`, `ddd d MMM h:mm AP`, `d MMMM 'W'ww yyyy`, `yyyy-MM-dd HH:mm`,
  + configured alt) and persists to shell.json (tooltip "Right-click to toggle format"); middle click opens `omarchy-menu-timezone`. Hotkey `Super+Ctrl+Alt+D`.
  IPC `cycleFormat`, `toggleWeekStart`, `refresh`.
- Panel (centred on bar, 560 wide): hero "󰃭 <Month d>" (click returns to today when browsing another month; tooltip "Back to today"); year rail "<yyyy> ──── NN%"
  (double-tap → BORN / LIVE TO fields; `Tab` swaps, `Enter` commits, `Esc` cancels; invalid → unset); LIFE rail appears when a valid birth year is set (tooltip "Memento Mori";
  double-tap hides it); month grid with week-number gutter, "W" heading toggles week start (tooltip "Start weeks on Sunday/Monday", persisted `weekStartDay`), today outlined
  bold, weekends dimmed, out-of-month days faint; always six rows; month label "MONTH YYYY" with ‹ › chevrons (tooltips Previous/Next month); wheel over grid steps months.
- Keys: `h/l` month, `j/k` year, `[`/`]` month, `{`/`}` year, `t` today, `w` week start, `Enter` today, `Esc` close.

**Weather panel (`shell/plugins/panels/weather/BarWidget.qml`, `Panel.qml`, `Model.js`, `bin/omarchy-weather-location`)**
- Bar pill shows the condition glyph; hidden until the first successful fetch (wttr.in / open-meteo → NET). Left click panel, right click `omarchy-notification-send
  "$(omarchy-weather-status)"`, middle click refresh. IPC `edit` opens the panel in location-edit mode.
- Panel (centred, 480 wide): big glyph + temperature + °C/°F (unit from setting / reported country / locale), " <LOCATION>" (click → edit), FEELS / WIND / HUMID,
  "Fetching forecast…" while empty, divider, three forecast cells (icon, DAY, hi° lo°).
- Location editor: TextField "Search city" (prefilled with configured name, selected); geocoding suggestions after 2+ chars (300 ms debounce, open-meteo), `Up/Down` walk,
  `Enter` commits (typed name if no suggestion), click a suggestion; ✕ clears back to IP auto-detect; spinner while saving; `Esc` cancels. Persists via
  `omarchy-weather-location --set|--clear` to `~/.local/state/omarchy/settings/weather.json` (watched). Refresh every `refreshMinutes` (15).

**Speed tests and Wi-Fi QR (`shell/plugins/panels/speedtest`, `disk-speedtest`, `wifiqr`, `shell/Ui/SpeedTestOverlay.qml`)**
- `omarchy.speedtest`: summoned from the network panel's gauge button or Menu → Trigger → Speed Test → Network Speed Test. Title = connection ("ETHERNET"/SSID via
  `omarchy-network-status`), DOWNLOAD then UPLOAD dials (Mbps), each phase 5 s via `omarchy-network-speedtest down|up` (fast.com URLs via curl); errors: "No active network
  interface", "curl is required", "Speed test failed"; `Run Again` tooltip "Measure again via fast.com"; dismiss kills the workers.
- `omarchy.disk-speedtest`: Menu → Trigger → Speed Test → Disk Speed Test. Title = disk model, READ then WRITE dials (MB/s), `omarchy-disk-speedtest` (8 s per phase,
  4×256 MB temp files in `~/.cache/omarchy`, cleaned up); scale stops 500…15000.
- `omarchy.wifiqr`: network panel QR button, Setup → Network → QR Code (row hidden unless on Wi-Fi), IPC `omarchy.network showQr`. Dark scrim, "<SSID>" title,
  white QR canvas, "Generating QR code…", "Scan to join this network", "Show password" (click → `omarchy-network-password`, reveals or "Could not read the Wi-Fi password");
  error text from `omarchy-network-qr` (e.g. no Wi-Fi, enterprise) or "Could not generate the Wi-Fi QR code"; `Esc`/scrim closes and wipes the password from memory.

**Tailscale and Dropbox panels (not in the default bar; `shell/plugins/panels/tailscale`, `dropbox`)**
- Tailscale: icon = 3×3 dot mark (crossed when down, "!" badge when login needed); left panel, right toggle, middle refresh. Panel: hero (self name or "Tailscale",
  "Tailscale is disconnected" / rotating phrases, ToggleSwitch when CLI installed), status/error line, "Tailscale CLI is not installed or not on PATH." row when missing,
  CONNECTIONS (accounts; "Authorize Tailscale operator" row → `pkexec tailscale set --operator=$USER`), EXIT NODES (+ "Choose Mullvad region" search list), MACHINES
  (peer rows with send-file 󰒊 and copy 󰆏 → popup Name / DNS / IPv6 / IP). Keys `t` toggle, `c/n/d` copy IP/name/DNS, `s` send file. Refresh every 30 s (setting 5–3600).
- Dropbox: diamond icon; left panel, right refresh, middle login. Panel: "Login to Dropbox" row (or "Dropbox CLI is not installed" / "Install Dropbox from the service menu"),
  when authenticated: hero with pause/resume switch ("Syncing paused" / rotating phrases), "Stored X of Y", RECENT FILES rows (open in Nautilus). Keys `r` refresh, `l` login, `p` pause.

**Agents panel (`shell/plugins/agents/Panel.qml`, `Main.qml`, `Agent.qml`, `README.md`)**
- Icon 󱚣, hidden until a usage record exists under `~/.local/state/omarchy/agents/usage/` (written by `omarchy-agent-usage-update`, run every 900 s and on open/`r`).
  Left panel, right `omarchy-agent --pick`, middle next provider. IPC `refresh`, `next`.
- Panel: hero (provider mark or glyph, provider name, plan/status), "No AI coding subscriptions found.\nAgents show up here once you've used them." when empty, provider
  chips when >1, red status card (auth help), BALANCE (prepaid: "Prepaid credits", meter, "$x spent of $y funded · estimated"), LIMITS (title, %, meter, "Resets in 2h 5m"),
  TOKENS BY DAY (7 rows, Today bold, tooltip with prompts/sessions), TOKENS BY MODEL (top 4, tooltip in/out/cache split), footer "Merged from N devices" when syncing.
  Keys `h/l` provider, `j/k` scroll, `Enter`/`r` refresh.

**Dev gallery (`shell/plugins/dev-gallery/GalleryPanel.qml`)**
- `omarchy-shell shell summon omarchy.dev-gallery '{}'` (or `omarchy dev ui-preview [section]`). Floating window "Omarchy shell – dev gallery" 720×760 (min 560×520)
  with sections: Conventions, Typography (every `Style.font.*` token + theme tokens), PanelSectionHeader, PanelSeparator, CursorSurface (3 rows), Button (idle / active /
  icon only / icon+active / bordered+focusable), ButtonGroup (top/right/bottom/left), PanelActionButton (default / urgent / disabled / focusable), PanelToolTip ("hover me"),
  Slider (demo volume), TextField (plain + password), NumberField ("Auto-refresh interval (minutes)" 1–1440), Toggle (two rows, one forced square), ToggleSwitch (one busy),
  Dropdown ("Center anchor": omarchy.clock/weather/power), SearchableDropdown ("Add widget", 14 options with descriptions), Composed wifi-style rows.
- Keys: `j/k` walk sections, `h/l` within rows / adjust slider, `Enter` activate (toggle, open dropdown, focus field), `PgUp/PgDn/Home/End` scroll, `Esc` closes (via shell.hide).

**App library / search (`shell/services/AppLibrary.qml`, `AppSearch.js`, `hidden-entries.sh`, `default/omarchy/launcher.hides`)**
- Apps submenu rows come from `DesktopEntries`, minus `NoDisplay`, minus ids in `launcher.hides`, minus entries `hidden-entries.sh` reports as `Hidden=true` /
  `OnlyShowIn`/`NotShowIn` mismatch for the current desktop. Sorted alphabetically; search scores prefix-of-name > prefix-of-id > contains > comment/keywords > acronym (≤5 chars).
- Launch: `uwsm-app -- gtk-launch <id>.desktop`; if no new window appears within 2 s an OSD "Launching <Name>…" shows until a window appears (max 15 s).
  Remove: `omarchy-remove-launcher-entry <id> <name>` after the ConfirmDialog. Icons resolved through a live-rescanned icon index (new installs appear without restart).

## Observations

- The VM is wired-only, has no audio, Bluetooth, battery, backlight or second monitor. Consequences for this area: the **bluetooth, power and agents bar icons are
  absent** (self-hiding widgets), the **weather pill appears only after a successful network fetch**, the network panel shows **no Wi-Fi radio switch, no QR button, no band
  section and no network list**, the monitor panel shows **"FIXED BRIGHTNESS" and no BRIGHTNESS slider**, and the audio panel most likely has **no sink** (icon text empty,
  output slider disabled, no device rows) unless PipeWire exposes a dummy sink — the driver must accept either.
- `Super+Ctrl+1..9` counts only widgets that own a panel; on the VM the visible right-section panels are network, audio, monitor (tray excluded, hidden widgets may or may
  not count). The driver should accept whichever panel opens for `Super+Ctrl+1` and verify `Tab` moves right, `Shift+Tab` left.
- Ping in the network panel uses ICMP to 1.1.1.1 and the gateway; QEMU user-mode NAT drops ICMP, so **"Ping: Timeout" and "Packet Loss: 100%" in red is the expected
  wired-VM reading**, not a failure. Receiving/Sending/Downloaded/Uploaded, IP `10.0.2.15` and Gateway `10.0.2.2` are real.
- DNS pills run `omarchy-dns <Provider>` as root. HEAD ships `etc/sudoers.d/omarchy-dns` (passwordless); if the minted 4.0.2 disk lacks the rule the command falls back to
  `pkexec` and the **polkit dialog appears**. Both outcomes are valid; the test records which one happened. After a change the panel closes; reopening shows the new active pill.
  The Custom pill opens a floating terminal that prompts for servers (empty input → "Error: No DNS servers provided." exit 1).
- The Omarchy Menu opens on the *previous* guard evaluation and re-runs guards on every open; a row can lag one open behind reality (e.g. ✓ moving after a default change).
  Drivers should close and reopen once before judging a ✓/dim state.
- Menu `Esc` semantics: with a filter typed, the first `Esc` only clears the filter; the second closes. Same in the clipboard and emoji pickers and (filterable) image picker.
  `Backspace`/`Left` with an empty filter go *back* a submenu (`Backspace` on root does nothing). Click on the dark scrim closes.
- Menu rows never highlight until the pointer actually moves over the card (PointerMoveGate) — a menu opened with the mouse already resting over it shows no hover cursor
  until the mouse moves. Keyboard cursor always starts on the first selectable row.
- Disabled (already-installed) Install rows are 40 % opacity with " ✓", the cursor jumps over them, `Enter`/click do nothing; they are omitted from search results.
  On the stock VM: Install → Terminal → Alacritty; Install → Browser → none dimmed except what the ISO ships (Chromium is not in the Install list).
- `Super+Ctrl+H` (hardware route) opens `trigger.hardware`, whose every child is laptop/touch guarded → on the VM the card shows the empty state "Nothing here yet"
  and the Trigger submenu hides its Hardware row. Likewise Trigger → Toggle hides "Battery Percentage", System hides "Hibernate", Setup → Network hides "QR Code",
  Setup → Security hides "Fingerprint", Setup hides "Reset Computer" unless `/` is btrfs (it is on a stock Omarchy install → visible).
- Menu actions that need a terminal run in a floating `org.omarchy.terminal` window with the Omarchy logo and a "Done/Failed" prompt (`omarchy-launch-floating-terminal-with-presentation`);
  those flows belong to other reviewers except where the menu itself is under test.
- dmenu-mode contract (`omarchy-menu-select`/`-input`): `Enter` returns the label (plus `\t<subtext>` when the row had one), `Esc`/scrim → exit 1 and nothing printed.
  Keybindings menu (`Super+K`) is select mode at width 800: rows read "SUPER + RETURN → Terminal"; `Enter` dispatches the binding (so picking "Terminal" opens a terminal).
- Clipboard: history is only recorded while the shell's two `wl-paste --watch` watchers run; text selected in a terminal is *not* copied automatically (use `wl-copy` or the
  terminal's copy). `wl-copy --sensitive` entries are skipped. The shell records a snapshot of whatever is on the clipboard at start (empty after boot). Paste from the
  picker goes through `wtype Shift+Insert`, so the target must be a window that accepts `Shift+Insert` (terminals do).
- Emoji insert copies the emoji as a *sensitive* clipboard offer and pastes with `Shift+Insert`; the emoji does not show up in clipboard history and the previous
  clipboard content is not restored (it is replaced while the foreground `wl-copy` lives ~0.35 s, then the clipboard is cleared).
- Image picker Enter writes a selection file and the caller applies it: theme switch runs `omarchy-theme-set` (several seconds; bar/menu colours change), background switch
  swaps the wallpaper. The picker itself closes as soon as the selection is written. Cancelling (`Esc`/scrim) leaves everything untouched. Theme/background changes persist on
  the disk; tests must restore (re-pick the original) or end with `stop`.
- Monitor panel SCALE pills depend on the VM's mode (e.g. 1920×1080 → all six presets clean; 1280×800 → some collapse). "1x" is active on a stock VM. Changing scale
  re-lays the entire desktop (bar taller, fonts bigger); restore with the "1x" pill. Text-size changes rewrite `~/.config/omarchy/shell.toml` and reflow the shell live; restore
  to 12px. Both persist on disk.
- Clock right-click format cycling and the "W" week-start toggle write to `~/.config/omarchy/shell.json` (`omarchy.clock` entry) — persistent; cycle back or accept that the
  disk is discarded on `stop`.
- Polkit: the dialog is a full-screen overlay; the terminal that ran `pkexec` is hidden behind the scrim until the dialog closes. Message pill for `pkexec true` reads
  "Authorize running '/usr/bin/true'". After a wrong password the same request stays open (polkit allows retries); `Esc` cancels → `pkexec` exit 126.
- Weather, speed test (fast.com), geocoding and the Learn/webapp rows need outbound HTTP — tag NET. Network speed test lasts ~10 s (5 s down + 5 s up); disk speed test ~16–20 s
  and writes/removes ~1 GB in `~/.cache/omarchy`.
- Tailscale/Dropbox panels are absent by default; Setup → Plugins → Enable Plugin lists them (select-mode picker with the plugin id as row subtext). Enabling adds the icon
  immediately; both then show their "CLI is not installed" negative state on the VM. Disable via Setup → Plugins → Disable Plugin.
- Agents: the icon appears only after `omarchy-agent-usage-update` finds usage. On a pristine VM none exists; `omarchy-shell omarchy.agents open` still opens the panel with
  the "No AI coding subscriptions found." text (anchored where the collapsed slot is), or does nothing — either is acceptable, a crash is not.
- The dev gallery is the only place where Dropdown, SearchableDropdown, NumberField, MultiSelect-adjacent controls and the raw Toggle/TextField are exercised outside the bar
  settings form; it is a floating (tiled) window, not a layer, so `Esc` inside it closes via `shell.hide`.

## Proposed tests

### menu-open-and-close-hotkey-and-mouse   [VM-OK]
description: The Omarchy Menu opens from Super+Space or the bar's logo icon and closes again from Escape, a second click, or a click on the scrim, leaving the desktop untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space.
  ** A dark scrim covers the screen and a narrow card sits in the centre with the greyed header "Go…" and the rows Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System. Apps is highlighted.
  * Press Down three times, then Up once. The highlight must land on Style, then on Trigger.
  * Press Escape. Menu and scrim vanish; the desktop is exactly as before.
  * Using the mouse, click the leftmost icon in the top bar (the Omarchy logo). The root menu opens.
  * Click the same spot again. The menu must close (the scrim swallows the click, which also counts as closing).
  * Click the logo once more, then click on the dark scrim far from the card. The menu closes.
  * Right-click the logo icon. A terminal window opens; type exit and press Enter to close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The logo is at about x=0.01, y=0.01 on a top bar; hover and screenshot first to confirm the position.
  * ./client-with-image is useful for every keypress here; the card fades in and out over ~140 ms.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with all ten rows and the "Go…" header, and one with the highlight on Trigger
  ** Screenshots of the desktop after Escape, after the second icon click, and after the scrim click (no menu, no scrim)
  ** Screenshot of a terminal window after the right click; the mouse was used for the icon steps
  * If unsuccessful
  ** Screenshot of what is on screen after the failing hotkey or click; the tail of ./client get-serial
covers: shell/plugins/menu/Menu.qml (openRoute, keyCatcher, scrim MouseArea), shell/plugins/menu/BarWidget.qml, default/hypr/bindings/utilities.lua

### menu-hotkey-routes-and-hidden-rows   [VM-OK]
description: The route hotkeys land directly on their submenu, and rows guarded on hardware the VM lacks (hibernate, laptop toggles, webcam) are hidden — a fully guarded submenu shows "Nothing here yet" rather than breaking.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape.
  ** Header "System…" with rows Screensaver, Lock, Suspend, Logout, Reboot, Shutdown and NO Hibernate. Do not select anything.
  * Press Escape, then Super+Ctrl+C.
  ** Header "Capture…" with Screenshot, Screenrecord, Text, QR Code, Color and NO "Stop Screenrecording".
  * Press Down once and Enter (Screenrecord). The card widens and lists "With no audio", "With desktop audio", "With desktop + microphone audio" — no webcam row. Press Escape.
  * Press Super+Ctrl+O.
  ** Header "Toggle…" with Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio and NO "Battery Percentage". Press Escape.
  * Press Super+Space, Down twice (Trigger), Enter: the rows are Emoji, Reminder, Capture, Transcode, Share, Toggle, Speed Test — NO "Hardware" row. Press Escape.
  * Press Super+Ctrl+H.
  ** The card opens with header "Hardware…" and, instead of rows, the empty-state glyph with "Nothing here yet". Press Escape; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Guards are re-evaluated on every open and the menu paints the previous answer first; if a row looks wrong, close and reopen once before reporting.
  * If a "Hardware" or "Hibernate" row IS present, report exactly which children it lists — that is a finding about the VM, not a driver error.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of System… (six rows, no Hibernate), Capture… and the three-row Screenrecord… card, Toggle… without Battery Percentage, Trigger… without Hardware, and "Hardware…" showing "Nothing here yet"
  * If unsuccessful
  ** Screenshot of the unexpected row set or of a blank/crashed card
covers: default/omarchy/omarchy-menu.jsonc (system.*, trigger.capture.*, trigger.toggle.*, trigger.hardware.*), shell/plugins/menu/MenuModel.js (isVisible, guardScript, resolveRoute), shell/plugins/menu/Menu.qml (empty-state Column, cardWidth), bin/omarchy-hibernation-available

### menu-navigate-submenus-keyboard-and-mouse   [VM-OK]
description: Drilling into submenus and back works both from the keyboard (Enter/Right in, Backspace/Left out) and from the mouse (click in, scrim click out), with the current default marked by a check.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, Down four times (Setup), Enter. Header "Setup…".
  * Press Down until "Defaults" is highlighted and press Right. Header "Defaults…" with Agent, Browser, Terminal, Editor.
  * Press Down twice and Enter on Terminal.
  ** Header reads "Default Terminal…" (a title different from the row label); rows Alacritty, Foot, Ghostty, Kitty; exactly one row ends with " ✓".
  * Press Left (back to "Defaults…"), then Backspace twice (back to "Go…"). Press Escape.
  * Press Super+Space. Using the mouse only: move onto the "Style" row (move a few pixels once over it) — it highlights — and click it. Header "Style…".
  * Click "Menu Bar", then click "Position". Rows Top, Bottom, Left, Right. Do not click any of them.
  * Click on the dark scrim far from the card. The menu closes; the bar is still at the top.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Backspace and Left only go back while no search text is typed.
  * A pointer that is already resting over the card when the menu opens does not highlight anything until it moves (by design); nudge the mouse.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Setup…, Defaults…, Default Terminal… with the single ✓ row, and the return to Defaults… and Go…
  ** Screenshots of Style highlighted by hover, Menu Bar…, Position…, and the desktop after the scrim click; the mouse was used for the second half
  * If unsuccessful
  ** Screenshot showing where navigation diverged (wrong header or stuck highlight)
covers: Menu.qml (setActiveMenu, goBack, activateIndex, row MouseArea, selectFromPointer), MenuModel.js (labelFor checked), default/omarchy/omarchy-menu.jsonc (setup.default.terminal.*), shell/Ui/PointerMoveGate.qml

### menu-search-filter-and-no-match   [VM-OK]
description: Typing in the menu searches the whole tree (drill-down rows show their parent path under a divider), a nonsense query shows the empty state, and Escape clears the filter before it closes the menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and type: theme
  ** The header now shows "theme" in full brightness; rows include Theme entries from Style, Install › Style and Remove; deeper rows carry a grey path line under the label and a thin divider separates root-level matches from drill-down matches.
  * Press Backspace five times. The filter empties and the root list returns.
  * Type: zzqx
  ** The list is replaced by a large glyph and "No matches for “zzqx”".
  * Press Escape once. The filter clears and the root menu is shown again (menu still open).
  * Press Escape again. The menu closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Escape is two-stage whenever a filter is typed: first clears, second closes. Do not report the first Escape "not closing" as a bug.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "theme" results with path lines and the divider; the "No matches for “zzqx”" state; the root menu after the first Escape; the desktop after the second
  * If unsuccessful
  ** Screenshot of the results list that did not match, or the menu closing on the first Escape
covers: Menu.qml (setFilter, rebuildDisplay search branch, keyCatcher Escape), MenuModel.js (matchesQuery, searchScore)

### menu-apps-search-and-launch   [VM-OK]
description: The Apps submenu lists installed applications with icons, filters as you type, and launches the chosen app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space.
  ** Header "Apps…"; an alphabetical list with square image icons; the last visible row is clipped, showing there is more below.
  * Press PageDown twice, then PageUp twice. The list scrolls and returns to the top.
  * Type: calc
  ** Only entries matching "calc" remain (a calculator such as "Omacalc" is expected on a stock install).
  * Press Enter. The menu closes and the application window opens within a few seconds (a "Launching …" toast may appear first if it is slow).
  * Close the launched application with Super+W. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If "calc" matches nothing, filter for "term" and launch the terminal instead; say which app you launched.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Apps list with icons; the filtered list; the launched window; the restored desktop
  * If unsuccessful
  ** Screenshot of an empty Apps list or of the desktop with no window after Enter; ./client get-serial tail
covers: Menu.qml (mergeAppRows, provider apps), shell/services/AppLibrary.qml (launch, beginLaunchFeedback), shell/services/AppSearch.js, test/shell.d/app-search-test.sh

### menu-apps-uninstall-confirm-cancel   [VM-OK]
description: Pressing Delete on an app row asks for confirmation with a destructive dialog, and every cancel path (Cancel button, Escape, click outside) leaves the app installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space and type: term
  * With a terminal application row highlighted, press Delete.
  ** A small dialog appears over the menu: "Do you want to uninstall <App>?" with [Cancel] and a red [Uninstall]; Uninstall is pre-selected.
  * Press Left (or Tab): the selection moves to Cancel. Press Enter. The dialog closes and the app row is still listed.
  * Press Delete again, then Escape. The dialog closes; the row is still there.
  * Press Delete again, then click on the dark area outside the dialog card. The dialog closes; the row is still there.
  * Press Escape twice to close the menu. Never confirm Uninstall.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Delete only does something on app rows (the Apps submenu).
  * If the app row disappears at any point, stop and report it as a destructive failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the dialog with Uninstall pre-selected; one with Cancel selected; the list with the app row still present after each cancel path
  * If unsuccessful
  ** Screenshot of a dialog that did not appear or did not close, or of the app row gone
covers: shell/Ui/ConfirmDialog.qml, Menu.qml (requestDeleteSelected, cancelDelete, confirmDelete)

### menu-install-remove-guards-reflect-installed-software   [VM-OK]
description: Install rows for software already on the machine stay listed but dimmed, checked and unselectable, while Remove hides submenus with nothing to remove — the two sides of the same guard convention.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Terminal (Down to Install, Enter, Down to Terminal, Enter).
  ** Rows Alacritty, Foot, Ghostty, Kitty; "Alacritty ✓" is dimmed to about 40 % (it is installed).
  * Press Down and Up through the list: the highlight must skip the dimmed row.
  * Move the mouse over the dimmed row (arrow pointer, no highlight) and click it: nothing happens, the menu stays open and no installer window appears.
  * Press Backspace twice (back to Go…), Down six times (Remove), Enter.
  ** Rows include Package and Theme; "Browser" and "Gaming" must be ABSENT (no third-party browser or game is installed). Note every row you see.
  * Press Backspace and type: chrome
  ** Only "Chrome" under Install › Browser (undimmed) appears; there is no Remove › Browser › Chrome result.
  * Press Escape twice. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Dimmed rows are also omitted from search results, so searching "alacritty" shows the Setup › Defaults row but not the Install row.
  * Never press Enter on an undimmed Install/Remove row — they start installers.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Install › Terminal with the dimmed "Alacritty ✓" and the cursor on a neighbour; the Remove submenu without Browser/Gaming; the "chrome" search showing only the Install row
  * If unsuccessful
  ** Screenshot of the dimmed row selectable/undimmed, an installer terminal opening, or a Remove submenu with no installed children
covers: MenuModel.js (isDisabled, labelFor, matchesQuery, isVisible), Menu.qml (rowSelectable, nextSelectable, disabled row MouseArea), default/omarchy/omarchy-menu.jsonc (install.*, remove.*), docs/menu.md Guards, test/shell.d/menu-test.sh

### menu-default-editor-check-moves-and-restores   [VM-OK]
description: Changing a default through Setup → Defaults moves the ✓ to the new choice on the next open and can be moved back the same way.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Defaults → Editor. Note the row with " ✓" (expected Neovim).
  * Highlight "Vim" and press Enter. The menu closes.
  * Press Super+Space → Setup → Defaults → Editor again.
  ** The ✓ is now on Vim and gone from Neovim.
  ** If the ✓ has not moved yet, press Escape, reopen once more and report that the marker lagged one open.
  * Highlight the original row (Neovim) and press Enter.
  * Reopen Setup → Defaults → Editor: the ✓ is back on Neovim. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu paints the previous guard answers first and re-evaluates on each open; one extra open is normal, more is a finding.
  * If picking a row shows an error notification (editor not installed), pick another installed one and say so.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Editor submenu before the change, after it (✓ on Vim), and after the restore (✓ on Neovim)
  * If unsuccessful
  ** Screenshot of the ✓ never moving or of two rows checked
covers: MenuModel.js (GUARD_READERS, guardPrelude, labelFor), Menu.qml (evaluateGuards on open), default/omarchy/omarchy-menu.jsonc (setup.default.editor.*), test/shell.d/menu-guards-test.sh

### menu-font-provider-switch-and-restore   [VM-OK]
description: Style → Font lists the installed monospace fonts with a check on the current one; picking another changes the system font and picking the original restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter to open a terminal and leave it visible.
  * Press Super+Space → Style → Font.
  ** Header "Font…"; a wide card of font family names; exactly one row carries a "✓" icon (expected "CaskaydiaMono Nerd Font"). Note it.
  * Highlight a different font (e.g. "JetBrainsMono Nerd Font") and press Enter.
  ** The menu closes; within a few seconds the glyph shapes in the terminal and the bar change.
  * Reopen Style → Font: the ✓ is now on the font you picked.
  * Highlight the original font and press Enter. Terminal and bar glyphs revert.
  * Reopen Style → Font once more: the ✓ is back on the original. Press Escape, then type exit in the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare the same terminal prompt line before and after; the change can be subtle, so zoom on the screenshot.
  * The font list is regenerated each time the submenu is entered, so a font that failed to apply simply keeps the ✓ where it was.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Font… with the ✓ row; terminal + bar before and after the switch showing different glyph shapes; Font… with the ✓ moved; final Font… and terminal restored
  * If unsuccessful
  ** Screenshot showing no font change or an error notification
covers: Menu.qml (providers.fonts, mergeProviderRows, invalidateVolatileProvider), bin/omarchy-font-list, bin/omarchy-font-set

### menu-bar-position-and-transparency   [VM-OK]
description: Style → Menu Bar moves the bar to the left edge (panels follow it) and back to the top, and toggles the bar background transparent and opaque again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Style → Menu Bar → Position → Left.
  ** The menu closes and the bar re-appears as a vertical strip on the left edge; the top edge is empty.
  * Press Super+Ctrl+W: the network panel opens beside the left bar (not under the top edge). Press Escape.
  * Press Super+Space → Style → Menu Bar → Position → Top. The bar is back on top as a horizontal strip.
  * Screenshot the bar, then press Super+Space → Style → Menu Bar → Transparency.
  ** The bar background becomes transparent; the wallpaper shows through behind the clock text.
  * Repeat Style → Menu Bar → Transparency. The opaque background returns; the bar looks exactly as in the first screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * With the bar on the left, the menu logo is the topmost icon of the strip and Super+Space still works.
  * Compare the strip behind the clock text to judge transparency.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the vertical left bar; the network panel anchored beside it; the bar back on top; the transparent bar; the opaque bar again
  * If unsuccessful
  ** Screenshot of the bar in the wrong place, a mis-anchored panel, or no transparency change
covers: default/omarchy/omarchy-menu.jsonc (style.bar.position.*, style.bar.transparency), shell/Ui/KeyboardPanel.qml (cardOrigin for left bars), test/acceptance.d/menu-test.sh

### menu-theme-switch-image-picker   [VM-OK] [SLOW]
description: Super+Shift+Ctrl+Space opens the theme carousel; picking a theme recolours the desktop, and filtering back to the original theme restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Note the bar and menu colours. Press Super+Shift+Ctrl+Space.
  ** A dark overlay with a carousel of skewed image slices; the large centre image is the current theme's preview with its name in Title Case under it (e.g. "Tokyo Night").
  * Press Right twice. Each press slides a new preview into the centre and the label changes.
  * Press Enter.
  ** The overlay closes; within ~10–15 s the bar, menu and terminal colours change to the new theme.
  * Press Super+Space to see the recoloured menu, then Escape.
  * Press Super+Shift+Ctrl+Space, type the first letters of the ORIGINAL theme (e.g. tok): the query appears under the label and the carousel narrows. Press Enter.
  ** Colours return to the original theme; the desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Applying a theme runs several scripts; take a screenshot every 3–5 s for up to 15 s before judging.
  * Left/Right wrap around the carousel; Escape while a filter is typed only clears the filter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the carousel with the current theme centred and labelled; after two Right presses; the recoloured desktop and menu; the filtered carousel; the restored desktop
  * If unsuccessful
  ** Screenshot of the carousel not opening or the colours not changing; ./client get-serial tail
covers: shell/plugins/image-picker/ImagePicker.qml (filterable, labels, selectAdjacent, applySelected), bin/omarchy-theme-switcher, bin/omarchy-menu-images, default/omarchy/omarchy-menu.jsonc (style.theme)

### menu-background-switcher-apply-and-cancel   [VM-OK]
description: Super+Ctrl+Space opens the background carousel; Escape and a scrim click leave the wallpaper alone, clicking a slice selects it and clicking the centre applies it, and the original can be re-applied.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the wallpaper. Press Super+Ctrl+Space.
  ** The carousel shows the current theme's backgrounds with the current wallpaper centred; no labels and no filter.
  * Press Right once, then Escape. The overlay closes and the wallpaper is unchanged.
  * Press Super+Ctrl+Space, Right once, then click on the dark scrim far from the carousel. Wallpaper unchanged.
  * Press Super+Ctrl+Space and click a side slice: it slides into the centre. Click the centred image.
  ** The overlay closes and the wallpaper changes to that image.
  * Press Super+Ctrl+Space, step to the original background with Left/Right and press Enter. The wallpaper is back to the first screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the theme ships a single background the carousel has one image; exercise the cancel paths and report it.
  * Use ./client-with-image after each click to see which slice is centred.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: carousel open; unchanged wallpaper after Escape and after the scrim click; changed wallpaper after clicking the centre; restored wallpaper
  * If unsuccessful
  ** Screenshot showing a wallpaper change on cancel, or no change on apply
covers: ImagePicker.qml (cancel, slice MouseArea select/apply), bin/omarchy-theme-bg-switcher, default/omarchy/omarchy-menu.jsonc (style.background)

### menu-keybindings-browser-super-k   [VM-OK]
description: Super+K shows every keybinding in a searchable list and Enter runs the chosen one; Escape leaves without running anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K.
  ** A wide card with header "Keybindings…" and rows shaped like "SUPER + RETURN → Terminal", chords aligned in one column; the first rows are Keybindings, Omarchy menu, Terminal.
  * Type: terminal
  ** The rows narrow to those mentioning terminal.
  * Highlight the "… → Terminal" row and press Enter.
  ** The card closes and a terminal window opens.
  * Type exit and press Enter to close it.
  * Press Super+K again, then Escape. The card closes and nothing is launched.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first open can take a couple of seconds while the list is built; screenshot again rather than retyping the hotkey.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Keybindings… list; the filtered list; the terminal after Enter; the desktop after Escape
  * If unsuccessful
  ** Screenshot of an empty or missing list, or no terminal after Enter
covers: bin/omarchy-menu-keybindings, bin/omarchy-menu-select, Menu.qml (openDmenu, rebuildDmenuDisplay, applyDmenuSelection), test/shell.d/keybindings-menu-test.sh

### menu-select-and-input-dmenu-contract   [VM-OK]
description: Scripts use the menu as a dmenu: a pick prints the chosen label, typed input prints the text, and Escape or a scrim click prints nothing and fails the command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal and type: omarchy-menu-select Format jpg png; echo "exit=$?"  then Enter.
  ** A small card "Format…" with rows jpg and png appears.
  * Press Down, then Enter. The terminal prints "png" and "exit=0".
  * Run the same command again (Up, Enter) and press Escape on the card. The terminal prints only "exit=1".
  * Type: omarchy-menu-input "Your name"; echo "exit=$?"  then Enter.
  ** A card with header "Your name…" and no rows.
  * Type: Prime Tester  and press Enter. The terminal prints "Prime Tester" and "exit=0".
  * Run the input command again and click on the dark scrim. The terminal prints only "exit=1".
  * Type exit and press Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * While the card is open the terminal cannot receive keys; everything typed goes to the card until it closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Format… and Your name… cards; the terminal showing png/exit=0, exit=1, Prime Tester/exit=0, exit=1
  * If unsuccessful
  ** Terminal screenshot with the wrong output or exit code, or a card that will not close
covers: bin/omarchy-menu-select, bin/omarchy-menu-input, Menu.qml (openDmenu, finishRequest, mode input), docs/menu.md "Select and input modes"

### menu-cli-routes-and-verbs   [VM-OK]
description: The omarchy-menu command resolves aliases to their submenu, falls back to the root for unknown routes, closes on request, and refuses unknown verbs with a clear message.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: omarchy-menu summon power-menu  and Enter.
  ** The menu opens on "System…" (the alias resolves). Press Escape.
  * Type: omarchy-menu summon settings  and Enter. It opens on "Setup…". Press Escape.
  * Type: omarchy-menu summon no-such-route  and Enter. It opens on the root "Go…". Press Escape.
  * Type: omarchy-menu summon root; sleep 3; omarchy-menu close  and Enter.
  ** The menu opens and closes by itself about three seconds later (type the whole line before Enter — the open menu takes the keyboard).
  * Type: omarchy-menu bogus; echo "exit=$?"  and Enter.
  ** The terminal prints "omarchy-menu: unknown verb 'bogus'. Try 'omarchy menu --help'." and "exit=2".
  * Type exit and press Enter. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot within a second of pressing Enter on the summon/close line to catch the menu before it closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of System…, Setup…, Go… for the three routes; the menu open and then gone for the timed close; the terminal with the unknown-verb message and exit=2
  * If unsuccessful
  ** Terminal output of the failing verb or a screenshot of the wrong submenu
covers: bin/omarchy-menu, MenuModel.js (resolveRoute), Menu.qml (openRoute, close), docs/menu.md "Driving the menu from the CLI"

### menu-user-extension-live-reload   [VM-OK]
description: A user extension file adds a working row to the menu without restarting the shell, a malformed extension is dropped silently while the shipped menu keeps working, and removing the file restores the stock menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal and type, then Enter:
  ** mkdir -p ~/.config/omarchy/extensions && printf '{\n  "hello": {"icon":"","label":"Hello Test","action":"omarchy-notification-send hi-from-menu"}\n}\n' > ~/.config/omarchy/extensions/omarchy-menu.jsonc
  * Press Super+Space. A new root row "Hello Test" appears after System.
  * Highlight it and press Enter. A notification "hi-from-menu" appears at the top right.
  * In the terminal type, then Enter: printf '{ "hello": {"label":"Broken"} // inline comment breaks the parser\n}\n' > ~/.config/omarchy/extensions/omarchy-menu.jsonc
  * Press Super+Space. "Hello Test" is gone and NO "Broken" row appears; the ten stock rows are all present. Press Escape.
  * In the terminal type, then Enter: rm ~/.config/omarchy/extensions/omarchy-menu.jsonc
  * Press Super+Space: the stock ten rows only. Press Escape; type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The file is watched; no refresh should be needed. If the row is missing after 5 s, type `omarchy-menu refresh` in the terminal and report that it was required.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with "Hello Test"; the notification; the root menu without Hello Test or Broken after the broken file; the stock menu after removal
  * If unsuccessful
  ** Screenshot of the row missing even after refresh, or a "Broken" row appearing; ./client get-serial tail
covers: Menu.qml (userMenuFile FileView, rebuildItemsFromSources), MenuModel.js (stripJsonc, parseMenuJsonc, mergeMenuSources), docs/menu.md "Load and merge"

### menu-timezone-list-filter-and-cancel   [VM-PARTIAL]
description: Update → Timezone shows every system timezone in a filterable list; cancelling leaves the clock unchanged (applying is skipped: it needs a privileged timedatectl the driver should not depend on).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Note the clock in the bar. Press Super+Space → Update → Timezone.
  ** A tall card "Set timezone…" listing timezones from Africa/Abidjan onward with a clipped last row.
  * Type: utc  — the list narrows to "UTC" (and Etc/UTC variants).
  * Press Down and Up: the highlight moves within the short list.
  * Press Escape. The card closes and the bar clock is unchanged.
  * Press Super+Space → Update → Timezone again and click on the scrim. The card closes; the clock is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list comes from `timedatectl list-timezones` and may take a second to appear.
  * Skipped here: pressing Enter on a zone (it runs sudo timedatectl without a terminal and may prompt or fail depending on the disk's sudoers).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the timezone list; the filtered "utc" list; the desktop after Escape and after the scrim click with the same clock
  * If unsuccessful
  ** Screenshot of an empty list or a card that will not close
covers: bin/omarchy-menu-timezone, bin/omarchy-menu-select (--width/--maxheight), default/omarchy/omarchy-menu.jsonc (update.timezone)

### menu-long-list-fold-and-wrap   [VM-OK]
description: A long submenu ends on a clipped row, fades at the edges when scrolled, and the cursor wraps from last to first and back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Development.
  ** Many rows (Ruby on Rails, Docker DB, JavaScript, Go, PHP, Python, Elixir, Zig, Rust, Java, .NET, OCaml, Clojure, Scala); the card is cut off mid-row at the bottom.
  * Press Down about eight times: the list scrolls and a fade appears at the top edge.
  * Keep pressing Down past the last row: the highlight wraps to the first row.
  * Press Up once: the highlight wraps to the last row.
  * Press PageUp: the highlight jumps six rows up.
  * Press Escape twice. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not press Enter on any row here — they start installers.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the folded list with a clipped last row; mid-scroll with the top fade; the highlight after wrapping to the first and to the last row
  * If unsuccessful
  ** Screenshot of the card growing off-screen or the cursor stuck at an end
covers: Menu.qml (foldedListHeight, revealCursor, select wrap, scroll scrims)

### menu-overlay-keys-do-not-leak   [VM-OK]
description: While the menu or a picker is open, typed keys go to the overlay and never to the window behind it, and focus returns to that window afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal and type (no Enter): echo before
  * Press Super+Space, type: setup  then press Escape twice.
  ** The terminal line still reads exactly "echo before".
  * Press Super+Ctrl+E (emoji picker), type: smile  then Escape twice. Terminal line unchanged.
  * Press Super+Ctrl+V (clipboard picker), type: abc  then Escape twice. Terminal line unchanged.
  * Type:  after  and press Enter. The terminal echoes "before after" — focus came back to it.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each picker's Escape is two-stage while a filter is typed (clear, then close) — hence two presses.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots showing "echo before" intact after each overlay, and the echoed "before after"
  * If unsuccessful
  ** Terminal showing leaked characters, or typing that goes nowhere after an overlay closes
covers: Menu.qml, Emojis.qml, Clipboard.qml (WlrKeyboardFocus.Exclusive, keyCatcher accepted events)

### menu-reminder-alias-runs-action   [VM-OK]
description: A hotkey whose route is an alias for a leaf action (Super+Ctrl+R → Set reminder) runs the action directly instead of opening an empty submenu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+R.
  ** No menu card titled "Set one…" appears; instead the reminder input flow starts (describe what appears).
  * Press Escape to cancel it. The desktop is as before.
  * Press Super+Space → Trigger → Reminder. Rows "Set one", "Show all", "Clear all".
  * Highlight "Show all" and press Enter. The menu closes and a notification about reminders appears (e.g. that there are none).
  * Wait for the notification to fade or dismiss it with Super+comma.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reminder UI itself is another test's subject; here only "alias → action, not empty submenu" is judged.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after Super+Ctrl+R showing the reminder input rather than a menu card; the Reminder submenu; the notification after Show all
  * If unsuccessful
  ** Screenshot of an empty "Set one…" card or nothing happening
covers: Menu.qml (openRoute action-alias branch), default/omarchy/omarchy-menu.jsonc (trigger.reminder.*), bin/omarchy-reminder

### menu-about-and-screensaver-actions   [VM-OK]
description: Root-level action rows run their program and close the menu: About opens the system-info window and System → Screensaver takes over the screen until a key is pressed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, Down eight times (About), Enter.
  ** The menu closes and an "About" window with the Omarchy logo and system information opens.
  * Press any key (or Super+W) to close it. The desktop is as before.
  * Press Super+Escape, then Enter on "Screensaver" (first row).
  ** The whole screen is taken over by the screensaver animation.
  * Press Space. The screensaver exits and the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the screensaver does not exit on a key, move the mouse, press Escape, then Super+W.
  * A notification "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" would mean the default terminal is unsupported — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the About window; a screensaver frame; the restored desktop
  * If unsuccessful
  ** Screenshot of the error notification or of the menu staying open
covers: Menu.qml (applySelected → runAction), bin/omarchy-launch-about, bin/omarchy-launch-screensaver, default/omarchy/omarchy-menu.jsonc (about, system.screensaver)

### clipboard-picker-pick-older-entry   [VM-OK]
description: The clipboard manager records successive copies newest first with a preview, pastes an older entry into the focused terminal, and moves it to the top without duplicating it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: printf alpha | wl-copy; sleep 1; printf bravo | wl-copy  and Enter.
  * Press Super+Ctrl+V.
  ** A wide card "Search clipboard…": a list on the left with "bravo" first and "alpha" second, and a preview pane on the right showing the highlighted entry's text.
  * Press Down. "alpha" is highlighted and the preview shows "alpha".
  * Press Enter. The picker closes and "alpha" appears at the terminal prompt (pasted).
  * Press Super+Ctrl+V again: "alpha" is now the first row and there are still exactly two rows.
  * Press Escape. Press Ctrl+C to clear the prompt, type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the terminal focused before opening the picker; the paste goes to the previously focused window via Shift+Insert.
  * Text selected in a terminal is not copied automatically — that is why wl-copy is used.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker with bravo/alpha and the preview; the terminal with "alpha" pasted; the picker with alpha first and two rows
  * If unsuccessful
  ** Screenshot of "Clipboard is empty" right after copying (watcher dead) or nothing pasted; ./client get-serial tail
covers: shell/plugins/clipboard/Clipboard.qml (watch processes, applySelected), ClipboardHistory.js (addEntry dedup, displayRows), bin/omarchy-clipboard-paste-text, test/shell.d/clipboard-test.sh

### clipboard-picker-search-and-escape   [VM-OK]
description: Typing in the clipboard picker filters entries, a miss shows the empty match state, Home/End jump the cursor, and Escape clears the filter before closing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: printf 'first line' | wl-copy; sleep 1; printf 'second entry' | wl-copy  and Enter.
  * Press Super+Ctrl+V and type: first
  ** Only "first line" is listed; the header shows "first".
  * Type: zzz
  ** The list empties and shows the glyph with "No matches for “firstzzz”".
  * Press Escape once: the filter clears and both rows return. Press End: the last row highlights; press Home: the first row.
  * Press Escape: the picker closes.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first Escape only clears the typed filter; the second closes the card.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the single filtered row; the "No matches" state; both rows after the first Escape with End/Home highlight positions; the desktop after the second Escape
  * If unsuccessful
  ** Screenshot of the filter not applying or the picker closing on the first Escape
covers: Clipboard.qml (setFilter, keyCatcher Escape/Home/End), ClipboardHistory.js (searchableText)

### clipboard-picker-delete-and-clear-history   [VM-OK]
description: Delete removes one entry, Shift+Delete asks before wiping everything and can be cancelled, and the wiped picker shows "Clipboard is empty" even after reopening.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: for w in one two three; do printf $w | wl-copy; sleep 1; done  and Enter.
  * Press Super+Ctrl+V: rows three, two, one.
  * Press Down (two highlighted), then Delete. "two" disappears; rows three and one remain.
  * Press Shift+Delete.
  ** A dialog "Delete entire clipboard history?" with [Cancel] and a red pre-selected [Delete].
  * Press Escape: the dialog closes and the two rows are still listed.
  * Press Shift+Delete, then Enter (confirms Delete).
  ** The list is gone; the card shows the glyph with "Clipboard is empty".
  * Press Escape, then Super+Ctrl+V again: still "Clipboard is empty". Press Escape; type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send Shift+Delete as <S-DEL>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with three rows; two rows after Delete; the confirm dialog; rows intact after Escape; "Clipboard is empty" after confirming and again after reopening
  * If unsuccessful
  ** Screenshot of the wrong entry removed, the dialog missing, or history surviving the confirm
covers: Clipboard.qml (removeDisplayIndex, requestClearHistory, confirmClearHistory, empty-state Column), shell/Ui/ConfirmDialog.qml, ClipboardHistory.js (removeEntryAt, clearHistory)

### clipboard-picker-copy-only-and-open-url   [VM-OK]
description: Shift+Enter copies an entry back to the clipboard without pasting it, and Alt+Enter opens a URL entry in the browser.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: printf 'https://omarchy.org' | wl-copy; sleep 1; printf 'plain text' | wl-copy  and Enter.
  * Press Super+Ctrl+V, press Down (the URL row), then Shift+Enter.
  ** The picker closes and NOTHING is typed at the prompt.
  * Press Ctrl+Shift+V in the terminal: "https://omarchy.org" is pasted (it is the clipboard content now). Press Ctrl+C.
  * Press Super+Ctrl+V; the URL row is first; press Alt+Enter.
  ** The picker closes and a browser window opens on omarchy.org (the page body needs network; the window opening is what counts).
  * Press Super+W to close the browser. Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Shift+Enter = <S-ENTER>, Alt+Enter = <A-ENTER>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal prompt untouched after Shift+Enter; the URL pasted by Ctrl+Shift+V; the browser window after Alt+Enter; the desktop after closing it
  * If unsuccessful
  ** Screenshot of text pasted on Shift+Enter or no browser after Alt+Enter
covers: Clipboard.qml (copyIndex, openIndex), bin/omarchy-clipboard-paste-text --copy-only, bin/omarchy-clipboard-open

### clipboard-sensitive-copy-not-recorded   [VM-OK]
description: A clipboard offer marked sensitive (password managers, wl-copy --sensitive) never appears in the history picker.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: printf visible-one | wl-copy; sleep 1; printf secret-pw-123 | wl-copy --sensitive; sleep 1  and Enter.
  * Press Super+Ctrl+V.
  ** "visible-one" is listed; "secret-pw-123" is NOT listed anywhere.
  * Type: secret  → "No matches for “secret”".
  * Press Escape twice.
  * Press Ctrl+Shift+V in the terminal: whatever pastes, it must not be recorded — reopen Super+Ctrl+V and confirm the secret is still absent. Escape.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The sensitive marker is the x-kde-passwordManagerHint mime type the capture script checks.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker listing visible-one but not secret-pw-123; the "No matches" for secret; the picker still without it after the paste
  * If unsuccessful
  ** Screenshot showing the secret in the list
covers: shell/plugins/clipboard/capture.sh (sensitive guard), test/shell.d/clipboard-test.sh ("ignores sensitive")

### clipboard-picker-image-entry   [VM-OK]
description: Copying an image produces a "Screenshot from …" row with a thumbnail and a large image preview, searchable by the word screenshot.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: img=$(find /usr/share -name '*.png' | head -1); echo "$img"; wl-copy --type image/png < "$img"  and Enter.
  ** A png path is echoed.
  * Press Super+Ctrl+V.
  ** The first row shows a small thumbnail and "Screenshot from <Weekday HH:MM>"; the right pane shows the image large.
  * Type: screenshot  — the image row remains.
  * Press Escape twice. Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the echoed path is empty, use `find / -name '*.png' 2>/dev/null | head -1` instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the image row with thumbnail and the preview pane; the filtered result for "screenshot"
  * If unsuccessful
  ** Screenshot showing no image row or a blank preview
covers: capture.sh (emit_image), ClipboardHistory.js (imagePreviewText, displayRows previewImage), Clipboard.qml (Image delegates)

### emoji-picker-search-and-insert   [VM-OK]
description: The emoji picker filters by keyword and inserts the chosen emoji into the previously focused terminal without leaving it in clipboard history.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal and type (no Enter): echo 
  * Press Super+Ctrl+E.
  ** A card "Search emojis…" with a grid of emoji cells; the first cell is highlighted.
  * Type: thumbs
  ** The grid narrows to thumbs-up/down variants.
  * Press Enter. The picker closes and 👍 appears after "echo " in the terminal.
  * Press Enter in the terminal: the emoji is echoed back.
  * Press Super+Ctrl+V: the emoji is NOT listed in clipboard history. Press Escape.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal must be the focused window when the picker opens; the insert is a Shift+Insert paste of a transient clipboard.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the full grid; the filtered grid; the terminal with 👍 typed and echoed; the clipboard picker without the emoji
  * If unsuccessful
  ** Screenshot showing nothing inserted (note whether the terminal lost focus) or the emoji in history
covers: shell/plugins/emojis/Emojis.qml (setFilter, applySelected), EmojiSearch.js, bin/omarchy-menu-emoji-insert, test/shell.d/emojis-test.sh

### emoji-picker-navigate-mouse-and-cancel   [VM-OK]
description: Arrow keys move the emoji highlight in two dimensions, the mouse highlights and inserts, a miss shows the empty state, and Escape or a scrim click cancels without inserting.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal, then Super+Ctrl+E.
  * Press Right three times, Down twice, Left once: the highlight moves one cell per Right/Left and one row per Down.
  * Type: qqqq  → "No matches for “qqqq”". Press Escape once: the grid returns.
  * Move the mouse over a cell (move a little) — it highlights — and click it: the picker closes and that emoji appears at the terminal prompt.
  * Press Super+Ctrl+E, then Escape: closed, nothing inserted.
  * Press Super+Ctrl+E, then click the dark scrim outside the card: closed, nothing inserted.
  * Press Ctrl+C in the terminal, type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Cells are about 44 px; use ./client-with-image after each key to see the highlighted cell.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the highlight after the arrow sequence; the "No matches" state; the terminal with the clicked emoji; the prompt unchanged after Escape and after the scrim click
  * If unsuccessful
  ** Screenshot of the highlight not moving or a cancel path inserting something
covers: Emojis.qml (select, selectRow, MouseArea, dismiss, empty-state Column)

### polkit-prompt-accepts-password   [VM-OK]
description: A privileged request raises the graphical polkit dialog naming the program, and the account password lets the command run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: pkexec true; echo "exit=$?"  and Enter.
  ** The screen dims and a one-line card appears in the centre: a lock glyph and a masked field with placeholder "Enter password"; a small pill above it reads "Authorize running '/usr/bin/true'".
  * Click on the dimmed background away from the card: the dialog stays (the scrim only refocuses the field).
  * Type: prime  (dots appear) and press Enter.
  ** The placeholder briefly reads "Checking..." and the dialog closes.
  * The terminal shows "exit=0".
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog holds keyboard focus exclusively; no click is needed before typing.
  * Screenshot right after Enter to catch "Checking...".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the dialog with the pill text and dots in the field; the terminal with exit=0
  * If unsuccessful
  ** Screenshot of a pkexec error in the terminal ("No session for cookie" or similar) and the ./client get-serial tail
covers: shell/plugins/polkit/PolkitAgent.qml (beginFlow, submitResponse, justification pill, scrim MouseArea), PolkitModel.js (authorizationLabel), test/shell.d/polkit-test.sh

### polkit-rejects-wrong-password   [VM-OK]
description: A wrong password is visibly rejected — red "Wrong", a shake, the field cleared — and the same request then accepts the right one.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: pkexec true; echo "exit=$?"  and Enter.
  * When the dialog appears type: wrongpass  and press Enter.
  ** After a moment the card shakes, the lock and text turn red and the placeholder reads "Wrong" for about a second; the field is empty and still focused.
  * Type: prime  and press Enter. The dialog closes; the terminal shows exit=0.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Wrong" is shown for 1.2 s; take a screenshot immediately after Enter and another a second later.
  * If the wrong password yields exit=0, report it as critical.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing the red "Wrong" state; the terminal with exit=0 after the retry
  * If unsuccessful
  ** Screenshot of the dialog accepting the wrong password or closing without a retry
covers: PolkitAgent.qml (triggerFailureFeedback, errorFlash, shakeAnimation)

### polkit-cancel-with-escape   [VM-OK]
description: Escape on the polkit dialog cancels the request so the calling program fails with "not authorized" instead of hanging.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: pkexec true; echo "exit=$?"  and Enter.
  * When the dialog appears, press Escape.
  ** The dialog closes within half a second; the terminal prints an authorization error (e.g. "Not authorized" / "Request dismissed") and "exit=126".
  * Run the same command once more and press Escape again: same result, no leftover scrim.
  * Type exit and Enter. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * exit 126 is pkexec's "not authorized" code; anything else with the dialog gone is worth reporting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshot with the error text and exit=126 (twice); the clean desktop
  * If unsuccessful
  ** Screenshot of a dialog that will not close or a terminal that hangs after Escape
covers: PolkitAgent.qml (cancelRequest, closeTimer)

### network-dns-pill-change-and-restore   [VM-OK]
description: Clicking a DNS provider pill in the network panel switches the system resolver (silently via the sudo rule, or through the polkit prompt) and the panel shows the new active provider; clicking DHCP restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W. In the "DNS PROVIDER" row the DHCP pill is filled (active). Hover "Google": tooltip "Set DNS to Google".
  * Click the Google pill.
  ** Either the panel just closes (passwordless sudo rule present), OR the polkit dialog appears with a pill naming omarchy-dns — then type prime and press Enter. Report which happened.
  * Wait 3 s, press Super+Ctrl+W: the Google pill is now the filled one. Press Escape.
  * Press Super+Enter for a terminal. Type: getent hosts omarchy.org  and Enter: an address is printed (resolution still works).
  * Press Super+Ctrl+W and click the DHCP pill (authenticate again if prompted).
  * Press Super+Ctrl+W: DHCP is active again. Press Escape. Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the polkit dialog appears, pressing Escape instead must leave DHCP active — try it once at the end if time allows and report.
  * The panel closes itself after a DNS click; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Panel with DHCP active and the Google tooltip; (the polkit dialog, if shown); panel with Google active; terminal resolving omarchy.org; final panel back on DHCP
  * If unsuccessful
  ** Screenshot of the pill not changing, a floating terminal error, or name resolution failing; ./client get-serial tail
covers: shell/plugins/panels/network/Panel.qml (setDns, DnsProviderPill, dnsProc), bin/omarchy-dns (require_root sudo/pkexec), etc/sudoers.d/omarchy-dns, PolkitAgent.qml, default/omarchy/omarchy-menu.jsonc (setup.network.dns.*)

### network-dns-custom-rejects-empty-input   [VM-OK]
description: The Custom DNS pill opens a floating terminal prompt; submitting nothing fails with a clear error and leaves the resolver on its previous provider.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W and click the "Custom" DNS pill.
  ** The panel closes and a floating terminal titled "Omarchy" opens with the Omarchy logo; after any sudo/polkit step (type prime if asked) it prompts: "Enter your DNS servers (space-separated, e.g. '192.168.1.1 1.1.1.1'):"
  * Press Enter with no input.
  ** It prints "Error: No DNS servers provided." and a Failed/Done prompt line.
  * Press Enter (or whatever the prompt says) to close the floating terminal.
  * Press Super+Ctrl+W: the active DNS pill is still DHCP. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If sudo asks for a password in the floating terminal instead of polkit, type prime and Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Floating terminal with the DNS prompt; the error message; the panel with DHCP still active
  * If unsuccessful
  ** Screenshot of the terminal not opening or the active pill changing
covers: network/Panel.qml (setDns Custom branch), bin/omarchy-dns (Custom), bin/omarchy-launch-floating-terminal-with-presentation

### network-panel-wired-only-layout   [VM-OK]
description: On a wired-only machine the network panel shows the Ethernet hero, live connection details and DNS pills, hides every Wi-Fi control, and lets the IP be copied with a click.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal (leave it open), then Super+Ctrl+W.
  ** A card under the ethernet bar icon. Hero: ethernet glyph, title "Ethernet" (optionally with a speed in parentheses), a small-caps phrase that changes every ~3 s ("WIRING BITS", "HANDLING PACKETS", …). On the hero's right only a gauge button — NO on/off switch and NO QR button.
  ** Grid: Ping, Packet Loss, Receiving, Sending, Downloaded, Uploaded, IP Address (10.0.2.15), Gateway (10.0.2.2). Ping reads "Timeout" and Packet Loss "100%" in red — expected here, ICMP is blocked in the VM.
  ** "DNS PROVIDER" pills DHCP (filled), Cloudflare, Google, Custom. NO "WI-FI BAND", NO "SCANNING WI-FI…", NO network rows; the card ends after the pills.
  * Wait 5 s and screenshot again: the hero phrase changed and Downloaded/Uploaded may have grown.
  * Hover "10.0.2.15": tooltip "Copy IP". Click it. Hover "10.0.2.2": tooltip "Copy gateway".
  * Press j (a highlight ring appears on the DHCP pill), then l twice (Google) and h once (Cloudflare) — nothing changes, only the highlight moves. Do not press Enter.
  * Press Escape. In the terminal press Ctrl+Shift+V: "10.0.2.15" is pasted. Press Ctrl+C, type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No keyboard highlight is painted until the first j; that first press only reveals it.
  * The ethernet icon is the first panel icon after the tray area on this VM (agents/bluetooth slots are hidden).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two screenshots of the open panel a few seconds apart showing hero, the eight detail cells with 10.0.2.15 / 10.0.2.2 and the red Timeout/100%, the DNS pills and nothing Wi-Fi related; the tooltips; the ring on each pill; the terminal with the pasted IP
  * If unsuccessful
  ** Screenshot of a Wi-Fi switch/list appearing, a "No connection" hero, or an empty grid
covers: network/Panel.qml (hero, heroActions visibility, details GridLayout, DetailValue copyable, canSelectBand, wifiStationAvailable, keyCatcher dns/header), Model.js (connectivityState, formatPingLatency, headerDetail), bin/omarchy-network-status

### panel-open-close-switch-and-number-hotkeys   [VM-OK]
description: Every bar panel closes on Escape or an outside click, Tab/Shift+Tab and a click on another icon switch panels, and Super+Ctrl+<digit> opens the N-th panel of the right section.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W (network panel). Press Escape: it closes.
  * Click the network icon in the bar: the panel opens. Click the desktop far below the card: it closes.
  * Click the network icon, then press Tab: the network panel closes and the Audio panel (hero "Audio") opens. Press Tab: the Display panel. Press Shift+Tab twice: Network again.
  * With the network panel open, click the display (monitor) icon in the bar: the Display panel replaces it in one click. Press Escape.
  * Press Super+Ctrl+1: a panel opens — note its hero (Network expected). Escape. Super+Ctrl+2: Audio. Escape. Super+Ctrl+3: Display. Escape.
  * Press Super+Ctrl+9: nothing opens. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the digit chords as <M-C-1>, <M-C-2> …; hidden widgets (bluetooth, power, agents) may or may not be counted — record which panel each digit opened.
  * The bar strip stays clickable while a panel is open; everything else dismisses.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: network open; closed after Escape; closed after the outside click; Audio after Tab; Display after Tab; Network after Shift+Tab ×2; Display after clicking its icon; the panels for digits 1–3; nothing for 9
  * If unsuccessful
  ** Screenshot of a panel staying open or the wrong panel after Tab or a digit
covers: shell/Ui/KeyboardPanel.qml (dismissArea, forwardBarClick, popout coordination), PanelKeyCatcher.qml (Tab), shell/Ui/Panel.qml (switchPanel), default/hypr/bindings/utilities.lua (togglePanelAt), test/acceptance.d/panels-test.sh

### network-speed-test-overlay   [VM-OK] [NET]
description: The internet speed test shows download then upload dials live, offers Run Again when finished, and stops when dismissed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W and click the gauge icon at the right of the hero (tooltip "Run a speed test").
  ** The panel closes and a near-black overlay appears: title "ETHERNET", dials DOWNLOAD and UPLOAD with "Mbps"; on open the needles sweep to full scale and back.
  * Screenshot every 2–3 s for about 12 s: the DOWNLOAD readout climbs first, then UPLOAD; when done a "Run Again" button appears between the dials.
  * Click "Run Again": readouts reset and a new run starts. Press Escape mid-run: the overlay closes.
  * Press Super+Space → Trigger → Speed Test → Network Speed Test: the same overlay opens. Click the dark scrim: it closes. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each phase lasts 5 s. If fast.com is unreachable a red error line appears under the dials — screenshot it and report; that is a valid negative outcome.
  * Downloads are a few tens of MB.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Overlay with the ignition sweep; a frame with a non-zero DOWNLOAD value; a frame with UPLOAD live; the finished state with "Run Again"; the overlay gone after Escape and after the scrim click
  * If unsuccessful
  ** Screenshot of the red error text or of dials stuck at 0 after 15 s; ./client get-serial tail
covers: shell/plugins/panels/speedtest/Panel.qml, shell/Ui/SpeedTestOverlay.qml, network/Panel.qml (summonSpeedTest), bin/omarchy-network-speedtest, default/omarchy/omarchy-menu.jsonc (trigger.tests.network-speedtest)

### disk-speed-test-overlay   [VM-OK]
description: The disk speed test shows read then write MB/s for the system disk, finishes on its own and leaves no temp files behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger → Speed Test → Disk Speed Test.
  ** A dark overlay titled with the disk model (e.g. "QEMU HARDDISK"), dials READ and WRITE with unit "MB/s".
  * Screenshot every 3 s for about 20 s: READ climbs first, then WRITE; then "Run Again" appears.
  * Press Escape. The overlay closes.
  * Press Super+Enter for a terminal. Type: ls ~/.cache/omarchy | grep -ci speed  and Enter: it prints 0 (no leftover test files).
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The test writes about 1 GB temporarily; on a slow virtual disk WRITE values in the tens of MB/s are normal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Frames with READ live, WRITE live and the finished "Run Again" state; the terminal printing 0
  * If unsuccessful
  ** Screenshot of an error line or dials never moving; the terminal listing leftover files
covers: shell/plugins/panels/disk-speedtest/Panel.qml, shell/Ui/SpeedTestOverlay.qml (scaleStops), bin/omarchy-disk-speedtest

### wifi-qr-absent-on-wired   [VM-PARTIAL]
description: Without Wi-Fi the QR share entry is hidden from the menu and the network panel, and a forced summon shows an error card rather than a bogus code (the rendered-QR path is skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Network. The only row is DNS — NO "QR Code". Press Escape.
  * Press Super+Ctrl+W: the hero has no QR button. Press Escape.
  * Press Super+Enter for a terminal. Type: omarchy-shell shell summon omarchy.wifiqr  and Enter.
  ** A dark overlay titled "WI-FI", briefly "Generating QR code…", then a red error line (no Wi-Fi connection / "Could not generate the Wi-Fi QR code"). No white QR square, no "Show password".
  * Press Escape: the overlay closes.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped on this VM: the rendered code for a connected Wi-Fi network and the password reveal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Setup › Network without QR Code; the network hero without a QR button; the wifiqr overlay with the red error; the desktop after Escape
  * If unsuccessful
  ** Screenshot of a QR square rendered without Wi-Fi, or an overlay that will not close
covers: shell/plugins/panels/wifiqr/Panel.qml (error path), Model.js, default/omarchy/omarchy-menu.jsonc (setup.network.qr when-guard), network/Panel.qml (canShareWifi), test/shell.d/network-qr-test.sh

### audio-panel-no-device   [VM-PARTIAL]
description: With no audio hardware the audio panel still opens and degrades gracefully — disabled output slider, no device rows, harmless mute/wheel actions — instead of crashing (device switching and per-app streams are skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+A.
  ** A card opens: hero "Audio" with a mood label ("SILENCED" or "MUTED") and an on/off switch; "OUTPUT" with a percentage and a slider. With no sink the slider is greyed and there are no device rows; if a "Dummy Output" row exists, report it. "INPUT" and "SOURCES" are absent.
  * Click on the output slider track: with no sink the percentage stays; with a dummy sink it follows the click.
  * Click the hero switch twice: the label toggles MUTED and back only if a sink exists; no error either way.
  * Press j, then l three times, then m: no error. Press Escape.
  * Right-click the audio bar icon (the icon left of the monitor icon), then Super+Ctrl+A: hero "MUTED" with a sink, unchanged without. Right-click again to restore; Escape.
  * Scroll the mouse wheel up three notches over the audio icon: a volume OSD appears only if a sink exists. Screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar icon may render blank (no glyph) when there is no sink; find its slot by opening the panel first and noting where the card is anchored.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the open audio panel (record which sections exist); after the slider click; after the switch clicks; after the right click; during/after the wheel
  * If unsuccessful
  ** Screenshot of the panel failing to open or the bar vanishing (shell crash); ./client get-serial tail
covers: shell/plugins/panels/audio/Panel.qml (hasOutput/hasInput, sectionVisible, outputSlider enabled, BarIconButton right click/wheel), Model.js, test/acceptance.d/panels-test.sh (audio)

### bluetooth-widget-hidden-no-adapter   [VM-PARTIAL]
description: Without a Bluetooth adapter the bar shows no Bluetooth icon and the Bluetooth hotkey is harmless (pairing and radio toggling are skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar's right section: there is no Bluetooth icon between the tray area and the network icon.
  * Press Super+Ctrl+B and wait 2 s.
  ** Either nothing happens, or a card appears with hero "Bluetooth" / "NO ADAPTER", no power switch and the text "No Bluetooth adapter". Report which.
  * Press Escape (if a card opened). The desktop is as before.
  * Click the clock in the bar and press Escape: the bar is still responsive.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar icons on this VM, left to right in the right section: (tray), network, audio, display — anything else is a finding.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshot without the icon; the screen after the hotkey (empty or the no-adapter card); the calendar opening afterwards
  * If unsuccessful
  ** Screenshot of a Bluetooth icon present, or the bar vanishing after the hotkey; ./client get-serial tail
covers: shell/plugins/panels/bluetooth/Panel.qml (visible: adapter !== null, empty text), test/acceptance.d/panels-test.sh (self-hiding widgets)

### power-widget-hidden-no-battery   [VM-PARTIAL]
description: Without a battery the power widget is absent from the bar, its hotkey is a no-op, and the laptop-only "Battery Percentage" toggle is hidden (battery stats and power profiles are skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right end of the bar: the last icon is the Display (monitor) icon; no battery icon follows it.
  * Press Super+Ctrl+P and wait 2 s: no panel appears.
  * Press Super+Space → Trigger → Toggle: there is no "Battery Percentage" row. Press Escape.
  * Press Super+Ctrl+D then Escape: the neighbouring display panel still works.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The power panel opens and immediately closes itself without a battery; a brief flicker is acceptable, a card that stays is not.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshot ending in the Display icon; the desktop after Super+Ctrl+P with no panel; the Toggle submenu without Battery Percentage; the display panel opening
  * If unsuccessful
  ** Screenshot of a battery icon or a lingering power card; ./client get-serial tail
covers: shell/plugins/panels/power/Panel.qml (batteryPresent, onOpenedChanged close), default/omarchy/omarchy-menu.jsonc (trigger.toggle.battery-percentage), test/acceptance.d/panels-test.sh

### monitor-panel-fixed-brightness-layout   [VM-OK]
description: On a display without a controllable backlight the Display panel says "FIXED BRIGHTNESS", hides the brightness slider, and shows the Text Size and Scale controls for the single screen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+D.
  ** Card under the monitor icon: hero "Display" with "FIXED BRIGHTNESS"; NO "BRIGHTNESS" section; "TEXT SIZE" with "12px" at the right and a notched slider; "SCALE" with pills such as 1x, 1.25x, 1.6x, 2x, 3x, 4x (set depends on resolution) with 1x filled; NO "DISPLAYS" section.
  * Hover the "2x" pill: it highlights; do not click.
  * Press j: a ring appears on the first scale pill; press l once: it moves to the next pill; press k: the TEXT SIZE row highlights. Do not press Enter.
  * Scroll the mouse wheel over the monitor bar icon: nothing changes (no brightness to adjust).
  * Press Escape. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The monitor icon is the rightmost icon in the bar on this VM.
  * Pill labels are the effective clean scales; report the exact set you see.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the panel with FIXED BRIGHTNESS, TEXT SIZE 12px and the SCALE pills with 1x active; the hover highlight; the keyboard ring on a pill and on the text-size row
  * If unsuccessful
  ** Screenshot showing a brightness slider, a DISPLAYS section, or missing sections
covers: shell/plugins/panels/monitor/Panel.qml (brightnessAvailable, visibleSections, ScalePill, moveCursor), Model.js (availableScales), bin/omarchy-monitor-state, bin/omarchy-brightness-display

### monitor-scale-change-and-restore   [VM-OK]
description: A scale pill rescales the whole desktop on the focused monitor and becomes the active pill, by mouse and by keyboard, and 1x brings everything back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop and note the bar height. Press Super+Ctrl+D and click the "1.25x" pill (or the pill right after 1x).
  ** Within ~2 s the bar, panel and fonts grow; the panel stays open and the clicked pill is now filled.
  * Click "1x": the desktop returns to its original size and 1x is filled again.
  * Press j (ring on the first pill), l twice, Enter: the third pill applies and the desktop rescales again.
  * Press h twice, Enter: back to 1x; the desktop matches the first screenshot.
  * Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the screen goes black or the bar vanishes for more than 5 s, screenshot, report, then press Super+Ctrl+D again.
  * A pill whose clean scale differs from its label is relabelled; report the label you clicked.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots showing the rescale and the filled pill; the restored desktop after 1x; the keyboard-driven rescale and the final restored desktop
  * If unsuccessful
  ** Screenshot of no rescale, the wrong pill active, or a broken layout; ./client get-serial tail
covers: monitor/Panel.qml (setScale, activeScaleIndex, moveCursorH, activateCursor), Model.js (cleanScale, matchingScaleIndex), bin/omarchy-hyprland-monitor-scaling, test/shell.d/monitor-scaling-test.sh

### monitor-text-size-slider-and-restore   [VM-OK]
description: The Text Size slider moves in fixed notches, reflows the whole shell live, keeps the value across reopen, and returns to 12px.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+D. Click on the TEXT SIZE track about 60 % along it.
  ** The value at the right snaps to a notch ("14px" or "16px") and the panel text, bar text and menu font grow within a second.
  * Press Escape, then Super+Space: the menu is visibly larger. Press Escape.
  * Press Super+Ctrl+D: the TEXT SIZE value still shows the new px (kept).
  * Press j (ring on a scale pill), k (TEXT SIZE row), then h once per notch until the value reads 12px; the shell shrinks back with each step.
  * Press Escape, then Super+Space: the menu is back to its original size. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notches are 9, 10, 11, 12, 14, 16, 20 px; l moves right, h left. If you overshoot to 11px press l once.
  * Hover is ignored for 300 ms after each change while the panel reflows; use keys rather than the mouse for the restore.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Panel with the larger px value and visibly larger text; the larger menu; the panel reopened with the value kept; the panel at 12px; the menu at normal size
  * If unsuccessful
  ** Screenshot of the value not snapping, no reflow, or the size not returning to 12px
covers: monitor/Panel.qml (textSizeStops, adjustTextSize, textSizeSlider onReleased, reflowingText), shell/Ui/PanelSlider.qml (tickCount, integer), bin/omarchy-display-text-size

### clock-calendar-navigate-and-return   [VM-OK]
description: The clock opens a calendar centred under the bar; months and years step by keys, chevrons and the wheel, and "t" or the hero date brings it back to today.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Click the clock label at the top centre of the bar.
  ** A wide card: a large "󰃭 <Month day>" hero, a year rail "<YYYY> ─── NN%", weekday headings, six rows of days with ISO week numbers in a left gutter, today outlined and bold, and "‹ <MONTH YYYY> ›" at the bottom.
  * Press ] twice: the month label advances two months; the hero date stays today. Press [ three times: one month before today.
  * Press }: one year later. Press t: back to the current month.
  * Click the › chevron (tooltip "Next month"), then scroll the wheel down once over the grid (another month), then click the hero date (tooltip "Back to today"): the current month again.
  * Press Escape. Press Super+Ctrl+Alt+D: the calendar opens by hotkey on the current month. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hero date is only clickable while another month is shown.
  * The card is centred under the bar regardless of where the clock label sits.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the calendar on today's month with the outlined day; after ]]; after [[[; after }; after t; after chevron + wheel; after clicking the hero; the hotkey-opened calendar
  * If unsuccessful
  ** Screenshot where the month label or the highlight did not move as described
covers: shell/plugins/panels/clock/Panel.qml (moveMonth, moveYear, goToToday, WheelHandler, hero MouseArea), BarWidget.qml (left click), Model.js (monthGrid, isoWeek), test/shell.d/clock-test.sh

### clock-week-start-toggle-persists   [VM-OK]
description: The "W" heading (or the w key) flips the week start between Monday and Sunday, the grid reorders, and the choice survives closing and reopening the calendar; toggling back restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Click the clock. Note the first weekday heading (expected MON). Hover the "W" heading: tooltip "Start weeks on Sunday" (or Monday).
  * Click "W": the headings now start with the other day and the day grid shifts.
  * Press Escape, then click the clock again: the new order is still shown (persisted).
  * Press w: the headings flip back to the original order.
  * Press Escape and click the clock once more: the original order is shown. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The "W" heading is the small letter above the week-number gutter at the left of the grid.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Tooltip screenshot; the grid before and after with different first headings; the reopened calendar keeping the change; the restored order after reopening
  * If unsuccessful
  ** Screenshot of the grid not reordering or reverting on reopen
covers: clock/Panel.qml (toggleWeekStart, setWeekStart, persistSettings), Model.js (toggledWeekStart, weekStartSettingName)

### clock-format-cycle-right-click   [VM-OK]
description: Right-clicking the clock cycles the bar label through the built-in formats (12-hour, seconds, short date, ISO week …) and the ring returns to the original format.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Hover the clock label: tooltip "Right-click to toggle format". Note the label (e.g. "Friday 13:05").
  * Right-click it: a 12-hour label ("Friday 1:05 PM"). Right-click again: seconds appear ("Friday 13:05:07") and tick — two screenshots 2 s apart differ.
  * Keep right-clicking, screenshotting each label, until the original "<Weekday HH:MM>" style returns (about 8 more clicks; along the way a "d MMMM Wnn yyyy" label shows the ISO week and a "yyyy-MM-dd HH:mm" label).
  * Confirm the final label matches the first screenshot exactly.
  * Click the label once and press Escape (the calendar still opens and closes).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar re-centres as the label width changes; that is expected. Count clicks — the ring has ten entries.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each label in the ring, including the ticking seconds pair and the Wnn week label; the final label equal to the first
  * If unsuccessful
  ** Screenshot of the label not changing or the ring not returning to the start
covers: clock/BarWidget.qml (cycleFormat, formatted, showsSeconds), Model.js (CLOCK_FORMATS, clockFormatRing, nextClockFormat, isoWeekLiteral)

### clock-memento-mori-edit   [VM-OK]
description: Double-tapping the year rail opens the BORN / LIVE TO editor; a valid year adds a LIFE rail, invalid input leaves it hidden, and double-tapping the LIFE rail removes it again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Click the clock. Double-click on the year rail (the thin bar under the hero with the year at left and NN% at right).
  ** The rail is replaced by "BORN [year] LIVE TO [90]" fields with BORN focused.
  * Type: abcd  press Tab, then Enter. The editor closes and NO "LIFE" rail appears.
  * Double-click the rail again, type: 1990  and press Enter.
  ** A second rail "LIFE ─── NN%" appears under the year rail; hovering it shows the tooltip "Memento Mori".
  * Double-click the rail again, press Escape: the editor closes with nothing changed (LIFE rail still there).
  * Double-click the LIFE rail: it disappears. Press Escape; the calendar closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use ./client mouse double-click on the rail's coordinates; the rail spans the grid width.
  * With the editor open, Escape cancels the edit first; a second Escape closes the panel.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The editor fields; no LIFE rail after "abcd"; the LIFE rail with its tooltip after 1990; the rail intact after Escape on the editor; the rail gone after double-clicking it
  * If unsuccessful
  ** Screenshot of the editor not appearing, a LIFE rail after invalid input, or the panel not closing
covers: clock/Panel.qml (startEditingLife, handleLifeKey, commitLife, clearLife), Model.js (parseBirthYear, parseLifeExpectancy, lifeProgress), shell/Ui/TextField.qml

### weather-panel-forecast-and-location   [VM-OK] [NET]
description: The weather pill appears once a forecast arrives; the panel shows conditions and a forecast, lets the user pick a city from geocoded suggestions, keeps it across reopen, and clears back to auto-detect.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Wait up to 30 s after reaching the desktop, screenshotting every 5 s: a weather glyph appears right of the clock area once the fetch succeeds.
  * Click the glyph.
  ** A wide card: a big condition glyph, temperature with °C/°F, a " <LOCATION>" line, FEELS / WIND / HUMID values, a divider and three forecast cells (icon, DAY, hi° lo°). "Fetching forecast…" may show briefly.
  * Click the location line: it becomes a "Search city" field. Type: Paris
  ** Within ~2 s suggestions appear (Paris, Île-de-France, France …). Press Down once, then Enter.
  ** A spinner replaces the ✕ while saving, then the location reads "PARIS" and the numbers refresh.
  * Press Escape and click the glyph again: still "PARIS" (kept).
  * Click the location, then click the ✕ beside the field: the location returns to the auto-detected city. Press Escape.
  * Right-click the glyph: a notification with the weather status appears. Middle-click it: nothing visible (refresh).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * wttr.in can be slow; the panel retries by itself. Screenshot repeatedly instead of waiting more than 5 s at a time.
  * Only small JSON downloads are involved.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar with the weather glyph; the panel with conditions and forecast; the Paris suggestions; the panel reading PARIS and again after reopen; the panel after ✕; the notification after the right click
  * If unsuccessful
  ** Screenshot of "Fetching forecast…" persisting beyond 60 s or no glyph at all
covers: shell/plugins/panels/weather/Panel.qml (startEditingLocation, geocode, pickSuggestion, clearLocation), BarWidget.qml (clicks), Model.js, bin/omarchy-weather-location, test/acceptance.d/panels-test.sh (weather)

### weather-panel-offline-keeps-state   [VM-OK] [NET]
description: When the network is switched off the weather panel keeps its last data and offers no suggestions, and it recovers once the network is back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Wait for the weather glyph to appear (see the forecast test). Press Super+Enter for a terminal and type: nmcli networking off  and Enter.
  ** The network bar icon turns into the disconnected glyph; the weather glyph stays.
  * Click the weather glyph: the last conditions are still shown. Click the location, type: Berlin — no suggestions appear. Press Escape (cancels the edit), Escape (closes).
  * In the terminal type: nmcli networking on  and Enter; screenshot every 5 s until the network icon is the ethernet glyph again.
  * Middle-click the weather glyph, then click it: the data is present (refreshed). Press Escape.
  * Type exit and Enter. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If nmcli asks for authentication, type prime in the polkit dialog; if it fails, report and skip the offline half.
  * Never leave the VM with networking off.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar with the disconnected network icon and the weather glyph still present; the panel offline with no suggestions; the network restored; the panel after refresh
  * If unsuccessful
  ** Screenshot of an error text in the panel or the glyph vanishing; ./client get-serial tail
covers: weather/Panel.qml (retry timers, report kept on failure, geocodeProc), network/Panel.qml (kind disconnected icon)

### agents-panel-hidden-no-usage   [VM-PARTIAL]
description: Without any AI-agent usage records the Agents icon is absent from the bar, and a forced open shows the empty explanation rather than an error (real usage meters are skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar's right section: there is no 󱚣 (agents) icon left of the network icon.
  * Press Super+Enter for a terminal. Type: omarchy-shell omarchy.agents open  and Enter.
  ** Either a card appears reading "No AI coding subscriptions found. Agents show up here once you've used them.", or the command prints an error such as "Target not found." — report which. No crash.
  * Press Escape if a card opened.
  * Type: omarchy-shell omarchy.agents refresh  and Enter; wait 5 s and screenshot the bar: still no agents icon.
  * Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped on this VM: limits meters, tokens by day/model, provider chips (need Claude/Codex/Fireworks usage).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshot without the icon; the terminal output; the empty card if it appeared; the bar still without the icon after refresh
  * If unsuccessful
  ** Screenshot of an agents icon on a pristine disk, or the bar vanishing on open; ./client get-serial tail
covers: shell/plugins/agents/Panel.qml (visible: providers.length > 0, empty Text), Main.qml (enabledProviders, runUpdate), README.md

### plugins-enable-and-disable-tailscale-dropbox   [VM-OK]
description: Setup → Plugins offers a picker with the plugin id under each name; enabling Tailscale and Dropbox adds their icons whose panels report the missing CLIs, and disabling removes them again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Plugins → Enable Plugin.
  ** A picker "Enable plugin…" lists disabled plugins: a glyph, the name (Tailscale, Dropbox, Dev gallery …) and the id in grey underneath (omarchy.tailscale …).
  * Type: tail  and press Enter. A new bar icon (a 3×3 dot grid with a cross) appears in the right section.
  * Click it: hero "Tailscale" / "TAILSCALE IS DISCONNECTED", no on/off switch, and a row "Tailscale CLI is not installed or not on PATH." Press t: nothing changes. Press Escape.
  * Press Super+Space → Setup → Plugins → Enable Plugin, type: drop  Enter. A diamond icon appears. Click it: rows "Dropbox CLI is not installed" / "Install Dropbox from the service menu" with a greyed key button. Press Escape.
  * Press Super+Space → Setup → Plugins → Disable Plugin, pick Tailscale (Enter); repeat and pick Dropbox. Both icons disappear.
  * Press Super+Space → Setup → Plugins → Enable Plugin and press Escape: the bar is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * New icons appear within a second or two at the right section's default position.
  * The picker filters on name and id, so "tail" and "drop" are enough.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The picker with name + id rows; the bar with the Tailscale icon and its "not installed" panel; the Dropbox icon and its login row; the bar after both disables without the icons
  * If unsuccessful
  ** Screenshot of the picker missing plugins, icons not appearing or disappearing, or a panel error
covers: bin/omarchy-menu-plugin, test/shell.d/menu-plugin-test.sh, shell/plugins/panels/tailscale/Panel.qml (missing-CLI row, Service.whichProcess), shell/plugins/panels/dropbox/Panel.qml (LoginButton texts), Menu.qml (dmenu subtext rows)

### dev-gallery-open-and-walk-controls   [VM-OK]
description: The dev gallery opens as a floating window with every shared control, and the standard panel keys walk its sections, adjust the slider, flip a toggle and show a tooltip before Escape closes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: omarchy-shell shell summon omarchy.dev-gallery '{}'  and Enter.
  ** A window "Omarchy shell – dev gallery" opens beside the terminal with the heading "Omarchy shell · dev gallery", a Conventions box, a Typography scale and component sections below.
  * Press j eight times: the highlight walks the CursorSurface rows, the Button row, ButtonGroup, PanelActionButton, PanelToolTip, Slider …, scrolling the window as it goes.
  * With the Slider section highlighted press l three times: the % at the right rises by 15.
  * Press j until the "Toggle" section highlights and press Enter: the "Transparent bar" switch flips; press Enter again: it flips back.
  * Move the mouse over the "hover me" swatch in the PanelToolTip section: the tooltip "Styled tooltip — drop into any panel" appears.
  * Press Escape: the gallery window closes. Type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the window opens small, press Super+F to fullscreen it for readability; PageDown/PageUp scroll the page.
  * Use ./client-with-image after each j to see which section holds the highlight.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The gallery header; the highlight on several sections; the slider % increased; the toggle flipped and restored; the tooltip; the desktop after Escape
  * If unsuccessful
  ** Screenshot of the gallery failing to open (terminal error) or a control not responding; ./client get-serial tail
covers: shell/plugins/dev-gallery/GalleryPanel.qml, shell/Ui/PanelKeyCatcher.qml, shell/Ui/PanelSlider.qml, shell/Ui/Toggle.qml, shell/Ui/PanelToolTip.qml

### dev-gallery-dropdowns-select-and-filter   [VM-OK]
description: In the gallery the Dropdown picks an option by keyboard, the SearchableDropdown filters as you type and shows "No matches", and Escape closes each popup without changing the value.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: omarchy-shell shell summon omarchy.dev-gallery '{"section":"dropdown"}'  and Enter.
  ** The gallery opens scrolled to the Dropdown section ("Center anchor" showing omarchy.clock) with it highlighted.
  * Press Enter: a popup lists omarchy.clock / omarchy.weather / omarchy.power. Press j, then Enter: the trigger now shows "omarchy.weather".
  * Press Enter again, then Escape: the popup closes and the trigger still shows "omarchy.weather".
  * Press j (SearchableDropdown "Add widget") and Enter: a popup with a "Search widgets..." field. Type: wea  → only "Weather" with its description remains. Press Down, Enter: the trigger shows "Weather".
  * Press Enter, type: zzz  → "No matches". Press Escape: the popup closes, the trigger still shows "Weather".
  * Click the "Center anchor" trigger with the mouse and click "omarchy.clock" in the popup: it returns to omarchy.clock. Press Escape to close the gallery; type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * While a popup is open, j/k and typing go to the popup, not the gallery cursor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Dropdown popup; the trigger showing omarchy.weather (and still after Escape); the filtered "Weather" result; the "No matches" state; the trigger back on omarchy.clock after the mouse pick
  * If unsuccessful
  ** Screenshot of a popup not opening, a value changing on Escape, or the filter not narrowing
covers: GalleryPanel.qml (dropdown / searchable-dropdown sections, keyCatcher blocked), shell/Ui/Dropdown.qml, shell/Ui/SearchableDropdown.qml

### dev-gallery-text-and-number-fields   [VM-OK]
description: TextField (plain and password) and NumberField in the gallery take focus on Enter, mask passwords, step numbers within their range, and release focus on Escape.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal. Type: omarchy-shell shell summon omarchy.dev-gallery '{"section":"text-field"}'  and Enter.
  ** The gallery opens scrolled to the TextField section with the first field highlighted.
  * Press Enter: the field shows a focus border and caret. Type: hello world  — the text appears. Press Escape: focus leaves; the text stays.
  * Press j (the "Password" field), Enter, type: secret  — dots appear instead of letters. Press Escape.
  * Press j (NumberField "Auto-refresh interval (minutes)" showing 15), Enter, then Up three times: 18.
  * Press Ctrl+A, type: 2000  and Enter: the value is clamped to 1440 (or stays — report the value shown). Press Escape.
  * Press Escape to close the gallery; type exit and Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * While a field has focus, j/k/Enter go to the field; the gallery cursor is frozen until Escape.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The field with "hello world"; the masked password field; the number field at 18 and after the 2000 entry
  * If unsuccessful
  ** Screenshot of a field not taking focus, a password shown in clear, or the gallery ignoring the section payload
covers: GalleryPanel.qml (open payload section, text-field / number-field sections), shell/Ui/TextField.qml (password echoMode), shell/Ui/NumberField.qml (SpinBox from/to)

## Gaps

Behaviours reviewed that cannot be driven on this VM (hardware) or were left to other reviewers / too risky for a shared disk:

- **Wi-Fi in the network panel** (`network/Panel.qml` NetworkRow, passphrase prompt, enterprise identity field, "Wrong password" reprompt, forget button, band pills, Automatic
  switch, radio ToggleSwitch, "SCANNING WI-FI…", KNOWN/OTHER sections, captive-portal button, QR hero button) — no Wi-Fi radio in QEMU. VM-NO.
- **Wi-Fi QR positive path** (`wifiqr/Panel.qml`: rendered code, "Scan to join this network", "Show password" reveal and its error) — VM-NO.
- **Bluetooth panel body** (`bluetooth/Panel.qml`: power switch, discovery, CONNECTED/PAIRED/AVAILABLE rows, pair/connect/disconnect/forget, `x`, audio sink auto-switch,
  discovery stop after close) — no adapter. VM-NO.
- **Power panel** (`power/Panel.qml`: battery hero, phrases, progress bar, stats, power-profile pills, `omarchy-powerprofiles-set`, right-click percentage toggle) — no battery.
  The `power-profiles` menu provider exists in `Menu.qml` but no default JSONC row uses it, so power profiles are unreachable from the UI on the VM. VM-NO.
- **Brightness** (monitor panel slider, wheel on the bar icon, `omarchy.monitor brightness` IPC) — no backlight/DDC on virtio-vga. VM-NO.
- **DISPLAYS section / multi-monitor** (monitor rows, disabling a display, focused-monitor label, dismissal twin windows in `KeyboardPanel.qml`) — single screen. VM-NO.
- **Audio positive paths** (sink/source switching, per-app SOURCES rows with 150 % sliders, MPRIS labels, input peak meter, headphones icon) — no audio device;
  only observable if PipeWire exposes a dummy sink. VM-NO / VM-PARTIAL.
- **Polkit fingerprint mode** (square card, fingerprint glyph, lid-closed fallback) — no sensor, no `pam_fprintd`. VM-NO.
- **Tailscale live panel** (accounts, exit nodes, Mullvad picker, peers, copy popup, Taildrop, operator authorization via pkexec) and **Dropbox live panel**
  (login URL, pause/resume, usage, recent files) — require the CLIs and accounts; only the "not installed" states are tested. VM-NO.
- **Agents with real data** (limits, balance, tokens by day/model, provider chips, sync merge) — requires Claude/Codex/Fireworks credentials and usage. VM-NO.
- **Captive portal** (`connectivity === "portal"`, urgent icon/tooltip, Open Captive Portal) — cannot be simulated behind QEMU NAT. VM-NO.
- **Menu rows whose actions are destructive or long** (Uninstall confirm, Remove › *, Install › * floating installers, Update › Omarchy, Channel switch, Reset Computer,
  Direct Boot, Drive Encryption/User password, Shutdown/Reboot/Logout/Suspend) — the menu-side rendering is covered; the actions belong to the update/system/install reviewers
  or would destroy the shared disk.
- **Menu Bar → Position Bottom/Right** and vertical-bar clock formats (`VERTICAL_CLOCK_FORMATS`) — only Left/Top are exercised; Bottom/Right follow the same code path
  (could be added if budget allows).
- **`omarchy-menu-images` flag surface** (`--print-name`, `--show-labels` on arbitrary directories, an empty directory, no-argument usage) — dropped as a
  separate test after calibration: the user stories (theme/background pick, cancel) are covered; the bare CLI flags are a developer surface.
- **`omarchy-menu-file` / `omarchy-menu-share`** pickers — file selection through `omarchy-file-select`/LocalSend belongs to the share reviewer.
- **MultiSelect** (`shell/Ui/MultiSelect.qml`) — not instantiated by any reviewed plugin or the gallery; only reachable through bar widget settings forms (other reviewer).
- **PointerMoveGate initial-sample rule** — asserted indirectly in `menu-mouse-navigation-and-scrim-close`; the exact "no hover on open until motion" timing is hard to
  prove from screenshots alone.
- **Clipboard `Alt+Enter` on text (editor) and image (tensaku-edit) entries**, `file://` list rows ("N files"), 8 KiB display cap — not scripted; the URL open path is covered.
- **Weather unit override / imperial detection**, `refreshMinutes`, IPC `edit` — settings-form driven; only default behaviour is tested.
- **Guard batch timing** (menu opening on stale guard answers for one open) — observed and documented; a deterministic test would need a timed default change while the
  menu is closed, which the driver cannot orchestrate precisely.
