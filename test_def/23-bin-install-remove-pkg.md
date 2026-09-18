# 23 — bin/omarchy-install-*, omarchy-remove-*, omarchy-pkg-*, mise, voxtype, tailscale, windows-vm, reinstall, installed-*, cmd-*

Reviewer notes for the software install/remove surface of Omarchy (omarchy @ HEAD 2026-09-18,
read at `/tmp/omarchy-review/omarchy`). Format per `test_def/00-FORMAT.md`.

## Scope

Read completely (97 scripts, ~5,160 lines):

| group | files | lines |
|---|---|---|
| `bin/omarchy-install-*` | 40 scripts (ai-chatgpt, ai-claude, ai-hermes 162, ai-openclaw, ai-t3-code, and-launch, app, browser 98, chromium-claude, chromium-copy-url, chromium-google-account, chromium-ytdlp, dev-env 155, docker-dbs, editor-emacs/helix/vscode/zed, font, gaming-battlenet 88, gaming-geforce-now, gaming-gpu-lib32, gaming-heroic, gaming-lutris, gaming-retroarch 85, gaming-steam, gaming-xbox-cloud, gaming-xbox-controllers, hermes-cli 280, openclaw-cli, preinstalls, service-1password, service-dropbox, service-nordvpn, service-once, service-signal, service-spotify, service-sunshine 87, service-tailscale, terminal) | 1,748 |
| `bin/omarchy-remove-*` | 30 scripts (ai-chatgpt, ai-claude, ai-grok-bot, ai-hermes 147, ai-lm-studio, ai-ollama, ai-openclaw 78, ai-perplexity, ai-t3-code, browser 70, dev-env 113, gaming-battlenet, gaming-geforce-now, gaming-heroic, gaming-lutris, gaming-minecraft, gaming-retroarch, gaming-steam, gaming-xbox-cloud, gaming-xbox-controllers, launcher-entry 101, preinstalls, security-fido2, security-fingerprint, security-sshd, security-sudoless-docker, service-1password, service-dropbox, service-sunshine, service-tailscale) | 1,166 |
| `bin/omarchy-pkg-*` | 9 (add, aur-accessible, aur-add, aur-install, drop, install, missing, present, remove) | 174 |
| `bin/omarchy-cmd-*` | 3 (missing, present, terminal-cwd) | 47 |
| `bin/omarchy-mise-install` | 1 | 59 |
| `bin/omarchy-installed-*` | 2 (service-dropbox, service-tailscale) | 24 |
| `bin/omarchy-reinstall*` | 3 (reinstall, reinstall-configs, reinstall-pkgs) | 61 |
| `bin/omarchy-voxtype-*` | 5 (config, install, model, remove, status) | 79 |
| `bin/omarchy-tailscale-*` | 2 (receive 99, send 50) | 149 |
| `bin/omarchy-windows-*` | 2 (key 41, vm 1,614) | 1,655 |

Also read: `install/omarchy-base.packages` (153 lines), `install/omarchy-other.packages` (75),
`default/pacman/{pacman-stable,pacman-rc,pacman-edge}.conf` + three `mirrorlist-*`,
`default/libalpm/hooks/{00-omarchy-update-guard,10-omarchy-hyprland-reload-pause,90-omarchy-hyprland-reload-resume}.hook`,
`etc/mise/conf.d/omarchy.toml`, the `install.*` / `remove.*` rows of `default/omarchy/omarchy-menu.jsonc`
(lines 193–350), `install/user/mise.sh` (the preinstalled agent stubs), and for context
`bin/omarchy-update-pacman-guard`, `bin/omarchy-launch-floating-terminal-with-presentation`,
`bin/omarchy-show-done`, `bin/omarchy-sudo-docker`, `bin/omarchy-font-set`, `bin/omarchy-refresh-applications`,
`shell/plugins/menu/Menu.qml` (Delete-key uninstall path only), `default/hypr/bindings/utilities.lua`.

Skimmed maintainer tests: `test/shell.d/pkg-drop-test.sh`, `mise-install-test.sh`, `mise-work-path-test.sh`,
`mise-wrapper-quiet-migration-test.sh`, `preinstalls-test.sh`, `dropbox-test.sh`, `hermes-cli-test.sh`,
`hermes-cli-migration-test.sh`, `hermes-desktop-install-test.sh`, `hermes-remove-test.sh`,
`hermes-skills-migration-test.sh`, `hermes-skin-migration-test.sh`, `hermes-theme-test.sh`,
`voxtype-invitation-test.sh`, `tailscale-test.sh`, `tailscale-receive-test.sh`, `windows-vm-test.sh`,
`windows-vm-compose-test.sh`, `windows-vm-mount-boundary-test.sh`, `remove-ai-test.sh`,
`launch-1password-test.sh`, `t3code-install-test.sh`, `battlenet-test.sh`.

Skipped: the ~1,000 lines of `omarchy-windows-vm` between the validation helpers and the command
functions (privileged bind-mount / compose-writer internals). They have no on-screen surface beyond the
error strings quoted in Observations and are covered by `windows-vm-compose-test.sh` and
`windows-vm-mount-boundary-test.sh`. Also not re-derived: exact package sizes — every size below is an
estimate from the Arch/AUR/omarchy repo packages as of writing, marked `~`.

Notation used below: **Menu** = the Omarchy Menu (`Super+Space` at HEAD; `omarchy-menu toggle <route>`
from a terminal is the unambiguous fallback). **Apps** = the app launcher (`Super+Alt+Space`,
`omarchy-menu toggle apps`). **Float** = the floating terminal that
`omarchy-launch-floating-terminal-with-presentation` opens: it shows the Omarchy logo, runs the command,
then prints `● Done! Press any key to close...` or `● Failed (exit code N)! Press any key to close...`.
`sudo` inside it asks for the account password (`prime`) unless passwordless sudo was set up.

## Inventory

Format: `script` — flags — sudo/terminal — approx. download — menu path (or CLI-only). Every `bin/omarchy-X-Y-Z`
is also reachable as `omarchy X Y Z` through `bin/omarchy`.

**Package primitives (`bin/omarchy-pkg-*`, `bin/omarchy-cmd-*`)**
- `omarchy-pkg-add <packages...>` — sudo (uses `sudo pacman -S --noconfirm --needed`, or plain `pacman` when root) — exits 1 with red `Error: Package 'X' did not install` if any name is still absent after the transaction; a name pacman rejects (`target not found`) exits 1 — CLI-only; called by every installer.
- `omarchy-pkg-drop <packages...>` — sudo (`pacman -Rns --noconfirm`) — only names that are *exactly* installed are removed; not-installed or provider-only names are silently ignored (pkg-drop-test.sh); exits 0 when there is nothing to do — CLI-only; called by every remover.
- `omarchy-pkg-missing <packages...>` — no sudo — exit 0 if **any** named package is missing, 1 if all present — CLI-only.
- `omarchy-pkg-present <packages...>` — no sudo — exit 0 if **all** present, 1 if any missing — CLI-only; used by every `disabled`/`when` menu condition.
- `omarchy-pkg-install` — sudo (`omarchy-sudo-keepalive` then `sudo pacman -S --noconfirm`) — fzf multi-select over `pacman -Slq` with `pacman -Sii` preview (alt-p toggles preview, tab multi-select), then `omarchy-show-done` — **Menu → Install → Package** (opens a normal terminal with `--app-id=org.omarchy.terminal`, no logo wrapper). Escape in fzf ends the script silently.
- `omarchy-pkg-remove` — sudo (`sudo pacman -Rns --noconfirm`) — fzf over `yay -Qqe` with red pointer — **Menu → Remove → Package**.
- `omarchy-pkg-aur-install` — sudo — fzf over `yay -Slqa` (downloads the AUR package list, ~10 MB) with `yay -Siia` preview, alt-b/B toggles PKGBUILD; selections prefixed `aur/`; then `sudo updatedb` — **Menu → Install → AUR**.
- `omarchy-pkg-aur-add <packages...>` — sudo via yay — `yay -S --noconfirm --needed`, same secondary check as pkg-add — CLI-only; used by browser (chrome/edge/brave/zen) and emacs installers.
- `omarchy-pkg-aur-accessible` — no sudo — `curl` to `aur.archlinux.org/rpc` with 30 s connect timeout and 3 retries; exit code only — CLI-only, ~1 KB.
- `omarchy-cmd-missing <cmds...>` / `omarchy-cmd-present <cmds...>` — `command -v` based mirror of pkg-missing/present — CLI-only.
- `omarchy-cmd-terminal-cwd` — hidden — prints cwd of the focused terminal (kitty socket or `/proc/<shell>/cwd`), falls back to `$HOME` — CLI-only.

**Generic installers**
- `omarchy-install-app <display-name> <packages>` — Float; `Installing <name>...` then `omarchy-pkg-add` — usage exit 1 on missing args — Menu → Install → Editor → Vim (`vim`, ~10 MB), Install → AI → LM Studio (`lmstudio-bin`, ~400 MB), Install → AI → Ollama (`ollama`/`ollama-cuda`/`ollama-rocm` chosen by `nvidia-smi`/`rocminfo` presence; plain `ollama` ~30–50 MB).
- `omarchy-install-and-launch <display-name> <packages> <desktop-id>` — Float; pkg-add then `setsid uwsm-app -- gtk-launch <desktop-id>` — usage exit 1 — Menu → Install → Editor → Cursor (`cursor-bin` ~150 MB), Editor → Sublime Text (`sublime-text-4` ~20 MB), Service → Bitwarden (`bitwarden bitwarden-cli` ~100 MB), AI → Grok Bot (`grok-bot`), AI → Perplexity (`perplexity` ~100 MB), Gaming → Minecraft (`minecraft-launcher`, small pkg, downloads on launch).
- `omarchy-install-font <display-name> <package> <family>` — Float; pkg-add, `sleep 2`, `omarchy-font-set <family>` (rewrites alacritty/kitty/ghostty/foot configs + fontconfig, restarts shell) — usage exit 1 — Menu → Install → Style → Font → {Cascadia Mono `ttf-cascadia-mono-nerd` ~3 MB, Meslo LG Mono `ttf-meslo-nerd` ~10 MB, Fira Code `ttf-firacode-nerd` ~5 MB, Victor Code `ttf-victor-mono-nerd` ~4 MB, Bitstream Vera Mono `ttf-bitstream-vera-mono-nerd` ~2 MB, Iosevka `ttf-iosevka-nerd` ~70–100 MB}.
- `omarchy-install-preinstalls` — sudo; `gum confirm` then `omarchy-refresh-applications` (recreates web-app/TUI launchers + all mise stubs) and `omarchy-pkg-add` of aether cliamp libreoffice-fresh xournalpp pinta obsidian obs-studio kdenlive moonlight-qt lazydocker omacut omacalc omawrite (~700 MB+); on pkg failure prints `Preinstalls are still marked as removed...` exit 1 and keeps the marker; on success removes `~/.local/state/omarchy/preinstalls-removed`, `hyprctl reload` — Menu → Install → Preinstalls (row is `disabled` ✓ unless the marker exists).
- `omarchy-remove-preinstalls` — sudo (via pkg-drop); `gum confirm`; `omarchy-webapp-remove-all`, `omarchy-tui-remove-all`, writes the marker, `hyprctl reload`, deletes mise stubs (codex claude agy copilot gh opencode playwright playwright-cli pi omp ori grok crush ghui hunk; cursor-agent and muse only if they are omarchy-mise-install wrappers; hermes only if `omarchy-install-hermes-cli --owns`), then pkg-drop of the same 13 packages — Menu → Remove → Preinstalls (row shown only while the marker is absent).

**Browsers**
- `omarchy-install-browser <chromium|chrome|brave|brave-origin|edge|firefox|zen>` — sudo; usage exit 1 for anything else; chromium/firefox from repos, the rest via `omarchy-pkg-aur-add`; Chromium-family: policy dir, `~/.config/<browser>-flags.conf`, copy-url + yt-dlp native hosts, `omarchy-theme-set-browser`; Firefox-family: distribution policies + `MOZ_ENABLE_WAYLAND=1`; ends `X browser installed. Make it the default via Setup > Defaults > Browser.` — Menu → Install → Browser → {Chrome `google-chrome` ~110 MB, Edge `microsoft-edge-stable-bin` ~170 MB, Brave `brave-bin` ~150 MB, Brave Origin `brave-origin-bin` ~150 MB, Firefox `firefox` ~75 MB, Zen `zen-browser-bin` ~90 MB}. **Chromium has no menu row** (it is preinstalled; `omarchy-install-browser chromium` is CLI-only).
- `omarchy-remove-browser <chrome|brave|brave-origin|edge|firefox|zen>` — sudo; resets default browser to chromium if the removed one was default; drops flags/policy files; usage exit 1 (chromium is not removable) — Menu → Remove → Browser → same six, each `when: omarchy-pkg-present <pkg>`.
- `omarchy-install-chromium-google-account` — no sudo; appends two `--oauth2-client-*` lines to `~/.config/chromium-flags.conf` idempotently; silent no-op when the file is missing — Menu → Install → Service → Chromium Account (`when` the flags file exists, `disabled` once the lines are there).
- `omarchy-install-chromium-copy-url` / `omarchy-install-chromium-ytdlp` — no sudo; write `NativeMessagingHosts/com.omarchy.{copy_url,ytdlp}.json` into 12 Chromium-family profile roots under `~/.config` (creating them) — CLI-only; called by install-browser.
- `omarchy-install-chromium-claude` — root via `sudo` (tty) or `pkexec` (no tty); writes `/usr/share/{chromium,google-chrome,microsoft-edge}/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json`; exits 0 silently when already present — CLI-only.

**Editors**
- `omarchy-install-editor-helix` — sudo via pkg-add; `helix` ~20 MB; symlinks theme to `~/.config/helix/themes/omarchy.toml`, seeds `config.toml` with `theme = "omarchy"`, adds `alias hx="helix"` to `.bashrc` — Menu → Install → Editor → Helix. No remover.
- `omarchy-install-editor-vscode` — `visual-studio-code-bin` ~110 MB; writes `~/.vscode/argv.json` (gnome-libsecret), `~/.config/Code/User/settings.json` (`update.mode: none`), `omarchy-theme-set-vscode`, launches `code` — Menu → Install → Editor → VSCode. No remover.
- `omarchy-install-editor-zed` — `zed omazed` ~80 MB; `omazed setup`; launches `dev.zed.Zed` — Menu → Install → Editor → Zed. No remover.
- `omarchy-install-editor-emacs` — `omarchy-emacs` from AUR (~50 MB + build) then `omarchy-install-emacs`; launches `emacsclient` — Menu → Install → Editor → Emacs. No remover.
- Cursor, Sublime Text, Vim rows use the generic installers above.

**Terminals**
- `omarchy-install-terminal <alacritty|foot|ghostty|kitty>` — sudo via pkg-add; unknown name → `Unknown terminal: X` exit 1, no args → usage exit 1; copies custom `.desktop` for alacritty/foot, seeds `~/.config/<term>` from `$OMARCHY_PATH/config/<term>` when missing, writes `~/.config/xdg-terminals.list` with the chosen desktop id first; on pkg failure prints `Failed to install X` — Menu → Install → Terminal → {Alacritty ~3 MB, Foot (preinstalled → row `disabled` ✓), Ghostty ~5 MB, Kitty ~8 MB}. No remover.

**Dev environments / mise**
- `omarchy-install-dev-env <ruby|node|bun|deno|go|laravel|symfony|php|python|elixir|phoenix|rust|java|zig|ocaml|dotnet|clojure|scala>` — sudo only for php/laravel/symfony/ruby(libyaml)/clojure(rlwrap); no args → usage exit 1; **unknown name is silently accepted (exit 0, no `*)` branch)**; mise-backed: node ~30 MB, bun ~35 MB, deno ~40 MB, go ~70 MB, python ~40 MB + `curl astral.sh/uv | sh`, java ~200 MB, zig+zls ~60 MB, dotnet ~200 MB, clojure (+ rlwrap), scala (java+scala+scala-cli ~250 MB); ruby: `ruby.compile false`, `ruby@latest` + `gem install rails` (minutes); rust: `rustup` script ~200 MB; php: pacman `php composer php-sqlite xdebug` ~25 MB + `sudo sed` on `/etc/php/php.ini` and `xdebug.ini`, adds composer bin to `.bashrc` PATH; laravel: php + node + `composer global require laravel/installer`; symfony: php + `symfony-cli`; elixir/phoenix: erlang (**compiled from source by mise**) + elixir + hex/rebar/phx_new; ocaml: opam install script + `opam init` + lsp/odoc/format/utop (compiles) — Menu → Install → Development → {Ruby on Rails, Docker DB, JavaScript → {Node.js, Bun, Deno}, Go, PHP → {PHP, Laravel, Symfony}, Python, Elixir → {Elixir, Phoenix}, Zig, Rust, Java, .NET, OCaml, Clojure, Scala}; `disabled` conditions are `-d ~/.local/share/mise/installs/<tool>`, `-d ~/.rustup`, `-d ~/.opam`, `omarchy-pkg-present php|symfony-cli`, `-x ~/.config/composer/vendor/bin/laravel`, `compgen -G ~/.mix/archives/phx_new*`.
- `omarchy-remove-dev-env <same list>` — `mise uninstall X --all && mise rm -g X`; ruby also `rm ~/.gemrc`; python also removes `uv`/`uvx`; php `omarchy-pkg-drop php composer php-sqlite xdebug`; laravel `composer global remove`; rust `rustup self uninstall -y`; ocaml `opam switch remove` + `rm -rf ~/.opam` + `sudo rm /usr/local/bin/opam`; unknown → `Unknown environment: X` exit 1; ends `Done!` — Menu → Remove → Development → same tree, rows `when` the install marker exists.
- `omarchy-install-docker-dbs [names...]` — sudo (`sudo docker run -d --restart unless-stopped ...`); no args → `gum choose` over MySQL PostgreSQL Redis MongoDB MariaDB MSSQL; **Escape triggers `|| main_menu`, an undefined function → `main_menu: command not found` on stderr, then `No databases selected for installation.`**; images: redis:7 ~40 MB, postgres:18 ~150 MB, mariadb:11.8 ~120 MB, mysql:8.4 ~200 MB, mongo:noble ~300 MB, mssql 2022 ~500 MB; all bound to 127.0.0.1 — Menu → Install → Development → Docker DB.
- `omarchy-mise-install <package> [command-name [bin-name]]` — no sudo; no args → usage exit 1; command names containing `/`, leading `.`/`-`, or control chars → `'X' is not usable as a command name` exit 1 (checked before any `rm`); writes `~/.local/bin/<command>` stub: `export MISE_MINIMUM_RELEASE_AGE=0; mise use -g --quiet <pkg> || exit 1; exec mise x <pkg> -- <bin> "$@"`; the stub installs on first run — CLI-only; `install/user/mise.sh` provisions stubs for codex claude crush agy gh copilot opencode playwright pi omp grok cursor-agent ghui hunk hey basecamp cf ori muse (+ hermes via its own installer).
- `etc/mise/conf.d/omarchy.toml` — `tool_alias.cursor-agent` → `http:cursor-agent[bin_path=bin,postinstall=...]` so only the launcher is exposed.

**AI apps**
- `omarchy-install-ai-chatgpt` — sudo; `openai-codex-desktop` ~120 MB; launches `/usr/bin/chatgpt` — Menu → Install → AI → ChatGPT Desktop. Remover `omarchy-remove-ai-chatgpt`: drops pkg, `rm -rf ~/.config/Codex ~/.cache/Codex` (keeps Codex CLI state) — Menu → Remove → AI → ChatGPT Desktop.
- `omarchy-install-ai-claude` — `claude-desktop` ~110 MB; launches `/usr/bin/claude-desktop` — Menu → Install → AI → Claude Desktop. Remover `omarchy-remove-ai-claude`: `pkill -x claude-desktop`, drop, `rm -rf ~/.config/Claude ~/.cache/Claude` (keeps `~/.claude*`) — Remove → AI → Claude Desktop.
- `omarchy-install-ai-t3-code` — `t3code-bin` ~100 MB; renders/publishes the Omarchy palette (`omarchy-theme-refresh` if `t3code.json` is missing, `omarchy-theme-set-t3code`, `t3 theme set omarchy --base-dir ~/.t3`), launches `t3code` — Menu → Install → AI → T3 Code. Remover `omarchy-remove-ai-t3-code`: drop, `rm -rf ~/.config/t3code ~/.t3`, `rm ~/.config/t3code-flags.conf` — Remove → AI → T3 Code.
- `omarchy-install-ai-openclaw` — `openclaw` (~150 MB node package); `omarchy-webapp-install OpenClaw http://127.0.0.1:18789 <icon> omarchy-launch-openclaw`; runs `omarchy-openclaw-onboard` (interactive wizard) unless `~/.openclaw/openclaw.json` exists — Menu → Install → AI → OpenClaw. Remover `omarchy-remove-ai-openclaw`: stops/uninstalls `openclaw-gateway.service`/`openclaw-node.service` (aborts `Could not stop X; OpenClaw was not removed.` if it cannot), drop, removes `OpenClaw.desktop` + icon, then **asks (default No)** `Also delete ~/.openclaw (<size>: chats, memories, credentials, and downloaded plugins)?` only on a tty — Remove → AI → OpenClaw.
- `omarchy-install-openclaw-cli [--check|--now]` — `--check` = `omarchy-pkg-present openclaw`; `--now` (default) installs if missing; other → usage exit 1 — CLI-only (default-agent plumbing).
- `omarchy-install-ai-hermes` — refuses root; `hermes-desktop` package (large) then validates `/usr/share/hermes-desktop/install.sh` + `install-stamp.json` (`The installed Hermes package cannot prepare in-app updates. Run 'omarchy update'...` exit 1 otherwise); hands the CLI over (`omarchy-install-hermes-cli || true`); clones/pins the runtime under `~/.hermes/hermes-agent` via upstream `install.sh` (**minutes, hundreds of MB, builds a venv**); copies `/opt/hermes-desktop` to `.../apps/desktop/release/linux-unpacked`; launches `hermes-desktop`; `systemd-run --user omarchy-hermes-theme` — Menu → Install → AI → Hermes Desktop. Remover `omarchy-remove-ai-hermes`: refuses while any process holds `~/.hermes`, `~/.config/Hermes` or `/opt/hermes-desktop` (`Close Hermes and processes using its files before removing it (PIDs: ...)`), drop, stop theme unit, `omarchy-install-hermes-cli --remove`, removes runtime only if `.hermes-bootstrap-complete` exists, then **asks (default No)** `Also delete ~/.hermes and ~/.config/Hermes (<size>: ...)?` — Remove → AI → Hermes Desktop.
- `omarchy-install-hermes-cli [--check|--now|--owns|--remove]` — no sudo; `--owns` exit 0 iff `~/.local/bin/hermes` is a regular file containing the exact line `# Written by omarchy-install-hermes-cli.`; `--remove` tears down the mise tool `pipx:hermes-agent[extras=all]` + stub only when owned (idempotent), exit 1 with `Could not remove the Hermes CLI Omarchy installed. Finish by hand:` if anything survives; `--check` exit 0 only when Hermes is really installed **and** `hermes chat --help` defines `--tui` and `--query`; no flag = write the stub (never provisions); `--now` additionally runs `hermes --version` (installs Python 3.13 + uv + Hermes: **minutes, ~300 MB**). **Any other argument is treated like "no flag" and writes the stub.** Foreign `~/.local/bin/hermes` is never touched (`~/.local/bin/hermes exists but is not runnable, and it was not installed by Omarchy.` exit 1) — CLI-only; provisioning writes the stub on every fresh install.
- `omarchy-remove-ai-grok-bot` (`grok-bot`, keeps `~/.grok`), `omarchy-remove-ai-lm-studio` (`lmstudio-bin`, follows `~/.lmstudio-home-pointer` but refuses `/` and `$HOME`), `omarchy-remove-ai-ollama` (disables `ollama.service`, drops `ollama ollama-cuda ollama-rocm ollama-vulkan`, `sudo rm -rf /var/lib/ollama`, `rm -rf ~/.ollama`), `omarchy-remove-ai-perplexity` (drops `perplexity`, removes runtime caches, **asks default No** to delete logins/vault; skips the question when stdin or stderr is not a tty) — Menu → Remove → AI → {Grok Bot, LM Studio, Ollama, Perplexity}, each `when` the package is present. Their installers are the generic `omarchy-install-app`/`-and-launch` rows.

**Dictation (voxtype)**
- `omarchy-voxtype-install` — sudo; `gum confirm "Install Voxtype + AI model (~150MB) to enable dictation?"`; `omarchy-pkg-add wtype voxtype-bin` (~20 MB), copies `default/voxtype/config.toml`, `voxtype setup --download --no-post-install` (~150 MB model), `voxtype setup gpu --enable` only if `omarchy-hw-vulkan`, `voxtype setup systemd`, `hyprctl reload`, `omarchy-restart-shell`, notification `Voxtype Dictation Ready — Hold F9 to dictate (or toggle with Super + Ctrl + X).` — Menu → Install → AI → Dictation (`disabled` when `voxtype-bin` present); also offered once by the first-run invitation toast (`install/user/first-run/install-voxtype.hook`).
- `omarchy-voxtype-remove` — sudo; if `voxtype` present: disable `voxtype.service` (user), pkg-drop `voxtype-bin`, `rm -rf ~/.config/voxtype ~/.local/share/voxtype`, `hyprctl reload`; else prints `Voxtype was not installed.` exit 0 — Menu → Remove → AI → Dictation (`when` present).
- `omarchy-voxtype-status` — prints `{"alt": "", "class": "idle", "tooltip": ""}` and exits 0 when voxtype is missing; otherwise `exec voxtype status --follow --extended --format json` (bar feed) — CLI/bar only.
- `omarchy-voxtype-config` / `omarchy-voxtype-model` — Float running `voxtype configure` / `voxtype setup model`, then `omarchy-restart-shell` — CLI-only (bar plugin actions).
- Bindings (`default/hypr/bindings/voxtype.lua`): only when `voxtype` is on PATH — `Super+Ctrl+X` toggle, `F9` push-to-talk.

**Services**
- `omarchy-install-service-1password` — sudo; `1password 1password-cli` (~115 MB); if `chromium` present writes `/usr/share/chromium/extensions/aeblfdkhhhdcdjpifhhbdiojplfjncoa.json`; launches `1password`; ends `1Password has been installed. Restart Chromium to load the browser extension.` — Menu → Install → Service → 1Password; also `omarchy-launch-1password` (the app keybinding) runs this installer when 1Password is missing. Remover `omarchy-remove-service-1password` (removes the extension file, drops both pkgs) — **no Remove menu row**.
- `omarchy-install-service-dropbox` — `dropbox dropbox-cli libappindicator-gtk3 python-gpgme nautilus-dropbox` (~5 MB pkgs; `dropbox-cli start` then downloads the ~100 MB daemon into `~/.dropbox-dist`); `omarchy-plugin-enable omarchy.dropbox`; prints `See Dropbox icon behind  hover tray in top right and right-click for setup.` — Menu → Install → Service → Dropbox. Remover `omarchy-remove-service-dropbox` (`dropbox-cli stop`, plugin disable, drop all five) — Menu → Remove → Services → Dropbox. `omarchy-installed-service-dropbox` (hidden): exit 0 iff `dropbox-cli running` or a `dropbox` process exists.
- `omarchy-install-service-tailscale` — sudo; `tailscale` ~15 MB; `sudo systemctl enable --now tailscaled`; **`sudo tailscale up --accept-routes` prints a login URL and blocks until the browser login completes**; then `tailscale set --operator=$USER`, `systemctl --user enable --now omarchy-tailscale-receive.service`, `omarchy-plugin-enable omarchy.tailscale`, `omarchy-webapp-install Tailscale https://login.tailscale.com/admin/machines <icon>` — Menu → Install → Service → Tailscale. Remover `omarchy-remove-service-tailscale` (`tailscale down`, disable receive + tailscaled, plugin disable, webapp remove, drop) — Menu → Remove → Services → Tailscale. `omarchy-installed-service-tailscale` (hidden): exit 0 iff `tailscale status --json` works or `tailscaled` is active/running.
- `omarchy-tailscale-send <machine> [file...]` — no args → usage exit 1; no files → `omarchy-file-select --multiple` (cancel = exit 0; chooser failure = critical notification `Could not send to X — The file chooser did not open` exit 1); `tailscale file cp` → notification `Sent to <short-name>` / critical `Could not send to <short-name>` + error text, exit 1 — CLI (and share menu, other reviewer).
- `omarchy-tailscale-receive [--once] [directory]` — stages into `<dir>/.omarchy-taildrop`, claims names with `ln` (never overwrites; `-1`, `-2` suffixes), announces with an image preview or `󰒊` glyph and a click-to-open action; loops with 10 s retry unless `--once` (exit 1 when `tailscale file get` fails) — runs as the `omarchy-tailscale-receive.service` user unit.
- `omarchy-install-service-nordvpn` — sudo; `nordvpn-bin` ~30 MB; enables `nordvpnd`, adds user to `nordvpn` group, `gum confirm "Reboot now to make NordVPN usable?"` — Menu → Install → Service → NordVPN. No remover.
- `omarchy-install-service-once` — sudo; `once-bin` (~15 MB); enables `once-background.service`; runs `sudo once` TUI — Menu → Install → Service → ONCE. No remover.
- `omarchy-install-service-signal` (`signal-desktop` ~120 MB, launches) / `omarchy-install-service-spotify` (`spotify` ~120 MB, launches) — Menu → Install → Service → Signal / Spotify. No removers.
- `omarchy-install-service-sunshine` — sudo; `sunshine` ~30 MB; `systemctl --user enable --now sunshine`; ufw allows on TCP 47984 47989 48010 / UDP 5353 47998 47999 48000 48002 48010 from private CIDRs (+ `tailscale0` if present), `ufw reload`; web app `Sunshine Admin` → `https://localhost:47990 --ignore-certificate-errors`; appends `o.launch_on_start("sunshine")` to `~/.config/hypr/autostart.lua` — **CLI-only (no menu row)**. Remover `omarchy-remove-service-sunshine` reverts all of it — CLI-only.

**Gaming**
- `omarchy-install-gaming-gpu-lib32` — sudo; adds `lib32-vulkan-intel`/`lib32-vulkan-radeon` by `lspci` vendor match and `lib32-nvidia-utils`/`lib32-nvidia-580xx-utils` by `omarchy-hw-nvidia-*`; **when no vendor matches the final `(( n > 0 )) && ...` leaves exit status 1** — CLI-only; called by steam, heroic, lutris, battlenet (all `set -e`).
- `omarchy-install-gaming-steam` — `steam` (+ multilib deps ~300 MB) then gpu-lib32, `gtk-launch steam` (Steam then downloads its ~500 MB runtime) — Menu → Install → Gaming → Steam. Remover `omarchy-remove-gaming-steam` (drop + `rm -rf ~/.steam ~/.local/share/Steam ~/.config/steam ~/.cache/steam`) — Remove → Gaming → Steam.
- `omarchy-install-gaming-retroarch` — `retroarch` + 3 asset packs + ~45 libretro cores (**> 1 GB**); creates `~/Games/{bios,roms}`, writes `retroarch.cfg` keys (vulkan driver, xmb menu, crt-royale shader preset), opens `nautilus ~/Games` — Menu → Install → Gaming → RetroArch. Remover drops the same list, `rm -rf ~/.config/retroarch ~/.local/share/retroarch ~/.cache/retroarch`, keeps ROMs/BIOS — Remove → Gaming → RetroArch.
- `omarchy-install-gaming-lutris` — `lutris umu-launcher wine-staging wine-mono wine-gecko winetricks python-protobuf` (~600 MB) + gpu-lib32; `sudo sed` pins `/usr/bin/lutris` shebang to `/bin/python3`; launches lutris — Menu → Install → Gaming → Lutris. Remover drops all seven + wipes lutris/umu/wine caches — Remove → Gaming → Lutris.
- `omarchy-install-gaming-heroic` — `heroic-games-launcher-bin` (~120 MB) + gpu-lib32; `gtk-launch heroic` — Install → Gaming → Heroic (Epic Games). Remover drops + `rm -rf ~/.config/heroic ~/.local/share/heroic ~/.cache/heroic ~/Games/Heroic` — Remove → Gaming → Heroic.
- `omarchy-install-gaming-battlenet` — `umu-launcher` + gpu-lib32; detects a half-finished `~/Games/battlenet` prefix and `gum confirm "Wipe the partial prefix and start fresh?"`; downloads `Battle.net-Setup.exe` to `~/.cache/omarchy`, runs it detached under `umu-run` (GE-Proton download ~500 MB, log `/tmp/omarchy-battlenet-installer.log`); installs `~/.local/share/applications/battlenet.desktop` from `default/applications/` (battlenet-test.sh: not part of the default refresh) — Install → Gaming → Battle.net (`disabled` when `~/Games/battlenet` exists). Remover kills prefix processes, `rm -rf ~/Games/battlenet`, desktop file, cached installer; **asks** to also remove `umu-launcher` and GE-Proton runtimes — Remove → Gaming → Battle.net.
- `omarchy-install-gaming-geforce-now` — `flatpak` then `curl` `GeForceNOWSetup.bin` into `/tmp` and runs it (Flatpak runtime ~1 GB), then `omarchy-launch-browser` — Install → Gaming → NVIDIA GeForce NOW (`disabled` when `flatpak info com.nvidia.geforcenow`). Remover `flatpak uninstall -y --delete-data com.nvidia.geforcenow` — Remove → Gaming → NVIDIA GeForce NOW.
- `omarchy-install-gaming-xbox-cloud` — `omarchy-webapp-install "Xbox Cloud Gaming" https://www.xbox.com/en-US/play <jsdelivr icon>` (icon ~20 KB) then opens the web app — Install → Gaming → Xbox Cloud Gaming (`disabled` when the `.desktop` exists). Remover `omarchy-webapp-remove "Xbox Cloud Gaming"` — Remove → Gaming → Xbox Cloud Gaming.
- `omarchy-install-gaming-xbox-controllers` — sudo; `xpadneo-dkms` (~1 MB + DKMS build against `linux-omarchy-headers`, 1–3 min on 2 vCPU); writes `/etc/modprobe.d/blacklist-xpad.conf`, `/etc/modules-load.d/xpadneo.conf`; adds user to `input` (then `gum confirm "Reboot needed to finish setup. Reboot now?"` → `sudo reboot now` on Yes); otherwise `modprobe hid_xpadneo`; ends `Now you can pair your Xbox controller with Bluetooth using Super + Ctrl + B.` — Install → Gaming → Xbox Controllers. Remover drops pkg, removes both files, prints `Reboot to fully unload xpadneo and restore xpad.` — Remove → Gaming → Xbox Controllers (󰂯).
- `omarchy-remove-gaming-minecraft` — drops `minecraft-launcher`, `rm -rf ~/.minecraft ~/.config/Minecraft\ Launcher ~/.local/share/minecraft-launcher ~/.cache/minecraft` — Remove → Gaming → Minecraft (install is `omarchy-install-and-launch Minecraft minecraft-launcher minecraft-launcher`).

**Security removers (setup counterparts are another reviewer's scope)**
- `omarchy-remove-security-fido2` — sudo; strips `pam_u2f.so` from `/etc/pam.d/sudo` and `polkit-1`, `rm -rf /etc/fido2` (also a dangling symlink), `omarchy-pkg-drop libfido2 pam-u2f` — Menu → Remove → Security → Fido2 (`when: omarchy-pkg-present pam-u2f`).
- `omarchy-remove-security-fingerprint` — strips `pam_fprintd.so` + `omarchy-hw-laptop-closed` gate lines, removes `/etc/pam.d/omarchy-lock-fingerprint`, drops `fprintd libfprint libfprint-git` — Remove → Security → Fingerprint (`when: fprintd present`).
- `omarchy-remove-security-sshd` — `systemctl disable --now sshd`, `ufw --force delete limit 22/tcp`, `ufw reload`; if `~/.ssh/authorized_keys` is non-empty `gum confirm "Also remove all authorized SSH keys ...?"`; ends `The openssh package remains installed since it also provides the ssh client.` — Remove → Security → SSHD (`when: systemctl is-enabled --quiet sshd`).
- `omarchy-remove-security-sudoless-docker` — if `omarchy-sudo-docker --configured` (user not in `docker` group) prints `Sudoless Docker is not enabled: <user> is not in the docker group.` exit 0; else `gpasswd -d`, `omarchy-state set reboot-required`, `gum confirm "Reboot now to apply?"` — Remove → Security → Sudoless Docker (`when: ! omarchy-sudo-docker --configured`).

**Launcher uninstall**
- `omarchy-remove-launcher-entry <desktop-id> <name>` — hidden; resolves the `.desktop` in user then XDG dirs (`Could not find launcher entry: X.desktop` exit 1; no args → usage); web app `Exec` → `omarchy-webapp-remove`; TUI `Exec` (`$TERMINAL`/`xdg-terminal-exec ... -e`) → `omarchy-tui-remove`; user-dir file → `rm` + `update-desktop-database`; pacman-owned → Float `Uninstalling <name>...; sudo pacman -Rns <pkg>`; flatpak id → Float `flatpak uninstall <id>`; else `Don't know how to uninstall X.desktop` exit 1 — reached from the **Apps menu: highlight an app and press `Delete`** → dialog `Do you want to uninstall <name>?` with `Uninstall` button (`Menu.qml` 789–812, 1129, 1173).

**Reinstall**
- `omarchy-reinstall` — sudo; prints `This will reinstall all default Omarchy packages and reset default configs. Warning: user config changes will be overwritten.`; `gum confirm "Are you sure you want to reinstall and lose config changes?"` → `omarchy-reinstall-pkgs` then `omarchy-reinstall-configs` then `gum confirm "System has been reinstalled. Reboot?"` — CLI-only.
- `omarchy-reinstall-pkgs` — sudo; `omarchy-refresh-pacman` (stable mirrors), `omarchy-update-pacman -Suu --noconfirm` (downgrade to stable), then `-Syu --noconfirm --needed <every line of omarchy-base.packages>` — full system upgrade/downgrade, hundreds of MB — CLI-only.
- `omarchy-reinstall-configs` — refuses root (`Error: This script should not be run as root` exit 1); `cp -af /etc/skel/. ~/` (replays every shipped dotfile, does not delete extras), `omarchy-refresh-limine`, `omarchy-refresh-plymouth` (both sudo), `omarchy-nvim-refresh` or `omarchy-nvim-setup --force` — CLI-only.

**Windows VM**
- `omarchy-windows-vm <install|remove|launch [-k|--keep-alive]|stop|status|help>` (aliases `start`, `down`; `""`/`-h`/`--help` → usage; unknown → `Unknown command: X` + usage on stderr, exit 1). `install`: creates `~/.windows` and `~/Windows` (0700), `check_prerequisites` (no `/dev/kvm` → boxed `❌ KVM virtualization not available!`; then `df` on `~/.windows` must have ≥ 74 GB free for the default 64 G disk → `❌ Insufficient disk space! Available: NGB Required: 74GB (64GB disk + 10GB for Windows image)` exit 1), only then `omarchy-pkg-add freerdp openbsd-netcat gum`, writes `~/.local/share/applications/windows-vm.desktop`, `gum choose` RAM (2G..64G ≤ total, default 4G), `gum input` cores (default 2), `gum choose` disk (32G..512G, default 64G), username (default `docker`), password (default `admin`, hidden), boxed summary, `gum confirm "Proceed with this configuration?"`, root-owned compose via pkexec (`/var/lib/omarchy/windows/docker-compose.yml`), `~/.config/windows/credentials` 0600, `docker compose up`, `xdg-open http://127.0.0.1:8006`; Ctrl+C anywhere prints `Installation cancelled by user`. `launch`: `Windows VM not configured. Please run: omarchy-windows-vm install` exit 1 when unconfigured; otherwise starts the container (polkit prompt unless sudoless Docker), boxed `Connecting to Windows VM`, `xfreerdp3 /args-from:stdin` with title `Windows VM - Omarchy`, stops the VM when RDP closes unless `-k`. `stop`: `Windows VM not configured.` exit 1 / `Windows VM stopped.` `status`: `Windows VM not configured. / To set up: omarchy-windows-vm install` exit 1, `Windows VM container not found.`, boxed `Windows VM Status: RUNNING`, or `Windows VM is stopped (status: X)`. `remove`: `gum confirm --default=false "Remove Windows VM and delete all associated data?"` (No → `Removal cancelled by user` exit 1), privileged removal, `rm -rf ~/.config/windows ~/.windows`, desktop file — Menu → Install → Windows (`disabled` when `windows-vm.desktop` exists) / Menu → Remove → Windows (`when` it exists). The launcher entry `Windows` runs `uwsm app -- omarchy-windows-vm launch`.
- `omarchy-windows-key` — reads `/sys/firmware/acpi/tables/MSDM` (sudo if unreadable); `No Windows license key found in firmware.` exit 1 when absent; `Firmware license table found, but no Windows product key could be extracted.` exit 1; else prints `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` — CLI-only.

**Package lists, pacman defaults, hooks**
- `install/omarchy-base.packages` (146 packages) — what the ISO pacstraps; notable preinstalls that the Install menu marks `disabled`: `foot`, `chromium`, `docker docker-buildx docker-compose lazydocker`, `mise-bin`, `gum`, `fzf`, `yay`, `wtype`, `ttf-jetbrains-mono-nerd-basic`, the 13 "preinstalls" (aether cliamp libreoffice-fresh xournalpp pinta obsidian obs-studio kdenlive moonlight-qt lazydocker omacut omacalc omawrite; preinstalls-test.sh asserts both preinstalls scripts track this file), `ruby`, `dotnet-runtime`, `nvim`/`omarchy-nvim`, `tmux`, `ufw ufw-docker`.
- `install/omarchy-other.packages` — hardware/driver set the ISO must carry (kernels `linux-omarchy(-headers)`, nvidia variants, lib32-nvidia, pipewire stack, limine, snapper, vulkan drivers, laptop quirks); nothing user-triggered, but `linux-omarchy-headers` is what makes `xpadneo-dkms` buildable.
- `default/pacman/pacman-{stable,rc,edge}.conf` — identical `[options]` (`Color ILoveCandy VerbosePkgLists HoldPkg=pacman glibc CheckSpace ParallelDownloads=5 DownloadUser=alpm SigLevel=Required DatabaseOptional`), `[core] [extra] [multilib]` via `/etc/pacman.d/mirrorlist`, `[omarchy] Server=https://pkgs.omarchy.org/{stable,rc,edge}/$arch`; edge also carries commented `*-debug` repos. `mirrorlist-{stable,rc,edge}` → `https://{stable-mirror,rc-mirror,mirror}.omarchy.org/$repo/os/$arch`. Selected by `omarchy-channel-set` (other reviewer).
- `default/libalpm/hooks/00-omarchy-update-guard.hook` — PreTransaction on any `Upgrade`, `AbortOnFail`, runs `omarchy-update-pacman-guard`: when the parent pacman command line has both `-S` and `-u` (a `pacman -Syu`) and neither `OMARCHY_UPDATE_PACMAN=1` nor `OMARCHY_ALLOW_DIRECT_PACMAN=1` is set, prints the `Woah partner...` message and aborts the transaction (bypass: `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`). Plain `pacman -S pkg` (what pkg-add runs) passes.
- `10-omarchy-hyprland-reload-pause.hook` / `90-omarchy-hyprland-reload-resume.hook` — pause/resume Hyprland config auto-reload around installs/upgrades of `omarchy-settings(-dev)`.

**Menu structure (`default/omarchy/omarchy-menu.jsonc`, Install/Remove)**
- **Install**: Package, AUR, AI {ChatGPT Desktop, Claude Desktop, Dictation, Grok Bot, Hermes Desktop, LM Studio, Ollama, OpenClaw, Perplexity, T3 Code}, Service {1Password, Dropbox, Spotify, Signal, Tailscale, NordVPN, ONCE, Bitwarden, Chromium Account*}, Development {Ruby on Rails, Docker DB, JavaScript {Node.js, Bun, Deno}, Go, PHP {PHP, Laravel, Symfony}, Python, Elixir {Elixir, Phoenix}, Zig, Rust, Java, .NET, OCaml, Clojure, Scala}, Editor {VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs}, Style {Theme, Background, Font {6 fonts}}, Gaming {Steam, RetroArch, Minecraft, NVIDIA GeForce NOW, Xbox Cloud Gaming, Xbox Controllers, Battle.net, Lutris, Heroic (Epic Games), RetroArch Game Launcher}, Browser {Chrome, Edge, Brave, Brave Origin, Firefox, Zen}, Web App, Terminal {Alacritty, Foot, Ghostty, Kitty}, TUI, Windows, Preinstalls. Rows with `disabled` stay listed but dim with ✓ once installed. (*Chromium Account is `when` `~/.config/chromium-flags.conf` exists.)
- **Remove**: Package, AI {Hermes Desktop, ChatGPT Desktop, Claude Desktop, Dictation, Grok Bot, LM Studio, Ollama, OpenClaw, Perplexity, T3 Code}, Services {Dropbox, Tailscale}, Development {Ruby on Rails, JavaScript {Node.js, Bun, Deno}, Go, PHP {PHP, Laravel, Symfony}, Python, Elixir {Elixir, Phoenix}, Zig, Rust, Java, .NET, OCaml, Clojure, Scala}, Theme, Gaming {Steam, RetroArch, Minecraft, NVIDIA GeForce NOW, Xbox Cloud Gaming, Xbox Controllers (󰂯), Battle.net, Lutris, Heroic (Epic Games)}, Browser {Chrome, Edge, Brave, Brave Origin, Firefox, Zen}, Web App, TUI, Windows, Preinstalls, Security {Fingerprint, Fido2, SSHD, Sudoless Docker}. Leaf rows use `when`, so on a pristine disk AI, Services, Gaming, Browser and Security submenus are empty and Development shows only the JavaScript/PHP/Elixir sub-headers.

## Observations

1. **Hotkeys at HEAD**: `Super+Space` = Omarchy Menu root, `Super+Alt+Space` = Apps, `Super+Escape` = System submenu (`default/hypr/bindings/utilities.lua`). The minted 4.0.2 disk should match, but the driver should fall back to `omarchy-menu toggle install`, `omarchy-menu toggle remove`, `omarchy-menu toggle apps` typed into a terminal if a hotkey lands elsewhere. Menu rows can be filtered by typing; `Backspace` with an empty filter goes up a level.
2. **Every menu installer runs in the Float terminal** and ends with `● Done! Press any key to close...` or `● Failed (exit code N)! Press any key to close...`. The driver must press a key to close it. `sudo` prompts appear inside that terminal; answer `prime`. Ctrl+C (exit 130) closes the window without the Done/Failed prompt.
3. **`disabled` vs `when`**: Install rows go dim with a ✓ when the software is present (still listed); Remove rows disappear entirely when it is absent. So the "before" and "after" screenshots of an install/remove pair should show the Install row flipping dim↔enabled and the Remove row appearing↔vanishing.
4. **Small enough for the VM (NET, well under 5 min)**: any Nerd font except Iosevka (2–10 MB), `vim` (~10 MB), `helix` (~20 MB), `kitty`/`alacritty`/`ghostty` (3–8 MB), `sublime-text-4` (~20 MB), `tailscale` (~15 MB), `xpadneo-dkms` (tiny + DKMS build), the Xbox Cloud web app (icon only), `php`+composer (~25 MB), mise `node`/`bun`/`deno`/`python`/`zig` (30–60 MB), a `redis:7` docker image (~40 MB), `cowsay`/`sl` for the pkg primitives (KBs), `firefox` (~75 MB, borderline), `ollama` (~30–50 MB). **Medium (1–3 min, still feasible)**: 1Password (~115 MB), Claude Desktop / T3 Code / Signal / Spotify / VSCode / Bitwarden (~100–120 MB), Voxtype + model (~170 MB), `go` (~70 MB), `rust` (~200 MB). **Too big or too slow**: Steam (+runtime), RetroArch (>1 GB), Lutris (~600 MB), Heroic, Battle.net (GE-Proton ~500 MB), GeForce NOW (Flatpak runtime ~1 GB), LM Studio (~400 MB), Hermes Desktop (clones + builds a venv), OpenClaw (interactive onboarding), Elixir/Phoenix (erlang compiled from source), OCaml (opam compiles), Java/.NET/Scala (~200 MB+), Cursor (~150 MB), Chrome/Edge/Brave/Zen (AUR builds of 100–170 MB binaries), `omarchy-install-preinstalls` (~700 MB), `omarchy-reinstall-pkgs` (full sysupgrade), Windows VM install (Windows 11 image).
5. **`omarchy-install-gaming-gpu-lib32` exits 1 on a machine with no Intel/AMD/NVIDIA GPU** (the virtio VGA in the guest): the last line is `(( ${#PACKAGES[@]} > 0 )) && omarchy-pkg-add ...` under `set -e`, whose false left side is the script's exit status. Steam, Heroic, Lutris and Battle.net all call it under their own `set -e` **after** installing their packages and **before** launching the app, so in the VM they will end `Failed (exit code 1)` with the package installed but the app never launched. Real hardware with an unrecognised GPU vendor hits the same path.
6. **Tailscale install blocks at `sudo tailscale up`**: with no way to complete the browser login in the guest, the installer prints `To authenticate, visit: https://login.tailscale.com/a/...` and waits forever. From the menu, Ctrl+C kills the whole Float (exit 130 → no prompt), so `tailscale set --operator`, the receive service, the bar plugin and the Tailscale web app are never set up — a half-installed state the Remove row still handles (`tailscale` is present). Run it from a normal terminal to observe the URL and abort deliberately.
7. **`omarchy-install-docker-dbs` on Escape prints `main_menu: command not found`** — `|| main_menu` refers to a function that does not exist in this script (leftover from the old monolithic menu). It then continues to `No databases selected for installation.` and exits 0. Docker itself is socket-activated and root-only by default (`omarchy-sudo-docker`), so `sudo docker run` prompts for the password.
8. **`omarchy-install-dev-env <unknown>` succeeds silently** (no `*)` branch; exit 0, nothing printed), whereas `omarchy-remove-dev-env <unknown>` prints `Unknown environment: X` exit 1. `omarchy-install-hermes-cli <unknown-flag>` likewise falls through to "write the stub".
9. **Windows VM in the guest is prerequisite-blocked by design**: 40 GB disk → `❌ Insufficient disk space! Required: 74GB` (or the KVM box first if nested KVM is off). It exits **before** installing `freerdp` or writing the desktop file, but **after** creating `~/.windows` and `~/Windows` (0700). `status`/`launch`/`stop` all report "not configured" with exit 1 on a fresh disk. `omarchy-windows-key` fails cleanly in QEMU (no MSDM table).
10. **Voxtype without audio hardware**: install succeeds (package + model download), `voxtype setup gpu` is skipped (no Vulkan), the systemd user unit starts, and the bar gets the dictation widget; pressing `F9` / `Super+Ctrl+X` should surface a "no input device"-style error rather than a crash. Only the software path is testable.
11. **Removers ask destructive questions with `--default=false`** (OpenClaw `~/.openclaw`, Perplexity logins, Hermes `~/.hermes`, Battle.net umu/GE-Proton, sshd authorized keys) and skip the question entirely when there is no tty — so from a Float they are asked; from a script they keep data.
12. **`omarchy-remove-security-fido2` on a stock disk** may hit a pacman dependency error: `openssh` depends on `libfido2`, so `pacman -Rns libfido2` fails with `removing libfido2 breaks dependency 'libfido2' required by openssh` and `set -e` aborts before the green success line. The menu row is hidden (no `pam-u2f`), so this is CLI-only exposure. Worth confirming in the guest.
13. **Menus with no Remove counterpart**: 1Password, Sunshine (also no Install row), Signal, Spotify, NordVPN, ONCE, Bitwarden, all four terminals, Helix/VSCode/Zed/Emacs/Cursor/Sublime — the only uninstall path is the Apps menu `Delete` key (pacman-owned → `sudo pacman -Rns`) or `omarchy-pkg-drop`, which leaves their `~/.config` behind.
14. **Preinstalls**: Remove is fast and offline (pkg-drop + launcher cleanup); Install is a ~700 MB reinstall. After Remove, the Apps menu loses every stock web app (Basecamp, Discord, HEY, WhatsApp, X, YouTube, Zoom, Google *) and TUI, `~/.local/bin/{claude,gh,codex,...}` stubs vanish, Install → Preinstalls becomes enabled and Remove → Preinstalls disappears.
15. **pkg primitives are exact-name**: `omarchy-pkg-present` uses `pacman -Q`, so a provider (e.g. `omarchy-pkg-present vi` when `vi` is a real package but `nvim` provides vim) behaves by installed name only; `omarchy-pkg-drop` ignores providers and duplicate arguments (pkg-drop-test.sh).
16. **First-run agent stubs**: on a fresh disk `~/.local/bin/{codex,claude,crush,agy,gh,copilot,opencode,playwright,pi,omp,grok,cursor-agent,ghui,hunk,hey,basecamp,cf,ori,muse,hermes}` are 4-line wrappers; running any of them for the first time downloads the tool (node + npm package, ~30–100 MB). `omarchy-install-hermes-cli --owns` exits 0 and `--check` exits 1 (stub is "cold") on a pristine disk.
17. **Direct `pacman -Syu` is guarded by a libalpm hook**, but the hook runs *after* pacman has downloaded the upgrade set, so testing it end-to-end on a 4.0.2 disk is a large download; `OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard` reproduces the message offline.
18. **Electron/GUI apps render fine without 3D** (virtio-vga, software GL) but are slow to first paint; give them up to 5 s between screenshots. `gtk-launch <id>` in `omarchy-install-and-launch` needs the `.desktop` id exactly (`sublime_text`, `cursor`, `bitwarden`, `perplexity`, `grok-bot`, `minecraft-launcher`).
19. The Apps-menu `Delete` uninstall dialog defaults its selection to the safe option (`deleteConfirm.selectedIndex = 1`); the driver must click/select `Uninstall` explicitly. A pacman-owned entry opens a Float that asks for the sudo password.
20. State hygiene: fonts (`omarchy-install-font`) change every terminal's font and restart the shell — later screenshots in the same session look different. `omarchy-reinstall-configs` overwrites `~/.bashrc` and friends. Both are fine on a pristine per-test disk but must be the last thing a test does if it also verifies unrelated UI.

## Proposed tests

Every step below is a hotkey/typed text (`send-keys`), a click (`mouse …`), a look (`get-image`), or a
`… | sudo tee /dev/ttyS0` read back with `get-serial`. Nothing touches the host. "Menu" = Omarchy Menu
(`Super+Space`; fallback `omarchy-menu toggle <route>` typed in a terminal). "Apps" = the launcher
(`Super+Alt+Space`). "Float" = the floating terminal menu installers open; it ends with
`● Done! Press any key to close...` or `● Failed (exit code N)! Press any key to close...`.

### pkg-add-drop-cli-round-trip   [VM-OK] [NET]
description: From a terminal a user installs a missing package with `omarchy-pkg-add`, is refused for a typo, and removes it again with `omarchy-pkg-drop`, which ignores names that are not installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-pkg-add cowsay` then Enter.
  ** A sudo prompt appears in the terminal; type `prime` and Enter. pacman installs cowsay (~20 KB) with no red `Error:` line.
  * Type `cowsay hi` — an ASCII cow says hi (the package is really installed).
  * Type `omarchy-pkg-add omarchy-not-a-real-pkg-xyz; echo rc=$?` — pacman prints `error: target not found: omarchy-not-a-real-pkg-xyz` and the last line is `rc=1`.
  * Type `omarchy-pkg-add cowsay; echo rc=$?` — nothing is downloaded (already installed), `rc=0`.
  * Type `omarchy-pkg-drop cowsay omarchy-not-a-real-pkg-xyz; echo rc=$?` — pacman removes cowsay only; the unknown name is ignored; `rc=0`.
  * Type `omarchy-pkg-drop cowsay; echo rc=$?` — no pacman output, no sudo prompt, `rc=0`; then `cowsay hi` prints `command not found` (the machine is back as it started).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If no sudo prompt appears, passwordless sudo is on; that is fine.
  * Read the echoed `rc=` lines, not pacman's colored progress.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the cow; `target not found` followed by `rc=1`; `rc=0` for the no-op add; the removal transaction; the final `command not found`.
  * If unsuccessful
  ** The terminal showing a red `Error: Package ... did not install`, an `rc=0` after the typo, or a sudo prompt on the no-op drop.
covers: bin/omarchy-pkg-add, bin/omarchy-pkg-drop, test/shell.d/pkg-drop-test.sh

### pkg-missing-present-exit-codes   [VM-OK]
description: The probe helpers the menu uses to decide dim/hidden rows (`omarchy-pkg-present`/`-missing`, `omarchy-cmd-present`/`-missing`) return the documented exit codes for present, missing and mixed lists.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-pkg-present bash; echo $?` — `0`. Type `omarchy-pkg-present bash omarchy-not-real; echo $?` — `1`.
  * Type `omarchy-pkg-missing bash; echo $?` — `1`. Type `omarchy-pkg-missing bash omarchy-not-real; echo $?` — `0`.
  * Type `omarchy-cmd-present bash ls; echo $?` — `0`. Type `omarchy-cmd-present bash nosuchcmd; echo $?` — `1`.
  * Type `omarchy-cmd-missing nosuchcmd; echo $?` — `0`. Type `omarchy-cmd-missing bash; echo $?` — `1`.
  * Type `cd /tmp && omarchy-cmd-terminal-cwd` — prints `/tmp` (the "open terminal here" helper follows the shell).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The helpers print nothing themselves; only the echoed code is visible, so one screenshot per pair is enough.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot(s) showing `0 1 1 0 0 1 0 1` in that order and `/tmp`.
  * If unsuccessful
  ** The screenshot with the mismatching code.
covers: bin/omarchy-pkg-missing, bin/omarchy-pkg-present, bin/omarchy-cmd-missing, bin/omarchy-cmd-present, bin/omarchy-cmd-terminal-cwd

### pkg-install-remove-tui-round-trip   [VM-OK] [NET]
description: Install → Package and Remove → Package are fuzzy-finder pickers: Escape cancels cleanly, a selection installs the package, and the red-pointer remover takes it away again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu with Super+Space, select `Install`, then `Package` using the mouse.
  ** A terminal opens with an fzf list of package names, a preview pane and the footer `alt-p: toggle description, alt-j/k: scroll, tab: multi-select`.
  * Press Escape — the terminal closes and nothing was installed.
  * Menu → Install → Package again; type `sl`, move with the arrow keys to the exact entry `sl` (preview `Name : sl`), press Enter.
  ** A sudo prompt appears in the same terminal; type `prime`, Enter. pacman installs `sl` (~15 KB), then `● Done! Press any key to close...`. Press a key.
  * Menu → Remove → Package — an fzf list of installed packages with a red pointer and a `yay -Qi` preview. Press Escape; nothing is removed.
  * Menu → Remove → Package again; type `sl`, select the exact entry `sl`, Enter; sudo `prime`; pacman removes it; `Done!`; press a key.
  * Open a terminal (Super+Enter) and type `sl --help` — `command not found` (round trip complete).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fzf filters as you type; click into the terminal first if it does not.
  * Select nothing but `sl` in the remove picker — the list contains system packages.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both pickers, the desktop after each Escape, the `Done!` prompt after install and after remove, and the final `command not found`.
  * If unsuccessful
  ** The picker terminal's `Failed (exit code N)!` text or a leftover/orphaned terminal window.
covers: bin/omarchy-pkg-install, bin/omarchy-pkg-remove, bin/omarchy-show-done, default/omarchy/omarchy-menu.jsonc (install.package, remove.package)

### pkg-aur-install-tui-and-accessibility   [VM-OK] [NET]
description: Install → AUR fetches the AUR package list into a picker with a PKGBUILD preview and Escape cancels it; `omarchy-pkg-aur-accessible` confirms the AUR is reachable from the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-pkg-aur-accessible; echo rc=$?` — `rc=0`.
  * Open the Menu (Super+Space) → `Install` → `AUR`.
  ** yay downloads the AUR list (~10 MB, up to 60 s); an fzf list appears with footer `alt-p: toggle description, alt-b/B: toggle PKGBUILD, alt-j/k: scroll, tab: multi-select`.
  * Type `yay`, arrow to `yay-bin`, press Alt+b — the preview shows PKGBUILD text; press Alt+B — it shows package info again.
  * Press Escape — the terminal closes with nothing installed.
  * Back in the terminal type `omarchy-pkg-aur-add omarchy-not-a-real-pkg-xyz; echo rc=$?` — yay cannot find it; `rc=1` (or the red `Error: Package ... did not install`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never press Enter on an AUR entry here; an AUR build on 2 vCPUs can exceed the session budget.
  * yay may take up to 30 s on the negative call; keep screenshotting rather than typing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `rc=0`; the AUR picker; the PKGBUILD preview; the desktop after Escape; the rejected name with `rc=1`.
  * If unsuccessful
  ** yay's network error text or an `rc=0` for the bogus package.
covers: bin/omarchy-pkg-aur-install, bin/omarchy-pkg-aur-accessible, bin/omarchy-pkg-aur-add, default/omarchy/omarchy-menu.jsonc (install.aur)

### pacman-direct-upgrade-guard   [VM-OK]
description: Omarchy's pacman hook refuses a bare `pacman -Syu` with the "Woah partner" message while plain package installs pass; the guard is exercised directly so no upgrade set is downloaded.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `ls /usr/share/libalpm/hooks /etc/pacman.d/hooks 2>/dev/null | grep omarchy` — the three `*-omarchy-*.hook` files (update-guard, hyprland-reload-pause, hyprland-reload-resume) are listed.
  * Type `OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard; echo rc=$?` — the `Woah partner...` message ending with `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, then `rc=1`.
  * Type `OMARCHY_PACMAN_CMDLINE="pacman -S cowsay" omarchy-update-pacman-guard; echo rc=$?` — silent, `rc=0`.
  * Type `OMARCHY_ALLOW_DIRECT_PACMAN=1 OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard; echo rc=$?` — silent, `rc=0`.
  * Type `sudo pacman -Syu` (password `prime`); at `:: Proceed with installation? [Y/n]` type `n` and Enter (or accept `there is nothing to do`).
  ** Do not confirm the upgrade — the real hook only fires inside a confirmed transaction after a large download.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The message is long; scroll the terminal or pipe with `| sudo tee /dev/ttyS0` and read it with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three hook files; the `Woah partner` text with `rc=1`; two silent `rc=0` runs; pacman's prompt answered `n`.
  * If unsuccessful
  ** The guard's output for the mismatching case.
covers: default/libalpm/hooks/00-omarchy-update-guard.hook, default/libalpm/hooks/10-omarchy-hyprland-reload-pause.hook, default/libalpm/hooks/90-omarchy-hyprland-reload-resume.hook, bin/omarchy-update-pacman-guard

### install-font-cascadia-menu   [VM-OK] [NET]
description: Install → Style → Font installs a Nerd Font and switches every terminal and the shell to it on the spot; the CLI refuses a call without arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter), type `echo The quick brown fox 0O1lI` and leave it open at one side of the screen.
  * Open the Menu (Super+Space) → `Install` → `Style` → `Font` → `Cascadia Mono` using the mouse.
  ** Float: logo, `Installing Cascadia Mono...`, sudo prompt (`prime`), pacman installs `ttf-cascadia-mono-nerd` (~3 MB), a 2 s pause, the bar flickers as the shell restarts, `Done!`. Press a key.
  * Look at the terminal left open: the same text now renders in a different typeface (rounder Cascadia letters).
  * In that terminal type `fc-list | grep -ci caskaydia` — a number ≥ 1.
  * Type `omarchy-install-font; echo rc=$?` — `Usage: omarchy-install-font <display-name> <package> <family>` and `rc=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare a before/after screenshot of the same terminal line; the bar and menu font change too.
  * This changes the font for the rest of the session; fine on a per-test disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots of the identical terminal text in two typefaces; `Done!` in the Float; the fc-list count; the usage line with `rc=1`.
  * If unsuccessful
  ** The Float's `Failed (exit code N)!` text or `Font 'CaskaydiaMono Nerd Font' not found.`
covers: bin/omarchy-install-font, bin/omarchy-font-set, default/omarchy/omarchy-menu.jsonc (install.style.font.*)

### install-editor-vim-menu-and-launcher-uninstall   [VM-OK] [NET]
description: Installing Vim from the menu makes it appear in the Apps launcher and dims its Install row; pressing Delete on it in the launcher uninstalls it and restores both.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Editor` with the mouse; the `Vim` row is normal (not dim, no ✓). Click `Vim`.
  ** Float: `Installing Vim...`, sudo `prime`, pacman installs `vim` (~10 MB), `Done!`. Press a key.
  * Menu → Install → Editor again: `Vim` is dim with a ✓; pressing Enter on it does nothing. Escape.
  * Open Apps (Super+Alt+Space), type `vim` — an entry named exactly `Vim` is listed (nvim also matches; ignore it). Escape.
  * Apps again, type `vim`, highlight `Vim`, press Delete — a dialog `Do you want to uninstall Vim?` with an `Uninstall` button appears. Click `Uninstall` with the mouse.
  ** Float: `Uninstalling Vim...`, sudo `prime`, pacman removes vim, `Done!`. Press a key.
  * Apps → `vim` → no `Vim` entry. Menu → Install → Editor → `Vim` enabled again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The uninstall dialog preselects the safe option; click `Uninstall` explicitly.
  * ./client-with-image after each menu click saves a round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: enabled row → `Installing Vim...` → `Done!`; dim ✓ row; `Vim` in Apps; the uninstall dialog; `Uninstalling Vim...`; Apps without Vim; enabled row again.
  * If unsuccessful
  ** The Float's `Failed` text, or a launcher/menu state that did not change.
covers: bin/omarchy-install-app, bin/omarchy-remove-launcher-entry, default/omarchy/omarchy-menu.jsonc (install.editor.vim), shell/plugins/menu/Menu.qml (Delete-key uninstall)

### install-app-usage-and-failure-banner   [VM-OK]
description: The generic installers refuse missing arguments, and a bad package name surfaces as the red `Failed (exit code 1)` banner in the floating terminal rather than a silent close.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter).
  * Type `omarchy-install-app; echo rc=$?` — `Usage: omarchy-install-app <display-name> <packages>`, `rc=1`.
  * Type `omarchy-install-and-launch Foo; echo rc=$?` — `Usage: omarchy-install-and-launch <display-name> <packages> <desktop-id>`, `rc=1`.
  * Type `omarchy-install-app Bogus omarchy-not-a-real-pkg-xyz` — a Float opens: `Installing Bogus...`, sudo `prime`, `error: target not found: omarchy-not-a-real-pkg-xyz`, then red `● Failed (exit code 1)! Press any key to close...`. Press a key.
  * Type `omarchy-install-and-launch Bogus omarchy-not-a-real-pkg-xyz bogus` — the same red banner, and no application window opens afterwards.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Float appears centered over the terminal; the terminal stays behind it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both usage lines with `rc=1`; the Float with `target not found` and the red `Failed (exit code 1)!` banner, twice; no stray window.
  * If unsuccessful
  ** A Float that closed without a banner, or `Done!` after a failed install.
covers: bin/omarchy-install-app, bin/omarchy-install-and-launch, bin/omarchy-launch-floating-terminal-with-presentation, bin/omarchy-show-done

### install-editor-helix-cli-and-cleanup   [VM-OK] [NET]
description: `omarchy-install-editor-helix` installs Helix wired to the live Omarchy theme with an `hx` alias, is idempotent, and — having no remover — is cleaned up with `omarchy-pkg-drop`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-install-editor-helix` — `Installing Helix...`, sudo `prime`, pacman installs `helix` (~20 MB).
  * Type `cat ~/.config/helix/config.toml; ls -l ~/.config/helix/themes/omarchy.toml; grep 'alias hx' ~/.bashrc` — `theme = "omarchy"`, a symlink into `~/.local/state/omarchy/current/theme/helix.toml`, and `alias hx="helix"`.
  * Open a new terminal (Super+Enter) and type `hx --version` — `helix 2x.yy`.
  * Open Apps (Super+Alt+Space), type `helix` — a `Helix` entry is listed. Escape. Menu → Install → Editor: `Helix` dim ✓.
  * In the terminal type `omarchy-install-editor-helix; grep -c 'alias hx' ~/.bashrc` — no reinstall, and the count is `1` (no duplicate alias).
  * Type `omarchy-pkg-drop helix; hx --version` — pacman removes helix; `command not found`; `ls ~/.config/helix` still lists the config (documented leftover).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hx` only exists in a shell opened after the install; the first terminal will not know it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three config checks; `hx --version`; the launcher entry and dim row; `1` from grep -c; `command not found` after the drop.
  * If unsuccessful
  ** The failing check's output or a duplicated alias line.
covers: bin/omarchy-install-editor-helix, bin/omarchy-pkg-drop, default/omarchy/omarchy-menu.jsonc (install.editor.helix)

### install-terminal-kitty-and-reject-unknown   [VM-OK] [NET]
description: Install → Terminal installs an approved terminal and makes it what Super+Enter opens; unknown names are refused and the stock terminal can be restored the same way.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `echo $TERM` — `foot` on a stock disk.
  * Type `omarchy-install-terminal wezterm; echo rc=$?` — `Unknown terminal: wezterm`, `rc=1`; type `omarchy-install-terminal; echo rc=$?` — the usage line, `rc=1`.
  * Open the Menu (Super+Space) → `Install` → `Terminal`: `Foot` is dim ✓; click `Kitty`.
  ** Float: `Installing kitty...`, sudo `prime`, pacman installs kitty (~8 MB), `Done!`. Press a key.
  * Press Super+Enter — the new window is kitty: type `echo $TERM` → `xterm-kitty`, and the title bar says kitty.
  * Type `cat ~/.config/xdg-terminals.list` — last line `kitty.desktop`. Menu → Install → Terminal: `Kitty` now dim ✓.
  * Type `omarchy-install-terminal foot` (no download), then Super+Enter opens foot again (`echo $TERM` → `foot`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Super+Enter still opens foot right after the install, wait 3 s and press it once more.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The two rejections; the Terminal submenu with dim Foot; `Done!`; a kitty window with `xterm-kitty`; `kitty.desktop`; dim Kitty row; foot restored.
  * If unsuccessful
  ** The Float's `Failed to install kitty` line or the list file contents.
covers: bin/omarchy-install-terminal, default/omarchy/omarchy-menu.jsonc (install.terminal.*)

### install-menu-marks-preinstalled-rows   [VM-OK]
description: The Install menu lists every optional package family and marks what the stock disk already has as a dim ✓ row that cannot be selected, so users can tell installed from available.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` — rows Package, AUR, AI, Service, Development, Editor, Style, Gaming, Browser, Web App, Terminal, TUI, Windows, Preinstalls; `Preinstalls` is dim ✓ and `Windows` is enabled.
  * Click `Terminal` — `Foot` dim ✓, Alacritty/Ghostty/Kitty enabled. Press Enter on `Foot` — nothing happens. Backspace to go up.
  * Click `Browser` — Chrome, Edge, Brave, Brave Origin, Firefox, Zen, all enabled; no `Chromium` row (preinstalled). Backspace.
  * Click `Service` — 1Password, Dropbox, Spotify, Signal, Tailscale, NordVPN, ONCE, Bitwarden enabled; note whether `Chromium Account` is listed. Backspace.
  * Click `Editor`, then `AI`, then `Gaming`, then `Development` → `JavaScript` and `PHP`, screenshotting each; every row is enabled and the sets match the Inventory lists (Editor 7, AI 10, Gaming 10, Development 14 + 3/3 sub-rows).
  * Click `Style` → `Font` — Cascadia Mono, Meslo LG Mono, Fira Code, Victor Code, Bitstream Vera Mono, Iosevka. Escape out.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Long submenus scroll; use mouse scroll or type a row's name to filter before screenshotting.
  * Backspace with an empty filter goes back one level.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per submenu showing the listed rows, with only `Preinstalls`, `Terminal → Foot` (and possibly `Chromium Account`) dim/✓.
  * If unsuccessful
  ** The submenu screenshot with a missing/extra row or a wrong dim state.
covers: default/omarchy/omarchy-menu.jsonc (install.*), install/omarchy-base.packages

### remove-menu-hides-uninstalled-rows   [VM-OK]
description: On a pristine disk the Remove menu shows only what is installed: the AI, Services, Gaming, Browser and Security submenus are empty and `Windows` is absent, while Package, Preinstalls, Web App, TUI and Theme are offered.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Remove` — rows Package, AI, Services, Development, Theme, Gaming, Browser, Web App, TUI, Preinstalls, Security; no `Windows` row.
  * Click `AI` — no rows (title only). Backspace. Repeat for `Services`, `Gaming`, `Browser`, `Security`: each empty.
  * Click `Development` — only the `JavaScript`, `PHP`, `Elixir` sub-headers; click `JavaScript` — empty. Backspace twice.
  * Click `Web App` — a picker listing the stock web apps (Basecamp, Discord, HEY, WhatsApp, X, YouTube, Zoom, Google …); press Escape to cancel without removing anything.
  * Press Escape until the menu is closed; the desktop is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * An empty submenu renders as just its title; report if it errors or the shell restarts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Remove root without `Windows`; five empty submenus; the Development sub-headers; the web-app picker; the untouched desktop.
  * If unsuccessful
  ** A Remove row for absent software, or a blank/crashed menu on an empty submenu.
covers: default/omarchy/omarchy-menu.jsonc (remove.*)

### install-browser-firefox-and-remove   [VM-OK] [NET]
description: Install → Browser → Firefox installs Firefox with Omarchy's policies and Wayland setting so it shows in the launcher and in Remove → Browser, and removing it from there takes it away again; bad browser names are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter): type `omarchy-install-browser opera; echo rc=$?` and `omarchy-remove-browser chromium; echo rc=$?` — each prints its usage line and `rc=1`.
  * Open the Menu (Super+Space) → `Install` → `Browser` → `Firefox` with the mouse.
  ** Float: `Installing Firefox...`, sudo `prime`, ~75 MB download (1–3 min; keep screenshotting), then `Firefox browser installed. Make it the default via Setup > Defaults > Browser.` and `Done!`. Press a key.
  * Open Apps (Super+Alt+Space), type `firefox`, press Enter — a Firefox window opens (allow 10 s). Close it with Super+W.
  * In the terminal type `cat ~/.config/environment.d/omarchy-firefox-wayland.conf` — `MOZ_ENABLE_WAYLAND=1`.
  * Menu → Install → Browser: `Firefox` dim ✓. Menu → Remove → Browser: `Firefox` is listed; click it.
  ** Float: `Removing Firefox...`, sudo, pacman removes it, `Done!`.
  * Apps → `firefox` → no entry; Menu → Remove → Browser → empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Firefox's first run shows a welcome tab; Chromium stays the default browser throughout.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both usage rejections; `Firefox browser installed...` + `Done!`; the Firefox window; the env line; dim row and Remove row; `Removing Firefox...` + `Done!`; launcher and Remove submenu without it.
  * If unsuccessful
  ** The Float's `Failed` text, or Firefox not starting (screenshot 15 s after Enter).
covers: bin/omarchy-install-browser, bin/omarchy-remove-browser, install/helpers/browser-policy.sh, default/omarchy/omarchy-menu.jsonc (install.browser.firefox, remove.browser.firefox)

### install-chromium-google-account-idempotent   [VM-OK]
description: Install → Service → Chromium Account adds the Google OAuth flags to Chromium's flags file exactly once, dims its row, and does nothing on a repeat.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `grep -c oauth2 ~/.config/chromium-flags.conf` — `0`.
  ** If the file is missing, type `omarchy-install-browser chromium` first (no download; it only writes config) and repeat.
  * Open the Menu (Super+Space) → `Install` → `Service` — `Chromium Account` is listed and enabled; click it.
  ** Float: `Installing Chromium Google account support...`, `Now you can login to your Google Account in Chromium.`, `Done!`. Press a key.
  * In the terminal type `grep oauth2 ~/.config/chromium-flags.conf` — exactly two lines, `--oauth2-client-id=...` and `--oauth2-client-secret=...`.
  * Menu → Install → Service: `Chromium Account` is dim ✓.
  * Type `omarchy-install-chromium-google-account; grep -c oauth2 ~/.config/chromium-flags.conf` — still `2`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No network or sudo is needed; a password prompt here would be unexpected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `0` before; the Float's two messages and `Done!`; the two flag lines; the dim row; `2` after the repeat.
  * If unsuccessful
  ** A count other than 2, or the row missing (report whether the flags file exists).
covers: bin/omarchy-install-chromium-google-account, default/omarchy/omarchy-menu.jsonc (install.service.chromium-account)

### install-chromium-claude-extension-seed   [VM-OK]
description: `omarchy-install-chromium-claude` seeds the Claude extension into all Chromium-family extension directories through one sudo prompt and is silent when already seeded; the copy-url and yt-dlp native hosts land in the profile the same way.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `ls /usr/share/chromium/extensions/ 2>&1` — no `fcoeoabgfenejglbffodgkkbkcdhcgfn.json` (or the directory is absent).
  * Type `omarchy-install-chromium-claude; echo rc=$?` — a sudo prompt, `prime`, then `rc=0`.
  * Type `cat /usr/share/chromium/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json; ls /usr/share/google-chrome/extensions /usr/share/microsoft-edge/extensions` — the `external_update_url` JSON and the same file in both other directories.
  * Type `omarchy-install-chromium-claude; echo rc=$?` — no prompt, no output, `rc=0`.
  * Type `omarchy-install-chromium-copy-url && omarchy-install-chromium-ytdlp && ls ~/.config/chromium/NativeMessagingHosts/` — `com.omarchy.copy_url.json` and `com.omarchy.ytdlp.json`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a graphical polkit dialog appears instead of a terminal prompt, type `prime` there.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The absent file; the prompt + `rc=0`; the JSON in three directories; the silent second run; the two native-host files.
  * If unsuccessful
  ** The error text, or a second run that prompts again.
covers: bin/omarchy-install-chromium-claude, bin/omarchy-install-chromium-copy-url, bin/omarchy-install-chromium-ytdlp

### install-and-launch-sublime-text   [VM-OK] [NET]
description: Menu rows built on `omarchy-install-and-launch` install the package and then open the app by itself; Sublime Text is the smallest such row, and the launcher's Delete key removes it again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Editor` → `Sublime Text` with the mouse.
  ** Float: `Installing Sublime Text...`, sudo `prime`, pacman installs `sublime-text-4` (~20 MB), `Done!`. Press a key.
  * Wait up to 10 s: a Sublime Text window opens on its own. Screenshot it, then close it with Super+W.
  ** An "unregistered version" banner inside Sublime is normal.
  * Open Apps (Super+Alt+Space), type `sublime` — `Sublime Text` is listed. Escape. Menu → Install → Editor: `Sublime Text` dim ✓.
  * Apps → `sublime` → highlight `Sublime Text` → press Delete → click `Uninstall` in the `Do you want to uninstall Sublime Text?` dialog.
  ** Float: `Uninstalling Sublime Text...`, sudo, `Done!`.
  * Apps → `sublime` → no entry; Menu → Install → Editor → `Sublime Text` enabled again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If no window appears within 15 s of `Done!`, that is the failure to report — the launch is part of the row's contract.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Installing Sublime Text...` → `Done!`; the Sublime window; the launcher entry and dim row; the uninstall dialog and `Uninstalling Sublime Text...`; the launcher without it.
  * If unsuccessful
  ** `Failed (exit code N)!`, or `Done!` with no window 15 s later.
covers: bin/omarchy-install-and-launch, bin/omarchy-remove-launcher-entry, default/omarchy/omarchy-menu.jsonc (install.editor.sublime)

### dev-env-node-menu-and-cli-round-trip   [VM-OK] [NET]
description: Install → Development → JavaScript → Node.js puts Node on the PATH of every new shell and dims its row; `omarchy-remove-dev-env node` takes it back out, and both commands refuse missing or unknown names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `node --version` — `command not found`.
  * Type `omarchy-install-dev-env; echo rc=$?` and `omarchy-remove-dev-env cobol; echo rc=$?` — the usage line with `rc=1`, then `Unknown environment: cobol` with `rc=1`.
  ** Also type `omarchy-install-dev-env cobol; echo rc=$?` and record the result — today it prints nothing and `rc=0` (no unknown-name branch); report as an observation.
  * Open the Menu (Super+Space) → `Install` → `Development` → `JavaScript` → `Node.js`.
  ** Float: `Installing Node.js...`, mise downloads Node (~30 MB, up to 2 min, no sudo), `Done!`. Press a key.
  * Open a new terminal (Super+Enter): `node --version` — `v2x.y.z`. Menu → Install → Development → JavaScript: `Node.js` dim ✓; Menu → Remove → Development → JavaScript: `Node.js` listed.
  * In the terminal type `omarchy-remove-dev-env node` — `Removing Node.js...` … `Done!`.
  * New terminal: `node --version` — `command not found`; Menu → Remove → Development → JavaScript → empty again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * mise shows a progress bar in the Float; wait for `Done!` rather than judging by the bar.
  * `omarchy install dev-env node` is the same command via the `omarchy` CLI; either form is fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `command not found` before; the two rejections and the `cobol` result; `Installing Node.js...` + `Done!`; the version; dim row and Remove row; `Removing Node.js...`; `command not found` after.
  * If unsuccessful
  ** mise's error text in the Float or terminal.
covers: bin/omarchy-install-dev-env (node, arg handling), bin/omarchy-remove-dev-env (node, unknown), default/omarchy/omarchy-menu.jsonc (install.development.javascript.node, remove.development.javascript.node)

### dev-env-php-pacman-path   [VM-OK] [NET]
description: The PHP environment is the pacman-based dev-env: it installs php/composer/xdebug, enables extensions in `/etc/php/php.ini` under sudo and adds Composer's bin to PATH; Remove → Development → PHP drops the packages.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Development` → `PHP` → `PHP`.
  ** Float: `Installing PHP...`, sudo `prime`, pacman installs `php composer php-sqlite xdebug` (~25 MB), `Added Composer global bin directory to PATH.`, `Done!`. Press a key.
  * Open a terminal (Super+Enter) and type `php -v` — `PHP 8.x` and a `with Xdebug` line.
  * Type `grep -E '^extension=(bcmath|intl|pdo_sqlite)' /etc/php/php.ini` — three uncommented lines.
  * Menu → Install → Development → PHP: `PHP` dim ✓. Menu → Remove → Development → PHP: `PHP` listed; click it.
  ** Float: `Removing PHP...`, sudo, pacman removes the four packages, `Done!`.
  * In the terminal type `php -v` — `command not found`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The PATH line added to `.bashrc` survives removal; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Installing PHP...`/`Done!`; `php -v` with Xdebug; the three `extension=` lines; dim row; `Removing PHP...`/`Done!`; `command not found`.
  * If unsuccessful
  ** pacman/sed errors in the Float.
covers: bin/omarchy-install-dev-env (php), bin/omarchy-remove-dev-env (php), default/omarchy/omarchy-menu.jsonc (install.development.php.php, remove.development.php.php)

### dev-env-python-with-uv   [VM-OK] [NET]
description: The Python environment installs a mise Python plus Astral's `uv` through a curl-pipe installer, and its remover deletes both.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `uv --version` — `command not found`.
  * Type `omarchy-install-dev-env python` — `Installing Python...`, mise downloads a prebuilt CPython (~40 MB), then `Installing uv...` and the uv installer's `installing to /home/prime/.local/bin`.
  * Open a new terminal (Super+Enter): `python --version; uv --version` — `Python 3.1x` and `uv 0.x`.
  * Open the Menu (Super+Space) → `Install` → `Development`: `Python` dim ✓. Escape.
  * In the terminal type `omarchy-remove-dev-env python` — `Removing Python...` … `Done!`.
  * New terminal: `uv --version` — `command not found`; `which python` — `/usr/bin/python` or nothing (mise's Python gone).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The uv installer may mention adding to PATH; `~/.local/bin` is already on PATH in Omarchy.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `command not found` before; mise + uv installer output; both versions; dim row; `Done!`; uv gone after.
  * If unsuccessful
  ** The curl or mise error text.
covers: bin/omarchy-install-dev-env (python), bin/omarchy-remove-dev-env (python)

### mise-install-wrapper-and-name-guard   [VM-OK] [NET]
description: `omarchy-mise-install` writes the lazy `~/.local/bin` wrappers behind every preinstalled agent command; a wrapper installs its tool on first use, and unsafe command names are refused before anything is written.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-mise-install; echo rc=$?` — `Usage: omarchy-mise-install <package> [command-name [bin-name]]`, `rc=1`.
  * Type `omarchy-mise-install somepkg ../escape; echo rc=$?` — `omarchy-mise-install: '../escape' is not usable as a command name`, `rc=1`; repeat with `.hidden` and `-dash`.
  * Type `omarchy-mise-install npm:figlet figlet && cat ~/.local/bin/figlet` — a 4-line script with `export MISE_MINIMUM_RELEASE_AGE=0`, `mise use -g --quiet "npm:figlet" || exit 1`, `exec mise x "npm:figlet" -- "figlet" "$@"`.
  * Type `figlet hello` — the first run installs node and the package (~30 MB, up to 2 min) then prints `hello` as ASCII art; `figlet again` is instant.
  * Type `head -4 ~/.local/bin/gh` — the preinstalled `gh` stub has the same shape with `"gh"`.
  * Type `mise rm -g npm:figlet; mise uninstall --all npm:figlet; rm ~/.local/bin/figlet; figlet x` — `command not found` (clean).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * mise prints download progress on stderr; wait for the ASCII art.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Usage and three refusals with `rc=1`; the wrapper contents; the ASCII-art `hello`; the `gh` stub head; the cleanup `command not found`.
  * If unsuccessful
  ** mise's error, or a refused name that still created/deleted a file.
covers: bin/omarchy-mise-install, install/user/mise.sh, etc/mise/conf.d/omarchy.toml, test/shell.d/mise-install-test.sh

### hermes-cli-stub-lifecycle   [VM-OK]
description: The Hermes CLI stub Omarchy provisions is owned but "cold": `--owns`/`--check` say so, `--remove` clears it idempotently, a plain call restores it, and a hermes the user wrote is left alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `head -3 ~/.local/bin/hermes` — the third line is `# Written by omarchy-install-hermes-cli.`.
  * Type `omarchy-install-hermes-cli --owns; echo owns=$?; omarchy-install-hermes-cli --check; echo check=$?` — `owns=0`, `check=1`.
  * Type `omarchy-install-hermes-cli --remove; echo rc=$?; ls ~/.local/bin/hermes` — `rc=0` and `No such file`.
  * Type `omarchy-install-hermes-cli --remove; echo rc=$?` — `rc=0` again (nothing owned, nothing to do).
  * Type `omarchy-install-hermes-cli; omarchy-install-hermes-cli --owns; echo owns=$?` — the stub is back, `owns=0`.
  * Type `omarchy-install-hermes-cli --remove; printf '#!/bin/bash\necho mine\n' > ~/.local/bin/hermes; chmod +x ~/.local/bin/hermes; omarchy-install-hermes-cli; echo rc=$?` — a message that `~/.local/bin/hermes` is not Omarchy's (`...was not installed by Omarchy.` or `...does not support the interactive seeded sessions...`), `rc=1`, and `cat ~/.local/bin/hermes` still shows `echo mine`.
  * Type `rm ~/.local/bin/hermes; omarchy-install-hermes-cli; omarchy-install-openclaw-cli --check; echo rc=$?` — stub restored; OpenClaw `rc=1` (not installed).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never run `hermes --version` or `--now`: that installs Python 3.13 + Hermes (minutes, hundreds of MB).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The marker line; `owns=0 check=1`; the removal and idempotent `rc=0`; the restored stub; the foreign-file refusal with the file intact; OpenClaw `rc=1`.
  * If unsuccessful
  ** A differing code, or a foreign `hermes` file that was modified or deleted.
covers: bin/omarchy-install-hermes-cli, bin/omarchy-install-openclaw-cli, test/shell.d/hermes-cli-test.sh

### remove-preinstalls-and-decline   [VM-OK]
description: Remove → Preinstalls strips the shipped web apps, TUIs, agent stubs and the 13 desktop packages and flips the Install/Remove rows, while declining the confirmation changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Apps (Super+Alt+Space), type `basecamp` — `Basecamp` is listed; type `obsidian` — `Obsidian` is listed. Escape.
  * Open the Menu (Super+Space) → `Remove` → `Preinstalls`. In the Float, at `Are you sure you want to remove all preinstalled web apps, TUI wrappers, and desktop applications?` choose **No** (arrow/Tab to No, Enter). `Done!`; press a key.
  * Apps → `basecamp` still listed; Menu → Remove → `Preinstalls` still present (nothing changed).
  * Menu → Remove → `Preinstalls` → **Yes**. `Removing preinstalled Omarchy applications...`, sudo `prime`, pacman removes aether cliamp libreoffice-fresh xournalpp pinta obsidian obs-studio kdenlive moonlight-qt lazydocker omacut omacalc omawrite (no download), `Done!`.
  * Apps → `basecamp`, `obsidian`, `libre` → nothing listed for any of them.
  * Open a terminal (Super+Enter) and type `ls ~/.local/bin/ | grep -cE '^(claude|gh|codex|opencode|hermes)$'` — `0` (the agent stubs are gone too).
  * Menu → Install: `Preinstalls` is now enabled; Menu → Remove: the `Preinstalls` row is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run Install → Preinstalls here; it re-downloads ~700 MB (own SLOW test).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The No path with Basecamp still listed; the Yes path's pacman removal and `Done!`; empty launcher searches; stub count `0`; Install row enabled and Remove row absent.
  * If unsuccessful
  ** pacman errors, or web apps/stubs still listed after Yes.
covers: bin/omarchy-remove-preinstalls, install/omarchy-base.packages, default/omarchy/omarchy-menu.jsonc (remove.preinstalls, install.preinstalls), test/shell.d/preinstalls-test.sh

### install-preinstalls-restores   [VM-OK] [NET] [SLOW]
description: After Remove Preinstalls, Install → Preinstalls puts the shipped launchers, agent stubs and 13 packages back and clears the opt-out; declining leaves the opt-out in place.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter), type `omarchy-remove-preinstalls`, choose **Yes**, sudo `prime`, wait for it to finish (offline, ~1 min). Open Apps (Super+Alt+Space), type `obsidian` — nothing.
  * Open the Menu (Super+Space) → `Install` → `Preinstalls` (now enabled). At `Are you sure you want to restore all preinstalled web apps, TUI wrappers, and desktop applications?` choose **No** → `Done!`. Menu → Install: `Preinstalls` still enabled.
  * Menu → Install → `Preinstalls` → **Yes**. `Restoring preinstalled Omarchy applications...`, then pacman (sudo) downloads ~700 MB (5–10 min; screenshot every 5 s, never sleep longer), `Done!`.
  ** On a pacman failure the Float prints `Preinstalls are still marked as removed. Fix the errors above and try again.` — capture it as the failure.
  * Apps → `basecamp` → `Basecamp`; `obsidian` → `Obsidian`; `libre` → LibreOffice entries.
  * In the terminal type `ls ~/.local/bin/ | grep -cE '^(claude|gh|codex|opencode|hermes)$'` — `5`.
  * Menu → Install: `Preinstalls` dim ✓; Menu → Remove: `Preinstalls` listed again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The download may exceed the session budget; if so, report SLOW with the last pacman progress line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The declined restore leaving the row enabled; `Restoring...`, pacman progress, `Done!`; the launcher entries back; stub count `5`; the rows flipped back.
  * If unsuccessful
  ** The `Preinstalls are still marked as removed` line with the pacman error above it.
covers: bin/omarchy-install-preinstalls, bin/omarchy-refresh-applications, install/omarchy-base.packages

### docker-db-redis-install-and-cancel   [VM-OK] [NET]
description: Install → Development → Docker DB runs a database container with dev-friendly settings; Redis is the smallest, and cancelling the picker must not error (today it prints `main_menu: command not found`, which the test records).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Development` → `Docker DB` — a Float with the gum picker `Select database (return to install, esc to cancel)` listing MySQL, PostgreSQL, Redis, MongoDB, MariaDB, MSSQL.
  * Press Escape and read the output exactly.
  ** Expected today: a line ending `main_menu: command not found`, then `No databases selected for installation.` and `Done!`. Report the `command not found` line as an observation. Press a key.
  * Menu → Install → Development → Docker DB again; arrow to `Redis`, Enter. `Installing Redis...`, sudo `prime`, docker pulls `redis:7` (~40 MB) and prints a long container id, `Done!`.
  * Open a terminal (Super+Enter) and type `sudo docker ps --format '{{.Names}} {{.Ports}}'` — `redis 127.0.0.1:6379->6379/tcp`.
  * Type `omarchy-install-docker-dbs Redis` — docker answers `Conflict. The container name "/redis" is already in use` (no duplicate guard; note it).
  * Type `sudo docker rm -f redis` — the container is gone (`sudo docker ps` shows nothing).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Docker's socket is root-only by default in Omarchy, hence the sudo prompt inside the Float.
  * If docker is not running, type `sudo systemctl start docker` and retry once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The picker; the Escape output including the `main_menu` line; `Installing Redis...` with the pull and container id; `docker ps` with the port binding; the conflict error; the empty `docker ps` after cleanup.
  * If unsuccessful
  ** Docker's daemon/pull error text.
covers: bin/omarchy-install-docker-dbs, default/omarchy/omarchy-menu.jsonc (install.development.docker-dbs), bin/omarchy-sudo-docker

### tailscale-install-without-login   [VM-PARTIAL] [NET]
description: Installing Tailscale where the browser login cannot finish still leaves a coherent state — daemon up, `tailscale status` saying logged out, the Install row dim — and Remove → Services → Tailscale cleans it up. Skipped: the login itself, Taildrop, and the bar's connected state.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `tailscale version` — `command not found`.
  * Type `omarchy-install-service-tailscale` — `Installing Tailscale...`, sudo `prime`, pacman installs tailscale (~15 MB), `Starting Tailscale...`, then `To authenticate, visit:` and a `https://login.tailscale.com/a/...` URL; the command waits.
  ** Run it in this terminal, not from the menu: from the menu, Ctrl+C would close the Float with no banner.
  * Screenshot the URL, then press Ctrl+C.
  ** The remaining steps (operator, receive service, bar plugin, web app) do not run — note this as the half-installed state.
  * Type `tailscale status; echo rc=$?` — `Logged out.` (or `NeedsLogin`) and `rc=1`; type `systemctl is-active tailscaled` — `active`.
  * Open the Menu (Super+Space) → `Install` → `Service`: `Tailscale` dim ✓. Menu → `Remove` → `Services`: `Tailscale` listed; click it.
  ** Float: `tailscale down`, systemd disables, pacman removes tailscale, `Tailscale has been removed.`, `Done!`.
  * In the terminal type `tailscale version; systemctl is-active tailscaled` — `command not found` and `inactive`/`unknown`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `tailscale status` may need a second after Ctrl+C; repeat once if it errors on the socket.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `command not found` before; the login URL; `Logged out.` with `rc=1` and `active`; dim Install row; Remove row; `Tailscale has been removed.`; `command not found` and inactive after.
  * If unsuccessful
  ** The installer's error before the URL, or the remover's `Failed` output.
covers: bin/omarchy-install-service-tailscale, bin/omarchy-remove-service-tailscale, bin/omarchy-installed-service-tailscale, default/omarchy/omarchy-menu.jsonc (install.service.tailscale, remove.service.tailscale)

### tailscale-send-receive-without-tailscale   [VM-OK]
description: With Tailscale absent, the Taildrop helpers fail fast with a usage line or a critical notification instead of hanging, and the installed-service probes report "not installed".
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-tailscale-send; echo rc=$?` — `Usage: omarchy-tailscale-send <machine> [file...]`, `rc=1`.
  * Type `omarchy-tailscale-send mybox.example.ts.net ~/.bashrc; echo rc=$?` — a red/critical notification `Could not send to mybox` appears top-right (body mentions `tailscale: command not found`), `rc=1`.
  * Type `omarchy-tailscale-receive --once; echo rc=$?` — `tailscale: command not found` and `rc=1` within a few seconds (no loop).
  * Type `omarchy-installed-service-tailscale; echo rc=$?; omarchy-installed-service-dropbox; echo rc=$?` — `rc=1` twice.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notifications fade after a few seconds; screenshot right after the command returns.
  * If `--once` has not returned after 30 s, press Ctrl+C and report a hang.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Usage + `rc=1`; the critical notification with `rc=1`; the receive error with `rc=1`; both probes `rc=1`.
  * If unsuccessful
  ** A hung receive command or a missing notification.
covers: bin/omarchy-tailscale-send, bin/omarchy-tailscale-receive, bin/omarchy-installed-service-tailscale, bin/omarchy-installed-service-dropbox, test/shell.d/tailscale-receive-test.sh

### voxtype-absent-paths   [VM-OK]
description: With dictation not installed, the bar's status feed returns the idle JSON, the remover says so gracefully, the dictation hotkeys are inert, and the menu offers Install but not Remove.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-voxtype-status; echo rc=$?` — `{"alt": "", "class": "idle", "tooltip": ""}` and `rc=0`, returning immediately.
  * Type `omarchy-voxtype-remove; echo rc=$?` — `Voxtype was not installed.`, `rc=0`.
  * Close the terminal (Super+W). On the desktop press F9, then Super+Ctrl+X — nothing happens (no notification, no error).
  * Open the Menu (Super+Space) → `Install` → `AI`: `Dictation` enabled. Menu → `Remove` → `AI`: no `Dictation` row.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If F9 or Super+Ctrl+X produces any toast, that is the bug to report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The JSON line with `rc=0`; `Voxtype was not installed.`; the unchanged desktop after both hotkeys; the two menu states.
  * If unsuccessful
  ** A notification/error after the hotkeys or a non-zero code.
covers: bin/omarchy-voxtype-status, bin/omarchy-voxtype-remove, default/hypr/bindings/voxtype.lua, default/omarchy/omarchy-menu.jsonc (install.ai.dictation, remove.ai.dictation)

### voxtype-install-without-microphone   [VM-PARTIAL] [NET]
description: Install → AI → Dictation downloads Voxtype and its ~150 MB model, starts the user service and bar widget, and the dictation toggle fails gracefully with no microphone; Remove → AI → Dictation clears it. Skipped: real dictation and the GPU path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `AI` → `Dictation`. At `Install Voxtype + AI model (~150MB) to enable dictation?` choose **No** → `Done!`; Menu → Install → AI: `Dictation` still enabled.
  * Menu → Install → AI → `Dictation` → **Yes**. sudo `prime`; pacman installs `wtype voxtype-bin`; the model download shows progress (2–4 min; keep screenshotting); the bar restarts; a toast `Voxtype Dictation Ready — Hold F9 to dictate (or toggle with Super + Ctrl + X).`; `Done!`.
  * Screenshot the bar: a dictation/microphone widget is present.
  * Press Super+Ctrl+X, wait 3 s, screenshot, press Super+Ctrl+X again — expect an error toast or an error state in the widget (no audio input device), never a crash dialog.
  * Open a terminal (Super+Enter) and type `journalctl --user -u voxtype.service -n 30 --no-pager | sudo tee /dev/ttyS0` — read the audio/input error lines with get-serial.
  * Menu → Install → AI: `Dictation` dim ✓. Menu → Remove → AI → `Dictation` → Float `Uninstall Voxtype to remove dictation.`, pacman removes voxtype-bin, `Done!`.
  * The bar widget is gone; in the terminal type `ls ~/.config/voxtype ~/.local/share/voxtype 2>&1` — both `No such file or directory`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right or Tab moves between Yes/No, Enter picks.
  * If the model download stalls past 5 min, Ctrl+C in the Float and report SLOW.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The declined confirm; the download and the `Voxtype Dictation Ready` toast; the bar widget; the error state after the toggle; the serial journal lines; the removal `Done!` with widget and directories gone.
  * If unsuccessful
  ** A crash dialog, a hung installer, or `~/.config/voxtype` surviving removal.
covers: bin/omarchy-voxtype-install, bin/omarchy-voxtype-remove, bin/omarchy-voxtype-status, default/voxtype/config.toml, default/hypr/bindings/voxtype.lua, test/shell.d/voxtype-invitation-test.sh

### gaming-gpu-lib32-no-gpu-exit-status   [VM-OK]
description: On a machine with no Intel/AMD/NVIDIA GPU the lib32 driver helper installs nothing but currently exits 1, which makes Steam/Heroic/Lutris/Battle.net abort before launching; this pins the behaviour so a fix is visible.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `lspci | grep -iE 'VGA|Display'` — a virtio/QXL/bochs adapter, no Intel/AMD/NVIDIA.
  * Type `omarchy-install-gaming-gpu-lib32; echo rc=$?` — `Installing lib32 graphics drivers...`, no sudo prompt, no pacman transaction, then the code.
  ** Today `rc=1`; `rc=0` means it has been fixed. Record which.
  * Type `omarchy-pkg-present lib32-vulkan-intel lib32-vulkan-radeon lib32-nvidia-utils; echo $?` — `1` (nothing was installed).
  * Type `omarchy-hw-nvidia-gsp; echo $?; omarchy-hw-nvidia-without-gsp; echo $?` — `1` and `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not install Steam here; see the VM-NO appendix.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The lspci line; the helper's output with its `rc`; `1` from pkg-present; the two hw probes.
  * If unsuccessful
  ** A sudo prompt or pacman transaction from the helper.
covers: bin/omarchy-install-gaming-gpu-lib32 (and omarchy-install-gaming-steam/heroic/lutris/battlenet by dependency)

### gaming-xbox-cloud-webapp-install-remove   [VM-OK] [NET]
description: Xbox Cloud Gaming installs as a web app (icon download only), opens in the browser and appears in the launcher; Remove → Gaming → Xbox Cloud Gaming deletes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Xbox Cloud Gaming`.
  ** Float: `Installing Xbox Cloud Gaming...`, the icon is fetched, a Chromium app window for `xbox.com/en-US/play` opens (a login wall is fine), `Done!`. Press a key.
  * Close the Xbox window (Super+W). Open Apps (Super+Alt+Space), type `xbox` — `Xbox Cloud Gaming` with an Xbox icon.
  * Menu → Install → Gaming: `Xbox Cloud Gaming` dim ✓. Menu → Remove → Gaming: `Xbox Cloud Gaming` listed; click it → Float removes the web app → `Done!`.
  * Apps → `xbox` → no entry; Menu → Remove → Gaming → empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon comes from cdn.jsdelivr.net; a generic icon means the fetch failed — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Installing Xbox Cloud Gaming...` → `Done!`; the browser window; the launcher entry with icon; dim row; Remove row; removal `Done!`; launcher without it.
  * If unsuccessful
  ** The Float's error, or the entry surviving removal.
covers: bin/omarchy-install-gaming-xbox-cloud, bin/omarchy-remove-gaming-xbox-cloud, default/omarchy/omarchy-menu.jsonc (install.gaming.xbox-cloud, remove.gaming.xbox-cloud)

### gaming-xbox-controllers-driver-without-bluetooth   [VM-PARTIAL] [NET]
description: Install → Gaming → Xbox Controllers builds the xpadneo DKMS module, blacklists xpad and offers a reboot when the input group is new; without a controller or Bluetooth only the software path and its removal are verified.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Xbox Controllers`.
  ** Float: `Installing Xbox controller Bluetooth support...`, sudo `prime`, pacman installs `xpadneo-dkms`, DKMS builds the module (1–3 min; `Building module...`).
  * Watch the ending: either `Reboot needed to finish setup. Reboot now?` — choose **No** → `Done!`; or `Now you can pair your Xbox controller with Bluetooth using Super + Ctrl + B.` → `Done!`. Record which.
  * Open a terminal (Super+Enter) and type `cat /etc/modprobe.d/blacklist-xpad.conf /etc/modules-load.d/xpadneo.conf` — `blacklist xpad` and `hid_xpadneo`.
  * Menu → Install → Gaming: `Xbox Controllers` dim ✓. Menu → Remove → Gaming → `Xbox Controllers (󰂯)` → Float removes the package and both files, prints `Reboot to fully unload xpadneo and restore xpad.`, `Done!`.
  * In the terminal type `ls /etc/modprobe.d/blacklist-xpad.conf /etc/modules-load.d/xpadneo.conf 2>&1` — both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes to the reboot prompt inside this test.
  * A DKMS "missing kernel headers" error is a real failure: `linux-omarchy-headers` should be preinstalled.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** DKMS build output; the reboot prompt answered No (or the pairing message); the two config files; dim row; removal output and both files gone.
  * If unsuccessful
  ** The DKMS/pacman error text.
covers: bin/omarchy-install-gaming-xbox-controllers, bin/omarchy-remove-gaming-xbox-controllers, install/omarchy-other.packages (linux-omarchy-headers)

### install-service-1password-and-remove   [VM-OK] [NET]
description: Install → Service → 1Password installs the app and CLI, seeds the Chromium extension and opens the app; the CLI remover (there is no Remove row) undoes all of it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Service` → `1Password`.
  ** Float: `Installing 1Password...`, sudo `prime`, ~115 MB (1–3 min), `Installing 1Password extension for Chromium...`, `Opening 1Password...`, `1Password has been installed. Restart Chromium to load the browser extension.`, `Done!`.
  * Within ~10 s a 1Password sign-in window opens; screenshot it and close it (Super+W).
  * Open Apps (Super+Alt+Space), type `1pass` — `1Password` listed. Menu → Install → Service: `1Password` dim ✓. Menu → Remove → Services: no 1Password row (gap to note).
  * Open a terminal (Super+Enter) and type `cat /usr/share/chromium/extensions/aeblfdkhhhdcdjpifhhbdiojplfjncoa.json` — the `external_update_url` JSON.
  * Type `omarchy-remove-service-1password` — sudo, pacman removes both packages, `1Password has been removed.`
  * Apps → `1pass` → gone; in the terminal `ls /usr/share/chromium/extensions/aeblfdkhhhdcdjpifhhbdiojplfjncoa.json 2>&1` — `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * 1Password is Electron; without GPU acceleration it takes a few seconds to paint.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output through `Done!`; the 1Password window; the launcher entry and dim row; the empty Services remove menu; the extension JSON; the remover's message; the entry and file gone.
  * If unsuccessful
  ** `Failed` text, or no window 15 s after `Done!`.
covers: bin/omarchy-install-service-1password, bin/omarchy-remove-service-1password, default/omarchy/omarchy-menu.jsonc (install.service.1password), test/shell.d/launch-1password-test.sh

### install-ai-claude-desktop-and-remove   [VM-OK] [NET]
description: Install → AI → Claude Desktop installs and opens the app; Remove → AI → Claude Desktop quits it, removes the package and its own config while leaving the Claude Code CLI stub alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `AI` → `Claude Desktop`.
  ** Float: `Installing Claude...`, sudo `prime`, ~110 MB (1–3 min), `Opening Claude...`, `Claude has been installed.`, `Done!`. A Claude login window opens within ~15 s. Screenshot it and leave it running.
  * Open a terminal (Super+Enter) and type `ls -d ~/.config/Claude ~/.local/bin/claude` — both exist (the app's config and the CLI stub).
  * Menu → Install → AI: `Claude Desktop` dim ✓. Menu → Remove → AI: `Claude Desktop` listed; click it.
  ** Float: the Claude window disappears (the remover quits it first), pacman removes claude-desktop, `Claude has been removed.`, `Done!`.
  * In the terminal type `ls -d ~/.config/Claude ~/.cache/Claude ~/.local/bin/claude 2>&1` — the first two `No such file`, the stub still present.
  * Apps (Super+Alt+Space) → `claude` → no `Claude` desktop entry.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the app never finished starting and `~/.config/Claude` is absent, continue; the remover must still succeed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output; the Claude window; the two paths present; dim row and Remove row; the window vanishing and `Claude has been removed.`; config gone, stub kept; launcher without it.
  * If unsuccessful
  ** `Failed` output, or `~/.config/Claude` surviving with the app still open.
covers: bin/omarchy-install-ai-claude, bin/omarchy-remove-ai-claude, default/omarchy/omarchy-menu.jsonc (install.ai.claude, remove.ai.claude), test/shell.d/remove-ai-test.sh

### install-ai-t3-code-themed-and-remove   [VM-OK] [NET]
description: Install → AI → T3 Code installs the app and hands it the current Omarchy palette before its first launch; Remove → AI → T3 Code deletes the package and `~/.t3`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `AI` → `T3 Code`.
  ** Float: `Installing T3 Code...`, sudo `prime`, ~100 MB, `Matching T3 Code to the current theme...`, a `t3 theme set` confirmation, `Opening T3 Code...`, `T3 Code has been installed.`, `Done!`.
  * Within ~15 s a T3 Code window opens using the Omarchy colours; screenshot and close it (Super+W).
  * Open a terminal (Super+Enter) and type `cmp ~/.local/state/omarchy/current/theme/t3code.json ~/.t3/userdata/themes/omarchy.json && echo same` — `same`.
  * Menu → Install → AI: `T3 Code` dim ✓. Menu → Remove → AI → `T3 Code` → Float `T3 Code has been removed.` → `Done!`.
  * In the terminal type `ls -d ~/.t3 ~/.config/t3code 2>&1` — both `No such file`; Apps → `t3` → no entry.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the palette was missing before install, the script renders it itself; `same` must still print.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output including the theme step; the themed T3 window; `same`; dim row; removal output; both dirs gone.
  * If unsuccessful
  ** `T3 theme selection failed` or the `Failed` banner text.
covers: bin/omarchy-install-ai-t3-code, bin/omarchy-remove-ai-t3-code, default/omarchy/omarchy-menu.jsonc (install.ai.t3-code, remove.ai.t3-code), test/shell.d/t3code-install-test.sh

### install-ai-ollama-and-remove   [VM-OK] [NET]
description: Install → AI → Ollama picks the CPU package on a machine without NVIDIA/ROCm tooling; Remove → AI → Ollama stops the service and deletes the model directories.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `AI` → `Ollama`.
  ** Float: `Installing Ollama...`, sudo `prime`, pacman installs the plain `ollama` package (~30–50 MB; not `ollama-cuda`/`-rocm`), `Done!`.
  * Open a terminal (Super+Enter) and type `ollama --version` — a version line (a "server not running" warning is fine).
  * Menu → Install → AI: `Ollama` dim ✓. Menu → Remove → AI: `Ollama` listed; click it.
  ** Float: systemd disable (may say unit not found), pacman removes ollama, `Ollama and its models have been removed.`, `Done!`.
  * In the terminal type `ollama --version; ls -d /var/lib/ollama ~/.ollama 2>&1` — `command not found` and both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `ollama pull`; models are hundreds of MB.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Installing Ollama...` naming the `ollama` package → `Done!`; the version; dim row; removal output; `command not found` and both dirs missing.
  * If unsuccessful
  ** A cuda/rocm package being chosen, or the remover's `Failed` text.
covers: bin/omarchy-install-app, bin/omarchy-remove-ai-ollama, default/omarchy/omarchy-menu.jsonc (install.ai.ollama, remove.ai.ollama)

### windows-vm-unconfigured-commands   [VM-OK]
description: Before a Windows VM exists every `omarchy-windows-vm` subcommand says so and exits 1, help and unknown commands behave, removal can be declined, and the menu shows Install → Windows but no Remove → Windows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-windows-vm status; echo rc=$?` — `Windows VM not configured.` / `To set up: omarchy-windows-vm install`, `rc=1`.
  * Type `omarchy-windows-vm launch; echo rc=$?` then `omarchy-windows-vm stop; echo rc=$?` — `...not configured. Please run: omarchy-windows-vm install` and `Windows VM not configured.`, both `rc=1`.
  * Type `omarchy-windows-vm help; echo rc=$?` — the `Usage: omarchy-windows-vm [command] [options]` block, `rc=0`; type `omarchy-windows-vm frobnicate; echo rc=$?` — `Unknown command: frobnicate` + usage, `rc=1`.
  * Type `omarchy-windows-vm remove` — `Remove Windows VM and delete all associated data?` with No preselected; press Enter — `Removal cancelled by user`.
  * Type `omarchy-windows-key; echo rc=$?` — `No Windows license key found in firmware.`, `rc=1` (QEMU has no MSDM table).
  * Open the Menu (Super+Space) → `Install`: `Windows` row enabled. Menu → `Remove`: no `Windows` row.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * None of these should ask for a password; a polkit dialog here is a finding.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Each message with its `rc`; the usage block; the cancelled removal; the windows-key message; the two menu states.
  * If unsuccessful
  ** A polkit/sudo prompt, a hang, or a different message.
covers: bin/omarchy-windows-vm (status/launch/stop/help/remove dispatch), bin/omarchy-windows-key, default/omarchy/omarchy-menu.jsonc (install.windows, remove.windows)

### windows-vm-install-refuses-small-disk   [VM-PARTIAL]
description: On a 40 GB guest (or without nested KVM) Install → Windows stops at the prerequisite check with a clear boxed message and installs nothing. Skipped: the real install (needs ≥ 74 GB free and a Windows 11 download).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `df -h ~ | tail -1; ls /dev/kvm; ls -d ~/.windows ~/Windows ~/.local/share/applications/windows-vm.desktop 2>&1` — free space well under 74 G, KVM present or absent (note), and all three paths `No such file`.
  * Open the Menu (Super+Space) → `Install` → `Windows`.
  ** Float: either a box `❌ KVM virtualization not available!` with modprobe hints, or `❌ Insufficient disk space!` / `Available: NNGB` / `Required: 74GB (64GB disk + 10GB for Windows image)`; then `● Failed (exit code 1)!`. Press a key.
  ** If instead a RAM picker appears (≥ 74 GB free and KVM present), press Ctrl+C (`Installation cancelled by user`) and report that the check was not exercised.
  * In the terminal type `ls -ld ~/.windows ~/Windows; ls ~/.local/share/applications/windows-vm.desktop 2>&1; omarchy-pkg-present freerdp; echo $?` — the two dirs now exist as `drwx------` (created before the check; note it), no desktop file, `1`.
  * Type `omarchy-windows-vm status` — still `Windows VM not configured.`
  * Menu → Install: `Windows` still enabled; Menu → Remove: still no `Windows`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The boxed error is drawn by gum; screenshot before pressing a key.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The pre-state; the KVM or disk-space box and `Failed (exit code 1)!`; the two 0700 dirs, no desktop file, `1`; `not configured`; unchanged menu.
  * If unsuccessful
  ** Any package installation or desktop file created despite the failed check.
covers: bin/omarchy-windows-vm (install_windows, check_prerequisites, prepare_user_mount_sources), default/omarchy/omarchy-menu.jsonc (install.windows)

### reinstall-configs-resets-home   [VM-OK]
description: `omarchy-reinstall-configs` replays the shipped dotfiles over a home the user broke and refuses to run as root, while `omarchy-reinstall` warns and does nothing when declined.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `echo '# broken by test' >> ~/.bashrc; tail -1 ~/.bashrc` — `# broken by test`.
  * Type `sudo omarchy-reinstall-configs; echo rc=$?` (`prime`) — `Error: This script should not be run as root`, `rc=1`.
  * Type `omarchy-reinstall` — the two-line warning (`...user config changes will be overwritten.`) and `Are you sure you want to reinstall and lose config changes?`; choose **No**. `tail -1 ~/.bashrc` still shows the test line; no pacman ran.
  ** Never answer Yes: that starts a full package reinstall (VM-NO appendix).
  * Type `omarchy-reinstall-configs; echo rc=$?` — `Resetting Omarchy user configs to shipped defaults...`, sudo prompts for the limine/plymouth refresh, neovim refresh output, `rc=0`.
  * Type `cmp /etc/skel/.bashrc ~/.bashrc && echo restored` — `restored`.
  * Press Super+Enter — a fresh terminal opens normally with the restored shell config.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-refresh-limine` prints bootloader output; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The broken line; the root refusal; the declined reinstall with the line intact; the reset run with `rc=0`; `restored`; a new terminal.
  * If unsuccessful
  ** A failing refresh step's error, or `.bashrc` unchanged after the reset.
covers: bin/omarchy-reinstall, bin/omarchy-reinstall-configs

### remove-security-when-nothing-enabled   [VM-OK]
description: The security removers are safe on a stock disk where nothing was set up: sshd disable and sudoless-docker report cleanly, fingerprint is a no-op, and fido2 either no-ops or trips a pacman dependency error (recorded).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Remove` → `Security` — empty on a stock disk. Escape.
  * Open a terminal (Super+Enter) and type `omarchy-remove-security-sudoless-docker; echo rc=$?` — `Sudoless Docker is not enabled: prime is not in the docker group.`, `rc=0`, no reboot prompt.
  * Type `omarchy-remove-security-sshd; echo rc=$?` — green `Removing SSH server access.`, the stop/disable and firewall lines (sudo `prime`), no authorized-keys question, `The openssh package remains installed since it also provides the ssh client.`, `rc=0`.
  * Type `omarchy-remove-security-fingerprint; echo rc=$?` — the headline, `Removing fingerprint packages...` with no transaction, green completion line, `rc=0`.
  * Type `omarchy-remove-security-fido2; echo rc=$?` — record the outcome: either the green `FIDO2 authentication has been completely removed.` with `rc=0`, or pacman `removing libfido2 breaks dependency 'libfido2' required by openssh` with `rc=1` (a defect to file).
  * Type `ssh -V; sudo ufw status | grep -c 22/tcp` — ssh still works and `0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All four are idempotent; re-running any is harmless.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The empty Security submenu; each remover's output with its `rc`; the fido2 outcome captured clearly; `ssh -V` and `0`.
  * If unsuccessful
  ** A remover hanging on a prompt, or ssh broken afterwards.
covers: bin/omarchy-remove-security-sshd, bin/omarchy-remove-security-sudoless-docker, bin/omarchy-remove-security-fingerprint, bin/omarchy-remove-security-fido2, default/omarchy/omarchy-menu.jsonc (remove.security.*)

### remove-launcher-entry-webapp-and-errors   [VM-OK]
description: Pressing Delete on a stock web app in the Apps launcher removes it silently after a confirmation, cancelling keeps it, and the underlying command rejects unknown entries and missing arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Apps (Super+Alt+Space), type `zoom` — `Zoom` (a stock web app). Press Delete — dialog `Do you want to uninstall Zoom?`. Press Escape (or click the non-destructive option) — `Zoom` is still listed.
  * Press Delete again and click `Uninstall` with the mouse — the menu closes; no Float appears (web apps are removed silently).
  * Apps → `zoom` → no entry.
  * Open a terminal (Super+Enter) and type `omarchy-remove-launcher-entry; echo rc=$?` — `Usage: omarchy-remove-launcher-entry <desktop-id> <name>`, `rc=1`.
  * Type `omarchy-remove-launcher-entry nosuchapp Nope; echo rc=$?` — `Could not find launcher entry: nosuchapp.desktop`, `rc=1`.
  * Type `omarchy-remove-launcher-entry Basecamp Basecamp; echo rc=$?` — `rc=0`; Apps → `basecamp` → gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog's default is the non-destructive option; use the mouse if arrow keys do not move the highlight.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Zoom dialog; Zoom still present after cancel; Zoom gone after Uninstall with no Float; both CLI rejections with `rc=1`; Basecamp removed with `rc=0`.
  * If unsuccessful
  ** A Float or sudo prompt for a web app, or Zoom surviving `Uninstall`.
covers: bin/omarchy-remove-launcher-entry, shell/plugins/menu/Menu.qml (requestDeleteSelected/confirmDelete), applications/*.desktop

### install-service-nordvpn-no-reboot   [VM-PARTIAL] [NET]
description: Install → Service → NordVPN installs and enables the daemon, adds the user to the `nordvpn` group and offers a reboot; declining keeps the session up, and login is not possible in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Service` → `NordVPN`.
  ** Float: `Installing NordVPN...`, sudo `prime`, ~30 MB, `Enabling NordVPN daemon...`, `Adding user to nordvpn group...`, `NordVPN installed! After reboot, run 'nordvpn login' to authenticate.`, then `Reboot now to make NordVPN usable?` — choose **No**. `Done!`.
  * Open a terminal (Super+Enter) and type `systemctl is-active nordvpnd; id -nG | grep -c nordvpn` — `active` and `1`.
  * Type `nordvpn status` — a permission or "not logged in" message, not a crash.
  * Menu → Install → Service: `NordVPN` dim ✓; Menu → Remove → Services: no NordVPN row (no remover exists).
  * In the terminal type `omarchy-pkg-drop nordvpn-bin; systemctl is-active nordvpnd` — pacman removes it; `inactive`/`unknown`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes to the reboot within the test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output ending at the declined reboot and `Done!`; `active` and `1`; the `nordvpn status` message; dim row; cleanup.
  * If unsuccessful
  ** pacman/systemd errors, or a reboot despite No.
covers: bin/omarchy-install-service-nordvpn, default/omarchy/omarchy-menu.jsonc (install.service.nordvpn)

### install-service-sunshine-cli-only   [VM-PARTIAL] [NET]
description: Sunshine (CLI-only, no menu rows) installs its user service, firewall rules, `Sunshine Admin` web app and Hyprland autostart, and its remover reverts every piece; streaming itself (no GPU encoder, no client) is skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `sudo ufw status | grep -c omarchy-sunshine` (`prime`) — `0`.
  * Type `omarchy-install-service-sunshine` — `Installing Sunshine...`, pacman installs sunshine (~30 MB + deps), `Opening Sunshine firewall ports...`, `Installing Sunshine admin web app...` (a browser window for `https://localhost:47990` may open — a certificate/connection page is fine; close it with Super+W), `Enabling Sunshine autostart...`, the closing `...ports are open for private LANs and Tailscale.` line.
  * Type `sudo ufw status | grep -c omarchy-sunshine; grep sunshine ~/.config/hypr/autostart.lua; systemctl --user is-active sunshine` — `27`, `o.launch_on_start("sunshine")`, and `active` or `failed` (no encoder; record).
  * Open Apps (Super+Alt+Space), type `sunshine` — `Sunshine Admin` listed. Escape.
  * In the terminal type `omarchy-remove-service-sunshine` — pacman removes sunshine, `Sunshine has been removed and its Omarchy-managed Moonlight streaming ports have been closed.`
  * Type `sudo ufw status | grep -c omarchy-sunshine; grep -c sunshine ~/.config/hypr/autostart.lua` — `0` and `0`; Apps → `sunshine` → gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ufw output is long; the `grep -c` counts are what to read.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `0` before; the installer's step lines; `27`, the autostart line, the service state; the launcher entry; the remover's message; `0`/`0` and the entry gone.
  * If unsuccessful
  ** ufw or systemd errors, or leftover rules/autostart line after removal.
covers: bin/omarchy-install-service-sunshine, bin/omarchy-remove-service-sunshine

### install-service-dropbox-without-account   [VM-PARTIAL] [NET] [SLOW]
description: Install → Service → Dropbox installs the client, enables the bar plugin and starts the daemon (which downloads itself); without an account only install, bar indicator, status probe and Remove → Services → Dropbox are verified.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Service` → `Dropbox`.
  ** Float: `Installing all dependencies...`, sudo `prime`, five packages, `Adding Dropbox to the bar...`, `Starting Dropbox...`, `See Dropbox icon behind  hover tray in top right and right-click for setup.`, `Done!`.
  * Screenshot every 5 s for up to 3 min while the daemon downloads (~100 MB); a Dropbox indicator appears in the bar's tray area.
  * Open a terminal (Super+Enter) and type `dropbox-cli status; omarchy-installed-service-dropbox; echo rc=$?` — a starting/link-account status and `rc=0`.
  * Menu → Install → Service: `Dropbox` dim ✓. Menu → Remove → Services: `Dropbox` listed; click it → Float `Dropbox has been removed.` → `Done!`.
  * The bar indicator is gone; in the terminal type `omarchy-installed-service-dropbox; echo rc=$?` — `rc=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the daemon download stalls past 5 min, proceed to removal and mark that step SLOW.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output; the bar indicator; `dropbox-cli status` and `rc=0`; dim row and Remove row; removal `Done!`; indicator gone and `rc=1`.
  * If unsuccessful
  ** pacman errors, or the indicator/plugin surviving removal.
covers: bin/omarchy-install-service-dropbox, bin/omarchy-remove-service-dropbox, bin/omarchy-installed-service-dropbox, default/omarchy/omarchy-menu.jsonc (install.service.dropbox, remove.service.dropbox), test/shell.d/dropbox-test.sh

### install-editor-vscode-defaults   [VM-OK] [NET]
description: Install → Editor → VSCode installs VS Code with Omarchy's keyring, no-self-update and theme defaults and opens it; with no remover, the launcher's Delete key uninstalls it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Editor` → `VSCode`.
  ** Float: `Installing VSCode...`, sudo `prime`, ~110 MB (1–3 min), theme output, `Done!`. A VS Code window opens within ~20 s in the Omarchy colours; screenshot and close it (Super+W).
  * Open a terminal (Super+Enter) and type `grep password-store ~/.vscode/argv.json; cat ~/.config/Code/User/settings.json` — `"password-store":"gnome-libsecret"` and `"update.mode": "none"`.
  * Open Apps (Super+Alt+Space), type `code` — `Visual Studio Code` listed. Menu → Install → Editor: `VSCode` dim ✓.
  * Apps → `Visual Studio Code` → Delete → click `Uninstall` → Float `Uninstalling Visual Studio Code...`, sudo, `Done!`.
  * Apps → `code` → no entry; Menu → Install → Editor → `VSCode` enabled again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * VS Code's first window may show a welcome tab and a workspace-trust prompt; ignore them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output; the VS Code window; both config lines; launcher entry and dim row; the uninstall Float; the launcher without it.
  * If unsuccessful
  ** `Failed` text, or no window 30 s after `Done!`.
covers: bin/omarchy-install-editor-vscode, bin/omarchy-remove-launcher-entry, default/omarchy/omarchy-menu.jsonc (install.editor.vscode)

### dev-env-rust-rustup   [VM-OK] [NET] [SLOW]
description: The Rust environment installs through rustup's curl-pipe installer rather than mise, dims its row via `~/.rustup`, and its remover runs `rustup self uninstall`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Development` → `Rust`.
  ** Float: `Installing Rust...`, rustup downloads the stable toolchain (~200 MB, 2–5 min; screenshot every 5 s), `Rust is installed now. Great!`, `Done!`.
  * Open a new terminal (Super+Enter) and type `cargo --version` — `cargo 1.x`.
  * Menu → Install → Development: `Rust` dim ✓. Menu → Remove → Development → `Rust` → Float `Removing Rust...` → `Done!`.
  * New terminal: `cargo --version; ls -d ~/.rustup 2>&1` — `command not found` and `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the download exceeds the budget, Ctrl+C in the Float and report SLOW with the progress reached.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** rustup's completion line + `Done!`; the cargo version; dim row; removal; `command not found` and `~/.rustup` gone.
  * If unsuccessful
  ** The rustup/curl error.
covers: bin/omarchy-install-dev-env (rust), bin/omarchy-remove-dev-env (rust)

### install-editor-emacs-aur   [VM-OK] [NET] [SLOW]
description: Install → Editor → Emacs is the one editor that builds from the AUR (`omarchy-emacs`) and runs a follow-up setup; it must build, configure and open a themed `emacsclient` frame.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Editor` → `Emacs`.
  ** Float: `Installing Emacs...`, yay fetches `omarchy-emacs`, installs `emacs` (~50 MB) and builds the package (sudo `prime` when asked; several minutes), `omarchy-install-emacs` setup output, `Done!`.
  ** If yay asks `Diff to show?` / `Proceed?`, answer `N` / `Y` and report that `--noconfirm` was not honoured.
  * Within ~30 s an Emacs frame opens (the daemon starts first) in the Omarchy theme colours; screenshot and close it (Super+W).
  * Open Apps (Super+Alt+Space), type `emacs` — an Emacs entry is listed. Menu → Install → Editor: `Emacs` dim ✓.
  * Open a terminal (Super+Enter) and type `omarchy-pkg-drop omarchy-emacs emacs` — pacman removes both; Apps → `emacs` → gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The AUR build on 2 vCPUs may approach the budget; keep screenshotting rather than waiting silently.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The AUR build output and `Done!`; the themed frame; the launcher entry and dim row; the cleanup.
  * If unsuccessful
  ** yay/makepkg error text, or `Done!` with no frame after 60 s.
covers: bin/omarchy-install-editor-emacs, bin/omarchy-pkg-aur-add, default/omarchy/omarchy-menu.jsonc (install.editor.emacs)

### install-ai-openclaw-onboarding-cancel   [VM-PARTIAL] [NET] [SLOW]
description: Install → AI → OpenClaw installs the package and Control UI web app and then starts an interactive onboarding wizard; aborting the wizard must leave a removable state, and Remove → AI → OpenClaw must not delete `~/.openclaw` unasked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `AI` → `OpenClaw`.
  ** Float: `Installing OpenClaw...`, sudo `prime`, ~150 MB (2–4 min), `Installing the OpenClaw web app...`, then the first onboarding prompt.
  * Screenshot the prompt, then press Ctrl+C. Record whether the Float closes silently (exit 130) or shows `Failed`/`If you skipped onboarding, launching OpenClaw from the app grid resumes it.`
  * Open Apps (Super+Alt+Space), type `openclaw` — an `OpenClaw` entry is listed (the web app). Escape.
  * Open a terminal (Super+Enter) and type `ls ~/.openclaw/openclaw.json 2>&1; systemctl --user is-active openclaw-gateway.service` — `No such file` and `inactive`/not-found (onboarding never finished).
  * Menu → Install → AI: `OpenClaw` dim ✓. Menu → Remove → AI → `OpenClaw` → Float: pacman removes openclaw; if asked `Also delete ~/.openclaw (...)?` answer **No**; `OpenClaw has been removed.`, `Done!`.
  * Apps → `openclaw` → gone; in the terminal `omarchy-pkg-present openclaw; echo $?` — `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not complete onboarding: it needs API credentials and starts a gateway service.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output; the wizard prompt; the launcher entry; no config and no gateway; dim row; removal output; entry gone and `1`.
  * If unsuccessful
  ** A gateway left running, or the remover's `Could not stop ...; OpenClaw was not removed.` text.
covers: bin/omarchy-install-ai-openclaw, bin/omarchy-remove-ai-openclaw, default/omarchy/omarchy-menu.jsonc (install.ai.openclaw, remove.ai.openclaw), test/shell.d/remove-ai-test.sh

### install-gaming-steam   [VM-NO] [NET] [SLOW]
description: Install → Gaming → Steam installs Steam with lib32 drivers and launches it, and Remove → Gaming → Steam wipes it with its libraries; needs a real GPU vendor and ~800 MB of downloads, so not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Steam`; sudo `prime`; wait for `Steam will start automatically now. This might take a while...` and `Done!`.
  ** On hardware with no Intel/AMD/NVIDIA GPU the Float ends `Failed (exit code 1)` before this line (gpu-lib32 helper).
  * The Steam bootstrap window appears; screenshot and close it.
  * Open Apps (Super+Alt+Space), type `steam` — `Steam` listed; Menu → Install → Gaming: `Steam` dim ✓.
  * Menu → Remove → Gaming → `Steam` → Float `Steam and its data have been removed.` → `Done!`.
  * Apps → `steam` → gone; in a terminal `ls -d ~/.steam ~/.local/share/Steam 2>&1` — both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Steam's own runtime download (~500 MB) happens after launch; do not wait for it to finish before screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Done!`, the Steam window, the launcher entry, the removal message and missing directories.
  * If unsuccessful
  ** The `Failed` banner and the output above it.
covers: bin/omarchy-install-gaming-steam, bin/omarchy-remove-gaming-steam, bin/omarchy-install-gaming-gpu-lib32

### install-gaming-retroarch   [VM-NO] [NET] [SLOW]
description: Install → Gaming → RetroArch installs RetroArch with ~45 libretro cores and a `~/Games` layout and opens the ROM folder; removal drops the cores but keeps ROMs and BIOS files. Over 1 GB — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `RetroArch`; sudo `prime`; wait for `Put your roms and bios files in ~/Games. Then start RetroArch from the app launcher (Super + Space).` and `Done!`.
  * A Nautilus window for `~/Games` opens showing `bios` and `roms`; screenshot and close it.
  * Open Apps (Super+Alt+Space), type `retro` — `RetroArch` listed; launch it and confirm the XMB menu with the CRT shader; close it.
  * Menu → Remove → Gaming → `RetroArch` → Float `RetroArch and its cores have been removed.` / `ROMs and BIOS files at ~/Games/roms and ~/Games/bios were left in place.` → `Done!`.
  * In a terminal `ls ~/Games` — `bios` and `roms` still present; Apps → `retro` → gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * RetroArch needs Vulkan; on a software-only GPU it may fall back or fail to start — report what it does.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The closing message and `Done!`; the `~/Games` window; RetroArch running; the removal messages; `bios`/`roms` kept.
  * If unsuccessful
  ** The `Failed` banner and the pacman output above it.
covers: bin/omarchy-install-gaming-retroarch, bin/omarchy-remove-gaming-retroarch

### install-gaming-lutris   [VM-NO] [NET] [SLOW]
description: Install → Gaming → Lutris installs Lutris with Wine, umu and winetricks, pins its Python shebang and launches it; removal drops all of it with the Wine caches. ~600 MB and a GPU — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Lutris`; sudo `prime`; wait for the note `Lutris will open and auto-fetch its DXVK and VKD3D runtimes in the background...` and `Done!`.
  ** On hardware with no Intel/AMD/NVIDIA GPU the Float ends `Failed (exit code 1)` before this (gpu-lib32 helper).
  * The Lutris window opens; screenshot its status bar fetching runtimes; close it.
  * Open Apps (Super+Alt+Space), type `lutris` — listed; Menu → Install → Gaming: `Lutris` dim ✓.
  * Menu → Remove → Gaming → `Lutris` → Float `Lutris, Wine, umu-launcher, and their configs have been removed.` → `Done!`.
  * Apps → `lutris` → gone; in a terminal `ls -d ~/.wine ~/.config/lutris 2>&1` — both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shebang pin means `lutris` runs even when mise's Python is first on PATH; a Python import error at launch is the failure to report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The note and `Done!`; the Lutris window; launcher entry and dim row; the removal message; missing directories.
  * If unsuccessful
  ** The `Failed` banner or a Python traceback from Lutris.
covers: bin/omarchy-install-gaming-lutris, bin/omarchy-remove-gaming-lutris, bin/omarchy-install-gaming-gpu-lib32

### install-gaming-heroic   [VM-NO] [NET] [SLOW]
description: Install → Gaming → Heroic installs the Heroic launcher with lib32 drivers and opens it; removal wipes its config, library and `~/Games/Heroic`. ~120 MB plus a GPU dependency — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Heroic (Epic Games)`; sudo `prime`; wait for `Done!`.
  ** On hardware with no Intel/AMD/NVIDIA GPU the Float ends `Failed (exit code 1)` before launching (gpu-lib32 helper).
  * The Heroic window opens; screenshot and close it.
  * Open Apps (Super+Alt+Space), type `heroic` — listed; Menu → Install → Gaming: `Heroic (Epic Games)` dim ✓.
  * Menu → Remove → Gaming → `Heroic (Epic Games)` → Float `Heroic and its data have been removed.` → `Done!`.
  * Apps → `heroic` → gone; in a terminal `ls -d ~/.config/heroic ~/Games/Heroic 2>&1` — both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Heroic is Electron; allow 20 s for the first window.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Done!`; the Heroic window; launcher entry and dim row; the removal message; missing directories.
  * If unsuccessful
  ** The `Failed` banner and the output above it.
covers: bin/omarchy-install-gaming-heroic, bin/omarchy-remove-gaming-heroic, bin/omarchy-install-gaming-gpu-lib32

### install-gaming-battlenet   [VM-NO] [NET] [SLOW]
description: Install → Gaming → Battle.net downloads the installer and runs it under umu/GE-Proton in the background, adds a launcher entry, and removal wipes the prefix while asking about umu and GE-Proton. ~500 MB of runtimes and a GPU — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Battle.net`; sudo `prime`; wait for `Downloading Battle.net installer...`, the wizard note, `The Battle.net installer is running in the background...` and `Done!`.
  ** On hardware with no Intel/AMD/NVIDIA GPU the Float ends `Failed (exit code 1)` earlier (gpu-lib32 helper).
  * Screenshot the Battle.net setup wizard as it appears; click through it with defaults.
  * Open Apps (Super+Alt+Space), type `battle` — `Battle.net` listed; Menu → Install → Gaming: `Battle.net` dim ✓.
  * Menu → Remove → Gaming → `Battle.net` → Float: `Battle.net and its Proton prefix at ~/Games/battlenet have been removed.`, then `Also remove umu-launcher?` **Yes** and `Also remove GE-Proton runtimes downloaded by umu?` **Yes**, `Done!`.
  * Apps → `battle` → gone; in a terminal `ls -d ~/Games/battlenet 2>&1` — `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Re-running Install after an interrupted wizard asks `Wipe the partial prefix and start fresh?`; answer Yes to retry.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer's messages and `Done!`; the wizard; launcher entry and dim row; the removal messages with both Yes answers; the prefix gone.
  * If unsuccessful
  ** The `Failed` banner, or `/tmp/omarchy-battlenet-installer.log` read via `cat ... | sudo tee /dev/ttyS0`.
covers: bin/omarchy-install-gaming-battlenet, bin/omarchy-remove-gaming-battlenet, bin/omarchy-install-gaming-gpu-lib32, test/shell.d/battlenet-test.sh

### install-gaming-geforce-now   [VM-NO] [NET] [SLOW]
description: Install → Gaming → NVIDIA GeForce NOW installs Flatpak, runs NVIDIA's setup binary and opens a browser for login; removal uninstalls the Flatpak with its data. ~1 GB of Flatpak runtime — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `NVIDIA GeForce NOW`; sudo `prime`; wait through the Flatpak install and the GeForce NOW setup output to `Done!`.
  * A browser window opens (the installer launches one so GFN's login does not hang); screenshot and close it.
  * Open Apps (Super+Alt+Space), type `geforce` — the GeForce NOW entry is listed; Menu → Install → Gaming: `NVIDIA GeForce NOW` dim ✓.
  * Menu → Remove → Gaming → `NVIDIA GeForce NOW` → Float `GeForce NOW removed.` → `Done!`.
  * Apps → `geforce` → gone; in a terminal `flatpak info com.nvidia.geforcenow; echo $?` — an error and `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * NVIDIA's setup binary runs in the Float and may prompt; answer its defaults.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Done!`; the browser window; launcher entry and dim row; `GeForce NOW removed.`; `flatpak info` failing with `1`.
  * If unsuccessful
  ** The `Failed` banner or the setup binary's error text.
covers: bin/omarchy-install-gaming-geforce-now, bin/omarchy-remove-gaming-geforce-now

### install-ai-hermes-desktop   [VM-NO] [NET] [SLOW]
description: Install → AI → Hermes Desktop installs the package, clones and builds the Hermes runtime under `~/.hermes` and opens the app; the remover refuses while the app runs and asks before deleting user data. Minutes of builds and hundreds of MB — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `AI` → `Hermes Desktop`; sudo `prime`; wait for `Setting up the Hermes runtime...`, `Opening Hermes Desktop...`, `Matching Hermes to the current theme once it is set up...`, `Hermes Desktop has been installed.`, `Done!`.
  * The Hermes window opens; screenshot it and leave it running. In a terminal type `omarchy-install-hermes-cli --owns; echo $?; omarchy-install-hermes-cli --check; echo $?` — `1` then `0` (the app now owns `hermes`).
  * Menu → Remove → AI → `Hermes Desktop` — Float: `Close Hermes and processes using its files before removing it (PIDs: ...)` and `Failed`. Press a key.
  * Close Hermes (Super+W). Menu → Remove → AI → `Hermes Desktop` again; at `Also delete ~/.hermes and ~/.config/Hermes (...)?` choose **No**; `Hermes Desktop has been removed.` and `Your chats, memories, and skills are still in ~/.hermes`.
  * Apps (Super+Alt+Space) → `hermes` → no desktop entry; in the terminal `ls -d ~/.hermes` — still present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The runtime bootstrap can take 10+ minutes on 2 vCPUs; keep screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer's step lines and the window; `1`/`0`; the refused removal while running; the completed removal keeping `~/.hermes`.
  * If unsuccessful
  ** The installer's guidance (e.g. `Run 'omarchy update', then try again.`) or the remover's stderr.
covers: bin/omarchy-install-ai-hermes, bin/omarchy-remove-ai-hermes, bin/omarchy-install-hermes-cli, test/shell.d/hermes-desktop-install-test.sh, test/shell.d/hermes-remove-test.sh

### windows-vm-full-install-launch-remove   [VM-NO] [NET] [SLOW]
description: The full Windows VM story — resource prompts, privileged compose, Windows 11 download, RDP launch with auto-stop, status box, removal — needs ≥ 74 GB free, nested KVM and a multi-GB download; recorded for hardware runs.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Windows`; accept the defaults through RAM (4G), cores (2), disk (64G), username (`docker`), password; confirm the summary box; authorize the polkit prompt (`prime`); see `Monitor installation progress at: http://127.0.0.1:8006` and the browser opening; wait for Windows to finish installing (screenshot every 5 s).
  * Open Apps (Super+Alt+Space), type `windows`, Enter — `Connecting to Windows VM` box, then a full-screen FreeRDP window titled `Windows VM - Omarchy`.
  * Close the RDP window — `RDP session closed. Stopping Windows VM...` / `Windows VM stopped.`
  * In a terminal type `omarchy-windows-vm status` — `Windows VM is stopped (status: exited)`; type `omarchy-windows-vm launch -k`, close RDP — `Windows VM is still running.`; `omarchy-windows-vm status` — the `Windows VM Status: RUNNING` box; `omarchy-windows-vm stop` — `Windows VM stopped.`
  * Menu → Remove → `Windows` → **Yes** → `Windows VM removal completed!`; Apps → `windows` → gone; `ls -d ~/.windows ~/.config/windows 2>&1` — both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each privileged step prompts polkit unless sudoless Docker is enabled.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The configuration box, the progress URL, the RDP window with the expected title, the status outputs, the removal message.
  * If unsuccessful
  ** The `❌ Failed to start Windows VM!` block and `omarchy-windows-vm status` output.
covers: bin/omarchy-windows-vm (install/launch/stop/status/remove), test/shell.d/windows-vm-test.sh, test/shell.d/windows-vm-compose-test.sh

### reinstall-full-packages   [VM-NO] [NET] [SLOW]
description: `omarchy-reinstall` (Yes path) switches to stable mirrors, downgrades newer packages, reinstalls every base package and resets configs, then offers a reboot — a full system transaction beyond the session budget on a 4.0.2 disk.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-reinstall`; choose **Yes**; sudo `prime`.
  * Watch the mirror refresh, the `-Suu` downgrade and the `-Syu --needed <base packages>` transaction (screenshot every 5 s), then `Resetting Omarchy user configs to shipped defaults...`.
  ** A `Woah partner` message here would be a bug: the reinstall sets `OMARCHY_UPDATE_PACMAN=1` to bypass the guard.
  * At `System has been reinstalled. Reboot?` choose **No**.
  * Type `pacman -Qi omarchy | grep -i version; cmp /etc/skel/.bashrc ~/.bashrc && echo restored` — the stable version and `restored`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Pipe long pacman output with `| sudo tee /dev/ttyS0` and read it with get-serial if the terminal scrolls too fast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The two pacman transactions completing, the config reset line, the declined reboot, the version check and `restored`.
  * If unsuccessful
  ** pacman's error or the guard message.
covers: bin/omarchy-reinstall, bin/omarchy-reinstall-pkgs, bin/omarchy-reinstall-configs, default/pacman/*, default/libalpm/hooks/00-omarchy-update-guard.hook

## Gaps

- **Login-gated services**: Tailscale (browser auth), Dropbox (account link), NordVPN (`nordvpn login`), 1Password/Bitwarden/Signal/Spotify sign-in, Battle.net/Heroic/Steam accounts, OpenClaw onboarding credentials — only the pre-login software path is testable. Taildrop send/receive with a real peer (`omarchy-tailscale-send <machine>`, the `omarchy-tailscale-receive.service` announcing a file) cannot be driven without a second tailnet node.
- **Hardware-gated**: `omarchy-install-gaming-gpu-lib32` selecting lib32 Vulkan/NVIDIA packages (needs a matching GPU); `xpadneo` pairing (Bluetooth + controller); Voxtype dictation itself (microphone) and its Vulkan GPU path; Sunshine encoding/Moonlight pairing; `omarchy-windows-key` reading a real MSDM table; `omarchy-remove-security-fingerprint` on a machine with fprintd enrolled; `omarchy-remove-security-fido2` with a real key enrolled.
- **Budget-gated (> 10 min or > ~300 MB)**: Steam, RetroArch, Lutris, Heroic, Battle.net, GeForce NOW, LM Studio, Cursor, Chrome/Edge/Brave/Brave Origin/Zen (AUR downloads of 100–170 MB binaries), Hermes Desktop, Hermes CLI `--now` (Python 3.13 + Hermes), Elixir/Phoenix (erlang source build), OCaml (opam builds), Java/.NET/Scala/Clojure (~200 MB+ JDKs), Ruby on Rails (gem install), Laravel/Symfony (composer + node), Windows VM install, `omarchy-reinstall-pkgs`, the real `pacman -Syu` hook trigger. Listed in the VM-NO appendix tests above where they have distinct user-visible behaviour.
- **Interactive TUIs with side effects**: `omarchy-install-service-once` ends in `sudo once` (ONCE's own TUI, enables a system service) — not scripted here because the TUI's flow is external to Omarchy; `omarchy-install-docker-dbs` for MySQL/PostgreSQL/MariaDB/MongoDB/MSSQL (120–500 MB images) — only Redis is exercised.
- **Provisioning-time behaviour**: `install/user/mise.sh` writing the agent stubs, the Voxtype first-run invitation toast (`install/user/first-run/install-voxtype.hook`, covered by `voxtype-invitation-test.sh`) and the `10-/90-omarchy-hyprland-reload-*.hook` pause/resume around `omarchy-settings` upgrades only fire during install/update flows owned by other reviewers; here they are only asserted to exist.
- **Migration paths**: `omarchy-windows-vm`'s legacy `~/.config/windows/docker-compose.yml` migration, the mise `--quiet` wrapper migration and Work-path migration (`mise-*-migration-test.sh`), the Hermes CLI/skills/skin migrations — need a pre-migration disk state the minted 4.0.2 image may or may not have; not proposed as driver tests.
- **Menu rows without installers in this scope**: Install → Style → Theme/Background, Install → Web App, Install → TUI, Remove → Theme/Web App/TUI, Install → Gaming → RetroArch Game Launcher (`omarchy-games-retro-install`), Install → Development → Ruby on Rails (mise ruby + rails gems, SLOW) — belong to the theme/webapp/tui/games reviewers except where used incidentally above.
- **Same story, different package — not proposed separately**: Signal, Spotify, Bitwarden, Grok Bot, Perplexity, Minecraft, Cursor, Zed follow the `install-and-launch-sublime-text` / `install-editor-vim-menu-and-launcher-uninstall` story with larger downloads; Bun, Deno, Go, Zig, Java, .NET, Clojure, Scala follow `dev-env-node-menu-and-cli-round-trip` (mise runtime in, mise runtime out). Their remover-specific behaviour, where any exists, is in the Inventory.
- **Not directly observable**: `omarchy-pkg-add`'s root branch (plain `pacman` when `EUID == 0`), `omarchy-install-chromium-claude`'s `pkexec` branch (only when stdin is not a tty — the menu never calls it directly), `omarchy-remove-ai-perplexity`/`-openclaw`/`-hermes` skipping their data question when stdin/stderr is not a tty (the Float always is a tty).
