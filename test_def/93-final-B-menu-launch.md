# Menu and launch — final tests

This domain covers the Omarchy Menu as a user experiences it (opening and closing by hotkey and
by the bar logo, the System submenu, keyboard and pointer navigation, type-to-search with parent
paths and the two-stage Escape, Backspace-back, guards that hide, dim and tick rows with the
reopen-twice lag, the route hotkeys and aliases, the user extension JSONC and its silent failure,
the dmenu/select/input/file/image contract), the keybindings viewers (`Super+K`, tmux, herdr), About,
Learn, the Apps launcher (search ranking, hidden entries, launch, Delete key), the `omarchy-launch-*`
chords for terminal, files, browser, editor and calculator, the floating presentation terminal,
the Share/Transcode pickers and the Nautilus context menu, `xdg-open` defaults, the agent launcher
without a default agent, and the browser screen-share picker. 121 source blocks → 32 tests built
from 99 blocks; 22 blocks were moved to the domains that already hold the same story (security
toggles, DNS, shell supervisor, reminders, emoji, tray, nightlight, bar hide, boot menu, autostart,
plugin URL guard, ASCII transcode, gaming, OpenClaw, GUI-app sweep, disk usage); nothing was dropped
and nothing in this slice is VM-NO. Notable merges: seven reviewers' menu open/close/search/back
blocks became three navigation tests; six keybindings-viewer blocks became three; four About
blocks became one; four extension-JSONC blocks became one; the synthesis fix-up from 00-PLAN.md is
applied — `Update → Timezone` from the menu is asserted to **succeed without a password**
(`etc/sudoers.d/omarchy-tzupdate`, present since 4.0.2), which also makes 31's cancel-only test a
full VM-OK test. Facts applied throughout: the stock default terminal is **foot** (22 and 61 wrote
Alacritty; Alacritty/Kitty/Ghostty are not installed, so picking them launches an installer), the
root rows are Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System.
`03-INTENDED-BEHAVIOUR.md` landed during synthesis and its verdicts are applied: item 19 (saving a
Hyprland config file applies by autoreload — the editor test proves a `:wq` rescale with no reload
command and the Hyprsunset restart on quit), item 7 (`Super+Ctrl+Alt+B` asserts "no toast or `No
battery`" and records the empty-headline toast as the defect), item 17 (`Super+Shift+B` is intended),
item 25 (the `agent` group string is a recorded stale-string defect), item 26 (inline `//` dropping
every user entry is the documented limitation), item 30 (Delete leaves `~/.config`, expected), (a)
`Super+Escape` is the System submenu, (b) the lock screen has no clock, and A1 (Defaults list every
option and install a missing one when picked).

Routing pass: 17 blocks moved here by other synthesizers (121 + 17 = 138 accounted). Three were
folded into existing tests (the tmux cheat-sheet into the keybindings viewer, the keyboard-only
bar-position walk into submenu navigation, the About/Screensaver action-row dispatch into the About
test); fourteen became five new tests — nightlight (3 blocks; VM-OK, the tint is visible in
screenshots), shell restart + supervisor relaunch/give-up (3), Docker TUI behind polkit (3), TUI
launch chords with or-focus dedupe (2) and web-app install/launch/remove from the menu (3, NET).
H and B moved their nightlight and shell-restart blocks at each other; B's originals stay listed
under "Moved" (H) and the incoming ones are built here, so the orchestrator can fold
`10:nightlight-toggle-hotkey-status`, `22:launch-shell-supervisor-recovers` and
`25:restart-shell-from-menu` into `nightlight-toggle-hotkey-menu-and-status` and
`shell-restart-from-menu-and-supervisor-relaunch` wherever they land. No incoming block is touched by a
DEFECT or MANUAL-INTENDED verdict; (a) and (b) are applied as caveats.

## Tests

### menu-open-close-hotkey-and-bar-logo   [VM-OK]
description: The Omarchy Menu opens from Super+Space (a second press closes it) and from a left click on the bar's Omarchy logo, closes again from Escape, a second logo click or a click on the scrim, and the logo's right click opens a terminal while a middle click does nothing — the entry point every other test relies on, by keyboard and by mouse.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space.
  ** A dark scrim covers the screen and a narrow centred card appears with the greyed header "Go…" and the rows Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System in that order; submenu rows end with "›".
  ** A freshly opened menu may have no row settled yet: the first Return only places the cursor, the second activates.
  * Press Down three times, then Up once. The highlight must land on Style, then on Trigger. Press Escape: menu and scrim vanish and the desktop is exactly as before.
  * Press Super+Space, then Super+Space again. The menu opens and then closes (the chord toggles).
  * Press Super+Alt+Space. The header reads "Apps…" and installed applications are listed alphabetically with icons. Press Escape.
  ** The Apps list can take a second to fill the first time; take a second screenshot if it looks empty.
  * Using the mouse only, left-click the Omarchy logo glyph at the far left of the top bar (about x=0.01, y=0.01). The root menu "Go…" opens. Click the same spot again: the menu closes (the scrim swallows the click, which counts as closing). Click the logo once more, then click on the dark scrim far from the card: the menu closes.
  * Right-click the logo. A terminal window opens (not the menu), tiled.
  ** Press Super+Shift+2: the terminal moves to workspace 2 and the view follows. Left-click the workspace "1" indicator in the bar: workspace 1 (empty) becomes active; left-click "2": the terminal is back. Press Super+W to close it.
  * Unhappy path: middle-click the logo. Nothing happens; a following left click still opens the menu. Press Escape.
  * Left-click the logo once more and press Escape: the menu still opens and closes; the desktop is exactly as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Space is <M-SPACE>, Super+Alt+Space is <M-A-SPACE>. The card fades in and out over ~140 ms; ./client-with-image is useful for every keypress here.
  * The logo is roughly the leftmost 3 % of the bar and the cursor becomes a pointing hand over it; move the mouse first and screenshot to confirm the position before clicking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with all ten rows in order under the "Go…" header, and one with the highlight on Trigger
  ** Screenshots of the desktop after Escape, after the second Super+Space, after the second logo click and after the scrim click (no menu, no scrim)
  ** Screenshot of the "Apps…" list, of the terminal after the right click, of the workspace switching by click, and of the bar with the pointer on the logo after the middle click with nothing open
  ** The mouse was used for every logo step; no hotkey stood in
  * If unsuccessful
  ** Screenshot of what is on screen after the failing key or click, showing the pointer position; note whether the bar is still present (a shell crash takes it too) and the tail of ./client get-serial
covers: shell/plugins/menu/Menu.qml (openRoute, keyCatcher, scrim MouseArea, apps sort); shell/plugins/menu/BarWidget.qml; shell/plugins/bar/widgets/Workspaces.qml; config/omarchy/shell.json bar.layout.left; default/hypr/bindings/utilities.lua:1-2; default/omarchy/omarchy-menu.jsonc root entries; manual/03:13, manual/05:19-20
merged-from: 31:menu-open-and-close-hotkey-and-mouse; 22:menu-root-super-space; 22:menu-open-from-bar-click; 30:menu-widget-left-and-right-click; 10:bar-menu-widget-left-right-click

### menu-system-super-escape-cancels   [VM-OK]
description: Super+Escape opens the Omarchy Menu at the System submenu with the power actions, Escape closes it without executing anything even with Shutdown highlighted, and Backspace steps back to the root instead of closing — the guard against an accidental shutdown from a stray key.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape. Within 15 seconds a centred card with the header "System…" must appear listing Screensaver, Lock, Suspend, Logout, Reboot, Shutdown.
  ** Hibernate must be absent (the VM has no swap); if a Hibernate row is present between Suspend and Logout, report it as a finding about the VM, not a driver error.
  * Press Escape. Within 15 seconds the menu must be gone. Screenshot again after 10 seconds: the desktop is still running, no lock screen, no logout.
  * Press Super+Escape, then Down until `Shutdown` is highlighted, then Escape. The menu closes and nothing fires.
  ** Do NOT press Enter on Suspend, Logout, Reboot or Shutdown; the session would be lost.
  * Press Super+Escape, then Backspace once. The header changes to "Go…" and the ten root rows Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System are listed; submenu rows end with "›". Press Escape.
  ** Backspace on an empty filter goes back a level; it does not close the menu.
  * The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This is the same menu the `lock-screen` definition uses for its Lock row; Super+Escape is <M-ESC>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "System…" card with its six rows and no Hibernate, of `Shutdown` highlighted, of the "Go…" card with the ten root rows, and of the unchanged desktop after each Escape
  * If unsuccessful
  ** Screenshot of a menu that stayed open, or of a lock/black/login screen showing an action fired; ./client get-serial if the bar vanished
covers: test/acceptance.d/shell-surfaces-test.sh:50-56; default/hypr/bindings/utilities.lua:8; default/omarchy/omarchy-menu.jsonc (system.*); shell/plugins/menu/Menu.qml goBack
merged-from: 50:menu-system-escape-cancels; 22:menu-open-super-escape-system

### menu-search-filter-and-two-stage-escape   [VM-OK]
description: Typing in the menu searches the whole tree from the current level — direct children first, deeper rows after a divider with their parent path as subtitle, scope narrowing inside a submenu — a nonsense query shows an explicit "No matches" state, and Escape clears the filter before it closes, so a mistyped search never throws the user out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, press Down twice, then Return (twice if the first press only settles the cursor). You are inside "Trigger…": Emoji, Reminder, Capture, Transcode, Share, Toggle, Speed Test. Press Backspace with nothing typed: the root list returns.
  * Type "toggle". The header shows the typed text in full brightness and only matching rows remain (Trigger › Toggle and its children such as Stay Awake, Nightlight, Menu Bar), deeper rows carrying a grey path line under the label.
  * Press Escape once: the filter clears, the full root list returns, the menu is still open. Type "keyb": "Keybindings" rows appear with their parent as subtitle (Learn first, then Setup).
  * Press Escape once, type "font". A "Font" row with subtitle "Style" and a "Font" row with subtitle "Install › Style" are separated by a thin divider, followed by rows like "Fira Code" with subtitle "Install › Style › Font". Press Escape once, move to Install, press Enter, type "font": only Install descendants remain — "Font" (subtitle Style) and the six font names, no Style › Font row.
  ** Do not press Enter on a font row; that starts a network install.
  * Press Escape once and Backspace once (back to the root). Type "theme": rows from Style, Install › Style and Remove appear with path lines and the divider. Press Backspace five times: the filter empties and the root list returns.
  * Unhappy path: type "zzqx". The list is replaced by a large glyph and the text: No matches for “zzqx”. Press Escape once: the filter clears and the root menu is shown again (menu still open). Press Escape again: the menu closes and the desktop is exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Typing goes straight into the filter; there is no search box to click. Backspace is <BS>.
  * Escape is two-stage whenever a filter is typed: first clears, second closes. Do not report the first Escape "not closing" as a bug.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Trigger submenu and the root after Backspace; the "toggle" and "keyb" results with subtitles; the root "font" search with both Font rows and the divider; the Install-scoped "font" search; the "theme" results with path lines; the "No matches for “zzqx”" state; the root after the first Escape and the bare desktop after the second
  * If unsuccessful
  ** Screenshot of the results list that did not match, of the card after typing "zzqx", or of the menu closing on the first Escape; note whether the bar is still present
covers: shell/plugins/menu/Menu.qml (setFilter, rebuildDisplay search branch, currentRows/drilldownRows, searchDivider, Keys.onPressed Key_Escape, keyCatcher Escape, empty text; lines 1129-1163); shell/plugins/menu/MenuModel.js (matchesQuery, searchScore); default/omarchy/omarchy-menu.jsonc root, style.font, install.style.font.*; default/hypr/bindings/utilities.lua:1; manual/03:9, manual/04:3, manual/14:62
merged-from: 10:omarchy-menu-open-filter-navigate; 22:menu-escape-clears-filter-then-closes; 22:menu-type-to-filter-no-matches; 22:menu-search-drills-down-with-parent-path; 31:menu-search-filter-and-no-match

### menu-submenu-navigation-keyboard-and-mouse   [VM-OK]
description: Drilling into submenus and back works from the keyboard (Enter/Right in, Backspace/Left out, nothing at the root) and from the mouse (hover highlights, click drills, scrim click closes), a submenu's title may differ from its row label with the current default ticked, a long submenu folds with a clipped last row, fades when scrolled and wraps the cursor, and a keyboard-only walk root → Style → Menu Bar → Position → Left really moves the bar and closes the menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, Down four times (Setup), Enter: header "Setup…". Press Down until "Defaults" is highlighted and press Right: header "Defaults…" with Agent, Browser, Terminal, Editor. Press Down twice and Enter on Terminal.
  ** The header reads "Default Terminal…" (a title different from the row label); rows Alacritty, Foot, Ghostty, Kitty; exactly one row ends with " ✓" (Foot on the stock disk).
  * Press Left: header "Defaults…". Move to Browser and press Enter: header "Default Browser…" with Chromium ✓, Chrome, Brave, Brave Origin, Edge, Firefox, Zen. Press Backspace: "Defaults…"; Backspace: "Setup…"; Backspace: "Go…".
  * Unhappy path: press Backspace once more at the root. Nothing changes; the menu stays open at the root.
  * Keyboard-only walk (do not use the mouse): from the root press Down three times so `Style` is highlighted, Enter: within 15 seconds the Style submenu shows Theme, Background, Unlock, Font, Menu Bar, Hyprland, Screensaver, About. Down four times (`Menu Bar`), Enter: `Position` and `Transparency`. Enter on `Position`: Top, Bottom, Left, Right. Down twice (`Left`), Enter: within 20 seconds the bar is a vertical strip on the left edge and within 15 seconds the menu has closed.
  ** The vertical clock reads as `HH`, a dash, `mm` stacked. Open a terminal with Super+Enter and type `jq .bar.position ~/.config/omarchy/shell.json; omarchy-bar position top` Enter: it prints `"left"` and within 20 seconds the bar is horizontal along the top again. Close the terminal with Super+W.
  * Press Super+Space, move to Install, Enter, then Development, Enter. Many rows (Ruby on Rails, Docker DB, JavaScript, Go, PHP, Python, Elixir, Zig, Rust, Java, .NET, OCaml, Clojure, Scala) and the card is cut off mid-row at the bottom. Press Down about eight times: the list scrolls and a fade appears at the top edge. Keep pressing Down past the last row: the highlight wraps to the first row. Press Up once: it wraps to the last row. Press PageUp: the highlight jumps six rows up. Press Escape twice.
  ** Do not press Enter on any row here — they start installers.
  * Press Super+Space. Using the mouse only: move onto the "Style" row (nudge the pointer a few pixels once over it) — it highlights — and click it: header "Style…". Click "Menu Bar", then click "Position": rows Top, Bottom, Left, Right. Do not click any of them. Click on the dark scrim far from the card: the menu closes and the bar is still at the top.
  * Click the Omarchy logo on the bar to open the menu. Move the mouse over the "Learn" row and screenshot: the highlight must follow the pointer. Click it: header "Learn…" with Keybindings, Omarchy, Hyprland, Arch, Neovim, Bash, Tmux, Herdr, Community. Click "Keybindings": the keybindings picker opens (header "Keybindings…", monospace rows). Click on the desktop outside the card: the picker closes; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Right and Enter both open the highlighted submenu; Backspace and Left only go back while no search text is typed.
  * A pointer that is already resting over the card when the menu opens does not highlight anything until it moves (by design); nudge the mouse. ./client-with-image helps confirm the highlight before each click.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing the headers "Setup…", "Defaults…", "Default Terminal…" with the single ✓ row, "Default Browser…", then "Defaults…", "Setup…", "Go…" in that order and the root still open after the last Backspace
  ** Screenshots of the keyboard walk (Style with Theme, Menu Bar, Position), the bar on the left with the menu closed, the terminal printing `"left"`, and the bar restored on top; the keyboard alone was used for that walk
  ** Screenshots of the folded Development list with a clipped last row, mid-scroll with the top fade, and the highlight after wrapping to the first and to the last row
  ** Screenshots of Style highlighted by hover, "Menu Bar…", "Position…", the desktop after the scrim click, the pointer on Learn (highlighted), the Learn submenu, the picker and the empty desktop; the mouse was used for the second half
  * If unsuccessful
  ** Screenshot showing where navigation diverged (wrong header, stuck highlight, card growing off-screen or the cursor stuck at an end), with the pointer visible; the bar that did not move or restore
covers: shell/plugins/menu/Menu.qml (setActiveMenu, goBack, Key_Backspace/Key_Left, activateIndex(fromPointer), row MouseArea, selectFromPointer, pointer gate, foldedListHeight, revealCursor, select wrap, scroll scrims); shell/plugins/menu/MenuModel.js (labelFor checked); shell/Ui/PointerMoveGate.qml; default/omarchy/omarchy-menu.jsonc (root, setup.default.terminal.*, setup.default.browser title, learn.*, install.development.*, style.*, style.bar.position.*); test/acceptance.d/menu-test.sh:65-103
merged-from: 31:menu-navigate-submenus-keyboard-and-mouse; 22:menu-back-navigation-backspace-and-left; 22:menu-mouse-only-navigation; 31:menu-long-list-fold-and-wrap; 50:menu-root-walk-bar-position-left

### menu-overlays-keep-keys-from-window-behind   [VM-OK]
description: While the menu, the emoji picker or the clipboard picker is open, typed keys go to the overlay and never to the window behind it, and focus returns to that window afterwards — so a search typed into the menu can never end up in a terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal and type (no Enter): echo before
  * Press Super+Space, type: setup  then press Escape twice. The terminal line still reads exactly "echo before".
  * Press Super+Ctrl+E (emoji picker), type: smile  then Escape twice. Terminal line unchanged.
  * Press Super+Ctrl+V (clipboard picker), type: abc  then Escape twice. Terminal line unchanged.
  * Type:  after  and press Enter. The terminal echoes "before after" — focus came back to it.
  * Type exit and Enter; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each picker's Escape is two-stage while a filter is typed (clear, then close) — hence two presses.
  * Super+Ctrl+E is <M-C-e>, Super+Ctrl+V is <M-C-v>.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots showing "echo before" intact after each overlay, and the echoed "before after"
  * If unsuccessful
  ** Terminal showing leaked characters, or typing that goes nowhere after an overlay closes
covers: shell/plugins/menu/Menu.qml, shell/plugins/emojis/Emojis.qml, shell/plugins/clipboard/Clipboard.qml (WlrKeyboardFocus.Exclusive, keyCatcher accepted events)
merged-from: 31:menu-overlay-keys-do-not-leak

### menu-route-hotkeys-aliases-and-summon   [VM-OK]
description: The dedicated chords land directly on their submenu or picker (Capture, Toggle, Share, Hardware, Reminder, Theme, Background) and the Capture route really runs the action for keyboards without a Print key; a route that is an alias for a leaf action runs it instead of opening an empty submenu; apps match search by keyword but never capture a route, so Super+Escape and `omarchy menu summon` always open the menu, never an application.
instruction: |
  <Instructions>
  From the desktop please do the following, pressing Escape (twice if a filter is set) between chords:

  <ActionList>
  * Press Super+Ctrl+C: header "Capture…" with Screenshot, Screenrecord, Text, QR Code, Color (no "Stop Screenrecording", nothing is recording). Type "screenshot", Return: the screen freezes with a crosshair exactly as with Print. Click once inside the bar: the shot snaps to the whole monitor and a toast "Screenshot saved to clipboard and file" appears.
  ** Then press Super+Space → Trigger → Capture with the arrows: the same five rows via the long route. Escape.
  * Press Super+Ctrl+O: header "Toggle…" with Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio (Battery Percentage absent). Escape. Press Super+Ctrl+S: header "Share…" with Clipboard, File, Folder, Receive. Escape. Press Super+Ctrl+H: either the card opens with header "Hardware…" and the empty-state "Nothing here yet", or it lists only Touchscreen — record which. Escape.
  * Press Super+Ctrl+R: no menu card titled "Set one…" appears; instead the reminder input flow starts (describe what appears) — the route is an alias for the leaf action. Escape. Press Super+Space → Trigger → Reminder: rows Set one, Show all, Clear all. Highlight "Show all", Enter: the menu closes and a notification about reminders appears (e.g. that there are none).
  * Press Super+Shift+Ctrl+Space: the theme picker (a list of theme names). Escape. Press Super+Ctrl+Space: the background image grid. Escape.
  ** Do not pick anything in Theme or Background; those change persisted state.
  * Press Super+Space and type "system": the first row is the System submenu (›); keyword-matched apps, if any, sit below the divider (htop ships Keywords=system). Press Escape twice, then Super+Escape: the System submenu opens, never an application. Escape.
  * Press Super+Enter and type `omarchy menu summon process` Enter: the menu opens (root or a submenu), no application launches. Escape.
  * Unhappy path: press Super+Ctrl+C, then Escape. Nothing is captured. In the terminal type `rm ~/Pictures/screenshot-*.png` Enter and press Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chords: <M-C-c>, <M-C-o>, <M-C-s>, <M-C-h>, <M-C-r>, <M-S-C-SPACE>, <M-C-SPACE>. A single click (no drag) on the capture crosshair snaps to the window or monitor under the pointer.
  * Reminder, Theme and Background chords run the row's action directly rather than opening a submenu; the reminder UI itself is another test's subject — here only "alias → action, not empty submenu" is judged.
  * Guards paint from the previous open; if Super+Ctrl+H looks wrong, close and reopen once before reporting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per chord showing the expected header or picker; the crosshair and the "Screenshot saved" toast; the long-route Capture rows; a note on the Super+Ctrl+H outcome; the reminder input rather than a menu card; the Reminder submenu and the notification after Show all
  ** Screenshot of the "system" search with System first, of the System submenu after Super+Escape, and of the menu after `summon process` with no application launched
  * If unsuccessful
  ** Screenshot of the chord that opened the wrong thing or nothing, of an empty "Set one…" card, of an app launched from a route, or of the menu with rows missing
covers: default/hypr/bindings/utilities.lua:1-8,17-18,85,89; default/omarchy/omarchy-menu.jsonc (aliases, trigger.capture.*, trigger.reminder.*, trigger.*:58-64); docs/menu.md route → action, Providers (apps never routable); shell/plugins/menu/Menu.qml (openRoute action-alias branch); test/shell.d/menu-test.sh resolveRoute; bin/omarchy-reminder; manual/07:9-11,64-80,144,158,173-175, manual/12:3,11
merged-from: 22:menu-submenu-hotkeys; 40:hypr-menu-chords-open-named-menus; 31:menu-reminder-alias-runs-action; 22:app-launcher-keywords-searchable-not-routable; 10:capture-menu-without-print-key

### menu-guards-hide-hardware-rows-on-vm   [VM-PARTIAL]
description: Rows guarded on hardware the guest lacks (hibernate, laptop display, mirror, hybrid GPU, touchpad, battery, webcam, fingerprint, Wi-Fi QR) are hidden, a fully guarded submenu shows "Nothing here yet" instead of breaking, the bar hides the matching widgets, and the touchpad/touchscreen commands fail cleanly without writing state — only the absence path exists on this VM.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape: header "System…" with Screensaver, Lock, Suspend, Logout, Reboot, Shutdown and NO Hibernate. Do not select anything. Escape.
  * Press Super+Ctrl+C: header "Capture…" with Screenshot, Screenrecord, Text, QR Code, Color and NO "Stop Screenrecording". Press Down once and Enter (Screenrecord): the card widens and lists "With no audio", "With desktop audio", "With desktop + microphone audio" — no webcam row. Escape twice.
  * Press Super+Ctrl+O: header "Toggle…" with Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio and NO "Battery Percentage". Escape.
  * Press Super+Space, Down twice (Trigger), Enter: the rows are Emoji, Reminder, Capture, Transcode, Share, Toggle, Speed Test — note whether a "Hardware" row is present. Escape. Press Super+Ctrl+H: the card opens with header "Hardware…" and, instead of rows, the empty-state glyph with "Nothing here yet" — or a lone Touchscreen row (the QEMU tablet pointer may register as a touchscreen); record which. There must be no Laptop Display, Mirror Display, Hybrid GPU, Touchpad or Touchpad Haptics row. Escape.
  * Press Super+Space and type "Laptop Display": No matches. Escape once. Repeat for "Battery Percentage", "Fingerprint" and "webcam" — No matches each. Type "QR": only Capture › QR Code appears, no Network › QR Code. Escape twice.
  * Press Super+Space → Setup → Security: Fido2, SSHD, Passwordless Sudo, Sudoless Docker are present and Fingerprint is absent. Back; Setup → Network shows only DNS. Escape.
  * Screenshot the whole bar: no battery, bluetooth or agents icon in the right section (the weather pill appears only after a network fetch).
  * Press Super+Enter and type `omarchy-hw-touchscreen; echo ts=$?` Enter — ts=0 ⇔ the Touchscreen row was shown. Type `omarchy-hw-touchpad; echo $?` → an empty line and 1. Type `hyprctl devices -j | jq '[.mice[].name, .tablets, .touch]'` → the QEMU tablet listed under mice and `[]` for tablets and touch. Type `omarchy-toggle-touchpad; echo $?` → "No touchpad device found", 1. Only if `.tablets` and `.touch` were empty and ts=1, type `omarchy-toggle-touchscreen off; echo $?` → "No touchscreen device found", 1. Type `ls ~/.local/state/omarchy/toggles/hypr/` → no `*-disabled-name` file was created. Type `omarchy-toggle-input-device mouse; echo $?` → usage, 1.
  ** If `.tablets` is not empty, the QEMU tablet was classified as a tablet on this build and `omarchy-toggle-touchscreen off` WOULD disable your pointer: do not run it; report the device name instead.
  * Press Super+Ctrl+Alt+B. Intended (03-INTENDED-BEHAVIOUR item 7): no toast, or a toast whose headline reads e.g. `No battery`. A low-urgency toast with the battery glyph and empty text is the known defect — screenshot it and report it as such. Type `omarchy-battery-status; echo exit=$?` Enter → empty output and `exit=0`. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chords: <M-C-c>, <M-C-o>, <M-C-h>, <M-C-A-b>. Guards are re-evaluated on every open and the menu paints the previous answer first; if a row looks wrong, close and reopen once before reporting.
  * If a hidden row IS present, type `omarchy-hw-laptop; echo "exit=$?"` (likewise `omarchy-hw-webcam`, `omarchy-hw-fingerprint`, `omarchy-hibernation-available`) and include the exit codes — that is a finding about the VM, not a driver error.
  * Skipped on this VM: the rows appearing on real hardware.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of System… (six rows, no Hibernate), Capture… and the three-row Screenrecord… card, Toggle… without Battery Percentage, Trigger… with the Hardware note, "Hardware…" showing "Nothing here yet" (or the lone Touchscreen row), each No matches / QR-only result, Security without Fingerprint, Network with only DNS, the bar without hardware widgets
  ** Terminal screenshot with ts= agreeing with the Hardware outcome, the error lines and exit codes, the device JSON and the empty toggles listing; the result of the battery hotkey
  * If unsuccessful
  ** Screenshot of a hardware row or widget shown without the hardware, a submenu that survived with no rows, or a blank/crashed card, plus the `omarchy-hw-*` exit codes, the device JSON and any state file created
  ** Output of `omarchy-version`
covers: default/omarchy/omarchy-menu.jsonc (system.*, trigger.capture.*, trigger.toggle.*, trigger.hardware.*, when: guards; lines 36-42,74-99); shell/plugins/menu/MenuModel.js (isVisible, guardScript, resolveRoute); shell/plugins/menu/Menu.qml (empty-state Column, cardWidth); docs/menu.md submenu hiding; bin/omarchy-hibernation-available; bin/omarchy-hw-laptop, -webcam, -fingerprint, -touchscreen, -touchpad; bin/omarchy-network-status; bin/omarchy-toggle-input-device, bin/omarchy-toggle-touchpad, bin/omarchy-toggle-touchscreen; default/hypr/disabled-input-device.lua; bin/omarchy-notification-battery; shell/plugins/panels/power/Panel.qml:204; shell/plugins/panels/bluetooth/Panel.qml:500; test/shell.d/menu-test.sh, menu-guards-test.sh, pointer-move-gate-test.sh, toggle-input-device-test.sh; manual/04-navigation.md, manual/05:11,26,28, manual/10:21, manual/13:24-26
merged-from: 31:menu-hotkey-routes-and-hidden-rows; 22:menu-hardware-guards-hide-rows; 52:menu-hides-hardware-rows-absent-in-vm; 10:bar-absent-hardware-widgets-and-menus; 25:toggle-touchpad-touchscreen-absent

### menu-guards-dim-installed-hide-absent-tick-current   [VM-OK]
description: The menu is a truthful catalogue: installed software is dimmed with a ✓ and cannot be selected under Install, absent software is hidden under Remove, the current choice is ticked under Setup → Defaults and Style → Font, and the tick follows a change of state on the next open (one lagging open is normal, more is a finding).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Terminal. The row of the terminal that is installed (Foot on the stock disk) is dimmed with a ✓; the rows for terminals not installed look normal. Press Down repeatedly: the highlight never lands on the dimmed row. Type `foot`: the search shows no selectable Foot row; press Enter: nothing launches. Escape.
  * Press Super+Space → Install → Service: Dropbox, Spotify and Signal are NOT dimmed (not installed on a stock disk). Escape. Press Super+Space → Remove: there is no row for software that is absent (for instance no Dropbox, no Sunshine); whole Remove submenus with nothing to remove are absent. Escape.
  * Press Super+Space → Setup → Defaults → Terminal: Foot ✓, Alacritty/Ghostty/Kitty unmarked. Back; Browser shows Chromium ✓; Editor shows Neovim ✓; Agent lists fourteen rows (Antigravity … Pi) with no ✓. Escape.
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/defaults && echo codex > ~/.config/omarchy/defaults/agent`. Press Super+Space → Setup → Defaults → Agent: the Codex row now carries ✓ (the guard batch re-ran on open). Do NOT select any row. Escape.
  ** ✓ reflects the previous open's guard batch: if it has not moved yet, press Escape, reopen once more and report that the marker lagged one open.
  * Round trip: type `rm ~/.config/omarchy/defaults/agent`; reopen the same submenu (twice) → no ✓ again. Escape.
  * Unhappy path: press Super+Space → Setup → Defaults → Terminal and select Alacritty. Defaults list every option whether installed or not and install a missing one when picked (03-INTENDED-BEHAVIOUR A1), so on the stock disk a floating installer terminal opens instead of an "Alacritty is now the default terminal" toast; press Ctrl+C at its password prompt to abort — the sudo prompt is the consent point. Reopen the Terminal defaults twice and press Super+Enter: record where the ✓ sits and which terminal opened (a ✓ on an uninstalled terminal is a finding). Close the new terminal.
  * Press Super+Space → Style → Font: the rows are installed monospace fonts (provider rows) with exactly one ticked. Escape and close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Guards are evaluated in one batch when the menu opens and painted from the previous evaluation; always reopen twice before asserting a ✓ moved.
  * Hover a dimmed row with the mouse to confirm the highlight does not follow it. Disabled rows are dimmed 40 %, skipped by cursor and click, and omitted from search.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Install › Terminal with the installed terminal dimmed ✓ and the highlight skipping it; Install › Service undimmed; Remove without absent rows
  ** Screenshots of Setup › Defaults › Terminal (Foot ✓), Browser (Chromium ✓), Editor (Neovim ✓), and Agent before (no ✓), with Codex ✓, and after cleanup (no ✓)
  ** Screenshot of the installer terminal after selecting Alacritty, the ✓ position afterwards and the terminal Super+Enter opened; Style › Font with one row ticked
  * If unsuccessful
  ** Screenshot of the ✓ never moving, of two rows checked, of a dimmed row being selectable, or of the wrong terminal opening; output of `pacman -Q alacritty foot ghostty kitty`
covers: docs/menu.md §Guards, §Providers, GUARD_READERS; default/omarchy/omarchy-menu.jsonc (install.terminal.*, install.service.*, setup.default.agent.*, setup.default.terminal.*, setup.default.editor.*); shell/plugins/menu/MenuModel.js (GUARD_READERS, guardPrelude, labelFor); shell/plugins/menu/Menu.qml (evaluateGuards on open); bin/omarchy-default-terminal; test/shell.d/menu-guards-test.sh
merged-from: 61:menu-guards-show-state; 22:menu-checked-markers-reflect-defaults; 31:menu-default-editor-check-moves-and-restores

### menu-catalogue-rows-match-documented-layout   [VM-PARTIAL]
description: The shipped menu keeps its documented layout on this VM — Trigger, Style, Setup (with its Network, Defaults, Plugins, Security and Config children) and Update list exactly the expected rows with the guards applied, the fourteen agents are alphabetical, Menu Bar → Position moves the bar and back, the cheap Trigger actions run, and the `power-menu`/`power_menu` aliases route to the System entries. Positive paths for Fingerprint and Wi-Fi QR are skipped (hardware absent).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger: rows Emoji, Reminder, Capture, Transcode, Share, Toggle, [Hardware], Speed Test — note whether Hardware is listed (if so open it and record its rows, at most Touchscreen). Open Capture → Color, then click anywhere on the desktop: a notification with a hex colour appears. Open Trigger → Speed Test → Disk Speed Test: a panel opens and measures; close it with Escape.
  * Press Super+Space → Style: rows Theme, Background, Unlock, Font, Menu Bar, Hyprland, Screensaver, About. Open Font: a list of font names with exactly one ✓. Back. Style → About and Style → Screensaver each list Edit Text, Set From Image, Restore Default. Back.
  * Open Style → Menu Bar → Position and select Bottom: the bar moves to the bottom edge (allow 20 s). Reopen Style → Menu Bar → Position → Top: the bar is back at the top.
  ** When the bar is at the bottom, the menu still opens with Super+Space.
  * Press Super+Space → Setup: rows Monitors, Keybindings, Input, Network, Defaults, Plugins, Security, Config, Direct Boot, and Reset Computer last only if the root disk is btrfs. Note Reset Computer's presence. Open Network: only DNS (no QR Code); DNS shows DHCP ✓, Cloudflare, Google, Custom — do not select any. Back twice.
  ** Reset Computer and Update → Channel were added after 4.0.2 and may be missing on a pristine disk; report "absent on this build", not "broken".
  * Open Setup → Defaults → Agent: exactly Antigravity, Claude, Codex, Copilot, Crush, Cursor CLI, Grok, Hermes, Muse Code, omp, OpenClaw, OpenCode, Ori, Pi, in that order, each with its own glyph and none ticked. Back; Browser shows Chromium ✓, Terminal Foot ✓, Editor Neovim ✓. Back.
  * Setup → Plugins shows exactly Enable Plugin, Disable Plugin, Add Plugin, Clone Plugin (no Remove Plugin on a fresh disk). Security shows Fido2, SSHD, Passwordless Sudo, Sudoless Docker (no Fingerprint). Config shows Hyprland, Hyprsunset, XCompose. Back to the root.
  ** Do not run Direct Boot, Reset Computer or any Security action.
  * Open Update: Omarchy, Config, Timezone are present (Channel if this build has it); Extra Themes is absent on a fresh disk. Back to the root, type `power-menu` and screenshot, then clear it (Escape once) and type `power_menu`: both show the System entries (Lock, Suspend, Logout, Reboot, Shutdown). Escape twice.
  * Press Super+Enter and type `findmnt -no FSTYPE /` Enter: btrfs ⇔ Reset Computer was present. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The search field filters as you type; Backspace on an empty field goes back one level. Rows are short; zoom the screenshot to read the agent glyphs.
  * Skipped here: screen recording, Transcode, Share and hardware toggles (other tests), and the positive Fingerprint / Wi-Fi QR paths.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Trigger rows with the Hardware note, the colour notification and the disk speed panel; Style rows, the Font list with ✓, the two branding sub-lists, the bar at the bottom and back at the top; Setup with Direct Boot (and Reset Computer last if present), Network with only DNS and the DNS rows, the Agent list in the exact order with glyphs, the three default ✓ marks, Plugins with four rows, Security without Fingerprint, Config with three rows, Update without Extra Themes, both alias searches showing the System entries; the terminal line with the root fs type
  * If unsuccessful
  ** Screenshot of a misplaced or missing row, an agent out of order, Remove Plugin or Extra Themes present on a fresh disk, the bar not moving, or an alias not routing
  ** Output of `omarchy-version`
covers: default/omarchy/omarchy-menu.jsonc (trigger.*, style.*, setup.*, update.*, providers.fonts); shell/plugins/menu/MenuModel.js (resolveRoute); docs/menu.md providers; default/fonts/omarchy/omarchy.ttf; bin/omarchy-bar; bin/omarchy-default-{agent,browser,terminal,editor}; bin/omarchy-hw-fingerprint; bin/omarchy-hw-*; bin/omarchy-network-status; bin/omarchy-menu-emoji; test/shell.d/menu-test.sh, menu-guards-test.sh; manual/04-navigation.md, manual/17-ai.md
merged-from: 52:menu-setup-catalogue-layout; 22:menu-setup-submenu-entries; 22:menu-style-submenu-entries; 22:menu-trigger-submenu-entries

### menu-toggle-rows-flip-desktop-state   [VM-OK]
description: Every Trigger → Toggle row acts and is reversible from the menu: Menu Bar hides and shows the bar (the menu keeps working while the bar is hidden), Window Gaps and 1-Window Ratio change the tiling, Nightlight tints the screen and Notifications raises the do-not-disturb indicator.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter twice so two terminals tile side by side.
  * Press Super+Ctrl+O → Window Gaps. The gaps between the windows and the screen edge change. Super+Ctrl+O → Window Gaps again restores them.
  * Press Super+Ctrl+O → Menu Bar. The bar hides. Press Super+Ctrl+O again (the menu still works with the bar hidden) and select Menu Bar: the bar returns.
  ** If the bar does not return, type `omarchy-toggle-bar` (no argument) in a terminal and report it — note that `omarchy-toggle-bar on` means "hidden on".
  * Close one terminal (Super+W) and press Super+Ctrl+O → 1-Window Ratio. The remaining window becomes narrower and centred. Toggle it again to restore.
  * Press Super+Space → Trigger → Toggle and click "Nightlight": the screen takes an orange tint (visible in the screenshot — Hyprland applies it in its renderer). Reopen and click "Nightlight" again: the tint is gone.
  * Reopen Trigger → Toggle and click "Notifications": the do-not-disturb indicator appears in the bar (no toast is sent; the indicator is concealed until hovered). Click it again: off.
  ** Each click closes the menu; reopen it for the next row.
  * Close the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+O is <M-C-o>. Compare the terminal's background colour between screenshots to spot the nightlight tint.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots for gaps, bar, ratio, nightlight and notifications, each restored
  * If unsuccessful
  ** Screenshot showing the bar not returning, a row that did nothing when clicked, or a toggle that did not revert
covers: default/omarchy/omarchy-menu.jsonc (trigger.toggle.top-bar / window-gaps / one-window-ratio / nightlight / notifications, trigger.hardware.*, trigger.capture.*); bin/omarchy-hw-laptop, bin/omarchy-hw-touchpad, bin/omarchy-hw-touchscreen, bin/omarchy-hw-hybrid-gpu, bin/omarchy-hw-webcam; bin/omarchy-menu
merged-from: 22:menu-toggle-rows-menu-bar-and-gaps; 25:hardware-and-toggle-menu-gates

### menu-extension-jsonc-hot-reload-and-broken-file   [VM-OK]
description: A user extension in `~/.config/omarchy/extensions/omarchy-menu.jsonc` adds root rows and a submenu, overrides a shipped row's label in place and is searchable by description without restarting the shell; a row whose command is missing fails harmlessly; one inline `//` comment or invalid JSON silently drops every user entry while the shipped menu keeps working; restoring the file restores the menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/extensions; cp ~/.config/omarchy/extensions/omarchy-menu.jsonc /tmp/menu.bak 2>/dev/null; echo saved=$?` Enter (the shipped file, if present, is comments only).
  * Write the extension in one command: `printf '%s\n' '{' '"hello-test": {"icon":"", "label":"Hello Test", "description":"added by test", "action":"omarchy-notification-send Hello-from-menu"},' '"personal": {"icon":"", "label":"Personal"},' '"personal.notes": {"icon":"", "label":"Notes", "action":"omarchy-notification-send Notes-row-clicked"},' '"zz-test": {"icon":"", "label":"ZZ Test", "action":"omarchy-no-such-command"},' '"style.theme": {"label":"Theme (overridden)"}' '}' > ~/.config/omarchy/extensions/omarchy-menu.jsonc` Enter.
  * Press Super+Space: the root menu has new rows "Hello Test", "Personal ›" and "ZZ Test" after System, alongside the ten shipped rows. Open Style: the Theme row reads "Theme (overridden)" in its usual position. Escape.
  ** The shell watches the file; if the rows are missing after one reopen, type `omarchy menu refresh` Enter in the terminal, reopen, and report that a refresh was required.
  * Select "Hello Test" with the mouse: a toast "Hello-from-menu". Super+Space → Personal → Notes: toast "Notes-row-clicked". Super+Space → "ZZ Test": the menu closes, nothing else happens, and Super+Space opens the menu again fine. Escape.
  * Press Super+Space and type `added`: "Hello Test" is matched by its description. Escape twice.
  * Break it: type `sed -i 's/"label":"Hello Test",/"label":"Hello Test", \/\/ inline comment/' ~/.config/omarchy/extensions/omarchy-menu.jsonc` Enter and `cat` it. Press Super+Space: "Hello Test", "Personal" and "ZZ Test" are gone AND the Style › Theme row reads plain "Theme" again, while Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System are all present, no error toast appeared, and Setup → Monitors still works (open it and quit with `:q`). Escape.
  ** Quirk: this is the documented JSONC limitation — only whole-line `//` comments are stripped; a broken user file contributes nothing, silently.
  * Type `printf '{ not json' > ~/.config/omarchy/extensions/omarchy-menu.jsonc; omarchy menu refresh` Enter and press Super+Space: the ten shipped root rows only. Escape.
  * Round trip: if saved=0, type `cp /tmp/menu.bak ~/.config/omarchy/extensions/omarchy-menu.jsonc` Enter; otherwise type `rm ~/.config/omarchy/extensions/omarchy-menu.jsonc` Enter. Press Super+Space: the stock root menu with no user rows. Escape and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icons are left empty on purpose (Nerd Font glyphs cannot be typed by the driver); the label is what matters.
  * Use the mouse to select "Hello Test" so the click path is exercised too.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with "Hello Test", "Personal ›" and "ZZ Test"; the two toasts; the Style submenu showing "Theme (overridden)"; the menu working after selecting ZZ Test; "Hello Test" found by `added`
  ** Screenshot after the inline comment and after `{ not json`: no user rows, Theme label stock, all shipped rows present, Setup → Monitors working
  ** Screenshot of the stock root menu after restoring the file
  * If unsuccessful
  ** Screenshot of the row missing even after refresh, of a user row or "Broken" label surviving the broken file, of a missing bar or a menu that will not open; `cat ~/.config/omarchy/extensions/omarchy-menu.jsonc`; whether a shell restart was required; ./client get-serial tail
covers: docs/menu.md §JSONC, §Entry schema, §Load and merge (parsing rules); default/agents/skills/omarchy/SKILL.md (menu jsonc hot-reloads); config/omarchy/extensions/omarchy-menu.jsonc; shell/plugins/menu/Menu.qml (userMenuFile FileView, rebuildItemsFromSources); shell/plugins/menu/MenuModel.js (stripJsonc, parseMenuJsonc, mergeMenuSources); bin/omarchy-menu refresh; manual/31-dotfiles.md (Adding your own menu entries)
merged-from: 61:menu-user-extension-hot-reload; 31:menu-user-extension-live-reload; 22:menu-extension-row-and-broken-file; 12:menu-extension-personal-row-and-broken-jsonc

### menu-select-and-input-dmenu-contract   [VM-OK]
description: Scripts use the menu as a dmenu: a pick prints the chosen label (glyph/subtext rows return a stable key), typed input prints the text, and Escape or a scrim click prints nothing and exits 1 — the contract that makes every menu picker (Theme, Background, Unlock, Remove Web App, Disable Plugin) treat cancel as "do nothing".
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter for a terminal and type `omarchy-menu-select Format jpg png webp; echo "exit=$?"` Enter. A small card "Format…" with rows jpg, png, webp appears. Press Down, then Enter: the terminal prints "png" and "exit=0".
  * Run the same command again and press Escape on the card: the terminal prints only "exit=1" (nothing else).
  * Type `printf 'x\tDisk\tsda\nx\tDisk\tsdb\n' | omarchy menu select Drive` Enter and pick the second row: two rows both labelled Disk with subtexts sda and sdb; the terminal prints Disk followed by a tab and sdb.
  * Type `omarchy-menu-input "Your name"; echo "exit=$?"` Enter: a card with header "Your name…" and no rows. Type `Prime Tester` and press Enter: the terminal prints "Prime Tester" and "exit=0".
  * Unhappy path: run the input command again and click on the dark scrim: the terminal prints only "exit=1". Run it once more and press Escape: "exit=1".
  * Take a screenshot of the desktop (wallpaper, bar, colours). Then, each time opening the menu with Super+Space and pressing Escape at the picker: Style → Theme (theme unchanged); Style → Background (wallpaper unchanged); Style → Unlock (no floating terminal opens); Remove → Web App, then Super+Alt+Space and type "youtube" — YouTube still listed, Escape twice; Setup → Plugins → Disable Plugin (bar unchanged). Compare with the first screenshot.
  ** Each picker is a dmenu-style card; a single Escape closes it when no filter is typed.
  * Type exit and Enter; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * While the card is open the terminal cannot receive keys; everything typed goes to the card until it closes, and the terminal output appears once it does.
  * The first column of a select row is a glyph; a plain letter is used here because Nerd Font glyphs cannot be typed by the driver.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Format…, Drive… and Your name… cards; the terminal showing png/exit=0, exit=1, Disk⇥sdb, Prime Tester/exit=0 and the two cancel exit=1 lines
  ** Screenshot of each menu picker and a final desktop screenshot matching the first
  * If unsuccessful
  ** Terminal screenshot with the wrong output or exit code, a card that will not close, or a change applied after Escape (theme switched, toast, terminal opened)
covers: bin/omarchy-menu-select (exit 1 on cancel); bin/omarchy-menu-input; shell/plugins/menu/Menu.qml (openDmenu, finishRequest, mode input); docs/menu.md "Select and input modes"; default/omarchy/omarchy-menu.jsonc style.theme/background/unlock, remove.webapp, setup.plugin.disable
merged-from: 31:menu-select-and-input-dmenu-contract; 22:menu-select-and-input-cli; 22:menu-picker-cancel-changes-nothing

### menu-file-and-image-pickers   [VM-OK]
description: The file picker lists matching files newest first and prints the chosen path, the image picker shows a thumbnail grid and prints the chosen name, and both refuse a missing argument or path with a clear message and exit 1.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy menu file "Pick" /nonexistent "png"; echo rc=$?` Enter: "Path not found: /nonexistent" and rc=1.
  * Type `omarchy menu file "Pick a background" ~/.config/omarchy/current/theme/backgrounds "jpg png webp"` Enter: a picker listing the background paths; press Enter on one and its path prints.
  * Type `omarchy-menu-images; echo rc=$?` Enter: a usage line and rc=1.
  * Type `omarchy-menu-images --print-name ~/.config/omarchy/current/theme/backgrounds` Enter: a grid of thumbnails; select one with the arrows and Enter: the name without extension prints.
  * Unhappy path: run it again and press Escape: nothing is printed. Close the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first image grid open generates thumbnails and may take a few seconds (allow 30 s); take another screenshot rather than retyping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two refusals with rc=1, the file picker, the printed path, the image grid and the printed name, and the empty output after Escape
  * If unsuccessful
  ** Terminal output at the failing command; "Image selector failed to accept request" indicates a shell IPC problem
covers: bin/omarchy-menu-file; bin/omarchy-menu-images; test/shell.d/menu-images-test.sh
merged-from: 22:menu-file-and-images-pickers

### menu-timezone-set-filter-and-cancel   [VM-OK]
description: Update → Timezone lists every system timezone in a filterable card, Escape or a scrim click leaves the clock unchanged, and choosing a zone sets it without any password prompt (the `omarchy-tzupdate` sudoers rule, present since 4.0.2) with a toast and a jumping clock — from the menu and from the terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `timedatectl show -p Timezone --value` Enter; note the zone and the bar clock.
  * Press Super+Space → Update → Timezone. A tall card "Set timezone…" lists timezones from Africa/Abidjan onward with a clipped last row (the list comes from `timedatectl list-timezones` and may take a second).
  * Type `utc`: the list narrows to "UTC" (and Etc/UTC variants). Press Down and Up: the highlight moves within the short list. Press Escape: the card closes and the bar clock is unchanged.
  * Press Super+Space → Update → Timezone again and click on the dark scrim: the card closes; the clock is unchanged.
  * Press Super+Space → Update → Timezone, type "Tokyo", Enter on Asia/Tokyo. No password prompt appears; within five seconds a toast "Timezone is now set to Asia/Tokyo" shows and the clock jumps. In the terminal type `timedatectl show -p Timezone --value` Enter → Asia/Tokyo.
  ** A sudo or polkit prompt here is a regression of the NOPASSWD rule — report it.
  * Type `omarchy-menu-timezone` Enter in the terminal; in the picker type "London", Enter: toast "Timezone is now set to Europe/London" and the clock changes, again without a password prompt; `timedatectl show -p Timezone --value` → Europe/London.
  * Restore: run `omarchy-menu-timezone` again and choose the zone noted at the start; confirm with `timedatectl show -p Timezone --value` and the clock.
  * Unhappy path: run `omarchy-menu-timezone` once more and press Escape in the picker: nothing changes. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker filters as you type; Asia/Tokyo may not be the first row — use Down to reach it.
  * Toasts fade in a few seconds; screenshot right after Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the timezone list, the filtered "utc" list, the desktop after Escape and after the scrim click with the same clock, the Tokyo and London toasts with the clock before/after, the `timedatectl` lines, and the restored zone
  ** No password or polkit prompt anywhere
  * If unsuccessful
  ** Screenshot of an empty list, a card that will not close, a password prompt, or a missing toast with the clock unchanged; ./client get-serial
covers: bin/omarchy-menu-timezone; bin/omarchy-menu-select (--width/--maxheight); default/omarchy/omarchy-menu.jsonc (update.timezone); etc/sudoers.d/omarchy-tzupdate
merged-from: 22:menu-timezone-from-menu-and-terminal; 31:menu-timezone-list-filter-and-cancel

### keybindings-viewer-opens-filters-and-variants   [VM-OK]
description: Super+K opens the searchable keybindings sheet with the core chords first and readable key names, filters as the user types, hides the Copilot key row, reaches the XF86 rows and the tmux/herdr entries at its tail, reopens quickly, and the Tmux and Herdr viewers and the Learn → Keybindings route are the same surface.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K. A picker "Keybindings…" with monospace rows "CHORD → Action" opens; the first rows are `SUPER + K → Keybindings`, `SUPER + SPACE → Omarchy menu`, `SUPER + RETURN → Terminal`, `SUPER + SHIFT + RETURN → Browser`, `SUPER + SHIFT + F → File manager` in that order.
  ** The first open builds a cache and may take a couple of seconds; screenshot again rather than retyping the hotkey.
  * Type "screenshot": only matching rows remain (e.g. `PRINT → Screenshot`). Escape once. Type "Expand": `SUPER + MINUS → Expand window left` (keycode resolved, no `code:20`). Escape once. Type "MOUSE": `SUPER + LEFT MOUSE BUTTON → Move window`. Escape once.
  * Type "code:201" (then "201"): No matches — the Copilot key duplicate is hidden. Escape once. Type "Copy URL": the static row `SHIFT ALT + L → Copy URL from Web App`. Escape once.
  * Press PageDown repeatedly to the end: the last rows are XF86 media keys, then "… → Tmux keybindings" and "… → Herdr keybindings". Unhappy path: type "qqqzzz" → No matches. Escape twice.
  * Press Super+K again: it reopens within about a second. Escape.
  * Press Super+Alt+K: picker "Tmux keybindings…" whose first row reads `PREFIX → CTRL + SPACE / CTRL + b` and later rows include `ALT + ENTER → Split pane vertically` and `PREFIX + h → Split pane vertically`. Type "session": rows like `PREFIX + C → Create session` remain; press Enter on one: the picker closes and nothing else happens (display only). Press Super+Enter and type `omarchy-menu-tmux-keybindings --print | head -5` Enter: the same rows print. Leave the terminal open.
  ** The same sheet is reachable inside tmux: press Super+Alt+Return, then Ctrl+Space followed by `?` — a popup titled "Tmux keybindings" opens inside tmux showing the list in `less`; press `q`, then type `tmux kill-server` Enter and close that window.
  * Press Super+Ctrl+K: a Herdr bindings list opens. Escape until closed.
  ** Herdr and other newer chords may be absent on 4.0.2 — check the Super+K row first and report "absent on this build", not "broken"; do not fail on missing rows for newer chords.
  * Press Super+Space, type "keybindings", Return (Learn → Keybindings): the Hyprland list opens again. Escape; close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+K <M-k>, Super+Alt+K <M-A-k>, Super+Ctrl+K <M-C-k>. The viewer's filter is focused on open; typing filters immediately. Ctrl+Space is <C-SPACE>; `?` is Shift+/. Ctrl+Space is also the stock fcitx5 trigger — if the prefix seems swallowed, `Alt+Enter` (split) tells a swallowed prefix from a broken tmux.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the top five rows in order, the screenshot filter, the MINUS row, the mouse row, No matches for code:201, the Copy URL row, the tail rows, the "qqqzzz" No matches, the quick reopen, the Tmux list with the PREFIX row and the `session` filter, its --print output, the in-tmux `?` popup, the Herdr list (or the absence note), and the Learn route
  * If unsuccessful
  ** Screenshot of the picker (or nothing) after the hotkey, a row showing `code:20`/`__lua`, or an empty list; `omarchy-menu-tmux-keybindings --print | head -20 | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-menu-keybindings (prioritize_entries, parse_keycodes, static_bindings, code:201, cache, line 310); bin/omarchy-menu-tmux-keybindings; bin/omarchy-menu-herdr-keybindings; default/hypr/bindings/utilities.lua:10-12; default/omarchy/omarchy-menu.jsonc:45,51, learn.tmux-keybindings; config/tmux/tmux.conf:8; test/shell.d/keybindings-menu-test.sh; manual/03:57, manual/07:3, manual/15-terminal.md:15
merged-from: 22:keybindings-viewer-opens-and-filters; 10:keybindings-menu-super-k-variants; 22:tmux-keybindings-viewer; 40:hypr-keybindings-viewer-super-k; 11:tmux-keybindings-cheatsheets

### keybindings-viewer-runs-selected-binding   [VM-OK]
description: Selecting a row in the keybindings viewer runs that binding — a launcher, a Lua dispatcher toggle and the lock — so users can trigger a chord they cannot remember, while Escape runs nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K, type "Terminal", highlight `SUPER + RETURN → Terminal` and press Enter. The picker closes and a terminal window opens. Leave it open.
  * Press Super+K, type "Toggle window gaps", Enter. The gaps around the terminal change. Repeat to restore them.
  * Press Super+K, type "Lock system", Enter. The lock screen appears. Type prime and Enter: the desktop returns with the terminal still there.
  ** The lock screen blanks 5 s after the last input and shows no clock or user name — only the password field; the first character typed while black both wakes it and enters the field.
  * Unhappy path: press Super+K and then Escape. Nothing runs.
  * Type exit and Enter in the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first open can take a couple of seconds while the list is built; screenshot again rather than retyping the hotkey.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the filtered list, the terminal opened from it, the gaps toggled and restored, the lock screen, the restored desktop, and the desktop after Escape with nothing launched
  * If unsuccessful
  ** Screenshot after Enter showing nothing happened, or an empty or missing list
covers: bin/omarchy-menu-keybindings dispatch_binding/dispatch_exec_binding; bin/omarchy-menu-select; shell/plugins/menu/Menu.qml (openDmenu, rebuildDmenuDisplay, applyDmenuSelection); test/shell.d/keybindings-menu-test.sh
merged-from: 22:keybindings-viewer-runs-selected-binding; 31:menu-keybindings-browser-super-k

### keybindings-viewer-merges-alternative-chords   [VM-OK]
description: Actions Omarchy binds twice on purpose share one row in declaration order ("SUPER + W / SUPER + Q → Close window"), the grave key renders as `~`, look-alike labels stay on separate rows, and the printed list keeps every arrow in one column with no row wider than its card.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K and type "Close window": exactly one row `SUPER + W / SUPER + Q → Close window` (W first). Escape once.
  * Type "scratch": `SUPER + S / SUPER + ~ → Toggle scratchpad` and `SUPER + ALT + S / SUPER + SHIFT + ~ → Move window to scratchpad`; the word `grave` appears nowhere. Escape once.
  ** The scratchpad grave aliases may be absent on 4.0.2; report "absent on this build" rather than a failure.
  * Type "Calculator": both `SUPER + CTRL + Q` and `XF86Calculator` appear (on one row or two). Escape once. Type "Reveal active": two separate rows (`ALT + TAB` and `ALT + SHIFT + TAB`), not merged. Escape twice.
  * Open a terminal with Super+Enter and type `omarchy-menu-keybindings --print | sudo tee /dev/ttyS0 >/dev/null` Enter (password prime), then read ./client get-serial: every `→` is at the same column, no line is longer than 78 characters, `→ Close window`, `→ Toggle scratchpad` and `→ Calculator` each appear once, `grave` never.
  * Type `omarchy-menu-keybindings --print | awk -F '→' '{print length($1)}' | sort -u; omarchy-menu-keybindings --print | awk '{print length($0)}' | sort -rn | head -1` Enter: a single `36`, then a number ≤ 78. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list is monospace; the "/" separator is the merge marker to look for.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each filter showing merged vs separate rows; the serial dump with one arrow column and single rows; the terminal showing `36` and a number ≤ 78
  * If unsuccessful
  ** Duplicate rows, a `grave` label, a missing chord, a wrongly merged pair, or misaligned arrows
covers: bin/omarchy-menu-keybindings alternative_chord_actions/parse_binding_records; default/hypr/bindings/tiling.lua:1-2,28-31,47-50; test/shell.d/keybindings-menu-test.sh, hyprland-default-config-test.sh (scratchpad grave aliases); manual/07-hotkeys.md
merged-from: 22:keybindings-viewer-merges-alternative-chords; 51:keybindings-menu-shared-rows

### about-window-fastfetch-sheen-and-focus   [VM-OK]
description: Root-level action rows run their program and close the menu: About opens the fastfetch summary in a floating window fitted to its content — logo left, Hardware/Software/Age boxes right with the Omarchy version and current theme — plays a moving glint over the logo without rewriting it (still when a user fastfetch config exists), closes on any key, and a second launch focuses the existing window instead of opening another; System → Screensaver takes over the screen until a key is pressed; a fresh terminal never prints fastfetch on its own.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, Down eight times (About), Enter (or type "about", Return). The menu closes and a floating, centred terminal (class `org.omarchy.about`) shows the green Omarchy ASCII logo on the left and, on the right, three boxes: `Hardware` (PC, CPU with 2 cores, GPU like `Red Hat, Inc. Virtio 1.0 GPU`, display, disk, ~4 GB memory, ~4 GB zram swap), `Software` (`OS  Omarchy <version>`, branch, channel, kernel, WM `Hyprland`, terminal `foot`, packages, theme name followed by eight coloured dots, terminal font) and `Age / Uptime / Update`; no large empty area and no clipped lines.
  * Take four screenshots about 0.4 s apart: a lighter band moves across the logo between frames while the logo's shape and text stay identical; one more screenshot after 3 s shows it settled.
  ** The glint is subtle: compare the same logo row across frames. If the first attempt shows no band, reopen once — a resize during the first paint stops the sweep by design.
  * Note the theme name shown. Press any key (q or Space): the window closes. Open Super+Space → Style → Theme: the checked theme matches the name; Escape.
  * Press Super+Enter and type `omarchy-launch-about` Enter: About reopens at the same fitted size without a visible resize jump. Click the terminal with the mouse (any key would close About) and type `omarchy-launch-about` Enter again: the existing About window is focused; there is only one About window on screen. Press a key in About to close it.
  * Type `mkdir -p ~/.config/fastfetch && cp /etc/fastfetch/config.jsonc ~/.config/fastfetch/config.jsonc` Enter, open About again and take three screenshots 0.4 s apart: the logo is completely still. Close it. Type `rm -r ~/.config/fastfetch` Enter and open About once more: it animates again; close it.
  * Press Super+Enter: only the prompt appears, no fastfetch banner. Type `fastfetch | head -12` Enter: the same layout inline. Press Ctrl+D in both terminals.
  * Press Super+Escape, then Enter on "Screensaver" (the first row): the menu closes and the whole screen is taken over by the screensaver animation. Press Space: the screensaver exits and the desktop returns exactly as left.
  ** A notification "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" would mean the default terminal is unsupported — report it. If the screensaver does not exit on a key, move the mouse, press Escape, then Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Uptime and version values vary; judge layout only. ./client-with-image lets you take the rapid frames without a separate get-image round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the About window with the logo and all three boxes legible after the menu closed; frames with the band at different positions and an unchanged logo; the theme check; a single About window after the second launch at the same size; a still logo with the user config and animation again after removing it; a fresh terminal with only the prompt and the inline fastfetch; a screensaver frame and the restored desktop
  * If unsuccessful
  ** Screenshot of a clipped, oversized, blank-OS-line, garbled or duplicated About window, logo characters changing between frames, animation despite the user config, a window that does not close, the menu staying open after an action row, or the screensaver error notification; `fastfetch --logo none | head -30 | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-launch-about; bin/omarchy-launch-or-focus-tui; bin/omarchy-launch-screensaver; bin/omarchy-branding-about-animation; etc/fastfetch/config.jsonc; default/hypr/apps/system.lua:31-33 org.omarchy.about; default/omarchy/omarchy-menu.jsonc:33 (about, system.screensaver); shell/plugins/menu/Menu.qml (applySelected → runAction); default/bashrc; test/shell.d/launch-about-test.sh, branding-about-animation-test.sh; manual/21-tuis.md:31-35, manual/41-branding.md
merged-from: 22:launch-about-dialog; 11:about-fastfetch; 41:about-fastfetch; 51:about-window-sheen; 31:menu-about-and-screensaver-actions

### menu-learn-rows-open-docs-webapps   [VM-OK] [NET]
description: Learn lists the nine documentation rows; its web rows open the right site as a chromeless web-app window (Omarchy manual, Hyprland wiki, Bash cheatsheet, the Discord invite when Discord is not installed) and its Tmux row opens the tmux keybindings picker. Page loads are small.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and open Learn. Rows exactly: Keybindings, Omarchy, Hyprland, Arch, Neovim, Bash, Tmux, Herdr, Community.
  * Select "Omarchy": a browser window with no tab strip or address bar opens on omarchy.org/manual. Close it with Super+W.
  * Learn → "Hyprland": a web-app window loads wiki.hypr.land. Learn → "Bash": web-app window on devhints.io/bash. Close each.
  ** A Chromium "not responding" dialog on 2 vCPU is not a hang: click Wait.
  * Learn → "Community": Discord is not installed, so a web-app window of the discord.gg invite page opens. Close it.
  * Learn → "Tmux": picker "Tmux keybindings…" whose first row starts with PREFIX. Escape.
  * Unhappy path: if any page cannot be reached, the window still opens with the site in its title — that still proves the launch; report the error page. Press Ctrl+Alt+Delete if any window is left; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Web-app windows take a few seconds to paint; keep screenshotting. Downloads are page loads only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the nine rows; screenshots of the four web-app windows (manual, Hyprland wiki, Bash, Discord invite) and of the tmux picker
  * If unsuccessful
  ** Screenshot after selecting the failing row, or of a window with a tab strip/address bar (not a web app)
covers: default/omarchy/omarchy-menu.jsonc learn.* (lines 32,45-53); bin/omarchy-launch-webapp; bin/omarchy-launch-discord-community; bin/omarchy-menu-tmux-keybindings; bin/omarchy-launch-about
merged-from: 22:menu-learn-submenu-entries; 10:about-and-learn-menu-entries

### apps-launcher-search-rank-and-launch   [VM-OK]
description: Super+Alt+Space is the graphical launcher: an alphabetical list with icons that omits hidden entries, a search that returns direct matches only while acronym and plain-name hits rank first, Enter launches the top hit (a GUI app tiled, a TUI in a floating terminal) and closes the menu, and a filter with no match launches nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space. Within 15 seconds the header reads "Apps…" over an alphabetical list with square image icons (Basecamp, Chromium, Discord, Disk Usage, Docker, Google Contacts, … YouTube, Zoom); the shipped web apps and TUIs show distinct icons, not a blank glyph, and the last visible row is clipped. Press PageDown twice, then PageUp twice: the list scrolls and returns to the top.
  ** The list can take a second to fill the first time. ChatGPT and Grok are hotkey-only web apps with no `.desktop` file and are absent by design.
  * Type "btop": no btop row (hidden by launcher.hides). Escape once; type "fcitx": No matches. Escape once.
  * Type "contact": the rows are direct matches only (e.g. Google Contacts); `Calculator` is not among them. Press Backspace until empty and type "gc": Google Contacts is the first row. Clear and type "obs": OBS Studio is the first row. Clear.
  * Type "omawrite": Omawrite is the top row. Press Enter: within 15 seconds the menu closes and within 60 seconds an Omawrite window is open (a rocket "Launching…" OSD may show first). Press Super+W: within 30 seconds it is gone.
  * Press Super+Alt+Space, type "calc", Enter: Omacalc opens (the menu closes; allow a few seconds). Press Super+W. Press Super+Alt+Space, type "disk", Enter: a floating terminal running dua opens; press q to quit.
  * Unhappy path: press Super+Alt+Space and type "zzqqxx": the card shows No matches for “zzqqxx”. Press Escape: the menu closes and no application launched; the desktop is exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Alt+Space is <M-A-SPACE>. Use the keyboard for the whole loop; clear a filter with repeated Backspace or one Escape — a second Escape closes the whole menu.
  * If "calc" matches nothing, filter for "term" and launch the terminal instead; say which app you launched.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the alphabetical Apps list with icons; btop and fcitx absent; `contact` without Calculator; Google Contacts first for `gc`; OBS Studio first for `obs`; Omawrite filtered and its window; the Omacalc window; the floating dua terminal; the desktop after each close; the "No matches" state and the closed menu with nothing launched
  * If unsuccessful
  ** Screenshot of an empty Apps list, a hidden entry present, a missing icon, Calculator matching `contact`, or the desktop with no window after Enter (or the menu still open after 15 seconds); ./client get-serial tail
covers: shell/plugins/menu/Menu.qml (mergeAppRows, provider apps); shell/services/AppLibrary.qml (launch, beginLaunchFeedback); shell/services/AppSearch.js; default/omarchy/launcher.hides; default/omarchy/omarchy-menu.jsonc:24 apps provider; applications/Disk Usage.desktop; default/hypr/bindings/utilities.lua:2; test/shell.d/app-search-test.sh; test/acceptance.d/shell-surfaces-test.sh:97-117; manual/03:9, manual/04-navigation.md, manual/07:10
merged-from: 31:menu-apps-search-and-launch; 10:apps-menu-launches-app; 50:apps-menu-search-launches-top-hit; 51:apps-menu-search-direct-matches; 22:menu-apps-submenu-alphabetical-hidden-entries

### apps-launcher-delete-key-removes-entry   [VM-OK]
description: Delete in the Apps menu removes an entry after an in-menu confirmation: web apps and TUIs go through their removers, a plain user desktop file is deleted silently, and `omarchy-refresh-applications` brings the stock entries back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `printf '[Desktop Entry]\nType=Application\nName=Zz Test Entry\nExec=true\n' > ~/.local/share/applications/zz-test.desktop` Enter.
  * Press Super+Alt+Space, type `zz test`, press Delete and confirm: the menu closes. Type `ls ~/.local/share/applications/zz-test.desktop` Enter: gone, and no toast appeared.
  ** The confirmation is a small yes/no inside the menu; Enter confirms.
  * Press Super+Alt+Space, type `basecamp`, press Delete and confirm. Type `ls ~/.local/share/applications/ | grep -ci basecamp` Enter → `0`; the Apps menu no longer lists Basecamp.
  * Press Super+Alt+Space, type `docker`, press Delete and confirm: the Docker TUI entry is gone the same way.
  * Type `omarchy-refresh-applications` Enter and reopen the Apps menu: Basecamp and Docker are back. Escape.
  * Unhappy path: do not delete a package-owned entry (e.g. Nautilus) — that opens an `Uninstalling …; sudo pacman -Rns …` terminal; if one opens by mistake, press Ctrl+C and report it. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Delete is <DEL>. Removing a web app or TUI this way leaves its `~/.config` state behind by design; only the launcher entry is judged here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three deletions with their confirmations, the files gone, no toast for the plain file, and the stock entries restored after the refresh
  * If unsuccessful
  ** A Delete that did nothing, a leftover desktop file, or an uninstall terminal for a user entry
covers: test/shell.d/launcher-remove-test.sh, app-search-test.sh (delete routes through the app library); bin/omarchy-remove-launcher-entry; bin/omarchy-refresh-applications; shell/plugins/menu/Menu.qml; manual/25-web-apps.md, manual/21-tuis.md
merged-from: 51:apps-menu-delete-entry

### launch-terminal-files-calculator-chords   [VM-OK]
description: The always-bound launchers start their apps: Super+Enter opens the default terminal (foot) in the focused terminal's directory, Super+Shift+F Files at home and Super+Alt+Shift+F Files in the terminal's folder (falling back to home with no terminal focused), Super+Alt+Enter the tmux session, Super+Ctrl+Enter herdr, Super+Ctrl+Q the calculator; Super+W closes and is harmless on an empty desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot: no windows are open. Press Super+Enter: within 45 seconds a terminal with a shell prompt appears, tiled. Type `omarchy-default-terminal` Enter: it prints `foot`.
  * Type `cd /tmp` Enter, then press Super+Enter again: the second terminal's prompt shows `/tmp` (type `pwd` Enter if the prompt abbreviates it). Close the second with Super+W.
  ** The cwd helper reads the focused terminal's shell directory; give it a second after `cd`.
  * Press Super+Shift+F: Files (Nautilus) opens tiled at Home (allow 15 s; GTK renders oversized at 1× — expected). Press Super+W. Focus the terminal (still in /tmp) and press Super+Alt+Shift+F: Nautilus opens showing `tmp` in its path bar. Press Super+W.
  * Press Super+Alt+Enter: a terminal with a tmux status bar and the session "Work". Type `exit` Enter until it closes. Press Super+Ctrl+Enter: a terminal running herdr; screenshot it and close the window with Super+W.
  ** Herdr may be absent on 4.0.2 — check the Super+K row first and report "absent on this build", not "broken".
  * Press Super+Ctrl+Q: the omacalc calculator floats; type `2+2` Return and see 4. Press Super+W.
  * Close the first terminal with Super+W. Unhappy path: with no terminal focused press Super+Alt+Shift+F — Files still opens (falls back to Home). Press Super+W. Press Super+W again on the empty desktop: nothing appears or crashes.
  * The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Alt+Shift+F is <M-A-S-f>, Super+Ctrl+Q is <M-C-q>, Super+Alt+Enter <M-A-ENTER>, Super+Ctrl+Enter <M-C-ENTER>. The acceptance suite matches the terminal class `^foot$`; visually it is a plain terminal with a prompt.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the foot window printing `foot`, the second terminal printing `/tmp`, Nautilus at Home and at tmp, the tmux Work session, the herdr window (or the absence note), omacalc showing 4, Files after the fallback, and the empty desktop afterwards
  * If unsuccessful
  ** Screenshot after 45 seconds with no window, of a window that would not close, or of the terminal/Nautilus in the wrong directory
covers: default/hypr/bindings/applications.lua:2-8,12-13; default/hypr/bindings/utilities.lua:13; bin/omarchy-launch-terminal, -terminal-tmux, -terminal-herdr; bin/omarchy-launch-nautilus; bin/omarchy-launch-nautilus-cwd; bin/omarchy-launch-editor; bin/omarchy-launch-browser; default/hypr/apps/browser.lua; test/acceptance.d/apps-test.sh:12-31,37; test/acceptance.d/system-test.sh:45-46; manual/04:5, manual/07:99-109
merged-from: 40:hypr-launch-terminal-browser-files; 22:launch-terminal-chords-and-cwd; 22:launch-files-and-files-cwd; 10:launch-app-hotkeys-core; 50:app-launch-terminal

### launch-browser-chords-url-follow-and-private   [VM-OK]
description: The browser chords open Chromium (Super+Shift+Enter, the undocumented alias Super+Shift+B, and Super+Shift+Alt+B for Incognito), the terminal confirms it is the default browser and http handler and rejects an unknown name, opening a URL jumps to the browser window on whatever workspace it lives while a plain or private launch stays put, and focus-by-title is refused for non-agent windows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Enter. Within 45 seconds a Chromium window appears, tiled and themed with Omarchy colours. Load `https://example.com` in the address bar: "Example Domain" (offline the error page still shows the URL — that is the proof).
  ** Without GPU acceleration it renders slowly: screenshot every 5 seconds until the tab strip is visible; click Wait on a "not responding" dialog; dismiss any first-run or sign-in bubble and report that it appeared.
  * Press Super+Shift+B: a second normal Chromium window — the chord is intended (03-INTENDED-BEHAVIOUR item 17: same as Super+Shift+Return; only the manual's hotkey table omits it). Press Super+Shift+Alt+B: a window in Incognito mode (dark "You've gone Incognito" page). Close all three with Super+W (confirm a "Close all tabs?" prompt with the mouse).
  * Open a terminal with Super+Enter and type `omarchy-default-browser; xdg-mime query default x-scheme-handler/http` Enter → `chromium` then `chromium.desktop`. Type `xdg-settings get default-web-browser; echo $BROWSER` Enter → `chromium.desktop`, `omarchy-launch-browser`.
  * Unhappy path: type `omarchy default browser bogus` Enter → `Usage: omarchy-default-browser <chromium|chrome|brave|brave-origin|edge|firefox|zen>`.
  * Press Super+1 and open Chromium with Super+Shift+Enter; wait for it. Press Super+3, open a terminal and type `omarchy launch browser https://example.com` Enter: focus jumps to workspace 1 with example.com in Chromium.
  * Press Super+3 and type `omarchy launch browser` Enter: a new Chromium window opens on workspace 3 and the desktop stays there; close it with Super+W. Type `omarchy-launch-browser --private https://example.com` Enter: an Incognito window with example.com on workspace 3; close it.
  * Type `omarchy-hyprland-focus-app '^chromium$'` Enter: focus jumps to workspace 1. Press Super+3 and type `omarchy-hyprland-focus-app Mail; echo s=$?` Enter: non-zero and focus stays on workspace 3.
  * Press Super+1 and close Chromium (Super+W); press Super+3 and close both terminals. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the terminal (mouse move + click) to refocus it after the browser takes focus. The workspace indicator in the bar shows which workspace is active. The acceptance suite matches the class `(?i)chromium`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Chromium on example.com, the second window, the Incognito window, the desktop after closing, the terminal lines (`chromium`, `chromium.desktop`, `chromium.desktop`, `omarchy-launch-browser`, the usage line), the focus jump on the URL launch, no jump for the plain and private launches, the focus-app jump, and non-zero with no jump for `Mail`
  * If unsuccessful
  ** Screenshot after 45 seconds with no window, any error dialog, focus jumping on a plain launch, no jump on a URL, or `Mail` focusing Chromium; `omarchy-launch-browser 2>&1 | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-launch-browser; bin/omarchy-default-browser; bin/omarchy-hyprland-focus-app; default/hypr/bindings/applications.lua:3,6-7; default/bash/envs:8; test/shell.d/launch-browser-test.sh, browser-env-test.sh, hyprland-focus-app-test.sh; test/acceptance.d/apps-test.sh:12-31,38; test/acceptance.d/system-test.sh:42-43,60; manual/23-browsers.md:3,11-17
merged-from: 22:launch-browser-normal-and-private; 11:browser-hotkeys-and-default-query; 50:app-launch-browser; 51:launch-browser-follows-url

### launch-editor-chord-and-config-rows-open-right-file   [VM-OK]
description: Super+Shift+N opens the default editor (Neovim in its own window), and every config-editor row in Setup and Style opens its own file in it with an "Editing config file" toast — settings are plain files: a saved Hyprland change applies on its own within seconds (Hyprland autoreload, no further command), Hyprsunset is restarted when its editor quits, a discarded edit changes nothing, and the command refuses a missing path. (03-INTENDED-BEHAVIOUR item 19: the manual's "processes restart after editing" is true in effect; tests must not demand an explicit reload.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N. Within 45 seconds a terminal window running Neovim (LazyVim dashboard or an empty buffer with a status line; app id `org.omarchy.nvim`) appears. Type `:qa!` Enter: within 30 seconds the window closes.
  ** First launch may install plugins; allow the full 45 seconds and report anything longer. If it stays open, press Super+W and report it.
  * Press Super+Space → Setup → Monitors. A low-urgency toast "Editing config file" with the path ~/.config/hypr/monitors.lua appears and a Neovim window (floating) opens on that file: first line `-- See https://wiki.hypr.land/Configuring/Basics/Monitors/`, containing `local omarchy_monitor_scale = "auto"` and `local omarchy_gdk_scale = 2`. Unhappy path: type `iBROKEN`, press Escape, type `:q!` Enter — the edit is discarded and the desktop is unchanged.
  * Press Super+Space → Setup → Monitors again and type `:%s/= "auto"/= 1.25/` Enter, then `:wq` Enter. Within 15 seconds the whole desktop rescales (bar and text larger) with no further command. Reopen Setup → Monitors, type `:%s/= 1.25/= "auto"/` Enter and `:wq` Enter: within 15 seconds the desktop is back at 1×.
  ** This is the round trip for the saved change; screenshot before and after each save.
  * Repeat, each time screenshotting the toast and Neovim's status-line filename and quitting with `:q` Enter: Setup → Keybindings (bindings.lua, first line `-- Keep only your personal keybinding overrides here…`); Setup → Input (input.lua, `-- Keep only your personal input overrides here…`); Setup → Config → Hyprland (hyprland.lua); Setup → Config → XCompose (.XCompose, may be empty); Style → Hyprland (looknfeel.lua, `-- Change the default Omarchy look'n'feel.`).
  ** The toast's path and the status-line filename must be the same file every time.
  * Open a terminal with Super+Enter and type `pgrep -o hyprsunset` Enter (note the PID, or that none is running). Press Super+Space → Setup → Config → Hyprsunset (hyprsunset.conf), quit with `:q` Enter, then type `pgrep -o hyprsunset` Enter again: a different (or newly present) PID shows that hyprsunset was restarted on quit; no error toast.
  * Type `omarchy-launch-config-editor; echo rc=$?` Enter → `Usage: omarchy-launch-config-editor <path>` and rc=1.
  * Type `nvim --headless '+qa' && echo NVIM-OK; omarchy-default-editor` Enter → `NVIM-OK` then `nvim`. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Neovim's bottom status line shows the file path; `:q!` discards changes, `:wq` saves. The toast is small and low priority, in the notification corner — screenshot right after selecting the row.
  * If Neovim shows a first-run plugin installer, wait for it to finish and take a screenshot before quitting. At 1.25× the menu still opens with Super+Space if you need it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Neovim from the chord; seven editor screenshots each with the toast path and the same filename in the status line and the expected first line; the desktop unchanged after the discarded edit, rescaled after the 1.25 save and back at 1× after the restore, with no reload command typed; the hyprsunset PID before and after; the usage line with rc=1; `NVIM-OK` and `nvim`
  * If unsuccessful
  ** Screenshot of a Neovim error banner, of a row that opened nothing or the wrong file, of an error toast, of the desktop not rescaling after `:wq`, or of the headless run's output; ./client get-serial
covers: bin/omarchy-launch-editor; bin/omarchy-launch-config-editor; bin/omarchy-default-editor; default/omarchy/omarchy-menu.jsonc (setup.monitors, setup.keybindings, setup.input, setup.config.*, style.hyprland; lines 111,126-127,187); default/hypr/bindings/applications.lua:8; config/hypr/*; test/acceptance.d/apps-test.sh:12-31,39; test/acceptance.d/system-test.sh:48-49,102-103; manual/03:39-43, manual/31-dotfiles.md, manual/33, 34, 42
merged-from: 22:menu-config-editor-entries-open-files; 10:setup-and-style-menus-open-config-editor; 12:setup-monitors-menu-opens-editor; 22:launch-editor-and-config-editor; 50:app-launch-neovim

### xdg-open-lands-in-default-apps   [VM-OK]
description: The stock defaults are wired and honoured: `xdg-open` (and the `open` alias) sends a text file to Neovim, an image to imv, a folder to Files and a URL to Chromium, the default browser/terminal/editor and http and directory handlers print the expected names, theme, background and font are configured, and a missing file errors instead of opening anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-default-browser; omarchy-default-terminal; omarchy-default-editor` Enter → `chromium`, `foot`, `nvim`. Type `xdg-mime query default x-scheme-handler/http; xdg-mime query default inode/directory` Enter → `chromium.desktop` then `org.gnome.Nautilus.desktop`.
  * Type `omarchy-theme-current; omarchy-theme-bg-current; omarchy-font-current` Enter: none prints `Unknown` or an empty line.
  * Type `echo hello > /tmp/o.txt && cp /usr/share/omarchy/default/plymouth/logo.png /tmp/o.png && open /tmp/o.txt` Enter: a terminal window with Neovim showing `hello` opens. Type `:q` Enter.
  * Type `xdg-open /tmp/o.png` Enter: imv shows the Omarchy logo in a floating window. Press `q`.
  * Type `xdg-open /tmp` Enter: Files (Nautilus) opens at /tmp (oversized GTK rendering at 1× is expected). Press Super+W.
  * Type `xdg-open https://example.com` Enter: Chromium (tabbed, with address bar) opens example.com. Press Super+W.
  * Unhappy path: type `xdg-open /tmp/does-not-exist.txt; echo rc=$?` Enter → `xdg-open: file '/tmp/does-not-exist.txt' does not exist`, `rc=2`, nothing opens.
  * Type `rm /tmp/o.txt /tmp/o.png` Enter and press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each app takes 1–3 s to appear; click the terminal to refocus it after each app opens. All the terminal output fits on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with exactly `chromium`, `foot`, `nvim`, `chromium.desktop`, `org.gnome.Nautilus.desktop` and three non-Unknown values; screenshots of Neovim with `hello`, imv with the logo, Nautilus at /tmp, Chromium on example.com, and the error with rc=2
  * If unsuccessful
  ** Screenshot of the deviating line, of the wrong application launching, an "Open with" chooser, or a "no application" error
covers: default/applications/mimeapps.list; applications/imv.desktop; default/bash/aliases (open); default/hypr/apps/system.lua media opaque rules; test/acceptance.d/system-test.sh:41-63
merged-from: 41:xdg-default-apps-open; 22:mimeapps-defaults-open-right-apps; 50:system-default-apps-and-mime

### floating-presentation-terminal-logo-done-failed   [VM-OK]
description: Every menu action that runs a command does so in a floating "Omarchy" presentation terminal centred at about 875×600 that opens with the green logo (`omarchy show logo`) and ends with a colour-coded `omarchy show done` prompt — green Done or red Failed with the exit code — waiting for a key, while Ctrl+C closes it silently; a real menu action (Update → Hardware → Audio) runs in it and the Dummy Output survives.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy show logo` Enter: the screen clears and the Omarchy block-letter logo prints in green. Type `omarchy show done` Enter: a green `●` and `Done! Press any key to close...` with the cursor waiting; press Space.
  * Type `omarchy show done 3` Enter: a red `●` and `Failed (exit code 3)! Press any key to close...`; press Space. Type `omarchy show done 0 </dev/null >/dev/null; echo "exit=$?"` Enter: the prompt still appears (it talks to `/dev/tty`); press Space; `exit=0`.
  * Type `omarchy-launch-floating-terminal-with-presentation 'echo HELLO-FLOAT'` Enter: a terminal titled "Omarchy" floats centred over the first one (about 875×600, not tiled) showing the logo, HELLO-FLOAT, a green dot and "Done! Press any key to close...". Press a key: it closes.
  * Type `omarchy-launch-floating-terminal-with-presentation 'false'` Enter: red dot and "Failed (exit code 1)! Press any key to close...". Press a key.
  * Type `omarchy-launch-floating-terminal-with-presentation 'sleep 30'` Enter, then press Ctrl+C in the floating window: it closes immediately with no Done/Failed prompt.
  * Type `systemctl --user show -p MainPID --value pipewire.service` Enter and note the PID. Press Super+Space → Update → Hardware → Audio: a floating "Omarchy" terminal shows the logo, "Restarting audio services...", then "Audio status:" followed by a `wpctl status` tree (Audio → Devices/Sinks with Dummy Output), then the Done prompt. Screenshot it and press a key to close.
  ** The floating terminal runs for a second or two; screenshot as soon as it appears and again when the Done line shows.
  * Type `systemctl --user show -p MainPID --value pipewire.service; systemctl --user is-active pipewire wireplumber pipewire-pulse; pactl list sinks short` Enter → a new PID, `active` ×3, and `auto_null` still present. Type `omarchy-restart-audio; echo $?` Enter → the same text inline and 0.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare with the tiled first terminal: the float is smaller, centred and drawn on top. ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the green logo, the green Done prompt, the red Failed prompt, the floating Omarchy terminal with logo and HELLO-FLOAT plus Done, the Failed (exit code 1) prompt, the sleep window before and after Ctrl+C, the audio floating terminal with "Restarting audio services..." and the wpctl tree, the differing PIDs, `active` ×3 and `auto_null`
  * If unsuccessful
  ** A prompt that returns without waiting, a missing logo, a terminal opening tiled or without the presentation wrapper, a float that closes without the Done frame, or "Audio services did not restart cleanly…" / "still not responding" text plus `systemctl --user status pipewire wireplumber`
covers: bin/omarchy-show-logo; bin/omarchy-show-done; bin/omarchy-launch-floating-terminal-with-presentation; bin/omarchy-restart-audio; default/hypr/apps/system.lua:2-11 floating-window tag; default/omarchy/omarchy-menu.jsonc:372 (update.config.tmux), update.hardware.audio; test/shell.d/floating-terminal-test.sh
merged-from: 22:launch-floating-terminal-presentation; 40:hypr-floating-terminal-presentation-rule; 20:show-logo-and-done-prompts; 25:restart-audio-floating-terminal

### share-menu-localsend-clipboard-file-folder-receive   [VM-PARTIAL]
description: Super+Ctrl+S opens Trigger → Share with Clipboard, File, Folder, Receive: Clipboard hands the copied text to LocalSend as a temp file, Receive opens LocalSend itself floating centred at 1100×700, File and Folder open a chooser whose cancel does nothing, the CLI prints usage for a missing mode but does not validate a bogus one (recorded as a finding), and Escape launches nothing. No peer device exists, so the actual transfer is not checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo shared-text-123 | wl-copy` Enter.
  * Press Super+Ctrl+S. The Omarchy Menu opens on the Share submenu with rows Clipboard, File, Folder, Receive. Type "receive", Return: LocalSend opens as a floating centred window (about 1100×700, nearly the full guest height, over the terminal) with this device's name and the Receive tab. Press Super+W.
  ** LocalSend is a Flutter app rendered in software; allow 10 s per launch.
  * Press Super+Ctrl+S, type "clipboard", Return: a floating LocalSend window in "send" mode listing one `.txt` temp file and scanning for nearby devices (none found is expected). Press Super+W.
  * Press Super+Ctrl+S, type "file", Return: a "Share files" chooser dialog floats in the middle. Press Escape (or click Cancel): nothing else opens, no error toast. Press Super+Ctrl+S → Folder: a "Share folder" chooser. Cancel it.
  ** The chooser is a GTK portal dialog (rendered oversized at 1×); Cancel is bottom-left or top-left.
  * In the terminal type `omarchy share` Enter → a usage/help block for `omarchy share <clipboard|file|folder> [path...]`. Type `omarchy-menu-share; echo rc=$?` Enter → `Usage: omarchy-menu-share [clipboard|file|folder]`, rc=1. Type `omarchy share folder /tmp` Enter → LocalSend opens in send mode with `tmp`; close it.
  * Unhappy path: type `omarchy share bogus` Enter — the mode is not validated: a "Share files" chooser opens as if `file` had been given. Cancel it (Escape); nothing else opens. Record this as a finding.
  * Press Super+Space → Trigger → Share: the same four rows exist. Press Super+Ctrl+S, then Escape twice: nothing launches. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+S is <M-C-s>. Skipped here: sending to / receiving from another device (no LAN peer).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Share submenu, LocalSend floating over the terminal in receive mode, LocalSend in send mode with the clipboard `.txt` file, the cancelled file and folder choosers, the usage lines with rc=1, the folder send, the chooser opened by `bogus`, and the bare desktop after Escape
  * If unsuccessful
  ** Screenshot of the missing or tiled LocalSend window, a "Could not share — The file chooser did not open" toast, or what opened instead, plus `systemctl --user list-units | grep -i localsend`
covers: bin/omarchy-menu-share; default/hypr/bindings/utilities.lua:85,87; default/omarchy/omarchy-menu.jsonc:70,86-89 trigger.share.*; default/hypr/apps/localsend.lua; manual/03:34, manual/07:72,79, manual/12:78, manual/22-guis.md:39-54
merged-from: 10:share-menu-localsend-paths; 11:share-menu-localsend; 22:menu-share-picker-cancel; 40:hypr-share-menu-localsend-and-transcode

### transcode-picker-hotkey-menu-and-cli   [VM-OK]
description: Super+Ctrl+Period and Trigger → Transcode open the interactive flow — file picker, format menu, resolution menu — ending in a resized copy beside the original, a toast and the file URI on the clipboard; cancelling the picker does nothing and the CLI refuses a missing file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `magick -size 800x600 xc:green ~/Pictures/pick.png` Enter (the picker is empty on a fresh disk).
  * Press Super+Ctrl+Period: a shell menu titled `Transcode picture or video` lists `pick.png`. Press Escape: the menu closes, no toast; `ls ~/Pictures` still shows only `pick.png`.
  * Press Super+Space, click Trigger, click Transcode: the same picker appears — click `pick.png` with the mouse. Choose `jpg` in `Select format`, then `low` in `Select resolution` (Return each): toast `Transcoded to low jpg` / `Saved and copied to clipboard.`
  * In the terminal type `ls ~/Pictures/` Enter: `pick-low.jpg` beside `pick.png`. Type `echo ` (trailing space) then press Super+V and Return → `file:///home/prime/Pictures/pick-low.jpg`.
  * Unhappy path: type `omarchy transcode /tmp/missing.png jpg low` Enter → `File not found: /tmp/missing.png`.
  * Type `rm ~/Pictures/pick.png ~/Pictures/pick-low.jpg` Enter and press Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Period is <M-C-.>. The pickers are omarchy-shell menus: typing filters, Enter selects, Escape cancels.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker (hotkey and menu), the format and resolution menus, the toast, the `ls` with `pick-low.jpg`, the pasted file URI, and the rejection
  * If unsuccessful
  ** An empty picker although `pick.png` exists, a toast without an output file, or the failing step
covers: default/hypr/bindings/utilities.lua:87; default/omarchy/omarchy-menu.jsonc:69; bin/omarchy-transcode:131-206; manual/07:79, manual/12:12,70-74
merged-from: 20:transcode-picker-hotkey-and-menu; 10:transcode-picture-menu-and-cli

### nautilus-context-menu-transcode-and-localsend   [VM-OK]
description: Right-clicking media in Nautilus offers "Transcode" and "Send via LocalSend", text files get only LocalSend, a multi-selection offers "Transcode N items", and Transcode runs in a floating terminal that writes the outputs beside the originals.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/ntx && cp /usr/share/omarchy/default/plymouth/logo.png /tmp/ntx/pic1.png && cp /tmp/ntx/pic1.png /tmp/ntx/pic2.png && echo x > /tmp/ntx/note.txt && nautilus /tmp/ntx &` Enter.
  * Right-click `pic1.png`: the menu includes **Transcode** and **Send via LocalSend**. Press Escape.
  * Unhappy path: right-click `note.txt`: **Send via LocalSend** present, no **Transcode**. Press Escape.
  * Click `pic1.png`, Shift+click `pic2.png`, right-click: **Transcode 2 items** and **Send selected via LocalSend**. Click **Transcode 2 items**: a floating terminal prints `Transcoding /tmp/ntx/pic1.png` … and waits for a key when done; press Enter. New output files appear in the folder (record their names).
  * Right-click `pic1.png` → **Send via LocalSend**: LocalSend opens looking for nearby devices (none). Press Super+W on it.
  * Press Super+W on Nautilus; in the terminal type `rm -r /tmp/ntx` Enter and press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If both entries are missing, type `nautilus -q` in the terminal and reopen; extensions load at process start. Nautilus renders oversized at 1× (GDK_SCALE=2) — expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each context menu, the transcode terminal, the resulting files, and LocalSend launching
  * If unsuccessful
  ** Screenshot of a menu without the entries, a Transcode entry on the text file, or Nautilus crashing
covers: default/nautilus-python/extensions/transcode.py; default/nautilus-python/extensions/localsend.py
merged-from: 41:nautilus-transcode-and-localsend-menu

### browser-screen-share-preview-picker   [VM-OK] [NET]
description: `xdph.conf` enables token-by-default screencopy with the preview share picker, so a browser screen-share request opens that picker with previews, sharing a window works, and cancelling denies cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `cat ~/.config/hypr/xdph.conf` Enter → `allow_token_by_default = true` and `custom_picker_binary = hyprland-preview-share-picker`.
  * Press Super+Shift+Return and open `https://mozilla.github.io/webrtc-landing/gum_test.html`; click the "Screen capture" (or "Window") button.
  ** Click Wait on a Chromium "not responding" dialog.
  * A picker with previews of the screen and windows appears (the custom picker, not a plain list). Choose the terminal window and confirm: the page shows the shared terminal in its video element. Stop sharing.
  ** The picker is a Qt window and may take a few seconds to render previews.
  * Unhappy path: trigger the share again and cancel the picker: the page reports the permission was denied, nothing crashes.
  * Close Chromium and the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The page load is small; without GPU acceleration Chromium paints slowly — screenshot every 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The xdph.conf lines, the preview picker screenshot, the page showing the shared window, and the denied state after cancelling
  * If unsuccessful
  ** No picker appearing, a plain list picker, or the browser erroring before a picker
covers: config/hypr/xdph.conf; install/omarchy-base.packages:55,146
merged-from: 40:hypr-screen-share-picker-xdph

### nightlight-toggle-hotkey-menu-and-status   [VM-OK]
description: Night light warms the screen and lights the bar indicator from Super+Ctrl+N, the Trigger → Toggle row, a click on the indicator and the shell's `nightlight` IPC — all one shared state — with hyprsunset started on demand at 4000 K and back to 6500 K when toggled off; the status JSON, `hyprctl hyprsunset temperature` and the indicator must always agree. (The tint is visible in screenshots: Hyprland applies it in its renderer.)
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot of the plain desktop as the colour reference. Open a terminal with Super+Enter and type `omarchy-toggle-nightlight --status; omarchy-shell nightlight status` Enter: both report `"enabled":false` (temperature `null` or `6500` — hyprsunset is not running yet).
  * Press Super+Ctrl+N. Within ~3 seconds the whole screen takes on a warm orange tint and a night-light glyph appears in the bar's indicator area just left of the clock. Type `omarchy-toggle-nightlight --status; hyprctl hyprsunset temperature; pgrep -x hyprsunset && echo RUNNING` Enter → `{"enabled":true,"temperature":4000}`, `4000`, `RUNNING`.
  ** If the status JSON says enabled while the screen is not tinted, report it — the shell and hyprsunset disagree.
  * Hover the indicator area left of the clock and click the lit glyph with the mouse: the tint goes away and the glyph fades out; `omarchy-toggle-nightlight --status; hyprctl hyprsunset temperature` → `"enabled":false`, `6500`.
  * Press Super+Space → Trigger → Toggle → Nightlight: tint and glyph return and `--status` flips to true/4000. Toggle it again from the menu: status and temperature flip back to false/6500.
  * Type `omarchy-shell nightlight enable` Enter → `enabled`, indicator lit; type `omarchy-shell nightlight toggle` Enter → `disabled`, indicator gone, status false/6500. Type `omarchy-shell nightlight enable` Enter, then press Super+Ctrl+N: back to disabled (hotkey and IPC share one state).
  * Unhappy path: press Super+Ctrl+N twice more within a couple of seconds: on → off works repeatedly, the indicator ends off, `--status` agrees, no crash.
  * Close the terminal with Super+W; the desktop is untinted, as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+N is <M-C-n>. Compare screenshots side by side; the tint is unmistakable on white terminal text or the wallpaper.
  * Menu guards paint from the previous open; each Toggle click closes the menu — reopen it for the next.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: neutral desktop → orange-tinted desktop with the glyph next to the clock → neutral again with the glyph gone, for the hotkey, the indicator click and the menu row
  ** Terminal shows `--status` flipping false → true (4000) → false (6500), `RUNNING`, the IPC `enabled`/`disabled` replies and `hyprctl hyprsunset temperature` agreeing each time
  * If unsuccessful
  ** Screenshot of the untinted screen after a toggle with the `--status` output and `pgrep -x hyprsunset`, `Couldn't connect to hyprsunset`, or the indicator/hotkey/IPC disagreeing
  ** Output of `omarchy-version`
covers: bin/omarchy-toggle-nightlight; bin/omarchy-restart-hyprsunset (indirectly); shell/plugins/services/nightlight/Service.qml, NightlightModel.js; shell/plugins/bar/indicators/NightLight.qml; default/hypr/bindings/utilities.lua:32 (SUPER+CTRL+N); default/omarchy/omarchy-menu.jsonc trigger.toggle.nightlight; test/shell.d/nightlight-test.sh; manual/13-toggles-idle-screensaver.md "Night light"
merged-from: 25:toggle-nightlight-on-off; 32:nightlight-toggle-service; 52:nightlight-toggle-status; 10:nightlight-toggle-hotkey-status

### shell-restart-from-menu-and-supervisor-relaunch   [VM-OK]
description: Restarting the Omarchy shell from Update → Process → Shell brings back a fully working desktop (same wallpaper, bar, notifications, lock screen, menu, IPC), a killed shell is relaunched by its supervisor within seconds and logged, a crash loop is abandoned after six relaunches in a minute instead of spinning forever, and `omarchy-restart-shell` brings the desktop back — the most-used repair command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop (wallpaper and bar). Open a terminal with Super+Enter and type `cat /proc/$(pgrep -x quickshell)/environ | tr '\0' '\n' | grep '^QS_'; pgrep -x quickshell` Enter → `QS_DISABLE_FILE_WATCHER=1`, `QS_NO_RELOAD_POPUP=1` and the shell PID (note it).
  * Press Super+Space, click `Update`, click `Process`, click `Shell` with the mouse. The bar vanishes for a moment and returns within ~3 seconds; the wallpaper may flash but comes back identical to the first screenshot. Type `pgrep -x quickshell; omarchy-shell shell ping` Enter → a NEW pid and `ok`.
  ** If the desktop is black after the restart, wait 3 s and screenshot again before reporting a black background (that is the failure this test guards).
  * Type `omarchy-notification-send "After restart" "notifications work"` Enter → a toast appears top-right. Press Super+Ctrl+L → the lock screen (blurred copy of the same wallpaper, only the password field — no clock or user name; it blanks after 5 s); type `prime` Enter → desktop. Press Super+Space → the menu opens; Escape.
  * Type `pkill -9 -x quickshell` Enter: the bar disappears at once and is back within ~3 seconds (screenshot at 1 s and 4 s). Press Super+Space: the menu opens (the relaunched shell works); Escape. Type `journalctl --user -t omarchy-shell --no-pager | tail -1` Enter → `Omarchy shell exited with status 137; relaunching.`
  * Unhappy path: type `for i in 1 2 3 4 5 6; do pkill -9 -x quickshell; sleep 3; done; sleep 3; pgrep -x quickshell || echo shell-gone` Enter and screenshot every 5 s until it finishes (~25 s). After the sixth kill the bar does NOT come back and the terminal prints `shell-gone`. Type `journalctl --user -t omarchy-shell --no-pager | tail -1` Enter → `Giving up on the Omarchy shell after 6 relaunches in under a minute.`
  ** The terminal keeps working without the shell; only the bar, background and menu belong to it. A `pkill` error inside the loop means the shell was already gone that round; that is fine. If the bar does come back after the sixth kill, count the `relaunching` lines and report that instead.
  * Type `omarchy-restart-shell; echo "exit=$?"` Enter → the bar returns and `exit=0`. Press Super+Space → the menu opens; Escape.
  * Close the terminal with Super+W; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Double-check the mouse position before clicking the menu rows; ./client-with-image helps.
  * A missing bar for more than ~10 s after a restart is a failure (`Omarchy shell did not become ready after restart.`).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: desktop before, bar gone, bar back with the same wallpaper and a new PID, the toast, the lock and unlock, the open menu, `ok`; bar gone then back after one kill with the `relaunching.` line; bar absent after the loop with `shell-gone` and the `Giving up` line; bar back after `omarchy-restart-shell` with `exit=0` and the menu opening
  ** The menu rows were clicked with the mouse
  * If unsuccessful
  ** Bar not returning after the restart or after one kill, a black or different wallpaper, no toast, the lock hotkey dead, or the bar returning after the give-up; `journalctl --user -t omarchy-shell --since -3min --no-pager | tail -60 | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-restart-shell; bin/omarchy-launch-shell (supervisor loop, attempt budget, logger); bin/omarchy-shell; default/omarchy/omarchy-menu.jsonc update.process.shell; shell/shell.qml startup (_syncServices, keepLoaded); shell/plugins/background/Background.qml (Component.onCompleted refreshBackground); test/shell.d/restart-shell-test.sh, launch-shell-test.sh; docs/omarchy-shell.md
merged-from: 32:restart-shell-keeps-desktop-working; 32:shell-supervisor-relaunches-after-crash; 51:shell-supervisor-relaunches-and-gives-up; 22:launch-shell-supervisor-recovers; 25:restart-shell-from-menu

### launch-docker-tui-polkit-gate   [VM-OK]
description: Super+Shift+D (and the Docker launcher entry) opens lazydocker behind the Omarchy polkit dialog because the desktop user is deliberately not in the docker group: a wrong password is rejected and re-prompted, the right one opens the TUI, and Cancel or Escape fails cleanly with no TUI and no compositor error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+D. A terminal appears and over it the Omarchy polkit dialog (a small centred shell window with a shortened "Authorize running …" label) asks for prime's password to run lazydocker.
  ** The dialog may appear a second after the terminal; type the password blind if the field is not obviously focused.
  * Unhappy path: type `wrong` and press Enter. The dialog reports the failure (red "Wrong", shake) and re-prompts, or closes and the terminal says not authorized. Screenshot.
  * Type `prime` Enter (press Super+Shift+D again first if the dialog closed). lazydocker opens (panels Project / Containers / Images / Volumes) within ~10 seconds while the Docker socket activates. Press `q`; the window closes.
  ** If lazydocker says it cannot connect to the daemon, wait 5 s and press Super+Shift+D once more; record which happened.
  * Press Super+Shift+D again and click Cancel: the terminal shows pkexec's refusal ("Not authorized" or similar) and either stays at a prompt or closes; no compositor error. Close it with Super+W if it stayed.
  * Press Super+Alt+Space, type `Docker`, Enter → the same dialog; press Escape. The terminal closes with no TUI.
  * Press Super+Space → Setup → Security: "Sudoless Docker" is listed (the opt-in that would remove this gate; do not run it). Escape; the desktop is as before, no stray windows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+D is <M-S-d>. The polkit dialog is drawn by the Omarchy shell; Escape exits pkexec with 126.
  * Skipped: the sudoless (docker group) path, which needs a reboot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, the rejected wrong password, lazydocker running (or its daemon error after the retry), the refusal after Cancel, the cancelled launcher entry closing with no TUI, and the Security row
  * If unsuccessful
  ** Screenshot of lazydocker opening with no prompt (a security regression), a terminal error, or a hang after Cancel
covers: bin/omarchy-launch-docker-tui; bin/omarchy-sudo-docker; applications/Docker.desktop; default/hypr/bindings/applications.lua:16; default/omarchy/omarchy-menu.jsonc setup.security.sudoless-docker; test/shell.d/polkit-test.sh; test/acceptance.d/system-test.sh:86-100; manual/07:120
merged-from: 41:docker-tui-polkit-prompt; 22:launch-docker-tui-polkit-gate; 40:hypr-launch-docker-tui-polkit; 11:lazydocker-polkit-prompt

### launch-tui-chords-btop-cliamp-and-focus-existing   [VM-OK]
description: The TUI utility chords and their window rules: Super+Ctrl+T opens btop floating and centred (toggleable to tiled), Super+Ctrl+Q the calculator floating, Super+Shift+Alt+M the cliamp music TUI tiled; a TUI launched twice through the or-focus launcher focuses the existing window instead of opening a second (the plain launcher does not dedupe), and the launcher prints usage without arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so a tiled terminal exists. Press Super+Ctrl+T: btop appears as a floating window centred over the terminal, about 875×600. Click it and press Super+T: it tiles beside the terminal; Super+T again: floating.
  * Click the terminal and type `omarchy-launch-or-focus-tui btop` Enter: focus jumps to the existing btop; the screenshot shows exactly one btop window. Click the terminal and type `omarchy-launch-tui btop` Enter: a second btop window opens (the plain launcher does not dedupe). Press `q` in each btop to close both.
  * Press Super+Ctrl+Q: a calculator floats over the terminal; type `2+2` Enter → 4. Press Super+K, type `Calculator`: the row reads `SUPER + CTRL + Q / XF86Calculator → Calculator`. Escape. Focus the calculator and press Super+W.
  * Press Super+Shift+Alt+M: a terminal running cliamp opens tiled; record what it says about audio output (the Dummy Output or none) — it must not exit by itself.
  * Press Super+2, then Super+Shift+Alt+M again: you are brought back to the existing cliamp window, not a second one. Quit cliamp (`q` or Ctrl+C) and close its window.
  ** Newer chords may be absent on 4.0.2 — check the Super+K row first and report "absent on this build", not "broken".
  * Unhappy path: in the terminal type `omarchy-launch-or-focus; echo rc=$?` Enter → `Usage: omarchy-launch-or-focus [window-pattern] [launch-command]` and rc=1.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chords: <M-C-t>, <M-C-q>, <M-S-A-m>, Super+T <M-t>. btop redraws constantly; a mid-frame screenshot is fine. Refocus the terminal with a mouse click before typing after a TUI takes focus.
  * Playback is not exercised (no audio sink); cliamp starting and being re-focused is the story.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of floating btop, btop tiled and floating again, one btop window after or-focus and two after the plain launch, the floating calculator showing 4, the merged Calculator row, cliamp running, being pulled back to the same cliamp window, and the usage line with rc=1
  * If unsuccessful
  ** Screenshot of btop opening tiled, a duplicate after or-focus, a missing calculator, a second cliamp window, or a missing usage line
covers: default/hypr/bindings/utilities.lua:13-14,104; default/hypr/bindings/applications.lua:15; default/hypr/apps/system.lua:2-11,32; bin/omarchy-launch-tui; bin/omarchy-launch-or-focus; bin/omarchy-launch-or-focus-tui; bin/omarchy-menu-keybindings:339-346; manual/04:15; manual/07:73,77,107
merged-from: 40:hypr-launch-tui-utilities-btop-calc-cliamp; 22:launch-tui-focus-instead-of-duplicate

### webapp-install-launch-and-remove-from-menu   [VM-OK] [NET]
description: Install → Web App asks for a name and URL (https added when missing), fetches the site icon, writes a launcher entry that opens the site as a chromeless window, and Remove → Web App deletes the chosen app with a toast while its hotkey chord keeps working independently of the launcher entry; the CLI remover stays quiet on an unknown name (current behaviour, recorded) and on an empty directory, and a refresh restores the stock entries.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Web App. A floating terminal shows `Let's create a new web app…` with a `Name>` prompt. Type `Arch Wiki Probe` Enter; at `URL>` type `wiki.archlinux.org` Enter (no scheme on purpose). The icon is fetched automatically (up to ten seconds; no `Icon URL/name>` prompt), then `You can now find Arch Wiki Probe using the app launcher (SUPER + SPACE)` and `Done! Press any key to close...`. Press a key.
  ** If the favicon fetch fails, an `Icon URL/name>` prompt appears: type `omarchy-discord` (a bundled icon name) Enter and note that the automatic fetch failed.
  * Open a terminal with Super+Enter and type `grep -E '^(Exec|Icon)' ~/.local/share/applications/'Arch Wiki Probe.desktop'; ls ~/.local/share/icons/hicolor/256x256/apps/ | grep arch-wiki` Enter → `Exec=omarchy-launch-webapp "https://wiki.archlinux.org"`, `Icon=arch-wiki-probe` (or the bundled name) and `arch-wiki-probe.png`.
  * Press Super+Alt+Space, type `Arch Wiki`, Enter: a frameless (chromeless) window loads the Arch Wiki. Press Super+W.
  * Press Super+Space → Remove → Web App: a picker lists the web apps. Select **Arch Wiki Probe only**: toast `Web app removed — Arch Wiki Probe`; reopen the Apps menu (twice): it no longer finds it, and `ls ~/.local/share/applications/ | grep -c 'Arch Wiki'` → `0`.
  * Press Super+Space → Remove → Web App, type "you", Enter on YouTube: toast `Web app removed — YouTube`. Press Super+Alt+Space and type "youtube": No matches; Escape twice. Press Super+Shift+Y: youtube.com still opens as a web app (the chord is independent of the launcher entry). Close it with Super+W.
  * Unhappy path: type `omarchy-webapp-remove "Nope Not Here"; echo rc=$?` Enter → a toast still appears and rc=0 (current behaviour; record it). Type `mkdir -p /tmp/emptyapps && omarchy-webapp-remove-all /tmp/emptyapps` Enter → `Scanning for web apps in /tmp/emptyapps...` then `No web apps found.`
  * Round trip: type `omarchy-refresh-applications; rmdir /tmp/emptyapps` Enter and reopen Remove → Web App: YouTube is listed again. Escape; close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never pick a preinstalled web app in the removal picker other than YouTube (restored by the refresh). Toasts disappear after a few seconds; screenshot immediately after Enter.
  * A same-name install silently overwrites the earlier one (no duplicate check); the page loads are small.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompts, the success line, the Exec/Icon lines and icon file, the chromeless Arch Wiki window, the picker, the removal toasts, the empty `youtube` search, the YouTube window from the chord, the CLI outputs, and the restored picker
  * If unsuccessful
  ** Screenshot of the failing prompt or terminal error and `ls ~/.local/share/applications ~/.local/share/icons/hicolor/256x256/apps`
covers: bin/omarchy-webapp-install (interactive, normalize_webapp_url, fetch_site_icon); bin/omarchy-webapp-remove; bin/omarchy-webapp-remove-all; bin/omarchy-refresh-applications; default/omarchy/omarchy-menu.jsonc:212,294 (install.webapp, remove.webapp); default/hypr/bindings/applications.lua:27; test/shell.d/webapp-install-test.sh; manual/25-web-apps.md:3-9
merged-from: 22:webapp-install-interactive-happy-path; 11:install-webapp-interactive-and-remove; 22:webapp-remove-via-menu-and-cli

## Not runnable here

(none — no block in this slice is VM-NO)

## Moved to other domains
- 10:bar-hide-toggle-hotkey-menu-cli → D — bar hide/show by hotkey and CLI (`omarchy-toggle-bar on` = hidden on); D holds 25:toggle-bar-hide-show and 51:bar-hide-parks-offscreen; the Menu Bar toggle row is covered here.
- 11:launcher-gui-apps-open → F2 — an eight-app "does it open" sweep of Pinta, Aether, Omacut, LibreOffice, Disks, Moonlight, Kdenlive, OBS; that is apps-in-use, not the launcher.
- 11:retro-game-launcher-without-cores → F1 — RetroArch launcher creator and `omarchy games retro install` refusals; F1 holds 22:games-retro-install-without-cores.
- 12:autostart-lua-launch-on-start → A1 — `o.launch_on_start` runs at the next session start (logout/login); A1 holds 40:hypr-autostart-user-entry-runs-on-login.
- 12:plugin-add-rejects-bad-urls → H — the `omarchy-git-url-check` trust boundary; H holds 25:plugin-add-rejects-unsafe-urls, 51:git-url-check-refuses-transport-helpers and 20:git-url-check-accepts-and-refuses.
- 12:dns-menu-check-mark-and-custom → H — DNS provider switch and Custom prompt; H holds five DNS blocks (41:dns-preset-switch-without-password, 25:dns-switch-cloudflare-google-dhcp, 13/25/31 dns-custom-*).
- 13:dns-switch-from-menu-without-password → H — same DNS story (00-PLAN fix-up: the polkit caveat is dropped, `omarchy-dns` sudoers exists since 4.0.2).
- 20:transcode-ascii-from-logo → G2 — pure CLI branding pipeline, no picker; G2 holds 12:transcode-ascii-cli-and-reject.
- 20:reminder-show-clear-hotkeys-and-menu → D — the reminders lifecycle (set/show/clear, `--json` feeding the bar); D holds 30:reminder-show-clear-and-indicator and four more; the alias → action route is covered here.
- 22:launch-openclaw-not-onboarded → F2 — OpenClaw onboarding routing; F2 holds 20:openclaw-onboard-without-openclaw.
- 22:menu-emoji-picker-inserts → D — the emoji picker story; D holds four emoji-picker blocks (10, 31, 50, 51).
- 24:sudoless-docker-enable-and-menu-moves → H — a security toggle reached via the menu; H holds 11:sudoless-docker-opt-in-and-revert and 42:setup-sudoless-docker-toggle.
- 30:tray-icon-menu-and-manage → D — the tray drawer and manage popup; D holds 12:tray-icon-manager-right-click.
- 41:boot-menu-shows-omarchy-entries → A2 — the Limine boot menu; A2 holds the Limine/snapshot boot blocks (13, 24, 41).
- 41:sudoless-docker-menu-decline → H — same security toggle as 24's block above.
- 41:disk-usage-desktop-entry → F2 — the dua launcher entry; F2 holds 11:disk-usage-dua; the "disk → floating dua" step is kept in `apps-launcher-search-rank-and-launch`.
- 42:setup-sshd-menu-cancel-and-bad-input → H — the SSHD wizard validation and its half-hardened cancel state; H holds the sshd blocks.
- 51:dns-menu-passwordless → H — same DNS story as 12/13 above.
- 52:passwordless-sudo-toggle-from-menu → H — passwordless sudo grant/expiry; H holds seven passwordless-sudo blocks (13, 20, 24, 41, 52).

## Dropped

(none)
