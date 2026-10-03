# 20 — CLI router and utility commands (`bin/omarchy`, version/state/debug, dev-*, snapshot, reminder, screensaver, …)

Source: `/tmp/omarchy-review/omarchy` @ `d174d4a` (2026-09-18, "Add omarchy up alias").

## Scope

Read completely, every line:

| file | lines | notes |
|---|---|---|
| `bin/omarchy` | 1093 | router: `GROUP_DESCRIPTIONS`, metadata scan, fast/slow dispatch, help, `commands` introspection |
| `docs/cli-router.md` | 130 | resolution/dispatch/introspection semantics |
| `agents/skills/command-metadata.md` | 32 | `# omarchy:` metadata keys |
| `bin/omarchy-version`, `-version-branch`, `-version-channel`, `-version-pkgs` | 28/18/29/5 | |
| `bin/omarchy-state`, `omarchy-done` | 39/40 | hidden state/marker plumbing |
| `bin/omarchy-debug`, `omarchy-debug-idle` | 96/64 | `debug-idle` is not in the task list by name but matches `omarchy-debug*`; included |
| `bin/omarchy-hook`, `omarchy-hook-install` | 40/42 | |
| `bin/omarchy-ascii` | 1217 | ~1100 lines are the embedded FIGlet font |
| `bin/omarchy-transcode`, `omarchy-transcode-ascii` | 207/238 | |
| `bin/omarchy-show-done`, `omarchy-show-logo` | 25/9 | |
| `bin/omarchy-upload-log` | 165 | hidden |
| `bin/omarchy-file-select` | 124 | Python, portal FileChooser |
| `bin/omarchy-git-url-check` | 50 | hidden |
| `bin/omarchy-disk-speedtest` | 232 | |
| `bin/omarchy-display-text-size` | 236 | |
| `bin/omarchy-monitor-state` | 23 | |
| `bin/omarchy-cmd-missing`, `-cmd-present`, `-cmd-terminal-cwd` | 11/9/27 | |
| `bin/omarchy-default-agent`, `-browser`, `-editor`, `-terminal` | 101/51/59/51 | |
| `bin/omarchy-channel-current`, `omarchy-channel-set` | 30/103 | |
| `bin/omarchy-reinstall`, `-reinstall-configs`, `-reinstall-pkgs` | 15/28/18 | |
| `bin/omarchy-installed-service-dropbox`, `-tailscale` | 12/12 | hidden |
| `bin/omarchy-upgrade-to-quattro` | 2410 | header, arg parsing, banner/confirm, exit/cleanup messages and the final reboot prompt read in full (lines 1–380, 2340–2410); the ~2000 lines of upgrade steps skimmed via grep for `fail`/`warn`/`gum` only, as instructed |
| `bin/omarchy-migrate`, `omarchy-migrate-notify` | 102/60 | |
| `bin/omarchy-sudo-docker`, `-sudo-keepalive`, `-sudo-passwordless` | 44/9/71 | |
| `bin/omarchy-dev-*` (11) | add-migration 41, benchmark-cli 111, benchmark-theme-switcher 160, font 652, install-ydoo 50, link 123, pkg-test 137, status 64, theme-preview 439, ui-preview 20, unlink 64 | |
| `bin/omarchy-tui-install`, `-tui-remove`, `-tui-remove-all` | 98/41/37 | |
| `bin/omarchy-snapshot` | 49 | |
| `bin/omarchy-reminder` | 201 | |
| `bin/omarchy-screensaver` | 48 | |
| `bin/omarchy-mise-install` | 59 | |
| `bin/omarchy-openclaw-onboard` | 130 | there is no `bin/omarchy-openclaw`; this is the only `openclaw` group binary and is what the task's `omarchy-openclaw` must mean |

Cross-referenced (grep only, for user paths): `default/omarchy/omarchy-menu.jsonc`, `default/hypr/bindings/*.lua`, `default/hypr/autostart.lua`,
`default/systemd/user/omarchy-migrate-notify.service`, `default/xdg-terminal-exec/hyprland-xdg-terminals.list`, `install/omarchy-base.packages`,
`install/omarchy-other.packages`, `test/cli`, `manual/30-updates.md`, `manual/45-troubleshooting.md`, `manual/47-system-snapshots.md`,
`shell/plugins/services/idle/Service.qml` (idle timeouts), `bin/omarchy-launch-screensaver`, `bin/omarchy-toggle-screensaver`,
`bin/omarchy-launch-floating-terminal-with-presentation`, `bin/omarchy-launch-terminal`, `bin/omarchy-update` (header only, for the `up` alias).

Not reviewed: every other `bin/omarchy-*` (other reviewers), the shell QML, the upgrade step bodies in `omarchy-upgrade-to-quattro`.

## Inventory

Format: `route / binary` — what it does — flags — metadata (`hidden`, `group`/`name` overrides, `requires-sudo`) — needs terminal/sudo — user path. "typed" = typed in a terminal opened with `Super+Enter`.

**Router (`bin/omarchy`)**

- `omarchy` (no args) — prints main help: "Omarchy command center", Usage, Common commands, the sorted `GROUP_DESCRIPTIONS` table (69 groups), Discovery. Exit 0. (`bin/omarchy:518-547,1073-1077`) — typed.
- `omarchy --help` / `omarchy -h` — same main help. **`omarchy help` is NOT a route**: it falls through to "Unknown Omarchy command: omarchy help", exit 127 (`bin/omarchy:1079-1090,1064-1070`). — typed.
- `omarchy commands [--all] [--json] [--markdown] [--check] [--help|-h]` — lists non-hidden commands as `usage<TAB>summary` table plus an "Aliases:" table; `--all` adds `hidden=true` commands; `--json` emits `{ok:true, commands:[{route,binary,group,name,summary,requires_sudo,hidden,args,examples,aliases,filename_route,routes}]}`; `--markdown` emits a `| Command | Binary | Summary |` table; `--check` lints (route collisions, missing `summary=`, invalid booleans, missing binary) → "Command metadata check passed (N commands)" or failures on stderr, exit 1; unknown option → "Unknown option for omarchy commands: X" + help on stderr, exit 2 (`bin/omarchy:549-784`). — typed.
- `omarchy <group>` (bare group with children, no root binary or root binary needing args) — group help "`<Group> commands — <description>:`" (or "`<Group> commands:`" when the group has no `GROUP_DESCRIPTIONS` entry) with one row per non-hidden command; "No documented commands found. Try: omarchy commands --all" if all hidden (`bin/omarchy:799-822,995-999,1050-1053`). — typed.
- `omarchy <group> --help|-h` — same group help (`bin/omarchy:1002-1006,1055-1058`). — typed.
- `omarchy <route> --help|-h` (flag anywhere before a `--`) — command help: Usage, summary, Arguments, Examples, Aliases, Binary, Filename route (when different), Related commands (for a group-root binary; hidden siblings excluded). Never executes the binary (`bin/omarchy:863-909,959-976,1023-1030`). — typed.
- `omarchy <route> --help --json` — the command's JSON record `{ok:true, command:{…}}` (`bin/omarchy:736-738`). — typed.
- `omarchy <route> [args…]` — longest-prefix resolution; fast path probes `bin/omarchy-<a>-<b>-…` files, slow path loads metadata routes (needed for `group=`/`name=` moves and aliases); `exec`s the binary with leftover args (`bin/omarchy:389-412,911-932,993,1047`). — typed.
- Required-args guard: a bare route whose `args=` has anything outside `[...]` shows help instead of running (e.g. `omarchy snapshot`, `omarchy reminder`, `omarchy state`, `omarchy channel set`, `omarchy dev link`, `omarchy hook install`, `omarchy mise install`, `omarchy upload log`, `omarchy transcode ascii`) (`bin/omarchy:361-372,978-991,1038-1045`).
- `--` — ends the help scan; everything after it is forwarded (`omarchy ascii -- --help` renders the word "help") (`bin/omarchy:129-138`).
- Prefix listing: unresolved words that prefix known usages print "`<prefix> commands:`" (e.g. `omarchy dev benchmark`, `omarchy hw asus`) (`bin/omarchy:824-841,1060-1062`).
- Unknown route → stderr "Unknown Omarchy command: omarchy …", optional "Did you mean: omarchy <first word of a route extending the first arg> ?", "Run 'omarchy commands --all' to discover available commands.", exit 127 (`bin/omarchy:1064-1070`). Missing/non-executable binary → "Binary is missing or not executable: X", exit 127.
- Aliases registered at HEAD (`# omarchy:alias`/`aliases`): `omarchy up`→`omarchy-update` (**new in HEAD commit d174d4a**), `omarchy background`→`theme-bg-switcher`, `omarchy shutdown|reboot|logout`→`system-*`, `omarchy plugin rm`→`plugin-remove`, `omarchy plugin install`→`plugin-add`, `omarchy screenshot`→`capture-screenshot`, `omarchy screenrecord`→`capture-screenrecording`, `omarchy dev benchmark theme-switcher`→`dev-benchmark-theme-switcher`.
- Groups that route but are **absent from the top-level listing** because they have no `GROUP_DESCRIPTIONS` entry: `show` (`show done`, `show logo`, both non-hidden), `upgrade` (`upgrade to quattro`, non-hidden), plus the intentionally hidden `apply`, `provision`, `upload`, `state`, `done`, `git`.
- Metadata scheme (`agents/skills/command-metadata.md`, `bin/omarchy:169-313`): first 80 lines, comment header only; keys `group`, `name` (empty `name=` makes the binary the group root), `summary`, `args`, `examples` (`|`-separated), `alias|aliases`, `hidden=true`, `requires-sudo=true`; unknown keys ignored; first plain comment is a fallback summary; `--check` demands explicit `summary=`.

**Scripts (60 binaries)**

- `omarchy version` / `omarchy-version` — prints package version (`pacman -Q omarchy-dev` or `omarchy`, e.g. `4.0.2-1`); on a dev-linked checkout prints `dev (<sha>)`; exit 1 with no output if no package — no flags — summary only — typed; also used as the snapshot description.
- `omarchy version branch` / `omarchy-version-branch` — dev-link git branch or `detached@<sha>`; exit 1 silently on a packaged install — **hidden** — typed.
- `omarchy version channel` / `omarchy-version-channel` — `stable|rc|edge|unknown` from `/etc/pacman.d/mirrorlist` and `/etc/pacman.conf`; prints `mirror / pkgs` when they differ — typed.
- `omarchy version pkgs` / `omarchy-version-pkgs` — date of the last `upgraded` line in `/var/log/pacman.log` formatted "Friday, September 18 2026 at 14:03"; with no such line `date -d ""` prints **today at 00:00** (misleading) — typed.
- `omarchy state <set|clear> <name-or-pattern>` / `omarchy-state` — touch/delete `~/.local/state/omarchy/<name>`; `set` refuses `/`, `.`, `..` ("Invalid state name", exit 2); missing args → usage, exit 1 — **hidden** — typed (plumbing used by channel-set, toggles).
- `omarchy done <check|mark|ensure> <name>` / `omarchy-done` — markers in `~/.local/state/omarchy/done/`; wrong arity or verb → usage on stderr, exit 1; bad name → "Invalid done marker name", exit 1 — **hidden** — typed.
- `omarchy debug [--no-sudo] [--print]` / `omarchy-debug` — writes `/tmp/omarchy-debug.log` (date, hostname, package, `inxi -Farz`, `sudo dmesg`, `journalctl -b -p 4..1`, package list); `--print` cats it; otherwise `gum choose` "Upload log" (only if `ping 8.8.8.8` works) / "View log" (less) / "Save in current directory" (→ `./omarchy-debug.log`); unknown option → "Unknown option: X" + usage, exit 1 — `requires-sudo` — terminal — typed (`manual/45-troubleshooting.md`).
- `omarchy debug idle [log-lines]` / `omarchy-debug-idle` — sections Time, Idle IPC status, Quickshell instances, Recent idle logs, Persisted shell log, Relevant processes, Sleep lock service, Hyprland screensaver clients, Idle inhibitors, Screensaver detector (`running-window|running-process|disabled|stopped`), Lock detector; non-numeric arg silently → 200 — `group=debug` — typed.
- `omarchy hook [name] [args…]` / `omarchy-hook` — runs `~/.config/omarchy/hooks/<name>` and `<name>.d/*` (skips `*.sample`), prints "Hook failed: <path>" on non-zero; no name → usage, exit 1 (metadata marks name optional, script does not); `/`, `.`, `..` → "Invalid hook name", exit 2 — typed; fired by `autostart.lua` (`post-boot`), `omarchy-update` (`post-update`), `omarchy-theme-set` (`theme-set`), `omarchy-font-set` (`font-set`).
- `omarchy hook install <type> <file>` / `omarchy-hook-install` — copies file to `~/.config/omarchy/hooks/<type>.d/<basename>` chmod 755, prints "Installed <type> hook: <path>"; missing file → "Hook file not found: X", exit 1; arity ≠ 2 → usage, exit 1 — `group=hook name=install` — typed.
- `omarchy ascii [text…]` / `omarchy-ascii` — renders text in the Delta Corps Priest 1 block font (letters and spaces only); reads stdin when no args and not a tty; `--help`; `--` passthrough; unknown `-x` → "Unknown option" + usage, exit 1; no drawable chars → "Delta Corps Priest 1 draws letters and spaces only, and that text has neither.", exit 1; skipped chars listed on stderr "Skipped, no glyph in Delta Corps Priest 1: …" — typed.
- `omarchy transcode [--path p] [input] [format] [resolution]` / `omarchy-transcode` — pictures → jpg/png at high/medium/low, videos → mp4/gif at 4k/1080p/720p, output `<stem>-<res>.<fmt>` beside input, copied to clipboard as URI, notification "Transcoded to <res> <fmt>" / "Saved and copied to clipboard."; no input → `omarchy-menu-file` picker over `~/Pictures:~/Videos`, then `omarchy-menu-select` for format/resolution; "File not found", "Unsupported file type", "Invalid picture format/resolution", "Missing value for --path", "Unknown option" (exit 2) — `group=transcode name=` (group root) — hotkey **Super+Ctrl+Period**, menu **Trigger → Transcode**, Nautilus context menu, typed.
- `omarchy transcode ascii <in.svg|png> <out> [-w N] [-H N] [-m braille|block] [-t %] [--invert] [--no-trim]` / `omarchy-transcode-ascii` — image → braille/block text, "Wrote ASCII art to <out>"; missing args → usage, exit 1; "Invalid mode", "Logo file not found", "Unable to read/convert logo image", "No logo pixels found" — typed; used by branding scripts.
- `omarchy show done [exit-code]` / `omarchy-show-done` — prints green "● Done! Press any key to close..." or red "● Failed (exit code N)! Press any key to close..." to `/dev/tty`, waits one key; exits 0 silently without a tty — terminal — typed; appended to every floating presentation terminal (`omarchy-launch-floating-terminal-with-presentation`).
- `omarchy show logo` / `omarchy-show-logo` — clears and prints `$OMARCHY_PATH/logo.txt` in green — terminal — typed; first line of every presentation terminal.
- `omarchy upload log <install|this-boot|last-boot|installed|system-info>` / `omarchy-upload-log` — gathers fastfetch/system info + chosen log, `curl -F file=@… https://logs.omarchy.org/`, prints "✓ Log uploaded successfully!" and URL; unknown type → usage, exit 1; failure → "Error: Failed to upload log file", exit 1 — **hidden**, NET — typed.
- `omarchy file select [--title T] [--multiple] [--directory] [--extensions "png svg"]` / `omarchy-file-select` — portal FileChooser dialog; prints chosen path(s); nothing picked → exit 1; unknown option → "omarchy-file-select: unknown option X", exit 2; 600 s timeout — typed; used by share/branding flows.
- `omarchy git url check <url>` / `omarchy-git-url-check` — exit 0 for ssh/git/http(s)/ftp(s)/file URLs, scp-style and paths; refuses `-…`/`helper::…` ("names a git option or transport helper, not a repository.") and unknown schemes ("names the 'X' transport, which Omarchy does not clone from."), exit 1; empty → "a git URL is required" — **hidden** — typed; used by theme/plugin installers.
- `omarchy disk speedtest [target-dir]` / `omarchy-disk-speedtest` — 4×256 MB direct-I/O files under `~/.cache/omarchy`, prints `disk <model|dev>` then one `read N` per second for 8 s, then `write N` lines, final steady-state line each; non-dir arg → usage, exit 2; "Need at least 2048MB free", "Cannot find a disk behind", "Direct disk I/O is not available", "Disk read test failed before finishing" — typed; menu **Trigger → Speed Test → Disk Speed Test** (shell dials panel runs the same binary).
- `omarchy display text size [size|reset]` / `omarchy-display-text-size` — no arg prints "text size: N px / gtk text-scaling-factor: F / terminal font: P pt"; `9..20` sets `[font] base-size` in `~/.config/omarchy/shell.toml`, GTK `text-scaling-factor`, terminal font size (alacritty/kitty/ghostty/foot configs; foot users get notification "Restart Foot to apply the new terminal font size"); `reset|default`; out of range → "Size must be an integer between 9 and 20 (px)." + usage, exit 1 — typed.
- `omarchy monitor state` / `omarchy-monitor-state` — 7 lines for the shell monitor panel: brightness, internal name, external name, enabled internal, mirror source, focused, scaling, then a JSON array of monitors — `group=monitor` — typed (shell panel consumer).
- `omarchy cmd missing <cmds…>` / `omarchy-cmd-missing` — exit 0 if any command is missing, else 1 — typed/plumbing.
- `omarchy cmd present <cmds…>` / `omarchy-cmd-present` — exit 0 if all present — typed/plumbing.
- `omarchy cmd terminal cwd` / `omarchy-cmd-terminal-cwd` — cwd of the focused terminal's shell (kitty socket or `/proc/<child>/cwd`), falls back to `$HOME` — **hidden** — used by `omarchy-launch-terminal` so **Super+Enter** opens the new terminal in the active terminal's directory.
- `omarchy default agent [pi|omp|opencode|ori|claude|codex|grok|openclaw|agy|hermes|copilot|crush|cursor-agent|muse]` / `omarchy-default-agent` — no arg prints current (nothing when unset); sets `~/.config/omarchy/defaults/agent`, installs via mise in a floating terminal if missing, then `exec omarchy-agent`; unknown → usage, exit 1; `--install` internal flag — menu **Setup → Defaults → Agent** (✓ on current), typed.
- `omarchy default browser [chromium|chrome|brave|brave-origin|edge|firefox|zen]` / `omarchy-default-browser` — prints current via `xdg-settings` (fresh install: `chromium`); sets XDG default + notification "<Name> is now the default browser"; installs if missing (floating terminal); unknown → usage, exit 1 — menu **Setup → Defaults → Browser**, typed.
- `omarchy default editor [code|cursor|zed|sublime_text|helix|vim|emacs|nvim]` / `omarchy-default-editor` — prints `~/.local/state/omarchy/defaults/editor` or `nvim`; sets it + notification "<Name> is now the default editor"; installs if missing — menu **Setup → Defaults → Editor**, typed.
- `omarchy default terminal [alacritty|foot|ghostty|kitty]` / `omarchy-default-terminal` — prints current from `xdg-terminal-exec --print-id` (stock: `foot`); writes `~/.config/xdg-terminals.list` + notification "<Name> is now the default terminal"; installs if missing — menu **Setup → Defaults → Terminal**, typed.
- `omarchy channel current` / `omarchy-channel-current` — `dev|edge|stable|rc|unknown` — typed; drives the ✓ in **Update → Channel**.
- `omarchy channel set <stable|rc|edge|dev>` / `omarchy-channel-set` — `dev` shows a warning + `gum confirm --default=false "Switch to dev channel?"` ("Cancelled." on No), clones `~/omarchy` and dev-links; all channels: `omarchy-refresh-pacman`, `omarchy-update-pacman -S … omarchy(-dev) omarchy-settings(-dev)`, dev-unlink when leaving dev, `omarchy-state set reboot-required`, then `omarchy-update -y`; unknown → "Unknown channel: X" + usage, exit 1; ERR trap prints "The channel switch did not complete… rerun: omarchy-channel-set X" — `requires-sudo`, NET, SLOW — menu **Update → Channel → Stable/RC/Edge/Dev** (floating terminal), typed.
- `omarchy reinstall` / `omarchy-reinstall` — prints warning, `gum confirm "Are you sure you want to reinstall and lose config changes?"`, then `-pkgs` + `-configs`, then "System has been reinstalled. Reboot?" — `requires-sudo`, NET, SLOW — typed (`manual/30-updates.md`, `45-troubleshooting.md`).
- `omarchy reinstall configs` / `omarchy-reinstall-configs` — refuses root; `cp -af /etc/skel/. ~/`, refresh limine/plymouth, nvim refresh — destructive to `$HOME` — typed.
- `omarchy reinstall pkgs` / `omarchy-reinstall-pkgs` — stable mirrors, `-Suu`, reinstall `omarchy-base.packages` — `requires-sudo`, NET, SLOW — typed.
- `omarchy installed service dropbox` / `omarchy-installed-service-dropbox` — exit 0 when `dropbox-cli running` succeeds or a `dropbox` process exists — **hidden** — plumbing (menu `when`), typed.
- `omarchy installed service tailscale` / `omarchy-installed-service-tailscale` — exit 0 when `tailscale status --json` succeeds or `tailscaled` is active/running — **hidden** — plumbing, typed.
- `omarchy upgrade to quattro [-y|--yes] [--reboot] [--dev] [--channel stable|rc|edge] [--user U] [-h]` / `omarchy-upgrade-to-quattro` — legacy (3.x) → quattro migration; clears screen, prints the QUATTRO banner + "one-way street" warning, `gum confirm "Continue with upgrade?"` (No → exit 0); validation errors before the banner: "Error: Unknown option", "Invalid channel 'X'. Use stable, rc, or edge.", "--dev needs the edge package repo; use --channel rc or --channel edge.", "Could not determine the non-root Omarchy user", "User 'X' does not exist."; on abort mid-way prints red "Upgrade incomplete - do NOT reboot."; ends with "WARNING: You must address any errors…" and `gum confirm "Reboot to complete Quattro upgrade now?"` — `requires-sudo`, NET, SLOW; group `upgrade` not advertised in the listing — typed/curl|bash.
- `omarchy migrate [--pending|--check] [-h]` / `omarchy-migrate` — runs each `$OMARCHY_PATH/migrations/*.sh` without a marker in `~/.local/state/omarchy/migrations/`, printing green "Running migration (<ts>)"; `--pending` lists names (exit 0) or exit 1 silently when none; waits up to 15 min on a pacman lock; unknown option → "Unknown option: X", exit 1; dismisses the "Omarchy Migrations" notification — typed; run by `omarchy-update` and by the click action of the migrate notification.
- `omarchy migrate notify` / `omarchy-migrate-notify` — if pending and no update running: critical notification "Pending Omarchy Migrations" / "Click to run N pending migration(s)." whose click runs `omarchy-migrate` in a presentation terminal; falls back to printing the list — systemd user oneshot `omarchy-migrate-notify.service` at login; typed.
- `omarchy sudo docker [--configured]` / `omarchy-sudo-docker` — exit 0 when Docker needs sudo now (socket not writable) / after login (`--configured`: user not in `docker` group); other arg → usage, exit 2 — **hidden** — plumbing for **Setup/Remove → Security → Sudoless Docker** `when`.
- `omarchy sudo keepalive` / `omarchy-sudo-keepalive` — `sudo -v` then a background refresh loop that its own EXIT trap kills immediately when run as a command (only useful when sourced) — `requires-sudo` — typed.
- `omarchy sudo passwordless [MINUTES]` / `omarchy-sudo-passwordless` — toggles `/etc/sudoers.d/99-omarchy-nopasswd-<user>` with a `systemd-run` expiry timer (default 15 min); prints the ⚠️ warning and `gum confirm "Enable passwordless sudo for N minutes? …"` → "Passwordless sudo has been ENABLED…" / "Aborted. No changes made."; run again → "Passwordless sudo has been DISABLED…"; with MINUTES while enabled → "Passwordless sudo timer updated…"; non-numeric → usage, exit 1 — `requires-sudo` — menu **Setup → Security → Passwordless Sudo** (floating terminal), typed.
- `omarchy dev add migration [--no-edit]` / `omarchy-dev-add-migration` — `touch migrations/<git commit unix time>.sh` in `$OMARCHY_PATH` (or cwd) and open nvim; on a packaged install `git log` fails → "fatal: not a git repository", exit 128; `system|user` arg warns "migration scopes are no longer used"; unknown → usage, exit 1 — typed (developers).
- `omarchy dev benchmark cli [--repeat=N]` / `omarchy-dev-benchmark-cli` — "Omarchy CLI benchmark (N runs each)" + avg/min/max ms for 9 router invocations; `--repeat=0`/non-numeric → "--repeat must be a positive integer", exit 2; unknown → usage, exit 2 — typed.
- `omarchy dev benchmark theme switcher [--repeat=N] [--keep-cache]` (alias `… theme-switcher`) / `omarchy-dev-benchmark-theme-switcher` — "Theme switcher benchmark (N warm runs each)", cold/warm rows, "Theme previews: N" — typed.
- `omarchy dev font [list|add] <name> <svg|url> [--codepoint U+E9xx] [--label L] [--font PATH]` / `omarchy-dev-font` — Python; `list` prints `U+E9xx <glyph> name WxH` for the PUA marks in `$OMARCHY_PATH/default/fonts/omarchy/omarchy.ttf`; `add` appends a glyph (fails with PermissionError on the package-owned font; missing SVG file → uncaught traceback; URL fetch → "could not fetch"); argparse `-h` — typed (developers), NET for URLs.
- `omarchy dev install ydoo` / `omarchy-dev-install-ydoo` — adds user to `input` (pkexec), installs `ydotool`, writes udev rule via pkexec, starts `ydotool.service` → "ydotool is ready." — `requires-sudo` (polkit dialogs), NET — typed.
- `omarchy dev link <path> [--no-reboot]` / `omarchy-dev-link` — writes `/etc/omarchy.conf` (`export OMARCHY_PATH="<path>"`) and `/etc/sudoers.d/omarchy-dev-path` (validated with `visudo -cf`), prints "Pointed Omarchy at <path>" / "sudo now resolves omarchy-* from <path>/bin", then `gum confirm "Reboot now to activate?"`; refuses root; missing path → "Error: path does not exist: X", exit 1; warns when `bin/default/shell` missing; wrong 2nd arg → usage, exit 1; `-h` → long usage — `group=dev`, sudo — typed (developers; also by `channel set dev`).
- `omarchy dev unlink [--no-reboot]` / `omarchy-dev-unlink` — resets `/etc/omarchy.conf` to `/usr/share/omarchy`, removes the sudoers drop-in, "Pointed Omarchy at /usr/share/omarchy", reboot prompt; extra/unknown arg → usage, exit 1 — sudo — typed.
- `omarchy dev status` / `omarchy-dev-status` — "dev-link: inactive" (plus "(default guard)" line if `/etc/omarchy.conf` exists) or "dev-link: configured" + conf path + "sudo resolves omarchy-* from: …" + "status: reboot required…"; always "current shell: OMARCHY_PATH=…"; "Note: the running session does not match /etc/omarchy.conf. Reboot to settle it." on mismatch — typed.
- `omarchy dev pkg test [pkg] [checkout] [makepkg args…]` / `omarchy-dev-pkg-test` — builds+installs a package from `~/Work/omarchy/omarchy-installer` with PKGBUILDs from `$OMARCHY_PKGBUILDS_DIR`; "Error: checkout not found at …", exit 1; "Error: PKGBUILD not found…" — sudo, SLOW — typed.
- `omarchy dev theme preview [theme|dir|colors.toml] [--no-color|--plain] [--no-osc|--osc] [-h]` (also `dev theme-preview`) / `omarchy-dev-theme-preview` — prints Theme/File/Mode, fg/bg contrast, gradient, neutral ramp, swatches, samples, ANSI strips; **applies the theme's OSC palette to the current terminal** unless `--no-osc`; "Theme not found: X", exit 1; second positional → usage, exit 1 — typed.
- `omarchy dev ui preview [section]` / `omarchy-dev-ui-preview` — `omarchy-shell shell summon omarchy.dev-gallery {"section":…}` — typed.
- `omarchy tui install [name command float|tile icon]` / `omarchy-tui-install` — 4 args or interactive gum prompts (Name, Launch Command, Window style, Icon URL/name); writes `~/.local/share/applications/<Name>.desktop` with `Exec=xdg-terminal-exec --app-id=TUI.float|TUI.tile -e <cmd>`; downloads http(s) icons (NET); empty field → "You must set app name, app command, and icon URL/name!", exit 1; interactive run ends "You can now find <Name> using the app launcher (SUPER + SPACE)" — menu **Install → TUI** (floating terminal), typed.
- `omarchy tui remove [name]` / `omarchy-tui-remove` — no arg → `omarchy-menu-select` over TUI desktop files or "No TUIs to remove.", exit 1; removes desktop file + icons, notification "TUI removed" / "<name>" — menu **Remove → TUI** (only shown when a TUI exists), typed.
- `omarchy tui remove all [dir]` / `omarchy-tui-remove-all` — "Scanning for TUIs in …", "Removing TUI: X" per file or "No TUIs found.", "TUIs removed successfully." — typed.
- `omarchy snapshot <create|restore>` / `omarchy-snapshot` — `create`: green "Create system snapshot", `snapper -c <cfg> create -c number -d <omarchy-version>` + cleanup per config, "Snapshots can be selected during boot."; no configs → yellow "No Snapper configs found, so no snapshot was created." + hint, exit 1; snapper missing → exit 127 silently; `restore`: `sudo limine-snapper-restore`; **any other word → exits 0 silently** (no default case); no arg → usage, exit 1 (router shows help first) — `requires-sudo` — typed (`manual/47-system-snapshots.md`); `create` runs inside every `omarchy update`.
- `omarchy reminder <minutes> [message] | -i|--interactive | show [-j|--json] | clear` / `omarchy-reminder` — `systemd-run --user --on-active=<m>m` transient timer `omarchy-reminder-<m>m-<epoch>`, confirmation notification "Reminder set for N minutes" / "You'll be reminded at HH:MM" (or "<message> in N minutes"), fires "Reminder" / "<message|Your N minutes are up>"; `show` → notification "Upcoming reminders" listing or "No outstanding reminders"; `show --json` → `{count,active,tooltip,reminders:[…]}` for the bar indicator; `clear` → stops timers, "All reminders have been cleared"; `-i` opens the shell reminder panel ("Remind in minutes" → "Reminder message"); `0`, non-numeric, `show <bad>` → usage, exit 1 — hotkeys **Super+Ctrl+Alt+R** (show), **Super+Shift+Ctrl+R** (clear); menu **Trigger → Reminder → Set one / Show all / Clear all**; typed.
- `omarchy screensaver` / `omarchy-screensaver` — blackens the terminal, hides the Hyprland cursor, loops `ttfx` random effects over `~/.config/omarchy/branding/screensaver.txt`; exits on any key, on signals, or when the focused window is not class `org.omarchy.screensaver` (so it exits within ~1 s when run in an ordinary terminal) — terminal — reached via `omarchy-launch-screensaver [force]`: menu **System → Screensaver** (`Super+Escape` → Screensaver, forces even when disabled), idle after 150 s (lock at 300 s), **Trigger → Toggle → Screensaver** toggles availability (notifications "Screensaver disabled/enabled").
- `omarchy mise install <package> [command-name [bin-name]]` / `omarchy-mise-install` — writes `~/.local/bin/<command>` wrapper (`mise use -g --quiet <pkg> || exit 1; exec mise x <pkg> -- <bin> "$@"`); no arg → usage, exit 1; command name with `/`, leading `.`/`-`, control chars → "'X' is not usable as a command name", exit 1 — typed; used by installers/migrations; running the wrapper needs NET.
- `omarchy openclaw onboard` / `omarchy-openclaw-onboard` — runs `openclaw onboard --flow quickstart --install-daemon --skip-ui` in the terminal, watches for the gateway service to answer, then stops the never-exiting wizard; "OpenClaw is already set up and its gateway is running." (exit 0) when already configured; "OpenClaw's gateway did not come up within 180s…" (exit 1); without the `openclaw` binary the wizard line fails with "openclaw: command not found" and the script exits 127 — terminal, NET — typed; used by `omarchy-install-ai-openclaw`/`omarchy-launch-openclaw`.

## Observations

1. **Version skew is the first thing to check.** The minted disk is Omarchy 4.0.2 while these notes describe HEAD (`4.0.0.alpha` dev line). The `omarchy up` alias landed in the HEAD commit of the same day; `commands --markdown`, the `--json --help` record, and the "help flag anywhere" scan may also be newer than 4.0.2. Every router test therefore starts by recording `omarchy version`; an "Unknown Omarchy command" for `omarchy up` on 4.0.2 is a version mismatch to note, not a bug.
2. **`omarchy help` is not help.** Only `--help`/`-h` are intercepted; `omarchy help` produces "Unknown Omarchy command: omarchy help" and exit 127 (`bin/omarchy:1079-1090`). Tests expect the current behaviour and flag it as a UX finding.
3. **Exit codes are invisible.** The driver only sees pixels, so every negative-path step appends `; echo "exit=$?"`. Long outputs (`omarchy`, `omarchy commands`, `omarchy debug --print`) do not fit one foot window: pipe through `| head -n 30` or `| sudo tee /dev/ttyS0 >/dev/null` and read `./client get-serial`.
4. **Hidden ≠ unreachable.** `state`, `done`, `upload log`, `git url check`, `version branch`, `cmd terminal cwd`, `sudo docker`, `installed service *` are `hidden=true`: absent from `omarchy commands` and from group help, present in `omarchy commands --all`, and they still route and run. The tests prove both halves.
5. **Two non-hidden groups are unadvertised**: `show` and `upgrade` have no `GROUP_DESCRIPTIONS` entry, so `omarchy` never mentions them, `omarchy show --help` prints "Show commands:" without the em-dash description, yet `omarchy commands` lists `omarchy show done` / `omarchy show logo` / `omarchy upgrade to quattro`. Likely an oversight to report.
6. **Screen-only proof is hard for several commands**: `omarchy snapshot create` (proof is `sudo snapper -c root list`), `omarchy state`/`done` (proof is `ls`), `omarchy hook` (proof is a hook that echoes), `omarchy reminder` (proof is a toast that vanishes in seconds plus `systemctl --user list-timers 'omarchy-reminder-*'`), `omarchy sudo passwordless` (proof is `sudo -k; sudo -n true; echo $?`), `omarchy dev link` (proof is `omarchy dev status` and `cat /etc/omarchy.conf`). Instructions always add the shell-level probe.
7. **Notifications are transient toasts** (omarchy-shell). Screenshot immediately after the command; a second later it may be gone.
8. **`omarchy debug` interactive menu lacks "Upload log" in the VM** because it gates on `ping -c 1 8.8.8.8`, and ICMP fails under QEMU user-mode NAT although HTTPS works. `omarchy upload log …` (curl) does work. Record the missing option as an environment artefact, not a defect.
9. **`omarchy snapshot <anything-else>` silently succeeds** (exit 0, no output) because the `case` has no `*)` arm. The test documents the current behaviour and asks the driver to report it.
10. **`omarchy version pkgs` on a fresh install** may print today's date at 00:00: with no `upgraded` line in `/var/log/pacman.log`, `date -d ""` yields midnight. Record whichever appears.
11. **`omarchy hook` metadata says `[name]` is optional** but the script exits 1 with usage when it is absent; the router's required-args guard therefore does not protect it. Minor metadata/behaviour mismatch.
12. **`omarchy-screensaver` is only meaningful inside `omarchy-launch-screensaver`**: run in a normal foot window it hides the cursor, paints black, and exits after ≤1 s because the focused window's class is not `org.omarchy.screensaver`. `System → Screensaver` passes `force`, so it works even after `Trigger → Toggle → Screensaver` disabled the idle screensaver. Idle auto-start is 150 s by default, lock at 300 s (`shell/plugins/services/idle/Service.qml:17-18`).
13. **`omarchy-sudo-keepalive` cannot work as an executed command**: its EXIT trap kills the refresh loop the moment the script returns, so it degrades to `sudo -v`.
14. **Presentation terminals** (`omarchy-launch-floating-terminal-with-presentation`) always start with the green logo (`omarchy-show-logo`) and end with `omarchy-show-done`: "● Done! Press any key to close..." or red "● Failed (exit code N)! Press any key to close...". Every menu entry that opens a floating terminal (Update → Omarchy, Setup → Security → Passwordless Sudo, Install → TUI, Update → Channel → …) shows these two frames.
15. **`omarchy dev link` touches sudoers.** It writes `/etc/sudoers.d/omarchy-dev-path` and `/etc/omarchy.conf`. A test that links to a scratch directory must end with `omarchy dev unlink --no-reboot` and must answer **No** to every "Reboot now to activate?" prompt: rebooting with `OMARCHY_PATH` pointing at an empty directory would break the desktop.
16. **`omarchy dev theme preview` recolours the current terminal** via OSC unless `--no-osc`; the change persists until the terminal is closed. Use `--no-osc` when the terminal must stay readable for later steps.
17. **`omarchy dev font add` error handling**: a missing SVG path raises an uncaught Python traceback; writing to the package-owned `/usr/share/omarchy/default/fonts/omarchy/omarchy.ttf` ends in `PermissionError`. `list` works read-only.
18. **`omarchy dev add migration` on a packaged install** fails with `fatal: not a git repository` (exit 128) because `/usr/share/omarchy` is not a checkout; it only works with `OMARCHY_PATH` pointing at a git repo.
19. **Default terminal is foot** (`default/xdg-terminal-exec/hyprland-xdg-terminals.list`), so `omarchy default terminal` prints `foot`, `display text size` edits `~/.config/foot/foot.ini` and shows the "Restart Foot" toast, and Super+Enter opens foot in the focused terminal's cwd (`omarchy-launch-terminal` → `omarchy-cmd-terminal-cwd`).
20. **Menu hotkeys at HEAD**: `Super+Space` = Omarchy menu root (Apps/Learn/Trigger/Style/Setup/Install/Remove/Update/About/System), `Super+Escape` = System submenu, `Super+Alt+Space` = Apps. The existing `lock-screen` definition's "Omarchy Menu with Super+Escape" is the System submenu.
21. **`omarchy tui remove all`** always routes to `omarchy-tui-remove-all` (longest filename prefix), so a TUI literally named "all" cannot be removed by name through the router (only via the picker or `omarchy-tui-remove all` directly).
22. **`omarchy channel set <x>` ends with a full `omarchy update -y`** (NET, SLOW, and possibly a reboot-required state); only the argument validation and the `dev` cancel path are cheap. Same for `omarchy reinstall` (only the "No" path is cheap) and `omarchy upgrade to quattro` (banner + "No", or flag validation).
23. **`omarchy migrate notify`** is a login oneshot; the fake-migration test drops a root-owned `.sh` into `/usr/share/omarchy/migrations/` (pacman will later complain about an unowned file — fine on a discarded disk).
24. **`pkexec` prompts** (`dev install ydoo`) appear as a polkit password dialog on the desktop, not in the terminal.
25. **Interactive pickers**: `omarchy transcode` with no args uses `omarchy-menu-file` over `~/Pictures:~/Videos`, which are empty on a fresh install; tests create an image with `magick` first. `omarchy tui remove` with no args opens `omarchy-menu-select`. `omarchy file select` opens the GTK portal dialog (`xdg-desktop-portal-gtk` is in the base packages).
26. **`omarchy debug` requires the sudo password twice per session at most** (dmesg); `omarchy debug --print --no-sudo` needs none and prints the whole report inline. Its "Save in current directory" copies `/tmp/omarchy-debug.log` to `./omarchy-debug.log`; run from `/tmp` the `cp` fails (same file) but the script still prints `✓ Log saved` — tests run it from `~`.
27. **Root binaries swallow typos.** Longest-prefix resolution stops at the first existing filename, so `omarchy version chan` or `omarchy version bogus` execute `omarchy-version chan` (which ignores arguments and prints the version) instead of erroring; only groups without a root binary (`dev`, `default`, `cmd`, `show`) give the unknown-command or prefix-listing behaviour. Likewise `omarchy state set` and `omarchy hook install post-update` bypass the router's required-args guard because leftovers are non-empty, and land on the scripts' own usage messages (exit 1).
28. **Direct `omarchy screensaver` leaves the terminal black**: it sets the background with OSC 11 and never resets it on exit.

## Proposed tests

Conventions used by every test below: the terminal is opened with `Super+Enter` (foot); exit codes are invisible on
screen, so negative steps append `; echo "exit=$?"`; anything longer than a screen goes through
`… | sudo tee /dev/ttyS0 >/dev/null` (password `prime`) and is read with `./client get-serial`. The disk is 4.0.2 while the
source is HEAD, so each router test records `omarchy version` first and treats missing HEAD-only features as skew to note.

### cli-discover-commands   [VM-OK]
description: A user discovers what Omarchy can do from the terminal: the bare `omarchy` banner and group table, the command catalogue, and the catalogue's self-check, with hidden plumbing kept out of the default view.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, type `omarchy version` and press Enter; record the version (e.g. `4.0.2-1`).
  * Type `omarchy | head -n 20`; the first line must be `Omarchy command center`, followed by `Usage:` and `Common commands:` (`omarchy update`, `omarchy theme set <name>`, `omarchy debug`…).
  * Type `omarchy | sed -n '/^Groups:/,/^Discovery:/p' | sudo tee /dev/ttyS0 >/dev/null` and read it with get-serial.
  ** The group table is alphabetical (`agent` first, `windows` last), two columns, no counts, and must NOT contain `show`, `upgrade`, `apply`, `state`, `done`, `upload` or `git`.
  * Type `omarchy commands | head -n 3; omarchy commands | grep -cE 'omarchy (state|done|upload log|version branch)'; omarchy commands --all | grep -cE 'omarchy (state|done|upload log|version branch)'`; expected `Omarchy commands:` with indented `omarchy … <summary>` rows, then `0`, then `4` — hidden commands only show under `--all`.
  * Type `omarchy commands --check; echo "exit=$?"`; expected `Command metadata check passed (N commands)` with N ≥ 200 and `exit=0`.
  * Type `omarchy commands --json | jq -r '.ok, (.commands|length)'`; expected `true` and a number ≥ 200.
  * Type `omarchy commands --bogus; echo "exit=$?"`; expected `Unknown option for omarchy commands: --bogus`, the `omarchy commands` usage, `exit=2`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The full `omarchy` output is ~90 lines; only the head and the serial dump are readable, do not try to screenshot it whole.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the version, the `Omarchy command center` header, the two grep counts (`0` and `4`), the `--check` pass line, the jq values and the `--bogus` refusal
  ** Serial dump of the alphabetical Groups block without `show`/`upgrade`/`apply`
  * If unsuccessful
  ** the terminal output of the invocation that errored, hung, or listed a hidden command by default
covers: bin/omarchy:29-97,414-424,509-547,549-784,1073-1091; docs/cli-router.md "Groups and the top-level listing", "Introspection"; test/cli:54-109

### cli-help-is-safe   [VM-OK]
description: Asking for help never runs a command: bare groups, `--help` anywhere in the arguments, and bare routes with required arguments all print synthesized help, and both spaced and hyphenated spellings reach the same binary.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev`; expected `Dev commands — Omarchy development tools:` with 11 rows (`omarchy dev link <path-to-checkout> [--no-reboot]`, `omarchy dev status`, …) and nothing executed.
  * Type `omarchy version --help`; expected `Usage:` / `omarchy version`, `Binary:` / `omarchy-version`, and `Related commands:` listing `version channel` and `version pkgs` but NOT the hidden `version branch`.
  * Type `omarchy show --help`; expected the header exactly `Show commands:` (no em-dash — the group has no listing entry) with `omarchy show done [exit-code]` and `omarchy show logo`.
  * Type `omarchy update bogus --help`; expected help with `Binary:` / `omarchy-update`; wait 5 s and screenshot — there must be no sudo prompt or update banner.
  * Type `omarchy snapshot; echo "exit=$?"`; expected `Usage:` / `omarchy snapshot <create|restore>` and `exit=0`, no sudo prompt; then `omarchy reminder; echo "exit=$?"` — its usage and `exit=0`, no toast.
  * Type `omarchy dev theme preview --help | grep -A1 Binary` and `omarchy dev theme-preview --help | grep -A1 Binary`; both print `omarchy-dev-theme-preview`.
  * Type `omarchy version --help --json | jq -r '.ok, .command.binary'`; expected `true` and `omarchy-version` (on 4.0.2 this may print plain help instead — record with the version).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Help output is short; one screenshot per command is enough.
  * If `omarchy update bogus --help` shows anything scrolling or asks for a password, press Ctrl+C at once and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the four help blocks with the quoted headers, the post-`update` idle prompt, the two identical `Binary:` lines and the jq output
  * If unsuccessful
  ** the sudo prompt / update banner / snapshot output that proves a command ran, or an `Unknown Omarchy command` for a valid spelling
covers: bin/omarchy:126-149,361-372,389-412,736-738,799-909,949-1047; docs/cli-router.md "Dispatch"; test/cli:111-131,186-194,664-715

### cli-unknown-command-and-typos   [VM-OK]
description: Typos and half-typed routes fail fast with a "Did you mean" hint or a prefix listing, `omarchy help` is (today) an unknown command, and a group's root binary swallows extra words instead of erroring.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy help; echo "exit=$?"`.
  ** Expected today: `Unknown Omarchy command: omarchy help`, `Run 'omarchy commands --all' to discover available commands.`, `exit=127`. If the command-center help appears with `exit=0` instead, record it — both outcomes are worth knowing.
  * Type `omarchy ver; echo "exit=$?"`; expected the Unknown line, `Did you mean: omarchy version ?`, the Run line, `exit=127`.
  * Type `omarchy bogus-nothing; echo "exit=$?"`; expected the Unknown and Run lines, no `Did you mean`, `exit=127`.
  * Type `omarchy dev benchmark; echo "exit=$?"`; expected a prefix listing `dev benchmark commands:` with `omarchy dev benchmark cli …` and `… theme switcher …`, `exit=0`, no benchmark run.
  * Type `omarchy dev bench; echo "exit=$?"`; expected `Unknown Omarchy command: omarchy dev bench`, `Did you mean: omarchy dev ?`, `exit=127`.
  * Type `omarchy version chan; echo "exit=$?"`; quirk: `version` is a root binary, so the version string prints with `exit=0` — no error. Record it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All messages go to stderr but appear in the same terminal; nothing scrolls.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each result with its `exit=` line; the `omarchy help` outcome recorded verbatim
  * If unsuccessful
  ** an invocation that hangs, runs something, or exits 0 where 127 is expected (other than the recorded quirks)
covers: bin/omarchy:824-841,934-947,1060-1070,1079-1090

### cli-alias-omarchy-up   [VM-OK]
description: `omarchy up` is a new alias for `omarchy update`: its help resolves to the update binary and lists the alias without starting an update; on a 4.0.2 disk the alias may not exist yet and that is recorded as version skew.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy version`; note the version.
  * Type `omarchy up --help; echo "exit=$?"`.
  ** Expected at HEAD: `Usage:` / `omarchy update [-y]`, an `Aliases:` block with `omarchy up`, `Binary:` / `omarchy-update`, `exit=0`.
  ** On a disk predating the alias: `Unknown Omarchy command: omarchy up`, a `Did you mean: omarchy update ?` (or `upgrade`/`upload`), `exit=127` — record verbatim with the version.
  * Wait 5 s and screenshot: no sudo prompt, no update banner.
  * Type `omarchy commands | sed -n '/^Aliases:/,$p'`; at HEAD the table contains `omarchy up  omarchy update` beside `omarchy screenshot`, `omarchy reboot`, `omarchy shutdown`, `omarchy logout`, `omarchy background`, `omarchy screenrecord`.
  * Never run `omarchy up` or `omarchy update` without `--help`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The alias table is at the very end of `omarchy commands`; the sed keeps only that part.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `up --help` with `Binary: omarchy-update` and the alias table (or the recorded unknown-command output plus version for the skew case), and the idle prompt 5 s later
  * If unsuccessful
  ** an update that started (sudo prompt / package list scrolling)
covers: bin/omarchy-update:1-7; bin/omarchy:229-231,302-313,606-619,889-896; docs/cli-router.md "Dispatch" (alias fallback)

### cli-hidden-commands-route   [VM-OK]
description: Hidden plumbing (`state`, `done`, `installed service …`, `sudo docker`, `cmd terminal cwd`) stays out of listings and group help yet still routes and runs when typed, so menus keep working while users are not shown internals.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy installed --help`; expected `Installed commands — Installed optional service checks:` and `No documented commands found. Try: omarchy commands --all`.
  * Type `omarchy commands --all | grep -E 'omarchy (installed service|sudo docker|cmd terminal cwd)'`; expected four rows.
  * Type `omarchy cmd --help`; expected rows `omarchy cmd missing` and `omarchy cmd present` but no `terminal cwd`.
  * Type `omarchy state --help | grep -A1 Binary`; expected `omarchy-state` — hidden commands still route.
  * Type `omarchy installed service tailscale; echo "exit=$?"` and `omarchy installed service dropbox; echo "exit=$?"`; expected `exit=1` twice (neither installed).
  * Type `omarchy done check nothing-here; echo "exit=$?"`; expected no output and `exit=1` — the hidden binary really ran.
  * Press Super+Space → Remove; there must be no `Dropbox`/`Tailscale` rows (the `Services` entry may be absent entirely — record). Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Menu rows are hidden by `when:` shell conditions; an empty submenu may simply not be listed.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty group help, the four `--all` rows, the `cmd` group help without `terminal cwd`, the routed `state --help`, the three `exit=1` lines and the Remove menu
  * If unsuccessful
  ** a hidden route in a default listing, or a hidden route failing to dispatch
covers: bin/omarchy:236-239,414-424,585-620,817-821,1032-1036; bin/omarchy-installed-service-dropbox; bin/omarchy-installed-service-tailscale; docs/cli-router.md "How a binary becomes routes"; test/cli:196-220

### version-and-channel-report   [VM-OK]
description: The version group is what users paste into support threads: `omarchy version`, `version channel`, `channel current` and `version pkgs` must agree with the installed package and mirror, and the hidden `version branch` fails quietly on a packaged install.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy version; echo "exit=$?"`; expected a pacman version such as `4.0.2-1`, `exit=0`.
  * Type `pacman -Q omarchy omarchy-dev 2>/dev/null`; the version field must match the line above.
  * Type `omarchy version channel; omarchy channel current`; expected the same single word twice, normally `stable`.
  * Type `omarchy version pkgs`; expected a date like `Friday, September 18 2026 at 14:03`.
  ** Quirk: on a never-upgraded disk this prints today at `00:00`; record it together with `grep -c upgraded /var/log/pacman.log`.
  * Type `omarchy version branch; echo "exit=$?"`; expected no output and `exit=1`.
  * Type `omarchy version bogus; echo "exit=$?"`; quirk: the root binary ignores the argument and prints the version with `exit=0` — record, no error expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All outputs are one line; a single screenshot at the end can show the whole session.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the version, the matching `pacman -Q` line, the channel word twice, the pkgs date, the silent `exit=1`, and the `bogus` quirk
  * If unsuccessful
  ** `unknown` as the channel, a version mismatch with `pacman -Q`, or an error trace
covers: bin/omarchy-version; bin/omarchy-version-branch; bin/omarchy-version-channel; bin/omarchy-version-pkgs; bin/omarchy-channel-current; test/shell.d/version-test.sh; test/shell.d/channel-test.sh

### debug-report-print-and-save   [VM-PARTIAL]
description: `omarchy debug` produces the support report both non-interactively (`--print --no-sudo`) and through its sudo + gum menu that saves the log in the current directory; the "Upload log" option is skipped here because it is gated on ICMP ping, which the VM blocks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy debug --print --no-sudo | head -n 8`; expected `Date: …`, `Hostname: …`, `Omarchy Package: omarchy 4.0.…`, then the `SYSTEM INFORMATION` banner.
  * Type `grep -c 'skipped - --no-sudo' /tmp/omarchy-debug.log; grep -cE '^(DMESG|INSTALLED PACKAGES|JOURNALCTL)' /tmp/omarchy-debug.log`; expected `1` then `3`.
  * Type `omarchy debug --bogus; echo "exit=$?"`; expected `Unknown option: --bogus`, `Usage: omarchy-debug [--no-sudo] [--print]`, `exit=1`.
  * Type `cd ~ && omarchy debug`; enter `prime` at the `[sudo] password` prompt and wait up to 20 s.
  ** Expected a gum chooser with `View log` and `Save in current directory`; `Upload log` is expected to be ABSENT (ping fails under QEMU NAT) — record the options.
  ** Do not run this from `/tmp`: the report lives at `/tmp/omarchy-debug.log` and "save" would copy it onto itself.
  * Press Down to `Save in current directory`, Enter; expected `✓ Log saved to /home/prime/omarchy-debug.log`.
  * Type `ls -l ~/omarchy-debug.log && head -n 2 ~/omarchy-debug.log`; a non-empty file starting `Date:`.
  * Type `rm ~/omarchy-debug.log` to leave the home directory as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum choose highlights the current row; Up/Down move, Enter selects.
  * The report takes 10–20 s to gather (inxi + journal); keep screenshotting rather than sleeping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the report header, the two grep counts, the `--bogus` refusal, the chooser (documenting which options were present), the `✓ Log saved` line and the `ls -l`
  * If unsuccessful
  ** a sudo prompt despite `--no-sudo`, a chooser that never appears, or a missing saved file
covers: bin/omarchy-debug; manual/45-troubleshooting.md

### debug-idle-follows-screensaver-toggle   [VM-OK]
description: `omarchy debug idle` is the screensaver/lock diagnostics dump: all its sections print, and its screensaver detector tracks the Trigger → Toggle → Screensaver switch (`stopped` ↔ `disabled`).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy debug idle 20 | sudo tee /dev/ttyS0 >/dev/null` (password `prime`); read it with get-serial.
  ** Expected headers `== Time ==`, `== Idle IPC status ==`, `== Quickshell instances ==`, `== Recent idle logs ==`, `== Persisted shell log ==`, `== Relevant processes ==`, `== Sleep lock service ==`, `== Hyprland screensaver clients ==`, `== Idle inhibitors ==`, `== Screensaver detector ==` followed by `stopped`, `== Lock detector ==`.
  * Type `omarchy debug idle abc | grep -A1 'Screensaver detector'`; expected `stopped` again — a non-numeric count is silently replaced by 200.
  * Press Super+Space → Trigger → Toggle → Screensaver; expected toast `Screensaver disabled`.
  * Type `omarchy debug idle 5 | grep -A1 'Screensaver detector'`; expected `disabled`.
  * Press Super+Space → Trigger → Toggle → Screensaver again; toast `Screensaver enabled`; re-run the grep; expected `stopped`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts fade within seconds; screenshot right after clicking the menu row.
  * The Toggle submenu is under Trigger in the root Omarchy menu (Super+Space).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with the eleven section headers and `stopped`; screenshots of both toasts and the `disabled` → `stopped` detector lines
  * If unsuccessful
  ** a missing section, an `omarchy-shell` connection error, or a detector that ignores the toggle
covers: bin/omarchy-debug-idle; bin/omarchy-toggle-screensaver; default/omarchy/omarchy-menu.jsonc:93

### state-and-done-markers   [VM-OK]
description: The hidden `omarchy state` and `omarchy done` primitives persist toggles and setup markers under `~/.local/state/omarchy`: set/mark create files, clear removes them, and names that would escape the directory are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy state set qa-marker; ls ~/.local/state/omarchy/ | grep qa-marker`; expected `qa-marker`.
  * Type `omarchy state set ../escape; echo "exit=$?"`; expected `Invalid state name: ../escape`, `exit=2`; `ls ~/.local/state/ | grep -c escape` prints `0`.
  * Type `omarchy state clear 'qa-*'; ls ~/.local/state/omarchy/ | grep -c qa-marker`; expected `0`.
  * Type `omarchy state set; echo "exit=$?"`; the leftover `set` is forwarded, so expected `Usage: omarchy-state set <state-name>` and `exit=1`.
  * Type `omarchy done check qa-task; echo "exit=$?"`; expected `exit=1`. Then `omarchy done mark qa-task; omarchy done check qa-task; echo "exit=$?"`; expected `exit=0` and `ls ~/.local/state/omarchy/done/` lists `qa-task`.
  * Type `omarchy done bogus qa-task; echo "exit=$?"` and `omarchy done mark ../oops; echo "exit=$?"`; expected `Usage: omarchy-done <check|mark|ensure> <name>` / `exit=1`, then `Invalid done marker name: ../oops` / `exit=1`.
  * Type `rm ~/.local/state/omarchy/done/qa-task` so no marker is left behind.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Both commands are hidden but route normally; the proof is the `ls` output, not the (silent) command.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: `qa-marker` listed then count `0`, the `../escape` refusal, the done `exit=1` → `exit=0` flip with `qa-task` listed, the two done refusals
  * If unsuccessful
  ** a file created outside `~/.local/state/omarchy`, or `../` accepted
covers: bin/omarchy-state; bin/omarchy-done; test/shell.d/hook-state-name-guard-test.sh; test/shell.d/done-test.sh

### hook-install-run-and-reject   [VM-OK]
description: User hooks are the supported extension point: `omarchy hook install` copies a script into `~/.config/omarchy/hooks/<type>.d/`, `omarchy hook <type>` runs it and reports a failing hook without aborting, and bad names or missing files are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `printf '#!/bin/bash\necho "hello from hook $*"\n' > /tmp/hi.sh && omarchy hook install post-update /tmp/hi.sh`; expected `Installed post-update hook: /home/prime/.config/omarchy/hooks/post-update.d/hi.sh`.
  * Type `omarchy hook post-update one two; echo "exit=$?"`; expected `hello from hook one two`, `exit=0`.
  * Type `printf '#!/bin/bash\nexit 1\n' > /tmp/bad.sh && omarchy hook install post-update /tmp/bad.sh && omarchy hook post-update; echo "exit=$?"`; expected the hello line, then `Hook failed: /home/prime/.config/omarchy/hooks/post-update.d/bad.sh`, and `exit=0` (a failing hook does not abort the runner).
  * Type `omarchy hook install post-update /nope; echo "exit=$?"`; expected `Hook file not found: /nope`, `exit=1`.
  * Type `omarchy hook ../x; echo "exit=$?"` and `omarchy hook install ../x /tmp/hi.sh; echo "exit=$?"`; expected `Invalid hook name: ../x` and `exit=2` both times.
  * Type `omarchy hook; echo "exit=$?"`; quirk: the metadata calls the name optional but the script prints `Usage: omarchy-hook [name] [args...]` with `exit=1`.
  * Type `rm -r ~/.config/omarchy/hooks/post-update.d && omarchy hook post-update; echo "exit=$?"`; expected silence and `exit=0` — hooks gone, state restored.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hooks directory does not exist on a fresh install; the install step creates it.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install line, `hello from hook one two`, the `Hook failed:` line with `exit=0`, the three refusals with their codes, the bare-hook usage, and the silent run after cleanup
  * If unsuccessful
  ** a hook written under a path containing `..`, or the runner aborting after the failing hook
covers: bin/omarchy-hook; bin/omarchy-hook-install; test/shell.d/hook-state-name-guard-test.sh

### hook-post-boot-fires-after-reboot   [VM-OK] [SLOW]
description: Hyprland's autostart runs `omarchy-hook post-boot` shortly after login, so a user-installed post-boot hook must run on the next boot and be visible as a toast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `printf '#!/bin/bash\ndate > ~/post-boot-ran\nomarchy-notification-send "post-boot hook ran"\n' > /tmp/pb.sh && omarchy hook install post-boot /tmp/pb.sh`; expected `Installed post-boot hook: …/post-boot.d/pb.sh`.
  * Type `omarchy hook post-boot && cat ~/post-boot-ran && rm ~/post-boot-ran`; a toast `post-boot hook ran` appears and a date prints (manual run works).
  * Press Super+Escape (System menu) and click Reboot. Answer the LUKS passphrase `prime`, then log in as `prime`/`prime` if a login screen appears.
  * Screenshot every 3 s for the first 20 s after the desktop appears; a toast `post-boot hook ran` must show.
  * Open a terminal and type `cat ~/post-boot-ran`; a date from the last two minutes.
  * Type `rm -r ~/.config/omarchy/hooks/post-boot.d ~/post-boot-ran` to restore the stock state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reboot takes 1–2 minutes including the passphrase prompt; keep taking screenshots, never sleep long.
  * The toast is transient — the 3 s cadence after login matters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the toast after login and of the fresh date in `~/post-boot-ran`
  * If unsuccessful
  ** the post-login desktop with no toast, the absent/old marker file, and `./client get-serial`
covers: default/hypr/autostart.lua:13; bin/omarchy-hook; bin/omarchy-hook-install

### ascii-render-and-skip   [VM-OK]
description: `omarchy ascii` renders text in the logo's block font: letters draw, unsupported characters are skipped with a note, and text with nothing drawable, unknown options or no input are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy ascii Omarchy`; expected OMARCHY in `█ ▀ ▄ ▌ ▐` block glyphs about 9 rows tall.
  * Type `omarchy ascii "Hi 5"; echo "exit=$?"`; expected HI drawn, then `Skipped, no glyph in Delta Corps Priest 1: 5`, `exit=0`.
  * Type `echo stdin | omarchy ascii | head -n 3`; the top rows of STDIN — piped input is accepted.
  * Type `omarchy ascii 123; echo "exit=$?"`; expected `Delta Corps Priest 1 draws letters and spaces only, and that text has neither.`, `exit=1`.
  * Type `omarchy ascii --bogus; echo "exit=$?"`; expected `Unknown option: --bogus` + usage, `exit=1`; then `omarchy ascii; echo "exit=$?"` — the usage and `exit=1`.
  * Type `omarchy ascii -- --help 2>&1 | head -n 10`; the router forwards everything after `--`, so HELP is drawn and `Skipped … : -` printed — no router help.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The art is 9 rows per line of text; a normal terminal shows two words at most, so clear between steps if needed.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of OMARCHY, HI with the Skipped line, and each refusal with its exit code; HELP drawn for the `--` case
  * If unsuccessful
  ** garbled glyphs, an awk error, or a hang waiting on stdin
covers: bin/omarchy-ascii:1-294; bin/omarchy:129-138; test/shell.d/ascii-test.sh

### transcode-picture-cli-and-reject   [VM-OK]
description: `omarchy transcode <file> <format> <resolution>` writes `<stem>-<resolution>.<format>` beside the input, copies it to the clipboard and toasts; bad paths, formats, resolutions and options are refused with clear messages.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `magick -size 1600x900 gradient:red-blue ~/Pictures/qa.png && ls ~/Pictures/`; `qa.png` exists.
  * Type `omarchy transcode ~/Pictures/qa.png jpg low; echo "exit=$?"`; expected toast `Transcoded to low jpg` / `Saved and copied to clipboard.`, `exit=0`.
  * Type `magick identify ~/Pictures/qa-low.jpg; wl-paste`; expected a JPEG 1080 px wide and `file:///home/prime/Pictures/qa-low.jpg`.
  * Type `omarchy transcode /nope.png jpg low; echo "exit=$?"`; expected `File not found: /nope.png`, `exit=1`.
  * Type `omarchy transcode ~/Pictures/qa.png bmp low; echo "exit=$?"` then `omarchy transcode ~/Pictures/qa.png jpg huge; echo "exit=$?"`; expected `Invalid picture format: bmp` and `Invalid picture resolution: huge`, `exit=1` each.
  * Type `omarchy transcode --bogus; echo "exit=$?"`; expected `Unknown option: --bogus` + usage, `exit=2`.
  * Type `rm ~/Pictures/qa.png ~/Pictures/qa-low.jpg` to leave Pictures empty as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot immediately after the transcode command — the toast fades in a few seconds.
  * `low` means "shrink to 1080 px wide"; the 1600 px source is reduced, never enlarged.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the toast, the `identify` line with 1080 width, the clipboard URI, and each refusal with its exit code
  * If unsuccessful
  ** a magick error, a missing output, or a refusal that still produced a file
covers: bin/omarchy-transcode

### transcode-picker-hotkey-and-menu   [VM-OK]
description: Super+Ctrl+Period and Trigger → Transcode open the interactive flow — file picker, format menu, resolution menu — ending in a converted file and a toast; cancelling the picker does nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `magick -size 800x600 xc:green ~/Pictures/pick.png`.
  * Press Super+Ctrl+Period (the `.` key); expected a shell menu titled `Transcode picture or video` listing `pick.png`.
  * Press Escape; the menu closes, no toast; `ls ~/Pictures` still shows only `pick.png`.
  * Press Super+Space, click Trigger, click Transcode; the same picker appears — click `pick.png` with the mouse.
  * Choose `jpg` in `Select format`, then `low` in `Select resolution`; expected toast `Transcoded to low jpg` / `Saved and copied to clipboard.`
  * In the terminal type `ls ~/Pictures/`; expected `pick-low.jpg` beside `pick.png`.
  * Type `rm ~/Pictures/pick.png ~/Pictures/pick-low.jpg`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The pickers are omarchy-shell menus: typing filters, Enter selects, Escape cancels; the file list is empty on a fresh disk, which is why the image is created first.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker (hotkey and menu), the format and resolution menus, the toast, and the `ls` with `pick-low.jpg`
  * If unsuccessful
  ** an empty picker although `pick.png` exists, or a toast without an output file
covers: default/hypr/bindings/utilities.lua:87; default/omarchy/omarchy-menu.jsonc:69; bin/omarchy-transcode:131-206

### transcode-ascii-from-logo   [VM-OK]
description: `omarchy transcode ascii` turns an image into braille or block text (the branding pipeline); it writes the output file and rejects bad modes, missing files and missing arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy transcode ascii /usr/share/omarchy/logo.svg /tmp/logo.txt --width 60; echo "exit=$?"`; expected `Wrote ASCII art to /tmp/logo.txt`, `exit=0`.
  * Type `cat /tmp/logo.txt`; braille dot characters forming the logo, no line wider than 60 columns.
  * Type `omarchy transcode ascii /usr/share/omarchy/logo.svg /tmp/logo-block.txt --mode block --width 40 && cat /tmp/logo-block.txt`; the same shape in `█ ▀ ▄` blocks.
  * Type `omarchy transcode ascii /usr/share/omarchy/logo.svg /tmp/x.txt --mode foo; echo "exit=$?"`; expected `Invalid mode: foo (expected braille or block)`, `exit=1`.
  * Type `omarchy transcode ascii /nope.svg /tmp/x.txt; echo "exit=$?"`; expected `Logo file not found: /nope.svg`, `exit=1`.
  * Type `omarchy transcode ascii /usr/share/omarchy/logo.svg; echo "exit=$?"`; expected `Usage: omarchy-transcode-ascii <input-image.svg|png> <output-path> [options]`, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Braille output can look faint on screenshots; the block variant is the easier one to verify visually.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the braille and block logos in the terminal, the `Wrote ASCII art` lines, and the three refusals
  * If unsuccessful
  ** `Unable to convert logo image`, an empty output file, or a magick error
covers: bin/omarchy-transcode-ascii

### show-logo-and-done-prompts   [VM-OK]
description: Every floating "presentation" terminal opens with `omarchy show logo` and closes with `omarchy show done`; the logo prints green and the done prompt colour-codes success vs. failure and waits for a key, both directly and inside a menu-launched terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy show logo`; the screen clears and the Omarchy block-letter logo prints in green.
  * Type `omarchy show done`; expected a green `●` and `Done! Press any key to close...` with the cursor waiting; press Space.
  * Type `omarchy show done 3`; expected a red `●` and `Failed (exit code 3)! Press any key to close...`; press Space.
  * Type `omarchy show done 0 </dev/null >/dev/null; echo "exit=$?"`; the prompt still appears (it talks to `/dev/tty`); press Space; `exit=0`.
  * Press Super+Space → Update → Config → Tmux; a floating terminal opens whose first frame is the green logo and whose last frame is `● Done! Press any key to close...`; press a key and the window closes.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal runs for a second or two; screenshot as soon as it appears and again when the Done line shows.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the green logo, the green Done prompt, the red Failed prompt, and the floating terminal's first and last frames
  * If unsuccessful
  ** a prompt that returns without waiting, a missing logo, or a floating terminal that closes without the Done frame
covers: bin/omarchy-show-logo; bin/omarchy-show-done; bin/omarchy-launch-floating-terminal-with-presentation; default/omarchy/omarchy-menu.jsonc:372

### upload-log-installed-and-rejects   [VM-OK] [NET]
description: The hidden `omarchy upload log <type>` posts a support bundle to logs.omarchy.org and prints a shareable URL (a few hundred KB up); an unknown type prints usage and the bare route shows help.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy upload log bogus; echo "exit=$?"`; expected `Usage: … [install|this-boot|last-boot|installed|system-info]` with the four option lines, `exit=1`.
  * Type `omarchy upload log; echo "exit=$?"`; expected the router help for `omarchy upload log <log-file>`, `exit=0`.
  * Type `omarchy upload log installed; echo "exit=$?"`; expected `Uploading system information to logs.omarchy.org...`, `✓ Log uploaded successfully!`, `Share this URL:` and a `https://logs.omarchy.org/…` URL, `exit=0` (allow 60 s).
  * Type `omarchy upload log last-boot; echo "exit=$?"`; on a first boot expect either a URL or `Error: No logs found for previous boot` with `exit=1` — record which.
  * Type `omarchy commands | grep -c 'upload log'`; expected `0` (hidden).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The upload can take up to a minute on the VM's link; screenshot every 5 s rather than sleeping.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage refusal, the router help, and the `✓ Log uploaded successfully!` line with its URL
  * If unsuccessful
  ** `Error: Failed to upload log file`, or a hang beyond 60 s
covers: bin/omarchy-upload-log

### file-select-dialog-pick-and-cancel   [VM-OK]
description: `omarchy file select` opens the desktop portal file chooser: picking a file prints its path, cancelling exits 1 silently, filters and folder mode work, and an unknown option is refused without a dialog.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `touch ~/Pictures/pick-me.png`.
  * Type `omarchy file select --title "QA pick" --extensions "png"; echo "exit=$?"`; a GTK chooser titled `QA pick` opens with a `*.png` filter.
  * Click into `Pictures`, click `pick-me.png`, click Open; expected `/home/prime/Pictures/pick-me.png` and `exit=0` in the terminal.
  * Type `omarchy file select --title "Cancel me"; echo "exit=$?"`; press Escape in the dialog; expected no path and `exit=1`.
  * Type `omarchy file select --directory --title "Pick folder"; echo "exit=$?"`; select `Pictures` and confirm; expected `/home/prime/Pictures`, `exit=0`.
  * Type `omarchy file select --bogus; echo "exit=$?"`; expected `omarchy-file-select: unknown option --bogus`, `exit=2`, no dialog.
  * Type `rm ~/Pictures/pick-me.png`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog is a separate floating window; hover/click it before typing so keys reach it.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the chooser with title and filter, the printed path with `exit=0`, the cancel `exit=1`, the folder result, and the refused option
  * If unsuccessful
  ** a `GLib.Error`/portal message, no dialog, or a path printed after cancel
covers: bin/omarchy-file-select

### git-url-check-accepts-and-refuses   [VM-OK]
description: The hidden `omarchy git url check` protects theme/plugin installs: normal repository URLs pass silently while remote-helper syntax, option-looking strings and unknown transports are refused with a named reason.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy git url check https://github.com/omacom/omarchy.git; echo "exit=$?"`; expected `exit=0`, no output.
  * Type `omarchy git url check git@github.com:omacom/omarchy.git; echo "exit=$?"`; expected `exit=0`.
  * Type `omarchy git url check 'ext::sh -c id'; echo "exit=$?"`; expected `omarchy-git-url-check: 'ext::sh -c id' names a git option or transport helper, not a repository.`, `exit=1`.
  * Type `omarchy git url check --upload-pack=id; echo "exit=$?"`; the same "names a git option or transport helper" refusal, `exit=1`.
  * Type `omarchy git url check foo://example.com/x; echo "exit=$?"`; expected `… names the 'foo' transport, which Omarchy does not clone from.`, `exit=1`.
  * Type `omarchy-git-url-check; echo "exit=$?"`; expected `omarchy-git-url-check: a git URL is required`, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Accepted URLs print nothing — the `exit=0` line is the proof.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot with the two `exit=0` lines and the four refusal messages
  * If unsuccessful
  ** `ext::` accepted (exit 0), or an https URL refused
covers: bin/omarchy-git-url-check

### disk-speedtest-cli-and-panel   [VM-OK]
description: The disk speed test streams read then write MB/s for the disk behind a directory, cleans up its scratch files, refuses a non-directory, and the Trigger → Speed Test → Disk Speed Test panel drives the same command with dials.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy disk speedtest /not/a/dir; echo "exit=$?"`; expected `Usage: omarchy-disk-speedtest [target-dir]`, `exit=2`.
  * Type `omarchy disk speedtest; echo "exit=$?"` and screenshot every 5 s for ~25 s.
  ** Expected `disk <model or vda>`, ~8 lines `read <MB/s>`, ~8 lines `write <MB/s>`, `exit=0`.
  ** Acceptable alternative to record: `Direct disk I/O is not available on /home/prime/.cache/omarchy`, `exit=1`.
  * Type `ls ~/.cache/omarchy/ | grep -c disk-speedtest; ls /dev/shm | grep -c disk-speedtest`; expected `0` and `0` — scratch files removed.
  * Press Super+Space → Trigger → Speed Test → Disk Speed Test; a panel with read/write dials titled with the disk name appears.
  * Screenshot every 3–5 s for 25 s: the read dial moves first, then the write dial, then both settle. Press Escape to close.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The test needs 2 GB free under `~/.cache`; the 40 GB disk has plenty.
  * Never sleep through the run — the per-second lines are the evidence.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the streaming `read`/`write` lines with the exit code, the two `0` counts, and the panel during read, during write and settled
  * If unsuccessful
  ** `Disk read test failed before finishing`, leftover `disk-speedtest-*.dat` files, or a panel that never moves
covers: bin/omarchy-disk-speedtest; default/omarchy/omarchy-menu.jsonc:73,101; shell/plugins/panels/disk-speedtest/Panel.qml:99

### display-text-size-set-reset-and-reject   [VM-OK]
description: `omarchy display text size N` scales shell, GTK and terminal text together and is visible in the bar; the report, the foot restart toast, `reset`, and the 9–20 range check all behave.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop bar for reference, then open a terminal with Super+Enter and type `omarchy display text size`; expected `text size: 12 (default) px`, `gtk text-scaling-factor: 1.0`, `terminal font: 9 pt` (record the pt if different).
  * Type `omarchy display text size 18; echo "exit=$?"`; expected `exit=0`, the bar text visibly larger within 2 s, and a toast `Restart Foot to apply the new terminal font size`.
  * Type `omarchy display text size`; expected `text size: 18 px`, a GTK factor around 1.5, `terminal font: 14 pt`.
  * Press Super+Enter; the new terminal's font is visibly larger than the first one's.
  * Type `omarchy display text size 30; echo "exit=$?"`; expected `Size must be an integer between 9 and 20 (px).` + usage, `exit=1`; the bar does not change.
  * Type `omarchy display text size reset && omarchy display text size`; the bar returns to normal and the report reads `12 (default) px` / `1.0` / `9 pt`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare bar screenshots side by side; the clock and workspace labels grow noticeably at 18 px.
  * The already-open foot window keeps its old size (foot has no reload signal); only new windows show the change.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after/reset bar screenshots, the three reports, the `Restart Foot` toast, the larger second terminal, and the rejection
  * If unsuccessful
  ** a bar that does not re-flow, a report that does not match the value set, or a rejection that changed something anyway
covers: bin/omarchy-display-text-size

### monitor-state-report   [VM-PARTIAL]
description: `omarchy monitor state` feeds the shell's monitor panel with seven lines plus JSON; on the single virtual display the internal-monitor fields must be empty and the focused/JSON fields must name the one output (laptop branches not exercisable here).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy monitor state | cat -A; echo "exit=$?"`.
  ** Expected 8 lines ending in `$`: brightness (empty), internal name (empty), the only monitor (e.g. `Virtual-1`), empty, empty, the focused monitor (same name), a scaling value or empty, then a JSON array like `[{"name":"Virtual-1","enabled":true,"focused":true,"width":…,"height":…}]`; `exit=0`.
  * Type `omarchy monitor state | tail -n 1 | jq '.[0].enabled, .[0].focused'`; expected `true` twice.
  * Type `omarchy monitor --help`; expected `Monitor commands — Monitor status helpers:` with `omarchy monitor state`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `cat -A` makes the empty lines visible as a bare `$`.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the 8 `cat -A` lines, the two `true`s and the group help
  * If unsuccessful
  ** a jq/hyprctl error, fewer than 8 lines, or invalid JSON on the last line
covers: bin/omarchy-monitor-state; test/shell.d/monitor-state-test.sh

### cmd-predicates-and-terminal-cwd   [VM-OK]
description: `omarchy cmd present|missing` are the exit-code predicates behind every menu condition, and the hidden `cmd terminal cwd` is why Super+Enter opens a new terminal in the focused terminal's directory.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy cmd present bash jq; echo "exit=$?"`; expected `exit=0`.
  * Type `omarchy cmd present bash no-such-cmd-qa; echo "exit=$?"`; expected `exit=1`.
  * Type `omarchy cmd missing no-such-cmd-qa; echo "exit=$?"` then `omarchy cmd missing bash; echo "exit=$?"`; expected `exit=0` then `exit=1`.
  * Type `cd /tmp && omarchy cmd terminal cwd`; expected `/tmp`.
  * With that terminal focused press Super+Enter; in the new terminal type `pwd`; expected `/tmp`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the mouse over the first terminal before pressing Super+Enter so it is the focused window whose cwd is read.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the four exit codes, `/tmp` from `cmd terminal cwd`, and the second terminal's `pwd`
  * If unsuccessful
  ** the new terminal opening in `/home/prime` while the focused one was in `/tmp`
covers: bin/omarchy-cmd-present; bin/omarchy-cmd-missing; bin/omarchy-cmd-terminal-cwd; bin/omarchy-launch-terminal:6; default/hypr/bindings/applications.lua:2

### default-show-current-and-agent-unset   [VM-OK]
description: The `default` group's read side reports the stock defaults (browser chromium, editor nvim, terminal foot, no agent) and Setup → Defaults shows the ✓ on exactly those rows, with the Agent list entirely unchecked on a fresh install.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy default browser; omarchy default editor; omarchy default terminal; omarchy default agent; echo "agent-exit=$?"`; expected `chromium`, `nvim`, `foot`, nothing for the agent, `agent-exit=0` (record the words if the build differs).
  * Type `omarchy default --help`; expected `Default commands — Default application selection:` with four rows and their option lists.
  * Press Super+Space → Setup → Defaults → Browser; the ✓ is on `Chromium` only. Press Escape.
  * Setup → Defaults → Editor; ✓ on `Neovim` only. Escape.
  * Setup → Defaults → Terminal; ✓ on `Foot` only. Escape.
  * Setup → Defaults → Agent; NO ✓ on any row. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The ✓ is appended to the row label; zoom the screenshot if the glyph is small.
  * Do not click any row in these submenus — several would start an install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the four printed defaults and of each Defaults submenu with the ✓ where expected (none in Agent)
  * If unsuccessful
  ** a ✓ on the wrong row, two ✓ in one submenu, or a mismatch between CLI and menu
covers: bin/omarchy-default-browser:13-25; bin/omarchy-default-editor:14-22; bin/omarchy-default-terminal:13-24; bin/omarchy-default-agent:15-24; default/omarchy/omarchy-menu.jsonc:136-173

### default-set-editor-terminal-and-reject   [VM-OK]
description: Choosing an already-installed default — editor from the CLI, terminal from Setup → Defaults → Terminal — persists immediately with a toast and keeps the menu ✓ consistent, while unknown choices are refused without changing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy default editor nvim; echo "exit=$?"`; expected toast `Neovim is now the default editor`, `exit=0`; `cat ~/.local/state/omarchy/defaults/editor` prints `nvim`.
  * Press Super+Space → Setup → Defaults → Terminal → click `Foot`; expected toast `Foot is now the default terminal`, no installer window.
  * Type `cat ~/.config/xdg-terminals.list; omarchy default terminal`; expected two comment lines then `foot.desktop`, and `foot`.
  * Press Super+Enter; a foot window opens (`echo $TERM` shows `foot`).
  * Type `omarchy default editor bogus; echo "exit=$?"`; expected `Usage: omarchy-default-editor <code|cursor|zed|sublime_text|helix|vim|emacs|nvim>`, `exit=1`; the defaults file still reads `nvim`.
  * Type `omarchy default terminal bogus; echo "exit=$?"` and `omarchy default browser bogus; echo "exit=$?"`; the matching usage lines, `exit=1` each.
  * Press Super+Space → Setup → Defaults → Editor; `Neovim` still carries the ✓. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only click `Foot`/`Neovim`: Alacritty, Ghostty, Kitty, VSCode… are not installed and would start a package download.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both toasts, the file contents, the three usage refusals with `exit=1`, and the menu ✓
  * If unsuccessful
  ** a floating installer opening for an installed app, or the defaults file changed by a rejected value
covers: bin/omarchy-default-editor; bin/omarchy-default-terminal; bin/omarchy-default-browser; default/omarchy/omarchy-menu.jsonc:160-173; default/xdg-terminal-exec/hyprland-xdg-terminals.list; test/shell.d/default-apps-test.sh

### channel-menu-checked-and-set-rejects   [VM-OK]
description: Update → Channel marks the current channel with ✓, `omarchy channel set` refuses unknown channels before touching pacman, and the `dev` channel shows its warning and honours "No" — the only channel paths cheap enough to run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy channel current; grep -c omarchy.org /etc/pacman.d/mirrorlist`; note the word (normally `stable`) and the count.
  * Press Super+Space → Update → Channel; rows `Stable`, `RC`, `Edge`, `Dev` with the ✓ only on the row matching the word. Press Escape — select nothing.
  * Type `omarchy channel set bogus; echo "exit=$?"`; expected `Unknown channel: bogus`, `Usage: omarchy-channel-set [stable|rc|edge|dev]`, `exit=1`.
  * Type `omarchy channel set dev; echo "exit=$?"`; expected the warning `The dev channel links Omarchy directly to a checkout of the source in ~/omarchy.` … and `Switch to dev channel?` defaulting to No.
  * Press Enter (No); expected `Cancelled.`, `exit=0`.
  * Type `omarchy channel current; grep -c omarchy.org /etc/pacman.d/mirrorlist; ls ~/omarchy 2>&1 | head -n 1`; same word, same count, `No such file or directory`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never click Stable/RC/Edge or run `omarchy channel set stable|rc|edge`: each ends in a full `omarchy update -y` (network, many minutes).
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Channel submenu with a single ✓, the `Unknown channel` refusal, the dev warning + `Cancelled.`, and the unchanged word/count afterwards
  * If unsuccessful
  ** a ✓ on the wrong row, `set dev` proceeding without confirmation, or a sudo/pacman prompt after the refusal
covers: bin/omarchy-channel-set; bin/omarchy-channel-current; default/omarchy/omarchy-menu.jsonc:354,363-366; manual/30-updates.md

### reinstall-confirm-declined   [VM-OK]
description: `omarchy reinstall` is destructive (reinstalls packages and overwrites `~/.config`), so it must show its warning and do nothing at all when the confirmation is declined.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy reinstall --help | head -n 4`; help with `omarchy reinstall` and its summary, nothing runs.
  * Type `touch ~/.config/qa-sentinel && omarchy reinstall; echo "exit=$?"`; expected `This will reinstall all default Omarchy packages and reset default configs.`, `Warning: user config changes will be overwritten.`, then `Are you sure you want to reinstall and lose config changes?`.
  * Choose No (Right arrow then Enter, or `n`); expected the prompt returns with `exit=0`, no sudo prompt, no package output.
  * Type `ls ~/.config/qa-sentinel && omarchy version`; the sentinel exists and the version is unchanged.
  * Type `rm ~/.config/qa-sentinel`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm highlights `Yes` by default — move to `No` before pressing Enter.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the warning + confirm, the declined result, and the surviving sentinel with the unchanged version
  * If unsuccessful
  ** a pacman/sudo prompt after No, or the sentinel removed
covers: bin/omarchy-reinstall; manual/30-updates.md "Rolling back bad updates"

### upgrade-to-quattro-flags-and-decline   [VM-OK]
description: `omarchy upgrade to quattro` is a one-way system migration: flag validation fails before anything runs and the banner's confirm exits cleanly on "No", so a curious user cannot trigger it by accident.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy upgrade to quattro --help | head -n 2`; expected `Usage: omarchy-upgrade-to-quattro [--yes] [--reboot] [--dev] [--channel stable|rc|edge] [--user USER]`.
  * Type `omarchy upgrade to quattro --bogus; echo "exit=$?"`; expected red `Error: Unknown option: --bogus`, `exit=1`.
  * Type `omarchy upgrade to quattro --channel bogus; echo "exit=$?"`; expected `Error: Invalid channel 'bogus'. Use stable, rc, or edge.`, `exit=1`.
  * Type `omarchy upgrade to quattro --dev --channel stable; echo "exit=$?"`; expected `Error: --dev needs the edge package repo; use --channel rc or --channel edge.`, `exit=1`.
  * Type `omarchy upgrade to quattro; echo "exit=$?"`; the screen clears, a QUATTRO block-letter banner, `Upgrading Omarchy to Quattro is a one-way street!`, `You cannot downgrade from Quattro.`, `Make sure you have a backup.`, then `Continue with upgrade?`.
  * Choose No; expected `exit=0`, no sudo prompt, nothing else; `omarchy version` unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes and never pass `--yes`; if any green `==>` progress line appears, press Ctrl+C immediately and report.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three validation errors, the banner with its confirm, and the clean `exit=0` after No
  * If unsuccessful
  ** any `==>` line or sudo prompt after No, or a validation error arriving after the banner
covers: bin/omarchy-upgrade-to-quattro:1-175,334-353

### migrate-nothing-pending   [VM-OK]
description: On a stock install every shipped migration is already marked done: `--pending` exits 1 silently, `omarchy migrate` runs nothing, `migrate notify` stays quiet, and bad flags are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy migrate --pending; echo "exit=$?"`; expected no output, `exit=1`.
  ** If names print with `exit=0`, record them — the disk has pending migrations (HEAD/4.0.2 skew) — and continue.
  * Type `ls /usr/share/omarchy/migrations | wc -l; ls ~/.local/state/omarchy/migrations | wc -l`; equal counts when nothing is pending.
  * Type `omarchy migrate; echo "exit=$?"`; expected no `Running migration` line, `exit=0`.
  * Type `omarchy migrate notify; echo "exit=$?"`; expected no toast, no output, `exit=0`.
  * Type `omarchy migrate --bogus; echo "exit=$?"`; expected `Unknown option: --bogus`, `exit=1`.
  * Type `systemctl --user status omarchy-migrate-notify.service --no-pager | head -n 4`; the unit exists and is `inactive (dead)` after its login run.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy migrate` waits up to 15 min if pacman is running; if it prints `Waiting for pacman transaction…`, another process is updating — report it.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with `exit=1` for pending, equal counts, `exit=0` for run and notify, the refused flag, and the unit status
  * If unsuccessful
  ** a migration unexpectedly running, the pacman wait, or a failed unit
covers: bin/omarchy-migrate; bin/omarchy-migrate-notify; default/systemd/user/omarchy-migrate-notify.service; test/shell.d/migrate-wrapper-test.sh; test/shell.d/migrate-notify-test.sh

### migrate-fake-pending-notify-and-run   [VM-OK]
description: A pending migration is listed by `--pending`, announced by `omarchy migrate notify` as a critical clickable toast, executed exactly once by `omarchy migrate` with a green "Running migration" line, and then marked done.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `printf '#!/bin/bash\necho "hello from qa migration"\n' | sudo tee /usr/share/omarchy/migrations/9999999999.sh >/dev/null` (password `prime`).
  * Type `omarchy migrate --pending; echo "exit=$?"`; expected `9999999999.sh`, `exit=0`.
  * Type `omarchy migrate notify; echo "exit=$?"`; expected toast `Pending Omarchy Migrations` / `Click to run 1 pending migration.`, `exit=0` — screenshot at once.
  * Click the toast; a floating terminal shows the green logo, green `Running migration (9999999999)`, `hello from qa migration`, then `● Done! Press any key to close...`; press a key.
  ** If the toast already faded, type `omarchy migrate; echo "exit=$?"` instead and expect the same two lines with `exit=0`.
  * Type `omarchy migrate --pending; echo "exit=$?"; omarchy migrate; echo "exit=$?"`; expected `exit=1` (nothing pending) and a silent `exit=0` (nothing runs twice).
  * Type `sudo rm /usr/share/omarchy/migrations/9999999999.sh; rm ~/.local/state/omarchy/migrations/9999999999.sh` to restore the stock state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The toast is critical-urgency and stays a little longer than normal ones, but click it within a few seconds.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the pending name, the toast, the floating terminal with `Running migration (9999999999)` and `hello from qa migration`, and the `exit=1` / silent `exit=0` afterwards
  * If unsuccessful
  ** no toast (record `./client get-serial`), the migration running twice, or the marker not written
covers: bin/omarchy-migrate:58-103; bin/omarchy-migrate-notify; bin/omarchy-launch-floating-terminal-with-presentation

### sudo-passwordless-enable-disable   [VM-OK]
description: Setup → Security → Passwordless Sudo (`omarchy sudo passwordless`) warns, asks, grants NOPASSWD sudo with an expiry timer, and revokes it on the next run; "No" and bad arguments change nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo -n true; echo "exit=$?"`; expected `exit=1` (password required).
  * Type `omarchy sudo passwordless abc; echo "exit=$?"`; expected `Usage: omarchy-sudo-passwordless [MINUTES]`, `exit=1`.
  * Type `omarchy sudo passwordless; echo "exit=$?"`, enter `prime`; expected `Toggle passwordless sudo...`, the ⚠️ WARNING about `ANY command as root WITHOUT a password for 15 minutes`, and `Enable passwordless sudo for 15 minutes? This is a significant security risk!`. Choose No.
  ** Expected `Aborted. No changes made.`, `exit=0`; `sudo -k; sudo -n true; echo "exit=$?"` still `exit=1`.
  * Press Super+Space → Setup → Security → Passwordless Sudo; the floating terminal shows the same warning; choose Yes.
  ** Expected `Passwordless sudo has been ENABLED. It will automatically disable in 15 minutes.`, `A restart removes the passwordless sudo rule as well.`, then the Done prompt; press a key.
  * In the terminal type `sudo -k; sudo -n true; echo "exit=$?"; systemctl list-timers 'omarchy-nopasswd-expire-*' --no-pager`; expected `exit=0` and one timer ~15 min out.
  * Type `omarchy sudo passwordless; echo "exit=$?"`; expected `Passwordless sudo has been DISABLED. Sudo will require a password again.`, `exit=0`.
  * Type `sudo -k; sudo -n true; echo "exit=$?"`; expected `exit=1` — back to the stock state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo -k` drops the cached credential so `sudo -n true` is a real test of the NOPASSWD rule.
  * gum confirm highlights `Yes` first; use Right/Left then Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: the warning + No → Aborted, the menu-launched terminal with ENABLED, `sudo -n` exit 0 with the timer, the DISABLED message, and `sudo -n` exit 1
  * If unsuccessful
  ** `Failed to schedule passwordless sudo expiry. Revoking access now.`, or `sudo -n` still succeeding after DISABLED
covers: bin/omarchy-sudo-passwordless; default/omarchy/omarchy-menu.jsonc:185; test/shell.d/nopasswd-sudo-expiry-test.sh; manual/48-security.md

### sudo-passwordless-expires-on-timer   [VM-OK]
description: The passwordless grant must expire on its own: with `omarchy sudo passwordless 1` the NOPASSWD rule disappears after about a minute without any user action.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy sudo passwordless 1`; enter `prime`; the warning says `for 1 minutes`; choose Yes; expected `… automatically disable in 1 minutes.`
  * Type `sudo -k; sudo -n true; echo "exit=$?"`; expected `exit=0`.
  * Type `systemctl list-timers 'omarchy-nopasswd-expire-*' --no-pager`; one timer with NEXT within a minute.
  * Screenshot every 5 s for 90 s (no other input needed).
  * Type `sudo -k; sudo -n true; echo "exit=$?"`; expected `exit=1`.
  * Type `systemctl list-timers 'omarchy-nopasswd-expire-*' --no-pager`; expected `0 timers listed`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The timer has 1 s accuracy; 90 s is a comfortable margin.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of ENABLED with `1 minutes`, the timer, and after 90 s `sudo -n` failing and `0 timers listed`
  * If unsuccessful
  ** `sudo -n true` still exiting 0 after 90 s, or the timer still listed
covers: bin/omarchy-sudo-passwordless:16-27,60-67; etc/tmpfiles.d/omarchy-nopasswd-sudo.conf

### sudo-docker-and-keepalive   [VM-OK]
description: The hidden `omarchy sudo docker` predicate decides which Sudoless Docker row the Security menus show; on a stock account it says "needs sudo" now and as configured, refuses stray arguments, and `omarchy sudo keepalive` only asks for the password.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy sudo docker; echo "exit=$?"; omarchy sudo docker --configured; echo "exit=$?"`; expected `exit=0` twice.
  * Type `omarchy sudo docker --bogus; echo "exit=$?"`; expected `Usage: omarchy-sudo-docker [--configured]`, `exit=2`.
  * Press Super+Space → Setup → Security; a `Sudoless Docker` row is present. Escape. Then Remove → Security; NO `Sudoless Docker` row. Escape.
  * Type `omarchy sudo keepalive; echo "exit=$?"`; enter `prime`; the prompt returns at once with `exit=0`.
  * Type `pgrep -fc 'sudo -n true'`; expected `0` — the keepalive loop dies with the script (quirk: it only works when sourced).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Security submenus are under Setup and Remove in the root Omarchy menu (Super+Space).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the three exit codes, the two Security submenus, and the keepalive returning with `0` leftover loops
  * If unsuccessful
  ** `Sudoless Docker` in both menus or neither, or `--bogus` accepted
covers: bin/omarchy-sudo-docker; bin/omarchy-sudo-keepalive; default/omarchy/omarchy-menu.jsonc:186,302; test/shell.d/sudo-docker-test.sh

### dev-link-scratch-and-unlink   [VM-OK]
description: A developer points Omarchy at a checkout and back: `omarchy dev status` reports the stock install, `dev link <path> --no-reboot` writes `/etc/omarchy.conf` and the sudoers drop-in, status reports the link and session mismatch, and `dev unlink --no-reboot` restores everything — all without rebooting.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev status`; expected `dev-link: inactive` and `current shell:       OMARCHY_PATH=/usr/share/omarchy`, no `Note:` line.
  * Type `mkdir -p /tmp/fake-omarchy/{bin,default,shell} && omarchy dev link /tmp/fake-omarchy --no-reboot; echo "exit=$?"`; enter `prime`; expected `Pointed Omarchy at /tmp/fake-omarchy`, `sudo now resolves omarchy-* from /tmp/fake-omarchy/bin`, `exit=0`, and NO reboot question.
  * Type `cat /etc/omarchy.conf; sudo cat /etc/sudoers.d/omarchy-dev-path`; expected `export OMARCHY_PATH="/tmp/fake-omarchy"` and `Defaults secure_path="/tmp/fake-omarchy/bin:/usr/local/sbin:/usr/local/bin:/usr/bin"`.
  * Type `sudo true; omarchy dev status`; expected `dev-link: configured`, `/etc/omarchy.conf -> OMARCHY_PATH=/tmp/fake-omarchy`, `sudo resolves omarchy-* from: /usr/bin` (or `/usr/share/omarchy/bin`), `status: reboot required …`, `current shell: OMARCHY_PATH=/usr/share/omarchy`, and `Note: the running session does not match /etc/omarchy.conf. Reboot to settle it.`
  * Type `omarchy dev unlink --no-reboot; echo "exit=$?"`; expected `Pointed Omarchy at /usr/share/omarchy`, `exit=0`.
  * Type `cat /etc/omarchy.conf; sudo test -f /etc/sudoers.d/omarchy-dev-path; echo "sudoers=$?"; omarchy dev status`; expected `export OMARCHY_PATH="/usr/share/omarchy"`, `sudoers=1`, `dev-link: inactive` with a `(default guard)` line and no `Note:`.
  * Type `omarchy dev unlink --bogus; echo "exit=$?"`; expected `Usage: omarchy dev unlink [--no-reboot]`, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * SAFETY: never reboot while linked to the scratch directory and answer No to any `Reboot now to activate?`; always finish with the unlink step even if an earlier step failed.
  * `unknown (needs sudo)` in the status means the cached credential expired — run `sudo true` and repeat.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the stock status, the link output, both file contents, the configured status with the mismatch note, the unlink output, and the restored inactive status
  * If unsuccessful
  ** `Error: refusing to install an invalid … sudoers`, a status that does not follow the link, or a sudoers drop-in left behind after unlink
covers: bin/omarchy-dev-link; bin/omarchy-dev-unlink; bin/omarchy-dev-status; test/shell.d/dev-link-test.sh; test/shell.d/dev-unlink-test.sh

### dev-link-rejects-bad-input   [VM-OK]
description: `omarchy dev link` refuses a missing path, a wrong second argument, running under sudo, and shows help for the bare route — before writing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev link; echo "exit=$?"`; expected the router help (`omarchy dev link <path-to-checkout> [--no-reboot]`, `Binary: omarchy-dev-link`), `exit=0`, no sudo prompt.
  * Type `omarchy dev link /does/not/exist --no-reboot; echo "exit=$?"`; expected `Error: path does not exist: /does/not/exist`, `exit=1`, no sudo prompt.
  * Type `omarchy dev link /tmp --wrong; echo "exit=$?"`; expected `Usage: omarchy dev link <path-to-checkout> [--no-reboot]`, `exit=1`.
  * Type `sudo omarchy-dev-link /tmp --no-reboot; echo "exit=$?"` (password `prime`); expected `Error: run omarchy-dev-link as your user, not under sudo.`, `exit=1`.
  * Type `cat /etc/omarchy.conf 2>&1; omarchy dev status | head -n 1`; the conf is absent or `/usr/share/omarchy`, status `dev-link: inactive`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * None of these steps should ask for a password except the deliberate `sudo` one; a password prompt elsewhere means something is about to be written — press Ctrl+C and report.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the four refusals with exit codes and the unchanged conf/status
  * If unsuccessful
  ** an unexpected sudo prompt or a written `/etc/omarchy.conf`
covers: bin/omarchy-dev-link:10-13,26-60,81-84

### dev-benchmarks   [VM-OK] [SLOW]
description: The two developer benchmarks run to completion and print their timing tables: `dev benchmark cli` for router latency, `dev benchmark theme switcher` (also via its `theme-switcher` alias) for preview/thumbnail caches; `--repeat` is validated.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev benchmark cli --repeat=1; echo "exit=$?"`; expected `Omarchy CLI benchmark (1 runs each)` and 9 rows (`omarchy`, `omarchy --help`, `omarchy commands`, …, `omarchy theme current`) each with `avg … ms  min … ms  max … ms`, `exit=0`, no `failed (exit N)` row.
  * Type `omarchy dev benchmark cli --repeat=0; echo "exit=$?"`; expected `--repeat must be a positive integer`, `exit=2`.
  * Type `omarchy dev benchmark theme-switcher --repeat=1; echo "exit=$?"` and screenshot every 5 s (1–3 minutes on 2 vCPU).
  ** Expected `Theme switcher benchmark (1 warm runs each)`, rows `theme index cold/warm`, `selector prep cold/warm (lazy)`, `thumbnail cache cold/warm`, then `Theme previews: N` with N ≥ 10, `exit=0`.
  * Type `omarchy dev benchmark theme switcher --repeat=x; echo "exit=$?"`; expected `--repeat must be a positive integer`, `exit=2`.
  * Type `ls /tmp | grep -c '^tmp\.'`; the benchmark removed its temporary caches (count unchanged from before, typically `0`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The theme benchmark is CPU-bound and silent for long stretches; keep screenshotting, it has not hung until 5 minutes pass.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the 9 CLI rows, the theme-switcher table with `Theme previews: N`, and the two `--repeat` refusals
  * If unsuccessful
  ** a `failed (exit N)` row, a magick/`omarchy-menu-images` error, or a preview count of 0
covers: bin/omarchy-dev-benchmark-cli; bin/omarchy-dev-benchmark-theme-switcher; test/cli:235-236

### dev-theme-preview   [VM-OK]
description: `omarchy dev theme preview` renders a theme's palette (swatches, ramp, samples) for the current or a named theme, falls back to `#` swatches with `--no-color`, and fails cleanly for an unknown theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev theme preview --no-osc; echo "exit=$?"`; expected `Theme: …`, `File: /home/prime/.local/state/omarchy/current/theme/colors.toml`, `Mode: dark|light`, `foreground/background contrast: N:1`, a gradient bar, `Neutral ramp`, `Foundation`, `Selection sample`, `Terminal/UI samples`, `ANSI palette strips`, coloured swatches, `exit=0`.
  * Type `omarchy dev theme preview tokyo-night --no-osc | head -n 3`; expected `Theme: tokyo-night`, `File: /usr/share/omarchy/themes/tokyo-night/colors.toml`.
  * Type `omarchy dev theme preview "Tokyo Night" --no-color | grep -c '####'`; a count > 10 (plain swatches).
  * Type `omarchy dev theme preview no-such-theme-qa; echo "exit=$?"`; expected `Theme not found: no-such-theme-qa`, `exit=1`.
  * Type `omarchy dev theme preview a b; echo "exit=$?"`; expected the usage text, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep `--no-osc` on: without it the preview recolours this terminal's palette until it is closed, which would confuse later screenshots.
  * The first preview is ~40 lines; if it scrolls, add `| head -n 30`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the coloured preview, the tokyo-night header, the `#` swatch count, and the two refusals
  * If unsuccessful
  ** `Missing colors.toml`, empty swatches, or an `omarchy-theme-color` error
covers: bin/omarchy-dev-theme-preview; test/cli:431-437

### dev-font-list-and-add   [VM-OK]
description: `omarchy dev font list` enumerates the shipped icon font's private-use glyphs; `add` works into a writable copy but fails clearly (no corruption) against the package-owned font or a missing SVG.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-dev-font list | head -n 5; omarchy-dev-font list | wc -l`; rows like `U+E900  <glyph>  <name>  <W> x <H>` and a count ≥ 5.
  * Type `omarchy dev font; echo "exit=$?"`; the metadata declares required args, so the router help (`omarchy dev font [list|add] <name> …`) prints, `exit=0`.
  * Type `omarchy dev font add qa /nonexistent.svg; echo "exit=$?"`; a Python error naming `No such file or directory: '/nonexistent.svg'`, non-zero exit (record whether it is a raw traceback — that is a finding).
  * Type `printf '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>' > /tmp/sq.svg && omarchy dev font add qa /tmp/sq.svg; echo "exit=$?"`; expected `PermissionError` on `/usr/share/omarchy/default/fonts/omarchy/omarchy.ttf`, non-zero, and `omarchy-dev-font list | grep -c qa` prints `0`.
  * Type `cp /usr/share/omarchy/default/fonts/omarchy/omarchy.ttf /tmp/f.ttf && omarchy dev font add qa /tmp/sq.svg --font /tmp/f.ttf; echo "exit=$?"`; expected `Added qa as U+E9xx (…)` and a `Next:` list, `exit=0`; `omarchy dev font list --font /tmp/f.ttf | grep qa` shows the new row.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The glyphs render in the terminal only if the omarchy icon font is installed system-wide; a box glyph in the list is fine, the codepoint column is the proof.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the glyph list, the two failures with their exception text, and the successful add into the copied font
  * If unsuccessful
  ** the package font modified (`pacman -Qkk omarchy | grep omarchy.ttf`), or `list` failing on the stock font
covers: bin/omarchy-dev-font:456-482,552-649

### dev-add-migration-temp-repo   [VM-OK]
description: `omarchy dev add migration --no-edit` creates `migrations/<commit-time>.sh` in the checkout named by `OMARCHY_PATH`; on the packaged install (no git) it fails with git's error, and unknown flags are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev add migration --no-edit; echo "exit=$?"`; expected `fatal: not a git repository …`, non-zero exit (128).
  * Type `mkdir /tmp/repo && cd /tmp/repo && git init -q && git -c user.name=qa -c user.email=qa@x commit -q --allow-empty -m init && echo ok`; expected `ok`.
  * Type `OMARCHY_PATH=/tmp/repo omarchy dev add migration --no-edit; echo "exit=$?"`; expected `/tmp/repo/migrations/<10 digits>.sh`, `exit=0`; `ls /tmp/repo/migrations` shows it.
  * Type `OMARCHY_PATH=/tmp/repo omarchy dev add migration user --no-edit 2>&1 | head -n 1`; expected `omarchy-dev-add-migration: migration scopes are no longer used; creating a regular migration.`
  * Type `omarchy dev add migration --bogus; echo "exit=$?"`; expected `Unknown option: --bogus`, `Usage: omarchy-dev-add-migration [--no-edit]`, `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Without `--no-edit` the command opens nvim; if that happens, press Escape then type `:q!` Enter.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the git fatal on the packaged path, the created file path, the scope warning, and the refused flag
  * If unsuccessful
  ** nvim opening despite `--no-edit`, or a file created under `/usr/share/omarchy`
covers: bin/omarchy-dev-add-migration

### dev-pkg-test-missing-checkout   [VM-PARTIAL]
description: `omarchy dev pkg test` needs a local PKGBUILD tree the VM lacks; it must explain the missing checkout/PKGBUILD and show its help without attempting a build (the build itself is not runnable here).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev pkg test --help | head -n 2`; expected `Usage: omarchy dev pkg-test [package-name] [path-to-checkout]`.
  * Type `omarchy dev pkg test; echo "exit=$?"`; expected `Error: checkout not found at /home/prime/Work/omarchy/omarchy-installer`, `exit=1`, no sudo prompt.
  * Type `mkdir -p /tmp/co && omarchy dev pkg test omarchy /tmp/co; echo "exit=$?"`; expected `Error: PKGBUILD not found at /home/prime/Work/omarchy/omarchy-pkgs/pkgbuilds/omarchy-dev/PKGBUILD` and the `OMARCHY_PKGBUILDS_DIR` hint, `exit=1`.
  * Type `omarchy dev pkg-test 2>&1 | head -n 1`; the hyphenated spelling gives the same checkout error.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A `makepkg` or sudo prompt here would mean the guard failed — Ctrl+C and report.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the help and the two explanatory errors
  * If unsuccessful
  ** a makepkg/sudo prompt without a checkout, or an unhandled bash error
covers: bin/omarchy-dev-pkg-test:10-96

### dev-ui-preview-gallery   [VM-PARTIAL]
description: `omarchy dev ui preview [section]` summons the shell's component gallery; if the packaged shell ships the dev-gallery plugin the panel opens (and jumps to a section), otherwise the command must fail visibly rather than hang.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev ui preview; echo "exit=$?"`.
  ** Expected either a gallery panel of shell widgets (buttons, sliders, toggles…) with `exit=0`, or an `omarchy-shell` error naming `omarchy.dev-gallery`. Record which.
  * If the gallery opened, press Escape, then type `omarchy dev ui preview slider`; the gallery opens scrolled to the slider section. Escape again.
  * Type `omarchy dev ui preview --help | grep -A1 Usage`; expected `omarchy dev ui preview [section]`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The gallery is a shell overlay, not a window; if nothing appears within 3 s and no error printed, report a hang.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the gallery panel (and its slider section) or of the explicit shell error
  * If unsuccessful
  ** silence with no panel and no error
covers: bin/omarchy-dev-ui-preview

### dev-install-ydoo   [VM-OK] [NET]
description: `omarchy dev install ydoo` installs and enables ydotool for UI automation: it adds the user to `input` and writes the udev rule through polkit dialogs, installs the package (~1 MB), starts the user service and prints "ydotool is ready."
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev install ydoo; echo "exit=$?"`.
  ** Expected `Adding prime to the input group. You may need to log out and back in before this applies.` then a polkit password dialog on the desktop — click it, type `prime`, Enter.
  ** Then the `ydotool` install (a terminal sudo prompt may appear; enter `prime`), then a second polkit dialog for the udev rule — authenticate again.
  * Expected final line `ydotool is ready.`, `exit=0`.
  * Type `systemctl --user is-active ydotool.service; ls -l /dev/uinput; cat /etc/udev/rules.d/80-uinput.rules`; expected `active`, group `input` mode `crw-rw----`, and the `KERNEL=="uinput", GROUP="input"…` rule.
  * Type `omarchy dev install ydoo; echo "exit=$?"` again; no group message this time, at most one polkit prompt, and `ydotool is ready.` — idempotent.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Polkit dialogs are floating windows, not terminal prompts; move the mouse over them before typing.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, `ydotool is ready.`, and the service/device/rule checks
  * If unsuccessful
  ** `omarchy-dev-install-ydoo: ydotool.service did not start` with its status dump, or a pkexec authorization error
covers: bin/omarchy-dev-install-ydoo

### tui-install-launch-and-menu   [VM-OK]
description: A user adds a terminal app to the launcher: `omarchy tui install` (CLI form) writes a launcher that opens the command in a floating terminal, and the Install → TUI wizard prompts for the four fields and refuses empty ones.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy tui install "QA Top" btop float utilities-terminal; echo "exit=$?"; cat "$HOME/.local/share/applications/QA Top.desktop"`; expected `exit=0` and a file with `Name=QA Top`, `Exec=xdg-terminal-exec --app-id=TUI.float -e btop`, `Icon=utilities-terminal`.
  * Press Super+Alt+Space (Apps), type `QA Top`, Enter; a floating terminal running btop appears; press `q` to quit it.
  ** If the launcher does not list it yet, type `update-desktop-database ~/.local/share/applications` in the terminal, wait 5 s, retry, and record that it was needed.
  * Press Super+Space → Install → TUI; a floating terminal prints `Let's create a TUI shortcut you can start with the app launcher.` and `Name>`; press Enter on the empty Name, Enter on the empty Launch Command, pick `float`, Enter on the empty Icon.
  ** Expected `You must set app name, app command, and icon URL/name!` then red `● Failed (exit code 1)! Press any key to close...`; press a key.
  * Repeat Install → TUI with Name `QA Tile`, Launch Command `btop`, style `tile`, Icon `utilities-terminal`; expected `You can now find QA Tile using the app launcher (SUPER + SPACE)` and the green Done prompt.
  * Type `grep Exec "$HOME/.local/share/applications/QA Tile.desktop"`; expected `--app-id=TUI.tile -e btop`.
  * Type `omarchy tui remove all` to remove both launchers again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum input fields accept typed text and Enter; gum choose uses Up/Down + Enter.
  * Use an installed icon name, never a URL, to avoid a download.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the desktop file, btop in a floating window, the empty-field failure, the interactive success message, and the tile Exec line
  * If unsuccessful
  ** the launcher not finding `QA Top`, btop opening tiled, or the wizard accepting empty fields
covers: bin/omarchy-tui-install; default/omarchy/omarchy-menu.jsonc:214

### tui-remove-single-all-and-none   [VM-OK]
description: Removing terminal-app launchers: `omarchy tui remove <name>` deletes one with a toast, Remove → TUI appears only while launchers exist and offers a picker, `tui remove all` sweeps every `TUI.*` launcher, and removal with nothing installed says so.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy tui install "QA One" btop float utilities-terminal && omarchy tui install "QA Two" btop tile utilities-terminal && ls ~/.local/share/applications/ | grep QA`; both `.desktop` files listed.
  * Press Super+Space → Remove; a `TUI` row is present; click it; a `Select TUI to remove` picker lists `QA One` and `QA Two`; press Escape (cancel) — both files remain.
  * Type `omarchy tui remove "QA One"; echo "exit=$?"`; expected toast `TUI removed` / `QA One`, `exit=0`, only `QA Two.desktop` left.
  * Type `omarchy tui remove all; echo "exit=$?"`; expected `Scanning for TUIs in /home/prime/.local/share/applications...`, `Removing TUI: QA Two`, `TUIs removed successfully.`, `exit=0`.
  * Type `omarchy tui remove all; echo "exit=$?"; omarchy tui remove; echo "exit=$?"`; expected `No TUIs found.` / `exit=0`, then `No TUIs to remove.` / `exit=1`.
  * Press Super+Space → Remove; NO `TUI` row now. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The `TUI remove all` route always wins over a launcher literally named "all" — irrelevant here but do not name a test launcher "all".
  * Screenshot right after the remove command to catch the toast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the `TUI removed` toast, the remove-all transcript, the two "none" messages, and the Remove menu without a TUI row
  * If unsuccessful
  ** a launcher surviving `remove all`, or the Remove → TUI row visible with nothing installed
covers: bin/omarchy-tui-remove; bin/omarchy-tui-remove-all; default/omarchy/omarchy-menu.jsonc:295

### snapshot-create-and-unknown-subcommand   [VM-OK]
description: `omarchy snapshot create` takes a numbered Snapper snapshot per config labelled with the Omarchy version and says it can be picked at boot; an unknown sub-command currently exits 0 silently, which this test records as a finding.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo snapper list-configs` (password `prime`); record the configs (typically `root`).
  * Type `sudo snapper -c root list | tail -n 2`; note the highest snapshot number.
  * Type `omarchy snapshot create; echo "exit=$?"`; expected green `Create system snapshot`, `Snapshots can be selected during boot.`, `exit=0`.
  ** With no configs instead: yellow `No Snapper configs found, so no snapshot was created.` plus the `snapper.sh` hint, `exit=1` — record as an environment finding.
  * Type `sudo snapper -c root list | tail -n 2; omarchy version`; a new row whose description equals the version (e.g. `4.0.2-1`).
  * Type `omarchy snapshot bogus; echo "exit=$?"`; current behaviour is no output and `exit=0` — record it; a usage error would be the expected behaviour, so report the silent success.
  * Type `omarchy-snapshot; echo "exit=$?"`; expected `Usage: omarchy-snapshot <create|restore>`, `exit=1` (the router shows help for the bare route; the binary itself refuses).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `snapper list` tables are wide; if they wrap, add `| cut -c1-100`.
  * The snapshot is left in place on purpose — it is what the update flow would leave too.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the configs, the create banner, the new snapper row with the version description, and the `bogus` outcome with its exit code
  * If unsuccessful
  ** a snapper error, `exit=127` (snapper missing — record `pacman -Q snapper`), or no new row
covers: bin/omarchy-snapshot; manual/47-system-snapshots.md; test/shell.d/snapshot-create-test.sh

### snapshot-restore-opens-and-cancels   [VM-PARTIAL]
description: `omarchy snapshot restore` hands off to `limine-snapper-restore`; from a normal boot it must start (asking for sudo) and be cancellable without changing anything — an actual restore needs a snapshot boot from Limine and is not attempted.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy snapshot restore`; enter `prime` at the sudo prompt.
  * Screenshot what `limine-snapper-restore` shows — a snapshot picker/confirmation, or a message that the system is not booted from a snapshot.
  * Do NOT confirm any restore: press Escape / Ctrl+C / answer No until the prompt returns; type `echo "exit=$?"` and record it.
  * Type `omarchy version; sudo snapper -c root list | tail -n 1`; both unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a picker highlights a snapshot, the safe key is Escape; never press Enter on a highlighted row.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of limine-snapper-restore's screen and the unchanged version/snapshot list after cancelling
  * If unsuccessful
  ** `limine-snapper-restore: command not found`, or a restore that proceeded without confirmation
covers: bin/omarchy-snapshot:46-48; manual/47-system-snapshots.md

### screensaver-start-from-system-menu   [VM-OK]
description: System → Screensaver launches the fullscreen terminal screensaver (black background, animated Omarchy text, hidden cursor) and any key or mouse input returns the desktop exactly as it was.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a reference screenshot of the desktop.
  * Press Super+Escape (System menu) and click `Screensaver` with the mouse.
  ** Within 3 s the screen turns black and animated block-letter text appears with a random effect; the cursor is hidden. Take 3 screenshots 2 s apart to show the animation changing.
  * Press Space; the screensaver closes and the desktop is back with the cursor visible.
  * Open a terminal and type `hyprctl clients -j | jq '[.[] | select(.class=="org.omarchy.screensaver")] | length'; pgrep -c ttfx || echo none`; expected `0` and `none`.
  * Press Super+Space → System → Screensaver again; this time move the mouse instead of pressing a key; the screensaver must exit too.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A toast `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` means the default terminal is something else — report it.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the black animated screensaver (≥2 different frames), the restored desktop, and the `0`/`none` checks
  * If unsuccessful
  ** the unsupported-terminal toast, a screensaver ignoring input, or a leftover ttfx process
covers: bin/omarchy-screensaver; bin/omarchy-launch-screensaver; default/omarchy/omarchy-menu.jsonc:36; default/hypr/bindings/utilities.lua:8

### screensaver-toggle-and-force   [VM-OK]
description: Trigger → Toggle → Screensaver flips the screensaver's availability with `Screensaver disabled/enabled` toasts; while disabled the plain launcher refuses but System → Screensaver (force) still works.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger → Toggle → Screensaver; expected toast `Screensaver disabled`.
  * Open a terminal with Super+Enter and type `omarchy-launch-screensaver; echo "exit=$?"`; nothing happens, `exit=1`.
  * Press Super+Escape → Screensaver; the screensaver still starts (forced); press Space to leave it.
  * Press Super+Space → Trigger → Toggle → Screensaver; expected toast `Screensaver enabled`.
  * Type `omarchy-launch-screensaver; echo "exit=$?"`; the screensaver starts; press Space; `exit=0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot immediately after each toggle click — the toast fades in seconds.
  * The Toggle submenu is under Trigger in the root Omarchy menu (Super+Space).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both toasts, the `exit=1` refusal while disabled, the forced screensaver, and the launcher working again afterwards
  * If unsuccessful
  ** a toggle toast without the matching state change, or the forced launch refusing
covers: bin/omarchy-toggle-screensaver; bin/omarchy-launch-screensaver:8-11; bin/omarchy-screensaver; default/omarchy/omarchy-menu.jsonc:36,93

### screensaver-direct-run-exits-immediately   [VM-OK]
description: Running `omarchy screensaver` in an ordinary terminal is not a supported entry point: it paints black, hides the cursor and exits within about a second because the focused window is not the screensaver window, restoring the cursor on the way out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `time omarchy screensaver; echo "exit=$?"`; screenshot at once and again after 3 s.
  ** Expected: the terminal background turns black (maybe a brief ttfx frame), then the prompt returns with `real` ≈ 1–2 s and `exit=0`.
  ** Quirk: the black background is never reset, so this terminal may stay black until closed.
  * Move the mouse; the cursor is visible again.
  * Type `pgrep -c ttfx || echo none`; expected `none`.
  * Type `omarchy screensaver --help | grep -A1 Binary`; expected `omarchy-screensaver` — the router help, not a screensaver run.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the terminal stays fully black with animation for more than 5 s, press Space to exit and report it.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the brief black terminal, the timing under ~2 s with `exit=0`, the visible cursor and `none`
  * If unsuccessful
  ** a screensaver running in the terminal > 5 s, or an invisible cursor afterwards
covers: bin/omarchy-screensaver:5-14,38-48

### screensaver-idle-autostart   [VM-OK] [SLOW]
description: With the default idle settings the screensaver starts on its own after 150 s without input (the lock follows at 300 s); a key press dismisses it and returns the unlocked desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the desktop and note the time; then send no keys or mouse events at all.
  * Take a screenshot every 5 s; between about 150 s and 170 s the screen goes black and the animated screensaver text appears.
  * As soon as it is visible (and before 290 s elapse) press Space; the desktop reappears — not the lock screen.
  * Open a terminal and type `omarchy debug idle 30 | grep -A1 'Screensaver detector'`; expected `stopped`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `./client get-image` is not guest input; do not move the mouse or the idle timer restarts.
  * If nothing appears by 200 s, type `omarchy debug idle 40 | sudo tee /dev/ttyS0 >/dev/null`, read get-serial and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot timestamps proving the black animated screen appeared ~150 s after the last input, and the desktop after Space
  * If unsuccessful
  ** the lock screen appearing first, or no screensaver by 200 s plus the serial `omarchy debug idle` dump
covers: shell/plugins/services/idle/Service.qml:17-23,69; bin/omarchy-launch-screensaver; bin/omarchy-screensaver

### reminder-set-fire-and-reject   [VM-OK]
description: `omarchy reminder <minutes> [message]` confirms with a toast, arms a user timer visible in the bar, and fires a `Reminder` toast at the right time; zero, non-numeric and malformed `show` arguments print usage.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy reminder 1; echo "exit=$?"`; screenshot at once; expected toast `Reminder set for 1 minutes` / `You'll be reminded at HH:MM`, `exit=0`.
  * Type `omarchy reminder 2 "Check the oven"`; expected toast `Check the oven in 2 minutes`; then `systemctl --user list-timers 'omarchy-reminder-*' --no-pager` lists two timers; a reminder indicator is visible in the bar.
  * Screenshot every 5 s: at ~60 s a toast `Reminder` / `Your 1 minutes are up`; at ~120 s `Reminder` / `Check the oven`.
  * Type `systemctl --user list-timers 'omarchy-reminder-*' --no-pager`; expected `0 timers listed`; the bar indicator is gone.
  * Type `omarchy reminder 0; echo "exit=$?"`, `omarchy reminder abc; echo "exit=$?"`, `omarchy reminder show --bogus; echo "exit=$?"`; each prints the 4-line usage and `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts fade in a few seconds — the 5 s cadence while waiting is what catches the fired reminders.
  * The bar indicator shows the reminder count; it appears near the other status indicators.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both confirmation toasts, the timer list and bar indicator, both fired `Reminder` toasts, the empty timer list, and the three usage refusals
  * If unsuccessful
  ** a `systemd-run` error, a reminder not fired within 30 s of its time, or an indicator that stays after firing
covers: bin/omarchy-reminder:135-201; shell/plugins/bar/indicators/Reminder.qml

### reminder-show-clear-hotkeys-and-menu   [VM-OK]
description: `Super+Ctrl+Alt+R` shows upcoming reminders (or "No outstanding reminders"), `Super+Shift+Ctrl+R` clears them with a toast, the Trigger → Reminder submenu offers Set one / Show all / Clear all, and `show --json` feeds the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Alt+R; expected toast `Upcoming reminders` / `No outstanding reminders`.
  * Open a terminal with Super+Enter and type `omarchy reminder 5 "QA five"; omarchy reminder 9`.
  * Press Super+Ctrl+Alt+R; expected toast `Upcoming reminders` with `QA five in 4m 5Xs (HH:MM)` and `9-min reminder in 8m 5Xs (HH:MM)`.
  * Type `omarchy reminder show --json | jq '.count, .tooltip, .reminders[0].label'`; expected `2`, `"2 reminders"`, `"QA five"`.
  * Press Super+Space → Trigger → Reminder; rows `Set one`, `Show all`, `Clear all`; click `Show all`; the same two-line toast.
  * Press Super+Shift+Ctrl+R; expected toast `All reminders have been cleared`; `omarchy reminder show --json | jq .count` prints `0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Both hotkeys need three modifiers held together; send them as one combo (e.g. `<M-C-A-r>`, `<M-S-C-r>`).
  * Screenshot right after each hotkey — toasts fade quickly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty show toast, the two-line show toast, the jq values, the submenu, and the cleared toast with count `0`
  * If unsuccessful
  ** a hotkey with no toast, wrong remaining times, or timers surviving `clear`
covers: bin/omarchy-reminder:45-133; default/hypr/bindings/utilities.lua:90-91; default/omarchy/omarchy-menu.jsonc:57,83-85

### reminder-interactive-panel   [VM-OK]
description: Trigger → Reminder → Set one (`omarchy reminder -i`) opens the shell reminder panel: it asks for minutes then a message, rejects non-numeric minutes with a toast, and sets the reminder like the CLI.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger → Reminder → Set one; a panel prompts `Remind in minutes`.
  * Type `abc` and press Enter; expected toast `Invalid reminder` / `Enter the number of minutes` (record whether the panel stays open).
  * Reopen if needed, type `3`, Enter; the prompt becomes `Reminder message`; type `Tea`, Enter; expected toast `Tea in 3 minutes` / `You'll be reminded at HH:MM`.
  * Open a terminal with Super+Enter and type `omarchy reminder show --json | jq -r '.reminders[].label'`; expected `Tea`.
  * Type `omarchy reminder -i; echo "exit=$?"`; the same panel opens from the CLI; press Escape; `exit=0`.
  * Type `omarchy reminder clear`; toast `All reminders have been cleared` — nothing left pending.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The panel is a shell overlay with a single text field; keys go to it while it is open, no click needed.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the minutes prompt, the invalid toast, the message prompt, the confirmation toast, the jq label and the cleared toast
  * If unsuccessful
  ** no panel (record `./client get-serial`), or a reminder set with `abc` minutes
covers: bin/omarchy-reminder:41-43,143-146; shell/plugins/reminders/ReminderFlow.qml; default/omarchy/omarchy-menu.jsonc:83

### mise-install-wrapper-and-reject   [VM-OK]
description: `omarchy mise install <pkg> [cmd [bin]]` writes an executable mise wrapper into `~/.local/bin` with the exact 4-line body and refuses command names that would escape the directory or look like options.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy mise install; echo "exit=$?"`; expected the router help (`omarchy mise install <package> [command-name [bin-name]]`), `exit=0`.
  * Type `omarchy mise install qa-tool; echo "exit=$?"; cat ~/.local/bin/qa-tool; ls -l ~/.local/bin/qa-tool`; expected `exit=0`, the body `#!/bin/bash` / `export MISE_MINIMUM_RELEASE_AGE=0` / `mise use -g --quiet "qa-tool" || exit 1` / `exec mise x "qa-tool" -- "qa-tool" "$@"`, and an executable bit.
  * Type `omarchy mise install npm:@scope/pkg qa-cmd qa-bin && cat ~/.local/bin/qa-cmd`; expected `mise use -g --quiet "npm:@scope/pkg"` and `exec mise x "npm:@scope/pkg" -- "qa-bin" "$@"`.
  * Type `omarchy mise install pkg ../evil; echo "exit=$?"`; expected `omarchy-mise-install: '../evil' is not usable as a command name`, `exit=1`; `ls ~/.local/evil 2>&1` → No such file.
  * Type `omarchy mise install pkg -flag; echo "exit=$?"; omarchy mise install pkg .hidden; echo "exit=$?"`; both refused, `exit=1`.
  * Type `rm ~/.local/bin/qa-tool ~/.local/bin/qa-cmd` to leave `~/.local/bin` as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run the wrapper: it would call `mise use -g qa-tool` and go to the network for a package that does not exist.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both wrapper bodies, the executable bit, and the three refusals
  * If unsuccessful
  ** a wrapper written outside `~/.local/bin`, or a name with `..` accepted
covers: bin/omarchy-mise-install; test/shell.d/mise-install-test.sh

### openclaw-onboard-without-openclaw   [VM-PARTIAL]
description: `omarchy openclaw onboard` wraps OpenClaw's setup wizard; without the `openclaw` binary it must fail fast with a visible "command not found" instead of hanging in its gateway watch loop (the full wizard needs OpenClaw installed plus a provider sign-in and is not run).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy cmd present openclaw; echo "exit=$?"`; expected `exit=1`. If `exit=0`, stop and report — this test assumes OpenClaw is absent.
  * Type `time omarchy openclaw onboard; echo "exit=$?"`; expected within ~3 s a line ending `openclaw: command not found` and `exit=127`.
  * Type `omarchy openclaw --help`; expected `Openclaw commands — OpenClaw agent platform setup:` with `omarchy openclaw onboard`.
  * Type `ls ~/.openclaw 2>&1`; expected `No such file or directory`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the command sits silent for more than 10 s, press Ctrl+C and report a hang (the watch loop running without a wizard).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `command not found` line with `exit=127` and the `real` time, plus the group help and the absent `~/.openclaw`
  * If unsuccessful
  ** a silent hang > 10 s, or files created under `~/.openclaw`
covers: bin/omarchy-openclaw-onboard; bin/omarchy:29-97 (openclaw group)

## Gaps

Behaviours found but not turned into runnable driver tests here (with reason):

- **Full channel switch** (`omarchy channel set stable|rc|edge`, Update → Channel → …): ends in `omarchy update -y` — network-heavy (hundreds of MB), well over 10 minutes on this VM, and may leave `reboot-required`. Only validation/cancel paths are tested. [VM-NO/SLOW/NET]
- **`omarchy channel set dev` accepted**: clones the full omarchy repository into `~/omarchy` (large, NET) then dev-links and updates. [VM-NO]
- **`omarchy reinstall` accepted / `reinstall pkgs` / `reinstall configs`**: reinstalls the whole base package set and overwrites `$HOME` configs; > 10 min and NET. Only the decline path is tested. [VM-NO]
- **`omarchy upgrade to quattro` accepted**: needs a legacy 3.x install to be meaningful; on 4.0.2 it would re-run every step (NET, SLOW, reboot). Only flags and the banner decline are tested. [VM-NO]
- **`omarchy openclaw onboard` full wizard**: needs OpenClaw installed (Install → AI → OpenClaw, large) and an interactive provider sign-in the driver cannot complete. [VM-NO]
- **`omarchy default agent <name>` / browser / editor / terminal for software not yet installed**: opens a floating install terminal; `mise`/npm downloads for agents are large (Codex/Claude ≥ 100 MB), browsers and terminals ≥ 50 MB. Feasible as [NET][SLOW] tests but likely to exceed the budget on this link; deferred to the install-* reviewer.
- **`omarchy debug` → "Upload log"**: the option is hidden because ICMP is blocked in the VM; the upload path itself is covered indirectly by `upload-log-installed-and-rejects`.
- **`omarchy upload log install`**: `/var/log/omarchy-install.log` may exist on a minted disk; the ISO-time `/mnt` branch cannot be exercised post-install.
- **`omarchy monitor state` laptop branches** (internal eDP name, enabled-internal, mirror source) and `omarchy-monitor-state`'s brightness line: no internal panel or backlight in QEMU. [VM-NO]
- **`omarchy display text size` for alacritty/kitty/ghostty configs and kitty's `USR1` reload**: only foot is installed; the code paths need the other terminals present.
- **`omarchy cmd terminal cwd` kitty-socket branch**: needs kitty as the default terminal.
- **`omarchy installed service tailscale|dropbox` positive path**: needs the services installed and running. [NET]
- **`omarchy dev pkg test` build**: needs `~/Work/omarchy/omarchy-installer` and the `omarchy-pkgs` PKGBUILD tree; a multi-minute makepkg. [VM-NO]
- **`omarchy dev link` to a real checkout + reboot**: cloning omarchy is NET/SLOW; rebooting into a linked checkout is a legitimate developer flow but would need the clone. The scratch-directory link/unlink test covers the file-writing contract.
- **`omarchy dev font add` from a URL** (`https://simpleicons.org/...`): NET; the local-SVG path into a copied font is covered.
- **`omarchy snapshot restore` executed**: requires booting a snapshot from the Limine menu and confirming `limine-snapper-restore`; long and destructive. Only the open/cancel is tested. [VM-NO]
- **Snapshot selection at boot** (manual 47): Limine menu interaction after a reboot; belongs with the boot/limine reviewer.
- **`omarchy transcode` video → mp4/gif**: needs a source video (none on the disk; generating one with ffmpeg is possible but 4k/1080p encodes on 2 vCPU are slow). Picture paths are covered.
- **`omarchy transcode` via Nautilus context menu** (`default/nautilus-python/extensions/transcode.py`): belongs to the file-manager reviewer.
- **`omarchy file select --multiple`** result formatting with several files: feasible, folded out to keep the dialog test short.
- **`omarchy-sudo-keepalive` when sourced** (`source omarchy-sudo-keepalive`): the only mode in which the loop survives; a shell-scripting detail rather than a user flow.
- **`omarchy hook theme-set` / `font-set` firing from real theme/font changes**: the hook runner is covered; wiring through `omarchy-theme-set`/`omarchy-font-set` belongs to the theme/font reviewers.
- **`omarchy migrate` pacman-lock wait** ("Waiting for pacman transaction to finish…" up to 15 min): would require holding `/var/lib/pacman/db.lck`; simulating it risks the time budget.
- **Router route-collision reporting** (`omarchy commands --check` failing): needs two binaries claiming one route; cannot add files to `/usr/share/omarchy/bin` without root, and doing so on the installed system is artificial (covered by `test/cli` upstream).
