# 50 — Omarchy's own graphical acceptance suite (what it proves, and how a screenshot driver reproduces it)

Source: `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18 (dev line, `version` = 4.0.0.alpha). Our minted disk is the
4.0.2 ISO; where HEAD and 4.0.2 may differ this is flagged.

## Scope

Read completely, every line:

| file | lines | what it is |
|---|---|---|
| `test/acceptance` | 101 | in-guest runner: discovers the Hyprland session over SSH, runs `test/acceptance.d/*-test.sh` under a per-file timeout |
| `test/acceptance.d/base-test.sh` | 126 | shared helpers: `pass/fail`, `screenshot` (grim), `screen_contains` (grim 2x + tesseract), `wait_until`, `window_present/absent`, `layer_present/absent`, `layer_on_screen/off_screen`, `close_windows`, `launch_app` |
| `test/acceptance.d/apps-test.sh` | 49 | launch + close foot, chromium, nvim, omawrite |
| `test/acceptance.d/cups-test.sh` | 51 | printing packages, cups-browsed absent, CUPS running, unauthenticated admin denied |
| `test/acceptance.d/menu-test.sh` | 107 | keyboard walk Root → Style → Menu Bar → Position → Left; bar goes vertical; restore |
| `test/acceptance.d/panels-test.sh` | 120 | weather (Open-Meteo, San Francisco), bluetooth/network/audio/monitor panels, power-absent path, Tab cycling, Escape after reopen |
| `test/acceptance.d/security-test.sh` | 115 | input group, asdcontrol sudoers, sshd hardening (opt-in with sudo password) |
| `test/acceptance.d/session-test.sh` | 77 | monitor, shell ping, 13 plugins, bar/background on screen, bar hide/reveal, pipewire, btrfs, version, no failed units |
| `test/acceptance.d/shell-surfaces-test.sh` | 117 | emoji picker, clipboard history, system menu, background/theme selectors, reminder flow, notification, apps-menu launch |
| `test/acceptance.d/system-test.sh` | 135 | core package manifest, kernel headers, default apps/MIME, services, docker unreachable, terminal tools, XDG dirs, user state |
| `agents/skills/acceptance-tests.md` | 46 | how/where the suite runs (omarchy-iso-test, disposable VM, QMP for global hotkeys, wtype for typing) |
| `agents/skills/visual-verification.md` | 44 | `omarchy capture screenshot fullscreen save`, `omarchy screenrecord --fullscreen/--stop-recording`, `wtype -k Right -k Return` |
| `docs/testing.md` | 137 | suite map (`test/all`, `test/cli`, `test/shell`), base-test contract, `require_compositor`, node bridge |
| `test/all` | 23 | runs `test/cli` + `test/shell`, keeps going, summarizes |
| `test/cli` | 714 | CLI router/help/metadata lint + theme template pipeline against stub binaries and fake `$HOME` (headless) |
| `test/shell` | 36 | runs every `test/shell.d/*-test.sh` except base, keeps going |
| `test/shell.d/base-test.sh` | 127 | headless helpers: `require_command`, `compositor_reachable`, `require_compositor` (skip = pass), `run_node_test` |
| `test/shell.d/acceptance-helpers-test.sh` | 53 | unit test of `layer_on_screen` against mocked `hyprctl` (offset + rotated monitors) |
| `test/shell.d/runtime-smoke-test.sh` | 749 | launches a second quickshell against a fake `$HOME`; asserts IPC contracts, plugin hot-reload, bar geometry, replacement-bar boundaries |
| `test/shell.d/screenshot-sanity-test.sh` | 244 | second quickshell + `omarchy capture screenshot fullscreen save`; decodes the PNG and asserts the top bar band is non-blank |
| `test/shell.d/fixtures/**` | 50 files, 2326 lines | listed and skimmed: QML fixtures (`bar-widget-contract`, `indicator-contract`, `lock-fingerprint-indicator`, `lock-password-overflow`, `manifest-entrypoints`, `network-captive-portal` + `NetworkMock.qml`, `plugin-auth-boundary`, `plugin-registry`, `pointer-move-gate`, `tray-menu-activation` + `mock-sni.py`), `kitty/check-config.py` + `legacy.conf`, `legacy-icon-font/omarchy.ttf` + README, 30 `privileged-heredoc/*.sh` lint fixtures |

Also consulted (read-only, to get exact hotkeys and menu labels the driver needs): `default/hypr/bindings/utilities.lua`,
`default/hypr/bindings/applications.lua`, `default/hypr/bindings/tiling.lua`, `default/omarchy/omarchy-menu.jsonc` (root/System/Style
sections), `config/omarchy/shell.json`, `bin/omarchy-toggle-bar`, `bin/omarchy-notification-send` (header), `bin/omarchy-menu-emoji-insert`,
`shell/plugins/reminders/*.qml` (prompt texts and invalid-minutes path), `shell/plugins/clipboard/Clipboard.qml` (Return / Shift+Return / Alt+Return),
`shell/plugins/emojis/*.qml` (Return → `omarchy-menu-emoji-insert`), `bin/omarchy-provision-owner:776-790` (autologin policy).

Skipped: the sibling `omarchy-iso` repository (`omarchy-iso-test`, the harness that boots the acceptance VM) is not in the tree, so the
acceptance VM's exact QEMU shape (resolution, GPU, user name) is inferred from what the suite itself needs, not read from the harness.
The fixtures were skimmed, not analysed line by line: they are inputs to headless unit tests and contain no user-reachable behaviour.

## Inventory

One line per assertion. Format: `file:line — behaviour — drive — expectation — driver mapping` where *drive* is how the acceptance
test manipulates the desktop (IPC = `omarchy-shell` Quickshell IPC; hyprctl = compositor JSON; wtype = in-guest virtual keyboard; OCR =
`screen_contains`), and *driver mapping* says how our screenshot-only driver checks the same thing (or why it cannot).

#### Runner and helpers

1. `test/acceptance:44-65` — Hyprland session comes up after (first) boot — polls `ls -t $XDG_RUNTIME_DIR/hypr` then `hyprctl -j monitors` every 2s — within `OMARCHY_ACCEPTANCE_BOOT_TIMEOUT` (300s) else "not ok - Hyprland session never came up" — driver: after `--resume` + LUKS passphrase, a screenshot shows the bar and wallpaper; no IPC needed.
2. `test/acceptance:90` — each test file completes — `timeout ${OMARCHY_ACCEPTANCE_TEST_TIMEOUT:-420} bash $test` — 420s per file — driver: our per-session budget is 600s; parity.
3. `test/acceptance:20-39,67-70` — suite works over SSH with no session env — derives `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `DISPLAY`, `LANG`, `WAYLAND_DISPLAY`; `OMARCHY_PATH` defaults to `/usr/share/omarchy` (installed tree, never the checkout) — n/a for a driver typing in a foot window, which already has the session env.
4. `base-test.sh:31-33` `screenshot <name>` — `timeout 10 grim $ARTIFACTS/<name>.png`, best effort — driver: `./client get-image`.
5. `base-test.sh:35-49` `screen_contains <text>` — `grim -s 2` (2x scale, small captions drop at 1x) + `tesseract --psm 11` + `grep -Fi` (case-insensitive fixed substring) — driver: the LLM reads the screenshot; expect the same texts, case-insensitively.
6. `base-test.sh:52-66` `wait_until <desc> <secs> <cmd>` — 1s poll; on timeout writes `failure-<slug>.png` and exits the file — driver: screenshot after every action, ≤5s between actions, give up after the same number of seconds.
7. `base-test.sh:68-74` `window_present/absent <regex>` — `hyprctl -j clients | jq '.class | test($class)'` — driver: a window is visible on screen; class is not readable, so use title bar/contents (foot prompt, Chromium new-tab page, Neovim intro, Omawrite editor).
8. `base-test.sh:76-82` `layer_present/absent <ns>` — `hyprctl -j layers` namespace match (`omarchy-bar`, `omarchy-background`, `omarchy-menu`, `omarchy-emojis`, `omarchy-clipboard`, `omarchy-image-selector`, `omarchy-reminders`, `omarchy-notifications`, `omarchy-keyboard-panel`, `omarchy-keyboard-panel-dismiss`) — driver: the overlay is visible / gone in the screenshot.
9. `base-test.sh:89-110` `layer_on_screen/off_screen <ns>` — layer box intersects the monitor's logical size (transform-aware) — driver: the bar is visible along an edge vs. not visible at all (a hidden bar stays mapped but parked off-screen, so "not visible" is exactly the expected state).
10. `base-test.sh:114-122` `close_windows <regex>` — `hyprctl dispatch "hl.dsp.window.close({ window = \"address:…\" })"` (quattro Lua dispatcher) then classic `closewindow address:…` — driver: focus the window and press `Super+W` (also `Super+Q`).
11. `base-test.sh:124-126` `launch_app <cmd>` — `setsid -f bash -c "<cmd>"` — driver: the hotkey for the app, or the command typed into foot followed by `&`.
12. `test/shell.d/acceptance-helpers-test.sh:48-53` — six unit assertions that `layer_on_screen` handles positively/negatively offset and rotated monitors with a mocked `hyprctl` — headless; not user-facing.

#### apps-test.sh (`launch_and_verify name command class timeout=45`)

13. `apps-test.sh:12-14` — precondition: no window matching the class exists before launch — hyprctl — fail "`<name>` starts with no pre-existing window" — driver: pristine desktop; screenshot shows no windows.
14. `apps-test.sh:16-17,37` terminal — `foot` — window class `^foot$` within 45s — driver: `Super+Return`; a foot window with a shell prompt appears.
15. `apps-test.sh:21-31` terminal — close by address, retry every 2s — gone within 30s — driver: `Super+W`; window gone.
16. `apps-test.sh:16-17,38` browser — `chromium --new-window` — class `(?i)chromium` within 45s — driver: `Super+Shift+Return` (or `Super+Shift+B`); Chromium window appears.
17. `apps-test.sh:21-31` browser closes within 30s — driver: `Super+W`.
18. `apps-test.sh:16-17,39` neovim — `xdg-terminal-exec --app-id=org.omarchy.nvim nvim` — class `org.omarchy.nvim` within 45s — driver: `Super+Shift+N` (Editor binding); a terminal window showing Neovim (LazyVim dashboard) appears.
19. `apps-test.sh:21-31` neovim closes within 30s — driver: `Super+W`.
20. `apps-test.sh:16-17,40` writer — `omawrite` — class `(?i)omawrite` within 45s — driver: `Super+Shift+W` (preinstalled bindings) or apps menu; Omawrite window appears.
21. `apps-test.sh:21-31` writer closes within 30s — driver: `Super+W`.
22. `apps-test.sh:18-19` — `sleep 1` then `screenshot success-app-<name>` — driver: screenshot of each opened app.

#### cups-test.sh (all pure command checks; driver types them into foot)

23. `cups-test.sh:7-10` — `pacman -Q cups cups-filters system-config-printer cups-pk-helper` all succeed — "printing packages are installed".
24. `cups-test.sh:12-13` — `pacman -Q cups-pdf` fails — "the root CUPS-PDF backend is absent".
25. `cups-test.sh:15` — `pacman -Q cups-browsed` fails.
26. `cups-test.sh:16-17` — `systemctl is-enabled cups-browsed.service` fails.
27. `cups-test.sh:18-19` — `systemctl is-active cups-browsed.service` fails.
28. `cups-test.sh:20` — `pgrep -x cups-browsed` finds nothing — together 25-28 = "automatic printer discovery is not installed or running".
29. `cups-test.sh:23-34` — none of `/etc/cups/cups-browsed.conf{,.pacsave,.pacnew}`, `/usr/bin/cups-browsed`, `/usr/lib/cups/backend/implicitclass`, `/usr/lib/systemd/system/cups-browsed.service`, `/etc/systemd/system/multi-user.target.wants/cups-browsed.service` exist.
30. `cups-test.sh:36` — `systemctl is-enabled cups.service` — enabled.
31. `cups-test.sh:37` — `systemctl is-active cups.service` — active.
32. `cups-test.sh:38-39` — `timeout 10 lpstat -r` succeeds — "the CUPS scheduler answers" (prints `scheduler is running`).
33. `cups-test.sh:41-44` — `stat -c '%U:%G %a' /etc/cups/cups-files.conf` == `root:cups 640`.
34. `cups-test.sh:46-51` — `LC_ALL=C lpinfo -v </dev/null` **fails** and its output contains `Forbidden` — "CUPS denies unauthenticated desktop administration" (negative path).

#### menu-test.sh (IPC summon + wtype walk; state in `~/.config/omarchy/shell.json`)

35. `menu-test.sh:65-66` — root menu opens — IPC `omarchy-shell shell summon omarchy.menu '{"menu":"root"}'` — layer `omarchy-menu` within 15s — driver: `Super+Space`.
36. `menu-test.sh:67` — root content visible — OCR `Apps` within 15s — driver: "Apps" row visible (root order: Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System).
37. `menu-test.sh:70-73` — `wtype -k Down -k Down -k Down` selects Style (4th row), `Return` — driver: `<DOWN><DOWN><DOWN><ENTER>`.
38. `menu-test.sh:75` — Style submenu — OCR `Theme` within 15s — driver: rows Theme, Background, Unlock, Font, Menu Bar, Hyprland, Screensaver, About.
39. `menu-test.sh:78-80` — `Down×4 Return` → Menu Bar submenu (Theme→Background→Unlock→Font→Menu Bar) — screenshot only — driver: rows Position, Transparency visible.
40. `menu-test.sh:82-84` — `Return` on Position (first row) → Position submenu — screenshot only — driver: rows Top, Bottom, Left, Right.
41. `menu-test.sh:86-87` — `Down×2 Return` selects Left — `jq '.bar.position' ~/.config/omarchy/shell.json` == `left` within 20s — driver: `cat ~/.config/omarchy/shell.json | grep position` in foot, or just the visible bar.
42. `menu-test.sh:88` — bar becomes vertical — `omarchy-bar` layer `w < h` within 20s — driver: the bar is now a vertical strip on the left edge.
43. `menu-test.sh:89` — menu closes after selecting a position — layer absent within 15s — driver: no menu overlay.
44. `menu-test.sh:92-103` — restore original config + `omarchy-shell shell reloadConfig` — bar horizontal again within 20s — driver: `omarchy-bar position top` in foot (or walk the menu again); bar back on top.

#### panels-test.sh (IPC summon/hide; layer namespace `omarchy-keyboard-panel` for every panel)

45. `panels-test.sh:53` — set deterministic weather location — `omarchy-weather-location --set "San Francisco" "37.7749,-122.4194"` — driver: same command in foot.
46. `panels-test.sh:54-55` — weather panel opens — IPC summon `omarchy.weather` — layer within 15s — driver: `Super+Ctrl+Alt+W` (bound to `omarchy-notification-weather` → `omarchy-shell shell toggle omarchy.weather`) or click the weather widget in the bar centre.
47. `panels-test.sh:56` — OCR `SAN FRANCISCO` within 30s (real Open-Meteo fetch) — driver: read heading. **NET**.
48. `panels-test.sh:57` — OCR `WIND` within 30s — driver: detail label "WIND" visible.
49. `panels-test.sh:59-60` — hide → layer absent within 15s — driver: same hotkey again / Escape.
50. `panels-test.sh:42-48` bluetooth — summon `omarchy.bluetooth` → layer within 15s — driver: `Super+Ctrl+B`.
51. `panels-test.sh:46-48` bluetooth — hide → absent within 15s — driver: Escape.
52. `panels-test.sh:42-48` network — summon `omarchy.network` → layer within 15s — driver: `Super+Ctrl+W`.
53. `panels-test.sh:46-48` network — hide → absent within 15s.
54. `panels-test.sh:42-48` audio — summon `omarchy.audio` → layer within 15s — driver: `Super+Ctrl+A`.
55. `panels-test.sh:46-48` audio — hide → absent within 15s.
56. `panels-test.sh:42-48` monitor — summon `omarchy.monitor` → layer within 15s — driver: `Super+Ctrl+D`.
57. `panels-test.sh:46-48` monitor — hide → absent within 15s.
58. `panels-test.sh:76-87` power — if `upower -e | grep /battery_`: open/close like the others; **else** `pass "power panel is hidden without battery hardware"` + screenshot `success-panel-power-unavailable` — driver: in our VM the else branch is the expected one: no battery icon in the bar, `Super+Ctrl+P` shows no panel.
59. `panels-test.sh:90-92` — summon bluetooth → OCR `Bluetooth` within 15s — driver: heading "Bluetooth".
60. `panels-test.sh:94-96` — `wtype -k Tab`, sleep 2 → some `omarchy-keyboard-panel` layer still present within 15s ("Tab keeps a shell panel open"; the common panel keyboard contract moves to the next bar panel) — driver: after `<TAB>` a *different* panel (Network) is showing.
61. `panels-test.sh:98-99` — hide all → absent within 15s.
62. `panels-test.sh:103-105` — summon bluetooth → present 15s ("focus-prime panel opens").
63. `panels-test.sh:106-109` — on a single monitor, no `omarchy-keyboard-panel-dismiss` layer exists — hyprctl only — driver: **cannot** see an invisible dismissal layer; single-monitor VM makes this assertion active but unobservable.
64. `panels-test.sh:110-112` — hide then summon immediately (during the fade) → present 15s ("focus-prime panel reopens").
65. `panels-test.sh:115-116` — `wtype -k Escape` → absent within 15s ("Escape closes a panel reopened during fade"; proves keyboard focus was re-acquired rather than left in the previous app) — driver: same with `<ESC>`; the negative would be Escape landing in the terminal instead.

#### security-test.sh

66. `security-test.sh:20-30` — user not in `input` group (`id -nG`), unless `xpadneo-dkms` or `ydotool` is installed (opt-in justification) — driver: `id -nG` in foot shows no `input`.
67. `security-test.sh:32-43` — `sudo_available`: `sudo -n true` or `printf pw | sudo -S -v` with `OMARCHY_ACCEPTANCE_SUDO_PASSWORD` — driver: our sudo password is `prime`.
68. `security-test.sh:45-52` — `sudo -n test -e /etc/sudoers.d/omarchy-asdcontrol` fails — "no omarchy asdcontrol sudoers grant is shipped" — driver: `sudo test -e … ; echo $?` prints 1.
69. `security-test.sh:58-59` — `ssh-keygen -t ed25519 -N "" -f /tmp/omarchy-acceptance-sshd-key` — driver: same.
70. `security-test.sh:67-74` — `omarchy-setup-security-sshd --key="<pub>"` completes unattended (under `script` pty with sudo pre-validated; log to `setup-security-sshd.log`) — driver: run it in foot, answer the sudo prompt with `prime`.
71. `security-test.sh:76-77` — `systemctl is-active sshd.service` — active.
72. `security-test.sh:79-80` — pubkey line present in `~/.ssh/authorized_keys` (`grep -qxF`).
73. `security-test.sh:86-88` — `sudo -n sshd -T` contains `passwordauthentication no` (case-insensitive; 9.x lowercase, 10.x CamelCase).
74. `security-test.sh:89-90` — `kbdinteractiveauthentication no`.
75. `security-test.sh:92-95` — if `ufw` present: `sudo ufw status | grep -E '^22/tcp\s+LIMIT'`.
76. `security-test.sh:99-100` — cleanup: remove the throwaway key from `authorized_keys`; hardening itself is left in place.
77. `security-test.sh:104-108` — asdcontrol check **skipped** ("sudo needs a password") when no cached/provided sudo.
78. `security-test.sh:110-115` — sshd exercise **skipped** unless `OMARCHY_ACCEPTANCE_SUDO_PASSWORD` is set (only omarchy-iso-test's throwaway VMs set it).

#### session-test.sh

79. `session-test.sh:8-10` — `hyprctl -j monitors | jq length` ≥ 1 — driver: there is a screen with content.
80. `session-test.sh:13` — `omarchy-shell shell ping` succeeds within 60s — IPC — driver: type it in foot → `ok`.
81. `session-test.sh:16-24` — `omarchy-shell shell listPlugins` contains each of `omarchy.audio omarchy.background omarchy.bar omarchy.bluetooth omarchy.clipboard omarchy.emojis omarchy.menu omarchy.monitor omarchy.network omarchy.notifications omarchy.power omarchy.reminders omarchy.weather` (13 assertions, one `pass` each) — driver: `omarchy-shell shell listPlugins | jq -r '.[].id'` in foot.
82. `session-test.sh:27` — `omarchy-bar` layer on screen within 30s — driver: bar visible along the top edge.
83. `session-test.sh:28` — `omarchy-background` layer on screen within 30s — driver: wallpaper visible.
84. `session-test.sh:37-38` — `omarchy-toggle-bar on` (= hide) → layer still mapped within 15s — hyprctl only — driver: cannot see "mapped but parked"; sees the bar disappear.
85. `session-test.sh:39` — hidden bar parks off screen within 15s — driver: no bar in the screenshot (`Super+Shift+Space` is the "Toggle top bar" binding).
86. `session-test.sh:42-43` — `omarchy-toggle-bar off` (= show) → on screen within 15s — driver: bar is back.
87. `session-test.sh:48` — `wpctl status` succeeds within 30s ("pipewire is running") — driver: type it; PipeWire tree prints even with no audio device.
88. `session-test.sh:51-52` — `findmnt -no FSTYPE /` == `btrfs`.
89. `session-test.sh:55-56` — `omarchy-version` exits 0.
90. `session-test.sh:60-69` — `systemctl --system --failed --no-legend --plain` is empty (minus `OMARCHY_ACCEPTANCE_IGNORE_UNITS`) — "no failed system units".
91. `session-test.sh:71-75` — same for `--user` — "no failed user units".
92. `session-test.sh:77` — `screenshot success-desktop`.

#### shell-surfaces-test.sh

93. `shell-surfaces-test.sh:26-27` — emoji picker opens — IPC summon `omarchy.emojis` — layer `omarchy-emojis` within 15s — driver: `Super+Ctrl+E`. (Comment L24-25: the host harness proves the shortcut with a QMP key chord; our `send-keys` is that same mechanism.)
94. `shell-surfaces-test.sh:28-30` — `wtype "rocket"`, screenshot `success-emoji-picker-search` — driver: type `rocket`; 🚀 row is filtered in.
95. `shell-surfaces-test.sh:31-32` — `Return` → layer absent within 15s. Side effect (`omarchy-menu-emoji-insert`): emoji is `wl-copy`'d and `Shift+Insert` is typed into the focused app — driver: with foot focused first, 🚀 appears on the prompt.
96. `shell-surfaces-test.sh:35-37` — `printf token | wl-copy` → token appears in `~/.local/state/omarchy/clipboard-history.json` within 15s — driver: `grep` the file in foot.
97. `shell-surfaces-test.sh:38-39` — a second copy (`clipboard decoy`) so the token is not the newest entry.
98. `shell-surfaces-test.sh:41-42` — clipboard opens — summon `omarchy.clipboard` — layer `omarchy-clipboard` within 15s — driver: `Super+Ctrl+V`.
99. `shell-surfaces-test.sh:43-44` — type the token → OCR `Omarchy acceptance clipboard` within 15s — driver: the matching row is visible.
100. `shell-surfaces-test.sh:46-47` — `Shift+Return` (copy-only, no paste) → layer absent within 15s — driver: `<S-ENTER>`.
101. `shell-surfaces-test.sh:48` — `wl-paste --no-newline` == token within 15s — driver: `wl-paste` in foot prints the token, not the decoy.
102. `shell-surfaces-test.sh:51-52` — system menu opens — summon `omarchy.menu '{"menu":"system"}'` — layer within 15s — driver: `Super+Escape`.
103. `shell-surfaces-test.sh:53` — OCR `Shutdown` within 15s — driver: rows Screensaver, Lock, Suspend, (Hibernate), Logout, Reboot, Shutdown.
104. `shell-surfaces-test.sh:55-56` — `Escape` → layer absent within 15s, nothing executed (negative path: no destructive action).
105. `shell-surfaces-test.sh:60-61` — `omarchy-theme-bg-switcher` → layer `omarchy-image-selector` within 30s (thumbnail generation) — driver: `Super+Ctrl+Space`.
106. `shell-surfaces-test.sh:64-65` — `Escape` → absent within 15s; background unchanged.
107. `shell-surfaces-test.sh:67-68` — `omarchy-theme-switcher` → `omarchy-image-selector` within 30s — driver: `Super+Shift+Ctrl+Space`.
108. `shell-surfaces-test.sh:71-72` — `Escape` → absent within 15s; theme unchanged.
109. `shell-surfaces-test.sh:76-78` — reminders opens — summon `omarchy.reminders` — layer `omarchy-reminders` within 15s; screenshot `success-reminder-01-minutes-prompt` (prompt text `Remind in minutes`) — driver: `Super+Ctrl+R`.
110. `shell-surfaces-test.sh:79-82` — `wtype "5"`, screenshot — driver: `5` visible in the field.
111. `shell-surfaces-test.sh:83` — `Return` → OCR `Reminder message` within 15s.
112. `shell-surfaces-test.sh:85-86` — `Escape` → absent within 15s, no timer scheduled — driver: `omarchy-reminder show` in foot lists nothing.
113. `shell-surfaces-test.sh:89-91` — `omarchy-shell notifications dismissAll`; `omarchy-notification-send "Acceptance notification" "Shell notification rendering" --expire-time=15000` → layer `omarchy-notifications` within 15s — driver: same command in foot.
114. `shell-surfaces-test.sh:92` — OCR `Acceptance notification` within 15s.
115. `shell-surfaces-test.sh:94-95` — `dismissAll` → layer absent within 15s — driver: `Super+Shift+comma` (Dismiss all notifications).
116. `shell-surfaces-test.sh:99-101` — precondition: no Omawrite window.
117. `shell-surfaces-test.sh:103-104` — `omarchy-menu summon apps` → layer `omarchy-menu` within 15s — driver: `Super+Alt+Space`.
118. `shell-surfaces-test.sh:108-111` — type `omawrite`, screenshot `success-apps-menu-search`, `Return`.
119. `shell-surfaces-test.sh:113` — window `(?i)omawrite` appears within 60s ("apps menu launches the top search hit").
120. `shell-surfaces-test.sh:114` — menu layer absent within 15s.
121. `shell-surfaces-test.sh:116-117` — close → window absent within 30s.

#### system-test.sh (all command checks)

122. `system-test.sh:16` — `$OMARCHY_PATH/install/omarchy-base.packages` exists (else the audit would pass having checked nothing).
123. `system-test.sh:18-24` — every non-comment line of that manifest is `pacman -Q`-installed — "all Omarchy core packages are installed (0 missing)".
124. `system-test.sh:30-34` — `cat /usr/lib/modules/$(uname -r)/pkgbase` == `linux-omarchy` (or `linux-t2` when that package is present).
125. `system-test.sh:35` — `<kernel>-headers` package present.
126. `system-test.sh:36-37` — `/usr/lib/modules/$(uname -r)/build/include/config/kernel.release` == `uname -r`.
127. `system-test.sh:42-43` — `omarchy-default-browser` == `chromium`.
128. `system-test.sh:45-46` — `omarchy-default-terminal` == `foot`.
129. `system-test.sh:48-49` — `omarchy-default-editor` == `nvim`.
130. `system-test.sh:51-52` — `omarchy-theme-current` != `Unknown`.
131. `system-test.sh:54-55` — `omarchy-theme-bg-current` != `Unknown`.
132. `system-test.sh:57-58` — `omarchy-font-current` non-empty.
133. `system-test.sh:60` — `xdg-mime query default x-scheme-handler/http` == `chromium.desktop`.
134. `system-test.sh:61-62` — `xdg-mime query default inode/directory` == `org.gnome.Nautilus.desktop`.
135. `system-test.sh:68-74` — enabled: `avahi-daemon.service docker.socket NetworkManager.service power-profiles-daemon.service sddm.service systemd-resolved.service ufw.service`.
136. `system-test.sh:76-79` — active: `NetworkManager.service systemd-resolved.service ufw.service`.
137. `system-test.sh:81-83` — `systemctl --user is-active pipewire.service pipewire-pulse.service wireplumber.service`.
138. `system-test.sh:92` — `command -v docker` — CLI installed.
139. `system-test.sh:93` — `id -nG` does **not** contain `docker` (group is root-equivalent).
140. `system-test.sh:97-100` — `timeout 10 docker info` **fails** without elevation (proves no world-writable socket/ACL either) — negative path.
141. `system-test.sh:102-103` — `nvim --headless '+qa'` exits 0.
142. `system-test.sh:105-106` — `timeout 10 fastfetch --pipe false` exits 0.
143. `system-test.sh:108-111` — `git --version`, `tmux -V`, `mise --version` exit 0.
144. `system-test.sh:117-120` — `xdg-user-dir DESKTOP|DOCUMENTS|DOWNLOAD|PICTURES` are existing directories.
145. `system-test.sh:122-123` — `~/.local/state/omarchy/current/theme` and `current/background` exist.
146. `system-test.sh:124-126` — `~/.config/omarchy/shell.json` is non-empty and `jq empty` accepts it.

#### test/shell.d compositor-gated runtime tests (second quickshell against a fake `$HOME`; IPC-only; skip = pass without a compositor)

147. `runtime-smoke-test.sh:342-373` — `shell ping` answers within 8s; `shell listPlugins` includes `omarchy.menu omarchy.notifications omarchy.clock omarchy.osd`, each entry has `kinds/enabled/canDisable/firstParty/clonedFrom`, names sorted — IPC only.
148. `runtime-smoke-test.sh:375-390` — editing an installed plugin manifest under `~/.config/omarchy/plugins/<id>/` hot-reloads its name without `rescanPlugins` — file + IPC; not user-visible in stock UI.
149. `runtime-smoke-test.sh:392-398` — `setPluginEnabled <clone> true` then `summon omarchy.emojis` routes to the enabled clone — IPC.
150. `runtime-smoke-test.sh:400-410` — `shell listShellConfig` returns `.version == 1` and `bar.layout.{left,center,right}` arrays — IPC.
151. `runtime-smoke-test.sh:412-415` — `summon omarchy.menu '{"menu":"apps"}'` → `ok`; `summon missing.plugin` → `unknown` (negative) — IPC; driver can type these in foot.
152. `runtime-smoke-test.sh:417-436` — `notifications ping` → `ok`; `notifications setDnd false` → `off`; `media ping/status`; `idle status .enabled`; `lock status .locked`; `image-selector ping`; `osd ping`; `osd show '{"message":"Runtime smoke","duration":0}'` → `ok`; `osd close` — IPC; the OSD show is user-visible.
153. `runtime-smoke-test.sh:438-467` — image-selector IPC survives `rescanPlugins`; `lock status .lastEvent` never starts `lock-stranded` after a rescan; a `keepLoaded` service keeps in-memory state across rescan; dropping the service entry point drops the instance (471-482) — IPC only.
154. `runtime-smoke-test.sh:487-541` — `debugBarGeometry` lists every id from the default `shell.json` layout; `omarchy.menu workspaces clock weather system-update network audio monitor` visible with `w,h > 0`; centre order weather < system-update < indicators — IPC; driver sees the same widgets in the bar.
155. `runtime-smoke-test.sh:543-547` — `omarchy.audio|bluetooth|monitor|network|power open/close` direct IPC works — driver: hotkeys.
156. `runtime-smoke-test.sh:556-565` — each widget registers its IPC handler once per screen (log grep) — n/a.
157. `runtime-smoke-test.sh:567-593` — `omarchy-plugin-disable omarchy.audio` removes it from `listShellConfig.bar.layout.right` and from the live geometry — driver: audio icon disappears from the bar (user-visible; restore with `omarchy-plugin-enable`).
158. `runtime-smoke-test.sh:598-630` — `omarchy-bar put omarchy.keyboard-layout --after omarchy.clock` places it right after clock; a second `put --section right` leaves the existing widget alone — file + IPC; keyboard-layout is already in the stock centre section so the driver cannot reproduce the "missing then placed" case without editing config.
159. `runtime-smoke-test.sh:635-749` — replacement-bar security boundaries (no generic service factory, detached `barConfig` snapshots, clone facades can summon only their own OSD, manifest reload revokes capabilities) — fixture plugins + IPC; not reproducible from stock UI.
160. `screenshot-sanity-test.sh:110-119` — `debugBarGeometry` shows `omarchy.menu` and `omarchy.clock` visible with `w,h > 0` — IPC.
161. `screenshot-sanity-test.sh:121-129` — `omarchy capture screenshot fullscreen save` prints a path and the file exists — driver: same command in foot; path under `~/Pictures`.
162. `screenshot-sanity-test.sh:131-244` — the saved PNG's top bar band (`max(24,min(80,tallest visible widget+8))` px) has ≥3 distinct colours and any non-black pixel — driver: open the PNG (e.g. `xdg-open`) or trust `get-image`; the bar being visibly rendered is the same proof.
163. `runtime-smoke-test.sh:20-25`, `screenshot-sanity-test.sh:21-30` — both skip (as a pass) when no compositor / no quickshell / slurp already running — `require_compositor` contract from `docs/testing.md:69-90`.

#### test/cli and test/all (headless; listed for completeness, no desktop behaviour)

164. `test/cli:54-61` — `omarchy --help` contains `Omarchy command center`, groups `hw`, `pkg`, no `(N)` counts; `test/cli:63-109` `commands`/`--json`/`--check`/`--all` route metadata; `test/cli:111-149` group help texts (`Theme commands`, `Install commands`, `Toggle commands`, `omarchy share <clipboard|file|folder> [path...]`…); `test/cli:185-234` a trailing `--help` never executes (`theme set --help` shows `Binary:`; `update --help` shows `omarchy-update`); `test/cli:236-248` `dev benchmark cli --repeat=1`, `theme list/current`, `font list/current` dispatch; `test/cli:250-586` theme template pipeline; `test/cli:588-714` metadata lint and router edge cases. Driver-usable subset: `omarchy --help`, `omarchy theme list`, `omarchy update --help` (must not update).
165. `test/all:12-23` — runs `test/cli` then `test/shell`, continues on failure, prints "`N of 2 suites failed`" — n/a.

**Assertions inventoried: 165 lines** (item 81 stands for 13 individual `pass` lines, items 147-165 group the headless suites).

## Observations

#### How the acceptance VM differs from ours

- **Who drives it.** The acceptance suite runs *inside* the guest, launched over SSH by `omarchy-iso-test` (sibling `omarchy-iso` repo, not
  in the tree). It has a shell, `hyprctl`, `jq`, `grim`, `tesseract`, `wtype`, `wl-copy/wl-paste`, and IPC (`omarchy-shell`). Our driver has
  none of that directly; anything command-shaped is typed into a foot window (`Super+Return`) and read from the screenshot or `/dev/ttyS0`.
- **Global hotkeys.** `agents/skills/acceptance-tests.md:44-46` is explicit: in-guest `wtype` "does not reliably prove that a global
  Hyprland keybinding works"; the harness proves shortcuts with **QMP virtual keyboard input**. Our `./client send-keys` *is* QMP input,
  so every `omarchy-shell shell summon …` in the suite can be replaced by the real hotkey and we prove *more* than the suite does.
- **Screen text.** `screen_contains` = `grim -s 2` + `tesseract --psm 11` + case-insensitive substring. The 2x scale exists because
  "tesseract routinely drops small caption text at native resolution (the weather panel's detail labels, for one)". Our driver reads the
  PNG directly; expect the same small captions to be hard to read and say so in hints.
- **Machine shape.** Resolution, GPU and user name are not stated anywhere in this tree. The suite is resolution-agnostic (logical
  coordinates, transform-aware). `manual/51-unattended-installs.md:46-49` documents a Proxmox VM with `--vga virtio --serial0 socket`,
  i.e. the same virtio-vga + serial console shape as ours. The sudo password is known to the harness (`OMARCHY_ACCEPTANCE_SUDO_PASSWORD`);
  ours is `prime`.
- **Autologin.** `bin/omarchy-provision-owner:776-782` writes `/etc/sddm.conf.d/autologin.conf` and *keeps it permanently on encrypted
  installs* ("the LUKS prompt is the auth boundary"); unencrypted installs autologin once. Our minted disk is LUKS (`prime`), so after the
  passphrase the guest should land on the desktop without SDDM. (HEAD logic; confirm on 4.0.2.)
- **Timeouts.** Boot 300s (`OMARCHY_ACCEPTANCE_BOOT_TIMEOUT`), 420s per test file (`OMARCHY_ACCEPTANCE_TEST_TIMEOUT`), 1s poll.
  Per-assertion waits worth reusing verbatim: **15s** for any layer to open/close; **20s** for bar position/orientation; **30s** for
  bar/background on screen, pipewire, weather text, image selectors (thumbnails); **45s** app launch; **60s** shell ping and the
  apps-menu Omawrite launch; **30s** to close a window.
- **Fresh session.** `apps-test.sh:12-14` and `shell-surfaces-test.sh:99-101` refuse to run if a matching window already exists. Our
  tests start on a pristine minted desktop, so the precondition holds; a test that opens foot must close it before asserting "no windows".
- **State restore.** Every acceptance file restores what it touched with a `trap … EXIT` (bar config, weather location, panels hidden).
  Our disk is discarded unless `save`d, so restoration only matters *within* a test for later steps.
- **Idle.** `config/omarchy/shell.json` ships `idle.screensaver = 150` and `idle.lock = 300` seconds. A driver that stalls > 150s without
  input gets the screensaver; > 300s the lock screen. The 5s cadence rule prevents this; long installs must keep sending harmless keys.

#### Which acceptance tests already skip or take the hardware-less path in a VM

- `panels-test.sh:76-87` **power panel**: no `/battery_` in `upower -e` → `pass "power panel is hidden without battery hardware"`. Our VM
  has no battery; the absence path is the expected result (bar shows no power icon, `Super+Ctrl+P` opens nothing).
- `security-test.sh:104-108` **asdcontrol sudoers** skipped when sudo needs a password and none is provided; `110-115` **sshd hardening**
  skipped without `OMARCHY_ACCEPTANCE_SUDO_PASSWORD`. We know the password, so both are runnable here.
- `panels-test.sh:106-109` **dismiss twin** is asserted only on single-monitor sessions (ours) but is invisible (a layer that must *not*
  exist).
- `system-test.sh:31` **linux-t2** branch is inactive (Apple T2 only); expect `linux-omarchy`.
- `panels-test.sh:53-57` **weather** performs a real Open-Meteo fetch; needs outbound network (we have it).
- Bluetooth/audio panels: the suite only asserts the layer opens. In our VM there is no adapter / no sink; the panels show their empty
  states, which is the correct software path.
- `security-test.sh:20-30` **input group**: passes either way on stock (no `xpadneo-dkms`/`ydotool` installed → user must not be in `input`).

#### Helper vocabulary worth reusing verbatim in instructions/proofs

- Window classes: `^foot$`, `(?i)chromium`, `org.omarchy.nvim`, `(?i)omawrite`.
- Layer namespaces: `omarchy-bar`, `omarchy-background`, `omarchy-menu`, `omarchy-emojis`, `omarchy-clipboard`,
  `omarchy-image-selector`, `omarchy-reminders`, `omarchy-notifications`, `omarchy-keyboard-panel` (all bar panels), plus the
  `no_anim` layer rule in `default/hypr/apps/omarchy-shell.lua:10` (menu/selector/emojis/clipboard/panels open without animation, so the
  next screenshot is already final).
- OCR strings: `Apps`, `Theme`, `Shutdown`, `SAN FRANCISCO`, `WIND`, `Bluetooth`, `Omarchy acceptance clipboard`, `Reminder message`,
  `Acceptance notification`. Prompt text for the first reminder step is `Remind in minutes` (`shell/plugins/reminders`).
- Commands with fixed expected output: `omarchy-default-browser` → `chromium`; `omarchy-default-terminal` → `foot`;
  `omarchy-default-editor` → `nvim`; `xdg-mime query default x-scheme-handler/http` → `chromium.desktop`; `inode/directory` →
  `org.gnome.Nautilus.desktop`; `findmnt -no FSTYPE /` → `btrfs`; `cat /usr/lib/modules/$(uname -r)/pkgbase` → `linux-omarchy`;
  `stat -c '%U:%G %a' /etc/cups/cups-files.conf` → `root:cups 640`; `lpinfo -v` → `lpinfo: Forbidden`; `omarchy-shell shell ping` → `ok`;
  `omarchy-shell shell summon missing.plugin "{}"` → `unknown`; `sshd -T` → `passwordauthentication no`, `kbdinteractiveauthentication no`;
  `ufw status` → `22/tcp  LIMIT`.
- Notification used by the suite: `omarchy-notification-send "Acceptance notification" "Shell notification rendering" --expire-time=15000`.
- Weather fixture: `omarchy-weather-location --set "San Francisco" "37.7749,-122.4194"`.

#### Hotkeys and menu paths (HEAD `default/hypr/bindings/*.lua`, `default/omarchy/omarchy-menu.jsonc`)

- `Super+Space` root menu (`omarchy-menu toggle`), `Super+Alt+Space` Apps menu, `Super+Escape` **System** menu (the existing
  `lock-screen` definition calls this "Omarchy Menu"; it is the System submenu: Screensaver, Lock, Suspend, Hibernate*, Logout, Reboot,
  Shutdown — `*` only when `omarchy-hibernation-available`; Suspend hidden when `suspend-off` toggle is set).
- Root order: Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System. Style: Theme, Background, Unlock, Font,
  **Menu Bar**, Hyprland, Screensaver, About. Menu Bar: **Position**, Transparency. Position: Top, Bottom, **Left**, Right. This is
  exactly the `Down×3 / Down×4 / Return / Down×2` walk in `menu-test.sh`.
- `Super+Ctrl+E` emojis, `Super+Ctrl+V` clipboard, `Super+Ctrl+R` reminder (set), `Super+Ctrl+Space` background switcher,
  `Super+Shift+Ctrl+Space` theme switcher, `Super+Shift+Space` toggle bar, `Super+Ctrl+A` audio, `Super+Ctrl+B` bluetooth, `Super+Ctrl+W`
  network, `Super+Ctrl+D` display (monitor), `Super+Ctrl+P` power, `Super+Ctrl+Alt+W` weather panel, `Super+Ctrl+1..9` bar panel *n*,
  `Super+comma` dismiss one notification, `Super+Shift+comma` dismiss all, `Super+Ctrl+L` lock, `Super+Return` terminal,
  `Super+Shift+Return`/`Super+Shift+B` browser, `Super+Shift+N` editor (nvim), `Super+Shift+W` Omawrite (preinstalled bindings),
  `Super+W`/`Super+Q` close window, `Print` screenshot.
- `omarchy-toggle-bar on` **hides** the bar (`omarchy-toggle bar-off on`), `off` shows it. Counter-intuitive; the hotkey toggles.
- Clipboard keys: `Return` pastes the selected entry into the previous window (Shift+Insert), `Shift+Return` copies only, `Alt+Return` opens,
  `Delete` removes the selected entry, `Shift+Delete` asks to clear the whole history (`Clipboard.qml:366-368,388-392`). Emoji `Return` →
  `omarchy-menu-emoji-insert` (wl-copy + Shift+Insert into the focused app).
- Reminder flow: empty minutes + Return dismisses; non-numeric minutes → notification "Invalid reminder — Enter the number of minutes"
  and the prompt stays.
- HEAD uses the Hyprland "quattro" Lua config and `hl.dsp.*` dispatchers (`base-test.sh:119`); the 4.0.2 disk may still be classic
  `.conf`. Hotkeys above are the same in both lines as far as the acceptance suite depends on them, but a driver should confirm each
  overlay visually rather than assume.

## Proposed tests

### session-desktop-health   [VM-OK]
description: A freshly booted desktop is healthy end to end: bar and wallpaper on screen, the shell answers, and a terminal shows no failed units, a btrfs root, and a working version report.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot. The top bar (menu icon, workspaces, clock) and the wallpaper must be visible with no crash dialog.
  * Open a terminal with Super+Enter. A foot window with a shell prompt must appear within 45 seconds.
  * Type `omarchy-shell shell ping; omarchy-version; findmnt -no FSTYPE /` and press Enter. It must print `ok`, a version string (about `4.0.2` on the minted disk), and `btrfs`.
  ** Right after boot the shell may take up to 60 seconds to answer `ok`; retry every 5 seconds until then.
  * Type `wpctl status | head -3` and press Enter. A PipeWire header must print, not "connection refused".
  * Type `systemctl --failed --no-legend --plain; systemctl --user --failed --no-legend --plain; echo UNITS-DONE` and press Enter. Nothing may be listed above `UNITS-DONE`.
  ** If a unit is listed, run `systemctl status <unit> | sudo tee /dev/ttyS0` (password `prime`) so the reason lands in the serial log.
  * Close the terminal with Super+W. The desktop must return exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the screen is black the idle screensaver (150s) has engaged: press Shift once and screenshot again.
  * ./client-with-image returns the screenshot with each action and saves a round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the desktop with bar and wallpaper
  ** Screenshot of the terminal showing `ok`, the version, `btrfs`, the PipeWire header, and `UNITS-DONE` with nothing listed above it
  ** Screenshot of the restored desktop
  * If unsuccessful
  ** Screenshot of the failing command; serial dump of `systemctl status` for any failed unit
covers: test/acceptance:44-65; test/acceptance.d/session-test.sh:8-13,48-75

### shell-plugins-loaded   [VM-OK]
description: The Omarchy shell has all thirteen core plugins loaded and rejects an unknown plugin id; a missing plugin is a silently broken bar widget, panel or overlay.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-shell shell listPlugins | jq -r '.[].id' | sort | sudo tee /dev/ttyS0` and press Enter, entering password `prime` if asked.
  * Read the list from the screen or from the serial log. It must include every one of: omarchy.audio, omarchy.background, omarchy.bar, omarchy.bluetooth, omarchy.clipboard, omarchy.emojis, omarchy.menu, omarchy.monitor, omarchy.network, omarchy.notifications, omarchy.power, omarchy.reminders, omarchy.weather.
  ** On the 4.0.2 disk the set may differ slightly; name any of the thirteen that is absent.
  * Type `omarchy-shell shell summon missing.plugin "{}"` and press Enter. It must print `unknown` and no overlay may open.
  * Close the terminal with Super+W. The desktop must return exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list is short enough to fit on screen; the serial copy is a fallback if the terminal font is hard to read.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot or serial text listing all thirteen plugin ids
  ** Screenshot showing `unknown` for the bogus plugin with no overlay opened
  * If unsuccessful
  ** Screenshot of the list with the missing id(s) called out
covers: test/acceptance.d/session-test.sh:16-24; test/shell.d/runtime-smoke-test.sh:364-373,412-415

### bar-toggle-hide-reveal   [VM-OK]
description: The top bar hides and comes back, both from its hotkey and from the command, without the shell restarting; a bar stranded off screen is a common shell regression.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot: the bar is visible along the top edge.
  * Press Super+Shift+Space (Toggle top bar). Within 15 seconds the bar must be gone and wallpaper must fill the top edge.
  ** The hidden bar is only parked off screen; a missing bar is the expected state here, not a crash.
  * Press Super+Shift+Space again. Within 15 seconds the bar must be back with the same widgets as before.
  * Open a terminal with Super+Enter, type `omarchy-toggle-bar on` and press Enter. The bar must disappear.
  ** `on` means "hidden on"; this is the command's wording, not a bug.
  * Type `omarchy-toggle-bar off` and press Enter. The bar must reappear.
  * Close the terminal with Super+W. The desktop must return exactly as it started, bar visible.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar normally moves instantly; the 15-second allowance is the acceptance suite's.
  * If the bar never returns, `omarchy-shell shell ping` in the terminal tells a dead shell from a stuck bar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots in order: bar visible, hidden, visible, hidden, visible
  * If unsuccessful
  ** Screenshot of the state where the bar failed to hide or return, plus the `ping` output
covers: test/acceptance.d/session-test.sh:30-45; default/hypr/bindings/utilities.lua:16; bin/omarchy-toggle-bar

### app-launch-terminal   [VM-OK]
description: The default terminal (foot) opens from its hotkey within 45 seconds, identifies itself as the default, and closes cleanly from its hotkey.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot: no windows are open.
  * Press Super+Enter. Within 45 seconds a terminal window with a shell prompt must appear.
  * Type `omarchy-default-terminal` and press Enter. It must print `foot`.
  * Press Super+W. Within 30 seconds the window must be gone.
  * Press Super+W again on the empty desktop. Nothing may appear or crash.
  * The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The acceptance suite matches the window class `^foot$`; visually it is a plain terminal with a prompt.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the foot window printing `foot`, and of the empty desktop afterwards
  * If unsuccessful
  ** Screenshot after 45 seconds with no window, or of a window that would not close
covers: test/acceptance.d/apps-test.sh:12-31,37; test/acceptance.d/system-test.sh:45-46

### app-launch-browser   [VM-OK]
description: Chromium, the default browser, opens a window from its hotkey within 45 seconds on a guest without 3D acceleration and closes cleanly; the terminal confirms it is the http handler.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Enter (Browser). Within 45 seconds a Chromium window must appear.
  ** Without GPU acceleration it renders slowly; screenshot every 5 seconds until the tab strip is visible.
  ** If a first-run or sign-in dialog appears, dismiss it with Escape or its close button and report that it appeared.
  * Take a screenshot of the browser window.
  * Press Super+W. Within 30 seconds the window must be gone.
  ** If a "Close all tabs?" prompt appears, confirm it with the mouse.
  * Open a terminal with Super+Enter, type `omarchy-default-browser; xdg-mime query default x-scheme-handler/http` and press Enter. It must print `chromium` then `chromium.desktop`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The acceptance suite matches the class `(?i)chromium`; look for the Chromium tab strip and address bar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Chromium window, of the desktop after closing, and of the terminal printing `chromium` and `chromium.desktop`
  * If unsuccessful
  ** Screenshot after 45 seconds with no window, or any error dialog
covers: test/acceptance.d/apps-test.sh:12-31,38; test/acceptance.d/system-test.sh:42-43,60

### app-launch-neovim   [VM-OK]
description: The default editor (Neovim in its own terminal window) opens from its hotkey and quits from inside, and Neovim also starts headlessly; a broken config breaks both.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N (Editor). Within 45 seconds a terminal window running Neovim (LazyVim dashboard or an empty buffer with a status line) must appear.
  ** First launch may install plugins; allow the full 45 seconds and report anything longer.
  * Take a screenshot.
  * Type `:qa!` and press Enter. Within 30 seconds the window must close.
  ** If it stays, press Super+W and report it.
  * Open a terminal with Super+Enter, type `nvim --headless '+qa' && echo NVIM-OK; omarchy-default-editor` and press Enter. It must print `NVIM-OK` then `nvim`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The acceptance suite matches the app id `org.omarchy.nvim`; visually it is a terminal whose whole content is Neovim.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Neovim running, and of the terminal printing `NVIM-OK` and `nvim`
  * If unsuccessful
  ** Screenshot of a Neovim error banner or of the headless run's output
covers: test/acceptance.d/apps-test.sh:12-31,39; test/acceptance.d/system-test.sh:48-49,102-103

### app-launch-omawrite   [VM-OK]
description: Omawrite, the bundled writer, opens from its hotkey within 45 seconds and closes cleanly; it is the acceptance suite's canary for a non-terminal GUI app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot: no Omawrite window is open.
  * Press Super+Shift+W (Omawrite). Within 45 seconds an Omawrite editor window must appear.
  ** If the hotkey does nothing, open a terminal with Super+Enter, type `omawrite &` and press Enter, and allow the same 45 seconds.
  * Take a screenshot of the window.
  * Press Super+W. Within 30 seconds the window must be gone.
  * If you opened a terminal, close it with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The acceptance suite matches the class `(?i)omawrite`; visually it is a distraction-free text editor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Omawrite window and of the desktop after it closed
  * If unsuccessful
  ** Screenshot after 45 seconds with no window; terminal output if launched by command
covers: test/acceptance.d/apps-test.sh:12-31,40

### apps-menu-search-launches-top-hit   [VM-OK]
description: The Apps menu does the launcher loop: open by hotkey, filter by typing, launch the top hit with Enter and close itself; a filter with no match launches nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space. Within 15 seconds the Apps menu overlay must appear with a search field and a list of applications.
  ** The overlay opens without animation; the first screenshot after the hotkey is final.
  * Type `omawrite`. The list must filter down to Omawrite as the top row.
  * Press Enter. Within 15 seconds the menu must close and within 60 seconds an Omawrite window must be open.
  * Press Super+W. Within 30 seconds Omawrite must be gone.
  * Press Super+Alt+Space again and type `zzqqxx`. The list must be empty or show a no-results state.
  * Press Escape. The menu must close and no application may have launched. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use the keyboard for the whole loop; the acceptance test does.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: Apps menu open, filtered to Omawrite, Omawrite window, desktop after close, empty result for the bogus filter, menu closed
  * If unsuccessful
  ** Screenshot of the menu state that did not launch, or still open after 15 seconds
covers: test/acceptance.d/shell-surfaces-test.sh:97-117; default/hypr/bindings/utilities.lua:2

### menu-root-walk-bar-position-left   [VM-OK]
description: The root menu is navigable by keyboard alone through Style → Menu Bar → Position, choosing Left moves the bar to a vertical strip and closes the menu, and the bar can be put back on top.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space. Within 15 seconds the root menu must appear with the row `Apps` visible.
  ** Row order: Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System. If it differs, stop and report the actual order.
  * Press Down three times so `Style` is highlighted, then Enter. Within 15 seconds the Style submenu must show `Theme` (rows: Theme, Background, Unlock, Font, Menu Bar, Hyprland, Screensaver, About).
  * Press Down four times so `Menu Bar` is highlighted, then Enter. The submenu must show `Position` and `Transparency`.
  * Press Enter on `Position`. The submenu must show Top, Bottom, Left, Right.
  * Press Down twice so `Left` is highlighted, then Enter. Within 20 seconds the bar must be a vertical strip on the left edge and within 15 seconds the menu must be closed.
  ** The vertical clock reads as `HH`, a dash, `mm` stacked.
  * Open a terminal with Super+Enter, type `jq .bar.position ~/.config/omarchy/shell.json; omarchy-bar position top` and press Enter. It must print `"left"`, and within 20 seconds the bar must be horizontal along the top again.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use the keyboard for the whole walk. Do not use the mouse.
  * Suspend/Hibernate-style conditional rows exist only in the System menu; the Style walk has fixed counts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each submenu (root with Apps, Style with Theme, Menu Bar, Position), the bar on the left with the menu closed, the terminal printing `"left"`, and the bar restored on top
  ** The keyboard was used for the whole walk
  * If unsuccessful
  ** Screenshot of the menu where navigation diverged, or of the bar that did not move or restore
covers: test/acceptance.d/menu-test.sh:65-103; default/omarchy/omarchy-menu.jsonc (root, style.*, style.bar.position.*)

### menu-system-escape-cancels   [VM-OK]
description: The System menu shows the power actions and Escape closes it without executing anything, even with Shutdown highlighted; this guards against an accidental shutdown from a stray key.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape. Within 15 seconds the System menu must appear with the row `Shutdown` visible (rows: Screensaver, Lock, Suspend, Logout, Reboot, Shutdown; Hibernate only when available).
  * Press Escape. Within 15 seconds the menu must be gone.
  * Screenshot again after 10 seconds: the desktop must still be running, no lock screen, no logout.
  * Press Super+Escape, then Down until `Shutdown` is highlighted, then Escape.
  ** Do NOT press Enter on Suspend, Logout, Reboot or Shutdown; the session would be lost.
  * The menu must close and the desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This is the same menu the `lock-screen` definition uses for its Lock row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the System menu with `Shutdown` visible, of Shutdown highlighted, and of the unchanged desktop after each Escape
  * If unsuccessful
  ** Screenshot of a menu that stayed open, or of a lock/black/login screen showing an action fired
covers: test/acceptance.d/shell-surfaces-test.sh:50-56; default/hypr/bindings/utilities.lua:8; default/omarchy/omarchy-menu.jsonc (system.*)

### panel-weather-san-francisco   [VM-OK] [NET]
description: The weather panel fetches a real forecast for a location the user sets and shows the location heading and detail captions; a blank panel means geolocation or the fetch broke.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, type `omarchy-weather-location --set "San Francisco" "37.7749,-122.4194"` and press Enter. It must not error.
  * Close the terminal with Super+W.
  * Press Super+Ctrl+Alt+W (Toggle weather). Within 15 seconds the weather panel must open under the bar.
  * Within 30 seconds the heading `SAN FRANCISCO` and the detail caption `WIND` must be visible.
  ** The captions are small; the acceptance suite has to OCR at 2x to read them. Look near the bottom of the panel.
  * Press Super+Ctrl+Alt+W again. Within 15 seconds the panel must be closed and the desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the panel stays blank for 30 seconds, open a terminal and run `curl -sI https://api.open-meteo.com | head -1` to separate a network failure from a shell failure.
  * The forecast download is a few KB.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the weather panel showing SAN FRANCISCO and WIND, and of the desktop after closing
  * If unsuccessful
  ** Screenshot of the blank or errored panel and the curl output
covers: test/acceptance.d/panels-test.sh:51-60; bin/omarchy-weather-location; bin/omarchy-notification-weather

### bar-panels-open-and-close   [VM-PARTIAL]
description: Each bar panel (Bluetooth, Network, Audio, Display) opens from its hotkey and closes on Escape, showing a graceful empty state where the guest lacks the hardware. Skipped: device lists, pairing, Wi-Fi scanning and volume changes (no Bluetooth, Wi-Fi or audio device).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+B. Within 15 seconds a panel with the heading `Bluetooth` must open under the bar in a no-adapter or disabled state. Press Escape; within 15 seconds it must close.
  ** A missing Bluetooth icon in the bar is acceptable; the hotkey must still open the panel.
  * Press Super+Ctrl+W. Within 15 seconds the Network panel must open showing a connected wired entry and no Wi-Fi list. Press Escape; it must close.
  * Press Super+Ctrl+A. Within 15 seconds the Audio panel must open in an empty or no-device state. Press Escape; it must close.
  * Press Super+Ctrl+D. Within 15 seconds the Display panel must open listing exactly one display. Press Escape; it must close.
  ** Only observe; do not change resolution or scale.
  * Press Super+Ctrl+B twice in quick succession. The panel must end closed, not stuck open.
  * The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All panels share one surface under the bar; only one is open at a time.
  * Clicking the matching icon in the bar's right section opens the same panel if a hotkey is unbound on the 4.0.2 disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Four screenshots of the open panels (Bluetooth empty, Network wired, Audio empty, Display with one entry) and the closed desktop after each Escape
  ** Screenshot of the closed state after the double toggle
  * If unsuccessful
  ** Screenshot of the panel that would not open or close; `omarchy-shell shell ping` output from a terminal
covers: test/acceptance.d/panels-test.sh:39-48,62-74; test/shell.d/runtime-smoke-test.sh:543-547

### panel-power-hidden-without-battery   [VM-PARTIAL]
description: On a machine without a battery the power widget disappears from the bar and its panel does not open, and the shell stays healthy; the acceptance suite treats this as the supported path. Skipped: the battery-present panel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot of the bar's right section: there must be no battery or power icon.
  * Press Super+Ctrl+P and screenshot within 5 seconds: no panel opens (or an empty one that closes on Escape). Nothing may crash.
  * Open a terminal with Super+Enter, type `upower -e | grep -c /battery_; omarchy-shell shell ping` and press Enter. It must print `0` then `ok`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a panel does open, press Escape and report what it showed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar without a power icon, of the desktop after Super+Ctrl+P, and of the terminal printing `0` and `ok`
  * If unsuccessful
  ** Screenshot of an unexpected power panel or of a shell that stopped answering
covers: test/acceptance.d/panels-test.sh:76-87

### panel-keyboard-tab-and-escape   [VM-OK]
description: Bar panels honour the keyboard contract: Tab moves to the next panel instead of closing, and Escape closes a panel even when it was reopened during its fade, rather than landing in the previously focused window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and leave it focused.
  * Press Super+Ctrl+B. Within 15 seconds the Bluetooth panel must be open.
  * Press Tab and screenshot after 2 seconds. A panel must still be open and it must be a different one (Network, the next to the right). Press Tab once more: the next panel (Audio) shows.
  ** The order follows the bar's right section; widgets without a panel (tray) are skipped, and power is absent here.
  * Press Escape. Within 15 seconds no panel may be open.
  * Press Super+Ctrl+B, then Super+Ctrl+B to close it, then immediately Super+Ctrl+B again. Within 15 seconds the panel must be open again.
  ** Send the three chords back to back to hit the "reopen during fade" timing.
  * Press Escape once. The panel must close, and the terminal must not have received the Escape (no stray `^[`). Type `echo focus-ok` and press Enter; it must print `focus-ok`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use the keyboard only; the point of the test is where keyboard focus lands.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: Bluetooth panel, a different panel after each Tab, none after Escape, the reopened panel, none after the single Escape, and the terminal printing `focus-ok`
  * If unsuccessful
  ** Screenshot of a panel closing on Tab, or still open after Escape (focus stayed in the terminal)
covers: test/acceptance.d/panels-test.sh:90-116

### emoji-picker-search-inserts-into-terminal   [VM-OK]
description: The emoji picker opens by hotkey, filters by search, inserts the chosen emoji into the previously focused window on Enter, and inserts nothing when cancelled with Escape.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and leave the cursor at the prompt.
  ** Insertion works by copying the emoji and typing Shift+Insert into the focused window, so the terminal must be focused before the picker opens.
  * Press Super+Ctrl+E. Within 15 seconds the emoji picker overlay must appear.
  * Type `rocket`. The list must filter to the rocket emoji.
  * Press Enter. Within 15 seconds the picker must close and 🚀 must appear at the terminal prompt.
  * Press Ctrl+U to clear the prompt, then Super+Ctrl+E, type `rocket`, and press Escape. The picker must close and the prompt must stay empty.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The overlay opens without animation; the screenshot right after the hotkey is final.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: picker filtered to rocket, terminal prompt showing 🚀, picker closed after Escape with an empty prompt
  * If unsuccessful
  ** Screenshot of the picker still open, or of the prompt without the emoji
covers: test/acceptance.d/shell-surfaces-test.sh:24-32; bin/omarchy-menu-emoji-insert; default/hypr/bindings/utilities.lua:3

### clipboard-history-search-and-copy   [VM-OK]
description: Clipboard history captures copies, the picker opens by hotkey, search finds an older entry, and Shift+Enter copies it back without pasting; a filter with no match shows nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `printf 'Omarchy acceptance clipboard 12345' | wl-copy; sleep 2; printf 'clipboard decoy' | wl-copy; grep -c 'Omarchy acceptance clipboard' ~/.local/state/omarchy/clipboard-history.json` and press Enter. The count must be 1 or more.
  ** History capture can lag a moment; rerun the grep if it prints 0.
  * Press Super+Ctrl+V. Within 15 seconds the clipboard overlay must open with `clipboard decoy` as the newest entry. Type `Omarchy acceptance`; within 15 seconds the row `Omarchy acceptance clipboard 12345` must be visible and highlighted.
  * Press Shift+Enter. Within 15 seconds the overlay must close and nothing may have been typed into the terminal.
  ** Plain Enter would paste the entry into the terminal; Shift+Enter copies only. Send it as `<S-ENTER>`.
  * Type `wl-paste --no-newline; echo` and press Enter. It must print `Omarchy acceptance clipboard 12345`, not the decoy.
  * Press Super+Ctrl+V, type `zzqqxx` (the list must be empty), then Escape. The overlay must close.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The overlay opens without animation.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: grep count of 1 or more, overlay filtered to the token, terminal printing the token after wl-paste, empty result for the bogus filter
  * If unsuccessful
  ** Screenshot of the overlay without the token, or wl-paste printing the decoy
covers: test/acceptance.d/shell-surfaces-test.sh:34-48; shell/plugins/clipboard/Clipboard.qml:388-392; default/hypr/bindings/clipboard.lua:48

### style-selectors-preview-and-cancel   [VM-OK]
description: The background and theme switchers render their image grids (thumbnail generation included) and Escape cancels both without changing the wallpaper or theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, type `omarchy-theme-current; omarchy-theme-bg-current` and press Enter. Note both names; neither may be `Unknown`. Close the terminal with Super+W.
  * Press Super+Ctrl+Space (Background switcher). Within 30 seconds an image grid of the current theme's backgrounds must appear with the current one marked.
  ** Thumbnails are generated on first open; allow the full 30 seconds.
  * Press Escape. Within 15 seconds the grid must close and the wallpaper must be unchanged.
  * Press Super+Shift+Ctrl+Space (Theme menu). Within 30 seconds an image grid of themes must appear.
  ** Do not press Enter in either grid; applying is a different test.
  * Press Escape. Within 15 seconds the grid must close and the desktop colours must be unchanged.
  * Open a terminal, run `omarchy-theme-current; omarchy-theme-bg-current` again. Both names must match the first run.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Both grids use the same overlay; the title tells them apart.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the background grid and the theme grid, the unchanged desktop after each Escape, and the two identical terminal outputs
  * If unsuccessful
  ** Screenshot after 30 seconds with no grid, or a changed wallpaper or theme
covers: test/acceptance.d/shell-surfaces-test.sh:58-72; test/acceptance.d/system-test.sh:51-55

### reminder-flow-cancel-and-invalid-minutes   [VM-OK]
description: Setting a reminder walks minutes → message; non-numeric minutes are refused with an "Invalid reminder" notification, and abandoning at the message prompt schedules nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+R (Set reminder). Within 15 seconds an overlay with the prompt `Remind in minutes` must appear.
  * Type `abc` and press Enter. Within 5 seconds a notification `Invalid reminder` / `Enter the number of minutes` must appear and the overlay must still show the minutes prompt.
  ** Pressing Enter on an empty field would simply dismiss the overlay; that is by design.
  * Press Backspace three times, type `5` and press Enter. Within 15 seconds the prompt must change to `Reminder message`.
  * Press Escape. Within 15 seconds the overlay must close.
  * Press Super+Shift+comma to dismiss the notification.
  * Open a terminal with Super+Enter, type `omarchy-reminder show` and press Enter. It must report no reminders.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the comma chord as `<M-S-,>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: minutes prompt, Invalid reminder notification with the minutes prompt still showing, `Reminder message` prompt, overlay closed, `omarchy-reminder show` with nothing scheduled
  * If unsuccessful
  ** Screenshot of the message prompt appearing for `abc`, of an overlay stuck on a prompt, or of a scheduled reminder
covers: test/acceptance.d/shell-surfaces-test.sh:74-86; shell/plugins/reminders (promptText, submit)

### notification-send-and-dismiss   [VM-OK]
description: A shell notification renders its headline and body and is cleared by the dismiss-all hotkey; the command without arguments prints usage and shows nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-notification-send "Acceptance notification" "Shell notification rendering" --expire-time=15000` and press Enter.
  * Within 15 seconds a popup must appear with headline `Acceptance notification` and body `Shell notification rendering`.
  ** It expires on its own after 15 seconds; screenshot promptly.
  * Press Super+Shift+comma (Dismiss all notifications). Within 15 seconds the popup must be gone.
  * Type `omarchy-notification-send` with no arguments and press Enter. It must print a usage line and no popup may appear.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the comma chord as `<M-S-,>`; `Super+comma` (`<M-,>`) dismisses only the last one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the popup with both texts, of the desktop after dismiss-all, and of the usage line with no popup
  * If unsuccessful
  ** Screenshot with no popup after 15 seconds, or a popup that survived dismissal
covers: test/acceptance.d/shell-surfaces-test.sh:88-95; bin/omarchy-notification-send; default/hypr/bindings/utilities.lua:25-26

### system-default-apps-and-mime   [VM-OK]
description: The stock defaults are wired: Chromium browser and http handler, foot terminal, Neovim editor, Nautilus for folders, and a configured theme, background and font.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-default-browser; omarchy-default-terminal; omarchy-default-editor` and press Enter. It must print `chromium`, `foot`, `nvim`.
  * Type `xdg-mime query default x-scheme-handler/http; xdg-mime query default inode/directory` and press Enter. It must print `chromium.desktop` then `org.gnome.Nautilus.desktop`.
  * Type `omarchy-theme-current; omarchy-theme-bg-current; omarchy-font-current` and press Enter. None may print `Unknown` or an empty line.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output fits on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with exactly `chromium`, `foot`, `nvim`, `chromium.desktop`, `org.gnome.Nautilus.desktop`, and three non-Unknown values
  * If unsuccessful
  ** Screenshot of the deviating line
covers: test/acceptance.d/system-test.sh:41-63

### system-services-enabled-and-running   [VM-OK]
description: The services the desktop relies on are enabled and active: NetworkManager, resolved, ufw, sddm, avahi, power-profiles-daemon, docker.socket, and the user's PipeWire trio.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `systemctl is-enabled avahi-daemon.service docker.socket NetworkManager.service power-profiles-daemon.service sddm.service systemd-resolved.service ufw.service` and press Enter. Every line must be `enabled`.
  ** `disabled` or `not-found` on any line is a failure.
  * Type `systemctl is-active NetworkManager.service systemd-resolved.service ufw.service` and press Enter. Every line must be `active`.
  * Type `systemctl --user is-active pipewire.service pipewire-pulse.service wireplumber.service` and press Enter. Every line must be `active`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Output is short; no serial redirection needed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing seven `enabled`, three `active`, three user `active`
  * If unsuccessful
  ** Screenshot of the offending line plus `systemctl status <unit>` output
covers: test/acceptance.d/system-test.sh:65-84

### system-core-packages-installed   [VM-OK]
description: Every package in the shipped core manifest is installed, and the audit visibly catches a missing one; a gap here means an install step failed silently.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `ls -l /usr/share/omarchy/install/omarchy-base.packages` and press Enter. The file must exist.
  ** If it does not exist on the 4.0.2 disk, run `ls /usr/share/omarchy/install/` and report the contents.
  * Type `grep -Ev '^\s*(#|$)' /usr/share/omarchy/install/omarchy-base.packages | while read -r p; do pacman -Q "$p" >/dev/null 2>&1 || echo "MISSING $p"; done | sudo tee /dev/ttyS0; echo AUDIT-DONE` and press Enter, entering password `prime` if asked.
  ** The loop can take up to a minute on 2 vCPUs; screenshot every 5 seconds until `AUDIT-DONE`.
  * There must be no `MISSING` lines on screen or in the serial log.
  * Type `pacman -Q not-a-real-package; echo rc=$?` and press Enter. It must print `was not found` and `rc=1`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The `sudo tee` copy exists so a long MISSING list can be read with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `AUDIT-DONE` with no `MISSING` lines (serial log empty of MISSING), and the not-found error for the fake package
  * If unsuccessful
  ** Screenshot or serial listing the MISSING packages
covers: test/acceptance.d/system-test.sh:8-25

### system-kernel-headers-match   [VM-OK]
description: The guest boots the supported linux-omarchy kernel and the matching headers are installed, which DKMS modules depend on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `uname -r; cat /usr/lib/modules/$(uname -r)/pkgbase` and press Enter. The second line must be `linux-omarchy`.
  ** `linux-t2` is for Apple hardware only; report it if it appears.
  * Type `pacman -Q linux-omarchy-headers` and press Enter. It must print the package and version.
  * Type `cat /usr/lib/modules/$(uname -r)/build/include/config/kernel.release` and press Enter. It must print exactly the `uname -r` string.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All four outputs fit on one screen; compare the release strings character by character.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with `linux-omarchy`, the headers package line, and identical release strings
  * If unsuccessful
  ** Screenshot of the mismatch or "No such file"
covers: test/acceptance.d/system-test.sh:27-39

### system-terminal-tools-runnable   [VM-OK]
description: The bundled terminal toolchain (git, tmux, mise, fastfetch, headless Neovim) runs, and a bad subcommand fails cleanly; these are what a developer touches in the first minute.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `git --version; tmux -V; mise --version` and press Enter. Three version lines must print.
  * Type `timeout 10 fastfetch --pipe false | head -20` and press Enter. System information (OS, kernel, shell) must print.
  * Type `nvim --headless '+qa' && echo NVIM-OK` and press Enter. It must print `NVIM-OK`.
  * Type `mise not-a-command; echo rc=$?` and press Enter. It must print an error and a non-zero rc.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fastfetch prints colour blocks; only the text lines matter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with three version lines, fastfetch output, `NVIM-OK`, and the mise error with non-zero rc
  * If unsuccessful
  ** Screenshot of the command that failed
covers: test/acceptance.d/system-test.sh:102-111

### system-user-dirs-and-state   [VM-OK]
description: The user's XDG directories exist and Omarchy's per-user state (current theme and background links, valid shell.json) is present after install.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `for d in DESKTOP DOCUMENTS DOWNLOAD PICTURES; do p=$(xdg-user-dir $d); [ -d "$p" ] && echo "OK $d $p" || echo "MISSING $d $p"; done` and press Enter. Four `OK` lines must print.
  * Type `ls -l ~/.local/state/omarchy/current/theme ~/.local/state/omarchy/current/background` and press Enter. Both must exist as symlinks into the themes tree.
  * Type `test -s ~/.config/omarchy/shell.json && jq empty ~/.config/omarchy/shell.json && echo JSON-OK` and press Enter. It must print `JSON-OK`.
  ** On the 4.0.2 disk this file may not exist until first customisation; if absent, report it and run the same check on `/usr/share/omarchy/config/omarchy/shell.json`.
  * Type `echo '{bad' | jq empty; echo rc=$?` and press Enter. jq must report a parse error and a non-zero rc.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The last step proves the JSON check is real, not that anything is broken.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with four `OK`, two symlink lines, `JSON-OK`, and the jq parse error
  * If unsuccessful
  ** Screenshot of any MISSING line or of jq failing on shell.json
covers: test/acceptance.d/system-test.sh:114-127

### docker-unreachable-without-elevation   [VM-OK]
description: Docker is installed with its socket enabled, but the desktop user is not in the docker group and cannot reach the daemon without sudo, while sudo does reach it; the docker group is root-equivalent.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `command -v docker; id -nG` and press Enter. The docker path must print and the group list must not contain `docker`.
  * Type `timeout 10 docker info 2>&1 | head -3; echo rc=${PIPESTATUS[0]}` and press Enter. It must show a permission-denied or cannot-connect error and a non-zero rc.
  * Type `sudo docker info 2>&1 | head -3` and press Enter; enter password `prime`. It must print client/server info.
  ** The socket activates the daemon on first use; allow a few seconds.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The password prompt is on the terminal; type `prime` and Enter when it appears.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing no `docker` group, the permission error with non-zero rc, and the sudo run printing server info
  * If unsuccessful
  ** Screenshot showing unelevated `docker info` succeeding, or the user in the docker group
covers: test/acceptance.d/system-test.sh:86-100

### security-user-not-in-input-group   [VM-OK]
description: The desktop user is not in the `input` group (which would let any process read raw keystrokes) because no opt-in controller or ydotool feature is installed, and raw input devices are indeed unreadable.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `id -nG | tr ' ' '\n' | grep -x input; echo rc=$?` and press Enter. Nothing may be listed and rc must be `1`.
  ** If `input` is listed, membership is acceptable only if the next step shows xpadneo-dkms or ydotool installed.
  * Type `pacman -Q xpadneo-dkms ydotool 2>&1` and press Enter. Both must report `was not found`.
  * Type `head -c1 /dev/input/event0; echo " rc=$?"` and press Enter. It must print `Permission denied` and a non-zero rc.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `/dev/input/event0` does not exist, use any `/dev/input/event*` that `ls /dev/input` lists.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing rc=1 for the group grep, both packages not found, and Permission denied on the input device
  * If unsuccessful
  ** Screenshot showing `input` in the group list without a justifying package
covers: test/acceptance.d/security-test.sh:17-30,104

### security-no-asdcontrol-sudoers   [VM-OK]
description: No shipped sudoers drop-in grants passwordless root (the old asdcontrol grant is gone), and sudo really does demand a password once its cache is cleared.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `sudo test -e /etc/sudoers.d/omarchy-asdcontrol; echo rc=$?` and press Enter; enter password `prime` when prompted. rc must be `1`.
  * Type `sudo ls /etc/sudoers.d/` and press Enter. No `omarchy-asdcontrol` entry may be listed.
  * Type `sudo -k; sudo -n true 2>&1; echo rc=$?` and press Enter. It must print a password-required error and `rc=1`.
  ** `sudo -k` clears the cached credential so this check is meaningful.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The sudo prompt appears inline in the terminal; type `prime` and Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing rc=1 for the test, the sudoers.d listing without the file, and the password-required error after `sudo -k`
  * If unsuccessful
  ** Screenshot showing the file exists, or `sudo -n true` succeeding after `sudo -k`
covers: test/acceptance.d/security-test.sh:45-52,104-108

### security-sshd-hardening   [VM-OK]
description: `omarchy-setup-security-sshd --key` enables sshd, authorizes the key, disables password logins and rate-limits port 22, so that key login to localhost works and a password-only attempt is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Type `ssh-keygen -t ed25519 -N "" -q -f /tmp/acc-key && sudo -v && echo KEY-OK` and press Enter; enter password `prime`. It must print `KEY-OK`.
  ** Validating sudo first mirrors how the acceptance suite runs the setup unattended.
  * Type `omarchy-setup-security-sshd --key="$(cat /tmp/acc-key.pub)"; echo rc=$?` and press Enter, answering any sudo prompt with `prime`. It must end with `rc=0` and no error text.
  ** Allow up to 3 minutes; screenshot every 5 seconds. If it installs openssh it uses the network (small download).
  * Type `systemctl is-active sshd.service; grep -c -xF "$(cat /tmp/acc-key.pub)" ~/.ssh/authorized_keys` and press Enter. It must print `active` then `1`.
  * Type `sudo sshd -T | grep -iE '^(passwordauthentication|kbdinteractiveauthentication) '; sudo ufw status | grep -E '^22/tcp\s+LIMIT'` and press Enter. It must print both keywords with `no` and a `22/tcp  LIMIT` line.
  ** OpenSSH 10.x prints the keywords in CamelCase; the values are what matter.
  * Type `ssh -i /tmp/acc-key -o StrictHostKeyChecking=no -o BatchMode=yes prime@localhost 'echo SSH-KEY-OK'` and press Enter. It must print `SSH-KEY-OK`.
  * Type `ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no -o ConnectTimeout=5 prime@localhost true 2>&1; echo rc=$?` and press Enter. It must print `Permission denied (publickey)` and a non-zero rc with no password prompt.
  ** If a password prompt appears, press Ctrl+C and report it; do not type the password.
  * Close the terminal with Super+W. The desktop must look as at the start; the machine now has sshd enabled and a firewall rule, so this disk must not be saved.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The acceptance suite leaves the hardening in place on purpose; discard the disk when the session ends rather than trying to undo it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: `KEY-OK`, `rc=0` from the setup, `active` and `1`, both `no` lines with the `22/tcp LIMIT` line, `SSH-KEY-OK`, and `Permission denied (publickey)` with no password prompt
  * If unsuccessful
  ** Screenshot of the setup command's error output, of a password prompt, or of `journalctl -u sshd | tail | sudo tee /dev/ttyS0` read via the serial log
covers: test/acceptance.d/security-test.sh:54-115; bin/omarchy-setup-security-sshd

### cups-running-denies-unauthenticated-admin   [VM-OK]
description: CUPS is enabled, running and answering, its authorization policy file is root:cups 640, and an unauthenticated desktop user is explicitly Forbidden from administering it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `systemctl is-enabled cups.service; systemctl is-active cups.service; timeout 10 lpstat -r` and press Enter. It must print `enabled`, `active`, `scheduler is running`.
  * Type `stat -c '%U:%G %a' /etc/cups/cups-files.conf; head -1 /etc/cups/cups-files.conf` and press Enter. It must print `root:cups 640` then `Permission denied`.
  * Type `LC_ALL=C timeout 10 lpinfo -v </dev/null; echo rc=$?` and press Enter. It must print a line containing `Forbidden` and a non-zero rc.
  ** Do not use sudo here; the unprivileged result is the point.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output fits on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with `enabled`, `active`, `scheduler is running`, `root:cups 640`, Permission denied on the policy file, and `lpinfo: Forbidden` with non-zero rc
  * If unsuccessful
  ** Screenshot of `lpinfo -v` listing devices (admin allowed) or a different owner/mode
covers: test/acceptance.d/cups-test.sh:36-51

### cups-browsed-and-cups-pdf-absent   [VM-OK]
description: Printing packages are installed, but automatic printer discovery (cups-browsed) and the root CUPS-PDF backend are not installed, not enabled, not running and left no files behind; both were removed for security.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `pacman -Q cups cups-filters system-config-printer cups-pk-helper` and press Enter. Four package lines must print.
  * Type `pacman -Q cups-browsed cups-pdf 2>&1` and press Enter. Both must print `was not found`.
  * Type `systemctl is-enabled cups-browsed.service 2>&1; systemctl is-active cups-browsed.service; pgrep -x cups-browsed; echo pgrep-rc=$?` and press Enter. Expect `not-found` or `disabled`, `inactive`, no pid, `pgrep-rc=1`.
  * Type `for p in /etc/cups/cups-browsed.conf /etc/cups/cups-browsed.conf.pacsave /etc/cups/cups-browsed.conf.pacnew /usr/bin/cups-browsed /usr/lib/cups/backend/implicitclass /usr/lib/systemd/system/cups-browsed.service /etc/systemd/system/multi-user.target.wants/cups-browsed.service; do [ -e "$p" ] || [ -L "$p" ] && echo "EXISTS $p"; done; echo PATHS-DONE` and press Enter. No `EXISTS` line may print before `PATHS-DONE`.
  ** The loop wraps onto two terminal lines; type it carefully.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output fits on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing four installed packages, two `was not found`, cups-browsed inactive with pgrep-rc=1, and `PATHS-DONE` with no EXISTS lines
  * If unsuccessful
  ** Screenshot of any EXISTS line or of cups-browsed active
covers: test/acceptance.d/cups-test.sh:7-34

### capture-screenshot-fullscreen-save   [VM-OK]
description: `omarchy capture screenshot fullscreen save` writes a non-blank PNG to the Pictures directory and prints its path, and the Print key's region picker can be cancelled without writing a file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy capture screenshot fullscreen save` and press Enter. The last line must be a path ending in `.png` under the Pictures directory.
  * Type `ls -l "$(ls -t ~/Pictures/*.png | head -1)"; file "$(ls -t ~/Pictures/*.png | head -1)"` and press Enter. The file must be larger than 10 KB and `file` must print `PNG image data` with the screen's width and height.
  ** If the printed path was not under `~/Pictures`, use that path instead.
  * Type `xdg-open "$(ls -t ~/Pictures/*.png | head -1)" &` and press Enter. An image viewer must show the captured desktop with the bar rendered along the top. Press Super+W to close the viewer.
  * Press Print. A region-selection overlay must appear; press Escape. No new file may appear in `ls -t ~/Pictures | head -2` and no error may show.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The viewer opens as a new window; make sure it, not the terminal, is focused before Super+W.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the printed path, the `ls -l` size and `PNG image data …`, the viewer showing a rendered bar, and the cancelled selection overlay with no new file
  * If unsuccessful
  ** Screenshot of the command error, or of a viewer showing a black image
covers: test/shell.d/screenshot-sanity-test.sh:121-244; agents/skills/visual-verification.md:13-19; default/hypr/bindings/utilities.lua:38

### cli-help-never-executes   [VM-OK]
description: The `omarchy` CLI renders help for the root, a group and a command, a trailing `--help` never runs the target (an `update --help` that started an update was a real bug), and an unknown group fails cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy --help | head -5; omarchy theme --help | head -3` and press Enter. It must print `Omarchy command center` and `Theme commands`.
  * Type `omarchy update --help` and press Enter. Help naming `omarchy-update` must print and return at once; no sudo prompt, no download, no update output.
  ** If a sudo prompt or progress bar appears, press Ctrl+C immediately and report it.
  * Type `omarchy theme set --help | grep -i binary; omarchy theme list | head -5` and press Enter. A `Binary:` line with `omarchy-theme-set` and a list of theme names must print.
  * Type `omarchy nosuchgroup 2>&1 | head -3; echo rc=${PIPESTATUS[0]}` and press Enter. It must print an error or usage and a non-zero rc.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output fits on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with `Omarchy command center`, `Theme commands`, update help without execution, the `Binary:` line, theme names, and the unknown-group error
  * If unsuccessful
  ** Screenshot of an update actually starting or of missing help text
covers: test/cli:54-56,111-112,185-195,236-239

## Gaps

- **Layer geometry proofs** (`layer_present` while `layer_off_screen`, `omarchy-keyboard-panel-dismiss` absent on single monitor,
  `layer_on_screen` maths in `acceptance-helpers-test.sh`): a screenshot cannot distinguish "unmapped" from "mapped but parked off
  screen", nor see a layer that must not exist. Our tests assert only the visible consequence (bar gone / bar back / Escape works).
- **Shell IPC contracts** in `runtime-smoke-test.sh` (plugin metadata shape, hot-reload of `~/.config/omarchy/plugins`, `keepLoaded`
  service survival across `rescanPlugins`, `lock status .lastEvent`, replacement-bar capability boundaries, per-screen IPC handler
  registration): these need fixture plugins written into `$HOME` and JSON comparison; a driver could type the IPC calls but cannot create
  the fixtures without file transfer. A partial substitute is `omarchy-plugin-disable omarchy.audio` (audio icon disappears from the bar)
  and `omarchy-plugin-enable` to restore, which was not proposed because it edits stock config without a strong user-facing story.
- **`omarchy-bar put`** placement semantics (`runtime-smoke-test.sh:598-630`): the stock layout already contains
  `omarchy.keyboard-layout`, so the "place a missing widget" branch cannot be reached without first editing `shell.json`.
- **Apps-test on a 2-vCPU, no-GL guest**: Chromium's 45s launch budget may be tight; the proposed test keeps 45s and asks the driver to
  report the actual time rather than fail early.
- **`OMARCHY_ACCEPTANCE_IGNORE_UNITS`**: the suite tolerates a regex of known-failed units on dev machines. A fresh VM should be clean,
  but if the 4.0.2 minted disk has a known failed unit the `session-desktop-health` test will report it; that is desired.
- **The headless suites** (`test/cli`, `test/shell`, `test/all`) test the checkout, not the installed product, and need `node`, `python3`
  with the `kitty` module, `quickshell` fixtures, etc. Running them in-guest would require cloning the repo (NET, SLOW) and would not
  exercise the 4.0.2 install. Not proposed.
- **Fixtures** (`network-captive-portal`, `lock-fingerprint-indicator`, `tray-menu-activation`, `plugin-auth-boundary`,
  `privileged-heredoc/*`): pure unit inputs (mock Network singleton, fake SNI tray item, heredoc lint cases). The behaviours they model
  (captive-portal banner, fingerprint indicator on the lock screen, tray menu activation) need hardware or a fake D-Bus service the driver
  cannot provide. Only the fingerprint *absence* on the lock screen is observable and belongs to the lock-screen reviewer.
- **sshd hardening restore**: the acceptance suite leaves the hardening in place by design; on our side `security-sshd-hardening`
  leaves sshd enabled and a ufw rule behind, so its disk must be discarded, not saved, and it cannot share a disk with tests that follow.
- **HEAD vs 4.0.2 drift**: the acceptance suite targets HEAD (quattro Lua Hyprland config, `hl.dsp.*`, `omarchy-shell shell togglePanelAt`,
  Lua bindings). The minted disk is 4.0.2. Every hotkey used above exists in both lines as far as this tree shows, but menu row order,
  the `Unlock` Style row, and `omarchy-base.packages` contents may differ; instructions ask the driver to report divergence rather than
  assume.
