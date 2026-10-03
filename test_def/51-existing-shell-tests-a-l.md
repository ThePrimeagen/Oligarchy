# 51 — Existing maintainer shell tests, `test/shell.d/[a-l]*-test.sh`

## Scope

Reviewed, every line: `/tmp/omarchy-review/omarchy/test/shell.d/[a-l]*-test.sh` — **118 files, 17,619 lines**
(`acceptance-helpers-test.sh` … `logging-test.sh`), plus the harness they source: `test/shell` (runner,
36 lines) and `test/shell.d/base-test.sh` (127 lines: `pass`/`fail`/`require_command`/`require_compositor`/
`run_node_test`). Fixture files referenced (`test/shell.d/fixtures/**`) were not read; the QML fixtures
(`bar-widget-contract`, `indicator-contract`, `lock-fingerprint-indicator`, `lock-password-overflow`) are
launched by the test files and their contracts are summarised from the test file's own assertions.

Also consulted (read-only, to make the driver instructions exact): `default/omarchy/omarchy-menu.jsonc`
(menu paths), `default/hypr/bindings/*.lua` (hotkeys), `bin/omarchy` (`GROUP_DESCRIPTIONS`, routes),
`bin/omarchy-restart-shell`, `bin/omarchy-launch-shell`, `bin/omarchy-hyprland-session-locked`,
`bin/omarchy-update-pacman-guard`, `bin/omarchy-toggle-idle`, `default/libalpm/hooks/*.hook`, and the
`manual/` chapter list (for the "not in any manual" question).

Skipped on purpose (pure code-style, listed in Gaps): `bin-style-test.sh`. `qml-text-format-test.sh` is in
the m–z half (file 52) and is not in this scope.

Conventions in the Inventory: each `###` block names the source under test (`src:`), whether the asserted
behaviour is visible on screen in the guest (`screen:`), and how a screenshot-only driver can reach it
(`driver:`). Per-line tags override the block default: `[unit]` = pure code/unit-level (no driver path),
`[static]` = a check on shipped files the driver can only re-read in a terminal, `[hw-absent]` = the QEMU
guest can only exercise the *absence* path of mocked hardware, `[host]` = host-side test tooling,
`[NET]`/`[SLOW]` as in 00-FORMAT.md.

## Inventory

### acceptance-helpers-test.sh (53 lines)
src: `test/acceptance.d/base-test.sh` (`layer_on_screen`, `layer_off_screen`) · screen: no · driver: none — host-side acceptance helper arithmetic over mocked `hyprctl monitors/layers` JSON.
- `layer_on_screen` finds a visible layer on a positively-offset monitor (DP-1 at x=1920). [host]
- `layer_off_screen` sees a right-parked layer (x = monitor width) as off a positively-offset monitor. [host]
- `layer_on_screen` finds a visible layer on a negatively-offset monitor (x=-2560). [host]
- `layer_off_screen` sees a left-parked layer (x=-26) as off a negatively-offset monitor. [host]
- a rotated monitor (`transform:1`) uses the transformed height for the on-screen test. [host]
- a rotated monitor uses the transformed width for the parked test. [host]

### agent-invitation-test.sh (63 lines)
src: `install/user/first-run/setup-agent.hook`, `bin/omarchy-notification-send --exec`, `bin/omarchy-done` · screen: yes (a toast) · driver: run the installed hook from a terminal (`bash ~/.config/omarchy/hooks/post-update.d/setup-agent.hook`) and watch the notification; check `~/.local/state/omarchy/done/agent-setup-invitation`.
- first run with no default agent writes the done marker `~/.local/state/omarchy/done/agent-setup-invitation`.
- the hook file stays installed after it has run (`hooks/post-update.d/setup-agent.hook`).
- exactly one notification is sent.
- the notification's click action is `omarchy menu summon setup.default.agent` (opens Setup → Defaults → Agent).
- a second run does not notify again (marker gates it).
- when `~/.config/omarchy/defaults/agent` already names an agent the hook is silent **and** leaves the marker unset (so clearing the choice later still gets an invitation).

### agents-panel-test.sh (17 lines)
src: `shell/plugins/agents/Panel.qml` · screen: yes (bar widget `omarchy.agents`) · driver: mouse clicks on the agents pill in the bar's right section.
- the panel has a `launchAgent()` that runs `omarchy-agent --pick`.
- right-click on the agents widget launches the default agent (or the picker when none is set).
- middle-click still advances to the next subscription/provider.
- left-click still toggles the panel open/closed.
- right-click no longer means "refresh now".

### agents-rename-migration-test.sh (80 lines)
src: `migrations/1786099804.sh` (model-usage → agents rename) · screen: indirectly (bar widget id) · driver: hand-craft an old-style `shell.json` and run `bash /usr/share/omarchy/migrations/1786099804.sh` in a terminal, read the file back with `jq`.
- `omarchy.model-usage` object entries are renamed to `omarchy.agents` and keep their settings (`syncMode`, `syncDir`).
- string-form entries (`"omarchy.model-usage"`) are renamed too.
- a disabled `omarchy.model-usage` in `disabledPlugins` stays disabled under the new id.
- the old scanner cache `~/.cache/omarchy/model-usage` is dropped.
- the migration primes usage data by calling `omarchy-agent-usage-update` exactly once.
- rerunning is idempotent (config hash unchanged).
- an unparsable `shell.json` (`{ not json`) is left byte-for-byte untouched rather than truncated.

### agent-usage-claude-limits-test.sh (243 lines)
src: `bin/omarchy-agent-usage-claude` (`probe_limits`, `collect_limits`, `write_json`), `shell/plugins/agents/Panel.qml` (`limitWindows`) · screen: yes (agents panel "Session"/"Weekly" bars, status line) · driver: open the agents panel; without Anthropic auth the guest can only see the "Waiting for auth" path; all payload-shape assertions are unit-level.
- flat `five_hour`/`seven_day` buckets become "Session (5-hour)" and "Weekly (7-day)" limits. [unit]
- every model-scoped window (`weekly_scoped`, `five_hour_scoped`) is read once, titled "<Model> Weekly"/"<Model> Session". [unit]
- a model with only an id (`display_name: null`) is titled by id ("claude-opus-5 Weekly"). [unit]
- a repeated window, a blank model name and a non-numeric percent are dropped. [unit]
- fraction-scale payloads (0.78) are read on the payload's own scale, not assumed percentages. [unit]
- a payload with no scoped entries adds no " Weekly" limit beyond the flat ones. [unit]
- an expired token reports `usageStatusText: "Sign-in expired"` and `authHelpText` mentioning `claude auth login` instead of hiding the limits section. [unit — but the string is what the panel shows]
- with an expired token only cached windows whose `resetsAt` is still in the future are kept. [unit]
- a wholly reset cache yields `limits: []` but still "Sign-in expired", and no "last known" promise. [unit]
- no token at all → `usageStatusText: "Waiting for auth"`, open cached windows still served. [VM: this is what the guest shows]
- a live token that cannot connect falls back to cache and sets `retryAdvised: true`. [unit]
- a cache younger than the probe interval is reused (0 probes). [unit]
- `--force` re-probes despite a fresh cache and returns the probe's numbers. [unit]
- a successful probe is written back to `claude-limits.json`. [unit]
- Panel `limitWindows` uses a collector-supplied `title` verbatim ("Opus 5 (1M context) Weekly") instead of parsing a window out of the label. [unit]
- without a title the panel still derives "Weekly" from "Weekly (7-day)". [unit]

### agent-usage-claude-scanner-test.sh (180 lines)
src: `bin/omarchy-agent-usage-claude --force` · screen: yes (agents panel token counts) · driver: seed `~/.claude/projects/*/*.jsonl` / `~/.claude/history.jsonl` from a terminal, run `omarchy agent usage update claude`, inspect `~/.local/state/omarchy/agents/usage/claude.json` and the panel.
- each API message id is counted once even when its event is duplicated (58793 tokens for the fixture).
- token categories stay mutually exclusive per model (`cacheCreationInputTokens`, `cacheReadInputTokens`, `inputTokens`, `outputTokens`).
- the record identifies itself `id: claude` and reports `usageStatusText: "Waiting for auth"` without a token.
- with no transcripts and no stats-cache, today's prompts/sessions come from `history.jsonl` (2/2).
- Anthropic usage spent through opencode's `opencode.db` is counted (reasoning included), filtered to provider `anthropic` exactly (not `anthropic-proxy`), assistant role only, malformed rows ignored.
- pi (`~/.pi/agent/sessions`) and omp (`~/.omp/agent/sessions`) JSONL sessions are counted, filtered to Anthropic providers.
- eight concurrent `write_json` writers to one cache file all land, leave one intact file, no temp leftovers, mode 0644. [unit]

### agent-usage-codex-scanner-test.sh (605 lines)
src: `bin/omarchy-agent-usage-codex` · screen: yes (agents panel) · driver: seed `~/.codex/sessions/YYYY/MM/DD/*.jsonl` and/or `~/.local/share/opencode/opencode.db`, run `omarchy agent usage update codex`, inspect `codex.json` and `~/.cache/omarchy/agent-usage/codex-scan-*.json`.
- the collector invokes `codex -s read-only -a on-request app-server` (argv boundaries exact). [unit]
- each turn's `last_token_usage` is counted once (210 total). [unit]
- cache and reasoning tokens are not double counted per model. [unit]
- the record is `id: codex` with `limits: []` when the app-server returns none.
- pi/omp sessions with `openai-codex` providers are counted; Anthropic rows in them are not.
- opencode OpenAI usage is counted (reasoning included), `openai-local` and user rows ignored, malformed rows skipped via `json_valid()`.
- the first scan writes a versioned cache envelope (`schemaVersion: 1`, `stats.todayTotalTokens`, `scanDate`) with mode 644.
- a corrupt-but-parseable cache (`[]`) is a miss: rescan and rewrite.
- `--limits-only` reuses cached local stats (no rescan) while the cache is fresh.
- `--force` rescans past the cache; a following `--limits-only` sees the refreshed cache.
- `--limits-only` rescans when the cache is older than 15 minutes.
- no-flag mode reuses a seconds-old cache but rescans once it is ≥30 s old (lowest `refreshIntervalSec`).
- `--limits-only` still reuses a 10-minute-old cache the no-flag mode would refresh.
- a cache stamped with another `scanDate` is a miss and the rewrite is stamped with today.
- a future-dated cache (clock moved back) is a miss.
- first `--limits-only` with no cache falls back to a full scan.
- good opencode rows are counted past malformed ones (trailing garbage, non-JSON).
- an unwritable cache dir (`XDG_CACHE_HOME` is a file) still prints a complete record.
- a scan interrupted by a DB error (no `message` table) reports 0 and is **not** cached; the next `--limits-only` rescans once the DB is whole.

### agent-usage-fireworks-scanner-test.sh (244 lines)
src: `bin/omarchy-agent-usage-fireworks` · screen: yes (agents panel, "Prepaid" tier, balance) · driver: without a Fireworks key the guest only shows the hidden-by-default record; everything else is unit-level against a mocked API.
- without credentials the collector prints a full valid record `id: fireworks, ready: false, hasPromptStats: false`. [VM: absence path]
- today's uncached+cached+output tokens are totalled once (120). [unit]
- cache tokens stay separate in per-model totals. [unit]
- a seven-day token series and a 30-day model window (3 active days) are built. [unit]
- firectl `auth.ini` credentials are read (`fw_test:example`). [unit]
- `Money{units,nanos}` parses to 12.43. [unit]
- the display record contract: `schemaVersion 1, id fireworks, ready true, hasPromptStats false, scope account, tierLabel Prepaid, limits []`. [unit]
- `billingUsage` continuation tokens are followed and pages merged; the first query starts at the local-midnight UTC window. [unit]
- balance is estimated from configured `fundedAmount` when the key cannot read billing (`estimated: true`). [unit]
- a live `:getBalance` ledger is preferred when readable (`estimated: false`). [unit]
- a failed balance lookup preserves token stats and sets `usageStatusText: "Balance unavailable"`. [unit]
- bucket dates resolve in local time east of Greenwich. [unit]
- the opencode `auth.json` key is used only when no explicit key or firectl login exists. [unit]

### agent-usage-update-test.sh (65 lines)
src: `bin/omarchy-agent-usage-update` · screen: indirectly (panel data) · driver: run `omarchy agent usage update` in a terminal, check exit status and `~/.local/state/omarchy/agents/usage/*.json`.
- a collector that prints invalid JSON makes the update exit non-zero (reported), and no `noisy.json` is written.
- each valid collector record is written to `~/.local/state/omarchy/agents/usage/<id>.json`.
- `--except <id>` skips that collector.
- the updater never treats itself (`omarchy-agent-usage-update`) as a collector.
- naming collectors as arguments runs only those and exits 0 when they all pass.

### apply-lock-test.sh (206 lines)
src: `bin/omarchy-apply-lock` (root PAM writer for `/etc/pam.d/omarchy-lock-password` and `omarchy-lock-fingerprint`) · screen: no · driver: the outcome is visible only as "the lock screen can authenticate"; the PATH-poisoning matrix needs a user namespace and is host-level.
- when running as root the helper replaces PATH with `/usr/share/omarchy/bin:/usr/local/bin:/usr/bin:/bin` and never keeps a user-controlled directory. [static]
- `fprintd-list` is probed as `/usr/bin/fprintd-list` (absolute, `-x` checked) and never via PATH/`command -v`/`omarchy-cmd-present`. [static]
- as root, a user-planted `fprintd-list` earlier on PATH is never executed; the trusted probe runs as UID 0 with the target user as argument; both PAM files are written. [unit/root-ns]
- the absolute path alone blocks the planted command. [unit/root-ns]
- the trusted root PATH alone blocks the planted command. [unit/root-ns]
- mutation control: removing both protections runs the planted command as UID 0 and lets it control the fingerprint PAM branch (proves the matrix detects the regression). [unit/root-ns]

### app-search-test.sh (157 lines)
src: `shell/services/AppSearch.js`, `shell/plugins/menu/Menu.qml`, `shell/services/AppLibrary.qml`, `default/omarchy/launcher.hides` · screen: yes (Apps menu) · driver: `Super+Alt+Space`, type queries, read rows; delete an entry with `Delete` and confirm.
- with two Hermes desktop entries only the packaged `hermes-desktop` is visible (the `hermes` id is in `launcher.hides`).
- searching `contact` returns only direct matches (Google Contacts), not Calculator as a loose subsequence.
- `fuzzyScore(Calculator, 'contact') < 0`. [unit]
- acronym `gc` still puts Google Contacts first.
- direct name `obs` puts OBS Studio first.
- app rows launch through `appLibrary.launch(...)` (not `entry.execute()`). [unit]
- delete routes through `appLibrary.remove(...)` and closes the menu after confirmation.
- `AppLibrary.remove` runs `omarchy-remove-launcher-entry`. [unit]
- `AppLibrary.launch` runs `uwsm-app -- gtk-launch <id>.desktop` so ids ending in `.desktop` (org.telegram.desktop) resolve. [unit]
- the fallback icon index scans `*/apps/*` and `*/devices/*`. [unit]
- library scans run `bash -c` (not `-lc`) so profile activation does not retrigger the desktop-entry watcher. [unit]
- the Apps submenu re-sorts rows alphabetically after provider refreshes.
- `iconSource` prefers the indexed app icon over an ambiguous themed icon. [unit]
- `beginLaunchFeedback` does not close an OSD a previous launch left on screen. [unit]
- opening the menu refreshes the shared icon index. [unit]

### ascii-test.sh (147 lines)
src: `bin/omarchy-ascii`, router route `omarchy ascii` · screen: yes (terminal output) · driver: run in a terminal, read output/exit codes.
- `omarchy-ascii Omarchy` renders the exact reference wordmark (9 rows, Delta Corps Priest 1 font).
- a leading `M` keeps the leading blank columns figlet.js gives it.
- text can arrive on stdin (`printf Omarchy | omarchy-ascii`).
- piped text renders through the router (`printf Omarchy | omarchy ascii`).
- `LC_ALL=C` draws the same wordmark (column arithmetic counts columns, not bytes).
- no output line ends in trailing blanks.
- `Hi` is 18 columns; a space between words is exactly five columns.
- a block is nine rows; an empty input line still draws its own nine-row block (`A\n\nB` → 27 rows).
- a backslash in the text is a character, not an escape (`A\nB` → 9 rows).
- unusable characters are skipped with `Skipped, no glyph in Delta Corps Priest 1: 4 . 0` on stderr, exit 0, the rest still drawn.
- a skipped control character is named by code (`\x01`), never written raw.
- text the font cannot draw at all (`4.0`) exits 1 and prints nothing.
- an unknown option exits 1 with `Unknown option: --width`.
- text after `--` is text.
- `--help` prints `Usage: omarchy-ascii`.

### audio-test.sh (49 lines)
src: `shell/plugins/panels/audio/Model.js` · screen: yes (audio panel labels) · driver: none in QEMU — **no audio device**, so sinks/streams never exist; all assertions are unit-level. [hw-absent]
- playback streams are detected by `isSink` or type `Stream/Output/Audio`; non-stream nodes rejected. [unit]
- audio sources detected by `audio` property or `Audio/Source` type. [unit]
- output volume names: 0 → "Silenced", 0.9 → "Party mode", muted → "Muted". [unit]
- sink availability list parsing (`name\t1`). [unit]
- device labels cleaned ("Built-in Audio Speakers Output" → "Speakers", mic → "Microphone"). [unit]
- headphone sinks detected and given the headphone glyph; webcam sources get a glyph. [unit]
- stream labels normalised ("spotify" → "Spotify"); Chromium stream matched to its MPRIS player; generic `audio-src` stream labelled from the unmatched active MPRIS player. [unit]

### background-test.sh (21 lines)
src: `shell/plugins/background/Background.qml` · screen: yes (theme switch from background) · driver: Style → Theme picker; visible as "colours change even if the new wallpaper stalls".
- the background's theme switcher applies the theme asynchronously (`omarchy-theme-set "$theme" &`) after selection. [unit-ish]
- a pending theme's colours are applied by a fallback timer even if the image reveal stalls. [unit]

### bar-icon-geometry-test.sh (171 lines)
src: `shell/Ui/BarIconButton.qml`, `BarIndicator.qml`, `Style.bar.*` · screen: yes (bar icons) · driver: only as "icons look aligned" in a screenshot; the numeric checks need the quickshell fixture (not shipped in the guest).
- every bar icon occupies `Style.bar.iconSlot`, paints on `Style.bar.iconCanvas`, is optically centred within 0.5 px, uses `Style.bar.iconFont`. [unit/QML]
- bluetooth/network/audio/monitor/power glyph baselines match. [unit/QML]
- a vector icon shares glyph geometry; vertical icons use the vertical slot. [unit/QML]
- indicators are compact (narrower than an icon slot), use the caption font, are centred; indicator pairs stay compact. [unit/QML]
- compact status icons use `Style.bar.statusSlot`. [unit/QML]

### bar-test.sh (487 lines)
src: `shell/plugins/bar/Bar.qml`, `BarModel.js`, `shell/shell.qml`, `bin/omarchy-bar put` · screen: yes · driver: `omarchy bar …` from a terminal; bar drag/drop with the mouse; Trigger → Toggle → Menu Bar for hide.
- dragging a bar module never mutates `ModuleSlot` positions; the move outline has no post-release settling state. [unit]
- a press-and-hold propagated from a widget above the gesture area does not start a move. [unit]
- `toggleBarTransparency()` is exposed over shell IPC; `putBarWidget` IPC goes through the registry `put`. [unit]
- a hidden bar stays mapped (parked past its edge, `-barSize`) and reserves no space (`ExclusionMode.Ignore`).
- only the visible centre arrangement builds its modules (no duplicate centre widgets). [unit]
- panel routing picks the drawn centre slot over the zero-size placeholder, in either registration order; tolerates none/null. [unit]
- the indicator peek stays open while the pointer is anywhere on the bar; the delayed collapse can only close, never open; hover is counted per bar surface and given back on destruction; only the centre section's hover opens the peek.
- panel hotkeys open the panel on the focused monitor, fall back to any live copy, and close an already-open panel first. [multi-monitor: unit]
- Tab moves between panels within one bar surface. [unit]
- positional panel hotkeys are one-based over the drawn tab order; `togglePanelAt` is exposed over IPC (Super+Ctrl+1..9).
- free-space drops resolve to the nearest insertion edge (before/after, horizontal and vertical); a drop after the pointer leaves the bar is rejected; the insertion marker is drawn in the drag overlay.
- the open-panel mark sits on the desktop-facing edge for top/bottom/left/right bars and is sized from the widget's hint on both axes.
- `normalizePosition('sideways')` → `top`; entry settings/ids extracted from object or string entries. [unit]
- the tray is pinned to the inner edge (`pinTrayToInner` left/right). [unit]
- a settings-only `shell.json` change is applied inline (no rebuild); reorder/add/custom-module/duplicate-id changes rebuild. [unit]
- `expandPath('~/x')`, custom module name safety (`../escape` rejected), custom module type inference and default path `~/.config/omarchy/bar/modules/<id>.qml`. [unit]
- `omarchy-bar put` with **no shell running** carries on: exit 0, stderr `omarchy-shell is not running; <id> was not put on the bar`.
- `put` waits for a shell that is spawning and then reports `<id> is on the bar`.
- `put` fails with `omarchy-shell did not become ready; <id> was not put on the bar` when the shell never becomes ready, or starts then disappears, or vanishes mid-fallback.
- `put --after <missing widget>` against an old shell falls back to placing without the neighbour.
- `put` fails and passes on the shell's message when the shell cannot answer the call (`Function not found.`).
- `put` re-asks while the shell is still scanning plugins (`not ready`), then places.
- `put` through a ready shell prints `<id> is on the bar`.

### bar-text-color-test.sh (43 lines)
src: `bin/omarchy-bar-text-color` · screen: yes (transparent bar text colour) · driver: `omarchy bar transparent true`, switch between a dark theme and a light theme (`flexoki-light`, `catppuccin-latte`, `white`), compare bar text in screenshots.
- a light strip under a transparent bar switches the text to the background colour (`#101010`).
- a dark strip keeps the text colour (`#ffffff`).
- a missing/unsamplable background falls back to the text colour.
- a video wallpaper is sampled one frame at a time (not the whole file). [needs a video wallpaper: unit]

### bar-widget-contract-test.sh (100 lines)
src: every `shell/plugins/**/manifest.json` with kind `bar-widget`, fixture `fixtures/bar-widget-contract/shell.qml` · screen: yes (every bar widget) · driver: only indirectly — all default widgets render without QML errors; the fixture itself is host tooling.
- every bar-widget manifest's `entryPoints.barWidget` loads under quickshell and passes the contract (`ok: true`). [unit/QML]

### battery-status-test.sh (51 lines)
src: `bin/omarchy-battery-status --shell` · screen: yes (power widget) · driver: **no battery in QEMU** — only the absence path (`omarchy battery status --shell` prints nothing / power widget hidden). [hw-absent]
- `--shell` prints `percentage\t51%`, `state\tdischarging`, `rate\t10.8W` (live sysfs current×voltage), `size\t56Wh`, `time\t2h 30m`. [hw]
- no other script/doc refers to the retired `omarchy-battery-capacity|remaining|remaining-time`. [static]

### battery-test.sh (31 lines)
src: `shell/plugins/services/battery/BatteryModel.js` · screen: yes (low-battery toast) · driver: none (no battery). [hw-absent]
- display percentage rounds (0.126 → 13); missing battery → -1. [unit]
- discharging requires both device state and on-battery. [unit]
- low-battery warning fires once under threshold, stays silent while notified, clears after recovery. [unit]

### battlenet-test.sh (14 lines)
src: `bin/omarchy-install-gaming-battlenet`, `default/applications/battlenet.desktop` · screen: yes (Battle.net launcher only after install) · driver: Apps menu has no Battle.net entry on a stock disk; installing is NET/SLOW.
- `applications/battlenet.desktop` is **not** part of the default application refresh. [static]
- the installer-only template lives at `default/applications/battlenet.desktop` and the installer copies it from `$OMARCHY_PATH/default/applications/`. [static]

### bin-style-test.sh (14 lines) — skipped (code style), see Gaps.
- no `bin/` script uses `command -v` except the `omarchy-cmd-*`/`omarchy-pkg-*`/`upgrade-to-quattro` helpers. [style]
- no `bin/` script calls `notify-send` directly. [style]

### bluetooth-test.sh (282 lines)
src: `default/systemd/user/bt-agent.service`, `shell/plugins/panels/bluetooth/{Model.js,Panel.qml}`, `bin/omarchy-bluetooth-power`, `bin/omarchy-bluetooth-device`, `install/hardware/bluetooth.sh` · screen: yes (bluetooth widget/panel) · driver: **no Bluetooth in QEMU** — `systemctl --user status bt-agent` shows the condition skip; the radio/rfkill contracts can only be read from the scripts. [hw-absent]
- `bt-agent.service` has `ConditionPathIsDirectory=/sys/class/bluetooth` so it is skipped without hardware. [VM-visible absence]
- the panel exposes `toggleBluetooth()` over IPC and owns its IPC handler. [unit]
- toggling the radio runs `omarchy-bluetooth-power on|off`, never writes `adapter.enabled` directly. [unit]
- discovery started by the panel is owed a stop; the stop is armed off BlueZ's confirmed state once the panel closes; a sibling panel on another monitor inherits the debt; destruction hands it over. [unit]
- UUID-like and address-like names detected; addresses normalised; address-only labels are not human names. [unit]
- devices grouped into connected/known/discovered; discovered section only while scanning; QObjectList-like values converted. [unit]
- device rows are primitive-only projections keeping `deviceName`. [unit]
- pending actions are added/cleared immutably. [unit]
- audio sinks matched to a device by address or by human label; non-sink nodes ignored. [unit]
- `omarchy-bluetooth-power off` is `rfkill block bluetooth` (survives reboot), never `bluetoothctl power off`.
- `on` is `rfkill unblock bluetooth`; bluetoothd powers up on its own; `power on` is only sent when unblocking did not power it.
- `toggle` inverts the Powered state, counting a secondary controller as on.
- `omarchy-bluetooth-device connect` skips the power-on delay when already powered, lifts the block first when not.
- `install/hardware/bluetooth.sh` leaves `AutoEnable` at its default. [static]

### border-geometry-test.sh (290 lines)
src: `shell/Commons/BorderGeometry.js`, `shell/Ui/BorderOverlay.qml` · screen: yes (window/button borders) · driver: only as "borders render without gaps" in screenshots; the path arithmetic is unit-level.
- width specs parse four-sided and CSS two-value forms; gradient specs parse rgba stops and angle; legacy ARGB colours convert. [unit]
- adjacent left+bottom borders share one contour; isolated sides include only their corners; all 16 side masks yield minimal connected contours with closed, finite paths and no zero-radius arcs. [unit]
- opposite sides emit two contours joined into one `ringPath`. [unit]
- zero/negative widths emit nothing; consumed interiors return the outer rounded shape. [unit]
- flat uniform borders stay native `Rectangle`; asymmetric or gradient borders use the overlay with `WindingFill`. [unit]

### branding-about-animation-test.sh (148 lines)
src: `bin/omarchy-branding-about-animation` (`sheen_build`) · screen: yes (About window glint) · driver: Omarchy Menu → About; screenshot the window a few times to catch the moving band; custom-logo refusals via `omarchy branding about text`.
- a plain block-art logo animates; the glint takes more frames than the logo is wide.
- every frame redraws each row on the cell it was given, in the colour it was handed, recolouring only (never rewriting or overrunning the logo).
- the glint is a band (`SHEEN_HALF*2+1` wide), crosses every row, leans across the whole logo, arrives from off the logo and settles back to the original.
- the band avoids bright colours (`\e[9x m`) that a bold logo can brighten into.
- logos with `$1` placeholders, tabs, escapes, double-width glyphs, combining marks, joined emoji, or wider than the columns are left still; an empty or missing logo is left still and says nothing.
- a byte-counting shell (`LC_ALL=C`) leaves a block logo still but still animates plain ASCII.

### brcmfmac-supplicant-test.sh (178 lines)
src: `install/hardware/apple/fix-brcmfmac-supplicant.sh`, `install/hardware/all.sh`, `install/hardware/apple/fix-t2.sh`, `migrations/1786391100.sh` · screen: no · driver: Apple-only; in QEMU the migration is a no-op (vendor is QEMU). [hw-absent]
- the quirk leaf runs from `hardware/all.sh` and is the single owner of `/etc/modprobe.d/brcmfmac.conf`. [static]
- T2 Macs and every brcmfmac Broadcom part (43ba 43bb 43bc 43a3 43dc 4464 4425 4433) on Apple hardware get `options brcmfmac feature_disable=0x82000`; BCM4360 (43a0), non-Apple, and no-wireless machines are left alone; the older "Apple Computer, Inc." vendor string is recognised. [hw]
- a chatty `lspci` past the pipe buffer does not make the check read as "no hardware" under pipefail (#6608). [unit]
- the migration fixes a T2 install that never got the quirk and asks for `omarchy-state set reboot-required`; is idempotent; appends to an existing config; treats a commented-out option as not applied; skips unaffected Macs without escalating. [hw]

### brightness-display-apple-cache-test.sh (152 lines)
src: `bin/omarchy-brightness-display-apple` · screen: no in QEMU · driver: none (needs an Apple Studio Display hiddev node). [hw-absent]
- a cached device path that is not a `/dev/*hiddev*` character device (`/dev/null`, a regular file, `/tmp/omarchy-evil`, a missing `/dev/hiddev999`) is never handed to `asdcontrol`. [unit]
- a valid cached hiddev node is trusted without re-detecting. [hw]
- with no `XDG_RUNTIME_DIR` the world-writable `/tmp/omarchy-brightness-display-apple.device` is never consulted (FIFO decoy does not block). [unit]

### brightness-display-test.sh (146 lines)
src: `bin/omarchy-brightness-display`, `bin/omarchy-hyprland-monitor-focused-apple` · screen: yes (brightness OSD) · driver: **no backlight and no DDC in QEMU** — only the absence path (command errors, no OSD). [hw-absent]
- external monitor brightness via `ddcutil --bus N --skip-ddc-checks getvcp 10` is converted to a percentage (40/80 → 50); the bus mapping is detected once and cached in `$XDG_RUNTIME_DIR/omarchy-brightness-display-ddc/<name>.bus`. [hw]
- an absolute percentage writes `setvcp 10 <scaled>` with `--noverify`, reusing the cached VCP range; an expired range is refreshed. [hw]
- the internal monitor uses `brightnessctl -d <backlight> -m`. [hw]
- brightness follows the focused monitor. [hw]
- an unsupported external monitor has no backend (exit non-zero) and the negative result is cached briefly; a transient DDC read failure is reported, not negatively cached, and retried next time. [hw]
- low external brightness `+5%` from 4% writes the one-percent target. [hw]
- a named Apple display is detected independently of focus; a focused non-Apple display is not Apple. [hw]

### browser-env-test.sh (26 lines)
src: `default/bash/envs`, `default/uwsm/default`, `default/uwsm/env.d/10-omarchy` · screen: yes (terminal) · driver: `echo $BROWSER` in a terminal; `systemctl --user show-environment | grep BROWSER`; Chromium's own "Set as default" button works.
- bash sets `BROWSER=omarchy-launch-browser` when none is inherited.
- an inherited `BROWSER` is preserved.
- the uwsm session env leaves `BROWSER` unset (a session-wide BROWSER makes `xdg-settings set default-web-browser` refuse).
- the uwsm `env.d/10-omarchy` fallback does not export `BROWSER`.

### browser-policy-dir-test.sh (330 lines)
src: `install/helpers/browser-policy.sh`, `bin/omarchy-theme-set-browser`, `bin/omarchy-theme-set-browser-policy`, `migrations/1787515927.sh` · screen: yes (Chromium theme colour) · driver: `stat`/`ls -l /etc/chromium/policies/managed`, switch theme and re-read `color.json`; symlink-planting needs root but can be done with `sudo` in a terminal.
- `browser_policy_install_color` writes `{"BrowserThemeColor": "#aabbcc"}` into `color.json` mode 0644.
- a failed `mktemp` fails the write and leaves the existing `color.json` intact.
- a planted `color.json` symlink is unlinked, not written through (target unchanged); a planted `color.json` directory is replaced.
- a missing policy directory is skipped, never created.
- the colour must be `#` + six lowercase hex digits (`aabbcc`, `#AABBCC` rejected).
- `browser_policy_setup_dir` drops non-root files and non-empty non-root subdirectories, leaves the dir 0755.
- a user-owned 0755 directory is not "hardened"; a world-writable parent is not hardened and is tightened to 0755 without purging the leaf.
- a planted `/etc/chromium` (or `managed`) symlink is replaced by a real directory; policy behind it is not kept; the symlink target is not deleted.
- a planted Firefox `distribution` symlink is replaced and `policies.json` written into the real dir.
- `browser_policy_theme_hex` converts RGB triples (`242,240,229` → `#f2f0e5`), tolerates whitespace/trailing newline, pads, treats leading zeros as decimal, and falls back to stock `#1c2027` for every malformed input (`$(id)`, `256,0,0`, `1,2,3;id` …).
- every shipped `themes/*/chromium.theme` parses as a valid RGB triple. [static]
- `omarchy-theme-set-browser` derives the colour through `browser_policy_theme_hex`, writes via `omarchy-theme-set-browser-policy`, never `printf`s raw theme words, exits non-zero when a policy write fails. [static]
- Firefox `policies.json` must be a root-owned regular file, not a symlink; install replaces a planted symlink and refuses a planted directory.
- `omarchy-theme-set-browser-policy`'s EXIT trap never leaks a failure status (bash 5.3 adopts it). [unit]
- the policy-directory migration runs `omarchy-theme-set-browser || true`, repairs managed dirs, covers Firefox/Zen (`/opt/zen-browser/distribution`), keeps a trusted `policies.json`, never grants a group; exactly one migration owns "Stop world-writable … policy directories". [static]
- no policy script uses `chmod 777`/`o+w`/`omarchy-browser-policy`. [static]

### browser-policy-sudoers-test.sh (184 lines)
src: `etc/sudoers.d/omarchy-theme-browser`, `bin/omarchy-theme-set-browser-policy`, `bin/omarchy-theme-set-browser` · screen: yes (no password prompt on theme switch) · driver: run the helper from a terminal with good and bad arguments; `sudo -n -l -l`.
- the sudoers file carries exactly one rule: `%wheel ALL=(root) NOPASSWD: /usr/bin/omarchy-theme-set-browser-policy [0-9a-f]{6}` (as six bracket classes) and `visudo -c` accepts it. [static + `sudo -l`]
- the helper elevates `PACKAGED_PATH=/usr/bin/omarchy-theme-set-browser-policy` even when `OMARCHY_PATH` points at a dev checkout.
- the grant is detected from `sudo -n -l -l` (`Options: !authenticate`); a valid colour elevates via `sudo` without a terminal prompt.
- where the grant is absent the helper falls back to `pkexec` (polkit dialog).
- as root the helper pins `PATH=/usr/local/sbin:/usr/local/bin:/usr/bin` gated on `EUID == 0`. [static]
- the helper writes only the four known dirs (`/etc/chromium`, `/etc/opt/chrome`, `/etc/opt/edge`, `/etc/brave` `…/policies/managed`) with `install -m 0644 -o root -g root -T`, never `mv -f`. [static]
- every bad argument is rejected before elevating: empty, `1C2027`, `abc12`, `abc1234`, `1c202g`, `../../etc/passwd`, `1c2027 1c2027`, `$(id)`, `1c2027;id`, `#1c2027`, two arguments.
- `omarchy-theme-set-browser` converts the theme RGB to six hex digits, falls back to `1c2027` for malformed or missing `chromium.theme`.

### button-border-stability-test.sh (115 lines)
src: `shell/Ui/Button.qml` · screen: yes (menu/panel buttons) · driver: hover/select buttons and confirm nothing shifts; numeric check needs the QML fixture. [unit/QML]
- left-aligned content uses the reserved border inset; implicit size never depends on the hover/focus border. [static]
- implicit geometry is stable across hover-cursor, selected and focusable-hover states with 3/5/7 px border overrides. [unit/QML]

### channel-test.sh (193 lines)
src: `bin/omarchy-channel-set`, `bin/omarchy-channel-current` · screen: yes (Update → Channel submenu ✓, floating terminal) · driver: `omarchy channel current`; `omarchy channel set dev` with an occupied `~/omarchy` (refusal, VM-OK); real switches are NET/SLOW.
- `stable`/`rc` refresh that pacman channel, install `omarchy omarchy-settings` with `--needed --noconfirm --ask 4`, `omarchy-dev-unlink --no-reboot`, then run `omarchy-update -y` from `/usr/share/omarchy`; no reboot flag when already package-backed.
- `edge` installs `omarchy-dev omarchy-settings-dev`, unlinks, sets `reboot-required`, and defers the reboot prompt to the update restart stage (order: unlink, state, update).
- `dev` refuses when `~/omarchy` exists and is not a git checkout — `… already exists and is not a git checkout.` — **before** touching packages.
- `dev` asks `gum confirm --default=false "Switch to dev channel?"`, refreshes edge, installs dev packages, clones `https://github.com/omacom/omarchy.git` to `~/omarchy`, links it `--no-reboot`, sets `reboot-required`, and runs `omarchy-update -y` from the checkout; the checkout is activated before packages change.
- switching dev → stable unlinks and marks reboot required; switching back to dev reuses the existing checkout (no clone).
- `omarchy-channel-current` reports `stable`, `rc`, `edge` (dev packages, package path) and `dev` (OMARCHY_PATH outside `/usr/share/omarchy`).

### chromium-claude-test.sh (50 lines)
src: `bin/omarchy-install-chromium-claude` · screen: yes (polkit prompt, extension in Chromium) · driver: run the installer from a terminal; polkit dialog appears once; `ls -l /usr/share/{chromium,google-chrome,microsoft-edge}/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json`.
- as root the installer registers `fcoeoabgfenejglbffodgkkbkcdhcgfn.json` with `external_update_url: https://clients2.google.com/service/update2/crx` for chromium, google-chrome and microsoft-edge, mode 644.
- when already registered a repeat run needs neither writes nor authentication (no pkexec).
- a missing registration elevates only `/usr/bin/omarchy-install-chromium-claude` via `pkexec` and propagates the auth failure status.

### chromium-copy-url-test.sh (110 lines)
src: `default/chromium/extensions/copy-url/{manifest.json,background-4.js}`, `bin/omarchy-install-chromium-copy-url`, `bin/omarchy-chromium-copy-url-host`, `install/user/chromium.sh` · screen: yes (toast after Alt+Shift+L in Chromium) · driver: in Chromium press `Alt+Shift+L`, watch the toast, open clipboard history; `cat ~/.config/chromium/NativeMessagingHosts/com.omarchy.copy_url.json`.
- the extension's pinned key yields the stable id `bgpiichlckmfanooecilcjemknkcpngb`. [static]
- manifest v3 with `nativeMessaging` only (no notifications/clipboardWrite/offscreen), service worker `background-4.js`, sends to `com.omarchy.copy_url`; clickable from the toolbar. [static]
- the installer creates the native host manifest under a fresh `~/.config/chromium/NativeMessagingHosts/` with `path: …/omarchy-chromium-copy-url-host` and the pinned origin; Brave Origin is covered too.
- a fresh user install (`install/user/chromium.sh` via `install/user/all.sh`) registers the host itself. [static]
- the host copies the complete URL (query string intact) via `wl-copy` and returns a framed `{"copied":true}` reply. [unit]

### chromium-whatsapp-slim-test.sh (32 lines)
src: `default/chromium/extensions/whatsapp-slim/manifest.json` · screen: no · driver: none. [static]
- the pinned key yields the stable id `amhpgjbcfakkmkeojmoaoiochhifohdi`. [static]

### chromium-ytdlp-test.sh (255 lines)
src: `bin/omarchy-install-chromium-ytdlp`, `bin/omarchy-chromium-ytdlp-host` · screen: yes (download toast "Download complete <title>", click opens mpv) · driver: `cat ~/.config/chromium/NativeMessagingHosts/com.omarchy.ytdlp.json`; a real download is NET/SLOW; the path/title sanitising is unit-level.
- the installer creates `com.omarchy.ytdlp.json` (`path` = host, origin `dedjgknigfeelejglamclffonmophnfl`) for Chromium and Brave Origin.
- escaped JSON URLs parse; `javascript:` URLs are rejected. [unit]
- `resolve_download_file` accepts a regular file inside the download dir; rejects a forged mpv option (`--include=…`), a path outside the dir, an escaping symlink, control characters, a symlink whose target ends in a newline; accepts `/etc/passwd` when the dir resolves to `/`. [unit]
- toast title comes from the page title (`"My Great Clip"`), falls back to the filename; forged multi-line titles keep only the readable part; leading-dash titles and non-string titles are refused; a leading-dash filename titles as `Video`. [unit]
- a forged `OMARCHY_FILE` record cannot displace the real path. [unit]
- `download_url` disarms `--no-exec-before-download` on both yt-dlp runs, asks for the title as `%(title)j`, names the file `%(title)s.%(ext)s` without `--restrict-filenames`, never prints the title into the file record, builds the click command as `mpv -- <path>`, toasts `Download complete My Great Clip`, and falls back to the filename when no title record arrives. [unit]

### clipboard-test.sh (520 lines)
src: `shell/plugins/clipboard/{ClipboardHistory.js,Clipboard.qml,capture.sh}`, `bin/omarchy-clipboard-paste-text`, `bin/omarchy-clipboard-paste-file`, `bin/omarchy-clipboard-open` · screen: yes (clipboard manager `Super+Ctrl+V`) · driver: copy things (terminal, Nautilus, `wl-copy`), open the manager, navigate with Home/End/arrows, Enter/Delete; `pgrep -fa wl-paste`.
- entries normalise (string → text; `kind:image` → image with `image/png` default; `capturedAt` kept). [unit]
- history parsing drops invalid and whitespace-only entries. [unit]
- adding a duplicate text moves it to the front; `removeEntryAt` ignores bad indexes; `clearHistory` empties. [unit]
- display rows: `image` search matches image metadata; timestamped PNGs read `Screenshot from <when>`, other images `Image from <when>`; original indexes preserved; multi-line text collapses to one line.
- a `file://` URI entry shows as a file (basename preview, thumbnail for images, none for video); several URIs read `2 files`.
- zero result/history limits are honoured. [unit]
- keyboard navigation disarms pointer selection; Home/End select first/last; pointer selection needs real movement (`PointerMoveGate`), never `containsMouse`.
- both `wl-paste --watch` watchers run under `setpriv --pdeathsig TERM` so they die with the shell; init `pkill`s stale watchers matching `wl-paste .*--watch .*/shell/plugins/clipboard/capture\.sh`; both respawn on exit.
- search stops at the 8192-char cap; a huge text renders at most 8192 chars; a huge file list is capped without truncating a path.
- `capture.sh` records normal text (`{"type":"text","text":"terminal copy"}`) and watched stdin text.
- UTF-16LE/BE text is decoded (BOM-tagged, or NUL-padded mostly-ASCII), including punctuation, CJK, emoji, form feeds; ambiguous BOM-less non-ASCII, sparse NUL-separated UTF-8, NUL-padded UTF-8, endian-ambiguous control text and malformed UTF-16 are left undecoded.
- watched PNG/JPEG images are stored (`.jpg` extension for JPEG) with `capturedAt`.
- `CLIPBOARD_STATE=sensitive` events and `x-kde-passwordManagerHint` types are ignored.
- the reaper pattern matches a real running watcher; a watcher under `setpriv` dies when its owner dies.
- `omarchy-clipboard-paste-text --shift-insert --history-index N` copies the entry and types `wtype -M shift -k Insert -m shift`; `--copy-only` skips typing.
- `omarchy-clipboard-paste-file --copy-only <mime> <path>` copies file content without a keystroke.
- `omarchy-clipboard-open --history-index N` opens URLs in the browser, text in the editor via a temp file under `~/.local/state/omarchy/clipboard-open/`, images in `tensaku-edit`.

### clock-test.sh (271 lines)
src: `shell/plugins/panels/clock/{Model.js,Panel.qml,BarWidget.qml}`, `config/omarchy/shell.json`, `default/hypr/bindings/utilities.lua` · screen: yes (clock pill, calendar panel) · driver: left/right/middle-click the clock, `Super+Ctrl+Alt+D`, double-tap the year bar, `jq .bar.layout.center ~/.config/omarchy/shell.json`.
- week start resolves from `weekStartDay` (`monday`/`SUN`/6/null/garbage), persists by name, toggles Monday↔Sunday (exotic → Monday). [unit]
- ISO week numbers and day-of-year/year-progress arithmetic (leap years). [unit]
- memento mori: birth year parsed/validated (future, `<1906`, two-digit, blank, text rejected), age derived and keeps counting, life expectancy defaults to 90, life bar 0–100 %. [unit]
- month grid: six rows × seven columns, ISO week per row, padding days marked, weekend marked, exactly one `today`, no selection state; Sunday start shifts the grid but keeps ISO numbers. [unit]
- month stepping across years. [unit]
- the clock format ring is the stock preset order (`dddd HH:mm`, `dddd h:mm AP`, `dddd HH:mm:ss`, `dddd h:mm:ss AP`, `HH:mm`, `h:mm AP`, `ddd d MMM HH:mm`, `ddd d MMM h:mm AP`, `d MMMM 'W'ww yyyy`, `yyyy-MM-dd HH:mm`), stacked presets for vertical bars, a hand-written format appended, wraps, and is stable regardless of the current entry.
- seconds detection decides the tick rate; quoted/unterminated literals are text; `''s` still counts.
- panel declares `omarchy.clock`, anchors to the widget button, exposes `toggleWeekStart()` over IPC, persists `weekStartDay` inline to `shell.json`, steps months freely, hero returns to today, year bar pinned to today, scrolls on narrow popups, ignores horizontal wheel.
- double-tapping the year bar asks for birth year + expectancy, saves both together, shows the `LIFE` bar ("Memento Mori" on hover) only once a birth year is known; double-tapping the life bar clears it; inputs take the keyboard; closing drops a half-finished edit.
- the clock widget hosts the panel, right-click cycles the format and writes it back to `shell.json` (`format`/`verticalFormat`), left click opens the calendar, middle click opens `omarchy-menu-timezone`.
- popout identity/handshake and open-panel dot sizing come from the host widget. [unit]
- default `shell.json` centre layout contains `omarchy.clock` and no `omarchy.calendar`. [static]
- `SUPER + CTRL + ALT + D` is bound to `omarchy-shell shell toggle omarchy.clock` ("Calendar").

### compositor-guard-test.sh (113 lines)
src: `test/shell.d/base-test.sh` (`require_compositor`) · screen: no · driver: none — host test tooling. [host]
- skips without `WAYLAND_DISPLAY`; skips when the socket is unreachable; skips when hyprctl stays silent (3 retries); rides out one missed query; runs without `HYPRLAND_INSTANCE_SIGNATURE`; disables core dumps (`ulimit -c 0`) before launching quickshell. [host]

### config-test.sh (430 lines)
src: `config/omarchy/shell.json`, `shell/plugins/**/manifest.json`, omarchy-pkgs PKGBUILDs, `config/hypr/hyprland.lua`, `default/hypr/bootstrap.lua`, `bin/omarchy-bar {use,reset,move,position,transparent,set,defaults}`, `bin/omarchy-refresh-shell`, `migrations/` · screen: yes (bar) · driver: `omarchy bar …` from a terminal and watch the bar; `jq` on `~/.config/omarchy/shell.json`.
- default `shell.json` is valid JSON, `version 1`, three layout arrays; `omarchy.system-update` sits right after `omarchy.weather` in the centre; `centerAnchor` exists in the centre; clock `formatAlt` is `d MMMM 'W'ww yyyy` (no leading zero); `omarchy.agents` sits right after `omarchy.tray`. [static]
- every `omarchy.*` id in the default layout resolves to a manifest with kind `bar-widget` and an existing `barWidget` entry point. [static]
- package-owned defaults (uwsm env, fcitx env, fontconfig, xdg-terminals, mimeapps, fastfetch, user units incl. `omarchy-crash-watch.service`, zram, plocate drop-in, omarchy.ttf, snapper template) live under `default/`/`etc/` and are installed by the PKGBUILDs; the `omarchy-update-user-notify.service` alias ships; the three alpm hooks (`00-omarchy-update-guard`, `10-…-reload-pause`, `90-…-reload-resume`) are installed. [static]
- `hyprland.lua` bootstraps from `$OMARCHY_PATH/default/hypr/bootstrap.lua`; the bootstrap adds `~/.local/state/?.lua` to `package.path` and unloads cached `default.hypr.*`, `hypr.*`, `omarchy.current.theme.*` modules on reload. [unit]
- `omarchy bar use local.nonexistent-bar` is rejected; `use local.demo-bar` sets `.bar.id`; `reset` clears it.
- `omarchy bar move omarchy.active-window right|left` sends `moveBarWidget … {"section":"right"}`; positional and `--section` together are rejected.
- `omarchy bar position bottom` sets `.bar.position`; `transparent true` / `toggle` set/flip `.bar.transparent`; both leave `.plugins` alone.
- `omarchy bar set <id> <key> false|null --json` sends the JSON value; malformed JSON and multiple values are rejected.
- `omarchy bar defaults` restores the stock bar and places `omarchy.tailscale`/`omarchy.dropbox` right of the tray only when those services run (`omarchy-installed-service-*`), even with the shell down.
- `omarchy refresh shell` keeps optional widgets absent when their services are down, places them when up, and restarts the shell.
- the 4.0 upgrade is not modelled as a migration. [static]

### copy-url-shortcut-migration-test.sh (238 lines)
src: `migrations/1786643346.sh` · screen: yes (gum prompt to close Chromium) · driver: write a stale Chromium `Preferences` fixture with `jq`, run `bash /usr/share/omarchy/migrations/1786643346.sh` with Chromium open/closed.
- while the affected profile is open (`~/.config/chromium/SingletonLock`) and the prompt is declined, the migration defers (non-zero) and leaves Preferences untouched.
- the gum prompt stays visible on stderr.
- a browser on a different profile root (`~/.config/google-chrome`) does not block the repair.
- with the profile open and the prompt confirmed (browser closed), the repair proceeds.
- with no browser the ghost registration for command `copy-url` moves to the pinned id `bgpiichlckmfanooecilcjemknkcpngb`, `was_assigned: true`, ghost settings removed, backup `Preferences.omarchy-copy-url-repair.bak` written.
- rerun after repair is idempotent even with the browser open.
- a remapped key (`linux:Ctrl+Alt+P`) is kept while rebinding.
- when the pinned id already has a copy-url binding the ghost is dropped, never double-bound.
- a browser that starts mid-repair keeps the migration pending; a briefly-lived browser that reverts the file is caught by post-repair verification; an unverified repair stays pending while a browser runs and completes on a browser-free rerun.
- a third-party extension with its own `copy-url` command is left alone.

### crash-capture-test.sh (396 lines)
src: `bin/omarchy-toggle-crash-capture`, `default/systemd/user/omarchy-crash-watch.service`, `install/user/first-run/enable-user-units.sh`, `bin/omarchy-crash-watch`, `bin/omarchy-crash-mute`, `default/agents/skills/diagnose-crash/SKILL.md`, `bin/omarchy` (`GROUP_DESCRIPTIONS[crash]`), `default/omarchy/omarchy-menu.jsonc` · screen: yes (toasts) · driver: Omarchy Menu → Trigger → Toggle → Crash Capture; `omarchy crash mute …`; crash a process (`sleep 60 & kill -SEGV $!`) and watch for `Process crashed: sleep`.
- toggling writes `~/.local/state/omarchy/toggles/crash-capture-off` and runs `systemctl --user stop omarchy-crash-watch.service` immediately (toast "Crash capture disabled").
- toggling again removes the flag and `start`s the unit (toast "Crash capture enabled").
- the unit has `ConditionPathExists=!%h/.local/state/omarchy/toggles/crash-capture-off` so disabling survives logout. [static]
- the unit is enabled for new installs by `enable-user-units.sh`. [static]
- an un-muted crash announces `Process crashed: <name>`.
- `omarchy-crash-mute <name> on` silences that program only; other programs still announce; `off` brings it back.
- the toast announces the executable's basename (not the 15-char truncated COMM: `chromium-browser`, not `chromium-browse`), and the mute is keyed on that name.
- a muted crash does not end the watcher (the next crash is still read).
- a comm that climbs out (`a/../bar-off`) cannot reach `toggles/bar-off`; `/`, `a/`, `.`, `..` announce as `unknown`; an empty comm announces as `unknown` and does not derail the next entry; `.hidden`/`...` are ordinary names; `unknown` can be muted.
- `omarchy-crash-mute` with nothing muted prints `No programs muted. Crashes all notify.`; lists muted names (dotted names included); reduces a path to its basename; `off` un-mutes; muting twice stays muted; refuses `.`/`..`/`/`; refuses an unknown action with `Not an action: sideways`; `../bar-off` cannot write outside `crash-ignore/`; `-- -h` mutes a program named `-h`; `toggle` flips both ways; a directory in `crash-ignore/` is not listed as a mute; a failed write exits non-zero and does not print `Muted crash notifications`.
- the diagnose-crash skill names `omarchy-crash-mute`; the router describes the `crash` group. [static]
- menu id `trigger.toggle.crash-capture` runs `omarchy-toggle-crash-capture`. [static]

### cups-hardening-test.sh (246 lines)
src: `install/omarchy-base.packages`, `etc/cups/cups-browsed.conf`, `etc/cups/cups-files.conf`, `etc/sysusers.d/omarchy-cups-browsed.conf`, `etc/systemd/system/cups-browsed.service.d/10-omarchy.conf`, `install/post-install/pacman.sh`, `migrations/1787815267.sh` · screen: yes (Print Settings app, `pacman -Q`) · driver: read `/etc/cups/cups-files.conf`, `pacman -Q cups cups-browsed cups-pdf cups-pk-helper`, `systemctl status cups`; the migration can be run manually.
- `cups`, `cups-filters`, `system-config-printer`, `cups-pk-helper` stay in the base set; `cups-pdf` and `cups-browsed` are out; no install script enables `cups-browsed`. [static + `pacman -Q`]
- the fresh install applies the `cups-files.conf` override only once the file exists and writes no discovery config. [static]
- `cups-browsed.conf` uses `CacheDir /var/cache/cups-browsed`, `CreateIPPPrinterQueues Driverless`, `CreateRemoteCUPSPrinterQueues No`, no `CreateRemotePrinters`. [static]
- `cups-files.conf` has exactly one `SystemGroup cups-browsed sys root` and one `PeerCred on`; no `printing.sh` rewrite script. [static, readable in guest]
- a locked `cups-browsed` system account is declared; the service drop-in runs as that user with `CacheDirectory`, `UMask=0027`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `RestrictSUIDSGID`, and no `CAP_NET_BIND_SERVICE`. [static]
- the migration refuses an existing desktop user or a member-bearing group named `cups-browsed` before changing anything.
- the migration drops `cups-pdf`, adds `cups-pk-helper`, stops `cups-browsed`, `daemon-reload`s, `try-reload-or-restart cups`, restarts an active `cups-browsed`, records a machine-wide marker, and repeats no privileged work on rerun.
- a retry after an interrupted run still resumes an enabled `cups-browsed`; a masked/disabled unit is left alone and the migration still completes.

### default-agent-test.sh (827 lines)
src: `bin/omarchy-mise-install`, `install/user/mise.sh`, `migrations/{1788724825,1785617047,1787342993,1788577553,1785846769,1786719479}.sh`, `bin/omarchy-remove-preinstalls`, `bin/omarchy-default-agent`, `bin/omarchy-agent`, `bin/omarchy-agent-prompt`, `default/bash/aliases`, `default/hypr/bindings/utilities.lua`, router `omarchy agent` · screen: yes (menu, floating install terminal, agent window) · driver: `omarchy agent`, `Super+Shift+Ctrl+A`, Setup → Defaults → Agent, `ls ~/.local/bin`.
- lazy stubs in `~/.local/bin/{grok,omp,crush,ori,cursor-agent,muse}` run `mise use -g --quiet <pkg>` then `mise x <pkg> -- <cmd>` with their exact package spec (`npm:@xai-official/grok`, `github:can1357/oh-my-pi`, `crush`, `github:OpenRouterLabs/ori-releases`, `cursor-agent`, the Muse `http:muse[...]` spec).
- user setup creates the Antigravity/Grok/Cursor/omp/Crush/Ori/Muse stubs but never replaces an existing `cursor-agent` or `muse` command.
- the Muse, Oh My Pi, Ori, Cursor CLI, agent-repair and Antigravity migrations create working stubs, preserve existing installs and honour the `preinstalls-removed` opt-out (Muse/Antigravity: except when the default names them).
- the Antigravity migration replaces a Gemini default (even padded) with `agy`, removes only the Gemini wrapper Omarchy wrote, provisions the `omarchy` and `diagnose-crash` skills into `~/.gemini/config/skills/`.
- `omarchy-remove-preinstalls` deletes every optional agent lazy stub but keeps an official Cursor CLI symlink and a user-managed `muse`.
- `omarchy-default-agent` prints nothing until an agent is chosen.
- `omarchy-agent` without a default exits non-zero, prints `Choose default agent with: omarchy default agent <name>`, launches nothing.
- `omarchy-agent --pick` without a default opens `omarchy menu summon setup.default.agent` and launches nothing; with a default it launches and opens no menu.
- alias `a` = `omarchy-agent --inline`; `SUPER + SHIFT + CTRL + A` → `omarchy-agent --pick`.
- every alias canonicalises (`oh-my-pi`→omp, `gemini`→agy, `claude-code`→claude, `muse-code`→muse, `cursor`→cursor-agent …), installs globally through `mise use -g <pkg>`, and opens the agent after selection; the selection is stored in `~/.config/omarchy/defaults/agent`.
- choosing Claude also installs the browser extension; a failed extension install is silent and still selects/launches Claude.
- a missing agent opens `omarchy-default-agent --install <agent>` in a floating terminal, sends no notification, does not change the selection until mise succeeds; the visible install clears the terminal and opens the agent inline.
- an installed agent is selected immediately with no terminal and no notification.
- an official Cursor CLI install (symlink) is selected without mise; a dead non-executable file at that path still installs.
- `omarchy-default-agent unsupported` exits non-zero with `Usage: omarchy-default-agent <pi|omp|…|muse>` and keeps the current default.
- a failed mise install prints `Could not install <Name> with mise`; a failed activation prints `Could not set <Name> as the default coding agent`; neither changes the selection or opens an agent.
- Muse follows the same install/select path (HTTP mise backend, no separate login); a user-installed `muse` is selected without reinstalling.
- every agent launches under `--app-id=org.omarchy.agent` with its own permission-bypass flags (`claude --permission-mode auto`, `codex --approve-for-me`, `opencode --auto`, `cursor-agent --yolo --trust`, `hermes --yolo`, `agy --dangerously-skip-permissions`, `copilot --allow-all`, `grok --permission-mode bypassPermissions`, `crush --yolo`, `muse --approval-mode never`, `omp --auto-approve`, `ori code`, `pi`).
- `omarchy-agent-prompt "<text>"` forwards the prompt as one literal argv entry per agent (`-- <text>`, `--prompt`, `--query=…`, `crush run`); option-like prompts stay literal for Muse and Hermes.
- `--inline` runs in the current terminal; `omarchy agent` and `omarchy agent prompt "<text>"` route correctly; `omarchy agent Review this project` is refused and points at `omarchy agent prompt`.
- a default naming a missing command fails with `<name> is not installed. Choose an installed agent with: omarchy default agent <name>`.
- OpenClaw is chosen through `omarchy-pkg-add openclaw` (never mise), launches `omarchy-launch-openclaw --tui`, routes prompts as `--message <text>`.

### default-apps-test.sh (314 lines)
src: `bin/omarchy-default-browser`, `bin/omarchy-default-terminal`, `bin/omarchy-default-editor`, `bin/omarchy-install-browser` · screen: yes (Setup → Defaults submenus, floating installer) · driver: menu selections; `omarchy default browser|terminal|editor`; `tail -1 ~/.config/xdg-terminals.list`.
- selecting a missing browser/terminal/editor opens `omarchy-default-<type> --install <selection>` in a floating terminal (all 7 browsers, 4 terminals, 7 editors).
- `--install <browser>` runs the browser installer and the browser becomes the default afterwards.
- the real Chromium installer installs the package, copies `chromium-flags.conf`, creates root-owned 0755 `/etc/chromium{,/policies,/policies/managed}`, drops non-root files there, never creates a `browser-policy` group, registers the Copy URL and yt-dlp hosts and applies the theme.
- the Firefox/Zen installers create their root-owned `distribution` dir, drop non-root files, and `install -T` `policies.json` (no symlink following).
- a failed package install returns an error and preserves the current default; a failed setup step keeps `Installing Chromium` visible and preserves the default.
- `omarchy-default-terminal --install <t>` runs `omarchy-install-terminal <t>` and appends the desktop id (`Alacritty.desktop`, `foot.desktop`, `com.mitchellh.ghostty.desktop`, `kitty.desktop`) to `~/.config/xdg-terminals.list`.
- `omarchy-default-editor --install <e>` uses the right installer (`pkg:cursor-bin`, `pkg:sublime-text-4`, `pkg:vim`, `pkg:neovim`, `editor:vscode|zed|helix|emacs`) and the editor becomes default.
- installed defaults are selected immediately with no installer; a failed install preserves the previous default.

### desktop-entry-launch-test.sh (237 lines)
src: `bin/omarchy-install-editor-{emacs,vscode,zed}`, `bin/omarchy-install-gaming-{heroic,steam}`, `bin/omarchy-install-and-launch`, `bin/omarchy-install-app`, `bin/omarchy-install-font` · screen: yes (floating install terminal text) · driver: run `omarchy-install-app "<name>" <pkg>` etc. from a terminal and read the floating terminal's first line.
- editor/gaming installers launch their desktop entry as `setsid uwsm-app -- gtk-launch <id> >/dev/null 2>&1 &` (detached, scoped). [static]
- `omarchy-install-and-launch` shell-quotes the display name (`echo Installing\ Example\ App...;`), waits for packages, detaches only the launch, preserves a desktop id with spaces, and does not launch after a package failure.
- `omarchy-install-app` shell-quotes the display name (apostrophes, `a'; echo PWNED; echo '` never runs), passes every package (space- or newline-separated), hands a hostile package list to the helper as arguments, and builds the same command under an inherited `errexit`.
- `omarchy-install-font` quotes the display name and font family, passes the family as one argument, never runs injected commands, and does not set the family after a package failure.

### dev-env-path-test.sh (86 lines)
src: `default/bash/env-bootstrap`, `/etc/omarchy.conf` · screen: yes (terminal `echo $PATH`) · driver: `echo $OMARCHY_PATH; echo $PATH` in a terminal; after `omarchy dev link`, `which omarchy-version` resolves from the checkout.
- default mode resolves `OMARCHY_PATH=/usr/share/omarchy`, preserves PATH, appends `~/.local/share/mise/shims` and `~/.local/bin` after existing entries.
- linked mode prepends `<checkout>/bin` first and preserves unrelated entries.
- no duplicate PATH entries; an empty PATH yields no empty (cwd) entries.
- the bootstrap also works when sourced by zsh.

### dev-link-test.sh (124 lines)
src: `bin/omarchy-dev-link` · screen: yes (terminal output, sudo prompt) · driver: `omarchy dev link /usr/share/omarchy --no-reboot` (or a copied checkout), read `/etc/omarchy.conf`, `/etc/sudoers.d/omarchy-dev-path`.
- writes `export OMARCHY_PATH="<checkout>"` to `/etc/omarchy.conf`.
- writes `Defaults secure_path="<checkout>/bin:/usr/local/sbin:/usr/local/bin:/usr/bin"` to `/etc/sudoers.d/omarchy-dev-path` via `install -Dm440 -o root -g root`, parseable by `visudo -c`, escaping quotes in the path.
- prints `sudo now resolves omarchy-* from <checkout>/bin`.
- `--no-reboot` skips the `gum confirm` reboot prompt.
- a non-existent path is refused with `Error: path does not exist: <path>` and nothing is touched.

### dev-unlink-test.sh (88 lines)
src: `bin/omarchy-dev-unlink` · screen: yes · driver: `omarchy dev unlink [--no-reboot]`.
- writes `export OMARCHY_PATH="/usr/share/omarchy"` to `/etc/omarchy.conf` and removes `/etc/sudoers.d/omarchy-dev-path`.
- `--no-reboot` skips the prompt; interactive mode asks `Reboot now to activate?` and reboots on confirmation.
- an unknown argument is refused with `Usage: omarchy dev unlink [--no-reboot]`.

### dns-sudoers-test.sh (161 lines)
src: `etc/sudoers.d/omarchy-dns`, `bin/omarchy-dns` · screen: yes (Setup → Network → DNS ✓, no password prompt) · driver: menu; `omarchy dns`; `resolvectl status`; `omarchy-dns Custom` shows a polkit dialog.
- the sudoers file carries exactly `%wheel ALL=(root) NOPASSWD: /usr/bin/omarchy-dns Cloudflare, /usr/bin/omarchy-dns Google, /usr/bin/omarchy-dns DHCP` and parses. [static + `sudo -l`]
- the script elevates `PACKAGED_PATH=/usr/bin/omarchy-dns`, reads the grant from `sudo -n -l -l`, pins PATH to system dirs when root (gated on `EUID == 0`). [static]
- as root the read-only path never resolves `tr/awk/dirname/install/tee` from the front of PATH. [unit/root-ns]
- `Cloudflare`, `Google`, `DHCP` elevate via passwordless sudo (even with `OMARCHY_PATH` on a dev checkout); `Custom` and any ungranted case go through `pkexec`.

### docker-group-migration-test.sh (89 lines)
src: `migrations/1787580187.sh`, `bin/omarchy-remove-security-sudoless-docker`, `bin/omarchy-state` · screen: yes (reboot-required indicator) · driver: `id -nG` before/after running the migration; `ls ~/.local/state/omarchy/reboot-required`.
- a user in `docker` is removed (`gpasswd -d <user> docker`), `reboot-required` is flagged, the reboot itself is deferred, and the stale `Docker.desktop` launcher is refreshed from `$OMARCHY_PATH/applications`.
- a user not in `docker`: no group change, no reboot flag, launcher still refreshed.
- a missing launcher is skipped without error.

### done-test.sh (30 lines)
src: `bin/omarchy-done` · screen: yes (terminal exit codes) · driver: `omarchy done check|mark|ensure <name>`.
- `check` fails for an unmarked task; `mark` creates `~/.local/state/omarchy/done/<name>`; `check` then succeeds.
- `ensure` succeeds once (and marks) and fails the second time.
- `check ../invalid` is refused (no path traversal).

### drive-password-test.sh (49 lines)
src: `bin/omarchy-drive-password` · screen: yes (Update → Password → Drive Encryption floating terminal) · driver: menu path; type into the gum prompts.
- an empty new passphrase is refused (`Password cannot be empty.`) and `cryptsetup` is never run.
- a mismatched confirmation is refused (`Passwords do not match.`) without running `cryptsetup`.
- a validated passphrase is passed to `sudo cryptsetup luksChangeKey <device>` on stdin without a trailing newline, targeting the LUKS device from `blkid`.

### dropbox-test.sh (34 lines)
src: `shell/plugins/panels/dropbox/Model.js` · screen: yes (Dropbox panel, only when installed) · driver: none on a stock disk (Dropbox not installed; NET/SLOW to add). [unit]
- file kinds by extension; byte/percent/usage formatting; status JSON parsing; relative-time metadata `1h ago · Docs`. [unit]

### editor-env-test.sh (19 lines)
src: `default/bash/envs` · screen: yes (terminal) · driver: `echo $EDITOR; echo $SUDO_EDITOR`; `sudo -e /etc/hosts` opens the default editor.
- `EDITOR=omarchy-launch-editor --inline` when none inherited; an inherited `EDITOR` is preserved; `SUDO_EDITOR` matches.

### emojis-test.sh (88 lines)
src: `shell/plugins/emojis/{EmojiSearch.js,emojis.json}`, `bin/omarchy-menu-emoji-insert` · screen: yes (emoji picker) · driver: Trigger → Emoji, type `joy`, Enter into a focused terminal; then open clipboard history.
- the dataset parses (>1000 entries); invalid/non-array JSON parses as empty. [unit]
- filtering trims and lowercases, honours limits (incl. 0), and `face with tears` finds 😂.
- the insert helper copies the emoji with `wl-copy --type text/plain --sensitive --foreground` (transient, not recorded in history) and pastes with `wtype -M shift -k Insert -m shift`.

### factory-reset-accounts-test.sh (148 lines)
src: `bin/omarchy-system-factory-reset` (`stage_full_reset`) · screen: yes (Setup → Reset Computer) · driver: destructive and > 10 min in QEMU; not runnable here. [VM-NO]
- staging a reset scrubs the seller account (passwd/shadow/group/gshadow/subuid/subgid, home) from both `@factory` and the next root, locks root's hash to `!`, preserves service accounts, keeps `shadow` 0600, removes the `-` backups, returns the baseline to read-only, and reaches provisioning; it can be repeated. [unit/root-ns]
- a failed `userdel`/`usermod`/`rm` in either root aborts before activation or rebuild and leaves the baseline read-only. [unit/root-ns]

### fingerprint-driver-migration-test.sh (60 lines)
src: `migrations/1785090473.sh` · screen: no · driver: no-op on QEMU (no `fprintd`). [hw-absent]
- `fprintd` with no libfprint gets `pacman -S --noconfirm --needed libfprint-git`; an installed `libfprint-git` or stock `libfprint`, or no `fprintd`, is left alone.

### fingerprint-invitation-test.sh (75 lines)
src: `install/user/first-run/setup-fingerprint.hook` · screen: yes (toast) · driver: run the hook; **no reader in QEMU** so only "stays pending, no toast, no marker" is observable. [hw-absent]
- without a reader (`omarchy-hw-fingerprint` fails) the hook does nothing and leaves `done/fingerprint-setup-invitation` unset. [VM-visible absence]
- with a reader it notifies once with click action `omarchy-launch-floating-terminal-with-presentation omarchy-setup-security-fingerprint`, needs no `systemd-run`, records completion, keeps its hook installed, and never notifies again. [hw]

### fingerprint-package-test.sh (93 lines)
src: `bin/omarchy-setup-security-fingerprint`, `bin/omarchy-pkg-missing` · screen: yes (Setup → Security → Fingerprint, hidden without hardware) · driver: the menu row is absent in QEMU; running the script prints its no-hardware refusal. [hw-absent]
- a fresh machine installs `libfprint-git fprintd usbutils` in one `pacman -S --needed --noconfirm --ask 4` transaction and reaches `fprintd-enroll`; stock `libfprint` is swapped in the same transaction; with everything installed pacman is not touched. [hw]
- a failed package transaction stops before enrollment; a failed enrollment never changes PAM. [hw]
- missing hardware performs no package operations. [VM-visible]

### firewall-config-test.sh (51 lines)
src: `install/config/firewall.sh` · screen: yes (`sudo ufw status`) · driver: `sudo ufw status verbose`, `systemctl is-enabled ufw`.
- install runs `ufw-docker install` and `systemctl enable ufw` without activating live UFW during install.

### first-run-test.sh (35 lines)
src: `bin/omarchy-provision-first-run`, `install/user/first-run/wifi.sh` · screen: yes (terminal) · driver: run `omarchy-provision-first-run` on the minted disk.
- with `omarchy-done check first-run-user` true the script prints `First-run already complete` and runs no setup step.
- first-run uses one lifecycle marker (no separate `user-migration-notify-watch-enabled` / `skip-first-run-update-notification` markers). [static]

### floating-terminal-test.sh (23 lines)
src: `bin/omarchy-launch-floating-terminal-with-presentation` · screen: yes · driver: run it with `"echo hello; sleep 30"`, check `hyprctl activewindow -j | jq .class`.
- launches `xdg-terminal-exec --app-id=org.omarchy.terminal` (Omarchy's terminal, floating rule).

### git-url-check-test.sh (79 lines)
src: `bin/omarchy-git-url-check` (used by `omarchy-theme-install`, `omarchy-plugin-add`) · screen: yes (Install → Style → Theme prompt; Setup → Plugins → Add Plugin) · driver: type hostile URLs into the theme installer prompt; or call the checker directly.
- `<helper>::<address>` URLs (`ext::sh -c id`, `fd::0,1`, `gcrypt::x`, `a+b::x`, `a.b::x`, `a-b::x`, `1::x`) are refused: `'<url>' names a git option or transport helper, not a repository.`
- `<scheme>://` outside git's own transports (`ext://`, `fd://`, `gcrypt://`, `zzz://`, `ZZZ://`, even `HTTPS://`) is refused: `'<url>' names the '<scheme>' transport, which Omarchy does not clone from.`
- option-shaped URLs (`-x`, `--upload-pack=…`, `-oProxyCommand=x`) are refused; an empty or missing URL is refused.
- legitimate forms are accepted: https/http (with credentials), ssh:// (IPv6 too), git://, git+ssh://, ssh+git://, ftp(s)://, file:///, scp-style `git@host:org/repo.git`, `host:-s/foo.git`, absolute/relative paths, bare names.

### herdr-functions-test.sh (48 lines)
src: `default/bash/fns/herdr` (`hdlm`) · screen: yes (herdr panes) · driver: needs a running herdr session (org app, reviewer 60); the quoting is unit-level.
- `hdlm` queues `cd <dir> && hdl <agent…>` per project directory with `%q` quoting, preserves argument boundaries, omits an absent second agent. [unit]

### hermes-cli-migration-test.sh (133 lines)
src: `migrations/1787760281.sh`, `bin/omarchy-install-hermes-cli` · screen: no · driver: run the migration in a terminal, inspect `~/.local/bin/hermes`.
- installs the Omarchy wrapper (`# Written by omarchy-install-hermes-cli.` marker) on a plain install; idempotent; repairs a non-executable owned wrapper.
- respects `~/.local/state/omarchy/preinstalls-removed`.
- with Hermes Desktop installed it writes nothing, removes an old owned wrapper and its mise environment (`mise rm -g`, `mise uninstall --all`), but never touches or runs a foreign `hermes`.
- a foreign wrapper (official installer body), a non-executable foreign file, a dangling link, a directory, or a wrapper that merely mentions the installer is left alone.

### hermes-cli-test.sh (576 lines)
src: `bin/omarchy-install-hermes-cli` (`--check`, `--now`, `--owns`, `--remove`), `install/user/mise.sh` · screen: no (terminal exit codes) · driver: run the installer flags in a terminal on the stock disk (no Hermes Desktop).
- writing the stub provisions nothing (no `mise use uv`); the stub carries the marker line.
- with the desktop app installed the installer removes its own stub (and an unhealthy mise copy) but keeps the app's own `hermes`.
- `--check` is false until the app's `.hermes-bootstrap-complete` exists and the wrapper runs; a foreign `hermes` belonging to something else is rejected.
- a working foreign `hermes` satisfies `--check` and installing/`--now` step aside leaving it untouched; a foreign Hermes without native prompted sessions (`chat --help` lacking bare `--tui` and `--query`) is rejected and not replaced.
- a non-executable foreign file, a wrapper with a missing interpreter or exec target, a dangling link, a directory are all rejected and left untouched; a foreign link to a working hermes is accepted and preserved.
- ownership needs the exact marker line (not a mention, not a quote of it); reinstalling refreshes an owned stub to the current template (`exec env -u UV_PYTHON mise x`) and replaces an older owned mise environment (`rm`, `uninstall`).
- `--check` follows the mise-installed hermes it would run, in both directions.
- an unmarked Hermes mise environment is never claimed or removed.
- `install/user/mise.sh` sourced under `bash -eE` survives a Hermes install that cannot finish.
- the stub drops `UV_PYTHON` before handing over.
- `--owns` is true only for the exact stub (not a symlink, mention, or quoted marker); the marker is spelled out in exactly one file.
- `--remove` is idempotent with nothing present, tears down the owned stub and mise tool, fails when mise still resolves the tool or the stub survives, and leaves a foreign hermes and unproven mise environments alone.
- readiness runs the app's command rather than trusting its marker; releases listing only `--oneshot`, `--tui-theme`/`--query-log`, only one of the two flags, underscore continuations, or flags mentioned only in prose are not prompt-ready.

### hermes-desktop-install-test.sh (374 lines)
src: `bin/omarchy-install-ai-hermes` · screen: yes (Install → AI → Hermes Desktop terminal) · driver: NET + very SLOW (package + upstream bootstrap); not runnable in budget. [VM-NO]
- fresh setup: `omarchy-pkg-add hermes-desktop`, CLI handoff, upstream `install.sh --skip-setup --branch main --commit <release> --force-commit --dir … --hermes-home …`, patch the release runtime, copy the packaged app before launch, write the build stamp, non-setuid user `chrome-sandbox`, `main` pinned at the release with connected history; first update detects work.
- repeat setup does not bootstrap or overwrite an existing app/stamp; an updated runtime is never re-patched or seeded with the old packaged app (guidance `hermes desktop --build-only`); modified desktop sources are preserved without stamping.
- package, installer, marker, copy and concurrent-creation failures stop before launch and clean only staging; incomplete native apps and patch conflicts are preserved; local `main` work is never reset; a history-fetch failure is retryable without reinstalling; pre-existing `hermes*` commands are backed up; an old package fails with `omarchy update` guidance; custom `HERMES_HOME` profiles normalise; the relocated stamp writer is supported.

### hermes-remove-test.sh (384 lines)
src: `bin/omarchy-remove-ai-hermes` · screen: yes (Remove → AI → Hermes Desktop terminal, gum question) · driver: needs Hermes installed. [VM-NO]
- removal takes the app-installed runtime (`~/.hermes/hermes-agent`, `bin`, `node`), stops `omarchy-hermes-theme.service`, keeps `~/.config/Hermes`, chats, memories, `SOUL.md`, clears only the node links it stranded, removes the app's own `hermes` command, asks the installer to `--remove` the CLI.
- a foreign `hermes`, a runtime the app never finished installing (no bootstrap marker), and a wrapper pointing at `~/xhermes` are left alone.
- without a terminal the data question is never asked (data kept); on a terminal it asks `gum confirm`, default no; only an explicit yes deletes `~/.hermes` and `~/.config/Hermes` (marker or not).
- a failed CLI teardown surfaces in the exit code after the runtime is handled.
- live or deleted SQLite holders, terminal/desktop/working-directory processes block removal before any side effect (`Close Hermes`, pid named); unrelated databases do not; a writer started during confirmation blocks data deletion.

### hermes-skills-migration-test.sh (75 lines)
src: `migrations/1787843905.sh` · screen: no · driver: run it; `ls -l ~/.hermes/skills/`.
- links `omarchy` and `diagnose-crash` from `$OMARCHY_PATH/default/agents/skills/` into `~/.hermes/skills/` (and every existing `~/.hermes/profiles/*/skills/`), creates no profiles, idempotent, no-op when the skill source is missing.

### hermes-skin-migration-test.sh (59 lines)
src: `migrations/1788619462.sh` · screen: no · driver: no-op without Hermes Desktop (visible as "nothing happens").
- the migration is a plain 0644 file; without `hermes-desktop` it runs nothing; with it, it runs `omarchy-theme-set-hermes --activate` and stays pending if that fails.

### hermes-theme-test.sh (401 lines)
src: `bin/omarchy-theme-set-hermes` (`--activate`, `--wait`) · screen: partly (Hermes skin) · driver: run the hook on the stock disk (no Hermes) for the quiet paths; `--activate` prints `not set up yet`.
- a Hermes home holding only the skill gets no skin and nothing is run (theme switch stays silent).
- once Hermes has run (`~/.hermes/config.yaml`), the rendered `hermes.yaml` is published to `~/.hermes/skins/omarchy.yaml` and every profile, with no temp file left; an unready Hermes is asked nothing more.
- a skin with unresolved `{{ }}` placeholders is rejected (`not a plain color palette`) and the previous skin kept; a directory at the skin path is an error; every non-palette shape (links, escaped quotes, wrong name/description, CR/LS/NEL-hidden keys, misordered keys, duplicates, empty colors, NUL byte) is refused; comments and blank lines are fine.
- a theme switch activates the skin on a ready Hermes still on its default (`config get display.skin` → `config set display.skin omarchy`), quietly; not on a Hermes already on the skin, not on a Hermes Omarchy did not install as the app, not when the user chose another skin (root or active profile); it follows the active profile (even one without its own config); ambiguous skin lines are asked of Hermes; a broken profile costs nobody else.
- `--activate` waits for Hermes to be set up (`not set up yet`), publishes but does not run an unready Hermes (prints the `hermes config set display.skin omarchy` command), always asks Hermes to switch, replaces default/omarchy, leaves a chosen skin (`'ares' skin` reported), does not switch when Hermes did not say, reports a refused write.
- without a rendered skin a theme switch does nothing; `--activate` fails with `Select an Omarchy theme`; with a `theme.name` it re-stages via `omarchy-theme-refresh` and activates.
- `--wait` polls every 10 s for the runtime marker (giving up after 30 min: `did not finish setting up`), activates once it appears, re-validates and republishes everywhere after the gateway is up.

### hook-state-name-guard-test.sh (158 lines)
src: `bin/omarchy-hook`, `bin/omarchy-hook-install`, `bin/omarchy-state` · screen: yes (terminal exit codes, reboot indicator) · driver: run the commands in a terminal.
- `omarchy-hook <name>` runs `~/.config/omarchy/hooks/<name>`; dotted names like `a..b` are fine; `.`/`..`/`../../evil`/`sub/dir` exit 2 and run nothing.
- `omarchy-hook-install <type> <file>` copies into `hooks/<type>.d/`; refuses `.`/`..`/`../../evil`/`sub/dir` with exit 2 and creates no directory.
- `omarchy-state set <name>` creates `~/.local/state/omarchy/<name>` (dotted names fine); refuses `.`/`..`/`../../escape`/`sub/dir` with exit 2 and creates nothing outside; `clear <pattern>` removes matching basenames only.

### hw-display-test.sh (64 lines)
src: `bin/omarchy-hw-display` · screen: no (feeds brightness) · driver: **no backlight in QEMU** — the command fails. [hw-absent]
- the only backlight is used; globbed candidates beat alphabetical order (`amdgpu_bl1` over `acpi_video0`); `intel_backlight` over `acpi_video0`; unknown devices fall back to the first; `gmux_backlight` beats `appletb_backlight` and the GPU backlights; the Touch Bar is never the display backlight; no device → failure. [hw]

### hw-external-monitors-test.sh (61 lines)
src: `bin/omarchy-hw-external-monitors` · screen: no · driver: run it in QEMU — `Virtual-1` is not an internal connector so it reports "external" (exit 0). [VM-PARTIAL]
- an empty DRM tree reports none quietly; `eDP-*`, `LVDS-*`, `DSI-*` are internal; a connected DP/HDMI counts even beside an LVDS panel; a disconnected external is ignored; external-only systems report a display.

### hw-fingerprint-test.sh (105 lines)
src: `bin/omarchy-hw-fingerprint` · screen: no (gates menu rows) · driver: in QEMU it exits 1 (no reader), hiding Setup → Security → Fingerprint. [hw-absent]
- FPC readers detected by product string prefix (`FPC …`, `FPC Sensor Controller …`), not by a mid-string token; Goodix by product name; known vendor ids (27c6) detected unless bound to a real kernel driver (`uvcvideo`), `usbfs` claims still count; a self-named reader is detected regardless of driver; nothing matching → none.

### hw-hybrid-gpu-test.sh (91 lines)
src: `bin/omarchy-hw-hybrid-gpu` · screen: no (gates Trigger → Hardware → Hybrid GPU) · driver: in QEMU it exits 1 (one GPU, no supergfxctl), hiding the row. [hw-absent]
- a supported `Hybrid` mode from `supergfxctl -s` → hybrid; `Integrated Vfio` → not; an ordinary supergfxctl failure hides the feature; a timeout or wedged (`kill-only`) supergfxd is bounded and falls back to counting GPUs (1 → not hybrid, 2 → hybrid); without supergfxctl GPUs are counted.

### hw-nvidia-test.sh (99 lines)
src: `bin/omarchy-hw-nvidia`, `omarchy-hw-nvidia-gsp`, `omarchy-hw-nvidia-without-gsp` · screen: no · driver: all three exit 1 in QEMU (virtio-vga). [hw-absent]
- no NVIDIA → none; Ampere/Turing/Blackwell → nvidia+gsp; Volta/Pascal/Maxwell → nvidia+without-gsp; Kepler/Fermi → nvidia but neither driver; an NVIDIA audio function is not a GPU; no PCI devices → none.

### hybrid-gpu-test.sh (81 lines)
src: `bin/omarchy-toggle-hybrid-gpu` · screen: yes (floating terminal) · driver: run it in QEMU → without supergfxctl it fails clearly. [hw-absent]
- the mode query retries a transient supergfxd failure (3 attempts) and recovers; after three failures it fails with `supergfxd is not responding. Try again, or check: systemctl status supergfxd`; a client ignoring TERM is killed and reported the same way.

### hyprland-binding-conflicts-test.sh (211 lines)
src: `default/hypr/omarchy.lua` tree (all bindings), `o.bind`/`o.rebind` · screen: yes (Super+K) · driver: `hyprctl binds -j | jq` to look for duplicate chords; verify the deliberate `Alt+Tab` stack.
- the default set includes `SUPER + RETURN Terminal`, `SUPER + SHIFT + A ChatGPT` (preinstalls on), and Voxtype's `F9` bindings when `voxtype` is present.
- no two default bindings claim the same chord (keycodes resolved to keysyms, modifier order ignored) except the deliberate `ALT+TAB` / `ALT+SHIFT+TAB` stack.
- press and release halves of `F9` are separate signatures.
- the checker itself catches `SUPER + 1` vs `code:10` and modifier-order collisions. [unit]
- `o.rebind("SUPER + SHIFT + F", …)` replaces the file-manager binding without stacking; rebind with `{ release = true }` replaces all bindings on the key and keeps the option. [unit]

### hyprland-default-config-test.sh (243 lines)
src: `default/hypr/bindings/{applications,clipboard,tiling,utilities}.lua`, `default/hypr/omarchy.lua`, migration "Move stock Hyprland user overrides into package defaults", `bin/omarchy-upgrade-to-quattro` · screen: yes (hotkeys) · driver: press the chords; Remove → Preinstalls then check `Super+Shift+A`; `hyprctl binds`.
- default application bindings include essentials (`SUPER + RETURN Terminal`) and preinstalled web apps (`SUPER + SHIFT + A ChatGPT`).
- universal clipboard shortcuts send explicit mods via `hl.dsp.send_key_state`, do not target only normal windows, and avoid `wtype -M`. [static]
- with `~/.local/state/omarchy/preinstalls-removed` (or `omarchy_preinstalled_bindings = false`) the essentials stay and the preinstalled web-app bindings are gone.
- `omarchy_default_bindings = false` disables every Omarchy binding. [static]
- installed Voxtype enables `SUPER + CTRL + X Toggle dictation`, `F9` push-to-talk start/stop, detected without `os.execute`; missing Voxtype skips them.
- scratchpad keeps `SUPER + S` / `SUPER + ALT + S` and adds `SUPER + grave` / `SUPER + SHIFT + grave`.
- exactly nine `SUPER + CTRL + code:10..18` chords are the bar panel hotkeys (`Bar panel 1..9`).
- the migration converts a plain legacy `bindings.lua` to the stock stub and records `preinstalls-removed`; `upgrade-to-quattro` marks removed preinstalls before refreshing bindings. [static/migration]

### hyprland-focus-app-test.sh (59 lines)
src: `bin/omarchy-hyprland-focus-app` · screen: yes (focus jumps workspace) · driver: run it from a terminal on another workspace.
- a class match focuses `address:<addr>` via `hl.dsp.focus` (workspace-aware).
- a title match (`kitty`) is accepted only for `org.omarchy.agent` windows.
- a title match on a non-agent window (`Mail`) is rejected: exit non-zero, focus unchanged.

### hyprland-keyboard-layout-test.sh (85 lines)
src: `default/hypr/input.lua`, `etc/mkinitcpio.conf.d/omarchy_hooks.conf` · screen: yes (keyboard layout widget, typed characters) · driver: `hyprctl getoption input:kb_layout` / `hyprctl devices`; `/etc/vconsole.conf`.
- missing `/etc/vconsole.conf` → `us`, options `compose:caps,shift:both_capslock_cancel`.
- `us`/latin layouts pass through with their variant.
- a non-latin layout (ara, ru, il…) gains `us` in front with aligned variants and `grp:alts_toggle`, even when `us` already trails.
- the non-latin layout list stays in sync with the initramfs hook's list. [static]

### hyprland-paths-test.sh (28 lines)
src: `default/hypr/paths.lua` · screen: no · driver: none. [unit]
- empty `XDG_CONFIG_HOME`/`XDG_STATE_HOME` fall back to `~/.config` / `~/.local/state`; set values are honoured. [unit]

### hyprland-qconsole-test.sh (279 lines)
src: `default/hypr/qconsole.lua` · screen: yes (scratchpad geometry) · driver: `Super+grave` / `Super+S`, `Super+Alt+S`, observe the special workspace's gaps.
- a rule exists before any monitor is read; the scratchpad is seeded with `omarchy-agent` pinned to `[workspace special:scratchpad silent]`.
- the console is half the work-area height, scale-independent (520 px gap at 1080p with a 40 px bar; 720 with nothing reserved), flush with the top, centred, borderless.
- an absent or expired monitor handle never wipes the last rule; refitting to the same size does not rewrite.
- a centred 2:1 panel (1080×540 on 16:9; 1807/1265 gaps on 6K; logical pixels at 2×); same-height ultrawide hops still rewrite the sides; a portrait monitor keeps full width; quarter turns are sized portrait, a half turn landscape.
- opening on another monitor after a fit resizes; focus on another output does not rewrite an open console; a vanished output refits on the remaining monitor.
- one tiled window is a console; a second app restores full width (keeping the half-height drop); a third changes nothing; closing back recenters; an empty scratchpad is a console; a hidden console is not refitted on unrelated windows; a not-yet-existing scratchpad is sized as a console.
- a floating window on top keeps the panel; tiling it (Super+T) restores full width, floating again recenters; moving apps on/off (Super+Alt+S / Super+Shift+1) refits; only `window.destroy` (not `window.close`) is hooked.

### hyprland-reload-guard-test.sh (86 lines)
src: `bin/omarchy-hyprland-reload-guard` (`pause`, `resume`, `paused`), alpm hooks `10-omarchy-hyprland-reload-pause.hook` / `90-…-resume.hook` · screen: indirectly (no half-applied config flashes during `omarchy update`) · driver: run `pause`/`paused`/`resume` in a terminal and read `hyprctl getoption misc:disable_autoreload`.
- `pause` stores each live instance's previous `misc.disable_autoreload`/`debug.suppress_errors` in `/run/omarchy/hyprland-reload-guard/<signature>` and sets both true via `hyprctl eval hl.config(...)`.
- instances hyprctl cannot reach (dead signatures) are skipped quietly with no state file.
- `resume` clears the state, forces one `hyprctl --instance <sig> reload`, and restores the previous settings.
- `paused` exits 0 only while a state file exists (no dir / empty dir → not paused).

### hyprland-session-locked-test.sh (84 lines)
src: `bin/omarchy-hyprland-session-locked` · screen: yes (used by `omarchy-restart-shell` and the lock service) · driver: run it from a TTY while the desktop is locked/unlocked; `echo $?`.
- `LOCK` in any monitor's `solitaryBlockedBy` → exit 0 (locked).
- readable monitors without `LOCK` → exit 1 (unlocked), including `null` blockers.
- `LOCK` elsewhere in the payload (names, workspaces) means nothing.
- no monitors, unreachable compositor, unreadable JSON, or every monitor stuck at `WORKSPACE` → exit 2 (undetermined); one readable monitor is enough; a lock beside an unreadable monitor is still found.

### hyprland-window-close-all-test.sh (33 lines)
src: `bin/omarchy-hyprland-window-close-all` (bound to `CTRL + ALT + DELETE`) · screen: yes · driver: open several windows across workspaces, press `Ctrl+Alt+Delete`.
- every client is closed by address via `hl.dsp.window.close`, then workspace 1 is focused.

### hyprland-window-test.sh (39 lines)
src: `bin/omarchy-hyprland-window-tiled-fullscreen-toggle` (bound to `SUPER + CTRL + F`) · screen: yes · driver: press `Super+Ctrl+F` on a tiled window twice.
- from `fullscreenClient 0` it sets `fullscreen_state({ internal = 0, client = 2 })` (app thinks it is fullscreen, stays tiled); from 2 it sets `client = 0`.

### hyprland-workspace-layout-test.sh (69 lines)
src: `bin/omarchy-hyprland-workspace-layout-toggle` (bound to `SUPER + L`), `default/hypr/workspace-layouts.lua` · screen: yes (toast, tiling changes) · driver: `Super+L`, `cat ~/.local/state/omarchy/workspace-layouts/<id>.lua`, `hyprctl reload`.
- toggling saves `hl.workspace_rule({ workspace = "<id>", layout = "scrolling" })` to `~/.local/state/omarchy/workspace-layouts/<id>.lua` and applies it immediately with `hyprctl eval` (toast `Workspace layout set to scrolling`).
- broken `hyprctl activeworkspace` output exits non-zero and persists no `null.lua`.
- saved layouts are loaded back into Hyprland on config load.

### idle-test.sh (54 lines)
src: `shell/plugins/services/idle/IdleModel.js`, `bin/omarchy-toggle-idle` · screen: yes (Stay Awake indicator) · driver: Trigger → Toggle → Stay Awake; `omarchy toggle idle status`.
- configured seconds floor, negatives/invalid fall back. [unit]
- event parsing and screensaver window bookkeeping. [unit]
- `omarchy-toggle-idle stay-awake` creates `~/.local/state/omarchy/indicators/stay-awake`; `allow-idle` removes it; the toggle never calls `omarchy-shell` (no reentrant IPC).

### image-picker-test.sh (54 lines)
src: `shell/plugins/image-picker/{ImagePickerModel.js,ImagePicker.qml}` · screen: yes (background picker `Super+Ctrl+Space`) · driver: open the picker, type a filter, watch the carousel.
- names strip directory and extension; labels title-case (`nord_river` → `Nord River`). [unit]
- rows dedupe by file name, keep thumbnails, ignore blank/path-less rows. [unit]
- filter matches file names and labels case-insensitively; non-matches hidden; selection moves to the first match when the current is hidden; an unknown selected image defaults to the first row.
- cache preloads are ignored while a request is visible; activated thumbnails load synchronously (no flicker). [unit]

### indicator-contract-test.sh (78 lines)
src: `shell/Ui` indicators (fixture `fixtures/indicator-contract/shell.qml`) · screen: yes (bar indicator tray) · driver: only "indicators render, no binding loop" (journal); the fixture is host tooling. [unit/QML]
- all indicator contracts pass; `Indicators.qml` produces no `Binding loop detected for property "implicitWidth"`.

### input-group-migration-test.sh (64 lines)
src: `migrations/1787865477.sh` · screen: yes (reboot indicator) · driver: `id -nG`, run the migration, check `omarchy-state`.
- a user in `input` is removed (`gpasswd -d <user> input`) and `reboot-required` is set; already-absent → no-op, no flag; `xpadneo-dkms` or `ydotool` installed → membership preserved, no flag.

### installed-service-test.sh (101 lines)
src: `bin/omarchy-installed-service-dropbox`, `bin/omarchy-installed-service-tailscale` · screen: indirectly (bar widgets) · driver: run both in a terminal on the stock disk (both exit 1).
- Dropbox counts as installed when `dropbox-cli running` succeeds or a `dropbox` process exists; otherwise rejected.
- Tailscale counts when `tailscale status --json` succeeds, or the systemd unit is active, or `tailscaled` runs; otherwise rejected.

### kernel-headers-migration-test.sh (58 lines)
src: `migrations/1789444024.sh` · screen: yes (`pacman -Q`) · driver: `pacman -Q linux-omarchy linux-omarchy-headers`.
- `linux-omarchy` / `linux-t2` (or both) get their `-headers` once; rerun is idempotent; unrelated kernels skipped; a failed install leaves the migration pending.

### keybindings-menu-test.sh (222 lines)
src: `bin/omarchy-menu-keybindings` (`--print`, `alternative_chord_actions`), `default/hypr/bindings/*.lua` · screen: yes (Super+K) · driver: `Super+K`; `omarchy-menu-keybindings --print` in a terminal (redirect to serial).
- a chord with no alternative renders alone (`SUPER + F  → Full screen`).
- alternative chords for a named action share one row, first-declared leading: `SUPER + W / SUPER + Q  → Close window`.
- `grave` renders as the printed symbol: `SUPER + S / SUPER + ~  → Toggle scratchpad`; no entry says `grave`; a keycode (49) resolves the same.
- every arrow sits in column 36; no row exceeds 78 characters.
- a shared chord does not change ranking (media keys stay in the tail).
- a chord refused for width opens its own row and the next chord tries that row (no reordering); chords too wide to share stay apart and keep the column.
- only actions Omarchy names (`Close window`, `Calculator`, `Toggle scratchpad`, `Move window to scratchpad`) pair; same label + different action stay apart; unresolved Lua dispatch stays apart.
- each named alternative action is bound at least twice in `default/hypr/bindings`. [static]

### keyboard-layout-test.sh (136 lines)
src: `shell/plugins/bar/widgets/KeyboardLayoutModel.js` · screen: yes (keyboard-layout bar widget) · driver: `omarchy bar put omarchy.keyboard-layout --after omarchy.clock`, add a second layout, switch, read the label.
- `xkbcli list` briefs are read per layout/variant only (models, option groups, nested options skipped; an orphaned brief stops at its block).
- labels are the language, not the country: `EN` for English (US), `PT` for Portuguese (Brazil), `EO`, `ES`, `MY` (script dropped), `CUS` for a word brief; unlisted layouts fall back to the description (`ELV`); empty table → `ENG`; `constructor` → `CON`; no keymap → no label.
- the keyboard that switched is read over buttons holding `main`; ACPI buttons (`power-button`, `lid-switch`, `sleep-button`) and `hl-virtual-keyboard-*` are not typed keyboards; a keyboard reporting no name is left as found.
- the `activelayout` event names its keyboard even when the description has a comma; virtual-keyboard events name none.

### kitty-config-test.sh (154 lines)
src: `migrations/1788745941.sh`, `config/kitty/kitty.conf`, `bin/omarchy-display-text-size`, `bin/omarchy-font-set` · screen: yes (terminal font size) · driver: edit `~/.config/kitty/kitty.conf`, run the migration, `omarchy display text-size 16`, `omarchy font set <family>`.
- a stock legacy kitty config is replaced by the current template with a `.bak.*` backup and the message `Close and reopen all Kitty windows`; rerun is idempotent and silent.
- a customised config keeps ordering/mappings/theme/permissions (0600); every `allow_remote_control yes|y|true` line is commented out (`# …`), restricted modes (`no`, `n`, `false`, `socket-only`, `socket`, `password`) are preserved, omitted settings stay omitted, an absent config stays absent, a dotfile symlink is preserved and its target repaired.
- `omarchy-display-text-size` reports `terminal font: 9 pt` (inherited default, even with no config); `16` writes `font_size 12.0`; `omarchy-font-set` writes one `font_family` override (updated, never duplicated); commented instructions are kept; `reset` restores `font_size 9.0`; font controls never add an `include` line.

### launch-1password-test.sh (46 lines)
src: `bin/omarchy-launch-1password`, `default/hypr/bindings/applications.lua` (`SUPER + SHIFT + SLASH`) · screen: yes · driver: press `Super+Shift+/` on the stock disk (1Password absent) → installer terminal.
- installed → `setsid -- 1password --force-device-scale-factor=1`; missing → `omarchy-install-service-1password` in a floating terminal; the binding uses `{ omarchy = "1password" }`.

### launch-about-test.sh (264 lines)
src: `bin/omarchy-launch-about` (sourced short of `presize_window`), `etc/fastfetch/config.jsonc` · screen: yes (About window) · driver: Omarchy Menu → About; screenshots over ~2 s catch the glint; plant `~/.config/fastfetch/config.jsonc` for the still path.
- the launcher sources the sheen (`sheen_build`); its padding constants equal the fastfetch config's `logo.padding` (top/left/right).
- a roomy window animates, handing the sheen the About logo path, the logo's start cell, fastfetch's own colour (`\e[0m` + colour), and the columns left of the module column.
- a user fastfetch config in `~/.config/fastfetch` or `~/fastfetch` leaves the logo still; one searched after Omarchy's own still animates; a path with a space is found; a failed enumeration does not read as "no config".
- a window level with the layout's last line (scrolled) is left still; one row past it animates.
- a failed build leaves no stale frames; `NO_COLOR` leaves the logo still.
- a resize landing during the check stops the sweep before it paints; an undisturbed sweep writes every frame; the render loop calls `build_sheen`/`play_sheen`/`rest_sheen`.
- an unmeasurable layout is left still; the fit asks fastfetch for the layout height and keeps spare rows/columns (bare content is refused; a scrolling window is refused).
- the logo is measured wherever fastfetch drew it (any padding); a render without the logo text is not measured.

### launch-browser-test.sh (81 lines)
src: `bin/omarchy-launch-browser` · screen: yes (focus jumps to the browser workspace) · driver: from a terminal on another workspace run `omarchy launch browser https://example.com`.
- launching without a URL (normal or `--private`) leaves the new window on the current workspace (no focus call).
- launching with a URL passes it through and focuses the default browser's window (`^chromium.*$`) wherever it is.
- when `xdg-settings` answers empty, the `x-scheme-handler/https` handler is used; `BROWSER` is unset before asking `xdg-settings`.

### launcher-remove-test.sh (96 lines)
src: `bin/omarchy-remove-launcher-entry` · screen: yes (Apps menu → Delete) · driver: Apps menu, select an entry, press `Delete`, confirm.
- a web app (`Exec=omarchy-launch-webapp …`) routes to `omarchy-webapp-remove <Name>`; a TUI (`xdg-terminal-exec … -e`) to `omarchy-tui-remove <Name>`; a package-owned entry opens `echo Uninstalling Native...; sudo pacman -Rns <pkg>` in a floating terminal; a user-owned plain desktop file is deleted silently (no notification).

### launch-openclaw-test.sh (189 lines)
src: `bin/omarchy-launch-openclaw` (`--tui`, `--message`) · screen: yes (wizard terminal / web app) · driver: needs OpenClaw installed (Install → AI → OpenClaw, NET/SLOW). [VM-NO on stock disk]
- a never-onboarded machine gets `omarchy-openclaw-onboard && [[ -f $HOME/.openclaw/openclaw.json ]] && omarchy-launch-openclaw` in a floating terminal, never the web app.
- a running gateway's `browserUrl` opens as the web app; a never-enabled unit gets `gateway install --force` then polling (never `dashboard --yes`); an enabled-but-stopped unit gets `gateway start`; a hanging probe is bounded by `timeout 10`; a gateway that never answers fails without opening a dead page.
- `--tui` onboards in the current terminal and attaches with `openclaw tui`; `--message <text>` seeds the session as one argument.

### launch-shell-test.sh (204 lines)
src: `bin/omarchy-launch-shell` (Quickshell supervisor started from `default/hypr/autostart.lua`) · screen: yes (bar disappears/returns) · driver: `kill -9 $(pgrep -x quickshell)` from a terminal; `journalctl -t omarchy-shell`; `cat /proc/$(pgrep -x quickshell)/environ`.
- the shell launches `quickshell -n -p $OMARCHY_PATH/shell` with `QS_DISABLE_FILE_WATCHER=1` and `QS_NO_RELOAD_POPUP=1`.
- a clean exit (0) is not relaunched; a non-zero exit is relaunched once per death with journal line `Omarchy shell exited with status <n>; relaunching.`
- more than 5 relaunches within a minute gives up: `Giving up on the Omarchy shell after 6 relaunches in under a minute.`
- no relaunch once the compositor is gone; a compositor that misses two queries is not mistaken for gone.
- a TERM during backoff stops the supervisor before it relaunches; stopping the supervisor TERMs the running shell.

### legacy-icon-font-migration-test.sh (106 lines)
src: `migrations/1788848726.sh`, `bin/omarchy-upgrade-to-quattro` · screen: no · driver: copy `/usr/share/fonts/omarchy/omarchy.ttf` to `~/.local/share/fonts/omarchy.ttf`, run the migration.
- a user font byte-identical to the known stock font is removed and `fc-cache -f` runs; idempotent; a modified font, a symlink, or an absent font is left alone; a missing packaged replacement keeps the file and fails; a failed `fc-cache` keeps the migration pending and retries the refresh.
- the upgrader no longer treats the user font as a config file. [static]

### legacy-power-udev-rules-migration-test.sh (651 lines)
src: `migrations/1788102906.sh` (legacy `99-power-profile.rules` / `99-wifi-powersave.rules` and `~/.XCompose` include) · screen: yes (terminal messages) · driver: `sudo tee` a vulnerable rule into `/etc/udev/rules.d/`, run `bash /usr/share/omarchy/migrations/1788102906.sh`, inspect.
- exactly one migration owns both legacy filenames; production paths (`/etc/udev/rules.d`, `/var/lib/omarchy/migrations/1788102906-udev-reload-needed`, `/run/udev/control`) are fixed literals with no env override. [static]
- `~/.XCompose` includes of `%H/…`, `~/…` or `<home>/.local/share/omarchy/default/xcompose` are repointed to `include "$OMARCHY_PATH/default/xcompose"`, custom sequences kept, `omarchy-restart-xcompose` run; idempotent; a missing XCompose is not created.
- the exact Omarchy-3-generated power rule bodies (three variants) and Wi-Fi rule bodies (two variants) running out of a user home are removed with `sudo /usr/bin/rm -f`, followed by `sudo /usr/bin/udevadm control --reload` after each removal, using pinned `/usr/bin/{install,rm,mv,udevadm}`.
- a failed reload keeps a durable per-rule marker and the migration pending; a retry finishes the reload; a pre-existing marker is never consumed before removal; power and Wi-Fi markers are independent; a safe replacement installed after an interruption still gets one reload; with no udev control socket the disk-only repair completes.
- second runs and machines without the rules touch nothing.
- an unreadable rule or unsearchable rules dir fails closed with `Ask an administrator to run omarchy-migrate`.
- same-named rules that only mention the legacy path in comments are kept byte-for-byte; a legacy filename already repointed at `/usr/bin` is kept; a rule naming the wrong binary is kept.
- a vulnerable rule an admin extended, a reformatted `RUN += "…"`, and every RUN assignment form (`RUN{program}+=`, `RUN=`, `RUN:=`, `RUN+=e`) are quarantined to `<rule>.omarchy-disabled` (`.1` on collision, never overwriting) with `Quarantined … .omarchy-disabled` reported, then reloaded; retry is a no-op.
- another user's rule rooted outside `/home` is removed; a user who cannot `sudo` gets `Ask an administrator to run omarchy-migrate` and the rule stays; a later removal failure cannot leave an already-deleted rule loaded.

### lid-close-test.sh (93 lines)
src: `bin/omarchy-system-lid-close` (bound to `switch:on:Lid Switch`) · screen: yes (lock) · driver: **no lid in QEMU** — running the handler manually shows the "open lid never locks" path. [hw-absent]
- undocked + closed: lock first (`omarchy-system-lock`), then `omarchy-hyprland-monitor-clamshell`.
- docked (external monitor) + closed: no lock, displays reconciled.
- an open lid never locks. [VM-visible]
- a failing lock still reconciles displays.

### limine-defaults-test.sh (15 lines)
src: `etc/limine-entry-tool.d/omarchy-defaults.conf` · screen: yes (`cat /proc/cmdline`, boot menu) · driver: read the file and `/proc/cmdline` in a terminal.
- `KERNEL_CMDLINE[default]+=" initramfs_async=0"` keeps Plymouth alive at the LUKS prompt; `BOOT_ORDER="linux-t2, linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`.

### locale-env-test.sh (28 lines)
src: `default/bash/envs` · screen: yes (terminal glyphs) · driver: `echo $LANG`; `printf "\U000F17A9"` in a terminal shows a glyph, not `\U000F17A9`.
- a UTF-8 `LANG` is set when none is inherited (non-login shells, SSH); an inherited locale is preserved; `\U` escapes render.

### locate-test.sh (98 lines)
src: `default/systemd/system/plocate-updatedb.service.d/10-omarchy.conf`, `etc/systemd/system/plocate-updatedb.service.d/ac-only.conf`, `install/post-install/localdb.sh`, `bin/omarchy-pkg-aur-install` · screen: yes (`locate` results) · driver: `systemctl cat plocate-updatedb.service`; create a file, `sudo updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots`, `locate <file>`.
- the drop-in replaces `ExecStart` with `/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` and keeps `ConditionACPower=true`; the retired `locate.sh` helper/migration and their references are gone. [static]
- `localdb.sh` and `omarchy-pkg-aur-install` pass the same options.
- real `updatedb` indexes current files, excludes `/.snapshots`, honours literal admin `PRUNEPATHS`, and never modifies `updatedb.conf` (bytes, mode, owner, mtime); repeated indexing is stable.

### lock-blank-fingerprint-test.sh (33 lines)
src: `shell/plugins/lock/Service.qml` · screen: yes (lock screen blanking) · driver: lock, wait a few seconds → black; type → returns; blanking still happens while the fingerprint PAM is "armed" (n/a in QEMU, but the password rule is testable).
- only a password check in flight (`authenticatingPassword`) stops the blank timer; the combined `authenticating` state (fingerprint waiting) never gates it; the timer is stopped during password entry and re-armed after.

### lock-fingerprint-indicator-test.sh (73 lines)
src: `shell/plugins/lock` fingerprint indicator (fixture `fixtures/lock-fingerprint-indicator/shell.qml`) · screen: yes (indicator on lock screen) · driver: in QEMU no sensor is configured → no fingerprint indicator on the lock screen. [hw-absent]
- the fingerprint indicator tracks the configured sensor (QML contract `ok: true`). [unit/QML]

### lock-password-overflow-test.sh (73 lines)
src: `shell/plugins/lock` password field (fixture `fixtures/lock-password-overflow/shell.qml`) · screen: yes · driver: at the lock screen type a very long password (150+ chars) and screenshot the field.
- the password dots shrink to fit the field instead of overflowing it.

### lock-stranded-recovery-test.sh (89 lines)
src: `shell/plugins/lock/Service.qml`, `bin/omarchy-hyprland-session-locked` · screen: yes (lock screen comes back after a shell crash) · driver: lock, `kill -9 quickshell` from a TTY, watch the relaunched shell re-lock; `journalctl` for `lock-stranded: recovering`.
- at startup the lock service asks the compositor (`omarchy-hyprland-session-locked`) whether the session is already locked.
- exit 2 (undetermined) never resolves the check; only exit 0 counts as stranded; a lock this shell took meanwhile is not stranded.
- the check retries while the compositor cannot answer, stops once answered, and re-asks (with fresh settling time) when a screen comes back; re-arming never restarts an answered check.
- recovery runs only with a stranded lock, not already locked, and PAM configured; it retries once PAM loads and re-asks the compositor instead of trusting a stale answer; it takes the lock once and logs `lock-stranded: recovering`.

### logging-test.sh (51 lines)
src: `install/helpers/logging.sh` (`run_logged`) · screen: no (installer log) · driver: none post-install. [host/install-time]
- `run_logged` returns the failing script's status under `errexit`, logs `Starting:`, the output, and `Failed: <script> (exit code: 1)` to `OMARCHY_INSTALL_LOG_FILE`; with `OMARCHY_LOG_TO_STDOUT=1` it emits the same to stdout and writes no log file.

## Observations

Things a driver must know before running anything below. All hotkeys/paths were checked against
`default/hypr/bindings/*.lua` and `default/omarchy/omarchy-menu.jsonc` at HEAD.

- **Stock state that matters.** The minted disk has **no default agent** (`~/.config/omarchy/defaults/agent`
  absent) — the first-run hook only sends an invitation toast. Chromium is the only browser; Firefox/Zen are
  absent (their policy paths do not exist). `sudo` prompts for the password `prime` (Passwordless Sudo is
  opt-in). Bluetooth, battery, backlight, lid, fingerprint, NVIDIA and hybrid GPU are all absent, so every
  `when: omarchy-hw-*` menu row is hidden and the `omarchy-hw-*` detectors exit 1 — **except**
  `omarchy-hw-external-monitors`, which treats QEMU's `Virtual-1` connector as an external display (exit 0).
- **Hotkeys used here.** `Super+Space` Omarchy menu root · `Super+Escape` System submenu · `Super+Alt+Space`
  Apps · `Super+Ctrl+Space` Background picker · `Super+Ctrl+V` clipboard manager · `Super+Ctrl+E` emoji
  picker · `Super+K` keybindings · `Super+Ctrl+L` lock (NOT `Super+L`, which toggles the workspace layout) ·
  `Super+Ctrl+Alt+D` calendar · `Super+Ctrl+F` tiled fullscreen · `Ctrl+Alt+Delete` close all windows ·
  `Super+S` / `` Super+` `` scratchpad, `Super+Alt+S` / `` Super+Shift+` `` move to scratchpad · `Super+T`
  float toggle · `Super+Shift+Ctrl+A` agent · `Super+Shift+/` 1Password · `Super+Enter` terminal ·
  `Super+Ctrl+1..9` bar panels. Any menu item can also be reached by typing `omarchy menu summon <id>` (e.g.
  `setup.default.agent`).
- **Reading output.** Floating "presentation" terminals close when their command exits; for anything the
  driver must read, run the command in a normal terminal (`Super+Enter`) instead. Long output goes to the
  serial console with `… 2>&1 | sudo tee /dev/ttyS0` and is read with `./client get-serial`. Journal lines:
  `journalctl --user -t omarchy-shell --no-pager` / `journalctl -b --no-pager | grep -F 'lock-stranded'`.
- **The `omarchy` router.** Every `omarchy-<group>-<name>` binary is also `omarchy <group> <name>`; both are
  on PATH. Used below: `omarchy agent`, `omarchy default agent|browser|terminal|editor`, `omarchy crash mute`,
  `omarchy hook`, `omarchy state`, `omarchy done`, `omarchy dev link|unlink`, `omarchy channel current|set`,
  `omarchy bar …`, `omarchy ascii`, `omarchy toggle idle`, `omarchy dns`, `omarchy launch browser`,
  `omarchy restart shell`, `omarchy refresh shell`, `omarchy display text-size`, `omarchy font set`.
- **Migrations** are plain scripts at `/usr/share/omarchy/migrations/<timestamp>.sh`. Every migration in this
  scope is asserted idempotent, so re-running one by hand (`bash /usr/share/omarchy/migrations/<ts>.sh`)
  on a fixture the driver creates is safe and is the only way to see their negative paths in the guest.
- **Shell supervision.** `omarchy-launch-shell` (started by `default/hypr/autostart.lua`) relaunches
  Quickshell on any non-zero exit, including SIGKILL (status 137), but exits itself when Quickshell exits 0
  — which is what `omarchy restart shell` (`quickshell kill`) does, so after a restart a *new* supervisor is
  running. Six deaths inside 60 s make it give up; `omarchy restart shell` is the way back.
- **Reload guard** state lives in root-owned `/run/omarchy/hyprland-reload-guard`; drive it with
  `sudo omarchy-hyprland-reload-guard pause|resume` (root scans `/run/user/*/hypr/*`). `paused` needs no root.
- **Lock/TTY.** `omarchy-hyprland-session-locked` needs `HYPRLAND_INSTANCE_SIGNATURE`; from a TTY export
  it as `$(ls /run/user/1000/hypr | tail -1)`. TTY3 is `Ctrl+Alt+F3`; the desktop is on `Ctrl+Alt+F1`
  (try `F2` if SDDM took tty1). The lock screen blanks after a few seconds; any key wakes it.
- **Crash toasts.** `systemd-coredump` writes the journal entry even with `ulimit -c 0`; `sleep 60 &
  kill -SEGV $!` is enough to make the watcher toast `Process crashed: sleep`.
- **Light themes** for the bar-text-colour test: `flexoki-light`, `catppuccin-latte`, `white`
  (`omarchy-theme-set <name>`); `tokyo-night` is dark.
- **Default `shell.json`**: clock `format` is `dddd HH:mm`, `formatAlt` is `d MMMM 'W'ww yyyy`; the ring
  after a right click is `dddd h:mm AP` next. `omarchy bar defaults` restores it.
- **Apps menu delete**: select a row, press `Delete`, confirm in the dialog (`confirmDelete` →
  `omarchy-remove-launcher-entry`). Clipboard manager: `Enter` pastes, `Delete` removes, `Home`/`End` jump.
- **Things that are unit-only even though they look testable**: everything under `agent-usage-*` that
  needs a live Anthropic/OpenAI/Fireworks account, the audio panel (no sound device), the QML geometry
  fixtures (`bar-icon-geometry`, `button-border-stability`, `indicator-contract`, `bar-widget-contract`),
  and the Apple/NVIDIA/T2 hardware quirks.

## Proposed tests

Every step below is one of the `./client` verbs: a hotkey or typed command (`send-keys`), a click
(`mouse …`), a screenshot (`get-image`), or a `… | sudo tee /dev/ttyS0` read back with `get-serial`.
Commands are typed into a terminal opened inside the guest with `Super+Enter`; `sudo` asks for `prime`
once per terminal.

### reload-guard-pause-resume   [VM-OK]
description: Omarchy pauses Hyprland's config auto-reload for the length of a package transaction and then forces one reload with the previous settings restored, so an update never flashes a half-written config.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `hyprctl getoption misc:disable_autoreload; omarchy-hyprland-reload-guard paused; echo paused=$?` — expect `bool: false` and `paused=1`.
  * Type `sudo omarchy-hyprland-reload-guard pause` (password `prime`).
  * Type `hyprctl getoption misc:disable_autoreload; hyprctl getoption debug:suppress_errors; omarchy-hyprland-reload-guard paused; echo paused=$?` — both `bool: true`, `paused=0`.
  * Type `sudo omarchy-hyprland-reload-guard resume` — the desktop may redraw once (bar/borders), and only once.
  * Type the same three-command check again — both `bool: false`, `paused=1`: the machine is back exactly as it started.
  ** `sudo omarchy-hyprland-reload-guard resume` a second time prints nothing and changes nothing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Root is needed because the guard's state lives under `/run/omarchy`; `paused` alone needs no sudo.
  * Read the `bool:` line of `getoption`; `set:` may say false and is irrelevant.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `bool: false`/`paused=1` → `pause` → `bool: true`×2/`paused=0` → `resume` → `bool: false`×2/`paused=1`
  ** At most one visible redraw at `resume`
  * If unsuccessful
  ** The terminal output at the failing step; `journalctl -b --no-pager | grep -i reload-guard | sudo tee /dev/ttyS0`
covers: test/shell.d/hyprland-reload-guard-test.sh; bin/omarchy-hyprland-reload-guard; default/libalpm/hooks/10-omarchy-hyprland-reload-pause.hook, 90-omarchy-hyprland-reload-resume.hook; docs/update-process.md

### lock-stranded-shell-crash-recovers   [VM-OK]
description: When the shell dies behind a locked screen, the relaunched shell notices the compositor's stranded lock and re-locks so the user can still type the password instead of being locked out until reboot.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L to lock; screenshot the lock screen.
  * Press Ctrl+Alt+F3, log in as `prime` / `prime`.
  * Type `export HYPRLAND_INSTANCE_SIGNATURE=$(ls /run/user/1000/hypr | tail -1); omarchy-hyprland-session-locked; echo locked=$?` — expect `locked=0`.
  * Type `kill -9 $(pgrep -x quickshell); sleep 3; pgrep -x quickshell` — a new PID is printed (the supervisor relaunched the shell).
  * Type `journalctl -b --no-pager | grep -E 'relaunching|lock-stranded' | tail -3` — expect `Omarchy shell exited with status 137; relaunching.` and `lock-stranded: recovering`.
  * Press Ctrl+Alt+F1 (or F2 if the desktop is not there): the lock screen must be showing again with a password field, not a black failsafe.
  ** The lock screen blanks after a few seconds; tap Shift to wake it.
  * Type `prime` and Enter — the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If no lock screen returns within 10 seconds after switching back, that is the failure: screenshot it and dump the journal to serial from the TTY.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `locked=0`; a new quickshell PID; the two journal lines; the restored lock screen with a password field; the restored desktop
  * If unsuccessful
  ** Screenshot of a black/fieldless screen after switching back; `journalctl -b --no-pager | tail -100 | sudo tee /dev/ttyS0`
covers: test/shell.d/lock-stranded-recovery-test.sh, hyprland-session-locked-test.sh, launch-shell-test.sh (relaunch on non-zero exit); shell/plugins/lock/Service.qml; bin/omarchy-launch-shell; bin/omarchy-hyprland-session-locked

### restart-shell-refuses-while-locked   [VM-OK]
description: `omarchy restart shell` must refuse to kill a live lock screen (which would strand the session) but restart normally on an unlocked desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L to lock. Press Ctrl+Alt+F3 and log in as `prime` / `prime`.
  * Type `pgrep -x quickshell` and note the PID.
  * Type `export HYPRLAND_INSTANCE_SIGNATURE=$(ls /run/user/1000/hypr | tail -1); omarchy restart shell; echo status=$?` — expect `Refusing to restart Omarchy shell while the session is locked.` and `status=1`.
  * Type `pgrep -x quickshell` — the same PID as before.
  * Press Ctrl+Alt+F1, tap Shift to wake the lock screen, unlock with `prime`.
  * Open a terminal (Super+Enter) and type `omarchy restart shell; echo status=$?; omarchy-hyprland-session-locked; echo locked=$?` — the bar disappears and comes back, `status=0`, `locked=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Return to the desktop with Ctrl+Alt+F1; try Ctrl+Alt+F2 if the desktop is not on tty1.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The refusal line with `status=1` and an unchanged PID; the bar returning on the unlocked restart with `status=0` and `locked=1`
  * If unsuccessful
  ** The TTY output; if the lock screen vanished, a screenshot of what replaced it
covers: test/shell.d/hyprland-session-locked-test.sh (exit 0/1), lock-stranded-recovery-test.sh; bin/omarchy-restart-shell; bin/omarchy-hyprland-session-locked

### lock-screen-long-password-dots-fit   [VM-OK]
description: The lock screen's password dots shrink to fit the field for a very long password, a wrong password is rejected and the screen stays locked, and the right one unlocks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L; tap Shift to wake the lock screen.
  * Type 160 characters of `a` in four chunks of 40 without pressing Enter; screenshot — every dot stays inside the password field, nothing spills past the card.
  ** The screen blanks after a few seconds of no input; keep typing or tap Shift first.
  * Press Backspace 20 times — the dot count drops and the dots re-space themselves, still inside the field; screenshot.
  * Press Enter — the wrong password is rejected (error state, field cleared) and the screen stays locked; screenshot.
  * Type `prime` and Enter — the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the 40-character chunks back to back; a pause longer than a few seconds blanks the screen (the keys still land).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with 160 dots inside the field; the rejected attempt still on the lock screen; the restored desktop
  * If unsuccessful
  ** Dots overflowing the field, or the desktop unlocking on the wrong password
covers: test/shell.d/lock-password-overflow-test.sh; shell/plugins/lock; existing `lock-screen` definition (negative path)

### lock-screen-blanks-when-idle   [VM-OK]
description: The locked screen blanks after a short idle (even with a partial password typed) and is held unblanked only while a password is actually being checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L; screenshot immediately (lock screen visible).
  * Wait 5 seconds doing nothing; screenshot — the screen is black.
  * Type `prim` (no Enter); screenshot — the lock screen is back showing 4 dots.
  * Wait 5 seconds; screenshot — black again despite the partial password.
  * Tap Shift, type `wrongpass` and Enter, screenshot within a second — the field is being checked and the screen is not black; the attempt is then rejected.
  * Type `prime` and Enter — the desktop returns.
  ** If characters were swallowed while blank, press Backspace ten times first.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Wait 5 seconds" is one 5-second pause then a screenshot, not repeated polling that would keep the screen awake.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Blank after idle; visible after typing; blank again with a partial password; not blank during the check; restored desktop
  * If unsuccessful
  ** The screen never blanking, or blanking mid-check
covers: test/shell.d/lock-blank-fingerprint-test.sh; shell/plugins/lock/Service.qml; manual/13-toggles-idle-screensaver.md

### shell-supervisor-relaunches-and-gives-up   [VM-OK]
description: A crashed shell is relaunched within seconds, a crash loop is abandoned after five relaunches in a minute rather than spinning forever, and `omarchy restart shell` brings the bar back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cat /proc/$(pgrep -x quickshell)/environ | tr '\0' '\n' | grep '^QS_'` — expect `QS_DISABLE_FILE_WATCHER=1` and `QS_NO_RELOAD_POPUP=1`.
  * Type `kill -9 $(pgrep -x quickshell)` — the bar disappears and is back within 3 seconds; screenshot both.
  * Type `journalctl --user -t omarchy-shell --no-pager | tail -1` — `Omarchy shell exited with status 137; relaunching.`
  * Type `for i in 1 2 3 4 5 6; do kill -9 $(pgrep -x quickshell); sleep 1.5; done; sleep 3; pgrep -x quickshell || echo shell-gone` — expect `shell-gone`, bar absent.
  * Type `journalctl --user -t omarchy-shell --no-pager | tail -1` — `Giving up on the Omarchy shell after 6 relaunches in under a minute.`
  * Type `omarchy restart shell` — the bar returns; the desktop is as it started.
  ** The terminal window stays open throughout; only the bar and panels vanish.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A `kill` error inside the loop means the shell was already gone that round; that is fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both `QS_` variables; bar gone then back; the `relaunching.` line; `shell-gone`; the `Giving up` line; bar back after restart
  * If unsuccessful
  ** The bar never returning after one kill, or returning after the give-up (journal via `| sudo tee /dev/ttyS0`)
covers: test/shell.d/launch-shell-test.sh; bin/omarchy-launch-shell; bin/omarchy-restart-shell; docs/omarchy-shell.md

### agent-launcher-refuses-without-default   [VM-OK]
description: With no coding agent chosen, the agent hotkey opens the picker and the CLI explains how to choose one; unsupported names and positional prompts are refused without changing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy default agent; echo "[$?]"` — an empty line then `[0]` (nothing chosen on a stock disk).
  * Type `omarchy agent; echo status=$?` — `Choose default agent with: omarchy default agent <name>`, non-zero, no window opens.
  * Press Super+Shift+Ctrl+A — the Omarchy menu opens on "Default Agent" (Antigravity … Pi); press Escape.
  * Type `omarchy default agent unsupported; echo status=$?` — `Usage: omarchy-default-agent <pi|omp|opencode|ori|claude|codex|grok|openclaw|agy|hermes|copilot|crush|cursor-agent|muse>`, non-zero.
  * Type `omarchy agent Review this project; echo status=$?` — a message pointing at `omarchy agent prompt`, non-zero, no window.
  * Type `alias a; ls ~/.local/bin | grep -cE '^(agy|omp|ori|grok|crush|cursor-agent|muse)$'` — `alias a='omarchy-agent --inline'` and `7`.
  * Type `omarchy default agent; echo "[$?]"` — still empty: nothing changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkey menu is the same as typing `omarchy menu summon setup.default.agent`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Each refusal message with its non-zero status on screen; the Default Agent submenu; the unchanged empty default at the end
  * If unsuccessful
  ** A window that opened, a changed default, or a missing message
covers: test/shell.d/default-agent-test.sh (no default, --pick menu, unsupported, positional prompt, alias, lazy stubs); bin/omarchy-agent; bin/omarchy-default-agent; default/hypr/bindings/utilities.lua; manual/17-ai.md

### agent-invitation-hook-once   [VM-OK]
description: The first-run "choose an agent" toast fires once, its click opens the Default Agent menu, it never repeats, and it stays silent without burning its marker when an agent is already chosen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `rm -f ~/.local/state/omarchy/done/agent-setup-invitation ~/.config/omarchy/defaults/agent` (fresh state).
  * Type `bash ~/.config/omarchy/hooks/post-update.d/setup-agent.hook` — one toast inviting you to choose an agent appears; screenshot.
  * Click the toast — the Omarchy menu opens on "Default Agent"; press Escape.
  * Type `ls ~/.local/state/omarchy/done/agent-setup-invitation` — the marker exists.
  * Run the hook again — no toast within 3 seconds.
  * Type `rm ~/.local/state/omarchy/done/agent-setup-invitation; mkdir -p ~/.config/omarchy/defaults; echo pi > ~/.config/omarchy/defaults/agent` and run the hook again — no toast, and `ls ~/.local/state/omarchy/done/agent-setup-invitation` fails.
  * Type `rm ~/.config/omarchy/defaults/agent` to leave the stock state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts appear near the bar; move the mouse onto the toast before clicking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One toast; the Default Agent menu after the click; marker present; no toast on rerun; no toast and no marker with a default set
  * If unsuccessful
  ** A second toast, a missing marker, or a marker written while a default was set
covers: test/shell.d/agent-invitation-test.sh; install/user/first-run/setup-agent.hook; bin/omarchy-done

### default-agent-missing-opens-installer   [VM-PARTIAL] [NET]
description: Choosing an agent that is not installed opens a visible installer terminal (no toast) and leaves the current choice untouched until the install succeeds; cancelling keeps the previous choice. The download is cancelled here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy default agent` — note the value (expect empty).
  * Press Super+Space, go to Setup → Defaults → Agent and click "Codex".
  * A floating terminal opens running the install (mise output); no toast appears; screenshot.
  * Press Ctrl+C in the floating terminal within 10 seconds — it closes.
  * In your terminal type `omarchy default agent` — unchanged (still empty).
  * Type `omarchy default agent codex` — the same floating installer opens; cancel it with Ctrl+C.
  ** Skipped in this VM: letting mise finish the download (minutes).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal is centred on screen; click into it before pressing Ctrl+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The floating install terminal, no toast, and an unchanged default after cancelling
  * If unsuccessful
  ** A toast, a changed default, or no terminal
covers: test/shell.d/default-agent-test.sh (missing agent → install terminal, failed install preserves selection); bin/omarchy-default-agent; default/omarchy/omarchy-menu.jsonc setup.default.agent.*

### agents-widget-clicks   [VM-OK]
description: The bar's agents pill opens its panel on left click, launches or picks the agent on right click, and cycles providers on middle click.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Find the agents widget in the bar's right section (right after the tray); hover it to see its tooltip.
  * Left-click it — a panel opens with agent usage; with nothing signed in it reads "Waiting for auth" for Claude; screenshot.
  * Left-click again — the panel closes.
  * Middle-click it — the shown provider advances (panel/label changes); middle-click until it is back where it started.
  * Right-click it — because no default agent is set, the Omarchy menu opens on "Default Agent"; press Escape.
  * Screenshot the bar — unchanged from the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use the mouse for all three clicks; do not use hotkeys for this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Panel open with "Waiting for auth"; panel closed; provider cycled; the Default Agent menu after right click
  ** The mouse was used for every click
  * If unsuccessful
  ** The panel not opening, a right click that does nothing or refreshes instead, a crash dialog
covers: test/shell.d/agents-panel-test.sh, agent-usage-claude-limits-test.sh (Waiting for auth status text); shell/plugins/agents/Panel.qml

### agent-usage-collectors-without-accounts   [VM-OK]
description: The usage collectors behind the agents panel produce valid records even with no account signed in, and the updater reports a failing collector instead of hiding it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy agent usage update; echo status=$?` — it may exit non-zero because a collector whose CLI is absent (codex) fails; the failure is printed, not hidden.
  * Type `ls ~/.local/state/omarchy/agents/usage/` — `claude.json` and `fireworks.json` are listed.
  * Type `jq -r '.id + " / " + .usageStatusText' ~/.local/state/omarchy/agents/usage/claude.json` — `claude / Waiting for auth`.
  * Type `jq -c '{id,ready,hasPromptStats}' ~/.local/state/omarchy/agents/usage/fireworks.json` — `{"id":"fireworks","ready":false,"hasPromptStats":false}`.
  * Type `omarchy agent usage update --except codex; echo status=$?` — `status=0`.
  * Type `omarchy agent usage update claude; echo status=$?` — `status=0` (only the named collector runs).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `codex.json` exists, `jq -c '{id,limits}'` on it reads `{"id":"codex","limits":[]}`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `claude / Waiting for auth`; the fireworks record; `status=0` for `--except codex` and for `claude` alone
  * If unsuccessful
  ** A `jq` parse error (invalid record) or a missing file
covers: test/shell.d/agent-usage-update-test.sh, agent-usage-claude-scanner-test.sh (id/Waiting for auth), agent-usage-claude-limits-test.sh (no-token status), agent-usage-fireworks-scanner-test.sh (no-credential record), agent-usage-codex-scanner-test.sh (id/limits); bin/omarchy-agent-usage-*

### crash-capture-toggle   [VM-OK]
description: Trigger → Toggle → Crash Capture switches crash notifications off and on immediately (service stopped/started, toast each way) and the choice survives logout via the unit's condition.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `systemctl --user is-active omarchy-crash-watch.service` — `active`.
  * Press Super+Space → Trigger → Toggle → Crash Capture — a toast "Crash capture disabled" appears.
  * Type `ls ~/.local/state/omarchy/toggles/crash-capture-off && systemctl --user is-active omarchy-crash-watch.service` — the file is listed and the service is `inactive`.
  * Type `systemctl --user cat omarchy-crash-watch.service | grep ConditionPathExists` — `ConditionPathExists=!%h/.local/state/omarchy/toggles/crash-capture-off`.
  * Toggle Crash Capture again from the menu — toast "Crash capture enabled".
  * Type `ls ~/.local/state/omarchy/toggles/crash-capture-off; systemctl --user is-active omarchy-crash-watch.service` — file gone, `active`: back to the stock state.
  ** The toggle row carries no ✓ mark by design; the toast is the feedback.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy toggle crash-capture` typed in the terminal is the same action if the menu is hard to hit.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both toasts; the flag and `inactive`; the condition line; flag gone and `active`
  * If unsuccessful
  ** A missing toast or a service state that did not change
covers: test/shell.d/crash-capture-test.sh (toggle, unit condition, enabled by default); bin/omarchy-toggle-crash-capture; default/systemd/user/omarchy-crash-watch.service; default/omarchy/omarchy-menu.jsonc trigger.toggle.crash-capture; manual/13-toggles-idle-screensaver.md

### crash-mute-silences-one-program   [VM-OK]
description: A real crash produces a "Process crashed" toast naming the program; `omarchy crash mute <name>` silences only that program while others still announce and the watcher keeps running; `off` brings it back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `sleep 60 & sleep 0.5; kill -SEGV $!` — within 5 seconds a toast `Process crashed: sleep` appears; screenshot.
  * Type `omarchy crash mute sleep` — `Muted crash notifications for sleep.`; `omarchy crash mute` lists `sleep`.
  * Repeat the crash command — no toast within 5 seconds; screenshot.
  * Type `cp /usr/bin/sleep /tmp/othersleep; /tmp/othersleep 60 & sleep 0.5; kill -SEGV $!` — a toast `Process crashed: othersleep` appears (other programs still announce; the watcher survived the muted crash).
  * Type `omarchy crash mute sleep off` and crash `sleep` again — the `Process crashed: sleep` toast returns.
  * Type `systemctl --user is-active omarchy-crash-watch.service; omarchy crash mute; rm /tmp/othersleep` — `active` and `No programs muted. Crashes all notify.`
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If no toast ever appears, `coredumpctl list | tail -3` must list the crash; if it does not, report the environment.
  * The toast may offer a "diagnose" action; do not click it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Toast for `sleep`; silence while muted; toast for `othersleep`; toast for `sleep` again; `active` and "No programs muted"
  * If unsuccessful
  ** No toast at all with the `coredumpctl` listing, a toast while muted, or the service inactive
covers: test/shell.d/crash-capture-test.sh (watcher announces, per-program mute, other programs, un-mute, watcher survives); bin/omarchy-crash-watch; bin/omarchy-crash-mute

### crash-mute-rejects-bad-input   [VM-OK]
description: `omarchy crash mute` takes a program name only: paths reduce to their basename, `--` allows a name that looks like a flag, but `.`/`..`/`/`, unknown actions and names that climb out of its directory are refused, and a mute is never reported unless it was written.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy crash mute` — `No programs muted. Crashes all notify.`
  * Type `omarchy crash mute /usr/lib/chromium/chromium-browser; omarchy crash mute` — the list shows `chromium-browser`.
  * Type `omarchy crash mute hyprland sideways; echo s=$?` — `Not an action: sideways`, non-zero.
  * Type `omarchy crash mute . ; echo s=$?; omarchy crash mute .. ; echo s=$?; omarchy crash mute / ; echo s=$?` — three non-zero statuses.
  * Type `omarchy crash mute ../bar-off; ls ~/.local/state/omarchy/toggles/bar-off; echo exists=$?` — `ls` fails (nothing written outside `crash-ignore/`).
  * Type `omarchy crash mute -- -h && ls ~/.local/state/omarchy/toggles/crash-ignore/-h` — the `-h` flag file exists.
  * Type `omarchy crash mute chromium-browser toggle; omarchy crash mute -- -h off; omarchy crash mute` — back to `No programs muted. Crashes all notify.`
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the space in `mute . ;` so the shell does not read `.;` as one word.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Every message and status on screen as stated; `bar-off` never created; the list empty at the end
  * If unsuccessful
  ** A refusal with status 0, or `toggles/bar-off` existing
covers: test/shell.d/crash-capture-test.sh (omarchy-crash-mute CLI: list, basename, actions, refusals, `--`, toggle); bin/omarchy-crash-mute; bin/omarchy (crash group)

### dev-link-unlink-roundtrip   [VM-OK]
description: `omarchy dev link <checkout>` points the system and sudo's secure_path at a checkout, `dev unlink` fully undoes it, and bad paths or arguments are refused before anything is written.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cat /etc/omarchy.conf; ls /etc/sudoers.d/omarchy-dev-path` — `export OMARCHY_PATH="/usr/share/omarchy"` and no drop-in.
  * Type `cp -r /usr/share/omarchy /tmp/checkout; omarchy dev link /tmp/nope --no-reboot; echo s=$?; cat /etc/omarchy.conf` — `Error: path does not exist: /tmp/nope`, non-zero, conf unchanged.
  * Type `omarchy dev link /tmp/checkout --no-reboot` (password `prime`) — the line `sudo now resolves omarchy-* from /tmp/checkout/bin` and no reboot question.
  * Type `cat /etc/omarchy.conf; sudo cat /etc/sudoers.d/omarchy-dev-path; sudo stat -c '%U:%G %a' /etc/sudoers.d/omarchy-dev-path; sudo visudo -c | tail -1` — `OMARCHY_PATH="/tmp/checkout"`, `Defaults secure_path="/tmp/checkout/bin:/usr/local/sbin:/usr/local/bin:/usr/bin"`, `root:root 440`, parsed OK.
  * Press Super+Enter for a new terminal and type `echo $OMARCHY_PATH; echo ${PATH%%:*}` — `/tmp/checkout` and `/tmp/checkout/bin`.
  * Type `omarchy dev unlink --invalid; echo s=$?` — `Usage: omarchy dev unlink [--no-reboot]`, non-zero.
  * Type `omarchy dev unlink` — at `Reboot now to activate?` answer No.
  ** The gum prompt is Yes/No: Right arrow then Enter, or type `n`.
  * Type `cat /etc/omarchy.conf; ls /etc/sudoers.d/omarchy-dev-path; rm -rf /tmp/checkout` — the package path is back and the drop-in is gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The running desktop keeps its old path until a reboot; do not reboot for this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The `/tmp/nope` refusal; the "sudo now resolves" line; conf/sudoers/mode/visudo output; the new terminal's PATH; the usage error; the declined reboot; the restored conf without drop-in
  * If unsuccessful
  ** The terminal output at the failing step plus `sudo visudo -c`
covers: test/shell.d/dev-link-test.sh, dev-unlink-test.sh, dev-env-path-test.sh; bin/omarchy-dev-link; bin/omarchy-dev-unlink; default/bash/env-bootstrap

### channel-dev-refuses-occupied-checkout   [VM-OK]
description: `omarchy channel current` reports the installed channel with a ✓ in the menu, and switching to `dev` refuses before touching packages when `~/omarchy` exists but is not a git checkout; an unknown channel prints usage.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy channel current; pacman -Q omarchy omarchy-settings` — `stable` and the two versions.
  * Press Super+Space → Update → Channel — the "Stable" row has ✓; screenshot; Escape.
  * Type `mkdir -p ~/omarchy && touch ~/omarchy/not-a-checkout; omarchy channel set dev; echo s=$?` and answer Yes to `Switch to dev channel?`.
  ** The confirm defaults to No; press Left then Enter (or `y`) to accept.
  * Expect `…/omarchy already exists and is not a git checkout.` and non-zero — no pacman output before it.
  * Type `pacman -Q omarchy omarchy-settings; omarchy channel current; cat /etc/omarchy.conf` — versions identical, `stable`, `/usr/share/omarchy`.
  * Type `omarchy channel set bogus; echo s=$?` — `Usage: omarchy-channel-set [stable|rc|edge|dev]`, non-zero.
  * Type `rm -rf ~/omarchy` to restore.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the refusal is followed by any package download, that is the failure this test guards.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `stable` and the ✓; the refusal with unchanged versions and conf; the usage line
  * If unsuccessful
  ** Package operations after the refusal, or a changed `channel current`
covers: test/shell.d/channel-test.sh (current, dev refusal before package changes, usage); bin/omarchy-channel-set; bin/omarchy-channel-current; default/omarchy/omarchy-menu.jsonc update.channel.*; manual/30-updates.md

### pacman-direct-upgrade-guard   [VM-OK] [NET]
description: A direct `pacman -Syu` is stopped by Omarchy's alpm hook with the "Woah partner..." message so updates go through `omarchy update`, while the documented bypass variable and plain installs go through; a one-package reinstall stands in for the upgrade.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `ls /usr/share/libalpm/hooks/ | grep omarchy` — the three `*-omarchy-*.hook` files.
  * Type `sudo env OMARCHY_PACMAN_CMDLINE='pacman -Syu' pacman -S --noconfirm bash 2>&1 | tail -20; echo status=${PIPESTATUS[0]}` (password `prime`).
  * Expect the transaction aborted by the pre-transaction hook: `Woah partner...`, `omarchy update`, `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`; `status` non-zero; screenshot.
  * Type `sudo env OMARCHY_PACMAN_CMDLINE='pacman -Syu' OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -S --noconfirm bash 2>&1 | tail -5; echo status=${PIPESTATUS[0]}` — the reinstall completes, `status=0`, no warning.
  * Type `sudo pacman -S --noconfirm bash 2>&1 | tail -3` — a plain reinstall (no `-u`) is not blocked either.
  * Type `pacman -Q bash` — the same version as before; nothing else changed.
  ** Download is one small package (~2 MB); a mirror error before the hook is an environment problem, not a failure.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hook reads the faked command line from the environment — the same code path a real `pacman -Syu` takes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The "Woah partner..." block with a non-zero status; the bypass run completing; the plain reinstall unblocked
  * If unsuccessful
  ** The reinstall going through without the message, or the bypass still blocked
covers: test/shell.d/config-test.sh (alpm hooks installed); default/libalpm/hooks/00-omarchy-update-guard.hook; bin/omarchy-update-pacman-guard; docs/update-process.md; manual/30-updates.md

### bar-cli-layout-commands   [VM-OK]
description: `omarchy bar` edits the live bar — put a widget beside another, move one between sections, change position and transparency — each visible at once and persisted, and `omarchy bar defaults` restores the stock layout without widgets for services that are not running.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy bar put omarchy.keyboard-layout --after omarchy.clock` — `omarchy.keyboard-layout is on the bar` and a layout pill (`EN`) appears beside the clock; screenshot.
  * Type `omarchy bar move omarchy.active-window right` — the window-title widget moves to the right section; screenshot.
  * Type `omarchy bar position bottom; jq .bar.position ~/.config/omarchy/shell.json` — the bar is at the bottom edge, `"bottom"`.
  * Type `omarchy bar transparent toggle; jq .bar.transparent ~/.config/omarchy/shell.json` — the bar background is see-through, `true`; repeat — opaque, `false`.
  * Type `omarchy bar position top; omarchy bar defaults` — the stock bar returns: no layout pill, title back on the left, top edge.
  * Type `jq -c '.bar.layout.right | map(.id // .)' ~/.config/omarchy/shell.json; omarchy installed service tailscale; echo t=$?; omarchy installed service dropbox; echo d=$?` — `omarchy.tray` followed by `omarchy.agents`, no `omarchy.tailscale`/`omarchy.dropbox`, both `=1`.
  ** Each command changes the bar within a second; wait 2 s before the screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy bar` and `omarchy-bar` are the same program.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the pill beside the clock, the title on the right, the bar at the bottom, transparent then opaque, the restored default; the `jq`/status values
  * If unsuccessful
  ** A command's error, or a bar that did not change (screenshot + `jq`)
covers: test/shell.d/config-test.sh (move/position/transparent/defaults, optional service widgets), bar-test.sh (put through a ready shell), installed-service-test.sh, keyboard-layout-test.sh (label); bin/omarchy-bar; bin/omarchy-installed-service-*; config/omarchy/shell.json; manual/05-the-top-bar.md

### bar-cli-rejects-bad-input   [VM-OK]
description: `omarchy bar` refuses an unknown bar, conflicting move syntax and malformed JSON without touching shell.json.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cp ~/.config/omarchy/shell.json /tmp/shell.before`.
  * Type `omarchy bar use local.nonexistent-bar; echo s=$?` — non-zero with an error naming the unknown bar.
  * Type `omarchy bar move omarchy.active-window left --section right; echo s=$?` — non-zero (positional and `--section` together).
  * Type `omarchy bar set omarchy.bluetooth broken '{' --json; echo s=$?` — non-zero (malformed JSON).
  * Type `omarchy bar set omarchy.bluetooth broken 'false null' --json; echo s=$?` — non-zero (two values).
  * Type `cmp /tmp/shell.before ~/.config/omarchy/shell.json && echo unchanged; rm /tmp/shell.before` — `unchanged`; the bar looks as it did.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the single quotes around `'{'` and `'false null'` exactly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Four non-zero refusals and `unchanged`
  * If unsuccessful
  ** A refusal exiting 0 or a changed shell.json (`diff`)
covers: test/shell.d/config-test.sh (bar use/move/set rejections); bin/omarchy-bar

### bar-put-without-running-shell   [VM-OK]
description: `omarchy bar put` degrades gracefully when the shell is down: it writes the config, says why nothing was placed, exits 0, and the widget appears once the shell is back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `for i in 1 2 3 4 5 6; do kill -9 $(pgrep -x quickshell); sleep 1.5; done; sleep 3; pgrep -x quickshell || echo shell-gone` — `shell-gone`, bar absent.
  * Type `omarchy bar put omarchy.keyboard-layout --after omarchy.clock; echo status=$?` — `omarchy-shell is not running; omarchy.keyboard-layout was not put on the bar` and `status=0`.
  * Type `omarchy restart shell` — the bar returns and the keyboard-layout pill is beside the clock (the config was written); screenshot.
  * Type `omarchy bar put omarchy.keyboard-layout --after omarchy.clock` — `omarchy.keyboard-layout is on the bar` (already there; through the ready shell).
  * Type `omarchy bar defaults` — the pill is gone; the bar is stock again.
  ** The `kill` loop prints an error on rounds where the shell was already gone; that is fine.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Copy the "is not running" wording from the screenshot; the exact sentence is the contract.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `shell-gone`; the "omarchy-shell is not running; … was not put on the bar" line with status 0; the pill present after restart; the ready-shell confirmation; the restored bar
  * If unsuccessful
  ** `put` hanging or erroring without a shell, or no pill after restart
covers: test/shell.d/bar-test.sh (put with no shell running / through a ready shell), launch-shell-test.sh (give-up path); bin/omarchy-bar; bin/omarchy-restart-shell

### bar-hide-parks-offscreen   [VM-OK]
description: Hiding the bar frees its space for windows and hides it completely; showing it again is immediate because the surface stays mapped off-screen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) so one window fills the workspace; screenshot — the bar is at the top, the window starts below it.
  * Type `hyprctl -j monitors | jq '.[0].reserved'` — the top value is non-zero.
  * Press Super+Space → Trigger → Toggle → Menu Bar; screenshot — no bar on any edge and the terminal starts at the very top.
  * Type `hyprctl -j monitors | jq '.[0].reserved'` — the top value is `0`.
  * Type `hyprctl -j layers | jq '.[].levels."2"[] | select(.namespace|test("bar")) | {y,h}'` — a bar layer still exists, parked off-screen (negative `y`).
  * Toggle Menu Bar again from the menu — the bar is back within a second and the terminal shrinks below it: as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy toggle bar` in the terminal is the same action as the menu row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Before/after screenshots with the terminal's top edge moving; reserved top non-zero → 0 → non-zero; a parked layer while hidden
  * If unsuccessful
  ** A bar remnant on screen, space still reserved, or a slow/failed reappearance
covers: test/shell.d/bar-test.sh (hidden bar stays mapped, parks past its edge, reserves no space); shell/plugins/bar/Bar.qml; default/omarchy/omarchy-menu.jsonc trigger.toggle.top-bar; manual/05-the-top-bar.md

### bar-transparent-text-color-follows-wallpaper   [VM-OK]
description: With a transparent bar the text turns dark over a light wallpaper strip and stays light over a dark one, so the bar is readable on every theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy-theme-set tokyo-night; omarchy bar transparent true` — after 3 s the bar is see-through with light text; screenshot.
  * Type `omarchy-theme-set flexoki-light` — after 5 s the wallpaper is light and the bar text is dark; screenshot.
  * Type `omarchy-theme-set catppuccin-latte` — after 5 s still dark text on the light strip; screenshot.
  * Type `omarchy-theme-set tokyo-night` — light text again; screenshot.
  * Type `omarchy bar transparent false` — the bar is opaque again: back to stock.
  ** Theme application is asynchronous; if the bar has not recoloured after 5 s, wait 5 s once more.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Judge contrast on the clock digits in the top strip of the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Light text on dark; dark text on two light themes; light text on dark again; opaque bar at the end
  * If unsuccessful
  ** A screenshot where the bar text matches the brightness of the strip behind it
covers: test/shell.d/bar-text-color-test.sh, background-test.sh (async theme apply); bin/omarchy-bar-text-color; manual/05-the-top-bar.md, 06-themes.md

### clock-right-click-format-ring   [VM-OK]
description: Right-clicking the clock cycles its label through a fixed ring of presets in a stable order and saves the choice; left click opens the calendar and middle click the timezone picker.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `jq -r '.bar.layout.center[] | select((.id // .) == "omarchy.clock") | .format' ~/.config/omarchy/shell.json` — `dddd HH:mm`; the bar clock reads e.g. `Friday 13:12`.
  * Right-click the clock — the label becomes the 12-hour twin (`Friday 1:12 PM`); re-run the `jq` — `dddd h:mm AP`.
  * Right-click again — seconds appear and tick (two screenshots 2 s apart differ); `jq` — `dddd HH:mm:ss`.
  * Right-click seven more times, screenshotting each: `dddd h:mm:ss AP`, `HH:mm`, `h:mm AP`, `ddd d MMM HH:mm`, `ddd d MMM h:mm AP`, `d MMMM 'W'ww yyyy` (e.g. `18 September W38 2026`), `yyyy-MM-dd HH:mm`.
  * Right-click once more — back to `dddd HH:mm`: the ring wrapped and the clock is as it started.
  * Left-click the clock — the calendar panel opens under it; left-click again to close. Press Super+Ctrl+Alt+D twice — it toggles the same way.
  * Middle-click the clock — a timezone picker opens; press Escape.
  ** Wait a second after each right-click so the label has redrawn.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The month format shows the day without a leading zero (`8 September`, not `08`).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** All ten formats in order with matching `jq` values; ticking seconds; calendar by click and hotkey; the timezone menu
  * If unsuccessful
  ** A format out of order, a value not saved, or a frozen seconds label
covers: test/shell.d/clock-test.sh (format ring, seconds tick, persistence, click routing, SUPER+CTRL+ALT+D), config-test.sh (clock formatAlt); shell/plugins/panels/clock; manual/05-the-top-bar.md

### calendar-week-start-toggle   [VM-OK]
description: The calendar panel shows a Monday-first month grid with ISO week numbers and today marked, can switch its week start, steps freely into future months and returns to today.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the clock — the calendar opens: header starts with Monday, a week number on every row, exactly one day highlighted as today, a year progress bar above the grid; screenshot.
  * Open a terminal and type `omarchy-shell omarchy.clock toggleWeekStart; jq -r '.bar.layout.center[] | select((.id // .) == "omarchy.clock") | .weekStartDay' ~/.config/omarchy/shell.json` — the header now starts with Sunday, the grid shifted one column, `sunday`.
  * Run the same command again — Monday first, `monday`.
  * Hover the grid and scroll the mouse wheel down three times — the grid advances three months; a "back to today" affordance appears.
  * Click that affordance — the current month with today highlighted returns.
  * Press Escape (or click the clock) — the panel closes; the bar is unchanged.
  ** A horizontal wheel does nothing; only vertical scroll steps months.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The week-number column is the leftmost narrow column of the grid.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Monday→Sunday→Monday headers with matching `weekStartDay`; three months ahead; back to today; panel closed
  * If unsuccessful
  ** A header that does not shift, a clamp on future months, or the panel not opening
covers: test/shell.d/clock-test.sh (week start IPC/persistence, grid, month stepping, goToToday); shell/plugins/panels/clock/Panel.qml

### calendar-memento-mori-life-bar   [VM-OK]
description: The calendar's opt-in life bar stays hidden until a birth year is entered by double-clicking the year bar, rejects an impossible year, persists, and is cleared by double-clicking the life bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Left-click the clock — the calendar opens with a year progress bar and no `LIFE` bar; screenshot.
  * Double-click the year bar — two inputs appear centred over it; type `1979`, Tab, `90`, Enter.
  * A `LIFE` bar appears about half full; hover it — `Memento Mori`; screenshot.
  * Open a terminal and type `jq -c '.bar.layout.center[] | select((.id // .) == "omarchy.clock") | {birthYear,lifeExpectancy}' ~/.config/omarchy/shell.json` — `{"birthYear":1979,"lifeExpectancy":90}`.
  * Close and reopen the calendar — the `LIFE` bar is still there.
  * Double-click the year bar, type `2050`, Enter — a future year is rejected; the bar keeps its value.
  * Double-click the `LIFE` bar — it disappears; the `jq` shows `birthYear` 0: back to stock.
  ** If the inputs do not take focus, click into the birth-year field first.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Double-click means `mouse double-click` on the bar itself, not its label.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** No LIFE bar at first; LIFE bar with `Memento Mori` after 1979/90 and the JSON; persisted across reopen; 2050 rejected; cleared
  * If unsuccessful
  ** A LIFE bar shown before any birth year, values not persisted, or 2050 accepted
covers: test/shell.d/clock-test.sh (memento mori inputs, birth-year validation, persistence, clearLife); shell/plugins/panels/clock/Panel.qml

### keybindings-menu-shared-rows   [VM-OK]
description: The keybindings viewer merges deliberately duplicated chords onto one row in declaration order, shows the grave key as `~`, keeps every arrow in one column and no row wider than its card.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K — the keybindings list opens; screenshot.
  * Type `close` — a row `SUPER + W / SUPER + Q  → Close window` (W first).
  * Press Backspace to clear and type `scratch` — `SUPER + S / SUPER + ~  → Toggle scratchpad` and `SUPER + ALT + S / SUPER + SHIFT + ~  → Move window to scratchpad`; the word `grave` appears nowhere.
  * Press Escape. Open a terminal and type `omarchy-menu-keybindings --print | sudo tee /dev/ttyS0 >/dev/null` and read the serial output.
  * In that output: every `→` is at the same column, no line is longer than 78 characters, `→ Close window`, `→ Toggle scratchpad` and `→ Calculator` each appear once, `grave` never.
  * Type `omarchy-menu-keybindings --print | awk -F '→' '{print length($1)}' | sort -u; omarchy-menu-keybindings --print | awk '{print length($0)}' | sort -rn | head -1` — a single `36`, then a number ≤ 78.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The viewer's filter field is focused on open; typing filters immediately.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The merged rows in the viewer; the serial dump with one arrow column and single rows; `36` and ≤78
  * If unsuccessful
  ** Duplicate rows, a `grave` label, or misaligned arrows
covers: test/shell.d/keybindings-menu-test.sh, hyprland-default-config-test.sh (scratchpad grave aliases); bin/omarchy-menu-keybindings; manual/07-hotkeys.md

### hyprland-bindings-no-duplicate-chords   [VM-OK]
description: No two default bindings claim the same chord (only Alt+Tab / Alt+Shift+Tab are stacked on purpose), the essentials and preinstalled web-app chords are bound, and exactly nine SUPER+CTRL+<digit> chords open bar panels.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `hyprctl -j binds | jq -r '.[] | select(.submap=="") | [(.modmask|tostring), (if .keycode>0 then ("code:"+(.keycode|tostring)) else (.key|ascii_upcase) end), (.release|tostring)] | join("+")' | sort | uniq -d | sudo tee /dev/ttyS0` — the serial output holds at most the Alt+Tab stack (`8+TAB+false`, `9+TAB+false`).
  * Type `hyprctl -j binds | jq -r '.[] | select(.description=="Terminal" or .description=="ChatGPT") | .description+"="+.key'` — `Terminal=RETURN` and `ChatGPT=A`.
  * Type `hyprctl -j binds | jq -r '.[] | select(.description|startswith("Bar panel")) | .description' | sort -u | wc -l` — `9`.
  * Press Super+Ctrl+3 — the third centre bar panel opens; press it again — it closes.
  * Press Alt+Tab with two windows open — the other window is raised (the stacked pair works).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * modmask 64 = SUPER, 8 = ALT, 9 = ALT+SHIFT, 4 = CTRL; any `64+…` line in the duplicate list is a real conflict.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with only the Alt+Tab pair; `Terminal=RETURN`, `ChatGPT=A`; `9`; a panel toggling on Super+Ctrl+3
  * If unsuccessful
  ** The duplicated chord lines with their descriptions
covers: test/shell.d/hyprland-binding-conflicts-test.sh, hyprland-default-config-test.sh (essentials, ChatGPT, nine panel hotkeys); default/hypr/bindings/*.lua

### scratchpad-console-geometry   [VM-OK]
description: The scratchpad is a drop-down console: one window is a centred half-height 2:1 panel, a second app widens it to the full width, closing back recenters; both the Super+S and Super+` chords toggle it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and press Super+Alt+S — it moves to the scratchpad.
  * Press Super+` (grave, left of `1`) — the terminal shows as a panel flush with the top, about half the work-area height and twice as wide as tall, with empty margins left and right; screenshot.
  * Type `hyprctl -j activeworkspace | jq .name` — `special:scratchpad`.
  * Press Super+` to hide, Super+S to show (same panel), Super+S to hide.
  * Open a second terminal and press Super+Shift+` — it moves to the scratchpad; press Super+` — two tiled windows span the full width (no side margins), still half height; screenshot.
  * Type `exit` in one — the remaining window recenters to the 2:1 panel; screenshot.
  * Type `exit` in the last one — the scratchpad is empty; press Super+` to hide it: the desktop is as it started.
  ** The scratchpad seeds `omarchy-agent` on first creation; with no default agent that seed exits silently, so it starts empty — expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On the 1920×1080 guest expect roughly a 1080×520 panel: side gaps ≈ 420 px, bottom gap ≈ 520 px.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The centred half-height panel; full width with two windows; recentred panel; `special:scratchpad`
  * If unsuccessful
  ** A full-width single window, a panel not flush with the top, or a chord that did nothing
covers: test/shell.d/hyprland-qconsole-test.sh, hyprland-default-config-test.sh (grave aliases); default/hypr/qconsole.lua; default/hypr/bindings/tiling.lua; manual/04-navigation.md

### workspace-layout-toggle-persists   [VM-OK]
description: Super+L toggles the active workspace between dwindle and scrolling, announces it, applies at once, and remembers it across a Hyprland reload.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+3 and open two terminals (Super+Enter twice); screenshot — dwindle tiling.
  * Press Super+L — toast `Workspace layout set to scrolling`; the windows re-tile as a scrolling row; screenshot.
  * Type `cat ~/.local/state/omarchy/workspace-layouts/3.lua` — `hl.workspace_rule({ workspace = "3", layout = "scrolling" })`.
  * Type `hyprctl reload` and open a third terminal — the workspace is still scrolling.
  * Press Super+L — toast `Workspace layout set to dwindle`; the file now says `layout = "dwindle"`; tiling is dwindle again.
  * Type `ls ~/.local/state/omarchy/workspace-layouts/` — no `null.lua`; close the terminals.
  ** Super+L is the layout toggle; lock is Super+Ctrl+L.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Trigger → Toggle → Workspace Layout in the menu runs the same command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both toasts; the rule file each way; scrolling preserved after reload; no `null.lua`
  * If unsuccessful
  ** No toast/no re-tiling, or the layout reverting after reload
covers: test/shell.d/hyprland-workspace-layout-test.sh; bin/omarchy-hyprland-workspace-layout-toggle; default/hypr/workspace-layouts.lua; manual/04-navigation.md

### tiled-fullscreen-toggle   [VM-OK]
description: Super+Ctrl+F makes the app believe it is fullscreen while it stays in its tile, and toggles back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+2 and open two terminals side by side.
  * With the right terminal focused press Super+Ctrl+F; screenshot — the window keeps its tile size (does not cover the screen).
  * In that terminal type `hyprctl -j activewindow | jq .fullscreenClient` — `2`.
  * Press Super+Ctrl+F again and repeat the command — `0`; the tiling is unchanged.
  * Close both terminals (Super+W twice) — workspace 2 is empty as before.
  ** Some terminals hide their padding in client-fullscreen; the tile boundary is what must not change.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare the two tiles' widths in the screenshots before and after.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Tile unchanged with `fullscreenClient` 2 then 0
  * If unsuccessful
  ** A window covering the whole screen on Super+Ctrl+F
covers: test/shell.d/hyprland-window-test.sh; bin/omarchy-hyprland-window-tiled-fullscreen-toggle; default/hypr/bindings/tiling.lua; manual/07-hotkeys.md

### close-all-windows   [VM-OK]
description: Ctrl+Alt+Delete closes every window on every workspace and lands on workspace 1.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+2 and open a terminal; press Super+4 and open another; press Super+5 and open Chromium (Super+Shift+Enter).
  * Screenshot each workspace's bar indicator showing three occupied workspaces.
  * Press Ctrl+Alt+Delete and wait 3 seconds.
  * Every window is gone and the bar shows workspace 1 active; screenshot.
  * Open a terminal and type `hyprctl -j clients | jq length` — `1` (only this terminal); close it.
  ** Chromium may offer to restore pages next time; that is fine.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send Ctrl+Alt+Delete as one chord; the guest, not the host, receives it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three occupied workspaces, then none, workspace 1 active, `1` client
  * If unsuccessful
  ** Windows surviving (`hyprctl clients` list) or a workspace other than 1 active
covers: test/shell.d/hyprland-window-close-all-test.sh; bin/omarchy-hyprland-window-close-all; default/hypr/bindings/tiling.lua; manual/07-hotkeys.md

### stay-awake-toggle-indicator   [VM-OK]
description: Trigger → Toggle → Stay Awake shows a bar indicator and persists a state that survives a shell restart; toggling off removes both.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy toggle idle status` — `{"enabled":false,"class":"disabled","tooltip":"Stay Awake"}`.
  * Press Super+Space → Trigger → Toggle → Stay Awake — an indicator appears in the bar's indicator area; hover it for its tooltip; screenshot.
  * Type `ls ~/.local/state/omarchy/indicators/stay-awake; omarchy toggle idle status` — the file exists and `"enabled":true`.
  * Type `omarchy restart shell` — after the bar returns the indicator is still shown.
  * Toggle Stay Awake again from the menu — the indicator disappears and the file is gone.
  * Type `omarchy toggle idle status` — `"enabled":false`: stock state.
  ** The indicator area is the small cluster of glyphs next to the centre widgets.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy toggle idle stay-awake` / `allow-idle` are the CLI equivalents if the menu is hard to hit.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Indicator visible with the file; still visible after restart; gone after toggling off; the status JSON both ways
  * If unsuccessful
  ** No indicator, a stale indicator, or the shell hanging on toggle
covers: test/shell.d/idle-test.sh; bin/omarchy-toggle-idle; default/omarchy/omarchy-menu.jsonc trigger.toggle.idle-lock; manual/13-toggles-idle-screensaver.md

### hook-state-done-name-guards   [VM-OK]
description: `omarchy hook`, `hook install`, `state` and `done` take names, not paths: dotted names work, but `.`/`..`/slashes exit 2 and create nothing outside their directories; `state set reboot-required` is what shows the reboot indicator.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `mkdir -p ~/.config/omarchy/hooks; printf 'touch $HOME/hook-ran\n' > ~/.config/omarchy/hooks/test-hook; omarchy hook test-hook; ls ~/hook-ran` — the file exists.
  * Type `omarchy hook ../../evil; echo s=$?; omarchy hook sub/dir; echo s=$?; omarchy hook ..; echo s=$?` — `s=2` three times.
  * Type `omarchy hook install ../../evil /etc/hostname; echo s=$?; ls ~/.config/evil.d 2>&1; omarchy hook install post-update /etc/hostname; ls ~/.config/omarchy/hooks/post-update.d/hostname` — `s=2`, no `evil.d`, the good hook installed.
  * Type `omarchy state set ../../escape; echo s=$?; ls ~/.local/escape 2>&1; omarchy state set sub/dir; echo s=$?` — `s=2`, nothing created, `s=2`.
  * Type `omarchy state set reboot-required` — a reboot-required indicator appears in the bar; screenshot; type `omarchy state clear reboot-required` — it disappears.
  * Type `omarchy done check example; echo s=$?; omarchy done mark example; omarchy done check example; echo s=$?; omarchy done ensure once; echo s=$?; omarchy done ensure once; echo s=$?; omarchy done check ../invalid; echo s=$?` — non-zero, `0`, `0`, non-zero, non-zero.
  * Type `rm -f ~/hook-ran ~/.config/omarchy/hooks/test-hook ~/.config/omarchy/hooks/post-update.d/hostname ~/.local/state/omarchy/done/example ~/.local/state/omarchy/done/once` to restore.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Exit code 2 is the specific "bad name" status; a 1 would mean something else went wrong.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `hook-ran`; every `s=2`; nothing outside the directories; the reboot indicator on and off; the `done` status sequence
  * If unsuccessful
  ** A refusal with the wrong status, or `~/.config/evil.d` / `~/.local/escape` existing
covers: test/shell.d/hook-state-name-guard-test.sh, done-test.sh; bin/omarchy-hook; bin/omarchy-hook-install; bin/omarchy-state; bin/omarchy-done; manual/31-dotfiles.md

### git-url-check-refuses-transport-helpers   [VM-OK]
description: The theme and plugin installers refuse URLs that would make git run a program (`ext::`, unknown `scheme://`, option-shaped) with a clear message and accept every normal clone URL.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install → Style → Theme — a floating terminal asks for a repository URL.
  * Type `ext::sh -c id` and Enter — `'ext::sh -c id' names a git option or transport helper, not a repository.`; the installer stops; screenshot quickly.
  ** The floating terminal closes right after the message; run `omarchy-theme-install` in a normal terminal instead if you need time to read it.
  * Repeat via the menu with `zzz://a` — `'zzz://a' names the 'zzz' transport, which Omarchy does not clone from.`
  * Open a terminal and type `for u in 'fd::0,1' 'HTTPS://github.com/a/b' '--upload-pack=touch /tmp/pwned' ''; do omarchy-git-url-check "$u"; echo "s=$?"; done; ls /tmp/pwned` — four non-zero statuses and `ls` fails.
  * Type `for u in https://github.com/acme/omarchy-weather.git ssh://git@github.com/acme/repo.git git@github.com:acme/repo.git 'ssh://git@[2001:db8::1]:22/org/repo.git' file:///home/prime/repo ./repo; do omarchy-git-url-check "$u"; echo "s=$?"; done` — `s=0` six times.
  * Press Super+Space → Setup → Plugins → Add Plugin, type `ext::sh -c id`, Enter — the same helper refusal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nothing is cloned in this test, so it needs no network.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both refusal messages verbatim from the installers; non-zero for every hostile form and no `/tmp/pwned`; `s=0` for the legitimate forms
  * If unsuccessful
  ** A hostile URL accepted (clone output) or a legitimate URL refused
covers: test/shell.d/git-url-check-test.sh; bin/omarchy-git-url-check; bin/omarchy-theme-install; bin/omarchy-plugin-add; manual/43-making-your-own-theme.md, 32-shell-plugins.md

### browser-policy-color-follows-theme   [VM-OK]
description: Chromium's theme colour lives in a root-owned 0755 policy directory; a theme switch rewrites `color.json` without a password through a scoped sudo rule, and files planted there by a user are dropped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `stat -c '%U:%G %a %n' /etc/chromium /etc/chromium/policies /etc/chromium/policies/managed /etc/chromium/policies/managed/color.json; cat /etc/chromium/policies/managed/color.json` — dirs `root:root 755`, file `root:root 644`, `"BrowserThemeColor": "#xxxxxx"` (six lowercase hex).
  * Type `omarchy-theme-set flexoki-light; sleep 3; cat /etc/chromium/policies/managed/color.json` — a different (light) colour and no password prompt.
  * Type `omarchy-theme-set tokyo-night; sleep 3; cat /etc/chromium/policies/managed/color.json` — a dark colour, again no prompt.
  * Type `sudo -n -l -l 2>/dev/null | grep -A2 omarchy-theme-set-browser-policy` — the `NOPASSWD` rule for `/usr/bin/omarchy-theme-set-browser-policy` with six `[0-9a-f]` classes.
  * Type `sudo touch /etc/chromium/policies/managed/evil.json && sudo chown prime /etc/chromium/policies/managed/evil.json && omarchy-theme-set-browser; ls -l /etc/chromium/policies/managed/` — `evil.json` is gone, `color.json` still root 644.
  * Press Super+Shift+Enter — Chromium's frame colour matches the current theme; screenshot; close it.
  ** Only the `sudo touch` asks for `prime`; the theme switches must not.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Firefox/Zen are absent on the stock disk, so their `distribution/policies.json` half is skipped here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The stat/cat output; two theme switches changing the colour with no prompt; the sudoers listing; `evil.json` dropped; a themed Chromium
  * If unsuccessful
  ** A password/polkit prompt during theme switch, a non-root or non-755 directory, or `evil.json` surviving
covers: test/shell.d/browser-policy-dir-test.sh, browser-policy-sudoers-test.sh (grant/elevation), default-apps-test.sh (Chromium installer policy dirs); install/helpers/browser-policy.sh; bin/omarchy-theme-set-browser; etc/sudoers.d/omarchy-theme-browser; manual/23-browsers.md

### browser-policy-helper-rejects-bad-input   [VM-OK]
description: The privileged colour writer accepts exactly one argument of six lowercase hex digits and refuses everything else before elevating, so the passwordless grant can carry nothing but a colour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cp /etc/chromium/policies/managed/color.json /tmp/color.before`.
  * Type `for v in 1C2027 abc12 abc1234 1c202g ../../etc/passwd '1c2027 1c2027' '$(id)' '1c2027;id' '#1c2027'; do omarchy-theme-set-browser-policy "$v"; echo "s=$?"; done` — nine non-zero statuses, no sudo/polkit prompt.
  * Type `omarchy-theme-set-browser-policy; echo s=$?; omarchy-theme-set-browser-policy 1c2027 ffffff; echo s=$?` — both non-zero (no argument; two arguments).
  * Type `cmp /tmp/color.before /etc/chromium/policies/managed/color.json && echo unchanged` — `unchanged`.
  * Type `omarchy-theme-set-browser-policy 1c2027; echo s=$?; cat /etc/chromium/policies/managed/color.json` — `s=0`, no prompt, `"BrowserThemeColor": "#1c2027"`.
  * Type `omarchy-theme-set-browser; rm /tmp/color.before` — the theme's own colour is back.
  ** Keep the single quotes around the values containing `$`, `;`, `#` or a space.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A polkit dialog appearing at any point means the grant was not taken; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Eleven non-zero refusals and `unchanged`; the valid colour written passwordlessly; the theme colour restored
  * If unsuccessful
  ** A refusal exiting 0 or modifying `color.json`, or a prompt for the valid colour
covers: test/shell.d/browser-policy-sudoers-test.sh (argument validation, PACKAGED_PATH elevation); bin/omarchy-theme-set-browser-policy; etc/sudoers.d/omarchy-theme-browser

### dns-menu-passwordless   [VM-OK]
description: Setup → Network → DNS switches between DHCP, Cloudflare and Google without a password and marks the active one with ✓, while the uncovered Custom entry goes through a polkit prompt.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy dns` — the current provider (expect `DHCP`).
  * Press Super+Space → Setup → Network → DNS — the current row has ✓; click "Cloudflare" — no password or polkit dialog.
  * Type `omarchy dns; resolvectl status | grep -A2 'DNS Servers' | head -4` — `Cloudflare` and `1.1.1.1`; reopen the submenu — ✓ on Cloudflare.
  * Click "Google" — `omarchy dns` → `Google`, `8.8.8.8` listed, no prompt.
  * Click "DHCP" — `omarchy dns` → `DHCP`: back to the start.
  * Type `omarchy-dns Custom` — a polkit dialog appears (no sudo rule covers Custom); click Cancel; `omarchy dns` still `DHCP`.
  ** `resolvectl` may take a second to reflect the switch.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo -n -l -l | grep omarchy-dns` shows the rule limited to `Cloudflare`, `Google`, `DHCP` if you need to explain a result.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** ✓ moving; `omarchy dns` and `resolvectl` agreeing; no prompt for the three stock providers; the polkit dialog for Custom and an unchanged provider after cancel
  * If unsuccessful
  ** A prompt on a stock provider, or Custom running without one
covers: test/shell.d/dns-sudoers-test.sh; bin/omarchy-dns; etc/sudoers.d/omarchy-dns; default/omarchy/omarchy-menu.jsonc setup.network.dns.*; manual/35-networking.md

### drive-password-rejects-then-changes   [VM-OK]
description: The Drive Encryption tool refuses an empty passphrase and a mismatched confirmation without touching LUKS, then changes the key with a validated passphrase; the passphrase is changed back at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Update → Password → Drive Encryption — a floating terminal shows `New encryption password`.
  * Press Enter on the empty prompt — `Password cannot be empty.`; the terminal closes; screenshot quickly.
  * Reopen it, type `prime2` Enter, then `nomatch` Enter at `Confirm new encryption password` — `Passwords do not match.`
  * Open a normal terminal and type `omarchy-drive-password`; enter `prime2`, confirm `prime2`, then the current passphrase `prime` when `cryptsetup` asks — no error; screenshot.
  * Type `omarchy-drive-password` again: new `prime`, confirm `prime`, current `prime2` — no error: the passphrase is back to `prime`.
  * Type `sudo cryptsetup luksDump $(sudo blkid -t TYPE=crypto_LUKS -o device | head -1) | grep -m1 -i version` — the device is still a valid LUKS container.
  ** The gum prompts hide typed characters; the `cryptsetup` prompt for the existing passphrase comes after the confirmation.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * End this session with `stop` so a mistyped passphrase can never strand a saved disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Password cannot be empty.`; `Passwords do not match.`; a successful change and change-back; a valid LUKS dump
  * If unsuccessful
  ** `cryptsetup` running after a refused input, or a `luksChangeKey` error
covers: test/shell.d/drive-password-test.sh; bin/omarchy-drive-password; default/omarchy/omarchy-menu.jsonc update.password.drive; manual/48-security.md

### default-apps-installed-selected-immediately   [VM-OK]
description: Choosing a default terminal, browser or editor that is already installed applies at once (menu ✓, xdg-terminals.list, `omarchy default …`) with no installer and no toast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy default terminal; tail -1 ~/.config/xdg-terminals.list; pacman -Q alacritty foot ghostty kitty 2>/dev/null` — note the current terminal and which others are installed.
  * Press Super+Space → Setup → Defaults → Terminal — the current one has ✓; click a *different installed* terminal — no floating terminal, no toast; reopen the submenu — ✓ moved.
  ** If only one terminal is installed, say so and skip to the browser step.
  * Type `tail -1 ~/.config/xdg-terminals.list` — the new terminal's desktop id (`Alacritty.desktop`, `foot.desktop`, `com.mitchellh.ghostty.desktop` or `kitty.desktop`); press Super+Enter — the new terminal opens; close it.
  * Re-select the original terminal the same way and confirm `tail -1` shows it again.
  * Press Super+Space → Setup → Defaults → Browser → Chromium (already default) — ✓ stays, nothing opens.
  * Type `omarchy default editor nvim; omarchy default editor` — immediate, `nvim`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use the mouse for the menu selections.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** ✓ moving with no installer window; matching `xdg-terminals.list`; Super+Enter opening the new terminal; original restored
  * If unsuccessful
  ** An installer terminal or toast for an installed app, or the default not changing
covers: test/shell.d/default-apps-test.sh (installed defaults selected immediately, xdg-terminals.list); bin/omarchy-default-terminal; bin/omarchy-default-browser; bin/omarchy-default-editor; manual/15-terminal.md, 23-browsers.md

### default-editor-install-vim-then-cancel   [VM-PARTIAL] [NET]
description: Choosing a missing editor opens a visible installer and changes the default only once the package lands; cancelling keeps the previous default. Vim is small enough to complete.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `pacman -Q vim 2>&1; omarchy default editor` — `was not found` and `nvim`.
  * Press Super+Space → Setup → Defaults → Editor → Vim — a floating terminal runs the install (pacman output); press Ctrl+C within 3 s.
  * Type `omarchy default editor; pacman -Q vim 2>&1` — still `nvim`, still not found.
  * Type `omarchy default editor --install vim` and let it finish (~10 MB; `prime` if asked).
  * Type `omarchy default editor; pacman -Q vim` — `vim` and the package; reopen Setup → Defaults → Editor — ✓ on Vim.
  * Type `omarchy default editor nvim; sudo pacman -Rns --noconfirm vim` — back to stock.
  ** Skipped here: the large editors (VSCode, Zed, Cursor) — same code path, tens of MB.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating installer is centred; click into it before Ctrl+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Installer appearing; default unchanged after cancel; `vim` after a completed install with ✓; stock restored
  * If unsuccessful
  ** The default changing before the package, or no installer
covers: test/shell.d/default-apps-test.sh (missing editor → installer, failed install preserves default, editor becomes default); bin/omarchy-default-editor

### install-app-display-name-quoting   [VM-OK]
description: The menu's generic installers open an `org.omarchy.terminal` floating window and build their command safely: a quote or semicolon in the display name or package list never runs extra commands, and a failed install launches nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy-install-app "a'; echo PWNED; echo '" nosuchpackage-zz` — a floating terminal opens whose first line is `Installing a'; echo PWNED; echo '...`, then pacman fails on `nosuchpackage-zz`; `PWNED` never appears on a line of its own; screenshot before it closes.
  * Type `omarchy-install-and-launch "Example App" nosuchpackage-zz "Disk Usage"` — `Installing Example App...`, pacman fails, and no application window opens afterwards.
  * Type `omarchy-install-app "Example App" "alpha; echo PWNED"` — pacman is asked for `alpha;`, `echo`, `PWNED` as package names (fails); no shell prints `PWNED`.
  * Type `omarchy-install-font "Foo's Font" nosuchpackage-zz "Foo's Family"` — `Installing Foo's Font...`, pacman fails; type `grep -rl "Foo's Family" ~/.config/omarchy 2>/dev/null | wc -l` — `0` (family not set).
  * Type `omarchy-launch-floating-terminal-with-presentation 'echo hello; sleep 20'` then in your terminal `hyprctl -j clients | jq -r '.[] | select(.class=="org.omarchy.terminal") | .floating'` — `true`; the helper window closes on its own.
  ** `sudo` may ask for `prime` inside the floating terminal; pacman needs the network to say "target not found" — offline it fails earlier, which is still a failed install.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Floating installer windows close a moment after their command ends; screenshot as soon as the first line shows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Literal `Installing …` first lines; no standalone `PWNED`; no launched app; font unchanged; a floating `org.omarchy.terminal` window
  * If unsuccessful
  ** A `PWNED` line, a window launched after a failed install, or a changed font
covers: test/shell.d/desktop-entry-launch-test.sh, floating-terminal-test.sh; bin/omarchy-install-app; bin/omarchy-install-and-launch; bin/omarchy-install-font; bin/omarchy-launch-floating-terminal-with-presentation

### apps-menu-search-direct-matches   [VM-OK]
description: The Apps menu's search returns direct matches only (no loose subsequence hits) while acronym and plain-name matches still rank first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space — the Apps menu opens with an alphabetical list; screenshot.
  * Type `contact` — the rows are direct matches (e.g. Google Contacts); `Calculator` is not among them; screenshot.
  * Press Backspace until empty and type `gc` — Google Contacts is the first row.
  * Clear and type `obs` — OBS Studio is the first row.
  * Clear and type `zzqq` — no rows, no crash.
  * Press Escape — the desktop is unchanged.
  ** Clear the filter with repeated Backspace; Escape closes the whole menu.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The list re-sorts alphabetically when the filter is empty; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `contact` without Calculator; Google Contacts first for `gc`; OBS Studio first for `obs`; empty for `zzqq`
  * If unsuccessful
  ** Calculator matching `contact`, or a crash on an empty result
covers: test/shell.d/app-search-test.sh (search ranking, alphabetical order); shell/services/AppSearch.js; shell/plugins/menu/Menu.qml; manual/04-navigation.md

### apps-menu-delete-entry   [VM-OK]
description: Delete in the Apps menu removes an entry: web apps and TUIs go through their removers, a plain user desktop file is deleted silently, and a refresh brings the stock entries back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `printf '[Desktop Entry]\nType=Application\nName=Zz Test Entry\nExec=true\n' > ~/.local/share/applications/zz-test.desktop`.
  * Press Super+Alt+Space, type `zz test`, press Delete, confirm — the menu closes; type `ls ~/.local/share/applications/zz-test.desktop` — gone, and no toast appeared.
  * Press Super+Alt+Space, type `basecamp`, press Delete, confirm — type `ls ~/.local/share/applications/ | grep -ci basecamp` — `0`; the Apps menu no longer lists Basecamp.
  * Press Super+Alt+Space, type `docker`, press Delete, confirm — the Docker TUI entry is gone the same way.
  * Type `omarchy-refresh-applications` — reopen the Apps menu: Basecamp and Docker are back.
  ** The confirmation is a small yes/no inside the menu; Enter confirms.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not delete a package-owned entry (e.g. Nautilus): that opens an `Uninstalling …; sudo pacman -Rns …` terminal instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three deletions with the files gone, no toast for the plain file, and the stock entries restored
  * If unsuccessful
  ** A Delete that did nothing, or a leftover desktop file
covers: test/shell.d/launcher-remove-test.sh, app-search-test.sh (delete routes through the app library); bin/omarchy-remove-launcher-entry; shell/plugins/menu/Menu.qml; manual/25-web-apps.md, 21-tuis.md

### remove-preinstalls   [VM-OK]
description: Remove → Preinstalls deletes the optional agent lazy stubs and records the opt-out so the preinstalled web-app hotkeys disappear, while a user's own tools are kept and the Install/Remove rows flip.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `ls ~/.local/bin | grep -cE '^(agy|omp|ori|grok|crush|cursor-agent|muse)$'; printf '#!/bin/bash\necho user-muse\n' > ~/.local/bin/muse; chmod +x ~/.local/bin/muse` — `7`, then a user-managed `muse` in place.
  * Press Super+Shift+A — the ChatGPT web app opens; close it with Super+W.
  * Press Super+Space → Remove → Preinstalls; confirm in the floating terminal if asked and wait for it to finish.
  * Type `ls ~/.local/bin | grep -cE '^(agy|omp|ori|grok|crush|cursor-agent)$'; ~/.local/bin/muse; ls ~/.local/state/omarchy/preinstalls-removed` — `0`, `user-muse`, the marker.
  * Type `hyprctl reload` and press Super+Shift+A — nothing opens; press Super+Enter — a terminal still opens.
  * Press Super+Space → Remove — no Preinstalls row; → Install — "Preinstalls" is selectable (not dimmed); screenshot.
  * Type `rm ~/.local/bin/muse`.
  ** This also removes the preinstalled web apps and TUIs from the Apps menu; end the session with `stop` so the next test starts stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal may ask a gum yes/no; `y` confirms.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** 7 → 0 stubs with `muse` preserved; the marker; Super+Shift+A dead while Super+Enter works; menu rows flipped
  * If unsuccessful
  ** A stub surviving, `muse` overwritten, or ChatGPT still bound
covers: test/shell.d/default-agent-test.sh (Remove Preinstalls), hyprland-default-config-test.sh (preinstall flag skips bindings); bin/omarchy-remove-preinstalls; default/hypr/bindings/applications.lua; default/omarchy/omarchy-menu.jsonc install.preinstalls, remove.preinstalls; manual/01-welcome-to-omarchy.md

### hermes-cli-stub-ownership   [VM-OK]
description: Without Hermes Desktop the `hermes` command is an Omarchy-owned lazy stub that the installer and its migration recognise, repair, and can tear down, while a user's own `hermes` is never touched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `grep -Fx '# Written by omarchy-install-hermes-cli.' ~/.local/bin/hermes && echo owned-stub; omarchy-install-hermes-cli --owns; echo owns=$?; omarchy-install-hermes-cli --check; echo check=$?` — `owned-stub`, `owns=0`, `check` non-zero.
  * Type `chmod -x ~/.local/bin/hermes; bash /usr/share/omarchy/migrations/1787760281.sh; ls -l ~/.local/bin/hermes` — the migration made it executable again.
  * Type `omarchy-install-hermes-cli --remove; echo s=$?; ls ~/.local/bin/hermes 2>&1; omarchy-install-hermes-cli --remove; echo s=$?` — `s=0`, no file, `s=0` again (idempotent).
  * Type `printf '#!/bin/bash\nexec /usr/local/bin/my-own-hermes "$@"\n' > ~/.local/bin/hermes; chmod +x ~/.local/bin/hermes; omarchy-install-hermes-cli --owns; echo owns=$?; bash /usr/share/omarchy/migrations/1787760281.sh; omarchy-install-hermes-cli --remove; cat ~/.local/bin/hermes` — `owns` non-zero and the foreign wrapper is byte-for-byte as written.
  * Type `rm ~/.local/bin/hermes; touch ~/.local/state/omarchy/preinstalls-removed; bash /usr/share/omarchy/migrations/1787760281.sh; ls ~/.local/bin/hermes 2>&1; rm ~/.local/state/omarchy/preinstalls-removed` — no stub written for a user who removed the preinstalls.
  * Type `bash /usr/share/omarchy/migrations/1787760281.sh; grep -c 'exec env -u UV_PYTHON mise x' ~/.local/bin/hermes; omarchy-install-hermes-cli --owns; echo owns=$?` — `1` and `owns=0`: the stock stub is back.
  ** None of these commands should touch the network; a `mise` download means something went wrong.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--owns`, `--check`, `--remove` answer only with their exit status; always echo it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `owned-stub`/`owns=0`/non-zero check; executable bit repaired; two clean removals; foreign wrapper disowned and preserved; nothing written under the opt-out; stock stub recreated
  * If unsuccessful
  ** A foreign wrapper modified or removed, or `--owns` claiming it
covers: test/shell.d/hermes-cli-test.sh (owns/check/remove/template/foreign), hermes-cli-migration-test.sh (plain install, repair, opt-out, foreign left alone); bin/omarchy-install-hermes-cli; migrations/1787760281.sh; manual/17-ai.md

### hermes-theme-hook-without-hermes   [VM-OK]
description: The Hermes theme hook stays silent and writes nothing on a machine where Hermes never ran, publishes a skin only once Hermes has a config, and `--activate` explains why it cannot finish.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `ls ~/.hermes/skins 2>&1; omarchy-theme-set-hermes; echo s=$?; ls ~/.hermes/skins 2>&1` — the hook exits 0 silently and `skins` still does not exist.
  * Type `omarchy-theme-set-hermes --activate; echo s=$?` — stderr says Hermes is `not set up yet`; nothing written.
  * Type `mkdir -p ~/.hermes; printf 'display:\n  skin: default\n' > ~/.hermes/config.yaml; omarchy-theme-set-hermes; echo s=$?; ls ~/.hermes/skins/` — `s=0` and `omarchy.yaml` is published (Hermes itself is not run because it is not ready).
  * Type `omarchy-theme-set-hermes --activate 2>&1 | tail -2` — it prints the `hermes config set display.skin omarchy` command the user can run once Hermes is ready.
  * Type `rm -r ~/.hermes/skins ~/.hermes/config.yaml` — back to the stock state.
  ** `~/.hermes` itself may already exist (skills are linked there by a migration); only `skins` and `config.yaml` are this test's.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped in this VM: activation on a running Hermes (`config get/set display.skin`), which needs Hermes Desktop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Silent hook with no skins dir; `not set up yet`; `omarchy.yaml` published once a config exists; the printed `hermes config set` command; cleanup
  * If unsuccessful
  ** A skin written for a Hermes that never ran, or an error from the silent path
covers: test/shell.d/hermes-theme-test.sh (never-ran, publish, unready --activate); bin/omarchy-theme-set-hermes; manual/17-ai.md

### ascii-wordmark-and-refusals   [VM-OK]
description: `omarchy ascii` draws text in the Omarchy block font (nine rows, from an argument or stdin), names characters it cannot draw instead of dropping them silently, refuses unknown options and fails cleanly for undrawable text.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and press Super+F so 90 columns fit; type `omarchy ascii Omarchy` — a 9-row block-letter wordmark; screenshot.
  * Type `omarchy ascii Omarchy | wc -l; printf Omarchy | omarchy ascii | wc -l; printf 'A\n\nB\n' | omarchy ascii | wc -l` — `9`, `9`, `27`.
  * Type `omarchy ascii Hi | awk 'NR==1{print length($0)}'; omarchy ascii "H i" | awk 'NR==1{print length($0)}'; omarchy ascii Omarchy | grep -c ' $'` — `18`, `23`, `0`.
  * Type `omarchy ascii "Omarchy 4.0" >/dev/null; echo s=$?` — stderr `Skipped, no glyph in Delta Corps Priest 1: 4 . 0` and `s=0`.
  * Type `omarchy ascii 4.0; echo s=$?; omarchy ascii --width 40; echo s=$?` — nothing then `s=1`; `Unknown option: --width` then `s=1`.
  * Type `omarchy ascii --help | head -1` — `Usage: omarchy-ascii …`; press Super+F to un-fullscreen the terminal.
  ** The glyphs are block characters; a wrapped line would break the width counts, hence the fullscreen terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy ascii` and `omarchy-ascii` are the same program.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The wordmark; `9 9 27`; `18 23 0`; the Skipped message with `s=0`; `s=1` twice; the usage line
  * If unsuccessful
  ** Wrong counts, a silently dropped character, or an option drawn as art
covers: test/shell.d/ascii-test.sh; bin/omarchy-ascii; bin/omarchy (route `ascii`); manual/41-branding.md

### about-window-sheen   [VM-OK]
description: The About window plays a moving glint over the Omarchy logo without ever rewriting it, and leaves the logo still when a user fastfetch config could have moved it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → About — a floating window with the block-letter logo and system info opens.
  * Take four screenshots about 0.4 s apart — a lighter band moves across the logo between frames while the logo's shape and text stay identical; one more screenshot after 3 s shows it settled.
  * Close it with Super+W.
  * Open a terminal and type `mkdir -p ~/.config/fastfetch && cp /etc/fastfetch/config.jsonc ~/.config/fastfetch/config.jsonc`.
  * Open About again and take three screenshots 0.4 s apart — the logo is completely still; close it.
  * Type `rm -r ~/.config/fastfetch` and open About once more — it animates again; close it.
  ** The glint is subtle: compare the same logo row across frames. If the first attempt shows no band, reopen once — a resize during the first paint stops the sweep by design.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `./client-with-image` lets you take the rapid frames without a separate `get-image` round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Frames with the band at different positions and an unchanged logo; a still logo with the user config; animation again after removing it
  * If unsuccessful
  ** Logo characters changing between frames, a band outside the logo, or animation despite the user config
covers: test/shell.d/branding-about-animation-test.sh, launch-about-test.sh; bin/omarchy-launch-about; bin/omarchy-branding-about-animation; etc/fastfetch/config.jsonc; manual/41-branding.md

### clipboard-history-capture-rules   [VM-OK]
description: The clipboard history records text once (duplicates move to the front), decodes UTF-16 text, shows file URIs as files and screenshots as "Screenshot from …", and never records sensitive copies.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `printf 'first entry' | wl-copy; sleep 1; printf 'second entry' | wl-copy; sleep 1; printf 'first entry' | wl-copy; sleep 1`.
  * Press Super+Ctrl+V — `first entry` on top, then `second entry`, `first entry` only once; screenshot; Escape.
  * Type `printf 'UTF-16 clipboard - fixed' | iconv -f UTF-8 -t UTF-16LE | wl-copy; sleep 1` — Super+Ctrl+V shows `UTF-16 clipboard - fixed` decoded on top; Escape.
  * Type `printf 'super secret' | wl-copy --sensitive; sleep 1` — Super+Ctrl+V does NOT list `super secret`; Escape.
  * Type `printf 'file:///etc/hostname\n' | wl-copy --type text/uri-list; sleep 1` — Super+Ctrl+V shows a file row named `hostname`; Escape.
  * Press Super+Space → Trigger → Capture → Screenshot, drag a region with the mouse and choose copy — Super+Ctrl+V shows `Screenshot from <day> <time>` with a thumbnail; Escape.
  * Type `printf 'line one\nline two' | wl-copy; sleep 1` — Super+Ctrl+V shows it as one line `line one line two`; Escape.
  ** Wait a second after each copy; the watcher is asynchronous.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the URI copy is not shown as a file, open Nautilus (Super+Shift+F), select a file and press Ctrl+C instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Deduped order; decoded UTF-16; the sensitive text absent; the file row; the Screenshot row; the collapsed multi-line
  * If unsuccessful
  ** Duplicate rows, mojibake, a recorded sensitive entry, or a missing screenshot entry
covers: test/shell.d/clipboard-test.sh (capture.sh rules, display rows); shell/plugins/clipboard/capture.sh; manual/08-unified-clipboard-history.md

### clipboard-manager-paste-delete-open   [VM-OK]
description: In the clipboard manager Home/End jump, Enter pastes the entry into the focused app, Delete removes one, and a URL entry opens in the browser.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `for w in alpha bravo charlie; do printf "$w" | wl-copy; sleep 0.7; done; cat > /dev/null` — the terminal now accepts typed text.
  * Press Super+Ctrl+V, press End (last row `alpha`), press Enter — `alpha` is typed into the terminal; screenshot.
  * Press Super+Ctrl+V, press Home, then Down (`bravo`), press Delete — `bravo` leaves the list; screenshot; Escape.
  * Press Ctrl+D to end `cat`; type `printf 'https://example.com/docs' | wl-copy; sleep 1`.
  * Press Super+Ctrl+V, select that row and use its open action (Ctrl+O, or the open button on the row) — Chromium opens on example.com; close it with Super+W.
  * Press Super+Ctrl+V and Escape — the desktop is as before.
  ** The manager types into whatever had focus before it opened; the terminal must be focused first.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Ctrl+O is not the open key, the row's action hint is shown in the panel footer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `alpha` typed into the terminal; `bravo` removed; Chromium opened on example.com
  * If unsuccessful
  ** A paste that typed nothing, a Delete that kept the row, or the URL not opening
covers: test/shell.d/clipboard-test.sh (keyboard navigation, paste-text helper shift-insert, clipboard-open); shell/plugins/clipboard/Clipboard.qml; bin/omarchy-clipboard-paste-text; bin/omarchy-clipboard-open; manual/08-unified-clipboard-history.md

### clipboard-watchers-survive-shell-restart   [VM-OK]
description: Exactly two clipboard watchers run, they are reaped and restarted with the shell so none leak, and capture keeps working afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `pgrep -fa 'wl-paste .*--watch' | sed 's/^[0-9]* //'` — exactly two lines, one `--type text` and one `--type image/png`.
  * Type `omarchy restart shell` and wait for the bar to return.
  * Type `pgrep -fa 'wl-paste .*--watch' | wc -l` — still `2` (old watchers reaped, new ones started).
  * Type `printf 'after restart' | wl-copy; sleep 1` and press Super+Ctrl+V — `after restart` is on top; Escape.
  * Type `kill -9 $(pgrep -x quickshell); sleep 4; pgrep -fa 'wl-paste .*--watch' | wc -l` — `2` again after the supervisor relaunch (the watchers died with the shell via pdeathsig and were restarted).
  ** The bar vanishes for a moment during both restarts; that is expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A count of 3 or more means a leaked watcher; paste the `pgrep -fa` list.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two watchers before, after `restart shell`, and after a hard kill; `after restart` captured
  * If unsuccessful
  ** A watcher count ≠ 2 with the process list
covers: test/shell.d/clipboard-test.sh (setpriv pdeathsig watchers, reaper pattern, respawn); shell/plugins/clipboard/Clipboard.qml

### emoji-insert-transient   [VM-OK]
description: The emoji picker types the chosen emoji into the focused app through a transient clipboard that never appears in the clipboard history.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cat > /tmp/emoji.txt` — it now accepts typed text.
  * Press Super+Ctrl+E, type `joy` — the first result is 😂; press Enter — it is typed into the terminal.
  * Press Enter then Ctrl+D; type `cat /tmp/emoji.txt; rm /tmp/emoji.txt` — `😂`.
  * Type `printf marker | wl-copy; sleep 1` and press Super+Ctrl+V — `marker` is the top entry and 😂 is nowhere in the list; Escape.
  * Press Super+Ctrl+E, type `zzzzqq` — no results; Escape closes without inserting anything.
  * Press Super+Space → Trigger → Emoji — the same picker opens; Escape.
  ** The terminal must be the focused window when the picker opens.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hover the terminal (mouse move) before Super+Ctrl+E so focus is unambiguous.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** 😂 in the file; history without the emoji; empty search handled; menu path works
  * If unsuccessful
  ** Emoji not typed, or the emoji present in the history
covers: test/shell.d/emojis-test.sh; bin/omarchy-menu-emoji-insert; shell/plugins/emojis; manual/07-hotkeys.md

### env-defaults-browser-editor-locale   [VM-OK]
description: Every shell gets Omarchy's defaults — `BROWSER`/`EDITOR`/`SUDO_EDITOR` point at the launchers and a UTF-8 locale is always set — while the session leaves `BROWSER` unset so a browser's own "set as default" works.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `echo "$BROWSER|$EDITOR|$SUDO_EDITOR"` — `omarchy-launch-browser|omarchy-launch-editor --inline|omarchy-launch-editor --inline`.
  * Type `echo $LANG; env -u LANG bash -ic 'echo $LANG; printf "\U000F17A9\n"'` — UTF-8 locales and a rendered glyph, not the literal `\U000F17A9`.
  * Type `BROWSER=firefox bash -ic 'echo $BROWSER'; EDITOR=helix bash -ic 'echo $EDITOR'` — `firefox`, `helix` (inherited values kept).
  * Type `systemctl --user show-environment | grep -c '^BROWSER='` — `0`.
  * Type `xdg-settings set default-web-browser chromium.desktop; echo s=$?; xdg-settings get default-web-browser` — `s=0`, `chromium.desktop`.
  * Type `sudo -e /tmp/edit-test.txt` — nvim opens inline; type `:q!` Enter; type `rm -f /tmp/edit-test.txt`.
  ** `bash -ic` starts an interactive shell so Omarchy's env files are sourced.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The glyph is a folder icon from the Nerd Font; any visible symbol counts, a backslash sequence does not.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three env values; UTF-8 LANG and the glyph; inherited values kept; `0`; `xdg-settings set` succeeding; nvim via `sudo -e`
  * If unsuccessful
  ** A literal `\U000F17A9`, a session `BROWSER=`, or `xdg-settings set` refusing
covers: test/shell.d/browser-env-test.sh, editor-env-test.sh, locale-env-test.sh; default/bash/envs; default/uwsm/default; default/uwsm/env.d/10-omarchy; manual/15-terminal.md

### launch-browser-follows-url   [VM-OK]
description: Opening a link jumps to the browser window wherever it lives, a plain new browser window stays on the current workspace, and focus-by-title is allowed only for agent terminals.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+1 and open Chromium (Super+Shift+Enter); wait for it.
  * Press Super+3, open a terminal and type `omarchy launch browser https://example.com` — focus jumps to workspace 1 with example.com in Chromium; screenshot.
  * Press Super+3 and type `omarchy launch browser` — a new Chromium window opens on workspace 3 and the desktop stays there; close it with Super+W; type `omarchy launch browser --private` — same, private window; close it.
  * Type `omarchy-hyprland-focus-app '^chromium$'` — focus jumps to workspace 1; press Super+3.
  * Type `omarchy-hyprland-focus-app Mail; echo s=$?` — non-zero and focus stays on workspace 3.
  * Press Super+1, close Chromium (Super+W), press Super+3 and close the terminal.
  ** The workspace indicator in the bar shows which workspace is active.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * example.com may show a network error page offline; the window and the focus jump are what matter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Focus jump on the URL launch; no jump for plain/private launches; focus-app jump; non-zero and no jump for `Mail`
  * If unsuccessful
  ** Focus jumping on a plain launch, no jump on a URL, or `Mail` focusing Chromium
covers: test/shell.d/launch-browser-test.sh, hyprland-focus-app-test.sh; bin/omarchy-launch-browser; bin/omarchy-hyprland-focus-app; manual/23-browsers.md

### kitty-remote-control-repair   [VM-OK]
description: The kitty migration comments out insecure `allow_remote_control yes` lines while keeping every customisation, ordering and file permission, backs the file up, and is silent on rerun.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `mkdir -p ~/.config/kitty; cp ~/.config/kitty/kitty.conf /tmp/kitty.orig 2>/dev/null; printf '# my comment\ninclude my-theme.conf\nfont_size 13\nallow_remote_control yes\nallow_remote_control true\nallow_remote_control socket-only\nlisten_on unix:/tmp/my-kitty\n' > ~/.config/kitty/kitty.conf; chmod 600 ~/.config/kitty/kitty.conf`.
  * Type `bash /usr/share/omarchy/migrations/1788745941.sh; cat ~/.config/kitty/kitty.conf; stat -c %a ~/.config/kitty/kitty.conf; ls ~/.config/kitty/kitty.conf.bak.*` — the `yes` and `true` lines are `# allow_remote_control …`, `socket-only` untouched, all other lines unchanged in order, mode `600`, a backup present.
  * Type `cp ~/.config/kitty/kitty.conf /tmp/kitty.after; bash /usr/share/omarchy/migrations/1788745941.sh; cmp /tmp/kitty.after ~/.config/kitty/kitty.conf && echo same` — no output from the migration and `same`.
  * Type `printf 'allow_remote_control socket\nfont_size 13\n' > ~/.config/kitty/kitty.conf; bash /usr/share/omarchy/migrations/1788745941.sh; cat ~/.config/kitty/kitty.conf` — a restricted mode is preserved as-is.
  * Type `cp /tmp/kitty.orig ~/.config/kitty/kitty.conf 2>/dev/null || rm ~/.config/kitty/kitty.conf; rm -f ~/.config/kitty/kitty.conf.bak.* /tmp/kitty.*` — stock again.
  ** The message `Close and reopen all Kitty windows` appears only when the migration replaces a stock config; a custom config is repaired quietly.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * kitty need not be installed; the migration edits the file regardless.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The repaired config with only the insecure lines commented, mode 600, a backup; a silent identical rerun; `socket` preserved
  * If unsuccessful
  ** `socket-only`/`socket` commented, customisations lost or reordered, or a missing backup
covers: test/shell.d/kitty-config-test.sh (migration half); migrations/1788745941.sh; config/kitty/kitty.conf; manual/15-terminal.md

### kitty-font-size-controls   [VM-OK]
description: `omarchy display text-size` and `omarchy font set` edit kitty.conf with single overrides (never duplicated, never re-adding the theme include) and `reset` restores the 9 pt default.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cp ~/.config/kitty/kitty.conf /tmp/kitty.orig 2>/dev/null; rm -f ~/.config/kitty/kitty.conf; omarchy display text-size` — the output contains `terminal font: 9 pt` even with no config.
  * Type `omarchy display text-size 16; grep -x 'font_size 12.0' ~/.config/kitty/kitty.conf` — present; the desktop text visibly grows.
  * Type `omarchy display text-size 18; grep -c '^font_size ' ~/.config/kitty/kitty.conf` — `1` (updated, not duplicated).
  * Type `omarchy font set 'JetBrainsMono Nerd Font'; omarchy font set 'CaskaydiaMono Nerd Font'; grep -c '^font_family ' ~/.config/kitty/kitty.conf; grep -c '^include ' ~/.config/kitty/kitty.conf` — `1` and `0`.
  * Type `omarchy display text-size reset; grep -x 'font_size 9.0' ~/.config/kitty/kitty.conf` — present; the desktop text is back to normal.
  * Type `cp /tmp/kitty.orig ~/.config/kitty/kitty.conf 2>/dev/null || rm ~/.config/kitty/kitty.conf; rm -f /tmp/kitty.orig` — stock again.
  ** The text-size command scales the whole desktop; the larger UI after `16`/`18` is expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `font set` reports a missing font, the second family (the stock one) is always installed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `9 pt`; `font_size 12.0`; single `font_size`/`font_family` lines; no include; `9.0` after reset; UI size visibly changing and returning
  * If unsuccessful
  ** Duplicated keys, an `include` line added, or a report that does not read `9 pt`
covers: test/shell.d/kitty-config-test.sh (font/text-size half); bin/omarchy-display-text-size; bin/omarchy-font-set; manual/38-fonts.md

### legacy-udev-rule-migration-quarantine   [VM-OK]
description: The migration for Omarchy 3's root-runs-user-home udev rules removes the exact generated files and reloads udev, quarantines any modified variant to `.omarchy-disabled` instead of deleting an admin's additions, keeps unrelated same-named rules byte-for-byte, and is a no-op on rerun.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `M=/usr/share/omarchy/migrations/1788102906.sh; R=/etc/udev/rules.d` then `printf '%s\n' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", ATTR{online}=="0", RUN+="/home/someuser/.local/share/omarchy/bin/omarchy-wifi-powersave on"' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", ATTR{online}=="1", RUN+="/home/someuser/.local/share/omarchy/bin/omarchy-wifi-powersave off"' | sudo tee $R/99-wifi-powersave.rules >/dev/null` (password `prime`).
  * Type `bash $M; echo s=$?; ls $R/99-wifi-powersave.rules* 2>&1` — `s=0` and the file is gone with no quarantine copy.
  * Type `printf '%s\n' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", RUN+="/usr/bin/systemd-run --no-block --collect --unit=omarchy-power-profile --property=After=power-profiles-daemon.service /home/someuser/.local/share/omarchy/bin/omarchy-powerprofiles-set"' 'ACTION=="add", SUBSYSTEM=="usb", RUN+="/usr/local/sbin/admin-power-hook"' | sudo tee $R/99-power-profile.rules >/dev/null`.
  * Type `bash $M; echo s=$?; ls $R/99-power-profile.rules*; sudo cat $R/99-power-profile.rules.omarchy-disabled` — `s=0`, a `Quarantined … .omarchy-disabled` line, the `.rules` gone, the `.omarchy-disabled` file holding both original lines.
  * Type `printf '%s\n' '# Replaces the rule Omarchy used to install from /home/someuser/.local/share/omarchy/bin/omarchy-powerprofiles-set' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", RUN+="/usr/local/bin/my-own-power-hook"' | sudo tee $R/99-power-profile.rules >/dev/null; sudo sha256sum $R/99-power-profile.rules; bash $M; echo s=$?; sudo sha256sum $R/99-power-profile.rules` — identical hashes (kept), `s=0`.
  * Type `bash $M; echo s=$?` — `s=0` with no output (no-op).
  * Type `sudo rm -f $R/99-power-profile.rules $R/99-power-profile.rules.omarchy-disabled; sudo udevadm control --reload` — the rules directory is as it started.
  ** The migration itself runs `sudo /usr/bin/rm`, `mv --no-clobber` and `udevadm control --reload`; the cached credential satisfies them.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type each `printf … | sudo tee` line as one command; the quoting must reach the file exactly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Exact rule removed; modified rule quarantined with the message and both lines preserved; harmless rule hash unchanged; silent rerun; clean directory
  * If unsuccessful
  ** The exact rule surviving, the admin line deleted instead of quarantined, or the harmless rule altered
covers: test/shell.d/legacy-power-udev-rules-migration-test.sh (udev half); migrations/1788102906.sh; manual/48-security.md

### xcompose-legacy-include-repair   [VM-OK]
description: A `~/.XCompose` still including the Omarchy 3 checkout path is repointed at the installed tree with the user's sequences kept and the compose key still working; a repaired or absent file is left alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cp ~/.XCompose /tmp/xcompose.orig 2>/dev/null; printf '%s\n' '# Include fast emoji access' 'include "%%H/.local/share/omarchy/default/xcompose"' '' '<Multi_key> <space> <n> : "Test User"' > ~/.XCompose`.
  * Type `bash /usr/share/omarchy/migrations/1788102906.sh; cat ~/.XCompose` — the include reads `include "/usr/share/omarchy/default/xcompose"` and the `Test User` line is still there.
  * Type `sha256sum ~/.XCompose; bash /usr/share/omarchy/migrations/1788102906.sh; sha256sum ~/.XCompose` — identical (idempotent).
  * Type `rm ~/.XCompose; bash /usr/share/omarchy/migrations/1788102906.sh; ls ~/.XCompose 2>&1` — not created.
  * Type `cp /tmp/xcompose.orig ~/.XCompose 2>/dev/null; rm -f /tmp/xcompose.orig` — stock file back.
  * Press CapsLock (the compose key) then `o` then `c` — `©` appears in the terminal; press Backspace.
  ** `%%H` in printf becomes the literal `%H` the legacy file contained.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * CapsLock is Compose on Omarchy; a shift-tap cancels an accidental caps state.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The repointed include with the custom line; identical hashes; no file created; `©` composed
  * If unsuccessful
  ** The custom line lost, the include unchanged, or a file created from nothing
covers: test/shell.d/legacy-power-udev-rules-migration-test.sh (XCompose half); migrations/1788102906.sh; manual/07-hotkeys.md, 31-dotfiles.md

### security-group-migrations   [VM-OK]
description: Two migrations drop blanket `input` and `docker` group grants from the login user only when present, flag a reboot (indicator in the bar) instead of rebooting, and do nothing when the user is not a member.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy state clear reboot-required; id -nG` — note the groups.
  * Type `sudo gpasswd -a prime input; bash /usr/share/omarchy/migrations/1787865477.sh; getent group input; ls ~/.local/state/omarchy/reboot-required` — `prime` no longer in `input`, the flag exists and the bar shows the reboot indicator; screenshot.
  * Type `omarchy state clear reboot-required; bash /usr/share/omarchy/migrations/1787865477.sh; ls ~/.local/state/omarchy/reboot-required 2>&1` — not a member → no flag (idempotent).
  * Type `sudo gpasswd -a prime docker; bash /usr/share/omarchy/migrations/1787580187.sh; getent group docker; ls ~/.local/state/omarchy/reboot-required; cmp ~/.local/share/applications/Docker.desktop /usr/share/omarchy/applications/Docker.desktop && echo launcher-refreshed` — `prime` removed, flag set, `launcher-refreshed`.
  * Type `omarchy state clear reboot-required` — the indicator disappears; the machine did not reboot.
  ** Group changes apply at next login; the migrations must never reboot on their own.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `prime` was already in `input` at the start, the first migration run is the real repair; note it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Membership removed and the indicator shown for both groups; no flag when not a member; launcher refreshed; no reboot
  * If unsuccessful
  ** Membership kept, a flag with nothing changed, or a reboot triggered
covers: test/shell.d/input-group-migration-test.sh, docker-group-migration-test.sh; migrations/1787865477.sh; migrations/1787580187.sh; bin/omarchy-state; manual/18-development-tools.md

### packaged-system-defaults-in-place   [VM-OK]
description: Shipped system files the maintainers pin as contracts are present on an installed system: hardened CUPS without cups-browsed, headers for the running kernel, Limine boot defaults, ufw enabled, the plocate drop-in, the Bluetooth agent condition, and the crash watcher enabled.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `grep -E '^(SystemGroup|PeerCred)' /etc/cups/cups-files.conf; pacman -Q cups cups-filters system-config-printer cups-pk-helper; pacman -Q cups-browsed cups-pdf 2>&1; systemctl is-active cups` — exactly `SystemGroup cups-browsed sys root` and `PeerCred on`; four packages; two `was not found`; `active`.
  * Press Super+Alt+Space, type `print`, open "Print Settings" — it opens without an authentication error; close it.
  * Type `pacman -Q linux-omarchy linux-omarchy-headers` — both installed at the same version.
  * Type `cat /etc/limine-entry-tool.d/omarchy-defaults.conf; grep -o initramfs_async=0 /proc/cmdline` — `KERNEL_CMDLINE[default]+=" initramfs_async=0"`, `BOOT_ORDER="linux-t2, linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`, and the cmdline match.
  * Type `systemctl is-enabled ufw; sudo ufw status | head -1` — `enabled`, `Status: active`.
  * Type `systemctl cat plocate-updatedb.service | grep -E 'ExecStart|ConditionACPower'` — an empty `ExecStart=`, then `ExecStart=/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots`, and `ConditionACPower=true`.
  * Type `systemctl --user cat bt-agent.service | grep Condition; systemctl --user is-enabled omarchy-crash-watch.service; ls /usr/share/libalpm/hooks/ | grep -c omarchy` — `ConditionPathIsDirectory=/sys/class/bluetooth`, `enabled`, `3`.
  ** The minted ISO is 4.0.2; if a file predates a HEAD change, report its actual content rather than failing silently.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Nothing here changes the machine; all commands are read-only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Each command's output exactly as listed; Print Settings open
  * If unsuccessful
  ** The differing line(s) and the file or package they came from
covers: test/shell.d/cups-hardening-test.sh, kernel-headers-migration-test.sh, limine-defaults-test.sh, firewall-config-test.sh, locate-test.sh (drop-in), bluetooth-test.sh (bt-agent condition), crash-capture-test.sh (unit enabled), config-test.sh (alpm hooks, package defaults); etc/cups/*; etc/limine-entry-tool.d/omarchy-defaults.conf; default/systemd/**; install/config/firewall.sh

### locate-indexes-and-prunes-snapshots   [VM-OK]
description: After Omarchy's `updatedb` run, `locate` finds a new file, excludes `/.snapshots`, and `/etc/updatedb.conf` is left untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `sudo stat -c '%a %U %Y' /etc/updatedb.conf; sudo sha256sum /etc/updatedb.conf; mkdir -p ~/locate-probe && touch ~/locate-probe/omarchy-locate-probe-file`.
  * Type `sudo /usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` (about 20 s).
  * Type `locate omarchy-locate-probe-file; locate -c /.snapshots/; sudo ls /.snapshots | head -2` — the probe path, `0`, and existing snapshots.
  * Type `sudo stat -c '%a %U %Y' /etc/updatedb.conf; sudo sha256sum /etc/updatedb.conf` — identical to the first reading.
  * Type `sudo systemctl start plocate-updatedb.service; systemctl status plocate-updatedb.service | head -6` — the unit ran the same `updatedb` command line and exited 0.
  * Type `rm -r ~/locate-probe` — the probe is gone.
  ** `locate -c` counts matches; a non-zero count under `/.snapshots` is the failure.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The unit's status shows `ExecStart=/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The probe found; `0` snapshot entries with snapshots present; `updatedb.conf` unchanged; the unit succeeding
  * If unsuccessful
  ** The probe missing, snapshot paths indexed, or `updatedb.conf` changed
covers: test/shell.d/locate-test.sh; default/systemd/system/plocate-updatedb.service.d/10-omarchy.conf; install/post-install/localdb.sh; manual/47-system-snapshots.md

### copy-url-migration-defers-while-chromium-open   [VM-OK]
description: The Copy URL shortcut repair rewrites Chromium's Preferences to the pinned extension id only while Chromium is closed (it would revert the file on exit), asks before proceeding, backs the file up, and leaves third-party `copy-url` commands alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Close Chromium if open (Super+W). Open a terminal and type `P=~/.config/chromium/Default/Preferences; cp "$P" /tmp/prefs.orig; jq '.extensions.commands["linux:Alt+Shift+L"]={command_name:"copy-url",extension:"ikkebdkaanlebnifjnbeiaklodhbjcci",global:false} | .extensions.settings["ikkebdkaanlebnifjnbeiaklodhbjcci"]={commands:{"copy-url":{suggested_key:"Alt+Shift+L",was_assigned:true}}}' /tmp/prefs.orig > "$P"`.
  ** If `Preferences` does not exist, open and close Chromium once first.
  * Press Super+Shift+Enter (Chromium open); back in the terminal type `bash /usr/share/omarchy/migrations/1786643346.sh; echo s=$?` — a prompt asks to close the browser; answer No — non-zero `s`, and `jq -r '.extensions.commands["linux:Alt+Shift+L"].extension' "$P"` still shows the ghost id.
  * Close Chromium (Super+W, wait 3 s) and run the migration again — `s=0`; the `jq` now prints `bgpiichlckmfanooecilcjemknkcpngb`; `ls "$P.omarchy-copy-url-repair.bak"` exists.
  * Type `sha256sum "$P"; bash /usr/share/omarchy/migrations/1786643346.sh; sha256sum "$P"` — identical (idempotent).
  * Type `jq '.extensions.commands["linux:Ctrl+Alt+P"]={command_name:"copy-url",extension:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",global:false} | .extensions.settings["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]={path:"/home/prime/ext",commands:{}}' "$P" > /tmp/p && mv /tmp/p "$P"; sha256sum "$P"; bash /usr/share/omarchy/migrations/1786643346.sh; sha256sum "$P"` — identical (third-party binding left alone).
  * Type `cp /tmp/prefs.orig "$P"; rm -f "$P".omarchy-copy-url-repair.bak /tmp/prefs.orig` — Chromium's preferences are as they were.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The prompt is a gum yes/no in the terminal; `n` declines.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Deferral with the browser open; repair to the pinned id with a backup once closed; identical hashes on rerun and with a third-party binding
  * If unsuccessful
  ** The file rewritten while Chromium ran, the ghost surviving a clean run, or the third-party entry changed
covers: test/shell.d/copy-url-shortcut-migration-test.sh; migrations/1786643346.sh; manual/23-browsers.md

### chromium-copy-url-shortcut-and-hosts   [VM-OK]
description: Alt+Shift+L in Chromium copies the page URL with a toast and lands it in the clipboard history, through per-user native-messaging hosts registered with pinned extension ids (Copy URL and yt-dlp, Chromium and Brave Origin).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `jq -c '{name,path,allowed_origins}' ~/.config/chromium/NativeMessagingHosts/com.omarchy.copy_url.json` — `com.omarchy.copy_url`, a path ending `/omarchy-chromium-copy-url-host`, origin `chrome-extension://bgpiichlckmfanooecilcjemknkcpngb/`.
  * Type `jq -c '{name,path,allowed_origins}' ~/.config/chromium/NativeMessagingHosts/com.omarchy.ytdlp.json; ls ~/.config/BraveSoftware/Brave-Origin/NativeMessagingHosts/` — `com.omarchy.ytdlp` with origin `chrome-extension://dedjgknigfeelejglamclffonmophnfl/`, and both manifests listed for Brave Origin.
  * Press Super+Shift+Enter, type `chrome://version` in the address bar and Enter.
  * Press Alt+Shift+L — a toast confirms the URL was copied; screenshot.
  * Press Super+Ctrl+V — `chrome://version/` is the top history entry; Escape.
  * Close Chromium with Super+W.
  ** The extension needs a moment after Chromium starts; if the first Alt+Shift+L shows no toast, wait 2 s and press it again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click into the page area before the hotkey so Chromium, not the address bar, has focus.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both host manifests with pinned ids and the Brave Origin copies; the copy toast; the URL in the clipboard history
  * If unsuccessful
  ** A missing manifest, no toast, or no history entry
covers: test/shell.d/chromium-copy-url-test.sh, chromium-ytdlp-test.sh (installer/manifest); bin/omarchy-install-chromium-copy-url; bin/omarchy-install-chromium-ytdlp; bin/omarchy-chromium-copy-url-host; manual/23-browsers.md

### chromium-claude-extension-pkexec   [VM-OK]
description: The Claude browser extension is registered system-wide through one polkit-authenticated run of the packaged installer for every browser family, a repeat run needs no authentication, and a cancelled authentication writes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `ls /usr/share/chromium/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json 2>&1` — note whether it exists.
  * Type `omarchy-install-chromium-claude; echo s=$?` — if it was absent, a polkit dialog appears: enter `prime`; `s=0`; screenshot the dialog.
  * Type `for b in chromium google-chrome microsoft-edge; do f=/usr/share/$b/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json; stat -c %a $f; jq -r .external_update_url $f; done` — `644` and `https://clients2.google.com/service/update2/crx` three times.
  * Type `omarchy-install-chromium-claude; echo s=$?` — `s=0` with no dialog.
  * Type `sudo rm /usr/share/google-chrome/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json; omarchy-install-chromium-claude; echo s=$?` — the dialog appears; click Cancel — non-zero and `ls` of that file fails.
  * Type `omarchy-install-chromium-claude; echo s=$?` and authenticate — `s=0`, the file is back: all three registrations present as at step 3.
  ** The polkit dialog is a centred Quickshell window; type the password and press Enter, or click Cancel.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the file already existed at step 1, the first run shows no dialog; the remove/cancel steps still exercise it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One dialog then three 644 registrations; a silent repeat; cancel propagates failure and writes nothing; re-auth restores
  * If unsuccessful
  ** A dialog on the repeat run, a missing browser family, or a cancelled auth still writing
covers: test/shell.d/chromium-claude-test.sh; bin/omarchy-install-chromium-claude

### background-picker-filter   [VM-OK]
description: The background picker filters its carousel as you type, moves the selection to the first match when the current one is hidden, shows nothing for a non-matching filter, and applies the chosen image on Enter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Space — the carousel opens with the current theme's wallpapers, the current one selected; screenshot and note its label.
  * Type the first three letters of a different image's label — the carousel narrows and the selection jumps to the first match; screenshot.
  * Press Backspace until empty and type `zzqq` — no images, no crash; screenshot.
  * Press Backspace until empty, press Right once and Enter — the wallpaper changes to that image; screenshot the desktop.
  * Press Super+Ctrl+Space and Escape — the wallpaper stays as chosen.
  * Press Super+Ctrl+Space, select the original image and Enter — the desktop is as it started.
  ** Labels are the file names title-cased (`nord_river` → `Nord River`); filtering is case-insensitive.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The selected image is the enlarged/centred one; Right and Left move the selection.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Filtered carousel with moved selection; empty carousel; wallpaper changed on Enter and unchanged on Escape; original restored
  * If unsuccessful
  ** The selection staying on a hidden image, a crash on empty results, or the wallpaper not changing
covers: test/shell.d/image-picker-test.sh; shell/plugins/image-picker; manual/39-backgrounds.md

### keyboard-layout-widget-language-label   [VM-OK]
description: The keyboard-layout bar widget labels layouts by language (EN, PT, DE), switches on click, and Omarchy derives the layout list from `/etc/vconsole.conf`, putting `us` in front of a non-latin layout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cat /etc/vconsole.conf; hyprctl getoption input:kb_layout | head -1` — the vconsole layout (`us`) and `str: us`.
  * Type `omarchy bar put omarchy.keyboard-layout --after omarchy.clock` — a pill `EN` (not `US`) appears beside the clock; screenshot.
  * Type `hyprctl keyword input:kb_layout 'us,br,de'` and click the `EN` pill — `PT`; click again — `DE`; click again — `EN`; screenshot each.
  * Type `sudo cp /etc/vconsole.conf /tmp/vconsole.orig; sudo sh -c 'printf "KEYMAP=us\nXKBLAYOUT=ru\nXKBVARIANT=phonetic\n" > /etc/vconsole.conf'; hyprctl reload; hyprctl getoption input:kb_layout | head -1; hyprctl getoption input:kb_variant | head -1; hyprctl getoption input:kb_options | head -1` — `us,ru`, `,phonetic`, options ending `grp:alts_toggle`.
  * Click the pill — `RU`; click again — `EN`.
  * Type `sudo cp /tmp/vconsole.orig /etc/vconsole.conf; hyprctl reload; omarchy bar defaults` — layout `us` and the stock bar.
  ** The pill follows the keyboard that switched; if it lags a beat, click once more.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type all commands before the vconsole change with the US layout; after the change the terminal still types Latin while `EN` is shown.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `EN`; `PT`/`DE`/`EN` on clicks; `us,ru` / `,phonetic` / `grp:alts_toggle`; `RU`; restored
  * If unsuccessful
  ** A country label, a pill that does not switch, or `ru` without `us` in front after reload
covers: test/shell.d/keyboard-layout-test.sh, hyprland-keyboard-layout-test.sh; shell/plugins/bar/widgets/KeyboardLayoutModel.js; default/hypr/input.lua; manual/34-keyboard-mouse-trackpad.md

### hardware-absence-paths   [VM-PARTIAL]
description: On hardware the guest lacks, Omarchy hides the matching menu rows and fails gracefully from the CLI: no laptop, fingerprint, hybrid-GPU or battery entries, no brightness OSD, an open-lid handler that never locks, Bluetooth quietly off, and no fingerprint indicator on the lock screen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Trigger → Hardware — no "Laptop Display", "Mirror Display", "Hybrid GPU", "Touchpad" or "Touchscreen" rows; → Trigger → Toggle — no "Battery Percentage"; → Setup → Security — no "Fingerprint"; screenshot each; Escape.
  * Open a terminal and type `for d in laptop laptop-closed fingerprint hybrid-gpu nvidia nvidia-gsp nvidia-without-gsp external-monitors; do omarchy-hw-$d >/dev/null 2>&1; echo "$d=$?"; done; omarchy-hw-display` — all `=1` except `external-monitors=0` (QEMU's `Virtual-1` counts as external), and `omarchy-hw-display` prints an error (no backlight).
  * Type `omarchy battery status --shell; echo s=$?; omarchy brightness display; echo s=$?` — no `percentage` line, no battery in the bar, and a brightness error with no OSD on screen.
  * Type `omarchy-toggle-hybrid-gpu; echo s=$?; omarchy-setup-security-fingerprint; echo s=$?` — both fail promptly with a message; no pacman runs.
  * Type `omarchy-system-lid-close; echo s=$?` — the desktop does NOT lock.
  * Type `bash ~/.config/omarchy/hooks/post-update.d/setup-fingerprint.hook; ls ~/.local/state/omarchy/done/fingerprint-setup-invitation 2>&1; systemctl --user status bt-agent.service | head -3; omarchy bluetooth power on; echo s=$?` — no toast and no marker; bt-agent inactive with its condition unmet; the power command returns without hanging.
  * Press Super+Ctrl+L — the lock screen has no fingerprint indicator; unlock with `prime`.
  ** Skipped in this VM: every positive hardware path (battery, backlight/DDC, enrolment, supergfx switch, real lid/clamshell, NVIDIA, Apple quirks).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Any command here that runs longer than 10 s is a hang and should be reported.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Menu screenshots without the hardware rows; the exit-code list; no battery widget or OSD; prompt failures; no lock from the lid handler; bt-agent condition; a lock screen without a fingerprint indicator
  * If unsuccessful
  ** A hardware row shown, a hang, a crash toast, or the lid handler locking the screen
covers: test/shell.d/hw-display-test.sh, hw-external-monitors-test.sh, hw-fingerprint-test.sh, hw-hybrid-gpu-test.sh, hw-nvidia-test.sh, hybrid-gpu-test.sh, brightness-display-test.sh, battery-status-test.sh, battery-test.sh, lid-close-test.sh, fingerprint-package-test.sh, fingerprint-invitation-test.sh, bluetooth-test.sh, lock-fingerprint-indicator-test.sh (absence paths); default/omarchy/omarchy-menu.jsonc `when:` guards; manual/13-toggles-idle-screensaver.md, 37-hardware-authentication.md

### first-run-already-complete   [VM-OK]
description: On a provisioned machine the first-run setup is gated by a single completion marker: re-running it reports completion and does nothing, and the first-run hooks it installed are still in place.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy done check first-run-user; echo s=$?` — `s=0`.
  * Type `omarchy-provision-first-run` — prints `First-run already complete` and returns at once.
  * Type `ls ~/.config/omarchy/hooks/post-update.d/` — `setup-agent.hook` and `setup-fingerprint.hook` are listed.
  * Type `ls ~/.local/state/omarchy/done/` — the `first-run-user` marker is among the entries; screenshot.
  * Type `omarchy-provision-first-run; echo s=$?` once more — same message, `s=0`, nothing else changed.
  ** Do not pass `--force`; that would re-run the provisioning steps.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The whole test is read-only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `s=0`; `First-run already complete` twice; both hooks and the marker listed
  * If unsuccessful
  ** The script running setup steps, or a missing marker/hook
covers: test/shell.d/first-run-test.sh, agent-invitation-test.sh (hook stays installed), fingerprint-invitation-test.sh (hook stays installed); bin/omarchy-provision-first-run; bin/omarchy-done

### migrations-rerun-safely   [VM-OK]
description: Re-running Omarchy's small migrations by hand is safe: an unparsable shell.json is left untouched by the agents rename, an identical stock user font is retired while a modified one is kept, Hermes skills are linked without creating profiles, and the Hermes skin migration is a no-op without the app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cp ~/.config/omarchy/shell.json /tmp/shell.json.orig; printf '{ not json' > ~/.config/omarchy/shell.json; bash /usr/share/omarchy/migrations/1786099804.sh; cat ~/.config/omarchy/shell.json; cp /tmp/shell.json.orig ~/.config/omarchy/shell.json` — still exactly `{ not json`, then restored.
  * Type `mkdir -p ~/.local/share/fonts; cp /usr/share/fonts/omarchy/omarchy.ttf ~/.local/share/fonts/omarchy.ttf; bash /usr/share/omarchy/migrations/1788848726.sh; ls ~/.local/share/fonts/omarchy.ttf 2>&1` — the identical stock copy was removed.
  * Type `cp /usr/share/fonts/omarchy/omarchy.ttf ~/.local/share/fonts/omarchy.ttf; echo custom >> ~/.local/share/fonts/omarchy.ttf; bash /usr/share/omarchy/migrations/1788848726.sh; ls ~/.local/share/fonts/omarchy.ttf; rm ~/.local/share/fonts/omarchy.ttf` — the modified font was kept.
  * Type `bash /usr/share/omarchy/migrations/1787843905.sh; ls -l ~/.hermes/skills/; ls ~/.hermes/profiles 2>&1` — symlinks `omarchy` and `diagnose-crash` → `/usr/share/omarchy/default/agents/skills/…`, and no `profiles` directory.
  * Type `bash /usr/share/omarchy/migrations/1788619462.sh; echo s=$?; rm /tmp/shell.json.orig` — `s=0` and nothing happens (no Hermes Desktop).
  ** These scripts are what `omarchy migrate` runs on update; each is asserted idempotent.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `~/.hermes/skills` may already hold the links from provisioning; the migration must then leave them as they are.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `{ not json` intact; stock font removed, modified font kept; skill links with no profiles; skin migration no-op
  * If unsuccessful
  ** A truncated shell.json, a deleted custom font, or profiles created
covers: test/shell.d/agents-rename-migration-test.sh (unparsable config), legacy-icon-font-migration-test.sh, hermes-skills-migration-test.sh, hermes-skin-migration-test.sh; migrations/1786099804.sh, 1788848726.sh, 1787843905.sh, 1788619462.sh

### launch-1password-missing-opens-installer   [VM-PARTIAL] [NET]
description: The 1Password hotkey opens the installer when the app is absent instead of failing silently; the download is cancelled here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `pacman -Q 1password 2>&1` — not found.
  * Press Super+Shift+/ — a floating terminal opens running `omarchy-install-service-1password` (download begins); screenshot; press Ctrl+C within 5 s.
  * Type `pacman -Q 1password 2>&1` — still not found; no 1Password window opened.
  * Type `omarchy-launch-1password` — the same installer terminal; cancel it with Ctrl+C.
  * Screenshot the desktop — unchanged.
  ** Skipped: completing the AUR install (~100 MB) and the installed-path launch with `--force-device-scale-factor=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click into the floating terminal before Ctrl+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer terminal on the hotkey and from the CLI; nothing installed after cancel
  * If unsuccessful
  ** Nothing on Super+Shift+/, or an error toast
covers: test/shell.d/launch-1password-test.sh; bin/omarchy-launch-1password; default/hypr/bindings/applications.lua; manual/24-commercial-apps-services.md

### channel-set-rc-roundtrip   [VM-PARTIAL] [NET] [SLOW]
description: Switching the release channel stable → rc → stable refreshes the pacman channel, reinstalls the Omarchy packages and runs the normal update pipeline without an early reboot prompt; downloads are large, so only run with budget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `omarchy channel current` — `stable`.
  * Press Super+Space → Update → Channel → RC — a floating terminal runs `omarchy-channel-set rc`: channel refresh, `omarchy omarchy-settings` reinstall, then `omarchy-update -y`; no `Reboot now` question before the update pipeline.
  * When it finishes type `omarchy channel current` — `rc`; the Channel submenu ✓ is on RC.
  * Press Super+Space → Update → Channel → Stable and let it finish.
  * Type `omarchy channel current` — `stable` again.
  ** If a switch exceeds the session budget, press Ctrl+C, record how far it got, and end with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: the edge/dev channels (a git clone plus dev packages).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `rc` then `stable`; ✓ following; no early reboot prompt
  * If unsuccessful
  ** The terminal output at the failure, or a reboot prompt before the update stage
covers: test/shell.d/channel-test.sh (stable/rc paths); bin/omarchy-channel-set; manual/30-updates.md

## Not runnable here (appendix candidates)

- `factory-reset-scrubs-accounts` [VM-NO] — Setup → Reset Computer stages a Btrfs factory reset and reboots into provisioning; destroys the disk and exceeds the budget. (factory-reset-accounts-test.sh)
- `hermes-desktop-install-pins-release` / `hermes-remove-asks-before-data` [VM-NO] [NET] [SLOW] — needs the `hermes-desktop` package and upstream bootstrap (hundreds of MB, > 10 min). (hermes-desktop-install-test.sh, hermes-remove-test.sh, hermes-theme-test.sh activation half, hermes-cli-migration-test.sh desktop-takeover half)
- `openclaw-launch-onboards-then-gateway` [VM-NO] [NET] [SLOW] — needs `openclaw` installed via Install → AI → OpenClaw. (launch-openclaw-test.sh, default-agent-test.sh OpenClaw half)
- `default-browser-install-firefox-policies` [VM-NO] [NET] [SLOW] — installing Firefox/Zen to check their root-owned `distribution/policies.json`; ~100 MB+. (default-apps-test.sh, browser-policy-dir-test.sh Firefox half)
- `battlenet-installer-only-launcher` [VM-NO] [NET] [SLOW] — Battle.net via Lutris/wine. (battlenet-test.sh)
- Every positive hardware path listed under `hardware-absence-paths` (battery, backlight/DDC, fingerprint, hybrid GPU, NVIDIA, lid/clamshell, Apple T2/brcmfmac/Studio Display) [VM-NO].
- `agent-usage-live-limits` [VM-NO] — needs a signed-in Claude/Codex/Fireworks account. (agent-usage-*-test.sh)
- `audio-panel-labels` [VM-NO] — no sound device in the guest. (audio-test.sh)


## Gaps

Behaviours in scope that cannot become a driver test, and why:

- **Pure code-style checks** — `bin-style-test.sh` (no raw `command -v` / `notify-send` in `bin/`). Listed per the brief; not user-visible.
- **Host-side test tooling** — `acceptance-helpers-test.sh` (layer on/off-screen arithmetic), `compositor-guard-test.sh` (`require_compositor` skip/retry/`ulimit -c 0`), `logging-test.sh` (installer `run_logged`). These test the test harness / installer, not the installed system.
- **Quickshell QML fixtures** — `bar-icon-geometry`, `bar-widget-contract`, `button-border-stability`, `indicator-contract`, `lock-fingerprint-indicator` (fixture half), `lock-password-overflow` (fixture half). They need `test/shell.d/fixtures/**` and `quickshell -p` against the repo tree; the driver cannot ship files into the guest and the package does not install `test/`. Their user-visible consequence (aligned icons, stable buttons, no binding loops, dots that fit) is covered only by screenshot judgement in `lock-screen-long-password-dots-fit` and `bar-cli-layout-commands`.
- **Pure model/JS unit logic** — `audio-test.sh` (Model.js labels), `battery-test.sh` (BatteryModel), `border-geometry-test.sh` (path arithmetic), `dropbox-test.sh` (Model.js), `hyprland-paths-test.sh`, most of `clock-test.sh` (ISO weeks, grid, birth-year parsing), `image-picker-test.sh` parsing, `clipboard-test.sh` display-row functions, `emojis-test.sh` parsing, `keyboard-layout-test.sh` brief table. Only their on-screen effects are proposed.
- **Network-account-bound collectors** — the payload-shape and cache-window assertions in `agent-usage-claude-limits`, `-claude-scanner` (opencode/pi/omp fixtures are reproducible but prove nothing on screen beyond token counts), `-codex-scanner` (cache reuse windows, corrupt cache, interrupted scan), `-fireworks-scanner`. Only the "Waiting for auth"/hidden-record absence paths are proposed.
- **Root-namespace PATH-poisoning matrices** — `apply-lock-test.sh` (trusted `fprintd-list`), `dns-sudoers-test.sh` (root PATH probe), `browser-policy-sudoers-test.sh` (root PATH pin): the static properties are readable in the guest (`grep` the scripts) but the poisoned-PATH execution needs `unshare --user` fixtures. The user-visible half (passwordless grants, refusals) is proposed.
- **Hardware quirk logic** — `brcmfmac-supplicant-test.sh`, `brightness-display-apple-cache-test.sh`, `brightness-display-test.sh` (DDC/backlight maths), `hw-display`, `hw-fingerprint`, `hw-hybrid-gpu`, `hw-nvidia`, `fingerprint-driver-migration`, `lid-close` positive paths, `bluetooth-test.sh` rfkill contracts (no adapter to observe). Only absence paths are proposed.
- **Build/packaging assertions** — `config-test.sh` PKGBUILD coverage (needs the omarchy-pkgs checkout), manifest/entry-point resolution, `battlenet-test.sh` template location, `chromium-whatsapp-slim-test.sh` extension id, `hyprland-binding-conflicts-test.sh` rebind semantics, `hyprland-default-config-test.sh` migration/upgrade ordering, `cups-hardening-test.sh` drop-in contents (readable but static), `limine-defaults-test.sh` (readable; proposed only as a read-back).
- **Migrations that need state the stock disk lacks** — `docker-group`/`input-group` are proposed by adding the group first; `cups-hardening` migration (needs `cups-browsed` installed to observe stop/restart), `kernel-headers` migration failure path (needs a failing pacman), `fingerprint-driver` (needs fprintd), `hermes-cli-migration` desktop-takeover half, `agents-rename` widget half (the stock config has no `model-usage`), `copy-url` mid-repair race branches (need a browser starting at the exact moment).
- **Sub-second/ordering assertions** — `bar-test.sh` hover-peek tally and drag ghost states, `launch-shell-test.sh` "signal during backoff", `hermes-theme-test.sh` `--wait` 30-minute give-up, `chromium-ytdlp-test.sh` forged-record handling (needs a controlled yt-dlp), `desktop-entry-launch-test.sh` `errexit`-inherited command building. Not observable from screenshots.
- **The `omarchy update` pacman guard positive path** (`omarchy update` itself is allowed through) — a full update is NET/SLOW; only the refusal/bypass is proposed.
