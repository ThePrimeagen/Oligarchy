# D — Bar, panels, OSD, notifications, reminders, clipboard, emoji, polkit — final tests

This domain covers the Omarchy shell surfaces the user sees all day: the top bar (default widgets
and which hide on the VM, workspace indicator, clock/calendar, tray, keyboard-layout pill, indicator
cluster, drag-to-edge, the `omarchy bar` / `omarchy plugin` CLI and `shell.json`), every bar panel
(network on wired NAT where Ping "Timeout" is expected, audio on the Dummy Output, hidden
bluetooth/power, display scale/text-size, weather, the two speed-test overlays, panel numbering
`Super+Ctrl+1..9`), the OSD (`omarchy-osd` and the media keys injected with in-guest `wtype -k`; no
Caps Lock OSD), notifications (sender flags and refusals, lifetimes and floors, click actions as a
literal argv, dismiss hotkeys, history, do-not-disturb rules with no toast of its own, markup
sanitising, restart survival), reminders, the clipboard-history picker, the emoji picker (inserts,
never copies) and the polkit dialog (`pkexec true`: accept, wrong password, Escape → 126). 146 source
blocks became 45 tests (129 blocks merged); 17 blocks that clearly belong to other domains were
moved (captures, xcompose, gaps toggles, monitor/touchpad helpers, first-run scripts, the Docker TUI
and Claude-extension polkit consumers, the org notification-center plugin, the dev gallery, oomd) and
none were dropped. Largest merges: the six panel-open/close/Tab/number blocks, the six clipboard
pick/paste/filter blocks, the six emoji-picker blocks, the five do-not-disturb blocks and the five
crash-capture blocks each became one story. Synthesis fix-ups applied from 01-FACTS: `omarchy-toggle-bar
on` hides the bar; `-t` never shortens a toast below its urgency floor; audio *is* testable on the
`auto_null` Dummy Output; DND gives no toast; the weather hotkey opens a panel; the emoji picker
inserts and leaves nothing on the clipboard; the DNS pills in the network panel run passwordless
since 4.0.2 (no polkit dialog — `pkexec true` is the deterministic polkit trigger); crash capture is
silent until a default agent is named; `alacritty` is not installed, so click-command proofs use
`foot`. 03-INTENDED-BEHAVIOUR.md verdicts applied: items 14/15/16 are CODE-INTENDED (the weather
hotkey opens a panel, clipboard Return pastes, the emoji picker inserts — proofs assert the code and
say the manual is stale), item 7 is a DEFECT (the battery notice on a battery-less machine must show no
toast or a `No battery` headline; the observed empty-headline toast is recorded as the failure), and
(a) `Super+Escape` is the System submenu, so every menu path here starts from `Super+Space`.
Routing pass: 52 blocks arrived from other domains (clock/calendar and plugin-validate from A1, crash-capture
toggles and plugin list from C, reminders/emoji/tray/bar from B, battery/power widgets from F2, bar CLI and
IPC contracts from G2/H, bar put and plugin pickers from F1, dev gallery and the time notice from A2,
notification icon slot from E, replace-in-place from G1). 31 folded into existing tests, 20 became seven new
tests (clock format ring + timezone, bar CLI position/transparent/rejections, plugin clone, plugin validate,
notification icon slot, dev gallery, agent invitation), and one (`41:oomd-app-slice-candidacy`) is rerouted
to H with its runtime twin. Verdicts re-checked on the incoming blocks: item 7 (battery notice) already
asserted; item 28 (plugin clone opens the default editor) folded into `plugin-clone-clock-and-remove-restores`;
`52:reminder-rejects-invalid-minutes` used `Super+Escape` for the root menu and `41:timezone-picker-updates-clock`
used a left click for the format cycle — both corrected per (a) and the clock widget's click routing. The
tray test was retagged `VM-OK [SLOW]`: OBS Studio provides a real tray icon, and LocalSend is deliberately
never shown (the original proposal used it as the tray app).

## Tests

### bar-default-widgets-on-vm   [VM-PARTIAL]
description: The top bar renders the shipped layout — logo, workspaces 1–5, a weekday-plus-time clock, wired-network and monitor glyphs — and hides every widget whose hardware is absent (battery, bluetooth, keyboard layout, agents) instead of drawing broken icons; skipped: the content of the hidden widgets.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop and look at the bar along the top edge (about 26 px tall, y≈0.01).
  * Confirm the LEFT section shows the Omarchy logo glyph, then workspace numbers 1 2 3 4 5 with the focused one drawn as a filled marker and the others dimmed.
  * Confirm the CENTER shows the clock as weekday plus 24-hour time, e.g. `Friday 13:09`, with no date.
  ** A refresh-arrows glyph (an update is pending) and a weather glyph with a temperature may appear right of the clock within ~30 s; note which are present.
  * Confirm the RIGHT section shows a wired-network plug glyph `󰈀` (not a Wi-Fi arc, not the blocked `󰈂`) and a monitor glyph, with a speaker glyph between them (PipeWire's Dummy Output) and possibly a tray chevron before them.
  ** There must be NO battery, bluetooth, `EN` keyboard-layout or agents glyph: this machine has none of that hardware, so hiding is the expected behaviour, not a defect.
  * Hover the clock for one second: a bubble reads `Right-click to toggle format`. Move the mouse to the desktop: the bubble disappears.
  * Hover the empty bar space just left of the clock for two seconds: a row of dimmed glyphs (microphone, camera, bell, sun, bell-slash, coffee cup) fades in; move the mouse onto the desktop and it collapses again.
  * Unhappy path: any glyph rendered as a box, question mark or pink square is the failure to report; a widget missing for absent hardware is a pass. Note in words whether the speaker, weather and update glyphs were present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clock sits at x≈0.5, y≈0.01; ./client-with-image helps aim the hover and check the result at once.
  * The dictation (microphone) glyph may be absent if the voxtype status tool is not installed; report which glyphs appeared rather than failing on it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar with the logo, 1–5, clock `<Weekday> HH:MM`, ethernet glyph, speaker glyph, monitor glyph, and no battery/bluetooth/EN/agents glyph
  ** Screenshot of the clock tooltip and one with the dimmed indicator row revealed, plus a note on the speaker/weather/update glyphs
  * If unsuccessful
  ** Screenshot of the broken or unexpectedly present widget, and `./client get-serial`
covers: config/omarchy/shell.json; shell/plugins/bar/Bar.qml (tooltipWindow, setCenterSectionHovered); shell/plugins/bar/widgets/Indicators.qml; shell/plugins/panels/*/Panel.qml root `visible:` bindings; shell/plugins/bar/widgets/KeyboardLayout.qml multipleLayouts; manual/05-the-top-bar.md
merged-from: 30:bar-default-widgets-on-vm

### bar-indicators-reveal-and-toggle   [VM-OK]
description: The manual-state indicators (dictation, recording, reminder, night light, do-not-disturb, stay awake) hide until the bar centre is hovered, show tooltips in a fixed order, light up next to the clock when clicked, and share their state with the matching hotkey that turns them off again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar centre: no lit indicator glyph next to the clock.
  * Hover the empty bar space just left of the clock (x≈0.42, y≈0.01) for two seconds: six dimmed glyphs appear in this order — microphone, camera, bell, sun, bell-slash, coffee cup. Hover each for a second: tooltips `Dictate`, `Screen Recording`, `Set Reminder`, `Night Light`, `Silence Notifications`, `Stay Awake`.
  * Click the coffee cup: it is drawn solid immediately left of the clock and stays when the mouse leaves the bar; its tooltip is now `Allow Idle Lock & Screensaver` (Stay Awake on).
  * Press Super+Ctrl+I: the solid cup dims and hides once the mouse is off the bar (hotkey and indicator share state).
  * Click the sun: it becomes solid next to the clock and within two seconds the screen takes a warm/orange tint (visible in screenshots on this VM). Press Super+Ctrl+N: the sun goes away and the tint is gone.
  ** If the tint is hard to judge, open a terminal and run `hyprctl hyprsunset temperature` → `4000` while on, `6500` after the chord; `grep -E 'identity|time' ~/.config/hypr/hyprsunset.conf` → `time = 07:00`, `identity = true` (the shipped config keeps the screen untinted by default). After stay-awake is off again `omarchy-toggle-idle status` reports `"enabled":false`. Close the terminal with Super+W.
  * Hover again and click the crossed-out bell: it lights (Do Not Disturb on, no toast of its own). Click it again: off.
  * Unhappy path: move the mouse to the desktop and screenshot: all indicators hidden, none lit — the bar is exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+I is `<M-C-i>`, Super+Ctrl+N is `<M-C-n>`. Hover for a second before each screenshot; the reveal fades in.
  * Active indicators sit closest to the clock at full opacity; inactive ones show at 45 % only while hovered. The dictation glyph may be absent if voxtype is not installed — report which glyphs appeared.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: hidden row; revealed row with each tooltip; the solid cup and its tooltip; the cup gone after Super+Ctrl+I; the solid sun with the warmer screen; the sun gone after Super+Ctrl+N; the bell lit then off; the clean bar
  * If unsuccessful
  ** Screenshot of an indicator that disagrees with the action taken, or of the bar centre where nothing revealed; `./client get-serial`
covers: shell/plugins/bar/widgets/Indicators.qml (revealInactiveIndicators, defaultIndicatorEntries); shell/Ui/BarIndicator.qml; shell/plugins/bar/indicators/{StayAwake,NightLight,Dnd}.qml; bin/omarchy-toggle-idle; bin/omarchy-toggle-nightlight; config/hypr/hyprsunset.conf; default/hypr/bindings/utilities.lua:31-32 Super+Ctrl+I / Super+Ctrl+N; test/shell.d/indicator-contract-test.sh; manual/05:75-77, manual/07:187-188, manual/13:38-40
merged-from: 30:indicators-reveal-and-toggle; 10:bar-indicators-hover-and-click; 40:hypr-session-toggles-idle-nightlight

### workspaces-indicator-follows-super-number   [VM-OK]
description: The workspace widget mirrors Hyprland: the focused workspace gets the filled marker, occupied ones are bright, empty ones dim, an extra workspace appears when used, and clicking a number switches to it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the workspace numbers: `1` is the filled marker, 2–5 are dim digits.
  * Press Super+2: the marker is in slot 2 and `1` is a dim digit.
  * Press Super+Enter to open a terminal here, then press Super+1: slot 1 is marked and `2` is a BRIGHT digit (occupied) while 3–5 stay dim.
  * Left-click the `3` digit in the bar with the mouse: slot 3 is marked and the desktop is empty.
  * Press Super+7: a seventh slot appears and is marked; there is no `6`.
  * Round trip: press Super+2, close the terminal with Super+W, press Super+1: back to 1–5 with 1 marked and the rest dim, as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The digits start near x≈0.03 and are about 20 px apart; Super+digit is `<M-2>` etc. Double-check the mouse position before clicking `3`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the marker in slots 1, 2, 1 (with a bright 2), 3 and 7; the final screenshot with 1–5 only
  * If unsuccessful
  ** Screenshot where the marked slot disagrees with the workspace on screen
covers: shell/plugins/bar/widgets/Workspaces.qml (workspaceIds, focused glyph, occupied opacity, focusWorkspace); default/hypr/bindings/tiling.lua Super+1..10
merged-from: 30:workspaces-indicator-follows-super-number

### bar-toggle-hide-and-show   [VM-OK]
description: The top bar hides and comes back — from Super+Shift+Space, from Omarchy Menu → Trigger → Toggle → Menu Bar and from `omarchy-toggle-bar` — without the shell restarting: the hidden bar reserves no space and is only parked off screen, the `bar-off` flag tracks it, and the fullscreen-desktop toggle hides bar and gaps together.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; its top edge sits just below the bar. Type `hyprctl -j monitors | jq '.[0].reserved'` Enter: the top value is non-zero.
  * Press Super+Shift+Space: within 15 s the bar is gone and the terminal reaches the very top of the screen. Type `omarchy-toggle-enabled bar-off; echo "exit=$?"` → `exit=0`; `hyprctl -j monitors | jq '.[0].reserved'` → top `0`; `hyprctl -j layers | jq '.[].levels."2"[] | select(.namespace|test("bar")) | {y,h}'` → a bar layer still exists with a negative `y` (parked off screen).
  ** A missing bar is the expected state here, not a crash; a one-pixel sliver at the top edge may remain.
  * Press Super+Shift+Space again: the bar is back within 15 s with the same widgets and the terminal has shrunk below it; `omarchy-toggle-enabled bar-off; echo "exit=$?"` → `exit=1`.
  * Type `omarchy-toggle-bar on` Enter: the bar disappears. Type `omarchy-toggle-bar off` Enter: it reappears. Type `omarchy-toggle-bar on; omarchy-toggle-bar on; omarchy-toggle-bar off` Enter: it ends shown (idempotent).
  ** `on` means "hidden on" — this is the command's wording, not a bug.
  * Press Super+Space → Trigger → Toggle → Menu Bar: the bar hides from the menu; repeat the row: it returns.
  * Type `omarchy-toggle-fullscreen-desktop` Enter: the bar disappears AND the window gaps collapse (the terminal touches the screen edges); `ls ~/.local/state/omarchy/toggles/ ~/.local/state/omarchy/toggles/hypr/` shows `bar-off` and `window-no-gaps.lua`. Type `omarchy-toggle-fullscreen-desktop` Enter again: bar and gaps restored, both flags gone.
  ** If the command is missing on this build (`command not found`), report "absent on this build" and skip this step.
  * Unhappy path: after each hide, `Super+Space` must still open the menu (Escape to close it). Type `omarchy toggle bar sideways; echo "exit=$?"` → a usage line mentioning `toggle|on|off`, non-zero, and the bar stays visible. Close the terminal with Super+W: the desktop is as it started, bar visible.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar normally moves instantly; the 15-second allowance is the acceptance suite's. If it never returns, `omarchy-shell shell ping` tells a dead shell from a stuck bar.
  * If `Menu Bar` does not match in the menu search, navigate Trigger → Toggle → Menu Bar with the arrow keys; the first Return in a fresh menu only settles the cursor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots in order: bar visible with the terminal below it; hidden with the terminal at the top edge and `exit=0` / reserved `0` / the parked layer; visible again with `exit=1`; hidden and shown by `omarchy-toggle-bar on`/`off`; the menu pair; bar and gaps gone together with both flag files, then restored with none
  * If unsuccessful
  ** Screenshot of the state where the bar failed to hide or return (a stranded bar), the flag listing, the usage refusal, and the `omarchy-shell shell ping` / `omarchy-shell omarchy.bar syncHidden` output
covers: shell/plugins/bar/Bar.qml (barHidden, barHiddenProbe, omarchy.bar syncHidden); bin/omarchy-toggle-bar; bin/omarchy-toggle; bin/omarchy-toggle-enabled; bin/omarchy-toggle-fullscreen-desktop; default/hypr/bindings/utilities.lua:16 (Super+Shift+Space); default/omarchy/omarchy-menu.jsonc:95 trigger.toggle.top-bar; test/acceptance.d/session-test.sh:30-45; test/shell.d/bar-test.sh (hidden bar stays mapped, parks past its edge, reserves no space); test/shell.d/toggle-test.sh; manual/05-the-top-bar.md:106; manual/07:191; manual/13-toggles-idle-screensaver.md:18
merged-from: 30:bar-toggle-hide-and-show; 25:toggle-bar-hide-show; 50:bar-toggle-hide-reveal; 51:bar-hide-parks-offscreen; 52:toggle-bar-and-fullscreen-desktop; 10:bar-hide-toggle-hotkey-menu-cli

### bar-drag-to-edge-and-widget-reorder   [VM-OK]
description: Holding an empty patch of the bar and dragging toward another screen edge previews the target edge and relocates the bar on release (and back), while dragging a widget shows a ghost and an accent drop marker and reorders it instead of moving the bar; `omarchy bar defaults` restores the shipped layout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Move the mouse to empty bar space at x≈0.25, y≈0.01, press and hold the left button for one second: the cursor becomes a closed hand and a translucent slab outlines the current (top) edge.
  * Still holding, drag to x≈0.5, y≈0.95: the slab now outlines the BOTTOM edge. Release: the bar is along the bottom edge.
  * Press Super+Enter: the terminal tiles from the top down to just above the bar. From the bottom bar (y≈0.99) hold, drag up to y≈0.05 and release: the bar is back on top and the terminal re-tiles below it.
  * Screenshot the right section and note the order (ethernet glyph, speaker, monitor glyph). Hold the left button on the monitor glyph (x≈0.985, y≈0.01), drag left past the ethernet glyph to x≈0.93 and screenshot while holding: a faded copy of the icon follows the pointer and a thin accent-coloured vertical marker shows the landing spot. Release: the monitor glyph is now LEFT of the ethernet glyph and the bar has stayed on top.
  * Press Super+Enter then Super+W to open and close a second terminal: the new order is still there (it was persisted).
  * In the terminal type `omarchy bar defaults` Enter: it prints `Restored the default Omarchy bar` and the original order is back.
  * Unhappy path: a press that moves less than 4 px is a click and opens the monitor panel instead — press Escape and retry with a longer drag; releasing on the same edge changes nothing.
  * Round trip: type `rm -f ~/.config/omarchy/shell.json` Enter and close the terminal with Super+W; the bar is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `./client mouse hold`, then `mouse drag`, then `mouse release`; the move starts after 200 ms or 4 px, so keep the press on bar background for the edge move and on the icon for the reorder. A mid-drag screenshot shows the preview.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the bottom-edge slab preview while dragging; the bar on the bottom edge with the terminal above it; the bar back on top; the mid-drag ghost with the accent marker; the swapped order surviving a window open/close; the restored order after `omarchy bar defaults`
  * If unsuccessful
  ** Screenshot of a stuck preview slab, an unmoved bar, or a misplaced/duplicated widget
covers: shell/plugins/bar/Bar.qml (CenterGestureArea, beginBarMove/updateBarMove/finishBarMove, BarMoveGhostPanel, nearestScreenEdge, ModuleSlot.modulePointer, captureBarDragGhost, DragGhostPanel, moduleDropAtScene, dropBarModuleAtTarget); shell/plugins/bar/BarModel.nearestDropTarget; bin/omarchy-bar cmd_defaults; test/shell.d/bar-test.sh; manual/05:83
merged-from: 30:bar-drag-moves-to-screen-edge; 10:bar-drag-to-bottom-edge; 30:bar-widget-drag-reorder

### bar-custom-command-module   [VM-OK]
description: A user-declared command module in `shell.json` runs its script on an interval, shows the output in the bar with a tooltip, runs its click command, and disappears when the user file is removed — the documented way to add anything to the bar without a plugin.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy bar position top` (this creates the user `~/.config/omarchy/shell.json` without changing anything visible).
  * Type and run: `jq '.bar.layout.right += [{"id":"hello","type":"command","exec":"echo HELLO-VM","interval":5,"tooltip":"Custom module","onClick":"xdg-terminal-exec"}]' ~/.config/omarchy/shell.json > /tmp/s.json && mv /tmp/s.json ~/.config/omarchy/shell.json`
  ** Send `>` as `<GT>`; the file is watched, so no reload is needed.
  * Within three seconds the text `HELLO-VM` appears at the right end of the bar.
  * Hover it for a second: tooltip `Custom module`.
  * Left-click it: a new terminal opens. Close that terminal with Super+W.
  * Unhappy path: a shell error from the jq line (a mistyped command) leaves the bar unchanged — fix the line and rerun before reporting a shell defect.
  * Round trip: run `rm ~/.config/omarchy/shell.json`: `HELLO-VM` is gone and the bar is as found. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use ./client-with-image after typing the jq line to check it before pressing Enter.
  * `shell.json` is replace-not-merge: never hand-write a minimal file — that swaps the bar to the built-in minimal layout.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `HELLO-VM` in the bar; its tooltip; the terminal opened by the click; the bar restored after the file is removed
  * If unsuccessful
  ** Screenshot of the bar with no module and the terminal output of the jq command
covers: shell/plugins/bar/Bar.qml CustomCommandModule (exec/interval/tooltip/onClick); shell/plugins/bar/BarModel.customModuleType; docs/omarchy-shell.md "Custom bar modules"; shell/plugins/bar/README.md
merged-from: 30:bar-custom-command-module

### bar-widget-enable-disable-and-placement   [VM-OK]
description: Bar widgets are listed with `omarchy plugin list`, switched on and off with `omarchy plugin enable|disable` and the Setup → Plugins pickers (which show the id under each name) with the bar updating live — including optional service panels such as Tailscale and Dropbox whose panels report the missing CLI, and the active-window title widget added with `omarchy bar put` — and every bad id, bad section, unknown widget or attempt to place a whole bar is refused with an exact message.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin list | sudo tee /dev/ttyS0` (password `prime`): a header `ID STATE SOURCE KINDS NAME`; every id starts with `omarchy.` (`omarchy.clock enabled first-party bar-widget`, omarchy.network, omarchy.notifications, `omarchy.bar enabled first-party bar`, omarchy.audio, omarchy.microphone …), STATE is enabled/disabled, SOURCE first-party, KINDS e.g. bar-widget, service, panel. Run `omarchy plugin list --json | jq length` → ≥ 20; `omarchy plugin list --json | jq -r '.[] | select(.id=="omarchy.clock") | .enabled'` → `true`; `omarchy plugin list --help` → `Usage: omarchy plugin list [--json]`.
  * Run `omarchy plugin disable omarchy.weather`: prints `Disabled omarchy.weather`; within a couple of seconds the weather widget leaves the bar centre. Run `omarchy plugin disable omarchy.audio`: the speaker widget leaves the right section; `omarchy-shell shell listShellConfig | jq -c '[.bar.layout.right[]|.id//.]'` no longer contains `omarchy.audio`. Run `omarchy plugin enable omarchy.audio --section right`: the speaker is back.
  * Press Super+Space → Setup → Plugins → Enable Plugin: a picker `Enable plugin…` lists disabled plugins with a glyph, the name (Weather, Tailscale, Dropbox, Dev gallery …) and the id in grey underneath; choose Weather: the widget returns to the bar centre and `omarchy plugin list | grep weather` says `enabled`. Setup → Plugins → Disable Plugin → Weather removes it again; enable it once more the same way.
  * Enable Plugin → type `tail`, Enter: a new icon (a 3×3 dot grid with a cross) appears in the right section; click it: hero `Tailscale` / `TAILSCALE IS DISCONNECTED`, no on/off switch, a row `Tailscale CLI is not installed or not on PATH.`; press t: nothing changes; Escape. Enable Plugin → `drop`, Enter: a diamond icon; click it: rows `Dropbox CLI is not installed` / `Install Dropbox from the service menu` with a greyed button; Escape. Disable Plugin → Tailscale, then Dropbox: both icons disappear. Enable Plugin → Escape: the bar is unchanged.
  * Run `omarchy plugin enable omarchy.microphone --section right`: prints `Enabled and moved omarchy.microphone` and a microphone icon appears in the right section; `omarchy plugin disable omarchy.microphone` removes it. Run `omarchy plugin disable omarchy.workspaces`: the numbers 1–5 vanish from the left section; `omarchy plugin enable omarchy.workspaces`: they return (note which section they landed in).
  * Run `omarchy bar put omarchy.active-window`: prints `omarchy.active-window is on the bar` and the terminal's window title appears in the LEFT section after the workspaces (elided at 280 px, ending in `…`). Open a second terminal with Super+Enter: the title changes; hover it for a second: a tooltip with the full title; middle-click the title in the bar: the focused terminal closes. Run `omarchy plugin disable omarchy.active-window`: the title widget disappears.
  * Run `omarchy-bar put omarchy.keyboard-layout --after omarchy.clock` then `omarchy-shell shell listShellConfig | jq -c '[.bar.layout.center[]|.id//.]'`: `omarchy.keyboard-layout` sits immediately after `omarchy.clock`. Run `omarchy-bar put omarchy.keyboard-layout --section right` and re-run the jq for both sections: nothing moved and there is no second `omarchy.keyboard-layout` (put never duplicates).
  ** `omarchy bar put` is newer than 4.0.2; if it prints `Unknown Omarchy command`, report "absent on this build" and continue.
  * Unhappy path, each with `; echo "exit=$?"`: `omarchy plugin enable acme.nonexistent` → `omarchy-plugin-enable: plugin 'acme.nonexistent' is not known; run: omarchy-shell shell rescanPlugins`, `exit=1`; `omarchy plugin disable` → `plugin id is required`, `exit=1`; `omarchy plugin enable omarchy.bar --section right` → `'omarchy.bar' is a bar; it replaces the bar in use rather than taking a place in one`, `exit=1`; `omarchy plugin enable omarchy.weather nowhere` → `section must be left, center, or right`, `exit=1`; `omarchy plugin list --bogus` → `omarchy-plugin-list: unknown option: --bogus`, `exit=1`; `omarchy bar put omarchy.no-such-widget` → a message containing `is not a known widget`, non-zero. Nothing on the bar changes.
  * Round trip: run `omarchy bar defaults` (`Restored the default Omarchy bar`) then `rm -f ~/.config/omarchy/shell.json`: the shipped bar is back — weather and speaker present, no keyboard-layout, title, Tailscale or Dropbox entry. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar hot-reloads `~/.config/omarchy/shell.json`; give it two seconds after each command. Un-fullscreen the terminal (Super+F) whenever you need to see the bar; the plugin table is wide, so the serial copy is the reliable read.
  * The pickers are omarchy-menu-select overlays: arrow keys + Enter select; the picker filters on name and id, so `tail` and `drop` are enough. Menu guards paint from the previous open — reopen the picker twice before asserting a row moved.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text of the plugin table with only omarchy.* ids and omarchy.clock enabled, the jq count and the help line; the bar without and with the weather widget (CLI and picker) and without/with the speaker matching the jq output; the picker with name + id rows; the Tailscale icon and its "not installed" panel, the Dropbox icon and its login rows, the bar after both disables; the microphone icon present then absent; the workspaces gone and back; the window title in the left section, its tooltip and the terminal closed by the middle-click; the keyboard-layout entry after the clock and the unchanged config after the second put; the six refusals; the restored bar
  * If unsuccessful
  ** Screenshot of a duplicated widget, a widget that did not disappear or return, a picker missing plugins, a panel error, or the failing command's output (e.g. an IPC timeout to omarchy-shell); `omarchy-shell shell listPlugins | jq '.[] | select(.id=="omarchy.weather")'`; `cat ~/.config/omarchy/shell.json | sudo tee /dev/ttyS0` read via get-serial; `omarchy-version`
covers: bin/omarchy-plugin-list; bin/omarchy-plugin-enable; bin/omarchy-plugin-disable; bin/omarchy-menu-plugin; bin/omarchy-bar (cmd_put, cmd_defaults); shell/shell.qml (putBarWidget, setPluginEnabled, listPlugins); shell/services/PluginRegistry.setEnabled; shell/plugins/bar/widgets/ActiveWindow.qml + ActiveWindow.manifest.json defaultSection; shell/plugins/panels/tailscale/Panel.qml (missing-CLI row, Service.whichProcess); shell/plugins/panels/dropbox/Panel.qml (LoginButton texts); shell/plugins/menu/Menu.qml (dmenu subtext rows); config/omarchy/shell.json; default/omarchy/omarchy-menu.jsonc setup.plugin.enable/disable; test/shell.d/plugin-enable-test.sh; test/shell.d/menu-plugin-test.sh; test/shell.d/runtime-smoke-test.sh; manual/05:88-101,132; manual/32-shell-plugins.md (Seeing what you have; Turning them on and off)
merged-from: 12:plugin-disable-enable-weather-and-bad-ids; 25:plugin-list-enable-disable-first-party-widget; 10:bar-plugin-enable-disable-and-set; 52:plugin-enable-placement-and-bar-put; 12:plugin-list-cli; 30:bar-add-and-remove-widgets; 31:plugins-enable-and-disable-tailscale-dropbox; 32:plugin-menu-enable-disable; 22:menu-plugin-disable-and-enable

### shell-ipc-and-bar-cli-with-shell-down   [VM-OK]
description: The `omarchy-shell` IPC wrapper reaches the running shell (even from a stripped environment), lists the thirteen core plugins, drives visible UI (OSD, panels, menu, calendar) from the terminal, reports unknown targets/methods/plugins and a missing config with exact messages while `-q` silences them, and the `omarchy bar` CLI moves a widget and resets the layout; when the shell is down `omarchy-shell` says so, `omarchy bar put` still writes the config and exits 0 with a message, and the supervisor or `omarchy restart shell` brings everything back — the plumbing every Omarchy CLI relies on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-shell shell ping` → `ok`; `env -u WAYLAND_DISPLAY omarchy-shell shell ping` → `ok` (display recovered from the runtime dir); `omarchy-shell` → usage text, exit 0; `omarchy-shell --help | head -3` → the usage; `omarchy-shell shell; echo "exit=$?"` → `Usage: omarchy-shell <target> <method> [args...]`, `exit=1`. Screenshot the bar: the clock is in the centre.
  * Type `omarchy-shell shell listPlugins | jq -r '.[].id' | sort | sudo tee /dev/ttyS0` (password `prime`): the list includes every one of omarchy.audio, omarchy.background, omarchy.bar, omarchy.bluetooth, omarchy.clipboard, omarchy.emojis, omarchy.menu, omarchy.monitor, omarchy.network, omarchy.notifications, omarchy.power, omarchy.reminders, omarchy.weather (name any that is absent — the 4.0.2 set may differ). `omarchy-shell shell listShellConfig | jq -c '.version, (.bar.layout|keys)'` → `1` and `["center","left","right"]`.
  * Drive the UI over IPC: `omarchy-shell osd show '{"message":"Runtime smoke","duration":0}'` → an OSD card `Runtime smoke`; `omarchy-shell osd close` → gone. `omarchy-shell shell summon omarchy.menu '{"menu":"apps"}'` → the app launcher opens; `omarchy-shell shell hide omarchy.menu` → closed. `omarchy-shell omarchy.network open` → the network panel; `omarchy-shell omarchy.network close`; the same for `omarchy.audio` and `omarchy.monitor`. `omarchy-shell shell toggle omarchy.clock` → the calendar opens (payload defaults to `{}`); again → closes. `omarchy-shell media status | jq .hasPlayer` → `false`; `omarchy-shell idle status | jq .enabled` and `omarchy-shell lock status | jq .locked` → booleans.
  * Type `omarchy bar move omarchy.clock --section right` → the clock moves to the right section within a second. Type `omarchy bar reset` → the clock is back in the centre.
  * Unhappy path, each with `; echo "exit=$?"`: `omarchy bar move nosuch.widget --section right` → an error, non-zero, bar unchanged; `omarchy-shell nosuch ping` → `Target not found.`, `exit=1`; `omarchy-shell shell nosuchmethod` → `Function not found.` (report the exit code — the docs say IPC-level misses still exit 0); `omarchy-shell -q nosuch ping` → nothing, `exit=0`; `omarchy-shell shell summon missing.plugin "{}"` → `unknown` and no overlay opens; `OMARCHY_PATH=/nonexistent omarchy-shell shell ping` → `omarchy-shell config not found: /nonexistent/shell/shell.qml`, `exit=1`.
  * Type `pkill -9 -x quickshell; omarchy-shell shell ping; echo "exit=$?"` as one line → `omarchy-shell is not running`, `exit=1`; wait 4 s (screenshot): `omarchy-shell shell ping` → `ok` and the bar is back (the supervisor relaunched a single kill).
  * Type `for i in 1 2 3 4 5 6; do kill -9 $(pgrep -x quickshell); sleep 1.5; done; sleep 3; pgrep -x quickshell || echo shell-gone` → `shell-gone` and the bar is absent (six quick deaths make the supervisor give up). Then `omarchy-shell shell ping; echo "exit=$?"` → `omarchy-shell is not running`, `exit=1`; `omarchy-shell -q shell ping; echo "exit=$?"` → silent, `exit=0`.
  ** The loop prints an error on rounds where the shell was already gone; that is fine. Killing quickshell also removes the notification daemon for a moment.
  * Type `omarchy bar put omarchy.keyboard-layout --after omarchy.clock; echo "status=$?"` → `omarchy-shell is not running; omarchy.keyboard-layout was not put on the bar` and `status=0`.
  ** `omarchy bar put` is newer than 4.0.2; if it prints `Unknown Omarchy command`, report "absent on this build" and skip to the restart.
  * Round trip: type `omarchy restart shell` → the bar returns within ~15 s with the clock centred; `omarchy-shell shell ping` → `ok`; `jq -c '[.bar.layout.center[]|.id//.]' ~/.config/omarchy/shell.json` lists `omarchy.keyboard-layout` right after `omarchy.clock` (the config was written while the shell was down; the pill itself stays hidden while only one layout is configured). Type `omarchy bar put omarchy.keyboard-layout --after omarchy.clock` → `omarchy.keyboard-layout is on the bar`. Type `omarchy bar defaults` → stock bar. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Copy the "is not running", `Target not found.` and `Function not found.` wording from the screenshot; the messages come from the wrapper, not from Quickshell, and the exact spelling is the contract. If a call prints `omarchy-shell is not ready` the shell is still starting; wait five seconds and retry once.
  * If the bar does not return within ~15 seconds, run `omarchy restart shell` once more and report it. The plugin list is short enough to fit on screen; the serial copy is the fallback.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `ok` for both pings and the usage lines; the serial plugin list with all thirteen ids and the config JSON; the OSD, launcher, panels and calendar appearing and closing on command with the JSON answers; the clock centre → right → centre; the refusals with their exact texts and exit codes and `unknown` with no overlay; the single-kill `not running` then `ok` with the bar back; `shell-gone` with no bar, the `omarchy-shell is not running` line with `exit=1` and the quiet `exit=0`; the `put` message with `status=0`; the bar back after restart with `ok`, the jq placement, the ready-shell confirmation and the restored bar
  * If unsuccessful
  ** A missing or garbled message, `ok` printed while the shell was dead, a non-zero exit for `-q`, a missing plugin id, a panel that did not open, `put` hanging or erroring without a shell, no bar after restart, or a stale clock position; `qs list`, `echo $OMARCHY_PATH $WAYLAND_DISPLAY`, `journalctl --user -n 40 | grep -i quickshell | sudo tee /dev/ttyS0` read via get-serial; `omarchy-version`
covers: bin/omarchy-shell; bin/omarchy-launch-shell; bin/omarchy-bar (cmd_move, cmd_reset, cmd_put); bin/omarchy-restart-shell; shell/shell.qml (IPC, listPlugins, summon); shell/plugins/osd/OsdModel.js; shell/plugins/services/media/MediaModel.js; docs/omarchy-shell.md §IPC, §Installing a third-party plugin (bar CLI); default/agents/skills/omarchy/plugins.md §Bar Layout; test/shell.d/bar-test.sh (put with no shell running / through a ready shell); test/shell.d/launch-shell-test.sh (give-up path); test/shell.d/restart-shell-test.sh (IPC cases, timeout/starting); test/shell.d/shell-ipc-display-test.sh; test/shell.d/runtime-smoke-test.sh:364-373,412-415; test/shell.d/osd-test.sh; test/shell.d/media-test.sh; test/acceptance.d/session-test.sh:16-24; manual/14-omarchy-cli.md
merged-from: 61:shell-ipc-and-bar-move; 51:bar-put-without-running-shell; 25:shell-ipc-ping-and-errors; 32:shell-ipc-errors-when-shell-down; 52:shell-ipc-contracts-from-terminal; 50:shell-plugins-loaded

### keyboard-layout-pill-two-layouts   [VM-OK]
description: The keyboard-layout pill stays off the bar with a single layout and appears as a two-letter language code (EN, not US) once a second layout is configured; clicking it or the Left-Alt+Right-Alt chord cycles the layout and the typed letters change; the layout list is derived from `/etc/vconsole.conf` with `us` in front of a non-latin layout; reverting hides the pill again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar centre: no two-letter code near the clock. Open a terminal with Super+Enter and run `hyprctl devices -j | jq -r '.keyboards[] | select(.main) | .layout, .active_keymap'` → `us`, `English (US)`.
  * Run `printf '\nhl.config({ input = { kb_layout = "us,de", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })\n' >> ~/.config/hypr/input.lua` then `hyprctl reload`: within two seconds `EN` appears right of the clock; hover it: tooltip `English (US)`.
  ** Send `>>` as `<GT><GT>`; check the line with ./client-with-image before Enter.
  * Left-click `EN`: it becomes `DE` with tooltip `German`. In the terminal type `zy`: the letters come out as `yz` (German swaps Y/Z). Press Backspace twice.
  * Press Left Alt and Right Alt together (`<A-alt_r>`): the pill returns to `EN`; type `zy` → `zy`. Backspace twice.
  ** If the chord does not switch, click the pill instead and note it.
  * Run `hyprctl keyword input:kb_layout 'us,br,de'` and click the pill: `PT`; again: `DE`; again: `EN` — labels are languages, never country codes.
  * Run `sudo cp /etc/vconsole.conf /tmp/vconsole.orig; sudo sh -c 'printf "KEYMAP=us\nXKBLAYOUT=ru\nXKBVARIANT=phonetic\n" > /etc/vconsole.conf'; hyprctl reload; hyprctl getoption input:kb_layout | head -1; hyprctl getoption input:kb_variant | head -1` (password `prime`) → `us,ru` and `,phonetic` (Omarchy puts `us` in front of the non-latin layout). Click the pill → `RU`; click again → `EN`.
  ** The terminal still types Latin while `EN` is shown; type all commands under `EN`.
  * Round trip: run `sudo cp /tmp/vconsole.orig /etc/vconsole.conf; sed -i '/kb_layout = "us,de"/d' ~/.config/hypr/input.lua; hyprctl reload`: the pill disappears from the bar and `hyprctl getoption input:kb_layout | head -1` is `str: us` again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The pill is two letters right of the clock; if a click hits the clock instead, the calendar opens — Escape and aim slightly right. The widget refreshes on Hyprland's config-reloaded event; allow a second, and click once more if it lags a beat.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots: no pill → `EN` with its tooltip → `DE` → `EN` after the Alt chord → `PT`/`DE`/`EN` on clicks → `RU`/`EN` after the vconsole change → no pill after reverting; the terminal showing `yz` under German and `zy` under English; the `us,ru` / `,phonetic` lines
  * If unsuccessful
  ** No pill after two layouts, a country label, a pill that does not switch, or `ru` without `us` in front; `hyprctl -j devices | jq -c '.keyboards[] | {name, layout, active_keymap}'` and the bar screenshot
covers: shell/plugins/bar/widgets/KeyboardLayout.qml (multipleLayouts, cycleLayout, refresh); shell/plugins/bar/widgets/KeyboardLayoutModel.js shortLabel; shell/plugins/bar/widgets/KeyboardLayout.manifest.json; default/hypr/input.lua; config/hypr/input.lua; config/omarchy/shell.json (omarchy.keyboard-layout in center); test/shell.d/keyboard-layout-test.sh; test/shell.d/hyprland-keyboard-layout-test.sh; manual/46:5-17; manual/34-keyboard-mouse-trackpad.md
merged-from: 30:keyboard-layout-widget-two-layouts; 25:keyboard-layout-switch-and-bar-indicator; 13:faq-keyboard-layout-switching-indicator; 51:keyboard-layout-widget-language-label

### tray-icon-drawer-menu-and-manage   [VM-OK] [SLOW]
description: A running application with a status-notifier icon (OBS Studio) makes the tray chevron appear; hovering opens the drawer, left click activates the app and right click opens its menu, right-clicking the chevron opens the `Tray icons` manage popup that pins and hides icons, quitting the app removes the chevron, and LocalSend is deliberately never shown.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right section: record whether a chevron `‹` glyph is drawn before the ethernet glyph with zero tray icons (expected: none).
  * Press Super+Space, type `OBS Studio`, Enter; screenshot every five seconds until OBS appears (slow without a GPU); click `Cancel` on the auto-configuration wizard if it shows.
  * Screenshot the bar: a chevron now starts the right section. Hover it for a second: a drawer slides open leftward revealing the OBS icon.
  * Right-click the OBS icon: a menu card with entries such as `Show`/`Hide`, `Start Recording`, `Exit`. Press Escape. Left-click the icon: the OBS window hides (or shows).
  * Hover the chevron, then right-click the chevron itself: a `Tray icons` popup lists OBS with `Pin` and `Hide` buttons and the text `Pinned icons stay visible. Hidden icons never show.` Click `Pin`: the OBS icon is visible right of the chevron without hovering. Click `Unpin`, then `Hide`: the icon leaves the drawer. Click `Show`, then press Escape.
  * Right-click the OBS icon and choose `Exit` (confirm if asked): the chevron disappears from the bar.
  * Unhappy path (negative): press Super+Space, type `LocalSend`, Enter; wait for its window: the bar still shows NO chevron (LocalSend is hidden on purpose — `ownedByOmarchy`). Close it with Super+W. With no tray app running, a right-click on the tray area must do nothing cleanly — a shell error or the bar vanishing is the failure.
  * Round trip: open a terminal, run `rm -f ~/.config/omarchy/shell.json` (pin/hide state was written there), close it with Super+W; the bar is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The drawer animation takes 0.6 s; screenshot after hovering for a second. Use ./client-with-image to aim at the 12 px icon. Click **Wait** if Hyprland raises a "not responding" dialog while OBS starts.
  * If OBS refuses to start on this VM, report that and run the same steps with `qbittorrent` after `sudo pacman -S --noconfirm qbittorrent` (~20 MB, network).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: no chevron at first; the chevron after OBS starts; the drawer open with the OBS icon; the right-click menu; the manage popup with its text; the pinned icon visible without hover; the hidden state; the chevron gone after Exit; LocalSend running with no chevron; the bar as found
  * If unsuccessful
  ** Screenshot with OBS running but no chevron, a LocalSend icon in the drawer, the right-click doing nothing with an icon present, or a shell error; `./client get-serial`
covers: shell/plugins/bar/widgets/Tray.qml (drawer HoverHandler, TrayItem clicks, openTrayMenu, managePopup, togglePin/toggleHide); shell/plugins/bar/widgets/TrayModel.js ownedByOmarchy; shell/Ui/PopupCard.qml; config/omarchy/shell.json (omarchy.tray); test/shell.d/tray-test.sh; test/shell.d/tray-menu-test.sh; manual/42-common-tweaks.md (Reveal all tray icons all the time)
merged-from: 12:tray-icon-manager-right-click; 30:tray-icon-menu-and-manage

### calendar-week-start-and-month-stepping   [VM-OK]
description: Clicking the clock (or Super+Ctrl+Alt+D) opens a calendar centred under the bar with a hero date, a year progress rail, a Monday-first six-row month grid with ISO week numbers and today outlined; months and years step by keys, chevrons and the wheel and `t` or the hero date returns to today; the `W` heading, the `w` key or the IPC flips the week start, which persists to `shell.json` across reopen; Tab and Escape behave.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the clock with the mouse: a wide card under the bar — a large `󰃭 <Month day>` hero, a year rail `<YYYY> ─── NN%`, weekday headings starting `MON`, six rows of days with ISO week numbers in a left gutter (the six-row grid keeps the card height constant), today outlined and bold, and `‹ <MONTH YYYY> ›` at the bottom; an accent dot underlines the clock.
  * Keys: press `]` twice — the month label advances two months while the hero date stays today; `[` three times — one month before today; `}` — one year later; `t` — back to the current month.
  * Mouse: click the `›` chevron (tooltip `Next month`), scroll the wheel down once over the grid (another month), then click the hero date (tooltip `Back to today`; only clickable while another month is shown) — the current month with today outlined returns.
  ** A horizontal wheel does nothing; only vertical scroll steps months.
  * Week start: hover the small `W` heading above the week-number gutter — tooltip `Start weeks on Sunday`; click it — the headings now start with `SUN` and the grid shifts one column. Open a terminal with Super+Enter and run `jq -r '.bar.layout.center[] | select((.id // .) == "omarchy.clock") | .weekStartDay' ~/.config/omarchy/shell.json` → `sunday`.
  * Press Escape (card and dot gone), then Super+Ctrl+Alt+D: the calendar opens again and still starts on Sunday (persisted). Press `w`: the headings flip back to Monday; the jq now says `monday`. Run `omarchy-shell omarchy.clock toggleWeekStart` twice from the terminal with the card open: Sunday, then Monday again — the IPC is the same switch.
  * Unhappy path: with the calendar open press Tab — focus steps to the neighbouring panel (weather, if shown) or stays; no crash. Press Escape — the panel closes; click the clock and Escape once more — it opens and closes again and the bar stays responsive.
  * Round trip: `rm -f ~/.config/omarchy/shell.json` (the toggle created it on a fresh disk); close the terminal with Super+W; the bar is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The card is centred under the bar regardless of where the clock label sits; keep it open while running the IPC in the terminal so the header change is visible in the same screenshot. `date` in the terminal is the reference if the highlighted day looks wrong.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the calendar on today's month with the outlined day and week numbers; after `]]`; after `[[[`; after `}`; after `t`; after chevron + wheel; after clicking the hero; the `W` tooltip; `SUN`-first grid with `weekStartDay` sunday; reopened by hotkey still Sunday; Monday after `w` with `monday`; the IPC round trip; the Tab result; the panel closed and the bar unchanged
  * If unsuccessful
  ** Screenshot where the month label or the highlight did not move as described, a header that does not shift or reverts on reopen, or the panel not opening; `date` output for comparison
covers: shell/plugins/panels/clock/Panel.qml (moveMonth, moveYear, goToToday, WheelHandler, hero MouseArea, toggleWeekStart, setWeekStart, persistSettings); shell/plugins/panels/clock/BarWidget.qml (left click, togglePanel, IPC toggle); shell/plugins/panels/clock/Model.js (monthGrid, isoWeek, toggledWeekStart, weekStartSettingName); default/hypr/bindings/utilities.lua:101 Super+Ctrl+Alt+D; test/shell.d/clock-test.sh (week start IPC/persistence, grid, month stepping, goToToday); manual/05:46,57
merged-from: 51:calendar-week-start-toggle; 30:clock-calendar-popup; 31:clock-calendar-navigate-and-return; 31:clock-week-start-toggle-persists

### calendar-memento-mori-life-bar   [VM-OK]
description: The calendar's opt-in life bar stays hidden until a birth year is entered by double-clicking the year bar, rejects an impossible (future) year, persists to `shell.json` across reopen, and is cleared by double-clicking the life bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the clock — the calendar opens with a year progress rail (the thin bar under the hero with the year at left and NN% at right) and no `LIFE` rail.
  * Double-click the year rail with the mouse — it is replaced by `BORN [year] LIVE TO [90]` fields with BORN focused. Unhappy path first: type `abcd`, Tab, Enter — the editor closes and NO `LIFE` rail appears.
  ** If the inputs do not take focus, click into the birth-year field first.
  * Double-click the rail again; type `1979`, Tab, `90`, Enter. A `LIFE ─── NN%` rail appears about half full under the year rail; hover it — tooltip `Memento Mori`. Double-click the year rail once more and press Escape: the editor closes with nothing changed (the `LIFE` rail is still there; a second Escape would close the panel).
  * Open a terminal with Super+Enter and type `jq -c '.bar.layout.center[] | select((.id // .) == "omarchy.clock") | {birthYear,lifeExpectancy}' ~/.config/omarchy/shell.json` — `{"birthYear":1979,"lifeExpectancy":90}`.
  * Press Escape and click the clock again — the `LIFE` bar is still there (persisted).
  * Unhappy path: double-click the year bar, type `2050`, Enter — a future year is rejected and the bar keeps its value.
  * Round trip: double-click the `LIFE` bar — it disappears; the `jq` shows `birthYear` 0. Escape; `rm -f ~/.config/omarchy/shell.json` if it did not exist before this test; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Double-click means `mouse double-click` on the bar itself, not its label; double-check the mouse position first.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** No LIFE rail at first; the BORN / LIVE TO editor; no LIFE rail after `abcd`; the LIFE rail with `Memento Mori` after 1979/90 and the matching JSON; the rail intact after Escape on the editor; persisted across reopen; 2050 rejected; cleared with `birthYear` 0
  * If unsuccessful
  ** A LIFE rail shown before any birth year or after invalid input, the editor not appearing, values not persisted, or 2050 accepted
covers: shell/plugins/panels/clock/Panel.qml (startEditingLife, handleLifeKey, commitLife, clearLife); shell/plugins/panels/clock/Model.js (parseBirthYear, parseLifeExpectancy, lifeProgress); shell/Ui/TextField.qml; test/shell.d/clock-test.sh (memento mori inputs, birth-year validation, persistence, clearLife)
merged-from: 51:calendar-memento-mori-life-bar; 31:clock-memento-mori-edit

### agents-widget-hidden-without-usage   [VM-PARTIAL]
description: Without any AI-agent usage records the Agents pill is absent from the bar, a forced open shows the empty explanation rather than an error, and a refresh keeps it hidden; skipped: the pill's left/middle/right clicks (panel, provider cycling, Default Agent menu) and the usage meters, which need Claude/Codex/Fireworks usage.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar's right section: there is no 󱚣 (agents) icon between the tray area and the network icon.
  * Open a terminal with Super+Enter and type `omarchy-shell omarchy.agents open` Enter: either a card appears reading `No AI coding subscriptions found. Agents show up here once you've used them.`, or the command prints an error such as `Target not found.` — report which. No crash, the bar stays.
  * Press Escape if a card opened.
  * Type `omarchy-shell omarchy.agents refresh` Enter; wait 5 s and screenshot the bar: still no agents icon.
  * Unhappy path: an agents icon on a pristine disk, or the bar vanishing after the open, is the failure to report.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped on this VM: left click opening the usage panel (`Waiting for auth`), middle click cycling providers, right click opening the Omarchy menu on `Default Agent`, limits meters and provider chips.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshot without the icon; the terminal output; the empty card if it appeared; the bar still without the icon after refresh
  * If unsuccessful
  ** Screenshot of an agents icon on a pristine disk, or the bar vanishing on open; `./client get-serial`
covers: shell/plugins/agents/Panel.qml (visible: providers.length > 0, empty Text); shell/plugins/agents/Main.qml (enabledProviders, runUpdate); shell/plugins/agents/README.md; test/shell.d/agents-panel-test.sh; test/shell.d/agent-usage-claude-limits-test.sh
merged-from: 31:agents-panel-hidden-no-usage; 51:agents-widget-clicks

### bar-panels-open-switch-close-and-numbers   [VM-PARTIAL]
description: Every bar panel opens from its letter hotkey, its icon and `Super+Ctrl+<digit>` (which counts only the visible panels of the right section — Network, Audio, Display here), closes on Escape or an outside click even when reopened during its fade, and Tab/Shift+Tab or a click on another icon swaps panels instead of stacking them; skipped: Bluetooth and Power content (no adapter, no battery) — the driver only records what their hotkeys do.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and leave it focused. Screenshot the right section and count the icons: ethernet plug, speaker, monitor (no bluetooth, battery or agents icon).
  * Press Super+Ctrl+W: within 15 s the Network panel hangs under the ethernet glyph with a small accent dot under that icon. Press Escape: it closes. Press Super+Ctrl+A: the Audio panel (hero `Audio`, a slider). Escape. Press Super+Ctrl+D: the Display panel (text-size and scale controls, one display). Escape — only observe, change nothing.
  * Click the ethernet icon with the mouse: the panel opens. Click the desktop far below the card: it closes. Click the icon again, then press Tab: the Network panel closes and the Audio panel opens under its own glyph, the dot moving with it; Tab again: Display; Shift+Tab twice: Network. Escape.
  * With the Network panel open, click the monitor icon without closing first: the Display panel replaces it in one click — only one panel is open. Escape.
  * Press Super+Ctrl+1: Network. Escape. Super+Ctrl+2: Audio. Escape. Super+Ctrl+3: Display. Escape. Record the mapping you saw.
  ** Hidden hardware widgets are not counted, so 1/2/3 are Network/Audio/Display on this machine. Bar-panel numbering is newer than the 4.0.2 disk: if `Super+K` has no "Bar panel 1" row and the digits do nothing, report "absent on this build" and continue.
  * Press Super+Ctrl+W, then Super+Ctrl+W to close it, then immediately Super+Ctrl+W again (three chords back to back): the panel is open again. Press Escape once: it closes and the terminal did not receive the Escape — type `echo focus-ok` Enter; it prints `focus-ok`.
  * Unhappy path: press Super+Ctrl+9: nothing opens, nothing crashes. Absence path: press Super+Ctrl+B, screenshot, then Super+Ctrl+P, screenshot: the bluetooth and power widgets are hidden here, so expected is nothing; if a card appears (`Bluetooth` / `NO ADAPTER`, or a power card with no battery section) it must close on Escape — describe precisely what happened. Press Super+Ctrl+B twice in quick succession: it must end closed.
  * Close the terminal with Super+W; the desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The digit combos are `<M-C-1>` etc.; Tab is `<TAB>`, Shift+Tab `<S-TAB>`. A panel is open when a card hangs under the bar and a small accent dot underlines the owning icon; all panels share one surface, so only one is open at a time.
  * Use the keyboard for the focus step; the point is where keyboard focus lands. The bar strip stays clickable while a panel is open; everything else dismisses. `Bar.findPanelWidget` ignores visibility, so Super+Ctrl+B/P on hidden widgets is a known unverified corner worth a careful screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: the right section with only network/speaker/monitor icons; each panel by letter with the accent dot under its icon; closed after Escape and after the outside click; Audio and Display after Tab, Network after Shift+Tab ×2; Display replacing Network on the icon click; the panels for digits 1–3 (or the "absent on this build" note); the reopened panel and `focus-ok`; nothing after Super+Ctrl+9; the screen after B and P with a sentence naming the outcome
  * If unsuccessful
  ** Screenshot of a panel under the wrong icon, two panels open, a panel ignoring Escape or closing on Tab, a stray `^[` in the terminal, or a panel that would not close; `omarchy-shell shell ping` output; `./client get-serial`
covers: shell/shell.qml togglePanelAt; shell/plugins/bar/Bar.qml (panelWidgetIdAt, panelNavigationSlots, switchPanelFrom, requestPopout, findPanelWidget); shell/plugins/bar/BarModel.pickPanelSlot; shell/Ui/PanelKeyCatcher.qml (Tab); shell/Ui/KeyboardPanel.qml (dismissArea, forwardBarClick, popout coordination); shell/Ui/Panel.qml (switchPanel); default/hypr/bindings/utilities.lua:98-116 (Super+Ctrl+W/A/D/B/P, Super+Ctrl+1..9); test/acceptance.d/panels-test.sh:39-48,62-74,90-116; test/shell.d/runtime-smoke-test.sh:543-547; test/shell.d/hyprland-default-config-test.sh:193-206; manual/05:40-61; manual/07:65-71
merged-from: 31:panel-open-close-switch-and-number-hotkeys; 30:bar-panels-keyboard-open-switch-close; 10:bar-panel-hotkeys-and-numbered-toggle; 50:panel-keyboard-tab-and-escape; 50:bar-panels-open-and-close; 40:hypr-panel-chords-and-bar-panel-numbers

### bluetooth-power-wifi-absent-paths   [VM-PARTIAL]
description: On a machine with no Bluetooth adapter, no battery and no Wi-Fi radio the bar shows no bluetooth or power icon, the bluetooth and power hotkeys do nothing harmful, the bluetooth helpers fail fast with clear messages (`off` still succeeds), and the Update → Hardware restart rows run to a clean `Done`; only these absence paths are runnable — pairing, radio toggling, battery and Wi-Fi content are skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar's right section: no Bluetooth icon and no battery icon between the tray area and the network icon; the icons are (tray), network, speaker, display — anything else is a finding.
  * Press Super+Ctrl+B and wait 2 s: either nothing happens, or a card appears with hero `Bluetooth` / `NO ADAPTER`, no power switch and the text `No Bluetooth adapter`. Report which; press Escape if a card opened. Press Super+Ctrl+P and screenshot within 5 s: the power widget is hidden, so expected is no panel — the power panel opens and immediately closes itself without a battery, so a brief flicker is acceptable, a card that stays is not; describe anything that appears. Escape. Press Super+Ctrl+D then Escape: the neighbouring display panel still works.
  * Click the clock and press Escape: the bar is still responsive. Press Super+Space → Trigger → Toggle: there is no `Battery Percentage` row (laptop-only). Escape.
  * Open a terminal with Super+Enter and run: `omarchy-battery-present; echo "exit=$?"` → `exit=1`; `omarchy-power-present; echo "exit=$?"` → `exit=1` (if it prints 0, run `grep . /sys/class/power_supply/*/type` and report it); `omarchy-battery-status; echo "[exit=$?]"` → an empty line then `[exit=0]`; `omarchy-battery-status --bogus` → `Usage: omarchy-battery-status [--shell]`; `upower -e | grep -c /battery_; omarchy-shell shell ping` → `0` then `ok`.
  ** The Super+Ctrl+Alt+B battery notice is asserted in `notification-time-and-battery-notices-without-battery`.
  * Run `bluetoothctl list` → empty; `omarchy-bluetooth-power is-on; echo "exit=$?"` → `exit=1`; `time omarchy-bluetooth-power on; echo "exit=$?"` → `omarchy-bluetooth-power: adapter did not come up`, `exit=1`, within ~10 s; `omarchy-bluetooth-power off; echo "exit=$?"` → `exit=0` silently; `omarchy-bluetooth-power toggle; echo "exit=$?"` → the same power-on failure, `exit=1`.
  * Unhappy path (usage): `omarchy-bluetooth-power; echo "exit=$?"` → usage, `exit=1`; `omarchy-bluetooth-device connect nope; echo "exit=$?"` → usage, `exit=1`; `omarchy-bluetooth-device dance 00:11:22:33:44:55; echo "exit=$?"` → usage, `exit=1`; `omarchy-bluetooth-device connect 00:11:22:33:44:55; echo "exit=$?"` → returns promptly (bluetoothctl's `No default controller` is swallowed) — report the exit code.
  * Run `omarchy-restart-wifi; echo "exit=$?"` → `Unblocking wifi...`, nothing from `rfkill list wifi` (no radios), `exit=0`; `omarchy-restart-bluetooth; echo "exit=$?"` → `Unblocking bluetooth...`, empty list, `exit=0`; `rfkill list` → empty.
  * Press Super+Space → Update → Hardware → Bluetooth: a floating terminal prints the unblock line and an empty list and ends on a Done prompt (exit 0); close it. Update → Hardware → Trackpad: sudo asks for the password (`prime`), no `Resetting …` lines (no i2c_hid_acpi devices), Done; close it.
  * Run `pactl list sinks short` → one `auto_null` line (the Dummy Output; see the audio tests). Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped on this VM: pairing/connecting a device, the Bluetooth power switch, battery percentage and power profiles, Wi-Fi scanning. A panel that opens for Super+Ctrl+P or B anchored to nothing is a known unverified corner — screenshot it carefully.
  * A hang beyond 30 s on any bluetooth helper is the failure: `pgrep -a bluetoothctl` shows what is stuck.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshot without bluetooth/battery icons (the last icon is the Display icon); the screen after Super+Ctrl+B and after Super+Ctrl+P with a sentence naming each outcome; the display panel opening; the calendar opening afterwards; the Toggle submenu without `Battery Percentage`; the exit codes, empty status, usage line, `0` and `ok`; the terminal with every bluetooth message, exit code and the `time`; the three restart outputs with exit 0 and the empty `rfkill list`; the two floating terminals ending in Done; the `auto_null` line
  * If unsuccessful
  ** Screenshot of a Bluetooth or battery icon present, a lingering power card, the bar vanishing after a hotkey, a helper hanging beyond 30 s, status printing garbage, a shell that stopped answering, or a floating terminal ending in a Failed prompt; `./client get-serial`
covers: shell/plugins/panels/bluetooth/Panel.qml (visible: adapter !== null, empty text); shell/plugins/panels/power/Panel.qml (visible: batteryPresent, onOpenedChanged close); shell/plugins/panels/audio/Panel.qml (outputIcon, onWheelMoved, toggleAllMuted); shell/plugins/bar/Bar.qml findPanelWidget; bin/omarchy-bluetooth-power; bin/omarchy-bluetooth-device; bin/omarchy-restart-wifi; bin/omarchy-restart-bluetooth; bin/omarchy-restart-trackpad; bin/omarchy-battery-present; bin/omarchy-battery-status; bin/omarchy-power-present; bin/omarchy-hw-laptop; default/hypr/bindings/utilities.lua (Super+Ctrl+B / Super+Ctrl+P); default/omarchy/omarchy-menu.jsonc (update.hardware.*, trigger.toggle.battery-percentage); test/shell.d/bluetooth-test.sh; test/shell.d/power-present-test.sh; test/shell.d/power-test.sh; test/acceptance.d/panels-test.sh:76-87 (self-hiding widgets, hidden power panel)
merged-from: 31:bluetooth-widget-hidden-no-adapter; 25:bluetooth-absent-graceful; 30:right-section-panels-without-hardware; 25:restart-wifi-bluetooth-trackpad-without-hardware; 24:battery-absent-paths; 31:power-widget-hidden-no-battery; 50:panel-power-hidden-without-battery

### network-panel-wired-only   [VM-OK]
description: On the VM's wired NAT the network widget shows the ethernet glyph and its panel shows the Ethernet hero, live connection details (Ping "Timeout" / Packet Loss "100%" in red are expected because ICMP is blocked), copyable IP and gateway, and the DNS provider pills — which switch DNS passwordless since 4.0.2 (no polkit dialog) — while every Wi-Fi control, the QR menu row and the captive-portal action stay hidden; the status helper and Wi-Fi helpers agree from the terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the right section: the network widget shows the ethernet glyph `󰈀` (not a Wi-Fi arc, not the blocked `󰈂`). Open a terminal with Super+Enter (leave it open), then press Super+Ctrl+W.
  ** A card under the ethernet icon. Hero: ethernet glyph, title `Ethernet` (optionally a speed in parentheses), a small-caps phrase that changes every ~3 s (`WIRING BITS`, `HANDLING PACKETS`, …). On the hero's right only a gauge button — NO on/off switch and NO QR button.
  ** Grid: Ping, Packet Loss, Receiving, Sending, Downloaded, Uploaded, IP Address (`10.0.2.15`), Gateway (`10.0.2.2`). Before the first sample the ping rows show `--`; within ten seconds Ping reads `Timeout` and Packet Loss `100%` in red — expected here (user-mode NAT drops ICMP), not a fault; the router ping may show a value.
  ** `DNS PROVIDER` pills DHCP (filled), Cloudflare, Google, Custom. NO `WI-FI BAND`, NO `SCANNING WI-FI…`, NO `KNOWN NETWORKS`/`OTHER NETWORKS` rows, NO "open portal" button; the card ends after the pills.
  * Wait 5 s and screenshot again: the hero phrase changed and Downloaded/Uploaded may have grown. Hover `10.0.2.15`: tooltip `Copy IP`; click it. Hover `10.0.2.2`: tooltip `Copy gateway`.
  * Press j (a highlight ring appears on the DHCP pill), then l twice (Google) and h once (Cloudflare): only the highlight moves. Click the Cloudflare pill with the mouse: NO password dialog appears (the DNS helper runs as root passwordless since 4.0.2) and Cloudflare becomes the filled pill. Click DHCP to restore it.
  * Press Escape. Click the ethernet icon with the mouse: the same panel opens; Escape. In the terminal press Ctrl+Shift+V: `10.0.2.15` is pasted; press Ctrl+C.
  * Run `omarchy-network-status | cat -A` → `ethernet^I<iface>^I^I$` (e.g. `enp0s3`); `omarchy-network-status --verbose` → lines `iface`, `ip 10.0.2.15`, `prefix 24`, `gateway 10.0.2.2`, `rx_bytes`, `tx_bytes`, `type ethernet`, `speed`/`duplex` (may be empty on virtio), `router_ping_ms <n>` and `internet_ping_ms` with an EMPTY value (expected: ICMP blocked while `curl -sI https://archlinux.org | head -n 1` still answers).
  * Unhappy path: `omarchy-network-qr; echo "exit=$?"` → `No active Wi-Fi connection`, `exit=1`; `omarchy-network-password; echo "exit=$?"` → an error, non-zero, no QR matrix; `omarchy-network-status --frob; echo "exit=$?"` → usage, `exit=2`. Press Super+Space → Setup → Network: only `DNS` is listed, no `QR Code` row; Escape.
  * Close the terminal with Super+W; DNS is back on DHCP and the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No keyboard highlight is painted until the first j; that press only reveals it. The ethernet icon is the first panel icon after the tray area on this VM (agents/bluetooth slots are hidden).
  * The source proposals expected a polkit dialog on the DNS pills; `etc/sudoers.d/omarchy-dns` (present since 4.0.2) makes it silent — a dialog appearing here is the finding, not its absence. If DNS does not return to DHCP, end the session with `stop`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two screenshots of the open panel a few seconds apart showing hero, the eight detail cells with `10.0.2.15` / `10.0.2.2`, `--` then the red `Timeout`/`100%`, the DNS pills and nothing Wi-Fi related; the tooltips; the ring on each pill; Cloudflare filled with no dialog and DHCP restored; the pasted IP; the status line, the verbose block with the empty internet ping; the three refusals; the Setup → Network menu without `QR Code`
  * If unsuccessful
  ** Screenshot of a Wi-Fi switch/list, a `No connection` hero, an empty grid, a portal button, a `QR Code` row, or a password dialog on the DNS pill; `ip -j route get 1.1.1.1` and `nmcli device status`; `omarchy-version`
covers: shell/plugins/panels/network/Panel.qml (hero, heroActions visibility, details GridLayout, DetailValue copyable, canSelectBand, wifiStationAvailable, keyCatcher dns/header, ethernet kind, canToggleWifi); shell/plugins/panels/network/Model.js (connectivityState, formatPingLatency, headerDetail, connectionIcon); bin/omarchy-network-status; bin/omarchy-network-qr; bin/omarchy-network-password; bin/omarchy-dns; etc/sudoers.d/omarchy-dns; default/hypr/bindings/utilities.lua:102 (Super+Ctrl+W); default/omarchy/omarchy-menu.jsonc setup.network.qr (when); test/shell.d/network-test.sh; test/shell.d/network-captive-portal-test.sh; test/shell.d/network-qr-test.sh; test/shell.d/network-password-test.sh; test/shell.d/wifiqr-test.sh; manual/35-networking.md (Networking intro, Sharing your Wi-Fi); manual/05-the-top-bar.md
merged-from: 31:network-panel-wired-only-layout; 52:network-panel-ethernet-only-in-vm; 12:network-panel-ethernet-only; 25:network-status-wired-nat-and-panel

### network-speed-test-overlay-and-cli   [VM-OK] [NET]
description: The internet speed test — from the network panel's gauge button and from Trigger → Speed Test → Network Speed Test — shows download then upload dials live, offers Run Again when finished and stops when dismissed, and `omarchy network speedtest down|up` prints one Mbit/s sample per second while a bad argument prints usage; transfers a few tens of MB through the NAT.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+W and click the gauge icon at the right of the hero (tooltip `Run a speed test`): the panel closes and a near-black overlay appears — title `ETHERNET`, dials `DOWNLOAD` and `UPLOAD` in `Mbps`; on open the needles sweep to full scale and back.
  * Screenshot every 2–3 s for about 12 s: the DOWNLOAD readout climbs first (non-zero within ~10 s), then UPLOAD; when done a `Run Again` button appears between the dials.
  * Click `Run Again`: readouts reset and a new run starts. Press Escape mid-run: the overlay closes.
  * Press Super+Space → Trigger → Speed Test → Network Speed Test: the same overlay opens. Click the dark scrim: it closes.
  * Open a terminal with Super+Enter and run `timeout 12 omarchy network speedtest down`: one number per second (Mbit/s, non-zero), stopping after 12 s. Run `timeout 8 omarchy network speedtest up`: likewise.
  * Unhappy path: `omarchy network speedtest sideways; echo "exit=$?"` → `Usage: omarchy-network-speedtest [down|up]`, `exit=2`; `omarchy-network-speedtest; echo "exit=$?"` → usage, `exit=2`.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each phase lasts ~5 s. If the dials stay at 0 and a red error line appears under them, or the CLI prints `Failed to fetch speed test endpoints`, api.fast.com is unreachable: retry once, then report it as a network condition with `getent hosts api.fast.com` and `curl -sI https://api.fast.com | head -1`, not as a defect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Overlay with the ignition sweep; a frame with a non-zero DOWNLOAD value; a frame with UPLOAD live; the finished state with `Run Again`; the overlay gone after Escape and after the scrim click; the terminal with per-second samples for down and up and the two usage refusals with `exit=2`
  * If unsuccessful
  ** Screenshot of the red error text or dials stuck at 0 after 15 s; the CLI error line and the `getent`/`curl` output; `./client get-serial`
covers: shell/plugins/panels/speedtest/Panel.qml; shell/Ui/SpeedTestOverlay.qml; shell/plugins/panels/network/Panel.qml (summonSpeedTest); bin/omarchy-network-speedtest; default/omarchy/omarchy-menu.jsonc (trigger.tests.network-speedtest); manual/35-networking.md (How fast is it?)
merged-from: 31:network-speed-test-overlay; 12:network-speedtest-panel-and-cli; 25:network-speedtest-panel-and-cli

### disk-speed-test-overlay-and-cli   [VM-OK]
description: Trigger → Speed Test → Disk Speed Test shows live read then write MB/s for the system disk and finishes on its own, the CLI prints the same figures, a nonexistent target directory is refused, and no scratch files are left behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger → Speed Test → Disk Speed Test: a dark overlay titled with the disk model (e.g. `QEMU HARDDISK`, or `vda` when virtio reports no model), dials `READ` and `WRITE` with unit `MB/s`.
  * Screenshot every 3 s for about 20 s: READ climbs first (~8 s), then WRITE; then `Run Again` appears. Press Escape: the overlay closes.
  * Open a terminal with Super+Enter and run `omarchy disk speedtest`: a `disk <model or vda>` line, `read N` lines, then `write N` lines — any positive figure passes.
  * Unhappy path: `omarchy-disk-speedtest /does/not/exist; echo "exit=$?"` → `Usage: omarchy-disk-speedtest [target-dir]`, `exit=2`.
  * Run `ls ~/.cache/omarchy/ | grep -ci speed` → `0` (scratch files cleaned up).
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The test writes about 1 GB temporarily; on a slow virtual disk WRITE values in the tens of MB/s are normal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Frames with READ live, WRITE live and the finished `Run Again` state; the CLI output; the usage error with `exit=2`; the terminal printing `0` for leftovers
  * If unsuccessful
  ** `Need at least 2048MB free`, `Direct disk I/O is not available`, a failed phase, dials never moving, or leftover `disk-speedtest-*.dat` files
covers: shell/plugins/panels/disk-speedtest/Panel.qml; shell/Ui/SpeedTestOverlay.qml (scaleStops); bin/omarchy-disk-speedtest; default/omarchy/omarchy-menu.jsonc trigger.tests.disk-speedtest; manual/46:39
merged-from: 31:disk-speed-test-overlay; 13:faq-disk-speed-test

### audio-panel-on-dummy-output   [VM-PARTIAL]
description: With no sound card PipeWire still exposes an `auto_null` Dummy Output, so the audio panel opens with a working output slider and mute switch, the bar icon's right-click and wheel act on it, and `omarchy audio tuning` degrades gracefully; skipped: real speakers, device switching between several outputs and per-app streams.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the right side of the bar: a speaker glyph sits between the ethernet and monitor glyphs. Press Super+Ctrl+A: a card opens — hero `Audio` with a mood label (`SILENCED` or `MUTED`) and an on/off switch; `OUTPUT` with a percentage and a slider and a `Dummy Output` row. `INPUT` and `SOURCES` are absent (no microphone). Record exactly which sections exist.
  ** If the panel shows no device row and a greyed slider, PipeWire's dummy sink is missing — report it and expect the no-sink branches below.
  * Click on the output slider track: the percentage follows the click. Click the hero switch twice: the label toggles to `MUTED` and back; no error either way.
  * Press j, then l three times, then m: the keyboard moves the highlight and toggles mute with no error. Press Escape.
  * Right-click the speaker icon in the bar, then press Super+Ctrl+A: hero `MUTED`. Escape; right-click again to restore. Scroll the mouse wheel up three notches over the speaker icon: a volume OSD appears at the bottom centre with a rising percentage; scroll down three notches to return.
  * Open a terminal with Super+Enter and run `pactl list sinks short` → one `auto_null` line; `wpctl status | sed -n '/Audio/,/Video/p'` → the Dummy Output under Sinks and nothing under Sources.
  * Unhappy path: run `omarchy audio tuning status; omarchy audio tuning off; echo "exit=$?"` → a no-tuning message (`Installed: no` / nothing ships for this laptop) and a harmless line, no traceback.
  * Close the terminal with Super+W; volume and mute are as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar icon renders blank, find its slot by opening the panel first and noting where the card is anchored. Skipped here: choosing a real output and per-app mixing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the open audio panel with the sections named; after the slider click; after the switch clicks; hero `MUTED` after the right click and restored; the volume OSD during the wheel; the `auto_null` line and the wpctl sections; the tuning output
  * If unsuccessful
  ** Screenshot of the panel failing to open, the bar vanishing (shell crash), phantom devices, or a traceback from `omarchy audio tuning`; `pactl info; wpctl status | sudo tee /dev/ttyS0` read via get-serial
covers: shell/plugins/panels/audio/Panel.qml (hasOutput/hasInput, sectionVisible, outputSlider enabled, BarIconButton right click/wheel); shell/plugins/panels/audio/Model.js; bin/omarchy-audio-tuning (status/off); test/acceptance.d/panels-test.sh (audio); manual/45:31,35
merged-from: 31:audio-panel-no-device; 13:volume-popup-without-audio-device

### display-panel-fixed-brightness-scale-text-size   [VM-OK]
description: On a display without a controllable backlight the Display panel says `FIXED BRIGHTNESS`, hides the brightness slider, and shows the Text Size and Scale controls for the single screen with keyboard and hover highlighting; the Text Size slider moves in fixed notches, reflows the whole shell live, keeps its value across reopen and returns to 12px; the wheel over the monitor icon does nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+D: a card under the monitor icon — hero `Display` with `FIXED BRIGHTNESS`; NO `BRIGHTNESS` section; `TEXT SIZE` with `12px` at the right and a notched slider; `SCALE` with pills such as `1x 1.25x 1.6x 2x 3.2x 4x` (the set depends on the resolution — report exactly what you see) with `1x` filled; NO `DISPLAYS` section.
  * Hover the `2x` pill: it highlights; do not click. Press j: a ring appears on the first scale pill; press l once: it moves to the next pill; press k: the `TEXT SIZE` row highlights. Do not press Enter on a pill.
  * Click on the `TEXT SIZE` track about 60 % along it: the value at the right snaps to a notch (`14px` or `16px`) and the panel text, bar text and menu font grow within a second. Press Escape, then Super+Space: the menu is visibly larger; Escape.
  * Press Super+Ctrl+D: the `TEXT SIZE` value still shows the new px (kept). Press j (ring on a scale pill), k (`TEXT SIZE` row), then h once per notch until the value reads `12px`; the shell shrinks back with each step. Press Escape, then Super+Space: the menu is back to its original size; Escape.
  ** Notches are 9, 10, 11, 12, 14, 16, 20 px; l moves right, h left; if you overshoot to 11px press l once. Hover is ignored for 300 ms after each change while the panel reflows — use keys, not the mouse, for the restore.
  * Unhappy path: scroll the mouse wheel over the monitor bar icon: nothing changes (no brightness to adjust) and no OSD appears.
  * Press Escape: the panel closes. Click the monitor icon with the mouse: it opens again at `12px`; Escape. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The monitor icon is the rightmost icon in the bar on this VM. Never click a scale pill: it persists to disk and re-lays out the whole desktop (a 4x pill leaves a 320×200 desktop). The text size also persists — end at `12px` or finish with `stop`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the panel with `FIXED BRIGHTNESS`, `TEXT SIZE 12px` and the `SCALE` pills with `1x` active; the hover highlight; the keyboard ring on a pill and on the text-size row; the panel with the larger px value and visibly larger text; the larger menu; the panel reopened with the value kept; the panel back at `12px` and the menu at normal size; the unchanged screen after the wheel; the panel closed
  * If unsuccessful
  ** Screenshot showing a brightness slider, a `DISPLAYS` section, missing sections, a changed scale, the value not snapping, no reflow, or the size not returning to 12px
covers: shell/plugins/panels/monitor/Panel.qml (brightnessAvailable, visibleSections, ScalePill, moveCursor, textSizeStops, adjustTextSize, textSizeSlider onReleased, reflowingText); shell/plugins/panels/monitor/Model.js (availableScales); shell/Ui/PanelSlider.qml (tickCount, integer); bin/omarchy-display-text-size; bin/omarchy-monitor-state; bin/omarchy-brightness-display
merged-from: 31:monitor-panel-fixed-brightness-layout; 31:monitor-text-size-slider-and-restore

### weather-widget-panel-and-location-search   [VM-OK] [NET]
description: The weather pill appears right of the clock once the forecast fetch succeeds; its panel shows conditions and a forecast, `Super+Ctrl+Alt+W` toggles that panel with no toast (the manual says notification — 03-INTENDED-BEHAVIOUR item 14: CODE-INTENDED, the manual is stale), right-click sends a status toast, the location can be picked from geocoded suggestions in the panel or pinned from the CLI (`SAN FRANCISCO` / `WIND` visible), survives reopen and clears back to auto-detect; needs outbound HTTPS (a few KB).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Within 30 s of reaching the desktop, screenshotting every 5 s: a weather glyph (sun/cloud/rain) with a temperature appears right of the clock.
  ** If it never appears, open a terminal and run `omarchy-weather-status`: `Weather unavailable` means the service is unreachable — report it as a network limitation and stop.
  * Left-click the glyph: a wide card — a big condition glyph, temperature with °C/°F, a ` <LOCATION>` line, `FEELS` / `WIND` / `HUMID` values, a divider and three forecast cells (icon, DAY, hi° lo°); `Fetching forecast…` may show briefly. Press Escape. Press Super+Ctrl+Alt+W: the panel opens again; press it again: it closes.
  * Right-click the glyph: within three seconds a toast top-right reads `<Place>  ·  Temp …  ·  Wind …`. Middle-click it: nothing visible (a refresh).
  * Click the glyph, click the location line: it becomes a `Search city` field; type `Paris`: within ~2 s suggestions appear (Paris, Île-de-France, France …). Press Down once, then Enter: a spinner replaces the ✕ while saving, then the location reads `PARIS` and the numbers refresh. Escape, click the glyph again: still `PARIS` (kept). Click the location, then the ✕ beside the field: the location returns to the auto-detected city. Escape.
  * Open a terminal with Super+Enter and run `omarchy-weather-location --set "San Francisco" "37.7749,-122.4194"` (no error), middle-click the glyph, press Super+Ctrl+Alt+W: within 30 s the heading `SAN FRANCISCO` and the caption `WIND` are visible. Right-click the glyph: the toast now names San Francisco. Press Super+Ctrl+Alt+W: closed within 15 s.
  * Unhappy path: run `omarchy weather location --set Malibu 34.0259` → `Invalid coordinates: 34.0259 (expected lat,lon)`; the panel still says San Francisco.
  * Round trip: run `omarchy-weather-location --clear`, middle-click the glyph (back to the auto-detected place); close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+Alt+W is `<M-C-A-w>`. The captions are small (the acceptance suite OCRs at 2x); look near the bottom of the panel. wttr.in / Open-Meteo can be slow and the panel retries by itself: screenshot repeatedly instead of waiting more than 5 s; a `--` temperature only means the fetch has not returned yet.
  * If the panel stays blank for 30 s, `curl -sI https://api.open-meteo.com | head -1` separates a network failure from a shell failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar with the weather glyph; the panel with conditions and forecast; the panel opened and closed by the hotkey; the status toast; the Paris suggestions, the panel reading `PARIS` and again after reopen, the panel after ✕; the panel showing `SAN FRANCISCO` and `WIND` with the matching toast; the coordinates rejection; the desktop after closing
  * If unsuccessful
  ** Screenshot of `Fetching forecast…` persisting beyond 60 s, no glyph at all, or a blank/errored panel; `omarchy-weather-status` output and the curl line
covers: shell/plugins/panels/weather/Panel.qml (startEditingLocation, geocode, pickSuggestion, clearLocation); shell/plugins/panels/weather/BarWidget.qml:78-80 (togglePanel, right-click toast, middle refresh); shell/plugins/panels/weather/Model.js; bin/omarchy-weather-location; bin/omarchy-weather-status; bin/omarchy-notification-weather; default/hypr/bindings/utilities.lua Super+Ctrl+Alt+W; test/acceptance.d/panels-test.sh:51-60 (weather); test/shell.d/weather-test.sh; manual/05:22; manual/07:211; manual/10:13-17
merged-from: 31:weather-panel-forecast-and-location; 10:weather-widget-panel-and-location; 30:weather-widget-panel-and-status-toast; 50:panel-weather-san-francisco

### weather-location-cli-set-status-clear   [VM-OK] [NET]
description: The weather location can be pinned by name with or without coordinates, is stored as JSON and reported back by `omarchy-weather-location`, drives the status line, the icon and the bar widget, rejects malformed coordinates and unknown flags, and clears back to IP auto-detection; tiny wttr.in requests.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-weather-location; echo "exit=$?"` → the auto-detected city or nothing (no location pinned on a fresh disk) — record which. Run `omarchy-weather-status` → `<City>  ·  Temp NN°C  ·  Wind …` (or `Weather unavailable`, exit 1, if wttr.in failed — retry once).
  * Run `omarchy-weather-location --set Malibu 34.02577,-118.7804; jq -c . ~/.local/state/omarchy/settings/weather.json` → `{"name":"Malibu","latitude":34.02577,"longitude":-118.7804}`; `omarchy-weather-location` → `Malibu`; `omarchy-weather-status` → starts with `Malibu  ·  Temp`; `omarchy-weather-icon` → a single glyph.
  * Click the weather widget in the bar: the panel shows `Malibu` as the location (allow up to a minute for the temperature). Escape.
  * Run `omarchy-weather-location --set Reykjavik; jq -c . ~/.local/state/omarchy/settings/weather.json` → `{"name":"Reykjavik"}`; the status line starts with `Reykjavik`.
  * Unhappy path, each with `; echo "exit=$?"`: `omarchy-weather-location --set Nowhere 12,abc` → `Invalid coordinates: 12,abc (expected lat,lon)`, `exit=1` and the file still holds Reykjavik; `omarchy-weather-location --set` → usage, `exit=1`; `omarchy-weather-location --frob` → usage, `exit=1`.
  * Run `omarchy-weather-location --clear; ls ~/.local/state/omarchy/settings/weather.json` → `No such file`; `omarchy-weather-location` → the value from the first step again.
  * Middle-click the weather glyph (refresh); close the terminal with Super+W; the widget is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A `--` temperature in the widget only means the fetch has not returned yet; the JSON file and the name printouts are the proof, the panel is the confirmation.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots of each JSON state and name printout, the Malibu/Reykjavik status lines, the icon glyph, the three rejections with `exit=1`, the cleared state; the panel showing Malibu
  * If unsuccessful
  ** Screenshot of malformed coordinates accepted, a wrong JSON shape, or the panel ignoring the pinned name; `curl -sS --max-time 4 'https://wttr.in/?format=%l'` to separate a wttr.in outage from a script defect; `omarchy-version`
covers: bin/omarchy-weather-location; bin/omarchy-weather-status; bin/omarchy-weather-icon; bin/omarchy-notification-weather; shell/plugins/panels/weather/Model.js; shell/plugins/panels/weather/Panel.qml; test/shell.d/weather-test.sh; manual/05-the-top-bar.md
merged-from: 52:weather-location-cli; 25:weather-location-set-status-clear

### weather-panel-offline-keeps-state   [VM-OK] [NET]
description: When networking is switched off the network icon changes, the weather pill stays, its panel keeps the last data and offers no city suggestions, and it recovers once networking is back on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Wait for the weather glyph to appear right of the clock (screenshot every 5 s, up to 30 s). Open a terminal with Super+Enter and run `nmcli networking off`: the network bar icon turns into the disconnected glyph; the weather glyph stays.
  ** If nmcli asks for authentication, type `prime` in the polkit dialog; if it fails, report it and skip the offline half.
  * Click the weather glyph: the last conditions are still shown. Click the location, type `Berlin`: no suggestions appear. Press Escape (cancels the edit), Escape (closes).
  * Run `nmcli networking on`; screenshot every 5 s until the network icon is the ethernet glyph again.
  * Middle-click the weather glyph, then click it: the data is present (refreshed). Press Escape.
  * Unhappy path: an error text in the panel or the glyph vanishing while offline is the failure to report.
  * Close the terminal with Super+W; the desktop is as before with networking on.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never leave the VM with networking off; if `nmcli networking on` does not restore the ethernet glyph within a minute, run it again and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar with the disconnected network icon and the weather glyph still present; the panel offline with no suggestions; the network restored; the panel after refresh
  * If unsuccessful
  ** Screenshot of an error text in the panel or the glyph vanishing; `./client get-serial`
covers: shell/plugins/panels/weather/Panel.qml (retry timers, report kept on failure, geocodeProc); shell/plugins/panels/network/Panel.qml (kind disconnected icon)
merged-from: 31:weather-panel-offline-keeps-state

### osd-cards-render-hide-and-click-through   [VM-OK]
description: The on-screen display renders a progress card and a message card at the bottom centre from `omarchy-osd` (icon, message, progress, duration), hides after its duration, never takes focus or blocks clicks to the window beneath it, and refuses an unknown flag.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter (it tiles to fill the screen). Run `omarchy-osd -i volume-high -p 40 -d 6000`: within two seconds a rounded card near the bottom centre shows a speaker glyph, a bar filled 40 % in the accent colour, and `40%`. Wait seven seconds (screenshot at 5 s and 7 s): the card is gone.
  * Run `omarchy-osd -i volume-muted -p 0 -d 6000`: a muted-speaker glyph with an empty bar and `0%`. Run `omarchy-osd -i brightness -p 30 -d 3000`: a monitor glyph at 30 %, gone after ~3 s.
  * Run `omarchy-osd -i microphone-muted -m "Microphone muted"`: a muted-mic glyph with text and no bar. Run `omarchy-osd -m "Hello OSD"`: text only.
  ** The default duration is ~1.2 s: run the command and screenshot immediately (./client-with-image).
  * Run `omarchy-osd -m "Click through me" -d 15000`: a text-only card over the lower part of the terminal. Left-click exactly on that card (x≈0.5, y≈0.93), then type `echo clicked` and Enter: the terminal prints `clicked` and the card is still visible (the click passed through and did not dismiss it).
  * Unhappy path: run `omarchy-osd --bogus 1; echo "exit=$?"` → `Unknown OSD option: --bogus`, `exit=1`, no card.
  * Close the terminal with Super+W; no card remains.
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
  ** Screenshots of the 40 % card and the empty screen after expiry; the muted 0 % card; the brightness card; the mic and text-only cards; the message card with `clicked` printed beneath it while still visible; the terminal rejection line with `exit=1`
  * If unsuccessful
  ** Screenshot with no card, or with the card dismissed by the click; the output of `omarchy-shell osd show '{"icon":"volume-high","message":"","value":"50","progressText":"50%","max":"100","duration":""}'`
covers: bin/omarchy-osd; shell/plugins/osd/Osd.qml (show/hideTimer, mask: Region {}, keyboardFocus None); shell/plugins/osd/OsdModel.js (iconFor, stateForShow); test/shell.d/osd-test.sh
merged-from: 30:osd-shows-hides-and-is-click-through; 25:osd-volume-brightness-direct

### media-keys-osd-on-dummy-output   [VM-PARTIAL]
description: The bound media keys — injected inside the guest with `wtype -k` because the driver cannot send XF86 keysyms — drive the volume OSD through PipeWire's Dummy Output, the brightness key fails quietly (no backlight), the mic-mute key reports `Microphone on` (no source), Caps Lock shows no OSD because it is the Compose key, and the volume CLI behind the keys moves the level, mutes, switches output and refuses bad actions; real speakers, backlight and microphone are not exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `pactl list sinks short` → one `auto_null` line; `omarchy-audio-output-sink` → `auto_null`; `omarchy-audio-sink-availability` → `auto_null<TAB>1`.
  ** If there is no sink at all, note it and expect `Could not resolve an audio sink to control.` / `No audio devices found` below instead of OSD cards.
  * Run `wtype -k XF86AudioRaiseVolume`: within two seconds a volume OSD card with a speaker glyph and a percentage appears bottom-centre (5 higher than before; `pactl get-sink-volume auto_null` agrees). Run `wtype -k XF86AudioLowerVolume`: the percentage drops by 5. Run `wtype -k XF86AudioMute` twice: a muted glyph, then unmuted (`pactl get-sink-mute auto_null` → `yes` between them).
  ** `omarchy-audio-output-volume raise|lower|mute-toggle` is the fallback if `wtype` is missing.
  * Run `omarchy-audio-output-volume +1` → +1 %; `omarchy-audio-output-volume -3` → −3 %; `omarchy-audio-output-switch` → an OSD naming `Dummy Output` (one sink rotates onto itself).
  * Run `wtype -k XF86MonBrightnessUp`: wait two seconds — NO card and no error text (there is no backlight). Confirm the quiet failures: `omarchy-hw-display; echo "exit=$?"` → empty, `exit=1`; `ls /sys/class/backlight/` → empty; `omarchy-brightness-display +5%; echo "exit=$?"` → `exit=1` and NO OSD; `omarchy-brightness-keyboard up; echo "exit=$?"` → `No keyboard backlight device found`, `exit=1`; `omarchy-brightness-display-apple; echo "exit=$?"` → `No Apple Display HID device found`, `exit=1`. Then, as ONE line, `omarchy-brightness-display off; sleep 4; omarchy-brightness-display on`: the screen goes dark (a black or frozen screenshot) and comes back within ~5 s — `off`/`on` still drive DPMS.
  ** If the screen stays dark after `on`, press any key (Hyprland wakes DPMS on key press) and report it.
  * Run `wtype -k XF86AudioMicMute`: a card reading `Microphone on` (or `Microphone muted`) appears; record the text — reporting a state with no microphone present is the current behaviour, note it, do not fail on it.
  * Media keys have no player either: `omarchy-shell media ping` → `ok`; `omarchy-shell media status | jq '{hasPlayer, hasMedia, playing}'` → all `false`; `omarchy-shell media playPause; omarchy-shell media next; omarchy-shell media sourceNext` → three lines `unhandled`; screenshot the bar: no now-playing label or glyph anywhere (the media widget hides without media); `omarchy-shell shell ping` → `ok` afterwards.
  * Press Caps Lock (`<CAPSLOCK>`), wait two seconds: no card. Then type `'e`: the terminal shows `é` (Caps Lock is Compose, not a lock — there is no Caps Lock OSD by design).
  * Unhappy path: `omarchy-audio-output-volume; echo "exit=$?"` → usage, `exit=1`; `omarchy-audio-output-volume sideways; echo "exit=$?"` → `Unknown volume action: sideways`, `exit=1`; `omarchy-audio-output-set-default; echo "exit=$?"` → usage, `exit=1`.
  * Round trip: raise/lower back to the starting percentage, make sure the sink is unmuted, close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal must have focus when `wtype` runs; it does right after Super+Enter. OSD cards last ~1.2 s: screenshot immediately with ./client-with-image.
  * A card with a box glyph, a hung script, an error dialog or a card that never hides is the failure; both "card" and "nothing" are passes for the brightness key.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The `auto_null` lines; OSD screenshots for raise, lower, mute and unmute with the pactl values agreeing; the +1/−3 cards; the `Dummy Output` switch card; no card after the brightness key with the brightness helpers' exit codes and messages; the dark screen during DPMS off and the desktop back after on; the microphone card text; the media service `ok`, all-false status and three `unhandled` lines with no media widget on the bar; no card after Caps Lock and `é` in the terminal; the three usage errors
  * If unsuccessful
  ** Screenshot of an error dialog, broken glyph or stuck card, an OSD for a failed brightness call, the screen not returning after DPMS, `Target not found.` from the media service or a media widget rendered with nothing playing; `pactl info; wpctl status | sudo tee /dev/ttyS0` read via get-serial
covers: default/hypr/bindings/media.lua (XF86Audio*/XF86MonBrightness* bindings); bin/omarchy-audio-output-volume; bin/omarchy-audio-output-sink; bin/omarchy-audio-output-switch; bin/omarchy-audio-sink-availability; bin/omarchy-audio-input-mute; bin/omarchy-audio-output-set-default; bin/omarchy-brightness-display; bin/omarchy-brightness-display-ddc; bin/omarchy-brightness-display-apple; bin/omarchy-brightness-keyboard; bin/omarchy-brightness-keyboard-mute; bin/omarchy-hw-display; bin/omarchy-osd; shell/plugins/osd/OsdModel.js; shell/plugins/services/media/Service.qml (IpcHandler, selectActivePlayer); shell/plugins/services/media/MediaModel.js; shell/plugins/services/media/BarWidget.qml visible: hasMedia; default/hypr/input.lua compose:caps; test/shell.d/audio-test.sh; test/shell.d/brightness-display-test.sh; test/shell.d/hw-display-test.sh
merged-from: 30:osd-media-keys-without-hardware; 25:volume-keys-on-dummy-output; 25:brightness-no-backlight-and-dpms; 32:media-service-absent-player

### notification-send-lifetimes-and-urgency   [VM-OK]
description: `omarchy-notification-send` pops a toast top-right under the bar that lives five seconds at the default low urgency, eight at normal, longer when the sender asks (`-t` stretches but never shortens below the floor), forever when critical, pauses while hovered, and supports a glyph, a printed id and in-place replacement; the bare command prints usage and shows nothing, and a plain `notify-send` renders because the shell itself is the notification daemon.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; if it covers the top-right corner move it with Super+Shift+Left. Type `omarchy-notification-send "Acceptance notification" "Shell notification rendering" --expire-time=15000` Enter: within 15 s a card in the top-right corner just below the bar shows bold `Acceptance notification` and a lighter body `Shell notification rendering`; it is present at ~5 and ~12 s and gone by ~20 s (the sender stretched the life beyond the default).
  * Type `omarchy-notification-send "Low default"` Enter and screenshot at once, after 3 s and after 7 s: it is gone by the third screenshot (default urgency is low: 5 s). Type `omarchy-notification-send -u low -t 2000 "Short ask"`: it still lives about 5 s — `-t` never shortens a toast below its floor.
  * Type `omarchy-notification-send -u critical -g "" "Critical stays" "until dismissed"` then `omarchy-notification-send -u normal "Normal eight seconds"`: two stacked cards, the newest on top, the critical one with a differently coloured border accent. Screenshot every 5 s for 35 s: `Normal eight seconds` is gone by the second screenshot; `Critical stays` is present in all of them and survives a hover.
  * Type `omarchy-notification-send -u normal "Hover me"` and immediately move the mouse onto that card, screenshotting every 4 s for 16 s: it stays and a `✕` shows in its corner. Move the mouse away: gone within ten seconds.
  * Type `omarchy-notification-send -g 󰄬 "Hello driver" "first body"` (or `-i`/`--image` if the glyph cannot be typed): a toast with the glyph, headline and body. Type `id=$(omarchy-notification-send -p -u critical "Step 1 of 3" "Working"); echo "id=$id"` → a number and one card `Step 1 of 3`; then `omarchy-notification-send -r "$id" -u critical "Step 2 of 3" "Still working"` and `omarchy-notification-send -r "$id" -u critical "Step 3 of 3" "Done"` → still exactly one card, its text updated in place each time (count the cards — two stacked cards is the failure); `omarchy-notification-dismiss "Step 3 of 3"` → it is gone.
  * Type `notify-send "Third party" "libnotify client"` → a toast appears (no dunst or mako is involved).
  * Unhappy path: type `omarchy-notification-send; echo "exit=$?"` → a `Usage:` line, `exit=1`, no toast. Right-click `Critical stays`: dismissed. Press Super+Shift+comma (`<M-S-,>`): no cards remain.
  * Close the terminal with Super+W; the desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts sit at roughly x 0.75–0.99, y 0.03–0.1; keep the mouse off them except in the hover step and use `./client mouse move` for the hover, not click. Never wait more than 5 s at a time; a long life is proven by a series of screenshots.
  * Nerd-Font glyphs cannot be typed by the driver: use `-i`/`--image` or ASCII for the glyph step; `<`/`>` are `<LT>`/`<GT>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Acceptance notification` with both texts under the bar and present at ~12 s; the timed series for the low toast (gone by ~7 s) and the 2 s ask still at ~5 s; the stacked pair with the critical accent and the series with the normal card gone and the critical one lasting 35 s; the hovered card with `✕`; the glyph toast; the single card at each of the three replace steps and gone after dismiss; the notify-send toast; the usage line with no popup and `exit=1`; the clean screen
  * If unsuccessful
  ** Screenshot of a critical card that vanished, a normal card outliving 30 s, stacked cards after `-r`, a toast after the bare command, or no card at all; the busctl error printed by the send and `busctl --user list | grep -i notif`; `omarchy-shell notifications ping`
covers: bin/omarchy-notification-send (defaults, -g, -p, -r, -t/--expire-time); bin/omarchy-notification-dismiss; shell/plugins/notifications/Service.qml (durationFor, requestedDuration, cardSlot ticking, watchForUpdates, refreshPopup, removePopupsByOriginalId); shell/plugins/notifications/NotificationLogic.js (popupPlacement, replacementSnapshot, popupRowChanged); shell/plugins/notifications/components/NotificationCard.qml (accentColor, close button); docs/notifications.md §Toast lifecycle, §The sender contract; AGENTS.md helper rule (never raw notify-send); test/acceptance.d/shell-surfaces-test.sh:88-95; test/shell.d/notification-send-test.sh; default/hypr/bindings/utilities.lua:25-26
merged-from: 30:notification-toast-lifetimes; 61:notification-send-urgency-lifetimes; 50:notification-send-and-dismiss; 25:notification-send-dismiss-and-flags; 30:notification-replace-updates-card-in-place

### notification-send-rejects-bad-options   [VM-OK]
description: The notification sender refuses missing or unknown options, a bad urgency, a bad timeout, a non-numeric replace id, a quoted whole `--exec` command and a bare `--exec` with exact messages and no toast, while dash-leading text is still accepted as content and a forged hint is only refused in option position (a leading `--hint=…` becomes the headline by design).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send; echo "exit=$?"`: a `Usage:` line, `exit=1`, no toast.
  * Run `omarchy-notification-send "Hi" --nope; echo "exit=$?"` → `Unknown option: --nope` plus usage, `exit=1`; `omarchy-notification-send "x" "y" --hint=foo; echo "exit=$?"` → `Unknown option: --hint=foo` plus usage, `exit=1`, no toast.
  * Run `omarchy-notification-send -u bogus "Hi"; echo "exit=$?"` → `Unknown urgency: bogus (use low, normal, or critical)`, `exit=1`; `omarchy-notification-send -t abc "Hi"; echo "exit=$?"` → `Invalid -t value (milliseconds expected): abc`, `exit=1`; `omarchy-notification-send -r abc "x"; echo "exit=$?"` → `Invalid -r value (numeric id expected): abc`, `exit=1`.
  * Run `omarchy-notification-send "Bad exec" --exec "xdg-terminal-exec -e btop"; echo "exit=$?"` → `--exec takes the command as separate words, not one quoted string.` and `Write:  --exec xdg-terminal-exec -e btop`, `exit=1`, no toast; `omarchy-notification-send "Click me" --exec; echo "exit=$?"` → `--exec needs a command: --exec <program> [args...]`, `exit=1`.
  ** On the 4.0.2 build `--exec` may still take a shell string; record `omarchy-version` if it is accepted and report version skew, not a defect.
  * Accepted content: run `omarchy-notification-send "-50% off" "-1 is a body too"` → a toast whose title is literally `-50% off`; `omarchy-notification-send "Sale" "-50% off today"` → body `-50% off today`; `omarchy-notification-send "--exec" "literal headline"` → a toast headlined `--exec`; `omarchy-notification-send --hint=foo "x"; echo "exit=$?"` → `exit=0` and a toast whose HEADLINE is literally `--hint=foo` with body `x`.
  * Wait two seconds after each rejected command and confirm no toast appeared before the next.
  * Press Super+Shift+comma to clear the accepted toasts; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `<`/`>` are `<LT>`/`<GT>` if you need them; every message above is exact — copy it from the screenshot into the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots showing each rejection message with `exit=1` and no toast on screen; the four accepted toasts with the dash-leading / `--exec` / `--hint=foo` text rendered literally
  * If unsuccessful
  ** A toast appearing after a rejected command, a missing message, or a case accepted/rejected wrongly; `omarchy-version`
covers: bin/omarchy-notification-send (option parsing, --exec guards, forged-hint position rule); docs/notifications.md (Click commands are argv); test/shell.d/notification-send-test.sh
merged-from: 30:notification-send-rejects-bad-arguments; 25:notification-send-rejects-bad-options

### notification-dismiss-hotkeys-and-mouse   [VM-OK]
description: Toasts are dismissed by right-click, by the hover-revealed close button (which never fires the click command), by Super+comma for the newest and Super+Shift+comma for all; Super+Alt+comma re-runs the last toast's click command even after it expired, Super+Shift+Alt+comma opens the history, and a dismiss with nothing on screen is a harmless no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `for i in 1 2 3; do omarchy-notification-send -u critical --app-name Demo "Toast $i" "body $i"; done`: three cards stack top-right, `Toast 3` on top.
  * Right-click `Toast 3`: it is gone, two remain. Press Super+comma: `Toast 2` is gone, `Toast 1` remains.
  * Run `omarchy-notification-send -u critical "Close button" "Hover then hit the x" --exec xdg-terminal-exec` and move the mouse onto it: a `✕` appears in the card's top-right corner. Left-click exactly on the `✕`: the card is gone AND no terminal opened.
  * Press Super+Shift+comma: `Toast 1` is gone; no cards remain.
  * Press Super+Shift+Alt+comma: the history overlay lists Toast 1–3 (and `Close button`) newest first. Escape.
  * Run `omarchy-notification-send "Probe" "invoke me" --exec foot --title INVOKED`, wait ~6 s for the toast to expire, then press Super+Alt+comma: a terminal titled `INVOKED` opens even though the toast is gone. Close it with Super+W.
  * Press Super+Ctrl+Alt+T three times: three time notices stack; Super+comma removes the newest, Super+Shift+comma the rest.
  * Unhappy path: press Super+comma with nothing on screen: nothing changes, no error dialog. Close the terminal with Super+W; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The chords are `<M-,>` dismiss one, `<M-S-,>` dismiss all, `<M-A-,>` invoke last, `<M-S-A-,>` history. Normal toasts last 8 s and the time notice 5 s: screenshot promptly. If a chord cannot be sent, `omarchy-shell notifications dismissOne|dismissAll|invokeLast|showHistory` do the same.
  * The `✕` is an 18 px target 3 px inside the corner — use ./client-with-image to aim; count the cards after each dismiss, the newest is at the top of the stack.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: three cards; two after the right-click; one after Super+comma; the revealed `✕`; that card gone with no new terminal; none after Super+Shift+comma; the history with the entries; the `INVOKED` terminal after Super+Alt+comma; the three time notices reduced to two then none; the unchanged desktop after the empty dismiss
  * If unsuccessful
  ** Screenshot of the wrong card removed, a terminal opened by the `✕` click, toasts that did not dismiss, or no terminal after invoke-last; `./client get-serial`
covers: shell/plugins/notifications/components/NotificationCard.qml (RightButton, closeRequested, close-button stacking); shell/plugins/notifications/Service.qml dismissPopup; IPC dismissOne/dismissAll/invokeLast/showHistory; default/hypr/bindings/utilities.lua:25-29,93; docs/notifications.md §Helper commands (hotkeys); bin/omarchy-notification-send (--exec); bin/omarchy-notification-time; manual/03:36; manual/07:160-168,209
merged-from: 30:notification-dismiss-mouse-and-hotkeys; 61:notification-hotkeys-dismiss-invoke-history; 10:notifications-dismiss-invoke-history; 40:hypr-notification-chords

### notification-history-replay-trim-and-clear   [VM-OK]
description: Expired and dismissed toasts land in history on disk; Super+Shift+Alt+comma replays the most recent ones as fresh toasts newest-first, a placeholder toast explains an empty history, the history keeps at most ten entries, and `omarchy-shell notifications clear` forgets it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell notifications clear`, then press Super+Shift+Alt+comma: a single toast `No recent notifications` with a bell glyph.
  * Wait six seconds, then run `for i in 1 2 3; do omarchy-notification-send -u normal "History $i" "body $i" -t 1500; done; sleep 4` and wait until no card is on screen. Run `ls ~/.local/state/omarchy/notifications/history/ | wc -l` → `3`; `ls ~/.local/state/omarchy/notifications/` shows no live files.
  * Press Super+Shift+Alt+comma: within three seconds three cards are back, `History 3` on top and `History 1` at the bottom.
  ** Replayed toasts get a fresh standard lifetime (5 s here), so screenshot right after the hotkey.
  * Run `for i in $(seq 1 12); do omarchy-notification-send "Trim $i" -t 500; sleep 0.7; done; sleep 2; ls ~/.local/state/omarchy/notifications/history/ | wc -l` → `10` (trimmed). Press Super+Shift+Alt+comma: the replay shows no more than ten entries and `History 1`–`History 3` are no longer among them. Wait for them to expire.
  * Unhappy path: run `omarchy-shell notifications clear`, press Super+Shift+Alt+comma: `No recent notifications` again; `ls ~/.local/state/omarchy/notifications/history/ | wc -l` → `0`.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkey is `<M-S-A-,>`; `omarchy-shell notifications showHistory` is the same action from the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the placeholder toast; the `wc -l` values 3, 10 and 0; the three replayed toasts in newest-first order; the ≤10 replay without the early entries; the placeholder again after clearing
  * If unsuccessful
  ** Screenshot after the hotkey with nothing replayed or more than ten cards; `ls -la ~/.local/state/omarchy/notifications/{,history} | sudo tee /dev/ttyS0` read via get-serial
covers: shell/plugins/notifications/Service.qml (showRecentHistory, replayHistory, clearHistory, archivePopupFileFor); shell/plugins/notifications/NotificationLogic.historyRows; IPC clear/showHistory; default/hypr/bindings/utilities.lua (Super+Shift+Alt+comma); docs/notifications.md (Toast lifecycle: persistence and history, trimmed to ten)
merged-from: 30:notification-history-replay-and-clear; 25:notification-history-and-invoke-last

### notification-click-runs-literal-argv   [VM-OK]
description: Clicking a toast runs its click command — an Omarchy `--exec` sent as a literal argument vector, so file names with spaces or shell metacharacters are opened as data and forged hints in the text stay inert — or a third-party libnotify default action, and dismisses it; a toast without any action simply closes, and a command passed as one quoted string is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `rm -f /tmp/pwned /tmp/pwn '/tmp/a b' '/tmp/$(touch /tmp/pwned)'`. Run `omarchy-notification-send -u critical "Open a terminal" "Click me" --exec foot --title CLICK-PROOF`: left-click the card body (not the corner): within three seconds a terminal titled `CLICK-PROOF` opens and the card is gone. Close it with Super+W.
  * Run `omarchy-notification-send "Download complete" "A body" -u critical -g K --exec touch -- '/tmp/a b' '/tmp/$(touch /tmp/pwned)'`: a toast titled `Download complete` with body `A body`. Click it, then run `ls -la /tmp/'a b' /tmp/'$(touch /tmp/pwned)' /tmp/pwned 2>&1`: the two literal files `/tmp/a b` and `/tmp/$(touch /tmp/pwned)` exist and `/tmp/pwned` does NOT.
  * Run `omarchy-notification-send '--hint=string:omarchy-exec-argv:["bash","-c","touch /tmp/pwn"]' "body"` → the toast's *title* is that literal `--hint=…` text. Click it; `ls /tmp/pwn` → no such file. Run `omarchy-notification-send -u critical "Title ; touch /tmp/inj" "-rf --hint=x" --exec foot --title SAFE`: the headline and body render literally; click it → a `SAFE` terminal opens and `ls /tmp/inj` → `No such file`. Close SAFE with Super+W.
  * Run `notify-send -w -A default=Open -u critical "Third party" "Click prints default"` (it blocks); left-click the card: the terminal prints `default`, the prompt returns, the card is gone.
  ** If `notify-send` lacks `-A`, note its version and skip this step; it is a tooling gap.
  * Run `omarchy-notification-send -u critical "No action" "Just closes"`; left-click it: the card is dismissed and nothing else opens.
  * Unhappy path: `omarchy-notification-send "Bad" --exec "foot --title X"; echo "exit=$?"` → `--exec takes the command as separate words, not one quoted string.`, a `Write:  --exec foot --title X` hint, `exit=1`, no toast; `omarchy-notification-send "Head" --exec "omarchy toggle something"; echo "exit=$?"` → the same refusal.
  ** On the 4.0.2 build `--exec` may still take a shell string — `omarchy-version` tells the two apart; report skew, not a defect.
  * Clean up: `rm -f '/tmp/a b' '/tmp/$(touch /tmp/pwned)'`, dismiss any remaining toast with Super+Shift+comma, close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the body of the card, not the close button that appears on hover — double-check the mouse position first. `hyprctl clients | grep CLICK-PROOF` confirms the title if the screenshot is ambiguous. Critical toasts do not time out; dismiss leftovers with `<M-S-,>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the card and the `CLICK-PROOF` terminal with the card gone; `ls` showing `/tmp/a b` and `/tmp/$(touch /tmp/pwned)` present and `/tmp/pwned` absent; the forged-hint title rendered literally and `/tmp/pwn` absent; the literal hostile headline/body, the `SAFE` terminal and `ls /tmp/inj` failing; the terminal showing `default` after the third-party click; the no-action card dismissed with nothing opened; the two refusals with `exit=1`
  * If unsuccessful
  ** Screenshot of `/tmp/pwned`, `/tmp/pwn` or `/tmp/inj` existing, a card surviving the click, no terminal appearing, or a quoted `--exec` accepted; `cat ~/.local/state/omarchy/notifications/*.json` showing the exec hint; `omarchy-version`
covers: bin/omarchy-notification-send:162-179 (--exec argv); shell/plugins/notifications/NotificationLogic.js (parseExecArgv); shell/plugins/notifications/Service.qml (invokePopupDefault, focusApp); NotificationServer actionsSupported; IPC invokeLast; default/hypr/bindings/utilities.lua Super+Alt+comma; docs/notifications.md §Click commands are argv, never shell strings; test/shell.d/notification-send-test.sh; test/shell.d/notifications-test.sh; manual/10-notices.md
merged-from: 52:notification-send-click-command-is-literal-argv; 30:notification-click-acts; 61:notification-click-runs-exec-command

### notification-do-not-disturb-rules   [VM-OK]
description: Do-not-disturb — toggled from the bar indicator, Super+Ctrl+comma, `omarchy-toggle-notification-silencing` or Trigger → Toggle → Notifications, with no toast of its own — hides ordinary notifications into history, still lets Omarchy's own action toasts and bare critical `notify-send` alerts through but not a branded app's critical alert, and turning it off shows toasts again with the silenced ones listed in history.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell notifications clear`, then `notify-send -a demo "Before DND" "visible"` → a toast appears; wait for it to expire (~8 s).
  * Hover left of the clock to reveal the indicators and left-click the bell-slash glyph: it is drawn solid next to the clock and stays when the mouse leaves; its tooltip reads `Allow Notifications`. No toast announces DND — the solid indicator is the only feedback. Run `cat ~/.local/state/omarchy/notifications.json` → `"dnd": true`; `omarchy-shell notifications ping` → `ok`.
  * Run `notify-send -a Demo "Hidden normal"`, then `omarchy-notification-send --app-name Slack "Silenced one" "should not show"`: wait three seconds each — NO toast.
  * Run `omarchy-notification-send "Omarchy action shows"` then `notify-send -u critical "Critical notify-send shows"`: both toasts appear (Omarchy action toasts and bare critical CLI alerts bypass). Press Super+Ctrl+Alt+T: the time toast also appears under DND.
  * Run `notify-send -a Discord -u critical "Branded critical hidden"` and `omarchy-notification-send --app-name Slack "Silenced critical" "still hidden" -u critical`: wait three seconds — NO new toast (a critical from an ordinary branded app does not bypass).
  * Press Super+Ctrl+comma: the solid bell-slash disappears and `notifications.json` says `"dnd": false`. Run `notify-send -a Demo "Now visible"`: the toast appears. Right-click the remaining critical toast, wait for the rest to expire, then press Super+Shift+Alt+comma: the replay includes `Hidden normal`, `Silenced one`, `Branded critical hidden` and `Silenced critical` (silenced but recorded) alongside the ones that were shown, but not `Omarchy action shows` (ephemeral). Escape.
  * Unhappy path: run `omarchy-toggle-notification-silencing; omarchy-toggle-notification-silencing`: the indicator ends off, as it started, with no toast and no crash. Also toggle once on and once off via Super+Space → Trigger → Toggle → Notifications (or `omarchy toggle notification silencing`): same result.
  * Close the terminal with Super+W; DND is off and the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The DND hotkey is `<M-C-,>`. `notify-send -a Demo` / `--app-name Chat` makes the sender third-party and non-ephemeral so the silenced toast is recorded (a bare `notify-send "x"` while silenced is dropped; without `--app-name`, `omarchy-notification-send` is treated as Omarchy's own confirmation and bypasses).
  * Take a screenshot 2–3 s after each send so a missing toast is a positive observation, not a timing miss. `omarchy-shell notifications setDnd false` is another way off if the indicator state is unclear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the first toast; the solid DND indicator with its tooltip, `"dnd": true` and no announcing toast; no toast after the two silenced sends; the two bypassing toasts and the time toast; no toast after the two branded criticals; the indicator gone with `"dnd": false` and `Now visible` shown; the replay listing the four silenced entries and not the ephemeral action toast; the indicator off after the double toggle and after the menu round trip
  * If unsuccessful
  ** Screenshot of a toast that should have been hidden (or hidden that should have shown) with the indicator state visible, or a toast announcing DND; `cat ~/.local/state/omarchy/notifications.json`; `omarchy-version`
covers: shell/plugins/bar/indicators/Dnd.qml; shell/plugins/notifications/Service.qml (setDoNotDisturb, handleNotification, writeSilenced); shell/plugins/notifications/NotificationLogic.js (shouldBypassDnd, isEphemeralApp, historyRows); bin/omarchy-toggle-notification-silencing; default/hypr/bindings/utilities.lua:27-29 (Super+Ctrl+comma); docs/notifications.md §Silencing; default/omarchy/omarchy-menu.jsonc trigger.toggle; test/shell.d/notifications-test.sh; test/shell.d/runtime-smoke-test.sh; manual/07:166; manual/10-notices.md; manual/13:14,58-63
merged-from: 30:notification-do-not-disturb; 61:notification-silencing-bypass-rules; 52:notification-dnd-bypass-and-history; 25:toggle-notification-silencing-dnd; 10:do-not-disturb-silences-and-keeps-history

### notification-survives-shell-restart   [VM-OK]
description: A live critical toast is persisted to disk and re-rendered after the shell restarts (as `omarchy update` does), still runs its click command, and its file moves to history once handled, while a toast that had already expired is not brought back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical "Survive restart" "I should come back" --exec foot --title PERSISTED`: the card is present. Run `ls ~/.local/state/omarchy/notifications/` → one `<timestamp>-<id>.json` file.
  * Run `omarchy-restart-shell` (or `omarchy restart shell`) and screenshot every 3–5 s: the bar disappears and returns within ~15 s; a second or two after it is back the `Survive restart` card is on screen again.
  * Left-click the restored card: a terminal titled `PERSISTED` opens (the click command was restored too) and the card is gone. Close it with Super+W. Run `ls ~/.local/state/omarchy/notifications/history/`: the toast's file has moved here. Run `omarchy-shell shell ping` → `ok`.
  * Unhappy path: run `omarchy-notification-send "Expires before restart"`, wait six seconds so it expires, then run `omarchy-restart-shell`: after the bar returns there is NO `Expires before restart` card.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar vanishing for a few seconds is the restart; the terminal window stays. Restored toasts start with a full lifetime; critical ones have none. Allow one extra screenshot after the bar returns for the re-render.
  * If the bar does not return within ~15 seconds, run `omarchy restart shell` once more and report it. `omarchy-restart-shell` refuses while the screen is locked — irrelevant here, but do not lock during this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot before the restart with its json file; with the bar gone; with the bar back and the restored card; the `PERSISTED` terminal after the click and the file under `history/`; `ok` from ping; the screen after the second restart without the expired card
  * If unsuccessful
  ** Screenshot of the desktop after restart without the card; `journalctl --user -n 50 | sudo tee /dev/ttyS0` read via get-serial
covers: shell/plugins/notifications/Service.qml (persistPopupFile, restorePopups); shell/plugins/notifications/NotificationLogic.js (persistablePopup, popupExpired); bin/omarchy-restart-shell; docs/notifications.md §Toast lifecycle (persistence files, restored toasts click through); docs/omarchy-shell.md (omarchy-restart-shell); test/shell.d/notifications-test.sh restore assertions
merged-from: 30:notification-survives-shell-restart; 61:notification-survives-shell-restart

### notification-markup-sanitised-titles-plain   [VM-OK]
description: Notification bodies keep simple markup like bold but never render an `<img>` tag in any spelling — a local listener proves nothing is fetched — a Chromium-style leading origin link is stripped, and text from outside the shell (a notification summary, a window title) is always plain text so it can never make the shell issue a network request.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and start a local listener that would log any fetch: `python3 -m http.server 8877 --bind 127.0.0.1 > /tmp/http.log 2>&1 &`.
  * Run `omarchy-notification-send -u critical "Img" '<img src="http://127.0.0.1:8877/plain.png">Hello <b>bold</b>'` → the toast body reads `Hello bold` with `bold` in bold weight; no image, no broken-image placeholder and no literal `<img` text.
  ** Send `<` as `<LT>` and `>` as `<GT>`; check each line with ./client-with-image before Enter — a mistyped command shows as a shell error, not a toast.
  * Run `omarchy-notification-send "Img2" "$(printf '<x\n<img src="http://127.0.0.1:8877/split.png">')"` → body shows at most `<x` and no image; `omarchy-notification-send "Img3" '<IMG SRC="http://127.0.0.1:8877/upper.png">shout'` → body `shout`; `omarchy-notification-send "Img4" '< img src="http://127.0.0.1:8877/spaced.png">after'` → body `after`. Also `notify-send -a Demo -u critical "Markup" "<b>bold</b> then <img src=\"http://127.0.0.1:8877/x.png\"> after"` → `bold then  after` with `bold` bold.
  * Run `omarchy-notification-send --app-name Chromium "Web" '<a href="https://example.com">example.com</a> Message body'` → body `Message body` (the leading origin link is stripped).
  * Run `notify-send -a Demo -u critical "Plain summary <b>not bold</b>"` and `omarchy-notification-send '<img src="http://127.0.0.1:8877/summary.png">Summary' 'body'` → both TITLES show the literal tags (summaries are plain text).
  * Set the terminal's window title to an image tag: `printf '\e]2;<img src="http://127.0.0.1:8877/title.png">TITLE\a'`. If the bar shows a window-title widget (left section), it must show the literal text (possibly truncated), not an image or an empty label; if the stock bar has no such widget, say so and skip this check.
  * Wait five seconds, then `cat /tmp/http.log` → NO request lines (no `GET /plain.png` etc.).
  * Round trip: `printf '\e]2;Terminal\a'`, `kill %1`, press Super+Shift+comma to dismiss the toasts, close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `http.server` prints one line per request to the log; an empty log is the proof. Dismiss toasts between steps if they stack. Zoom the screenshot on the left bar section for the title check.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each toast body without an image and with `bold` rendered bold; the Chromium-style body reduced to `Message body`; the literal tags in both summaries; the bar title check (or the note that no title widget exists); `cat /tmp/http.log` empty
  * If unsuccessful
  ** Screenshot of a pink/broken image square in a toast, rendered markup in a summary, an image or empty label where the title should be, or a `GET` line in the log; `omarchy-version`
covers: shell/plugins/notifications/NotificationLogic.js (stripImageTags, styledBody, sanitizeBody); shell/plugins/notifications/components/NotificationCard.qml textFormat (PlainText summary, StyledText body); shell/**/*.qml (textFormat contract); shell/plugins/bar (active-window); test/shell.d/qml-text-format-test.sh; test/shell.d/qml-text-format-scan.py; test/shell.d/notifications-test.sh; manual/05-the-top-bar.md; manual/10-notices.md
merged-from: 52:notification-body-markup-sanitized; 30:notification-body-markup-sanitized; 52:external-text-never-renders-as-html

### notification-position-follows-bar-edge   [VM-OK]
description: Toasts sit below a top bar, hug the top edge when the bar is at the bottom, and move inward when the bar is on the right, so they never overlap the bar wherever `omarchy bar position` puts it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical "Bar on top"`: the card's top edge sits a bar-height plus a gap below the screen top, at the right edge.
  * Run `omarchy bar position bottom`, then `omarchy-notification-send -u critical "Bar on bottom"`: the new card stack starts just a small gap below the very top edge (about 26 px higher than before).
  * Run `omarchy bar position right`, then `omarchy-notification-send -u critical "Bar on right"`: the cards sit LEFT of the vertical bar, not under it.
  * Unhappy path: a card overlapping the bar in any of the three positions is the failure to report.
  * Round trip: run `omarchy bar position top`, press Super+Shift+comma, run `rm ~/.config/omarchy/shell.json`: bar on top, no cards, as found. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare the top card's vertical position between the first two screenshots; allow up to 20 s for the bar to change position.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three screenshots with the toast stack placed relative to each bar edge as described; the final clean screenshot with the bar on top
  * If unsuccessful
  ** Screenshot of a card overlapping the bar
covers: shell/plugins/notifications/Service.qml (barPosition, barClearance); shell/plugins/notifications/NotificationLogic.popupPlacement; bin/omarchy-bar cmd_position
merged-from: 30:notification-position-follows-bar-edge

### notification-time-and-battery-notices-without-battery   [VM-PARTIAL]
description: Super+Ctrl+Alt+T shows the time notice; on a battery-less machine Super+Ctrl+Alt+B must show no toast or a `No battery` headline (03-INTENDED-BEHAVIOUR item 7 — the glyph-only toast with an empty headline that HEAD produces is a defect this test pins), and the low-battery warning script still renders its critical notification, runs the user's battery-low hook and refuses a missing argument; skipped: real battery figures.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+T: within two seconds a compact toast top-right shows a clock glyph and text like `Friday 13:09  ·  18 September 2026  ·  Week 38`; its time matches the bar clock. Wait six seconds: it expires. Press it five times quickly: the toasts stack or replace and the shell keeps running; press Super+Shift+comma to clear them.
  * Press Super+Ctrl+Alt+B and screenshot within two seconds: the intended result on a machine without a battery is NO toast, or a toast whose headline reads `No battery`. A very small toast with only the 󰁹 battery glyph and no text is the known defect (HEAD behaviour) — report it as a failure of this step with the screenshot; a hang or crash dialog is also a failure.
  * Open a terminal with Super+Enter and run `omarchy-battery-status; echo "exit=$?"` → an empty line and `exit=0`.
  * Run `omarchy-battery-low 15`: a critical notification `Time to recharge!` / `Battery is down to 15%` appears at the top right and stays.
  * Run `mkdir -p ~/.config/omarchy/hooks && printf '#!/bin/bash\necho "hook got $1" | sudo tee /dev/ttyS0\n' > ~/.config/omarchy/hooks/battery-low && chmod +x ~/.config/omarchy/hooks/battery-low`, then `sudo -v` (password `prime`) and `omarchy-battery-low 9`: a second notification stacks on the first; `./client get-serial` contains `hook got 9`. The drop-in form works too: `mkdir -p ~/.config/omarchy/hooks/battery-low.d && printf '#!/bin/bash\nomarchy-notification-send "battery hook got $1"\n' > ~/.config/omarchy/hooks/battery-low.d/probe && chmod +x ~/.config/omarchy/hooks/battery-low.d/probe`, then `omarchy-battery-low 7` → the stock warning AND a toast `battery hook got 7`.
  ** The bar shows no battery widget and Super+Space → Trigger → Toggle has no `Battery Percentage` row: the shell-side trigger is skipped on this machine, the command is what the shell would run.
  * Unhappy path: run `omarchy-battery-low; echo "exit=$?"` → `Usage: omarchy-battery-low <percentage>`, non-zero, no notification.
  * Round trip: run `rm -r ~/.config/omarchy/hooks/battery-low ~/.config/omarchy/hooks/battery-low.d`, press Super+Shift+comma to dismiss the notices, close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkeys are `<M-C-A-t>` and `<M-C-A-b>`; both notices are low urgency, screenshot promptly. Send `>` as `<GT>` in the printf line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the time toast beside the bar clock with date and week number, and the cleared desktop after five quick presses; the screen after the battery hotkey showing no toast or a `No battery` headline; the empty `omarchy-battery-status` line; the `Time to recharge!` notification; the second notice and the serial dump containing `hook got 9`; `battery hook got 7` together with the warning; the Toggle submenu without `Battery Percentage`; the usage line with no notification
  * If unsuccessful
  ** Screenshot of the glyph-only empty-headline battery toast (the pinned defect), an error dialog, no time toast, a notification on the usage path, or a hook not firing; notification history; `./client get-serial`; `omarchy-version`
covers: bin/omarchy-notification-time; bin/omarchy-notification-battery; bin/omarchy-battery-status; bin/omarchy-battery-low; bin/omarchy-hook (hooks/battery-low and battery-low.d/); bin/omarchy-notification-send; default/hypr/bindings/utilities.lua:93-95 (Super+Ctrl+Alt+T/B); default/omarchy/omarchy-menu.jsonc trigger.toggle.battery-percentage (when); shell/plugins/notifications/components/NotificationCard.qml compactGlyph; manual/07:209-211; manual/10:7; manual/31-dotfiles.md (battery-low hook)
merged-from: 30:notification-time-and-battery-hotkeys; 40:hypr-notices-battery-weather-no-hardware; 24:battery-low-notification-without-battery; 10:notice-time-hotkey; 12:hooks-battery-low-command

### crash-capture-toast-needs-agent-and-toggle   [VM-PARTIAL]
description: A user program that dumps core raises a critical `Process crashed: <name>` toast offering AI diagnosis — but only once a default agent is named (a stock disk is silent), crashes of the same program are announced once a minute, Trigger → Toggle → Crash Capture switches the watcher off and on with a confirmation, and `omarchy agent crash` refuses a non-PID; skipped: the agent launch itself (no agent is installed in the guest).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `systemctl --user is-active omarchy-crash-watch.service` → `active`; `omarchy-default-agent; echo "[$?]"` → prints nothing on a stock disk.
  * Run `sleep 300 & sleep 1; kill -SEGV $!` and wait 5 s: NO toast appears (no agent chosen — this quirk makes a stock disk look broken). Run `coredumpctl list --no-pager | tail -2`: a `sleep` row with `SIGSEGV`/11 — the crash itself was recorded.
  * Run `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` (names an agent without installing one). Run `sleep 300 & sleep 1; kill -SEGV $!`: within ~5 s a critical toast with a robot glyph reads `Process crashed: sleep` / `Click to diagnose with AI`.
  * Run the same crash line again at once: no second toast (one per program per minute). Click the toast: nothing visibly opens, or a terminal reports the missing agent — record which; a shell crash is the failure. Confirm the reason: `omarchy agent crash 1; echo "exit=$?"` → `claude is not installed. Choose an installed agent with: omarchy default agent <name>`, `exit=1`.
  * Press Super+Space → Trigger → Toggle → click Crash Capture with the mouse: toast `Crash capture disabled`; `ls ~/.local/state/omarchy/toggles/crash-capture-off && systemctl --user is-active omarchy-crash-watch.service` → the flag file is listed and `inactive`; `systemctl --user cat omarchy-crash-watch.service | grep ConditionPathExists` → `ConditionPathExists=!%h/.local/state/omarchy/toggles/crash-capture-off` (so the choice survives logout). Wait 60 s (screenshot every 5 s, so the dedupe window passes), crash again: no toast within 15 s.
  ** The toggle row carries no ✓ mark by design; the toast is the feedback. If the unit does not exist on this disk (`Unit … could not be found`), report that instead of failing the toggle.
  * Press Super+Ctrl+O (the Toggle menu chord) and click Crash Capture again: `Crash capture enabled`, the flag is gone and the service is `active`; wait 60 s and crash again: the toast is back. CLI form: `omarchy toggle crash-capture` → `Crash capture disabled`; again → `Crash capture enabled` (`omarchy-toggle-crash-capture` is the same program).
  * Unhappy path: `omarchy agent crash abc; echo "exit=$?"` → `Not a PID: abc` and `Usage: omarchy agent crash <pid>   (see: coredumpctl list)`, `exit=1`.
  * Round trip: run `rm ~/.config/omarchy/defaults/agent`, press Super+Shift+comma to clear toasts, close the terminal with Super+W; capture is on and the flag file is absent.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `Segmentation fault (core dumped)` printed in the terminal is the shell reporting the killed job; the toast is separate. Time the dedupe with `date +%s`; the window is 60 s per program name. Dismiss toasts with Super+comma between steps so a new one is unambiguous. Typing `crash` in the root menu search jumps straight to the Crash Capture row; use the mouse for the row so its click path is exercised.
  * Skipped here: handing the crash to an agent (none installed); `omarchy agent crash` explains why.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after the first crash: no toast, but a `sleep` SIGSEGV row in `coredumpctl list`; the `Process crashed: sleep` toast after setting the agent; no duplicate after the immediate second crash; what the click did; the `claude is not installed` line; `Crash capture disabled` with the flag file, `inactive`, the ConditionPathExists line and no toast after the next crash; `Crash capture enabled` from the Super+Ctrl+O menu with the flag gone, `active` and the toast back; the CLI pair of toasts; the `Not a PID` lines with `exit=1`
  * If unsuccessful
  ** A toast without an agent, none with one, a toast while disabled, the toggle not taking effect, a missing toast, or the shell crashing on click; `journalctl --user -u omarchy-crash-watch -n 30 | sudo tee /dev/ttyS0` read via get-serial; `systemctl --user status omarchy-crash-watch`; `ls ~/.local/state/omarchy/toggles/`
covers: bin/omarchy-crash-watch:64-108; bin/omarchy-toggle-crash-capture; bin/omarchy-agent-crash:14-19; bin/omarchy-agent:40-52; default/systemd/user/omarchy-crash-watch.service (ConditionPathExists); default/agents/skills/diagnose-crash/SKILL.md:119-120; default/omarchy/omarchy-menu.jsonc:92 trigger.toggle.crash-capture; default/hypr/bindings/utilities.lua:5 (Super+Ctrl+O); docs/notifications.md §Crash capture; test/shell.d/crash-capture-test.sh (toggle, unit condition, enabled by default); manual/13-toggles-idle-screensaver.md; manual/17-ai.md:43-47 §Crash diagnosis
merged-from: 13:crash-capture-notification-and-toggle; 61:crash-toast-needs-default-agent; 24:crash-capture-toast-on-segfault; 11:crash-capture-toggle-and-segfault-notification; 41:crash-watch-notification-and-toggle; 24:crash-capture-toggle-disables-watcher; 25:toggle-crash-capture; 51:crash-capture-toggle; 61:crash-capture-toggle

### reminder-set-fires-and-clears   [VM-OK]
description: A reminder set from the Super+Ctrl+R prompt or from `omarchy reminder <minutes> [message]` confirms with a toast, lights the bar's bell indicator and arms a user timer, fires a `Reminder` toast on the minute and clears the indicator; several reminders are listed and cleared together, and zero, non-numeric or malformed arguments print usage and arm nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+R: a dimmed screen with a centred card reading `Remind in minutes...`. Type `1` and press Enter: the card reads `Reminder message...`. Type `Tea is ready` and Enter: the overlay closes and a toast `Tea is ready in 1 minutes` / `You'll be reminded at HH:MM` appears; a solid bell glyph now sits left of the clock. Hover it: tooltip `1 reminder`.
  ** The reminders overlay is newer than 4.0.2; if Super+Ctrl+R shows nothing, report "absent on this build" and set the reminder with the CLI in the next step instead.
  * Open a terminal with Super+Enter and run `omarchy reminder 2 "Check the oven"; echo "exit=$?"` → toast `Check the oven in 2 minutes`, `exit=0`; `systemctl --user list-timers 'omarchy-reminder-*' --no-pager` lists two timers; the bell tooltip reads `2 reminders`.
  * Screenshot every 5 s: within about 70 s a toast `Reminder` / `Tea is ready` appears with a bell glyph, and at ~120 s `Reminder` / `Check the oven`.
  ** Timers fire on the minute, so up to ~65 s after setting; the fired toast is low urgency (5 s) — the 5 s cadence is required to catch it.
  * After both fired: the solid bell is gone; `systemctl --user list-timers 'omarchy-reminder-*' --no-pager` → `0 timers listed`; press Super+Ctrl+Alt+R → `Upcoming reminders` / `No outstanding reminders`.
  * Run `omarchy reminder 30 "Later"` then `omarchy reminder 45` (toast `Reminder set for 45 minutes`): the bell is solid again. Press Super+Shift+Ctrl+R: toast `All reminders have been cleared`, the bell goes out, the timer list is empty.
  * Unhappy path: `omarchy reminder 0; echo "exit=$?"`, `omarchy reminder abc; echo "exit=$?"`, `omarchy reminder show --bogus; echo "exit=$?"` → each prints the four-line usage and `exit=1`; no indicator lights and no timer is created. Press Super+Ctrl+R, type `abc`, Enter: the flow does not proceed (an `Invalid reminder` toast); Escape twice closes it with nothing set.
  * Close the terminal with Super+W; the bar is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `<M-C-r>` set, `<M-C-A-r>` show, `<M-S-C-r>` clear. The overlay takes keyboard focus by itself; just type. If a toast never fires, the timer listing shows whether the timer exists.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: both prompts; the confirmation toast with the solid bell and tooltip `1 reminder`; the CLI confirmation, the two-timer list and `2 reminders`; both fired `Reminder` toasts; the bar with the bell cleared and `0 timers listed`; `No outstanding reminders`; the cleared toast after Super+Shift+Ctrl+R; the three usage refusals with `exit=1` and the refused overlay input
  * If unsuccessful
  ** Screenshot at 70 s without the fired toast, a `systemd-run` error, an indicator that stays after firing, or a reminder armed from bad input; `systemctl --user list-timers 'omarchy-reminder-*'`
covers: bin/omarchy-reminder:135-201 (set, confirmation, fire payload, usage); shell/plugins/reminders/ReminderFlow.qml; shell/plugins/reminders/ReminderFlowModel.js; shell/plugins/bar/indicators/Reminder.qml; default/hypr/bindings/utilities.lua:89-91; default/omarchy/omarchy-menu.jsonc:83-85 trigger.reminder.set; docs/notifications.md §Reminders; default/agents/skills/omarchy/SKILL.md §Reminder Requests; manual/07:196-203; manual/09
merged-from: 30:reminder-set-and-fires; 10:reminder-hotkey-flow-fires-and-clears; 61:reminder-set-fires-and-clears; 20:reminder-set-fire-and-reject; 40:hypr-reminder-chords

### reminder-show-clear-and-prompt-rejects-bad-input   [VM-OK]
description: Pending reminders are listed by Super+Ctrl+Alt+R, by clicking the bell indicator, from Trigger → Reminder → Show all and by `omarchy reminder show --json`; Super+Shift+Ctrl+R clears them with a confirmation; the idle bell and `omarchy reminder -i` open the prompt, which refuses non-numeric or zero minutes with a toast and stays open, clears typed text on Escape, and closes on a second Escape, an empty submit or a click outside, creating nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-reminder 30 "Check the oven"` (toast `Check the oven in 30 minutes` / `You'll be reminded at HH:MM`, solid bell next to the clock) then `omarchy-reminder 45` (toast `Reminder set for 45 minutes`); hover the bell: tooltip `2 reminders`.
  * Press Super+Ctrl+Alt+R: toast `Upcoming reminders` listing `Check the oven in 29m …s (HH:MM)` and `45-min reminder in 44m …s (HH:MM)`. Left-click the solid bell: the same listing. Press Super+Space, type `Reminder`, Enter: a submenu `Set one` / `Show all` / `Clear all`; choose `Show all` with the arrows and Enter: the listing again. Run `omarchy reminder show --json | jq '.count, .tooltip, .reminders[0].label'` → `2`, `"2 reminders"`, `"Check the oven"` (this JSON feeds the bar indicator).
  * Press Super+Shift+Ctrl+R: toast `All reminders have been cleared`; the bell is gone; `omarchy reminder show --json | jq .count` → `0`. Press Super+Ctrl+Alt+R: `Upcoming reminders` / `No outstanding reminders`. Run `omarchy reminder clear` with nothing set: a harmless message, no crash — record it.
  * Hover left of the clock and click the dimmed bell: the `Remind in minutes...` prompt opens within 15 s. Type `abc`, Enter: within 5 s a toast `Invalid reminder` / `Enter the number of minutes` and the overlay is still open showing `abc`. Press Escape once: the text clears to the placeholder, overlay still open. Try `0`, `-5`, `1.5` and `soon` in turn, Enter after each (Escape clears between them): the `Invalid reminder` toast each time, the overlay stays on the minutes prompt — only a positive whole number is accepted. Press Escape twice: the overlay is gone.
  * Press Super+Ctrl+R, type `5`, Enter: the prompt changes to `Reminder message...`; press Escape: the overlay closes — abandoning at the message prompt schedules nothing (`omarchy-reminder show` → no reminders). Press Super+Ctrl+R and press Enter with nothing typed: the overlay closes with no toast (by design). Press Super+Ctrl+R, then left-click the dimmed area far from the card (x≈0.1, y≈0.9): the overlay closes.
  * Run `omarchy reminder -i; echo "exit=$?"`: the same prompt opens from the CLI; type `3`, Enter, `Tea`, Enter → toast `Tea in 3 minutes`; `exit=0`. Run `omarchy reminder show --json | jq -r '.reminders[].label'` → `Tea`. Run `omarchy reminder clear` → `All reminders have been cleared`.
  * Unhappy path: hover left of the clock: the bell is dimmed (nothing pending was created by the refused inputs); `systemctl --user list-timers 'omarchy-reminder-*' --no-pager` → `0 timers listed`.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hotkeys: `<M-C-A-r>` show, `<M-S-C-r>` clear, `<M-C-r>` set. The listing and invalid toasts are low urgency — screenshot promptly. The overlay is newer than 4.0.2: if it never appears, report "absent on this build" and keep the CLI/hotkey parts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: both confirmation toasts; tooltip `2 reminders`; the two-line listing from the hotkey, the bell click and the menu; the jq count/tooltip/label; the cleared toast with the bell gone and count `0`; `No outstanding reminders`; the `Invalid reminder` toast with the overlay still on the minutes prompt for `abc`, `0`, `-5`, `1.5` and `soon`; the cleared prompt; the `Reminder message...` prompt then the overlay closed with nothing scheduled; the overlay closed after Escape, the empty Enter and the outside click; the CLI-opened prompt and `Tea`; the dimmed bell and `0 timers listed`
  * If unsuccessful
  ** Screenshot of a listing that disagrees with the reminders set, wrong remaining times, timers surviving `clear`, a bell that stays solid after clear, the message prompt appearing for a rejected input, a solid bell or scheduled reminder after bad input, or an overlay that will not close; `./client get-serial`; `omarchy-version`
covers: bin/omarchy-reminder:41-43,45-133,143-146 (show, clear, -i, --json); shell/plugins/reminders/ReminderFlow.qml (promptText, submit, dismiss, Keys.onPressed, scrim MouseArea); shell/plugins/reminders/ReminderFlowModel.js validMinutes; shell/plugins/bar/indicators/Reminder.qml (onPressed, openReminderFlow); default/hypr/bindings/utilities.lua:90-91 Super+Ctrl+Alt+R / Super+Shift+Ctrl+R; default/omarchy/omarchy-menu.jsonc:57,83-85 trigger.reminder.*; test/shell.d/reminders-test.sh; test/acceptance.d/shell-surfaces-test.sh:74-86; manual/09-reminders.md
merged-from: 30:reminder-show-clear-and-indicator; 30:reminder-overlay-rejects-bad-input; 20:reminder-interactive-panel; 20:reminder-show-clear-hotkeys-and-menu; 50:reminder-flow-cancel-and-invalid-minutes; 52:reminder-rejects-invalid-minutes

### clipboard-history-pick-paste-and-filter   [VM-OK]
description: Super+Ctrl+V (and `omarchy menu clipboard`) toggles the clipboard history, which lists copies newest first with a preview pane; Return pastes the highlighted entry into the previously focused window (the manual says clipboard-only — 03-INTENDED-BEHAVIOUR item 15: CODE-INTENDED, Return pastes and copies) and moves it to the top without duplicating it, Shift+Return copies without pasting, typing filters, a miss shows the empty match state, Home/End jump, and Escape clears the filter before closing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `printf 'Omarchy acceptance clipboard 12345' | wl-copy; sleep 1; printf 'alpha-111' | wl-copy; sleep 1; printf 'beta-222' | wl-copy; sleep 1; printf 'gamma-333' | wl-copy; sleep 1; grep -c 'Omarchy acceptance clipboard' ~/.local/state/omarchy/clipboard-history.json` → 1 or more (rerun the grep if it prints 0; capture lags a moment).
  * Type `echo ` (trailing space, no Enter) and press Super+Ctrl+V: within 15 s a wide card `Search clipboard…` opens — a list on the left with `gamma-333` first, then `beta-222`, `alpha-111`, the long entry — and a preview pane on the right showing the highlighted entry's text.
  * Press Down twice (`alpha-111` highlighted; the preview follows), then Return: the picker closes and `alpha-111` lands after `echo `; press Enter — it prints. Run `wl-paste` → `alpha-111` (it is now the current clipboard).
  ** The paste goes to the previously focused window via Shift+Insert, so the terminal must be focused before the picker opens. If nothing is highlighted, the first Return only settles the cursor — watch the highlight.
  * Press Super+Ctrl+V again: `alpha-111` is now the first row and there are still exactly four rows (moved to the top, not duplicated). Type `Omarchy acceptance`: only the long row is listed and highlighted, the header shows the filter. Press Shift+Return: the overlay closes and nothing is typed. Run `wl-paste --no-newline; echo` → `Omarchy acceptance clipboard 12345`, not `alpha-111`.
  * Press Super+Ctrl+V, type `beta`: only `beta-222`; type `zzz` more: the list empties and shows the glyph with `No matches for “betazzz”`. Press Escape once: the filter clears and all rows return. Press End: the last row highlights; Home: the first. Press Escape: the picker closes.
  * Run `omarchy menu clipboard`: the same overlay opens; click the terminal and run it again: it closes.
  * Unhappy path: press Super+Ctrl+V, type `zzqqxx` (empty list, `No matches`), press Escape twice: the overlay is gone and nothing was pasted.
  * Close the terminal with Super+W; the desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+V is `<M-C-v>`, Shift+Return `<S-ENTER>`. The overlay opens without animation; the screenshot right after the hotkey is final. Text selected in a terminal is not copied automatically — that is why `wl-copy` is used. The overlay takes focus; click back into the terminal before typing commands.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The grep count; the picker with four rows newest first and the preview; `alpha-111` pasted and echoed and `wl-paste` agreeing; the picker with `alpha-111` first and still four rows; the filtered long row, the prompt untouched after Shift+Return and `wl-paste` printing the token; `No matches for “betazzz”`; both rows after the first Escape with the End/Home highlight positions; the overlay opened and closed by `omarchy menu clipboard`; the empty `zzqqxx` result and the closed overlay
  * If unsuccessful
  ** Screenshot of `Clipboard is empty` right after copying (watcher dead), nothing pasted (note whether the terminal lost focus), the filter not applying, the picker closing on the first Escape, or `wl-paste` printing the wrong entry; `jq -r '.[0:4][].text' ~/.local/state/omarchy/clipboard-history.json` and `pgrep -af 'wl-paste.*--watch'`
covers: shell/plugins/clipboard/Clipboard.qml:388-392 (watch processes, applySelected, setFilter, keyCatcher Escape/Home/End, copyIndex); shell/plugins/clipboard/ClipboardHistory.js (addEntry dedup, displayRows, searchableText); shell/plugins/clipboard/capture.sh; bin/omarchy-clipboard-paste-text (--copy-only); bin/omarchy-menu-clipboard; default/hypr/bindings/clipboard.lua:48 (Super+Ctrl+V); test/shell.d/clipboard-test.sh; test/acceptance.d/shell-surfaces-test.sh:34-48; manual/03:27; manual/08-unified-clipboard-history.md:18-24
merged-from: 10:clipboard-history-picker-paste-copy-delete; 31:clipboard-picker-pick-older-entry; 25:clipboard-history-pick-older-entry; 31:clipboard-picker-search-and-escape; 22:clipboard-manager-toggle; 50:clipboard-history-search-and-copy

### clipboard-history-delete-open-and-clear   [VM-OK]
description: In the clipboard history Delete removes one entry, Alt+Return opens a URL entry in the browser and a text entry in the editor, Shift+Delete asks before wiping everything and can be cancelled, and the wiped picker shows `Clipboard is empty` even after reopening; the open helper refuses a bad history index.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `printf 'https://omarchy.org' | wl-copy; sleep 1; for w in one two three; do printf $w | wl-copy; sleep 1; done`.
  * Press Super+Ctrl+V: rows `three`, `two`, `one`, `https://omarchy.org`. Press Down (`two` highlighted), then Delete: `two` disappears; `three`, `one` and the URL remain. Escape. Run `jq -r '.[].text' ~/.local/state/omarchy/clipboard-history.json | grep -c '^two$'` → `0`.
  * Press Super+Ctrl+V, press End (the URL row), then Alt+Return: the picker closes and a browser window opens on omarchy.org (the page body needs network; the window opening is what counts). Close it with Super+W.
  ** Click **Wait** if Chromium raises a "not responding" dialog on this 2-vCPU guest.
  * Press Super+Ctrl+V, select `one`, Alt+Return: the default editor opens a temp file under `~/.local/state/omarchy/clipboard-open/` containing `one`. Close it (Super+W).
  * Press Super+Ctrl+V, then Shift+Delete: a dialog `Delete entire clipboard history?` with [Cancel] and a red pre-selected [Delete]. Press Escape: the dialog closes and the rows are still listed.
  * Press Shift+Delete, then Enter (confirms Delete): the list is gone; the card shows the glyph with `Clipboard is empty`. Escape, then Super+Ctrl+V again: still `Clipboard is empty`; `jq length ~/.local/state/omarchy/clipboard-history.json` → `0`. Escape.
  * Unhappy path: run `omarchy-clipboard-open --history-index 99; echo "exit=$?"` → `exit=1`; `omarchy-clipboard-paste-text --copy-only ""; echo "exit=$?"` → `exit=0` with nothing copied and no crash.
  * Close the terminal with Super+W; the desktop is as found (the history starts empty on a fresh disk).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Shift+Delete is `<S-DEL>`, Alt+Return `<A-ENTER>`. If Alt+Return is not the open key on this build, the row's action hint is shown in the panel footer (Ctrl+O or an open button) — use it and note it. Activate the cursor with a first Return if no row is highlighted.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with four rows; three after Delete and the jq count 0; the browser window after Alt+Return on the URL; the editor with `one`; the confirm dialog; rows intact after Escape; `Clipboard is empty` after confirming and again after reopening with `jq length` 0; the two helper exit codes
  * If unsuccessful
  ** Screenshot of the wrong entry removed, no browser/editor after Alt+Return, the dialog missing, or history surviving the confirm; the panel state and the history JSON after the failing action
covers: shell/plugins/clipboard/Clipboard.qml (removeDisplayIndex, requestClearHistory, confirmClearHistory, openIndex, empty-state Column); shell/Ui/ConfirmDialog.qml; shell/plugins/clipboard/ClipboardHistory.js (removeEntryAt, clearHistory); bin/omarchy-clipboard-open; bin/omarchy-clipboard-paste-text; bin/omarchy-clipboard-paste-file; test/shell.d/clipboard-test.sh (keyboard navigation, clipboard-open); manual/08-unified-clipboard-history.md
merged-from: 31:clipboard-picker-delete-and-clear-history; 25:clipboard-history-copy-only-open-delete-clear; 31:clipboard-picker-copy-only-and-open-url; 51:clipboard-manager-paste-delete-open

### clipboard-history-capture-rules   [VM-OK]
description: The clipboard history records text once (a duplicate copy moves to the front), decodes UTF-16 text, collapses multi-line text to one row, shows file URIs as files and copied images as `Screenshot from …` rows with a thumbnail and large preview searchable by "screenshot", and never records a copy marked sensitive.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `printf 'first entry' | wl-copy; sleep 1; printf 'second entry' | wl-copy; sleep 1; printf 'first entry' | wl-copy; sleep 1`. Press Super+Ctrl+V: `first entry` on top, then `second entry`, and `first entry` only once. Escape.
  * Run `printf 'UTF-16 clipboard - fixed' | iconv -f UTF-8 -t UTF-16LE | wl-copy; sleep 1`; Super+Ctrl+V shows `UTF-16 clipboard - fixed` decoded on top. Escape. Run `printf 'line one\nline two' | wl-copy; sleep 1`; Super+Ctrl+V shows it as one row `line one line two`. Escape.
  * Run `printf 'file:///etc/hostname\n' | wl-copy --type text/uri-list; sleep 1`; Super+Ctrl+V shows a file row named `hostname`. Escape.
  * Run `img=$(find /usr/share -name '*.png' | head -1); echo "$img"; wl-copy --type image/png < "$img"; sleep 1`; Super+Ctrl+V: the first row shows a small thumbnail and `Screenshot from <Weekday HH:MM>`; the right pane shows the image large. Type `screenshot`: the image row remains. Escape twice.
  * Unhappy path (sensitive): run `printf visible-one | wl-copy; sleep 1; printf secret-pw-123 | wl-copy --sensitive; sleep 1`. Super+Ctrl+V: `visible-one` is listed; `secret-pw-123` is NOT listed anywhere. Type `secret` → `No matches for “secret”`. Escape twice. Press Ctrl+Shift+V in the terminal (whatever pastes), then Super+Ctrl+V again: the secret is still absent. Escape.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Wait a second after each copy; the watcher is asynchronous. If the echoed png path is empty, use `find / -name '*.png' 2>/dev/null | head -1`. If the URI copy is not shown as a file, open Nautilus (Super+Shift+F), select a file and press Ctrl+C instead. The sensitive marker is the `x-kde-passwordManagerHint` mime type the capture script checks.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: the deduped order; the decoded UTF-16 row; the collapsed multi-line row; the `hostname` file row; the image row with thumbnail and preview and the `screenshot` filter result; the picker listing `visible-one` but never `secret-pw-123`, the `No matches` for `secret`, and the picker still without it after the paste
  * If unsuccessful
  ** Duplicate rows, mojibake, a missing file or screenshot row, a blank preview, or the secret in the list; `pgrep -af 'wl-paste.*--watch'`
covers: shell/plugins/clipboard/capture.sh (dedup, UTF-16, uri-list, emit_image, sensitive guard); shell/plugins/clipboard/ClipboardHistory.js (imagePreviewText, displayRows previewImage); shell/plugins/clipboard/Clipboard.qml (Image delegates); test/shell.d/clipboard-test.sh (capture.sh rules, display rows, "ignores sensitive"); manual/08-unified-clipboard-history.md
merged-from: 51:clipboard-history-capture-rules; 31:clipboard-sensitive-copy-not-recorded; 31:clipboard-picker-image-entry

### clipboard-watchers-survive-shell-restart   [VM-OK]
description: Exactly two clipboard watchers (text and image) run under the shell, are reaped and restarted with it on `omarchy restart shell` and after a hard kill so none leak, and capture keeps working afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `pgrep -fa 'wl-paste .*--watch' | sed 's/^[0-9]* //'` → exactly two lines, one `--type text` and one `--type image/png`.
  * Run `omarchy restart shell` and wait for the bar to return (screenshot every 5 s).
  * Run `pgrep -fa 'wl-paste .*--watch' | wc -l` → still `2` (old watchers reaped, new ones started).
  * Run `printf 'after restart' | wl-copy; sleep 1` and press Super+Ctrl+V: `after restart` is on top. Escape.
  * Run `kill -9 $(pgrep -x quickshell); sleep 4; pgrep -fa 'wl-paste .*--watch' | wc -l` → `2` again after the supervisor relaunch (the watchers died with the shell via pdeathsig and were restarted).
  ** The bar vanishes for a moment during both restarts; that is expected.
  * Unhappy path: a count of 3 or more is a leaked watcher — paste the `pgrep -fa` list into the report; 0 or 1 means capture is dead.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar does not return within ~15 s after the hard kill, run `omarchy restart shell` and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two watchers before, after `restart shell`, and after the hard kill; `after restart` captured on top
  * If unsuccessful
  ** A watcher count ≠ 2 with the process list; `./client get-serial`
covers: shell/plugins/clipboard/Clipboard.qml (setpriv pdeathsig watchers, reaper pattern, respawn); test/shell.d/clipboard-test.sh
merged-from: 51:clipboard-watchers-survive-shell-restart

### universal-clipboard-super-c-v-terminal-and-gui   [VM-OK]
description: Super+C / Super+V copy and paste both in the terminal (translated to Ctrl+Insert / Shift+Insert, so Super+C never interrupts a running program) and in a GUI field (Ctrl+C / Ctrl+V), Super+X cuts in the GUI, the clipboard history picks an older entry back onto the clipboard, and pasting an image into the terminal does nothing harmful.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, run `echo unified-clipboard-42`. Double-click the printed word to select it and press Super+C. Type `echo ` then Super+V, Enter: `unified-clipboard-42` prints again.
  * Run `sleep 30`, then press Super+C: the sleep keeps running (no `^C`, no prompt). Press Ctrl+C: the prompt returns.
  * Press Super+Shift+Enter (Chromium), click the address bar, type `hello-omarchy`, press Ctrl+A then Super+C. Press Super+Left to the terminal, type `echo ` then Super+V, Enter: `hello-omarchy` prints.
  * Back in the address bar: Ctrl+A then Super+X: the field empties. Super+V in the address bar: the text is back; Escape.
  * Press Super+Ctrl+V: the clipboard history lists `hello-omarchy` and `unified-clipboard-42`; arrow to `unified-clipboard-42` and press Shift+Return (copy only). Click the terminal, type `echo ` then Super+V, Enter: `unified-clipboard-42` prints. Press Super+Ctrl+V then Escape: the panel closes.
  * Unhappy path: run `omarchy capture screenshot fullscreen copy` (the clipboard now holds an image), then type `echo ` and Super+V, Enter: nothing meaningful is pasted and nothing crashes.
  * Close Chromium and the terminal with Super+W; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `<M-c>` `<M-v>` `<M-x>`. In the terminal these become Ctrl+Insert / Shift+Insert under the hood, so select first (double-click or `mouse drag` along the line), then Super+C. Click **Wait** on a Chromium "not responding" dialog.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the pasted word; the sleep surviving Super+C; the GUI text pasted into the terminal; the emptied address bar after Super+X and restored after Super+V; the history panel with both entries and the older entry pasted; the harmless image paste
  * If unsuccessful
  ** Screenshot of the prompt unchanged after Super+V, `^C` after Super+C, or an empty history panel
covers: default/hypr/bindings/clipboard.lua; default/hypr/apps/terminals.lua; default/hypr/apps/omarchy-shell.lua:10; config/foot/foot.ini:18-20; test/shell.d/hyprland-default-config-test.sh:108-120; manual/03:25; manual/07:129-138; manual/08:8-12
merged-from: 10:universal-clipboard-terminal-and-gui; 40:hypr-universal-clipboard

### emoji-picker-search-inserts-and-cancels   [VM-OK]
description: Super+Ctrl+E (and Trigger → Emoji) opens the emoji picker over the focused window; typing filters, arrows move the highlight in two dimensions, Return or a mouse click inserts the emoji into that window through a transient clipboard that leaves the real clipboard and its history untouched (manual says "copies to the clipboard" — 03-INTENDED-BEHAVIOUR item 16: CODE-INTENDED, the manual is stale), a miss shows the empty state, and Escape or a scrim click cancels without inserting.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, run `printf marker | wl-copy; sleep 1`, then type `echo ` (trailing space, no Enter). Press Super+Ctrl+E: within 15 s a card `Search emojis…` with a grid of emoji cells; the first cell is highlighted.
  * Type `thumbs`: the grid narrows to thumbs-up/down variants. Press Enter: the picker closes and 👍 appears after `echo `. Press Enter in the terminal: the emoji is echoed back.
  ** A box glyph still counts if the echoed line contains a non-ASCII character.
  * Run `wl-paste` → `marker` (the clipboard is unchanged). Press Super+Ctrl+V: `marker` is the top entry and the emoji is NOT listed anywhere in the history. Escape.
  * Type `echo ` again and press Super+Ctrl+E; press Right three times, Down twice, Left once: the highlight moves one cell per Right/Left and one row per Down. Move the mouse over a cell (it highlights) and click it: the picker closes and that emoji appears at the prompt. Ctrl+U.
  * Press Super+Ctrl+E, type `rocket`, then Escape: the picker closes and the prompt stays empty. Press Super+Ctrl+E, type `qqqq`: `No matches for “qqqq”`; press Escape once: the grid returns; Escape again: closed, nothing inserted.
  * Press Super+Ctrl+E, then click the dark scrim outside the card: closed, nothing inserted. Press Super+Ctrl+E twice: it opens, then closes (the hotkey toggles). Press Super+Space → Trigger → Emoji: the same picker opens; Escape.
  * Unhappy path: with the picker open type `zzzzqq` (no results) and press Enter: nothing is inserted and the picker stays or closes cleanly — no crash. Escape.
  * Close the terminal with Super+W; the desktop is as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+E is `<M-C-e>`. The insert is a Shift+Insert paste of a transient clipboard, so the terminal must be the focused window when the picker opens — hover it (`mouse move`) first. Cells are about 44 px; ./client-with-image after each arrow shows the highlighted cell. The overlay opens without animation.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the full grid; the `thumbs` grid; the terminal with 👍 typed and echoed; the clipboard picker without the emoji; the highlight after the arrow sequence; the terminal with the clicked emoji; the prompt unchanged after Escape and after the scrim click; the `No matches` state; the picker from the menu
  * If unsuccessful
  ** Screenshot showing nothing inserted (note whether the terminal lost focus), the emoji in history, the highlight not moving, or a cancel path inserting something
covers: shell/plugins/emojis/Emojis.qml (setFilter, applySelected, select, selectRow, MouseArea, dismiss, empty-state Column); shell/plugins/emojis/EmojiSearch.js; bin/omarchy-menu-emoji; bin/omarchy-menu-emoji-insert; default/hypr/bindings/utilities.lua:3; default/hypr/apps/omarchy-shell.lua:10; default/omarchy/omarchy-menu.jsonc trigger.emoji; test/shell.d/emojis-test.sh; test/acceptance.d/shell-surfaces-test.sh:24-32; manual/07:77-78,338
merged-from: 31:emoji-picker-search-and-insert; 10:emoji-picker-inserts-into-terminal; 50:emoji-picker-search-inserts-into-terminal; 51:emoji-insert-transient; 31:emoji-picker-navigate-mouse-and-cancel; 40:hypr-emoji-picker-and-compose-key; 22:menu-emoji-picker-inserts

### polkit-dialog-accepts-rejects-and-cancels   [VM-OK]
description: A privileged request raises the shell's graphical polkit dialog with the shortened label `Authorize running '/usr/bin/true'` and no fingerprint wording; the account password lets the command run (exit 0), a wrong password is visibly rejected (red `Wrong`, a shake, the field cleared) and the same request then accepts the right one, and Escape cancels so the caller fails with exit 126 instead of hanging. `pkexec true` is the deterministic trigger: the network panel's DNS pills run passwordless since 4.0.2 and no longer raise this dialog.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `pkexec /usr/bin/true; echo "exit=$?"`: the screen dims and a one-line card appears in the centre — a lock glyph and a masked field with placeholder `Enter password`; a small pill above it reads `Authorize running '/usr/bin/true'`. No `Swipe your finger` wording appears (the VM has no reader).
  * Click on the dimmed background away from the card: the dialog stays (the scrim only refocuses the field).
  * Type `wrongpass` and press Enter: after a moment the card shakes, the lock and text turn red and the placeholder reads `Wrong` for about a second; the field is empty and still focused. The terminal has not printed `exit=` yet.
  * Type `prime` and press Enter: the placeholder briefly reads `Checking...` and the dialog closes; the terminal shows `exit=0`.
  * Run `pkexec /usr/bin/true; echo "exit=$?"` again and press Escape when the dialog appears: it closes within half a second and the terminal prints an authorization error (e.g. `Not authorized` / `Request dismissed`) and `exit=126`. Run it once more and press Escape again: same result, no leftover scrim.
  * Unhappy path: a wrong password yielding `exit=0`, a dialog that will not close on Escape, or a terminal that hangs after Escape must be reported as critical.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog is a small centred Quickshell window that holds keyboard focus exclusively; no click is needed before typing. Screenshot right after each Enter to catch `Wrong` (shown 1.2 s) and `Checking...`.
  * Stay under ~5 wrong tries per test: faillock (`deny=10`, 120 s) is shared with the lock screen and sudo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the dialog with the exact `Authorize running '/usr/bin/true'` pill and dots in the field; the dialog unmoved after the scrim click; the red `Wrong` state; the terminal with `exit=0` after the retry; the error text and `exit=126` twice; the clean desktop
  * If unsuccessful
  ** Screenshot of the raw `Authentication is needed to run …` message, a fingerprint prompt, the dialog accepting the wrong password or closing without a retry, or a pkexec error in the terminal (`No session for cookie` or similar); `./client get-serial`; `omarchy-version`
covers: shell/plugins/polkit/PolkitAgent.qml (beginFlow, submitResponse, justification pill, scrim MouseArea, triggerFailureFeedback, errorFlash, shakeAnimation, cancelRequest, closeTimer); shell/plugins/polkit/PolkitModel.js (authorizationLabel); etc/sudoers.d/omarchy-dns (why the DNS pills do not trigger it); test/shell.d/polkit-test.sh; manual/37-hardware-authentication.md
merged-from: 31:polkit-prompt-accepts-password; 31:polkit-rejects-wrong-password; 31:polkit-cancel-with-escape; 52:polkit-prompt-labels-pkexec

### clock-format-ring-bar-set-and-timezone   [VM-OK]
description: Right-clicking the bar clock walks a fixed ring of ten label formats (12-hour, ticking seconds, short date, ISO week, ISO date …) that persists to `shell.json` and wraps back to the start, `omarchy bar set omarchy.clock format …` sets a format live and refuses an unknown widget, middle-click opens the timezone picker that cancels cleanly, and Update → Timezone changes the zone without a password, confirms with a notification and moves the clock; left click stays the calendar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Hover the clock label: tooltip `Right-click to toggle format`. Open a terminal with Super+Enter and run `timedatectl show -p Timezone --value; date` — note the zone (ORIGINAL); the clock reads like `Friday 13:12` and matches `date` to the minute. Run `jq -r '.bar.layout.center[] | select((.id // .) == "omarchy.clock") | .format' ~/.config/omarchy/shell.json` → `dddd HH:mm` (or no file on a fresh disk).
  * Right-click the clock: the 12-hour twin (`Friday 1:12 PM`); re-run the jq → `dddd h:mm AP`. Right-click again: seconds appear and tick (two screenshots 2 s apart differ); jq → `dddd HH:mm:ss`.
  * Right-click seven more times, screenshotting each: `dddd h:mm:ss AP`, `HH:mm`, `h:mm AP`, `ddd d MMM HH:mm`, `ddd d MMM h:mm AP`, `d MMMM 'W'ww yyyy` (e.g. `18 September W38 2026`, day without a leading zero), `yyyy-MM-dd HH:mm`. Right-click once more: back to `dddd HH:mm` — the ring wrapped and the label matches the first screenshot exactly.
  ** The bar re-centres as the label width changes; that is expected. Wait a second after each right-click so the label has redrawn.
  * Run `omarchy bar set omarchy.clock format "yyyy-MM-dd HH:mm"` → `Set format on omarchy.clock`; the clock shows the ISO date and time within two seconds. Run `omarchy bar set omarchy.clock format "dddd h:mm AP"` → `Friday 1:07 PM`-style. Run `omarchy bar set omarchy.clock format ""; echo "exit=$?"` and record the behaviour (error or unchanged clock).
  * Unhappy path: run `omarchy bar set omarchy.nope format "HH:mm"; echo "exit=$?"` → the command fails and the clock is unchanged.
  * Middle-click the clock: the menu opens as a timezone picker (rows like `Europe/Copenhagen`). Press Escape until closed, choosing nothing: the clock time did not change zone.
  * Press Super+Space → Update → Timezone; type `Tokyo` and press Enter on `Asia/Tokyo`: NO password prompt (passwordless since 4.0.2), a notification `Timezone is now set to Asia/Tokyo`, and the clock jumps to Tokyo time. Open the picker again and press Escape: the clock stays on Tokyo time. Open the picker, type the ORIGINAL zone and press Enter: the notification and the clock are back to the original time (`date` agrees).
  * Left-click the clock: the calendar opens; left-click again: closed. Press Super+Ctrl+Alt+D twice: it toggles the same way.
  * Round trip: run `rm -f ~/.config/omarchy/shell.json`: the clock returns to `<Weekday> HH:MM`; `timedatectl show -p Timezone --value` prints ORIGINAL. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `./client mouse click --button right|middle` on the clock text at x≈0.5, y≈0.01; check the position first. Count clicks — the ring has ten entries. The timezone picker filters fuzzily as you type; the highlighted row is what Enter selects. Do not select a zone from the middle-click picker; if it is a terminal list, Escape or Ctrl+C cancels.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the tooltip; all ten formats in order with the matching `jq` values, including the ticking seconds pair and the `W38` week label; the final label equal to the first; the ISO and 12-hour formats after `bar set`; the empty-format result; the failure line for `omarchy.nope` with the clock unchanged; the timezone picker open and the unchanged clock after cancel; the Tokyo notification with the changed clock, the Escape no-op, the restored clock; the calendar by click and hotkey; the clock back to `<Weekday> HH:MM` and the original zone
  * If unsuccessful
  ** Screenshot of a format out of order, a value not saved, a frozen seconds label, a password/polkit prompt on the timezone change, a clock that does not update, or a missing notification; `./client get-serial`
covers: shell/plugins/panels/clock/BarWidget.qml:159-160 (cycleFormat, onPressed, formatted, showsSeconds); shell/plugins/panels/clock/Model.js (CLOCK_FORMATS, clockFormatRing, nextClockFormat, clockNeedsSeconds, isoWeekLiteral); bin/omarchy-bar cmd_set; shell/shell.qml (setBarWidget, updateEntryInline); shell/plugins/bar/BarModel.inlineSettingsDelta; bin/omarchy-menu-timezone; etc/sudoers.d/omarchy-tzupdate; default/omarchy/omarchy-menu.jsonc (update.timezone); default/hypr/bindings/utilities.lua:101; config/omarchy/shell.json (clock); test/shell.d/clock-test.sh (format ring, seconds tick, persistence, click routing, SUPER+CTRL+ALT+D); test/shell.d/config-test.sh (clock formatAlt); manual/05:21,46,57,59; manual/46:21-27
merged-from: 51:clock-right-click-format-ring; 31:clock-format-cycle-right-click; 30:clock-label-format-and-timezone-clicks; 13:faq-clock-format-cycle-and-set; 10:bar-clock-calendar-format-timezone; 41:timezone-picker-updates-clock

### bar-cli-position-transparent-set-move-and-rejections   [VM-OK]
description: `omarchy bar` edits the live bar from the terminal — position to any screen edge (a vertical clock on the left), transparency toggle, per-widget settings such as a seconds clock, moving a widget between sections, putting a spacer — each visible at once and persisted, while a bad edge, bad section, missing setting key, unknown widget or bar, conflicting move syntax and malformed JSON are refused without touching `shell.json`; `defaults` restores the shipped layout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy bar position bottom; jq .bar.position ~/.config/omarchy/shell.json` → `Bar position set to bottom`, `"bottom"`; the bar is along the bottom edge and the terminal re-tiled to the top (allow 20 s).
  ** This first command creates `~/.config/omarchy/shell.json`, canonical from now on; the tiled terminal moves each time the bar moves.
  * Run `omarchy bar position left`: the bar is a narrow vertical strip on the left with the clock stacked `HH` `—` `mm` and the workspaces at the top. Run `omarchy bar position top`: back on top.
  * Run `omarchy bar transparent toggle; jq .bar.transparent ~/.config/omarchy/shell.json` → the bar background is see-through, `true`; repeat → opaque, `false`.
  * Run `omarchy-bar set omarchy.clock format "HH:mm:ss"` → `Set format on omarchy.clock`; the clock shows seconds ticking. Run `omarchy-bar move omarchy.clock left` → `Moved omarchy.clock`; the clock sits in the left section after the workspaces. Run `omarchy-bar move omarchy.clock --section center --index 0` → clock back in the centre, first.
  * Run `omarchy-bar put omarchy.spacer --section right --index 0` → `omarchy.spacer is on the bar` (an invisible 12 px gap appears before the right widgets); `jq '.bar.layout.right[0]' ~/.config/omarchy/shell.json` → the spacer. Run `omarchy bar put omarchy.keyboard-layout --after omarchy.clock` → `omarchy.keyboard-layout is on the bar` (the pill stays hidden while only one layout is configured; record it if it shows).
  * Unhappy path — first `cp ~/.config/omarchy/shell.json /tmp/shell.before`, then each with `; echo "exit=$?"`: `omarchy bar position sideways` → `position must be top, bottom, left, or right`, non-zero, bar unmoved; `omarchy-bar move omarchy.clock nowhere` → `section must be left, center, or right`, `exit=1`; `omarchy-bar set omarchy.clock` → `set requires a setting key`, `exit=1`; `omarchy-bar put nosuch.widget` → `nosuch.widget is not a known widget; run 'omarchy plugin list'`, `exit=1`; `omarchy bar use local.nonexistent-bar` → non-zero naming the unknown bar; `omarchy bar move omarchy.clock left --section right` → non-zero (positional and `--section` together); `omarchy bar set omarchy.bluetooth broken '{' --json` → non-zero (malformed JSON); `omarchy bar set omarchy.bluetooth broken 'false null' --json` → non-zero (two values). Then `cmp /tmp/shell.before ~/.config/omarchy/shell.json && echo unchanged; rm /tmp/shell.before` → `unchanged` and the bar looks as it did.
  * Run `omarchy bar defaults` → `Restored the default Omarchy bar`: clock format back to weekday + HH:mm, spacer and keyboard-layout entry gone, top edge, opaque. Run `jq -c '.bar.layout.right | map(.id // .)' ~/.config/omarchy/shell.json; omarchy installed service tailscale; echo t=$?; omarchy installed service dropbox; echo d=$?` → the right section starts `omarchy.tray` then `omarchy.agents` with no `omarchy.tailscale`/`omarchy.dropbox`, `t=1`, `d=1` (widgets for services that are not installed are left out of the defaults).
  * Round trip: `rm ~/.config/omarchy/shell.json` — the bar is unchanged (shipped defaults are top) and the disk is as found. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy bar` and `omarchy-bar` are the same program; each command changes the bar within a second — wait 2 s before the screenshot. Keep the single quotes around `'{'` and `'false null'` exactly.
  * On the 4.0.2 disk `omarchy bar put`/`transparent`/`use` may be missing; report `Unknown Omarchy command` as a version gap and continue.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar at bottom with `"bottom"`, at left with the vertical clock, back on top; transparent then opaque with the jq values; the seconds clock; the clock in the left section and back in the centre; the shell.json spacer entry; the eight refusals with their messages and `unchanged`; the restored bar with the jq/status values; the bar unchanged after the file is removed
  * If unsuccessful
  ** Screenshot of the bar in the wrong place, a refusal exiting 0 or a changed shell.json (`diff /tmp/shell.before ~/.config/omarchy/shell.json`), `jq .bar.layout ~/.config/omarchy/shell.json` and the bar screenshot that disagrees; `omarchy-version`
covers: bin/omarchy-bar (cmd_position, transparent, cmd_set, cmd_move, cmd_put, use, cmd_defaults); shell/plugins/bar/Bar.qml (applyBarConfig, normalizePosition, verticalBar); shell/plugins/panels/clock/BarWidget.qml verticalFormat; bin/omarchy-plugin-catalog; bin/omarchy-installed-service-*; config/omarchy/shell.json; test/shell.d/config-test.sh (move/position/transparent/defaults, optional service widgets, bar use/move/set rejections); test/shell.d/bar-test.sh (put through a ready shell); test/shell.d/installed-service-test.sh; test/shell.d/keyboard-layout-test.sh (label); manual/05-the-top-bar.md
merged-from: 30:bar-position-cli-and-rejects-invalid; 51:bar-cli-layout-commands; 51:bar-cli-rejects-bad-input; 25:bar-set-clock-format-move-put-defaults

### plugin-validate-rejects-bad-manifests   [VM-OK]
description: `omarchy plugin validate` refuses every manifest shape the shell would reject — invalid JSON, wrong schemaVersion type, missing required field, the reserved `omarchy.*` namespace, a missing or absolute or `..` entry-point file, a kind without its entry point, an empty kinds array, a bad default section, a symlink inside the folder, a missing folder — each with a one-line reason and exit 1, accepts a correct plugin silently, and `omarchy plugin add` refuses to install a failing one (and a git-helper URL, without touching the network) leaving nothing behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin validate --help` → the usage paragraph lists the checks, exit 0. Define the helper: `mk(){ mkdir -p /tmp/pv/$1; printf '%s\n' "$2" > /tmp/pv/$1/manifest.json; touch /tmp/pv/$1/W.qml; }`.
  * Build the cases, one line each:
    `mk good '{"schemaVersion":1,"id":"t.good","name":"G","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"},"barWidget":{"defaultSection":"right"}}'`
    `mk badjson '{oops'`
    `mk badschema '{"schemaVersion":"1","id":"t.s","name":"S","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk noname '{"schemaVersion":1,"id":"t.m","kinds":["service"],"entryPoints":{"service":"W.qml"}}'`
    `mk reserved '{"schemaVersion":1,"id":"omarchy.evil","name":"E","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk nofile '{"schemaVersion":1,"id":"t.n","name":"N","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"Nope.qml"}}'`
    `mk nokind '{"schemaVersion":1,"id":"t.k","name":"K","version":"1","kinds":["bar-widget","panel"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk wrongkind '{"schemaVersion":1,"id":"t.w","name":"W","version":"1","kinds":["bar-widget"],"entryPoints":{"service":"W.qml"}}'`
    `mk abspath '{"schemaVersion":1,"id":"t.a","name":"A","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"/etc/passwd"}}'`
    `mk dotdot '{"schemaVersion":1,"id":"t.d","name":"D","version":"1","kinds":["service"],"entryPoints":{"service":"../W.qml"}}'`
    `mk nokinds '{"schemaVersion":1,"id":"t.e","name":"E","version":"1","kinds":[],"entryPoints":{}}'`
    `mk badsection '{"schemaVersion":1,"id":"t.b","name":"B","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"},"barWidget":{"defaultSection":"bottom"}}'`
    `mk symlink '{"schemaVersion":1,"id":"t.l","name":"L","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'; ln -s /etc/passwd /tmp/pv/symlink/link`
  * Run `for d in good badjson badschema noname reserved nofile nokind wrongkind abspath dotdot nokinds badsection symlink missing; do echo "== $d"; omarchy-plugin-validate /tmp/pv/$d; echo "exit=$?"; done 2>&1 | sudo tee /dev/ttyS0` (password `prime`) and read the serial log.
  ** `good` → no message, `exit=0`. Every other case `exit=1` with, respectively: `manifest.json is not valid JSON`; `unsupported or missing schemaVersion (expected 1)`; `manifest missing required field 'name'`; `plugin id 'omarchy.evil' uses the reserved omarchy.* namespace`; `entry point file not found: 'Nope.qml'`; `kind 'panel' requires an 'entryPoints.panel' to load`; `kind 'bar-widget' requires an 'entryPoints.barWidget' to load`; `entry point must be a relative path: '/etc/passwd'`; `entry point may not contain '..'`; `'kinds' must be a non-empty array`; `'barWidget.defaultSection' must be left, center, or right`; `symlinks are not allowed inside a plugin folder: /tmp/pv/symlink/link`; `plugin folder not found: /tmp/pv/missing`.
  * Fix one in place to prove the messages track the folder: `rm /tmp/pv/symlink/link && omarchy-plugin-validate /tmp/pv/symlink; echo "exit=$?"` → silent, `exit=0`.
  * `plugin add` honours the same rules: `cd /tmp/pv/nofile && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm x && cd ~ && omarchy-plugin-add /tmp/pv/nofile --yes; echo "exit=$?"` → the `entry point file not found` line, then `omarchy-plugin-add: refusing to add: validation failed`, `exit=1`; `ls -a ~/.config/omarchy/plugins/` has no `t.n` and no `.add.tmp.*`.
  * Unhappy path (URL guard, offline): `omarchy plugin add 'ext::sh -c id' --yes; echo "exit=$?"` → instantly `… names a git option or transport helper, not a repository.`, `exit=1` — a pause of several seconds means git ran; report it. `ls -a ~/.config/omarchy/plugins/` is unchanged.
  * Round trip: `rm -rf /tmp/pv`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The serial log is easier to read than fourteen screenshots; still screenshot the terminal. Each failure message is one line on stderr; the exit code is the assertion. On an older disk the `kind … requires` message may be absent (HEAD feature) — report the actual text and `omarchy-version`. Set `OMARCHY_PATH=/usr/share/omarchy` explicitly if the command complains about the path.
  * The local no-manifest repo stands in for cloning a real repository without a manifest (e.g. `omacom/ttfx`), so the test needs no network.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial log with the fourteen `== case` blocks, exit codes and the exact messages above; the symlink case passing after the fix; the terminal showing the refused add and the clean plugins directory; the instant `ext::` refusal
  * If unsuccessful
  ** Any broken case exiting 0, `good` exiting 1, a generic error without the named entry point, a staged directory left after the refused add, or a clone running for the helper URL; `omarchy-version`
covers: bin/omarchy-plugin-validate; bin/omarchy-plugin-add:96-128 (validate + stage cleanup); bin/omarchy-git-url-check; shell/services/PluginRegistry.qml validateManifest (mirrored rules); test/shell.d/plugin-validate-test.sh; test/shell.d/plugins-test.sh; manual/32-shell-plugins.md (Writing your own — validate)
merged-from: 32:plugin-validate-rejects-broken-manifests; 25:plugin-validate-rejects-bad-manifests; 12:plugin-validate-checks; 52:plugin-validate-manifest-contract; 60:plugin-add-rejects-invalid-repo-and-url

### notification-icon-slot-image-themed-glyph   [VM-OK]
description: The toast icon slot shows an image hint, falls back to a themed app icon and then to a glyph (large beside a body, compact before a title-only toast), and a missing themed icon collapses the slot instead of showing a broken placeholder.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-notification-send -u critical --image "$OMARCHY_PATH/applications/icons/Docker.png" "With image" "Docker logo on the left"`: the card shows the whale image in a ~40 px slot left of the text.
  ** If that file is missing on this disk use `~/.local/state/omarchy/current/background` (the wallpaper) instead.
  * Run `omarchy-notification-send -u critical -i dialog-information "Themed icon" "From the icon theme"`: an information icon in the slot.
  * Run `omarchy-notification-send -u critical -g "K" "Glyph fallback" "Letter K as glyph"`: a large `K` in the slot.
  * Run `omarchy-notification-send -u critical -g "K" "Compact glyph"`: a single-line card with a small `K` right before the title.
  * Unhappy path: run `omarchy-notification-send -u critical -i no-such-icon-name-xyz "Missing icon" "Slot must collapse"`: text only — no pink or broken square and no empty gap where the icon would be.
  * Press Super+Shift+comma: all cards gone. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Critical urgency keeps the cards up for screenshots; Nerd-Font glyphs cannot be typed by the driver, so an ASCII letter stands in for `-g`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the five cards: image, themed icon, large glyph, compact glyph, collapsed slot; the clean screen after dismiss-all
  * If unsuccessful
  ** Screenshot of a broken-image placeholder, an empty gap, or a card without its image
covers: shell/plugins/notifications/components/NotificationCard.qml (smallIconSource, iconSource, compactGlyph, slot visibility); shell/plugins/notifications/NotificationLogic.js (shouldRenderCompactGlyph, glyphFromHints); bin/omarchy-notification-send -g/-i/--image
merged-from: 30:notification-icon-image-and-glyph

### dev-gallery-controls-walk-and-dropdowns   [VM-OK]
description: The shell's dev gallery opens as a floating window with every shared control; the standard panel keys walk its sections, adjust the slider, flip a toggle and show a tooltip; the Dropdown picks an option by keyboard and the SearchableDropdown filters as you type and shows `No matches`; Escape closes each popup without changing the value and then the gallery.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell shell summon omarchy.dev-gallery '{}'`: a window `Omarchy shell – dev gallery` opens beside the terminal with the heading `Omarchy shell · dev gallery`, a Conventions box, a Typography scale and component sections below.
  * Press j eight times: the highlight walks the CursorSurface rows, the Button row, ButtonGroup, PanelActionButton, PanelToolTip, Slider …, scrolling the window as it goes. With the Slider section highlighted press l three times: the % at the right rises by 15.
  * Press j until the `Toggle` section highlights and press Enter: the `Transparent bar` switch flips; press Enter again: it flips back. Move the mouse over the `hover me` swatch in the PanelToolTip section: the tooltip `Styled tooltip — drop into any panel` appears. Press Escape: the gallery closes.
  * Run `omarchy-shell shell summon omarchy.dev-gallery '{"section":"dropdown"}'`: the gallery opens scrolled to the Dropdown section (`Center anchor` showing omarchy.clock) with it highlighted. Press Enter: a popup lists omarchy.clock / omarchy.weather / omarchy.power. Press j, then Enter: the trigger shows `omarchy.weather`. Press Enter again, then Escape: the popup closes and the trigger still shows `omarchy.weather`.
  * Press j (SearchableDropdown `Add widget`) and Enter: a popup with a `Search widgets...` field. Type `wea` → only `Weather` with its description remains. Press Down, Enter: the trigger shows `Weather`.
  * Unhappy path: press Enter, type `zzz` → `No matches`. Press Escape: the popup closes, the trigger still shows `Weather`.
  * Click the `Center anchor` trigger with the mouse and click `omarchy.clock` in the popup: it returns to omarchy.clock. Press Escape to close the gallery; close the terminal with Super+W; the bar is unchanged (the gallery's toggle is a demo, not the real setting — confirm the bar is still opaque).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the window opens small, press Super+F to fullscreen it for readability; PageDown/PageUp scroll the page. Use ./client-with-image after each j to see which section holds the highlight. While a popup or field is open, j/k/Enter and typing go to it, not the gallery cursor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The gallery header; the highlight on several sections; the slider % increased; the toggle flipped and restored; the tooltip; the Dropdown popup and the trigger showing omarchy.weather (still after Escape); the filtered `Weather` result; the `No matches` state; the trigger back on omarchy.clock after the mouse pick; the desktop after Escape
  * If unsuccessful
  ** Screenshot of the gallery failing to open (terminal error), a control not responding, a popup not opening, a value changing on Escape, or the filter not narrowing; `./client get-serial`
covers: shell/plugins/dev-gallery/GalleryPanel.qml (open payload section, dropdown / searchable-dropdown sections, keyCatcher blocked); shell/Ui/PanelKeyCatcher.qml; shell/Ui/PanelSlider.qml; shell/Ui/Toggle.qml; shell/Ui/PanelToolTip.qml; shell/Ui/Dropdown.qml; shell/Ui/SearchableDropdown.qml
merged-from: 31:dev-gallery-open-and-walk-controls; 31:dev-gallery-dropdowns-select-and-filter; 31:dev-gallery-text-and-number-fields

### agent-invitation-toast-once   [VM-PARTIAL]
description: The one-time "choose your default agent" invitation toast fires once when its hook runs, its click opens the Omarchy menu on Default Agent, it never repeats once its marker exists, and it stays silent without burning the marker when an agent is already chosen; skipped: the genuine first-boot trigger (the minted disk has already booted).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `rm -f ~/.local/state/omarchy/done/agent-setup-invitation ~/.config/omarchy/defaults/agent` (fresh state).
  * Run `bash ~/.config/omarchy/hooks/post-update.d/setup-agent.hook`: one critical toast `Set your default agent — Let your favorite agent help with Omarchy.` appears.
  ** If the hook path is missing, use `$OMARCHY_PATH/install/user/first-run/setup-agent.hook` instead.
  * Move the mouse onto the toast and click it: the Omarchy menu opens on `Default Agent…`; press Escape.
  * Run `ls ~/.local/state/omarchy/done/agent-setup-invitation`: the marker exists.
  * Run the hook again: no toast within 3 seconds (it never repeats).
  * Unhappy path (already chosen): run `rm ~/.local/state/omarchy/done/agent-setup-invitation; mkdir -p ~/.config/omarchy/defaults; echo pi > ~/.config/omarchy/defaults/agent` and the hook once more: no toast, and `ls ~/.local/state/omarchy/done/agent-setup-invitation` fails (the marker is not written while a default is set).
  * Round trip: run `rm ~/.config/omarchy/defaults/agent`; close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts appear top-right under the bar; the toast is critical, so it waits for the click. The first-run "Set your default agent" notification may already be consumed on the minted disk — the `rm` re-arms it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the one toast; the Default Agent submenu after the click; the marker present; no toast on rerun; no toast and no marker with a default set; the terminal listing
  * If unsuccessful
  ** Screenshot of a second toast, a missing marker, a marker written while a default was set, or none after re-arming
covers: install/user/first-run/setup-agent.hook; bin/omarchy-done; test/shell.d/agent-invitation-test.sh
merged-from: 51:agent-invitation-hook-once; 22:agent-invitation-notification

## Not runnable here

(none — every block that stayed in this domain is runnable at least in its hardware-absence path;
the slice's single VM-NO block, `25:touchpad-toggle-persists-across-reload`, is a Hyprland input
toggle and is listed under Moved.)

## Moved to other domains

- 24:oomd-kills-runaway-app-not-session → H — systemd-oomd / zram / app.slice policy; a system story with no bar, panel or notification behaviour under test.
- 25:screenshot-click-window-to-clipboard-and-file → C — the Print-key capture path (grim/slurp, ~/Pictures, Tensaku); C holds the other capture blocks (40:hypr-capture-print-screenshot, 50:capture-screenshot-fullscreen-save).
- 25:capture-text-ocr-to-clipboard → C — tesseract OCR capture; sibling of 40:hypr-capture-color-picker-and-ocr in C.
- 52:screenshot-fullscreen-captures-bar → C — a capture-pipeline test (`omarchy capture screenshot fullscreen save`, imv); the bar is only its subject.
- 10:xcompose-quick-emoji-and-completion → C — CapsLock compose sequences (fcitx5/~/.XCompose); C holds 12:xcompose-add-sequence-and-restart and 51:xcompose-legacy-include-repair.
- 41:xcompose-emoji-sequences → C — same compose-key story as 10:xcompose-quick-emoji-and-completion.
- 12:toggle-hotkeys-gaps-and-bar → C — primarily the window-gaps toggle (`window-no-gaps.lua`, `omarchy-hyprland-toggle` refusal); its bar-toggle step is covered by `bar-toggle-hide-and-show`; C holds 25:window-gaps-toggle.
- 40:hypr-desktop-gaps-bar-fullscreen-toggles → C — gaps, square-aspect and fullscreen-desktop Hyprland toggles; the bar step is covered by `bar-toggle-hide-and-show`; sibling of 10:window-transparency-gaps-square-fullscreen-desktop in C.
- 25:monitor-helpers-without-laptop-panel → C — `omarchy-hyprland-monitor-*` laptop/mirror/clamshell helpers and Super+Ctrl+Delete; sibling of 40:hypr-multi-monitor-chords-single-display and 20:monitor-state-report in C.
- 25:touchpad-toggle-persists-across-reload → C — VM-NO touchpad toggle (`omarchy-toggle-input-device`, disabled-input-device.lua); a Hyprland input toggle, to be listed in C's not-runnable appendix.
- 42:firstrun-force-rerun-toasts → F1 — `omarchy-provision-first-run --force` replays user provisioning; the toasts are its side effect; F1 holds the other 42 provisioning blocks.
- 42:firstrun-offline-shows-wifi-toast → F1 — first-run `wifi.sh` / `nm-online` provisioning logic; sibling of the 42 blocks in F1.
- 51:chromium-claude-extension-pkexec → F1 — the Claude browser-extension installer's idempotency and cancel semantics; F1 holds 23:install-chromium-claude-extension-seed. The polkit dialog it uses is proven by `polkit-dialog-accepts-rejects-and-cancels`.
- 11:lazydocker-polkit-prompt → F1 — the Docker TUI launch behind polkit; F1 holds 22:launch-docker-tui-polkit-gate, 40:hypr-launch-docker-tui-polkit and 41:docker-tui-polkit-prompt.
- 60:plugin-add-notification-center → F2 — installing/removing the org notification-center plugin over the network; sibling of 60:plugin-add-elsewhen-from-menu and 60:plugin-add-port-forward-error-path in F2.
- 31:dev-gallery-text-and-number-fields → A2 — the shell dev gallery's TextField/NumberField controls; A2 holds 31:dev-gallery-open-and-walk-controls and 31:dev-gallery-dropdowns-select-and-filter. *Routing-pass note:* A2 sent both of those here in the same pass; they are now the test `dev-gallery-controls-walk-and-dropdowns` above, and this block belongs with them — the orchestrator may fold it into that test rather than leave it in A2.

## Dropped

(none)

## Rerouted

- 41:oomd-app-slice-candidacy → H — the systemd-oomd 50 %/20 s policy and app.slice candidacy check (from F2, "configuration half of D's 24:oomd"); its runtime half `24:oomd-kills-runaway-app-not-session` was already moved from this file to H above, so the two belong together in H, not in the bar/panels/notifications domain.
