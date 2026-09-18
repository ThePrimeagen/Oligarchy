# 52 — Existing maintainer shell tests, `test/shell.d/[m-z]*-test.sh`

Reviewer notes for the maintainers' unit/shell tests whose names start with m–z, plus the
QML text-format scanner. Every test file encodes a contract the maintainers consider load-bearing
(a fixed bug, a security boundary, a recovery path). This file inventories each asserted behaviour,
says whether a screenshot-only driver can observe it in the QEMU guest, and proposes driver tests
for every contract that is reproducible there.

## Scope

- Reviewed in full: 127 files matching `/tmp/omarchy-review/omarchy/test/shell.d/[m-z]*-test.sh`
  (22,480 lines) and `test/shell.d/qml-text-format-scan.py` (373 lines). Also read
  `test/shell.d/base-test.sh` (the shared `pass`/`fail`/`run_node_test`/`require_compositor`
  helpers) because every file sources it.
- Cross-checked against the sources the tests name, read-only, only where a proof needed an exact
  on-screen string: `bin/omarchy-sudo-passwordless`, `bin/omarchy-update-pacman-guard`,
  `bin/omarchy-update-lock`, `bin/omarchy-update-requires-free-space`, `bin/omarchy-refresh-config`,
  `bin/omarchy-theme-install`, `bin/omarchy-theme-remove`, `bin/omarchy-webapp-install`,
  `bin/omarchy-plugin-add`, `bin/omarchy-migrate`, `bin/omarchy-restart-shell`,
  `bin/omarchy-snapshot`, `bin/omarchy-update-orphan-pkgs`, `bin/omarchy-notification-send`,
  `bin/omarchy-setup-security-fido2`, `bin/omarchy-windows-vm`, `default/omarchy/omarchy-menu.jsonc`,
  `install/omarchy-base.packages`, and the `manual/` chapter list (01–51).
- Not in scope (other reviewers): `test/shell.d/[a-l]*`, `test/acceptance.d/`, `test/cli`,
  fixtures under `test/shell.d/fixtures/`.
- Skipped nothing in scope. Pure code-style / source-grep checks are inventoried but listed under
  Gaps rather than turned into driver tests.

Feasibility legend follows `00-FORMAT.md`: `VM-OK`, `VM-PARTIAL`, `VM-NO`, `NET`, `SLOW`.

## Inventory

One line per asserted behaviour, grouped by test file. Header line per file:
`file → source under test — visible on screen? — how a driver reaches it (or why not)`.
"Absence path" means the hardware the test mocks is missing in QEMU, so the driver can only
observe the software's no-device branch.

### `manifest-entrypoints-test.sh` → `shell/plugins/**/manifest.json`, `shell/Ui`, `shell/Commons` — visible: no — quickshell fixture; skipped without compositor
- Every plugin manifest's declared entry point (`bar`, `barWidget`, `menu`, `overlay`, `panel`, `service`) loads in Quickshell without error.
- Driver: cannot run the fixture; the equivalent is "the bar and every default widget render" (see `screenshot-fullscreen-captures-bar`).

### `media-test.sh` → `shell/plugins/services/media/MediaModel.js` — visible: partial — bar media widget/OSD
- `isProxyPlayer` detects the `playerctld` proxy by DBus name and by desktop entry.
- `hasMetadata`/`hasTrackMetadata`/`playerCanControl`/`canHandleAction`/`canCycleSource` classify players.
- `isPlaybackStream` detects PipeWire playback streams; `streamLabelKey`/`rawStreamLabel` normalise stream labels; `playerAppLabel` derives an app label from a DBus name.
- `playerHasPlaybackStream` matches a player to its stream; `playerKey` is stable; `trackSignature`/`trackChanged` detect metadata changes.
- `labelFor` prefers track title; `osdMessage` builds `Title - Artist` and falls back to a given string.
- Driver: no audio device or player in QEMU → only the absence path (no media widget, `omarchy-shell media status` → `hasPlayer:false`).

### `menu-guards-test.sh` → `shell/plugins/menu/MenuModel.js` (`guardScript`, `guardReaders`), `bin/omarchy-pkg-present|missing`, `bin/omarchy-cmd-present|missing`, `bin/omarchy-theme-extras`, `bin/omarchy-theme-update` — visible: yes (menu rows appear/vanish)
- Guard batch reports `when:` as `<id>:w:<0|1>`, `checked:` as `<id>:c:<0|1>`, `disabled:` as `<id>:d:<0|1>`; items without guards emit nothing; empty guard set yields an empty script.
- Each value reader (`$(omarchy-default-browser)` etc.) is run once per batch and its captured answer substituted; readers are captured before any guard runs.
- Only the plain `$(reader)` form is substituted; `command -v`, env-prefixed, or piped forms run the real command.
- Every reader the shipped menu reads from more than one row is listed in `guardReaders`.
- The prelude's shadow `omarchy-pkg-present/missing` resolve packages through `provides`, wrapped `-Qi` continuation lines and `>=` constraints exactly like pacman; `omarchy-cmd-present/missing` agree with the real helpers, including builtins like `cd`.
- A captured reader compares identically to the substitution it replaced (trailing newline dropped); a reader exiting nonzero under `errexit` does not kill the rest of the batch.
- `Update > Extra Themes` (`update.themes`, `when: omarchy-theme-extras`) shows exactly when `omarchy-theme-update` has a git clone to pull: missing/empty/hand-copied/symlinked/worktree themes → hidden; a `.git` directory → shown.
- `omarchy-theme-extras` lists every clone (names with spaces intact) and nothing else; `omarchy-theme-update` runs `git -C "<whole path>" pull` per clone.
- Driver: install a git theme, observe the `Extra Themes` row appear (see `theme-install-strips-code-from-git-theme`).

### `menu-images-test.sh` → `bin/omarchy-menu-images` — visible: partial (background picker thumbnails)
- Stale `.lock` directories (>10 min) and partial `*.<pid>.jpg` files left by killed generators are recovered; every row is rebuilt; signature bumps to `v4`.
- A fresh legacy lock directory is respected: its thumbnail is skipped and rows are not cached while it may be owned.
- A batch with a failed `vipsthumbnail` leaves no `.rows`/`.signature`/`.fast-signature`; a later retry completes and caches.
- Two concurrent generators serialise on locks (3 calls for 3 images) and release them after one lifetime (6 calls after cache wipe).
- Driver: picker shows thumbnails; cache dir `~/.cache/omarchy/image-selector` fills; lock internals not visible.

### `menu-plugin-test.sh` → `bin/omarchy-menu-plugin` — visible: yes (Setup → Plugins pickers)
- Picker rows carry `name<TAB>id`; the id is shown as subtext and the pick resolves by id, so two plugins named "Clock" act on the right one (`omarchy-plugin-enable tester.clock`).
- `remove` acts on the picked id; `enable` delegates to `omarchy-plugin-enable <id>` without `--section`.
- `clone` offers only first-party plugins not already cloned, then runs `omarchy-launch-floating-terminal-with-presentation omarchy-plugin-clone <id> --edit`; once a clone with `clonedFrom` exists the source disappears; with nothing to clone → notification `No plugin to clone`.
- A bar (`canDisable:false`) never appears under `disable`; under `enable` every bar except the running one is offered and picking the built-in bar enables it.
- With nothing to act on → notification `No plugin to enable` rather than an empty list.
- Driver: `plugin-clone-enable-remove-roundtrip`.

### `menu-test.sh` → `shell/plugins/menu/MenuModel.js`, `shell/plugins/menu/Menu.qml`, `default/omarchy/omarchy-menu.jsonc`, `bin/omarchy-menu-plugin`, `bin/omarchy-plugin-add`, `bin/omarchy-plugin-enable`, `default/fonts/omarchy/omarchy.ttf` — visible: yes
- JSONC with comments/trailing commas parses; items normalise to `{id,parent,kind,icon,iconFont,label,title,target,description,action,provider,aliases,when,checked,disabled}`.
- User entries override defaults by id and keep the original order; root is injected.
- `slugify("Power Saver!")==power-saver`; paths render as `Style › Theme picker`; descendants/child counts computed.
- Checked rows show `Label ✓`; a `disabled:` row that succeeded shows `Label ✓` (already installed); one that failed shows plain label.
- Submenus with no visible children hide (recursively); provider-backed submenus stay visible.
- `disabled:` keeps the row listed but unselectable; a row without `disabled:` is never disabled; search skips disabled rows.
- Search matches labels/aliases, rejects missing terms, hides invisible matches; name matches score above description matches.
- Installed apps rank above equally-good menu entries (`brave` → Brave app above Install/Remove/Default rows); whole-word app match beats exact-labelled entries; a better menu match (`style.font` for "font") stays above a weak app (FontForge).
- Routing: `resolveRoute("system")` never lands on htop via its `system` keyword; `power-menu`/`power_menu` aliases route to `system`; empty → `root`; unknown → literal.
- Trigger lists Emoji first (`omarchy-menu-emoji`); `update.omarchy` uses glyph `\ue900` in font `omarchy`; `update.themes` guarded by `omarchy-theme-extras`; `setup.input` opens `input.lua`; `setup.direct-boot` runs `omarchy-setup-direct-boot`; `setup.reset` runs `omarchy-system-factory-reset` and is last under Setup.
- Defaults > Agent lists exactly Antigravity, Claude, Codex, Copilot, Crush, Cursor CLI, Grok, Hermes, Muse Code, omp, OpenClaw, OpenCode, Ori, Pi — alphabetical, each `omarchy-default-agent <agent>` with a `checked:` and no `when:`.
- Defaults > Browser = Chromium, Chrome, Brave, Brave Origin, Edge, Firefox, Zen; Terminal = Alacritty, Foot, Ghostty, Kitty; Editor = Neovim, VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs — all unguarded.
- `install.ai.crush` removed; Install rows never hide for installed software (only `install.service.chromium-account` keeps a `when:`); Zen/VSCode/Steam/Rust/Windows rows use `disabled:` (`omarchy-pkg-present zen-browser-bin` etc.).
- Chromium Account hidden without `~/.config/chromium-flags.conf`, dimmed once `oauth2-client-id` is set.
- Remove rows hide (`when:`) for software not installed and never use `disabled:`; Remove categories ordered package, ai, service, development, theme, gaming, browser, webapp, tui, windows, preinstalls, security.
- `setup.security.passwordless-sudo` runs `omarchy-sudo-passwordless`; Direct Boot and Passwordless Sudo no longer under Trigger > Toggle.
- `style.bar.position` is a submenu with top/bottom/left/right → `omarchy-bar position <p>`; `style.bar.transparency` → `omarchy-bar transparent toggle`.
- Setup > Plugins = Enable, Disable, Add, Clone, Remove; enable/disable/clone/remove → `omarchy-menu-plugin <verb>`; Enable/Disable always shown; Remove hidden until `~/.config/omarchy/plugins/*/manifest.json` exists; Add runs `omarchy-plugin-add` in a terminal.
- `omarchy-menu-plugin` filters `enable` by `.enabled|not`, `disable` by `.canDisable and .enabled`, `remove` by `.firstParty|not`, `clone` by `.firstParty`, never inspects kinds; `omarchy-plugin-enable` prints `Now using $id as the bar`; `omarchy-plugin-add` preselects `barWidget.defaultSection // "center"` in `gum choose`.
- Picker rows are `icon\tname\tid`; Menu.qml select mode splits leading icon and trailing subtext; picker acts on `cut -f2`.
- Remove runs through `omarchy-launch-floating-terminal-with-presentation "omarchy-plugin-remove …"` so confirmation and backup path are visible.
- Fonts provider is `volatile` (re-enumerated on every open, never during search keystrokes).
- `trigger.hardware.laptop-display` and `mirror-display` guarded by `omarchy-hw-laptop`; `trigger.capture.screenrecord.webcam` guarded by `omarchy-hw-webcam`.
- Per-row icon font families; keyboard navigation disarms pointer; keyboard skips disabled rows; disabled rows cannot be activated by Enter or click and render at opacity 0.4 (not italic); cursor settles on a selectable row after rebuild; Return never conjures a cursor onto a disabled row.
- Filter change and route change disarm pointer (initial sample allowed only for mouse activation); Left key = Backspace on empty filter (go back); shared `PointerMoveGate` in card coordinates.
- App-row merge is idempotent, drops vanished entries, dedups shared ids, heals an orphaned order entry, never mutates the passed map; provider row swap idempotent, drops rows no longer listed, leaves other providers alone; colliding slugs (`acme.foo`/`acme_foo`) get `-` suffixes; Menu.qml assigns rebuilt maps instead of writing into `var` properties.
- `openExistingMenu`/`openDmenu` disarm the pointer before `opened = true`; hover selects only after real movement; entering a row samples immediately; click carries pointer intent into submenus.
- `omarchy.ttf` charset covers `e900-e90e`.
- Driver: `menu-install-rows-dim-installed-software`, `menu-hides-hardware-rows-absent-in-vm`.

### `migrate-notify-test.sh` → `bin/omarchy-migrate-notify` — visible: yes (toast)
- No pending migrations → silent on stdout and stderr.
- Pending but no notification server → stderr `Omarchy has pending migrations` plus the migration filenames.
- Pending → toast titled `Pending Omarchy Migrations`, body `Click to run 1 pending migration.`, glyph ``.
- Silent while `$XDG_RUNTIME_DIR/omarchy-update.lock` is flocked; resumes once released; re-checks the lock after waiting for the notification server.
- Ignores a lock outside its own runtime dir (a shared `/tmp` lock cannot silence another user).
- Exits immediately: click command handed to the shell as `--exec omarchy-launch-floating-terminal-with-presentation omarchy-migrate`.
- Driver: `migrate-pending-notifier-and-runner`.

### `migrate-scope-test.sh` → `bin/omarchy-migrate` — visible: yes (terminal)
- `--pending` lists pending filenames (exit 0) before state exists; exit 1 with no output when none.
- Runs migrations in order with `OMARCHY_PATH` exported, records markers under `~/.local/state/omarchy/migrations/<file>`, skips completed ones.
- A failing migration (strict mode) exits non-zero, stops at the failing line and is not marked complete.
- The queue uses a private fd, so a migration reading stdin gets the caller's stdin and does not swallow later queue entries.

### `migrate-wrapper-test.sh` → `bin/omarchy-migrate` — visible: yes
- Runs pending migrations without a force flag; dismisses `Omarchy Migrations` notifications afterwards.
- `--pending` lists / exits 1 quietly; `--force` → `Unknown option: --force` (obsolete).

### `mise-install-test.sh` → `bin/omarchy-mise-install` — visible: yes (terminal)
- Writes an executable `~/.local/bin/<cmd>` wrapper that runs `mise use -g --quiet <pkg>`.
- A package name with shell metacharacters reaches mise as one argument and never executes.
- Command names containing `/`, leading `.`, leading `-`, newline or tab are refused with `is not usable as a command name`, before any `rm` (an escaping name removes nothing outside `~/.local/bin`).
- Driver: `mise-install-refuses-bad-command-names`.

### `mise-work-path-test.sh` → `migrations/1789095456.sh`, `install/user/mise-work.sh` — visible: partial (files)
- New installs create `~/Work/tries`, no `~/Work/.mise.toml`, and call mise only for `use -g node@latest`.
- The migration removes the stock `_.path = "{{ cwd }}/bin"` config, revokes the Work trust root (a recreated file is untrusted), and is idempotent; also handles inline-comment and single-quoted variants.
- A customised config keeps unrelated settings and permissions (600), gets one `.bak.*` backup, prints `mise trust <config>` advice, and is idempotent on rerun.
- Unrelated configs are untouched and not backed up; a deleted Work directory's stale trust is revoked and no temp dir left behind; paranoid-mode (content-bound) trust is revoked too.
- An explicitly ignored config (`mise trust --ignore`) keeps exactly one ignore marker and reports `remains ignored by Mise`.
- A dotfile symlink survives; its target is repaired in place.
- Driver: check `~/Work/tries` exists and no `~/Work/.mise.toml` on stock (folded into `stock-system-policy-invariants`); migration internals need `mise` fixtures.

### `mise-wrapper-quiet-migration-test.sh` → `migrations/1787573629.sh`, `bin/omarchy-mise-install` — visible: no
- Rewrites stale generated wrappers to the current template (`mise use -g --quiet "<pkg>" || exit 1` / `exec mise x "<pkg>" -- "<bin>" "$@"`), preserving package and bin names (scoped npm names included), across pre-export, mise-exec and bare-exec templates; result stays executable; idempotent.
- Leaves hand-written scripts, mismatched wrappers, user-customised wrappers, unrelated scripts, symlinks and large binaries (`uv`) alone; succeeds when `~/.local/bin` is missing.

### `monitor-clamshell-scale-test.sh` → `bin/omarchy-hyprland-monitor-clamshell` — visible: no (needs lid/internal panel)
- With `scale = "auto"` (literal or via the default's `omarchy_monitor_scale` local) the enabled panel is never corrected and no scale is remembered (#7265, #7301).
- A numeric configured scale is not reapplied when it matches and is corrected when drifted.
- Clamshell disable remembers the internal scale (`toggles/hypr/internal-monitor-scale`); recovery of a disabled panel uses the remembered value, never `"auto"`; falls back to 2 with nothing remembered.
- Recovery uses the configured internal rule's `position`/`scale`; resolves `omarchy_monitor_scale`/position variable references; a quoted `"auto"` is a value not a reference; a specific rule shadows the catch-all; a scaleless internal rule takes the catch-all's scale over the remembered one.
- Expression scales (`3 / 2`) are left unresolved (remembered value used; enabled panel left alone); trailing comments never supply rules or keys; nested tables, block comments and semicolons parse.
- Absence path: no lid in QEMU.

### `monitor-modeless-test.sh` → `bin/omarchy-hyprland-monitor-modeless`, `bin/omarchy-hyprland-monitor-watch` — visible: no (needs a monitor reporting 0x0)
- Exit 0 (modeless) for any enabled monitor with width or height 0, including mirrors only visible via `monitors all`; exit 1 (working) for healthy, deliberately disabled, or no monitors; exit 2 (undetermined) for unparsable output or an unreachable compositor.
- Watcher reloads until the monitor reports a mode, then stops on its own; recovers a monitor left at 0x0 by `configreloaded`; an echoed reload does not stack a second loop; holds off while `omarchy-hyprland-reload-guard paused`; keeps asking after an unanswerable query; a trigger contending with the lock is not dropped; a healthy machine is never reloaded.
- Absence path: `omarchy-hyprland-monitor-modeless` exits 1 in QEMU (folded into `monitor-scaling-presets-in-vm`).

### `monitor-output-name-test.sh` → `bin/omarchy-hyprland-monitor-internal`, `-internal-mirror`, `-clamshell`, `-scaling` — visible: no (needs hostile connector names)
- `internal off` writes `hl.monitor({ output = "eDP-1", disabled = true })`; a name with Lua metacharacters is refused and no flag written.
- `mirror on` writes the mirror rule with both names; a hostile headless name is refused.
- Clamshell disable writes the connector name; a hostile internal name is refused.
- Scaling evals `hl.monitor({ output = "<focused>"…`; a hostile focused name is refused and nothing is eval'd.

### `monitor-recovery-test.sh` → `bin/omarchy-hyprland-monitor-watch`, `-internal`, `-internal-mirror`, `-laptop`, `-external-active`, `-clamshell`, `bin/omarchy-system-wake`, `bin/omarchy-hw-clamshell`, `bin/omarchy-hw-laptop-closed`, `default/hypr/bindings/utilities.lua`, `shell/plugins/lock/Service.qml` — visible: no (source greps)
- Watcher retries internal recovery at delays 1 3 7, polls clamshell under `flock -n 9`, reconciles on `monitoradded`, on startup, and only on a docked laptop.
- Modeless recovery: one backing-off loop (doubling to 60s) under a lock, gives up after 20 unanswered queries, also runs after `configreloaded`, never reloads into a paused reload guard; helper uses `monitors all -j` and ignores `disabled == true`.
- `omarchy-hw-clamshell` = lid closed (`/proc/acpi/button/lid/*/state`) and external monitors; external-active helper sees mirrors and ignores deliberately disabled outputs.
- Clamshell sync force-recovers internal/mirror, writes `internal-monitor-clamshell.lua`, never touches `MANUAL_DISABLE_FLAG`, dispatches DPMS with the internal name.
- Internal helper only wakes displays when it re-enables one; mirror helper recovers when no external remains.
- Lid switch: `switch:on:Lid Switch` → `omarchy-system-lid-close`, `switch:off` → clamshell sync; `omarchy-system-wake` resyncs clamshell.
- Lock service waits for stable real screens (`lock-pending: no-real-screen`, `screen-stabilizing`, `sessionLockStabilizeTimer`) before session lock.

### `monitor-scaling-test.sh` → `bin/omarchy-hyprland-monitor-scaling` — visible: yes
- `up` from 2 → `scale = 3`, persists `local omarchy_monitor_scale = 3` in `~/.config/hypr/monitors.lua`, logs `requested=up\tcurrent=2\tnew=3\tmonitor=<name>` to `~/.local/state/omarchy/monitor-scaling.log`.
- `down` from 3 (or 3.0000000000000004) → 2; explicit `3` and fractional `1.6`/`1.25` persist; GDK scale rounds to an integer (1.6→2, 1.25→1).
- With no argument prints the actual scale (`3`, or a non-preset `3.2`).
- On a 1280x800 mode the 3x preset approximates to 3.2 (up/down/explicit), 1.25 on 6016x3384 → 1.33333; displayed approximations are accepted; duplicate approximations are skipped as one step.
- Driver: `monitor-scaling-presets-in-vm` (QEMU virtio-vga default mode is 1280x800, the exact fixture the test uses).

### `monitor-state-test.sh` → `bin/omarchy-monitor-state` — visible: partial (Monitor panel)
- Always prints exactly 8 lines: brightness, internal name, external name, internal-enabled, mirror external, focused, scale, JSON display list (`{name,enabled,focused,width,height}`), so a dead helper cannot shift fields.
- Mirroring reported whichever way round; a disabled internal is still named but not "enabled".

### `monitor-test.sh` → `shell/plugins/panels/monitor/Model.js` — visible: yes (Monitor panel)
- Brightness clamps 1..100, rounds, rejects junk → 1; scale normalises (`1.250`→`1.25`), rejects junk → ``.
- `cleanScale(3,1280,800)==3.2`, `cleanScale(1.25,6016,3384)==1.33`, missing mode → ``; preset matching picks the approximated VM scale; presets with duplicate effective scales collapse (1280x804 → `1,1.25,2,4`); unreachable presets hide (5968x3230 → `1,2`); unknown dimensions keep all presets.
- Brightness names: 96 → `Sun blast`, 12 → `Candlelit`.
- `parseDisplays` parses the JSON list and counts enabled; invalid JSON → empty.

### `network-captive-portal-test.sh` → `shell/plugins/panels/network/Model.js`, `Panel.qml` — visible: partial
- Native connectivity maps Unknown/None/Portal/Limited/Full → same-named lower-case states for wifi and ethernet; unknown → `unknown`; with probing disabled always `unknown`; disconnected → `none`.
- Portal/limited use blocked icons `󰤩` (wifi) / `󰈂` (ethernet); disconnected stays `󰤮`; full/unknown/none keep signal-strength icons and `󰈀` for ethernet.
- Captive portal entry point is `http://ping.archlinux.org/nm-check.txt` — plain HTTP, fixed host, no credentials — opened via `omarchy-launch-browser` exactly once.
- QML fixture: portal → recovery → checks disabled → outage → disconnect → keyboard navigation all pass.
- Driver: QEMU NAT never reports a portal; ethernet icon `󰈀` visible (folded into `network-panel-ethernet-only-in-vm`).

### `network-manager-transition-test.sh` → `bin/omarchy-dns`, `install/hardware/network.sh` — visible: partial
- `omarchy-dns` writes `NetworkManager/conf.d/20-omarchy-dns.conf` with `[global-dns-domain-*]`, toggles `ipv4.ignore-auto-dns`, runs `nmcli device reapply`, then `nmcli general reload conf` and `reload dns-full` separately (never combined), never restarts `systemd-networkd`.
- Hardware setup retires archinstall networkd (`systemd-networkd.service/.socket`, `20-wlan.network`, marker `omarchy-networkd-retired`).
- Driver: NetworkManager active and networkd disabled on stock (in `stock-system-policy-invariants`).

### `network-password-test.sh` → `bin/omarchy-network-password` — visible: partial (Wi-Fi only)
- Prints the raw WPA PSK (no QR escaping); prints WEP keys (key-mgmt `none` + wep-key).
- Open network → stderr `This network has no password`; enterprise → `Enterprise Wi-Fi has no shareable password`.
- Absence path: no Wi-Fi in QEMU.

### `network-qr-test.sh` → `bin/omarchy-network-qr` — visible: partial (Wi-Fi only)
- Builds `WIFI:T:WPA;S:<ssid>;P:<psk>;;` escaping `\ ; , :`, passes the payload via stdin (never argv), prints a compact 0/1 matrix; `--meta` prefixes `meta\t<iface>\t<security>\t<ssid>`; without argument detects the connected Wi-Fi device.
- Open → `T:nopass`, hidden → `H:true`, WEP → `T:WEP`; enterprise → `Enterprise Wi-Fi cannot be shared with a password QR code` and `qrencode` never runs.

### `network-test.sh` → `shell/plugins/panels/network/Model.js`, `Panel.qml` — visible: yes (network panel)
- IPC `toggleNetwork` exposed; panel owns its IpcHandler (`manageIpc:false`).
- Bar click only calls `open()` (no second refresh); scanner only enabled while the panel is open; deferred scan restart re-checks `opened` and is cancelled on close; scanner ownership released on device replacement and on `Component.onDestruction`.
- Row disconnects go through guarded `disconnectRow(ssid)`.
- Parses bar status (`wifi\tCafe WiFi\t78\t5200`), header speeds (`1000`→`1gbit`, `2500`→`2.5gbit`), bands (2462→`2.4ghz`, 5200→`5ghz`, 6455→`6ghz`, 18300→`18.3ghz`), ethernet header `100mbit`.
- Decodes `iw` SSID escapes (UTF-8, emoji, edge spaces, single backslash decode, invalid escapes preserved, control bytes left escaped).
- Throughput deltas and ping latency averaging, packet loss %, reset on interface change; formats `1.5 KB`, `1.5 KB/s`, `2.5 ms`, `25 ms`, `Timeout`, `--` before first sample, `0%`.
- Wi-Fi rows sort connected → known → other with section titles `KNOWN NETWORKS` / `OTHER NETWORKS`; rows are primitive projections `{connected,known,ssid,signal,security}`.
- Credential prompts for every security type except Open and OWE; failure copy `Passphrase required` / `Wrong password` / `Failed to connect`; reprompt only when credentials are required; forget offered for known disconnected networks (lock icon hidden for passwordless until forget shows).
- Band labels `2.4ghz`/`6ghz`/`Auto`; section title `WI-FI BAND: 2.4GHZ` under auto, plain otherwise; `parseBandStatus`; hero keeps ethernet speed, omits Wi-Fi band.
- Driver: `network-panel-ethernet-only-in-vm` (ethernet path; `Timeout` for internet ping because QEMU NAT drops ICMP).

### `nightlight-test.sh` → `shell/plugins/services/nightlight/NightlightModel.js`, `bin/omarchy-toggle-nightlight` — visible: yes
- Temperature parsed from `hyprctl hyprsunset temperature`; unreachable → unknown (disabled); <6000 → enabled, 6000/6500 → disabled.
- `--status` prints JSON `{"enabled":…}` matching the above; toggle sets 4000 from daylight and 6500 back; nudges `omarchy-shell -q nightlight refresh`; never refreshes indicators itself.
- Driver: `nightlight-toggle-status`.

### `nopasswd-sudo-expiry-test.sh` → `bin/omarchy-sudo-passwordless`, `etc/tmpfiles.d/omarchy-nopasswd-sudo.conf` — visible: yes
- Enabling writes `/etc/sudoers.d/99-omarchy-nopasswd-<user>` = `<user> ALL=(ALL) NOPASSWD: ALL`, arms `sudo systemd-run --on-active=15m … rm -f -- <grant>`, and only then prints `…automatically disable in 15 minutes`.
- If the timer cannot be armed the grant is revoked (`Failed to schedule passwordless sudo expiry. Revoking access now.`) and `ENABLED` is never printed; a failed timer update also revokes the existing grant and never says `timer updated`.
- One tmpfiles rule removes every `99-omarchy-nopasswd-*` at boot only (`--boot`), leaving other sudoers files alone.
- Driver: `passwordless-sudo-toggle-from-menu`, `passwordless-sudo-expires-on-its-own`, `passwordless-sudo-grant-cleared-by-reboot`.

### `notification-send-test.sh` → `bin/omarchy-notification-send` — visible: yes
- Issues a D-Bus `Notify` call (never `notify-send`) with app name (default `omarchy-action`), icon (`-i`), summary, body, expire (`-t`), `urgency` hint (critical → 2), `omarchy-glyph` hint, `omarchy-exec-argv` JSON hint.
- `-p` prints the returned id; `-r <id>` replaces in place; options may follow the two positionals; `--flag=value` accepted; urgency set once.
- No `--exec` → no click hint.
- `--exec prog -- args…` is a literal argv vector: metacharacters and spaces stay data.
- A forged `--hint=string:omarchy-exec-argv:…` as headline or body is inert text; in option position it is rejected as an unknown option (`--bogus` too).
- A positional literally `--exec` is text; the real trailing `--exec` wins; a single quoted whole command, `--exec` with nothing, or an empty program are rejected.
- A dash-leading body (`-50% off today`) is content; a known flag after the headline (`-t 3000`) is still an option.
- Driver: `notification-send-click-command-is-literal-argv`.

### `notifications-test.sh` → `shell/plugins/notifications/NotificationLogic.js`, `NotificationCard.qml`, `Service.qml` — visible: yes
- Chromium-derived apps detected by name/icon; their leading origin link/text is stripped from the body.
- `<img>` tags are stripped in every form Qt would honour: plain, spliced inside `<img`, doubly nested, twin outer tag, whitespace or U+0085 after `<`, unterminated, uppercase; the strip runs after the newline→`<br/>` rewrite (`styledBody`) so a split tag cannot revive; the card binds `styledBody` and never rewrites newlines itself.
- Other body markup (`<b>`, `<a>`) is kept.
- Glyph-prefixed summaries detected; glyph-only single-line toasts render compactly; bodies/images use the large icon slot.
- DND bypass only for app `omarchy-action` or critical `notify-send`; critical from other apps and normal notify-send do not bypass; `omarchy-menu-keybindings` is a normal app.
- `parseExecArgv` accepts only a non-empty JSON array of strings whose program is present and not dash-leading; everything else → null (fail closed); argv rides on snapshots as raw JSON.
- Popup placement clears a top bar (top margin) or right bar (right margin), ignores bottom/left; anchors stay top-right.
- Snapshots are stable (`summary` stringified); in-place replacement keeps id/timestamp/file name (`<ts>-<id>.json`) and takes new content; `popupRowChanged` ignores identity fields.
- Settings parse `dnd`; legacy files with `pending/past` flagged; invalid JSON flagged.
- History = archived popup files: newest first up to `historyLimit: 10`, replayed with standard lifetime and no deadline; toasts still on screen replay from memory once.
- Popup files serialise to one line; default urgency normal; popups keep expire timeouts; file-backed images are copied into `state/notifications/images/<ts>-<id>-appIcon` (never `image://`), themed icon names left alone, no re-copy on restore.
- Restore never dedups ids across server generations, tolerates a torn write, never restores expired popups (critical never expire), honours restore-reset deadlines.
- Only the argv click survives a shell restart; legacy `exec` shell strings are dropped (inert click) rather than re-split.
- Service.qml wiring: history dir under `stateDir/notifications/history/`, archive by `mv`, trim with `head -n -$limit`, drop image copies with trimmed entries, copies images before JSON, bounded copy via temp (`timeout 5 head -c 5242881`), DND-silenced notifications written straight to history and held until written, orphan image sweep, replay carries live toasts, watches for in-place updates and rewrites row+file, restarts the countdown on update, queued history reads, restores popups on startup, protects restored rows from id collisions, runs the click argv itself (`Util.execArgv`), `clear` IPC forgets history, no in-memory history models.
- Driver: `notification-body-markup-sanitized`, `notification-dnd-bypass-and-history`.

### `nouveau-cursor-test.sh` → `install/user/hardware/fix-nouveau-cursor.sh` — visible: no (nouveau only)
- With `Kernel driver in use: nouveau` appends `no_hardware_cursors = true` to `~/.config/hypr/looknfeel.lua` once (idempotent); skipped for other drivers and when `OMARCHY_NVIDIA_MODPROBE_CONFIG` (proprietary NVIDIA) exists. Absence path only.

### `nvidia-kms-hook-test.sh` → `etc/mkinitcpio.conf.d/omarchy_hooks.conf` — visible: no (host tooling)
- Baseline HOOKS contain `kms`; an NVIDIA-only display controller with early `nvidia nvidia_modeset nvidia_uvm nvidia_drm` drops only `kms`; without early modules, with unset MODULES under `set -u`, on hybrid (AMD iGPU + NVIDIA), with only an NVIDIA audio function, empty PCI tree, or unreadable PCI devices → `kms` kept.

### `omarchy-kernel-migration-test.sh` → `migrations/1789325478.sh`, `bin/omarchy-migrate`, `etc/limine-entry-tool.d/omarchy-defaults.conf` — visible: partial (after update)
- On `linux`/`linux-lts`/`linux-zen`/`linux-ptl`/`linux-omarchy-ptl-novrr-mm` installs `linux-omarchy` + headers, keeps the old kernel, sets `BOOT_ORDER="linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"` in the central limine config.
- Skips `linux-t2` systems (even with other kernels), a running T2 kernel, and ARM; skipped systems change nothing and get no marker.
- Users who completed the superseded PTL migration get the renamed one as pending with fresh machine+user markers.
- Preserves `KERNEL_CMDLINE` and unrelated settings; rebuilds via `sudo limine-mkinitcpio linux-omarchy`; records a marker; sets `omarchy-state set reboot-required`; repeat runs no-op; partial installs get missing headers; already-installed packages still get config repair and rebuild.
- Install failure leaves config untouched and no rebuild/marker; rebuild failure stays pending and is retried; a missing `linux-omarchy` limine-entry-tool entry fails the run until repaired.
- Only one `BOOT_ORDER=` written, first position, indented custom assignments cannot override; central config beats legacy drop-ins and `.pacnew` files (left in place); a missing central config is created.
- Driver: after `omarchy-update` on the 4.0.2 disk, `pacman -Q linux-omarchy` and `/etc/default/limine` BOOT_ORDER (NET/SLOW, folded into `omarchy-update-full-sequence` proof).

### `openclaw-onboard-test.sh` → `bin/omarchy-openclaw-onboard` — visible: yes but needs OpenClaw + keys
- Runs `openclaw onboard --flow quickstart --install-daemon --skip-ui`; a wizard lingering after the gateway answers is stopped and counts as success (<30s).
- An abandoned wizard passes its exit code through; a wizard exiting cleanly is waited for; the wizard runs in the foreground and reads stdin.
- Already-configured machine with an answering gateway is not onboarded again.
- Setup applied but gateway never answers → wizard stopped after the deadline, exit 1, diagnostic mentions `gateway status`.
- SIGTERM to the wrapper stops the wizard; a stale config does not arm the deadline, a config rewritten by this run does; an orphan gateway with no config does not end the wizard; an orphan holding the port is not mistaken for the unit (`systemctl --user show -p MainPID --value openclaw-gateway.service`).
- Driver: needs OpenClaw install + provider key (NET/SLOW, interactive) → Gaps.

### `osd-test.sh` → `shell/plugins/osd/OsdModel.js` — visible: yes (OSD)
- `iconFor('',0)` = muted icon; `volume-high` alias; `logout` → `󰍃`; unknown explicit icons preserved; widest icon is a showable glyph.
- `stateForShow` builds progress state (`75%`, duration 800) and message state (`Paused`, default duration 1200 for `nope`).
- Driver: `omarchy-shell osd show …` (in `shell-ipc-contracts-from-terminal`).

### `panel-command-path-test.sh` → `shell/plugins/panels/**/*.qml` — visible: no (grep)
- No panel resolves omarchy helpers through `root.bar.omarchyPath` or `/bin/omarchy-` paths.

### `pkg-drop-test.sh` → `bin/omarchy-pkg-drop` — visible: partial
- Runs `pacman -Rns --noconfirm` only on exact installed names, ignoring providers/virtual names and duplicate arguments.

### `plugin-add-test.sh` → `bin/omarchy-plugin-add` — visible: yes (terminal)
- Refuses a manifest id already installed under another directory: `plugin id 'acme.same' is already used by …`, leaving no target.
- Transport helpers `ext::…`, `fd::17` → `names a git option or transport helper`, never reaching `git clone`; `ext://`, `gcrypt://` → `which Omarchy does not clone from`.
- Option-shaped URLs on argv (`-oProxyCommand=x`, `--upload-pack=x`) die in the option parser (unknown add option); via the interactive `gum input` prompt the guard's dash arm rejects them.
- Legitimate `https://`, `git@host:`, `ssh://`, `git@[ipv6]:` URLs reach `git clone`.
- Driver: `plugin-add-refuses-transport-helpers-and-duplicate-ids`.

### `plugin-auth-boundary-test.sh` → `shell/shell.qml`, `shell/plugins/bar/Bar.qml`, `shell/services/PluginShellApi.qml`, `shell/services/AuthServiceStore.js`, `shell/plugins/services/idle/Service.qml` — visible: no
- Third-party and authentication services are detached from the host object tree; auth services live in `AuthServiceStore`; classification survives manifest mutation and teardown; keepLoaded auth services survive rescans.
- Every third-party entry point receives a scoped shell facade; replacement bars cannot manufacture another plugin's facade (`pluginShellForBarEntry` only, no `pluginShellForId`); bar config is a detached snapshot on inject and update.
- Third-party widgets get a bar facade with only their own click targets; registries are snapshots; ownership stamped by host; auth isolation follows host-stamped capabilities; custom bar modules keep settings identity.
- Facade sync is bounded (bindings for scalars, pruned caches); manifest capability changes revoke cached facades; bar lifecycle/config mutation validate the current manifest.
- Cloned idle services get scoped config; built-in clones may only summon their own auxiliary UI (`omarchy.media → omarchy.osd`, `omarchy.network → speedtest, wifiqr`); service proxies resolve enabled clones; cloned widgets cannot reach their service via the source id from a replacement bar.
- Quickshell runtime fixture passes.

### `plugin-clone-test.sh` → `bin/omarchy-plugin-clone`, `bin/omarchy-plugin-remove` — visible: yes
- Cloning `omarchy.clock` copies `manifest.json`, `BarWidget.qml`, `Panel.qml`, `Model.js` into `~/.config/omarchy/plugins/<user>.clock`, keeps local imports, preserves the runtime IPC id `omarchy.clock` in code, rewrites manifest to `id: <user>.clock`, `name: My Clock`, `clonedFrom: omarchy.clock`.
- Enables the clone (`omarchy-plugin-enable <user>.clock`) and notifies `Editing Cloned Plugin` / `Original plugin has been replace by clone.` (sic).
- Clones legacy string-form bar entries, multi-kind plugins (`omarchy.menu` keeps `["menu","bar-widget"]`), flat bar plugins (`active-window`, `indicators` with `indicators/*.qml`, `tray` with `TrayModel.js`), full bars (`omarchy.bar`) and ordinary plugins (`omarchy.background`).
- Removing an enabled clone disables it first (`setPluginEnabled <id> false`) and reports `Restored omarchy.menu.`.
- `--edit` opens the clone in `$EDITOR`.
- Refuses user plugins (built-in only), a custom id, `--replace`-style bar options, no source id; a failed discovery removes the partial clone.
- Driver: `plugin-clone-enable-remove-roundtrip` (clone id will be `prime.clock`).

### `plugin-enable-test.sh` → `bin/omarchy-plugin-enable` — visible: yes
- One shell mutation `shell enablePlugin <id> {"section":"right"}` / `{"before":"omarchy.weather"}` / `{}`; placement for a full bar is rejected.
- Driver: `plugin-enable-placement-and-bar-put`.

### `plugin-registry-contract-test.sh` → `shell/services`, `shell/Commons` — visible: no
- Quickshell registry fixture passes (`.ok == true`).

### `plugins-test.sh` → `shell/plugins/**/manifest.json`, `shell/shell.qml` — visible: no
- Every top-level plugin dir and every `panels/`/`services/` subdir has a manifest at discoverable depth; manifests are schema 1 with id/name/version/description, `omarchy.` namespace, unique safe ids, non-duplicated supported kinds, matching entry points that are relative, inside the plugin, and exist; `keepLoaded` boolean; bar widgets carry displayName/description/category/allowMultiple and a valid `defaultSection`; sibling `*.manifest.json` are bar widgets; `clonePaths` are safe, existing, unique.
- `omarchy.active-window` defaults left, `omarchy.dropbox` right, `omarchy.media` centre fallback; `omarchy.lock/idle/polkit/notifications/media` are `keepLoaded`; `unloadPluginServices` honours keepLoaded; `_syncServices` drops disabled services.

### `plugin-validate-test.sh` → `bin/omarchy-plugin-validate` — visible: yes (terminal)
- Each kind requires its entry point: `kind '<kind>' requires an 'entryPoints.<key>' to load`; a plugin satisfying every declared kind passes, half-satisfied fails naming the kind.
- `barWidget.defaultSection` accepts left/center/right, refuses others: `'barWidget.defaultSection' must be left, center, or right`.
- Unknown kinds are left alone; a missing entry-point file → `entry point file not found`.
- Driver: `plugin-validate-manifest-contract`.

### `plymouth-set-test.sh` → `bin/omarchy-plymouth-set`, `bin/omarchy-plymouth-set-by-theme`, `bin/omarchy-plymouth-reset`, `bin/omarchy-refresh-plymouth`, `bin/omarchy-refresh-sddm`, `bin/omarchy-launch-floating-terminal-with-presentation`, `default/plymouth`, `default/sddm/omarchy`, menu `style.unlock` — visible: yes (Style → Unlock; boot splash)
- The publish allowlists equal the packaged asset sets exactly (plymouth: bullet/entry/lock/logo/omarchy.plymouth/omarchy.script/preview-unlock/progress_bar/progress_box + logos/oma.png; sddm: Main.qml/bullet/entry-failed/entry/lock-failed/lock/logo + metadata.desktop/theme.conf).
- A symlinked logo is refused with a message containing `symlink`; running as root is refused (`as your user`, `not under sudo`).
- The `style.unlock` action passes the picked theme name whole (`a';id;'b`, `$(…)`, backticks, spaces, `-a`) — never as shell — to `omarchy-plymouth-set-by-theme`; `default` runs `omarchy-plymouth-reset` instead.
- Under umask 022/027/077 every published file is a regular mode-0644 file, the selected logo lands in both themes, SDDM `Main.qml` gets the background colour, `omarchy.script` gets `Window.SetBackgroundTopColor(0.114, 0.125, 0.129);`, packaged extras unchanged, no user-writable staged pathname reaches a privileged command, directory modes preserved, `plymouth-set-default-theme omarchy` and `mkinitcpio -P` run, no temp files left.
- Migrated destinations that are symlinks are replaced without following them; legacy `logo.svg` removed.
- White theme (`#ffffff` on `#000000`) keeps a white SDDM background (no double-substitution) and no `__OMARCHY_SDDM_` token.
- A source swapped to an unreadable file or a directory right before open aborts before sudo (`no longer a regular file`).
- Planted caller-owned stage content never reaches the boot theme; a user-owned packaged source tree, a symlinked packaged asset, a user-owned `OMARCHY_PATH`, a stale/writable/symlinked/user-owned `/etc/omarchy.conf` authorization are all refused (`refusing to publish`, `user-owned`, `omarchy dev link`, naming the conf, never blaming `/`); only a regular root-owned conf naming the exact checkout publishes.
- Symlinked or writable destination parents/ancestors, user-owned destination directories, single user-owned or world-writable packaged assets, writable packaged directories are refused before any change.
- An empty logo or one larger than 64 MiB is refused.
- `omarchy-refresh-plymouth` republishes the packaged set (including `logos/oma.png`), leaves SDDM alone, activates and rebuilds; `omarchy-refresh-sddm` republishes SDDM only, never touches Plymouth or the initramfs.
- `omarchy-plymouth-reset` is safe/idempotent on a fresh install, repairs migrated installs, recreates missing files, stops before SDDM when Plymouth refuses (one root transaction) and leaves SDDM untouched when the SDDM destination is unsafe.
- Driver: `unlock-screen-theme-refusals`, `unlock-screen-theme-applies-on-reboot`.

### `pointer-move-gate-test.sh` → `shell/Ui/PointerMoveGate.qml`, `shell/Ui/qmldir` — visible: yes (menu hover)
- Exported as `PointerMoveGate 1.0`; `referenceItem`; threshold 1px; `reset()` disarms and disallows the initial sample; `allowInitialSample()` opts in once; compares in target coordinates; sub-threshold movement accumulates; runtime fixture passes.
- Driver: menu does not select the row under a stationary pointer when opened (part of `menu-hides-hardware-rows-absent-in-vm` hints).

### `polkit-test.sh` → `shell/plugins/polkit/PolkitModel.js` — visible: yes (polkit dialog)
- Fingerprint prompts detected (`Swipe your finger`, `fprintd`), password prompts not.
- Standard pkexec message shortens to `Authorize running '/usr/bin/true'`; custom messages preserved.
- Fingerprint configured detected from PAM config (`pam_fprintd.so`), even behind a clamshell gate; absent otherwise.
- Driver: `polkit-prompt-labels-pkexec`.

### `power-present-test.sh` → `bin/omarchy-power-present` — visible: no (no power supply in QEMU)
- Exit 0 when any `type` Mains or USB supply is `online=1`; exit 1 when all offline. Absence path: exit 1 in QEMU.

### `powerprofiles-set-test.sh` → `bin/omarchy-powerprofiles-set`, `bin/omarchy-powerprofiles-init`, `shell/plugins/services/battery/Service.qml`, `shell/plugins/menu/Menu.qml` — visible: partial
- `ac <profile>` stores `state/ac` and applies; `ac` alone restores; a failed `powerprofilesctl set` is reported and not persisted; `battery <profile>` stored separately; autodetect (busctl OnBattery) restores the right one; AC default is `performance`; `omarchy-powerprofiles-init` restores autodetected.
- Battery service applies profiles via `omarchy-powerprofiles-set <source>`; menu persists selections via `omarchy-powerprofiles-set autodetect`.
- Driver: `powerprofiles-set-without-battery`.

### `power-test.sh` → `shell/plugins/panels/power/Model.js`, `Panel.qml` — visible: no (no battery → widget absent)
- Profile index advance/clamp; key-value and profile parsing; icons; battery fraction clamp; charge threshold detection (PendingCharge, stalled charging); labels `Fully charged`/`On battery`/`Charging` (external power beats stale discharging); icons follow power source before state refresh.
- Right click toggles percentage (persisted via `updateEntryInline`), percentage placed before the icon, open-panel mark spans it, `togglePercentage` IPC, owns IpcHandler.
- Absence path: no `omarchy.power` widget in the bar without a battery.

### `preinstalls-test.sh` → `bin/omarchy-install-preinstalls`, `bin/omarchy-remove-preinstalls`, `bin/omarchy-install-hermes-cli`, `install/omarchy-base.packages` — visible: yes
- Install and Remove Preinstalls act on the same package set; every one is in `omarchy-base.packages`; the set includes `omacut`, `omacalc`, `omawrite`.
- Restore keeps the opt-out marker (`~/.local/state/omarchy/preinstalls-removed`) when the package transaction fails and clears it once packages are back.
- Declining the `gum confirm` changes nothing; confirming records the marker.
- The Hermes wrapper is deleted only when written by `omarchy-install-hermes-cli`; the desktop app's command, an official install, a wrapper merely mentioning the installer, or a foreign symlink are kept.
- Driver: `preinstalls-remove-and-restore`.

### `privileged-heredoc-test.sh` → every shell source under `bin/`, `install/`, `migrations/`, `default/` — visible: no (static scan)
- No privileged write (redirect, `tee`, `dd of=`, `install`/`cp`/`mv` hop, continued pipeline, `<<-`, `>>`, `>|`) embeds an install-time expansion through an unquoted heredoc unless annotated `# omarchy:heredoc-expands paths=… -- reason` naming exactly the path-shaped expansions.
- Fixture non-vacuity: udev/systemd `$HOME` shapes flagged; `paths=none` cannot hide a `$HOME` path, a special parameter, a one- or two-hop variable, or a shadowing reassignment; arithmetic `<<` and indented pseudo-delimiters do not confuse it; quoted delimiters, user destinations, no-expansion bodies, escaped runtime `\$VAR`, root-anchored paths, herestrings pass.

### `provisioning-groups-test.sh` → `install/config/docker.sh`, `install/config/browser-policy.sh`, `install/hardware/all.sh` — visible: partial
- Default install records neither `docker` nor `input` groups (with or without an install user); no `omarchy-browser-policy` group; `/etc/chromium/policies/managed` created root-owned 0755; the blanket `hardware/input-group.sh` grant is gone.
- Driver: `id -nG` on stock (in `stock-system-policy-invariants`).

### `provision-user-test.sh` → `bin/omarchy-provision-user` — visible: partial
- Provisions the `omarchy` and `diagnose-crash` skills as symlinks for Antigravity (`~/.gemini/config/skills/`), Hermes (`~/.hermes/skills/`) and every Hermes profile.

### `qml-text-format-test.sh` + `qml-text-format-scan.py` → every `shell/**/*.qml` — visible: yes (indirectly)
- Every `Text` whose `text:` binding is not a pure string literal declares `textFormat` (AutoText would promote `<img src=…>` from external data — notification summary, MPRIS title, window title, SSID, clipboard, weather — into a RichText fetch).
- Scanner catches plain dynamic bindings, block-comment-hidden braces, namespaced `QQ.Text`, one-line blocks, lookalike `textFormatEnabled`, component roots (same/next line), brace-on-next-line and trailing-binding forms (reported as unscannable), wrapped bindings, nested children not covering parents; leaves literals, declared textFormat, wrapped literals alone; fails when it reads no files or a directory is unreadable.
- Driver: `external-text-never-renders-as-html`.

### `refresh-config-test.sh` → `bin/omarchy-refresh-config` — visible: yes
- Copies `$OMARCHY_PATH/config/<path>` over `~/.config/<path>` and backs the old file up as `<file>.bak.<epoch>` containing the previous content.
- A path not shipped → stderr `Not a shipped user config: hypr/missing.lua`, exit 1.
- Driver: `refresh-config-backs-up-user-file`.

### `reminders-test.sh` → `shell/plugins/reminders/ReminderFlowModel.js` — visible: yes
- `validMinutes` accepts positive integers (trimmed), rejects 0, negatives, fractions, non-numeric → ``.
- `reminderArgs` = `[minutes, message]`, omits an empty message, empty for invalid minutes.
- Driver: `reminder-rejects-invalid-minutes`.

### `remove-ai-test.sh` → `bin/omarchy-remove-ai-{chatgpt,claude,lm-studio,t3-code,perplexity,grok-bot,openclaw}`, menu `remove.ai.ollama` — visible: yes (terminal)
- ChatGPT removal deletes `~/.config/Codex`, keeps `~/.cache/codex-runtimes` and `~/.codex`.
- Claude removal deletes `~/.config/Claude`, `~/.cache/Claude`, keeps `~/.claude`, `~/.claude.json`, `~/.cache/claude-cli-nodejs`, runs `pkill -x claude-desktop` first.
- LM Studio removal follows `~/.lmstudio-home-pointer` to delete the models home, deletes `~/.config/LM Studio`, refuses a pointer aimed at `$HOME`.
- T3 Code removal deletes `~/.t3`, keeps `~/.grok`, `~/.claude.json`, `~/.npm`, `~/.local/share/opencode`.
- Perplexity removal deletes `~/.cache/Perplexity`, `~/.cache/perplexity-rpc-server`, `~/.local/share/perplexity-rpc-server`, drops package `perplexity`; keeps `~/.config/Perplexity`, `~/.local/state/perplexity`, `~/.config/perplexity-flags.conf`, other-product caches; without a terminal never asks (gum not reached); on a terminal asks `gum confirm --default=false` and keeps data on No, survives missing dirs, keeps data when stderr is not a terminal, deletes on explicit Yes; refuses to run without `HOME`.
- Grok Bot removal deletes `~/.grokbot`, keeps `~/.grok`.
- `remove.ai.ollama` offered only `when: omarchy-pkg-present ollama`.
- OpenClaw removal deletes its gateway/node units (+ `.bak`, wants symlinks), launcher and icon; stops via `systemctl --user disable --now` + `reset-failed`; keeps `~/.openclaw` unasked without a terminal; prefers `openclaw gateway uninstall`/`node uninstall` when available (no manual disable); leaves systemd alone when no unit exists; aborts before `omarchy-pkg-drop openclaw` when the gateway cannot be stopped or systemd is unreachable.
- Driver: `remove-ai-claude-keeps-cli-state`, `remove-ai-perplexity-asks-before-user-data` (LM Studio `$HOME` refusal excluded as too destructive on an old build).

### `restart-shell-test.sh` → `bin/omarchy-shell`, `bin/omarchy-restart-shell`, `bin/omarchy-launch-shell`, `bin/omarchy-hyprland-session-locked` — visible: yes
- `omarchy-shell` IPC times out on a hung Quickshell → `omarchy-shell is not responding`; a starting shell (`Not ready to accept queries yet.`) → `omarchy-shell is not ready`; `-q` tolerates a starting shell; targets the newest live instance (`ipc -n -p`).
- Restart kills every matching instance from the session checkout (`kill -p <path>/shell --any-display`), launches exactly one fresh shell through Hyprland (`hl.dsp.exec_cmd("omarchy-launch-shell")`) with the session environment, and pings readiness in the session checkout.
- Refuses while the session is locked and the locker is alive: `Refusing to restart Omarchy shell while the session is locked.` (nothing killed or launched).
- A LOCK session whose lock client died is the failsafe: restart proceeds, re-acquires `lock lock`, and waits for `lock status` to report secure.
- Driver: `restart-shell-refuses-while-locked`, `lock-survives-shell-crash`.

### `retired-installer-artifacts-migration-test.sh` → `migrations/1788025225.sh` — visible: no (needs 3.x artifacts)
- Removes every historical body of `/etc/sudoers.d/first-run` (nine variants) with elevated `rm`, records a machine marker; keeps a file with a hand-written rule, another-user extension, cross-account cleanup path, no self-cleanup line, live spec under a commented continuation, `#include`/`#includedir`/`#1000`/`#-1000` directives, or a hand-written spec preceding a comment — byte for byte.
- Removes `/etc/sudoers.d/tsui` whether it points into a home or `/usr/bin`; keeps an administrator-extended or unrelated-command file.
- Removes `omarchy-plymouth-shutdown.service` whose `ExecStop` runs from a user home (or outside `/home`), disabling then removing then `daemon-reload` in that order and never `stop`; keeps a packaged-command unit, a commented-out home ExecStop, an `ExecStop=` reset; removes appended/continued/reset-then-set/EOF-continued home ExecStops.
- Reads sudoers files elevated; a failed `daemon-reload` persists a pending marker and retries; no-op when nothing retired; idempotent; fails (unmarked) when sudo cannot elevate with `An administrator must run omarchy-migrate`; a machine marker lets a non-sudo user complete.

### `row-border-stability-test.sh` → `shell/plugins/menu/Menu.qml` — visible: yes (menu rows do not shift on selection)
- Rows reserve the selected border insets (`rowReservedBorderLeft/Right`) and never bind margins to the live border state.

### `runtime-smoke-test.sh` → `shell/shell.qml` runtime, `bin/omarchy-shell`, `bin/omarchy-plugin-disable`, `bin/omarchy-bar`, `config/omarchy/shell.json` — visible: yes
- `shell listPlugins` lists metadata (`omarchy.menu/notifications/clock/osd` present; `kinds`, `enabled`, `canDisable`, `firstParty`, `clonedFrom` typed; sorted by name).
- Editing an installed plugin's manifest hot-reloads without a rescan; `summon omarchy.emojis` reaches an enabled clone of it.
- `listShellConfig` returns `version 1` with `bar.layout.left/center/right` arrays; `summon omarchy.menu {"menu":"apps"}` → `ok`; `summon missing.plugin` → `unknown`.
- IPC: `notifications ping/setDnd false` (`off`), `media ping/status`, `idle status`, `lock status`, `image-selector ping/open/cancel`, `osd ping/show/close` all answer; a `keepLoaded` service keeps in-memory state across `rescanPlugins` and is dropped when its manifest stops declaring a service; rescan does not strand the lock.
- Default bar renders every configured slot; visible: menu, workspaces, clock, weather, system-update, network, audio, monitor; centre order weather < system-update < indicators; direct panel IPC opens/closes audio/bluetooth/monitor/network/power.
- Each widget registers its IPC handler once per screen.
- `omarchy-plugin-disable omarchy.audio` removes it from config and geometry; `omarchy-bar put omarchy.keyboard-layout --after omarchy.clock` places it once and a second `put --section right` leaves it alone.
- Cloned media widget reaches its own service under the trusted bar; a cloned media service can summon the OSD; a replacement bar gets no generic factory, no entry facade, cannot reach a victim service, gets the media proxy, can summon only its own OSD target, cannot mutate the host bar config (initial or refreshed); manifest reload revokes cached capabilities.
- Driver: `shell-ipc-contracts-from-terminal`, `plugin-enable-placement-and-bar-put`.

### `screenrecording-test.sh` → `bin/omarchy-capture-webcam-list`, `bin/omarchy-hw-webcam`, `bin/omarchy-capture-screenrecording-with-webcam`, `bin/omarchy-capture-screenrecording`, `bin/omarchy-capture-webcam-resize`, `default/hypr/bindings/utilities.lua`, `default/hypr/apps/webcam-overlay.lua` — visible: partial
- Webcam list filters output-only/metadata nodes, collapses each device group to its first capture node, falls through to a later capture node, exits 0 when the trailing device is filtered; `omarchy-hw-webcam` succeeds only with a capture device.
- Picker without a capture device → notification `No webcam devices found`; with devices offers `Select Webcam` rows (`--width 520 --maxheight 520`) and starts `--with-desktop-audio --with-microphone-audio --with-webcam --webcam-device=<dev>`; auto-detection uses the first capture device.
- Webcam resize preserves aspect and corner anchor, adapts default size to monitor, ignores other windows, anchors to the recorded region file, falls back to the monitor for unusable regions, keeps three distinct sizes inside a narrow region; hotkeys `SUPER + ALT + code:34/35`; app id `WebcamOverlay-$SIZE`; window rules place each size at its final corner.
- Recording state file lives in `$XDG_RUNTIME_DIR/omarchy-screenrecord-filename` (never fixed `/tmp`), names the started recording; without a runtime dir falls back to `$XDG_STATE_HOME/omarchy/` (mode 700); the region file follows the same fallback.
- Driver: `screenrecording-webcam-picker-absence-and-state-file`.

### `screenshot-sanity-test.sh` → `bin/omarchy` (`capture screenshot fullscreen save`), shell runtime — visible: yes
- With the shell running, a fullscreen screenshot is a PNG whose top bar band is non-blank (≥3 colours, non-black pixels) and `omarchy.menu`/`omarchy.clock` geometry is visible.
- Driver: `screenshot-fullscreen-captures-bar`.

### `security-fido2-migration-test.sh` → `migrations/1787494718.sh` — visible: no (needs a registered key)
- Authfile path is the fixed literal `/etc/fido2/fido2`, named once; no authfile → no escalation.
- A user-owned authfile is repaired by `sudo mktemp <authfile>.new.XXXXXX`, `sudo install -T -m 644 -o root -g root`, `sudo mv -Tf` (new inode, never `chown`), keeping the credential, mode 644, one stage cleaned; repairs regardless of mode, wrong owner, wrong group, wrong mode; settled root:root 644 no-ops.
- Malformed (`A/BCDE`) or nonregular mktemp output aborts before install/mv (nonregular cleaned only via `rm -f -- <stage>`, never recursively); install or mv failure cleans the exact stage and leaves the live inode.
- A symlinked, dangling, or directory authfile is not repaired and raises a critical notification `FIDO2 authfile needs attention` with glyph, headline and body as separate arguments; notification failure does not abort.
- An authfile hidden behind a mode-000 `/etc/fido2` is found (`sudo test -e`), the directory reopened to 755 and repaired; an empty inaccessible directory keeps its mode and is never touched; no directory → no escalation.

### `security-fido2-remove-test.sh` → `bin/omarchy-remove-security-fido2` — visible: yes (terminal)
- `authdir=/etc/fido2` named once; a real directory is removed with `sudo rm -rf /etc/fido2`; a dangling symlink at the path is removed; a symlink is unlinked without touching its target; nothing there → no `sudo rm`.
- Driver: `fido2-setup-without-device` (removal path with no directory).

### `security-fido2-test.sh` → `bin/omarchy-setup-security-fido2` — visible: partial (needs a FIDO2 token)
- Paths named once each; an existing registration is left alone (no stage, no pamu2fcfg); a symlinked or directory authfile, or a symlinked `/etc/fido2`, is refused before `install -d`.
- Registration pipes `pamu2fcfg` into `sudo tee <root mktemp stage>` (never a caller-owned temp file), `sudo chmod 644`, `sudo mv -Tf` atomically, no `rm` on success, authfile mode 644 with the credential.
- chmod failure, mv failure, pamu2fcfg failure (pipefail), or an empty credential abort, clean the exact stage and publish nothing; malformed/nonregular mktemp output is rejected before tee/chmod/mv/rm.
- Absence path: `No FIDO2 device detected. Please plug it in (you may need to unlock it as well).`

### `setup-form-test.sh` → `install/provisioning/setup-form.sh` — visible: no (installer TUI; `mint` covers the install)
- Status contract `OMARCHY_FORM_BACK=1` (Esc), `OMARCHY_FORM_SIGNAL=130` (Ctrl+C); English (US) leads and is preselected.
- Keyboard prompt maps label → keymap (`German`→`de`); username rejects malformed/reserved/taken names with the exact notices; password rejects mismatch/blank; identity fields skippable; hostname validated with the exact notice and defaults when empty; timezone preselects the geo guess, falls back to `gum filter`, defaults to UTC.
- Every prompt survives Esc/Ctrl+C under `set -e` and returns the status instead of dying.

### `setup-security-sshd-test.sh` → `bin/omarchy-setup-security-sshd` — visible: yes (terminal)
- With `--key=<pubkey>` writes `/etc/ssh/sshd_config.d/10-omarchy-hardening.conf` containing `PasswordAuthentication no` and `KbdInteractiveAuthentication no`, reloads `sshd.service`, prints `Password logins are off`; accepts OpenSSH 9.x lowercase `sshd -T` output.
- If password auth remains effective or `sshd -t` rejects the config: fail, remove the drop-in, never reload, never claim success.
- Driver: `sshd-setup-hardens-password-logins`.

### `shell-ipc-display-test.sh` → `bin/omarchy-shell` — visible: partial
- Recovers a missing `WAYLAND_DISPLAY` from `$XDG_RUNTIME_DIR/wayland-*`; keeps an existing one.
- Driver: `env -u WAYLAND_DISPLAY omarchy-shell shell ping` (in `shell-ipc-contracts-from-terminal`).

### `shell-launch-test.sh` → `shell/Commons/Util.qml` — visible: no
- `execDetached` runs commands through `bash -lc` (login shell).

### `sleep-lock-test.sh` → `bin/omarchy-system-sleep-lock`, `etc/systemd/logind.conf.d/20-inhibit-delay.conf` — visible: partial
- Requests `lock lock` first, runs clamshell reconciliation (bounded), then polls `lock status`; exits 0 once `secure:true`.
- A never-securing shell fails within budget + one poll interval, keeps polling until the deadline; a failed lock request is retried until it lands, then stops; an observed `pending:true` lock is not re-requested.
- A `missing-pam` refusal fails fast without polling, warns `did not lock before suspend` (notification) and logs `suspending without a secure lock`.
- Budget derives from logind's `InhibitDelayMaxSec` (short window → ≤1.3s), falls back conservatively when unreadable, caps a huge window (`budget_cap_ms` < shipped window).
- Driver: `sleep-lock-secures-session` (lock happens; real suspend cannot be resumed by the driver).

### `sleep-monitor-test.sh` → `bin/omarchy-system-sleep-monitor` — visible: no
- On a `PrepareForSleep true` signal runs `omarchy-system-sleep-lock`, releases the inhibitor promptly (<2s), reaps its `dbus-monitor` producer; terminating the monitor also cleans the producer.

### `snapper-test.sh` → `default/snapper/root`, `etc/limine-entry-tool.d/omarchy-defaults.conf`, `config/autostart/limine-snapper-notify.desktop`, `install/config/snapper.sh`, `install/config/all.sh`, `bin/omarchy-apply-system`, migrations, omarchy-pkgs/omarchy-iso checkouts — visible: partial
- Template: `NUMBER_CLEANUP="yes"`, `NUMBER_LIMIT="5"`, `TIMELINE_CREATE="no"`, no `TIMELINE_CLEANUP/LIMIT_*`; Limine `MAX_SNAPSHOT_ENTRIES=6`.
- Limine Snapper warning notifier autostart is `Hidden=true`; its migration writes the override, `daemon-reload`s and stops the active watcher.
- `snapper.sh` installs the template to `/etc/snapper/configs/root`, writes `SNAPPER_CONFIGS="root"`, disables `snapper-timeline.timer`, enables `snapper-cleanup.timer limine-snapper-sync.service`; system setup runs the config phase; the service migration repairs only broken services and never overwrites custom retention.
- Packaging/ISO: omarchy-settings bundles the template; omarchy depends on `snapper`/`limine-snapper-sync`; the ISO does not create its own Snapper config and the manifest enables cleanup, not timeline.
- Driver: `stock-system-policy-invariants`, `snapshot-create-lists-number-snapshot`.

### `snapper-timeline-leak-test.sh` → migration "timeline snapshots leaked by earlier defaults" — visible: partial
- Deletes leaked `timeline` snapshots in batches of 20 (`snapper -c root delete 1 … 20`), the final partial batch too, never `number`/other snapshots; a failed batch (DBus timeout) does not abort and the remainder is reported (`45 snapshots could not be deleted`); skips `TIMELINE_CREATE="yes"` setups and machines without a root config; reads a root-only config as root.
- Driver: post-stock check that `sudo snapper -c root list` has no `timeline` rows (in `stock-system-policy-invariants`).

### `snapshot-create-test.sh` → `bin/omarchy-snapshot`, `bin/omarchy-update`, `bin/omarchy-upgrade-to-quattro` — visible: yes
- Snapper installed but no configs → exit non-zero, stderr `No Snapper configs found`, no `create` invented.
- With `root` configured → `snapper -c root create -c number -d <version>` and `snapper -c root cleanup number`.
- Snapper absent → exit 127; update and quattro upgrade ignore only 127 (`omarchy-snapshot create || (($? == 127))`); the upgrade prints `Continuing the upgrade without a snapshot`.
- Driver: `snapshot-create-lists-number-snapshot`, `snapshot-create-fails-loudly-without-config`.

### `sshd-hardening-migration-test.sh` → `migrations/1788124236.sh` — visible: partial
- No-op (no sudo) when sshd is neither enabled nor active, or already hardened.
- Without a usable authorized key (missing, malformed, private key pasted) an enabled sshd is disabled (`sudo systemctl disable --now sshd.service`) and no drop-in written; a symlinked authorized_keys with a valid key is hardened, not disabled; an unreadable file or group-writable home (StrictModes) → nothing touched, no prompt.
- With a valid key: writes the drop-in, tightens `~/.ssh` to 700 and `authorized_keys` to 600, `sudo sshd -t`, `sudo sshd -T`, reloads an active daemon; an enabled-but-stopped daemon is hardened without starting.
- Ineffective or rejected config → removed, no reload, migration still completes; failed reload keeps the valid drop-in staged; missing privileges → stays pending (both harden and disable paths).

### `ssh-reconnect-test.sh` → `default/bash/fns/ssh-reconnect` — visible: yes (terminal)
- `_ssh_interactive` treats a plain destination, separated/glued option values, forwarding and `-o` options, `RemoteCommand=none` as interactive; configured `RemoteCommand`, a remote command (with or without `--`), or a missing destination as non-interactive.
- After ssh exits, stray terminal modes are reset (mouse/alt-screen/cursor escape sequence).
- A fast failure (<30s) does not reconnect; a dropped session prints `Connection lost` and reconnects, retrying while the server is down; a remote command exiting 255 is not replayed; redirected stdin does not reconnect; Ctrl-C during a retry stops the loop (rc 130).
- Driver: `ssh-reconnect-after-drop`.

### `sudo-docker-test.sh` → `bin/omarchy-sudo-docker` — visible: partial (menu row)
- Default mode answers from the socket: unreachable/missing socket → needs sudo (exit 0); reachable → no sudo (exit 1). `--configured` answers from the account's groups. The two disagree between enabling sudoless Docker and the reboot. Unknown flag → exit 2.
- Driver: menu `Setup → Security → Sudoless Docker` visibility (in `sudoless-docker-toggle-flags-reboot`).

### `sudoless-docker-posture-test.sh` → `bin/omarchy-provision-owner` (`user_groups`), `bin/omarchy-upgrade-to-quattro` — visible: partial
- First-boot `user_groups` always includes `wheel`, never `docker`, includes `input` only with `xpadneo-dkms` or `ydotool` installed; the Quattro upgrade never `usermod -aG docker`.
- Driver: `id -nG` (in `stock-system-policy-invariants`).

### `sudoless-docker-toggle-test.sh` → `bin/omarchy-remove-security-sudoless-docker`, `bin/omarchy-setup-security-sudoless-docker` — visible: yes
- Remove drops the group (`gpasswd -d <user> docker`), flags `~/.local/state/omarchy/reboot-required`, reboots on confirm, leaves the reboot to the user on decline, never prompts/reboots under `OMARCHY_DEFER_REBOOT=1`, no-ops when already out of the group.
- Setup adds the group (`usermod -aG docker <user>`), flags a reboot, reboots on confirm.
- Driver: `sudoless-docker-toggle-flags-reboot`.

### `synaptic-touchpad-test.sh` → `install/hardware/fix-synaptic-touchpad.sh`, `install/hardware/all.sh` — visible: no (hardware quirk)
- Runs during hardware setup; on a SynPS/2 device loads `psmouse synaptics_intertouch=1`; skips when psmouse does not resolve (chroot) or is already loaded; a failing modprobe never halts the install. Absence path only.

### `systemd-test.sh` → `default/systemd/user/{bt-agent,omarchy-sleep-lock,omarchy-migrate-notify,omarchy-fcitx5}.service`, `app.slice.d/10-oomd.conf`, `etc/systemd/oomd.conf.d/10-omarchy.conf`, `install/user/first-run/enable-user-units.sh`, `install/config/enable-services.sh`, `bin/omarchy-upgrade-to-quattro`, `bin/omarchy-restart-xcompose`, `default/hypr/autostart.lua` — visible: partial (`systemctl`)
- `bt-agent` has `ExecCondition=/usr/bin/systemctl is-active --quiet bluetooth.service` and `Restart=on-failure`.
- `omarchy-sleep-lock.service`: `ExecStart=/usr/bin/omarchy-system-sleep-monitor`, `After=dbus.socket wayland-session-waitenv.service`, `PartOf=graphical-session.target`, `ConditionEnvironment=OMARCHY_PATH` and `WAYLAND_DISPLAY`; first-run reloads and enables it; the Quattro upgrade repairs the legacy `%h/.local/share/omarchy/bin/...` unit by hash and `reset-failed`.
- No `omarchy-update-user-notify.path` and no unit watching `/usr/share/omarchy/migrations`; `omarchy-migrate-notify.service` is `WantedBy=` and `After=graphical-session.target`, enabled at first run; retired notifier units are not enabled.
- `omarchy-fcitx5.service`: `fcitx5 --disable notificationitem`, `Restart=always`, `After/PartOf/WantedBy=graphical-session.target`, `ConditionEnvironment=WAYLAND_DISPLAY`; `omarchy-restart-xcompose` `pkill -x fcitx5`; first-run enables it; not autostarted from Hyprland.
- oomd: only `app.slice` is a kill candidate (`ManagedOOMMemoryPressure=kill`, `ManagedOOMSwap=kill`), `DefaultMemoryPressureLimit=50%`, `DefaultMemoryPressureDurationSec=20s`, `systemd-oomd.service` enabled on new installs.
- Driver: `stock-system-policy-invariants`.

### `system-lock-test.sh` → `bin/omarchy-system-lock` — visible: yes
- Before locking, stops the screensaver in order: `pkill -x ttfx`, `timeout 1s pidwait -x ttfx`, then `pkill -f [o]rg.omarchy.screensaver`.
- Driver: `system-lock-closes-screensaver-first`.

### `system-power-test.sh` → `bin/omarchy-system-reboot`, `bin/omarchy-system-shutdown` — visible: yes
- Schedules `systemd-run --user --collect --quiet --on-active=2s --timer-property=AccuracySec=100ms systemctl reboot|poweroff --no-wall` first, then `omarchy-state clear re*-required`, `omarchy-hyprland-window-close-all`, `sleep 1`; if scheduling fails, aborts and touches neither state nor windows.
- Driver: `system-reboot-from-menu-schedules-cleanly`.

### `system-sleep-ownership-migration-test.sh` → `migrations/1788662350.sh`, `default/systemd/system-sleep/{keyboard-backlight,force-igpu}`, `default/systemd/system/supergfxd.service.d/delay-start.conf` — visible: no (hardware hooks)
- Fixes exactly one literal system-sleep dir and one supergfxd drop-in; replaces user-owned/writable hooks and drop-in with trusted root-owned copies (755/644), quarantining unknown content under a root-only `/var/lib/omarchy/migrations/…` dir (an open attacker fd cannot write through); idempotent; a failed `daemon-reload` persists a marker and retries; recognised legacy hook bytes (sha256 pinned) are upgraded without backups; force-igpu repaired regardless of GPU mode; safe administrator hooks (root-owned, non-writable, any group) and root-controlled symlink chains (including hidden behind root-only dirs, dangling below root-only dirs) are preserved without sudo; user-controlled symlinks, chains through user dirs, and dangling suffixes escaping to user paths are quarantined and replaced.
- `force-igpu` hook: no-op in Hybrid or without config; in Integrated records restore intent (mode 600), waits for asynchronous `supergfxctl` transitions, retains intent until Integrated is confirmed, bounds blocked requests, restores Integrated after pre-hibernate Vfio, handles both phases of suspend-then-hibernate.
- `keyboard-backlight` hook only acts in the hibernate phase (`brightnessctl -d <led> set 0`).

### `t2-hardware-test.sh` → `install/hardware/apple/fix-t2.sh`, `install/omarchy-other.packages`, `migrations/1785944594.sh`, `migrations/1786137597.sh` — visible: no (T2 Mac only)
- Fresh T2 setup: kernel params `intel_iommu=on iommu=pt pm_async=off mem_sleep_default=deep` (no `pcie_ports=compat`), both fans with `speed_curve=linear`, no `tiny-dfr`.
- Migration on T2 (lspci match survives a chatty lspci/SIGPIPE): updates limine params, adds one `[Fan2]`, disables/removes tiny-dfr, rebuilds boot image, records marker; idempotent; retries an interrupted rebuild without redoing completed steps; non-T2 systems untouched; the rerun migration repairs installs the SIGPIPE bug skipped.

### `t3code-install-test.sh` → `bin/omarchy-install-ai-t3-code` — visible: yes but NET
- Renders/publishes the current theme's `t3code.json` palette to `$T3CODE_HOME/userdata/themes/omarchy.json`, selects it (`T3 selected Omarchy`), opens the app (`Opening T3 Code`), respects a custom `T3CODE_HOME`; reuses an existing palette; a failed selection is visible, fails the installer, does not report success, and does not rewrite settings.

### `tailscale-receive-test.sh` → `bin/omarchy-tailscale-receive` — visible: yes but needs a tailnet
- Saves incoming files to the target dir, announces each with `-u critical`, images with `--image <path>`, others with a glyph; attaches `--exec xdg-open <path>` as literal argv (spaces intact); ignores unrelated downloads; renames clashes (`photo-1.png`); empties its `.omarchy-taildrop` staging dir.

### `tailscale-test.sh` → `shell/plugins/panels/tailscale/Model.js`, `Panel.qml` — visible: no (no tailnet)
- `toggleTailscale` IPC; IPv4/IPv6 filtering (100.64/10, fd7a:…); DNS name cleanup; status parsing (running, self IP, online non-Mullvad peers sorted, exit node flags, Taildrop capability from CapMap or legacy list, owner ids, `TaildropTarget` grading with same-owner fallback); Mullvad exit node list parsing and region grouping; stopped status; account parsing and labels; login plan reuses the daemon URL, requests `tailscale up` otherwise, ignores stale URLs; invalid JSON → `Status error`.

### `theme-install-guards-test.sh` → `bin/omarchy-theme-install`, `bin/omarchy-git-url-check`, `bin/omarchy-theme-remove` — visible: yes (terminal)
- URLs naming a git option (`-x`, `--upload-pack=…`) or transport helper (`ext::`, `fd::`, `ext://`, `fd://`, `gcrypt://`) are refused before git runs; a missing `omarchy-git-url-check` refuses rather than cloning.
- Derived names that climb (`..git`, `.git`), or would be shell syntax (`a';id;'b`, `$(id)`, backticks, spaces, leading `-`) → `Error: '<url>' does not give a usable theme name.`; underscore, dot, dash, plus, leading underscore accepted; scp-style `git@host:repo.git` and local `/srv/git:mirrors/…` derive the repo name; non-ASCII refused under both C and en_US.UTF-8; a dash inside the path is passed after `--`.
- An ordinary URL clones to `~/.config/omarchy/themes/<name>` and applies it.
- `omarchy-theme-remove ..`, `.`, `../../evil`, `.git` refuse before removing anything.
- Driver: `theme-install-refuses-hostile-urls-and-names`.

### `theme-staging-test.sh` → `bin/omarchy-theme-set`, `default/themed/*.tpl` — visible: yes
- A theme under `~/.config/omarchy/themes/<name>/.git` (installed) stages `colors.toml`, `light.mode`, `preview.png`, `backgrounds/*` images, `icons.theme`, `btop.theme`, `shell.toml`; never a symlink, `vscode.json`, or `.git`; `hyprland.lua`, `neovim.lua`, `gum_env.lua`, `kitty.conf`, `alacritty.toml`, `foot.ini`, `ghostty.conf` are regenerated from Omarchy templates (the theme's copies lose); stderr names the ignored files but not `README.md`.
- A symlinked `icons.theme` is refused; a legacy alacritty-only theme recovers its palette and loses the terminal config; an overlay on a stock theme repaints without adding Lua.
- A theme without `.git` (user-written) or a symlinked working copy keeps every file including its own `hyprland.lua` and `vscode.json`, with nothing reported.
- Theme names `..`, `.`, `../../evil` are rejected.
- Every `default/themed/*.tpl` is classified as denied-to-installed-themes or colour-only.
- Driver: `theme-install-strips-code-from-git-theme`.

### `timezone-test.sh` → `bin/omarchy-menu-timezone`, `etc/sudoers.d/omarchy-tzupdate` — visible: yes
- Sudoers rule `%wheel ALL=(root) NOPASSWD: /usr/bin/timedatectl ^set-timezone [A-Za-z0-9_+][A-Za-z0-9_+.-]*(/…)*$` (no bare wildcard, no tzupdate grant); the menu runs `sudo timedatectl set-timezone "$timezone"` (not pkexec, not an absolute path, not bare) and refreshes `omarchy-shell -q omarchy.clock refresh`.
- Driver: `timezone-change-without-password`.

### `tmux-alert-removal-migration-test.sh` → `migrations/1785189600.sh`, `config/tmux/tmux.conf` — visible: partial
- Removes the appended `# Alerts` hook block (all spellings, indented too) restoring the shipped config byte for byte, reloads tmux once, idempotent, keeps user hooks and blank lines, leaves unrelated configs alone, writes through a dotfile symlink.
- Unsets live hooks by index (`set-hook -gu after-select-window[0]`, `alert-bell[0]`, `client-focus-in[100]`), never a user's index, clears `@omarchy_unfocused_activity` on every window, skips a missing server.
- Strips `TmuxAlert` from `shell.json` (`items` and older `indicators`), keeps other indicators, drops a widget left empty, leaves already-empty lists, never restarts the shell or defers a restart.
- Driver: `~/.config/tmux/tmux.conf` has no `omarchy-tmux-alert` on stock (in `stock-system-policy-invariants`).

### `toggle-input-device-test.sh` → `bin/omarchy-toggle-input-device`, `default/hypr/toggles.lua`, `migrations/1787618700.sh` — visible: partial
- `touchpad off` stores the device name as data in `~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name` (never generated Lua), evals `hl.device({ name = "<quoted>", enabled = false })`; `on` clears; bare toggle flips; touchscreen uses the same path; XDG_STATE_HOME is ignored.
- Hostile names (quotes, the public `trackpad"})os.execute("~/calc&")--` PoC) are stored as data, Lua-quoted in eval, never executed by eval or reload; names with newlines are rejected and not persisted; enable clears state even with an invalid name; no device → error, no state.
- Migration recovers plain names from legacy generated Lua, discards hostile Lua, reloads Hyprland, keeps an existing name file, removes unreadable files, no-ops when done; reload excludes leftover legacy toggle Lua while applying the data disable.
- Driver: absence path (`no device found`) in `hardware-detectors-report-absence`.

### `toggle-test.sh` → `bin/omarchy-toggle`, `bin/omarchy-toggle-bar`, `bin/omarchy-toggle-fullscreen-desktop` — visible: yes
- `omarchy-toggle <name> [on|off|toggle]` creates/removes `~/.local/state/omarchy/toggles/<name>` idempotently; `omarchy-toggle-bar on/off` sets `toggles/bar-off`.
- `omarchy-toggle-fullscreen-desktop` hides bar and gaps together (`toggles/hypr/window-no-gaps.lua`), restores both, pulls a half-hidden desktop into full screen; `off`/`on` explicit.
- Driver: `toggle-bar-and-fullscreen-desktop`.

### `tray-menu-test.sh` → tray DBusMenu activation (quickshell fixture + mock SNI) — visible: no in QEMU (no tray app)
- Clicking a tray menu item sends the DBusMenu `clicked` event to the item.

### `tray-test.sh` → `shell/plugins/bar/widgets/TrayModel.js` — visible: no
- Items matched by id/title/tooltip; `dropbox` suppressed when the dedicated widget is in the layout, kept otherwise; `localsend` suppressed regardless; unrelated items kept.

### `unowned-system-paths-test.sh` → `bin/`, `install/`, `migrations/` vs omarchy-pkgs PKGBUILDs; `bin/omarchy-hibernation-setup`, `bin/omarchy-toggle-hybrid-gpu`, `default/systemd/system-sleep/force-igpu` — visible: no (static)
- No script writes a `/usr` path no package owns except the recorded allowlist (Yaru icon links, system-sleep hooks, browser extension dirs, chromium initial_preferences).
- Hibernation setup and hybrid GPU toggle stage privileged files as hidden siblings with `install -m … -o root -g root -T`, `mv -Tf`, never chmod after publish, never `cp -p`; install steps precede completion markers / config switches; `force-igpu` guards on the configured GPU mode.

### `update-available-test.sh` → `bin/omarchy-update-available` — visible: yes (bar indicator, terminal)
- Prints only the installed Omarchy package's update line (`omarchy …` or `omarchy-dev …`, preferring dev when both), ignores `omarchy-settings*` and other packages, exit 0; exit 1 quietly when no Omarchy package; exit 1 with `Omarchy is up to date` when none.
- A dev checkout: fetches upstream (`git -C <path> fetch --quiet`) and reports `omarchy-dev-checkout N new commit(s) on origin/quattro` (exit 0), `Omarchy is up to date` when current, uses cached state quietly when fetch fails.
- Driver: `update-available-and-status-indicator`.

### `update-dev-test.sh` → `bin/omarchy-update-dev`, `bin/omarchy-update` — visible: yes
- Package-backed `OMARCHY_PATH=/usr/share/omarchy` never runs git; a checkout does `git -C <path> pull --ff-only`; no upstream → skipped; not a git checkout → `OMARCHY_PATH is not a git checkout: <path>` and failure; `omarchy-update` includes the step.
- Driver: `version-and-dev-update-helpers`.

### `update-disk-space-test.sh` → `bin/omarchy-update-requires-free-space`, `bin/omarchy-update` — visible: yes
- Helper exits 1 below 10 GiB; the update (interactive or `-y`) stops before confirmation and snapshot with `You need at least 10 GiB free to safely update Omarchy.`; `OMARCHY_UPDATE_FORCE=1` skips the check silently; exactly 10 GiB passes; the normal prompt is `confirm Continue with update?`; an unparsable `df` silently continues.
- Driver: `update-refuses-low-disk-space`.

### `update-file-conflict-test.sh` → `bin/omarchy-update-system-pkgs`, `bin/omarchy-update-system-pkgs-when-conflicted` — visible: yes but needs a real conflict
- A `<pkg>: <path> exists in filesystem` conflict from `omarchy`/`omarchy-settings(-dev)` for an unowned path (checked with `pacman -Qo`) is moved to `$OMARCHY_REPLACED_DIR<path>` (outside its origin dir) and the upgrade retried once; owned paths, `(owned by …)` conflicts, optional `omarchy-*` packages, and unrelated packages stop the upgrade; glob characters and spaces in paths are literal; directories move too; existing quarantined copies survive; `mv -T` avoids nesting; nothing moves unless every conflict is healable; a failed retry restores files (including dangling symlinks) without re-invoking the handler and does not announce a restore when pacman already committed; the handler refuses a report handed to it outside an update; a clean upgrade runs one transaction.

### `update-keyring-test.sh` → `bin/omarchy-update-keyring` — visible: yes (NET)
- Healthy → `Keys are correct` and `sudo pacman -Sy --noconfirm archlinux-keyring` still runs; missing key+package → `recv-keys`, `lsign-key`, `omarchy-pkg-add omarchy-keyring`, then `Keys are correct`; failed recv-keys, failed reinstall, or failed final `--list-keys` → non-zero and never `Keys are correct`.
- Driver: `update-keyring-reports-keys-correct`.

### `update-lock-test.sh` → `bin/omarchy-update`, `bin/omarchy-update-lock`, `bin/omarchy-update-stay-awake` — visible: yes
- A second `omarchy-update` while the first holds `$XDG_RUNTIME_DIR/omarchy-update.lock` exits non-zero with `An Omarchy update is already running.` before snapshotting.
- The sleep inhibitor never inherits the lock fd and the update waits for it to stop; terminal updates validate sudo (`sudo -v`) and inhibit via sudo, never pkexec.
- Stay Awake: the update clears only its own state before restart handling, preserves a pre-existing choice; `stay-awake stop` with stale owner state preserves a newer user choice and never kills a reused PID.
- Driver: `update-refuses-while-another-update-runs`.

### `update-orphan-test.sh` → `bin/omarchy-update-orphan-pkgs` — visible: yes
- Non-interactive: lists orphans (`  old-lib`) and says `Re-run omarchy-update-orphan-pkgs in a terminal…`, never calls sudo/gum; no orphans → silent.
- Driver: `update-orphan-pkgs-defaults-to-keeping`.

### `update-package-conflict-test.sh` → `bin/omarchy-update-system-pkgs` — visible: yes but needs a real conflict
- `unresolvable package conflicts detected` on a terminal → one interactive retry without `--noconfirm`/`--ask`, keeping stdin and stderr on the pty; redirected stdout is still answerable; redirected stderr → not asked; headless → report `omarchy update` instead of hanging; `OMARCHY_UPDATE_UNATTENDED=1` never prompts; `OMARCHY_UPDATE_INTERACTIVE=1` cannot be requested directly (first attempt always `--noconfirm`).

### `update-pacman-guard-test.sh` → `bin/omarchy-update-pacman-guard` — visible: yes
- Blocks `pacman -Syu` and `--sync --refresh --sysupgrade` with a message pointing at `omarchy update` (`Woah partner...`, override `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`); quiet under `OMARCHY_UPDATE_PACMAN=1`, `OMARCHY_ALLOW_DIRECT_PACMAN=1`, or non-sysupgrade commands (`pacman -S firefox`).
- Driver: `pacman-direct-upgrade-guard`.

### `update-pacman-test.sh` → `bin/omarchy-update-pacman` — visible: no
- Composes `sudo env OMARCHY_UPDATE_PACMAN=1 [LC_ALL=…] systemd-run --scope --quiet --collect pacman …` (scope only on a systemd-booted host).

### `update-pkg-prune-test.sh` → `bin/omarchy-update-pkg-prune`, `bin/omarchy-update` — visible: partial
- Runs `paccache -rk2` (keeps a rollback version); failure warns `Could not prune the package cache` without aborting; prune runs before the snapshot and before the package update.

### `update-sequence-test.sh` → `bin/omarchy-update` — visible: yes
- Full order: lock, requires-free-space, [confirm], pkg-prune, snapshot, stay-awake, dev, keyring, system-pkgs, migrate, hook, aur-pkgs, mise, orphan-pkgs, analyze-logs, status, stay-awake, restart. `-y` marks `OMARCHY_UPDATE_UNATTENDED=1`; a confirmed update does not; a failed package upgrade stops before migrate/hook/aur/restart.
- Driver: `omarchy-update-full-sequence`.

### `update-status-test.sh` → `bin/omarchy-update-status` — visible: yes (bar)
- Updates remain → `omarchy-shell -q omarchy.system-update refresh`; none → `… clear`.

### `upgrade-to-quattro-test.sh` → `bin/omarchy-upgrade-to-quattro` — visible: no in QEMU (3.x → 4 upgrade)
- Snapshot before the first mutation; `pacman -Syy` (forced refresh) before keyrings; final `pacman -Syu --needed`, AUR, mise, update-available; migrations after the final upgrade, verified via `omarchy-migrate --pending` (fail on failed/pending/unverifiable); first-run completed as one lifecycle with legacy markers migrated; survives a packaged tree missing `omarchy-done`, `omarchy-refresh-applications`, `omarchy-bar defaults`, the browser-policy helper.
- Root command path limited to `/usr/share/omarchy/bin:/usr/local/bin:/usr/bin:/bin`; lock and firewall helpers get only that path; user commands get package path + `~/.local/bin`.
- Chromium policy dir root-owned, never world-writable; browser theme colour rewritten after headless theme-set.
- Retires systemd-networkd; enables NetworkManager and disables iwd in one step; aborts loudly (`Upgrade incomplete - do NOT reboot.` on stderr, preserving exit status) via `trap cleanup_on_exit EXIT` with started/completed markers around the mutating range; never starts the shell or stops the retired session before reboot.
- Restores bar defaults, backfills hardware packages (sof-firmware, vulkan-intel, DX13260), refreshes launchers, removes stale nofile drop-ins.
- Kernel cmdline: preserves `root=`/`rootflags=subvol=`/`cryptdevice` into `/etc/default/limine` after limine-mkinitcpio is installed; verifies with `limine-entry-tool --get-cmdline default`; refuses a partial dm-crypt cmdline; verifies the UKIs' `.cmdline` section and refuses to reboot unverified.

### `user-theme-test.sh` → `install/user/theme.sh` — visible: yes
- Seeds `Tokyo Night` when no theme exists (preserving Chromium's `SingletonLock`); an existing `theme.name` is never overridden.
- Driver: stock theme is Tokyo Night (in `stock-system-policy-invariants`).

### `version-test.sh` → `bin/omarchy-version` — visible: yes
- Reports the `omarchy` or `omarchy-dev` package version (`4.0.0-1`), `dev` for a checkout, fails when no package; `omarchy-snapshot` labels an unknown version `unknown` under `set -e`.
- Driver: `version-and-dev-update-helpers`.

### `video-background-test.sh` → `shell/Commons/Util.qml`, `shell/Ui/BackgroundMedia.qml`, `shell/Ui/BackgroundVideo.qml`, `shell/plugins/background/Background.qml`, `shell/plugins/lock/LockView.qml`, `shell/plugins/lock/Service.qml`, `shell/plugins/services/battery/Service.qml`, `bin/omarchy-theme-switcher`, `bin/omarchy-upgrade-to-quattro`, `migrations/1786609204.sh`, `bin/omarchy-bar-text-color`, `bin/omarchy-menu-images`, `bin/omarchy-theme-set`, `shell/plugins/image-picker/list.sh`, `install/omarchy-base.packages` — visible: yes
- `isVideoPath` never truncates names; videos loop, aspect-crop, prime their first frame when paused, only import QtMultimedia on the video path; audio plays only from the first screen, never on the lock; a departing player keeps its source; no mipmaps; video switches bypass the image reveal stack; desktop and lock share `BackgroundMedia`; lock bypasses its image effect for video.
- Desktop playback stops while locked/screensaver, on battery power-saver, or when a fullscreen window covers that output; a theme switch keeping the same video path reopens it; bar colour sampling reads one frame; video thumbnail jobs = nproc/4; theme preview cache `fast_signature="v2"`; a video never stands in as its own lazy thumbnail; `ffmpegthumbnailer` is time-bounded (`timeout -k`); direct picker scans never content-hash media.
- Theme changes disable transition snapshots when either side is a video; a display coming back clears the blank state; a locked video wallpaper follows each panel's real DPMS; lock playback stops on blank or power-saver; battery service tracks `ActiveProfile` via D-Bus every 2s.
- Theme switcher previews `*.mp4`/`preview.mp4`; Quattro seeds video-only themes; migration adds `qt6-multimedia qt6-multimedia-ffmpeg` (also base packages).
- Runtime: generator makes a video thumbnail consumed by the picker; direct picker generates/reuses thumbnails, omits and remembers (`.failed`) rejected videos, retries a changed file, leaves timeouts (exit 124) to retry.
- Theme-set helpers: staged video background resolves to its post-swap path; image↔video transitions skip snapshots; videos never snapshotted; a vanished preselected background recovers.
- Driver: `video-background-plays-and-pauses-on-lock`.

### `voxtype-invitation-test.sh` → `install/user/first-run/install-voxtype.hook` — visible: yes
- Sends exactly one notification with `--exec omarchy-launch-floating-terminal-with-presentation omarchy-voxtype-install`, records `~/.local/state/omarchy/done/voxtype-install-invitation`, keeps its hook installed, needs no `systemd-run` unit; a second run does not notify.
- Driver: `voxtype-invitation-runs-once`.

### `vscode-theme-test.sh` → `bin/omarchy-theme-set-vscode` — visible: partial
- Probes `/usr/bin/cursor` via `omarchy-cmd-present`, ignores a PATH-provided `cursor` shim, skips Cursor settings when the packaged executable is absent.

### `weather-test.sh` → `shell/plugins/panels/weather/Model.js`, `Panel.qml`, `BarWidget.qml`, `bin/omarchy-weather-location` — visible: yes
- `weather.json` parsing (name+coords, name-only, incomplete coords, invalid/missing → auto-detect); location commit rules; wttr query prefers coords, URL-encodes names, empty → IP auto-detect; geocoding results parsed and incomplete rows dropped.
- Temperature rounding/formatting, imperial by locale/country/override, day names; Open-Meteo forecast days and current conditions normalised to the wttr shape; wttr fallback; forecast highs/lows; icon mapping incl. night fog; provisional icon from wttr.
- Panel presents its host widget as popout identity, switches panels as host, widget injects itself, forwards the popout handshake, claims hover-reveal after handoff; hero/bar share the label; Return focuses the city input; both open paths reload the location file; save completion rules per data source; hourly icon nearest noon.
- `omarchy-weather-location --set <name> [lat,lon]` writes `~/.local/state/omarchy/settings/weather.json` (`{"name":"Malibu","latitude":34.02577,"longitude":-118.7804}` or `{"name":"New York"}`), prints the stored name, rejects malformed coordinates, `--clear` removes the file.
- Driver: `weather-location-cli`.

### `webapp-install-escaping-test.sh` → `bin/omarchy-webapp-install` — visible: yes
- `Exec=omarchy-launch-webapp "https://example.com/a\\$b"` (backslash escaped for the Desktop Entry) so `gio launch` hands the browser `https://example.com/a$b`; `%20` survives; a backslash in the name is escaped; a newline in the name cannot inject a second `Exec=`.
- Driver: `webapp-install-launches-with-special-characters`.

### `webapp-install-test.sh` → `bin/omarchy-webapp-install` — visible: yes
- Writes `~/.local/share/applications/<Name>.desktop` with `Name=` and `Exec=omarchy-launch-webapp "https://…"`; a schemeless URL gets `https://`; a custom exec is kept; `HTTPS://` accepted.
- `javascript:`, `file:`, `data:`, `ftp:`, `ext://` → `Error: web app URL must be http or https.` and no desktop file; URLs with whitespace (leading space, extra URL, `--user-agent=…`) → `Error: web app URL must not contain whitespace.`; the interactive prompt refuses before fetching the icon (no curl).
- Driver: `webapp-install-refuses-bad-urls-and-names`.

### `webapp-name-test.sh` → `bin/omarchy-webapp-install`, `bin/omarchy-webapp-remove` — visible: yes
- A name with `/` → `App name cannot contain '/': <name>` and no nested directory; `../../../../escaped` writes nothing outside the applications dir; the interactive prompt refuses before downloading an icon.
- An ordinary name installs and removes; removal reaches a legacy nested launcher by its displayed name; removal with no applications directory stays quiet.

### `whatsapp-slim-test.sh` → `default/chromium/extensions/whatsapp-slim` — visible: yes but NET
- Content script `system-theme.js` runs at `document_start`, sets `localStorage system-theme-mode=true` and reloads once.

### `wifiqr-test.sh` → `shell/plugins/panels/wifiqr/Model.js` — visible: no (no Wi-Fi)
- Parses `meta\t<iface>\t<security>\t<ssid>` (tabs inside the SSID kept) plus a square 0/1 matrix; tolerates no header; rejects ragged, non-square, or invalid modules.

### `windows-key-test.sh` → `bin/omarchy-windows-key` — visible: yes
- Reads `/sys/firmware/acpi/tables/MSDM`, tries `strings` then `cat`, prints the `XXXXX-…` key; a table without a key → `Firmware license table found, but no Windows product key could be extracted.`; no table → `No Windows license key found in firmware.`
- Driver: absence path in `hardware-detectors-report-absence`.

### `windows-vm-compose-test.sh` → `bin/omarchy-windows-vm` (compose writer, mount pinning, privileged dispatch, migration, removal, credentials, disk space) — visible: no (needs CAP_SYS_ADMIN namespace; Docker/KVM)
- Compose pins `dockurr/windows`, `NET_ADMIN`, protected anchors `/var/lib/omarchy/windows/...:/storage|/shared`, `PROTECT: "Y"`, never a host-root bind; sources are bound by inode with 0700 leaves.
- Malicious username/RAM/STORAGE/SHARED inputs cannot widen a mount or compose field; passwords with `$`, quotes, backslashes round-trip; privileged actions allowlisted; pkexec target is only the canonical packaged regular file.
- Legacy compose migration preserves data and legitimate symlinks, hardens to 0700, drops malicious binds, removes the legacy file.
- Bring-up rejects tampered host paths, duplicate destinations, unprotected or duplicated `PROTECT`, writable compose.
- Both sources preflighted before either bind; root symlinks refused untouched; no FD leak; caller-owned distinct symlink targets supported; a post-validation home-path swap (sequential or concurrent) cannot redirect Docker away from the pinned inode; same-inode, ancestor/descendant, bind-alias overlaps rejected (removal discovery, xdev boundary), scan timeouts/errors fail closed; writer failure rolls back both binds; removal rejects stacked mounts, refuses after a failed `down`, deletes disk but preserves shared files; credentials replace a planted symlink atomically as a 600 file; free space measured on the storage target.

### `windows-vm-mount-boundary-test.sh` → `bin/omarchy-windows-vm` (root dispatch) — visible: no (needs root namespace)
- Root dispatch rejects missing/zero/non-numeric `PKEXEC_UID`, a uid absent from passwd, a home not owned by the caller, a writable home parent, a symlinked passwd home — all without mutating `/var/lib/omarchy/windows`.
- Cross-filesystem symlink sources bind by identity; boundary dirs root-owned 0711, leaves caller-owned 0700; another account cannot read the disk or share; wrong-owned or group-writable boundaries are rejected without repair; disk space measured on the storage filesystem; root writer yields a 0:640 compose and the final guard revalidates; previous sibling-anchor and unprotected fixed-anchor composes upgrade in place; both sources preflighted before mounting; a symlink anchor is rejected even when it resolves to the expected source.

### `windows-vm-test.sh` → `bin/omarchy-windows-vm`, `default/hypr/apps/windows-vm.lua` — visible: partial
- Compose uses `restart: "no"` (never `unless-stopped`); FreeRDP launched with title `Windows VM - Omarchy`; window rule for `^xfreerdp$`/that title opts out of default opacity (`opacity = "1 1"`).
- Driver: `windows-vm-install-refuses-insufficient-space` (install refuses on the 40 GB disk).

### `xps13-sidecar-amps-test.sh` → `bin/omarchy-hw-dell-xps13-sidecar-amps`, `install/hardware/dell-xps13-sidecar-amps.sh`, migration — visible: no (Dell DX13260 only)
- Runs during hardware setup; detector matches product `XPS 13 DX13260` with SKU exactly `0E53` (rejects other models, other SKUs, longer SKUs, missing attribute); leaf installs `dell-xps13-sidecar-amps` and applies; failing install or apply fails the leaf (no apply after failed install); migration applies and sets `reboot-required`, stays pending on failed apply without flagging reboot; no-op on other hardware.

## Observations

- **Build drift.** The minted disk is the `omarchy-4.0.2` ISO while these tests assert HEAD (dev
  line). Several contracts are recent fixes and may not be in 4.0.2: argv `--exec` for
  notifications, the plugin-add/theme-install transport-helper guard, the webapp URL scheme and
  whitespace checks, the sudo-expiry fail-closed path, `omarchy-migrate --force` removal, the
  screenrecord state file in `$XDG_RUNTIME_DIR`, the input-device name-as-data store, the
  `linux-omarchy` kernel migration. A driver failure on those is a finding about the build, not
  necessarily about the guest. Every proof below asks the driver to capture `omarchy-version` on
  failure so the two can be told apart. Running `omarchy-update-full-sequence` first brings the
  disk to the released 4.0.4 (still not HEAD).
- **Login user is `prime`.** Plugin clones are therefore `prime.<name>`; the sudo grant is
  `/etc/sudoers.d/99-omarchy-nopasswd-prime`; the mise wrappers land in `/home/prime/.local/bin`.
- **QEMU display is 1280x800 virtio-vga**, which is literally the fixture the monitor tests use
  ("1280x800 approximates the 3x preset as 3.2x"). Output name is `Virtual-1`. Scale changes
  re-layout the whole desktop; the driver must expect the bar and terminal to change size and
  restore the scale before continuing.
- **QEMU user-mode NAT drops ICMP**, so the network panel's ping rows show `Timeout`/high loss
  while TCP works. That is expected, not a failure. Connectivity never reports a captive portal.
- **No hardware paths.** `omarchy-hw-laptop`, `omarchy-hw-webcam`, `omarchy-hw-clamshell`,
  `omarchy-hw-fingerprint`, `omarchy-hw-touchpad`, `omarchy-power-present` all fail in the guest; the
  menu hides `Laptop Display`, `Mirror Display`, `With desktop + microphone audio + webcam`,
  `Battery Percentage`, `Fingerprint`; the bar has no `omarchy.power` widget. These are the
  *absence paths* the hardware mocks stand in for and are worth one explicit test.
- **Suspend cannot be exercised.** `systemctl suspend` will suspend the VM but only the host can
  wake it; the sleep-lock helper can be run directly instead.
- **Reboots are allowed but cost ~1–2 minutes** (LUKS passphrase `prime`, then login). Tests tagged
  `SLOW` reboot once. State persists across the reboot unless the run ends with `stop`.
- **Floating terminals.** Every Setup/Install/Remove menu action opens
  `omarchy-launch-floating-terminal-with-presentation`; the terminal closes on its own when the
  command finishes unless it waits for a key. The driver should screenshot immediately after the
  command prints and may need to re-run the command in a normal terminal (`Super+Enter`) to read
  the output at leisure.
- **sudo prompts.** Commands under `sudo` ask for the password `prime` in the terminal (or a polkit
  dialog for `pkexec`). The `omarchy-tzupdate` sudoers rule makes `timedatectl set-timezone` the one
  place no prompt appears.
- **Menu pointer gate.** The menu ignores the pointer's resting position when it opens; a row is
  selected by hover only after real movement. Drivers using the mouse should move it before
  clicking.
- **Long outputs** go to the serial console: `<cmd> 2>&1 | sudo tee /dev/ttyS0`, read with
  `get-serial`. Exit codes are read off the screen with the `; echo "exit=$?"` idiom. Every step
  below is either a hotkey/typed command (`send-keys`), a click (`mouse …`), or a screenshot /
  serial read; nothing is done from the host and no hardware is simulated — hardware paths appear
  only as their in-guest absence branch.
- **Cross-reviewer overlap.** Four stories are also proposed elsewhere: the pacman guard is named
  `pacman-direct-upgrade-guard` here to match; the update lock, the low-disk refusal and the
  stranded-lock recovery carry a `dedupe-with:` line so synthesis can merge them.
- **Dimmed Install rows on a stock disk** are guaranteed for `Install → Terminal → Alacritty`
  (alacritty is the default terminal) and `Install → Preinstalls` (no opt-out marker), so the
  `disabled:` contract can be observed without installing anything.
- **`Update → Extra Themes`** is hidden on a stock disk and appears only after a theme has been
  installed from a git repository; the local-repo theme test below is the cheapest way to make it
  appear without network.

## Proposed tests

### pacman-direct-upgrade-guard   [VM-OK]
description: A direct `pacman -Syu` is intercepted and redirected to `omarchy update`, so users cannot bypass the snapshot/keyring/migration sequence by accident; ordinary pacman commands are not affected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `sudo pacman -Syu; echo "exit=$?"` and enter the password `prime` when asked.
  ** Expect a refusal starting with `Woah partner...` that says Omarchy updates should run through `omarchy update` and shows the override `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, then a non-zero `exit=`. No `:: Synchronizing package databases...` line may appear.
  * Type `sudo pacman --sync --refresh --sysupgrade; echo "exit=$?"` and confirm the same refusal for the long-form flags.
  * Type `sudo pacman -S --needed bash` and confirm there is NO refusal (pacman says the package is up to date). Nothing is installed, so nothing needs restoring.
  * Type `omarchy-version` to record the build.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The refusal is printed before pacman does anything; if databases start syncing, the guard did not fire — press Ctrl+C and report.
  * Do NOT run the `OMARCHY_ALLOW_DIRECT_PACMAN=1` override; it would start a real upgrade.
  * This disk is the 4.0.2 build; a missing guard may be build drift — the `omarchy-version` line tells the two apart.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the terminal showing `Woah partner...`, the words `omarchy update`, and the `OMARCHY_ALLOW_DIRECT_PACMAN=1` override line, for both the short and long flag forms
  ** Screenshot of `sudo pacman -S --needed bash` completing without the guard message
  * If unsuccessful
  ** Screenshot of any `Synchronizing package databases` output (guard bypassed) or of a pacman error
  ** Output of `omarchy-version`
covers: bin/omarchy-update-pacman-guard, bin/omarchy-update-pacman; test/shell.d/update-pacman-guard-test.sh, update-pacman-test.sh; manual/30-updates.md
dedupe-with: pacman-direct-upgrade-guard (same story proposed by two other reviewers; same name used here)

### update-refuses-while-another-update-runs   [VM-OK]
description: Only one Omarchy update may run at a time; a second invocation stops before it can snapshot, and the migration notifier stays silent while the lock is held.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Hold the update lock from a background shell: `flock "$XDG_RUNTIME_DIR/omarchy-update.lock" sleep 600 &`
  * Run `omarchy-update`.
  ** Expect the single line `An Omarchy update is already running.` and a prompt-less return; no `Continue with update?` question, no snapshot.
  * Run `echo $?` and confirm it is non-zero.
  * Run `omarchy-migrate-notify; echo notifier=$?` — no toast must appear while the lock is held.
  * Release the lock with `kill %1` and wait two seconds.
  * Run `omarchy-update` again. This time the update must proceed to its confirmation `Continue with update?`. Answer No (press Escape or select No) so nothing is downloaded.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If disk space is below 10 GiB the second run stops with `You need at least 10 GiB free...` before the confirmation; that is a different test and should be reported as such.
  * `omarchy-update` may re-exec itself under `script` for logging; the message still lands in the same terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `An Omarchy update is already running.` with a non-zero exit status
  ** Screenshot showing no notification appeared after `omarchy-migrate-notify` while locked
  ** Screenshot of the `Continue with update?` prompt after the lock was released, answered No
  * If unsuccessful
  ** Screenshot of a `Create system snapshot` line or a confirmation prompt appearing while the lock was held
  ** Output of `omarchy-version`
covers: bin/omarchy-update, bin/omarchy-update-lock, bin/omarchy-migrate-notify; test/shell.d/update-lock-test.sh, migrate-notify-test.sh; manual/30-updates.md
dedupe-with: the other reviewers' update-lock test (pacman `db.lck` variant); this one holds Omarchy's own `omarchy-update.lock` and adds the notifier silence — merge into one story

### update-refuses-low-disk-space   [VM-OK]
description: The updater refuses to start when less than 10 GiB is free, before it asks for confirmation or takes a snapshot, so an update can never run out of space half way.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `df -h /` to read the free space (the disk is 40 GB).
  * Allocate a filler file so that less than 10 GiB remains, e.g. `fallocate -l 22G ~/fill.bin` (adjust the size so `df -h /` shows under 10G available; run `df -h /` again to confirm).
  * Run `omarchy-update-requires-free-space; echo "exit=$?"`.
  ** Expect `You need at least 10 GiB free to safely update Omarchy.` and `exit=1`.
  * Run `omarchy-update -y`.
  ** Expect the same message, no `Continue with update?` prompt, no `Create system snapshot` line, and a non-zero exit.
  * Run `omarchy-update` (interactive) and confirm it also stops with the message before any confirmation prompt.
  * Remove the filler: `rm ~/fill.bin` and run `df -h /` to confirm space is back.
  * Run `omarchy-update-requires-free-space; echo "exit=$?"` and confirm it is now silent with `exit=0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `fallocate` is instant on btrfs; if it fails, use `dd if=/dev/zero of=~/fill.bin bs=1G count=22 status=progress` (slower).
  * Do not set `OMARCHY_UPDATE_FORCE`; it would start a real update on a nearly full disk.
  * Always delete `~/fill.bin` before finishing, even on failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `df -h /` under 10G, then the exact `You need at least 10 GiB free to safely update Omarchy.` line from both `omarchy-update -y` and `omarchy-update`, with no confirmation prompt and no snapshot line
  ** Screenshot of the helper returning 0 silently after the filler was removed
  * If unsuccessful
  ** Screenshot of a `Continue with update?` prompt or `Create system snapshot` line appearing while space was low
  ** Output of `omarchy-version`
covers: bin/omarchy-update-requires-free-space, bin/omarchy-update; test/shell.d/update-disk-space-test.sh; manual/30-updates.md
dedupe-with: the other reviewers' low-disk refusal test (`fallocate` filler); identical story, merge

### update-orphan-pkgs-defaults-to-keeping   [VM-OK]
description: The post-update orphan review lists orphaned packages, only offers removal on a terminal, and defaults to keeping them, so an unattended update never uninstalls anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `omarchy-update-orphan-pkgs; echo "exit=$?"` — on a fresh install expect no output and `exit=0`.
  * Create one orphan without installing anything: mark an installed leaf package as a dependency, `sudo pacman -D --asdeps btop` (password `prime`). Confirm `pacman -Qtdq` now prints `btop`.
  * Run `omarchy-update-orphan-pkgs | cat` (piped, so it is non-interactive).
  ** Expect the heading `Orphan system packages`, the line `  btop`, and `1 orphaned package(s) found. Re-run omarchy-update-orphan-pkgs in a terminal to review/remove them.` — and no removal.
  * Run `omarchy-update-orphan-pkgs` directly. Expect the prompt `Remove 1 orphaned package(s)?` with **No** preselected. Press Enter.
  ** Expect `Keeping orphaned packages.` and `pacman -Q btop` still succeeding.
  * Restore the package's status: `sudo pacman -D --asexplicit btop` and confirm `pacman -Qtdq` prints nothing again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `btop` is not installed, pick another installed package that nothing depends on (check with `pacman -Qi <pkg>` → `Required By : None`), e.g. `fastfetch`.
  * The gum confirm defaults to No; pressing Enter without moving must keep the package.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the non-interactive listing with the `Re-run omarchy-update-orphan-pkgs in a terminal` line and no removal
  ** Screenshot of the confirm prompt with No preselected and the resulting `Keeping orphaned packages.`; `pacman -Q btop` still present
  ** Screenshot of `pacman -Qtdq` empty after restoring
  * If unsuccessful
  ** Screenshot of a `Removing orphan system packages` line or a pacman -Rns transaction that ran without an explicit Yes
covers: bin/omarchy-update-orphan-pkgs; test/shell.d/update-orphan-test.sh; manual/30-updates.md

### update-available-and-status-indicator   [VM-OK] [NET]
description: The update checker reports only the installed Omarchy package's update and drives the bar's update indicator, so users see when Omarchy itself (not every Arch package) has a new release.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `omarchy-version` and note the installed version (expected `4.0.2-…` on a fresh mint).
  * Run `omarchy-update-available; echo "exit=$?"`.
  ** If an Omarchy release newer than the installed one exists: expect exactly one line starting with `omarchy ` (or `omarchy-dev ` if that is the installed package) and `exit=0`. No `linux`, `omarchy-settings` or other package lines may appear.
  ** If none exists: expect `Omarchy is up to date` and `exit=1`.
  * Run `omarchy-update-status` and look at the top bar: the update indicator (Omarchy glyph in the centre section) must be shown when an update was reported and absent when up to date.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `checkupdates` syncs a temporary database (a few MB); allow up to a minute.
  * The indicator sits in the centre bar section between the weather widget and the indicators cluster.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `omarchy-update-available` output containing only Omarchy package lines (or the exact `Omarchy is up to date`) with the matching exit status
  ** Screenshot of the top bar showing (or not showing) the update indicator consistently with that result
  * If unsuccessful
  ** Screenshot of extra package lines (e.g. `linux …`) in the output, or of an indicator state contradicting the checker
  ** Output of `omarchy-version`
covers: bin/omarchy-update-available, bin/omarchy-update-status, bin/omarchy-version; test/shell.d/update-available-test.sh, update-status-test.sh, version-test.sh; manual/30-updates.md, manual/05-the-top-bar.md

### update-keyring-reports-keys-correct   [VM-OK] [NET]
description: The keyring repair step reinstalls archlinux-keyring, populates missing Omarchy keys, and only prints `Keys are correct` after a verifying check, so a broken keyring cannot pass silently into the package upgrade.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `omarchy-update-keyring 2>&1 | tee /tmp/keyring.log; echo "exit=${PIPESTATUS[0]}"` and enter the password `prime` when sudo asks.
  ** Expect pacman to reinstall `archlinux-keyring` and the last line to be `Keys are correct`, with `exit=0`.
  * Run `sudo pacman-key --list-keys | grep -i omarchy` and confirm an Omarchy key is present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reinstall downloads a small package (~1 MB) plus a database refresh; allow a minute.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `archlinux-keyring` reinstall followed by `Keys are correct` and `exit=0`
  ** Screenshot of the Omarchy key in `pacman-key --list-keys`
  * If unsuccessful
  ** Screenshot of `Keys are correct` printed after an earlier error, or of a non-zero status with the error text
covers: bin/omarchy-update-keyring; test/shell.d/update-keyring-test.sh; manual/30-updates.md

### omarchy-update-full-sequence   [VM-OK] [NET] [SLOW]
description: A full `omarchy update` from the menu runs its steps in the documented order (snapshot, keyring, packages, migrations, hooks, orphans, restart), and afterwards the machine carries the invariants the migrations promise.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape, go to Update → Omarchy.
  ** A floating terminal opens. If `Continue with update?` appears, answer Yes. Enter the password `prime` when sudo asks.
  * Watch the terminal and screenshot each phase heading as it appears: `Create system snapshot`, the keyring step ending in `Keys are correct`, the pacman upgrade, `Running migration (…)` lines, then orphan review and the restart prompt.
  ** The order must be: snapshot before packages, packages before migrations, migrations before hooks/AUR/restart.
  * If a restart/reboot is offered at the end, decline it for now.
  * Open a terminal with Super+Enter and run:
  ** `omarchy-version` (expect the new release, e.g. `4.0.4-…`)
  ** `omarchy-migrate --pending; echo "exit=$?"` (expect no output and `exit=1`)
  ** `sudo snapper -c root list | tail -n 5` (expect a new `number` snapshot whose description is the previous version)
  ** `pacman -Q linux-omarchy linux-omarchy-headers 2>&1` and `grep BOOT_ORDER /etc/default/limine` (expect `linux-omarchy` installed and `BOOT_ORDER="linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"` if the kernel migration is in the release; report whatever is printed)
  * This test changes the disk permanently; end the session with `stop` so the next test starts from the pristine mint.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This downloads hundreds of MB; it may exceed the ten-minute budget. Start it first in the session and keep taking screenshots (never sleep more than five seconds); if it is still running at the budget, report the last phase reached.
  * Long output can be dumped with `omarchy-migrate --pending 2>&1 | sudo tee /dev/ttyS0` and read off the serial console.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing `Create system snapshot`, `Keys are correct`, the pacman upgrade, and `Running migration (...)` in that order
  ** Screenshot of `omarchy-version` reporting the new version and `omarchy-migrate --pending` returning 1 with no output
  ** Screenshot of the new snapper `number` snapshot
  * If unsuccessful
  ** Screenshot of the phase where it stopped (e.g. a pacman conflict, `Upgrade incomplete`), and the serial dump of the terminal
  ** Output of `omarchy-version`
covers: bin/omarchy-update, bin/omarchy-snapshot, bin/omarchy-update-keyring, bin/omarchy-update-system-pkgs, bin/omarchy-migrate, migrations/1789325478.sh; test/shell.d/update-sequence-test.sh, snapshot-create-test.sh, omarchy-kernel-migration-test.sh, update-pkg-prune-test.sh; manual/30-updates.md

### version-and-dev-update-helpers   [VM-OK]
description: `omarchy-version` reports the installed package and the dev-checkout updater refuses paths that are not git checkouts, so a misconfigured `OMARCHY_PATH` produces a clear error instead of a silent no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `omarchy-version` — expect a package version like `4.0.2-1`.
  * Run `omarchy version` — expect the same output from the CLI router.
  * Run `OMARCHY_PATH=/usr/share/omarchy omarchy-update-dev; echo "exit=$?"` — expect no output and `exit=0` (a package-backed install skips the dev step).
  * Run `mkdir -p /tmp/notgit && OMARCHY_PATH=/tmp/notgit omarchy-update-dev; echo "exit=$?"` — expect `OMARCHY_PATH is not a git checkout: /tmp/notgit` on stderr and a non-zero status.
  * Run `OMARCHY_PATH=/tmp/notgit omarchy-version` — expect `dev` (a checkout path reports `dev`, not a package).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * None of these steps need network or sudo.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing the package version, the silent dev step for `/usr/share/omarchy`, the exact `OMARCHY_PATH is not a git checkout: /tmp/notgit` error, and `dev` for a checkout path
  * If unsuccessful
  ** Screenshot of a missing error, a git command running against `/usr/share/omarchy`, or `omarchy-version` failing
covers: bin/omarchy-version, bin/omarchy-update-dev, bin/omarchy; test/shell.d/version-test.sh, update-dev-test.sh; manual/14-omarchy-cli.md

### migrate-pending-notifier-and-runner   [VM-OK]
description: A pending migration produces a clickable `Pending Omarchy Migrations` toast that runs the migration in a terminal and records completion; the runner lists pending work, exits quietly when there is none, and no longer accepts `--force`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-migrate --pending; echo "exit=$?"; omarchy-migrate-notify` → on a fresh disk no output, `exit=1`, and no toast.
  * Make one migration pending again by removing its completion marker: `m=$(ls ~/.local/state/omarchy/migrations | sort | tail -n 1); echo "$m"; rm ~/.local/state/omarchy/migrations/"$m"`, then `omarchy-migrate --pending; echo "exit=$?"` → the removed filename and `exit=0`.
  * Type `omarchy-migrate-notify` → a toast titled `Pending Omarchy Migrations` with body `Click to run 1 pending migration.`; the command returns immediately.
  * Click the toast with the mouse. A floating terminal opens running `omarchy-migrate` and prints `Running migration (<name>)`; enter the password `prime` if it asks for sudo.
  ** Migrations are idempotent by contract; re-running the newest one is safe, but note what it printed.
  * When it finishes type `omarchy-migrate --pending; echo "exit=$?"` → no output and `exit=1`: the marker is back and the machine is as it started.
  * Type `omarchy-migrate --force; echo "exit=$?"` → `Unknown option: --force` and a non-zero exit.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Migrations are idempotent by contract; re-running the newest one is safe, but note what it printed.
  * If the toast does not appear, check for stderr text `Omarchy has pending migrations` (printed when no notification server answers) and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the pending list with the removed marker's filename, the `Pending Omarchy Migrations` toast with `Click to run 1 pending migration.`, the floating terminal with `Running migration (...)`, and the final quiet `--pending` with status 1
  ** Screenshot of `Unknown option: --force`
  * If unsuccessful
  ** Screenshot of no toast, or of the toast without a click action, or of `--pending` still listing the migration after the run
  ** Output of `omarchy-version`
covers: bin/omarchy-migrate, bin/omarchy-migrate-notify; test/shell.d/migrate-notify-test.sh, migrate-scope-test.sh, migrate-wrapper-test.sh; manual/30-updates.md

### theme-install-refuses-hostile-urls-and-names   [VM-OK]
description: `omarchy theme install` refuses URLs that git would treat as options or remote helpers, and repository names that would climb out of the themes directory or act as shell syntax, before anything is cloned; `omarchy theme remove` refuses path-climbing names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run each of the following and confirm every one exits non-zero with an error and creates nothing under `~/.config/omarchy/themes/` (check with `ls ~/.config/omarchy/themes/` after each):
  ** `omarchy-theme-install "ext::sh -c id"`
  ** `omarchy-theme-install "--upload-pack=touch /tmp/pwned"`
  ** `omarchy-theme-install "gcrypt://example.com/x"`
  ** `omarchy-theme-install "https://example.com/.git"`
  ** `omarchy-theme-install "https://example.com/omarchy-a';id;'b-theme.git"` — expect `Error: '…' does not give a usable theme name.`
  ** `omarchy-theme-install "https://example.com/a b.git"` — same error
  ** `omarchy-theme-install "https://example.com/-a.git"` — same error
  * Confirm `ls /tmp/pwned` reports no such file.
  * Run `touch ~/.config/omarchy/canary` then `omarchy-theme-remove ..`, `omarchy-theme-remove .`, `omarchy-theme-remove ../../evil` — each must fail and `ls ~/.config/omarchy/canary` must still exist.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The transport-helper refusals come from `omarchy-git-url-check` and are printed on stderr as `omarchy-git-url-check: …`.
  * None of these steps need network; a refusal that instead prints `Error: Failed to clone theme repo.` means git was reached — report that as a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each refusal with its error text and the unchanged `~/.config/omarchy/themes/` listing
  ** Screenshot of `/tmp/pwned` absent and `~/.config/omarchy/canary` present after the remove attempts
  * If unsuccessful
  ** Screenshot of any `Cloning into` / `Failed to clone theme repo` output (git was reached), a new theme directory, or a missing canary
  ** Output of `omarchy-version`
covers: bin/omarchy-theme-install, bin/omarchy-git-url-check, bin/omarchy-theme-remove; test/shell.d/theme-install-guards-test.sh; manual/06-themes.md, manual/43-making-your-own-theme.md

### theme-install-strips-code-from-git-theme   [VM-OK]
description: A theme installed from a git repository keeps its colours but loses every file that would run code (Lua, terminal configs, vscode.json), a user's own theme is not filtered, and installing a git theme makes `Update → Extra Themes` appear.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and build a local "stranger's" theme repo:
  ** `mkdir -p /tmp/omarchy-evil-theme && cd /tmp/omarchy-evil-theme && cp /usr/share/omarchy/themes/tokyo-night/colors.toml . && echo 'os.execute("touch /tmp/theme-pwned")' > hyprland.lua && echo '{"name":"Evil","extension":"pub.ext"}' > vscode.json && echo '# notes' > README.md && git init -q && git add . && git -c user.name=t -c user.email=t@t commit -qm init`
  * Install it: `omarchy-theme-install /tmp/omarchy-evil-theme 2>&1 | tee /tmp/install.log`.
  ** Expect the theme to be cloned to `~/.config/omarchy/themes/evil` and applied (the desktop repaints). The output must name `hyprland.lua` and `vscode.json` as ignored, and must NOT mention `README.md`.
  * Run `ls ~/.local/state/omarchy/current/theme/` — `vscode.json` must be absent; `grep -c theme-pwned ~/.local/state/omarchy/current/theme/hyprland.lua` must print `0`; `ls /tmp/theme-pwned` must report no such file.
  * Open Omarchy Menu with Super+Escape → Update: the row `Extra Themes` must now be listed. Select it; a terminal runs `omarchy-theme-update` and prints an updating line for `evil`.
  * Build a user-authored theme (no git): `mkdir -p ~/.config/omarchy/themes/mine && cp /usr/share/omarchy/themes/tokyo-night/colors.toml ~/.config/omarchy/themes/mine/ && echo '-- mine marker' > ~/.config/omarchy/themes/mine/hyprland.lua`, then `omarchy-theme-set mine 2>&1 | tee /tmp/mine.log`.
  ** Expect no "ignored" output and `grep -c 'mine marker' ~/.local/state/omarchy/current/theme/hyprland.lua` to print `1`.
  * Restore: `omarchy-theme-set tokyo-night`, then `omarchy-theme-remove evil` and `rm -rf ~/.config/omarchy/themes/mine /tmp/omarchy-evil-theme`. Confirm Update → Extra Themes is hidden again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The theme name is derived from the directory name: `omarchy-evil-theme` → `evil`.
  * A theme with a `.git` directory is "installed"; one without is "the user's own". Do not put real `os.execute` payloads in the user theme — Hyprland would run them by design.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the install output naming `hyprland.lua` and `vscode.json` as ignored (and not README.md), the staged theme directory without `vscode.json`, `grep -c` = 0 and no `/tmp/theme-pwned`
  ** Screenshot of Update → Extra Themes visible and the updater naming `evil`
  ** Screenshot of the user theme keeping its `mine marker` with nothing reported ignored
  ** Screenshot of Extra Themes hidden after removal
  * If unsuccessful
  ** Screenshot of `/tmp/theme-pwned` existing, `vscode.json` staged, or Extra Themes missing/present at the wrong time
  ** Output of `omarchy-version`
covers: bin/omarchy-theme-set, bin/omarchy-theme-install, bin/omarchy-theme-extras, bin/omarchy-theme-update, default/omarchy/omarchy-menu.jsonc (update.themes); test/shell.d/theme-staging-test.sh, menu-guards-test.sh; manual/06-themes.md, manual/43-making-your-own-theme.md

### webapp-install-refuses-bad-urls-and-names   [VM-OK]
description: Web app creation only accepts http(s) URLs without whitespace and names without slashes, so a pasted `javascript:` or `file:` URL or a URL-as-name can never become a launcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Type `omarchy-webapp-install Bad "javascript:alert(1)" webapp; echo "exit=$?"` → `Error: web app URL must be http or https.` and a non-zero exit.
  ** Repeat with `"file:///etc/passwd"` and `"ext://x"` in place of the URL — same refusal each time.
  * Type `omarchy-webapp-install Sneak "https://example.com/ --user-agent=INJECT" webapp; echo "exit=$?"` → `Error: web app URL must not contain whitespace.`
  * Type `omarchy-webapp-install "http://example.test/oops" "https://example.com" hey; echo "exit=$?"` → `App name cannot contain '/': http://example.test/oops`.
  * Type `ls ~/.local/share/applications/ | grep -iE 'bad|sneak|^http:'` → nothing (no launcher, no nested `http:` directory was created).
  * Interactive refusal: type `omarchy-webapp-install`, answer `Name>` with `Evil` and `URL>` with `file:///etc/passwd` → the scheme error appears at once, no icon download starts, and `ls ~/.local/share/applications/ | grep Evil` prints nothing.
  ** Nothing was created, so the desktop is as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon arguments `webapp`/`hey` are icon names, so no network fetch happens on the command-line path.
  * The interactive prompt is gum; type the value and press Enter. On the 4.0.2 build the scheme check may be missing — record `omarchy-version` if a refusal does not appear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each exact error line with its non-zero exit, the empty `ls` filter, and the interactive `file://` refusal without an icon fetch
  * If unsuccessful
  ** Screenshot of a `Bad`/`Sneak`/`Evil` launcher existing, a nested `http:` directory, or a whitespace URL accepted
  ** Output of `omarchy-version`
covers: bin/omarchy-webapp-install; test/shell.d/webapp-install-test.sh, webapp-name-test.sh; manual/25-web-apps.md

### webapp-install-launches-with-special-characters   [VM-OK]
description: A web app created from the terminal appears in the app launcher and opens the browser at exactly the URL given, even when the URL carries `$` or `%` or the name carries a newline, and removing it takes the launcher away again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-webapp-install 'Dollar App' 'https://example.com/a$b' webapp && grep '^Exec=' ~/.local/share/applications/'Dollar App.desktop'`.
  ** Expect `Exec=omarchy-launch-webapp "https://example.com/a\\$b"` (two backslashes before the dollar; that is the correct desktop-entry escaping).
  * Press Super+Space, type `Dollar`, and select `Dollar App` with Enter. A browser window opens whose address bar reads `https://example.com/a$b` (the page itself may not load; the address is the proof). Close it with Alt+F4.
  * Type `omarchy-webapp-install 'Percent App' 'https://example.com/s?q=a%20b' webapp`, then open it the same way from Super+Space: the address bar shows `s?q=a%20b`, not `a0b`. Close it.
  * Type `omarchy-webapp-install "$(printf 'Inject\nExec=evil')" 'https://example.com' webapp && grep -c '^Exec=' ~/.local/share/applications/Inject*.desktop` → prints `1` (a newline in the name cannot add a second `Exec=`).
  * Type `omarchy-webapp-remove 'Dollar App'; omarchy-webapp-remove 'Percent App'; rm -f ~/.local/share/applications/Inject*.desktop`, then press Super+Space and type `Dollar` → nothing is listed; press Escape.
  ** The launcher is back to its original contents.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The launcher may take a second to index a new `.desktop` file; press Escape and reopen Super+Space if the entry is not there yet.
  * The browser opens in app mode (no tabs); the URL may be shown in the window title instead of an address bar — either is fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `Exec=` line with `\\$b`, the launcher listing `Dollar App`, the browser at `a$b` and at `s?q=a%20b`, `grep -c` printing 1, and the launcher empty for `Dollar` after removal
  * If unsuccessful
  ** Screenshot of the app missing from the launcher (GLib rejected the entry), an address with `a0b`, or two `Exec=` lines
  ** Output of `omarchy-version`
covers: bin/omarchy-webapp-install, bin/omarchy-webapp-remove, bin/omarchy-launch-webapp; test/shell.d/webapp-install-escaping-test.sh, webapp-install-test.sh, webapp-name-test.sh; manual/25-web-apps.md

### plugin-add-refuses-transport-helpers-and-duplicate-ids   [VM-OK]
description: Adding a shell plugin refuses git transport helpers and option-shaped URLs before cloning, refuses a manifest id already installed under another directory, and installs a legitimate local repository.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run and confirm each fails without any `Cloning into` output and without creating anything under `~/.config/omarchy/plugins/`:
  ** `omarchy-plugin-add "ext::sh -c id" --yes` → message containing `names a git option or transport helper`
  ** `omarchy-plugin-add "fd::17" --yes` → same
  ** `omarchy-plugin-add "gcrypt://example.com/x" --yes` → message containing `which Omarchy does not clone from`
  ** `omarchy-plugin-add "--upload-pack=x" --yes` → an unknown-option refusal
  * Create a valid local plugin repo: `mkdir -p /tmp/acme-demo && cd /tmp/acme-demo && printf '%s\n' '{"schemaVersion":1,"id":"acme.demo","name":"Demo","version":"1.0.0","description":"demo","kinds":["bar-widget"],"entryPoints":{"barWidget":"Widget.qml"},"barWidget":{"displayName":"Demo","description":"demo","category":"Test","allowMultiple":false}}' > manifest.json && printf 'import QtQuick\nItem {}\n' > Widget.qml && git init -q && git add . && git -c user.name=t -c user.email=t@t commit -qm init`
  * Run `omarchy-plugin-add /tmp/acme-demo --yes` → expect `Added acme.demo into /home/prime/.config/omarchy/plugins/acme.demo` and `Enable it later with: omarchy plugin enable acme.demo`.
  * Duplicate id: `cp -r ~/.config/omarchy/plugins/acme.demo ~/.config/omarchy/plugins/other-folder` then `omarchy-plugin-add /tmp/acme-demo --yes` → expect `plugin id 'acme.demo' is already used by …` and a non-zero exit.
  * Open Omarchy Menu with Super+Escape → Setup → Plugins → Add Plugin: a floating terminal prompts for a git URL. Press Escape/Ctrl+C to cancel.
  * Clean up: `rm -rf ~/.config/omarchy/plugins/acme.demo ~/.config/omarchy/plugins/other-folder /tmp/acme-demo`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--yes` skips the trust confirmation; without it a prompt appears.
  * The menu's Remove Plugin row appears only while a user plugin is installed — you may notice it appear and disappear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the three guard refusals with their exact phrases and the unknown-option refusal, none showing `Cloning into`
  ** Screenshot of `Added acme.demo into …` and then the `plugin id 'acme.demo' is already used by` refusal
  ** Screenshot of the Add Plugin floating terminal prompt
  * If unsuccessful
  ** Screenshot of git being invoked for a refused URL, or a duplicate id accepted
  ** Output of `omarchy-version`
covers: bin/omarchy-plugin-add, bin/omarchy-git-url-check; test/shell.d/plugin-add-test.sh, menu-test.sh (setup.plugin.add); manual/32-shell-plugins.md

### plugin-clone-enable-remove-roundtrip   [VM-OK]
description: Cloning a built-in plugin creates an editable `prime.<name>` copy that replaces the original in the bar, the plugin pickers resolve by id and only offer what each verb can act on, and removing the clone restores the original.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the top bar (note the clock).
  * Open a terminal with Super+Enter and run `omarchy-plugin-clone omarchy.clock`.
  ** Expect a notification `Editing Cloned Plugin` and `ls ~/.config/omarchy/plugins/prime.clock/` to list `manifest.json BarWidget.qml Panel.qml Model.js`. `jq -r '.id,.name,.omarchy.clonedFrom' ~/.config/omarchy/plugins/prime.clock/manifest.json` → `prime.clock`, `My Clock`, `omarchy.clock`. The bar clock keeps working (now served by the clone).
  * Prove the clone is live: `sed -i 's/"My Clock"/"My Clock Renamed"/' ~/.config/omarchy/plugins/prime.clock/manifest.json`, wait two seconds, then `omarchy-shell shell listPlugins | jq -r '.[]|select(.id=="prime.clock").name'` → `My Clock Renamed` (hot reload without restart).
  * Refusals: `omarchy-plugin-clone omarchy.weather custom.weather` (custom id) and `omarchy-plugin-clone prime.clock` (not built-in) must both fail and leave no `prime.weather` directory.
  * Open Omarchy Menu with Super+Escape → Setup → Plugins → Clone Plugin: the list must NOT offer `Clock` any more (already cloned). Press Escape.
  * Setup → Plugins → Disable Plugin: rows show the plugin name with its id underneath; the entry for the bar itself is not offered. Press Escape.
  * Setup → Plugins → Remove Plugin (this row exists only while a user plugin is installed): pick `My Clock Renamed` (`prime.clock`). A floating terminal confirms; accept. Expect `Restored omarchy.clock.` and the bar clock still present.
  * Confirm `ls ~/.config/omarchy/plugins/` no longer lists `prime.clock` and Setup → Plugins no longer shows Remove Plugin.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clone id uses the login name, `prime`.
  * Menu rows are `name` with the id as smaller subtext; two rows can share a name, so pick by the id line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `Editing Cloned Plugin` notification, the clone directory listing and manifest fields, and the hot-reloaded name from `listPlugins`
  ** Screenshot of Clone Plugin without a Clock row, Disable Plugin rows with id subtext, and `Restored omarchy.clock.` after removal
  ** Screenshot of the bar clock present throughout
  * If unsuccessful
  ** Screenshot of a missing clock in the bar, a clone created for a refused command, or Remove Plugin acting on the wrong plugin
  ** Output of `omarchy-version`
covers: bin/omarchy-plugin-clone, bin/omarchy-plugin-remove, bin/omarchy-menu-plugin, bin/omarchy-plugin-enable, shell/shell.qml (hot reload); test/shell.d/plugin-clone-test.sh, menu-plugin-test.sh, runtime-smoke-test.sh; manual/32-shell-plugins.md

### plugin-validate-manifest-contract   [VM-OK]
description: `omarchy-plugin-validate` explains exactly which entry point a declared plugin kind is missing, rejects invalid bar sections, and reports a missing entry-point file, so plugin authors get actionable errors instead of a plugin that silently does nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Create a valid plugin: `mkdir -p /tmp/pv/ok && cd /tmp/pv/ok && printf '%s\n' '{"schemaVersion":1,"id":"acme.ok","name":"Acme ok","version":"1.0.0","kinds":["bar-widget"],"entryPoints":{"barWidget":"Widget.qml"},"barWidget":{"defaultSection":"right"}}' > manifest.json && touch Widget.qml && omarchy-plugin-validate /tmp/pv/ok; echo "exit=$?"` → `exit=0`.
  * Wrong entry point: `mkdir -p /tmp/pv/missing && cd /tmp/pv/missing && printf '%s\n' '{"schemaVersion":1,"id":"acme.missing","name":"Acme missing","version":"1.0.0","kinds":["bar-widget"],"entryPoints":{"service":"Entry.qml"}}' > manifest.json && touch Entry.qml && omarchy-plugin-validate /tmp/pv/missing` → contains `kind 'bar-widget' requires an 'entryPoints.barWidget' to load`.
  * Bad section: `mkdir -p /tmp/pv/bottom && cd /tmp/pv/bottom && printf '%s\n' '{"schemaVersion":1,"id":"acme.bottom","name":"Acme bottom","version":"1.0.0","kinds":["bar-widget"],"entryPoints":{"barWidget":"Widget.qml"},"barWidget":{"defaultSection":"bottom"}}' > manifest.json && touch Widget.qml && omarchy-plugin-validate /tmp/pv/bottom` → contains `'barWidget.defaultSection' must be left, center, or right`.
  * Missing file: `mkdir -p /tmp/pv/ghost && cd /tmp/pv/ghost && printf '%s\n' '{"schemaVersion":1,"id":"acme.ghost","name":"Acme Ghost","version":"1.0.0","kinds":["bar"],"entryPoints":{"bar":"Missing.qml"}}' > manifest.json && omarchy-plugin-validate /tmp/pv/ghost` → contains `entry point file not found`.
  * Clean up: `rm -rf /tmp/pv`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Set `OMARCHY_PATH=/usr/share/omarchy` explicitly if the command complains about the path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `exit=0` for the valid plugin and of the three exact error phrases for the invalid ones
  * If unsuccessful
  ** Screenshot of an invalid manifest accepted (status 0) or a generic error without the named entry point
  ** Output of `omarchy-version`
covers: bin/omarchy-plugin-validate; test/shell.d/plugin-validate-test.sh; manual/32-shell-plugins.md

### plugin-enable-placement-and-bar-put   [VM-OK]
description: Disabling a bar widget removes it from the bar immediately, `omarchy-bar put` places a widget once and never duplicates it, and placement flags are refused for a full bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the top bar; the audio widget is in the right section.
  * Open a terminal with Super+Enter and run `omarchy-plugin-disable omarchy.audio`. Within a couple of seconds the audio widget must vanish from the bar; `omarchy-shell shell listShellConfig | jq -c '[.bar.layout.right[]|.id//.]'` must not contain `omarchy.audio`.
  * Run `omarchy-plugin-enable omarchy.audio --section right`; the widget must return to the right section.
  * Run `omarchy-bar put omarchy.keyboard-layout --after omarchy.clock` then `omarchy-shell shell listShellConfig | jq -c '[.bar.layout.center[]|.id//.]'` → `omarchy.keyboard-layout` appears immediately after `omarchy.clock`, and a keyboard-layout widget appears next to the clock.
  * Run `omarchy-bar put omarchy.keyboard-layout --section right` and re-run the jq: the centre list is unchanged and the right list does NOT contain a second `omarchy.keyboard-layout`.
  * Run `omarchy-plugin-enable omarchy.bar --section right; echo "exit=$?"` → non-zero (placement is meaningless for a full bar).
  * Restore: `omarchy-plugin-disable omarchy.keyboard-layout` and confirm the bar looks like the first screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar hot-reloads `~/.config/omarchy/shell.json`; give it two seconds after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar without and then with the audio widget, matching the jq output
  ** Screenshot of the keyboard-layout widget beside the clock, the unchanged config after the second put, and the non-zero status for the full-bar placement
  * If unsuccessful
  ** Screenshot of a duplicated widget, a widget that did not disappear/return, or a bar that failed to render
  ** Output of `omarchy-version`
covers: bin/omarchy-plugin-enable, bin/omarchy-plugin-disable, bin/omarchy-bar; test/shell.d/plugin-enable-test.sh, runtime-smoke-test.sh; manual/05-the-top-bar.md, manual/32-shell-plugins.md

### menu-install-rows-dim-installed-software   [VM-OK]
description: The Install menu keeps every catalogue row visible but dims and blocks the ones already installed, while the Remove menu hides rows for software that is not installed, so the menus read as a catalogue rather than vanishing entries.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape and navigate to Install → Terminal.
  ** `Alacritty` (the preinstalled default terminal) must be listed but rendered faded, with a `✓` after its label; `Foot`, `Ghostty`, `Kitty` are normal.
  * Press Down repeatedly: the keyboard cursor must skip the faded Alacritty row. Try to click Alacritty with the mouse: nothing must happen (the menu stays open on the same submenu).
  * Go back (Backspace or Left) to Install: the `Preinstalls` row must also be faded (nothing has been removed yet).
  * Go to Install → Browser: `Zen` must be listed and selectable (not installed). Press Escape before activating anything.
  * Open the menu again → Remove → Browser: there must be NO `Zen` row (Remove hides uninstalled software). Note which browsers are listed.
  * Open the menu, type `alacritty` in the search: the Install → Terminal → Alacritty row must not appear among the results (disabled rows are excluded from search); the installed Alacritty *app* may appear.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Faded rows are drawn at 40% opacity; compare against neighbouring rows in the screenshot.
  * Move the mouse before hovering: the menu ignores the pointer's resting position when it opens.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Install → Terminal with a faded `Alacritty ✓` and the cursor resting on a non-faded row after pressing Down past it
  ** Screenshot of Install with a faded `Preinstalls` row, Install → Browser with a selectable `Zen`, and Remove → Browser without `Zen`
  ** Screenshot of the search for `alacritty` showing no Install row
  * If unsuccessful
  ** Screenshot of Alacritty missing from Install → Terminal, of the cursor landing on the faded row, or of the menu activating it on click
  ** Output of `omarchy-version`
covers: shell/plugins/menu/MenuModel.js, shell/plugins/menu/Menu.qml, default/omarchy/omarchy-menu.jsonc (install.*, remove.*); test/shell.d/menu-test.sh, menu-guards-test.sh, pointer-move-gate-test.sh; manual/04-navigation.md

### menu-hides-hardware-rows-absent-in-vm   [VM-OK]
description: Menu rows guarded by hardware detection are hidden when the hardware is absent, so a desktop or VM never sees laptop, webcam, battery or fingerprint actions it cannot use, while unguarded rows stay in their documented places.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape (it opens on the System menu). Confirm `Lock`, `Suspend`, `Logout`, `Reboot`, `Shutdown` are listed and that `Hibernate` is absent (no swap in the VM).
  * Go back to the root and open Trigger → Hardware (or search `laptop`): there must be no `Laptop Display` and no `Mirror Display` row (the guest is not a laptop).
  * Open Trigger → Capture → Screenrecord: rows `With no audio`, `With desktop audio`, `With desktop + microphone audio` are present; `With desktop + microphone audio + webcam` is absent (no webcam).
  * Open Trigger → Toggle: `Battery Percentage` is absent; `Stay Awake`, `Nightlight`, `Menu Bar` are present.
  * Open Setup → Security: `Fingerprint` is absent; `Fido2`, `SSHD`, `Passwordless Sudo`, `Sudoless Docker` are present.
  * Press Escape to close the menu; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Navigate submenus with Enter and go back with Backspace or Left. Move the mouse before hovering a row; the menu ignores the pointer's resting position when it opens.
  * If a hidden row *is* present, open a terminal and type `omarchy-hw-laptop; echo "exit=$?"` (likewise `omarchy-hw-webcam`, `omarchy-hw-fingerprint`) and include the exit codes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each submenu listed above with the absent rows absent and the present rows present
  * If unsuccessful
  ** Screenshot of a hardware row appearing in the VM, or a documented row missing, plus the `omarchy-hw-*` exit codes
  ** Output of `omarchy-version`
covers: default/omarchy/omarchy-menu.jsonc, shell/plugins/menu/MenuModel.js (isVisible), bin/omarchy-hw-laptop, bin/omarchy-hw-webcam, bin/omarchy-hw-fingerprint, bin/omarchy-hibernation-available; test/shell.d/menu-test.sh, menu-guards-test.sh, pointer-move-gate-test.sh; manual/04-navigation.md

### menu-setup-catalogue-layout   [VM-OK]
description: The shipped menu keeps its documented layout — Direct Boot and Reset Computer under Setup (Reset last), every coding agent listed alphabetically under Defaults → Agent, Extra Themes hidden until a git theme exists — and menu aliases route to the right submenu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape and go back to the root (Backspace), then open Setup: `Direct Boot` is listed directly under Setup and `Reset Computer` is the last row.
  * Open Setup → Default → Agent: exactly Antigravity, Claude, Codex, Copilot, Crush, Cursor CLI, Grok, Hermes, Muse Code, omp, OpenClaw, OpenCode, Ori, Pi, in that order, each with its own glyph.
  * Open Setup → Plugins: exactly `Enable Plugin`, `Disable Plugin`, `Add Plugin`, `Clone Plugin` (no `Remove Plugin` on a fresh disk).
  * Go back to the root and open Update: `Extra Themes` is absent on a fresh disk; `Omarchy`, `Channel`, `Config`, `Timezone` are present.
  * Go back to the root, type `power-menu` and screenshot, then clear it and type `power_menu`: both show the System entries (Lock, Suspend, Logout, Reboot, Shutdown).
  * Press Escape to close the menu; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The search field filters as you type; Backspace on an empty field goes back one level.
  * Rows are short; zoom the screenshot to read the agent glyphs.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Setup with Direct Boot and Reset Computer last, the Agent list in the exact order, Setup → Plugins with four rows, Update without Extra Themes, and both alias searches showing the System entries
  * If unsuccessful
  ** Screenshot of a misplaced/missing row, an agent out of order, Remove Plugin or Extra Themes present on a fresh disk, or an alias not routing
  ** Output of `omarchy-version`
covers: default/omarchy/omarchy-menu.jsonc, shell/plugins/menu/MenuModel.js (resolveRoute), default/fonts/omarchy/omarchy.ttf; test/shell.d/menu-test.sh, menu-guards-test.sh; manual/04-navigation.md, manual/17-ai.md

### passwordless-sudo-toggle-from-menu   [VM-OK]
description: Passwordless sudo is a deliberate grant: the Security menu warns and asks for confirmation, sudo then works without a password, and running the toggle again turns it off so a password is required once more.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo -n true; echo "exit=$?"` → `exit=1` (a password is required).
  * Open Omarchy Menu with Super+Escape → Setup → Security → Passwordless Sudo, using the mouse.
  ** A floating terminal prints `Toggle passwordless sudo...`, the `⚠️ WARNING` about ANY process running as root for 15 minutes, and asks `Enable passwordless sudo for 15 minutes? This is a significant security risk!`. Confirm Yes and enter the password `prime`.
  ** Expect `Passwordless sudo has been ENABLED. It will automatically disable in 15 minutes.` and `A restart removes the passwordless sudo rule as well.`
  * In the normal terminal type `sudo -k; sudo -n true; echo "exit=$?"; sudo cat /etc/sudoers.d/99-omarchy-nopasswd-prime` → `exit=0` and `prime ALL=(ALL) NOPASSWD: ALL`.
  * Type `systemctl list-timers --all | grep -i nopasswd` → an expiry timer is armed.
  * Open the menu → Setup → Security → Passwordless Sudo again → the floating terminal prints `Passwordless sudo has been DISABLED. Sudo will require a password again.`
  * Type `sudo -k; sudo -n true; echo "exit=$?"; ls /etc/sudoers.d/` → `exit=1` and no `99-omarchy-nopasswd-prime`; the machine is back to its starting state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal closes when the command ends; screenshot as soon as the ENABLED/DISABLED line appears, or run `omarchy-sudo-passwordless` from the normal terminal to read it at leisure.
  * `sudo -n` never prompts; `exit=1` with `a password is required` is the expected "off" state.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the warning + confirmation, the exact ENABLED line, `sudo -n true` succeeding with the sudoers file content, the armed timer, the DISABLED line, and `sudo -n true` failing again with the file gone
  ** The menu was operated with the mouse
  * If unsuccessful
  ** Screenshot of `ENABLED` printed without a timer, `sudo -n true` still succeeding after disable, or the grant file surviving
  ** Output of `omarchy-version`
covers: bin/omarchy-sudo-passwordless, default/omarchy/omarchy-menu.jsonc (setup.security.passwordless-sudo); test/shell.d/nopasswd-sudo-expiry-test.sh, menu-test.sh; manual/48-security.md, manual/18-development-tools.md

### passwordless-sudo-expires-on-its-own   [VM-OK]
description: A passwordless sudo grant is time-limited: the timer removes it without any user action, and a bad minutes argument is refused, so a forgotten grant cannot linger.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-sudo-passwordless abc; echo "exit=$?"` → `Usage: omarchy-sudo-passwordless [MINUTES]` and a non-zero exit.
  * Type `omarchy-sudo-passwordless 1`, confirm Yes, enter the password `prime` → `Passwordless sudo has been ENABLED. It will automatically disable in 1 minutes.`
  * Type `sudo -k; sudo -n true; echo "exit=$?"` → `exit=0`.
  * Every 20 seconds type `sudo -k; sudo -n true; echo "exit=$?"; ls /etc/sudoers.d/` and screenshot; within about 70 seconds it must return `exit=1` and `99-omarchy-nopasswd-prime` must have disappeared from the listing, with no command from you.
  ** `omarchy-tzupdate` stays in the listing; only the generated grant goes.
  * Type `systemctl list-timers --all | grep -ci nopasswd` → `0` (the timer is gone too). The machine is back to its starting state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not sleep more than five seconds between actions; poll with repeated commands and screenshots instead.
  * The confirmation is a gum prompt; use Left/Right + Enter or type `y`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage error, the ENABLED line for 1 minute, `exit=0`, then the poll where `exit` flips to 1 and the grant file is gone, and the timer count 0
  * If unsuccessful
  ** Screenshot of `sudo -n true` still succeeding or the grant file present two minutes after enabling
  ** Output of `omarchy-version`
covers: bin/omarchy-sudo-passwordless; test/shell.d/nopasswd-sudo-expiry-test.sh; manual/48-security.md

### passwordless-sudo-grant-cleared-by-reboot   [VM-OK] [SLOW]
description: A passwordless sudo grant never survives a reboot: systemd-tmpfiles removes every generated grant at boot while leaving Omarchy's other sudoers rules intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-sudo-passwordless 120`; confirm Yes and enter the password `prime`. Expect `Passwordless sudo has been ENABLED. It will automatically disable in 120 minutes.`
  * Run `ls /etc/sudoers.d/` and confirm both `99-omarchy-nopasswd-prime` and `omarchy-tzupdate` are listed.
  * Reboot: Omarchy Menu (Super+Escape) → System → Reboot. Answer the LUKS passphrase `prime` and log in again (password `prime`) to reach the desktop.
  * Open a terminal and run `ls /etc/sudoers.d/` → `99-omarchy-nopasswd-prime` must be gone and `omarchy-tzupdate` must still be present.
  * Run `sudo -k; sudo -n true; echo "exit=$?"` → `exit=1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reboot takes one to two minutes; take screenshots of the boot splash and the login.
  * `omarchy-tzupdate` is the control file proving the cleanup only targets `99-omarchy-nopasswd-*`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of both files before the reboot, the reboot itself, and after login only `omarchy-tzupdate` remaining with `sudo -n true` failing
  * If unsuccessful
  ** Screenshot of `99-omarchy-nopasswd-prime` surviving the reboot or `omarchy-tzupdate` missing
  ** Output of `omarchy-version`
covers: etc/tmpfiles.d/omarchy-nopasswd-sudo.conf, bin/omarchy-sudo-passwordless, bin/omarchy-system-reboot; test/shell.d/nopasswd-sudo-expiry-test.sh, system-power-test.sh; manual/48-security.md

### snapshot-create-lists-number-snapshot   [VM-OK]
description: `omarchy-snapshot create` takes a Snapper `number` snapshot of the root subvolume labelled with the Omarchy version and prunes by the number policy, so every update has a rollback point without leaking timeline snapshots.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Run `sudo snapper -c root list` (password `prime`) and note the highest snapshot number.
  * Run `omarchy-snapshot create` → expect `Create system snapshot` and `Snapshots can be selected during boot.`
  * Run `sudo snapper -c root list | tail -n 3` → a new row of type `single`/cleanup `number` whose description equals the output of `omarchy-version` (e.g. `4.0.2-1`). No row may have cleanup `timeline`.
  * Run `grep -E '^(TIMELINE_CREATE|NUMBER_LIMIT|NUMBER_CLEANUP)=' /etc/snapper/configs/root` (use `sudo` if unreadable) → `TIMELINE_CREATE="no"`, `NUMBER_CLEANUP="yes"`, `NUMBER_LIMIT="5"`.
  * Run `systemctl is-enabled snapper-timeline.timer snapper-cleanup.timer limine-snapper-sync.service` → `disabled`, `enabled`, `enabled`.
  * Run `grep MAX_SNAPSHOT_ENTRIES /etc/limine-entry-tool.d/omarchy-defaults.conf` → `MAX_SNAPSHOT_ENTRIES=6`.
  * Round trip: `sudo snapper -c root delete <new number>` and `sudo snapper -c root list | tail -n 2` → the list is back to what it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `omarchy-snapshot create` prints `No Snapper configs found`, snapper is not configured on this build; report it with the config listing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Create system snapshot`, the new `number` snapshot row labelled with the version, the config values and the timer states
  * If unsuccessful
  ** Screenshot of `No Snapper configs found`, a `timeline` row, or a timeline timer enabled
  ** Output of `omarchy-version`
covers: bin/omarchy-snapshot, default/snapper/root, install/config/snapper.sh, etc/limine-entry-tool.d/omarchy-defaults.conf; test/shell.d/snapshot-create-test.sh, snapper-test.sh, snapper-timeline-leak-test.sh; manual/47-system-snapshots.md

### snapshot-create-fails-loudly-without-config   [VM-OK]
description: When Snapper is installed but has no configuration, `omarchy-snapshot create` fails with an explanation instead of silently passing for a backup.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Temporarily hide the Snapper root config: `sudo mv /etc/snapper/configs/root /root/snapper-root.bak && sudo cp /etc/conf.d/snapper /root/snapper-conf.bak && sudo sed -i 's/^SNAPPER_CONFIGS=.*/SNAPPER_CONFIGS=""/' /etc/conf.d/snapper` (password `prime`).
  * Run `sudo snapper list-configs` → only the header, no `root` row.
  * Run `omarchy-snapshot create; echo "exit=$?"` → expect `No Snapper configs found, so no snapshot was created.` and `Configure Snapper with: sudo bash -euo pipefail "/usr/share/omarchy/install/config/snapper.sh"`, with a non-zero status.
  * Restore immediately: `sudo mv /root/snapper-root.bak /etc/snapper/configs/root && sudo cp /root/snapper-conf.bak /etc/conf.d/snapper && sudo snapper list-configs` → the `root` row is back.
  * Run `omarchy-snapshot create` once more to confirm it works again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Always run the restore step, even if an earlier step fails; the config is needed by updates and by the boot menu snapshot entries.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `list-configs` empty, the exact `No Snapper configs found…` message with the configure hint and non-zero status, then `root` restored and a successful snapshot
  * If unsuccessful
  ** Screenshot of `Create system snapshot` printed with no config (silent false success) or of the restore failing
  ** Output of `omarchy-version`
covers: bin/omarchy-snapshot; test/shell.d/snapshot-create-test.sh; manual/47-system-snapshots.md

### stock-system-policy-invariants   [VM-OK]
description: A fresh install carries the security and service posture the installer and migrations promise: no privileged groups granted, NetworkManager not networkd, supervised user services, oomd tuned to protect the compositor, Snapper without timelines, Tokyo Night seeded, no legacy tmux alert hooks, no repository-bin PATH injection for mise.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run the following, sending the output to the serial console so it can be read in full: `{ id -nG; pacman -Q ydotool xpadneo-dkms 2>&1; systemctl is-active NetworkManager systemd-networkd 2>&1; systemctl is-enabled systemd-oomd 2>&1; cat /etc/systemd/oomd.conf.d/10-omarchy.conf; cat ~/.config/systemd/user/app.slice.d/10-oomd.conf /usr/lib/systemd/user/app.slice.d/10-oomd.conf 2>/dev/null; systemctl --user is-enabled omarchy-sleep-lock.service omarchy-migrate-notify.service omarchy-fcitx5.service 2>&1; systemctl --user is-active omarchy-sleep-lock.service omarchy-fcitx5.service 2>&1; systemctl --user status bt-agent.service 2>&1 | head -n 5; ls /usr/lib/systemd/user/omarchy-update-user-notify.path 2>&1; cat ~/.local/state/omarchy/current/theme.name; grep -c omarchy-tmux-alert ~/.config/tmux/tmux.conf; ls -d ~/Work/tries ~/Work/.mise.toml 2>&1; grep -E '^(TIMELINE_CREATE|NUMBER_LIMIT)=' /etc/snapper/configs/root 2>&1; grep Hidden ~/.config/autostart/limine-snapper-notify.desktop 2>&1; } 2>&1 | sudo tee /dev/ttyS0` (password `prime`).
  * Read the serial console (`get-serial`) and check:
  ** `id -nG` contains `wheel` and does NOT contain `docker`; it contains `input` only if `pacman -Q ydotool` or `xpadneo-dkms` succeeded.
  ** `NetworkManager` is `active`, `systemd-networkd` is `inactive`.
  ** `systemd-oomd` is `enabled`; the oomd conf has `DefaultMemoryPressureLimit=50%` and `DefaultMemoryPressureDurationSec=20s`; the app.slice drop-in has `ManagedOOMMemoryPressure=kill` and `ManagedOOMSwap=kill`.
  ** `omarchy-sleep-lock.service`, `omarchy-migrate-notify.service`, `omarchy-fcitx5.service` are `enabled`; sleep-lock and fcitx5 are `active`.
  ** `bt-agent.service` shows a skipped `ExecCondition` (no bluetooth) rather than a failure.
  ** `omarchy-update-user-notify.path` does not exist.
  ** `theme.name` is `tokyo-night` (Tokyo Night).
  ** tmux alert hook count is `0`; `~/Work/tries` exists and `~/Work/.mise.toml` does not.
  ** Snapper `TIMELINE_CREATE="no"`, `NUMBER_LIMIT="5"`; the limine notifier autostart has `Hidden=true`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Some files may live under `/usr/lib/systemd/user/` instead of `~/.config/systemd/user/`; the command already tries both.
  * `cat ~/.local/state/omarchy/current/theme.name` may print `Tokyo Night` with capitals on older builds; either spelling is fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump (`get-serial`) containing every value above as expected, plus a screenshot of the terminal command
  * If unsuccessful
  ** Serial dump showing `docker` in the groups, `systemd-networkd active`, a disabled/inactive Omarchy user unit, a missing oomd setting, `TIMELINE_CREATE="yes"`, or a tmux alert hook
  ** Output of `omarchy-version`
covers: install/config/docker.sh, install/config/browser-policy.sh, bin/omarchy-provision-owner, install/hardware/network.sh, default/systemd/user/*.service, default/systemd/user/app.slice.d/10-oomd.conf, etc/systemd/oomd.conf.d/10-omarchy.conf, install/user/first-run/enable-user-units.sh, install/config/enable-services.sh, install/user/theme.sh, migrations/1785189600.sh, install/user/mise-work.sh, default/snapper/root, config/autostart/limine-snapper-notify.desktop; test/shell.d/provisioning-groups-test.sh, sudoless-docker-posture-test.sh, network-manager-transition-test.sh, systemd-test.sh, user-theme-test.sh, tmux-alert-removal-migration-test.sh, mise-work-path-test.sh, snapper-test.sh, sleep-monitor-test.sh; manual/48-security.md, manual/47-system-snapshots.md

### notification-send-click-command-is-literal-argv   [VM-OK]
description: `omarchy-notification-send` sends its click command as a literal argument vector, so a file name with spaces or shell metacharacters is opened as data, forged hints in the text are inert, and unknown options are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and `rm -f /tmp/pwned '/tmp/a b' '/tmp/$(touch /tmp/pwned)'`.
  * Run `omarchy-notification-send "Download complete" "A body" -u critical -g K --exec touch -- '/tmp/a b' '/tmp/$(touch /tmp/pwned)'`.
  ** A toast titled `Download complete` with body `A body` appears (critical: it stays until dismissed).
  * Click the toast. Then run `ls -la /tmp/'a b' /tmp/'$(touch /tmp/pwned)' /tmp/pwned 2>&1`.
  ** Expect the two literal files `/tmp/a b` and `/tmp/$(touch /tmp/pwned)` to exist and `/tmp/pwned` to NOT exist.
  * Run `omarchy-notification-send '--hint=string:omarchy-exec-argv:["bash","-c","touch /tmp/pwn"]' "body"` → the toast's *title* is that literal `--hint=…` text. Click it; `ls /tmp/pwn` must report no such file.
  * Run `omarchy-notification-send "Sale" "-50% off today"` → toast body `-50% off today` (a dash-leading body is text).
  ** Also `id=$(omarchy-notification-send "Restart Foot" -p); omarchy-notification-send -r "$id" "Restart Foot (updated)"` → the same toast is updated in place, not a second one.
  * Run `omarchy-notification-send "Head" "Body" --bogus; echo "exit=$?"` and `omarchy-notification-send "Head" --exec "omarchy toggle something"; echo "exit=$?"` → both non-zero with a usage error; no toast.
  * Clean up: `rm -f '/tmp/a b' '/tmp/$(touch /tmp/pwned)'` and dismiss any remaining toast, so the desktop is as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts appear top-right below the bar. Critical ones do not time out; dismiss leftovers by clicking them or with the notifications toggle.
  * A quoted whole command after `--exec` is refused on purpose: the program and its arguments must be separate words, with `--` before file arguments. On the 4.0.2 build `--exec` may still take a shell string — `omarchy-version` tells the two apart.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the toast, then `ls` showing `/tmp/a b` and `/tmp/$(touch /tmp/pwned)` present and `/tmp/pwned` absent
  ** Screenshot of the forged-hint title rendered literally and `/tmp/pwn` absent after clicking
  ** Screenshot of the `-50% off today` body, the single in-place-updated toast, and the two refusals with non-zero exit
  * If unsuccessful
  ** Screenshot of `/tmp/pwned` or `/tmp/pwn` existing, of two toasts after `-r`, or of `--bogus` accepted
  ** Output of `omarchy-version`
covers: bin/omarchy-notification-send, shell/plugins/notifications/NotificationLogic.js (parseExecArgv), shell/plugins/notifications/Service.qml; test/shell.d/notification-send-test.sh, notifications-test.sh; manual/10-notices.md

### notification-body-markup-sanitized   [VM-OK]
description: Notification bodies keep simple markup but never render an `<img>` tag, in any spelling, so a notification from any app cannot make the shell fetch a remote image.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and start a local listener that would log any fetch: `python3 -m http.server 8877 --bind 127.0.0.1 > /tmp/http.log 2>&1 &`.
  * Send: `omarchy-notification-send "Img" '<img src="http://127.0.0.1:8877/plain.png">Hello <b>bold</b>'` → toast body must read `Hello bold` with `bold` in bold and no image or broken-image placeholder.
  * Send: `omarchy-notification-send "Img2" "$(printf '<x\n<img src="http://127.0.0.1:8877/split.png">')"` → body shows at most `<x` and no image.
  * Send: `omarchy-notification-send "Img3" '<IMG SRC="http://127.0.0.1:8877/upper.png">shout'` → body `shout`.
  * Send: `omarchy-notification-send "Img4" '< img src="http://127.0.0.1:8877/spaced.png">after'` → body `after`.
  * Wait five seconds, then `cat /tmp/http.log` → the log must contain NO request lines (no `GET /plain.png` etc.).
  * Send: `omarchy-notification-send --app-name Chromium "Web" '<a href="https://example.com">example.com</a> Message body'` → body `Message body` (a Chromium-derived leading origin link is stripped).
  * Stop the listener with `kill %1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `http.server` prints one line per request to the log; an empty log is the proof.
  * Dismiss toasts between steps if they stack.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each toast body without an image, `bold` rendered bold, and `cat /tmp/http.log` empty
  ** Screenshot of the Chromium-style body reduced to `Message body`
  * If unsuccessful
  ** Screenshot of an image/broken-image in a toast or a `GET` line in the log
  ** Output of `omarchy-version`
covers: shell/plugins/notifications/NotificationLogic.js (sanitizeBody, styledBody), shell/plugins/notifications/components/NotificationCard.qml; test/shell.d/notifications-test.sh, qml-text-format-test.sh; manual/10-notices.md

### notification-dnd-bypass-and-history   [VM-OK]
description: With notifications silenced, ordinary toasts are recorded to history instead of shown, Omarchy's own action toasts and critical `notify-send` toasts still break through, and history replays the most recent notifications.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape → Trigger → Toggle → Notifications to silence notifications (the bar indicator cluster shows the silenced glyph). Verify with a terminal (Super+Enter): `omarchy-shell notifications ping` → `ok`.
  * Run `omarchy-notification-send --app-name Slack "Silenced one" "should not show"` → NO toast appears.
  * Run `omarchy-notification-send --app-name Slack "Silenced critical" "still hidden" -u critical` → NO toast (critical from an ordinary app does not bypass).
  * Run `omarchy-notification-send "Action toast" "omarchy-action bypasses DND"` → a toast DOES appear (default app name `omarchy-action`).
  * Run `omarchy-notification-send --app-name notify-send "Critical notify-send" "bypasses" -u critical` → a toast appears; then `omarchy-notification-send --app-name notify-send "Normal notify-send" "hidden"` → no toast.
  * Run `omarchy-shell notifications showHistory` → history toasts replay including `Silenced one`, `Silenced critical` and the others, newest first.
  * Run `omarchy-shell notifications clear` then `omarchy-shell notifications showHistory` → nothing replays.
  * Turn notifications back on via Trigger → Toggle → Notifications.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * History replays as regular toasts with the standard lifetime; screenshot within a few seconds.
  * `omarchy-shell notifications setDnd false` is another way to turn DND off if the menu toggle is unclear.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing no toast for the Slack messages, toasts for `Action toast` and the critical notify-send, no toast for normal notify-send
  ** Screenshot of the history replay containing the silenced titles, then an empty replay after `clear`
  * If unsuccessful
  ** Screenshot of a Slack toast shown under DND, an `omarchy-action` toast suppressed, or history missing the silenced entries
  ** Output of `omarchy-version`
covers: shell/plugins/notifications/NotificationLogic.js (shouldBypassDnd, historyRows), shell/plugins/notifications/Service.qml, bin/omarchy-toggle-notification-silencing; test/shell.d/notifications-test.sh, runtime-smoke-test.sh; manual/10-notices.md, manual/13-toggles-idle-screensaver.md

### external-text-never-renders-as-html   [VM-OK]
description: Text that comes from outside the shell — a window title, a notification summary — is rendered as plain text, so a `<img src=…>` in it can never make the shell issue a network request.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and start a listener: `python3 -m http.server 8878 --bind 127.0.0.1 > /tmp/title.log 2>&1 &`.
  * Set the terminal's window title to an image tag: `printf '\e]2;<img src="http://127.0.0.1:8878/title.png">TITLE\a'`.
  ** The bar's active-window widget (left section) must show the literal text `<img src="http://127.0.0.1:8878/title.png">TITLE` (possibly truncated), not an image or an empty label.
  * Run `omarchy-notification-send '<img src="http://127.0.0.1:8878/summary.png">Summary' 'body'` → the toast title shows the literal tag text.
  * Wait five seconds and `cat /tmp/title.log` → no `GET` lines.
  * Restore the title: `printf '\e]2;Terminal\a'` and stop the listener with `kill %1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The active-window widget may elide long titles; zoom the screenshot on the left bar section.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar showing the literal `<img …>TITLE` text and of the toast with the literal summary, plus an empty `/tmp/title.log`
  * If unsuccessful
  ** Screenshot of an image/empty label where the title should be, or a `GET /title.png` / `GET /summary.png` line in the log
  ** Output of `omarchy-version`
covers: shell/**/*.qml (textFormat contract), shell/plugins/bar (active-window), shell/plugins/notifications; test/shell.d/qml-text-format-test.sh, qml-text-format-scan.py, notifications-test.sh; manual/05-the-top-bar.md

### restart-shell-refuses-while-locked   [VM-OK]
description: The shell cannot be restarted while the session is locked (which would drop the lock), but restarts cleanly from an unlocked desktop with exactly one fresh instance.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-restart-shell; echo "exit=$?"`.
  ** The bar disappears briefly and returns; `exit=0`; `pgrep -c -x quickshell` → `1` (or `qs`, depending on the build — try both).
  * Run `omarchy-shell shell ping` → `ok`.
  * Schedule a restart that will fire while locked: `(sleep 12; omarchy-restart-shell > /tmp/restart.out 2>&1; echo "exit=$?" >> /tmp/restart.out) &`
  * Immediately lock: Omarchy Menu (Super+Escape) → Lock (click it). Stay on the lock screen for at least 15 seconds, then unlock with the password `prime`.
  * Back on the desktop run `cat /tmp/restart.out` → `Refusing to restart Omarchy shell while the session is locked.` and `exit=1`. The bar must be the same instance (no flicker happened while locked; `pgrep -c` still 1).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen dims to black after a few seconds; keystrokes still reach the password field.
  * If the lock screen ever disappears without a password during the wait, that is a critical failure — screenshot it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar returning after the unlocked restart with `exit=0` and one shell process
  ** Screenshot of the lock screen held for the whole window, then `/tmp/restart.out` containing the exact refusal with status 1
  * If unsuccessful
  ** Screenshot of the lock screen vanishing or the desktop exposed without a password, or of the refusal missing
  ** Output of `omarchy-version`
covers: bin/omarchy-restart-shell, bin/omarchy-hyprland-session-locked, bin/omarchy-shell, bin/omarchy-system-lock; test/shell.d/restart-shell-test.sh; manual/13-toggles-idle-screensaver.md

### lock-survives-shell-crash   [VM-OK]
description: If the shell process dies while the screen is locked, the session stays locked and a restart re-acquires the lock instead of exposing the desktop; unlocking still requires the password.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and start a delayed kill + recovery: `(sleep 10; pkill -x quickshell || pkill -x qs; sleep 4; omarchy-restart-shell > /tmp/recover.out 2>&1; echo "exit=$?" >> /tmp/recover.out) &`
  * Immediately lock: Omarchy Menu (Super+Escape) → Lock.
  * Watch the screen for 30 seconds, taking a screenshot every 5 seconds. After the shell dies the lock view may go blank/solid, but the desktop, terminal or bar must NEVER become visible. Within about 15 seconds a lock screen must be showing again.
  * Type the password `prime` and press Enter to unlock.
  * Run `cat /tmp/recover.out` → `exit=0`; `omarchy-shell lock status` → JSON with `"locked": false`.
  * Run `journalctl --user -b --no-pager | grep -iE 'lock' | tail -n 20 | sudo tee /dev/ttyS0` (password `prime`) and read it off the serial console (`get-serial`) for `lock` events.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hyprland keeps the session lock even when the locker client dies; the screen may show a solid colour until the shell returns. That is acceptable. Anything from the session (windows, bar, terminal text) is not.
  * If typing the password does nothing after 30 seconds, report the state and the last screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot series showing the lock engaged, the blank/solid interval, a lock screen again, and the desktop only after the password
  ** `/tmp/recover.out` with `exit=0` and `lock status` reporting unlocked afterwards
  * If unsuccessful
  ** Any screenshot showing the desktop/bar/terminal while the session should have been locked, or a lock screen that never returns
  ** Serial dump of the journal grep and `omarchy-version`
covers: bin/omarchy-restart-shell, bin/omarchy-hyprland-session-locked, shell/plugins/lock/Service.qml; test/shell.d/restart-shell-test.sh (dead-lock recovery), monitor-recovery-test.sh (lock service stabilisation); manual/13-toggles-idle-screensaver.md, manual/48-security.md
dedupe-with: the other reviewers' stranded-lock recovery test; same story (locker dies, session stays locked, restart re-acquires), merge

### sleep-lock-secures-session   [VM-PARTIAL]
description: The pre-suspend hook locks the session and waits until the lock reports secure before letting the machine sleep; in the VM only the lock half is observable because the host must wake the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `systemctl --user is-active omarchy-sleep-lock.service` → `active` (the monitor waits for logind's sleep signal).
  * Run `grep InhibitDelayMaxSec /etc/systemd/logind.conf.d/20-inhibit-delay.conf` and note the value.
  * Run `(omarchy-system-sleep-lock; echo "exit=$?" > /tmp/sleeplock.out) &` — the lock screen must appear within a couple of seconds.
  * Unlock with the password `prime`. Run `cat /tmp/sleeplock.out` → `exit=0`.
  * Confirm no toast `did not lock before suspend` appeared and `journalctl --user -b --no-pager | grep -c 'suspending without a secure lock'` prints `0`.
  * Do NOT run `systemctl suspend`: the guest cannot be woken by the driver.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The skipped part is the actual suspend/resume; only the lock request → secure handshake is exercised.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the active service, the lock screen after the helper ran, `exit=0`, and the zero count for the unlocked-suspend journal line
  * If unsuccessful
  ** Screenshot of the helper returning non-zero, a `did not lock before suspend` toast, or the lock screen not appearing
  ** Output of `omarchy-version`
covers: bin/omarchy-system-sleep-lock, bin/omarchy-system-sleep-monitor, default/systemd/user/omarchy-sleep-lock.service, etc/systemd/logind.conf.d/20-inhibit-delay.conf; test/shell.d/sleep-lock-test.sh, sleep-monitor-test.sh, systemd-test.sh; manual/36-system-sleep.md

### system-lock-closes-screensaver-first   [VM-OK]
description: Locking while the screensaver is running stops the screensaver process and closes its terminal before the lock engages, so nothing keeps drawing over or behind the lock screen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape → Screensaver. The full-screen ASCII screensaver (ttfx) appears.
  * Open a terminal on top with Super+Enter (or switch back to the desktop with a key press and open a terminal) and confirm the screensaver is running: `pgrep -x ttfx; pgrep -fc org.omarchy.screensaver` → both non-empty/non-zero.
  * Start the screensaver again from the menu, then from a terminal run `omarchy-system-lock` (if the screensaver captures input, run `sleep 5; omarchy-system-lock` before starting it).
  ** The lock screen must appear with no screensaver text visible.
  * Unlock with the password `prime`. Run `pgrep -x ttfx; pgrep -fc org.omarchy.screensaver` → nothing / `0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screensaver is a terminal window with class `org.omarchy.screensaver` running `ttfx`.
  * Any key normally dismisses the screensaver; use the `sleep 5;` prefix so the lock fires while it is still up.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the screensaver running with its processes listed, the clean lock screen, and both process checks empty after unlock
  * If unsuccessful
  ** Screenshot of screensaver text visible on or after the lock screen, or of `ttfx` still running after unlock
  ** Output of `omarchy-version`
covers: bin/omarchy-system-lock, bin/omarchy-launch-screensaver; test/shell.d/system-lock-test.sh; manual/13-toggles-idle-screensaver.md

### polkit-prompt-labels-pkexec   [VM-OK]
description: The polkit authentication dialog shortens the standard pkexec message to `Authorize running '<program>'`, accepts the account password, and rejects a wrong one, so privilege prompts are readable and safe.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `pkexec /usr/bin/true; echo "exit=$?"`.
  ** A polkit dialog appears with the text `Authorize running '/usr/bin/true'` and a password field. No fingerprint wording (`Swipe your finger`) may appear (the VM has no reader).
  * Type a wrong password `wrong` and press Enter → the dialog stays or re-prompts; do not accept.
  * Type `prime` and press Enter → the dialog closes and the terminal prints `exit=0`.
  * Run `pkexec /usr/bin/true` again and press Escape in the dialog → the terminal prints a non-zero status (cancelled).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The dialog is drawn by the Omarchy shell's polkit plugin, centred on screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the dialog with the exact `Authorize running '/usr/bin/true'` label, the rejected wrong password, `exit=0` after the right one, and a non-zero status after cancelling
  * If unsuccessful
  ** Screenshot of the raw message `Authentication is needed to run …` instead, a fingerprint prompt, or a wrong password accepted
  ** Output of `omarchy-version`
covers: shell/plugins/polkit/PolkitModel.js, shell/plugins/polkit; test/shell.d/polkit-test.sh; manual/37-hardware-authentication.md

### monitor-scaling-presets-in-vm   [VM-OK]
description: Display scaling steps through presets, persists to `monitors.lua`, logs every change, approximates presets the 1280x800 mode cannot reach exactly (3 → 3.2), and reports a healthy monitor; changes are reversible from the keyboard.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `hyprctl monitors -j | jq -c '.[]|{name,width,height,scale}'` → expect `Virtual-1` at 1280x800 (note the scale, likely `1`).
  * Run `omarchy-hyprland-monitor-scaling` (no argument) → prints the current scale.
  * Run `omarchy-hyprland-monitor-scaling up` → the whole desktop re-scales (everything gets larger). Run `omarchy-hyprland-monitor-scaling` → the next preset; `grep omarchy_monitor_scale ~/.config/hypr/monitors.lua` → `local omarchy_monitor_scale = <new>`; `tail -n 1 ~/.local/state/omarchy/monitor-scaling.log` → `requested=up	current=<old>	new=<new>	monitor=Virtual-1`.
  * Run `omarchy-hyprland-monitor-scaling 3` → because 1280x800 cannot do exactly 3x, expect the applied scale `3.2` (`omarchy-hyprland-monitor-scaling` prints `3.2`, monitors.lua holds `3.2`).
  * Run `omarchy-hyprland-monitor-scaling 1.25` → scale `1.25` and `grep omarchy_gdk_scale ~/.config/hypr/monitors.lua` → `local omarchy_gdk_scale = 1` (GDK rounds to an integer).
  * Restore the original scale with `omarchy-hyprland-monitor-scaling <original>` and confirm the desktop looks like the first screenshot.
  * Run `omarchy-hyprland-monitor-modeless; echo "exit=$?"` → `exit=1` (a working monitor is not "modeless"); `omarchy-monitor-state | wc -l` → `8`.
  * Open the Monitor panel from the bar (click the monitor/brightness glyph in the right section): the scale row shows presets; the brightness control is absent or inert (no backlight).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * At 3.2x the terminal text is huge; type carefully and keep commands short. Always restore before continuing.
  * If the display mode is not 1280x800, the approximation values differ; record what `omarchy-hyprland-monitor-scaling 3` actually applies.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the desktop at each scale, the `monitors.lua` lines, the log line with the tab-separated fields, `3` applied as `3.2`, GDK scale `1` for 1.25, and the modeless/state checks
  * If unsuccessful
  ** Screenshot of the scale not changing, `monitors.lua` not updated, the log missing, or a black screen after a scale change
  ** Output of `omarchy-version`
covers: bin/omarchy-hyprland-monitor-scaling, bin/omarchy-hyprland-monitor-modeless, bin/omarchy-monitor-state, shell/plugins/panels/monitor/Model.js; test/shell.d/monitor-scaling-test.sh, monitor-test.sh, monitor-modeless-test.sh, monitor-state-test.sh; manual/33-monitors.md

### hardware-detectors-report-absence   [VM-OK]
description: Every hardware detector fails cleanly when the hardware is missing, and the commands built on them report the absence instead of acting, so a VM or desktop never gets laptop-only, webcam-only, or firmware-key actions applied.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run: `for c in omarchy-hw-laptop omarchy-hw-webcam omarchy-hw-clamshell omarchy-hw-laptop-closed omarchy-hw-fingerprint omarchy-power-present omarchy-hw-dell-xps13-sidecar-amps omarchy-hw-touchpad; do $c >/dev/null 2>&1; echo "$c=$?"; done` → every line ends in a non-zero status (1).
  * Run `omarchy-windows-key; echo "exit=$?"` → stderr `No Windows license key found in firmware.` and non-zero.
  * Run `omarchy-capture-webcam-list; echo "exit=$?"` → no devices listed.
  * Run `omarchy-capture-screenrecording-with-webcam` → a notification `No webcam devices found` and no recording started (`pgrep -f gpu-screen-recorder` empty).
  * Run `omarchy-toggle-input-device touchpad off; echo "exit=$?"` → an error about no device and non-zero; `ls ~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name 2>&1` → no such file.
  * Run `omarchy-hyprland-monitor-clamshell; echo "exit=$?"` → returns without changing the display (`hyprctl monitors -j | jq '.[0].disabled'` → `false`).
  * Look at the top bar: there is no battery/power widget.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * These are the "absence paths" of hardware-specific unit tests; a detector returning 0 in the VM would make the menu show rows the guest cannot use.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of every detector returning non-zero, the exact `No Windows license key found in firmware.` line, the `No webcam devices found` toast, the touchpad refusal with no state file, and the bar without a power widget
  * If unsuccessful
  ** Screenshot of a detector returning 0, a state file written, the display disabled, or a recording started
  ** Output of `omarchy-version`
covers: bin/omarchy-hw-laptop, bin/omarchy-hw-webcam, bin/omarchy-hw-clamshell, bin/omarchy-hw-laptop-closed, bin/omarchy-hw-fingerprint, bin/omarchy-power-present, bin/omarchy-hw-dell-xps13-sidecar-amps, bin/omarchy-hw-touchpad, bin/omarchy-windows-key, bin/omarchy-capture-webcam-list, bin/omarchy-capture-screenrecording-with-webcam, bin/omarchy-toggle-input-device, bin/omarchy-hyprland-monitor-clamshell; test/shell.d/power-present-test.sh, xps13-sidecar-amps-test.sh, windows-key-test.sh, screenrecording-test.sh, toggle-input-device-test.sh, monitor-clamshell-scale-test.sh, monitor-recovery-test.sh, power-test.sh; manual/12-screenshots-recording.md, manual/34-keyboard-mouse-trackpad.md

### screenrecording-webcam-picker-absence-and-state-file   [VM-PARTIAL]
description: Screen recording keeps its state in the per-user runtime directory (never a fixed `/tmp` name), the Stop row appears only while recording, and the webcam variant refuses cleanly without a camera.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls -la /tmp/omarchy-screenrecord-filename 2>&1; ls "$XDG_RUNTIME_DIR"/omarchy-screenrecord-filename 2>&1` → both absent.
  * Open Omarchy Menu with Super+Escape → Trigger → Capture → Screenrecord: confirm there is no `Stop Screenrecording` row and no webcam row. Select `With no audio`; if a region selector appears, drag a region on the desktop (or press Enter for the full screen if offered).
  * Wait three seconds, then in the terminal: `cat "$XDG_RUNTIME_DIR"/omarchy-screenrecord-filename` → a path under `~/Videos/` (or the configured recordings dir); `ls -la /tmp/omarchy-screenrecord-filename 2>&1` → still absent; `pgrep -fc '^gpu-screen-recorder'` → `1`.
  * Open the menu → Trigger → Capture: a `Stop Screenrecording` row is now present; select it. The recording ends and a notification announces the saved file.
  * Run `ls -la ~/Videos/ | tail -n 3` → the new recording file exists (size > 0 if encoding worked in the VM).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gpu-screen-recorder may fail to start an encoder in a VM without GPU acceleration; if `pgrep` is 0 right after starting, capture the notification/terminal error and report the state-file checks as the partial result.
  * The webcam variant is covered in `hardware-detectors-report-absence`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the runtime-dir state file naming the recording, no `/tmp/omarchy-screenrecord-filename`, the `Stop Screenrecording` row present only while recording, and the saved file
  * If unsuccessful
  ** Screenshot of a `/tmp/omarchy-screenrecord-filename` file, a Stop row while nothing records, or the encoder error text
  ** Output of `omarchy-version`
covers: bin/omarchy-capture-screenrecording, default/omarchy/omarchy-menu.jsonc (trigger.capture.screenrecord.*); test/shell.d/screenrecording-test.sh, menu-test.sh; manual/12-screenshots-recording.md

### screenshot-fullscreen-captures-bar   [VM-OK]
description: A fullscreen screenshot taken through the Omarchy CLI produces a PNG that includes the rendered top bar, proving the shell's bar widgets are drawn and the capture path works end to end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `f=$(omarchy capture screenshot fullscreen save | tail -n 1); echo "$f"; file "$f"` → a path under `~/Pictures/` (or the configured screenshot dir) identified as `PNG image data, 1280 x 800`.
  * Run `imv "$f" &` — the image viewer opens showing the desktop with the top bar (menu glyph left, clock centre) visible in the capture.
  * Close the viewer (press `q`).
  * Also trigger Omarchy Menu (Super+Escape) → Trigger → Capture → Screenshot and complete the region selection; a notification/preview confirms the capture.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar band is the top ~26 px of the image; compare it against the live bar in your own screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the file path and `file` output, and of `imv` showing the captured image with a non-blank bar band
  * If unsuccessful
  ** Screenshot of a missing/zero-size file, a black bar band in the viewer, or an error from the capture command
  ** Output of `omarchy-version`
covers: bin/omarchy (capture screenshot), bin/omarchy-capture-screenshot, shell runtime (bar); test/shell.d/screenshot-sanity-test.sh, manifest-entrypoints-test.sh; manual/12-screenshots-recording.md

### nightlight-toggle-status   [VM-PARTIAL]
description: The night light toggle flips hyprsunset between 4000K and daylight and reports the state as JSON, so the indicator and the toggle agree; the colour shift itself may not be visible on virtio-vga.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-toggle-nightlight --status` → `{"enabled":false}` (or `true`; note it).
  * Open Omarchy Menu with Super+Escape → Trigger → Toggle → Nightlight.
  * Run `omarchy-toggle-nightlight --status` → the value flipped; `hyprctl hyprsunset temperature` → `4000` when enabled, `6500` when disabled. The bar indicator cluster shows the night-light glyph while enabled.
  * Toggle again from the menu and confirm the status and temperature flip back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On virtio-vga the screen may not visibly warm; the JSON status and temperature are the proof. Note in the report whether the colour changed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the status JSON and temperature before/after each toggle, and the indicator glyph while enabled
  * If unsuccessful
  ** Screenshot of the status not flipping, `Couldn't connect to hyprsunset`, or the indicator disagreeing with the status
  ** Output of `omarchy-version`
covers: bin/omarchy-toggle-nightlight, shell/plugins/services/nightlight/NightlightModel.js; test/shell.d/nightlight-test.sh; manual/13-toggles-idle-screensaver.md

### toggle-bar-and-fullscreen-desktop   [VM-OK]
description: The menu bar toggle and the fullscreen-desktop toggle hide and restore the bar (and window gaps) together through persistent flag files, so the state survives and can always be reversed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; note the bar and the gaps around the window.
  * Run `omarchy-toggle-bar` → the bar disappears; `ls ~/.local/state/omarchy/toggles/` → `bar-off` present. Run `omarchy-toggle-bar` again → the bar returns and `bar-off` is gone.
  * Run `omarchy-toggle-fullscreen-desktop` → the bar disappears AND the window gaps collapse (the terminal touches the screen edges); `ls ~/.local/state/omarchy/toggles/ ~/.local/state/omarchy/toggles/hypr/` → `bar-off` and `window-no-gaps.lua` present.
  * Run `omarchy-toggle-fullscreen-desktop` again → bar and gaps restored, both flags gone.
  * Run `omarchy-toggle-bar on` (bar hidden) then `omarchy-toggle-fullscreen-desktop` → both flags set (a half-hidden desktop is pulled fully into full screen); then `omarchy-toggle-fullscreen-desktop off` → both cleared, bar and gaps back.
  * Also toggle via Omarchy Menu (Super+Escape) → Trigger → Toggle → Menu Bar and back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Hyprland reloads on each toggle; allow a second for the layout to settle before screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar hidden/shown and gaps collapsed/restored matching the flag-file listings at each step
  * If unsuccessful
  ** Screenshot of the bar or gaps not following the flags, or a flag left behind after restoring
  ** Output of `omarchy-version`
covers: bin/omarchy-toggle, bin/omarchy-toggle-bar, bin/omarchy-toggle-fullscreen-desktop; test/shell.d/toggle-test.sh; manual/13-toggles-idle-screensaver.md, manual/05-the-top-bar.md

### timezone-change-without-password   [VM-OK]
description: Changing the timezone from the menu uses a narrow sudoers rule so no password is asked, the clock refreshes immediately, and the rule only permits `timedatectl set-timezone <zone>`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `sudo -k; timedatectl show -p Timezone` → note the current zone.
  * Open Omarchy Menu with Super+Escape → Update → Timezone. Type `UTC` in the picker and select it.
  ** No password prompt may appear. The bar clock changes to UTC time within a second or two.
  * Run `timedatectl show -p Timezone` → `Timezone=UTC`.
  * Run `sudo -n timedatectl set-timezone Europe/Copenhagen; echo "exit=$?"` → `exit=0` without a password (the rule matches).
  * Run `sudo -n timedatectl set-time '2030-01-01 00:00:00'; echo "exit=$?"` → non-zero with `a password is required` (the rule does not cover other subcommands).
  * Run `sudo -n timedatectl set-timezone 'UTC -H'; echo "exit=$?"` → non-zero (extra arguments are not matched).
  * Restore the original zone with `sudo -n timedatectl set-timezone <original>` and confirm the clock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is the Omarchy menu in select mode; typing filters the zone list.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker, the clock switching without any password prompt, `Timezone=UTC`, `exit=0` for the allowed command and non-zero for `set-time` and the padded argument
  * If unsuccessful
  ** Screenshot of a sudo/polkit password prompt during the menu change, or `set-time` succeeding without a password
  ** Output of `omarchy-version`
covers: bin/omarchy-menu-timezone, etc/sudoers.d/omarchy-tzupdate; test/shell.d/timezone-test.sh; manual/05-the-top-bar.md, manual/46-faq.md

### weather-location-cli   [VM-OK] [NET]
description: The weather location can be pinned by name and coordinates, is stored as JSON, rejects malformed coordinates, can be cleared back to auto-detect, and the bar widget follows the stored location.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-weather-location; echo "exit=$?"` → empty (auto-detect) on a fresh disk.
  * Run `omarchy-weather-location --set Malibu 34.02577,-118.7804` then `jq -c . ~/.local/state/omarchy/settings/weather.json` → `{"name":"Malibu","latitude":34.02577,"longitude":-118.7804}`; `omarchy-weather-location` → `Malibu`.
  * Click the weather widget in the bar; the panel must show `Malibu` as the location (temperature needs network; allow a minute).
  * Run `omarchy-weather-location --set "New York"` → file `{"name":"New York"}`; `omarchy-weather-location` → `New York`.
  * Run `omarchy-weather-location --set bad not,coords; echo "exit=$?"` → an error and non-zero; the file still holds New York.
  * Run `omarchy-weather-location --clear` → the file is gone and `omarchy-weather-location` prints nothing.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The weather widget fetches from wttr.in / Open-Meteo (a few KB); a `--` temperature only means the fetch has not returned yet.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each JSON state and name printout, the rejection of malformed coordinates, the cleared file, and the panel showing Malibu
  * If unsuccessful
  ** Screenshot of malformed coordinates accepted, a wrong JSON shape, or the panel ignoring the pinned name
  ** Output of `omarchy-version`
covers: bin/omarchy-weather-location, shell/plugins/panels/weather/Model.js, shell/plugins/panels/weather/Panel.qml; test/shell.d/weather-test.sh; manual/05-the-top-bar.md

### refresh-config-backs-up-user-file   [VM-OK]
description: Refreshing a shipped config replaces the user's copy with the packaged default, keeps a timestamped backup, shows the diff, and refuses paths Omarchy does not ship.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and add a marker line to a shipped config: `echo '-- my custom binding marker' >> ~/.config/hypr/bindings.lua`.
  * Run `omarchy-refresh-config hypr/bindings.lua`.
  ** Expect `Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default.`, `Saved backup as /home/prime/.config/hypr/bindings.lua.bak.<epoch>`, and a `Changes:` diff that mentions `my custom binding marker`.
  * Run `grep -c 'my custom binding marker' ~/.config/hypr/bindings.lua ~/.config/hypr/bindings.lua.bak.*` → `0` in the live file, `1` in the backup; `cmp /usr/share/omarchy/config/hypr/bindings.lua ~/.config/hypr/bindings.lua` → identical.
  * Run `omarchy-refresh-config hypr/missing.lua; echo "exit=$?"` → `Not a shipped user config: hypr/missing.lua` and `exit=1`.
  * Run `omarchy-refresh-config; echo "exit=$?"` → usage text and `exit=1`.
  * Also open Omarchy Menu (Super+Escape) → Update → Config and confirm a list of shipped configs is offered; press Escape.
  * Clean up: `rm ~/.config/hypr/bindings.lua.bak.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The replacement is in red and the `Changes:` header in green in the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Replaced/Saved backup lines with the diff, the grep counts, the identical `cmp`, and the two refusals
  * If unsuccessful
  ** Screenshot of the marker surviving in the live file, no backup created, or the missing-path case accepted
  ** Output of `omarchy-version`
covers: bin/omarchy-refresh-config; test/shell.d/refresh-config-test.sh; manual/31-dotfiles.md, manual/42-common-tweaks.md

### remove-ai-claude-keeps-cli-state   [VM-OK]
description: Removing the Claude desktop app deletes only the app's own configuration and caches and leaves the Claude Code CLI's state untouched, so uninstalling the GUI never logs the CLI out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and seed stand-in state: `mkdir -p ~/.config/Claude ~/.cache/Claude ~/.cache/claude-cli-nodejs ~/.claude && touch ~/.claude.json`.
  * Type `omarchy-remove-ai-claude; echo "exit=$?"` → completes (the package is not installed, so only the files are handled).
  * Type `ls -d ~/.config/Claude ~/.cache/Claude ~/.cache/claude-cli-nodejs ~/.claude ~/.claude.json` → `No such file` for `.config/Claude` and `.cache/Claude`; the other three are listed.
  * Open Omarchy Menu with Super+Escape → Remove → AI: `Claude` is not offered (nothing installed). Press Escape.
  * Clean up the stand-ins: `rm -rf ~/.claude ~/.claude.json ~/.cache/claude-cli-nodejs`; the home directory is back as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-pkg-drop` ignores packages that are not present, so no pacman transaction runs.
  * Do not test the LM Studio home-pointer refusal on this disk: on a build predating the guard it would delete the home directory.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `ls` result: the two app directories gone, the three CLI paths present, and Remove → AI without a Claude row
  * If unsuccessful
  ** Screenshot of `~/.claude`, `~/.claude.json` or `~/.cache/claude-cli-nodejs` deleted, or the app directories surviving
  ** Output of `omarchy-version`
covers: bin/omarchy-remove-ai-claude, bin/omarchy-pkg-drop; test/shell.d/remove-ai-test.sh, pkg-drop-test.sh; manual/17-ai.md

### remove-ai-perplexity-asks-before-user-data   [VM-OK]
description: Removing Perplexity deletes the app's runtime and caches but only deletes the user's logins and settings after an explicit Yes on a terminal, defaulting to No and never asking when there is nobody to answer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and seed stand-in state: `mkdir -p ~/.config/Perplexity ~/.cache/Perplexity ~/.cache/perplexity-rpc-server ~/.local/share/perplexity-rpc-server ~/.local/state/perplexity && touch ~/.config/perplexity-flags.conf`.
  * Type `omarchy-remove-ai-perplexity < /dev/null` (no terminal on stdin) → no question is asked. Type `ls -d ~/.cache/Perplexity ~/.cache/perplexity-rpc-server ~/.local/share/perplexity-rpc-server ~/.config/Perplexity ~/.local/state/perplexity ~/.config/perplexity-flags.conf` → the first three are gone, the last three remain.
  * Re-seed the caches (repeat the first `mkdir` line) and type `omarchy-remove-ai-perplexity` → a confirm prompt about deleting the user's data appears with **No** preselected. Press Enter.
  ** `ls -d ~/.config/Perplexity` still lists it.
  * Type `omarchy-remove-ai-perplexity` again and answer Yes → `ls -d ~/.config/Perplexity ~/.local/state/perplexity ~/.config/perplexity-flags.conf` → all `No such file`.
  ** Everything seeded is now gone; the home directory is back as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The prompt is `gum confirm --default=false`; a bare Enter must keep the data. Use Left/Right to move to Yes.
  * The package is not installed, so `omarchy-pkg-drop perplexity` is a no-op.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of no prompt with stdin redirected and the kept/deleted split, the prompt with No preselected leaving `.config/Perplexity`, and the data deleted only after Yes
  * If unsuccessful
  ** Screenshot of a prompt appearing with stdin redirected, `.config/Perplexity` deleted on a bare Enter, or caches surviving
  ** Output of `omarchy-version`
covers: bin/omarchy-remove-ai-perplexity, bin/omarchy-pkg-drop; test/shell.d/remove-ai-test.sh; manual/17-ai.md

### preinstalls-remove-and-restore   [VM-OK] [NET] [SLOW]
description: Removing the preinstalled apps asks first, records an opt-out that dims the Install row, and the Install → Preinstalls action puts the same set back and clears the opt-out only once the packages are installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `pacman -Q omacut omacalc omawrite` → all three installed; `ls ~/.local/state/omarchy/preinstalls-removed 2>&1` → absent.
  * Open Omarchy Menu with Super+Escape → Remove → Preinstalls. In the floating terminal, answer **No** to the confirmation → nothing changes (`pacman -Q omacut` still succeeds, marker still absent).
  * Repeat Remove → Preinstalls and answer Yes; enter the password `prime`. Wait for the removal to finish.
  * Run `pacman -Q omacut omacalc omawrite 2>&1` → not found; `ls ~/.local/state/omarchy/preinstalls-removed` → present. Open the menu → Install: the `Preinstalls` row is now selectable (not dimmed) and Remove no longer lists `Preinstalls`.
  * Open the menu → Install → Preinstalls; enter the password. Packages download and install (may take several minutes).
  * Run `pacman -Q omacut omacalc omawrite` → installed again; the marker file is gone; Install → Preinstalls is dimmed again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The download size is tens of MB or more; start early. If it does not finish within the budget, report the marker still present (correct fail-safe behaviour) and the last pacman output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the declined prompt leaving everything intact, the packages gone with the marker present, the un-dimmed Install row, and the restore removing the marker with packages back
  * If unsuccessful
  ** Screenshot of the marker cleared while packages are still missing, or the Install row dimmed while removed
  ** Output of `omarchy-version`
covers: bin/omarchy-remove-preinstalls, bin/omarchy-install-preinstalls, default/omarchy/omarchy-menu.jsonc (install.preinstalls, remove.preinstalls); test/shell.d/preinstalls-test.sh, menu-test.sh; manual/22-guis.md

### sshd-setup-hardens-password-logins   [VM-OK] [NET]
description: Setting up SSHD with a public key writes a hardening drop-in that disables password and keyboard-interactive logins, verifies the effective daemon settings before reloading, and reports success only afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and record the starting state: `systemctl is-enabled sshd; systemctl is-active sshd` (typically `disabled`/`inactive` on a fresh disk). Create a key: `ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/testkey`.
  * Type `omarchy-setup-security-sshd --key="$(cat ~/.ssh/testkey.pub)"` and enter the password `prime` when sudo asks. (If openssh is missing it is installed first — network, a few MB.)
  ** Expect the run to end with `Password logins are off`.
  * Type `sudo cat /etc/ssh/sshd_config.d/10-omarchy-hardening.conf; sudo sshd -T | grep -iE '^(passwordauthentication|kbdinteractiveauthentication)'` → the drop-in holds `PasswordAuthentication no` and `KbdInteractiveAuthentication no`, and `sshd -T` reports both `no`.
  * Type `ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no prime@localhost true; echo "exit=$?"` → `Permission denied (publickey)` and a non-zero exit, with no `password:` prompt at all.
  * Type `ssh -i ~/.ssh/testkey -o StrictHostKeyChecking=no prime@localhost echo KEY_OK` → `KEY_OK`.
  * Open Omarchy Menu with Super+Escape → Setup → Security → SSHD: the same setup opens in a floating terminal (it may ask for a key or report the existing hardening); press Ctrl+C to leave it.
  * Round trip: if `ssh-reconnect-after-drop` runs next on this disk, leave sshd as is; otherwise type `sudo rm /etc/ssh/sshd_config.d/10-omarchy-hardening.conf && sudo systemctl disable --now sshd && rm ~/.ssh/testkey ~/.ssh/testkey.pub` (skip the `disable` if sshd was enabled at the start) so the machine is back to its starting state.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A `password:` prompt from ssh means password auth is still effective — that is the failure this test guards.
  * Answer `yes` if ssh asks about the localhost host key even with `StrictHostKeyChecking=no`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Password logins are off`, the drop-in contents, `sshd -T` values, the `Permission denied (publickey)` refusal and `KEY_OK`, and the SSHD menu entry opening
  * If unsuccessful
  ** Screenshot of a password prompt from ssh, a missing drop-in, or `Password logins are off` printed while `sshd -T` still says `yes`
  ** Output of `omarchy-version`
covers: bin/omarchy-setup-security-sshd; test/shell.d/setup-security-sshd-test.sh, sshd-hardening-migration-test.sh; manual/48-security.md, manual/35-networking.md

### ssh-reconnect-after-drop   [VM-OK]
description: The shell's `ssh` wrapper reconnects an interactive session that drops after it was established, resets stray terminal modes, and never replays a remote command or a fast failure.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * This test needs sshd running with `~/.ssh/testkey` authorised (run `sshd-setup-hardens-password-logins` first on the same disk). Open a terminal with Super+Enter.
  * Fast failure: type `ssh -o ConnectTimeout=2 nonexistent.invalid; echo "exit=$?"` → fails once, no `Connection lost`, non-zero exit.
  * Remote command: type `ssh -i ~/.ssh/testkey -o StrictHostKeyChecking=no localhost 'exit 255'; echo "exit=$?"` → `exit=255` with no reconnect attempt.
  * Interactive drop: type `ssh -i ~/.ssh/testkey localhost`, then inside the session type `sleep 40` (the wrapper only reconnects sessions older than 30 s). Open a second terminal with Super+Enter and type `sudo pkill -f 'sshd: prime'` (password `prime`).
  ** The first terminal prints `Connection lost` and reconnects, presenting a fresh remote prompt. Type `exit`; the terminal must be usable (no stuck mouse/alt-screen modes).
  * Ctrl-C stops the loop: repeat the drop, but in the second terminal type `sudo systemctl stop sshd` before the `pkill`; while the first terminal shows `Connection lost` and retries, press Ctrl+C there → the prompt returns; type `echo "exit=$?"` → `exit=130`.
  * Type `sudo systemctl start sshd` in the second terminal so sshd is back as this test found it; then, unless another test needs it, undo the sshd setup as described in `sshd-setup-hardens-password-logins`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The wrapper is a bash function from Omarchy's shell functions; run these from a normal interactive terminal, not a script.
  * Use `mouse move` to hover the first terminal before typing Ctrl+C so the keystroke lands there.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the fast failure (no reconnect), `exit=255` for the remote command, `Connection lost` followed by a new remote prompt after the kill, and Ctrl+C stopping the retry loop with `exit=130`
  * If unsuccessful
  ** Screenshot of a reconnect after a fast failure or remote command, no reconnect after a real drop, or a terminal left with broken modes
  ** Output of `omarchy-version`
covers: default/bash/fns/ssh-reconnect; test/shell.d/ssh-reconnect-test.sh; manual/20-shell-functions.md

### sudoless-docker-toggle-flags-reboot   [VM-PARTIAL]
description: Enabling sudoless Docker adds the docker group, flags a reboot and offers it; the menu switches from Setup to Remove immediately even though the running session still needs sudo until the reboot; removing reverses it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `id -nG | tr ' ' '\n' | grep -c '^docker$'` → `0`; `omarchy-sudo-docker; echo needs_sudo=$?` → `0`; `omarchy-sudo-docker --configured; echo configured=$?` → `0` (meaning not configured, sudo needed).
  * Open Omarchy Menu with Super+Escape → Setup → Security: `Sudoless Docker` is listed. Select it; confirm in the floating terminal, enter the password `prime`. When asked to reboot now, answer **No**.
  * Run `ls ~/.local/state/omarchy/reboot-required` → present (the bar may show a reboot indicator); `getent group docker | grep -c prime` → `1`; `omarchy-sudo-docker --configured; echo configured=$?` → `1` (configured); `omarchy-sudo-docker; echo needs_sudo=$?` → still `0` (this session has no docker socket access yet).
  * Open the menu → Setup → Security: `Sudoless Docker` is gone; Remove → Security now lists `Sudoless Docker`. Select it; when asked to reboot, answer No.
  * Run `getent group docker | grep -c prime` → `0`; `omarchy-sudo-docker --configured; echo configured=$?` → `0`.
  * Clear the flag if desired: `omarchy-state clear reboot-required` (or leave it; a later reboot clears it).
  * Run `omarchy-sudo-docker --bogus; echo "exit=$?"` → `exit=2` (usage error, not a boolean answer).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Docker is not installed the setup may install it first (network). Report what happened.
  * The skipped part is the reboot that would actually grant the group to the session.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the group/flag/exit-code checks before, after enabling (flag present, group added, `--configured`=1, default still 0), the menu rows moving from Setup to Remove, and after removal
  ** Screenshot of `exit=2` for the unknown flag
  * If unsuccessful
  ** Screenshot of a reboot happening despite No, the group not changing, both menu rows shown together, or `--bogus` returning 0/1
  ** Output of `omarchy-version`
covers: bin/omarchy-setup-security-sudoless-docker, bin/omarchy-remove-security-sudoless-docker, bin/omarchy-sudo-docker, default/omarchy/omarchy-menu.jsonc (setup.security.sudoless-docker); test/shell.d/sudoless-docker-toggle-test.sh, sudo-docker-test.sh, sudoless-docker-posture-test.sh; manual/18-development-tools.md

### system-reboot-from-menu-schedules-cleanly   [VM-OK] [SLOW]
description: Reboot from the menu closes windows and reboots via a scheduled systemd timer outside the terminal scope, clearing the reboot-required flag, so the machine comes back to the LUKS prompt and a clean desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, run `omarchy-state set reboot-required` and confirm `ls ~/.local/state/omarchy/reboot-required` exists (the bar may show a reboot indicator). Open a second window (e.g. `imv` or another terminal) so there is something to close.
  * Open Omarchy Menu with Super+Escape → System → Reboot.
  ** All windows close within a second and the machine reboots about two seconds later.
  * Answer the LUKS passphrase `prime` at the boot prompt, then log in (`prime`) to reach the desktop.
  * Open a terminal and run `ls ~/.local/state/omarchy/reboot-required 2>&1` → no such file; `uptime` shows a fresh boot.
  * Read the serial console (`get-serial`) and confirm it shows the shutdown and the new boot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reboot is scheduled with `systemd-run --on-active=2s`; if windows close but the machine does not reboot within 30 seconds, report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the flag set, windows closing, the boot splash/LUKS prompt, the login, and the flag gone after login; serial log with the reboot
  * If unsuccessful
  ** Screenshot of windows closing without a reboot, the flag surviving, or a hung shutdown
  ** Output of `omarchy-version`
covers: bin/omarchy-system-reboot, bin/omarchy-system-shutdown, bin/omarchy-state, bin/omarchy-hyprland-window-close-all; test/shell.d/system-power-test.sh; manual/04-navigation.md

### windows-vm-install-refuses-insufficient-space   [VM-PARTIAL]
description: The Windows VM installer checks free space on the storage target before doing anything and refuses with a clear message on a small disk; the privileged helper never runs.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `df -h ~` to record the free space (the guest disk is 40 GB).
  * Open Omarchy Menu with Super+Escape → Install → Windows. A floating terminal starts the installer; if it asks for RAM/cores/disk size, accept the defaults (64G disk).
  ** Expect `❌ Insufficient disk space!` with `Available: <N>GB` and `Required: 74GB (64GB disk + 10GB for Windows image)` (or similar numbers), and the installer stopping there without a polkit prompt.
  * Run `ls ~/.local/share/applications/windows-vm.desktop 2>&1` → absent; `ls /var/lib/omarchy/windows 2>&1` → absent or empty.
  * Open the menu → Remove: no `Windows` row is listed (nothing installed).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a smaller disk size is offered that fits, choose the default anyway; the point is the refusal. If the installer proceeds to pull Docker images (network, many GB), press Ctrl+C and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `Insufficient disk space!` message with Available/Required lines, no polkit prompt, no `windows-vm.desktop`, and Remove without a Windows row
  * If unsuccessful
  ** Screenshot of a polkit prompt or Docker pull starting on the small disk
  ** Output of `omarchy-version`
covers: bin/omarchy-windows-vm (available_storage_gb, install), default/omarchy/omarchy-menu.jsonc (install.windows, remove.windows); test/shell.d/windows-vm-compose-test.sh (disk-space), windows-vm-test.sh, menu-test.sh; manual/28-windows-vm.md

### network-panel-ethernet-only-in-vm   [VM-OK]
description: On a wired-only machine the network widget shows the ethernet icon, the panel shows the interface details and throughput without any Wi-Fi sections, ping rows degrade gracefully when ICMP is blocked, and no captive-portal action appears.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Look at the right section of the top bar: the network widget shows the ethernet glyph `󰈀` (not a Wi-Fi arc, not the blocked `󰈂`).
  * Click the widget. The network panel opens: it shows the connection type ethernet, the interface name, IP address, and throughput rows. There must be no `KNOWN NETWORKS`/`OTHER NETWORKS` sections and no Wi-Fi band pills.
  * Wait ten seconds and read the ping rows: the router ping may show a value; the internet ping shows `Timeout` (QEMU NAT drops ICMP) and packet loss climbs — this is expected, not a fault. Before the first sample the rows show `--`.
  * There must be no "open portal"/captive-portal button.
  * Press Escape to close the panel. Run in a terminal (Super+Enter): `omarchy-network-status | tr '\t' '=' ` → `type=ethernet` and an `iface=` line.
  * Run `omarchy-network-qr; echo "exit=$?"` and `omarchy-network-password; echo "exit=$?"` → both fail (no Wi-Fi device) with an error, no QR matrix printed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Curl still works (`curl -sI https://archlinux.org | head -n 1`) — TCP is fine while ICMP is not; mention both in the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the ethernet glyph, the panel with interface/IP/throughput and no Wi-Fi sections, the `Timeout`/`--` ping rows, and the failing QR/password helpers
  * If unsuccessful
  ** Screenshot of a blocked/portal icon, Wi-Fi sections on a wired-only guest, or the panel failing to open
  ** Output of `omarchy-version`
covers: shell/plugins/panels/network/Model.js, shell/plugins/panels/network/Panel.qml, bin/omarchy-network-status, bin/omarchy-network-qr, bin/omarchy-network-password; test/shell.d/network-test.sh, network-captive-portal-test.sh, network-qr-test.sh, network-password-test.sh, wifiqr-test.sh; manual/35-networking.md, manual/05-the-top-bar.md

### powerprofiles-set-without-battery   [VM-PARTIAL]
description: Power profile preferences are stored per power source and restored on demand; without a battery the machine always counts as on AC, the default AC profile is performance, and failures are not persisted.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `powerprofilesctl list` → note the available profiles and the active one (marked `*`).
  * Run `omarchy-powerprofiles-set ac balanced` then `powerprofilesctl get` → `balanced`; `cat ~/.local/state/omarchy/powerprofiles/ac 2>/dev/null || find ~/.local/state/omarchy -name ac -exec cat {} +` → `balanced`.
  * Run `omarchy-powerprofiles-set ac power-saver` then `powerprofilesctl get` → `power-saver`.
  * Run `omarchy-powerprofiles-set` (autodetect; no battery → AC) → `powerprofilesctl get` → `power-saver` (restored from the AC preference).
  * Run `omarchy-powerprofiles-set battery performance` → the AC preference is untouched: `omarchy-powerprofiles-set ac; powerprofilesctl get` → `power-saver`.
  * Run `omarchy-powerprofiles-set ac nonsense; echo "exit=$?"` → non-zero and `powerprofilesctl get` still `power-saver` (a failed selection is not persisted).
  * Restore: `omarchy-powerprofiles-set ac performance`.
  * Open Omarchy Menu with Super+Escape and search `power` → if a Power Profile submenu exists, confirm the checked entry matches `performance`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * In a VM `power-profiles-daemon` may only offer `balanced` and `performance`; if `power-saver` is missing use `balanced` in its place and note it.
  * The skipped part is the battery-side autodetect (no battery in QEMU).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `powerprofilesctl get` after each step matching the stored preference, the untouched AC preference after setting battery, and the failed selection leaving state unchanged
  * If unsuccessful
  ** Screenshot of a preference persisted after a failed `set`, or autodetect applying the battery preference on AC
  ** Output of `omarchy-version`
covers: bin/omarchy-powerprofiles-set, bin/omarchy-powerprofiles-init, shell/plugins/services/battery/Service.qml; test/shell.d/powerprofiles-set-test.sh, power-test.sh; manual/36-system-sleep.md

### voxtype-invitation-runs-once   [VM-OK]
description: The one-time dictation invitation sends exactly one clickable notification, records completion, and never repeats even though its hook stays installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls ~/.local/state/omarchy/done/voxtype-install-invitation ~/.config/omarchy/hooks/post-update.d/install-voxtype.hook 2>&1` → on a minted disk the done marker and the hook both exist.
  * Run `bash ~/.config/omarchy/hooks/post-update.d/install-voxtype.hook` → NO notification appears (already done).
  * Run `rm ~/.local/state/omarchy/done/voxtype-install-invitation` then run the hook again → exactly one toast inviting to install Voxtype/dictation appears, and the done marker is recreated.
  * Run the hook a third time → no new toast.
  * Optionally click the toast: a floating terminal runs `omarchy-voxtype-install` (network download; Ctrl+C to abort is fine).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the hook is under `/usr/share/omarchy/install/user/first-run/install-voxtype.hook` instead, run that path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of no toast with the marker present, exactly one toast after removing the marker with the marker recreated, and no toast on the third run
  * If unsuccessful
  ** Screenshot of a repeated toast, no toast after the marker was removed, or the hook deleting itself
  ** Output of `omarchy-version`
covers: install/user/first-run/install-voxtype.hook, bin/omarchy-notification-send; test/shell.d/voxtype-invitation-test.sh; manual/11-text-extraction-dictation.md

### mise-install-refuses-bad-command-names   [VM-OK]
description: Installing a tool wrapper through mise refuses command names that are not plain file names (paths, dotfiles, dashes, control characters) before touching anything, and writes a safe wrapper for a normal name.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and `touch /tmp/victim`.
  * Run each and confirm the error `is not usable as a command name` with a non-zero status: `omarchy-mise-install somepkg ../escaped`, `omarchy-mise-install somepkg .hidden`, `omarchy-mise-install somepkg -dash`, `omarchy-mise-install somepkg "$(printf 'with\ttab')"`.
  * Run `omarchy-mise-install somepkg "../../../..$PWD/../tmp/victim"; ls /tmp/victim` → refused and `/tmp/victim` still exists.
  * Positive: `omarchy-mise-install npm:cowsay cowsay` → `ls -l ~/.local/bin/cowsay` shows an executable; `cat ~/.local/bin/cowsay` contains `mise use -g --quiet npm:cowsay` (or the build's equivalent) and no other command text.
  * Hostile package name: `omarchy-mise-install 'npm:pkg$(touch /tmp/PWNED)end' hostile` then `cat ~/.local/bin/hostile` → the name appears quoted as data; `ls /tmp/PWNED 2>&1` → no such file. Do not run the wrapper (it would call mise over the network).
  * Clean up: `rm -f ~/.local/bin/cowsay ~/.local/bin/hostile /tmp/victim`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Running `~/.local/bin/cowsay` would install cowsay through mise (network); not needed for the proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each refusal with the exact phrase, `/tmp/victim` intact, the generated wrapper contents, and `/tmp/PWNED` absent
  * If unsuccessful
  ** Screenshot of a wrapper written under a refused name, `/tmp/victim` deleted, or `/tmp/PWNED` created
  ** Output of `omarchy-version`
covers: bin/omarchy-mise-install; test/shell.d/mise-install-test.sh, mise-wrapper-quiet-migration-test.sh; manual/18-development-tools.md

### shell-ipc-contracts-from-terminal   [VM-OK]
description: The `omarchy-shell` IPC wrapper reaches the running shell even from a stripped environment, refuses unknown plugins, and drives visible UI (OSD, panels, menu) so scripts and hotkeys can rely on it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell shell ping` → `ok`; `env -u WAYLAND_DISPLAY omarchy-shell shell ping` → `ok` (display recovered from the runtime dir).
  * Run `omarchy-shell shell summon missing.plugin "{}"` → `unknown`.
  * Run `omarchy-shell osd show '{"message":"Runtime smoke","duration":0}'` → an on-screen display with `Runtime smoke` appears; `omarchy-shell osd close` → it disappears.
  * Run `omarchy-shell shell summon omarchy.menu '{"menu":"apps"}'` → the app launcher opens; `omarchy-shell shell hide omarchy.menu` → it closes.
  * Run `omarchy-shell omarchy.network open` → the network panel opens; `omarchy-shell omarchy.network close` → closes. Repeat for `omarchy.audio` and `omarchy.monitor`.
  * Run `omarchy-shell media status | jq .hasPlayer` → `false` (no player in the VM); `omarchy-shell idle status | jq .enabled` and `omarchy-shell lock status | jq .locked` → booleans.
  * Run `omarchy-shell shell listShellConfig | jq -c '.version, (.bar.layout|keys)'` → `1` and `["center","left","right"]`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a call prints `omarchy-shell is not ready` the shell is still starting; wait five seconds and retry once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `ok` for both pings, `unknown` for the missing plugin, the OSD, launcher and panels appearing/closing on command, and the JSON answers
  * If unsuccessful
  ** Screenshot of `omarchy-shell is not responding`, a panel that did not open, or a non-JSON answer
  ** Output of `omarchy-version`
covers: bin/omarchy-shell, shell/shell.qml (IPC), shell/plugins/osd/OsdModel.js, shell/plugins/services/media/MediaModel.js; test/shell.d/runtime-smoke-test.sh, shell-ipc-display-test.sh, restart-shell-test.sh, osd-test.sh, media-test.sh; manual/14-omarchy-cli.md

### unlock-screen-theme-refusals   [VM-OK]
description: The boot/unlock splash publisher refuses a symlinked logo and refuses to run as root, and the Style → Unlock picker passes theme names as data; none of these change the installed splash.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and record the current splash logo checksum: `md5sum /usr/share/plymouth/themes/omarchy/logo.png /usr/share/sddm/themes/omarchy/logo.png`.
  * Symlinked logo: `ln -sf /etc/hostname /tmp/logo-link.png && omarchy-plymouth-set '#1d2021' '#ebdbb2' /tmp/logo-link.png; echo "exit=$?"` → non-zero with a message containing `symlink`; no sudo prompt.
  * As root: `sudo omarchy-plymouth-set '#1d2021' '#ebdbb2' /usr/share/omarchy/logo.png; echo "exit=$?"` (password `prime`) → non-zero with a message containing `as your user` and `not under sudo`.
  * Re-run the checksums → unchanged.
  * Open Omarchy Menu with Super+Escape → Style → Unlock: a theme picker lists `default` and the installed themes. Press Escape without choosing.
  * Create a theme directory whose name is shell syntax and confirm the picker treats it as data: `mkdir -p "$HOME/.config/omarchy/themes/a';touch \$HOME\/unlock-pwned;'b"`; open Style → Unlock again, select that odd row; the floating terminal runs `omarchy-plymouth-set-by-theme` with the whole name (it will fail because the theme has no `unlock.png`) and `ls ~/unlock-pwned 2>&1` → no such file. Remove the directory: `rm -rf "$HOME/.config/omarchy/themes/a';touch \$HOME\/unlock-pwned;'b"`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hostile theme name test relies on the menu quoting the picked name; on an old build a file `~/unlock-pwned` appearing is the exact regression the unit test guards.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `symlink` refusal, the root refusal with both phrases, unchanged checksums, the picker, and `~/unlock-pwned` absent after picking the hostile name
  * If unsuccessful
  ** Screenshot of a sudo prompt for the symlink case, a changed checksum, or `~/unlock-pwned` existing
  ** Output of `omarchy-version`
covers: bin/omarchy-plymouth-set, bin/omarchy-plymouth-switcher, bin/omarchy-launch-floating-terminal-with-presentation, default/omarchy/omarchy-menu.jsonc (style.unlock); test/shell.d/plymouth-set-test.sh, menu-test.sh; manual/41-branding.md, manual/06-themes.md

### unlock-screen-theme-applies-on-reboot   [VM-OK] [SLOW]
description: Choosing an unlock theme republishes the Plymouth and SDDM assets as root-owned 0644 files, rebuilds the initramfs, and the next boot shows the themed passphrase screen; `default` resets to the packaged assets.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls -l /usr/share/plymouth/themes/omarchy/ /usr/share/sddm/themes/omarchy/` → every file is a regular `-rw-r--r-- root root` file.
  * Open Omarchy Menu with Super+Escape → Style → Unlock and pick a theme other than default (e.g. `tokyo-night`). Enter the password `prime` in the floating terminal; wait for `mkinitcpio` to finish (a minute or two).
  * Run `ls -l /usr/share/plymouth/themes/omarchy/logo.png /usr/share/sddm/themes/omarchy/logo.png` → still regular 0644 root files; `grep -c SetBackgroundTopColor /usr/share/plymouth/themes/omarchy/omarchy.script` → `1`; `find /usr/share/plymouth/themes/omarchy /usr/share/sddm/themes/omarchy -name '.*omarchy-new*'` → nothing left behind.
  * Reboot via System → Reboot. At the passphrase screen take a screenshot: it shows the chosen theme's colours/logo. Enter `prime`, log in.
  * Open a terminal and run `omarchy-plymouth-reset` (password `prime`) → the packaged assets are restored: `cmp /usr/share/omarchy/default/plymouth/logo.png /usr/share/plymouth/themes/omarchy/logo.png` → identical.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `mkinitcpio -P` on 2 vCPUs takes a while; keep screenshotting the terminal. The reboot adds another minute.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the file listings (regular 0644 root files, no temp files), the themed passphrase screen after reboot, and the reset restoring the packaged logo
  * If unsuccessful
  ** Screenshot of a symlink or non-0644 file in the theme directories, leftover `.omarchy-new` files, the stock splash after choosing a theme, or a failed initramfs rebuild
  ** Output of `omarchy-version`
covers: bin/omarchy-plymouth-set, bin/omarchy-plymouth-set-by-theme, bin/omarchy-plymouth-reset, bin/omarchy-refresh-plymouth, bin/omarchy-refresh-sddm; test/shell.d/plymouth-set-test.sh; manual/41-branding.md

### video-background-plays-and-pauses-on-lock   [VM-PARTIAL]
description: A video file can be picked as the desktop background, plays in a loop, appears in the lock screen, and pauses while a fullscreen window covers it; the picker shows a generated thumbnail for it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and generate a short test video into the current theme's background folder: `t=$(cat ~/.local/state/omarchy/current/theme.name); mkdir -p ~/.config/omarchy/backgrounds/$t; ffmpeg -loglevel error -f lavfi -i testsrc=duration=6:size=640x360:rate=15 -pix_fmt yuv420p ~/.config/omarchy/backgrounds/$t/zz-test.mp4 && ls -l ~/.config/omarchy/backgrounds/$t/`.
  * Open Omarchy Menu with Super+Escape → Style → Background: the picker shows thumbnails; the new `zz-test.mp4` has a thumbnail (a frame of the moving test pattern), not a blank tile.
  * Select it. The desktop background becomes the moving test pattern (take two screenshots five seconds apart; the pattern's counter/bars differ, proving playback).
  * Lock the screen (Omarchy Menu → Lock): the lock screen shows the same video background. Unlock with `prime`.
  * Open a window and make it fullscreen (Super+F in Omarchy's default bindings, or use the window menu); take two screenshots five seconds apart after un-fullscreening — the background resumed.
  * Run `ls ~/.cache/omarchy/image-selector/*.jpg | wc -l` → at least one thumbnail was cached.
  * Restore: Style → Background and pick an image background again; `rm ~/.config/omarchy/backgrounds/$t/zz-test.mp4`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Software decoding of a 640x360 clip works without GPU acceleration; if `ffmpeg` is missing, `ffmpegthumbnailer` is not enough to make a clip — report the partial result.
  * No audio device exists, so the silent-file path is what is exercised.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker thumbnail for the mp4, two desktop frames that differ, the lock screen showing the video, and the cache count
  * If unsuccessful
  ** Screenshot of a blank tile, a static/black background after selecting the video, or the lock screen falling back to black
  ** Output of `omarchy-version`
covers: shell/Ui/BackgroundMedia.qml, shell/Ui/BackgroundVideo.qml, shell/plugins/background/Background.qml, shell/plugins/lock/LockView.qml, bin/omarchy-menu-images, shell/plugins/image-picker/list.sh, bin/omarchy-theme-set; test/shell.d/video-background-test.sh, menu-images-test.sh; manual/39-backgrounds.md

### reminder-rejects-invalid-minutes   [VM-OK]
description: The reminder flow only accepts a positive whole number of minutes and fires a notification when the time is up, so typos cannot schedule a reminder in the past or never.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open Omarchy Menu with Super+Escape and search `remind` (or follow the manual's Reminder entry / hotkey) to open the reminder flow.
  * Enter `0` as the minutes → the flow refuses to proceed (no reminder scheduled, input stays or shows invalid). Try `-5`, `1.5` and `soon` → same.
  * Enter `1` and a message `Driver test` → the flow accepts and closes.
  * Wait about 60 seconds (take a screenshot every 10 s) → a notification with `Driver test` appears.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * See manual chapter 09 for the exact entry point; if the flow has a dedicated hotkey, use it and record it in the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each rejected input with the flow still open, the accepted `1`, and the `Driver test` toast about a minute later
  * If unsuccessful
  ** Screenshot of `0`/`-5`/`1.5`/`soon` accepted or the toast never arriving
  ** Output of `omarchy-version`
covers: shell/plugins/reminders/ReminderFlowModel.js, shell/plugins/reminders; test/shell.d/reminders-test.sh; manual/09-reminders.md

### fido2-setup-without-device   [VM-PARTIAL]
description: FIDO2 setup detects the absence of a security key and stops before touching `/etc/fido2`, and removal with nothing registered asks for no privileges.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls -ld /etc/fido2 2>&1` → no such directory on a fresh disk.
  * Open Omarchy Menu with Super+Escape → Setup → Security → Fido2. The floating terminal prints `No FIDO2 device detected. Please plug it in (you may need to unlock it as well).` (it may first install `pam-u2f`/`libfido2` — network — if missing). Let it exit or press Ctrl+C.
  * Run `ls -ld /etc/fido2 2>&1` → still absent; `sudo -k; grep -c pam_u2f /etc/pam.d/sudo` → `0` (no PAM line added without a registration).
  * Run `omarchy-remove-security-fido2; echo "exit=$?"` → completes without a sudo password prompt (nothing to remove).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The registration path (pamu2fcfg → root-owned stage → atomic publish) needs a real token and cannot be exercised here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the exact no-device message, `/etc/fido2` still absent, no `pam_u2f` line, and the removal completing without a password prompt
  * If unsuccessful
  ** Screenshot of `/etc/fido2` created or PAM modified without a device, or removal prompting for sudo with nothing present
  ** Output of `omarchy-version`
covers: bin/omarchy-setup-security-fido2, bin/omarchy-remove-security-fido2; test/shell.d/security-fido2-test.sh, security-fido2-remove-test.sh; manual/37-hardware-authentication.md

### background-picker-thumbnails-cache   [VM-OK]
description: The background picker shows one thumbnail per background of the current theme, caches them under the user's cache directory, and reopens instantly from that cache.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `rm -rf ~/.cache/omarchy/image-selector; t=$(cat ~/.local/state/omarchy/current/theme.name); ls /usr/share/omarchy/themes/$t/backgrounds/ ~/.config/omarchy/backgrounds/$t/ 2>/dev/null | wc -l` → note the count of backgrounds.
  * Open Omarchy Menu with Super+Escape → Style → Background. Thumbnails appear (they may fill in over a second or two); their number matches the count. Press Escape.
  * Run `ls ~/.cache/omarchy/image-selector/ | grep -c '\.jpg$'` → equals the count; `ls ~/.cache/omarchy/image-selector/ | grep -E '\.(rows|signature)$'` → a rows and a signature file exist; `ls -d ~/.cache/omarchy/image-selector/*.lock 2>&1` → none left.
  * Open Style → Background again → thumbnails appear immediately. Select a different background than the current; the desktop changes. Select the original one back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A leftover `.lock` directory would mean a generator died mid-way; the next open recovers it after ten minutes by contract, so report it if seen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker with all thumbnails, the cache listing with matching `.jpg` count plus rows/signature files and no locks, and the background changing and restoring
  * If unsuccessful
  ** Screenshot of blank tiles, a mismatched count, or leftover lock directories
  ** Output of `omarchy-version`
covers: bin/omarchy-menu-images, shell/plugins/image-picker/list.sh, bin/omarchy-theme-bg-next; test/shell.d/menu-images-test.sh, video-background-test.sh; manual/39-backgrounds.md

## Gaps

Behaviours in scope that cannot become driver tests in this guest, and why.

- **Pure source/style scans** (kept as maintainers' unit tests only): `privileged-heredoc-test.sh`
  (unquoted heredoc into privileged paths), `qml-text-format-test.sh`/`qml-text-format-scan.py`
  (only its *consequence* is testable — see `external-text-never-renders-as-html`),
  `panel-command-path-test.sh`, `row-border-stability-test.sh`, `shell-launch-test.sh`,
  `unowned-system-paths-test.sh`, `update-pacman-test.sh`, `plugins-test.sh` (manifest schema),
  `manifest-entrypoints-test.sh`, `plugin-registry-contract-test.sh`, the source-grep halves of
  `monitor-recovery-test.sh`, `systemd-test.sh`, `snapper-test.sh`, `network-manager-transition-test.sh`,
  `upgrade-to-quattro-test.sh`, `menu-test.sh` (Menu.qml regexes), `network-test.sh` (Panel.qml
  regexes), `power-test.sh`, `weather-test.sh`, `tailscale-test.sh`, `video-background-test.sh` (QML
  assertions).
- **Quickshell fixtures needing a test compositor** (`require_compositor`): plugin auth boundary
  runtime, pointer-move-gate runtime, tray-menu DBusMenu click (needs a mock SNI and python-dbus),
  network captive-portal QML fixture. The visible parts are covered by the menu/plugin/network tests
  above; the isolation guarantees (a replacement bar cannot reach another plugin's service, cannot
  mutate host bar config, capability revocation on manifest change) would need a hostile plugin
  fixture the driver cannot install without file transfer — a follow-up could type the fixture QML
  into the guest, but it exceeds ten minutes.
- **Hardware-only paths** (absence path only, covered by `hardware-detectors-report-absence` and
  `menu-hides-hardware-rows-absent-in-vm`): clamshell scale memory and lid handling
  (`monitor-clamshell-scale`, `monitor-recovery`), modeless monitor recovery loop
  (`monitor-modeless` needs an output reporting 0x0), hostile connector names
  (`monitor-output-name` — cannot rename `Virtual-1`), nouveau cursor fix, NVIDIA kms hook, T2 Mac
  migration, Dell XPS 13 sidecar amps, Synaptic touchpad quirk, power-present detection, battery
  panel and power profiles autodetect on battery, fingerprint prompts in polkit, FIDO2 registration
  (needs a token), Wi-Fi QR/password/band/captive portal (no Wi-Fi), tailscale panel and Taildrop
  receive (no tailnet/device), webcam recording overlay resize, keyboard-backlight and force-igpu
  sleep hooks (`system-sleep-ownership-migration`), input-device toggles with a real device and the
  hostile-name PoC, real suspend/resume (`sleep-lock`, `sleep-monitor`: host must wake the guest).
- **Migrations against 3.x/legacy state**: `retired-installer-artifacts-migration`,
  `sshd-hardening-migration` (keyless-sshd disable path), `security-fido2-migration`,
  `system-sleep-ownership-migration`, `tmux-alert-removal-migration`, `mise-work-path-test`,
  `mise-wrapper-quiet-migration`, `snapper-timeline-leak`, `omarchy-kernel-migration`,
  `upgrade-to-quattro`. A minted 4.0.2 disk has none of the legacy artifacts; only their *end state*
  is checkable (`stock-system-policy-invariants`, `omarchy-update-full-sequence`). Planting the
  artifacts by hand (e.g. a fake `/etc/sudoers.d/first-run`) is possible but touches sudoers on a
  build whose migration may not yet contain the guard — judged too risky to propose.
- **Real pacman conflicts**: `update-file-conflict-test.sh` and `update-package-conflict-test.sh`
  need a package transaction that actually reports `exists in filesystem` or
  `unresolvable package conflicts`; no deterministic way to produce one on the 4.0.2 → 4.0.4 path
  without knowing the release's new files. Covered indirectly if the full update hits one.
- **Update lock internals**: the inhibitor not inheriting the flock fd, `stay-awake stop` PID-reuse
  safety, and `OMARCHY_UPDATE_INTERACTIVE` not being requestable are process-level details with no
  screen signal.
- **Installer form** (`setup-form-test.sh`): only reachable during `mint`; the existing `mint`
  definition covers the happy path. Esc/Ctrl+C survival under `set -e` would need the ISO.
- **OpenClaw onboarding**, **T3 Code install**, **WhatsApp slim extension**: need a provider API key
  or an account plus large downloads; out of budget.
- **Windows VM mount boundary** (`windows-vm-compose`, `windows-vm-mount-boundary`): needs
  Docker + a 74 GB free disk + a privileged namespace; only the disk-space refusal is testable.
- **LM Studio home-pointer refusal** (`remove-ai-test.sh`): deliberately not proposed — on a build
  predating the guard the negative path would delete `$HOME`.
- **Notification file persistence details** (image copies into `state/notifications/images`,
  restore across shell restart, deadline handling): the restart half is observable
  (`omarchy-restart-shell` while a critical toast is up should bring it back) but the legacy-`exec`
  inert-click case needs a hand-crafted popup JSON in the state dir; a follow-up test could write one
  with the terminal.
- **Menu images concurrency/lock ownership**: two concurrent generators serialising is not
  observable from the picker.
- **`omarchy-provision-user` skill symlinks**: Antigravity/Hermes are not installed on stock; the
  symlink targets exist only after those agents are set up.
- **`omarchy-update-pkg-prune`** (`paccache -rk2`): observable only as cache size before/after an
  update; folded into the full update's proof hints rather than a test.
- **`vscode-theme-test`** (packaged Cursor probe): needs Cursor/VS Code installed and a PATH shim;
  low value for the driver.
