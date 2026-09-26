# 40 — Hyprland configuration and keybindings (Omarchy 4, Lua config)

Reviewer notes for the Hyprland layer of Omarchy: the user-editable `~/.config/hypr/*.lua` files, the
package-owned defaults under `default/hypr/**`, the manual pages that document them, and the
`omarchy-menu-keybindings` viewer. Format per `00-FORMAT.md`.

## Scope

Source: `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18 (`version` = 4.0.0.alpha; the minted disk is
4.0.2, so a handful of HEAD-only bindings may be absent on the guest — see Observations O-1).

Read completely, every line:

| Area | Files | Lines |
|------|-------|-------|
| User layer (copied to `~/.config/hypr`) | `config/hypr/autostart.lua` (2), `bindings.lua` (28), `hyprland.lua` (29), `hyprsunset.conf` (14), `input.lua` (58), `looknfeel.lua` (50), `monitors.lua` (22), `xdph.conf` (4), `.luarc.json` (11) | 218 |
| Loader / helpers | `default/hypr/omarchy.lua` (23), `bootstrap.lua` (39), `helpers.lua` (159), `paths.lua` (22), `require_all.lua` (39), `require_optional.lua` (12) | 294 |
| Bindings | `default/hypr/bindings.lua` (4), `bindings/tiling.lua` (98), `bindings/applications.lua` (34), `bindings/utilities.lua` (127), `bindings/clipboard.lua` (48), `bindings/media.lua` (34), `bindings/voxtype.lua` (5) | 350 |
| Window rules | `default/hypr/windows.lua` (25), `apps.lua` (5), `apps/*.lua` × 21 (1password 3, battlenet 16, bitwarden 6, browser 12, davinci-resolve 14, geforce 1, hermes 7, jetbrains 2, localsend 3, moonlight 1, omarchy-shell 14, pip 24, qemu 1, retroarch 6, screenshot-selection 2, steam 4, system 57, telegram 2, terminals 8, webcam-overlay 25, windows-vm 5) | 243 |
| Toggles / layouts / input devices | `default/hypr/toggles.lua` (23), `toggles/flags.lua` (2), `toggles/single-window-aspect-ratio.lua` (6), `toggles/window-no-gaps.lua` (12), `workspace-layouts.lua` (8), `disabled-input-device.lua` (21) | 72 |
| Look, input, env, autostart | `default/hypr/looknfeel.lua` (125), `input.lua` (81), `envs.lua` (49), `nvidia.lua` (19), `autostart.lua` (14), `qconsole.lua` (196) | 484 |
| Manual | `manual/07-hotkeys.md` (374), `04-navigation.md` (73), `34-keyboard-mouse-trackpad.md` (74), `33-monitors.md` (55), `42-common-tweaks.md` (37) | 613 |
| Viewer | `bin/omarchy-menu-keybindings` (669) | 669 |

Skimmed for maintainer invariants (not line-by-line): `test/shell.d/hyprland-*-test.sh` (14 files),
`windows-key-test.sh` (unrelated — it tests the Windows *licence* key helper, not the Super key),
`keyboard-layout-test.sh` (bar layout widget model), `floating-terminal-test.sh`,
`toggle-input-device-test.sh`, `monitor-*-test.sh` (7), `test/acceptance.d/system-test.sh`,
`apps-test.sh`. Also opened, to know what a chord actually does on the guest: the `bin/omarchy-launch-*`
helpers the bindings call, `omarchy-hyprland-window-{pop,width,transparency-toggle,gaps-toggle,
single-square-aspect-toggle}`, `omarchy-hyprland-{toggle,toggle-enabled,workspace-layout-toggle,
monitor-scaling,monitor-internal,monitor-modeless,reload-guard}`, `omarchy-toggle-{bar,fullscreen-desktop,
nightlight,idle,input-device,touchpad}`, `omarchy-audio-output-volume`, `omarchy-notification-battery`,
`omarchy-capture-screenshot`, `omarchy-refresh-{hyprland,config}`, `omarchy-launch-floating-terminal-with-presentation`,
`config/foot/foot.ini` (clipboard keys), `default/omarchy/omarchy-menu.jsonc` (menu paths to the hypr
config files), `install/omarchy-base.packages` (what is actually installed on a minted disk).

Not reviewed: the Quickshell side of panels/menus/notifications the chords open (other reviewers), the
`omarchy-capture-*` internals beyond what the chord needs, theme `hyprland.lua` overrides
(`omarchy.current.theme.hyprland`, per-theme reviewer).

## Inventory

### I-1 Load order (what wins)

`~/.config/hypr/hyprland.lua` (config/hypr/hyprland.lua:1-29):
1. `dofile($OMARCHY_PATH/default/hypr/bootstrap.lua)` — purges `default.hypr.*`, `hypr.*`,
   `omarchy.current.theme.*` from `package.loaded` so a reload re-executes them, then sets
   `package.path` = `~/.local/state/?.lua; ~/.config/?.lua; $OMARCHY_PATH/?.lua` (bootstrap.lua:4-39).
2. Optional flags the user may set *before* the next line: `omarchy_default_bindings = false`,
   `omarchy_preinstalled_bindings = false` (hyprland.lua:6-11).
3. `require("default.hypr.omarchy")` — helpers → autostart → (unless `omarchy_default_bindings == false`)
   media, clipboard, tiling, utilities, voxtype, applications (optional module) → envs → looknfeel →
   qconsole → input → windows (+ apps/*) → theme override `omarchy.current.theme.hyprland` (omarchy.lua:3-23).
4. User overrides, in this order: `hypr.monitors`, `hypr.input`, `hypr.bindings`, `hypr.looknfeel`,
   `hypr.autostart` (hyprland.lua:19-23).
5. `require("default.hypr.toggles")` — sources every `*.lua` in `~/.local/state/omarchy/toggles/hypr/`
   (except the two legacy `touch*-disabled` names), applies persisted disabled input devices, then
   `default.hypr.workspace-layouts` sources `~/.local/state/omarchy/workspace-layouts/*.lua` (toggles.lua:1-23,
   workspace-layouts.lua:1-8).
6. Anything else the user appends (hyprland.lua:28-29).

Consequence: a runtime error in a user file aborts everything after it in this list (e.g. a broken
`bindings.lua` stops `looknfeel`, `autostart`, and the toggles/workspace-layout restore from being applied on
that reload — see O-7).

### I-2 Helper API the user is told to use (default/hypr/helpers.lua)

| Helper | Line | Effect |
|--------|------|--------|
| `o.bind(keys, description, dispatcher, opts)` | 92-106 | `hl.bind`; a string dispatcher becomes `hl.dsp.exec_cmd`; a table `{omarchy=}` → `omarchy-launch-<x>`, `{launch=}` → `uwsm-app -- <cmd>`, `{launch=, focus=}` → `omarchy-launch-or-focus`, `{webapp=}` → `omarchy-launch-webapp`, `{webapp=, focus=true}` → `omarchy-launch-or-focus-webapp <description> <url>`, `{tui=}` → `omarchy-launch-tui`, `{tui=, focus=true}` → `omarchy-launch-or-focus-tui` (56-82) |
| `o.rebind(keys, ...)` | 108-111 | `hl.unbind(keys)` then `o.bind` — replaces *every* bind on that chord |
| `hl.unbind(keys)` | (Hyprland) | removes a default binding; documented in config/hypr/bindings.lua:22-23 |
| `o.bind_toggle(keys, desc, name)` | 139-141 | exec `omarchy-toggle-<name>` |
| `o.launch(cmd)` | 113-115 | `uwsm-app -- cmd` |
| `o.launch_on_start(cmd)` / `o.exec_on_start(cmd)` | 117-125 | run on `hyprland.start` event only (not on reload) |
| `o.window(match, rules)` | 147-159 | `hl.window_rule`; string match = class regex, table = arbitrary match fields |
| `o.cmd_present/cmd_missing` | 37-54 | PATH lookup without spawning (used by voxtype.lua) |
| `o.shell_succeeds` | 23-35 | popen marker (nvidia detection) |
| `o.notify(msg)` | 143-145 | `omarchy-notification-send -u low` |
| `o.preinstalled_bindings_enabled()` | 84-90 | `omarchy_preinstalled_bindings` global, else absence of `~/.local/state/omarchy/preinstalls-removed` |

### I-3 Keybindings — every `o.bind` / `hl.bind`

Driver notation: `<M-…>` = Super, `<C-…>` Ctrl, `<A-…>` Alt, `<S-…>` Shift; keys as in `00-FORMAT.md`.
Verified against `src/qemu/keys.ts`: named keys `<PRINT> <CAPSLOCK> <INSERT> <MENU> <PAUSE> <NUMLOCK>
<SCROLLLOCK>`, any qcode with `_` or starting with `f` (`<alt_r> <shift_r> <ctrl_r> <meta_r> <kp_enter>`),
punctuation inside a chord (`<M-,> <M-`> <M-/> <M--> <M-=> <M-.> <M-;>`), and modifier combos on all of
them (`<A-PRINT> <M-C-PRINT> <A-alt_r>`). Chords marked **✗** have no `send-keys` token: XF86 media /
brightness / touchpad / power / calculator keys, the Copilot keycode 201, and the lid switch — see O-2.

#### bindings/tiling.lua (103 binds)

| # | Driver | Human | Action | Description | Source |
|---|--------|-------|--------|-------------|--------|
| 1 | `<M-w>` | Super+W | `hl.dsp.window.close()` | Close window | tiling.lua:1 |
| 2 | `<M-q>` | Super+Q | `hl.dsp.window.close()` | Close window | tiling.lua:2 |
| 3 | `<C-A-DEL>` | Ctrl+Alt+Delete | exec `omarchy-hyprland-window-close-all` (closes every client, focuses ws 1) | Close all windows | tiling.lua:3 |
| 4 | `<M-j>` | Super+J | `hl.dsp.layout("togglesplit")` | Toggle window split | tiling.lua:5 |
| 5 | `<M-p>` | Super+P | `hl.dsp.window.pseudo()` | Pseudo window | tiling.lua:6 |
| 6 | `<M-t>` | Super+T | `hl.dsp.window.float({action="toggle"})` | Toggle window floating/tiling | tiling.lua:7 |
| 7 | `<M-f>` | Super+F | `hl.dsp.window.fullscreen({mode="fullscreen"})` | Full screen | tiling.lua:8 |
| 8 | `<M-C-f>` | Super+Ctrl+F | exec `omarchy-hyprland-window-tiled-fullscreen-toggle` (client fullscreen state 2 inside tile) | Tiled full screen | tiling.lua:9 |
| 9 | `<M-A-f>` | Super+Alt+F | `hl.dsp.window.fullscreen({mode="maximized"})` | Full width | tiling.lua:10 |
| 10 | `<M-o>` | Super+O | exec `omarchy-hyprland-window-pop` (float, resize 1300×900, center, pin, tag +pop; toggles back) | Pop window out (float & pin) | tiling.lua:11 |
| 11 | `<M-A-HOME>` | Super+Alt+Home | exec `omarchy-hyprland-window-width save` | Save window width | tiling.lua:12 |
| 12 | `<M-HOME>` | Super+Home | exec `omarchy-hyprland-window-width restore` | Restore window width | tiling.lua:13 |
| 13 | `<M-l>` | Super+L | exec `omarchy-hyprland-workspace-layout-toggle` (dwindle↔scrolling, persisted) | Toggle workspace layout | tiling.lua:14 |
| 14 | `<M-LEFT>` | Super+Left | `hl.dsp.focus({direction="l"})` | Focus on left window | tiling.lua:16 |
| 15 | `<M-RIGHT>` | Super+Right | `hl.dsp.focus({direction="r"})` | Focus on right window | tiling.lua:17 |
| 16 | `<M-UP>` | Super+Up | `hl.dsp.focus({direction="u"})` | Focus on above window | tiling.lua:18 |
| 17 | `<M-DOWN>` | Super+Down | `hl.dsp.focus({direction="d"})` | Focus on below window | tiling.lua:19 |
| 18 | `<M-1>` | Super+1 (code:10) | `hl.dsp.focus({workspace="1"})` | Switch to workspace 1 | tiling.lua:23 |
| 19 | `<M-2>` | Super+2 (code:11) | focus workspace 2 | Switch to workspace 2 | tiling.lua:23 |
| 20 | `<M-3>` | Super+3 (code:12) | focus workspace 3 | Switch to workspace 3 | tiling.lua:23 |
| 21 | `<M-4>` | Super+4 (code:13) | focus workspace 4 | Switch to workspace 4 | tiling.lua:23 |
| 22 | `<M-5>` | Super+5 (code:14) | focus workspace 5 | Switch to workspace 5 | tiling.lua:23 |
| 23 | `<M-6>` | Super+6 (code:15) | focus workspace 6 | Switch to workspace 6 | tiling.lua:23 |
| 24 | `<M-7>` | Super+7 (code:16) | focus workspace 7 | Switch to workspace 7 | tiling.lua:23 |
| 25 | `<M-8>` | Super+8 (code:17) | focus workspace 8 | Switch to workspace 8 | tiling.lua:23 |
| 26 | `<M-9>` | Super+9 (code:18) | focus workspace 9 | Switch to workspace 9 | tiling.lua:23 |
| 27 | `<M-0>` | Super+0 (code:19) | focus workspace 10 | Switch to workspace 10 | tiling.lua:23 |
| 28 | `<M-S-1>` | Super+Shift+1 | `hl.dsp.window.move({workspace="1"})` (follows) | Move window to workspace 1 | tiling.lua:24 |
| 29 | `<M-S-2>` | Super+Shift+2 | move window to ws 2 | Move window to workspace 2 | tiling.lua:24 |
| 30 | `<M-S-3>` | Super+Shift+3 | move window to ws 3 | Move window to workspace 3 | tiling.lua:24 |
| 31 | `<M-S-4>` | Super+Shift+4 | move window to ws 4 | Move window to workspace 4 | tiling.lua:24 |
| 32 | `<M-S-5>` | Super+Shift+5 | move window to ws 5 | Move window to workspace 5 | tiling.lua:24 |
| 33 | `<M-S-6>` | Super+Shift+6 | move window to ws 6 | Move window to workspace 6 | tiling.lua:24 |
| 34 | `<M-S-7>` | Super+Shift+7 | move window to ws 7 | Move window to workspace 7 | tiling.lua:24 |
| 35 | `<M-S-8>` | Super+Shift+8 | move window to ws 8 | Move window to workspace 8 | tiling.lua:24 |
| 36 | `<M-S-9>` | Super+Shift+9 | move window to ws 9 | Move window to workspace 9 | tiling.lua:24 |
| 37 | `<M-S-0>` | Super+Shift+0 | move window to ws 10 | Move window to workspace 10 | tiling.lua:24 |
| 38 | `<M-S-A-1>` | Super+Shift+Alt+1 | `hl.dsp.window.move({workspace="1", follow=false})` | Move window silently to workspace 1 | tiling.lua:25 |
| 39 | `<M-S-A-2>` | Super+Shift+Alt+2 | move silently to ws 2 | Move window silently to workspace 2 | tiling.lua:25 |
| 40 | `<M-S-A-3>` | Super+Shift+Alt+3 | move silently to ws 3 | Move window silently to workspace 3 | tiling.lua:25 |
| 41 | `<M-S-A-4>` | Super+Shift+Alt+4 | move silently to ws 4 | Move window silently to workspace 4 | tiling.lua:25 |
| 42 | `<M-S-A-5>` | Super+Shift+Alt+5 | move silently to ws 5 | Move window silently to workspace 5 | tiling.lua:25 |
| 43 | `<M-S-A-6>` | Super+Shift+Alt+6 | move silently to ws 6 | Move window silently to workspace 6 | tiling.lua:25 |
| 44 | `<M-S-A-7>` | Super+Shift+Alt+7 | move silently to ws 7 | Move window silently to workspace 7 | tiling.lua:25 |
| 45 | `<M-S-A-8>` | Super+Shift+Alt+8 | move silently to ws 8 | Move window silently to workspace 8 | tiling.lua:25 |
| 46 | `<M-S-A-9>` | Super+Shift+Alt+9 | move silently to ws 9 | Move window silently to workspace 9 | tiling.lua:25 |
| 47 | `<M-S-A-0>` | Super+Shift+Alt+0 | move silently to ws 10 | Move window silently to workspace 10 | tiling.lua:25 |
| 48 | `<M-s>` | Super+S | `hl.dsp.workspace.toggle_special("scratchpad")` | Toggle scratchpad | tiling.lua:28 |
| 49 | `<M-A-s>` | Super+Alt+S | `hl.dsp.window.move({workspace="special:scratchpad", follow=false})` | Move window to scratchpad | tiling.lua:29 |
| 50 | `<M-`>` | Super+Grave | toggle_special("scratchpad") | Toggle scratchpad | tiling.lua:30 |
| 51 | `<M-S-`>` | Super+Shift+Grave | move to special:scratchpad silently | Move window to scratchpad | tiling.lua:31 |
| 52 | `<M-TAB>` | Super+Tab | `hl.dsp.focus({workspace="e+1"})` | Next workspace | tiling.lua:33 |
| 53 | `<M-S-TAB>` | Super+Shift+Tab | focus workspace e-1 | Previous workspace | tiling.lua:34 |
| 54 | `<M-C-TAB>` | Super+Ctrl+Tab | focus workspace previous | Former workspace | tiling.lua:35 |
| 55 | `<M-S-A-LEFT>` | Super+Shift+Alt+Left | `hl.dsp.workspace.move({monitor="l"})` | Move workspace to left monitor | tiling.lua:37 |
| 56 | `<M-S-A-RIGHT>` | Super+Shift+Alt+Right | workspace.move monitor r | Move workspace to right monitor | tiling.lua:38 |
| 57 | `<M-S-A-UP>` | Super+Shift+Alt+Up | workspace.move monitor u | Move workspace to up monitor | tiling.lua:39 |
| 58 | `<M-S-A-DOWN>` | Super+Shift+Alt+Down | workspace.move monitor d | Move workspace to down monitor | tiling.lua:40 |
| 59 | `<M-S-LEFT>` | Super+Shift+Left | `hl.dsp.window.swap({direction="l"})` | Swap window to the left | tiling.lua:42 |
| 60 | `<M-S-RIGHT>` | Super+Shift+Right | swap r | Swap window to the right | tiling.lua:43 |
| 61 | `<M-S-UP>` | Super+Shift+Up | swap u | Swap window up | tiling.lua:44 |
| 62 | `<M-S-DOWN>` | Super+Shift+Down | swap d | Swap window down | tiling.lua:45 |
| 63 | `<A-TAB>` | Alt+Tab | `hl.dsp.window.cycle_next()` | Focus on next window | tiling.lua:47 |
| 64 | `<A-S-TAB>` | Alt+Shift+Tab | `cycle_next({next=false})` | Focus on previous window | tiling.lua:48 |
| 65 | `<A-TAB>` | Alt+Tab (stacked) | `hl.dsp.window.bring_to_top()` | Reveal active window on top | tiling.lua:49 |
| 66 | `<A-S-TAB>` | Alt+Shift+Tab (stacked) | `bring_to_top()` | Reveal active window on top | tiling.lua:50 |
| 67 | `<C-A-TAB>` | Ctrl+Alt+Tab | `hl.dsp.focus({monitor="+1"})` | Focus on next monitor | tiling.lua:52 |
| 68 | `<C-A-S-TAB>` | Ctrl+Alt+Shift+Tab | focus monitor -1 | Focus on previous monitor | tiling.lua:53 |
| 69 | `<M-->` | Super+Minus (code:20) | `window.resize({x=-100,y=0,relative=true})` | Expand window left | tiling.lua:55 |
| 70 | `<M-=>` | Super+Equal (code:21) | resize x=+100 | Shrink window left | tiling.lua:56 |
| 71 | `<M-S-->` | Super+Shift+Minus | resize y=-100 | Shrink window up | tiling.lua:57 |
| 72 | `<M-S-=>` | Super+Shift+Equal | resize y=+100 | Expand window down | tiling.lua:58 |
| 73 | `<M-A-->` | Super+Alt+Minus | resize x=-25 | Expand window left a little | tiling.lua:60 |
| 74 | `<M-A-=>` | Super+Alt+Equal | resize x=+25 | Shrink window left a little | tiling.lua:61 |
| 75 | `<M-S-A-->` | Super+Shift+Alt+Minus | resize y=-25 | Shrink window up a little | tiling.lua:62 |
| 76 | `<M-S-A-=>` | Super+Shift+Alt+Equal | resize y=+25 | Expand window down a little | tiling.lua:63 |
| 77 | `<M-C-->` | Super+Ctrl+Minus | resize x=-300 | Expand window left a lot | tiling.lua:65 |
| 78 | `<M-C-=>` | Super+Ctrl+Equal | resize x=+300 | Shrink window left a lot | tiling.lua:66 |
| 79 | `<M-C-S-->` | Super+Ctrl+Shift+Minus | resize y=-300 | Shrink window up a lot | tiling.lua:67 |
| 80 | `<M-C-S-=>` | Super+Ctrl+Shift+Equal | resize y=+300 | Expand window down a lot | tiling.lua:68 |
| 81 | `mouse scroll --modifier super` (down) | Super+Wheel down | focus workspace e+1 | Scroll active workspace forward | tiling.lua:70 |
| 82 | `mouse scroll --modifier super` (up) | Super+Wheel up | focus workspace e-1 | Scroll active workspace backward | tiling.lua:71 |
| 83 | `mouse drag --modifier super --button left` | Super+Left drag (mouse:272) | `hl.dsp.window.drag()` `{mouse=true}` | Move window | tiling.lua:73 |
| 84 | `mouse drag --modifier super --button right` | Super+Right drag (mouse:273) | `hl.dsp.window.resize()` `{mouse=true}` | Resize window | tiling.lua:74 |
| 85 | `<M-g>` | Super+G | `hl.dsp.group.toggle()` | Toggle window grouping | tiling.lua:76 |
| 86 | `<M-A-g>` | Super+Alt+G | `window.move({out_of_group=true})` | Move active window out of group | tiling.lua:77 |
| 87 | `<M-A-LEFT>` | Super+Alt+Left | `window.move({into_group="l"})` | Move window to group on left | tiling.lua:79 |
| 88 | `<M-A-RIGHT>` | Super+Alt+Right | into_group r | Move window to group on right | tiling.lua:80 |
| 89 | `<M-A-UP>` | Super+Alt+Up | into_group u | Move window to group on top | tiling.lua:81 |
| 90 | `<M-A-DOWN>` | Super+Alt+Down | into_group d | Move window to group on bottom | tiling.lua:82 |
| 91 | `<M-A-TAB>` | Super+Alt+Tab | `hl.dsp.group.next()` | Next window in group | tiling.lua:84 |
| 92 | `<M-A-S-TAB>` | Super+Alt+Shift+Tab | `group.prev()` | Previous window in group | tiling.lua:85 |
| 93 | `<M-C-LEFT>` | Super+Ctrl+Left | `group.prev()` | Move grouped window focus left | tiling.lua:87 |
| 94 | `<M-C-RIGHT>` | Super+Ctrl+Right | `group.next()` | Move grouped window focus right | tiling.lua:88 |
| 95 | `mouse scroll --modifier super+alt` (down) | Super+Alt+Wheel down | `group.next()` | Next window in group | tiling.lua:90 |
| 96 | `mouse scroll --modifier super+alt` (up) | Super+Alt+Wheel up | `group.prev()` | Previous window in group | tiling.lua:91 |
| 97 | `<M-A-1>` | Super+Alt+1 (code:10) | `hl.dsp.group.active({index=1})` | Switch to group window 1 | tiling.lua:94 |
| 98 | `<M-A-2>` | Super+Alt+2 | group.active 2 | Switch to group window 2 | tiling.lua:94 |
| 99 | `<M-A-3>` | Super+Alt+3 | group.active 3 | Switch to group window 3 | tiling.lua:94 |
| 100 | `<M-A-4>` | Super+Alt+4 | group.active 4 | Switch to group window 4 | tiling.lua:94 |
| 101 | `<M-A-5>` | Super+Alt+5 | group.active 5 | Switch to group window 5 | tiling.lua:94 |
| 102 | `<M-/>` | Super+Slash | exec `omarchy-hyprland-monitor-scaling up` | Monitor scaling up | tiling.lua:97 |
| 103 | `<M-A-/>` | Super+Alt+Slash | exec `omarchy-hyprland-monitor-scaling down` | Monitor scaling down | tiling.lua:98 |

#### bindings/applications.lua (28 binds; 104-131)

Rows 111-131 exist only while `o.preinstalled_bindings_enabled()` (applications.lua:10).

| # | Driver | Human | Action | Description | Installed on minted disk? | Source |
|---|--------|-------|--------|-------------|---------------------------|--------|
| 104 | `<M-ENTER>` | Super+Return | `omarchy-launch-terminal` → `xdg-terminal-exec --dir=<cwd of active terminal>` (foot) | Terminal | yes (foot) | applications.lua:2 |
| 105 | `<M-S-ENTER>` | Super+Shift+Return | `omarchy-launch-browser` (xdg default → chromium) | Browser | yes | applications.lua:3 |
| 106 | `<M-S-f>` | Super+Shift+F | `omarchy-launch-nautilus` (`nautilus --new-window`) | File manager | yes | applications.lua:4 |
| 107 | `<M-A-S-f>` | Super+Alt+Shift+F | `omarchy-launch-nautilus-cwd` (cwd of active terminal) | File manager (cwd) | yes | applications.lua:5 |
| 108 | `<M-S-b>` | Super+Shift+B | `omarchy-launch-browser` | Browser | yes | applications.lua:6 |
| 109 | `<M-S-A-b>` | Super+Shift+Alt+B | `omarchy-launch-browser --private` (→ `--incognito` for chromium) | Browser (private) | yes | applications.lua:7 |
| 110 | `<M-S-n>` | Super+Shift+N | `omarchy-launch-editor` → `omarchy-launch-tui nvim` (app-id `org.omarchy.nvim`, tiled) | Editor | yes | applications.lua:8 |
| 111 | `<M-A-ENTER>` | Super+Alt+Return | `omarchy-launch-terminal-tmux` (`tmux attach \|\| tmux new -s Work`) | Tmux | yes | applications.lua:12 |
| 112 | `<M-C-ENTER>` | Super+Ctrl+Return | `omarchy-launch-terminal-herdr` | Herdr | yes (herdr) | applications.lua:13 |
| 113 | `<M-S-m>` | Super+Shift+M | `omarchy-launch-spotify` → focus existing, else `/usr/bin/spotify`, else floating installer `omarchy-install-service-spotify` | Music | **no** → installer prompt | applications.lua:14 |
| 114 | `<M-S-A-m>` | Super+Shift+Alt+M | `omarchy-launch-or-focus-tui cliamp` (app-id `org.omarchy.cliamp`) | Music TUI | yes (cliamp) | applications.lua:15 |
| 115 | `<M-S-d>` | Super+Shift+D | `omarchy-launch-tui omarchy-launch-docker-tui` → `pkexec lazydocker` (polkit prompt) | Docker | yes (lazydocker) | applications.lua:16 |
| 116 | `<M-S-g>` | Super+Shift+G | `omarchy-launch-signal` → installer when `/usr/bin/signal-desktop` missing | Signal | **no** → installer prompt | applications.lua:17 |
| 117 | `<M-S-o>` | Super+Shift+O | `omarchy-launch-or-focus '^obsidian$' 'uwsm-app -- obsidian'` | Obsidian | yes | applications.lua:18 |
| 118 | `<M-S-w>` | Super+Shift+W | `uwsm-app -- omawrite` | Omawrite | yes | applications.lua:19 |
| 119 | `<M-S-/>` | Super+Shift+Slash | `omarchy-launch-1password` → installer when `1password` missing | Passwords | **no** → installer prompt | applications.lua:20 |
| 120 | `<M-S-a>` | Super+Shift+A | `omarchy-launch-webapp 'https://chatgpt.com'` (chromium `--app=`) | ChatGPT | yes (NET) | applications.lua:22 |
| 121 | `<M-S-A-a>` | Super+Shift+Alt+A | webapp `https://grok.com` | Grok | yes (NET) | applications.lua:23 |
| 122 | `<M-S-c>` | Super+Shift+C | webapp `https://app.hey.com/calendar/weeks/` | Calendar | yes (NET) | applications.lua:24 |
| 123 | `<M-S-e>` | Super+Shift+E | webapp `https://app.hey.com` | Email | yes (NET) | applications.lua:25 |
| 124 | `<M-S-A-e>` | Super+Shift+Alt+E | webapp `https://app.hey.com/messages/new?display=standalone&new_window=true` | New email | yes (NET) | applications.lua:26 |
| 125 | `<M-S-y>` | Super+Shift+Y | webapp `https://youtube.com/` | YouTube | yes (NET) | applications.lua:27 |
| 126 | `<M-S-A-g>` | Super+Shift+Alt+G | `omarchy-launch-or-focus-webapp WhatsApp https://web.whatsapp.com/` | WhatsApp | yes (NET) | applications.lua:28 |
| 127 | `<M-S-C-g>` | Super+Shift+Ctrl+G | launch-or-focus-webapp "Google Messages" | Google Messages | yes (NET) | applications.lua:29 |
| 128 | `<M-S-p>` | Super+Shift+P | launch-or-focus-webapp "Google Photos" `https://photos.google.com/` | Google Photos | yes (NET) | applications.lua:30 |
| 129 | `<M-S-s>` | Super+Shift+S | launch-or-focus-webapp "Google Maps" `https://maps.google.com/` | Google Maps | yes (NET) | applications.lua:31 |
| 130 | `<M-S-x>` | Super+Shift+X | webapp `https://x.com/` | X | yes (NET) | applications.lua:32 |
| 131 | `<M-S-A-x>` | Super+Shift+Alt+X | webapp `https://x.com/compose/post` | X Post | yes (NET) | applications.lua:33 |

#### bindings/utilities.lua (66 static + 8 transient binds; 132-205)

| # | Driver | Human | Action | Description | Source |
|---|--------|-------|--------|-------------|--------|
| 132 | `<M-SPACE>` | Super+Space | exec `omarchy-menu toggle` | Omarchy menu | utilities.lua:1 |
| 133 | `<M-A-SPACE>` | Super+Alt+Space | `omarchy-menu toggle apps` | Apps menu | utilities.lua:2 |
| 134 | `<M-C-e>` | Super+Ctrl+E | `omarchy-shell shell toggle omarchy.emojis` | Emojis | utilities.lua:3 |
| 135 | `<M-C-c>` | Super+Ctrl+C | `omarchy-menu toggle capture` | Capture menu | utilities.lua:4 |
| 136 | `<M-C-o>` | Super+Ctrl+O | `omarchy-menu toggle toggle` | Toggle menu | utilities.lua:5 |
| 137 | `<M-C-h>` | Super+Ctrl+H | `omarchy-menu toggle hardware` | Hardware menu | utilities.lua:6 |
| 138 | ✗ | Super+Shift+code:201 (Copilot key) | `omarchy-menu toggle root` | Omarchy menu | utilities.lua:7 |
| 139 | `<M-ESC>` | Super+Escape | `omarchy-menu toggle system` | System menu | utilities.lua:8 |
| 140 | ✗ | XF86PowerOff | `omarchy-menu toggle system` `{locked=true}` | Power menu | utilities.lua:9 |
| 141 | `<M-k>` | Super+K | exec `omarchy-menu-keybindings` | Keybindings | utilities.lua:10 |
| 142 | `<M-A-k>` | Super+Alt+K | `omarchy-menu-tmux-keybindings` | Tmux keybindings | utilities.lua:11 |
| 143 | `<M-C-k>` | Super+Ctrl+K | `omarchy-menu-herdr-keybindings` | Herdr keybindings | utilities.lua:12 |
| 144 | `<M-C-q>` | Super+Ctrl+Q | exec `omacalc` (floating, system.lua:32) | Calculator | utilities.lua:13 |
| 145 | ✗ | XF86Calculator | exec `omacalc` | Calculator | utilities.lua:14 |
| 146 | `<M-S-SPACE>` | Super+Shift+Space | `omarchy-toggle-bar` | Toggle top bar | utilities.lua:16 |
| 147 | `<M-C-SPACE>` | Super+Ctrl+Space | `omarchy-menu toggle background` | Background switcher | utilities.lua:17 |
| 148 | `<M-S-C-SPACE>` | Super+Shift+Ctrl+Space | `omarchy-menu toggle theme` | Theme menu | utilities.lua:18 |
| 149 | `<M-BS>` | Super+Backspace | `omarchy-hyprland-window-transparency-toggle` (setprop opaque toggle) | Toggle window transparency | utilities.lua:19 |
| 150 | `<M-S-BS>` | Super+Shift+Backspace | `omarchy-hyprland-window-gaps-toggle` (toggle `window-no-gaps`) | Toggle window gaps | utilities.lua:20 |
| 151 | `<M-C-BS>` | Super+Ctrl+Backspace | `omarchy-hyprland-window-single-square-aspect-toggle` (+ notification) | Toggle single-window square aspect | utilities.lua:21 |
| 152 | `<M-C-A-f>` | Super+Ctrl+Alt+F | `omarchy-toggle-fullscreen-desktop` (bar off + no gaps) | Toggle full screen desktop | utilities.lua:22 |
| 153 | `<M-,>` | Super+Comma | `omarchy-shell notifications dismissOne` | Dismiss last notification | utilities.lua:25 |
| 154 | `<M-S-,>` | Super+Shift+Comma | `notifications dismissAll` | Dismiss all notifications | utilities.lua:26 |
| 155 | `<M-C-,>` | Super+Ctrl+Comma | `omarchy-toggle-notification-silencing` | Toggle silencing notifications | utilities.lua:27 |
| 156 | `<M-A-,>` | Super+Alt+Comma | `notifications invokeLast` | Invoke last notification | utilities.lua:28 |
| 157 | `<M-S-A-,>` | Super+Shift+Alt+Comma | `notifications showHistory` | Open notification history | utilities.lua:29 |
| 158 | `<M-C-i>` | Super+Ctrl+I | `omarchy-toggle-idle` (stay-awake state file) | Toggle locking on idle | utilities.lua:31 |
| 159 | `<M-C-n>` | Super+Ctrl+N | `omarchy-toggle-nightlight` (hyprsunset 4000K↔6500K) | Toggle nightlight | utilities.lua:32 |
| 160 | `<M-C-DEL>` | Super+Ctrl+Delete | `omarchy-hyprland-monitor-internal toggle` | Toggle laptop display | utilities.lua:33 |
| 161 | `<M-C-A-DEL>` | Super+Ctrl+Alt+Delete | `omarchy-hyprland-monitor-internal-mirror toggle` | Toggle laptop display mirroring | utilities.lua:34 |
| 162 | ✗ | switch:on:Lid Switch | `omarchy-system-lid-close` `{locked=true}` | (none) | utilities.lua:35 |
| 163 | ✗ | switch:off:Lid Switch | `omarchy-hyprland-monitor-clamshell` `{locked=true}` | (none) | utilities.lua:36 |
| 164 | `<PRINT>` | Print | `omarchy-capture-screenshot` (smart region picker) | Screenshot | utilities.lua:38 |
| 165 | `<A-PRINT>` | Alt+Print | `omarchy-capture-screenrecording --stop-recording \|\| omarchy-menu toggle trigger.capture.screenrecord` | Screenrecording | utilities.lua:39 |
| 166 | `<M-A-[>` | Super+Alt+[ (code:34) | `omarchy-capture-webcam-resize smaller` | Make webcam overlay smaller | utilities.lua:40 |
| 167 | `<M-A-]>` | Super+Alt+] (code:35) | `omarchy-capture-webcam-resize larger` | Make webcam overlay larger | utilities.lua:41 |
| 168 | `<M-PRINT>` | Super+Print | `pkill hyprpicker \|\| hyprpicker -a` | Color picker | utilities.lua:42 |
| 169 | `<M-C-PRINT>` | Super+Ctrl+Print | `omarchy-capture-text` (OCR via tesseract) | Extract text (OCR) from screenshot | utilities.lua:43 |
| 170 | `<ENTER>` | Return (only while slurp "selection" layer is open) | `omarchy-capture-region --take-window` | Capture highlighted window | utilities.lua:58 |
| 171 | `<C-ENTER>` | Ctrl+Return (selection) | `--take-fullscreen` | Capture entire screen | utilities.lua:59 |
| 172 | `<TAB>` | Tab (selection) | `--select-window next` | Select next window to capture | utilities.lua:60 |
| 173 | `<C-TAB>` | Ctrl+Tab (selection) | `--select-window prev` | Select previous window to capture | utilities.lua:61 |
| 174 | `<LEFT>` | Left (selection) | `--select-window left` | Select window to capture | utilities.lua:63-68 |
| 175 | `<RIGHT>` | Right (selection) | `--select-window right` | Select window to capture | utilities.lua:63-68 |
| 176 | `<UP>` | Up (selection) | `--select-window up` | Select window to capture | utilities.lua:63-68 |
| 177 | `<DOWN>` | Down (selection) | `--select-window down` | Select window to capture | utilities.lua:63-68 |
| 178 | `<M-C-s>` | Super+Ctrl+S | `omarchy-menu toggle share` | Share | utilities.lua:85 |
| 179 | `<M-C-.>` | Super+Ctrl+Period | `omarchy-transcode` | Transcode | utilities.lua:87 |
| 180 | `<M-C-r>` | Super+Ctrl+R | `omarchy-menu toggle reminder-set` | Set reminder | utilities.lua:89 |
| 181 | `<M-C-A-r>` | Super+Ctrl+Alt+R | `omarchy-reminder show` | Show reminders | utilities.lua:90 |
| 182 | `<M-S-C-r>` | Super+Shift+Ctrl+R | `omarchy-reminder clear` | Clear reminders | utilities.lua:91 |
| 183 | `<M-C-A-t>` | Super+Ctrl+Alt+T | `omarchy-notification-time` | Show time | utilities.lua:93 |
| 184 | `<M-C-A-b>` | Super+Ctrl+Alt+B | `omarchy-notification-battery` | Show battery remaining | utilities.lua:94 |
| 185 | `<M-C-A-w>` | Super+Ctrl+Alt+W | `omarchy-notification-weather` | Toggle weather | utilities.lua:95 |
| 186 | `<M-S-C-a>` | Super+Shift+Ctrl+A | `omarchy-agent --pick` | Agent | utilities.lua:97 |
| 187 | `<M-C-a>` | Super+Ctrl+A | `omarchy-shell shell toggle omarchy.audio` | Audio | utilities.lua:98 |
| 188 | `<M-C-b>` | Super+Ctrl+B | `shell toggle omarchy.bluetooth` | Bluetooth | utilities.lua:99 |
| 189 | `<M-C-d>` | Super+Ctrl+D | `shell toggle omarchy.monitor` | Display | utilities.lua:100 |
| 190 | `<M-C-A-d>` | Super+Ctrl+Alt+D | `shell toggle omarchy.clock` | Calendar | utilities.lua:101 |
| 191 | `<M-C-w>` | Super+Ctrl+W | `shell toggle omarchy.network` | Network | utilities.lua:102 |
| 192 | `<M-C-p>` | Super+Ctrl+P | `shell toggle omarchy.power` | Power | utilities.lua:103 |
| 193 | `<M-C-t>` | Super+Ctrl+T | `omarchy-launch-tui btop` (app-id `org.omarchy.btop`, floats) | Activity | utilities.lua:104 |
| 194 | `<M-C-1>` | Super+Ctrl+1 (code:10) | `omarchy-shell -q shell togglePanelAt right 1` | Bar panel 1 | utilities.lua:110-116 |
| 195 | `<M-C-2>` | Super+Ctrl+2 | togglePanelAt right 2 | Bar panel 2 | utilities.lua:110-116 |
| 196 | `<M-C-3>` | Super+Ctrl+3 | togglePanelAt right 3 | Bar panel 3 | utilities.lua:110-116 |
| 197 | `<M-C-4>` | Super+Ctrl+4 | togglePanelAt right 4 | Bar panel 4 | utilities.lua:110-116 |
| 198 | `<M-C-5>` | Super+Ctrl+5 | togglePanelAt right 5 | Bar panel 5 | utilities.lua:110-116 |
| 199 | `<M-C-6>` | Super+Ctrl+6 | togglePanelAt right 6 | Bar panel 6 | utilities.lua:110-116 |
| 200 | `<M-C-7>` | Super+Ctrl+7 | togglePanelAt right 7 | Bar panel 7 | utilities.lua:110-116 |
| 201 | `<M-C-8>` | Super+Ctrl+8 | togglePanelAt right 8 | Bar panel 8 | utilities.lua:110-116 |
| 202 | `<M-C-9>` | Super+Ctrl+9 | togglePanelAt right 9 | Bar panel 9 | utilities.lua:110-116 |
| 203 | `<M-C-z>` | Super+Ctrl+Z | Lua fn: `cursor.zoom_factor` += 1 | Zoom in | utilities.lua:118-121 |
| 204 | `<M-C-A-z>` | Super+Ctrl+Alt+Z | Lua fn: `cursor.zoom_factor` = 1 | Reset zoom | utilities.lua:123-125 |
| 205 | `<M-C-l>` | Super+Ctrl+L | exec `omarchy-system-lock` | Lock system | utilities.lua:127 |

#### bindings/clipboard.lua (4 binds; 206-209)

| # | Driver | Human | Action | Description | Source |
|---|--------|-------|--------|-------------|--------|
| 206 | `<M-c>` | Super+C | Lua fn: if active window has tag `terminal` send Ctrl+Insert, else Ctrl+C (down, then up after 50 ms, no window target so layer surfaces get it too) | Universal copy | clipboard.lua:45 |
| 207 | `<M-v>` | Super+V | terminal → Shift+Insert, else Ctrl+V | Universal paste | clipboard.lua:46 |
| 208 | `<M-x>` | Super+X | always Ctrl+X | Universal cut | clipboard.lua:47 |
| 209 | `<M-C-v>` | Super+Ctrl+V | `omarchy-shell shell toggle omarchy.clipboard` | Clipboard manager | clipboard.lua:48 |

#### bindings/media.lua (28 binds; 210-237) — all `{locked=true}`, none sendable from the driver (✗)

| # | Human | Action | Description | Source |
|---|-------|--------|-------------|--------|
| 210 | XF86AudioRaiseVolume (repeating) | `omarchy-audio-output-volume raise` (+5) | Volume up | media.lua:2 |
| 211 | XF86AudioLowerVolume (repeating) | `omarchy-audio-output-volume lower` (-5) | Volume down | media.lua:3 |
| 212 | XF86AudioMute | `omarchy-audio-output-volume mute-toggle` (250 ms debounce) | Mute | media.lua:4 |
| 213 | XF86AudioMicMute | `omarchy-audio-input-mute` | Mute microphone | media.lua:5 |
| 214 | XF86MonBrightnessUp (repeating) | `omarchy-brightness-display +5%` | Brightness up | media.lua:6 |
| 215 | XF86MonBrightnessDown (repeating) | `omarchy-brightness-display 5%-` | Brightness down | media.lua:7 |
| 216 | Shift+XF86MonBrightnessUp | `omarchy-brightness-display 100%` | Brightness maximum | media.lua:8 |
| 217 | Shift+XF86MonBrightnessDown | `omarchy-brightness-display 1%` | Brightness minimum | media.lua:9 |
| 218 | XF86KbdBrightnessUp (repeating) | `omarchy-brightness-keyboard up` | Keyboard brightness up | media.lua:10 |
| 219 | XF86KbdBrightnessDown (repeating) | `omarchy-brightness-keyboard down` | Keyboard brightness down | media.lua:11 |
| 220 | XF86KbdLightOnOff | `omarchy-brightness-keyboard cycle` | Keyboard backlight cycle | media.lua:12 |
| 221 | XF86TouchpadToggle | `omarchy-toggle-touchpad` | Toggle touchpad | media.lua:13 |
| 222 | XF86TouchpadOn | `omarchy-toggle-touchpad on` | Enable touchpad | media.lua:14 |
| 223 | XF86TouchpadOff | `omarchy-toggle-touchpad off` | Disable touchpad | media.lua:15 |
| 224 | Alt+XF86AudioRaiseVolume | `omarchy-audio-output-volume +1` | Volume up precise | media.lua:18 |
| 225 | Alt+XF86AudioLowerVolume | `omarchy-audio-output-volume -1` | Volume down precise | media.lua:19 |
| 226 | Alt+XF86MonBrightnessUp | `omarchy-brightness-display +1%` | Brightness up precise | media.lua:20 |
| 227 | Alt+XF86MonBrightnessDown | `omarchy-brightness-display 1%-` | Brightness down precise | media.lua:21 |
| 228 | XF86AudioNext | `omarchy-shell media next` | Next track | media.lua:24 |
| 229 | Alt+XF86AudioPlay | `omarchy-shell media next` | Next track | media.lua:25 |
| 230 | XF86AudioPause | `omarchy-shell media playPause` | Pause | media.lua:26 |
| 231 | XF86AudioPlay | `omarchy-shell media playPause` | Play | media.lua:27 |
| 232 | XF86AudioPrev | `omarchy-shell media previous` | Previous track | media.lua:28 |
| 233 | Alt+Shift+XF86AudioPlay | `omarchy-shell media previous` | Previous track | media.lua:29 |
| 234 | XF86Eject | `eject` | Eject media | media.lua:30 |
| 235 | Shift+XF86AudioMute | `omarchy-audio-output-switch` | Switch audio output | media.lua:32 |
| 236 | Shift+XF86AudioPause | `omarchy-audio-source-switch` | Switch media source | media.lua:33 |
| 237 | Shift+XF86AudioPlay | `omarchy-audio-source-switch` | Switch media source | media.lua:34 |

#### bindings/voxtype.lua (3 binds; 238-240) — only when `voxtype` is on PATH (not on the minted disk)

| # | Driver | Human | Action | Description | Source |
|---|--------|-------|--------|-------------|--------|
| 238 | `<M-C-x>` | Super+Ctrl+X | `voxtype record toggle` | Toggle dictation | voxtype.lua:2 |
| 239 | `<F9>` | F9 (press) | `voxtype record start` | Start dictation (push-to-talk) | voxtype.lua:3 |
| 240 | `<F9>` | F9 (release, `{release=true}`) | `voxtype record stop` | Stop dictation (push-to-talk) | voxtype.lua:4 |

Static rows the viewer adds that are *not* Hyprland binds (chromium extension shortcuts):
`Alt+Shift+L` "Copy URL from Web App", `Alt+Shift+D` "Download Video from Web App"
(omarchy-menu-keybindings:329-332; manual/07-hotkeys.md:151-152).

**Total: 240 binds** (232 always-present on a fresh install with preinstalled bindings on, 8 transient
selection-layer binds; minus 3 voxtype binds and 21 preinstalled-app binds when those flags/packages are
off).

### I-4 Window rules (`o.window` / `hl.window_rule` / `hl.layer_rule`)

| Match | Rule | Source |
|-------|------|--------|
| `.*` | `suppress_event = "maximize"` (apps cannot maximize themselves) | windows.lua:3 |
| `.*` | `tag = "+default-opacity"` | windows.lua:6 |
| class `^$` title `^$` xwayland float !fullscreen !pin | `no_focus = true` (XWayland drag fix) | windows.lua:9-19 |
| tag `default-opacity` | `opacity = "0.985 0.96"` (active/inactive), applied after apps opt out | windows.lua:25 |
| tag `floating-window` | `float`, `center`, `size {875, 600}` | apps/system.lua:2-4 |
| class `(org.omarchy.btop\|org.omarchy.terminal\|org.omarchy.bash\|org.codeberg.dnkl.foot\|org.gnome.NautilusPreviewer\|org.gnome.Evince\|Omarchy\|About\|TUI.float\|imv\|mpv)` | `tag +floating-window` | system.lua:6-11 |
| class `xdg-desktop-portal-gtk` | `tag +floating-window` (all portal dialogs float) | system.lua:16 |
| class `(sublime_text\|DesktopEditors\|org.gnome.Nautilus)` + title `^(Open.*Files?\|Open [F\|f]older.*\|Save.*Files?\|Save.*As\|Save\|All Files\|.*wants to [open\|save].*\|[C\|c]hoose.*)` | `tag +floating-window` | system.lua:17-20 |
| class `org.omarchy.about` | `float`, `center`, `size {920, 480}` (first launch only; `omarchy-launch-about` then sizes itself) | system.lua:26-28 |
| class `dev.tensaku.Tensaku` | `float`, `center` | system.lua:30-31 |
| class `omacalc` | `float` | system.lua:32 |
| class `org.omarchy.screensaver` | `fullscreen`, `float`, `animation = "slide"` | system.lua:35-37 |
| class `^(zoom\|vlc\|mpv\|org.kde.kdenlive\|com.obsproject.Studio\|com.github.PintaProject.Pinta\|imv\|org.gnome.NautilusPreviewer)$` | `tag -default-opacity`, `opacity "1 1"` | system.lua:40-51 |
| tag `pop` | `rounding = 8` | system.lua:54 |
| tag `noidle` | `idle_inhibit = "always"` | system.lua:57 |
| class `(Alacritty\|kitty\|com.mitchellh.ghostty\|foot\|org\.codeberg\.dnkl\.foot\|wezterm\|org\.omarchy\..*\|TUI\..*)` | `tag +terminal` (drives Super+C/V behaviour) | apps/terminals.lua:5-8 |
| class `((google-)?[cC]hrom(e\|ium)\|[bB]rave-browser\|[mM]icrosoft-edge\|Vivaldi-stable\|helium)` | `tag +chromium-based-browser` | apps/browser.lua:2 |
| class `([fF]irefox\|zen\|librewolf)` | `tag +firefox-based-browser` | browser.lua:3 |
| tag `chromium-based-browser` | `tag -default-opacity`, `tile = true`, `opacity "1.0 0.985"` | browser.lua:4 |
| tag `firefox-based-browser` | `tag -default-opacity`, `opacity "1.0 0.985"` | browser.lua:5 |
| class `(^.+-youtube\.com__.*$\|^.+-app\.zoom\.us__wc_home.*$)` | `tag -chromium-based-browser`, `tag -default-opacity` | browser.lua:8-9 |
| title `.*is sharing.*` | `workspace = "special silent"` (hides "is sharing" banner windows) | browser.lua:12 |
| title `(Picture.?in.?[Pp]icture)` | `tag +pip` | apps/pip.lua:2 |
| tag `pip` | `-default-opacity`, `float`, `pin`, `size {600, 338}`, `keep_aspect_ratio`, `border_size 0`, `opacity "1 1"`, `move {(monitor_w-window_w-40), (monitor_h*0.04)}` (top-right) | pip.lua:3-12 |
| tag `chromium-based-browser` + title `^Meet - .+` | same PiP treatment, bottom-right | pip.lua:15-24 |
| class `^(1[pP]assword\|com\.onepassword\.OnePassword)$` | `no_screen_share`, `tag +floating-window` | apps/1password.lua:3 |
| class `^(Bitwarden)$`; class `chrome-nngceckbapebfimnlniiiahkandclblb-Default` | `no_screen_share`, `tag +floating-window` | apps/bitwarden.lua:1-6 |
| class `^steam_app_battlenet$` title `^Battle\.net$` | `float`, `center`, `size {1280, 800}` | apps/battlenet.lua:4-8 |
| class `^steam_app_battlenet$` title `^Battle\.net Setup$` | `decorate false`, `no_blur`, `no_shadow` | battlenet.lua:12-16 |
| class `.*[Rr]esolve.*` | `float`, `stay_focused`, `no_follow_mouse`, `-default-opacity`, `opacity "1 1"` | apps/davinci-resolve.lua:3-10 |
| class `.*[Rr]esolve.*` title `^DaVinci Resolve( Studio)? - .+$` | `fullscreen` | davinci-resolve.lua:12 |
| class `.*[Rr]esolve.*` title `^(DaVinci Resolve( Studio)? - .+\|Project Manager\|Preferences\|Find Directory\|Dialog)$` | `stay_focused false` | davinci-resolve.lua:14 |
| class `GeForceNOW` | `idle_inhibit "fullscreen"` | apps/geforce.lua:1 |
| class `^Hermes$` title `^Hermes HUD$` | `-default-opacity`, `float`, `border_size 0`, `opacity "1 1"` | apps/hermes.lua:2-7 |
| class `^(jetbrains-.*)$` | `no_follow_mouse` | apps/jetbrains.lua:2 |
| class `(Share\|localsend)` | `float`, `center`; class `localsend` `size {1100, 700}` | apps/localsend.lua:2-3 |
| class `com.moonlight_stream.Moonlight` | `fullscreen`, `idle_inhibit "fullscreen"` | apps/moonlight.lua:1 |
| class `^org.quickshell$` title `^Omarchy shell – dev gallery$` | `maximize` | apps/omarchy-shell.lua:14 |
| class `qemu` | `-default-opacity`, `opacity "1 1"` | apps/qemu.lua:1 |
| class `com.libretro.RetroArch` | `fullscreen`, `-default-opacity`, `opacity "1 1"`, `idle_inhibit "fullscreen"` | apps/retroarch.lua:1-6 |
| class `steam` | `float`, `idle_inhibit "fullscreen"`; title `Steam` `center`, `size {1100, 700}`; class `steam.*` opaque; title `Friends List` `size {460, 800}` | apps/steam.lua:1-4 |
| class `org.telegram.desktop` | `focus_on_activate false` | apps/telegram.lua:2 |
| class `^WebcamOverlay-(small\|medium\|large)$` | sizes/moves from `monitor_h` fractions; title `^WebcamOverlay$` → opaque, float, pin, no_initial_focus, no_dim | apps/webcam-overlay.lua:3-25 |
| class `^xfreerdp$` title `^Windows VM - Omarchy$` | `-default-opacity`, `opacity "1 1"` | apps/windows-vm.lua:2-5 |
| class `(Alacritty\|kitty)` / `foot` / `com.mitchellh.ghostty` | `scroll_touchpad` 1.5 / 2.0 / 0.2 | default/hypr/input.lua:78-81 |

Layer rules: namespace `omarchy-bar` → `no_anim`, `animation "none"` (omarchy-shell.lua:5); namespace
`^(omarchy-menu|omarchy-image-selector|omarchy-emojis|omarchy-clipboard|omarchy-keyboard-panel)$` → same
(omarchy-shell.lua:10); namespace `selection` (slurp) → `no_anim` (apps/screenshot-selection.lua:2).

Workspace rules: `special:scratchpad` → `gaps_in 0`, `gaps_out {top 0, right s, bottom b, left s}`
recomputed from the monitor (half height, centred 2:1 box while one tiled window, full width with two),
`no_border`, `on_created_empty = "[workspace special:scratchpad silent] omarchy-agent"` (qconsole.lua:48-60,
106-114); `decoration.dim_special = 0.6` (qconsole.lua:28-32); animations `specialWorkspaceIn` "slide top" /
`specialWorkspaceOut` "slide bottom" (qconsole.lua:195-196). Per-workspace `layout` rules restored from
`~/.local/state/omarchy/workspace-layouts/<id>.lua` (workspace-layouts.lua:6-8; written by
`omarchy-hyprland-workspace-layout-toggle`).

### I-5 Toggles (state flags sourced on every reload)

| Toggle | Chord | Flag file (`~/.local/state/omarchy/toggles/hypr/`) | Effect | Source |
|--------|-------|------|--------|--------|
| `window-no-gaps` | Super+Shift+Backspace; part of Super+Ctrl+Alt+F | `window-no-gaps.lua` | `gaps_in/gaps_out/border_size = 0`, `rounding = 0` | toggles/window-no-gaps.lua; `omarchy-hyprland-toggle` |
| `single-window-aspect-ratio` | Super+Ctrl+Backspace | `single-window-aspect-ratio.lua` | `layout.single_window_aspect_ratio = {1,1}` + notification "Enable/Disable single-window square aspect ratio" | toggles/single-window-aspect-ratio.lua |
| `flags.lua` | — | always present so the directory is never empty | no-op | toggles/flags.lua |
| `internal-monitor-disable.lua`, `internal-monitor-mirror.lua`, `internal-monitor-clamshell.lua` | Super+Ctrl+Delete / Super+Ctrl+Alt+Delete / lid | generated `hl.monitor(...)` lines | disable/mirror laptop output | `omarchy-hyprland-monitor-internal{,-mirror,-clamshell}` |
| `touchpad-disabled-name`, `touchscreen-disabled-name` | XF86TouchpadToggle / hardware menu | plain-text device name (never Lua) | `hl.device({name, enabled=false})` | disabled-input-device.lua; toggles.lua:11-21 |
| `bar-off` | Super+Shift+Space | (omarchy-toggle, not hypr dir) | bar hidden | `omarchy-toggle-bar` |
| nightlight | Super+Ctrl+N | (hyprsunset runtime) | 4000K ↔ 6500K | `omarchy-toggle-nightlight` |
| idle / stay-awake | Super+Ctrl+I | `~/.local/state/omarchy/indicators/stay-awake` | idle lock disabled | `omarchy-toggle-idle` |
| notification silencing | Super+Ctrl+Comma | (shell) | DND | `omarchy-toggle-notification-silencing` |
| workspace layout | Super+L | `~/.local/state/omarchy/workspace-layouts/<id>.lua` | `hl.workspace_rule({workspace, layout})` | `omarchy-hyprland-workspace-layout-toggle` |
| `zoom_factor` | Super+Ctrl+Z / Super+Ctrl+Alt+Z | (runtime only) | cursor zoom | utilities.lua:118-125 |

### I-6 Input settings (default/hypr/input.lua) and user overrides (config/hypr/input.lua)

| Setting | Default | Source | User override example |
|---------|---------|--------|-----------------------|
| `kb_layout` | `XKBLAYOUT` from `/etc/vconsole.conf`, else `us`; a leading non-Latin layout gets `us,` prepended | input.lua:26-47 | `kb_layout = "us,dk,eu"` (config/hypr/input.lua:9) |
| `kb_variant` | `XKBVARIANT` or `""` | input.lua:32 | `kb_variant = "intl"` (:13) |
| `kb_options` | `compose:caps,shift:both_capslock_cancel` (+ `grp:alts_toggle` for non-Latin) | input.lua:37, 47 | `grp:alts_toggle` (:10), `compose:ralt`, `altwin:swap_alt_win` (manual/34:41-74) |
| `kb_model`, `kb_rules` | `""` | input.lua:54, 56 | — |
| `follow_mouse` | 1 | input.lua:57 | — |
| `sensitivity` | 0 | input.lua:58 | `0.35` (:23) |
| `repeat_rate` / `repeat_delay` | 40 / 250 | input.lua:60-61 | `40 / 250` (:16-17) |
| `numlock_by_default` | true | input.lua:62 | (:20) |
| `accel_profile` | (Hyprland default adaptive) | — | `"flat"` (:26) |
| `touchpad.natural_scroll` | false | input.lua:65 | true (:30) — irrelevant in VM |
| `touchpad.clickfinger_behavior` | true | input.lua:66 | (:33) |
| `touchpad.scroll_factor` | 0.4 | input.lua:67 | (:36) |
| `touchpad.disable_while_typing`, `drag_3fg` | Hyprland defaults | — | (:39, :42) |
| `misc.key_press_enables_dpms`, `mouse_move_enables_dpms` | true | input.lua:71-74 | — |
| gestures | none | — | `hl.gesture({fingers=3, direction="horizontal", action="workspace"})` (:54-58) — no touchpad in VM |
| per-app `scroll_touchpad` | terminals | input.lua:78-81 | (:48-50) |

Menu path: Omarchy Menu → Setup → Input opens `~/.config/hypr/input.lua` in the editor
(omarchy-menu.jsonc:128). Non-Latin layout list mirrors `etc/mkinitcpio.conf.d/omarchy_hooks.conf`
(hyprland-keyboard-layout-test.sh:76-85).

### I-7 Monitor settings (config/hypr/monitors.lua) and helpers

| Item | Value / behaviour | Source |
|------|-------------------|--------|
| Catch-all | `hl.monitor({output="", mode="preferred", position="auto", scale=omarchy_monitor_scale})` with `omarchy_monitor_scale = "auto"` | monitors.lua:7-8 |
| GDK scale | `omarchy_gdk_scale = 2` → `hl.env("GDK_SCALE", "2")` (sizes X11/XWayland GTK only) | monitors.lua:21-22 |
| Specific monitor / rotation | commented `hl.monitor({output="DP-2", mode="2560x1440@144", position="0x0", scale=1})`, `transform=1` | monitors.lua:11, 14 |
| Disable a phantom output | `hl.monitor({output="DP-2", disabled=true})` | manual/33-monitors.md:53 |
| Step scaling | Super+/ and Super+Alt+/ walk `1 1.25 1.6 2 3 4`, snapped to a "clean" divisor of the mode, `hyprctl eval hl.monitor(...)`, then `sed` the two `local omarchy_*_scale =` lines in monitors.lua (only while the stock catch-all is present) and append to `~/.local/state/omarchy/monitor-scaling.log` | `omarchy-hyprland-monitor-scaling` |
| Menu path | Omarchy Menu → Setup → Monitors opens monitors.lua | omarchy-menu.jsonc:126 |
| Laptop display / mirror | Super+Ctrl+Delete, Super+Ctrl+Alt+Delete; "No laptop display found" when `omarchy-hyprland-monitor-laptop` is empty | `omarchy-hyprland-monitor-internal:26-29` |
| Recovery | `omarchy-hyprland-monitor-watch` (autostart) reloads with back-off while an *enabled* monitor reports 0×0 (modeless) — monitors disabled on purpose are ignored; reload guard `paused` suppresses recovery reloads | `omarchy-hyprland-monitor-modeless`, monitor-recovery-test.sh:40-56 |
| Reset | Omarchy Menu → Update → Config → Hyprland (`omarchy-refresh-hyprland`) overwrites all 7 user files, saving `*.bak.<epoch>` | omarchy-menu.jsonc:369, `omarchy-refresh-config` |
| Text size only | `omarchy display text size N` (9-20), not a Hyprland setting | manual/33:24-32 |

### I-8 Autostart (`hyprland.start` event only — not re-run on reload)

| Entry | Source |
|-------|--------|
| `systemctl --user import-environment $(env \| cut -d= -f1)` | default/hypr/autostart.lua:3 |
| `dbus-update-activation-environment --systemd --all` | :4 |
| `omarchy-launch-shell` (Quickshell bar/menus/notifications) | :6 |
| `omarchy-provision-first-run` | :7 |
| `omarchy-powerprofiles-init` | :8 |
| `uwsm-app -- omarchy-hyprland-monitor-watch` | :9 |
| `uwsm-app -- udiskie --automount --no-notify --no-tray` | :10 |
| `sleep 2 && omarchy-hook post-boot` | :13 |
| user: `o.launch_on_start("my-service")` (commented example) | config/hypr/autostart.lua:2 |
| hyprsunset: not autostarted; `hyprsunset.conf` ships an `identity = true` 07:00 profile so it does nothing if started; user adds `o.launch_on_start("hyprsunset")` + a 20:00 / 4000 K profile | config/hypr/hyprsunset.conf:1-14 |

### I-9 Environment variables (`hl.env`, reach exec'd apps and keybind dispatchers)

| Variable | Value | Source |
|----------|-------|--------|
| (theme gum vars) | `omarchy.current.theme.gum_env` optional module | envs.lua:6 |
| `XCURSOR_SIZE`, `HYPRCURSOR_SIZE` | 24 | envs.lua:9-10 |
| `GDK_BACKEND` | `wayland,x11,*` | :13 |
| `QT_QPA_PLATFORM` | `wayland;xcb` | :14 |
| `QT_QPA_PLATFORMTHEME` | `gtk3` | :15 |
| `MOZ_ENABLE_WAYLAND` | 1 | :16 |
| `ELECTRON_OZONE_PLATFORM_HINT`, `OZONE_PLATFORM` | wayland | :17-18 |
| `XDG_SESSION_TYPE` | wayland | :19 |
| `XDG_CURRENT_DESKTOP`, `XDG_SESSION_DESKTOP` | Hyprland | :22-23 |
| `XCOMPOSEFILE` | `~/.XCompose` | :26 |
| `OMARCHY_PATH` | `/usr/share/omarchy` (or `$OMARCHY_PATH`) | :29 |
| `PATH` | `$OMARCHY_PATH/bin` moved to the front | :31-37 |
| `NVD_BACKEND`, `LIBVA_DRIVER_NAME`, `__GLX_VENDOR_LIBRARY_NAME` | only when `omarchy-hw-nvidia` succeeds (direct/nvidia/nvidia with GSP; egl/nvidia without) — **unset in the VM** | nvidia.lua:10-19 |
| `GDK_SCALE` | from user monitors.lua (2) | config/hypr/monitors.lua:22 |
| Hyprland options set alongside | `xwayland.force_zero_scaling = true`, `ecosystem.no_update_news = true` | envs.lua:41-49 |

### I-10 Look and feel defaults the user is told to override (default/hypr/looknfeel.lua ↔ config/hypr/looknfeel.lua)

`general`: gaps_in 5, gaps_out 10, border_size 2, active border gradient `33ccffee→00ff99ee` 45°, inactive
`595959aa`, `resize_on_border false`, `allow_tearing false`, `layout "dwindle"` (looknfeel.lua:7-20).
`decoration`: rounding 0, shadow off, blur off (:22-32). `group.groupbar`: monospace 12, height 22,
gradients, active `00000040` (:34-60). Animations on; curves and per-leaf speeds (:62-88; `workspaces`
animation disabled, `fadeSwitch` disabled). `dwindle.preserve_split`, `force_split 2`;
`scrolling.column_width 0.49`; `master.new_status "master"`; `misc`: logo/splash off,
`disable_scale_notification`, `focus_on_activate`, `anr_missed_pings 3`, `on_focus_under_fullscreen 1`,
`initial_workspace_tracking 0`, `allow_session_lock_restore`; `cursor.hide_on_key_press`,
`warp_on_change_workspace 1`; `binds.hide_special_on_workspace_change` (:90-125). User file offers
commented blocks for gaps 0/border 0, `layout = "scrolling"`, `rounding = 8`, `dim_inactive`,
`animations.enabled = false`, `single_window_aspect_ratio`, `scrolling.column_width 0.97`
(config/hypr/looknfeel.lua:4-50; manual/42:11-37; manual/04:41-49). Menu path: Omarchy Menu → Style →
Hyprland opens looknfeel.lua (omarchy-menu.jsonc:111).

### I-11 `omarchy-menu-keybindings` viewer (Super+K; `--print`/`-p` for text)

- Sources `hyprctl binds` (plain text, not JSON) and, for Lua binds reported as dispatcher `__lua`, a
  source-derived cache built by re-running `~/.config/hypr/hyprland.lua` under a stub `hl` (lines 69-241).
- Resolves `code:N` via `xkbcli compile-keymap` (fallback table 10-19 digits, 20 MINUS, 21 EQUAL, 59 COMMA,
  60 PERIOD, 61 SLASH); GRAVE renders as `~`; `mouse:272/273/274` → LEFT/RIGHT/MIDDLE MOUSE BUTTON (15-67).
- Hides `code:201` (Copilot key) rows (310); lowercase `comma/grave/period/minus/equal/slash` → upper
  (312-319); strips `uwsm-app --` prefixes.
- Merges an action's alternative chord onto one row only for the named actions "Close window",
  "Calculator", "Toggle scratchpad", "Move window to scratchpad", and only if the pair fits 35 columns
  (339-346, 401-424): expect `SUPER + W / SUPER + Q → Close window`, `SUPER + S / SUPER + ~ → Toggle scratchpad`.
- Row format `%-35s → %s`; ordering by a priority table (Keybindings, Omarchy menu, Terminal, Browser,
  File manager, … XF86 rows last) (435-503).
- Enter on a row dispatches it (`exec` → `hl.dsp.exec_cmd`, `lua` → `hyprctl dispatch <expr>`,
  `sendshortcut` → `send_key_state` down/up) (589-653, 657-669).
- Cache `~/.cache/omarchy/keybindings-<sha256 of v13 + active keymap + hyprctl binds>.records`; a new bind
  or layout invalidates it; an empty `hyprctl binds` is never cached (531-570).
- Menu path: Omarchy Menu → Learn → Keybindings (omarchy-menu.jsonc:45); Setup → Keybindings opens
  `~/.config/hypr/bindings.lua` (:127).

### I-12 Config files the user is meant to edit, and their menu entry points

| File | Menu path | Reset |
|------|-----------|-------|
| `~/.config/hypr/hyprland.lua` | Setup → Config → Hyprland | Update → Config → Hyprland (`omarchy-refresh-hyprland`, all seven files + `flags.lua`) |
| `~/.config/hypr/bindings.lua` | Setup → Keybindings | same |
| `~/.config/hypr/input.lua` | Setup → Input | same |
| `~/.config/hypr/monitors.lua` | Setup → Monitors | same |
| `~/.config/hypr/looknfeel.lua` | Style → Hyprland | same |
| `~/.config/hypr/autostart.lua` | (none; edit by hand) | same |
| `~/.config/hypr/hyprsunset.conf` | Setup → Config → Hyprsunset (then `omarchy-restart-hyprsunset`) | Update → Config → Hyprsunset |
| `~/.config/hypr/xdph.conf` | (none) | not refreshed by `omarchy-refresh-hyprland` |
| `~/.XCompose` | Setup → Config → XCompose | — |

## Observations

- **O-1 Version skew.** HEAD is 4.0.0.alpha dev line; the minted disk is 4.0.2. Bindings that look recent
  (Super+Ctrl+Backspace square aspect, Super+Ctrl+Alt+F fullscreen desktop, Super+Ctrl+1-9 bar panels,
  Super+Ctrl+Z zoom, Super+Ctrl+Return herdr, the scratchpad Grave aliases, the slurp selection binds,
  Super+Alt+Home width save) may be missing on the guest. Every test that uses one must first confirm the
  row in Super+K and report "binding absent on this build" rather than "broken" when it is not listed.
- **O-2 Chords the driver cannot send.** `send-keys` has no token for any XF86 media / brightness /
  touchpad / power / calculator key (rows 140, 145, 210-237), the Copilot key `code:201` (138), or the lid
  switch (162-163). Their *commands* can still be run from a terminal (absence path), so those tests are
  VM-PARTIAL or VM-NO. Everything else is drivable by the real chord: `<PRINT>`, `<A-PRINT>`, `<M-PRINT>`,
  `<M-C-PRINT>` for the capture family, `<CAPSLOCK>` for the compose key (quick emojis and completions),
  `<A-alt_r>` for the Left Alt + Right Alt layout toggle, `<F9>` for push-to-talk.
- **O-3 Key notation is verified.** `<M-,> <M-`> <M-/> <M--> <M-=> <M-.> <M-;>` and `<M-A-[>`/`<M-A-]>`
  parse, so punctuation chords are pressed directly — no letter-alias fallback. Number rows are bound by
  keycode (`code:10-19`), so `<M-S-1>` fires even though Shift+1 produces `!`. Bare `<META_L>` does nothing
  (nothing is bound to a lone Super tap).
- **O-4 Screen geometry.** The virtio-vga output shows up in Hyprland as `Virtual-1` at 1280×800; scale
  `"auto"` resolves to 1 there, so the scaling ladder is 1 → 1.25 → 1.6 → 2 → 3 (shown as 3.2, the clean
  divisor for 1280×800) → 4. At 4 the logical desktop is 320×200 and the bar overflows — step at most one
  notch up and come straight back. The `omarchy-hyprland-window-pop` default of 1300×900 is larger than the
  logical screen; Hyprland clamps it, so a popped window fills the screen minus gaps rather than floating
  in the middle. The scratchpad panel on 1280×800 with the bar reserved is a 770×385 box (left/right gap 255).
- **O-5 Super-key handling.** Nothing is bound to a bare Super tap; `<META_L>` does nothing. Hyprland
  resolves keysym binds against the *first* layout in `kb_layout`, so after a user puts a non-Latin layout
  first the defaults stop firing — default/hypr/input.lua:39-47 guards the installer case by prepending
  `us`, but not a user edit. Alt+Tab is deliberately double-bound (cycle + bring_to_top); the conflict test
  allows only that pair (hyprland-binding-conflicts-test.sh:127-130).
- **O-6 Autoreload and the guard.** Hyprland re-reads the config on save (`misc.disable_autoreload` is
  false) and shows a red error banner at the top of the screen when the Lua config throws; `hyprctl
  configerrors` lists the text. During a package transaction `omarchy-hyprland-reload-guard pause` flips
  `disable_autoreload` and `debug.suppress_errors` to true, and `resume` restores them after exactly one
  forced reload (reload-guard:78-106). The state dir is `/run/omarchy/hyprland-reload-guard` (root).
- **O-7 A broken user file has ordered fallout.** `hyprland.lua` requires monitors → input → bindings →
  looknfeel → autostart → toggles. A syntax error in `bindings.lua` leaves the *defaults* (loaded earlier)
  in place but skips looknfeel, autostart and the toggles/workspace-layout restore for that reload, so a
  no-gaps toggle or a scrolling workspace silently reverts to default until the file is fixed. The test
  `hypr-user-config-syntax-error-banner` checks this.
- **O-8 Reload does not re-run autostart.** `hl.on("hyprland.start")` fires once per compositor start, so a
  new `o.launch_on_start` needs a logout/login (Super+Escape → Logout, then SDDM) or reboot.
- **O-9 Missing preinstalled apps.** On the minted disk spotify, signal-desktop, 1password and voxtype are
  not installed. Super+Shift+M / Super+Shift+G / Super+Shift+/ open a floating "Omarchy" terminal
  (`org.omarchy.terminal`, 875×600 centred, Omarchy logo) that runs the installer and needs network; Ctrl+C
  aborts it (exit 130 skips the Done/Failed prompt). Super+Ctrl+X and F9 are simply unbound (voxtype.lua
  guard) and absent from Super+K.
- **O-10 Docker chord prompts for a password.** Super+Shift+D runs `pkexec lazydocker` because the user is
  not in the docker group (system-test.sh:86-100); a polkit dialog asks for `prime`. Cancelling leaves a
  terminal with the pkexec failure.
- **O-11 Universal clipboard depends on the `terminal` tag.** foot is tagged (terminals.lua) and its
  `foot.ini` binds Ctrl+Insert copy / Shift+Insert paste (config/foot/foot.ini:18-20), so Super+C/V work in
  the terminal. In chromium they become Ctrl+C/V. Super+X is always Ctrl+X (manual: "not in terminal").
- **O-12 ANR dialog on a slow guest.** `misc.anr_missed_pings = 3` means chromium or obsidian starting on 2
  vCPU can trigger Hyprland's "application not responding" dialog; the driver must click *Wait*, not
  *Terminate*, and must not report it as an app crash.
- **O-13 Cursor and animation timing.** `cursor.hide_on_key_press = true` hides the pointer after any
  key, so a screenshot after `send-keys` shows no cursor — move the mouse first when the pointer matters.
  Window open/close animations (popin) take ~0.3 s; take the verification screenshot a second after the
  chord. `initial_workspace_tracking = 0` means an app launched just before Super+2 opens on workspace 2.
- **O-14 Layer surfaces and `send_key_state`.** The clipboard binds send the shortcut to the focused
  surface without a window target so Quickshell panels receive it too; a driver test in a panel text field
  (e.g. the emoji search) is a legitimate target.
- **O-15 Viewer priority table drift.** `prioritize_entries` matches descriptions that no longer exist
  ("Audio controls", "Wifi controls", "Toggle workspace gaps", "Cycle to"); those rows fall to the default
  priority 50, which is cosmetic (rows still appear) — worth a note in the viewer test, not a failure.
- **O-16 Empty battery notification.** `omarchy-battery-status` prints nothing and exits 0 with no
  battery, so Super+Ctrl+Alt+B posts a notification with an icon and an empty body on the guest — a
  sensible-message gap to record.
- **O-17 Bar panel numbering.** Super+Ctrl+1-9 counts panels in the bar's right section; the guest bar has
  fewer than nine (no battery/bluetooth/wifi), so the tail of the range must do nothing without error.
- **O-18 Screen recording.** `gpu-screen-recorder` has no GPU encoder on virtio-vga; expect an error or
  CPU fallback — record whichever happens.
- **O-19 The `.*` `suppress_event = maximize` rule** means chromium's own "maximize" (double-click its tab
  strip) does nothing; only Super+Alt+F maximizes.
- **O-20 Test hygiene.** Toggles (`window-no-gaps`, workspace layouts, monitor scale, `stay-awake`) and any
  edit to `~/.config/hypr/*` persist on the disk; every test that changes them must undo them (or the run
  must end with `stop`). `omarchy-refresh-hyprland` is the universal reset.

## Proposed tests

Conventions: "a terminal" is the window Super+Return opens (foot). "Focused" = the window with the
cyan→green gradient border; unfocused windows have a grey border. Every step is a `send-keys`, `mouse …`,
`get-image` or, for long text, a command in the guest terminal ending in `| sudo tee /dev/ttyS0` read with
`get-serial`. Every test starts on the stock minted desktop with no windows open and ends there.

Driver quirks that recur (each test names the ones it hits): Chromium/Obsidian may raise Hyprland's
"application not responding" dialog on 2 vCPU — click **Wait**; before reporting a chord broken, press
Super+K and check the row exists on this build (HEAD-only chords may be absent on 4.0.2); a broken
`~/.config/hypr/bindings.lua` leaves the defaults working but skips looknfeel/autostart/toggles on that reload;
the pointer hides after any key press (move the mouse before a screenshot that needs it); window animations
take ~0.3 s, screenshot a second after the chord.

### hypr-window-close-and-close-all   [VM-OK]
description: Super+W or Super+Q closes the focused window and Ctrl+Alt+Delete closes every window on every workspace and returns to workspace 1; on an empty desktop all three are harmless.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+W, Super+Q and Ctrl+Alt+Delete on the empty desktop: nothing may change (bar stays, no dialog).
  * Press Super+Return twice; two terminals tile side by side, the right one focused. Press Super+W: it closes and the left one fills the screen. Press Super+Return again and Super+Q: the focused one closes.
  * Press Super+2, Super+Return, Super+Shift+Return (browser), then Super+3 and Super+Ctrl+Q (calculator).
  ** If Chromium shows an "application not responding" dialog, click Wait.
  * Press Ctrl+Alt+Delete. Within a few seconds every window is gone and the bar shows workspace 1 active; Super+2 and Super+3 show empty workspaces.
  * Press Super+K, type `Close window`: one merged row `SUPER + W / SUPER + Q → Close window`. Press Escape.
  * The desktop must be as you found it: empty, workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+Alt+Delete is a Hyprland bind here, not a VT switch; a text console means the wrong key was sent.
  * Chromium takes 10–20 s to appear; wait for it before the close-all.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: empty desktop unchanged after the three chords; one terminal left after Super+W and after Super+Q; four windows across workspaces; empty workspace 1 right after Ctrl+Alt+Delete; the merged Super+K row
  * If unsuccessful
  ** Screenshot of a window that survived or of a text console / crash dialog
covers: default/hypr/bindings/tiling.lua:1-3; bin/omarchy-hyprland-window-close-all; bin/omarchy-menu-keybindings (alternative_chord_actions); test/shell.d/hyprland-window-close-all-test.sh; manual/07:13-14

### hypr-window-float-pseudo-split   [VM-OK]
description: Super+T floats and re-tiles the focused window, Super+P makes a tile pseudo (natural size in its slot) and Super+J flips the dwindle split between side-by-side and stacked — the three shape chords from the navigation manual.
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

### hypr-window-fullscreen-modes   [VM-OK]
description: Super+F covers the whole screen, Super+Alt+F fills the workspace but keeps the top bar, and Super+Ctrl+F only tells the app it is fullscreen while it stays in its tile — three chords a user reaches for with video.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+Shift+Return so a terminal and Chromium share the screen.
  ** Click Wait if Chromium raises the "not responding" dialog.
  * With Chromium focused press Super+F: Chromium covers the entire screen, top bar included; the terminal is hidden. Press Super+F again: the split returns.
  * Press Super+Alt+F: Chromium fills the workspace with no gaps but the top bar stays visible. Press Super+Alt+F again.
  * Press Super+Ctrl+F: Chromium stays in its half of the screen but hides its own tab strip and address bar (the page fills the tile). Press Super+Ctrl+F again: the tab strip returns.
  ** Tiled full screen is a newer chord; if Super+K has no "Tiled full screen" row on this build, report it absent rather than failed.
  * Close both windows; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar being visible or not is the tell between Super+F and Super+Alt+F.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three states (no bar / bar kept / tile with hidden browser chrome) and the restored split after each
  * If unsuccessful
  ** Screenshot of the wrong state after the chord
covers: default/hypr/bindings/tiling.lua:8-10; bin/omarchy-hyprland-window-tiled-fullscreen-toggle; test/shell.d/hyprland-window-test.sh; manual/04:27; manual/07:20-22

### hypr-window-pop-super-o   [VM-OK]
description: Super+O pops the focused window out into a pinned floating window with rounded corners that follows across workspaces, and a second Super+O tiles it back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice.
  * Press Super+O: the focused terminal becomes floating, centred, drawn above the other, with visibly rounded corners.
  ** The pop size defaults to 1300×900, larger than the 1280×800 guest screen, so Hyprland clamps it; it may nearly fill the screen. That is expected.
  * Press Super+2: the popped terminal is still on screen over the empty workspace 2; the other terminal is not.
  * Press Super+1, then Super+O again: the terminal tiles beside the first one, corners square; Super+2 is now empty.
  * Press Super+1 and close both terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Rounded corners (rounding 8) on the popped window are the visual proof of the `pop` tag.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the popped window on workspace 1, the same window over empty workspace 2, tiled again on 1, and workspace 2 empty
  * If unsuccessful
  ** Screenshot after Super+O with the window still tiled or not following to workspace 2
covers: default/hypr/bindings/tiling.lua:11; bin/omarchy-hyprland-window-pop; default/hypr/apps/system.lua:54; manual/04:57-61; manual/07:17

### hypr-window-focus-swap-cycle   [VM-OK]
description: Super+Arrow moves focus toward a neighbour, Super+Shift+Arrow swaps the focused window with it, and Alt+Tab / Alt+Shift+Tab cycle focus while raising the window — with edges and single windows behaving harmlessly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return three times and label the terminals by typing `echo A`, `echo B`, `echo C` Enter in each (click each to focus it).
  * Click A (the left column). Press Super+Right: focus moves to a right-column terminal (gradient border). Press Super+Up / Super+Down: focus moves between the two stacked ones. Press Super+Left twice: focus returns to A and stays there on the second press.
  * With A focused press Super+Shift+Right: A swaps places with the right neighbour and keeps focus. Press Super+Shift+Left: back. Press Super+Shift+Up and Super+Shift+Down on a stacked one: the stacked order flips each time.
  * Press Alt+Tab three times: each press moves focus to a different terminal and the third returns to the start. Press Alt+Shift+Tab: one step back.
  * Press Super+T on B and on C so they float overlapping; focus B, press Alt+Tab until C is focused: C is now drawn on top of B.
  * Close all three terminals; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Focus warps the pointer into the new window; it is hidden after key presses, so move the mouse a pixel if you need to show it.
  * Read the `echo` letters, not positions, to tell windows apart after swaps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** A screenshot per chord showing the gradient border on the expected letter, the swapped positions, the Alt+Tab cycle, and C on top of B after Alt+Tab
  * If unsuccessful
  ** Screenshot with focus or position unchanged after a chord
covers: default/hypr/bindings/tiling.lua:16-19,42-50; test/shell.d/hyprland-binding-conflicts-test.sh:125-130; manual/04:12,19; manual/07:32-33,56-57

### hypr-window-resize-and-width-memory   [VM-OK]
description: The twelve keyboard resize chords change the focused tile by 100, 25 or 300 px horizontally or (with Shift) vertically, and Super+Alt+Home / Super+Home remember and restore a window's width per app and workspace, telling the user when nothing is saved.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice; the right terminal is focused. Press Super+Home first: a notification "No saved width found for foot on workspace 1 … Use Super + Alt + Home to save one" appears and nothing resizes.
  * Press Super+Minus, then Super+Equal: the split line moves left by about 100 px (the right terminal widens) and back. Press Super+Alt+Minus / Super+Alt+Equal: a small (25 px) move and back. Press Super+Ctrl+Minus / Super+Ctrl+Equal: a large (300 px) move and back.
  * Press Super+J to stack them and focus the bottom one. Press Super+Shift+Equal / Super+Shift+Minus (100 px), Super+Shift+Alt+Equal / Super+Shift+Alt+Minus (25 px), Super+Ctrl+Shift+Equal / Super+Ctrl+Shift+Minus (300 px): the horizontal split moves down and back by the three magnitudes. Press Super+J to unstack.
  * Press Super+Ctrl+Minus to widen the right terminal, then Super+Alt+Home: notification "Saved width for foot on workspace 1 … Restore using Super + Home". Press Super+Ctrl+Equal twice so it is much narrower, then Super+Home: it returns to the saved width.
  * Close one terminal and press Super+Minus on the lone window: nothing changes.
  * In the remaining terminal run `rm ~/.local/state/omarchy/windows/workspace-1-foot.width` so the disk is clean, then close it.
  ** If Super+K has no "Save window width" row on this build, skip the memory steps and report the chord absent.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The split line position between the two terminals is the visual measure; 25 px is subtle, compare screenshots side by side.
  * Notifications appear top-right and fade within seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "No saved width" notification; the split at three horizontal and three vertical magnitudes and back; the "Saved width" notification; the restored width after Super+Home
  * If unsuccessful
  ** Screenshot after a resize chord with the split unmoved, or after Super+Home with the width unchanged
covers: default/hypr/bindings/tiling.lua:12-13,55-68; bin/omarchy-hyprland-window-width; manual/07:34-41

### hypr-window-super-drag-move-resize   [VM-OK]
description: Holding Super while dragging with the left mouse button moves a window and with the right button resizes it — the only two mouse-driven window binds.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, then Super+T so the terminal floats roughly centred.
  * Drag with the left button while holding Super from the middle of the terminal (x≈0.5, y≈0.5) to x≈0.2, y≈0.3: the terminal moves toward the top-left.
  * Drag with the right button while holding Super from inside the terminal toward the bottom-right by about a fifth of the screen: the terminal grows.
  * Press Super+T to tile it again and Super+Return for a second terminal. Super+left-drag the tiled terminal onto the other one: dwindle swaps or re-slots the two (record what happened; it must not crash).
  * Close both terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse drag --modifier super [--button right]`; the pointer is an absolute tablet so fractions are exact.
  * Move the mouse before the screenshot if you need the pointer visible.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the floating terminal before and after the move (position changed) and after the resize (larger), and the tiled drag outcome
  * If unsuccessful
  ** Screenshot after the drag with the window unmoved and the exact client command used
covers: default/hypr/bindings/tiling.lua:73-74; manual/04:23; manual/07:42-43

### hypr-window-groups   [VM-OK]
description: Super+G turns a window into a tabbed group that new windows join; Super+Ctrl+Left/Right, Super+Alt+Tab, Super+Alt+1-5 and Super+Alt+scroll switch tabs, Super+Alt+Arrow pulls a window in, Super+Alt+G ejects one and Super+G dissolves the group.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `echo ONE` Enter, press Super+G: a tab strip (group bar) appears above the terminal.
  * Press Super+Return, `echo TWO`, Super+Return, `echo THREE`: each opens as a new tab in the group, not a new tile (three tabs).
  * Press Super+Ctrl+Left (TWO shows), Super+Ctrl+Right (THREE), Super+Alt+1 (ONE), Super+Alt+2 (TWO), Super+Alt+3 (THREE), Super+Alt+Tab (ONE), Super+Alt+Shift+Tab (THREE), Super+Alt+4 and Super+Alt+5 (nothing changes — no such tab). Scroll the wheel over the group bar with Super+Alt held: the tab changes each notch.
  * Press Super+Alt+G: the visible terminal leaves the group and tiles beside it (two tabs remain). With the ejected window focused press Super+Alt+Left or Super+Alt+Right toward the group: it re-joins as a tab.
  * Focus the group and press Super+G: the tab strip disappears and the three terminals tile normally.
  * Close all three.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The group bar is a 22 px strip with window titles in the theme colours, directly above the window content.
  * If Super+Alt+scroll cannot be sent with two modifiers, note it and rely on the keyboard variants.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of one tab, three tabs, each tab switch showing the right `echo` text, the ejected window tiled next to a two-tab group, re-joined, and the dissolved tiles
  * If unsuccessful
  ** Screenshot after the chord that did not switch/eject/dissolve
covers: default/hypr/bindings/tiling.lua:76-95; default/hypr/looknfeel.lua:34-60; manual/04:51-55; manual/07:45-51

### hypr-desktop-gaps-bar-fullscreen-toggles   [VM-OK]
description: Super+Shift+Backspace removes gaps and borders, Super+Shift+Space hides the bar, Super+Ctrl+Alt+F does both together, and Super+Ctrl+Backspace caps a lone window to a square — each a persisted toggle that survives a reload and restores cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice and note the gaps between the terminals and the screen edges.
  * Press Super+Shift+Backspace: gaps and borders vanish and the terminals touch. In a terminal run `hyprctl reload`: they stay gapless (the toggle is sourced on reload). Press Super+Shift+Backspace again: gaps return.
  * Press Super+Shift+Space: the bar hides and the terminals move up. Press it again: bar back.
  * Press Super+Ctrl+Alt+F: bar hidden *and* gaps gone. Press it again: both back. Press Super+Shift+Space (bar off) then Super+Ctrl+Alt+F: both halves go to full screen desktop; Super+Ctrl+Alt+F once more restores both.
  ** If Super+K has no "Toggle full screen desktop" row on this build, report it absent and skip that step.
  * Close one terminal. Press Super+Ctrl+Backspace: notification "Enable single-window square aspect ratio" and the lone terminal shrinks to a roughly square tile centred with wallpaper either side; Super+Return opens a second one and both fill the width; Super+W; Super+Ctrl+Backspace again: "Disable …" and full width.
  * Run `ls ~/.local/state/omarchy/toggles/hypr/`: only `flags.lua`. Close the terminal; bar visible, gaps present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Square" on the 1280×800 guest is about 770 px wide.
  * The same toggles are under Omarchy Menu → Trigger → Toggle.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with/without gaps (and still gapless after reload), with/without the bar, both off together, the square lone window with its notification, the `flags.lua`-only listing and the stock desktop at the end
  * If unsuccessful
  ** Screenshot of a toggle that did not flip or the toggles listing with a leftover file
covers: default/hypr/bindings/utilities.lua:16,20-22; default/hypr/toggles.lua; default/hypr/toggles/window-no-gaps.lua; default/hypr/toggles/single-window-aspect-ratio.lua; bin/omarchy-hyprland-toggle; bin/omarchy-toggle-bar; bin/omarchy-toggle-fullscreen-desktop; manual/42:24-37; manual/07:177,192-194

### hypr-workspace-switch-and-move   [VM-OK]
description: Super+1…9/0 switch to workspaces 1-10, Super+Shift+N moves the focused window there and follows, Super+Shift+Alt+N moves it without following — as the navigation manual teaches, with the bar indicator as the witness.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo MOVER` Enter.
  * Press Super+2 through Super+9 and Super+0 in turn: after each the bar highlights that number and the desktop is empty; on workspace 10 press Super+Return and run `hyprctl activeworkspace | head -1` to see `workspace ID 10`, then close it. Press Super+1: MOVER is back.
  * Press Super+Shift+2: you land on workspace 2 with MOVER; Super+1 shows an empty workspace 1. Then walk the rest: Super+Shift+3, Super+Shift+4 … Super+Shift+9, Super+Shift+0 — each time you follow MOVER to that workspace — and finish with Super+Shift+1.
  * Press Super+Shift+Alt+3: MOVER disappears but you stay on workspace 1 (bar shows 1 active, 3 present). Press Super+3: MOVER is there. Now walk the silent form from 3: Super+Shift+Alt+4, then Super+4, Super+Shift+Alt+5, Super+5 … up to Super+Shift+Alt+0 and Super+0, then Super+Shift+Alt+2, Super+2, Super+Shift+Alt+1 and Super+1: MOVER is back on 1 and you never moved with it.
  ** One screenshot per number is enough; the bar highlight staying put is the silent-move proof.
  * Press Super+Shift+1 with MOVER already on 1, and Super+Shift+Alt+4 on an empty workspace (Super+5 first): nothing happens either time.
  * Press Super+1 and close MOVER; the desktop is empty on workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Empty workspaces vanish from the bar when you leave them; only occupied ones stay listed.
  * Workspace switching has no animation in Omarchy.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots for each Super+N; MOVER on 2 and 7 after the follow moves; still on 1 with 3 listed after the silent move; MOVER back on 1
  * If unsuccessful
  ** Screenshot after the chord with the wrong workspace highlighted or the window in the wrong place
covers: default/hypr/bindings/tiling.lua:21-26; manual/04:21; manual/07:23,27-28

### hypr-workspace-tab-scroll-navigation   [VM-OK]
description: Super+Tab / Super+Shift+Tab step through existing workspaces, Super+Ctrl+Tab bounces to the previously focused one, and Super+wheel over the desktop does the same as Tab.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return on workspace 1, Super+3 and Super+Return, Super+5 and Super+Return, then Super+1 (three occupied workspaces).
  * Press Super+Tab: workspace 3 (next *existing*). Super+Tab: 5. Super+Tab once more: record whether it stays on 5 or wraps.
  * Press Super+Shift+Tab: 3. Again: 1.
  * Press Super+5, then Super+Ctrl+Tab: 1 (the former workspace). Super+Ctrl+Tab: 5.
  * Move the mouse over the wallpaper and scroll down one notch with Super held: the bar steps to the next workspace; scroll up with Super held: back. Scroll without Super over a terminal: the workspace does not change.
  * Press Ctrl+Alt+Delete; the desktop is empty on workspace 1.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse scroll --modifier super`; if the client cannot combine a modifier with scroll, report the tooling gap.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots showing 1→3→5, back to 1, the 5↔1 bounce, and the Super+scroll steps
  * If unsuccessful
  ** Bar screenshot after the chord that landed on the wrong workspace
covers: default/hypr/bindings/tiling.lua:33-35,70-71; manual/07:24-26,44

### hypr-multi-monitor-chords-single-display   [VM-PARTIAL]
description: With one display, the move-workspace-to-monitor, focus-next-monitor, laptop-display and mirroring chords must be harmless no-ops or refuse with a notification and write no toggle files (absence path; the positive paths need a second screen or a laptop panel).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return.
  * Press Super+Shift+Alt+Left, Super+Shift+Alt+Right, Super+Shift+Alt+Up, Super+Shift+Alt+Down: the terminal stays put; no notification or banner.
  * Press Ctrl+Alt+Tab and Ctrl+Alt+Shift+Tab: focus stays on the terminal.
  * Press Super+Ctrl+Delete: notification "No laptop display found"; the screen stays on. Press Super+Ctrl+Alt+Delete: record the mirroring notification; the screen stays on.
  * Run `ls ~/.local/state/omarchy/toggles/hypr/`: only `flags.lua` (no `internal-monitor-*.lua` was written).
  * Open Omarchy Menu → Trigger → Hardware and record whether laptop-display entries are hidden or present. Escape. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: moving a workspace to another output, disabling/mirroring a real internal panel — no second monitor, no laptop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots after each chord with the terminal unmoved and focused, the two notifications, the `flags.lua`-only listing, the Hardware menu
  * If unsuccessful
  ** A black screen, an error banner, a missing notification, or an `internal-monitor-*.lua` file in the listing
covers: default/hypr/bindings/tiling.lua:37-40,52-53; default/hypr/bindings/utilities.lua:33-34; bin/omarchy-hyprland-monitor-internal; test/shell.d/monitor-output-name-test.sh; manual/07:31,58-59,189-190; manual/33:34-37

### hypr-scratchpad-quake-console   [VM-OK]
description: The scratchpad is a Quake console: Super+S or Super+Grave drops it over the current workspace dimming what is beneath, Super+Alt+S / Super+Shift+Grave send a window there, one window shows as a centred half-height panel and two make it full width, and changing workspace hides it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo BELOW` Enter. Press Super+S: a dimmed overlay covers the workspace (the console may be empty — no default agent is installed). Press Super+S again: gone.
  * Press Super+Return, type `echo CONSOLE` Enter, press Super+Alt+S: CONSOLE vanishes from the workspace without following.
  * Press Super+Grave: CONSOLE drops from the top as a centred, borderless panel about half the screen height and twice as wide as tall (≈770×385 on the guest); BELOW is dimmed beneath.
  * Press Super+Return while the console is open: the new terminal opens on the scratchpad and the console widens to full width, two side by side. Press Super+W: back to the centred panel.
  * Press Super+2: the console hides. Press Super+1, Super+Grave: it reopens. Press Super+Shift+Grave on a workspace window (focus BELOW first with the mouse, then Super+Shift+Grave): BELOW also moves onto the scratchpad (full width again).
  * Press Super+Shift+1 on each console window to bring both back to workspace 1, then close them; the desktop is empty.
  ** The Grave aliases and the centred panel are newer; on 4.0.2 the console may span the full width and Super+Grave may be missing from Super+K — record the geometry and use Super+S / Super+Alt+S instead of failing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Grave is the key left of 1: `<M-`>` and `<M-S-`>`.
  * The dimming (0.6) of the workspace beneath is the tell that a special workspace is open.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dimmed empty console, CONSOLE gone from the workspace, the centred panel, two windows full width, the panel again, hidden after Super+2, reopened with Super+Grave, and the empty desktop after Super+Shift+1
  * If unsuccessful
  ** Screenshot of the console with wrong geometry or a chord that did nothing
covers: default/hypr/bindings/tiling.lua:28-31; default/hypr/qconsole.lua; default/hypr/looknfeel.lua:122-124; test/shell.d/hyprland-qconsole-test.sh; manual/04:63-69; manual/07:29-30

### hypr-workspace-layout-toggle-and-default   [VM-OK]
description: Super+L switches the current workspace between dwindle and the scrolling layout with a notification, persists per workspace across a reload, and the looknfeel.lua `layout = "scrolling"` tweak makes scrolling the default for new workspaces.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return three times on workspace 1: dwindle shows all three.
  * Press Super+L: notification "Workspace layout set to scrolling" and the terminals rearrange into half-width columns with the third pushed off the right edge; Super+Right / Super+Left scroll the row.
  * Press Super+2 and open two terminals: they tile dwindle (the choice is per workspace). Press Super+1 and run `hyprctl reload` in a terminal: workspace 1 is still scrolling.
  * Press Super+L: "Workspace layout set to dwindle", all three visible again.
  * Run `printf '%s\n' 'hl.config({ general = { layout = "scrolling" } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload`, press Super+3 and open three terminals: scrolling columns without pressing Super+L.
  * Remove the line and reload: `sed -i '$d' ~/.config/hypr/looknfeel.lua && hyprctl reload`; Super+4 with two new terminals tiles dwindle. Run `rm -f ~/.local/state/omarchy/workspace-layouts/*.lua`, then Ctrl+Alt+Delete.
  ** A broken edit to looknfeel.lua shows a red banner at the top; fix the line and reload before continuing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The same toggle is under Omarchy Menu → Trigger → Toggle → Workspace Layout; Style → Hyprland opens looknfeel.lua in the editor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of dwindle, scrolling columns with the notification, dwindle on workspace 2, scrolling still on after reload, dwindle restored, scrolling by default on workspace 3, dwindle again after the cleanup
  * If unsuccessful
  ** Screenshot after Super+L with the layout unchanged, or a banner after the looknfeel edit
covers: default/hypr/bindings/tiling.lua:14; bin/omarchy-hyprland-workspace-layout-toggle; default/hypr/workspace-layouts.lua; default/hypr/looknfeel.lua:19,96-98; config/hypr/looknfeel.lua:4-14; test/shell.d/hyprland-workspace-layout-test.sh; manual/04:29-49

### hypr-launch-terminal-browser-files   [VM-OK]
description: The essential launch chords open the terminal (in the focused terminal's directory), the browser (normal and incognito) and the file manager (home and the terminal's directory) as tiled windows — the first thing a new user does.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return: a terminal opens tiled. Run `cd /tmp`, press Super+Return again: the new terminal's prompt shows `/tmp` (run `pwd`). Close the second.
  * Press Super+Shift+Return: Chromium opens tiled beside the terminal, square corners, no gaps inside its tile. Press Super+Shift+B: a second Chromium window. Press Super+Shift+Alt+B: a dark "You've gone Incognito" window.
  ** Chromium takes 10–20 s on the guest; click Wait on any "not responding" dialog and do not double-press.
  * Close the three browser windows with Super+W.
  * Press Super+Shift+F: Files (Nautilus) opens tiled at Home. Close it. Focus the terminal (still in /tmp) and press Super+Alt+Shift+F: Nautilus opens showing `tmp` in its path bar.
  * Close Nautilus and the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal-cwd helper reads the focused terminal's shell directory; give it a second after `cd`.
  * GTK apps are slow on first launch; allow 15 s for Nautilus.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the terminal, the second one printing `/tmp`, Chromium tiled beside it, the second window, the Incognito window, Nautilus at Home and at tmp
  * If unsuccessful
  ** Screenshot after the chord with no window or the wrong app/folder
covers: default/hypr/bindings/applications.lua:2-7; bin/omarchy-launch-terminal; bin/omarchy-launch-browser; bin/omarchy-launch-nautilus; bin/omarchy-launch-nautilus-cwd; default/hypr/apps/browser.lua; test/acceptance.d/apps-test.sh; manual/04:5; manual/07:99,102-105

### hypr-launch-editor-tmux-herdr-and-cheatsheets   [VM-OK]
description: Super+Shift+N opens Neovim in a tiled terminal, Super+Alt+Return attaches to the "Work" tmux session (re-attaching rather than duplicating), Super+Ctrl+Return opens herdr, and Super+Alt+K / Super+Ctrl+K show the tmux and herdr keybinding sheets.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N: a terminal with the Neovim (LazyVim) dashboard opens, tiled like a normal window, not floating. Type `:q` Enter to close it.
  * Press Super+Alt+Return: a terminal with a tmux status bar (session "Work") opens. Type `echo INSIDE-TMUX` Enter, press Super+Alt+Return again: a second terminal attached to the same session shows INSIDE-TMUX too. Close both; in a new terminal run `tmux kill-server`.
  * Press Super+Alt+K: a viewer listing tmux bindings (Prefix + v "Split pane beside", Alt + Enter …). Escape.
  * Press Super+Ctrl+Return: a terminal running herdr (its TUI header) opens; quit it with `q` or Ctrl+C and close the window.
  * Press Super+Ctrl+K: a viewer listing herdr bindings. Escape.
  ** Herdr chords are newer; if Super+K has no "Herdr" row on this build, report them absent.
  * Close the remaining terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * First Neovim start loads plugins for several seconds; wait for the dashboard.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Neovim dashboard tiled, the tmux status bar, the second terminal showing INSIDE-TMUX, the tmux sheet, herdr, the herdr sheet
  * If unsuccessful
  ** Screenshot of a terminal error (command not found) or an empty viewer after the chord
covers: default/hypr/bindings/applications.lua:8,12-13; default/hypr/bindings/utilities.lua:11-12; bin/omarchy-launch-editor; bin/omarchy-launch-terminal-tmux; bin/omarchy-launch-terminal-herdr; test/acceptance.d/apps-test.sh:39; manual/07:3,100-101,109,214

### hypr-launch-tui-utilities-btop-calc-cliamp   [VM-OK]
description: Super+Ctrl+T opens btop in a floating centred terminal, Super+Ctrl+Q the omacalc calculator floating, and Super+Shift+Alt+M the cliamp music TUI which a second press focuses instead of duplicating — the utility launchers and their window rules.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so a tiled window exists.
  * Press Super+Ctrl+T: btop appears as a floating window centred over the terminal, about 875×600. Click it and press Super+T: it tiles beside the terminal; Super+T again: floating. Press `q` in btop.
  * Press Super+Ctrl+Q: a calculator floats over the terminal; type `2+2` Enter → 4. Press Super+K, type `Calculator`: the row reads `SUPER + CTRL + Q / XF86Calculator → Calculator`. Escape. Focus the calculator and press Super+W.
  * Press Super+Shift+Alt+M: a terminal running cliamp opens tiled; record what it says about audio output (none in the guest) — it must not exit by itself.
  * Press Super+2, then Super+Shift+Alt+M again: you are brought back to the existing cliamp window, not a second one. Quit cliamp (`q` or Ctrl+C) and close its window.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * btop redraws constantly; a mid-frame screenshot is fine.
  * Playback is not exercised (no audio sink); cliamp starting and being re-focused is the story.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of floating btop, btop tiled and floating again, the floating calculator showing 4, the merged Calculator row, cliamp running, and being pulled back to the same cliamp window
  * If unsuccessful
  ** Screenshot of btop opening tiled, a missing calculator, or a second cliamp window
covers: default/hypr/bindings/utilities.lua:13-14,104; default/hypr/bindings/applications.lua:15; default/hypr/apps/system.lua:2-11,32; bin/omarchy-launch-or-focus-tui; bin/omarchy-menu-keybindings:339-346; manual/04:15; manual/07:73,77,107

### hypr-launch-docker-tui-polkit   [VM-OK]
description: Super+Shift+D opens lazydocker behind a polkit password prompt because the desktop user is deliberately not in the docker group; cancelling fails cleanly and the password shows the TUI.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+D: a terminal opens and a polkit dialog asks for prime's password.
  * Click Cancel: the terminal shows pkexec's refusal ("Not authorized" or similar) and either stays at a prompt or closes; no compositor error. Close it if it stayed.
  * Press Super+Shift+D again, type `prime` Enter: lazydocker's TUI (Containers / Images panels) appears within ~10 s while the Docker socket activates.
  ** If lazydocker says it cannot connect to the daemon, wait 5 s and press Super+Shift+D once more.
  * Press `q` to quit lazydocker and close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The polkit dialog is a small centred window; type the password blind if the field is not obviously focused.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, the refusal after Cancel, and the lazydocker TUI after authenticating
  * If unsuccessful
  ** Screenshot of a terminal with no prompt, or lazydocker failing with the daemon error after the retry
covers: default/hypr/bindings/applications.lua:16; bin/omarchy-launch-docker-tui; test/acceptance.d/system-test.sh:86-100; manual/07:120

### hypr-launch-obsidian-omawrite-focus   [VM-OK]
description: Super+Shift+O opens Obsidian and a second press re-focuses the existing window from another workspace instead of opening another; Super+Shift+W opens Omawrite.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+O: Obsidian opens (vault picker or last vault).
  ** Electron apps take up to 20 s here; click Wait on a "not responding" dialog.
  * Press Super+2, then Super+Shift+O again: you are taken back to workspace 1 with the same Obsidian window focused and there is still exactly one Obsidian window (check the bar/workspaces and, if unsure, `hyprctl clients | grep -ci 'class: obsidian'` in a terminal → 1).
  * Press Super+Shift+W: Omawrite opens as its own window.
  * Close both with Super+W (and any helper terminal); the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Obsidian's first-run vault dialog is fine; the window class is what the focus rule matches.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Obsidian, of being pulled back to it from workspace 2 with a single window, and of Omawrite
  * If unsuccessful
  ** Screenshot of a second Obsidian window or nothing opening after a chord
covers: default/hypr/bindings/applications.lua:18-19; bin/omarchy-launch-or-focus; test/shell.d/hyprland-focus-app-test.sh; manual/07:121-122

### hypr-launch-missing-app-installer-prompt   [VM-OK] [NET]
description: The Music, Signal and Passwords chords point at apps a stock disk lacks; each must open the floating Omarchy installer terminal with a clear message rather than failing silently, and Ctrl+C must abort without installing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+M: a floating terminal titled "Omarchy" (centred, ~875×600, Omarchy logo on top) starts the Spotify installer (text naming Spotify / packages).
  * Press Ctrl+C in it before it finishes: it closes or returns to a prompt with no "Failed" prompt (exit 130 is treated as the user bailing).
  * Press Super+Shift+G: the same floating installer for Signal. Ctrl+C. Press Super+Shift+/ : the same for 1Password. Ctrl+C.
  * Press Super+Return and run `pacman -Q spotify signal-desktop 1password 2>&1`: all three "was not found".
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Letting an installer run needs network and can exceed the budget; abort every time (the installer may fetch package lists before Ctrl+C, hence NET).
  * The floating window is the same `org.omarchy.terminal` presentation used by the Update menu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each floating installer terminal naming its app, the clean exit after Ctrl+C, and the three "not found" lines
  * If unsuccessful
  ** Screenshot of nothing appearing after a chord, or an installer continuing after Ctrl+C
covers: default/hypr/bindings/applications.lua:14,17,20; bin/omarchy-launch-spotify; bin/omarchy-launch-signal; bin/omarchy-launch-1password; bin/omarchy-launch-floating-terminal-with-presentation; default/hypr/apps/system.lua:6-11; manual/07:106,108,115

### hypr-launch-webapps   [VM-OK] [NET]
description: The web-app chords open their sites as Chromium app windows (no tab strip); the ones declared with focus reuse their window from another workspace, and a video web app loses the browser opacity tag.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+A: a Chromium app window without tab strip or address bar loads chatgpt.com (a network error page still counts as the window). Press Super+Shift+A again: a second ChatGPT window (no focus flag). Close both.
  * Press Super+Shift+P (Google Photos), Super+3, Super+Shift+P again: you are brought back to the existing Photos window on workspace 1, no second window. Close it.
  * Press Super+Shift+Y (YouTube). Press Super+Return and run `hyprctl clients | grep -A30 'youtube' | grep tags`: no `chromium-based-browser`, no `default-opacity` (video is never dimmed). Close YouTube.
  * Press each remaining web-app chord in turn, confirm an app window for the named site appears, and close it with Super+W before the next: Super+Shift+Alt+A (Grok), Super+Shift+C (HEY Calendar), Super+Shift+E (HEY Email), Super+Shift+Alt+E (new HEY email), Super+Shift+Alt+G (WhatsApp), Super+Shift+Ctrl+G (Google Messages), Super+Shift+S (Google Maps), Super+Shift+X (X), Super+Shift+Alt+X (X compose).
  ** Login pages are fine; the site name in the window title is the check. Screenshot each once it renders.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each page is ~1–3 MB; wait for the window, not for the page to finish.
  * The focus variant matches the description text ("Google Photos") against the window class/title.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the ChatGPT app window (and its duplicate), being pulled back to Photos with a single window, the YouTube tags line, and one screenshot per remaining web app showing the site
  * If unsuccessful
  ** Screenshot of a normal tabbed browser window instead of an app window, a duplicated Photos window, or a chord with no window
covers: default/hypr/bindings/applications.lua:22-33; default/hypr/helpers.lua:67-69; bin/omarchy-launch-webapp; bin/omarchy-launch-or-focus-webapp; default/hypr/apps/browser.lua:2-9; manual/07:110-119,123-125

### hypr-preinstalled-bindings-disabled-flag   [VM-OK]
description: Setting `omarchy_preinstalled_bindings = false` in hyprland.lua removes the preinstalled app and web-app chords while keeping the essentials, and Super+K reflects it; restoring the comment brings them back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `sed -i 's/^-- omarchy_preinstalled_bindings = false/omarchy_preinstalled_bindings = false/' ~/.config/hypr/hyprland.lua && hyprctl reload`.
  * Press Super+Shift+A: nothing happens. Press Super+Return: a terminal still opens.
  * Press Super+K, type `ChatGPT`: no row; type `Terminal`: row present. Escape.
  * Run `sed -i 's/^omarchy_preinstalled_bindings = false/-- omarchy_preinstalled_bindings = false/' ~/.config/hypr/hyprland.lua && hyprctl reload`; press Super+Shift+A: the ChatGPT app window opens again. Close it.
  * Close the terminals; the desktop is empty and hyprland.lua is back to stock (`grep -c '^-- omarchy_preinstalled' ~/.config/hypr/hyprland.lua` → 1 before closing).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Omarchy Menu → Setup → Config → Hyprland opens the same file in the editor if you prefer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Super+Shift+A doing nothing, a terminal from Super+Return, Super+K without ChatGPT and with Terminal, ChatGPT working again after the restore, and the grep count 1
  * If unsuccessful
  ** ChatGPT opening while the flag is set, or Super+Return failing
covers: config/hypr/hyprland.lua:9-11; default/hypr/helpers.lua:84-90; default/hypr/bindings/applications.lua:10; test/shell.d/hyprland-default-config-test.sh:131-139

### hypr-ai-chords-agent-picker-and-dictation-absent   [VM-PARTIAL]
description: On a stock disk the AI chords degrade sensibly: Super+Shift+Ctrl+A shows the agent picker (nothing installed), and the dictation chords Super+Ctrl+X / F9 are simply not bound because voxtype is absent, so Super+K does not advertise a dead feature.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Ctrl+A: record exactly what appears (a picker of agents to install, or a notification that none is set up). Press Escape; the desktop is unchanged.
  * Press Super+Ctrl+X and F9: nothing happens (no notification, no banner).
  * Press Super+K and type `dictation`: no rows. Escape.
  * Press Super+Return and run `omarchy-agent --pick; echo exit=$?` to capture the textual behaviour, then close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: running an actual agent or dictation (installing either is NET and slow).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker or message, nothing after the dictation chords, the empty Super+K filter, and the terminal output with exit code
  * If unsuccessful
  ** Dictation rows present without voxtype, or a chord that crashed something
covers: default/hypr/bindings/utilities.lua:97; default/hypr/bindings/voxtype.lua; default/hypr/helpers.lua:37-54; test/shell.d/hyprland-default-config-test.sh:147-177; manual/07:80,153-154

### hypr-floating-terminal-presentation-rule   [VM-OK]
description: The floating "Omarchy" presentation terminal that installers and the Update menu use opens centred at 875×600 with the logo and ends with a Done or Failed prompt carrying the exit code.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `omarchy-launch-floating-terminal-with-presentation 'echo HELLO-FLOAT'`.
  * A terminal titled "Omarchy" floats centred over the first one showing the Omarchy logo, HELLO-FLOAT and a Done-style "press a key" prompt. Press a key: it closes.
  * Run `omarchy-launch-floating-terminal-with-presentation 'false'`: the float shows a Failed-style prompt (exit code 1). Dismiss it.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare with the tiled first terminal: the float is smaller, centred, and drawn on top.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the floating Omarchy terminal with logo and HELLO-FLOAT plus the Done prompt, and of the Failed prompt for `false`
  * If unsuccessful
  ** Screenshot of the terminal opening tiled or without the presentation wrapper
covers: bin/omarchy-launch-floating-terminal-with-presentation; default/hypr/apps/system.lua:2-11; test/shell.d/floating-terminal-test.sh

### hypr-capture-print-screenshot   [VM-OK]
description: Print opens the frozen region picker whose keyboard binds pick a window with Tab/arrows and capture it with Return or the whole screen with Ctrl+Return, saving to ~/Pictures and the clipboard; Escape cancels without a file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and Super+Shift+Return so two windows are open; in the terminal run `ls ~/Pictures | wc -l` and note the count.
  * Press Print: the screen freezes and a selection overlay appears (crosshair, window outlines).
  * Press Tab: the highlighted window changes; press Ctrl+Tab: it goes back. Press Left/Right and Up/Down: the highlight follows the direction (or stays when there is no window that way). Press Return: a notification "Screenshot saved to clipboard and file" appears.
  * Press Print again and press Ctrl+Return: the whole screen is captured, second notification.
  * Press Print a third time and press Escape: the overlay closes, no notification.
  * In the terminal run `ls -t ~/Pictures | head -2` (two new `screenshot-….png`) and `wl-paste --list-types` (includes `image/png`), then `rm ~/Pictures/screenshot-*.png`.
  ** Older builds have no Tab/Return binds in the overlay: drag a region with the mouse instead and report the keys absent.
  * Close both windows; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<PRINT>`; the overlay hides the cursor after key presses, move the mouse if you need to see the crosshair.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the overlay with a highlighted window, both saved notifications, the cancelled overlay, `ls -t` with two new files and `image/png` in the clipboard types
  * If unsuccessful
  ** Screenshot of no overlay after Print, a missing file after Return, or the overlay stuck after Escape
covers: default/hypr/bindings/utilities.lua:38,50-83; default/hypr/apps/screenshot-selection.lua; bin/omarchy-capture-screenshot; manual/07:140-146

### hypr-capture-color-picker-and-ocr   [VM-OK]
description: Super+Print picks a screen colour into the clipboard as hex and Super+Ctrl+Print OCRs a dragged region into the clipboard as text; Escape in the picker copies nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `clear; printf '\n\n   HELLO OCR WORLD 12345\n\n'`.
  * Press Super+Print: the cursor becomes a picker. Click on the terminal background: a notification shows a `#rrggbb` value and `wl-paste` in the terminal prints that hex.
  * Press Super+Print and press Escape: the picker closes; `wl-paste` still prints the previous hex.
  * Press Super+Ctrl+Print and drag a region around the HELLO OCR WORLD line: after a few seconds a notification appears and `wl-paste` prints text containing `HELLO OCR WORLD`.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<M-PRINT>` and `<M-C-PRINT>`; OCR (tesseract) takes a few seconds on 2 vCPU and digits may be imperfect.
  * The picked hex should match the terminal background of the current theme.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker notification with the hex and `wl-paste` printing it; the OCR notification and `wl-paste` printing HELLO OCR WORLD
  * If unsuccessful
  ** Screenshot of no picker/overlay after the chord or an empty clipboard afterwards
covers: default/hypr/bindings/utilities.lua:42-43; manual/07:147-148

### hypr-capture-screenrecording-alt-print   [VM-PARTIAL]
description: Alt+Print asks which audio to record, starts a recording and a second Alt+Print stops it; on the accelerator-less guest it must record with a CPU encoder or fail with a clear notification, never hang, and the webcam-overlay chords must be harmless without a camera.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Alt+Print: the Capture → Screenrecord menu opens with the audio choices (no webcam entry — none present). Choose "With no audio".
  * Record what follows: a region/screen prompt and a recording indicator in the bar, or a notification explaining the failure.
  * If recording started, wait 5 s (screenshots, no long sleep), then press Alt+Print: the recording stops with a saved-video notification; `ls -t ~/Videos | head -1` in a terminal shows a new file, which you then delete.
  * If it failed, run `omarchy-capture-screenrecording 2>&1 | head -20 | sudo tee /dev/ttyS0` in a terminal to capture the error.
  * Press Super+Alt+] and Super+Alt+[ : nothing visible, no banner. Run `omarchy-capture-webcam-resize larger; echo exit=$?`: a no-overlay message, no crash.
  * Run `pgrep -f gpu-screen-recorder; echo $?` → 1 (nothing left running). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: audio variants and the webcam overlay itself — no sink, mic or camera.
  * Never let a recording run past 10 s; CPU encoding fills the disk quickly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the audio prompt, the indicator or failure notification, the stop notification / file listing or the serial error text, nothing after the webcam chords, and the empty pgrep
  * If unsuccessful
  ** Screenshot of a frozen desktop or a recorder process that would not stop
covers: default/hypr/bindings/utilities.lua:39-41; default/hypr/apps/webcam-overlay.lua; default/omarchy/omarchy-menu.jsonc:59-68; manual/07:145,149-150,156

### hypr-universal-clipboard   [VM-OK]
description: Super+C / Super+V copy and paste both in a terminal (translated to Ctrl+Insert / Shift+Insert via the terminal tag) and in a GUI app (Ctrl+C / Ctrl+V), Super+X cuts in the GUI, and Super+Ctrl+V opens the clipboard history to pick an older entry.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `echo clip-from-terminal`. Select the output with a mouse drag and press Super+C. Press Super+V at the prompt: `clip-from-terminal` is pasted (Ctrl+C would have been a shell interrupt). Press Ctrl+C to discard.
  * Press Super+Shift+Return, click Chromium's address bar, type `clip-from-gui`, press Ctrl+A then Super+C. Press Super+Left to the terminal and Super+V: `clip-from-gui` appears at the prompt. Ctrl+C.
  * Back in the address bar, Ctrl+A then Super+X: the text is removed from the bar; Super+V in the terminal pastes `clip-from-gui`.
  * Press Super+Ctrl+V: the clipboard history panel lists `clip-from-gui` and `clip-from-terminal`. Choose `clip-from-terminal`; Super+V in the terminal pastes it. Press Super+Ctrl+V then Escape: the panel closes.
  * Close Chromium and the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Select terminal text with `mouse drag` from the start to the end of the line.
  * Click Wait on a Chromium "not responding" dialog.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the terminal paste, the GUI text pasted into the terminal, the emptied address bar after Super+X, the history panel with both entries, and the older entry pasted
  * If unsuccessful
  ** Screenshot of the prompt unchanged after Super+V or an empty history panel
covers: default/hypr/bindings/clipboard.lua; default/hypr/apps/terminals.lua; config/foot/foot.ini:18-20; default/hypr/apps/omarchy-shell.lua:10; test/shell.d/hyprland-default-config-test.sh:108-120; manual/07:129-138

### hypr-emoji-picker-and-compose-key   [VM-OK]
description: Super+Ctrl+E opens the emoji picker that copies a chosen emoji to the clipboard, and CapsLock acts as the compose key so `CapsLock m s` types 😄 and `CapsLock Space Space` types an em dash — the two quick-emoji paths of the manual.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return.
  * Press Super+Ctrl+E: an emoji picker with a search field appears. Type `thumbs`, press Enter on the first result: the panel closes. Press Super+V at the prompt: 👍 is pasted (a box glyph is fine if the terminal font lacks it; `wl-paste | xxd | head -1` shows the bytes).
  * Press Super+Ctrl+E then Escape: the panel closes, clipboard unchanged.
  * Press Ctrl+U to clear the line, then press CapsLock, `m`, `s`: 😄 appears at the prompt. Press CapsLock, Space, Space: `—` appears. Press CapsLock, Space, `n`: your name from setup appears.
  * Press CapsLock alone then a letter, e.g. `q`: nothing special; CapsLock does not toggle capitals (typing `abc` stays lower case).
  * Ctrl+U and close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<CAPSLOCK>` as a bare key, then the letters as literal text; fcitx5 and ~/.XCompose implement the sequences.
  * Also reachable as Omarchy Menu → Trigger → Emoji.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker with results, the pasted 👍, the composed 😄, the em dash and the name at the prompt, and lower-case text after CapsLock
  * If unsuccessful
  ** Screenshot of no picker, an empty clipboard, or CapsLock toggling capitals / producing nothing
covers: default/hypr/bindings/utilities.lua:3; default/hypr/input.lua:33-37; default/hypr/envs.lua:26; default/hypr/apps/omarchy-shell.lua:10; manual/07:78,336-373; manual/34:40-48

### hypr-menu-chords-open-named-menus   [VM-OK]
description: Each menu chord opens the Omarchy menu at the right level (root, apps, system, toggle, hardware, capture, background, theme, share, reminder) and the chord again or Escape closes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space: the root menu (Apps, Learn, Capture, Toggle, Style, Setup, Install, Update, About, System…). Press Super+Space again: it closes.
  * Press Super+Alt+Space: the Apps launcher with a search field. Escape. Press Super+Escape: the System menu (Lock, Screensaver, Suspend, Logout, Shutdown…). Escape.
  * Press Super+Ctrl+O: Toggle menu. Escape. Super+Ctrl+H: Hardware menu. Escape. Super+Ctrl+C: Capture menu (Screenshot, Screenrecord, Text, QR Code, Color). Escape.
  * Press Super+Ctrl+Space: the Background switcher listing this theme's images. Escape. Super+Shift+Ctrl+Space: the Theme list. Escape.
  ** Do not pick anything in Theme or Background; those change persisted state.
  * Press Super+Ctrl+S: Share menu. Escape. Super+Ctrl+R: the Set reminder prompt. Escape.
  * The desktop is unchanged at the end.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu is a centred Quickshell layer; each level shows its title. Escape always closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per chord showing the expected menu level and title, and the closed state after the toggle press
  * If unsuccessful
  ** Screenshot of the wrong level or nothing opening for a chord
covers: default/hypr/bindings/utilities.lua:1-8,17-18,85,89; default/omarchy/omarchy-menu.jsonc; manual/07:9-11,64-80,173-175

### hypr-panel-chords-and-bar-panel-numbers   [VM-PARTIAL]
description: The panel chords open their bar panels (audio, bluetooth, display, calendar, network, power) and Super+Ctrl+1-9 toggle bar panels by position; panels for absent hardware must open with a graceful message and out-of-range numbers do nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+A: the Audio panel opens and, with no sound device, says so rather than crashing. Press Super+Ctrl+A again: closes.
  * Press Super+Ctrl+B: Bluetooth panel with an unavailable/no-adapter message. Close. Super+Ctrl+D: Display panel showing the single display and its scale, no brightness control. Close.
  * Press Super+Ctrl+Alt+D: Calendar with the current month. Close. Super+Ctrl+W: Network panel with the wired connection, no Wi-Fi list. Close. Super+Ctrl+P: Power panel, no battery section. Close.
  * Press Super+Ctrl+1, close it, Super+Ctrl+2, close it, and so on: each opens the panel under the corresponding bar icon in the right section, leftmost first. Record the mapping for this build.
  * Press Super+Ctrl+9: with fewer than nine panels nothing happens and no error appears.
  ** Bar-panel numbering is newer; if Super+K has no "Bar panel 1" row, report it absent.
  * The desktop is unchanged at the end.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: real audio/bluetooth/battery/Wi-Fi content — hardware absent.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per panel with its title and absence message where applicable; the Super+Ctrl+N mapping; nothing after Super+Ctrl+9
  * If unsuccessful
  ** A panel failing to open or an error for a missing device
covers: default/hypr/bindings/utilities.lua:98-116; test/shell.d/hyprland-default-config-test.sh:193-206; manual/07:65-71

### hypr-notification-chords   [VM-OK]
description: Super+Ctrl+Alt+T posts a time notification and the comma chords dismiss one, dismiss all, open history, invoke the last one and toggle silencing — silenced notifications stay out of sight but land in history.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+T three times: three time notifications stack top-right.
  * Press Super+Comma: the newest disappears. Press Super+Shift+Comma: the rest disappear.
  * Press Super+Shift+Alt+Comma: the notification history opens listing the time notifications. Escape.
  * Press Super+Ctrl+Comma: a bell-off indicator appears in the bar. Press Super+Ctrl+Alt+T: no popup. Press Super+Shift+Alt+Comma: the new entry is in history; Escape. Press Super+Ctrl+Comma: indicator gone.
  * Press Super+Return and run `omarchy-notification-send "Probe" "invoke me" --exec 'foot --title INVOKED'`, then press Super+Alt+Comma: a terminal titled INVOKED opens.
  ** If `--exec` is rejected, note it and skip this step.
  * Close the terminals; the desktop is empty and silencing is off.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<M-,>`, `<M-S-,>`, `<M-C-,>`, `<M-A-,>`, `<M-S-A-,>`; notifications fade after a few seconds, screenshot promptly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of three notifications, two after dismiss-one, none after dismiss-all, the history list, the silenced indicator with no popup, history containing the silenced entry, and the INVOKED terminal
  * If unsuccessful
  ** Notifications that did not dismiss or a popup shown while silenced
covers: default/hypr/bindings/utilities.lua:25-29,93; manual/07:160-168,209

### hypr-notices-battery-weather-no-hardware   [VM-PARTIAL] [NET]
description: The battery and weather notice chords must produce a sensible notification on a machine with no battery and a network-dependent weather lookup; today the battery notice has an empty body, which this test records.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+B: record the notification exactly — expected on the guest is a battery icon with empty text (a known gap), or nothing at all; either is to be reported as observed, not as a crash.
  * Press Super+Ctrl+Alt+W: within ~10 s a weather notification or an error notification appears. Press it again: the weather notice toggles off (record).
  * Press Super+Return and run `omarchy-battery-status; echo exit=$?` → an empty line and exit=0. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: real battery figures — no battery. Weather needs a small network fetch.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the battery notification (or its absence), the weather notification or error, and the terminal line
  * If unsuccessful
  ** A hang or crash dialog after either chord
covers: default/hypr/bindings/utilities.lua:94-95; bin/omarchy-notification-battery; manual/07:210-211

### hypr-reminder-chords   [VM-OK]
description: Super+Ctrl+R sets a reminder through the prompt, Super+Ctrl+Alt+R lists reminders, Super+Shift+Ctrl+R clears them, and an empty list or a cancelled prompt leaves nothing behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+R with nothing set: a notification or panel says there are no reminders.
  * Press Super+Ctrl+R: the prompt asks for text and time; enter `Test reminder` and a time about two minutes ahead (or the offset the prompt shows, e.g. `2m`).
  * Press Super+Ctrl+Alt+R: the reminder is listed. Wait for it with screenshots every 5 s: the reminder notification fires.
  * Press Super+Ctrl+R for a second reminder, then Super+Shift+Ctrl+R: a cleared notification; Super+Ctrl+Alt+R shows none.
  * Press Super+Ctrl+R and press Escape at the prompt: nothing is created (Super+Ctrl+Alt+R still empty).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the prompt wants an absolute time, read the bar clock and add two minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty list, the prompt, the listed reminder, the fired notification, and the empty list after clearing and after cancelling
  * If unsuccessful
  ** The reminder not firing or still listed after the clear chord
covers: default/hypr/bindings/utilities.lua:89-91; manual/07:196-203

### hypr-lock-super-ctrl-l   [VM-OK]
description: Super+Ctrl+L locks the session from the keyboard; a wrong password is rejected and the right one restores the desktop exactly as left — the hotkey twin of the `lock-screen` menu test.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo BEFORE-LOCK` Enter.
  * Press Super+Ctrl+L: the lock screen appears within two seconds.
  ** After a few idle seconds it turns black; keys still go into the password field.
  * Type `wrong` Enter: the lock stays with a rejection cue.
  * Type `prime` Enter: the desktop returns with the terminal showing BEFORE-LOCK in the same layout.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The keyboard, not the menu, must be used to lock here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the lock screen, the rejected attempt, and the restored terminal with BEFORE-LOCK
  * If unsuccessful
  ** Screenshot of the desktop not locking or a lock that would not release, plus `get-serial`
covers: default/hypr/bindings/utilities.lua:127; bin/omarchy-system-lock; default/hypr/looknfeel.lua:112-114; manual/07:12

### hypr-zoom-super-ctrl-z   [VM-OK]
description: Super+Ctrl+Z magnifies the screen around the pointer one step per press and Super+Ctrl+Alt+Z resets to normal — a Lua-function bind on cursor.zoom_factor.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and move the mouse to the centre of the terminal.
  * Press Super+Ctrl+Z: the screen is magnified 2× around the pointer (text twice as big, edges cut off). Press Super+Ctrl+Z again: 3×.
  * Press Super+Ctrl+Alt+Z: normal view. Press it again: nothing changes.
  ** Newer chord: if Super+K has no "Zoom in" row on this build, report it absent.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The zoom is compositor-level and shows in screenshots; the pointer position decides what is magnified.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots at 2× and 3× and back to normal
  * If unsuccessful
  ** Screenshot with no magnification after the chord
covers: default/hypr/bindings/utilities.lua:118-125; manual/07:52-53

### hypr-session-toggles-idle-nightlight   [VM-OK]
description: Super+Ctrl+I toggles stay-awake (idle lock off) with a bar indicator and Super+Ctrl+N toggles the nightlight tint via hyprsunset, which the shipped hyprsunset.conf keeps untinted by default; both toggle back cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+I: a stay-awake indicator appears in the bar. Press it again: gone.
  * Press Super+Ctrl+N: within two seconds the screen takes a warm/orange tint and a nightlight indicator appears in the bar.
  ** If the tint is not visible in the screenshot, run `hyprctl hyprsunset temperature` in a terminal → 4000 as the proof.
  * Press Super+Ctrl+N again: tint and indicator gone (`hyprctl hyprsunset temperature` → 6500).
  * Press Super+Return and run `grep -E 'identity|time' ~/.config/hypr/hyprsunset.conf` → `time = 07:00`, `identity = true`, and `omarchy-toggle-idle status` → `"enabled":false`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The idle lock itself is not waited for; the indicator is the observable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the stay-awake indicator on and off, the nightlight tint/indicator on and off (or the temperature values), and the conf/status lines
  * If unsuccessful
  ** No indicator or temperature change after a chord
covers: default/hypr/bindings/utilities.lua:31-32; bin/omarchy-toggle-idle; bin/omarchy-toggle-nightlight; config/hypr/hyprsunset.conf; manual/07:187-188

### hypr-share-menu-localsend-and-transcode   [VM-OK]
description: Super+Ctrl+S opens the Share menu that hands off to LocalSend, which floats centred at 1100×700, and Super+Ctrl+Period opens the transcode flow; both must present something sensible with no file selected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return.
  * Press Super+Ctrl+S and choose the entry that opens LocalSend: a LocalSend window floats centred, about 1100×700 (nearly the full height of the guest screen), over the terminal. It shows no peers; close it with Super+W.
  * Press Super+Ctrl+Period: record what the transcode flow shows (a file picker, a prompt, or a notification that nothing is selected). Escape/cancel it; nothing else changes.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<M-C-s>` and `<M-C-.>`. If the Share menu only offers actions needing a selection, run `localsend_app &` from the terminal for the rule check and note it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Share menu, the floating LocalSend window over the terminal, and the transcode prompt/notification
  * If unsuccessful
  ** LocalSend tiled, or a chord with nothing on screen
covers: default/hypr/bindings/utilities.lua:85,87; default/hypr/apps/localsend.lua; manual/07:72,79

### hypr-media-keys-no-audio-device   [VM-PARTIAL]
description: The XF86 media, brightness and touchpad binds cannot be pressed in the guest, but their commands must fail gracefully on a machine with no sink, no backlight and no touchpad — the path a desktop without those devices takes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `omarchy-audio-output-volume raise; echo exit=$?`: `Could not resolve an audio sink to control.` and exit 1 (or, if PipeWire exposes a dummy sink, an OSD with a percentage — record which). Then `omarchy-audio-output-volume mute-toggle; omarchy-audio-output-switch; omarchy-audio-source-switch; omarchy-audio-input-mute; echo exit=$?`: messages, no hang.
  * Run `omarchy-brightness-display +5%; omarchy-brightness-keyboard up; echo exit=$?`: no-backlight messages, no OSD, no hang.
  * Run `omarchy-toggle-touchpad; echo exit=$?` → `No touchpad device found`, exit 1; `ls ~/.local/state/omarchy/toggles/hypr/` shows no `touchpad-disabled-name`.
  * Run `omarchy-shell media playPause; echo exit=$?` (no player): record the result.
  * Run `hyprctl binds | grep -c XF86` → at least 20 (the binds exist even without keys). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: pressing the XF86 keys (no send-keys token) and any OSD needing a real device.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots with each message and exit code, the toggles listing, and the XF86 bind count
  * If unsuccessful
  ** A command hanging (>10 s), a traceback, or a state file written for a missing device
covers: default/hypr/bindings/media.lua; bin/omarchy-audio-output-volume; bin/omarchy-toggle-touchpad; bin/omarchy-toggle-input-device; test/shell.d/toggle-input-device-test.sh; manual/07:86-93,195

### hypr-input-keyboard-layout-switch   [VM-OK]
description: Adding a second keyboard layout in ~/.config/hypr/input.lua takes effect on save, the bar shows the layout code, Left Alt + Right Alt switches what keys type, and Super chords keep working because a Latin layout stays first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `printf '%s\n' 'hl.config({ input = { kb_layout = "us,dk", kb_options = "compose:caps,shift:both_capslock_cancel,grp:alts_toggle" } })' >> ~/.config/hypr/input.lua`; wait two seconds (auto-reload) — a keyboard-layout widget reading `EN` appears in the bar.
  * Hold Left Alt and tap Right Alt: the widget reads `DA`. Type `;` in the terminal: `æ` appears.
  * Press Super+Return: a terminal still opens while on the Danish layout. Close it.
  * Hold Left Alt and tap Right Alt: `EN`; typing `;` gives `;`.
  * Run `sed -i '$d' ~/.config/hypr/input.lua && hyprctl reload`: the widget disappears.
  * Run `printf '%s\n' 'hl.config({ input = { kb_layout = "nonsense" } })' >> ~/.config/hypr/input.lua && hyprctl reload`: a red error banner or `hyprctl configerrors` text names the bad layout and typing still works; then `sed -i '$d' ~/.config/hypr/input.lua && hyprctl reload` clears it. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the layout toggle as `<A-alt_r>`.
  * Omarchy Menu → Setup → Input opens the same file in the editor if you prefer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar widget EN then DA, `æ` typed, a terminal opening while on DA, the widget gone after cleanup, the bogus-layout error and its clearing
  * If unsuccessful
  ** No widget after the change, the wrong glyph, or Super+Return failing while switched
covers: config/hypr/input.lua:6-11; default/hypr/input.lua:26-62; test/shell.d/hyprland-keyboard-layout-test.sh; test/shell.d/keyboard-layout-test.sh; manual/34:1-38

### hypr-input-defaults-and-override   [VM-OK]
description: Omarchy's input defaults (repeat 40/250, numlock on, follow-mouse, CapsLock compose options) are live, and a user override in ~/.config/hypr/input.lua replaces them on reload and reverts when removed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `for o in repeat_rate repeat_delay numlock_by_default follow_mouse kb_options; do hyprctl getoption input:$o | head -2; done | sudo tee /dev/ttyS0` → 40, 250, true, 1, `compose:caps,shift:both_capslock_cancel`.
  * Run `printf '%s\n' 'hl.config({ input = { repeat_rate = 60, repeat_delay = 600 } })' >> ~/.config/hypr/input.lua && hyprctl reload`, then the same loop → 60 and 600.
  * Hold a letter key for two seconds in the terminal: it repeats visibly faster than before (compare line lengths).
  * Run `sed -i '$d' ~/.config/hypr/input.lua && hyprctl reload` → 40 and 250 again.
  * Close the terminal; the desktop is empty and input.lua is back to stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse hold`/`release`-style key holding only if the client supports it; otherwise the getoption values are the proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial/screenshot values 40/250/true/1/compose options, then 60/600, then 40/250
  * If unsuccessful
  ** Values unchanged after reload or an error banner
covers: default/hypr/input.lua:50-75; config/hypr/input.lua:1-45; manual/34:6-38

### hypr-keybindings-viewer-super-k   [VM-OK]
description: Super+K opens the searchable keybindings viewer that renders the Lua binds with readable key names, merged alternative chords, the expected ordering and hidden duplicates — and Enter on a row runs that binding.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K: a "Keybindings" menu opens; the first rows are `SUPER + K → Keybindings`, `SUPER + SPACE → Omarchy menu`, `SUPER + RETURN → Terminal`, `SUPER + SHIFT + RETURN → Browser`, `SUPER + SHIFT + F → File manager` in that order.
  * Type `Expand`: rows read `SUPER + MINUS → Expand window left` (keycode resolved, no `code:20`). Clear; type `MOUSE`: `SUPER + LEFT MOUSE BUTTON → Move window`. Clear; type `201`: no row (the Copilot duplicate is hidden). Clear; type `Copy URL`: the static `SHIFT ALT + L → Copy URL from Web App` row. Escape.
  * Press Super+K, type `Terminal`, Enter on `SUPER + RETURN → Terminal`: a terminal opens.
  * Press Super+K, type `Toggle window floating`, Enter: the terminal floats (a Lua dispatcher run from the viewer). Repeat to tile it.
  * Press Super+K, type `Switch to workspace 2`, Enter: workspace 2 becomes active. Press Super+1.
  * Close the terminal; the desktop is empty.
  ** Rows for newer chords may be missing on 4.0.2 — note which, do not fail on them.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The viewer filters as you type; if not, scroll with the arrows. Also under Omarchy Menu → Learn → Keybindings.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the top five rows in order, the MINUS row, the mouse row, the empty `201` filter, the Copy URL row, the terminal opened from the viewer, the float toggled, workspace 2 active
  * If unsuccessful
  ** A row showing `code:20`/`__lua`, a missing merge, or Enter doing nothing
covers: bin/omarchy-menu-keybindings (parse_keycodes, prioritize_entries, static_bindings, line 310, dispatch_binding); default/hypr/bindings/utilities.lua:10; manual/07:3

### hypr-keybindings-print-matches-config   [VM-OK]
description: `omarchy-menu-keybindings --print` lists every described binding once with readable keys and refreshes its cache when the bind set changes, so the cheat sheet never goes stale after a user edit.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `omarchy-menu-keybindings --print | sudo tee /dev/ttyS0 | wc -l` (about 180–230 rows); read the list from the serial log.
  * The list contains `SUPER + RETURN` → Terminal, `SUPER + SHIFT + A` → ChatGPT, `SUPER + CTRL + L` → Lock system, `XF86AudioRaiseVolume` → Volume up, `SUPER + 1` … `SUPER + 0` switch rows, `SUPER + W / SUPER + Q → Close window`, `SUPER + S / SUPER + ~ → Toggle scratchpad`, and no line containing `code:` or `__lua`.
  * Run `ls ~/.cache/omarchy/ | grep -c keybindings-` → 1.
  * Run `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Probe SSH", "foot")' >> ~/.config/hypr/bindings.lua && hyprctl reload && omarchy-menu-keybindings --print | grep -F 'Probe SSH'` → the new row; `ls ~/.cache/omarchy/ | grep -c keybindings-` → still 1 (old cache replaced).
  * Run `sed -i '$d' ~/.config/hypr/bindings.lua && hyprctl reload && omarchy-menu-keybindings --print | grep -c 'Probe SSH'` → 0. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list is long; the serial log is the way to read it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with the named rows and no `code:`/`__lua`; the single cache file; the Probe SSH row appearing then gone
  * If unsuccessful
  ** Raw `code:`/`__lua` rows, a stale list after the reload, or multiple cache files
covers: bin/omarchy-menu-keybindings:511-574; config/hypr/bindings.lua:4-5

### hypr-user-binding-override-takes-effect   [VM-OK]
description: The three documented override forms in ~/.config/hypr/bindings.lua — o.bind adds a chord, o.rebind replaces a default's action, hl.unbind removes one — take effect on save without touching package files, and Super+K shows the result.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Override probe", "foot --title OVERRIDE-PROBE")' 'o.rebind("SUPER + SHIFT + F", "File manager", { launch = "foot --title REBOUND-FILES" })' 'hl.unbind("SUPER + SHIFT + B")' >> ~/.config/hypr/bindings.lua`; wait two seconds. No red banner may appear.
  * Press Super+Shift+R: a terminal titled OVERRIDE-PROBE opens. Press Super+Shift+F: a terminal titled REBOUND-FILES opens instead of Nautilus.
  * Press Super+Shift+B: nothing opens. Press Super+Shift+Return: the browser still opens (only the alias was unbound); close it.
  * Press Super+K: rows `SUPER + SHIFT + R → Override probe` and `SUPER + SHIFT + F → File manager` exist and `SUPER + SHIFT + B` has none. Escape.
  * Run `head -n -3 ~/.config/hypr/bindings.lua > /tmp/b && cp /tmp/b ~/.config/hypr/bindings.lua && hyprctl reload`; Super+Shift+F opens Nautilus again and Super+Shift+B the browser. Close everything.
  ** A typo in the appended lines produces the red banner: the defaults keep working but looknfeel/autostart/toggles are skipped until fixed — fix and reload before continuing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Omarchy Menu → Setup → Keybindings opens the same file in the editor.
  * Window titles show in `hyprctl activewindow` if the terminal title bar is not visible.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of OVERRIDE-PROBE, REBOUND-FILES, nothing after Super+Shift+B, the browser after Super+Shift+Return, the Super+K rows, Nautilus and browser back after the restore
  * If unsuccessful
  ** A banner after the append, or Nautilus opening despite the rebind
covers: config/hypr/bindings.lua:1-23; default/hypr/helpers.lua:92-111; test/shell.d/hyprland-binding-conflicts-test.sh:199-211; manual/07:127

### hypr-user-config-syntax-error-banner   [VM-OK]
description: A syntax error in a user Hyprland file must not take the desktop down: a red error banner appears, the default chords keep working, modules loaded after the broken file (toggles) are skipped, and fixing the file clears the banner and re-applies them.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and Super+Shift+Backspace so gaps are off (a toggle sourced *after* bindings.lua).
  * Run `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Broken"' >> ~/.config/hypr/bindings.lua` (unclosed call) and wait two seconds: a red config-error banner appears at the top of the screen.
  * Run `hyprctl configerrors | sudo tee /dev/ttyS0`: the text names `bindings.lua` and a syntax error.
  * Press Super+Return: a terminal still opens. Press Super+Shift+R: nothing. Look at the gaps: record whether they came back (expected: the no-gaps toggle was skipped on this reload, so gaps are visible again).
  * Run `sed -i '$d' ~/.config/hypr/bindings.lua && hyprctl reload`: the banner disappears and the windows are gapless again.
  * Press Super+Shift+Backspace to restore gaps; run `ls ~/.local/state/omarchy/toggles/hypr/` → only `flags.lua`. Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The banner is Hyprland's own red strip; it is only suppressed while the package reload guard is active, which is not the case here.
  * If the screen goes black or the compositor restarts, capture `get-serial` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the banner, the configerrors text, a terminal opening while broken, the gaps state while broken, the clean gapless state after the fix, and only flags.lua at the end
  * If unsuccessful
  ** No banner with a silently ignored file, dead chords while broken, or a compositor crash with the serial log
covers: config/hypr/hyprland.lua:19-26; default/hypr/bootstrap.lua; bin/omarchy-hyprland-reload-guard (suppress_errors); default/agents/skills/omarchy/hyprland.md:22-25

### hypr-reload-guard-pauses-autoreload   [VM-OK]
description: The package-transaction reload guard pauses Hyprland's auto-reload and error banner while paused, reports its state, and resume performs one reload that applies edits made in between.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `sudo omarchy-hyprland-reload-guard paused; echo paused=$?` → 1.
  * Run `sudo omarchy-hyprland-reload-guard pause; sudo omarchy-hyprland-reload-guard paused; echo paused=$?` → 0; `hyprctl getoption misc:disable_autoreload` and `hyprctl getoption debug:suppress_errors` → both true.
  * Run `printf '%s\n' 'o.bind("SUPER + SHIFT + R", "Guard probe", "foot --title GUARD-PROBE")' >> ~/.config/hypr/bindings.lua`; wait three seconds; press Super+Shift+R: nothing opens.
  * Run `sudo omarchy-hyprland-reload-guard resume`; press Super+Shift+R: GUARD-PROBE opens; both options are false again and `paused` exits 1.
  * Run `sudo omarchy-hyprland-reload-guard bogus; echo $?` → usage line, exit 1.
  * Run `sed -i '$d' ~/.config/hypr/bindings.lua && hyprctl reload`; close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo` asks for `prime` unless passwordless sudo is set up.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal output paused=1 → 0 → 1, the options flipping, nothing on Super+Shift+R while paused, GUARD-PROBE after resume, the usage error
  * If unsuccessful
  ** Options not flipped, the bind applying while paused, or no reload on resume
covers: bin/omarchy-hyprland-reload-guard; test/shell.d/hyprland-reload-guard-test.sh

### hypr-default-bindings-disabled-tty-recovery   [VM-PARTIAL]
description: Setting `omarchy_default_bindings = false` removes every Omarchy chord including Super+Return and Super+K as documented, and a user can recover from a text console with the config reset command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `sed -i 's/^-- omarchy_default_bindings = false/omarchy_default_bindings = false/' ~/.config/hypr/hyprland.lua && hyprctl reload`.
  * Press Super+Return, Super+K, Super+Space: nothing happens. Click the Omarchy icon in the bar: the menu still opens with the mouse. Escape.
  * Press Ctrl+Alt+F3 and log in as prime / prime.
  * Run `omarchy-refresh-hyprland`: it prints that it replaced `hyprland.lua` and saved a `.bak.<epoch>` copy, with the diff.
  * Run `hyprctl -i 0 reload` (or `HYPRLAND_INSTANCE_SIGNATURE=$(ls /run/user/1000/hypr | head -1) hyprctl reload`), then press Ctrl+Alt+F1 (or F2 if the session is on tty2).
  * Press Super+Return: a terminal opens again. Run `rm ~/.config/hypr/*.bak.*` and close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: adding a custom minimal binding set (the flag's intended use); this proves the flag and the recovery only.
  * If the VT does not switch back or login fails, end with `stop` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of dead chords with the mouse menu still working, the TTY with the refresh output naming the .bak file, and the desktop with Super+Return working again
  * If unsuccessful
  ** Serial log and screenshot of a black screen or a session that did not return
covers: config/hypr/hyprland.lua:6-7; default/hypr/omarchy.lua:8-15; bin/omarchy-refresh-hyprland; test/shell.d/hyprland-default-config-test.sh:141-145; manual/42:5

### hypr-refresh-hyprland-restores-stock-config   [VM-OK]
description: Omarchy Menu → Update → Config → Hyprland resets the seven user Hyprland files to the shipped defaults, keeps a timestamped backup of anything changed, and reports what it replaced.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `echo '-- probe edit' >> ~/.config/hypr/looknfeel.lua; echo '-- probe edit' >> ~/.config/hypr/monitors.lua`.
  * Press Super+Space → Update → Config → Hyprland: a floating Omarchy terminal prints two red "Replaced … Saved backup as ….bak.<epoch>" blocks (looknfeel.lua, monitors.lua) each with a one-line diff, nothing for untouched files. Press a key to close it.
  * Run `ls ~/.config/hypr/`: the seven files plus two `.bak.*` files; `grep -c 'probe edit' ~/.config/hypr/looknfeel.lua` → 0.
  * Press Super+Return: a terminal opens (config still valid); no banner on screen.
  * Run `omarchy-refresh-config hypr/does-not-exist.lua; echo $?` → "Not a shipped user config", exit 1.
  * Run `rm ~/.config/hypr/*.bak.*` and close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal closes on any key after "Done".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the refresh output naming both backups, the directory listing, the zero grep, a new terminal with no banner, the not-a-shipped-config error
  * If unsuccessful
  ** The refresh overwriting without a backup or leaving the probe line
covers: bin/omarchy-refresh-hyprland; bin/omarchy-refresh-config; default/omarchy/omarchy-menu.jsonc:355-369; manual/42:3-5

### hypr-monitor-scaling-step-super-slash   [VM-OK]
description: Super+/ and Super+Alt+/ step the display through the preset scales, apply immediately, persist to ~/.config/hypr/monitors.lua and log the change; a bad value is refused and the ladder is reversible.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `omarchy-hyprland-monitor-scaling; grep omarchy_ ~/.config/hypr/monitors.lua` → the current scale (1 on the guest) and the two `local omarchy_*_scale` lines.
  * Press Super+/ : everything on screen grows ~25 % within a second. Re-run the command → 1.25 and `local omarchy_monitor_scale = 1.25`, `local omarchy_gdk_scale = 1`; `tail -1 ~/.local/state/omarchy/monitor-scaling.log` shows `requested=up current=1 new=1.25 monitor=Virtual-1`.
  * Press Super+Alt+/ : back to scale 1; the file says 1.
  * Run `omarchy-hyprland-monitor-scaling 7; echo $?` → usage, exit 1, no change.
  * Confirm `grep omarchy_monitor_scale ~/.config/hypr/monitors.lua` ends in `= 1`; close the terminal.
  ** Do not step past 2; at 3.2/4 the logical desktop is tiny and the bar overflows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send `<M-/>` and `<M-A-/>`. The bar and terminal text visibly change size — that is the screenshot proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots at scale 1 and 1.25 with the command/monitors.lua/log lines, back at 1, and the rejected `7`
  * If unsuccessful
  ** The scale not changing on screen or monitors.lua not updated
covers: default/hypr/bindings/tiling.lua:97-98; bin/omarchy-hyprland-monitor-scaling; config/hypr/monitors.lua:7-8,21-22; test/shell.d/monitor-scaling-test.sh; manual/33:21

### hypr-monitors-lua-bogus-mode-falls-back   [VM-OK]
description: A monitors.lua rule naming a mode the display lacks must not blank the screen: Hyprland falls back to the preferred mode, the desktop stays usable, and the stock rule is restored from the menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `hyprctl monitors | grep -E 'Monitor|@'` to record the output name (expected `Virtual-1`) and mode (1280x800@…).
  * Run `printf '%s\n' 'hl.monitor({ output = "Virtual-1", mode = "9999x9999@60", position = "auto", scale = 1 })' >> ~/.config/hypr/monitors.lua && hyprctl reload`.
  * The screen stays on at the same size. Re-run the grep: still 1280x800. Record any banner or notification about the invalid mode.
  * Press Super+Space → Update → Config → Hyprland to restore the stock file; press a key to close the float. The mode is unchanged and no banner remains.
  * Run `rm ~/.config/hypr/*.bak.*`; close the terminal.
  ** If the output is not Virtual-1, substitute the real name; if the screen does blank, use Ctrl+Alt+F3, log in, `omarchy-refresh-hyprland`, `hyprctl -i 0 reload`, Ctrl+Alt+F1/F2.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Omarchy Menu → Setup → Monitors opens the file in the editor if you prefer editing there.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after the reload with the desktop intact and the mode line unchanged, the recorded error text, and the restored file
  * If unsuccessful
  ** Serial log and screenshot of a black/garbled screen
covers: config/hypr/monitors.lua:10-11; bin/omarchy-hyprland-monitor-modeless; bin/omarchy-hyprland-monitor-watch; test/shell.d/monitor-recovery-test.sh; manual/33:5-16,41

### hypr-monitors-lua-disabled-output-tty-recovery   [VM-PARTIAL]
description: Disabling the only output in monitors.lua (the manual's phantom-display recipe on the wrong output) blanks the desktop and is deliberately not auto-recovered; the user must be able to fix it from a text console.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `printf '%s\n' 'hl.monitor({ output = "Virtual-1", disabled = true })' >> ~/.config/hypr/monitors.lua`; screenshot; then `hyprctl reload`.
  * The screen goes black. Wait 20 s with screenshots: it stays black (monitors disabled on purpose are not recovered).
  * Press Ctrl+Alt+F3, log in as prime. Run `hyprctl -i 0 monitors all | grep -E 'Monitor|disabled'` → `disabled: true`.
  * Run `sed -i '$d' ~/.config/hypr/monitors.lua && hyprctl -i 0 reload`, then Ctrl+Alt+F1 (or F2): the desktop is back with the terminal still open.
  * Close the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: disabling a secondary phantom output (the documented use) — no second output.
  * If recovery fails, end with `stop`; the disk is discarded.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the black screen, the TTY showing `disabled: true`, and the restored desktop
  * If unsuccessful
  ** Serial log and the TTY output if the reload did not bring the output back
covers: config/hypr/monitors.lua; bin/omarchy-hyprland-monitor-modeless; manual/33:53

### hypr-window-rule-browser-opacity-and-maximize   [VM-OK]
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

### hypr-window-rule-floating-dialogs-and-viewers   [VM-OK]
description: File-chooser dialogs from the desktop portal, the imv image viewer and the About window all float centred (875×600 for the floating-window tag, 920×480 for About) instead of splitting the tiling, while the app windows that spawned them stay tiled.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return (Chromium) and, once it is up, press Ctrl+O in it: a GTK "Open File" dialog floats centred over the tiled browser. Escape closes it; Chromium is still tiled.
  ** If Chromium shows its own picker instead of the portal one, record which appeared.
  * Press Super+Return and run `imv "$(readlink -f ~/.local/state/omarchy/current/background)" &`: the image opens as a floating centred window over the terminal, fully opaque. Press `q` in it.
  * Run `imv /nonexistent.png; echo exit=$?`: an error and non-zero exit, no window.
  * Press Super+Space → About: the About window (logo + fastfetch) floats centred, wider than tall (~920×480). Press a key or Super+W to close it; open it again from the menu: still floating (it may now have its measured size). Close it.
  * Press Super+Shift+F: the Nautilus main window opens tiled (only its Open/Save dialogs float). Close it.
  * Close Chromium and the terminal; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Floating windows are drawn above the tiles with the tiles unchanged behind them — that is the visual tell versus a tiled window that would shrink the others.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the file dialog floating over the tiled browser, floating imv, the imv error line, the floating About window twice, and Nautilus tiled
  * If unsuccessful
  ** Any of the dialogs/viewers tiled and splitting the workspace
covers: default/hypr/apps/system.lua:2-32,40-51; default/omarchy/omarchy-menu.jsonc:32

### hypr-window-rule-pip-pinned   [VM-OK] [NET]
description: A browser Picture-in-Picture window floats pinned in the top-right corner at 600×338 with no border, keeps its aspect ratio and follows across workspaces.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return, open `https://www.w3schools.com/html/mov_bbb.mp4`, right-click the video twice and choose "Picture in picture".
  * A small borderless video window appears top-right above the browser, about 600×338.
  * Press Super+2: the PiP window is still visible over the empty workspace (pinned). Press Super+1.
  * Super+right-drag its corner to resize: it stays 16:9.
  * Close the PiP (hover → X) and Chromium; the desktop is empty.
  ** ~10 MB download; any page with a plain `<video>` works if this one is slow.
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

### hypr-session-environment-and-autostart   [VM-OK]
description: Apps started from a chord inherit the Hyprland-set environment (Wayland backends, cursor size, OMARCHY_PATH first on PATH, no NVIDIA variables on this machine) and the default autostart entries (shell, monitor watcher, udiskie) are alive and not duplicated by a reload.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `env | grep -E '^(XCURSOR_SIZE|HYPRCURSOR_SIZE|GDK_BACKEND|QT_QPA_PLATFORM|QT_QPA_PLATFORMTHEME|MOZ_ENABLE_WAYLAND|ELECTRON_OZONE_PLATFORM_HINT|OZONE_PLATFORM|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|XDG_SESSION_DESKTOP|XCOMPOSEFILE|OMARCHY_PATH|GDK_SCALE|NVD_BACKEND|LIBVA_DRIVER_NAME|__GLX_VENDOR_LIBRARY_NAME)=' | sort | sudo tee /dev/ttyS0`.
  * The serial log shows XCURSOR_SIZE=24, HYPRCURSOR_SIZE=24, GDK_BACKEND=wayland,x11,*, QT_QPA_PLATFORM=wayland;xcb, QT_QPA_PLATFORMTHEME=gtk3, MOZ_ENABLE_WAYLAND=1, ELECTRON_OZONE_PLATFORM_HINT=wayland, OZONE_PLATFORM=wayland, XDG_SESSION_TYPE=wayland, XDG_CURRENT_DESKTOP=Hyprland, XDG_SESSION_DESKTOP=Hyprland, XCOMPOSEFILE=/home/prime/.XCompose, OMARCHY_PATH=/usr/share/omarchy, GDK_SCALE=2 — and none of the three NVIDIA variables.
  * Run `echo $PATH | tr : '\n' | head -1` → `/usr/share/omarchy/bin`.
  * Run `pgrep -af 'omarchy-hyprland-monitor-watch|udiskie' | sudo tee /dev/ttyS0`: one monitor watcher and one `udiskie --automount --no-notify --no-tray`; the bar being on screen is the shell.
  * Run `hyprctl reload` and the same pgrep: identical PIDs, nothing duplicated.
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

### hypr-autostart-user-entry-runs-on-login   [VM-OK] [SLOW]
description: An `o.launch_on_start` line in ~/.config/hypr/autostart.lua runs at the next session start and not on a reload — the documented way to add a startup program.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `printf '%s\n' 'o.launch_on_start("foot --title AUTOSTART-PROBE")' >> ~/.config/hypr/autostart.lua && hyprctl reload`; wait three seconds: no AUTOSTART-PROBE window appears.
  * Press Super+Escape → Logout and log back in as prime / prime (or wait for auto-login).
  * Within ~15 s of the desktop appearing a terminal titled AUTOSTART-PROBE is open.
  * In it run `sed -i '$d' ~/.config/hypr/autostart.lua` and close it; the desktop is empty and autostart.lua is stock.
  ** Logout/login takes about a minute; the LUKS passphrase is not asked again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The title shows in the bar's window title area or via `hyprctl activewindow | grep title` if the terminal has no title bar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots proving no probe after reload, the greeter/login, and the AUTOSTART-PROBE terminal after login
  * If unsuccessful
  ** The desktop after login without the probe window
covers: config/hypr/autostart.lua; default/hypr/helpers.lua:117-125; default/hypr/autostart.lua:1

### hypr-looknfeel-override-rounding-gaps   [VM-OK]
description: The commented examples in ~/.config/hypr/looknfeel.lua work when enabled — rounded corners, zero gaps and borders, animations off — each applying on reload and each reversible, and the same menu path opens the file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return twice; note square corners, gaps and 2 px borders.
  * Run `printf '%s\n' 'hl.config({ decoration = { rounding = 8 } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload`: corners are visibly rounded.
  * Run `printf '%s\n' 'hl.config({ general = { gaps_in = 0, gaps_out = 0, border_size = 0 } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload`: no gaps, no borders.
  * Run `printf '%s\n' 'hl.config({ animations = { enabled = false } })' >> ~/.config/hypr/looknfeel.lua && hyprctl reload`; press Super+Return: the third terminal appears instantly with no pop-in.
  * Press Super+Space → Style → Hyprland: looknfeel.lua opens in the editor with the three lines at the bottom; quit the editor (`:q` Enter).
  * Run `head -n -3 ~/.config/hypr/looknfeel.lua > /tmp/l && cp /tmp/l ~/.config/hypr/looknfeel.lua && hyprctl reload`: square corners, gaps and borders are back. Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A typo shows the red error banner; fix and reload before continuing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of rounded corners, gapless/borderless windows, the instant third terminal, the editor on looknfeel.lua, and the stock look restored
  * If unsuccessful
  ** An error banner after an append or the look unchanged after reload
covers: config/hypr/looknfeel.lua; default/hypr/looknfeel.lua:7-32,62-65; manual/42:11-37; default/omarchy/omarchy-menu.jsonc:111

### hypr-screen-share-picker-xdph   [VM-OK] [NET]
description: xdph.conf enables token-by-default screencopy with the preview share picker, so a browser screen-share request opens that picker, sharing a window works, and cancelling denies cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `cat ~/.config/hypr/xdph.conf` → `allow_token_by_default = true`, `custom_picker_binary = hyprland-preview-share-picker`.
  * Press Super+Shift+Return and open `https://mozilla.github.io/webrtc-landing/gum_test.html`; click the "Screen capture" (or "Window") button.
  * A picker with previews of the screen/windows appears (the custom picker, not a plain list). Choose the terminal window and confirm: the page shows the shared terminal in its video element. Stop sharing.
  * Trigger the share again and cancel the picker: the page reports the permission was denied, nothing crashes.
  * Close Chromium and the terminal; the desktop is empty.
  ** The picker is a Qt window and may take a few seconds to render previews.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click Wait on a Chromium "not responding" dialog.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The xdph.conf lines, the preview picker screenshot, the page showing the shared window, and the denied state after cancelling
  * If unsuccessful
  ** No picker appearing or the browser erroring before a picker
covers: config/hypr/xdph.conf; install/omarchy-base.packages:55,146

### hypr-copilot-power-lid-binds-present   [VM-NO]
description: The Copilot key, XF86PowerOff and lid-switch binds exist with the right flags (locked, hidden from the viewer) — verifiable only by reading the bind table, since none of those inputs exist in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `hyprctl binds | grep -B3 -A8 -E 'code:201|XF86PowerOff|Lid Switch' | sudo tee /dev/ttyS0`.
  * The serial log shows a SUPER+SHIFT bind on `code:201` for `omarchy-menu toggle root`; `XF86PowerOff` with `locked: 1` running `omarchy-menu toggle system`; two `switch:` binds for the lid (on → `omarchy-system-lid-close`, off → `omarchy-hyprland-monitor-clamshell`) with `locked: 1`.
  * Run `omarchy-menu-keybindings --print | grep -c 201` → 0. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable here beyond inspection: no Copilot key, no power-button path through the client, no lid.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump of the four binds with locked flags and the hidden-row count
  * If unsuccessful
  ** A missing bind or missing locked flag
covers: default/hypr/bindings/utilities.lua:7,9,35-36; bin/omarchy-menu-keybindings:310; test/shell.d/monitor-recovery-test.sh:100-102

### hypr-gaming-and-vendor-window-rules   [VM-NO]
description: Steam, Battle.net, RetroArch, Moonlight, GeForce NOW, DaVinci Resolve, JetBrains, Telegram, Hermes, 1Password/Bitwarden and the Windows VM rules exist for apps a stock disk does not have; only their presence and parseability can be checked here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `ls /usr/share/omarchy/default/hypr/apps/ | sudo tee /dev/ttyS0`: the 21 rule files from this document's inventory.
  * Run `hyprctl configerrors` → empty (every rule file parses). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable here: none of those apps are installed and several need a GPU or an account.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The directory listing and empty configerrors
  * If unsuccessful
  ** A parse error naming one of the app rule files
covers: default/hypr/apps/{1password,battlenet,bitwarden,davinci-resolve,geforce,hermes,jetbrains,moonlight,retroarch,steam,telegram,windows-vm,qemu}.lua

## Gaps

Behaviours found in scope that no driver test above can exercise, and why:

- **XF86 media, brightness, keyboard-backlight, touchpad, eject, power and calculator keys** (media.lua,
  utilities.lua:9,14): no `send-keys` token and no hardware. Only their commands' absence paths are tested
  (`hypr-media-keys-no-audio-device`); the `repeating`/`locked` bind flags (hold-to-repeat, working on the
  lock screen) are unexercised.
- **Copilot key `code:201`** and **lid switch** binds: no such input in QEMU; inspected only (VM-NO).
- **Touchpad settings and gestures** (natural_scroll, clickfinger, scroll_factor, drag_3fg, `hl.gesture`,
  per-app `scroll_touchpad`): no touchpad; only option values could be read back, not proposed.
- **Multi-monitor positive paths**: move-workspace-to-monitor, focus-next-monitor, mirroring, clamshell,
  laptop display disable/recover, `position`/`transform` monitor rules, the scratchpad refit on a monitor
  hop: single virtual output. Negative paths only (`hypr-multi-monitor-chords-single-display`).
- **Idle/DPMS behaviour** (`key_press_enables_dpms`, idle lock timing, screensaver): needs minutes of idleness
  beyond the session budget and a DPMS-capable output; only the stay-awake indicator is tested.
- **NVIDIA env branch** (nvidia.lua): no NVIDIA GPU; only "unset" is verified.
- **Vendor/game window rules** (Steam, Battle.net, RetroArch, Moonlight, GeForce NOW, Resolve, JetBrains,
  Telegram, Hermes, 1Password, Bitwarden, xfreerdp Windows VM, webcam overlay sizes): apps not installed,
  several need a GPU, a camera or accounts; VM-NO / inspected only.
- **`workspace = "special silent"` for "… is sharing" windows** and **`no_screen_share`** on password
  managers: need a real screen share in progress with the relevant app; the share-picker test covers the
  picker only.
- **`anr_missed_pings`, `on_focus_under_fullscreen`, `warp_on_change_workspace`**: behavioural knobs with no
  reliable trigger from the driver (the ANR dialog only appears when an app actually hangs) — named as
  driver quirks instead.
- **Theme-level `hyprland.lua` overrides** (`omarchy.current.theme.hyprland`): belongs to the themes reviewer.
- **Hyprland version drift**: several HEAD chords may be absent on the 4.0.2 minted disk (O-1); each affected
  test says to check Super+K and report "absent on this build" — a mint from a newer ISO removes the caveat.

