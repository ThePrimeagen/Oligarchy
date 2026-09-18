# 61 — docs, plans, maintainer skills, shipped agent skills, CI and meta

Reviewer scope: the architecture references (`docs/`), the four feature plans (`plans/`), the maintainers' own task guides (`agents/skills/`), the skills Omarchy ships to the user's AI agents (`default/agents/skills/`), the repo-level agent/contributor files, `.github/`, and the meta files. Every stated invariant is treated as a contract and, where a driver can observe it from the desktop, turned into a test. Source tree: `/tmp/omarchy-review/omarchy` @ HEAD 2026-09-18 (`version` = `4.0.0.alpha`; the minted disk is the 4.0.2 ISO, so a few HEAD-only behaviours are flagged as such).

## Scope

Read completely (line counts from `wc -l`):

| Area | Files | Lines |
|---|---|---|
| `docs/` | `audio-tuning.md` 158, `cli-router.md` 130, `file-layout.md` 369, `menu.md` 167, `notifications.md` 199, `omarchy-shell.md` 395, `testing.md` 137, `theming.md` 391, `update-process.md` 336 | 2282 |
| `plans/` | `backup.md` 133, `dots.md` 206, `remote.md` 140, `server.md` 85 | 564 |
| `agents/skills/` | `acceptance-tests.md` 46, `command-metadata.md` 31, `icon-font.md` 75, `install-scripts.md` 20, `migrations.md` 172, `shell-dev.md` 47, `visual-verification.md` 44 | 435 |
| `default/agents/skills/omarchy/` | `SKILL.md` 294 + topic guides `hyprland.md` 76, `plugins.md` 52, `theming.md` 79, `hooks.md` 28, `capture.md` 60, `contributing.md` 65 | 654 |
| `default/agents/skills/diagnose-crash/` | `SKILL.md` 128, `reporting.md` 104 | 232 |
| repo root | `AGENTS.md` 133, `CLAUDE.md` 1 (`@AGENTS.md`), `README.md` 79, `version` 1, `icon.txt` 26, `logo.txt` 10, `.editorconfig` 9, `.luarc.json` 11, `.gitignore` 4 | 274 |
| `.github/` | `SECURITY.md` 47, `ISSUE_TEMPLATE/bug.yml` 24, `ISSUE_TEMPLATE/config.yml` 8. **There is no `.github/workflows/` directory — the repo has no CI.** | 79 |
| AI integration (read to see how an agent is opened and how the crash flow is wired) | `bin/omarchy-agent`, `omarchy-agent-crash`, `omarchy-agent-prompt`, `omarchy-default-agent`, `omarchy-crash-watch`, `omarchy-crash-mute`, `omarchy-toggle-crash-capture`, `default/systemd/user/omarchy-crash-watch.service`, `config/opencode/opencode.json`, `config/herdr/config.toml`, heads of `omarchy-launch-editor`, `omarchy-launch-terminal-herdr`, `omarchy-launch-openclaw` | — |

Also consulted (read-only, to resolve planned-vs-shipped and to pin exact strings for proofs): `bin/omarchy` (`GROUP_DESCRIPTIONS`, `dispatch_fast_or_help`, `show_main_help`), `bin/omarchy-menu`, `bin/omarchy-theme-set` (staging + `post_theme_commands`), `bin/omarchy-theme-install`, `bin/omarchy-notification-send` (`--exec` checks), `bin/omarchy-update-pacman-guard`, `bin/omarchy-migrate`, `bin/omarchy-migrate-notify`, `bin/omarchy-update-restart`, `bin/omarchy-update-confirm`, `bin/omarchy-reminder`, `bin/omarchy-hook*`, `bin/omarchy-done`, `bin/omarchy-refresh-config`, `bin/omarchy-provision-user` (skill symlink loop), `bin/omarchy-install-service-sunshine`, `bin/omarchy-plugin-add/remove`, `bin/omarchy-bar`, `bin/omarchy-audio-tuning`, `default/omarchy/omarchy-menu.jsonc` (root ids, `trigger.toggle.crash-capture`, `setup.default.agent.*`, install rows), `default/hypr/bindings/utilities.lua`, `install/omarchy-base.packages`, `themes/`, `default/themed/`, `test/shell.d/crash-capture-test.sh`, `manual/17-ai.md` §Crash diagnosis. `bin/omarchy commands --check` was run against the checkout (read-only): `Command metadata check passed (456 commands)`.

Skipped: nothing in scope. `manual/` chapters are other reviewers' except where a doc in my scope points at one to define a contract.

## Inventory

Format: `ID — behaviour — source`. Groups by source. Every line is a user-reachable behaviour or a stated invariant a driver can observe.

#### CLI router (`docs/cli-router.md`, `bin/omarchy`, `agents/skills/command-metadata.md`)

- CLI-01 — `omarchy` bare and `omarchy --help`/`-h` print "Omarchy command center", a "Common commands" block (update, theme list, theme set, font list, screenshot, debug), a "Groups:" table driven only by `GROUP_DESCRIPTIONS` (69 entries at HEAD), and a "Discovery:" block — `bin/omarchy:518-547`.
- CLI-02 — `apply` and `provision` deliberately have no `GROUP_DESCRIPTIONS` entry (install-time plumbing); they still route and `omarchy apply` prints a header without a description — `docs/cli-router.md:100-107`, `AGENTS.md:40`.
- CLI-03 — `GROUP_DESCRIPTIONS[finalize]="Finalize user setup"` exists but **no binary is in group `finalize`** (no `omarchy-finalize-*`, no `# omarchy:group=finalize`); `omarchy finalize` → "Unknown Omarchy command", exit 127 — verified against checkout. `docs/file-layout.md:39-40` says `omarchy-provision-user` is "routed as `omarchy finalize user`" and the binary's own usage prints `Usage: omarchy finalize user`, but its header carries only `summary`+`hidden`, so the real route is `omarchy provision user`. `agents/skills/install-scripts.md:10` names a nonexistent `bin/omarchy-finalize-user`. Three-way drift.
- CLI-04 — Stem after `omarchy-` splits at the first hyphen into group/name; further hyphens become spaces (`omarchy-hw-asus-rog` → `omarchy hw asus rog`); single-segment stem is its group's root — `docs/cli-router.md:14-17`.
- CLI-05 — Two routes per command: canonical (after metadata) and filename (all hyphens → spaces). Both resolve. `# omarchy:name=` (empty) makes a group root: `omarchy share` canonical, `omarchy menu share` filename route — `docs/cli-router.md:19-30`, `bin/omarchy-menu-share:4-5`.
- CLI-06 — Aliases (`# omarchy:alias=`) register as routes flagged alias; listings show them in an alias table (e.g. `omarchy screenshot`) — `docs/cli-router.md:29-30,111-112`.
- CLI-07 — Hidden (`# omarchy:hidden=true`, 76 of 458 binaries at HEAD) still dispatch and answer `--help`; only omitted from `omarchy commands` and group help, which then prints "No documented commands found. Try: omarchy commands --all" — `docs/cli-router.md:33-37`, `bin/omarchy:820`.
- CLI-08 — Metadata parsed from the first 80 lines up to the first non-comment line; malformed `omarchy:` lines and unknown keys are ignored (degrade to filename route) — `docs/cli-router.md:39-45`, `command-metadata.md:6-7`.
- CLI-09 — Longest-prefix resolution; dropped words become the binary's argv. Fast path probes hyphen-joined filenames; metadata fallback for moved routes and aliases — `docs/cli-router.md:48-65`.
- CLI-10 — `--help`/`-h` **anywhere** in leftovers shows help and never executes (`omarchy update aur --help` must not start an update). `--` ends the scan. `--json` with `--help` prints the JSON record — `docs/cli-router.md:66-74`.
- CLI-11 — A command with required `args` (non-bracketed) invoked bare prints help instead of running (`omarchy theme set`) — `docs/cli-router.md:76-80`, `bin/omarchy:1038-1044`.
- CLI-12 — Bare group with children prints group help "`<Group> commands — <description>:`" — `bin/omarchy:799-822`.
- CLI-13 — Dispatch is `exec`; exit code is the binary's; router exits 127 on unknown route / missing binary with "Unknown Omarchy command: …", optional "Did you mean: omarchy <x> ?", and "Run 'omarchy commands --all' to discover available commands." — `bin/omarchy:1032-1070`.
- CLI-14 — Prefix listing: `omarchy hw asus` prints every command whose usage starts with that prefix — `docs/cli-router.md:86-87`, `bin/omarchy:824-841`.
- CLI-15 — `omarchy commands` (non-hidden + alias table), `--all`, `--markdown`, `--json` (route, binary, group, name, summary, flags, args, examples, aliases, `filename_route`, `routes`), `--check` (lint: collisions, missing explicit `summary`, `hidden`/`requires-sudo` must be `true` or absent, missing/non-executable binary) — `docs/cli-router.md:109-126`.
- CLI-16 — Metadata keys: `group`, `name`, `summary`, `args`, `examples` (` | ` separated), `alias`/`aliases`, `hidden=true`, `requires-sudo=true` — `command-metadata.md:9-18`.
- CLI-17 — `GROUP_DESCRIPTIONS[agent]="AI coding agent usage data"`, yet `omarchy agent` launches the default coding agent and `omarchy agent crash`/`prompt` are diagnosis/prompt entry points; the description covers only the `usage-*` leaves — `bin/omarchy:29`, `bin/omarchy-agent:3`.

#### File layout / provisioning (`docs/file-layout.md`, `agents/skills/install-scripts.md`)

- FL-01 — `$OMARCHY_PATH` is `/usr/share/omarchy` on a production install; `/etc/omarchy.conf` exists only after `omarchy dev link`; `bin/omarchy-*` on `PATH` as `/usr/bin/omarchy-*` with symlinks in `/usr/share/omarchy/bin/` — `docs/file-layout.md:68-69,165-176`.
- FL-02 — Env bootstrap sourced by `/etc/profile.d/omarchy.sh`, `~/.bashrc`, uwsm `env.d/10-omarchy`; idempotent — `docs/file-layout.md:181-190`.
- FL-03 — `omarchy-provision-user` (hidden) symlinks every `default/agents/skills/<name>/` into `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.gemini/config/skills`, `~/.hermes/skills`, and existing `~/.hermes/profiles/*/skills`; never creates Hermes profiles — `docs/file-layout.md:211`, `bin/omarchy-provision-user:87-101`.
- FL-04 — Provision sets `xdg-settings default-web-browser chromium.desktop`, `mailto` → `HEY.desktop`, runs `xdg-user-dirs-update`, `omarchy-refresh-applications` — `docs/file-layout.md:212-218`.
- FL-05 — Idempotency markers `~/.local/state/omarchy/done/finalize-user` and `done/first-run-user`, managed by hidden `omarchy-done check|mark|ensure <name>` — `docs/file-layout.md:224,296-303`.
- FL-06 — First-run enables user units: `bt-agent`, `omarchy-sleep-lock`, `omarchy-recover-internal-monitor`, `omarchy-migrate-notify`, `omarchy-fcitx5`, `omarchy-crash-watch`; `ConditionPath*` keeps inapplicable ones inert — `docs/file-layout.md:275-283`.
- FL-07 — First-run shows the keybindings welcome toast (click opens cheatsheet) and Wi-Fi/update toasts after `omarchy-notification-wait` — `docs/file-layout.md:288-294`.
- FL-08 — `omarchy-reinstall-configs` = `cp -af /etc/skel/. ~/` then `omarchy-refresh-limine`, `-plymouth`, nvim refresh; destructive, no backup — `docs/file-layout.md:328-345`.
- FL-09 — Current theme state under `~/.local/state/omarchy/current/` (`theme/`, `theme.name`, `background`); `~/.config/omarchy/` reserved for user-versioned files (themes, hooks, shell layout, plugins, themed overrides) — `docs/file-layout.md:56-60`.
- FL-10 — Kitty system config `/etc/xdg/kitty/kitty.conf` with `allow_remote_control socket-only`; user file only carries the theme include — `docs/file-layout.md:366-369`.
- FL-11 — `etc-overrides/` files (`.bashrc`, `nsswitch.conf`, `faillock.conf`, `cups-browsed.conf`, `plymouthd.conf`) are `cp -f`'d by the settings package scriptlet; user edits clobbered on upgrade — `docs/file-layout.md:145-155`.
- FL-12 — `plocate-updatedb` drop-in: `updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` — `docs/file-layout.md:159`.
- FL-13 — Branding: `logo.txt`/`icon.txt` → `~/.config/omarchy/branding/{about,screensaver}.txt` and `/usr/share/omarchy/` — `docs/file-layout.md:136-139`.
- FL-14 — `omarchy-refresh-config <path>` copies `$OMARCHY_PATH/config/<path>` → `~/.config/<path>` with `.bak.<epoch>` backup and diff; the argument is only `[[ -e ]]`-checked so `..` escapes `~/.config` (documented known defect) — `AGENTS.md:126-131`, `bin/omarchy-refresh-config`.

#### Menu (`docs/menu.md`)

- MN-01 — Menu content = `default/omarchy/omarchy-menu.jsonc` overlaid by `~/.config/omarchy/extensions/omarchy-menu.jsonc`; both watched; edits apply without shell restart — `docs/menu.md:3-8`.
- MN-02 — JSONC = whole-line `//` comments + trailing commas only; an inline trailing comment breaks the parse; a broken user file silently contributes zero entries while the shipped menu keeps working — `docs/menu.md:15-19`.
- MN-03 — Dotted id is the tree; kind inferred (`action` → action, `target` → link, else submenu); `label` defaults to id; `title` header; `aliases` are compat-only, searchable — `docs/menu.md:22-49`.
- MN-04 — Merge per key: reusing a shipped id overrides only declared fields and keeps position; new ids append; the shipped user extension sample is comments-only — `docs/menu.md:52-61`.
- MN-05 — Guards `when` (hide), `checked` (✓), `disabled` (dim + ✓ + unselectable, skipped by cursor/Enter/search); Install rows use `disabled: omarchy-pkg-present …`, Remove rows use `when:`; guards batched in one bash per open, so a row may lag one open behind reality — `docs/menu.md:63-98`.
- MN-06 — Providers `apps` (AppLibrary; app rows searchable but never routable — `Super+Escape` must still open System), `fonts`, `power-profiles` (tab-delimited `label\tvalue\tcurrent`); `volatile` re-runs on entry — `docs/menu.md:100-127`.
- MN-07 — CLI: `omarchy menu` (toggle root), `toggle <route>`, `summon <route>`, `close`, `refresh`, `ping`; unknown verb → "omarchy-menu: unknown verb '<v>'. Try 'omarchy menu --help'." exit 2 — `bin/omarchy-menu`.
- MN-08 — Route = id or alias, case-insensitive, `_`→`-`; exact id beats alias; empty/`go`/`menu` = root; unknown string tried as literal id; summoning an action alias runs it; link followed — `docs/menu.md:146-152`.
- MN-09 — Default bindings: `Super+Space` root, `Super+Alt+Space` apps, `Super+Escape` system, `Super+Ctrl+C` capture, `Super+Ctrl+O` toggle, `Super+Ctrl+H` hardware, `Super+Ctrl+Space` background, `Super+Shift+Ctrl+Space` theme, `Super+Ctrl+S` share, `Super+Ctrl+R` reminder-set, `Super+K` keybindings — `default/hypr/bindings/utilities.lua:1-18,85-89`.
- MN-10 — `omarchy-menu-select`/`-input` = dmenu modes; cancel exits 1; `glyph\tlabel\tsubtext` rows — `docs/menu.md:156-167`.
- MN-11 — Root ids: `apps`, `learn`, `trigger`, `style`, `setup`, `install`, `remove`, `update`, `about`, `system` — `omarchy-menu.jsonc:24-33`. Crash Capture lives at `trigger.toggle.crash-capture`; default agent picker at `setup.default.agent.*` (14 agents, `checked` via `omarchy-default-agent`) — `omarchy-menu.jsonc:92,137-151`.

#### Notifications (`docs/notifications.md`)

- NT-01 — The shell owns `org.freedesktop.Notifications`; no dunst/mako; toasts stack top-right — `docs/notifications.md:3-8`.
- NT-02 — Lifetime: low ≥5 s, normal ≥8 s, critical forever; `expire_timeout` stretches to ≤30 s; hover pauses; content update restarts; left-click = default action, right-click/close button = dismiss — `docs/notifications.md:16-21`.
- NT-03 — Every popup mirrored to `~/.local/state/omarchy/notifications/<ts>-<id>.json`; survives `omarchy-update`'s shell restart; on leaving screen moved to `history/` trimmed to 10; `showHistory` replays that dir — `docs/notifications.md:23-30`.
- NT-04 — DND: `dnd` in `~/.local/state/omarchy/notifications.json`; `omarchy-shell notifications toggleDnd|setDnd|dndState`; `omarchy-toggle-notification-silencing`; bar Dnd indicator — `docs/notifications.md:40-46`.
- NT-05 — Bypass DND: `app_name=omarchy-action`, or critical **and** `app_name=notify-send`. Silenced non-ephemeral → history; ephemeral (transient hint, or app_name notify-send/omarchy-action) dropped — `docs/notifications.md:48-61`.
- NT-06 — `omarchy-notification-send` flags: `-g/--glyph`, `--exec <prog> [args…]` (last), `--image`, `-i/--icon`, `--app-name` (default `omarchy-action`), `-u` (default `low`; else "Unknown urgency"), `-t`; unknown flag → "Unknown option" hard error — `docs/notifications.md:64-88`, `bin/omarchy-notification-send:133-145`.
- NT-07 — `--exec` is argv; a lone quoted string with whitespace is refused: "--exec takes the command as separate words, not one quoted string." — `docs/notifications.md:102-125`, `bin/omarchy-notification-send:167-174`.
- NT-08 — Helpers: `omarchy-notification-wait [timeout]`, `-dismiss <summary>`, `-time`, `-battery`, `-weather` (toggles weather panel) — `docs/notifications.md:149-158`.
- NT-09 — Hotkeys: `Super+,` dismissOne, `Super+Shift+,` dismissAll, `Super+Ctrl+,` toggle silencing, `Super+Alt+,` invokeLast, `Super+Shift+Alt+,` showHistory; `Super+Ctrl+Alt+T` time, `+B` battery, `+W` weather — `utilities.lua:25-29,93-95`.
- NT-10 — Crash capture: `omarchy-crash-watch` follows the coredump journal, waits for the server, sends a **critical** toast "Process crashed: <name>" / "Click to diagnose with AI" with `--exec omarchy-agent-crash <pid> <comm> <exe> <signal>`, deduped 60 s per program — `docs/notifications.md:170-175`, `bin/omarchy-crash-watch`.
- NT-11 — Pending migrations: critical toast "Click to run N pending migration(s)." whose click opens a terminal running `omarchy-migrate` — `docs/notifications.md:176-179`, `bin/omarchy-migrate-notify:23-26`.
- NT-12 — Reminders: `omarchy reminder <min> [msg]` → transient user timer `omarchy-reminder-<min>m-<epoch>`; `show [--json]`, `clear`, `-i` overlay; bar Reminder indicator — `docs/notifications.md:182-199`, `bin/omarchy-reminder:3-5`.

#### Shell (`docs/omarchy-shell.md`, `agents/skills/shell-dev.md`)

- SH-01 — One Quickshell process; `omarchy-launch-shell`/`omarchy-restart-shell`; `omarchy-shell <target> <method>` forwards IPC and **fails with "omarchy-shell is not running"** when the shell is down; `-q` quiet; `OMARCHY_SHELL_IPC_TIMEOUT` (default 2 s) — `docs/omarchy-shell.md:3-10`, `bin/omarchy-shell:58-65`.
- SH-02 — Manifest fields `schemaVersion`, `id`, `name`, `version`, `kinds` (`bar-widget|bar|panel|overlay|menu|service`), `entryPoints`; `keepLoaded`; one full bar at a time; fallback to `omarchy.bar` — `docs/omarchy-shell.md:12-41`.
- SH-03 — `omarchy plugin add <git-url> [--enable] [--yes]` warns "Plugins run as arbitrary, unsandboxed code…", confirms, clones to `~/.config/omarchy/plugins/<id>/` **disabled**; `update` shows diff then fast-forwards; `remove` confirms; `enable`/`disable`/`clone`; Setup › Plugins offers Enable/Disable/Add/Clone/Remove; without a confirmation channel they refuse ("refusing to continue without confirmation; pass --yes") — `docs/omarchy-shell.md:50-89`, `bin/omarchy-plugin-add:32,106`.
- SH-04 — Clone of `omarchy.clock` → `~/.config/omarchy/plugins/<username>.clock/` named "My Clock", bar switches to it; removing an active clone switches back; saving files hot-reloads — `docs/omarchy-shell.md:66-71`.
- SH-05 — `omarchy bar use|reset|defaults|position|transparent|put|move|set` with `--section`/`--index`/`--after` — `docs/omarchy-shell.md:87-89`, `bin/omarchy-bar:5-6`.
- SH-06 — IPC `shell` target methods: `ping`, `summon`, `hide`, `toggle`, `togglePanelAt`, `call`, `rescanPlugins`, `reloadConfig`, `applyTheme`, `toggleBarTransparency`, `setPluginEnabled` (only literal `"true"` enables), `enablePlugin`, `putBarWidget`, `moveBarWidget`, `setBarWidget`, `listPlugins`, `listShellConfig`, `debugBarGeometry`; answers on stdout exit 0 with `ok`/`unknown`/error — `docs/omarchy-shell.md:91-122`.
- SH-07 — `shell.json` rules 1-8 (`version: 1` required; `bar.id`; one entry per plugin instance; inline settings; `disabledPlugins[]`; `idle.screensaver`/`idle.lock` in seconds); no deep merge once user file exists; hot-reloads — `docs/omarchy-shell.md:124-168`.
- SH-08 — Machine-level `~/.config/omarchy/shell.toml` is watched live and wins over the theme's `shell.toml`, so `omarchy display text size` survives theme switches — `docs/omarchy-shell.md:170-174`.
- SH-09 — `[font] base-size` rescales every token; floor 1 px; font family is the fontconfig `monospace` alias set by `omarchy font set` — `docs/omarchy-shell.md:310-353`.
- SH-10 — Custom bar modules `type: command` (text or Waybar JSON) and `type: qml` from `~/.config/omarchy/bar/modules/` — `docs/omarchy-shell.md:371-395`.

#### Theming (`docs/theming.md`, shipped `theming.md` guide)

- TH-01 — Stock themes (22 at HEAD): catppuccin, catppuccin-latte, ethereal, everforest, flexoki-light, gruvbox, hackerman, kanagawa, last-horizon, lumon, lupine, matte-black, miasma, nord, osaka-jade, retro-82, ristretto, rose-pine, solitude, tokyo-night, vantablack, white — `themes/`.
- TH-02 — Activation: stage at `~/.local/state/omarchy/current/next-theme` (copy stock → overlay user theme (filtered if `.git` present) → derive `colors.toml` from `alacritty.toml` if needed → `omarchy-theme-set-templates` → move to `current/theme`, write `theme.name`, IPC `applyTheme`) under a `flock` — `docs/theming.md:20-29,46`, `bin/omarchy-theme-set:296-361`.
- TH-03 — Templates only when `colors.toml` staged; existing files never overwritten by a template; user templates `~/.config/omarchy/themed/*.tpl` win over built-ins — `docs/theming.md:31-38`.
- TH-04 — Built-in templates (19): `alacritty.toml`, `btop.theme`, `chromium.theme`, `claude.json`, `foot.ini`, `ghostty.conf`, `gum_env.lua`, `helix.toml`, `hermes.yaml`, `hyprland.lua`, `hyprland-preview-share-picker.css`, `keyboard.rgb`, `kitty.conf`, `neovim.lua`, `obsidian.css`, `pi.json`, `shell.toml`, `t3code.json`, `vscode-theme.json` — `default/themed/`.
- TH-05 — After activation: `theme-set` hook (`~/.config/omarchy/hooks/theme-set*`, `$1` = slug) then parallel `post_theme_commands` (17): restart-terminal, restart-hyprctl, restart-btop, restart-opencode, restart-helix, theme-set-foot, -tmux, -gnome, -pi, -claude, -hermes, -t3code, -browser, -vscode, -obsidian, -keyboard — `docs/theming.md:40-45`, `bin/omarchy-theme-set:363-386`.
- TH-06 — Installed-from-git denylist: `*.lua`, `alacritty.toml`, `foot.ini`, `ghostty.conf`, `kitty.conf`, `vscode.json`, and all symlinks are dropped and named on stderr; colour files kept; `.git` dir is the discriminator; user-written themes stage in full — `docs/theming.md:49-65`.
- TH-07 — `omarchy theme install` takes git URLs only (gum prompt when bare; URL vetted by `omarchy-git-url-check`; name = basename minus `omarchy-`/`-theme`) — `docs/theming.md:64`, `bin/omarchy-theme-install`.
- TH-08 — `omarchy-theme-set` errors: bare → "Usage: omarchy-theme-set <theme-name>"; `.`-prefixed or slashed → "Invalid theme name"; missing → "Theme '<n>' does not exist" exit 1 — `bin/omarchy-theme-set:8,283-290`.
- TH-09 — `colors.toml` canonical keys and legacy aliases (`bg`/`fg`…); `urgent` key ignored (comes from `red`/`color1`); `omarchy dev theme-preview` — `docs/theming.md:69-129`.
- TH-10 — Placeholders `{{ k }}`, `{{ k_strip }}`, `{{ k_rgb }}`, `mix*`, `hypr_gradient`/`shell_gradient`/`gradient_start` — `docs/theming.md:131-176`.
- TH-11 — `shell.toml` sections and `shell.<section>.toml` partial override; border/width/alpha grammar; `[controls]` states; `[spacing]`, `[font]`, `[bar]` — `docs/theming.md:178-320`.
- TH-12 — Shipped guide: `omarchy theme list|current|set <name>|bg next|install <url>`; "Tokyo Night" and "tokyo-night" both accepted; overlay (same slug, only changed files) vs fork (new slug); `omarchy font list|current|set` — `default/agents/skills/omarchy/theming.md`.

#### Update process (`docs/update-process.md`, `agents/skills/migrations.md`)

- UP-01 — `omarchy update` pipeline order: transcript to `/tmp/omarchy-update.log` → `omarchy-update-lock` → free-space check (10 GiB, `OMARCHY_UPDATE_FORCE=1` bypass) → confirm unless `-y` (gum "Ready to update?" / "Continue with update?" → "Update cancelled") → pkg-prune → snapper snapshot → stay-awake → packages, migrations, hooks, log analysis → update-status → stay-awake stop → `omarchy-update-restart` (reboot prompts for kernel/Hyprland/`reboot-required`; `restart-*-required` markers; **always** `omarchy-restart-shell`) — `docs/update-process.md:116-154`, `bin/omarchy-update-restart:26-51`.
- UP-02 — `-y` exports `OMARCHY_UPDATE_UNATTENDED=1`; prompting steps skip — `docs/update-process.md:145-147`.
- UP-03 — Pacman guard hook `00-omarchy-update-guard.hook` aborts `pacman -Syu`-shaped transactions with "Woah partner…" unless `OMARCHY_UPDATE_PACMAN=1` (Omarchy flows) or `OMARCHY_ALLOW_DIRECT_PACMAN=1` (explicit bypass) — `docs/update-process.md:64-104`, `bin/omarchy-update-pacman-guard`.
- UP-04 — Settings-package hooks pause/resume Hyprland live reload and force one `hyprctl reload` — `docs/update-process.md:105-112`.
- UP-05 — `omarchy-migrate` waits for pacman, runs pending migrations, no `--force`; `--pending` prints names and exits 0 when any pending, prints nothing and exits non-zero otherwise; bad flag → "Usage: omarchy-migrate [--pending]" — `docs/update-process.md:58-61`, `bin/omarchy-migrate`.
- UP-06 — Migration state `~/.local/state/omarchy/migrations/<file>`; fresh install marks all shipped migrations applied; every user gets every migration; idempotent; strictly ordered — `migrations.md:22-32,128-129`.
- UP-07 — Login notifier `omarchy-migrate-notify.service` after `graphical-session.target`; silent while the update lock is held; never runs migrations in the background; compat alias `omarchy-update-user-notify.service` — `docs/update-process.md:159-224`.
- UP-08 — `omarchy-update-available` exit 0 = updates (stdout list), non-zero = up to date; bar `omarchy.system-update` polls on start + every 6 h; click launches `omarchy-update` in a floating terminal — `docs/update-process.md:227-249`.
- UP-09 — `omarchy-channel-set <stable|rc|edge|dev>`; `omarchy-version` from `pacman -Q` or `dev (<hash>)`; `omarchy-version-channel` — `docs/update-process.md:251-263`.
- UP-10 — Migration authoring rules: `0644`, no shebang, first line `echo`, `$OMARCHY_PATH`, idempotent, never restart the shell; `omarchy-dev-add-migration --no-edit` — `migrations.md:120-137`.
- UP-11 — `omarchy update` runs `omarchy-hook post-update` after migrations; hooks dirs `battery-low.d`, `font-set.d`, `post-boot.d`, `post-update.d`, `pre-refresh-pacman.d`, `theme-set.d`; `omarchy hook install <type> <file>` — `default/agents/skills/omarchy/hooks.md`, `bin/omarchy-hook-install`.

#### Audio tuning (`docs/audio-tuning.md`)

- AU-01 — `omarchy audio tuning on|off|status` (+ `match`, `fronted-sink` for hooks); `on` no-ops when already linked, `--force` re-applies; refuses while EasyEffects runs; verifies sink `omarchy_speaker_tuning` and rolls back on failure — `docs/audio-tuning.md:36-50,149-152`.
- AU-02 — Machines with no matching tuning are untouched; applied at first-run via `install/user/first-run/audio-tuning.sh`; service `omarchy-speaker-tuning.service` — `docs/audio-tuning.md:25-27`.
- AU-03 — Fronted physical sink hidden from the output switcher; volume keys resolve through `omarchy-audio-output-sink` — `docs/audio-tuning.md:130-148`.

#### Plans — planned vs shipped (`plans/*.md` vs `bin/`, `manual/`, menu)

- PL-01 — **backup** (`plans/backup.md`): nothing shipped. No `bin/omarchy-backup-*`, no `omarchy-setup-backup`, no `GROUP_DESCRIPTIONS[backup]`, no `omarchy-backup.timer`, no `shell/plugins/panels/backup`, no Setup › Backup menu row, `restic` not in package lists. `omarchy backup` → Unknown, exit 127.
- PL-02 — **dots** (`plans/dots.md`): nothing shipped. No `bin/omarchy-dots-*`, no `dots` group, no `~/.local/share/omarchy/dots.git`; `.bak.<ts>` refresh behaviour (which the plan keeps) is what exists. `omarchy dots` → Unknown.
- PL-03 — **remote** (`plans/remote.md`): only the pre-plan bootstrap exists — `omarchy install service sunshine` / `omarchy remove service sunshine` (routes resolve; `manual/26-gaming.md:67` advertises it). Phase 1 is **not** shipped: installer still appends `o.launch_on_start("sunshine")` to `autostart.lua` (the double-start the plan calls out), still opens the admin webapp with `--ignore-certificate-errors`, no `omarchy-sunshine-pair|clients|mode|display`, no `sunshine` group, no `install.service.sunshine`/`remove.service.sunshine`/`setup.sunshine` menu rows, no ufw/Tailscale cross-call. `moonlight-qt` is preinstalled (`omarchy-base.packages:81`).
- PL-04 — **server** (`plans/server.md`): nothing shipped. No `omarchy-edition*`, no `omarchy-server-menu`, no `server` group, no `install/omarchy-server.packages`, no `/etc/omarchy-edition`. `omarchy server` → Unknown.

#### Maintainer skills (`agents/skills/*.md`) — contracts observable on an install

- MS-01 — Every `bin/omarchy-*` has an explicit `# omarchy:summary=`; `omarchy commands --check` is the lint (passes at HEAD, 456 commands) — `command-metadata.md`, `docs/testing.md:17-19`.
- MS-02 — Acceptance suite runs only in a disposable VM; screenshots `success-<step>.png` / `failure-<step>.png`; global Hyprland keybinds must be proven with QMP virtual keyboard, not `wtype` — `acceptance-tests.md:35-47`.
- MS-03 — Visual verification: `omarchy capture screenshot fullscreen save` prints the saved path (Pictures dir); `omarchy screenrecord --fullscreen` / `--stop-recording` prints the video path — `visual-verification.md:12-33`.
- MS-04 — Icon font `omarchy.ttf` at `/usr/share/fonts/omarchy/`; menu entries with `"iconFont":"omarchy"` (codex, cursor-agent, grok, hermes, omp, openclaw, opencode, ori, pi) must render a glyph, not a tofu box; `omarchy dev font list|add` — `icon-font.md`.
- MS-05 — Install scripts: `omarchy-apply-system`, `omarchy-apply-hardware` (hidden `apply` group), leaves sourced without shebang, `$OMARCHY_INSTALL`/`$OMARCHY_PATH` — `install-scripts.md` (note the stale `omarchy-finalize-user` name, CLI-03).
- MS-06 — Shell dev: `quickshell -n -p` single instance; `omarchy-restart-shell` after QML edits; `omarchy-shell` is canonical IPC and does not start the shell — `shell-dev.md`.
- MS-07 — Migrations: manual `omarchy-migrate` always safe; re-run by deleting a marker; tests keep `omarchy-migrate`, notifier, `omarchy-upgrade-to-quattro` — `migrations.md:78-165`.

#### Shipped agent skill `omarchy` (`default/agents/skills/omarchy/**`) — every rule is a user-reachable behaviour

- SK-01 — Frontmatter triggers: editing `~/.config/hypr/`, `~/.config/omarchy/`, terminal configs; themes, backgrounds, night light, idle, lock, screenshots, reminders, "user-facing omarchy commands"; excludes `omarchy dev` work — `SKILL.md:1-37`.
- SK-02 — Topic guides linked: `hyprland.md`, `plugins.md`, `theming.md`, `hooks.md`, `capture.md`, `contributing.md` — all six exist next to `SKILL.md` — `SKILL.md:40-49`.
- SK-03 — Never modify `/usr/share/omarchy/`; reading is encouraged (`cat $(which omarchy-theme-set)`, `cat "$OMARCHY_PATH/config/omarchy/shell.json"`); safe locations `~/.config/`, `~/.config/omarchy/themes/<name>/`, `~/.config/omarchy/hooks/` — `SKILL.md:51-80`.
- SK-04 — Privilege: `sudo` when a terminal is available, `pkexec` only when not — `SKILL.md:84-93`, `AGENTS.md:66-70`.
- SK-05 — Command discovery: `omarchy commands [--all|--json]`, `omarchy <group> --help`, `omarchy <cmd> --help` (does not execute) — `SKILL.md:109-130`.
- SK-06 — Groups table: `refresh`, `restart`, `toggle`, `theme`, `bar`, `plugin`, `hook`, `install`, `launch`, `capture`, `reminder`, `pkg`, `setup`, `update` with examples (`omarchy refresh shell`, `omarchy restart shell`, `omarchy toggle nightlight`, `omarchy theme set <name>`, `omarchy bar move omarchy.clock --section right`, `omarchy plugin clone omarchy.clock`, `omarchy hook install theme-set <script>`, `omarchy install docker dbs`, `omarchy launch browser`, `omarchy capture screenshot`, `omarchy reminder 15 "Pickup Jack"`, `omarchy pkg add <pkg>`, `omarchy setup security fingerprint`, `omarchy update`) — `SKILL.md:132-151`.
- SK-07 — Config locations: terminals (`alacritty.toml`, `foot.ini`, `kitty.conf`, `ghostty/config`) applied by `omarchy restart terminal`; btop, fastfetch (`/etc` default + user override), lazygit, starship, git — `SKILL.md:153-178`.
- SK-08 — Edit pattern: read → backup `*.bak.$(date +%s)` → edit → apply (Hyprland auto-reload **plus** `hyprctl reload` + `hyprctl configerrors`; shell.json and user plugins hot-reload; menu jsonc hot-reloads; terminals via `omarchy restart terminal`) — `SKILL.md:180-200`.
- SK-09 — `omarchy refresh <app>` requires user confirmation; backs up, copies from `$OMARCHY_PATH/config/`, restarts where needed — `SKILL.md:202-215`.
- SK-10 — System commands: `omarchy update`, `omarchy version`, `omarchy debug --no-sudo --print` (**always** these flags), `omarchy system lock|shutdown|reboot` — `SKILL.md:217-228`.
- SK-11 — Troubleshooting: `omarchy refresh config <path relative to ~/.config>`, `omarchy reinstall` (nuclear) — `SKILL.md:230-246`.
- SK-12 — Decision framework: stock command → config edit in `~/.config` → theme overlay → hooks → `omarchy pkg add` / `omarchy pkg aur add` → `omarchy plugin clone` → `omarchy commands` — `SKILL.md:248-258`.
- SK-13 — Reminders: `omarchy reminder <min> [msg]`, `show`, `clear` — `SKILL.md:260-269`.
- SK-14 — Worked examples: `omarchy theme set catppuccin`; `o.rebind`/`o.bind` in `bindings.lua`; `monitors.lua`; `looknfeel.lua`; `omarchy toggle nightlight` + `hyprsunset.conf` + `omarchy restart hyprsunset`; overlay `colors.toml`; `omarchy hook install theme-set`; clone `omarchy.workspaces`; `idle.lock` 600 in `shell.json`; `omarchy refresh shell`; `omarchy screenrecord --fullscreen`/`--stop-recording` — `SKILL.md:278-294`.
- SK-15 — `hyprland.md`: file map (`hyprland.lua`, `bindings.lua`, `monitors.lua`, `input.lua`, `looknfeel.lua`, `autostart.lua`, `hyprsunset.conf`, `xdph.conf`); `omarchy refresh hyprland`; `omarchy refresh hyprsunset`; `omarchy menu keybindings --print`; `o.rebind` replaces, `hl.unbind` removes; `hyprctl monitors all`; window rules must be fetched from the wiki, `o.window(match, rules)` helper — `hyprland.md`.
- SK-16 — `plugins.md`: `shell.json` hot-reload; `omarchy restart shell` / `omarchy refresh shell`; `omarchy bar move …`; `omarchy plugin clone omarchy.workspaces` → `~/.config/omarchy/plugins/<username>.workspaces/`; `omarchy-shell shell rescanPlugins` — `plugins.md`.
- SK-17 — `hooks.md`: six hook dirs; `omarchy hook install <name> <script>` copies + chmod; flat `hooks/<name>` file runs first — `hooks.md`.
- SK-18 — `capture.md`: `omarchy screenshot`; `omarchy capture screenshot region|windows|fullscreen save`; `OMARCHY_SCREENSHOT_DIR`; `omarchy screenrecord --fullscreen|--stop-recording|--with-desktop-audio|--with-microphone-audio|--with-webcam|--resolution`; `OMARCHY_SCREENRECORD_DEBUG=true` log path; `omarchy capture webcam resize`; `omarchy capture text`; `omarchy share clipboard|file|folder`; `omarchy tailscale send|receive`; `omarchy transcode` — `capture.md`.
- SK-19 — `contributing.md`: bugs → GitHub issues (verified only), ideas → Discussions/Suggestions, support → Discord; `omarchy version`; `omarchy debug --no-sudo --print` writes `/tmp/omarchy-debug.log`; interactive `omarchy debug` offers upload to logs.omarchy.org (24 h); `gh issue create --repo omacom/omarchy`; `gh` cannot attach media; PR via fork + `./test/all` — `contributing.md`.

#### Shipped agent skill `diagnose-crash` and the crash pipeline

- DC-01 — Trigger: "Process crashed:" notification click → `omarchy-agent-crash <pid> <comm> <exe> <signal>` → builds a prompt naming the skill path `$OMARCHY_PATH/default/agents/skills/diagnose-crash/SKILL.md` → `exec omarchy-agent --prompt` — `bin/omarchy-agent-crash`, `manual/17-ai.md:45`.
- DC-02 — `omarchy agent crash` with no arg → usage error; non-numeric → "Not a PID: <x>" + "Usage: omarchy agent crash <pid>   (see: coredumpctl list)" exit 1; timestamp looked up live via `coredumpctl list <pid>` — `bin/omarchy-agent-crash:14-31`.
- DC-03 — Watcher preconditions: only this UID's crashes; **no toast unless `omarchy-default-agent` prints a name** (checked per crash); `OMARCHY_CRASH_IGNORE` regex; never announces `omarchy-crash-*`/`omarchy-agent-*`; per-program mute flag `~/.local/state/omarchy/toggles/crash-ignore/<name>`; 60 s dedupe (`OMARCHY_CRASH_DEDUPE_SECONDS`) starting only after a delivered toast; name = basename of exe, else comm (15-char truncated) — `bin/omarchy-crash-watch:64-108`.
- DC-04 — Unit `omarchy-crash-watch.service`: `After=/PartOf=graphical-session.target`, `ConditionEnvironment=WAYLAND_DISPLAY`, `ConditionPathExists=!%h/.local/state/omarchy/toggles/crash-capture-off`, `Restart=always` — `default/systemd/user/omarchy-crash-watch.service`.
- DC-05 — `omarchy toggle crash-capture` (menu _Trigger › Toggle › Crash Capture_) flips `crash-capture-off`, stops/starts the unit, toasts "Crash capture disabled"/"Crash capture enabled" — `bin/omarchy-toggle-crash-capture`.
- DC-06 — `omarchy crash mute` lists ("No programs muted. Crashes all notify."); `omarchy crash mute <prog|/path> [on|off|toggle]` → "Muted crash notifications for <p>." / "Crash notifications for <p> are back on."; `--` guards a program named `-h`; `/`, `.`, `..` → "Not a program name"; bad action → "Not an action" — `bin/omarchy-crash-mute`.
- DC-07 — Skill method: `coredumpctl info <pid>` + command line; `coredumpctl list` for patterns; `free -h` + journal OOM; mtime/journal/pacman timeline; other threads; third-party in-process code; symbolize with `gdb` + `DEBUGINFOD_URLS=https://debuginfod.archlinux.org` on a `mktemp` core deleted afterwards; never invent symbols; report format (what/mechanism/data loss/recurrence); leave system as found; offer `omarchy-crash-mute '<program>'` quoted, warn about interpreter names; whole-machine switch is _Trigger › Toggle › Crash Capture_ — `diagnose-crash/SKILL.md`.
- DC-08 — `reporting.md`: Omarchy's sphere (commands, shell, shipped Hyprland/terminal config, themes, install/migrations, packaging); three conditions (verified, explicit yes, `gh auth status` ok — never install/auth gh); search open+closed first (`gh search issues --repo omacom/omarchy`); comment only with new information; create with `gh issue create`; include `omarchy version` + `omarchy debug --no-sudo --print`; sign "Filed by <model> via <harness>." — `reporting.md`.

#### AI agent integration touched by the crash flow (`bin/omarchy-agent*`, `omarchy-default-agent`, configs)

- AI-01 — `omarchy agent [--inline] [--pick]`; a bare word → "Unexpected argument: <w>" + "To pass a prompt: omarchy agent prompt …" exit 1; prompts via `omarchy agent prompt [--inline] <text…>` (no text → usage exit 1) — `bin/omarchy-agent:10-32`, `bin/omarchy-agent-prompt`.
- AI-02 — No default agent shipped: `omarchy-default-agent` prints nothing; `omarchy agent` → "Choose default agent with: omarchy default agent <name>" exit 1; `--pick` summons `setup.default.agent`; `Super+Shift+Ctrl+A` = `omarchy-agent --pick` — `bin/omarchy-agent:40-46`, `utilities.lua:97`.
- AI-03 — Default chosen but binary missing → "<agent> is not installed. Choose an installed agent with: omarchy default agent <name>" exit 1 (to stderr, before any terminal opens) — `bin/omarchy-agent:49-52`.
- AI-04 — Launch from `$HOME` cds to `~/Work` when it exists; window app-id `org.omarchy.agent` via `omarchy-launch-tui`; per-agent auto-approve flags (opencode `--auto`, claude `--permission-mode auto`, codex `--approve-for-me`, …) — `bin/omarchy-agent:34-145`.
- AI-05 — `omarchy default agent <pi|omp|opencode|ori|claude|codex|grok|openclaw|agy|hermes|copilot|crush|cursor-agent|muse>` writes `~/.config/omarchy/defaults/agent`; installs via `mise use -g` in a floating terminal when absent (NET); bad name → usage exit 1; bare → prints current or nothing — `bin/omarchy-default-agent`.
- AI-06 — No coding agent is preinstalled; `mise-bin` and `herdr` are (`omarchy-base.packages:52,80`); terminal shortcuts `a`, `c`, `cx`, `cy` — `manual/17-ai.md:34-36`.
- AI-07 — `config/opencode/opencode.json`: `theme: system`, `autoupdate: false`; `config/herdr/config.toml` mirrors tmux bindings with prefix `ctrl+space`; `omarchy-launch-terminal-herdr` = `omarchy-launch-terminal herdr`; `omarchy-launch-editor [--inline] <path>` reads `~/.local/state/omarchy/defaults/editor`; `omarchy-launch-openclaw [--tui [--message]]`.
- AI-08 — Theme sync to agents: `omarchy-theme-set-claude`, `-hermes`, `-pi`, `-t3code`, `omarchy-restart-opencode` in `post_theme_commands`; templates `claude.json.tpl`, `hermes.yaml.tpl`, `pi.json.tpl`, `t3code.json.tpl` — TH-04/TH-05.

#### Repo-level agent/contributor files, CI, meta

- RP-01 — `AGENTS.md`: task-guide index; doc layout (`agents/skills` procedure, `docs` reference, `manual` end-user); bash style (`#!/bin/bash`, `[[ ]]`/`(( ))`, 2-space indent); command naming + `GROUP_DESCRIPTIONS` is authoritative; `$OMARCHY_PATH` set by uwsm; helper commands (`omarchy-cmd-*`, `omarchy-pkg-*`, `omarchy-notification-send` never `notify-send`); menu aliases rule; test entry points `./test/all|cli|shell`; refresh pattern + `..` caveat. `CLAUDE.md` = `@AGENTS.md`.
- RP-02 — `README.md`: manual index (51 chapters, 01…51), MIT license; mirror at learn.omacom.io.
- RP-03 — **CI: none.** No `.github/workflows`; nothing runs on a PR in this repo. `.github/` holds only `SECURITY.md` (private report to security@omarchy.org; boundary-crossing definition; credits), `ISSUE_TEMPLATE/bug.yml` (required "System details" and "What's wrong?", asks for `omarchy-debug` output — the legacy hyphenated name), `ISSUE_TEMPLATE/config.yml` (blank issues disabled; Suggestion → Discussions; Support → Discord).
- RP-04 — `version` = `4.0.0.alpha` (dev line; installed 4.0.2 reports via `pacman -Q`, UP-09); `icon.txt` 26-line block icon and `logo.txt` 10-line wordmark feed About/screensaver branding (FL-13); `.editorconfig` 2-space/LF/utf-8/final newline; `.luarc.json` declares global `hl` and stubs `/usr/share/hypr/stubs` (the `o.*` helper used throughout the shipped skill is not declared); `.gitignore` ignores only Python bytecode ("orchestrator" — stale comment, no Python in tree).

## Observations

1. **Phantom `finalize` group (CLI-03).** `omarchy --help` advertises `finalize  Finalize user setup`, but `omarchy finalize` and the documented `omarchy finalize user` both fail with exit 127. The binary is `omarchy-provision-user` (hidden), its own usage text says `omarchy finalize user`, `docs/file-layout.md` repeats that, and `agents/skills/install-scripts.md` names a `bin/omarchy-finalize-user` that does not exist. `omarchy commands --check` passes — the lint does not cross-check `GROUP_DESCRIPTIONS` against registered groups, so this class of drift is invisible to `test/cli`. A driver test catches it in one command.
2. **The crash toast is gated on a default agent (DC-03).** A stock install has no default agent and none is preinstalled, so `kill -SEGV` produces a journal entry and a `coredumpctl` row but **no notification**. `manual/17-ai.md` ("When something segfaults, you'll get a 'Process crashed' notification") does not mention the precondition. A driver can satisfy it without network by writing `~/.config/omarchy/defaults/agent` directly. Then, clicking the toast with the agent binary absent fails silently: `omarchy-agent` prints "claude is not installed…" to stderr *before* opening a terminal, so the user sees nothing happen.
3. **No CI in this repo (RP-03).** Every "checked on every PR" contract (`./test/all`, `omarchy commands --check`, migration idempotence) is enforced only by convention. The only executable lint reachable from a guest is `omarchy commands --check`, which is worth running as a smoke test on every minted disk.
4. **Planned features are almost entirely unshipped.** backup, dots, server: zero artefacts. remote: only the pre-plan `install/remove service sunshine` exists and still has the exact defects the plan enumerates (autostart double start, `--ignore-certificate-errors` webapp, no menu row). Tests below assert the *absence* so a future ship flips them deliberately.
5. **Notification contract is fully driver-observable**: urgency lifetimes, DND bypass by `app_name`, `--exec` argv refusal, persistence across `omarchy restart shell`, history trim to 10. `notify-send` is installed (libnotify) so both the shell's own sender and the third-party path can be exercised.
6. **Menu JSONC fragility (MN-02)** is an easy negative: a single inline `// comment` in the user extension silently drops every user entry. Combined with hot-reload, a driver can flip it on/off in one test.
7. **Theme switch is heavy but deterministic**: 19 template outputs must appear in `~/.local/state/omarchy/current/theme/` and 17 post-commands fire in parallel; several target apps not present in the VM (obsidian, vscode, hermes, pi, claude, t3code, keyboard RGB) must degrade silently — a theme switch must never print errors for missing apps.
8. **Update tests are constrained by the 4.0.2 base**: any `pacman -Syu` in the guest will find upgrades (NET, SLOW). The guard test needs the DB sync to actually reach the hook; the full `omarchy update` almost certainly exceeds the ten-minute budget on a 4.0.2 mint — keep it in the appendix.
9. **Router negative paths are cheap and high-signal**: `--help` anywhere, bare required-args command, unknown route suggestion, hidden route still dispatching, `--` forwarding. All pure stdout, no side effects.
10. **`omarchy-refresh-config` path escape is documented, not fixed** (FL-14). `omarchy refresh config ../default/bashrc` copies a file to `~/default/bashrc`. Recorded as a negative-path test so the fix is noticed when it lands.
11. **Drivers must redirect long output to serial**: `omarchy commands` (380 rows), `omarchy commands --json`, `coredumpctl info`. Pattern used below: `… 2>&1 | sudo tee /dev/ttyS0 >/dev/null` then `./client get-serial`. `sudo` will prompt once for `prime`.
12. **Skill topic guides all exist** (SK-02) — an earlier concern that `SKILL.md` links to missing files does not hold at HEAD; the six guides are shipped and symlinked with the skill directory.
13. **Group description mismatch (CLI-17)**: `agent` is described as "AI coding agent usage data" while its root command launches an agent. Cosmetic, but it is the text every user sees in `omarchy --help`.
14. **Timing**: crash-watch waits on `omarchy-notification-wait`; after `omarchy restart shell` allow ~5 s before expecting toasts. Reminder minimum is 1 minute; a 1-minute reminder fits the budget.
15. **State reset**: tests that write `~/.config/omarchy/defaults/agent`, user themes, hooks, menu extensions, or toggles should undo them at the end so a later step on the same disk sees stock state; the disk is discarded on `stop` anyway.

## Proposed tests

Every step below is a hotkey, a mouse action, or a command typed into a terminal opened with `Super+Enter` inside the guest; long outputs go through `… | sudo tee /dev/ttyS0` (password `prime`) and are read with `get-serial`. Nothing is done from the host.

### cli-command-discovery   [VM-OK]
description: A user discovers what Omarchy can do from the command center: `omarchy` lists the curated groups, `omarchy commands` lists commands (hidden plumbing stays hidden), and the metadata lint passes; every advertised group must open.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and press Super+F so it fills the screen.
  * Type `omarchy` and press Enter. The screen shows "Omarchy command center", a "Common commands:" block, a "Groups:" table and a "Discovery:" block.
  ** `apply` and `provision` must NOT appear in the Groups table; `theme`, `update`, `crash`, `agent`, `finalize` must.
  * Type `omarchy theme` → header "Theme commands — Theme management:" with a table. Then `omarchy apply` → header "Apply commands:" followed by "No documented commands found. Try: omarchy commands --all" (hidden group still routes).
  * Type `omarchy finalize` and then `omarchy finalize user`.
  ** Quirk: at HEAD `finalize` is a phantom group — both print "Unknown Omarchy command" although `finalize` is listed under Groups. Report the exact text either way.
  * Type `omarchy commands | grep -c provision` → 0, then `omarchy commands --all | grep -c provision` → 3 or more.
  * Type `omarchy commands --check` → one line "Command metadata check passed (N commands)"; then `omarchy commands --bogus` → usage text, nothing listed.
  * Press Super+F to un-fullscreen and Super+W to close the terminal; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Groups table is ~70 rows; fullscreen keeps it on one screenshot. If it still scrolls, `omarchy | sudo tee /dev/ttyS0` and read it with get-serial.
  * ./client-with-image speeds up the type-then-look loop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `omarchy` output with the Groups table (no apply/provision, finalize present)
  ** Screenshot of the `omarchy theme` and `omarchy apply` headers
  ** Screenshot of the `omarchy finalize` result, quoted verbatim in the report
  ** Screenshot of the 0 vs ≥3 provision counts and "Command metadata check passed"
  * If unsuccessful
  ** Screenshot of the failing group and the full `omarchy commands --check` output
covers: docs/cli-router.md §Groups and the top-level listing, §Introspection; AGENTS.md §Command Naming; bin/omarchy GROUP_DESCRIPTIONS; docs/file-layout.md:39; agents/skills/install-scripts.md:10

### cli-help-never-executes   [VM-OK]
description: Asking any Omarchy command for help — even with `--help` after other words, or by running it bare — shows usage and never runs the command, so an agent or user cannot start an update or change a theme by accident.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Note the current bar and terminal colours for later comparison.
  * Type `omarchy update aur --help`. Help for `omarchy update` appears (a "Usage:" block naming binary `omarchy-update`); no "Ready to update?" box appears. Wait 5 seconds and take another screenshot to confirm nothing started.
  * Type `omarchy theme set --help` → help; then `omarchy theme set` with no name → the same usage instead of an interactive picker. The colours do not change.
  * Type `omarchy theme set --help --json` → a JSON record containing `"binary": "omarchy-theme-set"`.
  * Type `omarchy menu -- --help` → the menu's own text "Usage: omarchy menu [verb] [route]" (the `--` handed the flag to the binary).
  * Unhappy path: type `omarchy theme set nosuchtheme; echo "exit=$?"` → `Theme 'nosuchtheme' does not exist` and `exit=1`; then `omarchy theme set ../etc` → `Invalid theme name: ../etc`.
  * Close the terminal with Super+W; the desktop colours are unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a gum confirmation box ever appears, press Escape immediately and report it as the failure.
  * Compare the first and last screenshots to prove the theme never changed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each help output; the two 5-seconds-apart screenshots after `update aur --help` showing no update
  ** Screenshot of the two error messages with `exit=1`
  ** First and last screenshots with identical bar/terminal colours
  * If unsuccessful
  ** Screenshot of whatever started; `cat /tmp/omarchy-update.log | head` if an update began
covers: docs/cli-router.md §Dispatch (help interception, required-args guard, `--`); docs/testing.md:16-17; bin/omarchy-theme-set:8,283-290

### cli-mistyped-command-guidance   [VM-OK]
description: A mistyped or partial command fails helpfully: unknown routes exit 127 with a "did you mean" hint and a pointer to `omarchy commands --all`, partial routes list what could follow, and aliases and filename routes both reach their binary.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy themx list; echo "exit=$?"` → `Unknown Omarchy command: omarchy themx list`, `Run 'omarchy commands --all' to discover available commands.`, `exit=127`.
  ** A "Did you mean: omarchy … ?" line appears only when a known route starts with the typed word; report whether one appeared.
  * Type `omarchy hw asus` → a listing headed `hw asus commands:` with rows such as `omarchy hw asus rog`.
  * Type `omarchy hw asus rog; echo "exit=$?"` → no output and `exit=1` (a quiet hardware predicate; this is not an ASUS machine).
  * Type `omarchy screenshot --help` → help naming binary `omarchy-capture-screenshot` (alias route).
  * Type `omarchy share --help` and `omarchy menu share --help` → both name binary `omarchy-menu-share` (canonical and filename route).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * stderr and stdout both show in the terminal; the `exit=` echo is the proof of the exit code.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with the Unknown line, the discovery pointer and `exit=127`
  ** Screenshot of the `hw asus` prefix listing and the quiet predicate's `exit=1`
  ** Screenshot of the alias and both share routes naming one binary each
  * If unsuccessful
  ** Screenshot of the terminal; `omarchy commands --all | grep share`
covers: docs/cli-router.md §Dispatch ("did you mean", prefix listing), §How a binary becomes routes (share, aliases); bin/omarchy:1060-1070

### theme-switch-cli-renders-everything   [VM-OK]
description: Switching theme from the CLI retints the desktop and regenerates every shipped template into the current-theme state, without errors for the many target apps that are not installed, and switching back restores the stock look.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme current` → `tokyo-night` on a fresh disk. Screenshot the desktop for comparison.
  * Type `omarchy theme set nord 2>&1 | tee /tmp/theme.out; echo "exit=$?"`. Within 5 seconds the bar, terminal background and wallpaper change to Nord's blue-grey palette and `exit=0`.
  ** `/tmp/theme.out` must contain no "command not found" or "No such file" lines for obsidian, vscode, hermes, pi, claude, t3code or keyboard — those targets are absent here and must fail silently.
  * Type `cat ~/.local/state/omarchy/current/theme.name` → `nord`.
  * Type `ls ~/.local/state/omarchy/current/theme/` → the listing must include alacritty.toml, btop.theme, chromium.theme, claude.json, foot.ini, ghostty.conf, gum_env.lua, helix.toml, hermes.yaml, hyprland.lua, hyprland-preview-share-picker.css, keyboard.rgb, kitty.conf, neovim.lua, obsidian.css, pi.json, shell.toml, t3code.json, vscode-theme.json, colors.toml and backgrounds.
  * Type `grep -l '{{' ~/.local/state/omarchy/current/theme/*` → prints nothing (no unrendered placeholders).
  * Press Super+Shift+Ctrl+Space (Theme menu): the Nord row carries the current marker (✓). Press Escape.
  * Type `omarchy theme set tokyo-night`; within 5 seconds the desktop matches the first screenshot. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The retint runs in parallel; give it up to 5 seconds before judging colours.
  * The `ls` fits on one screen; if not, pipe it to `sudo tee /dev/ttyS0` and use get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots: stock tokyo-night, Nord palette on bar + terminal + wallpaper, then tokyo-night again
  ** Screenshot of the directory listing with all 19 template outputs and the empty grep
  ** Screenshot of the Theme menu with Nord marked current
  * If unsuccessful
  ** Screenshot of `/tmp/theme.out` and of the theme directory listing; any error toast
covers: docs/theming.md §Theme activation flow, §Template placeholders; default/themed/*.tpl; bin/omarchy-theme-set post_theme_commands; default/agents/skills/omarchy/theming.md §Theme Commands

### theme-user-overlay-wins   [VM-OK]
description: A user theme directory with the same slug as a stock theme overlays only the files it contains — the shipped agent skill's recommended way to customize a stock theme without touching /usr/share/omarchy — and removing it restores the stock theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `mkdir -p ~/.config/omarchy/themes/nord && cp /usr/share/omarchy/themes/nord/colors.toml ~/.config/omarchy/themes/nord/` then `sed -i 's/^accent = .*/accent = "#ff0000"/' ~/.config/omarchy/themes/nord/colors.toml`.
  * Type `omarchy theme set nord`. Within 5 seconds the desktop is Nord but the focused window border and the bar's active-workspace accent are bright red.
  * Type `grep -c ff0000 ~/.local/state/omarchy/current/theme/alacritty.toml` → 1 or more (the overlay reached a rendered template). `ls ~/.local/state/omarchy/current/theme/backgrounds | head -3` still lists Nord's stock wallpapers (files you did not overlay come from the stock theme).
  * Round trip: type `rm -rf ~/.config/omarchy/themes/nord && omarchy theme set nord` → the accent is Nord's normal blue again.
  * Type `omarchy theme set tokyo-night` and close the terminal with Super+W; the desktop is stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The accent is easiest to see on the border of the focused terminal window; open a second window with Super+Enter if you need two borders to compare.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Nord with red accent borders and the grep count
  ** Screenshot after removing the overlay with Nord's normal blue accent
  ** Final screenshot in stock tokyo-night
  * If unsuccessful
  ** Screenshot of `ls -la ~/.config/omarchy/themes/` and the theme-set stderr
covers: docs/theming.md §Theme activation flow (overlay step 2); default/agents/skills/omarchy/theming.md §Customizing a Stock Theme; SKILL.md §Example Requests ("Customize the catppuccin theme colors")

### theme-set-hook-runs   [VM-OK]
description: A script installed with `omarchy hook install theme-set` runs after every theme change with the theme slug as its argument, and a bad install is refused — the automation path the shipped agent skill directs users to.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `printf '#!/bin/bash\necho "$1" > /tmp/hook-theme.txt\nomarchy-notification-send "Hook ran for $1"\n' > /tmp/theme-hook.sh` then `omarchy hook install theme-set /tmp/theme-hook.sh`; then `ls -l ~/.config/omarchy/hooks/theme-set.d/` → one executable file.
  * Type `omarchy theme set nord`. Within 5 seconds a toast "Hook ran for nord" appears top-right and the desktop is Nord.
  * Type `cat /tmp/hook-theme.txt` → `nord`.
  * Unhappy path: type `omarchy hook install; echo "exit=$?"` → usage and a non-zero exit; then `omarchy hook install theme-set /nonexistent; echo "exit=$?"` → an error, non-zero, and `ls ~/.config/omarchy/hooks/theme-set.d/` still shows only your file.
  * Round trip: type `rm ~/.config/omarchy/hooks/theme-set.d/theme-hook.sh /tmp/hook-theme.txt && omarchy theme set tokyo-night` → the desktop is stock and NO hook toast appears this time.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hook toast is a low-urgency toast and disappears after ~5 seconds; screenshot right after the theme changes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "Hook ran for nord" toast over the Nord desktop and of `nord` in the file
  ** Screenshot of the two refused installs with non-zero exits
  ** Screenshot of the switch back to tokyo-night with no hook toast
  * If unsuccessful
  ** Screenshot of `ls -la ~/.config/omarchy/hooks/` and `journalctl --user -n 30`
covers: docs/theming.md:40-42 (theme-set hook); default/agents/skills/omarchy/hooks.md; SKILL.md ("Run a script every time I change themes"); bin/omarchy-hook-install; bin/omarchy-hook

### theme-cloned-repo-drops-code-files   [VM-OK]
description: A theme that arrived as a git clone may not ship code: its Lua, terminal configs, vscode.json and symlinks are dropped at activation and named on screen, while the same directory without `.git` is trusted as the user's own — the one security boundary in theming, provable without network.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `cp -r /usr/share/omarchy/themes/nord ~/.config/omarchy/themes/evil && cd ~/.config/omarchy/themes/evil && git init -q . && printf 'os.execute("touch /tmp/pwned")\n' > hyprland.lua && printf '[shell]\nprogram = "/bin/sh"\n' > alacritty.toml && printf '{}' > vscode.json && ln -s /etc/passwd leak && cd ~`.
  * Type `omarchy theme set evil`. The desktop turns Nord-like and the terminal prints lines naming the dropped files: hyprland.lua, alacritty.toml, vscode.json and `leak`.
  ** Quirk: the names are printed on stderr by theme-set itself, before the retint; they may scroll past the toast — screenshot immediately.
  * Type `ls /tmp/pwned ~/.local/state/omarchy/current/theme/leak` → both "No such file" (the Lua never ran, the symlink was not staged); then `head -3 ~/.local/state/omarchy/current/theme/alacritty.toml` → generated colour lines, not `program = "/bin/sh"`.
  * Type `hyprctl configerrors` → prints nothing (the generated hyprland.lua is valid).
  * Contrast: type `rm -rf ~/.config/omarchy/themes/evil/.git && omarchy theme set evil` → nothing is reported dropped, and `grep -c '/bin/sh' ~/.local/state/omarchy/current/theme/alacritty.toml` → 1 (a hand-written theme is trusted). Do not open a new terminal in this state.
  * Round trip: type `omarchy theme set tokyo-night && rm -rf ~/.config/omarchy/themes/evil` → stock desktop; `grep -c '/bin/sh' ~/.local/state/omarchy/current/theme/alacritty.toml` → 0. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `git init` alone marks the directory as cloned; no commit or identity is needed.
  * Keep the existing terminal open through the trusted-theme step — a new terminal would launch `/bin/sh` per the staged config.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the theme-set output naming the four dropped files
  ** Screenshot of the two "No such file" results, the generated alacritty.toml head and empty `hyprctl configerrors`
  ** Screenshot of the trusted contrast (grep 1) and the cleanup (grep 0) on a stock desktop
  * If unsuccessful
  ** Screenshot of `ls -la ~/.local/state/omarchy/current/theme/` and whether `/tmp/pwned` exists
covers: docs/theming.md §What an installed theme may not ship; default/agents/skills/omarchy/theming.md §What a Theme Installed From a Repo May Not Contain; bin/omarchy-theme-set stage_installed_theme

### theme-install-rejects-bad-url   [VM-OK]
description: `omarchy theme install` accepts only a git URL: dangerous URL shapes are refused before anything is cloned, and cancelling the interactive prompt leaves no theme behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.config/omarchy/themes/` → empty or absent (stock disk).
  * Type `omarchy theme install 'ext::sh -c id'; echo "exit=$?"` → a refusal message from the URL check and a non-zero exit; no clone output.
  * Type `omarchy theme install --upload-pack=/bin/sh; echo "exit=$?"` → refused, non-zero.
  * Type `omarchy theme install` with no argument → a green "See https://omarchy.org/themes/" line and a gum input "Git repo URL (…)". Press Escape → the prompt closes; `echo $?` on the next line → 1.
  * Type `ls ~/.config/omarchy/themes/` → still empty. Also from the menu: Super+Space → Install → Style → Theme opens a floating terminal with the same prompt; press Escape and it closes.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The gum input has a placeholder; Escape (not Ctrl+C) is the cancel path under test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the two refusals with non-zero exits
  ** Screenshot of the gum URL prompt and of the empty themes directory after cancelling
  ** Screenshot of the floating terminal opened from Install → Style → Theme
  * If unsuccessful
  ** Screenshot of any clone output or of a new directory under ~/.config/omarchy/themes/
covers: docs/theming.md:64 (git URLs only); bin/omarchy-theme-install (omarchy-git-url-check); omarchy-menu.jsonc install.style.theme

### notification-send-urgency-lifetimes   [VM-OK]
description: Omarchy's notification sender pops a low-urgency toast by default that expires on its own, keeps a critical toast until dismissed, and hard-fails on a bad urgency or an unknown flag — the contract every Omarchy subsystem sends through.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; if it covers the top-right corner move it with Super+Shift+Left.
  * Type `omarchy-notification-send "Low default"`. A small toast appears top-right; screenshot at once, after 3 seconds and after 7 seconds — it is gone by the third screenshot.
  * Type `omarchy-notification-send -u critical -g "" "Critical stays" "until dismissed"`. Screenshot now and again after 30 seconds (six 5-second waits, screenshot each): still on screen. Hover it with the mouse and move away: still there.
  * Press Super+comma → the critical toast disappears.
  * Type `notify-send "Third party" "libnotify client"` → a toast appears (the shell itself is the notification daemon; there is no dunst or mako).
  * Unhappy path: type `omarchy-notification-send -u loud "x"; echo "exit=$?"` → `Unknown urgency: loud (use low, normal, or critical)` and `exit=1`, no toast; then `omarchy-notification-send --hint=foo "x"; echo "exit=$?"` → `Unknown option: --hint=foo`, a Usage line, `exit=1`, no toast.
  * Close the terminal with Super+W; no toasts remain.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never wait more than 5 seconds at a time; the 30-second hold is proven by a series of screenshots.
  * Right-clicking a toast card also dismisses it, if Super+comma is ever intercepted.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Timed screenshot series: low toast gone by ~7 s; critical toast still present at 30 s and gone after Super+comma
  ** Screenshot of the notify-send toast
  ** Screenshot of the two error messages with `exit=1` and no toast
  * If unsuccessful
  ** Screenshot of the terminal and of `omarchy-shell notifications ping` output
covers: docs/notifications.md §Toast lifecycle, §The sender contract; bin/omarchy-notification-send:133-145; AGENTS.md helper rule (never raw notify-send)

### notification-click-runs-exec-command   [VM-OK]
description: A toast's click command travels as separate argv words via `--exec` and is run by the shell when the toast is clicked; a command passed as one quoted string is refused, and hostile text in the headline or body stays inert data.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-notification-send -u critical "Click me" "opens a titled terminal" --exec alacritty --title CLICK-PROOF -e bash -c 'echo clicked; sleep 20'`.
  * Click the toast card with the left mouse button. A new terminal window titled CLICK-PROOF opens showing "clicked"; the toast disappears. Close it with Super+W.
  * Type `omarchy-notification-send -u critical "Title ; touch /tmp/inj" "-rf --hint=x" --exec alacritty --title SAFE -e bash -c 'echo safe; sleep 20'`. The toast shows the headline and body literally. Click it → a SAFE terminal opens; type `ls /tmp/inj` in the first terminal → "No such file". Close SAFE with Super+W.
  * Unhappy path: type `omarchy-notification-send "Bad" --exec "alacritty --title X"; echo "exit=$?"` → `--exec takes the command as separate words, not one quoted string.`, a `Write:  --exec alacritty --title X` hint, `exit=1`, no toast.
  * Type `omarchy-notification-send "Bad" --exec; echo "exit=$?"` → `--exec needs a command: --exec <program> [args...]`, `exit=1`.
  * Close the terminal with Super+W; no toasts or extra windows remain.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the body of the card, not the close button that appears on hover — double-check the mouse position first.
  * The window title shows in the Hyprland title bar / group; `hyprctl clients | grep CLICK-PROOF` confirms it if the screenshot is ambiguous.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the toast, then of the CLICK-PROOF terminal after the click
  ** Screenshot of the literal hostile headline/body and of `ls /tmp/inj` failing
  ** Screenshot of the two refusals with `exit=1`
  * If unsuccessful
  ** Screenshot of the terminal; `cat ~/.local/state/omarchy/notifications/*.json` showing the exec hint
covers: docs/notifications.md §Click commands are argv, never shell strings; bin/omarchy-notification-send:162-179

### notification-silencing-bypass-rules   [VM-OK]
description: Do-not-disturb silences ordinary notifications while Omarchy's own action toasts and bare `notify-send` criticals still show, and a critical from a branded app is silenced into history — the exact rules the shell applies.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Press Super+Ctrl+comma → a Do-not-disturb indicator appears in the bar (a confirmation toast may show; it is itself an Omarchy action toast).
  * Type `notify-send "Silenced normal" "should not show"` → NO toast.
  * Type `notify-send -u critical "CLI emergency" "shows"` → a toast SHOWS (critical from notify-send bypasses).
  * Type `notify-send -a ChatApp -u critical "Branded critical" "silenced"` → NO toast.
  * Type `omarchy-notification-send "Action toast" "bypasses"` → a toast SHOWS. Press Super+Shift+comma to clear the screen.
  * Press Super+Shift+Alt+comma → the history overlay lists "Silenced normal" and "Branded critical" but not "Action toast" (ephemeral). Press Escape.
  * Round trip: press Super+Ctrl+comma → the indicator disappears; type `notify-send "Back on"` → a toast shows. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The DND indicator is a small glyph in the bar's right section; zoom your screenshot check there.
  * Take a screenshot 2–3 seconds after each send so a missing toast is a positive observation, not a timing miss.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the DND indicator; screenshots after each of the four sends (two silent, two showing)
  ** Screenshot of the history overlay with exactly the two silenced entries
  ** Screenshot with the indicator gone and the "Back on" toast
  * If unsuccessful
  ** Screenshot of any leaked toast; `cat ~/.local/state/omarchy/notifications.json`
covers: docs/notifications.md §Silencing; default/hypr/bindings/utilities.lua:27-29; bin/omarchy-toggle-notification-silencing

### notification-hotkeys-dismiss-invoke-history   [VM-OK]
description: The notification hotkeys work as documented: Super+comma dismisses the last toast, Super+Shift+comma all of them, Super+Alt+comma invokes the last toast's click command, and Super+Shift+Alt+comma opens the history, which keeps at most ten entries.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for i in 1 2 3; do omarchy-notification-send -u critical "Toast $i" "body $i"; done` → three cards stack top-right.
  * Press Super+comma → only "Toast 3" disappears (the last one).
  * Press Super+Shift+comma → the remaining two disappear.
  * Type `omarchy-notification-send -u critical "Invoke me" "Super+Alt+comma runs me" --exec alacritty --title INVOKED`. Press Super+Alt+comma → a terminal titled INVOKED opens and the toast is gone. Close it with Super+W.
  * Type `for i in $(seq 4 15); do omarchy-notification-send "Filler $i"; done` and wait 10 seconds (two screenshots) for them to expire.
  * Press Super+Shift+Alt+comma → the history overlay shows the most recent toasts and no more than ten entries; "Toast 1", "Toast 2" or "Toast 3" are no longer listed (trimmed). Press Escape.
  * Unhappy path: with nothing on screen press Super+comma → nothing happens and no error toast. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Count the cards in the screenshot after each dismiss; the newest card is at the top of the stack.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: three cards, two after Super+comma, none after Super+Shift+comma
  ** Screenshot of the INVOKED terminal after Super+Alt+comma
  ** Screenshot of the history overlay with ≤10 entries and the early toasts trimmed
  * If unsuccessful
  ** Screenshot of the state after the failing hotkey; `ls ~/.local/state/omarchy/notifications/history/`
covers: docs/notifications.md §Toast lifecycle (history trimmed to ten), §Helper commands (hotkeys); default/hypr/bindings/utilities.lua:25-29

### notification-survives-shell-restart   [VM-OK]
description: A live toast is persisted to disk and re-rendered after the shell restarts (as `omarchy update` does), and the restored toast still runs its click command — so an update's own notices are never lost.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-notification-send -u critical "Persist across restart" "still here after omarchy restart shell" --exec alacritty --title PERSISTED`. The toast appears.
  * Type `ls ~/.local/state/omarchy/notifications/` → one `<timestamp>-<id>.json` file.
  * Type `omarchy restart shell`. The bar vanishes for a moment; take screenshots every 5 seconds until it is back.
  ** Quirk: the toast is re-rendered a second or two after the bar returns; allow one extra screenshot.
  * The "Persist across restart" toast is on screen again. Click it → a terminal titled PERSISTED opens and the toast disappears. Close PERSISTED with Super+W.
  * Type `ls ~/.local/state/omarchy/notifications/history/` → the toast's file has moved here.
  * Type `omarchy-shell shell ping` → `ok` (the restarted shell answers IPC). Close the terminal with Super+W; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar does not return within ~15 seconds, run `omarchy restart shell` once more and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the toast before restart and its json file; screenshot of the bar gone; screenshot of the toast re-rendered after the bar returns
  ** Screenshot of the PERSISTED terminal after clicking the restored toast; the file now under history/
  * If unsuccessful
  ** Screenshot of the desktop after restart; `journalctl --user -n 50`
covers: docs/notifications.md §Toast lifecycle (persistence files, restored toasts click through); docs/omarchy-shell.md (omarchy-restart-shell)

### reminder-set-fires-and-clears   [VM-OK]
description: A reminder set from the terminal shows in the bar, fires a toast after the requested minutes, disappears once fired, and can be listed and cleared; bad input is rejected and the hotkey overlay can be cancelled.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy reminder 1 "Ping From Test"` → a confirmation toast, and a reminder indicator appears in the bar.
  * Type `omarchy reminder show` → a summary toast naming "Ping From Test" with the time left.
  * Take a screenshot every 5 seconds until the "Ping From Test" toast fires (about 60 seconds). After it fires the bar indicator is gone and `omarchy reminder show` reports nothing pending.
  * Type `omarchy reminder 30 "Later"` then `omarchy reminder 45` → two reminders; `omarchy reminder show` lists both (the second with a default message). Type `omarchy reminder clear` → both gone, indicator gone.
  * Unhappy path: type `omarchy reminder abc; echo "exit=$?"` → an error and a non-zero exit, no indicator; `omarchy reminder clear` with nothing set → a "nothing to clear" style message, no crash.
  * Press Super+Ctrl+R → the reminder overlay (minutes prompt) opens; press Escape → it closes and no indicator appears.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar indicator is small and sits in the right section; compare bar screenshots before and after.
  * `omarchy reminder show` answers with a toast, not terminal text.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the set confirmation and indicator; the fired "Ping From Test" toast; the empty state afterwards
  ** Screenshot of `show` listing two reminders and of the bar after `clear`
  ** Screenshot of the error for `abc` and of the overlay opened by Super+Ctrl+R then cancelled
  * If unsuccessful
  ** Screenshot of `systemctl --user list-timers 'omarchy-reminder-*'`
covers: docs/notifications.md §Reminders; default/agents/skills/omarchy/SKILL.md §Reminder Requests; bin/omarchy-reminder; default/hypr/bindings/utilities.lua:89

### menu-cli-opens-routes   [VM-OK]
description: `omarchy menu` drives the shell menu from a terminal — toggle, summon and close at an id or alias, case- and underscore-insensitive, with action aliases run directly — and rejects an unknown verb, the same surface every menu keybinding uses.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy menu ping` → `ok` (or the plugin's reply), no error.
  * Type `omarchy menu summon style.theme` → the Theme submenu opens listing the stock themes. Type `omarchy menu close` (the terminal keeps focus) → it closes.
  * Type `omarchy menu summon power` → the System menu opens (alias). Type `omarchy menu toggle system` → it closes; again → it opens. Press Escape.
  * Type `omarchy menu summon SETUP_POWER` → the Setup › Power submenu opens (case and `_`→`-` normalized). Press Escape.
  * Type `omarchy menu summon reminder-set` → the reminder overlay opens directly (an alias that names an action runs it). Press Escape.
  * Unhappy path: type `omarchy menu bogusverb; echo "exit=$?"` → `omarchy-menu: unknown verb 'bogusverb'. Try 'omarchy menu --help'.` and `exit=2`. Then `omarchy menu summon no.such.route` → nothing opens or an empty menu opens; report which; `omarchy menu ping` still answers.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu appears centred over the terminal; if it steals focus, click back into the terminal before typing the next command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Theme submenu, the System menu via `power`, the Setup › Power submenu via `SETUP_POWER`, and the reminder overlay via `reminder-set`
  ** Screenshot of `exit=2` for the unknown verb and `ok` from ping afterwards
  * If unsuccessful
  ** Screenshot of the terminal; `omarchy-shell shell ping`
covers: docs/menu.md §Driving the menu from the CLI; bin/omarchy-menu; omarchy-menu.jsonc aliases (power-menu, settings, reminder-set)

### menu-user-extension-hot-reload   [VM-OK]
description: A user entry added to `~/.config/omarchy/extensions/omarchy-menu.jsonc` appears in the menu without restarting the shell and can override a shipped row in place; one inline comment silently drops every user entry while the shipped menu keeps working; restoring the file restores the menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cp ~/.config/omarchy/extensions/omarchy-menu.jsonc /tmp/menu.bak`.
  * Type `printf '{\n  "hello-test": {"icon":"", "label":"Hello Test", "description":"added by test", "action":"omarchy-notification-send Hello-from-menu"},\n  "style.theme": {"label":"Theme (overridden)"},\n}\n' > ~/.config/omarchy/extensions/omarchy-menu.jsonc`.
  * Press Super+Space → the root menu has a new last row "Hello Test"; select it with the mouse → a toast "Hello-from-menu". Press Super+Space → Style: the Theme row reads "Theme (overridden)" in its usual position. Press Escape.
  * Press Super+Space, type `added` → "Hello Test" is matched by its description. Press Escape.
  * Break it: type `sed -i 's/"label":"Hello Test",/"label":"Hello Test", \/\/ inline comment/' ~/.config/omarchy/extensions/omarchy-menu.jsonc`. Press Super+Space → "Hello Test" is gone AND the Style › Theme row reads plain "Theme" again, while Apps, Trigger, Style, Setup, Install, Remove, Update, About, System are all still present and no error toast appeared. Press Escape.
  ** Quirk: this is the documented JSONC limitation — only whole-line `//` comments are stripped; a broken user file contributes nothing, silently.
  * Round trip: type `cp /tmp/menu.bak ~/.config/omarchy/extensions/omarchy-menu.jsonc`. Press Super+Space → the stock root menu with no "Hello Test". Press Escape and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The search field is live as soon as the menu opens; just type.
  * Use the mouse to select "Hello Test" so the click path is exercised too.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the root menu with "Hello Test" and the toast after selecting it; Style submenu showing "Theme (overridden)"
  ** Screenshot after the inline comment: no "Hello Test", Theme label stock, all shipped rows present
  ** Screenshot of the stock root menu after restoring the file
  * If unsuccessful
  ** Screenshot of `cat ~/.config/omarchy/extensions/omarchy-menu.jsonc`
covers: docs/menu.md §JSONC, §Entry schema, §Load and merge; default/agents/skills/omarchy/SKILL.md (menu jsonc hot-reloads); config/omarchy/extensions/omarchy-menu.jsonc

### menu-guards-show-state   [VM-OK]
description: Menu rows reflect machine state through their guards: installed software is dimmed with a ✓ and cannot be selected under Install, absent software is hidden under Remove, and the current choice is ticked under Setup — so the menu is a truthful catalogue.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Terminal. The Alacritty row (installed) is dimmed with a ✓; the rows for terminals not installed look normal.
  * Press Down repeatedly: the highlight never lands on the dimmed Alacritty row. Type `alac` → the search shows no selectable Alacritty row; press Enter → nothing launches. Press Escape.
  * Press Super+Space → Install → Service: Dropbox, Spotify and Signal are NOT dimmed (not installed on a stock disk). Press Escape. Super+Space → Remove: there is no row for software that is absent (for instance no Dropbox, no Sunshine). Press Escape.
  * Press Super+Space → Setup → Default → Agent: fourteen agent rows, none ticked. Press Escape.
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/defaults && echo codex > ~/.config/omarchy/defaults/agent`. Press Super+Space → Setup → Default → Agent: the Codex row now carries ✓ (the guard batch re-ran on open). Do NOT select any row. Press Escape.
  * Round trip: type `rm ~/.config/omarchy/defaults/agent`; reopen the same submenu → no ✓ again. Press Escape.
  * Press Super+Space → Style → Font → the rows are installed monospace fonts with the current one ticked (provider rows). Press Escape and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Guards are evaluated in one batch when the menu opens; if a tick looks stale, close and reopen once.
  * Hover a dimmed row with the mouse to confirm the highlight does not follow it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Install › Terminal with Alacritty dimmed ✓ and the highlight skipping it
  ** Screenshots of Install › Service (undimmed) and Remove (no absent rows)
  ** Screenshots of Setup › Default › Agent before (no ✓), with Codex ✓, and after cleanup (no ✓)
  ** Screenshot of Style › Font with one row ticked
  * If unsuccessful
  ** Screenshot of the misbehaving submenu and of `pacman -Q alacritty foot ghostty kitty`
covers: docs/menu.md §Guards, §Providers; omarchy-menu.jsonc install.terminal.*, install.service.*, setup.default.agent.*

### crash-toast-needs-default-agent   [VM-PARTIAL]
description: A user-space crash produces a critical "Process crashed" toast offering AI diagnosis — but only once a default agent is configured, and crashes of the same program are announced once a minute. The click-through into an agent is skipped: no agent is installed in the guest, and clicking is then a silent no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl --user is-active omarchy-crash-watch.service` → `active`; then `omarchy default agent` → prints nothing (no default on a stock disk).
  * Type `sleep 300 & sleep 1; kill -SEGV $!`. Wait 5 seconds: NO toast appears.
  ** Quirk: the watcher only announces when a default agent is set; the crash itself is recorded — `coredumpctl list --no-pager | tail -2` shows a `sleep` row with SIGSEGV.
  * Type `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` (configures the name without installing anything).
  * Type `sleep 300 & sleep 1; kill -SEGV $!`. Within 5 seconds a critical toast with a robot glyph reads "Process crashed: sleep" / "Click to diagnose with AI".
  * Type the same crash line again at once → NO second toast (one per program per minute).
  * Click the toast. Nothing visibly opens — expected here, because the named agent is not installed. Confirm the reason in the terminal: `omarchy agent crash 1; echo "exit=$?"` → `claude is not installed. Choose an installed agent with: omarchy default agent <name>`, `exit=1`. Record this as the skipped part.
  ** Unhappy path in the same breath: `omarchy agent crash abc; echo "exit=$?"` → `Not a PID: abc` and `Usage: omarchy agent crash <pid>   (see: coredumpctl list)`, `exit=1`.
  * Round trip: type `rm ~/.config/omarchy/defaults/agent`, press Super+Shift+comma to clear toasts, close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The toast is critical and stays until dismissed; screenshot it before clicking.
  * If no toast appears with the agent set, `journalctl --user -u omarchy-crash-watch -n 20` explains why — include it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after the first crash: no toast, but a `sleep` SIGSEGV row in `coredumpctl list`
  ** Screenshot of the "Process crashed: sleep" toast after setting the agent; no duplicate after the immediate second crash
  ** Screenshot of the "claude is not installed" and "Not a PID" messages with `exit=1`
  ** Skipped: the agent launch and diagnosis (no agent binary / API key in the guest)
  * If unsuccessful
  ** Screenshot of `systemctl --user status omarchy-crash-watch` and `coredumpctl list`
covers: docs/notifications.md §Crash capture; bin/omarchy-crash-watch:64-108; bin/omarchy-agent-crash; bin/omarchy-agent:40-52; manual/17-ai.md §Crash diagnosis

### crash-mute-one-program   [VM-OK]
description: A user silences crash notifications for one program by name or by path, sees it listed, lifts the mute, and gets clear errors for a bad name or action — the per-program switch the diagnose-crash skill offers at the end of a diagnosis.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` (crash toasts need a default agent name).
  * Type `omarchy crash mute` → `No programs muted. Crashes all notify.`
  * Type `omarchy crash mute /usr/bin/sleep` → `Muted crash notifications for sleep.`; then `omarchy crash mute` → `sleep`.
  * Type `sleep 300 & sleep 1; kill -SEGV $!`. Wait 5 seconds: NO toast.
  * Type `omarchy crash mute sleep off` → `Crash notifications for sleep are back on.` Wait until 60 seconds have passed since the muted crash (screenshots every 5 seconds), then crash again → the "Process crashed: sleep" toast appears.
  * Unhappy path: type `omarchy crash mute /; echo "exit=$?"` → `Not a program name: /`, `exit=1`; then `omarchy crash mute sleep sideways; echo "exit=$?"` → `Not an action: sideways`, `exit=1`.
  * Round trip: `omarchy crash mute` → `No programs muted. Crashes all notify.`; type `rm ~/.config/omarchy/defaults/agent`; press Super+Shift+comma; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The watcher de-duplicates per program per minute, so the "toast returns" crash must be ≥60 s after the previous crash of `sleep`; bridge the wait with screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty list, the mute confirmation and the list showing `sleep`
  ** Screenshot with no toast after the muted crash; screenshot of the toast after unmuting
  ** Screenshot of the two errors with `exit=1` and the empty list at the end
  * If unsuccessful
  ** Screenshot of `ls -la ~/.local/state/omarchy/toggles/crash-ignore/`
covers: bin/omarchy-crash-mute; bin/omarchy-crash-watch (crash-ignore flag); default/agents/skills/diagnose-crash/SKILL.md §Offer to stop the notifications; manual/17-ai.md

### crash-capture-toggle   [VM-OK]
description: Trigger › Toggle › Crash Capture switches crash notifications off and on for the whole machine with a confirmation toast, stopping and starting the watcher — the global switch the diagnose-crash skill names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` so crash toasts can appear; `systemctl --user is-active omarchy-crash-watch.service` → `active`.
  * Press Super+Space → Trigger → Toggle → click "Crash Capture" with the mouse. A toast "Crash capture disabled" appears.
  * Type `systemctl --user is-active omarchy-crash-watch.service` → `inactive`; then `sleep 300 & sleep 1; kill -SEGV $!` → NO "Process crashed" toast.
  * Press Super+Ctrl+O (the Toggle menu hotkey) → click "Crash Capture" → toast "Crash capture enabled"; `systemctl --user is-active omarchy-crash-watch.service` → `active`.
  * Wait 60 seconds (screenshots every 5 s), then `sleep 300 & sleep 1; kill -SEGV $!` → the "Process crashed: sleep" toast appears.
  * CLI form: type `omarchy toggle crash-capture` → "Crash capture disabled" toast; type it again → "Crash capture enabled".
  * Round trip: type `rm ~/.config/omarchy/defaults/agent`; press Super+Shift+comma; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Typing `crash` in the root menu search jumps straight to the Crash Capture row.
  * Use the mouse for the menu clicks so the row's click path is exercised.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Crash capture disabled" and "enabled" toasts (menu) and the same pair from the CLI
  ** Screenshots of `inactive`/`active` and of no toast while disabled versus a toast after re-enable
  * If unsuccessful
  ** Screenshot of `systemctl --user status omarchy-crash-watch` and `ls ~/.local/state/omarchy/toggles/`
covers: bin/omarchy-toggle-crash-capture; default/systemd/user/omarchy-crash-watch.service; omarchy-menu.jsonc trigger.toggle.crash-capture; default/hypr/bindings/utilities.lua:5; diagnose-crash/SKILL.md:119-120

### agent-launch-without-default   [VM-OK]
description: On a stock install with no default agent, the agent hotkey opens the picker, `omarchy agent` explains how to choose one, prompts and unknown names are rejected with usable messages — the first-contact path to the AI integration.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy default agent; echo "exit=$?"` → prints nothing and `exit=0`.
  * Type `omarchy agent; echo "exit=$?"` → `Choose default agent with: omarchy default agent <name>`, `exit=1`; no window opens.
  * Type `omarchy agent hello there; echo "exit=$?"` → `Unexpected argument: hello` and `To pass a prompt: omarchy agent prompt "hello there"`, `exit=1`. Then `omarchy agent prompt; echo "exit=$?"` → `Usage: omarchy agent prompt [--inline] <prompt...>`, `exit=1`.
  * Press Super+Shift+Ctrl+A → the menu opens at Setup › Default › Agent with fourteen rows (Antigravity … Pi), none ticked.
  ** Rows drawn with the private omarchy icon font (Codex, Cursor CLI, Grok, Hermes, omp, OpenClaw, OpenCode, Ori, Pi) must show a brand glyph, not a hollow box. Screenshot at full size. Do not select a row — it would start a network install. Press Escape.
  * Unhappy path: type `omarchy default agent notanagent; echo "exit=$?"` → `Usage: omarchy-default-agent <pi|omp|opencode|ori|claude|codex|grok|openclaw|agy|hermes|copilot|crush|cursor-agent|muse>`, `exit=1`.
  * Type `omarchy | grep '^  agent '` → `agent  AI coding agent usage data`; note in the report that the root command launches an agent while the description covers only usage data.
  * Close the terminal with Super+W; no agent window was opened.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker's header reads "Default Agent"; the Claude row uses a Nerd Font glyph and is a good reference for what a rendered glyph looks like.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the four error messages with their exit codes
  ** Screenshot of the Default Agent picker: fourteen rows, none ticked, all glyphs rendered
  ** Screenshot of the unknown-agent usage list and the group description line
  * If unsuccessful
  ** Screenshot of the picker showing a missing glyph; `fc-list | grep -i omarchy`
covers: bin/omarchy-agent; bin/omarchy-agent-prompt; bin/omarchy-default-agent; default/hypr/bindings/utilities.lua:97; omarchy-menu.jsonc setup.default.agent.*; agents/skills/icon-font.md; bin/omarchy GROUP_DESCRIPTIONS[agent]

### agent-skills-linked-into-harnesses   [VM-OK]
description: Provisioning links both shipped skills (`omarchy`, `diagnose-crash`) into the skill folders of every supported agent harness, pointing into the read-only package tree, so any agent the user installs finds them; the package tree itself refuses writes as the skill promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and press Super+F for a full screen.
  * Type `ls -la ~/.agents/skills ~/.claude/skills ~/.codex/skills` → each directory holds exactly two symlinks, `omarchy` and `diagnose-crash`, pointing to `/usr/share/omarchy/default/agents/skills/<name>/`.
  * Type `ls -la ~/.pi/agent/skills ~/.gemini/config/skills ~/.hermes/skills` → the same two links each; then `ls ~/.hermes/profiles` → "No such file" (profiles are never created).
  * Type `head -3 ~/.claude/skills/omarchy/SKILL.md` → the frontmatter starting `name: omarchy`; then `ls ~/.codex/skills/omarchy/ ~/.codex/skills/diagnose-crash/` → SKILL.md with capture.md, contributing.md, hooks.md, hyprland.md, plugins.md, theming.md; and SKILL.md with reporting.md.
  * Type `touch /usr/share/omarchy/test-write; echo "exit=$?"` → Permission denied, `exit=1` (the tree the skill says never to edit is root-owned); then `cat "$OMARCHY_PATH/config/omarchy/shell.json" | head -3` → readable (reading is allowed).
  * Type `ls ~/.local/state/omarchy/done/` → `finalize-user` and `first-run-user`.
  * Press Super+F, then Super+W to close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the six listings do not fit one screen, send them to serial: `ls -la <dirs> | sudo tee /dev/ttyS0` and read with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot(s) of the six skill directories each with the two symlinks to /usr/share/omarchy/default/agents/skills/
  ** Screenshot of the frontmatter, the guide listings, the Permission denied, and the done markers
  * If unsuccessful
  ** Screenshot of `ls -la ~ | grep -E '^\.(agents|claude|codex|pi|gemini|hermes)'`
covers: docs/file-layout.md §Runtime finalization (skill symlinks, markers); bin/omarchy-provision-user:87-101; default/agents/skills/omarchy/SKILL.md §Critical Safety Rules, §Topic Guides

### agent-skill-commands-resolve   [VM-OK]
description: Every command the shipped `omarchy` agent skill and its topic guides tell an agent to run resolves in the router and answers `--help`, so an AI agent following the skill is never sent down a dead route.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type the loop below on one line, then answer the sudo prompt with `prime`:
    `for c in "theme set" "theme list" "theme current" "theme bg next" "theme install" "refresh shell" "refresh hyprland" "refresh hyprsunset" "refresh config" "restart shell" "restart terminal" "restart hyprsunset" "toggle nightlight" "bar move" "plugin clone" "plugin add" "plugin remove" "hook install" "install" "launch browser" "capture screenshot" "capture text" "capture webcam resize" "screenshot" "screenrecord" "reminder" "pkg add" "pkg aur add" "setup security fingerprint" "update" "version" "debug" "system lock" "system shutdown" "system reboot" "reinstall" "menu keybindings" "font list" "font current" "font set" "share clipboard" "share file" "tailscale send" "tailscale receive" "transcode" "default agent" "agent prompt" "agent crash" "crash mute" "toggle crash-capture" "install docker dbs"; do printf '%-28s ' "$c"; omarchy $c --help 2>&1 | grep -m1 -E '^(Usage|Unknown Omarchy|Binary)'; done 2>&1 | sudo tee /dev/ttyS0 >/dev/null`
  * Read the serial log: one line per command, each showing `Usage` (or `Binary`). Any line containing `Unknown Omarchy command` is skill drift — quote it in the report.
  * Spot-check that the skill's example strings run harmlessly: type `omarchy theme list | head -5`, `omarchy font current`, `omarchy version`, `omarchy menu keybindings --print | grep 'SUPER + F'` → each prints (themes, a font name, `4.0.x`, the Super+F binding).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type the loop exactly; a mistyped quote makes bash wait for more input — press Ctrl+C and retype.
  * `grep -m1` keeps one line per command; a command that prints nothing matching shows as a bare name — run that one by hand and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with one Usage/Binary fragment per command and zero "Unknown Omarchy command" lines (or each drift line quoted)
  ** Screenshot of the four spot-checks printing their expected output
  * If unsuccessful
  ** Serial dump; screenshot of the failing command run by hand
covers: default/agents/skills/omarchy/SKILL.md §Command Groups, §System Commands, §Troubleshooting, §Example Requests; hyprland.md; plugins.md; theming.md; hooks.md; capture.md; contributing.md

### agent-skill-debug-and-version   [VM-OK]
description: `omarchy debug --no-sudo --print` — the exact form the agent skill mandates — prints diagnostics without a password prompt and writes /tmp/omarchy-debug.log, plain `omarchy debug` asks for sudo, and `omarchy version` names the installed package version: the bug-report path in contributing.md and reporting.md.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy version` → `4.0.2` (the installed package version — not `dev (…)`, not `4.0.0.alpha`); then `omarchy version channel` → `stable`.
  * Type `omarchy debug --no-sudo --print 2>&1 | tail -20` → no `[sudo] password` prompt; diagnostic sections scroll past and the tail shows the end of the report.
  * Type `ls -l /tmp/omarchy-debug.log` → the file exists with a non-zero size.
  * Type `head -30 /tmp/omarchy-debug.log | sudo tee /dev/ttyS0 >/dev/null` (password `prime`) and read the header with get-serial.
  * Type `omarchy debug` → a `[sudo] password for prime:` prompt appears. Press Ctrl+C; the shell prompt returns and nothing was uploaded.
  * Type `omarchy-debug --no-sudo --print | head -3` → also works (the hyphenated name the GitHub bug template asks for).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not type the password at the interactive `omarchy debug` prompt — the interactive path offers to upload the log to the internet.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the version and channel lines
  ** Screenshot of the `--no-sudo --print` tail with no password prompt and the log file size; serial header of the log
  ** Screenshot of the sudo prompt from plain `omarchy debug` before Ctrl+C
  * If unsuccessful
  ** Screenshot of the full stderr of `omarchy debug --no-sudo --print`
covers: default/agents/skills/omarchy/SKILL.md §System Commands; contributing.md; diagnose-crash/reporting.md §Filing a new issue; docs/update-process.md §Channels and versions; .github/ISSUE_TEMPLATE/bug.yml

### agent-skill-refresh-config   [VM-OK]
description: `omarchy refresh config <path>` restores a shipped default with a timestamped backup and a visible diff, does nothing when the file is already stock, refuses a path that is not a shipped config, and — the documented defect — does not reject a `..` path that lands outside ~/.config.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '-- test edit' >> ~/.config/hypr/bindings.lua`.
  * Type `omarchy refresh config hypr/bindings.lua` → red `Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default.`, `Saved backup as …bindings.lua.bak.<epoch>.`, and a green `Changes:` diff containing `-- test edit`.
  * Type `omarchy refresh config hypr/bindings.lua` again → no "Replaced" line (identical files leave no new backup); `ls ~/.config/hypr/*.bak.*` → exactly one backup.
  * Unhappy path: type `omarchy refresh config nosuch/file.conf; echo "exit=$?"` → `Not a shipped user config: nosuch/file.conf`, `exit=1`; then `omarchy refresh config; echo "exit=$?"` → the Usage text, `exit=1`.
  * Documented defect: type `omarchy refresh config ../default/bashrc; echo "exit=$?"` → it copies (`exit=0`) and `ls -l ~/default/bashrc` shows a file outside ~/.config. Record it.
  * Round trip: type `rm -rf ~/default ~/.config/hypr/*.bak.*` and `hyprctl configerrors` → empty. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The "Replaced"/"Changes" lines are coloured red and green; they make the screenshot self-explanatory.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Replaced / Saved backup / Changes output and the single `.bak`
  ** Screenshot of the two refusals with `exit=1`
  ** Screenshot of `ls -l ~/default/bashrc` after the `..` path (defect recorded) and empty `hyprctl configerrors` after cleanup
  * If unsuccessful
  ** Screenshot of `ls -la ~/.config/hypr/`
covers: AGENTS.md §Refresh Pattern (incl. `..` caveat); bin/omarchy-refresh-config; default/agents/skills/omarchy/SKILL.md §Troubleshooting, §Reset to Defaults

### agent-skill-hyprland-rebind   [VM-OK]
description: Following the shipped hyprland.md procedure — check the current binding, add an `o.rebind`, reload and run `hyprctl configerrors` — changes a key live; a syntax error is reported by `configerrors` and the desktop keeps working until the file is restored.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy menu keybindings --print | grep 'SUPER + F$'` → the line binding Super+F to fullscreen. Type `cp ~/.config/hypr/bindings.lua /tmp/bindings.bak`.
  * Type `printf '\no.rebind("SUPER + F", "File manager", { launch = "nautilus" })\n' >> ~/.config/hypr/bindings.lua` then `hyprctl reload; hyprctl configerrors` → configerrors prints nothing.
  * Press Super+F → Nautilus opens (instead of toggling fullscreen). Close it with Super+W. Type `omarchy menu keybindings --print | grep 'SUPER + F$'` → now "File manager".
  * Unhappy path: type `printf '\no.bind(\n' >> ~/.config/hypr/bindings.lua; hyprctl reload; hyprctl configerrors` → an error naming bindings.lua (Lua syntax). The bar and windows still work.
  * Round trip: type `cp /tmp/bindings.bak ~/.config/hypr/bindings.lua; hyprctl reload; hyprctl configerrors` → empty. Press Super+F twice → the terminal goes fullscreen and back (stock binding restored).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nautilus takes a couple of seconds on first launch; take a second screenshot before concluding.
  * `--print` writes the keybinding list to the terminal instead of opening the viewer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Super+F binding line before and after, and of Nautilus opened by Super+F
  ** Screenshot of `hyprctl configerrors` reporting the injected error, then empty after restore
  ** Screenshot of the terminal fullscreen via Super+F at the end
  * If unsuccessful
  ** Screenshot of `tail -5 ~/.config/hypr/bindings.lua` and `hyprctl configerrors`
covers: default/agents/skills/omarchy/hyprland.md §Keybindings; SKILL.md §Edit User Config Directly, §Example Requests; .luarc.json

### shell-json-idle-hot-reload   [VM-OK]
description: Editing `idle.lock` in `~/.config/omarchy/shell.json` — the skill's "lock after ten minutes" example — takes effect without restarting the shell, invalid JSON does not take the bar down, and `omarchy refresh shell` restores the stock file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-shell shell listShellConfig | jq .idle` → `{"screensaver": 150, "lock": 300}`.
  * Type `ls ~/.config/omarchy/shell.json || cp /usr/share/omarchy/config/omarchy/shell.json ~/.config/omarchy/shell.json`, then `jq '.idle.lock = 600' ~/.config/omarchy/shell.json > /tmp/s.json && mv /tmp/s.json ~/.config/omarchy/shell.json`.
  * Wait 3 seconds; type `omarchy-shell shell listShellConfig | jq .idle.lock` → `600` — no restart happened (the bar never blinked).
  * Unhappy path: type `printf '{ not json' > ~/.config/omarchy/shell.json`; wait 3 seconds. The bar is still up, no error toast; `omarchy-shell shell ping` → `ok`; `omarchy-shell shell listShellConfig | jq .idle.lock` → the last good value or the default — report which.
  * Round trip: type `omarchy refresh shell` (confirm if asked) → the file is stock again and `omarchy-shell shell listShellConfig | jq .idle.lock` → `300`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Watch the bar in the screenshots around each edit: a hot-reload leaves it in place; a restart makes it vanish briefly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of idle.lock 300 → 600 with the bar continuously present
  ** Screenshot of the bar alive with invalid JSON and `ok` from ping
  ** Screenshot of idle.lock back to 300 after `refresh shell`
  * If unsuccessful
  ** Screenshot of `cat ~/.config/omarchy/shell.json` and `journalctl --user -n 40 | grep -i shell.json`
covers: docs/omarchy-shell.md §shell.json; default/agents/skills/omarchy/plugins.md §Idle and Lock; SKILL.md ("Lock after ten minutes", "Reset shell/bar to defaults"); bin/omarchy-shell

### shell-ipc-and-bar-move   [VM-OK]
description: The shell answers IPC from the terminal and the `omarchy bar` CLI moves a widget and resets the layout; when the shell is down `omarchy-shell` says so and `omarchy restart shell` brings it back — the plumbing every Omarchy CLI relies on to talk to the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-shell shell ping` → `ok`. Screenshot the bar: the clock is in the centre.
  * Type `omarchy bar move omarchy.clock --section right` → the clock moves to the right section of the bar within a second.
  * Type `omarchy bar reset` → the clock is back in the centre.
  * Unhappy path: type `omarchy bar move nosuch.widget --section right; echo "exit=$?"` → an error and non-zero exit; the bar is unchanged. Then `omarchy-shell shell nosuchmethod; echo "exit=$?"` → an `unknown`/error string; report the exit code (docs say IPC-level misses still exit 0).
  * Type `pkill -x quickshell` → the bar disappears. Type `omarchy-shell shell ping; echo "exit=$?"` → `omarchy-shell is not running`, `exit=1`; then `omarchy-shell -q shell ping; echo "exit=$?"` → silent, `exit=0`.
  * Round trip: type `omarchy restart shell` → the bar returns within ~5 seconds with the clock centred; `omarchy-shell shell ping` → `ok`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Killing quickshell also removes the notification daemon for a moment; that is expected and is repaired by the restart.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the clock centre → right → centre
  ** Screenshot of the failed move and the unknown method reply
  ** Screenshot of the desktop without a bar and the "omarchy-shell is not running" line; the bar back after restart
  * If unsuccessful
  ** Screenshot of `journalctl --user -n 40 | grep -i quickshell`
covers: docs/omarchy-shell.md §IPC, §Installing a third-party plugin (bar CLI); default/agents/skills/omarchy/plugins.md §Bar Layout; SKILL.md (`omarchy bar move`); bin/omarchy-shell; bin/omarchy-bar

### plugin-clone-and-remove   [VM-OK]
description: Cloning a built-in bar widget creates `prime.<name>` under the user plugin folder and switches the bar to it, removing the clone switches back, and the guard rails hold: a built-in cannot be removed and an unconfirmed removal refuses — the skill's "never edit the packaged copy" path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy plugin clone omarchy.clock`; answer any confirmation with `y`. The output names `~/.config/omarchy/plugins/prime.clock/`.
  * Type `jq -r .name ~/.config/omarchy/plugins/prime.clock/manifest.json` → `My Clock`; the clock still shows in the bar. Type `omarchy-shell shell listShellConfig | jq -r '.bar.layout.center[].id'` → includes `prime.clock` and not `omarchy.clock`.
  * Unhappy path: type `omarchy plugin remove omarchy.clock; echo "exit=$?"` → refused (a built-in has no checkout), non-zero. Then `echo | omarchy plugin remove prime.clock; echo "exit=$?"` → `refusing to continue without confirmation; pass --yes`, non-zero; the clone still exists.
  * Type `omarchy plugin remove prime.clock --yes` → success; `omarchy-shell shell listShellConfig | jq -r '.bar.layout.center[].id'` → `omarchy.clock` again; the clock is still in the bar.
  * Unhappy path for adding: type `omarchy plugin add 'ext::sh -c id'; echo "exit=$?"` → refused by the URL check before any warning or clone, non-zero.
  * Press Super+Space → Setup → Plugins → the rows Enable, Disable, Add, Clone, Remove are present. Press Escape and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clone id is `prime.clock` because the user is `prime`.
  * If clone opens its confirmation in a floating terminal, answer there and return to your terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the clone output, `My Clock`, and the layout showing `prime.clock` with the clock still drawn
  ** Screenshot of the two refusals (built-in, unconfirmed) and the successful `--yes` removal with `omarchy.clock` back
  ** Screenshot of the refused URL and of Setup › Plugins
  * If unsuccessful
  ** Screenshot of `ls -la ~/.config/omarchy/plugins/`
covers: docs/omarchy-shell.md §Installing a third-party plugin; default/agents/skills/omarchy/plugins.md §Customizing Built-In Plugins; SKILL.md §Decision Framework; bin/omarchy-plugin-clone; bin/omarchy-plugin-remove; bin/omarchy-plugin-add

### migrate-pending-and-rerun   [VM-OK]
description: On a finished install nothing is pending; deleting one migration marker makes `omarchy migrate --pending` report it, and `omarchy migrate` re-runs that migration safely (idempotent) and restores the marker — the per-user migration model.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy migrate --pending; echo "exit=$?"` → no output, `exit=1`.
  * Type `ls ~/.local/state/omarchy/migrations | wc -l; ls /usr/share/omarchy/migrations | wc -l` → two equal numbers.
  * Type `m=$(ls /usr/share/omarchy/migrations | sort | tail -1); echo $m; head -1 /usr/share/omarchy/migrations/$m` → the newest migration's name and its first line, an `echo "…"` describing it.
  * Type `rm ~/.local/state/omarchy/migrations/$m; omarchy migrate --pending; echo "exit=$?"` → prints `$m`, `exit=0`.
  * Type `omarchy migrate; echo "exit=$?"` → prints that migration's description line, finishes with `exit=0` (type `prime` if sudo asks). Then `ls ~/.local/state/omarchy/migrations/$m` → the marker is back and `omarchy migrate --pending` prints nothing again.
  * Unhappy path: type `omarchy migrate --bogus; echo "exit=$?"` → `Usage: omarchy-migrate [--pending]`, non-zero.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Some migrations call package helpers and can take a little while; wait with 5-second screenshots rather than interrupting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of empty `--pending` with `exit=1` and the equal counts
  ** Screenshot of `--pending` naming the file with `exit=0`, the re-run's echo line with `exit=0`, and the restored marker
  ** Screenshot of the usage error
  * If unsuccessful
  ** Screenshot of the failing `omarchy migrate` output
covers: docs/update-process.md §Migration layout; agents/skills/migrations.md (model, format, manual run, --pending exit codes); bin/omarchy-migrate

### migrate-notify-toast-and-relogin   [VM-OK]
description: When a migration is pending, the login-time notifier shows a critical toast "Click to run 1 pending migration." whose click opens a terminal that runs it; after a clean re-login with nothing pending, no toast appears — the safety net for users who bypass `omarchy update`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `m=$(ls /usr/share/omarchy/migrations | sort | tail -1); rm ~/.local/state/omarchy/migrations/$m; omarchy migrate --pending` → prints the file.
  * Type `systemctl --user restart omarchy-migrate-notify.service` (what login does). Within 5 seconds a critical toast "Click to run 1 pending migration." appears.
  * Click the toast → a terminal opens running `omarchy-migrate`, prints the migration's description line and finishes (type `prime` if sudo asks). The toast is gone. Type `omarchy migrate --pending; echo "exit=$?"` → empty, `exit=1`.
  * Press Super+Escape → click "Logout" with the mouse → at the login screen log in as `prime` / `prime` (or wait for auto-login).
  ** Quirk: the notifier waits for the notification server, so give the desktop 15 seconds of screenshots — with nothing pending, NO migration toast may appear.
  * Open a terminal with Super+Enter; type `rm ~/.local/state/omarchy/migrations/$(ls /usr/share/omarchy/migrations | sort | tail -1)`; log out and in again as above → this time the toast appears within ~15 seconds of the desktop. Click it → the migration runs and the marker is restored.
  * Round trip: `omarchy migrate --pending` → empty. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Logout keeps the disk unlocked; only the login screen is shown, no LUKS passphrase.
  * Use the mouse for the Logout row so the System menu click path is exercised.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "Click to run 1 pending migration." and of the terminal it opens running the migration
  ** Screenshot ~15 s after the clean re-login with no migration toast
  ** Screenshot of the toast after the re-login with a pending marker, and the empty `--pending` at the end
  * If unsuccessful
  ** Screenshot of `journalctl --user -u omarchy-migrate-notify -n 30`
covers: docs/update-process.md §Path 2, §Fallbacks; agents/skills/migrations.md §At login; docs/notifications.md §Pending migrations; bin/omarchy-migrate-notify; default/systemd/user/omarchy-migrate-notify.service

### update-confirm-and-cancel   [VM-OK]
description: `omarchy update` opens with a confirmation box and cancelling leaves the system untouched with the update lock released; the bar's update indicator and its click path lead to the same box — the entry to the blessed update path, without running the slow update itself.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q omarchy` → note the version. Screenshot the bar's right section (an update icon may or may not be present).
  * Type `omarchy update` → a bordered box "Ready to update?" with the bullet "You cannot stop the update once you start!" and the prompt "Continue with update?". Screenshot. Press N (or arrow to No and Enter).
  * The terminal prints `Update cancelled`. Type `pacman -Q omarchy` → unchanged; `omarchy migrate --pending` → empty.
  * Type `flock -n $XDG_RUNTIME_DIR/omarchy-update.lock true; echo "lock-free=$?"` → `lock-free=0` (no stale lock).
  * Type `ls -l /tmp/omarchy-update.log` → exists (transcript starts before the question).
  * If the bar shows the update icon, click it → a floating terminal opens with the same "Ready to update?" box; press N and it closes. If no icon, type `omarchy update available; echo "exit=$?"` → a non-zero exit and "up to date" text, consistent with the missing icon.
  ** Quirk: the icon appears only when `omarchy update available` exits 0; on a 4.0.2 disk it usually does once the shell has checked (on start and every six hours).
  * Close the terminal with Super+W; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The gum box highlights Yes by default; make sure No is highlighted before pressing Enter, or press N.
  * Never confirm the update in this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "Ready to update?" box and of `Update cancelled`
  ** Screenshot of the unchanged package version, empty pending and `lock-free=0`
  ** Screenshot of the bar indicator and the floating terminal it opens (or the consistent "up to date" exit)
  * If unsuccessful
  ** Screenshot of `tail -20 /tmp/omarchy-update.log` and `pgrep -a pacman`
covers: docs/update-process.md §Path 1, §State and coordination files, §Shell update indicator; bin/omarchy-update-confirm; bin/omarchy-update-lock; bin/omarchy-update-available

### update-pacman-guard-blocks-sysupgrade   [VM-OK] [NET]
description: A direct `sudo pacman -Syu` is stopped by Omarchy's pre-transaction hook with the "Woah partner" message pointing at `omarchy update`, while other pacman operations pass — the nudge that keeps users on the blessed path. Needs network for the database sync (≈10 MB) so the transaction reaches the hook.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q omarchy` → note the version; `ls /usr/share/libalpm/hooks/ | grep omarchy` → `00-omarchy-update-guard.hook` is present.
  * Type `sudo pacman -Syu` (password `prime`). The databases sync (screenshots every 5 s), pacman lists upgrades and asks `:: Proceed with installation? [Y/n]` — answer `y`.
  * The hook prints the message beginning `Woah partner...`, naming `omarchy update` and `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, and pacman aborts with `error: failed to commit transaction (failed to run transaction hooks)`.
  ** Quirk: if pacman says `there is nothing to do`, the disk is already current and the hook cannot fire — record VM-PARTIAL for this run.
  * Type `pacman -Q omarchy` → unchanged (no package was upgraded).
  * Type `sudo pacman -Sy; echo "exit=$?"` → `exit=0` (a sync without `-u` is not guarded); `pacman -Qu | head -3` → lists the pending upgrades.
  * Type `omarchy update pacman guard --help` → the hidden guard still answers help. Do NOT run the bypass form — it would upgrade the system.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The database sync can take a minute on the VM's NAT; keep screenshotting rather than retyping.
  * After the hook aborts, the transaction is over — do not answer `y` to anything further.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the "Woah partner..." message followed by pacman's failed-to-commit error
  ** Screenshot of the identical `pacman -Q omarchy` before and after, and `exit=0` for `pacman -Sy`
  * If unsuccessful
  ** Screenshot of `tail -30 /var/log/pacman.log`
covers: docs/update-process.md §Raw pacman guard, §Path 2; bin/omarchy-update-pacman-guard; default/libalpm/hooks/00-omarchy-update-guard.hook

### plans-unshipped-features-absent   [VM-OK]
description: The backup, dots, server and remote-desktop plans are not shipped: their commands do not route, their groups and menu rows do not exist, while the one pre-existing piece — `omarchy install service sunshine` — still resolves with the defects the plan lists. A deliberate absence test that flips when a plan lands.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for r in backup dots server "sunshine pair" "edition server"; do printf '%-16s ' "$r"; omarchy $r 2>&1 | head -1; done` → five lines, each `Unknown Omarchy command: omarchy …`.
  * Type `omarchy | grep -E '^  (backup|dots|server|sunshine|edition) '` → nothing.
  * Type `ls /usr/bin/omarchy-backup* /usr/bin/omarchy-dots* /usr/bin/omarchy-sunshine* 2>&1` → "No such file" for all; `pacman -Q restic 2>&1` → not found.
  * Press Super+Space → Setup: no "Backup" row. Super+Space → Install → Service: no "Sunshine" row. Press Escape each time.
  * Type `omarchy install service sunshine --help` → a Usage naming `omarchy-install-service-sunshine` (the shipped remainder; do not run it). Then `grep -c 'launch_on_start("sunshine")' /usr/bin/omarchy-install-service-sunshine; grep -c ignore-certificate-errors /usr/bin/omarchy-install-service-sunshine` → `1` and `1` (the autostart double-start and the certificate-bypass webapp the remote plan calls out are still in place).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A pass is every negative holding. If any planned command resolves, report "plan shipped" with its help text.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the five Unknown lines, the empty group grep and the missing binaries
  ** Screenshots of Setup and Install › Service without Backup/Sunshine rows
  ** Screenshot of the sunshine help and the two grep counts of 1
  * If unsuccessful
  ** Screenshot of `omarchy commands --all | grep -E 'backup|dots|server|sunshine'`
covers: plans/backup.md; plans/dots.md; plans/server.md; plans/remote.md §Problem, §Command surface, §Menu; bin/omarchy-install-service-sunshine

### audio-tuning-no-matching-hardware   [VM-PARTIAL]
description: On a machine with no matching speaker tuning — and in the guest no audio device at all — `omarchy audio tuning status|on|off` answer cleanly, write nothing and leave the tuning service inactive. Only the absence path is exercisable; applying a tuning needs the matching Dell hardware.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy audio tuning status; echo "exit=$?"` → reports no tuning installed / nothing matches; note the exit code.
  * Type `omarchy audio tuning on; echo "exit=$?"` → a clear "no matching tuning" (or "no speaker sink") message, non-zero; then `ls ~/.config/pipewire/ 2>&1` → no `omarchy-speaker-tuning` entries; `systemctl --user is-active omarchy-speaker-tuning.service` → `inactive`.
  * Type `omarchy audio tuning off; echo "exit=$?"` → a no-op message; report the exit code.
  * Unhappy path: type `omarchy audio tuning bogus; echo "exit=$?"` → usage, non-zero.
  * Type `ls /usr/share/omarchy/default/audio/tunings/` → the shipped tuning directories (e.g. `dell-xps-14`); `head -12 /usr/share/omarchy/default/audio/tunings/*/tuning.conf` → `match_sku`/`sink_pattern` and the measurement fields.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The guest has no sound card, so the audio bar widget may show muted/no device; that is expected and not a failure of this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of status/on/off outputs with exit codes, the empty pipewire dir and `inactive`
  ** Screenshot of the usage error and the shipped tuning listing
  ** Skipped: applying a tuning (needs matching Dell hardware and a real sink)
  * If unsuccessful
  ** Screenshot of `journalctl --user -u omarchy-speaker-tuning -n 20`
covers: docs/audio-tuning.md (commands, gating on match, verification and rollback, service); bin/omarchy-audio-tuning

### provisioned-install-invariants   [VM-PARTIAL]
description: A minted disk shows the provisioning contract: `$OMARCHY_PATH` is the package path in both the desktop and a text console, the first-run user units are enabled (hardware-conditional ones inert), the done markers exist, and About shows the seeded branding. Bluetooth only proves the inert path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo "$OMARCHY_PATH"; omarchy version; which omarchy-theme-set` → `/usr/share/omarchy`, the package version, `/usr/bin/omarchy-theme-set`; then `ls /etc/omarchy.conf` → "No such file" (not dev-linked).
  * Type `for u in bt-agent omarchy-sleep-lock omarchy-recover-internal-monitor omarchy-migrate-notify omarchy-fcitx5 omarchy-crash-watch; do printf '%-36s %s / %s\n' $u "$(systemctl --user is-enabled $u.service)" "$(systemctl --user is-active $u.service)"; done` → every unit `enabled`; crash-watch `active`; bt-agent `inactive` (no Bluetooth — condition unmet); record the others.
  * Type `ls ~/.local/state/omarchy/done/` → `finalize-user first-run-user`; `xdg-settings get default-web-browser` → `chromium.desktop`.
  * Press Super+Space → About → the Omarchy wordmark (from logo.txt) is drawn in a window. Close it with Super+W.
  * Press Ctrl+Alt+F3 → a text console; log in `prime` / `prime`; type `echo $OMARCHY_PATH; omarchy version; exit` → the same two values. Screenshot, then press Ctrl+Alt+F1 (or F2) to return to the desktop.
  ** Quirk: the serial log does not capture TTY3; the screenshot is the proof.
  * Unhappy path: type `omarchy provision user; echo "exit=$?"` → exits quickly with a message that setup is already done, `exit=0`, and no welcome toast reappears.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Ctrl+Alt+F1 shows a text console, the graphical session is on F2.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of OMARCHY_PATH, version, binary path and the missing /etc/omarchy.conf
  ** Screenshot of the six-unit table (bt-agent inactive by condition)
  ** Screenshot of the done markers and browser default; screenshot of About with the wordmark
  ** Screenshot of the TTY3 session printing the same OMARCHY_PATH and version
  ** Skipped: bt-agent active path (no Bluetooth)
  * If unsuccessful
  ** Screenshot of `systemctl --user status <unit>` and `tail -40 /var/log/omarchy-install.log`
covers: docs/file-layout.md §Env bootstrap, §Runtime finalization, §First-run; default/bash/env-bootstrap; install/user/first-run/enable-user-units.sh; logo.txt; icon.txt; bin/omarchy-provision-user

### reinstall-configs-resync   [VM-OK]
description: `omarchy reinstall configs` — the skill's "nuclear option" — replays /etc/skel over the home directory, wiping user edits to shipped files without a backup while leaving extra files alone, and the desktop stays healthy afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '-- user edit' >> ~/.config/hypr/bindings.lua; touch ~/.config/hypr/my-own-file.lua`.
  * Type `omarchy reinstall` → group help listing `configs` and `pkgs` (nothing runs).
  * Type `omarchy reinstall configs`; answer any confirmation with `y` and the sudo prompt with `prime` (limine/plymouth refresh). Wait for it to finish with 5-second screenshots.
  * Type `tail -1 ~/.config/hypr/bindings.lua` → the stock last line (edit gone); `ls ~/.config/hypr/*.bak.* 2>&1` → "No such file" (no backup, as documented); `ls ~/.config/hypr/my-own-file.lua` → still present.
  * Type `hyprctl configerrors` → empty; the bar is up; `omarchy theme current` → unchanged.
  * Round trip: type `rm ~/.config/hypr/my-own-file.lua` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The limine and plymouth refresh print boot-loader output and can take ~30 seconds; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the group help, then of the command finishing
  ** Screenshot of the stock last line, no `.bak`, the extra file kept, and empty `hyprctl configerrors`
  * If unsuccessful
  ** Screenshot of the command's output and `diff /etc/skel/.config/hypr/bindings.lua ~/.config/hypr/bindings.lua`
covers: docs/file-layout.md §Explicit resync; default/agents/skills/omarchy/SKILL.md §Troubleshooting (omarchy reinstall); bin/omarchy-reinstall-configs

### capture-screenshot-and-record-cli   [VM-OK]
description: The capture commands the maintainers' visual-verification skill and the shipped capture guide rely on work from a terminal: a fullscreen screenshot saved straight to disk prints its path, a short screen recording starts, shows an indicator, and stops with a saved video path, and stopping with nothing recording fails cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy capture screenshot fullscreen save` → a path under `~/Pictures/` is printed and no editor opens; `ls -l <that path>` → a PNG with non-zero size.
  * Type `OMARCHY_SCREENSHOT_DIR=/tmp/shots omarchy capture screenshot fullscreen save` → a path under `/tmp/shots/`.
  * Type `omarchy screenrecord --fullscreen` → a recording indicator appears in the bar. Move a window with Super+Shift+Left, wait 5 seconds.
  * Type `omarchy screenrecord --stop-recording` → a path under `~/Videos/` is printed; the indicator is gone; `ls -l <that path>` → non-zero size.
  * Unhappy path: type `omarchy screenrecord --stop-recording; echo "exit=$?"` with nothing recording → a "not recording" style message, no crash. Then `omarchy capture screenshot region` → a region selector appears; press Escape → cancelled, no editor, no new file.
  * Round trip: type `rm -rf /tmp/shots` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No 3D acceleration: the recorder encodes in software; keep the clip to ~5 seconds.
  * The printed path is the last line; copy it exactly for `ls -l`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the printed screenshot path and its `ls -l`; the custom-dir path
  ** Screenshot of the recording indicator, then the printed video path and its size
  ** Screenshot of the not-recording message and the cancelled region selector
  * If unsuccessful
  ** Screenshot of `OMARCHY_SCREENRECORD_DEBUG=true omarchy screenrecord --fullscreen` followed by `cat $XDG_RUNTIME_DIR/omarchy-screenrecord.log`
covers: agents/skills/visual-verification.md; default/agents/skills/omarchy/capture.md; SKILL.md ("Record my screen"); contributing.md (captures for bug reports)

### shipped-skill-agent-changes-theme   [VM-NO] [NET]
description: An AI agent running inside the guest, asked to "change the theme to nord", follows the shipped `omarchy` skill and runs `omarchy theme set nord`; asked about a crash, it follows `diagnose-crash`. Not runnable here: no agent is preinstalled (a mise install is 50–200 MB) and every agent needs an API key or login the driver does not have.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Precondition not achievable in this harness) A default agent is installed and logged in: `omarchy default agent opencode` has completed and `opencode` accepts a provider key.
  * Open a terminal with Super+Enter and type `omarchy agent prompt "Change my theme to nord, then confirm the current theme."`.
  * An agent window opens (app-id org.omarchy.agent, working directory ~/Work); its transcript shows it reading the `omarchy` skill and running `omarchy theme set nord` — never editing anything under /usr/share/omarchy. The desktop retints to Nord.
  * Type `sleep 300 & sleep 1; kill -SEGV $!` and click the "Process crashed: sleep" toast → the agent opens with the prepared prompt naming the diagnose-crash skill, runs `coredumpctl info`, reports signal and command line, offers `omarchy-crash-mute 'sleep'` without running it, and does not file an issue (gh is not authenticated).
  * Round trip: type `omarchy theme set tokyo-night`; close the agent window with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Record as not runnable unless the harness can supply an API key inside the guest.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the agent transcript reading the skill and running `omarchy theme set nord`, with the desktop retinted
  ** Screenshot of the crash-diagnosis transcript following the skill's report format and offering the mute
  * If unsuccessful
  ** Screenshot of the agent transcript and of `omarchy default agent`
covers: default/agents/skills/omarchy/SKILL.md (whole); default/agents/skills/diagnose-crash/SKILL.md, reporting.md; bin/omarchy-agent; bin/omarchy-agent-crash; manual/17-ai.md

### update-full-run   [VM-NO] [NET] [SLOW]
description: A full `omarchy update -y` on the 4.0.2 disk runs the documented order — free-space check, cache prune, snapshot attempt, packages, migrations, post-update hook, shell restart, reboot prompt — and clears the bar's update indicator. On a stale base this exceeds the ten-minute budget (hundreds of MB); kept for the appendix.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `printf '#!/bin/bash\ndate > /tmp/post-update-ran\n' > /tmp/pu.sh; omarchy hook install post-update /tmp/pu.sh`; note `pacman -Q omarchy` and whether the bar shows the update icon.
  * Type `omarchy update -y` → no confirmation box; the snapshot step prints (skipped or a loud failure, then continues); pacman upgrades; migration echo lines follow; then hooks. Screenshot every 5 seconds throughout.
  * At the end the bar blinks (shell restart); if a kernel or Hyprland was upgraded a gum "Reboot?" box appears — press N.
  * Type `cat /tmp/post-update-ran` → a date; `omarchy migrate --pending` → empty; `omarchy version` → the new version; the update icon is gone from the bar.
  * Type `flock -n $XDG_RUNTIME_DIR/omarchy-update.lock true; echo "lock-free=$?"` → `lock-free=0`.
  * Round trip: type `rm ~/.config/omarchy/hooks/post-update.d/pu.sh` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Expect 10–30 minutes over the VM's NAT; never wait more than 5 seconds between screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the pipeline stages in order and of the shell restart
  ** Screenshot of the hook's date file, empty pending, new version, no indicator, `lock-free=0`
  * If unsuccessful
  ** Screenshot of `tail -40 /tmp/omarchy-update.log` and `omarchy update analyze logs`
covers: docs/update-process.md §Path 1 (full pipeline), §Update-related binaries; bin/omarchy-update-restart; default/agents/skills/omarchy/hooks.md (post-update.d)

### sunshine-service-install-remove   [VM-PARTIAL] [NET] [SLOW]
description: `omarchy install service sunshine` installs Sunshine, opens the Moonlight ports, enables the unit, adds the admin webapp and (still) the autostart line; `omarchy remove service sunshine` reverses those but keeps `~/.config/sunshine/`. Streaming itself is skipped (no encoder, no client); the package download is ≈100 MB.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy install service sunshine` (password `prime` when asked). Wait for completion with 5-second screenshots. Chromium opens on https://localhost:47990 with a certificate-error bypass — screenshot it and close it with Super+W.
  * Type `pacman -Q sunshine; systemctl --user is-active sunshine; grep -c 'launch_on_start("sunshine")' ~/.config/hypr/autostart.lua` → installed, active or failed (report the state — the VM has no encoder), `1`.
  * Type `sudo ufw status | grep -c omarchy-sunshine` → several rules (the three private ranges; no tailscale0 rules since Tailscale is absent). Press Super+Alt+Space → type `Sunshine` → the "Sunshine Admin" webapp row is listed. Press Escape.
  * Type `omarchy remove service sunshine`; confirm. Then `pacman -Q sunshine 2>&1; sudo ufw status | grep -c omarchy-sunshine; grep -c 'launch_on_start("sunshine")' ~/.config/hypr/autostart.lua; ls ~/.config/sunshine/` → not found, `0`, `0`, and the config directory still exists (pairing state kept).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The installer needs network for pacman; allow several minutes of screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the admin webapp with its certificate bypass; the package/unit/autostart line after install; the ufw count and the launcher row
  ** Screenshot after removal: package gone, 0 rules, 0 autostart lines, `~/.config/sunshine/` still present
  ** Skipped: pairing and streaming (no Moonlight client, no hardware encoder)
  * If unsuccessful
  ** Screenshot of `journalctl --user -u sunshine -n 50`
covers: plans/remote.md §Problem (current defects), §Uninstall symmetry; bin/omarchy-install-service-sunshine; bin/omarchy-remove-service-sunshine; manual/26-gaming.md

## Gaps

Behaviours found in scope that could not be turned into a driver test, and why:

- **Router internals not observable from a shell**: metadata read only from the first 80 comment lines; malformed `omarchy:` lines ignored; first-registration-wins on collisions (no collision exists at HEAD to observe); `omarchy dev benchmark cli` latency tracking. These are `test/cli` territory and need repo edits to provoke.
- **`omarchy commands --check` catching a phantom `GROUP_DESCRIPTIONS` entry** — it does not (Observation 1); the driver test records the symptom, but the missing lint rule is a code change, not a test.
- **Notification lifetime edge cases** (hover pausing exactly, `replaces_id` in-place update keeping the file identity, image copying into `notifications/images/`, history "restored rows never matched against live ids"): partially covered; exact timings and file-identity claims need `test/shell.d` unit tests rather than screenshots.
- **Menu provider `power-profiles` and `volatile` re-enumeration**: no battery/power-profiles daemon target in the VM; `fonts` provider covered instead.
- **Menu select/input dmenu modes' tempfile handshake** (`omarchy-menu-select`, `-input`) — exercised indirectly by the theme switcher; the cancel-exits-1 contract is only provable from a script.
- **Shell facades / capability scoping for third-party plugins** (docs/omarchy-shell.md §manifest): needs a third-party plugin repo; none vetted and NET. The negative URL checks are covered.
- **`shell.toml` token grammar** (gradients, per-side widths, `[controls]` states, `[spacing]`, `[font]` scale): rendering differences are too subtle for screenshot judgement; belongs in visual-verification by a human or pixel tests. The one observable — `omarchy display text size` surviving a theme switch — is plausible as a follow-up test once the command's UX is confirmed.
- **Theme template helper semantics** (`mix`, `hypr_gradient`, legacy key aliases, `urgent` ignored): rendered output is checked only for "no `{{` left"; value correctness is `test/cli`.
- **Audio tuning positive path** (Dell XPS SKU match, sink verification, rollback, EasyEffects refusal, volume-through-tuning): no audio device in the guest.
- **Trimmed from tests to keep them one story each** (still in-guest, could become follow-ups): the notifier staying silent while `omarchy update` holds its lock (needs an `flock` held open in a second terminal); `omarchy done` bare usage and `omarchy done check nosuch`; the Kitty `allow_remote_control socket-only` default and the plocate `updatedb` drop-in (visible only via `grep`/`systemctl cat`); `omarchy share|tailscale send|transcode` help (another reviewer's capture chapter); `omarchy-shell shell setPluginEnabled … maybe` literal-"true" rule; the `omarchy -y` unattended flag outside the appendix full update.
- **Update pipeline pieces**: snapper snapshot success (snapper is configured on Btrfs installs — could be observed in the appendix full-update test), `omarchy-update-system-pkgs-when-conflicted` quarantine, `-y` orphan skip, stay-awake inhibitor lifecycle, `omarchy channel set rc|edge|dev` (mutates mirrorlist and swaps packages: NET+SLOW and risky), `omarchy update firmware` (fwupd, no firmware in VM).
- **Migration authoring rules** (0644, no shebang, first-line echo, `omarchy-dev-add-migration`) are checked for the newest shipped file only; whole-directory conformance is a repo test.
- **Hyprland reload-guard ALPM hooks** (pause/resume around settings-package upgrades): only fires during a package upgrade of `omarchy-settings` — appendix full update.
- **Backup/dots/server plan behaviours**: nothing to test; absence asserted.
- **Remote plan phase 1/2 behaviours** (terminal PIN pairing, headless output, virtual sink, managed config block): not shipped.
- **Maintainer skills that are pure procedure** (`acceptance-tests.md` ISO harness flags, `icon-font.md` `omarchy dev font add`, `shell-dev.md` glyph-editing caveat, `install-scripts.md` leaf conventions): no user-facing surface; the one observable — brand glyphs rendering in the Default Agent picker — is covered.
- **Diagnose-crash skill's investigative method** (symbolizing with gdb+debuginfod, OOM correlation, thread inspection, report format) and **reporting.md** (gh search/comment/create, signing): requires an agent with model access and, for filing, an authenticated `gh` — VM-NO. `coredumpctl info` availability and the mute offer's command are covered.
- **`omarchy default agent <name>` install path** (mise fetch, floating terminal, first launch, `omarchy-install-chromium-claude` side effect): NET (50-200 MB per agent) and each agent then demands login; only the picker and the pre-install error paths are covered.
- **Agents bar panel** (`omarchy agent usage-update`, Claude/Codex/Fireworks usage): needs real usage data on disk — other reviewer's chapter, and VM-NO regardless.
- **Rule-zero exclusions checked**: no test needs an XF86 media/power key, a second monitor, a lid, a battery or any host-side action; the crash tests provoke the crash with `kill -SEGV` typed in the guest terminal, and the "cloned theme" test uses an in-guest `git init` instead of a network clone.
- **CI**: there is none to test. `.github` issue templates and SECURITY.md are GitHub-side process, not guest behaviour.
- **`.editorconfig`, `.luarc.json`, `.gitignore`, `version`**: repo hygiene; `version` (`4.0.0.alpha`) is intentionally not what `omarchy version` reports on an install, and the `.luarc.json` omission of the `o` global only affects editor diagnostics for contributors.
