# 60 — omacom organisation projects beyond the `omarchy` repo

Reviewer scope: everything under https://github.com/omacom other than `omarchy` itself (and other than
the ISO installer, which another reviewer owns). The question answered for each project is: does it ship
on a minted Omarchy disk, is it installable from inside Omarchy, or is it not reachable from Omarchy at
all — and if it is reachable, how does a user get to it and what does it do.

## Scope

Omarchy source (`/tmp/omarchy-review/omarchy`, HEAD `d174d4a` 2026-09-18, `version` = `4.0.0.alpha`):

| file | lines | why |
|---|---|---|
| `install/omarchy-base.packages` | 153 | what the ISO pacstraps — the "ships by default" list |
| `install/omarchy-other.packages` | 74 | hardware/boot packages the ISO builder mirrors |
| `default/omarchy/omarchy-menu.jsonc` | 380 | every menu path (Install → Package/AUR/Style → Theme, Setup → Plugins, Learn → Herdr, System → Screensaver, Remove → Preinstalls) |
| `default/hypr/bindings/applications.lua` | 34 | `Super+Shift+W` Omawrite, `Super+Ctrl+Return` Herdr |
| `default/hypr/bindings/utilities.lua` | 127 | `Super+Ctrl+Q` Omacalc, `Super+Ctrl+K` Herdr keys, capture keys |
| `default/hypr/bindings/media.lua`, `voxtype.lua` | 34, 5 | media keys; dictation binds gated on `voxtype` being present |
| `default/hypr/apps/system.lua` | 57 | window rules: `omacalc` floats, `dev.tensaku.Tensaku` floats/centres |
| `default/pacman/pacman-{stable,rc,edge}.conf`, `mirrorlist-*` | 30 each, 1 each | the `[omarchy]` repo (`pkgs.omarchy.org/<channel>`) and the Arch mirror (`stable-mirror.omarchy.org` / `mirror.omarchy.org`) |
| `bin/omarchy-pkg-install`, `-pkg-aur-install`, `-pkg-add` | 26, 30, 24 | how Install → Package / Install → AUR / `omarchy pkg add` work |
| `bin/omarchy-theme-install`, `-theme-set` (l.20-30, 225-300), `-theme-remove`, `-git-url-check` | 63, ~380, 40, ~50 | community theme install, the code-file drop list, URL refusal |
| `bin/omarchy-plugin-add`, `-plugin-clone`, `-plugin-catalog`, `-plugin-validate`, `-menu-plugin`, `-plugin-remove` | 175, 169, 62, ~100, 46, ~120 | third-party plugin lifecycle |
| `bin/omarchy-install-preinstalls`, `-remove-preinstalls` | 36, 55 | the org apps in the preinstall set (aether, omacut, omacalc, omawrite) |
| `bin/omarchy-capture-screenshot`, `-capture-screenrecording` | 82, 303 | confirms the default screenshot editor is **Tensaku** and the recorder is **gpu-screen-recorder**, not omasnap/omareel |
| `bin/omarchy-screensaver`, `-launch-screensaver`, `-system-lock` (l.1-40) | 48, 73 | ttfx is the screensaver engine |
| `bin/omarchy-launch-terminal-herdr`, `-menu-herdr-keybindings`, `-refresh-herdr`, `-restart-herdr`, `config/herdr/config.toml`, `default/bash/fns/herdr` | 5, 231, 6, 13, 95, 151 | Herdr integration, Omarchy's prefix (`Ctrl+Space`), `hdl/hds/hdlm/hsl` layouts |
| `bin/omarchy-voxtype-install`, `manual/11-text-extraction-dictation.md` | 26, 17 | dictation (voxtype is *not* an org project — noted for completeness) |
| `default/themed/neovim.lua.tpl`, `themes/lumon/neovim.lua` | ~55, ~10 | `aether.nvim` is the Neovim colorscheme for every theme; `lumon.nvim` for the Lumon theme |
| `migrations/1786273938.sh`, `1781286586.sh`, `1786952219.sh` | 19, 4, 17 | herdr packaged + seeded config; Satty → Tensaku; mise-bin swap that keeps omarchy-zsh/fish satisfied |
| `manual/22-guis.md`, `21-tuis.md`, `12-screenshots-recording.md`, `32-shell-plugins.md`, `43-making-your-own-theme.md`, `06-themes.md`, `49-omarchy-on.md`, `07-hotkeys.md` (grep) | 96, 51, 76, 104, 45, 127, 29 | user-facing descriptions and the exact chords/menu paths |
| `test/shell.d/preinstalls-test.sh`, `keybindings-menu-test.sh`, `plugin-registry-contract-test.sh`, `test/acceptance.d/apps-test.sh`, `shell-surfaces-test.sh` (grep) | — | existing tests that already touch omacalc/omawrite/omacut |
| `applications/*.desktop` | 16 files | none of them is an org app (they are web apps + foot/imv/mpv) |

Org side (`/tmp/omarchy-review/org-repos.json`, 61 repos; clones/fetches under `/tmp/omarchy-review/org/`):

- `omarchy-pkgs` cloned (`--depth 1`): `README.md`, `docs/upstream-sources.md`, all 145 `pkgbuilds/*/PKGBUILD` headers, full PKGBUILDs for `omarchy`, `omasnap`, `omareel`, `elsewhen`, `omacalc` (+ `.desktop`).
- The live `[omarchy]` repo databases: `https://pkgs.omarchy.org/stable/x86_64/omarchy.db` (238 packages) and `.../edge/...` (247) — this is what the minted disk's `pacman` actually sees.
- READMEs fetched raw for 44 repos (line counts in the inventory); `omareel/docs/USAGE.md`; herdr.dev quick-start; AUR RPC for `hype`, `owe`, `aether`, `herdr`; GitHub API (`fork`/`parent`) for `omasnap`, `herdr`, `aether`, `hype`, `owe`, `monologue`; `omarchy-theme-registry/themes/` directory (191 listed themes) and two entries (`ash`, `aonagi`) plus the contents of those two theme repos; DNS resolution of `themes.omarchy.org`, `cdn.themes.omarchy.org`, `plugins.omarchy.org`, `omarchyplugins.com`.

Skipped: `omarchy-iso` and `omarchy-configurator` (installer — another reviewer); `linux`, `mesa`, `m1n1`, `apple-bcm-firmware` (kernel/driver mirrors — hardware reviewers); the retired `omakub*`, `omamac*`, `omaterm*`, `website` (redirect stubs). Nothing was run in a guest; every claim below is from source, package databases and READMEs.

## Inventory

Legend: **ships** = on a minted disk out of the box · **installable** = reachable from inside Omarchy without leaving the desktop (OPR = the `[omarchy]` pacman repo built by `omarchy-pkgs`; AUR = via Install → AUR / `yay`; git = `omarchy plugin add` / `omarchy theme install`) · **not-in-omarchy** = no path from the desktop · **archived** = GitHub archive flag set.

**Desktop applications (Qt / Go)**

- **omacalc** — *ships* (`install/omarchy-base.packages` l.95; OPR stable `omacalc-0.2.2-1`, built by `omarchy-pkgs/pkgbuilds/omacalc` from `omacom-io/omacalc`). Reach: `Super+Ctrl+Q` or the `XF86Calculator` key (`utilities.lua` l.13-14); Apps menu "Omacalc"; command `omacalc`. Floats (`apps/system.lua` l.32). Features (README 44 l.): keypad with precedence, decimals, `%` (with pending `+`/`−` it is percent-of-total: `200 + 10 % =` → `220`), sign toggle, backspace; expression stays visible above the result; keyboard: digits/operators, `Enter`/`=`, `Backspace`, `C`/`Esc` clear, `S` sign, `Ctrl+C` copy result, `Ctrl+V` paste; follows theme colours live and desktop text size. Part of the Remove → Preinstalls set.
- **omawrite** — *ships* (base.packages l.97; OPR stable `omawrite-0.5.0-1`; `omacom-io/omawrite`). Reach: `Super+Shift+W` (`applications.lua` l.19, plain `launch`, so every press opens a new window); Apps menu; `omawrite`. Features (README 41 l.): Markdown editor, `Ctrl+S` save (portal file picker on first save), `Ctrl+Shift+S`, `Ctrl+O` open, `Ctrl+P` print, `Ctrl+N` new window, undo/redo, `Super+F` fullscreen, `Ctrl+F` find (`Enter`/`Ctrl+G` next, `Shift+Enter` prev), `Ctrl+H` replace, `Ctrl+B/I/K` bold/italic/link, `Ctrl+?` shortcut reference; draft recovery after abnormal exit; warns before an external change replaces local work. Preinstall set. Existing coverage: `test/acceptance.d/apps-test.sh` l.40, `shell-surfaces-test.sh` l.99-117.
- **omacut** — *ships* (base.packages l.96; OPR stable `omacut-0.4.0-1`; `omacom-io/omacut`). Reach: Apps menu "Omacut" only (no chord, `manual/22-guis.md` l.92-96); `omacut [file]`. Features (README 67 l.): open a video (portal picker), drag two handles, preview, export MP4 at Original/1080p/720p; `Space` play, `←/→` 1 s, `Shift` 5 s, `Alt` 0.2 s, `Ctrl+Space`/`Alt+Space` set start/end at playhead, `Z` zoom into selection, `Ctrl+O`, `Ctrl+S` export, `Q` quit (asks if un-exported), `?` hotkeys. Needs `ffmpeg`/`ffprobe` on PATH (present). Preinstall set.
- **aether** — *ships* (base.packages l.5; OPR stable `aether-4.29.9-1`; `omacom/aether`, Go + Wails/webkit2gtk, not a fork). Reach: Apps menu "Aether" (desktop id `io.github.taqi.aether.desktop`, `test/shell.d/app-search-test.sh` l.40); `manual/43` l.7 says `Super+Alt+Space`; CLI `aether --generate <img>`, `--apply-blueprint <name>`, `--list-blueprints`, `--help`. Features (README 160 l.): median-cut 16-colour extraction from a wallpaper, 8 modes, 12 sliders, light/dark; wallhaven + GitHub wallpaper browsers (NET); wallpaper editor; 24 presets + Base16 import; blueprints; 20+ app templates; icon-theme picker; WCAG checker; 50-step undo. Preinstall set.
- **aether.nvim** — *ships* indirectly: `default/themed/neovim.lua.tpl` l.3 makes `bjarneo/aether.nvim` (branch `v3`) the LazyVim colorscheme for every theme; `omarchy-nvim` (OPR) is a "pre-built LazyVim configuration with cached plugins". The org copy is `omacom-io/aether.nvim` (README 423 l.: base16 injection, 25+ plugin highlights, transparent bg, lualine). Reach: open `nvim`.
- **lumon.nvim** — *ships* indirectly: `themes/lumon/neovim.lua` l.3 pulls `omacom-io/lumon.nvim` when the Lumon theme is active (lazy.nvim fetch on first `nvim` start → NET). No README.
- **omasnap** — *installable* (OPR stable `omasnap-1.20.1-1`; `omarchy-pkgs/pkgbuilds/omasnap` builds from `tobi/omasnap`; the org repo `omacom/omasnap` is a non-fork copy, 533★). **Not** referenced anywhere in the omarchy tree — the shipped screenshot editor is Tensaku (`bin/omarchy-capture-screenshot` l.19 `tensaku-edit`). Reach: Install → Package → `omasnap`, or `omarchy pkg add omasnap`; then `omasnap` / Apps menu "Omasnap" (`omasnap.desktop` installed by cmake). No default binding — README tells the user to rebind `PRINT`. Features (README 483 l.): Region/Window/Scrolling Region/Fullscreen tabs (`Space` cycles, `S` scroll mode, `Ctrl+A` full monitor, `Enter` window, `Esc`), pointer-side pixel readout, recents shelf (5), annotation editor: `V` select, `A` arrow, `L` line, `F` freehand, `H` highlighter, `R` rect, `E` ellipse, `C` numbered marker, `T` text (Neucha/JetBrains/Inter, `Shift+T`), `D` redact, `X` cut band, `S` spotlight, `O` OCR (tesseract), `B` backdrop, `G` canvas growth, `1-8` colours, `Ctrl+Z/Y`, `Ctrl+C` copy, `Ctrl+S` save (`~/Pictures/Screenshots`), `Enter` copy+save, `P` pin (always-on-top layer, hover controls Edit/Link/Copy/Close), `Esc` back/close. Single instance: a second launch dismisses the open overlay. `--copy`/`--save` quick output, `--file`, `--clipboard` (text-only clipboard → error), `--scroll`, exit codes 0/1/2. Config `~/.config/omasnap/omasnap.conf`; env `OMASNAP_SCREENSHOT_DIR`, `OMASNAP_OCR_LANGS`.
- **omareel** — *installable* (OPR stable `omareel-0.1.0-1`; `omacom/omareel`). Not referenced in the omarchy tree — the shipped recorder is gpu-screen-recorder via `Alt+Print`. Reach: `omarchy pkg add omareel`; then `omareel` (launcher, 380×460, app id `omareel`) or Apps menu; `omareel record [--region|--window|--fullscreen] [--no-audio] [--with-desktop-audio] [--with-microphone-audio] [--fps N] [--no-bar] [--no-selfview] [--dir] [--no-open] [--stop] [--cancel]`, `omareel edit|export|probe|help|--version`; legacy alias `omarecord`. Features (README 167 l., USAGE.md): cursor-free capture + separate input log, synthetic cursor/click rings/auto-zooms, trimming/splitting/speed, aspect presets/padding/rounded corners/shadows, camera bubble, MP4 (HW encode with CPU fallback) and GIF export, `.omareel` bundles in `~/Videos/omareel/`. Editor keys `Space`, `←/→`, `Shift+←/→`, `S` split, `Z` zoom, `Delete`, `Ctrl+Z`, `Ctrl+S`, `Ctrl+E` export. Recording bar top-centre; REC indicator in the Omarchy bar. Ships a Hyprland plugin pinned to the exact Hyprland commit for overlay exclusion; needs `input` group for click/key data (records without it).
- **monologue** — *installable on the edge channel only* (`monologue-0.1.0` is in `edge`, absent from `stable`/`rc`; `omacom/monologue`). Webcam recorder: pick camera + mic once, `Space` record/pause/resume, `Ctrl+Enter` finish, `Ctrl+S` save, `Esc` discard, `Q` quit, `?` help; H.264/AAC MP4; "Open in Omacut" handoff; recordings under `~/.local/share/omacom/monologue/recordings/`. Requires a camera → VM-NO.
- **hype** — *not-in-omarchy*. README (165 l.) says `sudo pacman -S hype` from the OPR, but there is no `hype` recipe in `omarchy-pkgs` and no `hype` in the stable or edge DB. The AUR `hype` (2.0.4) is an unrelated Twitch/Electron app. Only path is build from source (C++17, Qt 6.8, FFmpeg, source-highlight). Features for the record: Markdown decks split by `---`, Visual/Markdown modes (`Ctrl+E`), sidebar drag reorder, `Ctrl+N/O/S`, `Ctrl+Enter` add slide, `Ctrl+D` duplicate, `F5` present / `Esc`, image/video with `fit|span|left|right|loop muted|autoplay=false`, Omarchy theme + font picker, PDF/PowerPoint export; sample deck `examples/welcome.md`.
- **owe** — *installable from AUR* (`owe 0.1.0-2`, URL `github.com/omacom/owe`; not in OPR). README's `omarchy pkg add owe` is wrong — that command is `pacman`, which cannot see the AUR; use Install → AUR or `yay -S owe`. Wallpaper engine: `owed` daemon, `owe-render` (libmpv + GL layer surfaces), `owe-idle`; CLI `owe set <path>|next|current|refresh|pause|resume|always-animate on|off|status|config|render-status|reload-config|render-restart|shutdown`; plays mp4/mkv/webm/gif/stills as the Hyprland background via the Omarchy background symlink; pause policy (fullscreen, lock, DPMS, sleep, battery); GIF → cached mp4; config `~/.config/owe/config.toml`; sockets under `$XDG_RUNTIME_DIR/owe/`. Experimental per its own README.

**Terminal tools**

- **herdr** — *ships* (base.packages l.53; OPR stable `herdr-0.8.2-1` (recipe now 0.9.1); upstream `herdrdev/herdr`, org repo is a fork). Reach: `Super+Ctrl+Return` → `omarchy-launch-terminal herdr` (attach or start; `applications.lua` l.13); `Super+Ctrl+K` / Learn → Herdr → keybinding menu; `herdr` in any terminal; bash fns `hdl <ai> [<ai2>]`, `hds`, `hdlm`, `hsl <n> <cmd>` (`default/bash/fns/herdr`). Omarchy seeds `~/.config/herdr/config.toml` (migration `1786273938`) mirroring the tmux config: prefix `Ctrl+Space`, `prefix+h`/`Alt+Enter` split horizontal, `prefix+v`/`Alt+Shift+Enter` split vertical, `prefix+x` close pane, `prefix+z` zoom, `prefix+c` new tab, `prefix+1..9`/`Alt+1..9` tabs, `prefix+n/p`, `prefix+Shift+c` new workspace, `prefix+d` detach, `prefix+?` help, `prefix+q` reload config, `prefix+[` copy mode; mouse capture on; `confirm_close = false`. CLI used by Omarchy: `herdr --default-config`, `herdr status server --json`, `herdr server reload-config`, `herdr pane split|run`, `herdr tab create|rename`, `herdr workspace rename`; `herdr server stop` ends the session. Herdr first screen: one workspace with one pane, sidebar of workspaces/agents, tab bar (zoom flag + hostname on the right), window title `{hostname}: {workspace}`.
- **ttfx** — *ships* (base.packages l.107; OPR stable `ttfx-0.3.2-1`; `omacom-io/ttfx`, Rust port of TerminalTextEffects). Reach: `<producer> | ttfx [terminal opts] <effect> [effect opts]`; `ttfx --help` (37 effects), `ttfx <effect> --help`, `ttfx --random-effect`, `--print-completion bash|zsh`. Used by `bin/omarchy-screensaver` l.39 (System → Screensaver, idle screensaver) with `--random-effect` over `~/.config/omarchy/branding/screensaver.txt`, killed by `omarchy-system-lock`. Successor of the archived **tte-go**.
- **omarchy-zsh** / **omarchy-fish** — *installable* (OPR stable `omarchy-zsh-1.5.0-2`, `omarchy-fish-1.5.0-1`; built from `omacom-io/omarchy-{zsh,fish}` + archived `omadots` master tarball / `fzf.fish`). Reach: `omarchy pkg add omarchy-zsh` then `omarchy-setup-zsh` (rewrites `~/.zshrc` and makes `~/.bashrc` exec zsh, backing it up to `.bashrc.backup-*`); fish likewise with `omarchy-setup-fish`. fzf keys: zsh `Ctrl+Alt+F/L/V`, `Ctrl+R`, `Ctrl+T`, `Alt+C`; fish `Ctrl+Alt+F/L/S/P`, `Ctrl+R`, `Ctrl+V`. Uninstall `sudo pacman -R omarchy-zsh` + restore `.bashrc` backup. Both depend on `mise` (migration `1786952219` keeps them satisfied by `mise-bin`).
- **omarchy-audio-tuner** — *installable* (OPR stable `0.1.0-1`; `omacom-io/omarchy-audio-tuner`, shell/python). Reach: `omarchy pkg add omarchy-audio-tuner`; CLI `omarchy-audio-tuner probe|capture <sink> out.wav|analyse|delta|fit|generate|mic-sweep|compare|switch`. Authoring tool for the laptop speaker tunings in `default/audio/tunings/` (`docs/audio-tuning.md`). Needs a sink → VM-PARTIAL at best.

**Shell plugins (Quickshell)**

- **elsewhen** — *installable via git* (`omarchy plugin add https://github.com/omacom/elsewhen.git --enable`). The OPR recipe `pkgbuilds/elsewhen` has `sha256sums=('FILL_FROM_RELEASE_ARCHIVE')` and the package is in neither `stable` nor `edge`; it also installs to `/usr/share/omarchy/plugins/`, a packaged-plugin root that HEAD's `omarchy-plugin-catalog` does not scan (only `$OMARCHY_PATH/shell/plugins` and `~/.config/omarchy/plugins`). The README's "installed by default" claim is ahead of the tree. Features (README 1307 l.): globe bar widget → panel with one clock row per city, first run seeds home + four well-spread cities, drag reorder, add/remove cities with aliases, day/night + daylight strip, time scrubber, spinnable globe mode, weather/temperature/currency via Open-Meteo and open.er-api (NET, cached `~/.cache/omacom-elsewhen/`), settings inline in `shell.json`, IPC. Id `omacom.elsewhen`.
- **omarchy-notification-center-plugin** — *installable via git* (`omarchy plugin add https://github.com/omacom-io/omarchy-notification-center-plugin.git --enable`; id `omacom.notification-center`). Bar widget popup: Pending / Recently tabs, per-notification dismiss, Mark All as Seen, Clear Recent, Do Not Disturb toggle. Placement `omarchy bar plugin move omacom.notification-center --section right`.
- **omarchy-port-forward-plugin** — *installable via git* (`omarchy plugin add https://github.com/omacom-io/omarchy-port-forward-plugin.git --enable`; id `port-forward`). Bar widget: count badge, panel with rows (`○ off ◐ connecting ◉ approval ● on ✕ error`), add/edit/delete forwards (label, local port, ssh host, remote host/port, autostart, extra opts), each tunnel a transient `omarchy-pf-<id>.service`; keys `j/k ↑/↓ enter/space a e x r esc`; state `~/.config/omarchy/port-forwards.json`; IPC `omarchy-shell port-forward open|list|statuses|on|off|toggleForward`. Needs an SSH target for the happy path; the error path (unknown host) needs only DNS failure.

**Marketplaces, registries, sync**

- **omarchy-theme-registry** — *not-in-omarchy* (server-side). `themes/<slug>.json` (191 entries) → validator → catalog on `cdn.themes.omarchy.org`. The install path it points users at is the one Omarchy already has: Install → Style → Theme (`omarchy-theme-install <url>`). `themes.omarchy.org` and `cdn.themes.omarchy.org` **did not resolve** at review time; the manual still links `omarchy.org/themes/`. Validator errors mirror `omarchy-theme-install`/`-theme-set`: name regex, no `.lua`/terminal configs/`vscode.json` from a repo theme.
- **omarchy-theme-marketplace** — *not-in-omarchy* (Rails site for themes.omarchy.org; reads the registry catalog). Not live (DNS).
- **omarchy-plugin-marketplace** — *not-in-omarchy* (static site `omarchyplugins.com`, live; linked from `manual/32-shell-plugins.md` l.104 as the community directory). Submission via GitHub issue forms; "install" is copying an `omarchy plugin add <url>` line.
- **omarchy-plugin-registry** — *not-in-omarchy*. Rails control plane for `plugins.omarchy.org` (`omarchy plugin add publisher/name`, signed index, kill-bit). Its own README lists the Quattro-side client as "not yet done"; `plugins.omarchy.org` did not resolve; HEAD's `omarchy-plugin-add` accepts only git URLs. `test/shell.d/plugin-registry-contract-test.sh` tests the *shell's* `PluginRegistry.qml`, not this service.
- **omarchy-theme-sync** — *installable via git clone + `./install.sh`* (no package). Chromium extension + local helper exposing `--omarchy-<colour>` CSS variables and `window.omarchy` (`theme`, `mode`, `color()`, `colors()`, `onChange()`) to pages; installs itself into `chromium-flags.conf`; needs Chromium restarted; `chrome://extensions` shows "Omarchy Theme Sync". Firefox unsupported.
- **omarchy-pkgs** — *ships as infrastructure*: the `[omarchy]` repo in `default/pacman/pacman-*.conf` (`Server = https://pkgs.omarchy.org/<channel>/$arch`, `SigLevel = Required`, `omarchy-keyring`). 145 recipes; Omarchy-owned builds of org projects: `aether`, `cliamp`, `elsewhen`, `herdr`, `monologue`, `omacalc`, `omacut`, `omawrite`, `omareel`, `omasnap`, `omarchy`, `omarchy-settings`, `omarchy-audio-tuner`, `omarchy-chromium-bin`, `omarchy-fish`, `omarchy-zsh`, `omarchy-nvim`, `omarchy-keyring`, `linux-omarchy(-bore)`, `quickshell-git`, `tensaku`, `tobi-try`, `ttfx`, `voxtype-bin`, plus community "oma" apps (`omakade`, `omapresent`, `omaspeak-bin`, `omatrack`, `omawake-bin`, `omazed`, `omarchy-emacs`, `omarchy-walker`). Reach: Install → Package (fzf over `pacman -Slq`), `omarchy pkg add`, `pacman -Sl omarchy`.
- **omarchy-mirror** — *ships as infrastructure*: `mirrorlist-stable` → `stable-mirror.omarchy.org` (≈1 month behind Arch), `mirrorlist-edge` → `mirror.omarchy.org` (hourly); switched by Update → Channel.
- **quickshell** — *ships* (`quickshell` in base.packages; OPR builds `quickshell-git` pinned to an outfoxxed commit; the org repo is a plain mirror). The whole `omarchy-shell` runs on it — covered by the shell reviewers.

**Ports / trials / sites / retired**

- **try-omarchy** — *not-in-omarchy* (macOS Swift/AppKit app bundling an ARM64 QEMU image of Omarchy Quattro). Host is a Mac → **VM-NO**.
- **try-omarchy-windows** — *not-in-omarchy* (Go, WHPX QEMU; `TryOmarchy.exe`, Omarchy 4.0.3 image, v0.0.19-preview). Host is Windows → **VM-NO**.
- **omarchy-mac** — *not-in-omarchy* for x86 (Asahi Alarm + Omarchy guide for M1/M2; linked from `manual/49-omarchy-on.md` l.5). aarch64 only → **VM-NO**.
- **omarchy-chromium** — *archived*; `omarchy-chromium-bin 148.0.7778.96` still sits in OPR stable but base.packages installs stock `chromium` (l.17). Upstream policy refresh made the fork unnecessary.
- **omarchy-lazyvim** — *archived*, replaced by the `omarchy-nvim` package (`migrations/1781587663.sh`, `bin/omarchy-upgrade-to-quattro`).
- **tte-go** — *archived*, replaced by `ttfx`.
- **asdcontrol-git** — *archived*, but `asdcontrol` (from `omakasui/asdcontrol`) is in base.packages l.7 for Apple Studio Display brightness — hardware-gated, VM-NO.
- **omadots** — *archived*, yet still the build-time source of the shared shell config inside `omarchy-zsh` (PKGBUILD pulls `omadots/archive/refs/heads/master.tar.gz`).
- **radio.omarchy.org**, **state-of-omarchy**, **omarchy-site** (serves the manual opened by Learn → Omarchy), **omarchy-site-crt**, **omachee**, **omacon-site**, **oligarchy**, **omarchs**, **wecanfixeverything** — websites; *not-in-omarchy* beyond being URLs a browser can open.
- **omarchy-synthwave84-theme**, **pixel.nvim**, **omacon**, **omakub(-site)**, **omamac(-site)**, **omaterm(-site)**, **website**, **omarchy-configurator** — *archived*.
- **voxtype** and **tensaku** are **not** org projects (`peteonrails/voxtype`, `jondkinney/tensaku`) but both are Omarchy-built OPR packages: tensaku ships (base.packages l.117; the `Super+Alt+,` screenshot editor), voxtype-bin is Install → AI → Dictation (~150 MB model; binds `F9` hold, `Super+Ctrl+X` toggle, only when `voxtype` is present). Left to the capture/AI reviewers; listed so nobody searches for "omasnap" in the screenshot flow.

Classification totals (60 repos excluding `omarchy`): **ships** 8 (omacalc, omawrite, omacut, aether, aether.nvim, lumon.nvim, herdr, ttfx; plus infrastructure omarchy-pkgs, omarchy-mirror, quickshell = 11) · **installable** 11 (omasnap, omareel, monologue[edge], owe[AUR], elsewhen, notification-center, port-forward, omarchy-zsh, omarchy-fish, omarchy-audio-tuner, omarchy-theme-sync) · **not-in-omarchy** 20 (hype, try-omarchy, try-omarchy-windows, omarchy-mac, plugin-marketplace, plugin-registry, theme-registry, theme-marketplace, radio, state-of-omarchy, omarchy-site, omarchy-site-crt, omachee, omacon-site, oligarchy, omarchs, wecanfixeverything, linux, mesa, m1n1) · **archived** 17 · **skipped** 1 (omarchy-iso).

## Observations

1. **The two flagship "org apps" for capture are not the defaults.** `Print` → grim/slurp → Tensaku (`tensaku-edit`), `Alt+Print` → gpu-screen-recorder. omasnap and omareel are opt-in OPR packages with no binding, no menu entry and no mention in the manual. Any test of them starts with an install (NET, ~10-40 MB) and launches them from a terminal or the Apps menu.
2. **What the minted 4.0.2 disk has vs HEAD.** The stable DB carries `omarchy-4.0.4`; the disk was minted from the 4.0.2 ISO. herdr was added by migration `1786273938` and omawrite/omacut/omacalc "from Quattro forward". Drivers should confirm with `pacman -Q omacalc omawrite omacut aether herdr ttfx` before relying on a chord, and `omarchy pkg add <name>` if one is missing (NET).
3. **Only one chord per org app:** `Super+Ctrl+Q` (omacalc), `Super+Shift+W` (omawrite), `Super+Ctrl+Return` (herdr), `Super+Ctrl+K` (herdr keys). omacut and aether are launcher-only (`Super+Alt+Space`, type the name). `Super+Shift+W` is a plain `launch` — pressing it twice gives two Omawrite windows.
4. **Herdr's prefix in Omarchy is `Ctrl+Space`, not the upstream `Ctrl+b`**, and detach is `prefix+d` (upstream `prefix+q`; in Omarchy `prefix+q` is *reload config*). Upstream docs will mislead a driver; use `Super+Ctrl+K` to see the live bindings. The Herdr keybinding menu is derived from `herdr --default-config`, so a herdr that changes that output silently empties the menu. `Ctrl+Space` is also the stock fcitx5 input-method trigger and Omarchy runs an input-method framework in every session (`default/environment.d/10-omarchy-fcitx.conf`, `manual/34`); tmux already uses the same prefix, so it is expected to pass through, but a herdr test that sees nothing happen on `Ctrl+Space` should try `Alt+Enter` (split) to tell "prefix swallowed" from "herdr broken".
5. **`hype` is not installable although its README says `sudo pacman -S hype`**: no recipe in omarchy-pkgs, no package in stable/edge, and the AUR `hype` is an unrelated Twitch app — a user following the README via Install → AUR gets the wrong software. **`owe`'s `omarchy pkg add owe` is equally wrong** (it is AUR-only; `omarchy pkg add` is pacman).
6. **`monologue` is edge-only**; on the stable disk `omarchy pkg add monologue` fails with "target not found" and it needs a webcam anyway.
7. **elsewhen's package path is not wired yet**: recipe checksum placeholder, absent from both DBs, and installs to `/usr/share/omarchy/plugins/` which HEAD's plugin catalog never scans. The git `omarchy plugin add` path works and is what to test.
8. **Theme "marketplace" is a URL paste, not a browser**: Install → Style → Theme opens a floating terminal with a `gum input` for a git URL and the hint "See https://omarchy.org/themes/". `themes.omarchy.org` / `cdn.themes.omarchy.org` did not resolve at review time; use repo URLs from the registry (`bjarneo/omarchy-ash-theme` — colours only; `OldJobobo/omarchy-aonagi-theme` — ships `hyprland.lua`, `gum_env.lua`, `neovim.lua`, terminal configs, so it exercises the drop list). The installed theme is applied immediately by `omarchy-theme-set`; refusal paths: `--` / `ext::` URLs (`omarchy-git-url-check`), unusable derived name (`^[a-z0-9_][a-z0-9._+-]*$`), clone failure. Theme name = repo basename minus `omarchy-`/`-theme`, lowercased.
9. **Plugin add always warns and asks** ("Plugins run as arbitrary, unsandboxed code…") unless `--yes`; from the menu (Setup → Plugins → Add Plugin) it runs in a floating terminal and additionally asks "Enable now?" and, for bar widgets, which section. A repo without `manifest.json` is refused *after* cloning ("refusing to add: validation failed") — so that negative path needs network too. Plugin ids in `omarchy.*` are reserved and refused.
10. **Removal semantics**: `omarchy theme remove` just deletes `~/.config/omarchy/themes/<name>`; if that theme is current, switch away first or the desktop keeps stale generated configs. `omarchy plugin remove <id>` disables then deletes a git checkout. Every install test should end by removing what it added *or* by `stop` so the disk is discarded.
11. **The VM has no GPU, no audio, no camera.** gpu-screen-recorder in Omarchy's own script passes `-fallback-cpu-encoding yes`; omareel's invocation is not visible in its README, so its recording test is VM-PARTIAL (may need `OMAREEL_CAPTURE=gsr`, `OMAREEL_DEBUG=1`, and the log at `/tmp/omareel.log`). owe's renderer wants GL/hwdec; expect llvmpipe. omasnap's capture uses `ext-image-copy-capture`, which is a compositor protocol, so it should work; OCR is tesseract (CPU). Aether is webkit2gtk (CPU render, slow but fine).
12. **Test media has to be made in-guest**: `ffmpeg -f lavfi -i testsrc=duration=6:size=640x360:rate=30 -pix_fmt yuv420p ~/Videos/test.mp4` (ffmpeg ships) is the reliable input for omacut and owe.
13. **Portal file dialogs** (omawrite save, omacut open, aether wallpaper) are GTK choosers floated by `apps/system.lua`; `Ctrl+L` gives a path entry. `~/Documents`, `~/Pictures`, `~/Videos` exist on a minted disk.
14. **Preinstalls**: Remove → Preinstalls drops aether/omacut/omacalc/omawrite (and LibreOffice, Kdenlive, OBS…) and marks `~/.local/state/omarchy/preinstalls-removed`; `Super+Ctrl+Q` then silently does nothing. Install → Preinstalls re-adds everything (hundreds of MB → SLOW, likely > 10 min).
15. **omarchy-zsh/fish change the login shell path** (`~/.bashrc` exec's the new shell). A test that installs one must end with `stop`, or every later test on that disk lands in zsh/fish.
16. **omarchy-pkgs' upstream-sources table** lists `omacom/aether` and `omacom/omarchy-chromium` as direct GitHub watches; omasnap watches `tobi/omasnap`, herdr `herdrdev/herdr`. Breakage in those four is Omarchy's to ship but not to fix.

## Proposed tests

Every step below is a key press, a click, or a command typed into a terminal opened with `Super+Enter` inside the guest; long output goes through `… | sudo tee /dev/ttyS0` and `get-serial`. Tests that install something end by removing it or by `stop`.

### omacalc-calculate   [VM-OK]
description: Omacalc, Omarchy's calculator on Super+Ctrl+Q, opens as a floating window and computes correctly from both the mouse keypad and the keyboard, including the percent convention and a harmless division by zero.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Q.
  ** A small floating calculator window titled Omacalc appears centred over the desktop, with a display and a keypad (digits, × ÷ + −, %, ±, =).
  * Using the mouse only, click `4` `2` `×` `3` `+` `7` `=`.
  ** The result reads `133` and the expression `42 × 3 + 7` stays visible above it.
  * Press `C` on the keyboard, then type `200+10%=`.
  ** The result reads `220` (percent of the running total when + is pending).
  * Press `C`, then type `7/0=`.
  ** The display shows an error or a non-finite value; the window stays open and responsive.
  * Press `C`, type `12.5*4=`, press Ctrl+C, then open a terminal with Super+Enter and type `wl-paste` Enter.
  ** The terminal prints `50`.
  * Close the terminal and Omacalc with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The keypad is small; double-check the mouse position before each click — a mis-click on ± or % changes the result.
  * Keyboard operators are `*` and `/`; Enter also equals. Escape clears the display and may not close the window; use Super+W to close.
  * If nothing opens on the chord, run `pacman -Q omacalc` in a terminal and report the result instead of installing it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the floating Omacalc showing `42 × 3 + 7` and `133`
  ** Screenshot showing `220`, and one showing the display after `7/0=` with the window still open
  ** Screenshot of the terminal printing `50`
  ** Screenshot of the restored desktop
  * If unsuccessful
  ** Screenshot of the wrong result, the vanished window, or the empty desktop after the chord; `pacman -Q omacalc` output
covers: default/hypr/bindings/utilities.lua l.13-14; default/hypr/apps/system.lua l.32; manual/22-guis.md "Omacalc"; omacalc README "Usage"; test/shell.d/keybindings-menu-test.sh l.104

### omawrite-write-and-save   [VM-OK]
description: Omawrite on Super+Shift+W opens an empty Markdown editor; typing and saving goes through the portal file picker, cancelling the picker keeps the text, and the saved file holds what was typed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+W.
  ** An Omawrite window opens: a plain writing surface in the theme colours, no toolbar clutter.
  * Press Ctrl+? (Ctrl+Shift+/), look at the shortcut reference, then press Escape.
  ** The reference lists at least Ctrl+S, Ctrl+O, Ctrl+F, Ctrl+H.
  * Type `# VM test`, Enter, `Hello from the guest.`
  * Press Ctrl+S, then click Cancel in the file dialog.
  ** A floating GTK Save dialog appeared; after Cancel the text is still in the editor and the title still shows an unsaved/untitled document.
  * Press Ctrl+S again; in the dialog press Ctrl+L, type `~/Documents/vmtest.md`, Enter (confirm if asked).
  ** The title now shows `vmtest.md`.
  * Type Enter then `Third line.` and press Ctrl+S.
  ** No dialog this time.
  * Open a terminal with Super+Enter, run `cat ~/Documents/vmtest.md`, then close the terminal and Omawrite with Super+W.
  ** The three lines print exactly; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+L in the GTK dialog opens a path entry; `~` expands. If `~/Documents` is missing, `mkdir -p ~/Documents` in a terminal first.
  * Super+Shift+W launches rather than focuses — a second press opens a second window; close both.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the empty editor and of the shortcut reference
  ** Screenshot of the Save dialog and of the intact text after Cancel
  ** Screenshot of the title bar showing vmtest.md
  ** Screenshot of `cat ~/Documents/vmtest.md` printing three lines
  * If unsuccessful
  ** Screenshot of the missing dialog, lost text, or wrong file contents; `pacman -Q omawrite`
covers: default/hypr/bindings/applications.lua l.19; manual/22-guis.md "Omawrite"; omawrite README "Shortcuts"; default/hypr/apps/system.lua l.16; test/acceptance.d/shell-surfaces-test.sh l.99-117

### omawrite-external-change-warning   [VM-OK]
description: When a file open in Omawrite is changed on disk while the editor holds unsaved edits (made with find/replace), Omawrite must warn and let the user keep their work instead of silently replacing it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `mkdir -p ~/Documents && printf 'alpha beta\nalpha gamma\n' > ~/Documents/ext.md && omawrite ~/Documents/ext.md &` then Enter.
  ** Omawrite opens showing the two lines.
  * In Omawrite press Ctrl+H, enter find `alpha` and replace `omega`, apply to all matches. Do not save.
  ** Both lines now start with `omega`.
  * Click the terminal and run `echo 'changed outside' >> ~/Documents/ext.md`.
  * Click back into the Omawrite window and wait up to 5 seconds.
  ** A warning that the file changed on disk appears (banner or dialog) offering to reload or keep the local version; the `omega` text is still there.
  * Choose to keep the local version, then press Ctrl+S.
  * In the terminal run `cat ~/Documents/ext.md`.
  ** The two `omega` lines print.
  * Close Omawrite and the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The warning may be a slim banner at the top or bottom edge of the editor rather than a dialog — look at both edges.
  * Use the mouse to switch windows so focus (which triggers the check) is unambiguous.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after replace showing `omega`
  ** Screenshot of the external-change warning
  ** Screenshot of `cat ~/Documents/ext.md`
  * If unsuccessful
  ** Screenshot showing the editor content replaced with no warning, or the replace dialog missing
covers: omawrite README (Ctrl+H; "watches open files and warns before an external change can replace local work")

### omacut-trim-and-export   [VM-OK]
description: Omacut, launched from the Apps menu, opens a video, lets the user set a trim range, asks before quitting with an un-exported trim, and exports a shorter MP4.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ffmpeg -y -f lavfi -i testsrc=duration=6:size=640x360:rate=30 -pix_fmt yuv420p ~/Videos/test.mp4`; wait for the prompt to return.
  * Open the Apps menu with Super+Alt+Space, type `Omacut`, press Enter.
  ** Omacut opens with an empty player. Press `?` to see the hotkey list, then dismiss it.
  * Press Ctrl+O; in the dialog press Ctrl+L, type `~/Videos/test.mp4`, Enter.
  ** The test pattern loads with a timeline and two trim handles.
  * Press Space, wait 2 seconds, Space again, then Ctrl+Space; press Right twice, then Alt+Space.
  ** The highlighted range between the handles is about 2 seconds long.
  * Press Q.
  ** Omacut asks for confirmation because the trim is not exported. Choose to stay.
  * Press Ctrl+S; in the export dialog keep the default quality and save as `~/Videos/test-cut.mp4`.
  ** A progress indication runs and completes.
  * In the terminal run `ffprobe -v error -show_entries format=duration -of csv=p=0 ~/Videos/test-cut.mp4`, then press Q in Omacut and close the terminal.
  ** A duration between 1.5 and 3 seconds prints; Omacut quits without asking; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * There is no chord for Omacut; the Apps menu is the only launcher.
  * Both dialogs are GTK portal pickers: Ctrl+L then a path works.
  * If ffmpeg complains about libx264, add `-c:v mpeg4` before the output path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the hotkey overlay
  ** Screenshot of the loaded video with a highlighted trim range
  ** Screenshot of the quit confirmation on the un-exported trim
  ** Screenshot of ffprobe printing a ~2 s duration
  * If unsuccessful
  ** Screenshot of the failing step; `ls -la ~/Videos`; any crash dialog
covers: manual/22-guis.md "Omacut"; omacut README "Hotkeys"; bin/omarchy-install-preinstalls l.25

### aether-theme-from-wallpaper   [VM-OK]
description: Aether, the preinstalled theming app in the Apps menu, turns a wallpaper into a palette and applies it as a new Omarchy theme that the theme picker lists; the stock theme is restored at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Apps menu with Super+Alt+Space, type `Aether`, press Enter.
  ** Within ~10 seconds a window titled Aether opens with a wallpaper column, a 16-swatch palette area and Extract / Apply buttons.
  * Click Extract before choosing a wallpaper.
  ** It is disabled or asks for a wallpaper first; no crash.
  * Use the wallpaper file picker; in the dialog press Ctrl+L, type `/usr/share/omarchy/themes/tokyo-night/backgrounds/`, Enter, then double-click the first image.
  ** The wallpaper preview appears in Aether.
  * Click Extract, wait for the swatches to fill (a few seconds on 2 vCPUs), then click Apply Theme; if asked for a name, enter `vmtest`.
  ** The desktop, bar and any open terminal recolour to the extracted palette.
  * Press Super+Shift+Ctrl+Space.
  ** The theme picker lists the new theme (`vmtest` or the name Aether chose). Press Escape.
  * Restore the stock look: Super+Space → Style → Theme → Tokyo Night, then close Aether with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Aether is a WebKit app rendering in software: a white window for several seconds is normal; do not click Extract twice.
  * Aether may show a confirmation toast after Apply — screenshot it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Aether window, and of the disabled/complaining Extract with no wallpaper
  ** Screenshot of the wallpaper loaded and the extracted swatches
  ** Screenshot of the recoloured desktop after Apply
  ** Screenshot of the theme picker listing the new theme, and of Tokyo Night restored
  * If unsuccessful
  ** Screenshot of the blank window or failed Apply; `pacman -Q aether`
covers: manual/22-guis.md "Aether"; manual/43-making-your-own-theme.md l.7; aether README "Basic Usage"; install/omarchy-base.packages l.5; test/shell.d/app-search-test.sh l.40

### herdr-launch-detach-reattach   [VM-OK]
description: Super+Ctrl+Return opens Herdr's persistent terminal session; detaching with Omarchy's prefix and pressing the chord again returns to the same pane, and the server can be stopped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Return.
  ** A terminal opens running Herdr: a sidebar, a tab bar and one shell pane; the window title shows the hostname and a workspace name.
  * In the pane type `echo HERDR-MARK-1` Enter.
  * Press Ctrl+Space, release, then `d`.
  ** Herdr detaches and the terminal window closes.
  * Press Super+Ctrl+Return again.
  ** Herdr reattaches; the pane still shows `HERDR-MARK-1`.
  * Open a second terminal with Super+Enter and run `herdr status server --json`.
  ** JSON with `"running": true`.
  * Run `herdr server stop`, then `herdr status server --json` again, and close the terminal.
  ** The Herdr window is gone and the status reports not running; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Omarchy prefix is Ctrl+Space (not the upstream Ctrl+b) and detach is prefix then `d`. If Ctrl+Space appears to do nothing, it may be swallowed by the fcitx5 input method — press Alt+Enter: a split proves Herdr is fine and the prefix is the problem; report either way.
  * If the chord opens nothing, run `pacman -Q herdr` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Herdr's first screen
  ** Screenshot after reattach showing HERDR-MARK-1
  ** Screenshot of the running-true and not-running status outputs
  * If unsuccessful
  ** Screenshot after the chord; `pacman -Q herdr`, `herdr --version`
covers: default/hypr/bindings/applications.lua l.13; bin/omarchy-launch-terminal-herdr; config/herdr/config.toml [keys]; manual/21-tuis.md "Herdr"; migrations/1786273938.sh

### herdr-cli-help   [VM-OK]
description: The herdr command line, which Omarchy's scripts and agents drive, prints its help and version and rejects an unknown subcommand with a usage error instead of hanging.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `herdr --help`.
  ** Usage text lists subcommands including `pane`, `tab`, `workspace`, `server`, `status`.
  * Run `herdr --version`.
  ** A version (0.8.x or newer) prints.
  * Run `herdr --default-config | grep -A3 '^# \[keys\]'`.
  ** A commented `[keys]` section with a `prefix` line prints — this is what the Super+Ctrl+K menu is built from.
  * Run `herdr definitely-not-a-command; echo "exit=$?"`.
  ** An error/usage message and a non-zero exit code; nothing hangs.
  * Close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If any command shows nothing for 5 seconds, press Ctrl+C and report it.
  * `herdr --help | sudo tee /dev/ttyS0` then get-serial if the help scrolls off screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot (or serial capture) of `herdr --help`, the version and the `[keys]` excerpt
  ** Screenshot of the non-zero exit for the bad subcommand
  * If unsuccessful
  ** Screenshot of the hang or crash with the exact command
covers: bin/omarchy-menu-herdr-keybindings l.29-33; bin/omarchy-restart-herdr; herdr README "install"

### herdr-keybindings-menu   [VM-OK]
description: Super+Ctrl+K and Learn → Herdr show the Herdr keybinding menu built from Omarchy's shipped config, with the Ctrl+Space prefix on top and live filtering.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+K.
  ** A searchable "Herdr keybindings" menu opens; the first row reads `PREFIX → CTRL + SPACE`, followed by rows such as `PREFIX + D → Detach` and `PREFIX + C → New tab`.
  * Type `detach`.
  ** The list filters to the Detach row.
  * Press Escape, then open the Omarchy Menu with Super+Space and click Learn, then Herdr, using the mouse.
  ** The same menu appears. Press Escape.
  * Open a terminal with Super+Enter and run `omarchy-menu-herdr-keybindings --print --config /nonexistent | head -3`.
  ** Rows still print, now with Herdr's built-in prefix (CTRL + B) — no error for a missing config.
  * Close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu is a fuzzy picker; typing filters live.
  * An empty menu means `herdr --default-config` changed shape — capture `herdr --default-config | head -40 | sudo tee /dev/ttyS0`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the menu with the PREFIX row, and filtered to Detach
  ** Screenshot of the Learn → Herdr path
  ** Screenshot of the --print output with the built-in prefix
  * If unsuccessful
  ** Screenshot of an empty menu or error; serial capture of the default config head
covers: default/hypr/bindings/utilities.lua l.12; default/omarchy/omarchy-menu.jsonc "learn.herdr-keybindings"; bin/omarchy-menu-herdr-keybindings

### herdr-split-tabs-with-omarchy-prefix   [VM-OK]
description: Omarchy's tmux-mirroring Herdr config makes the tmux muscle memory work: prefix+h/v split, prefix+c opens a tab without a name prompt, prefix+x closes without confirmation, prefix+? shows help.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Return to open Herdr.
  * Press Ctrl+Space then `h`, then Ctrl+Space then `v`.
  ** Three panes: two side by side, one of them split top/bottom.
  * Press Ctrl+Space then `?`.
  ** A help overlay lists the active bindings; dismiss it with Escape.
  * Press Ctrl+Space then `c`.
  ** A second tab appears with a fresh pane and no name prompt.
  * Press Alt+Left, then Ctrl+Space then `x` twice.
  ** Back on the first tab, two panes close without confirmation, leaving one.
  * Press Ctrl+Space then `d`; in a terminal (Super+Enter) run `herdr server stop` and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Release Ctrl+Space before pressing the action key. If the prefix is swallowed by the input method, Alt+Enter / Alt+Shift+Enter also split — note which path you used.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with three panes
  ** Screenshot of the help overlay
  ** Screenshot with two tabs, then one pane left after closing
  * If unsuccessful
  ** Screenshot of an unexpected prompt/dialog or a key doing nothing; `cat ~/.config/herdr/config.toml`
covers: config/herdr/config.toml [keys], [ui]; manual/21-tuis.md "Herdr"

### herdr-shell-layout-hdl   [VM-OK]
description: Omarchy's `hdl` shell function builds an editor + AI + terminal layout inside Herdr and refuses with a clear message outside it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `hdl bash`.
  ** It prints `You must start herdr to use hdl.` and does nothing else.
  * Run `hdl`.
  ** It prints the usage line `Usage: hdl <c|cx|codex|other_ai> [<second_ai>]`.
  * Press Super+Ctrl+Return; in Herdr's pane run `mkdir -p ~/hdltest && cd ~/hdltest && hdl bash`.
  ** The tab is renamed `hdltest`; the layout becomes a large Neovim pane on the left, a `bash` pane on the right and a short terminal pane along the bottom.
  * In Neovim press Escape, type `:qa!` Enter.
  * Press Ctrl+Space then `d`; in the plain terminal run `herdr server stop` and close it.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hdl` normally starts an AI CLI in the right pane; `bash` is used so no login or network is needed.
  * Neovim's first start may install plugins — wait for it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the refusal and the usage line outside Herdr
  ** Screenshot of the three-pane layout with the tab named hdltest
  * If unsuccessful
  ** Screenshot of the error; `type hdl` output
covers: default/bash/fns/herdr (hdl); manual/20-shell-functions.md l.24; test/shell.d/herdr-functions-test.sh

### ttfx-terminal-effect   [VM-OK]
description: ttfx, the terminal-effects binary behind the screensaver, animates piped text and settles on it, lists its effects in --help, and rejects an unknown effect with a usage error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ttfx --help | head -25`.
  ** The usage header and the start of the effect list (beams, binarypath, blackhole …) print.
  * Run `printf 'OMARCHY VM TEST\nline two\n' | ttfx decrypt`.
  ** A decrypt animation plays for a few seconds and ends with the two lines legible; the prompt returns.
  * Run `printf 'hello\n' | ttfx --random-effect`.
  ** Some effect plays and ends with `hello`.
  * Run `printf 'x\n' | ttfx nosucheffect; echo "exit=$?"`.
  ** An error naming the unknown effect and a non-zero exit (expected 2).
  * Close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Take a screenshot mid-animation as well as after it settles.
  * If the terminal is left garbled after a run, type `reset` Enter and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `--help` head
  ** Mid-animation and final screenshots of the decrypt run
  ** Screenshot of the non-zero exit for the bad effect
  * If unsuccessful
  ** Screenshot of a hang (after 10 s, Ctrl+C) or garbled terminal; `pacman -Q ttfx`
covers: ttfx README "Usage"; install/omarchy-base.packages l.107

### ttfx-screensaver-from-system-menu   [VM-OK]
description: System → Screensaver launches a fullscreen ttfx animation of the branding text, and a key press dismisses it with the desktop restored and no ttfx left running.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter so a window is on screen, then press Super+Escape.
  * Select Screensaver with the mouse. Do not use keyboard.
  ** The screen goes black and an animated Omarchy logo/branding text builds in the centre; the cursor is hidden. Take a second screenshot ~5 seconds later.
  * Press Space.
  ** The screensaver closes immediately; the desktop with the terminal is back as left; the cursor is visible.
  * In the terminal run `pgrep -x ttfx; echo "exit=$?"`.
  ** No PID, exit 1.
  * Close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screensaver runs in the default terminal (foot on a stock disk). A notification "Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty" is a finding — report the default terminal.
  * Mouse movement alone may not exit it; use a key.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two screenshots of the running screensaver a few seconds apart
  ** Screenshot of the restored desktop and of `pgrep -x ttfx` finding nothing
  ** The mouse was used to pick Screensaver
  * If unsuccessful
  ** Screenshot of the black screen not exiting or a stuck terminal; `pgrep -a ttfx`
covers: default/omarchy/omarchy-menu.jsonc "system.screensaver"; bin/omarchy-launch-screensaver; bin/omarchy-screensaver l.39

### nvim-aether-colorscheme   [VM-OK]
description: Every Omarchy theme drives Neovim through aether.nvim; a fresh nvim reports `aether` as its colorscheme with the plugin already present.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `nvim`.
  ** Neovim opens on the LazyVim dashboard (if a plugin-install window appears, wait for it and press `q`).
  * Type `:colorscheme` Enter.
  ** The command line shows `aether`.
  * Type `:Lazy` Enter.
  ** The plugin list contains `aether` (from bjarneo/aether.nvim). Press `q`.
  * Type `:qa!` Enter, then close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `:colorscheme` prints something else, also run `:echo g:colors_name`.
  * A download prompt inside :Lazy would mean the pre-built plugin cache is missing — screenshot it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `:colorscheme` showing aether
  ** Screenshot of :Lazy listing aether
  * If unsuccessful
  ** Screenshot of the Lazy error or download prompt; `pacman -Q omarchy-nvim`
covers: default/themed/neovim.lua.tpl l.1-10, l.47-51; manual/16-neovim.md; omarchy-pkgs/pkgbuilds/omarchy-nvim

### lumon-theme-fetches-lumon-nvim   [VM-OK] [NET]
description: Switching to the Lumon theme makes Neovim fetch the org colorscheme omacom-io/lumon.nvim and activate `lumon`; switching back to Tokyo Night returns Neovim to `aether`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Style → Theme → Lumon.
  ** The desktop recolours to Lumon's palette.
  * Open a terminal with Super+Enter and run `nvim`.
  ** Lazy installs `lumon.nvim` (a short download of a few hundred KB); wait, press `q` if needed.
  * Type `:colorscheme` Enter.
  ** It prints `lumon`.
  * Type `:qa!` Enter, then Super+Space → Style → Theme → Tokyo Night.
  * Run `nvim`, `:colorscheme` Enter.
  ** It prints `aether`. Type `:qa!` Enter and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A Lazy clone error is the finding — screenshot it and check connectivity with `curl -sI https://github.com | head -1`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Lumon desktop and of `:colorscheme` printing lumon
  ** Screenshot of `:colorscheme` printing aether after switching back
  * If unsuccessful
  ** Screenshot of the Lazy error; `cat ~/.config/omarchy/current/theme/neovim.lua`
covers: themes/lumon/neovim.lua l.3-9; manual/06-themes.md "Lumon"

### omasnap-install-from-package-menu   [VM-OK] [NET]
description: omasnap is not on a stock disk; Install → Package must find it in the omarchy repo and install it, after which it is a launchable app, while an unknown package name is refused cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Install → Package.
  ** A floating terminal shows a fuzzy list of installable packages with a preview pane below.
  * Type `omasnap`.
  ** The list narrows to `omasnap`; the preview shows `Repository : omarchy` and the "screenshot and annotation overlay" description.
  * Press Enter, type the password `prime` Enter when asked.
  ** pacman downloads and installs omasnap (5-15 MB) and the window ends with a done message; press a key to close it.
  * Open the Apps menu with Super+Alt+Space and type `Omasnap`.
  ** An Omasnap entry is offered. Press Escape.
  * Open a terminal with Super+Enter and run `omasnap --version`, then `omarchy pkg add no-such-package-vm-xyz; echo "exit=$?"`.
  ** A 1.x version prints; the second command prints `target not found` with a non-zero exit.
  * Run `sudo pacman -R --noconfirm omasnap` and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is fzf: typing filters, Enter confirms, Escape aborts. If `omasnap` never appears, run `sudo pacman -Sy` in a terminal and retry.
  * Skip the removal step when this test is chained directly into another omasnap test on the same disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker filtered to omasnap with the omarchy repository in the preview
  ** Screenshot of the completed install and of the Apps menu offering Omasnap
  ** Screenshot of the version and of the target-not-found refusal
  * If unsuccessful
  ** Screenshot of the pacman/signature error; `pacman -Q omasnap`
covers: default/omarchy/omarchy-menu.jsonc "install.package"; bin/omarchy-pkg-install; bin/omarchy-pkg-add; omarchy-pkgs/pkgbuilds/omasnap; default/pacman/pacman-stable.conf l.28-29

### omasnap-region-capture-annotate-save   [VM-OK] [NET]
description: omasnap's core flow: run it, drag a region, annotate with an arrow, a rectangle and text, undo and redo, then save; the PNG appears in ~/Pictures/Screenshots and reopens in the editor.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, install omasnap if needed (`omarchy pkg add omasnap`, password `prime`), then run `omasnap` Enter.
  ** The screen freezes under a translucent overlay with tabs Region / Window / Scrolling Region / Fullscreen and a crosshair with a pixel readout.
  * Drag with the mouse from about (0.2, 0.2) to (0.7, 0.7) of the screen.
  ** The annotation editor opens showing the captured rectangle on a backdrop with a toolbar.
  * Press `A` and drag an arrow across the image; press `R` and drag a rectangle; press `T`, click on the image, type `VM`, Enter.
  ** Arrow, rectangle and the label "VM" are visible.
  * Press Ctrl+Z, then Ctrl+Shift+Z.
  ** The text vanishes, then returns.
  * Press Ctrl+S.
  ** The editor closes and a "Screenshot saved" notification with a thumbnail appears.
  * Press Super+Shift+F, open Pictures → Screenshots and double-click the newest `screenshot-<date>_<time>….png`.
  ** The thumbnail is the annotated shot, and it opens in the image viewer showing the arrow, rectangle and VM label.
  * Close the viewer, Files and the terminal (run `sudo pacman -R --noconfirm omasnap` first unless another omasnap test follows).
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * omasnap needs an install first — it is not the stock `Print` editor (that is Tensaku).
  * Creation tools return to Select after one shape; press the letter again for another. `Enter` saves and copies, `Ctrl+S` saves only.
  * If the overlay never appears, run `omasnap 2>&1 | sudo tee /dev/ttyS0` and read the serial log.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the select overlay with tabs and readout
  ** Screenshot of the editor with arrow, rectangle and VM text; one after undo, one after redo
  ** Screenshot of the saved notification and of the PNG open in a viewer
  * If unsuccessful
  ** Serial capture of omasnap's stderr; screenshot of the state it stalled in
covers: omasnap README "Controls", "Annotation editor", "Edit an existing or clipboard image"

### omasnap-toggle-and-quick-save   [VM-OK] [NET]
description: Launching omasnap while its overlay is open dismisses it instead of capturing the overlay, a fullscreen quick-save skips the editor, and opening a text-only clipboard is refused rather than showing an empty editor.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; make sure omasnap is installed (`omarchy pkg add omasnap` if not).
  * Run `(sleep 3; omasnap; echo "second exit=$?") & omasnap`.
  ** The overlay opens, and about three seconds later disappears on its own; the terminal shows `second exit=0` and no capture was taken.
  * Run `omasnap --capture-fullscreen --save`.
  ** No overlay; a "saved" notification appears immediately.
  * Press Super+Shift+F and open Pictures → Screenshots.
  ** The newest PNG is a full-screen shot of the desktop. Close Files.
  * Run `echo 'just text' | wl-copy && omasnap --clipboard; echo "exit=$?"`.
  ** An error that the clipboard holds no image, `exit=1`, and no editor window.
  * Run `sudo pacman -R --noconfirm omasnap` (unless another omasnap test follows) and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The background subshell is what a user pressing the hotkey twice does; keep the mouse still while the overlay is up so no region is drawn.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the overlay open, then gone with `second exit=0`
  ** Screenshot of the quick-save notification and the fullscreen PNG in Files
  ** Screenshot of the clipboard refusal with exit=1
  * If unsuccessful
  ** Screenshot of an editor opened on text, or of a stuck overlay; serial capture of stderr
covers: omasnap README "One instance, toggled by the same hotkey", "Quick output", "Edit an existing or clipboard image", "Exit codes"

### omasnap-pin-capture   [VM-OK] [NET]
description: Pressing `P` in the omasnap editor pins the capture as an always-on-top image with hover controls, and closing the pin leaves no omasnap process behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; make sure omasnap is installed (`omarchy pkg add omasnap` if not). Run `omasnap`.
  * Drag a region about a quarter of the screen.
  * In the editor press `P`.
  ** The editor closes and a small image of the capture sits pinned at the bottom-right.
  * Press Super+Enter to open another terminal.
  ** The pin stays visible above the new window.
  * Hover the pin, then click its Close control.
  ** Controls (Edit, Link, Copy, Close) appear on hover; after Close the pin is gone.
  * In a terminal run `pgrep -a omasnap; echo "exit=$?"`.
  ** Nothing listed, exit 1.
  * Run `sudo pacman -R --noconfirm omasnap` (unless another omasnap test follows) and close the terminals.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The pin is at most a third of the screen wide, lower right. Middle-click also closes it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the pin over a fresh terminal window, and of its hover controls
  ** Screenshot after close with `pgrep` empty
  * If unsuccessful
  ** Screenshot of the pin missing or stuck; `pgrep -a omasnap`
covers: omasnap README "Pinned captures"

### omareel-install-and-launcher   [VM-PARTIAL] [NET]
description: omareel is an opt-in recorder; after `omarchy pkg add omareel` its launcher opens as a compact window and the webcam toggle degrades gracefully with no camera (the camera bubble itself cannot be tested here).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy pkg add omareel` (password `prime`).
  ** omareel and its dependencies install (10-30 MB).
  * Run `omareel help | head -30`.
  ** Subcommands `record`, `edit`, `export`, `probe`, `help` and record options `--region --fullscreen --window --no-audio --stop --cancel` are listed.
  * Run `omareel &` Enter.
  ** A small launcher (about 380×460, tiled since there is no window rule) with a Record button, capture-mode choice, audio toggles and a webcam toggle.
  * Toggle the webcam option on, then off.
  ** No camera exists: a disabled/"no camera" state is shown, no crash, no self-view window.
  * Close the launcher with Super+W, run `sudo pacman -R --noconfirm omareel` (unless the recording test follows) and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * omareel needs an install first; it has no chord or menu entry on a stock disk.
  * The launcher tiles rather than floats — expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the install completing and of `omareel help`
  ** Screenshot of the launcher, and of the webcam toggle's no-device state
  * If unsuccessful
  ** Screenshot of the pacman failure or launcher crash; `omareel 2>&1 | head | sudo tee /dev/ttyS0`
covers: omareel README "Install", "Usage"; omareel docs/USAGE.md "Launcher window"; omarchy-pkgs/pkgbuilds/omareel

### omareel-record-and-export   [VM-PARTIAL] [NET]
description: omareel's core action — start a fullscreen recording, stop it, land in the editor, add a zoom and export an MP4 — must work with software encoding; stopping when nothing records fails with status 1. Audio, webcam and GPU encoding are not exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; install omareel with `omarchy pkg add omareel` if `pacman -Q omareel` says it is missing.
  * Run `omareel record --stop; echo "exit=$?"`.
  ** A message that no recording is active and `exit=1`.
  * Run `OMAREEL_DEBUG=1 omareel record --fullscreen --no-audio --no-selfview`.
  ** Within 3 seconds a recording bar appears top-centre and a REC indicator lights in the Omarchy bar.
  * Wait 5 seconds, type `echo recording` Enter, then run `omareel record --stop`.
  ** The bar disappears and the omareel editor opens on the new bundle with a timeline and preview.
  * Press Space, Space, then `Z`.
  ** Playback started and paused; a zoom block was added on the timeline.
  * Press Ctrl+E, choose MP4, keep defaults, export to `~/Videos/omareel/vmtest.mp4` (Ctrl+L in the file dialog); when the progress indicator finishes, press Super+Shift+F, open Videos → omareel and double-click `vmtest.mp4`.
  ** The export is CPU-encoded (up to a minute); the file sits next to the `.omareel` bundle and plays in mpv.
  * Close mpv, Files and the editor; run `sudo pacman -R --noconfirm omareel` and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No GPU here: if recording does not start, run `cat /tmp/omareel.log | sudo tee /dev/ttyS0`, read it with get-serial, and retry once with `OMAREEL_CAPTURE=gsr` in front of the record command. An encoder error in the log is a valid VM-PARTIAL outcome — report it with the log.
  * A warning that the Hyprland capture-exclusion plugin does not match the running Hyprland is expected, not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `--stop` refusal with exit=1
  ** Screenshot of the recording bar and REC indicator
  ** Screenshot of the editor with the zoom block, and of the exported file playing in mpv
  * If unsuccessful
  ** Serial capture of /tmp/omareel.log; screenshot of the stalled state
covers: omareel docs/USAGE.md "record", "Stopping a recording", "Editor keys", "Environment"; omareel README "Troubleshooting"

### owe-aur-install-video-wallpaper   [VM-PARTIAL] [NET] [SLOW]
description: owe, the org wallpaper engine, is AUR-only: the README's `omarchy pkg add owe` fails, Install → AUR builds it, and `owe set` puts a generated video behind the desktop with software rendering; the stock background is restored at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy pkg add owe; echo "exit=$?"`.
  ** `target not found: owe` and a non-zero exit — owe is not in the Omarchy repo.
  * Run `yay -S --noconfirm owe` (password `prime` when asked).
  ** yay fetches the PKGBUILD, installs build deps and compiles; several minutes; ends without errors.
  * Run `ffmpeg -y -f lavfi -i testsrc=duration=8:size=1280x720:rate=30 -pix_fmt yuv420p ~/Videos/loop.mp4`, then `owe status`; if it says the daemon is not running, run `systemctl --user start owed 2>/dev/null || (owed &>/tmp/owed.log &)` and `owe status` again.
  ** Status JSON prints with renderer liveness.
  * Run `owe set ~/Videos/loop.mp4`; take two screenshots 2 seconds apart.
  ** The desktop background is the moving test pattern; the two screenshots differ.
  * Run `owe pause`; two screenshots 2 seconds apart.
  ** The background is frozen (identical). Run `owe resume`.
  * Run `owe set /nonexistent/file.mp4; echo "exit=$?"`.
  ** Rejected with an error and non-zero exit; the wallpaper keeps playing.
  * Run `owe shutdown`, then Super+Space → Style → Background and pick any background.
  ** The stock still background is back. Close the terminal and end the session with `stop` so the AUR install does not persist.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The compile on 2 vCPUs can take 3-6 minutes; screenshot every ~30 s. If yay is still building at the 7-minute mark, report the elapsed time and stop.
  * No GPU: choppy playback via llvmpipe is acceptable; a black background or a crashed `owe-render` is not — capture `cat /tmp/owed.log | sudo tee /dev/ttyS0`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `omarchy pkg add owe` failing, and of yay finishing
  ** Two screenshots showing the background animating, two showing it paused
  ** Screenshot of the rejected bad path, and of the stock background restored
  * If unsuccessful
  ** Serial capture of the build tail or of /tmp/owed.log; `owe status` output
covers: owe README "Install", "Quick start", "CLI reference"; default/omarchy/omarchy-menu.jsonc "install.aur"; bin/omarchy-pkg-aur-install

### plugin-add-elsewhen-from-menu   [VM-OK] [NET]
description: Setup → Plugins → Add Plugin clones a third-party shell plugin from a pasted git URL after an explicit warning, enables it, and puts the elsewhen globe in the bar with five seeded world clocks; removing it takes the globe away.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Setup → Plugins → Add Plugin.
  ** A floating terminal asks `Git URL of the plugin repo:`.
  * Type `https://github.com/omacom/elsewhen.git` Enter.
  ** A warning "Plugins run as arbitrary, unsandboxed code…" shows the URL and asks `Clone and add this plugin?`.
  * Choose Yes; when asked `Enable 'omacom.elsewhen' now?` choose Yes; if asked for a bar section choose `right`.
  ** `Added omacom.elsewhen into ~/.config/omarchy/plugins/omacom.elsewhen` prints and a globe icon appears in the right section of the bar.
  * Click the globe.
  ** A panel opens with five city rows and times (your location plus four spread round the world) and a globe behind them. Press Escape.
  * Open a terminal with Super+Enter and run `omarchy plugin remove omacom.elsewhen --yes`.
  ** The globe leaves the bar.
  * Close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum prompts: arrow keys move the highlight, Enter selects.
  * Temperature/currency in the panel come from the network and may still be loading — fine.
  * The elsewhen package is not in the repo yet; the git URL is the only install path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the warning prompt with the URL
  ** Screenshot of the globe in the bar and of the five-city panel
  ** Screenshot of the bar after removal
  * If unsuccessful
  ** Screenshot of the clone/validation failure; `omarchy plugin list | sudo tee /dev/ttyS0`
covers: default/omarchy/omarchy-menu.jsonc "setup.plugin.add"; bin/omarchy-plugin-add; manual/32-shell-plugins.md "Adding a plugin from git"; elsewhen README "Installing", "The first run"

### plugin-add-notification-center   [VM-OK] [NET]
description: The org notification-center plugin installs with one command, shows a sent notification in its popup, and its Do Not Disturb toggle silences toasts; removal restores the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin add https://github.com/omacom-io/omarchy-notification-center-plugin.git --enable --yes`.
  ** It clones, validates, enables `omacom.notification-center`; a bell-style icon appears in the bar.
  * Run `omarchy-notification-send "VM notification" "from the guest"`.
  ** A toast appears and fades.
  * Click the notification-center icon.
  ** A popup with Pending and Recently tabs lists "VM notification". Click Mark All as Seen, then Recently — it moved there.
  * Toggle Do Not Disturb on, close the popup, run `omarchy-notification-send "silenced?"`.
  ** No toast; the bar shows the DND indicator.
  * Reopen the popup, toggle DND off, click Clear Recent.
  ** Recently is empty.
  * Run `omarchy plugin remove omacom.notification-center --yes` and close the terminal.
  ** The icon leaves the bar; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--yes` skips the interactive warning; the warning path is covered by the elsewhen test.
  * Look for the new icon in the right section of the bar; hover to find it if the glyph is unfamiliar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the popup listing "VM notification"
  ** Screenshot of DND on with no toast after the second send
  ** Screenshot of the bar after removal
  * If unsuccessful
  ** Screenshot of the missing widget or popup; `omarchy plugin list | sudo tee /dev/ttyS0`
covers: omarchy-notification-center-plugin README; bin/omarchy-plugin-add (--enable --yes); bin/omarchy-plugin-remove

### plugin-add-port-forward-error-path   [VM-OK] [NET]
description: The org port-forward bar widget installs, accepts a forward from its panel, and shows a clear error when the SSH host cannot be reached instead of staying on "connecting" forever (no reachable SSH host exists here, so only the error path runs).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin add https://github.com/omacom-io/omarchy-port-forward-plugin.git --enable --yes`.
  ** Plugin `port-forward` is enabled; a tunnel icon appears in the bar.
  * Click the icon.
  ** A panel opens with an empty list and an "Add forward" row.
  * Press `a`; fill label `vm`, local port `3000`, SSH host `nohost.invalid`, remote host `localhost`, remote port `3000`; save.
  ** A row `vm` with status `○` appears.
  * Select the row and press Enter.
  ** Status goes `◐` and within ~15 seconds becomes `✕` with an error (name resolution failed); it must not stay on `◐`.
  * Press `x` on the row, confirm deletion, press Escape.
  * Run `omarchy plugin remove port-forward --yes` and close the terminal.
  ** The icon leaves the bar; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Panel keys: `j/k` move, `enter` toggle, `a` add, `e` edit, `x` delete, `esc` close.
  * `.invalid` never resolves, which is what exercises the error path without an SSH server.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the empty panel, then of the `vm` row
  ** Screenshot of the `✕` error state with its message
  ** Screenshot of the bar after removal
  * If unsuccessful
  ** Screenshot of a row stuck on `◐` after 30 s; `journalctl --user -u 'omarchy-pf-*' -n 30 --no-pager | sudo tee /dev/ttyS0`
covers: omarchy-port-forward-plugin README "What it does", "Keyboard shortcuts", "Where state lives"

### plugin-add-rejects-invalid-repo-and-url   [VM-OK] [NET]
description: `omarchy plugin add` refuses a URL that names a git helper without touching the network, and refuses a real repository that has no plugin manifest after cloning it, leaving nothing behind in the plugins directory.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls -a ~/.config/omarchy/plugins/ 2>/dev/null`; note the listing.
  * Run `omarchy plugin add 'ext::sh -c id' --yes; echo "exit=$?"`.
  ** Instantly: `… names a git option or transport helper, not a repository.` and exit 1.
  * Run `omarchy plugin add https://github.com/omacom/ttfx.git --yes; echo "exit=$?"`.
  ** git clones, then `missing manifest.json` and `refusing to add: validation failed`, exit 1.
  * Run `omarchy plugin add https://github.com/omacom/does-not-exist-vm.git --yes; echo "exit=$?"`.
  ** `failed to clone`, exit 1.
  * Run `ls -a ~/.config/omarchy/plugins/ 2>/dev/null`.
  ** Same listing as before — no new directory and no `.add.tmp.*` leftover.
  * Close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The `ext::` refusal must be immediate; a pause of several seconds means git ran — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the three refusals with exit codes
  ** Screenshot of the unchanged plugins directory
  * If unsuccessful
  ** Screenshot of a staging directory left behind or of a clone running for the helper URL
covers: bin/omarchy-plugin-add l.96-128; bin/omarchy-git-url-check; bin/omarchy-plugin-validate

### theme-install-community-via-menu   [VM-OK] [NET]
description: Install → Style → Theme takes a community theme's git URL, clones it, applies it immediately and lists it in the theme picker; Remove → Theme takes it away again after switching back to stock.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Install → Style → Theme.
  ** A floating terminal shows `See https://omarchy.org/themes/` and an input `Git repo URL (https or git@host:org/repo.git)`.
  * Type `https://github.com/bjarneo/omarchy-ash-theme` Enter.
  ** git clones and the theme applies: desktop, bar and terminal recolour to Ash's grey palette; press a key to close the window.
  * Press Super+Shift+Ctrl+Space.
  ** The picker lists `Ash` with a preview among the built-in themes. Press Escape.
  * Super+Space → Style → Theme → Tokyo Night.
  ** Stock colours return.
  * Super+Space → Remove → Theme; select `ash` with the mouse.
  ** A "Theme removed ash" notification appears.
  * Press Super+Shift+Ctrl+Space.
  ** Ash is no longer listed. Press Escape.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The "marketplace" is a URL paste: there is no in-desktop browser; the theme name becomes the repo name minus `omarchy-`/`-theme`.
  * Switch away from Ash before removing it — removing the current theme leaves the desktop pointing at a deleted directory.
  * The clone is a few MB; retry once on a network error.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the URL prompt
  ** Screenshot of the recoloured desktop after install, and of the picker listing Ash
  ** Screenshot of the Remove picker, the notification, and the picker without Ash
  * If unsuccessful
  ** Screenshot of the clone error or a theme that installed but did not apply; `ls -la ~/.config/omarchy/themes/`
covers: default/omarchy/omarchy-menu.jsonc "install.style.theme", "remove.theme", "style.theme"; bin/omarchy-theme-install; bin/omarchy-theme-remove; manual/43-making-your-own-theme.md "Distributing your theme"; omarchy-theme-registry README "Browse and install"

### theme-install-drops-code-files   [VM-OK] [NET]
description: A theme installed from a repository keeps its colours but loses every file that would run code (Lua, terminal configs, vscode.json), and the install says which files it ignored.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy theme install https://github.com/OldJobobo/omarchy-aonagi-theme 2>&1 | tail -6`.
  ** After the clone (20-40 s): a line `Ignored in ~/.config/omarchy/themes/aonagi: …` naming at least `alacritty.toml`, `foot.ini`, `ghostty.conf`, `gum_env.lua`, `hyprland.lua`, `kitty.conf`, `neovim.lua`, then `A theme installed from a git repo cannot supply Lua, a terminal config, or vscode.json.` The desktop recolours to Aonagi (violet/blue).
  * Run `ls ~/.config/omarchy/themes/aonagi | tr '\n' ' '; echo; ls ~/.config/omarchy/current/theme/ | tr '\n' ' '`.
  ** The clone still lists `hyprland.lua` and the terminal configs; the current-theme directory lists none of them but does list `colors.toml`, `btop.theme`, `chromium.theme`, `helix.toml`, `icons.theme`, `shell.toml`, `backgrounds`.
  * Press Super+Shift+Ctrl+Space.
  ** `Aonagi` is listed with its preview. Press Escape.
  * Super+Space → Style → Theme → Tokyo Night, then run `omarchy theme remove aonagi` and close the terminal.
  ** Stock colours are back; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Aonagi was chosen because it ships Lua and terminal configs; a colours-only theme would not exercise the drop list.
  * Send the two listings to serial (`| sudo tee /dev/ttyS0`) if they wrap badly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "Ignored in …" message
  ** Screenshot comparing the clone listing (with .lua) and the current-theme listing (without)
  ** Screenshot of the Aonagi desktop and of Tokyo Night restored
  * If unsuccessful
  ** Screenshot showing a `.lua` or terminal config from the repo inside `~/.config/omarchy/current/theme/`
covers: bin/omarchy-theme-set l.20-30, l.234-280; manual/43-making-your-own-theme.md "What an installed theme can contain"; omarchy-theme-registry README "What gets checked"

### theme-install-rejects-bad-url   [VM-OK] [NET]
description: `omarchy theme install` refuses a git helper URL without cloning, refuses a URL whose derived theme name is unusable, and reports a clone failure for a repository that does not exist — leaving no theme directory behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls ~/.config/omarchy/themes/ 2>/dev/null`; note the listing.
  * Run `omarchy theme install 'ext::sh -c id'; echo "exit=$?"`.
  ** Instantly refused by the URL check, exit 1.
  * Run `omarchy theme install 'https://github.com/x/omarchy-bad%20name-theme'; echo "exit=$?"`.
  ** `Error: '…' does not give a usable theme name.`, exit 1, no clone attempted.
  * Run `omarchy theme install https://github.com/omacom/omarchy-does-not-exist-theme.git; echo "exit=$?"`.
  ** `Error: Failed to clone theme repo.`, exit 1.
  * Run `ls ~/.config/omarchy/themes/ 2>/dev/null`.
  ** Same listing as before. Close the terminal.
  ** The desktop is unchanged and must look exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The `ext::` and bad-name refusals must be immediate; only the third command talks to the network.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the three refusals with exit codes
  ** Screenshot of the unchanged themes directory and the unchanged desktop
  * If unsuccessful
  ** Screenshot of a clone running for a helper URL, or of a leftover theme directory
covers: bin/omarchy-theme-install l.19-59; bin/omarchy-git-url-check; manual/43-making-your-own-theme.md l.41

### omarchy-zsh-install-and-restore   [VM-OK] [NET]
description: The org zsh package installs from the omarchy repo, `omarchy-setup-zsh` makes new terminals start zsh with the Omarchy prompt and fzf bindings, and the documented backup path brings bash back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `echo $0`.
  ** `bash`.
  * Run `omarchy pkg add omarchy-zsh` (password `prime`), then `omarchy-setup-zsh`.
  ** zsh and omarchy-zsh install; setup writes `~/.zshrc`, backs up `~/.bashrc` to `~/.bashrc.backup-<date>` and reports it.
  * Close the terminal, open a new one with Super+Enter, run `echo $0; echo $ZSH_VERSION`.
  ** `zsh` (or `-zsh`) and a version; the prompt is the Starship prompt.
  * Press Ctrl+R.
  ** An fzf history search opens. Press Escape.
  * Run `cp "$(ls -t ~/.bashrc.backup-* | head -1)" ~/.bashrc && sudo pacman -R --noconfirm omarchy-zsh`.
  * Close the terminal, open a new one, run `echo $0`.
  ** `bash` again. Close it and end the session with `stop` so no shell change leaks into later tests.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `omarchy-setup-zsh` is not found, run `pacman -Ql omarchy-zsh | grep bin/` to find the setup command and report the name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of bash before, zsh after (with $ZSH_VERSION and Starship prompt), bash after restore
  ** Screenshot of the fzf Ctrl+R popup under zsh
  * If unsuccessful
  ** Screenshot of the setup error or a terminal that fails to open; `cat ~/.bashrc | head -20`
covers: omarchy-zsh README "Install", "fzf Keybindings", "Uninstall"; omarchy-pkgs/pkgbuilds/omarchy-zsh; migrations/1786952219.sh

### omarchy-fish-install-and-restore   [VM-OK] [NET]
description: The org fish package installs from the omarchy repo, `omarchy-setup-fish` makes new terminals start fish with the fzf.fish bindings, and the backup path brings bash back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy pkg add omarchy-fish` (password `prime`), then `omarchy-setup-fish`.
  ** fish and omarchy-fish install; `~/.bashrc` is backed up and set to launch fish.
  * Close the terminal, open a new one with Super+Enter, run `echo $FISH_VERSION`.
  ** A version prints; the prompt is fish/Starship styled.
  * Press Ctrl+R, look, Escape; press Ctrl+Alt+P, look, Escape.
  ** fzf.fish history search, then process search, each opened.
  * Run `cp (ls -t ~/.bashrc.backup-* | head -1) ~/.bashrc; sudo pacman -R --noconfirm omarchy-fish`.
  * Close the terminal, open a new one, run `echo $0`.
  ** `bash`. Close it and end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fish syntax: command substitution is `(…)`, not `$(…)`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of fish running with $FISH_VERSION
  ** Screenshots of the Ctrl+R and Ctrl+Alt+P popups
  ** Screenshot of bash restored
  * If unsuccessful
  ** Screenshot of the setup error; `cat ~/.bashrc | head -20`
covers: omarchy-fish README; omarchy-pkgs/pkgbuilds/omarchy-fish

### omarchy-audio-tuner-no-audio-device   [VM-PARTIAL] [NET]
description: The speaker-tuning authoring tool installs from the omarchy repo, prints usage, generates its probe offline, and fails cleanly when asked to capture from a sink that does not exist; the real measure-through-speakers workflow is skipped (no audio device).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy pkg add omarchy-audio-tuner` (password `prime`).
  * Run `omarchy-audio-tuner; echo "exit=$?"`.
  ** Usage listing `probe capture analyse delta fit generate mic-sweep compare switch` and a non-zero exit.
  * Run `omarchy-audio-tuner probe && ls ~/.cache/omarchy-audio-tuner/`.
  ** A probe WAV and its tone list are generated (ffmpeg only, no hardware).
  * Run `omarchy-audio-tuner capture no-such-sink ~/raw.wav; echo "exit=$?"`.
  ** A clear error about the missing sink (not a traceback), non-zero exit.
  * Run `sudo pacman -R --noconfirm omarchy-audio-tuner` and close the terminal.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `pactl list short sinks` shows what audio the VM has (a dummy sink or nothing) — include it in the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the usage text and of the generated probe files
  ** Screenshot of the clean capture failure
  * If unsuccessful
  ** Screenshot of a traceback or hang; `pacman -Ql omarchy-audio-tuner | head`
covers: omarchy-audio-tuner README "The short version"; docs/audio-tuning.md; omarchy-pkgs/pkgbuilds/omarchy-audio-tuner

### theme-sync-chromium-extension   [VM-OK] [NET]
description: omarchy-theme-sync, installed from a git checkout, appears in Chromium's extensions page and exposes the current Omarchy theme name to web pages, updating when the theme changes; it is removed at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return to open Chromium once (so a profile exists), then close it with Super+W.
  * Open a terminal with Super+Enter and run `git clone --depth 1 https://github.com/omacom/omarchy-theme-sync.git ~/omarchy-theme-sync && cd ~/omarchy-theme-sync && ./install.sh`.
  ** The installer registers the extension and helper without sudo and prints a success summary.
  * Press Super+Shift+Return; press Ctrl+L, type `chrome://extensions`, Enter.
  ** "Omarchy Theme Sync" is listed and enabled.
  * Ctrl+L, type `https://omarchy.org`, Enter; press Ctrl+Shift+J and in the console type `window.omarchy && window.omarchy.theme` Enter.
  ** The current theme name (e.g. `tokyo-night`) prints.
  * Super+Space → Style → Theme → Nord; back in the console, after 3 seconds, run `window.omarchy.theme` again.
  ** `nord`.
  * Super+Space → Style → Theme → Tokyo Night; close Chromium; in the terminal run `sed -i '/omarchy-theme-sync/d' ~/.config/chromium-flags.conf; rm -rf ~/omarchy-theme-sync` and close it.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The extension's helper watches the theme with inotify; give it 2-3 seconds after switching before re-reading.
  * If the checkout has an `uninstall.sh`, prefer running it over the sed line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of install.sh finishing
  ** Screenshot of chrome://extensions with Omarchy Theme Sync enabled
  ** Screenshot of the console printing tokyo-night, then nord after the switch
  * If unsuccessful
  ** Screenshot of the extension missing or `window.omarchy` undefined; `cat ~/.config/chromium-flags.conf`
covers: omarchy-theme-sync README "Install", "Use the JavaScript API"; default/chromium (flags file)

### preinstalls-remove-drops-org-apps   [VM-OK]
description: Remove → Preinstalls uninstalls the preinstalled org apps (omacalc, omawrite, omacut, aether); afterwards their chords do nothing harmful and Install → Preinstalls becomes available (the restore itself is too large to run here).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Remove → Preinstalls.
  ** A floating terminal asks `Are you sure you want to remove all preinstalled web apps, TUI wrappers, and desktop applications?`.
  * Choose Yes and enter the password `prime` when asked.
  ** Web apps and TUIs are removed, then pacman removes aether, omacut, omacalc, omawrite and the other preinstalls (a minute or two, no download).
  * Press Super+Ctrl+Q, then Super+Shift+W.
  ** Nothing opens and no error dialog appears.
  * Open the Apps menu with Super+Alt+Space and type `Omacut`.
  ** No Omacut entry. Press Escape.
  * Open a terminal with Super+Enter and run `pacman -Q omacalc omawrite omacut aether 2>&1`.
  ** Four "was not found" lines.
  * Super+Space → Install.
  ** The `Preinstalls` row is selectable (not dimmed). Do NOT select it. Press Escape.
  * Close the terminal and end the session with `stop` so the disk is discarded.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The removal is a real `pacman -R`; a dependency error here is the finding — screenshot it.
  * Install → Preinstalls re-downloads hundreds of MB (LibreOffice, Kdenlive, OBS…) and would blow the session budget.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the confirmation and of pacman finishing
  ** Screenshot after Super+Ctrl+Q with no calculator, and of `pacman -Q` reporting the four packages missing
  ** Screenshot of Install → Preinstalls enabled
  * If unsuccessful
  ** Screenshot of the pacman error or of an app still launching; `cat ~/.local/state/omarchy/preinstalls-removed`
covers: bin/omarchy-remove-preinstalls; default/omarchy/omarchy-menu.jsonc "remove.preinstalls", "install.preinstalls"; test/shell.d/preinstalls-test.sh l.69

### monologue-webcam-recording   [VM-NO]
description: Monologue records from a webcam with a live microphone meter; the guest has neither device and the package is only on the edge channel, so the core action cannot run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here: `omarchy pkg add monologue` fails on the stable channel (edge-only package) and recording needs a camera.
  ** For the record, on real hardware: launch Monologue from the Apps menu, choose camera and microphone, Space to record, Space to pause/resume, Ctrl+Enter to finish, Ctrl+S to save, "Open in Omacut" to hand the clip over; Esc discards after confirmation, Q quits.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry only; do not attempt on the minted disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable in the QEMU guest
  * If unsuccessful
  ** Not applicable
covers: monologue README; omarchy-pkgs/pkgbuilds/monologue (edge only)

### hype-open-sample-deck   [VM-NO]
description: Hype (Markdown presentations) is not packaged — absent from the omarchy repo despite its README, and the AUR `hype` is an unrelated program — so opening a sample deck would need a from-source Qt build that exceeds the session budget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here. For the record, once `hype` exists in the omarchy repo: `omarchy pkg add hype`, launch Hype from the Apps menu, Open a Markdown deck, verify the slide sidebar and preview, F5 to present, arrows to navigate, Escape back, Ctrl+E for Markdown mode, Export → PDF.
  ** A driver on a stable disk can only prove the absence: `pacman -Si hype` → package not found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not install the AUR `hype`; it is a Twitch client, not this app.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable until packaged
  * If unsuccessful
  ** Not applicable
covers: hype README "Install", "Keyboard shortcuts"; omarchy-pkgs (no recipe); AUR `hype`

### try-omarchy-macos-and-windows   [VM-NO]
description: Try Omarchy (macOS) and Try Omarchy for Windows run Omarchy inside a host-native app; they need a Mac or Windows host and cannot run inside the Linux guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here (host-side applications). For the record: macOS — open Try Omarchy.app, first-run download, Omarchy desktop; Windows — run TryOmarchy.exe, enable Hypervisor Platform, download image, Omarchy 4.0.3 desktop with instant `omarchy`/`omarchy` trial login, Ctrl+Alt+F fullscreen, shared clipboard and `Omarchy Shared` folder.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable
  * If unsuccessful
  ** Not applicable
covers: try-omarchy README; try-omarchy-windows README

### omarchy-mac-apple-silicon   [VM-NO]
description: omarchy-mac is the Asahi Alarm + Omarchy dual-boot guide for M1/M2 Macs linked from the manual's "Omarchy on…" page; it targets aarch64 hardware and has no x86 path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here. The only in-guest check is that Learn → Omarchy opens the manual whose "Omarchy on…" page links to the omarchy-mac guide.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable
  * If unsuccessful
  ** Not applicable
covers: manual/49-omarchy-on.md l.5; omarchy-mac README

## Gaps

- **omasnap/omareel are not on the default path**, so nothing here protects the shipped screenshot/recording flow (Tensaku, gpu-screen-recorder) — that belongs to the capture reviewer. If Omarchy ever swaps Tensaku for omasnap the `Print` → annotate test must move to omasnap's controls (this file's omasnap tests are ready for that).
- **hype**: not installable from Omarchy (no OPR recipe/package; AUR name collision with an unrelated app). Core action (open a sample deck, present, export PDF) cannot be driven until it is packaged; building Qt from source exceeds the session budget.
- **monologue**: webcam + microphone required; stable channel cannot install it. Absence path (launch shows no devices) would need the edge channel or a source build.
- **owe**: the happy path depends on GL and video decode in a GPU-less guest and on an AUR compile that may run 3-6 minutes; the daemon start mechanism after an AUR install is not documented (the test tries systemd then a direct `owed`). Treat a black background as a VM limitation unless `owe-render` crashes.
- **omareel**: native capture backend/exclusion plugin is bound to the exact Hyprland commit; in the VM it may fall back to gpu-screen-recorder which may lack a software encoder path. Click/key capture needs the `input` group. Camera bubble untestable.
- **elsewhen packaged path** (`/usr/share/omarchy/plugins/`) cannot be tested: no package in either channel and HEAD's catalog does not scan that root. Only the git path is covered.
- **Theme/plugin marketplaces and registries** are web properties: `themes.omarchy.org`/`cdn.themes.omarchy.org`/`plugins.omarchy.org` did not resolve during review; `omarchyplugins.com` is a static directory with copy-paste install lines. There is no in-desktop browser to drive; "install from marketplace" reduces to the URL-paste tests above. The registry client (`omarchy plugin add publisher/name`, signed index, kill-bit) is unimplemented in the shell.
- **Install → Preinstalls** (restore) re-downloads LibreOffice, Kdenlive, OBS, Obsidian, Moonlight and the org apps — hundreds of MB, well past the ten-minute budget on user-mode NAT. Only the remove half is proposed.
- **omarchy-audio-tuner** real workflow (probe through speakers, capture monitor, fit, generate) needs a physical sink; only offline steps are covered.
- **omarchy-chromium-bin**: archived upstream, still published in OPR; not installed by default (`chromium` is). Installing it alongside would conflict — not proposed.
- **voxtype / tensaku** are not org projects; their tests (Install → AI → Dictation with no microphone; `Super+Alt+,` editing a screenshot) are left to the AI/capture reviewers.
- **aether wallhaven/GitHub wallpaper browsing** and Base16 import need external services and a login-free API; not proposed to keep the aether tests deterministic.
- **herdr agent detection** (working/blocked/idle states) needs a real coding-agent CLI with credentials; only the terminal-multiplexer surface is covered.
- **lumon.nvim / aether.nvim** are exercised only through the colorscheme name; highlight correctness is not judged from screenshots.
- **radio.omarchy.org, state-of-omarchy, omachee, omacon-site, oligarchy, omarchs, wecanfixeverything, omarchy-site(-crt)**: websites; opening them in Chromium proves only that the browser works.
- **asdcontrol, apple-bcm-firmware, m1n1, linux, mesa**: hardware/kernel mirrors; no desktop path in the guest.
