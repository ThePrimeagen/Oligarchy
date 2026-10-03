# C — Hyprland windows, workspaces, config, input and capture — final tests

This domain covers every Hyprland keybinding as a user story (close/float/pseudo/fullscreen/pop/width
memory, focus/swap/cycle, the twelve resize chords, workspaces 1–10 and the scratchpad, Tab/scroll
navigation, groups, monitor scaling, zoom), the per-app window rules, the workspace-layout and desktop
style toggles, Hyprland user-config editing and reload behaviour (bindings.lua overrides, syntax-error
banner and menu restore, monitors.lua bogus-mode fallback, TTY recovery, the package reload guard,
input.lua and looknfeel.lua overrides, hyprsunset.conf), input (both-Alts layout switch, CapsLock
compose, ~/.XCompose) and the capture chords (Print picker with its keyboard binds, Alt+Print recording,
Super+Print colour, Super+Ctrl+Print OCR, QR). 134 source blocks plus 15 routed in from A1, D, G1 and
G2 → 48 tests (42 VM-OK of which 1 NET, 6 VM-PARTIAL) plus 3 not-runnable appendix entries; 25 blocks
were moved to the domains that hold their sibling stories (crash-capture toggle → D, fingerprint/tmux
layouts/zram/xdg/printing/input-group → H, Obsidian/mailto/imv → F2, tmux cheatsheet → B, agent chord →
F1, tab completion → G2, plugin list → D, restart helpers → E, Try-Omarchy → I); nothing was dropped or
rerouted. Of the 15 incoming blocks 11 folded into existing tests (three compose-key blocks into the
XCompose story, two gaps/bar toggle blocks into the style-toggles story, two capture-CLI blocks, the
click-snap screenshot, the OCR CLI, the monitor helpers, the invalid-mode fallback), 2 became new tests
(a user `autostart.lua` entry running on login; the `omarchy_preinstalled_bindings` flag) and 2 are
VM-NO appendix entries (real laptop mirror/clamshell/brightness; real touchpad toggle). Notable merges: six monitor-scaling blocks
(hotkey, CLI, Display-panel pills) became one test; five capture-picker blocks became one Print story;
five style-toggle blocks (transparency, gaps, square aspect, fullscreen desktop and their CLI negatives)
became one; four screen-recording blocks became one start/stop story with the runtime state file and
Stop row folded in; the two TTY-recovery stories (disabled output, default bindings off) became one;
the two hyprsunset blocks became one because the config edit and the process restart are the same
restart. `03-INTENDED-BEHAVIOUR.md` settles the disagreements this domain hits and the proofs assert
its side: item 19 — the Setup/Style menu entries open the editor and Hyprland reloads the saved user file
by itself (`misc.disable_autoreload` is off), so a change must apply within 15 s with no further command
and the tests never demand `hyprctl reload` after a menu edit; only Hyprsunset and XCompose need, and
get, an explicit restart. Item 20 — the shipped `monitors.lua` has `omarchy_monitor_scale = "auto"` with
`omarchy_gdk_scale = 2` (the manual's "2x" is the GDK default). Item 21 — `Update → Config → Hyprland`
rewrites all seven files and leaves a `.bak.<epoch>` only for the ones that differed. Item 17 —
`Super+Shift+B` is a real browser chord (used as the unbind subject). One disagreement is not in the
verdict list and follows the code: the shipped key-repeat default is 40/250 while the manual quotes
Hyprland's stock 25/600; the description says so. Every driver quirk from
01-FACTS that a story hits is named once in that test: Print/CapsLock/`<A-alt_r>`/punctuation chords are
sendable, XF86 keys are fired in-guest with `wtype -k`, pop is clamped to the 1280×800 screen, the
scratchpad is a 770×385 box, Chromium may raise the "not responding" dialog (click Wait), HEAD chords
may be absent on the 4.0.2 mint (check the Super+K row, report "absent on this build").

## Tests

### window-close-and-close-all   [VM-OK]
description: Super+W or Super+Q closes the focused window and Ctrl+Alt+Delete closes every window on every workspace and lands on workspace 1; all three are harmless on an empty desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+W, Super+Q and Ctrl+Alt+Delete on the empty desktop: nothing may change (bar stays, no dialog, no text console).
  * Press Super+Return twice; two terminals tile side by side, the right one focused. Press Super+W: it closes and the left one fills the screen. Press Super+Return again and Super+Q: the focused one closes.
  * Press Super+2, Super+Return, Super+Shift+Return (Chromium), then Super+3, Super+Return and Super+Ctrl+T (a floating btop). In that terminal type `hyprctl clients -j | jq length` and press Return → 5.
  ** If Chromium shows an "application not responding" dialog, click Wait. Chromium takes 10–20 s to appear on 2 vCPU; wait for it before the close-all.
  * Press Ctrl+Alt+Delete. Within a few seconds every window is gone (browser and floating btop included) and the bar shows workspace 1 active with no other occupied workspace; Super+2 and Super+3 show empty workspaces.
  ** If the browser shows a "close tabs?" dialog it may survive the polite close request — report it. Chromium may offer to restore pages next time; that is fine.
  * Press Super+1, Super+Return and type `hyprctl clients -j | jq length; hyprctl activeworkspace -j | jq .id` Return → 1 and 1. Then type `omarchy-hyprland-window-close-all` Return: the terminal closes itself; the desktop is empty, still on workspace 1.
  * Press Super+K, type `Close window`: one merged row `SUPER + W / SUPER + Q → Close window`. Press Escape.
  * The desktop must be as you found it: empty, workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+Alt+Delete is `<C-A-DEL>` — a Hyprland bind here, not a VT switch or reboot; a text console means the wrong key was sent.
  * The bar's workspace indicators sit right of the Omarchy logo; only occupied workspaces are listed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: the empty desktop unchanged after the three chords; one terminal left after Super+W and after Super+Q; windows across workspaces 1–3 with the jq count 5; empty workspace 1 right after Ctrl+Alt+Delete with the bar indicators cleared; the `1` / `1` jq lines; the merged Super+K row
  * If unsuccessful
  ** Screenshot of a window that survived (with `hyprctl clients -j | jq '.[].class'` listing survivors), of a text console, or of a crash dialog
covers: default/hypr/bindings/tiling.lua:1-3; bin/omarchy-hyprland-window-close-all; bin/omarchy-menu-keybindings (alternative_chord_actions); test/shell.d/hyprland-window-close-all-test.sh; manual/04:25; manual/07:13-14
merged-from: 40:hypr-window-close-and-close-all; 10:close-all-windows-ctrl-alt-del; 25:window-close-all; 51:close-all-windows

### window-float-pseudo-split   [VM-OK]
description: Super+T floats and re-tiles the focused window, Super+P makes a tile pseudo (natural size in its slot) and Super+J flips the dwindle split between side-by-side and stacked — the three shape chords from the navigation manual, harmless on a lone window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice: two terminals side by side.
  * Press Super+J: they stack top/bottom. Press Super+J again: side by side.
  * Press Super+T: the focused (right) terminal becomes a smaller floating window drawn over the other, which expands underneath. Press Super+T again: it tiles back beside the other.
  * Press Super+P: the focused terminal shrinks toward its natural size inside its slot with wallpaper showing around it while the other terminal keeps its width. Press Super+P again: it fills its slot.
  * Close one terminal (Super+W) and press Super+J and Super+P on the lone window: no visible change, no error.
  * Close the last terminal; the desktop is empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `dwindle.force_split = 2` puts new windows right/below, so the newer terminal is the one on the right or bottom.
  * Screenshot a second after each chord; the popin animation is ~0.3 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of side-by-side, stacked, side-by-side; the floating terminal over the expanded one and tiled again; the pseudo window with wallpaper around it and filled again
  * If unsuccessful
  ** Screenshot after the chord that did not change the layout
covers: default/hypr/bindings/tiling.lua:5-7; default/hypr/looknfeel.lua:91-94; manual/04:9-15; manual/07:15-19
merged-from: 40:hypr-window-float-pseudo-split

### window-focus-swap-and-alt-tab   [VM-OK]
description: Super+Arrow moves focus toward a neighbour (warping the pointer with it), Super+Shift+Arrow swaps the focused window with it, Super+J restacks the pair, and Alt+Tab / Alt+Shift+Tab cycle focus while raising the window — with edges, a lone window and an empty desktop behaving harmlessly. This is the chapter-04 terminal-and-browser tour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+Shift+Return: a terminal and Chromium share the width half and half. Press Super+J: they stack top/bottom; Super+J again: side by side. Click Chromium and press Super+W to close it.
  ** A first-run page or "restore pages" bubble in Chromium is fine; click Wait if Hyprland raises a "not responding" dialog.
  * Press Super+Return twice more and label the three terminals by typing `echo A`, `echo B`, `echo C` Return in each (click each to focus it).
  * Click A (the left column). Press Super+Right: focus moves to a right-column terminal (gradient border) and the pointer jumps to its centre. Press Super+Up / Super+Down: focus moves between the two stacked ones. Press Super+Left twice: focus returns to A and stays there on the second press.
  * With A focused press Super+Shift+Right: A swaps places with the right neighbour and keeps focus. Press Super+Shift+Left: back. Press Super+Shift+Up and Super+Shift+Down on a stacked one: the stacked order flips each time.
  * Press Alt+Tab three times: each press moves focus to a different terminal and the third returns to the start. Press Alt+Shift+Tab: one step back.
  * Press Super+T on B and on C so they float overlapping; focus B, press Alt+Tab until C is focused: C is now drawn on top of B.
  * Close all three terminals. Unhappy path: on the empty desktop press Super+J, Super+Shift+Right and Super+Right: nothing changes, nothing crashes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Focus warps the pointer into the new window; the cursor hides after key presses, so move the mouse a pixel if you need to show it.
  * Read the `echo` letters, not positions, to tell windows apart after swaps; the focused window has the brighter gradient border in every theme — compare borders, not titles.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: terminal and browser side by side, stacked, side by side again; a screenshot per chord showing the gradient border on the expected letter with the pointer inside it; the swapped positions; the Alt+Tab cycle; C on top of B after Alt+Tab; the empty desktop unchanged
  * If unsuccessful
  ** Screenshot with focus or position unchanged after a chord
covers: default/hypr/bindings/tiling.lua:5,16-19,42-50; default/hypr/bindings/applications.lua:2-3; test/shell.d/hyprland-binding-conflicts-test.sh:125-130; manual/04:5-19; manual/07:32-33,56-57
merged-from: 40:hypr-window-focus-swap-cycle; 10:terminal-browser-tile-split-swap

### window-fullscreen-three-modes   [VM-OK]
description: Super+F covers the whole screen (bar hidden), Super+Alt+F fills the workspace but keeps the top bar, and Super+Ctrl+F only tells the app it is fullscreen while it stays in its tile — each engages and releases, and all three are harmless with no window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+Shift+Return so a terminal and Chromium share the screen (click Wait on a "not responding" dialog).
  * With Chromium focused press Super+F: Chromium covers the entire screen, top bar included; the terminal is hidden. Press Super+F again: the split returns.
  * Press Super+Alt+F: Chromium fills the workspace with no gaps but the top bar stays visible. Press Super+Alt+F again.
  * Press Super+Ctrl+F: Chromium stays in its half of the screen but hides its own tab strip and address bar (the page fills the tile). In the terminal type `hyprctl clients -j | jq '.[] | select(.class|test("chrom";"i")) | .fullscreenClient'` Return → 2. Focus Chromium, press Super+Ctrl+F again: the tab strip returns and the command prints 0; the tile boundary never moved.
  ** Tiled full screen is a newer chord; if Super+K has no "Tiled full screen" row on this build, report it absent rather than failed.
  ** A terminal works as the subject too: `hyprctl -j activewindow | jq .fullscreenClient` → 2 then 0 with the tile size unchanged (some terminals drop their padding in client-fullscreen; the tile boundary is what must not change).
  * Close both windows. Unhappy path: press Super+F, Super+Alt+F and Super+Ctrl+F on the empty desktop: nothing changes; the bar remains.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar being visible or not is the tell between Super+F and Super+Alt+F; judge "bar hidden" by the window's top edge touching the top of the screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three states (no bar / bar kept / tile with hidden browser chrome) and the restored split after each; `fullscreenClient` 2 then 0; the empty desktop unchanged
  * If unsuccessful
  ** Screenshot of the mode that stuck or of a window covering the whole screen on Super+Ctrl+F; `hyprctl activewindow -j | jq '{fullscreen,fullscreenClient}'`
covers: default/hypr/bindings/tiling.lua:7-10; bin/omarchy-hyprland-window-tiled-fullscreen-toggle; test/shell.d/hyprland-window-test.sh; manual/04:27; manual/07:20-22
merged-from: 40:hypr-window-fullscreen-modes; 10:fullscreen-fullwidth-tiled-fullscreen; 25:tiled-fullscreen-toggle; 51:tiled-fullscreen-toggle

### window-pop-pinned-follows-workspaces   [VM-OK]
description: Super+O pops the focused window into a centred, pinned floating window with rounded corners that follows across workspaces, a second Super+O tiles it back, the CLI takes an explicit size, and the chord is harmless on an empty desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice. Press Super+O: the focused terminal becomes floating, centred, drawn above the other, with visibly rounded corners.
  ** The pop size defaults to 1300×900, larger than the 1280×800 guest screen, so Hyprland clamps it; it may nearly fill the screen. That is expected.
  * Type `hyprctl activewindow -j | jq '{floating,pinned,size,tags}'` Return → floating true, pinned true, tags include `pop`.
  * Press Super+2: the popped terminal is still on screen over the empty workspace 2; the other terminal is not. Press Super+Return: a new terminal tiles underneath while the popped one stays on top. Press Super+W to close that new terminal.
  * Press Super+1, click the popped terminal, press Super+O: it un-pins and tiles beside the first one, corners square; the jq line now shows floating false, pinned false and no `pop` tag; Super+2 is empty (Super+1 to return).
  * Type `omarchy-hyprland-window-pop 800 500` Return: a centred 800×500 floating pinned window (`hyprctl activewindow -j | jq .size` → [800,500]). Press Super+O to retile.
  * Close both terminals. Unhappy path: press Super+O on the empty desktop: nothing happens.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Rounded corners (rounding 8) on the popped window are the visual proof of the `pop` tag; a pinned window is drawn above tiled windows on every workspace.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the popped window on workspace 1, the same window over workspace 2 above a tiled terminal, tiled again on 1 with square corners, workspace 2 empty, the 800×500 pop; the jq lines
  * If unsuccessful
  ** Screenshot after Super+O with the window still tiled or not following to workspace 2; `hyprctl activewindow -j` after the failing step
covers: default/hypr/bindings/tiling.lua:11; bin/omarchy-hyprland-window-pop; default/hypr/apps/system.lua:54; manual/04:57-61; manual/07:17
merged-from: 40:hypr-window-pop-super-o; 10:pop-window-pinned-follows-workspaces; 25:window-pop-and-unpop

### window-resize-chords-and-width-memory   [VM-OK]
description: The twelve keyboard resize chords change the focused tile by 100, 25 or 300 px horizontally or (with Shift) vertically, and Super+Alt+Home / Super+Home remember and restore a window's width per app and workspace, telling the user when nothing is saved.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice; the right terminal is focused. Press Super+Home first: a notification "No saved width found for foot on workspace 1 — Use Super + Alt + Home to save one for this workspace." appears and nothing resizes.
  * Press Super+Minus, then Super+Equal: the split line moves by about 100 px and back. Press Super+Alt+Minus / Super+Alt+Equal: a small (25 px) move and back. Press Super+Ctrl+Minus / Super+Ctrl+Equal: a large (300 px) move and back.
  * Press Super+J to stack them and focus the bottom one. Press Super+Shift+Equal / Super+Shift+Minus (100 px), Super+Shift+Alt+Equal / Super+Shift+Alt+Minus (25 px), Super+Ctrl+Shift+Equal / Super+Ctrl+Shift+Minus (300 px): the horizontal split moves down and back by the three magnitudes. Press Super+J to unstack.
  * Press Super+Ctrl+Minus to widen the right terminal; type `hyprctl activewindow -j | jq '.size[0]'` Return and note the width. Press Super+Alt+Home: notification "Saved width for foot on workspace 1 — Restore using Super + Home on this workspace."; `cat ~/.local/state/omarchy/windows/workspace-1-foot.width` Return prints that number.
  * Press Super+Ctrl+Equal twice so it is much narrower, then Super+Home: it returns to the saved width (the jq width matches the saved number).
  ** If Super+K has no "Save window width" row on this build, skip the memory steps and report the chord absent.
  * Close one terminal and press Super+Minus on the lone window: nothing changes.
  * In the remaining terminal type `rm -r ~/.local/state/omarchy/windows` Return so the disk is clean, then close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Minus and Equal are `<M-->` and `<M-=>` (Hyprland binds them as `code:20`/`code:21`). The split line position between the two terminals is the visual measure; 25 px is subtle, compare screenshots side by side.
  * Notifications appear top-right and fade within seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "No saved width" notification; the split at three horizontal and three vertical magnitudes and back; the "Saved width" notification and the state file contents; the restored width after Super+Home matching the saved number
  * If unsuccessful
  ** Screenshot after a resize chord with the split unmoved, or after Super+Home with the width unchanged; the width values and `cat ~/.local/state/omarchy/windows/*`
covers: default/hypr/bindings/tiling.lua:12-13,55-68; bin/omarchy-hyprland-window-width; manual/07:34-41
merged-from: 40:hypr-window-resize-and-width-memory; 10:window-resize-keys-and-saved-width; 25:window-width-save-restore

### window-super-drag-move-and-resize   [VM-OK]
description: Holding Super while dragging with the left mouse button moves a window and with the right button resizes it — the only two mouse-driven window binds — on a floating window, over a tiled one, and harmlessly on the empty desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+T: a floating btop is centred on screen (it needs a second to draw its graphs).
  * Drag with the left button while holding Super from the middle of btop (x≈0.5, y≈0.5) to x≈0.2, y≈0.3: the window moves toward the top-left.
  * Drag with the right button while holding Super from inside btop toward the bottom-right by about a fifth of the screen: the window grows.
  * Press Super+Return (a terminal tiles behind), then Super+left-drag btop over the terminal and release: it stays floating where dropped and the terminal keeps its slot.
  * Click btop and press Super+W. Press Super+Return for a second tiled terminal. Super+left-drag one tiled terminal onto the other: dwindle swaps or re-slots the two (record what happened; it must not crash).
  * Close both terminals. Unhappy path: Super+left-drag on the empty desktop: nothing moves, nothing crashes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse drag --modifier super [--button right]`; the pointer is an absolute tablet so fractions are exact. Screenshot after each drag to compare positions; move the mouse before the screenshot if you need the pointer visible.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of btop before and after the move (position changed) and before and after the resize (larger); btop floating over the tiled terminal; the tiled-drag outcome; the empty desktop unchanged
  * If unsuccessful
  ** Screenshot after the drag with the window unmoved and the exact client command used
covers: default/hypr/bindings/tiling.lua:73-74; manual/04:23; manual/07:42-43
merged-from: 40:hypr-window-super-drag-move-resize; 10:super-mouse-drag-move-resize

### window-groups-tabs-join-eject-dissolve   [VM-OK]
description: Super+G turns a window into a tabbed group that new windows join; Super+Ctrl+Left/Right, Super+Alt+Tab, Super+Alt+1–5 and Super+Alt+scroll switch tabs, Super+Alt+Arrow pulls a window in, Super+Alt+G ejects one (and is harmless on an ungrouped window) and Super+G dissolves the group.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `echo ONE` Return, press Super+G: a tab strip (group bar) appears above the terminal.
  * Press Super+Return, type `echo TWO` Return, then Super+Shift+F: each opens as a new tab in the group, not a new tile (three tabs: ONE, TWO, Files).
  * Press Super+Ctrl+Left (TWO shows), Super+Ctrl+Right (Files), Super+Alt+1 (ONE), Super+Alt+2 (TWO), Super+Alt+3 (Files), Super+Alt+Tab (ONE), Super+Alt+Shift+Tab (Files), Super+Alt+4 and Super+Alt+5 (nothing changes — no such tab). Scroll the wheel over the group bar with Super+Alt held: the tab changes each notch.
  * Press Super+Alt+G: the visible window leaves the group and tiles beside it (two tabs remain). With the ejected window focused press Super+Alt+Left or Super+Alt+Right toward the group: it re-joins as a tab.
  * Click a group tab with the mouse and press Super+G: the tab strip disappears and the three windows tile normally.
  * Close all three. Unhappy path: open one terminal, press Super+Alt+G (not grouped): nothing changes. Close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The group bar is a 22 px strip drawn by Hyprland directly above the window content, with each tab showing a window title in the theme colours.
  * If `mouse scroll` cannot combine the super+alt modifiers, note it and rely on the keyboard variants.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of one tab, three tabs, each tab switch showing the right `echo` text or Files, the ejected window tiled next to a two-tab group, re-joined, and the dissolved tiles
  * If unsuccessful
  ** Screenshot after the chord that did not switch/eject/dissolve, or where the group did not form
covers: default/hypr/bindings/tiling.lua:76-95; default/hypr/looknfeel.lua:34-60; manual/04:51-55; manual/07:45-51
merged-from: 40:hypr-window-groups; 10:window-grouping-cycle-and-leave

### workspace-switch-move-and-silent-move   [VM-OK]
description: Super+1…9/0 switch to workspaces 1–10, Super+Shift+N moves the focused window there and follows, Super+Shift+Alt+N moves it without following, the bar indicators (and a click on one) track it, and moving nothing or moving to the current workspace is harmless.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo MOVER` Return. The bar's left section shows workspace 1 active.
  * Press Super+2 through Super+9 and Super+0 in turn: after each the bar highlights that number and the desktop is empty; on workspace 10 press Super+Return and type `hyprctl activeworkspace | head -1` Return → `workspace ID 10`, then close it. Press Super+1: MOVER is back.
  * Press Super+Shift+2: you land on workspace 2 with MOVER; Super+1 shows an empty workspace 1. Walk the rest — Super+Shift+3, Super+Shift+4 … Super+Shift+9, Super+Shift+0 — following MOVER each time, and finish with Super+Shift+1.
  * Press Super+Shift+Alt+3: MOVER disappears but you stay on workspace 1 (bar shows 1 active, 3 occupied). Press Super+3: MOVER is there. Walk the silent form the same way (Super+Shift+Alt+4 then Super+4, … Super+Shift+Alt+0 then Super+0, Super+Shift+Alt+2 then Super+2), ending with Super+Shift+Alt+1 and Super+1: MOVER is back on 1 and you never moved with it.
  ** One screenshot per number is enough; the bar highlight staying put is the silent-move proof.
  * Press Super+Shift+Alt+3 again (MOVER on 3, view on 1). Press Super+Tab: workspace 3 with MOVER; Super+Shift+Tab: back to 1; Super+Ctrl+Tab: 3 again (the former workspace). Click the workspace "1" indicator in the bar with the mouse: workspace 1 becomes active. Press Super+3 and Super+Shift+1 to bring MOVER home.
  * Unhappy path: press Super+Shift+1 with MOVER already on 1, then Super+5 (empty) and Super+Shift+Alt+4 with no window focused: nothing happens either time, no error. Press Super+1.
  * Close MOVER; the desktop is empty on workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+3 is `<M-S-A-3>`. Empty workspaces vanish from the bar when you leave them; only occupied ones stay listed. Workspace switching has no animation in Omarchy.
  * The workspace indicators sit right of the Omarchy logo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots for each Super+N including `workspace ID 10`; MOVER following on the Shift moves; the highlight staying on 1 with 3 listed after the silent move; the Tab trio and the mouse-driven switch; MOVER back on 1
  * If unsuccessful
  ** Screenshot after the chord with the wrong workspace highlighted or the window in the wrong place, plus the bar
covers: default/hypr/bindings/tiling.lua:21-35; shell/plugins/bar/widgets/Workspaces.qml; manual/03:21; manual/04:21; manual/07:23,27-28
merged-from: 40:hypr-workspace-switch-and-move; 10:workspaces-switch-move-silent

### workspace-tab-scroll-and-former   [VM-OK]
description: Super+Tab / Super+Shift+Tab step through existing workspaces, Super+Ctrl+Tab bounces to the previously focused one, and Super+wheel over the desktop does the same as Tab while a plain wheel over a window does not switch.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return on workspace 1, Super+3 and Super+Return, Super+5 and Super+Return, then Super+1 (three occupied workspaces).
  * Press Super+Tab: workspace 3 (the next *existing* one). Super+Tab: 5. Super+Tab once more: record whether it stays on 5 or wraps.
  * Press Super+Shift+Tab: 3. Again: 1.
  * Press Super+5, then Super+Ctrl+Tab: 1 (the former workspace). Super+Ctrl+Tab: 5.
  * Move the mouse over the wallpaper and scroll down one notch with Super held: the bar steps to the next workspace; scroll up with Super held: back. Scroll without Super over a terminal: the workspace does not change.
  * Press Ctrl+Alt+Delete; the desktop is empty on workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse scroll --modifier super`; if the client cannot combine a modifier with scroll, report the tooling gap and rely on the Tab chords.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots showing 1→3→5, back to 1, the 5↔1 bounce, and the Super+scroll steps with the plain scroll leaving the workspace alone
  * If unsuccessful
  ** Bar screenshot after the chord that landed on the wrong workspace
covers: default/hypr/bindings/tiling.lua:33-35,70-71; manual/07:24-26,44
merged-from: 40:hypr-workspace-tab-scroll-navigation

### workspace-layout-toggle-scrolling-and-default   [VM-OK]
description: Super+L (and Trigger → Toggle → Workspace Layout) switches the current workspace between dwindle and scrolling with a toast, the choice is per workspace and survives a Hyprland reload through its state file, the looknfeel.lua `layout = "scrolling"` tweak makes scrolling the default for new workspaces, and a double toggle lands back where it started.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return three times on workspace 1: dwindle shows all three as a binary tree. Screenshot.
  * Press Super+L: toast "Workspace layout set to scrolling" and the terminals rearrange into half-width columns with the third pushed off the right edge; Super+Right / Super+Left scroll the row. Type `hyprctl activeworkspace -j | jq -r .tiledLayout` Return → `scrolling`; `cat ~/.local/state/omarchy/workspace-layouts/1.lua` → `hl.workspace_rule({ workspace = "1", layout = "scrolling" })`.
  * Press Super+2 and open two terminals: they tile dwindle (the choice is per workspace; `tiledLayout` → `dwindle`). Press Super+1 and type `hyprctl reload` Return: workspace 1 is still scrolling (the rule is re-sourced).
  * Press Super+Space and go to Trigger → Toggle → Workspace Layout (typing `workspace layout` in the root search may jump there): toast "Workspace layout set to dwindle", all three terminals visible again, the file now says `layout = "dwindle"`.
  * Type `printf '%s\n' 'hl.config({ general = { layout = "scrolling" } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload` Return, press Super+3 and open three terminals: scrolling columns without pressing Super+L. Then `sed -i '$d' ~/.config/hypr/looknfeel.lua && hyprctl reload`; Super+4 with two new terminals tiles dwindle.
  ** A broken edit to looknfeel.lua shows a red banner at the top; fix the line and reload before continuing. Style → Hyprland opens the same file in the editor.
  * Unhappy path: press Super+1, then Ctrl+Alt+Delete (everything closed, empty workspace 1); press Super+L and again straight away: two toasts (scrolling, then dwindle) and the workspace ends dwindle as it started.
  * Press Super+Return and type `ls ~/.local/state/omarchy/workspace-layouts/` Return (no `null.lua`), then `rm -f ~/.local/state/omarchy/workspace-layouts/*.lua`; close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+L is the layout toggle, not lock (lock is Super+Ctrl+L). Toasts appear top-right for about five seconds.
  * In the menu the first Return only settles the cursor if the filter did not match; navigate with the arrows if typing does not filter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the tree layout, the scrolling columns with one column cut off and the toast, the rule file both ways, workspace 2 still dwindle, scrolling preserved after reload, the dwindle toast with all three fitting, scrolling by default on workspace 3, dwindle again after cleanup, the two toasts of the unhappy path, no `null.lua`
  * If unsuccessful
  ** Screenshot after Super+L with the layout unchanged or reverting after reload; `hyprctl activeworkspace -j` and the state file; a banner after the looknfeel edit
covers: default/hypr/bindings/tiling.lua:14; bin/omarchy-hyprland-workspace-layout-toggle; default/hypr/workspace-layouts.lua; default/hypr/looknfeel.lua:19,96-98; config/hypr/looknfeel.lua:4-14; default/omarchy/omarchy-menu.jsonc:97 (trigger.toggle.workspace-layout); test/shell.d/hyprland-workspace-layout-test.sh; manual/04:29-49 (04-navigation.md); manual/07:18
merged-from: 40:hypr-workspace-layout-toggle-and-default; 10:workspace-layout-toggle-scrolling; 25:workspace-layout-toggle; 51:workspace-layout-toggle-persists

### scratchpad-quake-console   [VM-OK]
description: The scratchpad is a Quake console: Super+S or Super+Grave drops it over the current workspace dimming what is beneath, Super+Alt+S / Super+Shift+Grave send a window there, one window shows as a centred half-height 2:1 panel and two make it full width, closing back recenters, changing workspace hides it, and toggling an empty scratchpad is harmless.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo BELOW` Return. Press Super+S: a dimmed overlay covers the workspace and the special workspace slides down from the top; with no default agent the console is empty (its `omarchy-agent` seed exits silently). Press Super+S again: gone.
  * Press Super+Return, type `echo CONSOLE` Return, press Super+Alt+S: CONSOLE vanishes from the workspace without following.
  * Press Super+Grave: CONSOLE drops from the top as a centred, borderless panel flush with the top edge, about half the screen height and twice as wide as tall (≈770×385 on this guest), BELOW dimmed beneath. In it type `hyprctl activewindow -j | jq '{ws:.workspace.name,at,size}'` Return → workspace `special:scratchpad`.
  * Press Super+Return while the console is open: the new terminal opens on the scratchpad and the console widens to the full screen width, two side by side, still half height. Type `exit` Return in one: the remaining window recenters to the 2:1 panel.
  * Press Super+2: the console hides. Press Super+1, Super+Grave: it reopens. Press Super+Grave to hide, Super+S to show (same panel), Super+S to hide.
  * Click BELOW to focus it and press Super+Shift+Grave: BELOW also moves onto the scratchpad; Super+S shows both full width. Focus one and press Super+Shift+1: it leaves the scratchpad and tiles on workspace 1; do the same for the other, then close both.
  ** The Grave aliases and the centred panel are newer; on 4.0.2 the console may span the full width and Super+Grave may be missing from Super+K — record the geometry and use Super+S / Super+Alt+S instead of failing.
  * Unhappy path: press Super+S with the empty scratchpad, then Super+S again: nothing stays on screen, no crash; the desktop is empty as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Grave is the key left of 1: `<M-`>` and `<M-S-`>`. The dimming (0.6) of the workspace beneath is the tell that a special workspace is open.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dimmed empty console, CONSOLE gone from the workspace, the centred half-height panel with the jq line naming `special:scratchpad`, two windows full width, the recentred panel, hidden after Super+2, reopened with Super+Grave, both windows back on workspace 1, and the empty desktop
  * If unsuccessful
  ** Screenshot of the console with wrong geometry (a full-width single window, a panel not flush with the top) or a chord that did nothing; `hyprctl workspacerules -j | jq '.[] | select(.workspaceString|test("scratchpad"))'`
covers: default/hypr/bindings/tiling.lua:28-31; default/hypr/qconsole.lua; default/hypr/looknfeel.lua:122-124; test/shell.d/hyprland-qconsole-test.sh; test/shell.d/hyprland-default-config-test.sh (grave aliases); manual/04:63-69 (04-navigation.md); manual/07:29-30
merged-from: 40:hypr-scratchpad-quake-console; 10:scratchpad-toggle-single-and-double; 25:quake-console-scratchpad; 51:scratchpad-console-geometry

### desktop-style-toggles-transparency-gaps-square-fullscreen   [VM-OK]
description: The desktop style toggles — Super+Backspace window transparency, Super+Shift+Backspace window gaps (a toggle file that survives reloads), Super+Shift+Space top bar, Super+Ctrl+Alt+F fullscreen desktop (bar and gaps off together, a half-applied state from either side pulled into line) and Super+Ctrl+Backspace single-window square aspect with its toasts — engage and release from hotkey, Trigger → Toggle and CLI, their flag files come and go, and bad CLI arguments are refused. These are the chapter's non-permanent alternatives to editing looknfeel.lua.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice: two tiles with gaps between them and the screen edges, and a hint of wallpaper through the terminal background (default opacity 0.985/0.96).
  * Press Super+Backspace: the focused terminal becomes fully solid. Press again: translucent again.
  ** The difference is subtle; zoom into the screenshots, and if they cannot show it `hyprctl activewindow | grep opaque` flipping is the proof.
  * Press Super+Shift+Backspace: gaps, borders and rounding vanish (tiles touch each other and the edges). Type `ls ~/.local/state/omarchy/toggles/hypr/; hyprctl getoption general:gaps_out | head -1` Return → `flags.lua` and `window-no-gaps.lua`, and 0. Type `hyprctl reload` Return: gaps stay off (the flag is re-sourced). Press Super+Space → Trigger → Toggle → Window Gaps: gaps return, the file is gone, gaps_out is back to its default.
  ** Gap toggles reload Hyprland; allow a second.
  * Press Super+Shift+Space: the top bar hides and the terminals grow into the space (Super+Space still opens the menu with the bar hidden). Press it again: the bar returns. Super+Space → Trigger → Toggle → Menu Bar does the same — use it twice so the bar ends visible.
  * Press Super+Ctrl+Alt+F: bar hidden and gaps gone at once. Type `omarchy-toggle-enabled bar-off; echo $?; omarchy-hyprland-toggle-enabled window-no-gaps; echo $?` Return → 0 and 0. Press Super+Ctrl+Alt+F again: both back; both checks print 1.
  ** If Super+K has no "Toggle full screen desktop" row on this build, report it absent and skip the fullscreen-desktop steps.
  * Half states: press Super+Shift+Backspace (gaps off only), then Super+Ctrl+Alt+F: because only one half was on, the toggle goes fully ON (the bar hides too), not off. Type `omarchy-toggle-fullscreen-desktop off` Return → both restored. Now press Super+Shift+Space (bar off only), then Super+Ctrl+Alt+F: again both halves go to full-screen desktop; Super+Ctrl+Alt+F once more restores both.
  * Press Super+W (one tile left). Press Super+Ctrl+Backspace: toast "Enable single-window square aspect ratio" and the lone window shrinks to a centred, roughly square tile (about 770 px wide on the 1280×800 guest) with wallpaper either side. Press Super+Return: with two windows the square rule no longer applies and both fill the width; close it with Super+W. Press Super+Space → Trigger → Toggle → 1-Window Ratio: toast "Disable single-window square aspect ratio" and the window fills the workspace again.
  * Negatives: type `omarchy-hyprland-toggle nosuchflag on; echo "exit=$?"` Return → "Flag not found: nosuchflag", exit=1; `omarchy-hyprland-toggle window-no-gaps sideways; echo "exit=$?"` → usage, exit=1; `omarchy-toggle-fullscreen-desktop sideways; echo "exit=$?"` → usage, exit=1. `ls ~/.local/state/omarchy/toggles/hypr/` → only `flags.lua`.
  * Press Super+W. Unhappy path: press Super+Backspace on the empty desktop: nothing happens. The desktop must look exactly as at the start (gaps, borders, bar).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chords: `<M-BS>`, `<M-S-BS>`, `<M-S-SPACE>`, `<M-C-A-f>`, `<M-C-BS>`. `omarchy-toggle-bar on` hides the bar ("hidden on"); the Hyprland toggle flags live in `~/.local/state/omarchy/toggles/hypr/`, the bar flag under `~/.local/state/omarchy/toggles/`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: translucent vs opaque terminal (or the `opaque` flag flipping); gaps off with the flag file and gaps_out 0, still off after reload, on again after the menu row with the file gone; bar hidden and shown by chord and by menu; bar+gaps off with 0/0 and on with 1/1; both half states going fully on and restoring; the square tile with its toast, two windows filling the width, the disable toast; the three refusals with exit=1 and only `flags.lua` left; the stock desktop at the end
  * If unsuccessful
  ** Screenshot of the state that did not change, a stuck hidden bar, or where bar and gaps disagree with the flags; screenshot after `hyprctl reload` if gaps came back while the flag file existed; `hyprctl activewindow -j` and `hyprctl getoption layout:single_window_aspect_ratio`; a toggles listing with a leftover file; `./client get-serial`
covers: default/hypr/bindings/utilities.lua:16,19-22; bin/omarchy-hyprland-window-transparency-toggle; bin/omarchy-hyprland-window-gaps-toggle; bin/omarchy-hyprland-window-single-square-aspect-toggle; bin/omarchy-toggle-fullscreen-desktop; bin/omarchy-toggle-bar; bin/omarchy-hyprland-toggle; bin/omarchy-hyprland-toggle-enabled; default/hypr/toggles.lua; default/hypr/toggles/window-no-gaps.lua; default/hypr/toggles/single-window-aspect-ratio.lua; default/hypr/windows.lua (default-opacity); default/omarchy/omarchy-menu.jsonc (trigger.toggle.one-window-ratio, trigger.toggle.window-gaps, trigger.toggle.top-bar); test/shell.d/toggle-test.sh; manual/07:176-177,192-195; manual/13:26; manual/42:24-37 (42-common-tweaks.md, Remove window gaps, top bar toggle)
merged-from: 10:window-transparency-gaps-square-fullscreen-desktop; 25:toggle-fullscreen-desktop; 25:window-gaps-toggle; 25:window-single-square-aspect-toggle; 25:window-transparency-toggle; 12:toggle-hotkeys-gaps-and-bar; 40:hypr-desktop-gaps-bar-fullscreen-toggles

### zoom-and-alt-tab-cycle   [VM-OK]
description: Alt+Tab / Alt+Shift+Tab cycle windows on the workspace, and Super+Ctrl+Z magnifies the screen around the pointer one step per press while Super+Ctrl+Alt+Z resets it (and is harmless at normal zoom).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return three times and type `one`, `two`, `three` (Return each) in the three terminals.
  * Press Alt+Tab three times: the bright focus border visits each terminal and the third press returns to the start. Press Alt+Shift+Tab: focus moves the other way.
  * Move the mouse to the centre of a terminal and press Super+Ctrl+Z: the screen is magnified 2× around the pointer (text twice as big, edges cut off). Press Super+Ctrl+Z again: 3×.
  * Press Super+Ctrl+Alt+Z: normal view.
  ** Newer chord: if Super+K has no "Zoom in" row on this build, report it absent.
  * Unhappy path: press Super+Ctrl+Alt+Z again at normal zoom: nothing changes.
  * Press Super+W three times: empty desktop.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The zoom is compositor-level and shows in screenshots; the pointer position decides what is magnified — keep it over terminal text so the screenshot shows enlarged characters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the focus ring on different terminals, the 2× and 3× zoom, and normal scale
  * If unsuccessful
  ** Screenshot where zoom stuck or focus did not move
covers: default/hypr/bindings/tiling.lua:47-50; default/hypr/bindings/utilities.lua:118-125; manual/07:52-53,56-57
merged-from: 40:hypr-zoom-super-ctrl-z; 10:alt-tab-and-zoom

### activity-btop-floats-and-tiles   [VM-OK]
description: Super+Ctrl+T opens btop as a centred floating "Activity" window themed to Omarchy, Super+T tiles and re-floats it, Files tiles underneath while btop stays on top, btop is hidden from the launcher, and Super+Q / Super+W close windows even on an empty desktop without harm.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so one tiled window exists, then Super+Ctrl+T: a floating window (roughly 875×600, centred, not tiled next to the terminal) opens running btop — CPU graph, memory, disks, network and process list in the Omarchy theme colours (not btop's default).
  ** btop needs a second to draw its graphs.
  * Press Super+T: btop snaps into the tiling beside the terminal (both share the screen). Press Super+T again: it floats again.
  * Press Super+Shift+F: Files opens and tiles with the terminal while btop stays floating on top.
  * Click btop and press Super+Q: btop closes (`q` inside btop works too). Press Super+W twice: Files and the terminal close; the desktop is empty.
  * Press Super+Space and type `btop`: no `btop` app row is offered (it is hidden from the launcher list). Press Escape.
  * Unhappy path: press Super+W and Super+Q on the empty desktop: nothing happens; the bar remains.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The btop window class is `org.omarchy.btop`; the floating rule gives it 875×600. A floating window shows desktop margin around it and does not resize its neighbours.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of btop floating over the terminal, tiled beside it, floating again, Files tiled underneath, the launcher search with no btop row, and the empty desktop
  * If unsuccessful
  ** Screenshot of what Super+Ctrl+T produced (a tiled window, or nothing); if btop never opened, the output of `omarchy-launch-tui btop` typed in a terminal
covers: default/hypr/bindings/utilities.lua:104; default/hypr/bindings/tiling.lua:1-2,6; default/hypr/apps/system.lua:2-9; default/omarchy/launcher.hides; config/btop/btop.conf; manual/04:15; manual/07:73; manual/21-tuis.md:19-23
merged-from: 10:floating-activity-monitor-and-close; 11:btop-activity-float-and-tile

### window-rules-helper-windows-float-centred   [VM-OK]
description: Omarchy's helper windows get the right rules: presentation terminals and float TUIs open centred and floating (875×600), tile TUIs tile, portal file-chooser dialogs and the imv image viewer float over the tiled app that spawned them, and About floats wider than the standard float (920×480) while the Nautilus main window tiles.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `omarchy-launch-floating-terminal-with-presentation 'sleep 20'` Return: a floating centred window of about 875×600 sits over the tiled terminal. Press Ctrl+C in it.
  * Type `xdg-terminal-exec --app-id=TUI.float -e sleep 20` Return: another floating centred window of the same size; Ctrl+C in it. Type `xdg-terminal-exec --app-id=TUI.tile -e sleep 20` Return: this one tiles beside the first terminal, not floating; Ctrl+C in it.
  * Type `imv "$(readlink -f ~/.local/state/omarchy/current/background)" &` Return: the image opens as a floating centred window over the terminal, fully opaque. Press `q` in it. Type `imv /nonexistent.png; echo "exit=$?"` Return: an error and a non-zero exit, no window.
  * Press Super+Shift+Return (Chromium; click Wait on a "not responding" dialog) and, once it is up, press Ctrl+O in it: a GTK "Open File" dialog floats centred over the tiled browser. Escape closes it; Chromium is still tiled. Close Chromium.
  ** If Chromium shows its own picker instead of the portal one, record which appeared.
  * Press Super+Space → About: the About window (logo + fastfetch) floats centred, visibly wider than the 875-pixel floats (~920×480). Press a key or Super+W to close it; open it again from the menu: still floating (it may now have its measured size). Close it.
  * Press Super+Shift+F: the Nautilus main window opens tiled (only its Open/Save dialogs float). Close it and the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Floating windows have a border and are drawn above the tiles with the tiles unchanged behind them — that is the visual tell versus a tiled window that would shrink the others.
  * Chromium takes 10–20 s to appear on 2 vCPU.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two floating 875×600 windows, the tiled TUI, floating imv, the imv error line, the file dialog floating over the tiled browser, the floating About window twice, and Nautilus tiled
  * If unsuccessful
  ** Screenshot of a presentation terminal, dialog or viewer tiled and splitting the workspace, or About at the small float size
covers: default/hypr/apps/system.lua:2-32,40-51 (floating-window tag, org.omarchy.about, TUI.float); default/hypr/apps/terminals.lua; bin/omarchy-launch-tui; default/omarchy/omarchy-menu.jsonc:32
merged-from: 40:hypr-window-rule-floating-dialogs-and-viewers; 22:omarchy-terminal-window-rules

### window-rules-browser-opaque-tiled-no-self-maximize   [VM-OK]
description: Browser windows are forced tiled and made almost opaque while every other window is slightly translucent, Super+Backspace toggles a window fully opaque, and no app can maximize itself — only Super+Alt+F may.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+Shift+Return so a terminal and Chromium share the screen (click Wait on a "not responding" dialog).
  * Look at the terminal over a busy wallpaper area: a hint of wallpaper shows through (0.985/0.96). Press Super+Backspace with the terminal focused: it becomes solid. Press Super+Backspace again: translucent again.
  ** The difference is subtle; if the screenshot cannot show it, `hyprctl activewindow | grep opaque` flipping true/false is the proof.
  * Focus Chromium and press Super+T: it must not float (its rule pins it tiled) — record whether it snaps back or ignores the chord.
  * Double-click an empty part of Chromium's tab strip (its own maximize gesture): nothing changes, the terminal keeps its half.
  * Press Super+Alt+F with Chromium focused: it fills the workspace; press again to undo.
  * Close both windows; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chromium's tab strip is the top ~40 px of its window; double-click right of the tabs.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the translucent and solid terminal (or the opaque flag flipping), Chromium staying tiled after Super+T, unchanged after the double-click, and maximized after Super+Alt+F
  * If unsuccessful
  ** Chromium floating or maximizing by its own gesture, or Super+Backspace having no effect
covers: default/hypr/windows.lua:3,6,25; default/hypr/apps/browser.lua:2-5; default/hypr/bindings/utilities.lua:19; bin/omarchy-hyprland-window-transparency-toggle; manual/07:176
merged-from: 40:hypr-window-rule-browser-opacity-and-maximize

### window-rule-pip-pinned-top-right   [VM-OK] [NET]
description: A browser Picture-in-Picture window floats pinned in the top-right corner at 600×338 with no border, keeps its aspect ratio when resized and follows across workspaces.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return, open `https://www.w3schools.com/html/mov_bbb.mp4`, right-click the video twice and choose "Picture in picture".
  ** ~10 MB download; any page with a plain `<video>` works if this one is slow. Click Wait on a "not responding" dialog.
  * A small borderless video window appears top-right above the browser, about 600×338.
  * Press Super+2: the PiP window is still visible over the empty workspace (pinned). Press Super+1.
  * Super+right-drag its corner to resize: it stays 16:9.
  * Close the PiP (hover → X) and Chromium; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The PiP window's position (top-right, 40 px margins) and lack of border are the visual proof of the `pip` rule.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the PiP top-right on workspace 1 and on workspace 2, and after the resize still 16:9
  * If unsuccessful
  ** PiP tiled, centred, or lost on the workspace switch
covers: default/hypr/apps/pip.lua:1-12
merged-from: 40:hypr-window-rule-pip-pinned

### file-select-portal-dialog-pick-and-cancel   [VM-OK]
description: `omarchy file select` opens the desktop portal file chooser as a floating dialog over the terminal: picking a file prints its path, cancelling exits 1 silently, filters and folder mode work, and an unknown option is refused without a dialog.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `touch ~/Pictures/pick-me.png` Return.
  * Type `omarchy file select --title "QA pick" --extensions "png"; echo "exit=$?"` Return; a GTK chooser titled `QA pick` opens floating over the terminal with a `*.png` filter.
  * Click into `Pictures`, click `pick-me.png`, click Open; expected `/home/prime/Pictures/pick-me.png` and `exit=0` in the terminal.
  * Type `omarchy file select --title "Cancel me"; echo "exit=$?"` Return; press Escape in the dialog; expected no path and `exit=1`.
  * Type `omarchy file select --directory --title "Pick folder"; echo "exit=$?"` Return; select `Pictures` and confirm; expected `/home/prime/Pictures`, `exit=0`.
  * Type `omarchy file select --bogus; echo "exit=$?"` Return; expected `omarchy-file-select: unknown option --bogus`, `exit=2`, no dialog.
  * Type `rm ~/Pictures/pick-me.png` Return and close the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog is a separate floating window (GTK renders oversized at 1× on this guest — expected); hover/click it before typing so keys reach it.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the chooser with title and filter floating over the terminal, the printed path with `exit=0`, the cancel `exit=1`, the folder result, and the refused option
  * If unsuccessful
  ** a `GLib.Error`/portal message, no dialog, or a path printed after cancel
covers: bin/omarchy-file-select
merged-from: 20:file-select-dialog-pick-and-cancel

### focus-app-by-class-across-workspaces   [VM-OK]
description: `omarchy-hyprland-focus-app` focuses a window by class across workspaces (the notification click-to-focus fallback) and fails with exit 1 when nothing matches or no class is given.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a browser (Super+Shift+Enter) on workspace 1 (click Wait on a "not responding" dialog); press Super+2 and open a terminal.
  * In the terminal type `hyprctl clients -j | jq -r '.[].class'` Return → note the browser's class (e.g. `chromium`).
  * Type `omarchy-hyprland-focus-app chromium` Return (use the class you saw, any case): the view switches to workspace 1 with the browser focused.
  * Press Super+2 back to the terminal and type `omarchy-hyprland-focus-app nosuchapp; echo "exit=$?"` Return → 1, focus unchanged. `omarchy-hyprland-focus-app; echo "exit=$?"` → usage, 1.
  * Close the browser and the terminal; the desktop is empty on workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar's workspace indicator and the gradient focus border show which window received focus; Chromium takes 10–20 s to appear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendump of the browser focused on workspace 1 right after the command from workspace 2; the exit codes 1 and 1 with focus unchanged
  * If unsuccessful
  ** `hyprctl clients -j | jq '.[] | {class,initialClass,initialTitle,workspace}'`
covers: bin/omarchy-hyprland-focus-app; docs/notifications.md (click fallback); test/shell.d/hyprland-focus-app-test.sh
merged-from: 25:focus-app-by-class

### monitor-scaling-hotkeys-cli-and-panel   [VM-OK]
description: Super+/ and Super+Alt+/ step the single 1280×800 display through the clean scaling presets (1 → 1.25 → 1.6 → 2 → 3.2 → 4), the CLI jumps to a value (rounding 3 to 3.2), the Display panel's scale pills do the same by mouse and keyboard, every change persists to monitors.lua and is logged, bad values are refused, and the shipped file — `omarchy_monitor_scale = "auto"` (resolving to 1 here) with `omarchy_gdk_scale = 2`, the manual's "2x" — is restored at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `omarchy-hyprland-monitor-scaling; hyprctl monitors -j | jq -c '.[]|{name,width,height,scale}'; grep -n 'omarchy_monitor_scale\|omarchy_gdk_scale' ~/.config/hypr/monitors.lua` Return → `1`, `Virtual-1` at 1280x800 scale 1, and the two lines `local omarchy_monitor_scale = "auto"` / `local omarchy_gdk_scale = 2`.
  * Press Super+/ : everything on screen (bar, terminal text) grows ~25 % within a second — that screenshot is the main proof. Re-run the first command → `1.25`; `grep omarchy_ ~/.config/hypr/monitors.lua` → `local omarchy_monitor_scale = 1.25` and `local omarchy_gdk_scale = 1` (GDK rounds to an integer); `tail -1 ~/.local/state/omarchy/monitor-scaling.log` → a tab-separated `requested=up	current=1	new=1.25	monitor=Virtual-1`.
  * Press Super+/ again (larger still, `1.6`), then Super+Alt+/ twice: back to scale 1; the file says `= 1`.
  * Type `omarchy-hyprland-monitor-scaling 3` Return: 1280x800 cannot do exactly 3×, so `3.2` is applied (the desktop is very large — a 400×250 logical screen). Type `omarchy-hyprland-monitor-scaling 1` Return blind straight away: back to 1; the no-argument command prints `1`.
  ** At 3.2 the terminal shows only a few lines; keep the command short and do not linger above 2.
  * Press Super+Ctrl+D: the Display panel shows Virtual-1 with the scale pills, 1x filled (the brightness control is absent or inert — no backlight). Click the "1.25x" pill (the pill right after 1x): within ~2 s the bar, panel and fonts grow, the panel stays open and the clicked pill is filled. Click "1x": original size, 1x filled. Press j (ring on the first pill), l twice, Enter: the third pill applies and the desktop rescales; press h twice, Enter: back to 1x. Escape.
  ** A pill whose clean scale differs from its label is relabelled; report the label you clicked.
  * Negatives: `omarchy-hyprland-monitor-scaling 9; echo "exit=$?"` → the usage line, exit=1, nothing on screen changes; `omarchy-hyprland-monitor-scaling abc; echo "exit=$?"` → same. `omarchy-hyprland-monitor-modeless; echo "exit=$?"` → exit=1 (a working monitor is not "modeless").
  * Restore the shipped file: `omarchy-refresh-config hypr/monitors.lua && hyprctl reload && rm ~/.config/hypr/monitors.lua.bak.*` — monitors.lua reads `"auto"` again (which resolves to 1× on this display, so the screen looks as at the start). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<M-/>` and `<M-A-/>`. The screenshot stays 1280×800; the UI inside it grows. At higher scales press Super+F on the terminal to keep the output readable.
  * If monitors.lua on this disk is not the generic catch-all (no `omarchy_monitor_scale` line), the persist step is skipped by design — report which form the file has. If the screen goes black or the bar vanishes for more than 5 s, screenshot, report, then type `omarchy-hyprland-monitor-scaling 1<ENTER>` blind.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots at scale 1, 1.25, 1.6, 3.2 and back at 1 (visibly bigger bar and text), each with the printed scale, the two monitors.lua lines and the log line; the Display panel with the filled pill by mouse and by keyboard and the restored desktop after 1x; both usage refusals and the modeless exit=1; the restored `"auto"` file
  * If unsuccessful
  ** The scale not changing on screen, monitors.lua not updated, the log line missing, the wrong pill active, or a black screen after a scale change; `hyprctl monitors -j` and the monitors.lua contents; `omarchy-version`; `./client get-serial` tail
covers: default/hypr/bindings/tiling.lua:97-98; bin/omarchy-hyprland-monitor-scaling; bin/omarchy-hyprland-monitor-modeless; bin/omarchy-monitor-state; config/hypr/monitors.lua:7-8,21-22; shell/plugins/panels/monitor/Panel.qml (setScale, activeScaleIndex, moveCursorH, activateCursor); shell/plugins/panels/monitor/Model.js (cleanScale, matchingScaleIndex); test/shell.d/monitor-scaling-test.sh; test/shell.d/monitor-test.sh (clean VM scale); test/shell.d/monitor-modeless-test.sh; test/shell.d/monitor-state-test.sh; manual/07:54-55; manual/33:21 (Super + / … persist past reboot); manual/33-monitors.md
merged-from: 40:hypr-monitor-scaling-step-super-slash; 10:monitor-scaling-step-and-restore; 12:monitor-scaling-hotkeys-cycle-and-persist; 25:monitor-scaling-up-down-and-persist; 52:monitor-scaling-presets-in-vm; 31:monitor-scale-change-and-restore

### monitor-state-report-single-display   [VM-PARTIAL]
description: `omarchy monitor state` feeds the shell's monitor panel with seven lines plus JSON; on the single virtual display the internal-monitor fields must be empty and the focused/JSON fields must name the one output (the laptop branches are not exercisable here).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy monitor state | cat -A; echo "exit=$?"` Return.
  ** Expected 8 lines ending in `$`: brightness (empty), internal name (empty), the only monitor (e.g. `Virtual-1`), empty, empty, the focused monitor (same name), a scaling value or empty, then a JSON array like `[{"name":"Virtual-1","enabled":true,"focused":true,"width":…,"height":…}]`; `exit=0`.
  * Type `omarchy monitor state | tail -n 1 | jq '.[0].enabled, .[0].focused'` Return; expected `true` twice.
  * Type `omarchy monitor --help` Return; expected `Monitor commands — Monitor status helpers:` with `omarchy monitor state`.
  * Close the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `cat -A` makes the empty lines visible as a bare `$`. Skipped: the laptop-display and brightness fields (no internal panel, no backlight).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the 8 `cat -A` lines, the two `true`s and the group help
  * If unsuccessful
  ** a jq/hyprctl error, fewer than 8 lines, or invalid JSON on the last line
covers: bin/omarchy-monitor-state; test/shell.d/monitor-state-test.sh
merged-from: 20:monitor-state-report

### display-text-size-set-reset-reject   [VM-OK]
description: `omarchy display text size N` scales shell, GTK and terminal text together within 9–20 px and is visible in the bar and in new terminals, the report, the "Restart Foot" toast and `reset` behave, and out-of-range or non-numeric values are refused without changing anything — the manual's "make text bigger without rescaling everything" knob.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop bar for reference, then open a terminal with Super+Enter and type `omarchy display text size` Return → `text size: 12 (default) px`, `gtk text-scaling-factor: 1.0`, `terminal font: 9 pt` (record the pt if different).
  * Type `omarchy display text size 18; echo "exit=$?"` Return → exit=0; a toast "Restart Foot to apply the new terminal font size" (foot is running) and the bar text visibly larger within 2 s. Type `omarchy display text size` → `text size: 18 px`, a GTK factor around 1.5 (`1.5455`: 17pt/11pt, quantised to a whole point size), `terminal font: 14 pt` (18×9/12 rounded).
  * Type `grep -A1 '^\[font\]' ~/.config/omarchy/shell.toml; grep '^font=' ~/.config/foot/foot.ini; gsettings get org.gnome.desktop.interface text-scaling-factor` Return → `base-size = 18`, `font=JetBrainsMono Nerd Font:size=14`, and the same factor.
  * Press Super+Enter: the new terminal's text is visibly larger than the first one's (the already-open foot keeps its old size — foot has no reload signal).
  * Negatives: `omarchy display text size 30; echo "exit=$?"` → "Size must be an integer between 9 and 20 (px)." + usage, exit=1, the bar does not change; `omarchy display text size abc; echo "exit=$?"` → same, exit=1.
  * Type `omarchy display text size reset && omarchy display text size` Return → the bar returns to normal and the report reads `12 (default) px` / `1.0` / `9 pt`; `grep '^font=' ~/.config/foot/foot.ini` → size=9; the `base-size` line is gone from shell.toml.
  * Close all terminals with Ctrl+Alt+Delete; the bar matches the reference screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell watches shell.toml, so bar text re-flows live; compare bar screenshots side by side — the clock and workspace labels grow noticeably at 18 px.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after/reset bar screenshots, the three-line reports, the `Restart Foot` toast, the config lines, the larger second terminal, and the two refusals with exit=1
  * If unsuccessful
  ** a bar that does not re-flow, a report that does not match the value set, or a rejection that changed something anyway; the status output and the relevant config lines; `./client get-serial`
covers: bin/omarchy-display-text-size; manual/33-monitors.md (Making text bigger or smaller)
merged-from: 20:display-text-size-set-reset-and-reject; 12:display-text-size-command; 25:display-text-size-set-and-reset

### monitors-lua-scale-edit-and-gdk-scale   [VM-OK]
description: Editing the two `local` scale variables in ~/.config/hypr/monitors.lua via Setup → Monitors changes the monitor scale as soon as the file is saved (Hyprland reloads it by itself — no `hyprctl reload`) and GDK_SCALE for apps started afterwards — the manual's 4K/1080p edit and its "huge apps" troubleshooting fix; the test records which step (save / app restart / re-login) the GDK change needed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `grep omarchy_ ~/.config/hypr/monitors.lua; echo $GDK_SCALE` Return → `local omarchy_monitor_scale = "auto"`, `local omarchy_gdk_scale = 2`, and `2`.
  * Open Obsidian from the launcher (Super+Space, type `Obsidian`, Return; allow 15 s, software rendering). Screenshot its window; note the size of its text and buttons against the bar (oversized at 1× with GDK_SCALE=2 is expected, not a bug). Close it with Super+W.
  * Press Super+Space → Setup → Monitors: Neovim opens monitors.lua. Type `:%s/omarchy_monitor_scale = "auto"/omarchy_monitor_scale = 2/` Return, then `:wq` Return.
  * Within 15 s and with no further command everything is drawn at 2× (bar twice as tall, large text) — that is the assertion. Type `hyprctl monitors -j | jq '.[0].scale'` Return → 2.
  ** Only if nothing changed after 15 s, type `hyprctl reload` to continue and report the missing auto-reload as a failure.
  * Type `sed -i 's/^local omarchy_monitor_scale = .*/local omarchy_monitor_scale = 1/; s/^local omarchy_gdk_scale = .*/local omarchy_gdk_scale = 1/' ~/.config/hypr/monitors.lua && hyprctl reload && hyprctl monitors -j | jq '.[0].scale'` Return → 1, normal size.
  * Press Super+Return for a NEW terminal and type `echo $GDK_SCALE` Return; record `1` or `2`. Open Obsidian again (or Nautilus with Super+Shift+F) and screenshot: its UI should be about half the size.
  ** If unchanged, log out (Super+Escape → Logout), log in at SDDM with `prime`, open Obsidian and screenshot; record that a re-login was required (the manual says only "restart the app").
  * Restore: `omarchy-refresh-config hypr/monitors.lua && hyprctl reload && rm -f ~/.config/hypr/monitors.lua.bak.*` — back to `"auto"` / `2`. Close everything.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hl.env` values reach processes started after the reload only. Obsidian is preinstalled (Electron); Print Settings (GTK3) or Nautilus is a fallback. Electron GPU warnings in the journal are not failures.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot at 2× within 15 s of `:wq` with no command typed in between and jq printing 2, then at 1× with jq printing 1; before/after screenshots of the same app window at visibly different UI sizes with `echo $GDK_SCALE` and a note on which step (save / app restart / re-login) the GDK change needed
  * If unsuccessful
  ** a red Hyprland error bar, the scale unchanged 15 s after saving (auto-reload did not fire), no size change even after re-login, or the app failing to start after the edit; `cat ~/.config/hypr/monitors.lua`; `hyprctl getoption misc:disable_autoreload`; `./client get-serial`
covers: config/hypr/monitors.lua; default/omarchy/omarchy-menu.jsonc setup.monitors; manual/33-monitors.md (fractional scaling / 1x scaling); manual/45:9
merged-from: 12:monitors-lua-scale-edit-applies; 13:gdk-scale-setting-shrinks-oversized-apps

### monitors-lua-bogus-mode-falls-back   [VM-OK]
description: A live mode change on the virtio display applies and reverts cleanly, and a monitors.lua rule naming a mode the display lacks must not blank the screen: Hyprland falls back to the preferred mode, the desktop stays usable, and the stock rule is restored from Update → Config → Hyprland.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `lspci -k | grep -A2 -i 'vga\|display'; hyprctl monitors | grep -E 'Monitor|@|scale'` Return → a Virtio GPU on `virtio-pci`, one monitor `Virtual-1`, mode 1280x800@…, `scale: 1.00`.
  * Type `hyprctl keyword monitor Virtual-1,1600x900@60,0x0,1` Return: the desktop re-lays out and the bar spans the new width; `hyprctl monitors | grep '@'` → `1600x900`. Type `hyprctl keyword monitor Virtual-1,12345x6789@60,0x0,1` Return: Hyprland refuses or falls back; the screen stays usable — record the message. Type `hyprctl reload` Return: the preferred 1280x800 mode returns.
  * Type `printf '%s\n' 'hl.monitor({ output = "Virtual-1", mode = "9999x9999@60", position = "auto", scale = 1 })' >> ~/.config/hypr/monitors.lua && hyprctl reload` Return (users mistype resolutions; this is the safe-failure path).
  * The screen stays on at the same size. Re-run the grep, and `hyprctl monitors -j | jq -r '.[0] | "\(.width)x\(.height)@\(.refreshRate)"'`: still 1280x800 (Hyprland fell back to the preferred mode). Record any banner or notification about the invalid mode; `journalctl --user -b --no-pager 2>/dev/null | grep -i -m3 'invalid mode\|falling back\|9999' | sudo tee /dev/ttyS0` may show the fallback message (optional).
  * Press Super+Space → Update → Config → Hyprland to restore the stock file: the floating terminal prints "Replaced /home/prime/.config/hypr/monitors.lua with new Omarchy default. Saved backup as …monitors.lua.bak.<epoch>" with the diff; press a key on Done. The mode is unchanged and no banner remains.
  * Type `rm ~/.config/hypr/*.bak.*` Return; close the terminal; the desktop looks as it started.
  ** If the output is not Virtual-1, substitute the real name. If the screen does blank for more than 5 s, keep screenshotting and type `hyprctl reload<ENTER>` blind; if that fails use Ctrl+Alt+F3, log in as prime, run `omarchy-refresh-hyprland` (or `mv ~/.config/hypr/monitors.lua ~/broken.lua && cp /usr/share/omarchy/config/hypr/monitors.lua ~/.config/hypr/`), `hyprctl -i 0 reload`, Ctrl+Alt+F1/F2 — and report the blackout duration as a failure.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Omarchy Menu → Setup → Monitors opens the file in the editor if you prefer editing there. Never add a rule that disables Virtual-1 here; that is the TTY-recovery test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of lspci/hyprctl, the desktop at 1600x900, the refused bogus keyword, the desktop intact after the 9999x9999 rule with the mode line unchanged and the recorded error text, the restore diff, and the restored desktop
  * If unsuccessful
  ** Hyprland crashing on a mode change, an unrecovered black or garbled screen, or no `Virtual-1`; serial log
covers: config/hypr/monitors.lua:10-11; bin/omarchy-hyprland-monitor-modeless; bin/omarchy-hyprland-monitor-watch; test/shell.d/monitor-recovery-test.sh; manual/33:5-16,41 (33-monitors.md, Arranging multiple screens / hl.monitor entries); manual/49 (gap: no QEMU guidance)
merged-from: 40:hypr-monitors-lua-bogus-mode-falls-back; 13:vm-guest-virtio-display-and-resolution-change; 12:monitors-lua-invalid-mode-falls-back

### hypr-config-syntax-error-banner-and-menu-restore   [VM-OK]
description: A syntax error in a user Hyprland file must not take the desktop down: a red error banner appears, the default chords keep working, modules loaded after the broken file (toggles) are skipped on that reload, and Update → Config → Hyprland puts the shipped file back with a `.bak.<epoch>` copy so a reload clears the banner and re-applies them — the "I made a mess" recovery path the manual promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and Super+Shift+Backspace so gaps are off (a toggle sourced *after* bindings.lua in the load order).
  * Type `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Broken"' >> ~/.config/hypr/bindings.lua` Return (an unclosed call) and wait two seconds: a red config-error banner appears at the top of the screen.
  ** Hyprland reloads the saved file itself; only if no banner appears within 15 s type `hyprctl reload` to continue and report the missing auto-reload as a failure.
  * Type `hyprctl configerrors | sudo tee /dev/ttyS0` Return: the text names `bindings.lua` and a syntax error (e.g. "unexpected symbol"); read it with get-serial.
  * Press Super+Return: a terminal still opens (bindings from the last good config remain). Press Super+Shift+R: nothing. Look at the gaps: record whether they came back (expected: the no-gaps toggle was skipped on this reload, so gaps are visible again). The bar, terminal and mouse keep working; the display does not go black.
  * Press Super+Space → Update → Config → Hyprland: the floating terminal prints "Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default. Saved backup as …bindings.lua.bak.<epoch>" (ten digits) plus the diff showing the broken line; the other six files are rewritten silently with no backup (identical). "● Done!" — press a key. Within a few seconds the banner disappears on its own and the windows are gapless again (Hyprland reloads the rewritten file itself).
  ** Only if the banner lingers past 15 s type `hyprctl reload` and report the missing auto-reload. The same holds for any of the seven user files: a broken monitors.lua (`echo 'hl.monitor({ output = "", mode = "preferred"' >> ~/.config/hypr/monitors.lua`) gives the same banner mentioning monitors.lua and the same menu restore.
  * Press Super+Shift+Backspace to restore gaps; type `ls ~/.local/state/omarchy/toggles/hypr/; ls ~/.config/hypr/*.bak.*` Return → only `flags.lua`, and the bindings backup — remove it with `rm ~/.config/hypr/*.bak.*`. Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The banner is Hyprland's own red strip; it is only suppressed while the package reload guard is active, which is not the case here.
  * If the screen goes black or the compositor restarts, capture `get-serial`, try `<C-A-F3>` to check the system is alive, and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the banner with the desktop still usable behind it, the configerrors text, a terminal opening while broken, the gaps state while broken, the Update → Config → Hyprland diff, the clean gapless state after the fix, and only flags.lua at the end
  * If unsuccessful
  ** No banner with a silently ignored file, dead chords while broken, the banner persisting after restore, or a compositor crash / black screen with the serial log
covers: config/hypr/hyprland.lua:19-26; default/hypr/bootstrap.lua; bin/omarchy-hyprland-reload-guard (suppress_errors); default/agents/skills/omarchy/hyprland.md:22-25; config/hypr/monitors.lua; bin/omarchy-refresh-hyprland; default/omarchy/omarchy-menu.jsonc update.config.hyprland; manual/31-dotfiles.md (Resetting any changes); manual/42-common-tweaks.md (restore individual configs)
merged-from: 40:hypr-user-config-syntax-error-banner; 12:monitors-lua-syntax-error-recovers

### hypr-tty-recovery-disabled-output-and-no-default-bindings   [VM-PARTIAL]
description: When a user locks themselves out of the desktop — `omarchy_default_bindings = false` removes every Omarchy chord including Super+Return and Super+K, or disabling the only output in monitors.lua (the manual's phantom-display recipe on the wrong output) blanks the screen and is deliberately not auto-recovered — they can fix it from a text console with `omarchy-refresh-hyprland` / `hyprctl -i 0 reload`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `sed -i 's/^-- omarchy_default_bindings = false/omarchy_default_bindings = false/' ~/.config/hypr/hyprland.lua && hyprctl reload` Return.
  * Press Super+Return, Super+K, Super+Space: nothing happens (every Omarchy chord is gone). Click the Omarchy icon in the bar: the menu still opens with the mouse. Escape.
  * Press Ctrl+Alt+F3 and log in as prime / prime. Type `omarchy-refresh-hyprland` Return: it prints that it replaced `hyprland.lua` and saved a `.bak.<epoch>` copy, with the diff. Type `hyprctl -i 0 reload` Return (or `HYPRLAND_INSTANCE_SIGNATURE=$(ls /run/user/1000/hypr | head -1) hyprctl reload`), then press Ctrl+Alt+F1 (or F2 if the session is on tty2). Press Super+Return: a terminal opens again.
  * In it type `printf '%s\n' 'hl.monitor({ output = "Virtual-1", disabled = true })' >> ~/.config/hypr/monitors.lua` Return; screenshot; then `hyprctl reload` Return.
  * The screen goes black. Wait 20 s taking screenshots: it stays black (monitors disabled on purpose are not recovered by the monitor watcher).
  * Press Ctrl+Alt+F3 (log in again if asked). Type `hyprctl -i 0 monitors all | grep -E 'Monitor|disabled'` Return → `disabled: true`. Type `sed -i '$d' ~/.config/hypr/monitors.lua && hyprctl -i 0 reload` Return, then Ctrl+Alt+F1 (or F2): the desktop is back with the terminal still open.
  * Type `rm ~/.config/hypr/*.bak.*` Return; close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: a custom minimal binding set (the flag's intended use) and disabling a secondary phantom output (the documented use) — no second output.
  * If the VT does not switch back or login fails, end with `stop` and report; the disk is discarded.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of dead chords with the mouse menu still working, the TTY with the refresh output naming the .bak file, the desktop with Super+Return working again, the black screen, the TTY showing `disabled: true`, and the restored desktop
  * If unsuccessful
  ** Serial log and screenshot of a black screen or a session that did not return; the TTY output if the reload did not bring the output back
covers: config/hypr/hyprland.lua:6-7; default/hypr/omarchy.lua:8-15; bin/omarchy-refresh-hyprland; test/shell.d/hyprland-default-config-test.sh:141-145; manual/42:5; config/hypr/monitors.lua; bin/omarchy-hyprland-monitor-modeless; manual/33:53
merged-from: 40:hypr-default-bindings-disabled-tty-recovery; 40:hypr-monitors-lua-disabled-output-tty-recovery

### bindings-lua-override-add-rebind-unbind   [VM-OK]
description: The three documented override forms in ~/.config/hypr/bindings.lua — `o.bind` adds a chord, `o.rebind` replaces a default's action, `hl.unbind` removes one — take effect on save without touching package files (Hyprland reloads the file itself; Setup → Keybindings opens the same file in the editor), Super+K and `--print` show the result, a syntax error is reported by `hyprctl configerrors` while the desktop keeps working, and Update → Config → Hyprland puts the defaults back; this is the manual's and the shipped agent skill's canonical way to customise keys.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `omarchy menu keybindings --print | grep 'SUPER + SHIFT + F'` Return → the row `SUPER + SHIFT + F → File manager`. Type `cp ~/.config/hypr/bindings.lua /tmp/bindings.bak` Return.
  * Type `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Override probe", "omarchy-notification-send \"Probe binding works\"")' 'o.rebind("SUPER + SHIFT + F", "File manager", { launch = "foot --title REBOUND-FILES" })' 'hl.unbind("SUPER + SHIFT + B")' >> ~/.config/hypr/bindings.lua` Return; wait two seconds (Hyprland reloads user files on save by itself — no `hyprctl reload`). No red banner may appear; `hyprctl configerrors` prints nothing.
  ** Only if nothing changed after 15 s, type `hyprctl reload` to continue and report the missing auto-reload as a failure.
  * Press Super+Shift+R: a notification "Probe binding works" appears (o.bind added a chord). Press Super+Shift+F: a terminal titled REBOUND-FILES opens instead of Nautilus (o.rebind replaced the default's action). Press Super+Shift+B: nothing opens within five seconds; press Super+Shift+Return: the browser still opens (only the alias was unbound). Close both.
  * Press Super+K and type `Probe`: rows `SUPER + SHIFT + R → Override probe` and `SUPER + SHIFT + F → File manager` exist and `SUPER + SHIFT + B` has none. Escape. `omarchy menu keybindings --print | grep 'SUPER + SHIFT + F'` → the same row, now pointing at the rebound launch.
  * Unhappy path: type `printf '\no.bind(\n' >> ~/.config/hypr/bindings.lua; hyprctl reload; hyprctl configerrors` Return → an error naming bindings.lua (Lua syntax); the bar and windows still work — the defaults keep working while looknfeel/autostart/toggles are skipped until fixed.
  * Restore from the menu: Super+Space → Update → Config → Hyprland: the floating terminal prints "Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default. Saved backup as …bindings.lua.bak.<epoch>" (ten digits) with a diff of your lines (only bindings.lua is reported; the other six files are rewritten identical with no backup). Press a key on Done; within a few seconds `hyprctl configerrors` → empty with no reload command typed.
  * Press Super+Shift+F: Nautilus opens again (close it with Super+W); Super+Shift+B opens the browser (close it); Super+Shift+R gives no notification. Type `rm -f ~/.config/hypr/*.bak.* /tmp/bindings.bak` Return and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Omarchy Menu → Setup → Keybindings opens the same file in the editor. Window titles show in `hyprctl activewindow` if the title bar is not visible. Nautilus takes a couple of seconds on first launch; take a second screenshot before concluding.
  * `--print` writes the keybinding list to the terminal instead of opening the viewer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the probe notification, REBOUND-FILES, nothing after Super+Shift+B, the browser after Super+Shift+Return, the Super+K rows and the `--print` row before and after, `hyprctl configerrors` reporting the injected error then empty after restore, the Update → Config → Hyprland diff, and Nautilus and the browser back afterwards
  * If unsuccessful
  ** A red banner after the append, Nautilus opening despite the rebind, or a missing notification; `tail -5 ~/.config/hypr/bindings.lua`, `hyprctl configerrors`, `./client get-serial`
covers: config/hypr/bindings.lua:1-23; default/hypr/helpers.lua:92-111 (o.bind/o.rebind); test/shell.d/hyprland-binding-conflicts-test.sh:199-211; manual/07:127; manual/31-dotfiles.md (Changing internal Omarchy files / o.rebind); bin/omarchy-refresh-hyprland; bin/omarchy-refresh-config; default/agents/skills/omarchy/hyprland.md §Keybindings; SKILL.md §Edit User Config Directly, §Example Requests; .luarc.json
merged-from: 40:hypr-user-binding-override-takes-effect; 12:bindings-lua-add-unbind-rebind; 61:agent-skill-hyprland-rebind

### keybindings-print-readable-and-refreshes-cache   [VM-OK]
description: `omarchy-menu-keybindings --print` lists every described binding once with readable keys (no raw `code:`/`__lua` rows) and refreshes its cache when the bind set changes, so the cheat sheet never goes stale after a user edit.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `omarchy-menu-keybindings --print | sudo tee /dev/ttyS0 | wc -l` Return (about 180–230 rows); read the list from the serial log.
  * The list contains `SUPER + RETURN` → Terminal, `SUPER + SHIFT + A` → ChatGPT, `SUPER + CTRL + L` → Lock system, `XF86AudioRaiseVolume` → Volume up, `SUPER + 1` … `SUPER + 0` switch rows, `SUPER + W / SUPER + Q → Close window`, `SUPER + S / SUPER + ~ → Toggle scratchpad`, and no line containing `code:` or `__lua`.
  * Type `ls ~/.cache/omarchy/ | grep -c keybindings-` Return → 1.
  * Type `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Probe SSH", "foot")' >> ~/.config/hypr/bindings.lua && hyprctl reload && omarchy-menu-keybindings --print | grep -F 'Probe SSH'` Return → the new row; `ls ~/.cache/omarchy/ | grep -c keybindings-` → still 1 (old cache replaced).
  * Type `sed -i '$d' ~/.config/hypr/bindings.lua && hyprctl reload && omarchy-menu-keybindings --print | grep -c 'Probe SSH'` Return → 0. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list is long; the serial log is the way to read it. HEAD-only chords (zoom, tiled fullscreen, grave aliases) may be missing on the 4.0.2 mint — report absent rows, not failures.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with the named rows and no `code:`/`__lua`; the single cache file; the Probe SSH row appearing then gone
  * If unsuccessful
  ** Raw `code:`/`__lua` rows, a stale list after the reload, or multiple cache files
covers: bin/omarchy-menu-keybindings:511-574; config/hypr/bindings.lua:4-5
merged-from: 40:hypr-keybindings-print-matches-config

### default-bindings-no-duplicate-chords   [VM-OK]
description: No two default bindings claim the same chord (only Alt+Tab / Alt+Shift+Tab are stacked on purpose), the essentials and preinstalled web-app chords are bound, and exactly nine SUPER+CTRL+<digit> chords open bar panels.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `hyprctl -j binds | jq -r '.[] | select(.submap=="") | [(.modmask|tostring), (if .keycode>0 then ("code:"+(.keycode|tostring)) else (.key|ascii_upcase) end), (.release|tostring)] | join("+")' | sort | uniq -d | sudo tee /dev/ttyS0` Return — the serial output holds at most the Alt+Tab stack (`8+TAB+false`, `9+TAB+false`).
  * Type `hyprctl -j binds | jq -r '.[] | select(.description=="Terminal" or .description=="ChatGPT") | .description+"="+.key'` Return — `Terminal=RETURN` and `ChatGPT=A`.
  * Type `hyprctl -j binds | jq -r '.[] | select(.description|startswith("Bar panel")) | .description' | sort -u | wc -l` Return — `9`.
  * Press Super+Ctrl+3 — the third right-section bar panel (Display on this VM: Network / Audio / Display are 1/2/3) opens; press it again — it closes.
  * Press Super+Return for a second window, then Alt+Tab — the other window is raised (the stacked pair works). Close both terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * modmask 64 = SUPER, 8 = ALT, 9 = ALT+SHIFT, 4 = CTRL; any `64+…` line in the duplicate list is a real conflict.
  * Bar panel numbers are HEAD-only and may be absent on the 4.0.2 mint; count the right-section icons on the screenshot first, and report "absent on this build" if `Bar panel` rows are missing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with only the Alt+Tab pair; `Terminal=RETURN`, `ChatGPT=A`; `9`; a panel toggling on Super+Ctrl+3; the raised window after Alt+Tab
  * If unsuccessful
  ** The duplicated chord lines with their descriptions
covers: test/shell.d/hyprland-binding-conflicts-test.sh; test/shell.d/hyprland-default-config-test.sh (essentials, ChatGPT, nine panel hotkeys); default/hypr/bindings/*.lua
merged-from: 51:hyprland-bindings-no-duplicate-chords

### reload-guard-pause-resume   [VM-OK]
description: Omarchy pauses Hyprland's config auto-reload and error banner for the length of a package transaction and then forces exactly one reload with the previous settings restored, so an update never flashes a half-written config; `paused` reports the state, and bad or redundant calls are harmless.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `hyprctl getoption misc:disable_autoreload; omarchy-hyprland-reload-guard paused; echo paused=$?` Return → `bool: false` (int 0) and `paused=1` (not paused; `paused` needs no sudo).
  * Type `sudo omarchy-hyprland-reload-guard pause` Return (password `prime`) → silent. Type `hyprctl getoption misc:disable_autoreload; hyprctl getoption debug:suppress_errors; omarchy-hyprland-reload-guard paused; echo paused=$?; sudo ls /run/omarchy/hyprland-reload-guard/` Return → both `bool: true`, `paused=0`, one file named like the Hyprland instance signature.
  * Type `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Guard probe", "foot --title GUARD-PROBE")' >> ~/.config/hypr/bindings.lua` Return; wait three seconds; press Super+Shift+R: nothing opens (auto-reload is paused).
  * Type `sudo omarchy-hyprland-reload-guard resume` Return: the desktop may redraw once (bar/borders), and only once. Press Super+Shift+R: GUARD-PROBE opens (resume performed exactly one reload that applied the edit); close it. Re-run the check → both `bool: false`, `paused=1`, and the state dir is gone.
  * Negatives: `omarchy-hyprland-reload-guard; echo "exit=$?"` → usage, exit=1; `sudo omarchy-hyprland-reload-guard bogus; echo "exit=$?"` → usage line, exit=1; `omarchy-hyprland-reload-guard resume; echo "exit=$?"` (unprivileged, nothing paused) → 0 silently; `sudo omarchy-hyprland-reload-guard resume` a second time prints nothing and changes nothing.
  * Type `sed -i '$d' ~/.config/hypr/bindings.lua && hyprctl reload` Return; close the terminals — the machine is back exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Root is needed because the guard's state lives under `/run/omarchy`; `sudo` asks for `prime` unless passwordless sudo is set up. Read the `bool:`/`int:` line of `getoption`; `set:` may say false and is irrelevant.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `bool: false`/`paused=1` → `pause` → `bool: true`×2/`paused=0` with the state file → nothing on Super+Shift+R while paused → `resume` with at most one visible redraw → GUARD-PROBE → `bool: false`×2/`paused=1`; the usage errors and the silent unprivileged resume
  * If unsuccessful
  ** Options not flipped, the bind applying while paused, or no reload on resume; `sudo ls -la /run/omarchy/hyprland-reload-guard/`; `journalctl -b --no-pager | grep -i reload-guard | sudo tee /dev/ttyS0`
covers: bin/omarchy-hyprland-reload-guard; test/shell.d/hyprland-reload-guard-test.sh; default/libalpm/hooks/10-omarchy-hyprland-reload-pause.hook; default/libalpm/hooks/90-omarchy-hyprland-reload-resume.hook; docs/update-process.md
merged-from: 40:hypr-reload-guard-pauses-autoreload; 25:reload-guard-pause-resume; 51:reload-guard-pause-resume

### keyboard-layout-switch-both-alts   [VM-OK]
description: Two keyboard layouts configured in ~/.config/hypr/input.lua (with `grp:alts_toggle`, via Setup → Input) show the layout indicator in the bar and switch when both Alts are pressed, so Danish letters come out of the same keys while Super chords keep working; a bogus layout name is refused without breaking typing, and `omarchy-refresh-config` restores the file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and screenshot: the bar centre has no layout indicator with a single layout.
  * Press Super+Space → Setup → Input; in Neovim press `G`, `o` and type `hl.config({ input = { kb_layout = "us,dk", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })`, Escape, `:wq` Return. Within 15 s and with no further command a small layout indicator (`us`/`EN`) appears in the bar centre beside the clock (Hyprland reloads the saved file itself).
  ** Only if nothing changed after 15 s type `hyprctl reload` to continue and report the missing auto-reload as a failure.
  * In the terminal type `;'[` and press Space: the US layout prints `;'[`. Press Left Alt and Right Alt together (one chord): the indicator changes to `dk`/`DA`. Type `;'[` again: the Danish layout prints `æøå`.
  * Press Super+Return while on the Danish layout: a terminal still opens (Super chords keep working because a Latin layout stays first). Close it.
  * Press both Alts again: indicator back to `us`/`EN`; `;'[` prints `;'[` once more.
  * Unhappy path: type `echo 'hl.config({ input = { kb_layout = "xx" } })' >> ~/.config/hypr/input.lua && hyprctl reload` Return: a red error banner or `hyprctl configerrors` text names the bad keymap/xkb layout (it falls back to US); typing `echo ok` still works and prints ok.
  * Restore: `omarchy-refresh-config hypr/input.lua && hyprctl reload && rm -f ~/.config/hypr/input.lua.bak.*` Return — the error bar and the layout indicator both disappear; `;'[` prints `;'[`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The both-Alts chord is one send-keys token: `<A-alt_r>`. Tap it once per switch. The indicator widget only exists while more than one layout is configured.
  * `omarchy-refresh-config` writes the old file to `input.lua.bak.<epoch>`; that is the expected backup name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar without and with the layout indicator, the terminal line showing `;'[` under us and `æøå` under dk, a terminal opening while on DA, the indicator flipping back, the config error for `xx` with the terminal still typing, and the clean bar after restore
  * If unsuccessful
  ** The indicator not changing, `;'[` printed under dk, Super+Return failing while switched, or the error bar persisting after restore; `cat ~/.config/hypr/input.lua | sudo tee /dev/ttyS0` and `./client get-serial`
covers: config/hypr/input.lua:6-11; default/hypr/input.lua:26-62; default/omarchy/omarchy-menu.jsonc setup.input; config/omarchy/shell.json (omarchy.keyboard-layout); bin/omarchy-refresh-config; test/shell.d/hyprland-keyboard-layout-test.sh; test/shell.d/keyboard-layout-test.sh; manual/34-keyboard-mouse-trackpad.md:1-38 (multiple keyboard layouts, grp:alts_toggle)
merged-from: 12:input-lua-layout-switch-both-alts; 40:hypr-input-keyboard-layout-switch

### input-lua-repeat-rate-and-compose-override   [VM-OK]
description: Omarchy's input defaults (repeat 40/250, numlock on, follow-mouse, CapsLock compose options) are live, a user override in ~/.config/hypr/input.lua (via Setup → Input) replaces them as soon as the file is saved and reverts when the file is refreshed, and a wrongly typed value does not break input. The manual quotes Hyprland's stock 25/600 repeat values; the shipped default is 40/250, which is what this test asserts.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `for o in repeat_rate repeat_delay numlock_by_default follow_mouse kb_options; do hyprctl getoption input:$o | head -2; done | sudo tee /dev/ttyS0` Return → 40, 250, true, 1, `compose:caps,shift:both_capslock_cancel`.
  * Press Super+Space → Setup → Input; in Neovim go to the end (`G`) and append with `o`: `hl.config({ input = { repeat_rate = 60, repeat_delay = 200, kb_options = "compose:ralt" } })`, Escape, `:wq` Return. Wait a few seconds (Hyprland reloads the saved file itself), then run the same loop → 60, 200, `compose:ralt`.
  ** Only if the values are unchanged 15 s after saving, type `hyprctl reload` to continue and report the missing auto-reload as a failure.
  * Type `cat` Return, then send a long run of `a` characters and watch them appear; the getoption values, not the visible speed, are the assertion. Press Ctrl+C.
  * Unhappy path: type `echo 'hl.config({ input = { repeat_rate = "fast" } })' >> ~/.config/hypr/input.lua && hyprctl reload` Return: Hyprland shows a config error bar (type mismatch) or silently ignores the value; `hyprctl getoption input:repeat_rate | head -1` must still be a number (60). Record which.
  * Restore: `omarchy-refresh-config hypr/input.lua && hyprctl reload && rm -f ~/.config/hypr/input.lua.bak.*` Return; the loop shows the defaults again (40/250/true/1/compose:caps,…). Close the terminal; input.lua is back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hyprctl getoption` prints "int: N" / "str: value" lines followed by "set: true". There is no held-key verb in the client; the repeat rate is proven by getoption.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial/screenshot values 40/250/true/1/compose options, then 60/200/compose:ralt, the bad-value outcome (error bar or ignored), then the defaults again
  * If unsuccessful
  ** Values unchanged after reload or a persistent error bar; `cat ~/.config/hypr/input.lua`; `./client get-serial`
covers: default/hypr/input.lua:50-75; config/hypr/input.lua:1-45; default/omarchy/omarchy-menu.jsonc setup.input; manual/34-keyboard-mouse-trackpad.md:6-38 (input.lua example, compose key)
merged-from: 40:hypr-input-defaults-and-override; 12:input-lua-repeat-rate-and-compose-option

### xcompose-compose-key-sequences-restart-and-legacy-repair   [VM-OK]
description: CapsLock is the compose key and no longer shifts letters (the troubleshooting answer to "Caps Lock isn't working"): it types the stock quick-emoji sequences (😄, ❤️, 👍, 💯, the em dash, the installer name) in the terminal and the browser while an undefined sequence types nothing special; a sequence added to ~/.XCompose only works after `omarchy-restart-xcompose` (which Setup → Config → XCompose runs for you when the editor closes), removing it makes the keys plain letters again, and a legacy file still including the Omarchy 3 checkout path is repointed by the migration with the user's sequences kept.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `systemctl --user is-active omarchy-fcitx5.service; head -4 ~/.XCompose` Return → `active`, and the file shows `include "%L"` and `<Multi_key> <m> <s> : "😄"`.
  * Type `echo "` then tap CapsLock, `m`, `s` — three separate key presses, not a chord — then `"` Return: the line echoes 😄, not `ms` (CapsLock is the compose key, not caps lock; there is no Caps Lock OSD).
  ** The very first compose after login can take a second while the input method warms up; if nothing appears, wait two seconds and try once more.
  * Repeat the same way: CapsLock `m` `h` → ❤️; CapsLock `space` `space` → an em dash `—`; CapsLock `m` `y` → 👍; CapsLock `m` `1` → 💯; CapsLock `space` `n` → the name entered at install (may be empty; record). Unhappy path: CapsLock `m` `z` (undefined) → no emoji (empty or the plain letters), no crash. Type `echo caps-test` Return: it prints in lower case (CapsLock did not toggle capitals).
  ** Press Super+Shift+Return, click Chromium's address bar, tap CapsLock `m` `h` → ❤️ appears there too (compose works outside the terminal). Press Super+W.
  * Type `echo '<Multi_key> <q> <q> : "COMPOSE-PROBE"' >> ~/.XCompose` Return, then tap CapsLock and type `qq`.
  ** Unhappy path: plain `qq` appears — fcitx5 has not re-read the file. This is the quirk the manual warns about. Press Backspace twice.
  * Type `omarchy-restart-xcompose` Return (returns quietly in a second or two), then tap CapsLock and type `qq`: `COMPOSE-PROBE` appears at the prompt.
  * Press Super+Space → Setup → Config → XCompose: notification "Editing config file ~/.XCompose"; Neovim shows the file with your line at the end. Delete that line (`G`, `dd`) and `:wq` — this menu entry restarts fcitx5 when the editor closes (one of the two config entries that really chain a restart).
  * Tap CapsLock and type `qq`: plain `qq` again (sequence gone), while CapsLock `ms` still gives 😄.
  * Legacy repair: type `cp ~/.XCompose /tmp/xcompose.orig 2>/dev/null; printf '%s\n' '# Include fast emoji access' 'include "%%H/.local/share/omarchy/default/xcompose"' '' '<Multi_key> <space> <n> : "Test User"' > ~/.XCompose` Return, then `bash /usr/share/omarchy/migrations/1788102906.sh; cat ~/.XCompose` → the include reads `include "/usr/share/omarchy/default/xcompose"` and the `Test User` line is still there. `sha256sum ~/.XCompose; bash /usr/share/omarchy/migrations/1788102906.sh; sha256sum ~/.XCompose` → identical (idempotent). `rm ~/.XCompose; bash /usr/share/omarchy/migrations/1788102906.sh; ls ~/.XCompose 2>&1` → not created.
  * Type `cp /tmp/xcompose.orig ~/.XCompose 2>/dev/null; rm -f /tmp/xcompose.orig; omarchy-restart-xcompose` Return — stock file back. Tap CapsLock then `o` then `c`: `©` appears; press Backspace. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send CapsLock as a bare `<CAPSLOCK>` tap followed by the letters as literal text; do not hold it. A shift-tap cancels an accidental caps state (both Shifts toggle caps).
  * The emoji renders as a colour glyph in foot; a hollow box means the font fell back but the compose still fired. If letters appear instead of emoji at the very first step, fcitx5 is not running: `pgrep -a fcitx5` / `systemctl --user is-active omarchy-fcitx5.service` and report. `%%H` in printf becomes the literal `%H` the legacy file contained.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `active` and the `head -4` lines, each echoed emoji/dash/name line, the undefined sequence producing no emoji, `caps-test` in lower case, ❤️ in the browser address bar, plain `qq` before the restart, `COMPOSE-PROBE` after `omarchy-restart-xcompose`, the editor with the line removed, plain `qq` with 😄 still working, the repointed include with the custom line, identical hashes, no file created from nothing, and `©` composed at the end
  * If unsuccessful
  ** Plain letters where emoji were expected, uppercase `CAPS-TEST` (Caps Lock still toggles), the prompt showing plain letters after the restart, the custom line lost or the include unchanged; `systemctl --user status omarchy-fcitx5.service | sudo tee /dev/ttyS0` and `./client get-serial`
covers: manual/31-dotfiles.md (~/.XCompose, omarchy-restart-xcompose); manual/34-keyboard-mouse-trackpad.md (CapsLock compose key); manual/07-hotkeys.md:336-374 (quick emojis); manual/45:15-23; default/omarchy/omarchy-menu.jsonc setup.config.xcompose; bin/omarchy-restart-xcompose; install/user/xcompose.sh; default/xcompose; default/hypr/input.lua:37; default/systemd/user/omarchy-fcitx5.service; default/environment.d/10-omarchy-fcitx.conf; migrations/1788102906.sh; test/shell.d/legacy-power-udev-rules-migration-test.sh (XCompose half)
merged-from: 12:xcompose-add-sequence-and-restart; 51:xcompose-legacy-include-repair; 10:xcompose-quick-emoji-and-completion; 13:capslock-is-compose-key; 41:xcompose-emoji-sequences

### looknfeel-lua-overrides-rounding-gaps-animations   [VM-OK]
description: The commented examples in ~/.config/hypr/looknfeel.lua (opened by Style → Hyprland) work when enabled — rounded corners with dimmed inactive windows, zero gaps and borders, animations off — each applying as soon as the file is saved and each reversible, an unbalanced uncomment gives the red banner, and Update → Config → Hyprland reverts them. These are the tweaks the Common Tweaks chapter spells out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice; note square corners, gaps and 2 px borders. Type `hyprctl getoption decoration:rounding | head -1; hyprctl getoption general:gaps_out | head -1` Return → int: 0 and a non-zero value.
  * Press Super+Space → Style → Hyprland: Neovim opens ~/.config/hypr/looknfeel.lua. Uncomment the rounding block — `:17,26s/^-- //` then `:wq` (lines 17–26 are the `hl.config({ decoration = { rounding = 8, dim_inactive …` block; if the numbers differ, remove the leading `-- ` from every line of that block by hand).
  * Within 15 s and with no further command corners are visibly rounded and the unfocused window is dimmed (dim_inactive is in the same block; Hyprland reloads the saved file itself); `hyprctl getoption decoration:rounding | head -1` → int: 8.
  ** Only if nothing changed after 15 s type `hyprctl reload` to continue and report the missing auto-reload as a failure.
  * Type `printf '%s\n' 'hl.config({ general = { gaps_in = 0, gaps_out = 0, border_size = 0 } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload` Return: windows touch each other and the screen edge with no border; `hyprctl getoption general:gaps_out | head -1` → 0.
  * Type `printf '%s\n' 'hl.config({ animations = { enabled = false } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload` Return; press Super+Return: the third terminal appears instantly with no pop-in.
  * Unhappy path: if a red config error bar appears after any edit, the uncomment was unbalanced — fix with `omarchy-refresh-config hypr/looknfeel.lua && hyprctl reload` and report the exact lines.
  * Restore: Super+Space → Update → Config → Hyprland → the diff shows your changes → Done; `hyprctl reload`: corners square, gaps, borders and animations back; `rm -f ~/.config/hypr/*.bak.*`. Close the terminals with Ctrl+Alt+Delete.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shipped file has each option block wrapped in `-- hl.config({ … -- })`; every line of a block must lose exactly the `-- ` prefix.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of square/gapped windows, rounded corners with the dimmed neighbour and getoption 8, gapless/borderless windows with gaps_out 0, the instant third terminal, the Update → Config → Hyprland diff, and the stock look restored
  * If unsuccessful
  ** A config error bar with the file contents (`cat ~/.config/hypr/looknfeel.lua | sudo tee /dev/ttyS0`), or the look unchanged after reload; `./client get-serial`
covers: config/hypr/looknfeel.lua; default/hypr/looknfeel.lua:7-32,62-65; default/omarchy/omarchy-menu.jsonc:111 (style.hyprland); bin/omarchy-refresh-hyprland; manual/42:11-37 (Rounded window corners, Remove window gaps)
merged-from: 40:hypr-looknfeel-override-rounding-gaps; 12:looknfeel-rounding-and-no-gaps

### hyprsunset-config-edit-and-process-restart   [VM-OK]
description: Setup → Config → Hyprsunset opens hyprsunset.conf and restarts hyprsunset when the editor exits — hyprsunset does not watch its config, so this entry (with XCompose) runs an explicit restart where the other Hyprland files rely on Hyprland's own reload; that is how the manual's "any process that needs restarting will be restarted after you quit the editor" holds — and restarting hyprsunset from Update → Process relaunches it with the identity profile, which silently turns an active night light off.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `systemctl --user show -p ActiveEnterTimestamp omarchy-hyprsunset.service 2>/dev/null || systemctl --user list-units --no-pager | grep -i hyprsunset; pgrep -a hyprsunset` Return; record the timestamp/unit name and the PID (if no user unit exists, the PID is the proof).
  * Press Super+Space → Setup → Config → Hyprsunset: notification "Editing config file ~/.config/hypr/hyprsunset.conf"; Neovim opens the file. Press `G`, `o`, type `# probe edit`, Escape, `:wq` Return.
  * Rerun the status command: the ActiveEnterTimestamp is later than before (or the PID changed), proving a restart followed the editor. `grep -c 'probe edit' ~/.config/hypr/hyprsunset.conf` → 1.
  * Press Super+Ctrl+N: an orange tint over the whole screen and the night-light indicator in the bar. `pgrep -x hyprsunset` → a PID.
  * Press Super+Space → Update → Process → Hyprsunset: the tint disappears within ~2 s; `pgrep -x hyprsunset` → a different PID; `omarchy-toggle-nightlight --status` → enabled false (temperature 6000 or 6500); the indicator turns off after the shell's next refresh (wait a few seconds).
  * Type `omarchy-restart-app hyprsunset` Return → the PID changes again, the screen stays neutral. `omarchy-restart-hyprctl; echo "exit=$?"` → 0 (a plain reload, no visible change).
  * Restore: Super+Space → Update → Config → Hyprsunset → the floating terminal shows the Replaced… diff with the probe line and restarts the service; Done. `rm -f ~/.config/hypr/*.bak.*`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * hyprsunset may be run by omarchy-restart-app rather than a unit; the PID comparison is the fallback proof. The nightlight tint is visible in screenshots (Hyprland applies the CTM in its renderer).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the status/PID before and after the edit showing a restart, the edited file, the tinted screen with its indicator, the neutral screen after Update → Process with the new PID and the status JSON, and the Update → Config → Hyprsunset diff
  * If unsuccessful
  ** Identical timestamps/PIDs after quitting the editor; a screenshot still tinted with the new PID and `hyprctl hyprsunset temperature`; `./client get-serial`
covers: manual/31-dotfiles.md (any process that needs restarting…); default/omarchy/omarchy-menu.jsonc setup.config.hyprsunset, update.config.hyprsunset, update.process.hyprsunset; bin/omarchy-refresh-hyprsunset; bin/omarchy-restart-hyprsunset; bin/omarchy-restart-app; bin/omarchy-restart-hyprctl; bin/omarchy-toggle-nightlight
merged-from: 12:setup-config-hyprsunset-edit-restarts-service; 25:restart-hyprsunset-clears-nightlight

### hypr-session-environment-and-autostart   [VM-OK]
description: Apps started from a chord inherit the Hyprland-set environment (Wayland backends, cursor size, OMARCHY_PATH first on PATH, GDK_SCALE from monitors.lua, no NVIDIA variables on this machine) and the default autostart entries (shell, monitor watcher, udiskie) are alive and not duplicated by a reload.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `env | grep -E '^(XCURSOR_SIZE|HYPRCURSOR_SIZE|GDK_BACKEND|QT_QPA_PLATFORM|QT_QPA_PLATFORMTHEME|MOZ_ENABLE_WAYLAND|ELECTRON_OZONE_PLATFORM_HINT|OZONE_PLATFORM|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|XDG_SESSION_DESKTOP|XCOMPOSEFILE|OMARCHY_PATH|GDK_SCALE|NVD_BACKEND|LIBVA_DRIVER_NAME|__GLX_VENDOR_LIBRARY_NAME)=' | sort | sudo tee /dev/ttyS0` Return.
  * The serial log shows XCURSOR_SIZE=24, HYPRCURSOR_SIZE=24, GDK_BACKEND=wayland,x11,*, QT_QPA_PLATFORM=wayland;xcb, QT_QPA_PLATFORMTHEME=gtk3, MOZ_ENABLE_WAYLAND=1, ELECTRON_OZONE_PLATFORM_HINT=wayland, OZONE_PLATFORM=wayland, XDG_SESSION_TYPE=wayland, XDG_CURRENT_DESKTOP=Hyprland, XDG_SESSION_DESKTOP=Hyprland, XCOMPOSEFILE=/home/prime/.XCompose, OMARCHY_PATH=/usr/share/omarchy, GDK_SCALE=2 — and none of the three NVIDIA variables.
  * Type `echo $PATH | tr : '\n' | head -1` Return → `/usr/share/omarchy/bin`.
  * Type `pgrep -af 'omarchy-hyprland-monitor-watch|udiskie' | sudo tee /dev/ttyS0` Return: one monitor watcher and one `udiskie --automount --no-notify --no-tray`; the bar being on screen is the shell.
  * Type `hyprctl reload` Return and repeat the pgrep: identical PIDs, nothing duplicated.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal is spawned by Hyprland's exec so it sees exactly the `hl.env` set; nothing here changes state.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with the 14 variables at the expected values and no NVIDIA ones, the PATH head, the two processes before and after reload with the same PIDs
  * If unsuccessful
  ** A missing/different variable, a missing process, or duplicated PIDs after reload
covers: default/hypr/envs.lua; default/hypr/nvidia.lua; config/hypr/monitors.lua:21-22; default/hypr/autostart.lua; default/hypr/helpers.lua:117-125
merged-from: 40:hypr-session-environment-and-autostart

### autostart-lua-user-entry-runs-on-login   [VM-OK]
description: An `o.launch_on_start` line in ~/.config/hypr/autostart.lua runs at the next session start and not on a reload — the documented way to add a startup program. The re-login goes through Super+Escape → Logout and the SDDM greeter (about a minute; the LUKS passphrase is not asked again).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `printf '%s\n' 'o.launch_on_start("foot --title AUTOSTART-PROBE")' >> ~/.config/hypr/autostart.lua && hyprctl reload` Return; wait three seconds taking screenshots: no AUTOSTART-PROBE window appears (autostart runs on the `hyprland.start` event only).
  * Press Super+Escape → Logout. At SDDM (logo, lock glyph and a dotted entry — no user name field) type `prime` and Return.
  ** Logout closes all windows; finish typing before pressing Logout.
  * Within ~15 s of the desktop appearing a terminal titled AUTOSTART-PROBE is open.
  * In it type `hyprctl activewindow | grep title` Return → the AUTOSTART-PROBE title, then `sed -i '$d' ~/.config/hypr/autostart.lua && tail -1 ~/.config/hypr/autostart.lua` Return → the stock last line (the probe line is gone).
  * Unhappy path: type `hyprctl reload` Return: no second AUTOSTART-PROBE window appears (a reload never re-runs autostart).
  * Close the terminal; the desktop is empty and autostart.lua is stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The title shows in the bar's window title area or via `hyprctl activewindow | grep title` if the terminal has no title bar.
  * Wrong password at SDDM shows a red lock/entry cleared by the next keystroke; stay under five tries (faillock deny=10 is shared with the lock screen and sudo).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots proving no probe after the reload, the greeter/login, the AUTOSTART-PROBE terminal after login with its title line, the stock last line after the cleanup, and no second probe after the final reload
  * If unsuccessful
  ** The desktop after login without the probe window, or a probe window appearing on a plain reload; `cat ~/.config/hypr/autostart.lua`; `./client get-serial`
covers: config/hypr/autostart.lua; default/hypr/helpers.lua:117-125; default/hypr/autostart.lua:1
merged-from: 40:hypr-autostart-user-entry-runs-on-login; 12:autostart-lua-launch-on-start

### hyprland-lua-preinstalled-bindings-flag   [VM-OK]
description: Setting `omarchy_preinstalled_bindings = false` in ~/.config/hypr/hyprland.lua removes the preinstalled app and web-app chords while keeping the essentials, Super+K reflects it, and restoring the comment brings them back — the documented way to drop the stock app hotkeys without unbinding them one by one.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `grep -c '^-- omarchy_preinstalled' ~/.config/hypr/hyprland.lua` Return → 1 (the flag ships commented out).
  * Type `sed -i 's/^-- omarchy_preinstalled_bindings = false/omarchy_preinstalled_bindings = false/' ~/.config/hypr/hyprland.lua && hyprctl reload` Return.
  * Press Super+Shift+A: nothing happens (no ChatGPT window within 15 s). Press Super+Return: a terminal still opens (the essentials stay bound). Close it.
  * Press Super+K, type `ChatGPT`: no row; clear the filter (Escape once) and type `Terminal`: row present. Escape.
  * Type `sed -i 's/^omarchy_preinstalled_bindings = false/-- omarchy_preinstalled_bindings = false/' ~/.config/hypr/hyprland.lua && hyprctl reload` Return; press Super+Shift+A: the ChatGPT app window opens again (NET-free: an offline error page is fine). Close it with Super+W.
  * Type `grep -c '^-- omarchy_preinstalled' ~/.config/hypr/hyprland.lua` Return → 1; close the terminal. The desktop is empty and hyprland.lua is back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Omarchy Menu → Setup → Config → Hyprland opens the same file in the editor if you prefer; a save there applies by itself (Hyprland reloads the file).
  * Escape in the keybindings viewer is two-stage: the first clears the filter, the second closes it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Super+Shift+A doing nothing, a terminal from Super+Return, Super+K without ChatGPT and with Terminal, ChatGPT working again after the restore, and the grep count 1 before and after
  * If unsuccessful
  ** ChatGPT opening while the flag is set, or Super+Return failing; `grep omarchy_preinstalled ~/.config/hypr/hyprland.lua`
covers: config/hypr/hyprland.lua:9-11; default/hypr/helpers.lua:84-90; default/hypr/bindings/applications.lua:10; test/shell.d/hyprland-default-config-test.sh:131-139
merged-from: 40:hypr-preinstalled-bindings-disabled-flag

### multi-monitor-and-laptop-display-chords-single-display   [VM-PARTIAL]
description: With one display, the move-workspace-to-monitor and focus-next-monitor chords are harmless no-ops, the laptop-display and mirroring chords refuse with "No laptop display found" / "No laptop monitor found to mirror" and write no toggle files, and Trigger → Hardware hides its laptop rows — the absence path; the positive paths need a second screen or a laptop panel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return.
  * Press Super+Shift+Alt+Left, Super+Shift+Alt+Right, Super+Shift+Alt+Up, Super+Shift+Alt+Down: the terminal stays put; no notification or banner.
  * Press Ctrl+Alt+Tab and Ctrl+Alt+Shift+Tab: focus stays on the terminal.
  * Press Super+Ctrl+Delete: notification "No laptop display found"; the screen stays on (`omarchy-hyprland-monitor-internal toggle; echo "exit=$?"` gives the same toast and exit=1). Press Super+Ctrl+Alt+Delete: notification "No laptop monitor found to mirror" (or "No external monitors found for mirror" — record the exact text); the screen stays on.
  * Type `omarchy-hyprland-monitor-focused; omarchy-hyprland-monitor-laptop; echo "[$?]"; omarchy-hyprland-monitor-external-active; echo "exit=$?"; omarchy-hyprland-monitor-focused-apple; echo "exit=$?"` Return → `Virtual-1`; empty then `[0]`; exit=0 (the virtual output counts as external); exit=1. Then `omarchy-hyprland-monitor-internal on; echo "exit=$?"; omarchy-hyprland-monitor-internal sideways; echo "exit=$?"; omarchy-hyprland-monitor-clamshell; echo "exit=$?"; omarchy-hw-recover-internal-monitor; echo "exit=$?"` → 0 with no toast (nothing to enable); usage, 1; 0 with no change; 0.
  * Type `omarchy-hw-laptop; echo "exit=$?"; ls ~/.local/state/omarchy/toggles/hypr/` Return → exit=1 and only `flags.lua` (no `internal-monitor-*.lua` was written).
  * Press Super+Ctrl+H (Trigger → Hardware; the same as Super+Space → Trigger → Hardware): the submenu has no "Laptop Display", "Mirror Display", "Touchpad", "Touchpad Haptics", "Touchscreen" or "Hybrid GPU" rows (all gated on hardware); it may be empty, vanish from its parent, or open "Nothing here yet" — record exactly what is listed. Escape.
  * Press Super+Ctrl+D: the Display panel opens (Virtual-1 with scale pills; there is no backlight to move). Escape. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: moving a workspace to another output, disabling/mirroring a real internal panel, the lid-close clamshell sync — no second monitor, no laptop, no lid. Notifications hide after a few seconds; screenshot immediately after each hotkey.
  * Menu guards paint from the previous evaluation: reopen Trigger → Hardware twice before asserting what is listed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots after each chord with the terminal unmoved and focused, the two notifications, every helper value and exit code above, the exit=1 and `flags.lua`-only listing, the Hardware submenu without laptop rows, the Display panel
  * If unsuccessful
  ** A black screen, an error banner, a missing notification, a stray `internal-monitor-*.lua` file in the listing, or a helper that changed the only display; `./client get-serial`
covers: default/hypr/bindings/tiling.lua:37-40,52-53; default/hypr/bindings/utilities.lua:33-34; bin/omarchy-hyprland-monitor-internal; bin/omarchy-hyprland-monitor-internal-mirror; bin/omarchy-hyprland-monitor-{focused,laptop,external-active,focused-apple,modeless,clamshell}; bin/omarchy-hw-recover-internal-monitor; bin/omarchy-hw-laptop; bin/omarchy-monitor-state; default/omarchy/omarchy-menu.jsonc trigger.hardware.* (trigger.hardware.laptop-display, mirror-display); test/shell.d/monitor-output-name-test.sh; test/shell.d/monitor-state-test.sh; test/shell.d/monitor-modeless-test.sh; manual/07:31,58-59,189-190; manual/33:34-37 (Extending and mirroring laptop displays)
merged-from: 40:hypr-multi-monitor-chords-single-display; 12:laptop-display-toggles-absent-in-vm; 25:monitor-helpers-without-laptop-panel

### media-keys-via-wtype-dummy-sink-no-backlight-touchpad   [VM-PARTIAL]
description: The XF86 media, brightness and touchpad binds have no driver key token but can be fired from inside the guest with `wtype -k`; on a machine with only PipeWire's Dummy Output, no backlight and no touchpad they must give a volume OSD, "Microphone on", silent brightness exits and "No touchpad device found" — never a hang or a stray state file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `hyprctl binds | grep -c XF86; wpctl status | grep -A3 Sinks` Return → at least 20 (the binds exist even without keys) and an `auto_null` "Dummy Output" sink.
  * Type `wtype -k XF86AudioRaiseVolume` Return: the volume OSD appears with a percentage; `wtype -k XF86AudioLowerVolume` lowers it; `wtype -k XF86AudioMute` shows the muted OSD, and again unmutes.
  ** If `wtype` is not installed, run the commands the binds call instead (`omarchy-audio-output-volume raise`, `lower`, `mute-toggle`) and report that the key path was skipped.
  * Type `wtype -k XF86AudioMicMute` Return → toast "Microphone on" (no source to mute). Type `omarchy-audio-output-switch; omarchy-audio-source-switch; echo "exit=$?"` Return → messages, no hang.
  * Type `wtype -k XF86MonBrightnessUp; wtype -k XF86KbdBrightnessUp; omarchy-brightness-display +5%; echo "exit=$?"; omarchy-brightness-keyboard up; echo "exit=$?"` Return → no OSD and no-backlight exits (`omarchy-brightness-display` exits 1 silently — it takes the DDC path on `Virtual-1`).
  * Type `wtype -k XF86TouchpadToggle; omarchy-toggle-touchpad; echo "exit=$?"; ls ~/.local/state/omarchy/toggles/hypr/` Return → `No touchpad device found`, exit=1, and no `touchpad-disabled-name` file.
  * Type `wtype -k XF86AudioPlay; omarchy-shell media playPause; echo "exit=$?"` Return (no player): record the result; nothing may hang longer than 10 s.
  * Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: the physical keys (no send-keys token for XF86 qcodes) and any OSD needing a real device; the Dummy Output stands in for a sound card. OSDs fade after a few seconds — screenshot straight after each `wtype`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots with the bind count and the Dummy Output, the volume and mute OSDs, the "Microphone on" toast, each brightness/touchpad message and exit code, the toggles listing without a touchpad file
  * If unsuccessful
  ** A command hanging (>10 s), a traceback, no OSD after `wtype` despite the sink, or a state file written for a missing device
covers: default/hypr/bindings/media.lua; bin/omarchy-audio-output-volume; bin/omarchy-toggle-touchpad; bin/omarchy-toggle-input-device; test/shell.d/toggle-input-device-test.sh; manual/07:86-93,195
merged-from: 40:hypr-media-keys-no-audio-device

### screenshot-print-region-keyboard-picker-and-cancel   [VM-OK]
description: Print freezes the screen in the region picker: a dragged region is saved to ~/Pictures and the clipboard with a thumbnail toast that opens the annotation editor, Tab/Ctrl+Tab and the arrows highlight windows, Return captures the highlighted window and Ctrl+Return the whole screen, and Escape, a second Print or a second invocation dismiss the picker without writing a file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice; type `echo LEFT` Return in the left terminal and `echo RIGHT` Return in the right one; in the right one type `ls ~/Pictures | wc -l` Return and note the count.
  * Press Print: the screen freezes and dims slightly under a selection overlay (crosshair, window outlines). Drag a rectangle from about (0.2,0.2) to (0.6,0.6) and release: toast "Screenshot saved to clipboard and file" / "Edit with Super + Alt + , (or click this)" with a thumbnail. Click the toast: Tensaku opens floating with the captured image; press Super+W.
  ** The toast lasts 5 s; if it is gone, press Super+Alt+, to invoke it. If `~/Pictures` did not exist you first see a toast "Created screenshot directory".
  * Type `ls -t ~/Pictures | head -1; file ~/Pictures/$(ls -t ~/Pictures | head -1); wl-paste --list-types` Return → `screenshot-YYYY-MM-DD_HH-MM-SS.png`, roughly 512x320 (40 % of 1280x800), and `image/png` among the clipboard types; the count is +1.
  * Super+Space → Trigger → Capture → Screenshot (the menu row is the same smart picker), then click once — no drag — in the middle of the LEFT terminal: the capture snaps to the window under the cursor; the same toast; `file` on the newest PNG shows dimensions close to that terminal, not the full 1280x800.
  * Move the mouse over the LEFT terminal, press Print, then Tab: the highlight and pointer jump to a window; Tab again (or Ctrl+Tab) moves back; Left/Right and Up/Down follow the direction (or stay when no window lies that way). With RIGHT highlighted press Return: a toast; the newest PNG has the right terminal's size (about half the screen width) — click the toast to see exactly one terminal in the editor, then Super+W.
  * Press Print, then Ctrl+Return at once: the whole screen is captured; the newest PNG is 1280x800 and the editor shows the bar and both terminals. Super+W.
  ** Older builds have no Tab/Return binds in the overlay: drag a region with the mouse instead and report the keys absent.
  * Unhappy paths: press Print, then Escape at the crosshair: the freeze ends, no toast, the count is unchanged. Press Print, then Print again: the picker is dismissed, nothing saved. Type `omarchy-capture-screenshot &` Return and, while the picker is up, type `omarchy-capture-screenshot` Return blind: the picker closes (the second invocation kills slurp) and nothing is saved.
  * Type `rm ~/Pictures/screenshot-*.png` Return, press Super+W twice; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Print is `<PRINT>`; Ctrl+Return is `<C-ENTER>`. These keys only exist while the selection overlay is up; the overlay hides the cursor after key presses — move the mouse if you need to see the crosshair.
  * `file ~/Pictures/$(ls -t ~/Pictures | head -1)` prints the newest file's dimensions; a stuck frozen screen shows in `pgrep -a slurp hyprpicker`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the frozen picker with the drag rectangle, the toast with thumbnail, Tensaku with the image, the file name / dimensions / `image/png` lines, the click-snapped window-sized capture from the menu row, the highlight moving with Tab, the single-window capture and the full-screen capture in the editor, and the unchanged count after each cancel
  * If unsuccessful
  ** Screenshot of no overlay after Print, a missing toast after the drag, a file written after Escape, or the overlay stuck after Escape; the terminal error from grim/slurp; `hyprctl binds | grep -i capture-region` taken while the picker is up (from a third terminal)
covers: default/hypr/bindings/utilities.lua:38,50-83 (selection layer binds); default/hypr/apps/screenshot-selection.lua; bin/omarchy-capture-screenshot (region, pkill slurp); bin/omarchy-capture-region (region, smart bare-click snap, --take-window, --take-fullscreen, --select-window); bin/omarchy-notification-send (--image, --exec); default/omarchy/omarchy-menu.jsonc (trigger.capture.screenshot); test/shell.d/screenshot-sanity-test.sh; manual/03:35; manual/07:140-146; manual/12:16-35 (12-screenshots-recording.md, Driving the picker)
merged-from: 40:hypr-capture-print-screenshot; 10:screenshot-print-region-and-dismiss; 10:screenshot-print-keyboard-window-fullscreen; 25:screenshot-region-drag-and-cancel; 25:screenshot-keyboard-picker-enter-tab-ctrl-enter; 25:screenshot-click-window-to-clipboard-and-file

### capture-cli-screenshot-modes-copy-save-and-dir   [VM-OK]
description: The capture CLI the maintainers' visual-verification skill relies on works from a terminal: `fullscreen` needs no picker and writes a non-blank PNG whose path is printed, `copy` leaves only a clipboard image and `save` only a file, `windows` mode offers window/monitor rectangles, `OMARCHY_SCREENSHOT_DIR` redirects the file, and a cancelled region picker writes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `wl-copy "plain text"; ls ~/Pictures | wc -l` Return (seed the clipboard, note the count).
  * Type `omarchy capture screenshot fullscreen save` Return → the last line is a path ending in `.png` under `~/Pictures/`, printed immediately (no picker, no editor, no toast). Type `ls -l "$(ls -t ~/Pictures/*.png | head -1)"; file "$(ls -t ~/Pictures/*.png | head -1)"; wl-paste` Return → larger than 10 KB, `PNG image data, 1280 x 800`, and the clipboard still `plain text`; the count is +1.
  * Type `xdg-open "$(ls -t ~/Pictures/*.png | head -1)" &` Return: an image viewer shows the captured desktop with the bar rendered along the top (a black image is a failure). Press Super+W on the viewer.
  * Type `omarchy-capture-screenshot fullscreen copy` Return → no path printed, no toast, count unchanged, but `wl-paste --list-types` shows `image/png`. Type `wl-copy "plain text"; omarchy-capture-screenshot fullscreen` Return → path printed, toast, count +1, and `image/png` on the clipboard (the default does both).
  * Type `omarchy-capture-screenshot windows` Return → a picker with window/monitor rectangles hinted; click on the bar area → the shot is full-monitor sized (`file` on the newest PNG → 1280 x 800).
  * Type `OMARCHY_SCREENSHOT_DIR=/tmp/shots omarchy capture screenshot fullscreen` Return → toast "Created screenshot directory: /tmp/shots" (the directory is made on demand) then the normal saved toast; the path is under `/tmp/shots/`. Type `omarchy screenshot` Return (the router alias): the crosshair appears; press Ctrl+Return → toast. Type `omarchy capture screenshot --help` Return → usage with `[smart|region|windows|fullscreen] [slurp|copy|save] [--editor=<name>]`.
  * Unhappy path: type `omarchy capture screenshot region; echo "exit=$?"` Return and press Escape at the crosshair → cancelled quietly, no editor, no new file, exit=0. Then the menu route once: Super+Space → Trigger → Capture → Screenshot, drag a small region → the saved toast with its preview.
  * Round trip: `rm -rf /tmp/shots ~/Pictures/screenshot-*.png` Return; close the terminal. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The printed path is the last line; `f=$(omarchy capture screenshot fullscreen save | tail -n 1); file "$f"` captures it exactly. `imv "$f" &` (press `q` to close) is an alternative viewer to `xdg-open`; the bar band is the top ~26 px of the image (menu glyph left, clock centre) — compare it against the live bar in your own screenshot. Make sure the viewer, not the terminal, is focused before Super+W.
  * `fullscreen` needs no interaction; use it whenever you just need a file. `omarchy screenrecord --fullscreen` / `--stop-recording` are the same recorder as Alt+Print and are exercised in the screen-recording tests.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the printed path with its `ls -l` size and `PNG image data, 1280 x 800`, the viewer showing a non-blank rendered bar band, the count and clipboard type after each mode as described, the windows picker, the "Created screenshot directory" toast and the custom-dir path, the alias capture, the help text, the quiet cancel with no new file, and the menu-route toast
  * If unsuccessful
  ** The mode whose side effect leaked (a toast in copy mode, an image on the clipboard in save mode), a missing/zero-size file, a command error, or a viewer showing a black image or black bar band; `omarchy-version`
covers: bin/omarchy-capture-screenshot (fullscreen|windows, slurp|copy|save); bin/omarchy-capture-region (windows, fullscreen); bin/omarchy (alias routing, capture screenshot); default/hypr/bindings/utilities.lua:38; shell runtime (bar); test/shell.d/screenshot-sanity-test.sh:121-244; test/shell.d/manifest-entrypoints-test.sh; agents/skills/visual-verification.md:13-19; default/agents/skills/omarchy/capture.md; SKILL.md ("Record my screen"); contributing.md (captures for bug reports); manual/12:20-22 (12-screenshots-recording.md); manual/14:24,55
merged-from: 25:screenshot-fullscreen-copy-and-save-modes; 50:capture-screenshot-fullscreen-save; 61:capture-screenshot-and-record-cli; 10:screenshot-cli-modes-and-custom-dir; 52:screenshot-fullscreen-captures-bar

### screenshot-dir-override-uwsm-env   [VM-OK]
description: An `OMARCHY_SCREENSHOT_DIR` export in `~/.config/uwsm/env.d/` redirects screenshots after a re-login, and the FAQ's caveat that the directory must exist first is checked. The re-login goes through Super+Escape → Logout and the SDDM greeter (autologin does not re-fire).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Print and capture a region by dragging with the mouse. Open a terminal with Super+Enter and type `ls -t ~/Pictures | head -1` Return: the fresh screenshot in `~/Pictures`.
  * Type `mkdir -p ~/.config/uwsm/env.d; echo 'export OMARCHY_SCREENSHOT_DIR="$HOME/Pictures/Screenshots"' > ~/.config/uwsm/env.d/capture` Return. Do NOT create the directory yet.
  * Log out: Super+Escape → Logout. At SDDM (logo, lock glyph and a dotted entry — no user name field) type `prime` and Return.
  ** Logout closes all windows; finish typing before pressing Logout.
  * Open a terminal and type `echo $OMARCHY_SCREENSHOT_DIR` Return: `/home/prime/Pictures/Screenshots`. Press Print, capture a region, and record what happens with the directory missing: `ls -t ~/Pictures | head -1; ls ~/Pictures/Screenshots` Return.
  * Type `mkdir -p ~/Pictures/Screenshots` Return, press Print, capture again: `ls -t ~/Pictures/Screenshots | head -1` shows the new file.
  * Type `rm ~/.config/uwsm/env.d/capture; rm -rf ~/Pictures/Screenshots ~/Pictures/screenshot-*.png` Return — stock again after the next login. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the Print key as `<PRINT>`; when the region selector appears, `mouse drag` a small rectangle.
  * Wrong password at SDDM shows a red lock/entry cleared by the next keystroke; stay under five tries (faillock deny=10 is shared with the lock screen and sudo).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the stock file in ~/Pictures, the env.d file, the SDDM login, the variable after re-login and the behaviour with the directory missing, and the new file inside ~/Pictures/Screenshots
  * If unsuccessful
  ** The variable unset after re-login, screenshots still in ~/Pictures once the directory exists, or a capture-tool crash
covers: manual/46:57-65; manual/12 (overlap); uwsm env.d
merged-from: 13:faq-screenshot-dir-override

### screenrecording-alt-print-start-stop-cpu-encode   [VM-PARTIAL]
description: Alt+Print opens the Screenrecord audio choice, "With no audio" records a picked window with a bar indicator and a runtime-dir state file, the Stop row exists only while recording, a second Alt+Print (or the Stop row) stops it and an MP4 with a thumbnail toast lands in ~/Videos; on the accelerator-less guest it must record with the CPU x264 fallback or fail with a clear notification, never hang. Skipped: audio and webcam variants (no devices).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `ls -d ~/Videos; ls -la /tmp/omarchy-screenrecord-filename "$XDG_RUNTIME_DIR"/omarchy-screenrecord-filename 2>&1` Return → `~/Videos` exists (if not, report and `mkdir ~/Videos`) and both state files are absent.
  * Press Alt+Print: the Capture → Screenrecord submenu shows "With no audio", "With desktop audio", "With desktop + microphone audio" — no webcam row (none present) and no "Stop Screenrecording" row. Select "With no audio".
  * The screen freezes; click once inside the terminal (snaps to that window). Within ~5 s a red recording indicator lights next to the clock. Type `cat "$XDG_RUNTIME_DIR"/omarchy-screenrecord-filename; ls -la /tmp/omarchy-screenrecord-filename 2>&1; pgrep -fc '^gpu-screen-recorder'` Return → a path under `~/Videos/`, the `/tmp` file still absent, `1`. Type `echo recording` a few times over ~10 s (screenshots, no long sleep).
  ** Never let a recording run past 15 s; CPU encoding on 2 vCPU is slow and fills the disk quickly. If the indicator never lights, see the hint.
  * Press Super+Ctrl+C → Screenrecord: "Stop Screenrecording" is now the first row (it exists only while recording). Escape without stopping. Press Alt+Print: the indicator goes out; after a few seconds a toast "Screen recording saved" / "Open with Super + Alt + , (or click this)" with a thumbnail. Click it: mpv plays the clip; press q.
  * Type `ls -l ~/Videos; ffprobe -v error -show_entries stream=codec_name,width,height -of csv=p=0 ~/Videos/screenrecording-*.mp4` Return → one `screenrecording-YYYY-MM-DD_HH-MM-SS.mp4` with size > 0, no leftover `-preview.png`/`-processed.mp4`, and `h264,<w>,<h>`.
  * Press Super+Alt+] and Super+Alt+[ : nothing visible, no banner (no webcam overlay to resize). Type `pgrep -f gpu-screen-recorder; echo "exit=$?"` Return → exit=1 (nothing left running).
  * Unhappy path: press Alt+Print, "With no audio", then Escape at the crosshair: no indicator, no toast, no new file. Then the menu route once: Super+Space → Trigger → Capture → Screenrecord → With no audio, click the terminal, wait 3 s, Super+Space → Trigger → Capture → Screenrecord → Stop Screenrecording: indicator off, saved toast.
  * Type `rm ~/Videos/screenrecording-*.mp4` Return; close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Alt+Print is `<A-PRINT>`. If the indicator never lights: type `OMARCHY_SCREENRECORD_DEBUG=true omarchy capture screenrecording --fullscreen` Return, wait 5 s, `omarchy capture screenrecording --stop-recording`, then `cat $XDG_RUNTIME_DIR/omarchy-screenrecord.log | sudo tee /dev/ttyS0` and read it with get-serial; then try once with `OMARCHY_SCREENRECORD_USE_PORTAL=true OMARCHY_SCREENRECORD_DEBUG=true` and stop it the same way. A kms-capture failure on this GPU-less virtio display is a VM limit; an encoder crash is a finding — report which.
  * Skipped: audio variants and the webcam overlay itself — no sink, mic or camera. The menu row "With no audio" is the same as running the command without flags; the webcam refusals are in `screenrecording-refusals-and-webcam-absent`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Screenrecord submenu without webcam/stop rows, the lit indicator, the runtime-dir state file naming the recording and no `/tmp` file, the submenu with Stop Screenrecording, the saved toast with thumbnail, mpv playing, `ls -l ~/Videos` and the ffprobe line, nothing after the webcam chords, the empty pgrep, and the cancelled start with no file
  * If unsuccessful
  ** The serial dump of omarchy-screenrecord.log (gsr's stderr), `pgrep -af gpu-screen-recorder`, whether the portal variant behaved differently, any "Screen recording error" toast, a `/tmp/omarchy-screenrecord-filename` file, or a Stop row while nothing records; `omarchy-version`
covers: default/hypr/bindings/utilities.lua:39-41; default/hypr/apps/webcam-overlay.lua; bin/omarchy-capture-screenrecording; bin/omarchy-capture-region (--match-monitor); shell/plugins/bar/indicators/ScreenRecording.qml; default/omarchy/omarchy-menu.jsonc:59-68 (trigger.capture.screenrecord.*); test/shell.d/screenrecording-test.sh; test/shell.d/menu-test.sh; manual/07:145-146,149-150,156; manual/12:39-47 (12-screenshots-recording.md)
merged-from: 25:screenrecording-start-stop-software-encode; 10:screenrecord-alt-print-start-stop; 40:hypr-capture-screenrecording-alt-print; 52:screenrecording-webcam-picker-absence-and-state-file

### screenrecording-refusals-and-webcam-absent   [VM-PARTIAL]
description: The recorder refuses cleanly: a missing OMARCHY_SCREENRECORD_DIR gives a critical toast and no indicator, stopping with nothing running exits quietly, a bad webcam size is rejected; and without a webcam the webcam row is hidden, the webcam recorder refuses with a critical toast and the overlay resize is a silent no-op. Only the absence path is exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `OMARCHY_SCREENRECORD_DIR=/tmp/no-such-dir omarchy capture screenrecording --fullscreen; echo "exit=$?"` Return → a persistent critical toast "Screen recording directory does not exist: /tmp/no-such-dir", exit=1, and no indicator lights. Press Super+, to dismiss it.
  * Type `omarchy capture screenrecording --stop-recording; echo "exit=$?"` Return → exit=1, no toast (nothing was recording).
  * Type `omarchy capture screenrecording --webcam-size=huge --fullscreen; echo "exit=$?"` Return → `Invalid webcam size: huge (expected small, medium, or large)`, exit=1.
  * Press Super+Space → Trigger → Capture → Screenrecord: rows "With no audio", "With desktop audio", "With desktop + microphone audio" — and NO "…+ webcam" row. Escape.
  * Type `omarchy-hw-webcam; echo "exit=$?"; omarchy-capture-webcam-list | wc -l` Return → exit=1 and 0. Type `omarchy-capture-screenrecording-with-webcam; echo "exit=$?"` Return → critical toast "No webcam devices found", exit=1; dismiss it with Super+, .
  * Type `omarchy-capture-webcam-resize smaller; echo "exit=$?"; omarchy-capture-webcam-resize gigantic; echo "exit=$?"` Return → 0 silently (no overlay to resize), then usage, exit=1.
  * Type `ls ~/Videos` Return: no recording was written. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Critical toasts stay until dismissed with Super+, (or a right click on them). Skipped: the webcam overlay and a webcam recording — no camera.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the critical toast with exit=1, the quiet exit=1, the webcam-size rejection, the submenu without the webcam row, the "No webcam devices found" toast with the exit codes 1 / 0 / 0 / 1, and the empty Videos listing
  * If unsuccessful
  ** Screenshot of an indicator lighting or a file appearing, or any webcam row or device listed on the VM
covers: bin/omarchy-capture-screenrecording:24-29,60-66; bin/omarchy-capture-webcam-resize; bin/omarchy-capture-screenrecording-with-webcam; bin/omarchy-capture-webcam-list; bin/omarchy-hw-webcam; default/omarchy/omarchy-menu.jsonc (trigger.capture.screenrecord.webcam when); manual/12:41,58
merged-from: 10:screenrecord-missing-dir-rejects; 25:screenrecording-webcam-absent

### color-picker-and-ocr-print-chords   [VM-OK]
description: Super+Print (and Trigger → Capture → Color) turns the cursor into an eyedropper whose click copies the pixel's hex colour to the clipboard, and Super+Ctrl+Print OCRs a dragged region into the clipboard as text with a toast; pressing the chord again or Escape at the picker copies nothing and leaves the clipboard unchanged.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `clear; printf '\e[41m%60s\e[0m\n%.0s' ' ' {1..8}` Return: a large red block fills part of the terminal.
  * Press Super+Print: the screen freezes and a magnified picker swatch follows the cursor. Click in the middle of the red block: the picker closes (a notification may show the `#rrggbb` value). Type `echo ` then Super+V, Return: a hex colour with high red and low green/blue prints (e.g. `#cd0000`).
  * Unhappy path: press Super+Print (picker active), then Super+Print again (the second invocation is `pkill hyprpicker`): the picker closes; `wl-paste` Return still prints the same colour. Press Super+Print, then Escape: same, clipboard unchanged.
  * Press Super+Space → Trigger → Capture → Color: the same eyedropper; click on the terminal's dark background; `wl-paste` → a hex like the theme's terminal background (e.g. `#1a1b26`).
  * Type `clear; printf '\n\n   HELLO OMARCHY 2026\n\n'` Return and press Super+F for large clear text near the top. Press Super+Ctrl+Print: the screen freezes and the cursor becomes a crosshair. Drag a rectangle tightly around HELLO OMARCHY 2026 and release: after a few seconds (tesseract on 2 vCPU) a toast "Copied text from selection to clipboard".
  * Type `echo "` then Super+V then `"` Return: the output contains HELLO OMARCHY 2026 (O/0 variations acceptable; report the exact text).
  * Unhappy path: type `omarchy-capture-text; echo "exit=$?"` Return (the same command as the chord and as Trigger → Capture → Text), then Escape at the crosshair: the freeze ends, no toast, exit=0; `wl-paste` still prints the previous text.
  * Press Super+F, Super+W; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Print is `<M-PRINT>`, Super+Ctrl+Print is `<M-C-PRINT>`. Use `mouse drag` from above-left to below-right of the text. Trigger → Capture → Color / Text are the same commands as the chords.
  * Larger text OCRs better (the digits must come out right): `omarchy-display-text-size 18` before and `omarchy-display-text-size reset` after if the default font is too small. If `tesseract: command not found` appears, report the missing package — that is a defect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the red block, the eyedropper overlay, the pasted hex value, the cancelled picker with the clipboard unchanged (twice), the menu-driven pick, the frozen screen with the OCR selection, the OCR toast, the pasted text with the digits right, and the cancelled OCR with no toast and exit=0
  * If unsuccessful
  ** Screenshot after the click with no colour pasted (`pgrep -a hyprpicker` and the clipboard contents); after the OCR drag with no toast, type `omarchy capture text` Return and screenshot any error (the tesseract error or garbage output and the region screenshot)
covers: default/hypr/bindings/utilities.lua:42-43; bin/omarchy-capture-text; bin/omarchy-capture-region; default/omarchy/omarchy-menu.jsonc:64 (trigger.capture.color, trigger.capture.text); manual/07:147-148; manual/11:5 (11-text-extraction-dictation.md); manual/12:9-10,62,66 (12-screenshots-recording.md)
merged-from: 40:hypr-capture-color-picker-and-ocr; 10:color-picker-super-print; 10:ocr-super-ctrl-print-extracts-text; 25:capture-color-picker; 25:capture-text-ocr-to-clipboard

### qr-code-capture-decode-and-none-found   [VM-OK]
description: Trigger → Capture → QR Code decodes a QR code in the selected region to the clipboard as a sensitive copy (kept out of the clipboard history) and raises a critical "No QR code found" toast when the region has none.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, Super+F, type `clear; qrencode -t ANSIUTF8 -m 2 'omarchy-qr-ok'` Return: a block-character QR code appears (fullscreen makes the blocks large enough to decode).
  * Press Super+Ctrl+C, type `qr`, Return (Trigger → Capture → QR Code; walk the menu with the arrows if typing does not filter). Drag a rectangle around the code with some margin: toast "QR code copied to clipboard".
  * Type `echo ` then Super+V, Return → `omarchy-qr-ok` (`wl-paste` prints the same).
  * Press Super+Ctrl+V: `omarchy-qr-ok` is NOT listed in the clipboard history (sensitive copies are skipped). Escape.
  * Unhappy path: type `clear` Return, then Super+Space → Trigger → Capture → QR Code and drag over the empty terminal: critical toast "No QR code found" / "Select a region containing a QR code" (stays until dismissed). Press Super+, (or right-click it).
  * Press Super+F, Super+W; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the QR renders with the wrong aspect (tall blocks), use `qrencode -t UTF8` or `-t ANSI` instead; zbar copes with either.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the QR code, the copied toast, the decoded text echoed, the history panel without it, and the critical "No QR code found" toast
  * If unsuccessful
  ** Screenshot after the drag with neither toast; `zbarimg --version`
covers: bin/omarchy-capture-qr; bin/omarchy-capture-region; shell/plugins/clipboard/capture.sh:15-17 (sensitive skip); default/omarchy/omarchy-menu.jsonc:63 (trigger.capture.qr); manual/12:64
merged-from: 10:qr-code-capture-decode-and-none-found; 25:capture-qr-decode-and-no-qr

## Not runnable here

### apple-studio-display-peripherals   [VM-NO]
description: Apple Studio/XDR display speakers and webcam need the recommended DP+USB-A→USB-C cable, and the keyboard brightness keys drive the display's brightness OSD. Requires the display; nothing here is runnable in the VM (no audio, webcam or backlight devices, and the driver cannot send brightness keys).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Hardware only.) Connect the display with the recommended cable; open a terminal with Super+Enter and type `wpctl status; v4l2-ctl --list-devices` Return: the display's speakers and webcam are listed.
  * Press the keyboard brightness keys: the display brightness OSD appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry for the record; on the guest the closest exercise is `media-keys-via-wtype-dummy-sink-no-backlight-touchpad`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the devices listed and the brightness OSD
  * If unsuccessful
  ** Devices missing with the recommended cable
covers: manual/46:69-71
merged-from: 13:apple-studio-display-peripherals

### laptop-mirror-clamshell-and-brightness-real   [VM-NO]
description: Extend/mirror switching between a laptop panel and an external output, lid-close disabling the internal panel (clamshell), and the brightness keys with their Shift variants need a laptop panel, a second output, a lid and a backlight. None exist in the guest; only the refusal path runs here (`multi-monitor-and-laptop-display-chords-single-display`).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Hardware only.) With an external display attached press Super+Ctrl+Alt+Delete → notification "Mirroring enabled (…)"; press it again → "Extended mode restored".
  * Press Super+Ctrl+Delete → "Laptop display disabled"; press it again → the panel returns.
  * Close and open the lid: the internal panel is disabled and re-enabled by the clamshell sync (`omarchy-hyprland-monitor-clamshell`); `hyprctl monitors` reflects each state.
  * Press the brightness keys and their Shift variants (maximum / minimum): the brightness OSD follows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry for the record; the guest has no laptop panel, second output, lid or backlight, and the driver cannot send XF86 brightness keys.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The notifications named above and `hyprctl monitors` reflecting them
  * If unsuccessful
  ** A black internal panel that does not recover; `./client get-serial`
covers: manual/33-monitors.md (Extending and mirroring, Controlling brightness); bin/omarchy-hyprland-monitor-internal*; bin/omarchy-hyprland-monitor-clamshell; default/hypr/bindings/media.lua
merged-from: 12:laptop-mirror-and-clamshell-real

### touchpad-toggle-persists-across-reload   [VM-NO]
description: Disabling the touchpad stores the device name as data (never Lua), the OSD confirms, the pointer stops moving, a Hyprland reload keeps it disabled, and enabling clears the file. Needs a real touchpad; on the guest only the "No touchpad device found" refusal runs (`media-keys-via-wtype-dummy-sink-no-backlight-touchpad`).
instruction: |
  <Instructions>
  From the desktop please do the following (laptop):

  <ActionList>
  * (Hardware only.) Open a terminal and type `omarchy-hw-touchpad` Return → a device name.
  * Super+Space → Trigger → Hardware → Touchpad → OSD "Touchpad disabled"; the touchpad no longer moves the pointer; `cat ~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name` → that name.
  * Type `hyprctl reload` Return → still disabled (`hyprctl devices -j | jq '.mice[]|select(.name|test("touchpad";"i"))'` if it exposes the enabled state; otherwise by moving a finger).
  * Type `omarchy-toggle-touchpad on` Return → OSD "Touchpad enabled", the pointer moves, the file is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry for the record; the guest's USB tablet enumerates as a mouse, so the Touchpad row is hidden and the toggle refuses.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** OSD screendumps, the name file appearing/disappearing, and the pointer behaviour before/after reload
  * If unsuccessful
  ** The device name and `hyprctl devices -j`
covers: bin/omarchy-toggle-input-device; bin/omarchy-toggle-touchpad; default/hypr/disabled-input-device.lua; default/hypr/toggles.lua; test/shell.d/toggle-input-device-test.sh
merged-from: 25:touchpad-toggle-persists-across-reload

## Moved to other domains

- 24:crash-capture-toggle-disables-watcher → D — crash-capture is a systemd user-service toggle with notification proofs; D already holds its siblings (11:crash-capture-toggle-and-segfault-notification, 13:crash-capture-notification-and-toggle, 24:crash-capture-toast-on-segfault, 41:crash-watch-notification-and-toggle, 61:crash-toast-needs-default-agent).
- 25:toggle-crash-capture → D — same story as above (service stops/starts, toast).
- 51:crash-capture-toggle → D — same story as above (unit ConditionPathExists).
- 61:crash-capture-toggle → D — same story as above; its Super+Ctrl+O (utilities.lua:5) menu chord is covered by 40:hypr-menu-chords-open-named-menus in B.
- 12:fingerprint-absent-in-vm → H — Setup → Security fingerprint absence path, not a Hyprland behaviour; H holds the fido2/security-setup siblings.
- 24:setup-fingerprint-hidden-without-reader → H — same fingerprint-absence story.
- 42:setup-fingerprint-absent-in-vm → H — same fingerprint-absence story.
- 12:fingerprint-and-fido2-enrol-real → H — VM-NO hardware-authentication appendix entry belonging with the security domain.
- 11:tmux-dev-layout-tdl → H — tmux shell functions (`tdl`); H holds 11:tmux-session-attach-and-resume, 11:tmux-dev-square-tds, 41:tmux-omarchy-config-and-t-alias.
- 11:tmux-swarm-and-multi-layouts → H — tmux shell functions (`tsl`, `tdlm`).
- 41:tmux-dev-layouts → H — tmux shell functions (`tdl`, `tds`, `tsl`); duplicate story of the two above, to be merged there.
- 11:tmux-keybindings-cheatsheets → B — the Super+Alt+K cheat-sheet menu; B holds 22:tmux-keybindings-viewer and F2 holds 40:hypr-launch-editor-tmux-herdr-and-cheatsheets (utilities.lua:11 stays covered).
- 11:mailto-and-zoom-handlers → F2 — web-app scheme handlers; F2 holds 22:webapp-handlers-mailto-and-zoom and 41:mailto-and-webapp-handlers.
- 11:obsidian-hotkey-single-window → F2 — launch-or-focus of an app (applications.lua:18); F2 holds 40:hypr-launch-obsidian-omawrite-focus.
- 41:imv-omarchy-keybindings → F2 — imv's own in-app shortcuts (config/imv/config), an app-in-use story, not a Hyprland binding.
- 22:agent-chord-without-default-opens-picker → F1 — the Super+Shift+Ctrl+A agent picker (utilities.lua:97); F1 holds 40:hypr-ai-chords-agent-picker-and-dictation-absent.
- 12:plugin-list-cli → D — `omarchy plugin list`; D holds 25:plugin-list-enable-disable-first-party-widget.
- 25:audio-tuning-no-match-paths → H — speaker-tuning manager; H holds 61:audio-tuning-no-matching-hardware.
- 25:restart-terminal-tmux-xcompose-and-quiet-helpers → E — the restart helpers are theme-switch plumbing (E holds 21:refresh-tmux-and-hyprsunset); the XCompose restart itself is exercised here in `xcompose-compose-key-sequences-restart-and-legacy-repair`.
- 41:omarchy-tab-completion → G2 — CLI discoverability of the `omarchy` router (bash completions), not a desktop behaviour.
- 41:zram-swap-active → H — system default (zram-generator, sysctl), pure terminal inspection of system state.
- 42:xdg-defaults-and-home-layout → H — user provisioning defaults (xdg-user-dirs, mimeapps, GTK bookmarks).
- 50:security-user-not-in-input-group → H — security posture of the desktop user (group membership, /dev/input permissions).
- 13:faq-print-settings-and-pdf-printing → H — CUPS/printing readiness; H holds the CUPS expectations from 41/50.
- 60:try-omarchy-macos-and-windows → I — host-side Try Omarchy apps; a VM-NO appendix entry that belongs with the ISO/appendix domain.

## Dropped

- (none)
