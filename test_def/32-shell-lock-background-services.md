# 32 — Shell: lock screen, background, services, plugin system surface

Reviewer notes for the Quickshell desktop's lock screen, wallpaper/background plugin, first-party
headless services (idle, battery, media, nightlight), the plugin-system surface a third-party plugin
sees, the shell host (`shell.qml`), and the session/autostart pieces that bring them up. Source read
at `/tmp/omarchy-review/omarchy` (omarchy @ HEAD 2026-09-18, dev line `4.0.0.alpha`; the minted disk
is `omarchy-4.0.2.iso`, so a few HEAD-only details are flagged where they matter).

## Scope

Read completely (line counts from `wc -l`):

| area | files | lines |
|------|-------|-------|
| lock plugin | `shell/plugins/lock/Service.qml` (621), `LockView.qml` (221), `manifest.json` (20) | 862 |
| background plugin | `shell/plugins/background/Background.qml` (364), `manifest.json` (14) | 378 |
| services | `services/idle/Service.qml` (361), `IdleModel.js` (52), `manifest.json` (15); `services/battery/Service.qml` (126), `BatteryModel.js` (28), `manifest.json` (14); `services/media/Service.qml` (523), `MediaModel.js` (142), `BarWidget.qml` (313), `manifest.json` (23); `services/nightlight/Service.qml` (115), `NightlightModel.js` (20), `manifest.json` (14) | 1746 |
| plugin system | `shell/services/PluginRegistry.qml` (743), `AuthServiceStore.js` (45), `PluginShellApi.qml` (70), `PluginRegistryApi.qml` (32), `PluginBarWidgetRegistryApi.qml` (24), `PluginBarStateApi.qml` (12), `PluginFirstPartyServiceApi.qml` (46), `PluginAppLibraryApi.qml` (46), `BarWidgetRegistry.qml` (49), `shell/plugins/README.md` (119) | 1186 |
| shell host | `shell/shell.qml` (1733) | 1733 |
| Ui | `shell/Ui/BackgroundMedia.qml` (87), `BackgroundVideo.qml` (122), `BorderOverlay.qml` (54), `BorderSurface.qml` (40), `CursorSurface.qml` (41), `ScreenMoveRemap.qml` (43), `PointerMoveGate.qml` (54), `BarWidget.qml` (base, for the plugin sample) | 441 |
| Commons | `shell/Commons/Border.qml` (242), `BorderGeometry.js` (373), `Color.qml` (254), `Style.qml` (515), `Util.qml` (159), `qmldir` (5) | 1548 |
| bin (lock/idle/screensaver) | `omarchy-system-lock` (26), `omarchy-apply-lock` (60), `omarchy-screensaver` (48), `omarchy-launch-screensaver` (73), `omarchy-toggle-idle` (67), `omarchy-toggle-screensaver` (11), `omarchy-system-wake`, `omarchy-hyprland-session-locked`, `omarchy-brightness-display` (off/on branch), `omarchy-toggle`, `omarchy-toggle-enabled` | ~400 |
| bin (background) | `omarchy-theme-bg-next` (49), `-set` (25), `-switcher` (14), `-current` (12), `-cache` (10), `-install` (9) | 119 |
| bin (plugins) | `omarchy-plugin-add` (175), `-catalog` (62), `-clone` (168), `-disable` (26), `-enable` (100), `-list` (46), `-remove` (123), `-update` (133), `-validate` (118), `omarchy-menu-plugin`, `omarchy-git-url-check` | ~1050 |
| bin (shell) | `omarchy-shell` (82), `omarchy-restart-shell` (93), `omarchy-launch-shell` (91), `omarchy-shell-config` (helpers) | ~330 |
| session/autostart | `default/hypr/autostart.lua` (14), `config/hypr/autostart.lua` (2), `default/uwsm/default` (17), `default/uwsm/env.d/10-omarchy` (19), `default/wayland-sessions/omarchy.desktop` (6), `default/hypr/bindings/utilities.lua` + `media.lua` (bindings for lock/idle/background/media), `default/hypr/looknfeel.lua` (`allow_session_lock_restore`), `default/omarchy/omarchy-menu.jsonc` (system/style/trigger/setup.plugin/update.process entries), `config/omarchy/shell.json` | ~120 |
| PAM/security | `install/config/lockscreen-pam.sh` (1), `install/config/increase-lockout-limit.sh` (12), `etc/security/faillock.conf` (7) | 20 |
| manual | `manual/32-shell-plugins.md` (104), `manual/13-toggles-idle-screensaver.md` (idle/lock/screensaver sections) | ~200 |

Skimmed (pass/fail lines and fixtures only, to know what is already proven at unit level):
`test/shell.d/lock-blank-fingerprint-test.sh`, `lock-fingerprint-indicator-test.sh`,
`lock-password-overflow-test.sh`, `lock-stranded-recovery-test.sh`, `apply-lock-test.sh`,
`system-lock-test.sh`, `hyprland-session-locked-test.sh`, `sleep-lock-test.sh`, `idle-test.sh`,
`background-test.sh`, `video-background-test.sh`, `plugin-add-test.sh`, `plugin-auth-boundary-test.sh`,
`plugin-clone-test.sh`, `plugin-enable-test.sh`, `plugin-registry-contract-test.sh`, `plugins-test.sh`,
`plugin-validate-test.sh`, `shell-launch-test.sh`, `restart-shell-test.sh`, `launch-shell-test.sh`,
`shell-ipc-display-test.sh`, `border-geometry-test.sh`, `compositor-guard-test.sh`,
`runtime-smoke-test.sh`, `first-run-test.sh`; `test/acceptance.d/session-test.sh`,
`shell-surfaces-test.sh`, `security-test.sh`.

Skipped: `shell/plugins/panels/**`, `bar/**`, `notifications/**`, `polkit/**`, `menu/**` (other
reviewers), except `panels/clock/BarWidget.qml` line 150 which the clone test edits. `bin/omarchy-system-sleep-lock`
belongs to the sleep reviewer (36-system-sleep); it is only referenced. No web-verified third-party
plugin repository exists at review time (plugins.omarchy.org lists 0 plugins), so the git-URL add test
is written with a local-path origin as the primary path and the network path as VM-PARTIAL.

## Inventory

**Lock screen (`shell/plugins/lock/Service.qml`, `LockView.qml`)**

- Lock entry points: hotkey `Super+Ctrl+L` → `omarchy-system-lock` (`default/hypr/bindings/utilities.lua:127`); menu `Super+Escape → System → Lock` (`omarchy-menu.jsonc:37`); CLI `omarchy-system-lock` / `omarchy system lock`; IPC `omarchy-shell lock lock` → `"ok" | "missing-pam" | "failed"` (`Service.qml:582-587`); idle service `lockSystem()` (`idle/Service.qml:72-81`); `omarchy-restart-shell` relock; `omarchy-system-sleep-lock` (out of scope).
- `omarchy-system-lock` side effects: `omarchy-shell lock lock`, `hyprctl switchxkblayout all 0` (reset keyboard layout), `1password --lock` if running (flock, 3s timeout), `pkill -x ttfx` + `pidwait` + `pkill -f org.omarchy.screensaver` (kills a running screensaver) (`bin/omarchy-system-lock`).
- Lock is refused when `/etc/pam.d/omarchy-lock-password` is absent: `beginLock` logs `lock-denied: missing-pam`, IPC returns `missing-pam` (`Service.qml:138-141`, `582-584`; `FileView` watch at `554-561`).
- Lock sequencing: `lockRequested` → `armBlankTimer()` → `queueSessionLock()` (500 ms stabilise timer, then `WlSessionLock.locked = true`; retried every 100 ms while no real screen) → `session-locked=true` → `secure=true` (`Service.qml:66-87`, `268-300`, `500-512`).
- Lock surface: `WlSessionLockSurface` filled with `LockView`: blurred (`MultiEffect blur 1.0/128`, contrast −0.08) and slightly darkened copy of the *current* wallpaper (`readlink -f ~/.local/state/omarchy/current/background` re-read at every lock, `Service.qml:150-153`, `403-417`), a single centred field 381×67 px (`LockView.qml:26-27`), rounded by Hyprland's `decoration:rounding`. **No clock, no date, no user name, no hostname** on the lock screen.
- Field states: placeholder `Enter Password` (`LockView.qml:25`); `Checking…` while PAM runs (`:191`); italic error text `Authentication failed (N)` where N counts failures in this lock session (`Service.qml:236-245`); border colour accent normally, urgent/red on error (`LockView.qml:42-44`); cursor hidden while checking or after an error (`:40`).
- Input: password masked with `●` (`passwordMaskDelay 0`); Enter submits; **empty submit is ignored** (`LockView.qml:173-177`, `Service.qml:216`); `Escape` or `Ctrl+U` clears the typed text (`LockView.qml:179-185`); typing clears a previous failure message (`:170`); field is read-only while checking (`:147-148`).
- Overflow: dots shrink to fit the field once the masked text outgrows it (`passwordDotScale`, `LockView.qml:37-39`, `156-157`), so a long password never clips.
- Blanking: `idleBlankTimer` 5000 ms, one-shot, armed at lock and re-armed on every wake; fires → `runBlank()` → `omarchy-brightness-keyboard off; omarchy-brightness-display off` → `hyprctl dispatch dpms off` (`Service.qml:172-175`, `184-188`, `480-498`, `bin/omarchy-brightness-display`). Suppressed while a password check is in flight (`:496`). Wall-clock guard: a timer that fires >2 s late (resume from suspend) re-arms instead of blanking (`:489-492`).
- Wake: any key press (including modifiers), mouse move or click on the lock surface, typing into the field, a password failure, a screen coming back → `runWake()` → `omarchy-system-wake` → `omarchy-brightness-display on` (`hyprctl dispatch dpms on`, skipped when already lit), `omarchy-brightness-keyboard restore`, clamshell reconcile (`Service.qml:177-182`, `LockView.qml:117-122`, `165-169`, `179-180`; `bin/omarchy-system-wake`). Keys typed while black still land in the field.
- Unlock: PAM `omarchy-lock-password` success → `finishUnlock()` → `sessionLock.locked = false`, auth state reset, blank timer stopped, `runWake()` (`Service.qml:158-170`, `360-380`). PAM error path also counts as a failure (`:377-379`).
- Fingerprint: second PAM context `omarchy-lock-fingerprint`, started only when `/etc/pam.d/omarchy-lock-fingerprint` exists **and** `fprintd-list $USER` lists a finger (`Service.qml:419-428`); retried every 250 ms; icon `󰈷` pinned inside the field's right edge only when configured (`LockView.qml:205-218`). Absent in the VM.
- Power-saver: when the battery service reports `power-saver` on battery, a video lock wallpaper is paused (`Service.qml:47-48`, `LockView.qml:94`). Absent in the VM.
- Video lock wallpaper: shown darkened (`#22000000`) rather than blurred (`LockView.qml:109-115`); paused while displays are blank; `hyprctl monitors -j` polled every 3 s while locked with a video to reconcile real DPMS state (`Service.qml:455-478`).
- Stranded lock recovery: at start and on every screens change the service runs `omarchy-hyprland-session-locked` (exit 0 locked / 1 unlocked / 2 undetermined), retrying every 500 ms up to 20 times; a compositor-held lock with no locker → `lock-stranded: recovering` → `beginLock()` (`Service.qml:92-110`, `430-443`, `514-531`, `533-546`, `565-572`). Hyprland `misc.allow_session_lock_restore = true` (`default/hypr/looknfeel.lua:114`) lets the new client take the lock over.
- Session-lock lost externally (`onLockStateChanged` locked=false while requested) → shell drops its lock state and wakes (`Service.qml:292-299`).
- Preview: IPC `omarchy-shell lock preview` shows a non-interactive `LockView` on an Overlay layer with exclusive keyboard focus; any click dismisses; `omarchy-shell lock hidePreview` hides (`Service.qml:329-357`, `609-619`).
- Status IPC: `omarchy-shell lock isLocked` → `true|false`; `omarchy-shell lock status` → JSON `{locked, requested, pending, sessionLocked, secure, realScreens, passwordPam, fingerprint, authenticating, lastEvent, lastEventAt}` (`Service.qml:589-607`).
- Journal trail (via `systemd-cat -t omarchy-shell`): `omarchy lock <iso> lock-requested | lock-pending: screen-stabilizing | lock-pending: no-real-screen | session-locked=true|false | secure=true|false | unlocked | lock-denied: missing-pam | lock-stranded: recovering` (`Service.qml:120-124`).
- `keepLoaded: true` + `capabilities: ["authentication"]` in the manifest: the lock service survives plugin hot-reloads and is kept out of the host's public service map (`manifest.json`, `shell.qml:883-889`, `1019-1039`, `AuthServiceStore.js`).
- PAM policy: `/etc/pam.d/omarchy-lock-password` = `pam_faillock preauth/authfail deny=10 unlock_time=120`, `pam_unix try_first_pass nullok`, `account include system-local-login` (`bin/omarchy-apply-lock:31-41`; installed by `install/config/lockscreen-pam.sh`). `increase-lockout-limit.sh` sets the same `deny=10 unlock_time=120` in `system-auth` and adds `authsucc` to `sddm-autologin`; `etc/security/faillock.conf` sets `deny = 10`. The faillock tally is per user and shared across services (lock, sudo, login).
- Colours: `Color.lock.{background(alpha .8), text, placeholder(fg@.66), textError, border, borderActive, borderError, selection}` from theme `shell.toml` `[lock]` (`Commons/Color.qml:115-124`).

**Idle service (`shell/plugins/services/idle/Service.qml`, `IdleModel.js`)**

- Timings from `shell.json` top-level `idle: { screensaver, lock }` in seconds, defaults 150 / 300; both counted from the moment the session goes idle; `IdleMonitor.timeout = min(screensaver, lock)`, `respectInhibitors: true` (`Service.qml:17-26`, `251-257`). Negative / non-numeric values fall back to the defaults, fractions are floored (`IdleModel.js:1-5`).
- Cycle: idle → `idle-cycle-start` → screensaver at its delay (`[[ $(omarchy-shell lock isLocked) == true ]] || omarchy-launch-screensaver`), lock at its delay (`omarchy-system-lock`) (`Service.qml:66-99`).
- Activity cancels the cycle (`idle-cycle-cancel: activity` + `omarchy-system-wake`) unless a screensaver window is up or within its 3 s launch grace (`:158-171`, `273-282`). Closing the last `org.omarchy.screensaver` window before the lock deadline cancels the pending lock (`idle-cycle-cancel: screensaver-dismissed`, `:130-140`). A screensaver that never appears (disabled via toggle) leaves the lock armed → straight to lock.
- Stay awake: `~/.local/state/omarchy/indicators/stay-awake` flag file, watched via `FileView`; `omarchy-toggle-idle [toggle|stay-awake|allow-idle|status]` (hotkey `Super+Ctrl+I`, menu `Trigger → Toggle → Stay Awake`) writes the flag without shell IPC; the service disables the `IdleMonitor` and cancels any cycle (`Service.qml:210-249`, `302-331`; `bin/omarchy-toggle-idle`; `utilities.lua:31`; `omarchy-menu.jsonc:90`). Bar indicator glyph `󰅶` (`bar/indicators/StayAwake.qml`).
- IPC `omarchy-shell idle status|debug` → JSON `{enabled, stayAwake, idle, inIdleCycle, screensaverStarted, screensaver, lock, screensaverDelay, lockDelay, screensaverWindows, timers{…}, processes{…}, lastEvent, lastEventAt}`; `idle enable|disable|toggle` → `"enabled"|"disabled"` (`:338-360`).
- Journal: `omarchy idle <iso> service-ready | idle-monitor: idle|active | idle-cycle-start: screensaver=N lock=M | process-start: screensaver … | lock-system: lock-timeout | idle-cycle-cancel: <reason> | stay-awake: enabled|disabled …` (`:48-53`).

**Screensaver (`bin/omarchy-launch-screensaver`, `bin/omarchy-screensaver`, `bin/omarchy-toggle-screensaver`)**

- Start: menu `Super+Escape → System → Screensaver` (`omarchy-launch-screensaver force`); idle service (no `force`); CLI `omarchy-launch-screensaver [force]`. **No hotkey is bound** (`omarchy-menu.jsonc:36`; manual 13).
- Refuses (exit 1, silent) when `~/.local/state/omarchy/toggles/screensaver-off` exists unless `force`; exits 0 early if already running; needs the default terminal to be Alacritty/ghostty/foot/kitty else notifies `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` (`omarchy-launch-screensaver:6-22`). Default terminal on the disk is foot (`default/xdg-terminal-exec`).
- One fullscreen terminal per monitor, class `org.omarchy.screensaver`, running `omarchy-screensaver`: black background, cursor hidden (`cursor:invisible true`), `ttfx` random effects over `~/.config/omarchy/branding/screensaver.txt`, exits on **any key** (`read -n1 -t 1`) or when the window loses focus; on exit restores the cursor and kills ttfx and its terminal (`omarchy-screensaver`). Mouse movement alone does not exit it (the manual says it does — see Observations).
- Toggle: `omarchy-toggle-screensaver` (menu `Trigger → Toggle → Screensaver`) flips `screensaver-off` and notifies `Screensaver disabled` / `Screensaver enabled` (`omarchy-menu.jsonc:93`).
- Branding: `Style → Screensaver → Edit Text / Set From Image / Restore Default` (`omarchy-branding-screensaver`, another reviewer).

**Background (`shell/plugins/background/Background.qml`, `Ui/BackgroundMedia.qml`, `Ui/BackgroundVideo.qml`, `bin/omarchy-theme-bg-*`)**

- State: symlink `~/.local/state/omarchy/current/background` → media file; theme backgrounds in `~/.local/state/omarchy/current/theme/backgrounds/`, user extras in `~/.config/omarchy/backgrounds/<theme-name>/` (`theme.name` file) (`omarchy-theme-bg-next:6-9`).
- `omarchy-theme-bg-set <path>`: requires an existing file (else `File does not exist: …` exit 1; no arg → usage exit 1), `realpath`, `ln -nsf`, then `omarchy-shell -q background set <path>` for an immediate live update (`bin/omarchy-theme-bg-set`).
- `omarchy-theme-bg-next` (`omarchy theme bg next`): cycles through user dir then theme dir, sorted, images and videos (`jpg jpeg png gif bmp webp mp4 m4v mov webm mkv avi`), wraps around, first entry when the current one is not in the list; `No background was found for theme` notification when empty. **There is no `prev` command.**
- `omarchy-theme-bg-switcher` / hotkey `Super+Ctrl+Space` (`omarchy-menu toggle background`) / menu `Style → Background` / left double-click on the bare desktop: fullscreen image-grid picker (`omarchy-menu-images`, `omarchy.image-picker`) with the current background pre-selected; Escape cancels without change; selection → `omarchy-theme-bg-set` (`Background.qml:131-143`, `353-361`; `utilities.lua:17`; `omarchy-menu.jsonc:105`). Right double-click on the bare desktop → theme switcher (`Background.qml:357`).
- `omarchy-theme-bg-current` prints a humanised name (`1-quattro.webp` → `Quattro`) or `Unknown`; `omarchy-theme-bg-cache` pre-renders thumbnails; `omarchy-theme-bg-install` (menu `Install → Style → Background`) opens the user background folder in nautilus.
- IPC target `background`: `refresh`, `set <path>`, `setInstant <path>`, `transition <from> <to>`, `themeTransition <from> <to> <final> <colorsB64> <shellB64>` (`Background.qml:159-181`).
- Rendering: one `PanelWindow` per screen on the Background layer, `updatesEnabled: true` always (`:210-230`); image→image switch is a 420 ms diagonal wipe reveal (`:190-205`, `291-343`); any video on either side switches instantly (`:76-87`); a theme switch bumps `displayedReloads` to re-read an unchanged path (`:80-84`).
- Video: `BackgroundVideo` (bare `MediaPlayer`+`VideoOutput`, FFmpeg backend, loops, primes one frame when paused); playback paused while locked, while a screensaver window exists, while a fullscreen window covers that output, or in power-saver on battery; audio only from the first screen and only if the file has a sound track (`Background.qml:35-46`, `262-268`; `BackgroundMedia.qml`; `BackgroundVideo.qml`). No shipped theme contains a video background (checked `themes/*/backgrounds`).
- Screen move remap: `ScreenMoveRemap` unmaps/remaps the layer 200 ms after a monitor origin change (`Ui/ScreenMoveRemap.qml`); single-monitor VM never triggers it.
- Lock reads the same symlink independently (`lock/Service.qml:403-417`).

**Battery / media / nightlight services**

- Battery (`services/battery/Service.qml`): UPower display device; low-battery warning at ≤10 % discharging (`omarchy-battery-low <level>`, once per discharge); `omarchy-powerprofiles-set battery|ac` on AC change; `busctl` poll of `net.hadess.PowerProfiles ActiveProfile` every 2 s → `powerSaverOnBattery` consumed by lock and background. No IPC target. Everything is a no-op without a battery.
- Media (`services/media/Service.qml`): MPRIS player tracking, PipeWire stream matching, active-player selection; IPC target `media`: `status` (JSON), `playPause|next|previous|play|pause|sourceNext|sourcePrevious|sourceSwitch|sourceSwitchPrevious` → `"ok"|"unhandled"`, `ping`; media keys bound in `bindings/media.lua:24-34` (`locked = true`, so they work on the lock screen). Bar widget hidden when no player has metadata (`BarWidget.qml:24`); left click play/pause, middle click next, right click popup, wheel prev/next.
- Nightlight (`services/nightlight/Service.qml`): 4000 K / 6500 K via `hyprctl hyprsunset temperature`, starts `hyprsunset` if missing; IPC `nightlight status|refresh|enable|disable|toggle`; hotkey `Super+Ctrl+N` runs `omarchy-toggle-nightlight` (separate CLI, same temperatures); bar indicator.
- Only `omarchy.idle`, `omarchy.media`, `omarchy.nightlight`, `omarchy.notifications` are exposed to a replacement bar through `PluginFirstPartyServiceApi` narrow proxies (`shell.qml:452-516`, `PluginFirstPartyServiceApi.qml`).

**Plugin system surface (`shell/services/*`, `shell.qml`, `bin/omarchy-plugin-*`)**

- Discovery: first-party `$OMARCHY_PATH/shell/plugins/**/manifest.json` + `*.manifest.json` (depth 2–3), third-party `~/.config/omarchy/plugins/<dir>/manifest.json` only; bash scan subprocess (`PluginRegistry.qml:689-721`). `~/.config/omarchy/plugins` watched with `inotifywait -m -r` → `localPluginChanged` → 150 ms debounce → full `reloadPlugins()` (hidden dirs and `.git` ignored) (`:663-687`, `728-740`; `shell.qml:61-65`, `1441-1481`).
- Manifest validation (both `PluginRegistry.validateManifest` and `omarchy-plugin-validate`): `schemaVersion === 1` (number), required `id name version kinds entryPoints`, id without `/`, `..`, leading `/` (CLI: `^[A-Za-z0-9][A-Za-z0-9._-]*$`), `kinds` non-empty array, `entryPoints` object of relative paths without `..`, `barWidget.defaultSection ∈ left|center|right`; CLI additionally: entry files exist, one entry point per declared kind (`bar→bar`, `bar-widget→barWidget`, `menu`, `overlay`, `panel`, `service`), no symlinks anywhere (outside `.git`), id not `omarchy.*` (`PluginRegistry.qml:43-90`; `bin/omarchy-plugin-validate`).
- Reserved namespace: third-party manifests whose id is `omarchy.*` or collides with a first-party id are dropped at scan with `PluginRegistry: plugin <id> rejected: id is reserved for first-party Omarchy plugins` (`:629-636`).
- Enabled semantics: bar option = `bar.id`; bar widget = present in `bar.layout.{left,center,right}`; other third-party = entry in `plugins[]`; first-party non-widget = on unless in `disabledPlugins[]`; clones (`omarchy.clonedFrom`) route calls made to the built-in id (`resolveEnabledId`) and disable the source while active (`:135-182`, `474-567`).
- Shell IPC target `shell`: `ping`, `applyTheme`, `rescanPlugins`, `reloadConfig`, `toggleBarTransparency`, `setPluginEnabled <id> true|false` → `ok|unknown`, `enablePlugin <id> <placementJson>` → `ok|<error>`, `putBarWidget`, `moveBarWidget`, `setBarWidget`, `listPlugins` (JSON `[{id,name,kinds,enabled,active,canDisable,firstParty,clonedFrom}]` sorted by name), `listShellConfig`, `debugBarGeometry`, `summon|hide|toggle <id> [payload]`, `togglePanelAt`, `call <id> <method> <arg>` (`shell.qml:1574-1733`).
- `omarchy-shell [-q] <target> <method> [args]`: 2 s timeout (`OMARCHY_SHELL_IPC_TIMEOUT`); errors `omarchy-shell is not running` / `is not responding` / `is not ready` / `Target not found.` / `Function not found.` / `Too few|many arguments provided…` exit 1; `-q` swallows everything and exits 0; recovers `WAYLAND_DISPLAY` from the runtime dir when called from a TTY (`bin/omarchy-shell`).
- CLI: `omarchy-plugin-list [--json]` (table `ID STATE SOURCE KINDS NAME`), `omarchy-plugin-add [git-url|path] [--enable] [--yes]` (URL guard `omarchy-git-url-check`: refuses `-…`, `helper::…`, non-allowlisted `scheme://`; allows `file://` and bare paths; clone → validate → id collision check → move → `rescanPlugins` → optional enable with gum section picker), `omarchy-plugin-enable <id> [section] [--section|--index|--before|--after]` (refuses placement for a full bar), `omarchy-plugin-disable <id>`, `omarchy-plugin-remove [id] [--yes]` (disable first; git checkout → `rm -rf`, symlink → unlink, plain dir → hidden timestamped backup), `omarchy-plugin-update [id] [--yes]` (fetch, show diff, ff-only merge, re-validate, roll back to `ORIG_HEAD` on failure), `omarchy-plugin-clone <omarchy.id> [--edit]` (copy to `~/.config/omarchy/plugins/<user>.<name>/`, rename `My <Name>`, `omarchy.clonedFrom`, enable, notification `Editing Cloned Plugin`), `omarchy-plugin-validate <dir>`, `omarchy-plugin-catalog` (JSON of every manifest).
- Menu: `Setup → Plugins → Enable Plugin | Disable Plugin | Add Plugin | Clone Plugin | Remove Plugin` (`omarchy-menu-plugin`; Add/Clone/Remove open a floating terminal; Remove only shown when a user plugin exists) (`omarchy-menu.jsonc:174-179`).
- Plugin-facing API (`PluginShellApi`): `serviceFor(id)` (own service only), `firstPartyServiceFor(id)` (own, or the four narrow proxies for a `kind: bar` plugin), `summon/hide/toggle/isPluginOpen(id)` (own id, or UI plugins for a full bar, or the clone allow-list `audio/media/monitor→osd`, `network→speedtest/wifiqr`), `updateEntryInline`, `mutateShellConfig` (bar subtree, full bars only), `appLibrary` (menus only), `bar` scalar state, `barConfig`, `idleConfig` (clones of `omarchy.idle` only) (`PluginShellApi.qml`; `shell.qml:518-729`). `PluginRegistryApi` is self-scoped; `PluginBarWidgetRegistryApi` is a snapshot. Authentication services (`omarchy.lock`, `omarchy.polkit`) live in `AuthServiceStore` and are never reachable through `shell.services`.
- Injected properties on any plugin root: `omarchyPath`, `shell`, `manifest` (public copy), `barWidgetRegistry`, `pluginRegistry`, `service` (panels) (`shell.qml:916-921`, `1329-1338`).
- Loader behaviour: services and `keepLoaded` panels mounted at startup, other panels/overlays/menus on `summon`; a failing panel load logs `panel plugin <id> failed to load:` and hides; a failing bar option falls back to `omarchy.bar`; a failing widget logs `Plugin widget <id> failed:` and emits `pluginLoadFailed` (`shell.qml:250-264`, `1324-1353`, `1490-1514`).
- `shell.json` loading: `$OMARCHY_PATH/config/omarchy/shell.json` defaults, `~/.config/omarchy/shell.json` user file **replaces defaults entirely** when it parses and has `version: 1`; otherwise `shell.json parse failed, using defaults` / `shell.json missing version: 1, using defaults` in the journal; both files watched live; writes are atomic (`shell.qml:36-143`). Builtin fallback bar = menu, workspaces | clock | audio (`:37-54`).

**Shell host lifecycle and autostart**

- Session: `default/wayland-sessions/omarchy.desktop` → `uwsm start -g -1 -e -D Hyprland hyprland.desktop`; `default/uwsm/env.d/10-omarchy` sources `env-bootstrap`, `default/uwsm/default` (`TERMINAL=xdg-terminal-exec`, `EDITOR=omarchy-launch-editor --inline`), `~/.config/uwsm/default`, activates mise.
- Hyprland start (`default/hypr/autostart.lua`): `systemctl --user import-environment`, `dbus-update-activation-environment`, `omarchy-launch-shell`, `omarchy-provision-first-run`, `omarchy-powerprofiles-init`, `omarchy-hyprland-monitor-watch`, `udiskie --automount --no-notify --no-tray`, `sleep 2 && omarchy-hook post-boot`. User hook file `config/hypr/autostart.lua` (`o.launch_on_start("…")`).
- `omarchy-launch-shell`: runs `systemd-cat -t omarchy-shell quickshell -n -p $OMARCHY_PATH/shell` with `QS_DISABLE_FILE_WATCHER=1 QS_NO_RELOAD_POPUP=1`; relaunches on non-zero exit after 1 s, up to 5 relaunches per 60 s window (`Giving up on the Omarchy shell after N relaunches in under a minute.`), never after a clean exit or when `hyprctl -j monitors` fails 3×; journal tag `omarchy-shell` (`Omarchy shell exited with status N; relaunching.`).
- `omarchy-restart-shell` (menu `Update → Process → Shell`, `omarchy restart shell`): refuses with `Refusing to restart Omarchy shell while the session is locked.` when `omarchy-hyprland-session-locked` says locked and `lock status` reports `secure|requested`; otherwise kills every instance (`quickshell kill -p … --any-display`), relaunches via `hyprctl dispatch exec omarchy-launch-shell`, waits ≤2 s for `ping`, re-locks a stranded session (30 s budget) and restarts `omarchy-*-invitation` units; `Omarchy shell did not become ready after restart.` on failure.
- `omarchy-hyprland-session-locked`: exit 0/1/2 from `hyprctl -j monitors` `solitaryBlockedBy` containing `LOCK`.
- `Style` singleton re-polls `decoration:rounding` and `general:gaps_out` 200 ms after theme/gap-toggle changes; `fontconfig/fonts.conf` watched for `fc-match monospace` (`Commons/Style.qml:442-509`).

## Observations

1. **Blank timing the driver must know.** The lock screen goes black exactly 5 s after the last input while locked (`hyprctl dispatch dpms off`); the timer re-arms on every wake, so a driver that pauses >5 s between actions will always be looking at a black screenshot. A mouse move (`mouse move`) is the harmless wake; the first character typed while black both wakes the panel and lands in the field. `dpms on` is a modeset on virtio-vga: take a second screenshot ~1 s after waking before concluding the screen is still black. The blank is suppressed only while a password check is in flight, not while text is merely typed.
2. **Idle defaults are far outside the session budget** (150 s screensaver, 300 s lock). Every idle test must first shorten `idle.screensaver` / `idle.lock` in `~/.config/omarchy/shell.json`; the file is watched, so the new numbers apply without a restart and `omarchy-shell idle status` confirms them. Both are counted from idle start (not chained). Screenshots do not count as input; any `send-keys`/`mouse` does and cancels the cycle.
3. **`shell.json` is replace-not-merge.** A user file must carry the whole document. Writing `{"version":1,"idle":{…}}` alone silently replaces the bar layout with the builtin minimal bar (menu, workspaces, clock, audio). Edit with `jq` in place; if the file does not exist yet, copy `$OMARCHY_PATH/config/omarchy/shell.json` first. Invalid JSON or a missing `version` falls back to the defaults and only logs a warning.
4. **Lockout is real and shared.** `deny=10 unlock_time=120`: the 11th attempt fails even with the right password, and because the faillock tally is per user, `sudo` is locked for the same 120 s. A successful unlock (`authsucc`) resets the tally. Failure counts from earlier tests on the same disk within 15 min accumulate.
5. **There is no clock on the lock screen** (the task's inventory mentions one; `LockView.qml` has only the field). No user name, hostname or hint either; the only text is `Enter Password` / `Checking…` / `Authentication failed (N)`.
6. The lock re-reads the background symlink at every lock, so the lock wallpaper always matches the desktop wallpaper chosen before locking (blurred for images, darkened for videos).
7. `omarchy-restart-shell` refuses while locked; the only way to exercise it "under lock" is to schedule it from a terminal (`sleep N; omarchy-restart-shell`) before locking. Killing the shell while locked (`pkill -9 -x quickshell`) is the stranded-lock path: Hyprland keeps the session locked, the supervisor relaunches the shell within ~2 s, and the new lock service re-locks and shows the field again (`allow_session_lock_restore = true`).
8. Empty Enter on the lock field is a silent no-op (no `Checking…`, no counter). `Escape` and `Ctrl+U` clear the field. Dots shrink as the password grows instead of scrolling.
9. The screensaver exits on any **key**, or when its window loses focus; the manual's "mouse movement exits it" is not what `omarchy-screensaver` does on a single monitor (the cursor is hidden and focus does not change). Record whichever happens.
10. `omarchy-system-lock` kills a running screensaver before showing the lock; the idle service skips launching the screensaver while already locked.
11. Dismissing the screensaver cancels the pending lock, but the desktop is idle again immediately, so a new cycle starts `min(screensaver,lock)` seconds later. Keep jiggling the mouse when proving "no lock followed".
12. With `screensaver-off` toggled, the idle cycle goes straight to the lock at the lock deadline (the screensaver launch exits 1 and the 3 s grace timer keeps the cycle armed because the compositor is still idle).
13. `omarchy-theme-bg-set` with a file that exists but is not an image leaves the wallpaper visually unchanged (the incoming frame never becomes ready, the old frame stays on top) while the symlink now points at junk; `omarchy-theme-bg-next` recovers to the first entry. After a shell restart such a symlink renders a black desktop.
14. Background cycling order is `~/.config/omarchy/backgrounds/<theme>/*` then the theme's own folder, sorted by path; no `prev`. A file dropped into the user folder joins both the cycle and the picker without any refresh.
15. No shipped theme has a video wallpaper; the video path can be exercised by generating an `.mp4` with `ffmpeg` (present as a dependency of `ffmpegthumbnailer`) into the user background folder. Software decoding on 2 vCPU is fine at 1280×720/15 fps.
16. Plugin discovery accepts a bare filesystem path as the "git URL" (`omarchy-git-url-check` only guards `::` and unknown schemes), so add/update/remove/rollback can be tested end-to-end with a local `git init` repo and no network. `--yes` without `--enable` never enables; use `--enable --yes` for unattended enable.
17. `omarchy-plugin-disable <unknown-id>` prints `Disabled <unknown-id>` and exits 0 (disable of an unknown id is not rejected by `setEnabled`); `omarchy-plugin-enable <unknown-id>` correctly says `not known`. Record, do not fail, the disable quirk.
18. A saved file anywhere under `~/.config/omarchy/plugins/` hot-reloads all plugins (150 ms debounce); `keepLoaded` services (lock, idle, media) survive that reload, so a plugin edit never drops the lock.
19. The shell's own log lines are in the journal under `-t omarchy-shell` (both the QML `console.log` lines and the launcher's `logger` lines). `journalctl -t omarchy-shell --since -5min --no-pager | sudo tee /dev/ttyS0` is the way to read them.
20. `omarchy-shell` IPC has a 2 s timeout; right after `pkill -9 quickshell` it reports `omarchy-shell is not running` (exit 1) for ~1–2 s until the supervisor's relaunch answers `ping` again. Six kills inside a minute make the supervisor give up; `omarchy-restart-shell` recovers.
21. Third-party plugins get `PluginShellApi`, not the real `ShellRoot`: `serviceFor`/`firstPartyServiceFor` return `null` for anything but their own service (and the four narrow proxies for a `kind: bar`), `summon("omarchy.menu")` returns `false`. This is observable from inside a plugin by writing a file.
22. The bar widget test sample uses `import qs.Ui` + `BarWidget {}`; `qs` resolves to the running shell root even for files under `~/.config/omarchy/plugins`. A `defaultSection: "right"` widget is inserted right after `omarchy.tray`.
23. `omarchy-plugin-clone` names the clone `<user>.<name>` (`prime.clock`), shows `My Clock` in `plugin list`, disables `omarchy.clock` (`disabledPlugins`/layout swap), and `remove` puts the built-in back. The menu variant opens `$EDITOR`; use the CLI from a terminal in the VM.
24. Hardware absent in the VM: no fingerprint (`fprintd`), no battery/UPower device, no backlight (`omarchy-brightness-display off` still works because it dispatches DPMS, `brightnessctl` is only used for percentages), no audio device (MPRIS players may still register but no PipeWire streams match), single monitor (ScreenMoveRemap, per-monitor screensaver loops trivially).
25. HEAD vs 4.0.2: HEAD's `omarchy-plugin-validate` checks "an entry point per kind"; if the minted disk is older that message may differ. `plugins.omarchy.org` lists zero community plugins at review time; the task's suggested `omacom/elsewhen` and `omarchy-notification-center-plugin` could not be verified as Quattro-manifest repos, so the NET add test tells the driver to verify the URL first.

## Proposed tests

### lock-hotkey-unlock   [VM-OK]
description: Super+Ctrl+L locks the session from the keyboard and the account password unlocks it, with the desktop (an open terminal and its text) returned exactly as left; complements the menu-driven `lock-screen` test.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo LOCK-HOTKEY-MARKER` then Enter so the window has recognisable content.
  * Press Super+Ctrl+L.
  ** Within 1 second the screen must change to the lock screen: a blurred, slightly darkened copy of the wallpaper with one centred rounded box reading `Enter Password`. No clock, no user name.
  ** Take the screenshot immediately; after 5 seconds without input the lock screen turns black (that is expected, see next test).
  * Type `prime` and press Enter.
  ** While the check runs the box briefly reads `Checking…`; then the desktop returns.
  * Confirm the terminal is still there with `LOCK-HOTKEY-MARKER` visible and the bar is at the top.
  * In the terminal run `omarchy-shell lock isLocked` — it must print `false`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkey is Ctrl+Super+L; with send-keys that is `<C-M-l>`.
  * If the screenshot after locking is black, move the mouse a little and screenshot again; the field returns.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the lock screen showing the `Enter Password` box over the blurred wallpaper
  ** Screenshot of the restored desktop with the terminal still showing `LOCK-HOTKEY-MARKER`
  ** Terminal shows `false` from `omarchy-shell lock isLocked`
  * If unsuccessful
  ** Screenshot of whatever appeared instead of the lock screen (or nothing) after the hotkey
  ** Output of `omarchy-shell lock status` and `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy lock' | sudo tee /dev/ttyS0`
covers: shell/plugins/lock/Service.qml (beginLock/finishUnlock), LockView.qml, bin/omarchy-system-lock, default/hypr/bindings/utilities.lua:127, install/config/lockscreen-pam.sh

### lock-wrong-then-right-password   [VM-OK]
description: A wrong password is rejected with a numbered failure message and a red border, the counter grows on repeat, the message survives a blank/wake cycle, and the right password still unlocks afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and wait for the `Enter Password` box.
  * Type `wrongpass` and press Enter.
  ** The box empties and shows italic text `Authentication failed (1)`; the box border turns to the theme's error colour (reddish).
  * Type `wrongagain` and press Enter.
  ** The message now reads `Authentication failed (2)`.
  * Do nothing for 7 seconds (take screenshots at ~3 s and ~7 s). The screen must be black by the second one.
  * Move the mouse a little. The lock screen comes back and must still read `Authentication failed (2)`.
  * Type `prime` and press Enter — the failure text disappears with the first character typed, and the desktop must return.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each PAM check takes 1–3 seconds; wait for the message before typing the next attempt.
  * The counter is per lock session; it resets to 0 the next time you lock.
  * These two failures also count toward the 10-failure lockout if another test runs on the same disk within 15 minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing `Authentication failed (1)` and `Authentication failed (2)` in the box with the error-coloured border
  ** A black screenshot, then the lock screen back with `(2)` still shown after the mouse move
  ** Screenshot of the desktop after `prime`
  * If unsuccessful
  ** Screenshot of the box after the wrong password (no message, wrong count, or an unlock on a wrong password — the latter is a security failure, report loudly)
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy lock' | sudo tee /dev/ttyS0`
covers: shell/plugins/lock/Service.qml (handlePasswordFailure, runWake), LockView.qml (failureMessage, clearFailureRequested, Escape), bin/omarchy-apply-lock PAM stanza

### lock-empty-submit-and-escape-clear   [VM-OK]
description: Pressing Enter on an empty password field does nothing (no check, no failure count), while Escape and Ctrl+U clear typed text; the unhappy input paths of the lock field.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and wait for the `Enter Password` box.
  * Press Enter three times, about one second apart.
  ** Nothing must change: the placeholder stays `Enter Password`, no `Checking…`, no `Authentication failed` text, and the session stays locked.
  * Type `abc`. Three dots `●●●` must appear in the box.
  * Press Escape. The dots vanish and `Enter Password` returns.
  * Type `abc` again, then press Ctrl+U. The dots vanish again.
  * Type `abc` then press Enter. `Authentication failed (1)` must appear — proving the empty Enters earlier were not counted.
  * Type `prime` and press Enter. The desktop returns.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep each step under 5 seconds or the screen blanks; a mouse move brings it back without typing anything.
  * Ctrl+U with send-keys is `<C-u>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots after the three empty Enters still showing the untouched `Enter Password` placeholder
  ** Screenshot with three dots, then the cleared field after Escape and after Ctrl+U
  ** `Authentication failed (1)` (not 4) after the first real wrong submit, then the desktop after `prime`
  * If unsuccessful
  ** Screenshot showing `Checking…` or a failure message after an empty Enter, or dots that Escape did not clear
covers: shell/plugins/lock/LockView.qml (onAccepted, Keys.onPressed Escape/Ctrl+U), Service.qml submitPassword length guard

### lock-long-password-overflow   [VM-OK]
description: A very long password never clips or overflows the field — the masking dots shrink to stay inside the box — and is still rejected cleanly, so every keystroke remains visible to the user.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and wait for the `Enter Password` box.
  * Type 40 letters `a` in one go. Dots fill the middle of the box at normal size.
  * Type another 120 letters `a` (total 160). Screenshot.
  ** The dots must now be visibly smaller and tightly packed, all still inside the rounded box; nothing may spill past the box border or be cut off on either side.
  * Press Enter. The box must clear and show `Authentication failed (1)`.
  * Type `prime` and press Enter. The desktop returns.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send the letters as one literal string in a single send-keys call, then screenshot at once (the 5 s blank timer restarts on every key).
  * Compare the dot size between the 40-letter and 160-letter screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot at 40 dots (normal size) and at 160 dots (shrunk, still inside the box)
  ** `Authentication failed (1)` after Enter, then the restored desktop
  * If unsuccessful
  ** Screenshot showing dots clipped at the box edge, dots drawn outside the box, or a frozen/unresponsive field
covers: shell/plugins/lock/LockView.qml (passwordDotScale, dotMetrics), test/shell.d/lock-password-overflow-test.sh

### lock-blanks-after-five-seconds-and-wakes   [VM-OK]
description: The locked display goes dark five seconds after the last input, wakes on mouse movement, re-blanks five seconds later, and a password typed into the dark screen both wakes it and unlocks — the idle/blank contract of the lock.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L. Screenshot at once: the `Enter Password` box is visible.
  * Without any input take screenshots at roughly 2 s, 4 s and 7 s after locking.
  ** The 2 s and 4 s shots still show the box; the 7 s shot must be completely black.
  * Move the mouse a little. Screenshot within 1–2 s: the lock screen with the box is back.
  * Wait 7 seconds again with no input and screenshot: black again (the timer re-armed).
  * With the screen black, type `prime` and press Enter without moving the mouse first.
  ** The screen wakes and the desktop appears (the typed characters went into the field even though it was dark).
  * Run `omarchy-shell lock isLocked` in a terminal — `false`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Black" means the whole screenshot is black; a dark blurred wallpaper with the box is not black.
  * After waking, the virtual display needs a moment to turn back on; if the first screenshot is still black, take another one a second later before deciding.
  * You may only pause up to 5 s between actions; take a screenshot at each pause so the wait is made of ≤5 s steps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: box visible at 2 s and 4 s, fully black at ~7 s, box back after the mouse move, black again after another 7 s, desktop after typing into the dark screen
  * If unsuccessful
  ** Screenshot showing the box still lit at 10 s, or a screen that stays black after mouse movement and typing
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep -E 'omarchy lock|dpms' | sudo tee /dev/ttyS0`
covers: shell/plugins/lock/Service.qml (idleBlankTimer, runBlank, runWake), bin/omarchy-brightness-display off/on, bin/omarchy-system-wake, test/shell.d/lock-blank-fingerprint-test.sh

### lock-shows-current-wallpaper-blurred   [VM-OK]
description: The lock screen background is always a blurred copy of the wallpaper in use at lock time, so a wallpaper changed right before locking is what the lock screen shows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `orig=$(readlink -f ~/.local/state/omarchy/current/background); omarchy-theme-bg-current`. Note the name printed.
  * Run `omarchy-theme-bg-next`. The desktop wallpaper changes (quick diagonal wipe); `omarchy-theme-bg-current` now prints a different name.
  ** If the theme has a single background the name will not change; report that and continue.
  * Press Super+Ctrl+L and screenshot at once.
  ** The lock background must be a blurred, darker version of the wallpaper you just saw on the desktop — same colours and rough composition — not the previous one.
  ** Take the screenshot within 5 s of locking; after that the screen goes black (move the mouse to bring it back).
  * Type `prime` and press Enter. The desktop returns.
  * Restore the original wallpaper: `omarchy-theme-bg-set "$orig"` — the desktop shows the first wallpaper again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen has no clock or text besides the password box; judge the background by colour and shapes against the desktop screenshot.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Desktop screenshot with the new wallpaper and the lock screenshot showing its blurred counterpart
  ** Terminal showing two different `omarchy-theme-bg-current` names, and the original wallpaper restored at the end
  * If unsuccessful
  ** Lock screenshot showing the old wallpaper, a solid colour, or no background at all
covers: shell/plugins/lock/Service.qml (refreshBackground/readlinkProc), LockView.qml (BackgroundMedia + MultiEffect blur), bin/omarchy-theme-bg-next, bin/omarchy-theme-bg-set, bin/omarchy-theme-bg-current

### lock-refuses-restart-shell-while-locked   [VM-OK]
description: `omarchy-restart-shell` must never tear down a live lock screen; while the session is locked it refuses with a clear message and exits non-zero, and the desktop is intact afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run exactly:
    `(sleep 12; omarchy-restart-shell >/tmp/restart.log 2>&1; echo "exit=$?" >>/tmp/restart.log) &`
  * Immediately press Super+Ctrl+L to lock. Stay locked for at least 25 seconds, moving the mouse every 4 seconds so the screen stays visible (screenshot each time).
  ** The lock screen must remain; the bar must not flash back; nothing else appears.
  * Type `prime` and Enter to unlock.
  * In the terminal run `cat /tmp/restart.log`.
  ** It must contain `Refusing to restart Omarchy shell while the session is locked.` and `exit=1`.
  * Run `omarchy-shell shell ping` (prints `ok`) and check the bar is still at the top.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not unlock before the 12 s sleep has passed, or the restart runs against an unlocked session and succeeds instead.
  * The terminal window keeps running in the background while locked; that is intended.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Lock screenshots spanning >25 s with the box continuously present
  ** Terminal showing `Refusing to restart Omarchy shell while the session is locked.` and `exit=1`, and `ok` from ping
  * If unsuccessful
  ** Screenshot of the lock screen disappearing, a bar flashing over the lock, or a plain black/red screen with no password box
  ** Contents of /tmp/restart.log and `omarchy-shell lock status`
covers: bin/omarchy-restart-shell (locked guard), bin/omarchy-hyprland-session-locked, shell/plugins/lock/Service.qml status IPC, test/shell.d/restart-shell-test.sh ("restart preserves the shell while its lock is active")

### lock-recovers-after-shell-killed   [VM-OK]
description: If the shell dies while the session is locked, the compositor keeps the lock, the launcher relaunches the shell, and the new lock service re-takes the stranded lock so the user can still type a password — the stranded-lock recovery path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run exactly: `(sleep 10; pkill -9 -x quickshell) &`
  * Immediately press Super+Ctrl+L and keep the lock screen visible by moving the mouse every 4 seconds, screenshotting each time.
  * At around 10 s the password box disappears (the shell was killed). Screenshot what the screen shows — Hyprland's plain lock fallback (a solid or tinted screen, possibly with a text message). It must NOT show the desktop or any windows.
  * Keep screenshotting every 3–4 s. Within about 10 seconds the `Enter Password` box must reappear (new shell, lock re-taken).
  * Type `prime` and press Enter. The desktop must return with the bar and the terminal.
  * In the terminal run: `journalctl -t omarchy-shell --since -3min --no-pager | grep -E 'relaunching|lock-stranded|lock-requested|unlocked' | sudo tee /dev/ttyS0` (password `prime` for sudo) and read the serial log.
  ** Expected lines: `Omarchy shell exited with status 137; relaunching.`, `omarchy lock … lock-stranded: recovering`, `… lock-requested`, `… unlocked`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the box has not returned after 30 s the session is stranded: switch to a TTY with Ctrl+Alt+F3, log in as `prime`, run `omarchy-restart-shell`, return with Ctrl+Alt+F1 (or F2) and report the failure with the journal output.
  * The desktop must never be visible between the kill and the recovery; if it is, that is a security failure — report it loudly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot sequence: lock box → fallback screen without box → box back → desktop after `prime`
  ** Serial log with `relaunching`, `lock-stranded: recovering` and `unlocked`
  * If unsuccessful
  ** Screenshot showing the desktop/windows while the lock should be held, or a screen that never gets its password box back
  ** The journal excerpt above and `omarchy-shell lock status`
covers: shell/plugins/lock/Service.qml (checkStrandedLock/recoverStrandedLock, strandedLockRetryTimer), bin/omarchy-launch-shell (relaunch), bin/omarchy-hyprland-session-locked, default/hypr/looknfeel.lua allow_session_lock_restore, test/shell.d/lock-stranded-recovery-test.sh, launch-shell-test.sh

### lock-lockout-after-ten-failures   [VM-OK] [SLOW]
description: After ten consecutive wrong passwords the account is locked out for two minutes by pam_faillock (deny=10 unlock_time=120): the correct password is rejected during the window and accepted after it, protecting the lock screen against brute force.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and wait for the box.
  * Enter a wrong password ten times: type `x`, press Enter, wait for `Authentication failed (N)` to appear, screenshot, repeat until the message reads `Authentication failed (10)`. Note the wall-clock time of the tenth failure.
  * Now type the correct password `prime` and press Enter.
  ** It must be REJECTED: `Authentication failed (11)` appears and the session stays locked (the account is in the faillock window).
  * Wait until 125 seconds have passed since the tenth failure. Move the mouse every 4–5 seconds and screenshot each time so the screen stays visible and the wait is logged.
  * Type `prime` and press Enter. The desktop must return this time.
  * Open a terminal and run `sudo faillock --user prime` (password `prime`).
  ** The tally must be empty (the successful unlock reset it) or list only entries older than the unlock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Failures 1–10 each take 1–3 s; once locked out, failure 11 is near-instant.
  * Do not try `sudo` during the 120 s window — the same tally locks sudo too and you would only add confusion.
  * Whole test is about 4 minutes; keep every pause ≤5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots for `Authentication failed (10)` and `Authentication failed (11)` (the latter after typing the correct password)
  ** Screenshots showing the wait, then the desktop after the correct password once 120 s elapsed
  ** Terminal output of `sudo faillock --user prime` with no active tally
  * If unsuccessful
  ** The correct password unlocking immediately after 10 failures (lockout not enforced — report loudly), or still failing well after 3 minutes
  ** `sudo faillock --user prime` output and `sudo cat /etc/pam.d/omarchy-lock-password | sudo tee /dev/ttyS0`
covers: bin/omarchy-apply-lock (PAM stanza deny=10 unlock_time=120), install/config/increase-lockout-limit.sh, etc/security/faillock.conf, shell/plugins/lock/Service.qml handlePasswordFailure, test/shell.d/apply-lock-test.sh

### lock-preview-overlay   [VM-OK]
description: `omarchy-shell lock preview` shows a non-interactive copy of the lock screen for theme authors; it accepts no password input, a click dismisses it, and `hidePreview` hides it programmatically — without ever locking the session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `omarchy-shell lock preview`.
  ** The screen shows the lock look (blurred wallpaper + `Enter Password` box) and the command printed `ok`.
  * Type `abc` and press Enter. Nothing must happen: no dots, no `Checking…`, no failure message (the preview field is disabled).
  * Click anywhere with the left mouse button. The preview disappears and the desktop with the terminal is back.
  * Run `omarchy-shell lock isLocked` — `false` (the session was never locked).
  * Run exactly: `omarchy-shell lock preview; sleep 6; omarchy-shell lock hidePreview` — the preview shows for ~6 s and then hides itself without any click.
  * Wait 8 s with screenshots to confirm the preview never blanks the screen (no black) — the 5 s blank timer belongs to real locks only.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The preview has exclusive keyboard focus, so you cannot type into the terminal while it is up; that is why the second command is chained in one line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the preview, of it ignoring typed text, and of the desktop after the click
  ** Terminal shows `ok` and `false`
  ** Screenshot sequence showing the chained preview staying visible ~6 s and then gone
  * If unsuccessful
  ** Screenshot showing dots/`Checking…` in the preview, a preview that a click cannot dismiss, or a real lock (isLocked `true`)
covers: shell/plugins/lock/Service.qml (previewWindow, IpcHandler preview/hidePreview)

### lock-status-ipc-and-journal-trail   [VM-OK]
description: The lock can be driven and inspected from a terminal — `omarchy-shell lock lock` locks, `status` reports the state, and every transition lands in the journal — so scripts and support can see what the lock did.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `omarchy-shell lock status | jq .`.
  ** It must show `"locked": false`, `"passwordPam": true`, `"fingerprint": false`, `"realScreens": 1`.
  * Run `omarchy-shell lock lock`. It prints `ok` and the lock screen appears at once.
  ** The lock screen blanks 5 s after the last input; a mouse move brings it back.
  * Type `prime` and press Enter. The desktop with the terminal returns.
  * Run `omarchy-shell lock status | jq .lastEvent` → `"unlocked"`.
  * Run `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy lock' | sudo tee /dev/ttyS0` (password `prime`) and read the serial log.
  ** In order it must contain `lock-requested`, `lock-pending: screen-stabilizing`, `session-locked=true`, `secure=true`, `unlocked`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `jq` is installed; without it the status is one long JSON line.
  * If `journalctl` says no journal files were found, prefix the command with `sudo`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots of the status JSON, `ok`, and `"unlocked"`; the engaged lock screen; the restored desktop
  ** Serial log with the five events in order
  * If unsuccessful
  ** Whatever the IPC printed (`omarchy-shell is not running`, `missing-pam`, `passwordPam: false`) and the journal excerpt
covers: shell/plugins/lock/Service.qml (IpcHandler lock/isLocked/status, logEvent), bin/omarchy-shell, bin/omarchy-launch-shell (systemd-cat journal tag)

### lock-fingerprint-indicator-absent   [VM-PARTIAL]
description: Without an enrolled fingerprint reader the lock screen shows no fingerprint hint and the Security menu offers no fingerprint setup — the graceful absence path (the enrolled path needs hardware the VM lacks).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and screenshot the password box within 5 s.
  ** The right end of the box must be empty — no fingerprint glyph inside the field; the placeholder is centred.
  * Type `prime`, press Enter. The desktop returns.
  * Open a terminal (Super+Enter) and run `omarchy-shell lock status | jq .fingerprint` → `false`.
  * Run `ls /etc/pam.d/omarchy-lock-fingerprint` → `No such file or directory`.
  * Press Super+Space, click `Setup`, click `Security` and screenshot: no `Fingerprint` row is offered. Press Escape to close the menu.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped in this VM: the enrolled path (glyph shown, touch to unlock). Only the absence is verified.
  * The lock screen blanks after 5 s without input; move the mouse to bring it back.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Lock screenshot with an empty right edge in the box; Setup → Security screenshot without a Fingerprint row
  ** Terminal showing `false` and the missing PAM file
  * If unsuccessful
  ** A fingerprint glyph on the box, `fingerprint: true`, or a Fingerprint menu entry on a machine without a reader
covers: shell/plugins/lock/Service.qml (fingerprintCheckProc, startFingerprint), LockView.qml fingerprintIndicator, bin/omarchy-apply-lock fingerprint branch, omarchy-menu.jsonc setup.security.fingerprint `when`, test/shell.d/lock-fingerprint-indicator-test.sh

### lock-denied-without-pam-config   [VM-OK]
description: When the lock's PAM service file is missing the shell refuses to lock instead of showing a lock nobody could open, and `omarchy-apply-lock` puts the file back and the lock works again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `sudo mv /etc/pam.d/omarchy-lock-password /tmp/` (password `prime`).
  * Wait 3 s, then run `omarchy-shell lock lock` → it prints `missing-pam` and no lock screen appears.
  * Press Super+Ctrl+L. Nothing must happen: the desktop stays (screenshot).
  ** If a lock screen does appear here, type `prime` + Enter and report the failure; do not continue with the restore until unlocked.
  * Run `sudo omarchy-apply-lock` → prints `Configuring lock screen password authentication...` and `Lock screen authentication configured.`
  * Wait 3 s, press Super+Ctrl+L: the lock screen appears. Type `prime`, Enter → desktop.
  * Run `sudo rm -f /tmp/omarchy-lock-password` to tidy up.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell watches the PAM file; if `omarchy-shell lock lock` still prints `ok` 10 s after the move, report it and run `sudo omarchy-apply-lock` immediately.
  * `omarchy-shell lock status | jq .passwordPam` shows the flag the hotkey relies on (`false` while the file is away).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing `missing-pam` and the two apply-lock lines
  ** Screenshot of the unchanged desktop after the hotkey while the file was missing, and the working lock screen afterwards
  * If unsuccessful
  ** A lock screen shown while the PAM file was missing (and whether `prime` opened it), or the lock still refusing after apply-lock
covers: shell/plugins/lock/Service.qml (FileView /etc/pam.d/omarchy-lock-password, beginLock lock-denied, IPC missing-pam), bin/omarchy-apply-lock, install/config/lockscreen-pam.sh

### lock-closes-running-screensaver   [VM-OK]
description: Locking while the screensaver is running kills the screensaver first so the lock screen is what the user sees, and no screensaver processes are left behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run exactly: `(sleep 15; omarchy-system-lock) &`
  * Press Super+Escape to open the System menu and click `Screensaver` with the mouse.
  ** A fullscreen black window with animated ASCII art appears within ~2 s.
  * Do not press any key or move the mouse; take screenshots every 4 s.
  * At about 15 s the screensaver is replaced by the lock screen (`Enter Password` box over the blurred wallpaper).
  * Type `prime`, Enter. The desktop returns.
  * In the terminal run `pgrep -fa org.omarchy.screensaver; pgrep -x ttfx; echo "done"` → only `done` (no processes).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Any key or mouse click while the screensaver runs would end it early; screenshots are fine.
  * If the screensaver does not start, run `omarchy-launch-screensaver force; echo $?` and report its message (it needs foot/alacritty/ghostty/kitty as default terminal).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the running ASCII screensaver, then the lock screen replacing it, then the desktop
  ** Terminal shows no screensaver/ttfx processes
  * If unsuccessful
  ** Screenshot of the screensaver still running over/under the lock, or leftover `org.omarchy.screensaver` processes
covers: bin/omarchy-system-lock (pkill ttfx/pidwait/pkill screensaver), bin/omarchy-launch-screensaver, bin/omarchy-screensaver, test/shell.d/system-lock-test.sh

### idle-chain-screensaver-then-lock   [VM-OK]
description: With shortened idle timings the shell runs the full unattended chain — idle → screensaver → lock → blank — and a key wakes the lock for a normal unlock; timings are read live from shell.json.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run, one line at a time:
    `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f`
    `jq '.idle = {screensaver: 20, lock: 40}' $f > /tmp/s.json && mv /tmp/s.json $f`
    `omarchy-shell idle status | jq '{enabled, screensaver, lock}'`
  ** Must print `"enabled": true`, `"screensaver": 20`, `"lock": 40` (picked up live, no restart).
  ** shell.json replaces the defaults wholesale — never write a file with only an `idle` block, or the bar layout is lost; that is why the stock file is copied and edited in place.
  * Now stop touching the machine: no keys, no mouse. Take a screenshot every 5 seconds and note the elapsed time.
  ** ~20 s: a fullscreen black window with animated ASCII art (screensaver) appears.
  ** ~40 s: the screensaver is replaced by the lock screen (`Enter Password` box).
  ** ~45 s: the screen goes black (lock blank).
  * Move the mouse; the lock box comes back. Type `prime`, Enter. The desktop returns.
  * Run `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0` (password `prime`).
  ** Expected: `idle-cycle-start: screensaver=20 lock=40`, `process-start: screensaver …`, `lock-system: lock-timeout`.
  * Restore: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f` and confirm with `omarchy-shell idle status | jq .lock` → `300`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshots do not count as activity; any send-keys or mouse call does and cancels the countdown — the journal will then show `idle-cycle-cancel: activity`.
  * The times are counted from the moment you stopped typing (the terminal Enter). Allow ±3 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing the status JSON with 20/40
  ** Timestamped screenshots: desktop → screensaver (~20 s) → lock (~40 s) → black (~45 s) → lock box after mouse → desktop
  ** Serial log with `idle-cycle-start: screensaver=20 lock=40` and `lock-system: lock-timeout`
  * If unsuccessful
  ** Screenshot at 60 s still showing the desktop (nothing fired) or the lock arriving without the screensaver first
  ** The idle journal excerpt and `omarchy-shell idle status | jq .`
covers: shell/plugins/services/idle/Service.qml (startIdleCycle, screensaverTimer, lockTimer), IdleModel.js, shell/shell.qml shell.json watch, config/omarchy/shell.json, manual/13-toggles-idle-screensaver.md Idle, test/shell.d/idle-test.sh

### idle-stay-awake-toggle-blocks-idle   [VM-OK]
description: Stay Awake shows a coffee-cup indicator in the bar and stops the idle screensaver and lock from ever firing; switching it off again re-arms idle — via the hotkey to turn on and the Toggle menu to turn off.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and shorten idle so the test fits: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; jq '.idle = {screensaver: 15, lock: 30}' $f > /tmp/s.json && mv /tmp/s.json $f`
  ** shell.json replaces the defaults wholesale, which is why the stock file is copied first and edited in place.
  * Press Super+Ctrl+I. A coffee-cup glyph appears in the bar's centre indicator area, left of the clock.
  * Run `omarchy-shell idle status | jq '{enabled, stayAwake}'` → `"enabled": false`, `"stayAwake": true`.
  * Stop all input for 40 s, screenshotting every 5 s: no screensaver and no lock screen may appear.
  * Press Super+Space, click `Trigger`, click `Toggle`, click `Stay Awake` with the mouse. The coffee-cup indicator disappears.
  * Stop all input for 20 s: the screensaver appears at ~15 s. Press Space to dismiss it.
  * Restore idle: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The indicator glyph is small; zoom into the bar centre. Hovering it shows the tooltip `Stay Awake`.
  * Super+Ctrl+I with send-keys is `<C-M-i>`. Screenshots do not count as activity; any key or mouse call does.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots with and without the coffee-cup indicator; terminal JSON `enabled: false, stayAwake: true`
  ** 40 s of screenshots with no screensaver/lock while awake; the screensaver appearing after the menu toggle
  * If unsuccessful
  ** Screensaver or lock appearing while Stay Awake is on, or the indicator not changing
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0`
covers: bin/omarchy-toggle-idle, shell/plugins/services/idle/Service.qml (stayAwake, FileView watcher, applyStayAwake), shell/plugins/bar/indicators/StayAwake.qml, default/hypr/bindings/utilities.lua:31, omarchy-menu.jsonc trigger.toggle.idle-lock, test/shell.d/idle-test.sh

### idle-config-invalid-values-fall-back   [VM-OK]
description: Bad idle numbers in shell.json fall back to the 150/300 defaults instead of breaking idle, and a lock deadline shorter than the screensaver locks directly without a screensaver — the edge cases of the idle configuration.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Prepare: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f`
  * Run `jq '.idle = {screensaver: "soon", lock: -5}' $f > /tmp/s.json && mv /tmp/s.json $f` then `omarchy-shell idle status | jq '{screensaver, lock, enabled}'`.
  ** Must print `150`, `300`, `true` (invalid values ignored, idle still enabled).
  * Run `jq '.idle = {screensaver: 600, lock: 25}' $f > /tmp/s.json && mv /tmp/s.json $f` then `omarchy-shell idle status | jq '{screensaver, lock, screensaverDelay, lockDelay}'`.
  ** Must print `600`, `25`, `575`, `0`.
  * Stop all input for 35 s, screenshotting every 5 s.
  ** At ~25 s the lock screen appears directly — no screensaver beforehand.
  * Move the mouse, type `prime`, Enter to unlock.
  * Restore: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`; confirm `omarchy-shell idle status | jq .lock` → `300`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `omarchy-shell idle status` errors with `not running`, the shell crashed on the config — that is a failure; run `omarchy-restart-shell` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal JSON showing 150/300 after the bad values and 600/25/575/0 after the second edit
  ** Screenshots: desktop until ~25 s, lock screen at ~25 s with no screensaver frame in between, desktop after unlock
  * If unsuccessful
  ** Status showing `soon`/`-5`/`0`, a shell that stopped answering, or a screensaver appearing before the lock
covers: shell/plugins/services/idle/IdleModel.js secondsFromConfig, idle/Service.qml (firstIdleTimeoutSeconds, lockDelaySeconds), test/shell.d/idle-test.sh

### screensaver-menu-start-and-key-dismiss   [VM-OK]
description: The screensaver starts on demand from System → Screensaver, animates with the cursor hidden, and a key press ends it and restores the desktop and cursor; the test also records whether mouse movement alone ends it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) so a window is on screen.
  * Press Super+Escape and click `Screensaver` with the mouse.
  ** Within ~2 s a fullscreen black window with animated ASCII art appears; the mouse cursor is hidden.
  * Take screenshots at 3 s and 8 s without any input: the two frames must differ (it is animating).
  * Move the mouse once and screenshot after 2 s. Record whether the screensaver is still running (expected: still running — the manual claims movement exits it; report what you see).
  * Press Space. The screensaver closes; the desktop with the terminal is back and the cursor is visible.
  * In the terminal run `pgrep -fa org.omarchy.screensaver; pgrep -x ttfx; echo done` → only `done`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The fullscreen screensaver has keyboard focus; Space or Escape ends it. Do not press keys while you want it running.
  * If a notification `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` appears, report it with the output of `xdg-terminal-exec --print-id`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two differing screensaver frames; the desktop back after Space with the cursor visible
  ** Terminal showing `done` alone; a note on the mouse-movement behaviour observed
  * If unsuccessful
  ** A screensaver that Space does not dismiss, a blank terminal without animation, or the unsupported-terminal notification
covers: bin/omarchy-launch-screensaver, bin/omarchy-screensaver, omarchy-menu.jsonc system.screensaver, manual/13-toggles-idle-screensaver.md "The screensaver"

### screensaver-toggle-off-skips-to-lock   [VM-OK]
description: Turning the screensaver off from the Toggle menu blocks the idle screensaver with a notification, `force` still starts it on demand, and the idle cycle then goes straight to the lock screen at the lock deadline.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and shorten idle: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; jq '.idle = {screensaver: 15, lock: 30}' $f > /tmp/s.json && mv /tmp/s.json $f`
  * Press Super+Space, click `Trigger`, click `Toggle`, click `Screensaver` with the mouse. A notification `Screensaver disabled` appears top-right.
  * In the terminal run `omarchy-launch-screensaver; echo "exit=$?"` → `exit=1` and nothing appears on screen.
  * Run `omarchy-launch-screensaver force` → the screensaver appears anyway. Press Space to dismiss it.
  * Stop all input for 35 s, screenshotting every 5 s: no screensaver at ~15 s; the lock screen appears at ~30 s.
  * Move the mouse, type `prime`, press Enter. The desktop returns.
  * Press Super+Space → Trigger → Toggle → `Screensaver` again: notification `Screensaver enabled`. Then restore idle: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen blanks 5 s after the last input; a mouse move wakes it.
  * Screenshots do not count as activity during the 35 s wait; keys and mouse do.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Screensaver disabled` and `Screensaver enabled` notifications
  ** Terminal `exit=1` with nothing on screen, the forced screensaver running, the lock at ~30 s with no screensaver before it, the restored desktop
  * If unsuccessful
  ** Screensaver appearing at 15 s while disabled, or no lock by 45 s
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0`
covers: bin/omarchy-toggle-screensaver, bin/omarchy-toggle, bin/omarchy-toggle-enabled, bin/omarchy-launch-screensaver (screensaver-off guard, force), omarchy-menu.jsonc trigger.toggle.screensaver, shell/plugins/services/idle/Service.qml (screensaverLaunchGraceTimer, lockTimer)

### screensaver-dismiss-cancels-pending-lock   [VM-OK]
description: Dismissing the idle screensaver before the lock deadline counts as activity and cancels the pending lock, so glancing at the machine never locks the user out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and shorten idle: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; jq '.idle = {screensaver: 15, lock: 40}' $f > /tmp/s.json && mv /tmp/s.json $f`
  * Stop all input; screenshot every 5 s. At ~15 s the screensaver appears.
  * At ~20 s press Space. The screensaver closes and the desktop is back.
  * From now until 50 s after the original start, move the mouse a little every 4 s (screenshot each time) so the machine stays active.
  ** The lock screen must NOT appear at ~40 s.
  * Run `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0` (password `prime`).
  ** Must contain `idle-cycle-cancel: screensaver-dismissed` and must NOT contain `lock-system: lock-timeout`.
  * Restore idle: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * After dismissing, the machine is idle again; without the mouse jiggles a fresh cycle would start 15 s later and show the screensaver again — that would be correct behaviour but confusing to judge.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: screensaver at ~15 s, desktop after Space, desktop still present at 40–50 s
  ** Serial log containing `idle-cycle-cancel: screensaver-dismissed` and no `lock-system`
  * If unsuccessful
  ** Lock screen appearing at ~40 s after the screensaver was dismissed, and the idle journal excerpt
covers: shell/plugins/services/idle/Service.qml (handleScreensaverWindowClosed, cancelIdleCycle, handleHyprlandEvent), IdleModel.js screensaverWindowsAfter, manual/13 "If you dismiss the screensaver…"

### background-next-cycles-in-order   [VM-OK]
description: `omarchy-theme-bg-next` steps through the theme's backgrounds in alphabetical order with a wipe transition, reports the current one by name, and wraps around to the first after the last.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `ls ~/.local/state/omarchy/current/theme/backgrounds/; omarchy-theme-bg-current`. Count the files (N) and note the current name.
  * Run `omarchy-theme-bg-next; omarchy-theme-bg-current`. Screenshot at once and again after 1 s.
  ** The wallpaper changes to the next file in the listing (a diagonal wipe if you are quick), and the printed name is that file's humanised name (e.g. `2-swirl-buck.webp` → `Swirl Buck`).
  * Repeat the same command until you have run it N times in total, screenshotting each result.
  ** After N runs the name printed is the one you started with and the wallpaper matches (wrap-around).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal covers part of the wallpaper; compare the strips left and right of it, or close it with Super+W before a screenshot and reopen with Super+Enter.
  * If N is 1, report `N=1` and verify only that one `omarchy-theme-bg-next` keeps the same name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal listing with N files and N+1 name lines that advance one file per call and return to the first
  ** Screenshots with a visibly different wallpaper after each call and the original after N calls
  * If unsuccessful
  ** The name advancing while the wallpaper does not (shell not updating), or the notification `No background was found for theme`
covers: bin/omarchy-theme-bg-next, bin/omarchy-theme-bg-set (ln + `omarchy-shell background set`), bin/omarchy-theme-bg-current, shell/plugins/background/Background.qml (IpcHandler set, transitionBackground, reveal)

### background-user-folder-joins-cycle   [VM-OK]
description: An image the user drops into `~/.config/omarchy/backgrounds/<theme>/` becomes part of the next-cycle and the picker without any restart, and removing it drops it again — the user-wallpaper flow.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run, one per line:
    `theme=$(cat ~/.local/state/omarchy/current/theme.name); echo $theme`
    `mkdir -p ~/.config/omarchy/backgrounds/$theme`
    `src=$(ls $OMARCHY_PATH/themes/gruvbox/backgrounds/* | head -1); echo $src`
    `cp "$src" ~/.config/omarchy/backgrounds/$theme/0-mine.${src##*.}`
  * Run `omarchy-theme-bg-next` repeatedly (screenshot each) until `readlink ~/.local/state/omarchy/current/background` shows `…/.config/omarchy/backgrounds/<theme>/0-mine.…`.
  ** The wallpaper is now the copied gruvbox image (visibly different palette from the theme's own backgrounds).
  * Press Super+Ctrl+Space. The picker grid must include the copied image, highlighted as current. Press Escape.
  * Run `rm ~/.config/omarchy/backgrounds/$theme/0-mine.*` then `omarchy-theme-bg-next`.
  ** The wallpaper moves to the theme's first background (the removed file is no longer in the list) and `readlink` shows a theme path.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the current theme is gruvbox, use `$OMARCHY_PATH/themes/tokyo-night/backgrounds/*` instead so the copy looks different.
  * The user folder sorts before the theme folder, so the copy is reached right after the last theme background.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing the theme name, the copied path, and readlink pointing into `~/.config/omarchy/backgrounds/`
  ** Desktop screenshot with the foreign wallpaper; picker screenshot with it in the grid
  ** After removal: readlink back to a theme path and the wallpaper changed
  * If unsuccessful
  ** The copied file never reached by the cycle, missing from the picker, or the wallpaper not updating
covers: bin/omarchy-theme-bg-next (USER_BACKGROUNDS_PATH), bin/omarchy-theme-bg-switcher, bin/omarchy-menu-images (picker dirs), shell/plugins/background/Background.qml

### background-picker-select-and-cancel   [VM-OK]
description: The wallpaper picker — reached from Style → Background with the mouse or with Super+Ctrl+Space — highlights the current wallpaper, cancels with Escape without change, and applies a chosen tile live.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `orig=$(readlink -f ~/.local/state/omarchy/current/background); omarchy-theme-bg-current`. Note the name.
  * Press Super+Space, click `Style`, click `Background` with the mouse. Do not use the keyboard.
  ** A fullscreen dimmed grid of wallpaper thumbnails appears; one tile (the current wallpaper) has the highlighted border.
  * Press Escape. The grid closes and the wallpaper is unchanged.
  * Press Super+Ctrl+Space. The same grid opens. Press Right (or Down if there is one row) to move the highlight, then Enter.
  ** The grid closes and the desktop wallpaper changes to the chosen image; `omarchy-theme-bg-current` prints its name.
  * Restore: `omarchy-theme-bg-set "$orig"` — the original wallpaper is back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker does not filter on typing; use arrows and Enter, or click a tile with the mouse.
  * Super+Ctrl+Space with send-keys is `<C-M-SPACE>`. Double-check the mouse position before clicking menu rows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Menu screenshot on Style → Background, the picker with a highlighted current tile, the unchanged desktop after Escape
  ** The picker with the moved highlight, the desktop with the new wallpaper and its name in the terminal, then the original restored
  ** The menu path was clicked with the mouse, not typed
  * If unsuccessful
  ** The menu entry or hotkey doing nothing, a picker without thumbnails, Escape applying a change, or Enter not applying one
covers: omarchy-menu.jsonc style.background, default/hypr/bindings/utilities.lua:17, bin/omarchy-menu (toggle background), bin/omarchy-theme-bg-switcher, bin/omarchy-theme-bg-set, shell/plugins/background/Background.qml, test/acceptance.d/shell-surfaces-test.sh (background selector)

### background-set-rejects-bad-path   [VM-OK]
description: `omarchy-theme-bg-set` refuses a missing file or no argument without touching the wallpaper, and a path that exists but is not an image leaves the shown wallpaper intact until the next change — the unhappy paths of setting a background.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `orig=$(readlink -f ~/.local/state/omarchy/current/background); echo $orig`.
  * Run `omarchy-theme-bg-set /tmp/does-not-exist.png; echo "exit=$?"` → `File does not exist: /tmp/does-not-exist.png`, `exit=1`; the wallpaper is unchanged.
  * Run `omarchy-theme-bg-set; echo "exit=$?"` → `Usage: omarchy-theme-bg-set <path-to-media>`, `exit=1`.
  * Run `omarchy-theme-bg-set /etc/hostname; echo "exit=$?"` → `exit=0`. Screenshot.
  ** The visible wallpaper stays as it was (the shell keeps the last good image) even though the link now points at a text file.
  * Run `omarchy-theme-bg-set "$orig"`. The wallpaper is confirmed/redrawn from the original file and `omarchy-theme-bg-current` prints its name.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not restart the shell while the link points at /etc/hostname; that would render a black desktop (recover with the last step and report if it happens).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing both error messages with `exit=1` and `exit=0` for the text file
  ** Screenshots: wallpaper identical after all three commands, and the original name at the end
  * If unsuccessful
  ** A black/blank desktop after the bad file, the bar disappearing (shell crash), or the restore failing
covers: bin/omarchy-theme-bg-set (checks), shell/plugins/background/Background.qml (transitionBackground with an image that never becomes ready), bin/omarchy-theme-bg-current

### background-desktop-double-click-pickers   [VM-OK]
description: Double-clicking the bare desktop opens the background picker (left button) or the theme picker (right button), and Escape leaves both without changes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Make sure no window covers the wallpaper: close any open window with Super+W (or switch to an empty workspace with Super+9).
  * Double-click the left mouse button on the empty wallpaper area.
  ** The fullscreen background picker grid opens (current tile highlighted).
  * Press Escape; the desktop returns unchanged.
  * Double-click the right mouse button on the empty wallpaper area.
  ** The theme picker grid opens (tiles are whole-theme previews with names).
  * Press Escape; the desktop returns unchanged.
  * Open a terminal and run `omarchy-theme-bg-current; cat ~/.local/state/omarchy/current/theme.name` — same values as before the clicks (nothing applied).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse double-click --x 0.5 --y 0.6 --button left|right`. Single clicks do nothing on the wallpaper.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the background picker after the left double-click and of the theme picker after the right double-click, and the untouched desktop after each Escape
  * If unsuccessful
  ** Nothing opening on double-click, the wrong picker, or a theme/background silently applied
covers: shell/plugins/background/Background.qml (MouseArea onDoubleClicked, openSelector/openThemeSwitcher)

### background-video-wallpaper   [VM-PARTIAL]
description: A video file set as background plays on the desktop (software decoded), is listed by the cycle, shows darkened on the lock screen and is paused while locked/blank; no shipped theme has a video so one is generated with ffmpeg. Skipped: audio track and GPU decode.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run, one per line:
    `theme=$(cat ~/.local/state/omarchy/current/theme.name); mkdir -p ~/.config/omarchy/backgrounds/$theme`
    `orig=$(readlink -f ~/.local/state/omarchy/current/background); echo $orig`
    `ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=6:size=1280x720:rate=15 -pix_fmt yuv420p ~/.config/omarchy/backgrounds/$theme/9-test.mp4; echo "exit=$?"`
  ** `exit=0`. If ffmpeg is missing, report VM-PARTIAL and stop here.
  * Run `omarchy-theme-bg-set ~/.config/omarchy/backgrounds/$theme/9-test.mp4`.
  ** The wallpaper becomes the ffmpeg test pattern (colour bars with a moving counter). Take two screenshots 2 s apart: the counter/moving element must differ (it is playing).
  * Press Super+Ctrl+L. Screenshot within 3 s: the lock screen shows the video darkened (not blurred) with the box on top.
  * Wait 7 s: the screen is black. Move the mouse: the lock returns. Type `prime`, Enter.
  * Run `omarchy-theme-bg-current` → `Test`. Run `omarchy-theme-bg-next` twice: the video is part of the cycle (readlink shows `9-test.mp4` at some point).
  * Restore: `omarchy-theme-bg-set "$orig"; rm ~/.config/omarchy/backgrounds/$theme/9-test.mp4`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Playback is CPU decoded on 2 vCPU; a slightly choppy pattern is fine, a frozen pattern for >3 s is not.
  * Skipped here: sound (no audio device), GPU decode, the power-saver pause.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two desktop screenshots with different frames of the test pattern
  ** Lock screenshot with the darkened video behind the box; black after 7 s; desktop after unlock
  ** Terminal showing `Test` and the mp4 in the cycle, then the original restored
  * If unsuccessful
  ** A black/static desktop after setting the mp4, the shell crashing, or the lock showing no background
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep -iE 'ffmpeg|video|qt.multimedia' | sudo tee /dev/ttyS0`
covers: shell/Ui/BackgroundMedia.qml, shell/Ui/BackgroundVideo.qml, shell/plugins/background/Background.qml (video path, playbackEnabled), shell/plugins/lock/LockView.qml (video darken), lock/Service.qml (monitorDpmsTimer), bin/omarchy-theme-bg-next (video extensions), test/shell.d/video-background-test.sh

### restart-shell-keeps-desktop-working   [VM-OK]
description: Restarting the shell from the menu brings back a fully working desktop — the same wallpaper, the bar, notifications, the lock screen and the menu — so a restart is a safe repair step.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `omarchy-theme-bg-next; omarchy-theme-bg-current` so the wallpaper is not the theme default; screenshot the desktop.
  * Press Super+Space, click `Update`, click `Process`, click `Shell` with the mouse.
  ** The bar vanishes for a moment and returns within ~3 s; the wallpaper may flash but must come back identical to the screenshot before.
  * Run `omarchy-notification-send "After restart" "notifications work"` → a toast appears top-right.
  * Press Super+Ctrl+L → the lock screen appears (blurred copy of the same wallpaper); type `prime`, Enter → desktop.
  * Press Super+Space → the menu opens; press Escape.
  * Run `omarchy-shell shell ping` → `ok`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the desktop is black after the restart, wait 3 s and screenshot again before reporting a black background (that is the failure this test guards).
  * Double-check the mouse position before clicking menu rows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: desktop before, bar gone, bar back with the same wallpaper, the toast, the lock and unlock, the open menu
  ** Terminal `ok`
  * If unsuccessful
  ** Bar not returning, a black or different wallpaper, no toast, or the lock hotkey dead after the restart
  ** `journalctl -t omarchy-shell --since -3min --no-pager | tail -60 | sudo tee /dev/ttyS0`
covers: bin/omarchy-restart-shell, bin/omarchy-launch-shell, omarchy-menu.jsonc update.process.shell, shell/shell.qml startup (_syncServices, keepLoaded), shell/plugins/background/Background.qml (Component.onCompleted refreshBackground), test/shell.d/restart-shell-test.sh

### shell-supervisor-relaunches-after-crash   [VM-OK]
description: If the shell process dies, its launcher relaunches it within seconds; after too many deaths in a minute it gives up, and `omarchy-restart-shell` brings the desktop back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `pkill -9 -x quickshell`.
  ** The bar disappears at once and returns within ~3 s (screenshot at 1 s and 4 s).
  * Press Super+Space: the menu opens (the relaunched shell works). Press Escape.
  * Run `for i in 1 2 3 4 5 6; do pkill -9 -x quickshell; sleep 3; done` and screenshot every 5 s until it finishes (~20 s).
  ** After the sixth kill the bar does NOT come back (the launcher gave up).
  * Run `journalctl -t omarchy-shell --since -2min --no-pager | grep -E 'relaunching|Giving up' | sudo tee /dev/ttyS0` (password `prime`) and read the serial log: several `Omarchy shell exited with status 137; relaunching.` lines and one `Giving up on the Omarchy shell after 6 relaunches in under a minute.`
  * Run `omarchy-restart-shell; echo "exit=$?"` → the bar returns and `exit=0`.
  * Press Super+Space → the menu opens; press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal keeps working without the shell; only the bar, background and menu belong to the shell.
  * If the bar does come back after the sixth kill, count the `relaunching` lines and report that instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: bar gone then back after one kill; bar absent after the loop; bar back after omarchy-restart-shell; the menu opening at the end
  ** Serial log with the relaunch lines and the `Giving up` line; terminal `exit=0`
  * If unsuccessful
  ** Bar never returning after one kill, or `Omarchy shell did not become ready after restart.`
covers: bin/omarchy-launch-shell (supervisor loop, attempt budget, logger), bin/omarchy-restart-shell, test/shell.d/launch-shell-test.sh

### shell-json-invalid-falls-back-to-defaults   [VM-OK]
description: A broken or incomplete `~/.config/omarchy/shell.json` never takes the shell down: invalid JSON keeps the defaults with a journal warning, a valid but minimal file swaps in the builtin bar layout (replace-not-merge), and restoring the file restores the bar live.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Run `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; cp $f /tmp/shell.json.bak`. Screenshot the bar (full layout: menu, workspaces | indicators, clock, … | tray … power).
  * Run `echo '{ this is not json' > $f`. Wait 2 s.
  ** The bar is unchanged (defaults are identical to stock); `omarchy-shell shell ping` → `ok`; `omarchy-shell shell listShellConfig | jq .idle` → `{"screensaver":150,"lock":300}`.
  * Run `journalctl -t omarchy-shell --since -1min --no-pager | grep -i 'shell.json'` → a line containing `shell.json parse failed, using defaults`.
  * Run `echo '{"idle":{"screensaver":150,"lock":300}}' > $f`; wait 2 s; the journal (same grep) now also has `shell.json missing version: 1, using defaults`; bar unchanged.
  * Run `echo '{"version":1,"idle":{"screensaver":150,"lock":300}}' > $f`. Wait 2 s and screenshot.
  ** The bar changes to the minimal builtin layout: left `menu` + `workspaces`, centre `clock` only, right `audio` only — the indicators, weather, tray, network, power widgets are gone.
  * Run `cp /tmp/shell.json.bak $f`. Wait 2 s: the full bar layout is back (screenshot).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare bar screenshots side by side; the minimal layout has far fewer icons on the right.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots: full → unchanged after invalid JSON → minimal after the version-only file → full after restore
  ** Terminal: `ok`, the idle JSON, both journal warnings
  * If unsuccessful
  ** The bar disappearing/shell dying on invalid JSON (`omarchy-shell is not running`), or the layout not changing/returning
covers: shell/shell.qml (applyShellConfig, loadDefaults, builtinShellConfig, FileView watchers), config/omarchy/shell.json, docs/omarchy-shell.md shell.json

### shell-ipc-errors-when-shell-down   [VM-OK]
description: The `omarchy-shell` IPC wrapper reports unknown targets/methods and a missing shell with clear messages and exit codes, and `-q` turns those into silent successes for best-effort callers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Run each line and read the output and exit code:
    `omarchy-shell shell ping; echo "exit=$?"` → `ok`, `exit=0`
    `omarchy-shell shell nosuch; echo "exit=$?"` → `Function not found.`, `exit=1`
    `omarchy-shell nosuch ping; echo "exit=$?"` → `Target not found.`, `exit=1`
    `omarchy-shell shell; echo "exit=$?"` → `Usage: omarchy-shell <target> <method> [args...]`, `exit=1`
    `omarchy-shell -q nosuch ping; echo "exit=$?"` → no output, `exit=0`
    `omarchy-shell --help | head -3` → the usage text
  * Run in one line: `pkill -9 -x quickshell; omarchy-shell shell ping; echo "exit=$?"` → `omarchy-shell is not running`, `exit=1`.
  * Wait 4 s; run `omarchy-shell shell ping` → `ok` (the supervisor relaunched the shell) and check the bar is back.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The messages come from the wrapper, not from Quickshell; exact spelling matters.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshot with every command's output and exit code as listed
  * If unsuccessful
  ** A missing/garbled message, a non-zero exit for `-q`, or `ok` printed while the shell was dead
covers: bin/omarchy-shell, bin/omarchy-launch-shell, test/shell.d/restart-shell-test.sh (IPC timeout/starting cases), shell-ipc-display-test.sh

### plugin-add-local-enable-disable-remove   [VM-OK]
description: A third-party bar widget can be added from a git repository, enabled so it appears on the bar, disabled, moved to another section, and removed, with `plugin list` following each step — the third-party plugin lifecycle, with no network needed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and create the plugin repo by typing these lines exactly:
    `mkdir -p /tmp/hello && cd /tmp/hello`
    `printf '%s\n' '{"schemaVersion":1,"id":"prime.hello","name":"Hello","version":"1.0.0","kinds":["bar-widget"],"entryPoints":{"barWidget":"Hello.qml"},"barWidget":{"displayName":"Hello","defaultSection":"right"}}' > manifest.json`
    `printf '%s\n' 'import QtQuick' 'import qs.Ui' 'BarWidget { moduleName: "prime.hello"; implicitWidth: label.implicitWidth + 16; implicitHeight: barSize; Text { id: label; anchors.centerIn: parent; text: "HELLO"; color: "#ff0000"; font.pixelSize: 14 } }' > Hello.qml`
    `git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init && cd ~`
  * Run `omarchy-plugin-add /tmp/hello --enable --yes`.
  ** Prints `Added prime.hello into /home/prime/.config/omarchy/plugins/prime.hello` and `Enabled prime.hello`; within ~2 s a red `HELLO` label appears on the right side of the bar.
  * Run `omarchy-plugin-list` → a row `prime.hello  enabled  third-party  bar-widget  Hello`.
  * Run `omarchy-plugin-disable prime.hello` → `Disabled prime.hello`; `HELLO` disappears from the bar.
  * Run `omarchy-plugin-enable prime.hello left` → `Enabled and moved prime.hello`; `HELLO` now shows on the left side of the bar.
  * Run `omarchy-plugin-remove prime.hello --yes` → `Removed prime.hello.` and `Plugin was enabled and was unloaded from omarchy-shell.`; `HELLO` is gone and `omarchy-plugin-list` no longer lists it.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type each printf line as one line; the quotes matter. `cat manifest.json Hello.qml` lets you check them before committing.
  * The red HELLO is small; zoom into the bar. If it does not show within 5 s, run `journalctl -t omarchy-shell --since -1min --no-pager | grep -i hello | sudo tee /dev/ttyS0` and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: the Added/Enabled lines, the list row, Disabled, Enabled and moved, Removed
  ** Bar screenshots: HELLO on the right, gone, on the left, gone again
  * If unsuccessful
  ** `refusing to add: validation failed` with its reason, `plugin 'prime.hello' is not known`, or a HELLO that never renders
covers: bin/omarchy-plugin-add, -validate, -enable, -disable, -remove, -list, bin/omarchy-git-url-check (bare path), shell/services/PluginRegistry.qml (scan, setEnabled, barTarget), shell/shell.qml (syncPluginWidgets, listPlugins IPC), shell/Ui/BarWidget.qml, manual/32-shell-plugins.md, test/shell.d/plugin-add-test.sh, plugin-enable-test.sh, runtime-smoke-test.sh

### plugin-add-from-git-url   [VM-PARTIAL] [NET]
description: `omarchy plugin add <https-url> --enable` clones a public plugin repository over the network, validates it and enables it, and an unreachable URL fails cleanly; partial because no vetted public Quattro plugin repository existed at review time — the driver must verify the URL first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Run `omarchy-plugin-add https://example.invalid/nope.git --yes; echo "exit=$?"`.
  ** Prints `omarchy-plugin-add: failed to clone https://example.invalid/nope.git` and `exit=1`; `ls -a ~/.config/omarchy/plugins/` shows no `.add.tmp.*` leftovers.
  * Pick a public plugin URL: run `xdg-open https://plugins.omarchy.org` from the terminal to open the directory in the browser and copy any listed plugin's git URL. If the directory lists none, try `https://github.com/basecamp/omarchy-plugin-example.git`; if `git ls-remote` fails for that too, report VM-PARTIAL (no public plugin available) and stop.
  * Verify it is a plugin: `git ls-remote <url> HEAD` succeeds, then `git clone --depth 1 <url> /tmp/p && omarchy-plugin-validate /tmp/p; echo "exit=$?"` → `exit=0`.
  * Run `omarchy-plugin-add <url> --enable --yes` (download size: a few hundred KB).
  ** Prints `Added <id> into …` and `Enabled <id>` (or `Now using <id> as the bar` for a full bar).
  * Run `omarchy-plugin-list | grep -v first-party` → the plugin row is `enabled third-party`. If it is a bar widget, it is visible on the bar (screenshot).
  * Run `omarchy-plugin-remove <id> --yes` → `Removed <id>.`; the widget/bar reverts.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Network is outbound-only NAT; DNS works. `git ls-remote` failing means the URL is wrong, not the feature.
  * Never add a repo you have not validated with `omarchy-plugin-validate` first.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: the clean failure for the invalid host, validate exit 0, Added/Enabled, the list row, `up to date`, Removed
  ** Bar screenshot showing the plugin's widget if it has one
  * If unsuccessful
  ** `refusing to add: validation failed` (then this is a plugin problem, record the reason), or a hang >2 min during clone (report as network)
covers: bin/omarchy-plugin-add (git clone path), bin/omarchy-git-url-check, bin/omarchy-plugin-update, manual/32-shell-plugins.md "Adding a plugin from git"

### plugin-validate-rejects-broken-manifests   [VM-OK]
description: `omarchy plugin validate` refuses every kind of broken plugin with a specific reason — bad JSON, wrong schema type, reserved id, missing entry file, kind without entry point, absolute path, symlink, missing folder — and `plugin add` refuses to install one, leaving nothing behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and build the cases, one line each:
    `mk(){ mkdir -p /tmp/$1; printf '%s\n' "$2" > /tmp/$1/manifest.json; touch /tmp/$1/W.qml; }`
    `mk good '{"schemaVersion":1,"id":"t.good","name":"G","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk badjson '{oops'`
    `mk badschema '{"schemaVersion":"1","id":"t.s","name":"S","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk reserved '{"schemaVersion":1,"id":"omarchy.evil","name":"E","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk nofile '{"schemaVersion":1,"id":"t.n","name":"N","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"Nope.qml"}}'`
    `mk nokind '{"schemaVersion":1,"id":"t.k","name":"K","version":"1","kinds":["bar-widget","panel"],"entryPoints":{"barWidget":"W.qml"}}'`
    `mk abspath '{"schemaVersion":1,"id":"t.a","name":"A","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"/etc/passwd"}}'`
    `mk symlink '{"schemaVersion":1,"id":"t.l","name":"L","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}'; ln -s /etc/passwd /tmp/symlink/link`
  * Run `for d in good badjson badschema reserved nofile nokind abspath symlink missing; do echo "== $d"; omarchy-plugin-validate /tmp/$d; echo "exit=$?"; done 2>&1 | sudo tee /dev/ttyS0` (password `prime`) and read the serial log.
  ** good → exit=0 and no message. Every other case exit=1 with, respectively: `manifest.json is not valid JSON`, `unsupported or missing schemaVersion (expected 1)`, `plugin id 'omarchy.evil' uses the reserved omarchy.* namespace`, `entry point file not found: 'Nope.qml'`, `kind 'panel' requires an 'entryPoints.panel' to load`, `entry point must be a relative path: '/etc/passwd'`, `symlinks are not allowed inside a plugin folder: /tmp/symlink/link`, `plugin folder not found: /tmp/missing`.
  * Run `cd /tmp/nofile && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm x && cd ~ && omarchy-plugin-add /tmp/nofile --yes; echo "exit=$?"`.
  ** Prints the `entry point file not found` line then `omarchy-plugin-add: refusing to add: validation failed`, `exit=1`; `ls -a ~/.config/omarchy/plugins/` has no `t.n` and no `.add.tmp.*`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The serial log is easier to read than nine screenshots; still screenshot the terminal.
  * On an older disk the `kind … requires` message may be absent (HEAD feature); report the actual text.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial log with the nine `== case` blocks, exit codes and the exact messages above
  ** Terminal showing the refused add and the clean plugins directory
  * If unsuccessful
  ** Any broken case exiting 0, `good` exiting 1, or a staged directory left after the refused add
covers: bin/omarchy-plugin-validate, bin/omarchy-plugin-add (validate + stage cleanup), shell/services/PluginRegistry.qml validateManifest (mirrored rules), test/shell.d/plugin-validate-test.sh, plugins-test.sh

### plugin-reserved-id-rejected-by-shell   [VM-OK]
description: A plugin folder that bypasses the CLI and lands directly in `~/.config/omarchy/plugins/` with a reserved `omarchy.*` id or a broken manifest is rejected by the running shell's own validation, hot-reload picks the folder up, and the plugin never appears or loads.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run:
    `d=~/.config/omarchy/plugins/omarchy.evil; mkdir -p $d; printf '%s\n' 'import QtQuick' 'import qs.Ui' 'BarWidget { moduleName: "omarchy.evil"; implicitWidth: 60; implicitHeight: barSize; Text { anchors.centerIn: parent; text: "EVIL"; color: "red" } }' > $d/W.qml`
    `printf '%s\n' '{"schemaVersion":1,"id":"omarchy.evil","name":"Evil","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}' > $d/manifest.json`
  * Wait 3 s (the folder watch reloads plugins). Screenshot the bar: no `EVIL` label. Run `omarchy-plugin-enable omarchy.evil; echo "exit=$?"` → `plugin 'omarchy.evil' is not known; run: omarchy-shell shell rescanPlugins`, `exit=1`.
  * Run `journalctl -t omarchy-shell --since -2min --no-pager | grep -i 'omarchy.evil'` → a line `PluginRegistry: plugin omarchy.evil rejected: id is reserved for first-party Omarchy plugins`.
  * Run `d2=~/.config/omarchy/plugins/t.broken; mkdir -p $d2; printf '%s\n' '{"schemaVersion":1,"id":"t.broken","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}' > $d2/manifest.json` (no `name`). Wait 3 s.
  * Run `omarchy-plugin-list | grep -c broken` → `0`; journal grep for `t.broken` → `missing required field 'name'`.
  * Clean up: `rm -rf ~/.config/omarchy/plugins/omarchy.evil ~/.config/omarchy/plugins/t.broken`; wait 3 s; `omarchy-shell shell ping` → `ok` and the bar is intact.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell reloads plugins on every file save in that folder; the bar may flicker once — that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: empty grep results, the `not known` error, both journal rejection lines, `ok` after cleanup
  ** Bar screenshot without any EVIL label
  * If unsuccessful
  ** `omarchy.evil` listed or `EVIL` rendered, the shell dying during reload, or the built-in widgets disappearing
covers: shell/services/PluginRegistry.qml (parseScanOutput reserved-id rejection, validateManifest, localPluginWatcher), shell/shell.qml reloadPlugins, bin/omarchy-plugin-enable unknown path, test/shell.d/plugin-registry-contract-test.sh, runtime-smoke-test.sh ("installed plugin changes reload without an explicit rescan")

### plugin-clone-builtin-edit-and-remove   [VM-OK]
description: Cloning a built-in widget creates an editable `prime.<name>` copy that replaces the original in place, a saved edit hot-reloads onto the bar, and removing the clone restores the built-in.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Screenshot the bar: the centre clock shows weekday and time (e.g. `Friday 13:10`).
  * Run `omarchy-plugin-clone omarchy.clock`.
  ** Prints `Cloned omarchy.clock to /home/prime/.config/omarchy/plugins/prime.clock and switched to prime.clock`; a notification `Editing Cloned Plugin` appears; the clock is still on the bar.
  * Run `omarchy-plugin-list | grep -i clock` → `prime.clock  enabled  third-party  bar-widget  My Clock` and `omarchy.clock  disabled  first-party …`.
  * Run `sed -i 's/text: root.vertical ? "" : root.displayText/text: root.vertical ? "" : "CLONE " + root.displayText/' ~/.config/omarchy/plugins/prime.clock/BarWidget.qml`. Wait 3 s.
  ** The bar clock now reads `CLONE Friday 13:11` (live time) — the saved file hot-reloaded without a restart.
  * Run `omarchy-plugin-remove prime.clock --yes` → `Removed prime.clock.` and `Restored omarchy.clock.`; within 3 s the clock shows the plain time again.
  * Run `omarchy-plugin-list | grep -i clock` → only `omarchy.clock  enabled  first-party`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu path Setup → Plugins → Clone Plugin does the same but opens `$EDITOR`; the CLI keeps the steps typeable.
  * If `sed` matched nothing (`grep -n displayText ~/.config/omarchy/plugins/prime.clock/BarWidget.qml` shows a different line), edit that line to prefix `"CLONE " +` and report the difference.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: the Cloned line, list rows for both ids, Removed/Restored, the final list row; the notification screenshot
  ** Bar screenshots: normal clock → `CLONE …` clock → normal clock
  * If unsuccessful
  ** Clock disappearing from the bar, `CLONE` not appearing after 10 s, or `omarchy.clock` not restored after removal
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep -iE 'clock|plugin' | sudo tee /dev/ttyS0`
covers: bin/omarchy-plugin-clone, bin/omarchy-plugin-remove (clonedFrom restore), shell/services/PluginRegistry.qml (clonedFrom, resolveEnabledId, restoreCloneSource, localPluginWatcher), shell/plugins/panels/clock/BarWidget.qml:150, manual/32-shell-plugins.md "Cloning a built-in", test/shell.d/plugin-clone-test.sh

### plugin-menu-enable-disable   [VM-OK]
description: The Omarchy Menu's Setup → Plugins → Disable/Enable pickers let a user switch a built-in bar widget off and on with the mouse, and the pickers only offer plugins for which the action makes sense.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar and locate the Weather widget in the centre (a weather glyph + temperature, or a placeholder while offline).
  * Press Super+Space, click `Setup`, click `Plugins`, click `Disable Plugin`.
  ** A picker lists only currently enabled, disable-able plugins (e.g. Weather, Clock, Audio…; no `Bar`).
  * Click `Weather`. The picker closes and the weather widget disappears from the bar.
  * Open a terminal and run `omarchy-plugin-list | grep -i weather` → `disabled`.
  * Press Super+Space → Setup → Plugins → `Enable Plugin`.
  ** The picker lists only disabled plugins; `Weather` is among them.
  * Click `Weather`. The weather widget returns to the bar; `omarchy-plugin-list | grep -i weather` → `enabled`.
  * Press Super+Space → Setup → Plugins and screenshot: `Remove Plugin` must NOT be shown while no third-party plugin is installed. Press Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker rows show the plugin name with its id as subtext; if `Weather` is missing because the widget is not on this disk's bar, pick `Clock` and adjust the expectations.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: Disable picker, bar without weather, Enable picker, bar with weather back, Plugins submenu without Remove
  ** Terminal `disabled` then `enabled`
  * If unsuccessful
  ** Picker offering `Bar` under Disable, the widget not disappearing/returning, or `Remove Plugin` shown with no user plugins
covers: bin/omarchy-menu-plugin, omarchy-menu.jsonc setup.plugin.*, shell/shell.qml listPlugins (canDisable/enabled), PluginRegistry.setEnabled for bar widgets, manual/32-shell-plugins.md "Turning them on and off"

### plugin-third-party-api-boundary   [VM-OK]
description: A third-party service plugin receives only the scoped plugin shell API: it can reach its own service but not the lock or other first-party services, and cannot summon the menu — proven from inside a plugin by what it writes to a file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and create the probe plugin:
    `d=/tmp/probe; mkdir -p $d && cd $d`
    `printf '%s\n' '{"schemaVersion":1,"id":"prime.probe","name":"Probe","version":"1","kinds":["service"],"entryPoints":{"service":"Probe.qml"}}' > manifest.json`
    `printf '%s\n' 'import QtQuick' 'import Quickshell.Io' 'Item { id: root; property var shell: null; Process { id: p } Timer { interval: 2000; running: true; onTriggered: { var s = root.shell; var r = "own=" + (s && s.serviceFor("prime.probe") !== null) + " lock=" + (s && s.serviceFor("omarchy.lock") === null) + " lockfp=" + (s && s.firstPartyServiceFor("omarchy.lock") === null) + " idle=" + (s && s.firstPartyServiceFor("omarchy.idle") === null) + " summon=" + (s && s.summon("omarchy.menu", "{}")) + " hasServices=" + (s && s.services === undefined); p.command = ["bash", "-c", "echo " + r + " > /tmp/probe.txt"]; p.running = true } } }' > Probe.qml`
    `git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init && cd ~`
  * Run `omarchy-plugin-add /tmp/probe --enable --yes` → `Added prime.probe …` and `Enabled prime.probe`.
  * Wait 5 s. Run `cat /tmp/probe.txt`.
  ** Must read exactly: `own=true lock=true lockfp=true idle=true summon=false hasServices=true`
  ** Meaning: the plugin sees its own service, gets `null` for the lock (both lookups) and for idle, its summon of the menu is refused, and there is no `services` map on the object it was given. No menu must have opened on screen.
  * Run `omarchy-plugin-remove prime.probe --yes; rm -f /tmp/probe.txt` → `Removed prime.probe.`; `omarchy-plugin-list | grep -c probe` → `0`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `/tmp/probe.txt` does not exist after 10 s the service failed to load: `journalctl -t omarchy-shell --since -2min --no-pager | grep -i probe | sudo tee /dev/ttyS0` and report.
  * Any `false` where `true` is expected (or `summon=true` / the menu popping up) is a security boundary failure — report loudly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing the exact probe line and the plugin gone from the list afterwards
  ** A screenshot proving no menu opened during the 5 s wait
  * If unsuccessful
  ** The probe line with any unexpected value, a menu opened by the plugin, or a missing probe file with the journal excerpt
covers: shell/services/PluginShellApi.qml, shell/shell.qml (createScopedPluginShell, pluginOwnsTarget, pluginServiceFor, ensureService third-party parenting), shell/services/AuthServiceStore.js, manual/32-shell-plugins.md (trust paragraph), test/shell.d/plugin-auth-boundary-test.sh

### plugin-cli-negative-paths   [VM-OK]
description: The plugin CLI rejects bad input with clear messages and leaves the bar untouched: unknown ids, placement on a full bar, a bad section, an unsafe id, and unsafe git URLs refused before any clone; it also records the disable-unknown-id quirk.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and screenshot the bar as a reference.
  * Run each line and read output and exit code:
    `omarchy-plugin-enable nope.plugin; echo "exit=$?"` → `plugin 'nope.plugin' is not known; run: omarchy-shell shell rescanPlugins`, `exit=1`
    `omarchy-plugin-enable omarchy.bar --section left; echo "exit=$?"` → `'omarchy.bar' is a bar; it replaces the bar in use rather than taking a place in one`, `exit=1`
    `omarchy-plugin-enable omarchy.clock middle; echo "exit=$?"` → `section must be left, center, or right`, `exit=1`
    `omarchy-plugin-disable nope.plugin; echo "exit=$?"` → record the exact output (expected quirk: `Disabled nope.plugin`, `exit=0`)
    `omarchy-plugin-remove '../etc' --yes; echo "exit=$?"` → `invalid plugin id '../etc'`, `exit=1`
  * Run the URL guards:
    `omarchy-plugin-add 'ext::sh -c id' --yes; echo "exit=$?"` → `omarchy-git-url-check: 'ext::sh -c id' names a git option or transport helper, not a repository.`, `exit=1`
    `omarchy-plugin-add 'gopher://x/y.git' --yes; echo "exit=$?"` → `… names the 'gopher' transport, which Omarchy does not clone from.`, `exit=1`
  * Screenshot the bar again: identical to the reference. Run `ls -a ~/.config/omarchy/plugins/` → no `.add.tmp.*` entries.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the terminal scrolls, wrap the commands in `{ …; } 2>&1 | sudo tee /dev/ttyS0` and read the serial log.
  * A `Cloning into` line after either URL means the guard failed — report loudly.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal/serial output with every message and exit code as listed (and the recorded disable-unknown quirk)
  ** Bar screenshots identical before and after; plugins directory without staging leftovers
  * If unsuccessful
  ** A guard letting a bad URL reach `git clone`, a wrong exit code, or a changed bar
covers: bin/omarchy-plugin-enable, -disable, -remove, -add, bin/omarchy-git-url-check, shell/shell.qml setPluginEnabled/enablePlugin, test/shell.d/plugin-add-test.sh (URL guards), plugin-enable-test.sh

### plugin-update-local-origin-and-rollback   [VM-OK]
description: `omarchy plugin update` fast-forwards an installed plugin from its origin and reloads it live, reports up-to-date when nothing changed, and rolls back a revision that fails validation — using a local repository as origin so no network is needed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and create and install the `/tmp/hello` plugin exactly as in `plugin-add-local-enable-disable-remove`, ending with `omarchy-plugin-add /tmp/hello --enable --yes`. A red `HELLO` is on the bar.
  * Run `omarchy-plugin-update prime.hello --yes` → `prime.hello is up to date.`
  * Publish a change: `cd /tmp/hello && sed -i 's/HELLO/HELLO2/' Hello.qml && git -c user.name=t -c user.email=t@t commit -qam v2 && cd ~`
  * Run `omarchy-plugin-update prime.hello --yes` → `Updated prime.hello.`; within 3 s the bar label reads `HELLO2`.
  * Publish a broken revision: `cd /tmp/hello && git mv Hello.qml Gone.qml && git -c user.name=t -c user.email=t@t commit -qm broken && cd ~`
  * Run `omarchy-plugin-update prime.hello --yes; echo "exit=$?"` → `entry point file not found: 'Hello.qml'`, `update of 'prime.hello' failed validation; rolled back`, `exit=1`; the bar still shows `HELLO2`.
  * Run `ls ~/.config/omarchy/plugins/prime.hello/` → `Hello.qml` is still there (no `Gone.qml`). Then clean up: `omarchy-plugin-remove prime.hello --yes` → `HELLO2` leaves the bar.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The installed copy's origin is `/tmp/hello`, so committing there is "publishing a new version".
  * Without `--yes` the command shows a diff and asks with gum; `--yes` keeps it unattended.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: `up to date`, `Updated`, the validation failure with `rolled back` and `exit=1`, the listing with `Hello.qml`
  ** Bar screenshots: `HELLO` → `HELLO2` → still `HELLO2` after the failed update → gone after removal
  * If unsuccessful
  ** `Gone.qml` present (broken revision kept), the widget vanishing, or `Updated` printed for the broken revision
covers: bin/omarchy-plugin-update (fetch/ff/validate/reset ORIG_HEAD), bin/omarchy-plugin-validate, shell/services/PluginRegistry.qml localPluginWatcher hot reload, manual/32-shell-plugins.md "Updating is a fast-forward pull"

### nightlight-toggle-service   [VM-PARTIAL]
description: Super+Ctrl+N toggles the night light through the shell's nightlight service: the status IPC and bar indicator flip and the screen tint warms; partial because virtio-vga may not honour gamma changes, so the tint itself is best-effort.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `omarchy-shell nightlight status` → `{"enabled":false,"temperature":6500}` (or `null` temperature if hyprsunset is not running yet).
  * Screenshot the desktop as a colour reference.
  * Press Super+Ctrl+N. Wait 2 s and screenshot.
  ** Expected: a visibly warmer/yellower screen and a night-light glyph in the bar's centre indicator area. If the colours do not change but the indicator and status do, record "tint not applied in VM".
  * Run `omarchy-shell nightlight status` → `{"enabled":true,"temperature":4000}`; `pgrep -x hyprsunset` → a PID.
  * Run `omarchy-shell nightlight toggle` → `disabled`; the indicator disappears; status → `enabled:false`, `temperature:6500`.
  * Run `omarchy-shell nightlight enable` → `enabled`; then press Super+Ctrl+N → back to disabled (hotkey and IPC share one state).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+N with send-keys is `<C-M-n>`.
  * Skipped in this VM if the compositor cannot set gamma: only the state, indicator and IPC are verified.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Status JSON before/after each toggle, indicator screenshots, and (if applied) the warmer screenshot
  * If unsuccessful
  ** Status not changing, hyprsunset not started, hotkey and IPC disagreeing
covers: shell/plugins/services/nightlight/Service.qml, NightlightModel.js, default/hypr/bindings/utilities.lua:32, manual/13 "Night light"

### media-service-absent-player   [VM-PARTIAL]
description: Without any media player the media service reports no player, hides its bar widget, and answers `unhandled` to control verbs — the graceful absence path (playback control itself needs an MPRIS player and audio the VM lacks).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and run `omarchy-shell media ping` → `ok`.
  * Run `omarchy-shell media status | jq '{hasPlayer, hasMedia, playing}'` → all `false`.
  * Run `omarchy-shell media playPause; omarchy-shell media next; omarchy-shell media sourceNext` → three lines `unhandled`.
  * Screenshot the bar: there is no now-playing label/glyph anywhere (the media widget is hidden without media).
  * Run `omarchy-shell shell ping` → `ok` (the unhandled verbs did not disturb the shell).
  * Report VM-PARTIAL for the rest: play/pause/next, the popup card and source cycling need an MPRIS player and an audio device.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: control of a real player, the popup card, source cycling with two players.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: `ok`, the all-false status, three `unhandled` lines; bar screenshot without a media widget
  * If unsuccessful
  ** `Target not found.` (service not loaded), a status claiming a player, or a media widget rendered with nothing playing
covers: shell/plugins/services/media/Service.qml (IpcHandler, selectActivePlayer), MediaModel.js, media/BarWidget.qml visible: hasMedia, default/hypr/bindings/media.lua

## Gaps

- **Fingerprint unlock** (touch to unlock, `omarchy-lock-fingerprint` PAM, 250 ms retry, icon inside the field): no reader in the guest; only the absence path is testable (`lock-fingerprint-indicator-absent`).
- **Power-saver pause of video wallpapers** (`powerSaverOnBattery` in lock and background) and the whole **battery service** (low-battery warning at 10 %, `omarchy-powerprofiles-set battery|ac`): no UPower battery device in the guest; nothing observable.
- **Suspend/resume interaction with the blank timer** (the wall-clock guard that re-arms instead of blanking a freshly woken lock) and `omarchy-system-sleep-lock`: needs a real suspend cycle; the QEMU guest has no power management to drive from inside, and sleep is another reviewer's area.
- **Multi-monitor paths**: `ScreenMoveRemap` remap pulses, per-monitor screensaver windows, `monitorDpms` per-output reconciliation, `realScreens > 1`, `lock-pending: no-real-screen` (needs an output to disappear). Single virtio-vga output only.
- **Real DPMS state of the panel** while a video lock wallpaper is blank (`monitorDpmsTimer` reconciliation): the screenshot is black either way; only `hyprctl monitors -j | jq '.[].dpmsStatus'` from a TTY could confirm, which the driver cannot reach while locked.
- **`No background was found for theme` notification**: requires a theme with an empty backgrounds folder; theme folders are root-owned under `/usr/share/omarchy`, and hiding them needs sudo edits to package files — left out.
- **Video with a sound track** (audio only on the first screen, `AudioOutput` created lazily): no audio device.
- **1Password lock on `omarchy-system-lock`**: 1Password is not installed on the minted disk.
- **Keyboard-layout reset on lock** (`hyprctl switchxkblayout all 0`): only one layout is configured; the keyboard-layout reviewer could add a second layout and lock.
- **Replacement full bar** (`kind: "bar"`) and its narrow `PluginFirstPartyServiceApi` proxies, `mutateShellConfig`, `pluginShellForBarEntry`: needs a working third-party bar plugin (hundreds of lines of QML); covered at unit level by `plugin-auth-boundary-test.sh` and `runtime-smoke-test.sh`. A minimal-bar plugin fixture could be added later as a NET test once a public one exists.
- **Plugin menus with `appLibrary`**, clone allow-list summons (`omarchy.audio → omarchy.osd`): need cloning audio/network widgets and driving their panels; belongs with the bar/panels reviewer.
- **`omarchy-plugin-add` interactive prompts** (gum URL prompt, `Clone and add this plugin?`, section chooser): the driver can type into gum, but the `--yes` paths already exercise the logic; the interactive variant is left as a manual check.
- **First-run provisioning** (`omarchy-provision-first-run`) and `omarchy-hook post-boot`: covered by the first-run reviewer; only their presence in `autostart.lua` is inventoried here.
- **uwsm session start / SDDM login path** (`omarchy.desktop`, `env.d/10-omarchy`): exercised implicitly by every `--resume`; a dedicated test belongs to the boot/login reviewer.
- **Journal readability**: `journalctl -t omarchy-shell` may require `sudo` if the user is not in `systemd-journal`/`adm`; every instruction above pipes through `sudo tee` anyway, but if the plain call prints `No journal files were found`, prefix it with `sudo`.
