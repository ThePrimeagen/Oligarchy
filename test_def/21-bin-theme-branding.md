# 21 — bin/omarchy-theme-*, branding, fonts, plymouth, refresh, apply

Reviewer notes for the theming/branding surface of omarchy @ HEAD 2026-09-18
(`/tmp/omarchy-review/omarchy`). Format per `00-FORMAT.md`.

## Scope

Read completely (64 scripts, 5 035 lines):

| group | scripts | lines |
|---|---|---|
| `bin/omarchy-theme-*` | 34: `bg-cache` 10, `bg-current` 12, `bg-install` 9, `bg-next` 49, `bg-set` 25, `bg-switcher` 14, `color` 304, `colors-from-alacritty` 151, `current` 12, `dir` 18, `extras` 17, `install` 63, `list` 9, `osc` 33, `refresh` 9, `remove` 39, `set` 393, `set-browser` 36, `set-browser-policy` 123, `set-claude` 74, `set-foot` 20, `set-gnome` 34, `set-hermes` 233, `set-keyboard` 7, `set-keyboard-asus-rog` 12, `set-keyboard-f16` 28, `set-obsidian` 28, `set-pi` 76, `set-t3code` 34, `set-templates` 404, `set-tmux` 120, `set-vscode` 153, `switcher` 128, `update` 10 | 2 690 |
| `bin/omarchy-branding-*` | 3: `about` 28, `about-animation` 104, `screensaver` 28 | 160 |
| `bin/omarchy-font-*` | 3: `current` 9, `list` 6, `set` 84 | 99 |
| `bin/omarchy-plymouth-*` | 7: `current` 20, `list` 13, `preview` 76, `reset` 9, `set` 381, `set-by-theme` 53, `switcher` 20 | 572 |
| `bin/omarchy-refresh-*` | 12: `applications` 17, `chromium` 25, `config` 43, `herdr` 6, `hyprland` 14, `hyprsunset` 6, `limine` 19, `pacman` 26, `plymouth` 8, `sddm` 8, `shell` 11, `tmux` 6 | 189 |
| `bin/omarchy-apply-*` | 3: `hardware` 75, `lock` 60, `system` 102 | 237 |
| `bin/omarchy-dev-theme-preview`, `bin/omarchy-dev-font` | 439 + 652 | 1 091 |

Also read: `docs/theming.md` (391 lines); all 19 `default/themed/*.tpl` (heads + placeholder
inventory; `vscode-theme.json.tpl` is 60 KB and was skimmed for `{{ }}` usage only); the
`themes/` tree (every theme's file list, every `colors.toml` mode line, every `icons.theme`,
`chromium.theme`, `hyprland.lua`; `themes/tokyo-night/*` read in full as the exemplar);
`default/fontconfig/conf.avail/50-omarchy.conf`; `default/fonts/omarchy/{README.md,omarchy.ttf,hermes.svg}`;
`agents/skills/icon-font.md`; `install/user/theme.sh`; `install/config/theme-system.sh`;
`default/omarchy/omarchy-menu.jsonc` (style/install/remove/update entries);
`default/hypr/bindings/utilities.lua` (all binds); helpers the scope calls into
(`omarchy-menu-images` flags, `omarchy-git-url-check`, `omarchy-install-font`,
`omarchy-launch-about`, `omarchy-launch-screensaver`, `omarchy-launch-floating-terminal-with-presentation`,
`omarchy-show-done`, `omarchy-hook`, `omarchy-restart-{terminal,btop,hyprctl,gum}`,
`shell/plugins/menu/Menu.qml` fonts provider, `etc/sudoers.d/omarchy-theme-browser`).
Skimmed maintainer tests: `theme-install-guards-test.sh`, `theme-staging-test.sh`, `user-theme-test.sh`,
`background-test.sh`, `video-background-test.sh`, `plymouth-set-test.sh`, `refresh-config-test.sh`,
`vscode-theme-test.sh`, `hermes-theme-test.sh`, `branding-about-animation-test.sh`.

Skipped: the QML side of the shell (background plugin, image picker) beyond what the scripts call;
`install/hardware/*`, `install/config/*`, `install/post-install/*` that `omarchy-apply-system` sources
(other reviewers); the body of `omarchy-dev-font`'s TrueType encoder (read for CLI surface and error
messages only).

Caveat: the minted disk is **4.0.2**; this review is of HEAD (dev line). Behaviour that is new on HEAD
and may be absent on the disk is marked "(HEAD)" in Observations; the driver should report a mismatch as
"not on this build" rather than a failure.

## Inventory

**Themes (22 at HEAD, not 24)**

Every theme ships `colors.toml`, `icons.theme`, `preview.png`, `preview-unlock.png`, `unlock.png`,
`backgrounds/`. `mode` comes from `colors.toml` (no theme uses a `light.mode` marker file, though
`omarchy-theme-color` still honours one).

| theme | mode | icons.theme | extra hand-written files | backgrounds |
|---|---|---|---|---|
| catppuccin | dark | Yaru-purple | neovim.lua, vscode.json | 4 |
| catppuccin-latte | **light** | Yaru-blue | neovim.lua, vscode.json | 2 |
| ethereal | dark | Yaru-blue | — (pure template theme) | 3 |
| everforest | dark | Yaru-sage | neovim.lua, vscode.json | 2 |
| flexoki-light | **light** | Yaru-blue | chromium.theme, neovim.lua, vscode.json | 2 |
| gruvbox | dark | Yaru-olive | neovim.lua, vscode.json | 6 |
| hackerman | dark | Yaru-blue | neovim.lua, vscode.json | 3 |
| kanagawa | dark | Yaru-blue | hyprland.lua, neovim.lua, vscode.json | 2 |
| last-horizon | dark | Yaru-purple | btop.theme, chromium.theme, hyprland.lua, vscode.json | 4 |
| lumon | dark | Yaru-blue | btop.theme, chromium.theme, hyprland.lua, neovim.lua, vscode.json; custom unlock.png | 3 |
| lupine | **light** | Yaru-purple | — | 6 |
| matte-black | dark | Yaru-red | neovim.lua, vscode.json | 4 |
| miasma | dark | Yaru-wartybrown | — | 3 |
| nord | dark | Yaru-blue | neovim.lua, vscode.json | 4 |
| osaka-jade | dark | Yaru-sage | neovim.lua, vscode.json | 4 |
| retro-82 | dark | Yaru-wartybrown | btop.theme, chromium.theme, hyprland.lua, neovim.lua, vscode.json | 9 |
| ristretto | dark | Yaru-yellow | — | 5 |
| rose-pine | **light** | Yaru-blue | chromium.theme, neovim.lua, vscode.json | 4 |
| solitude | dark | Yaru-sage-dark | btop.theme, hyprland.lua, neovim.lua, vscode.json | 5 |
| tokyo-night (default) | dark | Yaru-magenta | keyboard.rgb, neovim.lua, shell.lock.toml, vscode.json; custom unlock.png | 8 |
| vantablack | dark | Yaru-gray | — ; custom unlock.png (same bytes as white) | 5 |
| white | **light** | Yaru-grey | — ; custom unlock.png (same bytes as vantablack) | 4 |

`themes/tokyo-night/` exemplar: `colors.toml` (mode, accent, selection, muted, 4 backgrounds, 4
foregrounds, 8 named + 6 bright colours), `icons.theme` = `Yaru-magenta`, `keyboard.rgb` = `ff00ff`,
`neovim.lua` (LazyVim spec loading `folke/tokyonight.nvim`), `shell.lock.toml` (six `[lock]` keys),
`vscode.json` = `{"name":"Tokyo Night","extension":"enkia.tokyo-night"}`, `backgrounds/` =
`0-winding-road.webp 1-quattro.webp 2-swirl-buck.webp 3-sunset-lake.webp 4-omakub.webp 5-oma-cityscape.jpg 6-oma.webp omarchy.webp`.

**Templates (`default/themed/*.tpl` → `~/.local/state/omarchy/current/theme/<name>`) and who reads them**

| template | rendered file | consumer |
|---|---|---|
| alacritty.toml.tpl | alacritty.toml | `~/.config/alacritty/alacritty.toml` `general.import`; `omarchy-restart-terminal` touches it |
| btop.theme.tpl | btop.theme | `~/.config/btop/themes/current.theme` symlink (install/user/theme.sh), `color_theme = "current"`; `omarchy-restart-btop` SIGUSR2 |
| chromium.theme.tpl | chromium.theme (`{{ background_rgb }}`) | `omarchy-theme-set-browser` → `omarchy-theme-set-browser-policy` → `/etc/{chromium,opt/chrome,opt/edge,brave}/policies/managed/color.json` |
| claude.json.tpl | claude.json | `omarchy-theme-set-claude` → `~/.claude/themes/omarchy.json` |
| foot.ini.tpl | foot.ini | `~/.config/foot/foot.ini` `include=`; running foot retinted via OSC by `omarchy-theme-set-foot` |
| ghostty.conf.tpl | ghostty.conf | `~/.config/ghostty/config` `config-file = ?…`; SIGUSR2 |
| gum_env.lua.tpl | gum_env.lua | Hyprland `default/hypr/envs.lua` `require_optional.module("omarchy.current.theme.gum_env")`; `omarchy-restart-gum`; `omarchy-theme-set-tmux` exports same env into tmux |
| helix.toml.tpl | helix.toml | helix theme; `omarchy-restart-helix` |
| hermes.yaml.tpl | hermes.yaml | `omarchy-theme-set-hermes` → `~/.hermes/skins/omarchy.yaml` (+ profiles) |
| hyprland.lua.tpl | hyprland.lua (`hypr_gradient` borders) | `default/hypr/omarchy.lua` `require_optional.module("omarchy.current.theme.hyprland")`; `omarchy-restart-hyprctl` = `hyprctl reload` |
| hyprland-preview-share-picker.css.tpl | hyprland-preview-share-picker.css | `config/hyprland-preview-share-picker/config.yaml` stylesheets |
| keyboard.rgb.tpl | keyboard.rgb (`{{ accent }}`) | `omarchy-theme-set-keyboard-{asus-rog,f16}` (asusctl / qmk_hid) |
| kitty.conf.tpl | kitty.conf | `~/.config/kitty/kitty.conf` `include`; SIGUSR1 |
| neovim.lua.tpl | neovim.lua (aether.nvim spec) | omarchy-nvim LazyVim spec (nvim restart needed) |
| obsidian.css.tpl | obsidian.css | `omarchy-theme-set-obsidian` → `<vault>/.obsidian/themes/Omarchy/theme.css` + manifest.json |
| pi.json.tpl | pi.json | `omarchy-theme-set-pi` → `~/.pi/agent/themes/omarchy-system.json`; `--activate` sets `settings.json` theme |
| shell.toml.tpl | shell.toml (13 sections: bar, hyprland, controls, spacing, font, popups, tooltip, notifications, launcher, menu, polkit, lock, image-picker) | omarchy-shell `Color`/`Style` singletons via `shell applyTheme` IPC; `shell.<section>.toml` in a theme replaces one section |
| t3code.json.tpl | t3code.json | `omarchy-theme-set-t3code` → `~/.t3/userdata/themes/omarchy.json` (skips if `{{` left unresolved) |
| vscode-theme.json.tpl | vscode-theme.json | `omarchy-theme-set-vscode` local extension `local.omarchy-theme` for code / code-insiders / codium / `/usr/bin/cursor` |

Placeholder forms (`omarchy-theme-set-templates`): `{{ key }}`, `{{ key_strip }}`, `{{ key_rgb }}`,
`{{ mix|mix_strip|mix_rgb a b 30% }}`, `{{ hypr_gradient key fallback }}`, `{{ shell_gradient key fallback }}`,
`{{ gradient_start key fallback }}`. Template rendering only runs when the staged theme has `colors.toml`;
a file already in the staged theme is never overwritten by a template; user templates
`~/.config/omarchy/themed/*.tpl` run first and shadow built-ins with the same output name
(`config/omarchy/themed/alacritty.toml.tpl.sample` ships as the example).

**Commands and flags**

Theme:
- `omarchy-theme-set <name>` — name is lowercased, spaces→`-`, `<…>` stripped; rejects empty / leading `.` / containing `/` ("Invalid theme name"); "Theme 'x' does not exist" if in neither `$OMARCHY_PATH/themes` nor `~/.config/omarchy/themes`; usage when no arg. Env: `OMARCHY_THEME_HEADLESS=1`/`OMARCHY_THEME_OFFLINE=1` (no shell IPC, no retint hooks), `OMARCHY_THEME_SKIP_BACKGROUND=1`. Serialised on `$XDG_RUNTIME_DIR/omarchy-theme-set.lock`. Writes `current/theme.name`, `current/theme/`, `current/background`; fires hook `theme-set <name>`; runs post-hooks in parallel: restart-terminal, restart-hyprctl, restart-btop, restart-opencode, restart-helix, set-foot, set-tmux, set-gnome, set-pi, set-claude, set-hermes, set-t3code, set-browser, set-vscode, set-obsidian, set-keyboard; then `omarchy-theme-switcher --preload` and `omarchy-theme-bg-cache &`. (HEAD) Denylist for git-cloned themes: `*.lua`, `alacritty.toml foot.ini ghostty.conf kitty.conf vscode.json`, any symlink; prints "Ignored in …: …" on stderr. [`bin/omarchy-theme-set`]
- `omarchy-theme-set-templates` (hidden) — renders into `current/next-theme`. [`bin/omarchy-theme-set-templates`]
- `omarchy-theme-switcher [--preload]` — image grid picker (`omarchy-menu-images --print-name --show-labels --filterable --lazy-thumbnails --selected <current>`), caches previews in `~/.cache/omarchy/theme-selector/previews/`. [`bin/omarchy-theme-switcher`]
- `omarchy-theme-list` — union of user + stock dirs, title-cased ("Tokyo Night"). [`bin/omarchy-theme-list`]
- `omarchy-theme-current` — title-cased `theme.name` or "Unknown". [`bin/omarchy-theme-current`]
- `omarchy-theme-dir <name>` — user dir if present else stock dir (no existence check on stock). [`bin/omarchy-theme-dir`]
- `omarchy-theme-extras` — lists `~/.config/omarchy/themes/*` having a real `.git` dir; exit 1 when none. [`bin/omarchy-theme-extras`]
- `omarchy-theme-update` — `git pull` in every extra. [`bin/omarchy-theme-update`]
- `omarchy-theme-install [url]` — gum prompt when no arg (Esc → exit 1); `omarchy-git-url-check` (refuses `-…`, `helper::…`, non-allowlisted `scheme://`; allows ssh git git+ssh ssh+git http https ftp ftps **file**); name = basename minus `omarchy-` prefix / `-theme` suffix, must match `^[a-z0-9_][a-z0-9._+-]*$`; removes an existing dir of that name; `git clone`; then `omarchy-theme-set`. [`bin/omarchy-theme-install`]
- `omarchy-theme-remove [name]` — picker (`omarchy-menu-select "Remove extra theme"`) when no arg and extras exist, else "No extra themes installed." exit 1; only removes from `~/.config/omarchy/themes` ("Error: Theme 'x' not found." for stock names); silent exit 1 for `.x` / `a/b`; notification "Theme removed". **No guard against removing the active theme.** [`bin/omarchy-theme-remove`]
- `omarchy-theme-refresh` — re-set current theme with `OMARCHY_THEME_SKIP_BACKGROUND=1`. [`bin/omarchy-theme-refresh`]
- `omarchy-theme-color [--file f] (--all | --raw | <key> [fallback])` — resolver with legacy aliases, derived shades, `mode` precedence (`mode` → `theme_type` → `light.mode` file → background luminance → dark); exit 1 when key unresolved; usage exit 1 on `--all key` or nothing. [`bin/omarchy-theme-color`]
- `omarchy-theme-colors-from-alacritty <dir>` — writes `colors.toml` from `alacritty.toml`; "Warning: Cannot extract all normal colors" when `[colors.normal]` incomplete. [`bin/omarchy-theme-colors-from-alacritty`]
- `omarchy-theme-osc [colors.toml]` — OSC 10/11/12/17/19 + `4;n` sequences. [`bin/omarchy-theme-osc`]
- `omarchy-theme-bg-next` — cycles union of `current/theme/backgrounds/` and `~/.config/omarchy/backgrounds/<theme>/` (sorted), "No background was found for theme" notification when empty. **Not bound to any hotkey at HEAD.** [`bin/omarchy-theme-bg-next`]
- `omarchy-theme-bg-set <path>` — `realpath`, "File does not exist" exit 1, symlinks `current/background`, `omarchy-shell -q background set`. [`bin/omarchy-theme-bg-set`]
- `omarchy-theme-bg-current` — humanised basename ("0-winding-road.webp" → "Winding Road"). [`bin/omarchy-theme-bg-current`]
- `omarchy-theme-bg-switcher` — `omarchy-menu-images --selected <current> <theme bgs> <user bgs>` (no labels, not filterable). [`bin/omarchy-theme-bg-switcher`]
- `omarchy-theme-bg-install` — mkdir + Nautilus at `~/.config/omarchy/backgrounds/<theme>/`. [`bin/omarchy-theme-bg-install`]
- `omarchy-theme-bg-cache` — `omarchy-menu-images --cache-only`. [`bin/omarchy-theme-bg-cache`]
- App syncs (hidden): `omarchy-theme-set-browser` (no flags; exit = policy write status), `omarchy-theme-set-browser-policy <rrggbb>` (6 lowercase hex only; root via NOPASSWD sudoers `etc/sudoers.d/omarchy-theme-browser`, else pkexec), `omarchy-theme-set-claude [--activate]`, `omarchy-theme-set-pi [--activate]`, `omarchy-theme-set-hermes [--activate] [--wait]`, `omarchy-theme-set-t3code`, `omarchy-theme-set-vscode` (honours toggles `skip-vscode-theme-changes`, `skip-vscode-insiders-theme-changes`, `skip-codium-theme-changes`, `skip-cursor-theme-changes`), `omarchy-theme-set-obsidian` (vaults from `~/.config/obsidian/obsidian.json`), `omarchy-theme-set-tmux`, `omarchy-theme-set-foot`, `omarchy-theme-set-gnome` (color-scheme prefer-light/dark, gtk-theme Adwaita/Adwaita-dark, icon-theme from `icons.theme` else Yaru-blue), `omarchy-theme-set-keyboard{,-asus-rog,-f16}`.

Fonts:
- `omarchy-font-list` — `fc-list :spacing=100` minus emoji/signwriting/omarchy. [`bin/omarchy-font-list`]
- `omarchy-font-current` — `fc-match monospace` first family. [`bin/omarchy-font-current`]
- `omarchy-font-set <family>` — `-h/--help` usage 0; empty → usage 1; "Font 'x' not found." 1; edits alacritty/kitty/ghostty/foot configs when present; writes `~/.config/fontconfig/fonts.conf` (prepend_first monospace); `omarchy-restart-shell`; notifications "You must restart Ghostty/Foot to see font change" when running; hook `font-set <family>`. [`bin/omarchy-font-set`]
- `omarchy-install-font <display> <pkg> <family>` — floating terminal: `omarchy-pkg-add` then `omarchy-font-set`. Menu offers Cascadia Mono, Meslo LG Mono, Fira Code, Victor Code, Bitstream Vera Mono, Iosevka. [`bin/omarchy-install-font`, menu `install.style.font.*`]
- Defaults: `50-omarchy.conf` maps monospace → JetBrainsMono Nerd Font, sans → Liberation Sans, serif → Liberation Serif; base package `ttf-jetbrains-mono-nerd-basic`. Icon font `omarchy.ttf` U+E900..U+E90E (Omarchy, Pi, OpenCode, omp, Grok, Codex, LM Studio, Ollama, T3 Code, Ori, Hermes, Perplexity, OpenClaw, Cursor, Claude), used by menu entries with `"iconFont":"omarchy"`.
- `omarchy-dev-font [list|add <name> <svg|url> [--codepoint U+E9xx] [--label]] [--font PATH]` — appends a glyph; errors: "no viewBox", "expected a single <path>, found N", "U+E9xx is already used", "could not fetch", "no font at". [`bin/omarchy-dev-font`]
- `omarchy-dev-theme-preview [name|dir|colors.toml] [--no-color|--plain] [--no-osc] [--osc]` — palette report ("Theme:", "File:", "Mode:", contrast, ramps); "Theme not found: x" exit 1; applies OSC to the terminal when stdout is a tty. [`bin/omarchy-dev-theme-preview`]

Branding:
- `omarchy-branding-about image|text|reset` — image: portal file chooser (png/svg) → `omarchy-transcode-ascii … --width 54 --height 26` → `~/.config/omarchy/branding/about.txt` → relaunch About; text: editor; reset: copies `$OMARCHY_PATH/icon.txt`; other → usage exit 1. [`bin/omarchy-branding-about`]
- `omarchy-branding-screensaver image|text|reset` — same for `screensaver.txt` from `$OMARCHY_PATH/logo.txt`, relaunches `omarchy-launch-screensaver force`. [`bin/omarchy-branding-screensaver`]
- `omarchy-branding-about-animation` — sourced library (sheen frames); refuses logos with `$`, wide glyphs, or wider than the window. [`bin/omarchy-branding-about-animation`]

Plymouth:
- `omarchy-plymouth-list` — themes having `preview-unlock.png` (all 22). [`bin/omarchy-plymouth-list`]
- `omarchy-plymouth-current` — "default" if installed `logo.png` == `default/plymouth/logo.png`, else first theme whose `unlock.png` matches byte-for-byte (vantablack/white tie → "vantablack"). [`bin/omarchy-plymouth-current`]
- `omarchy-plymouth-switcher` — image picker of `preview-unlock.png`s + "default". [`bin/omarchy-plymouth-switcher`]
- `omarchy-plymouth-preview <bg> <text> <logo.png> <out.png>` — magick composite, opens `imv -f`; validates hex and logo path. [`bin/omarchy-plymouth-preview`]
- `omarchy-plymouth-set <bg> <text> <logo.png> | --refresh-default | --refresh-sddm-default` — refuses EUID 0 ("run … as your user, not under sudo"), bad hex, missing logo, symlink logo; single `sudo bash -c` transaction (validates root-owned trusted tree, ≤64 MiB assets, atomic publish to `/usr/share/plymouth/themes/omarchy` and `/usr/share/sddm/themes/omarchy`), then `sudo plymouth-set-default-theme omarchy` and `sudo limine-mkinitcpio` (or `mkinitcpio -P`). [`bin/omarchy-plymouth-set`]
- `omarchy-plymouth-set-by-theme <name>` — `background`/`foreground` from the theme's `colors.toml` + `unlock.png` → `omarchy-plymouth-set`. [`bin/omarchy-plymouth-set-by-theme`]
- `omarchy-plymouth-reset` — `omarchy-refresh-plymouth` + `omarchy-refresh-sddm`. [`bin/omarchy-plymouth-reset`]

Refresh / apply:
- `omarchy-refresh-config <path-under-.config>` — copies `$OMARCHY_PATH/config/<path>`; backs up to `<file>.bak.<epoch>` only when content differs, prints red "Replaced … Saved backup as …" + `diff`; "Not a shipped user config: x" exit 1; usage exit 1. [`bin/omarchy-refresh-config`]
- `omarchy-refresh-hyprland` (7 hypr files + toggles/flags.lua), `-hyprsunset` (+restart), `-tmux` (+restart), `-shell` (shell.json + `omarchy-bar defaults` + restart-shell), `-herdr` (HEAD; herdr may be absent on 4.0.2), `-chromium` (flags.conf + native hosts, keeps Google accounts), `-applications` (copies `applications/*.desktop`, `Alacritty.desktop` if present, mise wrappers, `update-desktop-database`), `-pacman [stable|rc|edge]` (sudo; backs up first, "Invalid channel" exit 1, then `-Syyuu --noconfirm`), `-limine` (sudo; `limine.conf.bak`, `limine-update`, `limine-snapper-sync`), `-plymouth` (= `plymouth-set --refresh-default`), `-sddm` (= `plymouth-set --refresh-sddm-default`).
- `omarchy-apply-hardware --install-user U | --defer-provisioning` and `omarchy-apply-system --install-user U [--first-install|--upgrade] | --defer-provisioning --first-install` — root only ("must run as root"), "--install-user must name the target non-root user", "user 'x' does not exist", "Unknown option"; `-h`. [`bin/omarchy-apply-hardware`, `bin/omarchy-apply-system`]
- `omarchy-apply-lock` — writes `/etc/pam.d/omarchy-lock-password`; `omarchy-lock-fingerprint` only when `fprintd-list` finds a finger, else removes it; prints "Lock screen authentication configured." when the shell answers. [`bin/omarchy-apply-lock`]

**Menu paths and hotkeys**

- `Super+Space` → Omarchy menu root; `Super+Escape` → System menu; `Super+Shift+Ctrl+Space` → **Theme picker** (`omarchy-menu toggle theme` → alias of `style.theme`); `Super+Ctrl+Space` → **Background picker** (`omarchy-menu toggle background`). No "theme next"/"background next" hotkey exists at HEAD. [`default/hypr/bindings/utilities.lua:17-18`]
- `Style → Theme` (`style.theme`: `omarchy-theme-switcher` → `omarchy-theme-set`), `Style → Background` (`omarchy-theme-bg-switcher` → `omarchy-theme-bg-set`), `Style → Unlock` (`omarchy-plymouth-switcher`; "default" → `omarchy-plymouth-reset`, else `omarchy-plymouth-set-by-theme <name>` in a floating presentation terminal), `Style → Font` (provider `fonts`: rows from `omarchy-font-list`, current from `omarchy-font-current`, action `omarchy-font-set <quoted>`), `Style → About → Edit Text | Set From Image | Restore Default`, `Style → Screensaver → Edit Text | Set From Image | Restore Default`. [`default/omarchy/omarchy-menu.jsonc:104-123`, `shell/plugins/menu/Menu.qml:270`]
- `About` (root, `omarchy-launch-about`); `System → Screensaver` (`omarchy-launch-screensaver force`). [`omarchy-menu.jsonc:32,36`]
- `Install → Style → Theme` (`omarchy-theme-install` in floating terminal), `Install → Style → Background` (`omarchy-theme-bg-install`), `Install → Style → Font → {Cascadia Mono, Meslo LG Mono, Fira Code, Victor Code, Bitstream Vera Mono, Iosevka}`. [`omarchy-menu.jsonc:201-209`]
- `Remove → Theme` (`omarchy-theme-remove`). [`omarchy-menu.jsonc:291`]
- `Update → Extra Themes` (shown only when `omarchy-theme-extras` succeeds; `omarchy-theme-update`), `Update → Config → {Hyprland, Hyprsunset, Plymouth, Tmux, Shell}` (`omarchy-refresh-*` in floating terminal). [`omarchy-menu.jsonc:356,369-373`]
- Floating presentation terminals end with "● Done! Press any key to close..." or "● Failed (exit code N)! Press any key to close..." (`omarchy-show-done`).

**State and user-editable files**

- `~/.local/state/omarchy/current/{theme.name,theme/,next-theme/,background}`; `~/.cache/omarchy/{theme-selector,unlock-selector,background-transitions}`.
- `~/.config/omarchy/themes/<name>/` (user/overlay themes), `~/.config/omarchy/backgrounds/<theme>/`, `~/.config/omarchy/themed/*.tpl`, `~/.config/omarchy/branding/{about,screensaver}.txt`, `~/.config/omarchy/hooks/{theme-set,font-set}[.d/]`, `~/.config/fontconfig/fonts.conf`.
- Root: `/usr/share/plymouth/themes/omarchy/`, `/usr/share/sddm/themes/omarchy/`, `/etc/*/policies/managed/color.json`, `/etc/pam.d/omarchy-lock-*`, `/boot/limine.conf`, `/etc/pacman.conf`.

## Observations

1. **Theme count is 22, not 24.** Five are light (`catppuccin-latte`, `flexoki-light`, `lupine`, `rose-pine`, `white`); the rest dark. Light/dark is decided by `mode` in `colors.toml`; there are no `light.mode` files in the tree, so the marker path in `omarchy-theme-color` is exercised only by user themes.
2. **There is no `theme-next` and no hotkey for background-next.** `omarchy-theme-bg-next` exists as a CLI only (zero references outside itself). The hotkeys `Super+Shift+Ctrl+Space` / `Super+Ctrl+Space` open the *pickers*. "Cycle all themes" therefore has to be a CLI loop over `omarchy theme list`.
3. **Re-setting the current theme advances the wallpaper.** `choose_theme_background` picks the entry *after* the current symlink target, so `omarchy-theme-set tokyo-night` while on Tokyo Night moves from "Winding Road" to "Quattro". `omarchy-theme-refresh` deliberately avoids this with `OMARCHY_THEME_SKIP_BACKGROUND=1`. Switching to another theme also lands on that theme's *next* background if the current filename exists there (index carried over by basename), otherwise its first.
4. **`omarchy-theme-remove` will delete the active user theme without complaint.** The desktop keeps the already-rendered `current/theme`, but `omarchy-theme-refresh`, `omarchy-theme-set <same>`, and the Unlock/Plymouth path then fail with "Theme 'x' does not exist". Stock themes cannot be removed at all ("not found", because it only looks in `~/.config/omarchy/themes`). Candidate defect to report rather than a hard failure.
5. **Plymouth changes are slow and need a reboot to prove.** `omarchy-plymouth-set` prompts for the sudo password inside the floating terminal, runs ImageMagick recolours and then `limine-mkinitcpio` (2 vCPU: expect 1–4 minutes). `omarchy-plymouth-current` is byte-comparison based and cannot distinguish `white` from `vantablack` (identical `unlock.png`; reports `vantablack`). `omarchy-plymouth-set-by-theme <unknown>` fails with the unhelpful "Invalid background color:  (expected #RRGGBB)" because `colors.toml` is missing (awk error first).
6. **Default terminal on the minted disk is foot** (`Super+Enter`). Foot cannot reload its config, so theme switches retint *running* foot windows purely through OSC escape sequences (`omarchy-theme-set-foot`), and a font change only takes effect in *new* foot windows (notification "You must restart Foot to see font change"). Proof screenshots of a font change must use a freshly opened terminal.
7. **Stock monospace fonts are few.** `omarchy font list` on 4.0.2 will show roughly JetBrainsMono Nerd Font, Liberation Mono, Noto Sans Mono, DejaVu Sans Mono (whatever `fc-list :spacing=100` finds). Extra Nerd Fonts need `Install → Style → Font` (NET, pacman download ~10–30 MB).
8. **Browser accent is written as root without a password** via `etc/sudoers.d/omarchy-theme-browser` (exact 6-hex glob). If the sudoers rule is missing on 4.0.2 the fallback is `pkexec`, which pops a polkit dialog *during every theme switch* — a visible regression the driver should report.
9. **Install-from-git filtering (HEAD).** A cloned theme's `*.lua`, terminal configs and `vscode.json` are dropped at staging with "Ignored in ~/.config/omarchy/themes/<name>: …" on stderr; a hand-made directory (no `.git`) or a symlink is staged in full. `file://` is an allowed transport, so the install path can be exercised **offline** with a local bare repo, and the NET variant against GitHub is only needed for the real-world URL.
10. **`omarchy-theme-set-pi --activate` runs at install**, so `~/.pi/agent/themes/omarchy-system.json` and `~/.pi/agent/settings.json` exist on a stock disk and update on every switch; `~/.claude`, `~/.hermes/config.yaml`, `~/.t3/userdata`, VS Code dirs do not exist, so those hooks exit 0 silently (software-path only).
11. **Retint hooks run in parallel and are not awaited by the picker**; `omarchy-theme-set` returns before btop/tmux/browser are done. Allow ~3 s before verifying dependents. The `flock` is released before the hooks, so two rapid switches queue only on the critical section.
12. **Every rendered file must be free of `{{`.** `omarchy-theme-set-t3code` explicitly checks and skips; nothing else does, so a raw `{{ placeholder }}` in `shell.toml` or `hyprland.lua` would break the shell / Hyprland reload. A cheap invariant: `grep -l '{{' ~/.local/state/omarchy/current/theme/*` must print nothing for every one of the 22 themes.
13. **`omarchy-refresh-config` produces no backup when the file was unmodified** (it copies, compares, and removes the identical backup). Only a *modified* file yields `.bak.<epoch>` plus the red "Replaced…" banner and a diff. `omarchy-refresh-pacman` copies its backups *before* validating the channel argument, so even the rejected call leaves `/etc/pacman.conf.bak`.
14. **`omarchy-apply-system` re-runs the whole system config/login/post-install tree** and `omarchy-refresh-pacman` runs a full `-Syyuu`; both are outside a ten-minute budget and can change the disk in ways later steps do not expect. Only their argument guards are proposed as tests.
15. **Menu pickers**: theme picker is filterable (typing narrows tiles) and labelled; the background and unlock pickers are not filterable and have no labels (unlock has labels). All three return the selection on Enter/click and nothing on Esc; the menu action then does nothing (`[[ -n $theme ]] &&`).
16. **GNOME settings follow the theme**: `color-scheme` prefer-dark/prefer-light, `gtk-theme` Adwaita-dark/Adwaita, `icon-theme` from `icons.theme`. This is the most visible light/dark proof (Nautilus chrome flips).
17. **Video backgrounds**: no theme ships a video; `.mp4/.webm/...` are accepted by `bg-set`, `bg-next`, the pickers and `theme-set` (video transitions skip the snapshot path). A test video has to be synthesised in the guest (ffmpeg is pulled in by `qt6-multimedia-ffmpeg`/`gpu-screen-recorder`); with no 3D acceleration playback is software-decoded — fine at 640×360.
18. Theme picker previews are symlinked into `~/.cache/omarchy/theme-selector/previews/<name>.<ext>`; a user theme without `preview.png` falls back to its first background, and a *user overlay* of a stock theme without a preview inherits the stock preview.
19. `omarchy-theme-set` accepts display names: `omarchy theme set "Tokyo Night"` == `omarchy-theme-set tokyo-night`. `omarchy theme list` prints display names, so a driver can copy/paste from the list.
20. `omarchy-dev-font add` against the packaged font fails with a permission error (root-owned `/usr/share/omarchy/default/fonts/omarchy/omarchy.ttf`); use `--font` on a copy. `omarchy dev font list` output is the reliable proof that all 15 glyphs are present.

## Proposed tests

Every step below is one of the `./client` verbs: a hotkey or typed command (`send-keys`), a click
(`mouse …`), a screenshot (`get-image`), or a long output read back through `… | sudo tee /dev/ttyS0`
and `get-serial`. Everything happens inside the guest; the driver's terminal is `Super+Enter` (foot).
Every test ends on the stock Tokyo Night theme unless it says otherwise.

### theme-switch-menu   [VM-OK]
description: Switching the theme from Omarchy Menu → Style → Theme with the mouse re-skins the whole desktop and switching back restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and leave it open; note its navy Tokyo Night background.
  * Press Super+Space, click `Style`, then click `Theme`.
  ** A grid of labelled theme thumbnails opens with `Tokyo Night` highlighted.
  * Click the `Gruvbox` tile with the mouse. Do not use the keyboard for the selection.
  ** The wallpaper, bar and menu colours turn warm brown/olive and the open terminal's background turns dark grey, all without restarting anything. Allow up to 5 s.
  * In the terminal type `omarchy-theme-current` and press Enter; it prints `Gruvbox`.
  * Repeat the menu path and click the `Tokyo Night` tile with the mouse.
  ** The desktop returns to the navy Tokyo Night look; the wallpaper may be a *different* Tokyo Night image than at the start — that is expected (switching lands on the theme's next background).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Scroll the grid with the mouse wheel if a tile is off-screen; tiles are labelled.
  * ./client-with-image returns a screenshot after each action; double-check the mouse position before clicking a tile.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the grid with Tokyo Night highlighted; the Gruvbox desktop with the retinted terminal; the terminal showing `Gruvbox`; the restored navy desktop
  ** The mouse, not the keyboard, made both selections
  * If unsuccessful
  ** Screenshot of the picker or desktop where it stalled, and the terminal output of `omarchy-theme-current`
covers: bin/omarchy-theme-switcher, bin/omarchy-theme-set, bin/omarchy-theme-current, omarchy-menu.jsonc style.theme, test/shell.d/background-test.sh

### theme-switch-hotkey   [VM-OK]
description: Super+Shift+Ctrl+Space opens the theme picker directly; typing filters it and Enter applies, Escape leaves the theme alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Ctrl+Space. The theme thumbnail grid opens without going through the main menu.
  * Press Escape. The grid closes and the wallpaper is exactly as before.
  * Press Super+Shift+Ctrl+Space again and type `nor`.
  ** The grid narrows to the `Nord` tile.
  * Press Enter. The desktop switches to Nord (blue-grey wallpaper and bar).
  * Press Super+Shift+Ctrl+Space, type `tokyo`, press Enter. The desktop is Tokyo Night again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If typing does not filter, move the highlight with the arrow keys instead and report that filtering did not work.
  * The highlight starts on the current theme.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Grid opened by the hotkey; unchanged desktop after Escape; the filtered grid showing only Nord; the Nord desktop; the restored Tokyo Night desktop
  * If unsuccessful
  ** Screenshot of what the hotkey opened (or did not)
covers: default/hypr/bindings/utilities.lua (SUPER+SHIFT+CTRL+SPACE), bin/omarchy-theme-switcher (--filterable), bin/omarchy-theme-set

### theme-switch-cli-rejects-bad-names   [VM-OK]
description: `omarchy theme set` applies a theme by its display name from a terminal and refuses unknown, empty or path-like names without touching the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme list | sudo tee /dev/ttyS0` (password `prime`). Read the serial: 22 title-cased names including `Tokyo Night`, `Gruvbox`, `Catppuccin Latte`, `White`.
  * Type `omarchy theme set Catppuccin`. The desktop switches to Catppuccin (purple/blue); `omarchy theme current` prints `Catppuccin`.
  * Type `omarchy-theme-set` alone → `Usage: omarchy-theme-set <theme-name>`; `echo $?` → `1`.
  * Type `omarchy-theme-set not-a-theme` → `Theme 'not-a-theme' does not exist`, exit `1`; the desktop stays Catppuccin.
  * Type `omarchy-theme-set ../gruvbox` → `Invalid theme name: ../gruvbox`, exit `1`.
  * Type `omarchy theme set "Tokyo Night"` (quoted display name). The desktop returns to Tokyo Night.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The commands are instant; one screenshot after each is enough.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial with the 22-entry list; Catppuccin desktop; the three refusal messages with exit code 1; restored Tokyo Night desktop
  * If unsuccessful
  ** Terminal output of the failing command and a desktop screenshot
covers: bin/omarchy-theme-set (argument guards, name normalisation), bin/omarchy-theme-list, bin/omarchy-theme-current, bin/omarchy

### theme-cycle-all-22   [VM-OK] [SLOW]
description: Every shipped theme applies cleanly from a terminal loop — a different wallpaper and palette each time, no broken shell, no unrendered placeholder left in any generated file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -v` (password `prime`) so the loop can write to the serial console.
  * Type this loop on one line and press Enter:
  ** `for t in $(ls /usr/share/omarchy/themes); do omarchy-theme-set "$t" && sleep 4 && echo "== $t: mode=$(omarchy-theme-color mode) leftovers=$(grep -Il '{{' ~/.local/state/omarchy/current/theme/* 2>/dev/null | wc -l)"; done 2>&1 | sudo tee /dev/ttyS0`
  * Take a screenshot roughly every 5 seconds while it runs (22 themes ≈ 2 minutes) so every theme's desktop is captured.
  ** The bar must stay visible throughout; if the screen goes black or the bar disappears, stop and report which theme.
  * When the prompt returns, read the serial: 22 `== <theme>:` lines, `leftovers=0` on every line, `mode=light` on exactly catppuccin-latte, flexoki-light, lupine, rose-pine and white, `mode=dark` on the other 17.
  * Type `omarchy-theme-set tokyo-night`; the desktop is back to Tokyo Night.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never sleep more than 5 s between screenshots; poll with get-image instead of waiting for the loop.
  * The `leftovers` count is the one fact the screen cannot show: a raw `{{ … }}` left in a generated file.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** 22 desktop screenshots with visibly different wallpapers/palettes; serial log with 22 lines, all `leftovers=0`, 5 light / 17 dark
  * If unsuccessful
  ** The serial line that disagrees and the screenshot of the broken desktop
covers: bin/omarchy-theme-set, bin/omarchy-theme-set-templates, bin/omarchy-theme-color (mode), themes/*, default/themed/*.tpl

### theme-light-dark-gnome-settings   [VM-OK]
description: A light theme flips GTK apps (Nautilus) to light chrome and the theme's icon colour; a dark theme flips them back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-set tokyo-night` (the install-time apply never wrote the GTK settings, so normalise first).
  * Type `nautilus &`. The Files window opens with dark chrome and magenta folder icons.
  * Type `omarchy-theme-set catppuccin-latte`. Within 5 s the wallpaper is pale and the Files window turns light with blue folder icons.
  * Type `omarchy-theme-set gruvbox`. Files is dark again, folders olive.
  * Type `omarchy-theme-set white`; Files is light once more with grey folders.
  * Type `gsettings get org.gnome.desktop.interface color-scheme` → `'prefer-light'` (the one fact the screen cannot state).
  * Type `omarchy-theme-set tokyo-night` and close Files (Ctrl+Q or Super+W on it).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nautilus follows the setting live; if it does not, close and reopen it and note that in the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Files dark with magenta icons; light with blue icons; dark with olive icons; light with grey icons; `'prefer-light'`; restored Tokyo Night
  * If unsuccessful
  ** The Files screenshot that did not flip and `gsettings get org.gnome.desktop.interface gtk-theme`
covers: bin/omarchy-theme-set-gnome, themes/*/icons.theme, themes/*/colors.toml mode, bin/omarchy-theme-color

### theme-picker-cancel-keeps-theme   [VM-OK]
description: Cancelling the theme, background or unlock picker with Escape leaves the desktop exactly as it was and starts nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot of the desktop as the baseline.
  * Press Super+Space → `Style` → `Theme`. Move the highlight with the arrow keys to a different tile (do not press Enter), then press Escape.
  * Press Super+Space → `Style` → `Background`. Move to a different thumbnail, press Escape.
  * Press Super+Space → `Style` → `Unlock`. Move to a different thumbnail, press Escape.
  ** No floating terminal and no password prompt may appear.
  * Compare with the baseline: same wallpaper, same colours, no new window.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Unlock picker shows boot-screen previews with names; `default` is one of them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three picker screenshots with a non-current tile highlighted; the final desktop identical to the baseline
  * If unsuccessful
  ** Screenshot of whatever Escape triggered (theme change, floating terminal, sudo prompt)
covers: omarchy-menu.jsonc style.theme/style.background/style.unlock (`[[ -n $x ]] &&` guards), bin/omarchy-theme-switcher, bin/omarchy-theme-bg-switcher, bin/omarchy-plymouth-switcher

### theme-terminal-retint-live   [VM-OK]
description: A theme switch repaints terminals that are already open (no restart) and new terminals open in the new palette.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls --color=always /usr/share/omarchy/bin | head -40` so coloured text is on screen.
  * Open a second terminal with Super+Enter (it tiles beside the first) and type `omarchy-theme-set gruvbox`.
  ** Within ~3 s the first terminal's background turns dark grey and its text warm, with the `ls` output still there.
  * Open a third terminal with Super+Enter; it opens already in Gruvbox colours.
  * In any terminal type `omarchy-theme-set tokyo-night`; all three terminals repaint to navy.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep both terminals visible; side-by-side before/after screenshots are the proof.
  * Foot cannot reload its config; this repaint is done with escape sequences, so it should be near-instant.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal 1 in Tokyo Night; the same terminal in Gruvbox with its earlier output intact; a new terminal in Gruvbox; all back to navy
  * If unsuccessful
  ** Screenshot of a terminal that kept its old colours
covers: bin/omarchy-theme-set-foot, bin/omarchy-theme-osc, default/themed/foot.ini.tpl, config/foot/foot.ini include, bin/omarchy-restart-terminal

### theme-btop-retint   [VM-OK]
description: The Activity monitor (btop) draws in the current theme and repaints live when the theme changes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+T. btop opens in a terminal window with Tokyo Night colours (blue/purple boxes).
  ** If nothing opens, open a terminal and type `btop`, and report the hotkey miss.
  * Open another terminal with Super+Enter and type `omarchy-theme-set retro-82`.
  ** Within 3 s btop's boxes change to the Retro-82 palette without being restarted (its uptime counter keeps running).
  * Type `omarchy-theme-set gruvbox`; btop repaints again in brown/olive.
  * Type `omarchy-theme-set tokyo-night`; btop is blue/purple again. Click on btop and press `q` to quit.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * btop may need a second to redraw after the signal; take two screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The same btop window in Tokyo Night, Retro-82, Gruvbox and Tokyo Night again
  * If unsuccessful
  ** btop screenshot with stale colours
covers: install/user/theme.sh (btop symlink), default/themed/btop.theme.tpl, themes/retro-82/btop.theme, bin/omarchy-restart-btop

### theme-neovim-colorscheme   [VM-OK]
description: Neovim's colourscheme follows the theme, whether the theme brings its own scheme (Tokyo Night, Gruvbox) or uses the generated palette (Ethereal).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `nvim /etc/os-release`. The buffer is in Tokyo Night colours. Type `:q` and Enter.
  * Type `omarchy-theme-set ethereal`, then `nvim /etc/os-release` again.
  ** The buffer background is near-black blue and the text peach. Quit with `:q`.
  * Type `omarchy-theme-set gruvbox`, then `nvim /etc/os-release`; the classic Gruvbox scheme (dark grey, cream text). Quit.
  * Type `omarchy-theme-set tokyo-night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first nvim start after a theme change may sync plugins (a Lazy window) for 10–20 s; poll with screenshots and press `q` to close it if it stays.
  * A red `Error` line at nvim start is a failure; capture it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three nvim screenshots with visibly different schemes matching the theme
  * If unsuccessful
  ** The nvim error text on screen
covers: default/themed/neovim.lua.tpl, themes/tokyo-night/neovim.lua, themes/gruvbox/neovim.lua, docs/theming.md (hand-written overrides win)

### theme-hyprland-border-and-overrides   [VM-OK]
description: The focused window's border takes the theme accent, and a theme with its own Hyprland file (Kanagawa off-white, Last Horizon gradient) overrides the generated colour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals with Super+Enter twice so one is focused and one is not. The focused one has a blue border, the other grey.
  * In the focused terminal type `omarchy-theme-set gruvbox`. The focused border turns teal.
  * Type `omarchy-theme-set kanagawa`. The focused border is off-white (that theme ships its own Hyprland file).
  * Type `omarchy-theme-set last-horizon`. The focused border shows a two-tone grey-to-white gradient.
  * Type `omarchy-theme-set tokyo-night`; the border is blue again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Borders are 2 px; take full-resolution screenshots and look at the window edges.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing the focused border blue, teal, off-white, gradient, blue
  * If unsuccessful
  ** Screenshot of a border that did not change; in a terminal `hyprctl reload` output
covers: default/themed/hyprland.lua.tpl (hypr_gradient), themes/kanagawa/hyprland.lua, themes/last-horizon/hyprland.lua, bin/omarchy-restart-hyprctl, default/hypr/omarchy.lua

### theme-shell-section-override   [VM-OK]
description: Tokyo Night's lock screen uses its own muted colours (a per-section shell override) while other themes' lock screens use the generated ones.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L. The lock screen's password field border and text are muted blue-grey, not the bright accent blue.
  ** The lock screen dims to black after a few seconds; keys still go to the password field.
  * Type `prime` and Enter to unlock.
  * Open a terminal with Super+Enter and type `omarchy-theme-set gruvbox`.
  * Press Super+Ctrl+L. The password field is now in Gruvbox cream/teal (generated colours). Unlock with `prime`.
  * Type `grep -c '^\[lock\]' ~/.local/state/omarchy/current/theme/shell.toml` → `1` (the override must not leave a duplicate section).
  * Type `omarchy-theme-set tokyo-night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the lock screen immediately after locking, before it dims.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Tokyo Night lock screen in muted blue-grey; Gruvbox lock screen in cream/teal; `1`; restored desktop
  * If unsuccessful
  ** The lock screen screenshot and the grep count
covers: bin/omarchy-theme-set-templates (apply_shell_section_overrides), themes/tokyo-night/shell.lock.toml, docs/theming.md "shell.toml"

### theme-user-theme-directory   [VM-OK]
description: A theme the user writes in `~/.config/omarchy/themes/<name>/` shows up in the list and the picker and applies; without backgrounds it warns instead of failing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type: `mkdir -p ~/.config/omarchy/themes/mytheme && sed 's/#282828/#102030/; s/#7daea3/#ff8800/' /usr/share/omarchy/themes/gruvbox/colors.toml > ~/.config/omarchy/themes/mytheme/colors.toml`
  * Type `omarchy-theme-set mytheme`.
  ** A toast `No background was found for theme` appears for ~2 s; the wallpaper stays, but the bar and menu recolour to navy with an orange accent.
  * Press Super+Shift+Ctrl+Space; a `Mytheme` tile is in the grid (a blank or generic thumbnail is fine, the label must be there). Press Escape.
  * Type `mkdir -p ~/.config/omarchy/themes/mytheme/backgrounds && cp /usr/share/omarchy/themes/nord/backgrounds/1-city-view.webp ~/.config/omarchy/themes/mytheme/backgrounds/ && omarchy-theme-set mytheme`. The wallpaper becomes the Nord city view with no toast.
  * Type `omarchy-theme-set tokyo-night && rm -rf ~/.config/omarchy/themes/mytheme`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot right after the first `omarchy-theme-set mytheme`; the toast is short.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The `No background was found for theme` toast with the navy/orange bar; the `Mytheme` tile; the city-view wallpaper; restored Tokyo Night
  * If unsuccessful
  ** Terminal output of `omarchy-theme-set mytheme`
covers: bin/omarchy-theme-set (user themes, set_theme_background failure path), bin/omarchy-theme-list, bin/omarchy-theme-switcher (preview fallback), test/shell.d/user-theme-test.sh, docs/theming.md

### theme-user-overlay-on-stock-theme   [VM-OK]
description: A user folder named like a stock theme overlays it — the user's colours win while the stock wallpapers stay — and user images in `~/.config/omarchy/backgrounds/<theme>/` join that theme's rotation.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/themes/gruvbox && sed 's/#7daea3/#ff0000/' /usr/share/omarchy/themes/gruvbox/colors.toml > ~/.config/omarchy/themes/gruvbox/colors.toml`.
  * Type `omarchy-theme-set gruvbox`. The wallpaper is a stock Gruvbox image but the focused window border and menu accent are pure red.
  * Type `mkdir -p ~/.config/omarchy/backgrounds/gruvbox && cp /usr/share/omarchy/themes/white/backgrounds/1-white.webp ~/.config/omarchy/backgrounds/gruvbox/zz-user.webp`.
  * Type `omarchy-theme-bg-next` and press Enter, repeating up to 7 times, until the wallpaper turns white.
  ** The user image is part of the cycle; its position depends on sort order.
  * Type `omarchy-theme-set tokyo-night && rm -rf ~/.config/omarchy/themes/gruvbox ~/.config/omarchy/backgrounds/gruvbox`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Press Super+Space between steps to see the red accent on the menu highlight.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Gruvbox wallpaper with a red border/accent; the white wallpaper reached through bg-next; restored Tokyo Night
  * If unsuccessful
  ** `ls ~/.local/state/omarchy/current/theme/backgrounds/` and the last wallpaper screenshot
covers: bin/omarchy-theme-set (overlay copy order), bin/omarchy-theme-bg-next (user backgrounds), docs/theming.md

### theme-user-templates   [VM-OK]
description: A user template in `~/.config/omarchy/themed/` is rendered with the theme's colours on every switch and can replace a built-in template of the same name.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/themed && printf 'bg={{ background }}\nacc={{ accent_strip }}\nmixed={{ mix background foreground 50%% }}\n' > ~/.config/omarchy/themed/mytest.txt.tpl && printf '# user kitty template\n' > ~/.config/omarchy/themed/kitty.conf.tpl`.
  * Type `omarchy-theme-refresh` (re-renders without changing the wallpaper — confirm the wallpaper did not change).
  * Type `cat ~/.local/state/omarchy/current/theme/mytest.txt ~/.local/state/omarchy/current/theme/kitty.conf`.
  ** Expected: `bg=#1a1b26`, `acc=7aa2f7`, `mixed=#62667e`, then the single line `# user kitty template` (the 27-line built-in was replaced).
  * Type `omarchy-theme-set nord && head -1 ~/.local/state/omarchy/current/theme/mytest.txt` → `bg=#2e3440`.
  * Type `rm ~/.config/omarchy/themed/*.tpl && omarchy-theme-set tokyo-night && wc -l ~/.local/state/omarchy/current/theme/kitty.conf` → `27` (built-in back) and `ls ~/.local/state/omarchy/current/theme/mytest.txt` → `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This feature only shows in files, so the terminal is the screen here; keep the terminal maximised (Super+F) for readable screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing the three rendered values and the one-line kitty.conf; the Nord re-render; the clean-up state
  * If unsuccessful
  ** `ls ~/.config/omarchy/themed/` and the rendered file contents
covers: bin/omarchy-theme-set-templates (user templates first, mix/strip), bin/omarchy-theme-refresh (SKIP_BACKGROUND), docs/theming.md "Template placeholders"

### theme-refresh-repairs-rendered-file   [VM-OK]
description: `omarchy-theme-refresh` regenerates the active theme's files after the user breaks one, without moving the wallpaper.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo 'broken=garbage' > ~/.local/state/omarchy/current/theme/foot.ini`.
  * Open a new terminal with Super+Enter. It opens in plain default colours (black background, white text) instead of Tokyo Night — the symptom.
  * In either terminal type `omarchy-theme-refresh`. It returns silently. The wallpaper does not change.
  * Open another new terminal with Super+Enter; it opens in Tokyo Night navy again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If foot refuses to start with the broken include, use the first terminal for the refresh.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** A plain black-and-white new terminal; a navy new terminal after the refresh; the same wallpaper throughout
  * If unsuccessful
  ** `omarchy-theme-refresh; echo $?` output and `head -3 ~/.local/state/omarchy/current/theme/foot.ini`
covers: bin/omarchy-theme-refresh, bin/omarchy-theme-set (OMARCHY_THEME_SKIP_BACKGROUND)

### theme-reset-current-advances-background   [VM-OK]
description: Re-applying the active theme moves to its next wallpaper, and switching to another theme starts on that theme's first wallpaper — the rule every other theme test has to expect.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-bg-current` (fresh disk: `Winding Road`).
  * Type `omarchy-theme-set tokyo-night` (the theme already active). The wallpaper changes; `omarchy-theme-bg-current` → `Quattro`.
  * Type it again → `Swirl Buck`.
  * Type `omarchy-theme-set nord`; `omarchy-theme-bg-current` → `Black Moon` (Nord's first).
  * Type `omarchy-theme-set tokyo-night`; `omarchy-theme-bg-current` → `Winding Road` (back to the first, since the Nord filename does not exist in Tokyo Night).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the starting name is not `Winding Road`, record it; the sequence must still advance one image at a time.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Five wallpaper screenshots with the matching names in the terminal
  * If unsuccessful
  ** `ls ~/.local/state/omarchy/current/theme/backgrounds/` and the observed sequence
covers: bin/omarchy-theme-set (choose_theme_background / choose_staged_theme_background), bin/omarchy-theme-bg-current

### theme-install-local-git-repo-filters-code   [VM-OK]
description: `omarchy theme install` clones a git URL and applies the theme, dropping the files a stranger's repo may not supply (Lua, terminal configs, vscode.json, symlinks) and naming them.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F to maximise it, and build a fake upstream repo by typing on one line:
  ** `mkdir -p /tmp/omarchy-forest-theme && cd /tmp/omarchy-forest-theme && sed 's/#2e3440/#003300/' /usr/share/omarchy/themes/nord/colors.toml > colors.toml && echo 'Yaru-red' > icons.theme && echo 'hl.config({})' > hyprland.lua && echo 'font_family Evil' > kitty.conf && echo '{"name":"x","extension":"evil.ext"}' > vscode.json && mkdir backgrounds && cp /usr/share/omarchy/themes/nord/backgrounds/1-city-view.webp backgrounds/ && ln -s /etc/passwd unlock.png && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init && cd ~`
  * Type `omarchy theme install file:///tmp/omarchy-forest-theme`.
  ** Expected after the clone lines: `Ignored in /home/prime/.config/omarchy/themes/forest: hyprland.lua kitty.conf unlock.png vscode.json` and `A theme installed from a git repo cannot supply Lua, a terminal config, or vscode.json.` The desktop becomes dark green with the Nord city-view wallpaper.
  * Type `ls ~/.local/state/omarchy/current/theme/ | sudo tee /dev/ttyS0` (password `prime`); read the serial: no `vscode.json`, no `unlock.png`; `kitty.conf` and `hyprland.lua` are present but generated (`grep -c Evil ~/.local/state/omarchy/current/theme/kitty.conf` → `0`).
  * Press Super+Space → `Update`: an `Extra Themes` entry is now listed. Press Escape.
  * Type `omarchy theme set tokyo-night && omarchy theme remove forest`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On a 4.0.2 disk the filter may not exist: if there is no `Ignored in` line and `vscode.json` was staged, report "staging filter not on this build" rather than failing the install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the clone and the two `Ignored…` lines; the dark-green Forest desktop; serial listing without vscode.json/unlock.png; the `Extra Themes` menu entry; restored Tokyo Night
  * If unsuccessful
  ** Full install output and the serial listing
covers: bin/omarchy-theme-install, bin/omarchy-git-url-check (file transport), bin/omarchy-theme-set (stage_installed_theme, denylist, symlink drop), bin/omarchy-theme-extras, omarchy-menu.jsonc update.themes, test/shell.d/theme-staging-test.sh, docs/theming.md

### theme-install-github-url   [VM-OK] [NET]
description: Install → Style → Theme asks for a git URL in a floating terminal and installs a community theme over HTTPS (~1–5 MB); cancelling the prompt installs nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Install` → `Style` → `Theme`. A floating terminal shows the Omarchy logo, `See https://omarchy.org/themes/` and a `Git repo URL` prompt.
  * Press Escape. The prompt closes with `● Failed (exit code 1)! Press any key to close...`; press a key. Nothing was installed.
  * Repeat the menu path; type `https://github.com/basecamp/omarchy-tokyo-night-theme.git` and press Enter.
  ** If the clone reports the repository does not exist, open Chromium, read a theme URL from https://omarchy.org/themes/, use it instead and record which.
  ** Clone progress, then the desktop switches to the installed theme, then `● Done! Press any key to close...`. Press a key.
  * Open a terminal with Super+Enter and type `omarchy theme update` → `Updating: <name>` and `Already up to date.`
  * Type `omarchy theme set tokyo-night && omarchy theme remove <name>`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clone over user-mode NAT can take 30–60 s; poll with screenshots.
  * The prompt takes literal text; do not type angle brackets.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The URL prompt; the Failed banner after Escape; clone output and Done; the installed theme's desktop; `Already up to date.`; restored Tokyo Night
  * If unsuccessful
  ** The floating terminal's error text (`Error: Failed to clone theme repo.` or git's message) and the URL used
covers: bin/omarchy-theme-install (gum prompt, empty URL), bin/omarchy-theme-update, omarchy-menu.jsonc install.style.theme, bin/omarchy-show-done

### theme-install-rejects-bad-urls   [VM-OK] [NET]
description: The theme installer refuses URLs that would run a git helper or yield an unsafe name, and a non-existent repository fails cleanly without leaving a half-installed theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme install https://github.com/omarchy/definitely-not-a-real-theme-xyz.git`.
  ** git reports the repository was not found, then `Error: Failed to clone theme repo.`; `echo $?` → `1`.
  * Type `omarchy theme install ext::sh%20-c%20id` → `omarchy-git-url-check: 'ext::…' names a git option or transport helper, not a repository.` (instant, no network).
  * Type `omarchy theme install gopher://example.org/x.git` → `… names the 'gopher' transport, which Omarchy does not clone from.`
  * Type `omarchy theme install https://example.org/..git` → `Error: 'https://example.org/..git' does not give a usable theme name.`
  * Type `ls ~/.config/omarchy/themes/` → empty; `omarchy-theme-current` → `Tokyo Night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only the first command touches the network; the other three must be refused instantly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the four refusal messages; empty themes directory; `Tokyo Night`
  * If unsuccessful
  ** Any command that exited 0 or a directory appearing under `~/.config/omarchy/themes/`
covers: bin/omarchy-theme-install (name allowlist, clone failure), bin/omarchy-git-url-check, test/shell.d/theme-install-guards-test.sh

### theme-remove-extra-theme   [VM-OK]
description: Remove → Theme lists only user-installed themes and deletes the chosen one with a notification; with none installed it says so.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for n in alpha beta; do mkdir -p ~/.config/omarchy/themes/$n && cp /usr/share/omarchy/themes/nord/colors.toml ~/.config/omarchy/themes/$n/; done`.
  * Type `omarchy theme remove alpha` → `Removed alpha` and a toast titled `Theme removed` with body `alpha`.
  * Press Super+Space → `Remove` → `Theme`. A small picker titled `Remove extra theme` lists only `beta` (no stock names). Click it with the mouse.
  ** Toast `Theme removed` / `beta`.
  * Press Super+Space → `Remove` → `Theme` again: with no extras nothing is removed; in the terminal `omarchy-theme-remove` prints `No extra themes installed.`
  * Type `ls ~/.config/omarchy/themes/` → empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is a compact list; Escape cancels it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Removed alpha` with its toast; the picker showing only beta; the beta toast; `No extra themes installed.`; empty directory
  * If unsuccessful
  ** The command output and the picker screenshot
covers: bin/omarchy-theme-remove, omarchy-menu.jsonc remove.theme, bin/omarchy-menu-select, bin/omarchy-notification-send

### theme-remove-rejects-stock-missing-and-paths   [VM-OK]
description: Theme removal cannot delete a shipped theme, an unknown name or a path-like name; the 22 stock themes stay intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme remove tokyo-night` → `Error: Theme 'tokyo-night' not found.`; `echo $?` → `1`.
  * Type `omarchy theme remove nope` → `Error: Theme 'nope' not found.`
  * Type `omarchy theme remove ../themes; echo $?` → no message, `1`.
  * Type `omarchy theme remove /tmp; echo $?` → no message, `1`; `ls /tmp` still works.
  * Type `ls /usr/share/omarchy/themes | wc -l` → `22`; the desktop is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All commands are instant; one screenshot of the terminal at the end covers them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the two `not found` errors, two silent exit-1s and `22`
  * If unsuccessful
  ** Any command exiting 0 or a count below 22
covers: bin/omarchy-theme-remove (guards), test/shell.d/theme-install-guards-test.sh (remove section)

### theme-remove-active-user-theme   [VM-OK]
description: Removing the theme that is currently active is not blocked: the desktop keeps its colours but the theme can no longer be re-applied — recorded so a future guard is noticed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/themes/gone && cp /usr/share/omarchy/themes/gruvbox/colors.toml ~/.config/omarchy/themes/gone/ && omarchy-theme-set gone`. The bar recolours to Gruvbox tones (toast about no background is expected).
  * Type `omarchy theme remove gone` → `Removed gone`; no warning that it was active.
  * The desktop is unchanged; `omarchy-theme-current` still prints `Gone`.
  * Type `omarchy-theme-refresh; echo $?` → `Theme 'gone' does not exist` and `1`.
  * Type `omarchy-theme-set tokyo-night`; the desktop recovers.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This passes when the behaviour matches the above; note in the report that no guard exists against removing the active theme.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Removed gone`; `Gone` still current; `Theme 'gone' does not exist` from refresh; recovered Tokyo Night
  * If unsuccessful
  ** A broken desktop (no bar) after the removal
covers: bin/omarchy-theme-remove (no active-theme guard), bin/omarchy-theme-refresh, bin/omarchy-theme-current

### theme-preview-palette-in-terminal   [VM-OK]
description: `omarchy dev theme-preview` shows a theme's palette, ramps and samples in the terminal, recolours only that terminal, and reports an unknown theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F to maximise, and type `omarchy dev theme-preview gruvbox`.
  ** Header `Theme: gruvbox`, `File: /usr/share/omarchy/themes/gruvbox/colors.toml`, `Mode:  dark`, a contrast ratio, then coloured swatch rows, a gradient strip, a `selected text` sample and ANSI strips. The terminal's own background turned Gruvbox grey (OSC applied to this terminal only).
  * Open a second terminal with Super+Enter; it is still Tokyo Night navy — the desktop theme did not change.
  * In the second terminal type `omarchy dev theme-preview white --no-osc`. Swatches are printed but this terminal stays navy; `Mode:  light`.
  * Type `omarchy dev theme-preview nope; echo $?` → `Theme not found: nope`, `1`.
  * Close both terminals (Super+W each).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The preview retints only the terminal it runs in; that is the point of the second terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Gruvbox preview in a Gruvbox-coloured terminal; a navy second terminal beside it; the white preview with the terminal still navy; `Theme not found: nope`
  * If unsuccessful
  ** The error text or a second terminal that changed colour
covers: bin/omarchy-dev-theme-preview, bin/omarchy-theme-osc, bin/omarchy-theme-color

### theme-legacy-alacritty-only-theme   [VM-OK]
description: A user theme in the old format (only an `alacritty.toml`) still gets a palette and applies; an incomplete one warns and leaves the desktop usable.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type on one line: `mkdir -p ~/.config/omarchy/themes/legacy && printf '[colors.primary]\nbackground = "#301010"\nforeground = "#f0e0e0"\n[colors.normal]\nblack = "#301010"\nred = "#ff5555"\ngreen = "#50fa7b"\nyellow = "#f1fa8c"\nblue = "#6272a4"\nmagenta = "#ff79c6"\ncyan = "#8be9fd"\nwhite = "#f0e0e0"\n' > ~/.config/omarchy/themes/legacy/alacritty.toml`
  * Type `omarchy-theme-set legacy`. The bar and the terminal turn dark maroon (toast about no background is expected).
  * Type `mkdir -p ~/.config/omarchy/themes/broken && printf '[colors.normal]\nblack = "#000000"\n' > ~/.config/omarchy/themes/broken/alacritty.toml && omarchy-theme-set broken`.
  ** Expected: `Warning: Cannot extract all normal colors from …/alacritty.toml, skipping generation`; the command still returns 0.
  * Press Super+Space: the menu still opens and the bar is still visible (the desktop survived a palette-less theme). Escape.
  * Type `omarchy-theme-set tokyo-night && rm -rf ~/.config/omarchy/themes/legacy ~/.config/omarchy/themes/broken`; the desktop is fully Tokyo Night.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar disappears or the shell crashes after `broken`, that is the finding — capture it and recover with the last step from the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Maroon bar/terminal for `legacy`; the Warning line; an open menu after `broken`; restored Tokyo Night
  * If unsuccessful
  ** Screenshot of the broken desktop
covers: bin/omarchy-theme-colors-from-alacritty, bin/omarchy-theme-set (colors.toml generation), bin/omarchy-theme-set-templates (only with colors.toml)

### theme-concurrent-switch-serialises   [VM-OK]
description: Three theme switches fired at once end in one consistent theme — name, colours and wallpaper agree — and the next switch still works.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-set nord & omarchy-theme-set gruvbox & omarchy-theme-set kanagawa & wait; sleep 5; omarchy-theme-current`.
  * The printed name must match what is on screen: `Nord` ↔ blue-grey, `Gruvbox` ↔ brown/olive, `Kanagawa` ↔ ink-dark with off-white border. Which one wins is not defined.
  * Type `ls ~/.local/state/omarchy/current/` → `background theme theme.name` and no `next-theme` left behind.
  * Type `omarchy-theme-set tokyo-night`; it applies normally (the lock was released).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Take the desktop screenshot in the same moment as reading the printed name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal name matching the desktop screenshot; the `ls` without `next-theme`; successful restore
  * If unsuccessful
  ** Mismatched name/desktop or a lingering `next-theme`
covers: bin/omarchy-theme-set (flock, atomic swap)

### theme-hooks-theme-set-and-font-set   [VM-OK]
description: User hooks run after a theme or font change with the new name as their argument, and a failing hook is reported without blocking the change.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type on one line: `mkdir -p ~/.config/omarchy/hooks/theme-set.d && printf '#!/bin/bash\necho "theme hook got: $1" >> /tmp/hooklog\n' > ~/.config/omarchy/hooks/theme-set && printf '#!/bin/bash\nexit 1\n' > ~/.config/omarchy/hooks/theme-set.d/fail && printf '#!/bin/bash\necho "font hook got: $1" >> /tmp/hooklog\n' > ~/.config/omarchy/hooks/font-set`
  * Type `omarchy-theme-set gruvbox`. The desktop turns Gruvbox despite the failing hook; the output includes `Hook failed: /home/prime/.config/omarchy/hooks/theme-set.d/fail`.
  * Type `omarchy-font-set "JetBrainsMono Nerd Font"` (re-sets the current font; the bar restarts).
  * Type `cat /tmp/hooklog` → `theme hook got: gruvbox` and `font hook got: JetBrainsMono Nerd Font`.
  * Type `rm -rf ~/.config/omarchy/hooks/theme-set ~/.config/omarchy/hooks/theme-set.d/fail ~/.config/omarchy/hooks/font-set /tmp/hooklog && omarchy-theme-set tokyo-night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The `Hook failed` line may scroll past quickly; `/tmp/hooklog` is the durable proof both hooks ran.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Gruvbox applied with the `Hook failed:` line; the two log lines; restored Tokyo Night
  * If unsuccessful
  ** Missing log lines or a theme switch that aborted
covers: bin/omarchy-theme-set (omarchy-hook theme-set), bin/omarchy-font-set (omarchy-hook font-set), bin/omarchy-hook, config/omarchy/hooks/*.d

### theme-browser-policy-colour   [VM-OK]
description: A theme switch recolours Chromium's toolbar through a root-owned policy without any password prompt, and the policy helper refuses anything but six lowercase hex digits.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `chromium &`. Chromium opens (20–30 s without GPU) with a dark navy toolbar.
  * In the terminal type `omarchy-theme-set flexoki-light`.
  ** No password or polkit dialog may appear. Within a few seconds Chromium's toolbar turns pale cream; the wallpaper is light.
  * In Chromium open `chrome://policy` (click the address bar, type it, Enter): the row `BrowserThemeColor` shows `#f2f0e5`.
  * In the terminal type `omarchy-theme-set-browser-policy GGGGGG; echo $?` → `expected six lowercase hex digits, got 'GGGGGG'`, `1`.
  * Type `omarchy-theme-set tokyo-night`; Chromium's toolbar is navy again. Close Chromium (Ctrl+Shift+Q or Super+W).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a polkit password dialog appears during the theme switch, enter `prime`, let it finish, and report it: the passwordless rule is missing on this build.
  * Chromium's toolbar follows the policy live; if it does not, reload the page and note it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Chromium navy; Chromium cream after the switch with no prompt on screen; the `chrome://policy` row; the rejection; Chromium navy again
  * If unsuccessful
  ** Screenshot of a polkit/sudo prompt during the switch, or a toolbar that did not change
covers: bin/omarchy-theme-set-browser, bin/omarchy-theme-set-browser-policy, etc/sudoers.d/omarchy-theme-browser, themes/flexoki-light/chromium.theme, default/themed/chromium.theme.tpl

### theme-obsidian-sync   [VM-OK]
description: An Obsidian vault receives an "Omarchy" community theme that follows the system theme on every switch.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Apps`, type `obsidian`, Enter. In its welcome dialog click `Create` new vault, name it `Vault`, keep the default location (home), click `Create`.
  ** Obsidian is slow without GPU; allow 30 s per step and poll with screenshots.
  * Open a terminal with Super+Enter and type `omarchy-theme-set gruvbox`.
  * In Obsidian open Settings (the gear, bottom-left) → `Appearance` → `Themes` → `Manage`: a theme named `Omarchy` is listed. Click it; the editor turns Gruvbox grey/cream.
  * In the terminal type `omarchy-theme-set catppuccin-latte`; Obsidian's editor turns light within a few seconds (it hot-reloads the theme file).
  * Type `omarchy-theme-set tokyo-night`; close Obsidian (Super+W); type `rm -rf ~/Vault`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Obsidian shows a "trust plugins" prompt for the vault, accept it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Obsidian's theme list with `Omarchy`; the editor in Gruvbox colours; the editor light under Catppuccin Latte
  * If unsuccessful
  ** In the terminal `ls ~/Vault/.obsidian/themes/Omarchy/` and the Obsidian screenshot
covers: bin/omarchy-theme-set-obsidian, default/themed/obsidian.css.tpl

### theme-agent-syncs-without-apps   [VM-PARTIAL]
description: On a disk without Claude/Hermes/T3/VS Code the theme hooks for those apps stay silent, Pi's theme file is kept current, and asking to activate them gives a clear message. The apps' own UIs are not present, so only the messages and files are checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `grep '"background"' ~/.pi/agent/themes/omarchy-system.json` → `"#1a1b26"`.
  * Type `omarchy-theme-set nord && grep '"background"' ~/.pi/agent/themes/omarchy-system.json` → `"#2e3440"` (Pi is kept current).
  * Type `omarchy-theme-set-claude; omarchy-theme-set-t3code; omarchy-theme-set-vscode; echo $?` → no output, `0` (apps absent, hooks silent).
  * Type `omarchy-theme-set-hermes --activate; echo $?` → `Hermes is not set up yet; launch it once, then run omarchy-theme-set-hermes --activate.` and `0`.
  * Type `omarchy-theme-set-pi --bogus; echo $?` → `Usage: omarchy-theme-set-pi [--activate]`, `1`.
  * Type `omarchy-theme-set tokyo-night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: the apps' UIs. If `~/.claude` or `~/.hermes/config.yaml` already exists on this build, note it and skip that app's "absent" expectation.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the two Pi values, the silent `0`, the Hermes note, the usage error
  * If unsuccessful
  ** The command output that differed
covers: bin/omarchy-theme-set-pi, -claude, -hermes, -t3code, -vscode, install/user/theme.sh (pi --activate), test/shell.d/hermes-theme-test.sh, test/shell.d/vscode-theme-test.sh

### theme-tmux-sync   [VM-OK]
description: A running tmux session repaints to the new theme and carries the new palette in its environment.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `tmux`, then `echo hello` inside it.
  * Open a second terminal with Super+Enter and type `omarchy-theme-set catppuccin-latte`.
  ** Within 3 s the tmux pane in the first terminal is light (pale background, dark text) without restarting tmux.
  * In the second terminal type `tmux show-environment -g COLORFGBG` → `COLORFGBG=0;15`.
  * Type `omarchy-theme-set tokyo-night`; the pane is dark again and `tmux show-environment -g COLORFGBG` → `COLORFGBG=15;0`.
  * Click the first terminal and type `exit` to leave tmux.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The tmux status line keeps its own colours; only the pane background/foreground is expected to change.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** A dark tmux pane, then the same pane light, then dark; the two COLORFGBG values
  * If unsuccessful
  ** The pane screenshot and `tmux show-options -g window-style`
covers: bin/omarchy-theme-set-tmux, bin/omarchy-theme-osc, default/themed/gum_env.lua.tpl

### theme-keyboard-rgb-absent-hardware   [VM-PARTIAL]
description: With no RGB keyboard controller the keyboard-colour hook exits quietly, while the theme still records the colour it would have used. Hardware path skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cat ~/.local/state/omarchy/current/theme/keyboard.rgb` → `ff00ff` (Tokyo Night's own value).
  * Type `omarchy-theme-set gruvbox && cat ~/.local/state/omarchy/current/theme/keyboard.rgb` → `#7daea3` (generated from the accent).
  * Type `omarchy-theme-set-keyboard; echo $?` → no output, `0`.
  * Type `omarchy-theme-set tokyo-night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: no ASUS/Framework keyboard in the guest; only the no-device path runs.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The two values and the silent exit 0
  * If unsuccessful
  ** Any error text from the keyboard hook
covers: bin/omarchy-theme-set-keyboard, -asus-rog, -f16, default/themed/keyboard.rgb.tpl, themes/tokyo-night/keyboard.rgb

### background-next-cli   [VM-OK]
description: `omarchy theme bg next` steps through the current theme's wallpapers in order and wraps around to the first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme bg current` (fresh disk: `Winding Road`).
  * Type `for i in $(seq 8); do omarchy-theme-bg-next; sleep 2; omarchy-theme-bg-current; done` and screenshot every ~2 s while it runs.
  ** Names print in order: `Quattro`, `Swirl Buck`, `Sunset Lake`, `Omakub`, `Oma Cityscape`, `Oma`, `Omarchy`, then `Winding Road` again; the wallpaper changes each time.
  * The desktop is back on the starting wallpaper — no further restore needed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * There is no hotkey for "next background"; the CLI is the only way to cycle.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Eight wallpaper screenshots and the eight names in order, ending where it started
  * If unsuccessful
  ** The observed name sequence and `ls ~/.local/state/omarchy/current/theme/backgrounds/`
covers: bin/omarchy-theme-bg-next, bin/omarchy-theme-bg-current, bin/omarchy-theme-bg-set, themes/tokyo-night/backgrounds

### background-switcher-hotkey-and-menu   [VM-OK]
description: Super+Ctrl+Space and Style → Background open the wallpaper picker for the current theme; a keyboard or mouse choice applies immediately and Escape does nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Space. A grid of 8 unlabelled wallpaper thumbnails opens with the current one highlighted.
  * Press Right twice and Enter. The wallpaper changes to that image.
  * Press Super+Space → `Style` → `Background`; click a different thumbnail with the mouse. The wallpaper changes again.
  * Press Super+Ctrl+Space, then Escape: unchanged.
  * Open a terminal with Super+Enter and type `omarchy-theme-set gruvbox`; press Super+Ctrl+Space: the grid now has Gruvbox's 6 images. Escape.
  * Type `omarchy-theme-set tokyo-night`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Typing does not filter this picker; use arrows or the mouse.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** 8-tile grid; wallpaper after the keyboard pick; wallpaper after the mouse pick; unchanged after Escape; 6-tile Gruvbox grid; restored Tokyo Night
  * If unsuccessful
  ** Screenshot of what the hotkey opened
covers: default/hypr/bindings/utilities.lua (SUPER+CTRL+SPACE), bin/omarchy-theme-bg-switcher, omarchy-menu.jsonc style.background, bin/omarchy-theme-bg-set, bin/omarchy-menu-images

### background-set-cli-and-rejects-missing   [VM-OK]
description: `omarchy theme bg set <file>` uses any image as the wallpaper, even another theme's, and refuses a missing file or no argument.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme bg set /usr/share/omarchy/themes/nord/backgrounds/1-city-view.webp`. The wallpaper becomes the Nord city view while the bar stays Tokyo Night navy.
  * Type `omarchy theme bg set /nope/missing.png; echo $?` → `File does not exist: /nope/missing.png`, `1`; wallpaper unchanged.
  * Type `omarchy theme bg set; echo $?` → `Usage: omarchy-theme-bg-set <path-to-media>`, `1`.
  * Type `omarchy-theme-bg-next`; the wallpaper returns to a Tokyo Night image (`Winding Road`, the first, because the Nord file is not in the theme's list).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell also polls the wallpaper link, so the change shows within a second or two even without the IPC.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Nord wallpaper under a navy bar; the two errors; a Tokyo Night wallpaper after bg-next
  * If unsuccessful
  ** The error output and the wallpaper screenshot
covers: bin/omarchy-theme-bg-set, bin/omarchy-theme-bg-next (index -1 path)

### background-user-folder-install   [VM-OK]
description: Install → Style → Background opens the theme's personal wallpaper folder; an image placed there appears in the picker and survives theme switches.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Install` → `Style` → `Background`. Files (Nautilus) opens on an empty folder whose path bar ends in `backgrounds › tokyo-night`.
  * Open a terminal with Super+Enter and type `cp /usr/share/omarchy/themes/ristretto/backgrounds/2-coffee-beans.jpg ~/.config/omarchy/backgrounds/tokyo-night/`. The file appears in Files.
  * Press Super+Ctrl+Space: the grid now has 9 thumbnails including the coffee beans. Select it with Enter; it becomes the wallpaper.
  * Type `omarchy-theme-set gruvbox && omarchy-theme-set tokyo-night`; press Super+Ctrl+Space: still 9 tiles. Escape.
  * Type `rm ~/.config/omarchy/backgrounds/tokyo-night/2-coffee-beans.jpg && omarchy-theme-bg-next`; close Files (Super+W on it).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Files may open behind the menu; press Super+Space to close the menu first.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Files at the folder; 9-tile grid with the new image; coffee-bean wallpaper; still 9 tiles after the round trip
  * If unsuccessful
  ** `ls -la ~/.config/omarchy/backgrounds/tokyo-night/` and the grid screenshot
covers: bin/omarchy-theme-bg-install, omarchy-menu.jsonc install.style.background, bin/omarchy-theme-bg-switcher (user dir), bin/omarchy-theme-bg-cache

### background-video   [VM-PARTIAL]
description: A video file plays as the wallpaper and on the lock screen, and switching themes away and back does not crash the shell. Software decoding only — no GPU.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ffmpeg -loglevel error -f lavfi -i testsrc=duration=8:size=640x360:rate=10 -pix_fmt yuv420p /tmp/test.mp4 && ls -la /tmp/test.mp4`.
  ** If `ffmpeg` is missing, report that and stop — the disk ships no video to use instead.
  * Type `omarchy theme bg set /tmp/test.mp4`. The wallpaper becomes the moving test pattern; two screenshots 3 s apart show a different counter.
  * Press Super+Ctrl+L: the lock screen shows the same moving pattern. Unlock with `prime`.
  * Type `omarchy-theme-set nord` (image wallpaper, video stops) and then `omarchy-theme-set tokyo-night`.
  * Type `rm /tmp/test.mp4`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: hardware decode; a low frame rate is fine, a black or frozen wallpaper is not.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two differing frames of the pattern on the desktop; the lock screen with the pattern; Nord then Tokyo Night image wallpapers
  * If unsuccessful
  ** Screenshot of the black/frozen wallpaper and `journalctl --user -n 60 | sudo tee /dev/ttyS0`
covers: bin/omarchy-theme-bg-set (video), bin/omarchy-theme-set (is_video_path, no snapshot), test/shell.d/video-background-test.sh

### font-list-current-and-set-cli   [VM-OK]
description: `omarchy font set` changes the system monospace font for the bar and new terminals, and refuses a font that is not installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy font current` → `JetBrainsMono Nerd Font`; `omarchy font list` → a short list including `Liberation Mono`.
  * Type `omarchy font set "Liberation Mono"`.
  ** The bar restarts and its clock/text is now Liberation Mono; a toast `You must restart Foot to see font change` appears. This terminal keeps the old font.
  * Open a new terminal with Super+Enter and type `ls -la`; its letterforms differ from the first terminal's (compare side by side).
  * Type `omarchy font set "Comic Sans"; echo $?` → `Font 'Comic Sans' not found.`, `1`; the bar is unchanged.
  * Type `omarchy font set "JetBrainsMono Nerd Font"`; the bar returns to the Nerd Font; a new terminal shows the Nerd Font prompt glyphs.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Font differences are subtle: compare bar digits and the two terminals' `ls -la` output at full resolution.
  * Prompt icons may still render through fontconfig fallback in the Liberation window; that is not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The font list; the restart-foot toast; the bar in Liberation Mono; two terminals side by side in different fonts; the rejection; the restored bar
  * If unsuccessful
  ** `fc-match monospace` output and the bar screenshot
covers: bin/omarchy-font-list, bin/omarchy-font-current, bin/omarchy-font-set, default/fontconfig/conf.avail/50-omarchy.conf, config/foot/foot.ini

### font-set-menu   [VM-OK]
description: Style → Font lists the installed monospace fonts with the current one marked and applies the one clicked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `Font`. A submenu lists the fonts with `JetBrainsMono Nerd Font` marked as current.
  * Click `Liberation Mono` with the mouse. The bar restarts in the new font.
  * Press Super+Space → `Style` → `Font` again: `Liberation Mono` is now the one marked. Escape.
  * Repeat and click `JetBrainsMono Nerd Font`; the bar is back to the Nerd Font.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list re-runs on every open, so a font installed later shows up without restarting the shell.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The submenu with the marker on JetBrainsMono, then on Liberation Mono; the bar font changing and changing back
  * If unsuccessful
  ** Screenshot of an empty submenu or a marker that did not move
covers: shell/plugins/menu/Menu.qml fonts provider, omarchy-menu.jsonc style.font, bin/omarchy-font-set, bin/omarchy-font-current

### font-install-nerd-font   [VM-OK] [NET]
description: Install → Style → Font → Cascadia Mono downloads the Nerd Font package (~15 MB) and switches the system to it in one go.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Install` → `Style` → `Font` → `Cascadia Mono`. A floating terminal shows `Installing Cascadia Mono...` and a sudo prompt; type `prime` and Enter.
  ** pacman downloads `ttf-cascadia-mono-nerd` (1–2 minutes; poll with screenshots), the bar restarts in the new font, then `● Done! Press any key to close...`. Press a key.
  * Press Super+Space → `Style` → `Font`: `CaskaydiaMono Nerd Font` is listed and marked current. Escape.
  * Open a terminal with Super+Enter; its glyphs are Cascadia.
  * Type `omarchy font set "JetBrainsMono Nerd Font"` to restore.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A mirror failure in pacman is a NET failure, not an Omarchy one; capture the error text either way.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Floating terminal with install progress and Done; the Font submenu marking CaskaydiaMono; a terminal in Cascadia; restored bar
  * If unsuccessful
  ** The floating terminal's pacman/sudo error text
covers: bin/omarchy-install-font, omarchy-menu.jsonc install.style.font.cascadia, bin/omarchy-font-set

### branding-about-window   [VM-OK]
description: About shows system info beside the Omarchy logo with a light sheen sweeping across it, and closes on any key.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and click `About` with the mouse. A floating terminal opens with the block-art Omarchy logo on the left and system info (OS `Omarchy`, kernel, uptime, packages, shell, resolution, theme…) on the right.
  * Take three screenshots about one second apart: a bright diagonal band moves across the logo while the info text stays put.
  * Press any key; the window closes and the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The window is sized to its content; a clipped or scrolling logo is a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three About screenshots with the band in different positions; the desktop after closing
  * If unsuccessful
  ** Screenshot of a clipped/absent logo or an error in the About terminal
covers: bin/omarchy-launch-about, bin/omarchy-branding-about-animation, omarchy-menu.jsonc about, $OMARCHY_PATH/icon.txt, test/shell.d/branding-about-animation-test.sh

### branding-about-text-edit-and-reset   [VM-OK]
description: Style → About → Edit Text lets the user replace the About logo with their own text, and Restore Default brings the Omarchy logo back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `About` → `Edit Text`. An editor (nvim) opens on the branding file.
  * Replace the content: type `ggdG`, then `i`, type `HELLO OLIGARCHY` on five lines, press Escape, type `:wq` and Enter.
  ** About opens automatically showing `HELLO OLIGARCHY` where the logo was.
  * Press a key to close About.
  * Press Super+Space → `Style` → `About` → `Restore Default`. About opens with the Omarchy block logo again. Press a key.
  * Open a terminal with Super+Enter and type `omarchy-branding-about bogus; echo $?` → `Usage: omarchy-branding-about <image|text|reset>`, `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * About relaunches only when the editor exits cleanly; if a different editor opens, use its own save-and-quit.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Editor with the custom text; About showing `HELLO OLIGARCHY`; About with the restored logo; the usage error
  * If unsuccessful
  ** About screenshot after each step
covers: bin/omarchy-branding-about (text, reset, usage), bin/omarchy-launch-editor, bin/omarchy-launch-about, omarchy-menu.jsonc style.about.*

### branding-about-from-image   [VM-OK]
description: Style → About → Set From Image turns a chosen PNG into text art for About; cancelling the file chooser changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `About` → `Set From Image`. A file chooser titled `Pick PNG or SVG for About` opens.
  * Press Escape. Nothing opens; press Super+Space → `About`: the stock logo is unchanged. Press a key.
  * Repeat the menu path; in the chooser press Ctrl+L, type `/usr/share/omarchy/themes/gruvbox/unlock.png`, press Enter.
  ** About opens showing a braille rendering of the Gruvbox unlock logo, no wider than the previous logo area.
  * Press a key to close About.
  * Press Super+Space → `Style` → `About` → `Restore Default`; About shows the stock logo. Press a key.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The chooser is the portal GTK dialog; Ctrl+L plus a typed path is the reliable way to pick a file.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The chooser; unchanged About after cancel; About with the transcoded logo; the restored logo
  * If unsuccessful
  ** In a terminal `omarchy-transcode-ascii /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/x.txt --width 54 --height 26; echo $?`
covers: bin/omarchy-branding-about (image), bin/omarchy-file-select, bin/omarchy-transcode-ascii, omarchy-menu.jsonc style.about.image

### branding-screensaver-custom-and-reset   [VM-OK]
description: The screensaver animates the branding logo full-screen; its text can be replaced and restored from Style → Screensaver.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and click `Screensaver`. The screen fills with the Omarchy word-logo animating; two screenshots 2 s apart differ. Press any key to exit.
  * Press Super+Space → `Style` → `Screensaver` → `Edit Text`; in the editor type `ggdG`, `i`, `OLIGARCHY` on three lines, Escape, `:wq`, Enter.
  ** The screensaver launches automatically showing `OLIGARCHY`. Press a key.
  * Press Super+Space → `Style` → `Screensaver` → `Restore Default`. The screensaver shows the Omarchy logo again. Press a key.
  * Open a terminal with Super+Enter and type `omarchy-branding-screensaver nope; echo $?` → `Usage: omarchy-branding-screensaver <image|text|reset>`, `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A toast `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` means the default terminal was changed — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two differing screensaver frames; the `OLIGARCHY` screensaver; the restored one; the usage error
  * If unsuccessful
  ** Screenshot of the toast or a screensaver that failed to start
covers: bin/omarchy-branding-screensaver, bin/omarchy-launch-screensaver, omarchy-menu.jsonc system.screensaver / style.screensaver.*, $OMARCHY_PATH/logo.txt

### plymouth-list-current-and-switcher   [VM-OK]
description: Every theme is offered as a boot-screen style, the stock disk reports `default`, and the Unlock picker previews them with names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy plymouth list | wc -l` → `22`; `omarchy plymouth current` → `default`.
  * Press Super+Space → `Style` → `Unlock`. A labelled grid opens: a `default` tile plus one per theme, each a dark boot-screen mock-up with a logo and password box; `default` is highlighted.
  * Press Escape. No terminal or password prompt appeared.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This test needs no sudo at all.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `22` and `default` in the terminal; the labelled Unlock grid
  * If unsuccessful
  ** The list output and the picker screenshot
covers: bin/omarchy-plymouth-list, bin/omarchy-plymouth-current, bin/omarchy-plymouth-switcher, omarchy-menu.jsonc style.unlock, themes/*/preview-unlock.png

### plymouth-set-by-theme-and-reboot   [VM-OK] [SLOW]
description: Style → Unlock → gruvbox recolours the boot splash (sudo + initramfs rebuild), and the Gruvbox splash is what the machine shows on the next boot.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `Unlock` and click the `gruvbox` tile. A floating terminal shows `[sudo] password for prime:`; type `prime`, Enter.
  ** Output runs through the transaction and `limine-mkinitcpio` (`==> Building image…`), 1–4 minutes; poll with screenshots. It ends with `● Done! Press any key to close...`. Press a key.
  * Open a terminal with Super+Enter and type `omarchy plymouth current` → `gruvbox`.
  * Type `systemctl reboot` and take screenshots continuously.
  ** The boot splash must be dark grey with the Gruvbox unlock logo and a cream password box, not the navy default. It is on screen only a few seconds before the passphrase prompt.
  * Type the passphrase `prime`; if a login screen appears (also grey/cream), log in with `prime`.
  * On the desktop type `omarchy plymouth current` → `gruvbox`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Start taking screenshots the moment `systemctl reboot` is sent; the splash is brief.
  * This changes the disk for the rest of the run; follow with plymouth-reset-default-and-reboot to restore it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Floating terminal with the sudo prompt, mkinitcpio output and Done; `gruvbox`; a boot-splash screenshot in Gruvbox colours; the desktop after login
  * If unsuccessful
  ** The refusal text in the floating terminal (`omarchy-plymouth-set: refusing to publish: …`) or a navy splash screenshot
covers: bin/omarchy-plymouth-set-by-theme, bin/omarchy-plymouth-set (set mode), bin/omarchy-plymouth-current, omarchy-menu.jsonc style.unlock, default/plymouth/*, default/sddm/omarchy/Main.qml, test/shell.d/plymouth-set-test.sh

### plymouth-reset-default-and-reboot   [VM-OK] [SLOW]
description: Style → Unlock → default restores the stock boot splash and login theme, and the stock splash returns on the next boot.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: `omarchy plymouth current` prints a theme name (run plymouth-set-by-theme-and-reboot first, or in a terminal type `omarchy-plymouth-set-by-theme nord`, password `prime`, and wait for it to finish).
  * Press Super+Space → `Style` → `Unlock` and click the `default` tile. A floating terminal asks for the sudo password (`prime`), refreshes Plymouth and the login theme, rebuilds the initramfs, then `● Done!`. Press a key.
  * Open a terminal with Super+Enter and type `omarchy plymouth current` → `default`.
  * Press Super+Space → `Update` → `Config` → `Plymouth`: the same refresh runs again (sudo, Done) and `omarchy plymouth current` is still `default`.
  * Type `systemctl reboot`, screenshot continuously: the splash is the stock navy Omarchy one. Enter `prime`, log in if asked.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each rebuild is 1–4 minutes on 2 vCPU; poll with screenshots, never a long sleep.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Floating terminal ending in Done; `default`; the second refresh also Done; the stock boot splash screenshot
  * If unsuccessful
  ** The refusal message from the transaction and a non-stock splash screenshot
covers: bin/omarchy-plymouth-reset, bin/omarchy-refresh-plymouth, bin/omarchy-refresh-sddm, bin/omarchy-plymouth-set (--refresh-default, --refresh-sddm-default), omarchy-menu.jsonc style.unlock / update.config.plymouth

### plymouth-set-rejects-bad-input   [VM-OK]
description: The boot-screen setter refuses bad colours, a missing or symlinked logo, running under sudo, and an unknown theme — all before asking for a password or touching the system.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k` so no sudo ticket is cached.
  * Type `omarchy plymouth set '#zzzzzz' '#ffffff' /usr/share/omarchy/themes/nord/unlock.png` → `Invalid background color: #zzzzzz (expected #RRGGBB)`, no password prompt.
  * Type `omarchy plymouth set '#000000' '#ffffff' /nope.png` → `Logo file not found: /nope.png`.
  * Type `ln -sf /usr/share/omarchy/themes/nord/unlock.png /tmp/link.png; omarchy plymouth set '#000000' '#ffffff' /tmp/link.png` → `Logo file is a symlink, which is not accepted: /tmp/link.png`.
  * Type `sudo omarchy-plymouth-set '#000000' '#ffffff' /usr/share/omarchy/themes/nord/unlock.png` (this one prompts; type `prime`) → `Error: run omarchy-plymouth-set as your user, not under sudo.`
  * Type `omarchy-plymouth-set-by-theme nope 2>&1 | tail -1` → `Invalid background color:  (expected #RRGGBB)` (the theme has no colours file; note the unhelpful message).
  * Type `omarchy plymouth current` → still `default`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Except for the deliberate `sudo` case, none of these may prompt for a password or start `mkinitcpio`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the five refusals and `default`; no unexpected password prompt on any screenshot
  * If unsuccessful
  ** Any refusal that instead prompted for a password or began rebuilding
covers: bin/omarchy-plymouth-set (argument/logo guards, EUID check), bin/omarchy-plymouth-set-by-theme, test/shell.d/plymouth-set-test.sh

### plymouth-sudo-wrong-password   [VM-OK]
description: A wrong sudo password in the Unlock flow fails the floating terminal with the Failed banner and leaves the boot theme untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k`.
  * Press Super+Space → `Style` → `Unlock` and click `nord`. At `[sudo] password for prime:` type `wrong` and Enter, three times.
  ** `Sorry, try again.` twice, then `sudo: 3 incorrect password attempts` and `● Failed (exit code 1)! Press any key to close...`.
  * Press a key. In the terminal type `omarchy plymouth current` → `default`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Three failures can trip faillock for a couple of minutes; later sudo prompts in the same session may need a short wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Floating terminal with the three failures and the Failed banner; `default`
  * If unsuccessful
  ** A Done banner or a changed `plymouth current`
covers: bin/omarchy-plymouth-set (run_root_transaction failure), bin/omarchy-show-done, omarchy-menu.jsonc style.unlock

### plymouth-preview-cli   [VM-OK]
description: `omarchy plymouth preview` renders a boot-screen mock-up from colours and a logo and shows it full-screen; bad inputs are rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy plymouth preview '#1d2021' '#ebdbb2' /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/preview.png`.
  ** imv opens full-screen: dark grey canvas, Gruvbox logo centred, a cream password box beneath with a lock icon to its left and four dots inside.
  * Press `q` to close imv.
  * Type `omarchy plymouth preview red '#ffffff' /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/p2.png; echo $?` → `Invalid background color: red (expected #RRGGBB)`, `1`.
  * Type `omarchy plymouth preview '#000000' '#ffffff' /nope.png /tmp/p3.png; echo $?` → `Logo file not found: /nope.png`, `1`.
  * Type `rm /tmp/preview.png`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * imv is full-screen; `q` closes it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the imv preview; the two refusals
  * If unsuccessful
  ** magick error output in the terminal
covers: bin/omarchy-plymouth-preview, default/plymouth/{bullet,entry,lock}.png

### refresh-config-restores-broken-hyprland   [VM-OK]
description: Update → Config → Hyprland replaces a user-broken Hyprland config with the shipped default, keeps a timestamped backup with the user's change, and Hyprland works again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo 'this is not lua (' >> ~/.config/hypr/bindings.lua && hyprctl reload`. Hyprland shows a config-error banner or `hyprctl reload` prints an error.
  * Press Super+Space → `Update` → `Config` → `Hyprland`.
  ** The floating terminal prints, for bindings.lua only, the red `Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default.`, `Saved backup as …bindings.lua.bak.<epoch>.`, `Changes:` and `> this is not lua (`; then `● Done!`. Press a key.
  * The error banner is gone; press Super+K — the keybindings list opens. Escape.
  * In the terminal type `tail -1 ~/.config/hypr/bindings.lua.bak.*` → `this is not lua (`.
  * Type `rm ~/.config/hypr/*.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the broken file takes Super+Space down with it, type `omarchy-refresh-hyprland` in the open terminal instead and report that.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The error state; the floating terminal with the red Replaced/Saved backup lines and diff; working Super+K; the backup's last line
  * If unsuccessful
  ** The floating terminal output and `hyprctl reload` error text
covers: bin/omarchy-refresh-hyprland, bin/omarchy-refresh-config, omarchy-menu.jsonc update.config.hyprland, test/shell.d/refresh-config-test.sh

### refresh-config-cli-guards   [VM-OK]
description: `omarchy-refresh-config` leaves no backup when the file is unmodified, recreates a deleted config, and rejects paths that are not shipped configs.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-refresh-config hypr/input.lua; echo $?; ls ~/.config/hypr/input.lua.bak.* 2>&1` → no output, `0`, then `No such file` (identical file, backup removed).
  * Type `omarchy-refresh-config nope/nope.lua; echo $?` → `Not a shipped user config: nope/nope.lua`, `1`.
  * Type `omarchy-refresh-config; echo $?` → the `Usage:` text mentioning `hypr/hyprland.lua`, `1`.
  * Type `rm ~/.config/tmux/tmux.conf; omarchy-refresh-config tmux/tmux.conf; ls ~/.config/tmux/` → `tmux.conf` recreated, no backup, no output.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All commands are instant; one terminal screenshot per step.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the silent success, the `Not a shipped user config` error, the usage, and the recreated tmux.conf
  * If unsuccessful
  ** A stray `.bak` for an unmodified file
covers: bin/omarchy-refresh-config, test/shell.d/refresh-config-test.sh

### refresh-shell-resets-bar   [VM-OK]
description: Update → Config → Shell resets the bar to Omarchy defaults (moving a bottom bar back to the top) and keeps a backup of the user's shell settings.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-bar position bottom`. The bar moves to the bottom of the screen.
  * Press Super+Space → `Update` → `Config` → `Shell`.
  ** The floating terminal prints `Replaced /home/prime/.config/omarchy/shell.json…`, `Saved backup as …shell.json.bak.<epoch>`, the shell restarts (bar disappears ~2 s) and comes back at the top; `● Done!`. Press a key.
  * In the terminal type `ls ~/.config/omarchy/shell.json.bak.*` → one file; `rm ~/.config/omarchy/shell.json.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the bottom bar before the refresh; that is the "before" proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar at the bottom; the floating terminal with Replaced/Saved backup; bar at the top; the backup file listed
  * If unsuccessful
  ** The floating terminal output and a bar that stayed at the bottom
covers: bin/omarchy-refresh-shell, bin/omarchy-refresh-config, bin/omarchy-bar, omarchy-menu.jsonc update.config.shell

### refresh-tmux-and-hyprsunset   [VM-OK]
description: Update → Config → Tmux and → Hyprsunset each restore a user-broken config with a backup and restart the affected program.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo 'set -g status off # BROKEN' >> ~/.config/tmux/tmux.conf && echo 'garbage' >> ~/.config/hypr/hyprsunset.conf`.
  * Press Super+Space → `Update` → `Config` → `Tmux`. Floating terminal: `Replaced …/tmux/tmux.conf…`, backup, diff with `# BROKEN`, `● Done!`. Press a key.
  * Press Super+Space → `Update` → `Config` → `Hyprsunset`: `Replaced …/hypr/hyprsunset.conf…`, backup, diff with `garbage`, `● Done!`. Press a key.
  * In the terminal type `tmux new -d -s t && tmux kill-session -t t && echo tmux-ok; pgrep -x hyprsunset` → `tmux-ok` and a PID.
  * Type `rm ~/.config/tmux/*.bak.* ~/.config/hypr/hyprsunset.conf.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Both floating terminals close on any key; read the red lines before pressing one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two floating-terminal screenshots with Replaced/Saved backup and the diff lines; `tmux-ok` and the hyprsunset PID
  * If unsuccessful
  ** The floating terminal output and `pgrep -a hyprsunset`
covers: bin/omarchy-refresh-tmux, bin/omarchy-refresh-hyprsunset, bin/omarchy-refresh-config, omarchy-menu.jsonc update.config.{tmux,hyprsunset}

### refresh-applications-restores-launchers   [VM-OK]
description: `omarchy-refresh-applications` puts back the shipped launcher entries a user deleted, so they reappear in the Apps menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `rm ~/.local/share/applications/YouTube.desktop`.
  * Press Super+Alt+Space (Apps menu) and type `youtube`: no result. Escape.
  * In the terminal type `omarchy-refresh-applications`; it finishes without an error.
  * Press Super+Alt+Space and type `youtube`: the YouTube web app is listed. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Apps menu may need a second to re-read the desktop database; reopen it if the entry is not there at once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Apps menu without YouTube, then with it
  * If unsuccessful
  ** The command output and `ls ~/.local/share/applications/`
covers: bin/omarchy-refresh-applications, applications/*.desktop

### refresh-chromium-flags   [VM-OK]
description: `omarchy-refresh-chromium` restores the Chromium flags file from the default and keeps a backup showing the user's change.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '--broken-flag' >> ~/.config/chromium-flags.conf`.
  * Type `omarchy-refresh-chromium`.
  ** Output: `Replaced /home/prime/.config/chromium-flags.conf…`, `Saved backup as …chromium-flags.conf.bak.<epoch>`, a diff with `> --broken-flag`, plus lines from re-installing the native messaging hosts; no errors.
  * Type `grep -c broken ~/.config/chromium-flags.conf` → `0`; `rm ~/.config/chromium-flags.conf.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All in one terminal; maximise it (Super+F) so the red lines are readable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with Replaced/Saved backup and the diff line; `0`
  * If unsuccessful
  ** The command output
covers: bin/omarchy-refresh-chromium, bin/omarchy-refresh-config

### refresh-pacman-rejects-bad-channel   [VM-OK]
description: `omarchy-refresh-pacman` refuses an unknown channel name and leaves the package configuration as it was.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -v` (password `prime`).
  * Type `omarchy-refresh-pacman bogus; echo $?` → `Error: Invalid channel 'bogus'. Must be one of: stable, rc, edge`, `1`.
  * Type `cmp /etc/pacman.conf /etc/pacman.conf.bak && echo same` → `same` (the backup is taken before the check, the live file is untouched).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `omarchy-refresh-pacman stable`: it performs a full system upgrade, beyond the session budget.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Invalid channel error and `same`
  * If unsuccessful
  ** A started upgrade or a differing pacman.conf
covers: bin/omarchy-refresh-pacman (channel guard)

### refresh-limine-bootloader   [VM-OK] [SLOW]
description: `omarchy-refresh-limine` resets the boot menu config from the Omarchy default, keeps a backup, rebuilds the entries, and the machine still boots.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '# user tweak' | sudo tee -a /boot/limine.conf` (password `prime`).
  * Type `omarchy-refresh-limine` → `Resetting limine config`, then `limine-update` listing entries and `limine-snapper-sync`, no errors.
  * Type `sudo tail -1 /boot/limine.conf; sudo tail -1 /boot/limine.conf.bak` → a normal line, then `# user tweak`.
  * Type `systemctl reboot`; screenshot the Limine menu/boot; enter `prime` at the passphrase, log in if asked; the desktop returns.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `limine-update` prints an error, stop and report it; do not reboot a machine whose bootloader update failed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the reset output and the two tail lines; boot screenshots; the desktop after reboot
  * If unsuccessful
  ** The `limine-update` error text; the boot screen if the reboot fails
covers: bin/omarchy-refresh-limine, default/limine/limine.conf

### apply-lock-idempotent   [VM-PARTIAL]
description: Re-running the lock-screen authentication setup is harmless: it reports success, keeps the password stack, and the lock screen still unlocks. Fingerprint path skipped (no reader).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo omarchy-apply-lock` (password `prime`) → `Configuring lock screen password authentication...` then `Lock screen authentication configured.`; no fingerprint line.
  * Type `ls /etc/pam.d/omarchy-lock-*` → only `omarchy-lock-password`.
  * Press Super+Ctrl+L; type `wrong` and Enter — rejected (field shakes/reddens); type `prime` and Enter — unlocked.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: the fingerprint PAM file (no fprintd device). Do not delete the password PAM file to test the failure path — it would lock the driver out.
  * The lock screen dims after a few seconds; keys still reach the field.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The two output lines; the PAM listing; rejected then accepted unlock screenshots
  * If unsuccessful
  ** A lock screen that does not accept `prime`
covers: bin/omarchy-apply-lock

### apply-hardware-system-argument-guards   [VM-OK]
description: The privileged apply commands refuse to run as a normal user, without an install user, or with an unknown user or option, so a mistyped call cannot half-apply system setup.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-apply-hardware --install-user prime; echo $?` → `Error: omarchy-apply-hardware must run as root`, `1`.
  * Type `sudo omarchy-apply-hardware` (password `prime`) → `Error: --install-user must name the target non-root user`.
  * Type `sudo omarchy-apply-hardware --install-user nobodyxyz` → `Error: user 'nobodyxyz' does not exist`.
  * Type `sudo omarchy-apply-system --frobnicate` → `Unknown option: --frobnicate` followed by the usage text.
  * Type `omarchy-apply-system --help; echo $?` → usage mentioning `--first-install|--upgrade`, `0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never run `sudo omarchy-apply-system --install-user prime …`; it re-runs the whole system configuration.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the four errors and the usage text
  * If unsuccessful
  ** Any command that proceeded past its guard (install-log lines appearing)
covers: bin/omarchy-apply-hardware, bin/omarchy-apply-system (argument parsing)

### dev-font-add-glyph   [VM-OK]
description: `omarchy dev font` lists the icon font's brand glyphs and adds a new one from a single-path SVG, refusing multi-path SVGs, taken codepoints and the read-only packaged font.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev font list` → 15 rows `U+E900` … `U+E90E`, each with a glyph character and a `W x H` box.
  * Type `cp /usr/share/omarchy/default/fonts/omarchy/omarchy.ttf /tmp/f.ttf && printf '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>' > /tmp/sq.svg && omarchy dev font add square /tmp/sq.svg --font /tmp/f.ttf` → `Added square as U+E90F (…)` and `Next:` hints.
  * Type `omarchy dev font add again /tmp/sq.svg --font /tmp/f.ttf --codepoint U+E900; echo $?` → `U+E900 is already used`, `1`.
  * Type `printf '<svg viewBox="0 0 24 24"><path d="M0 0h1v1z"/><path d="M2 2h1v1z"/></svg>' > /tmp/two.svg && omarchy dev font add two /tmp/two.svg --font /tmp/f.ttf` → `expected a single <path>, found 2 — flatten the mark to one monochrome path first`.
  * Type `omarchy dev font add x /tmp/sq.svg; echo $?` (packaged font) → a `Permission denied` error, non-zero; `omarchy dev font list | wc -l` still `15`.
  * Type `rm /tmp/f.ttf /tmp/*.svg`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The glyph characters print in the private-use area; boxes instead of marks in the *terminal* are fine — the menu test checks rendering.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The 15-row list; `Added square as U+E90F`; the two rejections; the permission error with the list still 15
  * If unsuccessful
  ** The Python traceback text
covers: bin/omarchy-dev-font, default/fonts/omarchy/{omarchy.ttf,README.md}, agents/skills/icon-font.md

### menu-icon-font-glyphs   [VM-OK]
description: Menu entries that use the Omarchy icon font show real brand marks, not empty boxes, in the current theme's colours.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Setup` → `Default` → `Agent`. The rows (Codex, Cursor CLI, Grok, Hermes, omp, OpenClaw, OpenCode, Ori, Pi…) each show a distinct monochrome brand mark in the theme foreground colour.
  * Move the highlight down one row with the arrow key; the highlighted row's mark takes the selection colour.
  * Press Escape twice. Press Super+Space → `Install` → `AI`: the same marks appear beside Claude Desktop, ChatGPT Desktop, Hermes Desktop, LM Studio, Ollama, Perplexity, T3 Code. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A hollow rectangle (tofu) or a blank where an icon should be is the failure this test looks for.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Agent submenu with distinct marks; the highlighted row recoloured; the Install → AI submenu with marks
  * If unsuccessful
  ** The submenu screenshot with tofu boxes
covers: default/fonts/omarchy/omarchy.ttf, omarchy-menu.jsonc setup.default.agent.* / install.ai.* (iconFont), agents/skills/icon-font.md

### theme-update-extras-hidden-when-none   [VM-OK]
description: Update → Extra Themes appears only once a git-installed theme exists, and updating with none installed is a silent no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Update`. The list has no `Extra Themes` entry. Escape.
  * Open a terminal with Super+Enter and type `omarchy theme update; echo $?` → no output, `0`.
  * Type `mkdir -p ~/.config/omarchy/themes/handmade && cp /usr/share/omarchy/themes/nord/colors.toml ~/.config/omarchy/themes/handmade/`. Press Super+Space → `Update`: still no `Extra Themes` (a hand-written theme is not an extra to pull). Escape.
  * Type `cd ~/.config/omarchy/themes/handmade && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm i && cd ~`. Press Super+Space → `Update`: `Extra Themes` is now listed.
  * Click it: the floating terminal prints `Updating: handmade` and a git message (no remote → `fatal: No remote repository specified` is acceptable), then a Done/Failed banner. Press a key.
  * Type `rm -rf ~/.config/omarchy/themes/handmade`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu evaluates visibility conditions when opened; reopen it after each change.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Update menu without Extra Themes (twice) and with it (once); `Updating: handmade` in the floating terminal
  * If unsuccessful
  ** Menu screenshot with the wrong visibility
covers: bin/omarchy-theme-extras, bin/omarchy-theme-update, omarchy-menu.jsonc update.themes (when)

## Gaps

- **Full `omarchy-apply-system` / `omarchy-apply-hardware --install-user prime` runs** — re-execute the entire install-time configuration (packages, hardware, login, post-install) as root; > 10 min, network-heavy, and may alter later tests' assumptions. Only argument guards are covered. `[VM-NO]`
- **`omarchy-refresh-pacman stable|rc|edge`** — performs `pacman -Syyuu --noconfirm`; too slow and disk-changing for a session. Guard-only test proposed. `[VM-NO]`
- **`omarchy-theme-set-hermes --wait`** — polls up to 30 minutes for a Hermes first launch and then sleeps 60 s; Hermes Desktop is not installed and installing it is a large download. `[VM-NO]`
- **Keyboard RGB (`asusctl`, `qmk_hid`)**, **GNOME icon theme rendering in GTK4 apps beyond Nautilus**, and **VS Code / Cursor / Codium / Claude Code / Pi / T3 Code UI retint** — the apps or hardware are absent on the minted disk; only messages and written files are checked (see `theme-agent-syncs-without-apps`, `theme-keyboard-rgb-absent-hardware`). Installing VS Code (`code`, ~100 MB) to verify the generated `local.omarchy-theme` extension is feasible but heavy: `[NET][SLOW]`, not proposed.
- **Hidden helper flags** (`omarchy-theme-color --all/--raw/<key> [fallback]`, `omarchy-theme-dir`, `omarchy-theme-extras` exit code, `omarchy-theme-osc <file>`, `omarchy-theme-set-browser-policy` uppercase/arity variants) — not user stories; they are exercised indirectly by `theme-cycle-all-22`, `theme-preview-palette-in-terminal`, `theme-update-extras-hidden-when-none` and `theme-browser-policy-colour`. Their unit coverage belongs in `test/shell.d/`.
- **Per-file inventory of a rendered theme** (that every template produces its file, `chromium.theme` holds decimal RGB, `foot.ini` uses stripped hex, …) — a file-reading exercise rather than something a user sees; the user-visible consequence of a missing or malformed file is covered by `theme-cycle-all-22` (`leftovers=0`, bar alive on every theme) and the per-app retint tests.
- **Ghostty / kitty / alacritty retint and font paths** (`omarchy-restart-terminal` SIGUSR1/2, `font-set` edits to their configs) — none of the three is in the base package set; foot is the only terminal on the disk. Installing one (`omarchy default terminal kitty`) would be a separate NET test belonging to the terminal reviewer.
- **`omarchy-theme-set-browser` refreshes of Chrome/Edge/Brave** — only Chromium is present; the `--refresh-platform-policy` path for the others is unexercised.
- **`light.mode` marker precedence** (`omarchy-theme-color`) — no shipped theme uses it; could be folded into `theme-user-theme-directory` by adding a `light.mode` file to a dark-palette user theme and checking `mode` → `light`, but it is a legacy path and left out to keep that test short.
- **Background transition snapshots** (`~/.cache/omarchy/background-transitions`, cross-fade between old and new wallpaper) — visible only for ~1 s; a screenshot loop might catch a blended frame but cannot assert it. Covered indirectly by every theme switch not leaving a stale snapshot file (`ls ~/.cache/omarchy/background-transitions/` empty after 5 s) — worth adding as a step if flakiness is suspected.
- **`omarchy-theme-switcher --preload` / preview-cache invalidation** (`signature` / `fast-signature` files) — internal performance behaviour; the user-visible effect (new theme tile appears) is covered in `theme-user-theme-directory`.
- **Plymouth `current` ambiguity for `white` vs `vantablack`** — provable (`omarchy-plymouth-set-by-theme white` then `plymouth current` → `vantablack`) but costs a full mkinitcpio; recorded as Observation 5 instead of a test.
- **SDDM login screen recolouring** — depends on whether the 4.0.2 minted disk shows SDDM or auto-logs in; folded into the two plymouth reboot tests as "if a login screen appears".
- **`omarchy-refresh-herdr`** — herdr (HEAD) may not exist on 4.0.2; if `command -v herdr` fails, the test would only show `omarchy-refresh-config herdr/config.toml` behaviour, already covered by `refresh-config-cli-guards`.
- **Community theme URL** for `theme-install-github-url` — the exact repository names at https://omarchy.org/themes/ could not be verified offline; the driver is told to read one from the page in Chromium and record it.
