# 22 — Omarchy Menu, launchers, web apps, desktop entries, app rules

Reviewer notes for the menu/launch/webapp area of omarchy @ HEAD 2026-09-18. Format per `00-FORMAT.md`.

## Scope

Read completely (line counts from `wc -l`):

| file | lines | notes |
|---|---|---|
| `default/omarchy/omarchy-menu.jsonc` | 380 | 340 entries (282 actions, 2 providers, 75 `when`, 65 `disabled`, 44 `checked`) |
| `docs/menu.md` | 167 | schema, guards, providers, CLI, select/input modes |
| `default/omarchy/launcher.hides` | 39 | desktop ids hidden from the app launcher |
| `bin/omarchy-menu` | 52 | CLI wrapper: toggle/summon/close/refresh/ping |
| `bin/omarchy-menu-keybindings` | 669 | Hyprland binds viewer + dispatcher, cache |
| `bin/omarchy-menu-images` | 370 | image grid picker + thumbnail cache |
| `bin/omarchy-menu-select` / `-input` / `-file` | 99 / 58 / 48 | dmenu-style select / text input / file picker |
| `bin/omarchy-menu-clipboard` / `-emoji` / `-emoji-insert` | 6 / 6 / 20 | shell plugin toggles, wtype paste |
| `bin/omarchy-menu-plugin` / `-share` / `-timezone` | 46 / 50 / 12 | plugin picker, LocalSend share, timezone |
| `bin/omarchy-menu-tmux-keybindings` / `-herdr-keybindings` | 137 / 231 | tmux / herdr viewers |
| `bin/omarchy-launch-*` (24 scripts) | 941 total | about 364, openclaw 91, shell 91, screensaver 73, battlenet 48, browser 34, editor 34, docker-tui 20, or-focus 19, … |
| `bin/omarchy-webapp-install` / `-remove` / `-remove-all` / `-handler-hey` / `-handler-zoom` | 241 / 61 / 37 / 15 / 23 | |
| `bin/omarchy-games-retro-cores` / `-install` | 39 / 72 | |
| `bin/omarchy-chromium-copy-url-host` / `-ytdlp-host` | 50 / 196 | native-messaging hosts |
| `bin/omarchy-agent` / `-crash` / `-prompt` / `-usage-update` | 145 / 52 / 23 / 68 | |
| `bin/omarchy-agent-usage-claude` / `-codex` / `-fireworks` | 905 / 603 / 511 | **skimmed** for user-visible strings only (hidden collectors; `AUTH_HELP` text, `--force`, `--limits-only`) as instructed |
| `applications/*.desktop` (17) + `applications/icons/` (18 png) | | |
| `default/applications/battlenet.desktop`, `default/applications/mimeapps.list` | 11 / 49 | |
| `default/hypr/apps.lua` + `default/hypr/apps/*.lua` (21 files) | 278 total | window rules |
| `default/hypr/bindings/applications.lua`, `utilities.lua` | 34 / 127 | the launch chords the app rules pair with (read because the task asks for "launch chords"; other bindings files only grepped) |

Also read for context (not in scope but needed to describe screen state): `shell/plugins/menu/Menu.qml` key handling (lines 286–450, 580–860, 1110–1270), `shell/plugins/menu/BarWidget.qml`, `shell/services/AppLibrary.qml` (hides FileView), `config/omarchy/shell.json` (bar layout), `bin/omarchy-remove-launcher-entry`, `bin/omarchy-default-{agent,browser,terminal,editor}`, `bin/omarchy-show-done`, `bin/omarchy-refresh-applications`, `bin/omarchy-tui-remove`, `bin/omarchy-remove-preinstalls`, `install/user/mise.sh`, `install/user/first-run/setup-agent.hook`, guard helpers `omarchy-hw-laptop`, `omarchy-hibernation-available`, `omarchy-hw-webcam`, `omarchy-hw-fingerprint`, `omarchy-hw-touchpad`, `omarchy-hw-touchscreen`, `omarchy-hw-hybrid-gpu`, `omarchy-network-status`, `omarchy-theme-extras`, `omarchy-toggle-enabled`, `omarchy-sudo-docker`.

Skimmed tests: `test/shell.d/menu-test.sh`, `menu-guards-test.sh`, `keybindings-menu-test.sh`, `launch-about-test.sh`, `launch-browser-test.sh`, `launch-1password-test.sh`, `launch-openclaw-test.sh`, `launch-shell-test.sh`, `shell-launch-test.sh`, `launcher-remove-test.sh`, `webapp-install-test.sh`, `webapp-install-escaping-test.sh`, `webapp-name-test.sh`, `app-search-test.sh`, `desktop-entry-launch-test.sh`, `default-apps-test.sh`, `agents-panel-test.sh`, `agent-invitation-test.sh`, `menu-images-test.sh`, `menu-plugin-test.sh`, `tray-menu-test.sh`.

Skipped: internals of the three Python usage collectors (parsing of transcripts / OAuth), `shell/plugins/menu/MenuModel.js` line-by-line (behaviour taken from `docs/menu.md` + `menu-test.sh`).

## Inventory

#### Ways to reach the menu (entry points)

- `Super+Space` → root menu (`omarchy-menu toggle`) — `default/hypr/bindings/utilities.lua:1`
- `Super+Alt+Space` → Apps submenu (`omarchy-menu toggle apps`) — `utilities.lua:2`
- `Super+Escape` → System submenu (`omarchy-menu toggle system`) — `utilities.lua:8`; `XF86PowerOff` same, works while locked — `utilities.lua:9`
- `Super+Shift+code:201` (Copilot key) → root — `utilities.lua:7` (hidden from keybindings viewer, `omarchy-menu-keybindings:310`)
- `Super+Ctrl+C` → Capture, `Super+Ctrl+O` → Toggle, `Super+Ctrl+H` → Hardware, `Super+Ctrl+S` → Share, `Super+Ctrl+R` → Reminder → Set one (alias `reminder-set` resolves to an action, runs `omarchy-reminder -i` directly), `Super+Ctrl+Space` → Background (alias → runs the switcher action), `Super+Shift+Ctrl+Space` → Theme (alias → runs the theme switcher) — `utilities.lua:4-6,17-18,85,89`
- `Alt+Print` → stop recording or open Capture → Screenrecord — `utilities.lua:39`
- Bar: leftmost widget `omarchy.menu` (glyph `\ue900` Omarchy logo, `config/omarchy/shell.json` layout.left[0]) — left click toggles root menu, **right click opens a terminal** (`xdg-terminal-exec`) — `shell/plugins/menu/BarWidget.qml:20-21`
- Agents bar widget right-click → `omarchy-agent --pick` → summons `setup.default.agent` — `agents-panel-test.sh`, `bin/omarchy-agent:44`
- First-run notification "Set your default agent" (critical, glyph 󰚩) with click action `omarchy menu summon setup.default.agent`, once only — `install/user/first-run/setup-agent.hook`
- CLI: `omarchy menu [toggle|summon|close|refresh|ping] [route]`, `omarchy menu --help`, unknown verb → `omarchy-menu: unknown verb '<v>'. Try 'omarchy menu --help'.` exit 2 — `bin/omarchy-menu`
- Routes: item id or alias, case-insensitive, `_`→`-`; `""`/`go`/`menu` → root; unknown literal → falls through; if the id does not exist the shell opens root (`Menu.qml:731`). Aliases declared: `app applications` (apps), `settings` (setup), `uninstall` (remove), `restart refresh` (update), `power-menu` (system), `emoji emojis`, `reminder`, `capture screenshot screenrecord screen-record screenrecording`, `share`, `toggle toggles`, `hardware hw`, `reminder-set remind`, `theme themes`, `background wallpaper`, `unlock`, `network`, `dns`, `wifi-qr`, `default defaults`, `plugin plugins`.

#### Menu UI behaviour (Menu.qml keyCatcher, lines 1122-1165)

- Header shows `Go…` at root, `<title or label>…` in a submenu (e.g. `Setup…`, `Default Browser…`, `Remove…` for `remove.ai`), or the typed filter text. Submenu rows end with `›`. Rows with `checked` succeeded show ` ✓`; `disabled` rows dim, show ` ✓`, are skipped by cursor/pointer/Enter and omitted from search.
- Typing (printable chars, Shift ok) filters. Search runs over all descendants of the current submenu; rows in deeper submenus are listed after a hairline divider with their parent path (`Style › Font`) as subtitle. Search at root loads every provider first (apps included) so apps are found from root.
- `Escape`: clears filter if any, otherwise closes. `Backspace`/`Left` with empty filter: go back (nav stack, else parent). `Enter`/`Right`: activate. `Up`/`Down`, `PgUp`/`PgDn` (±6). `Delete` on an app row: "Do you want to uninstall <name>?" confirm with `Uninstall` button (`omarchy-remove-launcher-entry`).
- Empty list text: `No matches for “<text>”` when filtering, `Nothing here yet` otherwise.
- Apps submenu sorted alphabetically regardless of provider order. App rows searchable by desktop `Keywords` but never routable (`omarchy menu summon system` must open System, not an app).
- Select/input modes (`omarchy-menu-select`, `omarchy-menu-input`): header shows `<prompt>…`; Escape/cancel → exit 1, nothing printed. Select option forms `label`, `glyph\tlabel`, `glyph\tlabel\tsubtext` (subtext returned as `label\tsubtext`). `--width N`, `--height/--maxheight N` after `--`.

#### Menu entries (all 340; `→` path, `=` what it runs, `[when]` hides, `[disabled]` dims, `[checked]` ✓). Source `default/omarchy/omarchy-menu.jsonc`, line in parentheses.

Root (24-33):
- `Omarchy Menu → Apps` = provider `apps` (AppLibrary desktop entries) (24)
- `Omarchy Menu → Learn` submenu (25) · `→ Trigger` (26) · `→ Style` (27) · `→ Setup` (28) · `→ Install` (29) · `→ Remove` (30) · `→ Update` (31)
- `Omarchy Menu → About` = `omarchy-launch-about` (32)
- `Omarchy Menu → System` submenu (33)

System (36-42):
- `System → Screensaver` = `omarchy-launch-screensaver force` (36)
- `System → Lock` = `omarchy-system-lock` (37)
- `System → Suspend` = `systemctl suspend` [when `! omarchy-toggle-enabled suspend-off`] (38)
- `System → Hibernate` = `systemctl hibernate` [when `omarchy-hibernation-available`: swap > image_size and `/etc/mkinitcpio.conf.d/omarchy_resume.conf`] (39)
- `System → Logout` = `omarchy-system-logout` (40) · `→ Reboot` = `omarchy-system-reboot` (41) · `→ Shutdown` = `omarchy-system-shutdown` (42)

Learn (45-53):
- `Learn → Keybindings` = `omarchy-menu-keybindings` (45)
- `Learn → Omarchy` = webapp `https://omarchy.org/manual/` (46) · `→ Hyprland` = webapp `https://wiki.hypr.land/` (47) · `→ Arch` = webapp Arch wiki (48) · `→ Neovim` = webapp `https://www.lazyvim.org/keymaps` (49) · `→ Bash` = webapp `https://devhints.io/bash` (50)
- `Learn → Tmux` = `omarchy-menu-tmux-keybindings` (51) · `→ Herdr` = `omarchy-menu-herdr-keybindings` (52)
- `Learn → Community` = `omarchy-launch-discord-community` (53)

Trigger (56-101):
- `Trigger → Emoji` = `omarchy-menu-emoji` (56)
- `Trigger → Reminder` submenu (57): `→ Set one` = `omarchy-reminder -i` (83) · `→ Show all` = `omarchy-reminder show` (84) · `→ Clear all` = `omarchy-reminder clear` (85)
- `Trigger → Capture` submenu (58): `→ Screenshot` = `omarchy-capture-screenshot` (59) · `→ Stop Screenrecording` = `omarchy-capture-screenrecording --stop-recording` [when `pgrep -f '^gpu-screen-recorder'`] (60) · `→ Screenrecord` submenu (61): `→ With no audio` (65) · `→ With desktop audio` (66) · `→ With desktop + microphone audio` (67) · `→ With desktop + microphone audio + webcam` [when `omarchy-hw-webcam`] (68) · `Capture → Text` = `omarchy-capture-text` (62) · `→ QR Code` = `omarchy-capture-qr` (63) · `→ Color` = `pkill hyprpicker || hyprpicker -a` (64)
- `Trigger → Transcode` = `omarchy-transcode` (69)
- `Trigger → Share` submenu (70): `→ Clipboard` = `omarchy-menu-share clipboard` (86) · `→ File` = `omarchy-menu-share file` (87) · `→ Folder` = `omarchy-menu-share folder` (88) · `→ Receive` = `uwsm-app -- localsend` (89)
- `Trigger → Toggle` submenu (71): `→ Stay Awake` = `omarchy-toggle-idle` (90) · `→ Notifications` = `omarchy-toggle-notification-silencing` (91) · `→ Crash Capture` = `omarchy-toggle-crash-capture` (92) · `→ Screensaver` = `omarchy-toggle-screensaver` (93) · `→ Nightlight` = `omarchy-toggle-nightlight` (94) · `→ Menu Bar` = `omarchy-toggle-bar` (95) · `→ Battery Percentage` = `omarchy-shell omarchy.power togglePercentage` [when `omarchy-hw-laptop`] (96) · `→ Workspace Layout` = `omarchy-hyprland-workspace-layout-toggle` (97) · `→ Window Gaps` = `omarchy-hyprland-window-gaps-toggle` (98) · `→ 1-Window Ratio` = `omarchy-hyprland-window-single-square-aspect-toggle` (99)
- `Trigger → Hardware` submenu (72): `→ Laptop Display` = `omarchy-hyprland-monitor-internal toggle` [when `omarchy-hw-laptop`] (74) · `→ Mirror Display` = `omarchy-hyprland-monitor-internal-mirror toggle` [when `omarchy-hw-laptop`] (75) · `→ Hybrid GPU` = float-term `omarchy-toggle-hybrid-gpu` [when `omarchy-hw-hybrid-gpu`] (76) · `→ Touchpad` = `omarchy-toggle-touchpad` [when `omarchy-hw-touchpad`] (77) · `→ Touchpad Haptics` submenu (78): `→ low/mid/high` = `dell-xps-touchpad-haptics set …` [when `omarchy-hw-dell-xps-haptic-touchpad && omarchy-cmd-present dell-xps-touchpad-haptics`] [checked current] (79-81) · `→ Touchscreen` = `omarchy-toggle-touchscreen` [when `omarchy-hw-touchscreen`] (82). **Whole Hardware submenu disappears when every child is hidden.**
- `Trigger → Speed Test` submenu (73): `→ Network Speed Test` = `omarchy-shell shell summon omarchy.speedtest` (100) · `→ Disk Speed Test` = `omarchy-shell shell summon omarchy.disk-speedtest` (101)

Style (104-123):
- `Style → Theme` = `omarchy-theme-switcher` then `omarchy-theme-set` (104)
- `Style → Background` = `omarchy-theme-bg-switcher` then `omarchy-theme-bg-set` (105)
- `Style → Unlock` = `omarchy-plymouth-switcher` → float-term `omarchy-plymouth-reset` (default) or `omarchy-plymouth-set-by-theme` (106)
- `Style → Font` = provider `fonts` (bash one-liner, ✓ on current, volatile) (107)
- `Style → Menu Bar` submenu (108): `→ Position` submenu (109): `→ Top/Bottom/Left/Right` = `omarchy-bar position …` (114-117) · `→ Transparency` = `omarchy-bar transparent toggle` (110)
- `Style → Hyprland` = `omarchy-launch-config-editor ~/.config/hypr/looknfeel.lua` (111)
- `Style → Screensaver` submenu (112): `→ Edit Text` = `omarchy-branding-screensaver text` (121) · `→ Set From Image` = `… image` (122) · `→ Restore Default` = `… reset` (123)
- `Style → About` submenu (113): `→ Edit Text` = `omarchy-branding-about text` (118) · `→ Set From Image` (119) · `→ Restore Default` (120)

Setup (126-191):
- `Setup → Monitors` = config-editor `~/.config/hypr/monitors.lua` (126)
- `Setup → Keybindings` = config-editor `~/.config/hypr/bindings.lua` [when file exists — it does on stock, `config/hypr/bindings.lua`] (127)
- `Setup → Input` = config-editor `~/.config/hypr/input.lua` [when exists — stock yes] (128)
- `Setup → Network` submenu (129): `→ DNS` submenu (130): `→ DHCP / Cloudflare / Google` = `omarchy-dns <name>` [checked `$(omarchy-dns) == name`] (131-133) · `→ Custom` = float-term `omarchy-dns Custom` [checked] (134) · `Network → QR Code` = `omarchy-shell shell summon omarchy.wifiqr` [when `omarchy-network-status` starts `wifi`] (135)
- `Setup → Defaults` submenu (136):
  - `→ Agent` (title "Default Agent") (137): `→ Antigravity(agy) / Claude / Codex / Copilot / Crush / Cursor CLI(cursor-agent) / Grok / Hermes / Muse Code(muse) / omp / OpenClaw / OpenCode / Ori / Pi` = `omarchy-default-agent <id>` [checked `$(omarchy-default-agent) == id`] (138-151). **Stock: none checked** (Omarchy ships no default agent).
  - `→ Browser` (title "Default Browser") (152): `→ Chromium / Chrome / Brave / Brave Origin / Edge / Firefox / Zen` = `omarchy-default-browser <id>` [checked] (153-159). Stock ✓ Chromium.
  - `→ Terminal` (title "Default Terminal") (160): `→ Alacritty / Foot / Ghostty / Kitty` = `omarchy-default-terminal <id>` [checked] (161-164). Stock ✓ Alacritty.
  - `→ Editor` (title "Default Editor") (165): `→ Neovim(nvim) / VSCode(code) / Cursor / Zed(zeditor) / Sublime Text / Helix / Vim / Emacs` = `omarchy-default-editor <id>` [checked] (166-173). Stock ✓ Neovim.
- `Setup → Plugins` submenu (174): `→ Enable Plugin` = `omarchy-menu-plugin enable` (175) · `→ Disable Plugin` = `… disable` (176) · `→ Add Plugin` = float-term `omarchy-plugin-add` (177) · `→ Clone Plugin` = `omarchy-menu-plugin clone` (178) · `→ Remove Plugin` = `… remove` [when `~/.config/omarchy/plugins/*/manifest.json` exists] (179)
- `Setup → Security` submenu (180): `→ Fingerprint` = float-term `omarchy-setup-security-fingerprint` [when `omarchy-hw-fingerprint`] (182) · `→ Fido2` = float-term `omarchy-setup-security-fido2` (183) · `→ SSHD` = float-term `omarchy-setup-security-sshd` (184) · `→ Passwordless Sudo` = float-term `omarchy-sudo-passwordless` (185) · `→ Sudoless Docker` = float-term `omarchy-setup-security-sudoless-docker` [when `omarchy-sudo-docker --configured` i.e. user NOT in docker group — stock visible] (186)
- `Setup → Config` submenu (181): `→ Hyprland` = config-editor `~/.config/hypr/hyprland.lua` (187) · `→ Hyprsunset` = config-editor `~/.config/hypr/hyprsunset.conf && omarchy-restart-hyprsunset` (188) · `→ XCompose` = config-editor `~/.XCompose && omarchy-restart-xcompose` (189)
- `Setup → Direct Boot` = float-term `omarchy-setup-direct-boot` (190)
- `Setup → Reset Computer` = float-term `omarchy-system-factory-reset` [when root fs is btrfs] (191)

Install (194-284) — install rows use `disabled` so present software dims with ✓:
- `Install → Package` = `xdg-terminal-exec --app-id=org.omarchy.terminal omarchy-pkg-install` (194) · `→ AUR` = `… omarchy-pkg-aur-install` (195)
- `Install → AI` submenu (196): `→ ChatGPT Desktop` [disabled pkg openai-codex-desktop] (243) · `→ Claude Desktop` [claude-desktop] (244) · `→ Dictation` [voxtype-bin] = `omarchy-voxtype-install` (245) · `→ Grok Bot` [grok-bot] = `omarchy-install-and-launch 'Grok Bot' grok-bot grok-bot` (246) · `→ Hermes Desktop` [hermes-desktop] (247) · `→ LM Studio` [lmstudio-bin] = `omarchy-install-app` (248) · `→ Ollama` [cmd ollama] picks ollama-cuda/rocm/ollama (249) · `→ OpenClaw` [openclaw] = float-term `omarchy-install-ai-openclaw` (250) · `→ Perplexity` [perplexity] (251) · `→ T3 Code` [t3code-bin] (252)
- `Install → Service` submenu (197): `→ 1Password` [1password] (223) · `→ Dropbox` [dropbox] (224) · `→ Spotify` [spotify] (225) · `→ Signal` [signal-desktop] (226) · `→ Tailscale` [tailscale] (227) · `→ NordVPN` [nordvpn-bin] (228) · `→ ONCE` [once-bin] (229) · `→ Bitwarden` [bitwarden] = `omarchy-install-and-launch` (230) · `→ Chromium Account` [when `~/.config/chromium-flags.conf` exists — stock yes; disabled when it has `oauth2-client-id`] = float-term `omarchy-install-chromium-google-account` (231)
- `Install → Development` submenu (198): `→ Ruby on Rails` [mise ruby dir] (263) · `→ Docker DB` = float-term `omarchy-install-docker-dbs` (264) · `→ JavaScript` submenu (265): `→ Node.js / Bun / Deno` [mise dirs] (277-279) · `→ Go` (266) · `→ PHP` submenu (267): `→ PHP` [pkg php] (280) · `→ Laravel` [composer laravel] (281) · `→ Symfony` [symfony-cli] (282) · `→ Python` (268) · `→ Elixir` submenu (269): `→ Elixir` (283) · `→ Phoenix` [`~/.mix/archives/phx_new*`] (284) · `→ Zig` (270) · `→ Rust` [`~/.rustup`] (271) · `→ Java` (272) · `→ .NET` (273) · `→ OCaml` [`~/.opam`] (274) · `→ Clojure` (275) · `→ Scala` (276); all = float-term `omarchy-install-dev-env <lang>`
- `Install → Editor` submenu (199): `→ VSCode` [visual-studio-code-bin] (232) · `→ Cursor` [cursor-bin] = `omarchy-install-and-launch` (233) · `→ Zed` [zed] (234) · `→ Sublime Text` [sublime-text-4] (235) · `→ Helix` [helix] (236) · `→ Vim` [vim] = `omarchy-install-app Vim vim` (237) · `→ Emacs` [omarchy-emacs] (238)
- `Install → Style` submenu (200): `→ Theme` = float-term `omarchy-theme-install` (201) · `→ Background` = `omarchy-theme-bg-install` (202) · `→ Font` submenu (203): `→ Cascadia Mono / Meslo LG Mono / Fira Code / Victor Code / Bitstream Vera Mono / Iosevka` = `omarchy-install-font …` (204-209)
- `Install → Gaming` submenu (210): `→ Steam` [steam] (253) · `→ RetroArch` [retroarch] (254) · `→ Minecraft` [minecraft-launcher] (255) · `→ NVIDIA GeForce NOW` [flatpak com.nvidia.geforcenow] (256) · `→ Xbox Cloud Gaming` [`Xbox Cloud Gaming.desktop`] (257) · `→ Xbox Controllers` [xpadneo-dkms] (258) · `→ Battle.net` [`~/Games/battlenet`] (259) · `→ Lutris` [lutris] (260) · `→ Heroic (Epic Games)` [heroic-games-launcher-bin] (261) · `→ RetroArch Game Launcher` = `omarchy-games-retro-install` (262, never disabled)
- `Install → Browser` submenu (211): `→ Chrome` [google-chrome] (217) · `→ Edge` [microsoft-edge-stable-bin] (218) · `→ Brave` [brave-bin] (219) · `→ Brave Origin` [brave-origin-bin] (220) · `→ Firefox` [firefox] (221) · `→ Zen` [zen-browser-bin] (222); = float-term `omarchy-install-browser <id>`. (No Chromium row — it is preinstalled.)
- `Install → Web App` = float-term `omarchy-webapp-install` (212)
- `Install → Terminal` submenu (213): `→ Alacritty` [alacritty — **stock dimmed ✓**] (239) · `→ Foot` [foot] (240) · `→ Ghostty` [ghostty] (241) · `→ Kitty` [kitty] (242)
- `Install → TUI` = float-term `omarchy-tui-install` (214)
- `Install → Windows` = float-term `omarchy-windows-vm install` [disabled when `windows-vm.desktop` exists] (215)
- `Install → Preinstalls` = float-term `omarchy-install-preinstalls` [disabled unless `~/.local/state/omarchy/preinstalls-removed` — **stock dimmed ✓**] (216)

Remove (287-350) — remove rows use `when` so absent software hides:
- `Remove → Package` = `xdg-terminal-exec --app-id=org.omarchy.terminal omarchy-pkg-remove` (287)
- `Remove → AI` (title "Remove") (288): `→ Hermes Desktop` (303) · `→ ChatGPT Desktop` (312) · `→ Claude Desktop` (313) · `→ Dictation` = `omarchy-voxtype-remove` (314) · `→ Grok Bot` (315) · `→ LM Studio` (316) · `→ Ollama` (317) · `→ OpenClaw` (318) · `→ Perplexity` (319) · `→ T3 Code` (320); each [when `omarchy-pkg-present <pkg>`] → **submenu hidden on stock**
- `Remove → Services` (289): `→ Dropbox` (310) · `→ Tailscale` (311) [when pkg] → hidden on stock
- `Remove → Development` (290): `→ Ruby on Rails / Go / Python / Zig / Rust / Java / .NET / OCaml / Clojure / Scala` (330-342) · `→ JavaScript` submenu: `Node.js / Bun / Deno` (331, 343-345) · `→ PHP` submenu: `PHP / Laravel / Symfony` (333, 346-348) · `→ Elixir` submenu: `Elixir / Phoenix` (335, 349-350) [when mise dir / pkg] → hidden on stock; = float-term `omarchy-remove-dev-env <lang>`
- `Remove → Theme` = `omarchy-theme-remove` (291)
- `Remove → Gaming` (292): `→ Steam / RetroArch / Minecraft / NVIDIA GeForce NOW / Xbox Cloud Gaming / Xbox Controllers (󰂯) / Battle.net / Lutris / Heroic (Epic Games)` (321-329) [when present] → hidden on stock
- `Remove → Browser` (293): `→ Chrome / Edge / Brave / Brave Origin / Firefox / Zen` (304-309) [when pkg] → hidden on stock
- `Remove → Web App` = `omarchy-webapp-remove` [when any `~/.local/share/applications/*.desktop` Exec matches `omarchy-launch-webapp|omarchy-webapp-handler` — **stock visible**, `omarchy-refresh-applications` copies `applications/*.desktop`] (294)
- `Remove → TUI` = `omarchy-tui-remove` [when any user .desktop Exec matches `($TERMINAL|xdg-terminal-exec).*-e` — stock visible via `Docker.desktop`, `Disk Usage.desktop`] (295)
- `Remove → Windows` = float-term `omarchy-windows-vm remove` [when `windows-vm.desktop`] → hidden (296)
- `Remove → Preinstalls` = float-term `omarchy-remove-preinstalls` [when NOT `preinstalls-removed`] → **stock visible** (297)
- `Remove → Security` (298): `→ Fingerprint` [when pkg fprintd] (299) · `→ Fido2` [when pkg pam-u2f] (300) · `→ SSHD` [when `systemctl is-enabled sshd`] (301) · `→ Sudoless Docker` [when `! omarchy-sudo-docker --configured` i.e. user IS in docker group] (302) → submenu likely hidden on stock

Update (353-379):
- `Update → Omarchy` = float-term `omarchy-update` (353)
- `Update → Channel` submenu (354): `→ Stable 🟢 / RC 🟡 / Edge 🟠 / Dev 🔴` = float-term `omarchy-channel-set <c>` [checked `$(omarchy-channel-current)`] (363-366)
- `Update → Config` (title "Reset to default") (355): `→ Hyprland` = float-term `omarchy-refresh-hyprland` (369) · `→ Hyprsunset` (370) · `→ Plymouth` (371) · `→ Tmux` (372) · `→ Shell` = `omarchy-refresh-shell` (373)
- `Update → Extra Themes` = float-term `omarchy-theme-update` [when `omarchy-theme-extras`: a non-symlink theme dir with `.git`] → hidden on stock (356)
- `Update → Process` (title "Restart") (357): `→ Hyprsunset` = `omarchy-restart-hyprsunset` (367) · `→ Shell` = `omarchy-restart-shell` (368)
- `Update → Hardware` (title "Restart") (358): `→ Audio` = float-term `omarchy-restart-audio` (374) · `→ Wi-Fi` = `omarchy-restart-wifi` (375) · `→ Bluetooth` = `omarchy-restart-bluetooth` (376) · `→ Trackpad` = `omarchy-restart-trackpad` (377) — **no guards; all visible on the VM even without the hardware**
- `Update → Firmware` = float-term `omarchy-update-firmware` (359)
- `Update → Password` submenu (360): `→ Drive Encryption` = float-term `omarchy-drive-password` (378) · `→ User` = float-term `passwd` (379)
- `Update → Timezone` = `omarchy-menu-timezone` (361)
- `Update → Time` = float-term `omarchy-update-time` (362)

#### `omarchy-menu-*` helper scripts

- `omarchy-menu-keybindings [--print|-p]` — reads `hyprctl binds` + Lua source cache, resolves `code:N` via `xkbcli compile-keymap`, adds static rows `SHIFT ALT + L → Copy URL from Web App` and `SHIFT ALT + D → Download Video from Web App`, merges named alternative chords (`Close window`, `Calculator`, `Toggle scratchpad`, `Move window to scratchpad`) onto one row `A / B → action` when ≤35 columns, priority-sorts (Keybindings, Omarchy menu, Terminal, Browser … XF86 last, then Tmux/Herdr keybindings), caches to `~/.cache/omarchy/keybindings-<sha>.records`. Shows via `omarchy-menu-select 'Keybindings' -- --width 800 --height 500`; selecting a row **dispatches** it (exec / sendshortcut / lua / hyprctl dispatcher).
- `omarchy-menu-tmux-keybindings [--print] [--config path]` — spins a throwaway tmux server to list keys; first row `PREFIX → CTRL + …`; 40% monitor height picker "Tmux keybindings"; selection is display-only.
- `omarchy-menu-herdr-keybindings [--print] [--config path]` — parses `herdr --default-config` + user TOML; picker "Herdr keybindings"; display-only.
- `omarchy-menu-select <prompt> [option…] [-- --width N --height N]` — options from argv or stdin; exit 1 on cancel; usage on no options.
- `omarchy-menu-input <prompt> [--width N]` — typed text returned; exit 1 on cancel.
- `omarchy-menu-file <label> <paths:sep> <formats> [menu args]` — newest-first file list; `Path not found: <p>` exit 1.
- `omarchy-menu-images [--selected f] [--print-name] [--show-labels] [--filterable] [--lazy-thumbnails] [--preload] [--cache-only] <dir>…` — image grid via `omarchy-shell image-selector`; thumbnails in `~/.cache/omarchy/image-selector`; usage exit 1 without dirs.
- `omarchy-menu-emoji` = toggle `omarchy.emojis`; `omarchy-menu-clipboard` = toggle `omarchy.clipboard`; `omarchy-menu-emoji-insert <emoji>` = wl-copy + `wtype Shift+Insert` (hidden).
- `omarchy-menu-plugin <enable|disable|clone|remove>` — picker rows `󰐱 <name> / <id>`; `No plugin to <verb>` notification when the list is empty; clone/remove run in a floating terminal.
- `omarchy-menu-share <clipboard|file|folder> [path…]` — LocalSend headless send via `systemd-run --user`; file chooser via `omarchy-file-select`; `Could not share` critical toast when chooser fails.
- `omarchy-menu-timezone` — `timedatectl list-timezones | omarchy-menu-select "Set timezone"` then **`sudo timedatectl set-timezone`**, clock refresh, toast `Timezone is now set to <tz>`.

#### `omarchy-launch-*` scripts (24)

- `omarchy-launch-about` — floating `org.omarchy.about` terminal running fastfetch with a logo sheen; remembers fit in `~/.local/state/omarchy/windows/about.fit`; any key closes; relaunch focuses the existing window (`omarchy-launch-or-focus-tui`). Window rule `default/hypr/apps/system.lua:34-36` float/center 920×480 first launch.
- `omarchy-launch-browser [--private] [url]` — default browser from `xdg-settings` (fallback https handler); `--private` → `--incognito` / `--inprivate` (edge) / `--private-window` (firefox); with a URL, focuses the browser window afterwards.
- `omarchy-launch-editor [--inline] <path>` — reads `~/.local/state/omarchy/defaults/editor` (default nvim); TUI editors open via `omarchy-launch-tui`, GUI editors via `uwsm-app`.
- `omarchy-launch-config-editor <path>` — low-urgency toast `Editing config file / <path>` then editor; usage exit 1 without path.
- `omarchy-launch-terminal [cmd…]` — `xdg-terminal-exec --dir=$(omarchy-cmd-terminal-cwd)`; `omarchy-launch-terminal-tmux` = `tmux attach || tmux new -s Work`; `omarchy-launch-terminal-herdr` = `herdr`.
- `omarchy-launch-tui [--app-id=X] <cmd> [args]` — terminal with app-id `org.omarchy.<cmd>`; `omarchy-launch-or-focus-tui` focuses an existing one.
- `omarchy-launch-or-focus <pattern> [cmd]` — focus window whose class/title matches (word boundary, case-insensitive) else launch; usage on no args. `omarchy-launch-or-focus-webapp <pattern> <url…>` same for web apps.
- `omarchy-launch-webapp <url> [flags]` — default browser if chromium-family (`google-chrome* brave* microsoft-edge* opera* vivaldi* helium*`) else `chromium.desktop`; runs `<browser> --app=<url>` (chromeless window, class `chrome-<host>__<path>-Default`).
- `omarchy-launch-floating-terminal-with-presentation <cmd>` — `xdg-terminal-exec --app-id=org.omarchy.terminal --title=Omarchy -e bash -c "omarchy-show-logo; cmd; omarchy-show-done $?"`; floating 875×600 centered (`system.lua` `floating-window` tag); end prompt `● Done! Press any key to close...` or `● Failed (exit code N)! Press any key to close...`; Ctrl-C (130) closes without prompt.
- `omarchy-launch-screensaver [force]` — exits 0 if already running; exits 1 if `screensaver-off` toggle unless `force`; toast `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` for other terminals; one fullscreen `org.omarchy.screensaver` window per monitor.
- `omarchy-launch-nautilus` / `-nautilus-cwd` — Files new window / in active terminal's cwd.
- `omarchy-launch-1password` — runs `1password --force-device-scale-factor=1` or float-term `omarchy-install-service-1password`.
- `omarchy-launch-signal` / `-spotify` — focus existing window, else run `/usr/bin/signal-desktop` / `/usr/bin/spotify`, else float-term installer.
- `omarchy-launch-discord-community` — Discord app deep link if installed else webapp `https://discord.gg/tXFUdasqhY`.
- `omarchy-launch-docker-tui` (hidden) — `pkexec … lazydocker` when user lacks docker group (polkit prompt) else `lazydocker`.
- `omarchy-launch-battlenet [--with-mangohud] [--help]` — `Battle.net is not installed. Run omarchy-install-gaming-battlenet first.` exit 1; `Unknown argument: X` exit 1.
- `omarchy-launch-openclaw [--tui [--message t]]` — no `~/.openclaw/openclaw.json` → float-term `omarchy-openclaw-onboard && … omarchy-launch-openclaw`; with config: `openclaw dashboard --json` → gateway start/install → webapp of handoff URL; failure text `OpenClaw's gateway did not come up. Check it with: openclaw gateway status`.
- `omarchy-launch-shell` (hidden) — supervises quickshell under `systemd-cat -t omarchy-shell`; relaunches on non-zero exit (max 5/min, `Giving up on the Omarchy shell after N relaunches in under a minute.` in journal).

#### Web apps

- Shipped entries (copied to `~/.local/share/applications` by `omarchy-refresh-applications`): `Basecamp` (launchpad.37signals.com), `Discord` (discord.com/channels/@me), `Google Contacts`, `Google Maps`, `Google Messages`, `Google Photos`, `WhatsApp` (web.whatsapp.com), `X` (x.com), `YouTube`, `HEY` (`omarchy-webapp-handler-hey %u`, `MimeType=x-scheme-handler/mailto`), `Zoom` (`omarchy-webapp-handler-zoom %u`, `x-scheme-handler/zoommtg;zoomus`). Icons: `applications/icons/*.png` (Basecamp, Battle.net, ChatGPT, Disk Usage, Docker, Google Contacts/Maps/Messages/Photos, HEY, imv, omarchy-discord, Retro Gaming, WhatsApp, windows, X, YouTube, Zoom).
- `omarchy-webapp-install [name url icon [custom-exec] [mime]]` — interactive (gum) `Name>`, `URL>` (schemeless → `https://`), auto icon fetch (apple-touch-icon → `/apple-touch-icon.png` → Google favicon service), fallback `Icon URL/name>` prompt; writes `~/.local/share/applications/<Name>.desktop` with `Exec=omarchy-launch-webapp "<url>"`; success text `You can now find <Name> using the app launcher (SUPER + SPACE)`. Errors: `App name cannot contain '/': <n>` (exit 1, before icon fetch), `Error: web app URL must not contain whitespace.`, `Error: web app URL must be http or https.`, `Error: Failed to download icon.`, `You must set app name and app URL!`. **No duplicate-name check: same name overwrites.**
- `omarchy-webapp-remove [name]` — picker `Select web app to remove` of user .desktop files whose Exec is a webapp; toast `Web app removed / <name>`; `No web apps to remove.` exit 1 when none; unknown name still `rm -f` + toast.
- `omarchy-webapp-remove-all [dir]` — `Scanning for web apps in …`, `Removing web app: X`, `Web apps removed successfully.` / `No web apps found.`
- `omarchy-webapp-handler-hey [url]` — `mailto:x` → `https://app.hey.com/messages/new?to=x` else `https://app.hey.com`.
- `omarchy-webapp-handler-zoom [url]` — `zoommtg://…confno=N[&pwd=P]` → `https://app.zoom.us/wc/join/N?pwd=P` else `/wc/home`.
- Preinstalled webapp chords (`applications.lua`, only when `o.preinstalled_bindings_enabled()`): `Super+Shift+A` ChatGPT, `Super+Shift+Alt+A` Grok, `Super+Shift+C` HEY Calendar, `Super+Shift+E` HEY, `Super+Shift+Alt+E` HEY new email, `Super+Shift+Y` YouTube, `Super+Shift+Alt+G` WhatsApp (focus), `Super+Shift+Ctrl+G` Google Messages (focus), `Super+Shift+P` Google Photos (focus), `Super+Shift+S` Google Maps (focus), `Super+Shift+X` X, `Super+Shift+Alt+X` X Post.
- Window rules: `browser.lua` tags chromium-family `+chromium-based-browser` (tile, opacity 1.0/0.985); YouTube and Zoom `wc_home` app windows lose the tag (opaque); `title ".*is sharing.*"` → special silent workspace; `pip.lua` floats/pins Picture-in-Picture 600×338 top-right and Google Meet PiP bottom-right.

#### Other desktop entries and defaults

- `applications/Disk Usage.desktop` = `xdg-terminal-exec --app-id=TUI.float -e bash -c "dua i /"` (floats via `TUI.float` in `system.lua`).
- `applications/Docker.desktop` = `xdg-terminal-exec --app-id=TUI.tile -e omarchy-launch-docker-tui`.
- `applications/foot.desktop` (Foot terminal, `X-TerminalArg*` keys for xdg-terminal-exec), `imv.desktop` (Image Viewer, image MIME types), `mpv.desktop` (Media Player).
- `default/applications/battlenet.desktop` = `omarchy-launch-battlenet`, `StartupWMClass=battle.net.exe`.
- `default/applications/mimeapps.list`: directories → Nautilus; images → imv; pdf → Evince; `http/https` → `chromium.desktop`; `mailto` → `HEY.desktop`; video → mpv; text/*, shell, xml → `nvim.desktop`.
- `launcher.hides` hides 39 ids from Apps/launcher: avahi-discover, bssh, btop, bvnc, cmake-gui, cups, dropbox, electron34/36/37, fcitx5-configtool, fcitx5-wayland-launcher, foot-server, footclient, hermes, java/jconsole/jshell-java-openjdk, kbd-layout-viewer5, kcm_fcitx5, kcm_kaccounts, kvantummanager, libreoffice-base/draw/math/startcenter/xsltfilter, limine-snapper-restore, lstopo, org.fcitx.Fcitx5 (+4 fcitx5 gui ids), qv4l2, qvidcap, uuctl, xgps, xgpsspeed.
- Uninstall from launcher (`Delete` on an app row → `omarchy-remove-launcher-entry`): webapp → `omarchy-webapp-remove` (no toast), TUI → `omarchy-tui-remove`, user .desktop → rm, pacman-owned → float-term `sudo pacman -Rns <pkg>`, flatpak → `flatpak uninstall`, else `Don't know how to uninstall <id>` exit 1.

#### App launch chords (essential, always on; `applications.lua:2-8`)

- `Super+Return` Terminal (`omarchy-launch-terminal`), `Super+Shift+Return` and `Super+Shift+B` Browser, `Super+Shift+Alt+B` Browser (private), `Super+Shift+F` File manager, `Super+Alt+Shift+F` File manager (cwd), `Super+Shift+N` Editor.
- Preinstall chords (`applications.lua:12-20`): `Super+Alt+Return` Tmux, `Super+Ctrl+Return` Herdr, `Super+Shift+M` Music (spotify → installer), `Super+Shift+Alt+M` Music TUI (cliamp), `Super+Shift+D` Docker (`omarchy-launch-docker-tui`), `Super+Shift+G` Signal (→ installer), `Super+Shift+O` Obsidian, `Super+Shift+W` Omawrite, `Super+Shift+/` Passwords (1password → installer).
- Utility launch chords (`utilities.lua`): `Super+K` Keybindings viewer, `Super+Alt+K` Tmux keybindings, `Super+Ctrl+K` Herdr keybindings, `Super+Ctrl+Q` Calculator (omacalc), `Super+Ctrl+E` Emojis, `Super+Ctrl+V` Clipboard manager (`clipboard.lua:48`), `Super+Ctrl+T` Activity (btop TUI), `Super+Shift+Ctrl+A` Agent (`omarchy-agent --pick`), `Super+Ctrl+L` Lock.

#### Per-app window rules (`default/hypr/apps/*.lua`)

- `1password.lua` — `1Password|com.onepassword.OnePassword` floating, no screen share. `bitwarden.lua` — Bitwarden + Chromium extension popup floating, no screen share.
- `battlenet.lua` — launcher float 1280×800 centered; installer undecorated.
- `browser.lua`, `pip.lua` — see Web apps. `davinci-resolve.lua` — float, stay focused, opaque, fullscreen main window. `geforce.lua`, `moonlight.lua`, `retroarch.lua` — fullscreen/idle inhibit. `hermes.lua` — Hermes HUD borderless float. `jetbrains.lua` — no follow mouse. `localsend.lua` — `Share|localsend` float centered 1100×700. `qemu.lua`, `windows-vm.lua` (xfreerdp "Windows VM - Omarchy") — opaque. `steam.lua` — float, Steam 1100×700, Friends 460×800. `telegram.lua` — no focus steal. `webcam-overlay.lua` — three pinned corner sizes.
- `system.lua` — `floating-window` tag float/center 875×600 for `org.omarchy.btop|org.omarchy.terminal|org.omarchy.bash|org.codeberg.dnkl.foot|org.gnome.NautilusPreviewer|org.gnome.Evince|Omarchy|About|TUI.float|imv|mpv`, portal dialogs, file dialogs; `org.omarchy.about` 920×480; `omacalc`, Tensaku float; `org.omarchy.screensaver` fullscreen float slide; media windows opaque; `pop` rounding 8; `noidle` inhibit.
- `terminals.lua` — tag `terminal` on Alacritty|kitty|ghostty|foot|wezterm|`org.omarchy.*`|`TUI.*`. `omarchy-shell.lua` — no layer animation for bar/menu/image-selector/emojis/clipboard/keyboard-panel; dev gallery maximized. `screenshot-selection.lua` — slurp layer no animation.

#### Agents (user-visible)

- `omarchy agent [--inline] [--pick] [--prompt t]` — no default: `Choose default agent with: omarchy default agent <name>` exit 1 (`--pick` summons `setup.default.agent` instead); not installed: `<agent> is not installed. Choose an installed agent with: …`; extra arg: `Unexpected argument: X` + `To pass a prompt: omarchy agent prompt "…"`; cd to `~/Work` when launched from `$HOME`; opens terminal app-id `org.omarchy.agent`.
- `omarchy agent prompt [--inline] <text…>` — usage exit 1 without text.
- `omarchy agent crash <pid> [comm exe signal]` — `Not a PID: X` / `Usage: omarchy agent crash <pid>   (see: coredumpctl list)` exit 1; else prompts the default agent with the diagnose-crash skill.
- `omarchy agent usage-update [--force] [--limits-only] [--except a] [agent…]` — writes `~/.local/state/omarchy/agents/usage/<agent>.json`; `omarchy-agent-usage-update: <agent> collector failed` on stderr per failure. Collector auth hints: Claude `Run \`claude auth login\` to restore authoritative usage.`, Codex `Run \`codex login\` to authenticate.`, Fireworks `Set FIREWORKS_API_KEY, run \`firectl set-api-key\`, or sign in to Fireworks in opencode.`
- `omarchy default agent <name>` — stubs for codex, claude, crush, agy, copilot, opencode, pi, omp, grok, cursor-agent, ori, muse (mise wrappers in `~/.local/bin`, `install/user/mise.sh`) exist on stock, but `mise where` fails until first run, so **choosing any agent opens a floating terminal that installs it with mise (network), then launches it**.

#### Games / Chromium hosts

- `omarchy-games-retro-cores` — lists installed libretro cores as `Label (core)`; empty when `/usr/lib/libretro` missing.
- `omarchy-games-retro-install [core game]` — interactive: `No RetroArch cores found / /usr/lib/libretro` notification (exit 1) when none; core picker then `omarchy-menu-file "Retro game" ~/Games/roms …`; writes `~/.local/share/applications/<slug>.desktop` (`Icon=retro-gaming`), toast `<Game> installed / Start it with Super + Space`. Errors: usage (wrong arg count), `Game not found: <p>`, `Core not found: <p>`.
- `omarchy-chromium-copy-url-host` (hidden) — native messaging; toast `URL copied to clipboard`. `omarchy-chromium-ytdlp-host` (hidden) — toasts `No video found for download`, OSD progress 󰇚, `Download complete / <title>` (click → mpv) or `Download failed`. Both reachable only through the bundled Chromium extensions (`Shift+Alt+L`, `Shift+Alt+D`).

## Observations

1. **The menu is the driver's map.** Every hotkey listed above resolves through `omarchy-menu` → `omarchy-shell shell toggle omarchy.menu`. If the shell (quickshell) is down, none of `Super+Space`/`Super+Escape` do anything; the test `launch-shell-supervisor-recovers` is the canary and should run early in a batch.
2. **Guard timing.** Guards evaluate in one batched bash run per open/reload; the menu paints from the *previous* evaluation. Right after changing state (installing a web app, setting a default) the driver must close and reopen the menu **twice**, or wait ~2 s before reopening, before asserting a ✓ moved or a row appeared/vanished.
3. **VM guard outcomes (expected stock state on the QEMU guest):**
   - Hidden: `Trigger → Hardware → Laptop Display`, `Mirror Display`, `Hybrid GPU`, `Touchpad`, `Touchpad Haptics`; `Trigger → Toggle → Battery Percentage`; `Capture → Screenrecord → …+ webcam`; `Setup → Security → Fingerprint`; `Setup → Network → QR Code` (ethernet); `Update → Extra Themes`; `Remove → AI/Services/Development/Gaming/Browser/Windows/Security` (nothing installed); `Setup → Plugins → Remove Plugin`; `Capture → Stop Screenrecording`.
   - Uncertain: `Trigger → Hardware → Touchscreen` — `omarchy-hw-touchscreen` reads `hyprctl devices .tablets[]`, and the QEMU **USB tablet pointer may register as a tablet**, so the Hardware submenu may survive with a lone `Touchscreen` row. `System → Hibernate` depends on the mint's swap/resume config. `Setup → Reset Computer` depends on root being btrfs (likely yes on Omarchy installs).
   - Visible but hardware-less: `Update → Hardware → Audio / Wi-Fi / Bluetooth / Trackpad` have **no guards**; running them opens a floating terminal that restarts a service for hardware that is absent (should print and end `Done!`/`Failed`, not hang).
   - Dimmed ✓: `Install → Terminal → Alacritty`, `Install → Preinstalls`. Visible: `Remove → Preinstalls`, `Remove → Web App`, `Remove → TUI`, `Setup → Security → Sudoless Docker`, `Install → Service → Chromium Account`.
4. **`Update → Timezone` from the menu very likely fails silently on a stock install.** `omarchy-menu-timezone` runs `sudo timedatectl set-timezone` from a detached menu action with no TTY and no `SUDO_ASKPASS`; unless passwordless sudo is enabled, sudo exits and `set -e` aborts before the toast. From a terminal (`omarchy-menu-timezone`) it prompts in the terminal and works. Worth a definition either way — it is a plausible regression or a real bug.
5. **No default agent is shipped.** All 14 `Setup → Defaults → Agent` rows are unchecked; `Super+Shift+Ctrl+A` opens that submenu rather than launching anything; `omarchy agent` in a terminal exits 1 with a hint. Picking any agent starts a mise install in a floating terminal (network, minutes). The first-run hook also posts a critical "Set your default agent" notification exactly once (may already be consumed on the minted disk).
6. **Web app install has no duplicate check** — a second install with the same name silently overwrites the `.desktop`. Names containing `/` are refused *before* the icon fetch; bad URL schemes and whitespace are refused with exact messages (`webapp-install-test.sh`). Offline, interactive install falls back to the `Icon URL/name>` prompt (icon fetch fails); a bundled icon name like `basecamp` is accepted.
7. **Floating "presentation" terminals** end with `● Done! Press any key to close...` or `● Failed (exit code N)! Press any key to close...`; Ctrl-C at any prompt closes with no message. The driver should press a key to close them so later screenshots are clean. They are 875×600 centered, title `Omarchy`.
8. **Right-click on the bar's Omarchy logo opens a terminal**, not the menu — an easy driver mistake.
9. Keybindings viewer rows are monospace `CHORD                              → Action`; alternative chords join as `SUPER + W / SUPER + Q → Close window`; the Copilot key (`code:201`) row is hidden; first rows are always `Keybindings`, `Omarchy menu`, `Terminal`. Selecting a row **executes** the binding — the tmux/herdr viewers are display-only.
10. Missing-app launchers (`1password`, `signal`, `spotify`, defaults for uninstalled browser/terminal/editor) all open the **installer** in a floating terminal instead of erroring; on the VM these are network installs — the driver should observe the terminal open and abort with Ctrl-C.
11. `omarchy-launch-docker-tui` (Super+Shift+D, Docker app) triggers a **polkit password dialog** (shell polkit plugin) because the stock user is not in the docker group; docker.service may not be running, so lazydocker may show a connection error after auth.
12. `omarchy-launch-webapp` windows are chromeless Chromium `--app=` windows with class `chrome-<host>__<path>-Default`; without network they show Chromium's "This site can't be reached" page but the window still opens, so the launch path itself is testable offline.
13. The apps provider merges rows only after the Apps submenu (or a root search) is opened once; the first `Super+Alt+Space` on a fresh shell can take a second to fill.
14. Escape has two stages (clear filter, then close). Backspace on an empty filter goes **back**, not close — drivers typing a wrong letter then Backspace twice will leave the submenu.

## Proposed tests

### menu-open-super-escape-system   [VM-OK]
description: Super+Escape opens the Omarchy Menu at the System submenu and Escape closes it again, leaving the desktop as it was.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape.
  ** A centered card appears with the header "System…" and the rows Screensaver, Lock, Suspend, Logout, Reboot, Shutdown. Hibernate may sit between Suspend and Logout; note whether it does.
  * Press Backspace once.
  ** The header changes to "Go…" and the ten root rows Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System are listed; submenu rows end with "›".
  * Press Escape.
  ** The menu closes and the desktop must look exactly as before the first key.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not select Suspend, Reboot or Shutdown.
  * Backspace on an empty filter goes back a level; it does not close the menu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "System…" card with its rows.
  ** Screenshot of the "Go…" card with the ten root rows.
  ** Screenshot of the unchanged desktop after Escape.
  * If unsuccessful
  ** Screenshot of what is on screen after Super+Escape; `./client get-serial` if the bar vanished.
covers: default/hypr/bindings/utilities.lua:8, omarchy-menu.jsonc system.*, Menu.qml goBack

### menu-open-from-bar-click   [VM-OK]
description: The Omarchy logo at the far left of the bar opens the menu on left click and a terminal on right click, so the menu is reachable by mouse alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot and find the Omarchy logo glyph at the very left of the top bar (about x=0.01, y=0.01).
  * Left-click it with the mouse. Do not use the keyboard.
  ** The root menu "Go…" opens with rows Apps … System.
  * Left-click the logo again.
  ** The menu closes.
  * Right-click the logo.
  ** A terminal window opens (not the menu). Close it with Super+W.
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ./client-with-image returns a screenshot with each action.
  * Move the mouse first and screenshot to confirm it is over the glyph before clicking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the pointer on the logo and the root menu open.
  ** Screenshot of the terminal after the right click.
  ** The mouse was used, not the keyboard.
  * If unsuccessful
  ** Screenshot showing the pointer position and what opened.
covers: shell/plugins/menu/BarWidget.qml, config/omarchy/shell.json bar.layout.left

### menu-root-super-space   [VM-OK]
description: Super+Space toggles the root menu open and closed, and Super+Alt+Space opens straight into the alphabetical Apps list.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space.
  ** Root menu "Go…" with Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System in that order.
  * Press Super+Space again.
  ** The menu closes (toggle).
  * Press Super+Alt+Space.
  ** Header "Apps…" with installed applications listed alphabetically with icons.
  * Press Escape.
  ** Desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Apps list can take a second to fill the first time; take a second screenshot if it looks empty.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with the ten rows in order; screenshot of the desktop after the second Super+Space; screenshot of the Apps list.
  * If unsuccessful
  ** Screenshot after each key press.
covers: utilities.lua:1-2, omarchy-menu.jsonc root entries, Menu.qml apps sort

### menu-escape-clears-filter-then-closes   [VM-OK]
description: Escape in the menu first clears a typed filter and only then closes, so a mistyped search never throws the user out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and type "sty".
  ** The header now shows "sty" and the list holds the Style row plus deeper matches such as Install › Style under a divider.
  * Press Escape once.
  ** Header back to "Go…", full root list, menu still open.
  * Press Escape again.
  ** The menu closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Typing goes straight into the filter; there is no search box to click.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with "sty" in the header and the filtered list; screenshot after the first Escape with the full root list; screenshot of the desktop after the second.
  * If unsuccessful
  ** Screenshot at the step that diverged.
covers: Menu.qml Keys.onPressed Key_Escape

### menu-back-navigation-backspace-and-left   [VM-OK]
description: Backspace and Left on an empty filter step back one level at a time until the root, where they do nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, move Down to Setup, press Right; then Down to Defaults, Enter; then Down to Browser, Enter.
  ** Header "Default Browser…" with Chromium ✓, Chrome, Brave, Brave Origin, Edge, Firefox, Zen.
  * Press Left.
  ** Header "Defaults…".
  * Press Backspace.
  ** Header "Setup…".
  * Press Backspace.
  ** Header "Go…".
  * Press Backspace once more.
  ** Nothing changes; the menu stays open at root. Press Escape to close.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Right and Enter both open the highlighted submenu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing the headers "Default Browser…", "Defaults…", "Setup…", "Go…" in that order and the root still open after the last Backspace.
  * If unsuccessful
  ** Screenshot where the header did not change as expected.
covers: Menu.qml goBack, Key_Backspace/Key_Left; omarchy-menu.jsonc setup.default.browser title

### menu-type-to-filter-no-matches   [VM-OK]
description: Typing filters the menu with parent paths as subtitles, and a query with no hits shows an explicit "No matches" line instead of an empty card.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and type "keyb".
  ** "Keybindings" rows appear with their parent as subtitle (Learn first, then Setup).
  * Press Escape once, then type "zzqx".
  ** The card shows: No matches for “zzqx”
  * Press Escape twice.
  ** Menu closed, desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * One Escape clears the filter, the second closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "keyb" results with subtitles; screenshot of the No matches text.
  * If unsuccessful
  ** Screenshot of the card after typing "zzqx".
covers: Menu.qml rebuildDisplay search, empty text; MenuModel matchesQuery

### menu-search-drills-down-with-parent-path   [VM-OK]
description: Search covers every descendant of the current submenu: direct children first, deeper rows after a divider with their parent path, and scoping narrows when started inside a submenu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and type "font".
  ** A "Font" row with subtitle "Style" and a "Font" row with subtitle "Install › Style", separated by a thin divider, plus rows like "Fira Code" with subtitle "Install › Style › Font".
  * Press Escape once, move to Install and press Enter, then type "font".
  ** Only Install descendants remain: "Font" (subtitle Style) and the six font names. No Style › Font row.
  * Press Escape twice.
  ** Menu closed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not press Enter on a font row; that starts a network install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root search with both Font rows and the divider; screenshot of the Install-scoped search.
  * If unsuccessful
  ** Screenshot of the search results.
covers: Menu.qml rebuildDisplay currentRows/drilldownRows, searchDivider; omarchy-menu.jsonc style.font, install.style.font.*

### menu-mouse-only-navigation   [VM-OK]
description: The menu is fully usable by pointer: hovering highlights, clicking a submenu opens it, clicking an action runs it, and clicking outside closes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Click the Omarchy logo on the bar to open the menu.
  * Move the mouse over the "Learn" row and take a screenshot; the highlight must follow the pointer. Click it. Do not use the keyboard.
  ** Header "Learn…" with Keybindings, Omarchy, Hyprland, Arch, Neovim, Bash, Tmux, Herdr, Community.
  * Click "Keybindings".
  ** The keybindings picker opens (header "Keybindings…", monospace rows).
  * Click on the desktop outside the card.
  ** The picker closes; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ./client-with-image helps confirm the highlight before each click.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the pointer on Learn (highlighted), the Learn submenu, the picker, and the empty desktop.
  ** Only the mouse was used after opening.
  * If unsuccessful
  ** Screenshot showing the pointer and the card after the click.
covers: Menu.qml activateIndex(fromPointer), pointer gate; omarchy-menu.jsonc learn.*

### menu-submenu-hotkeys   [VM-OK]
description: The dedicated chords land directly on their submenu or picker (Capture, Toggle, Share, Hardware, Reminder, Theme, Background) so users learn the right shortcuts.
instruction: |
  <Instructions>
  From the desktop please do the following, pressing Escape (twice if a filter is set) between chords:

  <ActionList>
  * Super+Ctrl+C → header "Capture…" with Screenshot, Screenrecord, Text, QR Code, Color.
  * Super+Ctrl+O → header "Toggle…" with Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio.
  ** Battery Percentage must be absent (no battery).
  * Super+Ctrl+S → header "Share…" with Clipboard, File, Folder, Receive.
  * Super+Ctrl+H → either nothing opens, or "Hardware…" with only Touchscreen. Record which.
  * Super+Ctrl+R → a reminder text prompt opens. Escape.
  * Super+Shift+Ctrl+Space → the theme picker (list of theme names). Escape.
  * Super+Ctrl+Space → the background image grid. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Reminder, Theme and Background chords run the row's action directly rather than opening a submenu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per chord showing the expected header or picker, with a note on the Super+Ctrl+H outcome.
  * If unsuccessful
  ** Screenshot of the chord that opened the wrong thing or nothing.
covers: utilities.lua:4-6,17-18,85,89; omarchy-menu.jsonc aliases; docs/menu.md route → action

### menu-cli-verbs-and-routes   [VM-OK]
description: `omarchy menu` drives the menu from a terminal: summon opens by id or alias, toggle flips, close closes, and an unknown verb fails with a message.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter to open a terminal.
  * Type `omarchy menu summon style.theme` and Enter.
  ** The theme picker opens. Press Escape.
  * Type `omarchy menu summon power-menu` and Enter.
  ** The System submenu opens (alias). Press Escape.
  * Type `omarchy menu toggle system` and Enter, screenshot, then repeat the same command.
  ** First opens System, second closes it.
  * Type `omarchy menu summon no-such-route` and Enter.
  ** The menu opens at root "Go…". Press Escape.
  * Type `omarchy menu bogus; echo rc=$?` and Enter.
  ** `omarchy-menu: unknown verb 'bogus'. Try 'omarchy menu --help'.` and rc=2.
  * Close the terminal with Super+W; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu takes focus when it opens; press Escape (or click the terminal) before typing the next command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the System submenu, the toggled open/closed states, the root menu, and the terminal line with rc=2.
  * If unsuccessful
  ** Terminal screenshot with the failing command's output.
covers: bin/omarchy-menu, docs/menu.md CLI section, MenuModel resolveRoute

### menu-system-submenu-suspend-guard   [VM-PARTIAL]
description: The System submenu hides Suspend when the user has turned suspend off and shows Hibernate only when hibernation is configured, so the power menu never offers what the machine cannot do.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and record the rows (Screensaver, Lock, Suspend, [Hibernate], Logout, Reboot, Shutdown). Escape.
  * Press Super+Enter and type `omarchy-hibernation-available; echo hib=$?` Enter.
  ** hib=0 must match Hibernate being listed; hib=1 must match it being absent.
  * Type `mkdir -p ~/.local/state/omarchy/toggles && touch ~/.local/state/omarchy/toggles/suspend-off` Enter.
  * Press Super+Escape, Escape, then Super+Escape again.
  ** The Suspend row is gone.
  * In the terminal type `rm ~/.local/state/omarchy/toggles/suspend-off` Enter, then open the System menu twice as before.
  ** Suspend is back. Escape, close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu shows guard results from the previous open, so open it twice after changing state.
  * Skipped on this VM: actually suspending or hibernating.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the System rows; terminal line hib= consistent with Hibernate's presence; screenshot without Suspend; screenshot with Suspend restored.
  * If unsuccessful
  ** Screenshot of the System menu and the terminal output.
covers: omarchy-menu.jsonc system.suspend/hibernate, bin/omarchy-hibernation-available, bin/omarchy-toggle-enabled, docs/menu.md guards

### menu-learn-submenu-entries   [VM-OK] [NET]
description: Learn lists the nine documentation rows and its web rows open the right site as a chromeless web-app window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, open Learn.
  ** Rows exactly: Keybindings, Omarchy, Hyprland, Arch, Neovim, Bash, Tmux, Herdr, Community.
  * Select "Omarchy".
  ** A browser window with no tab strip or address bar opens on omarchy.org/manual. Close it with Super+W.
  * Learn → "Bash".
  ** Web-app window on devhints.io/bash. Close it.
  * Learn → "Community".
  ** Discord is not installed, so a web-app window of the discord.gg invite page opens. Close it.
  * Learn → "Tmux".
  ** Picker "Tmux keybindings…" whose first row starts with PREFIX. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Offline the pages show "This site can't be reached" but the window title still carries the site; that still proves the launch.
  * Downloads are small (page loads only).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the nine rows; screenshots of the three web-app windows and the tmux picker.
  * If unsuccessful
  ** Screenshot after selecting the failing row.
covers: omarchy-menu.jsonc learn.*, bin/omarchy-launch-webapp, bin/omarchy-launch-discord-community, bin/omarchy-menu-tmux-keybindings

### menu-trigger-submenu-entries   [VM-PARTIAL]
description: Trigger lists the quick actions correctly on a machine without laptop hardware, and its cheap actions (Emoji, Color, Reminder show, Disk speed test) run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger.
  ** Rows: Emoji, Reminder, Capture, Transcode, Share, Toggle, [Hardware], Speed Test. Note whether Hardware is listed; if it is, open it and record its rows (at most Touchscreen), then go back.
  * Open Capture → Screenrecord.
  ** Rows "With no audio", "With desktop audio", "With desktop + microphone audio"; the webcam row must be absent. Back twice.
  * Trigger → Reminder → Show all.
  ** A notification (possibly "no reminders") or nothing; no crash.
  * Trigger → Capture → Color, then click anywhere on the desktop.
  ** A notification with a hex color appears.
  * Trigger → Speed Test → Disk Speed Test.
  ** A panel opens and measures. Close it with Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: screen recording (no audio device), Transcode, Share, hardware toggles.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Trigger rows with the Hardware note; Screenrecord rows without webcam; color notification; disk speed panel.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: omarchy-menu.jsonc trigger.*, bin/omarchy-hw-*, bin/omarchy-menu-emoji

### menu-style-submenu-entries   [VM-OK]
description: Style lists the look-and-feel rows, the Font provider marks the current font with ✓, and Menu Bar → Position moves the bar and back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Style.
  ** Rows: Theme, Background, Unlock, Font, Menu Bar, Hyprland, Screensaver, About.
  * Open Font.
  ** A list of font names with exactly one ✓. Go back.
  * Open Menu Bar → Position and select Bottom.
  ** The bar moves to the bottom edge.
  * Reopen Style → Menu Bar → Position → Top.
  ** The bar is back at the top.
  * Style → About and Style → Screensaver each list Edit Text, Set From Image, Restore Default. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * When the bar is at the bottom, the menu still opens with Super+Space.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: Style rows; Font list with ✓; bar at bottom; bar at top; the two branding sub-lists.
  * If unsuccessful
  ** Screenshot of the bar not moving or a missing row.
covers: omarchy-menu.jsonc style.*, providers.fonts (docs/menu.md), bin/omarchy-bar

### menu-setup-submenu-entries   [VM-PARTIAL]
description: Setup lists its configuration rows with the VM's guards applied (no Fingerprint, no Wi-Fi QR) and Defaults shows the stock ✓ marks with no agent chosen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup.
  ** Rows: Monitors, Keybindings, Input, Network, Defaults, Plugins, Security, Config, Direct Boot, and Reset Computer only if the root disk is btrfs. Note Reset Computer's presence.
  * Network → DNS.
  ** Network shows only DNS (no QR Code); DNS shows DHCP ✓, Cloudflare, Google, Custom. Back twice.
  * Defaults → Agent.
  ** 14 rows (Antigravity … Pi) with no ✓. Back; Browser shows Chromium ✓, Terminal Alacritty ✓, Editor Neovim ✓.
  * Plugins shows Enable Plugin, Disable Plugin, Add Plugin, Clone Plugin (no Remove Plugin). Security shows Fido2, SSHD, Passwordless Sudo, Sudoless Docker (no Fingerprint). Config shows Hyprland, Hyprsunset, XCompose.
  * Press Escape; open a terminal and type `findmnt -no FSTYPE /` Enter.
  ** btrfs ⇔ Reset Computer was present. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run Direct Boot, Reset Computer or any Security action.
  * Skipped: positive paths for Fingerprint and Wi-Fi QR (hardware absent).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each listed submenu with the ✓ marks and absences; terminal line with the root fs type.
  * If unsuccessful
  ** Screenshot of the submenu whose rows differ.
covers: omarchy-menu.jsonc setup.*, bin/omarchy-default-{agent,browser,terminal,editor}, bin/omarchy-hw-fingerprint, bin/omarchy-network-status

### menu-install-submenu-entries   [VM-OK]
description: Install is a catalog: it lists everything installable, dims (✓, unselectable, unsearchable) what is already present, and Package opens a searchable package list that can be cancelled.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install.
  ** Rows: Package, AUR, AI, Service, Development, Editor, Style, Gaming, Browser, Web App, Terminal, TUI, Windows, Preinstalls; Preinstalls is dimmed with ✓.
  * Open Terminal.
  ** Alacritty dimmed ✓; Foot, Ghostty, Kitty normal. Press Down/Up: the cursor skips Alacritty. Type "ala": no Alacritty row. Escape, Backspace.
  * Open Browser.
  ** Chrome, Edge, Brave, Brave Origin, Firefox, Zen; no Chromium row. Back.
  * Open Development → JavaScript.
  ** Node.js, Bun, Deno. Back twice.
  * Select Package.
  ** A floating terminal with a searchable list of Arch packages appears (may take a moment). Press Ctrl+C.
  ** It closes without installing anything; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A dimmed row cannot be selected with Enter or click; that is expected.
  * The package list may load from the network; cancel as soon as it shows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Install, Terminal with Alacritty dimmed and the empty "ala" search, Browser, JavaScript, the package search terminal.
  * If unsuccessful
  ** Screenshot of the list with the wrong state.
covers: omarchy-menu.jsonc install.*, docs/menu.md disabled guard, menu-test.sh "never hides an Install row"

### menu-remove-submenu-stock   [VM-OK]
description: Remove hides what is not installed, so on a stock disk only Package, Theme, Web App, TUI and Preinstalls show, and its pickers list the shipped web apps and TUIs.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Remove.
  ** Rows exactly: Package, Theme, Web App, TUI, Preinstalls. AI, Services, Development, Gaming, Browser, Windows, Security absent.
  * Select Web App.
  ** Picker "Select web app to remove…" lists Basecamp, Discord, Google Contacts, Google Maps, Google Messages, Google Photos, HEY, WhatsApp, X, YouTube, Zoom. Escape.
  * Remove → TUI.
  ** Picker lists Disk Usage and Docker. Escape.
  * Remove → Theme.
  ** A theme picker opens. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Escape in a picker removes nothing; do not press Enter in this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the five Remove rows; the web app picker; the TUI picker.
  * If unsuccessful
  ** Screenshot showing extra or missing rows.
covers: omarchy-menu.jsonc remove.*, bin/omarchy-webapp-remove, bin/omarchy-tui-remove, bin/omarchy-refresh-applications

### menu-update-submenu-entries   [VM-OK]
description: Update lists the maintenance rows with Channel Stable ✓ and the Restart/Reset headers, and restarting the shell from it brings the bar back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Update.
  ** Rows: Omarchy, Channel, Config, Process, Hardware, Firmware, Password, Timezone, Time. "Extra Themes" absent.
  * Open Channel.
  ** Stable ✓, RC, Edge, Dev with 🟢🟡🟠🔴. Back.
  * Open Config.
  ** Header "Reset to default…"; Hyprland, Hyprsunset, Plymouth, Tmux, Shell. Back.
  * Open Process → Shell.
  ** Header was "Restart…"; the bar disappears briefly and is back within a few seconds.
  * Super+Space → Update → Hardware → Bluetooth.
  ** A floating Omarchy terminal runs and ends with "Done!" or "Failed (exit code N)!"; record which and press a key to close it. Desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not select Omarchy, Firmware, Time or any Channel row.
  * Take screenshots every second after Process → Shell to catch the bar returning.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Update rows, Channel with Stable ✓, the Config header, the bar gone and back, the Bluetooth terminal's last line.
  * If unsuccessful
  ** Screenshot of a missing bar; `./client get-serial`.
covers: omarchy-menu.jsonc update.*, bin/omarchy-theme-extras, bin/omarchy-show-done

### menu-hardware-guards-hide-rows   [VM-PARTIAL]
description: Rows for hardware this machine lacks are hidden and a submenu left empty disappears, which is what a user without a battery, webcam or fingerprint reader must see.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and type "Laptop Display".
  ** No matches. Escape once.
  * Type "Battery Percentage" → No matches. Escape once. Type "Fingerprint" → No matches. Escape once.
  * Type "QR".
  ** Only Capture › QR Code appears; no Network › QR Code. Escape once. Type "webcam" → No matches. Escape twice.
  * Press Super+Ctrl+H.
  ** Either nothing opens or "Hardware…" with only Touchscreen. Record which.
  * Press Super+Enter and type `omarchy-hw-touchscreen; echo ts=$?` Enter.
  ** ts=0 ⇔ the Touchscreen row was shown. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The QEMU tablet pointer may register as a touchscreen; that is why the last check exists.
  * Skipped on this VM: the rows appearing on real hardware.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each No matches / QR-only result; the Super+Ctrl+H outcome; terminal ts= line agreeing with it.
  * If unsuccessful
  ** Screenshot of a hidden row that appeared or a submenu that survived with no rows.
covers: omarchy-menu.jsonc when: guards, bin/omarchy-hw-laptop, -webcam, -fingerprint, -touchscreen, bin/omarchy-network-status, docs/menu.md submenu hiding

### menu-checked-markers-reflect-defaults   [VM-OK]
description: Changing the default terminal from the menu moves the ✓ and changes what Super+Enter opens, and changing back restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Defaults → Terminal.
  ** Alacritty ✓. Select Foot.
  ** Notification "Foot is now the default terminal".
  * Press Super+Enter.
  ** The new terminal is Foot (different look, title "foot"). Close it with Super+W.
  * Open Setup → Defaults → Terminal, Escape, open it again.
  ** Foot ✓, Alacritty unmarked.
  * Select Alacritty.
  ** Notification "Alacritty is now the default terminal"; Super+Enter opens Alacritty again. Close it.
  * Reopen the Terminal defaults twice: Alacritty ✓ again. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ✓ reflects the previous open's guard batch; always reopen twice before asserting.
  * If a floating installer terminal opens instead of the toast, Foot is missing on this build: report it and press Ctrl+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: Alacritty ✓, Foot toast, a Foot terminal, Foot ✓, Alacritty toast and terminal, Alacritty ✓ restored.
  * If unsuccessful
  ** Screenshot where the ✓ did not move or the wrong terminal opened.
covers: omarchy-menu.jsonc setup.default.terminal.*, bin/omarchy-default-terminal, docs/menu.md GUARD_READERS

### menu-apps-submenu-alphabetical-hidden-entries   [VM-OK]
description: The Apps submenu is the graphical launcher: alphabetical rows with icons, entries from launcher.hides omitted, and Enter launches the app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space.
  ** Header "Apps…"; alphabetical rows with icons, including Basecamp, Chromium, Discord, Disk Usage, Docker, Google Contacts, … YouTube, Zoom; the shipped web apps and TUIs show distinct icons, not a blank glyph.
  * Type "btop".
  ** No btop app row (hidden). Escape once; type "fcitx" → No matches. Escape once.
  * Type "chrom" and press Enter.
  ** The menu closes and a Chromium window opens (a rocket "Launching…" OSD may show first). Close it with Super+W.
  * Press Super+Space, type "disk", Enter.
  ** A floating terminal running dua opens. Press q to quit; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Escape once clears the filter; twice closes.
  * Chromium's first start can take several seconds; keep taking screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the alphabetical Apps list with icons; screenshots proving btop and fcitx absent; the Chromium window; the dua terminal.
  * If unsuccessful
  ** Screenshot of a hidden entry present, a missing icon, or the app not launching.
covers: omarchy-menu.jsonc apps provider, default/omarchy/launcher.hides, shell/services/AppLibrary.qml, applications/Disk Usage.desktop, app-search-test.sh

### app-launcher-uninstall-with-delete-key   [VM-OK]
description: Delete on an app row asks to uninstall it; cancelling keeps it, confirming removes a web app's launcher, and a packaged app hands off to a sudo pacman terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space, type "basecamp", press Delete.
  ** Dialog "Do you want to uninstall Basecamp?" with an Uninstall button.
  * Press Escape.
  ** The dialog closes; Basecamp is still listed.
  * Press Delete again and choose Uninstall.
  ** The menu closes. Reopen Super+Alt+Space, type "basecamp": No matches. Escape twice.
  * Press Super+Enter and type `omarchy-refresh-applications` Enter, then Super+Alt+Space, type "basecamp".
  ** Basecamp is back. Escape.
  * Type "chrom", press Delete, choose Uninstall.
  ** A floating terminal "Uninstalling Chromium..." asks for a sudo password. Press Ctrl+C; it closes and Chromium stays installed.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Uninstall button is the right-hand choice; Enter on it or click it.
  * No toast is shown for a launcher-initiated web app removal; the empty search is the proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dialog, Basecamp still present after Escape, No matches after Uninstall, Basecamp restored, the pacman terminal aborted.
  * If unsuccessful
  ** Screenshot of the dialog or terminal at the failure.
covers: Menu.qml requestDeleteSelected/confirmDelete, bin/omarchy-remove-launcher-entry, bin/omarchy-webapp-remove, launcher-remove-test.sh

### app-launcher-keywords-searchable-not-routable   [VM-OK]
description: Apps match search by their desktop Keywords but never capture a menu route, so Super+Escape always opens System even though apps ship `Keywords=system`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and type "system".
  ** The first row is the System submenu (›); keyword-matched apps, if any, sit below the divider.
  * Press Escape twice, then Super+Escape.
  ** The System submenu opens, never an application. Escape.
  * Press Super+Enter, type `omarchy menu summon process` Enter.
  ** The menu opens (root or a submenu), no application launches. Escape.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * htop is the app that ships the "system" keyword; btop is hidden from the launcher.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "system" search with System first; the System submenu after Super+Escape; the result of summon process.
  * If unsuccessful
  ** Screenshot showing an app launched from a route.
covers: docs/menu.md Providers (apps never routable), menu-test.sh resolveRoute

### keybindings-viewer-opens-and-filters   [VM-OK]
description: Super+K opens the searchable keybindings sheet with the core chords first, filters as the user types, and hides the Copilot key row.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K.
  ** Picker "Keybindings…" with monospace rows "CHORD → Action"; the first rows are "SUPER + K → Keybindings", "SUPER + SPACE → Omarchy menu", "SUPER + RETURN → Terminal".
  * Type "screenshot".
  ** Only matching rows remain (e.g. "PRINT → Screenshot"). Escape once.
  * Type "code:201".
  ** No matches (Copilot key hidden). Escape once.
  * Type "Copy URL".
  ** Row "SHIFT ALT + L → Copy URL from Web App". Escape once.
  * Press PageDown repeatedly to the end.
  ** The last rows are XF86 media keys, then "… → Tmux keybindings" and "… → Herdr keybindings".
  * Press Escape, then Super+K again.
  ** It reopens within about a second. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first open builds a cache and may take a couple of seconds; the second is fast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the first rows, the screenshot filter, No matches for code:201, the Copy URL row, the tail rows.
  * If unsuccessful
  ** Screenshot of the picker (or nothing) after Super+K.
covers: bin/omarchy-menu-keybindings (prioritize_entries, static_bindings, code:201, cache), utilities.lua:10, keybindings-menu-test.sh

### keybindings-viewer-runs-selected-binding   [VM-OK]
description: Selecting a row in the keybindings viewer runs that binding, so users can trigger a chord they cannot remember; Escape runs nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K, type "Terminal", highlight "SUPER + RETURN → Terminal", press Enter.
  ** The picker closes and a terminal opens. Leave it open.
  * Press Super+K, type "Toggle window gaps", Enter.
  ** The gaps around the terminal change. Repeat to restore them.
  * Press Super+K, type "Lock system", Enter.
  ** The lock screen appears. Type prime and Enter.
  ** The desktop returns with the terminal still there.
  * Press Super+K and then Escape.
  ** Nothing runs. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen turns black after a few seconds; typing still goes into the password box.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the terminal opened from the list; gaps toggled and restored; lock screen; restored desktop.
  * If unsuccessful
  ** Screenshot after Enter showing nothing happened.
covers: bin/omarchy-menu-keybindings dispatch_binding/dispatch_exec_binding

### keybindings-viewer-merges-alternative-chords   [VM-OK]
description: Actions Omarchy binds twice on purpose share one row ("SUPER + W / SUPER + Q → Close window") while look-alike labels stay on separate rows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K and type "Close window".
  ** Exactly one row "SUPER + W / SUPER + Q → Close window". Escape once.
  * Type "scratchpad".
  ** "SUPER + S / SUPER + ~ → Toggle scratchpad" and "SUPER + ALT + S / SUPER + SHIFT + ~ → Move window to scratchpad" (grave rendered as ~). Escape once.
  * Type "Calculator".
  ** Both SUPER + CTRL + Q and XF86Calculator appear (on one row or two). Escape once.
  * Type "Reveal active".
  ** Two separate rows (ALT + TAB and ALT + SHIFT + TAB), not merged.
  * Press Escape twice; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list is monospace; the "/" separator is the merge marker to look for.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each filter showing merged vs separate rows.
  * If unsuccessful
  ** Screenshot showing a missing chord or a wrongly merged pair.
covers: bin/omarchy-menu-keybindings alternative_chord_actions/parse_binding_records, tiling.lua:1-2,28-31,47-50

### tmux-keybindings-viewer   [VM-OK]
description: Super+Alt+K shows the annotated tmux bindings with the PREFIX row first, and selecting a row only closes the list.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+K.
  ** Picker "Tmux keybindings…"; first row "PREFIX → CTRL + …"; other rows like "PREFIX + C → …".
  * Type "split".
  ** Matching rows remain. Press Enter on one.
  ** The picker closes and nothing else happens.
  * Press Super+Enter and type `omarchy-menu-tmux-keybindings --print | head -5` Enter.
  ** The same rows print in the terminal. Close it; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list is display-only by design; Enter is not a failure if nothing launches.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker with PREFIX first; terminal output of --print.
  * If unsuccessful
  ** Terminal screenshot with the error.
covers: bin/omarchy-menu-tmux-keybindings, utilities.lua:11, omarchy-menu.jsonc learn.tmux-keybindings

### herdr-keybindings-viewer   [VM-OK]
description: Super+Ctrl+K shows Herdr's bindings derived from its default config, opening with a PREFIX row even with no user config.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+K.
  ** Picker "Herdr keybindings…" with a "PREFIX → …" first row and rows like "NAVIGATE + … → …".
  * Type "help" to filter, then Escape.
  ** The picker closes.
  * Press Super+Enter and type `omarchy-menu-herdr-keybindings --print | head -5` Enter.
  ** Rows print. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Display-only picker; Enter closes it without action.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker; terminal output.
  * If unsuccessful
  ** Terminal output of the command's stderr.
covers: bin/omarchy-menu-herdr-keybindings, utilities.lua:12, omarchy-menu.jsonc learn.herdr-keybindings

### launch-terminal-chords-and-cwd   [VM-OK]
description: Super+Enter opens the default terminal in the focused terminal's working directory, and the tmux and herdr chords open their sessions.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter.
  ** An Alacritty window opens at the home directory.
  * Type `cd /tmp` Enter, then press Super+Enter again.
  ** The second terminal's prompt shows /tmp. Close both with Super+W.
  * Press Super+Alt+Enter.
  ** A terminal with a tmux status bar and session "Work". Type `exit` Enter until it closes.
  * Press Super+Ctrl+Enter.
  ** A terminal running herdr. Quit it (q or Ctrl+C) and close the window.
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The prompt shows the directory; if it is abbreviated, type `pwd` Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the second terminal at /tmp; the tmux Work session; the herdr window.
  * If unsuccessful
  ** Screenshot of the terminal that opened in the wrong directory or failed.
covers: bin/omarchy-launch-terminal, -terminal-tmux, -terminal-herdr, applications.lua:2,12,13

### launch-browser-normal-and-private   [VM-OK]
description: The browser chords open the default browser, the private chord opens an incognito window, and passing a URL focuses the browser on it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Enter.
  ** A Chromium window opens. Close it with Super+W.
  * Press Super+Shift+Alt+B.
  ** Chromium opens in Incognito (dark "You've gone Incognito" page). Close it.
  * Press Super+Enter and type `omarchy-launch-browser https://example.com` Enter.
  ** Chromium opens with example.com in the address bar and has focus (offline: error page, URL still shown).
  * Type in the terminal `omarchy-launch-browser --private https://example.com` Enter.
  ** An incognito window with example.com. Close all browser windows and the terminal.
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the terminal (mouse move + click) to refocus it after the browser takes focus.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the normal, incognito, URL-focused, and private+URL windows.
  * If unsuccessful
  ** Terminal screenshot with any error text.
covers: bin/omarchy-launch-browser, applications.lua:3,6,7, launch-browser-test.sh

### launch-editor-and-config-editor   [VM-OK]
description: Super+Shift+N opens the default editor, config rows open their file with an "Editing config file" toast, and the command refuses a missing path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N.
  ** A terminal running Neovim on an empty buffer. Type `:q` Enter.
  * Press Super+Space → Setup → Monitors.
  ** A small toast "Editing config file — ~/.config/hypr/monitors.lua" and Neovim opens monitors.lua (name in the status line). `:q` Enter.
  * Press Super+Enter and type `omarchy-launch-config-editor; echo rc=$?` Enter.
  ** "Usage: omarchy-launch-config-editor <path>" and rc=1.
  * Type `omarchy-default-editor` Enter.
  ** Prints nvim. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The toast is low priority and small, in the notification corner; screenshot right after selecting the row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: Neovim from the chord; toast plus monitors.lua in the status line; usage line with rc=1.
  * If unsuccessful
  ** Screenshot at the failing step.
covers: bin/omarchy-launch-editor, bin/omarchy-launch-config-editor, omarchy-menu.jsonc setup.monitors, applications.lua:8

### launch-files-and-files-cwd   [VM-OK]
description: Super+Shift+F opens Files at home and Super+Alt+Shift+F opens it on the focused terminal's current directory.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+F.
  ** A Nautilus window on the home folder. Close it with Super+W.
  * Press Super+Enter and type `cd /usr/share/icons` Enter.
  * Press Super+Alt+Shift+F.
  ** Nautilus opens showing /usr/share/icons in its path bar.
  * Close Nautilus and the terminal.
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal must still be the focused window when pressing the cwd chord.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Nautilus at Home and at /usr/share/icons.
  * If unsuccessful
  ** Screenshot showing Nautilus at the wrong folder or not opening.
covers: bin/omarchy-launch-nautilus, bin/omarchy-launch-nautilus-cwd, applications.lua:4-5

### launch-about-dialog   [VM-OK]
description: Omarchy Menu → About opens the fastfetch About window sized to its content with an animated logo, closes on any key, and a second launch focuses the existing window instead of opening another.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → About.
  ** A floating centered terminal shows the Omarchy logo left and system info right, with no large empty area and no clipped lines. Take two screenshots two seconds apart: a highlight moves across the logo.
  * Press Space.
  ** The window closes.
  * Press Super+Enter and type `omarchy-launch-about` Enter.
  ** About opens again at the same size without a visible resize jump.
  * Click the terminal and type `omarchy-launch-about` Enter again.
  ** The existing About window is focused; there is only one About window on screen.
  * Press a key in About to close it; close the terminal. Desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Uptime and version values vary; judge layout only.
  * Any key closes About, so click the terminal with the mouse rather than pressing keys while About is focused.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two About screenshots showing the sheen moved; a screenshot with a single About window after the second launch.
  * If unsuccessful
  ** Screenshot of a clipped, oversized or duplicated About window.
covers: bin/omarchy-launch-about, bin/omarchy-launch-or-focus-tui, default/hypr/apps/system.lua org.omarchy.about, launch-about-test.sh

### launch-screensaver-and-toggle   [VM-OK]
description: System → Screensaver forces the screensaver even when it is toggled off, while the plain launcher respects the toggle and refuses; any key exits it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape → Screensaver.
  ** A fullscreen animated screensaver covers the screen. Press a key; the desktop returns.
  * Press Super+Space → Trigger → Toggle → Screensaver.
  ** The screensaver is now off (a notification may confirm).
  * Press Super+Enter and type `omarchy-launch-screensaver; echo rc=$?` Enter.
  ** rc=1 and no screensaver appears.
  * Press Super+Escape → Screensaver.
  ** It still appears (forced). Press a key to exit.
  * Press Super+Space → Trigger → Toggle → Screensaver to turn it back on, then in the terminal run the command again.
  ** The screensaver appears. Exit it; close the terminal. Desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screensaver takes keyboard focus; the next key press only exits it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the screensaver, the rc=1 line with toggle off, the forced screensaver, the restored behaviour.
  * If unsuccessful
  ** Terminal screenshot with rc and any notification such as "Screensaver only runs in …".
covers: bin/omarchy-launch-screensaver, omarchy-menu.jsonc system.screensaver / trigger.toggle.screensaver, system.lua org.omarchy.screensaver

### launch-floating-terminal-presentation   [VM-OK]
description: Menu actions run in a floating "presentation" terminal that shows the logo, runs the command and ends with Done!/Failed and a key wait, while Ctrl+C closes it silently.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-launch-floating-terminal-with-presentation 'echo hello'` Enter.
  ** A centered floating terminal titled Omarchy shows the logo, "hello", a green dot and "Done! Press any key to close...". Press a key; it closes.
  * Type `omarchy-launch-floating-terminal-with-presentation 'false'` Enter.
  ** Red dot and "Failed (exit code 1)! Press any key to close...". Press a key.
  * Type `omarchy-launch-floating-terminal-with-presentation 'sleep 30'` Enter, then press Ctrl+C in the floating window.
  ** It closes immediately with no Done/Failed prompt.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating window is roughly 875×600 and centered, not tiled; note that in the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Done!, Failed (exit code 1)!, and the sleep window before and after Ctrl+C.
  * If unsuccessful
  ** Screenshot of the window state and the terminal's stderr.
covers: bin/omarchy-launch-floating-terminal-with-presentation, bin/omarchy-show-done, system.lua floating-window tag

### launch-tui-focus-instead-of-duplicate   [VM-OK]
description: A TUI launched twice through the or-focus launcher focuses the existing window instead of opening a second, and the launcher prints usage without arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+T.
  ** A floating terminal running btop opens.
  * Press Super+Enter and type `omarchy-launch-or-focus-tui btop` Enter.
  ** Focus jumps to the existing btop; the screenshot shows exactly one btop window.
  * Type `omarchy-launch-tui btop` Enter.
  ** A second btop window opens (the plain launcher does not dedupe). Press q in each btop to close both.
  * Type `omarchy-launch-or-focus; echo rc=$?` Enter.
  ** "Usage: omarchy-launch-or-focus [window-pattern] [launch-command]" and rc=1.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Refocus the terminal with a mouse click before typing after btop takes focus.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: one btop window after or-focus; two after the plain launch; the usage line.
  * If unsuccessful
  ** Screenshot showing a duplicate after or-focus or a missing usage line.
covers: bin/omarchy-launch-tui, bin/omarchy-launch-or-focus, bin/omarchy-launch-or-focus-tui, utilities.lua:104

### launch-webapp-chromeless-window   [VM-OK] [NET]
description: A URL launched as a web app opens in a chromeless browser window, and the or-focus variant re-focuses that window instead of opening another.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-launch-webapp https://example.com` Enter.
  ** A Chromium window with no tab strip or address bar shows example.com (or an offline error page).
  * Click the terminal and type `omarchy-launch-or-focus-webapp example.com https://example.com` Enter.
  ** Focus returns to the same window; still exactly one web-app window on screen.
  * Type `omarchy-launch-webapp https://example.com` Enter.
  ** A second web-app window opens. Close both with Super+W.
  * Type `omarchy-launch-or-focus-webapp; echo rc=$?` Enter.
  ** Usage line and rc=1. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Page load is a few KB; offline is fine for the window-shape check.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the chromeless window; one window after or-focus; two after the plain relaunch; the usage line.
  * If unsuccessful
  ** Screenshot showing a tabbed browser instead of app mode, or a terminal error.
covers: bin/omarchy-launch-webapp, bin/omarchy-launch-or-focus-webapp, browser.lua

### launch-missing-apps-open-installer   [VM-PARTIAL] [NET]
description: Chords for apps that are not installed (1Password, Signal, Spotify) open the installer in a floating terminal instead of failing silently, and aborting installs nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+/ (Passwords).
  ** A floating Omarchy terminal runs the 1Password installer. Press Ctrl+C at once; it closes.
  * Press Super+Shift+G (Signal).
  ** Installer terminal for Signal. Ctrl+C.
  * Press Super+Shift+M (Music).
  ** Installer terminal for Spotify. Ctrl+C.
  * Press Super+Enter and type `pacman -Q 1password signal-desktop spotify` Enter.
  ** Three "was not found" lines. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a sudo prompt appears, Ctrl+C there too.
  * Skipped on this VM: launching the installed apps (multi-minute downloads).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each installer terminal and the pacman "not found" lines.
  * If unsuccessful
  ** Screenshot after the chord showing nothing opened or an error toast.
covers: bin/omarchy-launch-1password, -signal, -spotify, applications.lua:14,17,20, launch-1password-test.sh

### launch-docker-tui-polkit-gate   [VM-PARTIAL]
description: Docker TUI is gated by a polkit password prompt because the stock user is not in the docker group; cancelling closes cleanly and authenticating opens lazydocker.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+D.
  ** A terminal opens and a polkit authentication dialog asks for the password to run lazydocker.
  * Click Cancel.
  ** The terminal closes (or shows an authorization error and exits).
  * Press Super+Shift+D again, type prime, confirm.
  ** lazydocker opens; if the Docker daemon is not running it shows a connection error. Record which. Press q.
  * Press Super+Space → Setup → Security.
  ** "Sudoless Docker" is listed. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The polkit dialog is a small centered window from the shell; it may appear a second after the terminal.
  * Skipped: the sudoless (docker group) path, which needs a reboot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, the closed terminal after cancel, lazydocker or its error after auth, the Security row.
  * If unsuccessful
  ** Screenshot of lazydocker running with no prompt (a security regression) or a terminal error.
covers: bin/omarchy-launch-docker-tui, bin/omarchy-sudo-docker, applications/Docker.desktop, applications.lua:16, omarchy-menu.jsonc setup.security.sudoless-docker

### launch-battlenet-not-installed   [VM-OK]
description: The Battle.net launcher gives a clear error when the game prefix is missing and rejects unknown flags, and the menu offers Battle.net only under Install.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-launch-battlenet; echo rc=$?` Enter.
  ** "Battle.net is not installed. Run omarchy-install-gaming-battlenet first." rc=1.
  * Type `omarchy-launch-battlenet --bogus; echo rc=$?` Enter.
  ** "Unknown argument: --bogus", "Try: omarchy-launch-battlenet --help", rc=1.
  * Type `omarchy-launch-battlenet --help` Enter.
  ** Usage text mentioning --with-mangohud.
  * Press Super+Space → Install → Gaming.
  ** Battle.net row enabled (not dimmed). Escape; Remove has no Gaming row.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No network needed; nothing is installed here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshot with the three outputs and rc values; Install → Gaming row.
  * If unsuccessful
  ** Terminal screenshot.
covers: bin/omarchy-launch-battlenet, default/applications/battlenet.desktop, omarchy-menu.jsonc install.gaming.battlenet / remove.gaming.battlenet

### launch-openclaw-not-onboarded   [VM-PARTIAL] [NET]
description: Launching OpenClaw before onboarding routes to the setup wizard in a floating terminal rather than a dead dashboard, and a malformed flag is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `ls ~/.openclaw/openclaw.json` Enter.
  ** "No such file".
  * Type `omarchy-launch-openclaw; echo rc=$?` Enter.
  ** A floating Omarchy terminal runs the OpenClaw onboarding or installer; press Ctrl+C to abort. If the openclaw command is missing entirely an error line prints instead. Record exactly what appeared.
  * Type `omarchy-launch-openclaw --tui --message; echo rc=$?` Enter.
  ** "--message needs a value" and a non-zero rc.
  * Press Super+Space → Install → AI.
  ** OpenClaw row enabled. Escape; close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: onboarding and gateway start (needs installation, network, minutes).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the wizard/installer terminal or the error line; the --message error; the Install → AI row.
  * If unsuccessful
  ** Screenshot of a browser opening a dead page, or a hang.
covers: bin/omarchy-launch-openclaw, launch-openclaw-test.sh, omarchy-menu.jsonc install.ai.openclaw

### launch-shell-supervisor-recovers   [VM-OK]
description: When the shell process dies the launcher relaunches it, so the bar and menu come back on their own and the journal records the relaunch.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot showing the top bar.
  * Press Super+Enter and type `pkill -9 -x quickshell` Enter, then take screenshots every second.
  ** The bar disappears and is back within about four seconds.
  * Press Super+Space.
  ** The menu opens normally. Escape.
  * Type `journalctl -t omarchy-shell -n 5 --no-pager | sudo tee /dev/ttyS0` Enter (password prime if asked), then read `./client get-serial`.
  ** A line "Omarchy shell exited with status … relaunching." is present.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar is not back after ten seconds the supervisor failed; capture the serial log and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: bar present, bar gone, bar back, menu open; serial excerpt with the "relaunching" line.
  * If unsuccessful
  ** Screenshot without the bar and the serial dump.
covers: bin/omarchy-launch-shell, launch-shell-test.sh

### webapp-install-interactive-happy-path   [VM-OK] [NET]
description: Install → Web App asks for a name and URL, fetches the site icon, and the new app appears in the launcher and opens as a chromeless window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Web App.
  ** A floating terminal shows "Let's create a new web app…" and a "Name>" prompt.
  * Type `Example Site` Enter; at "URL>" type `example.com` Enter.
  ** The icon fetch runs. If it fails, an "Icon URL/name>" prompt appears: type `basecamp` Enter.
  ** "You can now find Example Site using the app launcher (SUPER + SPACE)" then "Done! Press any key to close...". Press a key.
  * Press Super+Space, type "example", Enter.
  ** A chromeless window opens on example.com. Close it with Super+W.
  * Press Super+Space → Remove → Web App.
  ** "Example Site" is in the picker. Select it.
  ** Toast "Web app removed — Example Site". Desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon fetch can take up to ten seconds; keep taking screenshots.
  * The URL had no scheme on purpose; https is added automatically.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompts, the success text, the launched window, the picker with Example Site, the removal toast.
  * If unsuccessful
  ** Screenshot of the terminal error.
covers: bin/omarchy-webapp-install (interactive, normalize_webapp_url, fetch_site_icon), bin/omarchy-webapp-remove, omarchy-menu.jsonc install.webapp

### webapp-install-rejects-bad-input   [VM-OK]
description: Web app install refuses a name with a slash, a non-http URL and a URL with whitespace, each with its exact message and no launcher or icon left behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Web App; at "Name>" type `https://evil.example` Enter.
  ** "App name cannot contain '/': https://evil.example" then "Failed (exit code 1)!". Press a key.
  * Install → Web App; Name `Bad` Enter, URL `file:///etc/passwd` Enter.
  ** "Error: web app URL must be http or https." Failed (exit code 1). Press a key.
  * Install → Web App; Name `Sneak` Enter, URL `https://example.com --user-agent=x` Enter.
  ** "Error: web app URL must not contain whitespace." Failed (exit code 1). Press a key.
  * Press Super+Alt+Space and type "bad", then "sneak".
  ** No matches for either. Escape twice.
  * Press Super+Enter and type `omarchy-webapp-install Foo https://nonexistent.invalid ""; echo rc=$?` Enter.
  ** "Error: Failed to download icon." rc=1. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The slash check fires before any network access, so the first refusal is instant.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three refusal messages, the empty launcher searches, the icon error line.
  * If unsuccessful
  ** Screenshot of a launcher created despite bad input.
covers: bin/omarchy-webapp-install require_plain_name/require_http_url/download_icon, webapp-name-test.sh, webapp-install-test.sh

### webapp-install-duplicate-name-overwrites   [VM-OK]
description: Installing a web app under an existing name silently replaces the old one rather than warning, so the launcher ends with a single entry pointing at the new URL.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-webapp-install "Dup Test" https://one.example basecamp; echo rc=$?` Enter.
  ** rc=0.
  * Type `omarchy-webapp-install "Dup Test" https://two.example basecamp; echo rc=$?` Enter.
  ** rc=0 with no warning.
  * Type `grep Exec ~/.local/share/applications/Dup\ Test.desktop; ls ~/.local/share/applications | grep -c "Dup Test"` Enter.
  ** The Exec line shows two.example and the count is 1.
  * Press Super+Space, type "dup".
  ** One "Dup Test" row with the Basecamp icon. Escape twice.
  * In the terminal type `omarchy-webapp-remove "Dup Test"` Enter.
  ** Toast "Web app removed — Dup Test". Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The silent overwrite is current behaviour; the test records it rather than failing on it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshot with both rc=0 lines, the Exec line and count 1; the single launcher row; the removal toast.
  * If unsuccessful
  ** Terminal output at the failing step.
covers: bin/omarchy-webapp-install (argv path, icon_name_from_ref), bin/omarchy-webapp-remove

### webapp-remove-via-menu-and-cli   [VM-OK]
description: Remove → Web App removes the chosen web app with a toast while its chord keeps working, and the CLI stays quiet on an unknown name or an empty directory.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Remove → Web App, type "you", Enter on YouTube.
  ** Toast "Web app removed — YouTube".
  * Press Super+Alt+Space and type "youtube".
  ** No matches. Escape twice.
  * Press Super+Shift+Y.
  ** youtube.com still opens as a web app (the chord is independent of the launcher entry). Close it.
  * Press Super+Enter and type `omarchy-webapp-remove "Nope Not Here"; echo rc=$?` Enter.
  ** A toast still appears and rc=0 (current behaviour; record it).
  * Type `mkdir -p /tmp/emptyapps && omarchy-webapp-remove-all /tmp/emptyapps` Enter.
  ** "Scanning for web apps in /tmp/emptyapps..." then "No web apps found."
  * Type `omarchy-refresh-applications` Enter and reopen Remove → Web App.
  ** YouTube is listed again. Escape; close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts disappear after a few seconds; screenshot immediately after Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: picker, toast, empty search, YouTube window, CLI outputs, restored picker.
  * If unsuccessful
  ** Screenshot of the picker or terminal at failure.
covers: bin/omarchy-webapp-remove, bin/omarchy-webapp-remove-all, omarchy-menu.jsonc remove.webapp, applications.lua:27

### webapp-handlers-mailto-and-zoom   [VM-OK] [NET]
description: mailto: links open HEY's compose page and zoommtg: links open Zoom's web client for the meeting, through the shipped handler entries.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `xdg-open mailto:test@example.com` Enter.
  ** A chromeless window opens on app.hey.com (compose page, or a HEY login). Its title shows HEY.
  * Click the terminal and type `hyprctl activewindow | grep -i title` Enter.
  ** The title line names app.hey.com or HEY. Close the web window.
  * Type `xdg-open 'zoommtg://zoom.us/join?confno=1234567890&pwd=abc'` Enter.
  ** A chromeless Zoom window opens. Click the terminal and run the same hyprctl line: the title names Zoom / app.zoom.us join. Close it.
  * Type `omarchy-webapp-handler-zoom` Enter.
  ** Zoom's web home opens. Close it and the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * App-mode windows show no address bar, so the window title (from hyprctl) is the only place the target shows.
  * Sites may show login pages; only the host matters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each window and the terminal title lines naming HEY and Zoom.
  * If unsuccessful
  ** Screenshot of the wrong page or a terminal error.
covers: bin/omarchy-webapp-handler-hey, bin/omarchy-webapp-handler-zoom, applications/HEY.desktop, applications/Zoom.desktop, default/applications/mimeapps.list

### preinstalled-webapp-chords-and-focus   [VM-OK] [NET]
description: The Super+Shift web-app chords open their sites as app windows, and the focus-type chords re-focus an existing window instead of opening a second.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Y.
  ** App window on youtube.com. Screenshot; close with Super+W.
  * Press Super+Shift+A, then Super+Shift+E, then Super+Shift+X, screenshotting and closing each.
  ** chatgpt.com, app.hey.com, x.com respectively.
  * Press Super+Shift+Alt+G (WhatsApp).
  ** web.whatsapp.com window. Press Super+Shift+Alt+G again.
  ** The same single window is focused; no second WhatsApp window on screen.
  * Press Super+Shift+P twice.
  ** Still one Google Photos window. Close all windows; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Pages will be login screens; the window title identifies the site.
  * Two windows would tile side by side; one window fills the workspace.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per chord; screenshots after the repeated WhatsApp and Photos chords showing a single window.
  * If unsuccessful
  ** Screenshot showing two WhatsApp windows or a chord that opened nothing.
covers: default/hypr/bindings/applications.lua:22-33, bin/omarchy-launch-or-focus-webapp, browser.lua

### agent-chord-without-default-opens-picker   [VM-OK]
description: With no default agent shipped, the Agent chord and the agents bar widget open the Default Agent picker with nothing checked instead of launching anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Ctrl+A.
  ** The menu opens at "Default Agent…" with 14 rows and no ✓. Escape.
  * Find the agents widget in the bar's right section (robot glyph 󰚩) and right-click it.
  ** The same Default Agent submenu opens. Escape.
  * Left-click the widget.
  ** A panel toggles open (no usage data, or a prompt to set an agent). Click again to close.
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not press Enter on an agent row; that starts a network install.
  * Screenshot first to locate the widget; it sits between the tray and the Bluetooth/network icons.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Default Agent submenu with no ✓ (from the chord and from the right click) and the agents panel.
  * If unsuccessful
  ** Screenshot of an agent terminal opening unexpectedly or nothing opening.
covers: bin/omarchy-agent --pick, utilities.lua:97, agents-panel-test.sh, omarchy-menu.jsonc setup.default.agent.*

### agent-cli-without-default-explains   [VM-OK]
description: The agent commands explain what to do when no default agent is set and reject wrong arguments, instead of failing obscurely.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy agent; echo rc=$?` Enter.
  ** "Choose default agent with: omarchy default agent <name>" rc=1; no window opens.
  * Type `omarchy agent prompt "hello"; echo rc=$?` Enter.
  ** Same message, rc=1.
  * Type `omarchy agent hello; echo rc=$?` Enter.
  ** "Unexpected argument: hello" and "To pass a prompt: omarchy agent prompt \"hello\"", rc=1.
  * Type `omarchy agent crash abc; echo rc=$?` Enter.
  ** "Not a PID: abc" plus the usage hint, rc=1.
  * Type `omarchy-default-agent bogus; echo rc=$?` Enter.
  ** Usage line listing the agent names, rc=1. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output fits on screen; no serial needed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshot with each message and rc=1.
  * If unsuccessful
  ** Screenshot of a different message or a window opening.
covers: bin/omarchy-agent, bin/omarchy-agent-prompt, bin/omarchy-agent-crash, bin/omarchy-default-agent

### agent-default-selection-starts-install   [VM-PARTIAL] [NET] [SLOW]
description: Choosing a default agent that is only a stub opens a floating terminal that installs it, and aborting leaves no default set and no ✓.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Defaults → Agent → Pi.
  ** A floating Omarchy terminal runs the Pi install through mise (download output). Take screenshots for up to 30 seconds.
  * Press Ctrl+C in that terminal.
  ** It closes.
  * Press Super+Enter and type `omarchy-default-agent; echo "[$(omarchy-default-agent)]"` Enter.
  ** Prints `[]`.
  * Press Super+Space → Setup → Defaults → Agent, Escape, and open it again.
  ** Still no ✓ on any row. Escape.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the install finishes before you abort, Pi launches inline and `[pi]` will print; then type `rm ~/.config/omarchy/defaults/agent` in a terminal to restore stock state and note it.
  * Skipped: completing the install and using the agent (size unknown, likely over a minute).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the install terminal; the `[]` line; the Agent submenu with no ✓.
  * If unsuccessful
  ** Screenshot of "Could not install Pi with mise" or of Pi ✓ after an aborted install.
covers: bin/omarchy-default-agent, install/user/mise.sh, omarchy-menu.jsonc setup.default.agent.pi

### agent-usage-update-without-auth   [VM-OK] [NET]
description: The agent usage collectors fail per agent with a clear line when nobody is logged in, and any record they do write is valid JSON.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy agent usage-update; echo rc=$?` Enter.
  ** Lines like "omarchy-agent-usage-update: claude collector failed" may print; rc is 1 if any failed, else 0. No Python traceback.
  * Type `for f in ~/.local/state/omarchy/agents/usage/*.json; do jq -e . "$f" >/dev/null && echo "ok $f"; done` Enter.
  ** Every existing file prints ok (or there are no files).
  * Type `omarchy agent usage-update --except claude codex; echo rc=$?` Enter.
  ** At most one "codex collector failed" line.
  * Type `omarchy-agent-usage-claude --help | head -3` Enter.
  ** Help text mentioning --force and --limits-only. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Collectors probe the network and may take several seconds each; wait with screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots of the update output, the ok lines, the --except run, the help text.
  * If unsuccessful
  ** Terminal showing a traceback.
covers: bin/omarchy-agent-usage-update, bin/omarchy-agent-usage-{claude,codex,fireworks}

### agent-invitation-notification   [VM-PARTIAL]
description: The one-time "Set your default agent" invitation opens the Default Agent picker when clicked, does not repeat, and stays quiet once an agent is chosen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `rm -f ~/.local/state/omarchy/done/agent-setup-invitation; bash ~/.config/omarchy/hooks/post-update.d/setup-agent.hook` Enter.
  ** A critical notification "Set your default agent — Let your favorite agent help with Omarchy." appears.
  * Click the notification.
  ** The menu opens at "Default Agent…". Escape.
  * Run the same hook command again (without the rm).
  ** No new notification.
  * Type `printf 'pi\n' > ~/.config/omarchy/defaults/agent; rm -f ~/.local/state/omarchy/done/agent-setup-invitation; bash ~/.config/omarchy/hooks/post-update.d/setup-agent.hook; ls ~/.local/state/omarchy/done/` Enter.
  ** No notification, and agent-setup-invitation is not in the listing.
  * Type `rm ~/.config/omarchy/defaults/agent` Enter; close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the hook path is missing, use `$OMARCHY_PATH/install/user/first-run/setup-agent.hook` instead.
  * Skipped: the genuine first-boot trigger (the disk has already booted once).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the notification, the Default Agent submenu after the click, no repeat, and the terminal listing.
  * If unsuccessful
  ** Screenshot of a repeated notification or none after re-arming.
covers: install/user/first-run/setup-agent.hook, agent-invitation-test.sh

### games-retro-install-without-cores   [VM-OK]
description: The RetroArch game launcher creator tells the user there are no cores instead of showing an empty picker, and the command validates its arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Gaming → RetroArch Game Launcher.
  ** Notification "No RetroArch cores found — /usr/lib/libretro"; no picker.
  * Press Super+Enter and type `omarchy-games-retro-install a; echo rc=$?` Enter.
  ** Usage and example lines, rc=1.
  * Type `omarchy-games-retro-install snes9x /tmp/nogame.sfc; echo rc=$?` Enter.
  ** "Game not found: /tmp/nogame.sfc" rc=1.
  * Type `touch /tmp/game.sfc; omarchy-games-retro-install snes9x /tmp/game.sfc; echo rc=$?` Enter.
  ** "Core not found: /usr/lib/libretro/snes9x_libretro.so" rc=1.
  * Press Super+Alt+Space and type "game".
  ** No new launcher row. Escape twice; close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The notification is brief; screenshot right after selecting the row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the notification; terminal with the three errors and rc values; empty launcher search.
  * If unsuccessful
  ** Screenshot of an empty picker or a launcher created without a core.
covers: bin/omarchy-games-retro-cores, bin/omarchy-games-retro-install, omarchy-menu.jsonc install.gaming.retro-launcher

### chromium-webapp-shortcuts-listed   [VM-PARTIAL]
description: The Copy URL and Download Video shortcuts for web apps are advertised in the keybindings viewer and send their chord to the focused web app when picked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K and type "Web App".
  ** Rows "SHIFT ALT + L → Copy URL from Web App" and "SHIFT ALT + D → Download Video from Web App". Escape.
  * Press Super+Shift+Y and, with the YouTube window focused, press Shift+Alt+L.
  ** If the bundled Chromium extension is active a toast "URL copied to clipboard" appears; otherwise nothing. Record which.
  * Press Super+K, type "Copy URL", Enter.
  ** Same outcome as the direct chord.
  * Press Super+Enter and type `wl-paste` Enter.
  ** Report the clipboard content. Close the terminal and the YouTube window; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: the yt-dlp download itself (needs a real video and time); the toast is the observable half.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the two rows; toast or an explicit note of its absence; wl-paste output.
  * If unsuccessful
  ** Screenshot of the viewer missing the rows.
covers: bin/omarchy-menu-keybindings static_bindings/dispatch_sendshortcut_binding, bin/omarchy-chromium-copy-url-host, bin/omarchy-chromium-ytdlp-host

### default-browser-editor-missing-opens-installer   [VM-PARTIAL] [NET]
description: Choosing a default browser, editor or terminal that is not installed opens its installer instead of pointing the default at nothing, and aborting keeps the previous default.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Defaults → Browser → Firefox.
  ** A floating Omarchy terminal starts installing Firefox. Press Ctrl+C.
  * Setup → Defaults → Editor → Vim.
  ** Installer terminal. Ctrl+C.
  * Setup → Defaults → Terminal → Kitty.
  ** Installer terminal. Ctrl+C.
  * Open Setup → Defaults → Browser, Escape, open it again.
  ** Chromium still ✓, Firefox unmarked; likewise Neovim ✓ and Alacritty ✓ in their lists.
  * Press Super+Enter and type `omarchy-default-browser; omarchy-default-editor; omarchy-default-terminal` Enter.
  ** chromium, nvim, alacritty. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+C at the first pacman/sudo prompt; nothing is downloaded.
  * Skipped: completing an install and confirming the new default launches.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three installer terminals; the ✓ marks unchanged; the terminal line with the three defaults.
  * If unsuccessful
  ** Screenshot of a "… is now the default" toast without the app installed, or a moved ✓.
covers: bin/omarchy-default-browser, bin/omarchy-default-editor, bin/omarchy-default-terminal, default-apps-test.sh

### menu-select-and-input-cli   [VM-OK]
description: Scripts can use the menu as a picker or text prompt: a pick prints the choice, Escape exits 1 with nothing printed, and glyph/subtext rows return a stable key.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy menu select Format jpg png webp; echo rc=$?` Enter.
  ** Picker "Format…" with jpg, png, webp. Move to png, Enter: the terminal prints png and rc=0.
  * Run the same command and press Escape.
  ** Nothing printed, rc=1.
  * Type `printf '󰋊\tDisk\tsda\n󰋊\tDisk\tsdb\n' | omarchy menu select Drive` Enter and pick the second row.
  ** Two rows both labelled Disk with subtexts sda/sdb; the terminal prints Disk followed by a tab and sdb.
  * Type `omarchy menu input "Your name"; echo rc=$?` Enter, type `prime` Enter.
  ** Prints prime, rc=0. Run it again and press Escape: rc=1.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker steals focus; the terminal output appears once the picker closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each picker and the terminal lines with the printed values and rc.
  * If unsuccessful
  ** Terminal output at the failing command.
covers: bin/omarchy-menu-select, bin/omarchy-menu-input, docs/menu.md select/input modes

### menu-file-and-images-pickers   [VM-OK]
description: The file picker lists matching files newest first and the image picker shows a thumbnail grid, and both refuse missing arguments or paths.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy menu file "Pick" /nonexistent "png"; echo rc=$?` Enter.
  ** "Path not found: /nonexistent" rc=1.
  * Type `omarchy menu file "Pick a background" ~/.config/omarchy/current/theme/backgrounds "jpg png webp"` Enter.
  ** A picker listing background paths; Enter on one prints its path.
  * Type `omarchy-menu-images; echo rc=$?` Enter.
  ** Usage line, rc=1.
  * Type `omarchy-menu-images --print-name ~/.config/omarchy/current/theme/backgrounds` Enter.
  ** A grid of thumbnails; select one with arrows and Enter: the name without extension prints.
  * Run it again and press Escape.
  ** Nothing printed. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first image grid open generates thumbnails and may take a few seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the errors, the file picker, the image grid, the printed name.
  * If unsuccessful
  ** Terminal output; "Image selector failed to accept request" indicates a shell IPC problem.
covers: bin/omarchy-menu-file, bin/omarchy-menu-images, menu-images-test.sh

### menu-plugin-disable-and-enable   [VM-OK]
description: Setup → Plugins lets the user switch a shell plugin off and back on through a picker, and the bar widget disappears and returns accordingly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot of the bar noting the weather widget in the center.
  * Press Super+Space → Setup → Plugins → Disable Plugin.
  ** Picker "Disable plugin…" lists plugin names with their id as subtext. Type "weather", Enter.
  ** The weather widget is gone from the bar.
  * Press Super+Space → Setup → Plugins → Enable Plugin, type "weather", Enter.
  ** The widget is back.
  * Press Super+Enter and type `omarchy-menu-plugin bogus; echo rc=$?` Enter.
  ** Usage line, rc=1. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar plugin itself is never offered under Disable; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar with and without the weather widget and the picker rows with subtext; the usage line.
  * If unsuccessful
  ** Screenshot of the bar unchanged after disable or an empty picker.
covers: bin/omarchy-menu-plugin enable/disable, omarchy-menu.jsonc setup.plugin.*, menu-plugin-test.sh

### menu-plugin-clone-and-remove   [VM-OK]
description: Cloning a first-party plugin opens the copy in an editor and makes Remove Plugin appear; removing the clone hides that row again and reports when nothing is left to remove.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-menu-plugin remove; echo rc=$?` Enter.
  ** Notification "No plugin to remove", rc=0.
  * Press Super+Space → Setup → Plugins → Clone Plugin, type "clock", Enter.
  ** A floating terminal runs the clone and opens an editor on the copy. Quit the editor (`:q` Enter) and press a key if a Done prompt shows.
  * Press Super+Space → Setup → Plugins, Escape, and open it again.
  ** "Remove Plugin" is now listed. Select it and pick the cloned clock.
  ** A floating terminal removes it; press a key to close.
  * Reopen Setup → Plugins twice.
  ** Remove Plugin is gone. Escape; close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Remove Plugin row is guarded; reopen the submenu twice after cloning or removing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "No plugin to remove" toast, the clone editor, Remove Plugin present, the removal terminal, Remove Plugin absent.
  * If unsuccessful
  ** Screenshot of the row not appearing or the clone failing.
covers: bin/omarchy-menu-plugin clone/remove, omarchy-menu.jsonc setup.plugin.clone / setup.plugin.remove, menu-plugin-test.sh

### menu-timezone-from-menu-and-terminal   [VM-OK]
description: Update → Timezone sets the system timezone and updates the clock; the menu path runs sudo without a terminal, so this records whether it works on a stock install while the terminal path must.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Note the bar clock. Press Super+Space → Update → Timezone, type "Tokyo", Enter on Asia/Tokyo.
  ** On success a toast "Timezone is now set to Asia/Tokyo" and the clock jumps. If neither happens within five seconds, report "menu path silently failed (sudo without tty)".
  * Press Super+Enter and type `omarchy-menu-timezone` Enter; in the picker type "London", Enter.
  ** A sudo password prompt appears in the terminal; type prime Enter.
  ** Toast "Timezone is now set to Europe/London" and the clock changes.
  * Type `timedatectl show -p Timezone --value` Enter.
  ** Europe/London.
  * Repeat the terminal path choosing your original zone (e.g. "UTC" or what the clock showed at start) to restore it.
  * Run `omarchy-menu-timezone` once more and press Escape in the picker.
  ** Nothing changes. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker filters as you type; Asia/Tokyo may not be the first row, use Down to reach it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the toast, the bar clock before/after, the timedatectl line; an explicit statement whether the menu path worked.
  * If unsuccessful
  ** Terminal screenshot after the menu attempt; `./client get-serial`.
covers: bin/omarchy-menu-timezone, omarchy-menu.jsonc update.timezone (Observation 4)

### menu-share-picker-cancel   [VM-PARTIAL]
description: Trigger → Share opens a file chooser for LocalSend and cancelling does nothing, while Receive opens LocalSend as a centered floating window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+S.
  ** Share submenu: Clipboard, File, Folder, Receive. Select File.
  ** A "Share files" chooser dialog floats in the middle. Click Cancel; no toast, nothing else opens.
  * Press Super+Ctrl+S → Folder.
  ** "Share folder" chooser. Cancel.
  * Press Super+Ctrl+S → Receive.
  ** The LocalSend window opens floating and centered (about 1100×700). Close it with Super+W.
  * Press Super+Enter and type `omarchy-menu-share; echo rc=$?` Enter.
  ** "Usage: omarchy-menu-share [clipboard|file|folder]" rc=1. Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: an actual transfer (needs a second LocalSend peer).
  * The chooser is a GTK portal dialog; Cancel is bottom-left or top-left.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both chooser dialogs, the LocalSend window, the usage line.
  * If unsuccessful
  ** Screenshot of a "Could not share — The file chooser did not open" toast or a missing LocalSend window.
covers: bin/omarchy-menu-share, omarchy-menu.jsonc trigger.share.*, localsend.lua

### menu-emoji-picker-inserts   [VM-OK]
description: The emoji picker opens from Trigger → Emoji or Super+Ctrl+E, and picking an emoji inserts it at the cursor of the focused terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo ` (with the trailing space, no Enter).
  * Press Super+Ctrl+E.
  ** The emoji picker overlay opens. Type "smile", Enter on the first result.
  ** The picker closes and the emoji appears after `echo ` in the terminal. Press Enter; the emoji is echoed.
  * Press Super+Ctrl+E twice.
  ** Opens, then closes (toggle).
  * Press Super+Space → Trigger → Emoji.
  ** The same picker opens. Escape.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Insertion uses Shift+Insert paste; give it a second before screenshotting the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker and of the emoji in the terminal line and its echo.
  * If unsuccessful
  ** Screenshot showing the emoji not inserted or the overlay not opening.
covers: bin/omarchy-menu-emoji, bin/omarchy-menu-emoji-insert, utilities.lua:3, omarchy-menu.jsonc trigger.emoji

### clipboard-manager-toggle   [VM-OK]
description: Super+Ctrl+V and `omarchy menu clipboard` toggle the clipboard manager, which lists recent copies newest first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo clip-one | wl-copy; echo clip-two | wl-copy` Enter.
  * Press Super+Ctrl+V.
  ** The clipboard manager overlay shows clip-two above clip-one. Escape.
  * Type `omarchy menu clipboard` Enter.
  ** The same overlay opens. Run the command again (click the terminal first): it closes.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The overlay takes focus; click back into the terminal before typing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the overlay with the two entries in order; screenshot of it closed after the second command.
  * If unsuccessful
  ** Screenshot of the overlay not opening or missing entries.
covers: bin/omarchy-menu-clipboard, clipboard.lua:48

### tui-shortcut-create-launch-remove   [VM-OK]
description: Install → TUI creates a launcher for a terminal program that then appears in the app launcher and opens floating, and Remove → TUI deletes it with a toast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → TUI.
  ** Floating terminal "Let's create a TUI shortcut…" with "Name>". Type `Top Test` Enter; "Launch Command>" `top` Enter; choose float; "Icon URL/name>" `utilities-terminal` Enter.
  ** "Done! Press any key to close...". Press a key.
  * Press Super+Alt+Space and type "top test", Enter.
  ** A floating terminal running top opens. Press q.
  * Press Super+Space → Remove → TUI and pick "Top Test".
  ** Toast "TUI removed — Top Test".
  * Press Super+Alt+Space and type "top test".
  ** No matches. Escape twice; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The window style prompt is a two-item chooser; arrow to float and Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompts, the top window floating, the removal toast, the empty search.
  * If unsuccessful
  ** Screenshot of the terminal error.
covers: omarchy-menu.jsonc install.tui / remove.tui, bin/omarchy-tui-install, bin/omarchy-tui-remove, system.lua TUI.float

### menu-extension-row-and-broken-file   [VM-OK]
description: A user extension adds rows to the menu without restarting the shell, a row whose command is missing fails harmlessly, and a broken extension file drops only the user's rows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p ~/.config/omarchy/extensions && printf '"zz-test": {"icon":"","label":"ZZ Test","action":"omarchy-no-such-command"},\n' > ~/.config/omarchy/extensions/omarchy-menu.jsonc` Enter.
  * Press Super+Space (if the row is missing, type `omarchy menu refresh` Enter in the terminal and reopen).
  ** A last row "ZZ Test" on the root menu. Select it.
  ** The menu closes; nothing else happens; Super+Space opens the menu again fine. Escape.
  * Type `printf '{ not json' > ~/.config/omarchy/extensions/omarchy-menu.jsonc; omarchy menu refresh` Enter and press Super+Space.
  ** All ten shipped root rows present, "ZZ Test" gone. Escape.
  * Type `printf '// empty\n' > ~/.config/omarchy/extensions/omarchy-menu.jsonc; omarchy menu refresh` Enter.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell watches the extension file; the refresh command is only a fallback.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: root with ZZ Test; menu working after selecting it; root without ZZ Test after the broken file.
  * If unsuccessful
  ** Screenshot of a missing bar or a menu that will not open; `./client get-serial`.
covers: docs/menu.md Load and merge, bin/omarchy-menu refresh

### menu-config-editor-entries-open-files   [VM-OK]
description: Every config-editor row in Setup and Style opens its own file in the editor with the "Editing config file" toast, so users never edit the wrong config.
instruction: |
  <Instructions>
  From the desktop please do the following, for each row opening it, screenshotting the toast and the editor's filename, then quitting with `:q` Enter:

  <ActionList>
  * Super+Space → Setup → Keybindings → bindings.lua
  * Setup → Input → input.lua
  * Setup → Config → Hyprland → hyprland.lua
  * Setup → Config → Hyprsunset → hyprsunset.conf
  ** After quitting, hyprsunset restarts silently; no error toast.
  * Setup → Config → XCompose → .XCompose (may be empty)
  * Style → Hyprland → looknfeel.lua
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The filename is in Neovim's bottom status line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Six screenshots each showing the toast path and Neovim's status line with the same filename.
  * If unsuccessful
  ** Screenshot of a row that opened nothing or the wrong file.
covers: omarchy-menu.jsonc setup.keybindings/input/config.*, style.hyprland, bin/omarchy-launch-config-editor, config/hypr/*

### menu-remove-preinstalls-cancel   [VM-OK]
description: Remove → Preinstalls asks for confirmation before wiping preinstalled apps, and declining leaves every web app and TUI in place.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Remove → Preinstalls.
  ** Floating terminal: "Are you sure you want to remove all preinstalled web apps, TUI wrappers, and desktop applications?" with Yes/No.
  * Choose No.
  ** The terminal ends with a Done/Failed line; press a key.
  * Press Super+Alt+Space and type "youtube", then "docker".
  ** Both rows still present. Escape twice.
  * Press Super+Space → Install.
  ** Preinstalls still dimmed ✓; Remove still lists Preinstalls. Escape; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do NOT answer Yes; it removes the agent stubs and web apps other tests rely on.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the confirm prompt, the terminal end, the two app rows, the menu rows unchanged.
  * If unsuccessful
  ** Screenshot showing web apps removed after No.
covers: bin/omarchy-remove-preinstalls, omarchy-menu.jsonc remove.preinstalls / install.preinstalls

### menu-toggle-rows-menu-bar-and-gaps   [VM-OK]
description: Trigger → Toggle rows flip visible desktop state: Menu Bar hides and shows the bar, Window Gaps changes tiling gaps, each reversible from the menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter twice so two terminals tile side by side.
  * Press Super+Ctrl+O → Window Gaps.
  ** The gaps between windows and screen edge change. Super+Ctrl+O → Window Gaps again restores them.
  * Press Super+Ctrl+O → Menu Bar.
  ** The bar hides. Press Super+Ctrl+O again (the menu still works) and select Menu Bar.
  ** The bar returns.
  * Close one terminal, press Super+Ctrl+O → 1-Window Ratio.
  ** The remaining window becomes narrower and centered. Toggle it again to restore.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar does not return, type `omarchy-toggle-bar` in a terminal and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots for gaps, bar and ratio, each restored.
  * If unsuccessful
  ** Screenshot showing the bar not returning.
covers: omarchy-menu.jsonc trigger.toggle.top-bar / window-gaps / one-window-ratio

### about-branding-restore-default   [VM-OK]
description: Style → About → Edit Text rebrands the About logo and About re-fits to it; Restore Default brings the stock logo and size back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → About; note the logo; press a key to close.
  * Press Super+Space → Style → About → Edit Text.
  ** An editor opens on about.txt. Type `ggdG` then `i`, type HELLO Enter WORLD Enter !!!, press Escape, type `:wq` Enter.
  * Press Super+Space → About.
  ** The logo area shows HELLO / WORLD / !!! and the window is smaller. Close it.
  * Press Super+Space → Style → About → Restore Default, then Super+Space → About.
  ** The stock logo is back at its original size. Close it.
  * Press Super+Space → Style → About → Set From Image, then Escape in the picker.
  ** Nothing changes; About still shows the stock logo. Desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * About closes on any key, so take the screenshot before pressing anything.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of About stock, About with HELLO/WORLD, About restored, the cancelled picker.
  * If unsuccessful
  ** Screenshot of About clipped or scrolled after rebranding.
covers: omarchy-menu.jsonc style.about.*, bin/omarchy-launch-about (fit on logo change)

### menu-picker-cancel-changes-nothing   [VM-OK]
description: Menu rows that open a picker (Theme, Background, Unlock, Remove Web App, Disable Plugin) treat Escape as "do nothing", never applying a default choice.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot of the desktop (wallpaper, bar, colours).
  * Press Super+Space → Style → Theme, then Escape.
  ** Theme unchanged.
  * Super+Space → Style → Background, then Escape.
  ** Wallpaper unchanged.
  * Super+Space → Style → Unlock, then Escape.
  ** No floating terminal opens.
  * Super+Space → Remove → Web App, then Escape; Super+Alt+Space, type "youtube".
  ** YouTube still listed. Escape twice.
  * Super+Space → Setup → Plugins → Disable Plugin, then Escape.
  ** Bar unchanged. Compare with the first screenshot; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each picker is a dmenu-style card; a single Escape closes it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each picker and a final desktop screenshot matching the first.
  * If unsuccessful
  ** Screenshot of a change applied after Escape (theme switched, toast, terminal opened).
covers: bin/omarchy-menu-select exit 1 on cancel; omarchy-menu.jsonc style.theme/background/unlock, remove.webapp, setup.plugin.disable

### omarchy-terminal-window-rules   [VM-OK]
description: Omarchy's own terminal windows get the right rules: presentation terminals and float TUIs open centered and floating, tile TUIs tile, and About opens wider than the standard float.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-launch-floating-terminal-with-presentation 'sleep 20'` Enter.
  ** A floating centered window of about 875×600 sits over the tiled terminal. Press Ctrl+C in it.
  * Type `xdg-terminal-exec --app-id=TUI.float -e sleep 20` Enter.
  ** Another floating centered window of the same size. Press Ctrl+C in it.
  * Type `xdg-terminal-exec --app-id=TUI.tile -e sleep 20` Enter.
  ** This one tiles beside the first terminal, not floating. Press Ctrl+C in it.
  * Type `omarchy-launch-about` Enter.
  ** About floats, visibly wider than the 875-pixel floats. Press a key to close.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Floating windows have a border and sit over the tiled one; tiled windows split the screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two floating windows, the tiled one, and About.
  * If unsuccessful
  ** Screenshot of a presentation terminal tiled full width or About at the small float size.
covers: default/hypr/apps/system.lua (floating-window tag, org.omarchy.about, TUI.float), terminals.lua, bin/omarchy-launch-tui

### mimeapps-defaults-open-right-apps   [VM-OK]
description: The shipped file associations send images to imv, folders to Files, links to Chromium and text to Neovim when opened with xdg-open.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `xdg-open ~/.config/omarchy/current/theme/backgrounds/$(ls ~/.config/omarchy/current/theme/backgrounds | head -1)` Enter.
  ** imv opens the image in a floating window. Press q.
  * Type `xdg-open /tmp` Enter.
  ** Files (Nautilus) opens at /tmp. Close it with Super+W.
  * Type `xdg-open https://example.com` Enter.
  ** Chromium (tabbed, with address bar) opens example.com. Close it.
  * Type `echo hi > /tmp/t.txt; xdg-open /tmp/t.txt` Enter.
  ** Neovim opens /tmp/t.txt in a terminal. Type `:q` Enter.
  * Close the terminal; desktop as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the terminal to refocus it after each app opens.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of imv, Files, Chromium and Neovim each on the given target.
  * If unsuccessful
  ** Screenshot of the wrong app or a "no application" error.
covers: default/applications/mimeapps.list, applications/imv.desktop, system.lua media opaque rules

## Gaps

- **Real hardware paths of guarded rows** (Laptop Display, Mirror Display, Hybrid GPU, Touchpad, Touchpad Haptics, Battery Percentage, Fingerprint, Wi-Fi QR Code, webcam recording): only the hidden state is testable here (`menu-hardware-guards-hide-rows`). VM-NO for the positive path.
- **Suspend / Hibernate / Reboot / Shutdown / Logout rows**: destructive or session-ending; Lock is covered. Reboot/Shutdown belong to whoever owns `omarchy-system-*`; a driver session cannot survive them meaningfully. VM-NO here.
- **Battle.net, Steam, RetroArch, Windows VM install/launch, Xbox Cloud, GeForce NOW**: multi-GB downloads and GPU/Proton needs. Only the not-installed error paths are proposed. VM-NO / SLOW.
- **Every `Install → …` and `Remove → …` action that actually installs/removes software** (browsers, editors, AI desktops, services, dev envs, fonts, themes): each is a `omarchy-launch-floating-terminal-with-presentation <installer>`; the menu wiring is covered by the submenu-listing tests and one abort each, but end-to-end installs exceed the time budget and are other reviewers' scripts. NET/SLOW.
- **Agent happy path** (launching an installed agent, `omarchy agent prompt`, `omarchy agent crash <pid>` against a real core dump, usage panel with a logged-in agent): needs an agent installed and authenticated; only the negative paths are proposed.
- **`omarchy-chromium-ytdlp-host` download flow** and **`omarchy-chromium-copy-url-host` reply framing**: driven by the bundled Chromium extension over native messaging; the observable toast is included in `chromium-webapp-shortcuts-listed` but the download itself needs a real video URL and time.
- **`omarchy-menu-emoji-insert` into non-terminal apps** (GTK/Chromium text fields): wtype Shift+Insert semantics differ per toolkit; only the terminal case is tested.
- **Screenrecording rows** (`With no audio`, `With desktop audio`, `+ microphone`): no audio device; gpu-screen-recorder without 3D acceleration is likely to fail — belongs to the capture reviewer; the `Stop Screenrecording` guard cannot be shown because recording cannot start.
- **Speed Test → Network Speed Test**: needs sustained outbound bandwidth; result unpredictable. Disk Speed Test is included instead.
- **Fonts provider action** (selecting a font applies it system-wide, restarts shell/terminals): listing and ✓ are tested; applying belongs to the theme/font reviewer.
- **`Update → Password → Drive Encryption / User`**, **`Setup → Direct Boot`**, **`Setup → Reset Computer`**, **`Update → Channel → *`**, **`Update → Omarchy`**, **`Update → Firmware`**: state-changing on the disk or credential-changing; listed in inventory, not exercised.
- **Extension merge semantics** beyond one added row and one broken file (overriding a shipped id's label, `target` links, `description` search text): no shipped entry uses `target`; could be added as a follow-up VM-OK test if the format owner wants deeper coverage.
- **Multi-monitor screensaver** (one window per monitor) and **XF86PowerOff → power menu**: single display, no power key in the guest. VM-NO.
- **Battery notification chord** (`Super+Ctrl+Alt+B`) and **lid switch bindings**: no battery/lid. VM-NO.
