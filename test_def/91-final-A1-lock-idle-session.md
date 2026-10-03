# Lock, idle and session — final tests

This domain covers the session lock (hotkey lock, wrong/empty/long passwords, the five-second DPMS
blank and wake, the faillock lockout, stranded-lock recovery, the restart-shell guard, the PAM wiring
and fingerprint absence), the idle cycle and screensaver (timings read live from `shell.json`,
Stay Awake, the screensaver toggle, on-demand launch, branding text/image/ASCII), the SDDM greeter
reached through Logout, console login, and the suspend / hibernate / sleep-lock / lid absence paths.
128 source blocks → 31 tests + 1 not runnable; 47 blocks are moved (the slice heuristic matched
`lock` inside `clock`/`block`, and `login` inside tailscale, sshd, migrations and Plymouth "unlock"),
none dropped. Notable merges: five reviewers' hotkey-lock stories became
`lock-hotkey-wrong-then-right-password`; four faillock stories (lock screen, sudo, root-console
reset, ten-try config) became `lock-faillock-lockout-after-ten-failures`; five screensaver-toggle
stories plus the "idle skips straight to lock" case became one test; four idle-chain stories became
`idle-chain-screensaver-lock-and-dismiss-cancels`; four SDDM stories became one Logout → greeter
test; five suspend-toggle stories became one. The existing `lock-screen` definition (menu → Lock →
unlock) is re-versioned as the first block below (same story, wording corrected per
`03-INTENDED-BEHAVIOUR.md` (a) and (b): `Super+Escape` is the System submenu and the lock screen has
never had a clock in any 4.x build); every other lock test starts from the hotkey or a command. Where
the manual and a reviewer disagree (does mouse movement end the screensaver?) the test records what is
seen. Routing pass: 2 incoming blocks — `50:session-desktop-health` became the new
`session-desktop-health-after-boot`; `12:autostart-lua-launch-on-start` is rerouted to C, where its
sibling `40:hypr-autostart-user-entry-runs-on-login` already went from this file. Final accounting:
81 blocks in 33 tests + 1 not runnable + 47 moved + 0 dropped + 1 rerouted = 130 = 128 + 2.

## Tests

### lock-screen   [VM-OK]
description: The lock screen protects and releases a session: lock from the desktop, unlock with the account password.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the System menu with Super+Escape (the System menu: Screensaver, Lock, Suspend, Logout, Reboot, Shutdown).
  * Select the Lock option using the mouse.  Do not use keyboard.
  * On the lock screen unlock it with a password.
  ** The lock screen shows only the password field (`Enter Password`) over the blurred wallpaper — no clock, no user name. That is how it is built; do not report the missing clock.
  ** The password screen, if not interacted with within a few seconds, it will turn black.  You can still type and keys will be inputted into the password text box
  * the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the engaged lock screen showing only the password field — no clock — and the restored desktop
  ** The mouse button was used to click the Lock option and not the keyboard
  * If unsuccessful
  ** the crash dialog on failure.
covers: existing `lock-screen` definition (ctrl.md:89-90); default/hypr/bindings/utilities.lua:8 (SUPER+ESCAPE → omarchy-menu toggle system); default/omarchy/omarchy-menu.jsonc system.lock; bin/omarchy-system-lock; shell/plugins/lock/LockView.qml:25,191; 03-INTENDED-BEHAVIOUR (a), (b)
merged-from:
reversions: lock-screen v1

### lock-hotkey-wrong-then-right-password   [VM-OK]
description: Super+Ctrl+L locks the session from the keyboard; a wrong password is rejected with a numbered failure message and an error-coloured border, the counter grows on repeat and survives a blank/wake cycle, and the right password restores the desktop exactly as left — the hotkey twin of the menu-driven `lock-screen` test.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo LOCK-HOTKEY-MARKER` then Enter so the window has recognisable content.
  * Press Super+Ctrl+L. Within two seconds the screen changes to the lock screen: a blurred, slightly darkened copy of the wallpaper with one centred rounded box reading `Enter Password`. No clock, no user name. Screenshot at once.
  ** The field-only design is intended (no 4.x build ever showed a clock on the lock screen) — do not report the absence.
  ** After 5 seconds without input the lock screen turns black; a mouse move brings it back and typing still reaches the field.
  * Type `wrongpass` and press Enter. The box empties and shows italic `Authentication failed (1)`; the box border turns to the theme's error colour (reddish). Screenshot right after Enter.
  * Type `wrongagain` and press Enter. The message now reads `Authentication failed (2)`.
  * Do nothing for 7 seconds (screenshots at ~3 s and ~7 s): the screen is black by the second one. Move the mouse a little: the lock screen returns and still reads `Authentication failed (2)`.
  * Type `prime` and press Enter. The failure text disappears with the first character; the box briefly reads `Checking…`; the desktop returns with the terminal still showing `LOCK-HOTKEY-MARKER` and the bar at the top.
  * In the terminal run `omarchy-shell lock isLocked` — it prints `false`.
  * Unhappy path: press Super+Ctrl+L twice quickly. Exactly one lock screen appears; unlock with `prime` and Enter. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The hotkey is Ctrl+Super+L; with send-keys that is `<C-M-l>`. The keyboard, not the menu, must be used to lock here — the menu/mouse route is the existing `lock-screen` test.
  * Each PAM check takes 1–3 seconds; wait for the message before typing the next attempt. The counter is per lock session and resets to 0 the next time you lock.
  * These two failures count toward the ten-failure lockout if another wrong-password test runs on the same disk within 15 minutes.
  * If the screenshot after locking is black, move the mouse and screenshot again ~1 s later (virtio modeset).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the lock screen showing the `Enter Password` box over the blurred wallpaper, with no clock or user name
  ** Screenshots of `Authentication failed (1)` and `Authentication failed (2)` with the error-coloured border; a black shot; the box back with `(2)` after the mouse move
  ** Screenshot of the restored desktop with `LOCK-HOTKEY-MARKER` visible; terminal shows `false`; a single lock screen after the double press
  * If unsuccessful
  ** A desktop that unlocked on a wrong password (security failure — report loudly), a box with no message or the wrong count, the lock never engaging, or the crash dialog
  ** `omarchy-shell lock status` and `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy lock' | sudo tee /dev/ttyS0`
covers: shell/plugins/lock/Service.qml (beginLock/finishUnlock, handlePasswordFailure, runWake); shell/plugins/lock/LockView.qml (failureMessage, clearFailureRequested); bin/omarchy-system-lock; default/hypr/bindings/utilities.lua:127; default/hypr/looknfeel.lua:112-114; install/config/lockscreen-pam.sh; bin/omarchy-apply-lock PAM stanza; test/shell.d/system-lock-test.sh; manual/07:12; manual/13:99-101
merged-from: 32:lock-wrong-then-right-password; 32:lock-hotkey-unlock; 10:lock-hotkey-rejects-wrong-password; 24:lock-hotkey-and-wrong-password; 40:hypr-lock-super-ctrl-l

### lock-blanks-after-five-seconds-and-wakes   [VM-OK]
description: The locked display goes dark five seconds after the last input (even with a partial password typed), wakes on mouse movement, re-blanks five seconds later, is held lit only while a password is being checked, and a password typed into the dark screen both wakes it and unlocks — the idle/blank contract of the lock.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L. Screenshot at once: the `Enter Password` box is visible.
  * Without any input take screenshots at roughly 2 s, 4 s and 7 s after locking: the 2 s and 4 s shots still show the box; the 7 s shot is completely black.
  * Move the mouse a little. Screenshot within 1–2 s: the lock screen with the box is back.
  * Type `prim` (no Enter): four dots show in the box. Wait 5 s and screenshot: black again despite the partial password.
  * Tap Shift (the box returns with the four dots still there), type `wrongpass` and press Enter; screenshot within a second: the box reads `Checking…` and the screen is not black during the check; the attempt is then rejected with `Authentication failed (1)`.
  ** If characters were swallowed while blank, press Backspace ten times before typing.
  * Wait 7 seconds again with no input and screenshot: black again (the timer re-armed). With the screen black, type `prime` and press Enter without moving the mouse first: the screen wakes and the desktop appears.
  * Open a terminal with Super+Enter and run `omarchy-shell lock isLocked` — `false`. Close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Black" means the whole screenshot is black; a dark blurred wallpaper with the box is not black.
  * After waking, the virtual display needs a moment to turn back on; if the first screenshot is still black, take another one a second later before deciding.
  * You may only pause up to 5 s between actions; make each wait a single ≤5 s pause followed by one screenshot, not repeated polling that would keep the screen awake.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: box visible at 2 s and 4 s, fully black at ~7 s, box back after the mouse move, black again with four dots pending, `Checking…` lit during the check, black once more, desktop after typing into the dark screen
  ** Terminal shows `false`
  * If unsuccessful
  ** Screenshot showing the box still lit at 10 s, a screen that stays black after mouse movement and typing, or a blank during the check
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep -E 'omarchy lock|dpms' | sudo tee /dev/ttyS0`
covers: shell/plugins/lock/Service.qml (idleBlankTimer, runBlank, runWake); bin/omarchy-brightness-display off/on; bin/omarchy-system-wake; test/shell.d/lock-blank-fingerprint-test.sh; manual/13-toggles-idle-screensaver.md
merged-from: 32:lock-blanks-after-five-seconds-and-wakes; 51:lock-screen-blanks-when-idle

### lock-empty-submit-and-escape-clear   [VM-OK]
description: Pressing Enter on an empty password field does nothing (no check, no failure count), while Escape and Ctrl+U clear typed text — the unhappy input paths of the lock field.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and wait for the `Enter Password` box.
  * Press Enter three times, about one second apart. Nothing changes: the placeholder stays `Enter Password`, no `Checking…`, no `Authentication failed` text, and the session stays locked.
  * Type `abc`. Three dots `●●●` appear in the box.
  * Press Escape. The dots vanish and `Enter Password` returns.
  * Type `abc` again, then press Ctrl+U. The dots vanish again.
  * Type `abc` then press Enter. `Authentication failed (1)` appears — proving the empty Enters earlier were not counted.
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
covers: shell/plugins/lock/LockView.qml (onAccepted, Keys.onPressed Escape/Ctrl+U); shell/plugins/lock/Service.qml submitPassword length guard
merged-from: 32:lock-empty-submit-and-escape-clear

### lock-long-password-dots-fit   [VM-OK]
description: A very long password never clips or overflows the field — the masking dots shrink to stay inside the box and re-space as characters are deleted — and is still rejected cleanly, so every keystroke remains visible to the user.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and wait for the `Enter Password` box.
  * Type 40 letters `a` in one go. Dots fill the middle of the box at normal size. Screenshot.
  * Type another 120 letters `a` in three chunks of 40 back to back (total 160). Screenshot.
  ** The dots are now visibly smaller and tightly packed, all still inside the rounded box; nothing spills past the box border or is cut off on either side.
  * Press Backspace 20 times. The dot count drops and the dots re-space themselves, still inside the field. Screenshot.
  * Press Enter. The box clears and shows `Authentication failed (1)`; the screen stays locked.
  * Type `prime` and press Enter. The desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send each 40-letter chunk as one literal string in a single send-keys call and screenshot at once; a pause longer than 5 s blanks the screen (the keys still land — tap Shift first if it is black).
  * Compare the dot size between the 40-letter and 160-letter screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot at 40 dots (normal size), at 160 dots (shrunk, still inside the box) and after 20 Backspaces (re-spaced)
  ** `Authentication failed (1)` after Enter, then the restored desktop
  * If unsuccessful
  ** Screenshot showing dots clipped at the box edge, dots drawn outside the box, a frozen field, or the desktop unlocking on the wrong password
covers: shell/plugins/lock/LockView.qml (passwordDotScale, dotMetrics); shell/plugins/lock; test/shell.d/lock-password-overflow-test.sh; existing `lock-screen` definition (negative path)
merged-from: 32:lock-long-password-overflow; 51:lock-screen-long-password-dots-fit

### lock-faillock-lockout-after-ten-failures   [VM-OK]
description: Ten wrong lock-screen passwords lock the account for two minutes (pam_faillock deny=10 unlock_time=120, shared with sudo and SDDM) so the correct password is refused inside the window, fewer failures never lock, and the manual's recovery — a root console login and `faillock --reset` — clears it at once; the manual states neither limit.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `grep faillock /etc/pam.d/system-auth; grep -E '^deny' /etc/security/faillock.conf; grep authsucc /etc/pam.d/sddm-autologin; grep passwd_tries /etc/sudoers.d/omarchy-passwd-tries; faillock --user prime`.
  ** Expect `preauth silent deny=10 unlock_time=120` and `authfail deny=10 unlock_time=120`, `deny = 10`, one `pam_faillock.so authsucc` line, `Defaults passwd_tries=10`, and an empty tally.
  * Press Super+Ctrl+L and wait for the `Enter Password` box. Type `x`, press Enter, wait for `Authentication failed (N)`, screenshot; repeat until the message reads `Authentication failed (10)`. Note the wall-clock time of the tenth failure.
  ** Failures 1–4 alone lock nothing (Omarchy raises the limit from the Arch default of three to ten); each PAM check takes 1–3 s.
  * Type the correct password `prime` and press Enter: it must be REFUSED — `Authentication failed (11)` appears near-instantly and the session stays locked.
  * Recover as the manual says: press Ctrl+Alt+F3; at `login:` type `root` Enter, then `prime` Enter (root shares the user's password on ISO installs). Run `faillock --user prime` (a table of ≥10 failures), then `faillock --reset --user prime`, then `faillock --user prime` again (empty). Type `exit` and press Ctrl+Alt+F1 to return to the lock screen.
  ** If F1 shows a text console, try Ctrl+Alt+F2 through F7 until the lock screen is visible. Tap Shift to wake it if black.
  ** Without the reset the tally clears itself 120 s after the tenth failure: if the console login is unavailable, wait 125 s moving the mouse every 4–5 s (screenshot each) and `prime` must then unlock. Do not try `sudo` during the window — the same tally blocks it for the same 120 s.
  * Type `prime` and press Enter. The desktop returns exactly as left.
  * In the terminal run `sudo faillock --user prime` (password `prime`) — the tally is empty (a successful unlock resets it). Then run `sudo -k; sudo true`, typing `nope` at the first four `[sudo] password for prime:` prompts and `prime` at the fifth — the command succeeds (sudo allows up to ten tries in one invocation) and `faillock --user prime` is empty again.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock screen blanks 5 s after the last input; keys still reach the field and a mouse move wakes it.
  * Work fast between the tenth failure and the `prime` attempt — that window is the whole test. Once locked out, failure 11 is near-instant.
  * Wrong-password tests on the same disk within 15 minutes accumulate in the same tally; do not lock the screen while locked out.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing `deny=10 unlock_time=120`, `deny = 10`, `passwd_tries=10`, the `authsucc` line and the empty tally
  ** Screenshots of `Authentication failed (10)` and of `Authentication failed (11)` after typing the correct password
  ** Console screenshots of `faillock --user prime` listing the failures and empty after `--reset`; the desktop restored on the next `prime`
  ** `sudo true` succeeding on the fifth try with the tally empty afterwards
  * If unsuccessful
  ** `prime` unlocking immediately after ten failures (lockout not enforced — report loudly), root login refused on the console, no way back to the graphical VT (list the keys tried), sudo giving up before ten tries, or `prime` still refused well after 3 minutes
  ** `sudo faillock --user prime` output and `sudo cat /etc/pam.d/omarchy-lock-password | sudo tee /dev/ttyS0`
covers: bin/omarchy-apply-lock (PAM stanza deny=10 unlock_time=120); install/config/increase-lockout-limit.sh; etc/security/faillock.conf; etc/sudoers.d/omarchy-passwd-tries; install/login/sddm.sh; shell/plugins/lock/Service.qml handlePasswordFailure; test/shell.d/apply-lock-test.sh; manual/45:39
merged-from: 32:lock-lockout-after-ten-failures; 13:login-lockout-after-ten-failures-and-faillock-reset; 41:faillock-allows-ten-attempts; 42:pam-lockout-limit-ten-tries

### lock-shows-current-wallpaper-blurred   [VM-OK]
description: The lock screen background is always a blurred copy of the wallpaper in use at lock time, so a wallpaper changed right before locking is what the lock screen shows.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `orig=$(readlink -f ~/.local/state/omarchy/current/background); omarchy-theme-bg-current`. Note the name printed.
  * Run `omarchy-theme-bg-next`. The desktop wallpaper changes (quick diagonal wipe); `omarchy-theme-bg-current` now prints a different name.
  ** If the theme has a single background the name will not change; report that and continue.
  * Press Super+Ctrl+L and screenshot at once.
  ** The lock background is a blurred, darker version of the wallpaper you just saw on the desktop — same colours and rough composition — not the previous one.
  ** Take the screenshot within 5 s of locking; after that the screen goes black (move the mouse to bring it back).
  * Type `prime` and press Enter. The desktop returns.
  * Restore the original wallpaper: `omarchy-theme-bg-set "$orig"` — the desktop shows the first wallpaper again. Close the terminal with Super+W.
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
covers: shell/plugins/lock/Service.qml (refreshBackground/readlinkProc); shell/plugins/lock/LockView.qml (BackgroundMedia + MultiEffect blur); bin/omarchy-theme-bg-next; bin/omarchy-theme-bg-set; bin/omarchy-theme-bg-current
merged-from: 32:lock-shows-current-wallpaper-blurred

### lock-closes-running-screensaver   [VM-OK]
description: Locking while the screensaver is running kills the screensaver first so the lock screen is what the user sees, and no screensaver or ttfx processes are left behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, run `sudo -v` (password `prime`) so sudo is cached, then run exactly: `(sleep 12; pgrep -x ttfx | sudo -n tee /dev/ttyS0; sleep 3; omarchy-system-lock) &`
  * Press Super+Escape to open the System menu and click `Screensaver` with the mouse. A fullscreen black window with animated ASCII art appears within ~2 s.
  * Do not press any key or move the mouse; take screenshots every 4 s.
  * At about 15 s the screensaver is replaced by the lock screen (`Enter Password` box over the blurred wallpaper) with no screensaver text visible.
  * Type `prime`, Enter. The desktop returns.
  * Read `./client get-serial`: a ttfx PID was printed at 12 s (the screensaver was running when the lock fired). In the terminal run `pgrep -fa org.omarchy.screensaver; pgrep -x ttfx; echo "done"` → only `done` (no processes).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Any key or mouse click while the screensaver runs would end it early; screenshots are fine.
  * If the screensaver does not start, run `omarchy-launch-screensaver force; echo $?` and report its message (it needs foot/alacritty/ghostty/kitty as default terminal). The screensaver is a terminal window with class `org.omarchy.screensaver` running `ttfx`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the running ASCII screensaver, then the clean lock screen replacing it, then the desktop
  ** Serial shows a ttfx PID at 12 s; terminal shows no screensaver/ttfx processes after unlock
  * If unsuccessful
  ** Screenshot of screensaver text visible on or after the lock screen, or leftover `org.omarchy.screensaver`/`ttfx` processes
covers: bin/omarchy-system-lock (pkill ttfx/pidwait/pkill screensaver); bin/omarchy-launch-screensaver; bin/omarchy-screensaver; test/shell.d/system-lock-test.sh; manual/13-toggles-idle-screensaver.md
merged-from: 32:lock-closes-running-screensaver; 52:system-lock-closes-screensaver-first

### restart-shell-refuses-while-locked   [VM-OK]
description: `omarchy-restart-shell` must never tear down a live lock screen: while the session is locked it refuses with a clear message and exits non-zero, `omarchy-hyprland-session-locked` (the guard it relies on) reports locked/unlocked correctly, and on an unlocked desktop the restart runs with exactly one fresh shell instance.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-hyprland-session-locked; echo "unlocked-probe=$?"` → `1`. Then `omarchy-restart-shell; echo "exit=$?"`: the bar disappears briefly and returns, `exit=0`; `pgrep -c -x quickshell` → `1` (try `qs` if that prints 0); `omarchy-shell shell ping` → `ok`.
  * Run `sudo -v` (password `prime`), then exactly: `(sleep 12; omarchy-hyprland-session-locked; echo "locked-probe=$?" | sudo -n tee /dev/ttyS0; omarchy-restart-shell >/tmp/restart.log 2>&1; echo "exit=$?" >>/tmp/restart.log) &`
  * Immediately press Super+Ctrl+L to lock. Stay locked for at least 25 seconds, moving the mouse every 4 seconds so the screen stays visible (screenshot each time).
  ** The lock screen must remain; the bar must not flash back; nothing else appears.
  * Read `./client get-serial` → `locked-probe=0`.
  * Type `prime` and Enter to unlock.
  * In the terminal run `cat /tmp/restart.log` → `Refusing to restart Omarchy shell while the session is locked.` and `exit=1`. Then `pgrep -c -x quickshell` → still `1` (same instance, no restart happened), `omarchy-shell shell ping` → `ok`, `omarchy-hyprland-session-locked; echo $?` → `1`, and the bar is still at the top.
  ** The same refusal is reachable from a text console: Ctrl+Alt+F3, log in `prime`/`prime`, `export HYPRLAND_INSTANCE_SIGNATURE=$(ls /run/user/1000/hypr | tail -1); omarchy restart shell; echo status=$?` → the refusal line and `status=1` while locked.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not unlock before the 12 s sleep has passed, or the restart runs against an unlocked session and succeeds instead.
  * The terminal window keeps running in the background while locked; that is intended. The lock screen blanks 5 s after the last input — that is why the mouse is moved every 4 s.
  * If the lock screen ever disappears without a password during the wait, that is a critical failure — screenshot it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with `unlocked-probe=1`, the bar returning after the unlocked restart with `exit=0` and one shell process
  ** Lock screenshots spanning >25 s with the box continuously present; serial `locked-probe=0`
  ** `/tmp/restart.log` with `Refusing to restart Omarchy shell while the session is locked.` and `exit=1`; `ok` from ping; `1` from the final probe
  * If unsuccessful
  ** Screenshot of the lock screen disappearing, a bar flashing over the lock, or a plain black/red screen with no password box
  ** Contents of /tmp/restart.log, `omarchy-shell lock status`, and `hyprctl -j monitors | jq '.[].solitaryBlockedBy'` taken while locked via the same background trick
covers: bin/omarchy-restart-shell (locked guard); bin/omarchy-hyprland-session-locked; bin/omarchy-shell; bin/omarchy-system-lock; shell/plugins/lock/Service.qml status IPC; test/shell.d/restart-shell-test.sh; test/shell.d/hyprland-session-locked-test.sh; test/shell.d/lock-stranded-recovery-test.sh; manual/13-toggles-idle-screensaver.md
merged-from: 32:lock-refuses-restart-shell-while-locked; 51:restart-shell-refuses-while-locked; 52:restart-shell-refuses-while-locked; 25:session-locked-probe-via-serial

### lock-survives-shell-crash-stranded-recovery   [VM-OK]
description: If the shell dies while the session is locked, the compositor keeps the lock (the desktop is never exposed), the launcher relaunches the shell, and the new lock service re-takes the stranded lock so the user can still type a password — the stranded-lock recovery path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run exactly: `(sleep 10; pkill -9 -x quickshell || pkill -9 -x qs) &`
  * Immediately press Super+Ctrl+L and keep the lock screen visible by moving the mouse every 4 seconds, screenshotting each time.
  * At around 10 s the password box disappears (the shell was killed). Screenshot what the screen shows — Hyprland's plain lock fallback (a solid or tinted screen, possibly with a text message). It must NOT show the desktop, the bar or any windows.
  * Keep screenshotting every 3–4 s. Within about 10–15 seconds the `Enter Password` box reappears (new shell, lock re-taken).
  * Type `prime` and press Enter. The desktop returns with the bar and the terminal.
  * In the terminal run `omarchy-shell lock status | jq .locked` → `false`, then `journalctl -t omarchy-shell --since -3min --no-pager | grep -E 'relaunching|lock-stranded|lock-requested|unlocked' | sudo tee /dev/ttyS0` (password `prime`) and read the serial log.
  ** Expected lines: `Omarchy shell exited with status 137; relaunching.`, `omarchy lock … lock-stranded: recovering`, `… lock-requested`, `… unlocked`.
  ** The same recovery can be driven from a console: Ctrl+Alt+F3, log in `prime`/`prime`, `kill -9 $(pgrep -x quickshell); sleep 3; pgrep -x quickshell` prints a new PID; back on Ctrl+Alt+F1 the lock screen has a password field, not a black failsafe. A manual `omarchy-restart-shell` after the kill also exits 0 and re-acquires the lock.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the box has not returned after 30 s the session is stranded: switch to a TTY with Ctrl+Alt+F3, log in as `prime`, run `omarchy-restart-shell`, return with Ctrl+Alt+F1 (or F2) and report the failure with `journalctl -b --no-pager | tail -100 | sudo tee /dev/ttyS0`.
  * The desktop must never be visible between the kill and the recovery; if it is, that is a security failure — report it loudly. A solid colour while the shell is gone is acceptable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot sequence: lock box → fallback screen without box → box back → desktop only after `prime`
  ** `locked: false` and the serial log with `relaunching`, `lock-stranded: recovering`, `lock-requested`, `unlocked`
  * If unsuccessful
  ** Screenshot showing the desktop/bar/terminal while the lock should be held, or a screen that never gets its password box back
  ** The journal excerpt above and `omarchy-shell lock status`
covers: shell/plugins/lock/Service.qml (checkStrandedLock/recoverStrandedLock, strandedLockRetryTimer); bin/omarchy-launch-shell (relaunch on non-zero exit); bin/omarchy-hyprland-session-locked; bin/omarchy-restart-shell; default/hypr/looknfeel.lua allow_session_lock_restore; test/shell.d/lock-stranded-recovery-test.sh; test/shell.d/launch-shell-test.sh; test/shell.d/restart-shell-test.sh (dead-lock recovery); test/shell.d/monitor-recovery-test.sh; manual/13-toggles-idle-screensaver.md; manual/48-security.md
merged-from: 32:lock-recovers-after-shell-killed; 51:lock-stranded-shell-crash-recovers; 52:lock-survives-shell-crash

### lock-status-ipc-and-journal-trail   [VM-OK]
description: The lock can be driven and inspected from a terminal — `omarchy-shell lock lock` locks, `status` reports the state, and every transition lands in the journal — so scripts and support can see what the lock did.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell lock status | jq .`. It shows `"locked": false`, `"passwordPam": true`, `"fingerprint": false`, `"realScreens": 1`.
  * Run `omarchy-shell lock lock`. It prints `ok` and the lock screen appears at once.
  ** The lock screen blanks 5 s after the last input; a mouse move brings it back.
  * Type `prime` and press Enter. The desktop with the terminal returns.
  * Run `omarchy-shell lock status | jq .lastEvent` → `"unlocked"`.
  * Run `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy lock' | sudo tee /dev/ttyS0` (password `prime`) and read the serial log. In order it contains `lock-requested`, `lock-pending: screen-stabilizing`, `session-locked=true`, `secure=true`, `unlocked`.
  * Close the terminal with Super+W.
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
covers: shell/plugins/lock/Service.qml (IpcHandler lock/isLocked/status, logEvent); bin/omarchy-shell; bin/omarchy-launch-shell (systemd-cat journal tag)
merged-from: 32:lock-status-ipc-and-journal-trail

### lock-preview-overlay-never-locks   [VM-OK]
description: `omarchy-shell lock preview` shows a non-interactive copy of the lock screen for theme authors; it accepts no password input, a click dismisses it, `hidePreview` hides it programmatically, and it never blanks or locks the session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-shell lock preview`. The screen shows the lock look (blurred wallpaper + `Enter Password` box) and the command printed `ok`.
  * Type `abc` and press Enter. Nothing happens: no dots, no `Checking…`, no failure message (the preview field is disabled).
  * Click anywhere with the left mouse button. The preview disappears and the desktop with the terminal is back.
  * Run `omarchy-shell lock isLocked` — `false` (the session was never locked).
  * Run exactly: `omarchy-shell lock preview; sleep 6; omarchy-shell lock hidePreview` — the preview shows for ~6 s and then hides itself without any click.
  * Run `omarchy-shell lock preview` again and wait 8 s taking a screenshot every 4 s: the preview never blanks the screen (no black) — the 5 s blank timer belongs to real locks only. Click to dismiss it, then close the terminal with Super+W.
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
  ** Screenshot sequence showing the chained preview staying visible ~6 s and then gone, and a preview still lit after 8 s
  * If unsuccessful
  ** Screenshot showing dots/`Checking…` in the preview, a preview that a click cannot dismiss, a black screen, or a real lock (isLocked `true`)
covers: shell/plugins/lock/Service.qml (previewWindow, IpcHandler preview/hidePreview)
merged-from: 32:lock-preview-overlay

### lock-pam-wiring-and-fingerprint-absence   [VM-PARTIAL]
description: The lock's PAM wiring is what makes locking safe: with no fingerprint reader the lock screen shows no fingerprint hint and Setup → Security offers no Fingerprint row; re-running `omarchy-apply-lock` is harmless; and when the password PAM file is missing the shell refuses to lock instead of showing a lock nobody could open, until `omarchy-apply-lock` puts it back. Skipped: the enrolled-fingerprint path (no reader).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L and screenshot the password box within 5 s: the right end of the box is empty — no fingerprint glyph inside the field; the placeholder is centred. Type `prime`, press Enter.
  * Open a terminal with Super+Enter and run `omarchy-shell lock status | jq '{passwordPam, fingerprint}'` → `true`, `false`; `ls /etc/pam.d/omarchy-lock-*` → only `omarchy-lock-password`; `ls /etc/pam.d/omarchy-lock-fingerprint` → `No such file or directory`.
  * Press Super+Space, click `Setup`, click `Security` and screenshot: no `Fingerprint` row is offered. Press Escape to close the menu.
  * Run `sudo omarchy-apply-lock` (password `prime`) → `Configuring lock screen password authentication...` then `Lock screen authentication configured.`; no fingerprint line; `ls /etc/pam.d/omarchy-lock-*` is unchanged (idempotent). Press Super+Ctrl+L, type `wrong` Enter (rejected), then `prime` Enter (unlocked).
  * Run `sudo mv /etc/pam.d/omarchy-lock-password /tmp/`. Wait 3 s, then `omarchy-shell lock status | jq .passwordPam` → `false` and `omarchy-shell lock lock` → prints `missing-pam`; no lock screen appears.
  * Press Super+Ctrl+L. Nothing happens: the desktop stays (screenshot).
  ** If a lock screen does appear here, type `prime` + Enter and report the failure; if it does not open, press Ctrl+Alt+F3, log in `prime`/`prime`, run `sudo mv /tmp/omarchy-lock-password /etc/pam.d/`, return with Ctrl+Alt+F1 and unlock before continuing.
  * Run `sudo omarchy-apply-lock` → the two lines again. Wait 3 s; `omarchy-shell lock status | jq .passwordPam` → `true`. Press Super+Ctrl+L: the lock screen appears; type `prime`, Enter → desktop. Run `sudo rm -f /tmp/omarchy-lock-password` to tidy up and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped in this VM: the enrolled path (glyph shown, touch to unlock). Only the absence is verified.
  * The shell watches the PAM file; if `omarchy-shell lock lock` still prints `ok` 10 s after the move, report it and run `sudo omarchy-apply-lock` immediately.
  * The lock screen blanks after 5 s without input; move the mouse to bring it back.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Lock screenshot with an empty right edge in the box; Setup → Security screenshot without a Fingerprint row; terminal `true`/`false` and the single PAM file
  ** The two apply-lock lines twice, the rejected-then-accepted unlock, `passwordPam: false` and `missing-pam` while the file is away, the unchanged desktop after the hotkey, and the working lock screen afterwards
  * If unsuccessful
  ** A fingerprint glyph on the box, `fingerprint: true`, a Fingerprint menu entry on a machine without a reader, a lock screen shown while the PAM file was missing (and whether `prime` opened it), or the lock still refusing after apply-lock
covers: shell/plugins/lock/Service.qml (FileView /etc/pam.d/omarchy-lock-password, beginLock lock-denied, IPC missing-pam, fingerprintCheckProc, startFingerprint); shell/plugins/lock/LockView.qml fingerprintIndicator; bin/omarchy-apply-lock (password + fingerprint branches); install/config/lockscreen-pam.sh; omarchy-menu.jsonc setup.security.fingerprint `when`; test/shell.d/lock-fingerprint-indicator-test.sh
merged-from: 32:lock-denied-without-pam-config; 21:apply-lock-idempotent; 32:lock-fingerprint-indicator-absent

### screensaver-system-menu-start-and-dismiss   [VM-OK]
description: System → Screensaver launches the fullscreen terminal screensaver (black, large font edge to edge, animated Omarchy branding text, cursor hidden), a key press ends it and restores the desktop and cursor with no ttfx left behind, a second launch does not start a duplicate; the test also records whether mouse movement alone ends it (the manual says it does; reviewers disagree).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter so a window is on screen. Press Super+Escape (System menu) and click `Screensaver` with the mouse. Do not use keyboard.
  ** Within ~3 s the whole screen turns black and animated block-letter Omarchy text plays edge to edge in a large font with no padding; the mouse cursor is hidden.
  * Take screenshots at 3 s and 8 s without any input: the two frames differ (it is animating).
  * Move the mouse once and screenshot after 2 s. Record whether the screensaver is still running (report what you see — the manual claims movement exits it).
  * Press Space (if it is still running). The screensaver closes; the desktop with the terminal is back and the cursor is visible.
  * In the terminal run `hyprctl clients -j | jq '[.[] | select(.class=="org.omarchy.screensaver")] | length'; pgrep -x ttfx; echo "exit=$?"` → `0`, no PID, `exit=1`.
  * Run `omarchy-launch-screensaver force & sleep 3; omarchy-launch-screensaver force; echo rc=$?`. Exactly one screensaver instance appears; press Space; the terminal shows `rc=0` (the second call exited because one was already running).
  * Close the terminal with Super+W. The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A toast `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` means the default terminal is something else — report it with the output of `xdg-terminal-exec --print-id` (foot on a stock disk).
  * The fullscreen screensaver has keyboard focus; Space or Escape ends it. Keep the pointer still while screenshotting it.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Two differing screensaver frames (black, large text, no padding, no cursor); a note on the mouse-movement behaviour observed; the desktop back after Space with the cursor visible
  ** Terminal showing `0`, `exit=1`, and `rc=0` after the single instance; the mouse was used to pick Screensaver
  * If unsuccessful
  ** The unsupported-terminal toast, a screensaver ignoring keys, a padded/small-font/themed-background window, a duplicate instance, or a leftover `ttfx` process (`pgrep -a ttfx`)
covers: bin/omarchy-screensaver (l.39); bin/omarchy-launch-screensaver; default/omarchy/omarchy-menu.jsonc system.screensaver; default/hypr/bindings/utilities.lua:8; default/foot/screensaver.ini; default/alacritty/screensaver.toml; default/ghostty/screensaver; system.lua org.omarchy.screensaver; bin/omarchy-toggle-screensaver; manual/13:89-93; manual/13-toggles-idle-screensaver.md "The screensaver"
merged-from: 20:screensaver-start-from-system-menu; 10:screensaver-on-demand-system-menu; 32:screensaver-menu-start-and-key-dismiss; 41:screensaver-foot-config; 60:ttfx-screensaver-from-system-menu

### screensaver-toggle-off-menu-forces-idle-skips-to-lock   [VM-OK]
description: Trigger → Toggle → Screensaver (Super+Ctrl+O) flips the screensaver's availability with `Screensaver disabled`/`enabled` toasts; while disabled the plain launcher refuses (exit 1), System → Screensaver and `force` still start it, and the idle cycle goes straight to the lock screen at the lock deadline; the toggle group lists its commands and refuses a bad action.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and shorten idle so the test fits: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; jq '.idle = {screensaver: 15, lock: 30}' $f > /tmp/s.json && mv /tmp/s.json $f`
  ** `shell.json` replaces the defaults wholesale — the stock file is copied first and edited in place so the bar layout survives.
  * Press Super+Ctrl+O. The menu opens directly in Toggle (Stay Awake, Notifications, Crash Capture, Screensaver, Nightlight, Menu Bar, Workspace Layout, Window Gaps, 1-Window Ratio). Click `Screensaver` with the mouse: a notification `Screensaver disabled` appears top-right.
  ** The same submenu flips Crash Capture: Super+Ctrl+O, type `crash`, Return → toast `Crash capture disabled`; repeat → `Crash capture enabled`. Leave it enabled.
  * In the terminal run `omarchy-toggle-enabled screensaver-off; echo "exit=$?"` → `exit=0`, then `omarchy-launch-screensaver; echo "exit=$?"` → `exit=1` and nothing appears on screen.
  * Press Super+Escape → click `Screensaver`: the screensaver STILL starts (forced). Press Space. Run `omarchy-launch-screensaver force` → it starts too. Press Space.
  * Stop all input for 35 s, screenshotting every 5 s: no screensaver at ~15 s; the lock screen appears at ~30 s. Move the mouse, type `prime`, press Enter. The desktop returns.
  * Press Super+Ctrl+O → `Screensaver` again: toast `Screensaver enabled`. Run `omarchy-toggle-enabled screensaver-off; echo "exit=$?"` → `exit=1`, then `omarchy-launch-screensaver; echo "exit=$?"` → the screensaver appears; press Space; `exit=0`.
  * Unhappy path: run `omarchy toggle` → `Toggle commands — Toggle Omarchy features:` lists `omarchy toggle bar`, `… idle`, `… nightlight`, `… screensaver`, `… suspend` …; then `omarchy-toggle bar-off sideways; echo "exit=$?"` → `Usage: omarchy-toggle <flag-name> [toggle|on|off]`, `exit=1`, and the bar stays visible.
  * Restore idle: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+O is `<M-C-o>`. Screenshot immediately after each toggle click — the toast fades in seconds. The Toggle submenu is also under Trigger in the root Omarchy menu (Super+Space).
  * The lock screen blanks 5 s after the last input; a mouse move wakes it. Screenshots do not count as activity during the 35 s wait; keys and mouse do.
  * The screensaver takes keyboard focus; the next key press only exits it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Toggle submenu, the `Screensaver disabled` and `Screensaver enabled` notifications, and the two crash-capture toasts
  ** Terminal `exit=0`/`exit=1` for the flag and the refused launcher, the forced screensaver twice, the lock at ~30 s with no screensaver before it, the restored desktop, the launcher working again with `exit=0`
  ** The `omarchy toggle` group listing and the usage refusal with the bar still visible
  * If unsuccessful
  ** Screensaver appearing at 15 s while disabled, no lock by 45 s, a toggle toast without the matching state change, the forced launch refusing, or the `Screensaver only runs in …` toast
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0`
covers: bin/omarchy-toggle-screensaver; bin/omarchy-toggle; bin/omarchy-toggle-enabled; bin/omarchy-toggle-crash-capture; bin/omarchy; bin/omarchy-launch-screensaver (screensaver-off guard, force, :8-11); bin/omarchy-screensaver; default/omarchy/omarchy-menu.jsonc (system.screensaver :36, trigger.toggle.screensaver :90-99); default/hypr/bindings/utilities.lua:5; shell/plugins/services/idle/Service.qml (screensaverLaunchGraceTimer, lockTimer); system.lua org.omarchy.screensaver; manual/13:7-17,28-34
merged-from: 32:screensaver-toggle-off-skips-to-lock; 20:screensaver-toggle-and-force; 22:launch-screensaver-and-toggle; 25:toggle-screensaver-off-blocks-idle-but-menu-forces; 10:toggle-menu-screensaver-crash-capture

### screensaver-direct-run-exits-immediately   [VM-OK]
description: Running `omarchy screensaver` in an ordinary terminal is not a supported entry point: it paints black, hides the cursor and exits within about a second because the focused window is not the screensaver window, restoring the cursor on the way out (and leaving that terminal's background black — a known quirk).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `time omarchy screensaver; echo "exit=$?"`; screenshot at once and again after 3 s.
  ** Expected: the terminal background turns black (maybe a brief ttfx frame), then the prompt returns with `real` ≈ 1–2 s and `exit=0`.
  ** Quirk: the black background is never reset (OSC 11), so this terminal may stay black until closed.
  * Move the mouse; the cursor is visible again.
  * Type `pgrep -c ttfx || echo none`; expected `none`.
  * Type `omarchy screensaver --help | grep -A1 Binary`; expected `omarchy-screensaver` — the router help, not a screensaver run.
  * Close the terminal with Super+W.
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
  ** A screensaver running in the terminal > 5 s, or an invisible cursor afterwards
covers: bin/omarchy-screensaver:5-14,38-48
merged-from: 20:screensaver-direct-run-exits-immediately

### screensaver-text-edit-and-restore-default   [VM-OK]
description: Style → Screensaver → Edit Text opens `screensaver.txt`, saving launches the screensaver immediately with the new art, Restore Default brings the Omarchy logo back byte-identical, and the branding command refuses an unknown action — the simplest branding path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape and click `Screensaver`. The screen fills with the animated Omarchy ASCII logo; two screenshots 2 s apart differ. Press any key to exit.
  * Press Super+Space → `Style` → `Screensaver` → `Edit Text`. Neovim opens `~/.config/omarchy/branding/screensaver.txt` containing the logo art.
  * Replace the content: type `ggdG`, then `i`, type `PROBE SCREENSAVER TEXT`, press Escape, type `:wq` and Enter.
  ** The screensaver starts immediately showing the words PROBE SCREENSAVER TEXT (drifting/animated). Screenshot, then press a key to exit.
  * Open a terminal with Super+Enter and run `cat ~/.config/omarchy/branding/screensaver.txt` → the one line.
  * Press Super+Space → `Style` → `Screensaver` → `Restore Default`. The screensaver starts with the Omarchy logo again. Press a key. Run `diff -q ~/.config/omarchy/branding/screensaver.txt /usr/share/omarchy/logo.txt` → no output (identical).
  * Unhappy path: run `omarchy branding screensaver sideways; echo "exit=$?"` → `Usage: omarchy-branding-screensaver <image|text|reset>`, `exit=1`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screensaver covers the whole screen; any key exits, mouse movement may not.
  * If a `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty` notification appears, the default terminal is something else — report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of two differing stock screensaver frames, the editor, the screensaver showing PROBE SCREENSAVER TEXT, and the stock logo after Restore Default with the diff output empty; the usage error with `exit=1`
  * If unsuccessful
  ** The editor not opening, no screensaver after `:wq`, the refusal missing, or the toast; `./client get-serial`
covers: manual/41-branding.md (Screensaver); omarchy-menu.jsonc style.screensaver.*, system.screensaver; bin/omarchy-branding-screensaver; bin/omarchy-launch-screensaver; $OMARCHY_PATH/logo.txt
merged-from: 12:screensaver-edit-text-menu; 21:branding-screensaver-custom-and-reset

### screensaver-ascii-wordmark-and-reject   [VM-OK]
description: `omarchy ascii` renders text in the Omarchy wordmark font for the screensaver file, skips characters the font lacks (naming them on stderr), reads stdin, and refuses text with nothing drawable — the "Words instead of a logo" section.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy ascii Omarchy | head -n 12`. Large block-character letters spelling OMARCHY across ~9 rows.
  * Run `omarchy ascii "Back in five" > ~/.config/omarchy/branding/screensaver.txt && wc -l ~/.config/omarchy/branding/screensaver.txt` → about 9 lines.
  * Press Super+Escape → `Screensaver`. The screensaver shows BACK IN FIVE in the wordmark font. Press a key to exit.
  * Run `omarchy ascii "Hi 5" >/dev/null; echo "exit=$?"` → stderr `Skipped, no glyph in Delta Corps Priest 1: 5` and `exit=0`.
  * Run `omarchy ascii "2026!"; echo "exit=$?"` → `Delta Corps Priest 1 draws letters and spaces only, and that text has neither.`, `exit=1`. Run `omarchy ascii ""; echo "exit=$?"` → `Nothing to render`, `exit=1`. Run `echo piped | omarchy ascii | head -n 3` → art from stdin.
  * Restore: `omarchy branding screensaver reset` (the screensaver launches with the logo; press a key) and `diff -q ~/.config/omarchy/branding/screensaver.txt /usr/share/omarchy/logo.txt` prints nothing.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The block glyphs need a Nerd/mono font; foot renders them fine. Send `>` as `<GT>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the OMARCHY art, the screensaver reading BACK IN FIVE, the skipped-glyph note with `exit=0`, the two refusals with `exit=1`, the stdin art, and the empty diff after reset
  * If unsuccessful
  ** Garbled art or a missing message; `./client get-serial`
covers: manual/41-branding.md (Words instead of a logo); bin/omarchy-ascii; bin/omarchy-branding-screensaver reset
merged-from: 12:screensaver-ascii-wordmark-and-reject

### screensaver-set-from-image-and-cancel   [VM-OK]
description: Style → Screensaver → Set From Image opens the desktop file chooser for a PNG/SVG, converts it to ASCII with `omarchy transcode ascii` and shows the result as the screensaver; cancelling the chooser changes nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `stat -c %Y ~/.config/omarchy/branding/screensaver.txt`; note the number.
  * Press Super+Space → `Style` → `Screensaver` → `Set From Image`. A GTK file chooser titled `Pick PNG or SVG for screensaver` opens (it renders oversized at 1× — expected).
  * Press Ctrl+L, type `/usr/share/omarchy/icon.png`, Enter (or click Open). The chooser closes; after a second the screensaver launches showing a braille-dot rendering of the Omarchy icon. Screenshot; press a key to exit.
  * In the terminal run `head -c 300 ~/.config/omarchy/branding/screensaver.txt | od -c | head -3` (multi-byte braille characters) and `wc -l ~/.config/omarchy/branding/screensaver.txt` (≤ 26 lines).
  * Unhappy path: `Style` → `Screensaver` → `Set From Image` again, then press Escape / click Cancel in the chooser. Nothing happens: no screensaver launch, and `stat -c %Y ~/.config/omarchy/branding/screensaver.txt` equals the value after the successful set.
  * Restore: `Style` → `Screensaver` → `Restore Default`; press a key when the logo screensaver appears. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The chooser filters to png/svg; typing the full path with Ctrl+L avoids navigating.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the chooser, the braille screensaver, the `od`/`wc` output, and the unchanged mtime after cancelling
  * If unsuccessful
  ** No chooser (portal failure), an `Unable to read logo image` error, or a screensaver launch after Cancel; `./client get-serial`
covers: manual/41-branding.md (Set From Image); bin/omarchy-branding-screensaver image; bin/omarchy-file-select; bin/omarchy-transcode-ascii
merged-from: 12:screensaver-set-from-image

### idle-chain-screensaver-lock-and-dismiss-cancels   [VM-OK]
description: With idle timings shortened live in `shell.json` the shell runs the full unattended chain — idle → screensaver → lock → blank — and a wake lets the user unlock normally; dismissing the screensaver before the lock deadline counts as activity and cancels the pending lock. The stock values are 150 s / 300 s (the same chain, only slower).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; omarchy-shell idle status | jq '{enabled, screensaver, lock}'` → `"enabled": true`, `"screensaver": 150`, `"lock": 300` (the shipped defaults; with them the screensaver comes at ~150 s and the lock at 300 s — not waited for here).
  ** `shell.json` replaces the defaults wholesale — never write a file with only an `idle` block, or the bar layout is lost; that is why the stock file is copied and edited in place.
  * Run `jq '.idle = {screensaver: 20, lock: 40}' $f > /tmp/s.json && mv /tmp/s.json $f` then `omarchy-shell idle status | jq '{screensaver, lock}'` → `20`, `40` (picked up live, no restart; the bar never blinked).
  * Now stop touching the machine: no keys, no mouse. Take a screenshot every 5 seconds and note the elapsed time since the last Enter.
  ** ~20 s: a fullscreen black window with animated ASCII art (the screensaver) appears.
  ** ~40 s: the screensaver is replaced by the lock screen (`Enter Password` box).
  ** ~45 s: the screen goes black (lock blank).
  * Move the mouse; the lock box comes back. Type `prime`, Enter. The desktop returns with the terminal as left.
  * Run `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0` (password `prime`). Expected: `idle-cycle-start: screensaver=20 lock=40`, `process-start: screensaver …`, `lock-system: lock-timeout`.
  * Second cycle: stop all input again. At ~20 s the screensaver appears; at ~25 s press Space — it closes and the desktop is back. From then until 55 s after this cycle started, move the mouse a little every 4 s (screenshot each time). The lock screen must NOT appear at ~40 s.
  ** Without the mouse jiggles a fresh cycle would start 20 s after the dismissal and show the screensaver again — correct behaviour, but confusing to judge.
  * Run the journal command again: it now also contains `idle-cycle-cancel: screensaver-dismissed` and only the one earlier `lock-system: lock-timeout`.
  * Restore: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f` and confirm `omarchy-shell idle status | jq .lock` → `300`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshots do not count as activity; any send-keys or mouse call does and cancels the countdown — the journal then shows `idle-cycle-cancel: activity`. Allow ±3 s on every timing.
  * On the black lock screen the first character typed both wakes it and enters the field; a mouse move is the harmless wake.
  * If instead of the screensaver a toast says `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty`, report the default terminal name — that is a real defect on a stock disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing the stock 150/300 status, then 20/40
  ** Timestamped screenshots: desktop → screensaver (~20 s) → lock (~40 s) → black (~45 s) → lock box after mouse → desktop
  ** Serial log with `idle-cycle-start: screensaver=20 lock=40` and `lock-system: lock-timeout`; second cycle: screensaver, desktop after Space, desktop still present at 40–55 s, and `idle-cycle-cancel: screensaver-dismissed` with no second `lock-system`
  ** The restored 300
  * If unsuccessful
  ** Screenshot at 60 s still showing the desktop (nothing fired), the lock arriving without the screensaver first, the lock too early, or the lock appearing at ~40 s after the screensaver was dismissed
  ** The idle journal excerpt and `omarchy-shell idle status | jq .`
covers: shell/plugins/services/idle/Service.qml (startIdleCycle, screensaverTimer, lockTimer, handleScreensaverWindowClosed, cancelIdleCycle, handleHyprlandEvent, :17-23,69); shell/plugins/services/idle/IdleModel.js (screensaverWindowsAfter); shell/shell.qml shell.json watch; config/omarchy/shell.json:3-6; bin/omarchy-launch-screensaver; bin/omarchy-screensaver; bin/omarchy-system-lock; test/shell.d/idle-test.sh; manual/05:134; manual/13:67-83,89; manual/13 "If you dismiss the screensaver…"
merged-from: 32:idle-chain-screensaver-then-lock; 10:idle-screensaver-then-lock-with-short-timers; 32:screensaver-dismiss-cancels-pending-lock; 20:screensaver-idle-autostart

### idle-config-invalid-values-fall-back   [VM-OK]
description: Bad idle numbers in `shell.json` fall back to the 150/300 defaults instead of breaking idle, and a lock deadline shorter than the screensaver locks directly without a screensaver — the edge cases of the idle configuration.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Prepare: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f`
  * Run `jq '.idle = {screensaver: "soon", lock: -5}' $f > /tmp/s.json && mv /tmp/s.json $f` then `omarchy-shell idle status | jq '{screensaver, lock, enabled}'` → `150`, `300`, `true` (invalid values ignored, idle still enabled).
  * Run `jq '.idle = {screensaver: 600, lock: 25}' $f > /tmp/s.json && mv /tmp/s.json $f` then `omarchy-shell idle status | jq '{screensaver, lock, screensaverDelay, lockDelay}'` → `600`, `25`, `575`, `0`.
  * Stop all input for 35 s, screenshotting every 5 s. At ~25 s the lock screen appears directly — no screensaver beforehand.
  * Move the mouse, type `prime`, Enter to unlock.
  * Restore: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`; confirm `omarchy-shell idle status | jq .lock` → `300`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `omarchy-shell idle status` errors with `not running`, the shell crashed on the config — that is a failure; run `omarchy-restart-shell` and report.
  * Screenshots do not count as activity; keys and mouse do.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal JSON showing 150/300 after the bad values and 600/25/575/0 after the second edit
  ** Screenshots: desktop until ~25 s, lock screen at ~25 s with no screensaver frame in between, desktop after unlock, and the restored 300
  * If unsuccessful
  ** Status showing `soon`/`-5`/`0`, a shell that stopped answering, or a screensaver appearing before the lock
covers: shell/plugins/services/idle/IdleModel.js secondsFromConfig; shell/plugins/services/idle/Service.qml (firstIdleTimeoutSeconds, lockDelaySeconds); test/shell.d/idle-test.sh
merged-from: 32:idle-config-invalid-values-fall-back

### stay-awake-toggle-indicator-and-status   [VM-OK]
description: Stay Awake (Super+Ctrl+I, the Trigger → Toggle row, or `omarchy toggle idle`) flips the idle inhibitor with a coffee-cup indicator in the bar, `status` reports JSON that agrees with the bar, the state persists as a file and survives a shell restart, the update's own stay-awake helper never clears a user's choice, and a bad action is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy toggle idle status` → `{"enabled":false,"class":"disabled","tooltip":"Stay Awake"}`.
  * Press Super+Ctrl+I. A coffee-cup glyph lights in the bar's indicator area left of the clock; hover it for its tooltip. Run `omarchy toggle idle status` → `"enabled":true` … `"tooltip":"Allow Idle Lock & Screensaver"`, and `ls ~/.local/state/omarchy/indicators/` → `stay-awake`.
  * Run `omarchy restart shell` — after the bar returns the indicator is still shown (persisted).
  * Run `omarchy-update-stay-awake start` (password `prime`) then `omarchy-update-stay-awake stop`. The indicator stays ON — the user set it, the update must not clear it.
  * Press Super+Space → `Trigger` → `Toggle` → `Stay Awake` with the mouse. The glyph disappears; `omarchy toggle idle status` → `"enabled":false`; the file is gone.
  * Run `omarchy-update-stay-awake start`: the indicator turns ON and `systemd-inhibit --list | grep omarchy-update` shows `Omarchy update in progress` in block mode. Run `omarchy-update-stay-awake stop`: the indicator turns OFF and the grep shows nothing.
  * Run `omarchy toggle idle stay-awake` (prints `disabled`, cup on), then `omarchy toggle idle allow-idle` (prints `enabled`, cup off).
  * Unhappy path: run `omarchy toggle idle sleepy; echo "exit=$?"` → `Usage: omarchy-toggle-idle [toggle|stay-awake|allow-idle|status]`, `exit=1`; the cup stays off. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Ctrl+I is `<M-C-i>`. The indicator is a small glyph in the cluster next to the centre widgets; compare bar screenshots before and after each step. The menu row label is "Stay Awake" with a coffee-cup glyph.
  * Super+Ctrl+O opens the Toggle submenu directly if the menu walk is hard to hit.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots with and without the cup, each matching the status JSON (`enabled` false/true) and the `ls` output; the cup still shown after the restart and after the helper's start/stop
  ** The inhibitor line `Omarchy update in progress` while started and its absence after stop; `disabled`/`enabled` from the explicit actions; the usage rejection with `exit=1`
  * If unsuccessful
  ** The status JSON disagreeing with the bar, a stale or missing indicator, the helper clearing a user-set Stay Awake, an inhibitor left after stop (`systemd-inhibit --list | sudo tee /dev/ttyS0`), or the crash dialog
covers: bin/omarchy-toggle-idle; bin/omarchy-update-stay-awake; shell/plugins/bar/indicators/StayAwake.qml; shell/plugins/services/idle/Service.qml; default/hypr/bindings/utilities.lua:31; default/omarchy/omarchy-menu.jsonc (trigger.toggle.idle-lock :90); test/shell.d/idle-test.sh; test/shell.d/update-lock-test.sh; manual/07:186; manual/13:15,83; manual/13-toggles-idle-screensaver.md
merged-from: 10:stay-awake-toggle-and-status; 25:toggle-stay-awake-indicator-and-status; 51:stay-awake-toggle-indicator; 24:stay-awake-toggle-and-update-restore

### stay-awake-blocks-idle-screensaver-and-lock   [VM-OK]
description: With short idle timings, Stay Awake stops the idle screensaver and lock from ever firing while its coffee-cup indicator is lit, and switching it off again (from the Toggle menu) re-arms idle so the screensaver returns — the idle service end to end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and shorten idle so the test fits: `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; jq '.idle = {screensaver: 15, lock: 30}' $f > /tmp/s.json && mv /tmp/s.json $f`
  ** `shell.json` replaces the defaults wholesale, which is why the stock file is copied first and edited in place; the bar must stay intact.
  * Press Super+Ctrl+I. A coffee-cup glyph appears in the bar's centre indicator area, left of the clock.
  * Run `omarchy-shell idle status | jq '{enabled, stayAwake}'` → `"enabled": false`, `"stayAwake": true`.
  * Stop all input for 40 s, screenshotting every 5 s: no screensaver and no lock screen may appear.
  * Press Super+Space, click `Trigger`, click `Toggle`, click `Stay Awake` with the mouse. The coffee-cup indicator disappears.
  * Stop all input for 20 s: the screensaver (fullscreen black window with animated text, class `org.omarchy.screensaver`) appears at ~15 s. Press Space once to dismiss it; the desktop with the terminal is back.
  * Restore idle: `jq '.idle = {screensaver: 150, lock: 300}' $f > /tmp/s.json && mv /tmp/s.json $f`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The indicator glyph is small; zoom into the bar centre. Hovering it shows the tooltip `Stay Awake`.
  * Super+Ctrl+I with send-keys is `<C-M-i>`. Screenshots do not count as activity; any key or mouse call does — do not move the mouse while waiting.
  * If instead of the screensaver a toast says `Screensaver only runs in Alacritty, Foot, Ghostty, or Kitty`, report the default terminal name — that is a real defect on a stock disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots with and without the coffee-cup indicator; terminal JSON `enabled: false, stayAwake: true`
  ** 40 s of screenshots with no screensaver/lock while awake; the screensaver appearing at ~15 s after the menu toggle; the restored desktop
  * If unsuccessful
  ** Screensaver or lock appearing while Stay Awake is on, the indicator not changing, or the toast; the last screenshots of the idle wait
  ** `journalctl -t omarchy-shell --since -3min --no-pager | grep 'omarchy idle' | sudo tee /dev/ttyS0`
covers: bin/omarchy-toggle-idle; shell/plugins/services/idle/Service.qml (stayAwake, FileView watcher, applyStayAwake); shell/plugins/bar/indicators/StayAwake.qml; bin/omarchy-launch-screensaver; bin/omarchy-screensaver; default/hypr/bindings/utilities.lua:31; omarchy-menu.jsonc trigger.toggle.idle-lock; config/omarchy/shell.json (idle block); test/shell.d/idle-test.sh; manual/13-toggles-idle-screensaver.md
merged-from: 32:idle-stay-awake-toggle-blocks-idle; 25:idle-screensaver-fires-and-stay-awake-blocks-it

### debug-idle-report-tracks-toggles   [VM-OK]
description: `omarchy debug idle` is the screensaver/lock diagnostics dump: all eleven sections print with live values, a non-numeric line count is tolerated, and its detectors track the Stay Awake and Screensaver toggles (`stopped` ↔ `disabled`).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy debug idle 20 | sudo tee /dev/ttyS0 >/dev/null` (password `prime`); read it with get-serial.
  ** Expected headers `== Time ==`, `== Idle IPC status ==`, `== Quickshell instances ==`, `== Recent idle logs ==`, `== Persisted shell log ==`, `== Relevant processes ==`, `== Sleep lock service ==` (active (running)), `== Hyprland screensaver clients ==`, `== Idle inhibitors ==`, `== Screensaver detector ==` followed by `stopped`, `== Lock detector ==` with `"secure": false`.
  * Run `omarchy debug idle abc | grep -A1 'Screensaver detector'` → `stopped` again — a non-numeric count is silently replaced by 200.
  * Press Super+Ctrl+I (Stay Awake). An indicator appears in the bar. Run `omarchy-debug-idle 20 | grep -A2 'Idle IPC'` — the status now shows idle disabled / stay-awake. Press Super+Ctrl+I again; the indicator is gone.
  * Press Super+Space → `Trigger` → `Toggle` → `Screensaver`; toast `Screensaver disabled`. Run `omarchy debug idle 5 | grep -A1 'Screensaver detector'` → `disabled`.
  * Press Super+Space → `Trigger` → `Toggle` → `Screensaver` again; toast `Screensaver enabled`; re-run the grep → `stopped`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The serial dump is the readable copy; the terminal scrolls past most of it. Toasts fade within seconds; screenshot right after clicking the menu row.
  * The Toggle submenu is under Trigger in the root Omarchy menu (Super+Space), or directly via Super+Ctrl+O.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with the eleven section headers, `stopped`, the running sleep-lock service and the lock detector JSON
  ** Screenshots of the stay-awake indicator with the changed idle status and of the restored bar; both toasts and the `disabled` → `stopped` detector lines
  * If unsuccessful
  ** A missing section, an `omarchy-shell` connection error, the sleep lock service not running, or a detector that ignores the toggle
covers: bin/omarchy-debug-idle; bin/omarchy-toggle-idle; bin/omarchy-toggle-screensaver; default/systemd/user/omarchy-sleep-lock.service; default/hypr/bindings/utilities.lua (SUPER+CTRL+I); default/omarchy/omarchy-menu.jsonc:93
merged-from: 24:debug-idle-report; 20:debug-idle-follows-screensaver-toggle

### shell-json-idle-hot-reload-and-invalid-fallback   [VM-OK]
description: `~/.config/omarchy/shell.json` is read live: an `idle.lock` edit applies without a restart, invalid JSON or a version-less file keeps the defaults with a journal warning and never takes the bar down, a valid but minimal file replaces the layout wholesale (replace-not-merge), and restoring the file — or `omarchy refresh shell` — brings the bar back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `f=~/.config/omarchy/shell.json; [[ -s $f ]] || cp $OMARCHY_PATH/config/omarchy/shell.json $f; cp $f /tmp/shell.json.bak`. Screenshot the bar (full layout: menu, workspaces | indicators, clock, … | tray … power). Run `omarchy-shell shell listShellConfig | jq .idle` → `{"screensaver":150,"lock":300}`.
  * Run `jq '.idle.lock = 600' $f > /tmp/s.json && mv /tmp/s.json $f`; wait 3 s; `omarchy-shell shell listShellConfig | jq .idle.lock` → `600` — no restart happened (the bar never blinked).
  * Run `echo '{ this is not json' > $f`. Wait 2 s. The bar is unchanged; `omarchy-shell shell ping` → `ok`; `omarchy-shell shell listShellConfig | jq .idle` → `{"screensaver":150,"lock":300}` (defaults). Run `journalctl -t omarchy-shell --since -1min --no-pager | grep -i 'shell.json'` → a line containing `shell.json parse failed, using defaults`.
  * Run `echo '{"idle":{"screensaver":150,"lock":300}}' > $f`; wait 2 s; the same grep now also shows `shell.json missing version: 1, using defaults`; bar unchanged.
  ** A version-less `{"bar":{"position":"bottom"}}` is ignored the same way — the bar stays on top.
  * Run `echo '{"version":1,"idle":{"screensaver":150,"lock":300}}' > $f`. Wait 2 s and screenshot. The bar changes to the minimal builtin layout: left `menu` + `workspaces`, centre `clock` only, right `audio` only — the indicators, weather, tray, network, power widgets are gone.
  ** A minimal valid file is honoured verbatim; there is no deep-merge with the defaults. `{"version":1,"bar":{"position":"bottom"}}` moves the bar to the bottom as an EMPTY strip (no `layout` → no widgets).
  * Run `cp /tmp/shell.json.bak $f`. Wait 2 s: the full bar layout is back (screenshot).
  * Round trip: run `omarchy refresh shell` (confirm if asked) → the file is stock again and `omarchy-shell shell listShellConfig | jq .idle.lock` → `300`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare bar screenshots side by side; the minimal layout has far fewer icons on the right. A hot-reload leaves the bar in place; a restart makes it vanish briefly.
  * Send `>` as `<GT>`. On the 4.0.2 disk `omarchy refresh shell` may be missing — report `command not found` as a version gap, not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar screenshots: full → unchanged after invalid JSON → unchanged after the version-less file → minimal after the version-only file → full after restore
  ** Terminal: idle.lock 300 → 600 with the bar continuously present, `ok`, the default idle JSON, both journal warnings, and 300 after `refresh shell`
  * If unsuccessful
  ** The bar disappearing/shell dying on invalid JSON (`omarchy-shell is not running`), no bar at all, or the layout not changing/returning
  ** `cat ~/.config/omarchy/shell.json` and `journalctl --user -n 40 | grep -i shell.json`; `./client get-serial`
covers: shell/shell.qml (applyShellConfig, loadDefaults, builtinShellConfig, userConfigFile FileView watchers); Bar.qml (fallbackBarConfig/normalizeLayout); config/omarchy/shell.json; docs/omarchy-shell.md §shell.json; shell/README.md Storage rules; default/agents/skills/omarchy/plugins.md §Idle and Lock; SKILL.md ("Lock after ten minutes", "Reset shell/bar to defaults"); bin/omarchy-shell
merged-from: 32:shell-json-invalid-falls-back-to-defaults; 61:shell-json-idle-hot-reload; 30:bar-invalid-shell-json-falls-back-to-defaults

### logout-to-sddm-greeter-wrong-empty-then-right-password   [VM-OK]
description: Logout closes the session and lands on the Omarchy SDDM greeter (the only place it is reachable on an autologin install), which has no username field, session list or power buttons, rejects an empty and a wrong password with its red lock/entry art cleared by the next keystroke, and admits the right one into a clean uwsm Hyprland desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and a browser (Super+Shift+Enter) so windows exist.
  * Press Super+Escape and click `Logout` with the mouse. An OSD `Logging out` shows, the windows close, and within 5–20 s the login screen appears: dark background, Omarchy logo, lock glyph and one dotted password entry — no username field and no session list. The entry already has focus; do not click first.
  ** Autologin does not re-fire here. If the desktop comes back without a greeter, report it with screenshots.
  * Press Enter with nothing typed. The lock glyph and entry turn red; the greeter does not disappear or restart.
  * Press Tab three times and click each corner of the screen once, screenshotting each: no username field, session list, power or reboot button appears anywhere.
  * Type `wrongpass` and press Enter. One dot appears per character while typing; after Enter the dots vanish and the lock icon and entry border turn red — screenshot within two seconds. Type one character: the red state clears immediately; press Backspace to remove it.
  * Type `prime` and press Enter. The Omarchy desktop loads with the bar and no leftover windows.
  * Press Super+Enter and run `echo $XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE; systemctl --user is-active 'wayland-wm@*'` → `Hyprland wayland` and `active`; then `loginctl list-sessions --no-pager` → one active session for `prime` on the sddm seat. Press Ctrl+D to close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The greeter runs its own Hyprland and can take 5–20 seconds after Logout; screenshot every few seconds until the logo appears. If it goes black after a while, keys still reach the password box.
  * Bullets in the box are the only typing feedback. Only two wrong submissions here — faillock (deny=10) is shared with the lock screen and sudo.
  * Logout keeps the disk unlocked; no LUKS passphrase is asked.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Logging out` OSD; the greeter (logo, lock glyph, single entry); red after the empty Enter; three Tab and four corner-click shots with no extra widgets; dots while typing; red after `wrongpass` with the field cleared; red cleared on the next keystroke; the fresh desktop with no windows
  ** Terminal line `Hyprland wayland` / `active` and the single session; the Logout row was clicked with the mouse
  * If unsuccessful
  ** Screenshot of what is on screen 30 s after Logout (black screen, TTY, stuck greeter), the wrong or empty password logging in, windows surviving the logout, any unexpected widget, or a greeter restart (logo flicker); `./client get-serial`
covers: bin/omarchy-system-logout; default/sddm/omarchy/Main.qml; etc/sddm.conf.d/*; default/sddm/hyprland.lua; default/wayland-sessions/omarchy.desktop; default/uwsm/env.d/10-omarchy; install/login/sddm.sh; omarchy-iso configure_login (99-omarchy-login.conf RememberLastUser); install/config/increase-lockout-limit.sh; default/omarchy/omarchy-menu.jsonc (system.logout)
merged-from: 41:sddm-login-wrong-then-right-password; 24:logout-returns-to-sddm-and-relogin; 42:sddm-greeter-after-logout; 41:sddm-empty-password-and-no-session-picker

### console-tty-login-wrong-then-right-and-back   [VM-OK]
description: A spare virtual console offers a getty login with the installed hostname, rejects a wrong password, accepts the account password, and the desktop survives the VT switch — the recovery path when the GUI is stuck (and the one the stranded-lock tests rely on).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Ctrl+Alt+F3. A text console with `omarchy login:` appears (the default hostname is `omarchy`). Screenshot.
  * Type `prime`, Enter; at `Password:` type `wrong`, Enter → `Login incorrect` and a new `login:` prompt. Screenshot.
  * Log in again with `prime` / `prime` → a shell prompt. Run `hostname; tty; who` → `omarchy`, `/dev/tty3`, and both your tty3 login and the graphical session.
  * Run `sudo tee /dev/ttyS0 <<<"tty3-login-ok"` (password `prime`) so the serial log carries the marker.
  * Type `exit`, Enter, then press Ctrl+Alt+F1 → the desktop is back exactly as left. Screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+Alt+F3 with send-keys is `<C-A-F3>`. If tty1 shows a text screen instead of the desktop, try Ctrl+Alt+F2 (SDDM may have taken the next VT).
  * The one wrong password counts toward the shared faillock tally (deny=10).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `omarchy login:`, of `Login incorrect`, and of `hostname; tty; who` output
  ** `./client get-serial` contains `tty3-login-ok`; screenshot of the restored desktop
  * If unsuccessful
  ** Screenshot of the console state (no getty, wrong hostname, correct password refused) or of a desktop that did not come back; the serial dump
covers: install/provisioning/omarchy-provision-owner.service (getty conflicts absent on a normal install); omarchy-iso configure_login (getty autologin removed); setup-form hostname default; install/config/increase-lockout-limit.sh
merged-from: 42:console-tty-login-and-back

### suspend-toggle-hides-system-menu-row   [VM-OK]
description: `omarchy toggle suspend` removes Suspend from the System menu with a toast and puts it back on the second call, the row follows the `suspend-off` flag file directly, Hibernate is listed only when `omarchy-hibernation-available` says so, and the toggle command refuses bad arguments — all without ever suspending the machine.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape. The System menu lists Screensaver, Lock, Suspend, Logout, Reboot, Shutdown (Hibernate absent unless set up). Screenshot, then Escape.
  * Open a terminal with Super+Enter and run `omarchy-hibernation-available; echo hib=$?` → `hib=1` matches Hibernate being absent (`hib=0` would have to match it being listed).
  * Run `omarchy toggle suspend` → notification `Suspend removed from system menu`; `ls ~/.local/state/omarchy/toggles/` shows `suspend-off`.
  * Press Super+Escape, Escape, then Super+Escape again: the Suspend row is gone; the other rows remain. Escape.
  ** The menu paints guard results from the previous open — always open it twice after a state change.
  * Run `omarchy toggle suspend` again → `Suspend now available in system menu`; the flag file is gone; Super+Escape (twice) shows Suspend again. Escape — do NOT select it.
  * Drive the flag by hand: `mkdir -p ~/.local/state/omarchy/toggles && touch ~/.local/state/omarchy/toggles/suspend-off` → the menu (opened twice) hides Suspend; `rm ~/.local/state/omarchy/toggles/suspend-off` → Suspend is back.
  * Unhappy path: `omarchy-toggle; echo "exit=$?"` → `Usage: omarchy-toggle <flag-name> [toggle|on|off]`, `exit=1`; `omarchy-toggle suspend-off sideways; echo "exit=$?"` → the same usage, `exit=1`; `omarchy-toggle-enabled suspend-off && echo OFF || echo ON` → `ON` (state as at the start). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Escape is `<M-ESC>`. The System menu is small; take the screenshot as soon as it opens. Notifications fade after a few seconds; screenshot right after each command.
  * Never activate Suspend in this VM — there is no reliable resume path. Skipped: actually suspending or hibernating.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the System menu with Suspend, the `removed` toast, the menu without Suspend, the `available` toast, the menu with Suspend again; the flag file listing; `hib=` consistent with Hibernate's presence
  ** The hand-made flag hiding and restoring the row; the two usage refusals with `exit=1` and `ON`
  * If unsuccessful
  ** The menu still showing Suspend while the flag exists (or vice versa), a missing notification, or the menu row that did not change; `./client get-serial`
covers: bin/omarchy-toggle-suspend; bin/omarchy-toggle; bin/omarchy-toggle-enabled; bin/omarchy-hibernation-available; omarchy-menu.jsonc system.suspend (when-clause :38) / system.hibernate (when); docs/menu.md guards; manual/13:21; manual/36-system-sleep.md (Toggle suspend)
merged-from: 10:suspend-toggle-hides-system-menu-row; 12:toggle-suspend-hides-system-menu-entry; 24:suspend-toggle-hides-menu-entry; 25:toggle-suspend-hides-system-menu-entry; 22:menu-system-submenu-suspend-guard

### hibernation-setup-adds-menu-row-and-remove   [VM-PARTIAL] [SLOW]
description: Hibernate is absent from the System menu until `omarchy-hibernation-setup` creates the Btrfs swap subvolume, swapfile, resume hook and kernel parameters and rebuilds the boot image; a second setup is refused as already done, and `omarchy-hibernation-remove` undoes everything so the machine is back where it started. Skipped: the actual suspend-to-disk. Two UKI rebuilds on 2 vCPU make this slow.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape: the System menu shows Screensaver, Lock, Suspend, Logout, Reboot, Shutdown and NO Hibernate. Escape. Open a terminal with Super+Enter and run `omarchy-hibernation-remove` → `Hibernation is not set up` (the remove path is safe when nothing is configured).
  * Run `omarchy-hibernation-setup` (password `prime`). At `Use 3.8Gi on boot drive to make hibernation available?` (the figure is the RAM size; may read 3.8Gi/4.0Gi) choose Yes.
  ** Lines follow in order: `Creating Btrfs subvolume`, `Creating swapfile in Btrfs subvolume`, `Adding swapfile to /etc/fstab`, `Enabling swap on /swap/swapfile`, `Adding resume hook to /etc/mkinitcpio.conf.d/omarchy_resume.conf`, `Adding resume kernel parameters`, `Regenerating initramfs...` (1–3 minutes; screenshot every 20 s). At `Reboot to enable hibernation?` answer **No**.
  ** If it prints `Hibernation is not supported on your system` or `Skipping hibernation setup (requires Limine bootloader)`, record it and stop: the guest kernel/bootloader lacks the prerequisite.
  * Run `swapon --show; cat /etc/limine-entry-tool.d/resume.conf; omarchy-hibernation-available; echo hib=$?` → `/swap/swapfile` listed beside zram, `resume_offset=<number>` (not empty), `hib=0`.
  * Press Super+Escape: a `Hibernate` row now sits between Suspend and Logout. Do NOT select it. Escape.
  * Run `omarchy-hibernation-setup` again → `Hibernation is already set up`, no prompt.
  * Run `omarchy-hibernation-remove`; at `Remove hibernation setup?` choose Yes. Lines: `Disabling swap on /swap/swapfile`, `Removing swapfile`, `Removing Btrfs subvolume /swap`, `Removing swapfile from /etc/fstab`, `Removing resume hook`, `Regenerating initramfs...` (1–3 minutes again), `Hibernation removed`.
  * Run `swapon --show` → zram only. Press Super+Escape: no Hibernate row — back to stock. Escape; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep screenshotting during the initramfs rebuilds; do not assume a hang before five minutes. Two UKI rebuilds ≈ 2–4 minutes total.
  * Do not choose Hibernate and do not reboot with hibernation configured unless the disk will be discarded. Skipped: `systemctl hibernate` itself (it powers the guest off with no wake path).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the System menu without, with, and again without Hibernate
  ** The `not set up` line, the size prompt, the setup transcript, `swapon --show` with the swapfile, a numeric `resume_offset=`, `hib=0`, `Hibernation is already set up`, the removal transcript ending `Hibernation removed`, and zram-only swapon
  * If unsuccessful
  ** `Hibernation is not supported on your system`, `requires Limine bootloader`, an empty `resume_offset=`, red errors from btrfs/fstab/mkinitcpio/limine, no Hibernate row after setup, or swap still active after removal; `./client get-serial`
covers: bin/omarchy-hibernation-setup; bin/omarchy-hibernation-remove; bin/omarchy-hibernation-available; default/omarchy/omarchy-menu.jsonc system.hibernate (when); default/systemd/system-sleep/keyboard-backlight; manual/36-system-sleep.md (Toggle hibernation)
merged-from: 24:hibernation-setup-then-remove; 12:hibernation-setup-and-remove; 13:hibernation-setup-adds-menu-entry-and-remove

### sleep-lock-secures-session-before-suspend   [VM-PARTIAL]
description: The pre-suspend lock helper can be exercised without sleeping: the sleep-lock monitor holds a delay inhibitor, `omarchy-system-sleep-lock` locks the session within its budget and exits 0, an impossibly small budget yields the "did not lock" warning and critical notification, and a non-numeric budget falls back. Skipped: the actual suspend/resume, FUSE unmount and gvfs restart (the driver cannot wake the guest).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `systemctl --user is-active omarchy-sleep-lock.service; systemd-inhibit --list | grep -i omarchy; grep InhibitDelayMaxSec /etc/systemd/logind.conf.d/20-inhibit-delay.conf` → `active`, a line `Lock screen before suspend` with mode delay, and the configured delay value (note it).
  * Run `omarchy-system-sleep-lock; echo "exit=$?"`. The lock screen engages at once. Unlock with `prime`; the terminal shows `exit=0`.
  * Run `journalctl --user -b --no-pager | grep -c 'suspending without a secure lock'` → `0`, and confirm no toast `did not lock before suspend` appeared.
  * Run `omarchy-system-sleep-lock 30; echo "exit=$?"`. The terminal prints `omarchy-system-sleep-lock: suspending without a secure lock (the shell did not secure the session within 30ms)` and `exit=1`, and a critical notification `Screen did not lock before suspend` appears.
  ** The lock request may still land a moment later; if the screen locks, unlock with `prime`.
  * Run `omarchy-system-sleep-lock abc; echo "exit=$?"` — a non-numeric budget falls back to the derived one: the screen locks, `exit=0`. Unlock with `prime`.
  * Do NOT run `systemctl suspend`: the guest cannot be woken by the driver. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot within a second of each command; the notification fades. The lock screen blanks 5 s after the last input.
  * The skipped part is the actual suspend/resume; only the lock request → secure handshake is exercised. The System → Suspend path itself is `suspend-from-system-menu-locks-first`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the active service, the inhibitor line and the delay value; the locked screen and `exit=0`; the zero journal count
  ** The 30 ms warning with `exit=1` and its critical notification; the fallback run locking with `exit=0`
  * If unsuccessful
  ** `exit=1` for the default budget, the lock screen not appearing, a `did not lock before suspend` toast on the default run, or no notification for the tiny budget
  ** Output of `omarchy-version`
covers: bin/omarchy-system-sleep-lock; bin/omarchy-system-sleep-monitor; default/systemd/user/omarchy-sleep-lock.service; etc/systemd/logind.conf.d/20-inhibit-delay.conf; default/systemd/system-sleep/unmount-fuse; default/systemd/system-sleep/force-igpu; default/systemd/system-sleep/keyboard-backlight; test/shell.d/sleep-lock-test.sh; test/shell.d/sleep-monitor-test.sh; test/shell.d/systemd-test.sh; manual/36-system-sleep.md
merged-from: 24:sleep-lock-manual-run-and-tiny-budget; 52:sleep-lock-secures-session; 41:suspend-locks-session

### suspend-from-system-menu-locks-first   [VM-PARTIAL]
description: Suspend from the System menu locks the session first and puts the machine to sleep; because the VM may not wake for the driver, this is the last action of its session and the disk is discarded. Skipped: the post-wake screen (and Hibernate, which would follow the same path after hibernation setup).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `systemd-inhibit --list | grep -i omarchy` — a line `Lock screen before suspend` with mode delay (the sleep-lock service is running).
  * Run `journalctl -f -o cat -g 'PrepareForSleep|omarchy-system-sleep-lock|PM: suspend' | sudo tee /dev/ttyS0 &` (password `prime`) so sleep messages reach the serial log.
  * Press Super+Escape and click `Suspend` with the mouse. Within a second the lock screen appears, then the display freezes or blanks. Screenshot every 2 seconds for 10 seconds.
  * Read `./client get-serial`: lines about PrepareForSleep and the suspend, and no `suspending without a secure lock`.
  * Try to wake: press Space, then move the mouse. If the guest wakes, the lock screen must be showing; unlock with `prime`. If nothing changes in 30 seconds record that as the expected limitation and end the session with `stop`.
  ** Hibernate (present only after hibernation setup) would take the same lock-then-sleep path; it is not attempted here.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: waking usually needs the host, so the post-wake screen is unproven here. Run nothing else after this test in the same session; `stop` is required.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the inhibitor line, the lock screen appearing before the freeze, and the serial dump with the sleep lines and no `suspending without a secure lock`; if woken, the lock screen after wake
  * If unsuccessful
  ** An unlocked desktop at the moment of sleep, `suspending without a secure lock` in serial, a guest that never resumes when it should have, or a crash on resume (`./client get-serial`)
covers: default/omarchy/omarchy-menu.jsonc (system.suspend, system.hibernate); bin/omarchy-system-sleep-monitor; bin/omarchy-system-sleep-lock; default/systemd/user/omarchy-sleep-lock.service; etc/systemd/logind.conf.d/20-inhibit-delay.conf; test/shell.d/sleep-monitor-test.sh; manual/36-system-sleep.md
merged-from: 24:suspend-locks-then-sleeps; 12:system-suspend-and-hibernate-actual

### lid-close-absence-noop-and-hardware-binds-present   [VM-PARTIAL]
description: On a machine without a lid the lid-close handler must not lock the screen and the wake helper must exit quietly, while the binds for inputs the guest lacks (lid switch, Copilot key, XF86PowerOff) still exist with the right flags and stay hidden from the keybinding viewer — only these absence paths exist here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ls /proc/acpi/button/lid/; omarchy-hw-laptop; echo laptop=$?` — no lid directory, `laptop=1`.
  * Run `omarchy-system-lid-close; echo "exit=$?"`. The screen must not lock; `exit=0`.
  * Run `omarchy-system-wake; echo "exit=$?"` — no error text, `exit=0`.
  * Run `hyprctl binds | grep -B3 -A8 -E 'code:201|XF86PowerOff|Lid Switch' | sudo tee /dev/ttyS0` (password `prime`) and read the serial log: a SUPER+SHIFT bind on `code:201` for `omarchy-menu toggle root`; `XF86PowerOff` with `locked: 1` running `omarchy-menu toggle system`; two `switch:` binds for the lid (on → `omarchy-system-lid-close`, off → `omarchy-hyprland-monitor-clamshell`) with `locked: 1`.
  * Run `omarchy-menu-keybindings --print | grep -c 201` → `0` (hidden from the viewer). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: a real lid close (lock plus clamshell display handling), the docked case, the Copilot key and the power button all need hardware the guest lacks; the client cannot send XF86PowerOff.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the detection lines and the still-unlocked desktop with both `exit=0`
  ** Serial dump of the four binds with their `locked` flags and the hidden-row count `0`
  * If unsuccessful
  ** The lock engaging with no lid, errors from the brightness/monitor helpers, a missing bind or missing `locked` flag
covers: bin/omarchy-system-lid-close; bin/omarchy-system-wake; default/hypr/bindings/utilities.lua:7,9,35-36 (Lid Switch, Copilot, XF86PowerOff binds); bin/omarchy-menu-keybindings:310; test/shell.d/lid-close-test.sh; test/shell.d/monitor-recovery-test.sh:100-102
merged-from: 24:lid-close-and-wake-noop-on-desktop; 40:hypr-copilot-power-lid-binds-present

### session-desktop-health-after-boot   [VM-OK]
description: A freshly resumed desktop session is healthy end to end: bar and wallpaper on screen with no crash dialog, the shell answers `ping`, a terminal opens, and it reports a working version, a btrfs root, PipeWire up and no failed system or user units — the acceptance suite's session check, driven from the screen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot. The top bar (menu icon, workspaces, clock) and the wallpaper must be visible with no crash dialog.
  ** If the screen is black the idle screensaver (150 s) or lock (300 s) has engaged: press Shift once (or type `prime` and Enter on the lock screen) and screenshot again.
  * Open a terminal with Super+Enter. A foot window with a shell prompt must appear within 45 seconds.
  * Type `omarchy-shell shell ping; omarchy-version; findmnt -no FSTYPE /` and press Enter. It must print `ok`, a version string (about `4.0.2` on the minted disk), and `btrfs`.
  ** Right after boot the shell may take up to 60 seconds to answer `ok`; retry every 5 seconds until then.
  * Type `wpctl status | head -3` and press Enter. A PipeWire header must print, not `connection refused` (the only sink is the `Dummy Output`; that is expected).
  * Type `systemctl --failed --no-legend --plain; systemctl --user --failed --no-legend --plain; echo UNITS-DONE` and press Enter. Nothing may be listed above `UNITS-DONE`.
  ** If a unit is listed, run `systemctl status <unit> | sudo tee /dev/ttyS0` (password `prime`) so the reason lands in the serial log, and report it.
  * Close the terminal with Super+W. The desktop must return exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ./client-with-image returns the screenshot with each action and saves a round trip.
  * `omarchy-version` on a pristine mint reports 4.0.2; a different number means the disk was updated — record it, it is not a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the desktop with bar and wallpaper and no crash dialog
  ** Screenshot of the terminal showing `ok`, the version, `btrfs`, the PipeWire header, and `UNITS-DONE` with nothing listed above it
  ** Screenshot of the restored desktop
  * If unsuccessful
  ** Screenshot of the failing command (a missing bar, `omarchy-shell is not running`, `connection refused`, or a listed unit); serial dump of `systemctl status` for any failed unit; `./client get-serial`
covers: test/acceptance:44-65; test/acceptance.d/session-test.sh:8-13,48-75; bin/omarchy-shell; bin/omarchy-version
merged-from: 50:session-desktop-health

## Not runnable here

### clamshell-lid-close-disables-laptop-panel   [VM-NO]
description: Closing the lid of a docked laptop disables the internal panel (remembering its scale) and opening it re-enables it at the same scale; the watcher reconciles drift. Needs a lid switch and a second output, neither of which the guest has.
instruction: |
  <Instructions>
  From the desktop please do the following (laptop with an external monitor attached):

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-hyprland-monitor-laptop` → `eDP-1`; `hyprctl monitors -j | jq '.[]|{name,disabled,scale}'`.
  * Close the lid. Within 3 s the external shows everything; `cat ~/.local/state/omarchy/toggles/hypr/internal-monitor-clamshell.lua` → `hl.monitor({ output = "eDP-1", disabled = true })`; `cat ~/.local/state/omarchy/toggles/hypr/internal-monitor-scale` → the previous scale.
  * Open the lid → the panel comes back at that scale; the clamshell file is gone; `omarchy-hyprland-monitor-internal toggle` → toast `Laptop display disabled` and back.
  * Unplug the external while the panel is disabled → `recover` re-enables it within a few seconds (watcher).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in the QEMU guest: no lid switch, one output. Kept for the record.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screendumps of the external-only state, the state files, and the panel restored at the same scale
  * If unsuccessful
  ** `hyprctl monitors all -j` and the toggles/hypr listing
covers: bin/omarchy-hyprland-monitor-clamshell; bin/omarchy-hyprland-monitor-watch; bin/omarchy-hyprland-monitor-internal; bin/omarchy-hw-clamshell; bin/omarchy-hw-laptop-closed; test/shell.d/monitor-clamshell-scale-test.sh; test/shell.d/monitor-recovery-test.sh
merged-from: 25:clamshell-lid-close-disables-laptop-panel

## Moved to other domains

- 10:bar-clock-calendar-format-timezone → D — bar clock widget and calendar panel (the slice matched `lock` inside `clock`)
- 13:faq-clock-format-cycle-and-set → D — bar clock format ring / `omarchy bar set`
- 30:clock-calendar-popup → D — calendar panel behaviour
- 30:clock-label-format-and-timezone-clicks → D — clock label ring, `omarchy bar set`, timezone picker
- 31:clock-calendar-navigate-and-return → D — calendar panel navigation
- 31:clock-week-start-toggle-persists → D — calendar week-start setting
- 31:clock-format-cycle-right-click → D — clock label ring
- 31:clock-memento-mori-edit → D — calendar life-rail editor
- 51:clock-right-click-format-ring → D — clock label ring and click routing
- 41:timezone-picker-updates-clock → D — Update → Timezone and the bar clock
- 25:bar-set-clock-format-move-put-defaults → D — `omarchy-bar set/move/put/defaults`
- 30:bar-position-cli-and-rejects-invalid → D — `omarchy bar position`
- 31:monitor-text-size-slider-and-restore → D — Display panel text-size slider
- 25:brightness-no-backlight-and-dpms → D — brightness helpers' no-hardware paths and OSD absence; the lock's own DPMS blank/wake is `lock-blanks-after-five-seconds-and-wakes`
- 40:hypr-session-toggles-idle-nightlight → D — its unique half is the Super+Ctrl+N nightlight tint and indicator; the stay-awake half is covered by `stay-awake-toggle-indicator-and-status`
- 50:reminder-flow-cancel-and-invalid-minutes → D — reminders overlay and notification
- 52:reminder-rejects-invalid-minutes → D — reminders flow validation
- 12:plugin-validate-checks → D — shell plugin manifest validation (reviewer 32 covered plugins alongside the lock; not a lock story)
- 25:plugin-validate-rejects-bad-manifests → D — shell plugin manifest validation
- 32:plugin-validate-rejects-broken-manifests → D — shell plugin validation and refused add
- 52:plugin-validate-manifest-contract → D — shell plugin validation messages
- 12:plugin-clone-clock-and-remove-restores → D — Setup → Plugins → Clone Plugin lifecycle
- 60:plugin-add-rejects-invalid-repo-and-url → D — `omarchy plugin add` URL guard and manifest refusal
- 31:menu-about-and-screensaver-actions → B — tests menu action-row dispatch (About + Screensaver rows close the menu and run); the screensaver launch itself is `screensaver-system-menu-start-and-dismiss`
- 12:monitors-lua-invalid-mode-falls-back → C — Hyprland `monitors.lua` fallback
- 13:capslock-is-compose-key → C — keyboard input / XCompose (the slice matched `lock` inside `capslock`)
- 40:hypr-autostart-user-entry-runs-on-login → C — Hyprland `autostart.lua`; logout/login is only its trigger
- 10:unlock-style-picker-cancel → E — Style → Unlock is the Plymouth/SDDM branding picker; "unlock" here is the boot passphrase splash, not the session lock
- 12:style-unlock-picker-set-reboot-reset → E — Plymouth unlock-theme set/reset with reboot
- 52:unlock-screen-theme-refusals → E — `omarchy-plymouth-set` refusals and hostile theme names
- 52:unlock-screen-theme-applies-on-reboot → E — Plymouth/SDDM asset publishing and reboot proof
- 52:video-background-plays-and-pauses-on-lock → E — video background picker and playback; the lock screen showing it is one step
- 23:tailscale-install-without-login → F1 — service install/remove (the slice matched `login`)
- 12:update-pacman-guard-blocks-direct-syu → G1 — pacman upgrade guard (the slice matched `lock` inside `blocks`)
- 24:update-pacman-guard-blocks-direct-syu → G1 — pacman upgrade guard
- 43:pacman-guard-blocks-direct-sysupgrade → G1 — pacman upgrade guard with bypass
- 61:update-pacman-guard-blocks-sysupgrade → G1 — pacman upgrade guard
- 24:update-cancel-and-lock-rejects-second-run → G1 — `omarchy update` runtime lock and cancel
- 43:update-rejects-pacman-lock → G1 — update failing on a stale pacman db lock
- 43:migrate-waits-for-pacman-lock → G1 — `omarchy-migrate` waiting on the pacman lock
- 43:migrate-notify-login-toast → G1 — pending-migration login notifier
- 61:migrate-notify-toast-and-relogin → G1 — pending-migration notifier across re-login; the logout/login itself is `logout-to-sddm-greeter-wrong-empty-then-right-password`
- 12:starship-prompt-edit-and-invalid → H — shell prompt configuration
- 24:setup-sshd-key-only-login-localhost → H — SSHD setup and key-only logins (the slice matched `login`)
- 52:sshd-setup-hardens-password-logins → H — SSHD hardening drop-in
- 13:factory-reset-first-boot-form-validation → A2 — factory reset and first-boot owner form
- 42:resume-boot-luks-then-autologin → A2 — reboot / Plymouth / LUKS / autologin boot chain

## Dropped

(none)

## Rerouted

- 12:autostart-lua-launch-on-start → C — same story as 40:hypr-autostart-user-entry-runs-on-login (an `o.launch_on_start` line in `~/.config/hypr/autostart.lua` runs at the next session start, not on reload), which this file moved to C in the first pass because it is Hyprland `autostart.lua` configuration and logout/login is only its trigger; B routed it here on the assumption that A1 still held the sibling. Its unique bits for C's merge: the probe is `omarchy-notification-send "Autostart probe ran"` (toast within seconds of the bar appearing; `Super+Shift+Alt+comma` opens the notification history if missed) and the round trip is `omarchy-refresh-config hypr/autostart.lua`.
