# 11 — Manual chapters 15–29: terminal, Neovim, AI, development tools, shell tools/functions, TUIs, GUIs, browsers, commercial apps, web apps, gaming, PDFs, Windows VM, other packages

Reviewer notes for the end-user application chapters. Source tree: `/tmp/omarchy-review/omarchy` (omarchy @ HEAD 2026-09-18). All paths below are relative to that tree unless they start with `test_def/`.

## Scope

### Manual chapters (all read completely, 745 lines)

| file | lines | topic |
|---|---|---|
| `manual/15-terminal.md` | 39 | Foot default, Install > Terminal, Super+Return, tmux, `tdl/tds/tdlm/tsl` |
| `manual/16-neovim.md` | 42 | omarchy-nvim / LazyVim basics, Super+Shift+N, `n` alias, `sudoedit` |
| `manual/17-ai.md` | 67 | agent stubs, default agent, `Super+Shift+Ctrl+A`, agents panel, crash diagnosis, desktop AI apps, local LLMs, Omarchy skill |
| `manual/18-development-tools.md` | 37 | Install > Editor, `vi`, Setup > Defaults > Editor, Install > Development, mise, Docker (sudo by default), Docker DB, GitHub CLI, `ghui`, lazygit |
| `manual/19-shell-tools.md` | 61 | fzf `ff`, Ctrl+R, zoxide, ripgrep, eza aliases, fd, bat, tldr, yt-dlp, try, project `bin/` not on PATH |
| `manual/20-shell-functions.md` | 49 | compress/decompress, iso2sd, format-drive, tmux/herdr layouts, ga/gd, rsw/lsw/dsw, fip/dip/lip, ssh wrapper |
| `manual/21-tuis.md` | 51 | lazygit, lazydocker, btop Activity, Herdr, About (fastfetch), Disk Usage (dua), Cliamp, Wi-Fi/BT panels, Install/Remove > TUI |
| `manual/22-guis.md` | 96 | Files, Disks, Obsidian, Omawrite, Pinta, Aether, LocalSend/Share, LibreOffice, Omacalc, Signal, mpv, OBS, Kdenlive, Omacut |
| `manual/23-browsers.md` | 39 | Chromium default, Install > Browser, Setup > Defaults > Browser, `omarchy default browser`, Copy URL, Download Video, Firefox/Zen, Remove > Browser |
| `manual/24-commercial-apps-services.md` | 37 | 1Password, Bitwarden, Spotify, Dropbox, Tailscale, ONCE, NordVPN |
| `manual/25-web-apps.md` | 75 | Install/Remove > Web App, hotkeys for HEY/ChatGPT/Grok/WhatsApp/Google/X/YouTube, Basecamp/Zoom/Discord launchers |
| `manual/26-gaming.md` | 85 | Install > Gaming: Steam, RetroArch (+ Game Launcher), Xbox Cloud, GeForce NOW, Minecraft, Xbox Controllers, Moonlight (preinstalled), Sunshine, Battle.net, Lutris, Heroic |
| `manual/27-filling-out-pdfs.md` | 9 | Document Viewer, Open With → Xournal++, T tool, Image tool, Export as PDF |
| `manual/28-windows-vm.md` | 49 | Install > Windows, `omarchy windows vm launch/status/stop`, `--keep-alive`, `~/Windows`, `omarchy windows key`, Remove > Windows |
| `manual/29-other-packages.md` | 9 | Install > Package, Install > AUR, Remove > Package, `omarchy pkg add/drop` |

### Source reviewed for launch paths and defaults (~9,450 lines)

- Hotkeys: `default/hypr/bindings/applications.lua` (34), `utilities.lua` (127), `tiling.lua` (99), `clipboard.lua` (48), `media.lua` (35), `voxtype.lua` (5); `default/hypr/helpers.lua` (159: `o.bind`, `omarchy=`/`tui=`/`webapp=`/`launch=` dispatch, `preinstalled_bindings_enabled`).
- Window rules: `default/hypr/windows.lua`, `default/hypr/apps/{system,terminals,browser,localsend,steam,windows-vm}.lua`.
- Menu: `default/omarchy/omarchy-menu.jsonc` (380 lines, every Install/Remove/Setup row), `default/omarchy/launcher.hides`.
- Desktop files: `applications/*.desktop` (16) and `applications/icons/`; `docs/file-layout.md` (they are installed into `/etc/skel/.local/share/applications/`, i.e. `~/.local/share/applications/` for the minted user).
- Launchers: all 24 `bin/omarchy-launch-*`.
- Installers: `bin/omarchy-install-terminal`, `-browser`, `-and-launch`, `-app`, `-dev-env` (head), `-docker-dbs`, `-service-{signal,spotify,1password,once,nordvpn}`, `-gaming-{steam,retroarch,xbox-cloud}`, `-chromium-{copy-url,ytdlp}` (head), `-editor-*` (names only), `-ai-*` (names only), `omarchy-install-preinstalls`/`omarchy-remove-preinstalls`.
- Web apps / TUIs: `bin/omarchy-webapp-{install,remove,remove-all,handler-hey,handler-zoom}`, `bin/omarchy-tui-{install,remove}`.
- Packages: `bin/omarchy-pkg-{install,add,drop,remove,aur-install,aur-add,present}`.
- Defaults & agents: `bin/omarchy-default-{agent,browser,terminal,editor}`, `bin/omarchy-agent`, `-agent-prompt`, `-agent-crash` (head), `-crash-mute`, `-toggle-crash-capture`, `bin/omarchy-mise-install`, `install/user/mise.sh`, `install/user/mise-work.sh`, `install/user/first-run/setup-agent.hook`.
- Docker: `bin/omarchy-sudo-docker`, `bin/omarchy-setup-security-sudoless-docker`, `install/config/docker.sh`.
- Share: `bin/omarchy-menu-share`, `default/nautilus-python/extensions/localsend.py` (existence only).
- Windows VM: `bin/omarchy-windows-vm` (header, `check_prerequisites`, `status_windows`, `show_usage`, dispatcher — not the 1,400 lines of compose/mount security code), `bin/omarchy-windows-key`.
- Gaming: `bin/omarchy-games-retro-install`, `bin/omarchy-launch-battlenet`.
- CLI router: `bin/omarchy` (how `omarchy share clipboard` → `omarchy-menu-share`, `omarchy windows vm` → `omarchy-windows-vm`, `omarchy pkg add` → `omarchy-pkg-add`).
- Presentation: `bin/omarchy-show-done`, `bin/omarchy-show-logo`, `bin/omarchy-menu-select` (head), `bin/omarchy-menu-tmux-keybindings`, `bin/omarchy-menu-herdr-keybindings`.
- Package lists: `install/omarchy-base.packages` (200 lines), `install/omarchy-other.packages`.
- Shell: every file under `default/bash/` (`rc`, `envs`, `env-bootstrap`, `shell`, `aliases`, `functions`, `init`, `inputrc`, `completions`, `fns/{compression,drives,herdr,rsyncing,ssh-port-forwarding,ssh-reconnect,tmux,worktrees}`).
- Config: `config/tmux/tmux.conf`, `config/foot/foot.ini`, `config/alacritty/alacritty.toml`, `config/ghostty/config`, `config/kitty/kitty.conf`, `config/lazygit/config.yml` (empty), `config/btop/btop.conf` (theme lines), `config/git/config`, `config/opencode/opencode.json`, `config/herdr/config.toml`, `config/chromium-flags.conf`, `etc/fastfetch/config.jsonc`, `default/chromium/extensions/{copy-url,yt-dlp}/manifest.json` (shortcut keys), `install/user/chromium.sh`, `install/user/git.sh`.
- Existing tests consulted for `covers`: `test/acceptance.d/apps-test.sh`, `test/shell.d/{default-agent,default-apps,webapp-install,webapp-name,webapp-install-escaping,launcher-remove,preinstalls,sudo-docker,sudoless-docker-toggle,crash-capture,launch-1password,launch-about,launch-browser,mise-install,herdr-functions,ssh-reconnect,windows-vm,windows-key,battlenet,chromium-copy-url,chromium-ytdlp,pkg-drop,keybindings-menu}-test.sh` (names only, to map coverage).

### Skipped and why

- `shell/plugins/agents/**` (agents panel QML and README): belongs to the bar/panels reviewer; only the "hidden until usage exists" behaviour is used here.
- `omarchy-nvim` (separate package): LazyVim keymaps are taken from the manual; not verifiable from this tree.
- Chromium extension JS bodies, `omarchy-chromium-*-host` internals: only manifests (shortcut keys) and the download dir default were read.
- `bin/omarchy-install-{ai-hermes,ai-openclaw,hermes-cli,openclaw-cli}`, `omarchy-launch-openclaw` bodies: read for modes only; Hermes/OpenClaw flows need accounts and are out of reach for a driver.
- `bin/omarchy-install-dev-env` beyond the first 80 lines and `bin/omarchy-remove-dev-env`: only the ruby/node/bun/deno/go cases were read.

## Inventory

Format: `behaviour — how it is reached — source`. "base" = in `install/omarchy-base.packages` (preinstalled on the minted disk); "optional" = needs an install (NET) first.

### 15 — Terminal

- Foot is the default terminal (base: `foot`); no tabs/splits — `install/omarchy-base.packages`, `manual/15-terminal.md:3`.
- `Super+Return` → `omarchy-launch-terminal` → `xdg-terminal-exec --dir=<cwd of active terminal>` — `default/hypr/bindings/applications.lua:2`, `bin/omarchy-launch-terminal`, `bin/omarchy-cmd-terminal-cwd` (falls back to `$HOME`).
- Alacritty, Ghostty, Kitty are optional (not in base); *Install > Terminal > {Alacritty, Foot, Ghostty, Kitty}* → `omarchy-install-terminal <name>` in a floating terminal; rows go dim (✓) when `omarchy-pkg-present <pkg>` — `omarchy-menu.jsonc:239-242`, `bin/omarchy-install-terminal`.
- `omarchy-install-terminal` installs the package, copies the terminal's `config/<terminal>` into `~/.config/<terminal>` if missing, writes `~/.config/xdg-terminals.list` so `Super+Return` follows — `bin/omarchy-install-terminal:24-50`.
- *Setup > Defaults > Terminal > {Alacritty, Foot, Ghostty, Kitty}* → `omarchy-default-terminal <name>`; ✓ on the current one (`omarchy-default-terminal` with no args prints `alacritty|foot|ghostty|kitty`); picking an uninstalled one installs it first in a floating terminal; ends with notification "<Name> is now the default terminal"; bad name → usage, exit 1 — `omarchy-menu.jsonc:160-164`, `bin/omarchy-default-terminal`.
- Terminal defaults shared by all four configs: JetBrainsMono Nerd Font 9, 14px padding, theme include from `~/.local/state/omarchy/current/theme/`, `Ctrl+Insert`/`Shift+Insert` copy/paste, Shift+Return sent as CSI-u — `config/foot/foot.ini`, `config/alacritty/alacritty.toml`, `config/ghostty/config`, `config/kitty/kitty.conf`.
- Terminals are tagged `terminal` (class `foot`, `Alacritty`, `kitty`, `com.mitchellh.ghostty`, `org.omarchy.*`, `TUI.*`) so `Super+C`/`Super+V` send Ctrl+Insert/Shift+Insert inside them — `default/hypr/apps/terminals.lua`, `default/hypr/bindings/clipboard.lua:45-47`.
- `Super+Alt+Return` → `omarchy-launch-terminal-tmux` → `tmux attach || tmux new -s Work` (session named `Work`) — `applications.lua:12`, `bin/omarchy-launch-terminal-tmux`; same as the `t` alias — `default/bash/aliases:52`.
- Tmux prefix `Ctrl+Space` (prefix2 `Ctrl+B`), `prefix q` reload, `prefix ?` popup with keybindings (`omarchy-menu-tmux-keybindings --print | less -R`), `Alt+Enter`/`Alt+Shift+Enter` split, `Alt+Escape` kill pane, `prefix h/v/x`, `Ctrl+Alt+Arrows` focus pane, `Ctrl+Alt+Shift+Arrows` resize, `prefix r/c/k` window rename/create/kill, `Alt+1..9` windows, `Alt+Left/Right` prev/next window, `prefix R/C/K/P/N` sessions, `Alt+Up/Down` prev/next session, mouse on, status bar on top showing session name — `config/tmux/tmux.conf`.
- `Ctrl+Space s` (manual) = tmux's stock `choose-tree` session picker; not rebound by Omarchy, so it works but is *not listed* by the cheatsheet — `manual/15-terminal.md:13`, `config/tmux/tmux.conf` (no `bind s`).
- `Super+Alt+K` → `omarchy-menu-tmux-keybindings` (searchable menu of annotated tmux bindings) — `utilities.lua:11`, `bin/omarchy-menu-tmux-keybindings`; also *Learn > Tmux* — `omarchy-menu.jsonc:51`.
- `tdl <ai> [ai2]` — 85/15 vertical split, right 30% pane runs `<ai>`, optional second agent below it, `$EDITOR .` in the left pane; window renamed to the directory basename; requires `$TMUX`; no args → `Usage: tdl <c|cx|codex|other_ai> [<second_ai>]`, outside tmux → `You must start tmux to use tdl.` — `default/bash/fns/tmux:3-38`. (Final `tmux select-pane -t "$opencode_pane"` references an undefined variable — see Observations.)
- `ic` = `tdl c`, `ix` = `tdl cx`, `icx` = `tdl c cx` — `default/bash/aliases:53-55` (manual mentions `ic` and `icx` only).
- `tds` — four-way square: `nvim .` top-left (hard-coded `nvim`, not `$EDITOR`), `hunk diff --watch` top-right, terminal bottom-left, `opencode` bottom-right; any argument → `Usage: tds` — `fns/tmux:42-65`. `hunk` and `opencode` are mise stubs (NET on first use) — `install/user/mise.sh`.
- `tdlm <ai> [ai2]` — renames the session to the cwd basename and runs `tdl` in one window per subdirectory; `Alt+1..9` to switch — `fns/tmux:69-94`, `tmux.conf:39-47`.
- `tsl <count> <command>` — tiled grid of `<count>` panes each running `<command>`; missing args → usage — `fns/tmux:98-124`.
- `c` = `opencode --auto`, `cx` = clear + `claude --permission-mode auto`, `cy` = `codex --approve-for-me` — `aliases:47-49`.

### 16 — Neovim

- `omarchy-nvim` (base) + `nvim` (base); LazyVim distribution; leader `Space` — `install/omarchy-base.packages`, `manual/16-neovim.md`.
- `Super+Shift+N` → `omarchy-launch-editor` → default editor from `~/.local/state/omarchy/defaults/editor` (absent → `nvim`); terminal editors open via `omarchy-launch-tui <editor>` (window class `org.omarchy.nvim`), GUI editors via `uwsm-app` — `applications.lua:8`, `bin/omarchy-launch-editor`.
- `n` shell function: no args → `nvim .`, else `nvim "$@"` — `default/bash/aliases:57`.
- `$EDITOR` = `omarchy-launch-editor --inline`, `$SUDO_EDITOR` = same, so `sudoedit <file>` opens the default editor inline — `default/bash/envs:2-3`, `manual/16-neovim.md:42`.
- LazyVim keys described (unverifiable here): `Space Space` find file, `Space s g` grep, `Space e` tree, `Ctrl+W W` hop, `Shift+H/L` buffers, `Space b d` close, `Space b o` close others, `Space g g` lazygit, `Space u w` wrap; in tree `a`/`A`/`?` — `manual/16-neovim.md:19-30`.
- *Learn > Neovim* → web app of lazyvim.org/keymaps — `omarchy-menu.jsonc:49`.

### 17 — AI

- Lazy mise stubs in `~/.local/bin/`: `codex`, `claude`, `crush`, `agy` (antigravity-cli), `gh`, `copilot`, `opencode`, `playwright`, `pi`, `omp`, `grok`, `cursor-agent` (unless already present), `ghui`, `hunk`, `hey`, `basecamp`, `cf`, `ori`, `hermes` (via `omarchy-install-hermes-cli`), `muse` (http backend) — `install/user/mise.sh`; each stub = `mise use -g --quiet <pkg> || exit 1; exec mise x <pkg> -- <bin> "$@"` — `bin/omarchy-mise-install:66-71`.
- `omarchy-mise-install <package> [command-name [bin-name]]`; rejects command names containing `/`, leading `.` or `-`, control chars (`'<name>' is not usable as a command name`, exit 1); no args → usage — `bin/omarchy-mise-install:6-25`.
- `mup` = `MISE_MINIMUM_RELEASE_AGE=0 mise up` — `aliases:56`.
- `omarchy default agent [name]` / *Setup > Defaults > Agent > {Antigravity, Claude, Codex, Copilot, Crush, Cursor CLI, Grok, Hermes, Muse Code, omp, OpenClaw, OpenCode, Ori, Pi}* → `omarchy-default-agent <name>`; ✓ on the current one; none is set on a fresh install (command prints nothing); picking an uninstalled agent runs `omarchy-default-agent --install` in a floating terminal (mise install) then launches it inline; bad name → usage, exit 1 — `omarchy-menu.jsonc:137-151`, `bin/omarchy-default-agent`.
- Choosing Claude also runs `omarchy-install-chromium-claude` (browser extension; may ask password) — `bin/omarchy-default-agent:104-106`.
- First-run invitation: critical notification "Set your default agent" with action `omarchy menu summon setup.default.agent` (once) — `install/user/first-run/setup-agent.hook`.
- `Super+Shift+Ctrl+A` → `omarchy-agent --pick`: no default → opens the menu at *Setup > Defaults > Agent*; otherwise launches the agent in its auto-approve mode in a terminal with app-id `org.omarchy.agent`; launched from `$HOME` it `cd`s to `~/Work` — `utilities.lua:97`, `bin/omarchy-agent`.
- `omarchy agent` (no `--pick`) with no default → stderr `Choose default agent with: omarchy default agent <name>`, exit 1; unexpected positional → `Unexpected argument: … To pass a prompt: omarchy agent prompt "…"` — `bin/omarchy-agent:11-30,44-50`.
- `omarchy agent prompt "<text>"` → `omarchy-agent --prompt`; no text → usage, exit 1 — `bin/omarchy-agent-prompt`.
- `a` = `omarchy-agent --inline` — `aliases:46`.
- Per-agent auto modes: `opencode --auto`, `agy --dangerously-skip-permissions`, `copilot --allow-all`, `crush --yolo`, `claude --permission-mode auto`, `grok --permission-mode bypassPermissions`, `codex --approve-for-me`, `cursor-agent --yolo --trust`, `hermes --yolo`, `muse --approval-mode never`, `omp --auto-approve`, `ori code`, `pi` — `bin/omarchy-agent:56-131`.
- Agents panel: bar icon appears only once AI usage records exist; left-click panel, right-click launches default agent; `omarchy agent usage-update` regenerates every 15 min — `manual/17-ai.md:38-41`, `bin/omarchy-agent-usage-update` (exists), `shell/plugins/agents/` (not reviewed here).
- Crash capture: systemd-coredump watched by `omarchy-crash-watch.service`; "Process crashed" notification hands PID to `omarchy agent crash <pid>`; toggle via *Trigger > Toggle > Crash Capture* / `omarchy toggle crash-capture` → notification "Crash capture disabled/enabled" — `omarchy-menu.jsonc:92`, `bin/omarchy-toggle-crash-capture`, `bin/omarchy-agent-crash`.
- `omarchy agent crash <pid>`: non-numeric → `Not a PID: …`, exit 1 — `bin/omarchy-agent-crash:14-19`.
- `omarchy crash mute` lists (`No programs muted. Crashes all notify.`); `omarchy crash mute <prog> [on|off|toggle]` reports `Muted crash notifications for <prog>.` / `Crash notifications for <prog> are back on.`; path accepted (`/usr/bin/hyprland`); bad action → `Not an action: …` + usage; `--` guards names like `-h` — `bin/omarchy-crash-mute`.
- *Install > AI > {ChatGPT Desktop, Claude Desktop, Dictation, Grok Bot, Hermes Desktop, LM Studio, Ollama, OpenClaw, Perplexity, T3 Code}* — `omarchy-menu.jsonc:243-252`; *Remove > AI* rows appear only when installed — `:303,312-320`. (Manual lists ChatGPT, Claude, Grok Bot, Hermes, OpenClaw, Perplexity, LM Studio, Ollama; **T3 Code and Dictation are not in the manual**.)
- Ollama install picks `ollama-cuda`/`ollama-rocm`/`ollama` by GPU detection (`nvidia-smi`/`rocminfo`) → plain `ollama` in the guest — `omarchy-menu.jsonc:249`.
- Omarchy skill symlinked into `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.gemini/config/skills`, `~/.hermes/skills` (+ profiles) by `omarchy-provision-user` — `docs/file-layout.md:211`, `manual/17-ai.md:65`.
- `omarchy reinstall configs` as rollback advice — `manual/17-ai.md:67` (not exercised here).

### 18 — Development tools

- *Install > Editor > {VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs}* — VSCode/Zed/Helix/Emacs via dedicated `omarchy-install-editor-*` in floating terminal; Cursor/Sublime via `omarchy-install-and-launch`; Vim via `omarchy-install-app Vim vim`; rows dim when the package is present — `omarchy-menu.jsonc:232-238`.
- `vi` is base (`vi` package) — `install/omarchy-base.packages:187`.
- *Setup > Defaults > Editor > {Neovim, VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs}* → `omarchy-default-editor <nvim|code|cursor|zed|sublime_text|helix|vim|emacs>`; installs first if missing; writes `~/.local/state/omarchy/defaults/editor`; notification "<Name> is now the default editor"; no args prints current (default `nvim`); bad name → usage — `omarchy-menu.jsonc:165-173`, `bin/omarchy-default-editor`.
- *Install > Development > {Ruby on Rails, Docker DB, JavaScript > {Node.js, Bun, Deno}, Go, PHP > {PHP, Laravel, Symfony}, Python, Elixir > {Elixir, Phoenix}, Zig, Rust, Java, .NET, OCaml, Clojure, Scala}* → `omarchy-install-dev-env <lang>` in floating terminal; rows dim when `~/.local/share/mise/installs/<lang>` (or `~/.rustup`, `~/.opam`, `php` pkg…) exists — `omarchy-menu.jsonc:263-284`, `bin/omarchy-install-dev-env`. Bad language → usage, exit 1.
- **Node.js is preinstalled** by provisioning (`mise use -g node@latest`, bundled tarball on the ISO) so *Install > Development > JavaScript > Node.js* is already dim ✓ on a fresh disk — `install/user/mise-work.sh` (manual does not say so).
- `~/Work` and `~/Work/tries` are created at provision — `install/user/mise-work.sh:2-3`.
- *Remove > Development > …* rows appear only when installed — `omarchy-menu.jsonc:330-350`.
- `mise use -g ruby`, `mise i` — manual only; `mise activate bash` in `default/bash/init:1-3`; `set +h` so mise shims are re-looked-up — `default/bash/shell:13`.
- Docker: `docker`, `docker-compose`, `docker-buildx`, `lazydocker` are base; user is **not** in the `docker` group; `docker ps` fails with permission denied, `sudo docker ps` works; `d` = `docker` — `install/config/docker.sh`, `aliases:50`, `bin/omarchy-sudo-docker`.
- `Super+Shift+D` → `omarchy-launch-tui omarchy-launch-docker-tui` → when sudo is needed, `pkexec … lazydocker` (polkit password dialog from the Omarchy shell), else `lazydocker` — `applications.lua:16`, `bin/omarchy-launch-docker-tui`; also the *Docker* launcher entry (`TUI.tile`) — `applications/Docker.desktop`.
- *Setup > Security > Sudoless Docker* (shown only while the account is *not* in the group) → warning text + `gum confirm` → `usermod -aG docker`, records `reboot-required`, offers reboot; declining prints `Aborted. No changes made…` — `omarchy-menu.jsonc:186`, `bin/omarchy-setup-security-sudoless-docker`. *Remove > Security > Sudoless Docker* appears once configured — `omarchy-menu.jsonc:302`.
- *Install > Development > Docker DB* → `gum choose` among MySQL, PostgreSQL, Redis, MongoDB, MariaDB, MSSQL → `sudo docker run -d --restart unless-stopped -p 127.0.0.1:<port>…` — `bin/omarchy-install-docker-dbs`.
- `gh` lazy stub (mise `gh`); `gh auth login`; `gh repo clone org/repo` — `install/user/mise.sh:9`, `manual/18:33-35`.
- `ghui` lazy stub (`npm:@kitlangton/ghui`) — `install/user/mise.sh:18`.
- `lazygit` base; `config/lazygit/config.yml` is empty (defaults) — `install/omarchy-base.packages`, `config/lazygit/config.yml`.
- Git defaults: aliases `co/br/ci/st`, `init.defaultBranch=master`, `pull.rebase`, `push.autoSetupRemote`, histogram diff, rerere — `config/git/config`; identity set from install inputs when provided — `install/user/git.sh`.

### 19 — Shell tools

- `ff` = `fzf --preview 'bat --style=numbers --color=always {}'` (kitty variant previews images) — `aliases:9-13`; `eff` = open `ff` pick in `$EDITOR`; `sff <dest>` scp the pick (usage when no arg) — `aliases:14-15`.
- `Ctrl+R` fzf history — `default/bash/init:21-28` sources `/usr/share/fzf/key-bindings.bash`.
- zoxide: `cd` aliased to `zd` (real dirs `cd`, else `z`, prints `󱗩 <pwd>` on a jump); miss → `Error: Directory not found`, return 1; `zoxide init bash` — `aliases:17-34`, `init:9-11`.
- `rg`, `fd`, `bat` (base); `BAT_THEME=ansi`; man pages through bat (`MANPAGER`) — `envs:9-13`.
- eza: `ls` = `eza -lh --group-directories-first --icons=auto`, `lsa` = `ls -a`, `lt` = `eza --tree --level=2 --long --icons --git`, `lta` = `lt -a` — `aliases:2-7`.
- `tldr` (base `tldr`) — `install/omarchy-base.packages:170`.
- `yt-dlp` (base); Download Video extension writes to `${OMARCHY_YTDLP_DIR:-~/Videos}` — `bin/omarchy-chromium-ytdlp-host:18`.
- `try` (base `tobi-try`): lazily `eval "$(try init ~/Work/tries)"` on first call — `init:13-19`.
- `open <file>` = detached `xdg-open` — `aliases:36-38`; `..`, `...`, `....` — `aliases:41-43`; `g`, `gcm`, `gcam`, `gcad` — `aliases:60-64`; `r` = `rails`, `h` = `herdr` — `aliases:51,53`.
- Readline: arrow-key history search, case-insensitive completion, Tab menu-complete — `default/bash/inputrc`.
- `omarchy` bash completion for the router; `omarchy-*` binaries hidden from first-word completion — `default/bash/completions`.
- Project `bin/` is not on PATH (`~/.local/bin` and mise shims are appended) — `default/bash/env-bootstrap:33-41`, `manual/19:61`.

### 20 — Shell functions

- `compress <file|dir>` → `<name>.tar.gz`; `decompress` = `tar -xzf` — `fns/compression`.
- `iso2sd <iso> [device]`: no args → usage + example; no device → picks from `/dev/sd*` via `omarchy-drive-select` (`No SD drives found and no drive specified` when none) → `sudo dd … && sudo eject` — `fns/drives:2-30`.
- `format-drive <device> <name>`: wrong arg count → usage + "Available drives:" list; else WARNING + `Are you sure … (y/N)` → wipefs/parted/mkfs.exfat — `fns/drives:33-59`.
- Herdr layouts `hdl`, `hds`, `hdlm`, `hsl` mirror the tmux ones; require `$HERDR_PANE_ID` (`You must start herdr to use hdl.`) — `fns/herdr`.
- `ga <branch>` → `git worktree add -b <branch> ../<repo>--<branch>`, `mise trust`, `cd`; no arg → `Usage: ga [branch name]` — `fns/worktrees:2-15`.
- `gd` → `gum confirm "Remove worktree and branch?"`; only acts when the directory name contains `--` — `fns/worktrees:18-36`.
- `rsw <src> <dst>` background rsync+inotifywait watcher (`Watching <src> -> <dst>`); wrong arg count → usage; `lsw` lists (`No active watches`); `dsw` stops (`Stopped watch (pid …)`) — `fns/rsyncing`.
- `fip <host> <port…>` (`ssh -f -N -L`), `dip <port…>` (`Stopped forwarding port N` / `No forwarding on port N`), `lip` (`No active forwards`); missing args → usage — `fns/ssh-port-forwarding`.
- `ssh` wrapper: disarms mouse/alt-screen after exit; reconnect loop (`Connection lost. Reconnecting (Ctrl-C to stop)...`) only for interactive sessions that ran ≥30 s and exited 255 — `fns/ssh-reconnect`.

### 21 — TUIs

- lazygit in any repo; `Space g g` in Neovim — `manual/21:5-9`.
- lazydocker via `Super+Shift+D` (see 18).
- `Super+Ctrl+T` → `omarchy-launch-tui btop` (class `org.omarchy.btop`, tagged floating-window 875×600 centred); `Super+T` toggles floating; btop theme `current`, vim keys on — `utilities.lua:104`, `default/hypr/apps/system.lua:2-9`, `config/btop/btop.conf`.
- `Super+Ctrl+Return` → `omarchy-launch-terminal herdr` (persistent session); `h` = `herdr`; prefix `Ctrl+Space`; `Super+Ctrl+K` → `omarchy-menu-herdr-keybindings`; *Learn > Herdr* — `applications.lua:13`, `bin/omarchy-launch-terminal-herdr`, `config/herdr/config.toml`, `utilities.lua:12`, `omarchy-menu.jsonc:52`.
- *About* (root menu row) → `omarchy-launch-about` → floating `org.omarchy.about` terminal running fastfetch with the Omarchy logo (`~/.config/omarchy/branding/about.txt`) and boxed Hardware / Software / Age-Uptime-Update sections — `omarchy-menu.jsonc:33`, `bin/omarchy-launch-about`, `etc/fastfetch/config.jsonc`, `apps/system.lua:31-33`.
- *Disk Usage* launcher → `xdg-terminal-exec --app-id=TUI.float -e bash -c "dua i /"` (floating) — `applications/Disk Usage.desktop`; `dua-cli` base.
- `Super+Shift+Alt+M` → `omarchy-launch-or-focus-tui cliamp`; also Apps menu — `applications.lua:15`; `cliamp` base.
- `Super+Ctrl+W` network panel, `Super+Ctrl+B` bluetooth panel — `utilities.lua:99,102` (other reviewer's area; only referenced).
- *Install > TUI* → `omarchy-tui-install` (gum prompts: Name, Launch Command, Window style float|tile, Icon URL/name) → `~/.local/share/applications/<Name>.desktop` with `Exec=xdg-terminal-exec --app-id=TUI.float|TUI.tile -e <cmd>`; empty fields → `You must set app name, app command, and icon URL/name!`; CLI form needs exactly 4 args — `omarchy-menu.jsonc:214`, `bin/omarchy-tui-install`.
- *Remove > TUI* (shown when any `~/.local/share/applications/*.desktop` has a terminal `-e` Exec — true on a stock disk because of Disk Usage/Docker) → picker → notification "TUI removed" — `omarchy-menu.jsonc:295`, `bin/omarchy-tui-remove`.
- `btop` is hidden from the app launcher list (launched via Activity instead) — `default/omarchy/launcher.hides`.

### 22 — GUIs

- `Super+Shift+F` → `nautilus --new-window`; `Super+Shift+Alt+F` → `nautilus --new-window <terminal cwd>` — `applications.lua:4-5`, `bin/omarchy-launch-nautilus{,-cwd}`; `Ctrl+L` path bar, `Space` preview via `sushi` (base).
- Automount via `udiskie` (base); *Disks* = `gnome-disk-utility` (base).
- Default handlers: images → `imv` (`applications/imv.desktop`), video → `mpv` (`applications/mpv.desktop`), PDFs → Evince (base), text → Neovim — `manual/22:9`; imv/mpv/Evince windows float — `apps/system.lua:7-9`.
- `Super+Shift+O` → `omarchy-launch-or-focus '^obsidian$' 'uwsm-app -- obsidian'` (second press focuses) — `applications.lua:18`; `obsidian` base; *Omarchy* theme must be picked inside Obsidian for theme sync — `manual/22:19`.
- `Super+Shift+W` → `uwsm-app -- omawrite` — `applications.lua:19`; base.
- Pinta, Aether, LibreOffice (`libreoffice-fresh`), mpv, OBS (`obs-studio`), Kdenlive, Omacut: base, launched from the app launcher — `install/omarchy-base.packages`.
- `Super+Ctrl+S` / *Trigger > Share* → submenu {Clipboard, File, Folder, Receive} → `omarchy-menu-share clipboard|file|folder` / `uwsm-app -- localsend` — `utilities.lua:85`, `omarchy-menu.jsonc:70,86-89`; `omarchy share clipboard|file [path]|folder [path]` routes to the same script; no args → usage — `bin/omarchy-menu-share`, `bin/omarchy` (group/name metadata).
- Share windows float (`Share|localsend`, 1100×700) — `apps/localsend.lua`.
- Nautilus right-click *Send via LocalSend* — `default/nautilus-python/extensions/localsend.py`.
- `Super+Ctrl+Q` and `XF86Calculator` → `omacalc` (floating) — `utilities.lua:13-14`, `apps/system.lua:37`.
- `Super+Shift+G` → `omarchy-launch-signal`: focuses an existing Signal window, launches `/usr/bin/signal-desktop` if present, otherwise starts `omarchy-install-service-signal` in a floating terminal (installs `signal-desktop`, launches it, prints "Signal has been installed.") — `applications.lua:17`, `bin/omarchy-launch-signal`, `bin/omarchy-install-service-signal`. `signal-desktop` is **optional**. Also *Install > Service > Signal* — `omarchy-menu.jsonc:226`.

### 23 — Browsers

- Chromium (base) is the default; `Super+Shift+Return` and `Super+Shift+B` → `omarchy-launch-browser`; `Super+Shift+Alt+B` → `omarchy-launch-browser --private` (incognito / `--inprivate` for Edge / `--private-window` for Firefox family) — `applications.lua:3,6-7`, `bin/omarchy-launch-browser`.
- Chromium flags: Wayland ozone, gnome-libsecret store, `--load-extension=…/copy-url,…/yt-dlp,…/whatsapp-slim` — `config/chromium-flags.conf`; native-messaging hosts for copy-url and yt-dlp written at provision — `install/user/chromium.sh`.
- *Install > Browser > {Chrome, Edge, Brave, Brave Origin, Firefox, Zen}* → `omarchy-install-browser <name>` (Chrome/Edge/Brave/Brave Origin/Zen from AUR via `omarchy-pkg-aur-add`; Firefox from repos); Chromium-family get policy dir + flags + Copy URL/yt-dlp hosts + theme; Firefox/Zen get policies + `MOZ_ENABLE_WAYLAND=1`; ends with "<Name> browser installed. Make it the default via Setup > Defaults > Browser." — `omarchy-menu.jsonc:217-222`, `bin/omarchy-install-browser`.
- *Setup > Defaults > Browser > {Chromium, Chrome, Brave, Brave Origin, Edge, Firefox, Zen}* → `omarchy-default-browser <name>`; ✓ on current via `xdg-settings`; **all seven rows are always listed** (no `when`/`disabled`), and picking an uninstalled one runs the installer first — `omarchy-menu.jsonc:152-159`, `bin/omarchy-default-browser:40-47`. (Manual says only installed browsers are listed — disagreement.)
- `omarchy default browser` (no arg) prints `chromium|chrome|brave|brave-origin|edge|firefox|zen`; sets `xdg-settings set default-web-browser`; notification "<Name> is now the default browser"; bad name → usage exit 1 — `bin/omarchy-default-browser`.
- Copy URL extension: `Alt+Shift+L` (manifest `suggested_key`) → clipboard + Omarchy notification; toolbar button — `default/chromium/extensions/copy-url/manifest.json:16`.
- Download Video extension: `Alt+Shift+D` → yt-dlp host → `~/Videos` (or `$OMARCHY_YTDLP_DIR`), progress on the OSD — `default/chromium/extensions/yt-dlp/manifest.json:18`, `bin/omarchy-chromium-ytdlp-host:18`.
- Firefox/Zen: no extensions, not themed — `manual/23:31-35`.
- *Remove > Browser > …* rows only when installed; Chromium never listed — `omarchy-menu.jsonc:304-309`.
- Chromium-family windows tagged and forced to tile; YouTube/Zoom app windows lose the browser tag (opaque) — `apps/browser.lua`.
- `$BROWSER` = `omarchy-launch-browser` in shells only — `envs:8`.

### 24 — Commercial apps / services

- `Super+Shift+/` → `omarchy-launch-1password`: runs `1password --force-device-scale-factor=1` if present, else `omarchy-install-service-1password` (installs `1password 1password-cli`, writes the Chromium external-extension JSON under `/usr/share/chromium/extensions/`, launches 1Password, prints "Restart Chromium to load the browser extension.") — `applications.lua:20`, `bin/omarchy-launch-1password`, `bin/omarchy-install-service-1password`; *Install > Service > 1Password* — `omarchy-menu.jsonc:223`. Optional.
- *Install > Service > Bitwarden* → `omarchy-install-and-launch Bitwarden 'bitwarden bitwarden-cli' bitwarden` — `omarchy-menu.jsonc:230`.
- `Super+Shift+M` → `omarchy-launch-spotify`: focus / `/usr/bin/spotify` / `omarchy-install-service-spotify` — `applications.lua:14`, `bin/omarchy-launch-spotify`, `bin/omarchy-install-service-spotify`; *Install > Service > Spotify* — `omarchy-menu.jsonc:225`. Optional.
- *Install > Service > Dropbox* → `omarchy-install-service-dropbox`; tray icon setup — `omarchy-menu.jsonc:224`; hidden from launcher list — `launcher.hides`.
- *Install > Service > Tailscale* → `omarchy-install-service-tailscale`; bar panel + admin web app + Taildrop — `omarchy-menu.jsonc:227`, `manual/24:27-29`.
- *Install > Service > ONCE* → `omarchy-install-service-once` (`once-bin`, enables `once-background.service`, runs `sudo once`) — `omarchy-menu.jsonc:229`, `bin/omarchy-install-service-once`.
- *Install > Service > NordVPN* → `omarchy-install-service-nordvpn` (`nordvpn-bin`, enables `nordvpnd`, adds to `nordvpn` group, `gum confirm` reboot) — `omarchy-menu.jsonc:228`, `bin/omarchy-install-service-nordvpn`.
- *Install > Service > Chromium Account* (Google OAuth client id for Chromium sync) — `omarchy-menu.jsonc:231` (not in manual chapter).
- *Remove > Services > {Dropbox, Tailscale}* only — `omarchy-menu.jsonc:310-311` (no remove rows for 1Password, Spotify, Signal, ONCE, NordVPN, Bitwarden; `bin/omarchy-remove-service-1password` exists as a CLI-only path, the rest go through *Remove > Package*).

### 25 — Web apps

- `omarchy-launch-webapp <url>` → `<browser exec> --app=<url>` using the default browser if Chromium-family, else `chromium.desktop` — `bin/omarchy-launch-webapp`.
- `omarchy-launch-or-focus-webapp <pattern> <url>` used by bindings with `focus = true` — `helpers.lua:67-72,131-133`.
- Hotkeys (only while `~/.local/state/omarchy/preinstalls-removed` is absent): `Super+Shift+A` ChatGPT (chatgpt.com), `Super+Shift+Alt+A` Grok (grok.com), `Super+Shift+C` HEY Calendar, `Super+Shift+E` HEY Email, `Super+Shift+Alt+E` HEY new email, `Super+Shift+Y` YouTube, `Super+Shift+Alt+G` WhatsApp (focus), `Super+Shift+Ctrl+G` Google Messages (focus), `Super+Shift+P` Google Photos (focus), `Super+Shift+S` Google Maps (focus), `Super+Shift+X` X, `Super+Shift+Alt+X` X compose — `applications.lua:22-33`, `helpers.lua:84-90`.
- Launcher entries (`~/.local/share/applications/`): Basecamp (launchpad.37signals.com), Discord (discord.com/channels/@me), Google Contacts, Google Maps, Google Messages, Google Photos, HEY (`omarchy-webapp-handler-hey %u`, `mailto` handler), WhatsApp, X, YouTube, Zoom (`omarchy-webapp-handler-zoom %u`, `zoommtg`/`zoomus` handler) — `applications/*.desktop`. **ChatGPT and Grok have hotkeys but no launcher entry** (icon `ChatGPT.png` ships unused).
- `omarchy-webapp-handler-hey mailto:<addr>` → `app.hey.com/messages/new?to=<addr>`; `omarchy-webapp-handler-zoom zoommtg://…confno=N[&pwd=P]` → `app.zoom.us/wc/join/N[?pwd=P]` — `bin/omarchy-webapp-handler-{hey,zoom}`.
- *Install > Web App* → `omarchy-webapp-install` (gum: Name, URL, then Icon URL/name only if favicon fetch fails) → `~/.local/share/applications/<Name>.desktop`, icon in `~/.local/share/icons/hicolor/256x256/apps/`; prints "You can now find <Name> using the app launcher (SUPER + SPACE)" — `omarchy-menu.jsonc:212`, `bin/omarchy-webapp-install`.
- Validation: name with `/` → `App name cannot contain '/'`; URL with whitespace → `Error: web app URL must not contain whitespace.`; non-http(s) scheme (e.g. `javascript:`) → `Error: web app URL must be http or https.`; schemeless input gets `https://`; icon download failure → `Error: Failed to download icon.` — `bin/omarchy-webapp-install:14-27,61-84,155-180`.
- CLI form `omarchy webapp install <name> <url> <icon-url-or-name> [custom-exec] [mime-types]` — `bin/omarchy-webapp-install:4`.
- *Remove > Web App* (shown when any launcher-webapp `.desktop` exists — true on stock) → `omarchy-webapp-remove` picker → notification "Web app removed <Name>"; CLI `omarchy webapp remove <name>` **notifies success even when nothing matched** — `omarchy-menu.jsonc:294`, `bin/omarchy-webapp-remove`.
- `Shift+Alt+L` inside a web app copies its URL (Copy URL extension is loaded for `--app` windows too) — `manual/25:13`.
- Hotkeys editable in `~/.config/hypr/bindings.lua` (*Setup > Keybindings*) — `manual/25:11`, `omarchy-menu.jsonc:127`.
- *Remove > Preinstalls* / *Install > Preinstalls*: removes all web apps, TUIs, the preinstalled-binding block, mise stubs and a package set — `omarchy-menu.jsonc:216,297`, `bin/omarchy-remove-preinstalls`.

### 26 — Gaming

- *Install > Gaming > {Steam, RetroArch, Minecraft, NVIDIA GeForce NOW, Xbox Cloud Gaming, Xbox Controllers, Battle.net, Lutris, Heroic (Epic Games), RetroArch Game Launcher}*; rows dim when installed (`steam`, `retroarch`, `minecraft-launcher`, flatpak `com.nvidia.geforcenow`, `Xbox Cloud Gaming.desktop`, `xpadneo-dkms`, `~/Games/battlenet`, `lutris`, `heroic-games-launcher-bin`) — `omarchy-menu.jsonc:253-262`.
- Steam: `omarchy-pkg-add steam` + `omarchy-install-gaming-gpu-lib32`, then `gtk-launch steam`; Steam windows float 1100×700 — `bin/omarchy-install-gaming-steam`, `apps/steam.lua`.
- RetroArch: ~50 packages (cores, assets, shaders), creates `~/Games/{bios,roms}`, writes `retroarch.cfg` with `video_driver = "vulkan"`, XMB menu, crt-royale global shader, opens Nautilus on `~/Games` — `bin/omarchy-install-gaming-retroarch`.
- RetroArch Game Launcher: `omarchy-games-retro-install` → core picker (`No RetroArch cores found` notification when `/usr/lib/libretro` is empty) → ROM picker → `<game>.desktop`; CLI `omarchy games retro install <core> <rom>`: `Game not found: …` / `Core not found: …` / usage on wrong arg count — `bin/omarchy-games-retro-install`.
- Xbox Cloud Gaming: web app `https://www.xbox.com/en-US/play` with a CDN icon, then launched — `bin/omarchy-install-gaming-xbox-cloud`.
- Moonlight (`moonlight-qt`) is base; launched from the app launcher — `install/omarchy-base.packages:97`.
- `omarchy install service sunshine` → `bin/omarchy-install-service-sunshine` (exists).
- Battle.net: `omarchy launch battlenet [--with-mangohud]` → umu-run + GE-Proton; not installed → `Battle.net is not installed. Run omarchy-install-gaming-battlenet first.` (exit 1); unknown flag → `Unknown argument: …`; `--help` prints usage — `bin/omarchy-launch-battlenet`.
- Xbox Controllers: `xpadneo-dkms`; pair via `Super+Ctrl+B` — `omarchy-menu.jsonc:258`, `manual/26:59`.
- *Remove > Gaming > …* rows only when installed — `omarchy-menu.jsonc:321-329`.

### 27 — Filling out PDFs

- Document Viewer = `evince` (base); floats (`org.gnome.Evince`) — `install/omarchy-base.packages:39`, `apps/system.lua:7`.
- Xournal++ (`xournalpp`, base); reached via Nautilus right-click → *Open With…*; T (text) tool, Image tool, *File > Export as PDF* — `install/omarchy-base.packages:196`, `manual/27`.
- Both are removed by *Remove > Preinstalls* (xournalpp is in the drop list; evince is not) — `bin/omarchy-remove-preinstalls:52-65`.

### 28 — Windows VM

- *Install > Windows* (dim once `~/.local/share/applications/windows-vm.desktop` exists) → `omarchy-windows-vm install` in floating terminal — `omarchy-menu.jsonc:215`.
- Prerequisites: `/dev/kvm` must exist (`❌ KVM virtualization not available!` box with modprobe hints, exit 1); free space on the filesystem holding `~/.windows` must be ≥ disk+10 GB (`❌ Insufficient disk space!` with Available/Required) — `bin/omarchy-windows-vm:1126-1153`.
- Installer prompts: RAM, cores, disk (64 GB floor advised), username/password (blank → `docker`/`admin`); progress at `http://127.0.0.1:8006` (auth-gated) — `manual/28:7`, `bin/omarchy-windows-vm:1326-1349`.
- *Windows* launcher → `omarchy-windows-vm launch` (start + RDP full screen via xfreerdp, title `Windows VM - Omarchy`, opaque) — `apps/windows-vm.lua`; `--keep-alive|-k` keeps the VM up after RDP closes — `bin/omarchy-windows-vm:1388,1563`.
- `omarchy windows vm status` → `Windows VM not configured. To set up: omarchy-windows-vm install` (exit 1) when there is no compose; RUNNING box with web/RDP ports otherwise — `bin/omarchy-windows-vm:1520-1553`.
- `omarchy windows vm stop|down`, `launch|start`, `help|--help|-h|""` → usage; unknown command → `Unknown command: …` + usage, exit 1 — `bin/omarchy-windows-vm:1585-1620`.
- `omarchy windows key` → OEM key from `/sys/firmware/acpi/tables/MSDM`; absent → `No Windows license key found in firmware.` exit 1 — `bin/omarchy-windows-key`.
- `~/Windows` shared, `~/.windows` disk, compose at `/var/lib/omarchy/windows/docker-compose.yml` (root-owned); Docker reached via polkit unless sudoless — `manual/28:27-37`, `bin/omarchy-windows-vm:1-40`.
- *Remove > Windows* (only when installed) → `omarchy-windows-vm remove` — `omarchy-menu.jsonc:296`.

### 29 — Other packages

- *Install > Package* → `xdg-terminal-exec --app-id=org.omarchy.terminal omarchy-pkg-install` → fzf over `pacman -Slq` with `pacman -Sii` preview (alt-p toggles, Tab multi-select), Esc cancels silently, selection → `sudo pacman -S --noconfirm` + "Done!/Failed! Press any key to close…" — `omarchy-menu.jsonc:194`, `bin/omarchy-pkg-install`, `bin/omarchy-show-done`.
- *Install > AUR* → `omarchy-pkg-aur-install` (fzf over `yay -Slqa`, alt-b shows PKGBUILD) → `yay -S --noconfirm aur/<pkg>` — `omarchy-menu.jsonc:195`, `bin/omarchy-pkg-aur-install`.
- *Remove > Package* → `omarchy-pkg-remove` (fzf over `yay -Qqe`, red pointer) → `sudo pacman -Rns --noconfirm` — `omarchy-menu.jsonc:287`, `bin/omarchy-pkg-remove`.
- `omarchy pkg add <pkgs…>` → `sudo pacman -S --noconfirm --needed`; a name pacman cannot find → `error: target not found` + red `Error: Package '<pkg>' did not install`, exit 1 — `bin/omarchy-pkg-add`.
- `omarchy pkg drop <pkgs…>` → `sudo pacman -Rns --noconfirm` for the installed subset; unknown names silently ignored — `bin/omarchy-pkg-drop`.
- `omarchy pkg present <pkgs…>` exit status — `bin/omarchy-pkg-present`.

### Cross-cutting

- Floating "presentation" terminal: app-id `org.omarchy.terminal`, title `Omarchy`, green logo, then the command, then `● Done! Press any key to close...` or `● Failed (exit code N)! Press any key to close...` (Ctrl-C exit 130 closes without the prompt) — `bin/omarchy-launch-floating-terminal-with-presentation`, `bin/omarchy-show-done`.
- `omarchy-launch-tui [--app-id=<id>] <cmd>` → `xdg-terminal-exec --app-id=org.omarchy.<cmd> -e <cmd>`; `omarchy-launch-or-focus-tui` focuses an existing window whose class/title matches — `bin/omarchy-launch-tui`, `bin/omarchy-launch-or-focus{,-tui}`.
- Menu row states: `disabled` rows stay listed but dim with ✓ (installed); `when` rows disappear; `checked` rows get ✓ — `omarchy-menu.jsonc:15-21`.
- Omarchy Menu `Super+Space`, Apps `Super+Alt+Space`, System `Super+Escape`, Keybindings `Super+K` — `utilities.lua:1-10`.
- Polkit prompts (pkexec for lazydocker / Windows VM) are rendered by the Omarchy shell — `shell/shell.qml` (grep only).

## Observations

Things a driver (or the test author) must know before running anything below.

**Machine / environment**

- No GPU: Chromium, Electron apps (Obsidian, Signal, Spotify, 1Password), Kitty/Alacritty/Ghostty, Moonlight, OBS and Kdenlive all fall back to software rendering (llvmpipe). They open, but slowly (allow 10–20 s). RetroArch is configured with `video_driver = "vulkan"` and there is no Vulkan ICD in the base package set, so RetroArch is expected to fail to start its video driver in this guest.
- No audio device: Cliamp, Spotify, mpv and YouTube open but cannot play sound; that is not a failure of the launch path.
- Network works outbound. Every mise stub (`claude`, `codex`, `opencode`, `pi`, `gh`, `ghui`, `hunk`, `ori`, …) downloads on first invocation; `tldr` downloads its page cache on first run; `yay -Slqa` (Install > AUR) needs the AUR index. The guest's public IP is a datacenter IP: YouTube, X, Google may show bot checks or refuse video streams; verify *windows*, not content.
- `sudo` asks for the password `prime` unless the driver enabled passwordless sudo earlier in the same session. `pkexec` (lazydocker, Windows VM) shows a graphical polkit dialog from the Omarchy shell; type `prime` there.
- `/dev/kvm` is almost certainly absent inside the guest (nested virtualization is off by default), so *Install > Windows* stops at the KVM check. If it is present, the 40 GB disk fails the space check instead (64+10 GB required). Either way the installer refuses gracefully — that refusal is the test.
- The minted user may or may not have `git user.name/email` set (it comes from install inputs). Tests that commit set a repo-local identity first.

**State and ordering**

- Everything under `~/.local/share/applications/`, `~/.local/state/omarchy/defaults/`, `~/.config/omarchy/defaults/agent`, `~/.config/xdg-terminals.list`, `~/.local/state/omarchy/toggles/` persists for the rest of the session on the same disk. Tests that flip a default (terminal, editor, browser, agent, sudoless docker) must restore it or be run last / end with `stop`.
- Enabling sudoless Docker changes group membership that only applies after a reboot; the removal counterpart restores it. Do not reboot inside a test unless the test says so.
- Preinstalled web apps, Disk Usage and Docker launchers live in `~/.local/share/applications/` (installed from `/etc/skel`), so *Remove > Web App* and *Remove > TUI* are visible on a stock disk. Never pick a preinstalled one in a removal test unless the test says to; there is no per-app undo (only *Install > Preinstalls* after *Remove > Preinstalls*).
- The Omarchy Menu (`Super+Space`) filters as you type; app rows are searchable by name. Menu rows with a `disabled` condition are shown dim with a trailing ✓ and cannot be selected; rows with a `when` condition are absent.
- The floating install terminal ends with `● Done! Press any key to close...` (green) or `● Failed (exit code N)! Press any key to close...` (red). The driver must press a key to close it; screenshot it first.

**Manual vs. code disagreements found (details in Gaps)**

1. `manual/23-browsers.md:9` says *Setup > Defaults > Browser* "only lists browsers you actually have installed". The menu lists all seven unconditionally and picking an uninstalled one starts its installer (`omarchy-menu.jsonc:152-159`, `bin/omarchy-default-browser:40-47`). Same pattern for *Setup > Defaults > Terminal* vs `manual/15:7` ("switch between installed terminals").
2. `manual/22-guis.md:72` says the Signal hotkey will "offer to install"; `omarchy-launch-signal` starts the install immediately (the only gate is the sudo password prompt). Same wording issue for Spotify/1Password in `manual/24`.
3. `manual/17-ai.md:53` lists the *Install > AI* desktop apps without *T3 Code* and *Dictation*, both present in `omarchy-menu.jsonc:245,252`.
4. `manual/25-web-apps.md` says ChatGPT/Grok are web apps; they have hotkeys but no launcher entry (`applications/` has no ChatGPT/Grok `.desktop`, although `applications/icons/ChatGPT.png` ships). They are not in the app launcher and *Remove > Web App* cannot list them.
5. `default/bash/fns/tmux:37` — `tdl` ends with `tmux select-pane -t "$opencode_pane"`; `opencode_pane` is never assigned in `tdl` (it belongs to `tds`), so the final focus step targets an empty pane id. Expect either a `can't find pane` message in the terminal pane or focus not landing on the editor. The manual's screenshot implies the editor pane is focused.
6. `manual/18-development-tools.md:15` presents Node.js as something to install under *Install > Development*; provisioning already installs it (`install/user/mise-work.sh`), so that row is dim on a fresh disk.
7. `omarchy webapp remove <name>` for a name that does not exist still sends the "Web app removed" notification (`bin/omarchy-webapp-remove:66-70`) — a false success.
8. `manual/15-terminal.md:13` "Ctrl+Space then s" relies on tmux's stock binding; the Omarchy cheatsheet (`Super+Alt+K`, `prefix ?`) does not list it because the config never binds it.
9. `manual/24` says nothing about *Remove > Services* only covering Dropbox and Tailscale; 1Password/Spotify/Signal/ONCE/NordVPN/Bitwarden have no dedicated removal row (`omarchy-menu.jsonc:310-311`).
10. `manual/20:12` says `iso2sd` picks the drive "interactively"; the code only lists `/dev/sd*` devices and prints `No SD drives found and no drive specified` otherwise (`fns/drives:13-17`) — NVMe-only machines never get a picker.

**Cross-reviewer facts applied here (from `test_def/01-FACTS.md`)**

- Every step below is a `send-keys`, `mouse …`, `get-image` or `get-serial`; commands are typed in a guest terminal (`Super+Return`). No host channel is assumed anywhere.
- Chromium / Electron start-up on 2 vCPU can raise Hyprland's "not responding" dialog — click **Wait**. GTK apps (Nautilus, file choosers) render oversized at 1× (`omarchy_gdk_scale = 2`) — expected.
- Menu guards paint from the previous evaluation: after installing/removing/setting a default, **reopen the menu twice** before asserting a ✓ moved, a row dimmed or a row appeared. Dimmed rows are skipped by cursor/click and omitted from search.
- Crash-capture toasts are silent until a default agent is recorded (`omarchy-crash-watch` skips when `omarchy-default-agent` is empty).
- `omarchy-install-gaming-gpu-lib32` exits 1 when no Intel/AMD/NVIDIA GPU is found; under `set -e` Steam (and Heroic/Lutris/Battle.net) installers end `Failed (exit code 1)` on virtio-vga and never launch the app.
- `omarchy-install-service-tailscale` blocks at `sudo tailscale up` waiting for a browser login; Ctrl+C in the floating terminal kills the whole script (no bar plugin, no web app).
- `omarchy-install-dev-env <unknown>` has no default `case` branch: it succeeds silently (exit 0).
- The 4.0.2 minted disk may lack HEAD-only commands (`omarchy crash mute`, channels); record `omarchy version` first and report "absent on this build" rather than "broken".
- Negative CLI steps append `; echo exit=$?` because exit codes are otherwise invisible on a screenshot. `Ctrl+Space` is also fcitx5's trigger: if a tmux/herdr prefix seems swallowed, try the `Alt+Enter` split first.
- Other reviewers propose `about-fastfetch` (41) and `webapp-install-rejects-bad-input` (22) under the same names; both blocks below carry `dedupe-with:` for synthesis.

## Proposed tests

Naming: `<area>-<behaviour>`; one user story per test; negative paths folded in as sub-steps when short.

### terminal-hotkey-opens-foot   [VM-OK]
description: Super+Return opens the default terminal (Foot) and a second press follows the active terminal's directory, so the manual's terminal workflow is reachable from the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. A terminal window must open with the Starship prompt, padded edges and themed colours.
  * Type `omarchy default terminal` and press Enter. The answer must be `foot`.
  * Type `cd /tmp` and press Enter, then press Super+Return again.
  ** A second terminal opens; typing `pwd` + Enter in it must print `/tmp` (new terminals follow the active terminal's directory).
  * Press Super+C in the second terminal, then type `echo copied` + Enter.
  ** The chord maps to Ctrl+Insert inside terminals; the terminal must keep working, nothing must close.
  * Close both terminals with Super+W. The desktop must be back to empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Foot has no tabs or splits; a second Super+Return always makes a second window, tiled beside the first.
  * The first terminal may open in the home directory; only the second must match the first's `cd`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the first terminal showing `foot`.
  ** Screenshot of the second terminal with `pwd` printing `/tmp`, and of the empty desktop at the end.
  * If unsuccessful
  ** Screenshot of whatever appeared (or did not) after Super+Return.
covers: manual/15-terminal.md:3-7; default/hypr/bindings/applications.lua:2; bin/omarchy-launch-terminal; bin/omarchy-cmd-terminal-cwd; config/foot/foot.ini; test/acceptance.d/apps-test.sh (terminal row)

### tmux-session-attach-and-resume   [VM-OK]
description: Super+Alt+Return starts the persistent `Work` tmux session and re-attaches to it after the window is closed, with the Ctrl+Space prefix and Alt+Enter split working as documented.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Return. A terminal opens inside tmux: a status bar along the top with the session name `Work` on the left.
  * Type `export MARKER=alive` and press Enter.
  * Press Alt+Enter, then Alt+Escape.
  ** The pane splits top/bottom, then the new pane is killed again.
  * Press Ctrl+Space then `s`. tmux's session chooser must list `Work`; press Escape to leave it.
  ** The status bar shows `PREFIX` on the right while the prefix is armed. If nothing happens, try Ctrl+B (the second prefix) — Ctrl+Space may be swallowed by fcitx5.
  * Close the terminal with Super+W (this detaches only), then press Super+Alt+Return again.
  ** The same session re-attaches; `echo $MARKER` + Enter must print `alive`.
  * Type `tmux kill-server` and press Enter; the window closes and the desktop is empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send Ctrl+Space as `<C-SPACE>`.
  * The session chooser is a full-pane list; `q` also closes it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the status bar with `Work`, the split, the session chooser, and `echo $MARKER` printing `alive` after re-attaching.
  * If unsuccessful
  ** Screenshot of the terminal after Super+Alt+Return (plain shell or error text).
covers: manual/15-terminal.md:9-15; default/hypr/bindings/applications.lua:12; bin/omarchy-launch-terminal-tmux; config/tmux/tmux.conf; default/bash/aliases:52

### tmux-keybindings-cheatsheets   [VM-OK]
description: The tmux cheatsheet is reachable from the desktop (Super+Alt+K, Learn → Tmux) and from inside tmux (prefix ?), so the ergonomic bindings can be learned where the manual points.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+K. A searchable menu titled "Tmux keybindings" appears; its first row reads `PREFIX → CTRL + SPACE / CTRL + b` and rows such as `ALT + ENTER → Split pane vertically` follow.
  * Type `session`. Only session rows remain (e.g. `PREFIX + C → Create session`). Press Escape twice (first clears the filter, second closes).
  * Open Omarchy Menu with Super+Space → Learn → Tmux. The same menu appears; Escape.
  * Press Super+Alt+Return, then Ctrl+Space followed by `?`.
  ** A popup titled "Tmux keybindings" opens inside tmux with the same list in `less`; `q` closes it.
  * Type `tmux kill-server` and press Enter to leave the desktop as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The desktop menu is 800 px wide and 40 % of the screen height; scroll with the wheel or arrow keys.
  * `?` is Shift+/; Ctrl+Space is `<C-SPACE>` (fallback prefix Ctrl+B).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Super+Alt+K menu with the PREFIX row, one filtered on `session`, one of the in-tmux popup.
  * If unsuccessful
  ** Screenshot of what Super+Alt+K produced.
covers: manual/15-terminal.md:15; default/hypr/bindings/utilities.lua:11; default/omarchy/omarchy-menu.jsonc:51; config/tmux/tmux.conf:8; bin/omarchy-menu-tmux-keybindings; test/shell.d/keybindings-menu-test.sh

### tmux-dev-layout-tdl   [VM-OK]
description: `tdl <agent>` builds the three-pane IDE layout (editor left, agent right, terminal bottom) and refuses to run without an argument or outside tmux — the layout the manual's screenshots show.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `tdl bash` + Enter. It must print `You must start tmux to use tdl.` and nothing else happens.
  * Type `mkdir -p /tmp/proj && cd /tmp/proj && t` + Enter (tmux starts, status bar `Work`), then `tdl` + Enter.
  ** Expected: `Usage: tdl <c|cx|codex|other_ai> [<second_ai>]`.
  * Type `tdl bash` + Enter. Within a few seconds the window shows three panes: Neovim on the directory (large, left), a bash prompt in a narrow right pane, a short bottom pane; the window name becomes `proj`.
  ** `bash` stands in for an AI agent; the geometry is identical and nothing is downloaded.
  ** If Neovim shows a plugin-install window on its first ever start, wait for it (network) and press `q`.
  ** Record whether any `can't find pane` text appears in the bottom pane and which pane has focus (the script's last step targets an undefined pane).
  * Click the bottom pane and type `tdl bash bash` + Enter. The right column must now be split into two agent panes.
  * Type `tmux kill-server` in any shell pane + Enter to close everything.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * tmux has `mouse on`; clicking a pane focuses it.
  * Neovim can be left with `:qa!` + Enter if its pane is needed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both refusals, the three-pane layout with Neovim left and window `proj`, and the split right column after `tdl bash bash`; a note on any `can't find pane` text.
  * If unsuccessful
  ** Screenshot of the terminal after `tdl bash`.
covers: manual/15-terminal.md:17-29; manual/20-shell-functions.md:19; default/bash/fns/tmux:3-38; default/bash/aliases:52-55

### tmux-swarm-tsl   [VM-OK]
description: `tsl <n> <command>` tiles n panes all running the command (the "swarm of agents" layout) and prints usage when an argument is missing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `mkdir -p /tmp/swarm && cd /tmp/swarm && t` + Enter. tmux starts (status bar `Work`).
  * Type `tsl 4` + Enter. Expected: `Usage: tsl <pane_count> <command>`.
  * Type `tsl 4 'echo swarm; bash'` + Enter.
  ** The window splits into a 2×2 grid; every pane shows `swarm` above a prompt; the window is named `swarm`.
  * Type `tmux kill-server` + Enter in any pane; the window closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The quoted command runs in each pane's shell; `bash` keeps the pane open for the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the usage line and of the 2×2 grid with `swarm` in all four panes.
  * If unsuccessful
  ** Screenshot of the terminal after `tsl 4 …`.
covers: manual/15-terminal.md:37-38; manual/20-shell-functions.md:22; default/bash/fns/tmux:98-124

### tmux-multi-project-tdlm   [VM-OK]
description: `tdlm <agent>` renames the session after the directory and opens one dev-layout window per subdirectory, switchable with Alt+1/2/3, and prints usage without an argument.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `mkdir -p /tmp/multi/a /tmp/multi/b /tmp/multi/c && cd /tmp/multi && t` + Enter (tmux starts).
  * Type `tdlm` + Enter. Expected: `Usage: tdlm <c|cx|codex|other_ai> [<second_ai>]`.
  * Type `tdlm bash` + Enter.
  ** The session name on the status bar becomes `multi`; three windows `a`, `b`, `c` appear, each with the tdl layout (Neovim left, bash right and bottom).
  * Press Alt+2, then Alt+3. The highlighted window in the status bar must follow.
  * Type `tmux kill-server` + Enter in a shell pane.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Windows are numbered from 1 (`base-index 1`), so Alt+1 is window `a`.
  * Neovim panes can be ignored; use a bash pane for typing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the usage line and of the status bar showing session `multi` with windows `a b c`, window 3 active.
  * If unsuccessful
  ** Screenshot of the terminal after `tdlm bash`.
covers: manual/15-terminal.md:33-35; manual/20-shell-functions.md:21; default/bash/fns/tmux:69-94; config/tmux/tmux.conf:39-47

### tmux-dev-square-tds   [VM-PARTIAL] [NET]
description: `tds` lays out the four-way square (Neovim, `hunk diff --watch`, terminal, opencode); in the guest the two agent-side panes only reach mise's first-run download, so the check is the geometry and the commands started.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `mkdir -p /tmp/sq && cd /tmp/sq && git init -q && t` + Enter (tmux starts).
  * Type `tds extra` + Enter. Expected: `Usage: tds`.
  * Type `tds` + Enter.
  ** Four quadrants: Neovim top-left, `hunk diff --watch` top-right (mise downloading `hunk`, then its watch view or "nothing to diff"), a prompt bottom-left, `opencode` bottom-right (mise download, then OpenCode's sign-in/provider screen or a credentials error).
  ** Allow up to 60 s per download; screenshot every ≤5 s.
  * Record what the two right-hand panes ended on.
  * Type `tmux kill-server` in the bottom-left pane + Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: hunk actually watching diffs and using OpenCode (no credentials). Only the layout and the started commands are checked.
  * `hunk` and `opencode` are not installed by default; the first run of each is a download.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Usage: tds` and of the four quadrants with Neovim top-left and download/TUI output on the right.
  * If unsuccessful
  ** Screenshot of the window after `tds`.
covers: manual/15-terminal.md:31; manual/20-shell-functions.md:20; default/bash/fns/tmux:42-65; install/user/mise.sh (hunk, opencode stubs)

### install-terminal-kitty-and-switch-default   [VM-OK] [NET]
description: Install → Terminal installs an alternative terminal (Kitty, ~15 MB) and repoints Super+Return at it; Setup → Defaults → Terminal switches back to Foot, restoring the stock state.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Space → Install → Terminal. Four rows: Alacritty, Foot (dim, ✓), Ghostty, Kitty. Select Kitty.
  ** A floating Omarchy terminal shows the logo, `Installing kitty...`, a sudo prompt (type `prime`), pacman output, then `● Done! Press any key to close...`. Press a key.
  * Press Super+Return. The new terminal must be Kitty (same Starship prompt, Kitty's own window class); `omarchy default terminal` + Enter → `kitty`.
  ** Kitty renders through software OpenGL; give it 10 s.
  * Type `omarchy default terminal bogus; echo exit=$?` + Enter → the usage line `<alacritty|foot|ghostty|kitty>` and `exit=1`.
  * Open Omarchy Menu → Setup → Defaults → Terminal. Kitty carries the ✓ (reopen the menu twice if it does not yet). Select Foot → notification "Foot is now the default terminal".
  * Press Super+Return: a Foot window opens again (`omarchy default terminal` → `foot`). Close all terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Kitty stays installed afterwards (no menu removal path exists); only the default is restored.
  * A network failure shows a red `Failed (exit code …)` line — screenshot it and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Install → Terminal with Foot dim/✓, the Done! line, Kitty open with `kitty` printed, the usage + `exit=1`, the "Foot is now the default terminal" notification, and Foot opening again.
  * If unsuccessful
  ** Screenshot of the failed install terminal.
covers: manual/15-terminal.md:5-7; default/omarchy/omarchy-menu.jsonc:160-164,239-242; bin/omarchy-install-terminal; bin/omarchy-default-terminal; config/kitty/kitty.conf; test/shell.d/kitty-config-test.sh

### editor-hotkey-opens-neovim   [VM-OK]
description: Super+Shift+N launches the default editor, Neovim, in its own terminal window — the manual's first way of starting the editor — and the classic `vi` is present too.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N. A terminal window running Neovim opens (LazyVim dashboard or an empty buffer with a status line).
  ** If a Lazy plugin-install window appears on first start, wait for it (network) and press `q`.
  * Press `i`, type `hello from omarchy`, press Escape. The text is in the buffer and `-- INSERT --` is gone.
  * Type `:q!` + Enter. The window closes.
  * Press Super+Return and type `omarchy default editor` + Enter → `nvim`; then `vi --version | head -1` + Enter → a vi/VIM banner line.
  * Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The editor window tiles like any terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Neovim after the hotkey, one with the typed text, and the terminal showing `nvim` and the vi banner.
  * If unsuccessful
  ** Screenshot of the desktop after Super+Shift+N.
covers: manual/16-neovim.md:36-38; manual/18-development-tools.md:7; default/hypr/bindings/applications.lua:8; bin/omarchy-launch-editor; bin/omarchy-default-editor; test/acceptance.d/apps-test.sh (neovim row)

### neovim-lazyvim-basics   [VM-OK]
description: The `n` alias and the LazyVim keys the manual teaches (Space e tree, `a` to add a file, Space Space finder, Shift+H/L, Space b d) work in the shipped omarchy-nvim config.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `mkdir -p /tmp/nv && cd /tmp/nv && echo one > one.txt && echo two > two.txt && n` + Enter. Neovim opens on the directory.
  ** If a plugin-install window appears on first start, wait for it (network) and press `q`.
  * Press Space and wait a second: a which-key popup listing leader commands appears. Escape.
  * Press Space then `e`; with the tree focused press `a`, type `three.txt`, Enter.
  ** The file tree shows on the left with `one.txt`, `two.txt`, and now `three.txt`.
  * Press Ctrl+W then `w`, then Space Space, type `two`, Enter. `two.txt` opens showing `two`.
  * Press Space Space, type `one`, Enter; then Shift+H and Shift+L. The active buffer tab moves between `one.txt` and `two.txt`.
  * Press Space, `b`, `d`: one buffer tab disappears. Type `:qa!` + Enter, then `n one.txt` + Enter: Neovim opens with `one`; `:q!` + Enter and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send Space as `<SPACE>`; keys are lowercase unless stated.
  * If the tree is not focused when pressing `a`, click inside it first.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the which-key popup, the tree with `three.txt`, the buffer tabs after Shift+H/L, and `n one.txt` showing `one`.
  * If unsuccessful
  ** Screenshot of the state where a key did nothing or errored.
covers: manual/16-neovim.md:13-38; manual/19-shell-tools.md:11,25; default/bash/aliases:57

### neovim-sudoedit   [VM-OK]
description: `sudoedit` opens root-only files in the user's Neovim (via SUDO_EDITOR) after a password prompt, and a wrong password is refused first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `echo $SUDO_EDITOR` + Enter → `omarchy-launch-editor --inline`.
  * Type `sudoedit /etc/hosts` + Enter. At `[sudo] password for prime:` type `wrong` + Enter → `Sorry, try again.`; then `prime` + Enter.
  ** Neovim opens a temporary copy (status line shows a `/var/tmp/hosts…` path) with the hosts contents.
  * Type `:q!` + Enter. Back at the prompt `sudoedit: /etc/hosts unchanged` is printed.
  * Type `sudo -k` + Enter (drop the cached credential) and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Stay under three wrong passwords; faillock is shared with the lock screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Sorry, try again.`, Neovim on the temporary hosts copy, and the `unchanged` message.
  * If unsuccessful
  ** Screenshot of the terminal after `sudoedit` (e.g. an "editor not found" message).
covers: manual/16-neovim.md:40-42; default/bash/envs:2-3; bin/omarchy-launch-editor (`--inline`); test/shell.d/editor-env-test.sh

### agent-hotkey-picker-when-unset   [VM-OK]
description: With no default agent chosen (the stock state), the agent hotkey opens the picker instead of failing silently, and the CLI explains what to do and rejects nonsense.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Ctrl+A. The Omarchy Menu opens directly on the "Default Agent" list (Antigravity, Claude, Codex, Copilot, Crush, Cursor CLI, Grok, Hermes, Muse Code, omp, OpenClaw, OpenCode, Ori, Pi) with no ✓ on any row. Press Escape without choosing.
  * Press Super+Return. Type `omarchy default agent` + Enter → prints nothing.
  * Type `omarchy agent; echo exit=$?` + Enter → `Choose default agent with: omarchy default agent <name>` and `exit=1`. Type `a` + Enter → the same message.
  * Type `omarchy agent hello` + Enter → `Unexpected argument: hello` and the hint `To pass a prompt: omarchy agent prompt "hello"`.
  * Type `omarchy default agent bogus; echo exit=$?` + Enter → the usage line `<pi|omp|opencode|ori|claude|codex|…>` and `exit=1`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A "Set your default agent" notification may still be on screen from first boot; dismiss it with Super+comma.
  * Nothing here downloads anything; do not select an agent in the picker.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Default Agent menu with no ✓ and of the terminal with each message and exit code.
  * If unsuccessful
  ** Screenshot of what the hotkey did instead.
covers: manual/17-ai.md:24-35; default/hypr/bindings/utilities.lua:97; bin/omarchy-agent; bin/omarchy-default-agent; default/bash/aliases:46; install/user/first-run/setup-agent.hook; test/shell.d/default-agent-test.sh

### agents-panel-hidden-without-usage   [VM-OK]
description: The top bar shows no agents icon until AI usage exists on the machine, and the usage refresh command runs quietly on a machine without any — the absence path of the agents panel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the right section of the top bar and screenshot it. There must be no agents (robot) icon among the network / audio / display icons.
  * Press Super+Return and type `omarchy agent usage-update; echo exit=$?` + Enter → no error text, `exit=0`.
  * Screenshot the bar again: still no agents icon.
  * Type `omarchy agent prompt; echo exit=$?` + Enter → a usage line for `omarchy agent prompt [--inline] <prompt...>`, `exit=1`, and nothing launched. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar's right section on this VM holds network, audio and display icons only; count them on the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two bar screenshots without an agents icon and the terminal with `exit=0` / the prompt usage.
  * If unsuccessful
  ** Screenshot of an agents icon that appeared, or of an error from `usage-update`.
covers: manual/17-ai.md:38-41; bin/omarchy-agent-usage-update; bin/omarchy-agent-prompt; test/shell.d/agents-panel-test.sh

### default-agent-pick-installs-pi   [VM-PARTIAL] [NET]
description: Picking an agent under Setup → Defaults → Agent installs it through mise, makes it the default so the hotkey launches it, and the choice can be cleared again; signing in is out of reach in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Setup → Defaults → Agent → Pi.
  ** A floating terminal shows mise installing `pi` (~30 MB, up to 90 s), then clears and Pi's own TUI starts (provider/API-key prompt or chat input). Screenshot it, then press Ctrl+C (twice if needed); the terminal closes.
  * Open Omarchy Menu → Setup → Defaults → Agent (twice if needed): the Pi row now carries a ✓. Escape.
  * Press Super+Shift+Ctrl+A. A new terminal window running Pi opens directly (no picker). Press Ctrl+C and close it.
  * Press Super+Return, type `omarchy default agent` + Enter → `pi`.
  * Type `rm ~/.config/omarchy/defaults/agent && omarchy default agent` + Enter → prints nothing (stock state restored). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: authenticating Pi and running a prompt.
  * A failed install prints `Could not install Pi with mise` and a red Failed line — screenshot it and stop.
  * Pi stays installed under mise afterwards; only the default is cleared.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of mise installing, Pi's first screen, the ✓ on Pi, the agent window opened by the hotkey, `pi` from the CLI, and the cleared default.
  * If unsuccessful
  ** Screenshot of the failed floating terminal.
covers: manual/17-ai.md:26,33; default/omarchy/omarchy-menu.jsonc:151; bin/omarchy-default-agent; bin/omarchy-agent:16-20,128-131; test/shell.d/default-agent-test.sh

### mise-stub-wrapper-install   [VM-OK] [NET]
description: `omarchy mise install <package> [command]` writes a lazy stub into ~/.local/bin that downloads on first use, and refuses command names that would escape the bin directory.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `omarchy mise install jq ../evil; echo exit=$?` + Enter → `omarchy-mise-install: '../evil' is not usable as a command name`, `exit=1`.
  * Type `omarchy mise install jq jqx && cat ~/.local/bin/jqx` + Enter → a 4-line script containing `mise use -g --quiet "jq"` and `exec mise x "jq" -- "jq" "$@"`.
  * Type `jqx --version` + Enter. mise downloads jq (a few MB, up to 30 s), then prints `jq-1.x`.
  * Type `ls ~/.local/bin | tr '\n' ' '` + Enter: the preinstalled stubs `claude codex opencode pi gh copilot crush agy grok ghui hunk omp ori` are among the names.
  * Type `rm ~/.local/bin/jqx; mise unuse -g jq` + Enter to clean up, then close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy mise install` with no arguments shows the router's usage block, not the script's; either is fine if the driver tries it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the rejection with `exit=1`, the stub contents, `jq-1.x`, and the stub listing.
  * If unsuccessful
  ** Screenshot of the failing command.
covers: manual/17-ai.md:3-22; bin/omarchy-mise-install; install/user/mise.sh; test/shell.d/mise-install-test.sh

### crash-mute-cli   [VM-OK]
description: `omarchy crash mute` lists, sets, clears and toggles per-program crash-notification mutes and rejects a bad action, as the AI chapter documents.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `omarchy version; omarchy crash mute` + Enter → the version and `No programs muted. Crashes all notify.`
  ** If the answer is `Unknown Omarchy command`, this build predates crash mute: screenshot and report "absent on this build", then stop.
  * Type `omarchy crash mute sleep; omarchy crash mute /usr/bin/cat` + Enter → `Muted crash notifications for sleep.` and `Muted crash notifications for cat.` (the path is reduced to its name).
  * Type `omarchy crash mute` + Enter → two lines: `cat` and `sleep`.
  * Type `omarchy crash mute sleep off; omarchy crash mute cat toggle` + Enter → `Crash notifications for sleep are back on.` and `… for cat are back on.`
  * Type `omarchy crash mute cat bogus; echo exit=$?` + Enter → `Not an action: bogus`, the usage line, `exit=1`; then `omarchy crash mute` + Enter → `No programs muted. Crashes all notify.` Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output is plain terminal text; no notifications are involved.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing each exact message and the final empty list.
  * If unsuccessful
  ** Screenshot of the deviating output (or the "Unknown Omarchy command" version-skew case).
covers: manual/17-ai.md:49; bin/omarchy-crash-mute; bin/omarchy-toggle

### crash-capture-notification-and-toggle   [VM-PARTIAL]
description: With a default agent recorded, a segfaulting process produces a "Process crashed" notification; Trigger → Toggle → Crash Capture switches the watcher off and on with a notification each way. Handing the crash to an agent is not exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` + Enter.
  ** The watcher stays silent until a default agent name is recorded; this only writes the name, it installs nothing.
  * Type `sleep 300 & sleep 1; kill -SEGV $!` + Enter. Within ~10 s a notification titled "Process crashed" mentioning `sleep` appears. Do not click it.
  * Type `omarchy agent crash abc; echo exit=$?` + Enter → `Not a PID: abc`, the usage hint mentioning `coredumpctl list`, `exit=1`.
  * Open Omarchy Menu (Super+Space) → Trigger → Toggle → Crash Capture → notification "Crash capture disabled". Repeat the `sleep … kill -SEGV` line: no "Process crashed" notification within 10 s.
  * Open Omarchy Menu → Trigger → Toggle → Crash Capture → notification "Crash capture enabled".
  * Type `rm ~/.config/omarchy/defaults/agent` + Enter to restore the stock state and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: clicking the notification (it would try to launch Claude, which is not installed).
  * `Segmentation fault (core dumped)` in the terminal is the shell reporting the job; the notification is separate. Dismiss notifications with Super+comma between steps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Process crashed" notification, the `Not a PID` lines, both toggle notifications, and the desktop ~10 s after the second kill with no crash notification.
  * If unsuccessful
  ** Screenshot of the terminal and desktop after the first kill.
covers: manual/17-ai.md:43-47; default/omarchy/omarchy-menu.jsonc:92; bin/omarchy-toggle-crash-capture; bin/omarchy-agent-crash:14-19; bin/omarchy-crash-watch:69; test/shell.d/crash-capture-test.sh

### install-ai-ollama-local-llm   [VM-PARTIAL] [NET]
description: Install → AI → Ollama installs the CPU Ollama package (no GPU detected) and leaves a working `ollama` CLI, and Remove → AI takes it away again; pulling a model is out of budget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → AI. Rows: ChatGPT Desktop, Claude Desktop, Dictation, Grok Bot, Hermes Desktop, LM Studio, Ollama, OpenClaw, Perplexity, T3 Code — none dim. Select Ollama.
  ** Floating terminal: `Installing Ollama...`, sudo prompt (`prime`), pacman installs `ollama` (large; allow up to 4 min), `● Done!`. Press a key.
  * Press Super+Return, type `ollama --version` + Enter → a version line (a warning that the server is not running is fine).
  * Open Omarchy Menu → Install → AI (twice if needed): Ollama is dim with ✓; Remove → AI now lists Ollama.
  * Remove → AI → Ollama → sudo → `Ollama and its models have been removed.` → Done!, press a key.
  * In the terminal `ollama --version` + Enter → `command not found`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: `ollama pull` / running a model (CPU only, too large).
  * A pacman download failure shows a red Failed line — screenshot and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Install → AI list, the Done! line, `ollama --version`, the dim ✓ row, the removal message and the final `command not found`.
  * If unsuccessful
  ** Screenshot of the failed terminal.
covers: manual/17-ai.md:59-61; default/omarchy/omarchy-menu.jsonc:243-252,317; bin/omarchy-install-app; bin/omarchy-remove-ai-ollama; test/shell.d/remove-ai-test.sh

### omarchy-skill-symlinks-present   [VM-OK]
description: The Omarchy and diagnose-crash agent skills are symlinked into every harness skill directory the AI chapter lists, so any agent installed later finds them without setup.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `for d in ~/.agents/skills ~/.claude/skills ~/.codex/skills ~/.pi/agent/skills ~/.gemini/config/skills ~/.hermes/skills; do echo "== $d"; ls -l "$d" 2>&1; done | sudo tee /dev/ttyS0` + Enter (password `prime`), then read the serial log.
  ** Each directory lists symlinks `omarchy` and `diagnose-crash` pointing at `…/omarchy/default/agents/skills/<name>`.
  * Type `head -5 ~/.claude/skills/omarchy/SKILL.md` + Enter → the skill's front matter (proves the link resolves).
  * Type `ls ~/.hermes/profiles 2>&1` + Enter → missing is fine (profiles are linked only when they exist); report what is there. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The listing is longer than one screen; use get-serial for it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text with all six directories listing both symlinks and a screenshot of the SKILL.md head.
  * If unsuccessful
  ** The serial text showing the missing directory or dangling link.
covers: manual/17-ai.md:63-67; docs/file-layout.md:211; bin/omarchy-provision-user (skill linking); bin/omarchy-agent-crash:24

### install-editor-vim-and-set-default   [VM-OK] [NET]
description: Install → Editor installs an alternative editor (Vim, ~10 MB), Setup → Defaults → Editor makes it the target of Super+Shift+N with a confirmation notification, and Neovim can be restored as the default.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Editor. Rows: VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs, none dim. Select Vim.
  ** Floating terminal: `Installing Vim...`, sudo prompt (`prime`), pacman, `● Done!`. Press a key.
  * Open Omarchy Menu → Setup → Defaults → Editor. Neovim carries the ✓. Select Vim → notification "Vim is now the default editor".
  * Press Super+Shift+N. The window that opens is Vim (the `VIM - Vi IMproved` splash, no LazyVim dashboard). Type `:q` + Enter.
  * Press Super+Return, type `omarchy default editor bogus; echo exit=$?` + Enter → the usage line `<code|cursor|zed|sublime_text|helix|vim|emacs|nvim>`, `exit=1`.
  * Type `omarchy default editor nvim` + Enter → notification "Neovim is now the default editor"; press Super+Shift+N → Neovim opens again; `:q!` + Enter. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Reopen the menu twice before asserting a ✓ moved. Vim stays installed (no menu removal path); only the default is restored.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Done! line, the "Vim is now the default editor" notification, Vim's splash after the hotkey, the usage + `exit=1`, and Neovim restored.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: manual/18-development-tools.md:5-11; default/omarchy/omarchy-menu.jsonc:165-173,232-238; bin/omarchy-default-editor; bin/omarchy-install-app; bin/omarchy-launch-editor; test/shell.d/default-apps-test.sh

### install-dev-env-go   [VM-OK] [NET]
description: Install → Development provisions a language through mise (Go, ~70 MB) so it is on PATH in a new shell, then shows it as installed and removable; Node.js already reads as installed, and an unknown language is (wrongly) accepted silently.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Development → JavaScript. Node.js must be dim with ✓ (preinstalled); Bun and Deno selectable. Go back one level (Backspace) and select Go.
  ** Floating terminal: `Installing Go...`, mise downloading `go@latest` (allow 2 min), `● Done!`. Press a key.
  * Press Super+Return (a fresh shell), type `go version` + Enter → `go version go1.x linux/amd64`.
  * Type `omarchy install dev-env cobol; echo exit=$?` + Enter.
  ** Known defect: prints nothing and `exit=0` (no default case). Record it; a usage line would mean it was fixed.
  * Open Omarchy Menu → Install → Development (twice if needed): Go is dim ✓; Remove → Development lists Go. Select it → Done!, press a key.
  * Open a new terminal (Super+Return): `go version` + Enter → `command not found`. Close the terminals.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use a new terminal after install/remove so mise shims are re-evaluated.
  * mise reports progress as `mise go@1.x.y ✓ installed`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Node.js dim ✓, the Go install Done!, `go version`, the silent `exit=0`, Go dim under Install and listed under Remove, and the post-removal `command not found`.
  * If unsuccessful
  ** Screenshot of the failed terminal.
covers: manual/18-development-tools.md:13-19; default/omarchy/omarchy-menu.jsonc:263-284,330-350; bin/omarchy-install-dev-env; install/user/mise-work.sh; test/shell.d/dev-env-path-test.sh

### docker-requires-sudo-by-default   [VM-OK]
description: The install user is deliberately not in the docker group: plain `docker` (and the `d` alias) is refused while `sudo docker` works — the security posture the Development chapter describes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `id -nG` + Enter: the group list does not contain `docker`.
  * Type `docker ps` + Enter → a `permission denied while trying to connect to the docker API` error (not a hang). Type `d ps` + Enter → the same error.
  * Type `sudo docker ps` + Enter, password `prime` → a `CONTAINER ID   IMAGE …` header with no rows.
  ** `docker.socket` is socket-activated; the first call may take a few seconds.
  * Type `sudo docker compose version` + Enter → `Docker Compose version v2.x`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The sudo credential is cached for a few minutes; a second prompt may not appear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the groups line, both permission errors, the empty container table and the compose version.
  * If unsuccessful
  ** Screenshot of the deviating output.
covers: manual/18-development-tools.md:23-27; install/config/docker.sh; bin/omarchy-sudo-docker; default/bash/aliases:50; test/shell.d/sudo-docker-test.sh; test/shell.d/sudoless-docker-posture-test.sh

### lazydocker-polkit-prompt   [VM-OK]
description: Super+Shift+D opens the Docker TUI behind a polkit authorization prompt; cancelling leaves nothing open, authorizing shows lazydocker, and the Docker launcher entry does the same.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+D. A terminal opens and a graphical authentication dialog (polkit, from the Omarchy shell) asks for the password to run lazydocker.
  * Click Cancel (or press Escape). The dialog and the terminal both close; no lazydocker appears.
  * Press Super+Shift+D again, type `prime` in the dialog and confirm. lazydocker renders: Project / Containers / Images / Volumes / Networks panels on the left, logs on the right.
  * Press `?` (help overlay appears), Escape, then `q`. The window closes.
  * Open Omarchy Menu (Super+Space), type `Docker`, select the Docker app row: the same prompt → lazydocker flow in a tiled window. Authorize, then `q`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The polkit dialog is a small centred window; screenshot it before typing.
  * `Error: Cannot connect to the Docker daemon` inside lazydocker would be a real failure — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, the empty desktop after Cancel, lazydocker's main screen, its `?` overlay, and the launcher-path window.
  * If unsuccessful
  ** Screenshot of what appeared after the hotkey.
covers: manual/18-development-tools.md:25-27; manual/21-tuis.md:11-17; default/hypr/bindings/applications.lua:16; bin/omarchy-launch-docker-tui; applications/Docker.desktop; test/shell.d/polkit-test.sh

### sudoless-docker-opt-in-and-revert   [VM-OK]
description: Setup → Security → Sudoless Docker warns that the docker group is root-equivalent, requires confirmation, adds the user and announces a reboot is needed; declining changes nothing, and Remove → Security → Sudoless Docker undoes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Setup → Security → Sudoless Docker.
  ** Floating terminal with the `⚠️  WARNING` text (`docker run -v /:/host …`) and `Enable sudoless Docker? …`. Choose No → `Aborted. No changes made. Docker access still goes through a prompt.` → Done!, press a key.
  * Repeat and choose Yes (sudo password `prime` if asked) → `Sudoless Docker ENABLED. It takes effect after a reboot.` then `Reboot now to apply?` — choose **No**. Press a key.
  * Press Super+Return, type `getent group docker` + Enter → the line ends with `prime`.
  * Open Omarchy Menu (twice if needed) → Setup → Security: Sudoless Docker is gone; Remove → Security lists it. Select it, confirm, Done!, press a key.
  * `getent group docker` + Enter → `prime` is no longer listed; Setup → Security shows Sudoless Docker again. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never reboot. gum confirm buttons: Tab/arrows + Enter, or click.
  * The "reboot required" state may linger in later `omarchy update` runs on this disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the warning, the Aborted line, the ENABLED line with the reboot question, `getent group docker` with `prime`, the Remove → Security row, and the restored state.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: manual/18-development-tools.md:25; default/omarchy/omarchy-menu.jsonc:186,302; bin/omarchy-setup-security-sudoless-docker; bin/omarchy-remove-security-sudoless-docker; bin/omarchy-sudo-docker; test/shell.d/sudoless-docker-toggle-test.sh

### docker-db-redis   [VM-OK] [NET]
description: Install → Development → Docker DB starts a chosen database container (Redis, ~40 MB image) bound to localhost with sudo, and cancelling the chooser installs nothing (though it prints a stray error).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Development → Docker DB. A floating terminal shows `Select database (return to install, esc to cancel)` with MySQL, PostgreSQL, Redis, MongoDB, MariaDB, MSSQL.
  * Press Escape.
  ** Known defect: `main_menu: command not found` then `No databases selected for installation.`; record it. Press a key at Done!/Failed.
  * Repeat and pick Redis (arrows + Enter) → `Installing Redis...`, sudo (`prime`), image pull (20–60 s), a container id, Done!. Press a key.
  * Press Super+Return, `sudo docker ps --format '{{.Names}} {{.Ports}}'` + Enter → `redis 127.0.0.1:6379->6379/tcp`; `sudo docker exec redis redis-cli ping` + Enter → `PONG`.
  * Type `sudo docker rm -f redis` + Enter to clean up and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the pull every ≤5 s; progress bars redraw in place.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the chooser, the Escape output, the pull, the `redis 127.0.0.1:6379` line and `PONG`.
  * If unsuccessful
  ** Screenshot of the failed terminal.
covers: manual/18-development-tools.md:29; default/omarchy/omarchy-menu.jsonc:264; bin/omarchy-install-docker-dbs

### github-cli-lazy-install   [VM-OK] [NET]
description: The first `gh` invocation installs the GitHub CLI through its mise stub and then behaves like gh (help, version, a clear authentication error), as the Development chapter promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `cat ~/.local/bin/gh` + Enter → the 4-line mise stub for `"gh"`.
  * Type `gh --version` + Enter. mise downloads gh (~20 MB), then `gh version 2.x`.
  * Type `gh` + Enter → gh's top-level help (`Work seamlessly with GitHub from the command line.`).
  * Type `gh repo clone nonexistent-org-omarchy-test/nonexistent; echo exit=$?` + Enter → an authentication-required (`gh auth login`) or not-found error, non-zero exit, no hang.
  * Type `gh auth status` + Enter → `You are not logged into any GitHub hosts.` Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `gh auth login`; the device flow cannot be completed from the guest.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the stub, the download + version, the help, the clone error and the auth status.
  * If unsuccessful
  ** Screenshot of the failing command.
covers: manual/18-development-tools.md:31-37; install/user/mise.sh:9; bin/omarchy-mise-install

### fzf-ff-and-history-search   [VM-OK]
description: `ff` opens fzf with a bat preview of the highlighted file and Ctrl+R searches command history through fzf, both cancelling cleanly with Escape.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/fz && cd /tmp/fz && printf 'def hello\n  puts 1\nend\n' > a.rb && echo plain > b.txt` + Enter.
  * Type `ff` + Enter. fzf lists `a.rb` and `b.txt` with a preview pane on the right showing the highlighted file with line numbers; move to `a.rb` → `def hello` syntax-coloured.
  * Press Escape → back at the prompt, nothing else happened. Type `ff` + Enter, select `b.txt` with Enter → `b.txt` is printed.
  * Type `echo unique-history-marker-42` + Enter, then press Ctrl+R and type `marker-42`. The fzf history list shows the echo command; Enter places it on the prompt.
  * Type `man fzf` + Enter → the page renders in colour (bat pager); `q`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fzf's prompt is `>` bottom-left; the preview pane occupies the right half.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the ff view with the bat preview of `a.rb`, the Ctrl+R list with the marker command, and the coloured man page.
  * If unsuccessful
  ** Screenshot of the terminal after `ff` (e.g. unstyled preview or `bat: command not found`).
covers: manual/19-shell-tools.md:5-13,41-45; default/bash/aliases:9-13; default/bash/init:21-28; default/bash/envs:9-13

### zoxide-cd-jump-and-miss   [VM-OK]
description: `cd` goes through zoxide so a previously visited directory is reachable by a fragment of its name, while an unknown target gives a clear error and stays put.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `type cd` + Enter → `cd is aliased to 'zd'`.
  * Type `cd ~/.config/omarchy && cd && pwd` + Enter → `/home/prime` (the first cd teaches zoxide).
  * Type `cd oma && pwd` + Enter → a jump marker line (icon + `/home/prime/.config/omarchy`) and the same path from `pwd`.
  * Type `cd no-such-directory-xyz; echo exit=$?; pwd` + Enter → `Error: Directory not found`, `exit=1`, still `/home/prime/.config/omarchy`.
  * Type `cd .. && pwd` + Enter → `/home/prime/.config`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The jump marker is a Nerd-Font glyph followed by the path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the alias line, the jump after `cd oma`, and the `Error: Directory not found` with unchanged pwd.
  * If unsuccessful
  ** Screenshot of the deviating output.
covers: manual/19-shell-tools.md:15-19; default/bash/aliases:17-34,41-43; default/bash/init:9-11

### eza-listing-aliases   [VM-OK]
description: `ls`, `lsa`, `lt` and `lta` are the eza variants the manual describes (icons, long format, directories first, two-level tree, hidden files).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/ez/sub/deep && cd /tmp/ez && touch .hidden sub/file sub/deep/leaf visible` + Enter.
  * Type `ls` + Enter → a long listing with icons, `sub` before `visible`, no `.hidden`. Type `lsa` + Enter → `.hidden` now included.
  * Type `lt` + Enter → a two-level tree: `sub` → `deep`, `file`; `leaf` is NOT shown.
  * Type `lta` + Enter → the tree including `.hidden`.
  * Type `type ls` + Enter → `ls is aliased to 'eza -lh --group-directories-first --icons=auto'`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Icons come from the Nerd Font; boxes instead of icons are worth reporting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each listing and the `type ls` line.
  * If unsuccessful
  ** Screenshot of the deviating listing (e.g. GNU ls output).
covers: manual/19-shell-tools.md:29-33; default/bash/aliases:2-7

### ripgrep-fd-bat-tools   [VM-OK]
description: rg, fd and bat search and show files as the manual describes, including their failure modes (no match, missing file).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/rt/app && cd /tmp/rt && echo 'class UsersController' > app/users_controller.rb && echo x > person.rb` + Enter.
  * Type `rg Controller app/; rg Nothing app/; echo exit=$?` + Enter → `app/users_controller.rb` with the highlighted line, then `exit=1` for the miss.
  * Type `fd person.rb; fd missing.rb; echo exit=$?` + Enter → `person.rb`, then nothing and `exit=0` (fd treats no match as success).
  * Type `bat person.rb; bat nope.rb` + Enter → a framed view with header and line `1`, then `[bat error]: 'nope.rb': No such file or directory`.
  * Type `man rg` + Enter → coloured page; `q`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All three tools are base packages; `command not found` is a real failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the rg hit and `exit=1`, the fd results, the bat frame and error line.
  * If unsuccessful
  ** Screenshot of the deviating output.
covers: manual/19-shell-tools.md:21-45; install/omarchy-base.packages (ripgrep, fd, bat)

### tldr-first-run   [VM-OK] [NET]
description: `tldr <cmd>` fetches its page cache on first run and shows concise examples, and an unknown command gets a not-found message instead of a crash.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `tldr tar` + Enter.
  ** First run may print that it is downloading/updating the cache (allow 30 s), then a short list of `tar` examples such as `tar cf path/to/target.tar …`.
  * Type `tldr tar` + Enter again → the same examples immediately (cached).
  * Type `tldr no-such-command-xyz; echo exit=$?` + Enter → a "page not found" style message and a non-zero exit. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the cache download fails on the network, screenshot the error; that is the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the tar examples and of the not-found message with its exit code.
  * If unsuccessful
  ** Screenshot of the failing command.
covers: manual/19-shell-tools.md:47-49; install/omarchy-base.packages (tldr)

### yt-dlp-rejects-bad-url   [VM-OK]
description: yt-dlp is present with its default download folder in place and rejects a non-URL cleanly; a real download is left to the browser extension test.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `yt-dlp --version` + Enter → a date-style version such as `2026.xx.xx`.
  * Type `yt-dlp not-a-url; echo exit=$?` + Enter → `ERROR: … is not a valid URL` and `exit=1`.
  * Type `echo ${OMARCHY_YTDLP_DIR:-unset}; ls -d ~/Videos` + Enter → `unset` and `/home/prime/Videos` (the extension's default download folder). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No network is needed for these steps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the version line, the invalid-URL error with `exit=1`, and the Videos folder line.
  * If unsuccessful
  ** Screenshot of the failing command.
covers: manual/19-shell-tools.md:51-55; install/omarchy-base.packages (yt-dlp); bin/omarchy-chromium-ytdlp-host:18

### try-experiment-directories   [VM-OK]
description: `try` is wired to `~/Work/tries` (created at provision) and creates date-stamped experiment directories, as the shell-tools chapter says.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `ls -d ~/Work ~/Work/tries; type try | head -1` + Enter → both paths exist and `try is a function`.
  * Type `try omarchy-probe` + Enter (confirm with Enter if asked). try creates and switches into a new directory.
  ** `pwd` + Enter shows `/home/prime/Work/tries/<date>-omarchy-probe`.
  * Type `try` + Enter with no argument: try's picker lists the directory just created; press Escape or `q`.
  * Type `rm -rf ~/Work/tries/*omarchy-probe*` + Enter to clean up and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first call replaces the lazy wrapper with try's real shell integration; a second `type try` shows a longer function — fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `ls -d` line, the `pwd` inside the dated directory, and the picker.
  * If unsuccessful
  ** Screenshot of the failing command.
covers: manual/19-shell-tools.md:57-59; default/bash/init:13-19; install/user/mise-work.sh:2-3

### compress-decompress-roundtrip   [VM-OK]
description: `compress` and `decompress` wrap tar so a directory round-trips through a `.tar.gz`, and misuse fails loudly rather than writing a nameless archive.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/cz/data && cd /tmp/cz && echo payload > data/file.txt && compress data/ && ls` + Enter → `data.tar.gz` beside `data` (the trailing slash is stripped).
  * Type `rm -r data && decompress data.tar.gz && cat data/file.txt` + Enter → `payload`.
  * Type `compress; echo exit=$?; ls` + Enter → a tar error (`Cowardly refusing to create an empty archive` or `Cannot stat`), non-zero exit, no stray `.tar.gz`.
  * Type `decompress missing.tar.gz` + Enter → `tar: missing.tar.gz: Cannot open: No such file or directory`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `compress` is a function, `decompress` an alias; `type compress decompress` shows both.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the listing with `data.tar.gz`, `payload` after decompress, and both error lines.
  * If unsuccessful
  ** Screenshot of the deviating output.
covers: manual/20-shell-functions.md:5-8; default/bash/fns/compression

### drive-helpers-safe-paths   [VM-OK]
description: `iso2sd` and `format-drive` show usage and the available-drive list when called incorrectly and never touch a disk; the guest's single virtio disk means only these safe paths are exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `iso2sd` + Enter → `Usage: iso2sd <input_file> [output_device]` and an `Example:` line.
  * Type `touch /tmp/fake.iso && iso2sd /tmp/fake.iso` + Enter → `No SD drives found and no drive specified`; no sudo prompt appears.
  * Type `format-drive` + Enter → `Usage: format-drive <device> <name>`, an example, then `Available drives:` with `/dev/vda` (and possibly `/dev/zram0`).
  * Type `format-drive /dev/null Probe` + Enter → `WARNING: This will completely erase all data on /dev/null …` and `Are you sure you want to continue? (y/N):` — type `n` + Enter. The prompt returns with no further output.
  * Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * NEVER answer `y`. `/dev/null` only reaches the confirmation safely; declining runs nothing.
  * If a `/dev/sd*` device unexpectedly exists, press Escape in the iso2sd picker and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both usage outputs, the "No SD drives found" line, the drive list with `/dev/vda`, and the declined confirmation.
  * If unsuccessful
  ** Screenshot of any sudo/dd/parted activity (a serious failure).
covers: manual/20-shell-functions.md:10-14; default/bash/fns/drives

### git-worktree-ga-gd   [VM-OK]
description: `ga <branch>` creates a sibling worktree `<repo>--<branch>` on a new branch and cds into it, `gd` asks before removing it and refuses to act outside a worktree, and `ga` without a branch prints usage.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/wt/repo && cd /tmp/wt/repo && git init -q && git config user.email t@e.st && git config user.name T && git commit -q --allow-empty -m init && ga` + Enter → `Usage: ga [branch name]`.
  * Type `ga feature && pwd && git branch --show-current` + Enter → `Preparing worktree (new branch 'feature')`, `/tmp/wt/repo--feature`, `feature`.
  * Type `gd` + Enter → `Remove worktree and branch?`; choose No; `pwd` still `/tmp/wt/repo--feature`.
  * Type `gd` + Enter → choose Yes → `Deleted branch feature …`; `pwd; ls /tmp/wt` + Enter → `/tmp/wt/repo` and only `repo`.
  * Type `cd /tmp/wt && gd` + Enter → Yes: the directory has no `--`, so nothing is removed and `ls` still shows `repo`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `mise trust` inside `ga` may print a trust line — fine.
  * The repo-local identity avoids a "please tell me who you are" failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage, the worktree creation with `pwd`, the confirm dialog, the deletion with `pwd` back in `repo`, and the no-op outside a worktree.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: manual/20-shell-functions.md:26-29; default/bash/fns/worktrees

### rsync-watchers   [VM-OK]
description: `rsw` starts a background rsync-on-change watcher (usable locally), `lsw` lists it and `dsw` stops it, with usage errors on bad arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `lsw; dsw; rsw /tmp/only-one` + Enter → `No active watches` twice and `Usage: rsw <source> <destination>`.
  * Type `mkdir -p /tmp/rs/src /tmp/rs/dst && echo a > /tmp/rs/src/a.txt && rsw /tmp/rs/src /tmp/rs/dst` + Enter → `Watching /tmp/rs/src -> /tmp/rs/dst`.
  * Type `sleep 2; echo b > /tmp/rs/src/b.txt; sleep 3; ls /tmp/rs/dst` + Enter → `a.txt b.txt` (initial sync plus the change).
  * Type `lsw` + Enter → one line `<pid>: /tmp/rs/src -> /tmp/rs/dst`.
  * Type `dsw; lsw` + Enter → `Stopped watch (pid <pid>)` then `No active watches`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The watcher uses inotifywait; give each sync a couple of seconds.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage lines, the Watching line, the synced listing, the lsw line and the Stopped line.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: manual/20-shell-functions.md:31-35; default/bash/fns/rsyncing

### ssh-port-forward-helpers   [VM-OK]
description: `fip`, `dip` and `lip` report usage and no-forward states cleanly with no remote host, so a typo gives a message instead of a hung ssh.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `lip; fip; fip somehost; dip` + Enter → `No active forwards`, `Usage: fip <host> <port1> [port2] ...` (twice), `Usage: dip <port1> [port2] ...`.
  * Type `dip 3000` + Enter → `No forwarding on port 3000`.
  * Type `fip 127.0.0.1 3000; lip` + Enter → `ssh: connect to host 127.0.0.1 port 22: Connection refused`, no `Forwarding` line, then `No active forwards`.
  ** If sshd was enabled earlier in this session, a password prompt appears instead: press Ctrl+C and note it.
  * Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No sshd runs on a stock disk; the refusal is immediate.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each message.
  * If unsuccessful
  ** Screenshot of the deviating output.
covers: manual/20-shell-functions.md:37-45; default/bash/fns/ssh-port-forwarding

### ssh-wrapper-no-retry-on-refused   [VM-OK]
description: The `ssh` shell wrapper passes a fast connection failure straight through (no reconnect loop) and leaves the terminal usable, so a wrong host does not trap the user in "Reconnecting…".
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `type ssh | head -1` + Enter → `ssh is a function`.
  * Type `ssh -o ConnectTimeout=3 127.0.0.1; echo exit=$?` + Enter → `Connection refused`, `exit=255`, prompt back at once, no `Connection lost. Reconnecting` line.
  * Type `ssh -o ConnectTimeout=3 127.0.0.1 true; echo exit=$?` + Enter → the same refusal and `exit=255`, no retry.
  * Move the mouse across the terminal and type `echo still fine` + Enter → echoes normally, no escape junk. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reconnect loop only triggers for interactive sessions that lived 30 s and exited 255; only the pass-through can be shown here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the function line, both refusals with `exit=255` and no Reconnecting text, and the clean echo.
  * If unsuccessful
  ** Screenshot of a `Reconnecting` loop (Ctrl+C to stop it) or a garbled prompt.
covers: manual/20-shell-functions.md:47-49; default/bash/fns/ssh-reconnect; test/shell.d/ssh-reconnect-test.sh

### lazygit-stage-and-commit   [VM-OK]
description: lazygit runs in any git directory and lets the user stage with Space and commit with `c` — the two operations the TUI chapter teaches — and asks before initialising when the directory is not a repo.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/lg-not-git && cd /tmp/lg-not-git && lazygit` + Enter → lazygit asks whether to initialise a repository; answer No / Escape; it exits.
  * Type `mkdir -p /tmp/lg && cd /tmp/lg && git init -q && git config user.email t@e.st && git config user.name T && echo hi > a.txt && lazygit` + Enter.
  ** Panels Status / Files / Branches / Commits / Stash on the left, diff on the right; Files lists `?? a.txt`.
  * With Files focused (press `2` or click it) press Space → `A  a.txt` (staged, green).
  * Press `c`, type `first commit`, Enter → `first commit` appears in the Commits panel.
  * Press `?` (keybinding overlay), Escape, then Tab a few times (focus cycles across panels), then `q`.
  * Type `git log --oneline` + Enter → one line `first commit`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The repo-local identity avoids a "please tell me who you are" failure when the minted user has no global git identity.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the init prompt, `?? a.txt`, the staged `A  a.txt`, the commit in the Commits panel, the `?` overlay and `git log --oneline`.
  * If unsuccessful
  ** Screenshot of the state where a key did nothing and lazygit's error bar.
covers: manual/21-tuis.md:3-9; manual/18-development-tools.md:37; install/omarchy-base.packages (lazygit); config/lazygit/config.yml

### btop-activity-float-and-tile   [VM-OK]
description: Super+Ctrl+T opens btop as a centred floating "Activity" window in Omarchy's theme, Super+T tiles it, and btop is hidden from the app launcher list.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so one tiled window exists.
  * Press Super+Ctrl+T. A floating, centred window (≈875×600) opens running btop (CPU graph, memory, disks, network, processes) in the Omarchy theme colours.
  * Press Super+T → btop snaps into the tiling beside the terminal. Press Super+T again → it floats again.
  * Press `q` in btop; the window closes.
  * Open Omarchy Menu (Super+Space) → Apps and type `btop`: no btop row is offered. Escape and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The btop window is the one with the process table; its class is `org.omarchy.btop`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of btop floating over the terminal, tiled beside it, and the empty launcher search.
  * If unsuccessful
  ** Screenshot of what Super+Ctrl+T produced.
covers: manual/21-tuis.md:19-23; default/hypr/bindings/utilities.lua:104; default/hypr/apps/system.lua:2-9; default/omarchy/launcher.hides; config/btop/btop.conf

### herdr-session-and-keybindings   [VM-OK]
description: Super+Ctrl+Return starts Herdr's persistent session and re-attaches to it, its prefix is Ctrl+Space like tmux, and Super+Ctrl+K / Learn → Herdr show the Herdr cheatsheet.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Return. A terminal opens running Herdr: a tab bar with one tab and a shell; the hostname on the right of the tab bar.
  ** If nothing opens, the chord may be absent on this build — check the Super+K list and report "absent on this build".
  * Type `export HMARK=kept` + Enter, then press Ctrl+Space then `c` → a second tab appears; Alt+1 returns to the first.
  ** If Ctrl+Space seems swallowed (fcitx5 trigger), try Alt+Enter, which splits the pane; report which worked.
  * Press Super+Ctrl+K → a searchable menu "Herdr keybindings" with a `PREFIX → CTRL + SPACE` row and rows like `PREFIX + c / … → New tab`. Escape.
  * Close the Herdr window with Super+W, press Super+Ctrl+Return again → both tabs are still there; in tab 1 `echo $HMARK` + Enter → `kept`.
  * Open Omarchy Menu (Super+Space) → Learn → Herdr → the same cheatsheet; Escape. Type `exit` in each tab until Herdr closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `h` in a plain terminal attaches to the same session.
  * Ctrl+Space then Shift+K closes the whole workspace if `exit` per tab is slow.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Herdr with one tab, with two tabs, the Super+Ctrl+K menu, and the re-attached session printing `kept`.
  * If unsuccessful
  ** Screenshot of the terminal after Super+Ctrl+Return.
covers: manual/21-tuis.md:25-29; manual/20-shell-functions.md:24; default/hypr/bindings/applications.lua:13; default/hypr/bindings/utilities.lua:12; bin/omarchy-launch-terminal-herdr; bin/omarchy-menu-herdr-keybindings; config/herdr/config.toml; default/bash/aliases:53

### about-fastfetch   [VM-OK]
dedupe-with: 41/about-fastfetch
description: Omarchy Menu → About opens the fastfetch system summary in a floating window with the Omarchy logo and the Hardware/Software/Uptime boxes, showing the Omarchy version and the current theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Space and select About.
  ** A floating, centred terminal shows the green Omarchy ASCII logo on the left and three boxes: `Hardware` (PC, CPU, GPU, display, disk, memory, swap), `Software` (`OS Omarchy <version>`, branch, channel, kernel, WM `Hyprland`, terminal `foot`, packages, theme name with eight coloured dots, font) and `Age / Uptime / Update`.
  * Note the theme name shown, then press Super+W to close.
  * Open Omarchy Menu → Style → Theme: the checked theme must match the name from About. Escape.
  * Open About again: it reopens at the same fitted size without visibly resizing after the first paint. Close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The GPU row in this guest reads something like `Red Hat, Inc. Virtio 1.0 GPU` — correct.
  * fastfetch is not printed on terminal open; About is the only stock path to it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the About window with logo and all three boxes, the theme picker with the matching ✓, and the reopened window.
  * If unsuccessful
  ** Screenshot of what opened (e.g. a terminal with an error).
covers: manual/21-tuis.md:31-35; default/omarchy/omarchy-menu.jsonc:33; bin/omarchy-launch-about; etc/fastfetch/config.jsonc; default/hypr/apps/system.lua:31-33; test/shell.d/launch-about-test.sh

### disk-usage-dua   [VM-OK]
description: The "Disk Usage" launcher entry opens dua in interactive mode on `/` in a floating terminal so a user can find what fills the disk.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Space, type `Disk Usage`, select the app row.
  ** A floating terminal runs dua; after scanning `/` (a few seconds) it lists `usr`, `home`, `var`, … with sizes, largest first.
  * Press Enter on `usr` to descend (its children appear), then `u` to go back up.
  * Press `?` → help overlay; Escape.
  * Press `q` (confirm if asked) → the window closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do **not** press `d` or Shift+D (mark for deletion).
  * The window class is `TUI.float`, so it floats and is centred.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the floating dua window sorted by size, inside `usr`, and the help overlay.
  * If unsuccessful
  ** Screenshot of the window after launch (empty terminal or `dua: command not found`).
covers: manual/21-tuis.md:37-39; applications/Disk Usage.desktop; install/omarchy-base.packages (dua-cli); default/hypr/apps/system.lua:7-9

### cliamp-music-tui-without-audio   [VM-PARTIAL]
description: Super+Shift+Alt+M opens the Cliamp terminal player and a second press focuses rather than duplicates it; with no audio device the guest verifies the UI, the `?` help and a graceful playback attempt only.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Alt+M. A terminal window runs Cliamp: a Winamp-style panel with a playlist / radio list and transport controls.
  * Press `?` → the keybinding list; press `?` or Escape to close it.
  * Select a radio station and play it. Expect a playback error inside Cliamp or a "playing" state with no sound; no crash or freeze.
  * Press Super+Return (focus leaves), then Super+Shift+Alt+M again: the workspace still shows a single Cliamp window, now focused; no second tile appeared.
  * Quit Cliamp with `q` (or Super+W) and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: actual audio output.
  * Cliamp also has an Apps-menu row; the hotkey is enough for this story.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Cliamp's main screen, the `?` help, the state after play, and the single Cliamp window after the second hotkey.
  * If unsuccessful
  ** Screenshot of a crash/blank terminal or of a duplicate window.
covers: manual/21-tuis.md:41-43; default/hypr/bindings/applications.lua:15; bin/omarchy-launch-or-focus-tui; install/omarchy-base.packages (cliamp)

### custom-tui-install-and-remove   [VM-OK]
description: Install → TUI turns any terminal command into a launcher entry (name, command, float/tile, icon) that launches in the chosen window style, Remove → TUI deletes it, and empty input is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → TUI. A floating terminal shows `Let's create a TUI shortcut…` and `Name>`.
  * Press Enter on every prompt (pick any window style) → `You must set app name, app command, and icon URL/name!` and a red Failed line. Press a key.
  * Repeat Install → TUI with Name `Top Probe`, Launch Command `top`, Window style `float`, Icon `utilities-terminal` → `You can now find Top Probe using the app launcher (SUPER + SPACE)` → Done!, press a key.
  * Open Omarchy Menu, type `Top Probe`, select it → a **floating** terminal running `top`; press `q`.
  * Open Omarchy Menu → Remove → TUI → the picker lists `Disk Usage`, `Docker`, `Top Probe`; select **Top Probe only** → notification "TUI removed Top Probe"; the launcher no longer offers it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The gum "Window style" question is answered with arrows + Enter.
  * Never remove Disk Usage or Docker; there is no single-item undo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the rejection, the success line, the floating `top` window, the picker and the removal notification, plus a launcher search showing no `Top Probe`.
  * If unsuccessful
  ** Screenshot of the failing prompt.
covers: manual/21-tuis.md:49-51; default/omarchy/omarchy-menu.jsonc:214,295; bin/omarchy-tui-install; bin/omarchy-tui-remove; test/shell.d/launcher-remove-test.sh

### files-nautilus-hotkeys   [VM-OK]
description: Super+Shift+F opens Files, Super+Shift+Alt+F opens it in the active terminal's directory, Ctrl+L accepts a typed path and Space previews a file — the everyday file-manager flow of the GUI chapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+F. A Nautilus window opens on the home folder (sidebar, a `Work` folder). Close it with Super+W.
  ** GTK apps render oversized at 1× on this VM — expected.
  * Press Super+Return, type `mkdir -p /tmp/nfm && cd /tmp/nfm && echo preview me > note.txt` + Enter, then (terminal still focused) press Super+Shift+Alt+F.
  ** Nautilus opens **in `/tmp/nfm`** showing `note.txt`.
  * Press Ctrl+L, type `/usr/share/omarchy`, Enter → folders like `bin`, `themes`, `default`. Press Alt+Left to go back.
  * Click `note.txt` once and press Space → a quick-preview popup shows `preview me`; Space again closes it.
  * Double-click `note.txt` → it opens in Neovim in a terminal window (plain text → Neovim); `:q!` + Enter. Close Nautilus and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+F reads the cwd of the *focused* terminal; keep it focused when pressing.
  * If double-click opens a different editor, report which.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Nautilus on home, on `/tmp/nfm`, on `/usr/share/omarchy`, the preview popup, and Neovim with `preview me`.
  * If unsuccessful
  ** Screenshot of the wrong directory / missing preview.
covers: manual/22-guis.md:3-9; default/hypr/bindings/applications.lua:4-5; bin/omarchy-launch-nautilus; bin/omarchy-launch-nautilus-cwd; bin/omarchy-cmd-terminal-cwd; install/omarchy-base.packages (nautilus, sushi)

### obsidian-hotkey-single-window   [VM-OK]
description: Super+Shift+O opens Obsidian and a second press focuses the existing window rather than starting another copy.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+O. Obsidian opens (software rendering, allow 15 s) with its vault chooser ("Create new vault" / "Open folder as vault").
  ** If Hyprland shows an "Obsidian is not responding" dialog during start-up, click **Wait**.
  * Press Super+Return (a terminal takes focus), then Super+Shift+O again.
  ** Focus returns to the same Obsidian window; the workspace shows exactly one Obsidian tile, no second copy.
  * In Obsidian create a vault named `probe` in the default location → the editor view appears. Open Settings (gear) → Appearance and report whether a theme named `Omarchy` is listed.
  * Close Obsidian and the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The vault dialog uses a GTK file chooser (oversized at 1× — expected).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Obsidian's first screen, the workspace with a single Obsidian window after the second hotkey, and the Appearance settings.
  * If unsuccessful
  ** Screenshot of two Obsidian windows (duplicate launch) or no window.
covers: manual/22-guis.md:11-19; default/hypr/bindings/applications.lua:18; bin/omarchy-launch-or-focus; default/hypr/helpers.lua:63-64,135-137

### omawrite-hotkey   [VM-OK]
description: Super+Shift+W opens Omawrite, Omarchy's markdown writer, ready to type.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+W. Omawrite opens: a minimal writing window with a text area (allow 10 s).
  * Type `# Hello from Omawrite` → the text appears in the editor.
  * Open Omarchy Menu (Super+Space) → Apps and type `Omawrite`: an app row exists. Escape.
  * Close Omawrite with Super+W (discard if asked). The desktop is empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The acceptance suite allows 60 s for Omawrite to appear on a cold start.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Omawrite with the typed heading and of the Apps row.
  * If unsuccessful
  ** Screenshot of the desktop after the hotkey.
covers: manual/22-guis.md:21-25; default/hypr/bindings/applications.lua:19; install/omarchy-base.packages (omawrite); test/acceptance.d/apps-test.sh (writer row)

### omacalc-floating-calculator   [VM-OK]
description: Super+Ctrl+Q opens Omacalc as a floating calculator that evaluates expressions and handles a division by zero without crashing; Super+T tiles it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so a tiled window exists, then press Super+Ctrl+Q. Omacalc opens **floating** over the terminal.
  * Type `2+2*3` + Enter → `8`.
  * Type `10/0` + Enter → an error or infinity indication, no crash.
  * Press Super+T → Omacalc tiles beside the terminal; Super+T again → floats. Close Omacalc and the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The calculator key (XF86Calculator) cannot be sent by the driver; only the Super+Ctrl+Q path is tested.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Omacalc floating with `8`, the `10/0` result, and Omacalc tiled.
  * If unsuccessful
  ** Screenshot of the desktop after the hotkey.
covers: manual/22-guis.md:62-66; default/hypr/bindings/utilities.lua:13-14; default/hypr/apps/system.lua:37; install/omarchy-base.packages (omacalc)

### signal-hotkey-installs-when-missing   [VM-PARTIAL] [NET] [SLOW]
description: Signal is not preinstalled: Super+Shift+G starts its installer in a floating terminal (Ctrl+C at the password prompt aborts cleanly), launches Signal when done, and later presses focus the existing window. Linking a phone is out of reach.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+G. A floating Omarchy terminal shows the logo, `Installing Signal...` and a sudo password prompt. Press Ctrl+C → the terminal closes, nothing installed.
  ** The manual says the hotkey "offers" to install; in practice the install starts and the password prompt is the only gate — note it.
  * Press Super+Shift+G again and type `prime` at the prompt. pacman downloads signal-desktop (~150 MB, up to 4 min, screenshot every ≤5 s), then `Opening Signal...`, `Signal has been installed.`, Done!. Press a key.
  * A Signal window opens (allow 20 s) with its "Link this device" / welcome screen. Click **Wait** if Hyprland reports it not responding.
  * Press Super+Return, then Super+Shift+G once more → the same Signal window is focused; the workspace shows one Signal window only.
  * Open Omarchy Menu (twice if needed) → Install → Service: Signal is dim ✓. Close Signal and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: linking/using Signal. Signal has no menu removal row; it stays installed on this disk (end with `stop` if the disk should be discarded).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the installer prompt, the cancelled attempt, the completed install lines, Signal's welcome screen, the single window after the third press, and the dim ✓ row.
  * If unsuccessful
  ** Screenshot of the red Failed line.
covers: manual/22-guis.md:68-72; default/hypr/bindings/applications.lua:17; bin/omarchy-launch-signal; bin/omarchy-install-service-signal; default/omarchy/omarchy-menu.jsonc:226

### share-menu-localsend   [VM-PARTIAL]
description: Super+Ctrl+S opens the Share menu (Clipboard / File / Folder / Receive); Clipboard hands the copied text to LocalSend, Receive opens LocalSend itself, and the CLI routes the same way. No peer device exists, so the transfer is not checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `echo shared-text-123 | wl-copy` + Enter, then press Super+Ctrl+S. The Omarchy Menu opens on Share with rows Clipboard, File, Folder, Receive.
  * Select Clipboard → a floating LocalSend window in send mode listing a `.txt` file and scanning for nearby devices (none found is expected). Close it.
  * Press Super+Ctrl+S → Receive → LocalSend's main window (Receive tab with this device's name). Close it.
  * Press Super+Ctrl+S → File → a file chooser opens (oversized GTK dialog — expected); press Escape; nothing else opens.
  * In the terminal type `omarchy share folder /tmp` + Enter → LocalSend opens in send mode with `tmp`; close it. Then `omarchy share bogus` + Enter → a "Share files" chooser opens (the mode is not validated — record it); Escape.
  * Open Omarchy Menu (Super+Space) → Trigger → Share: the same four rows. Escape and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: sending to / receiving from another device.
  * LocalSend is a Flutter app in software rendering: allow 10 s per launch; its window floats at 1100×700.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Share submenu, LocalSend in send mode with the clipboard file, the Receive window, the cancelled chooser, the folder send, and the Trigger → Share rows.
  * If unsuccessful
  ** Screenshot of what opened instead.
covers: manual/22-guis.md:39-54; default/hypr/bindings/utilities.lua:85; default/omarchy/omarchy-menu.jsonc:70,86-89; bin/omarchy-menu-share; default/hypr/apps/localsend.lua

### launcher-gui-apps-open   [VM-PARTIAL]
description: The preinstalled GUI apps the manual starts from the app launcher (Pinta, Aether, Omacut, LibreOffice Writer, Disks, Moonlight, Kdenlive, OBS Studio) each open a window and close cleanly; OpenGL-heavy apps run on software rendering here, so only "opens and closes" is checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * For each name below: open Omarchy Menu with Super+Space, type the name, select the app row, wait for its window (up to 45 s), screenshot, then close it with Super+W (choose Don't Save / Discard if asked).
  ** `Pinta` — toolbox and a blank canvas.
  ** `Aether` — theming app with an image/colour extraction view.
  ** `Omacut` — video trimmer window (empty timeline / open prompt).
  ** `LibreOffice Writer` — a blank document (the Start Center row is hidden from the launcher).
  ** `Disks` — GNOME Disks listing the 40 GB virtio disk `/dev/vda`.
  ** `Moonlight` — "Searching for PCs…" / an Add PC button.
  ** `Kdenlive` — a first-run wizard may appear; accept defaults.
  ** `OBS Studio` — cancel the auto-configuration wizard; a "no audio device" indication is expected.
  * After the last one the desktop must be empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: any editing, streaming or recording; audio and GPU features.
  * Kdenlive and OBS are slowest under llvmpipe: if one has not painted after 45 s, screenshot and report "slow", do not wait longer. Click **Wait** on any "not responding" dialog.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per app showing its main window, and the empty desktop at the end.
  * If unsuccessful
  ** Screenshot of the missing or blank window for that app.
covers: manual/22-guis.md:27-37,56-60,74-96; manual/26-gaming.md:63; install/omarchy-base.packages (pinta, aether, omacut, libreoffice-fresh, gnome-disk-utility, moonlight-qt, kdenlive, obs-studio); default/omarchy/launcher.hides; default/hypr/apps/system.lua:41-52

### mpv-double-click-video   [VM-PARTIAL]
description: Double-clicking a video in Files opens it in mpv (the default handler) in a floating opaque window, and a missing file gives a clear error; playback is video-only in this audio-less guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/vid && ffmpeg -loglevel error -f lavfi -i testsrc=duration=6:size=320x240:rate=15 /tmp/vid/test.mp4 && ls /tmp/vid` + Enter → `test.mp4`.
  ** If `ffmpeg` is missing, report it and copy any `.mp4` found with `fd -e mp4 . /usr/share | head -1` to `/tmp/vid/test.mp4`.
  * Type `xdg-mime query default video/mp4` + Enter → `mpv.desktop`.
  * Press Super+Shift+Alt+F (Files in `/tmp/vid`) and double-click `test.mp4` → mpv opens a floating window playing the colour test pattern with a moving counter; it ends by itself or with `q`.
  * In the terminal type `mpv /tmp/vid/missing.mp4; echo exit=$?` + Enter → `Failed to open …` / no such file, non-zero exit. Close Nautilus and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: audio. mpv may log `[ao] Failed to initialize audio driver` — expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the mpv window with the test pattern after double-click, the `mpv.desktop` line and the missing-file error.
  * If unsuccessful
  ** Screenshot of the wrong player / no window.
covers: manual/22-guis.md:9,74-78; applications/mpv.desktop; default/hypr/apps/system.lua:7-9,41-52

### pdf-open-and-annotate-xournalpp   [VM-OK]
description: Double-clicking a PDF opens Document Viewer, Open With… offers Xournal++, and Xournal++ lets the user place text with the T tool and export a PDF — the "fill out a non-form PDF" flow.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `mkdir -p /tmp/pdf && cd /tmp/pdf && printf 'Name: ______\n' > form.txt && libreoffice --headless --convert-to pdf form.txt >/dev/null && ls` + Enter → `form.pdf`.
  ** If conversion is unavailable, copy any PDF from `fd -e pdf . /usr/share | head -1` to `/tmp/pdf/form.pdf`.
  * Press Super+Shift+Alt+F (Files in `/tmp/pdf`) and double-click `form.pdf` → Document Viewer (Evince) opens the page in a floating window. Close it.
  * Right-click `form.pdf` → Open With… → choose Xournal++ (type `Xournal` to filter) → Open. Xournal++ opens with the PDF as background (dismiss any first-run dialog).
  * Press `T` (or click the Text tool), click next to `Name:`, type `Prime`, click elsewhere → the text sits on the page.
  * File → Export as PDF → name `filled.pdf` in `/tmp/pdf` → Save. Close Xournal++ (discard the `.xopp` prompt).
  * In the terminal type `xdg-open /tmp/pdf/filled.pdf` + Enter → Evince shows the page with `Prime`. Close it, Nautilus and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Open With chooser and the export dialog are GTK dialogs (oversized at 1× — expected).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Evince on `form.pdf`, the Open With chooser with Xournal++, the typed text on the page, the export dialog, and Evince showing `filled.pdf` with `Prime`.
  * If unsuccessful
  ** Screenshot of the step that failed.
covers: manual/27-filling-out-pdfs.md; install/omarchy-base.packages (evince, xournalpp); default/hypr/apps/system.lua:7

### browser-hotkeys-and-default-query   [VM-OK] [NET]
description: Super+Shift+Return opens the default browser (Chromium), Super+Shift+Alt+B opens a private window, and `omarchy default browser` reports `chromium` and rejects unknown names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return. Chromium opens (allow 15 s) in Omarchy colours; type `example.com` in the address bar + Enter → "Example Domain".
  ** If Hyprland shows "Chromium is not responding", click **Wait**.
  * Press Super+Shift+Alt+B → a second Chromium window in Incognito mode ("You've gone Incognito").
  * Press Super+Return, type `omarchy default browser; omarchy default browser bogus; echo exit=$?` + Enter → `chromium`, the usage line `<chromium|chrome|brave|brave-origin|edge|firefox|zen>`, `exit=1`.
  * Type `xdg-settings get default-web-browser` + Enter → `chromium.desktop`.
  * Close both Chromium windows and the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chromium windows are forced to tile; dismiss any first-run bubble.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Chromium on example.com, the Incognito window, and the terminal lines (`chromium`, usage + `exit=1`, `chromium.desktop`).
  * If unsuccessful
  ** Screenshot of what the hotkey opened.
covers: manual/23-browsers.md:3,11-17; default/hypr/bindings/applications.lua:3,6-7; bin/omarchy-launch-browser; bin/omarchy-default-browser; test/shell.d/launch-browser-test.sh

### copy-url-extension   [VM-OK] [NET]
description: In Chromium, Alt+Shift+L copies the current tab's URL through Omarchy's native host with a notification and a clipboard-history entry, both in a normal window and inside a web app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return, open `https://example.com/`, wait for it to load (click **Wait** on any not-responding dialog).
  * Press Alt+Shift+L → an Omarchy notification about the copied URL appears.
  * Press Super+Ctrl+V → the clipboard manager lists `https://example.com/` as the newest entry; Escape.
  * Press Super+Shift+Y (YouTube web app), then Alt+Shift+L in the frameless window → notification; Super+Ctrl+V now shows a `https://www.youtube.com/…` entry on top; Escape.
  * In the Chromium window open `chrome://extensions` → "Copy URL" and "Download Video" are listed and enabled. Close both windows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A YouTube consent/bot page still yields a youtube.com URL — enough.
  * The extension's toolbar button (puzzle-piece menu) does the same if the chord does not arrive.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the notification, the clipboard manager with the example.com entry, the same for the YouTube web app, and chrome://extensions.
  * If unsuccessful
  ** Screenshot after Alt+Shift+L with no notification.
covers: manual/23-browsers.md:19-27; manual/25-web-apps.md:13; default/chromium/extensions/copy-url/manifest.json; config/chromium-flags.conf; install/user/chromium.sh; test/shell.d/chromium-copy-url-test.sh

### download-video-extension   [VM-PARTIAL] [NET] [SLOW]
description: Alt+Shift+D on a page with a video hands the URL to yt-dlp, shows progress on the OSD and saves under ~/Videos; a page without a video reports an error. A Wikimedia Commons clip is used because YouTube may refuse the guest's datacenter IP.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return and open `https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_first_23_seconds_1080p.ogv` (click **Wait** on any not-responding dialog).
  * Press Alt+Shift+D. Within a few seconds the OSD (the volume overlay) shows download progress updating in place, then completes (up to 2 min; screenshot every ≤5 s).
  * Press Super+Shift+F and open the `Videos` folder → a new video file whose name contains `Big_Buck_Bunny`. Close Files.
  * In Chromium open `https://example.com/` and press Alt+Shift+D → a notification/OSD saying no video was found or a yt-dlp error — record the exact text.
  * Close the browser.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: YouTube specifically. If the Commons download is refused, screenshot the error OSD and report it; the wiring is still demonstrated by the error path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the OSD progress, the completed state, the new file in Videos, and the no-video error.
  * If unsuccessful
  ** Screenshot after Alt+Shift+D with nothing happening.
covers: manual/23-browsers.md:23-25; default/chromium/extensions/yt-dlp/manifest.json; bin/omarchy-chromium-ytdlp-host; test/shell.d/chromium-ytdlp-test.sh

### install-firefox-make-default-and-remove   [VM-OK] [NET]
description: Install → Browser installs Firefox (~80 MB) without promoting it, Setup → Defaults → Browser then makes the browser hotkey open Firefox, and Remove → Browser (which never lists Chromium) takes it away after Chromium is restored as default.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Browser (Chrome, Edge, Brave, Brave Origin, Firefox, Zen) → Firefox.
  ** Floating terminal: `Installing Firefox...`, sudo (`prime`), install (~3 min), `Firefox browser installed. Make it the default via Setup > Defaults > Browser.`, Done!. Press a key.
  * Press Super+Shift+Return → **Chromium** still opens (installing does not promote). Close it.
  * Open Omarchy Menu → Setup → Defaults → Browser (Chromium ✓) → Firefox → notification "Firefox is now the default browser".
  * Press Super+Shift+Return → Firefox opens (allow 15 s); Super+Shift+Alt+B → a Firefox **Private Browsing** window. Close both.
  * Press Super+Return, type `omarchy default browser chromium` + Enter → notification "Chromium is now the default browser".
  * Open Omarchy Menu (twice if needed) → Remove → Browser: Firefox listed, Chromium **not**. Select Firefox → sudo → Done!, press a key. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Firefox is not themed by Omarchy — expected.
  * Screenshot the install every ≤5 s; a red Failed line means stop and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install completion line, Chromium still opening, the Firefox default notification, Firefox and its Private window from the hotkeys, the Chromium restore notification, and the Remove → Browser list without Chromium.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: manual/23-browsers.md:5-17,31-39; default/omarchy/omarchy-menu.jsonc:152-159,217-222,304-309; bin/omarchy-install-browser; bin/omarchy-default-browser; bin/omarchy-launch-browser; test/shell.d/browser-policy-dir-test.sh

### default-browser-menu-lists-uninstalled   [VM-OK]
description: Setup → Defaults → Browser (and → Terminal) lists every option even when not installed and picking one starts an install — contrary to the manual — and an accidental pick can be cancelled with no side effect.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Setup → Defaults → Browser. Record the rows: Chromium ✓, Chrome, Brave, Brave Origin, Edge, Firefox, Zen — all selectable although only Chromium is installed.
  * Select Zen → a floating terminal starts `Installing Zen...` (an AUR build). Press Ctrl+C at once (or at the sudo prompt); the terminal closes.
  * Press Super+Return, type `omarchy default browser` + Enter → still `chromium`.
  * Open Omarchy Menu → Setup → Defaults → Terminal: Alacritty, Foot ✓, Ghostty, Kitty all listed. Escape and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+C within the first seconds aborts before yay downloads anything meaningful.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Defaults → Browser list with all seven rows, the aborted Zen install, `chromium` still default, and the Defaults → Terminal list.
  * If unsuccessful
  ** Screenshot of a list that differs (that would mean the code now matches the manual — report which).
covers: manual/23-browsers.md:9; manual/15-terminal.md:7; default/omarchy/omarchy-menu.jsonc:152-164; bin/omarchy-default-browser:40-47; bin/omarchy-default-terminal:34-41

### 1password-hotkey-installs-when-missing   [VM-PARTIAL] [NET] [SLOW]
description: Super+Shift+/ installs 1Password (with its CLI and the Chromium extension registration) when missing and then launches it; sign-in is out of reach, so the installer flow, the extension file and the first screen are checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+/ (Super+Shift+Slash). A floating terminal shows `Installing 1Password...` and a sudo prompt; type `prime`.
  ** It installs `1password` and `1password-cli` (~200 MB, up to 4 min), prints `Installing 1Password extension for Chromium...`, `Opening 1Password...`, `1Password has been installed. Restart Chromium to load the browser extension.`, Done!. Press a key.
  * A 1Password window opens (allow 20 s) with its welcome / sign-in screen (click **Wait** on any not-responding dialog).
  * Press Super+Return, type `cat /usr/share/chromium/extensions/aeblfdkhhhdcdjpifhhbdiojplfjncoa.json; op --version` + Enter → the `external_update_url` JSON line and a CLI version.
  * Press Super+Shift+/ again → a 1Password window is focused/relaunched, no installer.
  * Open Omarchy Menu (twice if needed) → Install → Service: 1Password dim ✓. Close 1Password and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: signing in; the extension loading (needs a Chromium restart + Web Store).
  * 1Password has no menu removal row; it stays installed on this disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the installer lines, 1Password's first screen, the JSON + `op` version, and the dim ✓ row.
  * If unsuccessful
  ** Screenshot of the red Failed line.
covers: manual/24-commercial-apps-services.md:5-9; default/hypr/bindings/applications.lua:20; bin/omarchy-launch-1password; bin/omarchy-install-service-1password; test/shell.d/launch-1password-test.sh

### spotify-hotkey-installs-when-missing   [VM-PARTIAL] [NET] [SLOW]
description: Super+Shift+M installs Spotify when missing, launches it afterwards and focuses it on repeat presses; without an account or audio device only install/launch/focus is checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+M → floating terminal `Installing Spotify...`, sudo prompt (`prime`), download (~150 MB, up to 4 min), `Opening Spotify...`, `Spotify has been installed.`, Done!. Press a key.
  * A Spotify window opens (allow 20 s) with its log-in screen (click **Wait** on any not-responding dialog).
  * Press Super+Return, then Super+Shift+M → the same Spotify window is focused; the workspace shows one Spotify window only.
  * Open Omarchy Menu (twice if needed) → Install → Service: Spotify dim ✓. Close Spotify and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: logging in and playback (no audio device). Spotify has no menu removal row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the installer, Spotify's log-in screen, the single window after the second press, and the dim ✓ row.
  * If unsuccessful
  ** Screenshot of the red Failed line.
covers: manual/24-commercial-apps-services.md:15-19; default/hypr/bindings/applications.lua:14; bin/omarchy-launch-spotify; bin/omarchy-install-service-spotify

### install-service-menu-states   [VM-OK]
description: Install → Service and Remove → Services present exactly the documented services in the stock state (nothing installed, nothing removable), so users find 1Password, Bitwarden, Spotify, Dropbox, Tailscale, ONCE and NordVPN where the manual points.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Service. Rows: 1Password, Dropbox, Spotify, Signal, Tailscale, NordVPN, ONCE, Bitwarden, Chromium Account — none dim.
  * Back out (Backspace) and open Remove: there is no Services row (nothing installed). Escape.
  * Press Super+Return, type `omarchy install service` + Enter → a help table of `omarchy install service <name>` commands (1password, dropbox, nordvpn, once, signal, spotify, sunshine, tailscale). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Chromium Account" is an extra row not in the manual — report it as present.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Install → Service, the Remove submenu without Services, and the CLI help table.
  * If unsuccessful
  ** Screenshot of the menu with unexpected dim or missing rows.
covers: manual/24-commercial-apps-services.md; default/omarchy/omarchy-menu.jsonc:223-231,310-311; bin/omarchy (group help)

### tailscale-install-blocks-at-login   [VM-PARTIAL] [NET]
description: Install → Service → Tailscale installs and starts tailscaled but then blocks at `tailscale up` waiting for a browser login; aborting there leaves the package installed and logged out without the bar plugin or web app, and Remove → Services cleans it up.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Service → Tailscale. Floating terminal: sudo (`prime`), `Installing Tailscale...`, `Starting Tailscale...`, then a line `To authenticate, visit: https://login.tailscale.com/a/…` and no further progress.
  * Press Ctrl+C → the floating terminal closes at once (the whole script is killed; no Done! prompt).
  * Press Super+Return, type `systemctl is-active tailscaled; tailscale status` + Enter → `active` and `Logged out.`
  * Look at the top bar: no Tailscale icon (the plugin step never ran). Open Omarchy Menu → Apps, type `Tailscale`: no web app row.
  * Open Omarchy Menu (twice if needed) → Remove → Services → Tailscale → sudo → Done!, press a key. `tailscale status` + Enter → `command not found`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: `tailscale up` login, Taildrop, the admin web app, the bar panel.
  * Do not open the login URL; the guest cannot complete the flow.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the blocked `To authenticate` line, `active` + `Logged out.`, the bar without a Tailscale icon, the empty Apps search, and the removal.
  * If unsuccessful
  ** Screenshot of the failing step.
covers: manual/24-commercial-apps-services.md:25-29; default/omarchy/omarchy-menu.jsonc:227,311; bin/omarchy-install-service-tailscale; bin/omarchy-remove-service-tailscale; test/shell.d/tailscale-test.sh

### webapp-hotkeys-open-frameless   [VM-OK] [NET]
description: The plain web-app hotkeys (HEY email, new email, calendar; ChatGPT; Grok; YouTube; X and X compose) each open a frameless Chromium app window at the documented site.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+E → a frameless window (no tabs, no address bar) loading `app.hey.com` (HEY sign-in). Screenshot; close with Super+W.
  ** Click **Wait** on any "not responding" dialog during the first Chromium start.
  * Press Super+Shift+Alt+E (HEY new message) and then Super+Shift+C (HEY Calendar): each opens a frameless HEY window; close each.
  * Press Super+Shift+A → `chatgpt.com`; press Alt+Shift+L, then Super+Ctrl+V → the clipboard manager's top entry is a `https://chatgpt.com/…` URL; Escape, close the window.
  * Press Super+Shift+Alt+A → `grok.com`; close. Press Super+Shift+Y → YouTube; close.
  * Press Super+Shift+X → `x.com`; close. Press Super+Shift+Alt+X → `x.com/compose/post` (login wall acceptable); close.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The window title names the site; cookie banners or bot checks are fine — the window at the right domain is the pass.
  * ChatGPT and Grok have no launcher rows (hotkey-only); do not look for them in Apps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per frameless window with the site visible, plus the clipboard entry for ChatGPT.
  * If unsuccessful
  ** Screenshot after the hotkey (nothing, or a normal tabbed browser window).
covers: manual/25-web-apps.md:17-39,55-63; default/hypr/bindings/applications.lua:22-27,32-33; bin/omarchy-launch-webapp

### webapp-hotkeys-focus-not-duplicate   [VM-OK] [NET]
description: The focus-tagged web-app hotkeys (Google Photos, Maps, Messages, WhatsApp) open their frameless window once and, on a repeat press, focus it instead of opening a second copy.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+P → a frameless Google Photos window (sign-in). Click **Wait** on any not-responding dialog.
  * Press Super+Return (a terminal takes focus), then Super+Shift+P again → focus returns to the same Photos window; the workspace shows exactly one Photos tile. Close Photos.
  * Press Super+Shift+S → Google Maps (map or consent page); close. Press Super+Shift+Ctrl+G → Google Messages; close.
  * Press Super+Shift+Alt+G → WhatsApp Web (QR/sign-in); press it again → still one WhatsApp window. Close it and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+S is Maps here, not a screenshot.
  * With two windows on one workspace Hyprland tiles them side by side, so a duplicate is obvious on the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each window and of the workspace with a single Photos / single WhatsApp window after the repeat press.
  * If unsuccessful
  ** Screenshot of two tiles of the same app, or of nothing opening.
covers: manual/25-web-apps.md:41-51; default/hypr/bindings/applications.lua:28-31; bin/omarchy-launch-or-focus-webapp; bin/omarchy-launch-or-focus

### webapp-launcher-entries   [VM-OK] [NET]
description: The web apps the manual says live in the app launcher (Basecamp, Discord, Zoom, Google Contacts, plus HEY/YouTube/X/WhatsApp/Google Maps/Messages/Photos) exist as launcher rows and open frameless windows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * For `Basecamp`, `Discord`, `Zoom`, `Google Contacts` in turn: open Omarchy Menu (Super+Space), type the name, select the row, wait for the frameless window, screenshot, close.
  ** Expected pages: launchpad.37signals.com sign-in; discord.com login; app.zoom.us/wc/home; Google sign-in.
  * Open Omarchy Menu → Apps and scroll: rows for HEY, YouTube, X, WhatsApp, Google Maps, Google Messages, Google Photos are present. Screenshot; Escape.
  * The desktop is empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Zoom and YouTube app windows are opaque; the others carry slight transparency. Click **Wait** on any not-responding dialog.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the four windows and of the Apps list with the web-app rows.
  * If unsuccessful
  ** Screenshot of a missing row or failed launch.
covers: manual/25-web-apps.md:23-27,49-51,65-75; applications/*.desktop; docs/file-layout.md:89; default/hypr/apps/browser.lua:8-9

### install-webapp-interactive-and-remove   [VM-OK] [NET]
description: Install → Web App asks for a name and URL, fetches the site icon automatically, creates a launcher entry that opens the site as a web app, and Remove → Web App deletes it with a notification.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Web App → floating terminal `Let's create a new web app…` with `Name>`.
  * Type `Arch Wiki Probe` + Enter; at `URL>` type `wiki.archlinux.org` + Enter (no scheme on purpose).
  ** The icon is fetched automatically (no `Icon URL/name>` prompt) and it prints `You can now find Arch Wiki Probe using the app launcher (SUPER + SPACE)` → Done!, press a key.
  ** If the favicon fetch fails, an `Icon URL/name>` prompt appears: type `omarchy-discord` + Enter and note that the automatic fetch failed.
  * Open Omarchy Menu, type `Arch Wiki`, select the row → a frameless window loads the Arch Wiki with an icon in the launcher row. Close it.
  * Open Omarchy Menu (twice if needed) → Remove → Web App → the picker lists the web apps; select **Arch Wiki Probe only** → notification "Web app removed Arch Wiki Probe".
  * Open Omarchy Menu, type `Arch Wiki`: no row any more. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never pick a preinstalled web app in the removal picker.
  * The same name entered twice silently overwrites (no duplicate check).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompts, the success line, the launcher row with icon, the web-app window, the picker, the removal notification and the empty search.
  * If unsuccessful
  ** Screenshot of the failing prompt.
covers: manual/25-web-apps.md:3-9; default/omarchy/omarchy-menu.jsonc:212,294; bin/omarchy-webapp-install; bin/omarchy-webapp-remove; test/shell.d/webapp-install-test.sh

### webapp-install-rejects-bad-input   [VM-OK]
dedupe-with: 22/webapp-install-rejects-bad-input
description: The web-app installer refuses names containing `/`, URLs with whitespace or non-http schemes (which Chromium would execute) and reports an icon download failure instead of writing a broken launcher; removing an unknown name deletes nothing but still notifies success.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `omarchy webapp install 'bad/name' example.com omarchy-discord; echo exit=$?` + Enter → `App name cannot contain '/': bad/name`, `exit=1`.
  * Type `omarchy webapp install Probe 'javascript:alert(1)' omarchy-discord` + Enter → `Error: web app URL must be http or https.`
  * Type `omarchy webapp install Probe 'https://example.com/a b' omarchy-discord` + Enter → `Error: web app URL must not contain whitespace.`
  * Type `omarchy webapp install Probe example.com https://example.invalid/none.png; ls ~/.local/share/applications/Probe.desktop` + Enter → `Error: Failed to download icon.` and `No such file`.
  * Type `ls ~/.local/share/applications | wc -l; omarchy webapp remove 'Does Not Exist'; ls ~/.local/share/applications | wc -l` + Enter → the two counts are equal, yet a notification "Web app removed Does Not Exist" appears (known false success — record it). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only the icon-download step needs network (a `.invalid` DNS failure is instant).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each error line, the missing `Probe.desktop`, the equal counts and the misleading notification.
  * If unsuccessful
  ** Screenshot of a launcher created despite the bad input (`cat` it) — a security-relevant failure.
covers: manual/25-web-apps.md:3; bin/omarchy-webapp-install:14-27,61-84,155-180; bin/omarchy-webapp-remove:60-70; test/shell.d/webapp-name-test.sh; test/shell.d/webapp-install-escaping-test.sh

### mailto-and-zoom-handlers   [VM-OK] [NET]
description: `mailto:` links open HEY's compose page and `zoommtg://` links open the Zoom web client join page, because the HEY and Zoom launchers register as the scheme handlers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `xdg-mime query default x-scheme-handler/mailto; xdg-mime query default x-scheme-handler/zoommtg` + Enter → `HEY.desktop` and `Zoom.desktop`.
  * Type `xdg-open 'mailto:test@example.com'` + Enter → a frameless HEY window whose target is `app.hey.com/messages/new?to=test@example.com` (sign-in redirect acceptable; read the URL with Alt+Shift+L then Super+Ctrl+V). Close it.
  * Type `xdg-open 'zoommtg://zoom.us/join?confno=1234567890&pwd=abc'` + Enter → a frameless Zoom window at `app.zoom.us/wc/join/1234567890?pwd=abc` (an "invalid meeting" page is fine — the URL is what matters). Close it.
  * Type `omarchy-webapp-handler-zoom` + Enter (no argument) → a Zoom window at `app.zoom.us/wc/home`. Close it and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click **Wait** on any "not responding" dialog while the app window starts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both `xdg-mime` answers, the HEY compose window with its URL in the clipboard manager, and the Zoom join window with its URL.
  * If unsuccessful
  ** Screenshot of what `xdg-open` opened instead.
covers: manual/25-web-apps.md:17-21,65-69; applications/HEY.desktop; applications/Zoom.desktop; bin/omarchy-webapp-handler-hey; bin/omarchy-webapp-handler-zoom

### install-xbox-cloud-gaming-webapp   [VM-OK] [NET]
description: Install → Gaming → Xbox Cloud Gaming creates the Xbox web app (icon fetched from a CDN), launches it, marks the row installed, and Remove → Gaming takes it away — the cheapest end-to-end gaming installer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Gaming. Rows: Steam, RetroArch, Minecraft, NVIDIA GeForce NOW, Xbox Cloud Gaming, Xbox Controllers, Battle.net, Lutris, Heroic (Epic Games), RetroArch Game Launcher — none dim. Select Xbox Cloud Gaming.
  ** Floating terminal `Installing Xbox Cloud Gaming...` → Done! (no sudo), and a frameless window opens on `xbox.com/en-US/play`. Press a key in the terminal; close the window.
  * Open Omarchy Menu, type `Xbox` → the `Xbox Cloud Gaming` row with an Xbox icon. Escape.
  * Open Omarchy Menu (twice if needed) → Install → Gaming: Xbox Cloud Gaming dim ✓; Remove → Gaming lists it.
  * Remove → Gaming → Xbox Cloud Gaming → Done!, press a key. Open Omarchy Menu, type `Xbox`: no row. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon comes from `cdn.jsdelivr.net`; a failed download prints `Error: Failed to download icon.` and a red Failed line — screenshot and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Gaming menu, the install terminal + Xbox window, the launcher row with icon, the dim ✓ row and the Remove row, and the empty search afterwards.
  * If unsuccessful
  ** Screenshot of the failed terminal.
covers: manual/26-gaming.md:7,35-41; default/omarchy/omarchy-menu.jsonc:253-262,325; bin/omarchy-install-gaming-xbox-cloud; bin/omarchy-remove-gaming-xbox-cloud; bin/omarchy-webapp-install

### retro-game-launcher-without-cores   [VM-OK]
description: Install → Gaming → RetroArch Game Launcher explains that no RetroArch cores are installed (RetroArch is optional) instead of offering an empty picker, and the CLI rejects a missing ROM or core.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Gaming → RetroArch Game Launcher → notification "No RetroArch cores found /usr/lib/libretro"; no picker opens.
  * Press Super+Return. Type `omarchy games retro install snes9x; echo exit=$?` + Enter → `Usage: omarchy-games-retro-install [core path-to-game]`, an example, `exit=1`.
  * Type `omarchy games retro install snes9x /tmp/nope.sfc` + Enter → `Game not found: /tmp/nope.sfc`.
  * Type `touch /tmp/rom.sfc && omarchy games retro install snes9x /tmp/rom.sfc` + Enter → `Core not found: /usr/lib/libretro/snes9x_libretro.so`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The notification disappears after a few seconds — screenshot promptly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the notification, the usage + `exit=1`, `Game not found`, `Core not found`.
  * If unsuccessful
  ** Screenshot of an empty picker or of a created launcher.
covers: manual/26-gaming.md:31; default/omarchy/omarchy-menu.jsonc:262; bin/omarchy-games-retro-install; bin/omarchy-games-retro-cores

### battlenet-launch-without-install   [VM-OK]
description: `omarchy launch battlenet` refuses with a clear message when Battle.net has not been installed, rejects unknown flags and prints help, so the launcher never silently does nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `omarchy launch battlenet; echo exit=$?` + Enter → `Battle.net is not installed. Run omarchy-install-gaming-battlenet first.` and `exit=1`.
  * Type `omarchy launch battlenet --bogus` + Enter → `Unknown argument: --bogus` and `Try: omarchy-launch-battlenet --help`.
  * Type `omarchy launch battlenet --help` + Enter → the usage block mentioning `--with-mangohud`.
  * Open Omarchy Menu (Super+Space), type `Battle` → no Battle.net launcher row yet. Escape and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nothing is downloaded.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three messages and the empty launcher search.
  * If unsuccessful
  ** Screenshot of a hang or of umu-run starting.
covers: manual/26-gaming.md:69-73; bin/omarchy-launch-battlenet; test/shell.d/battlenet-test.sh

### install-steam-fails-without-gpu   [VM-PARTIAL] [NET] [SLOW]
description: Install → Gaming → Steam installs the Steam package but, on a machine with no Intel/AMD/NVIDIA GPU, the lib32 driver step exits 1 so the installer ends "Failed" and never launches Steam — a defect the guest reproduces every run; Remove → Gaming still cleans up.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Gaming → Steam. Floating terminal: `Installing Steam...`, sudo (`prime`), pacman installs `steam` (~300 MB, up to 5 min; accept any provider default), then `Installing lib32 graphics drivers...`.
  ** Expected on virtio-vga: the script stops right there with `● Failed (exit code 1)! Press any key to close...` and no `Steam will start automatically now` line. Record the exact ending; a Done! with Steam starting would mean the defect is fixed.
  * Press a key. No Steam window appears within 60 s.
  * Open Omarchy Menu (twice if needed) → Install → Gaming: Steam is dim ✓ (the package did install); Remove → Gaming lists Steam.
  * Remove → Gaming → Steam → sudo → Done!, press a key.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: launching Steam, logging in, Proton (no GPU).
  * Screenshot the download every ≤5 s; a network failure before `lib32` is a different, earlier Failed line — report which.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Installing lib32 graphics drivers...` line followed by `Failed (exit code 1)`, the desktop without Steam, the dim ✓ row, and the removal.
  * If unsuccessful
  ** Screenshot of an earlier failure (download) or of Steam actually starting (defect fixed).
covers: manual/26-gaming.md:11-17; default/omarchy/omarchy-menu.jsonc:253,321; bin/omarchy-install-gaming-steam; bin/omarchy-install-gaming-gpu-lib32; default/hypr/apps/steam.lua

### install-retroarch-no-vulkan   [VM-PARTIAL] [NET] [SLOW]
description: Install → Gaming → RetroArch installs the core set, creates ~/Games/{bios,roms}, writes the Vulkan/XMB/CRT-Royale config and opens Files on ~/Games; in this GPU-less guest RetroArch is expected not to start its Vulkan video driver, recorded as the hardware limit.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Gaming → RetroArch. Floating terminal: sudo (`prime`), ~50 packages (~1 GB, up to 8 min, screenshot every ≤5 s), then `Put your roms and bios files in ~/Games. …` and Done!; a Nautilus window on `~/Games` shows `bios` and `roms`. Press a key; close Nautilus.
  * Press Super+Return, type `grep -E '^(video_driver|menu_driver|system_directory)' ~/.config/retroarch/retroarch.cfg; cat ~/.config/retroarch/config/global.slangp` + Enter → `video_driver = "vulkan"`, `menu_driver = "xmb"`, the `~/Games/bios` path, and the `crt-royale.slangp` reference.
  * Open Omarchy Menu, type `retro`, select RetroArch. Report what happens: the XMB menu appears, or nothing / an error (expected without a Vulkan driver).
  * Open Omarchy Menu → Install → Gaming → RetroArch Game Launcher → a core picker with many cores now opens; Escape.
  * Remove → Gaming → RetroArch → sudo → Done!, press a key. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: running RetroArch/games. Pass = installer output, config lines, core picker, removal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the installer's final lines with Nautilus on ~/Games, the config lines, the launch attempt result, the core picker, and the removal.
  * If unsuccessful
  ** Screenshot of the red Failed line.
covers: manual/26-gaming.md:19-33; default/omarchy/omarchy-menu.jsonc:254,262,322; bin/omarchy-install-gaming-retroarch; bin/omarchy-games-retro-install

### windows-vm-install-refused-in-guest   [VM-PARTIAL]
description: Install → Windows stops with a clear prerequisite message when the machine cannot host the VM — no `/dev/kvm` in this guest, or too little disk for the 64 GB default — instead of downloading anything, and afterwards `status` says the VM is not configured. The full install is not runnable here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `ls -l /dev/kvm; df -h --output=avail ~ | tail -1` + Enter and note both answers.
  * Open Omarchy Menu (Super+Space) → Install → Windows (selectable — no `windows-vm.desktop` exists yet).
  ** Expected without `/dev/kvm`: a boxed `❌ KVM virtualization not available!` with `sudo modprobe kvm-intel / kvm-amd` hints, then a red Failed line. With `/dev/kvm`: after the RAM/cores/disk questions (accept defaults with Enter, leave username/password blank), `❌ Insufficient disk space!` with `Available` / `Required: 74GB`, then Failed. Press a key.
  * In the terminal type `omarchy windows vm status; echo exit=$?` + Enter → `Windows VM not configured.`, `To set up: omarchy-windows-vm install`, `exit=1`.
  * Open Omarchy Menu → Remove: no Windows row. Open Omarchy Menu → Apps, type `Windows`: no launcher row. Escape.
  * Type `rmdir ~/Windows ~/.windows 2>/dev/null; ls -d ~/Windows ~/.windows` + Enter → both missing (the aborted installer may have created them empty; this restores the stock state). Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: the 10–15 min Windows download, RDP, shared folder, `--keep-alive`, Remove → Windows (needs nested KVM and ≥ 80 GB).
  * If a polkit prompt appears, authorize with `prime`; the prerequisite checks still stop the install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the kvm/df line, the refusal box (KVM or disk), the not-configured status with `exit=1`, and the Remove/Apps menus without Windows.
  * If unsuccessful
  ** Screenshot of the installer proceeding to a download (press Ctrl+C) — report which check was skipped.
covers: manual/28-windows-vm.md:3-7,17-24,47-49; default/omarchy/omarchy-menu.jsonc:215,296; bin/omarchy-windows-vm:1126-1153,1520-1553; test/shell.d/windows-vm-test.sh

### windows-vm-cli-without-vm   [VM-OK]
description: The `omarchy windows vm` commands are safe on a machine without the VM: stop and status say it is not configured, help lists the subcommands (including `--keep-alive`), and an unknown subcommand is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `omarchy windows vm status; echo exit=$?` + Enter → `Windows VM not configured.`, `To set up: omarchy-windows-vm install`, `exit=1`.
  * Type `omarchy windows vm stop; echo exit=$?` + Enter → `Windows VM not configured.`, `exit=1`, no error trace.
  * Type `omarchy windows vm help` + Enter → the usage block listing install / remove / launch (`--keep-alive, -k`) / stop / status / help.
  * Type `omarchy windows vm frobnicate; echo exit=$?` + Enter → `Unknown command: frobnicate`, the usage, `exit=1`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * None of these need Docker; if a polkit prompt appears, cancel it and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each command's output with its exit code.
  * If unsuccessful
  ** Screenshot of a stack trace or hang.
covers: manual/28-windows-vm.md:19-24; bin/omarchy-windows-vm:1503-1620

### windows-oem-key-absent   [VM-OK]
description: `omarchy windows key` reports that no OEM Windows key is stored in firmware (OVMF has no MSDM table) instead of printing garbage — the absence path of the licence helper.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `ls /sys/firmware/acpi/tables/MSDM 2>&1` + Enter → `No such file or directory`.
  * Type `omarchy windows key; echo exit=$?` + Enter → `No Windows license key found in firmware.` and `exit=1` (a sudo prompt may appear first — type `prime`).
  * Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A five-group key like `XXXXX-XXXXX-…` on this guest would be a false positive — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the missing MSDM table and the `No Windows license key found` line with `exit=1`.
  * If unsuccessful
  ** Screenshot of any other output.
covers: manual/28-windows-vm.md:45; bin/omarchy-windows-key; test/shell.d/windows-key-test.sh

### package-install-and-remove-menu   [VM-OK] [NET]
description: Install → Package opens the fuzzy package picker, installs the chosen Arch package after the sudo prompt, and Remove → Package removes it again; cancelling either picker changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu (Super+Space) → Install → Package → a floating terminal with an fzf list of all repository packages and a preview pane (`alt-p: toggle description, alt-j/k: scroll, tab: multi-select`). Press Escape → the terminal closes, nothing installed.
  * Repeat, type `cowsay` → the list narrows and the preview shows `Name : cowsay`; press Enter → sudo prompt (`prime`), pacman installs, `● Done!`. Press a key.
  * Press Super+Return, type `cowsay moo` + Enter → the ASCII cow.
  * Open Omarchy Menu → Remove → Package → an fzf list of installed packages with a red pointer. Press Escape → nothing removed (`cowsay moo` still works).
  * Repeat Remove → Package, type `cowsay`, check the highlighted row is exactly `cowsay`, Enter → pacman removes it → Done!, press a key.
  * `cowsay moo` + Enter → `command not found`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker removes whatever is highlighted: type the full name and check the row before Enter.
  * The picker terminal floats (class `org.omarchy.terminal`); typing filters immediately.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install picker, the filtered `cowsay` row with preview, Done!, the cow, the remove picker (red pointer), the removal Done! and `command not found`.
  * If unsuccessful
  ** Screenshot of the failing step (e.g. a sync-database error).
covers: manual/29-other-packages.md:5,9; default/omarchy/omarchy-menu.jsonc:194,287; bin/omarchy-pkg-install; bin/omarchy-pkg-remove; bin/omarchy-show-done

### pkg-add-drop-cli   [VM-OK] [NET]
description: `omarchy pkg add` installs a named package idempotently and fails clearly for a package that does not exist; `omarchy pkg drop` removes installed packages and ignores unknown names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return. Type `omarchy pkg add sl; echo exit=$?` + Enter → sudo (`prime`), pacman installs `sl`, `exit=0`.
  * Type `omarchy pkg add sl; echo exit=$?` + Enter → no pacman output (already installed), `exit=0`.
  * Type `omarchy pkg add definitely-not-a-package-xyz; echo exit=$?` + Enter → `error: target not found: definitely-not-a-package-xyz`, the red `Error: Package 'definitely-not-a-package-xyz' did not install`, `exit=1`.
  * Type `omarchy pkg present sl; echo exit=$?; omarchy pkg present sl nothere; echo exit=$?` + Enter → `exit=0` then `exit=1`.
  * Type `omarchy pkg drop sl nothere; echo exit=$?; omarchy pkg drop sl; echo exit=$?` + Enter → pacman removes only `sl`, `exit=0`, then nothing to do, `exit=0`. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sl` is a few KB. The sudo credential is cached for a few minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each command with its `exit=` line, especially the `did not install` error.
  * If unsuccessful
  ** Screenshot of the deviating output.
covers: manual/29-other-packages.md:5,9; bin/omarchy-pkg-add; bin/omarchy-pkg-drop; bin/omarchy-pkg-present; test/shell.d/pkg-drop-test.sh

### install-aur-browse-and-cancel   [VM-OK] [NET]
description: Install → AUR loads the AUR package index into the fuzzy picker with a PKGBUILD preview, and cancelling builds nothing; a real AUR build is left out of the time budget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return, type `yay -Qm | wc -l` + Enter and note the count (foreign packages).
  * Open Omarchy Menu (Super+Space) → Install → AUR → a terminal; after yay fetches the AUR list (seconds) an fzf list appears with a label mentioning `alt-b/B: toggle PKGBUILD`.
  * Type `omarchy` → AUR entries such as `omarchy-…`; highlight one and press Alt+B → the preview shows its PKGBUILD; Alt+Shift+B → back to the info view.
  * Press Escape → the terminal closes without building.
  * In the terminal `yay -Qm | wc -l` + Enter → the same count as before. Close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not press Enter on a package; AUR builds can exceed the session budget.
  * An AUR index fetch failure shows a yay error and the terminal closes — screenshot it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the AUR picker, the PKGBUILD preview, and the unchanged count.
  * If unsuccessful
  ** Screenshot of the yay error.
covers: manual/29-other-packages.md:7; default/omarchy/omarchy-menu.jsonc:195; bin/omarchy-pkg-aur-install

### remove-preinstalls-disables-webapp-hotkeys   [VM-OK] [NET] [SLOW]
description: Remove → Preinstalls strips the preinstalled web apps, TUIs, mise stubs and optional desktop packages and, after the Hyprland reload, the preinstalled-app hotkeys stop firing; Install → Preinstalls brings everything back. Run last, on a disk to be discarded.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+A → a ChatGPT web-app window opens (baseline). Close it.
  * Open Omarchy Menu (Super+Space) → Remove → Preinstalls → `Are you sure you want to remove all preinstalled web apps, TUI wrappers, and desktop applications?` Choose No → nothing happens; press a key.
  * Repeat and choose Yes → `Removing web app: …` lines, TUIs removed, packages removed (sudo `prime`; obsidian, libreoffice, pinta, kdenlive, obs-studio, …), Done!. Press a key (up to 3 min).
  * Press Super+Shift+A, then Super+Shift+O → **nothing** opens either time (the binding block is gated off).
  ** If ChatGPT still opens, run `hyprctl reload` in a terminal, retry, and report that the script's reload did not take.
  * Open Omarchy Menu: Remove → Preinstalls, Remove → Web App and Remove → TUI are gone; Install → Preinstalls is selectable. Open Omarchy Menu → Apps: no HEY / YouTube / Disk Usage rows.
  * Install → Preinstalls → sudo → reinstall (~700 MB, up to 6 min) → Done!, press a key. Press Super+Shift+A → ChatGPT opens again; Apps lists HEY and Disk Usage again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * End the session with `stop` unless the reinstall completed cleanly.
  * Reopen the menu twice before asserting rows appeared or vanished.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the confirmation, the removal log, the desktop unchanged after both dead hotkeys, the menu state, the reinstall Done!, and ChatGPT opening again.
  * If unsuccessful
  ** Screenshot of the red Failed line.
covers: manual/25-web-apps.md:7; default/hypr/helpers.lua:84-90; default/hypr/bindings/applications.lua:10-34; default/omarchy/omarchy-menu.jsonc:216,297; bin/omarchy-remove-preinstalls; bin/omarchy-install-preinstalls; bin/omarchy-webapp-remove-all; bin/omarchy-tui-remove-all; test/shell.d/preinstalls-test.sh


## Gaps

Behaviours in scope that could not be turned into a driver test on this guest, plus the manual/code disagreements a maintainer should look at.

### Not runnable here (VM-NO appendix — keep out of TESTS.md's main list)

- **Windows VM end to end** (`manual/28`): needs nested KVM and ≥ 74 GB free; the 10–15 min image download alone exceeds the budget. Only the refusal path is tested (`windows-vm-install-refused-in-guest`). `--keep-alive`, RDP clipboard/audio, `~/Windows` sharing, Remove > Windows, the `0700` migration and the localhost-only port binding are untestable here. Suggestion: a dedicated runner with `-cpu host,+vmx` and a 120 GB disk.
- **Battle.net / Lutris / Heroic / Minecraft / GeForce NOW installs** (`manual/26`): multi-GB Proton/launcher downloads, accounts, and no GPU. `battlenet-launch-without-install` covers the negative path only. GeForce NOW additionally installs flatpak.
- **Xbox Controllers** (`xpadneo-dkms`): builds a kernel module (needs `linux-omarchy-headers`, ~5 min) and there is no Bluetooth to pair with; the install-only path is possible but proves nothing about controllers.
- **Sunshine host** (`omarchy install service sunshine`): opens firewall ports and needs an encoder; no Moonlight client can reach the guest (no inbound network).
- **Moonlight pairing** with a real PC: no LAN peer. Only the window is checked (`launcher-gui-apps-open`).
- **LocalSend transfers**: no second device; only the UI is checked (`share-menu-localsend`).
- **Agents panel with data** (`manual/17:38-41`): needs real Claude/Codex/Fireworks usage files; only the "hidden until usage" absence path is checked.
- **Claude default + Chromium extension** (`omarchy-install-chromium-claude`): needs Anthropic sign-in and Web Store access; skip.
- **Hermes Desktop, OpenClaw, ChatGPT Desktop, Claude Desktop, Perplexity, Grok Bot, T3 Code, LM Studio** (*Install > AI*): AUR/OPR packages of 100 MB–1 GB plus first-launch runtime builds (Hermes) and accounts. Only Ollama is proposed (`install-ai-ollama-local-llm`, NET, ~4 min).
- **Dropbox, ONCE, NordVPN, Bitwarden** (`manual/24`): need accounts/licences; NordVPN also asks for a reboot. Bitwarden's `omarchy-install-and-launch` path (AUR, ~100 MB) would be VM-OK NET SLOW if a bare "window opens" check is wanted — not proposed to keep the list within budget.
- **`gh auth login`, `ghui`, `hey`, `basecamp`, `cf` stubs**: device-flow/browser logins that cannot complete in the guest.
- **`ssh` reconnect loop** (`fns/ssh-reconnect`): needs an interactive session that lives ≥ 30 s and then drops (a remote host that reboots). Only the fast-failure pass-through is tested. Could be simulated by enabling sshd (*Setup > Security > SSHD*, other reviewer's scope), `ssh localhost`, and `sudo systemctl restart sshd` from a second terminal after 30 s — worth a follow-up definition if the SSHD reviewer lands theirs.
- **`fip` real forward**: same dependency on sshd; a `fip localhost 8080` against a local `python -m http.server` would be VM-OK once sshd is enabled.
- **`iso2sd` write and `format-drive` execution**: no second disk. Attaching a small scratch `-drive if=none,id=sd,file=scratch.qcow2 -device usb-storage,drive=sd` to the QEMU command would make both exercisable (they key on `/dev/sd*`).
- **Xournal++ signature image insert** (`manual/27:7`): possible (generate a PNG with ImageMagick `convert -size 200x60 xc:white -draw 'text 10,40 "Prime"' sig.png`), but the image-tool placement is fiddly for a screenshot-driven driver; left out of `pdf-open-and-annotate-xournalpp`.
- **Download Video from YouTube specifically**: datacenter IP; a Commons video is used instead.
- **Cliamp / Spotify / mpv audio**, **OBS recording**, **Kdenlive rendering**: no audio device / GPU.
- **Kitty/Alacritty/Ghostty visual fidelity**: they open via llvmpipe; only Kitty is installed in `install-terminal-kitty-and-switch-default`. Alacritty and Ghostty would be the same test with a different row.
- **RetroArch gameplay**: `video_driver = "vulkan"` and no Vulkan ICD in the base set (`vulkan-swrast` is not installed). `install-retroarch-no-vulkan` records the failure to start; a follow-up could add `vulkan-swrast` to the guest to see the XMB menu.
- **Copy URL toolbar button** and **Chromium extension enable prompt**: covered only via the keyboard shortcut.
- **Obsidian "Omarchy" theme sync** (`manual/22:19`): requires the community theme to be installed inside Obsidian (network + Obsidian account-less flow); the test only reports whether it is listed.
- **Theme sync to Claude Code / Pi / OpenCode / Hermes** (`manual/17:35`): needs those agents installed and a theme switch; belongs with the themes reviewer once an agent is present (`default-agent-pick-installs-pi` leaves Pi installed — a theme-switch check could be appended there).
- **LazyVim keymaps beyond the basics** (`Space s g`, `Space u w`, `Space g g` → lazygit inside Neovim, tree `?`): not proposed individually; `Space g g` is a good candidate to fold into `neovim-lazyvim-basics` if lazygit-in-a-float is wanted.
- **Learn > Neovim/Bash/Omarchy/Hyprland/Arch web apps** and **Learn > Community** (`omarchy-launch-discord-community`, falls back to a web app when Discord is not installed): outside these chapters; noted because they use `omarchy-launch-webapp` too.

### Manual/code disagreements (for the docs or code owners)

1. **Defaults menus list uninstalled options** — `manual/23:9` ("the menu only lists browsers you actually have installed") vs `omarchy-menu.jsonc:152-159` (no `when`); picking one installs it (`bin/omarchy-default-browser:40-47`). Same for terminals (`manual/15:7`). Test: `default-browser-menu-lists-uninstalled`.
2. **"Offer to install" wording** — `manual/22:72` (Signal), `manual/24:9,19` (1Password, Spotify): the hotkeys start the install straight away; the sudo password prompt is the only chance to back out. Tests: `signal-hotkey-installs-when-missing`, `1password-…`, `spotify-…`.
3. **Install > AI list** — T3 Code and Dictation exist in the menu (`omarchy-menu.jsonc:245,252`) but not in `manual/17:53`.
4. **ChatGPT / Grok are hotkey-only** — no `.desktop` in `applications/` (icon `ChatGPT.png` ships unused); `manual/25` groups them with launcher web apps. They also cannot be removed via *Remove > Web App*. Test: `webapp-hotkeys-open-frameless` (hint tells the driver not to look for them in Apps).
5. **`tdl` undefined variable** — `default/bash/fns/tmux:37` `tmux select-pane -t "$opencode_pane"` (never set in `tdl`; only `tds` sets it). Focus after `tdl` does not land on the editor as the manual's screenshots imply and tmux may print `can't find pane`. Test: `tmux-dev-layout-tdl` asks the driver to record it.
6. **Node.js is preinstalled** — `install/user/mise-work.sh` provisions `node@latest`; `manual/18:15` lists Node.js among things to install and the menu row is dim on a fresh disk. Test: `install-dev-env-go`.
7. **`omarchy webapp remove <unknown>` notifies success** — `bin/omarchy-webapp-remove:66-70`. Test: `webapp-install-rejects-bad-input`.
8. **`Ctrl+Space s`** (`manual/15:13`) is tmux's default `choose-tree`, not an Omarchy binding, so the cheatsheets (`Super+Alt+K`, `prefix ?`) do not list it. Test: `tmux-session-attach-and-resume` exercises it; `tmux-keybindings-cheatsheets` shows it is absent from the list.
9. **Remove > Services only knows Dropbox and Tailscale** (`omarchy-menu.jsonc:310-311`); `bin/omarchy-remove-service-1password` exists but has no row, and Spotify/Signal/ONCE/NordVPN/Bitwarden must go through *Remove > Package*. `manual/24` is silent. Test: `install-service-menu-states`.
10. **`iso2sd` "interactively"** (`manual/20:12`) — only `/dev/sd*` devices are offered (`fns/drives:13-17`); on NVMe-only machines with a USB stick that enumerates as `/dev/sd*` it works, but SD readers exposed as `/dev/mmcblk*` are never listed. Test: `drive-helpers-safe-paths` shows the "No SD drives found" message.
11. **`tds` hard-codes `nvim .`** (`fns/tmux:57`) while `tdl` honours `$EDITOR`; a user who set Helix/Vim as default editor gets Neovim in `tds` (`manual/20:20` says "editor").
12. **Manual says Super+Ctrl+T "opens as a floating window, which you can tile with Super+T"** — true, but the same floating rule also catches `imv`, `mpv`, Evince and every `TUI.float` app; not a disagreement, just worth a sentence in `manual/22:9`.
13. **`manual/26:63` "Moonlight … Launch Moonlight via Super+Space"** — correct (base package), but `apps/moonlight.lua` exists and was not reviewed here; window-rule behaviour for Moonlight is unverified.
14. **`manual/17:29` Claude extension "may ask for your system password"** — `omarchy-default-agent` swallows the installer's errors (`2>/dev/null || true`), so a failed extension install is silent; the manual's "cancelling … still selects and launches Claude" matches, but there is no feedback path to test.
15. **`omarchy share <unknown-mode>` is not rejected** — `bin/omarchy-menu-share:14-31` only special-cases `clipboard` and `folder`; any other word with no path opens the multi-file chooser. Harmless, but the usage line advertises three modes. Test: `share-menu-localsend` records it.
16. **`omarchy-install-docker-dbs` Escape handler calls an undefined `main_menu`** (`bin/omarchy-install-docker-dbs:9`) — cancelling the gum chooser prints `main_menu: command not found` before `No databases selected for installation.`. Test: `docker-db-redis` records it.
17. **Steam (and Heroic/Lutris/Battle.net) installers fail on a GPU-less machine** — `bin/omarchy-install-gaming-gpu-lib32` ends with `(( ${#PACKAGES[@]} > 0 )) && …`, so with no Intel/AMD/NVIDIA GPU it exits 1 and the `set -e` callers stop before launching the app; `manual/26:15` promises "Steam will start automatically". Test: `install-steam-fails-without-gpu` (from 01-FACTS [23]).
18. **Tailscale install blocks at `sudo tailscale up`** (`bin/omarchy-install-service-tailscale:11`) waiting for a browser login; Ctrl+C in the floating terminal kills the whole script so the operator grant, Taildrop unit, bar plugin and admin web app never run; `manual/24:27-29` describes them as part of the install. Test: `tailscale-install-blocks-at-login` (from 01-FACTS [23]).
19. **`omarchy install dev-env <unknown>` succeeds silently** — no default `case` branch in `bin/omarchy-install-dev-env`; exit 0 with no output, while the remover rejects unknown names. Test: `install-dev-env-go` records it (from 01-FACTS [23]).
20. **Crash-capture toasts need a default agent** — `bin/omarchy-crash-watch:69` skips every crash while `omarchy-default-agent` prints nothing, so on a stock disk (no agent chosen) the "Process crashed" notification the manual describes never appears; `manual/17:43-47` does not say so. Test: `crash-capture-notification-and-toggle` writes an agent name first.

### Coverage summary

- Inventory lines: 166 (15 chapters + cross-cutting).
- Proposed tests: 82 total, every one 3–8 top-level steps — VM-OK 66 (of which NET 20, SLOW 1), VM-PARTIAL 16 (of which NET 10, SLOW 6), VM-NO 0 in the main list (the VM-NO areas are recorded in the appendix above rather than as blocks).
- Two names collide with other reviewers on purpose and carry `dedupe-with:`: `about-fastfetch` (41), `webapp-install-rejects-bad-input` (22).

