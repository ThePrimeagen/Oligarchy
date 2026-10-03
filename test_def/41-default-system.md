# 41 — Default system: shell, login, boot, services, privileges, browser extras, app defaults

Reviewer notes for omarchy @ HEAD `d174d4aa` (2026-09-18). Source tree `/tmp/omarchy-review/omarchy`.
Read alongside `00-FORMAT.md`. The minted disk is 4.0.2; everything below is written from HEAD and
flagged where 4.0.2 may differ.

## Scope

Read completely (line counts are `wc -l`):

- `default/**` except `default/hypr` and `default/themed` — 104 text files, 4261 lines, plus 16 binary
  assets (`plymouth/*.png`, `sddm/omarchy/*.png`, `fonts/omarchy/omarchy.ttf`, `chromium/extensions/yt-dlp/icon.png`)
  which were inventoried but not opened. Breakdown:
  - `default/bashrc`, `default/bash/{rc,shell,aliases,completions,env-bootstrap,envs,functions,init,inputrc}`,
    `default/bash/fns/{compression,drives,herdr,rsyncing,ssh-port-forwarding,ssh-reconnect,tmux,worktrees}` — 890 lines
  - `default/sddm/{hyprland.lua,omarchy/Main.qml,omarchy/theme.conf,omarchy/metadata.desktop}`
  - `default/plymouth/{omarchy.plymouth,omarchy.script}`
  - `default/limine/{default.conf,limine.conf}`, `default/snapper/root`
  - `default/systemd/**` (19 files: 8 user units, app.slice drop-in, zram, system-sleep hooks, camlink units, plocate/supergfxd drop-ins, faster-shutdown)
  - `default/uwsm/{default,env.d/10-omarchy}`, `default/wayland-sessions/omarchy.desktop`
  - `default/pacman/*` (3 confs + 3 mirrorlists), `default/libalpm/hooks/*` (3 hooks)
  - `default/udev/*`, `default/v4l2-relayd/camlink.conf`, `default/wireplumber/**`, `default/audio/**`
  - `default/fontconfig/conf.avail/50-omarchy.conf`, `default/fonts/omarchy/README.md`
  - `default/chromium/**` (3 extensions, 2 native-messaging manifests), `default/firefox/policies.json`
  - `default/gpg/dirmngr.conf`, `default/environment.d/10-omarchy-fcitx.conf`, `default/xdg-terminal-exec/hyprland-xdg-terminals.list`
  - `default/tensaku/state.toml`, `default/voxtype/config.toml`
  - `default/nautilus-python/extensions/{localsend,transcode}.py`
  - `default/agents/skills/omarchy/{SKILL,capture,contributing,hooks,hyprland,plugins,theming}.md`,
    `default/agents/skills/diagnose-crash/{SKILL,reporting}.md`
  - `default/omarchy/{omarchy-menu.jsonc,launcher.hides}` — read for context only (menu owner is another reviewer)
  - loose: `default/xcompose`, `default/applications/{mimeapps.list,battlenet.desktop}`,
    `default/alacritty/{Alacritty.desktop,screensaver.toml}`, `default/foot/screensaver.ini`, `default/ghostty/screensaver`
- `applications/*.desktop` (16 files, 146 lines) + `applications/icons/` (18 PNGs, names inventoried).
- `etc/**` — 41 files, 574 lines.
- `config/**` except `config/hypr` — 33 files, 1330 lines (`btop.conf` 272, `xournalpp/settings.xml` 268 skimmed for user-visible settings only).
- `docs/file-layout.md` — 369 lines.
- Maintainer invariants skimmed: `test/shell.d/{systemd,sudo-docker,sudoless-docker-posture,sudoless-docker-toggle,browser-env,browser-policy-dir,browser-policy-sudoers,chromium-copy-url,chromium-whatsapp-slim,chromium-ytdlp,cups-hardening,firewall-config,polkit,locale-env,editor-env,dev-env-path,unowned-system-paths,kitty-config,default-agent,nvidia-kms-hook,limine-defaults,timezone,emojis,herdr-functions}-test.sh`;
  `test/acceptance.d/{cups,security,system}-test.sh`.
- For context on what the guest actually contains (not in scope, read only to size tests):
  `install/config/{firewall,docker,enable-services,increase-lockout-limit,ssh-command-path}.sh`,
  `install/login/sddm.sh`, `install/user/{git,xcompose,chromium}.sh`, `install/user/first-run/{welcome,enable-user-units}.sh`,
  `install/omarchy-base.packages`, and the `bin/` entry points named by the files above
  (`omarchy-system-logout`, `omarchy-launch-webapp`, `omarchy-launch-docker-tui`, `omarchy-sudo-passwordless`,
  `omarchy-update-pacman-guard`, `omarchy-chromium-{copy-url,ytdlp}-host`, `omarchy-menu-timezone`, `omarchy-dns`, `omarchy-agent`).
  Hotkeys quoted below come from `default/hypr/bindings/*.lua` (Super+Return terminal, Super+Shift+Return browser,
  Super+Alt+Return tmux, Super+Ctrl+Return herdr, Super+Shift+D docker, Super+Space menu, Super+Escape system menu,
  Super+Alt+Space apps, Super+K keybindings, Super+Shift+F Nautilus); the compose key is CapsLock (`default/hypr/input.lua`).

Skipped: `default/hypr`, `default/themed`, `config/hypr` (other reviewer); the menu's own structure (other reviewer).

## Inventory

**Shell start-up chain** (`default/bashrc`, `default/bash/*`)
- `~/.bashrc` (from `default/bashrc`): sources `env-bootstrap`, returns for non-interactive, sources `default/bash/rc`, then a user section ("Add your own exports, aliases, and functions here"). — `default/bashrc`
- `rc`: sources `envs`, `shell`, `aliases`, `functions`, `init`, then `bind -f inputrc` for interactive shells. — `default/bash/rc`
- `env-bootstrap`: sets `OMARCHY_PATH=/usr/share/omarchy` (or `/etc/omarchy.conf` in dev-link), prepends `$OMARCHY_PATH/bin` only in dev-link mode, appends `~/.local/share/mise/shims` and `~/.local/bin` to PATH. Sourced by `/etc/profile.d/omarchy.sh`, `~/.bashrc`, uwsm env.d, `envs`. — `default/bash/env-bootstrap`, `etc/profile.d/omarchy.sh`
- `envs`: `EDITOR="omarchy-launch-editor --inline"`, `SUDO_EDITOR=$EDITOR`, `BROWSER=omarchy-launch-browser` (shell-scoped only), `BAT_THEME=ansi`, `MANROFFOPT=-c`, `MANPAGER="sh -c 'col -bx | bat -l man -p'"`, LANG fallback from `/etc/locale.conf` else `C.UTF-8` for non-login shells. — `default/bash/envs`
- `shell`: `histappend`, `HISTCONTROL=ignoreboth`, `HISTSIZE=32768`, bash-completion sourced, `set +h` (no command hashing, for mise). — `default/bash/shell`
- `init`: `mise activate bash`, `starship init bash` (interactive, non-dumb TERM), `zoxide init bash`, lazy `try()` wrapper (`try init ~/Work/tries`), fzf completion + key-bindings (`Ctrl+R` history, `Ctrl+T` files, `Alt+C` cd), then `completions`. — `default/bash/init`
- `functions`: sources every file in `default/bash/fns/*`. — `default/bash/functions`
- `inputrc`: case-insensitive completion, `show-all-if-ambiguous`, Up/Down = `history-search-backward/forward` (prefix search), `mark-symlinked-directories`, hidden files not completed unless dot typed, `page-completions off`, query above 200 items, `visible-stats`, `skip-completed-text`, `colored-stats`, `TAB: menu-complete`, `Shift+Tab: menu-complete-backward`, `menu-complete-display-prefix on`. — `default/bash/inputrc`
- `completions`: `complete -F _omarchy_complete omarchy` — completes groups/actions from `omarchy-*` binaries, adds `commands` at word 1 and `--all --json --markdown --check` after `commands`, then arg completion from `# omarchy:args=` headers. `complete -I -A command -X 'omarchy-*'` hides `omarchy-*` binaries from first-word completion. — `default/bash/completions`

**Aliases** (`default/bash/aliases`)
- `ls` → `eza -lh --group-directories-first --icons=auto`; `lsa` → `ls -a`; `lt` → `eza --tree --level=2 --long --icons --git`; `lta` → `lt -a` (only if eza present).
- `ff` → fzf with bat preview (kitty variant uses `kitty icat` for images when `TERM=xterm-kitty`); `eff` → `$EDITOR "$(ff)"`.
- `sff <dest>` (function) — pick most-recent file with `ff`, `scp` to dest; no arg → "Usage: sff <destination> (e.g. sff host:/tmp/)" and return 1.
- `cd` → `zd` (function, if zoxide): no arg → `~`; existing dir → `builtin cd`; else `z "$@"`, on failure prints "Error: Directory not found" return 1, on success prints a folder glyph (`\U000F17A9`) and `pwd`.
- `open <args>` (function) — `xdg-open "$@"` detached, output silenced.
- `..`, `...`, `....` → `cd ..` / `../..` / `../../..`.
- Tools: `a` → `omarchy-agent --inline`; `c` → `opencode --auto`; `cx` → clear screen + `claude --permission-mode auto`; `cy` → `codex --approve-for-me`; `d` → `docker`; `r` → `rails`; `t` → `tmux attach || tmux new -s Work`; `h` → `herdr`; `ic` → `tdl c`; `ix` → `tdl cx`; `icx` → `tdl c cx`; `mup` → `MISE_MINIMUM_RELEASE_AGE=0 mise up`.
- `n [args]` (function) — `nvim .` with no args, else `nvim "$@"`.
- Git: `g` → `git`; `gcm` → `git commit -m`; `gcam` → `git commit -a -m`; `gcad` → `git commit -a --amend`.

**Shell functions** (`default/bash/fns/*`)
- `compress <dir>` → `<dir>.tar.gz`; `decompress` alias → `tar -xzf`. No arg guard: `compress` with no args runs `tar -czf .tar.gz ""` and tar errors. — `fns/compression`
- `iso2sd <iso> [device]` — usage text when no args; with no device lists `/dev/sd*` via `omarchy-drive-select`, "No SD drives found and no drive specified" when none; then `sudo dd` + `sudo eject`. — `fns/drives`
- `format-drive <device> <name>` — wrong arg count prints usage + "Available drives:" from `lsblk`; otherwise "WARNING: This will completely erase all data on $1…" and `read -rp "Are you sure you want to continue? (y/N): "`; on `y` wipefs/dd/parted/mkfs.exfat. — `fns/drives`
- `hdl <ai> [ai2]`, `hds`, `hdlm <ai> [ai2]`, `hsl <count> <cmd>` — herdr layouts; each prints "Usage: …" without args (`hds` prints usage if given any arg) and "You must start herdr to use X." when `$HERDR_PANE_ID` is unset. `_herdr_ratio`, `_herdr_split` helpers. — `fns/herdr`
- `rsw <src> <dest>` — background `inotifywait`+`rsync` watcher with SSH ControlMaster socket under `$XDG_RUNTIME_DIR`; prints "Watching src -> dest"; usage on wrong arg count. `lsw` lists "pid: src -> dest" or "No active watches"; `dsw` kills watcher process groups, "Stopped watch (pid N)" or "No active watches". — `fns/rsyncing`
- `fip <host> <port…>` — `ssh -f -N -L port:localhost:port host`, prints "Forwarding localhost:P -> host:P"; usage with <2 args. `dip <port…>` — pkill, "Stopped forwarding port P" / "No forwarding on port P"; usage with 0 args. `lip` — pgrep list or "No active forwards". — `fns/ssh-port-forwarding`
- `ssh` wrapper — runs `command ssh`, on return disarms mouse/focus/alt-screen modes (`_ssh_disarm`), and if rc=255, stdin/stdout are ttys, the invocation was interactive (`_ssh_interactive`: destination, no remote command, `ssh -G` shows no RemoteCommand) and the session lasted ≥30 s, loops "Connection lost. Reconnecting (Ctrl-C to stop)..." every 2 s. Fast failures (<30 s) return immediately. — `fns/ssh-reconnect`
- `tdl <ai> [ai2]` — rename window to `basename $PWD`, split 15% bottom terminal, 30% right AI pane (optionally split for ai2), run `$EDITOR .` in the left pane. Usage without args, "You must start tmux to use tdl." outside tmux. Note: final `tmux select-pane -t "$opencode_pane"` references an unset variable (targets current pane; harmless). — `fns/tmux`
- `tds` — 2×2: `nvim .`, `hunk diff --watch`, terminal, `opencode`. `tds x` → "Usage: tds". `hunk` and `opencode` are not in the base package set, so two panes show "command not found" on a stock install. — `fns/tmux`
- `tdlm <ai> [ai2]` — renames session to cwd basename (dots/colons → `-`), one `tdl` window per subdirectory. — `fns/tmux`
- `tsl <count> <cmd>` — N tiled panes each running cmd; usage when either arg missing. — `fns/tmux`
- `ga <branch>` — `git worktree add -b <branch> ../<repo>--<branch>`, `mise trust`, `cd` into it; "Usage: ga [branch name]" without args. `gd` — `gum confirm "Remove worktree and branch?"`, then only when cwd matches `<root>--<branch>` removes the worktree and `git branch -D`. — `fns/worktrees`

**Prompt / tools config** (`config/*`)
- Starship: `format = "[$directory$git_branch$git_status]($style)$character"`, success `❯` bold cyan, error `✗` bold cyan, directory truncated to 2 with `…/`, repo root bold cyan, git branch italic cyan, status glyphs (`⇡N`, `⇣N`, `?`, etc.), `command_timeout = 200`, `add_newline = true`. — `config/starship.toml`
- Git: aliases `co br ci st`; `init.defaultBranch = master`; `pull.rebase = true`; `push.autoSetupRemote = true`; `diff.algorithm = histogram`, `colorMoved = plain`, `mnemonicPrefix`; `commit.verbose`; `column.ui = auto`; `branch.sort = -committerdate`; `tag.sort = -version:refname`; `rerere.enabled + autoupdate`. `user.name`/`user.email` are set at install from `OMARCHY_USER_NAME/EMAIL` only if provided (`install/user/git.sh`). — `config/git/config`
- tmux: prefix `C-Space` (prefix2 `C-b`); `prefix q` reload ("Configuration reloaded"); `prefix ?` popup of keybindings (`omarchy-menu-tmux-keybindings --print | less -R`); vi copy mode (`v`/`y`); `M-Enter` split vertical, `M-S-Enter` split horizontal, `M-Escape` kill pane; `prefix h/v/x` same; `C-M-Arrows` focus, `C-M-S-Arrows` resize 5; `prefix r` rename window, `prefix c` new window, `prefix k` kill window; `M-1..9` select window; `M-Left/Right` prev/next window; `M-S-Left/Right` move window; `prefix R/C/K/P/N` session rename/create/kill/prev/next; `M-Up/Down` prev/next session; mouse on, base-index 1, renumber, history 50000, status at top, status-left ` #S ` on blue, status-right shows `COPY`/`PREFIX`/`ZOOM` flags + hostname, `automatic-rename-format '#{b:pane_current_path}'`, `set-titles-string '#h:#W'`, `extended-keys csi-u`. — `config/tmux/tmux.conf`
- herdr: mirrors tmux (prefix `ctrl+space`, `prefix+q` reload, `prefix+?` help, `alt+enter`/`alt+shift+enter` splits, `alt+esc` close, `alt+1..9` tabs, `alt+left/right` tabs, `alt+up/down` workspaces, `ctrl+alt+arrows` focus, `ctrl+alt+shift+arrows` resize), theme "terminal", `new_cwd = follow`, `confirm_close = false`, `mouse_capture = true`, window title `{hostname}: {workspace}`. — `config/herdr/config.toml`
- lazygit: empty config file (all defaults). — `config/lazygit/config.yml`
- btop: `color_theme = "current"` (Omarchy theme), `vim_keys = true`, rounded corners, braille graphs, boxes `cpu mem net proc`, 2000 ms update, `proc_sorting = "cpu lazy"`, `proc_mem_bytes`, temps in celsius, clock `%X`, `show_battery = true`, `save_config_on_exit = true`. — `config/btop/btop.conf`
- imv binds: `Ctrl+p` print (`lp`), `Ctrl+x` trash + quit, `Ctrl+Shift+X` trash + next, `Ctrl+r` rotate 90° in place (`mogrify`), `Ctrl+e` edit in Tensaku + quit. — `config/imv/config`
- opencode: `theme = system`, `autoupdate = false`. — `config/opencode/opencode.json`
- obsidian flags: `-disable-gpu`, `--enable-wayland-ime`. — `config/obsidian/user-flags.conf`
- xournalpp: settings.xml (stylus/UI defaults; not user-edited normally). — `config/xournalpp/settings.xml`
- hyprland-preview-share-picker: themed CSS from current theme, `default_page: outputs`, 1000×500 window, single-click select, `hide_token_restore: true`, region via `slurp`. — `config/hyprland-preview-share-picker/config.yaml`
- fcitx5: clipboard trigger keys disabled (`TriggerKey=`, `PastePrimaryKey=`), `Allow Overriding System XKB Settings=False`. — `config/fcitx5/conf/*`
- fastfetch (system-wide `/etc/fastfetch/config.jsonc`): logo from `~/.config/omarchy/branding/about.txt` in green; Hardware box (PC, CPU, GPU, Display, Disk, Memory, Swap); Software box (`Omarchy <version>` via `omarchy-version`, branch, channel, kernel, WM, DE, terminal, packages, wmtheme, theme name + 8 colour dots, terminal font); Age/Uptime/Update box (OS Age days from `/` birth, uptime, `omarchy-version-pkgs`). Not invoked from `.bashrc`; reached via Omarchy Menu → About (`omarchy-launch-about`) or by typing `fastfetch`. — `etc/fastfetch/config.jsonc`
- Omarchy user config seeds: `shell.json` (idle screensaver 150 s, lock 300 s; bar top, widgets left menu/workspaces, center indicators/clock `dddd HH:mm` alt `d MMMM 'W'ww yyyy`/keyboard-layout/weather/system-update, right tray/agents/bluetooth/network/audio/monitor/power), `extensions/omarchy-menu.jsonc` (commented JSONC template), `themed/alacritty.toml.tpl.sample`, hooks samples `battery-low.d/play-warning-sound.sample`, `font-set.d/show-font-notification.sample`, `post-boot.d/weather.sample`, `post-update.d/show-update-notification.sample`, `pre-refresh-pacman.d/add-custom-repo.sample`, `theme-set.d/show-theme-notification.sample` (all inert until `.sample` removed). — `config/omarchy/**`
- Autostart suppressions (`Hidden=true`): `limine-snapper-notify.desktop`, `org.fcitx.Fcitx5.desktop`, `print-applet.desktop`. — `config/autostart/*`

**Terminals**
- Default terminal: `xdg-terminal-exec` with preference list containing only `foot.desktop`. `TERMINAL=xdg-terminal-exec` in the uwsm session. — `default/xdg-terminal-exec/hyprland-xdg-terminals.list`, `default/uwsm/default`
- foot (`~/.config/foot/foot.ini`): includes theme `~/.local/state/omarchy/current/theme/foot.ini`, `term=xterm-256color`, `JetBrainsMono Nerd Font:size=9`, `pad=14x14`, scrollback 10000, block non-blinking cursor, `Ctrl+Insert`/`Ctrl+Shift+c` copy, `Shift+Insert`/`Ctrl+Shift+v` paste, primary paste disabled, `Shift+Return` → CSI-u `\e[13;2u`, `Alt+Shift+Return` → `\e[13;4u`. — `config/foot/foot.ini`
- foot desktop entry (`applications/foot.desktop`): `X-TerminalArg*` keys for xdg-terminal-exec (`-e`, `--app-id=`, `--title=`, `--working-directory=`), "New Terminal" action. — `applications/foot.desktop`
- alacritty (`~/.config/alacritty/alacritty.toml`): imports theme, `TERM=xterm-256color`, `osc52 = CopyPaste`, JetBrainsMono 9, padding 14, no decorations, same Insert/CSI-u bindings. Not installed by default. — `config/alacritty/alacritty.toml`, `default/alacritty/Alacritty.desktop`
- ghostty (`~/.config/ghostty/config`): optional theme include, JetBrainsMono 9, padding 14, no close confirm, `resize-overlay = never`, block cursor, `shell-integration-features = no-cursor,ssh-env`, Insert/CSI-u bindings, `super+control+shift+alt+arrows` resize splits by 100, `mouse-scroll-multiplier 0.95`, `async-backend = epoll`. Not installed by default. — `config/ghostty/config`
- kitty: system `/etc/xdg/kitty/kitty.conf` (JetBrainsMono 9, padding 14, no decorations, `confirm_os_window_close 0`, Insert/CSI-u maps, `allow_remote_control socket-only`, `listen_on unix:${XDG_RUNTIME_DIR}/omarchy-kitty-{kitty_pid}`, block cursor no blink, no bell, powerline tab bar at bottom); user `~/.config/kitty/kitty.conf` holds only the theme include + commented examples. Not installed by default. — `etc/xdg/kitty/kitty.conf`, `config/kitty/kitty.conf`
- Screensaver terminal configs: foot `screensaver.ini` (font 18, `pad=0x0`, black bg white fg), alacritty `screensaver.toml` (black bg/cursor, size 18, opacity 1), ghostty `screensaver` (zero padding, extend colour). Used by `omarchy-launch-screensaver` under app-id `org.omarchy.screensaver`. — `default/{foot,alacritty,ghostty}/screensaver*`

**Login screen (SDDM)**
- `/etc/sddm.conf.d/10-theme.conf`: `Current=omarchy`; `10-wayland.conf`: `DisplayServer=wayland`, greeter compositor `start-hyprland -- --config /usr/share/sddm/hyprland.lua` (logo/splash/wallpaper off, animations off). — `etc/sddm.conf.d/*`, `default/sddm/hyprland.lua`
- Theme `Main.qml`: background `#1a1b26`; centered `logo.png`; a row with a lock icon (`lock.png`, red `lock-failed.png` after failure) and an entry image (`entry.png` / `entry-failed.png`); password is invisible text — each typed char draws a `bullet.png` dot (max 21 shown); **no username field, no session chooser, no power buttons**: user is `userModel.lastUser`, session is the first whose name contains "uwsm" (else last used), Enter calls `sddm.login`. On failure: text cleared, red state until the next keystroke. Font JetBrainsMono Nerd Font 24 px. — `default/sddm/omarchy/Main.qml`, `metadata.desktop`
- Autologin: decided by the ISO; the Quattro upgrade rule is "autologin when root is LUKS-encrypted" (`should_enable_sddm_autologin`), so on the minted (encrypted) disk boot goes LUKS → desktop without a greeter. The greeter is reached by **Logout** (Super+Escape → Logout, `omarchy-system-logout` = close all windows, `uwsm stop`). — `install/login/sddm.sh`, `bin/omarchy-upgrade-to-quattro`, `bin/omarchy-system-logout`
- PAM: `pam_gnome_keyring` removed from `/etc/pam.d/sddm`; faillock `deny = 10` (upstream 3) with `unlock_time=120` in `system-auth`; `sddm-autologin` gets `pam_faillock authsucc`. — `etc/security/faillock.conf`, `install/config/increase-lockout-limit.sh`
- Session entry `/usr/local/share/wayland-sessions/omarchy.desktop`: "Omarchy (Hyprland uwsm)", `Exec=uwsm start -g -1 -e -D Hyprland hyprland.desktop`. — `default/wayland-sessions/omarchy.desktop`
- uwsm env: `TERMINAL=xdg-terminal-exec`, `EDITOR="omarchy-launch-editor --inline"`, BROWSER deliberately unset session-wide, optional `OMARCHY_SCREENSHOT_DIR` / `OMARCHY_SCREENRECORD_DIR`, `~/.config/uwsm/default` honoured, `mise activate bash --shims`. — `default/uwsm/*`
- `environment.d/10-omarchy-fcitx.conf`: `INPUT_METHOD=fcitx`, `QT_IM_MODULE=fcitx`, `XMODIFIERS=@im=fcitx`, `SDL_IM_MODULE=fcitx` (no `GTK_IM_MODULE`; GTK uses Wayland text-input). — `default/environment.d/10-omarchy-fcitx.conf`

**Boot: Limine, Plymouth, initramfs, snapshots**
- `limine.conf`: `#timeout: 3` (commented → Limine default 5 s), `default_entry: 2`, branding "Omarchy Bootloader" in green `9ece6a`, `hash_mismatch_panic: no`, Tokyo Night palette, background `1a1b26`. — `default/limine/limine.conf`
- `/etc/default/limine` (from `default.conf` template): `ESP_PATH=/boot`, `KERNEL_CMDLINE[default]+="@@CMDLINE@@"` substituted by the ISO. — `default/limine/default.conf`
- `limine-entry-tool.d/omarchy-defaults.conf`: `TARGET_OS_NAME="Omarchy"`, cmdline `quiet splash loglevel=0 systemd.show_status=false rd.udev.log_level=0 vt.global_cursor_default=0 initramfs_async=0`, UKI named `omarchy`, `ENABLE_LIMINE_FALLBACK=yes`, `FIND_BOOTLOADERS=yes`, `BOOT_ORDER="linux-t2, linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`, `MAX_SNAPSHOT_ENTRIES=6`, `SNAPSHOT_FORMAT_CHOICE=5`; `omarchy-uki.conf`: `ENABLE_UKI=yes`. — `etc/limine-entry-tool.d/*`
- Snapper root config: pre-update snapshots only, `NUMBER_LIMIT=5`, `TIMELINE_CREATE=no`. — `default/snapper/root`
- mkinitcpio: hooks `base udev plymouth keyboard autodetect microcode modconf kms keymap consolefont block encrypt filesystems fsck btrfs-overlayfs`; `kms` dropped only on NVIDIA-only early-KMS systems; `/etc/vconsole.conf` bundled unless layout is non-Latin; `thunderbolt` module added. — `etc/mkinitcpio.conf.d/*`
- Plymouth theme `omarchy` (`/etc/plymouth/plymouthd.conf` `Theme=omarchy`): background `#1a1b26`, centered logo; on password prompt: lock icon + entry image + up to 21 bullets, progress bar hidden; after unlock (boot/resume): progress box+bar with fake ease-out progress to 70 % over 15 s then real progress; messages at (10,10) in white. `ConsoleLogBackgroundColor=0x1a1b26`, Cantarell 11. — `default/plymouth/*`, `etc/plymouth/plymouthd.conf`

**systemd — user units** (`default/systemd/user/*`, all `WantedBy=graphical-session.target`, enabled at first run by `install/user/first-run/enable-user-units.sh`)
- `bt-agent.service` — bluez auto-accept pairing agent; `ExecCondition=systemctl is-active bluetooth.service` so it exits cleanly in a VM with no adapter. What the user notices: nothing (no service failure). — `default/systemd/user/bt-agent.service`
- `omarchy-crash-watch.service` — runs `omarchy-crash-watch`; on a core dump shows notification "Process crashed: <comm>" with an action that runs `omarchy-agent-crash <pid> …` in a terminal. Disabled by the toggle file `~/.local/state/omarchy/toggles/crash-capture-off` (menu Trigger → Toggle → Crash Capture). `Restart=always`. — `omarchy-crash-watch.service`
- `omarchy-fcitx5.service` — `fcitx5 --disable notificationitem` (no tray icon), `Restart=always`, only with `WAYLAND_DISPLAY`. Provides XCompose sequences in Wayland apps. — `omarchy-fcitx5.service`
- `omarchy-migrate-notify.service` — oneshot at login; notification with a terminal action only when `omarchy-migrate --pending` has work. Fresh install: nothing shown. — `omarchy-migrate-notify.service`
- `omarchy-recover-internal-monitor.service` — oneshot before `graphical-session-pre.target`, only when the laptop-display-disabled toggle file exists; inert in the VM. — `omarchy-recover-internal-monitor.service`
- `omarchy-sleep-lock.service` — `omarchy-system-sleep-monitor`, locks the session before suspend via a logind delay inhibitor (`InhibitDelayMaxSec=15`). — `omarchy-sleep-lock.service`, `etc/systemd/logind.conf.d/20-inhibit-delay.conf`
- `omarchy-speaker-tuning.service` — `pipewire -c omarchy-speaker-tuning.conf` filter-chain host, enabled only by `install/user/first-run/audio-tuning.sh` on matching DMI SKU (Dell XPS 14/16 2026 `0DB9`/`0DBA`); creates a "Laptop Speakers" sink. Inert in the VM. — `omarchy-speaker-tuning.service`, `default/audio/**`
- `omarchy-tailscale-receive.service` — Taildrop receiver, `ConditionPathExists=/usr/bin/tailscale`; tailscale not installed by default → inert. — `omarchy-tailscale-receive.service`
- `app.slice.d/10-oomd.conf` — `ManagedOOMMemoryPressure=kill`, `ManagedOOMSwap=kill` on the user `app.slice` only (compositor in `session.slice` is never a victim). — `default/systemd/user/app.slice.d/10-oomd.conf`

**systemd — system-side** (`default/systemd/*`, `etc/systemd/**`)
- `zram-generator.conf.d/90-omarchy.conf` — `zram0`, `zram-size = ram`, `zstd`, `swap-priority = 100`. Plus `tmpfiles.d/omarchy-zswap.conf` writes `N` to `/sys/module/zswap/parameters/enabled` at boot. — `default/systemd/zram-generator.conf.d/90-omarchy.conf`, `etc/tmpfiles.d/omarchy-zswap.conf`
- `oomd.conf.d/10-omarchy.conf` — `DefaultMemoryPressureLimit=50%`, `DefaultMemoryPressureDurationSec=20s`; `systemd-oomd.service` enabled. — `etc/systemd/oomd.conf.d/10-omarchy.conf`
- Faster shutdown: `DefaultTimeoutStopSec=5s` (system manager) and `TimeoutStopSec=5s` on `user@.service`. — `etc/systemd/system.conf.d/10-faster-shutdown.conf`, `etc/systemd/system/user@.service.d/10-faster-shutdown.conf` (duplicated under `default/systemd/`)
- File limits: `DefaultLimitNOFILE=65536:524288` for system and user managers. — `etc/systemd/{system,user}.conf.d/20-omarchy-nofile.conf`
- logind: `HandlePowerKey=ignore` (power button does nothing; the shell owns power UX), `InhibitDelayMaxSec=15`. — `etc/systemd/logind.conf.d/*`
- resolved: `LLMNR=no`, `MulticastDNS=no`; `DNSStubListenerExtra=172.17.0.1` for Docker containers. — `etc/systemd/resolved.conf.d/*`
- Docker: `docker.socket` enabled (not the service), `DefaultDependencies=no` drop-in so it never blocks boot; daemon.json json-file logs 10m×5, `dns 172.17.0.1`, `bip 172.17.0.1/16`. **User is NOT in the `docker` group.** — `etc/systemd/system/docker.service.d/no-block-boot.conf`, `etc/docker/daemon.json`, `install/config/docker.sh`
- plocate: `ExecStart=updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots`, `ConditionACPower=true`. — `default/systemd/system/plocate-updatedb.service.d/10-omarchy.conf`, `etc/systemd/system/plocate-updatedb.service.d/ac-only.conf`
- cups-browsed hardening drop-in (User/Group `cups-browsed`, `ProtectSystem=strict`, etc.) + sysusers `cups-browsed` account + `cups-browsed.conf` (Driverless only) — package is **not installed** by default; files are the baseline for when discovery returns. — `etc/systemd/system/cups-browsed.service.d/10-omarchy.conf`, `etc/sysusers.d/omarchy-cups-browsed.conf`, `etc/cups/cups-browsed.conf`
- `cups-files.conf`: `SystemGroup cups-browsed sys root`, `PeerCred on` — the desktop user (wheel) is **not** a CUPS admin; admin goes through polkit (`cups-pk-helper`) or fails "Forbidden". — `etc/cups/cups-files.conf`
- supergfxd `ExecStartPre=/bin/sleep 5` (ASUS hybrid GPUs). — `default/systemd/system/supergfxd.service.d/delay-start.conf`
- Cam Link 4K: udev rule takes the raw node from users, symlinks `/dev/camlink4k`, starts `v4l2-relayd@camlink.service` which requires `camlink-4k-loopback.service` (modprobe v4l2loopback, create "Cam Link 4K" virtual camera); relay config 1280×720 NV12 30 fps. Hardware-only. — `default/udev/elgato-camlink-4k.rules`, `default/systemd/system/camlink-4k-loopback.service`, `default/systemd/system/v4l2-relayd@camlink.service.d/camlink.conf`, `default/v4l2-relayd/camlink.conf`
- Framework 16 QMK keyboard hidraw uaccess rule. — `default/udev/framework16-qmk-hid.rules`
- system-sleep hooks: `unmount-fuse` (lazy-unmount gvfsd-fuse before sleep, restart `gvfs-daemon` per user 5 s after wake); `force-igpu` and `keyboard-backlight` (ASUS; only published by hardware setup). — `default/systemd/system-sleep/*`
- tmpfiles `omarchy-nopasswd-sudo.conf`: `r! /etc/sudoers.d/99-omarchy-nopasswd-*` at boot (stale passwordless grants removed). — `etc/tmpfiles.d/omarchy-nopasswd-sudo.conf`
- udev `60-omarchy-io-scheduler.rules`: `kyber` scheduler on whole disks `nvme*|sd*|mmcblk*|vd*` (applies to the VM's `vda`). — `etc/udev/rules.d/60-omarchy-io-scheduler.rules`
- sysctl: `tcp_mtu_probing=1`, `default_qdisc=fq`, `tcp_congestion_control=bbr`, `vm.swappiness=150`, `vfs_cache_pressure=50`, `page-cluster=0`, `watermark_boost_factor=0`, `watermark_scale_factor=125`, `dirty_background_bytes=64M`, `dirty_bytes=256M`, `dirty_writeback_centisecs=1500`; `fs.inotify.max_user_watches=524288`. — `etc/sysctl.d/*`
- modprobe `usbcore autosuspend=-1`; NetworkManager `wifi.powersave = 2` (off). — `etc/modprobe.d/omarchy-usb-autosuspend.conf`, `etc/NetworkManager/conf.d/omarchy-wifi-powersave.conf`
- nsswitch: `hosts: mymachines mdns_minimal [NOTFOUND=return] resolve files myhostname dns`; `group: files [SUCCESS=merge] systemd`. — `etc/nsswitch.conf`
- mise system config: `cursor-agent` tool alias exposing only its launcher. — `etc/mise/conf.d/omarchy.toml`
- gnupg dirmngr: 5 hkps keyservers (ubuntu, surfnet, mailvelope, debian, mit), `connect-quick-timeout 4` (system and per-user copies). — `etc/gnupg/dirmngr.conf`, `default/gpg/dirmngr.conf`
- SSH client keepalive (`ServerAliveInterval 15`, `CountMax 3`, `ConnectTimeout 10`) and PAM `PATH` with mise shims for `ssh host cmd`. — `install/config/ssh-keepalive.sh`, `install/config/ssh-command-path.sh`

**sudoers** (`etc/sudoers.d/*`) — what needs no password
- `omarchy-dns`: `%wheel … NOPASSWD: /usr/bin/omarchy-dns Cloudflare`, `… Google`, `… DHCP` (exact args; `Custom` **not** granted). — `etc/sudoers.d/omarchy-dns`
- `omarchy-tzupdate`: `NOPASSWD: /usr/bin/timedatectl ^set-timezone <Area/City regex>$` — only the two-token form; extra flags (`-H`, `-M`) or junk zones require a password. — `etc/sudoers.d/omarchy-tzupdate`
- `omarchy-theme-browser`: `NOPASSWD: /usr/bin/omarchy-theme-set-browser-policy <exactly six lowercase hex digits>` (menu theme switch repaints Chromium's `BrowserThemeColor`). — `etc/sudoers.d/omarchy-theme-browser`
- `omarchy-passwd-tries`: `Defaults passwd_tries=10` (sudo re-prompts up to 10 times instead of 3). — `etc/sudoers.d/omarchy-passwd-tries`
- Everything else needs the account password. Temporary blanket grant: `omarchy-sudo-passwordless [MINUTES]` (menu Setup → Security → Passwordless Sudo) writes `/etc/sudoers.d/99-omarchy-nopasswd-<user>` and a transient timer (default 15 min); running it again disables; removed at boot by tmpfiles. — `bin/omarchy-sudo-passwordless`, `etc/tmpfiles.d/omarchy-nopasswd-sudo.conf`
- Docker: `omarchy-sudo-docker` decides; TUI (`Super+Shift+D`, `Docker.desktop`) runs `pkexec … lazydocker` (polkit dialog) when the socket is unreachable; opt-in `omarchy-setup-security-sudoless-docker` adds the group after a gum warning and requires reboot. — `bin/omarchy-launch-docker-tui`, `bin/omarchy-setup-security-sudoless-docker`

**Firewall**
- ufw: default deny incoming / allow outgoing; allow `53317/udp` + `53317/tcp` (LocalSend); allow UDP 53 to `172.17.0.1` from `172.16.0.0/12` and `192.168.0.0/16` (docker DNS); `ufw-docker install` after.rules; `ENABLED=yes`, `ufw.service` enabled. **No SSH rule** until `omarchy-setup-security-sshd` adds `ufw limit 22/tcp`. — `install/config/firewall.sh`, `bin/omarchy-setup-security-sshd`

**Pacman / update hooks**
- Channel confs (`pacman-{stable,rc,edge}.conf` → `/etc/pacman.conf`): `Color`, `ILoveCandy`, `VerbosePkgLists`, `ParallelDownloads = 5`, `DownloadUser = alpm`, `SigLevel = Required DatabaseOptional`; repos core/extra/multilib via mirrorlist + `[omarchy] Server = https://pkgs.omarchy.org/<channel>/$arch` (edge conf also has commented debug repos). Mirrorlists: `mirror.omarchy.org`, `rc-mirror.omarchy.org`, `stable-mirror.omarchy.org`. — `default/pacman/*`
- libalpm hooks: `00-omarchy-update-guard` (PreTransaction on any upgrade, `AbortOnFail`; `omarchy-update-pacman-guard` aborts a direct `pacman -Syu` with the "Woah partner..." message unless `OMARCHY_ALLOW_DIRECT_PACMAN=1`); `10-…hyprland-reload-pause` / `90-…hyprland-reload-resume` around `omarchy-settings` upgrades. — `default/libalpm/hooks/*`, `bin/omarchy-update-pacman-guard`

**Fonts**
- fontconfig `50-omarchy.conf`: `sans-serif`→Liberation Sans, `serif`→Liberation Serif, `monospace`→JetBrainsMono Nerd Font (strong); Arabic → Noto Naskh Arabic (prepend) with Noto Nastaliq Urdu for `ur`; Naskh appended as global last resort; `system-ui`, `-apple-system`, `BlinkMacSystemFont` → Liberation Sans; `ui-monospace` → monospace; Nerd Font + Noto Color Emoji accepted as fallbacks for sans/mono/serif. — `default/fontconfig/conf.avail/50-omarchy.conf`
- `omarchy.ttf` private-use glyphs `U+E900`–`U+E90E` (Omarchy, Pi, OpenCode, omp, Grok, Codex, LM Studio, Ollama, T3 Code, Ori, Hermes, Perplexity, OpenClaw, Cursor, Claude). — `default/fonts/omarchy/README.md`

**Browser**
- Chromium flags (`~/.config/chromium-flags.conf`): `--ozone-platform=wayland`, `--ozone-platform-hint=wayland`, `--password-store=gnome-libsecret`, `--enable-features=TouchpadOverscrollHistoryNavigation`, `--load-extension=` the three bundled extensions. — `config/chromium-flags.conf`
- Chromium `Default/Preferences` seed: no theme extension, `color_scheme: 2` (dark), `user_color: 2`. — `config/chromium/Default/Preferences`
- Extension **Copy URL** v1.5 (id `bgpiichlckmfanooecilcjemknkcpngb`): toolbar action + `Alt+Shift+L` → native host `com.omarchy.copy_url` (`omarchy-chromium-copy-url-host`: `wl-copy`, notification "URL copied to clipboard"). — `default/chromium/extensions/copy-url/*`, `default/chromium/native-messaging-hosts/com.omarchy.copy_url.json`
- Extension **Download Video** v1.0 (id `dedjgknigfeelejglamclffonmophnfl`): toolbar action + `Alt+Shift+D` → native host `com.omarchy.ytdlp` (`omarchy-chromium-ytdlp-host`: yt-dlp into `~/Videos`, notifications for start/finish/failure with a click action that plays the file). Ignores non-http(s) URLs. — `default/chromium/extensions/yt-dlp/*`, `default/chromium/native-messaging-hosts/com.omarchy.ytdlp.json`
- Extension **WhatsApp Slim** v1.1 (id `amhpgjbcfakkmkeojmoaoiochhifohdi`): content script on `web.whatsapp.com` sets `system-theme-mode=true` in localStorage (reloads once) and CSS collapses the chat list to a 90 px avatar rail below 1100 px width. — `default/chromium/extensions/whatsapp-slim/*`
- Native host manifests are installed per user by `omarchy-install-chromium-{copy-url,ytdlp}` (also Brave). — `install/user/chromium.sh`
- Firefox policies (installed only when Firefox is installed): `apz.overscroll.enabled`, `media.ffmpeg.vaapi.enabled`, `media.hardware-video-decoding.force-enabled`, `widget.disable-swipe-tracker=false`, `widget.wayland.fractional-scale.enabled` — all `Status: default` (user can change). — `default/firefox/policies.json`

**Default applications / MIME** (`default/applications/mimeapps.list` → `/usr/share/applications/mimeapps.list`)
- `inode/directory` → Nautilus; `image/{png,jpeg,gif,webp,bmp,tiff}` → `imv.desktop`; `application/pdf` → Evince; `x-scheme-handler/http(s)` → `chromium.desktop`; `x-scheme-handler/mailto` → `HEY.desktop`; all listed `video/*` + `application/ogg` → `mpv.desktop`; `text/plain`, `text/english`, C/C++/Java/Makefile/TeX/Tcl/Pascal sources, `application/x-shellscript`, `application/xml`, `text/xml` → `nvim.desktop`. — `default/applications/mimeapps.list`
- `applications/*.desktop` seeded to `~/.local/share/applications/`:
  - `Basecamp` → `omarchy-launch-webapp https://launchpad.37signals.com`
  - `Discord` → webapp `https://discord.com/channels/@me`
  - `Disk Usage` → `xdg-terminal-exec --app-id=TUI.float -e bash -c "dua i /"`
  - `Docker` → `xdg-terminal-exec --app-id=TUI.tile -e omarchy-launch-docker-tui`
  - `foot` — terminal (see above)
  - `Google Contacts` / `Google Maps` / `Google Messages` / `Google Photos` → webapps
  - `HEY` → `omarchy-webapp-handler-hey %u`, `MimeType=x-scheme-handler/mailto`
  - `Image Viewer` (imv) → `imv %F` with image MIME list
  - `Media Player` (mpv) → `mpv --player-operation-mode=pseudo-gui -- %U`, huge MIME list
  - `WhatsApp` → webapp `https://web.whatsapp.com/`; `X` → `https://x.com/`; `YouTube` → `https://youtube.com/`
  - `Zoom` → `omarchy-webapp-handler-zoom %u`, `x-scheme-handler/zoommtg;zoomus`
  - icons: Basecamp, Battle.net, ChatGPT, Disk Usage, Docker, Google Contacts/Maps/Messages/Photos, HEY, imv, omarchy-discord, Retro Gaming, WhatsApp, windows, X, YouTube, Zoom
- `default/applications/battlenet.desktop` — installer-only template (`omarchy-launch-battlenet`). Not seeded.
- `omarchy-launch-webapp <url>` uses the default browser's `Exec` with `--app=<url>` (falls back to chromium for non-chromium defaults). — `bin/omarchy-launch-webapp`
- Launcher hides (`default/omarchy/launcher.hides`): btop, cups, fcitx5 entries, foot-server/footclient, hermes, java tools, kvantum, libreoffice sub-apps, limine-snapper-restore, lstopo, qv4l2, uuctl, xgps, etc. — context only.

**Input: XCompose**
- `~/.XCompose` (written by `install/user/xcompose.sh`): `include "%L"`, includes `/usr/share/omarchy/default/xcompose`, adds `<Multi_key> <space> <n>` → user name and `<space> <e>` → email. Default table: `<Multi_key> <m> <letter>` emoji (`s`😄 `c`😂 `l`😍 `v`✌️ `h`❤️ `y`👍 `n`👎 `f`🖕 `w`🤞 `r`🤘 `k`😘 `e`🙄 `d`🤤 `m`💰 `x`🎉 `1`💯 `t`🥂 `p`🙏 `i`😉 `o`👌 `g`👋 `a`💪 `b`🤯) and `<Multi_key> <space> <space>` → `—`. Compose key is CapsLock; served by fcitx5 for Wayland clients; `omarchy-restart-xcompose` reloads. — `default/xcompose`, `install/user/xcompose.sh`

**Nautilus context menu** (`default/nautilus-python/extensions/*` → `~/.local/share/nautilus-python/extensions/`)
- "Send via LocalSend" / "Send selected via LocalSend" on any selection when `localsend` (base package) or the flatpak is present. — `localsend.py`
- "Transcode" / "Transcode N items" on images/videos (by MIME or extension); opens `omarchy-launch-floating-terminal-with-presentation omarchy-transcode <path>`. — `transcode.py`

**Agent skills** (`default/agents/skills/*`, symlinked at finalize into `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.gemini/config/skills`, `~/.hermes/skills`)
- `omarchy/SKILL.md`: end-user customization skill — never edit `/usr/share/omarchy`, use `~/.config`; privilege rules (`sudo` in terminal, `pkexec` otherwise); command discovery via `omarchy commands`, `omarchy <group> --help`; groups refresh/restart/toggle/theme/bar/plugin/hook/install/launch/capture/reminder/pkg/setup/update; config locations; "always run `omarchy debug --no-sudo --print`"; decision framework; example requests. Topic guides: `hyprland.md` (bindings `o.bind`/`o.rebind`, monitors, window rules → fetch wiki), `plugins.md` (shell.json, `omarchy plugin clone`, idle seconds), `theming.md` (theme commands, overlay vs fork, cloned-theme restrictions), `hooks.md` (hook dirs), `capture.md` (screenshot/record/OCR/share commands), `contributing.md` (issues vs discussions vs Discord, `gh issue create`).
- `diagnose-crash/SKILL.md`: `coredumpctl info/list`, rule out OOM, correlate timeline, symbolize with debuginfod into a `mktemp` core and delete it, report, offer `omarchy-crash-mute '<program>' [off]`, global switch Trigger → Toggle → Crash Capture; `reporting.md`: strict "is it Omarchy's bug", three conditions (verified, user agreed, `gh auth status`), search closed issues, sign "Filed by <model> via <harness>".

**Misc user-facing defaults**
- voxtype `config.toml` seed (hotkey disabled — Hyprland binds `Super+Ctrl+X`; whisper `base.en`; output `type` with clipboard fallback; no notifications). voxtype itself is installed by a post-update hook, not in base. — `default/voxtype/config.toml`
- tensaku `state.toml`: `annotation-size-factor = 2.0`. — `default/tensaku/state.toml`
- WirePlumber: ALSA soft-mixer on all cards (system), Bluetooth A2DP auto-connect and KEF LSX II no-suspend (user). — `default/wireplumber/**`, `config/wireplumber/**`
- `docs/file-layout.md`: `omarchy` vs `omarchy-settings` packages, seed (`/etc/skel`) → finalize (`omarchy-provision-user`) → first-run (`omarchy-provision-first-run`: enable user units, welcome toast "Learn Keybindings — Super + K for cheatsheet. Super + Space for Omarchy Menu.", Wi-Fi/update toasts) → resync (`omarchy-reinstall-configs`); `etc-overrides` clobbered on `omarchy-settings` upgrade (`.bashrc`, `nsswitch.conf`, `faillock.conf`, `cups-browsed.conf`, `plymouthd.conf`).

## Observations

1. **Autologin hides the greeter.** On an encrypted install the ISO enables SDDM autologin, so a normal boot goes LUKS → Plymouth → desktop with no SDDM screen. To test the greeter the driver must **log out** (Super+Escape → Logout). `omarchy-system-logout` closes every window, shows a 5 s OSD, then `uwsm stop`; SDDM then shows the greeter (autologin does not re-fire on relogin). All SDDM tests therefore start with a logout and end back on a desktop with no windows open.
2. **The SDDM theme has no username box, no session menu, no power buttons.** Only a logo, a lock glyph and an entry with dots. Wrong password turns the lock and entry red and clears the dots; the next keystroke clears the red state. Enter with an empty field submits an empty password (fails red). "Session choice" is not a user-visible feature; the theme picks the first session containing "uwsm".
3. **LUKS prompt retries are limited.** systemd-cryptsetup allows 3 attempts by default before dropping to an emergency shell. Test one wrong passphrase, then the right one; never three wrong.
4. **Limine timeout** is Limine's default (5 s) because `timeout` is commented out; the branding line "Omarchy Bootloader" is green on `#1a1b26`. `default_entry: 2` means the highlighted entry is the second row. Snapshots submenu exists only when `limine-snapper-sync` has produced entries; on a freshly minted disk it may be missing or empty (snapshots are created by `omarchy update`).
5. **fastfetch is not printed on terminal open.** `.bashrc` never calls it. The "fastfetch on terminal open" idea from the brief maps to Omarchy Menu → About (`omarchy-launch-about`), which sizes a floating terminal around the fastfetch output and animates a sheen on the logo.
6. **Foot is the only default terminal.** kitty, alacritty and ghostty are not in the base package set; their configs are seeded but untestable without `omarchy install terminal <x>` (network, ~50–150 MB).
7. **`hunk`, `opencode`, `claude`, `codex` are not installed** by default (the last three are mise lazy stubs that download on first run). `tds` will show "command not found" in two panes; `c`/`cx`/`cy` trigger installs. `a` (`omarchy-agent --inline`) prints "Choose default agent with …" and exits non-zero because no default agent is chosen on a fresh install.
8. **Sudo needs a password** except for three narrow rules (DNS presets, `timedatectl set-timezone <zone>`, browser theme colour). `passwd_tries=10` lets the driver mistype more than 3 times. Faillock also allows 10 attempts (lock screen, SDDM, sudo) before a 120 s lockout — do not exceed ~5 wrong attempts in any test.
9. **Docker requires elevation**: the user is not in `docker`; `docker ps` fails with permission denied; `Super+Shift+D` triggers a **polkit dialog** (the shell's polkit agent) before lazydocker. Enabling sudoless docker requires a reboot, so only its decline path is cheap.
10. **CUPS admin is forbidden for the desktop user** (`SystemGroup cups-browsed sys root`): the web UI loads at `localhost:631` but Administration actions reject `prime`; `lpinfo -v` prints Forbidden. `cups-browsed` is not installed. Print Settings goes through polkit.
11. **Firewall**: active, deny-in/allow-out, only LocalSend 53317 and Docker DNS holes. SSH is not allowed until `omarchy-setup-security-sshd` (which also enables sshd). `ufw status` needs sudo.
12. **The compose key is CapsLock** (Hyprland `compose:caps`), served by `fcitx5` for Wayland apps (foot, chromium). The fcitx5 tray item is disabled and the apps launcher hides its desktop entries. Shift+Shift toggles real Caps Lock.
13. **zram** is sized to RAM (4 GB in the guest), priority 100; zswap is forced off at boot. `vm.swappiness=150`. Disk swapfile exists only after `omarchy-hibernation-setup`.
14. **Clock format** is Qt style: bar shows `Friday 13:10`; clicking swaps to `18 September W38 2026`. Timezone changes go through the passwordless `timedatectl` rule, so the Update → Timezone picker never prompts.
15. **State carried between steps**: tests that change DNS/timezone/passwordless-sudo must restore (`sudo omarchy-dns DHCP`, `sudo timedatectl set-timezone <original>`, run `omarchy-sudo-passwordless` again) because the disk is not reset unless the session ends with `stop`.
16. **Notifications are the proof for many extension/host features** (copy-url, yt-dlp, crash-watch, timezone). They fade; screenshot immediately after the trigger. `Super+comma` dismisses the last one.
17. **Network**: user-mode NAT allows outbound HTTP(S); yt-dlp downloads and `pacman -Sy` work but are slow. WhatsApp cannot be logged into (needs a phone), so the slim CSS can only be verified structurally.
18. **`/etc/skel` seeds only at user creation**; the `prime` user on the minted disk has the seeds from the 4.0.2 ISO. Anything added at HEAD after 4.0.2 (e.g. `hds`/`hdlm`/`hsl`, `rsw` socket path change, `Alt+Shift+L` copy-url shortcut migration) may be absent or different; drivers should report "not present" rather than fail hard where noted.
19. **Suspend/hibernate/sleep hooks are untestable**: the guest has no way to be woken by the driver, and there is no lid/battery/backlight/GPU switch. `HandlePowerKey=ignore` cannot be exercised (no ACPI button injection from `./client`).
20. **Long output** should be redirected: `<cmd> 2>&1 | sudo tee /dev/ttyS0` then `./client get-serial`.

## Proposed tests

Every step below is a keypress, a mouse action, or a command typed into a terminal opened with Super+Enter inside the guest; proofs are screenshots (or `/dev/ttyS0` written from the guest). Shared quirks: the SDDM greeter is only reachable via Logout; the LUKS prompt allows three tries, so do exactly one wrong; faillock is shared across sudo, lock screen and SDDM (10 attempts, then 2 min) so never exceed five wrong passwords in one test; the disk is not reset between tests, so every test restores what it changed.

### sddm-login-wrong-then-right-password   [VM-OK]
description: The login screen, reached by logging out, rejects a wrong password with a red failure state and admits the right one back to the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape to open the System menu and click **Logout** with the mouse.
  ** Windows close, a "Logging out" overlay shows, then a dark blue screen with the Omarchy logo, a lock icon and an empty rounded entry appears. That is the greeter; autologin does not re-fire here.
  ** There is no username field and no session list; the entry already has focus.
  * Type `wrongpass` and press Enter.
  ** One dot appears per character while typing; after Enter the dots vanish and the lock icon and entry border turn red.
  * Type one character: the red state must clear immediately. Press Backspace to remove it.
  * Type `prime` and press Enter.
  ** The desktop with the top bar returns with no windows open.
  * The desktop must be usable: press Super+Enter, see a terminal, press Ctrl+D to close it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The greeter can take 5–10 seconds after Logout; screenshot every few seconds until the logo appears.
  * Only one wrong password here; faillock is shared with other tests.
  * If the desktop comes back without a greeter, autologin re-fired; report with screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: greeter with dots while typing; red lock/entry after the wrong password; red cleared on the next keystroke; restored desktop with a working terminal.
  ** The Logout entry was clicked with the mouse.
  * If unsuccessful
  ** Screenshot of what is on screen 30 s after Enter (black screen, stuck greeter, text console) and `./client get-serial`.
covers: default/sddm/omarchy/Main.qml, etc/sddm.conf.d/*, default/sddm/hyprland.lua, bin/omarchy-system-logout

### sddm-empty-password-and-no-session-picker   [VM-OK]
description: The greeter rejects an empty password without crashing, exposes no user or session picker, and the session it starts is the Omarchy uwsm Hyprland session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and click **Logout**; wait for the greeter (logo, lock, entry).
  * Press Enter with nothing typed.
  ** Lock and entry turn red; the greeter must not disappear or restart.
  * Press Tab three times and click each corner of the screen once.
  ** No username field, session list, power or reboot button may appear anywhere.
  * Type `prime` and press Enter to log in.
  * Press Super+Enter and type `echo $XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE; systemctl --user is-active 'wayland-wm@*'` Enter.
  ** Expect `Hyprland wayland` and `active`.
  * Press Ctrl+D to close the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the greeter goes black after a while, keys still reach the password box.
  * Screenshot after each Tab and each corner click; the proof is the absence of widgets.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the red state after an empty Enter; three Tab screenshots and corner-click screenshots with no extra widgets; terminal line `Hyprland wayland` / `active`.
  * If unsuccessful
  ** Screenshot of any unexpected widget or of a greeter restart (logo flicker), plus the serial log.
covers: default/sddm/omarchy/Main.qml, default/wayland-sessions/omarchy.desktop, default/uwsm/env.d/10-omarchy

### boot-menu-shows-omarchy-entries   [VM-OK] [SLOW]
description: The Limine boot menu is branded "Omarchy Bootloader", lists the Omarchy kernel with a fallback, and boots the default entry through to the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and click **Reboot**. Screenshot every 2–3 seconds once the screen goes dark.
  * When the menu appears (dark blue, green "Omarchy Bootloader" heading, entries with a countdown) press Down once to stop the countdown.
  ** Record every entry name: one containing "Omarchy" (linux-omarchy), a "fallback" entry, possibly "Snapshots". Note which row is highlighted (the second row is the configured default).
  * Press Up to the first Omarchy entry and press Enter.
  ** The Omarchy splash (centred logo) appears, then the LUKS prompt (lock icon + entry).
  * Type `prime` and press Enter; wait for the desktop (if the greeter shows instead, log in with `prime`).
  * Press Super+Enter and type `cat /proc/cmdline` Enter.
  ** The line contains `quiet splash` and `initramfs_async=0`.
  * Press Ctrl+D; the desktop is back with no windows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu stays ~5 seconds unless a key is pressed; screenshot repeatedly and press Down as soon as it shows.
  * A reboot cycle takes 1–2 minutes; never sleep more than 5 s between screenshots.
  * If the menu never appears (straight to splash), report it with the screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the menu with the "Omarchy Bootloader" heading and the entry list; the LUKS prompt; the desktop; the `/proc/cmdline` line.
  * If unsuccessful
  ** Screenshot of a missing/unbranded menu or a stalled boot, plus the serial log.
covers: default/limine/limine.conf, default/limine/default.conf, etc/limine-entry-tool.d/*, test/shell.d/limine-defaults-test.sh

### boot-menu-snapshots-submenu   [VM-PARTIAL] [SLOW]
description: The boot menu offers a Snapshots submenu for pre-update recovery and returns to the main menu on Escape; on a freshly minted disk it may be empty or absent, which is recorded, not failed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `sudo snapper -c root list` Enter (password `prime`).
  ** Note the number of snapshots (may be zero).
  * Press Super+Escape, click **Reboot**, and stop the boot menu countdown with Down as soon as it appears.
  * Look for a **Snapshots** entry. If present, select it and press Enter; screenshot the submenu. If absent, screenshot the menu and note it.
  ** Listed snapshots carry a date and description; there must be no more than 6.
  * Press Escape: the main menu must reappear unchanged.
  * Select the first Omarchy entry, press Enter, type the LUKS passphrase `prime` Enter, and reach the desktop.
  * Skipped: booting a snapshot (destructive to the minted disk).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A disk that never ran `omarchy update` has no snapshots; the test still passes if the menu behaves.
  * Do not press Enter on a snapshot row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshot of the snapper list; the Snapshots submenu (or main menu with a note); the main menu after Escape; the restored desktop.
  * If unsuccessful
  ** Screenshot of a submenu that cannot be exited or a boot failure, plus serial log.
covers: default/snapper/root, etc/limine-entry-tool.d/omarchy-defaults.conf

### plymouth-luks-wrong-then-right-passphrase   [VM-OK] [SLOW]
description: The themed boot splash asks for the disk passphrase with dots, re-asks after one wrong passphrase, and shows a progress bar after the right one, never dropping to a text console.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and click **Reboot**. Screenshot every 2–3 seconds.
  * Let the boot menu time out.
  * When the splash shows the logo with a lock icon and an entry, type `wrong` and screenshot.
  ** Five dots appear in the entry.
  * Press Enter.
  ** Dots clear and the same lock/entry prompt returns. No text console, no scrolling log.
  * Type `prime` and press Enter.
  ** Lock and entry disappear, a thin progress bar fills beneath the logo, then the desktop (or greeter: log in with `prime`) appears.
  * The desktop must be usable (Super+Enter opens a terminal; Ctrl+D closes it).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Exactly ONE wrong passphrase. Three wrong drop to an emergency shell and the disk is lost.
  * If a text line "Please enter passphrase for disk" appears instead of the graphic, type `prime` to recover, then report the screenshot as a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: logo+lock+entry with five dots; prompt returned after the wrong attempt; progress bar after the right passphrase; desktop.
  * If unsuccessful
  ** Screenshot of a text-mode prompt, a stuck splash, or an emergency shell, plus serial log.
covers: default/plymouth/omarchy.script, default/plymouth/omarchy.plymouth, etc/plymouth/plymouthd.conf, etc/mkinitcpio.conf.d/omarchy_hooks.conf

### faillock-allows-ten-attempts   [VM-OK]
description: Four wrong lock-screen passwords do not lock the account (Omarchy raises the limit from three to ten), and the fifth, correct, password unlocks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `grep -E '^deny' /etc/security/faillock.conf; faillock --user prime` Enter.
  ** `deny = 10` and an empty or short attempt list.
  * Press Super+Escape and click **Lock**.
  * Type `bad1` Enter, `bad2` Enter, `bad3` Enter, `bad4` Enter, screenshotting each rejection.
  ** The lock screen goes black after a few seconds; typing still reaches the field.
  * Type `prime` and press Enter: the desktop unlocks on the fifth attempt.
  * In the terminal type `faillock --user prime` Enter (four entries listed), then `faillock --user prime --reset` Enter to clear them.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not exceed five wrong attempts total; the counter is shared with sudo and the greeter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing `deny = 10`; four rejection screenshots; the unlocked desktop; the faillock list before reset.
  * If unsuccessful
  ** Screenshot of a lockout message or a refused correct password.
covers: etc/security/faillock.conf, install/config/increase-lockout-limit.sh

### terminal-foot-default-config   [VM-OK]
description: Super+Enter opens foot with Omarchy's look (theme colours, JetBrainsMono 9, 14 px padding, no title bar, starship prompt) and its copy/paste keys work.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter.
  ** A tiled terminal with no title bar, dark themed background, visible inner padding and a prompt ending in a cyan `❯`. No username@host in the prompt.
  * Type `echo $TERM; grep -E '^(font|pad)' ~/.config/foot/foot.ini` Enter.
  ** `xterm-256color`, `font=JetBrainsMono Nerd Font:size=9`, `pad=14x14`.
  * Drag the mouse over the word `xterm-256color`, press Ctrl+Shift+C, type `echo ` then press Ctrl+Shift+V and Enter.
  ** The pasted word echoes back.
  * Type `echo held` and press Shift+Enter (not Enter).
  ** The command must NOT run (foot sends a CSI-u code instead of a newline). Press Ctrl+C.
  * Press Ctrl+D; the terminal closes and the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Double-check the selection highlight before pressing Ctrl+Shift+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the fresh terminal (padding, colours, `❯`); the font/pad lines; the echoed paste; the un-executed line after Shift+Enter.
  * If unsuccessful
  ** Screenshot of the window that opened (wrong program, decorations, default font) or nothing opening.
covers: config/foot/foot.ini, applications/foot.desktop, default/xdg-terminal-exec/hyprland-xdg-terminals.list, default/uwsm/default

### starship-prompt-git-and-error-state   [VM-OK]
description: The prompt shows a truncated path, the git branch and status glyphs inside a repo, and turns to ✗ after a failing command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/sp/deep/er && cd /tmp/sp/deep/er` Enter.
  ** The prompt shows `…/deep/er` followed by `❯`.
  * Type `git init -q /tmp/repo1 && cd /tmp/repo1 && touch a` Enter.
  ** Prompt shows `repo1` in bold cyan, `master` in italic cyan and a `?` (untracked).
  * Type `git add a && git -c user.name=t -c user.email=t@t commit -qm init` Enter: the `?` disappears.
  * Type `false` Enter: the prompt character becomes `✗`. Type `true` Enter: back to `❯`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A box where a glyph should be means the Nerd Font is missing; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the truncated path prompt, the repo prompt with branch and `?`, the clean repo prompt, and `✗` after `false`.
  * If unsuccessful
  ** Screenshot of a prompt without branch/status or with rendering errors.
covers: config/starship.toml, default/bash/init, config/git/config

### shell-env-defaults   [VM-OK]
description: Interactive shells carry Omarchy's editor, browser, terminal and locale defaults, while the session deliberately leaves BROWSER unset so browsers can make themselves default.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo "$EDITOR | $BROWSER | $TERMINAL | $OMARCHY_PATH | $LANG"` Enter.
  ** `omarchy-launch-editor --inline | omarchy-launch-browser | xdg-terminal-exec | /usr/share/omarchy | <a UTF-8 locale>`.
  * Type `systemctl --user show-environment | grep -E '^(BROWSER|EDITOR)='` Enter.
  ** `EDITOR=…` is present; no `BROWSER=` line.
  * Type `env -u LANG bash -ic 'printf "%s \U000F17A9\n" "$LANG"' 2>/dev/null` Enter.
  ** A UTF-8 locale followed by a folder glyph, not a literal `\U000F17A9`.
  * Type `xdg-settings get default-web-browser` Enter → `chromium.desktop`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a line wraps, widen the terminal with Super+F (fullscreen) before screenshotting; press Super+F again to restore.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the four outputs matching the expectations, in particular no `BROWSER=` in the session environment.
  * If unsuccessful
  ** Screenshot of a mismatched variable or an empty LANG.
covers: default/bash/envs, default/bash/env-bootstrap, default/uwsm/default, default/uwsm/env.d/10-omarchy, etc/profile.d/omarchy.sh, test/shell.d/{editor-env,browser-env,locale-env}-test.sh

### shell-eza-ls-aliases   [VM-OK]
description: `ls`, `lsa`, `lt` and `lta` are eza views with icons, grouped directories and a two-level tree, and a bad path gives a clear error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/lz/sub && touch /tmp/lz/.hidden /tmp/lz/file.txt && cd /tmp/lz && ls` Enter.
  ** A long listing with icons; `sub` before `file.txt`; `.hidden` not shown.
  * Type `lsa` Enter: `.hidden` is now listed.
  * Type `lt` Enter: a tree of `/tmp/lz` with `sub` expanded. Type `lta` Enter: the tree includes `.hidden`.
  * Type `ls /nonexistent-zz` Enter.
  ** An eza "No such file or directory" error and the prompt shows `✗`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Plain coreutils output (no icons, no grouping) means eza is missing; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `ls` vs `lsa`, both trees, and the error for the bad path.
  * If unsuccessful
  ** Screenshot of coreutils-style output or a hang.
covers: default/bash/aliases (eza block)

### shell-zoxide-cd-and-dotdot   [VM-OK]
description: `cd` learns visited directories so a bare name jumps anywhere and prints where it landed, an unknown name prints "Error: Directory not found", and `..`/`...`/`....` climb the tree.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/zx/alpha/beta && cd /tmp/zx/alpha/beta && cd && pwd` Enter.
  ** `/home/prime` (bare `cd` goes home).
  * Type `cd beta && pwd` Enter.
  ** A folder glyph followed by `/tmp/zx/alpha/beta`, then pwd confirms the jump.
  * Type `cd not-a-dir-9q; echo rc=$?` Enter.
  ** `Error: Directory not found` and `rc=1`.
  * Type `... && pwd && .. && pwd` Enter.
  ** `/tmp/zx` then `/tmp`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * zoxide only knows directories visited once with `cd`; the first command does that visit.
  * A literal `\U000F17A9` instead of a glyph is a locale bug; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the home pwd, the jump line with glyph and path, the error with rc=1, and the two pwd lines after `...` and `..`.
  * If unsuccessful
  ** Screenshot of `cd beta` failing after the visit or of the raw escape text.
covers: default/bash/aliases (zd, dotdot), default/bash/init (zoxide)

### shell-file-open-helpers   [VM-OK]
description: `n` opens Neovim on the directory or file, `ff`/`eff` fuzzy-find a file with a preview and open it in the editor, and `sff` refuses to run without a destination.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/ffx && printf 'alpha\nbeta\n' > /tmp/ffx/notes.txt && cd /tmp/ffx && n` Enter.
  ** Neovim opens with a directory listing of /tmp/ffx. Type `:qa!` Enter.
  * Type `ff` Enter.
  ** An fzf picker lists `notes.txt` with a right-hand preview showing numbered lines `alpha`/`beta`. Press Escape: it closes and the prompt shows `✗`.
  * Type `eff` Enter and press Enter on `notes.txt`.
  ** Neovim opens notes.txt showing `alpha`/`beta`. Type `:q` Enter.
  * Type `sff; echo rc=$?` Enter.
  ** `Usage: sff <destination> (e.g. sff host:/tmp/)` and `rc=1`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fzf filters as you type; type `not` if the list is long.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Neovim explorer, the fzf picker with preview, Neovim on notes.txt, and the sff usage line.
  * If unsuccessful
  ** Screenshot of a missing preview (bat absent), fzf not found, or Neovim failing to start.
covers: default/bash/aliases (n, ff, eff, sff), default/bash/init (fzf)

### shell-compress-decompress   [VM-OK]
description: `compress <dir>` makes `<dir>.tar.gz`, `decompress` unpacks it, and both report a tar error when given nothing or a missing file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/cz/pack && echo hi > /tmp/cz/pack/a.txt && cd /tmp/cz && compress pack/ && ls` Enter.
  ** `pack  pack.tar.gz` (the trailing slash is stripped from the name).
  * Type `mkdir out && cd out && decompress ../pack.tar.gz && cat pack/a.txt` Enter → `hi`.
  * Type `cd /tmp/cz && compress; echo rc=$?; ls -a | grep tar` Enter.
  ** A tar error and a non-zero rc; record whether a stray `.tar.gz` was created.
  * Type `decompress /tmp/cz/missing.tar.gz` Enter → tar "Cannot open: No such file or directory".
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The negative results are printed lines; screenshot right after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the archive listing, `hi`, and both error cases with return codes.
  * If unsuccessful
  ** Screenshot of a silent no-arg compress or a decompress that does nothing.
covers: default/bash/fns/compression

### shell-git-aliases-and-defaults   [VM-OK]
description: The git aliases and Omarchy's git config work end to end: `master` on init, a first commit that explains a missing identity, automatic upstream on push.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/gx && cd /tmp/gx && g init && g st` Enter.
  ** "Initialized empty Git repository" and `On branch master`.
  * Type `echo a > a && git add a && gcm first` Enter.
  ** If no identity was set at install, git prints "Please tell me who you are" (expected). Then type `git config user.name T && git config user.email t@e.com && gcm first` Enter → the commit succeeds. If an identity exists it succeeds at once; record which.
  * Type `echo b >> a && gcam second && gcad --no-edit && git log --oneline` Enter → two commits.
  * Type `git init -q --bare /tmp/gx-remote && git remote add origin /tmp/gx-remote && git push` Enter.
  ** Push succeeds and prints that `master` is set up to track `origin/master` (no `-u` needed).
  * Type `git co -b feature && git br` Enter → `* feature` above `master`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `gcad` opens no editor because of `--no-edit`; if an editor opens anyway type `:q` Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `master` on init, the identity message (or immediate success), the two-commit log, the auto-upstream push text, and the branch list.
  * If unsuccessful
  ** Screenshot of `main` as default, a push refused for missing upstream, or an alias not found.
covers: config/git/config, default/bash/aliases (git block), install/user/git.sh

### shell-drive-helpers-usage-and-abort   [VM-OK]
description: The destructive drive helpers show usage and a drive list when misused, find no removable drive in the guest, and `format-drive` does nothing when the confirmation is declined.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `iso2sd; echo rc=$?` Enter.
  ** Two usage lines and `rc=1`.
  * Type `touch /tmp/fake.iso && iso2sd /tmp/fake.iso; echo rc=$?` Enter.
  ** `No SD drives found and no drive specified`, `rc=1`, and no sudo prompt.
  * Type `format-drive` Enter.
  ** Usage, an example, and `Available drives:` listing `/dev/vda` (and `/dev/zram0`).
  * Type `format-drive /dev/vda Nope` Enter.
  ** `WARNING: This will completely erase all data on /dev/vda…` and `Are you sure you want to continue? (y/N):`.
  * Type `n` and press Enter. NEVER type `y`.
  ** The function returns silently; type `lsblk` Enter and see the vda partitions unchanged.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Answer `n` (or Ctrl+C) to the prompt; anything else destroys the guest.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both usage outputs, the "No SD drives found" line, the WARNING prompt, and `lsblk` unchanged.
  * If unsuccessful
  ** Screenshot of a sudo prompt or dd starting without confirmation.
covers: default/bash/fns/drives

### shell-ssh-helpers-without-server   [VM-OK]
description: With no SSH server reachable, the ssh wrapper and the `fip`/`dip`/`lip` forwarders fail fast with clear messages, never enter the reconnect loop, and leave the terminal clean.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `fip; dip; lip` Enter.
  ** `Usage: fip <host> <port1> [port2] ...`, `Usage: dip <port1> [port2] ...`, `No active forwards`.
  * Type `fip localhost 9999; lip` Enter.
  ** `Connection refused` from ssh, NO "Forwarding localhost:9999" line, and `No active forwards`.
  * Type `dip 9999` Enter → `No forwarding on port 9999`.
  * Type `ssh localhost; echo rc=$?` Enter.
  ** Fails at once with `Connection refused`, `rc=255`, and NO "Connection lost. Reconnecting" text.
  * Move the mouse across the terminal and type `echo ok` Enter.
  ** No escape junk appears; `ok` prints (the wrapper disarmed terminal modes).
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a password prompt ever appears, press Ctrl+C and report it: nothing here should connect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage lines, the refused forward without a Forwarding line, the `rc=255` with no reconnect text, and the clean `ok`.
  * If unsuccessful
  ** Screenshot of a hang beyond 15 s, a reconnect loop, or mouse escape junk in the prompt.
covers: default/bash/fns/ssh-port-forwarding, default/bash/fns/ssh-reconnect, install/config/ssh-keepalive.sh

### shell-rsync-watchers   [VM-OK]
description: `rsw` starts a background sync-on-change watcher whose effect is visible in the destination, `lsw` lists it, `dsw` stops it, and wrong usage prints help.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `rsw; lsw; dsw` Enter.
  ** `Usage: rsw <source> <destination>`, `No active watches`, `No active watches`.
  * Type `mkdir -p /tmp/rs/src && echo one > /tmp/rs/src/one.txt && rsw /tmp/rs/src /tmp/rs/dst` Enter → `Watching /tmp/rs/src -> /tmp/rs/dst`.
  * Type `sleep 2; echo two > /tmp/rs/src/two.txt; sleep 3; ls /tmp/rs/dst` Enter → `one.txt  two.txt`.
  * Type `lsw` Enter → one line `<pid>: /tmp/rs/src -> /tmp/rs/dst`.
  * Type `dsw; echo three > /tmp/rs/src/three.txt; sleep 3; ls /tmp/rs/dst` Enter.
  ** `Stopped watch (pid N)` and the listing still shows only `one.txt two.txt`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `lsw` shows nothing right after `rsw`, the watcher died (inotifywait missing); report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage lines, the Watching line, the synced listing, the lsw entry, and the unchanged listing after dsw.
  * If unsuccessful
  ** Screenshot of files not syncing or `lsw` empty after `rsw`.
covers: default/bash/fns/rsyncing

### shell-worktree-ga-gd   [VM-OK]
description: `ga <branch>` creates and enters a sibling worktree, `gd` asks before removing it and refuses to act on a directory that is not a worktree.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `ga; echo rc=$?` Enter → `Usage: ga [branch name]`, `rc=1`.
  * Type `mkdir -p /tmp/wt/proj && cd /tmp/wt/proj && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && ga feature-x && pwd` Enter.
  ** `Preparing worktree (new branch 'feature-x')` and pwd `/tmp/wt/proj--feature-x`.
  * Type `gd` Enter.
  ** A gum prompt `Remove worktree and branch?` appears. Select **No** (arrow keys, Enter): nothing is removed.
  * Type `gd` Enter and select **Yes**.
  ** `Deleted branch feature-x`; type `pwd` Enter → `/tmp/wt/proj`.
  * Type `cd /tmp/wt && gd` Enter, select Yes → nothing happens (no `--` in the name).
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right moves, Enter chooses; the highlighted button is the selection.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage, the worktree creation with pwd, the gum prompt, the state after No, the deletion after Yes, and the protected no-op.
  * If unsuccessful
  ** Screenshot of a worktree removed without confirmation or `gd` deleting a non-worktree directory.
covers: default/bash/fns/worktrees

### readline-inputrc-behaviour   [VM-OK]
description: Up/Down search history by prefix, Tab cycles through completions after completing the common prefix, and completion ignores case and hidden files.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo first-a` Enter, `echo first-b` Enter, `ls /tmp` Enter.
  * Type `echo` (no Enter) and press Up twice.
  ** The line becomes `echo first-b`, then `echo first-a`; `ls /tmp` is skipped. Press Ctrl+C.
  * Type `cd ~/down` and press Tab once → `cd ~/Downloads/` despite the lowercase d. Press Ctrl+C.
  * Type `touch /tmp/ab1 /tmp/ab2 /tmp/.abh` Enter, then type `ls /tmp/ab` and press Tab, Tab, Tab, Shift+Tab.
  ** First Tab lists `ab1 ab2`; the next Tabs cycle the line to `/tmp/ab1`, `/tmp/ab2`; Shift+Tab goes back. `.abh` never appears. Press Ctrl+C.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot after every single Tab so the cycling is visible.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prefix recall, the case-insensitive completion, and the cycling sequence without the hidden file.
  * If unsuccessful
  ** Screenshot of Up recalling `ls /tmp` or Tab listing without cycling.
covers: default/bash/inputrc, default/bash/rc

### omarchy-tab-completion   [VM-OK]
description: `omarchy <Tab>` completes command groups and actions so the CLI is discoverable, while raw `omarchy-*` binary names are hidden from first-word completion.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter, type `omarchy ` (trailing space) and press Tab twice.
  ** Groups appear, including `theme`, `update`, `refresh`, `toggle`, `install`, `commands`.
  * Type `theme ` and press Tab twice → actions such as `set`, `list`, `current`, `bg`.
  * Press Ctrl+C, type `omarchy commands --` and press Tab twice → `--all --json --markdown --check`.
  * Press Ctrl+C, type `omarchy-th` and press Tab.
  ** Nothing completes (binaries hidden). Press Ctrl+C.
  * Type `omarchy theme bogus` Enter → a usage/help message, no crash.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Completion lists print below the prompt; screenshot before the next keystroke clears them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the group list, the theme action list, the `commands` flags, the non-completion of `omarchy-th`, and the bogus-subcommand help.
  * If unsuccessful
  ** Screenshot of `omarchy-*` binaries offered at word one or no group completion.
covers: default/bash/completions

### man-pages-render-through-bat   [VM-OK]
description: `man` pages are colourised through bat and a missing page still gives the normal "No manual entry" error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `man ls` Enter.
  ** The page shows with coloured headings/options and the header `LS(1)`.
  * Press `q`.
  * Type `man no-such-page-zz; echo rc=$?` Enter → `No manual entry for no-such-page-zz`, `rc=16`.
  * Type `MANPAGER=cat man ls | head -3` Enter → plain uncoloured text (the pager is what adds colour).
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the page shows a `bat`/`col` "not found" error instead, that is the failure to capture.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the coloured man page, the missing-page error with rc, and the plain variant.
  * If unsuccessful
  ** Screenshot of the pager error or an uncoloured default page.
covers: default/bash/envs (MANPAGER, MANROFFOPT, BAT_THEME)

### shell-agent-alias-without-default   [VM-OK]
description: The `a` alias launches the default AI agent; with none chosen it explains how to choose one, the picker hotkey opens the agent menu, and a bogus agent is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo "agent=[$(omarchy-default-agent)]"; a; echo rc=$?` Enter.
  ** `agent=[]`, a message containing `Choose default agent with`, and a non-zero rc. Nothing downloads.
  * Press Super+Shift+Ctrl+A.
  ** The Omarchy menu opens at Setup → Default → Agent listing Claude, Codex, Cursor CLI, Grok, Hermes… Press Escape without choosing.
  * Type `omarchy-default-agent bogus-agent; echo rc=$?; echo "agent=[$(omarchy-default-agent)]"` Enter.
  ** An unsupported-agent error, non-zero rc, and the default still empty.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not select an agent in the menu: it installs through mise (network, minutes).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty default with the "Choose default agent" message, the agent menu, and the rejected bogus agent.
  * If unsuccessful
  ** Screenshot of an install starting or an unset default launching something.
covers: default/bash/aliases (a), bin/omarchy-agent, test/shell.d/default-agent-test.sh

### tmux-omarchy-config-and-t-alias   [VM-OK]
description: Super+Alt+Enter and the `t` alias give a tmux with Omarchy's config: status bar on top, Ctrl+Space prefix, Alt-key splits and a keybindings popup.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Enter.
  ** A terminal inside tmux: status line at the TOP with the session name on a blue block (left) and the hostname (right).
  * Press Alt+Enter, then Alt+Shift+Enter.
  ** The pane splits stacked, then the active pane splits side by side (three panes).
  * Press Ctrl+Space then `?`.
  ** A centred popup "Tmux keybindings" lists bindings; press `q`.
  * Press Alt+Escape twice → one pane remains. Press Ctrl+Space then `d` → detached, window closes.
  * Press Super+Enter and type `t` Enter.
  ** tmux re-attaches to the existing session (same status bar). Press Ctrl+Space `d`, then type `tmux kill-server` Enter.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Prefix2 Ctrl+B also works if Ctrl+Space is swallowed.
  * Window names follow the current directory basename.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the top status bar, the three-pane split, the keybindings popup, and the `t` re-attach.
  * If unsuccessful
  ** Screenshot of a bottom status bar, the prefix not working, or the popup command failing.
covers: config/tmux/tmux.conf, default/bash/aliases (t), default/hypr/bindings/applications.lua

### tmux-dev-layouts   [VM-OK]
description: `tdl`, `tds` and `tsl` build the editor/AI, square and swarm layouts inside tmux, and refuse to run outside tmux or without arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `tdl bash; tsl 2 x; tds` Enter.
  ** Three lines `You must start tmux to use tdl/tsl/tds.`
  * Type `mkdir -p /tmp/lay && cd /tmp/lay && tmux new -s lay` Enter, then `tdl; tsl 3; tds x` Enter.
  ** `Usage: tdl <c|cx|codex|other_ai> [<second_ai>]`, `Usage: tsl <pane_count> <command>`, `Usage: tds`.
  * Type `tdl bash` Enter.
  ** Window renamed `lay`; large left pane running Neovim, a right pane (~30%) with a bash prompt, a thin bottom pane.
  * Click the bottom pane and type `tmux kill-window; tmux new-window` Enter, then `tsl 4 'echo swarm-$RANDOM'` Enter.
  ** Four tiled panes, each printing a `swarm-<n>` line.
  * Type `tmux kill-window; tmux new-window` Enter in one pane, then `tds` Enter.
  ** Four panes: Neovim, a pane that tried `hunk diff --watch`, a shell, a pane that tried `opencode`. On a stock install the hunk pane shows "command not found"; record what the opencode pane shows and press Ctrl+C in it if it starts downloading.
  * Type `tmux kill-server` Enter in the shell pane; press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `bash` is used as the "AI" so nothing downloads; the `ic`/`ix`/`icx` aliases would start real agents.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three refusals, the three usage lines, the tdl layout with Neovim, the 4-pane swarm, and the tds square with each pane's content.
  * If unsuccessful
  ** Screenshot of a wrong pane count, a missing rename, or a tmux error.
covers: default/bash/fns/tmux, default/bash/aliases (ic, ix, icx)

### herdr-layout-functions   [VM-OK]
description: The herdr layout helpers refuse to run outside herdr with a clear message, and inside herdr (Super+Ctrl+Enter) `hsl` tiles panes running a command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `hdl; hdl bash; hds x; hds; hsl 2 bash` Enter.
  ** `Usage: hdl …`, `You must start herdr to use hdl.`, `Usage: hds`, `You must start herdr to use hds.`, `You must start herdr to use hsl.` (a "not found" means the minted 4.0.2 predates that helper: record it).
  * Press Super+Ctrl+Enter.
  ** A herdr window opens (tab bar, hostname on the right).
  * Type `cd /tmp && hsl 3 'echo herdr-$RANDOM'` Enter.
  ** Three tiled panes each printing `herdr-<n>`; the tab is renamed `tmp`.
  * Press Ctrl+Space then `?` → the herdr help overlay; press Escape.
  * Press Alt+Escape three times to close the panes and the window; close the first terminal with Ctrl+D. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Super+Ctrl+Enter opens nothing, type `herdr` in the terminal; if it is not installed, mark the inside-herdr steps skipped.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the refusal/usage lines, the herdr window, the 3-pane swarm, and the help overlay.
  * If unsuccessful
  ** Screenshot of a helper acting outside herdr or herdr crashing.
covers: default/bash/fns/herdr, config/herdr/config.toml, test/shell.d/herdr-functions-test.sh

### about-fastfetch   [VM-OK]
description: Omarchy Menu → About opens a fitted window with fastfetch's logo and the Hardware/Software/Age boxes, and a fresh terminal does not print fastfetch on its own.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space, type `about` and press Enter.
  ** A floating terminal sized to the content: green ASCII Omarchy logo left; boxes `Hardware`, `Software`, `Age / Uptime / Update` right.
  ** Software shows `OS Omarchy <version>`, a channel, `WM Hyprland`, `Terminal foot`, a theme name with eight coloured dots. Hardware shows 2 CPU cores, ~4 GB memory, a ~4 GB zram swap.
  * Press `q` (or Escape): the window closes.
  * Press Super+Enter: only the prompt appears, no fastfetch banner.
  * Type `fastfetch | head -12` Enter → the same layout inline.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The About window has a brief sheen animation over the logo; wait a second before the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the About window with all three boxes legible; a fresh terminal with only the prompt; the inline fastfetch.
  * If unsuccessful
  ** Screenshot of a blank OS line, a garbled logo, or a window that does not close.
covers: etc/fastfetch/config.jsonc, bin/omarchy-launch-about, default/bashrc

### sudo-password-prompt-and-retries   [VM-OK]
description: `sudo` asks for the account password, tolerates more than three typos, caches the credential, and lists the few passwordless rules Omarchy grants.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `sudo -k; sudo -n true; echo rc=$?` Enter → `sudo: a password is required`, `rc=1`.
  * Type `sudo true` Enter, then at the prompt type `wrong1` Enter, `wrong2` Enter, `wrong3` Enter, `wrong4` Enter.
  ** Each gives `Sorry, try again.` and a FIFTH prompt still appears (upstream stops at three).
  * Type `prime` Enter → succeeds silently. Type `sudo -n true; echo rc=$?` Enter → `rc=0` (cached).
  * Type `sudo -l | grep -E 'NOPASSWD|passwd_tries'` Enter.
  ** `passwd_tries=10` and NOPASSWD lines for `omarchy-dns Cloudflare/Google/DHCP`, `timedatectl ^set-timezone …`, `omarchy-theme-set-browser-policy […]`.
  * Type `sudo -k; faillock --user prime --reset` Enter (enter `prime`).
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Passwords are not echoed; count Enter presses. Four wrong + one right stays well under the faillock limit.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of four "Sorry, try again." lines followed by success, the cached `rc=0`, and the rule listing.
  * If unsuccessful
  ** Screenshot of "3 incorrect password attempts" or a lockout.
covers: etc/sudoers.d/omarchy-passwd-tries, etc/sudoers.d/*, etc/security/faillock.conf

### timezone-sudo-rule-rejects-variants   [VM-OK]
description: Only the exact `timedatectl set-timezone <Zone>` form is passwordless; extra flags, junk zones and other subcommands ask for a password, and an invalid zone fails harmlessly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `timedatectl show -p Timezone --value` Enter; write down the value (ORIGINAL).
  * Type `sudo -k; sudo timedatectl set-timezone Pacific/Kiritimati; echo rc=$?` Enter.
  ** No password prompt, `rc=0`, and the bar clock jumps within a few seconds (UTC+14).
  * Type `sudo -k; sudo -n timedatectl set-timezone -H localhost Europe/Paris; echo rc=$?` Enter → `a password is required`, rc=1.
  * Type `sudo -n timedatectl set-timezone 'Bad;Zone'; sudo -n timedatectl set-time '2020-01-01 00:00:00'` Enter → both `a password is required`.
  * Type `sudo -n timedatectl set-timezone Not/AZone; echo rc=$?` Enter.
  ** No prompt (pattern matches) but `Failed to set time zone: Invalid time zone` and a non-zero rc; zone stays Kiritimati.
  * Type `sudo timedatectl set-timezone <ORIGINAL>` Enter (no prompt); confirm the bar clock returns to the original time.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar clock is the visible proof of each change; screenshot the whole screen, not just the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompt-free change with the clock before/after, each "a password is required" line, the invalid-zone error, and the restored clock.
  * If unsuccessful
  ** Screenshot of a password prompt for the plain form or of a flagged form accepted without one.
covers: etc/sudoers.d/omarchy-tzupdate, test/shell.d/timezone-test.sh

### dns-preset-switch-without-password   [VM-OK]
description: Switching between the stock DNS providers from the Network menu or the terminal needs no password, the Custom provider still asks, and the machine keeps resolving names afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-dns` Enter → the current provider (normally `DHCP`).
  * Type `sudo -k; sudo omarchy-dns Cloudflare; omarchy-dns` Enter.
  ** No password prompt; `Cloudflare`.
  * Type `sudo -k; sudo -n omarchy-dns Custom; sudo -n omarchy-dns cloudflare; omarchy-dns Bogus` Enter.
  ** Two `a password is required` lines (Custom, and lowercase does not match) and a usage error for Bogus.
  * Press Super+Space → Setup → Network → DNS.
  ** DHCP / Cloudflare / Google / Custom are listed, ✓ on Cloudflare. Click **Google** with the mouse: no password dialog.
  * Reopen the DNS submenu: ✓ is on Google. Click **DHCP** to restore.
  * In the terminal type `omarchy-dns; getent hosts omarchy.org` Enter → `DHCP` and an address.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The ✓ marker is the on-screen state; screenshot the submenu each time it opens.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prompt-free Cloudflare switch, the two refusals and the Bogus error, the DNS submenu with ✓ moving Cloudflare → Google → DHCP, and the working lookup.
  * If unsuccessful
  ** Screenshot of a password prompt for a stock provider, Custom running unprompted, or a failed lookup.
covers: etc/sudoers.d/omarchy-dns, bin/omarchy-dns, default/omarchy/omarchy-menu.jsonc (setup.network.dns), test/shell.d/dns-sudoers-test.sh

### passwordless-sudo-toggle-expiry   [VM-OK]
description: Setup → Security → Passwordless Sudo warns, asks to confirm, grants blanket NOPASSWD for a limited time, expires on its timer, and a second run revokes early.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Security → click **Passwordless Sudo**.
  ** A floating terminal prints `Toggle passwordless sudo...`, may ask the sudo password (`prime`), shows the WARNING block and a gum confirm. Choose **No** → `Aborted. No changes made.` and the window closes.
  * Press Super+Enter and type `omarchy-sudo-passwordless 1` Enter; choose **Yes**.
  ** `Passwordless sudo has been ENABLED. It will automatically disable in 1 minutes.`
  * Type `sudo -k; sudo -n true; echo rc=$?` Enter → `rc=0`.
  * Wait 70 seconds, screenshotting every 5 s, then type `sudo -k; sudo -n true; echo rc=$?` Enter → `a password is required`, `rc=1`.
  * Type `omarchy-sudo-passwordless` Enter, choose Yes (15 min), then type `omarchy-sudo-passwordless` Enter again.
  ** `Passwordless sudo has been DISABLED. Sudo will require a password again.`; `sudo -k; sudo -n true` → password required.
  * Type `omarchy-sudo-passwordless abc` Enter → `Usage: omarchy-sudo-passwordless [MINUTES]`.
  * Press Ctrl+D; the desktop is as before and sudo asks for a password.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right or Tab moves, Enter chooses.
  * The 70 s wait is fourteen 5 s screenshots; never a single long sleep.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the menu-launched warning declined, the ENABLED message, `rc=0`, the expired `a password is required`, the DISABLED message, and the usage error.
  * If unsuccessful
  ** Screenshot of the grant surviving past the timer or remaining after DISABLED.
covers: bin/omarchy-sudo-passwordless, etc/tmpfiles.d/omarchy-nopasswd-sudo.conf, default/omarchy/omarchy-menu.jsonc (setup.security.passwordless-sudo)

### docker-cli-requires-elevation   [VM-OK]
description: The plain `docker` CLI is refused at the socket because the user is not in the docker group, while `sudo docker` works through the socket-activated daemon.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `id -nG; docker ps; echo rc=$?` Enter.
  ** Groups include `wheel` but not `docker`; `permission denied while trying to connect to the Docker daemon socket`, `rc=1`.
  * Type `omarchy-sudo-docker; echo rc=$?; omarchy-sudo-docker --bogus; echo rc=$?` Enter → `rc=0` (sudo needed) and a usage error with `rc=2`.
  * Type `sudo docker ps` Enter (password `prime`).
  ** After a few seconds an empty `CONTAINER ID …` header (the daemon started on demand).
  * Type `ls -l /var/run/docker.sock` Enter → `srw-rw---- root docker`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first `sudo docker ps` can take ~10 s while docker.service starts; keep screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the group list without docker, the permission-denied error, the exit codes, `sudo docker ps` succeeding, and the socket permissions.
  * If unsuccessful
  ** Screenshot of `docker ps` succeeding without sudo, or the daemon failing under sudo.
covers: install/config/docker.sh, etc/docker/daemon.json, etc/systemd/system/docker.service.d/no-block-boot.conf, bin/omarchy-sudo-docker, test/acceptance.d/system-test.sh

### docker-tui-polkit-prompt   [VM-OK]
description: Super+Shift+D opens lazydocker behind a polkit dialog; a wrong password is rejected, the right one opens the TUI, and cancelling closes cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+D.
  ** A terminal appears and over it the Omarchy polkit dialog asking to authorize running as the super user, with a password field.
  * Type `wrong` and press Enter.
  ** The dialog reports failure and re-prompts (or closes and the terminal says not authorized). Screenshot.
  * Type `prime` Enter (press Super+Shift+D again first if the dialog closed).
  ** lazydocker opens (panels Project / Containers / Images / Volumes). Press `q`; the window closes.
  * Press Super+Alt+Space, type `Docker`, Enter → the same dialog; press Escape.
  ** The terminal closes with no TUI.
  * The desktop is as before (no stray windows).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog is drawn by the Omarchy shell, centred, with a shortened "Authorize running …" label.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, the rejected wrong password, lazydocker running, and the cancelled launch closing.
  * If unsuccessful
  ** Screenshot of lazydocker opening with no prompt, or a hang after cancel.
covers: bin/omarchy-launch-docker-tui, applications/Docker.desktop, default/hypr/bindings/applications.lua, test/shell.d/polkit-test.sh

### sudoless-docker-menu-decline   [VM-OK]
description: Setup → Security → Sudoless Docker warns that the docker group is root-equivalent and asks to confirm; declining changes nothing and the Remove counterpart stays hidden.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Security.
  ** **Sudoless Docker** is listed.
  * Click it: a floating terminal shows the root-equivalence warning and a gum confirm. Choose **No**.
  ** The script reports no change and the window closes.
  * Press Super+Enter and type `id -nG | grep -c docker; ls ~/.local/state/omarchy/reboot-required` Enter → `0` and "No such file".
  * Press Super+Space → Remove → Security: **Sudoless Docker** is NOT listed.
  * In the terminal type `omarchy-remove-security-sudoless-docker` Enter → a no-op message, no reboot prompt.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never choose Yes: it adds the group, flags a reboot and offers to reboot immediately.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Setup list, the warning declined, the unchanged group/flag, the Remove list without the entry, and the no-op remove.
  * If unsuccessful
  ** Screenshot of the group added after No, or Remove listing the entry while off.
covers: bin/omarchy-setup-security-sudoless-docker, bin/omarchy-remove-security-sudoless-docker, default/omarchy/omarchy-menu.jsonc, test/shell.d/sudoless-docker-toggle-test.sh

### firewall-ufw-defaults   [VM-OK]
description: UFW is active with deny-in/allow-out, only the LocalSend and Docker-DNS exceptions and no SSH rule, while outbound web traffic works.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl is-active ufw; ufw status; echo rc=$?` Enter.
  ** `active`, then `ERROR: You need to be root to run this script`, `rc=1`.
  * Type `sudo ufw status verbose` Enter (password `prime`).
  ** `Status: active`; `Default: deny (incoming), allow (outgoing)…`; rules for `53317/udp` and `53317/tcp` ALLOW IN Anywhere; `172.17.0.1 53/udp` ALLOW IN from `172.16.0.0/12` and `192.168.0.0/16` (allow-docker-dns); NO `22/tcp` rule.
  * Type `curl -s --max-time 5 -o /dev/null -w '%{http_code}\n' https://omarchy.org` Enter → `200`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the rule table scrolls, type `sudo ufw status verbose | sudo tee /dev/ttyS0` and read it with `./client get-serial`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the non-root refusal, the full `ufw status verbose` (or its serial dump), and the `200`.
  * If unsuccessful
  ** Screenshot of `Status: inactive`, a missing default deny, or a `22/tcp` rule.
covers: install/config/firewall.sh, test/shell.d/firewall-config-test.sh, test/acceptance.d/system-test.sh

### cups-web-ui-admin-denied   [VM-OK]
description: CUPS serves its web UI on localhost:631 but the desktop user cannot administer printers there or from the CLI; Print Settings goes through polkit instead.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl is-active cups; lpstat -r; lpinfo -v; pgrep -x cups-browsed || echo no-cups-browsed` Enter.
  ** `active`, `scheduler is running`, `lpinfo: Forbidden`, `no-cups-browsed`.
  * Press Super+Shift+Enter, type `localhost:631` in the address bar, Enter.
  ** The CUPS home page (tabs Home / Administration / Classes / Help / Jobs / Printers).
  * Click **Administration**, then **Add Printer**.
  ** A basic-auth dialog appears; enter `prime` / `prime`. Result: a "Forbidden" page (or the dialog re-appears). The printer wizard must NOT open. Press Escape if re-prompted.
  * Click **Printers** → an empty list loads without authentication. Close Chromium (Super+W).
  * Press Super+Alt+Space, type `Print Settings`, Enter; click **Add**.
  ** A polkit dialog appears; press Escape. Close the app (Super+W).
  * Close the terminal (Ctrl+D); the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chromium marks http://localhost as "not secure"; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the status lines with `lpinfo: Forbidden`, the CUPS home page, the auth dialog and the Forbidden result, the Printers page, and the polkit dialog from Print Settings.
  * If unsuccessful
  ** Screenshot of the Add Printer wizard opening for `prime`, the web UI not loading, or a cups-browsed process.
covers: etc/cups/cups-files.conf, etc/cups/cups-browsed.conf, etc/systemd/system/cups-browsed.service.d/10-omarchy.conf, install/config/enable-services.sh, test/acceptance.d/cups-test.sh, test/shell.d/cups-hardening-test.sh

### chromium-bundled-extensions-listed   [VM-OK]
description: Chromium starts with Omarchy's flags and the three bundled extensions enabled (Copy URL, Download Video, WhatsApp Slim) with their native-messaging hosts registered.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Enter; the browser opens with a dark UI.
  * Type `chrome://extensions` in the address bar, Enter.
  ** Three enabled cards: **Copy URL** 1.5, **Download Video** 1.0, **WhatsApp Slim** 1.1, each described as installed by Omarchy.
  * Type `chrome://version`, Enter.
  ** Command Line contains `--ozone-platform=wayland`, `--password-store=gnome-libsecret` and `--load-extension=/usr/share/omarchy/default/chromium/extensions/copy-url,…yt-dlp,…whatsapp-slim`.
  * Type `chrome://extensions/shortcuts`, Enter → Copy URL `Alt+Shift+L`, Download Video `Alt+Shift+D` (record if blank on 4.0.2).
  * Press Super+W. Press Super+Enter and type `ls ~/.config/chromium/NativeMessagingHosts/` Enter → `com.omarchy.copy_url.json  com.omarchy.ytdlp.json`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Dismiss any "unpacked extensions" bubble on start.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the extensions page with three enabled cards, the command line, the shortcuts page, and the native-host listing.
  * If unsuccessful
  ** Screenshot of a missing/disabled extension or missing host files.
covers: config/chromium-flags.conf, config/chromium/Default/Preferences, default/chromium/extensions/*/manifest.json, default/chromium/native-messaging-hosts/*, install/user/chromium.sh

### chromium-copy-url-extension   [VM-OK] [NET]
description: Alt+Shift+L (or the Copy URL toolbar button) copies the current tab's full URL to the clipboard with a confirmation toast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `wl-copy sentinel` Enter.
  * Press Super+Shift+Enter, type `https://omarchy.org/manual/?q=one&x=two` in the address bar, Enter; wait for the page.
  * Press Alt+Shift+L.
  ** A toast "URL copied to clipboard" appears top-right within ~2 s.
  * Click the terminal and type `wl-paste` Enter → exactly `https://omarchy.org/manual/?q=one&x=two`.
  * Back in Chromium click the puzzle-piece toolbar button, then **Copy URL** → the same toast.
  * Type `wl-copy sentinel` Enter in the terminal; in Chromium press Ctrl+T (new tab) then Alt+Shift+L; `wl-paste` → either `chrome://newtab/` or still `sentinel`; record which. Nothing may crash.
  * Press Super+W to close Chromium and Ctrl+D to close the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts fade in a few seconds; screenshot immediately after the shortcut.
  * If the shortcut does nothing but the button works, the shortcut is unregistered on 4.0.2; report as such.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the toast right after Alt+Shift+L; `wl-paste` showing the exact URL with query string; the toolbar variant.
  * If unsuccessful
  ** Screenshot with no toast and `wl-paste` still `sentinel`.
covers: default/chromium/extensions/copy-url/*, default/chromium/native-messaging-hosts/com.omarchy.copy_url.json, bin/omarchy-chromium-copy-url-host, test/shell.d/chromium-copy-url-test.sh

### chromium-ytdlp-extension   [VM-OK] [NET] [SLOW]
description: Alt+Shift+D hands the current video page to yt-dlp, which notifies on start and completion and saves the file to ~/Videos; a page without a video reports failure.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `ls ~/Videos` Enter (note the contents).
  * Press Super+Shift+Enter and open `https://www.youtube.com/watch?v=aqz-KE-bpKQ` (a short trailer). Dismiss any consent dialog.
  * Press Alt+Shift+D.
  ** A toast about the download starting; later (30 s–3 min) a toast that it finished, naming the title.
  * In the terminal type `ls -la ~/Videos` Enter every ~10 s until a new video file appears and stops growing.
  * Click the completion toast if still visible → mpv plays the file; press `q`.
  * In Chromium open `https://example.com` and press Alt+Shift+D → a failure toast (no video found); `ls ~/Videos` shows no new file.
  * Press Super+W and Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If YouTube shows a sign-in wall, use `https://vimeo.com/76979871` and note it.
  * Keep the total wait under ~5 minutes; report partial progress otherwise.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the start and completion toasts, the listing with the new file, mpv playing it, and the failure toast for example.com.
  * If unsuccessful
  ** Screenshot of no toast after the shortcut and an unchanged `~/Videos`.
covers: default/chromium/extensions/yt-dlp/*, default/chromium/native-messaging-hosts/com.omarchy.ytdlp.json, bin/omarchy-chromium-ytdlp-host, test/shell.d/chromium-ytdlp-test.sh

### chromium-whatsapp-slim-theme   [VM-PARTIAL] [NET]
description: The WhatsApp web app opens as a Chromium app window where WhatsApp Slim forces system-theme (dark) mode; the narrow-window chat-list collapse needs a logged-in account and is skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Alt+G (or Super+Alt+Space → WhatsApp → Enter).
  ** A Chromium app window (no address bar) shows the WhatsApp Web login/QR page in dark colours.
  * Press F12; in the Console type `localStorage.getItem("system-theme-mode")` Enter → `"true"`. Press F12 again to close (skip if DevTools is unavailable in app mode).
  * Press Super+T (float) and drag the window's right edge to make it narrower than about half the screen.
  ** The page still renders without a horizontal scrollbar.
  * Press Super+W to close the window; the desktop is as before.
  * Skipped: logging in (needs a phone) and the 90 px avatar rail below 1100 px.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Drag from the window edge, not the title area; floating windows have no title bar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dark WhatsApp login page in an app window, the console value, and the narrowed window.
  * If unsuccessful
  ** Screenshot of a light-themed page or the window failing to open.
covers: default/chromium/extensions/whatsapp-slim/*, applications/WhatsApp.desktop, bin/omarchy-launch-webapp

### firefox-policies-after-install   [VM-OK] [NET] [SLOW]
description: Installing Firefox through Omarchy pre-sets its VAAPI, fractional-scaling and overscroll preferences as changeable defaults, visible in about:policies.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Browser → **Firefox**; wait for the install (~100 MB), screenshotting every 5 s.
  * Press Super+Enter and type `firefox about:policies &` Enter.
  ** The Active table lists `Preferences` with `apz.overscroll.enabled`, `media.ffmpeg.vaapi.enabled`, `media.hardware-video-decoding.force-enabled`, `widget.disable-swipe-tracker`, `widget.wayland.fractional-scale.enabled`, each `Status: default`.
  * In Firefox open `about:config`, search `widget.wayland.fractional-scale.enabled` → `true`; double-click to toggle to `false` (editable), double-click again to restore.
  * Close Firefox (Super+W). Do not make it default.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the download exceeds the session budget, report progress and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install completing, about:policies with the five entries, and the editable about:config pref.
  * If unsuccessful
  ** Screenshot of about:policies showing "No policies" or an install failure.
covers: default/firefox/policies.json, test/shell.d/browser-policy-dir-test.sh

### xdg-default-apps-open   [VM-OK]
description: Opening a text file, an image, a folder and a URL lands in Neovim, imv, Nautilus and Chromium respectively, and a missing file errors instead of opening anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo hello > /tmp/o.txt && cp /usr/share/omarchy/default/plymouth/logo.png /tmp/o.png && open /tmp/o.txt` Enter.
  ** A terminal window with Neovim showing `hello` opens. Type `:q` Enter.
  * Type `xdg-open /tmp/o.png` Enter → imv shows the Omarchy logo. Press `q`.
  * Type `xdg-open /tmp` Enter → Nautilus opens at /tmp. Press Super+W.
  * Type `xdg-open https://omarchy.org` Enter → Chromium opens the page. Press Super+W.
  * Type `xdg-open /tmp/does-not-exist.txt; echo rc=$?` Enter.
  ** `xdg-open: file '/tmp/does-not-exist.txt' does not exist`, `rc=2`, nothing opens.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each app takes 1–3 s to appear; screenshot after a short wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Neovim with `hello`, imv with the logo, Nautilus at /tmp, Chromium on omarchy.org, and the error for the missing file.
  * If unsuccessful
  ** Screenshot of the wrong application launching or an "Open with" chooser.
covers: default/applications/mimeapps.list, default/bash/aliases (open), applications/imv.desktop, test/acceptance.d/system-test.sh

### mailto-and-webapp-handlers   [VM-OK] [NET]
description: `mailto:` links open the HEY web app and `zoommtg:` links the Zoom web client, while an unknown scheme yields an error rather than a chooser.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `xdg-open 'mailto:test@example.com?subject=Hi'` Enter.
  ** A Chromium app window opens on `app.hey.com` (sign-in page). Press Super+W.
  * Type `xdg-open 'zoommtg://zoom.us/join?confno=123456789'` Enter.
  ** A Chromium app window opens on a `zoom.us` web-client URL; no "no application" dialog. Press Super+W.
  * Type `xdg-open 'notascheme://x'; echo rc=$?` Enter → an xdg-open error, non-zero rc, nothing opens.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * App windows have no address bar; the page content identifies the site.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the HEY app window, the Zoom app window, and the unknown-scheme error.
  * If unsuccessful
  ** Screenshot of Chromium opening the raw `mailto:` or an "Open with" chooser.
covers: default/applications/mimeapps.list (mailto), applications/HEY.desktop, applications/Zoom.desktop

### webapp-desktop-entries-launch   [VM-OK] [NET]
description: The seeded web-app launchers (YouTube, Google Maps, Basecamp…) appear in the Apps menu and open as Chromium app windows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space and type `You`.
  ** **YouTube** is listed with its icon. Press Enter.
  ** A Chromium app window (no tabs or address bar) loads youtube.com. Press Super+W.
  * Press Super+Alt+Space, type `Maps`, Enter → Google Maps app window. Press Super+W.
  * Press Super+Alt+Space, type `Basecamp`, Enter → app window on the 37signals launchpad sign-in. Press Super+W.
  * Press Super+Alt+Space, type `zzqx` → no results, no error. Press Escape.
  * The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Pages load slowly through NAT; wait up to 15 s with repeated screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the launcher entry with icon, the YouTube, Maps and Basecamp app windows, and the empty search.
  * If unsuccessful
  ** Screenshot of a full browser (tabs) opening instead of an app window, or a missing launcher.
covers: applications/*.desktop, applications/icons/*, bin/omarchy-launch-webapp

### disk-usage-desktop-entry   [VM-OK]
description: The "Disk Usage" launcher opens the dua disk analyser on / in a floating terminal that closes on `q`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space, type `Disk`, Enter on **Disk Usage**.
  ** A floating, centred terminal runs `dua i /`: top-level directories with sizes; scanning may take 10–30 s.
  * Press Down twice, Enter (descend), then `u` (up).
  * Press `q` → the window closes.
  * The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A tiled (edge-to-edge) window instead of a floating one means the `TUI.float` app-id was not applied; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the floating dua window with sizes, the descended view, and the desktop after `q`.
  * If unsuccessful
  ** Screenshot of a tiled window, "dua: command not found", or a permission error.
covers: applications/Disk Usage.desktop, applications/icons/Disk Usage.png

### imv-omarchy-keybindings   [VM-OK]
description: In imv, Ctrl+R rotates the image on disk, Ctrl+E hands it to Tensaku, and Ctrl+X moves it to the Trash and quits.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/imvt && cp /usr/share/omarchy/default/plymouth/logo.png /tmp/imvt/a.png && cp /tmp/imvt/a.png /tmp/imvt/b.png && identify -format '%wx%h\n' /tmp/imvt/a.png && imv /tmp/imvt/a.png &` Enter.
  ** The dimensions print and imv shows the logo.
  * Press Ctrl+R → the image rotates 90°. In the terminal type `identify -format '%wx%h\n' /tmp/imvt/a.png` Enter → swapped dimensions.
  * Press Ctrl+E in imv → Tensaku opens the image and imv quits. Press Super+W on Tensaku.
  * Type `imv /tmp/imvt/b.png &` Enter, then press Ctrl+X in imv.
  ** imv quits; type `ls /tmp/imvt; gio list trash:// | grep b.png` Enter → `b.png` gone from the folder and present in the Trash.
  * Type `imv /tmp/imvt/missing.png` Enter → an error about the file; press `q` if a window opened.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the imv window before pressing its shortcuts so they are not sent to the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of imv with the image, the swapped dimensions, Tensaku opening, the folder listing plus Trash entry, and the missing-file error.
  * If unsuccessful
  ** Screenshot of a shortcut doing nothing or a file deleted without landing in Trash.
covers: config/imv/config, applications/imv.desktop, default/tensaku/state.toml

### nautilus-transcode-and-localsend-menu   [VM-OK]
description: Right-clicking media in Nautilus offers "Transcode" and "Send via LocalSend"; text files get only LocalSend; Transcode runs in a floating terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/ntx && cp /usr/share/omarchy/default/plymouth/logo.png /tmp/ntx/pic1.png && cp /tmp/ntx/pic1.png /tmp/ntx/pic2.png && echo x > /tmp/ntx/note.txt && nautilus /tmp/ntx &` Enter.
  * Right-click `pic1.png` → the menu includes **Transcode** and **Send via LocalSend**. Press Escape.
  * Right-click `note.txt` → **Send via LocalSend** present, no **Transcode**. Press Escape.
  * Click `pic1.png`, Shift+click `pic2.png`, right-click → **Transcode 2 items** and **Send selected via LocalSend**.
  * Click **Transcode 2 items**.
  ** A floating terminal prints `Transcoding /tmp/ntx/pic1.png` … and waits for a key when done; press Enter. New output files appear in the folder (record names).
  * Right-click `pic1.png` → **Send via LocalSend** → LocalSend opens looking for nearby devices (none). Press Super+W on it.
  * Press Super+W on Nautilus and Ctrl+D on the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If both entries are missing, type `nautilus -q` in the terminal and reopen; extensions load at process start.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each context menu, the transcode terminal, the resulting files, and LocalSend launching.
  * If unsuccessful
  ** Screenshot of a menu without the entries or Nautilus crashing.
covers: default/nautilus-python/extensions/transcode.py, default/nautilus-python/extensions/localsend.py

### xcompose-emoji-sequences   [VM-OK]
description: CapsLock is the compose key: `CapsLock m s` types 😄, `CapsLock space space` an em dash and `CapsLock space n` the user's name, in the terminal and the browser; an undefined sequence inserts no emoji.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl --user is-active omarchy-fcitx5` Enter → `active`.
  * Type `echo "`, press CapsLock, `m`, `s`, then type `"` and Enter.
  ** The line echoes 😄, not `ms`.
  * Repeat with CapsLock `space` `space` → `—`; CapsLock `m` `y` → 👍; CapsLock `m` `1` → 💯.
  * Type `echo "` CapsLock `space` `n` `"` Enter → the installer-provided name (may be empty; record).
  * Type `echo "` CapsLock `m` `z` `"` Enter → no emoji (empty or `mz`).
  * Press Super+Shift+Enter, click the address bar, press CapsLock `m` `h` → ❤️ appears. Press Super+W.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Tap CapsLock, then the letters one by one; no holding.
  * If letters appear instead of emoji, screenshot and also type `pgrep -a fcitx5` Enter for the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each echoed emoji/dash/name line, the undefined-sequence result, and the browser address bar with ❤️.
  * If unsuccessful
  ** Screenshot of plain letters where emoji were expected, plus the fcitx5 process check.
covers: default/xcompose, install/user/xcompose.sh, default/systemd/user/omarchy-fcitx5.service, default/environment.d/10-omarchy-fcitx.conf

### fcitx5-supervised-and-hidden   [VM-OK]
description: fcitx5 runs as a supervised service with no tray icon, comes back if killed, and its config tools, the print applet and the snapper notifier are hidden from the launcher and autostart.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `pgrep -a fcitx5; cat ~/.config/autostart/*.desktop` Enter.
  ** One process with `--disable notificationitem`; three files each `[Desktop Entry]` / `Hidden=true`.
  * Look at the tray in the top bar: no input-method icon, no printer icon.
  * Type `pkill -x fcitx5; sleep 3; pgrep -a fcitx5` Enter → a new PID (restarted).
  * Type `echo "` CapsLock `m` `s` `"` Enter → 😄 still composes.
  * Press Super+Alt+Space, type `fcitx` → no entries; type `btop` → no entry. Press Escape.
  * Type `pgrep -af 'print-applet|limine-snapper-notify' || echo none` Enter → `none`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restart takes ~2 s; screenshot after the sleep completes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the process/autostart output, the tray, the new PID after pkill, a composed emoji, the empty launcher searches, and `none`.
  * If unsuccessful
  ** Screenshot of a tray IM icon, fcitx5 not restarting, or launcher entries for fcitx/btop.
covers: default/systemd/user/omarchy-fcitx5.service, config/autostart/*.desktop, config/fcitx5/conf/*, default/omarchy/launcher.hides, test/shell.d/systemd-test.sh

### user-services-status   [VM-OK]
description: The shipped user units are in the right state on a VM — sleep-lock, fcitx5 and crash-watch running, migrate-notify done with nothing pending, hardware-gated units inert — and nothing has failed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl --user list-units --all 'omarchy-*' 'bt-agent*' --no-pager` Enter.
  ** `omarchy-sleep-lock`, `omarchy-fcitx5`, `omarchy-crash-watch` active/running; `omarchy-migrate-notify`, `omarchy-recover-internal-monitor`, `bt-agent`, `omarchy-tailscale-receive` inactive/dead (conditions); none `failed`.
  * Type `systemctl --user --failed --no-pager` Enter → `0 loaded units listed`.
  * Type `omarchy-migrate --pending` Enter → nothing pending.
  * Type `systemctl --user is-active pipewire wireplumber` Enter → `active` twice.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the table wraps, press Super+F to fullscreen the terminal for the screenshot, then Super+F again.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unit table with the expected states, the empty failed list, no pending migrations, and the active audio units.
  * If unsuccessful
  ** Screenshot of any `failed` unit or a restart loop.
covers: default/systemd/user/*.service, install/user/first-run/enable-user-units.sh, test/shell.d/systemd-test.sh

### crash-watch-notification-and-toggle   [VM-OK]
description: A crashing process produces a "Process crashed" notification with a diagnose action, and the Crash Capture toggle silences it and restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `sleep 300 & sleep 1; kill -SEGV $!` Enter.
  ** Within ~5 s a notification `Process crashed: sleep` appears with an action button.
  * Click the action → a terminal opens running the crash diagnosis; with no default agent it prints a message about choosing one. Close it (Super+W).
  * Press Super+Space → Trigger → Toggle → click **Crash Capture**.
  ** An OSD/notification shows it is off.
  * Repeat the `sleep … kill -SEGV` command → NO notification within 10 s.
  * Toggle **Crash Capture** back on via the same path; repeat the command → the notification returns.
  * Press Super+comma to dismiss it, then Ctrl+D; the desktop is as before with capture on.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notifications fade; screenshot within 2–3 s of the kill.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the crash notification, the diagnosis terminal, the toggle-off OSD with no notification on the second crash, and the notification back after re-enabling.
  * If unsuccessful
  ** Screenshot of no notification while capture is on, or the toggle not taking effect.
covers: default/systemd/user/omarchy-crash-watch.service, bin/omarchy-crash-watch, bin/omarchy-toggle-crash-capture, default/agents/skills/diagnose-crash/SKILL.md

### zram-swap-active   [VM-OK]
description: Compressed zram swap sized to RAM is active with zstd and priority 100, zswap is off, and the reclaim sysctls are tuned for it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `swapon --show; zramctl` Enter.
  ** `/dev/zram0 … ~4G … PRIO 100` and `zstd`.
  * Type `cat /sys/module/zswap/parameters/enabled; sysctl vm.swappiness vm.page-cluster` Enter → `N`, `150`, `0`.
  * Type `free -h | grep -i swap; ls /swapfile 2>&1` Enter → Swap total ≈ RAM; no swapfile.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Sizes show as `3.8G`/`3.9G` for a 4 GB guest.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of swapon/zramctl, the zswap and sysctl values, and free/swapfile.
  * If unsuccessful
  ** Screenshot of no swap device, zswap `Y`, or a wrong priority.
covers: default/systemd/zram-generator.conf.d/90-omarchy.conf, etc/tmpfiles.d/omarchy-zswap.conf, etc/sysctl.d/99-omarchy-sysctl.conf

### oomd-app-slice-candidacy   [VM-OK]
description: systemd-oomd is running with Omarchy's 50 %/20 s policy and only the user's app.slice is a kill candidate, so the compositor is never the victim.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl is-active systemd-oomd; sudo oomctl` Enter (password `prime`).
  ** `active`; `Default Memory Pressure Limit: 50.00%`, `Duration: 20s`; a monitored cgroup path ending in `app.slice`; no `session.slice`.
  * Type `systemctl --user show app.slice session.slice -p ManagedOOMMemoryPressure` Enter → `kill` then `auto`.
  * Type `systemctl --user status session.slice --no-pager | grep -i hyprland` Enter → the compositor lives in session.slice.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Configuration check only; do not try to trigger an OOM kill in the 4 GB guest.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `oomctl` with the values and the app.slice path, the two slice properties, and Hyprland under session.slice.
  * If unsuccessful
  ** Screenshot of oomd inactive, no monitored cgroups, or session.slice marked kill.
covers: etc/systemd/oomd.conf.d/10-omarchy.conf, default/systemd/user/app.slice.d/10-oomd.conf, install/config/enable-services.sh, test/shell.d/systemd-test.sh

### kernel-tuning-and-limits   [VM-OK]
description: Omarchy's kernel and systemd tuning is in effect at runtime: BBR, kyber on the disk, raised inotify and open-file limits, 5 s stop timeouts, USB autosuspend off and the power key ignored.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `sysctl net.ipv4.tcp_congestion_control fs.inotify.max_user_watches; cat /sys/block/vda/queue/scheduler` Enter.
  ** `bbr`, `524288`, `[kyber]`.
  * Type `ulimit -Sn; ulimit -Hn; cat /sys/module/usbcore/parameters/autosuspend` Enter → `65536`, `524288`, `-1`.
  * Type `systemctl show -p DefaultTimeoutStopUSec; systemd-analyze cat-config systemd/logind.conf | grep -E '^(HandlePowerKey|InhibitDelayMaxSec)='` Enter → `5s`, `HandlePowerKey=ignore`, `InhibitDelayMaxSec=15`.
  * Press Ctrl+D; the desktop is as before.
  * Skipped: pressing the physical power key (not injectable from the client).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All proofs are printed lines; one screenshot per command suffices.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three command outputs matching the values.
  * If unsuccessful
  ** Screenshot of `cubic`, `[none]`/`[mq-deadline]` on vda, `1024` open files, or `HandlePowerKey=poweroff`.
covers: etc/sysctl.d/*, etc/udev/rules.d/60-omarchy-io-scheduler.rules, etc/modprobe.d/omarchy-usb-autosuspend.conf, etc/systemd/{system,user}.conf.d/20-omarchy-nofile.conf, etc/systemd/system.conf.d/10-faster-shutdown.conf, etc/systemd/logind.conf.d/*

### timezone-picker-updates-clock   [VM-OK]
description: The bar clock shows weekday and time, toggles to the long date on click, and Update → Timezone changes the zone without a password, confirms with a notification and moves the clock.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `timedatectl show -p Timezone --value; date` Enter; note the zone (ORIGINAL).
  ** The bar clock in the top centre reads like `Friday 13:10` and matches `date` to the minute.
  * Click the clock → it reads like `18 September W38 2026`; click again → back.
  * Press Super+Space → Update → **Timezone**; type `Tokyo` and press Enter on `Asia/Tokyo`.
  ** No password prompt; a notification `Timezone is now set to Asia/Tokyo`; the clock jumps to Tokyo time.
  * Open the picker again and press Escape → the clock stays on Tokyo time.
  * Open the picker, type the ORIGINAL zone and press Enter → notification and clock back to the original time.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker filters fuzzily as you type; the highlighted row is what Enter selects.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the clock in both formats, the picker, the Tokyo notification with the changed clock, the Escape no-op, and the restored clock.
  * If unsuccessful
  ** Screenshot of a password/polkit prompt, a clock that does not update, or a missing notification.
covers: config/omarchy/shell.json (clock), bin/omarchy-menu-timezone, etc/sudoers.d/omarchy-tzupdate, default/omarchy/omarchy-menu.jsonc (update.timezone)

### fast-shutdown-timeouts   [VM-OK] [SLOW]
description: A reboot with a deliberately stuck user process still completes within seconds because Omarchy caps stop timeouts at 5 s.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemd-run --user --unit=stuck-test bash -c 'trap "" TERM; sleep 600'` Enter.
  ** A transient unit that ignores SIGTERM is running.
  * Press Super+Escape and click **Reboot**; screenshot every 3–5 s.
  ** From the "Rebooting" OSD to the boot menu must take well under 60 s (expect 10–25 s). Any "A stop job is running" line shows a 5 s limit, not 1 min 30 s.
  * At the LUKS prompt type `prime` Enter and reach the desktop (log in with `prime` if the greeter shows).
  * Press Super+Enter and type `journalctl -b -1 --no-pager | grep -iE 'stop job|stuck-test' | tail -3` Enter → the stuck unit was killed after ~5 s.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screenshot cadence is the timer: count screenshots between the OSD and the boot menu.
  * `./client get-serial` after the reboot shows the shutdown log with timestamps if the journal line is unclear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot sequence from the OSD to the boot menu proving elapsed time; the LUKS prompt; the journal line showing the 5 s kill.
  * If unsuccessful
  ** Screenshot of a "1min 30s" stop job or a reboot exceeding 60 s, plus the serial log.
covers: etc/systemd/system.conf.d/10-faster-shutdown.conf, etc/systemd/system/user@.service.d/10-faster-shutdown.conf, default/systemd/faster-shutdown.conf, default/systemd/user@.service.d/faster-shutdown.conf

### pacman-channel-and-mirror-config   [VM-OK]
description: pacman points at the Omarchy repository and mirror for the release channel that `omarchy version` reports, with coloured output and the Omarchy hooks installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `grep -E '^(Color|ILoveCandy|ParallelDownloads|Server)' /etc/pacman.conf; grep Server /etc/pacman.d/mirrorlist` Enter.
  ** `Color`, `ILoveCandy`, `ParallelDownloads = 5`, `Server = https://pkgs.omarchy.org/<channel>/$arch`, and one `…mirror.omarchy.org/$repo/os/$arch` line.
  * Type `omarchy version; omarchy-version-channel` Enter → a version and a channel word matching the Server path.
  * Type `pacman -Q omarchy omarchy-settings linux-omarchy; ls /usr/share/libalpm/hooks/ | grep omarchy` Enter → three packages and three `*omarchy*.hook` files.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * stable → `stable-mirror`, rc → `rc-mirror`, edge → `mirror`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the pacman/mirror lines, the version/channel, and the packages plus hook list.
  * If unsuccessful
  ** Screenshot of a channel mismatch or missing hooks.
covers: default/pacman/*, default/libalpm/hooks/*, etc/fastfetch/config.jsonc (channel module)

### pacman-direct-upgrade-guard   [VM-OK] [NET]
description: A direct `sudo pacman -Syu` is stopped by the update guard with a "Woah partner…" message pointing to `omarchy update`, while a plain sync and a single package install are allowed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `sudo pacman -Sy` Enter (password `prime`).
  ** Databases sync with the candy progress bar; no guard message.
  * Type `sudo pacman -Syu; echo rc=$?` Enter.
  ** With upgrades available: `Checking Omarchy update entrypoint...` then the `Woah partner...` block naming `omarchy update` and `OMARCHY_ALLOW_DIRECT_PACMAN=1`, and pacman aborts with a non-zero rc. If it prints "there is nothing to do", record that instead.
  * Type `pacman -Q | wc -l` Enter before and after → the same count (nothing upgraded).
  * Type `sudo pacman -S --needed sl` Enter → installs (or is already present) with no guard message.
  * Press Ctrl+D; the desktop is as before. Do not run `omarchy update` or the override.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The guard text is long; if it scrolls, rerun with `2>&1 | sudo tee /dev/ttyS0` and read `./client get-serial`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the plain sync, the guard block aborting -Syu (or the nothing-to-do note), the unchanged package count, and the allowed single install.
  * If unsuccessful
  ** Screenshot of -Syu upgrading packages without the guard, or the guard blocking a single install.
covers: default/libalpm/hooks/00-omarchy-update-guard.hook, bin/omarchy-update-pacman-guard, default/pacman/*.conf

### fontconfig-defaults   [VM-OK]
description: Generic font families resolve to Omarchy's choices (JetBrainsMono for monospace, Liberation for sans/serif/system-ui, Noto Naskh for Arabic) with emoji fallback, and the Omarchy icon glyphs render.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `for f in monospace sans-serif serif system-ui; do fc-match $f; done; fc-match :lang=ar` Enter.
  ** `JetBrainsMono Nerd Font`, `Liberation Sans`, `Liberation Serif`, `Liberation Sans`, `Noto Naskh Arabic`.
  * Type `printf '\ue900 \ue902 \ue90e 😄 مرحبا שלום\n'` Enter.
  ** Three icon glyphs (not boxes), a coloured emoji, legible Arabic and Hebrew.
  * Press Super+Shift+Enter and open `data:text/html,<p style="font-family:system-ui">system-ui Sans</p><p style="font-family:monospace">monospace 0O1l</p><p>😄 مرحبا</p>`.
  ** First line in a sans face, second in a monospace face, coloured emoji, legible Arabic. Press Super+W.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Boxes with hex digits in the terminal line mean a missing font; report which glyph.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the fc-match lines, the terminal glyph line, and the Chromium rendering.
  * If unsuccessful
  ** Screenshot of DejaVu/Noto Sans picked for monospace/sans, boxes for the icon glyphs, or Nastaliq for plain Arabic.
covers: default/fontconfig/conf.avail/50-omarchy.conf, default/fonts/omarchy/*, docs/file-layout.md

### screensaver-foot-config   [VM-OK]
description: System → Screensaver fills the screen with the terminal screensaver (black, large font, no padding), any key returns to the desktop, and a second launch does not start a duplicate.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and click **Screensaver**.
  ** The whole screen turns black and animated ASCII Omarchy text plays edge to edge in a large font.
  * Wait 5 s (screenshot), press Space → the desktop returns as before.
  * Press Super+Enter and type `omarchy-launch-screensaver force & sleep 3; omarchy-launch-screensaver force; echo rc=$?` Enter.
  ** The screensaver appears once; the second call exits (already running). Press Space to dismiss; `rc=0` shows in the terminal.
  * Press Super+Space → Trigger → Toggle → **Screensaver** (off); type `omarchy-launch-screensaver; echo rc=$?` Enter → exits without showing. Toggle it back on via the same path.
  * Press Ctrl+D; the desktop is as before with the screensaver enabled.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Any key dismisses; Space is safe because it types nothing lasting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the running screensaver (black, large text, no padding), the restored desktop, the no-duplicate `rc=0`, and the toggled-off no-show.
  * If unsuccessful
  ** Screenshot of a padded/small-font/themed-background window or one that does not close.
covers: default/foot/screensaver.ini, default/alacritty/screensaver.toml, default/ghostty/screensaver, bin/omarchy-launch-screensaver, default/omarchy/omarchy-menu.jsonc (system.screensaver, trigger.toggle.screensaver)

### btop-omarchy-config   [VM-OK]
description: btop starts with Omarchy's config (theme following the desktop, vim keys, four rounded boxes) and is reached from the terminal, not the launcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `btop` Enter.
  ** Four boxes (cpu, mem, net, proc) with rounded corners and braille graphs in the desktop theme's colours; a clock at the top.
  * Press `j` twice then `k` → the process selection moves down/up.
  * Press `q` → btop exits. Type `grep '^color_theme' ~/.config/btop/btop.conf` Enter → `"current"` (kept after the save-on-exit).
  * Press Super+Alt+Space, type `btop` → no launcher entry. Press Escape.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Default btop colours (blue/white) instead of the desktop theme mean the `current` theme is missing; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of btop with theme colours and four boxes, the moved selection, the `color_theme` line, and the empty launcher search.
  * If unsuccessful
  ** Screenshot of default-coloured btop, `j`/`k` not moving, or a launcher entry.
covers: config/btop/btop.conf, default/omarchy/launcher.hides

### lazygit-launch   [VM-OK]
description: lazygit starts with defaults inside a repository, shows its keybinding help, and declines to create a repo when started outside one.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/lg && cd /tmp/lg && git init -q && echo a > a && lazygit` Enter.
  ** The TUI opens with Status / Files (`a` untracked) / Branches / Commits / Stash panels.
  * Press `?` → the keybindings panel; press Escape, then `q`.
  * Type `mkdir /tmp/nogit && cd /tmp/nogit && lazygit` Enter.
  ** A prompt asks whether to create a repository; press `n` (or Escape). Type `ls -a` Enter → no `.git`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Omarchy lazygit config is intentionally empty; any config error on start is a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the TUI in the repo, the help panel, the no-repo prompt declined, and the `ls -a` without `.git`.
  * If unsuccessful
  ** Screenshot of a config parse error or a crash on start.
covers: config/lazygit/config.yml

### plocate-updatedb-config   [VM-OK]
description: The locate index keeps Btrfs subvolumes searchable and excludes snapshots, so `plocate` finds system files but never `/.snapshots` paths.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl cat plocate-updatedb.service --no-pager | grep -E 'ExecStart=/|ConditionACPower'` Enter.
  ** `ExecStart=/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` and `ConditionACPower=true`.
  * Type `sudo systemctl start plocate-updatedb.service` Enter (password `prime`); wait until `systemctl is-active plocate-updatedb.service` prints `inactive`.
  * Type `plocate omarchy.ttf; echo "snap-hits=$(plocate -c /.snapshots/)"` Enter.
  ** `/usr/share/fonts/omarchy/omarchy.ttf` and `snap-hits=0`.
  * Type `plocate no-such-file-zz-123; echo rc=$?` Enter → no output, `rc=1`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The index run takes a few seconds; poll `is-active` with screenshots rather than a long sleep.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the effective unit lines, the found font path with zero snapshot hits, and the rc=1 miss.
  * If unsuccessful
  ** Screenshot of the stock ExecStart or snapshot paths in results.
covers: default/systemd/system/plocate-updatedb.service.d/10-omarchy.conf, etc/systemd/system/plocate-updatedb.service.d/ac-only.conf, docs/file-layout.md

### resolved-and-nsswitch-defaults   [VM-OK]
description: Names resolve through systemd-resolved with LLMNR and mDNS off, and a `.local` miss returns quickly through mdns_minimal instead of hanging.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl is-active systemd-resolved NetworkManager; resolvectl status | grep -E 'Protocols|DNS Servers' | head -3` Enter.
  ** Both `active`; Protocols show `-LLMNR -mDNS`; a DNS server (10.0.2.3).
  * Type `resolvectl query omarchy.org; getent hosts $(hostname)` Enter → an address for each.
  * Type `grep '^hosts:' /etc/nsswitch.conf` Enter → `hosts: mymachines mdns_minimal [NOTFOUND=return] resolve files myhostname dns`.
  * Type `time getent hosts nonexistent.local; echo rc=$?` Enter → no output, `rc=2`, real time under 1 s.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All proofs are printed lines; one screenshot per command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the protocol flags, the two successful lookups, the nsswitch line, and the fast `.local` miss with its time.
  * If unsuccessful
  ** Screenshot of `+mDNS`/`+LLMNR`, a lookup failing, or the `.local` query taking seconds.
covers: etc/systemd/resolved.conf.d/*, etc/nsswitch.conf, install/config/enable-services.sh

### agent-skill-commands-work   [VM-OK]
description: The Omarchy and diagnose-crash skills are linked into the agents' skill directories and the commands they document work without prompts — including `omarchy debug --no-sudo --print` and a reminder that fires as a notification.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `ls -l ~/.claude/skills ~/.codex/skills ~/.agents/skills 2>&1` Enter.
  ** Each existing directory shows `omarchy ->` and `diagnose-crash ->` symlinks into `/usr/share/omarchy/default/agents/skills/` (missing directories on 4.0.2 are recorded).
  * Type `head -3 ~/.claude/skills/omarchy/SKILL.md; omarchy commands | head -5` Enter → `name: omarchy` front matter and a command list.
  * Type `for c in omarchy-theme-set omarchy-refresh-shell omarchy-toggle-nightlight omarchy-reminder omarchy-capture-screenshot omarchy-crash-mute omarchy-debug; do command -v $c >/dev/null && echo ok $c || echo MISSING $c; done` Enter → all `ok`.
  * Type `sudo -k; omarchy debug --no-sudo --print | tail -5; ls -la /tmp/omarchy-debug.log` Enter.
  ** Report lines print with NO password prompt; the log file exists.
  * Type `omarchy reminder 1 "Skill test"` Enter; wait ~60 s screenshotting every 5 s → a notification "Skill test" appears. Type `omarchy reminder clear` Enter.
  * Type `omarchy debug --bogus-flag; echo rc=$?` Enter → usage/error and a non-zero rc.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Any MISSING entry names a command the skill documents but 4.0.2 lacks; report it rather than fail everything.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the symlink listings, the SKILL head and command list, the ok table, the debug tail with the log file and no prompt, the reminder notification, and the bogus-flag error.
  * If unsuccessful
  ** Screenshot of broken symlinks, MISSING commands, a sudo prompt during `--no-sudo`, or no reminder notification.
covers: default/agents/skills/omarchy/*.md, default/agents/skills/diagnose-crash/*.md, docs/file-layout.md (skill symlinks), test/shell.d/default-agent-test.sh

### terminal-alternatives-kitty-config   [VM-OK] [NET] [SLOW]
description: Installing kitty through Omarchy gives a terminal that inherits the system defaults (same font, padding and theme as foot, socket-only remote control) and can be made and unmade the default.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Terminal → **Kitty**; wait for the install (~30 MB), answering Yes if asked to make it default.
  * Press Super+Enter.
  ** If kitty became default it opens: same font size, padding and theme colours as foot, powerline tab bar at the bottom. Otherwise type `kitty &` Enter in foot.
  * In kitty type `kitty @ ls | head -3` Enter → JSON output (socket remote control works).
  * Type `printf '\eP@kitty-cmd{"cmd":"ls"}\e\\'` Enter → no response (remote control via terminal output is rejected).
  * Press Super+Space → Setup → Defaults → Terminal → **Foot**; press Super+Enter → foot opens again.
  * Close all terminals (Ctrl+D); the desktop is as before with foot as default.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the install exceeds the session budget, report progress and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install finishing, kitty looking like foot, the `kitty @ ls` output, the ignored escape sequence, and foot opening after the default is restored.
  * If unsuccessful
  ** Screenshot of a decorated/unpadded kitty, socket control refused, or the default not switching back.
covers: etc/xdg/kitty/kitty.conf, config/kitty/kitty.conf, config/alacritty/alacritty.toml, config/ghostty/config, docs/file-layout.md (Kitty defaults), test/shell.d/kitty-config-test.sh

### gpg-keyserver-defaults   [VM-OK] [NET]
description: GnuPG is preconfigured with hkps keyservers and a short timeout so a key fetch works out of the box and a bad server fails fast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `cat ~/.gnupg/dirmngr.conf` Enter.
  ** Five `keyserver hkps://…` lines and `connect-quick-timeout 4`.
  * Type `gpg --recv-keys 4AEE18F83AFDEB23 2>&1 | tail -2` Enter (GitHub's web-flow key) → `imported` or `not changed`.
  * Type `gpg --keyserver hkps://127.0.0.1:1 --recv-keys 4AEE18F83AFDEB23 2>&1 | tail -1` Enter → a connection error within a few seconds.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first fetch may take ~10 s through NAT; keep screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the config, the successful import, and the fast failure.
  * If unsuccessful
  ** Screenshot of a hang beyond 30 s or a missing config.
covers: default/gpg/dirmngr.conf, etc/gnupg/dirmngr.conf

### hardware-only-units-inert   [VM-PARTIAL]
description: Hardware-specific defaults (Cam Link relay, Bluetooth agent, Taildrop, speaker tuning, WirePlumber rules) stay inert on a machine without that hardware and never show up as failures.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl list-units --all 'v4l2-relayd*' 'camlink*' --no-pager; ls /dev/camlink4k` Enter.
  ** No such units loaded (or inactive) and `No such file`.
  * Type `systemctl --user status bt-agent omarchy-tailscale-receive --no-pager 2>&1 | grep -E 'Active|Condition'; bluetoothctl show 2>&1 | head -1` Enter.
  ** Both inactive with a condition note (none `failed`); `No default controller available`.
  * Type `wpctl status | head -12; journalctl -b -p err --no-pager | grep -icE 'wireplumber|pipewire|bt-agent'` Enter → an audio graph with no real sink and `0` errors.
  * Press Ctrl+D; the desktop is as before.
  * Skipped: the hardware paths themselves (no camera, adapter, XPS speakers or tailscale).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "inactive (dead)" with a Condition line is the expected shape; only `failed` counts against it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unit listings without failures, the missing device/controller lines, and the clean audio status with `0` errors.
  * If unsuccessful
  ** Screenshot of any `failed` unit or a restart loop.
covers: default/udev/*, default/systemd/system/camlink-4k-loopback.service, default/systemd/system/v4l2-relayd@camlink.service.d/camlink.conf, default/v4l2-relayd/camlink.conf, default/systemd/user/{bt-agent,omarchy-tailscale-receive,omarchy-speaker-tuning}.service, default/audio/**, default/wireplumber/**, config/wireplumber/**

### suspend-locks-session   [VM-NO]
description: Before suspend the sleep-lock monitor locks the session and FUSE mounts are unmounted; after resume gvfs restarts. Not runnable: the driver cannot wake a suspended guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Record only.) Press Super+Enter and type `systemctl --user is-active omarchy-sleep-lock; systemd-inhibit --list --no-pager | grep -i sleep` Enter → `active` and a delay inhibitor held by the sleep monitor.
  * Do NOT run `systemctl suspend`: the guest would freeze with no wake path.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry; run only the record-only step if at all.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the active unit and the inhibitor line.
  * If unsuccessful
  ** N/A — appendix only.
covers: default/systemd/user/omarchy-sleep-lock.service, default/systemd/system-sleep/unmount-fuse, default/systemd/system-sleep/force-igpu, default/systemd/system-sleep/keyboard-backlight, etc/systemd/logind.conf.d/20-inhibit-delay.conf

## Gaps

- **Suspend / hibernate / resume paths** (`omarchy-sleep-lock`, `unmount-fuse`, `force-igpu`, `keyboard-backlight`, `InhibitDelayMaxSec`): no way to wake a suspended guest; no dGPU/backlight/lid. Recorded in `suspend-locks-session` [VM-NO].
- **Power button** (`HandlePowerKey=ignore`): the client cannot inject an ACPI power key; only the printed config value is checked (inside `kernel-tuning-and-limits`).
- **Bluetooth pairing auto-accept, Taildrop, speaker tuning, Cam Link relay, Framework 16 hidraw, KEF/Bluetooth WirePlumber rules**: hardware absent; only inertness is testable (`hardware-only-units-inert`).
- **Wi-Fi power-save, USB autosuspend on real devices, kyber latency behaviour**: no such devices; value checks only.
- **Limine/snapper/mkinitcpio drop-in contents** (`omarchy-defaults.conf`, `omarchy-uki.conf`, `/etc/default/limine`, hook list): pure config reads with no user-visible behaviour beyond what `boot-menu-*` and `plymouth-luks-*` already show; left to `test/shell.d/limine-defaults-test.sh` and `nvidia-kms-hook-test.sh`.
- **WhatsApp Slim chat-list collapse**: needs a logged-in WhatsApp Web session (phone QR). Only the theme flag and structural load are checked.
- **`omarchy-theme-set-browser-policy` sudoers rule**: exercised by theme switching (theme reviewer); negative paths are covered by `test/shell.d/browser-policy-sudoers-test.sh`.
- **Sudoless Docker positive path** (group added, reboot, `docker ps` without sudo, Remove, reboot): two reboots ≈ 4–6 min; `sudoless-docker-menu-decline` covers the menu and negative path.
- **`omarchy-settings` upgrade hooks** (`10-/90-omarchy-hyprland-reload-*`) and the etc-overrides clobber on upgrade: need a real package upgrade (network, possibly >10 min).
- **Plymouth three-failure emergency shell, booting a Limine snapshot**: destructive to the minted disk.
- **Firefox/alacritty/ghostty**: not installed by default; Firefox has a NET/SLOW test, kitty stands in for the terminal template; alacritty/ghostty would need their own installs.
- **`c`, `cx`, `cy`, `ic`, `ix`, `icx`, `mup`, `r` aliases**: launch opencode/claude/codex/rails/mise upgrades that download tools and need accounts; only `a` is tested.
- **`try()` lazy wrapper**: low value; would create `~/Work/tries` and open a picker.
- **`iso2sd` / `format-drive` happy paths**: destructive; no spare block device.
- **`rsw` over SSH, `fip` to a real host, ssh reconnect loop after a ≥30 s session**: no reachable SSH server (sshd disabled, inbound blocked).
- **`hdlm` / `tdlm` per-subdirectory layouts**: only usage/refusal tested; could be added with `bash` as the "AI" if budget allows.
- **Migration notifier with pending migrations**: fresh installs have none; faking state would run a migration.
- **Network/Bluetooth panels that call the DNS sudoers rule from the bar**: panel behaviour belongs to the shell reviewer; the menu submenu click is included in `dns-preset-switch-without-password`.
- **Zoom meeting join**: needs a live meeting; only URL routing is checked.
- **Non-default locales / non-Latin vconsole keeping Plymouth Latin**: would require reinstalling; covered by maintainer shell tests only.
